const db = require("../../config/database");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// Bagian yang boleh mengunggah dan menghapus memo. Semua user boleh melihat.
const BAGIAN_UPLOAD = ["AUDIT", "DIR", "EDP"];

// Folder privat: sengaja di luar folder yang disajikan statis
const FOLDER = path.join(process.cwd(), "storage", "memo-internal");

const gagal = (message, statusCode = 400) =>
  Object.assign(new Error(message), { statusCode });

const bolehUpload = (user) =>
  BAGIAN_UPLOAD.includes(
    String(user?.bagian || "")
      .toUpperCase()
      .trim(),
  );

const hapusFile = (p) => {
  try {
    if (p && fs.existsSync(p)) fs.unlinkSync(p);
  } catch {
    // best effort
  }
};

// Header file PDF selalu diawali "%PDF-"; mimetype dari klien tidak cukup dipercaya
const adalahPdf = (p) => {
  const fd = fs.openSync(p, "r");
  try {
    const buf = Buffer.alloc(5);
    fs.readSync(fd, buf, 0, 5, 0);
    return buf.toString("latin1") === "%PDF-";
  } finally {
    fs.closeSync(fd);
  }
};

const getList = async (user) => {
  const [rows] = await db.query(
    `SELECT m.memo_id AS id,
            m.memo_nomor AS nomor,
            DATE_FORMAT(m.memo_tanggal, '%Y-%m-%d') AS tanggal,
            m.memo_judul AS judul,
            m.memo_keterangan AS keterangan,
            m.memo_nama_asli AS namaAsli,
            m.memo_ukuran AS ukuran,
            m.memo_notif AS notif,
            m.memo_user_create AS userCreate,
            IFNULL(u.user_nama, m.memo_user_create) AS userNama,
            DATE_FORMAT(m.memo_date_create, '%Y-%m-%d %H:%i') AS dateCreate,
            (b.mb_memo_id IS NOT NULL) AS sudahBaca
       FROM tmemo_internal m
       LEFT JOIN tuser u ON u.user_kode = m.memo_user_create
       LEFT JOIN tmemo_internal_baca b
              ON b.mb_memo_id = m.memo_id AND b.mb_user = ?
      ORDER BY m.memo_tanggal DESC, m.memo_id DESC`,
    [user.kode],
  );
  const items = rows.map((r) => ({
    ...r,
    notif: !!r.notif,
    sudahBaca: !!r.sudahBaca,
  }));
  return { items, bolehUpload: bolehUpload(user) };
};

// Jumlah memo belum dibaca + beberapa yang terbaru (untuk badge dan pemberitahuan)
const getUnread = async (user) => {
  const [rows] = await db.query(
    `SELECT m.memo_id AS id,
            m.memo_judul AS judul,
            DATE_FORMAT(m.memo_tanggal, '%Y-%m-%d') AS tanggal
       FROM tmemo_internal m
      WHERE m.memo_notif = 1
        AND NOT EXISTS (
          SELECT 1 FROM tmemo_internal_baca b
           WHERE b.mb_memo_id = m.memo_id AND b.mb_user = ?
        )
      ORDER BY m.memo_date_create DESC, m.memo_id DESC`,
    [user.kode],
  );
  return { jumlah: rows.length, terbaru: rows.slice(0, 5) };
};

const simpan = async (
  { nomor, tanggal, judul, keterangan, notif },
  file,
  user,
) => {
  try {
    if (!bolehUpload(user)) {
      throw gagal(
        "Hanya bagian Audit, Direksi, dan EDP yang dapat mengunggah memo.",
        403,
      );
    }
    if (!file) throw gagal("File PDF wajib dipilih.");

    const tgl = String(tanggal || "").slice(0, 10);
    const jdl = String(judul || "").trim();
    if (!tgl) throw gagal("Tanggal memo wajib diisi.");
    if (!jdl) throw gagal("Judul memo wajib diisi.");
    if (jdl.length > 200) throw gagal("Judul maksimal 200 karakter.");
    if (!adalahPdf(file.path)) throw gagal("Isi file bukan PDF yang valid.");

    fs.mkdirSync(FOLDER, { recursive: true });
    const namaFile = `memo-${Date.now()}-${crypto.randomBytes(6).toString("hex")}.pdf`;
    const tujuan = path.join(FOLDER, namaFile);
    fs.copyFileSync(file.path, tujuan);

    // multer membaca nama berkas sebagai latin1; kembalikan ke UTF-8
    const namaAsli = Buffer.from(file.originalname, "latin1")
      .toString("utf8")
      .slice(0, 255);

    // FormData mengirim string: "0" = tanpa notifikasi (arsip), selain itu notifikasi aktif
    const kirimNotif = String(notif ?? "1") === "0" ? 0 : 1;

    try {
      const [ins] = await db.query(
        `INSERT INTO tmemo_internal
           (memo_nomor, memo_tanggal, memo_judul, memo_keterangan,
            memo_file, memo_nama_asli, memo_ukuran, memo_notif, memo_user_create)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          String(nomor || "")
            .trim()
            .slice(0, 50),
          tgl,
          jdl,
          String(keterangan || "")
            .trim()
            .slice(0, 255),
          namaFile,
          namaAsli,
          Number(file.size) || 0,
          kirimNotif,
          user.kode,
        ],
      );
      // Pengunggah tidak perlu diberi tahu memonya sendiri
      await db.query(
        `INSERT IGNORE INTO tmemo_internal_baca (mb_memo_id, mb_user) VALUES (?, ?)`,
        [ins.insertId, user.kode],
      );
      return {
        id: ins.insertId,
        judul: jdl,
        tanggal: tgl,
        notif: !!kirimNotif,
      };
    } catch (e) {
      hapusFile(tujuan);
      throw e;
    }
  } finally {
    hapusFile(file?.path);
  }
};

const getFile = async (id, user) => {
  const [[row]] = await db.query(
    `SELECT memo_file AS file, memo_nama_asli AS namaAsli
       FROM tmemo_internal WHERE memo_id = ?`,
    [Number(id)],
  );
  if (!row) throw gagal("Memo tidak ditemukan.", 404);
  const p = path.join(FOLDER, path.basename(row.file));
  if (!fs.existsSync(p))
    throw gagal("File memo tidak ditemukan di server.", 404);

  await db.query(
    `INSERT IGNORE INTO tmemo_internal_baca (mb_memo_id, mb_user) VALUES (?, ?)`,
    [Number(id), user.kode],
  );
  return { path: p, namaAsli: row.namaAsli };
};

const hapus = async (id, user) => {
  if (!bolehUpload(user)) {
    throw gagal(
      "Hanya bagian Audit, Direksi, dan EDP yang dapat menghapus memo.",
      403,
    );
  }
  const [[row]] = await db.query(
    `SELECT memo_file AS file FROM tmemo_internal WHERE memo_id = ?`,
    [Number(id)],
  );
  if (!row) throw gagal("Memo tidak ditemukan.", 404);
  await db.query(`DELETE FROM tmemo_internal WHERE memo_id = ?`, [Number(id)]);
  hapusFile(path.join(FOLDER, path.basename(row.file)));
};

module.exports = {
  bolehUpload,
  getList,
  getUnread,
  simpan,
  getFile,
  hapus,
};
