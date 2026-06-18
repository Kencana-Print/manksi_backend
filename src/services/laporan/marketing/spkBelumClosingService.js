const db = require("../../../config/database");

const getBrowse = async (query) => {
  const { startDate, endDate, sortByNominal } = query;

  const today = new Date().toISOString().substring(0, 10);
  const dStart = startDate || today;
  const dEnd = endDate || today;

  const orderBy =
    sortByNominal === "1"
      ? "ORDER BY Nominal_Order DESC, s.spk_nomor ASC"
      : "ORDER BY s.spk_Tanggal ASC, s.spk_nomor ASC";

  const sql = `
    SELECT
      s.spk_nomor                                     AS Nomor,
      s.spk_nama                                      AS Nama,
      DATE_FORMAT(s.spk_Tanggal, '%d-%m-%Y')          AS Tanggal,
      MONTH(s.spk_Tanggal)                            AS Bulan,
      YEAR(s.spk_Tanggal)                             AS Tahun,
      v.Divisi                                         AS Divisi,
      a.sal_nama                                       AS Sales,
      s.spk_cus_kode                                   AS Kdcus,
      c.Cus_nama                                       AS Customer,
      (s.spk_jumlah * s.spk_harga)                    AS Nominal_Order,
      (s.spk_jumlah_kirim * s.spk_harga)              AS Nominal_Kirim,
      (s.spk_jumlah_jadi * s.spk_harga)               AS Nominal_Jadi,
      (s.spk_harga * (s.spk_jumlah - s.spk_jumlah_kirim)) AS Nominal_Selisih,
      s.spk_jumlah                                     AS QtyOrder,
      s.spk_jumlah_kirim                               AS QtyKirim,
      s.spk_jumlah_jadi                                AS QtyJadi,
      COUNT(s.spk_nomor)                               AS Jumlah_SPK
    FROM tspk s
    LEFT JOIN tdivisi v    ON v.kode     = s.spk_divisi
    LEFT JOIN tsales a     ON a.sal_kode = s.spk_sal_kode
    LEFT JOIN tcustomer c  ON c.Cus_kode = s.spk_cus_kode
    WHERE s.spk_aktif = 'Y'
      AND (s.spk_jumlah - s.spk_jumlah_kirim) > 0
      AND s.spk_Tanggal >= ?
      AND s.spk_Tanggal <= ?
    GROUP BY s.spk_nomor
    ${orderBy}
  `;

  const [rows] = await db.query(sql, [dStart, dEnd]);
  return rows;
};

module.exports = { getBrowse };
