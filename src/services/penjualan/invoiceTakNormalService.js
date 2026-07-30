const db = require("../../config/database");
const tutupBukuService = require("../tutupBukuService");

// ═══════════════════════════════════════════════════════════
// INVOICE TAK NORMAL — SERVICE
// Migrasi dari ufrmBrowseInvTak.pas (Delphi)
// Filter kunci: inv_sts_pro = 2 (beda dari Invoice biasa 0/1)
// pin_trs untuk approval/pengajuan: 'INV TAKNORMAL' (bukan 'INV')
// ═══════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────
// BROWSE — Sesuai Delphi btnRefreshClick (SQLMaster)
// ─────────────────────────────────────────────────────────
const getBrowse = async (tglAwal, tglAkhir, canLihatCus = false) => {
  const custCol = canLihatCus
    ? "c.cus_nama AS NamaCustomer,"
    : `"" AS NamaCustomer,`;

  const [rows] = await db.query(
    `SELECT
       a.inv_nomor                                    AS Nomor,
       DATE_FORMAT(a.inv_tanggal,'%Y-%m-%d')          AS Tanggal,
       v.divisi                                        AS Divisi,
       ${custCol}
       a.inv_keterangan                                 AS Keterangan,
       IF(a.inv_sts_pro=0,'Normal', IF(a.inv_sts_pro=1,'Proforma','Tidak Normal')) AS Status,
       IF(a.inv_status_otomatis=1,'Otomatis','Normal') AS Otomatis,
       (
         SELECT (SUM(invd_harga*invd_jumlah) - a.inv_disc) *
           IF(a.inv_sts_ppn=1, ((100+a.inv_ppn)/100), 1)
         FROM tinv_dtl WHERE invd_inv_nomor = a.inv_nomor
       )                                                AS Total,
       CAST(a.inv_no_fp AS CHAR(60))                    AS Faktur_Pajak,
       IF(a.isexportppn=1,'Sudah Export','Belum')       AS Stat_Exp,
       IFNULL((
         SELECT SUM(kredit) FROM piutang_kredit_detail WHERE nota = a.inv_nomor
       ), 0)                                            AS Bayar,
       (
         SELECT tanggal FROM piutang_kredit_detail pkd
         INNER JOIN piutang_kredit_header pkh ON pkd.nomor = pkh.nomor
         WHERE pkd.kredit <> 0 AND pkd.nota = a.inv_nomor
         ORDER BY tanggal DESC LIMIT 1
       )                                                AS Tanggal_Pelunasan,
       (
         SELECT tbd.tanggal FROM terima_bayar_debet tbd
         INNER JOIN piutang_kredit_detail pkd ON pkd.no_bukti = tbd.nomor
         WHERE pkd.nota = a.inv_nomor
         ORDER BY tbd.tanggal DESC LIMIT 1
       )                                                AS Tanggal_Bayar,
       a.user_create                                    AS Usr,
       DATE_FORMAT(a.date_create,'%d-%m-%Y %T')         AS Created,
       IFNULL((
         SELECT
           IFNULL(IF(pin_acc='' AND pin_dipakai='','WAITING',
             IF(pin_acc='Y' AND pin_dipakai='','ACC',
               IF(pin_acc='Y' AND pin_dipakai='Y','ACC - USED',
                 IF(pin_acc='N','REJECTED','')))),'')
         FROM tspk_pin5
         WHERE pin_trs = 'INV TAKNORMAL' AND pin_nomor = a.inv_nomor
         ORDER BY pin_urut DESC LIMIT 1
       ), '')                                           AS ACC_Edit,
       (
         SELECT pin_alasan FROM tspk_pin5
         WHERE pin_trs = 'INV TAKNORMAL' AND pin_nomor = a.inv_nomor
         ORDER BY pin_urut DESC LIMIT 1
       )                                                AS Alasan
     FROM tinv_hdr a
     INNER JOIN tcustomer c ON a.inv_cus_kode = c.cus_kode
     LEFT JOIN tperusahaan p ON p.perush_kode = a.inv_perush_kode
     LEFT JOIN tdivisi v ON v.kode = a.inv_divisi
     WHERE a.inv_sts_pro = 2
       AND a.inv_tanggal >= ? AND a.inv_tanggal <= ?
     ORDER BY a.date_create`,
    [tglAwal, tglAkhir],
  );
  return rows;
};

// ─────────────────────────────────────────────────────────
// DETAIL 1 — Detail barang dari Invoice Tak Normal itu sendiri
// Sesuai Delphi SQLDetail (cxGrdDetail)
// ─────────────────────────────────────────────────────────
const getBrowseDetailBarang = async (tglAwal, tglAkhir, nomor = "") => {
  let where = `a.inv_sts_pro = 2 AND a.inv_tanggal >= ? AND a.inv_tanggal <= ?`;
  const params = [tglAwal, tglAkhir];

  if (nomor) {
    where += ` AND a.inv_nomor = ?`;
    params.push(nomor);
  }

  const [rows] = await db.query(
    `SELECT
       a.inv_nomor          AS Nomor,
       d.invd_spk_nomor     AS Kode,
       b.brg_name           AS Nama,
       d.invd_ukuran        AS Ukuran,
       d.invd_jumlah        AS Jumlah,
       d.invd_harga         AS Harga,
       s.spk_hargariil      AS HargaRiil,
       s.spk_hargaFEE       AS Fee
     FROM tinv_dtl d
     INNER JOIN tinv_hdr a ON a.inv_nomor = d.invd_inv_nomor
     INNER JOIN tbarang b ON b.brg_kode = d.invd_spk_nomor
     LEFT JOIN tspk s ON s.spk_nomor = d.invd_spk_nomor
     WHERE ${where}
     ORDER BY a.inv_nomor`,
    params,
  );
  return rows;
};

