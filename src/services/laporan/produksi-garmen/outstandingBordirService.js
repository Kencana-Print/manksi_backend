const db = require("../../../config/database");

// ✅ FIX (sesuai konfirmasi): mapping kode LL-xxx → label header yang
// BENAR (sebelumnya di Delphi urutan SELECT gak sinkron sama urutan
// header, jadi semua 9 kolom stitch ketuker/salah label).
const STITCH_KODE_MAP = [
  { kode: "LL-000447", field: "MataKanan", label: "MATA KANAN" },
  { kode: "LL-000413", field: "MataKanan2", label: "MATA KANAN 2" },
  { kode: "LL-000448", field: "MataKiri", label: "MATA KIRI" },
  { kode: "LL-000412", field: "MataKiri2", label: "MATA KIRI 2" },
  { kode: "LL-000450", field: "MataBlkg", label: "MATA BLKG" },
  { kode: "LL-000451", field: "MataLenganKanan", label: "MATA LENGAN KANAN" },
  { kode: "LL-000452", field: "MataLenganKiri", label: "MATA LENGAN KIRI" },
  { kode: "LL-000237", field: "Krah", label: "KRAH" },
  { kode: "LL-000407", field: "LainLain", label: "LAIN-LAIN" },
];
const ALL_STITCH_KODE = STITCH_KODE_MAP.map((m) => m.kode);
const GDG_BORDIR = ["GP014", "GP016"];

