const db = require("../../config/database");
const tutupBukuService = require("../tutupBukuService");

// --- GET BROWSE LIST (MASTER) ---
const getBrowseList = async (filters, userCabang) => {
  const { startDate, endDate, cabang, nomorMap } = filters;

  let params = [`${startDate} 00:00:00`, `${endDate} 23:59:59`];
  let whereClause = `WHERE h.poisj_tanggal >= ? AND h.poisj_tanggal <= ?`;

  // Filter Cabang
  if (cabang && cabang !== "ALL") {
    whereClause += ` AND h.poisj_cab = ?`;
    params.push(cabang);
  }

  // Filter berdasarkan Nomor MAP di Detail
  if (nomorMap && nomorMap.trim() !== "") {
    whereClause += ` AND d.poisjd_kode = ?`;
    params.push(nomorMap);
  }

  const query = `
    SELECT distinct 
      h.poisj_nomor AS Nomor, 
      h.poisj_tanggal AS Tanggal, 
      h.poisj_cab AS GudangAsal, 
      h.poisj_tujuan AS Tujuan, 
      h.poisj_approve AS Approve,
      IFNULL((
        SELECT IFNULL(IF(pin_acc="" AND pin_dipakai="", "WAIT", 
               IF(pin_acc="Y" AND pin_dipakai="", "ACC", 
               IF(pin_acc="Y" AND pin_dipakai="Y", "", 
               IF(pin_acc="N", "TOLAK", "")))), "") 
        FROM tspk_pin5 
        WHERE pin_trs="SJ POINTERNAL MAP" AND pin_nomor = h.poisj_nomor 
        ORDER BY pin_urut DESC LIMIT 1
      ), "") AS Ngedit, 
      h.user_create AS Usr
    FROM tpointernalmapsj_hdr h
    LEFT JOIN tpointernalmapsj_dtl d ON d.poisjd_nomor = h.poisj_nomor
    ${whereClause}
    ORDER BY h.poisj_nomor
  `;

  const [rows] = await db.query(query, params);
  return rows;
};

// --- GET DETAIL (Untuk Expand Row) ---
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

// --- GET EXPORT DETAIL ---
const getExportDetail = async (filters) => {
  const { startDate, endDate, cabang, nomorMap } = filters;

  let params = [`${startDate} 00:00:00`, `${endDate} 23:59:59`];
  let whereClause = `WHERE h.poisj_tanggal >= ? AND h.poisj_tanggal <= ?`;

  if (cabang && cabang !== "ALL") {
    whereClause += ` AND h.poisj_cab = ?`;
    params.push(cabang);
  }

  if (nomorMap && nomorMap.trim() !== "") {
    whereClause += ` AND d.poisjd_kode = ?`;
    params.push(nomorMap);
  }

  const query = `
    SELECT 
      h.poisj_nomor AS Nomor_SJ, 
      DATE_FORMAT(h.poisj_tanggal, '%d-%m-%Y') AS Tanggal_SJ, 
      h.poisj_cab AS Gudang_Asal, 
      h.poisj_tujuan AS Tujuan, 
      IF(h.poisj_approve="Y", "YA", "TIDAK") AS Approve,
      d.poisjd_po AS Nomor_PO, 
      d.poisjd_kode AS Kode_MAP, 
      m.mspk_nama AS Nama_MAP, 
      m.Mspk_kain AS Bahan, 
      m.Mspk_ukuran AS Ukuran, 
      d.poisjd_jumlah AS Jumlah, 
      d.poisjd_ket AS Keterangan
    FROM tpointernalmapsj_hdr h
    LEFT JOIN tpointernalmapsj_dtl d ON d.poisjd_nomor = h.poisj_nomor
    LEFT JOIN tmemospk m ON m.mspk_nomor = d.poisjd_kode
    ${whereClause}
    ORDER BY h.poisj_nomor
  `;

  const [rows] = await db.query(query, params);
  return rows;
};

// --- DELETE SURAT JALAN ---
const deleteSj = async (nomor, userCabang) => {
  const conn = await db.getConnection();
  try {
    const [rows] = await conn.query(
      `SELECT poisj_cab, poisj_approve, poisj_tanggal FROM tpointernalmapsj_hdr WHERE poisj_nomor = ?`,
      [nomor],
    );

    if (rows.length === 0) throw new Error("Data Surat Jalan tidak ditemukan.");
    const data = rows[0];

    // Validasi 1: Hak Akses Cabang
    if (userCabang && userCabang !== "ALL" && userCabang !== "HO-") {
      if (data.poisj_cab !== userCabang) {
        throw new Error("Data tsb bukan cabang anda. Tidak berhak menghapus.");
      }
    }

    // Validasi 2: Status Approve
    if (data.poisj_approve === "Y") {
      throw new Error("Sudah di Approve. Tidak bisa dihapus.");
    }

    // Validasi 3: Tutup Buku
    const zdtClose =
      await tutupBukuService.getTanggalTutupBuku("SJ POINTERNAL MAP");
    const tglInput = new Date(data.poisj_tanggal);
    if (zdtClose && tglInput < zdtClose) {
      throw new Error("Transaksi tsb sudah close. Tidak bisa dihapus.");
    }

    await conn.beginTransaction();
    await conn.query(`DELETE FROM tpointernalmapsj_hdr WHERE poisj_nomor = ?`, [
      nomor,
    ]);
    // Note: Detail dihapus via trigger ON DELETE CASCADE di database Delphi,
    // tapi kita lakukan manual di sini agar lebih aman.
    await conn.query(
      `DELETE FROM tpointernalmapsj_dtl WHERE poisjd_nomor = ?`,
      [nomor],
    );
    await conn.commit();
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
};

// --- REQUEST PIN 5 (PENGAJUAN PERUBAHAN) ---
const requestPin5 = async (nomor, alasan, userKode) => {
  const [sjRows] = await db.query(
    `SELECT poisj_tanggal FROM tpointernalmapsj_hdr WHERE poisj_nomor = ?`,
    [nomor],
  );
  if (sjRows.length === 0) throw new Error("Data tidak ditemukan.");
  const tgl = sjRows[0].poisj_tanggal;

  // Cek urutan terakhir
  const [pinRows] = await db.query(
    `SELECT pin_urut, pin_dipakai FROM tspk_pin5 WHERE pin_trs = "SJ POINTERNAL MAP" AND pin_nomor = ? ORDER BY pin_urut DESC LIMIT 1`,
    [nomor],
  );

  let urut = 1;
  if (pinRows.length > 0) {
    const lastPin = pinRows[0];
    urut = lastPin.pin_dipakai === "" ? lastPin.pin_urut : lastPin.pin_urut + 1;
  }

  const query = `
    INSERT INTO tspk_pin5 (
      pin_trs, pin_nomor, pin_urut, pin_tgl_trs, pin_ket, pin_tgl_minta, pin_user_minta, pin_alasan
    ) VALUES (
      "SJ POINTERNAL MAP", ?, ?, ?, "", NOW(), ?, ?
    ) ON DUPLICATE KEY UPDATE 
      pin_tgl_trs = VALUES(pin_tgl_trs), 
      pin_ket = VALUES(pin_ket), 
      pin_acc = "", 
      pin_tgl_minta = NOW(), 
      pin_user_minta = VALUES(pin_user_minta), 
      pin_alasan = VALUES(pin_alasan)
  `;

  await db.query(query, [nomor, urut, tgl, userKode, alasan]);
};

module.exports = {
  getBrowseList,
  getSjDetail,
  getExportDetail,
  deleteSj,
  requestPin5,
};
