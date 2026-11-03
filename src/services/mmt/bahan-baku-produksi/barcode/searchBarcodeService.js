// backend/src/services/searchBarcode.service.js

const pool = require("../../../../config/database");

/**
 * Helper untuk standarisasi error handling
 */
const throwDbError = (message, error) => { 
    throw new Error(`${message}: ${error.message}`); 
};

/**
 * SERVICE: Quick Search Barcode
 * Fungsi ini digunakan untuk melihat detail barang secara real-time 
 * tanpa harus membuat sesi stok opname terlebih dahulu.
 */
exports.findBarcodeDetail = async (barcode) => {
    try {
        const sql = `
            SELECT 
                m.mst_barcode AS Barcode,
                m.mst_brg_kode AS Kode,
                TRIM(b.brg_nama) AS Nama_Bahan,
                m.mst_gdg_kode AS Gudang,
                -- Menghitung stok akhir real-time: (Total Masuk - Total Keluar) * Panjang
                ROUND(
                    SUM(m.mst_stok_in * m.mst_panjang) - 
                    SUM(m.mst_stok_out * m.mst_panjang), 3
                ) AS Stok_Sistem,
                -- Info tambahan untuk verifikasi visual
                b.brg_satuan AS Satuan,
                'AVAILABLE' AS status_aktif
            FROM tmasterstok_mmt m
            LEFT JOIN tbarang_mmt b ON m.mst_brg_kode = b.brg_kode
            WHERE m.mst_barcode = ?
            GROUP BY 
                m.mst_barcode, 
                m.mst_brg_kode, 
                b.brg_nama, 
                m.mst_gdg_kode,
                b.brg_satuan
            HAVING Stok_Sistem > 0
            LIMIT 1;
        `;

        const [results] = await pool.query(sql, [barcode]);

        // Mengembalikan null jika barcode tidak ditemukan atau stok sudah 0
        return results[0] || null;

    } catch (error) {
        throwDbError('Gagal melakukan pencarian barcode real-time', error);
    }
};

/**
 * SERVICE: Riwayat Pergerakan Barcode (kartu stok per roll).
 * Menjawab: masuk gudang apa/kapan, pindah ke mana/kapan,
 * dipakai LHK apa, sisa berjalan berapa (meter).
 * Satuan meter mengikuti konvensi searchBarcode (qty × panjang).
 * Pemakaian LHK hanya informatif (tidak menggerakkan saldo):
 * hanya Proof & Mesin Cetak yang mencatat barcode roll.
 */
exports.getBarcodeHistory = async (barcode) => {
    try {
        const bc = String(barcode || "").trim();
        if (!bc) throw new Error("Barcode wajib diisi.");

        const [infoRows] = await pool.query(
            `SELECT m.mst_barcode AS Barcode, m.mst_brg_kode AS Kode,
                    TRIM(b.brg_nama) AS Nama_Bahan, b.brg_satuan AS Satuan
             FROM tmasterstok_mmt m
             LEFT JOIN tbarang_mmt b ON m.mst_brg_kode = b.brg_kode
             WHERE TRIM(m.mst_barcode) = TRIM(?)
             LIMIT 1`,
            [bc]
        );
        if (!infoRows.length) return null;
        const info = infoRows[0];

        const [moves] = await pool.query(
            `SELECT DATE_FORMAT(m.mst_tanggal, '%Y-%m-%d') AS Tanggal,
                    m.mst_gdg_kode AS Gudang, g.gdg_nama AS GudangNama,
                    m.mst_noreferensi AS Referensi,
                    m.mst_brg_kode AS Kode,
                    IFNULL(m.mst_stok_in, 0) AS QtyIn,
                    IFNULL(m.mst_stok_out, 0) AS QtyOut,
                    IFNULL(m.mst_panjang, 0) AS Panjang,
                    ROUND(IFNULL(m.mst_stok_in, 0) * IFNULL(m.mst_panjang, 0), 3) AS MasukM,
                    ROUND(IFNULL(m.mst_stok_out, 0) * IFNULL(m.mst_panjang, 0), 3) AS KeluarM,
                    m.mst_spk_nomor AS Spk
             FROM tmasterstok_mmt m
             LEFT JOIN tgudang g ON g.gdg_kode = m.mst_gdg_kode
             WHERE TRIM(m.mst_barcode) = TRIM(?)
             ORDER BY m.mst_tanggal, m.id`,
            [bc]
        );

        // Resolusi dokumen mutasi untuk narasi asal → tujuan.
        const mutRefs = [...new Set(
            moves.map((m) => m.Referensi).filter((r) => r && String(r).startsWith('MMT.MUT'))
        )];
        const mutMap = {};
        if (mutRefs.length) {
            const [docs] = await pool.query(
                `SELECT mut_nomor, DATE_FORMAT(mut_tanggal, '%Y-%m-%d') AS Tanggal,
                        mut_gdg_asal, mut_gdg_tujuan, mut_keterangan
                 FROM tmutasi_hdr_mmt WHERE mut_nomor IN (?)`,
                [mutRefs]
            );
            for (const d of docs) mutMap[d.mut_nomor] = d;
        }
        const refJenis = (r) => {
            if (!r) return '-';
            if (String(r).startsWith('MMT.MUT')) return 'Mutasi Gudang';
            if (String(r).startsWith('REF-')) return 'Saldo Awal / Penerimaan';
            return 'Lainnya';
        };

        let jalan = 0;
        const saldoGudang = {};
        const timeline = moves.map((m) => {
            jalan = Number((jalan + Number(m.MasukM) - Number(m.KeluarM)).toFixed(3));
            const g = m.Gudang || '-';
            saldoGudang[g] = Number(
                ((saldoGudang[g] || 0) + Number(m.MasukM) - Number(m.KeluarM)).toFixed(3)
            );
            const doc = mutMap[m.Referensi];
            const keterangan = doc
                ? `${doc.mut_gdg_asal || ''} → ${doc.mut_gdg_tujuan || ''}${doc.mut_keterangan ? ` (${doc.mut_keterangan})` : ''}`
                : (m.Spk ? `SPK ${m.Spk}` : '');
            return { ...m, RefJenis: refJenis(m.Referensi), Keterangan: keterangan, SaldoM: jalan };
        });

        // Pemakaian di LHK (informatif — tak menggerakkan saldo kartu).
        const [proofUse] = await pool.query(
            `SELECT h.lpr_nomor AS Lhk, 'PROOF' AS Jenis,
                    DATE_FORMAT(h.lpr_tanggal, '%Y-%m-%d') AS Tanggal,
                    d.lprd_spk_nomor AS Spk, d.lprd_j_meter AS Jumlah
             FROM tlhk_proofmmt_dtl d
             INNER JOIN tlhk_proofmmt_hdr h ON h.lpr_nomor = d.lprd_lpr_nomor
             WHERE TRIM(REPLACE(d.lprd_barcode, CHAR(9), '')) = TRIM(?)`,
            [bc]
        );
        const [cetakUse] = await pool.query(
            `SELECT h.lnomor AS Lhk, 'CETAK' AS Jenis,
                    DATE_FORMAT(h.ltanggal, '%Y-%m-%d') AS Tanggal,
                    d.ld_spk_nomor AS Spk, d.ld_total_metercetak AS Jumlah
             FROM tlhk_mesin_dtl d
             INNER JOIN tlhk_mesin_hdr h ON h.lnomor = d.ld_lnomor
             WHERE TRIM(d.ld_barcode) = TRIM(?)`,
            [bc]
        );

        return {
            info,
            moves: timeline,
            saldoPerGudang: Object.entries(saldoGudang).map(([gudang, saldo]) => ({ Gudang: gudang, SaldoM: saldo })),
            saldoTotalM: jalan,
            lhkUsage: [...proofUse, ...cetakUse],
        };
    } catch (error) {
        throwDbError('Gagal memuat riwayat barcode', error);
    }
};
/**
 * SERVICE: Search Multiple Barcodes
 * Opsional: Jika ingin melakukan pencarian banyak barcode sekaligus (bulk search)
 */
