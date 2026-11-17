const pool = require('../../../config/database');

// Tanggal kosong/invalid => filter tanggal di-skip (tanpa klausa zero-date).
const isValidDate = (v) =>
  typeof v === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(v) &&
  !isNaN(new Date(v).getTime());

const getLaporanBarangJadi = async (startDate, endDate) => {
    const hasDate = isValidDate(startDate) && isValidDate(endDate);
    const dateFilter = hasDate ? "AND spk_tanggal BETWEEN ? AND ?" : "";
    const params = hasDate ? [startDate, endDate] : [];
    // Query ini murni mengikuti logic ssql di procedure TfrmLapBarangjadi_mmt.loaddata
    const sql = `
        SELECT 
            spk_tanggal AS Tanggal, 
            spk_dateline AS Deadline, 
            spk_perush_kode AS unit, 
            spk_nama, 
            spk_panjang AS Panjang, 
            spk_lebar AS Lebar, 
            spk_nomor,
            spk_jumlah, 
            spk_kain,
            IFNULL(jumlah_jadi, 0) - IFNULL(jumlah_kirim, 0) AS stok_barang,
            IFNULL(spk_jumlah, 0) - IFNULL(jumlah_kirim, 0) AS kurang_kirim,
            IFNULL(jumlah_jadi, 0) AS Jumlah_jadi,
            IFNULL(jumlah_kirim, 0) AS Jumlah_kirim,
            IFNULL(jumlah_jadi * spk_panjang, 0) AS meter_jadi,
            IFNULL(jumlah_kirim * spk_panjang, 0) AS meter_kirim
        FROM tspk
        LEFT JOIN (
            SELECT 
                stbjd_spk_nomor, 
                SUM(stbjd_jumlah) AS jumlah_jadi 
            FROM tstbj_dtl a 
            INNER JOIN tstbj_hdr b ON (stbj_nomor = stbjd_stbj_nomor)
            GROUP BY stbjd_spk_nomor
        ) b ON (b.stbjd_spk_nomor = spk_nomor)
        LEFT JOIN (
            SELECT 
                sjd_spk_nomor, 
                SUM(sjd_jumlah) AS jumlah_kirim 
            FROM tsj_dtl a 
            INNER JOIN tsj_hdr b ON (sj_nomor = sjd_sj_nomor)
            WHERE sj_stssj_kode <> 0
            GROUP BY sjd_spk_nomor 
        ) c ON (c.sjd_spk_nomor = spk_nomor)
        WHERE spk_divisi = 5
        ${dateFilter}
        ORDER BY spk_tanggal DESC
    `;

    try {
        const [rows] = await pool.query(sql, params);
        return rows;
    } catch (error) {
        throw error;
    }
};

module.exports = {
    getLaporanBarangJadi,
};