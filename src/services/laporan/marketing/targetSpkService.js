const db = require("../../../config/database");

const SO_CUTOFF = "2026-08-06";

// ─────────────────────────────────────────────────────────
// Replikasi PERSIS TfrmTargetSpk.btnRefreshClick (versi yang beneran
// dipanggil tombol Refresh — BUKAN `alldept`, yang kelihatannya
// prosedur legacy gak terpasang ke tombol manapun di form ini).
//
// Perbedaan besar dari implementasi web sebelumnya:
// 1. SATU baris per customer, TIDAK ADA pivot per-divisi. "ALL DIVISI"
//    di Delphi cuma berarti idivisi IN (1,3,4,5) digabung jadi SATU
//    angka SPK, bukan kolom SP/GM/GP/MMT terpisah.
// 2. Target dibaca dari tabel `tcustomer_target` (GROUP BY cust_kode,
//    cust_tahun, filter cust_divisi IN (...) + opsional cust_spktipe),
//    BUKAN dari kolom statis `tcustomer.cus_{tahun}{suffix}`.
// 3. Setiap periode (tahun dipilih, -1, -2, -3) UNION ALL tspk
//    (< cutoff) + tsalesorder (>= cutoff) — ini yg bikin tahun 2026
//    akhirnya muncul.
// 4. Nama_Sales pakai fallback chain: sales dari th (tahun dipilih) →
//    th1 → th2 → th3 → kosong. Beda dari KodeSales/NamaSales biasa
//    (yg selalu dari cus_sales master, independen dari transaksi).
// ─────────────────────────────────────────────────────────

// idivisi + filter tipe per opsi dropdown — replikasi cabang if/else
// cbDivisi.Text di Delphi
const DIVISI_CONFIG = {
  SPANDUK: { idivisi: "1", tipe: null },
  KAOSAN: { idivisi: "3", tipe: null },
  GARMEN_MEDIUM: { idivisi: "4", tipe: "MEDIUM" },
  GARMEN_PREMIUM: { idivisi: "4", tipe: "PREMIUM" },
  MMT: { idivisi: "5", tipe: null },
  FIT_U: { idivisi: "6", tipe: null },
  // ALL DIVISI Delphi: idivisi='1,3,4,5', TANPA filter tipe (digabung
  // medium+premium jadi satu, KAOSAN ikut, FIT_U TIDAK ikut)
  ALL: { idivisi: "1,3,4,5", tipe: null },
};

const buildPeriods = (startDate, endDate) => {
  const sd = new Date(startDate);
  const ed = new Date(endDate);
  const tahun = sd.getFullYear();
  if (ed.getFullYear() !== tahun) {
    throw new Error("Periode tahun harus sama.");
  }
  const pad = (n) => String(n).padStart(2, "0");
  const mkDate = (year, month, day) => `${year}-${pad(month + 1)}-${pad(day)}`;
  const nDay = sd.getDate();
  const nMonth = sd.getMonth();
  const nDay2 = ed.getDate();
  const nMonth2 = ed.getMonth();
  const n3 = tahun - 3;
  const n2 = tahun - 2;
  const n1 = tahun - 1;
  return {
    tahun,
    n3,
    n2,
    n1,
    p0: [startDate, endDate], // tahun dipilih — pakai tanggal asli
    p1: [mkDate(n1, nMonth, nDay), mkDate(n1, nMonth2, nDay2)],
    p2: [mkDate(n2, nMonth, nDay), mkDate(n2, nMonth2, nDay2)],
    p3: [mkDate(n3, nMonth, nDay), mkDate(n3, nMonth2, nDay2)],
  };
};

