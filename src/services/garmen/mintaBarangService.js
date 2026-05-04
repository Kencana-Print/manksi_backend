const db = require("../../config/database");
const tutupBukuService = require("../../services/tutupBukuService");

/**
 * Mengambil Data Browse (Master, Detail Barang, Detail Realisasi)
 */
const getBrowseData = async (startDate, endDate, cabang, jenis, user) => {
  // 1. PERBAIKAN: Hilangkan alias 'h.' agar aman disuntikkan ke dalam subquery
  let filterCabang = "";
  if (cabang && cabang !== "ALL") {
    filterCabang = `AND min_cab = '${cabang}'`;
  }

  let filterBagian = "";
  if (
    jenis === "SPAREPART" &&
    (user.bagian === "TEKNISI" || user.bagian === "IT")
  ) {
    filterBagian = `AND min_bagian = '${user.bagian}'`;
  }

  // 1. Query Master
  const qMaster = `
    SELECT x.*, v.divisi AS Divisi FROM (
      SELECT 
        h.min_jenis AS Jenis, h.min_nomor AS Nomor, h.min_tanggal AS Tanggal, 
        DATE_FORMAT(h.date_create,"%H:%i:%s") AS Jam, h.min_cab AS Cab, 
        IF(h.min_gp="", p.pab_nama, RIGHT(g.gdgp_nama, LENGTH(g.gdgp_nama)-6)) AS GdgPeminta,
        IFNULL(s.spk_divisi, m.mspk_divisi) AS kddiv,
        h.min_spk_nomor AS SPK, IFNULL(s.spk_nama, m.Mspk_nama) AS NamaSpk, 
        IFNULL(s.spk_jumlah, 0) AS JmlSpk, h.min_ket AS Keterangan, 
        h.min_bagian AS Bagian, h.user_create AS Usr,
        IF(h.min_close=0, "OPEN", IF(h.min_close=1, "CLOSE", IF(h.min_close=9, "DICLOSE", "PROSES"))) AS Status,
        h.min_alasanclose AS AlasanClose,
        IFNULL((SELECT COUNT(*) FROM tgarmenrealisasi_hdr q WHERE q.re_minta=h.min_nomor),0) AS totr,
        IFNULL((SELECT COUNT(*) FROM tgarmenrealisasi_hdr q WHERE q.re_minta=h.min_nomor AND q.re_apv IS NOT NULL),0) AS tota,
        IFNULL((
          SELECT IFNULL(IF(pin_acc="" AND pin_dipakai="","WAIT",
                 IF(pin_acc="Y" AND pin_dipakai="","ACC",
                 IF(pin_acc="Y" AND pin_dipakai="Y","",
                 IF(pin_acc="N","TOLAK","")))),"")
          FROM tspk_pin5 WHERE pin_trs="PERMINTAAN GARMEN" AND pin_nomor=h.min_nomor ORDER BY pin_urut DESC LIMIT 1
        ),"") AS Ngedit
      FROM tgarmenminta_hdr h
      LEFT JOIN tgudangproduksi g ON g.gdgp_kode = h.min_gp
      LEFT JOIN tspk s ON s.spk_nomor = h.min_spk_nomor
      LEFT JOIN tmemospk m ON m.mspk_nomor = h.min_spk_nomor
      LEFT JOIN tpabrik p ON p.pab_kode = h.min_cab
      WHERE h.min_tanggal >= ? AND h.min_tanggal <= ? AND h.min_jenis = ?
      ${filterCabang} ${filterBagian}
    ) x 
    LEFT JOIN tdivisi v ON v.kode = x.kddiv
    ORDER BY x.Nomor DESC
  `;

  // 2. Query Detail Barang
  const qDetail = `
    SELECT 
      d.mind_nomor AS Nomor, d.mind_brg_kode AS Kode, 
      IF(b.brg_note="", b.brg_nama, CONCAT(b.brg_nama," - ",b.brg_note)) AS Nama, 
      b.brg_satuan AS Satuan, d.mind_jumlah AS Jumlah, d.mind_ket AS Keterangan,
      IFNULL((SELECT SUM(i.red_jumlah) FROM tgarmenrealisasi_dtl i 
              INNER JOIN tgarmenrealisasi_hdr j ON j.re_nomor=i.red_nomor 
              WHERE j.re_minta=d.mind_nomor AND i.red_brg_kode=d.mind_brg_kode), 0) AS Realisasi
    FROM tgarmenminta_dtl d
    LEFT JOIN tgarmen_brg b ON b.brg_kode = d.mind_brg_kode
    WHERE d.mind_nomor IN (
      SELECT min_nomor FROM tgarmenminta_hdr 
      WHERE min_tanggal >= ? AND min_tanggal <= ? AND min_jenis = ? ${filterCabang} ${filterBagian}
    )
    ORDER BY d.mind_nomor, d.mind_urut
  `;

  // 3. Query Detail Realisasi (Header)
  const qRealisasi = `
    SELECT 
      h.re_minta AS NomorMinta, h.re_nomor AS NoRealisasi, h.re_tanggal AS TglRealisasi, 
      IF(h.re_apv IS NULL, "", DATE_FORMAT(h.re_apv, "%d-%m-%Y %H:%i:%s")) AS Approve, 
      SUM(d.red_jumlah) AS Jumlah, h.re_keterangan AS Keterangan
    FROM tgarmenrealisasi_hdr h
    INNER JOIN tgarmenrealisasi_dtl d ON d.red_nomor = h.re_nomor
    WHERE h.re_minta IN (
      SELECT min_nomor FROM tgarmenminta_hdr 
      WHERE min_tanggal >= ? AND min_tanggal <= ? AND min_jenis = ? ${filterCabang} ${filterBagian}
    )
    GROUP BY h.re_nomor
    ORDER BY h.re_nomor
  `;

  // 4. Query Rincian Item Realisasi
  const qRealisasiDtl = `
    SELECT 
      h.re_minta AS NomorMinta, d.red_nomor AS NomorRealisasi,
      d.red_brg_kode AS Kode, b.brg_nama AS Nama, b.brg_satuan AS Satuan, 
      d.red_jumlah AS Jumlah
    FROM tgarmenrealisasi_dtl d
    INNER JOIN tgarmenrealisasi_hdr h ON h.re_nomor = d.red_nomor
    LEFT JOIN tgarmen_brg b ON b.brg_kode = d.red_brg_kode
    WHERE h.re_minta IN (
      SELECT min_nomor FROM tgarmenminta_hdr 
      WHERE min_tanggal >= ? AND min_tanggal <= ? AND min_jenis = ? ${filterCabang} ${filterBagian}
    )
    ORDER BY d.red_nomor
  `;

  const params = [startDate, endDate, jenis];
  const [masterRows] = await db.query(qMaster, params);
  const [detailRows] = await db.query(qDetail, params);
  const [realisasiRows] = await db.query(qRealisasi, params);
  const [realisasiDtlRows] = await db.query(qRealisasiDtl, params);

  const result = masterRows.map((master) => {
    let approveStatus = "";
    if (master.totr > 0) {
      approveStatus = master.totr > master.tota ? "N" : "Y";
    }
    return {
      ...master,
      Approve: approveStatus,
      details: detailRows.filter((d) => d.Nomor === master.Nomor),
      realisasi: realisasiRows.filter((r) => r.NomorMinta === master.Nomor),
      realisasiDtl: realisasiDtlRows.filter(
        (r) => r.NomorMinta === master.Nomor,
      ),
    };
  });

  return result;
};

