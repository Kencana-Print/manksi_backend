const db = require("../../config/database");
const tutupBukuService = require("../tutupBukuService");

// ─────────────────────────────────────────────────────────
// GENERATE NOMOR SJ
// Format: SG/{kodePerush}/{NNNNN}/{YYYY}
// max(substr(sj_nomor,7,5)) WHERE left(sj_nomor,5)=prefix AND right=tahun
// ─────────────────────────────────────────────────────────
const generateNomor = async (kodePerush, tanggal, conn) => {
  const tahun = new Date(tanggal).getFullYear();
  const prefix = `SG/${kodePerush}`;

  const [[row]] = await conn.query(
    `SELECT IFNULL(MAX(CAST(SUBSTR(sj_nomor, 7, 5) AS UNSIGNED)), 0) AS max_val
     FROM tsj_hdr
     WHERE LEFT(sj_nomor, 5) = ?
       AND RIGHT(sj_nomor, 4) = ?
     FOR UPDATE`,
    [prefix, String(tahun)],
  );
  const next = parseInt(row.max_val, 10) + 1;
  return `${prefix}/${String(next).padStart(5, "0")}/${tahun}`;
};

// ─────────────────────────────────────────────────────────
// GENERATE NOMOR INVOICE (untuk perusahaan AI)
// Format: INV/AI/{NNNNN}/{YYYY}
// ─────────────────────────────────────────────────────────
const generateNomorInvoice = async (kodePerush, tanggal, conn) => {
  const tahun = new Date(tanggal).getFullYear();
  const prefix = `ING/${kodePerush}`;

  const [[row]] = await conn.query(
    `SELECT IFNULL(MAX(CAST(SUBSTR(inv_nomor, 8, 5) AS UNSIGNED)), 0) AS max_val
     FROM tinv_hdr
     WHERE LEFT(inv_nomor, 6) = ?
       AND RIGHT(inv_nomor, 4) = ?`,
    [prefix, String(tahun)],
  );
  const next = parseInt(row.max_val, 10) + 1;
  return `${prefix}/${String(next).padStart(5, "0")}/${tahun}`;
};

const buildNomorPo = (validDetail) => {
  const unique = [
    ...new Set(
      validDetail.map((r) => (r.KetPo || "").trim()).filter((v) => v !== ""),
    ),
  ];
  return unique.join(", ");
};

// ─────────────────────────────────────────────────────────
// GET BY NOMOR (load edit — loaddataall)
// ─────────────────────────────────────────────────────────
const getById = async (nomor) => {
  const [[hdr]] = await db.query(
    `SELECT
       h.sj_nomor, DATE_FORMAT(h.sj_tanggal,'%Y-%m-%d') AS sj_tanggal,
        h.sj_divisi, h.sj_keterangan, h.sj_no_po,
       h.sj_perush_kode, p.perush_nama,
       h.sj_cus_kode, c.cus_nama, c.cus_alamat, c.cus_kota,
       h.sj_alamat_customer, h.sj_kota_customer,
       h.sj_gdg_kode, g.gdg_nama,
       h.sj_inv_pro, h.sj_inv_sm, h.sj_approve,
       h.sj_status_inv,
       IFNULL(r.sj_pra,'') AS pra,
       inv.inv_sts_ppn, inv.inv_ppn, inv.inv_rekening,
       inv.inv_disc,
       pd.perushd_bank, pd.perushd_atasnama
     FROM tsj_hdr h
     INNER JOIN tperusahaan p ON p.perush_kode = h.sj_perush_kode
     INNER JOIN tcustomer c ON c.cus_kode = h.sj_cus_kode
     LEFT JOIN tprasj_hdr r ON r.sj_sj = h.sj_nomor
     LEFT JOIN tgudang g ON g.gdg_kode = h.sj_gdg_kode
     LEFT JOIN tinv_hdr inv ON inv.inv_nomor = h.sj_inv_sm
     LEFT JOIN tperusahaan_dtl pd
       ON pd.perushd_perush_kode = p.perush_kode
       AND pd.perushd_rekening = inv.inv_rekening
     WHERE h.sj_nomor = ?`,
    [nomor],
  );
  if (!hdr) throw new Error("Data tidak ditemukan.");

  // Detail
  const [dtl] = await db.query(
    `SELECT
       d.sjd_spk_nomor,
       s.spk_nama2 AS spk_nama,
       d.sjd_ukuran,
       s.spk_jo_kode,
       s.spk_jumlah,
       s.spk_harga,
       d.sjd_jumlah,
       d.sjd_harga,
       d.sjd_koli,
       d.sjd_keterangan,
       d.sjd_nourut,
       d.sjd_nokirim,
       d.sjd_idkirim,
       IFNULL(z.spks_qty, 0) AS qtyorder,
       IFNULL(z.spks_size, '') AS size,
       IFNULL(j.uraian, '') AS uraian
     FROM tsj_dtl d
     LEFT JOIN tspk s ON s.spk_nomor = d.sjd_spk_nomor
     LEFT JOIN tspk_size z
       ON z.spks_nomor = d.sjd_spk_nomor AND z.spks_size = d.sjd_ukuran
     LEFT JOIN tjadwalkirim_dtl j
       ON j.nomor_kirim = d.sjd_nokirim AND j.No_urut = d.sjd_idkirim
     WHERE d.sjd_sj_nomor = ?
     ORDER BY d.sjd_nourut`,
    [nomor],
  );

  // Hitung sudah kirim per row
  for (const row of dtl) {
    if (row.size) {
      const [[r]] = await db.query(
        `SELECT IFNULL(SUM(d2.sjd_jumlah),0) AS sudah
         FROM tsj_dtl d2
         INNER JOIN tsj_hdr h2 ON h2.sj_nomor = d2.sjd_sj_nomor
         WHERE h2.sj_status_otomatis = 0
           AND d2.sjd_spk_nomor = ?
           AND d2.sjd_ukuran = ?
           AND d2.sjd_sj_nomor <> ?`,
        [row.sjd_spk_nomor, row.sjd_ukuran, nomor],
      );
      row.sudah = r.sudah;
      row.kurang = row.qtyorder - r.sudah;
    } else {
      const [[r]] = await db.query(
        `SELECT IFNULL(SUM(d2.sjd_jumlah),0) AS sudah
         FROM tsj_dtl d2
         INNER JOIN tsj_hdr h2 ON h2.sj_nomor = d2.sjd_sj_nomor
         WHERE h2.sj_status_otomatis = 0
           AND d2.sjd_spk_nomor = ?
           AND d2.sjd_sj_nomor <> ?`,
        [row.sjd_spk_nomor, nomor],
      );
      row.sudah = r.sudah;
      row.kurang = row.spk_jumlah - r.sudah;
    }
  }

  // ── CEK PIN5 ──
  const [[pin5]] = await db.query(
    `SELECT pin_urut, pin_acc, pin_dipakai, pin_alasan
     FROM tspk_pin5
     WHERE pin_trs = 'SJ' AND pin_nomor = ?
     ORDER BY pin_urut DESC LIMIT 1`,
    [nomor],
  );

  let xminta5 = "";
  let xurut5 = 0;
  if (pin5) {
    xurut5 = pin5.pin_urut;
    if (!pin5.pin_acc && !pin5.pin_dipakai) xminta5 = "WAIT";
    else if (pin5.pin_acc === "Y" && !pin5.pin_dipakai) xminta5 = "ACC";
    else if (pin5.pin_acc === "N") xminta5 = "TOLAK";
    else xminta5 = "MINTA";
  }

  // ── CEK STATUS TUTUP BUKU ──
  const tglTrs = new Date(hdr.sj_tanggal);
  const zMonth = tglTrs.getMonth();
  const zYear = tglTrs.getFullYear();

  let ztglclose = 0;
  const [verRows] = await db.query(
    `SELECT tgl_close FROM tversi WHERE aplikasi = 'MANKSI' LIMIT 1`,
  );
  if (verRows.length > 0) ztglclose = parseInt(verRows[0].tgl_close, 10) || 0;

  const limitDate = new Date(zYear, zMonth + 1, ztglclose);
  limitDate.setHours(0, 0, 0, 0);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const zCloseManual = await tutupBukuService.getManualTutupBuku("SJ");

  let isTutupBuku = false;
  if (zCloseManual) {
    zCloseManual.setHours(0, 0, 0, 0);
    if (tglTrs < zCloseManual) isTutupBuku = true;
  } else {
    if (limitDate < today) isTutupBuku = true;
  }

  hdr.isTutupBuku = isTutupBuku;

  return { header: hdr, detail: dtl, xminta5, xurut5 };
};

