const db = require("../../config/database");
const tutupBukuService = require("../tutupBukuService");

// ============================================================
// SPK Gudang — FORM SERVICE
// Header : tspk_gudang        (spg_)
// Detail 1 "Spesifikasi Kain" : tspk_gudangbarcode (spgb_)
// Detail 2 "SPK" (per warna)  : tspk_gudangitem    (spgi_)
// ============================================================

const MODUL_TUTUP_BUKU = "SPK GUDANG";

// ─────────────────────────────────────────────
// GENERATE NOMOR TRANSAKSI (getmaxnomor)
// Format: SPG-YY##### (100001+max, ambil 5 digit terakhir)
// ─────────────────────────────────────────────
const generateNomorTransaksi = async (tanggal, conn = db) => {
  const yy = String(new Date(tanggal).getFullYear()).slice(-2);
  const [[row]] = await conn.query(
    `SELECT IFNULL(MAX(RIGHT(spg_nomor,5)),0) AS jumlah
     FROM tspk_gudang WHERE LEFT(spg_nomor,6) = ?
     FOR UPDATE`,
    [`SPG-${yy}`],
  );
  const next = 100001 + Number(row.jumlah);
  return `SPG-${yy}${String(next).slice(-5)}`;
};

// ─────────────────────────────────────────────
// GENERATE NOMOR SPK ITEM per baris (getspk)
// Format: SPG-{KO/KK}-YY#####
// xno = counter in-memory dalam 1 sesi save (baris ke berapa yg baru)
// ─────────────────────────────────────────────
const generateSpkItemNomor = async (cjenis, tanggal, xno, conn = db) => {
  const yy = String(new Date(tanggal).getFullYear()).slice(-2);
  const prefix = `SPG-${cjenis}-${yy}`;
  const [[row]] = await conn.query(
    `SELECT IFNULL(MAX(RIGHT(spgi_spk,5)),0) AS jumlah
     FROM tspk_gudangitem WHERE LEFT(spgi_spk,9) = ?
     FOR UPDATE`,
    [prefix],
  );
  const next = 1000000 + xno + Number(row.jumlah);
  return `${prefix}${String(next).slice(-5)}`;
};

// ─────────────────────────────────────────────
// GET NEXT BCDID (getbcdid) — nomor barcode ID tahunan urut
// ─────────────────────────────────────────────
const getNextBcdId = async (tahun, conn = db) => {
  const [[row]] = await conn.query(
    `SELECT IFNULL(MAX(brg_bcdid),0) AS maxId
     FROM retail.tbarangdc WHERE DATE_FORMAT(date_create,'%Y') = ?
     FOR UPDATE`,
    [String(tahun)],
  );
  return Number(row.maxId) + 1;
};

// ─────────────────────────────────────────────
// RESOLVE KODE KAOSAN (getkodek)
// Cari existing di retail.tbarangdc; kalau tidak ada, generate baru
// dgn pola {jenis}-{kdkaink}-{kodewarna}-NNN, dan minta bcdid baru.
// Return { kode, bcdid, isNew }
// ─────────────────────────────────────────────
const resolveKodeKaosan = async (
  { jenis, finishing, lengan, kdKainKaosan, warna, kodeWarna, tanggal },
  conn = db,
) => {
  const [existing] = await conn.query(
    `SELECT brg_kode, brg_bcdid FROM retail.tbarangdc
     WHERE brg_jeniskaos = ? AND brg_tipe = ? AND brg_lengan = ?
       AND brg_jeniskain = ? AND brg_warna = ?`,
    [jenis, finishing, lengan, kdKainKaosan, warna],
  );
  if (existing.length > 0) {
    return {
      kode: existing[0].brg_kode,
      bcdid: existing[0].brg_bcdid,
      isNew: false,
    };
  }

  const ckode = `${jenis}-${kdKainKaosan}-${kodeWarna}`;
  const [maxRows] = await conn.query(
    `SELECT IFNULL(MAX(RIGHT(brg_kode,3)),0) AS jml
     FROM retail.tbarangdc WHERE LEFT(brg_kode,12) = ?
     ORDER BY brg_kode`,
    [ckode],
  );
  let kode;
  if (Number(maxRows[0].jml) === 0 && maxRows.length === 0) {
    kode = `${ckode}-001`;
  } else {
    const next = 1001 + Number(maxRows[0].jml);
    kode = `${ckode}-${String(next).slice(-3)}`;
  }
  const bcdid = await getNextBcdId(new Date(tanggal).getFullYear(), conn);
  return { kode, bcdid, isNew: true };
};

