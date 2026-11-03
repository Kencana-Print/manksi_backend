const pool = require("../../../config/database"); // Pastikan path ini benar
const { format } = require("date-fns");

// --- KONSTANTA ---
const NOMERATOR = "MMT-LHK-M";

// =========================================================================
// 1. FUNGSI READ (GET)
// =========================================================================

/**
 * Mengambil daftar master LHK Cetak
 * @param {string} startDate - Tanggal mulai (YYYY-MM-DD)
 * @param {string} endDate - Tanggal selesai (YYYY-MM-DD)
 * @param {string} search - Kata kunci pencarian (Nama SPK / Nomor)
 */

const getAllHeaders = async (startDate, endDate, search = "") => {
  const defaultStart = new Date();
  defaultStart.setDate(defaultStart.getDate() - 30);

  const tglMulai = startDate
    ? format(new Date(startDate), "yyyy-MM-dd")
    : format(defaultStart, "yyyy-MM-dd");
  const tglSelesai = endDate
    ? format(new Date(endDate), "yyyy-MM-dd")
    : format(new Date(), "yyyy-MM-dd");

  const params = [tglMulai, tglSelesai];

  let sql = `
        SELECT 
            t1.lnomor AS Nomor, 
            t1.lshift AS Shift, 
            t1.ltanggal AS Tanggal, 
            t1.lmesin AS Mesin, 
            t1.lspk_nomor AS NomorSPK, 
            t1.lstatus AS Status, -- Kolom status yang ditambahkan
            IF(rekap.lcd_lnomor IS NOT NULL, 'APPROVED', 'BELUM ACC') AS StatusAcc,
            rekap.lcd_lch_nomor AS NomorAcc,
            t2.spk_nama AS NamaOrder,
            t2.spk_kain,
            t2.spk_gramasi,
            ROUND(IFNULL(t2.spk_panjang,0),2) AS spk_panjang,
            IFNULL(t2.spk_lebar,0) AS spk_lebar,
            IFNULL(t2.spk_jumlah,0) AS JumlahOrder,
            
            -- Ambil data dari subquery x
            IFNULL(x.qtytotalcetak, 0) AS TotalCetak,
            IFNULL(x.panjang_bahan_awal, 0) AS PanjangBahanAwal,
            IFNULL(x.sisa_akhir, 0) AS SisaMeterAkhir,
            
            -- Logika Surplus/Minus: 
            -- Jika sisa_akhir < 0, berarti surplus pemakaian (bahan lebih panjang dari label)
            -- Kita tampilkan nilai positif dari minus tersebut sebagai angka surplus
            CASE 
                WHEN x.sisa_akhir < 0 THEN ABS(x.sisa_akhir)
                ELSE 0 
            END AS NilaiSurplus,
            
            CASE 
                WHEN x.sisa_akhir > 0 THEN x.sisa_akhir
                ELSE 0 
            END AS NilaiMinus,

            t1.lbarcode_roll AS Kode_bahan,
            t3.brg_nama AS nama_Bahan,
            IFNULL(t1.ljumlah_kolom,0) AS Tile,
            IFNULL(t1.lpanjang,0) AS UkuranCetak,
            IFNULL(t1.lfixed,0) AS Fixed,
            t1.loperator AS Operator,
            t1.lgdg_prod AS Gudang
        FROM tlhk_mesin_hdr t1
        LEFT JOIN tspk t2 ON t2.spk_nomor = t1.lspk_nomor
        LEFT JOIN tbarang_mmt t3 ON t3.brg_kode = t1.lbahan
        LEFT JOIN (
            SELECT 
                ld_lnomor,
                -- Total hasil cetak semua baris
                SUM(ld_qtyCetak1 + ld_qtyCetak2 + ld_qtyCetak3 + ld_qtyCetak4 + ld_qtyCetak5 + ld_qtyCetak6 + ld_qtyCetak7) AS qtytotalcetak,
                -- Ambil ld_ambilbahan dari urutan pertama (asumsi panjang roll awal)
                MAX(ld_ambilbahan) AS panjang_bahan_awal,
                -- Ambil sisa terakhir dari baris terakhir (urut terbesar)
                (SELECT ld_sisameter FROM tlhk_mesin_dtl d2 
                 WHERE d2.ld_lnomor = tlhk_mesin_dtl.ld_lnomor 
                 ORDER BY ld_urut DESC LIMIT 1) AS sisa_akhir
            FROM tlhk_mesin_dtl 
            GROUP BY ld_lnomor
        ) x ON x.ld_lnomor = t1.lnomor
        LEFT JOIN (
            SELECT lcd_lnomor, MAX(lcd_lch_nomor) AS lcd_lch_nomor
            FROM tlhk_cetakmmt_dtl
            WHERE lcd_lnomor IS NOT NULL AND lcd_lnomor <> ''
            GROUP BY lcd_lnomor
        ) rekap ON rekap.lcd_lnomor = t1.lnomor
        WHERE t1.ltanggal BETWEEN ? AND ?
    `;

  if (search) {
    // MENAMBAHKAN PENCARIAN BAHAN DAN BARCODE DI SINI
    sql += ` AND (
            t2.spk_nama LIKE ? 
            OR t1.lnomor LIKE ? 
            OR t1.lspk_nomor LIKE ? 
            OR t3.brg_nama LIKE ? 
            OR t1.lbarcode_roll LIKE ?
        ) `;
    const searchPattern = `%${search}%`;
    // Tambahkan parameter sesuai jumlah tanda tanya (?) baru
    params.push(
      searchPattern,
      searchPattern,
      searchPattern,
      searchPattern,
      searchPattern,
    );
  }

  sql += ` ORDER BY t1.ltanggal DESC, t1.lnomor DESC`;

  const [rows] = await pool.query(sql, params);
  return rows;
};

