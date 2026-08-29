const db = require("../../config/database");
const tutupBukuService = require("../tutupBukuService");

/**
 * Mengambil Data Browse (Master dan Detail Realisasi)
 */
const getBrowseData = async (startDate, endDate, cabang, jenis, user) => {
  let filterCabang = "";
  if (cabang && cabang !== "ALL") {
    filterCabang = `AND h.re_cab = '${cabang}'`;
  }

  let filterBagian = "";
  if (
    jenis === "SPAREPART" &&
    (user.bagian === "TEKNISI" || user.bagian === "IT")
  ) {
    filterBagian = `AND h.re_bagian = '${user.bagian}'`;
  }

  // 1. Query Master Realisasi (Termasuk status PIN 5)
  const qMaster = `
    SELECT 
      h.re_nomor AS Nomor, h.re_jenis AS Jenis, h.re_tanggal AS Tanggal, 
      DATE_FORMAT(h.date_create, "%H:%i:%s") AS Jam, h.re_minta AS NoMinta, 
      h.re_apv AS Approve, h.re_keterangan AS Keterangan, h.re_cab AS Cab, h.user_create AS Usr,
      h.re_spk_nomor AS SPK, IFNULL(s.spk_nama, m.mspk_nama) AS NamaSpk, 
      IFNULL(s.spk_jumlah, m.mspk_jumlah) AS JmlSPK,
      IFNULL((
        SELECT IFNULL(IF(pin_acc="" AND pin_dipakai="","WAIT",
               IF(pin_acc="Y" AND pin_dipakai="","ACC",
               IF(pin_acc="Y" AND pin_dipakai="Y","",
               IF(pin_acc="N","TOLAK","")))),"")
        FROM tspk_pin5 
        WHERE pin_trs="REALISASI MINTA GARMEN" AND pin_nomor=h.re_nomor 
        ORDER BY pin_urut DESC LIMIT 1
      ),"") AS Ngedit,
      'REALISASI' AS RowType
    FROM tgarmenrealisasi_hdr h 
    LEFT JOIN tspk s ON s.spk_nomor = h.re_spk_nomor
    LEFT JOIN tmemospk m ON m.mspk_nomor = h.re_spk_nomor 
    WHERE h.re_tanggal >= ? AND h.re_tanggal <= ? AND h.re_jenis = ?
    ${filterCabang} ${filterBagian}
  `;

  // 1b. Query Permintaan yang MASIH OPEN (belum direalisasi sama sekali) —
  // replikasi pola "SPK belum ada MKA" di mkaService.getBrowseList, supaya
  // baris merah ini bisa langsung dipilih user & dibawa ke form Baru.
  let filterCabangMinta = "";
  if (cabang && cabang !== "ALL") {
    filterCabangMinta = `AND min_cab = '${cabang}'`;
  }
  let filterBagianMinta = "";
  if (
    jenis === "SPAREPART" &&
    (user.bagian === "TEKNISI" || user.bagian === "IT")
  ) {
    filterBagianMinta = `AND min_bagian = '${user.bagian}'`;
  }
  const qOpenMinta = `
    SELECT
      min_nomor AS Nomor, min_jenis AS Jenis, min_tanggal AS Tanggal,
      DATE_FORMAT(date_create, "%H:%i:%s") AS Jam, min_nomor AS NoMinta,
      NULL AS Approve, min_ket AS Keterangan, min_cab AS Cab, user_create AS Usr,
      min_spk_nomor AS SPK, NULL AS NamaSpk, NULL AS JmlSPK,
      '' AS Ngedit,
      'MINTA' AS RowType
    FROM tgarmenminta_hdr
    WHERE min_tanggal >= ? AND min_tanggal <= ? AND min_jenis = ? AND min_close = 0
    ${filterCabangMinta} ${filterBagianMinta}
  `;

  const qUnion = `SELECT * FROM (${qMaster} UNION ALL ${qOpenMinta}) z ORDER BY z.Tanggal DESC, z.Nomor DESC`;

  // 2. Query Detail — hanya relevan untuk baris RowType REALISASI
  const qDetail = `
    SELECT 
      d.red_nomor AS Nomor, d.red_brg_kode AS Kode, 
      IF(b.brg_note="", b.brg_nama, CONCAT(b.brg_nama," - ",b.brg_note)) AS Nama, 
      b.brg_satuan AS Satuan, d.red_jumlah AS Jumlah, d.red_keterangan AS Keterangan
    FROM tgarmenrealisasi_dtl d
    INNER JOIN tgarmenrealisasi_hdr h ON h.re_nomor = d.red_nomor 
    LEFT JOIN tgarmen_brg b ON b.brg_kode = d.red_brg_kode 
    WHERE h.re_tanggal >= ? AND h.re_tanggal <= ? AND h.re_jenis = ?
    ${filterCabang} ${filterBagian}
    ORDER BY d.red_nomor, d.red_brg_kode
  `;

  const paramsUnion = [startDate, endDate, jenis, startDate, endDate, jenis];
  const [masterRows] = await db.query(qUnion, paramsUnion);
  const [detailRows] = await db.query(qDetail, [startDate, endDate, jenis]);

  // Mapping detail ke dalam master (baris RowType MINTA tidak punya detail)
  const result = masterRows.map((master) => ({
    ...master,
    details: detailRows.filter((d) => d.Nomor === master.Nomor),
  }));

  return result;
};

