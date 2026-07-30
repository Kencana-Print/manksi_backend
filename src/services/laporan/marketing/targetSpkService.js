const db = require("../../../config/database");

// ─────────────────────────────────────────────────────────
// Whitelist divisi — filter SQL & suffix kolom target dinamis
// (cus_{tahun}{suffix}). Karena nilainya hardcoded di sini (bukan dari
// input user), aman dipakai langsung sebagai fragment SQL / nama kolom
// tanpa risiko injection.
// ⚠️ "FIT U" saya petakan ke cabang `else` Delphi (spk_divisi=6, suffix
// "6") — Delphi tidak eksplisit menamai cabang ini, cuma fallback kalau
// cbDivisi.Text tidak cocok SPANDUK/KAOSAN/GARMEN MEDIUM/GARMEN
// PREMIUM/MMT. Kalau ternyata "FIT U" itu bukan divisi=6, tolong
// dikoreksi.
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

// ⚠️ Mode "ALL DIVISI" di Delphi (alldept) CUMA menghitung 4 divisi ini
// (case x of 1..4). KAOSAN & FIT_U sengaja TIDAK diikutkan — replikasi
// apa adanya, bukan kelalaian kita.
const ALL_DIVISI_KEYS = ["SPANDUK", "GARMEN_MEDIUM", "GARMEN_PREMIUM", "MMT"];
const ALL_DIVISI_PREFIX = {
  SPANDUK: "sp",
  GARMEN_MEDIUM: "gm",
  GARMEN_PREMIUM: "gp",
  MMT: "mmt",
};

// ─────────────────────────────────────────────────────────
// Helper — hitung rentang tanggal n3/n2/n1 (3/2/1 tahun sebelum tahun
// acuan), replikasi persis EncodeDate(n, nMonth, nDay) Delphi: bulan
// & tanggal ikut startdate/enddate yang dipilih user, cuma tahunnya
// mundur.
// ─────────────────────────────────────────────────────────
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
    dt3a: mkDate(n3, nMonth, nDay),
    dt3b: mkDate(n3, nMonth2, nDay2),
    dt2a: mkDate(n2, nMonth, nDay),
    dt2b: mkDate(n2, nMonth2, nDay2),
    dt1a: mkDate(n1, nMonth, nDay),
    dt1b: mkDate(n1, nMonth2, nDay2),
  };
};

// ─────────────────────────────────────────────────────────
// Bangun 1 blok subquery "level-x" (raw per-customer metrics) untuk 1
// divisi — dipakai baik oleh mode single-divisi maupun di-UNION ALL
// untuk mode ALL DIVISI.
// ⚠️ `c.cus_aktif = 0` berarti AKTIF (bukan 'Y'/1 seperti tabel lain
// di codebase) — replikasi persis dari WHERE Delphi asli.
// ─────────────────────────────────────────────────────────
const buildXQuery = (divisiKey, periods, extraWhere, params) => {
  const { filter, suffix } = DIVISI_MAP[divisiKey];
  const { tahun, dt3a, dt3b, dt2a, dt2b, dt1a, dt1b } = periods;
  const targetCol = `cus_${tahun}${suffix}`;

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
          AND s.spk_tanggal >= ? AND s.spk_tanggal <= ?
          AND s.spk_cus_kode = c.cus_kode
      ), 0) AS Spk3,
      IFNULL((
        SELECT SUM(s.spk_jumlah * s.spk_harga) FROM tspk s
        WHERE ${filter} AND s.spk_cmo <> '' AND s.spk_aktif = 'Y'
          AND s.spk_tanggal >= ? AND s.spk_tanggal <= ?
          AND s.spk_cus_kode = c.cus_kode
      ), 0) AS Spk2,
      IFNULL((
        SELECT SUM(s.spk_jumlah * s.spk_harga) FROM tspk s
        WHERE ${filter} AND s.spk_cmo <> '' AND s.spk_aktif = 'Y'
          AND s.spk_tanggal >= ? AND s.spk_tanggal <= ?
          AND s.spk_cus_kode = c.cus_kode
      ), 0) AS Spk1,
      IFNULL((
        SELECT SUM(s.spk_jumlah * s.spk_harga) FROM tspk s
        WHERE ${filter} AND s.spk_cmo <> '' AND s.spk_aktif = 'Y'
          AND s.spk_tanggal >= ? AND s.spk_tanggal <= ?
          AND s.spk_cus_kode = c.cus_kode
      ), 0) AS Actual,
      c.${targetCol} AS Target,
      c.cus_sales AS KodeSales,
      a.sal_nama AS NamaSales
    FROM tcustomer c
    LEFT JOIN tsales a ON a.sal_kode = c.cus_sales
    WHERE c.cus_iscabang = 0 AND c.cus_aktif = 0
    ${extraWhere}
  `;
  params.push(
    dt3a,
    dt3b,
    dt2a,
    dt2b,
    dt1a,
    dt1b,
    periods._startDate,
    periods._endDate,
  );
  return sql;
};

// ─────────────────────────────────────────────────────────
// Bungkus x-query jadi y-level (Average) lalu z-level (%Average,
// %Target) — persis nesting Delphi. `label` opsional dipakai buat
// UNION ALL mode ALL DIVISI (kolom `Divisi` literal).
// ─────────────────────────────────────────────────────────
const wrapYZ = (xSql, label = null) => `
  SELECT z.*
    ${label ? `, ${label} AS Divisi` : ""}
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

