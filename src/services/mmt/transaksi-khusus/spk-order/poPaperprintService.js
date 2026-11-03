// backend/src/services/poPaperprint.service.js

const pool = require("../../../../config/database");
const { format } = require("date-fns");

const throwDbError = (message, error) => {
  console.error(message, error.message);
  throw new Error(message + ": " + error.message);
};

// ========================================================
// HELPER FORMAT TANGGAL SQL (YYYY-MM-DD)
// ========================================================
const toSqlDate = (dateVal) => {
  if (!dateVal) return format(new Date(), "yyyy-MM-dd");
  const d = new Date(dateVal);
  if (isNaN(d.getTime())) return format(new Date(), "yyyy-MM-dd");
  return format(d, "yyyy-MM-dd");
};

// ========================================================
// GENERATE MAX NOMOR (Format: PP.YYYYMM.XXXX)
// ========================================================
const generateMaxNomor = async (tanggal, connection = pool) => {
  const yyyymm = format(new Date(tanggal || new Date()), "yyyyMM");
  const sql = `
        SELECT MAX(RIGHT(pjh_nomor, 4)) AS maxNo 
        FROM tpopaper_hdr 
        WHERE MID(pjh_nomor, 4, 6) = ?
    `;

  try {
    const [rows] = await connection.query(sql, [yyyymm]);
    const nextSeq = rows[0]?.maxNo ? parseInt(rows[0].maxNo, 10) + 1 : 1;
    const formattedSeq = String(nextSeq).padStart(4, "0");
    return `PP.${yyyymm}.${formattedSeq}`;
  } catch (error) {
    throwDbError("Gagal membuat Nomor PO Paperprint otomatis", error);
  }
};

// ========================================================
// MASTER OPTIONS & RESOLVERS (Lookup Auto-Fill & Dropdowns)
// ========================================================
const getPaperUkuran = async () => {
  const sql = `SELECT Ukuran FROM tpaper_ukuran ORDER BY Ukuran`;
  try {
    const [rows] = await pool.query(sql);
    return rows.map((r) => r.Ukuran);
  } catch (error) {
    return ["A4", "A3", "F4", "70x100"]; // Fallback jika tabel master belum ada
  }
};

const getPaperBahan = async () => {
  const sql = `SELECT Bahan FROM tpaper_bahan ORDER BY Bahan`;
  try {
    const [rows] = await pool.query(sql);
    return rows.map((r) => r.Bahan);
  } catch (error) {
    return ["Art Paper", "HVS", "Ivory", "Duplex"]; // Fallback
  }
};

const getSupplierByKode = async (kode) => {
  const sql = `
    SELECT Sup_kode AS kode, Sup_nama AS nama, Sup_alamat AS alamat 
    FROM tsupplier 
    WHERE Sup_kode = ?
  `;
  try {
    const [rows] = await pool.query(sql, [kode]);
    return rows[0] || null;
  } catch (error) {
    throwDbError("Gagal mencari data Supplier", error);
  }
};

const getSpkByKode = async (kode) => {
  const sql = `
    SELECT * FROM (
      SELECT 
        spk_nomor AS SPK, 
        spk_nama AS Nama, 
        spk_ukuran AS Ukuran, 
        spk_kain AS Bahan, 
        spk_finishing AS Finishing,
        spk_jumlah AS Jumlah
      FROM tspk 
      WHERE spk_aktif = 'Y'
      
      UNION ALL
      
      SELECT 
        mspk_nomor AS SPK, 
        mspk_nama AS Nama, 
        mspk_ukuran AS Ukuran, 
        mspk_kain AS Bahan, 
        mspk_finishing AS Finishing,
        mspk_jumlah AS Jumlah
      FROM tmemospk
    ) x 
    WHERE x.SPK = ? 
    LIMIT 1
  `;
  try {
    const [rows] = await pool.query(sql, [kode]);
    return rows[0] || null;
  } catch (error) {
    throwDbError("Gagal mencari data SPK", error);
  }
};

