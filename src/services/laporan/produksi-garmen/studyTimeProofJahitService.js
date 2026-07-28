const db = require("../../../config/database");

// ⚠️ m.Mspk_nama, d.pfd_jenis_kain, d.pfd_warna_kain TIDAK ada di
// GROUP BY asli Delphi (`GROUP BY tanggal,spk,lini`) — itu jalan
// karena MySQL non-strict mode ambil baris arbitrary dari grup.
// Direplikasi eksplisit pakai MAX() (bukan ANY_VALUE — server ini
// pakai versi MariaDB yang belum support ANY_VALUE, dikonfirmasi
// dari error "FUNCTION kencanaprint.ANY_VALUE does not exist").
// Match behavior asli: SPK dengan multi-komponen cuma nampilin 1
// jenis/warna kain representatif, bukan salah query kita.
const getBrowse = async (startDate, endDate, cab = "P04") => {
  let where = `
    WHERE h.pf_lini = 'JAHIT'
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
        SUM(d.pfd_step_jahit) AS jumlahStep,
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

  // mysql2 balikin SUM()/DECIMAL sebagai string — normalisasi
  return rows.map((r) => ({
    ...r,
    jumlahStep: r.jumlahStep !== null ? Number(r.jumlahStep) : null,
    menitPerPc: r.menitPerPc !== null ? Number(r.menitPerPc) : null,
    pcsPerJam: r.pcsPerJam !== null ? Number(r.pcsPerJam) : null,
  }));
};

module.exports = {
  getBrowse,
};
