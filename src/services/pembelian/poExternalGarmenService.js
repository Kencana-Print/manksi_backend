const db = require("../../config/database");
const tutupBukuService = require("../tutupBukuService");

const PIN_TRS = "PO EXTERNAL";
const CAB_LIST = ["P01", "P04"];

// ─────────────────────────────────────────────
// HELPER: cek status tutup buku untuk satu tanggal transaksi.
// Pakai helper tutupBukuService.getTanggalTutupBukuUntukTanggal yang
// sudah ada (persis replikasi logic zDay/zMonth/zYear Delphi), supaya
// tidak menduplikasi perhitungan boundary di sini.
// ─────────────────────────────────────────────
const isTutupBuku = async (tanggal) => {
  const tgl = new Date(tanggal);
  tgl.setHours(0, 0, 0, 0);
  const zCloseManual = await tutupBukuService.getManualTutupBuku(PIN_TRS);
  if (zCloseManual) {
    zCloseManual.setHours(0, 0, 0, 0);
    return tgl < zCloseManual;
  }
  const boundary = await tutupBukuService.getTanggalTutupBukuUntukTanggal(tgl);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return boundary < today;
};

// ─────────────────────────────────────────────
// BROWSE — replikasi persis btnRefreshClick Delphi (SQLMaster).
// ─────────────────────────────────────────────
const getBrowse = async (filters) => {
  const { startDate, endDate, canLihatHarga } = filters;
  const hargaCols = canLihatHarga
    ? `x.Nominal, x.DP, x.Voucher, (x.Nominal - (x.DP + x.Voucher)) AS BelumBayar,`
    : "";
  const query = `
    SELECT
      x.Nomor, x.Tanggal, x.DatelinePO, x.Cab, x.SPK, x.NamaSPK,
      x.KdSup, x.Supplier,
      ${hargaCols}
      x.Sts AS Status,
      IFNULL((
        SELECT
          IFNULL(IF(pin_acc = "" AND pin_dipakai = "", "WAIT",
            IF(pin_acc = "Y" AND pin_dipakai = "", "ACC",
            IF(pin_acc = "Y" AND pin_dipakai = "Y", "",
            IF(pin_acc = "N", "TOLAK", "")))), "")
        FROM tspk_pin5
        WHERE pin_trs = ? AND pin_nomor = x.Nomor
        ORDER BY pin_urut DESC LIMIT 1
      ), "") AS Ngedit,
      x.Usr, x.Created
    FROM (
      SELECT
        h.poe_nomor AS Nomor, h.poe_tanggal AS Tanggal,
        h.poe_dateline AS DatelinePO, h.poe_cab AS Cab,
        h.poe_spk_nomor AS SPK,
        IFNULL(s.spk_nama, m.mspk_nama) AS NamaSPK,
        h.poe_sup AS KdSup, u.sup_nama AS Supplier,
        h.poe_total AS Nominal,
        IFNULL((
          SELECT SUM(c.poed2_nominal) FROM tpoexternal_dtl2 c
          WHERE c.poed2_nomor = h.poe_nomor
        ), 0) AS DP,
        IFNULL((
          SELECT SUM(v.voud_total) FROM tvoucher_dtl v
          WHERE v.voud_nota = h.poe_nomor
        ), 0) AS Voucher,
        h.poe_status AS Sts, h.user_create AS Usr, h.date_create AS Created
      FROM tpoexternal_hdr h
      LEFT JOIN tspk s ON s.spk_nomor = h.poe_spk_nomor
      LEFT JOIN tmemospk m ON m.mspk_nomor = h.poe_spk_nomor
      LEFT JOIN tsupplier u ON u.sup_kode = h.poe_sup
      WHERE h.poe_tanggal >= ?
        -- [FIX] endDate pakai < DATE_ADD(?, INTERVAL 1 DAY), bukan
        -- <=, supaya baris dengan poe_tanggal berupa DATETIME di
        -- tanggal akhir tetap ikut (menghindari cutoff jam 00:00:00)
        AND h.poe_tanggal < DATE_ADD(?, INTERVAL 1 DAY)
        AND h.poe_cab IN (${CAB_LIST.map(() => "?").join(",")})
      ORDER BY h.poe_nomor
    ) x
  `;
  const [rows] = await db.query(query, [
    PIN_TRS,
    startDate,
    endDate,
    ...CAB_LIST,
  ]);
  return rows;
};

