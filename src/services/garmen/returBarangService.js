const db = require("../../config/database");
const tutupBukuService = require("../tutupBukuService");

// ⚠️ Sesuai koreksi user: hanya ACCESORIES yang butuh approval gudang.
// Source Delphi (ufrmBrowReturGarmen.pas) mengecek (rbAcc OR rbObat) di banyak
// tempat (kolom approve, block edit/hapus jika sudah approve) — ini bug lama,
// TIDAK direplikasi di web. OBAT diperlakukan sama seperti SPAREPART/ATK/RTK
// (tanpa approval, langsung masuk ke tgarmenretur_hdr dengan ret_log='').
const JENIS_BUTUH_APPROVAL = ["ACCESORIES", "OBAT"];
const MODUL_TUTUP_BUKU = "RETUR GARMEN";

const VALID_JENIS = ["ACCESORIES", "OBAT", "SPAREPART", "ATK/RTK"];

/**
 * Mengambil Data Browse (Master dan Detail Retur Barang)
 * Union tgarmenreturlog_hdr (draft/pengajuan) dan tgarmenretur_hdr (final/direct)
 */
const getBrowseData = async (startDate, endDate, cabang, jenis, user) => {
  if (!VALID_JENIS.includes(jenis)) {
    throw new Error("Jenis tidak valid.");
  }

  let filterCabang = "";
  const paramsCabang = [];
  if (cabang && cabang !== "ALL") {
    filterCabang = "AND h.ret_cab = ?";
    paramsCabang.push(cabang);
  }

  // Pola Delphi: SPAREPART untuk bagian TEKNISI/IT wajib difilter ke bagian sendiri
  let filterBagian = "";
  const paramsBagian = [];
  if (jenis === "SPAREPART" && ["TEKNISI", "IT"].includes(user.bagian)) {
    filterBagian = "AND h.ret_bagian = ?";
    paramsBagian.push(user.bagian);
  }

  // Kolom "Dari": ACCESORIES/OBAT ambil dari gudang produksi (strip 3 char depan
  // kode), selain itu dari nama pabrik. Sesuai logic asli Delphi.
  const dariExpr =
    jenis === "ACCESORIES" || jenis === "OBAT"
      ? `IF(h.ret_cab <> 'P03', SUBSTRING(p.gdgp_nama, 4), q.pab_nama)`
      : `q.pab_nama`;

  const pin5Expr = `
    IFNULL((
      SELECT IFNULL(IF(pin_acc="" AND pin_dipakai="","WAIT",
             IF(pin_acc="Y" AND pin_dipakai="","ACC",
             IF(pin_acc="Y" AND pin_dipakai="Y","",
             IF(pin_acc="N","TOLAK","")))),"")
      FROM tspk_pin5
      WHERE pin_trs="RETUR GARMEN" AND pin_nomor = h.ret_nomor
      ORDER BY pin_urut DESC LIMIT 1
    ), "") AS Ngedit`;

  const qMaster = `
    SELECT * FROM (
      SELECT
        h.ret_jenis AS Jenis, h.ret_nomor AS Nomor, h.ret_tanggal AS Tanggal,
        h.ret_cab AS Cab, ${dariExpr} AS Dari, h.ret_keterangan AS Keterangan,
        h.user_create AS Usr,
        IFNULL(r.ret_nomor, "") AS NoApprov, r.ret_tanggal AS TglApprov,
        IFNULL(r.user_create, "") AS Approved,
        ${pin5Expr}
      FROM tgarmenreturlog_hdr h
      LEFT JOIN tgudangproduksi p ON p.gdgp_kode = h.ret_gp
      LEFT JOIN tgarmenretur_hdr r ON r.ret_log = h.ret_nomor
      LEFT JOIN tpabrik q ON q.pab_kode = h.ret_cab
      WHERE h.ret_tanggal >= ? AND h.ret_tanggal <= ? AND h.ret_jenis = ?
      ${filterCabang} ${filterBagian}

      UNION ALL

      SELECT
        h.ret_jenis AS Jenis, h.ret_nomor AS Nomor, h.ret_tanggal AS Tanggal,
        h.ret_cab AS Cab, ${dariExpr} AS Dari, h.ret_keterangan AS Keterangan,
        h.user_create AS Usr,
        h.ret_nomor AS NoApprov, h.ret_tanggal AS TglApprov,
        IFNULL(h.user_create, "") AS Approved,
        ${pin5Expr}
      FROM tgarmenretur_hdr h
      LEFT JOIN tgudangproduksi p ON p.gdgp_kode = h.ret_gp
      LEFT JOIN tpabrik q ON q.pab_kode = h.ret_cab
      WHERE h.ret_log = "" AND h.ret_tanggal >= ? AND h.ret_tanggal <= ? AND h.ret_jenis = ?
      ${filterCabang} ${filterBagian}
    ) x
    ORDER BY x.Tanggal, x.Nomor
  `;

  const masterParams = [
    startDate,
    endDate,
    jenis,
    ...paramsCabang,
    ...paramsBagian,
    startDate,
    endDate,
    jenis,
    ...paramsCabang,
    ...paramsBagian,
  ];

  // Detail: kolom NoMinta/SPK hanya relevan untuk ACCESORIES (sesuai source asli
  // yang cuma cek rbAcc.Checked, bukan rbAcc OR rbObat — jadi ini konsisten).
  const detailExtraLog =
    jenis === "ACCESORIES"
      ? `, d.retd_nominta AS NoMinta, IFNULL(m.min_spk_nomor, "") AS SPK`
      : "";
  const detailExtraDirect =
    jenis === "ACCESORIES"
      ? `, "" AS NoMinta, IFNULL(d.retd_spk, "") AS SPK`
      : "";
  const mintaJoin =
    jenis === "ACCESORIES"
      ? "LEFT JOIN tgarmenminta_hdr m ON m.min_nomor = d.retd_nominta"
      : "";

  const qDetail = `
    SELECT * FROM (
      SELECT
        d.retd_urut AS No, d.retd_nomor AS Nomor, d.retd_brg_kode AS Kode,
        IF(b.brg_note = "", b.brg_nama, CONCAT(b.brg_nama, " - ", b.brg_note)) AS Nama,
        b.brg_satuan AS Satuan, d.retd_jumlah AS Jumlah, d.retd_keterangan AS Keterangan
        ${detailExtraLog}
      FROM tgarmenreturlog_hdr h
      INNER JOIN tgarmenreturlog_dtl d ON d.retd_nomor = h.ret_nomor
      LEFT JOIN tgarmen_brg b ON b.brg_kode = d.retd_brg_kode
      ${mintaJoin}
      WHERE h.ret_tanggal >= ? AND h.ret_tanggal <= ? AND h.ret_jenis = ?
      ${filterCabang} ${filterBagian}

      UNION ALL

      SELECT
        d.retd_urut AS No, d.retd_nomor AS Nomor, d.retd_brg_kode AS Kode,
        IF(b.brg_note = "", b.brg_nama, CONCAT(b.brg_nama, " - ", b.brg_note)) AS Nama,
        b.brg_satuan AS Satuan, d.retd_jumlah AS Jumlah, d.retd_keterangan AS Keterangan
        ${detailExtraDirect}
      FROM tgarmenretur_hdr h
      INNER JOIN tgarmenretur_dtl d ON d.retd_nomor = h.ret_nomor
      LEFT JOIN tgarmen_brg b ON b.brg_kode = d.retd_brg_kode
      WHERE h.ret_log = "" AND h.ret_tanggal >= ? AND h.ret_tanggal <= ? AND h.ret_jenis = ?
      ${filterCabang} ${filterBagian}
    ) x
    ORDER BY x.Nomor, x.No
  `;

  const detailParams = [
    startDate,
    endDate,
    jenis,
    ...paramsCabang,
    ...paramsBagian,
    startDate,
    endDate,
    jenis,
    ...paramsCabang,
    ...paramsBagian,
  ];

  const [masterRows] = await db.query(qMaster, masterParams);
  const [detailRows] = await db.query(qDetail, detailParams);

  const result = masterRows.map((master) => ({
    ...master,
    details: detailRows.filter((d) => d.Nomor === master.Nomor),
  }));

  return result;
};

