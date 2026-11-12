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

    let Nomor = data.Nomor || data.nomor;
    let Gudang = data.Gudang || data.gudangKode || data.gudang || "WH-16";
    let Tanggal = data.Tanggal || data.tanggal;
    let Keterangan = data.Keterangan || data.keterangan || data.Memo || data.memo || "";
    let SupplierKode = data.SupplierKode || data.supplierKode || "";
    let NoPenerimaan = data.NoPenerimaan || data.noPenerimaan || data.InvoiceNomor || data.invoiceNomor || "";
    let IsPajak = (data.IsPajak !== undefined ? data.IsPajak : (data.isPajak !== undefined ? data.isPajak : 1)) ? 1 : 0;
    let DiscPrHeader = Number(data.DiscPrHeader ?? data.discPrHeader ?? 0);
    let DiscRpHeader = Number(data.DiscRpHeader ?? data.discRpHeader ?? 0);
    let TotalAmount = Number(data.TotalAmount ?? data.totalAmount ?? data.Total ?? data.total ?? 0);
    let TaxAmount = Number(data.TaxAmount ?? data.taxAmount ?? data.PPN ?? data.ppn ?? 0);
    let Details = data.Details || data.details || data.items || data.detail || [];

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
                    ret_istax=?,
                    ret_disc_fakturpr=?,
                    ret_disc_faktur=?,
                    ret_amount=?,
                    ret_taxamount=?,
                    user_modified=?, 
                    date_modified=? 
                WHERE ret_nomor=?`,
        [
          Gudang,
          Tanggal,
          SupplierKode || "",
          NoPenerimaan || "",
          Keterangan,
          IsPajak,
          DiscPrHeader,
          DiscRpHeader,
          TotalAmount,
          TaxAmount,
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
                    (ret_nomor, ret_gdg_kode, ret_tanggal, ret_sup_kode, ret_rec_nomor, ret_memo, ret_istax, ret_disc_fakturpr, ret_disc_faktur, ret_amount, ret_taxamount, user_create, date_create) 
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          Nomor,
          Gudang,
          Tanggal,
          SupplierKode || "",
          NoPenerimaan || "",
          Keterangan,
          IsPajak,
          DiscPrHeader,
          DiscRpHeader,
          TotalAmount,
          TaxAmount,
          activeUser,
          serverTime,
        ],
      );
    }

    // 2. Simpan Detail Retur Beli
    if (Details && Details.length > 0) {
      const validDetails = Details.filter(
        (d) => (d.sku || d.Kode || d.brg_kode || d.barcode) && Number(d.qty || 0) > 0,
      );
      if (validDetails.length > 0) {
        const detailValues = validDetails.map((d, index) => [
          Nomor, // retd_ret_nomor
          d.sku || d.Kode || d.brg_kode || "", // retd_brg_kode
          d.satuan || d.Satuan || d.brg_satuan || "ROLL", // retd_brg_satuan
          Number(d.qty || 0), // retd_qty
          Number(d.harga || d.Harga || 0), // retd_harga
          Number(d.diskon || d.disc || d.discpr || 0), // retd_discpr
          index + 1, // retd_nourut
          d.expired || null, // retd_expired (DATE)
          d.keterangan || d.Keterangan || "", // retd_keterangan
        ]);

        await connection.query(
          `INSERT INTO tret_dtl_mmt 
                  (retd_ret_nomor, retd_brg_kode, retd_brg_satuan, retd_qty, retd_harga, retd_discpr, retd_nourut, retd_expired, retd_keterangan) 
                  VALUES ?`,
          [detailValues],
        );
      }
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

    // 1. Filter Search (Pencarian Nomor, Kode Supplier, Nama Supplier, No Penerimaan, atau Keterangan)
    if (search) {
      const searchPattern = `%${search}%`;
      whereClauses.push(
        `(h.ret_nomor LIKE ? OR h.ret_sup_kode LIKE ? OR s.sup_nama LIKE ? OR h.ret_rec_nomor LIKE ? OR h.ret_memo LIKE ?)`,
      );
      queryParams.push(
        searchPattern,
        searchPattern,
        searchPattern,
        searchPattern,
        searchPattern,
      );
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
                IFNULL(s.sup_nama, '') AS SupplierNama,
                h.ret_rec_nomor AS NoPenerimaan,
                h.ret_memo AS Keterangan,
                h.user_create AS UserCreate,
                h.date_create AS DateCreate,
                h.user_modified AS UserModified,
                h.date_modified AS DateModified
            FROM tret_hdr_mmt h
            LEFT JOIN tsupplier s ON s.sup_kode = h.ret_sup_kode
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
                h.ret_nomor AS Nomor,
                h.ret_gdg_kode AS Gudang,
                IFNULL(g.gdg_nama, 'Gudang Bahan MMT') AS GudangNama,
                h.ret_tanggal AS Tanggal,
                h.ret_sup_kode AS SupplierKode,
                IFNULL(s.sup_nama, '') AS SupplierNama,
                h.ret_rec_nomor AS NoPenerimaan,
                h.ret_memo AS Keterangan,
                IFNULL(h.ret_istax, 1) AS IsPajak,
                IFNULL(h.ret_disc_fakturpr, 0) AS DiscPrHeader,
                IFNULL(h.ret_disc_faktur, 0) AS DiscRpHeader,
                IFNULL(h.ret_amount, 0) AS TotalAmount,
                IFNULL(h.ret_taxamount, 0) AS TaxAmount,
                h.user_create AS UserCreate,
                h.date_create AS DateCreate,
                h.user_modified AS UserModified,
                h.date_modified AS DateModified
            FROM tret_hdr_mmt h
            LEFT JOIN tsupplier s ON s.sup_kode = h.ret_sup_kode
            LEFT JOIN tgudang g ON g.gdg_kode = h.ret_gdg_kode
            WHERE h.ret_nomor = ?;
        `;

    const [headerRows] = await pool.query(sqlHeader, [nomor]);

    if (headerRows.length === 0) {
      return null;
    }

    // 2. Ambil Detail Retur Beli
    const sqlDetail = `
            SELECT 
                d.retd_nourut AS noUrut,
                d.retd_brg_kode AS sku,
                COALESCE(b.brg_nama, d.retd_brg_kode) AS namaBarang,
                IFNULL(b.brg_panjang, 0) AS panjang,
                IFNULL(b.brg_lebar, 0) AS lebar,
                d.retd_brg_satuan AS satuan,
                d.retd_qty AS qty,
                d.retd_harga AS harga,
                d.retd_discpr AS diskon,
                d.retd_expired AS expired,
                d.retd_keterangan AS keterangan
            FROM tret_dtl_mmt d
            LEFT JOIN tbarang_mmt b ON b.brg_kode = d.retd_brg_kode
            WHERE d.retd_ret_nomor = ?
            ORDER BY d.retd_nourut ASC;
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

/**
 * Scan Barcode Rol atau Cari SKU Barang MMT
 */
exports.scanBarcodeOrSku = async (code) => {
  if (!code) return null;
  const cleanCode = String(code).trim();
  try {
    // 1. Cek di tmasterstok_mmt by mst_barcode
    const [stokRows] = await pool.query(
      `SELECT 
          m.mst_barcode AS barcode, 
          m.mst_brg_kode AS sku, 
          COALESCE(b.brg_nama, m.mst_brg_kode) AS namaBarang,
          b.brg_satuan AS satuan, 
          IFNULL(m.mst_panjang, b.brg_panjang) AS panjang,
          IFNULL(m.mst_lebar, b.brg_lebar) AS lebar,
          COALESCE(m.mst_hargabeli, b.brg_hrgbeli, 0) AS harga
       FROM tmasterstok_mmt m
       LEFT JOIN tbarang_mmt b ON b.brg_kode = m.mst_brg_kode
       WHERE m.mst_barcode = ? LIMIT 1`,
      [cleanCode]
    );
    if (stokRows.length > 0) return stokRows[0];

    // 2. Cek di tbarang_mmt by brg_kode
    const [brgRows] = await pool.query(
      `SELECT 
          '' AS barcode, 
          brg_kode AS sku, 
          brg_nama AS namaBarang,
          brg_satuan AS satuan, 
          IFNULL(brg_panjang, 0) AS panjang,
          IFNULL(brg_lebar, 0) AS lebar,
          IFNULL(brg_hrgbeli, 0) AS harga
       FROM tbarang_mmt
       WHERE brg_kode = ? LIMIT 1`,
      [cleanCode]
    );
    if (brgRows.length > 0) return brgRows[0];

    return null;
  } catch (error) {
    throwDbError(`Gagal scan barang untuk kode ${code}`, error);
  }
};
