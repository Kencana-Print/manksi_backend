const db = require("../../config/database");
const tutupBukuService = require("../tutupBukuService");

const generateNomor = async (jenis, tanggal) => {
  let prefix = "MBK";
  if (jenis === "ACCESORIES") prefix = "MBA";
  else if (jenis === "OBAT") prefix = "MBO";
  else if (jenis === "SPAREPART") prefix = "MBS";

  const year = new Date(tanggal).getFullYear().toString();
  const prefixYear = prefix + year;

  const [rows] = await db.query(
    `SELECT IFNULL(MAX(RIGHT(mb_nomor, 5)), 0) AS max_num 
     FROM tgarmenmintabeli_hdr 
     WHERE LEFT(mb_nomor, 7) = ?`,
    [prefixYear],
  );

  const nextNum = Number(rows[0].max_num) + 1;
  return `${prefixYear}${String(nextNum).padStart(5, "0")}`;
};

const getDetail = async (nomor) => {
  // 1. Ambil Header beserta Format Tanggal agar timezone aman
  const [hdr] = await db.query(
    `SELECT *, DATE_FORMAT(mb_tanggal, "%Y-%m-%d") AS mb_tanggal_fmt 
     FROM tgarmenmintabeli_hdr 
     WHERE mb_nomor = ?`,
    [nomor],
  );
  if (hdr.length === 0) throw new Error("Data permintaan tidak ditemukan.");

  // 2. Cek Status PIN (Meniru prosedur cekClose di Delphi)
  const [pin] = await db.query(
    `SELECT 
      IF(pin_acc="" AND pin_dipakai="", "WAIT",
      IF(pin_acc="Y" AND pin_dipakai="", "ACC",
      IF(pin_acc="Y" AND pin_dipakai="Y", "",
      IF(pin_acc="N", "TOLAK", "")))) AS status_pin
     FROM tspk_pin5 
     WHERE pin_trs="MINTA BELI GARMEN" AND pin_nomor=? 
     ORDER BY pin_urut DESC LIMIT 1`,
    [nomor],
  );
  const statusPin = pin.length > 0 ? pin[0].status_pin : "";

  // 3. Ambil Detail (Persis dengan query Delphi loaddataall)
  const [dtl] = await db.query(
    `SELECT 
      d.mbd_brg_kode AS kode, 
      IF(b.brg_note="", b.brg_nama, CONCAT(b.brg_nama, " - ", b.brg_note)) AS nama,
      b.brg_satuan AS satuan,
      d.mbd_ket AS ket,
      d.mbd_kegunaan AS kegunaan,
      d.mbd_jumlah AS jumlah,
      d.mbd_harga AS harga,
      (d.mbd_jumlah * d.mbd_harga) AS total,
      IFNULL((
        SELECT SUM(mbd2_jumlah) 
        FROM tgarmenmintabeli_dtl2 
        WHERE mbd2_nomor = d.mbd_nomor AND mbd2_brg_kode = d.mbd_brg_kode
      ), 0) AS realisasi
    FROM tgarmenmintabeli_dtl d
    LEFT JOIN tgarmen_brg b ON b.brg_kode = d.mbd_brg_kode
    WHERE d.mbd_nomor = ?
    ORDER BY d.mbd_nourut`,
    [nomor],
  );

  // 4. Tarik data riwayat realisasi (Untuk grid ke-2 di form)
  const [dtl2] = await db.query(
    `SELECT 
      mbd2_brg_kode AS kode,
      DATE_FORMAT(mbd2_tanggal, "%Y-%m-%d") AS tanggal,
      mbd2_jumlah AS jumlah,
      mbd2_ket AS ket
    FROM tgarmenmintabeli_dtl2 
    WHERE mbd2_nomor = ? 
    ORDER BY mbd2_tanggal`,
    [nomor],
  );

  return {
    header: hdr[0],
    statusPin: statusPin,
    items: dtl,
    realisasi: dtl2,
  };
};

