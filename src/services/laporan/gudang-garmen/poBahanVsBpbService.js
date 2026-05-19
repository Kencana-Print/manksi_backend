const db = require("../../../config/database");

// --- 1. GET BROWSE HEADER (Master PO) ---
const getBrowse = async (query) => {
  const { startDate, endDate } = query;

  // Default: Awal bulan s/d Hari ini
  const dStart =
    startDate ||
    new Date(new Date().getFullYear(), new Date().getMonth(), 1)
      .toISOString()
      .substring(0, 10);
  const dEnd = endDate || new Date().toISOString().substring(0, 10);

  const sql = `
    SELECT 
      h.po_nomor AS Nomor,
      DATE_FORMAT(h.po_tanggal, "%Y-%m-%d") AS Tanggal,
      h.po_keterangan AS Keterangan,
      h.po_sup_kode AS KodeSupplier,
      s.sup_nama AS Supplier,
      
      (SELECT IFNULL(SUM(b.pod_Jumlah), 0) FROM tpo_dtl b WHERE b.pod_po_Nomor = h.po_Nomor) AS QtyPO,
      (SELECT IFNULL(SUM(j.pod2_jumlah), 0) FROM tpo_dtl2 j WHERE j.pod2_nomor = h.po_Nomor) AS QtyCommit,
      
      (SELECT IFNULL(SUM(c.bpbd_Jumlah), 0) 
       FROM tbpb_dtl c 
       INNER JOIN tbpb_hdr f ON f.bpb_Nomor = c.bpbd_bpb_Nomor 
       WHERE f.bpb_po_Nomor = h.po_Nomor) AS QtyBPB,
       
      (SELECT IFNULL(SUM(b.retd_jumlah), 0) 
       FROM tret_hdr a 
       INNER JOIN tret_dtl b ON b.retd_ret_nomor = a.ret_nomor 
       INNER JOIN tbpb_hdr p ON p.bpb_Nomor = a.ret_bpb_nomor 
       WHERE p.bpb_po_Nomor = h.po_nomor) AS QtyRetur,
       
      IF(h.po_close = 1, 'CLOSE', IF(h.po_close = 0, 'OPEN', 'ONPROSES')) AS Status
    FROM tpo_hdr h
    LEFT JOIN tsupplier s ON s.sup_kode = h.po_sup_kode
    WHERE h.po_jenis <> 1 
      AND h.po_tanggal >= ? 
      AND h.po_tanggal <= ?
    ORDER BY h.po_nomor DESC
  `;

  const [rows] = await db.query(sql, [dStart, dEnd]);
  return rows;
};

// --- 2. GET BROWSE DETAIL (Pengganti Logika Temp Table Delphi) ---
const getBrowseDetail = async (nomorPO) => {
  // 2a. Ambil Master Item Bahan dari PO
  const [items] = await db.query(
    `SELECT d.pod_bhn_kode AS Kode, b.Bhn_Name AS Nama, b.Bhn_satuan AS Satuan, SUM(d.pod_Jumlah) AS QtyPO 
     FROM tpo_dtl d 
     LEFT JOIN tbahan b ON b.Bhn_kode = d.pod_bhn_kode 
     WHERE d.pod_po_Nomor = ? 
     GROUP BY d.pod_bhn_kode
     ORDER BY d.pod_bhn_kode`,
    [nomorPO],
  );

  // 2b. Ambil Delivery Commitments
  const [commits] = await db.query(
    `SELECT pod2_bhn_kode AS Kode, DATE_FORMAT(pod2_tanggal, '%Y-%m-%d') AS TglCommit, SUM(pod2_jumlah) AS QtyCommit 
     FROM tpo_dtl2 
     WHERE pod2_nomor = ? AND pod2_jumlah <> 0 
     GROUP BY pod2_bhn_kode, pod2_tanggal`,
    [nomorPO],
  );

  // 2c. Ambil BPB (Sudah digabung dengan Retur Beli per BPB sesuai perulangan tsql3 Delphi)
  const [bpbs] = await db.query(
    `SELECT 
        d.bpbd_bhn_kode AS Kode, 
        h.bpb_nomor AS NoBPB, 
        DATE_FORMAT(h.bpb_tanggal, '%Y-%m-%d') AS TglBPB, 
        SUM(d.bpbd_jumlah) AS QtyBPB,
        
        (SELECT CAST(GROUP_CONCAT(DISTINCT a.ret_nomor SEPARATOR ', ') AS CHAR) 
         FROM tret_hdr a INNER JOIN tret_dtl b ON b.retd_ret_nomor = a.ret_nomor 
         WHERE a.ret_bpb_nomor = h.bpb_nomor AND b.retd_bhn_kode = d.bpbd_bhn_kode) AS NoRetur,
         
        (SELECT MAX(DATE_FORMAT(a.ret_tanggal, '%Y-%m-%d')) 
         FROM tret_hdr a INNER JOIN tret_dtl b ON b.retd_ret_nomor = a.ret_nomor 
         WHERE a.ret_bpb_nomor = h.bpb_nomor AND b.retd_bhn_kode = d.bpbd_bhn_kode) AS TglRetur,
         
        (SELECT IFNULL(SUM(b.retd_jumlah), 0) 
         FROM tret_hdr a INNER JOIN tret_dtl b ON b.retd_ret_nomor = a.ret_nomor 
         WHERE a.ret_bpb_nomor = h.bpb_nomor AND b.retd_bhn_kode = d.bpbd_bhn_kode) AS QtyRetur
         
     FROM tbpb_hdr h 
     INNER JOIN tbpb_dtl d ON d.bpbd_bpb_Nomor = h.bpb_nomor 
     WHERE h.bpb_po_nomor = ? AND d.bpbd_jumlah <> 0
     GROUP BY d.bpbd_bhn_kode, h.bpb_nomor, h.bpb_tanggal`,
    [nomorPO],
  );

  const results = [];

  // 2d. Gabungkan/Posisikan secara horizontal (Meniru logika INSERT ON DUPLICATE KEY dengan ID urut)
  for (const item of items) {
    const itemCommits = commits.filter((c) => c.Kode === item.Kode);
    const itemBpbs = bpbs.filter((b) => b.Kode === item.Kode);

    // Cari baris terpanjang antara Commit dan BPB untuk item ini
    const maxRows = Math.max(1, itemCommits.length, itemBpbs.length);

    for (let i = 0; i < maxRows; i++) {
      results.push({
        Nomor: nomorPO,
        Kode: i === 0 ? item.Kode : "", // Meniru Delphi: Baris kedua dst kode dll dikosongkan agar enak dilihat
        Nama: i === 0 ? item.Nama : "",
        Satuan: i === 0 ? item.Satuan : "",
        QtyPO: i === 0 ? item.QtyPO : 0, // Hanya baris pertama yang ada nilai PO-nya

        TglCommit: itemCommits[i]?.TglCommit || null,
        QtyCommit: itemCommits[i]?.QtyCommit || 0,

        NoBPB: itemBpbs[i]?.NoBPB || "",
        TglBPB: itemBpbs[i]?.TglBPB || null,
        QtyBPB: itemBpbs[i]?.QtyBPB || 0,

        NoRetur: itemBpbs[i]?.NoRetur || "",
        TglRetur: itemBpbs[i]?.TglRetur || null,
        QtyRetur: itemBpbs[i]?.QtyRetur || 0,
      });
    }
  }

  return results;
};

module.exports = {
  getBrowse,
  getBrowseDetail,
};
