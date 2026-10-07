const db = require("../../config/database");
const { generateNomor: generateLhkNomor } = require("./lhkDesainService");

// Header: OPEN = belum ada pengerjaan, PROGRESS = ada pengerjaan tapi total
// yang CLOSE belum mencapai pd_jml, DONE = total CLOSE >= pd_jml.
const resolveStatus = (jml, jumlahKerja, jadi) => {
  if (jumlahKerja <= 0) return "OPEN";
  if (jml > 0 && jadi >= jml) return "DONE";
  return "PROGRESS";
};

const AUTO_STATUSES = ["OPEN", "PROGRESS", "DONE"];
const MANUAL_STATUSES = ["PENDING", "CANCEL", "CANCEL_ALT"];
const STATUS_TERKUNCI = [...MANUAL_STATUSES, "CLOSE"];

const dalamTransaksi = async (fn) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const hasil = await fn(conn);
    await conn.commit();
    return hasil;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
};

// Semua aksi yang mengubah pengerjaan mengunci header dulu, jadi dua desainer
// tidak bisa sama-sama mengambil sisa yang sama.
const kunciHeader = async (conn, nomor) => {
  const [[pd]] = await conn.query(
    `SELECT * FROM tpermintaan_desain WHERE pd_nomor = ? FOR UPDATE`,
    [nomor],
  );
  if (!pd) throw new Error("Permintaan Desain tidak ditemukan.");
  return pd;
};

const pastikanAuto = (pd) => {
  if (pd.pd_status === "CLOSE") {
    throw new Error(
      "PD sudah CLOSE (diteruskan ke produksi). Minta EDP/IT membuka kembali bila perlu diubah.",
    );
  }
  if (!AUTO_STATUSES.includes(pd.pd_status)) {
    throw new Error(
      `PD berstatus ${pd.pd_status}. Aktifkan kembali dulu sebelum mengubah pengerjaan.`,
    );
  }
};

const kunciKerja = async (conn, kerjaId) => {
  const [[awal]] = await conn.query(
    `SELECT kerja_pd_nomor FROM tpermintaan_desain_kerja WHERE kerja_id = ?`,
    [kerjaId],
  );
  if (!awal) throw new Error("Pengerjaan tidak ditemukan.");
  const pd = await kunciHeader(conn, awal.kerja_pd_nomor);
  const [[k]] = await conn.query(
    `SELECT * FROM tpermintaan_desain_kerja WHERE kerja_id = ?`,
    [kerjaId],
  );
  if (!k) throw new Error("Pengerjaan tidak ditemukan.");
  return { pd, k };
};

