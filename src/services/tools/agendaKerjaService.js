const db = require("../../config/database");

const isUserHo = (cab) => !cab || cab === "HO-";

const generateNomor = async (conn, tanggal) => {
  const tahun = new Date(tanggal).getFullYear();
  const [rows] = await conn.query(
    `SELECT IFNULL(MAX(CAST(SUBSTR(ag_nomor, 4, 5) AS UNSIGNED)), 0) AS jumlah
     FROM tagenda_kerja
     WHERE RIGHT(ag_nomor, 4) = ? FOR UPDATE`,
    [String(tahun)],
  );
  const next = Number(rows[0].jumlah) + 1;
  return `AG/${String(next).padStart(5, "0")}/${tahun}`;
};

const isPicAgenda = async (userKode, bagian, cabang) => {
  const [[row]] = await db.query(
    `SELECT 1 AS ada FROM tagenda_pic
     WHERE pic_bagian = ? AND pic_cabang = ? AND pic_user_kode = ?`,
    [bagian, cabang, userKode],
  );
  return !!row;
};

const getBrowse = async (startDate, endDate, userBagian, userCab) => {
  const ho = isUserHo(userCab);
  let query = `
    SELECT ag_nomor AS Nomor, ag_tanggal AS Tanggal, ag_judul AS Judul,
           ag_keterangan AS Keterangan, ag_bagian AS Bagian, ag_cabang AS Cabang,
           ag_status AS Status, user_create AS UserCreate
    FROM tagenda_kerja
    WHERE ag_bagian = ?
      AND ag_tanggal >= ? AND ag_tanggal < DATE_ADD(?, INTERVAL 1 DAY)
  `;
  const params = [userBagian, startDate, endDate];
  if (!ho) {
    query += ` AND ag_cabang = ?`;
    params.push(userCab);
  }
  query += ` ORDER BY ag_tanggal ASC, ag_nomor ASC`;
  const [rows] = await db.query(query, params);
  return rows.map((r) => ({ ...r, Sumber: "MANUAL" }));
};

const getBadgeCount = async (userBagian, userCab) => {
  const ho = isUserHo(userCab);
  let query = `
    SELECT COUNT(*) AS jumlah
    FROM tagenda_kerja
    WHERE ag_bagian = ? AND ag_status = 'OPEN' AND ag_tanggal = CURDATE()
  `;
  const params = [userBagian];
  if (!ho) {
    query += ` AND ag_cabang = ?`;
    params.push(userCab);
  }
  const [[row]] = await db.query(query, params);
  return Number(row.jumlah) || 0;
};

const getById = async (nomor) => {
  const [rows] = await db.query(
    `SELECT ag_nomor AS Nomor, ag_tanggal AS Tanggal, ag_judul AS Judul,
            ag_keterangan AS Keterangan, ag_bagian AS Bagian, ag_cabang AS Cabang,
            ag_status AS Status, user_create AS UserCreate
     FROM tagenda_kerja WHERE ag_nomor = ?`,
    [nomor],
  );
  return rows[0] || null;
};

const save = async (data, user) => {
  const { ag_nomor, ag_tanggal, ag_judul, ag_keterangan } = data;

  if (!ag_tanggal) throw new Error("Tanggal harus diisi.");
  if (!ag_judul || !ag_judul.trim()) throw new Error("Judul harus diisi.");

  const cabangToStore = isUserHo(user.cabang) ? "HO-" : user.cabang;

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    if (ag_nomor) {
      const [[existing]] = await conn.query(
        `SELECT user_create FROM tagenda_kerja WHERE ag_nomor = ? FOR UPDATE`,
        [ag_nomor],
      );
      if (!existing) throw new Error("Data agenda tidak ditemukan.");
      if (existing.user_create !== user.kode) {
        throw new Error("Hanya pembuat yang bisa mengubah agenda ini.");
      }
      await conn.query(
        `UPDATE tagenda_kerja SET
           ag_tanggal = ?, ag_judul = ?, ag_keterangan = ?,
           user_modified = ?, date_modified = NOW()
         WHERE ag_nomor = ?`,
        [ag_tanggal, ag_judul.trim(), ag_keterangan || "", user.kode, ag_nomor],
      );
      await conn.commit();
      return { nomor: ag_nomor };
    }

    const boleh = await isPicAgenda(user.kode, user.bagian, cabangToStore);
    if (!boleh) {
      throw new Error(
        "Anda bukan PIC agenda untuk bagian/cabang ini. Hubungi kepala bagian untuk didaftarkan.",
      );
    }

    const nomor = await generateNomor(conn, ag_tanggal);
    await conn.query(
      `INSERT INTO tagenda_kerja
         (ag_nomor, ag_tanggal, ag_judul, ag_keterangan, ag_bagian, ag_cabang,
          ag_status, user_create, date_create)
       VALUES (?, ?, ?, ?, ?, ?, 'OPEN', ?, NOW())`,
      [
        nomor,
        ag_tanggal,
        ag_judul.trim(),
        ag_keterangan || "",
        user.bagian,
        cabangToStore,
        user.kode,
      ],
    );
    await conn.commit();
    return { nomor };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
};

const updateStatus = async (nomor, status, userKode) => {
  if (!["OPEN", "SELESAI", "BATAL"].includes(status)) {
    throw new Error("Status tidak valid.");
  }
  const [[existing]] = await db.query(
    `SELECT user_create FROM tagenda_kerja WHERE ag_nomor = ?`,
    [nomor],
  );
  if (!existing) throw new Error("Data agenda tidak ditemukan.");
  if (existing.user_create !== userKode) {
    throw new Error("Hanya pembuat yang bisa mengubah status agenda ini.");
  }
  await db.query(
    `UPDATE tagenda_kerja SET ag_status = ?, user_modified = ?, date_modified = NOW()
     WHERE ag_nomor = ?`,
    [status, userKode, nomor],
  );
  return true;
};

const remove = async (nomor, userKode) => {
  const [[existing]] = await db.query(
    `SELECT user_create FROM tagenda_kerja WHERE ag_nomor = ?`,
    [nomor],
  );
  if (!existing) throw new Error("Data agenda tidak ditemukan.");
  if (existing.user_create !== userKode) {
    throw new Error("Hanya pembuat yang bisa menghapus agenda ini.");
  }
  await db.query(`DELETE FROM tagenda_kerja WHERE ag_nomor = ?`, [nomor]);
  return true;
};

module.exports = {
  getBrowse,
  getBadgeCount,
  getById,
  isPicAgenda,
  save,
  updateStatus,
  remove,
};
