const pool = require('../../../config/database');
const { format } = require("date-fns");

/**
 * Service untuk mengambil Laporan Jadwal Kirim (Master & Detail)
 * @param {string} startDate - Format YYYY-MM-DD
 * @param {string} endDate - Format YYYY-MM-DD
 */
const getLapJadwalKirim = async (startDate, endDate) => {
  const tglMulai = format(new Date(startDate), "yyyy-MM-dd");
  const tglSelesai = format(new Date(endDate), "yyyy-MM-dd");

  // 1. Query Master
  const masterQuery = `
    SELECT 
      a.Nomor_Kirim AS Nomor, 
      a.Gudang, 
      gdg.gdg_nama AS Nama_Gudang, 
      DATE_FORMAT(a.Tanggal, '%Y-%m-%d') AS Tanggal,
      a.spk_nomor AS No_SPK, 
      b.spk_nama AS Nama_Spk, 
      b.spk_panjang AS Panjang, 
      b.spk_Lebar AS Lebar,
      b.spk_kain AS Kain,
      IFNULL(a.Jumlah, 0) AS Jumlah,
      (IFNULL(a.Jumlah, 0) * b.spk_panjang * IF(SUBSTR(a.spk_nomor, 4, 2) = 'MT', b.spk_lebar, 1)) AS Jumlah_Meter,
      IFNULL(a.Koli, 0) AS Koli, 
      IFNULL(a.Realisasi, 0) AS Realisasi,
      IFNULL(a.koli_Realisasi, 0) AS Koli_Realisasi, 
      (IFNULL(a.Realisasi, 0) - IFNULL(a.Jumlah, 0)) AS Selisih_Jumlah,
      (IFNULL(a.koli_Realisasi, 0) - IFNULL(a.koli, 0)) AS Selisih_Koli,
      IFNULL(ext.cetak_luarx, 0) AS JmlCetakLuar, 
      ext.poe_sup AS Sup, 
      ext.sup_nama, 
      a.usr_create
    FROM tjadwalkirim a
    LEFT JOIN (
      SELECT spk_nomor, spk_nama, spk_panjang, spk_lebar, spk_ukuran, spk_kain 
      FROM tspk 
      WHERE spk_aktif = 'Y'
      UNION ALL 
      SELECT mspk_nomor, mspk_nama, mspk_panjang, mspk_lebar, mspk_ukuran, mspk_kain 
      FROM tmemospk
    ) b ON (b.spk_nomor = a.spk_nomor)
    LEFT JOIN tgudang gdg ON gdg.gdg_kode = a.gudang
    LEFT JOIN (
      SELECT 
        poe_spk_nomor AS poe_Spk, 
        poe_sup, 
        sup.sup_nama, 
        SUM(IFNULL(poe_jumlah, 0)) AS cetak_luarx
      FROM tpoexternal_hdr
      LEFT JOIN tsupplier sup ON (sup.sup_kode = poe_sup)
      WHERE poe_cab = 'P05'
      GROUP BY poe_spk_nomor, poe_sup, sup.sup_nama
    ) ext ON (ext.poe_Spk = a.spk_nomor)
    WHERE a.tanggal >= ? AND a.tanggal <= ?
      AND a.gudang LIKE 'WH-010'
    ORDER BY a.tanggal ASC, a.Nomor_Kirim ASC;
  `;

  // 2. Query Detail
  const detailQuery = `
    SELECT 
      a.Nomor_kirim AS Nomor, 
      a.No_urut,
      a.Kota, 
      a.Uraian,
      a.Size, 
      a.Jumlah, 
      a.Koli,
      a.jami AS "Jam Input",
      a.Jam AS "Jam Brg Ready",
      IFNULL((
        SELECT DISTINCT d.SJD_SJ_Nomor
        FROM tsj_dtl d
        INNER JOIN tsj_hdr h ON h.SJ_Nomor = d.SJD_SJ_Nomor
        WHERE h.SJ_Status_otomatis = 0 
          AND d.SJD_SPK_Nomor = b.spk_nomor 
          AND d.sjd_nokirim = a.nomor_kirim 
          AND d.sjd_idkirim = a.No_urut 
        LIMIT 1
      ), '') AS "Nomor SJ",
      IFNULL((
        SELECT SUM(d.SJD_Jumlah)
        FROM tsj_dtl d
        INNER JOIN tsj_hdr h ON h.SJ_Nomor = d.SJD_SJ_Nomor
        WHERE h.SJ_Status_otomatis = 0 
          AND d.SJD_SPK_Nomor = b.spk_nomor 
          AND d.sjd_nokirim = a.nomor_kirim 
          AND d.sjd_idkirim = a.No_urut
        GROUP BY d.sjd_nokirim, d.sjd_idkirim
      ), 0) AS "Realisasi Kirim",
      a.Jam_Kirim, 
      a.Jam_Ambil, 
      a.Expedisi 
    FROM tjadwalkirim_dtl a
    INNER JOIN tjadwalkirim b ON (a.nomor_kirim = b.nomor_kirim)
    WHERE b.tanggal >= ? AND b.tanggal <= ?
      AND b.gudang LIKE 'WH-010'
    ORDER BY a.Nomor_kirim ASC, a.No_urut ASC;
  `;

  const connection = await pool.getConnection();
  try {
    const [masterRows] = await connection.execute(masterQuery, [tglMulai, tglSelesai]);
    const [detailRows] = await connection.execute(detailQuery, [tglMulai, tglSelesai]);

    // Menggabungkan Master dan Detail secara terstruktur
    const result = masterRows.map((master) => {
      const details = detailRows.filter((detail) => detail.Nomor === master.Nomor);
      return {
        ...master,
        details,
      };
    });

    return result;
  } finally {
    connection.release();
  }
};

/**
 * Service untuk Menghapus Jadwal Kirim
 */
const deleteJadwalKirim = async (nomorKirim, userKd) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // 1. Cek kepemilikan data
    const [check] = await connection.execute(
      'SELECT usr_create FROM tjadwalkirim WHERE nomor_kirim = ?',
      [nomorKirim]
    );

    if (check.length === 0) {
      throw new Error('Data tidak ditemukan');
    }

    if (check[0].usr_create !== userKd) {
      throw new Error(`Data ini milik ${check[0].usr_create}. Anda tidak boleh menghapus.`);
    }

    // 2. Hapus detail & master
    await connection.execute('DELETE FROM tjadwalkirim_dtl WHERE nomor_kirim = ?', [nomorKirim]);
    await connection.execute('DELETE FROM tjadwalkirim WHERE nomor_kirim = ?', [nomorKirim]);

    await connection.commit();
    return true;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

module.exports = {
  getLapJadwalKirim,
  deleteJadwalKirim,
};