// ─────────────────────────────────────────────
// GET STOK PER KODE BAHAN (getstok — FIXED)
// Delphi aslinya selalu query pakai edtkdkain.Text (kode Jenis Kain
// header), mengabaikan parameter akode — jadi semua baris di grid
// Spesifikasi Kain tampil stok yang sama (basis header) + qty
// masing-masing. Di sini kita hitung stok BENERAN per kode/barcode.
// ─────────────────────────────────────────────
const getStokBahan = async (kode) => {
  const [[row]] = await db.query(
    `SELECT IFNULL(SUM(mst_stok_in - mst_stok_out),0) AS stok
     FROM tmasterstok_barcode
     WHERE mst_aktif = 'Y' AND mst_brg_kode = ?`,
    [kode],
  );
  return Number(row.stok) || 0;
};

// ─────────────────────────────────────────────
// LOOKUP JENIS KAIN (edtkdkainExit) — validasi + autofill
// ─────────────────────────────────────────────
const lookupJenisKain = async (kode) => {
  const [rows] = await db.query(
    `SELECT j.bj_nama, j.bj_kodek, t.JenisKain
     FROM tbahan_jenis j
     LEFT JOIN retail.tjeniskain t ON t.kode = j.bj_kodek
     WHERE j.bj_kode = ?`,
    [kode],
  );
  if (rows.length === 0) return null;
  return {
    namaJenisKain: rows[0].bj_nama,
    kdKainKaosan: rows[0].bj_kodek,
    namaKainKaosan: rows[0].JenisKain,
  };
};

// ─────────────────────────────────────────────
// SEARCH BARCODE BAHAN (F1 clbarcode2, mode Ambil Stok Gudang)
// Hanya barcode dengan stok <> 0
// ─────────────────────────────────────────────
const searchBarcodeBahan = async (kdKain, q = "") => {
  const [rows] = await db.query(
    `SELECT * FROM (
       SELECT a.bard_barcode AS Barcode, a.bard_kode AS Kode,
              b.Bhn_Name AS Nama, b.Bhn_satuan AS Satuan,
              IFNULL((SELECT SUM(m.mst_stok_in - m.mst_stok_out)
                      FROM tmasterstok_barcode m
                      WHERE m.mst_aktif='Y' AND m.mst_brg_kode=a.bard_barcode), 0) AS Stok,
              z.bw_kodek AS Kdw, z.werno
       FROM tbahan_barcode_dtl a
       INNER JOIN tbahan b ON b.Bhn_kode = a.bard_kode
       LEFT JOIN (
         SELECT w.bw_kode, w.bw_kodek, IFNULL(r.warna,'') AS werno
         FROM tbahan_warna w
         LEFT JOIN retail.twarna r ON r.kode = w.bw_kodek
       ) z ON z.bw_kode = MID(b.Bhn_kode,3,3)
       WHERE LEFT(a.bard_kode,2) = ?
     ) x
     WHERE x.Stok <> 0
       AND (x.Barcode LIKE ? OR x.Kode LIKE ? OR x.Nama LIKE ?)
     ORDER BY x.Barcode
     LIMIT 50`,
    [kdKain, `%${q}%`, `%${q}%`, `%${q}%`],
  );
  return rows;
};