/**
 * Validasi Hapus Data
 */
const deleteData = async (nomor, userCabang) => {
  const conn = await db.getConnection();
  try {
    const [rows] = await conn.query(
      `SELECT min_cab, min_tanggal, IF(min_close=0, "OPEN", IF(min_close=1, "CLOSE", IF(min_close=9, "DICLOSE", "PROSES"))) AS sts FROM tgarmenminta_hdr WHERE min_nomor = ?`,
      [nomor],
    );
    if (rows.length === 0) throw new Error("Data tidak ditemukan.");

    const data = rows[0];

    // Validasi Cabang
    if (userCabang && data.min_cab !== userCabang) {
      throw new Error("Bukan cabang Anda.");
    }

    // Validasi Status
    if (data.sts !== "OPEN") {
      throw new Error(`Sudah ${data.sts}. Tidak bisa dihapus.`);
    }

    // Validasi Tutup Buku
    const tglTrs = new Date(data.min_tanggal);
    const zdtClose = await tutupBukuService.getTanggalTutupBuku();
    if (tglTrs <= zdtClose) {
      throw new Error(
        "Transaksi tsb sudah close (Tutup Buku). Tidak bisa dihapus.",
      );
    }

    await conn.query(`DELETE FROM tgarmenminta_hdr WHERE min_nomor = ?`, [
      nomor,
    ]);
    // Note: Detail terhapus otomatis jika ada cascade di database, jika tidak:
    await conn.query(`DELETE FROM tgarmenminta_dtl WHERE mind_nomor = ?`, [
      nomor,
    ]);

    return true;
  } finally {
    conn.release();
  }
};

