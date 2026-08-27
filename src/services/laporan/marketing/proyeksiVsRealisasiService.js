const db = require("../../../config/database");

// ─────────────────────────────────────────────────────────
// Replikasi ufrmBrowseProyeksi.btnRefreshClick — direstrukturisasi
// dari CROSS JOIN tcustomer×tjenisorder jadi enumerasi pasangan
// (cus_kode, jo_kode) yg beneran punya transaksi.
//
// Sumber data MURNI tsalesorder — tspk (SPK/SO format lama) SENGAJA
// TIDAK disertakan. Laporan ini jadi hanya mencakup data sejak
// tsalesorder mulai dipakai, bukan histori penuh.
// ─────────────────────────────────────────────────────────

const buildB = (startDate) => ({
  sql: `
    SELECT mspk_cus_kode AS cus_kode, mspk_jo_kode AS jo_kode,
      SUM(mspk_rencana_order * mspk_harga) AS total_memo
    FROM tmemospk
    WHERE mspk_tanggal >= DATE_SUB(?, INTERVAL 90 DAY)
      AND mspk_nomor NOT IN (
        SELECT so_memo FROM tsalesorder
        WHERE so_aktif = 'Y' AND so_tanggal < ?
      )
    GROUP BY mspk_cus_kode, mspk_jo_kode
  `,
  params: [startDate, startDate],
});

const buildC = (startDate, endDate) => ({
  sql: `
    SELECT so_cus_kode AS cus_kode, so_jo_kode AS jo_kode,
      SUM(so_jumlah * so_harga) AS total_realisasi_memo
    FROM tsalesorder
    WHERE so_aktif = 'Y' AND so_tanggal >= ? AND so_tanggal <= ?
      AND so_memo IN (
        SELECT mspk_nomor FROM tmemospk
        WHERE mspk_tanggal >= DATE_SUB(?, INTERVAL 90 DAY)
      )
    GROUP BY so_cus_kode, so_jo_kode
  `,
  params: [startDate, endDate, startDate],
});

const buildD = (startDate, endDate) => ({
  sql: `
    SELECT so_cus_kode AS cus_kode, so_jo_kode AS jo_kode,
      SUM(so_jumlah * so_harga) AS total_realisasi_all
    FROM tsalesorder
    WHERE so_aktif = 'Y' AND so_tanggal >= ? AND so_tanggal <= ?
    GROUP BY so_cus_kode, so_jo_kode
  `,
  params: [startDate, endDate],
});

const getBrowse = async (startDate, endDate) => {
  const b1 = buildB(startDate);
  const c1 = buildC(startDate, endDate);
  const d1 = buildD(startDate, endDate);
  const b2 = buildB(startDate);
  const c2 = buildC(startDate, endDate);
  const d2 = buildD(startDate, endDate);

  const sql = `
    SELECT
      k.cus_kode AS CusKode, cu.cus_nama AS CusNama,
      k.jo_kode AS JoKode, jo.jo_nama AS JoNama,
      b.total_memo AS TotalMemo,
      c.total_realisasi_memo AS RealisasiMemo,
      d.total_realisasi_all AS RealisasiAll
    FROM (
      SELECT cus_kode, jo_kode FROM (${b1.sql}) b1 WHERE IFNULL(b1.total_memo, 0) > 0
      UNION
      SELECT cus_kode, jo_kode FROM (${c1.sql}) c1 WHERE IFNULL(c1.total_realisasi_memo, 0) > 0
      UNION
      SELECT cus_kode, jo_kode FROM (${d1.sql}) d1 WHERE IFNULL(d1.total_realisasi_all, 0) > 0
    ) k
    INNER JOIN tcustomer cu ON cu.cus_kode = k.cus_kode
    INNER JOIN tjenisorder jo ON jo.jo_kode = k.jo_kode
    LEFT JOIN (${b2.sql}) b ON b.cus_kode = k.cus_kode AND b.jo_kode = k.jo_kode
    LEFT JOIN (${c2.sql}) c ON c.cus_kode = k.cus_kode AND c.jo_kode = k.jo_kode
    LEFT JOIN (${d2.sql}) d ON d.cus_kode = k.cus_kode AND d.jo_kode = k.jo_kode
    ORDER BY k.cus_kode, k.jo_kode
  `;

  const params = [
    ...b1.params,
    ...c1.params,
    ...d1.params,
    ...b2.params,
    ...c2.params,
    ...d2.params,
  ];

  const [rows] = await db.query(sql, params);

  return rows.map((r) => ({
    ...r,
    TotalMemo: r.TotalMemo !== null ? Number(r.TotalMemo) : null,
    RealisasiMemo: r.RealisasiMemo !== null ? Number(r.RealisasiMemo) : null,
    RealisasiAll: r.RealisasiAll !== null ? Number(r.RealisasiAll) : null,
  }));
};

module.exports = {
  getBrowse,
};
