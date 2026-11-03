const pool = require('../../../config/database');
const { format } = require("date-fns");

// Tanggal kosong/invalid => filter tanggal di-skip (tanpa klausa zero-date).
const isValidDate = (v) =>
  typeof v === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(v) &&
  !isNaN(new Date(v).getTime());

const normDate = (v) =>
  isValidDate(v) ? format(new Date(v), "yyyy-MM-dd") : null;

// =========================================================================
// HELPER: SUBQUERY GABUNGAN (MMT, TEKSTIL, SUBLIM, FINISHING, PAPERPRINT, SUBLIM_RTR)
// hasDate=false => tiap cabang memakai 1=1 (tanpa filter tanggal, tanpa zero-date)
// =========================================================================
const getUnifiedLhkQuery = (hasDate = true) => {
  const dc = (col) => (hasDate ? `${col} BETWEEN ? AND ?` : "1=1");
  return `
        SELECT 
            'MMT' AS Kategori,
            h.lch_nomor AS Nomor_LHK,
            h.lch_tanggal AS Tanggal,
            h.lch_shift AS Shift,
            h.lch_operator AS Operator,
            h.lch_gdg_prod AS Kode_Gudang,
            g.gdg_nama AS Nama_Gudang,
            d.lcd_jns_mesin AS Mesin,
            d.lcd_spk_nomor AS Nomor_SPK,
            IFNULL(x.spk_nama, '-') AS Nama_Order,
            d.lcd_qty_cetak AS Qty_Cetak,
            IFNULL(x.spk_panjang, 0) AS Panjang,
            IFNULL(x.spk_lebar, 0) AS Lebar,
            ROUND(d.lcd_qty_cetak * IFNULL(x.spk_panjang, 0) * IFNULL(x.spk_lebar, 0), 2) AS Total_m2
        FROM tlhk_cetakmmt_hdr h
        JOIN tlhk_cetakmmt_dtl d ON h.lch_nomor = d.lcd_lch_nomor
        LEFT JOIN tGUDANG g ON g.gdg_kode = h.lch_gdg_prod
        LEFT JOIN (
            SELECT spk_nomor, spk_nama, spk_panjang, spk_lebar FROM tspk
            UNION ALL
            SELECT mspk_nomor, mspk_nama, mspk_panjang, mspk_lebar FROM tmemospk
        ) x ON x.spk_nomor = d.lcd_spk_nomor
        WHERE ${dc("h.lch_tanggal")}

        UNION ALL

        SELECT 
            'TEKSTIL' AS Kategori,
            h.lth_nomor AS Nomor_LHK,
            h.lth_tanggal AS Tanggal,
            h.lth_shift AS Shift,
            h.lth_user_create AS Operator,
            h.lth_gdg_prod AS Kode_Gudang,
            g.gdg_nama AS Nama_Gudang,
            d.ltd_jns_mesin AS Mesin,
            d.ltd_spk_nomor AS Nomor_SPK,
            IFNULL(x.spk_nama, '-') AS Nama_Order,
            d.ltd_qty_cetak AS Qty_Cetak,
            IFNULL(x.spk_panjang, 0) AS Panjang,
            IFNULL(x.spk_lebar, 0) AS Lebar,
            ROUND(d.ltd_qty_cetak * IFNULL(x.spk_panjang, 0) * IFNULL(x.spk_lebar, 0), 2) AS Total_m2
        FROM tlhk_tekstilmmt_hdr h
        JOIN tlhk_tekstilmmt_dtl d ON h.lth_nomor = d.ltd_lth_nomor
        LEFT JOIN tGUDANG g ON g.gdg_kode = h.lth_gdg_prod
        LEFT JOIN (
            SELECT spk_nomor, spk_nama, spk_panjang, spk_lebar FROM tspk
            UNION ALL
            SELECT mspk_nomor, mspk_nama, mspk_panjang, mspk_lebar FROM tmemospk
        ) x ON x.spk_nomor = d.ltd_spk_nomor
        WHERE ${dc("h.lth_tanggal")}

        UNION ALL

        SELECT 
            'PAPERPRINT' AS Kategori,
            h.lsb_nomor AS Nomor_LHK,
            h.lsb_tanggal AS Tanggal,
            h.lsb_shift AS Shift,
            h.lsb_user_create AS Operator,
            h.lsb_gdg_kode AS Kode_Gudang,
            g.gdg_nama AS Nama_Gudang,
            IFNULL(d.lsbd_lokasi, 'SB01') AS Mesin,
            d.lsbd_spk_nomor AS Nomor_SPK,
            IF(LENGTH(IFNULL(d.lsbd_spk_nama, '')) > 0, d.lsbd_spk_nama, IFNULL(x.spk_nama, '-')) AS Nama_Order,
            d.lsbd_jumlah AS Qty_Cetak,
            IFNULL(d.lsbd_panjang, 0) AS Panjang,
            IFNULL(d.lsbd_lebar, 0) AS Lebar,
            IFNULL(d.lsbd_j_meter, (d.lsbd_panjang * d.lsbd_lebar * d.lsbd_jumlah)) AS Total_m2
        FROM tlhk_sublim_hdr h
        JOIN tlhk_sublim_dtl d ON h.lsb_nomor = d.lsbd_lsb_nomor
        LEFT JOIN tGUDANG g ON g.gdg_kode = h.lsb_gdg_kode
        LEFT JOIN (
            SELECT spk_nomor, spk_nama FROM tspk
            UNION ALL
            SELECT mspk_nomor, mspk_nama FROM tmemospk
        ) x ON x.spk_nomor = d.lsbd_spk_nomor
        WHERE ${dc("h.lsb_tanggal")}

        UNION ALL

        SELECT 
            'FINISHING' AS Kategori,
            h.lfh_nomor AS Nomor_LHK,
            h.lfh_tanggal AS Tanggal,
            h.lfh_shift AS Shift,
            h.lfh_user_create AS Operator,
            h.lfh_gdg_prod AS Kode_Gudang,
            g.gdg_nama AS Nama_Gudang,
            'FINISHING' AS Mesin,
            d.lfd_spk_nomor AS Nomor_SPK,
            IFNULL(x.spk_nama, '-') AS Nama_Order,
            d.lfd_j_potong AS Qty_Cetak,
            IFNULL(x.spk_panjang, 0) AS Panjang,
            IFNULL(x.spk_lebar, 0) AS Lebar,
            ROUND(d.lfd_j_potong * IFNULL(x.spk_panjang, 0) * IFNULL(x.spk_lebar, 0), 2) AS Total_m2
        FROM tlhk_finishingmmt_hdr h
        JOIN tlhk_finishingmmt_dtl d ON h.lfh_nomor = d.lfd_lfh_nomor
        LEFT JOIN tGUDANG g ON g.gdg_kode = h.lfh_gdg_prod
        LEFT JOIN (
            SELECT spk_nomor, spk_nama, spk_panjang, spk_lebar FROM tspk
            UNION ALL
            SELECT mspk_nomor, mspk_nama, mspk_panjang, mspk_lebar FROM tmemospk
        ) x ON x.spk_nomor = d.lfd_spk_nomor
        WHERE ${dc("h.lfh_tanggal")}

        UNION ALL

        SELECT 
            'SUBLIM' AS Kategori,
            h.lr_nomor AS Nomor_LHK,
            h.lr_tanggal AS Tanggal,
            '-' AS Shift,
            '-' AS Operator,
            h.lr_gdg_kode AS Kode_Gudang,
            g.gdg_nama AS Nama_Gudang,
            IFNULL(d.lrd_lokasi, 'SB01') AS Mesin,
            d.lrd_spk_nomor AS Nomor_SPK,
            IFNULL(d.lrd_spk_nama, '-') AS Nama_Order,
            d.lrd_jumlah AS Qty_Cetak,
            IFNULL(d.lrd_panjang, 0) AS Panjang,
            IFNULL(d.lrd_lebar, 0) AS Lebar,
            (d.lrd_panjang * d.lrd_lebar * d.lrd_jumlah) AS Total_m2
        FROM tlhk_rtr_hdr h
        JOIN tlhk_rtr_dtl d ON h.lr_nomor = d.lrd_lr_nomor
        LEFT JOIN tGUDANG g ON g.gdg_kode = h.lr_gdg_kode
        WHERE ${dc("h.lr_tanggal")}
    `;
};

