const pool = require("../../../config/database");
const { format } = require("date-fns");

const NOMERATOR = "MMT-LHK-C";

// =========================================================================
// 1. FUNGSI READ (GET)
// =========================================================================

const getAllHeaders = async (startDate, endDate, mesin) => {
  const defaultStart = new Date();
  defaultStart.setDate(defaultStart.getDate() - 30);

  const tglMulai = startDate
    ? format(new Date(startDate), "yyyy-MM-dd")
    : format(defaultStart, "yyyy-MM-dd");
  const tglSelesai = endDate
    ? format(new Date(endDate), "yyyy-MM-dd")
    : format(new Date(), "yyyy-MM-dd");

  let params = [tglMulai, tglSelesai];
  let mesinFilterSql = "";

  if (mesin) {
    const mesinArray = Array.isArray(mesin)
      ? mesin
      : mesin.split(",").filter((m) => m.trim() !== "");

    if (mesinArray.length > 0) {
      mesinFilterSql = `
                AND EXISTS (
                    SELECT 1 FROM tlhk_cetakmmt_dtl dtl 
                    WHERE dtl.lcd_lch_nomor = h.lch_nomor 
                    AND dtl.lcd_jns_mesin IN (${mesinArray.map(() => "?").join(",")})
                )
            `;
      params.push(...mesinArray);
    }
  }

  const sql = `
        SELECT 
            h.lch_nomor AS Nomor, 
            DATE_FORMAT(h.lch_tanggal, '%Y-%m-%d') AS Tanggal, 
            h.lch_gdg_prod AS Gudang, 
            g.gdg_nama AS Nama_Gudang, 
            h.lch_shift AS Shift, 
            h.lch_operator AS Operator,
            
            -- SUBQUERY UNTUK MENGAMBIL DAFTAR MESIN DARI DETAIL
            (SELECT GROUP_CONCAT(DISTINCT d.lcd_jns_mesin ORDER BY d.lcd_jns_mesin ASC SEPARATOR ', ') 
             FROM tlhk_cetakmmt_dtl d 
             WHERE d.lcd_lch_nomor = h.lch_nomor) AS Mesin,

            (SELECT IF(COUNT(*) > COUNT(IF(LENGTH(lcd_brg_kode)>0, 1, NULL)), 'N','Y') 
             FROM tlhk_cetakmmt_dtl WHERE lcd_lch_nomor = h.lch_nomor) AS Lengkap,
             
            (SELECT ROUND(SUM(lcd_qty_Cetak * IFNULL(spk_panjang,0) * IFNULL(spk_lebar,0)), 1)
             FROM tlhk_cetakmmt_dtl 
             LEFT JOIN tspk ON (spk_nomor = lcd_spk_nomor)
             WHERE lcd_lch_nomor = h.lch_nomor) AS cetak_meter
        FROM tlhk_cetakmmt_hdr h
        LEFT JOIN tGUDANG g ON (g.gdg_kode = h.lch_gdg_prod)
        WHERE h.lch_tanggal BETWEEN ? AND ?
        ${mesinFilterSql}
        ORDER BY h.lch_tanggal DESC, h.lch_nomor DESC
    `;

  const [rows] = await pool.query(sql, params);
  return rows;
};

const getInksByNomor = async (nomor) => {
  const sqlInk = `
        SELECT 
            lci_msn_kode AS Msn_Kode,
            lci_c AS Ink_C,
            lci_m AS Ink_M,
            lci_y AS Ink_Y,
            lci_k AS Ink_K
        FROM tlhk_cetakmmt_ink
        WHERE lci_lch_nomor = ?
    `;
  const [rows] = await pool.query(sqlInk, [nomor]);
  return rows;
};

