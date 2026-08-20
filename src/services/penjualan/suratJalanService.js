const db = require("../../config/database");
const tutupBukuService = require("../tutupBukuService");

const MENU_ID = "153";

// ─────────────────────────────────────────────────────────
// BROWSE
// Sesuai Delphi btnRefreshClick
// ─────────────────────────────────────────────────────────
const getBrowse = async (
  tglAwal,
  tglAkhir,
  divisi = 0,
  canLihatCus = false,
) => {
  let divisiFilter = "";
  if (divisi === 1) divisiFilter = " AND gdg_jadi = 1";
  if (divisi === 4) divisiFilter = " AND gdg_jadi = 4";

  const custCols = canLihatCus
    ? `a.sj_cus_kode AS KdCus,
       c.cus_nama AS Customer,
       a.sj_alamat_customer AS Alamat,
       a.sj_kota_customer AS Kota,`
    : `"" AS KdCus,
       "" AS Customer,
       "" AS Alamat,
       "" AS Kota,`;

  const [rows] = await db.query(
    `SELECT
       a.sj_nomor                                          AS Nomor,
       DATE_FORMAT(a.sj_tanggal, '%Y-%m-%d')              AS Tanggal,
       d.divisi                                            AS Divisi,
       a.sj_inv_sm                                        AS Invoice,
       ${custCols}
       a.sj_keterangan                                    AS Keterangan,
       g.gdg_nama                                         AS Gudang,
       SUM(sjd.sjd_jumlah)                                AS QtyKirim,
       IF(a.sj_approve=2,'Batal',
         IF(a.sj_approve=1,'Sudah',''))                   AS Approved,
       DATE_FORMAT(a.date_create, '%d-%m-%Y %T')          AS Created,
       DATE_FORMAT(a.date_modified, '%d-%m-%Y %T')        AS Modified,
       a.user_produksi                                    AS UsrProduksi,
       DATE_FORMAT(a.date_produksi, '%d-%m-%Y %T')        AS TglUbahProduksi,
       IFNULL((
         SELECT IFNULL(
           IF(pin_acc='' AND pin_dipakai='','WAIT',
           IF(pin_acc='Y' AND pin_dipakai='','ACC',
           IF(pin_acc='Y' AND pin_dipakai='Y','',
           IF(pin_acc='N','TOLAK','')))),
         '')
         FROM tspk_pin5
         WHERE pin_trs='SJ' AND pin_nomor=a.sj_nomor
         ORDER BY pin_urut DESC LIMIT 1
       ),'')                                              AS Ngedit
     FROM tsj_hdr a
     LEFT JOIN tsj_dtl sjd ON sjd.sjd_sj_nomor = a.sj_nomor
     INNER JOIN tgudang g ON g.gdg_kode = a.sj_gdg_kode
     LEFT JOIN tcustomer c ON c.cus_kode = a.sj_cus_kode
     LEFT JOIN tdivisi d ON d.kode = a.sj_divisi
     WHERE a.sj_status_otomatis = 0
       AND a.sj_tanggal >= ?
       AND a.sj_tanggal <= ?
       ${divisiFilter}
     GROUP BY a.sj_nomor
     ORDER BY a.sj_tanggal, a.sj_nomor`,
    [tglAwal, tglAkhir],
  );
  return rows;
};

// ─────────────────────────────────────────────────────────
// BROWSE DETAIL (expand row)
// Sesuai Delphi SQLDetail
// ─────────────────────────────────────────────────────────
const getBrowseDetail = async (tglAwal, tglAkhir, nomor = "") => {
  let where = `a.sj_status_otomatis = 0
    AND a.sj_tanggal >= ? AND a.sj_tanggal <= ?`;
  const params = [tglAwal, tglAkhir];

  if (nomor) {
    where += ` AND a.sj_nomor = ?`;
    params.push(nomor);
  }

  const [rows] = await db.query(
    `SELECT
       sjd.sjd_sj_nomor      AS Nomor,
       sjd.sjd_spk_nomor     AS SPK,
       s.spk_nama            AS Nama,
       sjd.sjd_ukuran        AS Ukuran,
       s.spk_panjang         AS Panjang,
       s.spk_lebar           AS Lebar,
       sjd.sjd_jumlah        AS Jumlah,
       sjd.sjd_koli          AS Koli,
       sjd.sjd_keterangan    AS Keterangan,
       sjd.sjd_nokirim       AS NoKirim,
       sjd.sjd_idkirim       AS IdKirim
     FROM tsj_hdr a
     INNER JOIN tsj_dtl sjd ON sjd.sjd_sj_nomor = a.sj_nomor
     INNER JOIN tspk s ON s.spk_nomor = sjd.sjd_spk_nomor
     WHERE ${where}
     ORDER BY sjd.sjd_sj_nomor, sjd.sjd_nourut`,
    params,
  );
  return rows;
};

