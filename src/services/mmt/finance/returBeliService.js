const pool = require("../../../config/database");
const { format } = require("date-fns");

const throwDbError = (message, error) => {
  throw new Error(message + ": " + error.message);
};

/**
 * Mendapatkan nomor urut otomatis untuk Retur Beli
 * Format: MMT.RB.YYMM.0001
 */
exports.getNewNomorReturBeli = async () => {
  const NOMERATOR = "MMT.RB"; // RB untuk Retur Beli
  try {
    const currentYYMM = format(new Date(), "yyMM");
    const searchPattern = `${NOMERATOR}.${currentYYMM}.%`;

    const sql = `
            SELECT MAX(ret_nomor) AS MaxNomor 
            FROM tret_hdr_mmt 
            WHERE ret_nomor LIKE ?;
        `;

    const [results] = await pool.query(sql, [searchPattern]);
    const maxNomor = results[0]?.MaxNomor;

    let newNumber = "0001";
    if (maxNomor) {
      const lastNumberString = maxNomor.substring(
        maxNomor.lastIndexOf(".") + 1,
      );
      const lastNumber = parseInt(lastNumberString, 10);
      newNumber = (lastNumber + 1).toString().padStart(4, "0");
    }
    return `${NOMERATOR}.${currentYYMM}.${newNumber}`;
  } catch (error) {
    throwDbError("Gagal mendapatkan nomor retur beli baru", error);
  }
};

/**
 * Menyimpan data Retur Beli (Header & Detail)
 */
