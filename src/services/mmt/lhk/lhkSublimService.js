const pool = require("../../../config/database");
const { format } = require("date-fns");

// Tanggal kosong/invalid => filter tanggal di-skip (tanpa klausa zero-date).
const isValidDate = (v) =>
  typeof v === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(v) &&
  !isNaN(new Date(v).getTime());

const NOMERATOR = "MMT-LHK-R";

// getAllHeaders(startDate, endDate, keyword)
// Keyword dapat berupa: Nomor LHK, kode/nama Gudang, atau Nomor/Nama SPK
// (pencarian SPK dilakukan pada tabel detail tlhk_rtr_dtl via EXISTS,
//  sehingga agregasi total_meter & status mutasi tidak terganggu).
const getAllHeaders = async (startDate, endDate, keyword = "") => {
  const hasDate = isValidDate(startDate) && isValidDate(endDate);
  const kw = (keyword || "").toString().trim();

  const clauses = [];
  const params = [];

  if (hasDate) {
    clauses.push("lr_tanggal BETWEEN ? AND ?");
    params.push(startDate, endDate);
  }

  if (kw) {
    const like = `%${kw}%`;
    clauses.push(
      `(lr_nomor LIKE ?
        OR lr_gdg_kode LIKE ?
        OR gdg_nama LIKE ?
        OR EXISTS (
            SELECT 1
            FROM tlhk_rtr_dtl spk
            WHERE spk.lrd_lr_nomor = lr_nomor
              AND (spk.lrd_spk_nomor LIKE ? OR spk.lrd_spk_nama LIKE ?)
        ))`,
    );
    params.push(like, like, like, like, like);
  }

  const whereSql = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";

  const sql = `
        SELECT 
            lr_nomor AS nomor, 
            DATE_FORMAT(lr_tanggal, '%d/%m/%Y') AS Tanggal, 
            lr_gdg_kode AS Gudang, 
            gdg_nama AS Nama_Gudang,
            (SELECT SUM(lrd_panjang * lrd_lebar * lrd_jumlah) 
             FROM tlhk_rtr_dtl 
             WHERE lrd_lr_nomor = lr_nomor) AS total_meter,
            CASE
                -- Tidak ada lagi stok tersisa di seluruh detail => sudah termutasi penuh.
                WHEN COALESCE(SUM(GREATEST(COALESCE(lrd_jumlah, 0), 0)), 0) = 0 THEN 'close'
                -- Stok masih ada, tetapi pernah/sebagian sudah dimutasi.
                WHEN COALESCE(lr_mutasi, 0) = 1 THEN 'progress'
                ELSE 'open'
            END AS lsb_status
        FROM tlhk_rtr_hdr 
        LEFT JOIN tGUDANG ON gdg_kode = lr_gdg_kode
        LEFT JOIN tlhk_rtr_dtl ON lrd_lr_nomor = lr_nomor
        ${whereSql}
        GROUP BY lr_nomor, lr_tanggal, lr_gdg_kode, gdg_nama, lr_mutasi
        ORDER BY lr_tanggal DESC, lr_nomor DESC
    `;
  const [rows] = await pool.query(sql, params);
  return rows;
};

const getDetailsByNomor = async (nomor) => {
  const sqlDetail = `
        SELECT 
            lrd_lr_nomor AS Nomor, 
            DATE_FORMAT(h.lr_tanggal, '%Y-%m-%d') AS Tanggal,
            h.lr_gdg_kode AS Kode_Gudang,
            COALESCE(g.gdg_nama, 'GUDANG PRODUKSI SUBLIM') AS Nama_Gudang,
            lrd_spk_nomor AS Nomor_SPK, 
            lrd_spk_nama AS Nama_SPK, 
            lrd_panjang AS Panjang, 
            lrd_lebar AS Lebar, 
            lrd_order AS J_Order,
            COALESCE(lrd_sudah_cetak, 0) AS Sudah_Cetak,
            lrd_jumlah AS Jumlah, 
            COALESCE(lrd_qty_mutasi, 0) AS Qty_Mutasi,
            GREATEST(lrd_jumlah - COALESCE(lrd_qty_mutasi, 0), 0) AS Sisa_Belum_Mutasi,
            (lrd_panjang * lrd_lebar * lrd_jumlah) AS Jumlah_meter, 
            lrd_no_urut AS No_Urut, 
            lrd_poi_nomor AS No_PO_Internal, 
            lrd_poid_size AS Size,
            lrd_lokasi AS Lokasi,
            lrd_bahan AS Jenis_Bahan,
            lrd_komponen AS Nama_Komponen,
            COALESCE(lrd_lhk_paperprint, '') AS Lhk_Paperprint
        FROM tlhk_rtr_dtl d
        LEFT JOIN tlhk_rtr_hdr h ON h.lr_nomor = d.lrd_lr_nomor
        LEFT JOIN tGUDANG g ON g.gdg_kode = h.lr_gdg_kode
        WHERE lrd_lr_nomor = ?
        ORDER BY lrd_no_urut
    `;
  const [rows] = await pool.query(sqlDetail, [nomor]);
  return rows;
};

