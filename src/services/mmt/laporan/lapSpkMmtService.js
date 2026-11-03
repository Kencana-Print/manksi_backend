const pool = require('../../../config/database');

const getReport = async (startDate, endDate) => {
    const sql = `
        SELECT
            spk.spk_nomor AS NOMOR,
            COALESCE(spk.spk_memo, '') AS spk_memo,
            spk.spk_nama AS spk_nama,
            DATE_FORMAT(spk.spk_tanggal, '%Y-%m-%d') AS spk_tanggal,
            DATE_FORMAT(spk.spk_dateline, '%Y-%m-%d') AS deadline,
            COALESCE(divm.divisi, '') AS DIVISI,
            jo.jo_nama AS jo_nama,
            COALESCE(spk.spk_gramasi, '') AS spk_gramasi,
            IF(spk.spk_jumlah_kirim >= spk.spk_jumlah, 'Closed', 'Open') AS status,
            spk.spk_panjang AS PANJANG,
            spk.spk_lebar AS LEBAR,
            spk.spk_kain AS KAIN,
            spk.spk_finishing AS FINISHING,
            spk.spk_jumlah AS spk_jumlah,
            ROUND(IFNULL(mesin.MT01, 0), 0) AS mt01,
            ROUND(IFNULL(mesin.MT02, 0), 0) AS mt02,
            ROUND(IFNULL(mesin.MT03, 0), 0) AS mt03,
            ROUND(IFNULL(mesin.MT04, 0), 0) AS mt04,
            ROUND(IFNULL(mesin.MT05, 0), 0) AS mt05,
            ROUND(IFNULL(mesin.MI, 0), 0) AS mi,
            ROUND(IF(spk.spk_divisi = 1, IFNULL(cetak.jml_cetak, 0), IFNULL(mesin.jml_cetak_mmt, 0)), 0) AS JML_CETAK,
            ROUND(IFNULL(fin.jml_seaming, 0), 0) AS JML_seaming,
            ROUND(IFNULL(fin.jml_mataayam, 0), 0) AS JML_mataayam,
            ROUND(IFNULL(fin.jml_coly, 0), 0) AS JML_coly,
            spk.spk_jumlah_jadi AS JML_JADI,
            spk.spk_jumlah_kirim AS JML_KIRIM,
            (spk.spk_jumlah_kirim * spk.spk_panjang * IF(SUBSTR(spk.spk_nomor, 4, 2) = 'MT', spk.spk_lebar, 1)) AS JML_meter_KIRIM,
            ROUND(IFNULL(mesin.MT01, 0) * spk.spk_panjang * IFNULL(spk.spk_lebar, 0), 2) AS mt01_m,
            ROUND(IFNULL(mesin.MT02, 0) * spk.spk_panjang * IFNULL(spk.spk_lebar, 0), 2) AS mt02_m,
            ROUND(IFNULL(mesin.MT03, 0) * spk.spk_panjang * IFNULL(spk.spk_lebar, 0), 2) AS mt03_m,
            ROUND(IFNULL(mesin.MT04, 0) * spk.spk_panjang * IFNULL(spk.spk_lebar, 0), 2) AS mt04_m,
            ROUND(IFNULL(mesin.MT05, 0) * spk.spk_panjang * IFNULL(spk.spk_lebar, 0), 2) AS mt05_m,
            ROUND(IFNULL(mesin.MI, 0) * spk.spk_panjang * IFNULL(spk.spk_lebar, 0), 2) AS mi_m,
            ROUND(IF(spk.spk_divisi = 1, IFNULL(cetak.jml_cetak, 0), IFNULL(mesin.jml_cetak_mmt, 0)) * spk.spk_panjang * IF(spk.spk_divisi = 5, IFNULL(spk.spk_lebar, 0), 1), 2) AS M_CETAK,
            ROUND(IFNULL(fin.jml_seaming, 0) * spk.spk_panjang * spk.spk_lebar, 2) AS m_seaming,
            ROUND(IFNULL(fin.jml_mataayam, 0) * spk.spk_panjang * spk.spk_lebar, 2) AS m_mataayam,
            ROUND(IFNULL(fin.jml_coly, 0) * spk.spk_panjang * spk.spk_lebar, 2) AS m_coly
        FROM tspk spk
        INNER JOIN tcustomer cus ON spk.spk_cus_kode = cus.cus_kode
        LEFT JOIN tsales sal ON sal.sal_kode = spk.spk_sal_kode
        LEFT JOIN tjenisorder jo ON jo.jo_kode = spk.spk_jo_kode
        LEFT JOIN (
            SELECT
                lcd_spk_nomor,
                SUM(IFNULL(lcd_qty_cetak, 0)) AS jml_cetak
            FROM tlhk_cetak_dtl
            GROUP BY lcd_spk_nomor
        ) cetak ON cetak.lcd_spk_nomor = spk.spk_nomor
        LEFT JOIN (
            SELECT
                lfd_spk_nomor,
                SUM(IFNULL(lfd_j_seaming, 0)) AS jml_seaming,
                SUM(IFNULL(lfd_j_mataayam, 0)) AS jml_mataayam,
                SUM(IFNULL(lfd_j_coly, 0)) AS jml_coly
            FROM tlhk_finishingmmt_dtl
            GROUP BY lfd_spk_nomor
        ) fin ON fin.lfd_spk_nomor = spk.spk_nomor
        LEFT JOIN (
            SELECT
                lcd_spk_nomor,
                SUM(IF(lcd_jns_mesin = 'MT01', lcd_qty_cetak, 0)) AS MT01,
                SUM(IF(lcd_jns_mesin = 'MT02', lcd_qty_cetak, 0)) AS MT02,
                SUM(IF(lcd_jns_mesin = 'MT03', lcd_qty_cetak, 0)) AS MT03,
                SUM(IF(lcd_jns_mesin = 'MT04', lcd_qty_cetak, 0)) AS MT04,
                SUM(IF(lcd_jns_mesin = 'MT05', lcd_qty_cetak, 0)) AS MT05,
                SUM(IF(lcd_jns_mesin = 'MI', lcd_qty_cetak, 0)) AS MI,
                SUM(IFNULL(lcd_qty_cetak, 0)) AS jml_cetak_mmt
            FROM tlhk_cetakmmt_dtl
            GROUP BY lcd_spk_nomor
        ) mesin ON mesin.lcd_spk_nomor = spk.spk_nomor
        LEFT JOIN tdivisi divm ON divm.kode = spk.spk_divisi
        WHERE
            spk.spk_aktif = 'Y'
            AND spk.spk_divisi IN (5)
            AND spk.spk_tanggal >= ?
            AND spk.spk_tanggal <= ?
        ORDER BY spk.spk_nama
    `;

    const [rows] = await pool.query(sql, [startDate, endDate]);
    return rows;
};

module.exports = {
    getReport,
};
