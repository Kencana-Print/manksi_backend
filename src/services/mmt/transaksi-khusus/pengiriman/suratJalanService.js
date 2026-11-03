const pool = require("../../../../config/database");
const { format } = require("date-fns");

/**
 * Helper untuk menangani error database
 */
const throwDbError = (message, error) => {
  console.error(error);
  throw new Error(`${message}: ${error.message}`);
};

/* ==========================================================================
   BAGIAN 1: MODUL BROWSE, DELETE & PENGAJUAN EDIT SURAT JALAN
   ========================================================================== */

/**
 * BROWSE DATA SURAT JALAN UTAMA (Logika btnRefreshClick Delphi)
 */

const getBrowseSJ = async (
  startDate,
  endDate,
  kdUser,
  zcus = 0,
  zdivisi = 0,
) => {
  try {
    const isAhmad = kdUser === "AHMAD";

    let selectCols = `
            a.sj_nomor AS Nomor, 
            DATE_FORMAT(a.sj_tanggal, '%Y-%m-%d') AS Tanggal, 
            divi.Divisi AS Divisi, 
            a.sj_inv_sm AS Invoice, 
        `;

    if (Number(zcus) === 1) {
      selectCols += `
                a.sj_cus_kode AS KdCus, 
                c.cus_nama AS Customer, 
                a.sj_alamat_customer AS Alamat, 
                a.sj_kota_customer AS Kota, 
            `;
    }

    selectCols += `
            a.sj_keterangan AS Keterangan, 
            a.sj_gdg_kode AS KodeGdg, 
            g.gdg_nama AS Gudang, 
            SUM(d.sjd_jumlah) AS QtyKirim, 
            (IF(a.sj_approve = 2, "Batal", IF(a.sj_approve = 1, "Sudah", ""))) AS Approved, 
            DATE_FORMAT(a.date_create, '%d/%m/%Y %T') AS Created, 
            DATE_FORMAT(a.date_modified, '%d/%m/%Y %T') AS Modified, 
            a.user_produksi AS UsrProduksi, 
            DATE_FORMAT(a.date_produksi, '%d/%m/%Y %T') AS TglUbahProduksi, 
            IFNULL((
                SELECT 
                    IF(pin_acc='' AND pin_dipakai='', 'WAIT', 
                    IF(pin_acc='Y' AND pin_dipakai='', 'ACC', 
                    IF(pin_acc='Y' AND pin_dipakai='Y', '', 
                    IF(pin_acc='N', 'TOLAK', ''))))
                FROM tspk_pin5 
                WHERE pin_trs='SJ' AND pin_nomor=a.sj_nomor 
                ORDER BY pin_urut DESC LIMIT 1
            ), "") AS Ngedit
        `;

    let sqlMaster = `
            SELECT ${selectCols}
            FROM tsj_hdr a
            LEFT JOIN tsj_dtl d ON d.sjd_sj_nomor = a.sj_nomor
            INNER JOIN tgudang g ON g.gdg_kode = a.sj_gdg_kode 
            LEFT JOIN tcustomer c ON c.cus_kode = a.sj_cus_kode 
            LEFT JOIN tdivisi divi ON divi.kode = a.sj_divisi
            WHERE a.sj_status_otomatis = 0 
        `;

    const params = [];

    if (isAhmad) {
      sqlMaster += `
                AND a.sj_nomor IN (
                    SELECT DISTINCT sjd_sj_nomor 
                    FROM tsj_dtl 
                    WHERE sjd_spk_nomor IN (
                        SELECT DISTINCT pojh_spk_nomor FROM tpojasa_hdr_spanduk
                    )
                )
            `;
    }

    sqlMaster += ` AND a.sj_tanggal >= ? AND a.sj_tanggal <= ? `;
    params.push(startDate, endDate);

    if (!isAhmad) {
      if (Number(zdivisi) === 1) sqlMaster += ` AND g.gdg_jadi = 1 `;
      if (Number(zdivisi) === 4) sqlMaster += ` AND g.gdg_jadi = 4 `;
    }

    sqlMaster += ` GROUP BY a.sj_nomor ORDER BY a.sj_tanggal, a.sj_nomor; `;

    const [rows] = await pool.query(sqlMaster, params);
    return rows;
  } catch (error) {
    throwDbError("Gagal mengambil data browse Surat Jalan", error);
  }
};