const getLookup = async (startDate, endDate, shift = "", search = "") => {
  const tglMulai = format(new Date(startDate), "yyyy-MM-dd");
  const tglSelesai = format(new Date(endDate), "yyyy-MM-dd");

  const params = [tglMulai, tglSelesai];

  let sql = `
        SELECT 
            t1.lnomor AS Nomor, 
            t1.lshift AS Shift, 
            t1.ltanggal AS Tanggal, 
            t1.lmesin AS Mesin, 
            t1.lspk_nomor AS NomorSPK, 
            t2.spk_nama AS NamaOrder,
            IFNULL(t2.spk_jumlah, 0) AS JumlahOrder,
            IFNULL(x.qtytotalcetak, 0) AS TotalCetak,
            IFNULL(x.totalpadding, 0) AS Padding,
            CAST(GREATEST(0, IFNULL(t2.spk_jumlah, 0) - IFNULL(all_prod.total_pernah_cetak, 0)) AS UNSIGNED) AS KurangCetak,
            t1.loperator AS Operator,
            
            /* --- STATUS UTAMA (POSTED / DRAFT) --- */
            IFNULL(t1.lstatus, 'DRAFT') AS Status,
            
            /* --- STATUS CLOSE (OPEN / CLOSED) --- */
            IF(rekap.lcd_lnomor IS NOT NULL, 'CLOSED', 'OPEN') AS StatusClose
            
        FROM tlhk_mesin_hdr t1
        LEFT JOIN tspk t2 ON t2.spk_nomor = t1.lspk_nomor
        LEFT JOIN (
            SELECT 
                ld_lnomor,
                SUM(ld_qtyCetak1 + ld_qtyCetak2 + ld_qtyCetak3 + ld_qtyCetak4 + ld_qtyCetak5 + ld_qtyCetak6 + ld_qtyCetak7) AS qtytotalcetak,
                -- PERBAIKAN DI SINI: Menjumlahkan padding atas dan samping
                SUM(IFNULL(ld_padding_atas, 0) + IFNULL(ld_padding_samping, 0)) AS totalpadding
            FROM tlhk_mesin_dtl 
            GROUP BY ld_lnomor
        ) x ON x.ld_lnomor = t1.lnomor
        
        LEFT JOIN (
            SELECT h.lspk_nomor, SUM(d.ld_qtyCetak1 + d.ld_qtyCetak2 + d.ld_qtyCetak3 + d.ld_qtyCetak4 + d.ld_qtyCetak5 + d.ld_qtyCetak6 + d.ld_qtyCetak7) as total_pernah_cetak
            FROM tlhk_mesin_hdr h
            JOIN tlhk_mesin_dtl d ON h.lnomor = d.ld_lnomor
            GROUP BY h.lspk_nomor
        ) all_prod ON all_prod.lspk_nomor = t1.lspk_nomor
        
        LEFT JOIN (
            -- LHK Mesin dianggap CLOSED bila sudah pernah diambil ke Approve Cetak.
            -- Referensi LHK Mesin disimpan di kolom lcd_lnomor (bukan lcd_lch_nomor,
            -- yang merupakan nomor header LHK Cetak MMT).
            SELECT DISTINCT lcd_lnomor 
            FROM tlhk_cetakmmt_dtl
        ) rekap ON rekap.lcd_lnomor = t1.lnomor

        WHERE t1.ltanggal BETWEEN ? AND ?
    `;

  if (shift) {
    sql += ` AND t1.lshift = ? `;
    params.push(shift);
  }

  if (search) {
    sql += ` AND (t2.spk_nama LIKE ? OR t1.lnomor LIKE ? OR t1.lspk_nomor LIKE ?) `;
    const searchPattern = `%${search}%`;
    params.push(searchPattern, searchPattern, searchPattern);
  }

  sql += ` ORDER BY t1.ltanggal DESC, t1.lnomor DESC`;

  const [rows] = await pool.query(sql, params);
  return rows;
};

const getLookupByNomor = async (nomor) => {
  try {
    // 1. Query Header (Diperluas dengan pencatatan snapshot bahan dari detail pertama)
    const sqlHeader = `
            SELECT 
                t1.lnomor AS Nomor, 
                t1.lshift AS Shift, 
                DATE_FORMAT(t1.ltanggal, '%Y-%m-%d') AS Tanggal,
                t1.lmesin AS Mesin, 
                t1.lbarcode_roll,
                t1.loperator AS Operator,
                t1.lgdg_prod AS Gudang,
                t1.lbahan AS Kode_bahan,
                t1.lstatus AS Status,
                IFNULL(t1.lpanjang_bs, 0) AS PanjangBS,
                IFNULL(t1.llebar_bs, 0) AS LebarBS,
                
                -- Mengambil Snapshot Ambil Bahan & Sisa Bahan dari baris detail pertama LHK ini
                IFNULL(dtl_first.ld_ambilbahan, 0) AS Panjang_Awal,
                IFNULL(dtl_first.ld_sisameter, 0) AS Sisa_Panjang
            FROM tlhk_mesin_hdr t1
            LEFT JOIN (
                SELECT ld_lnomor, ld_ambilbahan, ld_sisameter 
                FROM tlhk_mesin_dtl 
                WHERE ld_lnomor = ? 
                LIMIT 1
            ) dtl_first ON dtl_first.ld_lnomor = t1.lnomor
            WHERE t1.lnomor = ?
        `;
    const [headerRows] = await pool.query(sqlHeader, [nomor, nomor]);

    if (headerRows.length === 0) {
      throw new Error(`LHK Cetak nomor ${nomor} tidak ditemukan`);
    }

    // 2. Query Detail (Diperbaiki untuk mengambil ld_ambilbahan & ld_sisabahan per baris SPK)
    const sqlDetail = `
            SELECT 
                d.ld_lnomor AS lhkmesin,
                d.ld_spk_nomor AS spk_nomor,
                COALESCE(s.spk_nama, m.mkl_keterangan, d.ld_spk_nomor) AS nama_spk,
                t1.lshift AS shift,
                t1.loperator AS operator,
                t1.lmesin AS mesin,
                COALESCE(s.spk_jumlah, r.rencana, 0) AS jumlah,
                
                -- Mengambil ld_ambilbahan & ld_sisabahan
                IFNULL(d.ld_ambilbahan, 0) AS AmbilBahanPanjang,
                IFNULL(d.ld_ambilbahan_lebar, 0) AS AmbilBahanLebar,
                IFNULL(d.ld_sisameter, 0) AS Sisa_Panjang,
                IFNULL(d.ld_sisalebar, 0) AS Sisa_Lebar,

                IFNULL(akumulasi.total_cetak_sebelumnya, 0) AS sudahcetak,
                -- Sisa order SEBELUM LHK ini diinput (order - total cetak LHK sebelumnya)
                CAST(GREATEST(0, COALESCE(s.spk_jumlah, r.rencana, 0) - IFNULL(akumulasi.total_cetak_sebelumnya, 0)) AS UNSIGNED) AS kurangcetak_asli,
                IFNULL(d.ld_total_qtycetak, 0) AS totalcetak,
                ROUND(IFNULL(s.spk_panjang, 0) * IFNULL(s.spk_lebar, 0) * IFNULL(d.ld_total_qtycetak, 0), 2) AS m2_cetak,
                IFNULL(s.spk_panjang, 0) AS spk_panjang,
                IFNULL(s.spk_lebar, 0) AS spk_lebar,
                d.ld_keterangan,
                IFNULL(d.ld_padding_atas, 3) AS padding_atas,
                IFNULL(d.ld_padding_samping, 1) AS padding_samping,
                IFNULL(d.ld_tile, 1) AS Tile,
                
                -- Field Cetak 1 - 7
                IFNULL(d.ld_qtyCetak1, 0) AS J_Cetak1,
                IFNULL(d.ld_qtyCetak2, 0) AS J_Cetak2,
                IFNULL(d.ld_qtyCetak3, 0) AS J_Cetak3,
                IFNULL(d.ld_qtyCetak4, 0) AS J_Cetak4,
                IFNULL(d.ld_qtyCetak5, 0) AS J_Cetak5,
                IFNULL(d.ld_qtyCetak6, 0) AS J_Cetak6,
                IFNULL(d.ld_qtyCetak7, 0) AS J_Cetak7
            FROM tlhk_mesin_dtl d
            INNER JOIN tlhk_mesin_hdr t1 ON t1.lnomor = d.ld_lnomor
            LEFT JOIN (
                SELECT spk_nomor, spk_nama, spk_jumlah, spk_panjang, spk_lebar 
                FROM tspk
                UNION ALL
                SELECT mspk_nomor AS spk_nomor, mspk_nama AS spk_nama, mspk_jumlah AS spk_jumlah, mspk_panjang AS spk_panjang, mspk_lebar AS spk_lebar 
                FROM tmemospk
            ) s ON s.spk_nomor = d.ld_spk_nomor
            LEFT JOIN tmaklon_hdr m ON m.mkl_nomor = d.ld_spk_nomor
            LEFT JOIN (
                SELECT kd.mkld_mkl_nomor, SUM(kj.mkldj_estimasi_qty) AS rencana
                FROM tmaklon_dtl kd
                JOIN tmaklon_dtl_jadi kj ON kj.mkldj_mkld_id = kd.mkld_id
                GROUP BY kd.mkld_mkl_nomor
            ) r ON r.mkld_mkl_nomor = d.ld_spk_nomor
            LEFT JOIN (
                SELECT ld_spk_nomor, SUM(ld_total_qtycetak) AS total_cetak_sebelumnya 
                FROM tlhk_mesin_dtl 
                WHERE ld_lnomor < ? 
                GROUP BY ld_spk_nomor
            ) akumulasi ON akumulasi.ld_spk_nomor = d.ld_spk_nomor
            WHERE d.ld_lnomor = ?
            ORDER BY d.ld_urut ASC
        `;
    const [detailRows] = await pool.query(sqlDetail, [nomor, nomor]);

    for (const row of detailRows) {
      if ((!row.spk_panjang || Number(row.spk_panjang) === 0) && row.ld_keterangan && row.ld_keterangan.startsWith('DIM:')) {
        const dim = row.ld_keterangan.replace('DIM:', '').split('x');
        row.spk_panjang = parseFloat(dim[0]) || 0;
        row.spk_lebar = parseFloat(dim[1]) || 0;
      }
    }

    return {
      header: headerRows[0],
      details: detailRows,
    };
  } catch (error) {
    console.error("Error getLookupByNomor:", error);
    throw new Error(`Gagal mengambil data LHK Cetak: ${error.message}`);
  }
};

