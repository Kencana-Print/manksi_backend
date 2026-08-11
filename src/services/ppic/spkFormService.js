const db = require("../../config/database");
const ExcelJS = require("exceljs");

// ============================================================
// HELPER MAPPING — so_* (kolom fisik tsalesorder) -> spk_*
// (bentuk yang dipakai seluruh logic di bawah, identik dengan
// kolom tspk). Data SO historis (Delphi/pre-migrasi) tetap hidup
// di tspk dengan nama kolom spk_* asli, jadi tidak perlu mapping.
// ============================================================
const mapSoHeaderRow = (row) => {
  if (!row) return row;
  const out = {};
  for (const [key, val] of Object.entries(row)) {
    out[key.startsWith("so_") ? "spk_" + key.slice(3) : key] = val;
  }
  return out;
};

// Cari header SO — coba tsalesorder (data baru) dulu, fallback ke
// tspk legacy (spk_is_so=1, data lama pre-migrasi). Mengembalikan
// { header, source } dengan header sudah berbentuk spk_* seragam.
const getSoHeaderUnified = async (soNomor, conn = db) => {
  const [newRows] = await conn.query(
    `SELECT * FROM tsalesorder WHERE so_nomor = ?`,
    [soNomor],
  );
  if (newRows.length > 0) {
    return { header: mapSoHeaderRow(newRows[0]), source: "new" };
  }
  const [legacyRows] = await conn.query(
    `SELECT * FROM tspk WHERE spk_nomor = ? AND spk_is_so = 1`,
    [soNomor],
  );
  if (legacyRows.length > 0) {
    return { header: legacyRows[0], source: "legacy" };
  }
  return { header: null, source: null };
};

// Ambil size SO — coba tsalesorder_size dulu, fallback tspk_size.
// Kolom sudah di-alias identik dengan getSizeList (spks_* style)
// supaya bisa langsung dipakai sebagai sizeSource di saveData.
const getSoSizeListUnified = async (soNomor) => {
  const [newRows] = await db.query(
    `SELECT sos_size AS size, sos_qty AS qty,
            sos_ld AS ld, sos_pb AS pb,
            sos_pl_pendek AS pl_pendek, sos_pl_panjang AS pl_panjang,
            sos_p_bahu AS p_bahu, sos_l_lengan AS l_lengan, sos_l_manset AS l_manset,
            sos_l_pinggang AS l_pinggang, sos_p_celana AS p_celana,
            sos_l_panggul AS l_panggul, sos_l_paha AS l_paha,
            sos_pesak AS pesak, sos_l_lutut AS l_lutut, sos_l_bawah AS l_bawah
     FROM tsalesorder_size WHERE sos_so_nomor = ? AND sos_qty > 0`,
    [soNomor],
  );
  if (newRows.length > 0) return newRows;
  return getSizeList(soNomor); // fallback tspk_size, fungsi sudah ada di bawah
};

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
  const nextVal = Number(rows[0].jumlah) + 1; // ← FIX: paksa Number()
  return `${prefix}${String(nextVal).padStart(6, "0")}`;
};

// --- GENERATE NOMOR SPK LEGACY (format: {perush}-{jo}-000001) ---
// Sama persis pola/algoritma dengan generateNomor SPK PPIC, hanya
// tanpa literal prefix "SPK-" di depan.
const generateNomorLegacy = async (perushKode, joKode, conn) => {
  const prefix = `${perushKode}-${joKode}-`;
  const [rows] = await conn.query(
    `SELECT IFNULL(MAX(CAST(SUBSTR(spk_nomor, ?, 6) AS UNSIGNED)), 0) AS jumlah
     FROM tspk
     WHERE spk_perush_kode = ? AND spk_jo_kode = ? AND spk_nomor LIKE ?
     FOR UPDATE`,
    [prefix.length + 1, perushKode, joKode, `${prefix}%`],
  );
  const nextVal = Number(rows[0].jumlah) + 1;
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

  const isPremium = isPremiumWorkshop(header[0].spk_cab);

  // ⚠️ Tab Komponen/Layout Proses/Keterangan HANYA relevan untuk P04.
  // Untuk legacy (P01/P02/P05), query-query ini tetap dipanggil supaya
  // shape response konsisten (array kosong), tapi TIDAK ditampilkan
  // di frontend. Alokasi sebaliknya: selalu diambil, dominan dipakai
  // di legacy tapi tidak ada ruginya kalau kosong di premium.
  const [dtlSize, komponenSpk, layoutProses, keteranganKhusus, alokasi] =
    await Promise.all([
      getSizeList(nomor),
      isPremium
        ? getKomponenSpk(nomor)
        : { ListPotong: [], ListCetakBordir: [] },
      isPremium
        ? getLayoutProses(nomor)
        : { header: null, proof: [], sewing: [] },
      isPremium ? getKeteranganKhusus(nomor) : [],
      getAlokasi(nomor),
    ]);

  const [masterKet] = isPremium
    ? await db.query(
        `SELECT k.kode, k.nama,
              IF(s.skk_kode IS NOT NULL, TRUE, FALSE) AS checked,
              IFNULL(s.skk_ket, '') AS ket
         FROM tketkomponen k
         LEFT JOIN tspk_ketkomponen s ON s.skk_kode = k.kode AND s.skk_spk = ?
         ORDER BY k.kode ASC`,
        [nomor],
      )
    : [[]];

  return {
    header: header[0],
    isPremiumFlow: isPremium, // ← baru, dipakai frontend switch tab
    dtlSize,
    komponenSpk,
    layoutProses,
    keteranganKhusus,
    ketKomponenList: masterKet,
    alokasi,
  };
};

