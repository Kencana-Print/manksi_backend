const db = require("../../../config/database");

// Kode perusahaan dari nomor order, untuk dicocokkan dengan kode di nomor SJ.
// Format baru "SPK-MD-KO-000014" → MD ; format lama "KP-KO-002727" → KP.
const KODE_PERUSH_ORDER = (col) =>
  `IF(${col} REGEXP '^(SPK|SO)-', MID(${col}, INSTR(${col}, '-') + 1, 2), LEFT(${col}, 2))`;

/**
 * SPK/SO yang punya kiriman (SJ approved) dalam periode [startDate, endDate]
 * dan qty kirim kumulatif-nya (s.d. endDate) masih melebihi qty invoice kumulatif.
 *  - endDate    : default hari ini
 *  - startDate  : default tanggal 1 bulan dari endDate
 *  - perusahaan : opsional, kode perusahaan (mis. KP, MD)
 */
const getSpkTerkirimBelumInvoice = async (query) => {
  const { endDate, startDate, perusahaan } = query;
  const dEnd = endDate || new Date().toISOString().substring(0, 10);
  const dStart = startDate || `${dEnd.substring(0, 7)}-01`;

  const perushOuter = perusahaan ? " AND MID(h.sj_nomor, 4, 2) = ?" : "";
  const perushInner = perusahaan ? " AND MID(h2.sj_nomor, 4, 2) = ?" : "";

  // Urutan parameter harus sama dengan urutan "?" di SQL di bawah
  const params = [dEnd, dEnd];
  if (perusahaan) params.push(perusahaan);
  params.push(dStart, dEnd);
  if (perusahaan) params.push(perusahaan);
  params.push(dEnd);

  const sql = `
    SELECT
      k.Nomor                                         AS Nomor,
      IF(s.spk_nomor IS NOT NULL, 'SPK', 'SO')        AS Jenis,
      COALESCE(s.spk_nama, so.so_nama)                AS Nama,
      COALESCE(s.spk_cus_kode, so.so_cus_kode)        AS CusKode,
      c.cus_nama                                      AS Customer,
      ${KODE_PERUSH_ORDER("k.Nomor")}                 AS Perusahaan,
      DATE_FORMAT(COALESCE(s.spk_tanggal, so.so_tanggal), '%Y-%m-%d') AS TglOrder,
      k.QtyKirim                                      AS QtyKirim,
      IFNULL(i.QtyInvoice, 0)                         AS QtyInvoice,
      k.QtyKirim - IFNULL(i.QtyInvoice, 0)            AS QtyBelumDitagih,
      DATE_FORMAT(k.TglKirimTerakhir, '%Y-%m-%d')     AS TglKirimTerakhir,
      DATEDIFF(?, k.TglKirimTerakhir)                 AS UmurHari,
      IF(IFNULL(i.QtyInvoice, 0) = 0, 'BELUM', 'SEBAGIAN') AS Status
    FROM (
      SELECT d.sjd_spk_nomor AS Nomor,
             SUM(d.sjd_jumlah) AS QtyKirim,
             MAX(h.sj_tanggal) AS TglKirimTerakhir
      FROM tsj_dtl d
      INNER JOIN tsj_hdr h ON h.sj_nomor = d.sjd_sj_nomor
      WHERE h.sj_approve <> 2
        AND h.sj_tanggal < DATE_ADD(?, INTERVAL 1 DAY)
        ${perushOuter}
        AND ${KODE_PERUSH_ORDER("d.sjd_spk_nomor")} = MID(h.sj_nomor, 4, 2)
        AND d.sjd_spk_nomor IN (
          SELECT d2.sjd_spk_nomor
          FROM tsj_dtl d2
          INNER JOIN tsj_hdr h2 ON h2.sj_nomor = d2.sjd_sj_nomor
          WHERE h2.sj_approve <> 2
            AND h2.sj_tanggal >= ?
            AND h2.sj_tanggal < DATE_ADD(?, INTERVAL 1 DAY)
            ${perushInner}
        )
      GROUP BY d.sjd_spk_nomor
    ) k
    LEFT JOIN (
      SELECT d.invd_spk_nomor AS Nomor, SUM(d.invd_jumlah) AS QtyInvoice
      FROM tinv_dtl d
      INNER JOIN tinv_hdr h ON h.inv_nomor = d.invd_inv_nomor
      WHERE h.inv_status_otomatis = 0
        AND h.inv_tanggal < DATE_ADD(?, INTERVAL 1 DAY)
      GROUP BY d.invd_spk_nomor
    ) i ON i.Nomor = k.Nomor
    LEFT JOIN tspk s ON s.spk_nomor = k.Nomor AND s.spk_aktif = 'Y'
    LEFT JOIN tsalesorder so ON so.so_nomor = k.Nomor AND so.so_aktif = 'Y'
    LEFT JOIN tcustomer c ON c.cus_kode = COALESCE(s.spk_cus_kode, so.so_cus_kode)
    WHERE k.QtyKirim > IFNULL(i.QtyInvoice, 0)
      AND (s.spk_nomor IS NOT NULL OR so.so_nomor IS NOT NULL)
    ORDER BY UmurHari DESC, k.Nomor ASC
  `;

  const [rows] = await db.query(sql, params);
  return rows.map((r) => ({
    ...r,
    QtyKirim: Number(r.QtyKirim) || 0,
    QtyInvoice: Number(r.QtyInvoice) || 0,
    QtyBelumDitagih: Number(r.QtyBelumDitagih) || 0,
    UmurHari: Number(r.UmurHari) || 0,
  }));
};

module.exports = { getSpkTerkirimBelumInvoice };
