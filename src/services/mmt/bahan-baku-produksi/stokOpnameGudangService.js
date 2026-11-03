// backend/src/services/stokOpname.service.js

const pool = require("../../../config/database");
const { format } = require('date-fns');

// Helper untuk throw error
const throwDbError = (message, error) => { throw new Error(message + ': ' + error.message); };

// ===================================
// 1. GET NEW NOMOR (Generate Session ID)
// ===================================
exports.getNewSessionID = async () => {
    const NOMERATOR = 'OPN.MMT';
    try {
        const currentYYMM = format(new Date(), 'yyMM');
        const searchPattern = `${NOMERATOR}.${currentYYMM}.%`;

        const sql = `
            SELECT MAX(opn_session_id) AS MaxNomor 
            FROM topname_mmt 
            WHERE opn_session_id LIKE ?;
        `;

        const [results] = await pool.query(sql, [searchPattern]);
        const maxNomor = results[0].MaxNomor;

        let newNumber = '0001';
        if (maxNomor) {
            const lastNumberString = maxNomor.substring(maxNomor.lastIndexOf('.') + 1);
            const lastNumber = parseInt(lastNumberString, 10);
            newNumber = (lastNumber + 1).toString().padStart(4, '0');
        }
        return `${NOMERATOR}.${currentYYMM}.${newNumber}`;
    } catch (error) {
        throwDbError('Gagal mendapatkan nomor sesi opname baru', error);
    }
};

// ===================================
// 2. START SESSION (Insert Initial Data)
// ===================================
exports.startOpnameSession = async (gdgKode, user) => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const sessionID = await exports.getNewSessionID();

        const sqlInit = `
    INSERT INTO topname_mmt (
        opn_session_id, opn_barcode, opn_brg_kode, 
        opn_gdg_kode, opn_stok_sistem, opn_user, opn_status
    )
    SELECT 
        ?, m.mst_barcode, m.mst_brg_kode, m.mst_gdg_kode, 
        ROUND(SUM(m.mst_stok_in * m.mst_panjang) - SUM(m.mst_stok_out * m.mst_panjang), 3) AS Stok,
        ?, 'PENDING' -- Paksa status menjadi PENDING di awal
    FROM tmasterstok_mmt m
    WHERE m.mst_gdg_kode = ?
    GROUP BY m.mst_barcode, m.mst_brg_kode, m.mst_gdg_kode
    HAVING Stok > 0;
`;

        await connection.query(sqlInit, [sessionID, user, gdgKode]);
        
        await connection.commit();
        return { success: true, sessionID: sessionID };
    } catch (error) {
        await connection.rollback();
        throwDbError('Gagal memulai sesi opname', error);
    } finally {
        connection.release();
    }
};

// ===================================
// 3. SCAN BARCODE (Validation)
// ===================================

exports.scanBarcodeOpname = async (barcode, sessionID) => {
    try {
        const sql = `
            SELECT 
                o.opn_barcode AS Barcode,
                o.opn_brg_kode AS Kode,
                TRIM(b.brg_nama) AS Nama_Bahan,
                o.opn_stok_sistem AS Stok_Sistem,
                o.opn_stok_fisik AS opn_stok_fisik,
                o.opn_status AS opn_status -- Pastikan menggunakan opn_status agar sinkron dengan Frontend
            FROM topname_mmt o
            LEFT JOIN tbarang_mmt b ON o.opn_brg_kode = b.brg_kode
            WHERE o.opn_barcode = ? AND o.opn_session_id = ?;
        `;

        const [results] = await pool.query(sql, [barcode, sessionID]);
        return results[0] || null;
    } catch (error) {
        throwDbError('Gagal scan barcode opname', error);
    }
};
// ===================================
// 4. UPDATE RESULT (Submit Scan)
// ===================================
// backend/src/services/stokOpname.service.js