// Hitung ulang pd_jmljadi + pd_status header dari tabel pengerjaan.
// Status manual tidak disentuh kecuali { paksa: true } (dipakai resume).
const hitungUlangHeader = async (
  conn,
  nomor,
  { paksa = false, user = null } = {},
) => {
  const [[pd]] = await conn.query(
    `SELECT pd_jml, pd_status FROM tpermintaan_desain WHERE pd_nomor = ?`,
    [nomor],
  );
  if (!pd) throw new Error("Permintaan Desain tidak ditemukan.");
  if (!paksa && STATUS_TERKUNCI.includes(pd.pd_status)) {
    return { nomor, status: pd.pd_status };
  }

  const [[agg]] = await conn.query(
    `SELECT COUNT(*) AS n,
            IFNULL(SUM(CASE WHEN kerja_status = 'CLOSE' THEN kerja_jml ELSE 0 END), 0) AS jadi
     FROM tpermintaan_desain_kerja WHERE kerja_pd_nomor = ?`,
    [nomor],
  );
  const jadi = Number(agg.jadi);
  const status = resolveStatus(Number(pd.pd_jml), Number(agg.n), jadi);

  await conn.query(
    `UPDATE tpermintaan_desain
     SET pd_jmljadi = ?, pd_status = ?,
         pd_tgl_close = CASE WHEN ? = 'DONE' THEN IFNULL(pd_tgl_close, NOW()) ELSE NULL END,
         pd_user_done = CASE WHEN ? = 'DONE' THEN IFNULL(?, pd_user_done) ELSE NULL END
     WHERE pd_nomor = ?`,
    [jadi, status, status, status, user, nomor],
  );
  return { nomor, status, jmljadi: jadi };
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
       IFNULL(dz.nama, '') AS Desainer,
       h.pd_referensi AS Referensi,
       h.pd_so_map_nomor AS SoMapNomor,
       h.pd_so_map_tipe AS SoMapTipe,
       h.pd_path_desain AS PathDesain,
       h.pd_user_done AS UserDone,
       DATE_FORMAT(h.pd_tgl_close, '%Y-%m-%d %H:%i') AS TglClose,
       h.pd_user_create AS UserCreate,
       DATE_FORMAT(h.pd_date_create, '%Y-%m-%d %H:%i') AS DateCreate
     FROM tpermintaan_desain h
     LEFT JOIN tcustomer c ON c.cus_kode = h.pd_customer
     LEFT JOIN tuser um ON um.user_kode = h.pd_nama_marketing
     LEFT JOIN (
       SELECT x.pd_nomor,
              GROUP_CONCAT(DISTINCT IFNULL(u.user_nama, x.kode) ORDER BY IFNULL(u.user_nama, x.kode) SEPARATOR ', ') AS nama
       FROM (
         SELECT pd2_pd_nomor AS pd_nomor, pd2_desainer AS kode
         FROM tpermintaan_desain_detail WHERE pd2_desainer IS NOT NULL
         UNION
         SELECT kerja_pd_nomor, kerja_desainer FROM tpermintaan_desain_kerja
       ) x
       LEFT JOIN tuser u ON u.user_kode = x.kode
       GROUP BY x.pd_nomor
     ) dz ON dz.pd_nomor = h.pd_nomor
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
       h.pd_prioritas, h.pd_referensi,
       h.pd_so_map_nomor, h.pd_so_map_tipe, h.pd_path_desain, h.pd_user_done,
       DATE_FORMAT(h.pd_tgl_close,'%Y-%m-%d %H:%i') AS pd_tgl_close
     FROM tpermintaan_desain h
     LEFT JOIN tcustomer c ON c.cus_kode = h.pd_customer
     WHERE h.pd_nomor = ?`,
    [nomor],
  );
  if (!header) throw new Error("Permintaan Desain tidak ditemukan.");

  const [items] = await db.query(
    `SELECT d.pd2_id, d.pd2_pd_desain, d.pd2_pd_jml, d.pd2_desainer,
            IFNULL(u.user_nama, d.pd2_desainer) AS pd2_desainer_nama,
            IFNULL(k.total, 0) AS dikerjakan,
            IFNULL(k.jadi, 0) AS selesai,
            d.pd2_pd_jml - IFNULL(k.total, 0) AS sisa
     FROM tpermintaan_desain_detail d
     LEFT JOIN tuser u ON u.user_kode = d.pd2_desainer
     LEFT JOIN (
       SELECT kerja_pd2_id,
              SUM(kerja_jml) AS total,
              SUM(CASE WHEN kerja_status = 'CLOSE' THEN kerja_jml ELSE 0 END) AS jadi
       FROM tpermintaan_desain_kerja WHERE kerja_pd_nomor = ?
       GROUP BY kerja_pd2_id
     ) k ON k.kerja_pd2_id = d.pd2_id
     WHERE d.pd2_pd_nomor = ?
     ORDER BY d.pd2_id`,
    [nomor, nomor],
  );

  const [kerja] = await db.query(
    `SELECT k.kerja_id, k.kerja_pd2_id, k.kerja_desainer,
            IFNULL(u.user_nama, k.kerja_desainer) AS kerja_desainer_nama,
            k.kerja_jml, k.kerja_status, k.kerja_lhk_nomor, k.kerja_asal_desainer,
            DATE_FORMAT(k.kerja_tgl_mulai,'%Y-%m-%d %H:%i') AS kerja_tgl_mulai,
            DATE_FORMAT(k.kerja_tgl_close,'%Y-%m-%d %H:%i') AS kerja_tgl_close
     FROM tpermintaan_desain_kerja k
     LEFT JOIN tuser u ON u.user_kode = k.kerja_desainer
     WHERE k.kerja_pd_nomor = ?
     ORDER BY k.kerja_id`,
    [nomor],
  );

  return { ...header, detail: items, kerja };
};

// ─────────────────────────────────────────────────────────
// Assign / ubah desainer
// ─────────────────────────────────────────────────────────
const updateDesainer = async (nomor, { pd2Id, desainerKode } = {}) => {
  const kode = desainerKode ? String(desainerKode).trim() : null;
  const params = [kode, nomor];
  let sql = `UPDATE tpermintaan_desain_detail SET pd2_desainer = ? WHERE pd2_pd_nomor = ?`;
  if (pd2Id) {
    sql += ` AND pd2_id = ?`;
    params.push(Number(pd2Id));
  }
  await db.query(sql, params);
  return { nomor, pd2Id: pd2Id || null, desainer: kode };
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
    if (!["DONE", "CLOSE"].includes(ref.pd_status)) {
      throw new Error(
        "PD terkait harus berstatus Done/Close (semua desain selesai).",
      );
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
const resumeStatus = async (nomor) =>
  dalamTransaksi(async (conn) => {
    const pd = await kunciHeader(conn, nomor);
    if (!MANUAL_STATUSES.includes(pd.pd_status)) {
      throw new Error("PD ini tidak dalam status manual.");
    }
    const hasil = await hitungUlangHeader(conn, nomor, { paksa: true });
    return { nomor, status: hasil.status };
  });

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
      desainer: it.desainer ? String(it.desainer).trim() : null,
    }));
    if (items.length === 0) throw new Error("Detail minimal 1 baris");
    for (const it of items) {
      if (!it.desain) throw new Error("Nama desain pada detail wajib diisi");
      if (!Number.isInteger(it.jml) || it.jml <= 0)
        throw new Error("Jumlah detail harus bilangan bulat > 0");
    }
  }

  return dalamTransaksi(async (conn) => {
    const pd = await kunciHeader(conn, nomor);

    if (!isSuper) {
      const pemilik =
        String(pd.pd_nama_marketing || "") === kode ||
        String(pd.pd_user_create || "") === kode;
      if (!pemilik)
        throw new Error("Hanya pembuat/marketing PD yang dapat mengedit");
    }

    if (MANUAL_STATUSES.includes(pd.pd_status))
      throw new Error(
        `PD berstatus ${pd.pd_status}, lakukan resume terlebih dahulu`,
      );
    if (["DONE", "CLOSE"].includes(pd.pd_status))
      throw new Error(`PD yang sudah ${pd.pd_status} tidak dapat diedit`);
    if (await hasLhk(conn, nomor))
      throw new Error("PD sudah memiliki LHK, tidak dapat diedit");

    let jmlBaru = Number(pd.pd_jml);

    if (items) {
      const [existing] = await conn.query(
        `SELECT d.pd2_id, IFNULL(SUM(k.kerja_jml), 0) AS dikerjakan
         FROM tpermintaan_desain_detail d
         LEFT JOIN tpermintaan_desain_kerja k ON k.kerja_pd2_id = d.pd2_id
         WHERE d.pd2_pd_nomor = ?
         GROUP BY d.pd2_id`,
        [nomor],
      );
      const kerjaMap = new Map(
        existing.map((r) => [Number(r.pd2_id), Number(r.dikerjakan)]),
      );

      for (const it of items) {
        if (it.id && !kerjaMap.has(it.id))
          throw new Error("Baris detail tidak valid untuk PD ini");
        if (it.id && it.jml < kerjaMap.get(it.id))
          throw new Error(
            `Jumlah "${it.desain}" tidak boleh kurang dari yang sudah dikerjakan (${kerjaMap.get(it.id)})`,
          );
      }

      const keepIds = new Set(items.filter((it) => it.id).map((it) => it.id));
      const hapus = [...kerjaMap.keys()].filter((id) => !keepIds.has(id));
      for (const id of hapus) {
        if (kerjaMap.get(id) > 0)
          throw new Error("Baris yang sudah dikerjakan tidak dapat dihapus");
      }
      if (hapus.length) {
        await conn.query(
          `DELETE FROM tpermintaan_desain_detail WHERE pd2_pd_nomor = ? AND pd2_id IN (?)`,
          [nomor, hapus],
        );
      }

      for (const it of items) {
        if (it.id) {
          await conn.query(
            `UPDATE tpermintaan_desain_detail
             SET pd2_pd_desain = ?, pd2_pd_jml = ?, pd2_desainer = ?
             WHERE pd2_id = ? AND pd2_pd_nomor = ?`,
            [it.desain, it.jml, it.desainer, it.id, nomor],
          );
        } else {
          await conn.query(
            `INSERT INTO tpermintaan_desain_detail
               (pd2_pd_nomor, pd2_pd_desain, pd2_pd_jml, pd2_desainer)
             VALUES (?, ?, ?, ?)`,
            [nomor, it.desain, it.jml, it.desainer],
          );
        }
      }
      jmlBaru = items.reduce((s, it) => s + it.jml, 0);
    }

    await conn.query(
      `UPDATE tpermintaan_desain SET
         pd_nama_project = ?, pd_customer = ?, pd_jenis_pekerjaan = ?,
         pd_dateline = ?, pd_keterangan = ?, pd_jml = ?,
         pd_user_modified = ?, pd_date_modified = NOW()
       WHERE pd_nomor = ?`,
      [
        namaProject,
        customer || null,
        jenisPekerjaan,
        dateline,
        keterangan,
        jmlBaru,
        kode,
        nomor,
      ],
    );

    const hasil = await hitungUlangHeader(conn, nomor);
    return { nomor, jml: jmlBaru, status: hasil.status };
  });
};

// ─────────────────────────────────────────────────────────
// Close PD: DESAIN input nomor SO/MAP + path desain (1 PD = 1 SO/MAP)
// ─────────────────────────────────────────────────────────
const cariSoMap = async (conn, nomor) => {
  const [so] = await conn.query(
    `SELECT so_nomor AS nomor FROM tsalesorder WHERE so_nomor = ? AND so_aktif = 'Y'
     UNION ALL
     SELECT spk_nomor FROM tspk WHERE spk_nomor = ? AND spk_is_so = 1 AND spk_aktif = 'Y'`,
    [nomor, nomor],
  );
  if (so.length) return { nomor: so[0].nomor, tipe: "SO" };

  const [map] = await conn.query(
    `SELECT mspk_nomor AS nomor FROM tmemospk WHERE mspk_nomor = ? AND mspk_aktif = 'Y'`,
    [nomor],
  );
  if (map.length) return { nomor: map[0].nomor, tipe: "MAP" };
  return null;
};

const closePD = async (nomor, payload, user) => {
  const kode = String(user?.kode || "").trim();
  const bagian = String(user?.bagian || "")
    .toUpperCase()
    .trim();
  const isSuper = EDIT_SUPER_BAGIAN.includes(bagian);
  const noInput = String(payload?.soMapNomor ?? "").trim();
  const path = String(payload?.path ?? "").trim();

  if (!noInput) throw new Error("Nomor SO/MAP wajib diisi.");
  if (!path) throw new Error("Path desain wajib diisi.");
  if (path.length > 500) throw new Error("Path desain maksimal 500 karakter.");

  return dalamTransaksi(async (conn) => {
    const pd = await kunciHeader(conn, nomor);
    if (pd.pd_status !== "DONE")
      throw new Error("Hanya PD berstatus DONE yang dapat di-close.");
    if (!isSuper && String(pd.pd_user_done || "") !== kode)
      throw new Error(
        "Hanya desainer yang menyelesaikan PD ini yang dapat meng-close.",
      );

    const target = await cariSoMap(conn, noInput);
    if (!target)
      throw new Error(`Nomor ${noInput} tidak ditemukan sebagai SO/MAP aktif.`);

    const [[dup]] = await conn.query(
      `SELECT pd_nomor FROM tpermintaan_desain
       WHERE pd_so_map_nomor = ? AND pd_nomor <> ?`,
      [target.nomor, nomor],
    );
    if (dup) throw new Error(`${target.nomor} sudah dipakai ${dup.pd_nomor}.`);

    try {
      await conn.query(
        `UPDATE tpermintaan_desain
         SET pd_status = 'CLOSE', pd_so_map_nomor = ?, pd_so_map_tipe = ?,
             pd_path_desain = ?, pd_user_close = ?, pd_date_close = NOW()
         WHERE pd_nomor = ?`,
        [target.nomor, target.tipe, path, kode, nomor],
      );
    } catch (e) {
      if (e.code === "ER_DUP_ENTRY")
        throw new Error(`${target.nomor} sudah dipakai PD lain.`);
      throw e;
    }
    return {
      nomor,
      status: "CLOSE",
      soMapNomor: target.nomor,
      tipe: target.tipe,
    };
  });
};

// Buka kembali PD CLOSE → DONE (koreksi salah input), khusus EDP/IT
const bukaKembali = async (nomor, user) => {
  const bagian = String(user?.bagian || "")
    .toUpperCase()
    .trim();
  if (!EDIT_SUPER_BAGIAN.includes(bagian))
    throw new Error(
      "Hanya EDP/IT yang dapat membuka kembali PD yang sudah CLOSE.",
    );

  return dalamTransaksi(async (conn) => {
    const pd = await kunciHeader(conn, nomor);
    if (pd.pd_status !== "CLOSE")
      throw new Error("PD ini tidak berstatus CLOSE.");

    await conn.query(
      `UPDATE tpermintaan_desain
       SET pd_status = 'DONE', pd_so_map_nomor = NULL, pd_so_map_tipe = NULL,
           pd_path_desain = NULL, pd_user_close = NULL, pd_date_close = NULL
       WHERE pd_nomor = ?`,
      [nomor],
    );
    return { nomor, status: "DONE" };
  });
};

// ─────────────────────────────────────────────────────────
// Antrean desainer: baris yang masih ada sisa (ditugaskan ke saya atau belum
// ditugaskan), pengerjaan aktif saya, dan pengerjaan aktif desainer lain
// (kandidat ambil alih)
// ─────────────────────────────────────────────────────────
const getAntrean = async (user) => {
  const kode = String(user?.kode || "").trim();

  const [antrean] = await db.query(
    `SELECT d.pd2_id AS Pd2Id, d.pd2_pd_nomor AS PdNomor, d.pd2_pd_desain AS Desain,
            d.pd2_pd_jml AS Jml, IFNULL(k.total, 0) AS Dikerjakan,
            d.pd2_pd_jml - IFNULL(k.total, 0) AS Sisa,
            d.pd2_desainer AS DesainerKode,
            h.pd_nama_project AS NamaProject, IFNULL(c.cus_nama, '') AS Customer,
            h.pd_jenis_pekerjaan AS JenisPekerjaan, h.pd_prioritas AS Prioritas,
            DATE_FORMAT(h.pd_dateline, '%Y-%m-%d') AS Dateline, h.pd_status AS StatusPd
     FROM tpermintaan_desain_detail d
     JOIN tpermintaan_desain h ON h.pd_nomor = d.pd2_pd_nomor
     LEFT JOIN tcustomer c ON c.cus_kode = h.pd_customer
     LEFT JOIN (
       SELECT kerja_pd2_id, SUM(kerja_jml) AS total
       FROM tpermintaan_desain_kerja GROUP BY kerja_pd2_id
     ) k ON k.kerja_pd2_id = d.pd2_id
     WHERE h.pd_status IN ('OPEN', 'PROGRESS')
       AND d.pd2_pd_jml - IFNULL(k.total, 0) > 0
       AND (d.pd2_desainer = ? OR d.pd2_desainer IS NULL)
     ORDER BY h.pd_dateline IS NULL, h.pd_dateline, d.pd2_pd_nomor, d.pd2_id`,
    [kode],
  );

  const kerjaSql = `
    SELECT k.kerja_id AS KerjaId, k.kerja_pd_nomor AS PdNomor, k.kerja_pd2_id AS Pd2Id,
           d.pd2_pd_desain AS Desain, d.pd2_pd_jml AS JmlDetail, k.kerja_jml AS Jml,
           k.kerja_desainer AS DesainerKode,
           IFNULL(u.user_nama, k.kerja_desainer) AS Desainer,
           k.kerja_asal_desainer AS AsalDesainer,
           DATE_FORMAT(k.kerja_tgl_mulai, '%Y-%m-%d %H:%i') AS TglMulai,
           h.pd_nama_project AS NamaProject
    FROM tpermintaan_desain_kerja k
    JOIN tpermintaan_desain_detail d ON d.pd2_id = k.kerja_pd2_id
    JOIN tpermintaan_desain h ON h.pd_nomor = k.kerja_pd_nomor
    LEFT JOIN tuser u ON u.user_kode = k.kerja_desainer
    WHERE k.kerja_status = 'PROGRESS' AND h.pd_status IN ('OPEN', 'PROGRESS')`;

  const [kerjaSaya] = await db.query(
    `${kerjaSql} AND k.kerja_desainer = ? ORDER BY k.kerja_tgl_mulai`,
    [kode],
  );
  const [kerjaLain] = await db.query(
    `${kerjaSql} AND k.kerja_desainer <> ? ORDER BY k.kerja_tgl_mulai`,
    [kode],
  );

  return { antrean, kerjaSaya, kerjaLain };
};

// ─────────────────────────────────────────────────────────
// Mulai kerja: desainer isi jumlah (parsial) pada satu baris detail
// ─────────────────────────────────────────────────────────
const mulaiKerja = async (pd2Id, jml, user) => {
  const kode = String(user?.kode || "").trim();
  const id = Number(pd2Id);
  const jumlah = Number(jml);
  if (!Number.isInteger(jumlah) || jumlah <= 0)
    throw new Error("Jumlah harus bilangan bulat > 0");

  return dalamTransaksi(async (conn) => {
    const [[ref]] = await conn.query(
      `SELECT pd2_pd_nomor FROM tpermintaan_desain_detail WHERE pd2_id = ?`,
      [id],
    );
    if (!ref) throw new Error("Baris detail tidak ditemukan.");
    const nomor = ref.pd2_pd_nomor;

    const pd = await kunciHeader(conn, nomor);
    pastikanAuto(pd);

    // baca ulang setelah header terkunci (jumlah bisa berubah lewat edit)
    const [[d]] = await conn.query(
      `SELECT pd2_pd_jml, pd2_desainer FROM tpermintaan_desain_detail WHERE pd2_id = ?`,
      [id],
    );
    if (!d) throw new Error("Baris detail tidak ditemukan.");
    if (d.pd2_desainer && d.pd2_desainer !== kode)
      throw new Error(`Baris ini ditugaskan ke ${d.pd2_desainer}.`);

    const [[agg]] = await conn.query(
      `SELECT IFNULL(SUM(kerja_jml), 0) AS total,
              IFNULL(SUM(kerja_desainer = ? AND kerja_status = 'PROGRESS'), 0) AS aktifSaya
       FROM tpermintaan_desain_kerja WHERE kerja_pd2_id = ?`,
      [kode, id],
    );
    if (Number(agg.aktifSaya) > 0)
      throw new Error(
        "Kamu sudah punya pengerjaan aktif di baris ini, ubah jumlahnya saja.",
      );

    const sisa = Number(d.pd2_pd_jml) - Number(agg.total);
    if (jumlah > sisa) throw new Error(`Jumlah melebihi sisa (${sisa}).`);

    const [ins] = await conn.query(
      `INSERT INTO tpermintaan_desain_kerja
         (kerja_pd_nomor, kerja_pd2_id, kerja_desainer, kerja_jml, kerja_status)
       VALUES (?, ?, ?, ?, 'PROGRESS')`,
      [nomor, id, kode, jumlah],
    );
    const hasil = await hitungUlangHeader(conn, nomor);
    return { kerjaId: ins.insertId, nomor, status: hasil.status };
  });
};

// ─────────────────────────────────────────────────────────
// Ubah jumlah pengerjaan yang masih PROGRESS
// ─────────────────────────────────────────────────────────
const updateKerja = async (kerjaId, jml, user) => {
  const kode = String(user?.kode || "").trim();
  const id = Number(kerjaId);
  const jumlah = Number(jml);
  if (!Number.isInteger(jumlah) || jumlah <= 0)
    throw new Error("Jumlah harus bilangan bulat > 0");

  return dalamTransaksi(async (conn) => {
    const { pd, k } = await kunciKerja(conn, id);
    pastikanAuto(pd);
    if (k.kerja_status !== "PROGRESS")
      throw new Error("Pengerjaan sudah CLOSE, tidak dapat diubah.");
    if (k.kerja_desainer !== kode)
      throw new Error("Pengerjaan ini milik desainer lain.");

    const [[d]] = await conn.query(
      `SELECT pd2_pd_jml FROM tpermintaan_desain_detail WHERE pd2_id = ?`,
      [k.kerja_pd2_id],
    );
    const [[lain]] = await conn.query(
      `SELECT IFNULL(SUM(kerja_jml), 0) AS total
       FROM tpermintaan_desain_kerja WHERE kerja_pd2_id = ? AND kerja_id <> ?`,
      [k.kerja_pd2_id, id],
    );
    const sisa = Number(d.pd2_pd_jml) - Number(lain.total);
    if (jumlah > sisa) throw new Error(`Jumlah melebihi sisa (${sisa}).`);

    await conn.query(
      `UPDATE tpermintaan_desain_kerja SET kerja_jml = ? WHERE kerja_id = ?`,
      [jumlah, id],
    );
    return { kerjaId: id, jml: jumlah };
  });
};

// ─────────────────────────────────────────────────────────
// Batalkan pengerjaan PROGRESS (salah ambil) — header dihitung ulang
// ─────────────────────────────────────────────────────────
const batalKerja = async (kerjaId, user) => {
  const kode = String(user?.kode || "").trim();
  const id = Number(kerjaId);

  return dalamTransaksi(async (conn) => {
    const { pd, k } = await kunciKerja(conn, id);
    pastikanAuto(pd);
    if (k.kerja_status !== "PROGRESS")
      throw new Error("Pengerjaan sudah CLOSE, tidak dapat dibatalkan.");
    if (k.kerja_desainer !== kode)
      throw new Error("Pengerjaan ini milik desainer lain.");

    await conn.query(
      `DELETE FROM tpermintaan_desain_kerja WHERE kerja_id = ?`,
      [id],
    );
    const hasil = await hitungUlangHeader(conn, k.kerja_pd_nomor);
    return { kerjaId: id, nomor: k.kerja_pd_nomor, status: hasil.status };
  });
};

// ─────────────────────────────────────────────────────────
// Close satu atau beberapa pengerjaan (PD yang sama) → terbit 1 LHK
// ─────────────────────────────────────────────────────────
const closeKerja = async (kerjaIds, user) => {
  const kode = String(user?.kode || "").trim();
  const ids = [
    ...new Set(
      (Array.isArray(kerjaIds) ? kerjaIds : [])
        .map(Number)
        .filter((n) => Number.isInteger(n) && n > 0),
    ),
  ];
  if (!ids.length) throw new Error("Pilih minimal 1 pengerjaan.");

  return dalamTransaksi(async (conn) => {
    const [awal] = await conn.query(
      `SELECT DISTINCT kerja_pd_nomor FROM tpermintaan_desain_kerja WHERE kerja_id IN (?)`,
      [ids],
    );
    if (!awal.length) throw new Error("Pengerjaan tidak ditemukan.");
    if (awal.length > 1)
      throw new Error(
        "Pengerjaan yang di-close bersamaan harus dari PD yang sama.",
      );
    const nomor = awal[0].kerja_pd_nomor;

    const pd = await kunciHeader(conn, nomor);
    pastikanAuto(pd);

    const [rows] = await conn.query(
      `SELECT kerja_id, kerja_jml, kerja_status, kerja_desainer
       FROM tpermintaan_desain_kerja WHERE kerja_id IN (?) FOR UPDATE`,
      [ids],
    );
    if (rows.length !== ids.length)
      throw new Error("Ada pengerjaan yang tidak ditemukan.");
    for (const r of rows) {
      if (r.kerja_status !== "PROGRESS")
        throw new Error("Ada pengerjaan yang sudah CLOSE.");
      if (r.kerja_desainer !== kode)
        throw new Error("Ada pengerjaan milik desainer lain.");
    }

    const jmlLhk = rows.reduce((s, r) => s + Number(r.kerja_jml), 0);
    const lhkNomor = await generateLhkNomor(new Date(), conn);

    await conn.query(
      `INSERT INTO tlhk_desain
         (lhk_nomor, lhk_pd_nomor, lhk_pd_status, lhk_pd_jml, lhk_pd_userdesain,
          lhk_tanggal, lhk_tgl_selesai, lhk_user_create, lhk_date_create)
       VALUES (?, ?, 'SELESAI', ?, ?, CURDATE(), NOW(), ?, NOW())`,
      [lhkNomor, nomor, jmlLhk, kode, kode],
    );
    await conn.query(
      `UPDATE tpermintaan_desain_kerja
       SET kerja_status = 'CLOSE', kerja_lhk_nomor = ?, kerja_tgl_close = NOW()
       WHERE kerja_id IN (?)`,
      [lhkNomor, ids],
    );

    const hasil = await hitungUlangHeader(conn, nomor, { user: kode });
    return { lhkNomor, pdNomor: nomor, jml: jmlLhk, statusPd: hasil.status };
  });
};

// ─────────────────────────────────────────────────────────
// Ambil alih pengerjaan PROGRESS milik desainer lain
// ─────────────────────────────────────────────────────────
const ambilAlih = async (kerjaId, user) => {
  const kode = String(user?.kode || "").trim();
  const id = Number(kerjaId);

  return dalamTransaksi(async (conn) => {
    const { pd, k } = await kunciKerja(conn, id);
    pastikanAuto(pd);
    if (k.kerja_status !== "PROGRESS")
      throw new Error(
        "Hanya pengerjaan berstatus progress yang bisa diambil alih.",
      );
    if (k.kerja_desainer === kode)
      throw new Error("Pengerjaan ini sudah milik kamu.");

    await conn.query(
      `UPDATE tpermintaan_desain_kerja
       SET kerja_asal_desainer = ?, kerja_desainer = ?
       WHERE kerja_id = ?`,
      [k.kerja_desainer, kode, id],
    );
    return { kerjaId: id, dari: k.kerja_desainer, ke: kode };
  });
};

module.exports = {
  getBrowse,
  getDetail,
  updateDesainer,
  setStatusManual,
  resumeStatus,
  searchReferensi,
  getDesainerOptions,
  updateHeader,
  closePD,
  bukaKembali,
  getAntrean,
  mulaiKerja,
  updateKerja,
  batalKerja,
  closeKerja,
  ambilAlih,
};
