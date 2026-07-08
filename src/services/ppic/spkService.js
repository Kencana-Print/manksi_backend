const db = require("../../config/database");
const tutupBukuService = require("../tutupBukuService");

// Reuse query dari salesOrderService tapi tanpa filter is_so
// SPK = semua tspk (termasuk yang bukan SO)
const getBrowseList = async (filters) => {
  const { startDate, endDate, workshop, customer, userCabang } = filters;

  let params = [startDate, endDate];
  let whereClause = `WHERE DATE(x.Tanggal) >= ? AND DATE(x.Tanggal) <= ? AND x.IsSO = 0`;

  if (workshop && workshop !== "ALL" && workshop !== "") {
    whereClause += ` AND x.Cab = ?`;
    params.push(workshop);
  }
  if (customer) {
    whereClause += ` AND x.KodeCustomer = ?`;
    params.push(customer);
  }
  if (
    userCabang &&
    userCabang !== "HO-" &&
    userCabang !== "ADMIN" &&
    userCabang !== ""
  ) {
    whereClause += ` AND (x.Cab = ? OR x.Cab = "" OR x.Cab IS NULL)`;
    params.push(userCabang);
  }

  const query = `
    SELECT x.*,
      (x.Potong0 + x.Potong1) AS Potong,
      (x.QcPotong0 + x.QcPotong1) AS QcPotong,
      (IF(x.titik=0, 0, ROUND(x.Bordir0/x.titik) + ROUND(x.Bordir1/x.titik))) AS Bordir,
      (x.Cetak0 + x.Cetak1 + x.ctk1 + x.ctkm) AS Cetak,
      (x.QcCetak0 + x.QcCetak1) AS QcCetak,
      (x.dc0 + x.dc1) AS DC,
      (x.Jahit0 + x.Jahit1 + x.jht1) AS Jahit,
      (x.lipat0 + x.lipat1 + x.lpt1) AS Lipat,
      (x.Pesan - x.Jadi) AS Kurang_Jadi,
      (x.Pesan - (x.Potong0 + x.Potong1)) AS Kurang_Potong,
      (x.Pesan - (IF(x.titik=0, 0, ROUND(x.Bordir0/x.titik) + ROUND(x.Bordir1/x.titik)))) AS Kurang_Bordir,
      (x.Pesan - (x.Cetak0 + x.Cetak1 + x.ctk1 + x.ctkm)) AS Kurang_Cetak,
      (x.Pesan - (x.QcCetak0 + x.QcCetak1)) AS Kurang_QcCetak,
      (x.Pesan - (x.Jahit0 + x.Jahit1 + x.jht1)) AS Kurang_Jahit,
      (x.Pesan - (x.Lipat0 + x.Lipat1 + x.lpt1)) AS Kurang_Lipat
    FROM (
      SELECT 
        s.spk_nomor AS Nomor, s.user_create AS MO, s.spk_cmo AS CMO,
        s.spk_tanggal AS Tanggal, s.spk_dateline AS Dateline,
        s.spk_statuskerja AS Kepentingan, v.divisi AS Divisi,
        s.spk_cus_kode AS KodeCustomer, c.cus_nama AS Customer,
        s.spk_nama AS Nama, s.spk_ukuran AS Ukuran,
        s.spk_cab AS Cab, TRIM(s.spk_workshop) AS Workshop,
        s.spk_pending AS Pending, s.spk_ketpending AS KetPending,
        s.spk_tipe AS Tipe, s.spk_panjang AS Panjang,
        s.spk_lebar AS Lebar, s.spk_gramasi AS Gramasi,
        s.spk_kain AS Kain, s.spk_finishing AS Finishing,
        s.spk_harga AS Harga, s.spk_prasj AS Prasj,
        s.date_create AS Created, s.spk_jumlah AS Pesan,
        s.spk_jumlah_kirim AS Kirim,
        (s.spk_jumlah - s.spk_jumlah_kirim) AS Kurang,
        sl.sal_nama AS Sales,
        IFNULL(c1.cus_nama, "") AS GroupCustomer,
        s.spk_nomor_po AS PO, s.spk_ketpo AS KetPO,
        s.spk_tgl_po AS DatePO, s.spk_DatelinePO AS DatelinePO,
        IF(s.spk_close=1, "Closed", "Open") AS Status,
        s.spk_close_alasan AS AlasanClose,
        s.spk_pen_nomor AS NoPenawaran,
        s.spk_memo AS MAP, s.spk_repeat AS 'Repeat',
        s.spk_aktif AS Aktif, s.spk_is_so AS IsSO,
        IFNULL(i.cusp_acc, "") AS Acc,
        IFNULL(j.pin_acc, "") AS AccH0,
        s.spk_pinjo AS AccJO, s.spk_accpending AS AccPending,
        s.spk_mppb AS MPPB,
        s.spk_newdesign AS Design_Baru,
        s.spk_designdone AS Design_Done,
        s.spk_keterangan AS Keterangan,
        s.spk_invdc AS 'Pesanan/Invoice',
        IFNULL((SELECT COUNT(*) FROM tproofgarmen_hdr h LEFT JOIN tproofgarmen_dtl d ON d.pfd_nomor=h.pf_nomor WHERE h.pf_lini="BORDIR" AND h.pf_spk_nomor=IF(s.spk_memo<>"",s.spk_memo,s.spk_nomor)),0) AS titik,
        IFNULL((SELECT SUM(mpd_jumlah) FROM tmutasiproduksi_dtl WHERE mpd_bhn_kode="LL-000400" AND mpd_spk=s.spk_nomor AND mpd_gdgp_asal IN ("GP015","GP001")),0) AS Potong0,
        IFNULL((SELECT SUM(mpd_jumlah) FROM tmutasiproduksi_dtl WHERE mpd_bhn_kode="LL-000400" AND mpd_spk=s.spk_nomor AND mpd_gdgp_asal IN ("GP012","GP021")),0) AS QcPotong0,
        IFNULL((SELECT SUM(mpd_jumlah) FROM tmutasiproduksi_dtl WHERE mpd_bhn_kode IN ("LL-000237","LL-000407","LL-000412","LL-000413","LL-000447","LL-000448","LL-000450","LL-000451","LL-000452") AND mpd_spk=s.spk_nomor AND mpd_gdgp_asal IN ("GP014","GP016")),0) AS Bordir0,
        IFNULL((SELECT SUM(mpd_jumlah) FROM tmutasiproduksi_dtl WHERE mpd_bhn_kode="LL-000400" AND mpd_spk=s.spk_nomor AND mpd_gdgp_asal IN ("GP017","GP002")),0) AS Cetak0,
        IFNULL((SELECT SUM(mpd_jumlah) FROM tmutasiproduksi_dtl WHERE mpd_bhn_kode="LL-000400" AND mpd_spk=s.spk_nomor AND mpd_gdgp_asal IN ("GP010","GP022")),0) AS QcCetak0,
        IFNULL((SELECT SUM(mpd_jumlah) FROM tmutasiproduksi_dtl WHERE mpd_bhn_kode="LL-000400" AND mpd_spk=s.spk_nomor AND mpd_gdgp_asal IN ("GP032")),0) AS dc0,
        IFNULL((SELECT SUM(mpd_jumlah) FROM tmutasiproduksi_dtl WHERE mpd_bhn_kode="LL-000400" AND mpd_spk=s.spk_nomor AND mpd_gdgp_asal IN ("GP018","GP003")),0) AS Jahit0,
        IFNULL((SELECT SUM(mpd_jumlah) FROM tmutasiproduksi_dtl WHERE mpd_bhn_kode="LL-000400" AND mpd_spk=s.spk_nomor AND mpd_gdgp_asal IN ("GP019","GP004")),0) AS Lipat0,
        IFNULL((SELECT SUM(bpjd_Jumlah) FROM tbpj_dtl WHERE bpjd_bhn_kode="LL-000400" AND bpjd_spk=s.spk_nomor AND bpjd_gdgp_asal IN ("GP015","GP001")),0) AS Potong1,
        IFNULL((SELECT SUM(bpjd_Jumlah) FROM tbpj_dtl WHERE bpjd_bhn_kode="LL-000400" AND bpjd_spk=s.spk_nomor AND bpjd_gdgp_asal IN ("GP012","GP021")),0) AS QcPotong1,
        IFNULL((SELECT SUM(bpjd_Jumlah) FROM tbpj_dtl WHERE bpjd_bhn_kode IN ("LL-000237","LL-000407","LL-000412","LL-000413","LL-000447","LL-000448","LL-000450","LL-000451","LL-000452") AND bpjd_spk=s.spk_nomor AND bpjd_gdgp_asal IN ("GP016","GP014")),0) AS Bordir1,
        IFNULL((SELECT SUM(bpjd_Jumlah) FROM tbpj_dtl WHERE bpjd_bhn_kode="LL-000400" AND bpjd_spk=s.spk_nomor AND bpjd_gdgp_asal IN ("GP017","GP002")),0) AS Cetak1,
        IFNULL((SELECT SUM(bpjd_Jumlah) FROM tbpj_dtl WHERE bpjd_bhn_kode="LL-000400" AND bpjd_spk=s.spk_nomor AND bpjd_gdgp_asal IN ("GP010","GP022")),0) AS QcCetak1,
        IFNULL((SELECT SUM(bpjd_Jumlah) FROM tbpj_dtl WHERE bpjd_bhn_kode="LL-000400" AND bpjd_spk=s.spk_nomor AND bpjd_gdgp_asal IN ("GP032")),0) AS dc1,
        IFNULL((SELECT SUM(bpjd_Jumlah) FROM tbpj_dtl WHERE bpjd_bhn_kode="LL-000400" AND bpjd_spk=s.spk_nomor AND bpjd_gdgp_asal IN ("GP018","GP003")),0) AS Jahit1,
        IFNULL((SELECT SUM(bpjd_Jumlah) FROM tbpj_dtl WHERE bpjd_bhn_kode="LL-000400" AND bpjd_spk=s.spk_nomor AND bpjd_gdgp_asal IN ("GP019","GP004")),0) AS Lipat1,
        IFNULL((SELECT SUM(lcd_qty_Cetak) FROM tlhk_cetak_dtl WHERE lcd_spk_nomor=s.spk_nomor),0) AS ctk1,
        IFNULL((SELECT SUM(ljd_qty_jahit) FROM tlhk_jahit_dtl WHERE ljd_spk_nomor=s.spk_nomor),0) AS jht1,
        IFNULL((SELECT SUM(lld_qty_lipat) FROM tlhk_lipat_dtl WHERE lld_spk_nomor=s.spk_nomor),0) AS lpt1,
        IFNULL(l.lcd_qty_Cetak, 0) AS ctkm,
        s.spk_jumlah_jadi AS Jadi,
        IFNULL((SELECT pin_acc FROM tspk_pin5 WHERE pin_trs="SPK" AND pin_nomor=s.spk_nomor ORDER BY pin_urut DESC LIMIT 1),"") AS pin_acc,
        IFNULL((SELECT pin_dipakai FROM tspk_pin5 WHERE pin_trs="SPK" AND pin_nomor=s.spk_nomor ORDER BY pin_urut DESC LIMIT 1),"") AS pin_dipakai,
        IFNULL((SELECT IF(pin_acc="" AND pin_dipakai="","WAIT",IF(pin_acc="Y" AND pin_dipakai="","ACC",IF(pin_acc="N","TOLAK",""))) FROM tspk_pin5 WHERE pin_trs="SPK" AND pin_nomor=s.spk_nomor ORDER BY pin_urut DESC LIMIT 1),"") AS Ngedit,
        IFNULL(s.spk_cetak_count, 0) AS CetakCount,
        IFNULL((
          SELECT IF(pin_acc="Y" AND pin_dipakai="", "ACC_READY",
                IF(pin_acc="", "WAIT",
                IF(pin_acc="N", "TOLAK", "")))
          FROM tspk_pin5
          WHERE pin_trs="SPK CETAK ULANG" AND pin_nomor=s.spk_nomor
          ORDER BY pin_urut DESC LIMIT 1
        ), "") AS CetakApprovalStatus,
        IF(s.spk_divisi=5 AND (LENGTH(s.spk_repeat)>5 OR LENGTH(s.spk_memo)>5), l.lch_tanggal, k.lds_tgl) AS Design_Tanggal,
        k.lds_user AS Design_User, k.lds_note AS Design_Note
      FROM tspk s
      LEFT JOIN tcustomer c ON s.spk_cus_kode = c.cus_kode
      LEFT JOIN tcustomer c1 ON c.cus_kodei = c1.cus_kode
      LEFT JOIN tsales sl ON s.spk_sal_kode = sl.sal_kode
      LEFT JOIN tdivisi v ON s.spk_divisi = v.kode
      LEFT JOIN tcustomer_pin i ON i.cusp_nomor = s.spk_nomor
      LEFT JOIN tspk_pin j ON j.pin_nomor = s.spk_nomor
      LEFT JOIN (
        SELECT lds_spk, lds_user, MAX(lds_tgl) AS lds_tgl, lds_note
        FROM tlhkdesign_status WHERE UPPER(lds_status)="DONE" GROUP BY lds_spk
      ) k ON k.lds_spk = s.spk_nomor
      LEFT JOIN (
        SELECT lcd_spk_nomor,
          SUM(IFNULL(lcd_qty_Cetak,0)) AS lcd_qty_Cetak,
          MIN(lch_tanggal) AS lch_tanggal
        FROM tlhk_cetakmmt_dtl
        INNER JOIN tlhk_cetakmmt_hdr ON lch_nomor=lcd_lch_nomor
        GROUP BY 1
      ) l ON l.lcd_spk_nomor = s.spk_nomor
    ) x
    ${whereClause}
    ORDER BY x.Tanggal DESC, x.Nomor DESC
  `;

  const [rows] = await db.query(query, params);
  return rows;
};

