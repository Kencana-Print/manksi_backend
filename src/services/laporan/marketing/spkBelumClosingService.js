const db = require("../../../config/database");

// Cutoff migrasi SO baru — data SPK/SO dengan tanggal transaksi
// SETELAH cutoff ini hidup di tsalesorder (SO baru); SAMA DENGAN atau
// SEBELUM cutoff masih hidup di tspk (data lama pre-migrasi).
const SO_CUTOFF = "2026-08-06";

const getBrowse = async (query) => {
  const { startDate, endDate, sortByNominal } = query;

  const today = new Date().toISOString().substring(0, 10);
  const dStart = startDate || today;
  const dEnd = endDate || today;

  const orderBy =
    sortByNominal === "1"
      ? "ORDER BY Nominal_Order DESC, Nomor ASC"
      : "ORDER BY Tanggal_Sort ASC, Nomor ASC";

  // UNION-aware: SO baru dari tsalesorder, SO/SPK lama dari tspk.
  // Masing-masing sub-source sudah di-scope ke sisi cutoff-nya sendiri
  // di WHERE, supaya tidak ada satu SO/SPK yang kebaca dobel dari
  // kedua tabel sekaligus.
  const sql = `
    SELECT * FROM (
      SELECT
        so.so_nomor                                     AS Nomor,
        so.so_nama                                       AS Nama,
        DATE_FORMAT(so.so_tanggal, '%d-%m-%Y')          AS Tanggal,
        so.so_tanggal                                    AS Tanggal_Sort,
        MONTH(so.so_tanggal)                            AS Bulan,
        YEAR(so.so_tanggal)                             AS Tahun,
        v.Divisi                                         AS Divisi,
        a.sal_nama                                       AS Sales,
        so.so_cus_kode                                   AS Kdcus,
        c.Cus_nama                                       AS Customer,
        (so.so_jumlah * so.so_harga)                    AS Nominal_Order,
        (so.so_jumlah_kirim * so.so_harga)              AS Nominal_Kirim,
        (IFNULL(ppic.spk_jumlah_jadi, 0) * so.so_harga) AS Nominal_Jadi,
        (so.so_harga * (so.so_jumlah - so.so_jumlah_kirim)) AS Nominal_Selisih,
        so.so_jumlah                                     AS QtyOrder,
        so.so_jumlah_kirim                               AS QtyKirim,
        IFNULL(ppic.spk_jumlah_jadi, 0)                  AS QtyJadi
      FROM tsalesorder so
      LEFT JOIN tdivisi v    ON v.kode     = so.so_divisi
      LEFT JOIN tsales a     ON a.sal_kode = so.so_sal_kode
      LEFT JOIN tcustomer c  ON c.Cus_kode = so.so_cus_kode
      LEFT JOIN tspk ppic    ON ppic.spk_so_ref = so.so_nomor AND ppic.spk_is_so = 0
      WHERE so.so_aktif = 'Y'
        AND (so.so_jumlah - so.so_jumlah_kirim) > 0
        AND so.so_tanggal > ?

      UNION ALL

      SELECT
        s.spk_nomor                                     AS Nomor,
        s.spk_nama                                      AS Nama,
        DATE_FORMAT(s.spk_Tanggal, '%d-%m-%Y')          AS Tanggal,
        s.spk_Tanggal                                    AS Tanggal_Sort,
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
        s.spk_jumlah_jadi                                AS QtyJadi
      FROM tspk s
      LEFT JOIN tdivisi v    ON v.kode     = s.spk_divisi
      LEFT JOIN tsales a     ON a.sal_kode = s.spk_sal_kode
      LEFT JOIN tcustomer c  ON c.Cus_kode = s.spk_cus_kode
      WHERE s.spk_aktif = 'Y'
        AND (s.spk_jumlah - s.spk_jumlah_kirim) > 0
        AND s.spk_Tanggal <= ?
    ) gabungan
    WHERE Tanggal_Sort >= ? AND Tanggal_Sort <= ?
    ${orderBy}
  `;

  const [rows] = await db.query(sql, [SO_CUTOFF, SO_CUTOFF, dStart, dEnd]);
  return rows;
};

module.exports = { getBrowse };
