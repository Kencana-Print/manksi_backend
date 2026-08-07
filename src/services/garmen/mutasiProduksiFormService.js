const db = require("../../config/database");
const tutupBukuService = require("../tutupBukuService");

// ─────────────────────────────────────────────────────────
// GENERATE NOMOR
// Format: MP/NNNNN/YYYY
// max(mid(mph_nomor,4,5)) per tahun
// ─────────────────────────────────────────────────────────
const generateNomor = async (tanggal) => {
  const tahun = new Date(tanggal).getFullYear();
  const [[row]] = await db.query(
    `SELECT IFNULL(MAX(CAST(MID(mph_nomor, 4, 5) AS UNSIGNED)), 0) AS max_val
     FROM tmutasiproduksi_hdr
     WHERE RIGHT(mph_nomor, 4) = ?`,
    [String(tahun)],
  );
  const next = parseInt(row.max_val, 10) + 1;
  return `MP/${String(next).padStart(5, "0")}/${tahun}`;
};

// ─────────────────────────────────────────────────────────
// MAPPING PILIHAN MUTASI → GUDANG ASAL & TUJUAN
// Sesuai Delphi RadioButton1Click
// ─────────────────────────────────────────────────────────
const GUDANG_MAP = {
  P04: {
    1: { asal: "GP001", tujuan: "GP012" }, // Potong ke QC Ptg
    2: { asal: "GP012", tujuan: "GP002" }, // QC Ptg ke Cetak
    3: { asal: "GP002", tujuan: "GP010" }, // Cetak ke QC Cetak
    4: { asal: "GP032", tujuan: "GP003" }, // DC ke Jahit
    5: { asal: "GP003", tujuan: "GP004" }, // Jahit ke Lipat
    6: { asal: "GP004", tujuan: "GP013" }, // Lipat ke Koli
    7: { asal: "GP012", tujuan: "GP032" }, // QC Potong ke DC
    8: { asal: "GP010", tujuan: "GP032" }, // QC Cetak ke DC
  },
  P01: {
    1: { asal: "GP015", tujuan: "GP021" }, // Potong ke QC Ptg
    2: { asal: "GP021", tujuan: "GP017" }, // QC Ptg ke Cetak
    3: { asal: "GP017", tujuan: "GP022" }, // Cetak ke QC Cetak
    4: { asal: "GP022", tujuan: "GP018" }, // QC Cetak ke Jahit ← P01 tidak pakai DC
    5: { asal: "GP018", tujuan: "GP019" }, // Jahit ke Lipat
    6: { asal: "GP019", tujuan: "GP020" }, // Lipat ke Koli
  },
};

const getGudangByMutasi = (cab, jenisMutasi) => {
  const cabKey = cab === "P01" ? "P01" : "P04";
  return GUDANG_MAP[cabKey]?.[String(jenisMutasi)] || null;
};

// ─────────────────────────────────────────────────────────
// GET SPK INFO (setelah input Nomor SPK)
// UNION tspk + tmemospk, cek pending, cmo
// ─────────────────────────────────────────────────────────
const getSpkInfo = async (nomorSpk) => {
  // SPG (Surat Perintah Gudang)
  if (nomorSpk.startsWith("SPG")) {
    const [rows] = await db.query(
      `SELECT DISTINCT i.spgi_spk AS spk_nomor, j.spg_tanggal AS spk_tanggal,
              i.spgi_nama AS spk_nama, i.spgi_kodek AS spk_kodek,
              '3' AS spk_divisi, '' AS spk_finishing,
              'N' AS xcetak, 'N' AS xbordir,
              0 AS spk_jumlah, '' AS spk_pending, '' AS spk_accpending, '' AS spk_cmo,
              NULL AS jo_nama
       FROM tspk_gudangitem i
       LEFT JOIN tspk_gudang j ON j.spg_nomor = i.spgi_nomor
       WHERE i.spgi_spk = ?`,
      [nomorSpk],
    );
    return rows[0] || null;
  }

  // SPK / MAP biasa
  const [rows] = await db.query(
    `SELECT spk_nomor, spk_nama, jo_nama, spk_jumlah, spk_divisi,
            spk_finishing, spk_pending, spk_accpending, spk_cmo,
            spk_tanggal AS spk_tanggal,
            IF(spk_sablon='Y' OR spk_sublim='Y', 'Y', 'N') AS xcetak,
            spk_bordir AS xbordir,
            '' AS spk_kodek
     FROM tspk
     LEFT JOIN tjenisorder ON spk_jo_kode = jo_kode
     WHERE spk_aktif = 'Y' AND spk_nomor = ?
     UNION ALL
     SELECT mspk_nomor, mspk_nama, jo_nama, mspk_jumlah, mspk_divisi,
            mspk_finishing, '' AS spk_pending, '' AS spk_accpending,
            mspk_cmo AS spk_cmo, mspk_tanggal AS spk_tanggal,
            '-' AS xcetak, '-' AS xbordir, '' AS spk_kodek
     FROM tmemospk
     LEFT JOIN tjenisorder ON mspk_jo_kode = jo_kode
     WHERE mspk_nomor = ?
     LIMIT 1`,
    [nomorSpk, nomorSpk],
  );
  return rows[0] || null;
};

// ─────────────────────────────────────────────────────────
// GET KOMPONEN LIST (dari tspk_babaran)
// Dipakai untuk dropdown Komponen di header
// ─────────────────────────────────────────────────────────
const getKomponenList = async (nomorSpk) => {
  const [rows] = await db.query(
    `SELECT spkb_komponen AS komponen, spkb_babaran AS babaran
     FROM tspk_babaran
     WHERE spkb_nomor = ?
     ORDER BY spkb_komponen`,
    [nomorSpk],
  );
  if (rows.length > 0) return rows;

  // Fallback ke tkomponen (SPK lama)
  const [fallback] = await db.query(
    `SELECT komponen, 0 AS babaran FROM tkomponen ORDER BY komponen`,
  );
  return fallback;
};

// ─────────────────────────────────────────────────────────
// GET BABARAN STANDAR per SPK + Komponen
// ─────────────────────────────────────────────────────────
const getBabaranStd = async (nomorSpk, komponen) => {
  const [[row]] = await db.query(
    `SELECT IFNULL(spkb_babaran, 0) AS babaran
     FROM tspk_babaran
     WHERE spkb_nomor = ? AND spkb_komponen = ?
     LIMIT 1`,
    [nomorSpk, komponen],
  );
  return Number(row?.babaran) || 0;
};

// ─────────────────────────────────────────────────────────
// GET MKB (Gramasi & Setting dari MKB per SPK + Komponen)
// Sesuai Delphi getMkb
// ─────────────────────────────────────────────────────────
const getMkbInfo = async (nomorSpk, komponen) => {
  const [rows] = await db.query(
    `SELECT b.bhn_GRAMASI AS gramasi, b.bhn_setting AS setting
     FROM tmkb_hdr h
     INNER JOIN tmkb_dtl d ON d.mkbd_mkb_nomor = h.MKB_NOMOR
     LEFT JOIN tbahan b ON b.Bhn_kode = d.mkbd_bhn_kode
     WHERE h.MKB_SPK_NOMOR = ? AND d.mkbd_komponen = ?
     LIMIT 1`,
    [nomorSpk, komponen],
  );
  return rows[0] || { gramasi: "", setting: "" };
};

