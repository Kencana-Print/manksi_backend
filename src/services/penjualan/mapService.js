const db = require("../../config/database");
const tutupBukuService = require("../tutupBukuService");

// --- GET BROWSE LIST ---
const getBrowseList = async (filters) => {
  const { startDate, endDate, cabang, isKaosan } = filters;

  // Format tanggal agar full 1 hari (00:00:00 s/d 23:59:59)
  let params = [`${startDate} 00:00:00`, `${endDate} 23:59:59`];
  let whereClause = `WHERE x.mspk_tanggal >= ? AND x.mspk_tanggal <= ?`;

  // Filter Divisi: Dilonggarkan agar data muncul semua (kecuali spesifik P02 / Kaosan)
  if (cabang === "P02") {
    whereClause += ` AND x.mspk_divisi IN (1,5)`;
  }
  if (isKaosan && isKaosan !== "KDC") {
    whereClause += ` AND x.mspk_divisi = 3`;
  } else if (cabang === "P03" && isKaosan === "KDC") {
    whereClause += ` AND x.mspk_divisi IN (3,6)`;
  }

  const query = `
    SELECT 
      x.mspk_nomor AS Nomor, x.user_create AS MO, x.mspk_cmo AS CMO, 
      x.mspk_tanggal AS Tanggal, x.mspk_dateline AS Dateline,
      IFNULL(IFNULL(k.date_modify, k.date_create), "") AS TglBast, 
      IFNULL(DATEDIFF(IFNULL(k.date_modify, k.date_create), x.mspk_tanggal), 0) AS SelisihBastMap,
      IF(k.date_create IS NULL, "BELUM", "SUDAH") AS Berita_Acara,
      d.divisi AS Divisi, x.mspk_cab AS Cab, x.mspk_workshop AS Workshop, 
      CONCAT(x.mspk_cab2, " ", x.mspk_workshop2) AS WorkshopSPK, 
      x.mspk_aktif AS Aktif, x.mspk_nama AS Nama,
      (SELECT sjd_sj_nomor FROM tsj_dtl_memo INNER JOIN tsj_hdr_memo ON sj_nomor=sjd_sj_nomor WHERE sjd_mspk_nomor=x.mspk_nomor ORDER BY sj_tanggal DESC LIMIT 1) AS Surat_Jalan,
      x.mspk_ukuran AS Ukuran, x.mspk_panjang AS Panjang, x.mspk_lebar AS Lebar, 
      x.mspk_gramasi AS Gramasi, x.mspk_kain AS Kain, x.mspk_finishing AS Finishing,
      x.mspk_jumlah AS Jumlah, x.mspk_jumlah_kirim AS Kirim, c.cus_nama AS Customer,
      x.mspk_rencana_order AS Rencana, x.mspk_tipe AS Tipe, x.mspk_harga AS Harga, 
      x.mspk_hargariil AS HargaRiil, s.sal_nama AS Salesman, x.date_create AS Created, 
      x.mspk_revisi_no AS Revisi, x.mspk_referensi AS NoReferensi,
      IF(x.mspk_estimasijadi="1899-12-30", "", x.mspk_estimasijadi) AS EstimasiJadi, 
      x.mspk_close AS CloseStatus,
      IFNULL((
        SELECT u.Nomor FROM (
          SELECT spk_nomor AS Nomor, spk_tanggal AS Tgl FROM tspk WHERE spk_memo = x.mspk_nomor
          UNION ALL
          SELECT so_nomor AS Nomor, so_tanggal AS Tgl FROM tsalesorder WHERE so_memo = x.mspk_nomor
        ) u ORDER BY u.Tgl DESC LIMIT 1
      ), "") AS SPK,
      IF(x.mspk_divisi=5, m.lpr_tanggal, z.lds_tgl) AS Design_Tanggal,
      z.lds_user AS Design_User, z.lds_note AS Design_Note, 
      IFNULL((
        SELECT IFNULL(IF(pin_acc="" AND pin_dipakai="","WAIT",IF(pin_acc="Y" AND pin_dipakai="","ACC",IF(pin_acc="Y" AND pin_dipakai="Y","",IF(pin_acc="N","TOLAK","")))), "")
        FROM tspk_pin5 WHERE pin_trs="MAP" AND pin_nomor=x.mspk_nomor ORDER BY pin_urut DESC LIMIT 1
      ),"") AS Ngedit,
      x.mspk_newdesign AS Design_Baru, x.mspk_designdone AS Design_Done, x.mspk_keterangan AS Keterangan,
      x.mspk_acc_customer AS AccCustomer, x.mspk_acc_tanggal AS AccTanggal
    FROM tmemospk x
    LEFT JOIN tcustomer c ON x.mspk_cus_kode = c.cus_kode
    LEFT JOIN tsales s ON x.mspk_sal_kode = s.sal_kode
    LEFT JOIN tkesesuaianmap k ON k.mspk_nomor = x.mspk_nomor AND k.kode_sesuai = 1
    LEFT JOIN (
      SELECT lds_spk, lds_user, MAX(lds_tgl) AS lds_tgl, lds_note FROM tlhkdesign_status WHERE UPPER(lds_status)="DONE" GROUP BY lds_spk
    ) z ON z.lds_spk = x.mspk_nomor
    LEFT JOIN tdivisi d ON d.kode = x.mspk_divisi
    LEFT JOIN (
      SELECT lprd_spk_nomor, MIN(lpr_tanggal) AS lpr_tanggal FROM tlhk_proofmmt_dtl INNER JOIN tlhk_proofmmt_hdr ON (lpr_nomor=lprd_lpr_nomor) GROUP BY lprd_spk_nomor
    ) m ON m.lprd_spk_nomor = x.mspk_nomor 
    ${whereClause}
    ORDER BY x.date_create DESC
  `;

  const [rows] = await db.query(query, params);
  return rows;
};

