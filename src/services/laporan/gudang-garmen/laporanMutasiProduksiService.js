const db = require("../../../config/database");

// ─────────────────────────────────────────────
// Peta komponen DTF (khusus Kaosan) — direplikasi dari Delphi.
// Tiap baris tdtf punya 5 kolom kuantitas komponen (depan, belakang,
// lengan, variasi, saku); masing-masing diekspansi jadi baris
// "pseudo-mutasi" tersendiri kalau nilainya <> 0.
// ─────────────────────────────────────────────
const DTF_KOMPONEN_MAP = [
  { field: "depan", kode: "LL-000400", nama: "BADAN DEPAN" },
  { field: "belakang", kode: "LL-000401", nama: "BADAN BELAKANG" },
  { field: "lengan", kode: "LL-000404", nama: "TANGAN/LENGAN" },
  { field: "variasi", kode: "LL-000406", nama: "VARIASI" },
  { field: "saku", kode: "LL-000402", nama: "SAKU/KANTONG" },
];

const buildSpkNameExpr = () =>
  `IFNULL(sp.spk_nama, IFNULL(so.so_nama, mm.mspk_nama))`;
const buildSpkJumlahExpr = () =>
  `IFNULL(sp.spk_jumlah, IFNULL(so.so_jumlah, mm.mspk_jumlah))`;
const buildSpkJoExpr = () =>
  `IFNULL(sp.spk_jo_kode, IFNULL(so.so_jo_kode, mm.mspk_jo_kode))`;
// FIX: DATE_FORMAT langsung di SQL — mengirim string 'YYYY-MM-DD' apa
// adanya ke frontend, bukan objek Date mentah yang bisa digeser
// timezone browser saat di-parse ulang di JS.
const buildSpkTglExpr = () =>
  `DATE_FORMAT(IFNULL(sp.spk_tanggal, IFNULL(so.so_tanggal, mm.mspk_tanggal)), '%Y-%m-%d')`;
const buildSpkTipeExpr = () =>
  `IFNULL(sp.spk_tipe, IFNULL(so.so_tipe, mm.mspk_tipe))`;
const buildSpkDivisiExpr = () =>
  `IFNULL(sp.spk_divisi, IFNULL(so.so_divisi, mm.mspk_divisi))`;
const buildSpkJoinFallback = (kodeExpr) => `
  LEFT JOIN tspk sp ON sp.spk_nomor = ${kodeExpr}
  LEFT JOIN tsalesorder so ON so.so_nomor = ${kodeExpr}
  LEFT JOIN tmemospk mm ON mm.mspk_nomor = ${kodeExpr}
`;
// Divisi harus di-JOIN pakai kode yang sama seperti buildSpkDivisiExpr(),
// tapi karena alias itu dipakai berulang di banyak tempat, JOIN-nya
// pakai subquery kode divisi langsung.
const buildDivisiJoin = () =>
  `LEFT JOIN tdivisi v ON v.kode = ${buildSpkDivisiExpr()}`;

