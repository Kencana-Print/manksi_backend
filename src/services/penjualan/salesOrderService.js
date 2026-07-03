const db = require("../../config/database");
const tutupBukuService = require("../tutupBukuService");

// --- GET BROWSE LIST ---
const getBrowseList = async (filters) => {
  const { startDate, endDate, workshop, customer, userCabang } = filters;

  let params = [startDate, endDate];

  // 1. OPTIMASI TANGGAL: Hapus DATE() dan gunakan rentang waktu 00:00:00 s/d 23:59:59
  // Ini memastikan INDEX pada spk_tanggal 100% bekerja.
  let whereClause = `WHERE s.spk_tanggal >= CONCAT(?, ' 00:00:00') AND s.spk_tanggal <= CONCAT(?, ' 23:59:59')
    AND (
      (s.spk_is_so = 1 AND s.spk_nomor LIKE 'SO-%')
      OR (s.spk_is_so = 0 AND s.spk_nomor NOT LIKE 'SO-%' AND s.spk_nomor NOT LIKE 'SPK-%')
    )`;

  if (workshop && workshop !== "ALL" && workshop !== "") {
    whereClause += ` AND s.spk_cab = ?`;
    params.push(workshop);
  }
  if (customer) {
    whereClause += ` AND s.spk_cus_kode = ?`;
    params.push(customer);
  }
  if (
    userCabang &&
    userCabang !== "HO-" &&
    userCabang !== "ADMIN" &&
    userCabang !== ""
  ) {
    whereClause += ` AND (s.spk_cab = ? OR s.spk_cab = "" OR s.spk_cab IS NULL)`;
    params.push(userCabang);
  }

  const query = `
    SELECT 
      s.spk_nomor AS Nomor, s.user_create AS MO, s.spk_cmo AS CMO, s.spk_tanggal AS Tanggal, 
      s.spk_dateline AS Dateline, s.spk_statuskerja AS Kepentingan, v.divisi AS Divisi,
      s.spk_cus_kode AS KodeCustomer, c.cus_nama AS Customer, s.spk_nama AS Nama,
      s.spk_ukuran AS Ukuran, s.spk_cab AS Cab, TRIM(s.spk_workshop) AS Workshop,
      s.spk_pending AS Pending, s.spk_ketpending AS KetPending, s.spk_tipe AS Tipe,
      s.spk_panjang AS Panjang, s.spk_lebar AS Lebar, s.spk_gramasi AS Gramasi,
      s.spk_kain AS Kain, s.spk_finishing AS Finishing, s.spk_harga AS Harga,
      s.date_create AS Created, s.spk_jumlah AS Pesan,
      sl.sal_nama AS Sales, IFNULL(c1.cus_nama, "") AS GroupCustomer,
      s.spk_nomor_po AS PO, s.spk_ketpo AS KetPO, s.spk_tgl_po AS DatePO,
      s.spk_DatelinePO AS DatelinePO, IF(s.spk_close=1, "Closed", "Open") AS Status,
      s.spk_close_alasan AS AlasanClose, s.spk_pen_nomor AS NoPenawaran,
      s.spk_memo AS MAP, s.spk_repeat AS 'Repeat', s.spk_aktif AS Aktif,
      IFNULL(i.cusp_acc, "") AS Acc, IFNULL(j.pin_acc, "") AS AccH0,
      s.spk_pinjo AS AccJO, s.spk_accpending AS AccPending, s.spk_mppb AS MPPB,
      s.spk_newdesign AS Design_Baru, s.spk_designdone AS Design_Done,
      s.spk_keterangan AS Keterangan, s.spk_invdc AS 'Pesanan/Invoice',
      s.spk_is_so AS is_so,
      
      -- 2. HASIL LEFT JOIN PPIC: Cepat dan tidak melooping subquery
      IFNULL(ppic.spk_nomor, "") AS SpkPpic,
      DATE_FORMAT(ppic.spk_tanggal, '%Y-%m-%d') AS TglSpkPpic,
      
      IFNULL((SELECT pin_acc FROM tspk_pin5 WHERE pin_trs="SO" AND pin_nomor=s.spk_nomor ORDER BY pin_urut DESC LIMIT 1), "") AS pin_acc,
      IFNULL((SELECT pin_dipakai FROM tspk_pin5 WHERE pin_trs="SO" AND pin_nomor=s.spk_nomor ORDER BY pin_urut DESC LIMIT 1), "") AS pin_dipakai,
      IFNULL((SELECT IF(pin_acc="" AND pin_dipakai="","WAIT",IF(pin_acc="Y" AND pin_dipakai="","ACC",IF(pin_acc="N","TOLAK",""))) FROM tspk_pin5 WHERE pin_trs="SO" AND pin_nomor=s.spk_nomor ORDER BY pin_urut DESC LIMIT 1), "") AS Ngedit,
      IF(s.spk_divisi=5 AND (LENGTH(s.spk_repeat)>5 OR LENGTH(s.spk_memo)>5), l.lch_tanggal, k.lds_tgl) AS Design_Tanggal,
      k.lds_user AS Design_User, k.lds_note AS Design_Note,
      IF(ppic.spk_nomor IS NOT NULL, 1, 0) AS HasSpkPpic
    FROM tspk s
    LEFT JOIN tcustomer c ON s.spk_cus_kode = c.cus_kode
    LEFT JOIN tcustomer c1 ON c.cus_kodei = c1.cus_kode
    LEFT JOIN tsales sl ON s.spk_sal_kode = sl.sal_kode
    LEFT JOIN tdivisi v ON s.spk_divisi = v.kode
    LEFT JOIN tcustomer_pin i ON i.cusp_nomor = s.spk_nomor
    LEFT JOIN tspk_pin j ON j.pin_nomor = s.spk_nomor
    LEFT JOIN (SELECT lds_spk, lds_user, MAX(lds_tgl) AS lds_tgl, lds_note FROM tlhkdesign_status WHERE UPPER(lds_status)="DONE" GROUP BY lds_spk) k ON k.lds_spk = s.spk_nomor
    LEFT JOIN (SELECT lcd_spk_nomor, MIN(lch_tanggal) AS lch_tanggal FROM tlhk_cetakmmt_dtl INNER JOIN tlhk_cetakmmt_hdr ON (lch_nomor=lcd_lch_nomor) GROUP BY 1) l ON l.lcd_spk_nomor = s.spk_nomor
    
    -- 3. LEFT JOIN KE TABEL SENDIRI UNTUK SPK PPIC
    LEFT JOIN tspk ppic ON ppic.spk_so_ref = s.spk_nomor AND ppic.spk_is_so = 0
    
    ${whereClause}
    ORDER BY s.spk_tanggal DESC, s.spk_nomor DESC
  `;

  const [rows] = await db.query(query, params);
  return rows;
};

