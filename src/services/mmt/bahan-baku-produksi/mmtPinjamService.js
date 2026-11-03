const pool = require("../../../config/database");

const MmtService = {
    // Menyimpan data permintaan pinjam baru
    createPinjamRequest: async (data) => {
        const { barcode, operator, nomor_spk, nama_bahan, panjang, lebar } = data;
        const sql = `
            INSERT INTO tpermintaan_pinjam_mmt 
            (barcode, operator, nomor_spk, nama_bahan, panjang, lebar, status, tgl_permintaan) 
            VALUES (?, ?, ?, ?, ?, ?, 'PENDING', NOW())
        `;
        const [result] = await pool.query(sql, [barcode, operator, nomor_spk, nama_bahan, panjang, lebar]);
        return result;
    },

    // Mengambil semua permintaan yang statusnya masih PENDING
    getAllPendingLoans: async () => {
        const sql = `
            SELECT * FROM tpermintaan_pinjam_mmt 
            WHERE status = 'PENDING' 
            ORDER BY tgl_permintaan DESC
        `;
        const [rows] = await pool.query(sql);
        return rows;
    },

    approveLoan: async (barcode, nomor_permintaan) => {
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();

            // 1. Update status di tabel permintaan pinjam
            const updateSql = `
                UPDATE tpermintaan_pinjam_mmt 
                SET status = 'APPROVED', tgl_approve = NOW() 
                WHERE barcode = ? AND status = 'PENDING'
            `;
            await connection.query(updateSql, [barcode]);

            // 2. Update lokasi stok di tabel master stok (Contoh: pindah ke GPM)
            // Sesuaikan nama tabel 'tstok_bahan' dan kolom 'lokasi' dengan database Anda
            const mutationSql = `
                UPDATE tmasterstok_mmt 
                SET mst_gdg_kode = 'GPM', mst_tanggal = NOW() 
                WHERE mst_barcode = ?
            `;
            await connection.query(mutationSql, [barcode]);

            await connection.commit();
            return true;
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }

};



module.exports = MmtService;