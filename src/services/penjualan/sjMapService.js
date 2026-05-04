const db = require("../../config/database");

/**
 * Mengambil daftar Surat Jalan MAP (Header & Detail) berdasarkan rentang tanggal
 * Sama persis dengan query di btnRefreshClick Delphi
 */
const getSjMapList = async (startDate, endDate) => {
  // Query Master (Header)
  const headerQuery = `
    SELECT 
      a.sj_nomor AS Nomor,
      a.sj_tanggal AS Tanggal,
      v.Divisi AS Divisi,
      c.cus_nama AS Customer,
      a.sj_keterangan AS Keterangan,
      SUM(d.sjd_jumlah) AS QtyKirim,
      DATE_FORMAT(a.date_create, '%d-%m-%Y %T') AS Created,
      IFNULL((
        SELECT 
          IFNULL(
            IF(pin_acc="" AND pin_dipakai="", "WAIT",
              IF(pin_acc="Y" AND pin_dipakai="", "ACC",
                IF(pin_acc="Y" AND pin_dipakai="Y", "",
                  IF(pin_acc="N", "TOLAK", "")
                )
              )
            ), 
          "")
        FROM tspk_pin5 
        WHERE pin_trs = "SJ MAP" AND pin_nomor = a.sj_nomor 
        ORDER BY pin_urut DESC 
        LIMIT 1
      ), "") AS Ngedit
    FROM tsj_hdr_memo a
    INNER JOIN tsj_dtl_memo d ON d.sjd_sj_nomor = a.sj_nomor
    LEFT JOIN tcustomer c ON c.cus_kode = a.sj_cus_kode
    LEFT JOIN tdivisi v ON v.kode = a.sj_divisi
    WHERE a.sj_tanggal >= ? AND a.sj_tanggal <= ?
    GROUP BY a.sj_nomor 
    ORDER BY a.sj_tanggal DESC, a.sj_nomor DESC
  `;

  // Query Detail (Sub-grid)
  const detailQuery = `
    SELECT 
      d.sjd_sj_nomor AS Nomor,
      d.sjd_mspk_nomor AS "Nomor Memo",
      m.mspk_nama AS Nama,
      d.sjd_ukuran AS Ukuran,
      d.sjd_jumlah AS Jumlah
    FROM tsj_hdr_memo a 
    INNER JOIN tsj_dtl_memo d ON a.sj_nomor = d.sjd_sj_nomor 
    INNER JOIN tmemospk m ON m.mspk_Nomor = d.sjd_mspk_nomor 
    WHERE a.sj_tanggal >= ? AND a.sj_tanggal <= ?
    ORDER BY d.sjd_sj_nomor
  `;

  // Eksekusi secara paralel untuk performa
  const [[headers], [details]] = await Promise.all([
    db.query(headerQuery, [startDate, endDate]),
    db.query(detailQuery, [startDate, endDate]),
  ]);

  // Transformasi data menjadi bentuk bersarang (nested) untuk TreeTable Vuetify
  const nestedData = headers.map((header) => {
    // Cari detail yang Nomor-nya sama dengan Nomor Header
    const rowDetails = details.filter((d) => d.Nomor === header.Nomor);
    return {
      ...header,
      children: rowDetails.length > 0 ? rowDetails : null,
    };
  });

  return nestedData;
};

/**
 * Menghapus data Surat Jalan MAP (Header otomatis cascade jika DB diset cascade,
 * tapi kita pastikan manual sesuai query Delphi)
 */
const deleteSjMap = async (nomorSj) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    // Delphi: s:='delete from tsj_hdr_memo WHERE sj_nomor='+quot(CDSMaster.FieldByname('Nomor').AsString)+';';
    // Di Delphi hanya query delete header, kita asumsikan constraint DB sudah ON DELETE CASCADE.
    // Tapi amannya kita hapus detailnya juga.
    await conn.query(`DELETE FROM tsj_dtl_memo WHERE sjd_sj_nomor = ?`, [
      nomorSj,
    ]);
    const [result] = await conn.query(
      `DELETE FROM tsj_hdr_memo WHERE sj_nomor = ?`,
      [nomorSj],
    );

    await conn.commit();
    return result.affectedRows > 0;
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
};

/**
 * Pengajuan perubahan data (PIN 5)
 */
const ajukanPerubahan = async (payload, userKode) => {
  const { nomor, tanggal, customer, alasan, urut } = payload;
  const conn = await db.getConnection();

  try {
    const query = `
      INSERT INTO tspk_pin5 (
        pin_trs, pin_nomor, pin_urut, pin_tgl_trs, pin_ket, pin_tgl_minta, pin_user_minta, pin_alasan
      ) VALUES (
        "SJ MAP", ?, ?, ?, ?, NOW(), ?, ?
      ) ON DUPLICATE KEY UPDATE 
        pin_tgl_trs = ?, 
        pin_ket = ?, 
        pin_acc = "", 
        pin_tgl_minta = NOW(), 
        pin_user_minta = ?, 
        pin_alasan = ?
    `;

    await conn.query(query, [
      nomor,
      urut,
      tanggal,
      customer,
      userKode,
      alasan,
      // Values for ON DUPLICATE KEY UPDATE
      tanggal,
      customer,
      userKode,
      alasan,
    ]);

    return true;
  } catch (error) {
    throw error;
  } finally {
    conn.release();
  }
};

/**
 * Mengambil urutan PIN 5 terakhir untuk pengajuan
 */
const getPin5Status = async (nomor) => {
  const [rows] = await db.query(
    `SELECT * FROM tspk_pin5 WHERE pin_trs="SJ MAP" AND pin_nomor=? ORDER BY pin_urut DESC LIMIT 1`,
    [nomor],
  );
  return rows[0] || null;
};

module.exports = {
  getSjMapList,
  deleteSjMap,
  ajukanPerubahan,
  getPin5Status,
};
