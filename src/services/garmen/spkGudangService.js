const db = require("../../config/database");
const {
  getTanggalTutupBukuUntukTanggal,
} = require("../../services/tutupBukuService");

// ============================================================
// SPK Gudang
// Header : tspk_gudang     (prefix kolom: spg_)
// Detail : tspk_gudangitem (prefix kolom: spgi_)
// Ngedit (status pengajuan perubahan data) diambil dari tspk_pin5
//   (pin_trs = 'SPK GUDANG'), baris terakhir by pin_urut:
//     pin_acc='' & pin_dipakai=''      -> WAIT  (nunggu acc)
//     pin_acc='Y' & pin_dipakai=''     -> ACC   (sudah acc, belum dipakai)
//     pin_acc='Y' & pin_dipakai='Y'    -> ''    (sudah dieksekusi, no color)
//     pin_acc='N'                      -> TOLAK
// ============================================================

// --- BROWSE (master list) ---
const getBrowseList = async (filters) => {
  const { startDate, endDate } = filters;

  const [rows] = await db.query(
    `SELECT
       s.spg_nomor           AS Nomor,
       s.spg_tanggal          AS Tanggal,
       s.spg_dateline         AS Dateline,
       s.spg_jenis            AS JenisKaos,
       s.spg_lengan           AS Lengan,
       IFNULL(j.bj_nama, '')  AS JenisKain,
       s.spg_finishing        AS Finishing,
       s.spg_workshop         AS Workshop,
       s.spg_ket              AS Keterangan,
       IFNULL((
         SELECT
           IFNULL(
             IF(p.pin_acc = '' AND p.pin_dipakai = '', 'WAIT',
             IF(p.pin_acc = 'Y' AND p.pin_dipakai = '', 'ACC',
             IF(p.pin_acc = 'Y' AND p.pin_dipakai = 'Y', '',
             IF(p.pin_acc = 'N', 'TOLAK', '')))),
             ''
           )
         FROM tspk_pin5 p
         WHERE p.pin_trs = 'SPK GUDANG' AND p.pin_nomor = s.spg_nomor
         ORDER BY p.pin_urut DESC
         LIMIT 1
       ), '')                 AS Ngedit,
       s.user_create          AS UserCreate,
       s.date_create          AS Created
     FROM tspk_gudang s
     LEFT JOIN tbahan_jenis j ON j.bj_kode = s.spg_kain
     WHERE s.spg_tanggal >= ? AND s.spg_tanggal < DATE_ADD(?, INTERVAL 1 DAY)
     ORDER BY s.spg_nomor`,
    [startDate, endDate],
  );
  return rows;
};

// --- BROWSE DETAIL (expand per Nomor) ---
const getDetail = async (nomor) => {
  const [rows] = await db.query(
    `SELECT
       i.spgi_nomor   AS Nomor,
       i.spgi_spk     AS Spk,
       i.spgi_nama    AS NamaSpk,
       i.spgi_jumlah  AS Qty,
       i.spgi_kodek   AS KodeKaosan
     FROM tspk_gudangitem i
     WHERE i.spgi_nomor = ?
     ORDER BY i.spgi_urut`,
    [nomor],
  );
  return rows;
};

// --- Cek dipakai transaksi (replikasi cekhapus Delphi) ---
// True kalau salah satu item SPK Gudang ini sudah dipakai di Mutasi Produksi
const isUsedInProduction = async (nomor) => {
  const [rows] = await db.query(
    `SELECT 1 FROM tspk_gudangitem i
     WHERE i.spgi_nomor = ?
       AND i.spgi_spk IN (SELECT DISTINCT h.mph_spk_nomor FROM tmutasiproduksi_hdr h)
     LIMIT 1`,
    [nomor],
  );
  return rows.length > 0;
};

// --- DELETE ---
const deleteData = async (nomor) => {
  const [rows] = await db.query(
    `SELECT spg_nomor, spg_tanggal FROM tspk_gudang WHERE spg_nomor = ?`,
    [nomor],
  );
  if (rows.length === 0) throw new Error("Data SPK Gudang tidak ditemukan.");

  // Gate 1: sudah dipakai di transaksi Mutasi Produksi
  const used = await isUsedInProduction(nomor);
  if (used) {
    throw new Error("SPK tsb sudah di pakai untuk transaksi.");
  }

  // Gate 2: periode transaksi sudah tutup buku
  // Replikasi: zDay:=ztglclose; zMonth:=bulan(spg_tanggal)+1; ...
  //            if cgetcurdate > EncodeDate(zYear,zMonth,zDay) then blocked
  const boundary = await getTanggalTutupBukuUntukTanggal(rows[0].spg_tanggal);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (today > boundary) {
    throw new Error("Transaksi tsb sudah close. Tidak bisa dihapus.");
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    // Catatan: Delphi asli cuma delete header, detail item gak pernah
    // dihapus (kemungkinan bug lama). Di sini detail dihapus dulu biar
    // gak ninggalin data nyangkut — konfirmasi kalau harus persis Delphi.
    await conn.query(`DELETE FROM tspk_gudangitem WHERE spgi_nomor = ?`, [
      nomor,
    ]);
    await conn.query(`DELETE FROM tspk_gudang WHERE spg_nomor = ?`, [nomor]);
    await conn.commit();
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
};

// --- EXPORT HEADER (semua row browse sesuai filter) ---
const getExportHeader = async (filters) => {
  return getBrowseList(filters);
};

// --- EXPORT DETAIL (semua item dalam rentang periode) ---
const getExportDetail = async (filters) => {
  const { startDate, endDate } = filters;
  const [rows] = await db.query(
    `SELECT
       i.spgi_nomor   AS Nomor,
       i.spgi_spk     AS Spk,
       i.spgi_nama    AS NamaSpk,
       i.spgi_jumlah  AS Qty,
       i.spgi_kodek   AS KodeKaosan
     FROM tspk_gudangitem i
     INNER JOIN tspk_gudang s ON s.spg_nomor = i.spgi_nomor
     WHERE s.spg_tanggal >= ? AND s.spg_tanggal < DATE_ADD(?, INTERVAL 1 DAY)
     ORDER BY i.spgi_nomor, i.spgi_urut`,
    [startDate, endDate],
  );
  return rows;
};

module.exports = {
  getBrowseList,
  getDetail,
  isUsedInProduction,
  deleteData,
  getExportHeader,
  getExportDetail,
};