// ─────────────────────────────────────────────────────────
// DETAIL 2 — Daftar Invoice Normal yang dinaungi (via tinv_flag)
// Sesuai Delphi loadinv() — CDSGrid2
// Tidak pakai filter tanggal, murni per nomor (sama seperti Delphi)
// ─────────────────────────────────────────────────────────
const getBrowseDetailInvoiceNormal = async (nomor) => {
  const [rows] = await db.query(
    `SELECT
       f.invf_normal AS InvoiceNormal,
       IFNULL((
         SELECT v.divisi FROM tinv_hdr a
         LEFT JOIN tdivisi v ON v.kode = a.inv_divisi
         WHERE a.inv_nomor = f.invf_normal
       ), '')                                          AS Cabang,
       (
         SELECT DATE_FORMAT(a.inv_tanggal,'%Y-%m-%d')
         FROM tinv_hdr a WHERE a.inv_nomor = f.invf_normal
       )                                                AS Tanggal,
       IFNULL((
         SELECT a.inv_cus_kode FROM tinv_hdr a WHERE a.inv_nomor = f.invf_normal
       ), '')                                          AS KodeCus,
       IFNULL((
         SELECT c.cus_nama FROM tinv_hdr a
         LEFT JOIN tcustomer c ON c.cus_kode = a.inv_cus_kode
         WHERE a.inv_nomor = f.invf_normal
       ), '')                                          AS NamaCustomer,
       IFNULL((
         SELECT c.cus_alamat FROM tinv_hdr a
         LEFT JOIN tcustomer c ON c.cus_kode = a.inv_cus_kode
         WHERE a.inv_nomor = f.invf_normal
       ), '')                                          AS Alamat,
       IFNULL((
         SELECT SUM(b.invd_harga*b.invd_jumlah*IF(a.inv_sts_ppn=1,((100+a.inv_ppn)/100),1))
         FROM tinv_hdr a LEFT JOIN tinv_dtl b ON a.inv_nomor = b.invd_inv_nomor
         WHERE a.inv_nomor = f.invf_normal
       ), 0)                                            AS Nominal
     FROM tinv_flag f
     WHERE f.invf_taknormal = ?`,
    [nomor],
  );
  return rows;
};

// ─────────────────────────────────────────────────────────
// CEK BISA HAPUS — tutup buku
// Sesuai Delphi cxButton4Click.
// CATATAN: berbeda dari Invoice biasa — di sini TIDAK cek manual
// override tutup buku (getManualTutupBuku), murni cek ztglclose
// otomatis. Ini sesuai persis logika Delphi untuk form ini.
// ─────────────────────────────────────────────────────────
const cekBisaHapus = async (nomor) => {
  const [[hdr]] = await db.query(
    `SELECT inv_nomor, inv_tanggal FROM tinv_hdr WHERE inv_nomor = ? AND inv_sts_pro = 2`,
    [nomor],
  );
  if (!hdr) throw new Error("Data tidak ditemukan.");

  const tgl = new Date(hdr.inv_tanggal);
  let zMonth = tgl.getMonth();
  let zYear = tgl.getFullYear();
  if (zMonth === 11) {
    zMonth = 0;
    zYear += 1;
  } else {
    zMonth += 1;
  }

  let ztglclose = 0;
  const [verRows] = await db.query(
    `SELECT tgl_close FROM tversi WHERE aplikasi = 'MANKSI' LIMIT 1`,
  );
  if (verRows.length > 0) ztglclose = parseInt(verRows[0].tgl_close, 10) || 0;

  const limitDate = new Date(zYear, zMonth, ztglclose);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  limitDate.setHours(0, 0, 0, 0);

  if (today > limitDate) {
    return {
      bisaHapus: false,
      reason: "Transaksi tsb sudah close.\nTidak bisa dihapus.",
    };
  }
  return { bisaHapus: true, reason: null };
};

