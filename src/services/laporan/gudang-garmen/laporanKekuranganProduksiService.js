const db = require("../../../config/database");

const GUDANG_LIST = [
  "GP001",
  "GP002",
  "GP003",
  "GP004",
  "GP015",
  "GP017",
  "GP018",
  "GP019",
  "GP032",
];

const produksiLabelSql = (col) => `
  IF(${col} LIKE '%CETAK%', 'CETAK',
    IF(${col} LIKE '%BORDIR%', 'BORDIR',
      IF(${col} LIKE '%LIPAT%', 'LIPAT',
        IF(${col} LIKE '%JAHIT%', 'JAHIT',
          IF(${col} LIKE '%POTONG%', ' POTONG', ${col})))))
`;

const buildStatusFilter = (closedCol, status) => {
  if (status === "SUDAH") return `AND ${closedCol} <> 0`;
  if (status === "BELUM") return `AND ${closedCol} = 0`;
  return "";
};

// ─────────────────────────────────────────────
// DATA ROWS — transaksi mutasi + BPJ, di-SUM per (Nomor, Produksi).
// Filter tanggal SEKARANG diterapkan pada Tanggal SPK/MAP,
// agar selaras dengan ekspektasi user.
// ─────────────────────────────────────────────
const getDataRows = async (
  startDate,
  endDate,
  komponen,
  isMap,
  nomorSpk,
  namaSpk,
  status,
) => {
  const nomorCol = isMap ? "mspk_nomor" : "spk_nomor";
  const divisiCol = isMap ? "mspk_divisi" : "spk_divisi";
  const namaCol = isMap ? "mspk_nama" : "spk_nama";
  const kainCol = isMap ? "mspk_kain" : "spk_kain";
  const jumlahCol = isMap ? "mspk_jumlah" : "spk_jumlah";
  const kirimCol = isMap ? "mspk_jumlah_kirim" : "spk_jumlah_kirim";
  const jadiCol = isMap ? "mspk_jumlah_jadi" : "spk_jumlah_jadi";
  const tglCol = isMap ? "mspk_tanggal" : "spk_tanggal";
  const dlCol = isMap ? "mspk_dateline" : "spk_dateline";
  const closedCol = isMap ? "mspk_closed_produksi" : "spk_closed_produksi";
  const table = isMap ? "tmemospk" : "tspk";
  const alias = isMap ? "m" : "s";
  const mutasiJoinKey = isMap ? "m.mspk_nomor" : "s.spk_nomor";

  // Filter gabungan didorong ke query
  const extraFilter =
    ` AND ${alias}.${tglCol} >= ? AND ${alias}.${tglCol} <= ?` +
    (nomorSpk ? ` AND ${alias}.${nomorCol} = ?` : "") +
    (namaSpk ? ` AND ${alias}.${namaCol} LIKE ?` : "") +
    ` ${buildStatusFilter(`${alias}.${closedCol}`, status)}`;

  const extraParams = [`${startDate} 00:00:00`, `${endDate} 23:59:59`];
  if (nomorSpk) extraParams.push(nomorSpk);
  if (namaSpk) extraParams.push(`%${namaSpk}%`);

  const sql = `
    SELECT x.Nomor, MIN(x.Divisi) AS Divisi, MIN(x.Nama) AS Nama, MIN(x.Kain) AS Kain,
      MIN(x.Jumlah) AS Jumlah, MIN(x.Kirim) AS Kirim, MIN(x.Jadi) AS Jadi,
      MIN(x.Tanggal) AS Tanggal, MIN(x.Dateline) AS Dateline, MIN(x.Closed) AS Closed,
      x.Produksi, SUM(x.Qty) AS Sudah, MIN(x.Cab) AS Cab, MIN(x.Aktif) AS Aktif
    FROM (
      SELECT
        ${alias}.${nomorCol} AS Nomor, ${alias}.${divisiCol} AS Divisi,
        ${alias}.${namaCol} AS Nama, ${alias}.${kainCol} AS Kain,
        ${alias}.${jumlahCol} AS Jumlah, ${alias}.${kirimCol} AS Kirim,
        ${alias}.${jadiCol} AS Jadi,
        DATE_FORMAT(${alias}.${tglCol}, '%Y-%m-%d') AS Tanggal,
        DATE_FORMAT(${alias}.${dlCol}, '%Y-%m-%d') AS Dateline,
        IF(${alias}.${closedCol} = 0, 'Belum', 'Sudah') AS Closed,
        ${produksiLabelSql("b.gdgp_nama")} AS Produksi,
        d.mpd_jumlah AS Qty, h.mph_cab AS Cab, '' AS Aktif
      FROM tmutasiproduksi_hdr h
      INNER JOIN tmutasiproduksi_dtl d ON d.mpd_mph_nomor = h.mph_nomor
      INNER JOIN ${table} ${alias} ON ${mutasiJoinKey} = h.mph_spk_nomor
      INNER JOIN tbahan bh ON bh.bhn_kode = d.mpd_bhn_kode
      INNER JOIN tgudangproduksi b ON b.gdgp_kode = h.mph_gdgasal
      INNER JOIN tgudangproduksi c ON c.gdgp_kode = h.mph_gdgtujuan
      WHERE d.mpd_bhn_kode = ?
        AND b.gdgp_nama NOT LIKE '%QC%'
        ${extraFilter}
      UNION ALL
      SELECT
        ${alias}.${nomorCol}, ${alias}.${divisiCol}, ${alias}.${namaCol}, ${alias}.${kainCol},
        ${alias}.${jumlahCol}, ${alias}.${kirimCol}, ${alias}.${jadiCol},
        DATE_FORMAT(${alias}.${tglCol}, '%Y-%m-%d'),
        DATE_FORMAT(${alias}.${dlCol}, '%Y-%m-%d'),
        IF(${alias}.${closedCol} = 0, 'Belum', 'Sudah'),
        ${produksiLabelSql("gp.gdgp_nama")},
        d.bpjd_jumlah, h.bpj_cab, ''
      FROM tbpj_hdr h
      INNER JOIN tbpj_dtl d ON d.bpjd_bpj_nomor = h.bpj_nomor
      INNER JOIN tpojasa_hdr po ON po.pojh_nomor = h.bpj_po_nomor
      INNER JOIN ${table} ${alias} ON ${mutasiJoinKey} = po.pojh_spk_nomor
      INNER JOIN tbahan bh ON bh.bhn_kode = d.bpjd_bhn_kode
      INNER JOIN tjasa j ON j.jasa_kode = po.pojh_jasa_kode
      LEFT JOIN tgudangproduksi gp ON gp.gdgp_kode = j.jasa_gdgp_kode
      WHERE d.bpjd_bhn_kode = ?
        AND gp.gdgp_nama NOT LIKE '%QC%'
        ${extraFilter}
    ) x
    GROUP BY x.Nomor, x.Produksi
  `;

  const params = [komponen, ...extraParams, komponen, ...extraParams];

  const [rows] = await db.query(sql, params);
  return rows;
};