// Bangun 1 blok subquery "thX" — UNION ALL tspk(<cutoff) + tsalesorder(>=cutoff),
// GROUP BY per customer. ANY_VALUE() dipakai utk sal_kode/sal_nama karena
// Delphi asli GROUP BY spk_cus_kode saja (bukan strict), MySQL modern
// (ONLY_FULL_GROUP_BY) butuh pembungkus itu biar gak error.
const buildThSubquery = (idivisi, tipe, dateRange) => {
  const [dStart, dEnd] = dateRange;
  const tipeSpk = tipe ? ` AND spk_tipe = '${tipe}'` : "";
  const tipeSo = tipe ? ` AND so_tipe = '${tipe}'` : "";
  return {
    sql: `
      SELECT spk_cus_kode, MAX(spk_sal_kode) AS spk_sal_kode,
             MAX(sal_nama) AS sal_nama, SUM(spk_total) AS spk_total
      FROM (
        SELECT spk_cus_kode, spk_sal_kode, sal_nama,
               SUM(spk_jumlah * spk_harga) AS spk_total
        FROM tspk
        LEFT JOIN tsales ON sal_kode = spk_sal_kode
        WHERE spk_tanggal >= ? AND spk_tanggal <= ? AND spk_tanggal < '${SO_CUTOFF}'
          AND spk_divisi IN (${idivisi})${tipeSpk}
          AND spk_cmo <> '' AND spk_aktif = 'Y'
        GROUP BY spk_cus_kode, spk_sal_kode
        UNION ALL
        SELECT so_cus_kode, so_sal_kode, sal_nama,
               SUM(so_jumlah * so_harga) AS spk_total
        FROM tsalesorder
        LEFT JOIN tsales ON sal_kode = so_sal_kode
        WHERE so_tanggal >= ? AND so_tanggal <= ? AND so_tanggal >= '${SO_CUTOFF}'
          AND so_divisi IN (${idivisi})${tipeSo}
          AND so_cmo <> '' AND so_aktif = 'Y'
        GROUP BY so_cus_kode
      ) thx
      GROUP BY spk_cus_kode
    `,
    params: [dStart, dEnd, dStart, dEnd],
  };
};

