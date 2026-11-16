// backend/src/services/pengajuanPermintaan.service.js
const pool = require("../../../config/database");
const { format } = require("date-fns");

const throwDbError = (message, error) => {
  console.error(message, error.message);
  throw new Error(message + ": " + error.message);
};

// ===================================
// GENERATE NOMOR (PP.YYMM.0001)
// ===================================
exports.generateMaxKode = async (tanggal) => {
  const NOMERATOR = "MMT.PP"; // PP untuk Pengajuan Permintaan
  const yyMm = format(new Date(tanggal), "yyMM");
  const prefix = `${NOMERATOR}.${yyMm}.%`;
  const sql = `SELECT MAX(CAST(RIGHT(pp_nomor, 4) AS UNSIGNED)) AS max_num FROM tpengajuan_permintaan_hdr WHERE pp_nomor LIKE ?`;

  const [rows] = await pool.query(sql, [prefix]);
  const maxNum = rows[0].max_num || 0;
  const nextNumber = maxNum + 1;
  const paddedNextNumber = String(nextNumber).padStart(4, "0");

  return `${NOMERATOR}.${yyMm}.${paddedNextNumber}`;
};

// ===================================
// READ ALL & LOOKUP
// ===================================
// backend/src/services/pengajuanPermintaan.service.js

// --- UPDATE READ ALL (Agar data Gudang tampil di tabel utama) ---
exports.getPengajuanData = async (startDate, endDate) => {
  try {
    // --- 1. Sub-query Agregasi ---
    const sqlAggregates = `
            SELECT
                ppd_pp_nomor,
                SUM(ppd_qty) AS Total_Diminta,
                COUNT(*) AS Total_Baris_Detail
            FROM tpengajuan_permintaan_dtl
            GROUP BY ppd_pp_nomor
        `;

    const sqlMaster = `
            SELECT
                t1.pp_nomor AS Nomor,
                t1.pp_gdg_kode AS Gudang,
                t3.gdg_nama AS Nama,
                DATE_FORMAT(t1.pp_tanggal, '%d/%m/%Y') AS Tanggal,
                t1.pp_jenis AS Jenis,
                t1.pp_priority AS Priority,
                t1.pp_keterangan AS Keterangan,
                t1.pp_to_user AS Ditujukan_Ke,
                
                -- DIPERBAIKI: Mengambil nama user secara dinamis dari kolom database
                CASE 
                    WHEN t1.pp_acc_req = 'Y' AND t1.pp_acc_req_user IS NOT NULL AND t1.pp_acc_req_user != '' 
                        THEN CONCAT('ACC ', UPPER(t1.pp_acc_req_user))
                    WHEN t1.pp_acc_req = 'Y' 
                        THEN 'ACC EKAMMT' -- Fallback jika kolom user kosong tapi status Y
                    ELSE 'PENDING'
                END AS Status_Acc,
                
                -- Kirim juga nilai aslinya jika dibutuhkan frontend
                t1.pp_acc_req_user AS Acc_SPV, 
                
                -- DATA AGREGASI --
                IFNULL(t2.Total_Diminta, 0) AS Total_Diminta,
                
                -- LOGIKA STATUS --
                CASE
                    WHEN t2.Total_Baris_Detail IS NULL OR t2.Total_Baris_Detail = 0 THEN 'OPEN'
                    WHEN t1.pp_acc = 'Y' THEN 'CLOSED'
                    ELSE 'OPEN'
                END AS Status_PO,

                CASE
                    WHEN t1.pp_acc = 'Y' THEN 'CLOSED'
                    ELSE 'OPEN'
                END AS Status_Diterima

            FROM tpengajuan_permintaan_hdr t1
            LEFT JOIN (${sqlAggregates}) t2 ON t2.ppd_pp_nomor = t1.pp_nomor
            LEFT JOIN tgudang t3 ON t3.gdg_kode = t1.pp_gdg_kode
            LEFT JOIN tuser tu ON t1.user_create = tu.user_kode 
            WHERE t1.pp_tanggal BETWEEN ? AND ?
            ORDER BY t1.pp_tanggal DESC;
        `;

    const [masterResults] = await pool.query(sqlMaster, [startDate, endDate]);
    const masterNomors = masterResults.map((row) => row.Nomor);

    if (masterNomors.length === 0) return [];

    // --- 2. Query Detail ---
    const sqlDetail = `
            SELECT
                ppd_pp_nomor AS Nomor, 
                ppd_spk_nomor AS Nomor_SPK, 
                TRIM(x.spk_nama) AS spk_nama,
                brg_kode AS Kode, 
                'Y' AS Is_Acc, 
                0 AS Jumlah_terima, 
                TRIM(brg_nama) AS Nama_Bahan, 
                ppd_qty AS Jumlah,
                ppd_brg_satuan AS Satuan, 
                brg_panjang AS Panjang, 
                brg_lebar AS Lebar,
                ppd_keterangan AS KeteranganItem
            FROM tpengajuan_permintaan_dtl
            LEFT JOIN tbarang_mmt ON ppd_brg_kode = brg_kode
            LEFT JOIN (
                SELECT spk_nomor, spk_nama FROM tspk 
                UNION ALL 
                SELECT mspk_nomor, mspk_nama FROM tmemospk
            ) x ON x.spk_nomor = ppd_spk_nomor
            WHERE ppd_pp_nomor IN (?)
            ORDER BY ppd_pp_nomor, ppd_nourut;
        `;

    const [detailResults] = await pool.query(sqlDetail, [masterNomors]);

    // --- 3. Mapping Data ---
    const dataMap = new Map();
    masterResults.forEach((item) =>
      dataMap.set(item.Nomor, { ...item, Detail: [] }),
    );

    detailResults.forEach((detail) => {
      if (dataMap.has(detail.Nomor)) {
        dataMap.get(detail.Nomor).Detail.push(detail);
      }
    });

    return Array.from(dataMap.values());
  } catch (error) {
    console.error("Database Error:", error);
    throw new Error("Gagal mengambil data Pengajuan Permintaan");
  }
};

