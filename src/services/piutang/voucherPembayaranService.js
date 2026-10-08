const db = require("../../config/database");
const tutupBukuService = require("../tutupBukuService");

// ── Browse Master ─────────────────────────────────────────────────────
// Delphi btnRefreshClick SQLMaster
// ORDER BY MID(vou_nomor,5,5) → urutan nomor sekuensial
// Ngedit dari tspk_pin5: WAIT/ACC/TOLAK/""
// Bahan_tambahan: subquery tvoucher_dtl2 SUM(harga*jumlah)
// Net = Total - Bahan_tambahan
// Nomor Realisasi dari finance.tpengajuan_transfer_dtl (link ptd_trs)
const getBrowse = async (startDate, endDate) => {
  const [rows] = await db.query(
    `SELECT
       a.vou_nomor                                         AS Nomor,
       DATE_FORMAT(a.vou_tanggal, '%Y-%m-%d')             AS Tanggal,
       a.vou_sup_kode                                     AS KodeSupplier,
       IFNULL(b.sup_nama, '')                             AS Supplier,
       IFNULL(a.vou_nomor_pajak, '')                      AS NomorPajak,
       a.vou_total                                        AS Total,
       IFNULL((
         SELECT SUM(IF(d2.voud2_tambah = 1, -1, 1) * d2.voud2_harga * d2.voud2_jumlah)
         FROM tvoucher_dtl2 d2
         WHERE d2.voud2_vou_nomor = a.vou_nomor
       ), 0)                                              AS BahanTambahan,
       a.vou_total - IFNULL((
         SELECT SUM(IF(d2.voud2_tambah = 1, -1, 1) * d2.voud2_harga * d2.voud2_jumlah)
         FROM tvoucher_dtl2 d2
         WHERE d2.voud2_vou_nomor = a.vou_nomor
       ), 0)                                              AS Net,
       IFNULL(a.vou_disc, 0)                             AS Disc,
       IFNULL(a.vou_status_realisasi, '')                AS Status,
       IFNULL(pt.ptd_nomor, '')                          AS NomorRealisasi,
       DATE_FORMAT(pt.ptd_realisasi, '%Y-%m-%d')         AS TanggalRealisasi,
       IFNULL(pt.ptd_akun, '')                           AS AccountBayar,
       IFNULL(rek.rek_nama, '')                          AS NamaAccount,
       IFNULL(cc.cc_nama, '')                            AS CcNama,
       IFNULL(pt.ptd_dc_nama, '')                        AS DcNama,
       IFNULL((
         SELECT
           IFNULL(IF(p.pin_acc = '' AND p.pin_dipakai = '', 'WAIT',
             IF(p.pin_acc = 'Y' AND p.pin_dipakai = '', 'ACC',
               IF(p.pin_acc = 'Y' AND p.pin_dipakai = 'Y', '',
                 IF(p.pin_acc = 'N', 'TOLAK', '')))), '')
         FROM tspk_pin5 p
         WHERE p.pin_trs = 'VOUCHER HUTANG'
           AND p.pin_nomor = a.vou_nomor
         ORDER BY p.pin_urut DESC
         LIMIT 1
       ), '')                                             AS Ngedit,
       IFNULL(a.user_create, '')                         AS Usr,
       DATE_FORMAT(a.date_create, '%Y-%m-%d %H:%i:%s')   AS Created
     FROM tvoucher_hdr a
     LEFT JOIN tsupplier b
            ON b.sup_kode = a.vou_sup_kode
     LEFT JOIN finance.tpengajuan_transfer_dtl pt
            ON pt.ptd_trs = a.vou_nomor
     LEFT JOIN finance.trekening rek
            ON rek.rek_kode = pt.ptd_akun
     LEFT JOIN finance.tcostcenter cc
            ON cc.cc_kode = pt.ptd_cc_kode
     WHERE a.vou_tanggal >= ? AND a.vou_tanggal <= ?
     ORDER BY MID(a.vou_nomor, 5, 5)`,
    [startDate, endDate],
  );
  return rows;
};

