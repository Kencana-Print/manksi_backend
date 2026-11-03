const pool = require('../../../config/database');

const throwDbError = (message, error) => {
    console.error(message, error.message);
    throw new Error(`${message}: ${error.message}`);
};

const toNumber = (value, fallback = 0) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
};

const toText = (value) => (value == null ? "" : String(value).trim());

/**
 * Mengambil data obat dengan perhitungan Stok & Safety (Logic: btnRefreshClick)
 * Menangani hak akses kolom (zLihatSup, zLihatBeli)
 */
const getBrowseObat = async (userPrivileges = {}) => {
    try {
        // Logic Delphi: Pengecekan hak akses kolom
        const canSeeSupplier = userPrivileges.zLihatSup !== 0;
        const canSeeHarga = userPrivileges.zLihatBeli !== 0;

        // Base Query (Subquery x)
        // Perhitungan Safety: if(Buffer=0, 0, if(Stok < Buffer, Buffer - Stok, 0))
        let sql = `
            SELECT 
                x.Kode, x.Nama, x.Satuan,
                ${canSeeSupplier ? 'x.Supplier,' : ''}
                ${canSeeHarga ? 'x.Harga,' : ''}
                x.Buffer, x.Stok, x.Aktif,
                IF(x.Buffer = 0, 0, IF(x.Stok < x.Buffer, x.Buffer - x.Stok, 0)) AS Safety
            FROM (
                SELECT 
                    o_kode AS Kode, 
                    o_nama AS Nama, 
                    o_satuan AS Satuan, 
                    o_sup AS Supplier, 
                    o_harga AS Harga, 
                    o_buffer AS Buffer,
                    o_aktif AS Aktif,
                    IFNULL((
                        SELECT SUM(m.mst_stok_in - m.mst_stok_out) 
                        FROM tmasterstok_obat m 
                        WHERE m.mst_aktif = 'Y' AND m.mst_brg_kode = o_kode
                    ), 0) AS Stok
                FROM tobat
            ) x
            ORDER BY x.Kode
        `;

        const [rows] = await pool.query(sql);
        
        // Map data agar aman dikonsumsi frontend
        return rows.map(row => ({
            ...row,
            Harga: canSeeHarga ? toNumber(row.Harga) : null,
            Stok: toNumber(row.Stok),
            Safety: toNumber(row.Safety),
            // Indikator Warna (Logic: cxGrdMasterCustomDrawCell)
            _uiHint: {
                isRedText: row.Aktif === 'N',
                isSafetyAlert: toNumber(row.Safety) !== 0
            }
        }));
    } catch (error) {
        throwDbError("Gagal refresh data obat", error);
    }
};

/**
 * Hapus Data (Logic: hapusdata)
 */
const deleteObat = async (kode) => {
    try {
        const sql = "DELETE FROM tobat WHERE o_kode = ?";
        const [result] = await pool.query(sql, [toText(kode)]);
        return result.affectedRows > 0;
    } catch (error) {
        throwDbError("Gagal hapus data obat", error);
    }
};

const getLookupObat = async (keyword = "") => {
    try {
        let sql = `
            SELECT 
                x.Kode, x.Nama, x.Satuan, x.Harga, x.Stok, x.Aktif
            FROM (
                SELECT 
                    o_kode AS Kode, 
                    o_nama AS Nama, 
                    o_satuan AS Satuan, 
                    o_harga AS Harga,
                    IFNULL((
                        SELECT SUM(m.mst_stok_in - m.mst_stok_out) 
                        FROM tmasterstok_obat m 
                        WHERE m.mst_aktif = 'Y' AND m.mst_brg_kode = o_kode
                    ), 0) AS Stok,
                    o_aktif AS Aktif
                FROM tobat
            ) x
            WHERE 1=1
        `;

        const params = [];
        if (keyword) {
            sql += ` AND (x.Kode LIKE ? OR x.Nama LIKE ?)`;
            const q = `%${keyword}%`;
            params.push(q, q);
        }

        sql += ` ORDER BY x.Nama ASC`;

        const [rows] = await pool.query(sql, params);
        
        // Mapping agar formatnya seragam dengan MasterBahan
        return rows.map(row => ({
            Kode: row.Kode,
            Nama: row.Nama,
            Satuan: row.Satuan,
            Harga: toNumber(row.Harga),
            Stok: toNumber(row.Stok),
            Aktif: row.Aktif,
            Panjang: 0, // Obat biasanya tidak pakai P x L, kita beri default 0
            Lebar: 0
        }));
    } catch (error) {
        throwDbError("Gagal mengambil lookup obat", error);
    }
};

module.exports = {
    getBrowseObat,
    deleteObat,
    getLookupObat


};