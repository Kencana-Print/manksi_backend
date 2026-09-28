const db = require("../../config/database");
const tutupBukuService = require("../tutupBukuService");

// ── Browse ────────────────────────────────────────────────────────────
const getBrowse = async (startDate, endDate) => {
  const [rows] = await db.query(
    `
    SELECT
      h.jur_no           AS Nomor,
      h.jur_tipetransaksi AS Tipe,
      DATE_FORMAT(h.jur_tanggal,'%Y-%m-%d') AS Tanggal,
      IFNULL((
        SELECT SUM(d.jurd_debet) FROM finance.tjurnalitem d WHERE d.jurd_jur_no = h.jur_no
      ), 0) AS Debet,
      IFNULL((
        SELECT SUM(d.jurd_kredit) FROM finance.tjurnalitem d WHERE d.jurd_jur_no = h.jur_no
      ), 0) AS Kredit,
      h.jur_keterangan   AS Keterangan,
      IF(h.jur_close=0,'Belum','Sudah') AS Closed
    FROM finance.tjurnal h
    LEFT JOIN finance.trekening r ON r.rek_kode = h.jur_rek_kode
    WHERE h.jur_tipetransaksi = 'JUR'
      AND h.jur_tanggal BETWEEN ? AND ?
    ORDER BY h.jur_no
  `,
    [startDate, endDate],
  );
  return rows;
};

// ── Browse Detail ─────────────────────────────────────────────────────
const getBrowseDetail = async (startDate, endDate) => {
  const [rows] = await db.query(
    `
    SELECT
      d.jurd_jur_no   AS Nomor,
      d.jurd_rek_kode AS Account,
      IFNULL(r.rek_nama,'') AS NamaAccount,
      d.jurd_dcnama   AS DetailCC,
      d.jurd_debet    AS Debet,
      d.jurd_kredit   AS Kredit,
      d.jurd_uraian   AS Uraian
    FROM finance.tjurnal h
    LEFT JOIN finance.tjurnalitem d ON d.jurd_jur_no = h.jur_no
    LEFT JOIN finance.trekening r ON r.rek_kode = d.jurd_rek_kode
    WHERE h.jur_tipetransaksi = 'JUR'
      AND h.jur_tanggal BETWEEN ? AND ?
    ORDER BY d.jurd_jur_no, d.jurd_nourut
  `,
    [startDate, endDate],
  );
  return rows;
};

// ── Delete ────────────────────────────────────────────────────────────
const deleteData = async (nomor) => {
  const [[jurnal]] = await db.query(
    `
    SELECT jur_tanggal, jur_close
    FROM finance.tjurnal WHERE jur_no = ?
  `,
    [nomor],
  );

  if (!jurnal) throw new Error("Data tidak ditemukan.");

  // Delphi: sudah diclose tidak bisa dihapus
  if (Number(jurnal.jur_close) !== 0)
    throw new Error("Transaksi sudah diclose. Tidak bisa dihapus.");

  // Cek tutup buku — pakai getTanggalTutupBukuUntukTanggal (boundary
  // closing UNTUK BULAN transaksi ini) dibanding hari ini, sama pola
  // dengan bkm/bkk/bbm/bbkService.js. Manual override (pengaturan.
  // tclose, cid="JUR") menang kalau ada.
  const tgl = new Date(jurnal.jur_tanggal);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const limitDate = await tutupBukuService.getTanggalTutupBukuUntukTanggal(
    jurnal.jur_tanggal,
  );
  limitDate.setHours(0, 0, 0, 0);

  const zCloseManual = await tutupBukuService.getManualTutupBuku("JUR");

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
    // Delphi: hanya delete tjurnal utama, tidak ada delete jurnal otomatis
    await conn.query(`DELETE FROM finance.tjurnal WHERE jur_no = ?`, [nomor]);
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
};

module.exports = { getBrowse, getBrowseDetail, deleteData };