// ─────────────────────────────────────────────────────────
// GET NO MATERIAL (lookup dari tproduksiminta)
// Sesuai Delphi F1 pada edtNoMaterial
// ─────────────────────────────────────────────────────────
const searchNoMaterial = async (
  nomorSpk,
  q = "",
  excludeNomor = "",
  page = 1,
  limit = 30,
) => {
  const offset = (page - 1) * limit;
  const [rows] = await db.query(
    `SELECT h.promin_nomor AS Nomor,
            DATE_FORMAT(h.promin_tanggal, '%d-%m-%Y') AS Tanggal,
            d.promind_bhn_kode AS Kode,
            b.Bhn_Name AS JenisKain,
            b.Bhn_satuan AS Satuan,
            d.promind_Jumlah - IFNULL((
              SELECT SUM(r.proretd_Jumlah)
              FROM tproduksiretur_dtl r
              WHERE r.proretd_nominta = h.promin_nomor
                AND r.proretd_bhn_kode = d.promind_bhn_kode
            ), 0) AS Jumlah,
            d.promind_sup_kode AS Kodesup,
            s.sup_nama AS NamaSupplier,
            g.gdgp_cab AS Cab,
            (
              IFNULL((
                SELECT SUM(mph_qty_berat)
                FROM tmutasiproduksi_hdr
                WHERE mph_nomaterial = h.promin_nomor
                  AND mph_bhn_kode = d.promind_bhn_kode
                  AND mph_nomor <> ?
              ), 0)
              +
              IFNULL((
                SELECT SUM(bpj_qty_berat)
                FROM tbpj_hdr
                WHERE bpj_nomaterial = h.promin_nomor
                  AND bpj_bhn_kode = d.promind_bhn_kode
              ), 0)
            ) AS Terpakai
     FROM tproduksiminta_hdr h
     INNER JOIN tproduksiminta_dtl d ON d.promind_promin_Nomor = h.promin_nomor
     LEFT JOIN tbahan b ON b.Bhn_kode = d.promind_bhn_kode
     LEFT JOIN tsupplier s ON s.sup_kode = d.promind_sup_kode
     LEFT JOIN tgudangproduksi g ON g.gdgp_kode = h.promin_gdgp_kode
     WHERE h.promin_spk_nomor = ?
       AND (b.Bhn_Name LIKE ? OR g.gdgp_cab LIKE ?)
     ORDER BY h.promin_nomor DESC
     LIMIT ? OFFSET ?`,
    [excludeNomor || "", nomorSpk, `%${q}%`, `%${q}%`, limit, offset],
  );
  // Sisa = Jumlah (setelah dikurangi retur) - Total pemakaian di mutasi lain
  return rows.map((r) => ({
    ...r,
    Sisa: Number(r.Jumlah) - Number(r.Terpakai),
  }));
};

// ─────────────────────────────────────────────────────────
// GET DETAIL NO MATERIAL (setelah pilih nomor material)
// Sesuai Delphi edtNoMaterialExit
// ─────────────────────────────────────────────────────────
const getNoMaterialDetail = async (noMaterial, kodeBahn, excludeNomor = "") => {
  const [dtlRows] = await db.query(
    `SELECT d.*, b.bhn_GRAMASI AS gramasi, b.bhn_setting AS sett,
            b.Bhn_Name AS namakain, b.Bhn_satuan AS satkain,
            s.sup_kode, s.sup_nama AS namasupplier
     FROM tproduksiminta_dtl d
     LEFT JOIN tbahan b ON b.Bhn_kode = d.promind_bhn_kode
     LEFT JOIN tsupplier s ON s.sup_kode = d.promind_sup_kode
     WHERE d.promind_promin_Nomor = ? AND d.promind_bhn_kode = ?
     LIMIT 1`,
    [noMaterial, kodeBahn],
  );

  // Hitung LHK (sudah terpakai dari MP + BPJ)
  const [[lhkRow]] = await db.query(
    `SELECT SUM(jml) AS sudah FROM (
       SELECT IFNULL(SUM(mph_qty_berat), 0) AS jml
       FROM tmutasiproduksi_hdr
       WHERE mph_nomor <> ? AND mph_nomaterial = ? AND mph_bhn_kode = ?
       UNION ALL
       SELECT IFNULL(SUM(h.bpj_qty_berat), 0) AS jml
       FROM tbpj_hdr h
       WHERE h.bpj_nomaterial = ? AND h.bpj_bhn_kode = ?
     ) x`,
    [excludeNomor, noMaterial, kodeBahn, noMaterial, kodeBahn],
  );

  return {
    detail: dtlRows[0] || null,
    lhk: Number(lhkRow?.sudah) || 0,
  };
};

// ─────────────────────────────────────────────────────────
// GET SUDAH (sesuai Delphi getsudah)
// SUM jumlah per gudang + SPK + bahan, exclude nomor sendiri
// ─────────────────────────────────────────────────────────
const getSudah = async (gudangAsal, nomorSpk, kodeBahan, excludeNomor = "") => {
  const [[row]] = await db.query(
    `SELECT IFNULL(SUM(d.mpd_jumlah), 0) AS sudah
     FROM tmutasiproduksi_dtl d
     INNER JOIN tmutasiproduksi_hdr h ON h.mph_nomor = d.mpd_mph_nomor
     WHERE h.mph_spk_nomor LIKE ?
       AND d.mpd_bhn_kode = ?
       AND h.mph_gdgasal = ?
       AND d.mpd_mph_nomor <> ?`,
    [nomorSpk, kodeBahan, gudangAsal, excludeNomor],
  );
  return Number(row.sudah) || 0;
};

// ─────────────────────────────────────────────────────────
// GET SUDAH SIZE (sesuai Delphi getsudahsize)
// ─────────────────────────────────────────────────────────
const getSudahSize = async (
  gudangAsal,
  nomorSpk,
  kodeBahan,
  size,
  excludeNomor = "",
) => {
  const [[row]] = await db.query(
    `SELECT IFNULL(SUM(d.mpd_jumlah), 0) AS sudah
     FROM tmutasiproduksi_dtl d
     INNER JOIN tmutasiproduksi_hdr h ON h.mph_nomor = d.mpd_mph_nomor
     WHERE h.mph_spk_nomor LIKE ?
       AND d.mpd_bhn_kode = ?
       AND d.mpd_size = ?
       AND h.mph_gdgasal = ?
       AND d.mpd_mph_nomor <> ?`,
    [nomorSpk, kodeBahan, size, gudangAsal, excludeNomor],
  );
  return Number(row.sudah) || 0;
};

// ─────────────────────────────────────────────────────────
// GET PLANNING PPIC (isiplan — per jenis lini)
// Sesuai Delphi isiplan + format baru (plan_qty_jadwal)
// ─────────────────────────────────────────────────────────
const LINI_TO_DIVISI = {
  1: "CUTTING", // Potong ke QC Ptg
  2: "CUTTING", // QC Ptg ke Cetak (masih pakai cutting)
  3: "SEWING", // Cetak ke QC Cetak → pakai sewing? lihat konteks
  4: "SEWING", // DC ke Jahit / QC Cetak ke Jahit
  5: "KOLI", // Jahit ke Lipat
  6: "KOLI", // Lipat ke Koli
};

// ─────────────────────────────────────────────────────────
// GET PLANNING PER SPK (sumber ke-2, selain Planning SPK PPIC)
// Baca dari tplanningspk (menu Garmen > Planning per SPK).
// Kolom granular (cutting/cetak/sublim/bordir/jahit/finishing/kirim)
// dipetakan ke jenisMutasi/kelompok yang setara dengan divisiMap PPIC.
// ⚠️ Tidak ada kolom setara utk kelompok "DTF" di tplanningspk — DTF
// tetap hanya divalidasi dari sumber PPIC.
// ─────────────────────────────────────────────────────────
const JENIS_TO_KOLOM_PLANSPK = {
  1: "cutting",
  5: "jahit",
  6: "finishing", // Lipat ke Koli → planning "finishing" per SPK
};
const getPlanningPerSpk = async (
  nomorSpk,
  jenisMutasi,
  kelompok = "",
  tglDibuat = "",
) => {
  let kolom = JENIS_TO_KOLOM_PLANSPK[Number(jenisMutasi)];
  if (kelompok === "BORDIR") kolom = "bordir";
  if (!kolom) return [];
  const params = [nomorSpk];
  let tglFilter = "";
  // Sama seperti PPIC: filter cutting dgn tanggal SPK dibuat, cegah
  // planning yg target-nya lebih awal dari SPK-nya eksis.
  if (kolom === "cutting" && tglDibuat) {
    tglFilter = `AND plan_tanggal >= ?`;
    params.push(tglDibuat);
  }
  const [rows] = await db.query(
    `SELECT plan_tanggal AS tanggal, plan_${kolom} AS jumlah
     FROM tplanningspk
     WHERE plan_spk = ? AND plan_${kolom} <> 0 ${tglFilter}
     ORDER BY plan_tanggal`,
    params,
  );
  return rows.map((r) => ({
    no_planning: "", // tidak ada nomor header di tplanningspk
    tanggal: r.tanggal
      ? new Date(r.tanggal).toISOString().substring(0, 10)
      : "",
    jumlah: Number(r.jumlah) || 0,
    status: "PLANNING SPK", // penanda sumber, biar frontend bisa bedakan
    line_kelompok: null,
  }));
};

