const pool = require("../../config/database");

/**
 * Service untuk Permintaan Driver (bsmcabang.tpermintaandriver & bsmcabang.tpermintaandriver_dtl)
 * Rujukan logic dari Delphi 7:
 * - ufrmBrowsePermintaanDriver.pas
 * - ufrmPermintaanDriver.pas
 */

// ── GET BROWSE ─────────────────────────────────────────────────────────
const getBrowse = async ({ tglAwal, tglAkhir }) => {
  const query = `
    SELECT 
      a.pd_nomor AS Nomor,
      DATE_FORMAT(a.pd_tanggal, '%Y-%m-%d') AS Tanggal,
      IFNULL(a.pd_jamminta, '') AS Jam_Minta,
      IFNULL(a.pd_userpeminta, '') AS Peminta,
      IFNULL(a.pd_pengambilan, '') AS Pengambilan,
      IFNULL(a.pd_customer, '') AS Customer,
      IFNULL(a.pd_pic, '') AS PIC,
      IFNULL(a.pd_uraian, '') AS Uraian,
      IFNULL(a.pd_status, 'Tidak') AS Status,
      IFNULL(a.pd_tipejadwal, 'Terjadwal') AS Tipe,
      DATE_FORMAT(a.pd_tglkerja, '%Y-%m-%d') AS TglKerja,
      IFNULL(a.pd_jamkerja, '') AS JamKerja,
      IF(a.pd_iscancel = 1, 'Cancel', 
        IF(a.pd_isclosed = 1, 'Sudah', 
          IF(a.pd_isclosed = 2, 'Proses', 
            IF(a.pd_isclosed = 4, 'Batal', 'Belum')
          )
        )
      ) AS IsClosed,
      a.pd_isclosed,
      a.pd_iscancel,
      IFNULL(a.pd_driver, '') AS Driver,
      IF(a.pd_tanggal <> a.pd_tglkerja, 'Jadwal Besok', '') AS Hari_Kerja
    FROM bsmcabang.tpermintaandriver a
    WHERE a.pd_tanggal BETWEEN ? AND ?
    ORDER BY a.pd_nomor DESC
  `;

  const [rows] = await pool.query(query, [tglAwal, tglAkhir]);
  return rows;
};

// ── GET DETAIL PER NOMOR (untuk expandable row) ────────────────────────
const getDetail = async (nomor) => {
  const query = `
    SELECT 
      pdd_nomor AS Nomor,
      pdd_nourut AS No_urut,
      IFNULL(pdd_spk, '') AS SPK,
      IFNULL(pdd_ket, '') AS Keterangan,
      IFNULL(pdd_penerima, '') AS Penerima
    FROM bsmcabang.tpermintaandriver_dtl
    WHERE pdd_nomor = ?
    ORDER BY pdd_nourut ASC
  `;

  const [rows] = await pool.query(query, [nomor]);
  return rows;
};

// ── GET BY ID (Header + Detail untuk Form Edit) ────────────────────────
const getById = async (nomor) => {
  const [headerRows] = await pool.query(
    `SELECT 
      pd_nomor AS nomor,
      DATE_FORMAT(pd_tanggal, '%Y-%m-%d') AS tanggal,
      IFNULL(pd_jamminta, '') AS jamMinta,
      IFNULL(pd_userpeminta, '') AS userPeminta,
      IFNULL(pd_pengambilan, '') AS pengambilan,
      IFNULL(pd_customer, '') AS customer,
      IFNULL(pd_pic, '') AS pic,
      IFNULL(pd_uraian, '') AS uraian,
      IFNULL(pd_status, 'Tidak') AS status,
      IFNULL(pd_tipejadwal, 'Terjadwal') AS tipeJadwal,
      DATE_FORMAT(pd_tglkerja, '%Y-%m-%d') AS tglKerja,
      IFNULL(pd_jamkerja, '') AS jamKerja,
      pd_isclosed AS isClosed,
      pd_iscancel AS isCancel,
      IFNULL(pd_driver, '') AS driver
    FROM bsmcabang.tpermintaandriver
    WHERE pd_nomor = ?`,
    [nomor],
  );

  if (!headerRows.length) {
    throw new Error(`Data Permintaan Driver dengan nomor ${nomor} tidak ditemukan.`);
  }

  const header = headerRows[0];
  const items = await getDetail(nomor);

  return {
    ...header,
    items,
  };
};

// ── GENERATE NOMOR OTOMATIS ────────────────────────────────────────────
// Format Delphi: MND.YYYYMM.XXXX
const generateNomor = async (tanggal, conn = null) => {
  const db = conn || pool;
  const d = new Date(tanggal || new Date());
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const prefix = `MND.${year}${month}.`;

  const [rows] = await db.query(
    `SELECT IFNULL(MAX(CAST(RIGHT(pd_nomor, 4) AS UNSIGNED)), 0) AS max_num 
     FROM bsmcabang.tpermintaandriver 
     WHERE pd_nomor LIKE ?`,
    [`${prefix}%`],
  );

  const maxVal = Number(rows[0]?.max_num || 0);
  const nextNum = maxVal + 1;
  return `${prefix}${String(nextNum).padStart(4, "0")}`;
};