// --- UPDATE SAVE (Menyimpan Gudang) ---
exports.savePengajuan = async (data, nomorToEdit, userLogin) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const currentNomor =
      nomorToEdit || (await exports.generateMaxKode(data.Tanggal));
    const serverTime = format(new Date(), "yyyy-MM-dd HH:mm:ss");

    if (nomorToEdit) {
      await connection.query(
        `
    UPDATE tpengajuan_permintaan_hdr SET 
    pp_tanggal = ?, 
    pp_jenis = ?, 
    pp_keterangan = ?, 
    pp_to_user = ?, 
    pp_gdg_kode = ?, 
    date_modified = ?, 
    user_modified = ? 
    WHERE pp_nomor = ?`,
        [
          data.Tanggal,
          data.Jenis,
          data.Keterangan,
          data.Kepada,
          data.GudangKode,
          serverTime,
          userLogin,
          currentNomor,
        ],
      );

      await connection.query(
        "DELETE FROM tpengajuan_permintaan_dtl WHERE ppd_pp_nomor = ?",
        [currentNomor],
      );
    } else {
      await connection.query(
        `
    INSERT INTO tpengajuan_permintaan_hdr 
    (pp_nomor, pp_tanggal,  pp_jenis, pp_priority, pp_keterangan, pp_to_user, pp_gdg_kode, date_create, user_create) 
    VALUES (?, ?, ?, ?, ?, ?, ?, ?,?)`,
        [
          currentNomor,
          data.Tanggal,
          data.Jenis,
          data.Priority,
          data.Keterangan,
          data.Kepada,
          data.GudangKode,
          serverTime,
          userLogin,
        ],
      );
    }

    const detailValues = data.Detail.map((d, index) => [
      currentNomor,
      d.Kode_Bahan,
      d.Jumlah,
      d.Satuan,
      d.Keterangan,
      d.Nomor_SPK,
      index + 1,
    ]);

    await connection.query(
      `
            INSERT INTO tpengajuan_permintaan_dtl 
            (ppd_pp_nomor, ppd_brg_kode, ppd_qty, ppd_brg_satuan, ppd_keterangan, ppd_spk_nomor, ppd_nourut) 
            VALUES ?`,
      [detailValues],
    );

    await connection.commit();
    return { Nomor: currentNomor };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

