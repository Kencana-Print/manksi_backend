
const pool = require('../../../config/database');
const { format } = require('date-fns');

// Tanggal kosong/invalid => filter tanggal di-skip (tanpa klausa zero-date).
const isValidDate = (v) =>
  typeof v === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(v) &&
  !isNaN(new Date(v).getTime());

exports.getLaporanStokObat = async (startDate, endDate) => {
    try {
        const sDate = isValidDate(startDate) ? format(new Date(startDate), 'yyyy-MM-dd') : null;
        const eDate = isValidDate(endDate) ? format(new Date(endDate), 'yyyy-MM-dd') : null;

        // Tanpa tanggal mulai: tidak ada konsep stok awal (0), mutasi = seluruh periode.
        const saFilter = sDate ? "WHERE mst_tanggal < ? AND mst_aktif = 'Y'" : "WHERE mst_aktif = 'Y' AND 1=0";
        const saParams = sDate ? [sDate] : [];
        let mutFilter, mutParams;
        if (sDate && eDate) {
            mutFilter = "WHERE (mst_tanggal BETWEEN ? AND ?) AND mst_aktif = 'Y'";
            mutParams = [sDate, eDate];
        } else if (sDate) {
            mutFilter = "WHERE mst_tanggal >= ? AND mst_aktif = 'Y'";
            mutParams = [sDate];
        } else if (eDate) {
            mutFilter = "WHERE mst_tanggal <= ? AND mst_aktif = 'Y'";
            mutParams = [eDate];
        } else {
            mutFilter = "WHERE mst_aktif = 'Y'";
            mutParams = [];
        }

        const sql = `
            SELECT 
                o.o_kode AS kode,
                o.o_nama AS Nama,
                o.o_satuan AS satuan,
                'TINTA' AS jb_nama,
                
                -- 1. STOK AWAL (Semua transaksi < startDate)
                IFNULL(sa.stok_awal, 0) AS stok_awal,

                -- 2. PENERIMAAN (Penerimaan di periode berjalan)
                IFNULL(mutasi.terima, 0) AS terima,

                -- 3. PENGELUARAN (Pemakaian di periode berjalan)
                IFNULL(mutasi.keluar, 0) AS keluar,

                -- 4. STOK AKHIR (Stok Awal + Terima - Keluar)
                (IFNULL(sa.stok_awal, 0) + IFNULL(mutasi.terima, 0) - IFNULL(mutasi.keluar, 0)) AS Stok_Akhir
            
            FROM tobat o
            
            -- Subquery Saldo Awal: Menghitung saldo bersih sebelum tanggal mulai
            LEFT JOIN (
                SELECT 
                    mst_brg_kode, 
                    SUM(mst_stok_in - mst_stok_out) AS stok_awal
                FROM tmasterstok_obat
                ${saFilter}
                GROUP BY mst_brg_kode
            ) sa ON o.o_kode = sa.mst_brg_kode

            -- Subquery Mutasi: Menghitung aktivitas di dalam rentang tanggal
            LEFT JOIN (
                SELECT 
                    mst_brg_kode,
                    SUM(mst_stok_in) AS terima,
                    SUM(mst_stok_out) AS keluar
                FROM tmasterstok_obat
                ${mutFilter}
                GROUP BY mst_brg_kode
            ) mutasi ON o.o_kode = mutasi.mst_brg_kode

            WHERE o.o_aktif = 'Y'
            ORDER BY o.o_nama ASC
        `;

        // Masukkan parameter sesuai filter yang aktif (kosong => tanpa filter tanggal).
        const [rows] = await pool.query(sql, [...saParams, ...mutParams]);
        return rows;

    } catch (error) {
        console.error("Database Error:", error.message);
        throw error;
    }
};