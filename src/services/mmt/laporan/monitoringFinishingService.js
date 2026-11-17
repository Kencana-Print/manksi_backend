const pool = require('../../../config/database');
const { format } = require("date-fns");

const lapMonFinishing = async (startDate, endDate) => {
  const tglMulai = format(new Date(startDate), "yyyy-MM-dd");
  const tglSelesai = format(new Date(endDate), "yyyy-MM-dd");

  const ssql = `
    SELECT 
        spk.spk_perush_kode, 
        spk.spk_tanggal, 
        spk.spk_dateline, 
        spk.spk_nomor, 
        spk.spk_nama, 
        spk.spk_panjang, 
        spk.spk_lebar, 
        spk.spk_jumlah,
        spk.spk_kain,
        zz.*, 
        (spk.spk_jumlah * spk.spk_panjang * spk.spk_lebar) as order_meter, 
        IFNULL(zz.Jml_seaming, 0) + IFNULL(ext.ext_seaming, 0) as jmlseaming, 
        IFNULL(zz.Jml_mataayam, 0) + IFNULL(ext.ext_mataayam, 0) as jmlmataayam, 
        IFNULL(zz.Jml_coly, 0) + IFNULL(ext.ext_coly, 0) as jmlcoly, 
        IFNULL(ext.ext_total, 0) as cetak_luar,
        /* Sisa dikurangi internal + TOTAL eksternal selesai (apa pun jenisnya),
           karena barang yang sudah selesai di eksternal tak perlu dikerjakan lagi */
        (spk.spk_jumlah - IFNULL(zz.Jml_seaming, 0) - IFNULL(ext.ext_total, 0)) as k_seaming,
        (spk.spk_jumlah - IFNULL(zz.Jml_mataayam, 0) - IFNULL(ext.ext_total, 0)) as k_mataayam,
        (spk.spk_jumlah - IFNULL(zz.Jml_coly, 0) - IFNULL(ext.ext_total, 0)) as k_coly
    FROM tspk spk
    LEFT JOIN (
        SELECT 
            a.lfd_spk_nomor AS Nomor_SPK,
            SUM(a.lfd_j_seaming) AS Jml_seaming, 
            SUM(a.lfd_j_mataayam) AS Jml_mataayam, 
            SUM(a.lfd_j_coly) AS Jml_coly
        FROM tlhk_finishingmmt_dtl a 
        INNER JOIN tlhk_finishingmmt_hdr b ON b.lfh_nomor = a.lfd_lfh_nomor
        WHERE b.lfh_tanggal BETWEEN ? AND ?
        GROUP BY a.lfd_spk_nomor
    ) zz ON zz.Nomor_SPK = spk.spk_nomor
    LEFT JOIN (
        /* Finishing eksternal (PO External + BPB): qty SELESAI finishing (bpe_finishing),
           dipetakan ke proses berdasar kata kunci jenis finishing di PO */
        SELECT 
            p.poe_spk_nomor AS Nomor_SPK,
            SUM(IF(UPPER(p.poe_finishing) LIKE '%SEAMING%'
                    OR UPPER(p.poe_finishing) LIKE '%SEEMING%'
                    OR UPPER(p.poe_finishing) LIKE '%SHEAMING%',
                   IFNULL(b.bpe_finishing, 0), 0)) AS ext_seaming,
            SUM(IF(UPPER(p.poe_finishing) LIKE '%MATA AYAM%',
                   IFNULL(b.bpe_finishing, 0), 0)) AS ext_mataayam,
            SUM(IF(UPPER(p.poe_finishing) LIKE '%COLY%',
                   IFNULL(b.bpe_finishing, 0), 0)) AS ext_coly,
            SUM(IFNULL(b.bpe_finishing, 0)) AS ext_total
        FROM tpoexternal_hdr p
        LEFT JOIN tbpbpoexternal_hdr b ON b.bpe_po = p.poe_nomor
            AND b.bpe_tanggal BETWEEN ? AND ?
        WHERE p.poe_cab = 'P05'
        GROUP BY p.poe_spk_nomor
    ) ext ON ext.Nomor_SPK = spk.spk_nomor
    WHERE spk.spk_tanggal BETWEEN ? AND ?
      AND spk.spk_aktif = 'Y' 
      AND spk.spk_divisi = 5 
    ORDER BY spk.spk_tanggal ASC, spk.spk_nomor ASC;
  `;

  const params = [tglMulai, tglSelesai, tglMulai, tglSelesai, tglMulai, tglSelesai];

  const connection = await pool.getConnection();
  try {
    const [rows] = await connection.execute(ssql, params);
    return rows;
  } finally {
    connection.release();
  }
};

module.exports = { lapMonFinishing };
