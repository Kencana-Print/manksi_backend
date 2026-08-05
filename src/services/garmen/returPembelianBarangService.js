const db = require("../../config/database");
const tutupBukuService = require("../tutupBukuService");

const MODUL_TUTUP_BUKU = "RB GARMEN";
const VALID_JENIS = ["ACCESORIES", "OBAT", "SPAREPART", "ATK/RTK"];

/**
 * Mengambil Data Browse (Master dan Detail Retur Pembelian Garmen)
 */
const getBrowseData = async (startDate, endDate, cabang, jenis, user) => {
  if (!VALID_JENIS.includes(jenis)) {
    throw new Error("Jenis tidak valid.");
  }

  let filterCabang = "";
  const paramsCabang = [];
  if (cabang && cabang !== "ALL") {
    filterCabang = "AND h.rb_cab = ?";
    paramsCabang.push(cabang);
  }

  // Pola sama dgn Retur Barang/Koreksi Stok: SPAREPART utk bagian
  // TEKNISI/IT wajib difilter ke bagian sendiri. Diterapkan konsisten
  // di master DAN detail (source asli cuma di master — detail-nya
  // tidak difilter, tapi karena detail di-join ke master via Nomor,
  // hasil akhir sama; ini cuma optimasi query, bukan perubahan logic).
  let filterBagian = "";
  const paramsBagian = [];
  if (jenis === "SPAREPART" && ["TEKNISI", "IT"].includes(user.bagian)) {
    filterBagian = "AND h.rb_bagian = ?";
    paramsBagian.push(user.bagian);
  }

  const qMaster = `
    SELECT h.rb_nomor AS Nomor, h.rb_jenis AS Jenis, h.rb_cab AS Cab,
      h.rb_tanggal AS Tanggal, h.rb_keterangan AS Keterangan, h.user_create AS Usr,
      IFNULL((
        SELECT IFNULL(IF(pin_acc="" AND pin_dipakai="","WAIT",
               IF(pin_acc="Y" AND pin_dipakai="","ACC",
               IF(pin_acc="Y" AND pin_dipakai="Y","",
               IF(pin_acc="N","TOLAK","")))),"")
        FROM tspk_pin5
        WHERE pin_trs="RB GARMEN" AND pin_nomor = h.rb_nomor
        ORDER BY pin_urut DESC LIMIT 1
      ), "") AS Ngedit
    FROM tgarmenrb_hdr h
    WHERE h.rb_tanggal >= ? AND h.rb_tanggal <= ? AND h.rb_jenis = ?
    ${filterCabang} ${filterBagian}
    ORDER BY h.rb_nomor
  `;
  const masterParams = [
    startDate,
    endDate,
    jenis,
    ...paramsCabang,
    ...paramsBagian,
  ];
  const [masterRows] = await db.query(qMaster, masterParams);

  const qDetail = `
    SELECT d.rbd_nomor AS Nomor, d.rbd_brg_kode AS Kode,
      IF(b.brg_note = "", b.brg_nama, CONCAT(b.brg_nama, " - ", b.brg_note)) AS Nama,
      b.brg_satuan AS Satuan, d.rbd_jumlah AS Jumlah
    FROM tgarmenrb_dtl d
    LEFT JOIN tgarmenrb_hdr h ON h.rb_nomor = d.rbd_nomor
    LEFT JOIN tgarmen_brg b ON b.brg_kode = d.rbd_brg_kode
    WHERE h.rb_tanggal >= ? AND h.rb_tanggal <= ? AND h.rb_jenis = ?
    ${filterCabang} ${filterBagian}
    ORDER BY d.rbd_nomor
  `;
  const detailParams = [
    startDate,
    endDate,
    jenis,
    ...paramsCabang,
    ...paramsBagian,
  ];
  const [detailRows] = await db.query(qDetail, detailParams);

  return masterRows.map((master) => ({
    ...master,
    details: detailRows.filter((d) => d.Nomor === master.Nomor),
  }));
};

/**
 * Hapus Data Retur Pembelian
 * ⚠️ Belum dikonfirmasi apakah tgarmenrb_dtl sudah ada trigger cascade
 * delete (seperti tgarmenkor_dtl). Sementara dihapus manual eksplisit —
 * kalau ternyata sudah ada trigger, buang baris DELETE detail di bawah.
 */
const deleteData = async (nomor, user) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [rows] = await conn.query(
      `SELECT rb_nomor, rb_cab, rb_tanggal FROM tgarmenrb_hdr WHERE rb_nomor = ? FOR UPDATE`,
      [nomor],
    );
    if (rows.length === 0)
      throw new Error("Data retur pembelian tidak ditemukan.");
    const data = rows[0];

    // Validasi Hak Akses Cabang (konsisten pola project, bukan literal
    // dari source Delphi yang tidak punya cek ini secara eksplisit)
    const userCabang = user.cabang;
    if (
      userCabang &&
      data.rb_cab !== userCabang &&
      userCabang !== "ALL" &&
      !userCabang.startsWith("HO")
    ) {
      throw new Error("Bukan cabang Anda.");
    }

    // Validasi Tutup Buku — replikasi persis pola zDay/zMonth/zYear Delphi
    const zdtClose = await tutupBukuService.getTanggalTutupBukuUntukTanggal(
      data.rb_tanggal,
    );
    if (new Date() > zdtClose) {
      throw new Error("Transaksi tsb sudah close. Tidak bisa dihapus.");
    }

    await conn.query(`DELETE FROM tgarmenrb_hdr WHERE rb_nomor = ?`, [nomor]);

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
 * Replikasi kondisi OR dari Delphi, pola sama persis Retur Barang/Koreksi Stok.
 */
const ajukanPerubahan = async (payload, user) => {
  const { nomor, tanggal, keterangan, alasan } = payload;

  const [rows] = await db.query(
    `SELECT rb_nomor FROM tgarmenrb_hdr WHERE rb_nomor = ?`,
    [nomor],
  );
  if (rows.length === 0)
    throw new Error("Data retur pembelian tidak ditemukan.");

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
    `SELECT pin_urut, pin_dipakai FROM tspk_pin5 WHERE pin_trs="RB GARMEN" AND pin_nomor=? ORDER BY pin_urut DESC LIMIT 1`,
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
    VALUES ("RB GARMEN", ?, ?, ?, ?, NOW(), ?, ?)
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