// ─────────────────────────────────────────────────────────
// GET SUDAH KIRIM
// Sesuai Delphi getsudah / getsudahsize
// ─────────────────────────────────────────────────────────
const getSudah = async (spkNomor, ukuran = "", excludeNomor = "") => {
  if (ukuran) {
    const [[row]] = await db.query(
      `SELECT IFNULL(SUM(d.sjd_jumlah),0) AS sudah
       FROM tsj_dtl d
       INNER JOIN tsj_hdr h ON h.sj_nomor = d.sjd_sj_nomor
       WHERE h.sj_status_otomatis = 0
         AND d.sjd_spk_nomor = ?
         AND d.sjd_ukuran = ?
         AND d.sjd_sj_nomor <> ?`,
      [spkNomor, ukuran, excludeNomor],
    );
    return row.sudah;
  } else {
    const [[row]] = await db.query(
      `SELECT IFNULL(SUM(d.sjd_jumlah),0) AS sudah
       FROM tsj_dtl d
       INNER JOIN tsj_hdr h ON h.sj_nomor = d.sjd_sj_nomor
       WHERE h.sj_status_otomatis = 0
         AND d.sjd_spk_nomor = ?
         AND d.sjd_sj_nomor <> ?`,
      [spkNomor, excludeNomor],
    );
    return row.sudah;
  }
};