const getHeaderByNomor = async (nomor) => {
  const sql = `
    SELECT 
      lr_nomor AS nomor, 
      DATE_FORMAT(lr_tanggal, '%Y-%m-%d') AS Tanggal, 
      lr_gdg_kode AS Kode_Gudang, 
      COALESCE(gdg_nama, 'GUDANG PRODUKSI SUBLIM') AS Nama_Gudang
    FROM tlhk_rtr_hdr 
    LEFT JOIN tGUDANG ON gdg_kode = lr_gdg_kode
    WHERE lr_nomor = ?
    LIMIT 1
  `;
  const [[row]] = await pool.query(sql, [nomor]);
  return row || null;
};

const generateNewNomor = async (date, connection = null) => {
  const db = connection || pool;
  const yymm = format(new Date(date), "yyMM");
  const prefixMatch = `${NOMERATOR}.${yymm}.%`;

  const sqlMax = `
        SELECT MAX(CAST(SUBSTRING_INDEX(lr_nomor, '.', -1) AS UNSIGNED)) AS max_num
        FROM tlhk_rtr_hdr
        WHERE lr_nomor LIKE ?
    `;
  const [rows] = await db.query(sqlMax, [prefixMatch]);
  const maxNum = rows && rows[0].max_num ? rows[0].max_num : 0;
  const nextSequence = maxNum + 1;
  return `${NOMERATOR}.${yymm}.${String(nextSequence).padStart(4, "0")}`;
};

const saveLhk = async (data) => {
  const { header, details } = data;
  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();
    let nomorLhk = header.nomor;
    let isNew = false;

    if (!nomorLhk || nomorLhk === "AUTO") {
      nomorLhk = await generateNewNomor(header.tanggal, conn);
      isNew = true;
    }

    if (isNew) {
      const sqlInsHeader = `
                INSERT INTO tlhk_rtr_hdr (
                    lr_nomor, lr_tanggal, lr_gdg_kode, lr_date_create, lr_user_create
                ) VALUES (?, ?, ?, NOW(), ?)
            `;
      await conn.query(sqlInsHeader, [
        nomorLhk,
        header.tanggal,
        header.gdgKode,
        header.user || "SYSTEM",
      ]);
    } else {
      const sqlUpdHeader = `
                UPDATE tlhk_rtr_hdr SET 
                    lr_tanggal = ?, lr_gdg_kode = ?, lr_date_modified = NOW(), lr_user_modified = ?
                WHERE lr_nomor = ?
            `;
      await conn.query(sqlUpdHeader, [
        header.tanggal,
        header.gdgKode,
        header.user || "SYSTEM",
        nomorLhk,
      ]);
      await conn.query("DELETE FROM tlhk_rtr_dtl WHERE lrd_lr_nomor = ?", [
        nomorLhk,
      ]);
    }

    if (details && details.length > 0) {
      const sqlDetail = `
                INSERT INTO tlhk_rtr_dtl (
                    lrd_lr_nomor, lrd_no_urut, lrd_spk_nomor, lrd_spk_nama, 
                    lrd_panjang, lrd_lebar, lrd_order, lrd_sudah_cetak, lrd_jumlah, 
                    lrd_lokasi, lrd_bahan, lrd_poi_nomor, lrd_poid_size,
                    lrd_komponen, lrd_lhk_paperprint
                ) VALUES ?
            `;
      const values = details.map((d, i) => [
        nomorLhk,
        i + 1,
        d.nomor_spk,
        d.nama_spk,
        d.panjang,
        d.lebar,
        d.j_order,
        d.sudah_cetak || 0,
        d.jumlah_rtr,
        d.lokasi,
        d.jenis_bahan,
        d.poi_nomor,
        d.poi_size,
        d.nama_komponen || "",
        d.lhk_paperprint || d.nomor_paperprint || "",
      ]);

      // PERBAIKAN: Array dibungkus ganda [values] agar dideteksi sebagai Bulk Rows oleh driver mysql2
      await conn.query(sqlDetail, [values]);
    }

    await conn.commit();
    return { success: true, nomor: nomorLhk };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
};

const deleteLhk = async (nomor) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query("DELETE FROM tlhk_rtr_dtl WHERE lrd_lr_nomor = ?", [
      nomor,
    ]);
    await conn.query("DELETE FROM tlhk_rtr_hdr WHERE lr_nomor = ?", [nomor]);
    await conn.commit();
    return { success: true };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
};

module.exports = {
  getAllHeaders,
  getDetailsByNomor,
  getHeaderByNomor,
  saveLhk,
  deleteLhk,
  generateNewNomor,
};
