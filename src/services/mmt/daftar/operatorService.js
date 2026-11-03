// backend/src/services/operatorMmt.service.js

const pool = require("../../../config/database"); 

const throwDbError = (message, error) => {
    console.error(message, error.message);
    throw new Error(message + ': ' + error.message);
};

// --- READ ALL (btnRefreshClick - SQLMaster) ---
exports.getOperators = async () => {
    // SQL Delphi: SELECT op_kode Kode, op_nama Nama FROM toperator_mmt
    const sql = `
        SELECT op_kode AS Kode, op_nama AS Nama 
        FROM toperator_mmt
        ORDER BY op_kode ASC
    `;

    try {
        const [rows] = await pool.query(sql);
        return rows;
    } catch (error) {
        throwDbError('Gagal memuat data Master Operator', error);
    }
};

// --- READ SINGLE (loaddata - untuk Edit) ---
exports.getOperatorByKode = async (kode) => {
    const sql = `
        SELECT op_kode AS Kode, op_nama AS Nama 
        FROM toperator_mmt 
        WHERE op_kode = ?
    `;

    try {
        const [rows] = await pool.query(sql, [kode]);
        return rows[0]; // Mengembalikan satu objek
    } catch (error) {
        throwDbError('Gagal memuat data Operator', error);
    }
};

// --- DELETE (cxButton4Click) ---
exports.deleteOperator = async (kode) => {
    // Logika delete Delphi: delete from toperator_mmt where op_kode = 'KODE'
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const sqlDelete = 'DELETE FROM toperator_mmt WHERE op_kode = ?';
        const [result] = await connection.query(sqlDelete, [kode]);
        
        if (result.affectedRows === 0) {
            throw new Error("Kode Operator tidak ditemukan.");
        }
        
        await connection.commit();
        return true;
        
    } catch (error) {
        if (connection) await connection.rollback();
        throwDbError('Gagal menghapus Operator', error);
    } finally {
        if (connection) connection.release();
    }
};

// --- SAVE (NEW/EDIT - asumsi form entri memiliki endpoint ini) ---
exports.saveOperator = async (data, isEdit) => {
    // Di sini kita hanya membuat placeholder, asumsi data {Kode, Nama}
    if (isEdit) {
        const sql = 'UPDATE toperator_mmt SET op_nama = ? WHERE op_kode = ?';
        await pool.query(sql, [data.Nama, data.Kode]);
    } else {
        const sql = 'INSERT INTO toperator_mmt (op_kode, op_nama) VALUES (?, ?)';
        await pool.query(sql, [data.Kode, data.Nama]);
    }
    return data;
};