// ─────────────────────────────────────────────────────────
// GET SPK DETAIL (F1 di grid — loadkode)
// spkNomor yang masuk = nomor SO (dipilih dari modal filterMode="sj").
// Perlu dijembatani ke SPK PPIC turunan dulu — SJ harus refer ke
// turunan (sjd_spk_nomor), bukan SO, karena qty tracking (tspk_size,
// progress kirim) live di level turunan sejak SPK PPIC dibuat.
// ─────────────────────────────────────────────────────────
const getSpkDetail = async (
  soNomor,
  cusKode,
  divisi,
  excludeNomor = "",
  existingDetail = [],
) => {
  // 1. Validasi SO ada, milik customer ybs, sudah di-CMO — cek
  //    tsalesorder (SO baru) dulu, fallback ke tspk legacy
  //    (spk_is_so=1, data lama pre-migrasi). SO baru sudah tidak
  //    lagi hidup di tspk.
  const [[soNew]] = await db.query(
    `SELECT so_nomor AS spk_nomor, so_cmo AS spk_cmo, so_nomor_po AS nomorpo
      FROM tsalesorder
     WHERE so_aktif = 'Y' AND so_nomor = ? AND so_cus_kode = ?`,
    [soNomor, cusKode],
  );
  let soRow = soNew;
  if (!soRow) {
    const [[soLegacy]] = await db.query(
      `SELECT spk_nomor, spk_cmo, spk_nomor_po AS nomorpo FROM tspk
       WHERE spk_aktif = 'Y' AND spk_nomor = ? AND spk_cus_kode = ? AND spk_is_so = 1`,
      [soNomor, cusKode],
    );
    soRow = soLegacy;
  }
  if (!soRow) throw new Error("SO Tidak ditemukan di Customer tsb.");
  if (!soRow.spk_cmo) throw new Error("SO tsb belum di Approve oleh CMO.");
  const nomorPo = soRow.nomorpo || "";

  // 2. Jembatani ke SPK PPIC turunan — WAJIB, karena SJ harus nyimpen
  //    nomor turunan (sjd_spk_nomor), bukan nomor SO
  const [[turunan]] = await db.query(
    `SELECT spk_nomor FROM tspk
     WHERE spk_so_ref = ? AND spk_is_so = 0 AND spk_aktif = 'Y'`,
    [soNomor],
  );
  if (!turunan) {
    throw new Error(
      "SPK PPIC untuk SO ini belum dibuat. Silahkan buat SPK PPIC terlebih dahulu sebelum membuat Surat Jalan.",
    );
  }
  const spkNomor = turunan.spk_nomor;

  // 3. Cek tspk_size — sekarang selalu di level turunan
  const [[sizeCheck]] = await db.query(
    `SELECT COUNT(*) AS cnt FROM tspk_size WHERE spks_nomor = ?`,
    [spkNomor],
  );

  let rows = [];
  const divisiStr = String(divisi).charAt(0);

  if (sizeCheck.cnt > 0) {
    const [sizes] = await db.query(
      `SELECT z.spks_nomor, z.spks_size, z.spks_qty,
      s.spk_nama2, s.spk_ukuran, s.spk_jo_kode, s.spk_harga, s.spk_jumlah, s.spk_nomor_po
        FROM tspk_size z
       INNER JOIN tspk s ON s.spk_nomor = z.spks_nomor
       WHERE z.spks_nomor = ?`,
      [spkNomor],
    );
    for (const r of sizes) {
      const ukuran =
        divisiStr === "3" || divisiStr === "4" ? r.spks_size : r.spk_ukuran;
      const sudah = await getSudah(spkNomor, r.spks_size, excludeNomor);
      rows.push({
        SpkNomor: r.spks_nomor,
        NamaSpk: r.spk_nama2,
        Ukuran: ukuran,
        Size: r.spks_size,
        Jenis: r.spk_jo_kode,
        Harga: r.spk_harga,
        SpkJumlah: r.spk_jumlah,
        QtyOrder: r.spks_qty,
        Jumlah: 0,
        Koli: 0,
        Sudah: sudah,
        Kurang: r.spks_qty - sudah,
        Keterangan: "",
        Uraian: "",
        NoKirim: "",
        IdKirim: 0,
        KetPo: r.spk_nomor_po || "",
      });
    }
  } else {
    // SPK turunan tanpa size (kasus lama/khusus) — 1 row
    const dup = (existingDetail || []).find(
      (r) => r === spkNomor || r?.SpkNomor === spkNomor,
    );
    if (dup) {
      throw new Error(`SPK tsb sudah di input.`);
    }

    const [[spkInfo]] = await db.query(
      `SELECT spk_nomor, spk_nama2, spk_ukuran, spk_jo_kode, spk_harga,
              spk_jumlah,
              (spk_prasj + spk_jumlah_kirim) AS sudah,
              (spk_jumlah - spk_prasj - spk_jumlah_kirim) AS kurang
       FROM tspk
       WHERE spk_aktif = 'Y' AND spk_nomor = ?`,
      [spkNomor],
    );
    if (!spkInfo) throw new Error("SPK tidak ditemukan.");

    const ukuran =
      divisiStr === "3" || divisiStr === "4" ? "" : spkInfo.spk_ukuran;
    rows.push({
      SpkNomor: spkInfo.spk_nomor,
      NamaSpk: spkInfo.spk_nama2,
      Ukuran: ukuran,
      Size: "",
      Jenis: spkInfo.spk_jo_kode,
      Harga: spkInfo.spk_harga,
      SpkJumlah: spkInfo.spk_jumlah,
      QtyOrder: spkInfo.spk_jumlah,
      Jumlah: 0,
      Koli: 0,
      Sudah: spkInfo.sudah,
      Kurang: spkInfo.kurang,
      Keterangan: "",
      Uraian: "",
      NoKirim: "",
      IdKirim: 0,
      KetPo: nomorPo,
    });
  }

  return rows;
};

