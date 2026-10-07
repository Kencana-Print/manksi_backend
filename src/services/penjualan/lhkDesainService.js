const db = require("../../config/database");

// ─────────────────────────────────────────────────────────
// Nomor otomatis: LHKD.<tahun><bulan>.<urut 4 digit>
// ─────────────────────────────────────────────────────────
const generateNomor = async (tanggal, conn) => {
  const d = new Date(tanggal);
  const yyyymm = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
  const prefix = `LHKD.${yyyymm}.`;
  const [[row]] = await (conn || db).query(
    `SELECT IFNULL(MAX(CAST(RIGHT(lhk_nomor,4) AS UNSIGNED)),0) AS maxVal
     FROM tlhk_desain WHERE lhk_nomor LIKE ?`,
    [`${prefix}%`],
  );
  const next = Number(row.maxVal) + 1;
  return `${prefix}${String(next).padStart(4, "0")}`;
};

// ─────────────────────────────────────────────────────────
// Tab Outstanding — PD berstatus CLOSE yang belum punya LHK
// ─────────────────────────────────────────────────────────
const getOutstanding = async ({
  startDate,
  endDate,
  customer = "",
  jenisPekerjaan = "",
}) => {
  let where = `WHERE h.pd_status = 'CLOSE' AND l.lhk_nomor IS NULL`;
  const params = [];

  if (startDate && endDate) {
    where += ` AND h.pd_tanggal BETWEEN ? AND ?`;
    params.push(startDate, endDate);
  }
  if (customer) {
    where += ` AND h.pd_customer = ?`;
    params.push(customer);
  }
  if (jenisPekerjaan) {
    where += ` AND h.pd_jenis_pekerjaan = ?`;
    params.push(jenisPekerjaan);
  }

  const [rows] = await db.query(
    `SELECT
       h.pd_nomor AS PdNomor,
       DATE_FORMAT(h.pd_tanggal, '%Y-%m-%d') AS Tanggal,
       h.pd_nama_project AS NamaProject,
       IFNULL(c.cus_nama, '') AS Customer,
       h.pd_jenis_pekerjaan AS JenisPekerjaan,
       h.pd_jml AS Jml,
       h.pd_desainer AS DesainerKode,
       IFNULL(ud.user_nama, h.pd_desainer) AS Desainer,
       DATE_FORMAT(h.pd_tgl_close, '%Y-%m-%d %H:%i') AS TglClose
     FROM tpermintaan_desain h
     LEFT JOIN tcustomer c ON c.cus_kode = h.pd_customer
     LEFT JOIN tuser ud ON ud.user_kode = h.pd_desainer
     LEFT JOIN tlhk_desain l ON l.lhk_pd_nomor = h.pd_nomor
     ${where}
     ORDER BY h.pd_tgl_close DESC`,
    params,
  );
  return rows;
};

// ─────────────────────────────────────────────────────────
// Tab History — riwayat LHK yang sudah dibuat
// ─────────────────────────────────────────────────────────
const getHistory = async ({ startDate, endDate, customer = "" }) => {
  let where = `WHERE 1=1`;
  const params = [];

  if (startDate && endDate) {
    where += ` AND l.lhk_tanggal BETWEEN ? AND ?`;
    params.push(startDate, endDate);
  }
  if (customer) {
    where += ` AND h.pd_customer = ?`;
    params.push(customer);
  }

  const [rows] = await db.query(
    `SELECT
       l.lhk_nomor AS LhkNomor,
       l.lhk_pd_nomor AS PdNomor,
       DATE_FORMAT(l.lhk_tanggal, '%Y-%m-%d') AS Tanggal,
       h.pd_nama_project AS NamaProject,
       IFNULL(c.cus_nama, '') AS Customer,
       l.lhk_pd_jml AS Jml,
       l.lhk_pd_userdesain AS DesainerKode,
       IFNULL(ud.user_nama, l.lhk_pd_userdesain) AS Desainer,
       l.lhk_pd_status AS Status,
       DATE_FORMAT(l.lhk_tgl_selesai, '%Y-%m-%d %H:%i') AS TglSelesai,
       l.lhk_user_create AS UserCreate,
       DATE_FORMAT(l.lhk_date_create, '%Y-%m-%d %H:%i') AS DateCreate
     FROM tlhk_desain l
     LEFT JOIN tpermintaan_desain h ON h.pd_nomor = l.lhk_pd_nomor
     LEFT JOIN tcustomer c ON c.cus_kode = h.pd_customer
     LEFT JOIN tuser ud ON ud.user_kode = l.lhk_pd_userdesain
     ${where}
     ORDER BY l.lhk_date_create DESC`,
    params,
  );
  return rows;
};

// ─────────────────────────────────────────────────────────
// Buat LHK (batch) — dari beberapa PD yang dipilih sekaligus
// ─────────────────────────────────────────────────────────
const createBatch = async (pdNomorList, user) => {
  if (!Array.isArray(pdNomorList) || !pdNomorList.length) {
    throw new Error("Pilih minimal 1 Permintaan Desain.");
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const results = [];
    for (const pdNomor of pdNomorList) {
      const [[pd]] = await conn.query(
        `SELECT pd_nomor, pd_jml, pd_status, pd_desainer FROM tpermintaan_desain WHERE pd_nomor = ? FOR UPDATE`,
        [pdNomor],
      );
      if (!pd) throw new Error(`PD ${pdNomor} tidak ditemukan.`);
      if (pd.pd_status !== "CLOSE") {
        throw new Error(`PD ${pdNomor} belum berstatus CLOSE.`);
      }

      const [[existing]] = await conn.query(
        `SELECT lhk_nomor FROM tlhk_desain WHERE lhk_pd_nomor = ?`,
        [pdNomor],
      );
      if (existing) {
        throw new Error(
          `PD ${pdNomor} sudah punya LHK (${existing.lhk_nomor}).`,
        );
      }

      const today = new Date();
      const lhkNomor = await generateNomor(today, conn);

      await conn.query(
        `INSERT INTO tlhk_desain
           (lhk_nomor, lhk_pd_nomor, lhk_pd_status, lhk_pd_jml, lhk_pd_userdesain,
            lhk_tanggal, lhk_tgl_selesai, lhk_user_create, lhk_date_create)
         VALUES (?, ?, 'SELESAI', ?, ?, CURDATE(), NOW(), ?, NOW())`,
        [lhkNomor, pdNomor, pd.pd_jml, pd.pd_desainer, user.kode],
      );

      results.push({ pdNomor, lhkNomor });
    }

    await conn.commit();
    return results;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
};

module.exports = { getOutstanding, getHistory, createBatch, generateNomor };