// Lookup langsung by barcode (dipanggil saat scan/isi manual barcode field —
// clbarcode2PropertiesEditValueChanged)
const resolveBarcode = async (kdKain, barcode) => {
  const [rows] = await db.query(
    `SELECT a.bard_kode AS Kode, b.Bhn_Name AS Nama, b.Bhn_satuan AS Satuan,
       IFNULL((SELECT SUM(m.mst_stok_in - m.mst_stok_out)
               FROM tmasterstok_barcode m
               WHERE m.mst_aktif='Y' AND m.mst_brg_kode=a.bard_barcode), 0) AS Stok
     FROM tbahan_barcode_dtl a
     INNER JOIN tbahan b ON b.Bhn_kode = a.bard_kode
     WHERE LEFT(a.bard_kode,2) = ? AND a.bard_barcode = ?`,
    [kdKain, barcode],
  );
  if (rows.length === 0) return { error: "notfound" };
  if (Number(rows[0].Stok) === 0) return { error: "empty_stock" };
  return { data: rows[0] };
};

// ─────────────────────────────────────────────
// SEARCH BAHAN NON-BARCODE (F1 clkode2, mode manual — tanpa Ambil Stok Gudang)
// ─────────────────────────────────────────────
const searchBahanNonBarcode = async (kdKain, q = "") => {
  const [rows] = await db.query(
    `SELECT Bhn_kode AS Kode, bhn_name AS Nama, bhn_satuan AS Satuan
     FROM tbahan
     WHERE bhn_aktif = 0 AND bhn_jb_kode <> 'LL' AND LEFT(bhn_kode,2) = ?
       AND (Bhn_kode LIKE ? OR bhn_name LIKE ?)
     ORDER BY bhn_name
     LIMIT 50`,
    [kdKain, `%${q}%`, `%${q}%`],
  );
  // Sertakan stok per kode — sebelumnya kosong sama sekali di mode
  // non-barcode, bikin kolom Stok di hasil search selalu 0.
  return Promise.all(
    rows.map(async (r) => ({
      ...r,
      Stok: await getStokBahan(r.Kode),
    })),
  );
};

// ─────────────────────────────────────────────
// LOOKUP WARNA dari substring kode (dipakai internal saat resolve
// baris SPK dari kode Spesifikasi Kain — pola warna() Delphi)
// abwkode = MidStr(kode, 3, 3)
// ─────────────────────────────────────────────
const lookupWarnaByKode = async (kode) => {
  const abwkode = String(kode).substring(2, 5); // 0-indexed: posisi 3-5
  const [rows] = await db.query(
    `SELECT b.bw_kode, b.bw_nama, b.bw_kodek, w.warna
     FROM tbahan_warna b
     LEFT JOIN retail.twarna w ON w.kode = b.bw_kodek
     WHERE b.bw_kode = ?`,
    [abwkode],
  );
  return rows[0] || null;
};

// ─────────────────────────────────────────────
// SEARCH JENIS KAIN KAOSAN (F1 edtkdkaink — retail.tjeniskain)
// ─────────────────────────────────────────────
const searchJenisKainKaosan = async (q = "", page = 1, limit = 50) => {
  const offset = (Number(page) - 1) * Number(limit);
  const like = `%${q}%`;
  const [[{ total }]] = await db.query(
    `SELECT COUNT(*) AS total FROM retail.tjeniskain
     WHERE kode LIKE ? OR JenisKain LIKE ?`,
    [like, like],
  );
  const [rows] = await db.query(
    `SELECT kode AS Kode, JenisKain AS Nama
     FROM retail.tjeniskain
     WHERE kode LIKE ? OR JenisKain LIKE ?
     ORDER BY JenisKain
     LIMIT ? OFFSET ?`,
    [like, like, Number(limit), offset],
  );
  return { items: rows, total, page: Number(page), limit: Number(limit) };
};