// ─────────────────────────────────────────────────────────
// GET SPK DETAIL — dari pilihan Jadwal Kirim (F2 di grid)
// Beda dari getSpkDetail (F1): input di sini SUDAH nomor turunan
// (tjadwalkirim.spk_nomor menyimpan nomor turunan, bukan nomor SO),
// jadi TIDAK boleh divalidasi ulang ke tsalesorder/tspk(is_so=1) —
// itu yang bikin error "SO Tidak ditemukan" waktu user pilih dari F2,
// karena nomor turunan memang tidak pernah ada di kolom so_nomor.
// noKirim/idKirim dibawa dari baris jadwal yang dipilih user, supaya
// tersimpan ke sjd_nokirim/sjd_idkirim persis kayak jalur lama.
// ─────────────────────────────────────────────────────────
const getSpkDetailFromJadwal = async (
  spkNomorTurunan,
  divisi,
  excludeNomor = "",
  noKirim = "",
  idKirim = 0,
) => {
  const [[spkCheck]] = await db.query(
    `SELECT spk_nomor FROM tspk
     WHERE spk_nomor = ? AND spk_is_so = 0 AND spk_aktif = 'Y'`,
    [spkNomorTurunan],
  );
  if (!spkCheck) {
    throw new Error("SPK turunan tidak ditemukan atau sudah tidak aktif.");
  }
  const spkNomor = spkCheck.spk_nomor;
  const divisiStr = String(divisi).charAt(0);

  const [[sizeCheck]] = await db.query(
    `SELECT COUNT(*) AS cnt FROM tspk_size WHERE spks_nomor = ?`,
    [spkNomor],
  );

  let rows = [];
  if (sizeCheck.cnt > 0) {
    const [sizes] = await db.query(
      `SELECT z.spks_nomor, z.spks_size, z.spks_qty,
          s.spk_nama2, s.spk_ukuran, s.spk_jo_kode, s.spk_harga, s.spk_jumlah, s.spk_nomor_po
       FROM tspk_size z
       INNER JOIN tspk s ON s.spk_nomor = z.spks_nomor
       WHERE z.spks_nomor = ?`,
      [spkNomor],
    );
    for (const r of sizes) {
      const ukuran =
        divisiStr === "3" || divisiStr === "4" ? r.spks_size : r.spk_ukuran;
      const sudah = await getSudah(spkNomor, r.spks_size, excludeNomor);
      rows.push({
        SpkNomor: r.spks_nomor,
        NamaSpk: r.spk_nama2,
        Ukuran: ukuran,
        Size: r.spks_size,
        Jenis: r.spk_jo_kode,
        Harga: r.spk_harga,
        SpkJumlah: r.spk_jumlah,
        QtyOrder: r.spks_qty,
        Jumlah: 0,
        Koli: 0,
        Sudah: sudah,
        Kurang: r.spks_qty - sudah,
        Keterangan: "",
        Uraian: "",
        NoKirim: noKirim,
        IdKirim: idKirim,
        KetPo: r.spk_nomor_po || "",
      });
    }
  } else {
    const [[spkInfo]] = await db.query(
      `SELECT spk_nomor, spk_nama2, spk_ukuran, spk_jo_kode, spk_harga,
      spk_jumlah, spk_nomor_po,
      (spk_prasj + spk_jumlah_kirim) AS sudah,
      (spk_jumlah - spk_prasj - spk_jumlah_kirim) AS kurang
      FROM tspk
      WHERE spk_aktif = 'Y' AND spk_nomor = ?`,
      [spkNomor],
    );
    if (!spkInfo) throw new Error("SPK tidak ditemukan.");

    const ukuran =
      divisiStr === "3" || divisiStr === "4" ? "" : spkInfo.spk_ukuran;
    rows.push({
      SpkNomor: spkInfo.spk_nomor,
      NamaSpk: spkInfo.spk_nama2,
      Ukuran: ukuran,
      Size: "",
      Jenis: spkInfo.spk_jo_kode,
      Harga: spkInfo.spk_harga,
      SpkJumlah: spkInfo.spk_jumlah,
      QtyOrder: spkInfo.spk_jumlah,
      Jumlah: 0,
      Koli: 0,
      Sudah: spkInfo.sudah,
      Kurang: spkInfo.kurang,
      Keterangan: "",
      Uraian: "",
      NoKirim: noKirim,
      IdKirim: idKirim,
      KetPo: spkInfo.spk_nomor_po || "",
    });
  }

  return rows;
};

// ─────────────────────────────────────────────────────────
// GET SPK LIST untuk modal (F1 di grid)
// Filter per customer, perusahaan, divisi
// ─────────────────────────────────────────────────────────
const getSpkList = async (
  cusKode,
  perushKode,
  divisi,
  invProNomor = "",
  q = "",
) => {
  const divisiStr = String(divisi).charAt(0);
  const like = `%${q}%`;
  let where = `s.spk_cus_kode = ? AND s.spk_perush_kode = ?
    AND s.spk_aktif = 'Y' AND s.spk_divisi = ? AND s.spk_cmo <> ''`;
  const params = [cusKode, perushKode, divisiStr];
  if (invProNomor) {
    where += ` AND s.spk_nomor IN (
      SELECT invd_spk_nomor FROM tinv_dtl WHERE invd_inv_nomor = ?
    )`;
    params.push(invProNomor);
  }
  if (q) {
    where += ` AND (s.spk_nomor LIKE ? OR s.spk_nama LIKE ?)`;
    params.push(like, like);
  }
  // Sumber SO: tsalesorder (baru) UNION tspk legacy WHERE spk_is_so=1
  // (lama, pre-migrasi). Kolom di-alias spk_* di kedua sisi.
  const [rows] = await db.query(
    `SELECT s.spk_nomor AS Nomor,
            DATE_FORMAT(s.spk_tanggal,'%d-%m-%Y') AS Tanggal,
            s.spk_nama AS Nama, s.spk_ukuran AS Ukuran,
            s.spk_jo_kode AS Jenis, c.cus_nama AS Customer
     FROM (
       SELECT so_nomor AS spk_nomor, so_tanggal AS spk_tanggal, so_nama AS spk_nama,
              so_ukuran AS spk_ukuran, so_jo_kode AS spk_jo_kode, so_cus_kode AS spk_cus_kode,
              so_perush_kode AS spk_perush_kode, so_divisi AS spk_divisi,
              so_aktif AS spk_aktif, so_cmo AS spk_cmo
       FROM tsalesorder
       UNION ALL
       SELECT spk_nomor, spk_tanggal, spk_nama, spk_ukuran, spk_jo_kode, spk_cus_kode,
              spk_perush_kode, spk_divisi, spk_aktif, spk_cmo
       FROM tspk
       WHERE spk_is_so = 1
     ) s
     INNER JOIN tcustomer c ON c.cus_kode = s.spk_cus_kode
     WHERE ${where}
     ORDER BY s.spk_tanggal DESC
     LIMIT 200`,
    params,
  );
  return rows;
};