// Tambahkan parameter mesin
const getDetailsByNomor = async (nomor, mesin) => {
  let params = [nomor];
  let filterMesin = "";

  if (mesin) {
    const mesinArray = Array.isArray(mesin)
      ? mesin
      : mesin.split(",").filter((m) => m.trim() !== "");
    if (mesinArray.length > 0) {
      filterMesin = ` AND d.lcd_jns_mesin IN (${mesinArray.map(() => "?").join(",")})`;
      params.push(...mesinArray);
    }
  }

  const sqlDetail = `
        SELECT 
            d.lcd_lch_nomor AS Nomor,
            d.lcd_jns_mesin AS Mesin,
            d.lcd_spk_nomor AS Nomor_SPK,
            x.spk_nama AS Nama_SPK, 
            IFNULL(x.spk_panjang, 0) AS Panjang, 
            IFNULL(x.spk_lebar, 0) AS Lebar,
            x.spk_jumlah AS Jml_Order,
            d.lcd_qty_cetak AS Jml_Cetak,
            /* RUMUS: Panjang x Lebar x Qty Cetak */
            (IFNULL(x.spk_panjang, 0) * IFNULL(x.spk_lebar, 0) * d.lcd_qty_cetak) AS m2_cetak,
            d.lcd_lnomor AS Nomor_lhk_mesin,
            d.lcd_loperator AS Operator,
            d.lcd_lshift AS Shift,
            -- 🔥 TAMBAHKAN KOLOM INI AGAR TERKIRIM KE FRONTEND
            IFNULL(d.lcd_toleransi, 0) AS toleransi,
            IFNULL(d.lcd_toleransi2, 0) AS toleransi2
        FROM tlhk_cetakmmt_dtl d
        LEFT JOIN (
            SELECT spk_nomor, spk_nama, spk_jumlah, spk_panjang, spk_lebar FROM tspk
            UNION ALL
            SELECT mspk_nomor, mspk_nama, mspk_jumlah, mspk_panjang, mspk_lebar FROM tmemospk
        ) x ON x.spk_nomor = d.lcd_spk_nomor
        WHERE d.lcd_lch_nomor = ? 
        ${filterMesin}
        ORDER BY d.lcd_no_urut ASC
    `;
  const [rows] = await pool.query(sqlDetail, params);
  return rows;
};

// =========================================================================
// 2. FUNGSI GENERATE NOMOR
// =========================================================================

const generateNewNomor = async (date) => {
  const yymm = format(new Date(date), "yyMM");
  const prefixLike = `${NOMERATOR}.${yymm}.%`;

  const sqlMax = `
        SELECT MAX(CAST(SUBSTRING(lch_nomor, -4) AS UNSIGNED)) AS max_num
        FROM tlhk_cetakmmt_hdr
        WHERE lch_nomor LIKE ?
    `;

  const [rows] = await pool.query(sqlMax, [prefixLike]);
  const maxNum = rows[0]?.max_num || 0;
  const formattedSequence = String(maxNum + 1).padStart(4, "0");

  return `${NOMERATOR}.${yymm}.${formattedSequence}`;
};

// =========================================================================
// 3. FUNGSI SIMPAN (SAVE/UPDATE)
// =========================================================================