const getBrowse = async (query) => {
  const {
    startDate,
    endDate,
    divisi = "ALL",
    salesKode = "",
    cusKode = "",
  } = query;

  if (!startDate || !endDate) {
    throw new Error("Periode tanggal wajib diisi.");
  }
  const cfg = DIVISI_CONFIG[divisi];
  if (!cfg) throw new Error(`Divisi "${divisi}" tidak dikenal.`);

  const periods = buildPeriods(startDate, endDate);
  const th = buildThSubquery(cfg.idivisi, cfg.tipe, periods.p0);
  const th1 = buildThSubquery(cfg.idivisi, cfg.tipe, periods.p1);
  const th2 = buildThSubquery(cfg.idivisi, cfg.tipe, periods.p2);
  const th3 = buildThSubquery(cfg.idivisi, cfg.tipe, periods.p3);

  const targetTipeFilter = cfg.tipe ? ` AND cust_spktipe = '${cfg.tipe}'` : "";

  let extraWhere = "";
  const extraParams = [];
  if (salesKode) {
    extraWhere += " AND c.cus_sales = ?";
    extraParams.push(salesKode);
  }
  if (cusKode) {
    extraWhere += " AND c.cus_kode = ?";
    extraParams.push(cusKode);
  }

  const sql = `
    SELECT
      c.cus_kode AS Kode, c.cus_nama AS Customer, c.cus_alamat AS Alamat,
      IF(th.sal_nama IS NOT NULL, th.sal_nama,
        IF(th1.sal_nama IS NOT NULL, th1.sal_nama,
          IF(th2.sal_nama IS NOT NULL, th2.sal_nama,
            IF(th3.sal_nama IS NOT NULL, th3.sal_nama, '')))) AS NamaSalesTransaksi,
      IFNULL(th3.spk_total, 0) AS Spk3,
      IFNULL(th2.spk_total, 0) AS Spk2,
      IFNULL(th1.spk_total, 0) AS Spk1,
      (IFNULL(th3.spk_total, 0) + IFNULL(th2.spk_total, 0) + IFNULL(th1.spk_total, 0))
        / NULLIF(
            (IF(IFNULL(th3.spk_total, 0) > 0, 1, 0)
             + IF(IFNULL(th2.spk_total, 0) > 0, 1, 0)
             + IF(IFNULL(th1.spk_total, 0) > 0, 1, 0)),
            0
          ) AS Average,
      IFNULL(t.cust_Target, 0) AS Target,
      IFNULL(th.spk_total, 0) AS Actual,
      ROUND(IFNULL(
        IFNULL(th.spk_total, 0) / NULLIF(
          (IFNULL(th3.spk_total, 0) + IFNULL(th2.spk_total, 0) + IFNULL(th1.spk_total, 0)) / 3,
          0
        ), 0
      ), 2) AS PctAverage,
      ROUND(IFNULL(IFNULL(th.spk_total, 0) / NULLIF(t.cust_Target, 0), 0), 2) AS PctTarget,
      c.cus_sales AS KodeSales, a.sal_nama AS NamaSales
    FROM tcustomer c
    LEFT JOIN tsales a ON a.sal_kode = c.cus_sales
    LEFT JOIN (
      SELECT cust_kode, cust_tahun, SUM(cust_target) AS cust_Target
      FROM tcustomer_target
      WHERE cust_divisi IN (${cfg.idivisi})${targetTipeFilter}
      GROUP BY cust_kode, cust_tahun
    ) t ON t.cust_tahun = ? AND t.cust_kode = c.cus_kode
    LEFT JOIN (${th.sql}) th ON th.spk_cus_kode = c.cus_kode
    LEFT JOIN (${th1.sql}) th1 ON th1.spk_cus_kode = c.cus_kode
    LEFT JOIN (${th2.sql}) th2 ON th2.spk_cus_kode = c.cus_kode
    LEFT JOIN (${th3.sql}) th3 ON th3.spk_cus_kode = c.cus_kode
    WHERE c.cus_iscabang = 0 AND c.cus_aktif = 0
    ${extraWhere}
    ORDER BY Average DESC
  `;

  const params = [
    periods.tahun,
    ...th.params,
    ...th1.params,
    ...th2.params,
    ...th3.params,
    ...extraParams,
  ];

  const [rows] = await db.query(sql, params);

  return {
    meta: {
      tahun: periods.tahun,
      n3: periods.n3,
      n2: periods.n2,
      n1: periods.n1,
    },
    rows,
  };
};

// ─────────────────────────────────────────────────────────
// DIVISI_MAP (lama) — dipakai KHUSUS oleh fungsi Setting di bawah.
// Beda shape dari DIVISI_CONFIG (yg dipakai getBrowse baru) karena
// Setting masih baca-tulis kolom statis tcustomer.cus_{tahun}{suffix},
// BELUM disamakan ke tcustomer_target (nunggu konfirmasi kamu soal
// itu — lihat pertanyaan sebelumnya).
// ─────────────────────────────────────────────────────────
const DIVISI_MAP = {
  SPANDUK: { filter: "s.spk_divisi = 1", suffix: "1" },
  KAOSAN: { filter: "s.spk_divisi = 3", suffix: "3" },
  GARMEN_MEDIUM: {
    filter: "s.spk_divisi = 4 AND UPPER(s.spk_tipe) = 'MEDIUM'",
    suffix: "4M",
  },
  GARMEN_PREMIUM: {
    filter: "s.spk_divisi = 4 AND UPPER(s.spk_tipe) = 'PREMIUM'",
    suffix: "4P",
  },
  MMT: { filter: "s.spk_divisi = 5", suffix: "5" },
  FIT_U: { filter: "s.spk_divisi = 6", suffix: "6" },
};

