const db = require("../../../config/database");

// Kode perusahaan dari nomor order, untuk dicocokkan dengan kode di nomor SJ.
// Format baru "SPK-MD-KO-000014" → MD ; format lama "KP-KO-002727" → KP.
const KODE_PERUSH_ORDER = (col) =>
  `IF(${col} REGEXP '^(SPK|SO)-', MID(${col}, INSTR(${col}, '-') + 1, 2), LEFT(${col}, 2))`;

/**
 * Posisi SPK/SO yang sudah dikirim (SJ approved) tetapi qty kirim kumulatif
 * s.d. endDate masih melebihi qty invoice kumulatif s.d. endDate.
 *  - endDate    : default hari ini (zona Asia/Jakarta)
 *  - perusahaan : opsional, kode perusahaan (mis. KP, MD)
 */
const getSpkTerkirimBelumInvoice = async (query) => {
  const { endDate, perusahaan } = query;
  const dEnd =
    endDate ||
    new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Jakarta" });

  const perush = perusahaan ? " AND MID(h.sj_nomor, 4, 2) = ?" : "";

  // Urutan parameter harus sama dengan urutan "?" di SQL di bawah
  const params = [dEnd, dEnd];
  if (perusahaan) params.push(perusahaan);
  params.push(dEnd);

  const sql = `
    SELECT
      k.Nomor                                         AS Nomor,
      k.NoSPK                                         AS NoSPK,
      IF(so.so_nomor IS NOT NULL, 'SO', 'SPK')        AS Jenis,
      COALESCE(so.so_nama, s.spk_nama)                AS Nama,
      COALESCE(so.so_cus_kode, s.spk_cus_kode)        AS CusKode,
      c.cus_nama                                      AS Customer,
      ${KODE_PERUSH_ORDER("k.Nomor")}                 AS Perusahaan,
      DATE_FORMAT(COALESCE(so.so_tanggal, s.spk_tanggal), '%Y-%m-%d') AS TglOrder,
      k.QtyKirim                                      AS QtyKirim,
      IFNULL(i.QtyInvoice, 0)                         AS QtyInvoice,
      k.QtyKirim - IFNULL(i.QtyInvoice, 0)            AS QtyBelumDitagih,
      DATE_FORMAT(k.TglKirimTerakhir, '%Y-%m-%d')     AS TglKirimTerakhir,
      DATEDIFF(?, k.TglKirimTerakhir)                 AS UmurHari,
      IF(IFNULL(i.QtyInvoice, 0) = 0, 'BELUM', 'SEBAGIAN') AS Status
      FROM (
      SELECT COALESCE(sox.so_nomor, t.spk) AS Nomor,
             GROUP_CONCAT(DISTINCT t.spk ORDER BY t.spk SEPARATOR ', ') AS NoSPK,
             SUM(t.qty) AS QtyKirim,
             MAX(t.tgl) AS TglKirimTerakhir
      FROM (
        SELECT d.sjd_spk_nomor AS spk,
               SUM(d.sjd_jumlah) AS qty,
               MAX(h.sj_tanggal) AS tgl
        FROM tsj_dtl d
        INNER JOIN tsj_hdr h ON h.sj_nomor = d.sjd_sj_nomor
        WHERE h.sj_approve <> 2
          AND h.sj_tanggal < DATE_ADD(?, INTERVAL 1 DAY)
          ${perush}
          AND ${KODE_PERUSH_ORDER("d.sjd_spk_nomor")} = MID(h.sj_nomor, 4, 2)
        GROUP BY d.sjd_spk_nomor
      ) t
      LEFT JOIN tspk sp ON sp.spk_nomor = t.spk
      LEFT JOIN tsalesorder sox ON sox.so_nomor = sp.spk_so_ref AND sox.so_aktif = 'Y'
      GROUP BY COALESCE(sox.so_nomor, t.spk)
    ) k
    LEFT JOIN (
      SELECT COALESCE(soi.so_nomor, t.spk) AS Nomor,
             SUM(t.qty) AS QtyInvoice
      FROM (
        SELECT d.invd_spk_nomor AS spk,
               SUM(d.invd_jumlah) AS qty
        FROM tinv_dtl d
        INNER JOIN tinv_hdr h ON h.inv_nomor = d.invd_inv_nomor
        WHERE h.inv_status_otomatis = 0
          AND h.inv_tanggal < DATE_ADD(?, INTERVAL 1 DAY)
        GROUP BY d.invd_spk_nomor
      ) t
      LEFT JOIN tspk spi ON spi.spk_nomor = t.spk
      LEFT JOIN tsalesorder soi ON soi.so_nomor = spi.spk_so_ref AND soi.so_aktif = 'Y'
      GROUP BY COALESCE(soi.so_nomor, t.spk)
    ) i ON i.Nomor = k.Nomor
    LEFT JOIN tsalesorder so ON so.so_nomor = k.Nomor AND so.so_aktif = 'Y'
    LEFT JOIN tspk s ON s.spk_nomor = CONVERT(k.Nomor USING latin1) AND s.spk_aktif = 'Y'
    LEFT JOIN tcustomer c ON c.cus_kode = COALESCE(so.so_cus_kode, s.spk_cus_kode)
    WHERE k.QtyKirim > IFNULL(i.QtyInvoice, 0)
      AND (so.so_nomor IS NOT NULL OR s.spk_nomor IS NOT NULL)
    ORDER BY k.TglKirimTerakhir DESC, k.Nomor DESC
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
