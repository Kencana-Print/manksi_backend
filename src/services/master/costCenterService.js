const db = require("../../config/database");

// Browse — header + detail
const getAll = async () => {
  const [headers] = await db.query(
    `SELECT cc_kode AS kode, cc_nama AS nama FROM finance.tcostcenter ORDER BY cc_kode`,
  );
  const [details] = await db.query(
    `SELECT dc_kode AS kode, dc_nama AS nama FROM finance.tcostcenteritem ORDER BY dc_kode, dc_nama`,
  );
  return headers.map((h) => ({
    ...h,
    detail: details.filter((d) => d.kode === h.kode),
  }));
};

// Cek apakah detail sudah dipakai di jurnal
const cekPakai = async (kode, nama, conn) => {
  const c = conn || db;
  const [rows] = await c.query(
    `SELECT 1 FROM finance.tjurnalitem WHERE jurd_cc_kode = ? AND jurd_dcnama = ? LIMIT 1`,
    [kode, nama],
  );
  return rows.length > 0;
};

// Get single untuk form edit
const getById = async (kode) => {
  const [[header]] = await db.query(
    `SELECT cc_kode AS kode, cc_nama AS nama FROM finance.tcostcenter WHERE cc_kode = ?`,
    [kode],
  );
  if (!header) throw new Error("Cost Center tidak ditemukan.");

  const [details] = await db.query(
    `SELECT dc_nama AS nama FROM finance.tcostcenteritem WHERE dc_kode = ? ORDER BY dc_nama`,
    [kode],
  );

  const detailWithFlag = await Promise.all(
    details.map(async (d) => ({
      nama: d.nama,
      pakai: await cekPakai(kode, d.nama),
    })),
  );

  return { ...header, detail: detailWithFlag };
};

// Nomor otomatis
const getMaxNomor = async (conn) => {
  const [[row]] = await (conn || db).query(
    `SELECT IFNULL(MAX(cc_kode), 0) AS max_val FROM finance.tcostcenter`,
  );
  return String(Number(row.max_val) + 1);
};

// Simpan (insert/update)
const saveData = async (payload) => {
  const { isEdit, kode, nama, detail } = payload;
  const conn = await db.getConnection();
  await conn.beginTransaction();
  try {
    let nomor = kode;

    if (isEdit) {
      await conn.query(
        `UPDATE finance.tcostcenter SET cc_nama = ? WHERE cc_kode = ?`,
        [nama, kode],
      );
    } else {
      nomor = await getMaxNomor(conn);
      await conn.query(
        `INSERT INTO finance.tcostcenter (cc_kode, cc_nama) VALUES (?, ?)`,
        [nomor, nama],
      );
    }

    // Hapus semua detail lama, insert ulang
    await conn.query(`DELETE FROM finance.tcostcenteritem WHERE dc_kode = ?`, [
      nomor,
    ]);

    for (const d of detail) {
      if (!d.nama?.trim()) continue;
      await conn.query(
        `INSERT INTO finance.tcostcenteritem (dc_kode, dc_nama) VALUES (?, ?)`,
        [nomor, d.nama.trim()],
      );
    }

    await conn.commit();
    return { kode: nomor };
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
};

// Hapus — cek semua detail dulu
const deleteData = async (kode) => {
  const [details] = await db.query(
    `SELECT dc_nama AS nama FROM finance.tcostcenteritem WHERE dc_kode = ?`,
    [kode],
  );

  for (const d of details) {
    const dipakai = await cekPakai(kode, d.nama);
    if (dipakai)
      throw new Error(
        `Detail "${d.nama}" sudah dipakai untuk transaksi. Tidak bisa dihapus.`,
      );
  }

  const conn = await db.getConnection();
  await conn.beginTransaction();
  try {
    await conn.query(`DELETE FROM finance.tcostcenteritem WHERE dc_kode = ?`, [
      kode,
    ]);
    await conn.query(`DELETE FROM finance.tcostcenter WHERE cc_kode = ?`, [
      kode,
    ]);
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
};

module.exports = { getAll, getById, saveData, deleteData };