// ─────────────────────────────────────────────────────────
// DELETE
// Sesuai Delphi cxButton4Click:
//   1. Hapus header tinv_hdr (invoice tak normal)
//   2. Untuk tiap invf_normal terkait (via tinv_flag):
//      reset inv_flag=0 & piutang_debet.flag=0 (lepas dari payung)
//   3. Hapus baris tinv_flag terkait
// CATATAN: Delphi tidak menghapus tinv_dtl secara eksplisit di sini.
// Diikuti apa adanya — perlu dipastikan ada FK cascade di DB, atau
// akan menyisakan baris tinv_dtl orphan.
// ─────────────────────────────────────────────────────────
const deleteData = async (nomor) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    await conn.query(`DELETE FROM tinv_hdr WHERE inv_nomor = ?`, [nomor]);

    const [linked] = await conn.query(
      `SELECT invf_normal FROM tinv_flag WHERE invf_taknormal = ?`,
      [nomor],
    );
    for (const row of linked) {
      await conn.query(`UPDATE tinv_hdr SET inv_flag = 0 WHERE inv_nomor = ?`, [
        row.invf_normal,
      ]);
      await conn.query(`UPDATE piutang_debet SET flag = 0 WHERE nota = ?`, [
        row.invf_normal,
      ]);
    }

    await conn.query(`DELETE FROM tinv_flag WHERE invf_taknormal = ?`, [nomor]);

    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
};

// ─────────────────────────────────────────────────────────
// PENGAJUAN UBAH (PIN5) — pin_trs = 'INV TAKNORMAL'
// Sesuai Delphi PengajuanPerubahanData1Click + btnAjukkanClick
// CATATAN: Delphi tidak mengecek status pelunasan di sini (beda
// dari Invoice biasa yang mengecek). Diikuti apa adanya.
// ─────────────────────────────────────────────────────────
const getPengajuanStatus = async (nomor) => {
  const [[row]] = await db.query(
    `SELECT pin_urut, pin_acc, pin_dipakai, pin_alasan
     FROM tspk_pin5
     WHERE pin_trs = 'INV TAKNORMAL' AND pin_nomor = ?
     ORDER BY pin_urut DESC LIMIT 1`,
    [nomor],
  );
  if (!row) return { urut: 1, alasan: "" };

  if (!row.pin_dipakai) {
    return { urut: row.pin_urut, alasan: row.pin_alasan || "" };
  }
  return { urut: row.pin_urut + 1, alasan: "" };
};

const cekPerluPengajuan = async (nomor) => {
  const [[hdr]] = await db.query(
    `SELECT inv_tanggal FROM tinv_hdr WHERE inv_nomor = ? AND inv_sts_pro = 2`,
    [nomor],
  );
  if (!hdr) throw new Error("Data tidak ditemukan.");

  const tgl = new Date(hdr.inv_tanggal);
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

  const zCloseManual =
    await tutupBukuService.getManualTutupBuku("INV TAKNORMAL");

  let perlu = false;
  if (zCloseManual) {
    zCloseManual.setHours(0, 0, 0, 0);
    if (tgl < zCloseManual) perlu = true;
  } else {
    if (limitDate < today) perlu = true;
  }

  return { perlu };
};

const pengajuanUbah = async (
  nomor,
  tanggal,
  namaCustomer,
  alasan,
  urut,
  userKode,
) => {
  await db.query(
    `INSERT INTO tspk_pin5
       (pin_trs, pin_nomor, pin_urut, pin_tgl_trs, pin_ket,
        pin_tgl_minta, pin_user_minta, pin_alasan)
     VALUES ('INV TAKNORMAL', ?, ?, ?, ?, NOW(), ?, ?)
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
      namaCustomer,
      userKode,
      alasan,
      tanggal,
      namaCustomer,
      userKode,
      alasan,
    ],
  );
};

// ─────────────────────────────────────────────────────────
// CEK BISA CETAK / UBAH
// Delphi tidak punya validasi status khusus untuk cetak/ubah di
// modul ini (semua baris di browse sudah pasti sts_pro=2), hanya
// permission (cekinsert/cekedit, sudah ditangani middleware) dan
// keberadaan data. Jadi di sini cukup cek existensi.
// ─────────────────────────────────────────────────────────
const cekBisaCetak = async (nomor) => {
  const [[row]] = await db.query(
    `SELECT inv_nomor FROM tinv_hdr WHERE inv_nomor = ? AND inv_sts_pro = 2`,
    [nomor],
  );
  if (!row) return { bisa: false, reason: "Data tidak ditemukan." };
  return { bisa: true, reason: null };
};

const cekBisaUbah = async (nomor) => {
  const [[row]] = await db.query(
    `SELECT inv_nomor FROM tinv_hdr WHERE inv_nomor = ? AND inv_sts_pro = 2`,
    [nomor],
  );
  if (!row) return { bisa: false, reason: "Data tidak ditemukan." };
  return { bisa: true, reason: null };
};

// ─────────────────────────────────────────────────────────
// EXPORT
// ─────────────────────────────────────────────────────────
const getExportData = async (tglAwal, tglAkhir, canLihatCus = false) =>
  getBrowse(tglAwal, tglAkhir, canLihatCus);
const getExportDetail = async (tglAwal, tglAkhir) =>
  getBrowseDetailBarang(tglAwal, tglAkhir);

module.exports = {
  getBrowse,
  getBrowseDetailBarang,
  getBrowseDetailInvoiceNormal,
  cekBisaHapus,
  deleteData,
  getPengajuanStatus,
  cekPerluPengajuan,
  pengajuanUbah,
  cekBisaCetak,
  cekBisaUbah,
  getExportData,
  getExportDetail,
};
