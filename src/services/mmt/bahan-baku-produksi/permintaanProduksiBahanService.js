// backend/src/services/permintaanProduksiBahan.service.js

const pool = require("../../../config/database");
const { format } = require('date-fns');
// const spkService = require("./spk.service");

const throwDbError = (message, error) => { throw new Error(message + ': ' + error.message); };

// Konfigurasi Mapping Tabel Utama (MMT & OBAT DELPHI)
const TABLE_CONFIG = {
    MMT: {
        hdr: 'tpermintaan_prod_hdr',
        dtl: 'tpermintaan_prod_dtl',
        prefix: 'MNT',
        fields: {
            h: ['mnt_nomor', 'mnt_tanggal', 'mnt_gdg_kode', 'mnt_keterangan', 'mnt_lokasiproduksi'],
            d: ['mntd_mnt_nomor', 'mntd_brg_kode', 'mntd_qty', 'mntd_brg_satuan', 'mntd_keterangan', 'mntd_spk_nomor', 'mntd_nourut']
        }
    },
    OBAT: {
        hdr: 'tobatminta_hdr',
        dtl: 'tobatminta_dtl',
        prefix: 'MIO',
        fields: {
            h: ['min_nomor', 'min_tanggal', 'min_gp', 'min_ket', 'min_cab'],
            d: ['mind_nomor', 'mind_o_kode', 'mind_jumlah', 'mind_ket', 'mind_urut', 'mind_satuan', 'mind_spk']
        }
    },
    // INTEGRASI BARU: Konfigurasi mapping untuk tabel SUBLIM
    SUBLIM: {
        hdr: 'tmintabahan_hdr',
        dtl: 'tmintabahan_dtl',
        prefix: 'MIN',
        fields: {
            h: ['min_nomor', 'min_tanggal', 'min_cab', 'min_ket', 'min_divisi'],
            d: ['mind_nomor', 'mind_bhn_kode', 'mind_jumlah', 'mind_ket', 'mind_urut', 'mind_komponen', 'mind_pcs', 'mind_babaran']
        }
    }
};

// ===================================
// 1. GENERATOR NOMOR OTOMATIS
// ===================================
exports.getNewNomor = async (tipe = 'MMT') => {
    const conf = TABLE_CONFIG[tipe] || TABLE_CONFIG.MMT;
    try {
        const currentYYMM = format(new Date(), 'yyMM'); 
        const pattern = `${conf.prefix}-${currentYYMM}-%`;
        const fieldNomor = conf.fields.h[0];
        
        const sql = `SELECT MAX(${fieldNomor}) AS MaxNomor FROM ${conf.hdr} WHERE ${fieldNomor} LIKE ?;`;
        const [results] = await pool.query(sql, [pattern]);
        const maxNomor = results[0].MaxNomor;
        let nextNum = 1;

        if (maxNomor) {
            const parts = maxNomor.split('-');
            const lastPart = parts[parts.length - 1]; 
            nextNum = parseInt(lastPart, 10) + 1;
        }

        const padSize = tipe === 'OBAT' ? 5 : 4;
        const formattedNum = nextNum.toString().padStart(padSize, '0');
        return `${conf.prefix}-${currentYYMM}-${formattedNum}`;
    } catch (error) {
        throw new Error('Gagal mendapatkan nomor baru: ' + error.message);
    }
};

// Generator nomor otomatis khusus urusan SUBLIM (tmintabahan_hdr)
const generateNomorSublim = async (tahun, conn) => {
    const prefix = `MIN${tahun}.`;
    const [rows] = await conn.query(
        `SELECT IFNULL(MAX(RIGHT(min_nomor, 5)), 0) AS jumlah FROM tmintabahan_hdr WHERE LEFT(min_nomor, 8) = ?`,
        [prefix],
    );
    const nextNum = parseInt(rows[0].jumlah, 10) + 1;
    return `${prefix}${String(nextNum).padStart(5, "0")}`;
};

