const db = require("../../config/database");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// Bagian yang boleh mengunggah, menghapus, mengubah target, dan selalu melihat
// semua memo. Dicek lewat tuser.user_bagian (bukan HRD).
const BAGIAN_UPLOAD = ["AUDIT", "DIREKSI", "EDP"];

// Folder privat: sengaja di luar folder yang disajikan statis
const FOLDER = path.join(process.cwd(), "storage", "memo-internal");

const gagal = (message, statusCode = 400) =>
  Object.assign(new Error(message), { statusCode });

const norm = (v) =>
  String(v ?? "")
    .trim()
    .toUpperCase();

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

// ─────────────────────────── HRD ───────────────────────────

// Pilihan target di form unggah: bagian dari karyawan aktif, jabatan dari master
const getOpsi = async () => {
  const [bagian] = await db.query(
    `SELECT DISTINCT UPPER(TRIM(kar_bagian)) AS nilai
       FROM hrd2.tkaryawan
      WHERE kar_status_aktif = 1 AND TRIM(IFNULL(kar_bagian, '')) <> ''
      ORDER BY 1`,
  );
  const [jabatan] = await db.query(
    `SELECT UPPER(TRIM(jab_kode)) AS kode, jab_nama AS nama
       FROM hrd2.tjabatan
      ORDER BY jab_nama`,
  );
  return { bagian: bagian.map((r) => r.nilai), jabatan };
};

// Bagian dan jabatan user menurut HRD. null = tidak punya data HRD
// (NIK kosong / tidak ditemukan / sudah tidak aktif).
const getProfilHrd = async (user) => {
  const [[u]] = await db.query(
    `SELECT user_nik FROM tuser WHERE user_kode = ?`,
    [user.kode],
  );
  const nik = String(u?.user_nik ?? "").trim();
  if (!nik) return null;
  const [[k]] = await db.query(
    `SELECT kar_bagian, kar_jab_kode FROM hrd2.tkaryawan
      WHERE kar_Nik = ? AND kar_status_aktif = 1 LIMIT 1`,
    [nik],
  );
  if (!k) return null;
  return { bagian: norm(k.kar_bagian), jabatan: norm(k.kar_jab_kode) };
};

// ───────────────────────── Akses memo ─────────────────────────

// Potongan SQL "memo ini boleh dilihat user". Memo tanpa target = untuk semua.
// Bagian EDP/Direksi/Audit tidak difilter. Tanpa data HRD hanya memo untuk semua.
const filterAkses = async (user, alias) => {
  if (bolehUpload(user)) return { sql: "", params: [] };

  const p = await getProfilHrd(user);
  const kondisi = [];
  const params = [];
  if (p?.bagian) {
    kondisi.push("(t.mt_tipe = 'BAGIAN' AND UPPER(TRIM(t.mt_nilai)) = ?)");
    params.push(p.bagian);
  }
  if (p?.jabatan) {
    kondisi.push("(t.mt_tipe = 'JABATAN' AND UPPER(TRIM(t.mt_nilai)) = ?)");
    params.push(p.jabatan);
  }
  const cocok = kondisi.length
    ? `OR EXISTS (SELECT 1 FROM tmemo_internal_target t
                   WHERE t.mt_memo_id = ${alias}.memo_id
                     AND (${kondisi.join(" OR ")}))`
    : "";

  return {
    sql: `AND (NOT EXISTS (SELECT 1 FROM tmemo_internal_target t0
                            WHERE t0.mt_memo_id = ${alias}.memo_id) ${cocok})`,
    params,
  };
};

const ambilTarget = async (ids) => {
  const peta = new Map();
  if (!ids.length) return peta;
  const [rows] = await db.query(
    `SELECT mt_memo_id AS id, mt_tipe AS tipe, mt_nilai AS nilai
       FROM tmemo_internal_target
      WHERE mt_memo_id IN (?)
      ORDER BY mt_nilai`,
    [ids],
  );
  for (const r of rows) {
    if (!peta.has(r.id)) peta.set(r.id, { bagian: [], jabatan: [] });
    peta.get(r.id)[r.tipe === "BAGIAN" ? "bagian" : "jabatan"].push(r.nilai);
  }
  return peta;
};

// Normalisasi dan validasi target dari klien. Nilai asing ditolak: target yang
// salah ketik akan membuat memo tidak terlihat siapa pun selain EDP/Direksi/Audit.
const siapkanTarget = async (raw) => {
  let o = raw;
  if (typeof raw === "string" && raw.trim()) {
    try {
      o = JSON.parse(raw);
    } catch {
      throw gagal("Format target memo tidak valid.");
    }
  }
  const ambil = (arr) => [
    ...new Set((Array.isArray(arr) ? arr : []).map(norm).filter(Boolean)),
  ];
  const target = { bagian: ambil(o?.bagian), jabatan: ambil(o?.jabatan) };
  if (!target.bagian.length && !target.jabatan.length) return target;

  const opsi = await getOpsi();
  const bagianOk = new Set(opsi.bagian);
  const jabatanOk = new Set(opsi.jabatan.map((j) => j.kode));
  const asing = [
    ...target.bagian.filter((v) => !bagianOk.has(v)),
    ...target.jabatan.filter((v) => !jabatanOk.has(v)),
  ];
  if (asing.length) {
    throw gagal(`Bagian/jabatan tidak dikenal di HRD: ${asing.join(", ")}.`);
  }
  return target;
};

