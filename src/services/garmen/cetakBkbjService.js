const db = require("../../config/database");

const MENU_ID = "143";

const formatLocalDate = (d) => {
  const dt = d instanceof Date ? d : new Date(d);
  const yyyy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
};

// ─────────────────────────────────────────────────────────
// BROWSE — sesuai Delphi TfrmBKBJ.btnRefreshClick ✅
// ─────────────────────────────────────────────────────────
const getBrowse = async (tglAwal, tglAkhir, gudang) => {
  const [rows] = await db.query(
    `SELECT
       x.Gudang,
       DATE_FORMAT(x.Tanggal, '%Y-%m-%d') AS Tanggal,
       x.Expedisi,
       IFNULL(b.nomor, '')                    AS Nomor,
       DATE_FORMAT(b.date_create, '%Y-%m-%d') AS TglPrint
     FROM (
       SELECT h.gudang AS Gudang, h.tanggal AS Tanggal, d.expedisi AS Expedisi
       FROM tjadwalkirim h
       LEFT JOIN tjadwalkirim_dtl d ON d.nomor_kirim = h.nomor_kirim
       WHERE h.gudang = ?
         AND h.tanggal >= ?
         AND h.tanggal <= ?
       GROUP BY h.gudang, h.tanggal, d.expedisi
     ) x
     LEFT JOIN tjadwalkirim_bukti b
       ON b.gudang = x.Gudang
      AND b.tanggal = x.Tanggal
      AND b.expedisi = x.Expedisi
     ORDER BY x.Gudang, x.Tanggal, x.Expedisi`,
    [gudang, tglAwal, tglAkhir],
  );
  return rows;
};

const getExportData = async (tglAwal, tglAkhir, gudang) => {
  return getBrowse(tglAwal, tglAkhir, gudang);
};

// ─────────────────────────────────────────────────────────
// GENERATE NOMOR — sesuai Delphi getmaxnomor ✅
// ─────────────────────────────────────────────────────────
const getMaxNomor = async (tahun, conn) => {
  const runner = conn || db;
  const [[row]] = await runner.query(
    `SELECT IFNULL(MAX(RIGHT(nomor, 5)), 0) AS jumlah
     FROM tjadwalkirim_bukti
     WHERE LEFT(nomor, 8) = ?`,
    [`BKBJ${tahun}`],
  );
  const next = 100001 + Number(row.jumlah);
  return `BKBJ${tahun}${String(next).slice(-5)}`;
};

// ─────────────────────────────────────────────────────────
// PROSES CETAK — sesuai Delphi cxButton3Click ✅
// ─────────────────────────────────────────────────────────
const prosesCetak = async (gudang, tanggal, expedisi, userKode) => {
  if (!gudang) throw new Error("Gudang wajib diisi.");
  if (!tanggal) throw new Error("Tanggal wajib diisi.");

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [[existing]] = await conn.query(
      `SELECT nomor, DATE_FORMAT(date_create, '%Y-%m-%d') AS tgl_print
       FROM tjadwalkirim_bukti
       WHERE gudang = ? AND tanggal = ? AND expedisi = ?
       FOR UPDATE`,
      [gudang, tanggal, expedisi],
    );

    let nomor, tglPrint;
    if (existing) {
      nomor = existing.nomor;
      tglPrint = existing.tgl_print;
    } else {
      const tahun = String(new Date(tanggal).getFullYear());
      nomor = await getMaxNomor(tahun, conn);
      await conn.query(
        `INSERT INTO tjadwalkirim_bukti
           (gudang, tanggal, expedisi, nomor, date_create, usr_create)
         VALUES (?, ?, ?, ?, NOW(), ?)`,
        [gudang, tanggal, expedisi, nomor, userKode],
      );
      tglPrint = formatLocalDate(new Date());
    }

    await conn.commit();
    return { nomor, tglPrint, gudang, tanggal, expedisi };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
};

// ─────────────────────────────────────────────────────────
// HEADER BUKTI (untuk print) — dari tjadwalkirim_bukti
// ─────────────────────────────────────────────────────────
const getHeaderBukti = async (gudang, tanggal, expedisi) => {
  const [[row]] = await db.query(
    `SELECT nomor AS Nomor,
            DATE_FORMAT(date_create, '%Y-%m-%d') AS DateCreate,
            gudang AS Gudang, expedisi AS Expedisi
     FROM tjadwalkirim_bukti
     WHERE gudang = ? AND tanggal = ? AND expedisi = ?`,
    [gudang, tanggal, expedisi],
  );
  return row || null;
};

// ─────────────────────────────────────────────────────────
// DETAIL ITEM UNTUK CETAK — sesuai Delphi cetak() ✅
// field binding dikonfirmasi dari bkbj.fr3: Kode←spk_nomor, Nama←spk_nama
// ─────────────────────────────────────────────────────────
const getDetailCetak = async (gudang, tanggal, expedisi) => {
  const [rows] = await db.query(
    `SELECT
       h.spk_nomor  AS Kode,
       s.spk_nama   AS Nama,
       SUM(d.jumlah) AS Jumlah,
       SUM(d.koli)   AS Koli
     FROM tjadwalkirim h
     LEFT JOIN tjadwalkirim_dtl d ON d.nomor_kirim = h.nomor_kirim
     LEFT JOIN tspk s ON s.spk_nomor = h.spk_nomor
     WHERE h.gudang = ?
       AND h.tanggal = ?
       AND d.expedisi = ?
     GROUP BY h.gudang, h.tanggal, d.expedisi, h.spk_nomor
     ORDER BY h.spk_nomor`,
    [gudang, tanggal, expedisi],
  );
  return rows.map((r) => ({
    ...r,
    Jumlah: Number(r.Jumlah),
    Koli: Number(r.Koli),
  }));
};

module.exports = {
  MENU_ID,
  getBrowse,
  getExportData,
  prosesCetak,
  getHeaderBukti,
  getDetailCetak,
};
