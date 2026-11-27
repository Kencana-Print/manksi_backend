const db = require("../../config/database");
const {
  getRefPgjBbk,
  getRefPgjPjt,
  getRefPgjTerpakai,
} = require("../pembelian/uangMukaService");

// Bagian yang boleh melihat semua pengajuan di browse; bagian lain hanya
// melihat pengajuan yang dibuat user dari bagiannya sendiri.
const BAGIAN_LIHAT_SEMUA = ["FINANCE", "PEMBELIAN", "EDP", "DIREKSI", "AUDIT"];

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

const kelompokPerNomor = (peta) => {
  const hasil = new Map();
  for (const [k, ref] of peta) {
    const nomor = k.split("|")[0];
    const p = hasil.get(nomor) || { item: 0, ref: new Set() };
    p.item += 1;
    ref.split(", ").forEach((b) => p.ref.add(b));
    hasil.set(nomor, p);
  }
  return hasil;
};

// Tandai pengajuan yang itemnya sudah dibayar lewat BBK (termasuk realisasi
// Pengajuan Transfer) atau sedang diajukan di Pengajuan Transfer.
const tandaiBbk = async (rows) => {
  const [peta, petaPjt] = await Promise.all([
    getRefPgjBbk(),
    getRefPgjPjt("", true),
  ]);
  const perNomor = kelompokPerNomor(peta);
  const perNomorPjt = kelompokPerNomor(petaPjt);

  const nomorAda = rows
    .map((r) => r.Nomor)
    .filter((n) => perNomor.has(n) || perNomorPjt.has(n));
  const aktif = new Map();
  if (nomorAda.length) {
    const [cnt] = await db.query(
      `SELECT pjd_pjh_nomor AS nomor, COUNT(*) AS jml
       FROM ga2.tpengajuan2_dtl
       WHERE pjd_pjh_nomor IN (?) AND pjd_nama <> '' AND pjd_closed_manual = 0
       GROUP BY pjd_pjh_nomor`,
      [nomorAda],
    );
    cnt.forEach((c) => aktif.set(c.nomor, Number(c.jml)));
  }
  return rows.map((r) => {
    const p = perNomor.get(r.Nomor);
    const q = perNomorPjt.get(r.Nomor);
    if (!p && !q)
      return { ...r, BbkItem: 0, BbkNomor: "", PjtItem: 0, PjtNomor: "" };

    const total = aktif.get(r.Nomor) || Infinity;
    const nBbk = p ? p.item : 0;
    const nPjt = q ? q.item : 0;
    let status = r.StatusFinance;
    if (!["CLOSE", "CANCEL"].includes(status)) {
      if (nBbk >= total) status = "DIBAYAR_BBK";
      else if (nPjt > 0 && nBbk + nPjt >= total) status = "DIAJUKAN_TRANSFER";
      else if (!status)
        status = nBbk > 0 ? "SEBAGIAN_BBK" : "SEBAGIAN_TRANSFER";
    }
    return {
      ...r,
      StatusFinance: status,
      BbkItem: nBbk,
      BbkNomor: p ? [...p.ref].join(", ") : "",
      PjtItem: nPjt,
      PjtNomor: q ? [...q.ref].join(", ") : "",
    };
  });
};