const getPlanningPpic = async (
  nomorSpk,
  jenisMutasi,
  kelompok = "",
  tglDibuat = "",
) => {
  const divisiMap = {
    1: "CUTTING",
    2: "",
    3: "",
    4: "",
    5: "SEWING",
    6: "KOLI",
  };
  let divisi = divisiMap[String(jenisMutasi)];
  if (kelompok === "BORDIR") divisi = "BORDIR";
  if (kelompok === "PRES DTF" || kelompok === "DTF") divisi = "DTF";

  let ppicRows = [];
  if (divisi) {
    const params = [nomorSpk, divisi];
    let kelompokFilter = "";
    if (divisi === "SEWING" && kelompok && kelompok.startsWith("LINE")) {
      kelompokFilter = `AND d.plan_line_kelompok = ?`;
      params.push(kelompok);
    }
    let tglFilter = "";
    if (divisi === "CUTTING" && tglDibuat) {
      tglFilter = `AND d.plan_tgl_jadwal >= ?`;
      params.push(tglDibuat);
    }
    const [rows] = await db.query(
      `SELECT
         d.plan_pl_nomor                             AS no_planning,
         DATE_FORMAT(d.plan_tgl_jadwal, '%Y-%m-%d')  AS tanggal,
         d.plan_qty_jadwal                           AS jumlah,
         'PLANNING PPIC'                             AS status,
         d.plan_line_kelompok                        AS line_kelompok
       FROM tplan_ppic_dtl2 d
       INNER JOIN tplan_ppic_hdr h ON h.pl_nomor = d.plan_pl_nomor
       WHERE h.pl_close = 'N'
         AND d.plan_spk = ?
         AND d.plan_divisi = ?
         AND d.plan_qty_jadwal <> 0
         ${kelompokFilter}
         ${tglFilter}
       ORDER BY d.plan_tgl_jadwal`,
      params,
    );
    ppicRows = rows;
  }

  // ← TAMBAHAN: union dengan Planning per SPK (tplanningspk)
  const perSpkRows = await getPlanningPerSpk(
    nomorSpk,
    jenisMutasi,
    kelompok,
    tglDibuat,
  );

  return [...ppicRows, ...perSpkRows].sort((a, b) =>
    (a.tanggal || "").localeCompare(b.tanggal || ""),
  );
};

// ─────────────────────────────────────────────────────────
// GET KELOMPOK LIST (untuk dropdown Kelompok per lini)
// Sesuai Delphi edtNamaGudangProdasalChange
// ─────────────────────────────────────────────────────────
const getKelompokList = async (namaGudang, cab) => {
  const liniMap = [
    { key: "QC POTONG", lini: "QC POTONG" },
    { key: "QC CETAK", lini: "QC CETAK" },
    { key: "POTONG", lini: "POTONG" },
    { key: "CETAK", lini: "CETAK" },
    { key: "JAHIT", lini: "JAHIT" },
    { key: "LIPAT", lini: "LIPAT" },
    { key: "BORDIR", lini: "BORDIR" },
    { key: "PRES DTF", lini: "PRES DTF" },
  ];

  let lini = "";
  for (const m of liniMap) {
    if (namaGudang.toUpperCase().includes(m.key)) {
      lini = m.lini;
      break;
    }
  }

  const query = lini
    ? `SELECT Kelompok FROM tkelompok WHERE lini = ? AND cab = ? ORDER BY Kelompok`
    : `SELECT Kelompok FROM tkelompok ORDER BY Kelompok`;

  const params = lini ? [lini, cab] : [];
  const [rows] = await db.query(query, params);
  return rows.map((r) => r.Kelompok);
};

// ─────────────────────────────────────────────────────────
// GET KELOMPOK TUJUAN (untuk GP003 = JAHIT P4)
// Sesuai Delphi edtNamaGudangProdtujuanChange
// ─────────────────────────────────────────────────────────
const getKelompokTujuanList = async (gdgTujuan, cab) => {
  if (gdgTujuan !== "GP003") return [];
  const [rows] = await db.query(
    `SELECT Kelompok FROM tkelompok WHERE lini = 'JAHIT' AND cab = ? ORDER BY Kelompok`,
    [cab],
  );
  return rows.map((r) => r.Kelompok);
};

// ─────────────────────────────────────────────────────────
// SEARCH KODE BAHAN (F1 di grid)
// Sesuai Delphi cxGrdMasterEditKeyDown
// Bordir (GP014/GP016): filter bhn_bordir=1
// ─────────────────────────────────────────────────────────
const searchBahan = async (q = "", gdgAsal = "", page = 1, limit = 30) => {
  const offset = (page - 1) * limit;
  const isBordir = gdgAsal === "GP014" || gdgAsal === "GP016";
  let query = `SELECT bhn_kode AS Kode, bhn_name AS Nama, bhn_satuan AS Satuan
               FROM tbahan
               WHERE bhn_jb_kode = 'LL' AND bhn_aktif = 0`;
  if (isBordir) query += ` AND bhn_bordir = 1`;
  query += ` AND (bhn_kode LIKE ? OR bhn_name LIKE ?) ORDER BY bhn_name LIMIT ? OFFSET ?`;
  const [rows] = await db.query(query, [`%${q}%`, `%${q}%`, limit, offset]);
  return rows;
};

// ─────────────────────────────────────────────────────────
// LOAD KODE BAHAN KE DETAIL GRID (sesuai Delphi loadkode)
// Auto-expand per size jika SPK punya tspk_size
// Sesuai Delphi: 3 cabang utama (SPG, tspk_size ada, tspk_size kosong)
// ─────────────────────────────────────────────────────────
const loadKodeBahan = async (
  kodeBahan,
  nomorSpk,
  gdgAsal,
  excludeNomor = "",
  spkKodek = "",
) => {
  // Ambil info bahan
  const [[bahan]] = await db.query(
    `SELECT bhn_kode AS Kode, bhn_name AS Nama, bhn_satuan AS Satuan
     FROM tbahan WHERE bhn_kode = ? LIMIT 1`,
    [kodeBahan],
  );
  if (!bahan) return { error: "Kode tidak ditemukan." };

  const isSpg = nomorSpk.startsWith("SPG");

  if (isSpg) {
    if (gdgAsal === "GP001" || gdgAsal === "GP015") {
      // Cabang 1: SPG Potong → single row tanpa size
      const sudah = await getSudah(gdgAsal, nomorSpk, kodeBahan, excludeNomor);
      return {
        rows: [
          {
            kode: bahan.Kode,
            nama: bahan.Nama,
            satuan: bahan.Satuan,
            size: "",
            qtyorder: 0,
            sudah,
            kurang: 0,
            bslini: 0,
            bskainsablon: 0,
            bskain: 0,
            gantibs: 0,
            panjang: 0,
            lebar: 0,
          },
        ],
      };
    } else {
      // Cabang 2: SPG non-potong → expand dari retail.tbarangdc_dtl
      // kodek diambil dari spgi_kodek yang dikirim sebagai parameter tambahan
      const [dcRows] = await db.query(
        `SELECT brgd_ukuran AS size
       FROM retail.tbarangdc_dtl
       WHERE brgd_kode = ?`,
        [spkKodek], // ← perlu parameter tambahan
      );
      if (!dcRows.length) {
        return { error: "Divisi cutting belum input LHK atas SPK Gudang tsb." };
      }
      const rows = [];
      for (const dc of dcRows) {
        const sudah = await getSudahSize(
          gdgAsal,
          nomorSpk,
          bahan.Kode,
          dc.size,
          excludeNomor,
        );
        rows.push({
          kode: bahan.Kode,
          nama: bahan.Nama,
          satuan: bahan.Satuan,
          size: dc.size,
          qtyorder: 0,
          sudah,
          kurang: 0,
          bslini: 0,
          bskainsablon: 0,
          bskain: 0,
          gantibs: 0,
          panjang: 0,
          lebar: 0,
        });
      }
      return { rows };
    }
  }

  // Cek tspk_size
  const [sizes] = await db.query(
    `SELECT spks_size, spks_qty FROM tspk_size WHERE spks_nomor = ?`,
    [nomorSpk],
  );

  if (sizes.length > 0) {
    // Ada size → expand per size
    const rows = [];
    for (const sz of sizes) {
      const sudah = await getSudahSize(
        gdgAsal,
        nomorSpk,
        kodeBahan,
        sz.spks_size,
        excludeNomor,
      );
      rows.push({
        kode: bahan.Kode,
        nama: bahan.Nama,
        satuan: bahan.Satuan,
        size: sz.spks_size,
        qtyorder: Number(sz.spks_qty) || 0,
        sudah,
        kurang: (Number(sz.spks_qty) || 0) - sudah,
        bslini: 0,
        bskainsablon: 0,
        bskain: 0,
        gantibs: 0,
        panjang: 0,
        lebar: 0,
      });
    }
    return { rows };
  } else {
    // SPK lama — single row
    const sudah = await getSudah(gdgAsal, nomorSpk, kodeBahan, excludeNomor);
    return {
      rows: [
        {
          kode: bahan.Kode,
          nama: bahan.Nama,
          satuan: bahan.Satuan,
          size: "",
          qtyorder: 0,
          sudah,
          kurang: 0,
          bslini: 0,
          bskainsablon: 0,
          bskain: 0,
          gantibs: 0,
          panjang: 0,
          lebar: 0,
        },
      ],
    };
  }
};

