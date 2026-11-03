// backend/src/services/penerimaanBahanService.js

const pool = require("../../../config/database");
const { format } = require('date-fns');

const throwDbError = (message, error) => {
    console.error(message, error.message);
    throw new Error(message + ': ' + error.message);
};

// ===================================
// READ (btnRefreshClick)
// ===================================
exports.getRecMmtData = async (startDate, endDate) => {
    try {
        // Query SQL Master: Mengambil data header penerimaan (Logika SAMA)
        const sqlMaster = `
            SELECT
                rec_nomor AS Nomor,
                rec_gdg_kode AS Gudang,
                gdg_nama AS Nama_Gudang,
                DATE_FORMAT(rec_tanggal, '%d/%m/%Y') AS Tanggal,
                sup_nama AS Supplier,
                rec_memo AS No_permintaan,
                rec_keterangan AS Keterangan
            FROM trec_mmt_hdr
            INNER JOIN tsupplier ON sup_kode = rec_sup_kode
            INNER JOIN trec_mmt_dtl ON recd_rec_nomor = rec_nomor
            LEFT JOIN tgudang ON gdg_kode = rec_gdg_kode
            WHERE
                rec_tanggal BETWEEN ? AND ?
                AND recd_brg_kode IN (SELECT brg_kode FROM tbarang_mmt WHERE brg_gdg_default = 'WH-16')
                AND gdg_kode LIKE '%WH%'
            GROUP BY
                rec_gdg_kode, rec_nomor, rec_tanggal, rec_memo, sup_nama
            ORDER BY rec_nomor DESC;
        `;
        const [masterResults] = await pool.query(sqlMaster, [startDate, endDate]);

        const masterNomors = masterResults.map(row => row.Nomor);
        if (masterNomors.length === 0) return [];

        // Query SQL Detail (Logika SAMA)
        const sqlDetail = `
            SELECT
        d.recd_rec_nomor AS Nomor,
        d.recd_brg_kode AS Kode,
        b.brg_nama AS Nama_Bahan,
        b.brg_panjang AS Panjang,
        b.brg_lebar AS Lebar,
        d.recd_brg_satuan AS Satuan,
        d.recd_qty AS Jumlah_PO,
        d.recd_qty_terima AS Jumlah_Terima,
        d.recd_keterangan AS Keterangan,
        -- Tambahkan ini untuk mengambil barcode dari tabel stok
        (SELECT GROUP_CONCAT(mst_barcode ORDER BY mst_barcode ASC) 
         FROM tmasterstok_mmt 
         WHERE mst_noreferensi = d.recd_rec_nomor 
         AND mst_brg_kode = d.recd_brg_kode) AS List_Barcode
    FROM trec_mmt_dtl d
    INNER JOIN tbarang_mmt b ON d.recd_brg_kode = b.brg_kode
    WHERE d.recd_rec_nomor IN (?)
    ORDER BY d.recd_rec_nomor, d.recd_nourut;
        `;
        const [detailResults] = await pool.query(sqlDetail, [masterNomors]);

        const dataMap = new Map();
        masterResults.forEach(item => dataMap.set(item.Nomor, { ...item, Detail: [] }));
        detailResults.forEach(detail => {
            if (dataMap.has(detail.Nomor)) {
                dataMap.get(detail.Nomor).Detail.push(detail);
            }
        });

        return Array.from(dataMap.values());

    } catch (error) {
        throwDbError('Gagal mengambil data Penerimaan MMT dari database', error);
    }
};

// ===================================
// DELETE (cxButton4Click)
// ===================================
exports.deleteRecMmt = async (nomor) => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        await connection.query('DELETE FROM trec_mmt_dtl WHERE recd_rec_nomor = ?', [nomor]);
        const [headerResult] = await connection.query('DELETE FROM trec_mmt_hdr WHERE rec_nomor = ?', [nomor]);

        if (headerResult.affectedRows === 0) {
            throw new Error("Nomor transaksi tidak ditemukan atau sudah terhapus.");
        }

        await connection.commit();
        return true;

    } catch (error) {
        await connection.rollback();
        throwDbError('Gagal menghapus transaksi Penerimaan MMT', error);
    } finally {
        connection.release();
    }
};