const getBrowse = async (startDate, endDate, userKode, userBagian) => {
  const bagianUpper = (userBagian || "").toUpperCase();
  const showAll = BAGIAN_LIHAT_SEMUA.includes(bagianUpper);

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
      (
        SELECT
          CASE
            WHEN SUM(d.pmd_status_finance = 'BELUM_DIPENUHI') > 0 THEN 'BELUM_DIPENUHI'
            WHEN SUM(d.pmd_status_finance = 'PENDING') > 0
              OR EXISTS (
                SELECT 1 FROM ga2.tpengajuan2_dtl q
                WHERE q.pjd_pjh_nomor = a.pjh_nomor
                  AND q.pjd_status_finance = 'PENDING'
                  AND q.pjd_closed_manual = 0
              ) THEN 'PENDING'
            WHEN SUM(d.pmd_status_finance = 'PARTIAL') > 0 THEN 'PARTIAL'
            WHEN SUM(d.pmd_status_finance = 'MENUNGGU_PEMBELIAN') > 0 THEN 'MENUNGGU_PEMBELIAN'
            WHEN EXISTS (
                SELECT 1 FROM ga2.tpengajuan2_dtl q
                WHERE q.pjd_pjh_nomor = a.pjh_nomor
                  AND q.pjd_status_finance IN ('CLOSE', 'CANCEL')
              )
              AND NOT EXISTS (
                SELECT 1 FROM ga2.tpengajuan2_dtl q
                WHERE q.pjd_pjh_nomor = a.pjh_nomor
                  AND q.pjd_nama <> ''
                  AND q.pjd_closed_manual = 0
              ) THEN IF(
                EXISTS (
                  SELECT 1 FROM ga2.tpengajuan2_dtl q
                  WHERE q.pjd_pjh_nomor = a.pjh_nomor
                    AND q.pjd_status_finance = 'CLOSE'
                ), 'CLOSE', 'CANCEL')
            WHEN COUNT(*) > 0
              AND SUM(d.pmd_status_finance IN ('SUDAH_DIPENUHI', 'CLOSE', 'CANCEL')) = COUNT(*) THEN
              CASE
                WHEN SUM(d.pmd_status_finance = 'SUDAH_DIPENUHI') = COUNT(*) THEN 'SUDAH_DIPENUHI'
                WHEN SUM(d.pmd_status_finance = 'CANCEL') = COUNT(*) THEN 'CANCEL'
                ELSE 'CLOSE'
              END
            ELSE NULL
          END
        FROM ga2.tpermintaan_dtl d
        WHERE d.pmd_pmt_nomor = h.pmt_nomor
      ) AS StatusFinance,
      (
        SELECT GROUP_CONCAT(DISTINCT DATE_FORMAT(dd.pjd_estimasi, '%Y-%m-%d')
                 ORDER BY DATE_FORMAT(dd.pjd_estimasi, '%Y-%m-%d') SEPARATOR ',')
        FROM ga2.tpengajuan2_dtl dd
        WHERE dd.pjd_pjh_nomor = a.pjh_nomor
          AND dd.pjd_estimasi IS NOT NULL
          AND dd.pjd_closed_manual = 0
      ) AS Estimasi,
      a.pjh_user_kode AS UserKode
    FROM ga2.tpengajuan2_hdr a
    LEFT JOIN ga2.peminta b ON a.pjh_nik = b.nik
    LEFT JOIN ga2.tpermintaan_hdr h
      ON h.pmt_nomor = (
        SELECT h2.pmt_nomor
        FROM ga2.tpermintaan_hdr h2
        WHERE h2.pmt_pjh_nomor = a.pjh_nomor
        ORDER BY h2.pmt_approval DESC, h2.pmt_close DESC, h2.pmt_nomor
        LIMIT 1
      )
    LEFT JOIN finance.tcostcenter cc ON cc.cc_kode = a.pjh_cc_kode
    LEFT JOIN tuser u ON UPPER(u.user_kode) = UPPER(a.pjh_user_kode)
    WHERE a.pjh_nonga = 0
      AND a.pjh_tanggal BETWEEN ? AND ?
  `;
  const params = [startDate, endDate];

  if (!showAll) {
    query += ` AND UPPER(IFNULL(u.user_bagian, '')) = ?`;
    params.push(bagianUpper);
  }

  query += ` ORDER BY a.pjh_tanggal, a.pjh_nomor`;

  const [rows] = await db.query(query, params);
  return tandaiBbk(rows);
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
       a.Keterangan AS Keterangan,
       d.pjd_cc_kode AS CcKode,
       d.pjd_cc_dcnama AS CcDcNama,
       cc.cc_nama AS CcNama
     FROM ga2.viewpengajuan a
     LEFT JOIN ga2.tpengajuan2_dtl d
       ON d.pjd_pjh_nomor = a.pjh_nomor AND d.pjd_nourut = a.pjd_nourut
     LEFT JOIN finance.tcostcenter cc ON cc.cc_kode = d.pjd_cc_kode
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

  const peta = await getRefPgjTerpakai();
  if ([...peta.keys()].some((k) => k.startsWith(`${nomor}|`)))
    throw new Error(
      "Gak bisa dihapus. Item sudah dibayar lewat BBK atau diajukan di Pengajuan Transfer.",
    );

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

  await db.query(
    `UPDATE ga2.tpengajuan2_dtl
     SET pjd_closed_manual = 1
     WHERE pjd_pjh_nomor = ?`,
    [nomor],
  );
};

module.exports = {
  getBrowse,
  getDetail,
  deleteData,
  getGaUserStatus,
  closeManual, // tambahkan ke export
};