// =========================================================================
// FUNGSI LAPORAN & AGREGASI
// =========================================================================

const getLaporanAgregasi = async (startDate, endDate) => {
  const tglMulai = normDate(startDate);
  const tglSelesai = normDate(endDate);
  const hasDate = !!(tglMulai && tglSelesai);
  const dateParams = hasDate ? Array(10).fill([tglMulai, tglSelesai]).flat() : [];

  const unifiedSql = getUnifiedLhkQuery(hasDate);

  const sqlMesin = `
        SELECT Mesin, Kategori, SUM(Total_m2) as Total_m2
        FROM (${unifiedSql}) u
        GROUP BY Mesin, Kategori
        ORDER BY Total_m2 DESC
    `;

  const sqlHarian = `
        SELECT DATE_FORMAT(Tanggal, '%Y-%m-%d') as Tanggal, 
               SUM(Total_m2) as Total_m2
        FROM (${unifiedSql}) u
        GROUP BY Tanggal
        ORDER BY Tanggal ASC
    `;

  const sqlSPK = `
        SELECT Nomor_SPK as lcd_spk_nomor, 
               Nama_Order as spk_nama, 
               SUM(Qty_Cetak) as Total_Qty,
               SUM(Total_m2) as Total_m2
        FROM (${unifiedSql}) u
        GROUP BY Nomor_SPK, Nama_Order
        ORDER BY Total_m2 DESC
        LIMIT 10
    `;

  const [resMesin] = await pool.query(sqlMesin, dateParams);
  const [resHarian] = await pool.query(sqlHarian, dateParams);
  const [resSPK] = await pool.query(sqlSPK, dateParams);

  return { perMesin: resMesin, perHari: resHarian, perSPK: resSPK };
};