// ===================================
// CHECK STATUS (cekreceipt)
// ===================================
exports.checkRecStatus = async (nomor) => {
    try {
        const sql = 'SELECT rec_status_rec FROM trec_mmt_hdr WHERE rec_nomor = ?';
        const [rows] = await pool.query(sql, [nomor]);

        if (rows.length === 0) {
            return 0;
        }
        return parseInt(rows[0].rec_status_rec) || 0;

    } catch (error) {
        throwDbError('Gagal memeriksa status receipt', error);
    }
};

// backend/src/services/penerimaanBahanService.js (Lanjutan)
// ... (Bagian READ, DELETE, checkRecStatus dari jawaban sebelumnya)

// ===================================
// Generate Max Kode (Replikasi getmaxkode)
// ===================================
exports.generateMaxKode = async (tanggal, isTaxed) => {
    const NOMERATOR = 'MMT.REC';
    const yyMm = format(new Date(tanggal), 'yyMM');

    const sql = `
        SELECT MAX(CAST(RIGHT(rec_nomor, 4) AS UNSIGNED)) AS max_num
        FROM trec_mmt_hdr
        WHERE rec_nomor LIKE ? 
    `;

    const prefix = `${NOMERATOR}.${yyMm}.%`;
    const [rows] = await pool.query(sql, [prefix]);

    const maxNum = rows[0].max_num || 0;
    const newNum = maxNum + 1;

    // 4-digit padding → 0001, 0002, 0003
    const paddedNum = String(newNum).padStart(4, '0');

    return `${NOMERATOR}.${yyMm}.${paddedNum}`;
};


exports.saveRecMmt = async (data, nomorToEdit, user) => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const {
            nomor, tanggal, supplier_kode, gudang_kode, no_permintaan, keterangan, no_resi
        } = data.header;

        const headerData = {
            Tanggal: tanggal,
            NoMinta: no_permintaan,
            SupplierKode: supplier_kode || '',
            GudangKode: gudang_kode || '',
            KeteranganHeader: keterangan,
            DiscFaktur: 0,
            DiscPr: 0,
            Total: 0,
            PPN: 0,
            isTaxed: false,
            Dateline: tanggal,
            Pemesan: user
        };

        const currentNomor = nomorToEdit || await exports.generateMaxKode(headerData.Tanggal, headerData.isTaxed);
        const serverTime = format(new Date(), 'yyyy-MM-dd HH:mm:ss');
        const aistax = headerData.isTaxed ? 1 : 0;

        if (!headerData.SupplierKode || !headerData.GudangKode) {
            throw new Error("Supplier dan Kode Gudang wajib diisi.");
        }

        if (!data.details || data.details.length === 0) {
            throw new Error('Detail item wajib diisi.');
        }


