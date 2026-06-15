const db = require("../../../config/database");

/**
 * MENGAMBIL SUMMARY MASTER DAFTAR PIUTANG
 * Berdasarkan referensi Delphi, filter yang digunakan hanya tanggal akhir (end date),
 * artinya menarik seluruh data piutang dari masa lalu hingga batas tanggal tersebut.
 */
const getMasterPiutang = async (query) => {
  const { endDate } = query;

  // Default tanggal akhir = hari ini jika tidak dipilih
  const dEnd = endDate || new Date().toISOString().substring(0, 10);

  // Kueri diadaptasi dari Delphi, dengan penyesuaian IF() MariaDB untuk perhitungan PPN
  const sql = `
    SELECT 
      X.Nomor,
      DATE_FORMAT(x.INV_tanggal, "%d-%m-%Y") AS Tanggal,
      x.Bulan,
      x.Divisi,
      x.Customer,
      x.Keterangan,
      x.Dpp,
      x.PPn,
      x.Total,
      DATE_FORMAT(x.TglBayar, "%d-%m-%Y") AS TglBayar,
      x.NominalBayar,
      (x.Total - x.NominalBayar) AS SisaPiutang,
      x.inv_no_fp AS FakturPajak
    FROM (
      SELECT 
        h.INV_nomor AS Nomor,
        h.INV_tanggal,
        IF(YEAR(h.INV_tanggal) = YEAR(CURDATE()), MONTH(h.INV_tanggal), YEAR(h.INV_tanggal)) AS Bulan,
        v.Divisi,
        c.Cus_nama AS Customer,
        h.INV_Keterangan AS Keterangan,
        IFNULL((SELECT SUM(invd_harga * invd_jumlah) FROM tinv_dtl WHERE invd_inv_nomor = h.inv_nomor), 0) AS Dpp,
        IFNULL((SELECT SUM(invd_harga * invd_jumlah * IF(h.INV_STS_PPN=1, (h.inv_ppn/100), 0)) FROM tinv_dtl WHERE invd_inv_nomor = h.inv_nomor), 0) AS PPn,
        IFNULL((SELECT SUM(invd_harga * invd_jumlah * IF(h.INV_STS_PPN=1, ((100+h.inv_ppn)/100), 1)) FROM tinv_dtl WHERE invd_inv_nomor = h.inv_nomor), 0) AS Total,
        (
          SELECT a.tanggal 
          FROM piutang_kredit_header a 
          INNER JOIN piutang_kredit_detail b ON b.nomor = a.nomor
          WHERE b.nota = h.inv_nomor 
            AND a.tanggal >= "2021-01-01" 
            AND a.tanggal <= ? 
          ORDER BY a.tanggal DESC LIMIT 1
        ) AS TglBayar,
        IFNULL((
          SELECT SUM(a.kredit) 
          FROM piutang_kredit_detail a 
          INNER JOIN piutang_kredit_header b ON a.nomor = b.nomor
          WHERE a.nota = h.inv_nomor 
            AND b.tanggal >= "2021-01-01" 
            AND b.tanggal <= ?
        ), 0) AS NominalBayar,
        h.inv_no_fp
      FROM tinv_hdr h
      LEFT JOIN tcustomer c ON c.Cus_kode = h.INV_cus_kode
      LEFT JOIN tdivisi v ON v.kode = h.inv_divisi
      WHERE h.INV_flag = 0 
        AND h.INV_Keterangan NOT LIKE "%INV YG DIKIRIM%" 
        AND h.inv_tanggal <= ?
    ) X
    ORDER BY X.INV_tanggal, X.Nomor
  `;

  // Filter Delphi menggunakan 3 buah parameter tanggal yang sama (startdate.Date di kode Delphi asli)
  const [rows] = await db.query(sql, [dEnd, dEnd, dEnd]);

  // Karena laporan Detail Piutang, kita hanya perlu memunculkan tagihan yang sisa piutangnya belum 0
  // Namun karena kueri Delphi menarik semuanya, kita biarkan front-end atau user mem-filter jika perlu.
  return rows;
};

/**
 * MENGAMBIL DETAIL PEMBAYARAN PER NOMOR INVOICE
 */
const getDetailPiutang = async (query, invNomor) => {
  const { endDate } = query;
  const dEnd = endDate || new Date().toISOString().substring(0, 10);

  const sql = `
    SELECT 
      d.nota AS Nomor,
      d.No_Bukti AS NoBukti,
      DATE_FORMAT(h.Tanggal, "%d-%m-%Y") AS Tanggal,
      t.tt_nama AS CaraBayar,
      d.kredit AS Bayar
    FROM piutang_kredit_detail d
    INNER JOIN piutang_kredit_header h ON d.nomor = h.nomor
    INNER JOIN tkode_tt t ON t.tt_kode = d.kode
    WHERE d.nota = ? 
      AND h.tanggal >= "2021-01-01" 
      AND h.tanggal <= ?
    ORDER BY h.Tanggal ASC, d.No_Bukti ASC
  `;

  const [rows] = await db.query(sql, [invNomor, dEnd]);
  return rows;
};

module.exports = {
  getMasterPiutang,
  getDetailPiutang,
};
