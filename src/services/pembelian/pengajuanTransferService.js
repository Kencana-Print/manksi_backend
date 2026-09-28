const db = require("../../config/database");
const tutupBukuService = require("../tutupBukuService");

// ── Browse master ─────────────────────────────────────────────────────
const getBrowse = async (startDate, endDate) => {
  const [rows] = await db.query(
    `
    SELECT x.Nomor, x.Tanggal, x.Account, x.NoRekAsal,
           x.NamaRekening,
           IF(x.sudah=0,'BELUM',
             IF(x.sudah>0 AND x.sudah<x.item,'PROSES','CLOSE')
           ) AS Status_
    FROM (
      SELECT
        h.pth_nomor   AS Nomor,
        DATE_FORMAT(h.pth_tanggal,'%Y-%m-%d') AS Tanggal,
        h.pth_rek_kode AS Account,
        r.rek_rekening  AS NoRekAsal,
        r.rek_nama      AS NamaRekening,
        IFNULL((
          SELECT COUNT(b.ptd_jur_no)
          FROM finance.tpengajuan_transfer_dtl b
          WHERE (b.ptd_jur_no<>'' OR b.ptd_batal<>'')
            AND b.ptd_nomor = h.pth_nomor
        ), 0) AS sudah,
        IFNULL((
          SELECT COUNT(*)
          FROM finance.tpengajuan_transfer_dtl b
          WHERE b.ptd_nomor = h.pth_nomor
        ), 0) AS item
      FROM finance.tpengajuan_transfer_hdr h
      LEFT JOIN finance.trekening r ON r.rek_kode = h.pth_rek_kode
      WHERE h.pth_tanggal BETWEEN ? AND ?
      ORDER BY h.pth_nomor
    ) x
  `,
    [startDate, endDate],
  );
  return rows;
};

// ── Browse detail ─────────────────────────────────────────────────────
const getBrowseDetail = async (startDate, endDate) => {
  const [rows] = await db.query(
    `
    SELECT
      d.ptd_nomor    AS Nomor,
      d.ptd_sup_kode AS KodeSup,
      s.sup_nama     AS NamaSupplier,
      d.ptd_bank     AS Bank,
      d.ptd_atasnama AS AtasNama,
      d.ptd_rekening AS Rekening,
      d.ptd_trs      AS NoTransaksi,
      d.ptd_nominal  AS Nominal,
      d.ptd_ket      AS Keterangan,
      DATE_FORMAT(d.ptd_realisasi,'%Y-%m-%d') AS TglRealisasi,
      d.ptd_akun     AS Account,
      r.rek_nama     AS NamaAccount,
      c.cc_nama      AS CcNama,
      d.ptd_dc_nama  AS DcNama,
      d.ptd_jur_no   AS Jurnal,
      d.ptd_batal    AS KetBatal
    FROM finance.tpengajuan_transfer_hdr h
    INNER JOIN finance.tpengajuan_transfer_dtl d ON d.ptd_nomor = h.pth_nomor
    LEFT JOIN tsupplier s ON s.sup_kode = d.ptd_sup_kode
    LEFT JOIN finance.trekening r ON r.rek_kode = d.ptd_akun
    LEFT JOIN finance.tcostcenter c ON c.cc_kode = d.ptd_cc_kode
    WHERE h.pth_tanggal BETWEEN ? AND ?
    ORDER BY d.ptd_nomor, d.ptd_nourut
  `,
    [startDate, endDate],
  );
  return rows;
};