// ─────────────────────────────────────────────────────────
// DELETE
// Sesuai Delphi cxButton4Click
// ─────────────────────────────────────────────────────────
const deleteData = async (nomor, userKode) => {
  const [[hdr]] = await db.query(
    `SELECT sj_inv_sm FROM tsj_hdr WHERE sj_nomor = ?`,
    [nomor],
  );
  if (!hdr) throw new Error("Data tidak ditemukan.");

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // ── FIX: hapus child rows dulu secara eksplisit, biar trigger
    // before_delete masing-masing jalan dan membalikkan
    // spk_jumlah_kirim / spk_prasj / tmasterstok_jadi / brg_stok ──
    await conn.query(`DELETE FROM tsj_approve WHERE sja_nomor = ?`, [nomor]);
    await conn.query(`DELETE FROM tsj_dtl WHERE sjd_sj_nomor = ?`, [nomor]);

    // 1. Hapus SJ by nomor
    await conn.query(`DELETE FROM tsj_hdr WHERE sj_nomor = ?`, [nomor]);

    // 2. Hapus SJ invoice otomatis (keterangan = nomor SJ) — sama,
    // pastikan child-nya juga dibersihkan dulu kalau ada
    const [otoHdr] = await conn.query(
      `SELECT sj_nomor FROM tsj_hdr WHERE sj_keterangan = ?`,
      [nomor],
    );
    for (const oh of otoHdr) {
      await conn.query(`DELETE FROM tsj_approve WHERE sja_nomor = ?`, [
        oh.sj_nomor,
      ]);
      await conn.query(`DELETE FROM tsj_dtl WHERE sjd_sj_nomor = ?`, [
        oh.sj_nomor,
      ]);
    }
    await conn.query(`DELETE FROM tsj_hdr WHERE sj_keterangan = ?`, [nomor]);

    // 3. Hapus invoice jika ada
    if (hdr.sj_inv_sm) {
      await conn.query(`DELETE FROM tinv_hdr WHERE inv_nomor = ?`, [
        hdr.sj_inv_sm,
      ]);
    }

    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
};

// ─────────────────────────────────────────────────────────
// PENGAJUAN UBAH (PIN5)
// Sesuai Delphi btnAjukkanClick + PengajuanPerubahanData1Click
// ─────────────────────────────────────────────────────────
const getPengajuanStatus = async (nomor) => {
  const [[row]] = await db.query(
    `SELECT pin_urut, pin_acc, pin_dipakai, pin_alasan
     FROM tspk_pin5
     WHERE pin_trs = 'SJ' AND pin_nomor = ?
     ORDER BY pin_urut DESC LIMIT 1`,
    [nomor],
  );
  if (!row) return { urut: 1, alasan: "", canRequest: true };

  // pin_dipakai kosong → masih pending, pakai urut yang sama
  if (!row.pin_dipakai) {
    return { urut: row.pin_urut, alasan: row.pin_alasan, canRequest: true };
  }
  // pin_dipakai terisi → buat urut baru
  return { urut: row.pin_urut + 1, alasan: "", canRequest: true };
};

const pengajuanUbah = async (
  nomor,
  tanggal,
  keterangan,
  alasan,
  urut,
  userKode,
) => {
  await db.query(
    `INSERT INTO tspk_pin5
       (pin_trs, pin_nomor, pin_urut, pin_tgl_trs, pin_ket,
        pin_tgl_minta, pin_user_minta, pin_alasan)
     VALUES ('SJ', ?, ?, ?, ?, NOW(), ?, ?)
     ON DUPLICATE KEY UPDATE
       pin_tgl_trs    = ?,
       pin_ket        = ?,
       pin_acc        = '',
       pin_tgl_minta  = NOW(),
       pin_user_minta = ?,
       pin_alasan     = ?`,
    [
      nomor,
      urut,
      tanggal,
      keterangan,
      userKode,
      alasan,
      tanggal,
      keterangan,
      userKode,
      alasan,
    ],
  );
};

