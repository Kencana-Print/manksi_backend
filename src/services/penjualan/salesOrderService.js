const db = require("../../config/database");
const tutupBukuService = require("../tutupBukuService");

// ============================================================
// HELPER: cari lokasi fisik SO — "new" (tsalesorder) atau
// "legacy" (tspk, data lama pre-migrasi). Dipakai oleh semua
// fungsi tulis (delete/close/pin/approve) supaya tau harus
// UPDATE/DELETE ke tabel yang mana.
// ============================================================
const resolveSoLocation = async (nomor) => {
  const [rows] = await db.query(
    `SELECT 'new' AS src FROM tsalesorder WHERE so_nomor = ?
     UNION ALL
     SELECT 'legacy' AS src FROM tspk WHERE spk_nomor = ? AND spk_is_so = 1
     LIMIT 1`,
    [nomor, nomor],
  );
  return rows[0]?.src || null;
};

// --- GET BROWSE LIST ---
// Sumber "s" adalah UNION ALL: SO lama (tspk, spk_is_so=1) + SO baru
// (tsalesorder), kolom di-alias supaya namanya identik dengan tspk
// asli — sehingga seluruh JOIN & SELECT di bawah TIDAK perlu diubah.
const getBrowseList = async (filters) => {
  const {
    startDate,
    endDate,
    workshop,
    customer,
    userCabang,
    userKode,
    userDivisi,
    isCmo,
    isCmo3,
    canLihatCus,
    canLihatHarga,
  } = filters;
  let params = [startDate, endDate, startDate, endDate];

  let whereClause = `WHERE 1=1`;

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
    userCabang !== "" &&
    userKode !== "DINDUN"
  ) {
    // Deteksi apakah user adalah LUTFI atau user punya flag CMO dan berada di Divisi 3
    const isCmoDivisi3 =
      userKode === "LUTFI" || (String(userDivisi) === "3" && (isCmo || isCmo3))
        ? 1
        : 0;

    // Tambahkan klausa OR: Jika user adalah CMO Divisi 3, tampilkan semua data yang Divisinya berawalan '3' tanpa melihat cabang
    whereClause += ` AND (s.spk_cab = ? OR s.spk_cab = "" OR s.spk_cab IS NULL OR s.user_create = ? OR (LEFT(s.spk_divisi, 1) = '3' AND ? = 1))`;
    params.push(userCabang, userKode || "", isCmoDivisi3);
  }

  const custNameCol = canLihatCus
    ? "c.cus_nama AS Customer,"
    : "NULL AS Customer,";
  const groupCusCol = canLihatCus
    ? 'IFNULL(c1.cus_nama, "") AS GroupCustomer,'
    : "NULL AS GroupCustomer,";
  const hargaCol = canLihatHarga ? "s.spk_harga AS Harga," : "NULL AS Harga,";

  const query = `
    SELECT 
      s.spk_nomor AS Nomor, s.user_create AS MO, s.spk_cmo AS CMO, s.spk_tanggal AS Tanggal, 
      s.spk_dateline AS Dateline, s.spk_statuskerja AS Kepentingan, v.divisi AS Divisi,
      s.spk_cus_kode AS KodeCustomer, ${custNameCol} s.spk_nama AS Nama,
      s.spk_ukuran AS Ukuran, s.spk_cab AS Cab, TRIM(s.spk_workshop) AS Workshop,
      s.spk_pending AS Pending, s.spk_ketpending AS KetPending, s.spk_tipe AS Tipe,
      s.spk_panjang AS Panjang, s.spk_lebar AS Lebar, s.spk_gramasi AS Gramasi,
      s.spk_kain AS Kain, s.spk_finishing AS Finishing, ${hargaCol}
      s.date_create AS Created, s.spk_jumlah AS Pesan,
      sl.sal_nama AS Sales, ${groupCusCol}
      s.spk_nomor_po AS PO, s.spk_ketpo AS KetPO, s.spk_tgl_po AS DatePO,
      s.spk_DatelinePO AS DatelinePO, IF(s.spk_close=1, "Closed", "Open") AS Status,
      s.spk_close_alasan AS AlasanClose, s.spk_pen_nomor AS NoPenawaran,
      s.spk_memo AS MAP, s.spk_repeat AS 'Repeat', s.spk_aktif AS Aktif,
      IFNULL(i.cusp_acc, "") AS Acc, IFNULL(j.pin_acc, "") AS AccH0,
      s.spk_pinjo AS AccJO, s.spk_accpending AS AccPending, s.spk_mppb AS MPPB,
      s.spk_newdesign AS Design_Baru, s.spk_designdone AS Design_Done,
      s.spk_keterangan AS Keterangan, s.spk_invdc AS 'Pesanan/Invoice',
      s.spk_ketbatal AS StsPembatalan,
      s.spk_is_so AS is_so,

      IFNULL(ppic.spk_nomor, "") AS SpkPpic,
      DATE_FORMAT(ppic.spk_tanggal, '%Y-%m-%d') AS TglSpkPpic,

      IFNULL((SELECT pin_acc FROM tspk_pin5 WHERE pin_trs="SO" AND pin_nomor=s.spk_nomor ORDER BY pin_urut DESC LIMIT 1), "") AS pin_acc,
      IFNULL((SELECT pin_dipakai FROM tspk_pin5 WHERE pin_trs="SO" AND pin_nomor=s.spk_nomor ORDER BY pin_urut DESC LIMIT 1), "") AS pin_dipakai,
      IFNULL((SELECT IF(pin_acc="" AND pin_dipakai="","WAIT",IF(pin_acc="Y" AND pin_dipakai="","ACC",IF(pin_acc="N","TOLAK",""))) FROM tspk_pin5 WHERE pin_trs="SO" AND pin_nomor=s.spk_nomor ORDER BY pin_urut DESC LIMIT 1), "") AS Ngedit,
      IF(s.spk_divisi=5 AND (LENGTH(s.spk_repeat)>5 OR LENGTH(s.spk_memo)>5), l.lch_tanggal, k.lds_tgl) AS Design_Tanggal,
      k.lds_user AS Design_User, k.lds_note AS Design_Note,
      IF(ppic.spk_nomor IS NOT NULL, 1, 0) AS HasSpkPpic
    FROM (
      SELECT
        spk_nomor, user_create, spk_cmo, spk_tanggal, spk_dateline, spk_statuskerja,
        spk_divisi, spk_cus_kode, spk_nama, spk_ukuran, spk_cab, spk_workshop,
        spk_pending, spk_ketpending, spk_tipe, spk_panjang, spk_lebar, spk_gramasi,
        spk_kain, spk_finishing, spk_harga, date_create, spk_jumlah, spk_sal_kode,
        spk_nomor_po, spk_ketpo, spk_tgl_po, spk_DatelinePO, spk_close, spk_close_alasan,
        spk_pen_nomor, spk_memo, spk_repeat, spk_aktif, spk_pinjo, spk_accpending,
        spk_mppb, spk_newdesign, spk_designdone, spk_keterangan, spk_invdc, spk_is_so,
        spk_ketbatal
      FROM tspk
      WHERE spk_tanggal >= CONCAT(?, ' 00:00:00') AND spk_tanggal <= CONCAT(?, ' 23:59:59')
        AND (
          (spk_is_so = 1 AND spk_nomor LIKE 'SO-%')
          OR (
            spk_is_so = 0
            AND spk_nomor NOT LIKE 'SO-%'
            AND (spk_so_ref IS NULL OR spk_so_ref = '')
          )
        )
      UNION ALL
      SELECT
        so_nomor AS spk_nomor, user_create, so_cmo AS spk_cmo, so_tanggal AS spk_tanggal,
        so_dateline AS spk_dateline, so_statuskerja AS spk_statuskerja,
        so_divisi AS spk_divisi, so_cus_kode AS spk_cus_kode, so_nama AS spk_nama,
        so_ukuran AS spk_ukuran, so_cab AS spk_cab, so_workshop AS spk_workshop,
        so_pending AS spk_pending, so_ketpending AS spk_ketpending, so_tipe AS spk_tipe,
        so_panjang AS spk_panjang, so_lebar AS spk_lebar, so_gramasi AS spk_gramasi,
        so_kain AS spk_kain, so_finishing AS spk_finishing, so_harga AS spk_harga,
        date_create, so_jumlah AS spk_jumlah, so_sal_kode AS spk_sal_kode,
        so_nomor_po AS spk_nomor_po, so_ketpo AS spk_ketpo, so_tgl_po AS spk_tgl_po,
        so_datelinepo AS spk_DatelinePO, so_close AS spk_close, so_close_alasan AS spk_close_alasan,
        so_pen_nomor AS spk_pen_nomor, so_memo AS spk_memo, so_repeat AS spk_repeat,
        so_aktif AS spk_aktif, so_pinjo AS spk_pinjo, so_accpending AS spk_accpending,
        so_mppb AS spk_mppb, so_newdesign AS spk_newdesign, so_designdone AS spk_designdone,
        so_keterangan AS spk_keterangan, so_invdc AS spk_invdc, 1 AS spk_is_so,
        so_ketbatal AS spk_ketbatal
      FROM tsalesorder
      WHERE so_tanggal >= CONCAT(?, ' 00:00:00') AND so_tanggal <= CONCAT(?, ' 23:59:59')
    ) s
    LEFT JOIN tcustomer c ON s.spk_cus_kode = c.cus_kode
    LEFT JOIN tcustomer c1 ON c.cus_kodei = c1.cus_kode
    LEFT JOIN tsales sl ON s.spk_sal_kode = sl.sal_kode
    LEFT JOIN tdivisi v ON s.spk_divisi = v.kode
    LEFT JOIN tcustomer_pin i ON i.cusp_nomor = s.spk_nomor
    LEFT JOIN tspk_pin j ON j.pin_nomor = s.spk_nomor
    LEFT JOIN (SELECT lds_spk, lds_user, MAX(lds_tgl) AS lds_tgl, lds_note FROM tlhkdesign_status WHERE UPPER(lds_status)="DONE" GROUP BY lds_spk) k ON k.lds_spk = s.spk_nomor
    LEFT JOIN (SELECT lcd_spk_nomor, MIN(lch_tanggal) AS lch_tanggal FROM tlhk_cetakmmt_dtl INNER JOIN tlhk_cetakmmt_hdr ON (lch_nomor=lcd_lch_nomor) GROUP BY 1) l ON l.lcd_spk_nomor = s.spk_nomor
    LEFT JOIN tspk ppic ON ppic.spk_so_ref = s.spk_nomor AND ppic.spk_is_so = 0

    ${whereClause}
    ORDER BY s.spk_tanggal DESC, s.spk_nomor DESC
  `;
  const [rows] = await db.query(query, params);
  return rows;
};

