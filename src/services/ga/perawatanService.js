const pool = require("../../config/database");

/**
 * Service Perawatan Kendaraan GA (ga2.tperawatan_hdr & ga2.tperawatan_dtl)
 * Rujukan dari Delphi 7:
 * - ufrmBrowsePerawatan.pas
 * - ufrmPerawatan.pas
 */

// ── GENERATE NOMOR OTOMATIS (PRWYYYY.XXXXX) ────────────────────────────
const generateNomor = async (tanggal, conn = null) => {
  const db = conn || pool;
  const d = new Date(tanggal || new Date());
  const year = d.getFullYear();
  const prefix = `PRW${year}.`;

  const [rows] = await db.query(
    `SELECT IFNULL(MAX(CAST(RIGHT(prw_nomor, 5) AS UNSIGNED)), 0) AS max_num 
     FROM ga2.tperawatan_hdr 
     WHERE prw_nomor LIKE ?`,
    [`${prefix}%`],
  );

  const maxVal = Number(rows[0]?.max_num || 0);
  const nextNum = maxVal + 1;
  return `${prefix}${String(nextNum).padStart(5, "0")}`;
};

// ── GET BROWSE ─────────────────────────────────────────────────────────
const getBrowse = async ({ tglAwal, tglAkhir }) => {
  const query = `
    SELECT 
      h.prw_nomor AS Nomor,
      DATE_FORMAT(h.prw_tanggal, '%Y-%m-%d') AS Tanggal,
      IFNULL(h.prw_bengkel, '') AS Bengkel,
      IFNULL(h.prw_ket, '') AS Keterangan,
      IFNULL(h.prw_nopol, '') AS NoPolisi,
      IFNULL(k.stat, '') AS Stat,
      IFNULL(h.prw_km, 0) AS KM,
      IFNULL(k.Keterangan, '') AS NamaKendaraan,
      (
        SELECT IFNULL(SUM(d.prwd_qty * d.prwd_nilai), 0)
        FROM ga2.tperawatan_dtl d
        WHERE d.prwd_nomor = h.prw_nomor
      ) AS TotalBiaya
    FROM ga2.tperawatan_hdr h
    LEFT JOIN ga2.kendaraan k ON k.nopol = h.prw_nopol
    WHERE h.prw_tanggal BETWEEN ? AND ?
    ORDER BY h.prw_nomor DESC
  `;

  const [rows] = await pool.query(query, [tglAwal, tglAkhir]);
  return rows;
};

// ── GET DETAIL PER NOMOR ───────────────────────────────────────────────
const getDetail = async (nomor) => {
  const query = `
    SELECT 
      d.prwd_nomor AS Nomor,
      d.prwd_nourut AS No_urut,
      IFNULL(d.prwd_nama, '') AS Nama,
      IFNULL(d.prwd_satuan, '') AS Satuan,
      IFNULL(d.prwd_qty, 0) AS Qty,
      IFNULL(d.prwd_nilai, 0) AS Nominal,
      IFNULL(d.prwd_qty * d.prwd_nilai, 0) AS Total,
      DATE_FORMAT(d.prwd_tglbeli, '%Y-%m-%d') AS TglBeli
    FROM ga2.tperawatan_dtl d
    WHERE d.prwd_nomor = ?
    ORDER BY d.prwd_nourut ASC
  `;

  const [rows] = await pool.query(query, [nomor]);
  return rows;
};

// ── GET BY ID (Header + Detail) ────────────────────────────────────────
const getById = async (nomor) => {
  const query = `
    SELECT 
      h.prw_nomor AS nomor,
      DATE_FORMAT(h.prw_tanggal, '%Y-%m-%d') AS tanggal,
      IFNULL(h.prw_bengkel, '') AS bengkel,
      IFNULL(h.prw_ket, '') AS keterangan,
      IFNULL(h.prw_nopol, '') AS nopol,
      IFNULL(h.prw_km, 0) AS km,
      IFNULL(k.stat, '') AS stat,
      IFNULL(k.Keterangan, '') AS namaKendaraan
    FROM ga2.tperawatan_hdr h
    LEFT JOIN ga2.kendaraan k ON k.nopol = h.prw_nopol
    WHERE h.prw_nomor = ?
  `;

  const [rows] = await pool.query(query, [nomor]);
  if (!rows.length) {
    throw new Error(`Data Perawatan ${nomor} tidak ditemukan.`);
  }

  const header = rows[0];
  const items = await getDetail(nomor);

  return {
    ...header,
    items,
  };
};

// ── SEARCH KENDARAAN (Bantuan NoPolisi) ─────────────────────────────────
const searchKendaraan = async (search = "") => {
  let query = `
    SELECT 
      nopol AS Nopol,
      IFNULL(stat, 'INVENTARIS') AS Stat,
      IFNULL(Keterangan, '') AS Keterangan,
      IFNULL(kmterakhir, 0) AS KmTerakhir
    FROM ga2.kendaraan
  `;
  const params = [];
  if (search && search.trim()) {
    query += ` WHERE nopol LIKE ? OR Keterangan LIKE ?`;
    const term = `%${search.trim()}%`;
    params.push(term, term);
  }
  query += ` ORDER BY nopol ASC LIMIT 50`;

  const [rows] = await pool.query(query, params);
  return rows;
};

