const db = require("../../config/database");
const tutupBukuService = require("../tutupBukuService");

// ═══════════════════════════════════════════════════════════
// INVOICE TAK NORMAL — FORM SERVICE
// Migrasi dari ufrmInvTakNormal.pas (Delphi)
// pin_trs untuk approval/pengajuan: 'INV TAKNORMAL'
// inv_sts_pro selalu = 2 untuk semua record di modul ini
// TIDAK ada konsep Disc/Pph di modul ini (beda dari Invoice biasa)
// ═══════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────
// GENERATE NOMOR
// Format: INT/{kodePerush}/{NNNNN}/{YYYY}
// ─────────────────────────────────────────────────────────
const generateNomor = async (kodePerush, tanggal, conn) => {
  const tahun = new Date(tanggal).getFullYear();
  const prefix = `INT/${kodePerush}`;

  const [[row]] = await conn.query(
    `SELECT IFNULL(MAX(CAST(SUBSTR(inv_nomor, 8, 5) AS UNSIGNED)), 0) AS max_val
     FROM tinv_hdr
     WHERE LEFT(inv_nomor, 6) = ?
       AND RIGHT(inv_nomor, 4) = ?
     FOR UPDATE`,
    [prefix, String(tahun)],
  );
  const next = parseInt(row.max_val, 10) + 1;
  return `${prefix}/${String(next).padStart(5, "0")}/${tahun}`;
};

// ─────────────────────────────────────────────────────────
// GET DEBET (uang muka) — sesuai Delphi getdebet
// CATATAN: query lebih sederhana dari Invoice biasa (langsung
// piutang_debet.kredit, tidak lewat piutang_kredit_detail)
// ─────────────────────────────────────────────────────────
const getDebet = async (nomor) => {
  const [[row]] = await db.query(
    `SELECT IFNULL(kredit,0) AS kredit FROM piutang_debet WHERE nota = ?`,
    [nomor],
  );
  return row ? Number(row.kredit) || 0 : 0;
};

