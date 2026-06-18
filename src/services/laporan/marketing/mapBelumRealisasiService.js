const db = require("../../../config/database");

const getBrowse = async (query) => {
  const { startDate, endDate, sortByNominal } = query;

  const today = new Date().toISOString().substring(0, 10);
  const dStart = startDate || today;
  const dEnd = endDate || today;

  // Default sort: tanggal ASC, bisa diswitch ke nominal DESC
  const orderBy =
    sortByNominal === "1"
      ? "ORDER BY Nominal DESC, s.MSPK_Nomor ASC"
      : "ORDER BY s.Mspk_Tanggal ASC, s.MSPK_Nomor ASC";

  const sql = `
    SELECT
      s.MSPK_Nomor                                AS Nomor,
      s.Mspk_nama                                 AS Nama,
      DATE_FORMAT(s.Mspk_Tanggal, '%d-%m-%Y')     AS Tanggal,
      MONTH(s.Mspk_Tanggal)                       AS Bulan,
      YEAR(s.Mspk_Tanggal)                        AS Tahun,
      v.Divisi                                     AS Divisi,
      s.mspk_tipe                                  AS Tipe,
      a.sal_nama                                   AS Sales,
      s.Mspk_cus_kode                              AS Kdcus,
      c.Cus_nama                                   AS Customer,
      IF(s.mspk_divisi = 1,
        (s.Mspk_rencana_order * s.mspk_panjang),
        IF(s.mspk_divisi = 5,
          (s.Mspk_rencana_order * s.mspk_lebar),
          0)
      )                                            AS QtyMeter,
      s.Mspk_jumlah                                AS Qty,
      s.Mspk_rencana_order                         AS QtyOrder,
      s.Mspk_harga                                 AS Harga,
      (s.Mspk_rencana_order * s.Mspk_harga)       AS Nominal,
      COUNT(s.MSPK_Nomor)                          AS Jumlah_MAP
    FROM tmemospk s
    LEFT JOIN tdivisi v   ON v.kode      = s.mspk_divisi
    LEFT JOIN tsales a    ON a.sal_kode  = s.mspk_sal_kode
    LEFT JOIN tcustomer c ON c.Cus_kode  = s.Mspk_cus_kode
    WHERE IFNULL(s.Mspk_rencana_order, 0) > 0
      AND s.mspk_aktif  = 'Y'
      AND s.mspk_close  = 'N'
      AND s.MSPK_Nomor NOT IN (
        SELECT m.spk_memo FROM tspk m
        WHERE m.spk_aktif = 'Y' AND m.spk_memo <> ''
      )
      AND s.Mspk_Tanggal >= ?
      AND s.Mspk_Tanggal <= ?
    GROUP BY s.MSPK_Nomor
    ${orderBy}
  `;

  const [rows] = await db.query(sql, [dStart, dEnd]);
  return rows;
};

module.exports = { getBrowse };