// ─────────────────────────────────────────────
// SEARCH WARNA (F1 clwarna — retail.twarna)
// ─────────────────────────────────────────────
const searchWarnaKaosan = async (q = "", page = 1, limit = 50) => {
  const offset = (Number(page) - 1) * Number(limit);
  const like = `%${q}%`;
  const [[{ total }]] = await db.query(
    `SELECT COUNT(*) AS total FROM retail.twarna
     WHERE kode LIKE ? OR warna LIKE ?`,
    [like, like],
  );
  const [rows] = await db.query(
    `SELECT kode AS Kode, warna AS Nama
     FROM retail.twarna
     WHERE kode LIKE ? OR warna LIKE ?
     ORDER BY warna
     LIMIT ? OFFSET ?`,
    [like, like, Number(limit), offset],
  );
  return { items: rows, total, page: Number(page), limit: Number(limit) };
};

// ─────────────────────────────────────────────
// SEARCH JENIS KAIN (F1 edtkdkain — tbahan_jenis)
// ─────────────────────────────────────────────
const searchJenisKain = async (q = "", page = 1, limit = 50) => {
  const offset = (Number(page) - 1) * Number(limit);
  const like = `%${q}%`;
  const [[{ total }]] = await db.query(
    `SELECT COUNT(*) AS total FROM tbahan_jenis
     WHERE bj_kode LIKE ? OR bj_nama LIKE ?`,
    [like, like],
  );
  const [rows] = await db.query(
    `SELECT bj_kode AS Kode, bj_nama AS Nama
     FROM tbahan_jenis
     WHERE bj_kode LIKE ? OR bj_nama LIKE ?
     ORDER BY bj_nama
     LIMIT ? OFFSET ?`,
    [like, like, Number(limit), offset],
  );
  return { items: rows, total, page: Number(page), limit: Number(limit) };
};

// ─────────────────────────────────────────────
// GET LIST LENGAN (retail.tlengan) — untuk dropdown Lengan
// ─────────────────────────────────────────────
const getLenganList = async () => {
  const [rows] = await db.query(
    `SELECT lengan FROM retail.tlengan ORDER BY lengan`,
  );
  return rows.map((r) => r.lengan);
};

// ─────────────────────────────────────────────
// GET STATUS APPROVAL (cekClose) — status pengajuan perubahan data
// ─────────────────────────────────────────────
const getApprovalStatus = async (nomor) => {
  const [rows] = await db.query(
    `SELECT pin_urut, pin_acc, pin_dipakai
     FROM tspk_pin5
     WHERE pin_trs = 'SPK GUDANG' AND pin_nomor = ?
     ORDER BY pin_urut DESC LIMIT 1`,
    [nomor],
  );
  if (rows.length === 0) return { status: "MINTA", urut: null };
  const p = rows[0];
  if (p.pin_acc === "" && p.pin_dipakai === "")
    return { status: "WAIT", urut: p.pin_urut };
  if (p.pin_acc === "Y" && p.pin_dipakai === "")
    return { status: "ACC", urut: p.pin_urut };
  if (p.pin_acc === "N") return { status: "TOLAK", urut: p.pin_urut };
  return { status: "MINTA", urut: p.pin_urut };
};

// ─────────────────────────────────────────────
// APAKAH TRANSAKSI PERLU CEK STATUS APPROVAL (loaddata)
// Replikasi persis logic ganda: cek auto-close (ztglclose) DAN
// manual close (getManualTutupBuku) untuk periode TANGGAL RECORD.
// Kalau record masih dalam periode terbuka → skip cek approval sama
// sekali (imgtglminta/wait/acc semua disembunyikan, xminta5='').
// ─────────────────────────────────────────────
const needsApprovalCheck = async (tglTransaksi) => {
  const zdtClose = await tutupBukuService.getTanggalTutupBuku();
  const zClose = await tutupBukuService.getManualTutupBuku(MODUL_TUTUP_BUKU);
  const tgl = new Date(tglTransaksi);

  if (zClose) {
    return tgl < zClose;
  }
  return tgl < zdtClose;
};

