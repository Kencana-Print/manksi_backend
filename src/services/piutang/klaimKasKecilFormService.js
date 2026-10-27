const db = require("../../config/database");
const { assertBolehPosting } = require("../postingGuardService");
const {
  TANGGAL_MULAI_KLAIM,
  REK_TUJUAN,
  REK_ASAL_PER_CABANG,
} = require("./klaimKasKecilKonstanta");

const httpError = (msg, status = 400) =>
  Object.assign(new Error(msg), { status });
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const TGL_RE = /^\d{4}-\d{2}-\d{2}$/;

// Rekening asal ditentukan dari cabang; cabang yang tidak terdaftar ditolak.
const rekAsalCabang = (cabang) => {
  const rek = REK_ASAL_PER_CABANG[cabang];
  if (!rek)
    throw httpError(
      "Klaim Kas Kecil hanya dapat dibuat atau diubah oleh user cabang yang terdaftar.",
      403,
    );
  return rek;
};

// ── Info default form: rekening asal/tujuan + tanggal mulai ───────────
const getDefaults = async (cabang) => {
  const rekAsal = rekAsalCabang(cabang);
  const [rek] = await db.query(
    `SELECT rek_kode AS kode, rek_nama AS nama, rek_rekening AS rekening
     FROM finance.trekening WHERE rek_kode IN (?)`,
    [[rekAsal, REK_TUJUAN]],
  );
  const peta = new Map(rek.map((r) => [r.kode, r]));
  const bentuk = (kode) => ({
    kode,
    nama: peta.get(kode)?.nama || "",
    rekening: peta.get(kode)?.rekening || "",
  });
  return {
    cabang,
    rekAsal: bentuk(rekAsal),
    rekTujuan: bentuk(REK_TUJUAN),
    tanggalMulai: TANGGAL_MULAI_KLAIM,
  };
};

// ── BKK yang memenuhi syarat klaim (syarat 11.4) ──────────────────────
// Dua langkah (bukan JOIN lintas schema): query Finance dulu, lalu buang
// yang sudah terkunci di klaim aktif lewat `conn` (kencanaprint).
// daftarBkk: batasi ke nomor tertentu (dipakai validasi saat simpan).
const cariBkkEligible = async (
  { cabang, rekAsal, search = "", daftarBkk = null, exceptNomor = "" },
  conn = db,
) => {
  const params = [rekAsal, cabang, rekAsal, TANGGAL_MULAI_KLAIM];
  let sql = `
    SELECT b.bon_nomor AS bon,
      b.bon_jur_no AS bkk,
      DATE_FORMAT(j.jur_tanggal,'%Y-%m-%d') AS tanggal,
      j.jur_penerima AS penerima,
      j.jur_keterangan AS keterangan,
      k.nominal AS nominal
    FROM finance.tkasbon b
    INNER JOIN finance.tjurnal j
      ON j.jur_no = b.bon_jur_no
     AND j.jur_tipetransaksi = 'BKK'
     AND j.jur_otomatis = 0
    INNER JOIN (
      SELECT jurd_jur_no, SUM(jurd_kredit) AS nominal
      FROM finance.tjurnalitem
      WHERE jurd_nourut = 0 AND jurd_rek_kode = ?
      GROUP BY jurd_jur_no
    ) k ON k.jurd_jur_no = j.jur_no
    WHERE b.bon_cabang = ?
      AND b.bon_rek_kode = ?
      AND b.bon_selesai = 1
      AND b.bon_jur_no <> ''
      AND j.jur_tanggal >= ?
      AND k.nominal > 0
      AND NOT EXISTS (
        SELECT 1 FROM finance.tpengajuan_transfer_dtl d
        WHERE d.ptd_trs = b.bon_jur_no AND d.ptd_batal = ''
      )`;

  if (daftarBkk) {
    sql += ` AND j.jur_no IN (?)`;
    params.push(daftarBkk);
  }
  const kata = String(search || "").trim();
  if (kata) {
    sql += ` AND (j.jur_no LIKE ? OR j.jur_penerima LIKE ?
                  OR j.jur_keterangan LIKE ? OR b.bon_nomor LIKE ?)`;
    params.push(`%${kata}%`, `%${kata}%`, `%${kata}%`, `%${kata}%`);
  }
  sql += ` ORDER BY j.jur_tanggal, j.jur_no`;

  const [rows] = await db.query(sql, params);
  if (rows.length === 0) return [];

  // Kunci milik klaim yang sedang diubah (exceptNomor) dianggap bebas
  const [terkunci] = await conn.query(
    `SELECT kkd_kunci FROM tklaim_kaskecil_dtl
     WHERE kkd_kunci IN (?) AND kkd_kkh_nomor <> ?`,
    [rows.map((r) => r.bkk), exceptNomor || ""],
  );
  const dikunci = new Set(terkunci.map((r) => r.kkd_kunci));

  return rows
    .filter((r) => !dikunci.has(r.bkk))
    .map((r) => ({ ...r, nominal: Number(r.nominal) }));
};

