const db = require("../../../config/database");

/**
 * MENGAMBIL DAFTAR MAP vs SPK
 */
const getMapVsSpk = async (query) => {
  const { startDate, endDate, divisi } = query;

  // Default filter tanggal: awal bulan sampai hari ini
  const dStart = startDate || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().substring(0, 10);
  const dEnd = endDate || new Date().toISOString().substring(0, 10);

  let filterDivisi = "";
  const params = [dStart, dEnd];

  // Memisahkan logika divisi (karena di Frontend dikirim '0' untuk ALL)
  if (divisi && divisi !== "0") {
    filterDivisi = " AND mspk_divisi = ? ";
    params.push(divisi);
  }

  const sql = `
    SELECT 
      m.mspk_nomor AS Nomor,
      DATE_FORMAT(m.mspk_tanggal, "%d-%m-%Y") AS Tanggal,
      v.Divisi AS Divisi,
      c.cus_nama AS NamaCustomer,
      m.mspk_nama AS Nama,
      m.mspk_ukuran AS Ukuran,
      m.mspk_jo_kode AS Jenis,
      m.mspk_kain AS Kain,
      m.mspk_jumlah AS Jumlah,
      m.mspk_jumlah_kirim AS Kirim,
      DATE_FORMAT(m.mspk_dateline, "%d-%m-%Y") AS Dateline,
      s.sal_nama AS Sales,
      m.mspk_pen_nomor AS No_Penawaran,
      spk.spk_nomor AS SPK,
      spk.spk_nama AS Nama_SPK,
      IF(spk.spk_nomor <> "", spk.spk_harga, m.mspk_harga) AS Harga,
      IF(spk.spk_nomor <> "", spk.spk_jumlah, m.mspk_rencana_order) AS Jumlah_Order,
      IF(spk.spk_nomor <> "", (spk.spk_harga * spk.spk_jumlah), (m.mspk_harga * m.mspk_rencana_order)) AS Nilai
    FROM tmemospk m
    INNER JOIN tcustomer c ON m.mspk_cus_kode = c.cus_kode
    LEFT JOIN tsales s ON s.sal_kode = m.mspk_sal_kode
    LEFT JOIN tspk spk ON spk.spk_memo = m.mspk_nomor AND spk.spk_aktif = 'Y'
    LEFT JOIN tdivisi v ON v.kode = m.mspk_divisi
    WHERE m.mspk_tanggal >= ? AND m.mspk_tanggal <= ?
      ${filterDivisi}
    ORDER BY m.mspk_tanggal ASC, m.mspk_nomor ASC
  `;

  const [rows] = await db.query(sql, params);
  return rows;
};

module.exports = {
  getMapVsSpk
};