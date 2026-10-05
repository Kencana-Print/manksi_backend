const db = require("../../config/database");

const resolveStatus = (jml, jmljadi) => {
  if (jmljadi <= 0) return "OPEN";
  if (jmljadi >= jml) return "CLOSE";
  return "PROGRESS";
};

const AUTO_STATUSES = ["OPEN", "PROGRESS", "CLOSE"];
const MANUAL_STATUSES = ["PENDING", "CANCEL", "CANCEL_ALT"];

// ─────────────────────────────────────────────────────────
// Nomor otomatis: PD.<tahun>.<urut 5 digit>
// ─────────────────────────────────────────────────────────
const generateNomor = async (tanggal, conn) => {
  const year = new Date(tanggal).getFullYear();
  const prefix = `PD.${year}.`;
  const [[row]] = await (conn || db).query(
    `SELECT IFNULL(MAX(CAST(RIGHT(pd_nomor,5) AS UNSIGNED)),0) AS maxVal
     FROM tpermintaan_desain WHERE pd_nomor LIKE ?`,
    [`${prefix}%`],
  );
  const next = Number(row.maxVal) + 1;
  return `${prefix}${String(next).padStart(5, "0")}`;
};

// ─────────────────────────────────────────────────────────
// Browse — filter tanggal, status, customer, marketing, jenis pekerjaan
// ─────────────────────────────────────────────────────────
const getBrowse = async ({
  startDate,
  endDate,
  status = "",
  customer = "",
  marketing = "",
  jenisPekerjaan = "",
}) => {
  let where = `WHERE 1=1`;
  const params = [];

  if (startDate && endDate) {
    where += ` AND h.pd_tanggal BETWEEN ? AND ?`;
    params.push(startDate, endDate);
  }
  if (status) {
    where += ` AND h.pd_status = ?`;
    params.push(status);
  }
  if (customer) {
    where += ` AND h.pd_customer = ?`;
    params.push(customer);
  }
  if (marketing) {
    where += ` AND h.pd_nama_marketing = ?`;
    params.push(marketing);
  }
  if (jenisPekerjaan) {
    where += ` AND h.pd_jenis_pekerjaan = ?`;
    params.push(jenisPekerjaan);
  }

  const [rows] = await db.query(
    `SELECT
       h.pd_nomor AS Nomor,
       DATE_FORMAT(h.pd_tanggal, '%Y-%m-%d') AS Tanggal,
       h.pd_nama_project AS NamaProject,
       h.pd_nama_marketing AS Marketing,
       IFNULL(um.user_nama, h.pd_nama_marketing) AS NamaMarketing,
       h.pd_customer AS CustomerKode,
       IFNULL(c.cus_nama, '') AS Customer,
       h.pd_jenis_pekerjaan AS JenisPekerjaan,
       DATE_FORMAT(h.pd_dateline, '%Y-%m-%d') AS Dateline,
       h.pd_keterangan AS Keterangan,
       h.pd_jml AS Jml,
       h.pd_jmljadi AS JmlJadi,
       h.pd_status AS Status,
       IF(h.pd_status IN ('PENDING','CANCEL','CANCEL_ALT'), 1, 0) AS IsStatusManual,
       h.pd_prioritas AS Prioritas,
       h.pd_desainer AS DesainerKode,
       IFNULL(ud.user_nama, h.pd_desainer) AS Desainer,
       h.pd_referensi AS Referensi,
       DATE_FORMAT(h.pd_tgl_close, '%Y-%m-%d %H:%i') AS TglClose,
       h.pd_user_create AS UserCreate,
       DATE_FORMAT(h.pd_date_create, '%Y-%m-%d %H:%i') AS DateCreate
     FROM tpermintaan_desain h
     LEFT JOIN tcustomer c ON c.cus_kode = h.pd_customer
     LEFT JOIN tuser um ON um.user_kode = h.pd_nama_marketing
     LEFT JOIN tuser ud ON ud.user_kode = h.pd_desainer
     ${where}
     ORDER BY h.pd_tanggal DESC, h.pd_nomor DESC`,
    params,
  );
  return rows;
};

