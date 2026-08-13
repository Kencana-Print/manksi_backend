const db = require("../../config/database");
const sharp = require("sharp");
const fs = require("fs");
const path = require("path");

const NOMERATOR = "COM";

// ─────────────────────────────────────────────
// GENERATE NOMOR — COM.{YYMM}.{seq4}, basis dari
// TANGGAL COMPLAIN (bukan tanggal hari ini), regenerasi
// terjadi setiap kali save (mengikuti tanggal terkini di form),
// persis replikasi getmaxkode Delphi.
// ─────────────────────────────────────────────
const generateNomor = async (tanggal, conn) => {
  const d = new Date(tanggal);
  const yy = String(d.getFullYear()).slice(-2);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const prefix = `${NOMERATOR}.${yy}${mm}.`;

  const [[row]] = await conn.query(
    `SELECT MAX(CAST(RIGHT(tc_nomor, 4) AS UNSIGNED)) AS maxNum
     FROM tcomplain
     WHERE tc_nomor LIKE ?
     FOR UPDATE`,
    [`${prefix}%`],
  );
  const next = (row.maxNum || 0) + 1;
  return `${prefix}${String(next).padStart(4, "0")}`;
};

// ─────────────────────────────────────────────
// JENIS COMPLAIN — lookup dari tcomplain_jenis
// ─────────────────────────────────────────────
const getJenisComplainOptions = async () => {
  const [rows] = await db.query(
    `SELECT cj_jenis AS jenis FROM tcomplain_jenis ORDER BY cj_jenis`,
  );
  return rows.map((r) => r.jenis);
};

// ─────────────────────────────────────────────
// DETAIL SPK/MEMO (dipakai saat user pilih dari SpkSearchModal
// atau ketik manual + Enter). Prefix "MAP" -> tmemospk (TIDAK
// difilter aktif, replikasi persis Delphi). Selain itu -> coba
// tsalesorder (SO baru) dulu, fallback tspk legacy (spk_is_so=1),
// KEDUANYA difilter aktif="Y" (replikasi filter SPK Delphi).
// ─────────────────────────────────────────────
const getSpkOrMemoDetail = async (nomor) => {
  const isMap = String(nomor).toUpperCase().startsWith("MAP");

  if (isMap) {
    const [rows] = await db.query(
      `SELECT
         m.mspk_nomor                              AS Nomor,
         m.mspk_nama                                AS Nama,
         DATE_FORMAT(m.mspk_tanggal, '%Y-%m-%d')    AS Tanggal,
         m.mspk_tipe                                AS Tipe,
         IFNULL(d.divisi, '')                       AS Divisi,
         m.mspk_cus_kode                            AS CusKode,
         IFNULL(c.cus_nama, '')                     AS CusNama,
         IFNULL(c.cus_alamat, '')                   AS Alamat,
         IFNULL(c.cus_kota, '')                      AS Kota,
         IFNULL(c.cus_telp, '')                      AS Telp,
         'MEMO'                                     AS Jenis
       FROM tmemospk m
       LEFT JOIN tdivisi d ON d.kode = m.mspk_divisi
       LEFT JOIN tcustomer c ON c.cus_kode = m.mspk_cus_kode
       WHERE m.mspk_nomor = ?`,
      [nomor],
    );
    if (rows.length === 0) throw new Error("Nomor MAP tersebut tidak ada.");
    return rows[0];
  }

  // Coba SO baru dulu
  let [rows] = await db.query(
    `SELECT
       s.so_nomor                                 AS Nomor,
       s.so_nama                                  AS Nama,
       DATE_FORMAT(s.so_tanggal, '%Y-%m-%d')      AS Tanggal,
       s.so_tipe                                  AS Tipe,
       IFNULL(d.divisi, '')                       AS Divisi,
       s.so_cus_kode                               AS CusKode,
       IFNULL(c.cus_nama, '')                      AS CusNama,
       IFNULL(c.cus_alamat, '')                    AS Alamat,
       IFNULL(c.cus_kota, '')                       AS Kota,
       IFNULL(c.cus_telp, '')                       AS Telp,
       'SPK'                                        AS Jenis
     FROM tsalesorder s
     LEFT JOIN tdivisi d ON d.kode = s.so_divisi
     LEFT JOIN tcustomer c ON c.cus_kode = s.so_cus_kode
     WHERE s.so_nomor = ? AND s.so_aktif = 'Y'`,
    [nomor],
  );

  if (rows.length === 0) {
    // Fallback SPK legacy (pre-migrasi)
    [rows] = await db.query(
      `SELECT
         s.spk_nomor                                AS Nomor,
         s.spk_nama                                 AS Nama,
         DATE_FORMAT(s.spk_tanggal, '%Y-%m-%d')     AS Tanggal,
         s.spk_tipe                                 AS Tipe,
         IFNULL(d.divisi, '')                       AS Divisi,
         s.spk_cus_kode                              AS CusKode,
         IFNULL(c.cus_nama, '')                      AS CusNama,
         IFNULL(c.cus_alamat, '')                    AS Alamat,
         IFNULL(c.cus_kota, '')                       AS Kota,
         IFNULL(c.cus_telp, '')                       AS Telp,
         'SPK'                                        AS Jenis
       FROM tspk s
       LEFT JOIN tdivisi d ON d.kode = s.spk_divisi
       LEFT JOIN tcustomer c ON c.cus_kode = s.spk_cus_kode
       WHERE s.spk_nomor = ? AND s.spk_aktif = 'Y'`,
      [nomor],
    );
  }

  if (rows.length === 0) throw new Error("Nomor SO/SPK tersebut tidak ada.");
  return rows[0];
};

