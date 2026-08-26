const db = require("../../config/database");
const tutupBukuService = require("../tutupBukuService");

const MENU_ID = "156";

// ═══════════════════════════════════════════════════════════
// BROWSE
// Sesuai Delphi btnRefreshClick
// ═══════════════════════════════════════════════════════════
const getBrowse = async (tglAwal, tglAkhir) => {
  const [rows] = await db.query(
    `SELECT
       a.inv_nomor                                    AS Nomor,
       DATE_FORMAT(a.inv_tanggal,'%Y-%m-%d')          AS Tanggal,
       v.divisi                                        AS Divisi,
       c.cus_nama                                       AS NamaCustomer,
       a.inv_keterangan                                 AS Keterangan,
       IF(a.inv_sts_pro=0,'Normal', IF(a.inv_sts_pro=1,'Proforma','Tidak Normal')) AS Status,
       IF(a.inv_status_otomatis=1,'Otomatis','Normal') AS Otomatis,
       (
         SELECT (SUM(invd_harga*invd_jumlah) - a.inv_disc) +
           IF(a.inv_sts_ppn=1 AND a.inv_pph='',
             (a.inv_ppn/100 * (SUM(invd_harga*invd_jumlah) - a.inv_disc)),
             IF(a.inv_sts_ppn=1 AND a.inv_pph='PPh',
               (a.inv_ppn/100 * SUM(invd_harga*invd_jumlah)), 0))
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
       a.inv_Tgl_Terima                                 AS inv_Tgl_Terima,
       a.inv_Penerima                                   AS inv_Penerima,
       a.inv_RencanaBayar                               AS inv_RencanaBayar,
       a.user_create                                    AS Usr,
       a.inv_apvnosj                                    AS ApvNoSJ,
       DATE_FORMAT(a.date_create,'%d-%m-%Y %T')         AS Created,
       IFNULL((
         SELECT
           IFNULL(IF(pin_acc='' AND pin_dipakai='','WAITING',
             IF(pin_acc='Y' AND pin_dipakai='','ACC',
               IF(pin_acc='Y' AND pin_dipakai='Y','ACC - USED',
                 IF(pin_acc='N','REJECTED','')))),'')
         FROM tspk_pin5
         WHERE pin_trs = 'INV' AND pin_nomor = a.inv_nomor
         ORDER BY pin_urut DESC LIMIT 1
       ), '')                                           AS ACC_Edit,
       (
         SELECT pin_alasan FROM tspk_pin5
         WHERE pin_trs = 'INV' AND pin_nomor = a.inv_nomor
         ORDER BY pin_urut DESC LIMIT 1
       )                                                AS Alasan
     FROM tinv_hdr a
     LEFT JOIN tcustomer c ON a.inv_cus_kode = c.cus_kode
     LEFT JOIN tperusahaan p ON p.perush_kode = a.inv_perush_kode
     LEFT JOIN tdivisi v ON v.kode = a.inv_divisi
     WHERE a.inv_tanggal >= ? AND a.inv_tanggal <= ?
     ORDER BY a.date_create`,
    [tglAwal, tglAkhir],
  );
  return rows;
};

// ═══════════════════════════════════════════════════════════
// BROWSE DETAIL
// ═══════════════════════════════════════════════════════════
const getBrowseDetail = async (tglAwal, tglAkhir, nomor = "") => {
  let where = `a.inv_tanggal >= ? AND a.inv_tanggal <= ?`;
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

// ═══════════════════════════════════════════════════════════
// CEK BISA HAPUS — tutup buku
// Sesuai Delphi cxButton4Click
// ═══════════════════════════════════════════════════════════
const cekBisaHapus = async (nomor) => {
  const [[hdr]] = await db.query(
    `SELECT inv_nomor, inv_tanggal FROM tinv_hdr WHERE inv_nomor = ?`,
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

  const zCloseManual = await tutupBukuService.getManualTutupBuku("INV");

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
      reason: "Transaksi tsb sudah close.\nTidak bisa dihapus.",
    };
  }
  return { bisaHapus: true, reason: null };
};

// ═══════════════════════════════════════════════════════════
// DELETE
// Sesuai Delphi cxButton4Click
// ═══════════════════════════════════════════════════════════
const deleteData = async (nomor) => {
  await db.query(`DELETE FROM tinv_hdr WHERE inv_nomor = ?`, [nomor]);
};