// ─────────────────────────────────────────────
// GET BY NOMOR (loaddata) — load untuk mode Ubah
// ─────────────────────────────────────────────
const getById = async (nomor) => {
  const [hdrRows] = await db.query(
    `SELECT s.*, j.bj_nama AS namaJenisKain, k.JenisKain AS namaKainKaosan
     FROM tspk_gudang s
     LEFT JOIN tbahan_jenis j ON j.bj_kode = s.spg_kain
     LEFT JOIN retail.tjeniskain k ON k.kode = s.spg_kaink
     WHERE s.spg_nomor = ?`,
    [nomor],
  );
  if (hdrRows.length === 0) return null;
  const header = hdrRows[0];

  // Detail 1: Spesifikasi Kain — stok dihitung per kode masing-masing
  const [barcodeRows] = await db.query(
    `SELECT i.spgb_barcode AS barcode, i.spgb_bhn_kode AS kode,
            b.Bhn_Name AS nama, b.Bhn_satuan AS satuan, i.spgb_jumlah AS jumlah
     FROM tspk_gudangbarcode i
     LEFT JOIN tbahan b ON b.Bhn_kode = i.spgb_bhn_kode
     WHERE i.spgb_nomor = ?`,
    [nomor],
  );
  const spesifikasiKain = await Promise.all(
    barcodeRows.map(async (r) => ({
      ...r,
      stok: (await getStokBahan(r.kode)) + Number(r.jumlah),
    })),
  );

  // Detail 2: SPK per warna
  const [itemRows] = await db.query(
    `SELECT i.spgi_bwkode AS bwkode, b.bw_nama AS bwnama, w.warna AS warna,
            i.spgi_kodewarna AS kodewarna, i.spgi_jumlah AS jumlah,
            i.spgi_spk AS spk, i.spgi_nama AS namaspk, i.spgi_kodek AS kodek
     FROM tspk_gudangitem i
     LEFT JOIN tbahan_warna b ON b.bw_kode = i.spgi_bwkode
     LEFT JOIN retail.twarna w ON w.kode = i.spgi_kodewarna
     WHERE i.spgi_nomor = ?
     ORDER BY i.spgi_urut`,
    [nomor],
  );
  const spkItems = itemRows.map((r) => ({ ...r, isNew: false }));

  // Status approval — hanya relevan kalau periodenya sudah lewat batas
  let approval = { status: "", urut: null };
  if (await needsApprovalCheck(header.spg_tanggal)) {
    approval = await getApprovalStatus(nomor);
  }

  return { header, spesifikasiKain, spkItems, approval };
};

// ─────────────────────────────────────────────
// GET DATA CETAK — replikasi query `cetak()` Delphi
// ─────────────────────────────────────────────
const getDataCetak = async (nomor) => {
  const [[row]] = await db.query(
    `SELECT
       s.*,
       j.bj_nama AS jenis,
       p.pab_nama,
       CONCAT(s.spg_jenis, ' ', s.spg_finishing, ' ', s.spg_lengan, ' ', j.bj_nama) AS nama,
       (
         SELECT CAST(GROUP_CONCAT(CONCAT(i.spgi_spk, '= ', w.bw_nama) SEPARATOR '\n') AS CHAR)
         FROM tspk_gudangitem i
         INNER JOIN tbahan_warna w ON w.bw_kode = i.spgi_bwkode
         WHERE i.spgi_nomor = s.spg_nomor
       ) AS warna,
       DATE_FORMAT(s.date_create, '%d-%m-%Y %H:%i:%s') AS created
     FROM tspk_gudang s
     LEFT JOIN tpabrik p ON p.pab_kode = s.spg_workshop
     LEFT JOIN tbahan_jenis j ON j.bj_kode = s.spg_kain
     WHERE s.spg_nomor = ?`,
    [nomor],
  );
  if (!row) throw new Error("Data tidak ditemukan.");
  return row;
};