// ─────────────────────────────────────────────
// GET DETAIL FORM (mode edit) — gabungkan tcomplain +
// detail SPK/Memo terkait (untuk re-display field readonly).
// ─────────────────────────────────────────────
const getDetailForm = async (nomor) => {
  const [rows] = await db.query(`SELECT * FROM tcomplain WHERE tc_nomor = ?`, [
    nomor,
  ]);
  if (rows.length === 0) throw new Error("Nomor Complain tersebut tidak ada.");

  const header = rows[0];

  let spkDetail = null;
  if (header.tc_spk_nomor) {
    try {
      spkDetail = await getSpkOrMemoDetail(header.tc_spk_nomor);
    } catch {
      // SPK/Memo referensi mungkin sudah tidak aktif/terhapus —
      // tetap tampilkan data complain apa adanya, field SPK kosong.
      spkDetail = null;
    }
  }

  return { header, spkDetail };
};

// ─────────────────────────────────────────────
// SAVE — create & edit.
// ⚠️ Replikasi persis Delphi: saat EDIT, tc_spk_nomor TIDAK PERNAH
// diupdate (referensi SPK/Memo terkunci sejak dibuat). Field itu
// sengaja diabaikan pada UPDATE meskipun dikirim di payload.
// ─────────────────────────────────────────────
const saveData = async (nomorParam, payload, user) => {
  const {
    isEdit,
    tanggal,
    spkNomor,
    nama,
    jenis,
    keterangan,
    action,
    ketDiv1,
    ketDiv2,
    ketDiv3,
    cusKode,
  } = payload;

  if (!spkNomor || !spkNomor.trim()) {
    throw new Error("Nomor SPK/Memo belum diisi.");
  }
  if (!jenis || !jenis.trim()) {
    throw new Error("Jenis Complain silahkan dipilih dulu dong!");
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    let savedNomor = nomorParam;

    if (isEdit) {
      await conn.query(
        `UPDATE tcomplain SET
           tc_cus_kode = ?, tc_nama = ?, tc_Description = ?, tc_jenis = ?,
           tc_Date = ?, user_modified = ?, tc_action = ?,
           tc_ket_div1 = ?, tc_ket_div2 = ?, tc_ket_div3 = ?
         WHERE tc_nomor = ?`,
        [
          cusKode || "",
          nama || "",
          keterangan || "",
          jenis,
          tanggal,
          user.kode,
          action || "",
          ketDiv1 || "",
          ketDiv2 || "",
          ketDiv3 || "",
          nomorParam,
        ],
      );
    } else {
      savedNomor = await generateNomor(tanggal, conn);
      await conn.query(
        `INSERT INTO tcomplain
           (tc_nomor, tc_spk_nomor, tc_date, tc_nama, tc_description,
            tc_cus_kode, tc_jenis, user_create, tc_action,
            tc_ket_div1, tc_ket_div2, tc_ket_div3)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          savedNomor,
          spkNomor,
          tanggal,
          nama || "",
          keterangan || "",
          cusKode || "",
          jenis,
          user.kode,
          action || "",
          ketDiv1 || "",
          ketDiv2 || "",
          ketDiv3 || "",
        ],
      );
    }

    await conn.commit();
    return { nomor: savedNomor };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
};

// ─────────────────────────────────────────────
// UPLOAD GAMBAR (per-slot: 1, 2, atau 3)
// Disimpan di public/images/complain/{nomor}-0{slot}.jpg —
// terpisah dari lokasi legacy Delphi (/mnt/image, diakses via
// /file-gambar) yang read-only sebagai referensi histori lama.
// ─────────────────────────────────────────────
const processImage = async (tempFilePath, nomor, slot) => {
  if (!fs.existsSync(tempFilePath))
    throw new Error("File sumber sementara tidak ditemukan.");
  if (![1, 2, 3].includes(Number(slot))) throw new Error("Slot tidak valid.");

  const finalFileName = `${nomor}-0${slot}.jpg`;
  const folderPath = path.join(process.cwd(), "public", "images", "complain");
  if (!fs.existsSync(folderPath)) {
    fs.mkdirSync(folderPath, { recursive: true });
  }
  const finalPath = path.join(folderPath, finalFileName);

  try {
    await sharp(tempFilePath)
      .flatten({ background: { r: 255, g: 255, b: 255 } })
      .toFormat("jpeg")
      .jpeg({ quality: 80 })
      .toFile(finalPath);
    if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
    return finalFileName;
  } catch (error) {
    if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
    throw new Error("Gagal memproses gambar ke format JPG.");
  }
};

// ─────────────────────────────────────────────
// RESET GAMBAR — hapus SEMUA 3 slot sekaligus, replikasi
// persis btreset1Click (bukan reset per-slot).
// ─────────────────────────────────────────────
const resetImages = async (nomor) => {
  const folderPath = path.join(process.cwd(), "public", "images", "complain");
  for (let slot = 1; slot <= 3; slot++) {
    const filePath = path.join(folderPath, `${nomor}-0${slot}.jpg`);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }
  return { success: true };
};

module.exports = {
  generateNomor,
  getJenisComplainOptions,
  getSpkOrMemoDetail,
  getDetailForm,
  saveData,
  processImage,
  resetImages,
};