// ─────────────────────────────────────────────────────────
// GET JADWAL KIRIM LIST untuk modal (F2 di grid)
// Sesuai Delphi F2 — dari tjadwalkirim
// ─────────────────────────────────────────────────────────
const getJadwalKirimList = async (
  cusKode,
  perushKode,
  divisi,
  invProNomor = "",
  q = "",
  page = 1,
  limit = 50,
) => {
  const limitNum = Number(limit);
  const offset = (Number(page) - 1) * limitNum;
  const divisiStr = String(divisi).charAt(0);
  const like = `%${q}%`;

  // ⚠️ FIX: tjadwalkirim.spk_nomor merujuk ke SPK PPIC TURUNAN (sama
  // seperti sjd_spk_nomor di tsj_dtl / getSpkDetail), BUKAN nomor SO.
  // Join sebelumnya salah pakai soUnion (SO baru + SO legacy saja) —
  // turunan gak pernah ada di situ, jadi jadwal kirim yang sudah
  // dibuat atas SPK turunan selalu 0 baris walau datanya ada.
  let where = `s.spk_aktif = 'Y' AND s.spk_is_so = 0 AND s.spk_cmo <> ''
    AND s.spk_divisi = ? AND s.spk_perush_kode = ? AND s.spk_cus_kode = ?`;
  const params = [divisiStr, perushKode, cusKode];
  if (invProNomor) {
    where += ` AND s.spk_nomor IN (
      SELECT d.invd_spk_nomor FROM tinv_dtl d WHERE d.invd_inv_nomor = ?
    )`;
    params.push(invProNomor);
  }
  if (q) {
    where += ` AND (a.spk_nomor LIKE ? OR s.spk_nama LIKE ? OR b.nomor_kirim LIKE ?)`;
    params.push(like, like, like);
  }

  const [[{ total }]] = await db.query(
    `SELECT COUNT(*) AS total
     FROM tjadwalkirim a
     INNER JOIN tspk s ON s.spk_nomor = a.spk_nomor
     LEFT JOIN tjadwalkirim_dtl b ON b.nomor_kirim = a.Nomor_Kirim
     WHERE ${where}`,
    params,
  );

  const [rows] = await db.query(
    `SELECT a.spk_nomor AS SPK, s.spk_nama AS Nama,
            DATE_FORMAT(a.Tanggal, '%Y-%m-%d') AS Jadwal,
            b.nomor_kirim AS NoKirim,
            b.No_urut    AS NoUrut,
            b.uraian     AS Uraian,
            b.jumlah     AS QtyJadwal
     FROM tjadwalkirim a
     INNER JOIN tspk s ON s.spk_nomor = a.spk_nomor
     LEFT JOIN tjadwalkirim_dtl b ON b.nomor_kirim = a.Nomor_Kirim
     WHERE ${where}
     ORDER BY a.Tanggal DESC, b.nomor_kirim, b.No_urut
     LIMIT ? OFFSET ?`,
    [...params, limitNum, offset],
  );
  return { items: rows, total, page: Number(page), limit: limitNum };
};

// ─────────────────────────────────────────────────────────
// CEK PIUTANG (v_cekpiutang)
// Sesuai Delphi clkodePropertiesEditValueChanged
// ─────────────────────────────────────────────────────────
const cekPiutang = async (spkNomor, cusKode) => {
  const [[cus]] = await db.query(
    `SELECT cus_korporasi, cus_nama FROM tcustomer WHERE cus_kode = ?`,
    [cusKode],
  );
  if (cus?.cus_korporasi === "Y") return { lunas: true, korporasi: true };

  const namaUpper = (cus?.cus_nama || "").toUpperCase();
  if (namaUpper.includes("RITAILER") || namaUpper.includes("DARI WEB")) {
    return { lunas: true, korporasi: false, skipAlasan: "RITAILER/WEB" };
  }

  const [rows] = await db.query(
    `SELECT flag, flag2 FROM v_cekpiutang
     WHERE spk_nomor = ? AND inv_cus_kode = ?`,
    [spkNomor, cusKode],
  );

  if (!rows.length) return { lunas: true, korporasi: false };

  const r = rows[0];
  const lunas = r.flag === "0" || r.flag2 === "0";
  return { lunas, korporasi: false };
};

// ─────────────────────────────────────────────────────────
// CEK STATUS INVOICE
// Sesuai Delphi cekstatusinv
// ─────────────────────────────────────────────────────────
const cekStatusInv = async (nomor) => {
  const [[row]] = await db.query(
    `SELECT sj_status_inv FROM tsj_hdr WHERE sj_nomor = ?`,
    [nomor],
  );
  return row?.sj_status_inv === "1" || row?.sj_status_inv === 1;
};

// ─────────────────────────────────────────────────────────
// CEK TUTUP BUKU — sesuai Delphi FormKeyDown VK_F10
// ─────────────────────────────────────────────────────────
const cekTutupBuku = async (tanggal, xminta5 = "") => {
  // xminta5 check dulu — sesuai Delphi
  if (["MINTA", "WAIT", "TOLAK"].includes(xminta5)) {
    return {
      boleh: false,
      message:
        "Transaksi tsb sudah diclose.\nSilahkan minta approve untuk bisa menyimpan perubahan data.",
    };
  }
  if (xminta5 === "ACC") return { boleh: true };

  const tgl = new Date(tanggal);

  // Pakai pola yang sama seperti di pelunasanFormService.js
  const zMonth = tgl.getMonth();
  const zYear = tgl.getFullYear();

  let ztglclose = 0;
  const [verRows] = await db.query(
    `SELECT tgl_close FROM tversi WHERE aplikasi = 'MANKSI' LIMIT 1`,
  );
  if (verRows.length > 0) ztglclose = parseInt(verRows[0].tgl_close, 10) || 0;

  const limitDate = new Date(zYear, zMonth + 1, ztglclose);
  limitDate.setHours(0, 0, 0, 0);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const zCloseManual = await tutupBukuService.getManualTutupBuku("SJ");

  let boleh = true;
  if (zCloseManual) {
    zCloseManual.setHours(0, 0, 0, 0);
    if (tgl < zCloseManual) boleh = false;
  } else {
    if (limitDate < today) boleh = false;
  }

  if (!boleh) {
    return {
      boleh: false,
      message: "Anda tidak boleh input di tanggal periode yg sudah diclose.",
    };
  }
  return { boleh: true };
};

