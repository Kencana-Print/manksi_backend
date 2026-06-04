const db = require("../../../config/database");
const tutupBukuService = require("../../tutupBukuService");

const checkKelayakanPengajuan = async (nomor) => {
  const [rows] = await db.query(
    `SELECT Tanggal FROM terima_bayar_debet WHERE Nomor = ?`,
    [nomor],
  );
  if (rows.length === 0) throw new Error("Data Giro tidak ditemukan.");

  const tglTrs = new Date(rows[0].Tanggal);
  tglTrs.setHours(0, 0, 0, 0); // Nolkan jam agar komparasi akurat

  // Ambil tanggal tutup buku (Manual per Modul & Global)
  const tglCloseGlobal = await tutupBukuService.getTanggalTutupBuku();
  const tglCloseManual =
    await tutupBukuService.getManualTutupBuku("PENERIMAAN GIRO");

  const finalCloseDate = tglCloseManual || tglCloseGlobal;
  if (finalCloseDate) finalCloseDate.setHours(0, 0, 0, 0);

  // LOGIKA DELPHI: Jika Tanggal Transaksi >= Tanggal Close, artinya BELUM di-close
  if (finalCloseDate && tglTrs >= finalCloseDate) {
    throw new Error("Tidak perlu pengajuan perubahan data.");
  }

  return true; // Layak mengajukan PIN
};

// --- 1. GET BROWSE ---
const getBrowseList = async (query) => {
  const { startDate, endDate } = query;

  // Default: Awal bulan s/d Hari ini
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
      IFNULL((
        SELECT IFNULL(
          IF(pin_acc="" AND pin_dipakai="", "WAIT",
          IF(pin_acc="Y" AND pin_dipakai="", "ACC",
          IF(pin_acc="Y" AND pin_dipakai="Y", "",
          IF(pin_acc="N", "TOLAK", "")))), 
        "")
        FROM tspk_pin5 
        WHERE pin_trs="PENERIMAAN GIRO" AND pin_nomor=t.Nomor 
        ORDER BY pin_urut DESC LIMIT 1
      ), "") AS Ngedit
    FROM terima_bayar_debet t
    LEFT JOIN tkodebayar b ON b.kb_kode = t.kode
    WHERE t.kode LIKE "%BG%" 
      AND t.Tanggal >= ? 
      AND t.Tanggal <= ?
    ORDER BY t.Tanggal DESC
  `;

  const [rows] = await db.query(sql, [dStart, dEnd]);
  return rows;
};

// --- 2. DELETE GIRO ---
const deleteGiro = async (nomor) => {
  const [rows] = await db.query(
    `SELECT Tanggal FROM terima_bayar_debet WHERE Nomor = ?`,
    [nomor],
  );
  if (rows.length === 0) throw new Error("Data Giro tidak ditemukan.");

  const tglInput = new Date(rows[0].Tanggal);
  const zdtClose = await tutupBukuService.getTanggalTutupBuku();

  // Validasi Tutup Buku
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

// --- 3. PENGAJUAN PERUBAHAN DATA (PIN 5) ---
const requestPin5 = async (nomor, alasan, userKode) => {
  await checkKelayakanPengajuan(nomor);

  // Ambil informasi Tanggal dan Customer untuk disimpan di PIN
  const [rows] = await db.query(
    `SELECT Tanggal, customer FROM terima_bayar_debet WHERE Nomor = ?`,
    [nomor],
  );
  if (rows.length === 0) throw new Error("Data tidak ditemukan.");

  const tglTrs = rows[0].Tanggal;
  const customer = rows[0].customer || "";

  // Cari urutan terakhir
  const [pinRows] = await db.query(
    `SELECT pin_urut, pin_dipakai FROM tspk_pin5 WHERE pin_trs = "PENERIMAAN GIRO" AND pin_nomor = ? ORDER BY pin_urut DESC LIMIT 1`,
    [nomor],
  );

  let urut = 1;
  if (pinRows.length > 0) {
    const lastPin = pinRows[0];
    urut = lastPin.pin_dipakai === "" ? lastPin.pin_urut : lastPin.pin_urut + 1;
  }

  // Insert on duplicate key update sesuai Delphi
  const sql = `
    INSERT INTO tspk_pin5 (
      pin_trs, pin_nomor, pin_urut, pin_tgl_trs, pin_ket, pin_tgl_minta, pin_user_minta, pin_alasan
    ) VALUES (
      "PENERIMAAN GIRO", ?, ?, ?, ?, NOW(), ?, ?
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
  deleteGiro,
  requestPin5,
  checkKelayakanPengajuan,
};
