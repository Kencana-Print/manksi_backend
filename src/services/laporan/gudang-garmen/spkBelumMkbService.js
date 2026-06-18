const db = require("../../../config/database");

/**
 * MENGAMBIL DAFTAR SPK YANG BELUM ADA MKB
 * Memfilter SPK aktif, belum close, punya CMO, bukan JO tertentu ("BR","SB","SD","PL"),
 * hanya untuk divisi (3,4,6), dan nomornya belum terdaftar di tmkb_hdr.
 */
const getSpkBelumMkb = async (query) => {
  const { startDate } = query;

  // Sesuai behavior ufrmCxBrowse, default biasanya awal bulan berjalan
  const dStart = startDate || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().substring(0, 10);

  const sql = `
    SELECT 
      s.spk_nomor AS SPK,
      DATE_FORMAT(s.spk_tanggal, "%d-%m-%Y") AS Tanggal,
      DATE_FORMAT(s.spk_dateline, "%d-%m-%Y") AS Dateline,
      s.spk_divisi AS Divisi,
      s.spk_tipe AS Tipe,
      s.spk_cab AS spk_cab,
      s.spk_workshop AS Workshop,
      s.spk_nama AS NamaSpk,
      s.spk_jumlah AS Jumlah,
      s.spk_ukuran AS ukuran,
      s.spk_kain AS Kain,
      s.spk_finishing AS Finishing
    FROM tspk s
    WHERE s.spk_aktif = "Y" 
      AND s.spk_close = 0 
      AND s.spk_cmo <> "" 
      AND s.spk_jo_kode NOT IN ("BR", "SB", "SD", "PL")
      AND s.spk_divisi IN (3, 4, 6) 
      AND s.spk_nomor NOT IN (
        SELECT h.MKB_SPK_NOMOR 
        FROM tmkb_hdr h 
        WHERE h.MKB_SPK_NOMOR <> ""
      )
      AND s.spk_tanggal >= ?
    ORDER BY s.spk_tanggal ASC
  `;

  const [rows] = await db.query(sql, [dStart]);
  return rows;
};

module.exports = {
  getSpkBelumMkb
};