// ── Browse Detail ─────────────────────────────────────────────────────
// Delphi SQLDetail:
// tvoucher_dtl JOIN tvoucher_hdr JOIN tbpj_hdr
// LEFT JOIN tpojasa_hdr ON pojh_nomor=bpj_po_nomor
// LEFT JOIN tspk ON spk_nomor=pojh_spk_nomor
const getBrowseDetail = async (startDate, endDate) => {
  const [rows] = await db.query(
    `SELECT
       d.voud_vou_nomor                                   AS Nomor,
       IFNULL(d.voud_nota, '')                           AS Nota,
       IFNULL(p.pojh_nomor, '')                          AS NomorPO,
       DATE_FORMAT(d.voud_tgl_nota, '%Y-%m-%d')          AS Tanggal,
       IFNULL(d.voud_type, '')                           AS Type,
       IFNULL(d.voud_total, 0)                           AS Total,
       IFNULL(s.spk_nomor, '')                           AS SpkNomor,
       IFNULL(s.spk_nama, '')                            AS SpkNama,
       IFNULL(bpj.bpj_jumlah, 0)                        AS Jumlah,
       IFNULL(d.voud_bs, 0)                              AS Bs,
       IFNULL(d.voud_tarifbs, 0)                         AS TarifBS
     FROM tvoucher_dtl d
     INNER JOIN tvoucher_hdr h
             ON h.vou_nomor = d.voud_vou_nomor
     LEFT JOIN tbpj_hdr bpj
            ON bpj.bpj_nomor = d.voud_nota
     LEFT JOIN tpojasa_hdr p
            ON p.pojh_nomor = bpj.bpj_po_nomor
     LEFT JOIN tspk s
            ON s.spk_nomor = p.pojh_spk_nomor
     WHERE h.vou_tanggal >= ? AND h.vou_tanggal <= ?
     ORDER BY d.voud_vou_nomor`,
    [startDate, endDate],
  );
  return rows;
};

