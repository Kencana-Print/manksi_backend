const db = require("../../config/database");
const { bisaUbah, galat, SQL_TERLAMBAT } = require("./notulensiMeetingService");

const NOMOR_LOCK = "tnotulensi_nomor";
const STATUS_VALID = ["OPEN", "PROGRESS", "DONE", "BATAL"];
const MAKS_AGENDA = 200;
const MAKS_LOKASI = 100;
const MAKS_PIC = 200;

const tglValid = (v) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [y, m, d] = v.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return (
    dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d
  );
};

// ─────────────────────────────────────────────────────────
// Validasi + normalisasi payload
// payload: { tanggal, agenda, peserta, lokasi,
//            detail: [{ hasil, pic, deadline, statusUser }] }
// ─────────────────────────────────────────────────────────
const siapkanData = (payload) => {
  const tanggal = String(payload?.tanggal || "").trim();
  if (!tglValid(tanggal)) throw galat("Tanggal meeting tidak valid.", 400);

  const agenda = String(payload?.agenda || "").trim();
  if (!agenda) throw galat("Agenda meeting wajib diisi.", 400);
  if (agenda.length > MAKS_AGENDA) {
    throw galat(`Agenda maksimal ${MAKS_AGENDA} karakter.`, 400);
  }

  const lokasi = String(payload?.lokasi || "").trim();
  if (!lokasi) throw galat("Lokasi meeting wajib diisi.", 400);
  if (lokasi.length > MAKS_LOKASI) {
    throw galat(`Lokasi maksimal ${MAKS_LOKASI} karakter.`, 400);
  }

  const peserta = String(payload?.peserta || "").trim();

  const detail = [];
  (Array.isArray(payload?.detail) ? payload.detail : []).forEach((r, i) => {
    const hasil = String(r?.hasil || "").trim();
    const pic = String(r?.pic || "").trim();
    const deadline = String(r?.deadline || "").trim();
    const statusUser = String(r?.statusUser || "OPEN")
      .trim()
      .toUpperCase();
    const statusSistem = String(r?.statusSistem || "OPEN")
      .trim()
      .toUpperCase();

    // baris benar-benar kosong (baris trailing grid) dilewati
    if (!hasil && !pic && !deadline) return;

    const baris = i + 1;
    if (!hasil) {
      throw galat(`Hasil/tindak lanjut baris ${baris} wajib diisi.`, 400);
    }
    if (pic.length > MAKS_PIC) {
      throw galat(`PIC baris ${baris} maksimal ${MAKS_PIC} karakter.`, 400);
    }
    if (deadline && !tglValid(deadline)) {
      throw galat(`Deadline baris ${baris} tidak valid.`, 400);
    }
    if (!STATUS_VALID.includes(statusUser)) {
      throw galat(
        `Status User baris ${baris} tidak valid (${STATUS_VALID.join(" / ")}).`,
        400,
      );
    }
    if (!STATUS_VALID.includes(statusSistem)) {
      throw galat(
        `Status Sistem baris ${baris} tidak valid (${STATUS_VALID.join(" / ")}).`,
        400,
      );
    }
    detail.push({
      hasil,
      pic,
      deadline: deadline || null,
      statusUser,
      statusSistem,
    });
  });

  if (detail.length === 0) {
    throw galat("Minimal satu hasil/tindak lanjut harus diisi.", 400);
  }

  return { tanggal, agenda, peserta, lokasi, detail };
};

// ─────────────────────────────────────────────────────────
// Nomor otomatis: NTM.<yyyy><mm>.<urut 4 digit> (bulan dari tanggal meeting)
// Dipanggil di dalam GET_LOCK + transaksi (lihat create)
// ─────────────────────────────────────────────────────────
const generateNomor = async (tanggal, conn) => {
  const [yyyy, mm] = tanggal.split("-");
  const prefix = `NTM.${yyyy}${mm}.`;
  const [[row]] = await conn.query(
    `SELECT IFNULL(MAX(CAST(RIGHT(ntm_nomor, 4) AS UNSIGNED)), 0) AS maxVal
     FROM tnotulensi_hdr WHERE ntm_nomor LIKE ?`,
    [`${prefix}%`],
  );
  const next = Number(row.maxVal) + 1;
  return `${prefix}${String(next).padStart(4, "0")}`;
};