exports.updateScanResult = async (sessionID, barcode) => {
    try {
        const sql = `
            UPDATE topname_mmt 
            SET 
                opn_barcode_fisik = ?,       -- Tanda tanya 1
                opn_stok_fisik = opn_stok_sistem, 
                opn_status = 'MATCHED',
                opn_selisih = 0
            WHERE opn_session_id = ?        -- Tanda tanya 2
              AND opn_barcode = ?;          -- Tanda tanya 3
        `;

        // Pastikan isi array ini ada 3 sesuai jumlah tanda tanya di atas
        const [result] = await pool.query(sql, [barcode, sessionID, barcode]);
        return result.affectedRows > 0;
    } catch (error) {
        // Ini yang memicu pesan error di screenshot Anda
        throwDbError('Gagal memverifikasi barcode', error);
    }
};

// ===================================
// 5. GET PENDING ITEMS
// ===================================
// Ubah nama dari getPendingItems menjadi getAllSessionData
exports.getAllSessionData = async (sessionID) => {
    try {
        const sql = `
            SELECT 
                o.opn_barcode AS Barcode,
                o.opn_brg_kode AS Kode,
                TRIM(b.brg_nama) AS Nama_Bahan,
                o.opn_stok_sistem AS Stok_Sistem,
                o.opn_stok_fisik AS opn_stok_fisik, -- Tambahkan ini untuk kolom kanan
                o.opn_status AS opn_status         -- Tambahkan ini untuk filter kolom
            FROM topname_mmt o
            LEFT JOIN tbarang_mmt b ON o.opn_brg_kode = b.brg_kode
            WHERE o.opn_session_id = ?
            ORDER BY o.opn_status DESC, b.brg_nama ASC; -- PENDING biasanya abjadnya lebih akhir, atau atur manual
        `;

        const [results] = await pool.query(sql, [sessionID]);
        return results;
    } catch (error) {
        throwDbError('Gagal mengambil data sesi opname', error);
    }
};

// ===================================
// 6. GET OPNAME REPORT (Fixed for ONLY_FULL_GROUP_BY)
// ===================================
exports.getOpnameReport = async (sessionID) => {
    try {
        const sql = `
            SELECT 
                o.opn_session_id AS SessionID,
                o.opn_gdg_kode AS Gudang,
                o.opn_brg_kode AS Kode_Barang,
                TRIM(b.brg_nama) AS Nama_Barang,
                COUNT(o.opn_barcode) AS Total_Barcode_Sistem,
                SUM(CASE WHEN o.opn_status != 'PENDING' THEN 1 ELSE 0 END) AS Barcode_Ditemukan,
                SUM(CASE WHEN o.opn_status = 'PENDING' THEN 1 ELSE 0 END) AS Barcode_Hilang,
                ROUND(SUM(o.opn_stok_sistem), 3) AS Total_Stok_Sistem,
                ROUND(SUM(CASE WHEN o.opn_status != 'PENDING' THEN o.opn_stok_fisik ELSE 0 END), 3) AS Total_Stok_Fisik,
                ROUND(SUM(CASE WHEN o.opn_status != 'PENDING' THEN o.opn_stok_fisik ELSE 0 END) - SUM(o.opn_stok_sistem), 3) AS Selisih_Meter
            FROM topname_mmt o
            LEFT JOIN tbarang_mmt b ON o.opn_brg_kode = b.brg_kode
            WHERE o.opn_session_id = ?
            GROUP BY 
                o.opn_session_id,  -- Tambahkan ini
                o.opn_gdg_kode,    -- Tambahkan ini
                o.opn_brg_kode, 
                b.brg_nama
            ORDER BY b.brg_nama ASC;
        `;

        const sqlSummary = `
            SELECT 
                COUNT(*) as total_items,
                SUM(CASE WHEN opn_status = 'PENDING' THEN 1 ELSE 0 END) as total_missing,
                opn_user as petugas,
                opn_created_at as tanggal_mulai
            FROM topname_mmt
            WHERE opn_session_id = ?
            GROUP BY 
                opn_user, 
                opn_created_at;
        `;

        const [details] = await pool.query(sql, [sessionID]);
        const [summary] = await pool.query(sqlSummary, [sessionID]);

        return {
            header: summary[0] || {},
            details: details
        };
    } catch (error) {
        throwDbError('Gagal membuat laporan opname', error);
    }
};