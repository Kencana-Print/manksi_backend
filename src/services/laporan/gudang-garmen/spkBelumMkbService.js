const db = require("../../../config/database");
/**
 * MENGAMBIL DAFTAR SO YANG BELUM ADA MKB
 * Sebelumnya baca dari tspk (SPK PPIC) — diganti ke tsalesorder (SO),
 * karena MKB sekarang bisa mereferensikan nomor SO langsung (bukan
 * cuma SPK PPIC turunannya). "Belum ada MKB" dicek terhadap KEDUA
 * kemungkinan key: nomor SO itu sendiri, ATAU SPK PPIC turunannya
 * (kalau SO ini sudah punya SPK PPIC dan MKB dibuat atas nama SPK
 * PPIC tsb) — sama pola dengan fix inputPlanningSpkService sebelumnya.
 */
const getSoBelumMkb = async (query) => {
  const { startDate } = query;
  const dStart =
    startDate ||
    new Date(new Date().getFullYear(), new Date().getMonth(), 1)
      .toISOString()
      .substring(0, 10);
  const sql = `
    SELECT 
      s.so_nomor AS SPK,
      DATE_FORMAT(s.so_tanggal, "%d-%m-%Y") AS Tanggal,
      DATE_FORMAT(s.so_dateline, "%d-%m-%Y") AS Dateline,
      s.so_divisi AS Divisi,
      s.so_tipe AS Tipe,
      s.so_cab AS spk_cab,
      s.so_workshop AS Workshop,
      s.so_nama AS NamaSpk,
      s.so_jumlah AS Jumlah,
      s.so_ukuran AS ukuran,
      s.so_kain AS Kain,
      s.so_finishing AS Finishing
    FROM tsalesorder s
    WHERE s.so_aktif = "Y" 
      AND s.so_close = 0 
      AND s.so_cmo <> "" 
      AND s.so_jo_kode NOT IN ("BR", "SB", "SD", "PL")
      AND s.so_divisi IN (3, 4, 6) 
      AND s.so_tanggal >= ?
      -- ⚠️ FIX: cek MKB terhadap SO itu sendiri MAUPUN SPK PPIC
      -- turunannya (spk_so_ref = so_nomor) — MKB bisa dibuat atas
      -- nama salah satu dari keduanya, tergantung alur user saat
      -- membuat MKB (langsung dari SO, atau dari SPK PPIC turunan).
      AND NOT EXISTS (
        SELECT 1 FROM tmkb_hdr h
        WHERE h.MKB_SPK_NOMOR = s.so_nomor
           OR h.MKB_SPK_NOMOR IN (
                SELECT ppic.spk_nomor FROM tspk ppic
                WHERE ppic.spk_so_ref = s.so_nomor AND ppic.spk_is_so = 0
              )
      )
    ORDER BY s.so_tanggal ASC
  `;
  const [rows] = await db.query(sql, [dStart]);
  return rows;
};
module.exports = {
  getSoBelumMkb,
};