// ─────────────────────────────────────────────────────────
// ALOKASI HISTORY (btnalokasiClick)
// ─────────────────────────────────────────────────────────
const getAlokasiHistory = async (cusKode) => {
  const [rows] = await db.query(
    `SELECT DISTINCT c.cus_nama AS Nama,
            h.sj_kota_customer AS Kota,
            h.sj_alamat_customer AS Alamat
     FROM tsj_hdr h
     INNER JOIN tcustomer c ON c.cus_kode = h.sj_cus_kode
     WHERE h.sj_cus_kode = ? AND h.sj_alamat_customer <> ''
     ORDER BY h.sj_alamat_customer`,
    [cusKode],
  );
  return rows;
};

// ─────────────────────────────────────────────────────────
// ALOKASI SPK (btnalokasispkClick)
// ─────────────────────────────────────────────────────────
const getAlokasiSpk = async (spkNomor, page = 1, limit = 20, q = "") => {
  const limitNum = Number(limit);
  const offset = (Number(page) - 1) * limitNum;

  let where = `WHERE spk_nomor = ?`;
  const params = [spkNomor];

  if (q) {
    where += ` AND (Alamat LIKE ? OR Kota LIKE ? OR Person LIKE ?)`;
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }

  const [[{ total }]] = await db.query(
    `SELECT COUNT(*) AS total FROM talokasi ${where}`,
    params,
  );

  const [rows] = await db.query(
    `SELECT spk_nomor AS SPK, Alamat, Kota, Person, Hp, Jumlah
     FROM talokasi ${where}
     ORDER BY Alamat
     LIMIT ? OFFSET ?`,
    [...params, limitNum, offset],
  );
  return { items: rows, total, page: Number(page), limit: limitNum };
};

// ─────────────────────────────────────────────────────────
// GET DIVISI LIST
// ─────────────────────────────────────────────────────────
const getDivisiList = async () => {
  const [rows] = await db.query(
    `SELECT kode, divisi AS nama FROM tdivisi WHERE kode <> 0 ORDER BY kode`,
  );
  return rows;
};

// ─────────────────────────────────────────────────────────
// GET INVOICE PROFORMA LIST (search modal)
// ─────────────────────────────────────────────────────────
const getInvProformaList = async (cusKode, q = "") => {
  const like = `%${q}%`;
  const [rows] = await db.query(
    `SELECT inv_nomor AS Nomor, c.cus_nama AS Customer,
            DATE_FORMAT(inv_tanggal,'%d-%m-%Y') AS Tanggal,
            inv_keterangan AS Keterangan
     FROM tinv_hdr
     INNER JOIN tcustomer c ON c.cus_kode = inv_cus_kode
     WHERE inv_sts_pro = 1
       AND (inv_nomor LIKE ? OR c.cus_nama LIKE ? OR inv_keterangan LIKE ?)
     ORDER BY inv_tanggal DESC
     LIMIT 100`,
    [like, like, like],
  );
  return rows;
};

// ─────────────────────────────────────────────────────────
// GET REKENING PERUSAHAAN (lookup bank)
// ─────────────────────────────────────────────────────────
const getRekeningPerush = async (perushKode) => {
  const [rows] = await db.query(
    `SELECT perushd_rekening AS Rekening,
            perushd_bank AS Bank,
            perushd_atasnama AS AtasNama
     FROM tperusahaan_dtl
     WHERE perushd_perush_kode = ?`,
    [perushKode],
  );
  return rows;
};