// ── Delete ────────────────────────────────────────────────────────────
// Delphi: jika status bukan BELUM → warning extra "jurnal akan ikut dihapus"
// Delete hanya dari tpengajuan_transfer_hdr (cascade ke dtl via FK, atau manual)
const deleteData = async (nomor) => {
  // Cek status & tanggal
  const [[hdr]] = await db.query(
    `
    SELECT h.pth_tanggal,
      IFNULL((
        SELECT COUNT(b.ptd_jur_no)
        FROM finance.tpengajuan_transfer_dtl b
        WHERE (b.ptd_jur_no<>'' OR b.ptd_batal<>'')
          AND b.ptd_nomor = h.pth_nomor
      ),0) AS sudah,
      IFNULL((
        SELECT COUNT(*) FROM finance.tpengajuan_transfer_dtl b
        WHERE b.ptd_nomor = h.pth_nomor
      ),0) AS item
    FROM finance.tpengajuan_transfer_hdr h
    WHERE h.pth_nomor = ?
  `,
    [nomor],
  );

  if (!hdr) throw new Error("Data tidak ditemukan.");

  // Cek tutup buku — pola sama dengan modul-modul jurnal sebelumnya:
  // getTanggalTutupBukuUntukTanggal dibanding hari ini, manual override
  // (pengaturan.tclose, cid="PJT") menang kalau ada.
  const tgl = new Date(hdr.pth_tanggal);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const limitDate = await tutupBukuService.getTanggalTutupBukuUntukTanggal(
    hdr.pth_tanggal,
  );
  limitDate.setHours(0, 0, 0, 0);

  const zCloseManual = await tutupBukuService.getManualTutupBuku("PJT");

  let isTutupBuku = false;
  if (zCloseManual) {
    zCloseManual.setHours(0, 0, 0, 0);
    if (tgl < zCloseManual) isTutupBuku = true;
  } else {
    if (limitDate < today) isTutupBuku = true;
  }

  if (isTutupBuku)
    throw new Error("Periode sudah ditutup. Tidak bisa dihapus.");

  const conn = await db.getConnection();
  await conn.beginTransaction();
  try {
    // Delete header — dtl dihandle via FK atau manual
    await conn.query(
      `DELETE FROM finance.tpengajuan_transfer_dtl WHERE ptd_nomor = ?`,
      [nomor],
    );
    await conn.query(
      `DELETE FROM finance.tpengajuan_transfer_hdr WHERE pth_nomor = ?`,
      [nomor],
    );
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
};

// ── Get status untuk frontend (untuk warning hapus) ───────────────────
const getStatus = async (nomor) => {
  const [[row]] = await db.query(
    `
    SELECT
      IFNULL((
        SELECT COUNT(b.ptd_jur_no)
        FROM finance.tpengajuan_transfer_dtl b
        WHERE (b.ptd_jur_no<>'' OR b.ptd_batal<>'')
          AND b.ptd_nomor = h.pth_nomor
      ),0) AS sudah,
      IFNULL((
        SELECT COUNT(*) FROM finance.tpengajuan_transfer_dtl b
        WHERE b.ptd_nomor = h.pth_nomor
      ),0) AS item
    FROM finance.tpengajuan_transfer_hdr h
    WHERE h.pth_nomor = ?
  `,
    [nomor],
  );

  if (!row) throw new Error("Data tidak ditemukan.");

  const status =
    row.sudah === 0 ? "BELUM" : row.sudah < row.item ? "PROSES" : "CLOSE";
  return { status, sudah: row.sudah, item: row.item };
};

// Khusus filter pending dari dashboard — semua periode, status BELUM/PROSES
const getBrowsePendingAll = async () => {
  const [rows] = await db.query(
    `
    SELECT x.Nomor, x.Tanggal, x.Account, x.NoRekAsal,
           x.NamaRekening,
           IF(x.sudah=0,'BELUM',
             IF(x.sudah>0 AND x.sudah<x.item,'PROSES','CLOSE')
           ) AS Status_
    FROM (
      SELECT
        h.pth_nomor   AS Nomor,
        DATE_FORMAT(h.pth_tanggal,'%Y-%m-%d') AS Tanggal,
        h.pth_rek_kode AS Account,
        r.rek_rekening  AS NoRekAsal,
        r.rek_nama      AS NamaRekening,
        IFNULL((
          SELECT COUNT(b.ptd_jur_no)
          FROM finance.tpengajuan_transfer_dtl b
          WHERE (b.ptd_jur_no<>'' OR b.ptd_batal<>'')
            AND b.ptd_nomor = h.pth_nomor
        ), 0) AS sudah,
        IFNULL((
          SELECT COUNT(*)
          FROM finance.tpengajuan_transfer_dtl b
          WHERE b.ptd_nomor = h.pth_nomor
        ), 0) AS item
      FROM finance.tpengajuan_transfer_hdr h
      LEFT JOIN finance.trekening r ON r.rek_kode = h.pth_rek_kode
    ) x
    WHERE x.sudah < x.item
    ORDER BY x.Tanggal
    `,
  );
  return rows;
};

const getBrowseDetailPendingAll = async () => {
  const [rows] = await db.query(
    `
    SELECT
      d.ptd_nomor    AS Nomor,
      d.ptd_sup_kode AS KodeSup,
      s.sup_nama     AS NamaSupplier,
      d.ptd_bank     AS Bank,
      d.ptd_atasnama AS AtasNama,
      d.ptd_rekening AS Rekening,
      d.ptd_trs      AS NoTransaksi,
      d.ptd_nominal  AS Nominal,
      d.ptd_ket      AS Keterangan,
      DATE_FORMAT(d.ptd_realisasi,'%Y-%m-%d') AS TglRealisasi,
      d.ptd_akun     AS Account,
      r.rek_nama     AS NamaAccount,
      c.cc_nama      AS CcNama,
      d.ptd_dc_nama  AS DcNama,
      d.ptd_jur_no   AS Jurnal,
      d.ptd_batal    AS KetBatal
    FROM finance.tpengajuan_transfer_hdr h
    INNER JOIN finance.tpengajuan_transfer_dtl d ON d.ptd_nomor = h.pth_nomor
    LEFT JOIN tsupplier s ON s.sup_kode = d.ptd_sup_kode
    LEFT JOIN finance.trekening r ON r.rek_kode = d.ptd_akun
    LEFT JOIN finance.tcostcenter c ON c.cc_kode = d.ptd_cc_kode
    WHERE h.pth_nomor IN (
      SELECT x.Nomor FROM (
        SELECT
          hh.pth_nomor AS Nomor,
          IFNULL((
            SELECT COUNT(b.ptd_jur_no)
            FROM finance.tpengajuan_transfer_dtl b
            WHERE (b.ptd_jur_no<>'' OR b.ptd_batal<>'')
              AND b.ptd_nomor = hh.pth_nomor
          ), 0) AS sudah,
          IFNULL((
            SELECT COUNT(*)
            FROM finance.tpengajuan_transfer_dtl b
            WHERE b.ptd_nomor = hh.pth_nomor
          ), 0) AS item
        FROM finance.tpengajuan_transfer_hdr hh
      ) x
      WHERE x.sudah < x.item
    )
    ORDER BY d.ptd_nomor, d.ptd_nourut
    `,
  );
  return rows;
};

module.exports = {
  getBrowse,
  getBrowseDetail,
  deleteData,
  getStatus,
  getBrowsePendingAll,
  getBrowseDetailPendingAll,
};