// ─────────────────────────────────────────────────────────
// LOAD KOMPONEN MAP (sesuai Delphi loadkomponenmap)
// Load bahan dari tkesesuaianmap_komponen per komponen+SPK memo
// ─────────────────────────────────────────────────────────
const loadKomponenMap = async (
  nomorSpk,
  komponen,
  jumlahSpk,
  excludeNomor = "",
  gdgAsal = "GP001",
) => {
  // Ambil spk_memo dari tspk
  const [[spkRow]] = await db.query(
    `SELECT IFNULL(spk_memo, '') AS spk_memo FROM tspk WHERE spk_nomor = ? LIMIT 1`,
    [nomorSpk],
  );
  const memo = spkRow?.spk_memo || nomorSpk;

  // Strip prefix komponen (sebelum spasi)
  const komponenKey = komponen.includes(" ")
    ? komponen.substring(0, komponen.indexOf(" "))
    : komponen;

  const [rows] = await db.query(
    `SELECT k.kode, b.Bhn_Name AS nama, b.Bhn_satuan AS satuan
     FROM tkesesuaianmap_komponen k
     LEFT JOIN tbahan b ON b.Bhn_kode = k.kode
     WHERE k.komponen = ? AND k.nomor = ?
     ORDER BY k.no_urut`,
    [komponenKey, memo],
  );

  if (rows.length === 0) return null;

  const result = [];
  for (const r of rows) {
    const sudah = await getSudah(gdgAsal, nomorSpk, r.kode, excludeNomor);
    result.push({
      kode: r.kode,
      nama: r.nama,
      satuan: r.satuan,
      size: "",
      qtyorder: 0,
      sudah,
      kurang: Number(jumlahSpk) - sudah,
      bslini: 0,
      bskainsablon: 0,
      bskain: 0,
      gantibs: 0,
      panjang: 0,
      lebar: 0,
    });
  }
  return result;
};

// ─────────────────────────────────────────────────────────
// GET KOMPONEN PROOF (untuk DC GP032)
// Sesuai Delphi getkomponen
// ─────────────────────────────────────────────────────────
const getKomponenProof = async (nomorSpk) => {
  const [rows] = await db.query(
    `SELECT x.pfd_kode AS kode, b.Bhn_Name AS nama, b.Bhn_satuan AS satuan,
            z.spks_size AS size, z.spks_qty AS qtyorder
     FROM (
       SELECT DISTINCT d.pfd_kode
       FROM tproofgarmen_hdr h
       LEFT JOIN tproofgarmen_dtl d ON d.pfd_nomor = h.pf_nomor
       WHERE h.pf_lini <> 'BORDIR'
         AND h.pf_spk_nomor = (
           SELECT IF(k.spk_memo <> '', k.spk_memo, k.spk_nomor)
           FROM tspk k WHERE k.spk_nomor = ?
         )
     ) x
     LEFT JOIN tbahan b ON b.Bhn_kode = x.pfd_kode
     LEFT JOIN tspk_size z ON z.spks_nomor = ?
     LEFT JOIN retail.tukuran u ON u.kategori = '' AND u.ukuran = z.spks_size
     ORDER BY b.Bhn_Name, u.kode`,
    [nomorSpk, nomorSpk],
  );
  return rows;
};

// ─────────────────────────────────────────────────────────
// GET TERIMA DC (sesuai Delphi getterima — untuk GP032)
// ─────────────────────────────────────────────────────────
const getTerimaGp032 = async (nomorSpk) => {
  const [rows] = await db.query(
    `SELECT d.mpd_bhn_kode AS kode, d.mpd_size AS size, SUM(d.mpd_jumlah) AS qty
     FROM tmutasiproduksi_hdr h
     INNER JOIN tmutasiproduksi_dtl d ON d.mpd_mph_nomor = h.mph_nomor
     WHERE h.mph_spk_nomor = ? AND h.mph_gdgtujuan = 'GP032'
     GROUP BY d.mpd_bhn_kode, d.mpd_size`,
    [nomorSpk],
  );
  return rows;
};

// ─────────────────────────────────────────────────────────
// GET SUDAH DC (sesuai Delphi getsudahdc)
// ─────────────────────────────────────────────────────────
const getSudahGp032 = async (nomorSpk) => {
  const [rows] = await db.query(
    `SELECT d.mpd_bhn_kode AS kode, d.mpd_size AS size, SUM(d.mpd_jumlah) AS qty
     FROM tmutasiproduksi_hdr h
     INNER JOIN tmutasiproduksi_dtl d ON d.mpd_mph_nomor = h.mph_nomor
     WHERE h.mph_spk_nomor = ? AND h.mph_gdgasal = 'GP032'
     GROUP BY d.mpd_bhn_kode, d.mpd_size`,
    [nomorSpk],
  );
  return rows;
};

// ─────────────────────────────────────────────────────────
// CEK KOMPONEN IDENTIFIKASI (sesuai Delphi cekkomponen)
// FIX: sebelumnya cek tabel lama tspk_komponen_cetak/tspk_komponen_bordir
// yang sudah tidak pernah ditulis lagi sejak alur SPK PPIC baru.
// Sekarang: POTONG tetap dari tspk_komponen_potong (masih dipakai),
// CETAK & BORDIR dari tspk_komponen_cetak_bordir yang dibedakan
// lewat kolom kcb_proses ('SABLON' untuk lini Cetak, 'BORDIR' untuk Bordir).
// ─────────────────────────────────────────────────────────
const cekKomponen = async (nomorSpk, lini) => {
  const liniUpper = lini.toUpperCase();

  if (liniUpper === "POTONG") {
    const [[row]] = await db.query(
      `SELECT COUNT(sk_nomor) AS jml FROM tspk_komponen_potong WHERE sk_nomor = ?`,
      [nomorSpk],
    );
    return Number(row.jml) > 0;
  }

  if (liniUpper === "CETAK" || liniUpper === "BORDIR") {
    const kcbProses = liniUpper === "CETAK" ? "SABLON" : "BORDIR";
    const [[row]] = await db.query(
      `SELECT COUNT(*) AS jml FROM tspk_komponen_cetak_bordir
       WHERE kcb_nomor = ? AND kcb_proses = ?`,
      [nomorSpk, kcbProses],
    );
    return Number(row.jml) > 0;
  }

  return true; // Lini tidak dikenal → lewati
};

// ⚠️ FIX: sebelumnya cuma baca tplan_ppic_dtl2 (Planning SPK PPIC).
// Sekarang union dengan tplanningspk (Planning per SPK, menu Garmen)
// utk divisi CUTTING & KOLI — 2 divisi yg punya kolom setara jelas
// (plan_cutting, plan_finishing). Ini fungsi BLOCKING yg dipanggil dari
// cekGudangAsal (POST /cek-gudang-asal) saat pilih Jenis Mutasi/Lini
// Asal — sumber pesan error di screenshot.
const DIVISI_TO_KOLOM_PLANSPK = {
  CUTTING: "cutting",
  KOLI: "finishing",
  CETAK: "cetak", // ← tambahan
  JAHIT: "jahit", // ← tambahan
  BORDIR: "bordir", // ← tambahan (konsisten, sebelumnya tidak ada sama sekali)
};