/**
 * GET DETAIL DATA SURAT JALAN (Sub-grid Utamas)
 */
/**
 * GET DETAIL DATA SURAT JALAN (Sub-grid Utama)
 */
const getDetailSJ = async (nomor) => {
  try {
    const sqlDetail = `
      SELECT 
        d.sjd_sj_nomor AS Nomor, 
        DATE_FORMAT(h.sj_tanggal, '%Y-%m-%d') AS Tanggal, 
        h.sj_cus_kode AS KdCus, 
        c.cus_nama AS Customer, 
        h.sj_alamat_customer AS Alamat, 
        h.sj_kota_customer AS Kota, 
        h.sj_inv_sm AS Invoice, 
        divi.Divisi AS Divisi, 
        g.gdg_nama AS Gudang, 
        d.sjd_spk_nomor AS SPK, 
        s.spk_nama AS Nama, 
        d.sjd_ukuran AS Ukuran, 
        s.spk_panjang AS Panjang, 
        s.spk_lebar AS Lebar, 
        d.sjd_jumlah AS Jumlah, 
        d.SJD_Koli AS Koli, 
        d.sjd_keterangan AS Keterangan, 
        d.sjd_nokirim AS NoKirim, 
        d.sjd_idkirim AS IdKirim
      FROM tsj_hdr h
      INNER JOIN tsj_dtl d ON h.sj_nomor = d.sjd_sj_nomor 
      INNER JOIN tspk s ON s.spk_nomor = d.sjd_spk_nomor 
      LEFT JOIN tcustomer c ON c.cus_kode = h.sj_cus_kode
      LEFT JOIN tgudang g ON g.gdg_kode = h.sj_gdg_kode
      LEFT JOIN tdivisi divi ON divi.kode = h.sj_divisi
      WHERE d.sjd_sj_nomor = ? AND h.sj_status_otomatis = 0 
      ORDER BY d.sjd_sj_nomor, d.sjd_nourut;
    `;
    const [rows] = await pool.query(sqlDetail, [nomor]);
    return rows;
  } catch (error) {
    throwDbError("Gagal mengambil detail Surat Jalan", error);
  }
};

/**
 * DELETE DATA SURAT JALAN
 */
const deleteSJ = async (nomor, invoice, approved) => {
  if (approved === "Sudah") {
    throw new Error(
      "Surat Jalan Sudah di Approve. Silahkan Pending supaya bisa diHapus.",
    );
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    await connection.query(`DELETE FROM tsj_hdr WHERE sj_nomor = ?`, [nomor]);
    await connection.query(`DELETE FROM tsj_hdr WHERE sj_keterangan = ?`, [
      nomor,
    ]);

    if (invoice) {
      await connection.query(`DELETE FROM tinv_hdr WHERE inv_nomor = ?`, [
        invoice,
      ]);
    }

    await connection.commit();
    return true;
  } catch (error) {
    if (connection) await connection.rollback();
    throwDbError("Gagal menghapus Surat Jalan", error);
  } finally {
    if (connection) connection.release();
  }
};

/**
 * CEK URUTAN PENGAJUAN TERAKHIR
 */
