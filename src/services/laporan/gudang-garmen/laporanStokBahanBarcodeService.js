const db = require("../../../config/database");

// --- 1. GET BROWSE HEADER (Master Stok Bahan) ---
const getBrowse = async (query) => {
  const { endDate, tampilkanKosong } = query;

  // Default tanggal cutoff (menggunakan endDate sebagai patokan <= seperti Delphi startdate)
  const dEnd = endDate || new Date().toISOString().substring(0, 10);

  // Jika tampilkanKosong = 'false' atau undefined, filter stok > 0 atau < -0.1
  const isTampilkanKosong = tampilkanKosong === "true";

  let sql = `
    SELECT * FROM (
      SELECT 
        LEFT(c.mst_brg_kode, LENGTH(c.mst_brg_kode)-7) AS Kode,
        b.Bhn_Name AS Nama,
        b.Bhn_satuan AS Satuan,
        b.bhn_buffer AS Buffer,
        IFNULL(w.bw_nama, "") AS Warna,
        IFNULL(g.bg_nama, "") AS Gramasi,
        IFNULL(s.bs_nama, "") AS Setting,
        SUM(c.mst_stok_in) AS Masuk_In,
        SUM(c.mst_stok_out) AS Keluar_Out,
        SUM(c.mst_stok_in - c.mst_stok_out) AS Stok
      FROM tmasterstok_barcode c
      LEFT JOIN tbahan b ON b.Bhn_kode = LEFT(c.mst_brg_kode, LENGTH(c.mst_brg_kode)-7)
      LEFT JOIN tbahan_warna w ON w.bw_kode = MID(b.Bhn_kode, 3, 3)
      LEFT JOIN tbahan_gramasi g ON g.bg_kode = MID(b.Bhn_kode, 6, 2)
      LEFT JOIN tbahan_setting s ON s.bs_kode = RIGHT(b.Bhn_kode, 2)
      WHERE c.mst_aktif = 'Y' 
        AND c.mst_tanggal <= ?
      GROUP BY LEFT(c.mst_brg_kode, LENGTH(c.mst_brg_kode)-7)
    ) X
  `;

  if (!isTampilkanKosong) {
    sql += ` WHERE X.Stok > 0 OR X.Stok < -0.1 `;
  }

  sql += ` ORDER BY X.Nama ASC `;

  const [rows] = await db.query(sql, [dEnd]);
  return rows;
};

// --- 2. GET BROWSE DETAIL (Rincian Barcode per Bahan) ---
const getBrowseDetail = async (kode, query) => {
  const { endDate, janganTampilkanKosongDetail } = query;
  const dEnd = endDate || new Date().toISOString().substring(0, 10);

  const isJanganTampilkanKosong = janganTampilkanKosongDetail === "true";

  let sql = `
    SELECT 
      x.Kode,
      x.Barcode,
      IFNULL((
        SELECT DATE_FORMAT(a.mst_tanggal, "%d-%m-%Y") 
        FROM tmasterstok_barcode a 
        WHERE a.mst_aktif="Y" AND a.mst_brg_kode=x.Barcode AND a.mst_stok_in <> 0
        ORDER BY a.mst_tanggal ASC LIMIT 1
      ), "") AS Firts_In,
      
      x.masuk AS 'IN',
      
      IFNULL((
        SELECT DATE_FORMAT(a.mst_tanggal, "%d-%m-%Y") 
        FROM tmasterstok_barcode a 
        WHERE a.mst_aktif="Y" AND a.mst_brg_kode=x.Barcode AND a.mst_stok_out <> 0
        ORDER BY a.mst_tanggal DESC LIMIT 1
      ), "") AS Last_Out,
      
      x.keluar AS 'OUT',
      x.stk AS Stok,
      
      IFNULL((
        SELECT IF(p.bpb_po_Nomor <> "", p.bpb_po_Nomor, DATE_FORMAT(p.bpb_tanggal, "%d-%m-%Y")) 
        FROM tbahan_barcode_dtl d
        LEFT JOIN tbahan_barcode_hdr h ON h.bar_nomor = d.bard_nomor
        LEFT JOIN tbpb_hdr p ON p.bpb_Nomor = h.bar_bpb
        WHERE d.bard_barcode = x.Barcode LIMIT 1
      ), "") AS NomorPO,
      
      (SELECT d.bard_ket FROM tbahan_barcode_dtl d WHERE d.bard_barcode = x.Barcode LIMIT 1) AS Keterangan
      
    FROM (
      SELECT 
        LEFT(c.mst_brg_kode, LENGTH(c.mst_brg_kode)-7) AS Kode, 
        c.mst_brg_kode AS Barcode,
        SUM(c.mst_stok_in) AS masuk, 
        SUM(c.mst_stok_out) AS keluar, 
        SUM(c.mst_stok_in - c.mst_stok_out) AS stk
      FROM tmasterstok_barcode c
      WHERE c.mst_aktif = 'Y' 
        AND c.mst_tanggal <= ?
        AND LEFT(c.mst_brg_kode, LENGTH(c.mst_brg_kode)-7) = ?
      GROUP BY c.mst_brg_kode
    ) x
  `;

  if (isJanganTampilkanKosong) {
    sql += ` WHERE x.stk <> 0 `;
  }

  sql += ` ORDER BY x.Kode, x.Barcode ASC `;

  const [rows] = await db.query(sql, [dEnd, kode]);
  return rows;
};

// --- 3. GET LIST BARCODE UNTUK UPDATE KETERANGAN (Stok <> 0) ---
const getKeteranganList = async (kode) => {
  const sql = `
    SELECT x.Barcode, x.Stok, IFNULL(d.bard_ket, "") AS Keterangan
    FROM (
      SELECT c.mst_brg_kode AS Barcode, SUM(c.mst_stok_in - c.mst_stok_out) AS Stok
      FROM tmasterstok_barcode c
      WHERE c.mst_aktif = "Y" 
        AND LEFT(c.mst_brg_kode, LENGTH(c.mst_brg_kode)-7) = ?
      GROUP BY c.mst_brg_kode
    ) x
    LEFT JOIN tbahan_barcode_dtl d ON d.bard_barcode = x.Barcode
    WHERE x.Stok <> 0
  `;
  const [rows] = await db.query(sql, [kode]);
  return rows;
};

// --- 4. BATCH UPDATE KETERANGAN BARCODE ---
const updateKeteranganList = async (items) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    for (const item of items) {
      if (item.Barcode) {
        await conn.query(
          `UPDATE tbahan_barcode_dtl SET bard_ket = ? WHERE bard_barcode = ?`,
          [item.Keterangan || "", item.Barcode],
        );
      }
    }
    await conn.commit();
    return true;
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
};

module.exports = {
  getBrowse,
  getBrowseDetail,
  getKeteranganList,
  updateKeteranganList,
};