// --- GET DETAIL SIZE (Untuk Expand Baris) ---
// Cek tsalesorder_size dulu (SO baru); kalau kosong, fallback ke
// tspk_size (SO lama). Kolom Stbj/Kurang tetap generic by nomor
// string, tidak terpengaruh lokasi fisik header.
const getSizes = async (nomor) => {
  const [newRows] = await db.query(
    `SELECT 
       z.sos_so_nomor AS Nomor, 
       z.sos_size AS Size, 
       z.sos_qty AS Qty,
       IFNULL((SELECT SUM(d.stbjd_jumlah) FROM tstbj_dtl d WHERE d.stbjd_spk_nomor=z.sos_so_nomor AND d.stbjd_size=z.sos_size), 0) AS Stbj,
       (z.sos_qty - IFNULL((SELECT SUM(d.stbjd_jumlah) FROM tstbj_dtl d WHERE d.stbjd_spk_nomor=z.sos_so_nomor AND d.stbjd_size=z.sos_size), 0)) AS Kurang
     FROM tsalesorder_size z
     WHERE z.sos_so_nomor = ?
     ORDER BY z.sos_size`,
    [nomor],
  );
  if (newRows.length > 0) return newRows;

  const [legacyRows] = await db.query(
    `SELECT 
       z.spks_nomor AS Nomor, 
       z.spks_size AS Size, 
       z.spks_qty AS Qty,
       IFNULL((SELECT SUM(d.stbjd_jumlah) FROM tstbj_dtl d WHERE d.stbjd_spk_nomor=z.spks_nomor AND d.stbjd_size=z.spks_size), 0) AS Stbj,
       (z.spks_qty - IFNULL((SELECT SUM(d.stbjd_jumlah) FROM tstbj_dtl d WHERE d.stbjd_spk_nomor=z.spks_nomor AND d.stbjd_size=z.spks_size), 0)) AS Kurang
     FROM tspk_size z
     WHERE z.spks_nomor = ?
     ORDER BY z.spks_size`,
    [nomor],
  );
  return legacyRows;
};