// ─────────────────────────────────────────────
// SUMBER 1: Mutasi Produksi (tmutasiproduksi_hdr/_dtl)
// ─────────────────────────────────────────────
const getMutasiSource = async (startDate, endDate, cab, nomorSpk, namaSpk) => {
  let where = `WHERE h.mph_tanggal >= ? AND h.mph_tanggal <= ?`;
  const params = [startDate, endDate];
  if (cab && cab !== "ALL") {
    where += ` AND h.mph_cab = ?`;
    params.push(cab);
  }
  if (nomorSpk) {
    where += ` AND h.mph_spk_nomor = ?`;
    params.push(nomorSpk);
  } else if (namaSpk) {
    where += ` AND ${buildSpkNameExpr()} LIKE ?`;
    params.push(`%${namaSpk}%`);
  }

  const sql = `
    SELECT
      h.mph_spk_nomor AS Nomor,
      ${buildSpkNameExpr()} AS NamaSpk,
      ${buildSpkJumlahExpr()} AS JumlahSpk,
      ${buildSpkJoExpr()} AS JoKode,
      ${buildSpkTglExpr()} AS TglSpk,
      ${buildSpkTipeExpr()} AS Tipe,
      ${buildSpkDivisiExpr()} AS Divisi,
      v.divisi AS DivisiNama,
      h.mph_nomor AS NomorMutasi,
      h.mph_nomaterial AS NoPermintaan,
      h.mph_qty_berat AS Terpakai,
      IF(h.mph_jumlah <> 0 AND h.mph_qty_berat <> 0,
        IF(h.mph_sat_berat = 'KG', h.mph_jumlah / h.mph_qty_berat, h.mph_qty_berat / h.mph_jumlah),
        0
      ) AS Babaran,
      h.mph_kelompok AS Kelompok,
      ga.gdgp_nama AS GudangAsal,
      gt.gdgp_nama AS GudangTujuan,
      DATE_FORMAT(h.mph_tanggal, '%Y-%m-%d') AS TanggalMutasi,
      d.mpd_bhn_kode AS Kode,
      b.bhn_name AS Komponen,
      d.mpd_jumlah AS Jumlah,
      d.mpd_jumlah_bs AS BsLini,
      d.mpd_jumlah_sablon AS BsKainSablon,
      d.mpd_jumlah_kain AS BsKain,
      d.mpd_satuan AS Satuan,
      d.mpd_size AS Size,
      h.mph_asal_kerjaan AS Cab
    FROM tmutasiproduksi_hdr h
    INNER JOIN tmutasiproduksi_dtl d ON d.mpd_mph_nomor = h.mph_nomor
    ${buildSpkJoinFallback("h.mph_spk_nomor")}
    ${buildDivisiJoin()}
    LEFT JOIN tbahan b ON b.bhn_kode = d.mpd_bhn_kode
    LEFT JOIN tgudangproduksi ga ON ga.gdgp_kode = h.mph_gdgasal
    LEFT JOIN tgudangproduksi gt ON gt.gdgp_kode = h.mph_gdgtujuan
    ${where}
  `;
  const [rows] = await db.query(sql, params);
  return rows;
};

// ─────────────────────────────────────────────
// SUMBER 2: BPJ Jasa (proses jasa luar/outsource)
// ─────────────────────────────────────────────
const getBpjSource = async (startDate, endDate, cab, nomorSpk, namaSpk) => {
  let where = `WHERE h.bpj_tanggal >= ? AND h.bpj_tanggal <= ?`;
  const params = [startDate, endDate];
  if (cab && cab !== "ALL") {
    where += ` AND h.bpj_cab = ?`;
    params.push(cab);
  }
  if (nomorSpk) {
    where += ` AND po.pojh_spk_nomor = ?`;
    params.push(nomorSpk);
  } else if (namaSpk) {
    where += ` AND ${buildSpkNameExpr()} LIKE ?`;
    params.push(`%${namaSpk}%`);
  }

  const sql = `
    SELECT
      po.pojh_spk_nomor AS Nomor,
      ${buildSpkNameExpr()} AS NamaSpk,
      ${buildSpkJumlahExpr()} AS JumlahSpk,
      ${buildSpkJoExpr()} AS JoKode,
      ${buildSpkTglExpr()} AS TglSpk,
      ${buildSpkTipeExpr()} AS Tipe,
      ${buildSpkDivisiExpr()} AS Divisi,
      v.divisi AS DivisiNama,
      h.bpj_nomor AS NomorMutasi,
      '' AS NoPermintaan,
      0 AS Terpakai,
      0 AS Babaran,
      '' AS Kelompok,
      g.gdgp_nama AS GudangAsal,
      '' AS GudangTujuan,
      DATE_FORMAT(h.bpj_tanggal, '%Y-%m-%d') AS TanggalMutasi,
      d.bpjd_bhn_kode AS Kode,
      b.bhn_name AS Komponen,
      d.bpjd_jumlah AS Jumlah,
      d.bpjd_bs AS BsLini,
      0 AS BsKainSablon,
      d.bpjd_bs_kain AS BsKain,
      d.bpjd_bhn_satuan AS Satuan,
      d.bpjd_size AS Size,
      h.bpj_cab AS Cab
    FROM tbpj_hdr h
    INNER JOIN tbpj_dtl d ON d.bpjd_bpj_nomor = h.bpj_nomor
    INNER JOIN tpojasa_hdr po ON po.pojh_nomor = h.bpj_po_nomor
    ${buildSpkJoinFallback("po.pojh_spk_nomor")}
    ${buildDivisiJoin()}
    LEFT JOIN tbahan b ON b.bhn_kode = d.bpjd_bhn_kode
    LEFT JOIN tjasa j ON j.jasa_kode = po.pojh_jasa_kode
    LEFT JOIN tgudangproduksi g ON g.gdgp_kode = j.jasa_gdgp_kode
    ${where}
  `;
  const [rows] = await db.query(sql, params);
  return rows;
};

