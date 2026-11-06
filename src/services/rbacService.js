const pool = require("../config/database");
const crypto = require("crypto");

// Mode bayangan RBAC (Fase 2): keputusan baru dihitung berdampingan dengan thakuser.
// Tidak pernah memengaruhi respons. Selisih dicatat ke trbac_shadow_log.

const CACHE_MS = 60 * 1000; // masa berlaku cache izin per (user, cabang)
const DEDUP_MS = 60 * 60 * 1000; // satu selisih yang sama dicatat sekali per jam per proses

const cacheIzin = new Map(); // `${user}|${cabang}` -> { exp, izin: Set<string> }
const sudahDicatat = new Map(); // kunci selisih -> waktu terakhir ditulis
let jumlahBandingan = 0;
let jumlahSelisih = 0;

const normalCabang = (cabang) => {
  const c = String(cabang || "").trim();
  return c === "" ? "HO-" : c;
};

const muatIzin = async (userKode, cabang) => {
  const [dariRole] = await pool.query(
    `SELECT DISTINCT rp.perm_kode
     FROM trbac_user_role ur
     JOIN trbac_role r ON r.role_kode = ur.ur_role_kode AND r.role_aktif = 1
     JOIN trbac_role_permission rp ON rp.role_kode = ur.ur_role_kode
     JOIN trbac_permission p ON p.perm_kode = rp.perm_kode AND p.perm_aktif = 1
     WHERE ur.ur_user_kode = ?
       AND (ur.ur_cabang = '*' OR ur.ur_cabang = ?)
       AND (ur.ur_berlaku_dari IS NULL OR ur.ur_berlaku_dari <= CURDATE())
       AND (ur.ur_berlaku_sampai IS NULL OR ur.ur_berlaku_sampai >= CURDATE())`,
    [userKode, cabang],
  );
  const [override] = await pool.query(
    `SELECT uo_perm_kode AS perm, uo_efek AS efek
     FROM trbac_user_override
     WHERE uo_user_kode = ?
       AND (uo_cabang = '*' OR uo_cabang = ?)
       AND (uo_berlaku_sampai IS NULL OR uo_berlaku_sampai >= CURDATE())`,
    [userKode, cabang],
  );

  const izin = new Set(dariRole.map((r) => r.perm_kode));
  for (const o of override) if (o.efek === "GRANT") izin.add(o.perm);
  // DENY diterapkan terakhir: selalu menang atas role dan GRANT
  for (const o of override) if (o.efek === "DENY") izin.delete(o.perm);
  return izin;
};

const getIzin = async (userKode, cabang) => {
  const cab = normalCabang(cabang);
  const key = `${userKode}|${cab}`;
  const hit = cacheIzin.get(key);
  if (hit && hit.exp > Date.now()) return hit.izin;
  const izin = await muatIzin(userKode, cab);
  cacheIzin.set(key, { exp: Date.now() + CACHE_MS, izin });
  return izin;
};

const buangCache = (userKode) => {
  for (const key of cacheIzin.keys()) {
    if (key.startsWith(`${userKode}|`)) cacheIzin.delete(key);
  }
  for (const key of cacheRole.keys()) {
    if (key.startsWith(`${userKode}|`)) cacheRole.delete(key);
  }
};

// Izin dari role saja (tanpa override), bentuk "menuId.aksi", untuk izin
// gabungan dengan thakuser. Cache 60 detik per (user, cabang).
const cacheRole = new Map();

const muatIzinRole = async (userKode, cabang) => {
  const [rows] = await pool.query(
    `SELECT DISTINCT p.perm_men_id AS id, p.perm_aksi AS aksi
       FROM trbac_user_role ur
       JOIN trbac_role r ON r.role_kode = ur.ur_role_kode AND r.role_aktif = 1
       JOIN trbac_role_permission rp ON rp.role_kode = ur.ur_role_kode
       JOIN trbac_permission p ON p.perm_kode = rp.perm_kode AND p.perm_aktif = 1
      WHERE ur.ur_user_kode = ? AND p.perm_men_id IS NOT NULL
        AND (ur.ur_cabang = '*' OR ur.ur_cabang = ?)
        AND (ur.ur_berlaku_dari IS NULL OR ur.ur_berlaku_dari <= CURDATE())
        AND (ur.ur_berlaku_sampai IS NULL OR ur.ur_berlaku_sampai >= CURDATE())`,
    [userKode, cabang],
  );
  return new Set(rows.map((r) => `${r.id}.${r.aksi}`));
};

