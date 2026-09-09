const db = require("../../config/database");

// Replikasi frmLogin.pas: if user_lokasi in (P04,P05) then PJHKE='P04' else 'P01'
const derivePjhKe = (userCabang) => {
  if (userCabang === "P04" || userCabang === "P05") return "P04";
  return "P01";
};

const DEFAULT_PRIORITY = "Segera"; // field Priority dihapus dari UI web
const JENIS_PENGAJUAN = "Pengajuan Dana"; // modul ini scope-nya khusus Pengajuan Dana

// --- GENERATE NOMOR: PGJ.YYYYMM.NNNN (replikasi getmaxnomor) ---
const generateNomor = async (tanggal) => {
  const d = new Date(tanggal);
  const yyyymm = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
  const [[row]] = await db.query(
    `SELECT IFNULL(MAX(CAST(RIGHT(pjh_nomor, 4) AS UNSIGNED)), 0) AS maxVal
     FROM ga2.tpengajuan2_hdr
     WHERE pjh_nomor LIKE ?`,
    [`PGJ.${yyyymm}.%`],
  );
  const next = Number(row.maxVal) + 1;
  return `PGJ.${yyyymm}.${String(next).padStart(4, "0")}`;
};

// --- SEARCH NIK (F1 lookup — replikasi edtNikClickBtn/edtNikKeyDown) ---
const searchNik = async (query, lokasi, page = 1, limit = 50) => {
  let sql = `SELECT DISTINCT nik AS Nik, nama AS Nama, bagian AS Bagian, lokasi AS Lokasi
             FROM ga2.peminta WHERE aktif = 0`;
  const params = [];
  if (lokasi) {
    sql += ` AND lokasi = ?`;
    params.push(lokasi);
  }
  if (query) {
    sql += ` AND (nik LIKE ? OR nama LIKE ?)`;
    params.push(`%${query}%`, `%${query}%`);
  }

  const [[{ total }]] = await db.query(
    `SELECT COUNT(*) AS total FROM (${sql}) x`,
    params,
  );

  sql += ` ORDER BY nama LIMIT ? OFFSET ?`;
  const offset = (Number(page) - 1) * Number(limit);
  const [rows] = await db.query(sql, [...params, Number(limit), offset]);

  return { items: rows, total: Number(total) };
};

// --- GET INFO 1 NIK (replikasi loaddata — DIPERBAIKI dari bug edtNikExit
// Delphi yang cuma cek "ada peminta aktif apa saja", bukan filter per-NIK) ---
const getNikInfo = async (nik) => {
  const [rows] = await db.query(
    `SELECT nik AS Nik, nama AS Nama, bagian AS Bagian, lokasi AS Lokasi
     FROM ga2.peminta WHERE nik = ? AND aktif = 0 LIMIT 1`,
    [nik],
  );
  if (!rows.length) throw new Error("Nik tidak ada.");
  return rows[0];
};

// --- GET DETAIL (mode edit — replikasi loaddataall) ---
const getFormDetail = async (nomor) => {
  const [headers] = await db.query(
    `SELECT a.pjh_nomor AS Nomor,
            DATE_FORMAT(a.pjh_tanggal, '%Y-%m-%d') AS Tanggal,
            a.pjh_keterangan AS Keterangan,
            a.pjh_nik AS Nik, c.nama AS Nama, c.lokasi AS Lokasi, c.bagian AS Bagian,
            a.pjh_jenis_permintaan AS Jenis, a.pjh_user_kode AS UserKode,
            a.pjh_cc_kode AS CcKode, a.pjh_cc_dcnama AS CcDcNama,
            IF(a.pjh_status = 0, 'Belum', 'Sudah') AS Verified,
            IF(IFNULL(h.pmt_close, 0) = 0, 'Belum', 'Sudah') AS Closed
     FROM ga2.tpengajuan2_hdr a
     LEFT JOIN ga2.peminta c ON c.nik = a.pjh_nik
     LEFT JOIN ga2.tpermintaan_hdr h ON h.pmt_pjh_nomor = a.pjh_nomor
     WHERE a.pjh_nomor = ?`,
    [nomor],
  );
  if (!headers.length) throw new Error("Nomor tidak ditemukan.");
  const header = headers[0];

  const [items] = await db.query(
    `SELECT pjd_nourut AS Nourut, pjd_nama AS Nama, pjd_spesifikasi AS Spesifikasi,
            pjd_qty AS Qty, pjd_nilai AS Nilai, (pjd_qty * pjd_nilai) AS Total,
            pjd_satuan AS Satuan, pjd_kegunaan AS Kegunaan,
            DATE_FORMAT(pjd_deadline, '%Y-%m-%d') AS Deadline,
            pjd_jobkp AS Nomor, pjd_kode AS Kode
     FROM ga2.tpengajuan2_dtl
     WHERE pjd_pjh_nomor = ? AND pjd_nama <> ''
     ORDER BY pjd_nourut`,
    [nomor],
  );

  return { header, items };
};

