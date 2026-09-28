const db = require("../../config/database");
const tutupBukuService = require("../tutupBukuService");

// ── Browse ────────────────────────────────────────────────────────────
const getBrowse = async (startDate, endDate, cabang) => {
  let sql = `
    SELECT
      h.jur_no          AS Nomor,
      h.jur_tipetransaksi AS Tipe,
      r.rek_nama        AS Account,
      DATE_FORMAT(h.jur_tanggal,'%Y-%m-%d') AS Tanggal,
      h.jur_penerima    AS Penerima,
      h.jur_nota        AS Nota,
      h.jur_keterangan  AS Keterangan,
      IFNULL((
        SELECT SUM(d.jurd_debet) FROM finance.tjurnalitem d WHERE d.jurd_jur_no = h.jur_no
      ), 0) AS Nominal,
      IFNULL(k.bon_nomor, IFNULL(p.ptd_nomor,'')) AS Link,
      IF(h.jur_close=0,'Belum','Sudah') AS Closed
    FROM finance.tjurnal h
    LEFT JOIN finance.trekening r ON r.rek_kode = h.jur_rek_kode
    LEFT JOIN finance.tkasbon k ON k.bon_jur_no = h.jur_no
    LEFT JOIN finance.tpengajuan_transfer_dtl p ON p.ptd_jur_no = h.jur_no
    WHERE h.jur_tipetransaksi = 'BBK'
      AND h.jur_otomatis = 0
      AND h.jur_tanggal BETWEEN ? AND ?
  `;
  const params = [startDate, endDate];

  if (cabang && cabang !== "HO-" && cabang !== "ALL") {
    sql += ` AND h.jur_cabang = ?`;
    params.push(cabang);
  }
  sql += ` ORDER BY h.jur_no`;

  const [rows] = await db.query(sql, params);
  return rows;
};

// ── Browse Detail ─────────────────────────────────────────────────────
const getBrowseDetail = async (startDate, endDate, cabang) => {
  let sql = `
    SELECT
      d.jurd_jur_no   AS Nomor,
      d.jurd_nourut   AS No,
      d.jurd_uraian   AS Uraian,
      d.jurd_debet    AS Nominal,
      d.jurd_rek_kode AS Account,
      IFNULL(r.rek_nama,'') AS NamaAccount,
      d.jurd_dcnama   AS DetailCC
    FROM finance.tjurnal h
    INNER JOIN finance.tjurnalitem d ON d.jurd_jur_no = h.jur_no
    LEFT JOIN finance.trekening r ON r.rek_kode = d.jurd_rek_kode
    WHERE h.jur_tipetransaksi = 'BBK'
      AND h.jur_otomatis = 0
      AND d.jurd_trs <> ''
      AND d.jurd_debet<>0
      AND h.jur_tanggal BETWEEN ? AND ?
  `;
  const params = [startDate, endDate];

  if (cabang && cabang !== "HO-" && cabang !== "ALL") {
    sql += ` AND h.jur_cabang = ?`;
    params.push(cabang);
  }
  sql += ` ORDER BY d.jurd_jur_no, d.jurd_nourut`;

  const [rows] = await db.query(sql, params);
  return rows;
};

// ── Delete ────────────────────────────────────────────────────────────
const deleteData = async (nomor) => {
  const [[jurnal]] = await db.query(
    `
    SELECT h.jur_tanggal, h.jur_close,
      IFNULL(k.bon_nomor, IFNULL(p.ptd_nomor,'')) AS link
    FROM finance.tjurnal h
    LEFT JOIN finance.tkasbon k ON k.bon_jur_no = h.jur_no
    LEFT JOIN finance.tpengajuan_transfer_dtl p ON p.ptd_jur_no = h.jur_no
    WHERE h.jur_no = ?
  `,
    [nomor],
  );

  if (!jurnal) throw new Error("Data tidak ditemukan.");

  // Delphi: BBK dari BON/PJT tidak bisa dihapus
  if (jurnal.link)
    throw new Error("BBK terbentuk otomatis dari BON/PJT. Tidak bisa dihapus.");

  // Delphi: sudah diclose tidak bisa dihapus
  if (Number(jurnal.jur_close) !== 0)
    throw new Error("Transaksi sudah diclose. Tidak bisa dihapus.");

  // Cek tutup buku — pakai getTanggalTutupBukuUntukTanggal (boundary
  // closing UNTUK BULAN transaksi ini) dibanding hari ini, sama pola
  // dengan bkkService.js/bbmService.js. Manual override (pengaturan.
  // tclose, cid="BBK") menang kalau ada.
  const tgl = new Date(jurnal.jur_tanggal);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const limitDate = await tutupBukuService.getTanggalTutupBukuUntukTanggal(
    jurnal.jur_tanggal,
  );
  limitDate.setHours(0, 0, 0, 0);

  const zCloseManual = await tutupBukuService.getManualTutupBuku("BBK");

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
    // Hapus jurnal utama
    await conn.query(`DELETE FROM finance.tjurnal WHERE jur_no = ?`, [nomor]);
    // Hapus jurnal otomatis terkait (MID untuk skip 2 char prefix)
    await conn.query(
      `DELETE FROM finance.tjurnal WHERE jur_otomatis = 1 AND MID(jur_no,3,18) = ?`,
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

module.exports = { getBrowse, getBrowseDetail, deleteData };
