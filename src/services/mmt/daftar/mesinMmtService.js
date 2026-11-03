const pool = require("../../../config/database");

const throwDbError = (message, error) => {
    throw new Error(message + ": " + error.message);
};

/**
 * Mapping Jenis Mesin dari Delphi
 * Index 0 = C, 1 = D, 2 = R, 3 = S, 4 = T
 */
const mapJenisToDb = (index) => {
    const map = { 0: 'C', 1: 'D', 2: 'R', 3: 'S', 4: 'T' };
    return map[index] || 'C';
};

// loaddata(akode) di Delphi
exports.getMesinByKode = async (kode) => {
    try {
        const sql = `
            SELECT msn_kode, msn_nama, msn_note, msn_jenis 
            FROM tmesin_mmt 
            WHERE msn_kode = ? 
            LIMIT 1
        `;
        const [rows] = await pool.query(sql, [kode]);
        return rows.length > 0 ? rows[0] : null;
    } catch (error) {
        throwDbError(`Gagal memuat data mesin ${kode}`, error);
    }
};

// simpandata di Delphi
exports.saveMesin = async (payload) => {
    const { msn_kode, msn_nama, msn_note, msn_jenis, isEditMode } = payload;

    if (!msn_kode || !msn_nama) {
        throw new Error("Kode dan Nama mesin tidak boleh kosong.");
    }

    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();

        if (isEditMode) {
            // Logic: UPDATE tmesin_mmt
            const sqlUpdate = `
                UPDATE tmesin_mmt SET 
                    msn_nama = ?, 
                    msn_jenis = ?, 
                    msn_note = ?
                WHERE msn_kode = ?
            `;
            await conn.query(sqlUpdate, [msn_nama, msn_jenis, msn_note, msn_kode]);
        } else {
            // Logic: INSERT INTO tmesin_mmt
            const sqlInsert = `
                INSERT INTO tmesin_mmt (msn_kode, msn_nama, msn_note, msn_jenis)
                VALUES (?, ?, ?, ?)
            `;
            await conn.query(sqlInsert, [msn_kode, msn_nama, msn_note, msn_jenis]);
        }

        await conn.commit();
        return { kode: msn_kode };
    } catch (error) {
        await conn.rollback();
        throwDbError("Gagal menyimpan data mesin", error);
    } finally {
        conn.release();
    }
};

// hapusdata di Delphi
exports.deleteMesin = async (kode) => {
    try {
        const sql = `DELETE FROM tmesin_mmt WHERE msn_kode = ?`;
        const [result] = await pool.query(sql, [kode]);
        return result.affectedRows > 0;
    } catch (error) {
        throwDbError(`Gagal menghapus mesin ${kode}`, error);
    }
};

// Bantuan (F1 di Delphi) & Browse Utama
exports.getLookupMesin = async (keyword = "") => {
    try {
        let sql = `
            SELECT 
                msn_kode AS Kode, 
                msn_nama AS Nama,
                msn_jenis AS Jenis,
                msn_note AS Keterangan
            FROM tmesin_mmt
        `;
        const params = [];
        if (keyword && keyword.trim() !== "") {
            sql += ` WHERE msn_kode LIKE ? OR msn_nama LIKE ?`;
            const q = `%${keyword.trim()}%`;
            params.push(q, q);
        }
        sql += ` ORDER BY msn_kode ASC`;
        const [rows] = await pool.query(sql, params);
        return rows;
    } catch (error) {
        throwDbError("Gagal mengambil daftar bantuan mesin", error);
    }
};