const db = require("../../../config/database");

// ─────────────────────────────────────────────
// HELPER: mapping gudang asal → field prefix (kain/sablon/lini per
// tahap produksi), sesuai persis Delphi.
// ─────────────────────────────────────────────
const GDG_STAGE_MAP = {
  GP001: "cuting",
  GP012: "qccuting",
  GP014: "bordir",
  GP002: "cetak",
  GP010: "qccetak",
  GP003: "jahit",
};
const GDG_BS = ["GP001", "GP012", "GP014", "GP002", "GP010", "GP003"];

// ✅ BUG FIXED (sesuai konfirmasi): GP001 (Cuting) ditambahkan ke
// daftar tujuan Ganti BS yang dihitung — sebelumnya di Delphi WHERE
// excludes GP001 padahal ada IF-branch buat gantibs_cuting (dead
// code, selalu 0).
const GDG_GANTI_BS_TUJUAN = ["GP001", "GP002", "GP014", "GP003"];
const GANTI_BS_FIELD_MAP = {
  GP001: "cuting",
  GP002: "cetak",
  GP014: "bordir",
  GP003: "jahit",
};

// ─────────────────────────────────────────────
// MASTER — SPK aktif yang punya transaksi BS (kain/sablon/lini/
// gantibs <> 0) dalam mutasi produksi.
// ─────────────────────────────────────────────
const getBrowse = async (startDate, cab = "P04") => {
  let cabFilter = "";
  const params = [];
  if (cab && cab !== "ALL") {
    cabFilter = "AND s.spk_cab = ?";
    params.push(cab);
  }
  params.push(startDate);

  const sql = `
    SELECT
      s.spk_nomor AS SPK,
      DATE_FORMAT(s.spk_tanggal, '%Y-%m-%d') AS TglSPK,
      s.spk_cab AS Cab,
      v.divisi AS Divisi,
      s.spk_nama AS Nama,
      s.spk_finishing AS Finishing
    FROM tspk s
    LEFT JOIN tdivisi v ON v.kode = s.spk_divisi
    WHERE s.spk_aktif = 'Y' AND s.spk_cmo <> ''
      ${cabFilter}
      AND s.spk_tanggal >= ?
      AND s.spk_nomor IN (
        SELECT DISTINCT d.mpd_spk FROM tmutasiproduksi_dtl d
        WHERE (d.mpd_jumlah_bs + d.mpd_jumlah_sablon + d.mpd_jumlah_kain + d.mpd_gantibs) <> 0
      )
    ORDER BY s.spk_nama
  `;
  const [rows] = await db.query(sql, params);
  return rows;
};

