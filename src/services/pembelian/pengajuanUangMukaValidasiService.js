const db = require("../../config/database");
const { getFormData } = require("./uangMukaPenyelesaianService");

// Berlaku hanya untuk cabang HO-/P01 (P04 tetap kertas fisik)
const CABANG_VALIDASI = ["HO-", "P01"];
const BAGIAN_VALIDATOR = ["FINANCE", "EDP", "AUDIT", "DIREKSI"];
const JENIS = { PENGAJUAN: "PENGAJUAN", PENYELESAIAN: "PENYELESAIAN" };

const up = (v) =>
  String(v ?? "")
    .trim()
    .toUpperCase();
const sen = (v) => Math.round((Number(v) || 0) * 100);
const isAdminUser = (u) => ["ADMIN", "DEVELOPER"].includes(up(u?.kode));
const isValidator = (u) =>
  isAdminUser(u) || BAGIAN_VALIDATOR.includes(up(u?.bagian));

// PENGAJUAN: nomor = nomor PUM. PENYELESAIAN: nomor = nomor BON.
const resolvePum = async (q, nomor, jenis) => {
  if (jenis === JENIS.PENGAJUAN) return nomor;
  const [[r]] = await q.query(
    `SELECT pum_nomor FROM tpengajuan_uang_muka_hdr WHERE pum_bon_nomor = ?`,
    [nomor],
  );
  return r ? r.pum_nomor : null;
};

// Snapshot angka yang dibandingkan saat cetak. Kalau berubah -> TIDAK_BERLAKU.
const ambilSnapshot = async (q, nomor, jenis, hdr) => {
  if (jenis === JENIS.PENGAJUAN) {
    const [[cnt]] = await q.query(
      `SELECT COUNT(*) AS jml FROM tpengajuan_uang_muka_dtl WHERE pumd_pum_nomor = ?`,
      [hdr.pum_nomor],
    );
    return {
      total: sen(hdr.pum_total_nominal),
      jml: Number(cnt.jml) || 0,
      siap: true,
    };
  }

  // PENYELESAIAN: total terpakai + jumlah baris terverifikasi,
  // sama persis dengan yang dicetak di UangMukaPenyelesaianPrintView
  const [[bon]] = await q.query(
    `SELECT bon_selesai FROM finance.tkasbon WHERE bon_nomor = ?`,
    [nomor],
  );
  const siap = Number(bon?.bon_selesai) === 1 && hdr.pum_status === "REALISASI";
  if (!siap) return { total: 0, jml: 0, siap: false };

  const form = await getFormData(nomor);
  const rows = (form.detail || []).filter(
    (d) => d.verified && Number(d.total) > 0,
  );
  return {
    total: rows.reduce((s, d) => s + sen(d.total), 0),
    jml: rows.length,
    siap: true,
  };
};

// q = db (baca) atau conn (dalam transaksi). kunci=true -> FOR UPDATE pada header PUM.
const loadState = async (q, nomor, jenis, user, kunci = false) => {
  const pumNomor = await resolvePum(q, nomor, jenis);
  if (!pumNomor) {
    return {
      pumNomor: null,
      berlaku: false,
      status: "BELUM",
      last: null,
      snap: null,
      hdr: null,
      bolehValidasi: false,
      bolehBatal: false,
    };
  }

  const [[hdr]] = await q.query(
    `SELECT pum_nomor, pum_status, pum_cabang, pum_user_create, pum_total_nominal
     FROM tpengajuan_uang_muka_hdr WHERE pum_nomor = ?${kunci ? " FOR UPDATE" : ""}`,
    [pumNomor],
  );
  if (!hdr) throw new Error("Pengajuan Uang Muka tidak ditemukan.");

  const snap = await ambilSnapshot(q, nomor, jenis, hdr);
  const [[last]] = await q.query(
    `SELECT val_aksi, val_user, val_nama, val_bagian, val_total_nominal, val_jml_item,
            DATE_FORMAT(val_date, '%d-%m-%Y %H:%i') AS tanggal_fmt
     FROM tpengajuan_uang_muka_validasi
     WHERE val_pum_nomor = ? AND val_jenis = ?
     ORDER BY val_id DESC LIMIT 1`,
    [pumNomor, jenis],
  );

  const berlaku = CABANG_VALIDASI.includes(up(hdr.pum_cabang));

  let status = "BELUM";
  if (last && last.val_aksi === "VALIDASI") {
    const sama =
      sen(last.val_total_nominal) === snap.total &&
      Number(last.val_jml_item) === snap.jml;
    status = sama ? "VALID" : "TIDAK_BERLAKU";
  }

  const statusDokumenOk =
    jenis === JENIS.PENGAJUAN
      ? hdr.pum_status === "DIAJUKAN"
      : hdr.pum_status === "REALISASI";

  // TIDAK_BERLAKU boleh divalidasi ulang tanpa batal dulu
  const bolehValidasi =
    berlaku &&
    statusDokumenOk &&
    snap.siap &&
    status !== "VALID" &&
    isValidator(user) &&
    up(user?.kode) !== up(hdr.pum_user_create);

  const bolehBatal =
    berlaku &&
    status !== "BELUM" &&
    (jenis === JENIS.PENGAJUAN ? hdr.pum_status === "DIAJUKAN" : true) &&
    isValidator(user) &&
    (up(last.val_user) === up(user?.kode) || isAdminUser(user));

  return {
    pumNomor,
    hdr,
    snap,
    last,
    berlaku,
    status,
    bolehValidasi,
    bolehBatal,
  };
};