// ─────────────────────────────────────────────
// SAVE (simpandata + validasi F10)
// ─────────────────────────────────────────────
const save = async (payload, user) => {
  const {
    isEdit,
    nomor: nomorEdit,
    tanggal,
    dateline,
    jenisKaos, // 'KO' | 'KK'
    ambilStokGudang, // boolean
    lengan,
    kdKain,
    kdKainKaosan,
    finishing,
    workshop,
    keterangan,
    spesifikasiKain = [],
    spkItems = [],
    approvalUrut = null,
    approvalStatus = "",
  } = payload;

  // ── Validasi F10 ──
  if (new Date(tanggal) > new Date(dateline)) {
    throw new Error("Dateline harus >= Tgl SPK");
  }

  const validSpesifikasi = spesifikasiKain.filter((r) => r.nama);
  if (validSpesifikasi.length === 0) {
    throw new Error("Detail harus diisi.");
  }
  for (const r of validSpesifikasi) {
    if (!Number(r.jumlah)) {
      throw new Error("Qty harus di isi.");
    }
    if (ambilStokGudang && Number(r.jumlah) > Number(r.stok)) {
      throw new Error("Qty melebihi Stok.");
    }
  }

  const finalSpkRows = [];
  for (const r of spkItems) {
    if (Number(r.jumlah) !== 0) {
      if (!r.warna) {
        throw new Error("Warna Kaosan harus di isi.");
      }
      finalSpkRows.push(r);
    } else if (!r.isNew) {
      // baris lama qty jadi 0 tetap dibuang (row.new<>'' artinya lama —
      // Delphi: baris lama TIDAK didelete otomatis kalau qty 0 kecuali
      // baris itu memang 'new'; tapi karena detail selalu di-delete+insert
      // ulang saat save, baris qty=0 otomatis tidak ikut ter-insert lagi.
      // Jadi behaviour akhirnya sama: baris qty=0 hilang dari hasil akhir.
    }
  }

  // ── Validasi periode closing (F10) ──
  const zdtCloseToday = await tutupBukuService.getTanggalTutupBuku();
  const zCloseManual =
    await tutupBukuService.getManualTutupBuku(MODUL_TUTUP_BUKU);
  const tglTransaksi = new Date(tanggal);
  const boundary = zCloseManual || zdtCloseToday;
  const allowedByWindow = tglTransaksi >= boundary;
  const allowedByApproval = approvalStatus === "ACC";
  if (!allowedByWindow && !allowedByApproval) {
    if (["MINTA", "WAIT", "TOLAK"].includes(approvalStatus)) {
      throw new Error(
        "Transaksi tsb sudah diclose. Silahkan minta approve untuk bisa menyimpan perubahan data.",
      );
    }
    throw new Error(
      "Anda tidak boleh input di tanggal periode yg sudah diclose.",
    );
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    let nomor = isEdit ? nomorEdit : null;
    if (!isEdit) {
      nomor = await generateNomorTransaksi(tanggal, conn);
    }

    const stokGudangFlag = ambilStokGudang ? "Y" : "N";

    if (isEdit) {
      await conn.query(
        `UPDATE tspk_gudang SET
           spg_dateline=?, spg_lengan=?, spg_jenis=?, spg_kain=?, spg_kaink=?,
           spg_finishing=?, spg_workshop=?, spg_ket=?,
           date_modified=NOW(), user_modified=?
         WHERE spg_nomor=?`,
        [
          dateline,
          lengan,
          jenisKaos,
          kdKain,
          kdKainKaosan,
          finishing,
          workshop,
          keterangan,
          user.kode,
          nomor,
        ],
      );
    } else {
      await conn.query(
        `INSERT INTO tspk_gudang
           (spg_nomor, spg_tanggal, spg_dateline, spg_lengan, spg_jenis,
            spg_stokgudang, spg_kain, spg_kaink, spg_finishing, spg_workshop,
            spg_ket, date_create, user_create)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?)`,
        [
          nomor,
          tanggal,
          dateline,
          lengan,
          jenisKaos,
          stokGudangFlag,
          kdKain,
          kdKainKaosan,
          finishing,
          workshop,
          keterangan,
          user.kode,
        ],
      );
    }

    // Update default jenis kain → kaink (tbahan_jenis.bj_kodek)
    await conn.query(`UPDATE tbahan_jenis SET bj_kodek=? WHERE bj_kode=?`, [
      kdKainKaosan,
      kdKain,
    ]);

    // Detail 1: Spesifikasi Kain — delete + insert ulang
    await conn.query(`DELETE FROM tspk_gudangbarcode WHERE spgb_nomor=?`, [
      nomor,
    ]);
    for (const r of validSpesifikasi) {
      await conn.query(
        `INSERT INTO tspk_gudangbarcode (spgb_nomor, spgb_barcode, spgb_bhn_kode, spgb_jumlah)
         VALUES (?, ?, ?, ?)`,
        [nomor, r.barcode || "", r.kode, Number(r.jumlah)],
      );
    }

    // Detail 2: SPK per warna — delete + insert ulang
    await conn.query(`DELETE FROM tspk_gudangitem WHERE spgi_nomor=?`, [nomor]);
    let xno = 0;
    let urut = 1;
    for (const r of finalSpkRows) {
      let { spk, kodek, namaspk } = r;

      if (r.isNew) {
        xno += 1;
        spk = await generateSpkItemNomor(jenisKaos, tanggal, xno, conn);
        const resolved = await resolveKodeKaosan(
          {
            jenis: jenisKaos,
            finishing,
            lengan,
            kdKainKaosan,
            warna: r.warna,
            kodeWarna: r.kodewarna,
            tanggal,
          },
          conn,
        );
        kodek = resolved.kode;
        namaspk = `${jenisKaos} ${finishing} ${lengan} ${kdKainKaosan} ${r.warna}`;

        if (resolved.isNew) {
          await conn.query(
            `INSERT INTO retail.tbarangdc
               (brg_kode, brg_ktgp, brg_jeniskaos, brg_tipe, brg_lengan,
                brg_jeniskain, brg_warna, brg_logstok, brg_bcdid, user_create, date_create)
             VALUES (?, 'SESIONAL', ?, ?, ?, ?, ?, 'Y', ?, 'SYSTEM', NOW())
             ON DUPLICATE KEY UPDATE brg_logstok='Y'`,
            [
              kodek,
              jenisKaos,
              finishing,
              lengan,
              kdKainKaosan,
              r.warna,
              resolved.bcdid,
            ],
          );
        }
      }

      await conn.query(
        `INSERT INTO tspk_gudangitem
           (spgi_nomor, spgi_bwkode, spgi_kodewarna, spgi_jumlah, spgi_spk,
            spgi_kodek, spgi_nama, spgi_urut)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          nomor,
          r.bwkode,
          r.kodewarna,
          Number(r.jumlah),
          spk,
          kodek,
          namaspk,
          urut,
        ],
      );

      // Update default warna → kodewarna (tbahan_warna.bw_kodek)
      await conn.query(`UPDATE tbahan_warna SET bw_kodek=? WHERE bw_kode=?`, [
        r.kodewarna,
        r.bwkode,
      ]);
      urut += 1;
    }

    // Tandai pengajuan perubahan data sudah dipakai, kalau approval=ACC
    if (approvalStatus === "ACC" && approvalUrut) {
      await conn.query(
        `UPDATE tspk_pin5 SET pin_dipakai='Y'
         WHERE pin_trs='SPK GUDANG' AND pin_nomor=? AND pin_urut=?`,
        [nomor, approvalUrut],
      );
    }

    await conn.commit();
    return { nomor };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
};

module.exports = {
  generateNomorTransaksi,
  generateSpkItemNomor,
  resolveKodeKaosan,
  getNextBcdId,
  getStokBahan,
  lookupJenisKain,
  searchBarcodeBahan,
  resolveBarcode,
  searchBahanNonBarcode,
  lookupWarnaByKode,
  searchJenisKainKaosan,
  searchWarnaKaosan,
  searchJenisKain,
  getLenganList,
  getApprovalStatus,
  needsApprovalCheck,
  getById,
  getDataCetak,
  save,
};
