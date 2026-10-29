const db = require("../../config/database");
const { assertBolehPosting, sqlTanpaInduk } = require("../postingGuardService");
const { assertTidakKeKasKlaim } = require("./klaimKasKecilGuardService");
const {
  TANGGAL_MULAI_KLAIM,
  aksesPenuh,
  normCabang,
  kasByRek,
  kasPerCabang,
  cabangTerdaftar,
} = require("./klaimKasKecilKonstanta");

const httpError = (msg, status = 400) =>
  Object.assign(new Error(msg), { status });
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const TGL_RE = /^\d{4}-\d{2}-\d{2}$/;

const MAKS_MANUAL = 50;
const MIN_URAIAN_MANUAL = 10;
const hariIni = () =>
  new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Jakarta" });

// Validasi bentuk baris manual (hanya klaim ATM). Akun dicek ke DB di saveData.
const normalisasiManual = (rows, kas) => {
  const arr = Array.isArray(rows) ? rows : [];
  if (!arr.length) return [];
  if (kas.jenis !== "ATM")
    throw httpError("Baris manual hanya untuk klaim ATM.");
  if (arr.length > MAKS_MANUAL)
    throw httpError(`Baris manual maksimal ${MAKS_MANUAL}.`);
  const today = hariIni();
  return arr.map((r, i) => {
    const no = i + 1;
    const tanggal = String(r.tanggal || "").trim();
    const akun = String(r.akun || "").trim();
    const cc = String(r.cc || "").trim();
    const dc = String(r.dc || "").trim();
    const uraian = String(r.uraian || "")
      .trim()
      .replace(/\s+/g, " ");
    const nominal = round2(r.nominal);
    if (!TGL_RE.test(tanggal))
      throw httpError(`Baris manual ${no}: tanggal tidak valid.`);
    if (tanggal < TANGGAL_MULAI_KLAIM)
      throw httpError(
        `Baris manual ${no}: tanggal sebelum tanggal mulai klaim (${TANGGAL_MULAI_KLAIM}).`,
      );
    if (tanggal > today)
      throw httpError(`Baris manual ${no}: tanggal tidak boleh masa depan.`);
    if (!akun) throw httpError(`Baris manual ${no}: akun biaya wajib dipilih.`);
    if (!cc || !dc)
      throw httpError(`Baris manual ${no}: cost center wajib dipilih.`);
    if (uraian.length < MIN_URAIAN_MANUAL)
      throw httpError(
        `Baris manual ${no}: uraian minimal ${MIN_URAIAN_MANUAL} karakter.`,
      );
    if (!(nominal > 0))
      throw httpError(`Baris manual ${no}: nominal harus lebih dari 0.`);
    return { tanggal, akun, cc, dc, uraian: uraian.slice(0, 250), nominal };
  });
};

// Nama cost center dari master (query terpisah)
const petaNamaCc = async (daftar) => {
  const kode = [...new Set(daftar.filter(Boolean))];
  if (!kode.length) return new Map();
  const [rows] = await db.query(
    `SELECT cc_kode, cc_nama FROM finance.tcostcenter WHERE cc_kode IN (?)`,
    [kode],
  );
  return new Map(rows.map((r) => [String(r.cc_kode), r.cc_nama]));
};

// Nama akun dari master (query terpisah, hindari collation mismatch)
const petaNamaAkun = async (daftar) => {
  const kode = [...new Set(daftar.filter(Boolean))];
  if (!kode.length) return new Map();
  const [rek] = await db.query(
    `SELECT rek_kode, rek_nama FROM finance.trekening WHERE rek_kode IN (?)`,
    [kode],
  );
  return new Map(rek.map((r) => [r.rek_kode, r.rek_nama]));
};

// Kas tujuan: satu cabang bisa punya lebih dari satu kas (pusat = beberapa ATM).
// Bila cabang hanya punya satu kas, rek boleh kosong; bila lebih, wajib dipilih.
// Cabang atau kas yang tidak terdaftar ditolak.
const tentukanKas = (cabang, rek) => {
  const daftar = kasPerCabang(cabang);
  if (!daftar.length)
    throw httpError(
      "Klaim hanya dapat dibuat atau diubah oleh user cabang yang terdaftar.",
      403,
    );
  const kode = String(rek || "").trim();
  if (!kode) {
    if (daftar.length === 1) return daftar[0];
    throw httpError("Pilih kas / ATM yang diklaim.");
  }
  const kas = daftar.find((k) => k.rek === kode);
  if (!kas) throw httpError("Kas tersebut tidak terdaftar untuk cabang ini.");
  return kas;
};

