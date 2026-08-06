const db = require("../../config/database");

/**
 * Browse SO DTF/DTG.
 * ⚠️ Cross-database: header/detail di `retail.*`, kolom Lhk cross-ref
 * ke `tdtf` (MANKSI sendiri, bukan retail) via spk_nomor = Nomor.
 * Replikasi persis — TIDAK ada filter cabang/jenis apapun.
 */
const getBrowseData = async (startDate, endDate) => {
  const qMaster = `
    SELECT x.Nomor, x.Workshop, x.Tanggal, x.Dateline, x.NamaDTF, x.Jumlah, x.Titik,
      (x.Jumlah * x.Titik) AS TotalTitik,
      IFNULL((
        SELECT SUM(a.depan + a.belakang + a.lengan + a.variasi + a.saku)
        FROM tdtf a WHERE a.spk_nomor = x.Nomor
      ), 0) AS Lhk,
      x.Sales, x.BagDesain, x.Customer, x.Kain, x.Finishing, x.Keterangan, x.Created
    FROM (
      SELECT h.sd_nomor AS Nomor, h.sd_workshop AS Workshop, h.sd_tanggal AS Tanggal,
        h.sd_datekerja AS Dateline, h.sd_nama AS NamaDTF,
        IFNULL((
          SELECT SUM(i.sdd_jumlah) FROM retail.tsodtf_dtl i WHERE i.sdd_nomor = h.sd_nomor
        ), 0) AS Jumlah,
        IFNULL((
          SELECT COUNT(*) FROM retail.tsodtf_dtl2 i WHERE i.sdd2_nomor = h.sd_nomor
        ), 0) AS Titik,
        s.sal_nama AS Sales, h.sd_desain AS BagDesain,
        IF(h.sd_customer = '', c.cus_nama, h.sd_customer) AS Customer,
        h.sd_kain AS Kain, h.sd_finishing AS Finishing, h.sd_ket AS Keterangan,
        h.user_create AS Created
      FROM retail.tsodtf_hdr h
      LEFT JOIN retail.tcustomer c ON c.cus_kode = h.sd_cus_kode
      LEFT JOIN tsales s ON s.sal_kode = h.sd_sal_kode
      WHERE h.sd_tanggal >= ? AND h.sd_tanggal <= ?
      ORDER BY h.sd_tanggal
    ) x
  `;
  const [masterRows] = await db.query(qMaster, [startDate, endDate]);

  const qDetail = `
    SELECT d.sdd_nomor AS Nomor, d.sdd_ukuran AS Ukuran, d.sdd_jumlah AS Jumlah
    FROM retail.tsodtf_dtl d
    LEFT JOIN retail.tsodtf_hdr h ON h.sd_nomor = d.sdd_nomor
    WHERE h.sd_tanggal >= ? AND h.sd_tanggal <= ?
    ORDER BY d.sdd_nomor, d.sdd_nourut
  `;
  const [detailRows] = await db.query(qDetail, [startDate, endDate]);

  return masterRows.map((master) => ({
    ...master,
    details: detailRows.filter((d) => d.Nomor === master.Nomor),
  }));
};

module.exports = {
  getBrowseData,
};
