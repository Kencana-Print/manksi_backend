const pool = require("../../../../config/database");

exports.getBrowseData = async (start, end, cab) => {
    // Guard: tanggal kosong ("") di-skip agar tidak jadi klausa zero-date.
    const dateConds = [];
    const params = [];
    if (start) {
        dateConds.push(`h.bpe_tanggal >= ?`);
        params.push(start);
    }
    if (end) {
        dateConds.push(`h.bpe_tanggal <= ?`);
        params.push(end);
    }
    let sql = `
        SELECT h.bpe_nomor AS Nomor, h.bpe_tanggal AS Tanggal, h.bpe_po AS NomorPO, 
               h.bpe_cab AS Cab, h.bpe_spk_nomor AS SPK, s.spk_nama AS NamaSPK,
               h.bpe_sup AS Kdsup, u.Sup_nama AS Supplier, h.bpe_jumlah AS Jumlah,
               h.bpe_finishing AS Finishing,
               h.bpe_ket AS Keterangan
        FROM tbpbpoexternal_hdr h
        LEFT JOIN tspk s ON s.spk_nomor = h.bpe_spk_nomor
        LEFT JOIN tsupplier u ON u.Sup_kode = h.bpe_sup
        WHERE ${dateConds.length ? dateConds.join(" AND ") : "1=1"}
    `;
    
    if (cab && cab !== 'ALL') {
        sql += ` AND h.bpe_cab = ?`;
        params.push(cab);
    } else {
        sql += ` AND h.bpe_cab IN ("P02", "P05")`;
    }
    sql += ` ORDER BY h.bpe_nomor DESC`;

    const [rows] = await pool.query(sql, params);
    
    // 🌟 PERBAIKAN: Inject data sub-tabel alokasi secara asinkron untuk setiap baris browse data
    if (rows.length > 0) {
        for (let row of rows) {
            const [alokasi] = await pool.query(
                `SELECT poeda_nomor AS NomorPO, poeda_nourut AS NoUrut, 
                        poeda_kota AS KodeBrg, poeda_kota AS NamaBrg, 
                        poeda_jumlah AS QtyPO 
                 FROM tpoexternal_dtl_alokasi 
                 WHERE poeda_nomor = ? ORDER BY poeda_nourut`, 
                [row.NomorPO]
            );
            // Ikat array detail alokasi kota ke properti 'details' (huruf kecil, s)
            row.details = alokasi || [];
        }
    }

    return rows;
};

exports.getDetailByNomor = async (nomor) => {
    const [header] = await pool.query('SELECT * FROM tbpbpoexternal_hdr WHERE bpe_nomor = ?', [nomor]);
    if (header.length === 0) throw new Error("Data tidak ditemukan");
    
    // Asumsi ada tabel detail penerimaan (jika menggunakan dtl alokasi PO gunakan tpoexternal_dtl_alokasi)
    const [details] = await pool.query('SELECT * FROM tbpbpoexternal_dtl WHERE bped_nomor = ?', [nomor]);
    
    // 🌟 PERBAIKAN: Ubah property 'Detail' (D besar) menjadi 'details' (huruf kecil semua) agar seragam
    return { ...header[0], details: details };
};

exports.deleteBPB = async (nomorBPB, userCab) => {
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();

        // 1. Cek Cabang & Ambil Nomor PO terkait (Logika Delphi)
        const [header] = await conn.query(
            'SELECT bpe_cab, bpe_po FROM tbpbpoexternal_hdr WHERE bpe_nomor = ?', 
            [nomorBPB]
        );

        if (header.length === 0) throw new Error("Data tidak ditemukan.");
        if (userCab && userCab !== "" && header[0].bpe_cab !== userCab) {
            throw new Error("Anda tidak berhak menghapus data cabang lain.");
        }

        const nomorPO = header[0].bpe_po;

        // 2. Hapus Data
        await conn.query('DELETE FROM tbpbpoexternal_hdr WHERE bpe_nomor = ?', [nomorBPB]);
        // Jika ada tabel detail: await conn.query('DELETE FROM tbpbpoexternal_dtl WHERE bped_nomor = ?', [nomorBPB]);

        // 3. Update Status PO (Replikasi Logika cxButton4Click Delphi)
        // Hitung total yang dipesan di PO
        const [poQty] = await conn.query(
            'SELECT SUM(poe_jumlah) as total FROM tpoexternal_hdr WHERE poe_nomor = ?', 
            [nomorPO]
        );
        
        // Hitung total yang sudah diterima (setelah BPB ini dihapus)
        const [recQty] = await conn.query(
            'SELECT IFNULL(SUM(bpe_jumlah), 0) as total FROM tbpbpoexternal_hdr WHERE bpe_po = ?', 
            [nomorPO]
        );

        const nPO = poQty[0].total || 0;
        const nSJ = recQty[0].total || 0;

        let status = "OPEN";
        if (nSJ >= nPO && nPO > 0) status = "CLOSE";
        else if (nSJ > 0) status = "PROSES";

        await conn.query(
            'UPDATE tpoexternal_hdr SET poe_status = ? WHERE poe_nomor = ?', 
            [status, nomorPO]
        );

        await conn.commit();
    } catch (err) {
        await conn.rollback();
        throw err;
    } finally {
        conn.release();
    }
};