// Cabang kerja untuk Tambah / lookup BKK.
// User biasa: cabang token (HO- dipetakan ke P01). Akses penuh: cabang pilihan;
// bila kosong, cabang token jika terdaftar, kalau tidak cabang terdaftar pertama.
// Validitasnya tetap dicek tentukanKas (cabang tak terdaftar ditolak).
const cabangKerja = (user, pilihan = "") => {
  const cab = normCabang(user?.cabang);
  if (!aksesPenuh(user)) return cab;
  const p = String(pilihan || "").trim();
  if (p) return normCabang(p);
  if (kasPerCabang(cab).length) return cab;
  return cabangTerdaftar()[0];
};

// Info rekening dari master (finance.trekening), query terpisah
const infoRekening = async (kode) => {
  const [[r]] = await db.query(
    `SELECT rek_kode AS kode, rek_nama AS nama, rek_rekening AS rekening
     FROM finance.trekening WHERE rek_kode = ?`,
    [kode],
  );
  return { kode, nama: r?.nama || "", rekening: r?.rekening || "" };
};

// ── Info default form: kas tujuan + tanggal mulai ─────────────────────
const getDefaults = async (cabang, penuh = false) => {
  const daftar = kasPerCabang(cabang);
  if (!daftar.length)
    throw httpError(
      "Klaim hanya dapat dibuat atau diubah oleh user cabang yang terdaftar.",
      403,
    );
  return {
    cabang,
    jenis: daftar[0].jenis,
    kasOpsi: await Promise.all(daftar.map((k) => infoRekening(k.rek))),
    tanggalMulai: TANGGAL_MULAI_KLAIM,
    // Daftar pilihan cabang hanya untuk akses penuh; user biasa kosong
    cabangOpsi: penuh ? cabangTerdaftar() : [],
  };
};

