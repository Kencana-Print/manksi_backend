const db = require("../../config/database");

// --- GET BROWSE LIST (MASTER) ---
const getBrowseList = async (filters, userCabang) => {
  const { startDate, endDate, showNotApprovedOnly } = filters;

  let params = [];
  let whereClause = `WHERE 1=1`;

  // Filter Tanggal (Jika tidak pilih "Show All Not Approved")
  if (!showNotApprovedOnly) {
    whereClause += ` AND h.poisj_tanggal >= ? AND h.poisj_tanggal <= ?`;
    params.push(`${startDate} 00:00:00`, `${endDate} 23:59:59`);
  } else {
    whereClause += ` AND h.poisj_approve = "N"`;
  }

  // Penting: Hanya tampilkan SJ yang tujuannya adalah cabang user login saat ini
  // Kecuali user pusat (HO-)
  if (userCabang && userCabang !== "ALL" && userCabang !== "HO-") {
    whereClause += ` AND h.poisj_tujuan = ?`;
    params.push(userCabang);
  }

  const query = `
    SELECT 
      h.poisj_nomor AS Nomor, 
      h.poisj_tanggal AS Tanggal, 
      h.poisj_cab AS Dari, 
      h.poisj_tujuan AS Tujuan, 
      h.poisj_approve AS Approved
    FROM tpointernalmapsj_hdr h
    ${whereClause}
    ORDER BY h.poisj_nomor DESC
  `;

  const [rows] = await db.query(query, params);
  return rows;
};

// --- GET DETAIL (Untuk Expand Grid) ---
const getSjDetail = async (nomor) => {
  const query = `
    SELECT 
      d.poisjd_nomor AS Nomor, 
      d.poisjd_po AS Nomor_PO, 
      d.poisjd_kode AS MAP, 
      m.mspk_nama AS Nama_MAP, 
      m.Mspk_kain AS Bahan, 
      m.Mspk_ukuran AS Ukuran, 
      d.poisjd_jumlah AS Jumlah, 
      d.poisjd_ket AS Keterangan
    FROM tpointernalmapsj_dtl d
    LEFT JOIN tmemospk m ON m.mspk_nomor = d.poisjd_kode
    WHERE d.poisjd_nomor = ?
    ORDER BY d.poisjd_kode
  `;

  const [rows] = await db.query(query, [nomor]);
  return rows;
};

// --- EXECUTE APPROVE ---
const approveSj = async (nomor, userKode) => {
  const [rows] = await db.query(
    `SELECT poisj_approve FROM tpointernalmapsj_hdr WHERE poisj_nomor = ?`,
    [nomor],
  );

  if (rows.length === 0) throw new Error("Data Surat Jalan tidak ditemukan.");
  if (rows[0].poisj_approve === "Y")
    throw new Error("Surat Jalan ini sudah disetujui (Approved).");

  const query = `
    UPDATE tpointernalmapsj_hdr SET 
      poisj_approve = "Y",
      date_modified = NOW(),
      user_modified = ?
    WHERE poisj_nomor = ?
  `;

  await db.query(query, [userKode, nomor]);
  return true;
};

// --- EXPORT DETAIL (JOIN HEADER + DETAIL) ---
const getExportDetail = async (filters, userCabang) => {
  const { startDate, endDate, showNotApprovedOnly } = filters;
  let params = [];
  let whereClause = `WHERE 1=1`;

  if (!showNotApprovedOnly) {
    whereClause += ` AND h.poisj_tanggal >= ? AND h.poisj_tanggal <= ?`;
    params.push(`${startDate} 00:00:00`, `${endDate} 23:59:59`);
  } else {
    whereClause += ` AND h.poisj_approve = "N"`;
  }

  if (userCabang && userCabang !== "ALL" && userCabang !== "HO-") {
    whereClause += ` AND h.poisj_tujuan = ?`;
    params.push(userCabang);
  }

  const query = `
    SELECT 
      h.poisj_nomor AS Nomor_SJ, 
      DATE_FORMAT(h.poisj_tanggal, '%d-%m-%Y') AS Tanggal, 
      h.poisj_cab AS Dari, 
      h.poisj_tujuan AS Tujuan, 
      IF(h.poisj_approve="Y", "YA", "TIDAK") AS Approved,
      d.poisjd_po AS Nomor_PO, 
      d.poisjd_kode AS MAP, 
      m.mspk_nama AS Nama_MAP, 
      d.poisjd_jumlah AS Jumlah, 
      d.poisjd_ket AS Keterangan
    FROM tpointernalmapsj_hdr h
    INNER JOIN tpointernalmapsj_dtl d ON d.poisjd_nomor = h.poisj_nomor
    LEFT JOIN tmemospk m ON m.mspk_nomor = d.poisjd_kode
    ${whereClause}
    ORDER BY h.poisj_nomor DESC
  `;

  const [rows] = await db.query(query, params);
  return rows;
};

module.exports = {
  getBrowseList,
  getSjDetail,
  approveSj,
  getExportDetail,
};
