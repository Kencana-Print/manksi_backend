// backend/src/services/invoicePembelian.service.js

const pool = require('../../../config/database');
const { format, parseISO, isValid } = require('date-fns');

const throwDbError = (message, error) => {
    console.error(message, error.message);
    throw new Error(message + ': ' + error.message);
};

// ===================================
// GENERATE NOMOR INVOICE
// ===================================
exports.generateMaxKode = async (perushKode, tanggalInput) => {
    const tanggal = new Date(tanggalInput);
    if (isNaN(tanggal.getTime())) throw new Error('Tanggal tidak valid');

    const yearMonth = format(tanggal, 'yyMM'); // Hasil: 2602
    
    // Prefix yang diinginkan: INVP/KP/2602
    const prefix = `INVP.KP.${yearMonth}`;
    
    // Query untuk mencari nomor terakhir dengan prefix tersebut
    const sql = `
        SELECT MAX(CAST(SUBSTRING_INDEX(invp_nomor, '.', -1) AS UNSIGNED)) AS max_num
        FROM tinvp_hdr
        WHERE invp_nomor LIKE ? OR invp_nomor LIKE ?
    `;

    // Mendukung pemisah titik maupun garis miring
    const [rows] = await pool.query(sql, [`${prefix}.%`, `${prefix}/%`]);

    const nextNum = (rows[0].max_num || 0) + 1;
    
    // Gunakan padStart 4 agar hasilnya 0001, 0002, dst. 
    // Jika ingin 5 digit, ubah angka 4 menjadi 5.
    const padded = String(nextNum).padStart(4, '0');

    // Hasil Akhir: INVP/KP/2602/0001
    return `${prefix}.${padded}`;
};

// ===================================
// READ BY NOMOR (DETAIL VIEW)
// ===================================
exports.getInvoicePembelianByNomor = async (nomor) => {
    try {
        const sqlHeader = `
            SELECT
                h.invp_nomor AS Nomor,
                h.invp_tanggal AS Tanggal,
                h.invp_tanggal_tempo AS JatuhTempo,
                h.invp_keterangan AS Keterangan,
                h.invp_sup_kode AS SupplierKode,
                s.sup_nama AS SupplierNama,
                h.invp_sup_alamat AS SupplierAlamat,
                h.invp_ppn AS PPN,
                h.invp_sts_ppn AS IsPPN,
                h.invp_disc AS Diskon,
                h.invp_pph AS PPH,
                h.invp_status AS Status,
                h.invp_grn_nomor AS GRN
            FROM tinvp_hdr h
            LEFT JOIN tsupplier s ON s.sup_kode = h.invp_sup_kode
            WHERE h.invp_nomor = ?
        `;
        const [headerRows] = await pool.query(sqlHeader, [nomor]);

        if (headerRows.length === 0) {
            throw new Error(`Invoice Pembelian ${nomor} tidak ditemukan`);
        }

        const sqlDetail = `
            SELECT
                invpd_nourut AS NoUrut,
                invpd_brg_kode AS Kode,
                invpd_brg_nama AS Nama,
                invpd_satuan AS Satuan,
                invpd_jumlah AS Jumlah,
                invpd_harga AS Harga,
                (invpd_jumlah * invpd_harga) AS Total
            FROM tinvp_dtl
            WHERE invpd_inv_nomor = ?
            ORDER BY invpd_nourut
        `;
        const [detailRows] = await pool.query(sqlDetail, [nomor]);

        return {
            ...headerRows[0],
            Detail: detailRows
        };
    } catch (error) {
        throwDbError('Gagal mengambil Invoice Pembelian', error);
    }
};

