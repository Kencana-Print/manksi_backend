const db = require("../../config/database");
const ExcelJS = require("exceljs");

// ============================================================
// SPK PPIC — FORM SERVICE
// Catatan: file ini KHUSUS SPK PPIC (spk_is_so = 0).
// Tidak ada validasi piutang/alokasi/kaosan/pin approval — semua
// itu sudah final di sisi SO. Form ini hanya:
//   1. Create: copy header tspk dari SO terpilih + tspk_size
//   2. Edit: update spk_ketbeli, spk_keterangan, tspk_size
//   3. Save komponen (potong, cetak/bordir) & keterangan khusus
// ============================================================

// --- GENERATE NOMOR SPK PPIC (format: SPK-{perush}-{jo}-000001) ---
const generateNomor = async (perushKode, joKode, conn = db) => {
  const prefix = `SPK-${perushKode}-${joKode}-`;
  const [rows] = await conn.query(
    `SELECT IFNULL(MAX(CAST(SUBSTR(spk_nomor, ?, 6) AS UNSIGNED)), 0) AS jumlah
     FROM tspk
     WHERE spk_perush_kode = ? AND spk_jo_kode = ? AND spk_nomor LIKE ?
     FOR UPDATE`,
    [prefix.length + 1, perushKode, joKode, `${prefix}%`],
  );
  const nextVal = rows[0].jumlah + 1;
  return `${prefix}${String(nextVal).padStart(6, "0")}`;
};

// ============================================================
// GET DETAIL — untuk mode Ubah (edit SPK PPIC yang sudah ada)
// ============================================================
const getDetail = async (nomor) => {
  const [header] = await db.query(
    `SELECT s.*, j.jo_nama, a.sal_nama, p.perush_nama, c.cus_nama, c.cus_perfect
     FROM tspk s
     LEFT JOIN tjenisorder j ON s.spk_jo_kode = j.jo_kode
     LEFT JOIN tsales a ON s.spk_sal_kode = a.sal_kode
     LEFT JOIN tperusahaan p ON s.spk_perush_kode = p.perush_kode
     LEFT JOIN tcustomer c ON s.spk_cus_kode = c.cus_kode
     WHERE s.spk_nomor = ? AND s.spk_is_so = 0`,
    [nomor],
  );
  if (header.length === 0) throw new Error("Data SPK PPIC tidak ditemukan.");

  const [dtlSize, komponenSpk, layoutProses, keteranganKhusus] =
    await Promise.all([
      getSizeList(nomor),
      getKomponenSpk(nomor),
      getLayoutProses(nomor),
      getKeteranganKhusus(nomor),
    ]);

  // Ambil checklist keterangan komponen (semua kode A-O dengan flag checked)
  const [masterKet] = await db.query(
    `SELECT k.kode, k.nama,
          IF(s.skk_kode IS NOT NULL, TRUE, FALSE) AS checked,
          IFNULL(s.skk_ket, '') AS ket
     FROM tketkomponen k
     LEFT JOIN tspk_ketkomponen s ON s.skk_kode = k.kode AND s.skk_spk = ?
     ORDER BY k.kode ASC`,
    [nomor],
  );

  return {
    header: header[0],
    dtlSize,
    komponenSpk,
    layoutProses,
    keteranganKhusus,
    ketKomponenList: masterKet,
  };
};

// --- Ambil data SO sebagai dasar pembuatan SPK PPIC baru ---
const getSoSourceDetail = async (soNomor) => {
  const [so] = await db.query(
    `SELECT s.*, j.jo_nama, a.sal_nama, p.perush_nama, c.cus_nama, c.cus_perfect
     FROM tspk s
     LEFT JOIN tjenisorder j ON s.spk_jo_kode = j.jo_kode
     LEFT JOIN tsales a ON s.spk_sal_kode = a.sal_kode
     LEFT JOIN tperusahaan p ON s.spk_perush_kode = p.perush_kode
     LEFT JOIN tcustomer c ON s.spk_cus_kode = c.cus_kode
     WHERE s.spk_nomor = ? AND s.spk_is_so = 1`,
    [soNomor],
  );
  if (so.length === 0) throw new Error("Sales Order tidak ditemukan.");
  if (so[0].spk_aktif !== "Y" || !so[0].spk_cmo) {
    throw new Error("SO ini belum aktif/approved, tidak bisa dibuatkan SPK.");
  }

  const dtlSize = await getSizeList(soNomor);

  return { header: so[0], dtlSize };
};

