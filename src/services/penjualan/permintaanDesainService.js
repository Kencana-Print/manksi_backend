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
     WHERE user_bagian = 'DESAIN' AND user_kode IN ('DINDUN', 'RIZKI')
     ORDER BY user_nama`,
  );
  return rows;
};

const EDIT_SUPER_BAGIAN = ["EDP", "IT"];

const hasLhk = async (conn, nomor) => {
  // GANTI: copy query cek LHK yang sama persis dari setStatusManual
  const [rows] = await conn.query(
    "SELECT 1 AS x FROM tlhk_desain WHERE lhk_pd_nomor = ? LIMIT 1",
    [nomor],
  );
  return rows.length > 0;
};

const updateHeader = async (nomor, payload, user) => {
  const p = payload || {};
  const bagian = String(user?.bagian || "")
    .toUpperCase()
    .trim();
  const kode = String(user?.kode || "").trim();
  const isSuper = EDIT_SUPER_BAGIAN.includes(bagian);

  if (bagian === "DESAIN" && !isSuper) {
    throw new Error("Bagian Desain tidak dapat mengedit data permintaan");
  }

  const namaProject = String(p.namaProject ?? "").trim();
  const customer = String(p.customer ?? "").trim();
  const customerNama = String(p.customerNama ?? "").trim();
  const jenisPekerjaan = String(p.jenisPekerjaan ?? "").trim();
  const keterangan = p.keterangan == null ? null : String(p.keterangan).trim();
  const dateline = p.dateline ? String(p.dateline).slice(0, 10) : null;

  if (!namaProject) throw new Error("Nama project wajib diisi");
  if (!jenisPekerjaan) throw new Error("Jenis pekerjaan wajib diisi");

  // items opsional: undefined = detail & jumlah tidak diubah
  let items = null;
  if (Array.isArray(p.items)) {
    items = p.items.map((it) => ({
      id: it.id ? Number(it.id) : null,
      desain: String(it.desain ?? "").trim(),
      jml: Number(it.jml),
    }));
    if (items.length === 0) throw new Error("Detail minimal 1 baris");
    for (const it of items) {
      if (!it.desain) throw new Error("Nama desain pada detail wajib diisi");
      if (!Number.isInteger(it.jml) || it.jml <= 0)
        throw new Error("Jumlah detail harus bilangan bulat > 0");
    }
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [[pd]] = await conn.query(
      "SELECT * FROM tpermintaan_desain WHERE pd_nomor = ? FOR UPDATE",
      [nomor],
    );
    if (!pd) throw new Error("Permintaan desain tidak ditemukan");

    if (!isSuper) {
      const pemilik =
        String(pd.pd_marketing || "") === kode ||
        String(pd.pd_user_create || "") === kode;
      if (!pemilik)
        throw new Error("Hanya pembuat/marketing PD yang dapat mengedit");
    }

    if (MANUAL_STATUSES.includes(pd.pd_status))
      throw new Error(
        `PD berstatus ${pd.pd_status}, lakukan resume terlebih dahulu`,
      );
    if (pd.pd_status === "CLOSE")
      throw new Error("PD yang sudah CLOSE tidak dapat diedit");
    if (await hasLhk(conn, nomor))
      throw new Error("PD sudah memiliki LHK, tidak dapat diedit");

    let jmlBaru = Number(pd.pd_jml);
    const jmlJadi = Number(pd.pd_jmljadi || 0);

    if (items) {
      jmlBaru = items.reduce((s, it) => s + it.jml, 0);
      if (jmlBaru < jmlJadi)
        throw new Error(
          `Total jumlah (${jmlBaru}) tidak boleh kurang dari yang sudah jadi (${jmlJadi})`,
        );

      const [existing] = await conn.query(
        "SELECT pd2_id FROM tpermintaan_desain_detail WHERE pd2_nomor = ?",
        [nomor],
      );
      const existingIds = new Set(existing.map((r) => Number(r.pd2_id)));

      for (const it of items) {
        if (it.id && !existingIds.has(it.id))
          throw new Error("Baris detail tidak valid untuk PD ini");
      }

      const keepIds = new Set(items.filter((it) => it.id).map((it) => it.id));
      const hapus = [...existingIds].filter((id) => !keepIds.has(id));
      if (hapus.length) {
        await conn.query(
          "DELETE FROM tpermintaan_desain_detail WHERE pd2_nomor = ? AND pd2_id IN (?)",
          [nomor, hapus],
        );
      }
      for (const it of items) {
        if (it.id) {
          await conn.query(
            "UPDATE tpermintaan_desain_detail SET pd2_pd_desain = ?, pd2_pd_jml = ? WHERE pd2_id = ? AND pd2_nomor = ?",
            [it.desain, it.jml, it.id, nomor],
          );
        } else {
          await conn.query(
            "INSERT INTO tpermintaan_desain_detail (pd2_nomor, pd2_pd_desain, pd2_pd_jml) VALUES (?, ?, ?)",
            [nomor, it.desain, it.jml],
          );
        }
      }
    }

    const statusBaru = resolveStatus(jmlBaru, jmlJadi);

    await conn.query(
      `UPDATE tpermintaan_desain SET
         pd_nama_project = ?, pd_customer = ?, pd_customer_nama = ?,
         pd_jenis_pekerjaan = ?, pd_dateline = ?, pd_keterangan = ?,
         pd_jml = ?, pd_status = ?,
         pd_tgl_close = CASE WHEN ? = 'CLOSE' THEN NOW() ELSE NULL END,
         pd_user_modified = ?, pd_date_modified = NOW()
       WHERE pd_nomor = ?`,
      [
        namaProject,
        customer || null,
        customerNama || null,
        jenisPekerjaan,
        dateline,
        keterangan,
        jmlBaru,
        statusBaru,
        statusBaru,
        kode,
        nomor,
      ],
    );

    await conn.commit();
    return { nomor, jml: jmlBaru, status: statusBaru };
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
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
  updateHeader,
};
