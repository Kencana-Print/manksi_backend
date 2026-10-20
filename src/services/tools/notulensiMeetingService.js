const db = require("../../config/database");

const BAGIAN_SUPERADMIN = ["EDP", "DIR", "AUDIT"];

const galat = (pesan, status) => {
  const e = new Error(pesan);
  e.status = status;
  return e;
};

const isSuperadmin = (user) =>
  BAGIAN_SUPERADMIN.includes(
    String(user?.bagian || "")
      .trim()
      .toUpperCase(),
  );

// Boleh ubah/hapus = pembuat dokumen ATAU superadmin (EDP/DIR/AUDIT).
const bisaUbah = (pembuat, user) => {
  if (isSuperadmin(user)) return true;
  const kode = String(user?.kode || user?.username || "")
    .trim()
    .toUpperCase();
  if (!kode) return false;
  return (
    String(pembuat || "")
      .trim()
      .toUpperCase() === kode
  );
};

const fmtLokal = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const cekTanggal = (v, label) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    throw galat(`${label} tidak valid (format YYYY-MM-DD).`, 400);
  }
  return v;
};

// Penanda keterlambatan (BUKAN status, tidak disimpan): deadline lewat dan
// Status User belum DONE/BATAL. Alias tabel detail HARUS "d".
const SQL_TERLAMBAT = `IFNULL(
  d.ntmd_status_user NOT IN ('DONE', 'BATAL') AND d.ntmd_deadline < CURDATE(), 0)`;

// ─────────────────────────────────────────────────────────
// BROWSE — list header + ringkasan tindak lanjut
// ─────────────────────────────────────────────────────────
const getBrowseList = async (query, user) => {
  const now = new Date();
  const startDate = cekTanggal(
    query.startDate || fmtLokal(new Date(now.getFullYear(), now.getMonth(), 1)),
    "Tanggal awal",
  );
  const endDate = cekTanggal(query.endDate || fmtLokal(now), "Tanggal akhir");

  const [rows] = await db.query(
    `SELECT
       h.ntm_nomor AS nomor,
       DATE_FORMAT(h.ntm_tanggal, '%Y-%m-%d') AS tanggal,
       h.ntm_agenda AS agenda,
       h.ntm_peserta AS peserta,
       h.ntm_lokasi AS lokasi,
       h.ntm_user AS pembuat,
       IFNULL(x.jml, 0) AS jmlTindakLanjut,
       IFNULL(x.selesai, 0) AS jmlSelesai,
       IFNULL(x.terlambat, 0) AS jmlTerlambat
     FROM tnotulensi_hdr h
     LEFT JOIN (
       SELECT ntmd_nomor,
              COUNT(*) AS jml,
              SUM(ntmd_status_user = 'DONE') AS selesai,
              SUM(ntmd_status_user NOT IN ('DONE', 'BATAL')
                  AND ntmd_deadline < CURDATE()) AS terlambat
       FROM tnotulensi_dtl
       GROUP BY ntmd_nomor
     ) x ON x.ntmd_nomor = h.ntm_nomor
     WHERE h.ntm_tanggal >= ? AND h.ntm_tanggal <= ?
     ORDER BY h.ntm_tanggal DESC, h.ntm_nomor DESC`,
    [startDate, endDate],
  );

  return rows.map((r) => ({
    ...r,
    jmlTindakLanjut: Number(r.jmlTindakLanjut) || 0,
    jmlSelesai: Number(r.jmlSelesai) || 0,
    jmlTerlambat: Number(r.jmlTerlambat) || 0,
    bisaUbah: bisaUbah(r.pembuat, user),
  }));
};

// ─────────────────────────────────────────────────────────
// DETAIL — tindak lanjut satu notulensi (untuk expand di browse)
// ─────────────────────────────────────────────────────────
const getDetail = async (nomor) => {
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
  return rows.map((r) => ({ ...r, terlambat: !!Number(r.terlambat) }));
};

// ─────────────────────────────────────────────────────────
// EXPORT DETAIL — satu baris per tindak lanjut, data header ikut
// ─────────────────────────────────────────────────────────
const getExportDetail = async (query) => {
  const now = new Date();
  const startDate = cekTanggal(
    query.startDate || fmtLokal(new Date(now.getFullYear(), now.getMonth(), 1)),
    "Tanggal awal",
  );
  const endDate = cekTanggal(query.endDate || fmtLokal(now), "Tanggal akhir");

  const [rows] = await db.query(
    `SELECT
       h.ntm_nomor AS nomor,
       DATE_FORMAT(h.ntm_tanggal, '%Y-%m-%d') AS tanggal,
       h.ntm_agenda AS agenda,
       h.ntm_lokasi AS lokasi,
       h.ntm_peserta AS peserta,
       d.ntmd_nourut AS noUrut,
       d.ntmd_hasil AS hasil,
       d.ntmd_pic AS pic,
       DATE_FORMAT(d.ntmd_deadline, '%Y-%m-%d') AS deadline,
       d.ntmd_status_user AS statusUser,
       d.ntmd_status_sistem AS statusSistem,
       ${SQL_TERLAMBAT} AS terlambat
     FROM tnotulensi_hdr h
     INNER JOIN tnotulensi_dtl d ON d.ntmd_nomor = h.ntm_nomor
     WHERE h.ntm_tanggal >= ? AND h.ntm_tanggal <= ?
     ORDER BY h.ntm_tanggal, h.ntm_nomor, d.ntmd_nourut`,
    [startDate, endDate],
  );
  return rows.map((r) => ({ ...r, terlambat: !!Number(r.terlambat) }));
};

// ─────────────────────────────────────────────────────────
// HAPUS — hanya pembuat atau superadmin
// ─────────────────────────────────────────────────────────
const deleteData = async (nomor, user) => {
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
        "Notulensi hanya bisa dihapus oleh pembuat dokumen atau superadmin.",
        403,
      );
    }

    await conn.query(`DELETE FROM tnotulensi_dtl WHERE ntmd_nomor = ?`, [
      nomor,
    ]);
    await conn.query(`DELETE FROM tnotulensi_hdr WHERE ntm_nomor = ?`, [nomor]);

    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
};

module.exports = {
  getBrowseList,
  getDetail,
  getExportDetail,
  deleteData,
  isSuperadmin,
  bisaUbah,
  galat,
  SQL_TERLAMBAT,
};