const simpanTarget = async (conn, memoId, target) => {
  const baris = [
    ...target.bagian.map((v) => [memoId, "BAGIAN", v]),
    ...target.jabatan.map((v) => [memoId, "JABATAN", v]),
  ];
  if (baris.length) {
    await conn.query(
      `INSERT INTO tmemo_internal_target (mt_memo_id, mt_tipe, mt_nilai) VALUES ?`,
      [baris],
    );
  }
};

// ─────────────────────────── Memo ───────────────────────────

const getList = async (user) => {
  const f = await filterAkses(user, "m");
  const bisaKelola = bolehUpload(user);

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
      WHERE 1 = 1 ${f.sql}
      ORDER BY m.memo_tanggal DESC, m.memo_id DESC`,
    [user.kode, ...f.params],
  );

  // Target hanya dikirim ke yang berhak mengelola
  const petaTarget = bisaKelola
    ? await ambilTarget(rows.map((r) => r.id))
    : null;

  const items = rows.map((r) => ({
    ...r,
    notif: !!r.notif,
    sudahBaca: !!r.sudahBaca,
    target: petaTarget
      ? (petaTarget.get(r.id) ?? { bagian: [], jabatan: [] })
      : null,
  }));
  return { items, bolehUpload: bisaKelola };
};

// Jumlah memo belum dibaca + beberapa yang terbaru (untuk badge dan pemberitahuan)
const getUnread = async (user) => {
  const f = await filterAkses(user, "m");
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
        ${f.sql}
      ORDER BY m.memo_date_create DESC, m.memo_id DESC`,
    [user.kode, ...f.params],
  );
  return { jumlah: rows.length, terbaru: rows.slice(0, 5) };
};

const simpan = async (
  { nomor, tanggal, judul, keterangan, notif, target },
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

    // Sebelum file disalin: target yang tidak valid tidak boleh meninggalkan apa pun
    const sasaran = await siapkanTarget(target);

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

    // Satu transaksi: memo dan targetnya harus jadi bersamaan. Kalau target gagal
    // tersimpan sementara memo sudah ada, memo terbatas berubah jadi terbuka untuk semua.
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      const [ins] = await conn.query(
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
      await conn.query(
        `INSERT IGNORE INTO tmemo_internal_baca (mb_memo_id, mb_user) VALUES (?, ?)`,
        [ins.insertId, user.kode],
      );
      await simpanTarget(conn, ins.insertId, sasaran);
      await conn.commit();
      return {
        id: ins.insertId,
        judul: jdl,
        tanggal: tgl,
        notif: !!kirimNotif,
      };
    } catch (e) {
      await conn.rollback().catch(() => {});
      hapusFile(tujuan);
      throw e;
    } finally {
      conn.release();
    }
  } finally {
    hapusFile(file?.path);
  }
};

const ubahTarget = async (id, target, user) => {
  if (!bolehUpload(user)) {
    throw gagal(
      "Hanya bagian Audit, Direksi, dan EDP yang dapat mengubah target memo.",
      403,
    );
  }
  const memoId = Number(id);
  const [[row]] = await db.query(
    `SELECT memo_id FROM tmemo_internal WHERE memo_id = ?`,
    [memoId],
  );
  if (!row) throw gagal("Memo tidak ditemukan.", 404);

  const sasaran = await siapkanTarget(target);

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(`DELETE FROM tmemo_internal_target WHERE mt_memo_id = ?`, [
      memoId,
    ]);
    await simpanTarget(conn, memoId, sasaran);
    await conn.commit();
  } catch (e) {
    await conn.rollback().catch(() => {});
    throw e;
  } finally {
    conn.release();
  }
  return { id: memoId };
};

// 404 untuk "tidak ada" maupun "tidak berhak": id yang berurutan tidak bisa
// dipakai untuk menebak memo mana yang ada.
const getFile = async (id, user) => {
  const f = await filterAkses(user, "m");
  const [[row]] = await db.query(
    `SELECT m.memo_file AS file, m.memo_nama_asli AS namaAsli
       FROM tmemo_internal m
      WHERE m.memo_id = ? ${f.sql}`,
    [Number(id), ...f.params],
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
  await db.query(`DELETE FROM tmemo_internal_target WHERE mt_memo_id = ?`, [
    Number(id),
  ]);
  hapusFile(path.join(FOLDER, path.basename(row.file)));
};

module.exports = {
  bolehUpload,
  getOpsi,
  getList,
  getUnread,
  simpan,
  ubahTarget,
  getFile,
  hapus,
};