// ─────────────────────────────────────────────────────────
// SAVE
// Sesuai Delphi simpandata
// ─────────────────────────────────────────────────────────
const save = async (data, userKode, isNew) => {
  const {
    Divisi,
    KodePerush,
    Tanggal,
    Keterangan,
    KodeCus,
    AlamatCus,
    KotaCus,
    GudangKode,
    InvPro = "",
    PraSJ = "",
    // Invoice fields
    InvNomor = "",
    StsPpn = 0,
    Ppn = 0,
    Disc = 0,
    RekBank = "",
    // PIN5
    Xminta5 = "",
    Xurut5 = 0,
    Detail = [],
    // Edit
    NomorSJ = "",
  } = data;

  // ── Validasi ──────────────────────────────────────────
  if (!KodePerush) throw new Error("Perusahaan belum diisi.");
  if (!GudangKode) throw new Error("Gudang tidak boleh kosong.");
  if (!KodeCus) throw new Error("Customer belum diisi.");

  const validDetail = Detail.filter((r) => r.NamaSpk && Number(r.Jumlah) !== 0);
  if (!validDetail.length) throw new Error("Detail harus diisi.");

  // Cek jumlah tidak melebihi kurang
  for (const row of validDetail) {
    if (Number(row.Jumlah) > Number(row.Kurang)) {
      throw new Error(
        `Jumlah tidak boleh melebihi kekurangannya (SPK: ${row.SpkNomor}).`,
      );
    }
  }

  const totalJumlah = validDetail.reduce((s, r) => s + Number(r.Jumlah), 0);
  if (totalJumlah === 0) throw new Error("Jumlah SJ masih kosong semua.");

  const nomorPo = buildNomorPo(validDetail);

  // Cek tutup buku
  const tutupBuku = await cekTutupBuku(Tanggal, Xminta5);
  if (!tutupBuku.boleh) {
    throw new Error(tutupBuku.message);
  }

  // Cek status approved saat edit
  if (!isNew) {
    const [[approveCheck]] = await db.query(
      `SELECT sj_approve FROM tsj_hdr WHERE sj_nomor = ?`,
      [NomorSJ],
    );
    if (approveCheck?.sj_approve === 1) {
      throw new Error("Sudah di Approve.\nTidak bisa disimpan.");
    }

    const sudahInv = await cekStatusInv(NomorSJ);
    if (sudahInv) {
      throw new Error(
        "Surat Jalan ini sudah dibuat invoice, tidak bisa di edit.",
      );
    }
  }

  const divisiStr = String(Divisi).charAt(0);
  // Tanggal cutoff AI (08-06-2023)
  const dtAI = new Date("2023-06-08");
  const isAI =
    KodePerush === "AI" && divisiStr !== "3" && new Date(Tanggal) >= dtAI;

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    let nomor = isNew
      ? await generateNomor(KodePerush, Tanggal, conn)
      : NomorSJ;

    // ── Header ────────────────────────────────────────
    if (isNew) {
      await conn.query(
        `INSERT INTO tsj_hdr
          (sj_nomor, sj_divisi, sj_tanggal, sj_keterangan, sj_no_po,
            sj_perush_kode, sj_cus_kode, sj_gdg_kode,
            sj_alamat_customer, sj_kota_customer,
            sj_inv_pro, sj_inv_sm, date_create, user_create)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,NOW(),?)`,
        [
          nomor,
          divisiStr,
          Tanggal,
          Keterangan,
          nomorPo,
          KodePerush,
          KodeCus,
          GudangKode,
          AlamatCus,
          KotaCus,
          InvPro,
          InvNomor,
          userKode,
        ],
      );
    } else {
      const updateField = data.IsZdivisi
        ? `user_produksi = ?, date_produksi = NOW()`
        : `user_modified = ?, date_modified = NOW()`;
      await conn.query(
        `UPDATE tsj_hdr SET
          sj_tanggal = ?, sj_keterangan = ?, sj_no_po = ?,
          sj_perush_kode = ?, sj_cus_kode = ?,
          sj_gdg_kode = ?,
          sj_alamat_customer = ?, sj_kota_customer = ?,
          sj_inv_pro = ?,
          ${updateField}
         WHERE sj_nomor = ?`,
        [
          Tanggal,
          Keterangan,
          nomorPo,
          KodePerush,
          KodeCus,
          GudangKode,
          AlamatCus,
          KotaCus,
          InvPro,
          userKode,
          nomor,
        ],
      );

      // Update PraSJ jika ada
      if (PraSJ) {
        await conn.query(
          `UPDATE tprasj_hdr SET
             sj_keterangan = ?, sj_cus_kode = ?,
             sj_gdg_kode = ?,
             sj_alamat_customer = ?, sj_kota_customer = ?,
             date_modified = NOW(), user_modified = ?
           WHERE sj_pra = ?`,
          [
            Keterangan,
            KodeCus,
            GudangKode,
            AlamatCus,
            KotaCus,
            userKode,
            PraSJ,
          ],
        );
      }
    }

    // ── Invoice AI ─────────────────────────────────────
    let invNomor = InvNomor;
    if (isAI) {
      if (!invNomor) {
        invNomor = await generateNomorInvoice(KodePerush, Tanggal, conn);
        await conn.query(
          `INSERT INTO tinv_hdr
             (inv_nomor, inv_divisi, inv_tanggal, inv_keterangan,
              inv_perush_kode, inv_cus_kode, inv_cus_alamat, inv_rekening,
              inv_tanggal_tempo, inv_invpro, inv_sts_ppn, inv_ppn,
              inv_flag, inv_disc, date_create, user_create)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,NOW(),?)`,
          [
            invNomor,
            divisiStr,
            Tanggal,
            Keterangan,
            KodePerush,
            KodeCus,
            AlamatCus,
            RekBank,
            new Date(new Date(Tanggal).getTime() + 30 * 24 * 60 * 60 * 1000),
            InvPro,
            StsPpn,
            Ppn,
            InvPro ? 1 : 0,
            Disc,
            userKode,
          ],
        );
        // Update header dengan inv_sm
        await conn.query(
          `UPDATE tsj_hdr SET sj_inv_sm = ? WHERE sj_nomor = ?`,
          [invNomor, nomor],
        );
      } else {
        await conn.query(
          `UPDATE tinv_hdr SET
             inv_tanggal = ?, inv_cus_kode = ?,
             inv_cus_alamat = ?, inv_rekening = ?,
             inv_disc = ?, inv_sts_ppn = ?, inv_ppn = ?
           WHERE inv_nomor = ?`,
          [Tanggal, KodeCus, AlamatCus, RekBank, Disc, StsPpn, Ppn, invNomor],
        );
        await conn.query(`DELETE FROM tinv_dtl WHERE invd_inv_nomor = ?`, [
          invNomor,
        ]);
      }
    }

    // ── Detail ─────────────────────────────────────────
    await conn.query(`DELETE FROM tsj_dtl WHERE sjd_sj_nomor = ?`, [nomor]);
    if (PraSJ) {
      await conn.query(`DELETE FROM tprasj_dtl WHERE sjd_pra = ?`, [PraSJ]);
    }

    let urut = 1;
    for (const row of validDetail) {
      await conn.query(
        `INSERT INTO tsj_dtl
           (sjd_sj_nomor, sjd_spk_nomor, sjd_jumlah, sjd_harga,
            sjd_koli, sjd_ukuran, sjd_keterangan, sjd_nourut,
            sjd_nokirim, sjd_idkirim)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [
          nomor,
          row.SpkNomor,
          Number(row.Jumlah),
          Number(row.Harga || 0),
          Number(row.Koli || 0),
          row.Ukuran || "",
          row.Keterangan || "",
          urut,
          row.NoKirim || "",
          Number(row.IdKirim || 0),
        ],
      );

      if (PraSJ) {
        await conn.query(
          `INSERT INTO tprasj_dtl
             (sjd_sj_nomor, sjd_spk_nomor, sjd_jumlah,
              sjd_koli, sjd_ukuran, sjd_keterangan, sjd_nourut)
           VALUES (?,?,?,?,?,?,?)`,
          [
            PraSJ,
            row.SpkNomor,
            Number(row.Jumlah),
            Number(row.Koli || 0),
            row.Ukuran || "",
            row.Keterangan || "",
            urut,
          ],
        );
      }

      if (isAI && invNomor) {
        await conn.query(
          `INSERT INTO tinv_dtl
             (invd_inv_nomor, invd_sj_nomor, invd_spk_nomor,
              invd_ukuran, invd_jumlah, invd_harga, invd_nourut)
           VALUES (?,?,?,?,?,?,?)`,
          [
            invNomor,
            nomor,
            row.SpkNomor,
            row.Ukuran || "",
            Number(row.Jumlah),
            Number(row.Harga || 0),
            urut,
          ],
        );
      }

      urut++;
    }

    // ── PIN5 ACC → tandai dipakai ──────────────────────
    if (Xminta5 === "ACC" && Xurut5) {
      await conn.query(
        `UPDATE tspk_pin5 SET pin_dipakai = 'Y'
         WHERE pin_trs = 'SJ' AND pin_nomor = ? AND pin_urut = ?`,
        [nomor, Xurut5],
      );
    }

    await conn.commit();
    return { nomor, invNomor };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
};

// ─────────────────────────────────────────────────────────
// CETAK — data untuk print view
// ─────────────────────────────────────────────────────────
const getDataCetak = async (nomor) => {
  const [[hdr]] = await db.query(
    `SELECT h.*,
          p.perush_nama, p.perush_alamat, p.perush_kota, p.perush_telp, p.perush_email,
          c.cus_nama, c.cus_alamat, c.cus_kota, c.cus_telp, c.cus_fax,
          g.gdg_nama,
          DATE_FORMAT(h.date_create,'%d-%m-%Y %T') AS created
     FROM tsj_hdr h
     INNER JOIN tperusahaan p ON p.perush_kode = h.sj_perush_kode
     INNER JOIN tcustomer   c ON c.cus_kode    = h.sj_cus_kode
     LEFT JOIN  tgudang     g ON g.gdg_kode    = h.sj_gdg_kode
     WHERE h.sj_nomor = ?`,
    [nomor],
  );
  if (!hdr) throw new Error("Data tidak ditemukan.");

  // 1. Normalisasi semua key menjadi huruf kecil (lowercase)
  const normalizedHdr = Object.keys(hdr).reduce((acc, key) => {
    acc[key.toLowerCase()] = hdr[key];
    return acc;
  }, {});

  // 2. Fallback: Jika di database kolomnya bernama "sj_ket",
  // kita petakan ke "sj_keterangan" agar frontend bisa membacanya
  if (!normalizedHdr.sj_keterangan && normalizedHdr.sj_ket !== undefined) {
    normalizedHdr.sj_keterangan = normalizedHdr.sj_ket;
  }

  normalizedHdr.keterangan_cetak =
    (normalizedHdr.sj_keterangan || "").trim() !== ""
      ? normalizedHdr.sj_keterangan
      : normalizedHdr.sj_no_po || "";

  const [dtl] = await db.query(
    `SELECT d.sjd_spk_nomor, d.sjd_ukuran, d.sjd_jumlah,
            d.sjd_koli, d.sjd_keterangan, d.sjd_nokirim,
            s.spk_nama, s.spk_nama2, s.spk_panjang, s.spk_lebar
     FROM tsj_dtl d
     LEFT JOIN tspk s ON s.spk_nomor = d.sjd_spk_nomor
     WHERE d.sjd_sj_nomor = ?
     ORDER BY d.sjd_nourut`,
    [nomor],
  );

  const totalJumlah = dtl.reduce((s, r) => s + Number(r.sjd_jumlah || 0), 0);

  // Return header yang sudah dinormalisasi
  return { header: normalizedHdr, detail: dtl, totalJumlah };
};

// ─────────────────────────────────────────────────────────
// OTORISASI SPK BELUM LUNAS
// Sesuai Delphi btnOkClick — challenge/response dengan tabel totoritator
// ─────────────────────────────────────────────────────────

// Generate kode tantangan (3 digit dari timestamp, sesuai Delphi DateTimeToString cpin RightStr(cpin,3))
const generateKodeOtorisasi = () => {
  const now = new Date();
  const ms = String(now.getMilliseconds()).padStart(3, "0");
  return ms; // 3 digit terakhir, sesuai RightStr(cpin,3)
};

// Validasi kode otorisasi yang diinput user
const validateOtorisasi = async (kodeOtorisasi, jawaban) => {
  const jawabanTrim = String(jawaban).trim();
  if (!jawabanTrim) {
    return { valid: false, message: "Kode otorisasi belum diisi." };
  }

  const hurufAkhir = jawabanTrim.slice(-1);
  const angkaStr = jawabanTrim.slice(0, -1);

  // Cek huruf terakhir terdaftar sebagai otorisator
  const [[otorisator]] = await db.query(
    `SELECT kode, nama FROM retail.totoritator WHERE kode = ?`,
    [hurufAkhir],
  );
  if (!otorisator) {
    return {
      valid: false,
      message: "Otorisasi salah (kode otorisator tidak dikenal).",
    };
  }

  // Validasi rumus: kodeOtorisasi * 21 + 212 = angka
  const angka = parseFloat(angkaStr);
  if (isNaN(angka)) {
    return { valid: false, message: "Otorisasi salah (format tidak valid)." };
  }

  const expected = parseFloat(kodeOtorisasi) * 21 + 53 * 4;
  if (Math.abs(angka - expected) > 0.001) {
    return { valid: false, message: "Otorisasi salah." };
  }

  return { valid: true, otorisator: otorisator.nama };
};

// Simpan otorisasi yang berhasil
const saveOtorisasi = async (spkNomor, kodeOtorisasiJawaban) => {
  await db.query(
    `INSERT INTO tsj_otorisasi (sjo_spk_nomor, sjo_Tanggal, sjo_otorisasi)
     VALUES (?, NOW(), ?)`,
    [spkNomor, kodeOtorisasiJawaban],
  );
};

module.exports = {
  generateNomor,
  getById,
  getSudah,
  getSpkDetail,
  getSpkDetailFromJadwal,
  getSpkList,
  getJadwalKirimList,
  cekPiutang,
  cekStatusInv,
  cekTutupBuku,
  getAlokasiHistory,
  getAlokasiSpk,
  getDivisiList,
  getInvProformaList,
  getRekeningPerush,
  save,
  getDataCetak,
  generateKodeOtorisasi,
  validateOtorisasi,
  saveOtorisasi,
};