// ========================================================
// READ MASTER DATA (Browse - SQLMaster)
// ========================================================
const getPoPaperprintMaster = async (startDate, endDate) => {
  const sqlMaster = `
        SELECT
            pjh_nomor AS Nomor,
            pjh_cab AS Cab,
            DATE_FORMAT(pjh_tanggal, '%Y-%m-%d') AS Tanggal,
            DATE_FORMAT(pjh_dateline, '%Y-%m-%d') AS Dateline,
            pjh_sup_kode AS KodeSup,
            s.Sup_nama AS Supplier,
            s.Sup_alamat AS Alamat,
            pjh_ket AS Keterangan
        FROM tpopaper_hdr pjh
        LEFT JOIN tsupplier s ON s.Sup_kode = pjh.pjh_sup_kode
        WHERE pjh_tanggal BETWEEN ? AND ?
        GROUP BY pjh_nomor
        ORDER BY pjh_tanggal DESC
    `;

  try {
    const [rows] = await pool.query(sqlMaster, [startDate, endDate]);
    return rows;
  } catch (error) {
    throwDbError("Gagal memuat data master PO Paperprint", error);
  }
};

// ========================================================
// READ DETAIL DATA (Form Load)
// ========================================================
const getPoPaperprintDetail = async (nomor) => {
  const sqlDetail = `
        SELECT
            pjd_nomor AS Nomor,
            pjd_spk AS Spk,
            pjd_nama AS NamaSpk,
            pjd_ukuran AS Ukuran,
            pjd_bahan AS Bahan,
            pjd_finishing AS Finishing,
            pjd_qty AS Qty,
            pjd_harga AS Harga,
            (pjd_qty * pjd_harga) AS Total,
            pjd_ket AS Keterangan,
            pjd_idgambar AS IdGambar
        FROM tpopaper_dtl
        WHERE pjd_nomor = ? 
        ORDER BY pjd_nomor
    `;

  try {
    const [rows] = await pool.query(sqlDetail, [nomor]);
    return rows;
  } catch (error) {
    throwDbError("Gagal memuat data detail PO Paperprint", error);
  }
};

// ========================================================
// CREATE / SIMPAN DATA (Mode Add)
// ========================================================
const createPoPaperprint = async (dataPayload, files, user) => {
  const header = dataPayload.header || dataPayload;
  const details = dataPayload.details || [];

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    // 1. AUTO GENERATE NOMOR JIKA KOSONG
    let nomor = header.nomor || header.pjh_nomor;
    if (
      !nomor ||
      String(nomor).trim() === "" ||
      String(nomor).includes("Kosong")
    ) {
      nomor = await generateMaxNomor(header.tanggal, connection);
    }

    const tanggal = toSqlDate(header.tanggal || header.pjh_tanggal);
    const dateline = toSqlDate(
      header.dateline || header.pjh_dateline || tanggal,
    );
    const cabang = header.cabang || header.cab || header.pjh_cab || "P01";
    const supKode =
      header.supKode || header.sup_kode || header.pjh_sup_kode || "00164";
    const keterangan = header.keterangan || header.ket || header.pjh_ket || "";
    const kdUser = user?.kdUser || user?.username || header.kdUser || "ADMIN";

    // 2. QUERY INSERT HEADER
    const sqlHeader = `
      INSERT INTO tpopaper_hdr (
        pjh_nomor, 
        pjh_tanggal, 
        pjh_dateline, 
        pjh_sup_kode, 
        pjh_ket, 
        pjh_cab, 
        user_create, 
        date_create
      ) VALUES (?, ?, ?, ?, ?, ?, ?, NOW())
    `;

    const valuesHeader = [
      nomor,
      tanggal,
      dateline,
      supKode,
      keterangan,
      cabang,
      kdUser,
    ];

    await connection.query(sqlHeader, valuesHeader);

    // 3. QUERY INSERT DETAIL
    if (details.length > 0) {
      const sqlDetail = `
        INSERT INTO tpopaper_dtl (
          pjd_nomor, pjd_spk, pjd_nama, pjd_ukuran, pjd_bahan, pjd_finishing, pjd_qty, pjd_ket
        ) VALUES ?
      `;

      const valuesDetail = details.map((row) => [
        nomor,
        row.spk || row.pjd_spk || "",
        row.nama || row.pjd_nama || "",
        row.ukuran || row.pjd_ukuran || "",
        row.bahan || row.pjd_bahan || "",
        row.finishing || row.pjd_finishing || "",
        Number(row.jumlah || row.pjd_qty || row.qty) || 0,
        row.ket || row.pjd_ket || "",
      ]);

      await connection.query(sqlDetail, [valuesDetail]);
    }

    await connection.commit();
    return { nomor };
  } catch (error) {
    await connection.rollback();
    throwDbError("Gagal menyimpan PO Paperprint", error);
  } finally {
    connection.release();
  }
};