/**
 * Cari nomor retur ada di tabel mana: 'log' (tgarmenreturlog_hdr) atau
 * 'final' (tgarmenretur_hdr). Dipakai untuk delete & pengajuan supaya tidak
 * salah tabel (lihat catatan ⚠️ soal source Delphi yang nentuin tabel cuma
 * berdasar Jenis, bukan cek row-nya ada di mana).
 */
const findReturLocation = async (nomor) => {
  const [logRows] = await db.query(
    `SELECT ret_nomor, ret_jenis, ret_cab, ret_tanggal FROM tgarmenreturlog_hdr WHERE ret_nomor = ?`,
    [nomor],
  );
  if (logRows.length > 0)
    return { table: "tgarmenreturlog_hdr", data: logRows[0] };

  const [finalRows] = await db.query(
    `SELECT ret_nomor, ret_jenis, ret_cab, ret_tanggal FROM tgarmenretur_hdr WHERE ret_nomor = ? AND ret_log = ""`,
    [nomor],
  );
  if (finalRows.length > 0)
    return { table: "tgarmenretur_hdr", data: finalRows[0] };

  return null;
};

/**
 * Hapus Data Retur Barang
 */
const deleteData = async (nomor, user) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [logRows] = await conn.query(
      `SELECT ret_nomor, ret_jenis, ret_cab, ret_tanggal FROM tgarmenreturlog_hdr WHERE ret_nomor = ? FOR UPDATE`,
      [nomor],
    );
    let table = null;
    let data = null;
    if (logRows.length > 0) {
      table = "tgarmenreturlog_hdr";
      data = logRows[0];
    } else {
      const [finalRows] = await conn.query(
        `SELECT ret_nomor, ret_jenis, ret_cab, ret_tanggal FROM tgarmenretur_hdr WHERE ret_nomor = ? AND ret_log = "" FOR UPDATE`,
        [nomor],
      );
      if (finalRows.length === 0)
        throw new Error("Data retur tidak ditemukan.");
      table = "tgarmenretur_hdr";
      data = finalRows[0];
    }

    // Validasi Hak Akses Cabang
    const userCabang = user.cabang;
    if (
      userCabang &&
      data.ret_cab !== userCabang &&
      userCabang !== "ALL" &&
      !userCabang.startsWith("HO")
    ) {
      throw new Error("Bukan cabang Anda.");
    }

    // Validasi sudah di-approve (hanya berlaku untuk ACCESORIES)
    if (JENIS_BUTUH_APPROVAL.includes(data.ret_jenis)) {
      const [approvRows] = await conn.query(
        `SELECT ret_nomor FROM tgarmenretur_hdr WHERE ret_log = ?`,
        [nomor],
      );
      if (approvRows.length > 0) {
        throw new Error("No.Retur tsb sudah di approve.");
      }
    }

    // Validasi Tutup Buku — pakai boundary otomatis per bulan transaksi
    // (replikasi persis pola zDay/zMonth/zYear Delphi via
    // getTanggalTutupBukuUntukTanggal)
    const zdtClose = await tutupBukuService.getTanggalTutupBukuUntukTanggal(
      data.ret_tanggal,
    );
    if (new Date() > zdtClose) {
      throw new Error("Transaksi tsb sudah close. Tidak bisa dihapus.");
    }

    await conn.query(`DELETE FROM ${table} WHERE ret_nomor = ?`, [nomor]);
    const dtlTable =
      table === "tgarmenreturlog_hdr"
        ? "tgarmenreturlog_dtl"
        : "tgarmenretur_dtl";
    await conn.query(`DELETE FROM ${dtlTable} WHERE retd_nomor = ?`, [nomor]);

    await conn.commit();
    return true;
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
};