// ── SEARCH SPK / MEMO SPK / SO (Direct Input SPK) ─────────────────────
// Saat input SPK dan enter: tidak mengecek kondisi aktif atau close.
// Yang penting nomor ada di database bisa lanjut.
// (Untuk popup bantuan F1 menggunakan lookupService yang tetap memvalidasi aktif dan close)
const searchSpk = async (keyword = "") => {
  const kw = (keyword || "").trim();
  const term = `%${kw}%`;
  const query = `
    SELECT * FROM (
      SELECT spk_nomor AS Nomor, spk_nama AS Nama, 'SPK' AS Tipe 
      FROM kencanaprint.tspk 
      WHERE (spk_nomor LIKE ? OR spk_nama LIKE ?)
      UNION ALL
      SELECT mspk_nomor AS Nomor, mspk_nama AS Nama, 'MEMO' AS Tipe 
      FROM kencanaprint.tmemospk 
      WHERE (mspk_nomor LIKE ? OR mspk_nama LIKE ?)
      UNION ALL
      SELECT so_nomor AS Nomor, so_nama AS Nama, 'SO' AS Tipe
      FROM kencanaprint.tsalesorder
      WHERE (so_nomor LIKE ? OR so_nama LIKE ?)
    ) x
    ORDER BY (Nomor = ?) DESC, (Nomor LIKE ?) DESC, Nomor DESC
    LIMIT 50
  `;

  const [rows] = await pool.query(query, [
    term,
    term,
    term,
    term,
    term,
    term,
    kw,
    `${kw}%`,
  ]);
  return rows;
};

// ── SIMPAN DATA (CREATE) ───────────────────────────────────────────────
const create = async (payload, userKode) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const {
      tanggal,
      jamMinta,
      tipeJadwal = "Terjadwal",
      customer,
      pengambilan,
      pic,
      uraian = "",
      jamKerja,
      status = "Tidak",
      hariKerja = "Hari Ini", // "Hari Ini" atau "Besok"
      items = [],
    } = payload;

    if (!customer?.trim()) throw new Error("Customer wajib diisi.");
    if (!pengambilan?.trim()) throw new Error("Pengambilan wajib diisi.");
    if (!pic?.trim()) throw new Error("PIC wajib diisi.");
    if (!jamKerja?.trim()) throw new Error("Estimasi jam kerja wajib diisi.");

    // Hitung tgl kerja
    let tglKerja = tanggal;
    if (hariKerja === "Besok") {
      const dt = new Date(tanggal);
      dt.setDate(dt.getDate() + 1);
      tglKerja = dt.toISOString().split("T")[0];
    }

    // Auto-generate nomor
    const nomor = await generateNomor(tanggal, conn);

    // Hitung jam minta aktual jika belum disediakan
    const nowTime =
      jamMinta ||
      new Date().toTimeString().split(" ")[0]; // HH:mm:ss

    // Simpan Header ke bsmcabang.tpermintaandriver
    // User request: kolom bsmcabang.tpermintaandriver.pd_userpeminta diupdate dari kode user login
    await conn.query(
      `INSERT INTO bsmcabang.tpermintaandriver (
        pd_nomor, pd_tanggal, pd_tipejadwal, pd_customer, pd_pengambilan, pd_pic,
        pd_uraian, pd_jamkerja, pd_status, pd_jamminta, pd_userpeminta, pd_tglkerja,
        pd_isclosed, pd_iscancel
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0)`,
      [
        nomor,
        tanggal,
        tipeJadwal,
        customer.trim(),
        pengambilan.trim(),
        pic.trim(),
        uraian.trim(),
        jamKerja.trim(),
        status,
        nowTime,
        (userKode || "").toUpperCase(),
        tglKerja,
      ],
    );

    // Simpan Detail ke bsmcabang.tpermintaandriver_dtl
    let nourut = 1;
    for (const item of items) {
      const ket = (item.keterangan || item.ket || "").trim();
      const spk = (item.spk || item.SPK || "").trim();
      const penerima = (item.penerima || "").trim();

      if (ket !== "" || spk !== "") {
        await conn.query(
          `INSERT INTO bsmcabang.tpermintaandriver_dtl (
            pdd_nomor, pdd_nourut, pdd_spk, pdd_ket, pdd_penerima
          ) VALUES (?, ?, ?, ?, ?)`,
          [nomor, nourut, spk, ket, penerima],
        );
        nourut++;
      }
    }

    await conn.commit();
    return { nomor };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
};