/**
 * Mengambil data dari MULTIPLE Nomor LHK Mesin (Multiple Choice)
 * @param {Array|string} nomor - Bisa berupa string tunggal atau Array nomor ['LHK01', 'LHK02']
 */
const getLookupByMultipleNomor = async (nomor) => {
  try {
    // 1. Pastikan input adalah array
    const daftarNomor = Array.isArray(nomor) ? nomor : [nomor];
    if (daftarNomor.length === 0) return null;

    // 2. Query Header
    const sqlHeader = `
            SELECT 
                t1.lmesin AS Mesin, 
                t1.lbarcode_roll,
                t1.loperator AS Operator,
                t1.lgdg_prod AS Gudang,
                t1.lbahan AS Kode_bahan,
                t3.brg_nama AS nama_Bahan,
                t1.lpanjang_terpakai,
                t1.ljumlah_kolom AS Tile
            FROM tlhk_mesin_hdr t1
            LEFT JOIN tbarang_mmt t3 ON t3.brg_kode = t1.lbahan
            WHERE t1.lnomor IN (?)
            LIMIT 1
        `;

    const [headerRows] = await pool.query(sqlHeader, [daftarNomor]);

    // 3. Query Detail (PERBAIKAN DI SINI: Menggunakan ld_padding_atas & ld_padding_samping)
    const sqlDetail = `
            SELECT 
                d.ld_lnomor AS referensi_lhk,
                h.lmesin AS mesin,
                h.loperator AS operator,
                h.lshift AS shift,
                d.ld_spk_nomor AS spk_nomor,
                s.spk_nama AS nama_spk,
                s.spk_jumlah AS jumlah_order,
                d.ld_qtyCetak1, d.ld_qtyCetak2, d.ld_qtyCetak3, 
                d.ld_qtyCetak4, d.ld_qtyCetak5, d.ld_qtyCetak6, d.ld_qtyCetak7,
                d.ld_total_qtycetak AS totalcetak,
                d.ld_total_metercetak AS cetakmeter,
                d.ld_tile AS tile,
                
                -- Field Padding Atas & Samping (Handling IFNULL agar aman dari null)
                IFNULL(d.ld_padding_atas, 3) AS padding_atas,
                IFNULL(d.ld_padding_atas, 3) AS Padding,
                IFNULL(d.ld_padding_samping, 1) AS padding_samping,
                
                -- Perhitungan m2: Panjang * Lebar * Qty
                ROUND(IFNULL(s.spk_panjang, 0) * IFNULL(s.spk_lebar, 0) * IFNULL(d.ld_total_qtycetak, 0), 2) AS ld_luas_m2
            FROM tlhk_mesin_dtl d
            INNER JOIN tlhk_mesin_hdr h ON h.lnomor = d.ld_lnomor
            LEFT JOIN tspk s ON s.spk_nomor = d.ld_spk_nomor
            WHERE d.ld_lnomor IN (?)
            ORDER BY d.ld_lnomor ASC, d.ld_urut ASC
        `;

    const [detailRows] = await pool.query(sqlDetail, [daftarNomor]);

    return {
      header: headerRows.length > 0 ? headerRows[0] : {},
      details: detailRows,
      summary: {
        total_meter_gabungan: detailRows.reduce(
          (sum, item) => sum + Number(item.cetakmeter || 0),
          0,
        ),
        jumlah_lhk_terpilih: daftarNomor.length,
      },
    };
  } catch (error) {
    console.error("Error getLookupByMultipleNomor:", error);
    throw new Error(`Gagal mengambil data multiple LHK: ${error.message}`);
  }
};

/**
 * Mengambil nomor urut maksimum dari bulan dan tahun saat ini
 * @param {Date} date - Tanggal untuk menentukan YYMM
 * @returns {Promise<string>} - Nomor LHK yang baru
 * @param {Object} headerData - Data header LHK (HARUS SUDAH DI MAPPING DARI FRONTEND)
 * @param {Array<Object>} detailsData - Array data detail LHK (HARUS SUDAH DI MAPPING DARI FRONTEND)
 * @param {string | null} existingNomor - Nomor LHK jika mode edit, null jika baru
 * @returns {Promise<Object>} - Hasil operasi simpan
 */
