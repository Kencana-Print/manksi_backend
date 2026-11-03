const pool = require('../../../config/database');
const { format } = require("date-fns");

const lapMonCetak = async (startDate, endDate) => {
  const tglMulai = format(new Date(startDate), "yyyy-MM-dd");
  const tglSelesai = format(new Date(endDate), "yyyy-MM-dd");

  const ssql = `
    SELECT 
        spk.spk_perush_kode AS PERUSH,
        IFNULL(DATE_FORMAT(zz.Tanggal, '%Y-%m-%d'), '-') AS TANGGAL_LHK,
        DATE_FORMAT(spk.spk_tanggal, '%Y-%m-%d') AS TGL_SPK,
        DATE_FORMAT(spk.spk_dateline, '%Y-%m-%d') AS DEADLINE,
        spk.spk_nama AS NAMA_ORDER,
        spk.spk_panjang AS PANJANG,
        spk.spk_lebar AS LEBAR,
        spk.spk_nomor AS NO_SPK,
        spk.spk_jumlah AS ORDER_SPK_PCS,
        (spk.spk_jumlah * spk.spk_panjang * spk.spk_lebar) AS ORDER_SPK_METER,

        (spk.spk_jumlah - 
            (IFNULL(zz.Jml_Cetak, 0) + IFNULL(zz.cetak_luarx, 0))
        ) AS KURANG_VARIANT,

        IFNULL(zz.cetak_luarx, 0) AS CETAK_LUAR,

        -- PCS
        IFNULL(zz.mt01, 0) AS PCS_MT01,
        IFNULL(zz.mt02, 0) AS PCS_MT02,
        IFNULL(zz.mt03, 0) AS PCS_MT03,
        IFNULL(zz.mt04, 0) AS PCS_MT04,
        IFNULL(zz.mt05, 0) AS PCS_MT05,
        IFNULL(zz.Jml_Cetak, 0) AS JUMLAH_PCS,

        -- METER (Diambil dari akumulasi ld_luas_m2)
        IFNULL(zz.jmt01, 0) AS METER_MT01,
        IFNULL(zz.jmt02, 0) AS METER_MT02,
        IFNULL(zz.jmt03, 0) AS METER_MT03,
        IFNULL(zz.jmt04, 0) AS METER_MT04,
        IFNULL(zz.jmt05, 0) AS METER_MT05,
        IFNULL(zz.total_m2, 0) AS JUMLAH_METER

    FROM tspk spk
    LEFT JOIN (
        SELECT 
            res.ld_spk_nomor AS Nomor_SPK,
            MAX(res.ltanggal) AS Tanggal,
            SUM(res.ld_total_qtycetak) AS Jml_Cetak,
            SUM(res.ld_luas_m2) AS total_m2,
            
            -- Grouping PCS per Mesin
            SUM(IF(res.lmesin='MT01', res.ld_total_qtycetak, 0)) AS mt01,
            SUM(IF(res.lmesin='MT02', res.ld_total_qtycetak, 0)) AS mt02,
            SUM(IF(res.lmesin='MT03', res.ld_total_qtycetak, 0)) AS mt03,
            SUM(IF(res.lmesin='MT04', res.ld_total_qtycetak, 0)) AS mt04,
            SUM(IF(res.lmesin='MT05', res.ld_total_qtycetak, 0)) AS mt05,

            -- Grouping METER per Mesin
            SUM(IF(res.lmesin='MT01', res.ld_luas_m2, 0)) AS jmt01,
            SUM(IF(res.lmesin='MT02', res.ld_luas_m2, 0)) AS jmt02,
            SUM(IF(res.lmesin='MT03', res.ld_luas_m2, 0)) AS jmt03,
            SUM(IF(res.lmesin='MT04', res.ld_luas_m2, 0)) AS jmt04,
            SUM(IF(res.lmesin='MT05', res.ld_luas_m2, 0)) AS jmt05,
            
            IFNULL(h.cetak_luarx, 0) AS cetak_luarx

        FROM (
            SELECT 
                d.ld_spk_nomor, 
                h.ltanggal, 
                h.lmesin, 
                d.ld_total_qtycetak, 
                d.ld_luas_m2
            FROM tlhk_mesin_dtl d
            INNER JOIN tlhk_mesin_hdr h ON h.lnomor = d.ld_lnomor
            WHERE h.lstatus = 'POSTED' -- Hanya yang sudah ACC
        ) res
        LEFT JOIN (
            SELECT poe_spk_nomor, 
                   SUM(IFNULL(poe_jumlah,0)) AS cetak_luarx
            FROM tpoexternal_hdr
            WHERE poe_cab='P05'
            GROUP BY poe_spk_nomor
        ) h ON h.poe_spk_nomor = res.ld_spk_nomor
        GROUP BY res.ld_spk_nomor
    ) zz ON zz.Nomor_SPK = spk.spk_nomor

    WHERE spk.spk_aktif='Y'
      AND spk.spk_divisi=5
      AND spk.spk_cab='P05'
      AND spk.spk_jo_kode IN ('MT', 'LM')
      AND spk.spk_tanggal BETWEEN ? AND ?

    ORDER BY spk.spk_tanggal ASC, spk.spk_nomor ASC;
  `;

  const params = [tglMulai, tglSelesai];

  const connection = await pool.getConnection();
  try {
    const [rows] = await connection.execute(ssql, params);
    return rows;
  } finally {
    connection.release();
  }
};

module.exports = { lapMonCetak };