// ── SIMPAN DATA (CREATE) ───────────────────────────────────────────────
const create = async (payload) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const {
      tanggal,
      nopol,
      km = 0,
      bengkel = "",
      keterangan = "",
      items = [],
    } = payload;

    const nopolVal = (nopol || "").trim().toUpperCase();
    const bengkelVal = (bengkel || "").trim().toUpperCase();
    const ketVal = (keterangan || "").trim().toUpperCase();
    const kmVal = Number(km) || 0;

    if (!nopolVal) throw new Error("No. Polisi harus diisi.");
    if (kmVal <= 0) throw new Error("KM harus diisi dan lebih dari 0.");

    // Validasi detail minimal 1 item terisi
    const validItems = items.filter((i) => (i.nama || "").trim() !== "");
    if (!validItems.length) {
      throw new Error("Minimal isi 1 baris rincian perawatan (Nama harus diisi).");
    }

    // Auto-generate nomor PRWYYYY.XXXXX
    const nomor = await generateNomor(tanggal, conn);

    // Simpan Header ke ga2.tperawatan_hdr
    await conn.query(
      `INSERT INTO ga2.tperawatan_hdr (
        prw_nomor, prw_tanggal, prw_bengkel, prw_ket, prw_nopol, prw_km
      ) VALUES (?, ?, ?, ?, ?, ?)`,
      [nomor, tanggal, bengkelVal, ketVal, nopolVal, kmVal],
    );

    // Simpan Detail ke ga2.tperawatan_dtl
    let nourut = 1;
    for (const item of validItems) {
      const namaItem = (item.nama || "").trim().toUpperCase();
      const satuanItem = (item.satuan || "").trim().toUpperCase();
      const qtyItem = Number(item.qty) || 0;
      const nilaiItem = Number(item.nilai || item.nominal) || 0;
      const tglBeli = item.tglBeli || item.tglbeli || null;

      await conn.query(
        `INSERT INTO ga2.tperawatan_dtl (
          prwd_nomor, prwd_nama, prwd_satuan, prwd_qty, prwd_nilai, prwd_nourut, prwd_tglbeli
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [nomor, namaItem, satuanItem, qtyItem, nilaiItem, nourut, tglBeli],
      );
      nourut++;
    }

    // Update KM Terakhir di master kendaraan jika KM perawatan lebih besar
    await conn.query(
      `UPDATE ga2.kendaraan SET kmterakhir = GREATEST(IFNULL(kmterakhir, 0), ?) WHERE nopol = ?`,
      [kmVal, nopolVal],
    );

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
const update = async (nomor, payload) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const {
      tanggal,
      nopol,
      km = 0,
      bengkel = "",
      keterangan = "",
      items = [],
    } = payload;

    const nopolVal = (nopol || "").trim().toUpperCase();
    const bengkelVal = (bengkel || "").trim().toUpperCase();
    const ketVal = (keterangan || "").trim().toUpperCase();
    const kmVal = Number(km) || 0;

    if (!nopolVal) throw new Error("No. Polisi harus diisi.");
    if (kmVal <= 0) throw new Error("KM harus diisi dan lebih dari 0.");

    const validItems = items.filter((i) => (i.nama || "").trim() !== "");
    if (!validItems.length) {
      throw new Error("Minimal isi 1 baris rincian perawatan (Nama harus diisi).");
    }

    // Update Header
    const [res] = await conn.query(
      `UPDATE ga2.tperawatan_hdr SET 
        prw_tanggal = ?,
        prw_bengkel = ?,
        prw_ket = ?,
        prw_nopol = ?,
        prw_km = ?
      WHERE prw_nomor = ?`,
      [tanggal, bengkelVal, ketVal, nopolVal, kmVal, nomor],
    );

    if (res.affectedRows === 0) {
      throw new Error(`Data Perawatan ${nomor} tidak ditemukan.`);
    }

    // Hapus detail lama
    await conn.query(`DELETE FROM ga2.tperawatan_dtl WHERE prwd_nomor = ?`, [
      nomor,
    ]);

    // Insert detail baru
    let nourut = 1;
    for (const item of validItems) {
      const namaItem = (item.nama || "").trim().toUpperCase();
      const satuanItem = (item.satuan || "").trim().toUpperCase();
      const qtyItem = Number(item.qty) || 0;
      const nilaiItem = Number(item.nilai || item.nominal) || 0;
      const tglBeli = item.tglBeli || item.tglbeli || null;

      await conn.query(
        `INSERT INTO ga2.tperawatan_dtl (
          prwd_nomor, prwd_nama, prwd_satuan, prwd_qty, prwd_nilai, prwd_nourut, prwd_tglbeli
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [nomor, namaItem, satuanItem, qtyItem, nilaiItem, nourut, tglBeli],
      );
      nourut++;
    }

    // Update KM Terakhir di kendaraan
    await conn.query(
      `UPDATE ga2.kendaraan SET kmterakhir = GREATEST(IFNULL(kmterakhir, 0), ?) WHERE nopol = ?`,
      [kmVal, nopolVal],
    );

    await conn.commit();
    return { nomor };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
};

// ── HAPUS DATA (DELETE) ────────────────────────────────────────────────
const deleteData = async (nomor) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    await conn.query(`DELETE FROM ga2.tperawatan_dtl WHERE prwd_nomor = ?`, [
      nomor,
    ]);
    const [res] = await conn.query(
      `DELETE FROM ga2.tperawatan_hdr WHERE prw_nomor = ?`,
      [nomor],
    );

    if (res.affectedRows === 0) {
      throw new Error(`Data Perawatan ${nomor} tidak ditemukan.`);
    }

    await conn.commit();
    return { success: true };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
};

module.exports = {
  generateNomor,
  getBrowse,
  getDetail,
  getById,
  searchKendaraan,
  create,
  update,
  deleteData,
};