exports.findMultipleBarcodes = async (barcodes) => {
    if (!Array.isArray(barcodes) || barcodes.length === 0) return [];
    
    try {
        const sql = `
            SELECT 
                m.mst_barcode AS Barcode,
                TRIM(b.brg_nama) AS Nama_Bahan,
                ROUND(SUM(m.mst_stok_in * m.mst_panjang) - SUM(m.mst_stok_out * m.mst_panjang), 3) AS Stok_Sistem
            FROM tmasterstok_mmt m
            LEFT JOIN tbarang_mmt b ON m.mst_brg_kode = b.brg_kode
            WHERE m.mst_barcode IN (?)
            GROUP BY m.mst_barcode, b.brg_nama
            HAVING Stok_Sistem > 0;
        `;

        const [results] = await pool.query(sql, [barcodes]);
        return results;
    } catch (error) {
        throwDbError('Gagal melakukan pencarian massal barcode', error);
    }
};

// backend/src/services/searchBarcode.service.js

exports.getAllInventory = async (filters = {}) => {
    try {
        let queryParams = [];
        let conditions = [];

        // 1. Siapkan Filter berdasarkan input
        // Filter Stok harus > 0 (Selalu ada)
        conditions.push("Stok_Sistem > 0");

        // Filter Kode Barang
        if (filters.brg_kode) {
            conditions.push("Kode = ?");
            queryParams.push(filters.brg_kode);
        }

        // Filter Gudang (WH-16 / GPM)
        if (filters.gdg_kode) {
            conditions.push("Gudang = ?");
            queryParams.push(filters.gdg_kode);
        }

        // Gabungkan semua kondisi dengan AND
        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

        const sql = `
            SELECT * FROM (
                SELECT 
                    m.mst_barcode AS Barcode,
                    m.mst_brg_kode AS Kode,
                    TRIM(b.brg_nama) AS Nama_Bahan,
                    m.mst_gdg_kode AS Gudang,
                    ROUND(
                        SUM(m.mst_stok_in * m.mst_panjang) - 
                        SUM(m.mst_stok_out * m.mst_panjang), 3
                    ) AS Stok_Sistem
                FROM tmasterstok_mmt m
                LEFT JOIN tbarang_mmt b ON m.mst_brg_kode = b.brg_kode
                GROUP BY 
                    m.mst_barcode, 
                    m.mst_brg_kode, 
                    b.brg_nama, 
                    m.mst_gdg_kode
            ) AS subquery
            ${whereClause}
            ORDER BY Nama_Bahan ASC, Barcode ASC;
        `;

        const [results] = await pool.query(sql, queryParams);
        return results;

    } catch (error) {
        // Log error untuk mempermudah debugging backend
        console.error("Database Error:", error.message);
        throw new Error('Gagal mengambil katalog stok: ' + error.message);
    }
};