const saveLhk = async (headerData, detailsData, inkData, existingNomor) => {
  const conn = await pool.getConnection();

  // Tentukan apakah ini mode Edit atau Baru
  let isEditMode =
    existingNomor && existingNomor !== "AUTO" && existingNomor !== "";
  let finalNomor = isEditMode ? existingNomor : null;

  try {
    await conn.beginTransaction();

    // 1. PENGELOLAAN TANGGAL & OPERATOR
    const rawDate = headerData.lch_tanggal;
    const dateToUse =
      rawDate && !isNaN(new Date(rawDate).getTime())
        ? new Date(rawDate)
        : new Date();

    // Generate nomor baru jika bukan mode edit
    if (!isEditMode) {
      finalNomor = await generateNewNomor(dateToUse);
    }

    const formattedDate = format(dateToUse, "yyyy-MM-dd");
    const currentUser = headerData.luser_modified || "SYSTEM";

    const detailOperators = [
      ...new Set(
        detailsData
          .map((d) => (d.operator || "").trim())
          .filter((name) => name !== ""),
      ),
    ];

    // Jika detail kosong, fallback ke header
    const combinedOperators =
      detailOperators.length > 0
        ? detailOperators.join(", ")
        : headerData.lch_operator || "";

    // 2. SIMPAN / UPDATE HEADER (tlhk_cetakmmt_hdr)
    if (isEditMode) {
      await conn.query(
        `
                UPDATE tlhk_cetakmmt_hdr SET
                    lch_tanggal = ?, 
                    lch_gdg_prod = ?, 
                    lch_shift = ?, 
                    lch_operator = ?, 
                    lch_user_modified = ?, 
                    lch_date_modified = NOW()
                WHERE lch_nomor = ?
            `,
        [
          formattedDate,
          headerData.lch_gdg_prod,
          headerData.lch_shift,
          combinedOperators,
          currentUser,
          finalNomor,
        ],
      );

      // Hapus detail lama sebelum insert yang baru (Re-insert strategy)
      await conn.query(
        `DELETE FROM tlhk_cetakmmt_dtl WHERE lcd_lch_nomor = ?`,
        [finalNomor],
      );
      await conn.query(
        `DELETE FROM tlhk_cetakmmt_ink WHERE lci_lch_nomor = ?`,
        [finalNomor],
      );
    } else {
      await conn.query(
        `
                INSERT INTO tlhk_cetakmmt_hdr (
                    lch_nomor, lch_tanggal, lch_gdg_prod, lch_shift, 
                    lch_operator, lch_user_create, lch_date_create
                ) VALUES (?, ?, ?, ?, ?, ?, NOW())
            `,
        [
          finalNomor,
          formattedDate,
          headerData.lch_gdg_prod,
          headerData.lch_shift,
          combinedOperators,
          currentUser,
        ],
      );
    }

    // 3. SIMPAN DETAIL PENGERJAAN SPK (tlhk_cetakmmt_dtl)
    for (let i = 0; i < detailsData.length; i++) {
      const d = detailsData[i];

      // Ambil nilai mesin
      const mesinToSave = d.msn_kode || d.mesin || d.Mesin;

      // Ambil shift dari detail (lcd_lshift) atau payload level atas (shift)
      const shiftToSave = d.lcd_lshift || d.shift || headerData.lch_shift;

      // Ambil nilai toleransi dengan fallback ke 0
      const tol1 = Number(d.lcd_toleransi ?? d.toleransi ?? 0);
      const tol2 = Number(d.lcd_toleransi2 ?? d.toleransi2 ?? 0);

      await conn.query(
        `
                INSERT INTO tlhk_cetakmmt_dtl (
                    lcd_lch_nomor, 
                    lcd_no_urut, 
                    lcd_spk_nomor, 
                    lcd_qty_Cetak, 
                    lcd_jns_mesin, 
                    lcd_loperator,
                    lcd_lnomor,        -- Nomor LHK Mesin referensi
                    lcd_lshift,       -- Shift detail
                    lcd_toleransi,   -- Tambahan kolom Toleransi 1
                    lcd_toleransi2    -- Tambahan kolom Toleransi 2
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `,
        [
          finalNomor,
          i + 1,
          d.spk_nomor || d.Nomor_SPK,
          d.jumlah_cetak || 0,
          mesinToSave,
          d.operator || "",
          d.lhkmesin || d.lcd_lnomor,
          shiftToSave,
          tol1,
          tol2,
        ],
      );
    }

    // 4. SIMPAN DETAIL PEMAKAIAN TINTA PER MESIN (tlhk_cetakmmt_ink)
    if (inkData && inkData.length > 0) {
      for (const ink of inkData) {
        const totalInk =
          parseFloat(ink.c || 0) +
          parseFloat(ink.m || 0) +
          parseFloat(ink.y || 0) +
          parseFloat(ink.k || 0);

        if (totalInk > 0) {
          await conn.query(
            `
                        INSERT INTO tlhk_cetakmmt_ink (
                            lci_lch_nomor, lci_msn_kode, 
                            lci_c, lci_m, lci_y, lci_k
                        ) VALUES (?, ?, ?, ?, ?, ?)
                    `,
            [
              finalNomor,
              ink.msn_kode,
              ink.c || 0,
              ink.m || 0,
              ink.y || 0,
              ink.k || 0,
            ],
          );
        }
      }
    }

    await conn.commit();
    return { success: true, nomor: finalNomor };
  } catch (err) {
    await conn.rollback();
    console.error("Gagal Simpan LHK:", err);
    throw err;
  } finally {
    conn.release();
  }
};