// ─────────────────────────────────────────────────────────
// MODE SINGLE DIVISI — replikasi TfrmTargetSpk.btnRefreshClick
// ─────────────────────────────────────────────────────────
const getBrowseSingleDivisi = async (
  divisiKey,
  startDate,
  endDate,
  salesKode,
  cusKode,
) => {
  const periods = buildPeriods(startDate, endDate);
  periods._startDate = startDate;
  periods._endDate = endDate;

  let extraWhere = "";
  const params = [];
  if (salesKode) {
    extraWhere += " AND c.cus_sales = ?";
  }
  if (cusKode) {
    extraWhere += " AND c.cus_kode = ?";
  }

  const xSql = buildXQuery(divisiKey, periods, extraWhere, params);
  // buildXQuery push params tanggal dulu — extraWhere params (sales/cus)
  // harus disisipkan SETELAH params tanggal karena urutan tekstual ?
  // di SQL: WHERE clause (sales/cus) muncul di akhir teks x-query.
  if (salesKode) params.push(salesKode);
  if (cusKode) params.push(cusKode);

  const finalSql = `
    SELECT
      z.Kode, z.Customer, z.Alamat, z.Sales,
      z.Spk3, z.Spk2, z.Spk1, z.Average, z.Target, z.Actual,
      IF(z.Average = 0, 0, z.Actual / z.Average) AS PctAverage,
      IF(z.Target = 0, 0, z.Actual / z.Target) AS PctTarget,
      z.KodeSales, z.NamaSales
    FROM (${wrapYZ(xSql)}) z
    ORDER BY z.Average DESC
  `;

  try {
    const [rows] = await db.query(finalSql, params);
    return {
      meta: {
        tahun: periods.tahun,
        n3: periods.n3,
        n2: periods.n2,
        n1: periods.n1,
      },
      rows,
    };
  } catch (err) {
    if (err.code === "ER_BAD_FIELD_ERROR") {
      const { suffix } = DIVISI_MAP[divisiKey];
      throw new Error(
        `Kolom target untuk tahun ${periods.tahun} (cus_${periods.tahun}${suffix}) belum ada di tabel tcustomer. Hubungi admin untuk menambahkan kolom ini.`,
      );
    }
    throw err;
  }
};

