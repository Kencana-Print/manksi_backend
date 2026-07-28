const db = require("../../../config/database");

// ─────────────────────────────────────────────
// Replikasi query ufrmLapProof (SQLMaster & export query — isinya sama,
// cuma beda alias kolom). pf_lini="POTONG" FIXED (bukan filter user).
// ⚠️ Alias asli Delphi "Nama Bahan" (b.Bhn_Name) sebenarnya berisi nama
// KOMPONEN (BADAN DEPAN, PASPOL, dst), bukan nama bahan/kain — lihat
// screenshot export, header kolomnya "KOMPONEN". Dinamai `komponen` di
// response ini, bukan `namaBahan`, supaya gak menyesatkan.
// `pfdKode` disertakan (dipakai Delphi buat ORDER BY & tie-break group)
// walau gak muncul di grid/export, berguna buat row-key + deteksi grup
// master-blank-repeat di frontend nanti.
// ─────────────────────────────────────────────
const getBrowse = async (startDate, endDate, cab = "P04") => {
  let where = `
    WHERE h.pf_lini = 'POTONG'
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
      m.Mspk_nama          AS namaOrder,
      b.Bhn_Name           AS komponen,
      d.pfd_jenis_kain     AS jenisKain,
      d.pfd_warna_kain     AS warnaKain,
      d.pfd_gramasi        AS gramasi,
      d.pfd_seting         AS setting,
      d.pfd_babaran        AS stdBabaran,
      m.Mspk_rencana_order AS rencanaOrder,
      IFNULL((m.Mspk_rencana_order / d.pfd_babaran), 0) AS kebutuhan,
      d.pfd_satuan         AS satuan,
      d.pfd_kode           AS pfdKode
    FROM tproofgarmen_hdr h
    INNER JOIN tproofgarmen_dtl d ON d.pfd_nomor = h.pf_nomor
    LEFT JOIN tmemospk m ON m.MSPK_Nomor = h.pf_spk_nomor
    LEFT JOIN tbahan b ON b.Bhn_kode = d.pfd_kode
    ${where}
    ORDER BY h.pf_tanggal, h.pf_spk_nomor, d.pfd_kode
  `;

  const [rows] = await db.query(sql, params);

  // mysql2 balikin DECIMAL/aggregate sebagai string — normalisasi ke Number
  return rows.map((r) => ({
    ...r,
    gramasi: r.gramasi !== null ? Number(r.gramasi) : null,
    stdBabaran: r.stdBabaran !== null ? Number(r.stdBabaran) : null,
    rencanaOrder: r.rencanaOrder !== null ? Number(r.rencanaOrder) : null,
    kebutuhan: Number(r.kebutuhan),
  }));
};

module.exports = {
  getBrowse,
};