// ═══════════════════════════════════════════════════════════
// PENGAJUAN UBAH (PIN5)
// Sesuai Delphi PengajuanPerubahanData1Click
// Validasi tambahan: kalau sudah ada pelunasan, tidak bisa pengajuan
// ═══════════════════════════════════════════════════════════
const getPengajuanStatus = async (nomor) => {
  // Cek sudah ada pelunasan
  const [[pelunasan]] = await db.query(
    `SELECT tanggal FROM piutang_kredit_detail pkd
     INNER JOIN piutang_kredit_header pkh ON pkd.nomor = pkh.nomor
     WHERE pkd.kredit <> 0 AND pkd.nota = ?
     ORDER BY tanggal DESC LIMIT 1`,
    [nomor],
  );
  if (pelunasan) {
    throw new Error("Sudah ada pelunasan.");
  }

  const [[row]] = await db.query(
    `SELECT pin_urut, pin_acc, pin_dipakai, pin_alasan
     FROM tspk_pin5
     WHERE pin_trs = 'INV' AND pin_nomor = ?
     ORDER BY pin_urut DESC LIMIT 1`,
    [nomor],
  );
  if (!row) return { urut: 1, alasan: "", canRequest: true };

  if (!row.pin_dipakai) {
    return { urut: row.pin_urut, alasan: row.pin_alasan, canRequest: true };
  }
  return { urut: row.pin_urut + 1, alasan: "", canRequest: true };
};