// ─────────────────────────────────────────────
// BASELINE ROWS — Penambahan Parameter Filter Tanggal
// ─────────────────────────────────────────────
const getBaselineRows = async (
  startDate,
  endDate,
  isMap,
  nomorSpk,
  namaSpk,
  status,
) => {
  const nomorCol = isMap ? "mspk_nomor" : "spk_nomor";
  const divisiCol = isMap ? "mspk_divisi" : "spk_divisi";
  const namaCol = isMap ? "mspk_nama" : "spk_nama";
  const kainCol = isMap ? "mspk_kain" : "spk_kain";
  const jumlahCol = isMap ? "mspk_jumlah" : "spk_jumlah";
  const kirimCol = isMap ? "mspk_jumlah_kirim" : "spk_jumlah_kirim";
  const jadiCol = isMap ? "mspk_jumlah_jadi" : "spk_jumlah_jadi";
  const tglCol = isMap ? "mspk_tanggal" : "spk_tanggal";
  const dlCol = isMap ? "mspk_dateline" : "spk_dateline";
  const closedCol = isMap ? "mspk_closed_produksi" : "spk_closed_produksi";
  const aktifCol = isMap ? "mspk_aktif" : "spk_aktif";
  const table = isMap ? "tmemospk" : "tspk";

  // Tambahkan filter tanggal pada baseline
  const extraFilter =
    ` AND s.${tglCol} >= ? AND s.${tglCol} <= ?` +
    (nomorSpk ? ` AND s.${nomorCol} = ?` : "") +
    (namaSpk ? ` AND s.${namaCol} LIKE ?` : "") +
    ` ${buildStatusFilter(`s.${closedCol}`, status)}`;

  const extraParams = [`${startDate} 00:00:00`, `${endDate} 23:59:59`];
  if (nomorSpk) extraParams.push(nomorSpk);
  if (namaSpk) extraParams.push(`%${namaSpk}%`);

  const placeholders = GUDANG_LIST.map(() => "?").join(",");
  const sql = `
    SELECT x.Nomor, MIN(x.Divisi) AS Divisi, MIN(x.Nama) AS Nama, MIN(x.Kain) AS Kain,
      MIN(x.Jumlah) AS Jumlah, MIN(x.Kirim) AS Kirim, MIN(x.Jadi) AS Jadi,
      MIN(x.Tanggal) AS Tanggal, MIN(x.Dateline) AS Dateline, MIN(x.Closed) AS Closed,
      x.Produksi, MIN(x.Aktif) AS Aktif
    FROM (
      SELECT
        s.${nomorCol} AS Nomor, s.${divisiCol} AS Divisi, s.${namaCol} AS Nama,
        s.${kainCol} AS Kain, s.${jumlahCol} AS Jumlah, s.${kirimCol} AS Kirim,
        s.${jadiCol} AS Jadi,
        DATE_FORMAT(s.${tglCol}, '%Y-%m-%d') AS Tanggal,
        DATE_FORMAT(s.${dlCol}, '%Y-%m-%d') AS Dateline,
        IF(s.${closedCol} = 0, 'Belum', 'Sudah') AS Closed,
        ${produksiLabelSql("gp.gdgp_nama")} AS Produksi,
        s.${aktifCol} AS Aktif
      FROM ${table} s
      LEFT JOIN tgudangproduksi gp ON gp.gdgp_kode IN (${placeholders})
      WHERE s.${aktifCol} = 'Y' AND s.${divisiCol} IN (3, 4, 6)
        ${extraFilter}
    ) x
    GROUP BY x.Nomor, x.Produksi
  `;
  const [rows] = await db.query(sql, [...GUDANG_LIST, ...extraParams]);
  return rows;
};

