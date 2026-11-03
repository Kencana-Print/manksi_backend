const pool = require('../../../config/database');
const { format, parseISO, isValid } = require('date-fns');

const throwDbError = (message, error) => {
    console.error(message, error.message);
    throw new Error(message + ': ' + error.message);
};

// ===================================
// GENERATE NOMOR VOUCHER
// Format: VCH/KP/2604/00001
// ===================================
exports.generateNomorVoucher = async (perushKode, tanggalInput) => {
    const tanggal = (typeof tanggalInput === 'string') ? parseISO(tanggalInput) : tanggalInput;
    if (!isValid(tanggal)) throw new Error('Tanggal voucher tidak valid');

    const yearMonth = format(tanggal, 'yyMM');
    const currentYear = format(tanggal, 'yyyy');
    const prefix = `VCH-${perushKode}`;
    
    const sql = `
        SELECT MAX(CAST(SUBSTRING_INDEX(vch_nomor, '${prefix}-', -1) AS UNSIGNED)) AS max_num
        FROM tvoucher_pemb_hdr
        WHERE vch_nomor LIKE '${prefix}-%' AND YEAR(vch_tanggal) = ?
    `;

    const [rows] = await pool.query(sql, [currentYear]);
    const nextNum = (rows[0].max_num || 0) + 1;
    const padded = String(nextNum).padStart(5, '0');

    return `${prefix}-${yearMonth}-${padded}`;
};

// ===================================
// SAVE VOUCHER PEMBAYARAN (PENGAJUAN)
// ===================================
exports.saveVoucher = async (data, userLogin) => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const perush = data.vch_perush_kode || 'KP';
        const nomorVoucher = await exports.generateNomorVoucher(perush, data.vch_tanggal);
        const activeUser = userLogin || 'SYSTEM';

        // 1. INSERT HEADER VOUCHER
        // Status awal: 'OPEN' atau 'PENDING'
        const sqlHeader = `
            INSERT INTO tvoucher_pemb_hdr 
            (vch_nomor, vch_tanggal, vch_sup_kode, vch_keterangan, vch_total_pengajuan, vch_status, user_create)
            VALUES (?, ?, ?, ?, ?, 'OPEN', ?)
        `;
        await connection.query(sqlHeader, [
            nomorVoucher, 
            data.vch_tanggal, 
            data.vch_sup_kode, 
            data.vch_keterangan, 
            data.vch_total_pengajuan, 
            activeUser
        ]);

        // 2. INSERT DETAIL VOUCHER
        if (data.detail && data.detail.length > 0) {
            for (const item of data.detail) {
                const sqlDetail = `
                    INSERT INTO tvoucher_pemb_dtl (vchd_nomor, vchd_inv_nomor, vchd_nominal)
                    VALUES (?, ?, ?)
                `;
                await connection.query(sqlDetail, [
                    nomorVoucher, 
                    item.vchd_inv_nomor, 
                    item.vchd_nominal
                ]);

                /** * OPTIONAL: Update status invoice menjadi 'LOCKED' 
                 * Agar invoice yang sedang diajukan tidak bisa dibuatkan voucher ganda
                 */
                const sqlLockInv = `UPDATE tinvp_hdr SET invp_status = 'LOCKED' WHERE invp_nomor = ?`;
                await connection.query(sqlLockInv, [item.vchd_inv_nomor]);
            }
        }

        // CATATAN: Jurnal tidak diposting di sini. 
        // Jurnal diposting saat proses "Realisasi/Bayar Voucher" oleh Kasir.

        await connection.commit();
        return { Nomor: nomorVoucher };

    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
};

// ===================================
// GET VOUCHER LIST (UNTUK BROWSE)
// ===================================
exports.getVoucherData = async (startDate, endDate) => {
    try {
        // Guard: tanggal kosong ("") di-skip agar tidak jadi klausa zero-date.
        const dateConds = [];
        const dateParams = [];
        if (startDate) {
            dateConds.push(`h.vch_tanggal >= ?`);
            dateParams.push(startDate);
        }
        if (endDate) {
            dateConds.push(`h.vch_tanggal <= ?`);
            dateParams.push(endDate);
        }
        const sql = `
            SELECT 
                h.vch_nomor AS Nomor,
                DATE_FORMAT(h.vch_tanggal, '%d-%m-%Y') AS Tanggal,
                s.sup_nama AS Supplier,
                h.vch_total_pengajuan AS Total,
                h.vch_status AS Status,
                h.vch_keterangan AS Keterangan
            FROM tvoucher_pemb_hdr h
            LEFT JOIN tsupplier s ON s.sup_kode = h.vch_sup_kode
            WHERE ${dateConds.length ? dateConds.join(" AND ") : "1=1"}
            ORDER BY h.vch_tanggal DESC, h.vch_nomor DESC
        `;
        const [rows] = await pool.query(sql, dateParams);
        return rows;
    } catch (error) {
        throwDbError('Gagal mengambil daftar voucher', error);
    }
};