// ─────────────────────────────────────────────────────────
// CEK PLANNING SUDAH ADA (isplanning_*)
// Sesuai Delphi — cek per jenis lini di tplan_ppic_dtl2
// ─────────────────────────────────────────────────────────
const cekPlanning = async (nomorSpk, ppicDivisi, planSpkKolom = null) => {
  const [[row]] = await db.query(
    `SELECT COUNT(*) AS jml
     FROM tplan_ppic_dtl2 d
     INNER JOIN tplan_ppic_hdr h ON h.pl_nomor = d.plan_pl_nomor
     WHERE h.pl_close = 'N' AND d.plan_spk = ? AND d.plan_divisi = ?
       AND d.plan_qty_jadwal <> 0`,
    [nomorSpk, ppicDivisi],
  );
  if (Number(row.jml) > 0) return true;

  // Gunakan token spesifik kalau dikirim controller (CETAK/JAHIT/BORDIR),
  // fallback ke ppicDivisi kalau tidak (kompatibel dgn pemanggilan lama)
  const kolom = DIVISI_TO_KOLOM_PLANSPK[planSpkKolom || ppicDivisi];
  if (!kolom) return false;

  const [[row2]] = await db.query(
    `SELECT COUNT(*) AS jml FROM tplanningspk WHERE plan_spk = ? AND plan_${kolom} <> 0`,
    [nomorSpk],
  );
  return Number(row2.jml) > 0;
};

// ─────────────────────────────────────────────────────────
// CEK LHK SUDAH ADA (islhk_*)
// Sesuai Delphi — cek dari tmutasiproduksi_hdr per gdgasal
// ─────────────────────────────────────────────────────────
const cekLhk = async (nomorSpk, gdgAsal) => {
  const [[row]] = await db.query(
    `SELECT
       (
         SELECT COUNT(*) FROM tmutasiproduksi_hdr
         WHERE mph_spk_nomor = ? AND mph_gdgasal = ?
       )
       +
       (
         SELECT COUNT(*) FROM tbpj_dtl
         WHERE bpjd_spk = ? AND bpjd_gdgp_asal = ?
       ) AS jml`,
    [nomorSpk, gdgAsal, nomorSpk, gdgAsal],
  );
  return Number(row.jml) > 0;
};

// ─────────────────────────────────────────────────────────
// CEK PENDING SPK PER LINI
// Sesuai Delphi edtGdgProduksiasalExit — cek spk_pending='PENDING SEBAGIAN'
// ─────────────────────────────────────────────────────────
const cekPendingSpk = async (nomorSpk, gdgAsal) => {
  const [[row]] = await db.query(
    `SELECT spk_ppotong, spk_pcetak, spk_pbordir, spk_pjahit, spk_pfinishing
     FROM tspk
     WHERE spk_pending = 'PENDING SEBAGIAN'
       AND spk_accpending = 'N'
       AND spk_cmo <> ''
       AND spk_aktif = 'Y'
       AND spk_nomor = ?
     LIMIT 1`,
    [nomorSpk],
  );
  if (!row) return null;

  const pendingMap = {
    GP001: {
      field: "spk_ppotong",
      msg: "Spk tsb di pending dibagian Cutting.",
    },
    GP015: {
      field: "spk_ppotong",
      msg: "Spk tsb di pending dibagian Cutting.",
    },
    GP002: { field: "spk_pcetak", msg: "Spk tsb di pending dibagian Cetak." },
    GP017: { field: "spk_pcetak", msg: "Spk tsb di pending dibagian Cetak." },
    GP014: { field: "spk_pbordir", msg: "Spk tsb di pending dibagian Bordir." },
    GP016: { field: "spk_pbordir", msg: "Spk tsb di pending dibagian Bordir." },
    GP003: { field: "spk_pjahit", msg: "Spk tsb di pending dibagian Jahit." },
    GP018: { field: "spk_pjahit", msg: "Spk tsb di pending dibagian Jahit." },
    GP004: {
      field: "spk_pfinishing",
      msg: "Spk tsb di pending dibagian Finishing.",
    },
    GP019: {
      field: "spk_pfinishing",
      msg: "Spk tsb di pending dibagian Finishing.",
    },
  };

  const info = pendingMap[gdgAsal];
  if (info && row[info.field] === "Y") {
    return (
      info.msg + "\nHubungi marketing jika akan tetap melanjutkan transaksi."
    );
  }
  return null;
};

// ─────────────────────────────────────────────────────────
// PREFIX SPK YANG SKIP VALIDASI PLANNING & LHK
// Sesuai Delphi: pos(MidStr(spk,4,2),'BR-SB-SD-PL-KS-DP-TG-PM-LL') = 0
// ─────────────────────────────────────────────────────────
const isSkipPlanningValidation = (nomorSpk) => {
  if (nomorSpk.startsWith("MAP")) return true;
  const prefix = nomorSpk.substring(3, 5); // karakter 4-5 (index 3-4)
  return ["BR", "SB", "SD", "PL", "KS", "DP", "TG", "PM", "LL"].includes(
    prefix,
  );
};

