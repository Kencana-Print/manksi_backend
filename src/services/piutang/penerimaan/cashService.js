const db = require("../../../config/database");
const tutupBukuService = require("../../tutupBukuService");

// --- 1. GET BROWSE ---
// --- 1. GET BROWSE ---
const getBrowseList = async (query, userFlags = {}) => {
  const { startDate, endDate } = query;

  const dStart =
    startDate ||
    new Date(new Date().getFullYear(), new Date().getMonth(), 1)
      .toISOString()
      .substring(0, 10);
  const dEnd = endDate || new Date().toISOString().substring(0, 10);

  const lihatCus = Number(userFlags?.lihatCus) === 1;

  const sql = `
    SELECT 
      t.Nomor, t.Cabang, b.kb_nama AS Bayar, t.Tanggal, t.tanggal_tempo AS Tempo,
      t.account, t.Debet, t.customer, t.Notes,
      IFNULL((
        SELECT IFNULL(
          IF(pin_acc="" AND pin_dipakai="", "WAIT",
          IF(pin_acc="Y" AND pin_dipakai="", "ACC",
          IF(pin_acc="Y" AND pin_dipakai="Y", "",
          IF(pin_acc="N", "TOLAK", "")))), 
        "")
        FROM tspk_pin5 
        WHERE pin_trs="PENERIMAAN CASH" AND pin_nomor=t.Nomor 
        ORDER BY pin_urut DESC LIMIT 1
      ), "") AS Ngedit
    FROM terima_bayar_debet t
    LEFT JOIN tkodebayar b ON b.kb_kode = t.kode
    WHERE t.kode LIKE "%CS%" 
      AND t.Tanggal >= ? 
      AND t.Tanggal <= ?
    ORDER BY t.Tanggal DESC
  `;

  const [rows] = await db.query(sql, [dStart, dEnd]);

  // ── Resolve nama customer (bisa multi-kode dipisah ';') ──
  if (lihatCus) {
    const allKodes = new Set();
    rows.forEach((r) => {
      (r.customer || "")
        .split(";")
        .map((c) => c.trim())
        .filter(Boolean)
        .forEach((k) => allKodes.add(k));
    });

    let namaMap = {};
    if (allKodes.size > 0) {
      const [custRows] = await db.query(
        `SELECT cus_kode, cus_nama FROM tcustomer WHERE cus_kode IN (?)`,
        [Array.from(allKodes)],
      );
      namaMap = custRows.reduce((acc, c) => {
        acc[c.cus_kode] = c.cus_nama;
        return acc;
      }, {});
    }

    rows.forEach((r) => {
      const kodes = (r.customer || "")
        .split(";")
        .map((c) => c.trim())
        .filter(Boolean);
      r.CustomerNama = kodes.map((k) => namaMap[k] || k).join(";");
    });
  } else {
    rows.forEach((r) => {
      r.CustomerNama = "";
    });
  }

  return rows;
};

// --- 2. DELETE CASH ---
const deleteCash = async (nomor) => {
  const [rows] = await db.query(
    `SELECT Tanggal FROM terima_bayar_debet WHERE Nomor = ?`,
    [nomor],
  );
  if (rows.length === 0) throw new Error("Data Cash tidak ditemukan.");

  const tglInput = new Date(rows[0].Tanggal);
  const zdtClose = await tutupBukuService.getTanggalTutupBuku();

  if (zdtClose && tglInput <= zdtClose) {
    throw new Error(
      "Transaksi tersebut sudah close (Tutup Buku). Tidak bisa dihapus.",
    );
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(`DELETE FROM terima_bayar_debet WHERE Nomor = ?`, [nomor]);
    await conn.commit();
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
};

// --- 3. CHECK KELAYAKAN PENGAJUAN PIN 5 ---
const checkKelayakanPengajuan = async (nomor) => {
  const [rows] = await db.query(
    `SELECT Tanggal FROM terima_bayar_debet WHERE Nomor = ?`,
    [nomor],
  );
  if (rows.length === 0) throw new Error("Data Cash tidak ditemukan.");

  const tglTrs = new Date(rows[0].Tanggal);
  tglTrs.setHours(0, 0, 0, 0);

  const tglCloseGlobal = await tutupBukuService.getTanggalTutupBuku();
  const tglCloseManual =
    await tutupBukuService.getManualTutupBuku("PENERIMAAN CASH");

  const finalCloseDate = tglCloseManual || tglCloseGlobal;
  if (finalCloseDate) finalCloseDate.setHours(0, 0, 0, 0);

  if (finalCloseDate && tglTrs >= finalCloseDate) {
    throw new Error("Tidak perlu pengajuan perubahan data.");
  }

  return true;
};

// --- 4. REQUEST PIN 5 ---
const requestPin5 = async (nomor, alasan, userKode) => {
  await checkKelayakanPengajuan(nomor);

  const [rows] = await db.query(
    `SELECT Tanggal, customer FROM terima_bayar_debet WHERE Nomor = ?`,
    [nomor],
  );
  const tglTrs = rows[0].Tanggal;
  const customer = rows[0].customer || "";

  const [pinRows] = await db.query(
    `SELECT pin_urut, pin_dipakai FROM tspk_pin5 WHERE pin_trs = "PENERIMAAN CASH" AND pin_nomor = ? ORDER BY pin_urut DESC LIMIT 1`,
    [nomor],
  );

  let urut = 1;
  if (pinRows.length > 0) {
    const lastPin = pinRows[0];
    urut = lastPin.pin_dipakai === "" ? lastPin.pin_urut : lastPin.pin_urut + 1;
  }

  const sql = `
    INSERT INTO tspk_pin5 (
      pin_trs, pin_nomor, pin_urut, pin_tgl_trs, pin_ket, pin_tgl_minta, pin_user_minta, pin_alasan
    ) VALUES (
      "PENERIMAAN CASH", ?, ?, ?, ?, NOW(), ?, ?
    ) ON DUPLICATE KEY UPDATE 
      pin_tgl_trs = VALUES(pin_tgl_trs), 
      pin_ket = VALUES(pin_ket), 
      pin_acc = "", 
      pin_tgl_minta = NOW(), 
      pin_user_minta = VALUES(pin_user_minta), 
      pin_alasan = VALUES(pin_alasan)
  `;

  await db.query(sql, [nomor, urut, tglTrs, customer, userKode, alasan]);
};

module.exports = {
  getBrowseList,
  deleteCash,
  checkKelayakanPengajuan,
  requestPin5,
};