const getRekapLhk = async (startDate, endDate) => {
  const tglMulai = normDate(startDate);
  const tglSelesai = normDate(endDate);
  const hasDate = !!(tglMulai && tglSelesai);
  const dateParams = hasDate ? Array(10).fill([tglMulai, tglSelesai]).flat() : [];

  const unifiedSql = getUnifiedLhkQuery(hasDate);

  const sqlMesin = `
        SELECT 
            u.Mesin,
            u.Kategori,
            COUNT(DISTINCT u.Nomor_SPK) AS Jml_SPK,
            SUM(u.Qty_Cetak) AS Total_Pcs,
            ROUND(SUM(u.Total_m2), 1) AS Total_Meter,
            IFNULL(m.msn_kapasitas, 0) AS Kapasitas 
        FROM (${unifiedSql}) u
        LEFT JOIN tmesin_mmt m ON (m.msn_nama = u.Mesin OR (u.Mesin = 'FINISHING' AND m.msn_kode = 'FNSH'))
        GROUP BY u.Mesin, u.Kategori, m.msn_kapasitas
        ORDER BY Total_Meter DESC
    `;

  const sqlHarian = `
        SELECT 
            DATE_FORMAT(u.Tanggal, '%Y-%m-%d') AS Tanggal,
            u.Mesin,
            u.Kategori,
            ROUND(SUM(u.Total_m2), 1) AS Total_Meter
        FROM (${unifiedSql}) u
        GROUP BY Tanggal, u.Mesin, u.Kategori
        ORDER BY Tanggal ASC, u.Mesin ASC
    `;

  const [rekapMesin] = await pool.query(sqlMesin, dateParams);
  const [rekapHarian] = await pool.query(sqlHarian, dateParams);

  return { rekapMesin, rekapHarian };
};

