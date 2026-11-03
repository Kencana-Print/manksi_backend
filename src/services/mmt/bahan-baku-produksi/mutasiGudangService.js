const pool = require("../../../config/database");
const { format } = require('date-fns');


const throwDbError = (message, error) => { throw new Error(message + ': ' + error.message); };

exports.getNewNomorMutasi = async () => {
    const PREFIX = 'MMT.MUT';
    try {
        const currentYYMM = format(new Date(), 'yyMM');
        const searchPattern = `${PREFIX}.${currentYYMM}.%`;

        const sql = `
            SELECT MAX(mut_nomor) AS MaxNomor 
            FROM tmutasi_hdr_mmt 
            WHERE mut_nomor LIKE ?;
        `;

        const [results] = await pool.query(sql, [searchPattern]);
        const maxNomor = results[0].MaxNomor;

        let newNumber = '0001';
        if (maxNomor) {
            const lastNumberString = maxNomor.substring(maxNomor.lastIndexOf('.') + 1);
            newNumber = (parseInt(lastNumberString, 10) + 1).toString().padStart(4, '0');
        }
        return `${PREFIX}.${currentYYMM}.${newNumber}`;
    } catch (error) {
        throw new Error('Gagal generate nomor mutasi: ' + error.message);
    }
};

exports.saveMutasiGudang = async (data, isUpdate = false, userLogin) => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        let { 
            Nomor, Tanggal, GudangAsal, GudangTujuan, 
            Keterangan, Type, Details 
        } = data;

        const serverTime = new Date();
        const activeUser = userLogin || 'SYSTEM';

        // 1. Handle Nomor Dokumen
        if (!isUpdate && (!Nomor || Nomor === 'AUTO')) {
            Nomor = await exports.getNewNomorMutasi();
        }

        if (isUpdate) {
            // 2. Update Header
            await connection.query(
                `UPDATE tmutasi_hdr_mmt SET 
                    mut_tanggal=?, mut_gdg_asal=?, mut_gdg_tujuan=?, 
                    mut_keterangan=?, mut_type=?, user_modified=?, date_modified=? 
                 WHERE mut_nomor=?`,
                [Tanggal, GudangAsal, GudangTujuan, Keterangan, Type, activeUser, serverTime, Nomor]
            );

            // JIKA UPDATE: Bersihkan data lama
            await connection.query('DELETE FROM tmutasi_dtl_mmt WHERE mutd_mut_nomor = ?', [Nomor]);
            await connection.query('DELETE FROM tmasterstok_bahan WHERE mst_noreferensi = ?', [Nomor]);
            await connection.query('DELETE FROM tmasterstok_mmt WHERE mst_noreferensi = ?', [Nomor]);
        } else {
            // 2. Insert Header
            await connection.query(
                `INSERT INTO tmutasi_hdr_mmt 
                    (mut_nomor, mut_tanggal, mut_gdg_asal, mut_gdg_tujuan, mut_keterangan, mut_type, user_create, date_create) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [Nomor, Tanggal, GudangAsal, GudangTujuan, Keterangan, Type, activeUser, serverTime]
            );
        }

        // 3. Insert Details & Handle Kartu Stok (tmasterstok)
        if (Details && Details.length > 0) {
            
            // =========================================================================
            // DUA LEVEL GROUPING (aturan PK tiap tabel beda):
            // - tmutasi_dtl_mmt PK = (mutd_mut_nomor, mutd_brg_kode) → pawn
            //   satu baris per BAHAN. Dua baris bahan sama beda barcode WAJIB
            //   digabung (qty diakumulasi), kalau tidak bulk INSERT menabrak
            //   PRIMARY KEY ("Duplicate entry '<nomor>-<bahan>'").
            // - tmasterstok_mmt PK = id (bebas) → grouping per ROLL
            //   (kode + barcode + expired) dipertahankan agar jejak per-roll
            //   (panjang/lebar/spk/barcode) tidak hilang dari kartu stok.
            // =========================================================================
            const groupedByRoll = new Map();
            const groupedByBahan = new Map();

            for (const d of Details) {
                const rollKey = `${d.kode_barang}_${d.barcode || ''}_${d.expired || 'null'}`;
                if (groupedByRoll.has(rollKey)) {
                    groupedByRoll.get(rollKey).qty += Number(d.qty);
                } else {
                    // Clone agar tidak merubah data asli klien
                    groupedByRoll.set(rollKey, { ...d, qty: Number(d.qty) });
                }

                const bahanKey = `${d.kode_barang}`;
                if (groupedByBahan.has(bahanKey)) {
                    groupedByBahan.get(bahanKey).qty += Number(d.qty);
                } else {
                    groupedByBahan.set(bahanKey, { ...d, qty: Number(d.qty) });
                }
            }

            // Ubah kembali Map hasil grouping menjadi Array untuk diproses query
            const finalRolls = Array.from(groupedByRoll.values());
            const finalDetails = Array.from(groupedByBahan.values());
            // =========================================================================

            // Siapkan bulk values untuk tmutasi_dtl_mmt berdasarkan data yang sudah di-group
            const detailValues = finalDetails.map((d, index) => [
                Nomor,              // mutd_mut_nomor (PK)
                d.kode_barang,      // mutd_brg_kode (PK)
                d.qty,              // mutd_qty (Sudah terakumulasi)
                d.expired || null,  // mutd_expired (PK)
                d.keterangan || '', // mutd_keterangan
                d.nourut || (index + 1), // mutd_nourut
                GudangAsal          // mutd_gdg_kode
            ]);

            // Insert ke detail mutasi (Aman dari duplicate entry)
            await connection.query(
                `INSERT INTO tmutasi_dtl_mmt 
                    (mutd_mut_nomor, mutd_brg_kode, mutd_qty, mutd_expired, mutd_keterangan, mutd_nourut, mutd_gdg_kode) 
                 VALUES ?`, [detailValues]
            );

            // --- HARGA MENGIKUTI BARCODE SEBELUMNYA ---
            // Ambil hargabeli & satuan_harga terakhir tiap barcode dari
            // tmasterstok_mmt agar baris OUT yang baru membawa harga yang sama.
            const distinctBarcodes = [...new Set(
                finalRolls.map((d) => (d.barcode || '').trim()).filter(Boolean)
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

            // --- LOGIKA KARTU STOK OTOMATIS MENGGUNAKAN DATA PER-ROLL ---
            // (finalRolls: tiap barcode tercatat gerakannya masing-masing)
            for (const item of finalRolls) {
                
                // A. KONDISI MASUK KE TABEL BARU (tmasterstok_bahan) JIKA TUJUAN KE 'GB001'
                if (GudangTujuan === 'GB001') {
                    await connection.query(
                        `INSERT INTO tmasterstok_bahan 
                            (mst_gdg_kode, mst_noreferensi, mst_brg_kode, mst_tanggal, mst_stok_in, mst_stok_out, mst_hargabeli, date_create, mst_aktif)
                         VALUES (?, ?, ?, ?, ?, 0, 0, ?, 'Y')
                         ON DUPLICATE KEY UPDATE 
                            mst_tanggal = VALUES(mst_tanggal),
                            mst_stok_in = VALUES(mst_stok_in),
                            date_create = VALUES(date_create),
                            mst_aktif = 'Y'`,
                        ['GB001', Nomor, item.kode_barang, Tanggal, item.qty, serverTime]
                    );
                }

                // B. KONDISI POTONG STOK (OUT) DI GUDANG ASAL (tmasterstok_mmt)
                // Simpan lengkap: barcode, panjang, lebar, spk + harga barcode sebelumnya
                const hargaPrev = hargaByBarcode.get((item.barcode || '').trim()) || { hargabeli: 0, satuan_harga: '' };
                const panjangItem = Number(item.panjang) || 0;
                const lebarItem = Number(item.lebar) || 0;
                const spkItem = item.spk || '';
                await connection.query(
                    `INSERT INTO tmasterstok_mmt
                        (mst_gdg_kode, mst_noreferensi, mst_brg_kode, mst_barcode, mst_tanggal, mst_stok_in, mst_stok_out,
                         mst_panjang, mst_lebar, mst_spk_nomor, mst_hargabeli, mst_satuan_harga, date_create)
                     VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?)
                     ON DUPLICATE KEY UPDATE
                        mst_stok_out = VALUES(mst_stok_out),
                        mst_tanggal = VALUES(mst_tanggal),
                        mst_barcode = VALUES(mst_barcode),
                        mst_panjang = VALUES(mst_panjang),
                        mst_lebar = VALUES(mst_lebar),
                        mst_spk_nomor = VALUES(mst_spk_nomor),
                        mst_hargabeli = VALUES(mst_hargabeli),
                        mst_satuan_harga = VALUES(mst_satuan_harga)`,
                    [GudangAsal, Nomor, item.kode_barang, item.barcode || '', Tanggal, item.qty,
                     panjangItem, lebarItem, spkItem,
                     hargaPrev.hargabeli, hargaPrev.satuan_harga, serverTime]
                );

                // C. MASUK STOK (IN) DI GUDANG TUJUAN (tmasterstok_mmt)
                // Roll yang sama pindah gudang: barcode, panjang, lebar, spk,
                // dan harga barcode sebelumnya ikut terbawa.
                // (Kecuali tujuan GB001 yang sudah ditangani via tmasterstok_bahan)
                if (GudangTujuan && GudangTujuan !== 'GB001' && GudangTujuan !== GudangAsal) {
                    await connection.query(
                        `INSERT INTO tmasterstok_mmt
                            (mst_gdg_kode, mst_noreferensi, mst_brg_kode, mst_barcode, mst_tanggal, mst_stok_in, mst_stok_out,
                             mst_panjang, mst_lebar, mst_spk_nomor, mst_hargabeli, mst_satuan_harga, date_create)
                         VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)
                         ON DUPLICATE KEY UPDATE
                            mst_stok_in = VALUES(mst_stok_in),
                            mst_tanggal = VALUES(mst_tanggal),
                            mst_barcode = VALUES(mst_barcode),
                            mst_panjang = VALUES(mst_panjang),
                            mst_lebar = VALUES(mst_lebar),
                            mst_spk_nomor = VALUES(mst_spk_nomor),
                            mst_hargabeli = VALUES(mst_hargabeli),
                            mst_satuan_harga = VALUES(mst_satuan_harga)`,
                        [GudangTujuan, Nomor, item.kode_barang, item.barcode || '', Tanggal, item.qty,
                         panjangItem, lebarItem, spkItem,
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

// --- DETAIL SATU DOKUMEN (untuk form Ubah) ---
// Baris dikembalikan per-roll (satu baris per barcode, sesuai model input
// form) dari kartu stok OUT gudang asal. Jejak per-roll memang tersimpan di
// tmasterstok_mmt (bukan di tmutasi_dtl_mmt yang PK-nya per bahan) — jadi
// TIDAK perlu tambah kolom barcode di tabel detail (sumber ganda justru
// mengundang inkonsistensi; getMutasiData pun sudah menggabungkannya via
// GROUP_CONCAT untuk tampilan).
exports.getMutasiGudangDetail = async (nomor) => {
    const [hdr] = await pool.query(
        `SELECT mut_nomor AS Nomor, DATE_FORMAT(mut_tanggal, '%Y-%m-%d') AS Tanggal,
                mut_gdg_asal AS GudangAsal, mut_gdg_tujuan AS GudangTujuan,
                mut_keterangan AS Keterangan, mut_type AS Type
         FROM tmutasi_hdr_mmt WHERE mut_nomor = ? LIMIT 1`,
        [nomor]
    );
    if (!hdr.length) return null;
    const h = hdr[0];

    const [rolls] = await pool.query(
        `SELECT s.mst_brg_kode AS kode, s.mst_barcode AS barcode, s.mst_stok_out AS qty,
                s.mst_panjang AS panjang, s.mst_lebar AS lebar, s.mst_spk_nomor AS spk
         FROM tmasterstok_mmt s
         WHERE s.mst_noreferensi = ? AND s.mst_gdg_kode = ? AND s.mst_stok_out <> 0
         ORDER BY s.id`,
        [nomor, h.GudangAsal]
    );
    const [dtls] = await pool.query(
        `SELECT mutd_brg_kode AS kode, mutd_qty AS qty, mutd_expired AS expired,
                mutd_keterangan AS keterangan, mutd_nourut AS nourut
         FROM tmutasi_dtl_mmt WHERE mutd_mut_nomor = ? ORDER BY mutd_nourut`,
        [nomor]
    );

    const codes = [...new Set([...rolls.map((r) => r.kode), ...dtls.map((d) => d.kode)])].filter(Boolean);
    const brgMap = {};
    if (codes.length) {
        const [brows] = await pool.query(
            `SELECT brg_kode, brg_nama, brg_satuan FROM tbarang_mmt WHERE brg_kode IN (?)`,
            [codes]
        );
        for (const b of brows) brgMap[b.brg_kode] = b;
    }
    const dtlByKode = {};
    for (const d of dtls) {
        if (!dtlByKode[d.kode]) dtlByKode[d.kode] = d;
    }

    let details;
    if (rolls.length) {
        details = rolls.map((r) => {
            const d = dtlByKode[r.kode] || {};
            const b = brgMap[r.kode] || {};
            return {
                kode_barang: r.kode,
                barcode: r.barcode || '',
                qty: Number(r.qty) || 0,
                panjang: Number(r.panjang) || 0,
                lebar: Number(r.lebar) || 0,
                spk: r.spk || '',
                satuan: b.brg_satuan || '',
                Nama_Bahan: b.brg_nama || '',
                keterangan: d.keterangan || '',
                expired: d.expired || null,
            };
        });
    } else {
        // Dok lama tanpa jejak masterstok: tampilkan agregat per bahan.
        details = dtls.map((d) => {
            const b = brgMap[d.kode] || {};
            return {
                kode_barang: d.kode,
                barcode: '',
                qty: Number(d.qty) || 0,
                panjang: 0,
                lebar: 0,
                spk: '',
                satuan: b.brg_satuan || '',
                Nama_Bahan: b.brg_nama || '',
                keterangan: d.keterangan || '',
                expired: d.expired || null,
            };
        });
    }

    return { header: h, details };
};

exports.deleteMutasiGudang = async (nomor) => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        await connection.query('DELETE FROM tmutasi_dtl_mmt WHERE mutd_mut_nomor = ?', [nomor]);
        await connection.query('DELETE FROM tmasterstok_bahan WHERE mst_noreferensi = ?', [nomor]);
        await connection.query('DELETE FROM tmasterstok_mmt WHERE mst_noreferensi = ?', [nomor]);
        await connection.query('DELETE FROM tmutasi_hdr_mmt WHERE mut_nomor = ?', [nomor]);
        await connection.commit();
        return true;
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
};

exports.getMutasiData = async (startDate, endDate, search = '') => {    try {
        let sqlMaster = `
            SELECT 
                h.mut_nomor AS Nomor,
                h.mut_tanggal AS Tanggal,
                h.mut_gdg_asal AS Asal,
                h.mut_gdg_tujuan AS Tujuan,
                h.mut_keterangan AS Keterangan,
                h.mut_status_realisasi AS Status
            FROM tmutasi_hdr_mmt h
            WHERE h.mut_tanggal BETWEEN ? AND ?
        `;
        const masterParams = [startDate, endDate];

        if (search && String(search).trim() !== '') {
            sqlMaster += ` AND (h.mut_nomor LIKE ? OR h.mut_keterangan LIKE ?)`;
            const kw = `%${String(search).trim()}%`;
            masterParams.push(kw, kw);
        }

        sqlMaster += ` ORDER BY h.mut_tanggal DESC`;

        const [masterResults] = await pool.query(sqlMaster, masterParams);
        if (masterResults.length === 0) return [];

        const nomors = masterResults.map(r => r.Nomor);
        // Detail per BARCODE (satu baris per roll): Panjang/Lebar/Qty akurat
        // per roll, bukan MAX/gabungan yang menyesatkan. Sumber jejak
        // per-roll adalah kartu stok OUT gudang asal. Baris dtl yang tak
        // punya jejak masterstok (dok lama) tampil sebagai satu baris
        // agregat fallback.
        const [detailResults] = await pool.query(
            `SELECT
                d.mutd_mut_nomor AS Nomor, d.mutd_brg_kode AS Kode,
                b.brg_nama AS Nama_Barang,
                s.mst_barcode AS Barcode, s.mst_panjang AS Panjang,
                s.mst_lebar AS Lebar, s.mst_stok_out AS Qty,
                d.mutd_expired AS Expired, d.mutd_keterangan AS Ket
             FROM tmutasi_dtl_mmt d
             LEFT JOIN tbarang_mmt b ON d.mutd_brg_kode = b.brg_kode
             INNER JOIN tmasterstok_mmt s ON s.mst_noreferensi = d.mutd_mut_nomor
                AND s.mst_brg_kode = d.mutd_brg_kode AND s.mst_stok_out <> 0
             WHERE d.mutd_mut_nomor IN (?)
             UNION ALL
             SELECT
                d.mutd_mut_nomor AS Nomor, d.mutd_brg_kode AS Kode,
                b.brg_nama AS Nama_Barang,
                '' AS Barcode, NULL AS Panjang, NULL AS Lebar,
                d.mutd_qty AS Qty,
                d.mutd_expired AS Expired, d.mutd_keterangan AS Ket
             FROM tmutasi_dtl_mmt d
             LEFT JOIN tbarang_mmt b ON d.mutd_brg_kode = b.brg_kode
             WHERE d.mutd_mut_nomor IN (?)
               AND NOT EXISTS (
                 SELECT 1 FROM tmasterstok_mmt s
                 WHERE s.mst_noreferensi = d.mutd_mut_nomor
                   AND s.mst_brg_kode = d.mutd_brg_kode
                   AND s.mst_stok_out <> 0
               )
             ORDER BY Nomor, Kode, Barcode`, [nomors, nomors]
        );

        // Mapping detail ke dalam master
        return masterResults.map(header => ({
            ...header,
            Details: detailResults.filter(d => d.Nomor === header.Nomor)
        }));

    } catch (error) {
        throw new Error('Gagal tarik data mutasi: ' + error.message);
    }
};