// ─────────────────────────────────────────────
// DETAIL (expand per baris) — per nomor, efisien (fetch on-demand),
// beda dari Delphi yang load SELURUH detail 1 periode sekaligus di
// SQLDetail. Hasil akhirnya identik per baris, cuma caranya lebih
// hemat untuk web (fetch saat expand, bukan semua di awal).
// ─────────────────────────────────────────────
const getDetail = async (nomor, canLihatHarga) => {
  const hargaCols = canLihatHarga ? `x.Tarif, x.Total,` : "";
  const query = `
    SELECT x.Nomor, x.Size, x.Jumlah, x.Terima, (x.Jumlah - x.Terima) AS Kurang,
      ${hargaCols}
      1 AS _dummy
    FROM (
      SELECT
        d.poed_nomor AS Nomor, d.poed_size AS Size, d.poed_jumlah AS Jumlah,
        d.poed_tarif AS Tarif, (d.poed_jumlah * d.poed_tarif) AS Total,
        IFNULL((
          SELECT SUM(dd.bped_jumlah)
          FROM tbpbpoexternal_hdr hh
          LEFT JOIN tbpbpoexternal_dtl dd ON dd.bped_nomor = hh.bpe_nomor
          WHERE hh.bpe_po = d.poed_nomor AND dd.bped_size = d.poed_size
        ), 0) AS Terima
      FROM tpoexternal_dtl d
      WHERE d.poed_nomor = ?
      ORDER BY d.poed_nourut
    ) x
  `;
  const [rows] = await db.query(query, [nomor]);
  // buang kolom dummy pembantu (dipakai supaya trailing comma aman
  // saat hargaCols kosong)
  return rows.map(({ _dummy, ...r }) => r);
};

// ─────────────────────────────────────────────
// EXPORT HEADER — sama persis getBrowse (semua baris sesuai filter)
// ─────────────────────────────────────────────
const getExportHeader = async (filters) => getBrowse(filters);

// ─────────────────────────────────────────────
// EXPORT DETAIL — flat, seluruh detail dalam periode filter,
// replikasi persis SQLDetail Delphi (bukan per-nomor seperti getDetail)
// ─────────────────────────────────────────────
const getExportDetail = async (filters) => {
  const { startDate, endDate, canLihatHarga } = filters;
  const hargaCols = canLihatHarga ? `x.Tarif, x.Total,` : "";
  const query = `
    SELECT x.Nomor, x.Size, x.Jumlah, x.Terima, (x.Jumlah - x.Terima) AS Kurang,
      ${hargaCols}
      1 AS _dummy
    FROM (
      SELECT
        d.poed_nomor AS Nomor, d.poed_size AS Size, d.poed_jumlah AS Jumlah,
        d.poed_tarif AS Tarif, (d.poed_jumlah * d.poed_tarif) AS Total,
        IFNULL((
          SELECT SUM(dd.bped_jumlah)
          FROM tbpbpoexternal_hdr hh
          LEFT JOIN tbpbpoexternal_dtl dd ON dd.bped_nomor = hh.bpe_nomor
          WHERE hh.bpe_po = d.poed_nomor AND dd.bped_size = d.poed_size
        ), 0) AS Terima
      FROM tpoexternal_hdr h
      INNER JOIN tpoexternal_dtl d ON d.poed_nomor = h.poe_nomor
      WHERE h.poe_tanggal >= ?
        AND h.poe_tanggal < DATE_ADD(?, INTERVAL 1 DAY)
        AND h.poe_cab IN (${CAB_LIST.map(() => "?").join(",")})
      ORDER BY d.poed_nomor, d.poed_nourut
    ) x
  `;
  const [rows] = await db.query(query, [startDate, endDate, ...CAB_LIST]);
  return rows.map(({ _dummy, ...r }) => r);
};

// ─────────────────────────────────────────────
// DELETE — replikasi persis cxButton4Click Delphi, dengan urutan
// validasi yang sama:
//   1. Cek data ada
//   2. Cek cabang user (kalau user punya cabang spesifik, HO
//      bebas — sama seperti Delphi `if frmmenu.cab<>''`)
//   3. Cek tutup buku
//   4. Status harus OPEN
//   5. Voucher harus 0
// [FIX] Delphi HANYA hapus tpoexternal_hdr, TIDAK PERNAH hapus
// tpoexternal_dtl/dtl2 — berpotensi meninggalkan baris detail
// yatim (orphan). Diperbaiki di sini: hapus detail dulu baru
// header, dalam satu transaksi.
// ─────────────────────────────────────────────
const remove = async (nomor, userKode, userCabang) => {
  const [[header]] = await db.query(
    `SELECT h.poe_tanggal, h.poe_cab, h.poe_status,
       IFNULL((SELECT SUM(v.voud_total) FROM tvoucher_dtl v WHERE v.voud_nota = h.poe_nomor), 0) AS voucher
     FROM tpoexternal_hdr h WHERE h.poe_nomor = ?`,
    [nomor],
  );
  if (!header) throw new Error("Data PO External tidak ditemukan.");
  if (userCabang && userCabang !== header.poe_cab) {
    throw new Error("Data tsb bukan cabang anda.");
  }
  if (await isTutupBuku(header.poe_tanggal)) {
    throw new Error("Transaksi tsb sudah close.\nTidak bisa dihapus.");
  }
  if (header.poe_status !== "OPEN") {
    throw new Error("PO tsb sudah di proses/close.\nTidak bisa di hapus.");
  }
  if (Number(header.voucher) !== 0) {
    throw new Error(
      "PO tsb sudah ada dibuatkan Voucher pembayaran.\nTidak bisa di hapus.",
    );
  }
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(`DELETE FROM tpoexternal_dtl2 WHERE poed2_nomor = ?`, [
      nomor,
    ]);
    await conn.query(`DELETE FROM tpoexternal_dtl WHERE poed_nomor = ?`, [
      nomor,
    ]);
    await conn.query(`DELETE FROM tpoexternal_hdr WHERE poe_nomor = ?`, [
      nomor,
    ]);
    await conn.commit();
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
};

