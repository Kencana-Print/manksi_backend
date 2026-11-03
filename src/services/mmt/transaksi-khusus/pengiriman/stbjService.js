const pool = require("../../../../config/database");
const { scopeSchema } = require("../../../../config/database");
const { format } = require('date-fns');

/**
 * Helper untuk menangani error database
 */
const throwDbError = (message, error) => {
    console.error(error);
    throw new Error(`${message}: ${error.message}`);
};

/**
 * BROWSE DATA STBJ (Logika btnRefreshClick di Delphi)
 */
exports.getBrowseSTBJ = async (startDate, endDate, gdgKode) => {
    try {
        const sqlMaster = `
            SELECT 
                stbj_nomor AS Nomor, 
                /* --- PERBAIKAN DI SINI --- */
                DATE_FORMAT(h.stbj_tanggal, '%Y-%m-%d') AS Tanggal,
                /* ------------------------- */
                stbj_keterangan AS Keterangan, 
                stbj_gdg_kode AS GudangKode, 
                g.gdg_nama AS Gudang, 
                p.gdgp_nama AS Dari,
                IFNULL(ts.ts_nomor, "") AS NomorTerima, 
                /* --- PERBAIKAN JUGA UNTUK TGL TERIMA --- */
                DATE_FORMAT(ts.ts_tanggal, '%Y-%m-%d') AS TglTerima,
                /* --------------------------------------- */
                IFNULL((
                    SELECT 
                        IF(pin_acc='' AND pin_dipakai='', 'WAIT',
                        IF(pin_acc='Y' AND pin_dipakai='', 'ACC',
                        IF(pin_acc='Y' AND pin_dipakai='Y', '',
                        IF(pin_acc='N', 'TOLAK', ''))))
                    FROM tspk_pin5 
                    WHERE pin_trs='STBJ' AND pin_nomor=stbj_nomor 
                    ORDER BY pin_urut DESC LIMIT 1
                ), "") AS Ngedit,
                h.user_create AS Usr
            FROM tstbj_hdr h
            LEFT JOIN tgudang g ON g.gdg_kode = h.stbj_gdg_kode
            LEFT JOIN tgudangproduksi p ON p.gdgp_kode = h.stbj_gdgp_kode
            LEFT JOIN retail.tdc_stbj_hdr ts ON ts.ts_stbj = h.stbj_nomor
            WHERE h.stbj_tanggal >= ? AND h.stbj_tanggal <= ?
              AND h.stbj_gdg_kode LIKE ?
            ORDER BY h.date_create DESC;
        `;

        const [rows] = await pool.query(sqlMaster, [startDate, endDate, `%${gdgKode}%`]);
        return rows;
    } catch (error) {
        throwDbError('Gagal mengambil data browse STBJ', error);
    }
};

/**
 * GET DETAIL DATA STBJ (Untuk sub-grid)
 */
exports.getDetailSTBJ = async (nomor) => {
    try {
        const sqlDetail = `
            SELECT 
                stbjd_stbj_nomor AS Nomor, 
                stbjd_spk_nomor AS Spk_Nomor, 
                IFNULL(s.spk_nama, i.spgi_nama) AS Nama, 
                s.spk_ukuran AS Ukuran, 
                stbjd_size AS Size,
                stbjd_jumlah AS Jumlah, 
                stbjd_koli AS Koli, 
                stbjd_keterangan AS Keterangan
            FROM tstbj_dtl
            LEFT JOIN tspk s ON s.spk_nomor = stbjd_spk_nomor
            LEFT JOIN tspk_gudangitem i ON i.spgi_spk = stbjd_spk_nomor
            WHERE stbjd_stbj_nomor = ?;
        `;
        const [rows] = await pool.query(sqlDetail, [nomor]);
        return rows;
    } catch (error) {
        throwDbError('Gagal mengambil detail STBJ', error);
    }
};

/**
 * GENERATE NOMOR OTOMATIS (Logika getmaxnomor di Delphi)
 */