// ─────────────────────────────────────────────
// MASTER — Gabung
// ─────────────────────────────────────────────
const getBrowse = async (
  startDate,
  endDate,
  komponen = "LL-000400",
  nomorSpk = "",
  namaSpk = "",
  status = "ALL",
  isMap = false,
) => {
  const [dataRows, baselineRows] = await Promise.all([
    getDataRows(startDate, endDate, komponen, isMap, nomorSpk, namaSpk, status),
    // Pastikan startDate dan endDate dikirimkan ke getBaselineRows
    getBaselineRows(startDate, endDate, isMap, nomorSpk, namaSpk, status),
  ]);

  const dataMap = new Map();
  for (const row of dataRows) {
    dataMap.set(`${row.Nomor}||${row.Produksi}`, row);
  }

  const merged = [...dataRows];
  for (const row of baselineRows) {
    const key = `${row.Nomor}||${row.Produksi}`;
    if (!dataMap.has(key)) {
      merged.push({ ...row, Sudah: 0 });
    }
  }

  const result = merged
    .map((r) => ({
      Nomor: r.Nomor,
      Divisi: r.Divisi,
      Nama: r.Nama,
      Kain: r.Kain,
      Jumlah: r.Jumlah,
      Kirim: r.Kirim,
      KurangKirim: Number(r.Jumlah || 0) - Number(r.Kirim || 0),
      Jadi: r.Jadi,
      Tanggal: r.Tanggal,
      Dateline: r.Dateline,
      Closed: r.Closed,
      Produksi: r.Produksi,
      Sudah: Number(r.Sudah || 0),
      Kurang: Number(r.Jumlah || 0) - Number(r.Sudah || 0),
      Cab: r.Cab || "",
      Aktif: r.Aktif || "",
    }))
    .sort((a, b) => (a.Nomor > b.Nomor ? 1 : a.Nomor < b.Nomor ? -1 : 0));

  return result;
};

module.exports = {
  getBrowse,
};