// ── Delete ────────────────────────────────────────────────────────────
// Delphi cxButton4Click:
// Cek tutup periode: ambil tanggal dari vou_tanggal
// DELETE tvoucher_hdr WHERE vou_nomor=? (cascade ke dtl via FK atau trigger)
const deleteData = async (nomor) => {
  // Ambil header dulu
  const [[hdr]] = await db.query(
    `SELECT vou_nomor, vou_tanggal
     FROM tvoucher_hdr
     WHERE vou_nomor = ?`,
    [nomor],
  );
  if (!hdr) throw new Error("Data tidak ditemukan.");

  // Cek tutup buku — pola sama dengan modul-modul jurnal sebelumnya:
  // getTanggalTutupBukuUntukTanggal dibanding hari ini, manual override
  // (pengaturan.tclose, cid="VOU") menang kalau ada.
  const tgl = new Date(hdr.vou_tanggal);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const limitDate = await tutupBukuService.getTanggalTutupBukuUntukTanggal(
    hdr.vou_tanggal,
  );
  limitDate.setHours(0, 0, 0, 0);

  const zCloseManual = await tutupBukuService.getManualTutupBuku("VOU");

  let isTutupBuku = false;
  if (zCloseManual) {
    zCloseManual.setHours(0, 0, 0, 0);
    if (tgl < zCloseManual) isTutupBuku = true;
  } else {
    if (limitDate < today) isTutupBuku = true;
  }

  if (isTutupBuku)
    throw new Error("Transaksi tsb sudah close. Tidak bisa dihapus.");

  const conn = await db.getConnection();
  await conn.beginTransaction();
  try {
    // Hapus detail dulu (jika tidak ada CASCADE FK)
    await conn.query(
      `DELETE FROM tvoucher_dtl
       WHERE voud_vou_nomor = ?`,
      [nomor],
    );
    await conn.query(
      `DELETE FROM tvoucher_dtl2
       WHERE voud2_vou_nomor = ?`,
      [nomor],
    );
    // Hapus header
    const [result] = await conn.query(
      `DELETE FROM tvoucher_hdr
       WHERE vou_nomor = ?`,
      [nomor],
    );
    if (result.affectedRows === 0) throw new Error("Data tidak ditemukan.");

    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
};

// ── Cek apakah perlu pengajuan (periode sudah tutup) ─────────────────
// Delphi PengajuanPerubahanData1Click:
// Cek tutup periode; jika sudah tutup → boleh ajukan, jika belum → "Tidak perlu pengajuan"
const cekPengajuan = async (nomor) => {
  const [[hdr]] = await db.query(
    `SELECT vou_nomor, vou_tanggal,
            DATE_FORMAT(vou_tanggal, '%Y-%m-%d') AS Tanggal
     FROM tvoucher_hdr
     WHERE vou_nomor = ?`,
    [nomor],
  );
  if (!hdr) throw new Error("Data tidak ditemukan.");

  const tgl = new Date(hdr.vou_tanggal);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const limitDate = await tutupBukuService.getTanggalTutupBukuUntukTanggal(
    hdr.vou_tanggal,
  );
  limitDate.setHours(0, 0, 0, 0);

  const zCloseManual = await tutupBukuService.getManualTutupBuku("VOU");

  let tutup = false;
  if (zCloseManual) {
    zCloseManual.setHours(0, 0, 0, 0);
    if (tgl < zCloseManual) tutup = true;
  } else {
    if (limitDate < today) tutup = true;
  }

  if (!tutup) {
    return { perlu: false, message: "Tidak perlu pengajuan perubahan data." };
  }

  // Cek existing pin5 — ambil urut terakhir
  // Delphi: jika pin_dipakai="" → pakai urut sama (update), else urut+1
  const [[lastPin]] = await db.query(
    `SELECT pin_urut, pin_dipakai, pin_alasan
     FROM tspk_pin5
     WHERE pin_trs = 'VOUCHER HUTANG' AND pin_nomor = ?
     ORDER BY pin_urut DESC LIMIT 1`,
    [nomor],
  );

  let urut = 1;
  let alasanLama = "";
  if (lastPin) {
    if (lastPin.pin_dipakai === "") {
      // Masih pending — pakai urut sama, isi alasan lama
      urut = lastPin.pin_urut;
      alasanLama = lastPin.pin_alasan || "";
    } else {
      // Sudah dipakai → urut baru
      urut = lastPin.pin_urut + 1;
    }
  }

  return { perlu: true, urut, alasanLama };
};

// ── Submit pengajuan perubahan data ───────────────────────────────────
// Delphi btnAjukkanClick:
// INSERT tspk_pin5 ON DUPLICATE KEY UPDATE pin_acc=""
// pin_trs = "VOUCHER HUTANG", pin_ket = Supplier
const requestPin5 = async (nomor, alasan, userKode) => {
  // Ambil data voucher untuk pin_tgl_trs dan pin_ket (Supplier)
  const [[hdr]] = await db.query(
    `SELECT h.vou_tanggal, IFNULL(s.sup_nama, '') AS Supplier
     FROM tvoucher_hdr h
     LEFT JOIN tsupplier s ON s.sup_kode = h.vou_sup_kode
     WHERE h.vou_nomor = ?`,
    [nomor],
  );
  if (!hdr) throw new Error("Data tidak ditemukan.");

  // Tentukan urut
  const [[lastPin]] = await db.query(
    `SELECT pin_urut, pin_dipakai
     FROM tspk_pin5
     WHERE pin_trs = 'VOUCHER HUTANG' AND pin_nomor = ?
     ORDER BY pin_urut DESC LIMIT 1`,
    [nomor],
  );

  let urut = 1;
  if (lastPin) {
    urut = lastPin.pin_dipakai === "" ? lastPin.pin_urut : lastPin.pin_urut + 1;
  }

  await db.query(
    `INSERT INTO tspk_pin5
       (pin_trs, pin_nomor, pin_urut, pin_tgl_trs, pin_ket,
        pin_tgl_minta, pin_user_minta, pin_alasan)
     VALUES ('VOUCHER HUTANG', ?, ?, ?, ?, NOW(), ?, ?)
     ON DUPLICATE KEY UPDATE
       pin_tgl_trs   = VALUES(pin_tgl_trs),
       pin_ket       = VALUES(pin_ket),
       pin_acc       = '',
       pin_tgl_minta = NOW(),
       pin_user_minta = VALUES(pin_user_minta),
       pin_alasan    = VALUES(pin_alasan)`,
    [nomor, urut, hdr.vou_tanggal, hdr.Supplier, userKode, alasan],
  );
};

// ── Print data ────────────────────────────────────────────────────────
// Delphi doslip: tvoucher_hdr + tvoucher_dtl + tsupplier + tbpj + tpojasa
const getPrintData = async (nomor) => {
  const [rows] = await db.query(
    `SELECT
       h.vou_nomor, DATE_FORMAT(h.vou_tanggal,'%d/%m/%Y') AS vou_tanggal,
       h.vou_nomor_pajak, h.vou_total, h.vou_disc,
       h.vou_keterangan, h.user_create,
       DATE_FORMAT(h.date_create,'%d/%m/%Y %H:%i:%s') AS date_create,
       d.voud_nota, d.voud_type,
       DATE_FORMAT(d.voud_tgl_nota,'%d/%m/%Y') AS voud_tgl_nota,
       d.voud_total, d.voud_bs, d.voud_tarifbs,
       (d.voud_bs * d.voud_tarifbs)                  AS nilai_bs,
       (d.voud_total - (d.voud_bs * d.voud_tarifbs)) AS total_baris,
       IFNULL(s.sup_nama, '')                         AS sup_nama,
       IFNULL(s.sup_rekening, '')                     AS sup_rekening,
       IFNULL(s.sup_bank, '')                         AS sup_bank,
       IFNULL(s.sup_cabang, '')                       AS sup_cabang,
       IFNULL(s.sup_atasnama, '')                     AS sup_atasnama,
       IFNULL(e.pojh_keterangan, '')                  AS pojh_keterangan,
       IFNULL((
         SELECT bpj_po_nomor FROM tbpj_hdr
         WHERE bpj_nomor = d.voud_nota
       ), '')                                         AS nomor_po,
       IFNULL((
         SELECT SUM(IF(voud2_tambah = 1, -1, 1) * voud2_harga * voud2_jumlah)
         FROM tvoucher_dtl2
         WHERE voud2_vou_nomor = h.vou_nomor
       ), 0)                                          AS bahan_tambahan
     FROM tvoucher_hdr h
     INNER JOIN tvoucher_dtl d ON d.voud_vou_nomor = h.vou_nomor
     LEFT JOIN tsupplier s ON s.sup_kode = h.vou_sup_kode
     LEFT JOIN tbpj_hdr bpj ON bpj.bpj_nomor = d.voud_nota
     LEFT JOIN tpojasa_hdr e ON e.pojh_nomor = bpj.bpj_po_nomor
     WHERE h.vou_nomor = ?`,
    [nomor],
  );
  if (!rows.length) throw new Error("Data tidak ditemukan.");

  const [bahan] = await db.query(
    `SELECT voud2_nama AS nama, voud2_satuan AS satuan,
            voud2_jumlah AS jumlah, voud2_harga AS harga,
            voud2_tambah AS tambah
     FROM tvoucher_dtl2
     WHERE voud2_vou_nomor = ?`,
    [nomor],
  );
  // Bentuk respons tetap berupa array baris, jadi controller tidak berubah.
  // Daftar bahan dilampirkan di setiap baris dan dibaca dari baris pertama.
  const bahanList = bahan.map((b) => ({
    nama: b.nama,
    satuan: b.satuan,
    jumlah: Number(b.jumlah),
    harga: Number(b.harga),
    nilai: Number(b.jumlah) * Number(b.harga),
    tambah: Number(b.tambah) === 1,
  }));
  return rows.map((r) => ({ ...r, bahan: bahanList }));
};

// Khusus filter pending dari dashboard — semua periode, belum ada PT
const getBrowsePendingAll = async () => {
  const [rows] = await db.query(
    `SELECT
       a.vou_nomor                                         AS Nomor,
       DATE_FORMAT(a.vou_tanggal, '%Y-%m-%d')             AS Tanggal,
       a.vou_sup_kode                                     AS KodeSupplier,
       IFNULL(b.sup_nama, '')                             AS Supplier,
       IFNULL(a.vou_nomor_pajak, '')                      AS NomorPajak,
       a.vou_total                                        AS Total,
       IFNULL((
         SELECT SUM(d2.voud2_harga * d2.voud2_jumlah)
         FROM tvoucher_dtl2 d2
         WHERE d2.voud2_vou_nomor = a.vou_nomor
       ), 0)                                              AS BahanTambahan,
       a.vou_total - IFNULL((
         SELECT SUM(d2.voud2_harga * d2.voud2_jumlah)
         FROM tvoucher_dtl2 d2
         WHERE d2.voud2_vou_nomor = a.vou_nomor
       ), 0)                                              AS Net,
       IFNULL(a.vou_disc, 0)                             AS Disc,
       IFNULL(a.vou_status_realisasi, '')                AS Status,
       ''                                                 AS NomorRealisasi,
       NULL                                               AS TanggalRealisasi,
       ''                                                 AS AccountBayar,
       ''                                                 AS NamaAccount,
       ''                                                 AS CcNama,
       ''                                                 AS DcNama,
       IFNULL((
         SELECT
           IFNULL(IF(p.pin_acc = '' AND p.pin_dipakai = '', 'WAIT',
             IF(p.pin_acc = 'Y' AND p.pin_dipakai = '', 'ACC',
               IF(p.pin_acc = 'Y' AND p.pin_dipakai = 'Y', '',
                 IF(p.pin_acc = 'N', 'TOLAK', '')))), '')
         FROM tspk_pin5 p
         WHERE p.pin_trs = 'VOUCHER HUTANG'
           AND p.pin_nomor = a.vou_nomor
         ORDER BY p.pin_urut DESC
         LIMIT 1
       ), '')                                             AS Ngedit,
       IFNULL(a.user_create, '')                         AS Usr,
       DATE_FORMAT(a.date_create, '%Y-%m-%d %H:%i:%s')   AS Created
     FROM tvoucher_hdr a
     LEFT JOIN tsupplier b
            ON b.sup_kode = a.vou_sup_kode
     WHERE NOT EXISTS (
       SELECT 1 FROM finance.tpengajuan_transfer_dtl pt
       WHERE pt.ptd_trs = a.vou_nomor
     )
     ORDER BY a.vou_tanggal`,
  );
  return rows;
};

const getBrowseDetailPendingAll = async () => {
  const [rows] = await db.query(
    `SELECT
       d.voud_vou_nomor                                   AS Nomor,
       IFNULL(d.voud_nota, '')                           AS Nota,
       IFNULL(p.pojh_nomor, '')                          AS NomorPO,
       DATE_FORMAT(d.voud_tgl_nota, '%Y-%m-%d')          AS Tanggal,
       IFNULL(d.voud_type, '')                           AS Type,
       IFNULL(d.voud_total, 0)                           AS Total,
       IFNULL(s.spk_nomor, '')                           AS SpkNomor,
       IFNULL(s.spk_nama, '')                            AS SpkNama,
       IFNULL(bpj.bpj_jumlah, 0)                        AS Jumlah,
       IFNULL(d.voud_bs, 0)                              AS Bs,
       IFNULL(d.voud_tarifbs, 0)                         AS TarifBS
     FROM tvoucher_dtl d
     INNER JOIN tvoucher_hdr h
             ON h.vou_nomor = d.voud_vou_nomor
     LEFT JOIN tbpj_hdr bpj
            ON bpj.bpj_nomor = d.voud_nota
     LEFT JOIN tpojasa_hdr p
            ON p.pojh_nomor = bpj.bpj_po_nomor
     LEFT JOIN tspk s
            ON s.spk_nomor = p.pojh_spk_nomor
     WHERE NOT EXISTS (
       SELECT 1 FROM finance.tpengajuan_transfer_dtl pt
       WHERE pt.ptd_trs = h.vou_nomor
     )
     ORDER BY d.voud_vou_nomor`,
  );
  return rows;
};

module.exports = {
  getBrowse,
  getBrowseDetail,
  deleteData,
  cekPengajuan,
  requestPin5,
  getPrintData,
  getBrowsePendingAll,
  getBrowseDetailPendingAll,
};