// --- GET DETAIL SIZE (Untuk Expand Baris) ---
const getSizes = async (nomor) => {
  const query = `
    SELECT 
      z.spks_nomor AS Nomor, 
      z.spks_size AS Size, 
      z.spks_qty AS Qty,
      IFNULL((SELECT SUM(d.stbjd_jumlah) FROM tstbj_dtl d WHERE d.stbjd_spk_nomor=z.spks_nomor AND d.stbjd_size=z.spks_size), 0) AS Stbj,
      (z.spks_qty - IFNULL((SELECT SUM(d.stbjd_jumlah) FROM tstbj_dtl d WHERE d.stbjd_spk_nomor=z.spks_nomor AND d.stbjd_size=z.spks_size), 0)) AS Kurang
    FROM tspk_size z
    WHERE z.spks_nomor = ?
    ORDER BY z.spks_size
  `;
  const [rows] = await db.query(query, [nomor]);
  return rows;
};

// --- DELETE SALES ORDER ---
const deleteOrder = async (nomor, userDetails) => {
  const [rows] = await db.query(
    `SELECT spk_tanggal, spk_divisi, spk_mppb, spk_jumlah_kirim, spk_is_so FROM tspk WHERE spk_nomor = ?`,
    [nomor],
  );
  if (rows.length === 0) throw new Error("Data tidak ditemukan.");
  if (!rows[0].spk_is_so) throw new Error("Nomor ini bukan Sales Order.");
  const data = rows[0];

  // 1. Validasi Tutup Buku
  const zdtClose = await tutupBukuService.getTanggalTutupBuku();
  if (zdtClose && new Date(data.spk_tanggal) < zdtClose) {
    throw new Error(
      "Transaksi tersebut sudah close (Tutup Buku). Tidak bisa dihapus.",
    );
  }

  // 2. Validasi Pengiriman
  if (Number(data.spk_jumlah_kirim) > 0) {
    throw new Error("Sudah ada pengiriman pada SO ini. Tidak bisa dihapus.");
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // Hapus di tbarang (referensi Delphi)
    await conn.query(`DELETE FROM tbarang WHERE brg_kode = ?`, [nomor]);

    // Hapus di tspk
    await conn.query(`DELETE FROM tspk WHERE spk_nomor = ?`, [nomor]);

    // Update MKB jika ada link MPPB
    if (data.spk_mppb) {
      await conn.query(
        `UPDATE tmkb_hdr SET mkb_spk_nomor="" WHERE mkb_mppb=? AND mkb_spk_nomor=?`,
        [data.spk_mppb, nomor],
      );
    }

    await conn.commit();
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
};

// --- TOGGLE CLOSE ---
const toggleStatus = async (nomor, alasan, isClose) => {
  const statusBit = isClose ? 1 : 0;
  await db.query(
    `UPDATE tspk SET spk_close = ?, spk_close_alasan = ? WHERE spk_nomor = ?`,
    [statusBit, alasan || "", nomor],
  );
};

// --- REQUEST PIN (EDIT DATA CLOSED) ---
const requestPin = async (nomor, alasan, userKode) => {
  const [spk] = await db.query(
    `SELECT spk_nama, spk_tanggal FROM tspk WHERE spk_nomor=?`,
    [nomor],
  );
  if (spk.length === 0) throw new Error("SO tidak ditemukan.");

  const [lastPin] = await db.query(
    `SELECT pin_urut, pin_dipakai FROM tspk_pin5 WHERE pin_trs="SO" AND pin_nomor=? ORDER BY pin_urut DESC LIMIT 1`,
    [nomor],
  );

  let urut = 1;
  if (lastPin.length > 0) {
    urut =
      lastPin[0].pin_dipakai === ""
        ? lastPin[0].pin_urut
        : lastPin[0].pin_urut + 1;
  }

  const query = `
    INSERT INTO tspk_pin5 (pin_trs, pin_nomor, pin_urut, pin_tgl_trs, pin_ket, pin_tgl_minta, pin_user_minta, pin_alasan)
    VALUES ("SO", ?, ?, ?, ?, NOW(), ?, ?)
    ON DUPLICATE KEY UPDATE pin_acc="", pin_tgl_minta=NOW(), pin_user_minta=VALUES(pin_user_minta), pin_alasan=VALUES(pin_alasan)
  `;
  await db.query(query, [
    nomor,
    urut,
    spk[0].spk_tanggal,
    spk[0].spk_nama,
    userKode,
    alasan,
  ]);
};

// --- APPROVE CMO ---
const approveCmo = async (nomor, userKode) => {
  // Pastikan data ada sebelum di-update
  const [rows] = await db.query(
    `SELECT spk_nomor FROM tspk WHERE spk_nomor = ?`,
    [nomor],
  );
  if (rows.length === 0) throw new Error("Data SO tidak ditemukan.");

  // Update field spk_cmo dengan kode user yang melakukan approve
  await db.query(`UPDATE tspk SET spk_cmo = ? WHERE spk_nomor = ?`, [
    userKode,
    nomor,
  ]);
};

const getPendingDesigns = async (startDate, endDate) => {
  const query = `
    SELECT 
      spk_nomor AS Nomor, 
      spk_nama AS Nama, 
      spk_designdone AS DesignDone
    FROM tspk 
    WHERE spk_newdesign = 'Y' 
      AND spk_designdone = 'N' 
      AND DATE(spk_tanggal) >= ? 
      AND DATE(spk_tanggal) <= ?
    ORDER BY spk_tanggal DESC, spk_nomor DESC
  `;
  const [rows] = await db.query(query, [startDate, endDate]);
  return rows;
};

const updateDesignStatus = async (nomorList) => {
  if (!nomorList || !Array.isArray(nomorList) || nomorList.length === 0) return;

  // Update massal menjadi 'Y' untuk nomor-nomor yang dicentang
  const query = `UPDATE tspk SET spk_designdone = 'Y' WHERE spk_nomor IN (?)`;
  await db.query(query, [nomorList]);
};

module.exports = {
  getBrowseList,
  getSizes,
  deleteOrder,
  toggleStatus,
  requestPin,
  approveCmo,
  getPendingDesigns,
  updateDesignStatus,
};
