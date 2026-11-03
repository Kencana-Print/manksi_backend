// backend/src/services/returProduksi.service.js

const pool = require("../../../config/database");
const { format } = require('date-fns');

const throwDbError = (message, error) => { 
    throw new Error(message + ': ' + error.message); 
};

/**
 * Ambil semua data Retur Produksi berdasarkan range tanggal
 */
exports.getReturProduksiData = async (startDate, endDate) => {
    try {
        // 1. Query Master/Header
        const sqlMaster = `
            SELECT
                h.rmnt_nomor AS Nomor,
                h.rmnt_gdg_kode AS GudangTujuan,
                g_tujuan.gdg_nama AS NamaGudangTujuan,
                h.rmnt_gdg_asal AS GudangAsal,
                h.rmnt_tanggal AS TanggalAsli,
                DATE_FORMAT(h.rmnt_tanggal, '%d/%m/%Y') AS Tanggal, 
                h.rmnt_spk_nomor AS NomorSPK,
                h.rmnt_keterangan AS Keterangan,
                h.rmnt_type AS TypeCode,
                CASE 
                    WHEN h.rmnt_type = 1 THEN 'PRODUKSI'
                    WHEN h.rmnt_type = 2 THEN 'LAINNYA'
                    ELSE 'UNKNOWN'
                END AS TypeLabel
            FROM treturminta_mmt_hdr h
            LEFT JOIN tgudang g_tujuan ON h.rmnt_gdg_kode = g_tujuan.gdg_kode
            WHERE h.rmnt_tanggal BETWEEN ? AND ?
            ORDER BY h.rmnt_tanggal DESC, h.rmnt_nomor DESC;
        `;

        // 2. Query Detail
        const sqlDetail = `
            SELECT
                d.rmntd_rmnt_nomor AS Nomor,
                d.rmntd_brg_kode AS Kode,
                d.rmntd_barcode AS Barcode,
                TRIM(b.brg_nama) AS Nama_Bahan,
                d.rmntd_qty AS Jumlah,
                b.brg_satuan AS Satuan,
                d.rmntd_panjang AS Panjang,
                d.rmntd_lebar AS Lebar,
                d.rmntd_expired AS Expired,
                d.rmntd_keterangan AS KeteranganDetail
            FROM treturminta_mmt_dtl d
            LEFT JOIN tbarang_mmt b ON d.rmntd_brg_kode = b.brg_kode
            WHERE d.rmntd_rmnt_nomor IN (?);
        `;

        const [masterResults] = await pool.query(sqlMaster, [startDate, endDate]);
        
        if (masterResults.length === 0) return [];

        const masterNomors = masterResults.map(row => row.Nomor);
        const [detailResults] = await pool.query(sqlDetail, [masterNomors]);

        // 3. Mapping data Detail ke dalam Header masing-masing
        const dataMap = new Map();
        masterResults.forEach(item => {
            dataMap.set(item.Nomor, { ...item, Detail: [] });
        });

        detailResults.forEach(detail => {
            if (dataMap.has(detail.Nomor)) {
                dataMap.get(detail.Nomor).Detail.push(detail);
            }
        });

        return Array.from(dataMap.values());

    } catch (error) {
        throw new Error('Gagal ambil data retur produksi: ' + error.message);
    }
};

exports.getReturProduksiByNomor = async (nomor) => {
    try {
        const sqlMaster = `
            SELECT
                h.rmnt_nomor AS Nomor,
                h.rmnt_gdg_kode AS GudangTujuan,
                g_tujuan.gdg_nama AS NamaGudangTujuan,
                h.rmnt_gdg_asal AS GudangAsal,
                DATE_FORMAT(h.rmnt_tanggal, '%Y-%m-%d') AS Tanggal, 
                h.rmnt_spk_nomor AS NomorSPK,
                h.rmnt_keterangan AS Keterangan,
                h.rmnt_type AS TypeCode,
                CASE 
                    WHEN h.rmnt_type = 1 THEN 'PRODUKSI'
                    WHEN h.rmnt_type = 2 THEN 'LAINNYA'
                    ELSE 'UNKNOWN'
                END AS TypeLabel
            FROM treturminta_mmt_hdr h
            LEFT JOIN tgudang g_tujuan ON h.rmnt_gdg_kode = g_tujuan.gdg_kode
            WHERE h.rmnt_nomor = ? LIMIT 1;
        `;
        const [masterResults] = await pool.query(sqlMaster, [nomor]);
        if (!masterResults.length) return null;

        const sqlDetail = `
            SELECT
                d.rmntd_rmnt_nomor AS Nomor,
                d.rmntd_brg_kode AS sku,
                d.rmntd_barcode AS barcode,
                TRIM(b.brg_nama) AS Nama_Bahan,
                d.rmntd_qty AS qty,
                b.brg_satuan AS satuan,
                d.rmntd_panjang AS panjang,
                d.rmntd_lebar AS lebar,
                d.rmntd_expired AS expired,
                d.rmntd_keterangan AS keterangan
            FROM treturminta_mmt_dtl d
            LEFT JOIN tbarang_mmt b ON d.rmntd_brg_kode = b.brg_kode
            WHERE d.rmntd_rmnt_nomor = ?;
        `;
        const [detailResults] = await pool.query(sqlDetail, [nomor]);

        return {
            header: masterResults[0],
            details: detailResults
        };
    } catch (error) {
        throw new Error('Gagal ambil detail retur: ' + error.message);
    }
};