exports.deletePengajuan = async (nomor) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [hdr] = await connection.query(
      `SELECT pp_acc_req, pp_acc FROM tpengajuan_permintaan_hdr WHERE pp_nomor = ?`,
      [nomor]
    );
    if (!hdr.length) {
      throw new Error(`Data pengajuan ${nomor} tidak ditemukan.`);
    }
    if (hdr[0].pp_acc === 'Y' || hdr[0].pp_acc_req === 'Y') {
      throw new Error(`Pengajuan ${nomor} sudah di-ACC dan tidak dapat dihapus.`);
    }
    await connection.query(`DELETE FROM tpengajuan_permintaan_dtl WHERE ppd_pp_nomor = ?`, [nomor]);
    await connection.query(`DELETE FROM tpengajuan_permintaan_hdr WHERE pp_nomor = ?`, [nomor]);
    await connection.commit();
    return true;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

// ===================================
// LOOKUP PENGAJUAN (Header + Detail)
// ===================================
exports.getPengajuanForLookup = async (startDate, endDate) => {
  try {
    let whereClause = "WHERE t1.pp_acc_req = 'Y'";
    const queryParams = [];

    if (startDate && endDate) {
      whereClause += " AND (t1.pp_tanggal BETWEEN ? AND ? OR NOT EXISTS (SELECT 1 FROM tmintabahan_mmt_hdr mb WHERE mb.mb_pp_nomor = t1.pp_nomor))";
      queryParams.push(startDate, endDate);
    }

    // --- 1. AMBIL MASTER (HEADER) ---
    const sqlMaster = `
            SELECT 
                t1.pp_nomor AS Nomor,
                DATE_FORMAT(t1.pp_tanggal, '%Y-%m-%d') AS Tanggal,
                t1.pp_jenis AS Jenis,
                t1.pp_priority AS Priority,
                t1.pp_to_user AS Ditujukan_Ke,
                t1.pp_keterangan AS Keterangan,

                'Y' AS StatusAccSpv, 
                t1.pp_acc_req AS Status_Acc,
                t2.user_nama AS Pembuat,

                -- ✅ STATUS SUDAH / BELUM DIPROSES
                CASE
                    WHEN EXISTS (
                        SELECT 1 
                        FROM tmintabahan_mmt_hdr mb
                        WHERE mb.mb_pp_nomor = t1.pp_nomor
                    ) THEN 'CLOSE'
                    ELSE 'OPEN'
                END AS Status_Proses

            FROM tpengajuan_permintaan_hdr t1
            LEFT JOIN tuser t2 ON t1.user_create = t2.user_kode
            ${whereClause}
            ORDER BY t1.pp_tanggal DESC, t1.pp_nomor DESC;
        `;

    const [masterResults] = await pool.query(sqlMaster, queryParams);

    const masterNomors = masterResults.map((row) => row.Nomor);
    if (masterNomors.length === 0) return [];

    // --- 2. AMBIL DETAIL ---
    const sqlDetail = `
            SELECT 
                ppd_pp_nomor AS Nomor, 
                ppd_spk_nomor AS Nomor_SPK, 
                TRIM(x.spk_nama) AS spk_nama,
                ppd_brg_kode AS Kode, 
                TRIM(b.brg_nama) AS Nama_Bahan, 
                ppd_qty AS Jumlah,
                ppd_brg_satuan AS Satuan, 
                b.brg_panjang AS Panjang, 
                b.brg_lebar AS Lebar,
                ppd_keterangan AS KeteranganItem
            FROM tpengajuan_permintaan_dtl d
            LEFT JOIN tbarang_mmt b ON d.ppd_brg_kode = b.brg_kode
            LEFT JOIN (
                SELECT spk_nomor, spk_nama FROM tspk 
                UNION ALL 
                SELECT mspk_nomor, mspk_nama FROM tmemospk
            ) x ON x.spk_nomor = d.ppd_spk_nomor
            WHERE d.ppd_pp_nomor IN (?)
            ORDER BY d.ppd_pp_nomor, d.ppd_nourut;
        `;

    const [detailResults] = await pool.query(sqlDetail, [masterNomors]);

    // --- 3. GABUNGKAN HEADER + DETAIL ---
    const dataMap = new Map();

    masterResults.forEach((item) => {
      dataMap.set(item.Nomor, { ...item, Detail: [] });
    });

    detailResults.forEach((detail) => {
      if (dataMap.has(detail.Nomor)) {
        dataMap.get(detail.Nomor).Detail.push(detail);
      }
    });

    return Array.from(dataMap.values());
  } catch (error) {
    throwDbError("Gagal mengambil data Lookup Pengajuan Permintaan", error);
  }
};