// ─────────────────────────────────────────────
// MASTER — SPK aktif dengan proses bordir (spk_bordir='Y' atau
// finishing LIKE '%BORDIR%'), plus perhitungan LHK, titik bordir,
// dan 9 komponen stitch (dengan mapping kode yang sudah diperbaiki).
// Diimplementasikan sebagai agregat langsung — pengganti teknik
// CREATE TEMP TABLE + 3-pass update ala Delphi.
// ─────────────────────────────────────────────
const getBrowse = async (startDate, cab = "P04") => {
  let cabFilter = "";
  const params = [];
  if (cab && cab !== "ALL") {
    cabFilter = "AND s.spk_cab = ?";
    params.push(cab);
  } else {
    cabFilter = "AND s.spk_cab IN ('P01', 'P04')";
  }
  params.push(startDate);

  // ── Base SPK list ──
  const baseSql = `
    SELECT
      s.spk_nomor AS SPK,
      DATE_FORMAT(s.spk_tanggal, '%Y-%m-%d') AS Tanggal,
      s.spk_cab AS Cab,
      s.spk_memo AS Map,
      s.spk_nama AS Nama,
      s.spk_jumlah AS Qty
    FROM tspk s
    WHERE s.spk_close = 'N' AND s.spk_cmo <> ''
      AND (s.spk_bordir = 'Y' OR s.spk_finishing LIKE '%BORDIR%')
      ${cabFilter}
      AND s.spk_tanggal >= ?
    ORDER BY s.spk_tanggal
  `;
  const [baseRows] = await db.query(baseSql, params);
  if (baseRows.length === 0) return [];

  const spkList = baseRows.map((r) => r.SPK);
  const dataMap = new Map();
  for (const r of baseRows) {
    dataMap.set(r.SPK, {
      ...r,
      Titik: 0,
      Lhk: 0,
      MataKanan: 0,
      MataKanan2: 0,
      MataKiri: 0,
      MataKiri2: 0,
      MataBlkg: 0,
      MataLenganKanan: 0,
      MataLenganKiri: 0,
      Krah: 0,
      LainLain: 0,
    });
  }

  // ── Titik bordir (jumlah proof garmen lini BORDIR) — pakai
  // spk_memo kalau ada (MAP), fallback spk_nomor ──
  const titikSql = `
    SELECT h.pf_spk_nomor AS Ref, COUNT(*) AS Titik
    FROM tproofgarmen_hdr h
    LEFT JOIN tproofgarmen_dtl d ON d.pfd_nomor = h.pf_nomor
    WHERE h.pf_lini = 'BORDIR'
      AND h.pf_spk_nomor IN (?)
    GROUP BY h.pf_spk_nomor
  `;
  const refKeys = baseRows.map((r) => r.Map || r.SPK);
  const [titikRows] = await db.query(titikSql, [refKeys]);
  const titikByRef = new Map(titikRows.map((r) => [r.Ref, Number(r.Titik)]));
  for (const row of dataMap.values()) {
    const ref = row.Map || row.SPK;
    row.Titik = titikByRef.get(ref) || 0;
  }

  // ── LHK — SUM mutasi produksi utk 9 kode LL, gudang asal
  // GP014/GP016 ──
  const lhkSql = `
    SELECT p.mpd_spk AS SPK, SUM(p.mpd_jumlah) AS Lhk
    FROM tmutasiproduksi_dtl p
    WHERE p.mpd_spk IN (?)
      AND p.mpd_bhn_kode IN (?)
      AND p.mpd_gdgp_asal IN (?, ?)
    GROUP BY p.mpd_spk
  `;
  const [lhkRows] = await db.query(lhkSql, [
    spkList,
    ALL_STITCH_KODE,
    ...GDG_BORDIR,
  ]);
  for (const r of lhkRows) {
    const row = dataMap.get(r.SPK);
    if (row) row.Lhk += Number(r.Lhk);
  }

  // ── CMT (jasa luar) ditambahkan ke LHK ──
  const cmtSql = `
    SELECT bpjd_spk AS SPK, SUM(bpjd_Jumlah) AS Jml
    FROM tbpj_dtl
    WHERE bpjd_bhn_kode IN (?) AND bpjd_spk IN (?)
    GROUP BY bpjd_spk
  `;
  const [cmtRows] = await db.query(cmtSql, [ALL_STITCH_KODE, spkList]);
  for (const r of cmtRows) {
    const row = dataMap.get(r.SPK);
    if (row) row.Lhk += Number(r.Jml);
  }

  // ── Stitch per kode (dari proof bordir, baris pertama per
  // pf_tanggal — LIMIT 1 ala Delphi), fallback/override dari LHK
  // Desain kalau ada ──
  for (const { kode, field } of STITCH_KODE_MAP) {
    const proofSql = `
      SELECT h.pf_spk_nomor AS Ref, SUM(d.pfd_sttich) AS Stitch
      FROM tproofgarmen_hdr h
      INNER JOIN tproofgarmen_dtl d ON d.pfd_nomor = h.pf_nomor
      WHERE h.pf_lini = 'BORDIR' AND d.pfd_kode = ?
        AND h.pf_spk_nomor IN (?)
      GROUP BY h.pf_spk_nomor
      ORDER BY h.pf_tanggal
      LIMIT 1
    `;
    const [proofRows] = await db.query(proofSql, [kode, refKeys]);
    for (const r of proofRows) {
      for (const row of dataMap.values()) {
        const ref = row.Map || row.SPK;
        if (ref === r.Ref) row[field] = Number(r.Stitch) || 0;
      }
    }
  }

  // ── Override dari LHK Desain Komponen (kalau ada), plus update
  // Titik dari tspk_komponen_bordir kalau tersedia ──
  const desainSql = `
    SELECT l.ldk_spk AS SPK, l.ldk_kode AS Kode, SUM(l.ldk_sticth) AS Stitch,
      IFNULL((
        SELECT COUNT(sk_nomor) FROM tspk_komponen_bordir
        WHERE sk_nomor = l.ldk_spk GROUP BY sk_nomor
      ), 0) AS TitikKomponen
    FROM tlhkdesign_komponen l
    WHERE l.ldk_output = 'BORDIR'
      AND l.ldk_kode IN (?)
      AND l.ldk_spk IN (?)
    GROUP BY l.ldk_spk, l.ldk_kode
  `;
  const [desainRows] = await db.query(desainSql, [ALL_STITCH_KODE, spkList]);
  const kodeFieldMap = Object.fromEntries(
    STITCH_KODE_MAP.map((m) => [m.kode, m.field]),
  );
  for (const r of desainRows) {
    const row = dataMap.get(r.SPK);
    if (!row) continue;
    const field = kodeFieldMap[r.Kode];
    if (field) row[field] = Number(r.Stitch) || 0;
    if (r.TitikKomponen && Number(r.TitikKomponen) !== 0) {
      row.Titik = Number(r.TitikKomponen);
    }
  }

  // ── Status LHK Design terbaru ──
  const statusSql = `
    SELECT d.lds_spk AS SPK, CONCAT(d.lds_status, ': ', d.lds_note) AS Status
    FROM tlhkdesign_status d
    WHERE d.lds_spk IN (?)
    ORDER BY d.lds_tgl DESC
  `;
  const [statusRows] = await db.query(statusSql, [spkList]);
  const statusMap = new Map();
  for (const r of statusRows) {
    if (!statusMap.has(r.SPK)) statusMap.set(r.SPK, r.Status);
  }

  // ── Hitung kolom turunan (persis formula Excel Delphi) ──
  const result = [...dataMap.values()].map((row) => {
    const totalBordir = Number(row.Qty) * Number(row.Titik);
    const lhkPcs = row.Titik ? row.Lhk / row.Titik : 0;
    const kurangPcs = Number(row.Qty) - lhkPcs;
    const kurangTitik =
      totalBordir === 0 ? Number(row.Qty) : totalBordir - row.Lhk;
    const selesaiPct = totalBordir ? row.Lhk / totalBordir : 0;
    const totalStitch =
      row.MataKanan +
      row.MataKanan2 +
      row.MataKiri +
      row.MataKiri2 +
      row.MataBlkg +
      row.MataLenganKanan +
      row.MataLenganKiri +
      row.Krah +
      row.LainLain;
    const totalStitchXKurang = totalStitch * kurangTitik;
    const kepalaMesin = 20;
    const outstandingJam = kepalaMesin
      ? totalStitchXKurang / (15000 * kepalaMesin)
      : 0;
    const outstandingJkn = outstandingJam / 7;

    return {
      SPK: row.SPK,
      Tanggal: row.Tanggal,
      Cab: row.Cab,
      Map: row.Map,
      Nama: row.Nama,
      Qty: row.Qty,
      Titik: row.Titik,
      TotalBordir: totalBordir,
      LhkPcs: lhkPcs,
      Lhk: row.Lhk,
      KurangPcs: kurangPcs,
      KurangTitik: kurangTitik,
      SelesaiPct: selesaiPct,
      MataKanan: row.MataKanan || null,
      MataKanan2: row.MataKanan2 || null,
      MataKiri: row.MataKiri || null,
      MataKiri2: row.MataKiri2 || null,
      MataBlkg: row.MataBlkg || null,
      MataLenganKanan: row.MataLenganKanan || null,
      MataLenganKiri: row.MataLenganKiri || null,
      Krah: row.Krah || null,
      LainLain: row.LainLain || null,
      TotalStitch: totalStitch,
      TotalStitchXKurang: totalStitchXKurang,
      KepalaMesin: kepalaMesin,
      OutstandingJam: outstandingJam,
      OutstandingJkn: outstandingJkn,
      Note: statusMap.get(row.SPK) || "",
    };
  });

  return result;
};

module.exports = {
  getBrowse,
};