exports.getStokByBarcode = async (barcode, gudangAsal) => {
    try {
        const sql = `
            SELECT 
                TRIM(REPLACE(m.mst_barcode, '\t', '')) AS Barcode, 
                m.mst_brg_kode AS Kode, 
                TRIM(b.brg_nama) AS Nama_Bahan, 
                b.brg_satuan AS Satuan, 
                MAX(m.mst_panjang) AS Panjang, 
                MAX(m.mst_lebar) AS Lebar,
                MAX(m.mst_spk_nomor) AS Nomor_SPK,
                SUM(COALESCE(m.mst_stok_in, 0) - COALESCE(m.mst_stok_out, 0)) AS Stok
            FROM tmasterstok_mmt m
            LEFT JOIN tbarang_mmt b ON m.mst_brg_kode = b.brg_kode
            WHERE TRIM(REPLACE(m.mst_barcode, '\t', '')) = TRIM(REPLACE(?, '\t', '')) AND m.mst_gdg_kode = ?
            GROUP BY TRIM(REPLACE(m.mst_barcode, '\t', '')), m.mst_brg_kode, b.brg_nama, b.brg_satuan
            HAVING Stok > 0;
        `;

        const [results] = await pool.query(sql, [barcode, gudangAsal]);
        return results[0] || null;
    } catch (error) {
        throw new Error(`Gagal scan barcode retur: ${error.message}`);
    }
};

/**
 * Generate Nomor Dokumen Baru (MMT.RMP.YYMM.0001)
 */
