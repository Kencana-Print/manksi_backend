const db = require("../../../config/database");

// ─────────────────────────────────────────────
// MASTER — browse SPK aktif divisi garmen (3,4,6) dalam periode.
// Flat query, tidak ada detail/master-detail.
// ─────────────────────────────────────────────
const getBrowse = async (startDate, endDate) => {
  const sql = `
    SELECT
      s.spk_nomor AS Nomor,
      DATE_FORMAT(s.spk_tanggal, '%Y-%m-%d') AS Tanggal,
      DATE_FORMAT(s.spk_dateline, '%Y-%m-%d') AS Dateline,
      s.spk_memo AS MAP,
      s.spk_nomor_po AS PO,
      s.spk_tipe AS Tipe,
      s.spk_divisi AS Divisi,
      s.spk_cab AS Cab,
      s.spk_workshop AS Workshop,
      j.jo_nama AS JoNama,
      s.spk_nama AS NamaSPK,
      s.spk_jumlah AS Jumlah,
      s.spk_ukuran AS Ukuran,
      s.spk_kain AS Kain,
      s.spk_gramasi AS Gramasi,
      s.spk_finishing AS Finishing,
      s.spk_keterangan AS Keterangan
    FROM tspk s
    LEFT JOIN tjenisorder j ON j.jo_kode = s.spk_jo_kode
    WHERE s.spk_divisi IN (3, 4, 6)
      AND s.spk_cmo <> ''
      AND s.spk_aktif = 'Y'
      AND s.spk_tanggal >= ? AND s.spk_tanggal <= ?
    ORDER BY s.spk_nama
  `;
  const [rows] = await db.query(sql, [startDate, endDate]);
  return rows;
};

module.exports = {
  getBrowse,
};
