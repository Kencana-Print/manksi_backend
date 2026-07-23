const db = require("../../../config/database");

const BHN_MARKER = "LL-000400";

const GUDANG_FIELD_MAP = {
  GP001: "potong",
  GP015: "potong",
  GP002: "cetak",
  GP017: "cetak",
  GP009: "hot",
  GP027: "hot",
  GP010: "qccetak",
  GP022: "qccetak",
  GP032: "dc",
  GP003: "jahit",
  GP018: "jahit",
  GP004: "lipat",
  GP019: "lipat",
};

const emptyRow = () => ({
  ipotong: 0,
  opotong: 0,
  potong: 0,
  icetak: 0,
  ocetak: 0,
  cetak: 0,
  ihot: 0,
  ohot: 0,
  hot: 0,
  iqccetak: 0,
  oqccetak: 0,
  qccetak: 0,
  idc: 0,
  odc: 0,
  dc: 0,
  ijahit: 0,
  ojahit: 0,
  jahit: 0,
  ilipat: 0,
  olipat: 0,
  lipat: 0,
});

// ─────────────────────────────────────────────
// Bangun map SPK → data lengkap, replikasi persis alur temp-table
// Delphi (base insert → PO internal masuk/keluar → mutasi
// [overwrite] → BPJ [tambah]).
// ─────────────────────────────────────────────
const buildDataMap = async (startDate, cab) => {
  const baseSql = `
    SELECT
      s.spk_nomor AS Spk,
      DATE_FORMAT(s.spk_tanggal, '%Y-%m-%d') AS Tanggal,
      DATE_FORMAT(s.spk_dateline, '%Y-%m-%d') AS Dateline,
      IFNULL(s.spk_cab, '') AS Cab,
      v.divisi AS Divisi,
      s.spk_nama AS Nama,
      s.spk_finishing AS Finishing,
      s.spk_jumlah AS JmlSpk,
      s.spk_sablon AS CSablon,
      s.spk_bordir AS CBordir,
      s.spk_sublim AS CSublim
    FROM tspk s
    LEFT JOIN tdivisi v ON v.kode = s.spk_divisi
    WHERE s.spk_cmo <> '' AND s.spk_aktif = 'Y' AND s.spk_close = 0
      AND s.spk_cab IN ('P01', 'P04')
      AND s.spk_tanggal >= ?
  `;
  const [baseRows] = await db.query(baseSql, [startDate]);

  const map = new Map();
  for (const r of baseRows) {
    map.set(r.Spk, { ...r, ...emptyRow() });
  }
  if (map.size === 0) return map;

  const spkList = [...map.keys()];

  // ── PO Internal (cuma kalau cab bukan ALL) ──
  if (cab && cab !== "ALL") {
    const sqlMasuk = `
      SELECT h.poi_spk_nomor AS Spk, j.jasa_ket AS JasaKet, SUM(d.poid_jumlah) AS Jml
      FROM tpointernal_hdr h
      INNER JOIN tpointernal_dtl d ON d.poid_nomor = h.poi_nomor
      LEFT JOIN tjasa j ON j.jasa_kode = h.poi_jasa_kode
      WHERE h.poi_sup = ? AND d.poid_bhn_kode = ? AND h.poi_tanggal >= ?
      GROUP BY h.poi_spk_nomor, j.jasa_ket
    `;
    const [masukRows] = await db.query(sqlMasuk, [cab, BHN_MARKER, startDate]);
    for (const r of masukRows) {
      const row = map.get(r.Spk);
      if (!row) continue;
      if (r.JasaKet === "POTONG") row.ipotong = Number(r.Jml);
      else if (["CETAK", "SUBLIM", "SABLON"].includes(r.JasaKet))
        row.icetak = Number(r.Jml);
      else if (r.JasaKet === "JAHIT") row.ijahit = Number(r.Jml);
    }

    const sqlKeluar = `
      SELECT h.poi_spk_nomor AS Spk, j.jasa_ket AS JasaKet, SUM(d.poid_jumlah) AS Jml
      FROM tpointernal_hdr h
      INNER JOIN tpointernal_dtl d ON d.poid_nomor = h.poi_nomor
      LEFT JOIN tjasa j ON j.jasa_kode = h.poi_jasa_kode
      WHERE h.poi_cab = ? AND d.poid_bhn_kode = ? AND h.poi_tanggal >= ?
      GROUP BY h.poi_spk_nomor, j.jasa_ket
    `;
    const [keluarRows] = await db.query(sqlKeluar, [
      cab,
      BHN_MARKER,
      startDate,
    ]);
    for (const r of keluarRows) {
      const row = map.get(r.Spk);
      if (!row) continue;
      if (r.JasaKet === "POTONG") row.opotong = Number(r.Jml);
      else if (["CETAK", "SUBLIM", "SABLON"].includes(r.JasaKet))
        row.ocetak = Number(r.Jml);
      else if (r.JasaKet === "JAHIT") row.ojahit = Number(r.Jml);
    }
  }

  // ── Mutasi Produksi — OVERWRITE ──
  let sqlMutasi = `
    SELECT mph_spk_nomor AS Spk, mph_gdgasal AS Gudang, SUM(mpd_jumlah) AS Jml
    FROM tmutasiproduksi_hdr
    INNER JOIN tmutasiproduksi_dtl ON mpd_mph_nomor = mph_nomor
    WHERE mpd_bhn_kode = ?
      AND mph_spk_nomor IN (?)
      AND mph_tanggal >= ?
  `;
  const mutasiParams = [BHN_MARKER, spkList, startDate];
  if (cab && cab !== "ALL") {
    sqlMutasi += ` AND mph_cab = ?`;
    mutasiParams.push(cab);
  }
  sqlMutasi += ` GROUP BY mph_spk_nomor, mph_gdgasal`;
  const [mutasiRows] = await db.query(sqlMutasi, mutasiParams);
  for (const r of mutasiRows) {
    const field = GUDANG_FIELD_MAP[r.Gudang];
    const row = map.get(r.Spk);
    if (!field || !row) continue;
    row[field] = Number(r.Jml);
  }

  // ── BPJ (jasa luar/CMT) — TAMBAH ──
  let sqlBpj = `
    SELECT bpjd_spk AS Spk, bpjd_gdgp_asal AS Gudang, SUM(bpjd_Jumlah) AS Jml
    FROM tbpj_hdr
    INNER JOIN tbpj_dtl ON bpjd_bpj_Nomor = bpj_Nomor
    WHERE bpjd_bhn_kode = ?
      AND bpjd_spk IN (?)
      AND bpj_tanggal >= ?
  `;
  const bpjParams = [BHN_MARKER, spkList, startDate];
  if (cab && cab !== "ALL") {
    sqlBpj += ` AND bpj_cab = ?`;
    bpjParams.push(cab);
  }
  sqlBpj += ` GROUP BY bpjd_spk, bpjd_gdgp_asal`;
  const [bpjRows] = await db.query(sqlBpj, bpjParams);
  for (const r of bpjRows) {
    const field = GUDANG_FIELD_MAP[r.Gudang];
    const row = map.get(r.Spk);
    if (!field || !row) continue;
    row[field] += Number(r.Jml);
  }

  // ── Kedatangan Bahan Cuting (batched, bukan N+1) ──
  let sqlKedatangan = `
    SELECT h.promin_spk_nomor AS Spk, SUM(d.promind_Jumlah) AS Jml
    FROM tproduksiminta_hdr h
    INNER JOIN tproduksiminta_dtl d ON d.promind_promin_Nomor = h.promin_nomor
    WHERE h.promin_spk_nomor IN (?)
  `;
  const kedatanganParams = [spkList];
  if (cab === "P01") {
    sqlKedatangan += ` AND h.promin_gdgp_kode = 'GP015'`;
  } else if (cab === "P04") {
    sqlKedatangan += ` AND h.promin_gdgp_kode = 'GP001'`;
  }
  sqlKedatangan += ` GROUP BY h.promin_spk_nomor`;
  const [kedatanganRows] = await db.query(sqlKedatangan, kedatanganParams);
  const kedatanganMap = new Map(
    kedatanganRows.map((r) => [r.Spk, Number(r.Jml)]),
  );
  for (const [spk, row] of map) {
    row.KedatanganBahanCuting = kedatanganMap.get(spk) || 0;
  }

  return map;
};