/**
 * Tutup / Close Transaksi Manual
 */
const closeData = async (payload, user) => {
  const { nomor, alasan } = payload;
  const [rows] = await db.query(
    `SELECT min_cab, IF(min_close=0, "OPEN", IF(min_close=1, "CLOSE", IF(min_close=9, "DICLOSE", "PROSES"))) AS sts FROM tgarmenminta_hdr WHERE min_nomor = ?`,
    [nomor],
  );
  if (rows.length === 0) throw new Error("Data tidak ditemukan.");

  const data = rows[0];

  // Validasi Cabang (Kecuali bagian GUDANG)
  if (
    user.cabang &&
    data.min_cab !== user.cabang &&
    user.bagian.toUpperCase() !== "GUDANG"
  ) {
    throw new Error("Bukan cabang Anda.");
  }

  if (data.sts === "CLOSE" || data.sts === "DICLOSE") {
    throw new Error(`Sudah ${data.sts}.`);
  }

  await db.query(
    `UPDATE tgarmenminta_hdr SET min_close=9, min_alasanclose=? WHERE min_nomor=?`,
    [alasan, nomor],
  );
  return true;
};

/**
 * Pengajuan Perubahan Data (Buka Tutup Buku - PIN5)
 */
const ajukanPerubahan = async (payload, user) => {
  const zdtClose = await tutupBukuService.getTanggalTutupBuku();
  const tglTrs = new Date(payload.tanggal);

  if (tglTrs > zdtClose) {
    throw new Error(
      "Tidak perlu pengajuan perubahan data. Periode ini belum di-close.",
    );
  }

  const [pinRows] = await db.query(
    `SELECT pin_urut, pin_dipakai FROM tspk_pin5 WHERE pin_trs="PERMINTAAN GARMEN" AND pin_nomor=? ORDER BY pin_urut DESC LIMIT 1`,
    [payload.nomor],
  );

  let urut = 1;
  if (pinRows.length > 0) {
    urut = !pinRows[0].pin_dipakai
      ? pinRows[0].pin_urut
      : pinRows[0].pin_urut + 1;
  }

  const qInsert = `
    INSERT INTO tspk_pin5 (pin_trs, pin_nomor, pin_urut, pin_tgl_trs, pin_ket, pin_tgl_minta, pin_user_minta, pin_alasan)
    VALUES ("PERMINTAAN GARMEN", ?, ?, ?, ?, NOW(), ?, ?)
    ON DUPLICATE KEY UPDATE 
      pin_tgl_trs = ?, pin_ket = ?, pin_acc = "", pin_tgl_minta = NOW(), pin_user_minta = ?, pin_alasan = ?
  `;

  await db.query(qInsert, [
    payload.nomor,
    urut,
    payload.tanggal,
    payload.spk || "",
    user.kode,
    payload.alasan,
    payload.tanggal,
    payload.spk || "",
    user.kode,
    payload.alasan,
  ]);

  return true;
};