if (nomorToEdit) {
    const sqlUpdate = `
        UPDATE Trec_mmt_hdr SET
            rec_sup_kode = ?, rec_gdg_kode = ?, rec_memo = ?, rec_resi = ?, -- 🔥 PERBAIKAN: Tambahkan '=' dan '?'
            rec_disc_faktur = ?, rec_disc_fakturpr = ?, rec_amount = ?, rec_taxamount = ?, rec_istax = ?,
            rec_dateline = ?, rec_pemesan = ?, date_modified = ?, user_modified = ?,
            rec_keterangan = ?
        WHERE rec_nomor = ?
    `;
    await connection.query(sqlUpdate, [
        headerData.SupplierKode, headerData.GudangKode, headerData.NoMinta, no_resi,
        headerData.DiscFaktur, headerData.DiscPr, headerData.Total, headerData.PPN,
        aistax, headerData.Dateline, headerData.Pemesan,
        serverTime, user, headerData.KeteranganHeader, currentNomor
    ]);

    await connection.query('DELETE FROM Trec_mmt_DTL WHERE recd_rec_nomor = ?', [currentNomor]);

        } else {

            // =============================
            //        MODE INSERT
            // =============================
            const sqlInsert = `
        INSERT INTO Trec_mmt_hdr 
        (rec_nomor, rec_tanggal, rec_memo, rec_sup_kode, rec_gdg_kode, 
         rec_resi, -- Tambahkan kolom ini
         rec_disc_faktur, rec_disc_fakturpr, rec_amount, rec_taxamount, 
         rec_istax, rec_dateline, rec_pemesan, date_create, user_create, rec_keterangan,
         rec_status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
            await connection.query(sqlInsert, [
                currentNomor, headerData.Tanggal, headerData.NoMinta,
                headerData.SupplierKode, headerData.GudangKode,
                no_resi,
                headerData.DiscFaktur, headerData.DiscPr, headerData.Total,
                headerData.PPN, aistax, headerData.Dateline, headerData.Pemesan,
                serverTime, user, headerData.KeteranganHeader, 'OPEN'
            ]);
        }

        // =============================
        //         INSERT DETAIL
        // =============================
        const detailValues = data.details
            .map((d, index) => [
                currentNomor,
                d.kode,               // Sesuaikan dengan payload Vue (d.kode)
                d.satuan || '',
                parseFloat(d.qtyPO) || 0,
                parseFloat(d.qtyTerima) || 0,
                0, 
                parseFloat(d.harga) || 0,
                d.keterangan || '',
                index + 1
            ]);

        const sqlInsertDetail = `
    INSERT INTO trec_mmt_dtl 
    (recd_rec_nomor, recd_brg_kode, recd_brg_satuan, recd_qty, recd_qty_terima, 
     recd_discpr, recd_harga, recd_keterangan, recd_nourut) 
    VALUES ?
`;
        await connection.query(sqlInsertDetail, [detailValues]);
        // =============================================
        // ❌ Dihapus total — stok sudah dihandle TRIGGER
        // =============================================
        // Tidak ada insert ke tmasterstok_mmt di sini

        await connection.commit();
        return { Nomor: currentNomor, message: 'Data berhasil disimpan.' };

    } catch (error) {
        await connection.rollback();
        throw new Error('Database Transaction Error on Save: ' + error.message);
    } finally {
        connection.release();
    }
};


// ===================================
// LOAD DATA (Replikasi loaddataall)
// ===================================
exports.loadRecMmtById = async (nomor) => {
    // Query yang disederhanakan, di backend nyata ini bisa jadi sangat kompleks
    const sql = `
        SELECT 
            r.*, 
            d.*, 
            b.brg_nama, b.brg_panjang, b.brg_lebar, b.brg_satuan
        FROM trec_mmt_hdr r
        INNER JOIN trec_mmt_dtl d ON r.rec_nomor = d.recd_rec_nomor
        INNER JOIN tbarang_mmt b ON d.recd_brg_kode = b.brg_kode
        WHERE r.rec_nomor = ?
        ORDER BY d.recd_nourut;
    `;
    const [rows] = await pool.query(sql, [nomor]);

    if (rows.length === 0) return null;

    // Menggabungkan data menjadi format Header dan Detail
    const header = {
        Nomor: rows[0].rec_nomor,
        Tanggal: format(rows[0].rec_tanggal, 'yyyy-MM-dd'),
        NoMinta: rows[0].rec_memo,
        no_resi: rows[0].rec_resi,
        SupplierKode: rows[0].rec_sup_kode,
        GudangKode: rows[0].rec_gdg_kode,
        DiscPr: rows[0].rec_disc_fakturpr,
        DiscFaktur: rows[0].rec_disc_faktur,
        isTaxed: rows[0].rec_istax === 1,
        Dateline: format(rows[0].rec_dateline, 'yyyy-MM-dd'),
        Pemesan: rows[0].rec_pemesan,
        KeteranganHeader: rows[0].rec_keterangan,
        // (Tambahkan field header lain yang mungkin dibutuhkan, seperti Total/PPN)
    };

    const details = rows.map(row => ({
        SKU: row.recd_brg_kode,
        Nama_Bahan: row.brg_nama,
        QTY: row.recd_qty, // QTY PO
        QTY_Rec: row.recd_qty_terima, // QTY Terima (Inputan Form)
        Satuan: row.recd_brg_satuan,
        Panjang: row.brg_panjang,
        Lebar: row.brg_lebar,
        Harga: row.recd_harga,
        Disc: row.recd_discpr,
        KeteranganItem: row.recd_keterangan,
    }));

    return { ...header, Detail: details };
};

exports.getPOLookupData = async (keyword) => {
    try {
        let sql = `
            SELECT 
                po_nomor AS Nomor, 
                DATE_FORMAT(po_tanggal, '%d/%m/%Y') AS Tanggal, 
                po_sup_kode AS Supplier
            FROM tpo_mmt_hdr 
        `;

        const params = [];

        if (keyword) {
            // Filter berdasarkan Nomor PO atau Nama Supplier
            sql += ` AND (po_nomor LIKE ? OR po_sup_kode LIKE ?)`;
            const searchKeyword = `%${keyword}%`;
            params.push(searchKeyword, searchKeyword);
        }

        sql += ` ORDER BY po_nomor DESC LIMIT 100`; // Batasi hasil

        const [rows] = await pool.query(sql, params);
        return rows;
    } catch (error) {
        throwDbError('Gagal mengambil data PO untuk lookup', error);
    }
};

// ==============================================
// ENDPOINT 2: MENGAMBIL DETAIL PO LENGKAP
// ==============================================
exports.getPODetail = async (poNomor) => {
    try {
        // 1. Ambil Data Header
        const [headerRows] = await pool.query(
            `SELECT 
                po_nomor AS Nomor, 
                DATE_FORMAT(po_tanggal, '%Y-%m-%d') AS Tanggal, 
                po_sup_kode AS Kode_Supplier
            FROM tpo_mmt_hdr WHERE po_nomor = ?`,
            [poNomor]
        );

        if (headerRows.length === 0) {
            throw new Error(`Nomor PO ${poNomor} tidak ditemukan.`);
        }

        const header = headerRows[0];

        // 2. Ambil Data Detail Item (Gabung dengan Master Bahan untuk Panjang/Lebar)
        const [detailRows] = await pool.query(
            `SELECT
                D.pod_brg_kode AS SKU,
                B.brg_nama AS Nama_Bahan,
                D.pod_qty AS QTY_PO,
                B.brg_satuan AS Satuan,
                B.brg_panjang AS Panjang,
                B.brg_lebar AS Lebar
            FROM tpo_mmt_dtl D
            INNER JOIN tbarang_mmt B ON D.pod_brg_kode = B.brg_kode
            WHERE D.pod_po_nomor = ?`,
            [poNomor]
        );
        return {
            header,
            details: detailRows
        };

    } catch (error) {
        throwDbError(`Gagal memuat detail PO ${poNomor}`, error);
    }
};

// Tambahkan di penerimaanBahanService.js atau panggil di endpoint terkait
exports.getBarcodesByNomor = async (nomor) => {
    try {
        const sql = `
            SELECT 
                s.mst_brg_kode AS kode, 
                s.mst_barcode AS barcode,
                b.brg_nama AS namaBahan,
                s.mst_stok_in AS qty -- Tambahkan qty agar item non-roll terlihat jumlahnya
            FROM tmasterstok_mmt s
            JOIN tbarang_mmt b ON s.mst_brg_kode = b.brg_kode
            WHERE s.mst_noreferensi = ?
            /* Filter ROLL dihapus agar item non-roll (barcode '-') tetap muncul */
            ORDER BY s.mst_barcode ASC
        `;
        const [rows] = await pool.query(sql, [nomor]);
        return rows;
    } catch (error) {
        throw error;
    }
};


// ============================================================
// LOOKUP UNTUK INVOICE (Menampilkan Header Penerimaan)
// ============================================================
// services/penerimaanBahan.service.js

exports.getRecLookupForInvoice = async (keyword = '') => {
    try {
        let sql = `
            SELECT DISTINCT
                h.rec_nomor AS Nomor,
                DATE_FORMAT(h.rec_tanggal, '%d/%m/%Y') AS Tanggal,
                s.sup_nama AS Supplier,
                h.rec_memo AS No_Permintaan,
                h.rec_sup_kode AS Kode_Supplier,
                h.rec_memo AS No_Permintaan,
                h.rec_keterangan AS Keterangan
            FROM trec_mmt_hdr h
            INNER JOIN tsupplier s 
                ON s.sup_kode = h.rec_sup_kode
            INNER JOIN trec_mmt_dtl d
                ON TRIM(d.recd_rec_nomor) = TRIM(h.rec_nomor)
            WHERE 1=1
        `;

        const params = [];

        // OPTIONAL: hanya yang belum di-invoice
        // sql += ` AND (h.rec_inv_nomor IS NULL OR h.rec_inv_nomor = '') `;

        if (keyword && keyword.trim() !== '') {
            sql += `
                AND (
                    TRIM(h.rec_nomor) LIKE ?
                    OR s.sup_nama LIKE ?
                    OR h.rec_memo LIKE ?
                )
            `;
            const search = `%${keyword.trim()}%`;
            params.push(search, search, search);
        }

        sql += ` ORDER BY h.rec_nomor DESC LIMIT 50`;

        const [rows] = await pool.query(sql, params);
        return rows;

    } catch (error) {
        console.error('ERROR SQL getRecLookupForInvoice:', error);
        throwDbError('Gagal mengambil data lookup penerimaan', error);
    }
};

exports.getRecDetailForInvoice = async (recNomor) => {
    try {
        const nomor = recNomor.trim();

        // 1. Ambil Header Penerimaan
        const [header] = await pool.query(
            `SELECT 
                rec_nomor,
                rec_sup_kode,
                rec_istax,
                rec_taxamount,
                rec_memo -- Asumsi No PO disimpan di kolom rec_memo
             FROM trec_mmt_hdr
             WHERE TRIM(rec_nomor) = ?`,
            [nomor]
        );

        if (header.length === 0) {
            throw new Error(`Nomor penerimaan ${nomor} tidak ditemukan`);
        }

        const noPO = header[0].rec_memo ? header[0].rec_memo.trim() : '';

        // 2. Ambil Details + JOIN ke PO Detail untuk ambil Harga
        const [details] = await pool.query(
            `SELECT 
                d.recd_brg_kode AS Kode,
                b.brg_nama AS Nama_Barang,
                d.recd_brg_satuan AS Satuan,
                b.brg_satuan_harga AS Satuan_Harga,
                b.brg_panjang AS Panjang,
                b.brg_lebar AS Lebar,
                d.recd_qty_terima AS Qty,
                -- Ambil harga dari PO, jika tidak ada baru ambil dari recd_harga
                COALESCE(po.pod_harga, d.recd_harga, 0) AS Harga_Beli,
                d.recd_discpr AS Diskon_Item
             FROM trec_mmt_dtl d
             INNER JOIN tbarang_mmt b ON b.brg_kode = d.recd_brg_kode
             -- JOIN ke detail PO berdasarkan No PO dan Kode Barang
             LEFT JOIN tpo_mmt_dtl po 
                ON TRIM(po.pod_po_nomor) = ? 
                AND TRIM(po.pod_brg_kode) = TRIM(d.recd_brg_kode)
             WHERE TRIM(d.recd_rec_nomor) = ?`,
            [noPO, nomor]
        );

        return {
            header: header[0],
            details: details
        };

    } catch (error) {
        console.error('ERROR SQL getRecDetailForInvoice:', error);
        throw (error);
    }
};


exports.getPenerimaanBahanForPrint = async (nomor) => {
    try {
        // --- HEADER ---
        const sqlHeader = `
            SELECT
                r.rec_nomor AS NoPenerimaan,
                r.rec_memo AS NoPO,
                IFNULL(s.sup_nama, r.rec_sup_kode) AS Supplier,
                r.rec_gdg_kode AS Gudang,
                DATE_FORMAT(r.rec_tanggal, '%d/%m/%Y') AS Tanggal,
                
                -- Mapping user / tanda tangan
                IFNULL(u1.user_nama, r.rec_pemesan) AS Dibuat

            FROM trec_mmt_hdr r
            LEFT JOIN tsupplier s ON r.rec_sup_kode = s.sup_kode
            LEFT JOIN tuser u1 ON r.rec_pemesan = u1.user_kode
            WHERE r.rec_nomor = ?;
        `;
        const [headerResult] = await pool.query(sqlHeader, [nomor]);
        if (headerResult.length === 0) throw new Error("Data penerimaan tidak ditemukan.");
        const header = headerResult[0];

        // --- DETAIL ---
        const sqlDetail = `
            SELECT
                d.recd_nourut AS No,
                d.recd_brg_kode AS Kode,
                b.brg_nama AS Nama_Barang,
                d.recd_brg_satuan AS Satuan,
                d.recd_qty AS Qty_PO,
                d.recd_qty_terima AS Qty_Terima,
                d.recd_harga AS Harga,
                d.recd_keterangan AS Keterangan,
                0 AS Is_Acc -- bisa pakai flag jika ingin ACC
            FROM trec_mmt_dtl d
            LEFT JOIN tbarang_mmt b ON d.recd_brg_kode = b.brg_kode
            WHERE d.recd_rec_nomor = ?
            ORDER BY d.recd_nourut;
        `;
        const [detailResults] = await pool.query(sqlDetail, [nomor]);

        return {
            ...header,
            Details: detailResults,
            Dibuat: header.Dibuat || '................',
            Diketahui: header.Diketahui || '................',
            Disetujui: header.Disetujui || '................'
        };

    } catch (error) {
        throwDbError('Gagal mengambil data cetak penerimaan bahan', error);
    }
};