// ===================================
// READ ALL (LIST DENGAN EXPAND DETAIL)
// ===================================
exports.getInvoicePembelianData = async (startDate, endDate) => {
    try {
        // Guard: tanggal kosong ("") di-skip agar tidak jadi klausa zero-date.
        const dateConds = [];
        const dateParams = [];
        if (startDate) {
            dateConds.push(`h.invp_tanggal >= ?`);
            dateParams.push(startDate);
        }
        if (endDate) {
            dateConds.push(`h.invp_tanggal <= ?`);
            dateParams.push(endDate);
        }
        const dateClause = dateConds.length ? `WHERE ${dateConds.join(" AND ")}` : "";
        // 1. Query Header dengan Subquery Perhitungan Total yang Akurat
        const sqlMaster = `
            SELECT 
                h.invp_nomor AS Nomor,
                DATE_FORMAT(h.invp_tanggal,'%d-%m-%Y') AS Tanggal,
                s.sup_nama AS Supplier,
                h.invp_status AS Status,
                (
                    SELECT IFNULL(SUM(
                        CASE 
                            WHEN b2.brg_satuan_harga = 'M2' THEN (d2.invpd_jumlah * (b2.brg_panjang * b2.brg_lebar) * d2.invpd_harga)
                            ELSE (d2.invpd_jumlah * d2.invpd_harga)
                        END
                    ), 0)
                    FROM tinvp_dtl d2 
                    INNER JOIN tbarang_mmt b2 ON b2.brg_kode = d2.invpd_brg_kode
                    WHERE d2.invpd_inv_nomor = h.invp_nomor
                ) AS Total
            FROM tinvp_hdr h
            LEFT JOIN tsupplier s ON s.sup_kode = h.invp_sup_kode
            ${dateClause}
            ORDER BY h.invp_tanggal DESC
        `;
        
        const [masterResults] = await pool.query(sqlMaster, dateParams);
        
        if (masterResults.length === 0) return [];

        const masterNomors = masterResults.map(row => row.Nomor);

        // 2. Query Detail dengan JOIN ke tbarang_mmt
        const sqlDetail = `
            SELECT 
                d.invpd_inv_nomor AS Nomor,
                d.invpd_nourut AS NoUrut,
                d.invpd_brg_kode AS Kode,
                d.invpd_brg_nama AS Nama,
                d.invpd_satuan AS Satuan,
                b.brg_satuan_harga AS SatuanHarga,
                (b.brg_panjang * b.brg_lebar) AS M2,
                d.invpd_jumlah AS Jumlah,
                d.invpd_harga AS Harga,
                CASE 
                    WHEN b.brg_satuan_harga = 'M2' THEN (d.invpd_jumlah * (b.brg_panjang * b.brg_lebar) * d.invpd_harga)
                    ELSE (d.invpd_jumlah * d.invpd_harga)
                END AS SubTotal
            FROM tinvp_dtl d
            INNER JOIN tbarang_mmt b ON b.brg_kode = d.invpd_brg_kode
            WHERE d.invpd_inv_nomor IN (?)
            ORDER BY d.invpd_inv_nomor, d.invpd_nourut
        `;
        
        const [detailResults] = await pool.query(sqlDetail, [masterNomors]);

        // 3. Mapping Detail ke Header
        const dataMap = new Map();
        masterResults.forEach(item => {
            dataMap.set(item.Nomor, { ...item, Detail: [] });
        });

        detailResults.forEach(detail => {
            if (dataMap.has(detail.Nomor)) {
                const { Nomor, ...detailContent } = detail;
                dataMap.get(Nomor).Detail.push(detailContent);
            }
        });

        return Array.from(dataMap.values());
    } catch (error) {
        throwDbError('Gagal mengambil data Invoice Pembelian', error);
    }
};

// ===================================
// SAVE (INSERT / UPDATE)
// ===================================
const postJurnal = async (connection, { tgl, bukti, keterangan, akun, debet, kredit, user }) => {
    const sql = `
        INSERT INTO tjurnal_mmt 
        (jur_tanggal, jur_bukti, jur_keterangan, jur_akun_kode, jur_debet, jur_kredit, user_create) 
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `;
    await connection.query(sql, [tgl, bukti, keterangan, akun, debet, kredit, user]);
};