// ── UPDATE DATA (EDIT) ─────────────────────────────────────────────────
const update = async (nomor, payload, userKode, isAdmin = false) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // Cek apakah data ada dan cek status closed
    const [existing] = await conn.query(
      `SELECT pd_nomor, pd_userpeminta, pd_isclosed, pd_iscancel 
       FROM bsmcabang.tpermintaandriver 
       WHERE pd_nomor = ? FOR UPDATE`,
      [nomor],
    );

    if (!existing.length) {
      throw new Error(`Data ${nomor} tidak ditemukan.`);
    }

    const row = existing[0];
    if (row.pd_isclosed === 1) {
      throw new Error("Permintaan driver ini sudah selesai (closed), tidak dapat diubah.");
    }
    if (row.pd_isclosed === 4 || row.pd_iscancel === 1) {
      throw new Error("Permintaan driver ini sudah dibatalkan, tidak dapat diubah.");
    }

    // Validasi kepemilikan jika bukan admin
    if (!isAdmin && row.pd_userpeminta && row.pd_userpeminta.toUpperCase() !== (userKode || "").toUpperCase()) {
      throw new Error("Anda hanya bisa mengubah permintaan driver milik Anda sendiri.");
    }

    const {
      tanggal,
      tipeJadwal = "Terjadwal",
      customer,
      pengambilan,
      pic,
      uraian = "",
      jamKerja,
      status = "Tidak",
      hariKerja = "Hari Ini",
      items = [],
    } = payload;

    if (!customer?.trim()) throw new Error("Customer wajib diisi.");
    if (!pengambilan?.trim()) throw new Error("Pengambilan wajib diisi.");
    if (!pic?.trim()) throw new Error("PIC wajib diisi.");
    if (!jamKerja?.trim()) throw new Error("Estimasi jam kerja wajib diisi.");

    let tglKerja = tanggal;
    if (hariKerja === "Besok") {
      const dt = new Date(tanggal);
      dt.setDate(dt.getDate() + 1);
      tglKerja = dt.toISOString().split("T")[0];
    }

    // Update Header
    await conn.query(
      `UPDATE bsmcabang.tpermintaandriver SET 
        pd_tanggal = ?,
        pd_tipejadwal = ?,
        pd_customer = ?,
        pd_pengambilan = ?,
        pd_pic = ?,
        pd_uraian = ?,
        pd_jamkerja = ?,
        pd_status = ?,
        pd_tglkerja = ?
      WHERE pd_nomor = ?`,
      [
        tanggal,
        tipeJadwal,
        customer.trim(),
        pengambilan.trim(),
        pic.trim(),
        uraian.trim(),
        jamKerja.trim(),
        status,
        tglKerja,
        nomor,
      ],
    );

    // Replace Details
    await conn.query(
      `DELETE FROM bsmcabang.tpermintaandriver_dtl WHERE pdd_nomor = ?`,
      [nomor],
    );

    let nourut = 1;
    for (const item of items) {
      const ket = (item.keterangan || item.ket || "").trim();
      const spk = (item.spk || item.SPK || "").trim();
      const penerima = (item.penerima || "").trim();

      if (ket !== "" || spk !== "") {
        await conn.query(
          `INSERT INTO bsmcabang.tpermintaandriver_dtl (
            pdd_nomor, pdd_nourut, pdd_spk, pdd_ket, pdd_penerima
          ) VALUES (?, ?, ?, ?, ?)`,
          [nomor, nourut, spk, ket, penerima],
        );
        nourut++;
      }
    }

    await conn.commit();
    return { nomor };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
};

// ── HAPUS / BATALKAN (DELETE) ──────────────────────────────────────────
// Sesuai Delphi 7: update tpermintaandriver set pd_isclosed=4 where pd_nomor = ?
const deleteData = async (nomor, userKode, isAdmin = false) => {
  const [existing] = await pool.query(
    `SELECT pd_nomor, pd_userpeminta, pd_isclosed 
     FROM bsmcabang.tpermintaandriver 
     WHERE pd_nomor = ?`,
    [nomor],
  );

  if (!existing.length) {
    throw new Error(`Data ${nomor} tidak ditemukan.`);
  }

  const row = existing[0];

  // Delphi 7: Anda hanya bisa menghapus permintaan anda saja
  if (!isAdmin && row.pd_userpeminta && row.pd_userpeminta.toUpperCase() !== (userKode || "").toUpperCase()) {
    throw new Error("Anda hanya bisa menghapus permintaan Anda sendiri.");
  }

  if (row.pd_isclosed === 1) {
    throw new Error("Permintaan driver ini sudah selesai, tidak bisa dihapus/dibatalkan.");
  }

  await pool.query(
    `UPDATE bsmcabang.tpermintaandriver SET pd_isclosed = 4 WHERE pd_nomor = ?`,
    [nomor],
  );

  return { success: true };
};

module.exports = {
  getBrowse,
  getDetail,
  getById,
  generateNomor,
  searchSpk,
  create,
  update,
  deleteData,
};