const deleteLhk = async (nomor) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query("DELETE FROM tlhk_cetakmmt_dtl WHERE lcd_lch_nomor = ?", [
      nomor,
    ]);
    await conn.query("DELETE FROM tlhk_cetakmmt_hdr WHERE lch_nomor = ?", [
      nomor,
    ]);
    await conn.commit();
    return { success: true };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
};

// =========================================================================
// 4. FUNGSI LAPORAN (AGREGASI)
// =========================================================================

const getLaporanAgregasi = async (startDate, endDate) => {
  const tglMulai = format(new Date(startDate), "yyyy-MM-dd");
  const tglSelesai = format(new Date(endDate), "yyyy-MM-dd");

  // 1. Per Mesin (Total m2 per mesin)
  const sqlMesin = `
        SELECT d.lcd_jns_mesin as Mesin, SUM(d.lcd_qty_Cetak * IFNULL(s.spk_panjang,0) * IFNULL(s.spk_lebar,0)) as Total_m2
        FROM tlhk_cetakmmt_dtl d
        LEFT JOIN tlhk_cetakmmt_hdr h ON d.lcd_lch_nomor = h.lch_nomor
        LEFT JOIN tspk s ON d.lcd_spk_nomor = s.spk_nomor
        WHERE h.lch_tanggal BETWEEN ? AND ?
        GROUP BY d.lcd_jns_mesin
    `;

  // 2. Per Hari (Tren produksi)
  const sqlHarian = `
        SELECT DATE_FORMAT(lch_tanggal, '%Y-%m-%d') as Tanggal, 
               SUM(lcd_qty_Cetak * IFNULL(spk_panjang,0) * IFNULL(spk_lebar,0)) as Total_m2
        FROM tlhk_cetakmmt_hdr h
        JOIN tlhk_cetakmmt_dtl d ON h.lch_nomor = d.lcd_lch_nomor
        LEFT JOIN tspk s ON d.lcd_spk_nomor = s.spk_nomor
        WHERE h.lch_tanggal BETWEEN ? AND ?
        GROUP BY h.lch_tanggal
        ORDER BY h.lch_tanggal ASC
    `;

  // 3. Per SPK (Top 10 SPK terbanyak dikerjakan)
  const sqlSPK = `
        SELECT d.lcd_spk_nomor, s.spk_nama, SUM(d.lcd_qty_Cetak) as Total_Qty,
               SUM(d.lcd_qty_Cetak * IFNULL(s.spk_panjang,0) * IFNULL(s.spk_lebar,0)) as Total_m2
        FROM tlhk_cetakmmt_dtl d
        LEFT JOIN tspk s ON d.lcd_spk_nomor = s.spk_nomor
        LEFT JOIN tlhk_cetakmmt_hdr h ON d.lcd_lch_nomor = h.lch_nomor
        WHERE h.lch_tanggal BETWEEN ? AND ?
        GROUP BY d.lcd_spk_nomor, s.spk_nama
        ORDER BY Total_m2 DESC
        LIMIT 10
    `;

  const [resMesin] = await pool.query(sqlMesin, [tglMulai, tglSelesai]);
  const [resHarian] = await pool.query(sqlHarian, [tglMulai, tglSelesai]);
  const [resSPK] = await pool.query(sqlSPK, [tglMulai, tglSelesai]);

  return { perMesin: resMesin, perHari: resHarian, perSPK: resSPK };
};

