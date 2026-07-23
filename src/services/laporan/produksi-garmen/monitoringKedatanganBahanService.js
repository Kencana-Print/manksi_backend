const db = require("../../../config/database");

// ─────────────────────────────────────────────
// HELPER: filter map/spk (radio ALL/MAP/SPK)
// ─────────────────────────────────────────────
const buildMapSpkFilter = (mapSpk) => {
  if (mapSpk === "MAP") return `AND LEFT(h.min_spk_nomor, 3) = 'MAP'`;
  if (mapSpk === "SPK") return `AND LEFT(h.min_spk_nomor, 3) <> 'MAP'`;
  return "";
};

// ─────────────────────────────────────────────
// HELPER: filter keterangan (dropdown BARU/GANTI BS/GANTI HILANG/
// LAIN-LAIN — LAIN-LAIN artinya NOT IN 3 opsi baku)
// ─────────────────────────────────────────────
const buildKetFilter = (ket) => {
  if (!ket) return "";
  if (ket === "LAIN-LAIN") {
    return `AND h.min_ket NOT IN ('BARU', 'GANTI BS', 'GANTI HILANG')`;
  }
  return `AND h.min_ket = ${db.escape(ket)}`;
};

// ─────────────────────────────────────────────
// MASTER — 1 baris per (SPK, Tanggal Minta). Komponen di-GROUP_CONCAT,
// satuan & keterangan diambil dari baris pertama (LIMIT 1), persis
// Delphi.
// ─────────────────────────────────────────────
const getBrowse = async (
  startDate,
  endDate,
  cab = "P04",
  mapSpk = "ALL",
  ket = "",
) => {
  let where = `WHERE h.min_tanggal >= ? AND h.min_tanggal <= ?`;
  const params = [startDate, endDate];
  if (cab && cab !== "ALL") {
    where += ` AND h.min_cab = ?`;
    params.push(cab);
  }
  where += ` ${buildKetFilter(ket)} ${buildMapSpkFilter(mapSpk)}`;

  const sql = `
    SELECT
      IFNULL(s.spk_nama, m.mspk_nama) AS NamaSpk,
      x.SpkNomor,
      IFNULL(s.spk_finishing, m.mspk_finishing) AS Finishing,
      DATE_FORMAT(IFNULL(s.spk_tanggal, m.mspk_tanggal), '%Y-%m-%d') AS SpkTerbit,
      DATE_FORMAT(IFNULL(s.spk_dateline, m.mspk_dateline), '%Y-%m-%d') AS SpkDateline,
      IFNULL(s.spk_jumlah, m.mspk_jumlah) AS JmlSpk,
      x.Komponen,
      DATE_FORMAT(x.TglMinta, '%Y-%m-%d') AS TglMinta,
      x.QtyMinta,
      x.Satuan,
      x.Keterangan
    FROM (
      SELECT
        h.min_spk_nomor AS SpkNomor,
        CAST(GROUP_CONCAT(d.mind_komponen SEPARATOR ', ') AS CHAR) AS Komponen,
        h.min_tanggal AS TglMinta,
        SUM(d.mind_jumlah) AS QtyMinta,
        (
          SELECT b.Bhn_satuan FROM tmintabahan_hdr e
          INNER JOIN tmintabahan_dtl i ON i.mind_nomor = e.min_nomor
          LEFT JOIN tbahan b ON b.Bhn_kode = i.mind_bhn_kode
          WHERE e.min_spk_nomor = h.min_spk_nomor AND e.min_tanggal = h.min_tanggal
          LIMIT 1
        ) AS Satuan,
        (
          SELECT e.min_ket FROM tmintabahan_hdr e
          WHERE e.min_spk_nomor = h.min_spk_nomor AND e.min_tanggal = h.min_tanggal
          LIMIT 1
        ) AS Keterangan
      FROM tmintabahan_hdr h
      INNER JOIN tmintabahan_dtl d ON d.mind_nomor = h.min_nomor
      ${where}
      GROUP BY h.min_spk_nomor, h.min_tanggal
    ) x
    LEFT JOIN tspk s ON s.spk_nomor = x.SpkNomor
    LEFT JOIN tmemospk m ON m.mspk_nomor = x.SpkNomor
    ORDER BY x.SpkNomor, x.TglMinta
  `;
  const [rows] = await db.query(sql, params);
  return rows;
};