// ─────────────────────────────────────────────────────────
// SETTING — replikasi TfrmTargetSpk2. Pakai YEAR(spk_tanggal)=n
// (bukan rentang tanggal bebas), 1 divisi per panggilan.
// ⚠️ MASIH baca-tulis kolom statis tcustomer.cus_{tahun}{suffix} —
// BELUM disamakan ke tcustomer_target yg sekarang dipakai getBrowse.
// Ini artinya edit Target lewat Setting SAAT INI TIDAK NYAMBUNG ke
// angka Target yg tampil di laporan (beda sumber data). Perlu
// diputuskan & disamakan sebelum fitur Setting ini reliable dipakai.
// ─────────────────────────────────────────────────────────
const buildXQuerySettingByYear = (divisiKey, tahun, extraWhere, params) => {
  const { filter, suffix } = DIVISI_MAP[divisiKey];
  const targetCol = `cus_${tahun}${suffix}`;
  const n3 = tahun - 3;
  const n2 = tahun - 2;
  const n1 = tahun - 1;
  const sql = `
    SELECT c.cus_kode AS Kode, c.cus_nama AS Customer, c.cus_alamat AS Alamat,
      IFNULL((
        SELECT e.sal_nama FROM tspk s
        LEFT JOIN tsales e ON e.sal_kode = s.spk_sal_kode
        WHERE s.spk_cus_kode = c.cus_kode AND ${filter}
        ORDER BY s.spk_tanggal DESC LIMIT 1
      ), '') AS Sales,
      IFNULL((
        SELECT SUM(s.spk_jumlah * s.spk_harga) FROM tspk s
        WHERE ${filter} AND s.spk_cmo <> '' AND s.spk_aktif = 'Y'
          AND YEAR(s.spk_tanggal) = ${n3} AND s.spk_cus_kode = c.cus_kode
      ), 0) AS Spk3,
      IFNULL((
        SELECT SUM(s.spk_jumlah * s.spk_harga) FROM tspk s
        WHERE ${filter} AND s.spk_cmo <> '' AND s.spk_aktif = 'Y'
          AND YEAR(s.spk_tanggal) = ${n2} AND s.spk_cus_kode = c.cus_kode
      ), 0) AS Spk2,
      IFNULL((
        SELECT SUM(s.spk_jumlah * s.spk_harga) FROM tspk s
        WHERE ${filter} AND s.spk_cmo <> '' AND s.spk_aktif = 'Y'
          AND YEAR(s.spk_tanggal) = ${n1} AND s.spk_cus_kode = c.cus_kode
      ), 0) AS Spk1,
      0 AS Actual,
      c.${targetCol} AS Target,
      c.cus_sales AS KodeSales,
      a.sal_nama AS NamaSales
    FROM tcustomer c
    LEFT JOIN tsales a ON a.sal_kode = c.cus_sales
    WHERE c.cus_iscabang = 0 AND c.cus_aktif = 0
    ${extraWhere}
  `;
  return sql;
};

const wrapYZ = (xSql) => `
  SELECT z.*
  FROM (
    SELECT y.Kode, y.Customer, y.Alamat, y.Sales, y.Spk3, y.Spk2, y.Spk1, y.Actual,
      IF(y.s3 + y.s2 + y.s1 = 0, 0, (y.Spk3 + y.Spk2 + y.Spk1) / (y.s3 + y.s2 + y.s1)) AS Average,
      y.Target, y.KodeSales, y.NamaSales
    FROM (
      SELECT x.Kode, x.Customer, x.Alamat, x.Sales, x.Spk3, x.Spk2, x.Spk1, x.Actual,
        IF(x.Spk3 = 0, 0, 1) AS s3,
        IF(x.Spk2 = 0, 0, 1) AS s2,
        IF(x.Spk1 = 0, 0, 1) AS s1,
        x.Target, x.KodeSales, x.NamaSales
      FROM (${xSql}) x
    ) y
  ) z
`;