// ===================================
// 2. SAVE / UPDATE (Pintu Masuk Utama)
// ===================================
// ===================================
// 2. SAVE / UPDATE (Pintu Masuk Utama)
// ===================================
exports.savePermintaanProduksi = async (data, isUpdate = false) => {
    // -----------------------------------------------------------------
    // PENTING: Jika kategori kiriman adalah SUBLIM, belokkan ke fungsi Sublim
    // -----------------------------------------------------------------
    if (data.kategori === 'SUBLIM') {
        return await saveMintaBahanSublim(data, data.User, isUpdate);
    }

    // Jalur Standar untuk MMT dan OBAT (WH-20)
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        
        const tipe = data.GudangKode === 'WH-20' ? 'OBAT' : 'MMT';
        const conf = TABLE_CONFIG[tipe];
        const f = conf.fields;

        let { Nomor, Tanggal, Departemen, Keterangan, Details, User, GudangKode } = data;

        // PENGATURAN INTEGRASI: Pastikan user mengambil kode user (kdUser) login
        const userKode = User?.kode || User?.kdUser || User || 'SYSTEM';

        // Tentukan nilai lokasi produksi yang akan disimpan ke database
        // Jika tipenya MMT, paksa nilainya menjadi 'Produksi'
        let lokasiProduksiBaru = Departemen;
        if (tipe === 'MMT') {
            lokasiProduksiBaru = 'Produksi';
        }

        if (!isUpdate && (!Nomor || Nomor === 'AUTO' || Nomor === '')) {
            Nomor = await exports.getNewNomor(tipe);
        }

        if (isUpdate) {
            // f.h[4] adalah mnt_lokasiproduksi (untuk MMT) atau min_cab (untuk OBAT)
            const sqlUpdate = `UPDATE ${conf.hdr} SET 
                ${f.h[1]}=?, ${f.h[3]}=?, ${f.h[4]}=?, ${f.h[2]}=?, 
                user_modified=?, date_modified=NOW() WHERE ${f.h[0]}=?`;
            
            // Mengganti Departemen menjadi lokasiProduksiBaru dan menggunakan userKode
            await connection.query(sqlUpdate, [Tanggal, Keterangan, lokasiProduksiBaru, GudangKode, userKode, Nomor]);
            await connection.query(`DELETE FROM ${conf.dtl} WHERE ${f.d[0]} = ?`, [Nomor]);
        } else {
            const sqlInsert = `INSERT INTO ${conf.hdr} 
                (${f.h[0]}, ${f.h[1]}, ${f.h[2]}, ${f.h[3]}, ${f.h[4]}, user_create, date_create) 
                VALUES (?, ?, ?, ?, ?, ?, NOW())`;
            
            // Mengganti Departemen menjadi lokasiProduksiBaru dan menyimpan userKode ke user_create
            await connection.query(sqlInsert, [Nomor, Tanggal, GudangKode, Keterangan, lokasiProduksiBaru, userKode]);
        }

        if (Details && Details.length > 0) {
            const detailValues = Details.map((d, index) => {
                if (tipe === 'MMT') {
                    return [Nomor, d.sku, d.qtyMinta, d.satuan || 'ROLL', d.keterangan || '', d.spk || '0', index + 1];
                } else {
                    return [
                        Nomor, d.sku, d.qtyMinta, d.keterangan || '', index + 1, d.satuan || 'KG', 
                        d.spk ? parseInt(d.spk) : 0 
                    ];
                }
            });

            const sqlInsertDtl = `INSERT INTO ${conf.dtl} (${f.d.join(',')}) VALUES ?`;
            await connection.query(sqlInsertDtl, [detailValues]);
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

// ===================================
// JALUR PENDUKUNG INTERNAL: SUBLIM SAVE ROUTINE
// ===================================
const saveMintaBahanSublim = async (payload, userLogin, isEdit = false) => {
    const conn = await pool.getConnection(); 
    await conn.beginTransaction();

    try {
        let nomor = payload.nomor;
        // PENGATURAN INTEGRASI: Fallback pencarian kdUser dari object user login
        const userKode = userLogin?.kode || userLogin?.kdUser || userLogin || 'SYSTEM';
        const dateModified = format(new Date(), 'yyyy-MM-dd HH:mm:ss');

        if (isEdit) {
            const qUpdate = `
                UPDATE tmintabahan_hdr SET 
                    min_tanggal = ?, min_cab = ?, min_spk_nomor = ?, min_ket = ?, min_divisi = ?,
                    date_modified = ?, user_modified = ?
                WHERE min_nomor = ?
            `;
            await conn.query(qUpdate, [
                payload.tanggal, payload.cabang, payload.spk || '', payload.keterangan, payload.divisi,
                dateModified, userKode, nomor
            ]);

            if (payload.pin_acc === "Y" && !payload.pin_dipakai) {
                await conn.query(
                    `UPDATE tspk_pin5 SET pin_dipakai="Y" WHERE pin_trs="MINTA BAHAN" AND pin_nomor=? AND pin_dipakai=""`,
                    [nomor]
                );
            }
            await conn.query(`DELETE FROM tmintabahan_dtl WHERE mind_nomor = ?`, [nomor]);
        } else {
            nomor = await generateNomorSublim(payload.tanggal.substring(0, 4), conn);

            let min_apv = payload.keterangan === "BARU" ? "" : "N";
            let min_apvmgr = ["GANTI BS", "GANTI HILANG", "TAMBAHAN"].includes(payload.keterangan) ? "N" : "";

            const qInsert = `
                INSERT INTO tmintabahan_hdr 
                (min_nomor, min_tanggal, min_cab, min_divisi, min_spk_nomor, min_ket, min_apv, min_apvmgr, date_create, user_create) 
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;

            // Menyimpan userKode ke user_create saat data baru masuk
            await conn.query(qInsert, [
                nomor, payload.tanggal, payload.cabang, payload.divisi, payload.spk || '', payload.keterangan,
                min_apv, min_apvmgr, dateModified, userKode
            ]);
        }

        if (payload.details && payload.details.length > 0) {
            for (const d of payload.details) {
                if (d.kode) {
                    const qDtl = `
                        INSERT INTO tmintabahan_dtl (mind_nomor, mind_bhn_kode, mind_jumlah, mind_pcs, mind_babaran, mind_komponen, mind_ket) 
                        VALUES (?, ?, ROUND(?, 2), ?, ?, ?, ?)
                    `;
                    await conn.query(qDtl, [
                        nomor, d.kode, d.jumlah || 0, d.pcs || 0, d.babaran || 0, d.komponen || "", d.ket || ""
                    ]);
                }
            }
        }

        await conn.commit();
        return { success: true, nomor };
    } catch (error) {
        await conn.rollback();
        throw error;
    } finally {
        conn.release();
    }
};
// ===================================
// 3. READ (Detail by Nomor)
// ===================================
exports.getPermintaanProduksiDataByNomor = async (nomor) => {
    try {
        // Tentukan tipe tabel berdasarkan prefix nomor dokumen
        let tipe = 'MMT';
        if (nomor.startsWith('MIO')) tipe = 'OBAT';
        else if (nomor.startsWith('MIN')) tipe = 'SUBLIM';

        const conf = TABLE_CONFIG[tipe];
        const f = conf.fields;

        // 1. Ambil Data Header
        const sqlHeader = `
            SELECT
                h.${f.h[0]} AS Nomor, h.${f.h[2]} AS GudangKode, g.gdg_nama AS GudangNama,
                DATE_FORMAT(h.${f.h[1]}, '%Y-%m-%d') AS Tanggal, h.${f.h[3]} AS Keterangan, h.${f.h[4]} AS Lokasi
            FROM ${conf.hdr} h 
            LEFT JOIN tgudang g ON h.${f.h[2]} = g.gdg_kode 
            WHERE TRIM(h.${f.h[0]}) = TRIM(?);
        `;
        
        const [header] = await pool.query(sqlHeader, [nomor]);
        if (header.length === 0) return null;

        // 2. Ambil Data Detail sesuai tipenya masing-masing
        let sqlDetail = "";
        if (tipe === 'MMT') {
            sqlDetail = `
                SELECT d.${f.d[0]} AS Nomor, d.${f.d[1]} AS Kode,
                       COALESCE(NULLIF(TRIM(b.brg_nama), ''), d.${f.d[1]}) AS Nama_Bahan, 
                       d.${f.d[3]} AS Satuan, d.${f.d[2]} AS Jumlah, 0 AS Panjang, 0 AS Lebar,
                       d.${f.d[5]} AS Nomor_SPK, d.${f.d[4]} AS Keterangan
                FROM ${conf.dtl} d
                LEFT JOIN tbarang_mmt b ON d.${f.d[1]} = b.brg_kode
                WHERE TRIM(d.${f.d[0]}) = TRIM(?)
                ORDER BY d.${f.d[6]};
            `;
        } else if (tipe === 'OBAT') {
            sqlDetail = `
                SELECT d.${f.d[0]} AS Nomor, d.${f.d[1]} AS Kode,
                       COALESCE(NULLIF(TRIM(o.o_nama), ''), d.${f.d[1]}) AS Nama_Bahan,
                       d.${f.d[5]} AS Satuan, d.${f.d[2]} AS Jumlah, 0 AS Panjang, 0 AS Lebar,
                       d.${f.d[6]} AS Nomor_SPK, d.${f.d[3]} AS Keterangan
                FROM ${conf.dtl} d
                LEFT JOIN tobat o ON d.${f.d[1]} = o.o_kode
                WHERE TRIM(d.${f.d[0]}) = TRIM(?)
                ORDER BY d.${f.d[4]};
            `;
        } else {
            // JALUR SUBLIM: Mapping field agar bersahabat dengan format data di Frontend Vue
            sqlDetail = `
                SELECT d.mind_nomor AS Nomor, d.mind_bhn_kode AS Kode,
                       COALESCE(NULLIF(TRIM(b.Bhn_Name), ''), d.mind_bhn_kode) AS Nama_Bahan,
                       b.Bhn_satuan AS Satuan, d.mind_jumlah AS Jumlah, 0 AS Panjang, 0 AS Lebar,
                       h.min_spk_nomor AS Nomor_SPK, d.mind_ket AS Keterangan,
                       d.mind_babaran AS babaran, d.mind_pcs AS pcs, d.mind_komponen AS komponen
                FROM tmintabahan_dtl d 
                INNER JOIN tmintabahan_hdr h ON d.mind_nomor = h.min_nomor
                LEFT JOIN tbahan b ON d.mind_bhn_kode = b.Bhn_kode 
                WHERE TRIM(d.mind_nomor) = TRIM(?);
            `;
        }
        
        const [details] = await pool.query(sqlDetail, [nomor]);
        return { ...header[0], Details: details }; 
    } catch (error) {
        throw new Error('Gagal ambil detail: ' + error.message);
    }
};

// ===================================
// 4. DELETE (Diperbaiki untuk SUBLIM)
// ===================================
exports.deletePermintaanProduksi = async (nomor) => {
    const connection = await pool.getConnection();
    try {
        let tipe = 'MMT';
        if (nomor.startsWith('MIO')) tipe = 'OBAT';
        else if (nomor.startsWith('MIN')) tipe = 'SUBLIM';

        const conf = TABLE_CONFIG[tipe];

        await connection.beginTransaction();
        await connection.query(`DELETE FROM ${conf.dtl} WHERE ${conf.fields.d[0]} = ?`, [nomor]);
        const [result] = await connection.query(`DELETE FROM ${conf.hdr} WHERE ${conf.fields.h[0]} = ?`, [nomor]);
        await connection.commit();
        return result.affectedRows > 0;
    } catch (error) {
        await connection.rollback();
        throw new Error('Gagal hapus data: ' + error.message);
    } finally {
        connection.release();
    }
};

// ===================================
// 5. READ LIST / BROWSE (Diperbaiki untuk Gabung SUBLIM)
// ===================================
exports.getPermintaanProduksiData = async (startDate, endDate, userDivisi) => {
    try {
        let sql = "";
        let params = [];
        const divisi = userDivisi ? Number(userDivisi) : null;

        if (divisi === 4) {
            // DIVISI 4: Tetap tampilkan Gudang Obat/Tinta
            sql = `
                SELECT h.min_nomor AS Nomor, h.min_gp AS Gudang, DATE_FORMAT(h.min_tanggal, '%d/%m/%Y') AS Tanggal, 
                       h.min_ket AS Keterangan, h.min_cab AS Lokasi, 'OPEN' AS Status, 'OBAT' AS Tipe
                FROM tobatminta_hdr h WHERE h.min_tanggal BETWEEN ? AND ? ORDER BY h.min_tanggal DESC;
            `;
            params = [startDate, endDate];
        } else if (divisi === 1) {
            // DIVISI 1: Tampilkan MMT asli
            sql = `
                SELECT h.mnt_nomor AS Nomor, h.mnt_gdg_kode AS Gudang, DATE_FORMAT(h.mnt_tanggal, '%d/%m/%Y') AS Tanggal, 
                       h.mnt_keterangan AS Keterangan, 'OPEN' AS Status, 'MMT' AS Tipe
                FROM tpermintaan_prod_hdr h WHERE h.mnt_tanggal BETWEEN ? AND ? ORDER BY h.mnt_tanggal DESC;
            `;
            params = [startDate, endDate];
        } else {
            // ADMIN / ALL DIVISI: Melakukan UNION ALL 3 Tabel Sekaligus (MMT, OBAT, dan SUBLIM)
            sql = `
                SELECT mnt_nomor AS Nomor, mnt_gdg_kode AS Gudang, DATE_FORMAT(mnt_tanggal, '%d/%m/%Y') AS Tanggal, 
                       mnt_keterangan AS Keterangan, mnt_lokasiproduksi AS Lokasi, 'OPEN' AS Status, 'MMT' AS Tipe
                FROM tpermintaan_prod_hdr WHERE mnt_tanggal BETWEEN ? AND ?
                UNION ALL
                SELECT min_nomor AS Nomor, min_gp AS Gudang, DATE_FORMAT(min_tanggal, '%d/%m/%Y') AS Tanggal, 
                       min_ket AS Keterangan, min_cab AS Lokasi, 'OPEN' AS Status, 'OBAT' AS Tipe
                FROM tobatminta_hdr WHERE min_tanggal BETWEEN ? AND ?
                UNION ALL
                SELECT min_nomor AS Nomor, min_cab AS Gudang, DATE_FORMAT(min_tanggal, '%d/%m/%Y') AS Tanggal, 
                       min_ket AS Keterangan, min_divisi AS Lokasi, 'OPEN' AS Status, 'SUBLIM' AS Tipe
                FROM tmintabahan_hdr WHERE min_tanggal BETWEEN ? AND ?
                ORDER BY Tanggal DESC;
            `;
            params = [startDate, endDate, startDate, endDate, startDate, endDate];
        }

        const [results] = await pool.query(sql, params);
        return results;
    } catch (error) {
        throw new Error('Gagal mengambil data permintaan: ' + error.message);
    }
};

exports.getSpkDetailsAndMkb = async (spkNomor, cabang, keterangan, isEdit = false) => {
    // 1. Query SPK dengan UNION (Mencari di tabel SPK aktif dan Memo SPK)
    const querySpk = `
        SELECT * FROM (
            SELECT spk_nomor AS Nomor, spk_nama AS Nama, spk_jumlah AS Jumlah, 
                   spk_pending, spk_accpending, spk_ppotong, spk_cmo AS cmo 
            FROM tspk WHERE spk_aktif="Y"
            UNION ALL
            SELECT mspk_nomor AS Nomor, mspk_nama AS Nama, mspk_jumlah AS Jumlah, 
                   "" AS spk_pending, "" AS spk_accpending, "" AS spk_ppotong, mspk_cmo AS cmo 
            FROM tmemospk
        ) final WHERE Nomor = ?
    `;
    const [spkRows] = await pool.query(querySpk, [spkNomor]);

    if (spkRows.length === 0) throw new Error("No.Spk belum terdaftar.");
    const spk = spkRows[0];

    // 2. Validasi Pending Penuh
    if (spk.spk_pending === "PENDING PENUH" && spk.spk_accpending === "N") {
        throw new Error("No.Spk tsb di pending penuh.\nHubungi marketing jika akan tetap melanjutkan transaksi.");
    }
    // 3. Validasi Pending Sebagian di Cutting
    if (spk.spk_pending === "PENDING SEBAGIAN" && spk.spk_ppotong === "Y" && spk.spk_accpending === "N") {
        throw new Error("No.Spk tsb di pending dibagian Cuting.\nHubungi marketing jika akan tetap melanjutkan transaksi.");
    }
    // 4. Validasi Chief Marketing Approval (CMO)
    if (!spk.cmo || spk.cmo === "") {
        throw new Error("SPK tsb belum di approve oleh Chief Marketing.");
    }

    // 5. Validasi Kedatangan Bahan & Planning Cutting (Kecuali nomor SPK berawalan MAP)
    if (!spkNomor.toUpperCase().startsWith("MAP")) {
        const [planRows] = await pool.query(
            `SELECT SUM(plan_datang) as total_datang, SUM(plan_cutting) as total_cutting FROM tplanningspk WHERE plan_spk = ?`,
            [spkNomor],
        );
        const planning = planRows[0];
        if (!planning || Number(planning.total_datang) === 0) {
            throw new Error("SPK tsb belum input planning kedatangan bahan.\nHubungi divisi pembelian.");
        }
        if (!planning || Number(planning.total_cutting) === 0) {
            throw new Error("SPK tsb belum input planning Cutting.");
        }
    }

    // 6. Query Mengambil Data Master Kebutuhan Bahan (MKB)
    const queryMkb = `
        SELECT MAX(j.mkb_nomor) AS mkb_nomor, 
               MAX(DATE_FORMAT(j.mkb_tanggal, '%Y-%m-%d')) as mkb_tanggal, 
               i.mkbd_bhn_kode, 
               SUM(i.mkbd_babaran) AS babaran, 
               SUM(i.mkbd_jumlah) AS butuh, 
               IFNULL(b.Bhn_Name,"") AS nama, 
               IFNULL(b.Bhn_satuan,"") AS sat,
               CAST(GROUP_CONCAT(i.mkbd_komponen SEPARATOR ", ") AS CHAR) AS komponen
        FROM tmkb_hdr j
        INNER JOIN tmkb_dtl i ON i.mkbd_mkb_nomor = j.MKB_NOMOR
        LEFT JOIN tbahan b ON b.Bhn_kode = i.mkbd_bhn_kode
        WHERE j.MKB_SPK_NOMOR = ?
        GROUP BY i.mkbd_bhn_kode, b.Bhn_Name, b.Bhn_satuan; 
    `;
    const [mkbRows] = await pool.query(queryMkb, [spkNomor]);

    // 7. Validasi Duplikasi Pembuatan Permintaan Baru
    if (!isEdit && keterangan && keterangan.toUpperCase().includes("BARU")) {
        const [cekBaru] = await pool.query(
            `SELECT min_nomor FROM tmintabahan_hdr WHERE min_cab = ? AND min_spk_nomor = ? AND min_ket LIKE "%BARU%"`,
            [cabang, spkNomor],
        );
        if (cekBaru.length > 0) {
            throw new Error(`SPK tsb sudah dibuatkan permintaan baru dengan nomor: ${cekBaru[0].min_nomor}\nAlihkan ke tambahan atau lainnya.`);
        }
    }

    // 8. Return Terformat untuk Frontend Vue 3
    return {
        spkInfo: { Nama: spk.Nama, Jumlah: spk.Jumlah },
        mkbHeader: mkbRows.length > 0 ? { nomor: mkbRows[0].mkb_nomor, tanggal: mkbRows[0].mkb_tanggal } : null,
        mkbDetails: mkbRows.map((r) => {
            const pcs = Number(spk.Jumlah);
            const babaran = Number(r.babaran) || 1;
            
            // Rumus konversi Satuan: KG dibagi babaran, selain KG dikali babaran
            let jumlahMinta = r.sat.toUpperCase() === "KG" ? pcs / babaran : pcs * babaran;

            return {
                kode: r.mkbd_bhn_kode,
                nama: r.nama,
                satuan: r.sat,
                babaran: r.babaran,
                pcs: pcs,
                butuh: r.butuh,
                jumlah: Number(jumlahMinta.toFixed(2)),
                komponen: r.komponen,
                ket: "",
            };
        }),
    };
};

exports.lookupPermintaanProduksi = async (search = '', userDivisi = null) => {
    try {
        const cleanSearch = search.trim();
        const searchPattern = `%${cleanSearch}%`;
        const confMmt = TABLE_CONFIG.MMT;

        let dateMmtClause = cleanSearch === '' ? `AND ${confMmt.fields.h[1]} BETWEEN DATE_SUB(NOW(), INTERVAL 60 DAY) AND NOW()` : "";
        let dateSublimClause = cleanSearch === '' ? `AND min_tanggal BETWEEN DATE_SUB(NOW(), INTERVAL 60 DAY) AND NOW()` : "";

        const sql = `
            SELECT 
                ${confMmt.fields.h[0]} AS Nomor, 
                DATE_FORMAT(${confMmt.fields.h[1]}, '%Y-%m-%d') AS Tanggal, 
                IFNULL(${confMmt.fields.h[4]}, ${confMmt.fields.h[2]}) AS Lokasi, 
                ${confMmt.fields.h[3]} AS Keterangan, 
                'OPEN' AS Status, 
                'MMT' AS Tipe
            FROM ${confMmt.hdr} 
            WHERE (${confMmt.fields.h[0]} LIKE ? OR ${confMmt.fields.h[3]} LIKE ?) ${dateMmtClause}
            UNION ALL
            SELECT
                min_nomor AS Nomor,
                DATE_FORMAT(min_tanggal, '%Y-%m-%d') AS Tanggal,
                min_cab AS Lokasi,
                min_ket AS Keterangan,
                'OPEN' AS Status,
                'SUBLIM' AS Tipe
            FROM tmintabahan_hdr
            WHERE (min_nomor LIKE ? OR min_ket LIKE ?) ${dateSublimClause}
            ORDER BY Tanggal DESC 
            LIMIT 150;
        `;

        const [rows] = await pool.query(sql, [searchPattern, searchPattern, searchPattern, searchPattern]);
        return rows || [];
    } catch (error) {
        console.error("SQL Error inside lookupPermintaanProduksi MMT:", error);
        throw new Error('Gagal melakukan lookup permintaan MMT: ' + error.message);
    }
};