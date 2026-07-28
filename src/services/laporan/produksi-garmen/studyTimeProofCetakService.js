const db = require("../../../config/database");

// ─────────────────────────────────────────────
// Replikasi ufrmLapProof3.btnExcelClick — TAPI tanpa temp table &
// string-concat manual (sumber bug "#21S01 Column count doesn't match
// value count" di kasus JAHIT sebelumnya, dan berpotensi sama di sini).
// ⚠️ Beda dari studyTimeProofJahitService: CETAK TIDAK di-GROUP BY di
// Delphi asli — insert ke temp table 1 baris per komponen (pfd_kode),
// bukan teragregasi per SPK. Jadi di sini query-nya flat murni, tanpa
// SUM/MAX/GROUP BY sama sekali — 1 row hasil = 1 row response.
// Kolom "Nama Komponen" (bhn_name) via join tbahan ON bhn_kode=pfd_kode
// — sama seperti Standar Babaran Proof, alias join ini yang di Delphi
// namanya "Nama Bahan" tapi isinya nama komponen produksi.
// ─────────────────────────────────────────────
const getBrowse = async (startDate, endDate, cab = "P04") => {
  let where = `
    WHERE h.pf_lini = 'CETAK'
      AND h.pf_tanggal >= ? AND h.pf_tanggal <= ?
  `;
  const params = [startDate, endDate];

  if (cab && cab !== "ALL") {
    where += ` AND h.pf_cab = ?`;
    params.push(cab);
  }

  const sql = `
    SELECT
      h.pf_tanggal        AS tanggal,
      h.pf_spk_nomor       AS spk,
      d.pfd_kode           AS pfdKode,
      m.Mspk_nama          AS namaOrder,
      d.pfd_jenis_kain     AS jenisKain,
      d.pfd_warna_kain     AS warnaKain,
      d.pfd_waktu          AS menitPerPc,
      b.bhn_name           AS komponen,
      CASE WHEN d.pfd_waktu = 0 OR d.pfd_waktu IS NULL THEN NULL
           ELSE (60 / d.pfd_waktu) END AS pcsPerJam
    FROM tproofgarmen_hdr h
    INNER JOIN tproofgarmen_dtl d ON d.pfd_nomor = h.pf_nomor
    LEFT JOIN tmemospk m ON m.MSPK_Nomor = h.pf_spk_nomor
    LEFT JOIN tbahan b ON b.bhn_kode = d.pfd_kode
    ${where}
    ORDER BY h.pf_tanggal, h.pf_spk_nomor, d.pfd_kode
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
