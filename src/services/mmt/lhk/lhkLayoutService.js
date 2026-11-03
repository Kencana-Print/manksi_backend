const pool = require("../../../config/database");
const { format } = require('date-fns');

// Helper penyeragaman format error database
const throwDbError = (message, error) => { 
    throw new Error(message + ': ' + error.message); 
};

/**
 * 1. Tarik Data Utama untuk Load All LHK Layout Desain
 * Disesuaikan agar membaca data historis dari tlhk_layout jika sudah pernah disimpan
 */
exports.getFullLhkLayout = async (nomorSpk) => {
    try {
        let headerQuery = '';
        
        // Deteksi tipe nomor dokumen (Memo SPK menggunakan prefix 'MAP')
        if (nomorSpk.startsWith('MAP')) {
            headerQuery = `
                SELECT 
                    s.mspk_nomor AS spk,
                    s.mspk_tanggal AS tgl,
                    s.mspk_dateline AS dateline,
                    s.mspk_nama AS nama,
                    s.mspk_finishing AS finishing,
                    'N' AS bordir,
                    '-' AS map,
                    s.mspk_panjang AS panjang,
                    s.mspk_lebar AS lebar,
                    s.mspk_cab AS cab,
                    h.ld_tanggal
                FROM tmemospk s
                LEFT JOIN tlhk_layout h ON h.ld_spk = s.mspk_nomor
                WHERE s.mspk_cmo <> '' AND s.mspk_nomor = ?;
            `;
        } else {
            headerQuery = `
                SELECT 
                    s.spk_nomor AS spk,
                    s.spk_tanggal AS tgl,
                    s.spk_dateline AS dateline,
                    s.spk_nama AS nama,
                    s.spk_finishing AS finishing,
                    s.spk_bordir AS bordir,
                    s.spk_memo AS map,
                    s.spk_panjang AS panjang,
                    s.spk_lebar AS lebar,
                    s.spk_cab AS cab,
                    h.ld_tanggal
                FROM tspk s
                LEFT JOIN tlhk_layout h ON h.ld_spk = s.spk_nomor
                WHERE s.spk_aktif = 'Y' AND s.spk_cmo <> '' AND s.spk_nomor = ?;
            `;
        }

        const [headerResults] = await pool.query(headerQuery, [nomorSpk]);
        if (headerResults.length === 0) return null;

        const header = headerResults[0];

        // --- GRID DETAIL: Rincian Output Layout (`tlhk_layout_detail`) ---
        const komponenQuery = `
            SELECT 
                kd.ldk_output,
                kd.ldk_kode,
                COALESCE(b.bhn_name, kd.brg_nama) AS brg_nama,
                kd.ldk_finishing,
                kd.ldk_panjang,
                kd.ldk_lebar,
                kd.ldk_jumlah,
                kd.lokasi_file,
                kd.path_gambar_url
            FROM tlhk_layout_detail kd
            LEFT JOIN tbahan b ON b.bhn_kode = kd.ldk_kode
            WHERE kd.ld_spk = ?;
        `;
        const [komponenResults] = await pool.query(komponenQuery, [nomorSpk]);

        // Return data gabungan ter-format untuk dikonsumsi Vue 3 Frontend
        return {
            header: {
                spk: header.spk,
                nama: header.nama,
                tgl: header.tgl ? format(new Date(header.tgl), 'yyyy-MM-dd') : '',
                dateline: header.dateline ? format(new Date(header.dateline), 'yyyy-MM-dd') : '',
                finishing: header.finishing,
                bordir: header.bordir === 'Y' ? 'Y' : 'N',
                map: header.map,
                panjang: parseFloat(header.panjang) || 0,
                lebar: parseFloat(header.lebar) || 0,
                cab: header.cab || '',
                ld_tanggal: header.ld_tanggal ? format(new Date(header.ld_tanggal), 'yyyy-MM-dd') : format(new Date(), 'yyyy-MM-dd')
            },
            komponen: komponenResults // Menyuplai data tabel kanan formData.details
        };
    } catch (error) {
        throwDbError('Gagal memuat seluruh rincian data LHK Desain Layout', error);
    }
};

