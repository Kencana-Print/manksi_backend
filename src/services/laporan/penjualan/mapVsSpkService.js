const db = require("../../../config/database");

/**
 * MENGAMBIL DAFTAR MAP vs SO vs SPK
 *
 * Perbandingan sekarang terhadap SO (bukan SPK legacy langsung),
 * mengikuti pola SO baru/lama di soService.getBrowseList:
 *   - SO baru  → tsalesorder
 *   - SO lama  → tspk dengan spk_is_so = 1
 * SPK (produksi turunan) tetap ditampilkan terpisah — itu tspk
 * dengan spk_is_so = 0, yang juga bisa merujuk MAP yang sama lewat
 * spk_memo.
 */
const getMapVsSpk = async (query) => {
  const { startDate, endDate, divisi } = query;

  // Default filter tanggal: awal bulan sampai hari ini
  // Pakai local date (WIB), JANGAN toISOString() — bisa mundur 1 hari
  // karena toISOString() mengonversi ke UTC.
  const toLocalDateStr = (date) => {
    const wibOffsetMs = 7 * 60 * 60 * 1000;
    const wibDate = new Date(date.getTime() + wibOffsetMs);
    const year = wibDate.getUTCFullYear();
    const month = String(wibDate.getUTCMonth() + 1).padStart(2, "0");
    const day = String(wibDate.getUTCDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  const now = new Date();
  const dStart =
    startDate || toLocalDateStr(new Date(now.getFullYear(), now.getMonth(), 1));
  const dEnd = endDate || toLocalDateStr(now);

  let filterDivisi = "";
  const params = [dStart, dEnd];

  if (divisi && divisi !== "0") {
    filterDivisi = " AND m.mspk_divisi = ? ";
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
      so.NomorSO AS NomorSO,
      so.NamaSO AS NamaSO,
      spk.spk_nomor AS SPK,
      spk.spk_nama AS Nama_SPK,
      IF(so.NomorSO IS NOT NULL, so.HargaSO,
        IF(spk.spk_nomor IS NOT NULL, spk.spk_harga, m.mspk_harga)) AS Harga,
      IF(so.NomorSO IS NOT NULL, so.JumlahSO,
        IF(spk.spk_nomor IS NOT NULL, spk.spk_jumlah, m.mspk_rencana_order)) AS Jumlah_Order,
      IF(so.NomorSO IS NOT NULL, (so.HargaSO * so.JumlahSO),
        IF(spk.spk_nomor IS NOT NULL, (spk.spk_harga * spk.spk_jumlah),
          (m.mspk_harga * m.mspk_rencana_order))) AS Nilai
    FROM tmemospk m
    INNER JOIN tcustomer c ON m.mspk_cus_kode = c.cus_kode
    LEFT JOIN tsales s ON s.sal_kode = m.mspk_sal_kode
    LEFT JOIN tdivisi v ON v.kode = m.mspk_divisi
    LEFT JOIN (
      SELECT so_nomor AS NomorSO, so_nama AS NamaSO, so_memo AS MemoSO,
             so_harga AS HargaSO, so_jumlah AS JumlahSO
      FROM tsalesorder
      UNION ALL
      SELECT spk_nomor AS NomorSO, spk_nama AS NamaSO, spk_memo AS MemoSO,
             spk_harga AS HargaSO, spk_jumlah AS JumlahSO
      FROM tspk
      WHERE spk_is_so = 1
    ) so ON so.MemoSO = m.mspk_nomor
    LEFT JOIN tspk spk
      ON spk.spk_memo = m.mspk_nomor
      AND spk.spk_aktif = 'Y'
      AND spk.spk_is_so = 0
    WHERE m.mspk_tanggal >= ? AND m.mspk_tanggal <= ?
      ${filterDivisi}
    ORDER BY m.mspk_tanggal ASC, m.mspk_nomor ASC
  `;

  const [rows] = await db.query(sql, params);
  return rows;
};

module.exports = {
  getMapVsSpk,
};