const generateNewNomor = async (date) => {
  const dateToUse = date instanceof Date ? date : new Date(date);

  const yymm = format(dateToUse, "yyMM");
  const prefixLike = `${NOMERATOR}.${yymm}.%`;

  const sqlMax = `
        SELECT MAX(CAST(SUBSTRING(lnomor, -4) AS UNSIGNED)) AS max_num
        FROM tlhk_mesin_hdr
        WHERE lnomor LIKE ?
    `;

  const [rows] = await pool.query(sqlMax, [prefixLike]);
  const maxNum = rows && rows.length > 0 ? rows[0].max_num || 0 : 0;

  let newSequence = maxNum + 1;
  const formattedSequence = String(newSequence).padStart(4, "0");

  const newNomor = `${NOMERATOR}.${yymm}.${formattedSequence}`;

  return newNomor;
};

/**
 * @param {Object} headerData - Data header termasuk lstatus ('DRAFT' atau 'POSTED')
 * @param {Array} detailsData - Data detail produksi
 * @param {String} existingNomor - Nomor jika mode edit
 */

const getNextSuffix = async (conn, originalBarcode) => {
  // Bersihkan originalBarcode jika tidak sengaja mengandung suffix lama (misal: BRC-01-A -> BRC-01)
  const baseBarcode = originalBarcode.replace(/-[A-Z]$/, "");

  // SQL mencari barcode di master stok yang polanya diawali baseBarcode diikuti -[A-Z]
  const sql = `
        SELECT mst_barcode 
        FROM tmasterstok_mmt 
        WHERE mst_barcode REGEXP ? 
        ORDER BY mst_barcode DESC LIMIT 1
    `;

  const pattern = `^${baseBarcode}-[A-Z]$`;
  const [rows] = await conn.query(sql, [pattern]);

  // Jika belum pernah ada pecahan afal dengan suffix huruf sebelumnya, buat akhiran -A
  if (rows.length === 0) {
    return `${baseBarcode}-A`;
  }

  // Jika sudah ada (contoh terakhir: MMT-LHK-001-A), ambil huruf terakhirnya
  const lastBarcode = rows[0].mst_barcode;
  const lastLetter = lastBarcode.slice(-1); // Mengambil 1 karakter paling ujung kanan

  // Hitung karakter alfabet berikutnya berdasarkan kode ASCII
  const nextCharCode = lastLetter.charCodeAt(0) + 1;

  let nextSuffix;
  if (nextCharCode > 90) {
    // Lebih dari 'Z'
    nextSuffix = "A1"; // Fallback penamaan jika pecahan sangat banyak
  } else {
    nextSuffix = String.fromCharCode(nextCharCode);
  }

  return `${baseBarcode}-${nextSuffix}`;
};

// =========================================================================
// HELPER: CASCADE SYNC LHK PENERUS
// Meng-update otomatis stok awal (ld_ambilbahan) LHK B jika LHK A diedit
// =========================================================================
const syncNextLhkChain = async (
  conn,
  barcode,
  currentLhkNomor,
  newSisaPanjang,
  newSisaLebar,
) => {
  // Cari LHK penerus yang menggunakan barcode sama dan dibuat setelah LHK saat ini
  const [nextLhks] = await conn.query(
    `
        SELECT d.ld_lnomor, h.ldate_create
        FROM tlhk_mesin_dtl d
        INNER JOIN tlhk_mesin_hdr h ON h.lnomor = d.ld_lnomor
        WHERE d.ld_barcode = ? 
          AND d.ld_lnomor != ?
          AND (
            h.ldate_create > (SELECT ldate_create FROM tlhk_mesin_hdr WHERE lnomor = ?)
            OR h.lnomor > ?
          )
        GROUP BY d.ld_lnomor, h.ldate_create
        ORDER BY h.ldate_create ASC, h.lnomor ASC
        LIMIT 1
    `,
    [barcode, currentLhkNomor, currentLhkNomor, currentLhkNomor],
  );

  if (nextLhks.length > 0) {
    const nextNomor = nextLhks[0].ld_lnomor;

    // 1. Update ld_ambilbahan LHK B dengan Sisa Baru LHK A
    await conn.query(
      `
            UPDATE tlhk_mesin_dtl 
            SET ld_ambilbahan = ?, 
                ld_ambilbahan_lebar = ?
            WHERE ld_lnomor = ?
        `,
      [newSisaPanjang, newSisaLebar, nextNomor],
    );

    // 2. Hitung Ulang sisa meter LHK B
    await conn.query(
      `
            UPDATE tlhk_mesin_dtl 
            SET ld_sisameter = GREATEST(0, ? - ld_total_metercetak)
            WHERE ld_lnomor = ?
        `,
      [newSisaPanjang, nextNomor],
    );

    // 3. Update stok mutasi LHK B di tmasterstok_mmt jika ada
    await conn.query(
      `
            UPDATE tmasterstok_mmt 
            SET mst_panjang = ? 
            WHERE mst_noreferensi = ? AND mst_stok_out = 1 AND mst_kategori != 'STOK AFAL'
        `,
      [newSisaPanjang, nextNomor],
    );
  }
};

