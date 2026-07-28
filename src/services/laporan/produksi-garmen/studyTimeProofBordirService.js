const db = require("../../../config/database");

// ─────────────────────────────────────────────
// Replikasi ufrmLapProof4.btnExcelClick — tanpa temp table & string-
// concat manual (sumber bug "#21S01 Column count doesn't match value
// count" di kasus JAHIT sebelumnya). Struktur sama dengan
// studyTimeProofJahitService: GROUP BY tanggal+spk, SUM(pfd_waktu).
// ⚠️ Delphi HITUNG SUM(pfd_step_jahit) sebagai `step` di query awal &
// simpan ke temp table, TAPI kolom itu TIDAK diikutkan di query final
// buat export (cuma tanggal,spk,nama,jenis,warna,waktubordir,poj) —
// kemungkinan sisa copy-paste dari versi JAHIT yang gak dibersihin.
// Kolom "Jumlah Proses Step" karena itu SENGAJA tidak ada di sini,
// beda dari versi Jahit yang menampilkannya.
// ⚠️ m.Mspk_nama, d.pfd_jenis_kain, d.pfd_warna_kain TIDAK ada di
// GROUP BY asli Delphi — direplikasi pakai MAX() (server ini belum
// support ANY_VALUE, dikonfirmasi dari kasus Jahit sebelumnya).
// ─────────────────────────────────────────────
const getBrowse = async (startDate, endDate, cab = "P04") => {
  let where = `
    WHERE h.pf_lini = 'BORDIR'
      AND h.pf_tanggal >= ? AND h.pf_tanggal <= ?
  `;
  const params = [startDate, endDate];

  if (cab && cab !== "ALL") {
    where += ` AND h.pf_cab = ?`;
    params.push(cab);
  }

  const sql = `
    SELECT
      h.pf_tanggal AS tanggal,
      h.pf_spk_nomor AS spk,
      MAX(m.Mspk_nama)      AS namaOrder,
      MAX(d.pfd_jenis_kain) AS jenisKain,
      MAX(d.pfd_warna_kain) AS warnaKain,
      SUM(d.pfd_waktu)      AS menitPerPc,
      CASE WHEN SUM(d.pfd_waktu) = 0 THEN NULL
           ELSE (60 / SUM(d.pfd_waktu)) END AS pcsPerJam
    FROM tproofgarmen_hdr h
    INNER JOIN tproofgarmen_dtl d ON d.pfd_nomor = h.pf_nomor
    LEFT JOIN tmemospk m ON m.MSPK_Nomor = h.pf_spk_nomor
    ${where}
    GROUP BY h.pf_tanggal, h.pf_spk_nomor
    ORDER BY h.pf_tanggal, h.pf_spk_nomor
  `;

  const [rows] = await db.query(sql, params);

  return rows.map((r) => ({
    ...r,
    menitPerPc: r.menitPerPc !== null ? Number(r.menitPerPc) : null,
    pcsPerJam: r.pcsPerJam !== null ? Number(r.pcsPerJam) : null,
  }));
};

module.exports = {
  getBrowse,
};
