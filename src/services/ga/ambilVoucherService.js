const pool = require("../../config/database");

/**
 * Service Ambil Voucher GA (ga2.tvoucher, ga2.spbu, ga2.jenisbbm, ga2.pengguna, ga2.kendaraan)
 * Rujukan dari Delphi 7:
 * - ufrmBrowseVoucher.pas
 * - ufrmVoucher.pas
 */

// ── GENERATE NO VOUCHER & ID OTOMATIS ──────────────────────────────────
const getMaxKode = async (conn = null) => {
  const db = conn || pool;
  const [rows] = await db.query(`
    SELECT 
      IFNULL(MAX(CAST(no_voucher AS UNSIGNED)), 0) + 1 AS next_voucher,
      (SELECT MAX(id) FROM ga2.tvoucher) AS max_id
    FROM ga2.tvoucher
    WHERE id = (SELECT MAX(id) FROM ga2.tvoucher)
  `);

  const maxId = rows[0]?.max_id ? Number(rows[0].max_id) : 1;
  const nextVoucher = rows[0]?.next_voucher ? Number(rows[0].next_voucher) : 1;

  let noVoucher = String(nextVoucher);
  let id = maxId;

  if (nextVoucher > 10000) {
    noVoucher = "1";
    id = maxId + 1;
  }

  return { no_voucher: noVoucher, id };
};

// ── GET BROWSE ─────────────────────────────────────────────────────────
const getBrowse = async ({ tglAwal, tglAkhir }) => {
  const query = `
    SELECT 
      a.no_voucher AS Kode,
      a.id AS Id,
      DATE_FORMAT(a.tanggal, '%Y-%m-%d') AS Tanggal,
      IFNULL(b.namaspbu, '') AS NamaSpbu,
      IFNULL(a.nopol, '') AS Nopol,
      IFNULL(NULLIF(a.pengguna, ''), IFNULL(c.nama, '')) AS Nama_Pengguna,
      IFNULL(a.odometer, 0) AS Odometer,
      IFNULL(d.namabbm, '') AS NamaBBM,
      IFNULL(a.jumlah, 0) AS Jumlah
    FROM ga2.tvoucher a
    LEFT JOIN ga2.spbu b ON a.id_spbu = b.id_spbu
    LEFT JOIN ga2.pengguna c ON a.kode_pengguna = c.kode
    LEFT JOIN ga2.jenisbbm d ON a.id_bbm = d.id_bbm
    WHERE a.tanggal BETWEEN ? AND ?
    ORDER BY a.tanggal DESC, CAST(a.no_voucher AS UNSIGNED) DESC
  `;

  const [rows] = await pool.query(query, [tglAwal, tglAkhir]);
  return rows;
};

// ── GET DETAIL BY KODE & ID ────────────────────────────────────────────
const getById = async (kode, id) => {
  const query = `
    SELECT 
      a.no_voucher AS no_voucher,
      a.id AS id,
      DATE_FORMAT(a.tanggal, '%Y-%m-%d') AS tanggal,
      IFNULL(a.kode_pengguna, '') AS kode_pengguna,
      IFNULL(a.pengguna, '') AS pengguna,
      a.id_spbu,
      IFNULL(a.nopol, '') AS nopol,
      IFNULL(a.odometer, 0) AS odometer,
      a.id_bbm,
      IFNULL(a.jumlah, 0) AS jumlah,
      IFNULL(b.namaspbu, '') AS namaspbu,
      IFNULL(c.nama, '') AS nama_pengguna,
      IFNULL(d.namabbm, '') AS namabbm
    FROM ga2.tvoucher a
    LEFT JOIN ga2.spbu b ON a.id_spbu = b.id_spbu
    LEFT JOIN ga2.pengguna c ON a.kode_pengguna = c.kode
    LEFT JOIN ga2.jenisbbm d ON a.id_bbm = d.id_bbm
    WHERE a.no_voucher = ? AND a.id = ?
  `;

  const [rows] = await pool.query(query, [kode, id]);
  if (!rows.length) {
    throw new Error(`Data voucher nomor ${kode} (ID: ${id}) tidak ditemukan.`);
  }
  return rows[0];
};

// ── GET LOOKUPS (SPBU, Pengguna, Kendaraan, BBM) ────────────────────────
const getLookups = async () => {
  const [spbu] = await pool.query(
    `SELECT id_spbu AS id, namaspbu AS nama, IFNULL(alamatspbu, '') AS alamat FROM ga2.spbu ORDER BY namaspbu ASC`
  );
  const [pengguna] = await pool.query(
    `SELECT kode, nama FROM ga2.pengguna ORDER BY nama ASC`
  );
  const [kendaraan] = await pool.query(
    `SELECT nopol, IFNULL(Keterangan, '') AS keterangan, IFNULL(stat, '') AS stat 
     FROM ga2.kendaraan 
     WHERE IFNULL(aktif, 'Y') != 'N' 
     ORDER BY nopol ASC`
  );
  const [bbm] = await pool.query(
    `SELECT id_bbm AS id, namabbm AS nama FROM ga2.jenisbbm ORDER BY id_bbm ASC`
  );

  return { spbu, pengguna, kendaraan, bbm };
};