// ─────────────────────────────────────────────
// Hitung kolom tampilan final per baris, sesuai formula cabang
// (P01/P04/ALL) — replikasi persis 3 varian SELECT di Delphi.
// ─────────────────────────────────────────────
const computeDisplayRow = (row, cab) => {
  const noProses =
    row.CBordir === "N" && row.CSablon === "N" && row.CSublim === "N";
  const bordirOnly =
    row.CBordir === "Y" && row.CSablon === "N" && row.CSublim === "N";

  let Potong, Cetak, HotPres, QcCetak, DC, Jahit, Lipat;

  if (cab === "P01" || cab === "P04") {
    const other = cab === "P01" ? "P04" : "P01";
    const isOtherCab = row.Cab === other;

    Potong =
      row.ipotong === 0 && isOtherCab
        ? 0
        : row.ipotong !== 0 && isOtherCab
          ? row.ipotong - row.potong
          : row.JmlSpk - row.potong - row.opotong;

    const cetakBase =
      row.icetak === 0 && isOtherCab
        ? 0
        : row.icetak !== 0 && isOtherCab
          ? row.icetak - row.cetak
          : row.JmlSpk - row.cetak - row.ocetak;
    Cetak = noProses || bordirOnly ? 0 : cetakBase;

    const hotBase =
      row.ihot === 0 && isOtherCab
        ? 0
        : row.ihot !== 0 && isOtherCab
          ? row.ihot - row.hot
          : row.JmlSpk - row.hot - row.ohot;
    HotPres = noProses || bordirOnly ? 0 : hotBase;

    const qcBase =
      row.iqccetak === 0 && isOtherCab
        ? 0
        : row.iqccetak !== 0 && isOtherCab
          ? row.iqccetak - row.qccetak
          : row.JmlSpk - row.qccetak - row.oqccetak;
    QcCetak = noProses ? 0 : qcBase;

    DC =
      row.idc === 0 && isOtherCab
        ? 0
        : row.idc !== 0 && isOtherCab
          ? row.idc - row.dc
          : row.JmlSpk - row.dc - row.odc;

    Jahit =
      row.ijahit === 0 && isOtherCab
        ? 0
        : row.ijahit !== 0 && isOtherCab
          ? row.ijahit - row.jahit
          : row.JmlSpk - row.jahit - row.ojahit;

    Lipat =
      row.ilipat === 0 && isOtherCab
        ? 0
        : row.ilipat !== 0 && isOtherCab
          ? row.ilipat - row.lipat
          : row.JmlSpk - row.lipat - row.olipat;
  } else {
    // ALL
    Potong = row.JmlSpk - row.potong;
    Cetak = noProses || bordirOnly ? 0 : row.JmlSpk - row.cetak;
    HotPres = noProses || bordirOnly ? 0 : row.JmlSpk - row.hot;

    const qcAllBase =
      row.iqccetak === 0 && row.Cab === "P04"
        ? 0
        : row.iqccetak !== 0 && row.Cab === "P04"
          ? row.iqccetak - row.qccetak
          : row.JmlSpk - row.qccetak;
    QcCetak = noProses ? 0 : qcAllBase;

    DC = row.JmlSpk - row.dc;
    Jahit = row.JmlSpk - row.jahit;
    Lipat = row.JmlSpk - row.lipat;
  }

  return {
    Spk: row.Spk,
    Tanggal: row.Tanggal,
    Dateline: row.Dateline,
    Cab: row.Cab,
    Divisi: row.Divisi,
    Nama: row.Nama,
    Finishing: row.Finishing,
    JmlSpk: row.JmlSpk,
    Potong,
    Cetak,
    HotPres,
    QcCetak,
    DC,
    Jahit,
    Lipat,
    KedatanganBahanCuting: row.KedatanganBahanCuting,
    // raw i/o — dipakai khusus buat Export to Excel format lama
    IPotong: row.ipotong,
    ICetak: row.icetak,
    IHot: row.ihot,
    IQcCetak: row.iqccetak,
    IJahit: row.ijahit,
    ILipat: row.ilipat,
  };
};

