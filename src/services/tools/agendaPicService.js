const db = require("../../config/database");

const isUserHo = (cab) => !cab || cab === "HO-";

// ─────────────────────────────────────────────
// GET PIC LIST — kepala bagian cuma lihat/kelola PIC utk
// bagian+cabang dia sendiri (scoping otomatis dari req.user, sama
// pola isolasi yang dipakai di semua modul lain).
// ─────────────────────────────────────────────
const getPicList = async (bagian, cabang) => {
  const ho = isUserHo(cabang);
  const cabToUse = ho ? "HO-" : cabang;
  const [rows] = await db.query(
    `SELECT p.pic_user_kode AS Kode, u.user_nama AS Nama, p.date_create AS DateCreate
     FROM tagenda_pic p
     LEFT JOIN tuser u ON u.user_kode = p.pic_user_kode
     WHERE p.pic_bagian = ? AND p.pic_cabang = ?
     ORDER BY u.user_nama ASC`,
    [bagian, cabToUse],
  );
  return rows;
};

// ─────────────────────────────────────────────
// GET CANDIDATE USERS — daftar user di bagian+cabang yang sama,
// belum jadi PIC, buat dropdown "Tambah PIC"
// ─────────────────────────────────────────────
const getCandidateUsers = async (bagian, cabang) => {
  const ho = isUserHo(cabang);
  const cabToUse = ho ? "HO-" : cabang;
  const [rows] = await db.query(
    `SELECT u.user_kode AS Kode, u.user_nama AS Nama
     FROM tuser u
     WHERE u.user_bagian = ? AND u.user_cab = ? AND u.user_aktif = 0
       AND u.user_kode NOT IN (
         SELECT pic_user_kode FROM tagenda_pic
         WHERE pic_bagian = ? AND pic_cabang = ?
       )
     ORDER BY u.user_nama ASC`,
    [bagian, cabToUse, bagian, cabToUse],
  );
  return rows;
};

const addPic = async (bagian, cabang, targetUserKode, userKode) => {
  const ho = isUserHo(cabang);
  const cabToUse = ho ? "HO-" : cabang;

  const [[target]] = await db.query(
    `SELECT user_kode FROM tuser
     WHERE user_kode = ? AND user_bagian = ? AND user_cab = ? AND user_aktif = 0`,
    [targetUserKode, bagian, cabToUse],
  );
  if (!target) {
    throw new Error(
      "User tidak ditemukan atau bukan dari bagian/cabang yang sama.",
    );
  }

  await db.query(
    `INSERT IGNORE INTO tagenda_pic (pic_bagian, pic_cabang, pic_user_kode, user_create, date_create)
     VALUES (?, ?, ?, ?, NOW())`,
    [bagian, cabToUse, targetUserKode, userKode],
  );
  return true;
};

const removePic = async (bagian, cabang, targetUserKode) => {
  const ho = isUserHo(cabang);
  const cabToUse = ho ? "HO-" : cabang;
  await db.query(
    `DELETE FROM tagenda_pic WHERE pic_bagian = ? AND pic_cabang = ? AND pic_user_kode = ?`,
    [bagian, cabToUse, targetUserKode],
  );
  return true;
};

module.exports = { getPicList, getCandidateUsers, addPic, removePic };