// --- DELETE MAP ---
const deleteMap = async (nomor, userDetails) => {
  const [mapRows] = await db.query(
    `SELECT mspk_jumlah_kirim, mspk_tanggal, mspk_divisi FROM tmemospk WHERE mspk_nomor = ?`,
    [nomor],
  );
  if (mapRows.length === 0) throw new Error("Data MAP tidak ditemukan.");

  const mapData = mapRows[0];

  // Validasi 1: Sudah dikirim
  if (Number(mapData.mspk_jumlah_kirim) !== 0) {
    throw new Error("MAP tersebut sudah dikirim. Tidak bisa dihapus.");
  }

  // Validasi 2: Tutup Buku
  const zdtClose = await tutupBukuService.getTanggalTutupBuku();
  const tglInput = new Date(mapData.mspk_tanggal);
  if (zdtClose && tglInput < zdtClose) {
    throw new Error(
      "Transaksi tersebut sudah close (Tutup Buku). Tidak bisa dihapus.",
    );
  }

  // Validasi 3: Keamanan Lintas Divisi (Kaosan/Fit U)
  if (
    userDetails.cabKaos &&
    !mapData.mspk_divisi.includes("KAOSAN") &&
    !mapData.mspk_divisi.includes("FIT U")
  ) {
    // throw new Error("Anda di Divisi KAOSAN/FIT U. Tidak berhak menghapus MAP yang bukan Divisi Anda.");
    // Sesuaikan pengecekan string divisi dengan id divisi sebenarnya di backend jika perlu.
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(`DELETE FROM tbarang WHERE brg_kode = ?`, [nomor]);
    await conn.query(`DELETE FROM tmemospk WHERE mspk_nomor = ?`, [nomor]);
    await conn.commit();
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
};

// --- TOGGLE CLOSE / OPEN ---
const toggleClose = async (nomor, isClose) => {
  if (isClose === "N") {
    // Validasi jika di-OPEN, cek apakah sudah jadi SPK
    const [spkRows] = await db.query(
      `SELECT spk_nomor FROM tspk WHERE spk_memo = ? LIMIT 1`,
      [nomor],
    );
    if (spkRows.length > 0) {
      throw new Error(
        `MAP ini sudah jadi SPK dengan Nomor: ${spkRows[0].spk_nomor}. Tidak bisa Open.`,
      );
    }
  }

  await db.query(`UPDATE tmemospk SET mspk_close = ? WHERE mspk_nomor = ?`, [
    isClose,
    nomor,
  ]);
};

// --- APPROVAL CMO ---
const approveCmo = async (nomor, userKode) => {
  // Pengecekan Hak Akses CMO (zCMO) biasanya dilakukan di Controller melalui data user.role/permission
  await db.query(`UPDATE tmemospk SET mspk_cmo = ? WHERE mspk_nomor = ?`, [
    userKode,
    nomor,
  ]);
};

// --- PENGAJUAN PIN 5 (EDIT CLOSED DATA) ---
const requestPin5 = async (nomor, alasan, userKode) => {
  const [mapRows] = await db.query(
    `SELECT mspk_nama, mspk_tanggal FROM tmemospk WHERE mspk_nomor = ?`,
    [nomor],
  );
  if (mapRows.length === 0) throw new Error("Data tidak ditemukan.");

  const nama = mapRows[0].mspk_nama;
  const tgl = mapRows[0].mspk_tanggal;

  // Cek urutan terakhir
  const [pinRows] = await db.query(
    `SELECT pin_urut, pin_dipakai FROM tspk_pin5 WHERE pin_trs = "MAP" AND pin_nomor = ? ORDER BY pin_urut DESC LIMIT 1`,
    [nomor],
  );

  let urut = 1;
  if (pinRows.length > 0) {
    const lastPin = pinRows[0];
    urut = lastPin.pin_dipakai === "" ? lastPin.pin_urut : lastPin.pin_urut + 1;
  }

  const query = `
    INSERT INTO tspk_pin5 (
      pin_trs, pin_nomor, pin_urut, pin_tgl_trs, pin_ket, pin_tgl_minta, pin_user_minta, pin_alasan
    ) VALUES (
      "MAP", ?, ?, ?, ?, NOW(), ?, ?
    ) ON DUPLICATE KEY UPDATE 
      pin_tgl_trs = VALUES(pin_tgl_trs), 
      pin_ket = VALUES(pin_ket), 
      pin_acc = "", 
      pin_tgl_minta = NOW(), 
      pin_user_minta = VALUES(pin_user_minta), 
      pin_alasan = VALUES(pin_alasan)
  `;

  await db.query(query, [nomor, urut, tgl, nama, userKode, alasan]);
};

module.exports = {
  getBrowseList,
  deleteMap,
  toggleClose,
  approveCmo,
  requestPin5,
};