const getUrutPengajuanSJ = async (nomor) => {
  try {
    const sql = `
            SELECT * FROM tspk_pin5 
            WHERE pin_trs = 'SJ' AND pin_nomor = ? 
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
    throwDbError("Gagal mengecek urutan pengajuan", error);
  }
};

/**
 * SUBMIT PENGAJUAN PERUBAHAN DATA (APPROVAL EDIT)
 */
const submitPengajuanSJ = async (payload, userLogin) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const { nomor, tanggal, keterangan, urut, alasan } = payload;

    if (!alasan || alasan.trim() === "") {
      throw new Error("Alasan harus diisi.");
    }

    const validTanggal = tanggal
      ? format(new Date(tanggal), "yyyy-MM-dd")
      : format(new Date(), "yyyy-MM-dd");
    const activeUser = userLogin;

    const sql = `
            INSERT INTO tspk_pin5 (
                pin_trs, pin_nomor, pin_urut, pin_tgl_trs, pin_ket, 
                pin_tgl_minta, pin_user_minta, pin_alasan
            ) VALUES ('SJ', ?, ?, ?, ?, NOW(), ?, ?)
            ON DUPLICATE KEY UPDATE 
                pin_tgl_trs = VALUES(pin_tgl_trs),
                pin_ket = VALUES(pin_ket),
                pin_acc = '',
                pin_tgl_minta = NOW(),
                pin_user_minta = VALUES(pin_user_minta),
                pin_alasan = VALUES(pin_alasan);
        `;

    await connection.query(sql, [
      nomor,
      urut || 1,
      validTanggal,
      keterangan || "",
      activeUser,
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

/* ==========================================================================
   BAGIAN 2: MODUL APPROVAL, PENDING, & BATAL SURAT JALAN
   ========================================================================== */

/**
 * Menampilkan Data Master khusus Modul Approval SJ (btnRefreshClick & btnShowClick)
 */
const getMasterSj = async (
  startDate,
  endDate,
  cab,
  zcus = 0,
  pendingOnly = false,
) => {
  try {
    let sql = `
            SELECT 
                IF(h.sj_approve=1, "Sudah", IF(h.sj_approve=2, "Batal", "")) AS Approved,
                v.Divisi,
                h.sj_nomor AS Nomor,
                DATE_FORMAT(h.sj_tanggal, '%d/%m/%Y') AS Tanggal,
                h.sj_gdg_kode AS KodeGdg,
                g.gdg_nama AS Gudang,
        `;

    if (parseInt(zcus) === 1) {
      sql += ` h.sj_cus_kode AS KodeCustomer, c.cus_nama AS Customer, h.sj_alamat_customer AS Alamat, h.sj_kota_customer AS Kota, `;
    }

    sql += `
                h.sj_keterangan AS Keterangan,
                h.sj_perush_kode AS ID
            FROM tsj_hdr h 
            LEFT JOIN tgudang g ON g.gdg_kode = h.sj_gdg_kode 
            LEFT JOIN tcustomer c ON c.cus_kode = h.sj_cus_kode 
            LEFT JOIN tdivisi v ON v.kode = h.sj_divisi
            WHERE h.date_create >= "2020-08-24"
        `;

    const params = [];

    if (pendingOnly) {
      sql += ` AND h.sj_status_otomatis <> 1 AND h.sj_approve = 0 `;
    } else {
      sql += ` AND h.sj_status_otomatis = 0 AND h.sj_tanggal BETWEEN ? AND ? `;
      params.push(startDate, endDate);
    }

    if (cab === "P01") sql += ` AND h.sj_gdg_kode = "GJ002" `;
    else if (cab === "P02") sql += ` AND h.sj_gdg_kode = "WH002" `;
    else if (cab === "P04") sql += ` AND h.sj_gdg_kode = "GJ001" `;
    else if (cab === "P05") sql += ` AND h.sj_gdg_kode = "WH-010" `;

    sql += ` ORDER BY h.sj_approve, h.sj_nomor `;

    const [rows] = await pool.query(sql, params);
    return rows;
  } catch (error) {
    throwDbError("Gagal mengambil master approval SJ", error);
  }
};

/**
 * Menampilkan Data Detail khusus Modul Approval SJ
 */
const getDetailSj = async (startDate, endDate, cab, pendingOnly = false) => {
  try {
    let sql = `
            SELECT 
                d.sjd_sj_nomor AS Nomor,
                d.sjd_spk_nomor,
                s.spk_nama,
                d.sjd_ukuran,
                s.spk_panjang AS Panjang,
                s.spk_lebar AS Lebar,
                d.sjd_jumlah,
                d.sjd_keterangan
            FROM tsj_hdr h
            INNER JOIN tsj_dtl d ON h.sj_nomor = d.sjd_sj_nomor 
            LEFT JOIN tspk s ON s.spk_Nomor = d.sjd_spk_nomor 
            WHERE h.date_create >= "2020-08-24"
        `;

    const params = [];

    if (pendingOnly) {
      sql += ` AND h.sj_status_otomatis = 0 `;
    } else {
      sql += ` AND h.sj_status_otomatis = 0 AND h.sj_tanggal BETWEEN ? AND ? `;
      params.push(startDate, endDate);
    }

    if (cab === "P01") sql += ` AND h.sj_gdg_kode = "GJ002" `;
    else if (cab === "P02") sql += ` AND h.sj_gdg_kode = "WH002" `;
    else if (cab === "P04") sql += ` AND h.sj_gdg_kode = "GJ001" `;
    else if (cab === "P05") sql += ` AND h.sj_gdg_kode = "WH-010" `;

    sql += ` ORDER BY d.sjd_sj_nomor `;

    const [rows] = await pool.query(sql, params);
    return rows;
  } catch (error) {
    throwDbError("Gagal mengambil detail approval SJ", error);
  }
};

/**
 * Proses Approval (Approve1Click)
 */
const approveSj = async (nomor, kodeGdg) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [check] = await conn.query(
      "SELECT sj_approve FROM tsj_hdr WHERE sj_nomor = ?",
      [nomor],
    );
    if (!check.length) throw new Error("Data Surat Jalan tidak ditemukan.");

    const currentStatus = check[0].sj_approve;
    if (currentStatus === 1) throw new Error("Sudah di approve.");
    if (currentStatus === 2)
      throw new Error("Masukkan ke Pending dulu baru di Approve.");

    await conn.query("UPDATE tsj_hdr SET sj_approve = 1 WHERE sj_nomor = ?", [
      nomor,
    ]);

    const [details] = await conn.query(
      "SELECT SJD_SJ_Nomor, sjd_spk_nomor, sjd_ukuran, SJD_jumlah FROM tsj_dtl WHERE SJD_SJ_Nomor = ?",
      [nomor],
    );

    if (details.length > 0) {
      const sqlInsApprove = `
                INSERT INTO tsj_approve (sja_nomor, sja_spk_nomor, sja_size, sja_jumlah, sja_gdg_kode) 
                VALUES ?
            `;
      const values = details.map((d) => [
        d.SJD_SJ_Nomor,
        d.sjd_spk_nomor,
        d.sjd_ukuran,
        d.SJD_jumlah,
        kodeGdg,
      ]);
      await conn.query(sqlInsApprove, [values]);
    }

    await conn.commit();
    return { success: true, message: "Sukses Approve." };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
};

/**
 * Proses Pending (Membatalkan Status Approve)
 */
const pendingSj = async (nomor) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [check] = await conn.query(
      "SELECT sj_approve FROM tsj_hdr WHERE sj_nomor = ?",
      [nomor],
    );
    if (!check.length) throw new Error("Data tidak ditemukan.");
    if (check[0].sj_approve === 0)
      throw new Error("Status belum di approve. Tidak perlu dibatalkan.");

    await conn.query("UPDATE tsj_hdr SET sj_approve = 0 WHERE sj_nomor = ?", [
      nomor,
    ]);
    await conn.query("DELETE FROM tsj_approve WHERE sja_nomor = ?", [nomor]);

    await conn.commit();
    return { success: true, message: "Sukses memindahkan ke Pending." };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
};

/**
 * Proses Membatalkan Surat Jalan (BatalSJ1Click)
 */
const batalSj = async (nomor) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [check] = await conn.query(
      "SELECT sj_approve FROM tsj_hdr WHERE sj_nomor = ?",
      [nomor],
    );
    if (!check.length) throw new Error("Data tidak ditemukan.");
    if (check[0].sj_approve === 1)
      throw new Error(
        "Sudah di approve. Silahkan di Pending utk membatalkan Approve, baru dibatalkan.",
      );
    if (check[0].sj_approve === 2) throw new Error("SJ ini sudah batal.");

    await conn.query("UPDATE tsj_hdr SET sj_approve = 2 WHERE sj_nomor = ?", [
      nomor,
    ]);

    const sqlUpdateSpk = `
            UPDATE tspk s 
            SET s.spk_prasj = s.spk_prasj - IFNULL(
                (SELECT SUM(d.SJD_Jumlah) 
                 FROM tsj_dtl d 
                 WHERE d.SJD_SJ_Nomor = ? AND d.sjd_spk_nomor = s.spk_nomor), 0
            )
        `;
    await conn.query(sqlUpdateSpk, [nomor]);

    await conn.commit();
    return { success: true, message: "Sukses membatalkan Surat Jalan." };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
};

module.exports = {
  // Fungsi dari Modul Browse & Pengajuan
  getBrowseSJ,
  getDetailSJ,
  deleteSJ,
  getUrutPengajuanSJ,
  submitPengajuanSJ,

  // Fungsi dari Modul Approval & Action
  getMasterSj,
  getDetailSj,
  approveSj,
  pendingSj,
  batalSj,
};