// --- VALIDASI OWNERSHIP/STATUS (replikasi validasi cxButton1Click di
// browse — dipindah/diduplikasi ke server-side sebagai lapisan aman kedua) ---
const assertCanEdit = async (nomor, userKode) => {
  const [rows] = await db.query(
    `SELECT a.pjh_user_kode AS UserKode,
            IF(a.pjh_status = 0, 'Belum', 'Sudah') AS Verified,
            IF(IFNULL(h.pmt_close, 0) = 0, 'Belum', 'Sudah') AS Closed
     FROM ga2.tpengajuan2_hdr a
     LEFT JOIN ga2.tpermintaan_hdr h ON h.pmt_pjh_nomor = a.pjh_nomor
     WHERE a.pjh_nomor = ?`,
    [nomor],
  );
  if (!rows.length) throw new Error("Data tidak ditemukan.");
  const row = rows[0];
  if (row.Closed === "Sudah") throw new Error("Pengajuan sudah Close.");
  if (row.Verified === "Sudah") throw new Error("Sudah di Verifikasi oleh GA.");
  if (row.UserKode !== userKode)
    throw new Error("Pengajuan ini bukan milik Anda.");
};

// --- VALIDASI DETAIL ROWS (replikasi cxButton2Click) ---
const validateItems = (items) => {
  if (!items.length) throw new Error("Minimal satu item harus diisi.");
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (const item of items) {
    if (!item.Nama || !String(item.Nama).trim())
      throw new Error("Nama harus diisi.");
    if (!item.Deadline) throw new Error("Deadline harus diisi.");
    const dl = new Date(item.Deadline);
    if (dl < today) throw new Error("Isi Deadline yang benar.");
  }
};

