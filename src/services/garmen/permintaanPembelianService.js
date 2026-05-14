const db = require("../../config/database");
const tutupBukuService = require("../tutupBukuService");

const getBrowse = async (startDate, endDate, jenis, cabang, userBagian) => {
  let queryParams = [startDate, endDate];

  let query = `
    SELECT 
      h.mb_nomor AS Nomor,
      h.mb_jenis AS Jenis,
      DATE_FORMAT(h.mb_tanggal, "%Y-%m-%d") AS Tanggal,
      h.mb_ket AS Keterangan,
      h.mb_mintake AS MintaKe,
      h.mb_Priority AS Priority,
      IFNULL(h.user_create, "") AS Usr,
      h.mb_bagian AS Bagian,
      h.mb_cab AS Cab,
      DATE_FORMAT(h.date_create, "%Y-%m-%d %H:%i:%s") AS Created,
      DATE_FORMAT(h.date_modified, "%Y-%m-%d %H:%i:%s") AS Modified,
      IF(h.mb_status = "", IF(IFNULL((SELECT COUNT(mbd2_nomor) FROM tgarmenmintabeli_dtl2 WHERE mbd2_nomor=h.mb_nomor),0) = 0, "", "PROSES BELI"), h.mb_status) AS Status,
      IFNULL((
        SELECT 
          IF(pin_acc="" AND pin_dipakai="", "WAIT",
          IF(pin_acc="Y" AND pin_dipakai="", "ACC",
          IF(pin_acc="Y" AND pin_dipakai="Y", "",
          IF(pin_acc="N", "TOLAK", ""))))
        FROM tspk_pin5 
        WHERE pin_trs="MINTA BELI GARMEN" AND pin_nomor=h.mb_nomor 
        ORDER BY pin_urut DESC LIMIT 1
      ), "") AS Ngedit
    FROM tgarmenmintabeli_hdr h
    WHERE h.mb_tanggal BETWEEN ? AND ?
  `;

  // Filter Jenis
  if (jenis) {
    query += ` AND h.mb_jenis = ?`;
    queryParams.push(jenis);

    // Filter khusus SPAREPART untuk Bagian Tertentu (Sesuai Delphi)
    if (
      jenis === "SPAREPART" &&
      (userBagian === "TEKNISI" || userBagian === "IT")
    ) {
      query += ` AND h.mb_bagian = ?`;
      queryParams.push(userBagian);
    }
  }

  // Filter Cabang
  if (cabang && cabang !== "ALL") {
    query += ` AND h.mb_cab = ?`;
    queryParams.push(cabang);
  }

  query += ` ORDER BY h.mb_nomor DESC`;

  const [rows] = await db.query(query, queryParams);
  return rows;
};

const getBrowseDetail = async (nomor, jenis) => {
  // Tambahan kolom spesifikasi dan kegunaan khusus SPAREPART & ATK/RTK (Sesuai Delphi)
  const isKeteranganExtra = jenis === "SPAREPART" || jenis === "ATK/RTK";
  const extraCols = isKeteranganExtra
    ? `d.mbd_ket AS Spesifikasi, d.mbd_kegunaan AS Kegunaan,`
    : ``;

  const query = `
    SELECT 
      d.mbd_nomor AS Nomor,
      d.mbd_brg_kode AS Kode,
      IF(b.brg_note="", b.brg_nama, CONCAT(b.brg_nama, " - ", b.brg_note)) AS Nama,
      b.brg_satuan AS Satuan,
      ${extraCols}
      d.mbd_jumlah AS Jumlah,
      IFNULL((
        SELECT SUM(dd.bpbd_jumlah) 
        FROM tgarmenbpb_hdr hh
        INNER JOIN tgarmenbpb_dtl dd ON dd.bpbd_nomor = hh.bpb_nomor
        WHERE hh.bpb_mb_nomor = d.mbd_nomor AND dd.bpbd_brg_kode = d.mbd_brg_kode
      ), 0) AS Bpb,
      IFNULL((
        SELECT c.mbd2_ket 
        FROM tgarmenmintabeli_dtl2 c 
        WHERE c.mbd2_nomor = d.mbd_nomor AND c.mbd2_brg_kode = d.mbd_brg_kode 
        ORDER BY c.mbd2_tanggal DESC LIMIT 1
      ), "") AS KetPembelian
    FROM tgarmenmintabeli_dtl d
    LEFT JOIN tgarmen_brg b ON b.brg_kode = d.mbd_brg_kode
    WHERE d.mbd_nomor = ?
    ORDER BY d.mbd_nourut
  `;

  const [rows] = await db.query(query, [nomor]);
  return rows;
};