// ── BKK/BBK yang memenuhi syarat klaim (syarat 11.4) ──────────────────
// Dua langkah (bukan JOIN lintas schema): query Finance dulu, lalu buang
// yang sudah terkunci di klaim aktif lewat `conn` (kencanaprint).
// kas = entri KAS_KLAIM (rek = kredit nourut 0 = rekening tujuan klaim).
//   KAS_KECIL: BKK dari kasbon yang sudah selesai.
//   ATM      : BKK/BBK langsung dari jurnal; bila terkait kasbon, kasbon
//              harus sudah selesai. BBK hasil Pengajuan Transfer dikecualikan.
// daftarBkk: batasi ke nomor tertentu (dipakai validasi saat simpan).
// exceptNomor: kunci milik klaim ini dianggap bebas (saat ubah).
const cariBkkEligible = async (
  { kas, search = "", daftarBkk = null, exceptNomor = "" },
  conn = db,
) => {
  const params = [];
  let sql;

  if (kas.jenis === "ATM") {
    sql = `
    SELECT IFNULL(b.bon_nomor,'') AS bon,
      j.jur_no AS bkk,
      DATE_FORMAT(j.jur_tanggal,'%Y-%m-%d') AS tanggal,
      j.jur_penerima AS penerima,
      j.jur_keterangan AS keterangan,
      k.nominal AS nominal
    FROM finance.tjurnal j
    INNER JOIN (
      SELECT jurd_jur_no, SUM(jurd_kredit) AS nominal
      FROM finance.tjurnalitem
      WHERE jurd_nourut = 0 AND jurd_rek_kode = ?
      GROUP BY jurd_jur_no
    ) k ON k.jurd_jur_no = j.jur_no
    LEFT JOIN finance.tkasbon b ON b.bon_jur_no = j.jur_no
    WHERE j.jur_tipetransaksi IN ('BKK','BBK')
      AND j.jur_otomatis = 0
      AND j.jur_tanggal >= ?
      AND k.nominal > 0
      AND (b.bon_nomor IS NULL OR b.bon_selesai = 1)
      AND NOT EXISTS (
        SELECT 1 FROM finance.tpengajuan_transfer_dtl d
        WHERE d.ptd_jur_no = j.jur_no
      )
      AND NOT EXISTS (
        SELECT 1 FROM finance.tpengajuan_transfer_dtl d
        WHERE d.ptd_trs = j.jur_no AND d.ptd_batal = ''
      )`;
    params.push(kas.rek, TANGGAL_MULAI_KLAIM);
  } else {
    sql = `
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
    params.push(kas.rek, kas.cabang, kas.rek, TANGGAL_MULAI_KLAIM);
  }

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
const getBkkOptions = async (
  cabang,
  rekTujuan = "",
  search = "",
  exceptNomor = "",
) => {
  const kas = tentukanKas(cabang, rekTujuan);
  const rows = await cariBkkEligible({ kas, search, exceptNomor });
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
// cabangScope: hak BACA. Cabang user bila bukan pusat/akses penuh; null = baca semua.
// penuh: user akses penuh (EDP/AUDIT/DIR).
// cabangTulis: hak TULIS. Cabang klaim milik user ("" bila tidak terdaftar).
const getDetailForm = async (
  nomor,
  cabangScope,
  penuh = false,
  cabangTulis = "",
) => {
  const [[h]] = await db.query(
    `SELECT kkh_nomor, DATE_FORMAT(kkh_tanggal,'%Y-%m-%d') AS tanggal,
            kkh_cabang, kkh_rek_tujuan, kkh_total,
            kkh_keterangan, kkh_status, user_create
     FROM tklaim_kaskecil_hdr WHERE kkh_nomor = ?`,
    [nomor],
  );
  if (!h) throw httpError("Klaim tidak ditemukan.", 404);
  if (cabangScope && h.kkh_cabang !== cabangScope)
    throw httpError("Klaim ini bukan milik cabang Anda.", 403);

  const [dtl] = await db.query(
    `SELECT kkd_jur_no AS bkk, kkd_bon_nomor AS bon,
            kkd_tipe AS tipe, kkd_akun_biaya AS akun,
            kkd_cc_kode AS cc, kkd_dc_nama AS dc,
            DATE_FORMAT(kkd_tanggal,'%Y-%m-%d') AS tanggal,
            kkd_uraian AS uraian, kkd_nominal AS nominal
     FROM tklaim_kaskecil_dtl WHERE kkd_kkh_nomor = ?
     ORDER BY kkd_tipe, kkd_tanggal, kkd_jur_no`,
    [nomor],
  );

  const nomorPjt = await cariPjtAktif(nomor);
  const namaAkun = await petaNamaAkun(dtl.map((d) => d.akun));
  const namaCc = await petaNamaCc(dtl.map((d) => d.cc));
  const bolehTulis = penuh || (!!cabangTulis && cabangTulis === h.kkh_cabang);
  return {
    nomor: h.kkh_nomor,
    tanggal: h.tanggal,
    cabang: h.kkh_cabang,
    jenis: kasByRek(h.kkh_rek_tujuan)?.jenis || "",
    rekTujuan: await infoRekening(h.kkh_rek_tujuan),
    total: Number(h.kkh_total),
    keterangan: h.kkh_keterangan || "",
    status: h.kkh_status,
    dibuat: h.user_create,
    nomorPjt,
    // Boleh diubah hanya bila AKTIF, belum dipanggil Pengajuan Transfer,
    // dan user punya hak tulis atas klaim ini (cabang sendiri atau akses penuh)
    bisaUbah: h.kkh_status === "AKTIF" && !nomorPjt && bolehTulis,
    detail: dtl.map((d) => ({
      ...d,
      nominal: Number(d.nominal),
      akunNama: namaAkun.get(d.akun) || "",
      ccNama: namaCc.get(d.cc) || "",
    })),
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
// payload: { isEdit, nomor, cabang?, rekTujuan?, tanggal, keterangan, detail: [{ bkk }] }
// Tambah: cabang = cabangKerja(user, payload.cabang); kas = payload.rekTujuan
//         (wajib bila cabang punya lebih dari satu kas).
// Ubah: cabang dan kas = milik klaim itu sendiri (bukan dari payload).
const saveData = async (payload, user) => {
  const { isEdit, nomor, tanggal, keterangan, detail } = payload;
  const penuh = aksesPenuh(user);

  let cabang;
  let kas;
  if (isEdit) {
    const [[h0]] = await db.query(
      `SELECT kkh_cabang, kkh_rek_tujuan FROM tklaim_kaskecil_hdr
       WHERE kkh_nomor = ?`,
      [nomor],
    );
    if (!h0) throw httpError("Klaim tidak ditemukan.", 404);
    cabang = h0.kkh_cabang;
    kas = kasByRek(h0.kkh_rek_tujuan);
    if (!kas)
      throw httpError(
        `Kas ${h0.kkh_rek_tujuan} tidak lagi terdaftar sebagai kas klaim.`,
        409,
      );
    if (!penuh && cabang !== normCabang(user?.cabang))
      throw httpError("Klaim ini bukan milik cabang Anda.", 403);
  } else {
    cabang = cabangKerja(user, payload.cabang);
    kas = tentukanKas(cabang, payload.rekTujuan);
  }
  const rekTujuan = kas.rek;

  if (!TGL_RE.test(String(tanggal || "")))
    throw httpError("Tanggal klaim tidak valid.");

  const dipilih = (Array.isArray(detail) ? detail : [])
    .map((d) => String(d.bkk || "").trim())
    .filter(Boolean);
  const manual = normalisasiManual(payload.detailManual, kas);
  if (dipilih.length === 0 && manual.length === 0)
    throw httpError("Pilih minimal satu BKK atau isi satu baris manual.");
  const daftar = [...new Set(dipilih)];
  if (daftar.length !== dipilih.length)
    throw httpError("Ada BKK yang dipilih lebih dari satu kali.");

  // Pagar posting yang sama dengan modul Finance lain (hanya kas klaim;
  // bank asal dijaga di Pengajuan Transfer)
  await assertBolehPosting([rekTujuan, ...manual.map((m) => m.akun)], tanggal);

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
        throw httpError("Cabang klaim berubah, muat ulang halaman.", 409);
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
    // Daftar kosong (klaim hanya baris manual) → hindari "IN ()"
    const eligible = daftar.length
      ? await cariBkkEligible({ kas, daftarBkk: daftar }, conn)
      : [];
    const peta = new Map(eligible.map((e) => [e.bkk, e]));
    const tidakValid = daftar.filter((b) => !peta.has(b));
    if (tidakValid.length > 0)
      throw httpError(
        `BKK berikut tidak memenuhi syarat klaim (sudah diklaim atau diajukan, sebelum tanggal mulai, atau bukan kas ${rekTujuan}): ${tidakValid.join(", ")}`,
      );

    // Akun biaya baris manual: semua akun boleh, kecuali kas klaim, nonaktif, atau induk
    if (manual.length) {
      const akunSet = [...new Set(manual.map((m) => m.akun))];
      try {
        assertTidakKeKasKlaim(akunSet, tanggal);
      } catch (e) {
        throw httpError(e.message);
      }
      const [okAkun] = await conn.query(
        `SELECT rek_kode FROM finance.trekening
         WHERE rek_isaktif = 0${sqlTanpaInduk()} AND rek_kode IN (?)`,
        [akunSet],
      );
      const ada = new Set(okAkun.map((r) => r.rek_kode));
      const salah = akunSet.filter((a) => !ada.has(a));
      if (salah.length)
        throw httpError(
          `Akun biaya tidak valid (nonaktif / induk / tidak ada): ${salah.join(", ")}`,
        );

      // Cost center + departemen: pasangannya harus ada di master
      // (filter sama dengan lookup: kode 7 atau >= 10)
      const kodeCc = [...new Set(manual.map((m) => m.cc))];
      const [okCc] = await conn.query(
        `SELECT dc_kode, dc_nama FROM finance.tcostcenteritem
         WHERE dc_kode IN (?)
           AND (CAST(dc_kode AS UNSIGNED) = 7 OR CAST(dc_kode AS UNSIGNED) >= 10)`,
        [kodeCc],
      );
      const pasangan = new Set(okCc.map((r) => `${r.dc_kode}|${r.dc_nama}`));
      const ccSalah = manual.filter((m) => !pasangan.has(`${m.cc}|${m.dc}`));
      if (ccSalah.length)
        throw httpError(
          `Cost center / departemen tidak valid: ${[
            ...new Set(ccSalah.map((m) => `${m.cc} ${m.dc}`)),
          ].join(", ")}`,
        );
    }

    const total = round2(
      eligible.reduce((s, e) => s + e.nominal, 0) +
        manual.reduce((s, m) => s + m.nominal, 0),
    );

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
           (kkh_nomor, kkh_tanggal, kkh_cabang, kkh_rek_tujuan,
            kkh_total, kkh_keterangan, kkh_status, user_create, date_create)
         VALUES (?, ?, ?, ?, ?, ?, 'AKTIF', ?, NOW())`,
        [
          actualNomor,
          tanggal,
          cabang,
          rekTujuan,
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

    let noM = 0;
    for (const m of manual) {
      noM++;
      await conn.query(
        `INSERT INTO tklaim_kaskecil_dtl
           (kkd_kkh_nomor, kkd_jur_no, kkd_tipe, kkd_bon_nomor, kkd_tanggal,
            kkd_uraian, kkd_nominal, kkd_kunci, kkd_akun_biaya,
            kkd_cc_kode, kkd_dc_nama)
         VALUES (?, ?, 'MANUAL', '', ?, ?, ?, NULL, ?, ?, ?)`,
        [
          actualNomor,
          `MNL-${String(noM).padStart(3, "0")}`,
          m.tanggal,
          m.uraian,
          m.nominal,
          m.akun,
          m.cc,
          m.dc,
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

// ── Data cetak (ringkas per BKK) ──────────────────────────────────────
// cabangScope: cabang user bila bukan pusat/akses penuh; null = semua cabang
const getPrintData = async (nomor, cabangScope) => {
  const [[h]] = await db.query(
    `SELECT h.kkh_nomor AS nomor,
            DATE_FORMAT(h.kkh_tanggal,'%Y-%m-%d') AS tanggal,
            h.kkh_cabang AS cabang,
            h.kkh_rek_tujuan AS rekTujuan,
            h.kkh_total AS total,
            h.kkh_keterangan AS keterangan,
            h.kkh_status AS status,
            u.user_nama AS kasir
     FROM tklaim_kaskecil_hdr h
     LEFT JOIN tuser u ON u.user_kode = h.user_create
     WHERE h.kkh_nomor = ?`,
    [nomor],
  );
  if (!h) throw httpError("Klaim tidak ditemukan.", 404);
  if (cabangScope && h.cabang !== cabangScope)
    throw httpError("Klaim ini bukan milik cabang Anda.", 403);
  if (h.status !== "AKTIF")
    throw httpError("Klaim sudah dibatalkan. Tidak bisa dicetak.");

  const [dtl] = await db.query(
    `SELECT kkd_jur_no AS bkk, kkd_tipe AS tipe, kkd_akun_biaya AS akun,
            kkd_cc_kode AS cc, kkd_dc_nama AS dc,
            DATE_FORMAT(kkd_tanggal,'%Y-%m-%d') AS tanggal,
            kkd_uraian AS uraian, kkd_nominal AS nominal
     FROM tklaim_kaskecil_dtl WHERE kkd_kkh_nomor = ?
     ORDER BY kkd_tipe, kkd_tanggal, kkd_jur_no`,
    [nomor],
  );

  const namaAkun = await petaNamaAkun(dtl.map((d) => d.akun));
  const namaCc = await petaNamaCc(dtl.map((d) => d.cc));
  return {
    nomor: h.nomor,
    tanggal: h.tanggal,
    cabang: h.cabang,
    rekTujuan: await infoRekening(h.rekTujuan),
    keterangan: h.keterangan || "",
    kasir: h.kasir || "",
    total: Number(h.total),
    detail: dtl.map((d, i) => {
      const manual = d.tipe === "MANUAL";
      return {
        no: i + 1,
        bkk: manual ? "MANUAL" : d.bkk,
        manual,
        tanggal: d.tanggal,
        uraian: d.uraian,
        akun: manual ? `${d.akun} - ${namaAkun.get(d.akun) || ""}` : "",
        costCenter: manual ? `${namaCc.get(d.cc) || d.cc} - ${d.dc}` : "",
        nominal: Number(d.nominal),
      };
    }),
  };
};

module.exports = {
  cabangKerja,
  getDefaults,
  getBkkOptions,
  getDetailForm,
  getPrintData,
  saveData,
  cariBkkEligible,
};
