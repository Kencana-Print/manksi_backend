const db = require("../../config/database");
const tutupBukuService = require("../tutupBukuService");

// --- 1. GET BROWSE MASTER ---
const getBrowse = async (query) => {
  const { startDate, endDate } = query;

  const dStart =
    startDate ||
    new Date(new Date().getFullYear(), new Date().getMonth(), 1)
      .toISOString()
      .substring(0, 10);
  const dEnd = endDate || new Date().toISOString().substring(0, 10);

  const sql = `
    SELECT 
      h.nomor AS Nomor,
      h.cabang AS Cabang,
      DATE_FORMAT(h.tanggal, "%d-%m-%Y") AS Tanggal,
      h.tanggal AS TglAsli,
      h.Notes,
      IFNULL((
        SELECT 
          IFNULL(
            IF(pin_acc = "" AND pin_dipakai = "", "WAIT",
              IF(pin_acc = "Y" AND pin_dipakai = "", "ACC",
                IF(pin_acc = "Y" AND pin_dipakai = "Y", "",
                  IF(pin_acc = "N", "TOLAK", "")
                )
              )
            ), 
          "")
        FROM tspk_pin5 
        WHERE pin_trs = "PELUNASAN PIUTANG" AND pin_nomor = h.nomor 
        ORDER BY pin_urut DESC 
        LIMIT 1
      ), "") AS Ngedit
    FROM piutang_kredit_header h
    WHERE h.tanggal >= ? AND h.tanggal <= ?
    ORDER BY h.tanggal ASC, h.nomor ASC
  `;

  const [rows] = await db.query(sql, [dStart, dEnd]);
  return rows;
};

// --- 2. GET BROWSE DETAIL ---
const getDetail = async (nomor) => {
  const sql = `
    SELECT 
      d.Nomor,
      d.Nota,
      DATE_FORMAT(i.INV_tanggal, "%d-%m-%Y") AS TglInvoice,
      c.cus_nama AS Customer,
      c.cus_alamat AS Alamat,
      b.kb_nama AS Bayar,
      d.No_bukti,
      d.Kredit,
      d.Notes
    FROM piutang_kredit_detail d
    LEFT JOIN piutang_kredit_header h ON h.nomor = d.nomor
    LEFT JOIN tinv_hdr i ON i.INV_nomor = d.nota
    LEFT JOIN tcustomer c ON c.cus_kode = i.inv_cus_kode
    LEFT JOIN tkodebayar b ON b.kb_kode = d.kode
    WHERE d.Nomor = ?
    ORDER BY d.nomor ASC
  `;

  const [rows] = await db.query(sql, [nomor]);
  return rows;
};

// --- 3. GET ALL DETAIL (UNTUK EXPORT) ---
const getAllDetail = async (query) => {
  const { startDate, endDate } = query;
  const dStart =
    startDate ||
    new Date(new Date().getFullYear(), new Date().getMonth(), 1)
      .toISOString()
      .substring(0, 10);
  const dEnd = endDate || new Date().toISOString().substring(0, 10);

  const sql = `
    SELECT 
      h.nomor AS NomorPelunasan,
      DATE_FORMAT(h.tanggal, "%d-%m-%Y") AS TglPelunasan,
      d.Nota AS NotaInvoice,
      DATE_FORMAT(i.INV_tanggal, "%d-%m-%Y") AS TglInvoice,
      c.cus_nama AS Customer,
      c.cus_alamat AS Alamat,
      b.kb_nama AS TipeBayar,
      d.No_bukti AS NoBukti,
      d.Kredit AS NominalKredit,
      d.Notes AS NotesDetail
    FROM piutang_kredit_detail d
    LEFT JOIN piutang_kredit_header h ON h.nomor = d.nomor
    LEFT JOIN tinv_hdr i ON i.INV_nomor = d.nota
    LEFT JOIN tcustomer c ON c.cus_kode = i.inv_cus_kode
    LEFT JOIN tkodebayar b ON b.kb_kode = d.kode
    WHERE h.tanggal >= ? AND h.tanggal <= ?
    ORDER BY h.tanggal ASC, h.nomor ASC
  `;
  const [rows] = await db.query(sql, [dStart, dEnd]);
  return rows;
};

