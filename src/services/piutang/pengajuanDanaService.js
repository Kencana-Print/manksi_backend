const db = require("../../config/database");

// Cek status GA user berdasarkan tabel ga2.tuser (login system terpisah,
// lihat uLogin.pas ga2 — frmMenu.USERGA := user_ga, keyed by user_kode).
// Asumsi: user_kode di ga2 sama dengan user_kode Manksi untuk user yang sama.
const getGaUserStatus = async (userKode) => {
  const [rows] = await db.query(
    `SELECT user_ga FROM ga2.tuser WHERE UPPER(user_kode) = UPPER(?) AND user_aktif = 0`,
    [userKode],
  );
  if (!rows.length) return null;
  return Number(rows[0].user_ga) === 1;
};

const getBrowse = async (startDate, endDate, userKode) => {
  const isAdmin = (userKode || "").toUpperCase() === "ADMIN";
  const gaStatus = isAdmin ? null : await getGaUserStatus(userKode);
  const showAll = isAdmin || gaStatus === true || gaStatus === null;

  let query = `
    SELECT
      a.pjh_nomor AS Nomor,
      DATE_FORMAT(a.pjh_tanggal, '%Y-%m-%d') AS Tanggal,
      a.pjh_nik AS Nik,
      b.Nama AS Nama,
      b.lokasi AS Lokasi,
      b.Bagian AS Bagian,
      a.pjh_ke AS PjhKe,
      a.pjh_keterangan AS Keterangan,
      a.pjh_jenis_permintaan AS Jenis,
      a.pjh_priority AS Priority,
      a.pjh_cc_kode AS CcKode,
      a.pjh_cc_dcnama AS CcDcNama,
      cc.cc_nama AS CcNama,
      IF(a.pjh_status = 0, 'Belum', 'Sudah') AS Verified,
      IF(IFNULL(h.pmt_approval, 0) = 0, 'Belum', 'Sudah') AS Approval,
      IF(IFNULL(h.pmt_buyed, 0) = 0, 'Belum', 'Sudah') AS Beli,
      IF(IFNULL(h.pmt_close, 0) = 0, 'Belum', 'Sudah') AS Closed,
      h.pmt_status_finance AS StatusFinance,
      a.pjh_user_kode AS UserKode
    FROM ga2.tpengajuan2_hdr a
    LEFT JOIN ga2.peminta b ON a.pjh_nik = b.nik
    LEFT JOIN ga2.tpermintaan_hdr h ON h.pmt_pjh_nomor = a.pjh_nomor
    LEFT JOIN finance.tcostcenter cc ON cc.cc_kode = a.pjh_cc_kode
    WHERE a.pjh_nonga = 0
      AND a.pjh_tanggal BETWEEN ? AND ?
  `;
  const params = [startDate, endDate];

  if (!showAll) {
    query += ` AND a.pjh_user_kode = ?`;
    params.push(userKode);
  }

  query += ` ORDER BY a.pjh_tanggal, a.pjh_nomor`;

  const [rows] = await db.query(query, params);
  return rows;
};

const getDetail = async (nomor) => {
  const [rows] = await db.query(
    `SELECT
       a.pjh_nomor AS Nomor,
       a.pjd_nama AS Nama,
       a.pjd_spesifikasi AS Spesifikasi,
       a.pjd_satuan AS Satuan,
       a.pjd_qty AS QtyPengajuan,
       a.QtyVerifikasi AS QtyVerifikasi,
       a.QtyBeli AS QtyBeli,
       a.QtyRealisasi AS QtyRealisasi,
       (a.pjd_qty * a.pjd_nilai) AS RpPengajuan,
       a.RpApproved AS RpApproved,
       a.Reject AS Reject,
       a.Deadline AS Deadline,
       a.TglVerified AS TglVerified,
       a.NameVerified AS NameVerified,
       a.TglApproval AS TglApproval,
       a.NameApproved AS NameApproved,
       a.TglBeli AS TglBeli,
       a.TglClose AS TglClose,
       a.pjd_kegunaan AS Kegunaan,
       a.Keterangan AS Keterangan
     FROM ga2.viewpengajuan a
     WHERE a.pjh_nomor = ?
     ORDER BY a.pjd_nourut`,
    [nomor],
  );
  return rows;
};

const deleteData = async (nomor) => {
  const [rows] = await db.query(
    `SELECT
       IF(IFNULL(h.pmt_close, 0) = 0, 'Belum', 'Sudah') AS Closed,
       IF(a.pjh_status = 0, 'Belum', 'Sudah') AS Verified
     FROM ga2.tpengajuan2_hdr a
     LEFT JOIN ga2.tpermintaan_hdr h ON h.pmt_pjh_nomor = a.pjh_nomor
     WHERE a.pjh_nomor = ?`,
    [nomor],
  );
  if (!rows.length) throw new Error("Data tidak ditemukan.");

  const { Closed, Verified } = rows[0];
  if (Closed === "Sudah") throw new Error("Pengajuan sudah Close.");
  if (Verified === "Sudah")
    throw new Error("Gak bisa dihapus. Sudah di buatkan permintaan oleh GA.");

  await db.query(`DELETE FROM ga2.tpengajuan2_hdr WHERE pjh_nomor = ?`, [
    nomor,
  ]);
};

const closeManual = async (nomor, alasan, userKode) => {
  if (!alasan || !alasan.trim()) {
    throw new Error("Alasan penutupan manual wajib diisi.");
  }

  const [rows] = await db.query(
    `SELECT
       h.pmt_nomor, h.pmt_close, h.pmt_approval, h.pmt_buyed,
       a.pjh_user_kode
     FROM ga2.tpengajuan2_hdr a
     JOIN ga2.tpermintaan_hdr h ON h.pmt_pjh_nomor = a.pjh_nomor
     WHERE a.pjh_nomor = ?`,
    [nomor],
  );
  if (!rows.length) throw new Error("Data tidak ditemukan.");

  const row = rows[0];
  if (row.pjh_user_kode !== userKode) {
    throw new Error("Pengajuan ini bukan milik Anda.");
  }
  if (Number(row.pmt_close) === 1) {
    throw new Error("Pengajuan sudah Close.");
  }
  if (Number(row.pmt_approval) === 0) {
    throw new Error("Uang muka belum di-approval Finance.");
  }
  if (Number(row.pmt_buyed) === 1) {
    throw new Error("Qty sudah terpenuhi penuh, tidak perlu Close Manual.");
  }

  const pmtNomor = row.pmt_nomor;

  await db.query(
    `UPDATE ga2.tpermintaan_dtl
     SET pmd_qty_realisasi = pmd_qty_buyed,
         pmd_user_closed = ?,
         pmd_tanggal_closed = NOW()
     WHERE pmd_pmt_nomor = ?`,
    [userKode, pmtNomor],
  );

  await db.query(
    `UPDATE ga2.tpermintaan_hdr
     SET pmt_close = 1,
         pmt_tglclose = NOW(),
         pmt_close_manual = 1,
         pmt_alasan_close_manual = ?,
         pmt_user_close_manual = ?
     WHERE pmt_nomor = ?`,
    [alasan.trim(), userKode, pmtNomor],
  );
};

module.exports = {
  getBrowse,
  getDetail,
  deleteData,
  getGaUserStatus,
  closeManual, // tambahkan ke export
};