exports.saveReturBeli = async (data, isUpdate = false, userLogin) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    let {
      Nomor,
      Gudang,
      Tanggal,
      Keterangan,
      SupplierKode, // Field supplier wajib/utama pada retur beli
      NoPenerimaan, // Relasi ke nomor penerimaan/pembelian asli (ret_rec_nomor)
      Details,
    } = data;

    const serverTime = new Date();
    const activeUser = userLogin || "SYSTEM";

    // 1. Logika Penomoran Automatis
    if (!isUpdate && (!Nomor || Nomor === "AUTO")) {
      Nomor = await exports.getNewNomorReturBeli();
    }

    if (isUpdate) {
      // Update Header
      await connection.query(
        `UPDATE tret_hdr_mmt SET 
                    ret_gdg_kode=?, 
                    ret_tanggal=?, 
                    ret_sup_kode=?,
                    ret_rec_nomor=?,
                    ret_memo=?, 
                    user_modified=?, 
                    date_modified=? 
                WHERE ret_nomor=?`,
        [
          Gudang,
          Tanggal,
          SupplierKode || "",
          NoPenerimaan || "",
          Keterangan,
          activeUser,
          serverTime,
          Nomor,
        ],
      );
      // Hapus detail lama untuk diganti dengan detail baru
      await connection.query(
        "DELETE FROM tret_dtl_mmt WHERE retd_ret_nomor = ?",
        [Nomor],
      );
    } else {
      // Insert Header Baru
      await connection.query(
        `INSERT INTO tret_hdr_mmt 
                    (ret_nomor, ret_gdg_kode, ret_tanggal, ret_sup_kode, ret_rec_nomor, ret_memo, user_create, date_create) 
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          Nomor,
          Gudang,
          Tanggal,
          SupplierKode || "",
          NoPenerimaan || "",
          Keterangan,
          activeUser,
          serverTime,
        ],
      );
    }

    // 2. Simpan Detail Retur Beli
    if (Details && Details.length > 0) {
      const detailValues = Details.map((d, index) => [
        Nomor, // retd_ret_nomor
        d.sku, // retd_brg_kode
        d.satuan, // retd_brg_satuan
        d.qty, // retd_qty
        d.harga || 0, // retd_harga
        d.diskon || 0, // retd_discpr
        index + 1, // retd_nourut
        d.expired || null, // retd_expired (DATE)
        d.keterangan || "", // retd_keterangan
      ]);

      await connection.query(
        `INSERT INTO tret_dtl_mmt 
                (retd_ret_nomor, retd_brg_kode, retd_brg_satuan, retd_qty, retd_harga, retd_discpr, retd_nourut, retd_expired, retd_keterangan) 
                VALUES ?`,
        [detailValues],
      );
    }

    await connection.commit();
    return { success: true, nomor: Nomor };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

/**
 * Menghapus data Retur Beli
 */
exports.deleteReturBeli = async (nomor) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.query(
      "DELETE FROM tret_dtl_mmt WHERE retd_ret_nomor = ?",
      [nomor],
    );
    const [result] = await connection.query(
      "DELETE FROM tret_hdr_mmt WHERE ret_nomor = ?",
      [nomor],
    );
    await connection.commit();
    return result.affectedRows > 0;
  } catch (error) {
    await connection.rollback();
    throwDbError("Gagal menghapus data retur beli", error);
  } finally {
    connection.release();
  }
};

/**
 * Mendapatkan daftar Header Retur Beli (dengan pagination & pencarian opsional)
 */
exports.getAllReturBeli = async (options = {}) => {
  try {
    const {
      search = "",
      startDate = "",
      endDate = "",
      limit = 10,
      offset = 0,
    } = options;

    let whereClauses = [];
    let queryParams = [];

    // 1. Filter Search (Pencarian Nomor, Kode Supplier, atau Keterangan)
    if (search) {
      const searchPattern = `%${search}%`;
      whereClauses.push(
        `(h.ret_nomor LIKE ? OR h.ret_sup_kode LIKE ? OR h.ret_memo LIKE ?)`,
      );
      queryParams.push(searchPattern, searchPattern, searchPattern);
    }

    // 2. Filter Start Date (Tanggal Mulai)
    if (startDate) {
      whereClauses.push(`DATE(h.ret_tanggal) >= ?`);
      queryParams.push(startDate);
    }

    // 3. Filter End Date (Tanggal Akhir)
    if (endDate) {
      whereClauses.push(`DATE(h.ret_tanggal) <= ?`);
      queryParams.push(endDate);
    }

    // Gabungkan kondisi WHERE jika ada
    const whereSql =
      whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";

    // Query Utama
    const sql = `
            SELECT 
                h.ret_nomor AS Nomor,
                h.ret_gdg_kode AS Gudang,
                h.ret_tanggal AS Tanggal,
                h.ret_sup_kode AS SupplierKode,
                h.ret_rec_nomor AS NoPenerimaan,
                h.ret_memo AS Keterangan,
                h.user_create AS UserCreate,
                h.date_create AS DateCreate,
                h.user_modified AS UserModified,
                h.date_modified AS DateModified
            FROM tret_hdr_mmt h
            ${whereSql}
            ORDER BY h.ret_tanggal DESC, h.date_create DESC
            LIMIT ? OFFSET ?;
        `;

    queryParams.push(Number(limit), Number(offset));

    const [rows] = await pool.query(sql, queryParams);
    return rows;
  } catch (error) {
    throwDbError("Gagal mengambil daftar retur beli", error);
  }
};

/**
 * Mendapatkan 1 data Retur Beli lengkap (Header beserta Detail-nya) berdasarkan Nomor
 */
exports.getReturBeliByNomor = async (nomor) => {
  try {
    // 1. Ambil Header Retur Beli
    const sqlHeader = `
            SELECT 
                ret_nomor AS Nomor,
                ret_gdg_kode AS Gudang,
                ret_tanggal AS Tanggal,
                ret_sup_kode AS SupplierKode,
                ret_rec_nomor AS NoPenerimaan,
                ret_memo AS Keterangan,
                user_create AS UserCreate,
                date_create AS DateCreate,
                user_modified AS UserModified,
                date_modified AS DateModified
            FROM tret_hdr_mmt
            WHERE ret_nomor = ?;
        `;

    const [headerRows] = await pool.query(sqlHeader, [nomor]);

    if (headerRows.length === 0) {
      return null;
    }

    // 2. Ambil Detail Retur Beli
    const sqlDetail = `
            SELECT 
                retd_nourut AS noUrut,
                retd_brg_kode AS sku,
                retd_brg_satuan AS satuan,
                retd_qty AS qty,
                retd_harga AS harga,
                retd_discpr AS diskon,
                retd_expired AS expired,
                retd_keterangan AS keterangan
            FROM tret_dtl_mmt
            WHERE retd_ret_nomor = ?
            ORDER BY retd_nourut ASC;
        `;

    const [detailRows] = await pool.query(sqlDetail, [nomor]);

    // 3. Gabungkan Header dan Detail
    return {
      ...headerRows[0],
      Details: detailRows,
    };
  } catch (error) {
    throwDbError(`Gagal mengambil data retur beli untuk nomor ${nomor}`, error);
  }
};