// ─────────────────────────────────────────────
// SUMBER 3: DTF (khusus Kaosan, tdtf) — ekspansi komponen di JS,
// menggantikan pola CREATE TEMPORARY TABLE + INSERT loop Delphi.
// ─────────────────────────────────────────────
const getDtfSource = async (startDate, endDate, cab, nomorSpk) => {
  let where = `WHERE f.tanggal >= ? AND f.tanggal <= ?`;
  const params = [startDate, endDate];
  if (cab && cab !== "ALL") {
    where += ` AND f.cab = ?`;
    params.push(cab);
  }
  if (nomorSpk) {
    where += ` AND f.spk_nomor = ?`;
    params.push(nomorSpk);
  }

  const sql = `
    SELECT
      f.spk_nomor AS Nomor,
      ${buildSpkNameExpr()} AS NamaSpk,
      ${buildSpkJumlahExpr()} AS JumlahSpk,
      ${buildSpkJoExpr()} AS JoKode,
      ${buildSpkTglExpr()} AS TglSpk,
      ${buildSpkTipeExpr()} AS Tipe,
      ${buildSpkDivisiExpr()} AS Divisi,
      v.divisi AS DivisiNama,
      DATE_FORMAT(f.tanggal, '%Y-%m-%d') AS TanggalMutasi,
      f.cab AS Cab,
      f.keterangan AS Keterangan,
      f.depan, f.belakang, f.lengan, f.variasi, f.saku
    FROM tdtf f
    ${buildSpkJoinFallback("f.spk_nomor")}
    ${buildDivisiJoin()}
    ${where}
  `;
  const [rawRows] = await db.query(sql, params);

  const result = [];
  for (const r of rawRows) {
    const isDualProses = r.Keterangan === "CETAK DTF & PRES DTF";
    const prosesList = isDualProses ? [1, 2] : [1];

    let cetakTipe = "DTF";
    if (r.Keterangan?.includes("DTG")) cetakTipe = "DTG";
    else if (r.Keterangan?.includes("PLASTISOL")) cetakTipe = "PLASTISOL";

    for (const a of prosesList) {
      let kelompok;
      if (isDualProses) {
        kelompok = a === 1 ? "CETAK DTF" : "PRES DTF";
      } else if (r.Keterangan === "CETAK DTG") kelompok = "CETAK DTG";
      else if (r.Keterangan === "CETAK PLASTISOL") kelompok = "CETAK PLASTISOL";
      else if (r.Keterangan === "CETAK DTF") kelompok = "CETAK DTF";
      else kelompok = "PRES DTF";

      const isCetak = ["CETAK DTF", "CETAK DTG", "CETAK PLASTISOL"].includes(
        kelompok,
      );
      const gudangAsal = isCetak
        ? r.Cab === "P01"
          ? "03.GD CETAK P1"
          : "03.GD CETAK P4"
        : r.Cab === "P01"
          ? "03.GD PRES DTF P1"
          : "03.GD PRES DTF P4";
      const gudangTujuan =
        r.Cab === "P01" ? "08.GD QC CETAK P1" : "08.GD QC CETAK P4";

      for (const komp of DTF_KOMPONEN_MAP) {
        const jumlah = Number(r[komp.field]) || 0;
        if (jumlah === 0) continue;
        result.push({
          Nomor: r.Nomor,
          NamaSpk: r.NamaSpk,
          JumlahSpk: r.JumlahSpk,
          JoKode: r.JoKode,
          TglSpk: r.TglSpk,
          Tipe: r.Tipe,
          Divisi: r.Divisi,
          DivisiNama: r.DivisiNama,
          NomorMutasi: cetakTipe,
          NoPermintaan: "",
          Terpakai: 0,
          Babaran: 0,
          Kelompok: kelompok,
          GudangAsal: gudangAsal,
          GudangTujuan: gudangTujuan,
          TanggalMutasi: r.TanggalMutasi,
          Kode: komp.kode,
          Komponen: komp.nama,
          Jumlah: jumlah,
          BsLini: 0,
          BsKainSablon: 0,
          BsKain: 0,
          Satuan: "PCS",
          Size: "",
          Cab: r.Cab,
        });
      }
    }
  }
  return result;
};

