const db = require("../../config/database");

// --- GET BROWSE LIST (MASTER) ---
const getBrowseList = async (filters, userCabang) => {
  const { startDate, endDate, cabang, nomorMap } = filters;

  let params = [`${startDate} 00:00:00`, `${endDate} 23:59:59`];
  let whereClause = `WHERE h.poi_tanggal >= ? AND h.poi_tanggal <= ?`;

  if (cabang && cabang !== "ALL") {
    whereClause += ` AND h.poi_cab = ?`;
    params.push(cabang);
  }

  if (nomorMap && nomorMap.trim() !== "") {
    whereClause += ` AND d.poid_kode = ?`;
    params.push(nomorMap);
  }

  const query = `
    SELECT distinct 
      h.poi_nomor AS Nomor, 
      h.poi_tanggal AS Tanggal,
      IFNULL((SELECT distinct j.poisjd_nomor FROM tpointernalmapsj_dtl j WHERE j.poisjd_po=h.poi_nomor LIMIT 1 ), "") AS SJ,
      h.poi_cab AS GudangAsal, 
      h.poi_sup AS Tujuan,
      IFNULL((SELECT SUM(o.poid_jumlah) FROM tpointernalmap_dtl o WHERE o.poid_nomor=h.poi_nomor), 0) AS QtyPO,
      IFNULL(z.QtySJ, 0) AS QtySJ,
      IF(poi_close="Y", "YA", "") AS Closed
    FROM tpointernalmap_hdr h
    LEFT JOIN tpointernalmap_dtl d ON d.poid_nomor = h.poi_nomor
    LEFT JOIN (
      SELECT x.poid_nomor AS nopo, SUM(IF(x.qsj > x.qpo, x.qpo, x.qsj)) AS QtySJ 
      FROM (
        SELECT a.poid_nomor, a.poid_kode, a.poid_jumlah AS qpo,
        IFNULL((SELECT sum(i.poisjd_jumlah) FROM tpointernalmapsj_dtl i WHERE i.poisjd_po=a.poid_nomor AND i.poisjd_kode=a.poid_kode),0) AS qsj
        FROM tpointernalmap_dtl a
      ) x
      GROUP BY x.poid_nomor
    ) z ON z.nopo = h.poi_nomor 
    ${whereClause}
    ORDER BY h.poi_nomor
  `;

  const [rows] = await db.query(query, params);
  return rows;
};

// --- GET DETAIL PER NOMOR PO ---
const getPoDetail = async (nomor) => {
  const query = `
    SELECT 
      d.poid_nomor AS Nomor, 
      d.poid_dateline AS Dateline, 
      d.poid_kode AS MAP, 
      m.mspk_nama AS Nama_MAP, 
      m.Mspk_kain AS Bahan, 
      m.Mspk_ukuran AS Ukuran, 
      d.poid_jumlah AS QtyPO,
      IFNULL((SELECT sum(i.poisjd_jumlah) FROM tpointernalmapsj_dtl i WHERE i.poisjd_po=d.poid_nomor AND i.poisjd_kode=d.poid_kode), 0) AS QtySJ,
      d.poid_ket AS Keterangan
    FROM tpointernalmap_dtl d
    LEFT JOIN tmemospk m ON m.mspk_nomor = d.poid_kode
    WHERE d.poid_nomor = ?
    ORDER BY d.poid_kode
  `;

  const [rows] = await db.query(query, [nomor]);
  return rows;
};

// --- DELETE PO INTERNAL MAP ---
const deletePo = async (nomor, userCabang) => {
  const conn = await db.getConnection();
  try {
    const [rows] = await conn.query(
      `SELECT poi_cab, poi_close FROM tpointernalmap_hdr WHERE poi_nomor = ?`,
      [nomor],
    );

    if (rows.length === 0) throw new Error("Data PO Internal tidak ditemukan.");
    const data = rows[0];

    // Validasi 1: Hak Akses Cabang
    if (userCabang && userCabang !== "ALL" && userCabang !== "HO-") {
      if (data.poi_cab !== userCabang) {
        throw new Error("Data tsb bukan cabang anda. Tidak berhak menghapus.");
      }
    }

    // Validasi 2: Status Close
    if (data.poi_close === "Y") {
      throw new Error("PO tsb sudah close. Tidah bisa di hapus.");
    }

    // Validasi 3: Sudah menjadi Surat Jalan
    const [sjRows] = await conn.query(
      `SELECT poisjd_nomor FROM tpointernalmapsj_dtl WHERE poisjd_po = ? LIMIT 1`,
      [nomor],
    );
    if (sjRows.length > 0) {
      throw new Error("PO tsb sudah Jadi SJ. Tidah bisa di hapus.");
    }

    await conn.beginTransaction();
    await conn.query(`DELETE FROM tpointernalmap_dtl WHERE poid_nomor = ?`, [
      nomor,
    ]);
    await conn.query(`DELETE FROM tpointernalmap_hdr WHERE poi_nomor = ?`, [
      nomor,
    ]);
    await conn.commit();
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
};

// --- GET EXPORT DETAIL ---
const getExportDetail = async (filters) => {
  const { startDate, endDate, cabang, nomorMap } = filters;

  let params = [`${startDate} 00:00:00`, `${endDate} 23:59:59`];
  let whereClause = `WHERE h.poi_tanggal >= ? AND h.poi_tanggal <= ?`;

  if (cabang && cabang !== "ALL") {
    whereClause += ` AND h.poi_cab = ?`;
    params.push(cabang);
  }

  if (nomorMap && nomorMap.trim() !== "") {
    whereClause += ` AND d.poid_kode = ?`;
    params.push(nomorMap);
  }

  const query = `
    SELECT 
      h.poi_nomor AS Nomor_PO, 
      DATE_FORMAT(h.poi_tanggal, '%d-%m-%Y') AS Tanggal_PO,
      h.poi_cab AS Gudang_Asal, 
      h.poi_sup AS Tujuan,
      IF(h.poi_close="Y", "YA", "TIDAK") AS Closed,
      d.poid_kode AS Kode_MAP, 
      m.mspk_nama AS Nama_MAP, 
      m.Mspk_kain AS Bahan, 
      m.Mspk_ukuran AS Ukuran, 
      d.poid_jumlah AS Qty_PO,
      IFNULL((SELECT sum(i.poisjd_jumlah) FROM tpointernalmapsj_dtl i WHERE i.poisjd_po=d.poid_nomor AND i.poisjd_kode=d.poid_kode), 0) AS Qty_SJ,
      DATE_FORMAT(d.poid_dateline, '%d-%m-%Y') AS Dateline,
      d.poid_ket AS Keterangan
    FROM tpointernalmap_hdr h
    INNER JOIN tpointernalmap_dtl d ON d.poid_nomor = h.poi_nomor
    LEFT JOIN tmemospk m ON m.mspk_nomor = d.poid_kode
    ${whereClause}
    ORDER BY h.poi_nomor, d.poid_nourut
  `;

  const [rows] = await db.query(query, params);
  return rows;
};

module.exports = { getBrowseList, getPoDetail, deletePo, getExportDetail };