const insertDetail = async (conn, nomor, detail) => {
  await conn.query(
    `INSERT INTO tnotulensi_dtl
       (ntmd_nomor, ntmd_nourut, ntmd_hasil, ntmd_pic, ntmd_deadline,
        ntmd_status_user, ntmd_status_sistem)
     VALUES ?`,
    [
      detail.map((d, i) => [
        nomor,
        i + 1,
        d.hasil,
        d.pic,
        d.deadline,
        d.statusUser,
        d.statusSistem,
      ]),
    ],
  );
};

// ─────────────────────────────────────────────────────────
// BARU
// ─────────────────────────────────────────────────────────
const create = async (payload, user) => {
  const data = siapkanData(payload);
  const kodeUser = user?.kode || user?.username || "SYSTEM";

  const conn = await db.getConnection();
  let lockDiambil = false;
  try {
    const [[lock]] = await conn.query("SELECT GET_LOCK(?, 10) AS ok", [
      NOMOR_LOCK,
    ]);
    if (!lock.ok) {
      throw galat("Sistem sedang membuat nomor lain, coba lagi sebentar.", 409);
    }
    lockDiambil = true;

    // transaksi dimulai SETELAH lock, supaya MAX() melihat nomor terakhir yang sudah commit
    await conn.beginTransaction();
    const nomor = await generateNomor(data.tanggal, conn);

    await conn.query(
      `INSERT INTO tnotulensi_hdr
         (ntm_nomor, ntm_tanggal, ntm_agenda, ntm_peserta, ntm_lokasi, ntm_user)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [nomor, data.tanggal, data.agenda, data.peserta, data.lokasi, kodeUser],
    );
    await insertDetail(conn, nomor, data.detail);

    await conn.commit();
    return { nomor };
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    if (lockDiambil) {
      await conn.query("SELECT RELEASE_LOCK(?)", [NOMOR_LOCK]).catch(() => {});
    }
    conn.release();
  }
};

// ─────────────────────────────────────────────────────────
// UBAH — hanya pembuat atau superadmin. Nomor tidak berubah
// walau tanggal meeting dipindah bulan.
// ─────────────────────────────────────────────────────────
const update = async (nomor, payload, user) => {
  const data = siapkanData(payload);
  const kodeUser = user?.kode || user?.username || "SYSTEM";

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [[hdr]] = await conn.query(
      `SELECT ntm_user FROM tnotulensi_hdr WHERE ntm_nomor = ? FOR UPDATE`,
      [nomor],
    );
    if (!hdr) throw galat("Notulensi tidak ditemukan.", 404);
    if (!bisaUbah(hdr.ntm_user, user)) {
      throw galat(
        "Notulensi hanya bisa diubah oleh pembuat dokumen atau superadmin.",
        403,
      );
    }

    await conn.query(
      `UPDATE tnotulensi_hdr
       SET ntm_tanggal = ?, ntm_agenda = ?, ntm_peserta = ?, ntm_lokasi = ?,
           ntm_user_ubah = ?, ntm_tgl_ubah = NOW()
       WHERE ntm_nomor = ?`,
      [data.tanggal, data.agenda, data.peserta, data.lokasi, kodeUser, nomor],
    );
    await conn.query(`DELETE FROM tnotulensi_dtl WHERE ntmd_nomor = ?`, [
      nomor,
    ]);
    await insertDetail(conn, nomor, data.detail);

    await conn.commit();
    return { nomor };
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
};

// ─────────────────────────────────────────────────────────
// UBAH STATUS SAJA — boleh oleh semua user ber-izin edit menu.
// Hanya Status User & Status Sistem per baris (kunci: noUrut);
// isi notulensi tidak bisa disentuh lewat jalur ini.
// ─────────────────────────────────────────────────────────
const updateStatus = async (nomor, payload, user) => {
  const kodeUser = user?.kode || user?.username || "SYSTEM";
  const rows = Array.isArray(payload?.detail) ? payload.detail : [];
  if (rows.length === 0) throw galat("Tidak ada status yang diubah.", 400);

  const data = rows.map((r, i) => {
    const baris = i + 1;
    const noUrut = Number(r?.noUrut);
    if (!Number.isInteger(noUrut) || noUrut < 1) {
      throw galat(`No urut baris ${baris} tidak valid.`, 400);
    }
    const statusUser = String(r?.statusUser || "")
      .trim()
      .toUpperCase();
    const statusSistem = String(r?.statusSistem || "")
      .trim()
      .toUpperCase();
    if (!STATUS_VALID.includes(statusUser)) {
      throw galat(`Status User baris ${baris} tidak valid.`, 400);
    }
    if (!STATUS_VALID.includes(statusSistem)) {
      throw galat(`Status Sistem baris ${baris} tidak valid.`, 400);
    }
    return { noUrut, statusUser, statusSistem };
  });

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [[hdr]] = await conn.query(
      `SELECT ntm_nomor FROM tnotulensi_hdr WHERE ntm_nomor = ? FOR UPDATE`,
      [nomor],
    );
    if (!hdr) throw galat("Notulensi tidak ditemukan.", 404);

    const [ada] = await conn.query(
      `SELECT ntmd_nourut FROM tnotulensi_dtl WHERE ntmd_nomor = ?`,
      [nomor],
    );
    const adaSet = new Set(ada.map((r) => Number(r.ntmd_nourut)));
    for (const d of data) {
      if (!adaSet.has(d.noUrut)) {
        throw galat(
          `Tindak lanjut no ${d.noUrut} tidak ditemukan. Muat ulang halaman.`,
          409,
        );
      }
    }

    for (const d of data) {
      await conn.query(
        `UPDATE tnotulensi_dtl
         SET ntmd_status_user = ?, ntmd_status_sistem = ?
         WHERE ntmd_nomor = ? AND ntmd_nourut = ?`,
        [d.statusUser, d.statusSistem, nomor, d.noUrut],
      );
    }
    await conn.query(
      `UPDATE tnotulensi_hdr SET ntm_user_ubah = ?, ntm_tgl_ubah = NOW()
       WHERE ntm_nomor = ?`,
      [kodeUser, nomor],
    );

    await conn.commit();
    return { nomor };
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
};

// ─────────────────────────────────────────────────────────
// AMBIL SATU (form ubah)
// ─────────────────────────────────────────────────────────
const getById = async (nomor, user) => {
  const [[hdr]] = await db.query(
    `SELECT
       ntm_nomor AS nomor,
       DATE_FORMAT(ntm_tanggal, '%Y-%m-%d') AS tanggal,
       ntm_agenda AS agenda,
       ntm_peserta AS peserta,
       ntm_lokasi AS lokasi,
       ntm_user AS pembuat
     FROM tnotulensi_hdr
     WHERE ntm_nomor = ?`,
    [nomor],
  );
  if (!hdr) throw galat("Notulensi tidak ditemukan.", 404);

  const [rows] = await db.query(
    `SELECT
       d.ntmd_nourut AS noUrut,
       d.ntmd_hasil AS hasil,
       d.ntmd_pic AS pic,
       DATE_FORMAT(d.ntmd_deadline, '%Y-%m-%d') AS deadline,
       d.ntmd_status_user AS statusUser,
       d.ntmd_status_sistem AS statusSistem,
       ${SQL_TERLAMBAT} AS terlambat
     FROM tnotulensi_dtl d
     WHERE d.ntmd_nomor = ?
     ORDER BY d.ntmd_nourut`,
    [nomor],
  );

  return {
    ...hdr,
    peserta: hdr.peserta || "",
    bisaUbah: bisaUbah(hdr.pembuat, user),
    detail: rows.map((r) => ({ ...r, terlambat: !!Number(r.terlambat) })),
  };
};

// ─────────────────────────────────────────────────────────
// CETAK — sama dengan getById + nama pembuat.
// tuser (latin1) TIDAK di-JOIN ke tabel utf8mb4, diambil terpisah
// supaya tidak kena "Illegal mix of collations".
// ─────────────────────────────────────────────────────────
const getCetak = async (nomor, user) => {
  const data = await getById(nomor, user);
  const [[u]] = await db.query(
    `SELECT user_nama FROM tuser WHERE user_kode = ?`,
    [data.pembuat],
  );
  return { ...data, namaPembuat: u?.user_nama || data.pembuat };
};

// ─────────────────────────────────────────────────────────
// LOOKUP PIC — daftar bagian dari tuser.user_bagian
// (belum memfilter user_aktif karena arti nilainya belum dikonfirmasi)
// ─────────────────────────────────────────────────────────
const getLookupBagian = async () => {
  const [rows] = await db.query(
    `SELECT DISTINCT user_bagian AS bagian
     FROM tuser
     WHERE user_bagian <> ''
     ORDER BY user_bagian`,
  );
  return rows.map((r) => r.bagian);
};

module.exports = {
  create,
  update,
  updateStatus,
  getById,
  getCetak,
  getLookupBagian,
};