/**
 * Pengajuan Perubahan Data (Buka Tutup Buku - PIN5)
 * Replikasi kondisi OR dari Delphi:
 *   - kalau manual override (getDateClose/getManualTutupBuku) belum diset →
 *     pengajuan diperlukan jika boundary otomatis sudah lewat hari ini
 *   - kalau manual override diset → pengajuan diperlukan jika tanggal
 *     transaksi < tanggal override tsb
 */
const ajukanPerubahan = async (payload, user) => {
  const { nomor, tanggal, keterangan, alasan } = payload;

  const lokasi = await findReturLocation(nomor);
  if (!lokasi) throw new Error("Data retur tidak ditemukan.");

  const tglTrs = new Date(tanggal);
  const today = new Date();

  const zdtCloseOtomatis =
    await tutupBukuService.getTanggalTutupBukuUntukTanggal(tanggal);
  const zClose = await tutupBukuService.getManualTutupBuku(MODUL_TUTUP_BUKU);

  const perluPengajuan =
    zClose === null ? zdtCloseOtomatis < today : tglTrs < zClose;

  if (!perluPengajuan) {
    throw new Error("Tidak perlu pengajuan perubahan data.");
  }

  const [pinRows] = await db.query(
    `SELECT pin_urut, pin_dipakai FROM tspk_pin5 WHERE pin_trs="RETUR GARMEN" AND pin_nomor=? ORDER BY pin_urut DESC LIMIT 1`,
    [nomor],
  );

  let urut = 1;
  if (pinRows.length > 0) {
    urut = !pinRows[0].pin_dipakai
      ? pinRows[0].pin_urut
      : pinRows[0].pin_urut + 1;
  }

  const qInsert = `
    INSERT INTO tspk_pin5 (pin_trs, pin_nomor, pin_urut, pin_tgl_trs, pin_ket, pin_tgl_minta, pin_user_minta, pin_alasan)
    VALUES ("RETUR GARMEN", ?, ?, ?, ?, NOW(), ?, ?)
    ON DUPLICATE KEY UPDATE
      pin_tgl_trs = ?, pin_ket = ?, pin_acc = "", pin_tgl_minta = NOW(), pin_user_minta = ?, pin_alasan = ?
  `;

  await db.query(qInsert, [
    nomor,
    urut,
    tanggal,
    keterangan || "",
    user.kode,
    alasan,
    tanggal,
    keterangan || "",
    user.kode,
    alasan,
  ]);

  return true;
};

module.exports = {
  getBrowseData,
  deleteData,
  ajukanPerubahan,
};