const getSizes = async (nomor) => {
  const query = `
    SELECT 
      z.spks_nomor AS Nomor,
      z.spks_size AS Size,
      z.spks_qty AS Qty,
      IFNULL((
        SELECT SUM(d.stbjd_jumlah) FROM tstbj_dtl d
        WHERE d.stbjd_spk_nomor=z.spks_nomor AND d.stbjd_size=z.spks_size
      ), 0) AS Stbj,
      (z.spks_qty - IFNULL((
        SELECT SUM(d.stbjd_jumlah) FROM tstbj_dtl d
        WHERE d.stbjd_spk_nomor=z.spks_nomor AND d.stbjd_size=z.spks_size
      ), 0)) AS Kurang
    FROM tspk_size z
    WHERE z.spks_nomor = ?
    ORDER BY z.spks_size
  `;
  const [rows] = await db.query(query, [nomor]);
  return rows;
};

const deleteSpk = async (nomor, userDetails) => {
  const [rows] = await db.query(
    `SELECT spk_tanggal, spk_mppb, spk_jumlah_kirim FROM tspk WHERE spk_nomor = ?`,
    [nomor],
  );
  if (rows.length === 0) throw new Error("Data tidak ditemukan.");
  const data = rows[0];

  const zdtClose = await tutupBukuService.getTanggalTutupBuku();
  if (zdtClose && new Date(data.spk_tanggal) < zdtClose) {
    throw new Error("Transaksi sudah close (Tutup Buku). Tidak bisa dihapus.");
  }
  if (Number(data.spk_jumlah_kirim) > 0) {
    throw new Error("Sudah ada pengiriman pada SPK ini. Tidak bisa dihapus.");
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(`DELETE FROM tspk_komponen_potong WHERE sk_nomor = ?`, [
      nomor,
    ]);
    await conn.query(
      `DELETE FROM tspk_komponen_cetak_bordir WHERE kcb_nomor = ?`,
      [nomor],
    );
    await conn.query(
      `DELETE FROM tspk_keterangan_khusus WHERE kk_spk_nomor = ?`,
      [nomor],
    );
    await conn.query(`DELETE FROM tspk_layout_proses WHERE lp_spk_nomor = ?`, [
      nomor,
    ]);
    await conn.query(`DELETE FROM tspk_layout_header WHERE lh_spk_nomor = ?`, [
      nomor,
    ]);
    await conn.query(`DELETE FROM tspk_size WHERE spks_nomor = ?`, [nomor]);
    await conn.query(`DELETE FROM tbarang WHERE brg_kode = ?`, [nomor]);
    await conn.query(`DELETE FROM tspk WHERE spk_nomor = ?`, [nomor]);
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

const toggleStatus = async (nomor, alasan, isClose) => {
  const statusBit = isClose ? 1 : 0;
  await db.query(
    `UPDATE tspk SET spk_close = ?, spk_close_alasan = ? WHERE spk_nomor = ?`,
    [statusBit, alasan || "", nomor],
  );
};

const requestPin = async (nomor, alasan, userKode) => {
  const [spk] = await db.query(
    `SELECT spk_nama, spk_tanggal FROM tspk WHERE spk_nomor=?`,
    [nomor],
  );
  if (spk.length === 0) throw new Error("SPK tidak ditemukan.");

  const [lastPin] = await db.query(
    `SELECT pin_urut, pin_dipakai FROM tspk_pin5
     WHERE pin_trs="SPK" AND pin_nomor=? ORDER BY pin_urut DESC LIMIT 1`,
    [nomor],
  );

  let urut = 1;
  if (lastPin.length > 0) {
    urut =
      lastPin[0].pin_dipakai === ""
        ? lastPin[0].pin_urut
        : lastPin[0].pin_urut + 1;
  }

  await db.query(
    `INSERT INTO tspk_pin5
       (pin_trs, pin_nomor, pin_urut, pin_tgl_trs, pin_ket, pin_tgl_minta, pin_user_minta, pin_alasan)
     VALUES ("SPK", ?, ?, ?, ?, NOW(), ?, ?)
     ON DUPLICATE KEY UPDATE
       pin_acc="", pin_tgl_minta=NOW(),
       pin_user_minta=VALUES(pin_user_minta),
       pin_alasan=VALUES(pin_alasan)`,
    [nomor, urut, spk[0].spk_tanggal, spk[0].spk_nama, userKode, alasan],
  );
};

const approveCmo = async (nomor, userKode) => {
  const [rows] = await db.query(
    `SELECT spk_nomor FROM tspk WHERE spk_nomor = ?`,
    [nomor],
  );
  if (rows.length === 0) throw new Error("Data SPK tidak ditemukan.");
  await db.query(`UPDATE tspk SET spk_cmo = ? WHERE spk_nomor = ?`, [
    userKode,
    nomor,
  ]);
};

// ─────────────────────────────────────────────────────────
// CETAK SPK — dibatasi 1x bebas, cetak ke-2 dst wajib approval
// (mirip pola pin5, tapi HARD-BLOCK: dicegah sampai di-ACC,
// bukan soft-flag seperti Mutasi Produksi NoPlan)
// ─────────────────────────────────────────────────────────
const checkPrintPermission = async (nomor) => {
  const [rows] = await db.query(
    `SELECT spk_cetak_count FROM tspk WHERE spk_nomor = ?`,
    [nomor],
  );
  if (rows.length === 0) throw new Error("SPK tidak ditemukan.");
  const count = Number(rows[0].spk_cetak_count) || 0;

  if (count === 0) {
    return { allowed: true, count, needApproval: false, approvalStatus: "" };
  }

  // Sudah pernah dicetak minimal 1x — cek approval pending/ACC terbaru
  const [pinRows] = await db.query(
    `SELECT pin_acc, pin_dipakai FROM tspk_pin5
     WHERE pin_trs = 'SPK CETAK ULANG' AND pin_nomor = ?
     ORDER BY pin_urut DESC LIMIT 1`,
    [nomor],
  );
  if (pinRows.length === 0) {
    return { allowed: false, count, needApproval: true, approvalStatus: "" };
  }
  const pin = pinRows[0];
  if (pin.pin_acc === "Y" && pin.pin_dipakai === "") {
    // Sudah di-ACC dan belum dipakai — boleh cetak 1x, akan ditandai
    // "dipakai" begitu recordPrint dipanggil setelah cetak berhasil.
    return { allowed: true, count, needApproval: false, approvalStatus: "ACC" };
  }
  const status =
    pin.pin_acc === "N" ? "TOLAK" : pin.pin_acc === "" ? "WAIT" : "";
  return { allowed: false, count, needApproval: true, approvalStatus: status };
};

const requestPrintApproval = async (nomor, alasan, userKode) => {
  const [spk] = await db.query(
    `SELECT spk_nama, spk_tanggal FROM tspk WHERE spk_nomor = ?`,
    [nomor],
  );
  if (spk.length === 0) throw new Error("SPK tidak ditemukan.");

  const [lastPin] = await db.query(
    `SELECT pin_urut, pin_dipakai FROM tspk_pin5
     WHERE pin_trs = 'SPK CETAK ULANG' AND pin_nomor = ?
     ORDER BY pin_urut DESC LIMIT 1`,
    [nomor],
  );
  let urut = 1;
  if (lastPin.length > 0) {
    urut =
      lastPin[0].pin_dipakai === ""
        ? lastPin[0].pin_urut
        : lastPin[0].pin_urut + 1;
  }

  await db.query(
    `INSERT INTO tspk_pin5
       (pin_trs, pin_nomor, pin_urut, pin_tgl_trs, pin_ket,
        pin_tgl_minta, pin_user_minta, pin_alasan, pin_acc, pin_dipakai)
     VALUES ('SPK CETAK ULANG', ?, ?, ?, ?, NOW(), ?, ?, '', '')
     ON DUPLICATE KEY UPDATE
       pin_acc = '', pin_dipakai = '', pin_tgl_minta = NOW(),
       pin_user_minta = VALUES(pin_user_minta),
       pin_alasan = VALUES(pin_alasan)`,
    [nomor, urut, spk[0].spk_tanggal, spk[0].spk_nama, userKode, alasan || ""],
  );
};

// Dipanggil SETELAH cetak berhasil dibuka (increment counter, tandai
// approval terpakai kalau cetak ini menggunakan approval)
const recordPrint = async (nomor) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(
      `UPDATE tspk SET spk_cetak_count = spk_cetak_count + 1, spk_iscetak = 'Y'
       WHERE spk_nomor = ?`,
      [nomor],
    );
    await conn.query(
      `UPDATE tspk_pin5 SET pin_dipakai = 'Y'
       WHERE pin_trs = 'SPK CETAK ULANG' AND pin_nomor = ? AND pin_acc = 'Y' AND pin_dipakai = ''`,
      [nomor],
    );
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
};

module.exports = {
  getBrowseList,
  getSizes,
  deleteSpk,
  toggleStatus,
  requestPin,
  approveCmo,
  checkPrintPermission,
  requestPrintApproval,
  recordPrint,
};