// --- DELETE SALES ORDER ---
const deleteOrder = async (nomor, userDetails) => {
  const loc = await resolveSoLocation(nomor);
  if (!loc) throw new Error("Data tidak ditemukan.");

  const table = loc === "new" ? "tsalesorder" : "tspk";
  const prefix = loc === "new" ? "so_" : "spk_";
  const [rows] = await db.query(
    `SELECT ${prefix}tanggal AS tanggal, ${prefix}mppb AS mppb, ${prefix}jumlah_kirim AS jumlah_kirim
     FROM ${table} WHERE ${prefix}nomor = ?`,
    [nomor],
  );
  const data = rows[0];

  const zdtClose = await tutupBukuService.getTanggalTutupBuku();
  if (zdtClose && new Date(data.tanggal) < zdtClose) {
    throw new Error(
      "Transaksi tersebut sudah close (Tutup Buku). Tidak bisa dihapus.",
    );
  }
  if (Number(data.jumlah_kirim) > 0) {
    throw new Error("Sudah ada pengiriman pada SO ini. Tidak bisa dihapus.");
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(`DELETE FROM tbarang WHERE brg_kode = ?`, [nomor]);

    if (loc === "new") {
      await conn.query(
        `DELETE FROM tsalesorder_alokasi WHERE soa_so_nomor = ?`,
        [nomor],
      );
      await conn.query(
        `DELETE FROM tsalesorder_kaosan WHERE sok_so_nomor = ?`,
        [nomor],
      );
      await conn.query(`DELETE FROM tsalesorder_size WHERE sos_so_nomor = ?`, [
        nomor,
      ]);
      await conn.query(`DELETE FROM tsalesorder WHERE so_nomor = ?`, [nomor]);
    } else {
      await conn.query(`DELETE FROM tspk WHERE spk_nomor = ?`, [nomor]);
    }

    if (data.mppb) {
      await conn.query(
        `UPDATE tmkb_hdr SET mkb_spk_nomor="" WHERE mkb_mppb=? AND mkb_spk_nomor=?`,
        [data.mppb, nomor],
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
  const loc = await resolveSoLocation(nomor);
  if (!loc) throw new Error("Data tidak ditemukan.");
  const statusBit = isClose ? 1 : 0;

  if (loc === "new") {
    await db.query(
      `UPDATE tsalesorder SET so_close = ?, so_close_alasan = ? WHERE so_nomor = ?`,
      [statusBit, alasan || "", nomor],
    );
  } else {
    await db.query(
      `UPDATE tspk SET spk_close = ?, spk_close_alasan = ? WHERE spk_nomor = ?`,
      [statusBit, alasan || "", nomor],
    );
  }
};

// --- REQUEST PIN (EDIT DATA CLOSED) ---
// Tabel tspk_pin5 sendiri tidak ikut migrasi (generic by nomor
// string), hanya SELECT nama/tanggal SO-nya yang perlu branching.
const requestPin = async (nomor, alasan, userKode) => {
  const loc = await resolveSoLocation(nomor);
  if (!loc) throw new Error("SO tidak ditemukan.");

  const [spk] =
    loc === "new"
      ? await db.query(
          `SELECT so_nama AS spk_nama, so_tanggal AS spk_tanggal FROM tsalesorder WHERE so_nomor=?`,
          [nomor],
        )
      : await db.query(
          `SELECT spk_nama, spk_tanggal FROM tspk WHERE spk_nomor=?`,
          [nomor],
        );

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
  const loc = await resolveSoLocation(nomor);
  if (!loc) throw new Error("Data SO tidak ditemukan.");

  if (loc === "new") {
    await db.query(`UPDATE tsalesorder SET so_cmo = ? WHERE so_nomor = ?`, [
      userKode,
      nomor,
    ]);
  } else {
    await db.query(`UPDATE tspk SET spk_cmo = ? WHERE spk_nomor = ?`, [
      userKode,
      nomor,
    ]);
  }
};

// --- PENDING DESIGN — UNION dua sumber, sama seperti browse list ---
const getPendingDesigns = async (startDate, endDate) => {
  const query = `
    SELECT Nomor, Nama, DesignDone FROM (
      SELECT spk_nomor AS Nomor, spk_nama AS Nama, spk_designdone AS DesignDone, spk_tanggal AS Tanggal
      FROM tspk
      WHERE spk_is_so = 1 AND spk_nomor LIKE 'SO-%'
        AND spk_newdesign = 'Y' AND spk_designdone = 'N'
        AND DATE(spk_tanggal) >= ? AND DATE(spk_tanggal) <= ?
      UNION ALL
      SELECT so_nomor AS Nomor, so_nama AS Nama, so_designdone AS DesignDone, so_tanggal AS Tanggal
      FROM tsalesorder
      WHERE so_newdesign = 'Y' AND so_designdone = 'N'
        AND DATE(so_tanggal) >= ? AND DATE(so_tanggal) <= ?
    ) x
    ORDER BY x.Tanggal DESC, x.Nomor DESC
  `;
  const [rows] = await db.query(query, [
    startDate,
    endDate,
    startDate,
    endDate,
  ]);
  return rows;
};

// --- UPDATE DESIGN STATUS — massal, perlu branching per nomor
// karena satu batch checklist bisa berisi campuran SO lama & baru ---
const updateDesignStatus = async (nomorList) => {
  if (!nomorList || !Array.isArray(nomorList) || nomorList.length === 0) return;

  const [newRows] = await db.query(
    `SELECT so_nomor FROM tsalesorder WHERE so_nomor IN (?)`,
    [nomorList],
  );
  const newNomors = newRows.map((r) => r.so_nomor);
  const legacyNomors = nomorList.filter((n) => !newNomors.includes(n));

  if (newNomors.length > 0) {
    await db.query(
      `UPDATE tsalesorder SET so_designdone = 'Y' WHERE so_nomor IN (?)`,
      [newNomors],
    );
  }
  if (legacyNomors.length > 0) {
    await db.query(
      `UPDATE tspk SET spk_designdone = 'Y' WHERE spk_nomor IN (?)`,
      [legacyNomors],
    );
  }
};

// ─────────────────────────────────────────────────────────
// PEMBATALAN SPK/SO — sesuai Delphi ufrmPembatalanSpk.pas ✅
// Diakses dari klik-kanan browse SO → "Form Pembatalan SPK".
// ─────────────────────────────────────────────────────────

// LOAD DATA — dua mode:
//  - spkNomor diisi → mulai pengajuan baru (checkbox kosong semua)
//  - fbNomor diisi  → buka pengajuan yang sudah ada (mode approval/readonly)
const getPembatalanDetail = async (fbNomor, spkNomor) => {
  if (spkNomor) {
    const loc = await resolveSoLocation(spkNomor);
    if (!loc) throw new Error("Data SPK/SO tidak ditemukan.");

    const [rows] =
      loc === "new"
        ? await db.query(
            `SELECT so_nomor AS spk_nomor, so_tanggal AS spk_tanggal,
                    so_cus_kode AS spk_cus_kode, so_nama AS spk_nama,
                    so_jumlah AS spk_jumlah, c.cus_nama AS cus_nama
             FROM tsalesorder s
             LEFT JOIN tcustomer c ON c.Cus_kode = s.so_cus_kode
             WHERE s.so_nomor = ?`,
            [spkNomor],
          )
        : await db.query(
            `SELECT s.spk_nomor, s.spk_tanggal, s.spk_cus_kode, s.spk_nama,
                    s.spk_jumlah, c.cus_nama
             FROM tspk s
             LEFT JOIN tcustomer c ON c.Cus_kode = s.spk_cus_kode
             WHERE s.spk_nomor = ?`,
            [spkNomor],
          );
    if (!rows[0]) throw new Error("Data SPK/SO tidak ditemukan.");

    return {
      fb_nomor: "",
      ...rows[0],
      fb_abubah: "",
      fb_abmap: "",
      fb_abbahan: "",
      fb_abqty: "",
      fb_ablain: "",
      fb_ablain2: "",
      fb_abket: "",
      fb_spbelum: "",
      fb_spcuting: "",
      fb_spsewing: "",
      fb_spfinishing: "",
      fb_spsudah: "",
      fb_sbbeli: "",
      fb_sbdireksi: "",
      fb_sbsup: "",
      fb_sbsudah: "",
      fb_dampak: "",
      fb_rtbatal: "",
      fb_rtalih: "",
      fb_rtsisa: "",
      fb_rtlain: "",
      fb_rtlain2: "",
      fb_user_create: "",
      Created: "",
      fb_apv: "",
      fb_apv_user: "",
      Approved: "",
    };
  }

  const [fbRows] = await db.query(
    `SELECT * FROM tspk_formbatal WHERE fb_nomor = ?`,
    [fbNomor],
  );
  if (!fbRows[0]) throw new Error("Data pengajuan tidak ditemukan.");
  const fb = fbRows[0];

  const loc = await resolveSoLocation(fb.fb_spk);
  const [soRows] =
    loc === "new"
      ? await db.query(
          `SELECT so_nomor AS spk_nomor, so_tanggal AS spk_tanggal,
                  so_cus_kode AS spk_cus_kode, so_nama AS spk_nama,
                  so_jumlah AS spk_jumlah, c.cus_nama AS cus_nama
           FROM tsalesorder s
           LEFT JOIN tcustomer c ON c.Cus_kode = s.so_cus_kode
           WHERE s.so_nomor = ?`,
          [fb.fb_spk],
        )
      : await db.query(
          `SELECT s.spk_nomor, s.spk_tanggal, s.spk_cus_kode, s.spk_nama,
                  s.spk_jumlah, c.cus_nama
           FROM tspk s
           LEFT JOIN tcustomer c ON c.Cus_kode = s.spk_cus_kode
           WHERE s.spk_nomor = ?`,
          [fb.fb_spk],
        );

  return {
    ...fb,
    ...(soRows[0] || {}),
    Created: fb.fb_date_create,
    Approved: fb.fb_apv_tgl,
  };
};

// GENERATE NOMOR — sesuai Delphi getmaxnomor() ✅
// ⚠️ diperbaiki: prefix length dinamis (bukan hardcode 11 seperti source
// asli), karena panjang nomor SPK/SO sekarang variatif.
const getMaxNomorBatal = async (spkNomor, conn) => {
  const runner = conn || db;
  const prefixLen = spkNomor.length;
  const [[row]] = await runner.query(
    `SELECT IFNULL(MAX(RIGHT(fb_nomor, 2)), 0) AS jumlah
     FROM tspk_formbatal
     WHERE LEFT(fb_nomor, ?) = ?`,
    [prefixLen, spkNomor],
  );
  const next = 101 + Number(row.jumlah);
  return `${spkNomor}-${String(next).slice(-2)}`;
};

// AJUKAN PEMBATALAN — sesuai Delphi simpandata() cabang APV=false ✅
const ajukanPembatalan = async (payload, userKode) => {
  const {
    spkNomor,
    tanggal,
    abUbah,
    abMap,
    abBahan,
    abQty,
    abLain,
    abLain2,
    abKet,
    spBelum,
    spCuting,
    spSewing,
    spFinishing,
    spSudah,
    sbBeli,
    sbDireksi,
    sbSup,
    sbSudah,
    dampak,
    rtBatal,
    rtAlih,
    rtSisa,
    rtLain,
    rtLain2,
  } = payload;

  if (!spkNomor) throw new Error("Nomor SPK/SO wajib diisi.");
  const y = (v) => (v ? "Y" : "N");

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const fbNomor = await getMaxNomorBatal(spkNomor, conn);

    await conn.query(
      `INSERT INTO tspk_formbatal
         (fb_nomor, fb_tanggal, fb_spk, fb_abubah, fb_abmap, fb_abbahan, fb_abqty,
          fb_ablain, fb_ablain2, fb_abket,
          fb_spbelum, fb_spcuting, fb_spsewing, fb_spfinishing, fb_spsudah,
          fb_sbbeli, fb_sbdireksi, fb_sbsup, fb_sbsudah, fb_dampak,
          fb_rtbatal, fb_rtalih, fb_rtsisa, fb_rtlain, fb_rtlain2,
          fb_user_create, fb_date_create)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE
         fb_abubah=VALUES(fb_abubah), fb_abmap=VALUES(fb_abmap), fb_abbahan=VALUES(fb_abbahan),
         fb_abqty=VALUES(fb_abqty), fb_ablain=VALUES(fb_ablain), fb_ablain2=VALUES(fb_ablain2),
         fb_abket=VALUES(fb_abket), fb_spbelum=VALUES(fb_spbelum), fb_spcuting=VALUES(fb_spcuting),
         fb_spsewing=VALUES(fb_spsewing), fb_spfinishing=VALUES(fb_spfinishing),
         fb_spsudah=VALUES(fb_spsudah), fb_sbbeli=VALUES(fb_sbbeli), fb_sbdireksi=VALUES(fb_sbdireksi),
         fb_sbsup=VALUES(fb_sbsup), fb_sbsudah=VALUES(fb_sbsudah), fb_dampak=VALUES(fb_dampak),
         fb_rtbatal=VALUES(fb_rtbatal), fb_rtalih=VALUES(fb_rtalih), fb_rtsisa=VALUES(fb_rtsisa),
         fb_rtlain=VALUES(fb_rtlain), fb_rtlain2=VALUES(fb_rtlain2),
         fb_user_create=VALUES(fb_user_create), fb_date_modified=NOW()`,
      [
        fbNomor,
        tanggal,
        spkNomor,
        y(abUbah),
        y(abMap),
        y(abBahan),
        y(abQty),
        y(abLain),
        abLain2 || "",
        abKet || "",
        y(spBelum),
        y(spCuting),
        y(spSewing),
        y(spFinishing),
        y(spSudah),
        y(sbBeli),
        y(sbDireksi),
        y(sbSup),
        y(sbSudah),
        dampak || "",
        y(rtBatal),
        y(rtAlih),
        y(rtSisa),
        y(rtLain),
        rtLain2 || "",
        userKode,
      ],
    );

    const loc = await resolveSoLocation(spkNomor);
    if (!loc) throw new Error("SPK/SO tidak ditemukan.");
    if (loc === "new") {
      await conn.query(
        `UPDATE tsalesorder SET so_aktif = "N", so_ketbatal = "PENGAJUAN" WHERE so_nomor = ?`,
        [spkNomor],
      );
    } else {
      await conn.query(
        `UPDATE tspk SET spk_aktif = "N", spk_ketbatal = "PENGAJUAN" WHERE spk_nomor = ?`,
        [spkNomor],
      );
    }

    await conn.commit();
    return { fbNomor };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
};

// GET STATUS PENGAJUAN GANTI QTY/KAIN TERAKHIR — sesuai Delphi
// PengajuanGantiQtydanJenisKain1Click, dipakai frontend buat prefill
// form (kalau ada pengajuan pending, tampilkan urut & alasan lama)
const getGantiQtyKainStatus = async (nomor) => {
  const [[lastPin]] = await db.query(
    `SELECT pin_urut, pin_dipakai, pin_alasan
     FROM tspk_pin5
     WHERE pin_trs = "SO" AND pin_nomor = ? AND pin_jenis = "GANTI"
     ORDER BY pin_urut DESC LIMIT 1`,
    [nomor],
  );

  if (!lastPin) {
    return { urut: 1, alasan: "" };
  }
  if (lastPin.pin_dipakai === "") {
    // masih pending, belum di-approve → reuse urut yang sama, prefill alasan
    return { urut: lastPin.pin_urut, alasan: lastPin.pin_alasan || "" };
  }
  // sudah pernah dipakai → pengajuan baru, urut naik
  return { urut: lastPin.pin_urut + 1, alasan: "" };
};

// AJUKAN GANTI QTY/KAIN — sesuai Delphi btnSimpanClick cabang
// "Pengajuan Ganti Qty dan Jeni Kain" ✅
const ajukanGantiQtyKain = async (nomor, alasan, userKode) => {
  if (!alasan?.trim()) throw new Error("Alasan harus diisi.");

  const loc = await resolveSoLocation(nomor);
  if (!loc) throw new Error("Data SPK/SO tidak ditemukan.");

  const [header] =
    loc === "new"
      ? await db.query(
          `SELECT so_tanggal AS tanggal, so_nama AS nama FROM tsalesorder WHERE so_nomor = ?`,
          [nomor],
        )
      : await db.query(
          `SELECT spk_tanggal AS tanggal, spk_nama AS nama FROM tspk WHERE spk_nomor = ?`,
          [nomor],
        );
  if (!header[0]) throw new Error("Data SPK/SO tidak ditemukan.");

  const { urut } = await getGantiQtyKainStatus(nomor);

  await db.query(
    `INSERT INTO tspk_pin5
       (pin_trs, pin_nomor, pin_urut, pin_jenis, pin_tgl_trs, pin_ket,
        pin_tgl_minta, pin_user_minta, pin_alasan)
     VALUES ("SO", ?, ?, "GANTI", ?, ?, NOW(), ?, ?)
     ON DUPLICATE KEY UPDATE
       pin_tgl_trs = VALUES(pin_tgl_trs),
       pin_ket = VALUES(pin_ket),
       pin_acc = "",
       pin_tgl_minta = NOW(),
       pin_user_minta = VALUES(pin_user_minta),
       pin_alasan = VALUES(pin_alasan)`,
    [nomor, urut, header[0].tanggal, header[0].nama, userKode, alasan],
  );

  return { urut };
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
  resolveSoLocation,
  getPembatalanDetail,
  ajukanPembatalan,
  getGantiQtyKainStatus,
  ajukanGantiQtyKain,
};