// ─────────────────────────────────────────────────────────
// GET BY NOMOR (load edit — loaddataall Delphi)
// ─────────────────────────────────────────────────────────
const getById = async (nomor) => {
  const [hdrRows] = await db.query(
    `SELECT h.*,
            DATE_FORMAT(h.mph_tanggal, '%Y-%m-%d') AS mph_tanggal_fmt,
            IFNULL(s.spk_nama, m.mspk_nama) AS spk_nama,
            IFNULL(s.spk_jumlah, m.mspk_jumlah) AS spk_jumlah,
            IFNULL(s.spk_finishing, m.mspk_finishing) AS finishing,
            IFNULL(IF(s.spk_sablon='Y' OR s.spk_sublim='Y', 'Y', 'N'), '-') AS xcetak,
            IFNULL(s.spk_bordir, '-') AS xbordir,
            IFNULL(s.spk_divisi, m.mspk_divisi) AS spk_divisi,
            IFNULL(s.spk_tanggal, m.mspk_tanggal) AS tglspk,
            IFNULL(o.jo_nama, '') AS jo_nama,
            IFNULL(k.spkb_babaran, 0) AS bbrstd,
            IFNULL(b.bhn_GRAMASI, '') AS gramasi,
            IFNULL(b.bhn_setting, '') AS sett,
            IFNULL(b.Bhn_Name, '') AS namakain,
            IFNULL(pm.promind_Jumlah, 0) AS jmlkain,
            DATE_FORMAT(ph.promin_tanggal, '%d-%m-%Y') AS promin_tanggal,
            IFNULL(b.bhn_satuan, '') AS satkain,
            IFNULL(h.mph_sup_kode, '') AS supkode,
            IFNULL(h.mph_qty_berat, 0) AS qtyberat,
            IFNULL(h.mph_sat_berat, '') AS satberat,
            gd_a.gdgp_nama AS nama_gdg_asal,
            gd_t.gdgp_nama AS nama_gdg_tujuan,
            gd_a.gdgp_cab AS cab_gdg
     FROM tmutasiproduksi_hdr h
     LEFT JOIN tspk s ON s.spk_nomor = h.mph_spk_nomor
     LEFT JOIN tmemospk m ON m.mspk_nomor = h.mph_spk_nomor
     LEFT JOIN tjenisorder o ON o.jo_kode = IFNULL(s.spk_jo_kode, m.mspk_jo_kode)
     LEFT JOIN tspk_babaran k ON k.spkb_nomor = h.mph_spk_nomor AND k.spkb_komponen = h.mph_komponen
     LEFT JOIN tbahan b ON b.Bhn_kode = h.mph_bhn_kode
     LEFT JOIN tproduksiminta_hdr ph ON ph.promin_nomor = h.mph_nomaterial
     LEFT JOIN tproduksiminta_dtl pm ON pm.promind_promin_Nomor = h.mph_nomaterial
                                      AND pm.promind_bhn_kode = h.mph_bhn_kode
     LEFT JOIN tgudangproduksi gd_a ON gd_a.gdgp_kode = h.mph_gdgasal
     LEFT JOIN tgudangproduksi gd_t ON gd_t.gdgp_kode = h.mph_gdgtujuan
     WHERE h.mph_nomor = ?`,
    [nomor],
  );
  if (hdrRows.length === 0) return null;
  const hdr = hdrRows[0];

  // Detail baris
  const [dtlRows] = await db.query(
    `SELECT d.*,
            IFNULL(z.spks_qty, 0) AS qtyorder
     FROM tmutasiproduksi_dtl d
     LEFT JOIN tspk_size z ON z.spks_nomor = d.mpd_spk AND z.spks_size = d.mpd_size
     WHERE d.mpd_mph_nomor = ?
     ORDER BY d.mpd_bhn_kode, d.mpd_size`,
    [nomor],
  );

  let finalDetail = dtlRows;
  let dcHasProof = true;

  if (hdr.MPH_gdgasal === "GP032") {
    // Load komponen proof + terima + sudah DC
    const [kompoRows, terimaRows, sudahRows] = await Promise.all([
      getKomponenProof(hdr.MPH_SPK_nomor),
      getTerimaGp032(hdr.MPH_SPK_nomor),
      getSudahGp032(hdr.MPH_SPK_nomor),
    ]);

    dcHasProof = kompoRows.length > 0;

    // ⚠️ FIX: kalau Proof Garmen kosong, JANGAN timpa finalDetail jadi
    // array kosong — biarkan tetap dtlRows (baris manual yang sudah
    // tersimpan sebelumnya). Sebelumnya finalDetail SELALU di-replace
    // dengan hasil .map() dari kompoRows, walau kompoRows = [] — jadi
    // baris manual yang sudah diisi user hilang setiap kali dibuka edit.
    if (dcHasProof) {
      finalDetail = kompoRows.map((r) => {
        const saved = dtlRows.find(
          (d) => d.mpd_bhn_kode === r.kode && d.mpd_size === r.size,
        );
        const terima = terimaRows.find(
          (t) => t.kode === r.kode && t.size === r.size,
        );
        const sudah = sudahRows.find(
          (s) => s.kode === r.kode && s.size === r.size,
        );
        const tq = Number(terima?.qty) || 0;
        const sq = Number(sudah?.qty) || 0;

        return {
          mpd_bhn_kode: r.kode,
          mpd_nama: r.nama,
          mpd_satuan: r.satuan,
          mpd_size: r.size || "",
          qtyorder: Number(r.qtyorder) || 0,
          mpd_lhk: 0,
          mpd_jumlah: Number(saved?.mpd_jumlah) || 0,
          mpd_jumlah_bs: 0,
          mpd_jumlah_sablon: 0,
          mpd_jumlah_kain: 0,
          mpd_gantibs: 0,
          mpd_panjang: 0,
          mpd_lebar: 0,
          terima: tq,
          sudah: sq - (Number(saved?.mpd_jumlah) || 0),
          kurang: (Number(r.qtyorder) || 0) - sq,
          stok: tq - sq,
        };
      });
    }
    // else: finalDetail tetap dtlRows (baris manual apa adanya)
  }

  // Planning tersimpan
  const planningInfo = {
    no_planning: hdr.mph_plan_nomor || "",
    tanggal: hdr.mph_plan_tanggal
      ? new Date(hdr.mph_plan_tanggal).toISOString().substring(0, 10)
      : "",
    jumlah: Number(hdr.mph_plan_jumlah) || 0,
    status: hdr.mph_plan_status || "",
  };

  // Sudah LHK dari material
  let lhkSudah = 0;
  if (hdr.mph_nomaterial && hdr.mph_bhn_kode) {
    const [[lhkRow]] = await db.query(
      `SELECT SUM(jml) AS sudah FROM (
         SELECT IFNULL(SUM(mph_qty_berat), 0) AS jml
         FROM tmutasiproduksi_hdr
         WHERE mph_nomor <> ? AND mph_nomaterial = ? AND mph_bhn_kode = ?
         UNION ALL
         SELECT IFNULL(SUM(bpj_qty_berat), 0) AS jml
         FROM tbpj_hdr
         WHERE bpj_nomaterial = ? AND bpj_bhn_kode = ?
       ) x`,
      [
        nomor,
        hdr.mph_nomaterial,
        hdr.mph_bhn_kode,
        hdr.mph_nomaterial,
        hdr.mph_bhn_kode,
      ],
    );
    lhkSudah = Number(lhkRow?.sudah) || 0;
  }

  // Cek tutup buku & status PIN5
  const zdtClose = await tutupBukuService.getTanggalTutupBuku();
  const zClose = await tutupBukuService.getManualTutupBuku("MUTASI PRODUKSI");
  const tglTransaksi = new Date(hdr.mph_tanggal);

  let isClose = false;
  if (zClose) {
    isClose = tglTransaksi < zClose;
  } else {
    isClose = tglTransaksi < zdtClose;
  }

  let pin5Status = "";
  if (isClose) {
    const [pinRows] = await db.query(
      `SELECT pin_acc, pin_dipakai, pin_urut
       FROM tspk_pin5
       WHERE pin_trs = 'MUTASI PRODUKSI' AND pin_nomor = ?
       ORDER BY pin_urut DESC LIMIT 1`,
      [nomor],
    );
    if (pinRows.length === 0) {
      pin5Status = "MINTA";
    } else {
      const pin = pinRows[0];
      if (pin.pin_acc === "" && pin.pin_dipakai === "") pin5Status = "WAIT";
      else if (pin.pin_acc === "Y" && pin.pin_dipakai === "")
        pin5Status = "ACC";
      else if (pin.pin_acc === "N") pin5Status = "TOLAK";
      else pin5Status = "MINTA";
    }
  }

  let satberat = hdr.satberat || "";
  if (hdr.MPH_gdgasal === "GP001" || hdr.MPH_gdgasal === "GP015") {
    if (hdr.satkain === "KG") satberat = "KG";
    else if (!satberat) satberat = "MTR";
  }

  const noPlanStatus = await getApprovalNoPlanStatus(nomor);

  return {
    header: {
      ...hdr,
      mph_tanggal: hdr.mph_tanggal_fmt,
      satberat,
      lhk_sudah: lhkSudah,
      lhk_kurang: Number(hdr.jmlkain || 0) - lhkSudah,
    },
    detail: finalDetail,
    planning: planningInfo,
    isClose,
    pin5Status,
    noPlanStatus, // ← tambahan: "", "MINTA", "ACC", "TOLAK"
    dcHasProof,
  };
};