// ─────────────────────────────────────────────
// SUMBER 4: STBJ (Surat Terima Barang Jadi, komponen tetap
// LL-000400 "BADAN DEPAN" — sesuai hardcode Delphi)
// ─────────────────────────────────────────────
const getStbjSource = async (startDate, endDate, cab, nomorSpk, namaSpk) => {
  let where = `WHERE h.stbj_tanggal >= ? AND h.stbj_tanggal <= ?
    AND h.stbj_gdg_kode IN (SELECT gdg_kode FROM tgudang WHERE gdg_jadi = 4)`;
  const params = [startDate, endDate];
  if (cab && cab !== "ALL") {
    where += ` AND h.stbj_gdgp_kode IN (SELECT gdgp_kode FROM tgudangproduksi WHERE gdgp_cab = ?)`;
    params.push(cab);
  }
  if (nomorSpk) {
    where += ` AND d.stbjd_spk_nomor = ?`;
    params.push(nomorSpk);
  } else if (namaSpk) {
    where += ` AND ${buildSpkNameExpr()} LIKE ?`;
    params.push(`%${namaSpk}%`);
  }

  const sql = `
    SELECT
      d.stbjd_spk_nomor AS Nomor,
      ${buildSpkNameExpr()} AS NamaSpk,
      ${buildSpkJumlahExpr()} AS JumlahSpk,
      ${buildSpkJoExpr()} AS JoKode,
      ${buildSpkTglExpr()} AS TglSpk,
      ${buildSpkTipeExpr()} AS Tipe,
      ${buildSpkDivisiExpr()} AS Divisi,
      v.divisi AS DivisiNama,
      h.stbj_nomor AS NomorMutasi,
      '' AS NoPermintaan,
      0 AS Terpakai,
      0 AS Babaran,
      '' AS Kelompok,
      g.gdgp_nama AS GudangAsal,
      '' AS GudangTujuan,
      DATE_FORMAT(h.stbj_tanggal, '%Y-%m-%d') AS TanggalMutasi,
      'LL-000400' AS Kode,
      'BADAN DEPAN' AS Komponen,
      d.stbjd_jumlah AS Jumlah,
      0 AS BsLini,
      0 AS BsKainSablon,
      0 AS BsKain,
      '' AS Satuan,
      '' AS Size,
      '' AS Cab
    FROM tstbj_hdr h
    INNER JOIN tstbj_dtl d ON d.stbjd_stbj_nomor = h.stbj_nomor
    ${buildSpkJoinFallback("d.stbjd_spk_nomor")}
    ${buildDivisiJoin()}
    LEFT JOIN tgudangproduksi g ON g.gdgp_kode = h.stbj_gdgp_kode
    ${where}
  `;
  const [rows] = await db.query(sql, params);
  return rows;
};

// ─────────────────────────────────────────────
// MASTER — gabungan 4 sumber, sorted by Nomor + GudangAsal
// (sesuai ORDER BY spk_nomor, gudang_asal di Delphi)
// ─────────────────────────────────────────────
const getBrowse = async (filters) => {
  const {
    startDate,
    endDate,
    cab = "ALL",
    nomorSpk = "",
    namaSpk = "",
  } = filters;

  const [mutasi, bpj, dtf, stbj] = await Promise.all([
    getMutasiSource(startDate, endDate, cab, nomorSpk, namaSpk),
    getBpjSource(startDate, endDate, cab, nomorSpk, namaSpk),
    getDtfSource(startDate, endDate, cab, nomorSpk),
    getStbjSource(startDate, endDate, cab, nomorSpk, namaSpk),
  ]);

  const combined = [...mutasi, ...bpj, ...dtf, ...stbj];
  combined.sort((a, b) => {
    const byNomor = String(a.Nomor || "").localeCompare(String(b.Nomor || ""));
    if (byNomor !== 0) return byNomor;
    return String(a.GudangAsal || "").localeCompare(String(b.GudangAsal || ""));
  });
  return combined;
};

module.exports = {
  getBrowse,
};