const saveData = async (data, userKode, bagian, cabang) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    let nomor = data.header.mb_nomor;
    const isEdit = !!data.isEdit;

    // --- 1. VALIDASI TUTUP BUKU & PIN 5 ---
    const tglTrs = new Date(data.header.mb_tanggal);
    const zdtClose = await tutupBukuService.getTanggalTutupBuku();
    // Tambahkan pengambilan manual tutup buku khusus modul ini
    const zClose =
      await tutupBukuService.getManualTutupBuku("MINTA BELI GARMEN");

    let isAcc = false;

    if (isEdit) {
      const [pin] = await conn.query(
        `SELECT pin_acc, pin_dipakai FROM tspk_pin5 
         WHERE pin_trs="MINTA BELI GARMEN" AND pin_nomor=? 
         ORDER BY pin_urut DESC LIMIT 1`,
        [nomor],
      );
      if (
        pin.length > 0 &&
        pin[0].pin_acc === "Y" &&
        pin[0].pin_dipakai === ""
      ) {
        isAcc = true;
      }
    }

    // --- LOGIKA VALIDASI PERSIS DELPHI ---
    let isAllowed = false;

    if (!zClose) {
      // Jika zClose tidak ada, hanya cek periode bulan berjalan (zdtClose)
      const startOfCurrentPeriod = new Date(
        zdtClose.getFullYear(),
        zdtClose.getMonth(),
        1,
      );
      if (tglTrs >= startOfCurrentPeriod || isAcc) {
        isAllowed = true;
      }
    } else {
      // Jika zClose ada, tgl transaksi harus >= zClose
      if (tglTrs >= new Date(zClose) || isAcc) {
        isAllowed = true;
      }
    }

    // Fallback: Jika tglTrs lebih baru dari zdtClose global, biasanya diizinkan
    if (tglTrs >= zdtClose) isAllowed = true;

    if (!isAllowed) {
      throw new Error(
        "Anda tidak boleh input di tanggal periode yg sudah diclose.\nSilahkan minta approve perubahan data (PIN).",
      );
    }
    // -------------------------------------

    // --- 2. PROSES SIMPAN HEADER ---
    if (!isEdit) {
      // Pastikan generateNomor dipanggil dengan tglTrs agar tahun nomor sinkron dengan tgl input
      nomor = await generateNomor(data.header.mb_jenis, data.header.mb_tanggal);

      await conn.query(
        `INSERT INTO tgarmenmintabeli_hdr 
        (mb_jenis, mb_nomor, mb_tanggal, mb_mintake, mb_ket, mb_priority, mb_cab, mb_bagian, date_create, user_create)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?)`,
        [
          data.header.mb_jenis,
          nomor,
          data.header.mb_tanggal,
          data.header.mb_mintake,
          data.header.mb_ket,
          data.header.mb_priority,
          cabang,
          bagian,
          userKode,
        ],
      );
    } else {
      await conn.query(
        `UPDATE tgarmenmintabeli_hdr SET 
        mb_tanggal = ?, mb_mintake = ?, mb_ket = ?, mb_priority = ?, 
        date_modified = NOW(), user_modified = ?
        WHERE mb_nomor = ?`,
        [
          data.header.mb_tanggal,
          data.header.mb_mintake,
          data.header.mb_ket,
          data.header.mb_priority,
          userKode,
          nomor,
        ],
      );

      await conn.query(`DELETE FROM tgarmenmintabeli_dtl WHERE mbd_nomor = ?`, [
        nomor,
      ]);
    }

    // --- 3. PROSES SIMPAN DETAIL ---
    // Gunakan map atau loop untuk insert detail
    const detailQueries = data.items
      .filter((item) => item.kode && Number(item.jumlah) > 0)
      .map((item, index) => {
        return conn.query(
          `INSERT INTO tgarmenmintabeli_dtl 
          (mbd_nomor, mbd_brg_kode, mbd_jumlah, mbd_harga, mbd_kegunaan, mbd_ket, mbd_nourut)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            nomor,
            item.kode,
            Number(item.jumlah),
            Number(item.harga) || 0,
            item.kegunaan || "",
            item.ket || "",
            index + 1,
          ],
        );
      });

    await Promise.all(detailQueries);

    // --- 4. TANDAI PIN TERPAKAI JIKA ADA ---
    if (isAcc) {
      await conn.query(
        `UPDATE tspk_pin5 SET pin_dipakai="Y" 
         WHERE pin_trs="MINTA BELI GARMEN" AND pin_nomor=? AND pin_dipakai=""`,
        [nomor],
      );
    }

    await conn.commit();
    return { nomor };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
};

const saveRealisasi = async (nomor, kode, items) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    // 1. Hapus data realisasi lama untuk item ini (sesuai logic Delphi)
    await conn.query(
      `DELETE FROM tgarmenmintabeli_dtl2 WHERE mbd2_nomor = ? AND mbd2_brg_kode = ?`,
      [nomor, kode],
    );

    // 2. Insert data baru dari grid realisasi
    for (const item of items) {
      if (item.tanggal && Number(item.jumlah) > 0) {
        await conn.query(
          `INSERT INTO tgarmenmintabeli_dtl2 (mbd2_nomor, mbd2_tanggal, mbd2_brg_kode, mbd2_jumlah, mbd2_ket) 
           VALUES (?, ?, ?, ?, ?)`,
          [nomor, kode, item.tanggal, item.jumlah, item.ket || ""],
        );
      }
    }
    await conn.commit();
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
};

module.exports = { getDetail, saveData, saveRealisasi };