// ─────────────────────────────────────────────────────────
// GET BY NOMOR (load edit — loaddataall)
// ─────────────────────────────────────────────────────────
const getById = async (nomor) => {
  const [[hdr]] = await db.query(
    `SELECT
       a.inv_nomor, DATE_FORMAT(a.inv_tanggal,'%Y-%m-%d') AS inv_tanggal,
       a.inv_divisi, a.inv_keterangan,
       a.inv_perush_kode, p.perush_nama,
       a.inv_cus_kode, c.cus_nama, c.cus_alamat, c.cus_kota,
       a.inv_cus_alamat,
       DATE_FORMAT(a.inv_tanggal_tempo,'%Y-%m-%d') AS inv_tanggal_tempo,
       a.inv_rekening, pd.perushd_bank, pd.perushd_atasnama,
       a.inv_sts_ppn, a.inv_ppn
     FROM tinv_hdr a
     INNER JOIN tperusahaan p ON p.perush_kode = a.inv_perush_kode
     INNER JOIN tcustomer c ON c.cus_kode = a.inv_cus_kode
     LEFT JOIN tperusahaan_dtl pd
       ON pd.perushd_perush_kode = p.perush_kode
       AND pd.perushd_rekening = a.inv_rekening
     WHERE a.inv_nomor = ? AND a.inv_sts_pro = 2`,
    [nomor],
  );
  if (!hdr) throw new Error("Nomor tersebut belum ada.");

  hdr.uang_muka = await getDebet(nomor);

  // Detail barang — sesuai Delphi loaddataall (JOIN tbarang + LEFT tspk)
  const [dtl] = await db.query(
    `SELECT
       d.invd_spk_nomor, d.invd_ukuran, d.invd_jumlah, d.invd_harga, d.invd_nourut,
       IFNULL(s.spk_nama2, b.brg_name) AS spk_nama2
     FROM tinv_dtl d
     INNER JOIN tbarang b ON b.brg_kode = d.invd_spk_nomor
     LEFT JOIN tspk s ON s.spk_nomor = d.invd_spk_nomor
     WHERE d.invd_inv_nomor = ?
     ORDER BY d.invd_nourut`,
    [nomor],
  );

  // Daftar Invoice Normal terkait — sesuai Delphi loaddataall + loop query
  // per baris (di sini digabung jadi satu query, hasil identik)
  const [invoiceNormalList] = await db.query(
    `SELECT
       f.invf_normal AS Nomor,
       IFNULL((
         SELECT v.divisi FROM tinv_hdr a2
         LEFT JOIN tdivisi v ON v.kode = a2.inv_divisi
         WHERE a2.inv_nomor = f.invf_normal
       ), '')                                          AS Cabang,
       (
         SELECT DATE_FORMAT(a2.inv_tanggal,'%d-%m-%Y')
         FROM tinv_hdr a2 WHERE a2.inv_nomor = f.invf_normal
       )                                                AS Tanggal,
       IFNULL((
         SELECT a2.inv_cus_kode FROM tinv_hdr a2 WHERE a2.inv_nomor = f.invf_normal
       ), '')                                          AS KodeCus,
       IFNULL((
         SELECT c2.cus_nama FROM tinv_hdr a2
         LEFT JOIN tcustomer c2 ON c2.cus_kode = a2.inv_cus_kode
         WHERE a2.inv_nomor = f.invf_normal
       ), '')                                          AS NamaCustomer,
       IFNULL((
         SELECT c2.cus_alamat FROM tinv_hdr a2
         LEFT JOIN tcustomer c2 ON c2.cus_kode = a2.inv_cus_kode
         WHERE a2.inv_nomor = f.invf_normal
       ), '')                                          AS Alamat,
       IFNULL((
         SELECT SUM(b2.invd_harga*b2.invd_jumlah*IF(a2.inv_sts_ppn=1,((100+a2.inv_ppn)/100),1))
         FROM tinv_hdr a2 LEFT JOIN tinv_dtl b2 ON a2.inv_nomor = b2.invd_inv_nomor
         WHERE a2.inv_nomor = f.invf_normal
       ), 0)                                            AS Nominal
     FROM tinv_flag f
     WHERE f.invf_taknormal = ?`,
    [nomor],
  );

  // PIN5 status — pin_trs = 'INV TAKNORMAL'
  const [[pin5]] = await db.query(
    `SELECT pin_urut, pin_acc, pin_dipakai, pin_alasan
     FROM tspk_pin5
     WHERE pin_trs = 'INV TAKNORMAL' AND pin_nomor = ?
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

  // Status tutup buku — pola sama seperti modul Penjualan lainnya
  const tglTrs = new Date(hdr.inv_tanggal);
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
  const zCloseManual =
    await tutupBukuService.getManualTutupBuku("INV TAKNORMAL");
  let isTutupBuku = false;
  if (zCloseManual) {
    zCloseManual.setHours(0, 0, 0, 0);
    if (tglTrs < zCloseManual) isTutupBuku = true;
  } else {
    if (limitDate < today) isTutupBuku = true;
  }
  hdr.isTutupBuku = isTutupBuku;

  return { header: hdr, detail: dtl, invoiceNormalList, xminta5, xurut5 };
};

// ─────────────────────────────────────────────────────────
// SEARCH BARANG (F1 di grid detail)
// Sesuai Delphi: tbarang LEFT JOIN tspk WHERE spk_nomor IS NULL
// OR spk_cus_kode = customer. TIDAK ada filter spk_is_so — modul
// ini tidak terikat alur SJ/pengiriman sama sekali.
// ─────────────────────────────────────────────────────────
const searchBarang = async (cusKode, q = "") => {
  const like = `%${q}%`;
  let where = `(s.spk_nomor IS NULL OR s.spk_cus_kode = ?)`;
  const params = [cusKode];

  if (q) {
    where += ` AND (b.brg_kode LIKE ? OR b.brg_name LIKE ?)`;
    params.push(like, like);
  }

  const [rows] = await db.query(
    `SELECT b.brg_kode AS Kode, b.brg_name AS Nama,
            b.brg_ukuran AS Ukuran, b.brg_harga AS Harga
     FROM tbarang b
     LEFT JOIN tspk s ON s.spk_nomor = b.brg_kode
     WHERE ${where}
     ORDER BY b.brg_kode
     LIMIT 200`,
    params,
  );
  return rows;
};

// ─────────────────────────────────────────────────────────
// LOAD DETAIL BARANG — sesuai Delphi loaddatadetail
// Jumlah selalu default 1 (bukan dihitung dari kurang/sisa)
// ─────────────────────────────────────────────────────────
const loadBarangDetail = async (kode) => {
  const [[row]] = await db.query(
    `SELECT b.brg_kode, b.brg_name, b.brg_ukuran, b.brg_harga
     FROM tbarang b
     WHERE b.brg_kode = ?`,
    [kode],
  );
  if (!row) throw new Error("Barang Tidak di temukan.");
  return {
    Kode: row.brg_kode,
    Nama: row.brg_name,
    Ukuran: row.brg_ukuran,
    Harga: row.brg_harga,
    Jumlah: 1,
  };
};

// ─────────────────────────────────────────────────────────
// SEARCH PERUSAHAAN
// ─────────────────────────────────────────────────────────
const searchPerusahaan = async (q = "") => {
  const like = `%${q}%`;
  const [rows] = await db.query(
    `SELECT perush_kode, perush_nama
     FROM tperusahaan
     WHERE perush_kode LIKE ? OR perush_nama LIKE ?
     ORDER BY perush_kode
     LIMIT 50`,
    [like, like],
  );
  return rows;
};

// ─────────────────────────────────────────────────────────
// CUSTOMER INFO — sesuai Delphi edtCusKodeExit
// ─────────────────────────────────────────────────────────
const getCustomerInfo = async (kode) => {
  const [[row]] = await db.query(
    `SELECT cus_kode, cus_nama, cus_alamat, cus_kota, cus_top, cus_aktif
     FROM tcustomer WHERE cus_kode = ?`,
    [kode],
  );
  if (!row) throw new Error("Kode tidak ditemukan.");
  if (row.cus_aktif === 1) throw new Error("Status pasif.");
  return row;
};

// ─────────────────────────────────────────────────────────
// GET REKENING PERUSAHAAN
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
// GET DIVISI LIST
// ─────────────────────────────────────────────────────────
const getDivisiList = async () => {
  const [rows] = await db.query(
    `SELECT kode, divisi AS nama FROM tdivisi WHERE kode <> 0 ORDER BY kode`,
  );
  return rows;
};

// ─────────────────────────────────────────────────────────
// GET INVOICE NORMAL LIST (F1 = Spanduk, F4 = Garmen)
// Sesuai Delphi bantuanpinv: WHERE inv_sts_pro=0 AND inv_flag=0
// ASUMSI mapping divisi (perlu dikonfirmasi):
//   spanduk -> kode divisi '1'
//   garmen  -> kode divisi '4','6'
// Delphi asli TIDAK filter divisi sama sekali di query bantuanpinv
// yang diberikan — filter ini ditambahkan mengikuti instruksi
// eksplisit soal F1/F4, bukan dari kode Delphi yang ada.
// ─────────────────────────────────────────────────────────
const DIVISI_GROUP_MAP = {
  spanduk: ["1"],
  garmen: ["4", "6"],
};

const getInvoiceNormalList = async (
  divisiGroup,
  q = "",
  page = 1,
  limit = 50,
) => {
  const kodeList = DIVISI_GROUP_MAP[divisiGroup];
  if (!kodeList || !kodeList.length) return { items: [], total: 0 };

  const limitNum = Number(limit);
  const offset = (Number(page) - 1) * limitNum;
  const placeholders = kodeList.map(() => "?").join(",");
  const like = `%${q}%`;

  let where = `h.inv_sts_pro = 0 AND h.inv_flag = 0 AND h.inv_divisi IN (${placeholders})`;
  const params = [...kodeList];

  if (q) {
    where += ` AND (h.inv_nomor LIKE ? OR c.cus_nama LIKE ?)`;
    params.push(like, like);
  }

  const [[{ total }]] = await db.query(
    `SELECT COUNT(*) AS total
     FROM tinv_hdr h
     LEFT JOIN tcustomer c ON c.cus_kode = h.inv_cus_kode
     WHERE ${where}`,
    params,
  );

  const [rows] = await db.query(
    `SELECT h.inv_nomor AS Nomor, DATE_FORMAT(h.inv_tanggal,'%d-%m-%Y') AS Tanggal,
            h.inv_cus_kode AS KodeCus, IFNULL(c.cus_nama,'') AS Customer,
            IFNULL(c.cus_alamat,'') AS Alamat,
            IFNULL((
              SELECT SUM(b.invd_harga*b.invd_jumlah*IF(a.inv_sts_ppn=1,((100+a.inv_ppn)/100),1))
              FROM tinv_hdr a LEFT JOIN tinv_dtl b ON a.inv_nomor=b.invd_inv_nomor
              WHERE a.inv_nomor=h.inv_nomor
            ), 0)                                       AS Nominal,
            v.divisi                                    AS Divisi
     FROM tinv_hdr h
     LEFT JOIN tdivisi v ON v.kode = h.inv_divisi
     LEFT JOIN tcustomer c ON c.cus_kode = h.inv_cus_kode
     WHERE ${where}
     ORDER BY h.inv_nomor DESC
     LIMIT ? OFFSET ?`,
    [...params, limitNum, offset],
  );
  return { items: rows, total, page: Number(page), limit: limitNum };
};

// ─────────────────────────────────────────────────────────
// VALIDATE INVOICE NORMAL — sesuai Delphi loadinv(ckode)
// Dipakai baik untuk hasil pilih F1/F4 maupun input manual di grid.
// Cascade validasi:
//   1. Invoice harus ada
//   2. (Tambahan/deviasi) harus inv_sts_pro=0 — Delphi asli tidak
//      cek ini di loadinv(), cuma di query F1-nya. Ditambahkan di
//      sini sbg proteksi.
//   3. Kalau inv_flag=0 -> aman, boleh dipakai
//   4. Kalau inv_flag<>0 -> cek tinv_flag:
//      - Tidak ketemu -> "belum masuk ke data piutang" (block)
//      - invf_taknormal beda dari currentTakNormalNomor -> block,
//        kasih tau sudah dipakai oleh nomor tak-normal yang mana
//      - invf_taknormal = currentTakNormalNomor -> boleh (baris
//        yang memang sedang di-edit)
// ─────────────────────────────────────────────────────────
const validateInvoiceNormal = async (
  nomorInvNormal,
  currentTakNormalNomor = "",
) => {
  const [[inv]] = await db.query(
    `SELECT h.inv_nomor AS Nomor, DATE_FORMAT(h.inv_tanggal,'%d-%m-%Y') AS Tanggal,
            h.inv_flag, h.inv_sts_pro,
            h.inv_cus_kode AS KodeCus, IFNULL(c.cus_nama,'') AS NamaCustomer,
            IFNULL(c.cus_alamat,'') AS Alamat,
            IFNULL((
              SELECT SUM(b.invd_harga*b.invd_jumlah*IF(a.inv_sts_ppn=1,((100+a.inv_ppn)/100),1))
              FROM tinv_hdr a LEFT JOIN tinv_dtl b ON a.inv_nomor=b.invd_inv_nomor
              WHERE a.inv_nomor=h.inv_nomor
            ), 0)                                       AS Nominal,
            v.divisi                                    AS Cabang
     FROM tinv_hdr h
     LEFT JOIN tcustomer c ON c.cus_kode = h.inv_cus_kode
     LEFT JOIN tdivisi v ON v.kode = h.inv_divisi
     WHERE h.inv_nomor = ?`,
    [nomorInvNormal],
  );
  if (!inv) throw new Error("Invoice ini belum ada.");

  // Deviasi dari Delphi — loadinv() aslinya tidak cek inv_sts_pro sama
  // sekali (hanya inv_flag). Ditambahkan sbg proteksi supaya invoice
  // Proforma/Tak Normal lain tidak bisa ke-input tidak sengaja lewat
  // ketik manual (jalur F1/F4 sendiri sudah aman krn sudah difilter).
  if (Number(inv.inv_sts_pro) !== 0) {
    throw new Error("Invoice tersebut bukan Invoice Normal.");
  }

  if (Number(inv.inv_flag) === 0) {
    return inv; // belum diklaim tak-normal manapun, aman dipakai
  }

  // Sudah diklaim — cek oleh siapa
  const [[flag]] = await db.query(
    `SELECT f.invf_taknormal, DATE_FORMAT(h.inv_tanggal,'%d-%m-%Y') AS Tanggal
     FROM tinv_flag f
     INNER JOIN tinv_hdr h ON h.inv_nomor = f.invf_taknormal
     WHERE f.invf_normal = ?`,
    [nomorInvNormal],
  );

  if (!flag) {
    throw new Error("Invoice tsb blm masuk ke data piutang.");
  }
  if (flag.invf_taknormal !== currentTakNormalNomor) {
    throw new Error(
      `Invoice tsb sudah di buatkan INV TAK NORMAL.\nDengan No: ${flag.invf_taknormal}\nTgl: ${flag.Tanggal}`,
    );
  }
  // invf_taknormal = currentTakNormalNomor -> baris yg sedang diedit, boleh
  return inv;
};

// ─────────────────────────────────────────────────────────
// CEK TUTUP BUKU — pin_trs = 'INV TAKNORMAL'
// ─────────────────────────────────────────────────────────
const cekTutupBuku = async (tanggal, xminta5 = "") => {
  if (["MINTA", "WAIT", "TOLAK"].includes(xminta5)) {
    return {
      boleh: false,
      message:
        "Transaksi tsb sudah diclose.\nSilahkan minta approve untuk bisa menyimpan perubahan data.",
    };
  }
  if (xminta5 === "ACC") return { boleh: true };

  const tgl = new Date(tanggal);
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

  const zCloseManual =
    await tutupBukuService.getManualTutupBuku("INV TAKNORMAL");

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
// SAVE — sesuai Delphi simpandata
// ─────────────────────────────────────────────────────────
const save = async (data, userKode, isNew) => {
  const {
    Divisi,
    KodePerush,
    Tanggal,
    Keterangan,
    KodeCus,
    AlamatCus,
    TanggalTempo,
    RekBank = "",
    StsPpn = 0,
    Ppn = 0,
    Detail = [],
    InvoiceNormalList = [],
    NomorInv = "",
    Xminta5 = "",
    Xurut5 = 0,
  } = data;

  // ── Validasi dasar — sesuai Delphi VK_F10 handler ───────
  if (!KodePerush) throw new Error("Perusahaan belum di isi.");
  if (!KodeCus) throw new Error("Customer belum di isi.");

  const validDetail = Detail.filter((r) => r.Kode && Number(r.Jumlah) !== 0);
  if (!validDetail.length)
    throw new Error("Tidak ada detail, tidak dapat di simpan.");

  // WAJIB — minimal satu Invoice Normal harus ditunjuk
  const validInvNormal = InvoiceNormalList.filter((r) => r.Nomor);
  if (!validInvNormal.length) throw new Error("Invoice normal belum ditunjuk.");

  const tutupBuku = await cekTutupBuku(Tanggal, Xminta5);
  if (!tutupBuku.boleh) throw new Error(tutupBuku.message);

  const divisiStr = String(Divisi).charAt(0);
  const xppn = StsPpn ? Number(Ppn) : 0;

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    let nomor = isNew
      ? await generateNomor(KodePerush, Tanggal, conn)
      : NomorInv;

    // ── Header ────────────────────────────────────────────
    if (isNew) {
      await conn.query(
        `INSERT INTO tinv_hdr
           (inv_nomor, inv_divisi, inv_tanggal, inv_keterangan,
            inv_perush_kode, inv_cus_kode, inv_cus_alamat,
            inv_tanggal_tempo, inv_sts_pro, inv_rekening,
            date_create, user_create, inv_sts_ppn, inv_ppn)
         VALUES (?,?,?,?,?,?,?,?,2,?,NOW(),?,?,?)`,
        [
          nomor,
          divisiStr,
          Tanggal,
          Keterangan,
          KodePerush,
          KodeCus,
          AlamatCus,
          TanggalTempo,
          RekBank,
          userKode,
          StsPpn,
          xppn,
        ],
      );
    } else {
      await conn.query(
        `UPDATE tinv_hdr SET
           inv_tanggal = ?, inv_keterangan = ?,
           inv_perush_kode = ?, inv_cus_kode = ?, inv_cus_alamat = ?,
           inv_tanggal_tempo = ?, inv_rekening = ?,
           inv_sts_ppn = ?, inv_ppn = ?,
           date_modified = NOW(), user_modified = ?
         WHERE inv_nomor = ?`,
        [
          Tanggal,
          Keterangan,
          KodePerush,
          KodeCus,
          AlamatCus,
          TanggalTempo,
          RekBank,
          StsPpn,
          xppn,
          userKode,
          nomor,
        ],
      );
    }

    // ── Detail barang ────────────────────────────────────
    await conn.query(`DELETE FROM tinv_dtl WHERE invd_inv_nomor = ?`, [nomor]);
    let urut = 1;
    for (const row of validDetail) {
      await conn.query(
        `INSERT INTO tinv_dtl
           (invd_inv_nomor, invd_spk_nomor, invd_ukuran, invd_jumlah, invd_harga, invd_nourut)
         VALUES (?,?,?,?,?,?)`,
        [
          nomor,
          row.Kode,
          row.Ukuran || "",
          Number(row.Jumlah),
          Number(row.Harga || 0),
          urut,
        ],
      );
      urut++;
    }

    // ── Sinkronisasi tinv_flag (invoice normal yang dinaungi) ──
    // CATATAN PENTING — DEVIASI DARI DELPHI:
    // Delphi asli langsung DELETE semua tinv_flag lama lalu INSERT ulang
    // dari grid saat ini, TANPA pernah reset inv_flag=0/piutang_debet.flag=0
    // untuk invoice yang di-DROP dari grid saat edit. Efeknya invoice yang
    // sempat di-link lalu dihapus dari daftar akan "nyangkut" statusnya
    // selamanya (hanya ter-reset kalau seluruh header Tak Normal dihapus
    // dari browse). Ini kemungkinan bug laten — DIPERBAIKI di sini dengan
    // membandingkan daftar lama vs baru dan me-reset yang di-drop.
    const [oldLinked] = await conn.query(
      `SELECT invf_normal FROM tinv_flag WHERE invf_taknormal = ?`,
      [nomor],
    );
    const newNomorSet = new Set(validInvNormal.map((r) => r.Nomor));
    for (const row of oldLinked) {
      if (!newNomorSet.has(row.invf_normal)) {
        await conn.query(
          `UPDATE tinv_hdr SET inv_flag = 0 WHERE inv_nomor = ?`,
          [row.invf_normal],
        );
        await conn.query(`UPDATE piutang_debet SET flag = 0 WHERE nota = ?`, [
          row.invf_normal,
        ]);
      }
    }

    await conn.query(`DELETE FROM tinv_flag WHERE invf_taknormal = ?`, [nomor]);
    for (const row of validInvNormal) {
      await conn.query(
        `INSERT INTO tinv_flag (invf_taknormal, invf_normal) VALUES (?, ?)`,
        [nomor, row.Nomor],
      );
      await conn.query(`UPDATE tinv_hdr SET inv_flag = 1 WHERE inv_nomor = ?`, [
        row.Nomor,
      ]);
      await conn.query(`UPDATE piutang_debet SET flag = 1 WHERE nota = ?`, [
        row.Nomor,
      ]);
    }

    // ── PIN5 ACC dipakai ────────────────────────────────────
    if (Xminta5 === "ACC" && Xurut5) {
      await conn.query(
        `UPDATE tspk_pin5 SET pin_dipakai = 'Y'
         WHERE pin_trs = 'INV TAKNORMAL' AND pin_nomor = ? AND pin_urut = ?`,
        [nomor, Xurut5],
      );
    }

    await conn.commit();
    return { nomor };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
};

// ─────────────────────────────────────────────────────────
// GET DATA CETAK — sesuai Delphi doslipINV2
// CATATAN: tidak ada konsep Disc/Pph sama sekali di modul ini.
// ─────────────────────────────────────────────────────────
const getDataCetak = async (nomor) => {
  const [[hdr]] = await db.query(
    `SELECT
       a.inv_nomor, DATE_FORMAT(a.inv_tanggal,'%d-%m-%Y') AS inv_tanggal_fmt,
       a.inv_keterangan, a.inv_cus_alamat,
       a.inv_sts_ppn, a.inv_ppn,
       a.inv_rekening, a.inv_perush_kode,
       a.user_create,
       p.perush_nama, p.perush_alamat, p.perush_kota, p.perush_telp,
       c.cus_nama, c.cus_alamat, c.cus_telp, c.cus_fax,
       pd.perushd_bank, pd.perushd_atasnama,
       DATE_FORMAT(a.date_create,'%d-%m-%Y %T') AS created
     FROM tinv_hdr a
     INNER JOIN tperusahaan p ON p.perush_kode = a.inv_perush_kode
     INNER JOIN tcustomer c   ON c.cus_kode    = a.inv_cus_kode
     LEFT JOIN tperusahaan_dtl pd
       ON pd.perushd_perush_kode = p.perush_kode
       AND pd.perushd_rekening = a.inv_rekening
     WHERE a.inv_nomor = ? AND a.inv_sts_pro = 2`,
    [nomor],
  );
  if (!hdr) throw new Error("Data tidak ditemukan.");

  const [dtl] = await db.query(
    `SELECT
       d.invd_spk_nomor, d.invd_ukuran, d.invd_jumlah, d.invd_harga,
       d.invd_nourut,
       IFNULL(s.spk_nama2, b.brg_name) AS nama_barang
     FROM tinv_dtl d
     INNER JOIN tbarang b ON b.brg_kode = d.invd_spk_nomor
     LEFT JOIN tspk s ON s.spk_nomor = d.invd_spk_nomor
     WHERE d.invd_inv_nomor = ?
     ORDER BY d.invd_nourut`,
    [nomor],
  );

  const round = (v) => Math.round(Number(v) || 0);

  const totalBarang = dtl.reduce(
    (s, r) => s + round(Number(r.invd_jumlah || 0) * Number(r.invd_harga || 0)),
    0,
  );

  let totalPpn = 0;
  let grandTotal = totalBarang;
  if (Number(hdr.inv_sts_ppn) === 1) {
    totalPpn = round(totalBarang * (Number(hdr.inv_ppn) / 100));
    grandTotal = totalBarang + totalPpn;
  }

  const uangMuka = round(await getDebet(nomor));
  const nilaiPiutang = grandTotal - uangMuka;

  return {
    header: hdr,
    detail: dtl,
    totalBarang,
    totalPpn,
    grandTotal,
    uangMuka,
    nilaiPiutang,
  };
};

module.exports = {
  generateNomor,
  getById,
  getDebet,
  searchBarang,
  loadBarangDetail,
  searchPerusahaan,
  getCustomerInfo,
  getRekeningPerush,
  getDivisiList,
  getInvoiceNormalList,
  validateInvoiceNormal,
  cekTutupBuku,
  save,
  getDataCetak,
};
