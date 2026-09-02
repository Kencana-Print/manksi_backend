const db = require("../../config/database");
const fs = require("fs");
const path = require("path");

// ⚠️ FIX: sebelumnya cuma cek 1 folder flat legacy (/mnt/image), jadi
// SELALU balikin false untuk gambar yang tersimpan di folder
// per-cabang (public/images/<cab>/) atau folder map/ (public/images/
// <cab>/map/<nomorMap>.jpg) — pola penyimpanan yang sekarang justru
// paling umum dipakai project ini (lihat SpkPrintView.resolveDesignImage
// & PoInternalSpkPrintView.resolveDesignImage). mapNomor opsional —
// diisi kalau SPK ini originasinya dari MAP (beda dari nomorSpk itu
// sendiri).
const IMAGES_ROOT = path.join(process.cwd(), "public", "images");

const checkGambarSpk = (nomorSpk, mapNomor = "") => {
  if (!nomorSpk) return false;

  // 1. Folder flat legacy (VPS lama)
  if (fs.existsSync(path.join("/mnt/image", `${nomorSpk}.jpg`))) return true;

  // 2. Scan semua folder cabang di public/images/, cek 2 kemungkinan
  // per cabang: file nomorSpk langsung, atau file mapNomor di
  // subfolder map/.
  let cabFolders = [];
  try {
    cabFolders = fs
      .readdirSync(IMAGES_ROOT, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    cabFolders = [];
  }

  for (const cab of cabFolders) {
    if (fs.existsSync(path.join(IMAGES_ROOT, cab, `${nomorSpk}.jpg`))) {
      return true;
    }
    if (
      mapNomor &&
      fs.existsSync(path.join(IMAGES_ROOT, cab, "map", `${mapNomor}.jpg`))
    ) {
      return true;
    }
  }

  return false;
};

// ─────────────────────────────────────────────────────────
// HELPER: generate nomor PO Internal — format POI/00001/2026.
// Replikasi persis pola RightStr(IntToStr(100001+n),5) Delphi, yang
// secara matematis setara String(n+1).padStart(5,'0').
// ─────────────────────────────────────────────────────────
const generateNomor = async (tanggal, conn) => {
  const tahun = new Date(tanggal).getFullYear().toString();
  const [rows] = await conn.query(
    `SELECT IFNULL(MAX(CAST(MID(poi_nomor, 5, 5) AS UNSIGNED)), 0) AS max_num
     FROM tpointernal_hdr
     WHERE RIGHT(poi_nomor, 4) = ?`,
    [tahun],
  );
  const nextNum = parseInt(rows[0].max_num, 10) + 1;
  return `POI/${String(nextNum).padStart(5, "0")}/${tahun}`;
};

// ─────────────────────────────────────────────────────────
// HELPER: Sudah PO — replikasi persis getsudahpo() Delphi. Dipakai
// baik saat nambah baris baru (loadBahan) maupun saat re-load form
// edit (getDetailForm selalu rekalkulasi ulang, tidak simpan cache).
// ─────────────────────────────────────────────────────────
const getSudahPo = async (
  excludeNomor,
  gdgAsal,
  nomorSpk,
  jasa,
  kode,
  size,
) => {
  const [rows] = await db.query(
    `SELECT IFNULL(SUM(d.poid_jumlah), 0) AS jml
     FROM tpointernal_hdr h
     INNER JOIN tpointernal_dtl d ON d.poid_nomor = h.poi_nomor
     WHERE h.poi_nomor <> ?
       AND h.poi_cab = ?
       AND h.poi_spk_nomor = ?
       AND h.poi_jasa_kode = ?
       AND d.poid_bhn_kode = ?
       AND d.poid_size = ?`,
    [excludeNomor || "", gdgAsal, nomorSpk, jasa, kode, size],
  );
  return parseFloat(rows[0]?.jml || 0);
};

// ─────────────────────────────────────────────────────────
// DEFAULT GUDANG ASAL/TUJUAN — replikasi persis refreshdata():
// default gdgAsal dari cabang user (fallback P04/JERON), lalu
// pasangan tujuan hardcode P04<->P01 (persis Delphi, bukan lookup
// dinamis — kalau kombinasi lain, tujuan dibiarkan kosong).
// ─────────────────────────────────────────────────────────
const getDefaultGudang = async (userCabang) => {
  let gdgKode = "";
  let gdgNama = "";

  if (userCabang) {
    const [rows] = await db.query(
      `SELECT pab_kode, pab_nama FROM tpabrik WHERE pab_kode = ?`,
      [userCabang],
    );
    if (rows.length > 0) {
      gdgKode = rows[0].pab_kode;
      gdgNama = rows[0].pab_nama;
    }
  }
  if (!gdgKode) {
    gdgKode = "P04";
    gdgNama = "JERON";
  }

  let supKode = "";
  let supNama = "";
  if (gdgKode === "P04") {
    supKode = "P01";
    supNama = "PADOKAN";
  } else if (gdgKode === "P01") {
    supKode = "P04";
    supNama = "JERON";
  }

  return { gdgKode, gdgNama, supKode, supNama };
};

// ─────────────────────────────────────────────────────────
// CEK PABRIK (Gudang Asal / Tujuan) — replikasi edtGdgKodeExit /
// edtSupKodeExit. WAJIB prefix "P" (LEFT(pab_kode,1)='P'), dan tidak
// boleh sama dengan pabrik pasangannya (asal <> tujuan).
// ⚠️ Di Delphi validasi silang ini TIDAK benar2 mem-block simpan (ada
// bug: pesan muncul tapi kode lanjut) — di web ini DIPERKETAT jadi
// benar2 blocking, karena PO transfer gudang asal=tujuan tidak masuk
// akal secara bisnis. Flag kalau mau direplikasi apa adanya (longgar).
// ─────────────────────────────────────────────────────────
const checkPabrik = async (kode, other) => {
  if (!kode) throw new Error("Kode wajib diisi.");
  if (other && kode.trim().toUpperCase() === other.trim().toUpperCase()) {
    throw new Error("Gudang Asal dan Tujuan tidak boleh sama.");
  }
  const [rows] = await db.query(
    `SELECT pab_kode, pab_nama FROM tpabrik WHERE LEFT(pab_kode, 1) = 'P' AND pab_kode = ?`,
    [kode],
  );
  if (rows.length === 0) throw new Error("Kode Gudang tidak ditemukan.");
  return { kode: rows[0].pab_kode, nama: rows[0].pab_nama };
};

// ─────────────────────────────────────────────────────────
// CEK SPK — replikasi edtNomorSPKExit. ⚠️ CATATAN: query validasi
// exit ini SENGAJA tidak filter jumlah<>jumlah_kirim (beda dari query
// F1 search-nya yang filter itu) — direplikasi persis, karena kalau
// user ketik/pilih nomor SPK yang sudah lunas kirim, validasi exit
// tetap meloloskan asal aktif+divisi+CMO oke. Ini perilaku asli
// Delphi, bukan bug tak sengaja — dibiarkan sama.
// ─────────────────────────────────────────────────────────
const checkSpk = async (nomor) => {
  if (!nomor) throw new Error("Nomor SPK wajib diisi.");
  // ✅ FIX: tambah union tsalesorder (SO baru pasca migrasi) — nomor
  // format lama (tanpa prefix "SPK-") sekarang hidup di sana, bukan
  // lagi di tspk. Juga resolve map_nomor (nomor MAP terkait) untuk
  // dipakai checkGambarSpk, karena gambar SPK yang berasal dari MAP
  // sering tersimpan di folder map/ dengan nama file = nomor MAP,
  // bukan nomor SPK itu sendiri.
  const [rows] = await db.query(
    `SELECT * FROM (
       SELECT so_nomor AS Nomor, so_nama AS Nama, so_kain AS Bahan, so_ukuran AS Ukuran, so_jumlah AS Jumlah, so_cmo AS cmo, so_memo AS MapNomor
       FROM tsalesorder WHERE so_divisi IN (3,4,6) AND so_aktif = 'Y'
       UNION ALL
       SELECT spk_nomor AS Nomor, spk_nama AS Nama, spk_kain AS Bahan, spk_ukuran AS Ukuran, spk_jumlah AS Jumlah, spk_cmo AS cmo, spk_memo AS MapNomor
       FROM tspk WHERE spk_divisi IN (3,4,6) AND spk_aktif = 'Y'
       UNION ALL
       SELECT mspk_nomor, mspk_nama, mspk_kain, mspk_ukuran, mspk_jumlah, mspk_cmo, mspk_nomor AS MapNomor
       FROM tmemospk WHERE mspk_divisi IN (3,4,6)
     ) final WHERE Nomor = ?`,
    [nomor],
  );
  if (rows.length === 0) throw new Error("Nomor Spk tsb tidak ada.");
  const spk = rows[0];
  if (!spk.cmo) {
    throw new Error("SPK tsb belum di approve oleh Chief Marketing.");
  }
  return {
    Nomor: spk.Nomor,
    Nama: spk.Nama,
    Bahan: spk.Bahan,
    Ukuran: spk.Ukuran,
    Jumlah: spk.Jumlah,
    adaGambar: checkGambarSpk(spk.Nomor, spk.MapNomor || ""),
  };
};

// ─────────────────────────────────────────────────────────
// CEK JASA + PLANNING PPIC — replikasi edtJasaExit + isiplan(),
// TAPI disesuaikan ke skema Planning SPK PPIC versi baru (multi-SPK
// per baris, per divisi CUTTING/SEWING/KOLI — bukan lagi kolom flat
// per-jasa kayak skema lama tplan_ppic_dtl2.plan_cutting dst).
//
// Mapping jasa -> divisi (dikonfirmasi user): J02=SEWING, J03=KOLI,
// J07=CUTTING. Di luar 3 kode ini, planning SELALU KOSONG — gak ada
// padanan di skema baru buat J01/J08/J09 dkk (dulu cetak/bordir/
// sublim), jadi dibiarkan kosong sesuai arahan.
//
// Kolom qty yang dipakai: plan_qty_jadwal (dikonfirmasi user).
//
// List bisa nunjukin BANYAK baris untuk 1 SPK yang sama (misal
// beberapa line Sewing) — persis pola lama J02 yang juga multi-baris
// (linea..linek). Tapi PEMILIHAN tetap single-select ("ambil"),
// karena tpointernal_hdr cuma nyimpen 1 set kolom
// poi_plan_nomor/tanggal/jumlah (bukan tabel relasi terpisah).
// Baris pertama otomatis ditandai ambil=true (default), sisanya
// false.
// ─────────────────────────────────────────────────────────
const DIVISI_PER_JASA = { J02: "SEWING", J03: "KOLI", J07: "CUTTING" };

const checkJasa = async (kode, nomorSpk) => {
  if (!kode) throw new Error("Kode Jasa wajib diisi.");
  const [jasaRows] = await db.query(
    `SELECT jasa_nama FROM tjasa WHERE jasa_internal = 'Y' AND jasa_kode = ?`,
    [kode],
  );
  if (jasaRows.length === 0) throw new Error("Kode Jasa tidak ditemukan.");
  const namaJasa = jasaRows[0].jasa_nama;

  let planningRaw = [];
  const divisi = DIVISI_PER_JASA[kode];
  if (nomorSpk && divisi) {
    const [rows] = await db.query(
      `SELECT
         d.plan_pl_nomor AS Nomor,
         DATE_FORMAT(d.plan_tgl_jadwal, '%Y-%m-%d') AS Tanggal,
         d.plan_line_kelompok AS status,
         d.plan_qty_jadwal AS qty
       FROM tplan_ppic_dtl2 d
       INNER JOIN tplan_ppic_hdr h ON h.pl_nomor = d.plan_pl_nomor
       WHERE h.pl_close = 'N'
         AND d.plan_spk = ?
         AND d.plan_divisi = ?
         AND d.plan_qty_jadwal <> 0
       ORDER BY d.plan_tgl_jadwal ASC`,
      [nomorSpk, divisi],
    );
    planningRaw = rows;
  }
  // kode jasa di luar J02/J03/J07 -> planning tetap [] (sesuai arahan)

  const planning = planningRaw.map((p, idx) => ({
    noPlanning: p.Nomor,
    tanggal: p.Tanggal,
    jumlah: parseFloat(p.qty) || 0,
    status: p.status, // sekarang isinya plan_line_kelompok, bukan label sintetis kayak skema lama
    ambil: idx === 0,
  }));

  return { namaJasa, planning };
};

// ─────────────────────────────────────────────────────────
// LOAD BAHAN (tambah baris detail) — replikasi loadkode(). Kalau SPK
// punya breakdown size (tspk_size), 1 kode bisa expand jadi banyak
// baris (1 per size). Kalau SPK lama tanpa size breakdown, 1 baris
// polos (size kosong). Baris {kode,size} yang sudah ada di grid
// (dikirim via existingRows) di-skip, bukan bikin error blocking —
// supaya user bisa nambah beberapa kode bahan sekaligus tanpa
// kehalang gara-gara 1 size-nya duplikat.
// ─────────────────────────────────────────────────────────
const loadBahan = async ({
  kode,
  nomorSpk,
  jasa,
  gdgAsal,
  poiNomor,
  existingRows = [],
}) => {
  if (!nomorSpk) throw new Error("SPK di isi dulu ya!");
  if (!jasa) throw new Error("Jasa di isi dulu ya!");
  if (!gdgAsal) throw new Error("Gudang Asal di isi dulu ya!");
  if (!kode) throw new Error("Kode bahan wajib diisi.");

  // ⚠️ Filter bhn_bordir=1 direplikasi persis dari Delphi HANYA untuk
  // jasa J08 (Bordir). Modal BahanSearchModal mode="komponen" yang
  // dipakai frontend tidak tau konteks jasa, jadi validasi ini WAJIB
  // dilakukan ulang di sini sebagai safety net server-side.
  let whereBordir = "";
  if (jasa === "J08") whereBordir = " AND bhn_bordir = 1";

  // ✅ FIX: suffix match (persis Delphi bhn_kode LIKE '%'+akode), bukan
  // exact match — supaya user bisa ketik cuma "400" dan otomatis
  // ke-resolve ke kode lengkap "LL-000400". Kalau ada beberapa kode
  // yang match suffix sama, ambil 1 yang pertama urut kode (paling
  // deterministik), konsisten sama perilaku "if not Eof" Delphi yang
  // juga cuma ambil baris pertama tanpa validasi keunikan.
  const [bahanRows] = await db.query(
    `SELECT bhn_kode, bhn_name, bhn_satuan
     FROM tbahan
     WHERE bhn_aktif = 0 AND bhn_jb_kode = 'LL' AND bhn_kode LIKE ? ${whereBordir}
     ORDER BY bhn_kode
     LIMIT 1`,
    [`%${kode}`],
  );
  if (bahanRows.length === 0) {
    throw new Error("Kode tsb tidak ditemukan di jasa tsb.");
  }
  const bahan = bahanRows[0];

  const isDup = (size) =>
    existingRows.some(
      (r) => r.kode === bahan.bhn_kode && (r.size || "") === (size || ""),
    );

  const [sizeRows] = await db.query(
    `SELECT spks_size, spks_qty FROM tspk_size WHERE spks_nomor = ?`,
    [nomorSpk],
  );

  const rows = [];
  const skipped = [];

  if (sizeRows.length === 0) {
    // SPK lama, tanpa breakdown size — 1 baris polos
    if (isDup("")) {
      skipped.push({ kode: bahan.bhn_kode, size: "" });
    } else {
      rows.push({
        kode: bahan.bhn_kode,
        nama: bahan.bhn_name,
        satuan: bahan.bhn_satuan,
        size: "",
        jumlah: 0,
        sudahpo: await getSudahPo(
          poiNomor,
          gdgAsal,
          nomorSpk,
          jasa,
          bahan.bhn_kode,
          "",
        ),
      });
    }
  } else {
    for (const sz of sizeRows) {
      const size = sz.spks_size;
      if (isDup(size)) {
        skipped.push({ kode: bahan.bhn_kode, size });
        continue;
      }
      rows.push({
        kode: bahan.bhn_kode,
        nama: bahan.bhn_name,
        satuan: bahan.bhn_satuan,
        size,
        jumlah: 0,
        sudahpo: await getSudahPo(
          poiNomor,
          gdgAsal,
          nomorSpk,
          jasa,
          bahan.bhn_kode,
          size,
        ),
      });
    }
  }

  if (rows.length === 0 && skipped.length > 0) {
    throw new Error("Kode tsb sudah di input.");
  }

  return { rows, skipped };
};

// ─────────────────────────────────────────────────────────
// LOAD ACCESORIES (tambah baris detail — khusus bagian GUDANG) —
// Beda sumber dari loadBahan(): Accesories hidup di tgarmen_brg
// (brg_jenis='ACCESORIES'), BUKAN di tbahan. Tidak terikat ke Jasa
// sama sekali (Jasa itu konsep khusus alur Bahan produksi), dan
// TIDAK ada breakdown per size — 1 kode selalu 1 baris polos.
// getSudahPo() dipakai apa adanya karena generik, tidak spesifik
// ke tabel Bahan.
// ─────────────────────────────────────────────────────────
const loadAccesories = async ({
  kode,
  nomorSpk,
  jasa,
  gdgAsal,
  poiNomor,
  existingRows = [],
}) => {
  if (!nomorSpk) throw new Error("SPK di isi dulu ya!");
  if (!jasa) throw new Error("Jasa di isi dulu ya!");
  if (!gdgAsal) throw new Error("Gudang Asal di isi dulu ya!");
  if (!kode) throw new Error("Kode Accesories wajib diisi.");

  const [rows] = await db.query(
    `SELECT brg_kode, IF(brg_note="", brg_nama, CONCAT(brg_nama, " - ", brg_note)) AS brg_nama, brg_satuan
     FROM tgarmen_brg
     WHERE brg_aktif = 'Y' AND brg_jenis = 'ACCESORIES' AND brg_kode = ?
     LIMIT 1`,
    [kode],
  );
  if (rows.length === 0) {
    throw new Error("Kode Accesories tersebut tidak ditemukan.");
  }
  const barang = rows[0];

  const isDup = existingRows.some(
    (r) => r.kode === barang.brg_kode && (r.size || "") === "",
  );
  if (isDup) {
    throw new Error("Kode tsb sudah di input.");
  }

  const row = {
    kode: barang.brg_kode,
    nama: barang.brg_nama,
    satuan: barang.brg_satuan,
    size: "",
    jumlah: 0,
    sudahpo: await getSudahPo(
      poiNomor,
      gdgAsal,
      nomorSpk,
      jasa,
      barang.brg_kode,
      "",
    ),
  };

  return { rows: [row], skipped: [] };
};

// ─────────────────────────────────────────────────────────
// GET DETAIL FORM (mode edit) — replikasi loaddataall().
// ─────────────────────────────────────────────────────────
const getDetailForm = async (nomor) => {
  const [hdrRows] = await db.query(
    `SELECT h.poi_nomor, DATE_FORMAT(h.poi_tanggal, '%Y-%m-%d') AS poi_tanggal,
            DATE_FORMAT(h.poi_dateline, '%Y-%m-%d') AS poi_dateline,
            h.poi_spk_nomor,
            IFNULL(so.so_nama, IFNULL(s.spk_nama, m.mspk_nama)) AS namaspk,
            IFNULL(so.so_kain, IFNULL(s.spk_kain, m.mspk_kain)) AS bahan,
            IFNULL(so.so_ukuran, IFNULL(s.spk_ukuran, m.mspk_ukuran)) AS ukuran,
            IFNULL(so.so_jumlah, IFNULL(s.spk_jumlah, m.mspk_jumlah)) AS jumlah,
            h.poi_jasa_kode, j.jasa_nama,
            h.poi_cab, c.pab_nama AS namacab,
            h.poi_sup, u.pab_nama AS namasup,
            h.poi_ket, h.poi_close,
            h.poi_plan_nomor,
            DATE_FORMAT(h.poi_plan_tanggal, '%Y-%m-%d') AS poi_plan_tanggal,
            h.poi_plan_jumlah,
            IFNULL(so.so_memo, IFNULL(s.spk_memo, m.mspk_nomor)) AS map_nomor
     FROM tpointernal_hdr h
     LEFT JOIN tsalesorder so ON so.so_nomor = h.poi_spk_nomor
     LEFT JOIN tspk s ON s.spk_nomor = h.poi_spk_nomor
     LEFT JOIN tmemospk m ON m.mspk_nomor = h.poi_spk_nomor
     LEFT JOIN tjasa j ON j.jasa_kode = h.poi_jasa_kode
     LEFT JOIN tpabrik c ON c.pab_kode = h.poi_cab
     LEFT JOIN tpabrik u ON u.pab_kode = h.poi_sup
     WHERE h.poi_nomor = ?`,
    [nomor],
  );
  if (hdrRows.length === 0)
    throw new Error("Data PO Internal tidak ditemukan.");
  const header = hdrRows[0];

  if (String(header.poi_close) === "Y") {
    throw new Error("PO ini sudah Close.");
  }

  header.adaGambar = checkGambarSpk(
    header.poi_spk_nomor,
    header.map_nomor || "",
  );

  const [dtlRows] = await db.query(
    `SELECT d.poid_bhn_kode,
       COALESCE(b.bhn_name, g.brg_nama) AS bhn_name,
       COALESCE(b.bhn_satuan, g.brg_satuan) AS bhn_satuan,
       d.poid_size, d.poid_jumlah
     FROM tpointernal_dtl d
     LEFT JOIN tbahan b ON b.bhn_kode = d.poid_bhn_kode
     LEFT JOIN tgarmen_brg g ON g.brg_kode = d.poid_bhn_kode AND g.brg_jenis = 'ACCESORIES'
     WHERE d.poid_nomor = ?
     ORDER BY d.poid_bhn_kode, d.poid_size`,
    [nomor],
  );

  const detail = [];
  for (const d of dtlRows) {
    detail.push({
      kode: d.poid_bhn_kode,
      nama: d.bhn_name,
      satuan: d.bhn_satuan,
      size: d.poid_size,
      jumlah: parseFloat(d.poid_jumlah) || 0,
      sudahpo: await getSudahPo(
        nomor,
        header.poi_cab,
        header.poi_spk_nomor,
        header.poi_jasa_kode,
        d.poid_bhn_kode,
        d.poid_size,
      ),
    });
  }

  // ⚠️ tpointernal_hdr cuma nyimpen 3 field planning (nomor/tanggal/
  // jumlah) — persis skema Delphi asli, tidak ada kolom Line/Status
  // di header. Supaya kolom "Line/Status" di tabel Planning gak
  // kosong pas mode edit, kita re-lookup ke tplan_ppic_dtl2 (sumber
  // yang masih nyimpen plan_line_kelompok) berdasarkan kombinasi
  // nomor+SPK+tanggal jadwal yang tersimpan — ini murni enrichment
  // tampilan, TIDAK mengubah apa yang disimpan saat save.
  let planningStatus = "";
  if (header.poi_plan_nomor) {
    const [statusRows] = await db.query(
      `SELECT plan_line_kelompok
       FROM tplan_ppic_dtl2
       WHERE plan_pl_nomor = ? AND plan_spk = ? AND plan_tgl_jadwal = ?
       LIMIT 1`,
      [header.poi_plan_nomor, header.poi_spk_nomor, header.poi_plan_tanggal],
    );
    planningStatus = statusRows[0]?.plan_line_kelompok || "";
  }

  const planning = [
    {
      noPlanning: header.poi_plan_nomor || "",
      tanggal: header.poi_plan_tanggal || "",
      jumlah: parseFloat(header.poi_plan_jumlah) || 0,
      status: planningStatus,
      ambil: true,
    },
  ];

  return { header, detail, planning };
};

// ─────────────────────────────────────────────────────────
// SAVE — replikasi simpandata() + validasi F10 (btnsimpanClick).
// ─────────────────────────────────────────────────────────
const saveData = async (payload, user) => {
  const {
    nomor: nomorPayload,
    tanggal,
    dateline,
    nomorSpk,
    jasa,
    gdgAsal,
    supKode,
    keterangan,
    detail = [],
    selectedPlanning, // { noPlanning, tanggal, jumlah } | null
  } = payload;

  const isEdit = !!nomorPayload;

  // ── Validasi F10 ──
  if (new Date(dateline) < new Date(tanggal)) {
    throw new Error("Dateline salah.");
  }
  if (!nomorSpk?.trim()) throw new Error("Isi SPK dengan benar.");
  if (!gdgAsal?.trim()) throw new Error("Gudang Asal belum di isi.");
  if (!supKode?.trim()) throw new Error("Tujuan belum di isi.");
  if (!jasa?.trim()) throw new Error("Jasa diisi dulu.");
  // ⚠️ Diperketat jadi blocking — lihat catatan di checkPabrik().
  if (gdgAsal.trim().toUpperCase() === supKode.trim().toUpperCase()) {
    throw new Error("Asal Gudang dan Tujuan tidak boleh sama.");
  }

  const validDetail = detail.filter((d) => d.kode && d.kode.trim() !== "");
  if (validDetail.length === 0) {
    throw new Error("Detail harus diisi.");
  }
  for (const d of validDetail) {
    if (!parseFloat(d.jumlah)) {
      throw new Error("Jumlah PO harus diisi.");
    }
  }

  // ── Cek PO sudah close (kalau mode edit) ──
  if (isEdit) {
    const [rows] = await db.query(
      `SELECT poi_close FROM tpointernal_hdr WHERE poi_nomor = ?`,
      [nomorPayload],
    );
    if (rows.length > 0 && String(rows[0].poi_close) === "Y") {
      throw new Error("PO ini sudah Close.");
    }
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    let nomor = nomorPayload;
    const dateNow = new Date().toISOString().slice(0, 19).replace("T", " ");

    const pnomor = selectedPlanning?.noPlanning || "";
    const ptanggal = selectedPlanning?.tanggal || tanggal;
    const pjumlah = parseFloat(selectedPlanning?.jumlah) || 0;

    if (isEdit) {
      await conn.query(
        `UPDATE tpointernal_hdr SET
           poi_tanggal = ?, poi_dateline = ?, poi_spk_nomor = ?, poi_jasa_kode = ?,
           poi_cab = ?, poi_sup = ?, poi_ket = ?,
           date_modified = ?, user_modified = ?,
           poi_plan_nomor = ?, poi_plan_tanggal = ?, poi_plan_jumlah = ?
         WHERE poi_nomor = ?`,
        [
          tanggal,
          dateline,
          nomorSpk,
          jasa,
          gdgAsal,
          supKode,
          keterangan || "",
          dateNow,
          user.kode,
          pnomor,
          ptanggal,
          pjumlah,
          nomor,
        ],
      );
    } else {
      nomor = await generateNomor(tanggal, conn);
      await conn.query(
        `INSERT INTO tpointernal_hdr
           (poi_nomor, poi_tanggal, poi_dateline, poi_spk_nomor, poi_jasa_kode, poi_cab, poi_sup, poi_ket,
            date_create, user_create, poi_plan_nomor, poi_plan_tanggal, poi_plan_jumlah)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          nomor,
          tanggal,
          dateline,
          nomorSpk,
          jasa,
          gdgAsal,
          supKode,
          keterangan || "",
          dateNow,
          user.kode,
          pnomor,
          ptanggal,
          pjumlah,
        ],
      );
    }

    await conn.query(`DELETE FROM tpointernal_dtl WHERE POiD_nomor = ?`, [
      nomor,
    ]);

    for (const d of validDetail) {
      await conn.query(
        `INSERT INTO tpointernal_dtl (POid_nomor, POiD_bhn_kode, POiD_size, POiD_jumlah)
         VALUES (?, ?, ?, ?)`,
        [nomor, d.kode, d.size || "", parseFloat(d.jumlah) || 0],
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

// ─────────────────────────────────────────────────────────
// GET DATA CETAK — replikasi cetak().
// ─────────────────────────────────────────────────────────
const getPrintData = async (nomor) => {
  const [rows] = await db.query(
    `SELECT h.poi_nomor, DATE_FORMAT(h.poi_tanggal, '%Y-%m-%d') AS poi_tanggal,
            DATE_FORMAT(h.poi_dateline, '%Y-%m-%d') AS poi_dateline,
            h.poi_spk_nomor, h.user_create,
            IFNULL(so.so_nama, IFNULL(s.spk_nama, m.mspk_nama)) AS namaspk,
            IFNULL(so.so_kain, IFNULL(s.spk_kain, m.mspk_kain)) AS bahan,
            IFNULL(so.so_ukuran, IFNULL(s.spk_ukuran, m.mspk_ukuran)) AS ukuran,
            IFNULL(so.so_jumlah, IFNULL(s.spk_jumlah, m.mspk_jumlah)) AS jumlah,
            IFNULL(so.so_cab, s.spk_cab) AS SpkCab, tu.user_bagian AS UserBagian,
            h.poi_jasa_kode, j.jasa_nama,
            h.poi_cab, c.pab_nama AS namacab,
            h.poi_sup, u.pab_nama AS namasup,
            h.poi_ket,
            IFNULL(so.so_memo, IFNULL(s.spk_memo, m.mspk_nomor)) AS map_nomor,
            -- ⚠️ TAMBAHAN: divisi (untuk deteksi SPK Kaosan) dan invdc
            -- (kunci path gambar di server retail Kaosan). Sama pola
            -- fallback SO -> SPK -> MAP seperti kolom lain di query ini.
            IFNULL(so.so_divisi, IFNULL(s.spk_divisi, m.mspk_divisi)) AS divisi,
            IFNULL(so.so_invdc, s.spk_invdc) AS invdc,
            d.poid_bhn_kode, b.bhn_name, b.bhn_satuan, d.poid_size, d.poid_jumlah
     FROM tpointernal_hdr h
     LEFT JOIN tpointernal_dtl d ON d.poid_nomor = h.poi_nomor
     LEFT JOIN tsalesorder so ON so.so_nomor = h.poi_spk_nomor
     LEFT JOIN tspk s ON s.spk_nomor = h.poi_spk_nomor
     LEFT JOIN tmemospk m ON m.mspk_nomor = h.poi_spk_nomor
     LEFT JOIN tjasa j ON j.jasa_kode = h.poi_jasa_kode
     LEFT JOIN tpabrik c ON c.pab_kode = h.poi_cab
     LEFT JOIN tpabrik u ON u.pab_kode = h.poi_sup
     LEFT JOIN tbahan b ON b.bhn_kode = d.poid_bhn_kode
     LEFT JOIN tgarmen_brg g ON g.brg_kode = d.poid_bhn_kode AND g.brg_jenis = 'ACCESORIES'
     LEFT JOIN tuser tu ON tu.user_kode = h.user_create
     WHERE h.poi_nomor = ?`,
    [nomor],
  );
  if (rows.length === 0) throw new Error("Data cetak tidak ditemukan.");

  const header = {
    Nomor: rows[0].poi_nomor,
    Tanggal: rows[0].poi_tanggal,
    Dateline: rows[0].poi_dateline,
    UserCreate: rows[0].user_create,
    NomorSPK: rows[0].poi_spk_nomor,
    MapNomor: rows[0].map_nomor || "",
    Divisi: rows[0].divisi || "",
    Invdc: rows[0].invdc || "",
    NamaSpk: rows[0].namaspk,
    Bahan: rows[0].bahan,
    Ukuran: rows[0].ukuran,
    JumlahSpk: rows[0].jumlah,
    JasaKode: rows[0].poi_jasa_kode,
    JasaNama: rows[0].jasa_nama,
    SpkCab: rows[0].SpkCab || "",
    UserBagian: rows[0].UserBagian || "",
    GdgKode: rows[0].poi_cab,
    GdgNama: rows[0].namacab,
    SupKode: rows[0].poi_sup,
    SupNama: rows[0].namasup,
    Keterangan: rows[0].poi_ket,
    Foto: checkGambarSpk(rows[0].poi_spk_nomor) ? "YA" : "NO",
  };

  const detail = rows
    .filter((r) => r.poid_bhn_kode)
    .map((r) => ({
      Kode: r.poid_bhn_kode,
      Nama: r.bhn_name,
      Satuan: r.bhn_satuan,
      Size: r.poid_size,
      Jumlah: r.poid_jumlah,
    }));

  return { header, detail };
};

module.exports = {
  getDefaultGudang,
  checkPabrik,
  checkSpk,
  checkJasa,
  loadBahan,
  loadAccesories,
  getDetailForm,
  saveData,
  getPrintData,
};