exports.getNewNomor = async () => {
    const NOMERATOR = 'MMT.RMP';
    try {
        const currentYYMM = format(new Date(), 'yyMM');
        const searchPattern = `${NOMERATOR}.${currentYYMM}.%`;

        const sql = `
            SELECT MAX(rmnt_nomor) AS MaxNomor 
            FROM treturminta_mmt_hdr 
            WHERE rmnt_nomor LIKE ?;
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
        throwDbError('Gagal mendapatkan nomor retur baru', error);
    }
};

/**
 * Simpan atau Update Retur Produksi
 */
exports.saveReturProduksi = async (data, isUpdate = false, userLogin) => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        let { 
            Nomor, Tanggal, GudangTujuan, GudangAsal, 
            NomorSPK, Keterangan, Type, Details 
        } = data;

        // PERBAIKAN 1: Gunakan asalFix agar GudangAsal terisi 'GPM' jika null
        const asalFix = GudangAsal || 'GPM';

        // Mapping Type
        if (Type === 'PRODUKSI') {
            Type = 1; 
        } else if (Type === 'LAINNYA') {
            Type = 2;
        } else {
            Type = Number(Type) || 0; 
        }

        const serverTime = new Date();
        const activeUser = userLogin || 'SYSTEM';

        if (!isUpdate && (!Nomor || Nomor === 'AUTO')) {
            Nomor = await exports.getNewNomor();
        }

        if (isUpdate) {
            // Update Header
            await connection.query(
                `UPDATE treturminta_mmt_hdr SET 
                    rmnt_tanggal=?, rmnt_gdg_kode=?, rmnt_gdg_asal=?, 
                    rmnt_spk_nomor=?, rmnt_keterangan=?, rmnt_type=?, 
                    user_modified=?, date_modified=? 
                WHERE rmnt_nomor=?`,
                // PERBAIKAN 2: Gunakan asalFix di sini
                [Tanggal, GudangTujuan, asalFix, NomorSPK, Keterangan, Type, activeUser, serverTime, Nomor]
            );
            // Hapus detail lama + jejak stok lama nomor ini
            await connection.query('DELETE FROM treturminta_mmt_dtl WHERE rmntd_rmnt_nomor = ?', [Nomor]);
            await connection.query('DELETE FROM tmasterstok_mmt WHERE mst_noreferensi = ?', [Nomor]);
        } else {
            // Insert Header
            await connection.query(
                `INSERT INTO treturminta_mmt_hdr 
                    (rmnt_nomor, rmnt_tanggal, rmnt_gdg_kode, rmnt_gdg_asal, rmnt_spk_nomor, rmnt_keterangan, rmnt_type, user_create, date_create) 
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                // PERBAIKAN 3: Gunakan asalFix di sini
                [Nomor, Tanggal, GudangTujuan, asalFix, NomorSPK, Keterangan, Type, activeUser, serverTime]
            );
        }

        // Simpan Detail
        if (Details && Details.length > 0) {
            const detailValues = Details.map((d, index) => [
                Nomor, 
                d.sku, 
                d.qty, 
                d.expired || null, 
                d.keterangan, 
                d.nourut || (index + 1), 
                GudangTujuan || data.Gudang, 
                d.barcode || null, 
                // PERBAIKAN 4: Pastikan properti panjang & lebar dari frontend benar-benar ada
                Number(d.panjang) || 0, 
                Number(d.lebar) || 0
            ]);

            await connection.query(
                `INSERT INTO treturminta_mmt_dtl 
                (rmntd_rmnt_nomor, rmntd_brg_kode, rmntd_qty, rmntd_expired, rmntd_keterangan, rmntd_nourut, rmntd_gdg_kode, rmntd_barcode, rmntd_panjang, rmntd_lebar) 
                VALUES ?`, [detailValues]
            );

            // --- MUTASI STOK (tmasterstok_mmt): OUT dari gudang asal + IN ke gudang tujuan ---
            // Harga (mst_hargabeli / mst_satuan_harga) mengikuti baris barcode sebelumnya.
            const distinctBarcodes = [...new Set(
                Details.map((d) => (d.barcode || '').trim()).filter(Boolean)
            )];
            const hargaByBarcode = new Map();
            if (distinctBarcodes.length > 0) {
                const [hargaRows] = await connection.query(
                    `SELECT mst_barcode, mst_hargabeli, mst_satuan_harga
                     FROM tmasterstok_mmt
                     WHERE mst_barcode IN (?)
                     ORDER BY mst_tanggal DESC, id DESC`,
                    [distinctBarcodes]
                );
                for (const r of hargaRows) {
                    if (!hargaByBarcode.has(r.mst_barcode)) {
                        hargaByBarcode.set(r.mst_barcode, {
                            hargabeli: r.mst_hargabeli ?? 0,
                            satuan_harga: r.mst_satuan_harga ?? '',
                        });
                    }
                }
            }

            for (const d of Details) {
                const barcodeBersih = (d.barcode || '').trim();
                const hargaPrev = hargaByBarcode.get(barcodeBersih) || { hargabeli: 0, satuan_harga: '' };
                const kodeBahan = d.sku;
                const qtyRetur = Number(d.qty) || 0;
                const panjangRetur = Number(d.panjang) || 0;
                const lebarRetur = Number(d.lebar) || 0;
                const spkRetur = d.spk || '';
                // OUT gudang asal
                await connection.query(
                    `INSERT INTO tmasterstok_mmt
                        (mst_brg_kode, mst_barcode, mst_gdg_kode, mst_noreferensi, mst_tanggal,
                         mst_stok_in, mst_stok_out, mst_panjang, mst_lebar, mst_spk_nomor,
                         mst_hargabeli, mst_satuan_harga, date_create)
                     VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?)`,
                    [kodeBahan, barcodeBersih, asalFix, Nomor, Tanggal,
                     qtyRetur, panjangRetur, lebarRetur, spkRetur,
                     hargaPrev.hargabeli, hargaPrev.satuan_harga, serverTime]
                );
                // IN gudang tujuan
                if (GudangTujuan && GudangTujuan !== asalFix) {
                    await connection.query(
                        `INSERT INTO tmasterstok_mmt
                            (mst_brg_kode, mst_barcode, mst_gdg_kode, mst_noreferensi, mst_tanggal,
                             mst_stok_in, mst_stok_out, mst_panjang, mst_lebar, mst_spk_nomor,
                             mst_hargabeli, mst_satuan_harga, date_create)
                         VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)`,
                        [kodeBahan, barcodeBersih, GudangTujuan, Nomor, Tanggal,
                         qtyRetur, panjangRetur, lebarRetur, spkRetur,
                         hargaPrev.hargabeli, hargaPrev.satuan_harga, serverTime]
                    );
                }
            }
        }

        await connection.commit();
        return { success: true, nomor: Nomor };
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
};

/**
 * Hapus Retur Produksi
 */
exports.deleteReturProduksi = async (nomor) => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        await connection.query('DELETE FROM treturminta_mmt_dtl WHERE rmntd_rmnt_nomor = ?', [nomor]);
        const [result] = await connection.query('DELETE FROM treturminta_mmt_hdr WHERE rmnt_nomor = ?', [nomor]);
        await connection.commit();
        return result.affectedRows > 0;
    } catch (error) {
        await connection.rollback();
        throwDbError('Gagal menghapus data retur', error);
    } finally {
        connection.release();
    }
};