// ─────────────────────────────────────────────
// PENGAJUAN PERUBAHAN DATA — cek dulu apakah memang perlu (tutup
// buku), kalau perlu, ambil urut & alasan sesuai kondisi (baris
// pending existing / baru), replikasi persis
// PengajuanPerubahanData1Click Delphi.
// ─────────────────────────────────────────────
const getPengajuanInfo = async (nomor) => {
  const [[header]] = await db.query(
    `SELECT poe_tanggal FROM tpoexternal_hdr WHERE poe_nomor = ?`,
    [nomor],
  );
  if (!header) throw new Error("Data PO External tidak ditemukan.");
  const closed = await isTutupBuku(header.poe_tanggal);
  if (!closed) {
    return { perluPengajuan: false };
  }
  const [pinRows] = await db.query(
    `SELECT pin_urut, pin_dipakai, pin_alasan FROM tspk_pin5
     WHERE pin_trs = ? AND pin_nomor = ? ORDER BY pin_urut DESC LIMIT 1`,
    [PIN_TRS, nomor],
  );
  let urut = 1;
  let alasan = "";
  if (pinRows.length > 0) {
    if (pinRows[0].pin_dipakai === "") {
      urut = pinRows[0].pin_urut;
      alasan = pinRows[0].pin_alasan || "";
    } else {
      urut = pinRows[0].pin_urut + 1;
    }
  }
  return { perluPengajuan: true, urut, alasan };
};

// ─────────────────────────────────────────────
// AJUKAN PERUBAHAN — insert/update tspk_pin5, replikasi persis
// btnAjukkanClick Delphi. Catatan: pin_ket diisi dengan NOMOR SPK
// (bukan keterangan bebas) — sesuai Delphi apa adanya, meski
// namanya "keterangan".
// ─────────────────────────────────────────────
const ajukanPerubahan = async (nomor, urut, alasan, userKode) => {
  const [[header]] = await db.query(
    `SELECT poe_tanggal, poe_spk_nomor FROM tpoexternal_hdr WHERE poe_nomor = ?`,
    [nomor],
  );
  if (!header) throw new Error("Data PO External tidak ditemukan.");
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(
      `INSERT INTO tspk_pin5
         (pin_trs, pin_nomor, pin_urut, pin_tgl_trs, pin_ket, pin_tgl_minta, pin_user_minta, pin_alasan)
       VALUES (?, ?, ?, ?, ?, NOW(), ?, ?)
       ON DUPLICATE KEY UPDATE
         pin_tgl_trs = ?, pin_ket = ?, pin_acc = "", pin_tgl_minta = NOW(),
         pin_user_minta = ?, pin_alasan = ?`,
      [
        PIN_TRS,
        nomor,
        urut,
        header.poe_tanggal,
        header.poe_spk_nomor,
        userKode,
        alasan,
        header.poe_tanggal,
        header.poe_spk_nomor,
        userKode,
        alasan,
      ],
    );
    await conn.commit();
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
};

// ─────────────────────────────────────────────
// STATUS PENGAJUAN — replikasi persis cekClose Delphi.
// Dipakai Form service utk badge (StatusEdit) + guard simpan.
// Beda dgn getPengajuanInfo (yg cuma return boolean perluPengajuan):
// ini return label WAIT/ACC/TOLAK/MINTA persis spt yg ditampilkan
// user (imgtglwait/imgtglacc/imgtgltolak/imgtglminta).
// ─────────────────────────────────────────────
const getStatusPengajuan = async (nomor, tanggal) => {
  if (!(await isTutupBuku(tanggal))) return { status: "", urut: 0 };
  const [pinRows] = await db.query(
    `SELECT pin_urut, pin_acc, pin_dipakai FROM tspk_pin5
     WHERE pin_trs = ? AND pin_nomor = ? ORDER BY pin_urut DESC LIMIT 1`,
    [PIN_TRS, nomor],
  );
  if (pinRows.length === 0) return { status: "MINTA", urut: 0 };
  const { pin_urut, pin_acc, pin_dipakai } = pinRows[0];
  if (pin_acc === "" && pin_dipakai === "")
    return { status: "WAIT", urut: pin_urut };
  if (pin_acc === "Y" && pin_dipakai === "")
    return { status: "ACC", urut: pin_urut };
  if (pin_acc === "N") return { status: "TOLAK", urut: pin_urut };
  // pin_acc='Y' & pin_dipakai='Y' (sudah terpakai) → balik ke MINTA
  // (replika persis else branch terakhir cekClose Delphi)
  return { status: "MINTA", urut: pin_urut };
};

module.exports = {
  getBrowse,
  getDetail,
  getExportHeader,
  getExportDetail,
  remove,
  getPengajuanInfo,
  ajukanPerubahan,
  isTutupBuku,
  getStatusPengajuan,
};