const getExportLhkCrossTab = async (month, year) => {
  const sql = `
        SELECT 
            u.Mesin,
            u.Kategori,
            DAY(u.Tanggal) AS Hari,
            SUM(u.Total_m2) AS Total_Meter
        FROM (
            SELECT 
                d.lcd_jns_mesin AS Mesin, 
                'MMT' AS Kategori, 
                h.lch_tanggal AS Tanggal, 
                ROUND(d.lcd_qty_cetak * IFNULL(x.spk_panjang,0) * IFNULL(x.spk_lebar,0), 2) AS Total_m2
            FROM tlhk_cetakmmt_hdr h 
            JOIN tlhk_cetakmmt_dtl d ON h.lch_nomor = d.lcd_lch_nomor
            LEFT JOIN (SELECT spk_nomor, spk_panjang, spk_lebar FROM tspk UNION ALL SELECT mspk_nomor, mspk_panjang, mspk_lebar FROM tmemospk) x ON x.spk_nomor = d.lcd_spk_nomor
            
            UNION ALL
            
           SELECT 
                d.ltd_jns_mesin AS Mesin, 
                'TEKSTIL' AS Kategori, 
                h.lth_tanggal AS Tanggal,
                ROUND(d.ltd_qty_cetak * IFNULL(x.spk_panjang,0) * IFNULL(x.spk_lebar,0), 2) AS Total_m2
            FROM tlhk_tekstilmmt_hdr h 
            JOIN tlhk_tekstilmmt_dtl d ON h.lth_nomor = d.ltd_lth_nomor
            LEFT JOIN (SELECT spk_nomor, spk_panjang, spk_lebar FROM tspk UNION ALL SELECT mspk_nomor, mspk_panjang, mspk_lebar FROM tmemospk) x ON x.spk_nomor = d.ltd_spk_nomor
            
            SELECT 
                IFNULL(d.lsbd_lokasi, 'SB01') AS Mesin, 
                'PAPERPRINT' AS Kategori, 
                h.lsb_tanggal AS Tanggal,
                IFNULL(d.lsbd_j_meter, (d.lsbd_panjang * d.lsbd_lebar * d.lsbd_jumlah)) AS Total_m2
            FROM tlhk_sublim_hdr h 
            JOIN tlhk_sublim_dtl d ON h.lsb_nomor = d.lsbd_lsb_nomor

            UNION ALL

            SELECT 
                'FINISHING' AS Mesin, 
                'FINISHING' AS Kategori, 
                h.lfh_tanggal AS Tanggal,
                ROUND(d.lfd_j_potong * IFNULL(x.spk_panjang,0) * IFNULL(x.spk_lebar,0), 2) AS Total_m2
            FROM tlhk_finishingmmt_hdr h 
            JOIN tlhk_finishingmmt_dtl d ON h.lfh_nomor = d.lfd_lfh_nomor
            LEFT JOIN (SELECT spk_nomor, spk_panjang, spk_lebar FROM tspk UNION ALL SELECT mspk_nomor, mspk_panjang, mspk_lebar FROM tmemospk) x ON x.spk_nomor = d.lfd_spk_nomor

            UNION ALL

            SELECT 
                IFNULL(d.lrd_lokasi, 'SB01') AS Mesin, 
                'SUBLIM' AS Kategori, 
                h.lr_tanggal AS Tanggal,
                (d.lrd_panjang * d.lrd_lebar * d.lrd_jumlah) AS Total_m2
            FROM tlhk_rtr_hdr h 
            JOIN tlhk_rtr_dtl d ON h.lr_nomor = d.lrd_lr_nomor
        ) u
        WHERE MONTH(u.Tanggal) = ? AND YEAR(u.Tanggal) = ?
        GROUP BY u.Mesin, u.Kategori, DAY(u.Tanggal)
        ORDER BY u.Mesin ASC, Hari ASC
    `;

  const [rows] = await pool.query(sql, [month, year]);
  return rows;
};

