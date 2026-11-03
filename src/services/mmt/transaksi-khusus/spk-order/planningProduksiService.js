// backend/src/services/planningProduksi.service.js

const pool = require("../../../../config/database");

/**
 * Mengambil data Planning Produksi MMT
 * Sesuai dengan prosedur btnRefreshClick di Delphi
 */
exports.getPlanningProduksiData = async (startDate, endDate) => {
    try {
        // Guard: tanggal kosong/invalid TIDAK boleh jadi klausa zero-date —
        // filter tanggal di-skip (tanpa filter) bila tidak valid.
        const isDateStr = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
        const dateConds = [];
        const dateParams = [];
        if (isDateStr(startDate)) {
            dateConds.push("DATE(s.spk_tanggal) >= ?");
            dateParams.push(startDate);
        }
        if (isDateStr(endDate)) {
            dateConds.push("DATE(s.spk_tanggal) <= ?");
            dateParams.push(endDate);
        }
        // --- 1. Query Master (Persis SQL di Delphi s) ---
        // Menghitung SUM detail di awal agar data master memiliki total status
        const sqlMaster = `
            SELECT 
                s.spk_nomor AS Nomor,
                s.spk_dateline AS Dateline,
                s.spk_tipe AS Tipe,
                s.spk_cab AS Cab,
                s.spk_statuskerja AS Kepentingan,
                s.spk_nama AS NamaSPK, 
                s.spk_panjang AS Panjang, 
                s.spk_lebar AS Lebar, 
                s.spk_jumlah AS JumlahSPK,
                s.spk_kain AS Bahan,
                s.spk_finishing AS Finishing,
                IFNULL(p.Plan_Bahan_Datang, 0) AS Plan_Bhn_Datang,
                IFNULL(p.Plan_Cetak, 0) AS Plancetak,
                IFNULL(p.Plan_Finishing, 0) AS Plan_finishing,
                IFNULL(p.Plan_Kirim, 0) AS Plan_kirim
            FROM tspk s
            LEFT JOIN (
                SELECT 
                    plan_spk,
                    SUM(plan_datang) AS Plan_Bahan_Datang,
                    SUM(plan_cetak) AS Plan_Cetak, 
                    SUM(plan_finishing) AS Plan_Finishing,
                    SUM(plan_kirim) AS Plan_Kirim
                FROM tplanningspk_mmt
                GROUP BY plan_spk
            ) p ON p.plan_spk = s.spk_nomor
            WHERE s.spk_cmo <> "" 
              AND s.spk_aktif = "Y" 
              AND s.spk_divisi IN (5) 
              AND s.spk_jo_kode IN ("MT")
              ${dateConds.length ? "AND " + dateConds.join(" AND ") : ""}
            ORDER BY s.date_create
        `;

        const [masterResults] = await pool.query(sqlMaster, dateParams);

        if (masterResults.length === 0) return [];

        const masterNomors = masterResults.map(row => row.Nomor);

        // --- 2. Query Detail (Persis SQL di Delphi s untuk detail) ---
        const sqlDetail = `
            SELECT 
                p.plan_spk AS Nomor,
                p.plan_tanggal AS TglEstimasi,
                p.plan_datang AS Bahan_Datang, 
                p.plan_mesin AS Mesin, 
                p.plan_cetak AS Cetak, 
                p.plan_finishing AS Finishing,
                p.plan_kirim AS Kirim,
                p.plan_ketcetak AS Ket_Cetak,
                p.plan_ketfinishing AS Ket_Finishing,
                p.plan_ketkirim AS Ket_Kirim
            FROM tplanningspk_mmt p 
            WHERE p.plan_spk IN (?)
            ORDER BY p.plan_spk, p.plan_tanggal
        `;

        const [detailResults] = await pool.query(sqlDetail, [masterNomors]);

        // --- 3. Mapping Data (Master-Detail Structure) ---
        const result = masterResults.map(master => {
            return {
                ...master,
                // Filter detail yang miliki nomor SPK yang sama
                Detail: detailResults.filter(dtl => dtl.Nomor === master.Nomor)
            };
        });

        return result;

    } catch (error) {
        console.error("Error in getPlanningProduksiData:", error.message);
        throw new Error(`Gagal memuat Planning Produksi: ${error.message}`);
    }
};

/**
 * Mengambil satu data SPK untuk diedit (Replikasi loaddataall)
 */
exports.getPlanningByNomor = async (nomor) => {
    try {
        const [rows] = await pool.query("SELECT * FROM tspk WHERE spk_nomor = ?", [nomor]);
        if (rows.length === 0) throw new Error("Data tidak ditemukan");
        
        const [details] = await pool.query("SELECT * FROM tplanningspk_mmt WHERE plan_spk = ?", [nomor]);
        
        return {
            ...rows[0],
            Detail: details
        };
    } catch (error) {
        throw new Error(`Database Error: ${error.message}`);
    }
};