/**
 * 2. Simpan Data LHK Layout Desain (Header & Detail `tlhk_layout`) dengan DB Transaction
 * Mengakomodasi kiriman payload berupa multipart/form-data (JSON String + File upload)
 */
exports.saveLhkLayout = async (req, userLogin) => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        // Mengurai data dari Form-Data karena frontend mengirim menggunakan FormData()
        const flagEdit = req.body.flagEdit === 'true';
        const header = JSON.parse(req.body.header || '{}');
        const komponen = JSON.parse(req.body.komponen || '[]');
        
        const serverTime = new Date();
        const activeUser = userLogin || 'SYSTEM';

        // Validasi data input utama
        if (!header.ld_spk) {
            throw new Error('Nomor SPK/MAP Utama tidak boleh kosong.');
        }

        // A. INPUT / UPDATE HEADER (Tabel Baru: tlhk_layout)
        if (flagEdit) {
            await connection.query(
                `UPDATE tlhk_layout SET 
                    ld_tanggal = ?, 
                    spk_nama = ?,
                    spk_tanggal = ?,
                    spk_dateline = ?,
                    spk_finishing = ?,
                    spk_panjang = ?,
                    spk_lebar = ?,
                    spk_bordir = ?
                 WHERE ld_spk = ?`,
                [
                    header.ld_tanggal, 
                    header.spk_nama,
                    header.spk_tanggal || null,
                    header.spk_dateline || null,
                    header.spk_finishing,
                    Number(header.spk_panjang) || 0,
                    Number(header.spk_lebar) || 0,
                    header.spk_bordir || 'N',
                    header.ld_spk
                ]
            );
        } else {
            await connection.query(
                `INSERT INTO tlhk_layout 
                    (ld_spk, ld_tanggal, spk_nama, spk_tanggal, spk_dateline, spk_finishing, spk_panjang, spk_lebar, spk_bordir) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE 
                    ld_tanggal = VALUES(ld_tanggal),
                    spk_nama = VALUES(spk_nama),
                    spk_finishing = VALUES(spk_finishing)`,
                [
                    header.ld_spk, 
                    header.ld_tanggal, 
                    header.spk_nama,
                    header.spk_tanggal || null,
                    header.spk_dateline || null,
                    header.spk_finishing,
                    Number(header.spk_panjang) || 0,
                    Number(header.spk_lebar) || 0,
                    header.spk_bordir || 'N'
                ]
            );
        }

        // B. QUERY PRE-EXISTING IMAGES (Untuk mempertahankan URL gambar lama jika baris tidak ganti file)
        const [oldDetails] = await connection.query(
            'SELECT ldk_output, lokasi_file, path_gambar_url FROM tlhk_layout_detail WHERE ld_spk = ?', 
            [header.ld_spk]
        );

        // C. RE-INIT DATA DETAIL LAYOUT (Delete lama untuk overwrite aman)
        await connection.query('DELETE FROM tlhk_layout_detail WHERE ld_spk = ?', [header.ld_spk]);

        // D. INSERT BARIS BARU KE DETAIL (`tlhk_layout_detail`)
        if (komponen && komponen.length > 0) {
            const komponenValues = komponen.map((k, idx) => {
                let finalImageUrl = k.preview_url || '';

                // Cek jika ada file gambar baru diupload dari request multer (image_row_X)
                if (req.files && req.files[`image_row_${idx}`]) {
                    // Contoh path: '/uploads/layouts/filename.jpg' (sesuaikan konfigurasi storage multer Anda)
                    finalImageUrl = `/uploads/layouts/${req.files[`image_row_${idx}`][0].filename}`;
                } else if (!finalImageUrl && oldDetails[idx]) {
                    // Fallback ke url gambar lama jika tidak diubah oleh user
                    finalImageUrl = oldDetails[idx].path_gambar_url;
                }

                return [
                    header.ld_spk,
                    k.ldk_output || 'SUBLIM',
                    k.ldk_kode || 'SETTING',
                    k.brg_nama || 'JASA SETTING DESAIN',
                    k.lokasi_file || '',
                    finalImageUrl,
                    Number(k.ldk_jumlah) || 0,
                    k.ldk_finishing || '',
                    Number(k.ldk_panjang) || 0,
                    Number(k.ldk_lebar) || 0
                ];
            });

            await connection.query(
                `INSERT INTO tlhk_layout_detail 
                    (ld_spk, ldk_output, ldk_kode, brg_nama, lokasi_file, path_gambar_url, ldk_jumlah, ldk_finishing, ldk_panjang, ldk_lebar) 
                 VALUES ?`,
                [komponenValues]
            );
        }

        await connection.commit();
        return { success: true, nomorSpk: header.ld_spk };

    } catch (error) {
        await connection.rollback();
        throwDbError('Gagal memproses simpan transaksi LHK Layout Desain', error);
    } finally {
        connection.release();
    }
};