const deletePermintaan = async (nomor) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [hdr] = await conn.query(
      `SELECT mb_tanggal, mb_status, 
        IF(mb_status = "", IF(IFNULL((SELECT COUNT(mbd2_nomor) FROM tgarmenmintabeli_dtl2 WHERE mbd2_nomor=mb_nomor),0) = 0, "", "PROSES BELI"), mb_status) AS StatusHitung 
       FROM tgarmenmintabeli_hdr WHERE mb_nomor = ?`,
      [nomor],
    );

    if (hdr.length === 0) throw new Error("Data tidak ditemukan.");

    // Validasi Tutup Buku
    const zdtClose = await tutupBukuService.getTanggalTutupBuku();
    if (zdtClose && new Date(hdr[0].mb_tanggal) < zdtClose) {
      throw new Error("Transaksi tsb sudah close.\nTidak bisa dihapus.");
    }

    // Validasi Status (Jika sudah diproses/diclose tidak bisa dihapus)
    if (hdr[0].StatusHitung !== "") {
      throw new Error(`Sudah ${hdr[0].StatusHitung}\nTidak bisa dihapus.`);
    }

    // Eksekusi Hapus (Cascade aman jika dtl dihapus juga)
    await conn.query(`DELETE FROM tgarmenmintabeli_hdr WHERE mb_nomor = ?`, [
      nomor,
    ]);
    await conn.query(`DELETE FROM tgarmenmintabeli_dtl WHERE mbd_nomor = ?`, [
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

const closePermintaan = async (nomor) => {
  const [hdr] = await db.query(
    `SELECT mb_status FROM tgarmenmintabeli_hdr WHERE mb_nomor = ?`,
    [nomor],
  );

  if (hdr.length === 0) throw new Error("Data tidak ditemukan.");
  if (hdr[0].mb_status === "CLOSE" || hdr[0].mb_status === "DICLOSE") {
    throw new Error("Sudah close.");
  }

  await db.query(
    `UPDATE tgarmenmintabeli_hdr SET mb_status="DICLOSE" WHERE mb_nomor = ?`,
    [nomor],
  );
  return true;
};

const requestPinPerubahan = async (nomor, alasan, userKode) => {
  const [hdr] = await db.query(
    `SELECT mb_tanggal, mb_ket FROM tgarmenmintabeli_hdr WHERE mb_nomor = ?`,
    [nomor],
  );
  if (hdr.length === 0) throw new Error("Data tidak ditemukan.");

  const [pin] = await db.query(
    `SELECT pin_urut, pin_dipakai FROM tspk_pin5 WHERE pin_trs="MINTA BELI GARMEN" AND pin_nomor=? ORDER BY pin_urut DESC LIMIT 1`,
    [nomor],
  );

  let pinUrut = 1;
  if (pin.length > 0) {
    if (pin[0].pin_dipakai === "") {
      throw new Error("Pengajuan sebelumnya belum di-ACC atau dipakai.");
    } else {
      pinUrut = Number(pin[0].pin_urut) + 1;
    }
  }

  const upsertQuery = `
    INSERT INTO tspk_pin5 (
      pin_trs, pin_nomor, pin_urut, pin_tgl_trs, pin_ket, pin_tgl_minta, pin_user_minta, pin_alasan
    ) VALUES (
      "MINTA BELI GARMEN", ?, ?, ?, ?, NOW(), ?, ?
    ) ON DUPLICATE KEY UPDATE 
      pin_tgl_trs=?, pin_ket=?, pin_acc="", pin_tgl_minta=NOW(), pin_user_minta=?, pin_alasan=?
  `;

  await db.query(upsertQuery, [
    nomor,
    pinUrut,
    hdr[0].mb_tanggal,
    hdr[0].mb_ket,
    userKode,
    alasan,
    hdr[0].mb_tanggal,
    hdr[0].mb_ket,
    userKode,
    alasan,
  ]);

  return true;
};

const updateEstimasi = async (nomor, tanggal) => {
  const [hdr] = await db.query(
    `SELECT mb_nomor FROM tgarmenmintabeli_hdr WHERE mb_nomor = ?`,
    [nomor],
  );
  if (hdr.length === 0) throw new Error("Data tidak ditemukan.");

  await db.query(
    `UPDATE tgarmenmintabeli_hdr SET mb_estimasi = ? WHERE mb_nomor = ?`,
    [tanggal, nomor],
  );
  return true;
};

module.exports = {
  getBrowse,
  getBrowseDetail,
  deletePermintaan,
  closePermintaan,
  requestPinPerubahan,
  updateEstimasi,
};
