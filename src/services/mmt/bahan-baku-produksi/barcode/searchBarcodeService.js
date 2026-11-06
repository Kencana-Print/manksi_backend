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
        const bc = String(barcode || "").trim().replace(/\t/g, '');
        if (!bc) throw new Error("Barcode wajib diisi.");

        const cleanSql = (col) => `TRIM(REPLACE(REPLACE(${col}, CHAR(9), ''), ' ', ''))`;

        const [infoRows] = await pool.query(
            `SELECT m.mst_barcode AS Barcode, m.mst_brg_kode AS Kode,
                    TRIM(b.brg_nama) AS Nama_Bahan, b.brg_satuan AS Satuan,
                    COALESCE(NULLIF(m.mst_panjang, 0), b.brg_panjang, 0) AS Panjang,
                    COALESCE(NULLIF(m.mst_lebar, 0), b.brg_lebar, 0) AS Lebar
             FROM tmasterstok_mmt m
             LEFT JOIN tbarang_mmt b ON m.mst_brg_kode = b.brg_kode
             WHERE ${cleanSql('m.mst_barcode')} = ?
             ORDER BY m.mst_tanggal DESC, m.id DESC
             LIMIT 1`,
            [bc]
        );
        if (!infoRows.length) return null;
        const info = infoRows[0];
        const defaultPanjang = Number(info.Panjang) || 1;

        const [moves] = await pool.query(
            `SELECT DATE_FORMAT(m.mst_tanggal, '%Y-%m-%d') AS Tanggal,
                    m.mst_gdg_kode AS Gudang, g.gdg_nama AS GudangNama,
                    m.mst_noreferensi AS Referensi,
                    m.mst_brg_kode AS Kode,
                    IFNULL(m.mst_stok_in, 0) AS QtyIn,
                    IFNULL(m.mst_stok_out, 0) AS QtyOut,
                    COALESCE(NULLIF(m.mst_panjang, 0), b.brg_panjang, ?) AS Panjang,
                    m.mst_spk_nomor AS Spk
             FROM tmasterstok_mmt m
             LEFT JOIN tgudang g ON g.gdg_kode = m.mst_gdg_kode
             LEFT JOIN tbarang_mmt b ON m.mst_brg_kode = b.brg_kode
             WHERE ${cleanSql('m.mst_barcode')} = ?
             ORDER BY m.mst_tanggal, m.id`,
            [defaultPanjang, bc]
        );

        // Kumpulkan referensi untuk resolusi dokumen dan keterangan
        const refList = [...new Set(moves.map((m) => m.Referensi).filter(Boolean))];
        const mutMap = {};
        const recMap = {};
        const mintaMap = {};
        const returMap = {};

        const mutRefs = refList.filter((r) => r.startsWith('MMT.MUT'));
        if (mutRefs.length) {
            const [docs] = await pool.query(
                `SELECT mut_nomor, mut_gdg_asal, mut_gdg_tujuan, mut_keterangan
                 FROM tmutasi_hdr_mmt WHERE mut_nomor IN (?)`,
                [mutRefs]
            );
            for (const d of docs) mutMap[d.mut_nomor] = d;
        }

        const recRefs = refList.filter((r) => r.startsWith('MMT.REC'));
        if (recRefs.length) {
            const [docs] = await pool.query(
                `SELECT rec_nomor, rec_sup_kode, rec_keterangan, rec_memo
                 FROM trec_mmt_hdr WHERE rec_nomor IN (?)`,
                [recRefs]
            );
            for (const d of docs) recMap[d.rec_nomor] = d;
        }

        const mpRefs = refList.filter((r) => r.startsWith('MMT.MP'));
        if (mpRefs.length) {
            const [docs] = await pool.query(
                `SELECT mnt_nomor, mnt_gdg_kode, mnt_keterangan, mnt_permintaan
                 FROM tminta_mmt_hdr WHERE mnt_nomor IN (?)`,
                [mpRefs]
            );
            for (const d of docs) mintaMap[d.mnt_nomor] = d;
        }

        const rmpRefs = refList.filter((r) => r.startsWith('MMT.RMP') || r.startsWith('RETP'));
        if (rmpRefs.length) {
            const [docs] = await pool.query(
                `SELECT rmnt_nomor, rmnt_gdg_kode, rmnt_gdg_asal, rmnt_keterangan
                 FROM treturminta_mmt_hdr WHERE rmnt_nomor IN (?)`,
                [rmpRefs]
            );
            for (const d of docs) returMap[d.rmnt_nomor] = d;
        }

        const getRefJenis = (r) => {
            if (!r) return '-';
            const s = String(r).toUpperCase();
            if (s.startsWith('MMT.MUT')) return 'Mutasi Antar Gudang';
            if (s.startsWith('MMT.MP')) return 'Penyerahan Produksi';
            if (s.startsWith('MMT.REC')) return 'Penerimaan Bahan';
            if (s.startsWith('MMT.RMP') || s.startsWith('RETP')) return 'Retur Produksi';
            if (s.startsWith('KOR')) return 'Koreksi Stok';
            if (s.startsWith('REF-')) return 'Registrasi Barcode Baru';
            if (s.startsWith('MMT-LHK-M')) return 'LHK Mesin Cetak';
            if (s.startsWith('MMT-LHK-F')) return 'LHK Finishing';
            if (s.startsWith('MMT-LHK-T')) return 'LHK Mesin Tekstil';
            if (s.startsWith('MMT-LHK-S')) return 'LHK Sublim';
            if (s.startsWith('MMT-LHK-P')) return 'LHK Proof MMT';
            if (s.startsWith('MMT-LHK')) return 'Pemakaian LHK';
            return 'Mutasi Stok';
        };

        const getKeterangan = (m) => {
            const ref = m.Referensi || '';
            if (ref.startsWith('MMT.MUT') && mutMap[ref]) {
                const doc = mutMap[ref];
                return `${doc.mut_gdg_asal || ''} → ${doc.mut_gdg_tujuan || ''}${doc.mut_keterangan ? ' (' + doc.mut_keterangan + ')' : ''}`;
            }
            if (ref.startsWith('MMT.REC') && recMap[ref]) {
                const doc = recMap[ref];
                return `Penerimaan Supplier ${doc.rec_sup_kode || ''}${doc.rec_keterangan ? ' - ' + doc.rec_keterangan : (doc.rec_memo ? ' - ' + doc.rec_memo : '')}`;
            }
            if (ref.startsWith('MMT.MP') && mintaMap[ref]) {
                const doc = mintaMap[ref];
                return `Penyerahan ke Produksi ${doc.mnt_keterangan ? '(' + doc.mnt_keterangan + ')' : ''}${doc.mnt_permintaan ? ' [Ref: ' + doc.mnt_permintaan + ']' : ''}`;
            }
            if ((ref.startsWith('MMT.RMP') || ref.startsWith('RETP')) && returMap[ref]) {
                const doc = returMap[ref];
                return `Retur dari ${doc.rmnt_gdg_asal || 'Produksi'} → ${doc.rmnt_gdg_kode || 'Gudang'}${doc.rmnt_keterangan ? ' (' + doc.rmnt_keterangan + ')' : ''}`;
            }
            if (ref.startsWith('KOR')) {
                return 'Koreksi Stok Fisik Gudang';
            }
            if (ref.startsWith('REF-')) {
                return 'Pendaftaran & Cetak Barcode Rol';
            }
            if (m.Spk && m.Spk !== '0') {
                return `Pemakaian SPK: ${m.Spk}`;
            }
            return '-';
        };

        let jalan = 0;
        const saldoGudang = {};
        const timeline = moves.map((m) => {
            const pjg = Number(m.Panjang) || defaultPanjang || 1;
            const masukM = Number((Number(m.QtyIn || 0) * pjg).toFixed(3));
            const keluarM = Number((Number(m.QtyOut || 0) * pjg).toFixed(3));
            jalan = Number((jalan + masukM - keluarM).toFixed(3));

            const g = m.Gudang || '-';
            saldoGudang[g] = Number(((saldoGudang[g] || 0) + masukM - keluarM).toFixed(3));

            return {
                ...m,
                MasukM: masukM,
                KeluarM: keluarM,
                RefJenis: getRefJenis(m.Referensi),
                Keterangan: getKeterangan(m),
                SaldoM: jalan,
            };
        });

        // Pemakaian di LHK (Semua 4 Modul LHK MMT)
        // 1. Proof MMT
        const [proofUse] = await pool.query(
            `SELECT h.lpr_nomor AS Lhk, 'PROOF' AS Jenis,
                    DATE_FORMAT(h.lpr_tanggal, '%Y-%m-%d') AS Tanggal,
                    d.lprd_spk_nomor AS Spk,
                    COALESCE(NULLIF(d.lprd_j_meter, 0), 0) AS Jumlah
             FROM tlhk_proofmmt_dtl d
             INNER JOIN tlhk_proofmmt_hdr h ON h.lpr_nomor = d.lprd_lpr_nomor
             WHERE ${cleanSql('d.lprd_barcode')} = ?`,
            [bc]
        );

        // 2. Mesin Cetak MMT (cek baik dtl ld_barcode maupun hdr lbarcode_roll)
        const [cetakUse] = await pool.query(
            `SELECT h.lnomor AS Lhk, 'CETAK' AS Jenis,
                    DATE_FORMAT(h.ltanggal, '%Y-%m-%d') AS Tanggal,
                    COALESCE(NULLIF(d.ld_spk_nomor, ''), h.lspk_nomor, '-') AS Spk,
                    COALESCE(NULLIF(d.ld_total_metercetak, 0), h.lpanjang_terpakai, 0) AS Jumlah
             FROM tlhk_mesin_dtl d
             INNER JOIN tlhk_mesin_hdr h ON h.lnomor = d.ld_lnomor
             WHERE ${cleanSql('d.ld_barcode')} = ? OR ${cleanSql('h.lbarcode_roll')} = ?`,
            [bc, bc]
        );

        // 3. Sublim
        const [sublimUse] = await pool.query(
            `SELECT h.lsb_nomor AS Lhk, 'SUBLIM' AS Jenis,
                    DATE_FORMAT(h.lsb_tanggal, '%Y-%m-%d') AS Tanggal,
                    d.lsbd_spk_nomor AS Spk,
                    COALESCE(NULLIF(d.lsbd_panjang_pakai, 0), d.lsbd_j_meter, 0) AS Jumlah
             FROM tlhk_sublim_dtl d
             INNER JOIN tlhk_sublim_hdr h ON h.lsb_nomor = d.lsbd_lsb_nomor
             WHERE ${cleanSql('h.lsb_barcode')} = ?`,
            [bc]
        );

        // 4. Mesin Tekstil
        const [tekstilUse] = await pool.query(
            `SELECT h.lth_nomor AS Lhk, 'TEKSTIL' AS Jenis,
                    DATE_FORMAT(h.lth_tanggal, '%Y-%m-%d') AS Tanggal,
                    d.ltd_spk_nomor AS Spk,
                    COALESCE(NULLIF(d.ltd_panjang_pakai, 0), d.ltd_ambil_bahan, 0) AS Jumlah
             FROM tlhk_mesintekstil_dtl d
             INNER JOIN tlhk_mesintekstil_hdr h ON h.lth_nomor = d.ltd_lth_nomor
             WHERE ${cleanSql('h.lth_barcode')} = ?`,
            [bc]
        );

        const allLhk = [...proofUse, ...cetakUse, ...sublimUse, ...tekstilUse];
        allLhk.sort((a, b) => (b.Tanggal || '').localeCompare(a.Tanggal || ''));

        return {
            info,
            moves: timeline,
            saldoPerGudang: Object.entries(saldoGudang).map(([gudang, saldo]) => ({ Gudang: gudang, SaldoM: saldo })),
            saldoTotalM: jalan,
            lhkUsage: allLhk,
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