// backend/src/services/pabrik.service.js
const pool = require('../../../config/database');

exports.getLookupPabrik = async () => {
    try {
        const sql = `
            SELECT 
                pab_kode AS Kode, 
                pab_nama AS Nama, 
                pab_pabrik AS Pabrik,
                pab_alamat AS AlamatPabrik,
                pab_mintaobat AS MintaObat
            FROM tpabrik 
            ORDER BY pab_nama ASC
        `;
        const [rows] = await pool.query(sql);
        return rows;
    } catch (error) {
        throw new Error('Gagal mengambil data pabrik: ' + error.message);
    }
};