// =========================================================================
// MAIN SERVICE: SAVE LHK
// =========================================================================
const saveLhk = async (
  headerData,
  detailsData,
  existingNomorInput = null,
  userLogin = "SYSTEM",
) => {
  const conn = await pool.getConnection();

  const existingNomor =
    existingNomorInput || headerData.existingNomor || headerData.nomor;
  let isEditMode = !!(existingNomor && existingNomor !== "AUTO");
  let finalNomor = isEditMode ? existingNomor : null;
  const currentStatus = headerData.lstatus || "DRAFT";

  if (!headerData || !Array.isArray(detailsData) || detailsData.length === 0) {
    if (conn) conn.release();
    throw new Error("Header atau Detail tidak boleh kosong.");
  }

  const getKategori = (panjang, lebar) => {
    if (panjang >= 3 && lebar >= 0.5) {
      return "RETUR";
    }
    return "SCRAP";
  };

  try {
    await conn.beginTransaction();

    const now = new Date();
    const dateToUse = headerData.ltanggal ? new Date(headerData.ltanggal) : now;
    const formattedDate = format(dateToUse, "yyyy-MM-dd");
    const formattedNow = format(now, "yyyy-MM-dd HH:mm:ss");
    const userAction =
      userLogin ||
      headerData.luser_modified ||
      headerData.luser_create ||
      "SYSTEM";

    const uniqueSpks = [
      ...new Set(detailsData.map((d) => d.nomor_spk).filter(Boolean)),
    ];
    const combinedSpkNomor = uniqueSpks.join(", ");

    if (!isEditMode) {
      finalNomor = await generateNewNomor(dateToUse);
    }

    // Pembacaan Ambil Bahan secara Fleksibel
    const checkMaxPanjang = detailsData.reduce((max, d) => {
      const val = Number(d.ambilBahanPanjang || d.ld_ambilbahan || 0);
      return Math.max(max, val);
    }, 0);

    if (currentStatus === "POSTED" && checkMaxPanjang <= 0) {
      throw new Error(
        "Gagal Simpan: Panjang bahan yang diambil tidak boleh 0. Scan ulang barcode material.",
      );
    }

    // Kalkulasi Total Meter Terpakai dari C1 s/d C7
    const totalPanjangTerpakai = detailsData.reduce((sum, d) => {
      const totQty =
        (Number(d.cetak1) || 0) +
        (Number(d.cetak2) || 0) +
        (Number(d.cetak3) || 0) +
        (Number(d.cetak4) || 0) +
        (Number(d.cetak5) || 0) +
        (Number(d.cetak6) || 0) +
        (Number(d.cetak7) || 0);
      return sum + totQty;
    }, 0);

    if (isEditMode) {
      // ==================== PROSES LOGGING DATA LAMA ====================
      const [oldHeader] = await conn.query(
        `SELECT * FROM tlhk_mesin_hdr WHERE lnomor = ?`,
        [finalNomor],
      );
      const [oldDetails] = await conn.query(
        `SELECT * FROM tlhk_mesin_dtl WHERE ld_lnomor = ?`,
        [finalNomor],
      );
      const [oldStock] = await conn.query(
        `SELECT * FROM tmasterstok_mmt WHERE mst_noreferensi = ?`,
        [finalNomor],
      );

      if (oldHeader.length > 0) {
        const snapshotDataLama = {
          header: oldHeader[0],
          details: oldDetails,
          stock: oldStock,
        };

        await conn.query(
          `
                    INSERT INTO tlhk_history_log (
                        lhl_nomor_lhk, lhl_action, lhl_data_old, lhl_user_action, lhl_date_action
                    ) VALUES (?, 'EDIT', ?, ?, ?)
                `,
          [
            finalNomor,
            JSON.stringify(snapshotDataLama),
            userAction,
            formattedNow,
          ],
        );
      }
      // ==================================================================

      await conn.query(
        `
                UPDATE tlhk_mesin_hdr SET
                    ltanggal = ?, lgdg_prod = ?, lspk_nomor = ?, lmesin = ?,
                    lshift = ?, loperator = ?, lbahan = ?, lbarcode_roll = ?,
                    lpanjang_terpakai = ?, ljumlah_kolom = ?, lfixed = 'Y',
                    ldate_modified = ?, luser_modified = ?, lstatus = ?,
                    lpanjang_bs = ?, llebar_bs = ?, lpanjang_afal = ?, llebar_afal = ?
                WHERE lnomor = ?
            `,
        [
          formattedDate,
          headerData.lgdg_prod || "GPM",
          combinedSpkNomor,
          headerData.lmesin,
          headerData.lshift || 1,
          headerData.loperator || "",
          headerData.lbahan,
          headerData.lbarcode_roll,
          totalPanjangTerpakai,
          headerData.ljumlah_kolom || 0,
          formattedNow,
          userAction,
          currentStatus,
          headerData.lpanjang_bs || 0,
          headerData.llebar_bs || 0,
          headerData.lpanjang_afal || 0,
          headerData.llebar_afal || 0,
          finalNomor,
        ],
      );

      await conn.query(`DELETE FROM tlhk_mesin_dtl WHERE ld_lnomor = ?`, [
        finalNomor,
      ]);
      await conn.query(
        `DELETE FROM tmasterstok_mmt WHERE mst_noreferensi = ?`,
        [finalNomor],
      );
    } else {
      await conn.query(
        `
                INSERT INTO tlhk_mesin_hdr (
                    lnomor, lspk_nomor, ltanggal, lmesin, lgdg_prod,
                    lshift, loperator, ldate_create, luser_create,
                    lbahan, lbarcode_roll, lpanjang_terpakai,
                    ljumlah_kolom, lstatus, lpanjang_bs, llebar_bs, lpanjang_afal, llebar_afal, lfixed
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Y')
            `,
        [
          finalNomor,
          combinedSpkNomor,
          formattedDate,
          headerData.lmesin,
          headerData.lgdg_prod || "GPM",
          headerData.lshift || 1,
          headerData.loperator || "",
          formattedNow,
          userAction,
          headerData.lbahan,
          headerData.lbarcode_roll,
          totalPanjangTerpakai,
          headerData.ljumlah_kolom || 0,
          currentStatus,
          headerData.lpanjang_bs || 0,
          headerData.llebar_bs || 0,
          headerData.lpanjang_afal || 0,
          headerData.llebar_afal || 0,
        ],
      );
    }

    let maxAmbilPanjang = 0;
    let finalSisaMeter = 0;
    let finalSisaLebar = 0;
    const usedBarcode = headerData.lbarcode_roll;
    const usedKodeBahan = headerData.lbahan;

    for (let i = 0; i < detailsData.length; i++) {
      const d = detailsData[i];
      const urut = i + 1;
      const totalCetak =
        (Number(d.cetak1) || 0) +
        (Number(d.cetak2) || 0) +
        (Number(d.cetak3) || 0) +
        (Number(d.cetak4) || 0) +
        (Number(d.cetak5) || 0) +
        (Number(d.cetak6) || 0) +
        (Number(d.cetak7) || 0);

      const pAmbil = Number(d.ambilBahanPanjang || d.ld_ambilbahan || 0);
      const lAmbil = Number(d.ambilBahanLebar || d.ld_ambilbahan_lebar || 0);
      const pAtas = Number(d.padding_atas || 3);
      const pSamping = Number(d.padding_samping || 1);
      const isMaklon = d.is_maklon || String(d.nomor_spk || '').toUpperCase().startsWith('MKL');
      const ldKeterangan = isMaklon && Number(d.panjang_spk || 0) > 0 && Number(d.lebar_spk || 0) > 0
        ? `DIM:${d.panjang_spk}x${d.lebar_spk}`
        : (d.keterangan || "''");

      await conn.query(
        `
    INSERT INTO tlhk_mesin_dtl (
        ld_lnomor, ld_urut, ld_spk_nomor, ld_ambilbahan, ld_ambilbahan_lebar,
        ld_qtyCetak1, ld_qtyCetak2, ld_qtyCetak3, ld_qtyCetak4, ld_qtyCetak5, ld_qtyCetak6, ld_qtyCetak7,
        ld_total_qtycetak, ld_total_metercetak, ld_sisameter, ld_sisalebar,
        ld_keterangan, ld_bahan, ld_barcode, ld_tile, ld_luas_m2, ld_padding_atas, ld_padding_samping
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
        [
          finalNomor,
          urut,
          d.nomor_spk || "",
          pAmbil,
          lAmbil,
          d.cetak1 || 0,
          d.cetak2 || 0,
          d.cetak3 || 0,
          d.cetak4 || 0,
          d.cetak5 || 0,
          d.cetak6 || 0,
          d.cetak7 || 0,
          totalCetak,
          totalCetak,
          d.sisabahan || 0,
          d.sisabahanlebar || 0,
          ldKeterangan,
          usedKodeBahan,
          usedBarcode,
          d.tile || 1,
          d.luasm2 || 0,
          pAtas,
          pSamping,
        ],
      );

      if (pAmbil > maxAmbilPanjang) maxAmbilPanjang = pAmbil;
      finalSisaMeter = Number(d.sisabahan || 0);
      finalSisaLebar = Number(d.sisabahanlebar || 0);
    }

    let createdAfalBarcode = null;

    if (currentStatus === "POSTED") {
      if (usedBarcode && maxAmbilPanjang > 0) {
        const [oldStockData] = await conn.query(
          `
                    SELECT mst_hargabeli, mst_satuan_harga, mst_lebar 
                    FROM tmasterstok_mmt 
                    WHERE mst_barcode = ? 
                    LIMIT 1
                `,
          [usedBarcode],
        );

        const hargaBeliLama =
          oldStockData.length > 0 ? oldStockData[0].mst_hargabeli : 0;
        const satuanHargaLama =
          oldStockData.length > 0 ? oldStockData[0].mst_satuan_harga : null;
        const lebarAwal =
          oldStockData.length > 0 ? oldStockData[0].mst_lebar : 0;

        const finalLebarInput = finalSisaLebar > 0 ? finalSisaLebar : lebarAwal;
        const initialLebar = detailsData[0].ambilBahanLebar || lebarAwal;

        // 1. MUTASI KELUAR (AMBIL STOK BARCODE TERSEBUT)
        await conn.query(
          `
                    INSERT INTO tmasterstok_mmt (
                        mst_brg_kode, mst_gdg_kode, mst_stok_in, mst_stok_out,
                        mst_panjang, mst_lebar, mst_spk_nomor, mst_noreferensi,
                        mst_hargabeli, mst_satuan_harga, mst_tanggal, mst_barcode, mst_kategori
                    ) VALUES (?, ?, 0, 1, ?, ?, ?, ?, ?, ?, ?, ?, 'RETUR')
                `,
          [
            usedKodeBahan,
            headerData.lgdg_prod || "GPM",
            maxAmbilPanjang,
            initialLebar,
            combinedSpkNomor,
            finalNomor,
            hargaBeliLama,
            satuanHargaLama,
            formattedDate,
            usedBarcode,
          ],
        );

        // 2. MUTASI MASUK (SISA UTAMA SETELAH CETAK)
        if (finalSisaMeter > 0) {
          const kategoriSisa = getKategori(finalSisaMeter, finalLebarInput);
          await conn.query(
            `
                        INSERT INTO tmasterstok_mmt (
                            mst_brg_kode, mst_gdg_kode, mst_stok_in, mst_stok_out,
                            mst_panjang, mst_lebar, mst_spk_nomor, mst_noreferensi,
                            mst_hargabeli, mst_satuan_harga, mst_tanggal, mst_barcode,
                            mst_kategori
                        ) VALUES (?, ?, 1, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    `,
            [
              usedKodeBahan,
              headerData.lgdg_prod || "GPM",
              finalSisaMeter,
              finalLebarInput,
              combinedSpkNomor,
              finalNomor,
              hargaBeliLama,
              satuanHargaLama,
              formattedDate,
              usedBarcode,
              kategoriSisa,
            ],
          );
        }

        // 3. MUTASI MASUK (STOK AFAL BARU DARI SISA SAMPING)
        const afalP = Number(headerData.lpanjang_afal || 0);
        const afalL = Number(headerData.llebar_afal || 0);

        if (afalP > 0 && afalL > 0) {
          const kategoriAfal = getKategori(afalP, afalL);
          const newAfalBarcode = await getNextSuffix(conn, usedBarcode);
          createdAfalBarcode = newAfalBarcode;

          await conn.query(
            `
                        INSERT INTO tmasterstok_mmt (
                            mst_brg_kode, mst_gdg_kode, mst_stok_in, mst_stok_out,
                            mst_panjang, mst_lebar, mst_spk_nomor, mst_noreferensi,
                            mst_hargabeli, mst_satuan_harga, mst_tanggal, mst_barcode,
                            mst_kategori
                        ) VALUES (?, ?, 1, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    `,
            [
              usedKodeBahan,
              headerData.lgdg_prod || "GPM",
              afalP,
              afalL,
              "STOK AFAL",
              finalNomor,
              hargaBeliLama,
              satuanHargaLama,
              formattedDate,
              newAfalBarcode,
              kategoriAfal,
            ],
          );
        }
      }
    }

    // =========================================================================
    // 🔥 CASCADE SYNC KE LHK PENERUS
    // =========================================================================
    if (isEditMode && usedBarcode) {
      await syncNextLhkChain(
        conn,
        usedBarcode,
        finalNomor,
        finalSisaMeter,
        finalSisaLebar,
      );
    }

    await conn.commit();

    return {
      success: true,
      isEdit: isEditMode,
      nomor: finalNomor,
      status: currentStatus,
      message: `LHK ${finalNomor} berhasil ${isEditMode ? "diperbarui" : "disimpan"}.`,
      afalData: createdAfalBarcode
        ? {
            barcode: createdAfalBarcode,
            panjang: Number(headerData.lpanjang_afal || 0),
            lebar: Number(headerData.llebar_afal || 0),
          }
        : null,
    };
  } catch (err) {
    if (conn) await conn.rollback();
    console.error("Error Save LHK:", err);
    throw new Error(err.message || "Gagal Simpan LHK");
  } finally {
    if (conn) conn.release();
  }
};

/**
 * Menghapus LHK Header dan Detail
 * @param {string} nomor - Nomor LHK
 */
const deleteLhk = async (nomor) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query("DELETE FROM tlhk_mesin_dtl WHERE ld_lnomor = ?", [nomor]);
    await conn.query("DELETE FROM tlhk_mesin_hdr WHERE lnomor = ?", [nomor]);

    await conn.commit();
    return { success: true, message: "Berhasil dihapus." };
  } catch (error) {
    await conn.rollback();
    console.error("Gagal Hapus LHK:", error);
    throw new Error("Gagal Hapus.");
  } finally {
    conn.release();
  }
};

/**
 * Fungsi untuk menentukan suffix alfabet berikutnya (-A, -B, dst)
 */

// =========================================================================
// 2. FUNGSI LAPORAN & AGREGASI (tlhk_mesin_hdr & tlhk_mesin_dtl)
// =========================================================================

/**
 * Mendapatkan ringkasan statistik produksi untuk Dashboard
 */
const getLaporanAgregasi = async (startDate, endDate) => {
  const tglMulai = format(new Date(startDate), "yyyy-MM-dd");
  const tglSelesai = format(new Date(endDate), "yyyy-MM-dd");

  // 1. Per Mesin (Total m2 per mesin)
  const sqlMesin = `
        SELECT h.lmesin as Mesin, SUM(d.ld_luas_m2) as Total_m2
        FROM tlhk_mesin_dtl d
        JOIN tlhk_mesin_hdr h ON d.ld_lnomor = h.lnomor
        WHERE h.ltanggal BETWEEN ? AND ?
        GROUP BY h.lmesin
    `;

  // 2. Per Hari (Tren produksi)
  const sqlHarian = `
        SELECT DATE_FORMAT(h.ltanggal, '%Y-%m-%d') as Tanggal, 
               SUM(d.ld_luas_m2) as Total_m2
        FROM tlhk_mesin_hdr h
        JOIN tlhk_mesin_dtl d ON h.lnomor = d.ld_lnomor
        WHERE h.ltanggal BETWEEN ? AND ?
        GROUP BY h.ltanggal
        ORDER BY h.ltanggal ASC
    `;

  // 3. Per SPK (Top 10 SPK terbanyak dikerjakan)
  const sqlSPK = `
        SELECT d.ld_spk_nomor as lcd_spk_nomor, s.spk_nama, 
               SUM(d.ld_total_qtycetak) as Total_Qty,
               SUM(d.ld_luas_m2) as Total_m2
        FROM tlhk_mesin_dtl d
        LEFT JOIN tspk s ON d.ld_spk_nomor = s.spk_nomor
        JOIN tlhk_mesin_hdr h ON d.ld_lnomor = h.lnomor
        WHERE h.ltanggal BETWEEN ? AND ?
        GROUP BY d.ld_spk_nomor, s.spk_nama
        ORDER BY Total_m2 DESC
        LIMIT 10
    `;

  const [resMesin] = await pool.query(sqlMesin, [tglMulai, tglSelesai]);
  const [resHarian] = await pool.query(sqlHarian, [tglMulai, tglSelesai]);
  const [resSPK] = await pool.query(sqlSPK, [tglMulai, tglSelesai]);

  return { perMesin: resMesin, perHari: resHarian, perSPK: resSPK };
};

/**
 * Rekap LHK untuk tampilan tabel report
 */
const getRekapLhk = async (startDate, endDate) => {
  const tglMulai = format(new Date(startDate), "yyyy-MM-dd");
  const tglSelesai = format(new Date(endDate), "yyyy-MM-dd");

  // 1. Rekap Per Mesin (Ditambah Join ke Master Mesin)
  const sqlMesin = `
        SELECT 
            d.lcd_jns_mesin AS Mesin,
            COUNT(DISTINCT d.lcd_spk_nomor) AS Jml_SPK,
            SUM(d.lcd_qty_Cetak) AS Total_Pcs,
            ROUND(SUM(d.lcd_qty_Cetak * IFNULL(s.spk_panjang, 0) * IFNULL(s.spk_lebar, 0)), 1) AS Total_Meter,
            /* Ambil Kapasitas dari tabel master mesin */
            IFNULL(m.msn_kapasitas, 0) AS Kapasitas 
        FROM tlhk_cetakmmt_dtl d
        INNER JOIN tlhk_cetakmmt_hdr h ON d.lcd_lch_nomor = h.lch_nomor
        LEFT JOIN tspk s ON s.spk_nomor = d.lcd_spk_nomor
        /* JOIN ke tabel master mesin berdasarkan kode/nama mesin */
        LEFT JOIN tmesin_mmt m ON m.msn_nama = d.lcd_jns_mesin 
        WHERE h.lch_tanggal BETWEEN ? AND ?
        GROUP BY d.lcd_jns_mesin, m.msn_kapasitas
        ORDER BY Total_Meter DESC
    `;

  const sqlHarian = `
        SELECT 
            DATE_FORMAT(h.lch_tanggal, '%Y-%m-%d') AS Tanggal,
            d.lcd_jns_mesin AS Mesin,
            ROUND(SUM(d.lcd_qty_Cetak * IFNULL(s.spk_panjang, 0) * IFNULL(s.spk_lebar, 0)), 1) AS Total_Meter
        FROM tlhk_cetakmmt_hdr h
        INNER JOIN tlhk_cetakmmt_dtl d ON h.lch_nomor = d.lcd_lch_nomor
        LEFT JOIN tspk s ON s.spk_nomor = d.lcd_spk_nomor
        WHERE h.lch_tanggal BETWEEN ? AND ?
        GROUP BY h.lch_tanggal, d.lcd_jns_mesin
        ORDER BY h.lch_tanggal ASC, d.lcd_jns_mesin ASC
    `;

  const [rekapMesin] = await pool.query(sqlMesin, [tglMulai, tglSelesai]);
  const [rekapHarian] = await pool.query(sqlHarian, [tglMulai, tglSelesai]);

  return {
    rekapMesin,
    rekapHarian,
  };
};

/**
 * Export Excel CrossTab (Mesin vs Tanggal)
 */
const getExportLhkCrossTab = async (month, year) => {
  const sql = `
        SELECT 
            h.lmesin AS Mesin,
            DAY(h.ltanggal) AS Hari,
            SUM(d.ld_luas_m2) AS Total_Meter
        FROM tlhk_mesin_dtl d
        JOIN tlhk_mesin_hdr h ON d.ld_lnomor = h.lnomor
        WHERE MONTH(h.ltanggal) = ? AND YEAR(h.ltanggal) = ?
        GROUP BY h.lmesin, DAY(h.ltanggal)
    `;

  const [rows] = await pool.query(sql, [month, year]);
  return rows;
};

/**
 * Export data detail lengkap ke Excel/CSV
 */
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
      filterMesin = ` AND h.lmesin IN (${mesinArray.map(() => "?").join(",")})`;
      params.push(...mesinArray);
    }
  }

  const sql = `
    SELECT 
        h.lnomor AS Nomor_LHK, -- Tetap Nomor_LHK agar sesuai grouping frontend
        DATE_FORMAT(h.ltanggal, '%d/%m/%Y') AS Tanggal,
        h.lshift AS Shift_LHK,
        h.loperator AS Operator_LHK,
        g.gdg_nama AS Gudang,
        d.ld_spk_nomor AS Nomor_SPK,
        s.spk_nama AS Nama_Order, -- Alias ini harus sama dengan LHK Cetak
        h.lmesin AS Mesin,
        d.ld_total_qtycetak AS Qty_Cetak,
        IFNULL(s.spk_panjang, 0) AS Panjang,
        IFNULL(s.spk_lebar, 0) AS Lebar,
        d.ld_luas_m2 AS m2_cetak -- Alias ini penting untuk perhitungan total per baris
    FROM tlhk_mesin_hdr h
    JOIN tlhk_mesin_dtl d ON h.lnomor = d.ld_lnomor
    LEFT JOIN tGUDANG g ON g.gdg_kode = h.lgdg_prod
    LEFT JOIN tspk s ON s.spk_nomor = d.ld_spk_nomor
    WHERE h.ltanggal BETWEEN ? AND ?
    ${filterMesin}
    ORDER BY h.ltanggal DESC, h.lnomor DESC, d.ld_urut ASC
`;

  const [rows] = await pool.query(sql, params);
  return rows;
};

/**
 * Mendapatkan detail pengerjaan SPK per mesin tertentu
 */
const getDetailRekapMesin = async (startDate, endDate, mesin) => {
  const tglMulai = format(new Date(startDate), "yyyy-MM-dd");
  const tglSelesai = format(new Date(endDate), "yyyy-MM-dd");

  const sql = `
        SELECT 
            d.ld_spk_nomor AS No_SPK,
            s.spk_nama AS Nama_Order,
            SUM(d.ld_total_qtycetak) AS Total_Pcs,
            SUM(d.ld_luas_m2) AS Total_Meter
        FROM tlhk_mesin_dtl d
        JOIN tlhk_mesin_hdr h ON d.ld_lnomor = h.lnomor
        LEFT JOIN tspk s ON s.spk_nomor = d.ld_spk_nomor
        WHERE h.ltanggal BETWEEN ? AND ?
          AND h.lmesin = ?
        GROUP BY d.ld_spk_nomor, s.spk_nama
        ORDER BY Total_Meter DESC
    `;

  const [rows] = await pool.query(sql, [tglMulai, tglSelesai, mesin]);
  return rows;
};

/**
 * Mengambil data LHK Cetak secara mendalam berdasarkan nomor
 * Digunakan untuk Form Edit atau Detail View
 */
const getDetailsByNomor = async (nomor) => {
  try {
    // 1. Ambil Data Header
    const sqlHeader = `
            SELECT 
                t1.lnomor AS Nomor, 
                t1.lshift AS Shift, 
                DATE_FORMAT(t1.ltanggal, '%Y-%m-%d') AS Tanggal,
                t1.lmesin AS Mesin, 
                t1.lgdg_prod AS Gudang,
                t1.loperator AS Operator,
                t1.lbahan AS Kode_bahan,
                t3.brg_nama AS Nama_bahan,
                t1.lbarcode_roll AS Barcode,
                t1.lstatus AS Status,
                t1.ljumlah_kolom AS Tile_Header,
                IFNULL(t1.lpanjang_bs, 0) AS PanjangBS,
                IFNULL(t1.llebar_bs, 0) AS LebarBS,
                IFNULL(t1.lpanjang_afal, 0) AS PanjangAfal,
                IFNULL(t1.llebar_afal, 0) AS LebarAfal
            FROM tlhk_mesin_hdr t1
            LEFT JOIN tbarang_mmt t3 ON t3.brg_kode = t1.lbahan
            WHERE t1.lnomor = ?
        `;
    const [headerRows] = await pool.query(sqlHeader, [nomor]);

    if (headerRows.length === 0) {
      throw new Error(`Data LHK dengan nomor ${nomor} tidak ditemukan`);
    }

    // 2. Ambil Data Detail beserta info SPK, akumulasi, DAN data cetak 1-7
    const sqlDetail = `
            SELECT 
                d.ld_urut AS urut,
                d.ld_spk_nomor AS nomor_spk,
                COALESCE(s.spk_nama, m.mkl_keterangan, d.ld_spk_nomor) AS nama_spk,
                IFNULL(s.spk_jumlah, IFNULL(r.rencana, 0)) AS qty_order,
                COALESCE(s.spk_panjang, 0) AS spk_panjang,
                COALESCE(s.spk_lebar, 0) AS spk_lebar,
                d.ld_keterangan,
                
                -- Field Cetak yang disesuaikan dengan saveLhk
                IFNULL(d.ld_qtyCetak1, 0) AS cetak1,
                IFNULL(d.ld_qtyCetak2, 0) AS cetak2,
                IFNULL(d.ld_qtyCetak3, 0) AS cetak3,
                IFNULL(d.ld_qtyCetak4, 0) AS cetak4,
                IFNULL(d.ld_qtyCetak5, 0) AS cetak5,
                IFNULL(d.ld_qtyCetak6, 0) AS cetak6,
                IFNULL(d.ld_qtyCetak7, 0) AS cetak7,

                -- Field Ambil Bahan & Sisa Bahan untuk kebutuhan edit/view
                IFNULL(d.ld_ambilbahan, 0) AS ambilBahanPanjang,
                IFNULL(d.ld_ambilbahan_lebar, 0) AS ambilBahanLebar,
                IFNULL(d.ld_sisameter, 0) AS sisabahan,
                IFNULL(d.ld_sisalebar, 0) AS sisabahanlebar,
                IFNULL(d.ld_luas_m2, 0) AS luasm2,
                IFNULL(d.ld_padding_atas, 3) AS padding_atas,
                IFNULL(d.ld_padding_samping, 1) AS padding_samping,

                -- Akumulasi sebelum LHK ini
                IFNULL((SELECT SUM(dx.ld_total_qtycetak) 
                  FROM tlhk_mesin_dtl dx 
                  WHERE dx.ld_spk_nomor = d.ld_spk_nomor 
                  AND dx.ld_lnomor < d.ld_lnomor), 0) AS sudah_cetak_sebelumnya,
                  
                d.ld_total_qtycetak AS totalcetak,
                
                -- RUMUS KURANG CETAK (SISA)
                CAST(GREATEST(0, IFNULL(s.spk_jumlah, IFNULL(r.rencana, 0)) - (
                    IFNULL((SELECT SUM(dx.ld_total_qtycetak) 
                            FROM tlhk_mesin_dtl dx 
                            WHERE dx.ld_spk_nomor = d.ld_spk_nomor 
                            AND dx.ld_lnomor < d.ld_lnomor), 0) + d.ld_total_qtycetak
                )) AS UNSIGNED) AS kurang_cetak,
                
                d.ld_total_metercetak AS cetakmeter,
                d.ld_tile AS tile
            FROM tlhk_mesin_dtl d
            LEFT JOIN tspk s ON s.spk_nomor = d.ld_spk_nomor
            LEFT JOIN tmaklon_hdr m ON m.mkl_nomor = d.ld_spk_nomor
            LEFT JOIN (
              SELECT kd.mkld_mkl_nomor, SUM(kj.mkldj_estimasi_qty) AS rencana
              FROM tmaklon_dtl kd
              JOIN tmaklon_dtl_jadi kj ON kj.mkldj_mkld_id = kd.mkld_id
              GROUP BY kd.mkld_mkl_nomor
            ) r ON r.mkld_mkl_nomor = d.ld_spk_nomor
            WHERE d.ld_lnomor = ?
            ORDER BY d.ld_urut ASC
        `;
    const [detailRows] = await pool.query(sqlDetail, [nomor]);

    for (const row of detailRows) {
      if ((!row.spk_panjang || Number(row.spk_panjang) === 0) && row.ld_keterangan && row.ld_keterangan.startsWith('DIM:')) {
        const dim = row.ld_keterangan.replace('DIM:', '').split('x');
        row.spk_panjang = parseFloat(dim[0]) || 0;
        row.spk_lebar = parseFloat(dim[1]) || 0;
      }
    }

    return {
      header: headerRows[0],
      details: detailRows,
    };
  } catch (error) {
    console.error("Error getLhkByNomor:", error);
    throw new Error(`Gagal mengambil detail LHK: ${error.message}`);
  }
};

module.exports = {
  getAllHeaders,
  getLookup,
  getLookupByNomor,
  generateNewNomor,
  getLookupByMultipleNomor,
  deleteLhk,
  saveLhk,
  getLaporanAgregasi,
  getRekapLhk,
  getExportLhkCrossTab,
  getAllDataForExport,
  getDetailRekapMesin,
  getDetailsByNomor,
};
