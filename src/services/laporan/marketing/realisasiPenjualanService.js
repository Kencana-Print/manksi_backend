const db = require("../../../config/database");

const getBrowse = async (query) => {
  const { startDate, endDate, sortByNominal, namaSales, namaCustomer } = query;

  const today = new Date().toISOString().substring(0, 10);
  const dStart = startDate || today;
  const dEnd = endDate || today;

  const orderBy =
    sortByNominal === "1"
      ? "ORDER BY Nominal_Order DESC, Nomor ASC"
      : "ORDER BY Tanggal_Raw ASC, Nomor ASC";

  // ── Filter opsional Sales/Customer — dipakai bareng antara laporan
  // browse biasa (tidak diisi = behavior lama, semua data) dan
  // chatbot AI (diisi = scoping biar query tidak narik seluruh
  // transaksi perusahaan). ──
  let whereSpkExtra = "";
  let whereSoExtra = "";
  const paramsSpk = [dStart, dEnd];
  const paramsSo = [dStart, dEnd];

  if (namaSales) {
    whereSpkExtra += " AND a.sal_nama LIKE ?";
    paramsSpk.push(`%${namaSales}%`);
    whereSoExtra += " AND a2.sal_nama LIKE ?";
    paramsSo.push(`%${namaSales}%`);
  }
  if (namaCustomer) {
    whereSpkExtra += " AND c.Cus_nama LIKE ?";
    paramsSpk.push(`%${namaCustomer}%`);
    whereSoExtra += " AND c2.Cus_nama LIKE ?";
    paramsSo.push(`%${namaCustomer}%`);
  }

  const sql = `
    SELECT
      Nomor, Nama, Tanggal, Bulan, Tahun, Divisi, Sales, Kdcus, Customer,
      Nominal_Order, QtyOrder, QtyGarmen, QtySpanduk, QtyMMT, Jumlah_SPK
    FROM (
      SELECT
        s.spk_nomor                                       AS Nomor,
        s.spk_nama                                        AS Nama,
        DATE_FORMAT(s.spk_Tanggal, '%d-%m-%Y')            AS Tanggal,
        s.spk_Tanggal                                      AS Tanggal_Raw,
        MONTH(s.spk_Tanggal)                              AS Bulan,
        YEAR(s.spk_Tanggal)                                AS Tahun,
        v.Divisi                                           AS Divisi,
        a.sal_nama                                         AS Sales,
        s.spk_cus_kode                                     AS Kdcus,
        c.Cus_nama                                         AS Customer,
        (s.spk_jumlah * s.spk_harga)                      AS Nominal_Order,
        IF(s.spk_divisi = 1,
          (s.spk_jumlah * s.spk_panjang),
          IF(s.spk_divisi = 5,
            (s.spk_jumlah * s.spk_panjang * s.spk_lebar),
            s.spk_jumlah)
        )                                                  AS QtyOrder,
        s.spk_jumlah                                       AS QtyGarmen,
        (s.spk_jumlah * s.spk_panjang)                    AS QtySpanduk,
        (s.spk_jumlah * s.spk_panjang * s.spk_lebar)     AS QtyMMT,
        1                                                  AS Jumlah_SPK
      FROM tspk s
      LEFT JOIN tdivisi v    ON v.kode     = s.spk_divisi
      LEFT JOIN tsales a     ON a.sal_kode = s.spk_sal_kode
      LEFT JOIN tcustomer c  ON c.Cus_kode = s.spk_cus_kode
      WHERE s.spk_aktif = 'Y'
        AND s.spk_Tanggal >= ?
        AND s.spk_Tanggal <= ?
        AND (s.spk_so_ref IS NULL OR s.spk_so_ref = '')
        ${whereSpkExtra}

      UNION ALL

      SELECT
        so.so_nomor                                       AS Nomor,
        so.so_nama                                        AS Nama,
        DATE_FORMAT(so.so_tanggal, '%d-%m-%Y')            AS Tanggal,
        so.so_tanggal                                      AS Tanggal_Raw,
        MONTH(so.so_tanggal)                              AS Bulan,
        YEAR(so.so_tanggal)                                AS Tahun,
        v2.Divisi                                           AS Divisi,
        a2.sal_nama                                         AS Sales,
        so.so_cus_kode                                     AS Kdcus,
        c2.Cus_nama                                         AS Customer,
        (so.so_jumlah * so.so_harga)                      AS Nominal_Order,
        IF(so.so_divisi = 1,
          (so.so_jumlah * so.so_panjang),
          IF(so.so_divisi = 5,
            (so.so_jumlah * so.so_panjang * so.so_lebar),
            so.so_jumlah)
        )                                                  AS QtyOrder,
        so.so_jumlah                                       AS QtyGarmen,
        (so.so_jumlah * so.so_panjang)                    AS QtySpanduk,
        (so.so_jumlah * so.so_panjang * so.so_lebar)     AS QtyMMT,
        1                                                  AS Jumlah_SPK
      FROM tsalesorder so
      LEFT JOIN tdivisi v2    ON v2.kode     = so.so_divisi
      LEFT JOIN tsales a2     ON a2.sal_kode = so.so_sal_kode
      LEFT JOIN tcustomer c2  ON c2.Cus_kode = so.so_cus_kode
      WHERE so.so_aktif = 'Y'
        AND so.so_tanggal >= ?
        AND so.so_tanggal <= ?
        ${whereSoExtra}
    ) x
    ${orderBy}
  `;

  const [rows] = await db.query(sql, [...paramsSpk, ...paramsSo]);
  return rows;
};

module.exports = { getBrowse };