// ========================================================
// UPDATE / EDIT DATA (Mode Edit)
// ========================================================
const updatePoPaperprint = async (nomor, dataPayload, files, user) => {
  const header = dataPayload.header || dataPayload;
  const details = dataPayload.details || [];

  const tanggal = toSqlDate(header.tanggal || header.pjh_tanggal);
  const dateline = toSqlDate(header.dateline || header.pjh_dateline || tanggal);
  const cabang = header.cabang || header.cab || header.pjh_cab || "P01";
  const supKode =
    header.supKode || header.sup_kode || header.pjh_sup_kode || "00164";
  const keterangan = header.keterangan || header.ket || header.pjh_ket || "";
  const kdUser = user?.kdUser || user?.username || header.kdUser || "ADMIN";

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const sqlHeader = `
      UPDATE tpopaper_hdr SET
        pjh_tanggal = ?, 
        pjh_dateline = ?, 
        pjh_sup_kode = ?, 
        pjh_ket = ?, 
        pjh_cab = ?, 
        user_modified = ?, 
        date_modified = NOW()
      WHERE pjh_nomor = ?
    `;

    const valuesHeader = [
      tanggal,
      dateline,
      supKode,
      keterangan,
      cabang,
      kdUser,
      nomor,
    ];

    await connection.query(sqlHeader, valuesHeader);

    // Hapus detail lama dan ganti dengan detail baru
    await connection.query(`DELETE FROM tpopaper_dtl WHERE pjd_nomor = ?`, [
      nomor,
    ]);

    if (details.length > 0) {
      const sqlDetail = `
        INSERT INTO tpopaper_dtl (
          pjd_nomor, pjd_spk, pjd_nama, pjd_ukuran, pjd_bahan, pjd_finishing, pjd_qty, pjd_ket
        ) VALUES ?
      `;

      const valuesDetail = details.map((row) => [
        nomor,
        row.spk || row.pjd_spk || "",
        row.nama || row.pjd_nama || "",
        row.ukuran || row.pjd_ukuran || "",
        row.bahan || row.pjd_bahan || "",
        row.finishing || row.pjd_finishing || "",
        Number(row.jumlah || row.pjd_qty || row.qty) || 0,
        row.ket || row.pjd_ket || "",
      ]);

      await connection.query(sqlDetail, [valuesDetail]);
    }

    await connection.commit();
    return { nomor };
  } catch (error) {
    await connection.rollback();
    throwDbError("Gagal mengubah PO Paperprint", error);
  } finally {
    connection.release();
  }
};

// ========================================================
// DELETE
// ========================================================
const deletePoPaperprint = async (nomor) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    await connection.query("DELETE FROM tpopaper_dtl WHERE pjd_nomor = ?", [
      nomor,
    ]);

    const [headerResult] = await connection.query(
      "DELETE FROM tpopaper_hdr WHERE pjh_nomor = ?",
      [nomor],
    );

    if (headerResult.affectedRows === 0) {
      throw new Error("Nomor transaksi tidak ditemukan atau sudah terhapus.");
    }

    await connection.commit();
    return true;
  } catch (error) {
    if (connection) await connection.rollback();
    throwDbError("Gagal menghapus transaksi PO Paperprint", error);
  } finally {
    if (connection) connection.release();
  }
};

// --- EKSPOR FINAL ---
module.exports = {
  generateMaxNomor,
  getPaperUkuran,
  getPaperBahan,
  getSupplierByKode,
  getSpkByKode,
  getPoPaperprintMaster,
  getPoPaperprintDetail,
  createPoPaperprint,
  updatePoPaperprint,
  deletePoPaperprint,
};