// ─────────────────────────────────────────────────────────
// Detail — header + rincian item desain
// ─────────────────────────────────────────────────────────
const getDetail = async (nomor) => {
  const [[header]] = await db.query(
    `SELECT
       h.pd_nomor, DATE_FORMAT(h.pd_tanggal,'%Y-%m-%d') AS pd_tanggal,
       h.pd_nama_project, h.pd_nama_marketing, h.pd_customer,
       IFNULL(c.cus_nama, '') AS pd_customer_nama,
       h.pd_jenis_pekerjaan, DATE_FORMAT(h.pd_dateline,'%Y-%m-%d') AS pd_dateline,
       h.pd_keterangan, h.pd_jml, h.pd_jmljadi, h.pd_status,
       h.pd_prioritas, h.pd_desainer, h.pd_referensi,
       DATE_FORMAT(h.pd_tgl_close,'%Y-%m-%d %H:%i') AS pd_tgl_close
     FROM tpermintaan_desain h
     LEFT JOIN tcustomer c ON c.cus_kode = h.pd_customer
     WHERE h.pd_nomor = ?`,
    [nomor],
  );
  if (!header) throw new Error("Permintaan Desain tidak ditemukan.");

  const [items] = await db.query(
    `SELECT pd2_id, pd2_pd_desain, pd2_pd_jml
     FROM tpermintaan_desain_detail WHERE pd2_pd_nomor = ? ORDER BY pd2_id`,
    [nomor],
  );

  return { ...header, detail: items };
};

// ─────────────────────────────────────────────────────────
// Update progres — Tim Desain input jumlah jadi (total, header-level)
// ─────────────────────────────────────────────────────────
const updateProgress = async (nomor, jmlJadi) => {
  const [[row]] = await db.query(
    `SELECT pd_jml, pd_status FROM tpermintaan_desain WHERE pd_nomor = ?`,
    [nomor],
  );
  if (!row) throw new Error("Permintaan Desain tidak ditemukan.");

  if (!AUTO_STATUSES.includes(row.pd_status)) {
    throw new Error(
      "PD berstatus manual (Pending/Cancel/Cancel Alt). Aktifkan kembali dulu sebelum update progress.",
    );
  }

  const jml = Number(row.pd_jml);
  const jadi = Math.max(0, Math.min(Number(jmlJadi) || 0, jml));
  const status = resolveStatus(jml, jadi);

  await db.query(
    `UPDATE tpermintaan_desain
     SET pd_jmljadi = ?, pd_status = ?,
         pd_tgl_close = IF(? = 'CLOSE', NOW(), NULL)
     WHERE pd_nomor = ?`,
    [jadi, status, status, nomor],
  );

  return { nomor, jmljadi: jadi, status };
};

// ─────────────────────────────────────────────────────────
// Assign / ubah desainer
// ─────────────────────────────────────────────────────────
const updateDesainer = async (nomor, desainerKode) => {
  await db.query(
    `UPDATE tpermintaan_desain SET pd_desainer = ? WHERE pd_nomor = ?`,
    [desainerKode || null, nomor],
  );
  return { nomor, desainer: desainerKode };
};