// ─────────────────────────────────────────────
// DETAIL — 2 dataset independen (DATANG & CUTTING) untuk satu
// (SPK, TglMinta). ✅ Ditampilkan sebagai 2 tabel terpisah (sesuai
// konfirmasi) — TIDAK di-stack per posisi baris seperti Excel Delphi.
// ─────────────────────────────────────────────
const getDatangDetail = async (spk, tglMinta, cab) => {
  let cabFilter = "";
  if (cab === "P01") cabFilter = `AND j.promin_gdgp_kode = 'GP015'`;
  else if (cab === "P04") cabFilter = `AND j.promin_gdgp_kode = 'GP001'`;

  const sql = `
    SELECT
      DATE_FORMAT(j.promin_tanggal, '%Y-%m-%d') AS Tanggal,
      SUM(i.promind_Jumlah) AS Qty
    FROM tproduksiminta_dtl i
    INNER JOIN tproduksiminta_hdr j ON j.promin_nomor = i.promind_promin_Nomor
    WHERE j.promin_spk_nomor = ?
      ${cabFilter}
      AND j.promin_minta IN (
        SELECT e.min_nomor FROM tmintabahan_hdr e
        WHERE e.min_spk_nomor = ? AND e.min_tanggal = ?
      )
    GROUP BY j.promin_tanggal
    ORDER BY j.promin_tanggal
  `;
  const [rows] = await db.query(sql, [spk, spk, tglMinta]);
  return rows;
};

const getCuttingDetail = async (spk, tglMinta, cab) => {
  let cabFilter = "";
  if (cab && cab !== "ALL") cabFilter = `AND k.mph_cab = ?`;

  const sql = `
    SELECT
      DATE_FORMAT(k.mph_tanggal, '%Y-%m-%d') AS Tanggal,
      SUM(k.mph_qty_berat) AS Qty
    FROM tmutasiproduksi_hdr k
    WHERE k.mph_nomaterial <> '' AND k.mph_spk_nomor = ?
      ${cabFilter}
      AND k.mph_nomaterial IN (
        SELECT j.promin_nomor FROM tproduksiminta_hdr j
        WHERE j.promin_spk_nomor = ?
          AND j.promin_minta IN (
            SELECT e.min_nomor FROM tmintabahan_hdr e
            WHERE e.min_spk_nomor = ? AND e.min_tanggal = ?
          )
      )
    GROUP BY k.mph_tanggal
    ORDER BY k.mph_tanggal
  `;
  const params =
    cab && cab !== "ALL"
      ? [spk, cab, spk, spk, tglMinta]
      : [spk, spk, spk, tglMinta];
  const [rows] = await db.query(sql, params);
  return rows;
};

const getDetail = async (spk, tglMinta, cab) => {
  const [datang, cutting] = await Promise.all([
    getDatangDetail(spk, tglMinta, cab),
    getCuttingDetail(spk, tglMinta, cab),
  ]);
  return { datang, cutting };
};

// ─────────────────────────────────────────────
// ALL DETAIL — gabungan detail semua master row, plus SELISIH
// (hari/qty) dihitung proper: pakai record PERTAMA datang & cutting
// (bukan row-stacking Excel), dibandingkan ke SpkTerbit/SpkDateline.
// ✅ Sesuai konfirmasi: cuma dihitung di export, bukan di browse.
// ─────────────────────────────────────────────
const getAllDetail = async (
  startDate,
  endDate,
  cab = "P04",
  mapSpk = "ALL",
  ket = "",
) => {
  const master = await getBrowse(startDate, endDate, cab, mapSpk, ket);
  const result = [];
  for (const m of master) {
    const { datang, cutting } = await getDetail(m.SpkNomor, m.TglMinta, cab);
    const firstDatang = datang[0] || null;
    const firstCutting = cutting[0] || null;
    const totalDatang = datang.reduce((s, r) => s + Number(r.Qty || 0), 0);
    const totalCutting = cutting.reduce((s, r) => s + Number(r.Qty || 0), 0);

    const daysDiff = (a, b) => {
      if (!a || !b) return null;
      const d1 = new Date(a);
      const d2 = new Date(b);
      return Math.round((d1.getTime() - d2.getTime()) / (1000 * 60 * 60 * 24));
    };

    result.push({
      ...m,
      TglDatangPertama: firstDatang?.Tanggal || null,
      QtyDatangTotal: totalDatang,
      TglCuttingPertama: firstCutting?.Tanggal || null,
      QtyCuttingTotal: totalCutting,
      SelisihPengajuanVsSpk: daysDiff(m.TglMinta, m.SpkTerbit),
      SelisihDatangVsSpk: daysDiff(firstDatang?.Tanggal, m.SpkTerbit),
      SelisihCuttVsSpk: daysDiff(firstCutting?.Tanggal, m.SpkTerbit),
      SelisihDatangVsPengajuan: totalDatang - Number(m.QtyMinta || 0),
      SelisihCuttVsDatang: totalCutting - totalDatang,
    });
  }
  return result;
};

