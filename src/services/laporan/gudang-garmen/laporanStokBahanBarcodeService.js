const db = require("../../../config/database");

// --- 1. GET BROWSE HEADER (Master Stok Bahan) ---
const getBrowse = async (query) => {
  const { endDate, tampilkanKosong } = query;
  const dEnd = endDate || new Date().toISOString().substring(0, 10);
  const isTampilkanKosong = tampilkanKosong === "true";

  let sql = `
    SELECT X.*, IFNULL(mk.MkbBelumRealisasi, 0) AS MkbBelumRealisasi
    FROM (
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
    LEFT JOIN (
      -- MKB belum realisasi per kode bahan — replikasi persis formula
      -- "Kurang" dari mkbService.getDetailData (Butuh - Ready -
      -- (Terimapo+nonpo+linkpo)), diagregasi per bahan lintas semua
      -- MKB. Cuma nilai positif yang dihitung (GREATEST ..., 0) biar
      -- surplus di 1 MKB gak nutupin kekurangan MKB lain.
      SELECT d.mkbd_bhn_kode AS KodeBahan,
        SUM(GREATEST(d.mkbd_jumlah - d.mkbd_jumlah_rs - (
          IFNULL((
            SELECT SUM(i.pod_jumlah) FROM tpo_dtl i
            WHERE i.pod_mkb_nomor = h.mkb_nomor AND i.pod_bhn_kode = d.mkbd_bhn_kode
          ), 0)
          + IFNULL((
            SELECT IFNULL(SUM(i.bpbd2_jumlah), 0) FROM tpo_dtl p
            LEFT JOIN tbpb_dtl2 i ON i.bpbd2_po_nomor = p.pod_po_nomor AND i.bpbd2_nourut = p.pod_nourut
            WHERE p.pod_mkb_nomor = d.mkbd_mkb_nomor AND p.pod_bhn_kode = d.mkbd_bhn_kode
            GROUP BY p.pod_bhn_kode, p.pod_mkb_nomor
          ), 0)
          + IFNULL((
            SELECT IF(k.mkbd2_qty <= SUM(p.bpbd2_jumlah), k.mkbd2_qty, SUM(p.bpbd2_jumlah))
            FROM tbpb_dtl2 p
            INNER JOIN tmkb_dtl2 k ON k.mkbd2_po_nomor = p.bpbd2_po_nomor AND k.mkbd2_pourut = p.bpbd2_nourut
            WHERE k.mkbd2_mkb_nomor = d.mkbd_mkb_nomor AND k.mkbd2_nourut = d.mkbd_nourut
          ), 0)
          + IFNULL((
            SELECT SUM(i.bpbd_jumlah) FROM tbpb_dtl i
            WHERE i.bpbd_mkb = h.mkb_nomor AND i.bpbd_bhn_kode = d.mkbd_bhn_kode AND i.bpbd_nourut = d.mkbd_nourut
          ), 0)
        ), 0)) AS MkbBelumRealisasi
      FROM tmkb_dtl d
      LEFT JOIN tmkb_hdr h ON h.mkb_nomor = d.mkbd_mkb_nomor
      GROUP BY d.mkbd_bhn_kode
    ) mk ON mk.KodeBahan = X.Kode
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
      IF(x.stk < 3, 'REGULER', 'ECER') AS Kategori,
      
      IFNULL((
        SELECT IF(p.bpb_po_Nomor <> "", p.bpb_po_Nomor, DATE_FORMAT(p.bpb_tanggal, "%d-%m-%Y")) 
        FROM tbahan_barcode_dtl d
        LEFT JOIN tbahan_barcode_hdr h ON h.bar_nomor = d.bard_nomor
        LEFT JOIN tbpb_hdr p ON p.bpb_Nomor = h.bar_bpb
        WHERE d.bard_barcode = x.Barcode LIMIT 1
      ), "") AS NomorPO,

      IFNULL((
        SELECT pm.promin_spk_nomor
        FROM tproduksiminta_dtl2 pd2
        INNER JOIN tproduksiminta_hdr pm ON pm.promin_nomor = pd2.promind2_promin_nomor
        WHERE pd2.promind2_barcode = x.Barcode AND pm.promin_spk_nomor <> ""
        ORDER BY pm.promin_tanggal DESC
        LIMIT 1
      ), "") AS NomorSpk,
      
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

// --- 5. DETAIL MKB BELUM REALISASI PER BAHAN ---
const getMkbBelumRealisasiDetail = async (kode) => {
  const sql = `
    SELECT
      x.Nomor AS NomorMkb,
      DATE_FORMAT(x.Tanggal, '%d-%m-%Y') AS TglMkb,
      x.Spk,
      IFNULL(s.spk_nama, m.mspk_nama) AS NamaSpk,
      x.Butuh, x.Ready, x.Terima, x.Kurang
    FROM (
      SELECT
        d.mkbd_mkb_nomor AS Nomor,
        h.mkb_tanggal AS Tanggal,
        h.mkb_spk_nomor AS Spk,
        d.mkbd_jumlah AS Butuh,
        d.mkbd_jumlah_rs AS Ready,
        (
          IFNULL((
            SELECT SUM(i.pod_jumlah) FROM tpo_dtl i
            WHERE i.pod_mkb_nomor = h.mkb_nomor AND i.pod_bhn_kode = d.mkbd_bhn_kode
          ), 0)
          + IFNULL((
            SELECT IFNULL(SUM(i.bpbd2_jumlah), 0) FROM tpo_dtl p
            LEFT JOIN tbpb_dtl2 i ON i.bpbd2_po_nomor = p.pod_po_nomor AND i.bpbd2_nourut = p.pod_nourut
            WHERE p.pod_mkb_nomor = d.mkbd_mkb_nomor AND p.pod_bhn_kode = d.mkbd_bhn_kode
            GROUP BY p.pod_bhn_kode, p.pod_mkb_nomor
          ), 0)
          + IFNULL((
            SELECT IF(k.mkbd2_qty <= SUM(p.bpbd2_jumlah), k.mkbd2_qty, SUM(p.bpbd2_jumlah))
            FROM tbpb_dtl2 p
            INNER JOIN tmkb_dtl2 k ON k.mkbd2_po_nomor = p.bpbd2_po_nomor AND k.mkbd2_pourut = p.bpbd2_nourut
            WHERE k.mkbd2_mkb_nomor = d.mkbd_mkb_nomor AND k.mkbd2_nourut = d.mkbd_nourut
          ), 0)
          + IFNULL((
            SELECT SUM(i.bpbd_jumlah) FROM tbpb_dtl i
            WHERE i.bpbd_mkb = h.mkb_nomor AND i.bpbd_bhn_kode = d.mkbd_bhn_kode AND i.bpbd_nourut = d.mkbd_nourut
          ), 0)
        ) AS Terima,
        (d.mkbd_jumlah - d.mkbd_jumlah_rs - (
          IFNULL((
            SELECT SUM(i.pod_jumlah) FROM tpo_dtl i
            WHERE i.pod_mkb_nomor = h.mkb_nomor AND i.pod_bhn_kode = d.mkbd_bhn_kode
          ), 0)
          + IFNULL((
            SELECT IFNULL(SUM(i.bpbd2_jumlah), 0) FROM tpo_dtl p
            LEFT JOIN tbpb_dtl2 i ON i.bpbd2_po_nomor = p.pod_po_nomor AND i.bpbd2_nourut = p.pod_nourut
            WHERE p.pod_mkb_nomor = d.mkbd_mkb_nomor AND p.pod_bhn_kode = d.mkbd_bhn_kode
            GROUP BY p.pod_bhn_kode, p.pod_mkb_nomor
          ), 0)
          + IFNULL((
            SELECT IF(k.mkbd2_qty <= SUM(p.bpbd2_jumlah), k.mkbd2_qty, SUM(p.bpbd2_jumlah))
            FROM tbpb_dtl2 p
            INNER JOIN tmkb_dtl2 k ON k.mkbd2_po_nomor = p.bpbd2_po_nomor AND k.mkbd2_pourut = p.bpbd2_nourut
            WHERE k.mkbd2_mkb_nomor = d.mkbd_mkb_nomor AND k.mkbd2_nourut = d.mkbd_nourut
          ), 0)
          + IFNULL((
            SELECT SUM(i.bpbd_jumlah) FROM tbpb_dtl i
            WHERE i.bpbd_mkb = h.mkb_nomor AND i.bpbd_bhn_kode = d.mkbd_bhn_kode AND i.bpbd_nourut = d.mkbd_nourut
          ), 0)
        )) AS Kurang
      FROM tmkb_dtl d
      LEFT JOIN tmkb_hdr h ON h.mkb_nomor = d.mkbd_mkb_nomor
      WHERE d.mkbd_bhn_kode = ?
    ) x
    LEFT JOIN tspk s ON s.spk_nomor = x.Spk
    LEFT JOIN tmemospk m ON m.mspk_nomor = x.Spk
    WHERE x.Kurang > 0
    ORDER BY x.Tanggal
  `;
  const [rows] = await db.query(sql, [kode]);
  return rows;
};

module.exports = {
  getBrowse,
  getBrowseDetail,
  getKeteranganList,
  updateKeteranganList,
  getMkbBelumRealisasiDetail,
};