// ── Lookup modal "Pilih BKK" ──────────────────────────────────────────
const getBkkOptions = async (cabang, search = "", exceptNomor = "") => {
  const rekAsal = rekAsalCabang(cabang);
  const rows = await cariBkkEligible({ cabang, rekAsal, search, exceptNomor });
  return rows.slice(0, 300);
};

// ── Keterkaitan ke Pengajuan Transfer (baris aktif) ───────────────────
const cariPjtAktif = async (nomor) => {
  const [[row]] = await db.query(
    `SELECT ptd_nomor FROM finance.tpengajuan_transfer_dtl
     WHERE ptd_trs = ? AND ptd_batal = '' LIMIT 1`,
    [nomor],
  );
  return row ? row.ptd_nomor : "";
};

// ── Load form (lihat / ubah) ──────────────────────────────────────────
// cabangScope: cabang user bila bukan pusat; null = pusat (baca saja).
const getDetailForm = async (nomor, cabangScope) => {
  const [[h]] = await db.query(
    `SELECT kkh_nomor, DATE_FORMAT(kkh_tanggal,'%Y-%m-%d') AS tanggal,
            kkh_cabang, kkh_rek_asal, kkh_rek_tujuan, kkh_total,
            kkh_keterangan, kkh_status, user_create
     FROM tklaim_kaskecil_hdr WHERE kkh_nomor = ?`,
    [nomor],
  );
  if (!h) throw httpError("Klaim tidak ditemukan.", 404);
  if (cabangScope && h.kkh_cabang !== cabangScope)
    throw httpError("Klaim ini bukan milik cabang Anda.", 403);

  const [dtl] = await db.query(
    `SELECT kkd_jur_no AS bkk, kkd_bon_nomor AS bon,
            DATE_FORMAT(kkd_tanggal,'%Y-%m-%d') AS tanggal,
            kkd_uraian AS uraian, kkd_nominal AS nominal
     FROM tklaim_kaskecil_dtl WHERE kkd_kkh_nomor = ?
     ORDER BY kkd_tanggal, kkd_jur_no`,
    [nomor],
  );
  const [rek] = await db.query(
    `SELECT rek_kode AS kode, rek_nama AS nama, rek_rekening AS rekening
     FROM finance.trekening WHERE rek_kode IN (?)`,
    [[h.kkh_rek_asal, h.kkh_rek_tujuan]],
  );
  const peta = new Map(rek.map((r) => [r.kode, r]));
  const bentuk = (kode) => ({
    kode,
    nama: peta.get(kode)?.nama || "",
    rekening: peta.get(kode)?.rekening || "",
  });

  const nomorPjt = await cariPjtAktif(nomor);
  return {
    nomor: h.kkh_nomor,
    tanggal: h.tanggal,
    cabang: h.kkh_cabang,
    rekAsal: bentuk(h.kkh_rek_asal),
    rekTujuan: bentuk(h.kkh_rek_tujuan),
    total: Number(h.kkh_total),
    keterangan: h.kkh_keterangan || "",
    status: h.kkh_status,
    dibuat: h.user_create,
    nomorPjt,
    // Boleh diubah hanya bila AKTIF dan belum dipanggil Pengajuan Transfer
    bisaUbah: h.kkh_status === "AKTIF" && !nomorPjt && !!cabangScope,
    detail: dtl.map((d) => ({ ...d, nominal: Number(d.nominal) })),
  };
};

// ── Nomor: {cabang}-KKK.{tahun}.{5 digit} (dipanggil di bawah GET_LOCK) ─
const getMaxNomor = async (cabang, conn) => {
  const prefix = `${cabang}-KKK.${new Date().getFullYear()}.`;
  const [[row]] = await conn.query(
    `SELECT IFNULL(MAX(CAST(RIGHT(kkh_nomor,5) AS UNSIGNED)),0) AS max_val
     FROM tklaim_kaskecil_hdr WHERE kkh_nomor LIKE ?`,
    [`${prefix}%`],
  );
  return `${prefix}${String(Number(row.max_val) + 1).padStart(5, "0")}`;
};