// ── CREATE ─────────────────────────────────────────────────────────────
const create = async (payload) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    let noVoucher = payload.no_voucher;
    let id = payload.id;

    if (!noVoucher || !id) {
      const nextInfo = await getMaxKode(conn);
      noVoucher = nextInfo.no_voucher;
      id = nextInfo.id;
    }

    const {
      tanggal,
      kode_pengguna,
      pengguna,
      id_spbu,
      nopol,
      odometer = 0,
      id_bbm,
      jumlah = 0,
    } = payload;

    let penggunaVal = (pengguna || "").trim().toUpperCase();
    let kodePenggunaVal = (kode_pengguna || "").trim();

    // Jika pengguna kosong tapi kode_pengguna terisi, cari nama dari ga2.pengguna
    if (!penggunaVal && kodePenggunaVal) {
      const [pRows] = await conn.query(
        `SELECT nama FROM ga2.pengguna WHERE kode = ?`,
        [kodePenggunaVal],
      );
      if (pRows.length > 0) {
        penggunaVal = (pRows[0].nama || "").trim().toUpperCase();
      }
    } else if (penggunaVal && !kodePenggunaVal) {
      // Jika kode_pengguna kosong tapi nama pengguna terisi, cari kodenya jika cocok
      const [pRows] = await conn.query(
        `SELECT kode FROM ga2.pengguna WHERE UPPER(TRIM(nama)) = ?`,
        [penggunaVal],
      );
      if (pRows.length > 0) {
        kodePenggunaVal = pRows[0].kode;
      }
    }

    penggunaVal = penggunaVal.slice(0, 30);

    await conn.query(
      `INSERT INTO ga2.tvoucher (no_voucher, id, tanggal, kode_pengguna, pengguna, id_spbu, nopol, odometer, id_bbm, jumlah)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        noVoucher,
        id,
        tanggal,
        kodePenggunaVal || "",
        penggunaVal || "",
        id_spbu || null,
        nopol || null,
        Number(odometer) || 0,
        id_bbm || null,
        Number(jumlah) || 0,
      ],
    );

    await conn.commit();
    return { no_voucher: noVoucher, id };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
};

// ── UPDATE ─────────────────────────────────────────────────────────────
const update = async (kode, id, payload) => {
  const {
    tanggal,
    kode_pengguna,
    pengguna,
    id_spbu,
    nopol,
    odometer = 0,
    id_bbm,
    jumlah = 0,
  } = payload;

  let penggunaVal = (pengguna || "").trim().toUpperCase();
  let kodePenggunaVal = (kode_pengguna || "").trim();

  if (!penggunaVal && kodePenggunaVal) {
    const [pRows] = await pool.query(
      `SELECT nama FROM ga2.pengguna WHERE kode = ?`,
      [kodePenggunaVal],
    );
    if (pRows.length > 0) {
      penggunaVal = (pRows[0].nama || "").trim().toUpperCase();
    }
  } else if (penggunaVal && !kodePenggunaVal) {
    const [pRows] = await pool.query(
      `SELECT kode FROM ga2.pengguna WHERE UPPER(TRIM(nama)) = ?`,
      [penggunaVal],
    );
    if (pRows.length > 0) {
      kodePenggunaVal = pRows[0].kode;
    }
  }

  penggunaVal = penggunaVal.slice(0, 30);

  const [result] = await pool.query(
    `UPDATE ga2.tvoucher SET
      tanggal = ?,
      kode_pengguna = ?,
      pengguna = ?,
      id_spbu = ?,
      nopol = ?,
      odometer = ?,
      id_bbm = ?,
      jumlah = ?
     WHERE no_voucher = ? AND id = ?`,
    [
      tanggal,
      kodePenggunaVal || "",
      penggunaVal || "",
      id_spbu || null,
      nopol || null,
      Number(odometer) || 0,
      id_bbm || null,
      Number(jumlah) || 0,
      kode,
      id,
    ],
  );

  if (result.affectedRows === 0) {
    throw new Error(`Data voucher [${kode}] (ID: ${id}) tidak ditemukan.`);
  }

  return { no_voucher: kode, id };
};

// ── DELETE ─────────────────────────────────────────────────────────────
const deleteData = async (kode, id) => {
  const [result] = await pool.query(
    `DELETE FROM ga2.tvoucher WHERE no_voucher = ? AND id = ?`,
    [kode, id]
  );

  if (result.affectedRows === 0) {
    throw new Error(`Data voucher [${kode}] (ID: ${id}) tidak ditemukan.`);
  }

  return { success: true };
};

module.exports = {
  getMaxKode,
  getBrowse,
  getById,
  getLookups,
  create,
  update,
  deleteData,
};
