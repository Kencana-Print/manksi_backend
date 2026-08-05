const db = require("../../config/database");
const tutupBukuService = require("../tutupBukuService");

const MODUL_TUTUP_BUKU = "KOREKSI GARMEN";
const VALID_JENIS = ["ACCESORIES", "OBAT", "SPAREPART", "ATK/RTK"];

// ⚠️ Bagian yang DIKECUALIKAN dari cabang-lock (boleh pilih cabang bebas
// termasuk ALL). Perhatikan DIREKSI TIDAK termasuk di sini — beda dari
// daftar bagian yang dapat akses penuh ke pilihan JENIS barang. Ini
// replikasi persis kondisi FormCreate .pas:
//   if (frmMenu.CAB<>'') and (zbagian<>'FINANCE') and (zbagian<>'AUDIT')
//   and (zbagian<>'EDP') then [cabang dikunci ke 1 opsi]
const CABANG_UNLOCK_BAGIAN = ["FINANCE", "AUDIT", "EDP"];

/**
 * Resolusi cabang efektif untuk query, mereplikasi cbCab locking di
 * FormCreate. Kalau user tidak termasuk bagian yang dikecualikan DAN
 * punya cabang home (non-empty), cabang query DIPAKSA ke cabang user
 * sendiri — mengabaikan parameter cabang dari frontend (defense in
 * depth, karena dropdown frontend memang seharusnya sudah dikunci juga).
 */
const resolveCabangFilter = (cabangParam, user) => {
  const userCab = user.cabang || "";
  const isUnlocked = CABANG_UNLOCK_BAGIAN.includes(user.bagian);

  if (!isUnlocked && userCab !== "") {
    return userCab; // terkunci, apa pun yang diminta frontend
  }
  return cabangParam || "ALL";
};

/**
 * Mengambil Data Browse (Master dan Detail Koreksi Stok Garmen)
 */
const getBrowseData = async (startDate, endDate, cabangParam, jenis, user) => {
  if (!VALID_JENIS.includes(jenis)) {
    throw new Error("Jenis tidak valid.");
  }

  const cabang = resolveCabangFilter(cabangParam, user);

  let filterCabang = "";
  const paramsCabang = [];
  if (cabang && cabang !== "ALL") {
    filterCabang = "AND h.kor_cab = ?";
    paramsCabang.push(cabang);
  }

  // Pola sama dgn Retur Barang: SPAREPART untuk bagian TEKNISI/IT wajib
  // difilter ke bagian sendiri
  let filterBagian = "";
  const paramsBagian = [];
  if (jenis === "SPAREPART" && ["TEKNISI", "IT"].includes(user.bagian)) {
    filterBagian = "AND h.kor_bagian = ?";
    paramsBagian.push(user.bagian);
  }

  const qMaster = `
    SELECT h.kor_nomor AS Nomor, h.kor_jenis AS Jenis, h.kor_cab AS Cab,
      h.kor_tanggal AS Tanggal, h.kor_ket AS Keterangan, h.user_create AS Usr,
      IFNULL((
        SELECT IFNULL(IF(pin_acc="" AND pin_dipakai="","WAIT",
               IF(pin_acc="Y" AND pin_dipakai="","ACC",
               IF(pin_acc="Y" AND pin_dipakai="Y","",
               IF(pin_acc="N","TOLAK","")))),"")
        FROM tspk_pin5
        WHERE pin_trs="KOREKSI GARMEN" AND pin_nomor = h.kor_nomor
        ORDER BY pin_urut DESC LIMIT 1
      ), "") AS Ngedit
    FROM tgarmenkor_hdr h
    WHERE h.kor_tanggal >= ? AND h.kor_tanggal <= ? AND h.kor_jenis = ?
    ${filterCabang} ${filterBagian}
    ORDER BY h.kor_nomor
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
    SELECT d.kord_nomor AS Nomor, d.kord_brg_kode AS Kode,
      IF(b.brg_note = "", b.brg_nama, CONCAT(b.brg_nama, " - ", b.brg_note)) AS Nama,
      b.brg_satuan AS Satuan, d.kord_stok AS Stok,
      d.kord_qty AS Jumlah, d.kord_selisih AS Selisih
    FROM tgarmenkor_dtl d
    LEFT JOIN tgarmenkor_hdr h ON h.kor_nomor = d.kord_nomor
    LEFT JOIN tgarmen_brg b ON b.brg_kode = d.kord_brg_kode
    WHERE h.kor_tanggal >= ? AND h.kor_tanggal <= ? AND h.kor_jenis = ?
    ${filterCabang} ${filterBagian}
    ORDER BY d.kord_nomor
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
 * Hapus Data Koreksi Stok
 */
const deleteData = async (nomor, user) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [rows] = await conn.query(
      `SELECT kor_nomor, kor_cab, kor_tanggal FROM tgarmenkor_hdr WHERE kor_nomor = ? FOR UPDATE`,
      [nomor],
    );
    if (rows.length === 0) throw new Error("Data koreksi tidak ditemukan.");
    const data = rows[0];

    // Validasi Hak Akses Cabang — tambahan konsisten pola project (bukan
    // di source .pas literal, tapi disamakan dgn convention modul lain)
    const userCabang = user.cabang;
    if (
      userCabang &&
      data.kor_cab !== userCabang &&
      userCabang !== "ALL" &&
      !userCabang.startsWith("HO")
    ) {
      throw new Error("Bukan cabang Anda.");
    }

    // Validasi Tutup Buku — replikasi persis pola zDay/zMonth/zYear Delphi
    const zdtClose = await tutupBukuService.getTanggalTutupBukuUntukTanggal(
      data.kor_tanggal,
    );
    if (new Date() > zdtClose) {
      throw new Error("Transaksi tsb sudah close. Tidak bisa dihapus.");
    }

    await conn.query(`DELETE FROM tgarmenkor_hdr WHERE kor_nomor = ?`, [nomor]);

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
 * Replikasi kondisi OR dari Delphi PengajuanPerubahanData1Click, sama
 * persis pola Retur Barang.
 */
const ajukanPerubahan = async (payload, user) => {
  const { nomor, tanggal, keterangan, alasan } = payload;

  const [rows] = await db.query(
    `SELECT kor_nomor FROM tgarmenkor_hdr WHERE kor_nomor = ?`,
    [nomor],
  );
  if (rows.length === 0) throw new Error("Data koreksi tidak ditemukan.");

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
    `SELECT pin_urut, pin_dipakai FROM tspk_pin5 WHERE pin_trs="KOREKSI GARMEN" AND pin_nomor=? ORDER BY pin_urut DESC LIMIT 1`,
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
    VALUES ("KOREKSI GARMEN", ?, ?, ?, ?, NOW(), ?, ?)
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
  resolveCabangFilter,
};