// ===================================
// GET BY NOMOR (Untuk ditarik ke Form Minta Bahan)
// ===================================
exports.getPengajuanByNomor = async (nomor) => {
  try {
    // 1. Ambil Header dengan JOIN ke tgudang
    const sqlHeader = `
            SELECT 
                t1.pp_nomor AS Nomor, 
                t1.pp_tanggal AS Tanggal, 
                t1.pp_jenis AS Jenis,
                t1.pp_keterangan AS Keterangan, 
                t1.pp_to_user AS Ditujukan_Ke,
                t1.pp_gdg_kode AS Gudang, 
                t2.gdg_nama AS Nama, -- Mengambil Nama dari tabel tgudang
                t1.pp_acc_req AS Status_Acc,
                t1.pp_acc_req_user AS Acc_SPV
            FROM tpengajuan_permintaan_hdr t1
            LEFT JOIN tgudang t2 ON t2.gdg_kode = t1.pp_gdg_kode
            WHERE t1.pp_nomor = ?
        `;

    const [headerResults] = await pool.query(sqlHeader, [nomor]);

    if (headerResults.length === 0) {
      throw new Error(`Data Pengajuan dengan nomor ${nomor} tidak ditemukan.`);
    }

    const headerData = headerResults[0];

    // 2. Ambil Detail (Identik dengan yang sebelumnya namun dengan alias yang konsisten)
    const sqlDetail = `
            SELECT 
                ppd_brg_kode AS Kode_Bahan, 
                TRIM(b.brg_nama) AS Nama_Bahan,
                ppd_qty AS Jumlah, 
                ppd_brg_satuan AS Satuan,
                b.brg_panjang AS Panjang, 
                b.brg_lebar AS Lebar,
                ppd_keterangan AS Keterangan, 
                ppd_spk_nomor AS Nomor_SPK,
                (SELECT TRIM(spk_nama) FROM tspk WHERE spk_nomor = ppd_spk_nomor 
                 UNION ALL 
                 SELECT TRIM(mspk_nama) FROM tmemospk WHERE mspk_nomor = ppd_spk_nomor) AS spk_nama
            FROM tpengajuan_permintaan_dtl d
            LEFT JOIN tbarang_mmt b ON d.ppd_brg_kode = b.brg_kode
            WHERE ppd_pp_nomor = ?
            ORDER BY ppd_nourut
        `;

    const [detailResults] = await pool.query(sqlDetail, [nomor]);

    // 3. Gabungkan dan Kembalikan
    return {
      ...headerData,
      Detail: detailResults,
    };
  } catch (error) {
    throwDbError(`Gagal mengambil detail pengajuan (${nomor})`, error);
  }
};