// ─────────────────────────────────────────────────────────
// CEK SJ KEMARIN BELUM APPROVE
// Sesuai Delphi cxButton2Click (warning saat klik Baru)
// ─────────────────────────────────────────────────────────
const cekSjKemarinBelumApprove = async () => {
  const [rows] = await db.query(
    `SELECT sj_nomor FROM tsj_hdr
     WHERE sj_status_otomatis = 0
       AND sj_approve = 0
       AND DATEDIFF(CURDATE(), sj_tanggal) > 0
     LIMIT 1`,
  );
  return rows.length > 0;
};

// ─────────────────────────────────────────────────────────
// EXPORT DATA
// ─────────────────────────────────────────────────────────
const getExportData = async (
  tglAwal,
  tglAkhir,
  divisi = 0,
  canLihatCus = false,
) => {
  return getBrowse(tglAwal, tglAkhir, divisi, canLihatCus);
};

const getExportDetail = async (tglAwal, tglAkhir) => {
  return getBrowseDetail(tglAwal, tglAkhir);
};

// ─────────────────────────────────────────────────────────
// CEK BISA HAPUS/UBAH (tutup buku + approve)
// ─────────────────────────────────────────────────────────
const cekBisaHapusUbah = async (nomor) => {
  const [[hdr]] = await db.query(
    `SELECT sj_nomor, sj_tanggal, sj_approve, sj_inv_sm
     FROM tsj_hdr WHERE sj_nomor = ?`,
    [nomor],
  );
  if (!hdr) throw new Error("Data tidak ditemukan.");

  const tgl = new Date(hdr.sj_tanggal);
  const zMonth = tgl.getMonth();
  const zYear = tgl.getFullYear();

  let ztglclose = 0;
  const [verRows] = await db.query(
    `SELECT tgl_close FROM tversi WHERE aplikasi = 'MANKSI' LIMIT 1`,
  );
  if (verRows.length > 0) ztglclose = parseInt(verRows[0].tgl_close, 10) || 0;

  const limitDate = new Date(zYear, zMonth + 1, ztglclose);
  limitDate.setHours(0, 0, 0, 0);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const zCloseManual = await tutupBukuService.getManualTutupBuku("SJ");

  let isTutupBuku = false;
  if (zCloseManual) {
    zCloseManual.setHours(0, 0, 0, 0);
    if (tgl < zCloseManual) isTutupBuku = true;
  } else {
    if (limitDate < today) isTutupBuku = true;
  }

  if (isTutupBuku) {
    return {
      bisaHapus: false,
      reason: "Transaksi tsb sudah close. Tidak bisa dihapus.",
    };
  }

  return {
    bisaHapus: true,
    bisaUbah: hdr.sj_approve !== 1 && hdr.sj_approve !== 2,
    approved: hdr.sj_approve,
    invoice: hdr.sj_inv_sm,
    reason: null,
  };
};

// ─────────────────────────────────────────────────────────
// CEK PERLU PENGAJUAN
// ─────────────────────────────────────────────────────────
const cekPerluPengajuan = async (nomor) => {
  const [[hdr]] = await db.query(
    `SELECT sj_tanggal FROM tsj_hdr WHERE sj_nomor = ?`,
    [nomor],
  );
  if (!hdr) throw new Error("Data tidak ditemukan.");

  const tgl = new Date(hdr.sj_tanggal);
  const zMonth = tgl.getMonth();
  const zYear = tgl.getFullYear();

  let ztglclose = 0;
  const [verRows] = await db.query(
    `SELECT tgl_close FROM tversi WHERE aplikasi = 'MANKSI' LIMIT 1`,
  );
  if (verRows.length > 0) ztglclose = parseInt(verRows[0].tgl_close, 10) || 0;

  const limitDate = new Date(zYear, zMonth + 1, ztglclose);
  limitDate.setHours(0, 0, 0, 0);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const zCloseManual = await tutupBukuService.getManualTutupBuku("SJ");

  let perlu = false;
  if (zCloseManual) {
    zCloseManual.setHours(0, 0, 0, 0);
    if (tgl < zCloseManual) perlu = true;
  } else {
    if (limitDate < today) perlu = true;
  }

  return { perlu };
};

module.exports = {
  getBrowse,
  getBrowseDetail,
  cekBisaHapusUbah,
  deleteData,
  getPengajuanStatus,
  pengajuanUbah,
  cekSjKemarinBelumApprove,
  getExportData,
  getExportDetail,
  cekPerluPengajuan,
};