// Tambahkan pengecekan sederhana di awal fungsi laporan
const getRekapLhk = async (startDate, endDate) => {
  const tglMulai = format(new Date(startDate), "yyyy-MM-dd");
  const tglSelesai = format(new Date(endDate), "yyyy-MM-dd");

  // 1. Rekap Per Mesin
  // Menggunakan alias agar output sama dengan struktur yang Anda inginkan
  const sqlMesin = `
        SELECT 
            d.lcd_jns_mesin AS Mesin,
            COUNT(DISTINCT d.lcd_spk_nomor) AS Jml_SPK,
            SUM(d.lcd_qty_Cetak) AS Total_Pcs,
            /* Total_Meter dihitung dari Qty * P * L sesuai getAllHeaders */
            ROUND(SUM(d.lcd_qty_Cetak * IFNULL(s.spk_panjang, 0) * IFNULL(s.spk_lebar, 0)), 1) AS Total_Meter,
            IFNULL(m.msn_kapasitas, 0) AS Kapasitas
        FROM tlhk_cetakmmt_dtl d
        JOIN tlhk_cetakmmt_hdr h ON d.lcd_lch_nomor = h.lch_nomor
        LEFT JOIN tspk s ON s.spk_nomor = d.lcd_spk_nomor
        LEFT JOIN tmesin_mmt m ON d.lcd_jns_mesin = m.msn_nama
        WHERE h.lch_tanggal BETWEEN ? AND ?
        GROUP BY d.lcd_jns_mesin, m.msn_kapasitas
    `;

  // 2. Rekap Per Hari
  const sqlHarian = `
        SELECT 
            d.lcd_jns_mesin AS Mesin,
            DATE_FORMAT(h.lch_tanggal, '%Y-%m-%d') AS Tanggal,
            ROUND(SUM(d.lcd_qty_Cetak * IFNULL(s.spk_panjang, 0) * IFNULL(s.spk_lebar, 0)), 1) AS Total_Meter
        FROM tlhk_cetakmmt_hdr h
        JOIN tlhk_cetakmmt_dtl d ON h.lch_nomor = d.lcd_lch_nomor
        LEFT JOIN tspk s ON s.spk_nomor = d.lcd_spk_nomor
        WHERE h.lch_tanggal BETWEEN ? AND ?
        GROUP BY d.lcd_jns_mesin, h.lch_tanggal
        ORDER BY h.lch_tanggal ASC, d.lcd_jns_mesin ASC
    `;

  const [rekapMesin] = await pool.query(sqlMesin, [tglMulai, tglSelesai]);
  const [rekapHarian] = await pool.query(sqlHarian, [tglMulai, tglSelesai]);

  return { rekapMesin, rekapHarian };
};

const getExportLhkCrossTab = async (month, year) => {
  // Menghasilkan data rekap per mesin per tanggal dalam bulan tersebut
  const sql = `
        SELECT 
            d.lcd_jns_mesin AS Mesin,
            DAY(h.lch_tanggal) AS Hari,
            SUM(d.lcd_qty_Cetak * IFNULL(s.spk_panjang,0) * IFNULL(s.spk_lebar,0)) AS Total_Meter
        FROM tlhk_cetakmmt_dtl d
        JOIN tlhk_cetakmmt_hdr h ON d.lcd_lch_nomor = h.lch_nomor
        LEFT JOIN (
            SELECT spk_nomor, spk_panjang, spk_lebar FROM tspk
            UNION ALL
            SELECT mspk_nomor, mspk_panjang, mspk_lebar FROM tmemospk
        ) s ON s.spk_nomor = d.lcd_spk_nomor
        WHERE MONTH(h.lch_tanggal) = ? AND YEAR(h.lch_tanggal) = ?
        GROUP BY d.lcd_jns_mesin, DAY(h.lch_tanggal)
    `;

  const [rows] = await pool.query(sql, [month, year]);
  return rows;
};

// backend/services/lhkCetakMmt.service.js

const getDetailRekapMesin = async (startDate, endDate, mesin) => {
  const tglMulai = format(new Date(startDate), "yyyy-MM-dd");
  const tglSelesai = format(new Date(endDate), "yyyy-MM-dd");

  const sql = `
        SELECT 
            d.lcd_spk_nomor AS No_SPK,
            s.spk_nama AS Nama_Order,
            SUM(d.lcd_qty_Cetak) AS Total_Pcs,
            SUM(d.lcd_qty_Cetak * IFNULL(s.spk_panjang,0) * IFNULL(s.spk_lebar,0)) AS Total_Meter
        FROM tlhk_cetakmmt_dtl d
        JOIN tlhk_cetakmmt_hdr h ON d.lcd_lch_nomor = h.lch_nomor
        LEFT JOIN (
            SELECT spk_nomor, spk_nama, spk_panjang, spk_lebar FROM tspk
            UNION ALL
            SELECT mspk_nomor, mspk_nama, mspk_panjang, mspk_lebar FROM tmemospk
        ) s ON s.spk_nomor = d.lcd_spk_nomor
        WHERE h.lch_tanggal BETWEEN ? AND ?
          AND d.lcd_jns_mesin = ?
        GROUP BY d.lcd_spk_nomor, s.spk_nama
        ORDER BY Total_Meter DESC
    `;

  const [rows] = await pool.query(sql, [tglMulai, tglSelesai, mesin]);
  return rows;
};