const getStatus = async (nomor, user, jenis = JENIS.PENGAJUAN) => {
  const s = await loadState(db, nomor, jenis, user);
  const ada = s.status !== "BELUM";
  return {
    berlaku: s.berlaku,
    status: s.status,
    nama: ada ? s.last.val_nama : "",
    bagian: ada ? s.last.val_bagian : "",
    tanggal_fmt: ada ? s.last.tanggal_fmt : "",
    boleh_validasi: s.bolehValidasi,
    boleh_batal: s.bolehBatal,
  };
};

const insertLog = async (conn, s, jenis, aksi, user, nama, alasan) => {
  await conn.query(
    `INSERT INTO tpengajuan_uang_muka_validasi
      (val_pum_nomor, val_jenis, val_aksi, val_user, val_nama, val_bagian,
       val_total_nominal, val_jml_item, val_alasan)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      s.pumNomor,
      jenis,
      aksi,
      user.kode,
      nama,
      String(user.bagian || "").slice(0, 15),
      s.snap.total / 100,
      s.snap.jml,
      alasan || null,
    ],
  );
};

const namaUser = async (conn, user) => {
  const [[u]] = await conn.query(
    `SELECT user_nama FROM tuser WHERE user_kode = ?`,
    [user.kode],
  );
  return (u?.user_nama || user.kode).slice(0, 50);
};

const validasi = async (nomor, user, jenis = JENIS.PENGAJUAN) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const s = await loadState(conn, nomor, jenis, user, true);

    if (!s.pumNomor)
      throw new Error(
        "Dokumen ini tidak berasal dari Pengajuan Uang Muka, e-validasi tidak berlaku.",
      );
    if (!s.berlaku)
      throw new Error("E-validasi hanya berlaku untuk cabang HO-/P01.");
    if (!isValidator(user))
      throw new Error("Bagian Anda tidak berwenang memvalidasi.");
    if (up(user.kode) === up(s.hdr.pum_user_create))
      throw new Error(
        "Pembuat pengajuan tidak boleh memvalidasi dokumennya sendiri.",
      );
    if (jenis === JENIS.PENGAJUAN && s.hdr.pum_status !== "DIAJUKAN")
      throw new Error(`Pengajuan ini sudah berstatus ${s.hdr.pum_status}.`);
    if (jenis === JENIS.PENYELESAIAN && !s.snap.siap)
      throw new Error("Penyelesaian belum disimpan, belum bisa divalidasi.");
    if (s.status === "VALID") throw new Error("Dokumen ini sudah divalidasi.");

    await insertLog(
      conn,
      s,
      jenis,
      "VALIDASI",
      user,
      await namaUser(conn, user),
      null,
    );
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
  return getStatus(nomor, user, jenis);
};

const batalValidasi = async (nomor, alasan, user, jenis = JENIS.PENGAJUAN) => {
  const alasanBersih = String(alasan || "").trim();
  if (alasanBersih.length < 3)
    throw new Error("Alasan pembatalan wajib diisi.");

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const s = await loadState(conn, nomor, jenis, user, true);

    if (!s.pumNomor || !s.berlaku)
      throw new Error("E-validasi hanya berlaku untuk cabang HO-/P01.");
    if (jenis === JENIS.PENGAJUAN && s.hdr.pum_status !== "DIAJUKAN")
      throw new Error(
        `Validasi tidak bisa dibatalkan, pengajuan sudah berstatus ${s.hdr.pum_status}.`,
      );
    if (s.status === "BELUM") throw new Error("Dokumen ini belum divalidasi.");
    if (!s.bolehBatal)
      throw new Error(
        "Hanya pemvalidasi asli atau ADMIN yang boleh membatalkan.",
      );

    await insertLog(
      conn,
      s,
      jenis,
      "BATAL",
      user,
      await namaUser(conn, user),
      alasanBersih.slice(0, 255),
    );
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
  return getStatus(nomor, user, jenis);
};

module.exports = { JENIS, getStatus, validasi, batalValidasi };