exports.getDetailByNomor = async (nomor) => {
    // Implementasi pengambilan header + detail untuk mode EDIT
    const [header] = await pool.query('SELECT * FROM tbpbpoexternal_hdr WHERE bpe_nomor = ?', [nomor]);
    if (header.length === 0) throw new Error("Data tidak ditemukan");
    
    // Asumsi ada tabel detail
    const [details] = await pool.query('SELECT * FROM tbpbpoexternal_dtl WHERE bped_nomor = ?', [nomor]);
    
    return { ...header[0], Detail: details };
};

/**
 * Logika Simpan BPB (Penerimaan PO External)
 * Mengikuti pola savePermintaanProduksi
 */
exports.saveBPB = async (data, isUpdate = false, userLogin) => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        // 1. Ambil properti sesuai mapping dari Frontend (Payload Vue)
        let { 
            Nomor, 
            Tanggal, 
            NomorPO, 
            NomorSPK, 
            Cabang, 
            Supplier, 
            GpAsal, 
            GpTujuan, 
            Keterangan, 
            JumlahTerima,
            JumlahFinishing
        } = data;

        const finishingBaru = Number(JumlahFinishing) || 0;

        const serverTime = new Date();
        const activeUser = userLogin || 'SYSTEM';

        // --- 2. VALIDASI PEMBAYARAN (Sama dengan getbayar di Delphi) ---
        const [cekBayar] = await connection.query(
            'SELECT 1 FROM tvoucher_dtl WHERE voud_nota = ? LIMIT 1',
            [NomorPO]
        );
        if (cekBayar.length > 0) {
            throw new Error("PO tersebut sudah ada pembayaran. Tidak bisa menyimpan/mengubah BPB.");
        }

        // --- 3. LOGIKA NOMOR OTOMATIS (BPE.YYYY00001) ---
        if (!isUpdate && (!Nomor || Nomor === 'AUTO')) {
            const year = new Date(Tanggal).getFullYear();
            const prefix = `BPE.${year}`;
            const [rows] = await connection.query(
                `SELECT IFNULL(MAX(RIGHT(bpe_nomor, 5)), 0) AS max_num 
                 FROM tbpbpoexternal_hdr WHERE LEFT(bpe_nomor, 8) = ?`,
                [prefix]
            );
            const nextNum = parseInt(rows[0].max_num) + 1;
            Nomor = `${prefix}${String(nextNum).padStart(5, '0')}`;
        }

        // --- 4. EKSEKUSI INSERT ATAU UPDATE ---
        if (isUpdate) {
            await connection.query(
                `UPDATE tbpbpoexternal_hdr SET 
                    bpe_tanggal = ?, 
                    bpe_spk_nomor = ?, 
                    bpe_cab = ?, 
                    bpe_sup = ?, 
                    bpe_gpasal = ?, 
                    bpe_gptujuan = ?, 
                    bpe_ket = ?, 
                    bpe_jumlah = ?, 
                    bpe_finishing = ?, 
                    user_modified = ?, 
                    date_modified = ? 
                WHERE bpe_nomor = ?`,
                [Tanggal, NomorSPK, Cabang, Supplier, GpAsal, GpTujuan, Keterangan, JumlahTerima, finishingBaru, activeUser, serverTime, Nomor]
            );
        } else {
            await connection.query(
                `INSERT INTO tbpbpoexternal_hdr 
                    (bpe_nomor, bpe_tanggal, bpe_po, bpe_spk_nomor, bpe_cab, bpe_sup, 
                     bpe_gpasal, bpe_gptujuan, bpe_ket, bpe_jumlah, bpe_finishing, user_create, date_create) 
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [Nomor, Tanggal, NomorPO, NomorSPK, Cabang, Supplier, GpAsal, GpTujuan, Keterangan, JumlahTerima, finishingBaru, activeUser, serverTime]
            );
        }

        // --- 5. UPDATE STATUS PO (OPEN/PROSES/CLOSE) ---
        // Ambil Qty total dari PO
        const [poData] = await connection.query(
            'SELECT SUM(poe_jumlah) as totalPo FROM tpoexternal_hdr WHERE poe_nomor = ?', 
            [NomorPO]
        );
        const nPO = poData[0]?.totalPo || 0;

        // Hitung akumulasi yang sudah diterima di tabel BPB
        const [bpbData] = await connection.query(
            'SELECT IFNULL(SUM(bpe_jumlah), 0) as totalSj FROM tbpbpoexternal_hdr WHERE bpe_po = ?', 
            [NomorPO]
        );
        const nSJ = bpbData[0]?.totalSj || 0;

        let newStatus = "PROSES";
        if (nSJ >= nPO && nPO > 0) {
            newStatus = "CLOSE";
        } else if (nSJ === 0) {
            newStatus = "OPEN";
        }

        await connection.query(
            'UPDATE tpoexternal_hdr SET poe_status = ? WHERE poe_nomor = ?', 
            [newStatus, NomorPO]
        );

        await connection.commit();
        return { success: true, nomor: Nomor, statusPo: newStatus };

    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
};

exports.getSudahTerima = async (nomorPo) => {
    const [rows] = await pool.query(
        'SELECT IFNULL(SUM(bpe_jumlah), 0) as jml FROM tbpbpoexternal_hdr WHERE bpe_po = ?',
        [nomorPo]
    );
    return rows[0];
};