const db = require("../../config/database");

const getBrowse = async (tglAwal, tglAkhir, canLihatBeli = false) => {
  // ⚠️ Kolom Jumlah/Tarif/Total digated flag lihatBeli (user_lihat_beli)
  // — replikasi `if zLihatBeli=1` di ufrmApprovePO.btnRefreshClick.
  const beliCols = canLihatBeli
    ? `h.pojh_jumlah AS Jumlah, h.pojh_tarif AS Tarif, (h.pojh_jumlah * h.pojh_tarif) AS Total,`
    : `NULL AS Jumlah, NULL AS Tarif, NULL AS Total,`;

  const [rows] = await db.query(
    `SELECT DISTINCT
       h.pojh_nomor        AS Nomor,
       DATE_FORMAT(h.pojh_tanggal, '%Y-%m-%d') AS Tanggal,
       h.pojh_keterangan   AS Keterangan,
       h.pojh_sup_kode     AS KodeSupplier,
       s.sup_nama          AS Supplier,
       j.jasa_nama         AS Jasa,
       ${beliCols}
       IF(h.pojh_cetak=1,'Sudah','Belum') AS Approve
     FROM tpojasa_hdr h
     INNER JOIN tpojasa_dtl  d ON d.pojd_pojh_nomor = h.pojh_nomor
     INNER JOIN tbahan       b ON b.bhn_kode = d.pojd_bhn_kode
     LEFT  JOIN tsupplier    s ON s.sup_kode = h.pojh_sup_kode
     LEFT  JOIN tjasa        j ON j.jasa_kode = h.pojh_jasa_kode
     WHERE h.pojh_tanggal >= ?
       AND h.pojh_tanggal <= ?
       AND h.pojh_jasa_kode = 'J08'
     ORDER BY h.pojh_nomor, h.pojh_tanggal`,
    [tglAwal, tglAkhir],
  );
  return rows;
};

const getDetail = async (nomor, canLihatBeli = false) => {
  // ⚠️ FIXED (bukan replikasi): source Delphi SQLDetail TIDAK nge-gate
  // pojd_harga (HargaBeli) sama sekali — kemungkinan besar oversight,
  // karena master-nya jelas nge-gate Jumlah/Tarif/Total dengan flag
  // yang sama. Kalau detail dibiarkan terbuka, gating di master jadi
  // percuma (user tetap bisa lihat harga lewat expand row). Digating
  // konsisten di sini demi keamanan — beri tahu jika ternyata memang
  // sengaja dibiarkan terbuka di source asli.
  const hargaCol = canLihatBeli
    ? "d.pojd_harga AS HargaBeli"
    : "NULL AS HargaBeli";

  const [rows] = await db.query(
    `SELECT
       h.pojh_nomor        AS Nomor,
       d.pojd_bhn_kode     AS Kode,
       b.bhn_name          AS Nama,
       d.pojd_jumlah       AS Jml,
       d.pojd_jumlah_terima AS Terima,
       ${hargaCol}
     FROM tpojasa_hdr h
     INNER JOIN tpojasa_dtl d ON d.pojd_pojh_nomor = h.pojh_nomor
     INNER JOIN tbahan      b ON b.bhn_kode = d.pojd_bhn_kode
     WHERE h.pojh_nomor = ?
     ORDER BY d.pojd_bhn_kode`,
    [nomor],
  );
  return rows;
};

const toggleApprove = async (nomor) => {
  const [[row]] = await db.query(
    `SELECT pojh_cetak FROM tpojasa_hdr WHERE pojh_nomor = ?`,
    [nomor],
  );
  if (!row) throw new Error("Data tidak ditemukan.");

  const newVal = row.pojh_cetak === 1 ? 0 : 1;
  await db.query(`UPDATE tpojasa_hdr SET pojh_cetak = ? WHERE pojh_nomor = ?`, [
    newVal,
    nomor,
  ]);
  return {
    nomor,
    pojh_cetak: newVal,
    status: newVal === 1 ? "Sudah" : "Belum",
  };
};

module.exports = { getBrowse, getDetail, toggleApprove };