// --- 4. DELETE PELUNASAN (DENGAN VALIDASI CLOSING) ---
const deletePelunasan = async (nomor) => {
  const [rows] = await db.query(
    `SELECT tanggal FROM piutang_kredit_header WHERE nomor = ?`,
    [nomor],
  );
  if (rows.length === 0) throw new Error("Data pelunasan tidak ditemukan.");

  const tglTrs = new Date(rows[0].tanggal);
  tglTrs.setHours(0, 0, 0, 0);

  // 1. Ambil tgl_close dari tversi
  const [verRows] = await db.query(
    `SELECT tgl_close FROM tversi WHERE aplikasi = "MANKSI" LIMIT 1`,
  );
  let ztglclose = 0;
  if (verRows.length > 0) ztglclose = parseInt(verRows[0].tgl_close, 10) || 0;

  // 2. Batas closing: Bulan depan dari tanggal transaksi
  // JS Date otomatis menyesuaikan tahun jika bulan lebih dari 11
  const limitDate = new Date(
    tglTrs.getFullYear(),
    tglTrs.getMonth() + 1,
    ztglclose,
  );
  limitDate.setHours(0, 0, 0, 0);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const zCloseManual =
    await tutupBukuService.getManualTutupBuku("PELUNASAN PIUTANG");

  let isClosed = false;
  if (zCloseManual) {
    zCloseManual.setHours(0, 0, 0, 0);
    if (tglTrs < zCloseManual) isClosed = true;
  } else {
    // Logika Delphi: (EncodeDate < cgetcurdate)
    if (limitDate < today) isClosed = true;
  }

  if (isClosed) {
    throw new Error(
      "Transaksi tersebut sudah close (Tutup Buku). Tidak bisa dihapus.",
    );
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(`DELETE FROM piutang_kredit_detail WHERE nomor = ?`, [
      nomor,
    ]);
    await conn.query(`DELETE FROM piutang_kredit_header WHERE nomor = ?`, [
      nomor,
    ]);
    await conn.query(
      `DELETE FROM tspk_pin5 WHERE pin_trs = "PELUNASAN PIUTANG" AND pin_nomor = ?`,
      [nomor],
    );
    await conn.commit();
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
};

// --- 5. CHECK KELAYAKAN PENGAJUAN PIN 5 ---
const checkKelayakanPengajuan = async (nomor) => {
  const [rows] = await db.query(
    `SELECT tanggal FROM piutang_kredit_header WHERE nomor = ?`,
    [nomor],
  );
  if (rows.length === 0) throw new Error("Data pelunasan tidak ditemukan.");

  const tglTrs = new Date(rows[0].tanggal);
  tglTrs.setHours(0, 0, 0, 0);

  const [verRows] = await db.query(
    `SELECT tgl_close FROM tversi WHERE aplikasi = "MANKSI" LIMIT 1`,
  );
  let ztglclose = 0;
  if (verRows.length > 0) ztglclose = parseInt(verRows[0].tgl_close, 10) || 0;

  const limitDate = new Date(
    tglTrs.getFullYear(),
    tglTrs.getMonth() + 1,
    ztglclose,
  );
  limitDate.setHours(0, 0, 0, 0);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const zCloseManual =
    await tutupBukuService.getManualTutupBuku("PELUNASAN PIUTANG");

  let isClosed = false;
  if (zCloseManual) {
    zCloseManual.setHours(0, 0, 0, 0);
    if (tglTrs < zCloseManual) isClosed = true;
  } else {
    if (limitDate < today) isClosed = true;
  }

  if (!isClosed) {
    // JIKA BELUM CLOSE, TOLAK PENGAJUAN (Nanti muncul Toast di Frontend)
    throw new Error(
      "Tidak perlu pengajuan perubahan data. Transaksi belum ter-close bulanan.",
    );
  }

  return true; // JIKA SUDAH CLOSE, BERI LAMPU HIJAU (Modal PIN 5 Terbuka)
};

// --- 6. REQUEST PIN 5 (PENGAJUAN EDIT/HAPUS) ---
const requestPin5 = async (nomor, alasan, userKode) => {
  await checkKelayakanPengajuan(nomor);

  const [rows] = await db.query(
    `SELECT tanggal, Notes FROM piutang_kredit_header WHERE nomor = ?`,
    [nomor],
  );
  const tglTrs = rows[0].tanggal;
  const notes = rows[0].Notes || "";

  const [pinRows] = await db.query(
    `SELECT pin_urut, pin_dipakai, pin_alasan FROM tspk_pin5 WHERE pin_trs = "PELUNASAN PIUTANG" AND pin_nomor = ? ORDER BY pin_urut DESC LIMIT 1`,
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
      "PELUNASAN PIUTANG", ?, ?, ?, ?, NOW(), ?, ?
    ) ON DUPLICATE KEY UPDATE 
      pin_tgl_trs = VALUES(pin_tgl_trs), 
      pin_ket = VALUES(pin_ket), 
      pin_acc = "", 
      pin_tgl_minta = NOW(), 
      pin_user_minta = VALUES(pin_user_minta), 
      pin_alasan = VALUES(pin_alasan)
  `;

  await db.query(sql, [nomor, urut, tglTrs, notes, userKode, alasan]);
};

module.exports = {
  getBrowse,
  getDetail,
  getAllDetail,
  deletePelunasan,
  checkKelayakanPengajuan,
  requestPin5,
};