/**
 * 3. Validasi & Load Komponen Bahan Secara Instan
 */
exports.validateBahanLhk = async (kode) => {
    try {
        const searchPattern = `%${kode}%`;
        const sql = `
            SELECT bhn_kode AS Kode, bhn_name AS Nama, bhn_satuan AS Satuan
            FROM tbahan 
            WHERE bhn_aktif = 0 AND bhn_kode LIKE ? 
            LIMIT 1;
        `;

        const [results] = await pool.query(sql, [searchPattern]);
        
        if (results.length === 0) {
            return { eof: true, brg_nama: '' };
        }
        
        return { eof: false, kode: results[0].Kode, brg_nama: results[0].Nama };
    } catch (error) {
        throwDbError('Gagal melakukan validasi komponen bahan', error);
    }
};

exports.getLhkLayoutList = async (filters) => {
    try {
        const { startDate, endDate, search } = filters;
        // Guard: tanggal kosong/invalid TIDAK boleh jadi klausa zero-date —
        // filter tanggal di-skip (tanpa filter) bila tidak valid.
        const isDateStr = (v) =>
            typeof v === "string" &&
            /^\d{4}-\d{2}-\d{2}$/.test(v) &&
            !Number.isNaN(Date.parse(v));
        let sql = `
            SELECT 
                l.ld_spk AS Nomor, 
                l.ld_tanggal AS Tanggal,
                '1' AS Shift, 
                'OPERATOR' AS Operator, 
                l.ld_spk AS NomorSPK,
                l.spk_nama AS NamaOrder,
                SUM(COALESCE(d.ldk_jumlah, 0)) AS TotalPola,
                l.spk_finishing AS Keterangan
            FROM tlhk_layout l
            LEFT JOIN tlhk_layout_detail d ON l.ld_spk = d.ld_spk
            WHERE 1=1
        `;
        
        const params = [];
        if (isDateStr(startDate)) {
            sql += ` AND l.ld_tanggal >= ?`;
            params.push(startDate);
        }
        if (isDateStr(endDate)) {
            sql += ` AND l.ld_tanggal <= ?`;
            params.push(endDate);
        }
        
        if (search && search.trim() !== "") {
            sql += ` AND (l.ld_spk LIKE ? OR l.spk_nama LIKE ?)`;
            params.push(`%${search}%`, `%${search}%`);
        }
        
        sql += ` GROUP BY l.ld_spk ORDER BY l.ld_tanggal DESC`;

        const [rows] = await pool.query(sql, params);
        return rows;
    } catch (error) {
        throwDbError('Gagal memuat list tabel LHK Layout', error);
    }
};

/**
 * 5. Tarik detail baris per Nomor LHK untuk sub-tabel expanded v-data-table
 */
exports.getLhkLayoutDetailsOnly = async (nomor) => {
    try {
        const sql = `
            SELECT 
                ld_spk AS nomor_spk,
                brg_nama AS nama_spk,
                ldk_output AS jenis_pola,
                ldk_panjang AS panjang,
                ldk_lebar AS lebar,
                ldk_jumlah AS jml_pola,
                ldk_finishing AS keterangan
            FROM tlhk_layout_detail
            WHERE ld_spk = ?;
        `;
        const [rows] = await pool.query(sql, [nomor]);
        return rows;
    } catch (error) {
        throwDbError('Gagal memuat detail layout', error);
    }
};