// ── Simpan (baru / ubah) ──────────────────────────────────────────────
// payload: { isEdit, nomor, tanggal, keterangan, detail: [{ bkk }] }
// Cabang diambil dari token (user.cabang), bukan dari payload.
const saveData = async (payload, user) => {
  const { isEdit, nomor, tanggal, keterangan, detail } = payload;
  const cabang = String(user.cabang || "").trim();
  const rekAsal = rekAsalCabang(cabang);

  if (!TGL_RE.test(String(tanggal || "")))
    throw httpError("Tanggal klaim tidak valid.");

  const dipilih = (Array.isArray(detail) ? detail : [])
    .map((d) => String(d.bkk || "").trim())
    .filter(Boolean);
  if (dipilih.length === 0) throw httpError("Pilih minimal satu BKK.");
  const daftar = [...new Set(dipilih)];
  if (daftar.length !== dipilih.length)
    throw httpError("Ada BKK yang dipilih lebih dari satu kali.");

  // Pagar posting yang sama dengan modul Finance lain
  await assertBolehPosting([rekAsal, REK_TUJUAN], tanggal);

  const conn = await db.getConnection();
  let lockName = null;
  try {
    await conn.beginTransaction();
    let actualNomor = nomor;

    if (isEdit) {
      const [[h]] = await conn.query(
        `SELECT kkh_cabang, kkh_status FROM tklaim_kaskecil_hdr
         WHERE kkh_nomor = ? FOR UPDATE`,
        [nomor],
      );
      if (!h) throw httpError("Klaim tidak ditemukan.", 404);
      if (h.kkh_cabang !== cabang)
        throw httpError("Klaim ini bukan milik cabang Anda.", 403);
      if (h.kkh_status !== "AKTIF")
        throw httpError("Klaim sudah dibatalkan. Tidak bisa diubah.");
      const pjt = await cariPjtAktif(nomor);
      if (pjt)
        throw httpError(
          `Klaim sudah dipanggil di Pengajuan Transfer ${pjt}. Tidak bisa diubah.`,
        );
      // Lepas kunci BKK lama supaya bisa dipilih ulang di transaksi ini
      await conn.query(
        `DELETE FROM tklaim_kaskecil_dtl WHERE kkd_kkh_nomor = ?`,
        [nomor],
      );
    } else {
      lockName = `klaim_kk_${cabang}_${new Date().getFullYear()}`;
      const [[lk]] = await conn.query(`SELECT GET_LOCK(?, 10) AS ok`, [
        lockName,
      ]);
      if (Number(lk.ok) !== 1)
        throw httpError("Sistem sedang sibuk, coba simpan lagi.", 503);
      actualNomor = await getMaxNomor(cabang, conn);
    }

    // Validasi ulang di server — daftar BKK dari klien tidak dipercaya
    const eligible = await cariBkkEligible(
      { cabang, rekAsal, daftarBkk: daftar },
      conn,
    );
    const peta = new Map(eligible.map((e) => [e.bkk, e]));
    const tidakValid = daftar.filter((b) => !peta.has(b));
    if (tidakValid.length > 0)
      throw httpError(
        `BKK berikut tidak memenuhi syarat klaim (sudah diklaim atau diajukan, sebelum tanggal mulai, atau bukan kas ${rekAsal}): ${tidakValid.join(", ")}`,
      );

    const total = round2(eligible.reduce((s, e) => s + e.nominal, 0));

    if (isEdit) {
      await conn.query(
        `UPDATE tklaim_kaskecil_hdr
         SET kkh_tanggal = ?, kkh_keterangan = ?, kkh_total = ?,
             user_modified = ?, date_modified = NOW()
         WHERE kkh_nomor = ?`,
        [tanggal, keterangan || "", total, user.kode, actualNomor],
      );
    } else {
      await conn.query(
        `INSERT INTO tklaim_kaskecil_hdr
           (kkh_nomor, kkh_tanggal, kkh_cabang, kkh_rek_asal, kkh_rek_tujuan,
            kkh_total, kkh_keterangan, kkh_status, user_create, date_create)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'AKTIF', ?, NOW())`,
        [
          actualNomor,
          tanggal,
          cabang,
          rekAsal,
          REK_TUJUAN,
          total,
          keterangan || "",
          user.kode,
        ],
      );
    }

    for (const bkk of daftar) {
      const e = peta.get(bkk);
      await conn.query(
        `INSERT INTO tklaim_kaskecil_dtl
           (kkd_kkh_nomor, kkd_jur_no, kkd_bon_nomor, kkd_tanggal,
            kkd_uraian, kkd_nominal, kkd_kunci)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          actualNomor,
          bkk,
          e.bon,
          e.tanggal,
          String(e.keterangan || "").slice(0, 250),
          e.nominal,
          bkk,
        ],
      );
    }

    await conn.commit();
    return { nomor: actualNomor, total };
  } catch (err) {
    await conn.rollback();
    if (err.code === "ER_DUP_ENTRY")
      throw httpError(
        "Salah satu BKK baru saja diklaim di dokumen lain. Muat ulang daftar BKK.",
      );
    throw err;
  } finally {
    if (lockName) {
      try {
        await conn.query(`SELECT RELEASE_LOCK(?)`, [lockName]);
      } catch (_) {
        /* lock otomatis lepas saat koneksi ditutup */
      }
    }
    conn.release();
  }
};

module.exports = {
  getDefaults,
  getBkkOptions,
  getDetailForm,
  saveData,
  cariBkkEligible,
};