const getAllDataForExport = async (startDate, endDate, mesin) => {
  const tglMulai = format(new Date(startDate), "yyyy-MM-dd");
  const tglSelesai = format(new Date(endDate), "yyyy-MM-dd");

  let params = [tglMulai, tglSelesai];
  let filterMesin = "";

  if (mesin) {
    const mesinArray = Array.isArray(mesin)
      ? mesin
      : mesin.split(",").filter((m) => m.trim() !== "");
    if (mesinArray.length > 0) {
      filterMesin = ` AND d.lcd_jns_mesin IN (${mesinArray.map(() => "?").join(",")})`;
      params.push(...mesinArray);
    }
  }

  const sql = `
        SELECT 
            h.lch_nomor AS Nomor_LHK,
            DATE_FORMAT(h.lch_tanggal, '%d/%m/%Y') AS Tanggal,
            h.lch_shift AS Shift_LHK,
            h.lch_operator AS Operator_LHK,
            g.gdg_nama AS Gudang,
            d.lcd_spk_nomor AS Nomor_SPK,
            x.spk_nama AS Nama_Order,
            d.lcd_jns_mesin AS Mesin,
            
            IFNULL(x.spk_jumlah, 0) AS Jml_Order,  -- <--- TAMBAHKAN INI (sesuaikan nama kolom jumlah order di tabel tspk)
            d.lcd_qty_cetak AS Qty_Cetak,
            IFNULL(x.spk_panjang, 0) AS Panjang,
            IFNULL(x.spk_lebar, 0) AS Lebar,
            (IFNULL(x.spk_panjang, 0) * IFNULL(x.spk_lebar, 0) * d.lcd_qty_cetak) AS m2_cetak
        FROM tlhk_cetakmmt_hdr h
        JOIN tlhk_cetakmmt_dtl d ON h.lch_nomor = d.lcd_lch_nomor
        LEFT JOIN tGUDANG g ON g.gdg_kode = h.lch_gdg_prod
        LEFT JOIN (
            SELECT spk_nomor, spk_nama, spk_panjang, spk_lebar, spk_jumlah FROM tspk
            UNION ALL
            SELECT mspk_nomor, mspk_nama, mspk_panjang, mspk_lebar, mspk_jumlah FROM tmemospk
        ) x ON x.spk_nomor = d.lcd_spk_nomor
        WHERE h.lch_tanggal BETWEEN ? AND ?
        ${filterMesin}
        ORDER BY h.lch_tanggal DESC, h.lch_nomor DESC, d.lcd_no_urut ASC
    `;

  const [rows] = await pool.query(sql, params);
  return rows;
};

const getOneLhk = async (nomor) => {
  // 1. Ambil data Header
  const sqlHeader = `
        SELECT 
            lch_nomor AS Nomor, 
            DATE_FORMAT(lch_tanggal, '%Y-%m-%d') AS Tanggal, 
            lch_gdg_prod AS Gdg_Kode, 
            lch_shift AS Shift, 
            lch_operator AS Operator
        FROM tlhk_cetakmmt_hdr
        WHERE lch_nomor = ?
    `;
  const [headerRows] = await pool.query(sqlHeader, [nomor]);

  if (headerRows.length === 0) return null;

  // 2. Ambil data Detail SPK (Gunakan fungsi yang sudah ada)
  const details = await getDetailsByNomor(nomor);

  // 3. Ambil data Detail Pemakaian Tinta (Fungsi baru)
  const inks = await getInksByNomor(nomor);

  // 4. Gabungkan semua data
  return {
    ...headerRows[0],
    details: details,
    inks: inks, // Ini yang akan ditangkap oleh inkDetails.value di Vue
  };
};

module.exports = {
  getAllHeaders,
  getDetailsByNomor,
  getInksByNomor,
  generateNewNomor,
  saveLhk,
  deleteLhk,
  getLaporanAgregasi,
  getRekapLhk,
  getExportLhkCrossTab,
  getDetailRekapMesin,
  getAllDataForExport,
  getOneLhk,
};