// ─────────────────────────────────────────────────────────
// MODE ALL DIVISI — replikasi TfrmTargetSpk.alldept, TANPA temp table.
// UNION ALL 4 divisi (SPANDUK, GARMEN_MEDIUM, GARMEN_PREMIUM, MMT),
// lalu 1 GROUP BY dengan conditional MAX/SUM per divisi — persis hasil
// akhir query pivot Delphi, tapi 1 query murni tanpa CREATE/INSERT
// manual per baris.
// ─────────────────────────────────────────────────────────
const getBrowseAllDivisi = async (startDate, endDate, salesKode, cusKode) => {
  const periods = buildPeriods(startDate, endDate);
  periods._startDate = startDate;
  periods._endDate = endDate;

  let extraWhere = "";
  if (salesKode) extraWhere += " AND c.cus_sales = ?";
  if (cusKode) extraWhere += " AND c.cus_kode = ?";

  const unionParts = [];
  const params = [];
  for (const key of ALL_DIVISI_KEYS) {
    const xParams = [];
    const xSql = buildXQuery(key, periods, extraWhere, xParams);
    if (salesKode) xParams.push(salesKode);
    if (cusKode) xParams.push(cusKode);
    unionParts.push(wrapYZ(xSql, `'${key}'`));
    params.push(...xParams);
  }
  const unionSql = unionParts.join(" UNION ALL ");

  const prefixCase = (key, expr) => {
    const p = ALL_DIVISI_PREFIX[key];
    return `SUM(IF(t.Divisi = '${key}', ${expr}, 0)) AS ${p}_${expr === "1" ? "count" : expr.toLowerCase()}`;
  };

  const selectParts = [
    `t.Kode AS kode`,
    `MAX(t.Customer) AS customer`,
    `MAX(t.Alamat) AS alamat`,
  ];
  for (const key of ALL_DIVISI_KEYS) {
    const p = ALL_DIVISI_PREFIX[key];
    selectParts.push(`MAX(IF(t.Divisi = '${key}', t.Sales, '')) AS ${p}_sales`);
    selectParts.push(`SUM(IF(t.Divisi = '${key}', t.Spk3, 0)) AS ${p}_spk3`);
    selectParts.push(`SUM(IF(t.Divisi = '${key}', t.Spk2, 0)) AS ${p}_spk2`);
    selectParts.push(`SUM(IF(t.Divisi = '${key}', t.Spk1, 0)) AS ${p}_spk1`);
    selectParts.push(
      `SUM(IF(t.Divisi = '${key}', t.Average, 0)) AS ${p}_average`,
    );
    selectParts.push(
      `SUM(IF(t.Divisi = '${key}', t.Target, 0)) AS ${p}_target`,
    );
    selectParts.push(
      `SUM(IF(t.Divisi = '${key}', t.Actual, 0)) AS ${p}_actual`,
    );
    selectParts.push(
      `SUM(IF(t.Divisi = '${key}' AND t.Average <> 0, t.Actual / t.Average, 0)) AS ${p}_pct_average`,
    );
    selectParts.push(
      `SUM(IF(t.Divisi = '${key}' AND t.Target <> 0, t.Actual / t.Target, 0)) AS ${p}_pct_target`,
    );
  }
  selectParts.push(
    `MAX(t.KodeSales) AS kodeSales`,
    `MAX(t.NamaSales) AS namaSales`,
  );

  const finalSql = `
    SELECT ${selectParts.join(",\n      ")}
    FROM (${unionSql}) t
    GROUP BY t.Kode
    ORDER BY t.Kode
  `;

  try {
    const [rows] = await db.query(finalSql, params);
    return {
      meta: {
        tahun: periods.tahun,
        n3: periods.n3,
        n2: periods.n2,
        n1: periods.n1,
      },
      rows,
    };
  } catch (err) {
    if (err.code === "ER_BAD_FIELD_ERROR") {
      throw new Error(
        `Kolom target untuk tahun ${periods.tahun} belum lengkap di tabel tcustomer (butuh cus_${periods.tahun}1, cus_${periods.tahun}4M, cus_${periods.tahun}4P, cus_${periods.tahun}5). Hubungi admin.`,
      );
    }
    throw err;
  }
};

// ─────────────────────────────────────────────────────────
// ENTRY POINT
// ─────────────────────────────────────────────────────────
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

  if (divisi === "ALL") {
    return getBrowseAllDivisi(startDate, endDate, salesKode, cusKode);
  }

  if (!DIVISI_MAP[divisi]) {
    throw new Error(`Divisi "${divisi}" tidak dikenal.`);
  }

  return getBrowseSingleDivisi(divisi, startDate, endDate, salesKode, cusKode);
};

// ─────────────────────────────────────────────────────────
// SETTING — replikasi TfrmTargetSpk2. Beda dari browse laporan: pakai
// YEAR(spk_tanggal)=n (bukan rentang tanggal bebas), dan HANYA 1
// divisi per panggilan (tidak ada mode "ALL" di Setting — Target
// disimpan per kolom per divisi, jadi harus jelas divisi mana yang
// mau di-edit).
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

// ─────────────────────────────────────────────────────────
// UPDATE TARGET — tulis ke kolom dinamis cus_{tahun}{suffix}.
// targetCol dibangun dari whitelist DIVISI_MAP + tahun tervalidasi
// integer, jadi aman diselipkan langsung ke teks SQL (bukan dari
// input bebas user).
// ─────────────────────────────────────────────────────────
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

// ─────────────────────────────────────────────────────────
// UPDATE KODE SALES — replikasi TfrmTargetSpk2.cxGrdMasterEditValueChanged
// (cabang KODESALES) & cxGrdMasterEditKeyDown (F1). Validasi sales
// harus ada & aktif sebelum update, sesuai Delphi.
// ⚠️ tsales.sal_aktif divalidasi sebagai string 'Y' (turunan dari cek
// eksplisit .AsString='N' di edtSalesExit) — beda konvensi dari
// tcustomer.cus_aktif=0 di modul yang sama, sengaja dipertahankan
// per-tabel, bukan disamakan paksa.
// ─────────────────────────────────────────────────────────
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
  getSettingList,
  updateTarget,
  updateKodeSales,
  DIVISI_MAP,
  ALL_DIVISI_KEYS,
};
