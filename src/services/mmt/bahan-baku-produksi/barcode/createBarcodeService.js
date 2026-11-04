const pool = require("../../../../config/database");
const { format } = require('date-fns');

exports.createManualBarcode = async (data, user) => {
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        
        // Pastikan tanggal mengikuti input dari user
        const tglInput = new Date(data.tanggal);
        const formattedDate = format(tglInput, 'yyyy-MM-dd');
        const ym = format(tglInput, 'yyMM');

        // 1. Ambil Nomor Referensi Terakhir (MMT.GEN.2405.0001)
        // Menggunakan SUBSTRING_INDEX agar fleksibel jika digit bertambah
        const [maxRef] = await conn.query(
            `SELECT MAX(CAST(SUBSTRING_INDEX(mst_noreferensi, '.', -1) AS UNSIGNED)) as max_num 
             FROM tmasterstok_mmt 
             WHERE mst_noreferensi LIKE ?`,
            [`MMT.GEN.${ym}.%`]
        );
        
        const nextRefNum = (maxRef[0].max_num || 0) + 1;
        const noRef = `MMT.GEN.${ym}.${String(nextRefNum).padStart(4, '0')}`;

        // 2. Ambil Nomor Urut Barcode Terakhir (KODE-YYMM-001)
        const [maxBarcode] = await conn.query(
            `SELECT MAX(CAST(SUBSTRING_INDEX(mst_barcode, '-', -1) AS UNSIGNED)) as max_seq 
             FROM tmasterstok_mmt 
             WHERE mst_barcode LIKE ?`,
            [`${data.kodeBahan}-${ym}-%`]
        );
        
        let currentSeq = (maxBarcode[0].max_seq || 0);

        const results = [];
        const qty = parseInt(data.qty);

        // 3. Loop Insert data ke tmasterstok_mmt
        for (let i = 1; i <= qty; i++) {
            currentSeq++;
            const barcode = `${data.kodeBahan}-${ym}-${String(currentSeq).padStart(3, '0')}`;
            
            // Query INSERT disesuaikan dengan struktur kolom Anda
            const sqlStok = `
                INSERT INTO tmasterstok_mmt (
                    mst_brg_kode, 
                    mst_barcode, 
                    mst_gdg_kode, 
                    mst_stok_in, 
                    mst_stok_out,
                    mst_panjang, 
                    mst_lebar, 
                    mst_noreferensi, 
                    mst_tanggal, 
                    mst_hargabeli
                ) VALUES (?, ?, ?, 1, 0, ?, ?, ?, ?, 0)
            `;
            
            await conn.query(sqlStok, [
                data.kodeBahan, 
                barcode, 
                data.gudangKode, 
                data.panjang, 
                data.lebar, 
                noRef, 
                formattedDate
            ]);

            results.push({ 
                barcode, 
                namaBahan: data.namaBahan,
                noRef: noRef 
            });
        }

        await conn.commit();
        return { nomor: noRef, barcodes: results };
    } catch (error) {
        await conn.rollback();
        console.error("Error pada createManualBarcode:", error);
        throw error;
    } finally {
        conn.release();
    }
};


exports.getNextNumber = async (req, res) => {
    const { kodeBahan, tanggal } = req.query;
    const ym = format(new Date(tanggal), 'yyMM');
    const [maxBarcode] = await pool.query(
        "SELECT MAX(CAST(SUBSTRING_INDEX(mst_barcode, '-', -1) AS UNSIGNED)) as max_seq FROM tmasterstok_mmt WHERE mst_barcode LIKE ?",
        [`${kodeBahan}-${ym}-%`]
    );
    res.json({ nextSeq: (maxBarcode[0].max_seq || 0) + 1 });
};

exports.getLastSequence = async (kodeBahan, tanggal) => {
    const ym = format(new Date(tanggal), 'yyMM');
    const [maxBarcode] = await pool.query(
        `SELECT MAX(CAST(SUBSTRING_INDEX(mst_barcode, '-', -1) AS UNSIGNED)) as max_seq 
         FROM tmasterstok_mmt 
         WHERE mst_barcode LIKE ?`,
        [`${kodeBahan}-${ym}-%`]
    );
    return {
        nextSeq: (maxBarcode[0].max_seq || 0) + 1,
        ym: ym
    };
};

// Fungsi untuk simpan massal (Batch)
exports.saveBatchBarcode = async (items, user) => {
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        const results = [];

        for (const item of items) {
            const sqlStok = `
                INSERT INTO tmasterstok_mmt (
                    mst_brg_kode, mst_barcode, mst_gdg_kode, mst_stok_in, mst_stok_out,
                    mst_panjang, mst_lebar, mst_noreferensi, mst_tanggal, mst_hargabeli
                ) VALUES (?, ?, 'WH-16', 1, 0, ?, ?, ?, ?, 0)
            `;
            
            // Generate No Referensi unik per batch atau gunakan dari frontend
            const noRef = item.noRef || `REF-${format(new Date(), 'yyyyMMddHHmmss')}`;

            await conn.query(sqlStok, [
                item.kodeBahan, item.barcode, item.panjang, 
                item.lebar, noRef, item.tanggal
            ]);
            results.push(item.barcode);
        }

        await conn.commit();
        return { total: items.length, barcodes: results };
    } catch (error) {
        await conn.rollback();
        throw error;
    } finally {
        conn.release();
    }
};

// services/recreateBarcode.service.js

exports.getHistory = async () => {
    // Ambil Header (Dikelompokkan per No Referensi)
   const [headers] = await pool.query(
        `SELECT 
            a.mst_noreferensi, 
            a.mst_tanggal, 
            COUNT(a.mst_barcode) as total_qty,
            a.mst_gdg_kode
         FROM tmasterstok_mmt a
         WHERE a.mst_gdg_kode = 'WH-16'
         GROUP BY a.mst_noreferensi, a.mst_tanggal, a.mst_gdg_kode
         ORDER BY a.mst_tanggal DESC LIMIT 50`
    );

    const [details] = await pool.query(
        `SELECT 
            a.mst_noreferensi, 
            a.mst_barcode, 
            a.mst_brg_kode, 
            b.brg_nama as nama_asli, -- Mengambil nama asli dari tabel barang
            a.mst_panjang, 
            a.mst_lebar 
         FROM tmasterstok_mmt a
         LEFT JOIN tbarang_mmt b ON a.mst_brg_kode = b.brg_kode
         WHERE a.mst_gdg_kode = 'WH-16'`
    );

    return headers.map(h => ({
        ...h,
        details: details.filter(d => d.mst_noreferensi === h.mst_noreferensi)
    }));
};