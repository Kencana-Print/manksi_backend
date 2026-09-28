const db = require("../../config/database");

const getAll = async () => {
  const [rows] = await db.query(
    `SELECT r.rek_kode AS kode, r.rek_nama AS nama,
            r.rek_rekening AS no_rekening, r.rek_kaosan AS store,
            k.kol_nama AS kelompok, r.rek_kol_id AS kol_id,
            r.rek_cabang AS cabang, r.rek_ket AS keterangan,
            IF(r.rek_isaktif=0,'Aktif','Pasif') AS status,
            IFNULL((
              SELECT SUM(i.jurd_debet - i.jurd_kredit)
              FROM finance.tjurnalitem i
              WHERE i.jurd_nourut = 0 AND i.jurd_rek_kode = r.rek_kode
            ), 0) AS saldo_akhir
     FROM finance.trekening r
     LEFT JOIN finance.tkelompok k ON k.kol_id = r.rek_kol_id
     ORDER BY r.rek_kode`,
  );
  return rows;
};

const getById = async (kode) => {
  const [[row]] = await db.query(
    `SELECT r.rek_kode AS kode, r.rek_nama AS nama,
            r.rek_rekening AS no_rekening, r.rek_kaosan AS store, r.rek_kol_id AS kol_id,
            r.rek_cabang AS cabang, r.rek_ket AS keterangan,
            r.rek_isaktif AS is_aktif
     FROM finance.trekening r WHERE r.rek_kode = ?`,
    [kode],
  );
  if (!row) throw new Error("Rekening tidak ditemukan.");
  return row;
};

const getKelompok = async () => {
  const [rows] = await db.query(
    `SELECT kol_id AS id, kol_nama AS nama FROM finance.tkelompok ORDER BY kol_nama`,
  );
  return rows;
};

const getCabang = async () => {
  const [rows] = await db.query(
    `SELECT Cabang AS cabang FROM finance.tcabang ORDER BY Cabang`,
  );
  return rows;
};

const cekPakai = async (kode) => {
  const [[row]] = await db.query(
    `SELECT COUNT(*) AS total FROM (
       SELECT jur_rek_kode AS kode FROM finance.tjurnal WHERE jur_rek_kode <> ''
       UNION
       SELECT jurd_rek_kode AS kode FROM finance.tjurnalitem WHERE jurd_rek_kode <> ''
     ) X WHERE kode = ?`,
    [kode],
  );
  return row.total > 0;
};

const saveData = async (payload) => {
  const {
    isEdit,
    kode,
    nama,
    no_rekening,
    kol_id,
    cabang,
    store,
    keterangan,
    is_aktif,
  } = payload;

  if (isEdit) {
    await db.query(
      `UPDATE finance.trekening SET
         rek_nama = ?, rek_rekening = ?, rek_kaosan = ?,
         rek_ket = ?, rek_isaktif = ?, rek_kol_id = ?
       WHERE rek_kode = ?`,
      [
        nama,
        no_rekening || "",
        store || "",
        keterangan || "",
        is_aktif ? 0 : 1,
        kol_id,
        kode,
      ],
    );
  } else {
    const [[cek]] = await db.query(
      `SELECT COUNT(*) AS c FROM finance.trekening WHERE rek_kode = ?`,
      [kode],
    );
    if (cek.c > 0) throw new Error(`Kode "${kode}" sudah ada.`);

    await db.query(
      `INSERT INTO finance.trekening (rek_kode, rek_nama, rek_rekening, rek_kol_id, rek_cabang, rek_kaosan, rek_ket, rek_isaktif)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        kode,
        nama,
        no_rekening || "",
        kol_id,
        cabang || "",
        store || "",
        keterangan || "",
        is_aktif ? 0 : 1,
      ],
    );
  }

  return { kode };
};

const deleteData = async (kode) => {
  const dipakai = await cekPakai(kode);
  if (dipakai)
    throw new Error(
      "Account ini sudah dipakai untuk transaksi. Tidak bisa dihapus.",
    );

  await db.query(`DELETE FROM finance.trekening WHERE rek_kode = ?`, [kode]);
};

module.exports = {
  getAll,
  getById,
  getKelompok,
  getCabang,
  saveData,
  deleteData,
};