const getAllDataForExport = async (startDate, endDate, mesin) => {
  const tglMulai = normDate(startDate);
  const tglSelesai = normDate(endDate);
  const hasDate = !!(tglMulai && tglSelesai);

  let dateParams = hasDate ? Array(10).fill([tglMulai, tglSelesai]).flat() : [];
  let filterMesin = "";
  let extraParams = [];

  if (mesin) {
    const mesinArray = Array.isArray(mesin)
      ? mesin
      : mesin.split(",").filter((m) => m.trim() !== "");
    if (mesinArray.length > 0) {
      filterMesin = ` WHERE u.Mesin IN (${mesinArray.map(() => "?").join(",")})`;
      extraParams = mesinArray;
    }
  }

  const unifiedSql = getUnifiedLhkQuery(hasDate);

  const sql = `
        SELECT 
            u.Kategori,
            u.Nomor_LHK,
            DATE_FORMAT(u.Tanggal, '%d/%m/%Y') AS Tanggal,
            u.Shift AS Shift_LHK,
            u.Operator AS Operator_LHK,
            u.Nama_Gudang AS Gudang,
            u.Nomor_SPK,
            u.Nama_Order,
            u.Mesin,
            u.Qty_Cetak,
            u.Panjang,
            u.Lebar,
            u.Total_m2 AS m2_cetak
        FROM (${unifiedSql}) u
        ${filterMesin}
        ORDER BY u.Tanggal DESC, u.Nomor_LHK DESC
    `;

  const [rows] = await pool.query(sql, [...dateParams, ...extraParams]);
  return rows;
};