// ─────────────────────────────────────────────────────────
// Set status manual — Pending / Cancel / Cancel Alt
// ─────────────────────────────────────────────────────────
const setStatusManual = async (nomor, { status, keterangan, referensi }) => {
  if (!MANUAL_STATUSES.includes(status)) {
    throw new Error("Status tidak valid.");
  }
  if (!keterangan || !keterangan.trim()) {
    throw new Error("Keterangan wajib diisi.");
  }

  const [[row]] = await db.query(
    `SELECT pd_nomor FROM tpermintaan_desain WHERE pd_nomor = ?`,
    [nomor],
  );
  if (!row) throw new Error("Permintaan Desain tidak ditemukan.");

  const [[lhk]] = await db.query(
    `SELECT lhk_nomor FROM tlhk_desain WHERE lhk_pd_nomor = ?`,
    [nomor],
  );
  if (lhk) {
    throw new Error(
      `PD ini sudah punya LHK Desain (${lhk.lhk_nomor}), status tidak bisa diubah.`,
    );
  }

  let pdReferensi = null;
  if (status === "CANCEL_ALT") {
    if (!referensi || !referensi.trim()) {
      throw new Error("PD terkait wajib diisi untuk status Cancel Alt.");
    }
    if (referensi.trim() === nomor) {
      throw new Error("PD terkait tidak boleh menunjuk ke PD ini sendiri.");
    }
    const [[ref]] = await db.query(
      `SELECT pd_nomor, pd_status FROM tpermintaan_desain WHERE pd_nomor = ?`,
      [referensi.trim()],
    );
    if (!ref) throw new Error("PD terkait tidak ditemukan.");
    if (ref.pd_status !== "CLOSE") {
      throw new Error("PD terkait harus berstatus Close (sudah di-ACC).");
    }
    pdReferensi = referensi.trim();
  }

  await db.query(
    `UPDATE tpermintaan_desain
     SET pd_status = ?, pd_keterangan = ?, pd_referensi = ?
     WHERE pd_nomor = ?`,
    [status, keterangan.trim(), pdReferensi, nomor],
  );

  return {
    nomor,
    status,
    keterangan: keterangan.trim(),
    referensi: pdReferensi,
  };
};

// ─────────────────────────────────────────────────────────
// Aktifkan Kembali — resume ke perhitungan status otomatis
// ─────────────────────────────────────────────────────────
const resumeStatus = async (nomor) => {
  const [[row]] = await db.query(
    `SELECT pd_jml, pd_jmljadi, pd_status FROM tpermintaan_desain WHERE pd_nomor = ?`,
    [nomor],
  );
  if (!row) throw new Error("Permintaan Desain tidak ditemukan.");
  if (AUTO_STATUSES.includes(row.pd_status)) {
    throw new Error("PD ini tidak dalam status manual.");
  }

  const status = resolveStatus(Number(row.pd_jml), Number(row.pd_jmljadi));

  await db.query(
    `UPDATE tpermintaan_desain
     SET pd_status = ?, pd_tgl_close = IF(? = 'CLOSE', NOW(), NULL)
     WHERE pd_nomor = ?`,
    [status, status, nomor],
  );

  return { nomor, status };
};

const searchReferensi = async ({ q = "", page = 1, limit = 50 }) => {
  const offset = (Number(page) - 1) * Number(limit);
  const like = `%${q}%`;
  const [items] = await db.query(
    `SELECT p.pd_nomor AS Nomor, p.pd_tanggal AS Tanggal, p.pd_nama_project AS NamaProject,
            c.cus_nama AS Customer
     FROM tpermintaan_desain p
     LEFT JOIN tcustomer c ON c.cus_kode = p.pd_customer
     WHERE p.pd_nomor LIKE ? OR p.pd_nama_project LIKE ?
     ORDER BY p.pd_date_create DESC
     LIMIT ? OFFSET ?`,
    [like, like, Number(limit), offset],
  );
  const [[{ total }]] = await db.query(
    `SELECT COUNT(*) AS total FROM tpermintaan_desain p
     WHERE p.pd_nomor LIKE ? OR p.pd_nama_project LIKE ?`,
    [like, like],
  );
  return { items, total };
};

const getDesainerOptions = async () => {
  const [rows] = await db.query(
    `SELECT user_kode AS Kode, user_nama AS Nama
     FROM tuser
     WHERE user_bagian = 'DESAIN' AND user_kode IN ('DINDUN', 'RISKI')
     ORDER BY user_nama`,
  );
  return rows;
};

module.exports = {
  getBrowse,
  getDetail,
  updateProgress,
  updateDesainer,
  setStatusManual,
  resumeStatus,
  searchReferensi,
  getDesainerOptions,
};