// --- Ambil data SO sebagai dasar pembuatan SPK PPIC baru ---
// UNION-aware: cek tsalesorder (SO baru) dulu, fallback ke tspk
// legacy (SO lama pre-migrasi). JOIN nama (jo_nama, sal_nama, dst)
// dilakukan terpisah setelah header ditemukan, supaya query dasar
// tetap sederhana dan sama untuk kedua sumber.
const getSoSourceDetail = async (soNomor) => {
  const { header, source } = await getSoHeaderUnified(soNomor);
  if (!header) throw new Error("Sales Order tidak ditemukan.");
  if (header.spk_aktif !== "Y" || !header.spk_cmo) {
    throw new Error("SO ini belum aktif/approved, tidak bisa dibuatkan SPK.");
  }

  const [[joRow], [salRow], [perushRow], [cusRow]] = await Promise.all([
    db.query(`SELECT jo_nama FROM tjenisorder WHERE jo_kode = ?`, [
      header.spk_jo_kode,
    ]),
    db.query(`SELECT sal_nama FROM tsales WHERE sal_kode = ?`, [
      header.spk_sal_kode,
    ]),
    db.query(`SELECT perush_nama FROM tperusahaan WHERE perush_kode = ?`, [
      header.spk_perush_kode,
    ]),
    db.query(`SELECT cus_nama, cus_perfect FROM tcustomer WHERE cus_kode = ?`, [
      header.spk_cus_kode,
    ]),
  ]);
  header.jo_nama = joRow[0]?.jo_nama || "";
  header.sal_nama = salRow[0]?.sal_nama || "";
  header.perush_nama = perushRow[0]?.perush_nama || "";
  header.cus_nama = cusRow[0]?.cus_nama || "";
  header.cus_perfect = cusRow[0]?.cus_perfect || "N";

  const dtlSize = await getSoSizeListUnified(soNomor);
  const isPremium = isPremiumWorkshop(header.spk_cab);
  const soAlokasi = isPremium ? [] : await getSoAlokasiReference(soNomor);

  return {
    header,
    dtlSize,
    _soSource: source,
    isPremiumFlow: isPremium,
    soAlokasi, // referensi saja, untuk tombol "copy dari SO" di frontend
  };
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
// FILTER KOLOM TSPK — cegah field yang nyasar dari skema tsalesorder
// (yang subset/beda dari tspk) bikin crash "Unknown column" saat INSERT.
// Cache di-load sekali, refresh kalau kosong/gagal.
// ============================================================
let _tspkColumnsCache = null;
const getTspkColumns = async (conn = db) => {
  if (_tspkColumnsCache) return _tspkColumnsCache;
  const [rows] = await conn.query(`SHOW COLUMNS FROM tspk`);
  _tspkColumnsCache = new Set(rows.map((r) => r.Field));
  return _tspkColumnsCache;
};

const filterToTspkColumns = async (obj, conn = db) => {
  const validCols = await getTspkColumns(conn);
  const out = {};
  for (const [key, val] of Object.entries(obj)) {
    if (validCols.has(key)) out[key] = val;
  }
  return out;
};

const getKomponenFromProof = async (identifierNomor) => {
  if (!identifierNomor) return { ListPotong: [], ListCetakBordir: [] };

  const [rows] = await db.query(
    `SELECT DISTINCT d.pfd_kode AS Kode, b.Bhn_Name AS Nama, h.pf_lini AS Lini
     FROM tproofgarmen_hdr h
     INNER JOIN tproofgarmen_dtl d ON d.pfd_nomor = h.pf_nomor
     LEFT JOIN tbahan b ON b.Bhn_kode = d.pfd_kode
     WHERE h.pf_spk_nomor = ? AND d.pfd_kode <> ''`,
    [identifierNomor],
  );

  const ListPotong = [];
  const ListCetakBordir = [];
  for (const r of rows) {
    if (r.Lini === "POTONG") {
      ListPotong.push({ Kode: r.Kode, Nama: r.Nama });
    } else if (
      r.Lini === "CETAK" ||
      r.Lini === "SUBLIM" ||
      r.Lini === "BORDIR"
    ) {
      // FIX: mapping default Proses per lini — sebelumnya SUBLIM
      // ikut ke-default "SABLON", sekarang benar per lini.
      const defaultProses =
        r.Lini === "BORDIR"
          ? "BORDIR"
          : r.Lini === "SUBLIM"
            ? "SUBLIM"
            : "SABLON";
      ListCetakBordir.push({
        Kode: r.Kode,
        Nama: r.Nama,
        Proses: defaultProses,
        Penempatan: "",
        Ukuran: "",
      });
    }
  }
  return { ListPotong, ListCetakBordir };
};

// --- Recompute tspk_komponen_potong/cetak_bordir dari Proof Garmen.
// ListPotong: full replace (tidak ada field manual di sini).
// ListCetakBordir: Kode/Nama ikut Proof, TAPI Proses/Penempatan/Ukuran
// yang sudah diisi user (dari payload saat save) DIPERTAHANKAN,
// dicocokkan per Kode — supaya input manual itu tidak hilang setiap
// kali komponen di-refresh ulang dari Proof.
const refreshKomponenFromProof = async (
  conn,
  nomor,
  payloadKomponenSpk = {},
) => {
  const [[row]] = await conn.query(
    `SELECT spk_memo, spk_so_ref FROM tspk WHERE spk_nomor = ?`,
    [nomor],
  );
  const identifier = row?.spk_memo || row?.spk_so_ref || "";
  const proofData = await getKomponenFromProof(identifier);

  // POTONG: gabung Proof (otomatis) + baris manual (Kode tidak ada di
  // Proof) supaya baris manual tidak hilang tiap kali disimpan ulang.
  const proofPotongKodes = new Set(proofData.ListPotong.map((p) => p.Kode));
  const manualPotong = (payloadKomponenSpk.ListPotong || []).filter(
    (r) => r.Kode && !proofPotongKodes.has(r.Kode),
  );
  const ListPotong = [...proofData.ListPotong, ...manualPotong];

  // SECOND PROCESS: sama pola — Proof entries di-refresh Kode/Nama tapi
  // pertahankan Proses/Penempatan/Ukuran yg sudah diisi user, DAN baris
  // manual (Kode tidak ada di Proof) tetap dipertahankan apa adanya.
  const existingByKode = new Map(
    (payloadKomponenSpk.ListCetakBordir || []).map((r) => [r.Kode, r]),
  );
  const proofCbKodes = new Set(proofData.ListCetakBordir.map((p) => p.Kode));
  const fromProof = proofData.ListCetakBordir.map((p) => {
    const existing = existingByKode.get(p.Kode);
    return {
      Kode: p.Kode,
      Nama: p.Nama,
      Proses: existing?.Proses || p.Proses,
      Penempatan: existing?.Penempatan || "",
      Ukuran: existing?.Ukuran || "",
    };
  });
  const manualCetakBordir = (payloadKomponenSpk.ListCetakBordir || []).filter(
    (r) => r.Kode && !proofCbKodes.has(r.Kode),
  );
  const ListCetakBordir = [...fromProof, ...manualCetakBordir];

  await saveKomponenSpk(conn, nomor, { ListPotong, ListCetakBordir });
  return { ListPotong, ListCetakBordir };
};

// ─────────────────────────────────────────────────────────
// ROUTING SPK LEGACY vs SPK PPIC BARU
// Hanya divisi 1 (Spanduk) & 5 (MMT) yang pakai format nomor lama
// (tanpa prefix "SPK-") dan alur/tampilan mirip form SO.
// Divisi 4 (Garmen) — baik medium (P01) maupun premium (P04) —
// tetap pakai format SPK-{perush}-{jo}-000001 seperti sekarang.
// ─────────────────────────────────────────────────────────
const isLegacySpkFlow = (divisi) => {
  const d = String(divisi).charAt(0);
  return d === "1" || d === "5";
};

// ─────────────────────────────────────────────────────────
// PREMIUM vs LEGACY FLOW — berdasarkan WORKSHOP (spk_cab), BUKAN
// divisi. Ini independen dari isLegacySpkFlow (yang urus format nomor).
// P04 = garmen premium → tab Komponen/Layout Proses/Keterangan.
// P01/P02/P05 = medium/spanduk/MMT → tab Order ala-SO + Alokasi.
// ─────────────────────────────────────────────────────────
const isPremiumWorkshop = (cab) => String(cab).toUpperCase() === "P04";

// --- ALOKASI SPK (tspk_alokasi) — mirip tsalesorder_alokasi, tapi
// milik SPK sendiri (bisa beda dari alokasi SO sumbernya). ---
const getAlokasi = async (spkNomor) => {
  const [rows] = await db.query(
    `SELECT spka_urut AS urut, spka_alamat AS alamat, spka_kota AS kota,
            spka_person AS person, spka_hp AS hp, spka_jumlah AS jumlah
     FROM tspk_alokasi WHERE spka_spk_nomor = ? ORDER BY spka_urut`,
    [spkNomor],
  );
  return rows;
};

const saveAlokasi = async (conn, spkNomor, list) => {
  await conn.query(`DELETE FROM tspk_alokasi WHERE spka_spk_nomor = ?`, [
    spkNomor,
  ]);
  const rows = (list || []).filter((item) => item.alamat || item.kota);
  if (rows.length === 0) return;

  const vals = rows.map((item, i) => [
    spkNomor,
    i + 1,
    item.alamat || "",
    item.kota || "",
    item.person || "",
    item.hp || "",
    item.jumlah || 0,
  ]);
  await conn.query(
    `INSERT INTO tspk_alokasi
       (spka_spk_nomor, spka_urut, spka_alamat, spka_kota, spka_person, spka_hp, spka_jumlah)
     VALUES ?`,
    [vals],
  );
};

// --- Ambil alokasi milik SO sumber, sebagai REFERENSI awal saja
// (tombol "copy dari SO" di frontend, bukan auto-copy) — SO-aware
// karena SO bisa hidup di tsalesorder (baru) atau tspk legacy. ---
const getSoAlokasiReference = async (soNomor) => {
  const [newRows] = await db.query(
    `SELECT soa_urut AS urut, soa_alamat AS alamat, soa_kota AS kota,
            soa_person AS person, soa_hp AS hp, soa_jumlah AS jumlah
     FROM tsalesorder_alokasi WHERE soa_so_nomor = ? ORDER BY soa_urut`,
    [soNomor],
  );
  if (newRows.length > 0) return newRows;

  // ⚠️ ASUMSI: SO legacy (pre-migrasi, hidup di tspk) alokasinya juga
  // di tsalesorder_alokasi dengan key so_nomor lama, BUKAN tabel
  // terpisah — karena tsalesorder_alokasi baru dibuat saat migrasi SO.
  // Kalau ternyata SO legacy alokasinya di tabel lain, kasih tau.
  return [];
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
    alokasi,
  } = payload;

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    let nomor;
    let cabForFlow; // dipakai untuk tentukan premium/legacy setelah header ada

    if (!isEdit) {
      // --- CREATE: copy header dari SO terpilih ---
      // UNION-aware: SO sumber bisa berasal dari tsalesorder (baru)
      // atau tspk legacy (lama, pre-migrasi). Header sudah dalam
      // bentuk spk_* seragam via getSoHeaderUnified, sehingga
      // seluruh logic copy-ke-tspk di bawah TIDAK berubah sama sekali.
      if (!so_nomor) throw new Error("No. SO sumber wajib dipilih.");
      const { header: soHeader } = await getSoHeaderUnified(so_nomor, conn);
      if (!soHeader) throw new Error("Sales Order tidak ditemukan.");
      if (soHeader.spk_aktif !== "Y" || !soHeader.spk_cmo) {
        throw new Error(
          "SO ini belum aktif/approved, tidak bisa dibuatkan SPK.",
        );
      }
      cabForFlow = soHeader.spk_cab;

      // CEK DIVISI: Jika Spanduk/MMT (Legacy), tetap generate nomor baru dari database.
      // Jika divisi lain (Garmen, dll), otomatis mewarisi nomor SO.
      if (isLegacySpkFlow(soHeader.spk_divisi)) {
        nomor = await generateNomorLegacy(
          soHeader.spk_perush_kode,
          soHeader.spk_jo_kode,
          conn,
        );
      } else {
        const nomorWarisan = so_nomor.startsWith("SO-")
          ? so_nomor.replace("SO-", "SPK-")
          : so_nomor;

        // ⚠️ GUARD: nomor warisan dari SO bisa BENTROK dengan nomor SPK
        // "sisa debt" dari counter lama (generateNomor), karena dulu SPK
        // dibuat via increment independen, bukan mengikuti nomor SO.
        // Contoh nyata: SPK-JA-KO-000004 sudah kepakai duluan oleh SO
        // yang BEDA (SO-JA-KO-000009), sebelum skema ini dipasang.
        // Kalau nomor warisan sudah dipakai SO lain, fallback ke skema
        // counter lama supaya tidak duplicate key / salah tempel data.
        const [clash] = await conn.query(
          `SELECT spk_so_ref FROM tspk WHERE spk_nomor = ? FOR UPDATE`,
          [nomorWarisan],
        );
        const isClashWithOtherSo =
          clash.length > 0 && clash[0].spk_so_ref !== so_nomor;

        if (isClashWithOtherSo) {
          nomor = await generateNomor(
            soHeader.spk_perush_kode,
            soHeader.spk_jo_kode,
            conn,
          );
        } else if (clash.length > 0) {
          // Kasus retry/re-submit SO yang sama: SPK-nya sendiri sudah ada.
          throw new Error(
            `SPK untuk SO ${so_nomor} sudah pernah dibuat (${nomorWarisan}). Silakan gunakan mode Ubah.`,
          );
        } else {
          nomor = nomorWarisan;
        }
      }

      const newHeader = { ...soHeader };
      delete newHeader.spk_nomor;
      delete newHeader.spk_is_so;
      newHeader.spk_nomor = nomor;
      newHeader.spk_is_so = 0;
      newHeader.spk_so_ref = so_nomor;
      newHeader.spk_aktif = "Y";
      newHeader.spk_ketbeli = spk_ketbeli || "";
      newHeader.spk_keterangan = spk_keterangan || "";
      newHeader.spk_tanggal = new Date();
      newHeader.user_create = user.kode;
      newHeader.date_create = new Date();
      delete newHeader.user_modified;
      delete newHeader.date_modified;
      const filteredHeader = await filterToTspkColumns(newHeader, conn);
      await conn.query(`INSERT INTO tspk SET ?`, [filteredHeader]);
      // Copy size dari SO (tsalesorder_size ATAU tspk_size, tergantung
      // sumber) sebagai starting point, lalu override dengan dtlSize
      // dari payload kalau user sudah sesuaikan di form
      const sizeSource =
        dtlSize && dtlSize.length > 0
          ? dtlSize
          : await getSoSizeListUnified(so_nomor);
      await saveSizeList(conn, nomor, sizeSource);

      // ⚠️ BARU: auto-copy alokasi dari SO sumber (kalau ada) saat create.
      // Hanya relevan untuk legacy flow, tapi dijalankan apa adanya untuk
      // semua cab — kalau SO tidak punya alokasi, otomatis no-op (array kosong).
      // Payload.alokasi (kalau user sudah edit manual di form sebelum submit
      // pertama) diprioritaskan; kalau kosong, baru fallback copy dari SO.
      const alokasiSource =
        alokasi && alokasi.length > 0
          ? alokasi
          : await getSoAlokasiReference(so_nomor);
      if (alokasiSource.length > 0) {
        await saveAlokasi(conn, nomor, alokasiSource);
      }

      await migrateLayoutProses(conn, so_nomor, nomor);
    } else {
      // --- EDIT: hanya update field produksi ---
      if (!spk_nomor) throw new Error("No. SPK wajib diisi.");
      nomor = spk_nomor;

      const [exist] = await conn.query(
        `SELECT spk_nomor, spk_cab FROM tspk WHERE spk_nomor = ? AND spk_is_so = 0`,
        [nomor],
      );
      if (exist.length === 0) throw new Error("Data SPK PPIC tidak ditemukan.");
      cabForFlow = exist[0].spk_cab;

      await conn.query(
        `UPDATE tspk SET spk_ketbeli = ?, spk_keterangan = ?, user_modified = ?, date_modified = NOW()
         WHERE spk_nomor = ?`,
        [spk_ketbeli || "", spk_keterangan || "", user.kode, nomor],
      );

      if (dtlSize) {
        await saveSizeList(conn, nomor, dtlSize);
      }
    }

    // ─────────────────────────────────────────────
    // CABANG PREMIUM vs LEGACY — hanya P04 yang proses
    // Komponen/Layout-Proses(Excel)/Keterangan; selain itu simpan Alokasi.
    // ─────────────────────────────────────────────
    if (isPremiumWorkshop(cabForFlow)) {
      await refreshKomponenFromProof(conn, nomor, komponenSpk || {});
      if (keteranganKhusus !== undefined) {
        await saveKeteranganKhusus(conn, nomor, keteranganKhusus);
      }
      if (payload.ketKomponenList !== undefined) {
        await conn.query(`DELETE FROM tspk_ketkomponen WHERE skk_spk = ?`, [
          nomor,
        ]);
        const checked = (payload.ketKomponenList || []).filter(
          (k) => k.checked,
        );
        if (checked.length > 0) {
          const vals = checked.map((k) => [nomor, k.kode, k.ket || ""]);
          await conn.query(
            `INSERT INTO tspk_ketkomponen (skk_spk, skk_kode, skk_ket) VALUES ?`,
            [vals],
          );
        }
      }
    } else if (isEdit && alokasi !== undefined) {
      // Create sudah di-handle di atas (auto-copy dari SO / payload awal).
      // Blok ini khusus edit, supaya user bisa update alokasi manual.
      await saveAlokasi(conn, nomor, alokasi);
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

  const unwrapFormula = (v) => {
    if (v && typeof v === "object") return "result" in v ? v.result : null;
    return v;
  };
  const toStr = (v) => {
    const val = unwrapFormula(v);
    if (val === null || val === undefined) return "";
    if (typeof val === "number") return String(Math.round(val * 100) / 100);
    return String(val).trim();
  };
  const toNum = (v) => {
    const val = unwrapFormula(v);
    if (val === null || val === undefined || val === "") return 0;
    const n =
      typeof val === "number" ? val : Number(String(val).replace(",", "."));
    return isNaN(n) ? 0 : n;
  };
  // Normalisasi teks label header: uppercase, buang spasi & tanda titik/titik-dua.
  // Dipakai buat matching label yang gak selalu identik persis antar
  // versi template ("EFFISEENSI :" vs "EFFISEENSI:" dst).
  const norm = (s) =>
    toStr(s).toUpperCase().replace(/\s+/g, "").replace(/[.:]/g, "");

  // ─────────────────────────────────────────────────────────────
  // HEADER — dibaca DINAMIS dari label di baris 3-6, bukan alamat sel
  // hardcode. Ada ≥2 varian template beredar dengan posisi kolom
  // header yang beda-beda (kadang value tepat di sebelah kanan label,
  // kadang ada beberapa kolom penyekat kosong) — scan toleran sampai
  // 5 kolom ke kanan, tapi berhenti kalau ketemu teks label lain
  // (tandanya field ini memang kosong, bukan nyerempet ke field
  // sebelah).
  // ─────────────────────────────────────────────────────────────
  const buildHeaderInfo = () => {
    const targets = {
      no_memo: "NOMEMO",
      nama_memo: "NAMAMEMO",
      line: "LINE",
      poj: "POJ",
      mp: "MP",
      jk: "JK",
      efisiensi: "EFFISEENSI",
      target_hari: "TARGETHARI",
    };
    const stopOnlyLabels = ["TANGGAL"];
    const labelSet = new Set([...Object.values(targets), ...stopOnlyLabels]);

    const result = {};
    for (let r = 3; r <= 6; r++) {
      const row = ws.getRow(r);
      for (let c = 1; c <= 20; c++) {
        const label = norm(row.getCell(c).value);
        if (!label || !Object.values(targets).includes(label)) continue;
        const key = Object.keys(targets).find((k) => targets[k] === label);
        if (result[key] !== undefined) continue;

        let val = "";
        for (let off = 1; off <= 5; off++) {
          const candidateRaw = toStr(row.getCell(c + off).value);
          const candidateNorm = norm(row.getCell(c + off).value);
          if (labelSet.has(candidateNorm)) break; // ketemu label lain -> field ini kosong
          if (candidateRaw) {
            val = candidateRaw;
            break;
          }
        }
        result[key] = val;
      }
    }
    for (const key of Object.keys(targets)) {
      if (result[key] === undefined) result[key] = "";
    }
    return result;
  };

  // ─────────────────────────────────────────────────────────────
  // KOLOM DETAIL — dibaca DINAMIS dari label di baris 7 (header
  // tabel), dipisah dua blok (Proof / Sewing) memakai kolom
  // "SELESAI" sebagai batas. Sebagian varian template punya kolom
  // SEPATU/UK.JARUM tambahan, sebagian tidak — pendekatan dinamis ini
  // otomatis menyesuaikan berapa pun & di posisi mana pun kolom itu
  // berada, tanpa perlu hardcode per-varian template.
  // ─────────────────────────────────────────────────────────────
  const buildColumnMap = (headerRow) => {
    const row = ws.getRow(headerRow);
    const labels = {};
    let selesaiCol = null;
    for (let c = 1; c <= 30; c++) {
      const raw = norm(row.getCell(c).value);
      if (!raw) continue;
      if (raw === "SELESAI") {
        selesaiCol = c;
        continue;
      }
      labels[c] = raw;
    }
    if (!selesaiCol) {
      throw new Error(
        "Format Excel tidak dikenali: kolom 'SELESAI' (pemisah Proof/Sewing) tidak ditemukan di baris header.",
      );
    }
    const findCol = (range, target) => {
      for (const [c, label] of Object.entries(labels)) {
        const ci = Number(c);
        if (ci >= range[0] && ci <= range[1] && label === target) return ci;
      }
      return null;
    };
    const proofRange = [1, selesaiCol - 1];
    const sewingRange = [selesaiCol + 1, 30];
    return {
      proof: {
        nama_op: findCol(proofRange, "NAMAOP"),
        mp: findCol(proofRange, "MP"),
        ct_dt: findCol(proofRange, "CT(DT)"),
        ct_jam: findCol(proofRange, "CT(JAM)"),
        sepatu: findCol(proofRange, "SEPATU"),
        kjarum: findCol(proofRange, "UKJARUM"),
        mc: findCol(proofRange, "M/C"),
        proses: findCol(proofRange, "PROSES"),
      },
      sewing: {
        proses: findCol(sewingRange, "PROSES"),
        mc: findCol(sewingRange, "M/C"),
        ukjarum: findCol(sewingRange, "UKJARUM"),
        sepatu: findCol(sewingRange, "SEPATU"),
        ct_jam: findCol(sewingRange, "CT(JAM)"),
        ct_dt: findCol(sewingRange, "CT(DT)"),
        mp: findCol(sewingRange, "MP"),
        nama_op: findCol(sewingRange, "NAMAOP"),
      },
      // ✅ BARU: kolom angka urutan proses global, TEPAT mengapit kolom
      // SELESAI/panah (kiri=urutan blok Proof, kanan=urutan blok Sewing).
      // Dikonfirmasi dari template Excel asli — bukan header berlabel
      // teks, jadi dicari lewat posisi relatif, bukan pencarian label.
      orderCols: {
        proof: selesaiCol - 1,
        sewing: selesaiCol + 1,
      },
    };
  };

  // ✅ BARU: baca baris SUMMARY 1 / SUMMARY 2 / TOTAL / TOTAL DALAM MENIT
  // di footer template. Dibaca dari KOLOM YANG SAMA dengan kolom data
  // (cols.proof.mp/ct_dt/ct_jam untuk sisi kiri, cols.sewing.* untuk
  // sisi kanan) — bukan alamat sel hardcode, supaya tetap toleran
  // terhadap pergeseran kolom antar varian template seperti header info.
  const parseFooterSummary = (footerStartRow, colsRef) => {
    const summary = {
      summary1: { mp: 0, ctDt: 0, ctJam: 0 },
      summary2: { mp: 0, ctDt: 0, ctJam: 0 },
      total: { mp: 0, ctDt: 0, ctJam: 0 },
      totalMenit: 0,
    };
    const scanEnd = Math.min(footerStartRow + 8, ws.rowCount);
    for (let r = footerStartRow; r <= scanEnd; r++) {
      const row = ws.getRow(r);
      for (let c = 1; c <= 20; c++) {
        const label = norm(row.getCell(c).value);
        if (!label) continue;
        if (label === "SUMMARY1") {
          summary.summary1.mp = toNum(getVal(row, colsRef.proof.mp));
          summary.summary1.ctDt = toNum(getVal(row, colsRef.proof.ct_dt));
          summary.summary1.ctJam = toNum(getVal(row, colsRef.proof.ct_jam));
        } else if (label === "SUMMARY2") {
          summary.summary2.ctJam = toNum(getVal(row, colsRef.sewing.ct_jam));
          summary.summary2.ctDt = toNum(getVal(row, colsRef.sewing.ct_dt));
          summary.summary2.mp = toNum(getVal(row, colsRef.sewing.mp));
        } else if (label === "TOTAL") {
          summary.total.mp = toNum(getVal(row, colsRef.proof.mp));
          summary.total.ctDt = toNum(getVal(row, colsRef.proof.ct_dt));
          summary.total.ctJam = toNum(getVal(row, colsRef.proof.ct_jam));
        } else if (label === "TOTALDALAMMENIT") {
          for (let cc = c + 1; cc <= c + 6; cc++) {
            const v = toNum(row.getCell(cc).value);
            if (v) {
              summary.totalMenit = v;
              break;
            }
          }
        }
      }
    }
    return summary;
  };

  const header = buildHeaderInfo();
  const cols = buildColumnMap(7);
  if (!cols.proof.proses || !cols.sewing.proses) {
    throw new Error(
      "Format Excel tidak dikenali: kolom PROSES untuk Proof/Sewing tidak ditemukan.",
    );
  }
  const getVal = (row, col) => (col ? row.getCell(col).value : null);
  const FOOTER_MARKERS = ["SUMMARY", "TOTAL", "TERTANDA", "MENGETAHUI"];
  const isFooterRow = (val) => {
    const s = toStr(val).toUpperCase();
    return FOOTER_MARKERS.some((m) => s.startsWith(m));
  };
  const startRow = 8;
  const endRow = ws.rowCount;
  // ✅ BARU: satu list GABUNGAN (bukan proof/sewing terpisah) — sesuai
  // instruksi user, Proof dan Sewing itu SATU rangkaian proses yang
  // sama, cuma template Excel-nya kebetulan dipecah jadi 2 blok kolom.
  // Urutan finalnya dibaca dari angka eksplisit di orderCols, BUKAN
  // dari posisi baris — karena angka itu bolak-balik kanan-kiri
  // (1=kanan, 2=kiri, 3=kanan, dst), tidak bisa ditebak dari urutan baca.
  const collected = [];
  let footerStartRow = null;
  for (let r = startRow; r <= endRow; r++) {
    const row = ws.getRow(r);
    if (isFooterRow(row.getCell(3).value)) {
      footerStartRow = r; // ✅ BARU — simpan baris tempat footer mulai
      break;
    }
    const proofProses = toStr(getVal(row, cols.proof.proses));
    if (proofProses) {
      collected.push({
        sisi: "PROOF",
        urutan: toNum(getVal(row, cols.orderCols.proof)),
        proses: proofProses,
        mc: toStr(getVal(row, cols.proof.mc)),
        ukjarum: "",
        kjarum: toStr(getVal(row, cols.proof.kjarum)),
        sepatu: toStr(getVal(row, cols.proof.sepatu)),
        ct_jam: toNum(getVal(row, cols.proof.ct_jam)),
        ct_dt: toNum(getVal(row, cols.proof.ct_dt)),
        mp: toNum(getVal(row, cols.proof.mp)),
        nama_op: toStr(getVal(row, cols.proof.nama_op)),
      });
    }
    const sewingProses = toStr(getVal(row, cols.sewing.proses));
    if (sewingProses) {
      collected.push({
        sisi: "SEWING",
        urutan: toNum(getVal(row, cols.orderCols.sewing)),
        proses: sewingProses,
        mc: toStr(getVal(row, cols.sewing.mc)),
        ukjarum: toStr(getVal(row, cols.sewing.ukjarum)),
        kjarum: "",
        sepatu: toStr(getVal(row, cols.sewing.sepatu)),
        ct_jam: toNum(getVal(row, cols.sewing.ct_jam)),
        ct_dt: toNum(getVal(row, cols.sewing.ct_dt)),
        mp: toNum(getVal(row, cols.sewing.mp)),
        nama_op: toStr(getVal(row, cols.sewing.nama_op)),
      });
    }
  }
  // Urutkan berdasar angka eksplisit dari Excel. Kalau semua angka
  // 0/tidak kebaca (template lama tanpa kolom nomor ini), fallback ke
  // urutan baca-alami supaya import tidak gagal total — tapi hasilnya
  // TIDAK terjamin sesuai proses asli, cuma jaring pengaman terakhir.
  const hasValidOrder = collected.some((r) => r.urutan > 0);
  const orderedRows = hasValidOrder
    ? [...collected].sort((a, b) => a.urutan - b.urutan)
    : collected;
  orderedRows.forEach((r, i) => {
    r.no_urut = i + 1;
  });
  const footerSummary = footerStartRow
    ? parseFooterSummary(footerStartRow, cols)
    : {
        summary1: { mp: 0, ctDt: 0, ctJam: 0 },
        summary2: { mp: 0, ctDt: 0, ctJam: 0 },
        total: { mp: 0, ctDt: 0, ctJam: 0 },
        totalMenit: 0,
      };
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(
      `INSERT INTO tspk_layout_header
      (lh_spk_nomor, lh_no_memo, lh_nama_memo, lh_line, lh_poj, lh_mp, lh_jk, lh_efisiensi, lh_target_hari,
        lh_summary1_mp, lh_summary1_ct_dt, lh_summary1_ct_jam,
        lh_summary2_mp, lh_summary2_ct_dt, lh_summary2_ct_jam,
        lh_total_mp, lh_total_ct_dt, lh_total_ct_jam, lh_total_menit,
        lh_uploaded_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
      ON DUPLICATE KEY UPDATE
        lh_no_memo=VALUES(lh_no_memo), lh_nama_memo=VALUES(lh_nama_memo),
        lh_line=VALUES(lh_line), lh_poj=VALUES(lh_poj), lh_mp=VALUES(lh_mp),
        lh_jk=VALUES(lh_jk), lh_efisiensi=VALUES(lh_efisiensi),
        lh_target_hari=VALUES(lh_target_hari),
        lh_summary1_mp=VALUES(lh_summary1_mp), lh_summary1_ct_dt=VALUES(lh_summary1_ct_dt), lh_summary1_ct_jam=VALUES(lh_summary1_ct_jam),
        lh_summary2_mp=VALUES(lh_summary2_mp), lh_summary2_ct_dt=VALUES(lh_summary2_ct_dt), lh_summary2_ct_jam=VALUES(lh_summary2_ct_jam),
        lh_total_mp=VALUES(lh_total_mp), lh_total_ct_dt=VALUES(lh_total_ct_dt), lh_total_ct_jam=VALUES(lh_total_ct_jam), lh_total_menit=VALUES(lh_total_menit),
        lh_uploaded_at=NOW()`,
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
        footerSummary.summary1.mp,
        footerSummary.summary1.ctDt,
        footerSummary.summary1.ctJam,
        footerSummary.summary2.mp,
        footerSummary.summary2.ctDt,
        footerSummary.summary2.ctJam,
        footerSummary.total.mp,
        footerSummary.total.ctDt,
        footerSummary.total.ctJam,
        footerSummary.totalMenit,
      ],
    );
    await conn.query(`DELETE FROM tspk_layout_proses WHERE lp_spk_nomor = ?`, [
      spkNomor,
    ]);
    if (orderedRows.length > 0) {
      const vals = orderedRows.map((r) => [
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
  if (orderedRows.length === 0) {
    throw new Error(
      "Tidak ada baris proses yang terdeteksi di file ini. Pastikan file sudah terisi (bukan form kosong) dan formatnya sesuai template.",
    );
  }
  return {
    header,
    total: orderedRows.length,
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
     ORDER BY lp_no_urut ASC`,
    [spkNomor],
  );
  // ✅ Dipisah kembali per sisi buat tampilan 2 kolom (mirip Excel),
  // TAPI no_urut tetap nomor asli dari Excel (ganjil di kanan/SEWING,
  // genap di kiri/PROOF) — bukan di-nomor ulang 1..N per sisi. Karena
  // sort global sebelumnya sudah pakai angka Excel asli, no_urut per
  // baris di sini otomatis persis sama dengan nomor yang tertera di
  // template (1,3,5,... di kanan / 2,4,6,... di kiri).
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
  getKomponenFromProof,
  refreshKomponenFromProof,
  isLegacySpkFlow,
  generateNomorLegacy,
  isPremiumWorkshop,
  getAlokasi,
  saveAlokasi,
  getSoAlokasiReference,
};
