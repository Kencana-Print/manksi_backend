const db = require("../../../config/database");

const getBrowse = async (query) => {
  const { startDate, endDate } = query;

  // Default tanggal: Awal bulan s/d Hari ini
  const date = new Date();
  const dStart =
    startDate ||
    new Date(date.getFullYear(), date.getMonth(), 1)
      .toISOString()
      .substring(0, 10);
  const dEnd = endDate || date.toISOString().substring(0, 10);

  const sql = `
    SELECT 
      a.pen_perush_kode, 
      a.pen_tanggal, 
      a.pen_cus_kode, 
      a.cus_nama, 
      a.pen_sal_kode, 
      a.sal_nama, 
      a.pen_nomor, 
      a.pend_id, 
      a.pend_nama_barang, 
      a.pend_bahan, 
      a.pend_ukuran, 
      a.pend_panjang, 
      a.pend_lebar, 
      a.pend_satuan, 
      a.pend_qty, 
      a.pend_harga, 
      a.pend_status,
      b.mspk_nomor, 
      b.mspk_tanggal, 
      b.mspk_nama, 
      IFNULL(b.mspk_jumlah, 0) AS mspk_jumlah, 
      IFNULL(b.mspk_rencana_order, 0) AS mspk_rencana_order, 
      IFNULL(b.mspk_harga, 0) AS mspk_harga
    FROM (
      SELECT 
        h.pen_perush_kode, h.pen_tanggal, h.pen_cus_kode, c.cus_nama, 
        h.pen_sal_kode, s.sal_nama, h.pen_nomor, d.pend_id, 
        d.pend_nama_barang, d.pend_bahan, d.pend_ukuran, 
        d.pend_panjang, d.pend_lebar, d.pend_satuan, 
        IFNULL(d.pend_qty, 0) AS pend_qty, 
        IFNULL(d.pend_harga, 0) AS pend_harga, 
        d.pend_status
      FROM tpenawaran_hdr h
      INNER JOIN tpenawaran_dtl d ON d.pend_pen_nomor = h.pen_nomor
      LEFT JOIN tsales s ON s.sal_kode = h.pen_sal_kode
      LEFT JOIN tcustomer c ON c.cus_kode = h.pen_cus_kode
      WHERE h.pen_tanggal BETWEEN ? AND ?
    ) a
    LEFT JOIN tmemospk b ON (b.mspk_pen_nomor = a.pen_nomor AND b.mspk_pen_id = a.pend_id AND b.mspk_aktif = 'Y')
    ORDER BY a.pen_tanggal DESC, a.pen_nomor DESC
  `;

  const [rows] = await db.query(sql, [dStart, dEnd]);
  return rows;
};

module.exports = {
  getBrowse,
};