const getIzinRole = async (userKode, cabang) => {
  if (process.env.RBAC_ROLE !== "1") return new Set(); // saklar: izin role mati
  const cab = normalCabang(cabang);
  const key = `${userKode}|${cab}`;
  const hit = cacheRole.get(key);
  if (hit && hit.exp > Date.now()) return hit.izin;
  const izin = await muatIzinRole(userKode, cab);
  cacheRole.set(key, { exp: Date.now() + CACHE_MS, izin });
  return izin;
};

// Dipanggil tanpa await dari checkPermission; semua galat ditelan.
const bandingkanBayangan = async ({
  userKode,
  cabang,
  menuId,
  action,
  keputusanLama,
  route,
}) => {
  try {
    const izin = await getIzin(userKode, cabang);
    const baru = izin.has(`m${menuId}.${action}`);
    jumlahBandingan += 1;
    if (jumlahBandingan === 1 || jumlahBandingan % 200 === 0) {
      console.log(
        `[RBAC shadow] ${jumlahBandingan} pengecekan dibandingkan, ${jumlahSelisih} selisih`,
      );
    }
    if (baru === keputusanLama) return;
    jumlahSelisih += 1;

    const key = `${userKode}|${menuId}|${action}|${baru}`;
    const terakhir = sudahDicatat.get(key);
    if (terakhir && Date.now() - terakhir < DEDUP_MS) return;
    sudahDicatat.set(key, Date.now());

    await pool.query(
      `INSERT INTO trbac_shadow_log
         (shadow_user, shadow_cabang, shadow_men_id, shadow_aksi,
          shadow_lama, shadow_baru, shadow_route)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        userKode,
        normalCabang(cabang),
        menuId,
        action,
        keputusanLama ? 1 : 0,
        baru ? 1 : 0,
        route,
      ],
    );
  } catch (err) {
    console.error("[RBAC shadow]", err.message);
  }
};

// ── Sinkron thakuser -> tabel RBAC (mode bayangan) ───────────────────────
// Dipanggil dari saveUser di transaksi yang sama. Role LEGACY mengikuti
// bagian; override MIGRASI = selisih himpunan hak thakuser terhadap izin role.
// Baris MANUAL tidak disentuh. Gagal -> savepoint di-rollback dan penyimpanan
// legacy tetap jalan (selisihnya akan terlihat di log bayangan).
const AKSI_LEGACY = [
  ["view", "hak_men_view"],
  ["insert", "hak_men_insert"],
  ["edit", "hak_men_edit"],
  ["delete", "hak_men_delete"],
  ["save", "hak_men_save"],
];

const roleLegacy = (bagian) => {
  const b = String(bagian || "")
    .trim()
    .toUpperCase();
  return b ? `LEGACY_${b.replace(/ /g, "_")}` : "LEGACY_KOSONG";
};

// Kode role turunan HRD: <DEP>_<BAGIAN>, maksimal 40 karakter (bila terpotong,
// ditambah 4 karakter hash supaya tetap unik).
const kodeRoleHrd = (dep, jab, bagian) => {
  const slug = (s) =>
    String(s || "")
      .trim()
      .toUpperCase()
      .replace(/&/g, "DAN")
      .replace(/[^A-Z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
  const raw = [slug(dep), slug(jab), slug(bagian)].filter(Boolean).join("_");
  if (raw.length <= 40) return raw;
  const hash = crypto
    .createHash("md5")
    .update(raw)
    .digest("hex")
    .slice(0, 4)
    .toUpperCase();
  return `${raw.slice(0, 35)}_${hash}`;
};

// Selalu mengembalikan objek. role terisi bila ada aturan eksplisit yang cocok
// atau bila departemen dan bagian HRD terisi (role turunan). buat = true
// membuat role turunan yang belum ada (dipakai saat menerapkan, bukan simulasi).
const cariRoleHrd = async (conn, userKode, { buat = false } = {}) => {
  const [[u]] = await conn.query(
    `SELECT user_nik FROM tuser WHERE user_kode = ?`,
    [userKode],
  );
  const nik = String(u?.user_nik || "").trim();
  if (!nik) return { role: null, alasan: "TANPA_NIK" };

  const [kar] = await conn.query(
    `SELECT kar_dep_kode, kar_jab_kode, kar_bagian, kar_pab_kode, kar_status_aktif
       FROM hrd2.tkaryawan WHERE kar_Nik = ?`,
    [nik],
  );
  if (kar.length === 0) return { role: null, alasan: "NIK_TIDAK_ADA_DI_HRD" };
  const k = kar[0];
  const hrd = {
    dep: k.kar_dep_kode,
    jab: k.kar_jab_kode,
    bagian: k.kar_bagian,
  };
  if (Number(k.kar_status_aktif) !== 1) {
    return { role: null, alasan: "KARYAWAN_KELUAR", ...hrd };
  }

  // 1. Aturan eksplisit (pengecualian), paling spesifik lalu prioritas
  const [aturan] = await conn.query(
    `SELECT a.rule_id, a.rule_role_kode
       FROM trbac_rule_hrd a
       JOIN trbac_role r ON r.role_kode = a.rule_role_kode AND r.role_aktif = 1
      WHERE a.rule_aktif = 1
        AND (a.rule_dep_kode IS NULL OR a.rule_dep_kode = ?)
        AND (a.rule_jab_kode IS NULL OR a.rule_jab_kode = ?)
        AND (a.rule_bagian   IS NULL OR a.rule_bagian   = ?)
        AND (a.rule_pab_kode IS NULL OR a.rule_pab_kode = ?)
      ORDER BY a.rule_prioritas DESC,
               ((a.rule_dep_kode IS NOT NULL) + (a.rule_jab_kode IS NOT NULL)
                + (a.rule_bagian IS NOT NULL) + (a.rule_pab_kode IS NOT NULL)) DESC,
               a.rule_id
      LIMIT 1`,
    [k.kar_dep_kode, k.kar_jab_kode, k.kar_bagian, k.kar_pab_kode],
  );
  if (aturan.length > 0) {
    return {
      role: aturan[0].rule_role_kode,
      ruleId: aturan[0].rule_id,
      turunan: false,
      alasan: "",
      ...hrd,
    };
  }

  // 2. Role turunan dari departemen, jabatan, dan bagian HRD
  const dep = String(k.kar_dep_kode || "").trim();
  const jab = String(k.kar_jab_kode || "").trim();
  const bagian = String(k.kar_bagian || "").trim();
  if (!dep || !bagian)
    return { role: null, alasan: "HRD_TANPA_BAGIAN", ...hrd };

  const role = kodeRoleHrd(dep, jab, bagian);
  const [ada] = await conn.query(
    `SELECT role_kode FROM trbac_role WHERE role_kode = ?`,
    [role],
  );
  if (ada.length === 0 && buat) {
    await conn.query(
      `INSERT IGNORE INTO trbac_role (role_kode, role_nama, role_keterangan, role_sumber)
       VALUES (?, ?, 'Dibuat otomatis dari data HRD', 'MANUAL')`,
      [role, [dep, jab, bagian].filter(Boolean).join(" - ").slice(0, 100)],
    );
  }
  return {
    role,
    ruleId: null,
    turunan: true,
    roleAda: ada.length > 0 || buat,
    alasan: "",
    ...hrd,
  };
};

// Menetapkan role dasar user: dari HRD bila ada aturan yang cocok, cadangan
// LEGACY menurut bagian. thakuser tidak disentuh; role MANUAL tidak disentuh.
const sinkronHakLegacy = async (conn, userKode, bagian) => {
  await conn.query("SAVEPOINT sinkron_rbac");
  try {
    const hasilHrd = await cariRoleHrd(conn, userKode, { buat: true });
    const dariHrd = hasilHrd.role ? hasilHrd : null;
    const roleDasar = dariHrd ? dariHrd.role : roleLegacy(bagian);

    const [ada] = await conn.query(
      `SELECT role_kode FROM trbac_role WHERE role_kode = ?`,
      [roleDasar],
    );
    if (ada.length === 0)
      throw new Error(`Role ${roleDasar} belum ada di trbac_role.`);

    await conn.query(
      `DELETE FROM trbac_user_role
        WHERE ur_user_kode = ? AND ur_sumber IN ('HRD', 'MIGRASI')`,
      [userKode],
    );
    await conn.query(
      `INSERT IGNORE INTO trbac_user_role
         (ur_user_kode, ur_role_kode, ur_cabang, ur_sumber, ur_alasan)
       VALUES (?, ?, '*', ?, ?)`,
      [
        userKode,
        roleDasar,
        dariHrd ? "HRD" : "MIGRASI",
        dariHrd
          ? dariHrd.turunan
            ? `Turunan HRD: ${dariHrd.dep}/${dariHrd.bagian}`
            : `Aturan HRD #${dariHrd.ruleId}`
          : "Cadangan dari bagian",
      ],
    );
    await conn.query(
      `UPDATE tuser SET user_versi_izin = user_versi_izin + 1 WHERE user_kode = ?`,
      [userKode],
    );
    await conn.query("RELEASE SAVEPOINT sinkron_rbac");
    return { ok: true, role: roleDasar, sumber: dariHrd ? "HRD" : "MIGRASI" };
  } catch (err) {
    await conn.query("ROLLBACK TO SAVEPOINT sinkron_rbac");
    console.error(`[rbac] sinkron role gagal untuk ${userKode}:`, err.message);
    return { ok: false, pesan: err.message };
  }
};