/**
 * Cek jika ada Permintaan Accesories yg realisasinya belum di-approve > 1 hari
 * Dipakai saat user klik tombol "Baru" di Frontend
 */
const checkUnapprovedRealisasi = async (userKode) => {
  const query = `
    SELECT IFNULL(COUNT(*), 0) AS blmApv
    FROM tgarmenrealisasi_hdr h
    INNER JOIN tgarmenminta_hdr a ON a.min_nomor = h.re_minta AND a.user_create = ?
    WHERE h.re_minta LIKE 'MIA%' AND h.re_apv IS NULL AND h.re_tanggal < DATE_ADD(CURDATE(), INTERVAL -1 DAY)
  `;
  const [rows] = await db.query(query, [userKode]);
  return rows[0].blmApv > 0;
};

/**
 * Generate Nomor APVS (Sesuai getmaxnomor Delphi)
 */
const generateNomorAPVS = async (conn) => {
  const yy = new Date().getFullYear().toString().slice(-2);
  const prefix = `APVS${yy}`;

  const query = `SELECT IFNULL(MAX(CAST(RIGHT(red2_apv, 5) AS UNSIGNED)), 0) AS last_num FROM tgarmenrealisasi_dtl2 WHERE LEFT(red2_apv, 6) = ?`;
  const [rows] = await conn.query(query, [prefix]);

  const nextNum = parseInt(rows[0].last_num, 10) + 1;
  return `${prefix}${String(nextNum).padStart(5, "0")}`;
};

/**
 * Approve Realisasi (F7)
 */
const approveRealisasi = async (noRealisasi, userCabang) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // 1. Ambil info realisasi dan master permintaannya
    const qCek = `
      SELECT h.re_apv, m.min_jenis, m.min_cab 
      FROM tgarmenrealisasi_hdr h
      INNER JOIN tgarmenminta_hdr m ON m.min_nomor = h.re_minta
      WHERE h.re_nomor = ?
    `;
    const [cekRows] = await conn.query(qCek, [noRealisasi]);
    if (cekRows.length === 0)
      throw new Error("Data realisasi tidak ditemukan.");

    const data = cekRows[0];

    // Validasi Cabang
    if (
      userCabang &&
      data.min_cab !== userCabang &&
      userCabang !== "ALL" &&
      !userCabang.startsWith("HO")
    ) {
      throw new Error("Bukan cabang Anda.");
    }

    // Validasi apakah sudah di-approve
    if (data.re_apv !== null) {
      throw new Error("Realisasi ini sudah diapprove sebelumnya.");
    }

    // 2. Update status Approve
    const waktuApprove = new Date()
      .toISOString()
      .slice(0, 19)
      .replace("T", " ");
    await conn.query(
      `UPDATE tgarmenrealisasi_hdr SET re_apv = ? WHERE re_nomor = ?`,
      [waktuApprove, noRealisasi],
    );

    // 3. Khusus SPAREPART: Insert ke tgarmenrealisasi_dtl2
    if (data.min_jenis === "SPAREPART") {
      const capv = await generateNomorAPVS(conn);

      const qInsertDtl2 = `
        INSERT INTO tgarmenrealisasi_dtl2 (red2_nomor, red2_apv, red2_cab, red2_tanggal, red2_brg_kode, red2_jumlah)
        SELECT red_nomor, ?, ?, CURDATE(), red_brg_kode, red_jumlah
        FROM tgarmenrealisasi_dtl 
        WHERE red_nomor = ?
      `;
      // Insert massal dari hasil select detail
      await conn.query(qInsertDtl2, [capv, data.min_cab, noRealisasi]);
    }

    await conn.commit();
    return true;
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
};

module.exports = {
  getBrowseData,
  deleteData,
  closeData,
  ajukanPerubahan,
  checkUnapprovedRealisasi,
  checkUnapprovedRealisasi,
  approveRealisasi,
};