exports.saveInvoicePembelian = async (data, nomorToEdit, userLogin) => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        // 1. Generate Nomor
        const currentNomor = nomorToEdit
            ? nomorToEdit
            : await exports.generateMaxKode(data.invp_perush_kode || 'KP', data.inv_tanggal);

        const serverTime = format(new Date(), 'yyyy-MM-dd HH:mm:ss');
        const activeUser = userLogin; 

        const isPpn = data.inv_is_ppn === 'Y';
        const ppnRate = parseFloat(data.inv_ppn_rate || 0);

        // 2. HEADER
        if (nomorToEdit) {
            const sqlUpdate = `
                UPDATE tinvp_hdr SET
                    invp_tanggal = ?, invp_tanggal_tempo = ?, invp_keterangan = ?,
                    invp_sup_kode = ?, invp_sup_alamat = ?, invp_sts_ppn = ?,
                    invp_ppn = ?, invp_grn_nomor = ?, date_modified = ?, user_modified = ?
                WHERE invp_nomor = ?
            `;
            await connection.query(sqlUpdate, [
                data.inv_tanggal, data.inv_tanggal_tempo, data.inv_keterangan,
                data.inv_sup_kode, data.inv_sup_alamat, isPpn ? 1 : 0,
                ppnRate, data.inv_rekening, serverTime, activeUser, currentNomor
            ]);
        } else {
            const sqlInsert = `
                INSERT INTO tinvp_hdr
                (invp_nomor, invp_perush_kode, invp_tanggal, invp_tanggal_tempo, invp_keterangan,
                 invp_sup_kode, invp_sup_alamat, invp_sts_ppn, invp_ppn, invp_grn_nomor, 
                 invp_status, date_create, user_create)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', ?, ?)
            `;
            await connection.query(sqlInsert, [
                currentNomor, data.invp_perush_kode || 'KP', data.inv_tanggal,
                data.inv_tanggal_tempo, data.inv_keterangan, data.inv_sup_kode,
                data.inv_sup_alamat, isPpn ? 1 : 0, ppnRate,
                data.inv_rekening, serverTime, activeUser
            ]);
        }

        // 3. DETAIL (Hapus dulu jika edit)
        await connection.query('DELETE FROM tinvp_dtl WHERE invpd_inv_nomor = ?', [currentNomor]);

        if (data.detail && data.detail.length > 0) {
            const detailValues = data.detail.map((d, index) => ([
                currentNomor, 
                data.inv_rekening, 
                d.kode_barang || '',    // Menyesuaikan payload frontend
                d.nama_barang, 
                d.satuan || '',         // Menyesuaikan payload frontend
                d.invd_jumlah || 0,
                d.invd_harga || 0, 
                index + 1
            ]));

            const sqlDetail = `
                INSERT INTO tinvp_dtl
                (invpd_inv_nomor, invpd_grn_nomor, invpd_brg_kode, invpd_brg_nama, 
                 invpd_satuan, invpd_jumlah, invpd_harga, invpd_nourut)
                VALUES ?
            `;
            await connection.query(sqlDetail, [detailValues]);
        }

        // 4. JURNAL OTOMATIS (Hapus jurnal lama jika edit)
        await connection.query('DELETE FROM tjurnal_mmt WHERE jur_bukti = ?', [currentNomor]);

        const subTotal = data.detail.reduce((sum, d) => sum + (parseFloat(d.invd_jumlah) * parseFloat(d.invd_harga)), 0);
        const ppnAmount = isPpn ? subTotal * (ppnRate / 100) : 0;
        const grandTotal = subTotal + ppnAmount;

        // Post Jurnal dengan activeUser agar konsisten
        await postJurnal(connection, {
            tgl: data.inv_tanggal, bukti: currentNomor,
            keterangan: `Pembelian dari Supplier ${data.inv_sup_kode}`,
            akun: '5101', debet: subTotal, kredit: 0, user: activeUser
        });

        if (ppnAmount > 0) {
            await postJurnal(connection, {
                tgl: data.inv_tanggal, bukti: currentNomor,
                keterangan: `PPN Masukan Invoice ${currentNomor}`,
                akun: '1105', debet: ppnAmount, kredit: 0, user: activeUser
            });
        }

        await postJurnal(connection, {
            tgl: data.inv_tanggal, bukti: currentNomor,
            keterangan: `Hutang Pembelian ${currentNomor}`,
            akun: '2101', debet: 0, kredit: grandTotal, user: activeUser
        });

        await connection.commit();
        return { Nomor: currentNomor };

    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
};
// ===================================
// PRINT
// ===================================
// backend/src/services/invoicePembelian.service.js

exports.getInvoicePembelianForPrint = async (nomor) => {
    try {
        // Query Header lengkap dengan data Supplier
        const sqlHeader = `
            SELECT
                h.invp_nomor AS Nomor,
                h.invp_tanggal AS Tanggal,
                h.invp_tanggal_tempo AS JatuhTempo,
                h.invp_keterangan AS Keterangan,
                s.sup_nama AS SupplierNama,
                s.sup_alamat AS SupplierAlamat,
                h.invp_sts_ppn AS IsPPN,
                h.invp_ppn AS PPNRate
            FROM tinvp_hdr h
            LEFT JOIN tsupplier s ON s.sup_kode = h.invp_sup_kode
            WHERE h.invp_nomor = ?
        `;
        const [headerRows] = await pool.query(sqlHeader, [nomor]);
        if (headerRows.length === 0) throw new Error("Data tidak ditemukan");

        // Query Detail dengan Join ke tbarang_mmt untuk kalkulasi M2
        const sqlDetail = `
            SELECT
                d.invpd_brg_nama AS Nama,
                d.invpd_satuan AS Satuan,
                d.invpd_jumlah AS Qty,
                d.invpd_harga AS Harga,
                b.brg_satuan_harga AS SatuanHarga,
                (b.brg_panjang * b.brg_lebar) AS LuasM2,
                CASE 
                    WHEN b.brg_satuan_harga = 'M2' THEN (d.invpd_jumlah * (b.brg_panjang * b.brg_lebar) * d.invpd_harga)
                    ELSE (d.invpd_jumlah * d.invpd_harga)
                END AS SubTotalItem
            FROM tinvp_dtl d
            INNER JOIN tbarang_mmt b ON b.brg_kode = d.invpd_brg_kode
            WHERE d.invpd_inv_nomor = ?
            ORDER BY d.invpd_nourut
        `;
        const [detailRows] = await pool.query(sqlDetail, [nomor]);

        const subTotal = detailRows.reduce((sum, item) => sum + item.SubTotalItem, 0);
        const ppnAmount = headerRows[0].IsPPN ? subTotal * (headerRows[0].PPNRate / 100) : 0;

        return {
            Header: {
                ...headerRows[0],
                TanggalFormat: format(new Date(headerRows[0].Tanggal), 'dd MMMM yyyy'),
                SubTotal: subTotal,
                PpnAmount: ppnAmount,
                GrandTotal: subTotal + ppnAmount
            },
            Detail: detailRows
        };
    } catch (error) {
        throwDbError('Gagal menyiapkan data cetak', error);
    }
};