// ─────────────────────────────────────────────
// FLATTENED ROWS — replikasi PERSIS row-stacking Excel Delphi:
// - Kolom identitas SPK (Nama, No, Finishing, JmlSpk, Komponen) +
//   PENGAJUAN (Tgl/Qty/Satuan) cuma ditulis di kelompok tanggal
//   minta PERTAMA per SPK (sesuai konfirmasi — quirk "ckode<>ckode2"
//   Delphi, tanggal minta ke-2+ per SPK sengaja disembunyikan).
// - Kolom SpkTerbit/SpkDateline (E/F) ditulis di SETIAP baris,
//   termasuk baris lanjutan DATANG/CUTTING.
// - DATANG dan CUTTING di-stack per index array (BUKAN dicocokkan
//   tanggal) — n baris = max(datang.length, cutting.length, 1).
// - SELISIH dihitung per baris pakai nilai row itu sendiri.
// ─────────────────────────────────────────────
const getFlattenedRows = async (
  startDate,
  endDate,
  cab = "P04",
  mapSpk = "ALL",
  ket = "",
) => {
  const master = await getBrowse(startDate, endDate, cab, mapSpk, ket);

  const flatRows = [];
  let no = 0;
  let prevSpk = null;

  const daysDiff = (a, b) => {
    if (!a || !b) return "";
    const d1 = new Date(a);
    const d2 = new Date(b);
    return Math.round((d1.getTime() - d2.getTime()) / (1000 * 60 * 60 * 24));
  };

  for (const m of master) {
    const isNewSpk = m.SpkNomor !== prevSpk;
    if (isNewSpk) no++;

    const [datang, cutting] = await Promise.all([
      getDatangDetail(m.SpkNomor, m.TglMinta, cab),
      getCuttingDetail(m.SpkNomor, m.TglMinta, cab),
    ]);

    const n = Math.max(datang.length, cutting.length, 1);
    for (let i = 0; i < n; i++) {
      const d = datang[i] || null;
      const c = cutting[i] || null;

      flatRows.push({
        No: i === 0 && isNewSpk ? no : null,
        NamaSpk: isNewSpk ? m.NamaSpk : null,
        SpkNomor: isNewSpk ? m.SpkNomor : null,
        Finishing: isNewSpk ? m.Finishing : null,
        SpkTerbit: m.SpkTerbit,
        SpkDateline: m.SpkDateline,
        JmlSpk: isNewSpk ? m.JmlSpk : null,
        Komponen: isNewSpk ? m.Komponen : null,
        TglMinta: isNewSpk ? m.TglMinta : null,
        QtyMinta: isNewSpk ? m.QtyMinta : null,
        Satuan: isNewSpk ? m.Satuan : null,
        TglDatang: d?.Tanggal || null,
        QtyDatang: d?.Qty ?? null,
        TglCutting: c?.Tanggal || null,
        QtyCutting: c?.Qty ?? null,
        SelisihPengajuanVsSpk: isNewSpk
          ? daysDiff(m.TglMinta, m.SpkTerbit)
          : "",
        SelisihDatangVsSpk: d ? daysDiff(d.Tanggal, m.SpkTerbit) : "",
        SelisihCuttVsSpk: c ? daysDiff(c.Tanggal, m.SpkTerbit) : "",
        SelisihDatangVsPengajuan:
          d && isNewSpk ? Number(d.Qty || 0) - Number(m.QtyMinta || 0) : "",
        SelisihCuttVsDatang:
          c && d ? Number(c.Qty || 0) - Number(d.Qty || 0) : "",
        Keterangan: i === 0 && isNewSpk ? m.Keterangan : null,
        _rowKey: `${m.SpkNomor}-${m.TglMinta}-${i}`,
      });
    }
    prevSpk = m.SpkNomor;
  }

  return flatRows;
};

module.exports = {
  getBrowse,
  getDetail,
  getAllDetail,
  getFlattenedRows,
};