// --- Ambil tspk_size (dipakai baik untuk SO sumber maupun SPK) ---
const getSizeList = async (nomor) => {
  const [rows] = await db.query(
    `SELECT spks_size AS size, spks_qty AS qty,
            spks_a AS lb, spks_b AS pb,
            spks_ld AS ld, spks_pl_pendek AS pl_pendek,
            spks_pl_panjang AS pl_panjang, spks_p_bahu AS p_bahu,
            spks_l_lengan AS l_lengan, spks_l_manset AS l_manset,
            spks_l_pinggang AS l_pinggang, spks_p_celana AS p_celana,
            spks_l_panggul AS l_panggul, spks_l_paha AS l_paha,
            spks_pesak AS pesak, spks_l_lutut AS l_lutut,
            spks_l_bawah AS l_bawah
     FROM tspk_size
     WHERE spks_nomor = ? AND spks_qty > 0`,
    [nomor],
  );
  return rows;
};

// ============================================================
// SAVE DATA — create & edit SPK PPIC
// ============================================================
const saveData = async (payload, user) => {
  const {
    isEdit,
    spk_nomor, // wajib jika isEdit = true
    so_nomor, // wajib jika isEdit = false (sumber data SO)
    spk_ketbeli,
    spk_keterangan,
    dtlSize,
    komponenSpk,
    keteranganKhusus,
  } = payload;

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    let nomor;

    if (!isEdit) {
      // --- CREATE: copy header dari SO terpilih ---
      if (!so_nomor) throw new Error("No. SO sumber wajib dipilih.");

      const [soRows] = await conn.query(
        `SELECT * FROM tspk WHERE spk_nomor = ? AND spk_is_so = 1`,
        [so_nomor],
      );
      if (soRows.length === 0) throw new Error("Sales Order tidak ditemukan.");
      const soHeader = soRows[0];

      if (soHeader.spk_aktif !== "Y" || !soHeader.spk_cmo) {
        throw new Error(
          "SO ini belum aktif/approved, tidak bisa dibuatkan SPK.",
        );
      }

      nomor = await generateNomor(
        soHeader.spk_perush_kode,
        soHeader.spk_jo_kode,
      );

      const newHeader = { ...soHeader };
      delete newHeader.spk_nomor;
      delete newHeader.spk_is_so;

      newHeader.spk_nomor = nomor;
      newHeader.spk_is_so = 0;
      newHeader.spk_so_ref = so_nomor;
      newHeader.spk_aktif = "Y";
      newHeader.spk_ketbeli = spk_ketbeli || "";
      newHeader.spk_keterangan = spk_keterangan || "";
      newHeader.user_create = user.kode;
      newHeader.date_create = new Date();
      delete newHeader.user_modified;
      delete newHeader.date_modified;

      await conn.query(`INSERT INTO tspk SET ?`, [newHeader]);

      // Copy tspk_size dari SO sebagai starting point, lalu override
      // dengan dtlSize dari payload kalau user sudah sesuaikan di form
      const sizeSource =
        dtlSize && dtlSize.length > 0 ? dtlSize : await getSizeList(so_nomor);
      await saveSizeList(conn, nomor, sizeSource);

      // Pindahkan layout proses yang sempat diupload sebelum SPK tersimpan
      // (saat itu tersimpan sementara pakai key so_nomor) ke nomor SPK final
      await migrateLayoutProses(conn, so_nomor, nomor);
    } else {
      // --- EDIT: hanya update field produksi ---
      if (!spk_nomor) throw new Error("No. SPK wajib diisi.");
      nomor = spk_nomor;

      const [exist] = await conn.query(
        `SELECT spk_nomor FROM tspk WHERE spk_nomor = ? AND spk_is_so = 0`,
        [nomor],
      );
      if (exist.length === 0) throw new Error("Data SPK PPIC tidak ditemukan.");

      await conn.query(
        `UPDATE tspk SET spk_ketbeli = ?, spk_keterangan = ?, user_modified = ?, date_modified = NOW()
         WHERE spk_nomor = ?`,
        [spk_ketbeli || "", spk_keterangan || "", user.kode, nomor],
      );

      if (dtlSize) {
        await saveSizeList(conn, nomor, dtlSize);
      }
    }

    // --- Komponen (potong + cetak/bordir) ---
    if (komponenSpk) {
      await saveKomponenSpk(conn, nomor, komponenSpk);
    }

    // --- Keterangan khusus ---
    if (keteranganKhusus !== undefined) {
      await saveKeteranganKhusus(conn, nomor, keteranganKhusus);
    }

    if (payload.ketKomponenList !== undefined) {
      await conn.query(`DELETE FROM tspk_ketkomponen WHERE skk_spk = ?`, [
        nomor,
      ]);
      const checked = (payload.ketKomponenList || []).filter((k) => k.checked);
      if (checked.length > 0) {
        const vals = checked.map((k) => [nomor, k.kode, k.ket || ""]);
        await conn.query(
          `INSERT INTO tspk_ketkomponen (skk_spk, skk_kode, skk_ket) VALUES ?`,
          [vals],
        );
      }
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

// --- Replace tspk_size untuk satu nomor SPK ---
const saveSizeList = async (conn, nomor, list) => {
  await conn.query(`DELETE FROM tspk_size WHERE spks_nomor = ?`, [nomor]);

  const rows = (list || []).filter((item) => Number(item.qty) > 0);
  if (rows.length === 0) return;

  const vals = rows.map((item) => [
    nomor,
    item.size,
    item.qty,
    item.ld || 0, // spks_a — backward compat
    item.pb || 0, // spks_b — backward compat
    item.ld || 0,
    item.pl_pendek || 0,
    item.pl_panjang || 0,
    item.p_bahu || 0,
    item.l_lengan || 0,
    item.l_manset || 0,
    item.l_pinggang || 0,
    item.p_celana || 0,
    item.l_panggul || 0,
    item.l_paha || 0,
    item.pesak || 0,
    item.l_lutut || 0,
    item.l_bawah || 0,
  ]);

  await conn.query(
    `INSERT INTO tspk_size
     (spks_nomor, spks_size, spks_qty, spks_a, spks_b,
      spks_ld, spks_pl_pendek, spks_pl_panjang, spks_p_bahu,
      spks_l_lengan, spks_l_manset, spks_l_pinggang, spks_p_celana,
      spks_l_panggul, spks_l_paha, spks_pesak, spks_l_lutut, spks_l_bawah)
     VALUES ?`,
    [vals],
  );
};

// ============================================================
// SIZE HELPERS (init kosong & standar ukuran Kencana)
// ============================================================
const getInitSizes = async () => {
  const [rows] = await db.query(
    `SELECT ukuran AS size FROM retail.tukuran WHERE kategori = "" ORDER BY kode`,
  );
  return rows.map((r) => ({
    size: r.size,
    qty: 0,
    ld: 0,
    pb: 0,
    pl_pendek: 0,
    pl_panjang: 0,
    p_bahu: 0,
    l_lengan: 0,
    l_manset: 0,
    l_pinggang: 0,
    p_celana: 0,
    l_panggul: 0,
    l_paha: 0,
    pesak: 0,
    l_lutut: 0,
    l_bawah: 0,
  }));
};

const JO_KATEGORI = {
  BB: "ATASAN",
  BU: "ATASAN",
  JK: "ATASAN",
  JS: "ATASAN",
  KK: "ATASAN",
  KO: "ATASAN",
  KS: "ATASAN",
  CL: "BAWAHAN",
  WP: "WEARPACK",
};

const getStandarUkuran = async (joKode, varian = "STANDAR") => {
  const jo = String(joKode || "").toUpperCase();
  const kategori = JO_KATEGORI[jo];
  if (!kategori) return [];

  const kategoriList =
    kategori === "WEARPACK" ? ["ATASAN", "BAWAHAN"] : [kategori];

  const [allSizes] = await db.query(
    `SELECT ukuran AS size FROM retail.tukuran WHERE kategori = "" ORDER BY kode`,
  );

  const placeholders = kategoriList.map(() => "?").join(",");
  const [standar] = await db.query(
    `SELECT * FROM retail.tukuran_standar
     WHERE ts_kategori IN (${placeholders}) AND ts_varian = ?`,
    [...kategoriList, varian],
  );

  const standarMap = {};
  for (const row of standar) {
    if (!standarMap[row.ts_ukuran]) standarMap[row.ts_ukuran] = {};
    Object.assign(standarMap[row.ts_ukuran], row);
  }

  return allSizes.map((s) => {
    const d = standarMap[s.size] || {};
    return {
      size: s.size,
      qty: 0,
      ld: Number(d.ts_ld) || 0,
      pb: Number(d.ts_pb) || 0,
      pl_pendek: Number(d.ts_pl_pendek) || 0,
      pl_panjang: Number(d.ts_pl_panjang) || 0,
      p_bahu: Number(d.ts_p_bahu) || 0,
      l_lengan: Number(d.ts_l_lengan) || 0,
      l_manset: Number(d.ts_l_manset) || 0,
      l_pinggang: Number(d.ts_l_pinggang) || 0,
      p_celana: Number(d.ts_p_celana) || 0,
      l_panggul: Number(d.ts_l_panggul) || 0,
      l_paha: Number(d.ts_l_paha) || 0,
      pesak: Number(d.ts_pesak) || 0,
      l_lutut: Number(d.ts_l_lutut) || 0,
      l_bawah: Number(d.ts_l_bawah) || 0,
    };
  });
};

// ============================================================
// MKB (kebutuhan bahan) — referensi dari SPK
// ============================================================
const getMkbDetailBySpk = async (spkNomor) => {
  const [rows] = await db.query(
    `SELECT
       h.mkb_nomor AS Nomor,
       d.mkbd_komponen AS Komponen,
       d.mkbd_warna AS Warna,
       d.mkbd_babaran AS Babaran,
       d.mkbd_bhn_kode AS Kode,
       b.bhn_name AS NamaBahan,
       d.mkbd_bhn_satuan AS Satuan,
       b.bhn_gramasi AS Gramasi,
       d.mkbd_jumlah AS Butuh,
       -- Planning bahan datang (tplanningspk), digabung jadi satu kolom
       -- teks multi-baris karena datanya level SPK, bukan per-baris bahan
       (
         SELECT GROUP_CONCAT(
           CONCAT(DATE_FORMAT(p.plan_tanggal, '%d-%m-%Y'), ': ', p.plan_datang, ' pcs')
           ORDER BY p.plan_tanggal
           SEPARATOR '\n'
         )
         FROM tplanningspk p
         WHERE p.plan_datang <> 0 AND p.plan_spk = h.mkb_spk_nomor
       ) AS BahanDatang
     FROM tmkb_hdr h
     INNER JOIN tmkb_dtl d ON d.mkbd_mkb_nomor = h.mkb_nomor
     LEFT JOIN tbahan b ON b.bhn_kode = d.mkbd_bhn_kode
     WHERE h.mkb_spk_nomor = ?
     ORDER BY h.mkb_nomor, d.mkbd_nourut`,
    [spkNomor],
  );
  return rows;
};

// ============================================================
// KOMPONEN SPK (Potong + Cetak/Bordir)
// ============================================================
const getKomponenSpk = async (nomor) => {
  const [potong, cetakBordir] = await Promise.all([
    db.query(
      `SELECT a.sk_kode AS Kode, b.Bhn_Name AS Nama
       FROM tspk_komponen_potong a
       LEFT JOIN tbahan b ON b.Bhn_kode = a.sk_kode
       WHERE a.sk_nomor = ?
       ORDER BY a.sk_nourut ASC`,
      [nomor],
    ),
    db.query(
      `SELECT a.kcb_kode AS Kode, b.Bhn_Name AS Nama,
              a.kcb_proses AS Proses, a.kcb_penempatan AS Penempatan,
              a.kcb_ukuran AS Ukuran
       FROM tspk_komponen_cetak_bordir a
       LEFT JOIN tbahan b ON b.Bhn_kode = a.kcb_kode
       WHERE a.kcb_nomor = ?
       ORDER BY a.kcb_nourut ASC`,
      [nomor],
    ),
  ]);

  return { ListPotong: potong[0], ListCetakBordir: cetakBordir[0] };
};

const saveKomponenSpk = async (conn, nomor, payload) => {
  await conn.query("DELETE FROM tspk_komponen_potong WHERE sk_nomor = ?", [
    nomor,
  ]);
  await conn.query(
    "DELETE FROM tspk_komponen_cetak_bordir WHERE kcb_nomor = ?",
    [nomor],
  );

  const potongRows = (payload.ListPotong || []).filter((p) => p.Kode);
  if (potongRows.length > 0) {
    const vals = potongRows.map((p, i) => [nomor, p.Kode, i + 1]);
    await conn.query(
      "INSERT INTO tspk_komponen_potong (sk_nomor, sk_kode, sk_nourut) VALUES ?",
      [vals],
    );
  }

  const cbRows = (payload.ListCetakBordir || []).filter(
    (p) => p.Kode && p.Proses,
  );
  if (cbRows.length > 0) {
    const vals = cbRows.map((p, i) => [
      nomor,
      p.Kode,
      p.Proses,
      p.Penempatan || "",
      p.Ukuran || "",
      i + 1,
    ]);
    await conn.query(
      `INSERT INTO tspk_komponen_cetak_bordir
       (kcb_nomor, kcb_kode, kcb_proses, kcb_penempatan, kcb_ukuran, kcb_nourut)
       VALUES ?`,
      [vals],
    );
  }
};

// --- Master komponen (dari tbahan, sama seperti MAP) ---
const getKomponenMaster = async (isBordir) => {
  let query = `SELECT bhn_kode AS Kode, bhn_name AS Nama
               FROM tbahan
               WHERE bhn_jb_kode = 'LL' AND bhn_aktif = 0`;
  if (isBordir === "true" || isBordir === true) {
    query += ` AND bhn_bordir <> 0`;
  }
  query += ` ORDER BY bhn_name ASC`;

  const [rows] = await db.query(query);
  return rows;
};

// ============================================================
// LAYOUT PROSES (import Excel)
// ============================================================
const importLayoutProses = async (spkNomor, filePath) => {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const ws = workbook.worksheets[0];

  const getCell = (addr) => ws.getCell(addr).value;
  const toStr = (v) => (v === null || v === undefined ? "" : String(v).trim());
  const toNum = (v) => {
    if (v === null || v === undefined || v === "") return 0;
    const n = Number(String(v).replace(",", "."));
    return isNaN(n) ? 0 : n;
  };

  const header = {
    no_memo: toStr(getCell("B2")),
    nama_memo: toStr(getCell("B3")),
    line: toStr(getCell("B4")),
    poj: toStr(getCell("E2")),
    mp: toStr(getCell("E3")),
    jk: toStr(getCell("E4")),
    efisiensi: toStr(getCell("L2")),
    target_hari: toStr(getCell("L3")),
  };

  const startRow = 7;
  const endRow = ws.rowCount;
  const proofRows = [];
  const sewingRows = [];

  for (let r = startRow; r <= endRow; r++) {
    const row = ws.getRow(r);

    const proofProses = toStr(row.getCell(6).value);
    const proofMp = toNum(row.getCell(2).value);
    if (proofProses || proofMp) {
      proofRows.push({
        no_urut: toNum(row.getCell(7).value),
        proses: proofProses,
        mc: toStr(row.getCell(5).value),
        sepatu: toStr(row.getCell(4).value),
        kjarum: toStr(row.getCell(4).value),
        ct_jam: toNum(row.getCell(4).value),
        ct_dt: toNum(row.getCell(3).value),
        mp: proofMp,
        nama_op: toStr(row.getCell(1).value),
      });
    }

    const sewingProses = toStr(row.getCell(9).value);
    const sewingMp = toNum(row.getCell(16).value);
    if (sewingProses || sewingMp) {
      sewingRows.push({
        no_urut: toNum(row.getCell(8).value),
        proses: sewingProses,
        mc: toStr(row.getCell(10).value),
        ukjarum: toStr(row.getCell(11).value),
        sepatu: toStr(row.getCell(12).value),
        ct_jam: toNum(row.getCell(13).value),
        ct_dt: toNum(row.getCell(14).value),
        mp: sewingMp,
        nama_op: toStr(row.getCell(15).value),
      });
    }
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    await conn.query(
      `INSERT INTO tspk_layout_header
       (lh_spk_nomor, lh_no_memo, lh_nama_memo, lh_line, lh_poj, lh_mp, lh_jk, lh_efisiensi, lh_target_hari, lh_uploaded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE
         lh_no_memo=VALUES(lh_no_memo), lh_nama_memo=VALUES(lh_nama_memo),
         lh_line=VALUES(lh_line), lh_poj=VALUES(lh_poj), lh_mp=VALUES(lh_mp),
         lh_jk=VALUES(lh_jk), lh_efisiensi=VALUES(lh_efisiensi),
         lh_target_hari=VALUES(lh_target_hari), lh_uploaded_at=NOW()`,
      [
        spkNomor,
        header.no_memo,
        header.nama_memo,
        header.line,
        header.poj,
        header.mp,
        header.jk,
        header.efisiensi,
        header.target_hari,
      ],
    );

    await conn.query(`DELETE FROM tspk_layout_proses WHERE lp_spk_nomor = ?`, [
      spkNomor,
    ]);

    const allRows = [
      ...proofRows.map((r) => ({ ...r, sisi: "PROOF" })),
      ...sewingRows.map((r) => ({ ...r, sisi: "SEWING" })),
    ];

    if (allRows.length > 0) {
      const vals = allRows.map((r) => [
        spkNomor,
        r.sisi,
        r.no_urut,
        r.proses,
        r.mc || "",
        r.ukjarum || "",
        r.sepatu || "",
        r.kjarum || "",
        r.ct_jam,
        r.ct_dt,
        r.mp,
        r.nama_op,
      ]);
      await conn.query(
        `INSERT INTO tspk_layout_proses
         (lp_spk_nomor, lp_sisi, lp_no_urut, lp_proses, lp_mc, lp_ukjarum, lp_sepatu, lp_kjarum, lp_ct_jam, lp_ct_dt, lp_mp, lp_nama_op)
         VALUES ?`,
        [vals],
      );
    }

    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }

  return {
    header,
    totalProof: proofRows.length,
    totalSewing: sewingRows.length,
  };
};

const getLayoutProses = async (spkNomor) => {
  const [headerRows] = await db.query(
    `SELECT * FROM tspk_layout_header WHERE lh_spk_nomor = ?`,
    [spkNomor],
  );
  const [detailRows] = await db.query(
    `SELECT lp_sisi AS sisi, lp_no_urut AS no_urut, lp_proses AS proses,
            lp_mc AS mc, lp_ukjarum AS ukjarum, lp_sepatu AS sepatu, lp_kjarum AS kjarum,
            lp_ct_jam AS ct_jam, lp_ct_dt AS ct_dt, lp_mp AS mp, lp_nama_op AS nama_op
     FROM tspk_layout_proses
     WHERE lp_spk_nomor = ?
     ORDER BY lp_sisi, lp_no_urut`,
    [spkNomor],
  );

  return {
    header: headerRows[0] || null,
    proof: detailRows.filter((r) => r.sisi === "PROOF"),
    sewing: detailRows.filter((r) => r.sisi === "SEWING"),
  };
};

// --- Pindahkan layout proses dari key sementara (so_nomor) ke nomor SPK final ---
// Dipakai saat create: user bisa upload Excel layout SEBELUM SPK pertama kali
// disimpan (saat itu satu-satunya identifier yang ada baru so_nomor). Setelah
// SPK tersimpan & dapat nomor resmi, data layout dipindah ke nomor SPK itu.
// Catatan: asumsi tidak ada dua user create SPK dari SO yang sama secara
// bersamaan, jadi key sementara so_nomor aman dipakai tanpa locking tambahan.
const migrateLayoutProses = async (conn, oldNomor, newNomor) => {
  if (!oldNomor || oldNomor === newNomor) return;

  const [existing] = await conn.query(
    `SELECT lh_spk_nomor FROM tspk_layout_header WHERE lh_spk_nomor = ?`,
    [oldNomor],
  );
  if (existing.length === 0) return; // tidak ada layout yang di-upload sebelum save

  // Hapus dulu kalau kebetulan sudah ada row dengan nomor final (re-save/retry)
  await conn.query(`DELETE FROM tspk_layout_header WHERE lh_spk_nomor = ?`, [
    newNomor,
  ]);
  await conn.query(`DELETE FROM tspk_layout_proses WHERE lp_spk_nomor = ?`, [
    newNomor,
  ]);

  await conn.query(
    `UPDATE tspk_layout_header SET lh_spk_nomor = ? WHERE lh_spk_nomor = ?`,
    [newNomor, oldNomor],
  );
  await conn.query(
    `UPDATE tspk_layout_proses SET lp_spk_nomor = ? WHERE lp_spk_nomor = ?`,
    [newNomor, oldNomor],
  );
};

// ============================================================
// KETERANGAN KHUSUS
// ============================================================
const getKeteranganKhusus = async (spkNomor) => {
  const [rows] = await db.query(
    `SELECT kk_keterangan AS keterangan
     FROM tspk_keterangan_khusus
     WHERE kk_spk_nomor = ?
     ORDER BY kk_no_urut ASC`,
    [spkNomor],
  );
  return rows.map((r) => r.keterangan);
};

const saveKeteranganKhusus = async (conn, spkNomor, list) => {
  await conn.query(
    `DELETE FROM tspk_keterangan_khusus WHERE kk_spk_nomor = ?`,
    [spkNomor],
  );

  const validList = (list || []).filter((k) => k && k.trim());
  if (validList.length > 0) {
    const vals = validList.map((k, i) => [spkNomor, i + 1, k.trim()]);
    await conn.query(
      `INSERT INTO tspk_keterangan_khusus (kk_spk_nomor, kk_no_urut, kk_keterangan) VALUES ?`,
      [vals],
    );
  }
};

const getKetKomponenMaster = async () => {
  const [rows] = await db.query(
    `SELECT kode, nama FROM tketkomponen ORDER BY kode ASC`,
  );
  return rows;
};

// ─────────────────────────────────────────────────────────
// GET MKA DARI BAST MAP — sesuai instruksi: kalau SPK berasal dari
// MAP, tarik accessories + babaran yang sudah diinput di tab
// Accesories/Bahan BAST MAP-nya (tkesesuaianmap_acc, tkesesuaianmap_komponen).
// Read-only, murni referensi tambahan buat produksi — TIDAK menggantikan
// checklist tketkomponen (A/B/C...) yang sudah ada, karena itu dipakai
// utk keperluan lain (mis. validasi identifikasi komponen di Mutasi
// Produksi).
// ─────────────────────────────────────────────────────────
const getMkaFromMap = async (mapNomor) => {
  if (!mapNomor) return { aksesoris: [], komponen: [], sizeBreakdown: [] };

  const [aksesoris] = await db.query(
    `SELECT k.kode, k.qty,
            o.brg_nama AS nama, o.brg_satuan AS satuan, o.brg_note AS note
     FROM tkesesuaianmap_acc k
     LEFT JOIN tgarmen_brg o ON o.brg_kode = k.kode AND o.brg_jenis = 'ACCESORIES'
     WHERE k.nomor = ?
     ORDER BY k.no_urut`,
    [mapNomor],
  );

  const [komponen] = await db.query(
    `SELECT kode, komponen, warna, babaran, babarank
     FROM tkesesuaianmap_komponen
     WHERE nomor = ?
     ORDER BY no_urut`,
    [mapNomor],
  );

  // Babaran per size — hanya terisi kalau BAST MAP-nya pakai
  // Rencana Size = BRAKEDOWN SIZE (bukan setiap komponen selalu punya ini)
  const [sizeBreakdown] = await db.query(
    `SELECT ks_komponen AS komponen, ks_size AS size, ks_babaran AS babaran
     FROM tkesesuaianmap_size
     WHERE ks_nomor = ?
     ORDER BY ks_urut`,
    [mapNomor],
  );

  return { aksesoris, komponen, sizeBreakdown };
};

module.exports = {
  getDetail,
  getSoSourceDetail,
  saveData,
  getInitSizes,
  getStandarUkuran,
  getMkbDetailBySpk,
  getKomponenSpk,
  saveKomponenSpk,
  getKomponenMaster,
  importLayoutProses,
  getLayoutProses,
  getKeteranganKhusus,
  saveKeteranganKhusus,
  getKetKomponenMaster,
  getMkaFromMap,
};