// ─────────────────────────────────────────────
// DETAIL — per SPK, pivot per komponen (bhn_kode) x tahap produksi
// (Cuting/QcCuting/Bordir/Cetak/QcCetak/Jahit) x jenis BS
// (Kain/Sablon/Lini), plus Ganti BS per tahap tujuan.
// Diimplementasikan sebagai agregat langsung (bukan CREATE TEMP
// TABLE + loop insert ala Delphi — gak diperlukan di MySQL modern).
// ─────────────────────────────────────────────
const getDetail = async (spk) => {
  // ── Data BS per tahap (dari tmutasiproduksi_dtl, gdgp_asal) ──
  const bsSql = `
    SELECT d.mpd_bhn_kode AS Kode, d.mpd_gdgp_asal AS Gudang,
      SUM(d.mpd_jumlah_kain) AS BsKain,
      SUM(d.mpd_jumlah_sablon) AS BsSablon,
      SUM(d.mpd_jumlah_bs) AS BsLini
    FROM tmutasiproduksi_dtl d
    WHERE (d.mpd_jumlah_bs + d.mpd_jumlah_sablon + d.mpd_jumlah_kain) <> 0
      AND d.mpd_gdgp_asal IN (?)
      AND d.mpd_spk = ?
    GROUP BY d.mpd_bhn_kode, d.mpd_gdgp_asal
  `;
  const [bsRows] = await db.query(bsSql, [GDG_BS, spk]);

  // ── Ganti BS per tahap tujuan (dari tmutasiproduksi_hdr, asal
  // selalu GP012/QC Cutting) ──
  const gantiBsSql = `
    SELECT h.mph_gdgtujuan AS Tujuan, d.mpd_bhn_kode AS Kode,
      SUM(d.mpd_gantibs) AS Jml
    FROM tmutasiproduksi_hdr h
    INNER JOIN tmutasiproduksi_dtl d ON d.mpd_mph_nomor = h.mph_nomor
    WHERE h.mph_gdgasal = 'GP012' AND h.mph_gdgtujuan IN (?)
      AND d.mpd_gantibs <> 0
      AND h.mph_spk_nomor = ?
    GROUP BY h.mph_gdgtujuan, d.mpd_bhn_kode
  `;
  const [gantiBsRows] = await db.query(gantiBsSql, [GDG_GANTI_BS_TUJUAN, spk]);

  // ── Gabungkan per Kode (komponen) ──
  const dataMap = new Map();
  const ensureRow = (kode) => {
    if (!dataMap.has(kode)) {
      dataMap.set(kode, {
        Kode: kode,
        KainCuting: 0,
        SablonCuting: 0,
        LiniCuting: 0,
        KainQcCuting: 0,
        SablonQcCuting: 0,
        LiniQcCuting: 0,
        KainBordir: 0,
        SablonBordir: 0,
        LiniBordir: 0,
        KainCetak: 0,
        SablonCetak: 0,
        LiniCetak: 0,
        KainQcCetak: 0,
        SablonQcCetak: 0,
        LiniQcCetak: 0,
        KainJahit: 0,
        SablonJahit: 0,
        LiniJahit: 0,
        GantiBsCuting: 0,
        GantiBsCetak: 0,
        GantiBsBordir: 0,
        GantiBsJahit: 0,
      });
    }
    return dataMap.get(kode);
  };

  for (const r of bsRows) {
    const stage = GDG_STAGE_MAP[r.Gudang];
    if (!stage) continue;
    const row = ensureRow(r.Kode);
    if (stage === "cuting") {
      row.KainCuting += Number(r.BsKain);
      row.SablonCuting += Number(r.BsSablon);
      row.LiniCuting += Number(r.BsLini);
    } else if (stage === "qccuting") {
      row.KainQcCuting += Number(r.BsKain);
      row.SablonQcCuting += Number(r.BsSablon);
      row.LiniQcCuting += Number(r.BsLini);
    } else if (stage === "bordir") {
      row.KainBordir += Number(r.BsKain);
      row.SablonBordir += Number(r.BsSablon);
      row.LiniBordir += Number(r.BsLini);
    } else if (stage === "cetak") {
      row.KainCetak += Number(r.BsKain);
      row.SablonCetak += Number(r.BsSablon);
      row.LiniCetak += Number(r.BsLini);
    } else if (stage === "qccetak") {
      row.KainQcCetak += Number(r.BsKain);
      row.SablonQcCetak += Number(r.BsSablon);
      row.LiniQcCetak += Number(r.BsLini);
    } else if (stage === "jahit") {
      row.KainJahit += Number(r.BsKain);
      row.SablonJahit += Number(r.BsSablon);
      row.LiniJahit += Number(r.BsLini);
    }
  }

  for (const r of gantiBsRows) {
    const field = GANTI_BS_FIELD_MAP[r.Tujuan];
    if (!field) continue;
    const row = ensureRow(r.Kode);
    if (field === "cuting") row.GantiBsCuting += Number(r.Jml);
    else if (field === "cetak") row.GantiBsCetak += Number(r.Jml);
    else if (field === "bordir") row.GantiBsBordir += Number(r.Jml);
    else if (field === "jahit") row.GantiBsJahit += Number(r.Jml);
  }

  const kodes = [...dataMap.keys()];
  if (kodes.length === 0) return [];

  const [bahanRows] = await db.query(
    `SELECT Bhn_kode, Bhn_Name FROM tbahan WHERE Bhn_kode IN (?)`,
    [kodes],
  );
  const namaMap = new Map(bahanRows.map((b) => [b.Bhn_kode, b.Bhn_Name]));

  const result = [...dataMap.values()].map((r) => ({
    SPK: spk,
    Komponen: namaMap.get(r.Kode) || r.Kode,
    ...r,
  }));
  result.sort((a, b) =>
    a.Komponen > b.Komponen ? 1 : a.Komponen < b.Komponen ? -1 : 0,
  );
  return result;
};

module.exports = {
  getBrowse,
  getDetail,
};
