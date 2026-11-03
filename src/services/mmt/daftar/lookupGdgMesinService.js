// src/services/mmt/daftar/lookupGdgMesinService.js
const pool = require("../../../config/database");

const throwDbError = (message, error) => {
    throw new Error(message + (error ? ": " + error.message : ""));
};

const executeQuery = async (sql, params = []) => {
    try {
        const [rows] = await pool.query(sql, params);
        return rows;
    } catch (error) {
        console.error("DATABASE EXECUTION ERROR:", error.message);
        throwDbError("Gagal menjalankan query database", error);
    }
};

const getGudangLookup = async (mode, divisi) => {
    let whereClause = "";
    let params = [];

    if (divisi == "1") {
        whereClause = "WHERE gdg_jadi = 1";
    } else if (mode === "jadi") {
        if (divisi == "4") {
            whereClause = "WHERE gdg_jadi = 4";
        } else {
            whereClause = "WHERE gdg_jadi <> 0";
        }
    } else {
        whereClause = "";
    }

    const sql = `
        SELECT gdg_kode AS Kode, gdg_nama AS Nama 
        FROM tgudang
        ${whereClause}
        ORDER BY gdg_nama
    `;

    return await executeQuery(sql, params);
};

const getGudangDetail = async (kodeGudang) => {
    const sql = `
        SELECT gdg_kode AS Kode, gdg_nama AS Nama 
        FROM tgudang 
        WHERE gdg_kode = ? 
    `;
    const results = await executeQuery(sql, [kodeGudang]);
    return results[0];
};

const getMesinCetakLookup = async () => {
    const sql = `
        SELECT msn_kode AS Kode, msn_nama AS Nama, msn_note AS Keterangan
        FROM tmesin_mmt
        ORDER BY msn_kode
    `;
    return await executeQuery(sql);
};

module.exports = {
    getGudangLookup,
    getGudangDetail,
    getMesinCetakLookup
};