// ─────────────────────────────────────────────
// MASTER — filter baris sesuai WHERE cab-specific di Delphi
// ─────────────────────────────────────────────
const getBrowse = async (startDate, cab = "P04") => {
  const map = await buildDataMap(startDate, cab);
  const rows = [...map.values()];

  let filtered;
  if (cab === "P01") {
    filtered = rows.filter(
      (r) =>
        r.Cab === "P01" ||
        (r.Cab === "P04" &&
          r.ipotong + r.icetak + r.iqccetak + r.ijahit + r.ilipat !== 0),
    );
  } else if (cab === "P04") {
    filtered = rows.filter(
      (r) =>
        r.Cab === "P04" ||
        r.Cab === "MT1" ||
        (r.Cab === "P01" &&
          r.ipotong + r.icetak + r.iqccetak + r.ijahit + r.ilipat !== 0),
    );
  } else {
    filtered = rows;
  }

  const display = filtered.map((r) => computeDisplayRow(r, cab));
  display.sort((a, b) =>
    a.Tanggal > b.Tanggal ? 1 : a.Tanggal < b.Tanggal ? -1 : 0,
  );
  return display;
};

// ─────────────────────────────────────────────
// STANDAR OUTPUT — dipakai khusus buat Export to Excel format lama
// ─────────────────────────────────────────────
const getStandarOutput = async () => {
  const [rows] = await db.query(`SELECT * FROM tstandar_output LIMIT 1`);
  const r = rows[0] || {};
  return {
    potong: Number(r.potong || 0),
    cetak: Number(r.cetak || 0),
    bordir: Number(r.bordir || 0),
    hotpres: Number(r.hotpres || 0),
    qccetak: Number(r.qccetak || 0),
    dc: Number(r.dc || 0),
    jahit: Number(r.jahit || 0),
    lipat: Number(r.lipat || 0),
  };
};

module.exports = {
  getBrowse,
  getStandarOutput,
};