// Katalog (men_id.aksi -> kode permission) dan himpunan hak thakuser, untuk
// menghitung jumlah override bila role dasar user berganti.
const hitungHakUser = async (conn, userKode, peta) => {
  const [hak] = await conn.query(
    `SELECT hak_men_id, hak_men_view, hak_men_insert, hak_men_edit,
            hak_men_delete, hak_men_save
       FROM thakuser WHERE hak_user_kode = ?`,
    [userKode],
  );
  const hakUser = new Set();
  for (const h of hak) {
    for (const [aksi, kolom] of AKSI_LEGACY) {
      if (h[kolom] !== "Y") continue;
      const kode = peta.get(`${h.hak_men_id}.${aksi}`);
      if (kode) hakUser.add(kode);
    }
  }
  return hakUser;
};

// Terapkan aturan HRD ke semua user aktif. dryRun = true hanya melaporkan.
const rekonsiliasiHrd = async ({ dryRun = true } = {}) => {
  const [users] = await pool.query(
    `SELECT user_kode, user_bagian FROM tuser WHERE user_aktif = 0 ORDER BY user_kode`,
  );
  const [sekarang] = await pool.query(
    `SELECT ur_user_kode, GROUP_CONCAT(ur_role_kode ORDER BY ur_role_kode) AS role
       FROM trbac_user_role WHERE ur_sumber IN ('HRD', 'MIGRASI')
      GROUP BY ur_user_kode`,
  );
  const roleSekarang = new Map(sekarang.map((r) => [r.ur_user_kode, r.role]));
  const laporan = [];

  for (const u of users) {
    const conn = await pool.getConnection();
    try {
      const h = await cariRoleHrd(conn, u.user_kode);
      const dariHrd = h.role ? h : null;
      const roleBaru = dariHrd ? dariHrd.role : roleLegacy(u.user_bagian);
      const roleLama = roleSekarang.get(u.user_kode) || "";
      const status = dariHrd
        ? roleBaru === roleLama
          ? "SAMA"
          : "BERUBAH"
        : "CADANGAN_LEGACY";

      let hasil = "";
      if (!dryRun && dariHrd) {
        await conn.beginTransaction();
        const r = await sinkronHakLegacy(conn, u.user_kode, u.user_bagian);
        if (r.ok) {
          await conn.commit();
          buangCache(u.user_kode);
          hasil = "OK";
        } else {
          await conn.rollback();
          hasil = `GAGAL: ${r.pesan}`;
        }
      }
      laporan.push({
        user: u.user_kode,
        roleLama,
        roleBaru,
        status,
        aturan: dariHrd ? dariHrd.ruleId : "",
        alasan: h.alasan || "",
        dep: h.dep || "",
        jab: h.jab || "",
        bagian: h.bagian || "",
        hasil,
      });
    } finally {
      conn.release();
    }
  }
  return laporan;
};

// Dipanggil saat login: bila role turunan HRD user berbeda dari yang tercatat,
// diperbarui. Galat tidak pernah menghalangi login.
const segarkanRoleUser = async (userKode, bagian) => {
  const conn = await pool.getConnection();
  try {
    const h = await cariRoleHrd(conn, userKode, { buat: false });
    if (!h.role) return;
    const [sama] = await conn.query(
      `SELECT 1 FROM trbac_user_role
        WHERE ur_user_kode = ? AND ur_role_kode = ? AND ur_sumber = 'HRD' LIMIT 1`,
      [userKode, h.role],
    );
    if (sama.length > 0) return;
    await conn.beginTransaction();
    const r = await sinkronHakLegacy(conn, userKode, bagian);
    if (r.ok) {
      await conn.commit();
      buangCache(userKode);
    } else {
      await conn.rollback();
    }
  } catch (err) {
    console.error(`[rbac] segarkan role ${userKode} gagal:`, err.message);
  } finally {
    conn.release();
  }
};

module.exports = {
  getIzin,
  getIzinRole,
  buangCache,
  bandingkanBayangan,
  sinkronHakLegacy,
  cariRoleHrd,
  rekonsiliasiHrd,
};