// ─────────────────────────────────────────────────────────
// SAVE (simpandata Delphi)
// Insert/Update header + delete+insert detail
// xminta5='ACC' → update pin_dipakai='Y'
// ─────────────────────────────────────────────────────────
const save = async (data, userKode, isNewMode) => {
  // Sanitasi field NOT NULL
  data.SupplierKain = data.SupplierKain || "";
  data.SupKode = data.SupKode || "";
  data.NoMaterial = data.NoMaterial || "";
  data.KodeKain = data.KodeKain || "";
  data.SatBerat = data.SatBerat || "";
  data.Komponen = data.Komponen || "";
  data.Alasan = data.Alasan || "";
  data.AsalKerjaan = data.AsalKerjaan || "";
  data.Keterangan = data.Keterangan || "";
  data.KelompokTujuan = data.KelompokTujuan || "";
  data.PlanNomor = data.PlanNomor || "";
  data.PlanStatus = data.PlanStatus || "";

  const {
    Tanggal,
    Cab,
    Keterangan,
    NomorSpk,
    GdgAsal,
    GdgTujuan,
    Kelompok,
    KelompokTujuan,
    SupplierKain,
    NoMaterial,
    KodeKain,
    SupKode,
    QtyBerat,
    SatBerat,
    Jumlah,
    Komponen,
    Alasan,
    AsalKerjaan,
    xApv,
    PlanNomor = "",
    PlanTanggal = null,
    PlanJumlah = 0,
    PlanStatus = "",
    Detail = [],
    pin5Urut = null,
    pin5Status = "",
  } = data;

  // Filter detail: hanya baris dengan total qty > 0
  const validDetail = Detail.filter((d) => {
    const tqty =
      (Number(d.jumlah) || 0) +
      (Number(d.bslini) || 0) +
      (Number(d.bskainsablon) || 0) +
      (Number(d.bskain) || 0) +
      (Number(d.gantibs) || 0);
    return d.nama && tqty > 0;
  });

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    let nomor = isNewMode ? null : data.Nomor;

    if (isNewMode) {
      nomor = await generateNomor(Tanggal);
      await conn.query(
        `INSERT INTO tmutasiproduksi_hdr
           (MPH_nomor, MPH_tanggal, mph_cab, MPH_keterangan, MPH_SPK_nomor,
            MPH_jumlah, mph_gdgasal, mph_gdgtujuan, mph_kelompok, mph_kelompok_tujuan,
            mph_supplierkain, mph_nomaterial, mph_bhn_kode, mph_sup_kode,
            mph_qty_berat, mph_sat_berat, mph_komponen, mph_alasan, mph_apv,
            mph_asal_kerjaan, date_create, user_create,
            mph_plan_nomor, mph_plan_tanggal, mph_plan_jumlah, mph_plan_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?, ?, ?, ?)`,
        [
          nomor,
          Tanggal,
          Cab,
          Keterangan,
          NomorSpk,
          Jumlah,
          GdgAsal,
          GdgTujuan,
          Kelompok,
          KelompokTujuan,
          SupplierKain,
          NoMaterial,
          KodeKain,
          SupKode,
          QtyBerat,
          SatBerat,
          Komponen,
          Alasan,
          xApv,
          AsalKerjaan,
          userKode,
          PlanNomor,
          PlanTanggal,
          PlanJumlah,
          PlanStatus,
        ],
      );
    } else {
      await conn.query(
        `UPDATE tmutasiproduksi_hdr SET
           mph_tanggal = ?, mph_cab = ?, mph_keterangan = ?, mph_spk_nomor = ?,
           mph_nomaterial = ?, mph_bhn_kode = ?, mph_sup_kode = ?,
           mph_qty_berat = ?, mph_sat_berat = ?, mph_jumlah = ?,
           mph_gdgasal = ?, mph_gdgtujuan = ?, mph_kelompok = ?, mph_kelompok_tujuan = ?,
           mph_supplierkain = ?, mph_komponen = ?, mph_alasan = ?, mph_apv = ?,
           mph_asal_kerjaan = ?,
           mph_plan_nomor = ?, mph_plan_tanggal = ?, mph_plan_jumlah = ?, mph_plan_status = ?,
           date_modified = NOW(), user_modified = ?
         WHERE MPH_nomor = ?`,
        [
          Tanggal,
          Cab,
          Keterangan,
          NomorSpk,
          NoMaterial,
          KodeKain,
          SupKode,
          QtyBerat,
          SatBerat,
          Jumlah,
          GdgAsal,
          GdgTujuan,
          Kelompok,
          KelompokTujuan,
          SupplierKain,
          Komponen,
          Alasan,
          xApv,
          AsalKerjaan,
          PlanNomor,
          PlanTanggal,
          PlanJumlah,
          PlanStatus,
          userKode,
          nomor,
        ],
      );
    }

    // Delete + insert detail
    await conn.query(
      `DELETE FROM tmutasiproduksi_dtl WHERE MPD_MPH_nomor = ?`,
      [nomor],
    );

    for (const row of validDetail) {
      await conn.query(
        `INSERT INTO tmutasiproduksi_dtl
           (MPD_MPH_nomor, mpd_bhn_kode, MPD_NAMA, MPD_satuan, mpd_size,
            mpd_lhk, MPD_jumlah, mpd_jumlah_bs, mpd_jumlah_sablon, mpd_jumlah_kain,
            mpd_spk, mpd_gdgp_asal, mpd_panjang, mpd_lebar, mpd_gantibs)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          nomor,
          row.kode,
          row.nama,
          row.satuan,
          row.size || "",
          Number(row.lhk) || 0,
          Number(row.jumlah) || 0,
          Number(row.bslini) || 0,
          Number(row.bskainsablon) || 0,
          Number(row.bskain) || 0,
          NomorSpk,
          GdgAsal,
          Number(row.panjang) || 0,
          Number(row.lebar) || 0,
          Number(row.gantibs) || 0,
        ],
      );
    }

    // ── TAMBAHAN: Sinkronisasi Approval "Mutasi Produksi tanpa Planning" ──
    const planningKosong = await cekPlanningKosong(
      NomorSpk,
      data.JenisMutasi,
      Kelompok,
      data.TglSpk || Tanggal,
      GdgTujuan,
    );
    await syncApprovalNoPlan(
      conn,
      nomor,
      { NomorSpk, NamaSpk: data.NamaSpk, Tanggal },
      userKode,
      planningKosong,
    );

    // Jika xminta5='ACC' → tandai PIN5 sudah dipakai
    if (pin5Status === "ACC" && pin5Urut) {
      await conn.query(
        `UPDATE tspk_pin5 SET pin_dipakai = 'Y'
         WHERE pin_trs = 'MUTASI PRODUKSI' AND pin_nomor = ? AND pin_urut = ?`,
        [nomor, pin5Urut],
      );
    }

    await conn.commit();
    return nomor;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
};

// ─────────────────────────────────────────────────────────
// GET NAMA GUDANG PRODUKSI
// ─────────────────────────────────────────────────────────
const getNamaGudangProduksi = async (kode) => {
  const [[row]] = await db.query(
    `SELECT gdgp_nama, gdgp_cab FROM tgudangproduksi WHERE gdgp_kode = ? LIMIT 1`,
    [kode],
  );
  return row || null;
};

// ─────────────────────────────────────────────────────────
// SEARCH GUDANG PRODUKSI (F1 di field lini)
// ─────────────────────────────────────────────────────────
const searchGudangProduksi = async (q = "", cab = "") => {
  let query = `SELECT gdgp_kode AS Kode, gdgp_nama AS Nama
               FROM tgudangproduksi
               WHERE gdgp_aktif = 0
                 AND gdgp_nama NOT LIKE '%Mitra%'`;
  const params = [];
  if (cab === "P01" || cab === "P04") {
    query += ` AND gdgp_cab = ?`;
    params.push(cab);
  }
  if (q) {
    query += ` AND (gdgp_kode LIKE ? OR gdgp_nama LIKE ?)`;
    params.push(`%${q}%`, `%${q}%`);
  }
  query += ` ORDER BY gdgp_nama`;
  const [rows] = await db.query(query, params);
  return rows;
};

// ─────────────────────────────────────────────────────────
// GET PROSES SEBELUMNYA (F4 di Delphi)
// ─────────────────────────────────────────────────────────
const getProsesSebelumnya = async (nomorSpk, gdgAsal, excludeNomor = "") => {
  const [rows] = await db.query(
    `SELECT
       mpd_bhn_kode AS kode,
       MPD_NAMA     AS Nama,
       MPD_satuan   AS Satuan,
       mpd_size     AS Size,
       SUM(mpd_jumlah)                           AS Mutasi,
       SUM(IFNULL(bpjd_jumlah, 0))               AS Jasa,
       SUM(mpd_jumlah + IFNULL(bpjd_jumlah, 0)) AS Total
     FROM (
       SELECT mpd_bhn_kode, MPD_NAMA, MPD_satuan, mpd_size,
              SUM(mpd_jumlah) mpd_jumlah, 0 bpjd_jumlah
       FROM tmutasiproduksi_dtl
       INNER JOIN tmutasiproduksi_hdr ON mpd_mph_nomor = mph_nomor
       WHERE mph_spk_nomor = ?
         AND MPH_GDGASAL = ?
         AND mph_nomor <> ?
       GROUP BY mpd_bhn_kode, mpd_size
       UNION ALL
       SELECT bpjd_bhn_kode, bhn_name, bhn_satuan, bpjd_size,
              0, IFNULL(SUM(bpjd_jumlah), 0)
       FROM tbpj_dtl
       INNER JOIN tbpj_hdr    ON bpj_nomor       = bpjd_bpj_nomor
       INNER JOIN tpojasa_hdr ON pojh_nomor       = bpj_po_nomor
       INNER JOIN tjasa        ON jasa_kode        = pojh_jasa_kode
       INNER JOIN tbahan       ON bhn_kode         = bpjd_bhn_kode
       WHERE bpjd_spk = ?
         AND bpjd_gdgp_asal = ?
       GROUP BY bpjd_bhn_kode, bpjd_size
     ) final
     WHERE MPD_NAMA <> ''
     GROUP BY mpd_bhn_kode, MPD_NAMA, mpd_size`,
    [nomorSpk, gdgAsal, excludeNomor, nomorSpk, gdgAsal],
  );
  return rows;
};

const searchBahanBySuffix = async (suffix, gdgAsal) => {
  const isBordir = gdgAsal === "GP014" || gdgAsal === "GP016";
  let where = `WHERE bhn_aktif = 0 AND bhn_jb_kode = 'LL' AND bhn_kode LIKE ?`;
  if (isBordir) where += ` AND bhn_bordir = 1`;
  const [rows] = await db.query(
    `SELECT bhn_kode AS Kode, bhn_name AS Nama, bhn_satuan AS Satuan
     FROM tbahan ${where} LIMIT 5`,
    [`%${suffix}`],
  );
  return rows;
};

const getDataCetak = async (nomor) => {
  const [rows] = await db.query(
    `SELECT
       a.MPH_nomor, a.mph_tanggal, a.MPH_keterangan,
       a.mph_gdgasal, a.mph_gdgtujuan, a.MPH_jumlah,
       a.MPH_SPK_nomor,
       IFNULL(e.spk_nama, f.mspk_nama) AS spk_nama,
       gx.gdgp_nama AS nama_gdg_tujuan,
       gy.gdgp_nama AS nama_gdg_asal,
       p.perush_nama, p.perush_alamat,
       b.mpd_bhn_kode, b.MPD_NAMA, b.MPD_jumlah, b.MPD_satuan, b.mpd_size
     FROM tmutasiproduksi_hdr a
     LEFT JOIN tspk e          ON e.spk_nomor    = a.MPH_SPK_nomor
     LEFT JOIN tmemospk f      ON f.mspk_nomor   = a.MPH_SPK_nomor
     LEFT JOIN tmutasiproduksi_dtl b ON b.MPD_MPH_nomor = a.MPH_nomor
     LEFT JOIN tgudangproduksi gx ON gx.gdgp_kode = a.mph_gdgtujuan
     LEFT JOIN tgudangproduksi gy ON gy.gdgp_kode = a.mph_gdgasal
     LEFT JOIN tperusahaan p   ON p.perush_kode  = 'KP'
     WHERE a.MPH_nomor = ?
     ORDER BY b.mpd_bhn_kode, b.mpd_size`,
    [nomor],
  );

  if (!rows.length) throw new Error("Data tidak ditemukan.");

  const hdr = rows[0];
  const detail = rows
    .filter((r) => r.mpd_bhn_kode)
    .map((r) => ({
      MPD_NAMA: r.MPD_NAMA,
      MPD_jumlah: r.MPD_jumlah,
      MPD_satuan: r.MPD_satuan,
      mpd_size: r.mpd_size,
    }));

  return {
    MPH_nomor: hdr.MPH_nomor,
    mph_tanggal: hdr.mph_tanggal,
    MPH_keterangan: hdr.MPH_keterangan,
    spk_nama: hdr.spk_nama,
    mph_gdgasal: hdr.mph_gdgasal,
    nama_gdg_asal: hdr.nama_gdg_asal,
    mph_gdgtujuan: hdr.mph_gdgtujuan,
    nama_gdg_tujuan: hdr.nama_gdg_tujuan,
    MPH_jumlah: hdr.MPH_jumlah,
    perush_nama: hdr.perush_nama,
    perush_alamat: hdr.perush_alamat,
    detail,
  };
};

// ─────────────────────────────────────────────────────────
// CEK PLANNING KOSONG — untuk approval MENU_ID 266
// Jenis mutasi 2 (QC Ptg ke Cetak), 3 (Cetak ke QC Cetak),
// 4 (DC/QC Cetak ke Jahit) DIKECUALIKAN — secara struktural jenis ini
// memang tidak pernah punya planning PPIC (lihat divisiMap di
// getPlanningPpic yang selalu "" utk ketiganya), jadi validasi ini
// tidak relevan buat mereka.
// ─────────────────────────────────────────────────────────
const JENIS_TANPA_VALIDASI_PLANNING = ["2", "3", "4"];

const cekPlanningKosong = async (
  nomorSpk,
  jenisMutasi,
  kelompok,
  tglDibuat,
  gdgTujuan = "",
) => {
  if (JENIS_TANPA_VALIDASI_PLANNING.includes(String(jenisMutasi))) {
    return false;
  }
  // FIX: mutasi APAPUN yang tujuannya DC (GP032) memang tidak pernah
  // dijadwalkan di Planning PPIC — dikecualikan juga dari validasi ini,
  // terlepas dari jenisMutasi-nya. Ini menangkap kasus user pilih Lini
  // Tujuan = DC secara manual (F1 search), bukan cuma lewat preset
  // tombol Jenis Mutasi yang sudah dikecualikan di atas.
  if (gdgTujuan === "GP032") {
    return false;
  }
  const rows = await getPlanningPpic(
    nomorSpk,
    jenisMutasi,
    kelompok,
    tglDibuat,
  );
  return rows.length === 0;
};

// ─────────────────────────────────────────────────────────
// SINKRONISASI APPROVAL "MUTASI PRODUKSI TANPA PLANNING PPIC"
// (MENU_ID 266) — auto-flag saat save, TIDAK memblokir save itu
// sendiri (soft-flag). pin_urut selalu 1 (satu approval record per
// nomor mutasi, bukan multi-pengajuan spt UBAH/HAPUS).
// ─────────────────────────────────────────────────────────
const syncApprovalNoPlan = async (
  conn,
  nomor,
  header,
  userKode,
  planningKosong,
) => {
  if (planningKosong) {
    const ket = `${header.NomorSpk} - ${header.NamaSpk || ""}`
      .trim()
      .substring(0, 200);
    await conn.query(
      `INSERT INTO tspk_pin5
         (pin_trs, pin_nomor, pin_urut, pin_program, pin_jenis,
          pin_tgl_trs, pin_ket, pin_tgl_minta, pin_user_minta,
          pin_acc, pin_dipakai)
       VALUES ('MUTASI PRODUKSI NOPLAN', ?, 1, 'MANKSI', 'NOPLAN',
               ?, ?, NOW(), ?, '', '')
       ON DUPLICATE KEY UPDATE
         pin_tgl_trs    = VALUES(pin_tgl_trs),
         pin_ket        = VALUES(pin_ket),
         pin_tgl_minta  = NOW(),
         pin_user_minta = VALUES(pin_user_minta),
         -- Kalau sebelumnya sudah pernah di-ACC, biarkan status ACC-nya
         -- tetap (jangan reset ke pending hanya krn user save ulang)
         pin_acc        = IF(pin_acc = 'Y', pin_acc, ''),
         pin_dipakai    = ''`,
      [nomor, header.Tanggal, ket, userKode],
    );
  } else {
    // Planning sudah ada (user pilih ulang) — bersihkan request lama yg
    // belum di-ACC supaya tidak nyangkut sbg pending yg sudah tidak relevan
    await conn.query(
      `DELETE FROM tspk_pin5
       WHERE pin_trs = 'MUTASI PRODUKSI NOPLAN' AND pin_nomor = ? AND pin_urut = 1 AND pin_acc <> 'Y'`,
      [nomor],
    );
  }
};

// ─────────────────────────────────────────────────────────
// GET STATUS APPROVAL NOPLAN — dipakai getById utk banner di form
// ─────────────────────────────────────────────────────────
const getApprovalNoPlanStatus = async (nomor) => {
  const [rows] = await db.query(
    `SELECT pin_acc FROM tspk_pin5
     WHERE pin_trs = 'MUTASI PRODUKSI NOPLAN' AND pin_nomor = ? AND pin_urut = 1
     LIMIT 1`,
    [nomor],
  );
  if (rows.length === 0) return ""; // tidak pernah kena flag
  const acc = rows[0].pin_acc;
  if (acc === "Y") return "ACC";
  if (acc === "N") return "TOLAK";
  return "MINTA"; // pin_acc kosong = menunggu approval
};

module.exports = {
  generateNomor,
  getGudangByMutasi,
  getSpkInfo,
  getKomponenList,
  getBabaranStd,
  getMkbInfo,
  searchNoMaterial,
  getNoMaterialDetail,
  getSudah,
  getSudahSize,
  getPlanningPpic,
  getKelompokList,
  getKelompokTujuanList,
  searchBahan,
  loadKodeBahan,
  loadKomponenMap,
  getKomponenProof,
  getTerimaGp032,
  getSudahGp032,
  cekKomponen,
  cekPlanning,
  cekLhk,
  cekPendingSpk,
  isSkipPlanningValidation,
  getById,
  save,
  getNamaGudangProduksi,
  searchGudangProduksi,
  getProsesSebelumnya,
  searchBahanBySuffix,
  getDataCetak,
  cekPlanningKosong,
  syncApprovalNoPlan,
  getApprovalNoPlanStatus,
  getPlanningPerSpk,
};