const cekPerluPengajuan = async (nomor) => {
  const [[hdr]] = await db.query(
    `SELECT inv_tanggal FROM tinv_hdr WHERE inv_nomor = ?`,
    [nomor],
  );
  if (!hdr) throw new Error("Data tidak ditemukan.");

  // Cek pelunasan dulu — sesuai Delphi
  const [[pelunasan]] = await db.query(
    `SELECT tanggal FROM piutang_kredit_detail pkd
     INNER JOIN piutang_kredit_header pkh ON pkd.nomor = pkh.nomor
     WHERE pkd.kredit <> 0 AND pkd.nota = ?
     ORDER BY tanggal DESC LIMIT 1`,
    [nomor],
  );
  if (pelunasan) {
    return { perlu: false, reason: "Sudah ada pelunasan." };
  }

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

  const zCloseManual = await tutupBukuService.getManualTutupBuku("INV");

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
     VALUES ('INV', ?, ?, ?, ?, NOW(), ?, ?)
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

// ═══════════════════════════════════════════════════════════
// UPDATE STATUS (dialog TfrmInvStatus)
// Sesuai Delphi btnUpdateClick
// ═══════════════════════════════════════════════════════════
const getStatusInfo = async (nomor) => {
  const [[row]] = await db.query(
    `SELECT inv_nomor, inv_Penerima,
            DATE_FORMAT(IFNULL(inv_Tgl_Terima, CURDATE()),'%Y-%m-%d') AS inv_Tgl_Terima,
            DATE_FORMAT(IFNULL(inv_RencanaBayar, CURDATE()),'%Y-%m-%d') AS inv_RencanaBayar
     FROM tinv_hdr WHERE inv_nomor = ?`,
    [nomor],
  );
  if (!row) throw new Error("Data tidak ditemukan.");
  return row;
};

const saveStatusUpdate = async (nomor, penerima, tglTerima, rencanaBayar) => {
  await db.query(
    `UPDATE tinv_hdr SET
       inv_Penerima = ?,
       inv_Tgl_Terima = ?,
       inv_RencanaBayar = ?
     WHERE inv_nomor = ?`,
    [penerima, tglTerima, rencanaBayar, nomor],
  );
};

// ═══════════════════════════════════════════════════════════
// VALIDASI sebelum Cetak/Ubah
// Sesuai Delphi cxButton3Click / cxButton1Click
// ═══════════════════════════════════════════════════════════
const cekBisaCetak = async (nomor) => {
  const [[row]] = await db.query(
    `SELECT
       IF(inv_sts_pro=0,'Normal', IF(inv_sts_pro=1,'Proforma','Tidak Normal')) AS Status,
       inv_apvnosj AS ApvNoSJ
     FROM tinv_hdr WHERE inv_nomor = ?`,
    [nomor],
  );
  if (!row) throw new Error("Data tidak ditemukan.");

  // if (row.Status === "Proforma") {
  //   return { bisa: false, reason: "Silahkan cetak di invoice proforma." };
  // }
  if (row.Status === "Tidak Normal") {
    return { bisa: false, reason: "Silahkan cetak di invoice tak normal." };
  }
  if (row.ApvNoSJ === "N") {
    return { bisa: false, reason: "DiApprove dulu untuk bisa cetak invoice." };
  }
  if (row.ApvNoSJ === "T") {
    return { bisa: false, reason: "Tidak DiApprove." };
  }
  return { bisa: true, reason: null };
};

// ═══════════════════════════════════════════════════════════
// VALIDASI sebelum Cetak/Ubah
// Sesuai Delphi cxButton3Click / cxButton1Click
// ═══════════════════════════════════════════════════════════
const cekBisaUbah = async (nomor) => {
  const [[row]] = await db.query(
    `SELECT
       IF(inv_sts_pro=0,'Normal', IF(inv_sts_pro=1,'Proforma','Tidak Normal')) AS Status
     FROM tinv_hdr WHERE inv_nomor = ?`,
    [nomor],
  );
  if (!row) throw new Error("Data tidak ditemukan.");

  // Blokade untuk Proforma DIHAPUS agar bisa lanjut di-edit di form Invoice Normal
  /*
  if (row.Status === "Proforma") {
    return { bisa: false, reason: "Silahkan edit di invoice proforma." };
  }
  */

  if (row.Status === "Tidak Normal") {
    return { bisa: false, reason: "Silahkan edit di invoice tak normal." };
  }

  return { bisa: true, reason: null };
};

// ═══════════════════════════════════════════════════════════
// EXPORT
// ═══════════════════════════════════════════════════════════
const getExportData = async (tglAwal, tglAkhir) => getBrowse(tglAwal, tglAkhir);
// ═══════════════════════════════════════════════════════════
// EXPORT DETAIL — flat per baris detail, TAPI ikut sertakan semua
// kolom header (sama seperti getBrowse) supaya FE bisa kelompokkan
// per Nomor dan render header cuma sekali per grup — replika Delphi
// "Browse Invoice" export (header di baris pertama grup, sisanya
// dikosongkan).
// ═══════════════════════════════════════════════════════════
const getExportDetail = async (tglAwal, tglAkhir) => {
  const [rows] = await db.query(
    `SELECT
       a.inv_nomor                                    AS Nomor,
       DATE_FORMAT(a.inv_tanggal,'%Y-%m-%d')          AS Tanggal,
       v.divisi                                        AS Divisi,
       c.cus_nama                                       AS NamaCustomer,
       a.inv_keterangan                                 AS Keterangan,
       IF(a.inv_sts_pro=0,'Normal', IF(a.inv_sts_pro=1,'Proforma','Tidak Normal')) AS Status,
       IF(a.inv_status_otomatis=1,'Otomatis','Normal') AS Otomatis,
       (
         SELECT (SUM(invd_harga*invd_jumlah) - a.inv_disc) +
           IF(a.inv_sts_ppn=1 AND a.inv_pph='',
             (a.inv_ppn/100 * (SUM(invd_harga*invd_jumlah) - a.inv_disc)),
             IF(a.inv_sts_ppn=1 AND a.inv_pph='PPh',
               (a.inv_ppn/100 * SUM(invd_harga*invd_jumlah)), 0))
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
       a.inv_Tgl_Terima                                 AS inv_Tgl_Terima,
       a.inv_Penerima                                   AS inv_Penerima,
       a.inv_RencanaBayar                               AS inv_RencanaBayar,
       a.user_create                                    AS Usr,
       a.inv_apvnosj                                    AS ApvNoSJ,
       DATE_FORMAT(a.date_create,'%d-%m-%Y %T')         AS Created,
       IFNULL((
         SELECT
           IFNULL(IF(pin_acc='' AND pin_dipakai='','WAITING',
             IF(pin_acc='Y' AND pin_dipakai='','ACC',
               IF(pin_acc='Y' AND pin_dipakai='Y','ACC - USED',
                 IF(pin_acc='N','REJECTED','')))),'')
         FROM tspk_pin5
         WHERE pin_trs = 'INV' AND pin_nomor = a.inv_nomor
         ORDER BY pin_urut DESC LIMIT 1
       ), '')                                           AS ACC_Edit,
       (
         SELECT pin_alasan FROM tspk_pin5
         WHERE pin_trs = 'INV' AND pin_nomor = a.inv_nomor
         ORDER BY pin_urut DESC LIMIT 1
       )                                                AS Alasan,
       d.invd_spk_nomor     AS Kode,
       b.brg_name           AS Nama,
       d.invd_ukuran        AS Ukuran,
       d.invd_jumlah        AS Jumlah,
       d.invd_harga         AS Harga,
       s.spk_hargariil      AS HargaRiil,
       s.spk_hargaFEE       AS Fee
     FROM tinv_dtl d
     INNER JOIN tinv_hdr a ON a.inv_nomor = d.invd_inv_nomor
     LEFT JOIN tcustomer c ON a.inv_cus_kode = c.cus_kode
     LEFT JOIN tdivisi v ON v.kode = a.inv_divisi
     INNER JOIN tbarang b ON b.brg_kode = d.invd_spk_nomor
     LEFT JOIN tspk s ON s.spk_nomor = d.invd_spk_nomor
     WHERE a.inv_tanggal >= ? AND a.inv_tanggal <= ?
     ORDER BY a.inv_nomor`,
    [tglAwal, tglAkhir],
  );
  return rows;
};

module.exports = {
  getBrowse,
  getBrowseDetail,
  cekBisaHapus,
  deleteData,
  getPengajuanStatus,
  cekPerluPengajuan,
  pengajuanUbah,
  getStatusInfo,
  saveStatusUpdate,
  cekBisaCetak,
  cekBisaUbah,
  getExportData,
  getExportDetail,
};