exports.savePlanningProduksi = async (payload) => {
    const { spk_nomor, panjang, lebar, details, forceSave = false } = payload;
    const connection = await pool.getConnection();
    
    try {
        await connection.beginTransaction();

        // -----------------------------------------------------------------
        // LANGKAH 1: Validasi Kapasitas Produksi (Kecuali jika dipaksa/forceSave)
        // -----------------------------------------------------------------
        if (!forceSave) {
            const [mesinKapasitas] = await connection.query(
                'SELECT msn_kode, msn_kapasitas FROM tmesin_mmt WHERE msn_jenis = "C" AND msn_note = "CETAK"'
            );

            const kapasitasMap = {};
            mesinKapasitas.forEach(m => {
                kapasitasMap[m.msn_kode] = parseFloat(m.msn_kapasitas) || 0;
            });

            const pj = parseFloat(panjang) || 0;
            const lb = parseFloat(lebar) || 0;

            for (const row of details) {
                if (!row.mesin || !row.tanggal) continue;

                // Hitung kumulatif target cetak terjadwal di hari tersebut dari database
                const [existingPlan] = await connection.query(
                    `SELECT SUM(plan_cetak) AS total_cetak 
                     FROM tplanningspk_mmt 
                     WHERE plan_tanggal = ? AND plan_mesin = ? AND plan_spk <> ?`,
                    [row.tanggal, row.mesin, spk_nomor]
                );

                const currentCetakDb = parseFloat(existingPlan[0].total_cetak) || 0;
                const jmlInputBaru = parseFloat(row.cetak) || 0;
                const kapasitasMax = kapasitasMap[row.mesin] || 0;

                const totalUnitJml = currentCetakDb + jmlInputBaru;

                if (totalUnitJml > kapasitasMax) {
                    let totalM2Planning = 0;
                    let isOver = false;

                    // Replikasi Blok Percabangan Mesin di Delphi 7
                    if (row.mesin === 'MT01' || row.mesin === 'MT03' || row.mesin === 'MT04' || row.mesin === 'MT05') {
                        totalM2Planning = totalUnitJml * pj * lb;
                        isOver = true; // Kondisi di Delphi: totalUnitJml > kapasitasMax memicu Over
                    } else if (row.mesin === 'MT02') {
                        totalM2Planning = totalUnitJml; // MT02 di Delphi tidak dikali pj * lb pada pesan text-nya
                        isOver = true;
                    }

                    if (isOver) {
                        await connection.rollback();
                        connection.release();

                        // Formatter pesan disesuaikan dengan format string MessageDlg Delphi
                        const formattedDate = new Date(row.tanggal).toLocaleDateString('id-ID', {
                            day: '2-digit', month: '2-digit', year: 'numeric'
                        }).replace(/\//g, '-');

                        return {
                            overCapacityAlert: true,
                            message: `Tanggal ${formattedDate} Mesin:${row.mesin} Melebihi Kapasitas produksi\n` +
                                     `Kapasitas/Hari=${kapasitasMax} M2\n` +
                                     `Planning cetak=${totalM2Planning.toFixed(2)} M2\n`
                        };
                    }
                }
            }
        }

        // -----------------------------------------------------------------
        // LANGKAH 2: Bersihkan data lama & Insert Baru (Reset-Insert Method)
        // -----------------------------------------------------------------
        await connection.query("DELETE FROM tplanningspk_mmt WHERE plan_spk = ?", [spk_nomor]);

        const insertSql = `
            INSERT INTO tplanningspk_mmt 
            (plan_spk, plan_tanggal, plan_datang, plan_mesin, plan_cetak, plan_finishing, plan_kirim, plan_ketcetak, plan_ketfinishing, plan_ketkirim, plan_usr, plan_dtusr)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

        for (const row of details) {
            if (!row.mesin || !row.tanggal) continue;

            await connection.query(insertSql, [
                spk_nomor,
                row.tanggal,
                parseFloat(row.datang) || 0,
                row.mesin,
                parseFloat(row.cetak) || 0,
                parseFloat(row.finishing) || 0,
                parseFloat(row.kirim) || 0,
                row.ketcetak || '',
                row.ketfinishing || '',
                row.ketkirim || '',
                row.usr || 'SYSTEM',
                row.dtusr || new Date()
            ]);
        }

        await connection.commit();
        connection.release();
        return { success: true, message: "Berhasil disimpan." };

    } catch (error) {
        await connection.rollback();
        connection.release();
        console.error("Error in savePlanningProduksi:", error);
        throw new Error(`Gagal Simpan. ${error.message}`);
    }
};

exports.loadSpkDetailForPlanning = async (req, res) => {
    try {
        const { nomorSpk } = req.params;
        if (!nomorSpk) {
            return res.status(400).json({ success: false, message: "Nomor SPK tidak valid." });
        }

        const data = await service.getPlanningByNomor(nomorSpk);
        
        return res.status(200).json({
            success: true,
            data: {
                header: data.header ? {
                    spk_nomor: data.header.spk_nomor,
                    spk_Nama: data.header.spk_nama, // Menyesuaikan nama kolom lower/uppercase database
                    tgl: data.header.tgl,           // Hasil DATE_FORMAT dari service
                    dateline: data.header.dateline, // Hasil DATE_FORMAT dari service
                    spk_jumlah: data.header.spk_jumlah,
                    spk_panjang: data.header.spk_panjang,
                    spk_lebar: data.header.spk_lebar,
                    spk_cab: data.header.spk_cab,
                    spk_workshop: data.header.spk_workshop,
                    spk_tipe: data.header.spk_tipe,
                    spk_kain: data.header.spk_kain,
                    spk_Finishing: data.header.spk_finishing,
                    spk_sablon: data.header.spk_sablon,
                    spk_sublim: data.header.spk_sublim,
                    spk_bordir: data.header.spk_bordir
                } : null,
                detail: data.detail || []
            }
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};