// --- SAVE DATA (create / update — replikasi simpandata) ---
const saveData = async (payload, userKode, userCabang) => {
  const { isEdit, nomor, header, items } = payload;

  if (!header.Nik || !String(header.Nik).trim())
    throw new Error("Nik harus diisi.");

  if (!header.CcKode || !String(header.CcKode).trim())
    throw new Error("Cost Center harus diisi.");

  const validItems = (items || []).filter(
    (r) => r.Nama && String(r.Nama).trim() !== "",
  );
  validateItems(validItems);

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    let nomorFinal = nomor;

    if (isEdit) {
      await assertCanEdit(nomorFinal, userKode);

      // ⬅ Priority & Ke TIDAK disentuh — pertahankan nilai lama persis
      // seperti Delphi (yang selalu menulis balik nilai combobox hasil
      // load, bukan menimpa dengan default baru).
      await conn.query(
        `UPDATE ga2.tpengajuan2_hdr SET
            pjh_tanggal = ?, pjh_nik = ?, pjh_keterangan = ?,
            pjh_cc_kode = ?, pjh_cc_dcnama = ?
          WHERE pjh_nomor = ?`,
        [
          header.Tanggal,
          header.Nik,
          header.Keterangan || "",
          header.CcKode || null,
          header.CcDcNama || null,
          nomorFinal,
        ],
      );
    } else {
      nomorFinal = await generateNomor(header.Tanggal);
      await conn.query(
        `INSERT INTO ga2.tpengajuan2_hdr
          (pjh_nomor, pjh_tanggal, pjh_nik, pjh_keterangan, pjh_jenis_permintaan,
            pjh_priority, pjh_ke, pjh_user_kode, pjh_nonga, pjh_status,
            pjh_cc_kode, pjh_cc_dcnama)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?)`,
        [
          nomorFinal,
          header.Tanggal,
          header.Nik,
          header.Keterangan || "",
          JENIS_PENGAJUAN,
          DEFAULT_PRIORITY,
          derivePjhKe(userCabang),
          userKode,
          header.CcKode || null,
          header.CcDcNama || null,
        ],
      );
    }

    await conn.query(
      `DELETE FROM ga2.tpengajuan2_dtl WHERE pjd_pjh_nomor = ?`,
      [nomorFinal],
    );

    let nourut = 1;
    for (const item of validItems) {
      await conn.query(
        `INSERT INTO ga2.tpengajuan2_dtl
           (pjd_pjh_nomor, pjd_nourut, pjd_nama, pjd_spesifikasi, pjd_kegunaan,
            pjd_qty, pjd_satuan, pjd_nilai, pjd_deadline, pjd_jobkp, pjd_kode)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          nomorFinal,
          nourut,
          item.Nama,
          item.Spesifikasi || "",
          item.Kegunaan || "",
          Number(item.Qty) || 0,
          item.Satuan || "",
          Number(item.Nilai) || 0,
          item.Deadline,
          item.Nomor || "",
          item.Kode || "",
        ],
      );
      nourut++;
    }

    await conn.commit();
    return { nomor: nomorFinal };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
};

// ── F1: Bantuan Pjh — cari Permintaan (dari ga2.tpermintaan_hdr) yang
// qty-nya belum ke-buy penuh, lalu import semua detailnya ke grid ──
const searchPermintaanPjh = async (query, page = 1, limit = 50) => {
  let sql = `
    SELECT DISTINCT
      h.pmt_pjh_nomor AS PjhNomor,
      h.pmt_nomor AS PmtNomor,
      DATE_FORMAT(j.pjh_tanggal, '%Y-%m-%d') AS Tanggal,
      j.pjh_ke AS PjhKe,
      j.pjh_jenis_permintaan AS Jenis,
      j.pjh_keterangan AS Keterangan,
      j.pjh_user_kode AS UserKode
    FROM ga2.tpermintaan_hdr h
    INNER JOIN ga2.tpermintaan_dtl d ON d.pmd_pmt_nomor = h.pmt_nomor
    LEFT JOIN ga2.tpengajuan2_hdr j ON j.pjh_nomor = h.pmt_pjh_nomor
    WHERE j.pjh_tanggal >= '2020-11-01'
      AND h.pmt_buyed = 1
      AND d.pmd_nourut <> 0
      AND d.pmd_qty_buyed < d.pmd_qty_riil
      AND j.pjh_nonga = 0
  `;
  const params = [];
  if (query) {
    sql += ` AND (h.pmt_pjh_nomor LIKE ? OR j.pjh_keterangan LIKE ?)`;
    params.push(`%${query}%`, `%${query}%`);
  }

  const [[{ total }]] = await db.query(
    `SELECT COUNT(*) AS total FROM (${sql}) x`,
    params,
  );

  sql += ` ORDER BY j.pjh_nomor LIMIT ? OFFSET ?`;
  const offset = (Number(page) - 1) * Number(limit);
  const [rows] = await db.query(sql, [...params, Number(limit), offset]);

  return { items: rows, total: Number(total) };
};

const getPermintaanDtl = async (pmtNomor) => {
  const [rows] = await db.query(
    `SELECT pmd_nama AS Nama, pmd_spesifikasi AS Spesifikasi,
            pmd_qty_riil AS Qty, pmd_nilai AS Nilai,
            (pmd_qty_riil * pmd_nilai) AS Total,
            pmd_satuan AS Satuan, pmd_kegunaan AS Kegunaan,
            DATE_FORMAT(DATE_ADD(CURDATE(), INTERVAL 7 DAY), '%Y-%m-%d') AS Deadline
     FROM ga2.tpermintaan_dtl
     WHERE pmd_nourut <> 0 AND pmd_qty_buyed < pmd_qty_riil AND pmd_pmt_nomor = ?`,
    [pmtNomor],
  );
  return rows.filter((r) => r.Nama && r.Nama.trim() !== "");
};

// ── F2: Bantuan Spv — cari Job Butuh (dari bsmcabang, ASUMSI: prefix
// cross-database di server yang sama, seperti pola ga2.) yang belum
// selesai dan punya item ──
const searchJobButuh = async (
  query,
  userCabang,
  isUserGA,
  page = 1,
  limit = 50,
) => {
  let sql = `
    SELECT * FROM (
      SELECT h.jb_nomor AS Nomor, h.jb_tanggal AS Tanggal, h.jb_cabang AS Cabang,
             u.user_nama AS Spv, h.jb_lokasi AS Lokasi, h.jb_bagian AS Bagian,
             h.jb_jenis AS Jenis, h.jb_ket AS Keterangan,
             IFNULL((SELECT COUNT(*) FROM bsmcabang.job_butuh_dtl d WHERE d.jbd_nomor = h.jb_nomor), 0) AS Item
      FROM bsmcabang.job_butuh_hdr h
      LEFT JOIN bsmcabang.job_user u ON u.user_kode = h.jb_user
      WHERE h.jb_selesai <> 1
  `;
  const params = [];
  if (!isUserGA) {
    sql += ` AND h.jb_cabang = ?`;
    params.push(userCabang);
  }
  sql += ` ) x WHERE x.Item > 0`;
  if (query) {
    sql += ` AND (x.Nomor LIKE ? OR x.Spv LIKE ? OR x.Keterangan LIKE ?)`;
    params.push(`%${query}%`, `%${query}%`, `%${query}%`);
  }

  const [[{ total }]] = await db.query(
    `SELECT COUNT(*) AS total FROM (${sql}) y`,
    params,
  );

  sql += ` ORDER BY x.Tanggal LIMIT ? OFFSET ?`;
  const offset = (Number(page) - 1) * Number(limit);
  const [rows] = await db.query(sql, [...params, Number(limit), offset]);

  return { items: rows, total: Number(total) };
};

// Cek apakah job ini SUDAH pernah diimport ke pengajuan lain (replikasi
// pengecekan awal bantuanSpv sebelum tarik detail)
const checkJobAlreadyUsed = async (jbNomor) => {
  const [rows] = await db.query(
    `SELECT pjd_pjh_nomor AS PjhNomor FROM ga2.tpengajuan2_dtl WHERE pjd_jobkp = ? LIMIT 1`,
    [jbNomor],
  );
  return rows.length ? rows[0].PjhNomor : null;
};

const getJobButuhDtl = async (jbNomor) => {
  const [rows] = await db.query(
    `SELECT jbd_nama AS Nama, jbd_spesifikasi AS Spesifikasi,
            jbd_qty AS Qty, jbd_satuan AS Satuan,
            jbd_nomor AS Nomor, jbd_kode AS Kode
     FROM bsmcabang.job_butuh_dtl
     WHERE jbd_ga = 0 AND jbd_nomor = ?`,
    [jbNomor],
  );
  return rows.filter((r) => r.Nama && r.Nama.trim() !== "");
};

module.exports = {
  generateNomor,
  searchNik,
  getNikInfo,
  getFormDetail,
  saveData,
  searchPermintaanPjh,
  getPermintaanDtl,
  searchJobButuh,
  checkJobAlreadyUsed,
  getJobButuhDtl,
};
