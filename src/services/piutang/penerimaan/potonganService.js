const db = require("../../../config/database");
const tutupBukuService = require("../../tutupBukuService");

// --- 1. GET BROWSE ---
const getBrowseList = async (query) => {
  const { startDate, endDate } = query;

  const dStart =
    startDate ||
    new Date(new Date().getFullYear(), new Date().getMonth(), 1)
      .toISOString()
      .substring(0, 10);
  const dEnd = endDate || new Date().toISOString().substring(0, 10);

  const sql = `
    SELECT 
      t.Nomor, t.Cabang, b.kb_nama AS Bayar, t.Tanggal, t.tanggal_tempo AS Tempo,
      t.account, t.Debet, t.customer, t.Notes, 
      t.NoBukti, DATE_FORMAT(t.TglTrs, "%Y-%m-%d") AS TglTrs, t.Bruto, t.PPh,
      IFNULL((
        SELECT IFNULL(
          IF(pin_acc="" AND pin_dipakai="", "WAIT",
          IF(pin_acc="Y" AND pin_dipakai="", "ACC",
          IF(pin_acc="Y" AND pin_dipakai="Y", "",
          IF(pin_acc="N", "TOLAK", "")))), 
        "")
        FROM tspk_pin5 
        WHERE pin_trs="POTONGAN" AND pin_nomor=t.Nomor 
        ORDER BY pin_urut DESC LIMIT 1
      ), "") AS Ngedit
    FROM terima_bayar_debet t
    LEFT JOIN tkodebayar b ON b.kb_kode = t.kode
    WHERE t.kode LIKE "%PT%" 
      AND t.Tanggal >= ? 
      AND t.Tanggal <= ?
    ORDER BY t.Tanggal DESC
  `;

  const [rows] = await db.query(sql, [dStart, dEnd]);
  return rows;
};

// --- 2. DELETE POTONGAN ---
const deletePotongan = async (nomor) => {
  const [rows] = await db.query(
    `SELECT Tanggal FROM terima_bayar_debet WHERE Nomor = ?`,
    [nomor],
  );
  if (rows.length === 0) throw new Error("Data Potongan tidak ditemukan.");

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
  if (rows.length === 0) throw new Error("Data Potongan tidak ditemukan.");

  const tglTrs = new Date(rows[0].Tanggal);
  tglTrs.setHours(0, 0, 0, 0);

  const tglCloseGlobal = await tutupBukuService.getTanggalTutupBuku();
  const tglCloseManual = await tutupBukuService.getManualTutupBuku("POTONGAN");

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
    `SELECT pin_urut, pin_dipakai FROM tspk_pin5 WHERE pin_trs = "POTONGAN" AND pin_nomor = ? ORDER BY pin_urut DESC LIMIT 1`,
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
      "POTONGAN", ?, ?, ?, ?, NOW(), ?, ?
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

// --- 5. UPDATE PPh23 ---
const updatePph23 = async (nomor, payload) => {
  // Pengecekan account = '001' sesuai Delphi
  const [rows] = await db.query(
    `SELECT account FROM terima_bayar_debet WHERE Nomor = ?`,
    [nomor],
  );
  if (rows.length === 0) throw new Error("Data Potongan tidak ditemukan.");
  if (rows[0].account !== "001")
    throw new Error("Bukan PPh23. (Hanya Account 001 yang diizinkan)");

  const { noBukti, tglTrs, bruto, pph } = payload;

  await db.query(
    `UPDATE terima_bayar_debet SET NoBukti = ?, TglTrs = ?, Bruto = ?, PPh = ? WHERE Nomor = ?`,
    [
      noBukti,
      tglTrs || null,
      parseFloat(bruto || 0),
      parseFloat(pph || 0),
      nomor,
    ],
  );
};

module.exports = {
  getBrowseList,
  deletePotongan,
  checkKelayakanPengajuan,
  requestPin5,
  updatePph23,
};