const getSettingList = async (
  tahun,
  divisiKey,
  salesKode = "",
  cusKode = "",
) => {
  if (!DIVISI_MAP[divisiKey]) {
    throw new Error(`Divisi "${divisiKey}" tidak dikenal.`);
  }
  const tahunNum = Number(tahun);
  if (!tahunNum || tahunNum < 2000 || tahunNum > 2100) {
    throw new Error("Tahun tidak valid.");
  }
  let extraWhere = "";
  const params = [];
  if (salesKode) {
    extraWhere += " AND c.cus_sales = ?";
    params.push(salesKode);
  }
  if (cusKode) {
    extraWhere += " AND c.cus_kode = ?";
    params.push(cusKode);
  }
  const xSql = buildXQuerySettingByYear(
    divisiKey,
    tahunNum,
    extraWhere,
    params,
  );
  const finalSql = `
    SELECT z.Kode, z.Customer, z.Alamat, z.Sales,
      z.Spk3, z.Spk2, z.Spk1, z.Average, z.Target, z.KodeSales, z.NamaSales
    FROM (${wrapYZ(xSql)}) z
    ORDER BY z.Kode
  `;
  try {
    const [rows] = await db.query(finalSql, params);
    const n3 = tahunNum - 3;
    const n2 = tahunNum - 2;
    const n1 = tahunNum - 1;
    return { meta: { tahun: tahunNum, n3, n2, n1 }, rows };
  } catch (err) {
    if (err.code === "ER_BAD_FIELD_ERROR") {
      const { suffix } = DIVISI_MAP[divisiKey];
      throw new Error(
        `Kolom target untuk tahun ${tahunNum} (cus_${tahunNum}${suffix}) belum ada di tabel tcustomer. Hubungi admin untuk menambahkan kolom ini.`,
      );
    }
    throw err;
  }
};

const updateTarget = async (kode, tahun, divisiKey, targetValue) => {
  if (!DIVISI_MAP[divisiKey]) {
    throw new Error(`Divisi "${divisiKey}" tidak dikenal.`);
  }
  const tahunNum = Number(tahun);
  if (!tahunNum) throw new Error("Tahun tidak valid.");
  const nilai = Number(targetValue);
  if (Number.isNaN(nilai)) throw new Error("Target harus berupa angka.");
  const { suffix } = DIVISI_MAP[divisiKey];
  const targetCol = `cus_${tahunNum}${suffix}`;
  try {
    await db.query(`UPDATE tcustomer SET ${targetCol} = ? WHERE cus_kode = ?`, [
      nilai,
      kode,
    ]);
  } catch (err) {
    if (err.code === "ER_BAD_FIELD_ERROR") {
      throw new Error(
        `Kolom ${targetCol} belum ada di tabel tcustomer. Hubungi admin untuk menambahkan kolom ini sebelum bisa set Target tahun ${tahunNum}.`,
      );
    }
    throw err;
  }
  return { kode, tahun: tahunNum, divisi: divisiKey, target: nilai };
};

const updateKodeSales = async (kode, kodeSalesBaru) => {
  const [[sales]] = await db.query(
    `SELECT sal_kode, sal_nama, sal_aktif FROM tsales WHERE sal_kode = ?`,
    [kodeSalesBaru],
  );
  if (!sales) {
    throw new Error("Sales tsb tidak ada.");
  }
  if (String(sales.sal_aktif) !== "Y") {
    throw new Error("Status sales tsb pasif.");
  }
  await db.query(`UPDATE tcustomer SET cus_sales = ? WHERE cus_kode = ?`, [
    kodeSalesBaru.toUpperCase(),
    kode,
  ]);
  return {
    kode,
    kodeSales: kodeSalesBaru.toUpperCase(),
    namaSales: sales.sal_nama,
  };
};

module.exports = {
  getBrowse,
  DIVISI_CONFIG,
  getSettingList,
  updateTarget,
  updateKodeSales,
  DIVISI_MAP,
};