/**
 * Hapus Data Realisasi & Hitung Ulang Status Permintaan (min_close)
 */
const deleteData = async (nomor, userCabang) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // 1. Ambil data Header Realisasi
    const [hRows] = await conn.query(
      `SELECT re_cab, re_tanggal, re_minta FROM tgarmenrealisasi_hdr WHERE re_nomor = ?`,
      [nomor],
    );
    if (hRows.length === 0) throw new Error("Data realisasi tidak ditemukan.");
    const data = hRows[0];

    // Validasi Hak Akses Cabang
    if (
      userCabang &&
      data.re_cab !== userCabang &&
      userCabang !== "ALL" &&
      !userCabang.startsWith("HO")
    ) {
      throw new Error("Bukan cabang Anda.");
    }

    // Validasi Tutup Buku
    const tglTrs = new Date(data.re_tanggal);
    const zdtClose = await tutupBukuService.getTanggalTutupBuku();
    if (tglTrs <= zdtClose) {
      throw new Error(
        "Transaksi tsb sudah close (Tutup Buku). Tidak bisa dihapus.",
      );
    }

    // 2. Kalkulasi ulang status Permintaan (min_close) seperti logic Delphi
    let tpo = 0; // Total Permintaan (Order)
    let tbpb = 0; // Total Realisasi (BPB) selain dokumen yang dihapus ini

    const qHitung = `
      SELECT b.mind_jumlah,
        IFNULL((
          SELECT SUM(d.red_jumlah) 
          FROM tgarmenrealisasi_hdr h 
          INNER JOIN tgarmenrealisasi_dtl d ON d.red_nomor = h.re_nomor
          WHERE h.re_minta = b.mind_nomor 
            AND d.red_brg_kode = b.mind_brg_kode 
            AND d.red_nomor <> ?
        ), 0) AS bpb
      FROM tgarmenminta_dtl b
      WHERE b.mind_nomor = ?
    `;
    const [calcRows] = await conn.query(qHitung, [nomor, data.re_minta]);

    for (const row of calcRows) {
      const mind_jumlah = parseFloat(row.mind_jumlah);
      const bpb = parseFloat(row.bpb);

      tpo += mind_jumlah;
      if (bpb <= mind_jumlah) {
        tbpb += bpb;
      } else {
        tbpb += mind_jumlah;
      }
    }

    // Tentukan status close baru
    let minCloseStatus = 0;
    if (tpo > 0 && tbpb >= tpo) {
      minCloseStatus = 1; // Full Close
    } else if (tbpb !== 0 && tbpb < tpo) {
      minCloseStatus = 2; // Proses (Sebagian)
    } else {
      minCloseStatus = 0; // Open (Belum ada realisasi)
    }

    // 3. Update status Permintaan
    await conn.query(
      `UPDATE tgarmenminta_hdr SET min_close = ? WHERE min_nomor = ?`,
      [minCloseStatus, data.re_minta],
    );

    // 4. Hapus Transaksi Realisasi (Header & Detail)
    await conn.query(`DELETE FROM tgarmenrealisasi_hdr WHERE re_nomor = ?`, [
      nomor,
    ]);
    await conn.query(`DELETE FROM tgarmenrealisasi_dtl WHERE red_nomor = ?`, [
      nomor,
    ]);

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
 */
const ajukanPerubahan = async (payload, user) => {
  const { nomor, tanggal, keterangan, alasan } = payload;
  const zdtClose = await tutupBukuService.getTanggalTutupBuku();
  const tglTrs = new Date(tanggal);

  if (tglTrs > zdtClose) {
    throw new Error(
      "Tidak perlu pengajuan perubahan data. Periode ini belum di-close.",
    );
  }

  const [pinRows] = await db.query(
    `SELECT pin_urut, pin_dipakai FROM tspk_pin5 WHERE pin_trs="REALISASI MINTA GARMEN" AND pin_nomor=? ORDER BY pin_urut DESC LIMIT 1`,
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
    VALUES ("REALISASI MINTA GARMEN", ?, ?, ?, ?, NOW(), ?, ?)
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
