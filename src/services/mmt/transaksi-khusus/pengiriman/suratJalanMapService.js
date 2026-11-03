const pool = require("../../../../config/database");
const { format } = require("date-fns");

/**
 * Helper untuk menangani error database
 */
const throwDbError = (message, error) => {
  console.error(error);
  throw new Error(`${message}: ${error.message}`);
};

/**
 * Mengambil daftar Surat Jalan MAP (Header & Detail) berdasarkan rentang tanggal
 * Sama persis dengan query di btnRefreshClick Delphi
 */
const getSjMapList = async (startDate, endDate, canLihatCus = false) => {
  try {
    const custCol = canLihatCus ? "c.cus_nama AS Customer," : `"" AS Customer,`;
    // Guard: tanggal kosong ("") di-skip agar tidak jadi klausa zero-date.
    const dateConds = [];
    const dateParams = [];
    if (startDate) {
      dateConds.push(`a.sj_tanggal >= ?`);
      dateParams.push(startDate);
    }
    if (endDate) {
      dateConds.push(`a.sj_tanggal <= ?`);
      dateParams.push(endDate);
    }
    const dateClause = dateConds.length ? dateConds.join(" AND ") : "1=1";

    const headerQuery = `
      SELECT 
        a.sj_nomor AS Nomor,
        DATE_FORMAT(a.sj_tanggal, '%Y-%m-%d') AS Tanggal,
        v.Divisi AS Divisi,
        ${custCol}
        a.sj_keterangan AS Keterangan,
        SUM(d.sjd_jumlah) AS QtyKirim,
        DATE_FORMAT(a.date_create, '%d/%m/%Y %T') AS Created,
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
      WHERE ${dateClause}
      GROUP BY a.sj_nomor 
      ORDER BY a.sj_tanggal DESC, a.sj_nomor DESC
    `;

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
      WHERE ${dateClause}
      ORDER BY d.sjd_sj_nomor
    `;

    const [[headers], [details]] = await Promise.all([
      pool.query(headerQuery, dateParams),
      pool.query(detailQuery, dateParams),
    ]);

    const nestedData = headers.map((header) => {
      const rowDetails = details.filter((d) => d.Nomor === header.Nomor);
      return {
        ...header,
        children: rowDetails.length > 0 ? rowDetails : null,
      };
    });

    return nestedData;
  } catch (error) {
    throwDbError("Gagal mengambil daftar Surat Jalan MAP", error);
  }
};

/**
 * Mengambil detail data Surat Jalan MAP (Sub-grid utama)
 */
const getDetailSjMap = async (nomor) => {
  try {
    const sqlDetail = `
      SELECT 
        d.sjd_sj_nomor AS Nomor,
        DATE_FORMAT(a.sj_tanggal, '%Y-%m-%d') AS Tanggal,
        a.sj_cus_kode AS KdCus,
        c.cus_nama AS Customer,
        v.Divisi AS Divisi,
        d.sjd_mspk_nomor AS "Nomor Memo",
        m.mspk_nama AS Nama,
        d.sjd_ukuran AS Ukuran,
        d.sjd_jumlah AS Jumlah,
        d.sjd_keterangan AS Keterangan
      FROM tsj_hdr_memo a 
      INNER JOIN tsj_dtl_memo d ON a.sj_nomor = d.sjd_sj_nomor 
      INNER JOIN tmemospk m ON m.mspk_Nomor = d.sjd_mspk_nomor 
      LEFT JOIN tcustomer c ON c.cus_kode = a.sj_cus_kode
      LEFT JOIN tdivisi v ON v.kode = a.sj_divisi
      WHERE d.sjd_sj_nomor = ?
      ORDER BY d.sjd_sj_nomor;
    `;
    const [rows] = await pool.query(sqlDetail, [nomor]);
    return rows;
  } catch (error) {
    throwDbError("Gagal mengambil detail Surat Jalan MAP", error);
  }
};

/**
 * Menghapus data Surat Jalan MAP (Header otomatis cascade, pastikan manual aman sesuai Delphi)
 */
const deleteSjMap = async (nomorSj) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    await connection.query(`DELETE FROM tsj_dtl_memo WHERE sjd_sj_nomor = ?`, [
      nomorSj,
    ]);
    const [result] = await connection.query(
      `DELETE FROM tsj_hdr_memo WHERE sj_nomor = ?`,
      [nomorSj],
    );

    await connection.commit();
    return result.affectedRows > 0;
  } catch (error) {
    if (connection) await connection.rollback();
    throwDbError("Gagal menghapus Surat Jalan MAP", error);
  } finally {
    if (connection) connection.release();
  }
};

/**
 * Cek urutan pengajuan PIN 5 terakhir untuk Surat Jalan MAP
 */
const getUrutPengajuanSjMap = async (nomor) => {
  try {
    const sql = `
      SELECT * FROM tspk_pin5 
      WHERE pin_trs = 'SJ MAP' AND pin_nomor = ? 
      ORDER BY pin_urut DESC LIMIT 1
    `;
    const [rows] = await pool.query(sql, [nomor]);

    if (rows.length === 0) {
      return { nextUrut: 1, lastAlasan: "" };
    }

    const lastData = rows[0];
    if (!lastData.pin_dipakai || lastData.pin_dipakai === "") {
      return {
        nextUrut: lastData.pin_urut,
        lastAlasan: lastData.pin_alasan || "",
      };
    } else {
      return { nextUrut: lastData.pin_urut + 1, lastAlasan: "" };
    }
  } catch (error) {
    throwDbError("Gagal mengecek urutan pengajuan Surat Jalan MAP", error);
  }
};

/**
 * Pengajuan perubahan data (PIN 5) untuk Surat Jalan MAP
 */
const ajukanPerubahanSjMap = async (payload, userKode) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const { nomor, tanggal, customer, alasan, urut } = payload;

    if (!alasan || alasan.trim() === "") {
      throw new Error("Alasan harus diisi.");
    }

    const validTanggal = tanggal
      ? format(new Date(tanggal), "yyyy-MM-dd")
      : format(new Date(), "yyyy-MM-dd");

    const query = `
      INSERT INTO tspk_pin5 (
        pin_trs, pin_nomor, pin_urut, pin_tgl_trs, pin_ket, pin_tgl_minta, pin_user_minta, pin_alasan
      ) VALUES (
        'SJ MAP', ?, ?, ?, ?, NOW(), ?, ?
      ) ON DUPLICATE KEY UPDATE 
        pin_tgl_trs = VALUES(pin_tgl_trs), 
        pin_ket = VALUES(pin_ket), 
        pin_acc = '', 
        pin_tgl_minta = NOW(), 
        pin_user_minta = VALUES(pin_user_minta), 
        pin_alasan = VALUES(pin_alasan)
    `;

    await connection.query(query, [
      nomor,
      urut || 1,
      validTanggal,
      customer || "",
      userKode,
      alasan,
    ]);

    await connection.commit();
    return { success: true, message: "Berhasil diajukan. Menunggu ACC" };
  } catch (error) {
    if (connection) await connection.rollback();
    throw error;
  } finally {
    if (connection) connection.release();
  }
};

/**
 * Mengambil status PIN 5 terakhir untuk Surat Jalan MAP
 */
const getPin5StatusSjMap = async (nomor) => {
  try {
    const [rows] = await pool.query(
      `SELECT * FROM tspk_pin5 WHERE pin_trs = 'SJ MAP' AND pin_nomor = ? ORDER BY pin_urut DESC LIMIT 1`,
      [nomor],
    );
    return rows[0] || null;
  } catch (error) {
    throwDbError("Gagal mengambil status PIN 5 Surat Jalan MAP", error);
  }
};

module.exports = {
  getSjMapList,
  getDetailSjMap,
  deleteSjMap,
  getUrutPengajuanSjMap,
  ajukanPerubahan: ajukanPerubahanSjMap,
  getPin5Status: getPin5StatusSjMap,
};