const getDetailRekapMesin = async (startDate, endDate, mesin) => {
  const tglMulai = normDate(startDate);
  const tglSelesai = normDate(endDate);
  const hasDate = !!(tglMulai && tglSelesai);
  const dc = hasDate ? "BETWEEN ? AND ?" : "1=1";

  // Buat SQL langsung khusus untuk detail mesin,

  // Buat SQL langsung khusus untuk detail mesin,
  // sehingga parameter `?` hanya ada untuk tanggal (2 buah) dan mesin (1 buah) = Total 3 parameter!
  const sql = `
        SELECT 
            u.Nomor_SPK AS No_SPK,
            u.Nama_Order,
            u.Kategori,
            SUM(u.Qty_Cetak) AS Total_Pcs,
            SUM(u.Total_m2) AS Total_Meter
        FROM (
            -- 1. MMT
            SELECT 
                'MMT' AS Kategori,
                d.lcd_spk_nomor AS Nomor_SPK,
                IFNULL(x.spk_nama, '-') AS Nama_Order,
                d.lcd_qty_cetak AS Qty_Cetak,
                ROUND(d.lcd_qty_cetak * IFNULL(x.spk_panjang, 0) * IFNULL(x.spk_lebar, 0), 2) AS Total_m2,
                d.lcd_jns_mesin AS Mesin
            FROM tlhk_cetakmmt_hdr h
            JOIN tlhk_cetakmmt_dtl d ON h.lch_nomor = d.lcd_lch_nomor
            LEFT JOIN (
                SELECT spk_nomor, spk_nama, spk_panjang, spk_lebar FROM tspk
                UNION ALL
                SELECT mspk_nomor, mspk_nama, mspk_panjang, mspk_lebar FROM tmemospk
            ) x ON x.spk_nomor = d.lcd_spk_nomor
            WHERE h.lch_tanggal ${dc}

            UNION ALL

            -- 2. TEKSTIL
    SELECT 
        'TEKSTIL' AS Kategori,
        d.ltd_spk_nomor AS Nomor_SPK,
        IFNULL(x.spk_nama, '-') AS Nama_Order,
        d.ltd_qty_cetak AS Qty_Cetak,
        ROUND(d.ltd_qty_cetak * IFNULL(x.spk_panjang, 0) * IFNULL(x.spk_lebar, 0), 2) AS Total_m2,
        d.ltd_jns_mesin AS Mesin
    FROM tlhk_tekstilmmt_hdr h
    JOIN tlhk_tekstilmmt_dtl d ON h.lth_nomor = d.ltd_lth_nomor
    LEFT JOIN (
        SELECT spk_nomor, spk_nama, spk_panjang, spk_lebar FROM tspk
        UNION ALL
        SELECT mspk_nomor, mspk_nama, mspk_panjang, mspk_lebar FROM tmemospk
    ) x ON x.spk_nomor = d.ltd_spk_nomor
    WHERE h.lth_tanggal ${dc}

            UNION ALL

            -- 3. PAPERPRINT
            SELECT 
                'PAPERPRINT' AS Kategori,
                d.lsbd_spk_nomor AS Nomor_SPK,
                IF(LENGTH(IFNULL(d.lsbd_spk_nama, '')) > 0, d.lsbd_spk_nama, IFNULL(x.spk_nama, '-')) AS Nama_Order,
                d.lsbd_jumlah AS Qty_Cetak,
                IFNULL(d.lsbd_j_meter, (d.lsbd_panjang * d.lsbd_lebar * d.lsbd_jumlah)) AS Total_m2,
                IFNULL(d.lsbd_lokasi, 'SB01') AS Mesin
            FROM tlhk_sublim_hdr h
            JOIN tlhk_sublim_dtl d ON h.lsb_nomor = d.lsbd_lsb_nomor
            LEFT JOIN (
                SELECT spk_nomor, spk_nama FROM tspk
                UNION ALL
                SELECT mspk_nomor, mspk_nama FROM tmemospk
            ) x ON x.spk_nomor = d.lsbd_spk_nomor
            WHERE h.lsb_tanggal ${dc}

            UNION ALL

            -- 4. FINISHING
            SELECT 
                'FINISHING' AS Kategori,
                d.lfd_spk_nomor AS Nomor_SPK,
                IFNULL(x.spk_nama, '-') AS Nama_Order,
                d.lfd_j_potong AS Qty_Cetak,
                ROUND(d.lfd_j_potong * IFNULL(x.spk_panjang, 0) * IFNULL(x.spk_lebar, 0), 2) AS Total_m2,
                'FINISHING' AS Mesin
            FROM tlhk_finishingmmt_hdr h
            JOIN tlhk_finishingmmt_dtl d ON h.lfh_nomor = d.lfd_lfh_nomor
            LEFT JOIN (
                SELECT spk_nomor, spk_nama, spk_panjang, spk_lebar FROM tspk
                UNION ALL
                SELECT mspk_nomor, mspk_nama, mspk_panjang, mspk_lebar FROM tmemospk
            ) x ON x.spk_nomor = d.lfd_spk_nomor
            WHERE h.lfh_tanggal ${dc}

            UNION ALL

            -- 5. SUBLIM
            SELECT 
                'SUBLIM' AS Kategori,
                d.lrd_spk_nomor AS Nomor_SPK,
                IFNULL(d.lrd_spk_nama, '-') AS Nama_Order,
                d.lrd_jumlah AS Qty_Cetak,
                (d.lrd_panjang * d.lrd_lebar * d.lrd_jumlah) AS Total_m2,
                IFNULL(d.lrd_lokasi, 'SB01') AS Mesin
            FROM tlhk_rtr_hdr h
            JOIN tlhk_rtr_dtl d ON h.lr_nomor = d.lrd_lr_nomor
            WHERE h.lr_tanggal ${dc}
        ) u
        WHERE u.Mesin = ?
        GROUP BY u.Nomor_SPK, u.Nama_Order, u.Kategori
        ORDER BY Total_Meter DESC
    `;

  // Karena ada 5 blok subquery (masing-masing 2 parameter tanggal = 10 parameter)
  // ditambah 1 parameter `mesin` di klausa WHERE paling bawah,
  // kita susun array parameternya dengan urutan yang diulang 5 kali untuk tanggal, lalu mesin di akhir:
  // Bila tanggal kosong, klausa tanggal menjadi 1=1 (tanpa parameter tanggal).
  const params = hasDate
    ? [
        tglMulai,
        tglSelesai, // MMT
        tglMulai,
        tglSelesai, // TEKSTIL
        tglMulai,
        tglSelesai, // PAPERPRINT
        tglMulai,
        tglSelesai, // FINISHING
        tglMulai,
        tglSelesai, // SUBLIM
        mesin, // u.Mesin = ?
      ]
    : [mesin];

  const [rows] = await pool.query(sql, params);
  return rows;
};

module.exports = {
  getLaporanAgregasi,
  getRekapLhk,
  getExportLhkCrossTab,
  getAllDataForExport,
  getDetailRekapMesin,
};