exports.getPengajuanPermintaanForPrint = async (nomor) => {
  try {
    // 1. Query Header
    const sqlHeader = `
            SELECT
                t1.pp_nomor AS NoPengajuan,
                t1.pp_jenis AS JenisPengajuan,
                t1.pp_to_user AS Kepada,
                t1.pp_priority AS Priority,
                t1.pp_keterangan AS Keterangan,
                DATE_FORMAT(t1.pp_tanggal, '%d/%m/%Y') AS Tanggal,
                
                -- Mapping Nama User (Pembuat & Pemeriksa)
                IFNULL(u1.user_nama, t1.user_create) AS Dibuat,
                IFNULL(u2.user_nama, 'EKAMMT') AS Diketahui, -- Sesuai request: ACC oleh EKAMMT
                
                t1.pp_acc_req AS Status_Acc
            FROM tpengajuan_permintaan_hdr t1
            LEFT JOIN tuser u1 ON t1.user_create = u1.user_kode
            LEFT JOIN tuser u2 ON u2.user_kode = 'EKAMMT' -- Join manual untuk ambil nama EKAMMT
            WHERE t1.pp_nomor = ?;
        `;

    const [headerResult] = await pool.query(sqlHeader, [nomor]);
    if (headerResult.length === 0)
      throw new Error("Data Pengajuan tidak ditemukan.");

    const header = headerResult[0];

    // 2. Query Detail
    const sqlDetail = `
            SELECT
                ppd_nourut AS No,
                ppd_spk_nomor AS SPK,
                -- Gabungkan nama barang dengan dimensi jika ada
                IF(b.brg_panjang IS NULL OR b.brg_panjang = 0, 
                   TRIM(b.brg_nama), 
                   CONCAT(TRIM(b.brg_nama), ' (', b.brg_panjang, ' x ', b.brg_lebar, ')')
                ) AS Jenis,
                ppd_keterangan AS Keterangan,
                ppd_brg_satuan AS Satuan,
                ppd_qty AS QTY
            FROM tpengajuan_permintaan_dtl d
            LEFT JOIN tbarang_mmt b ON d.ppd_brg_kode = b.brg_kode
            WHERE d.ppd_pp_nomor = ?
            ORDER BY d.ppd_nourut;
        `;

    const [detailResults] = await pool.query(sqlDetail, [nomor]);

    // 3. Return gabungan data
    const isApproved = header.Status_Acc === "Y";
    const namaApprover = header.Diketahui || header.Acc_SPV || "";

    return {
      ...header,
      Details: detailResults,
      // Fallback tanda tangan jika data kosong
      Dibuat: header.Dibuat || "................",
      Diketahui: isApproved
        ? (namaApprover || "................")
        : "................",
    };
  } catch (error) {
    console.error("Error in getPengajuanPermintaanForPrint:", error);
    throw new Error(`Gagal mengambil data cetak pengajuan: ${error.message}`);
  }
};

exports.getPermintaanPembelianForPrint = exports.getPengajuanPermintaanForPrint;

// Fungsi Approval oleh SPV (EKAMMT) untuk Pengajuan Permintaan
exports.approveBySPV = async (nomor, userKD) => {
  try {
    const sql = `
            UPDATE tpengajuan_permintaan_hdr 
            SET 
                pp_acc_req = 'Y', 
                pp_acc_req_user = ?, 
                date_modified = NOW() 
            WHERE pp_nomor = ?
        `;

    const [result] = await pool.query(sql, [userKD, nomor]);

    // Mengembalikan true jika ada baris yang terupdate
    return result.affectedRows > 0;
  } catch (error) {
    console.error("Database Error pada Approve SPV Pengajuan:", error);
    throw new Error("Gagal melakukan approval pengajuan permintaan");
  }
};

// Aliases untuk konsistensi penamaan Permintaan Pembelian
exports.getPermintaanPembelianData = exports.getPengajuanData;
exports.getPermintaanPembelianForLookup = exports.getPengajuanForLookup;
exports.getPermintaanPembelianByNomor = exports.getPengajuanByNomor;
exports.savePermintaanPembelian = exports.savePengajuan;
exports.deletePermintaanPembelian = exports.deletePengajuan;
exports.getPermintaanPembelianForPrint = exports.getPengajuanPermintaanForPrint;