exports.getNewNomorSTBJ = async (tahun) => {
    try {
        // Format di Delphi: STBJ/00001/2023
        const sql = `
            SELECT IFNULL(MAX(SUBSTR(stbj_nomor, 6, 5)), 0) AS lastNumber 
            FROM tstbj_hdr
            WHERE LEFT(stbj_nomor, 4) = 'STBJ'
              AND RIGHT(stbj_nomor, 4) = ?;
        `;
        const [results] = await pool.query(sql, [tahun]);
        const nextNumber = parseInt(results[0].lastNumber) + 1;
        const paddedNumber = nextNumber.toString().padStart(5, '0');
        
        return `STBJ/${paddedNumber}/${tahun}`;
    } catch (error) {
        throwDbError('Gagal generate nomor STBJ', error);
    }
};

/**
 * SIMPAN DATA STBJ (Logika simpandata di Delphi)
 */
// Pastikan library date-fns diimport di bagian atas file

exports.saveSTBJ = async (payload, isUpdate = false, userLogin) => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const { header, details } = payload;
        
        let Nomor = header.stbj_nomor;
        const Tanggal = header.stbj_tanggal;
        const Keterangan = header.stbj_keterangan;
        const Gudang = header.stbj_gdg_kode;
        const GudangProduksi = header.stbj_gdgp_kode;

        const serverTime = format(new Date(), 'yyyy-MM-dd HH:mm:ss');
        const validTanggal = Tanggal ? format(new Date(Tanggal), 'yyyy-MM-dd') : format(new Date(), 'yyyy-MM-dd');
        
        // userLogin diambil dari parameter fungsi yang dikirim oleh controller
        const activeUser = userLogin; 

        if (!isUpdate || Nomor === 'AUTO') {
            const tahun = format(new Date(validTanggal), 'yyyy');
            Nomor = await exports.getNewNomorSTBJ(tahun);
        }

        if (isUpdate && Nomor !== 'AUTO') {
            await connection.query(
                `UPDATE tstbj_hdr SET 
                    stbj_tanggal=?, stbj_keterangan=?, stbj_gdg_kode=?, 
                    stbj_gdgp_kode=?, date_modified=?, user_modified=? 
                 WHERE stbj_nomor=?`,
                [validTanggal, Keterangan, Gudang, GudangProduksi, serverTime, activeUser, Nomor]
            );
            await connection.query(`DELETE FROM tstbj_dtl WHERE stbjd_stbj_nomor = ?`, [Nomor]);
        } else {
            // INSERT BARU
            await connection.query(
                `INSERT INTO tstbj_hdr 
                    (stbj_nomor, stbj_tanggal, stbj_keterangan, stbj_gdg_kode, stbj_gdgp_kode, date_create, user_create) 
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [Nomor, validTanggal, Keterangan, Gudang, GudangProduksi, serverTime, activeUser]
            );
        }

        // 3. Simpan Detail Utama (Looping menggunakan 'details' dari payload)
        // Baris ber-SPK disimpan semua (termasuk Jumlah 0); hanya baris kosong dibuang.
        if (details && details.length > 0) {
            for (const item of details) {
                // Pastikan menggunakan nama field sesuai payload (spk, qty, koli, keterangan)
                if (item.spk && String(item.spk).trim() !== "") {
                    await connection.query(
                        `INSERT INTO tstbj_dtl 
                            (stbjd_stbj_nomor, stbjd_spk_nomor, stbjd_size, stbjd_jumlah, stbjd_koli, stbjd_keterangan, stbjd_packing) 
                         VALUES (?, ?, ?, ?, ?, ?, ?)`,
                        [
                            Nomor, 
                            item.spk, 
                            item.size || "", 
                            Number(item.qty), 
                            Number(item.koli || 0), 
                            item.keterangan || "", 
                            item.packing || ""
                        ]
                    );

                    // Update link packing jika ada
                    if (Gudang === 'WH003' && item.packing) {
                        await connection.query(
                            `UPDATE retail.tpacking SET pack_nostbj = ? WHERE pack_nomor = ?`,
                            [Nomor, item.packing]
                        );
                    }
                }
            }
        }

        await connection.commit();
        return { success: true, nomor: Nomor };
    } catch (error) {
        if (connection) await connection.rollback();
        throw error;
    } finally {
        if (connection) connection.release();
    }
};

/**
 * DELETE DATA STBJ (Logika cxButton4Click di Delphi)
 */
exports.deleteSTBJ = async (nomor, gdgKode) => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        if (gdgKode === 'WH003') {
            await connection.query(
                `UPDATE retail.tpacking SET pack_nostbj = NULL WHERE pack_nostbj = ?`,
                [nomor]
            );
        }
        await connection.query(`DELETE FROM retail.tdc_stbj WHERE tsd_nomor = ?`, [nomor]);
        await connection.query(`DELETE FROM tstbj_dtl WHERE stbjd_stbj_nomor = ?`, [nomor]);
        const [result] = await connection.query(`DELETE FROM tstbj_hdr WHERE stbj_nomor = ?`, [nomor]);

        await connection.commit();
        return result.affectedRows > 0;
    } catch (error) {
        await connection.rollback();
        throwDbError('Gagal menghapus STBJ', error);
    } finally {
        connection.release();
    }
};

/**
 * GET DATA STBJ BY NOMOR (Untuk Loading Data Edit)
 */
exports.getSTBJByNomor = async (nomor) => {
    try {
        // 1. Ambil Data Header
        const sqlHeader = `
            SELECT 
                h.stbj_nomor AS Nomor, 
                DATE_FORMAT(h.stbj_tanggal, '%Y-%m-%d') AS Tanggal,
                h.stbj_keterangan AS Keterangan, 
                h.stbj_gdg_kode AS Gudang_Kode, 
                g.gdg_nama AS Gudang_Nama, 
                h.stbj_gdgp_kode AS Gudang_Produksi_Kode,
                p.gdgp_nama AS Gudang_Produksi_Nama,
                h.user_create AS User_Create,
                h.date_create AS Date_Create
            FROM tstbj_hdr h
            LEFT JOIN tgudang g ON g.gdg_kode = h.stbj_gdg_kode
            LEFT JOIN tgudangproduksi p ON p.gdgp_kode = h.stbj_gdgp_kode
            WHERE h.stbj_nomor = ?;
        `;
        
        const [headerResults] = await pool.query(sqlHeader, [nomor]);

        if (headerResults.length === 0) {
            throw new Error(`Transaksi STBJ dengan nomor ${nomor} tidak ditemukan.`);
        }

        const headerData = headerResults[0];

        // 2. Ambil Data Detail (+ Total Order & Sudah-STBJ di luar dokumen ini)
        const sqlDetail = `
            SELECT 
                stbjd_spk_nomor AS spk, 
                COALESCE(s.spk_nama, m.mspk_nama, i.spgi_nama) AS nama_spk, 
                COALESCE(s.spk_ukuran, m.mspk_ukuran) AS ukuran, 
                stbjd_size AS size,
                COALESCE(s.spk_jumlah, m.mspk_jumlah, 0) AS Total_Order,
                IFNULL((
                    SELECT SUM(x.stbjd_jumlah) FROM tstbj_dtl x
                    WHERE x.stbjd_spk_nomor = d.stbjd_spk_nomor
                      AND x.stbjd_stbj_nomor <> d.stbjd_stbj_nomor
                ), 0) AS Order_Cetak,
                stbjd_jumlah AS qty, 
                stbjd_koli AS koli, 
                stbjd_keterangan AS keterangan,
                stbjd_packing AS packing
            FROM tstbj_dtl d
            LEFT JOIN tspk s ON s.spk_nomor = d.stbjd_spk_nomor
            LEFT JOIN tmemospk m ON m.mspk_nomor = d.stbjd_spk_nomor
            LEFT JOIN tspk_gudangitem i ON i.spgi_spk = d.stbjd_spk_nomor
            WHERE d.stbjd_stbj_nomor = ?
            ORDER BY d.stbjd_spk_nomor ASC;
        `;
        
        const [detailResults] = await pool.query(sqlDetail, [nomor]);

        // 3. Gabungkan Header dan Detail dalam satu objek
        return {
            ...headerData,
            details: detailResults
        };

    } catch (error) {
        throwDbError(`Gagal mengambil data STBJ (${nomor})`, error);
    }
};