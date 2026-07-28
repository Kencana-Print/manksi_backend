const db = require("../../config/database");

// ─────────────────────────────────────────────────────────
// Divisi -> kolom sumber di tplanningspk (Qty & Keterangan).
// Ini WHITELIST internal (bukan interpolasi langsung dari input
// user) — aman dipakai buat build nama kolom SQL secara dinamis
// tanpa risiko SQL injection, karena kunci "divisi" cuma dipakai
// buat lookup ke object ini, bukan ditempel mentah ke query.
// ─────────────────────────────────────────────────────────
const DIVISI_COLUMN_MAP = {
  "BAHAN DATANG": { qty: "plan_datang", ket: "plan_ppic" },
  CUTTING: { qty: "plan_cutting", ket: "plan_ketcutting" },
  CETAK: { qty: "plan_cetak", ket: "plan_ketcetak" },
  // ⚠️ FIX bug Delphi: source asli pakai `p.plan_bordir` juga untuk
  // Keterangan (harusnya plan_ketbordir, typo copy-paste — semua
  // divisi lain konsisten punya kolom plan_ket<divisi> sendiri).
  BORDIR: { qty: "plan_bordir", ket: "plan_ketbordir" },
  JAHIT: { qty: "plan_jahit", ket: "plan_ketjahit" },
  FINISHING: { qty: "plan_finishing", ket: "plan_ketfinishing" },
  KIRIM: { qty: "plan_kirim", ket: "plan_ketkirim" },
};

const DIVISI_OPTIONS = Object.keys(DIVISI_COLUMN_MAP);

// ─────────────────────────────────────────────────────────
// MASTER — replikasi query btnRefreshClick, dengan kolom Qty/
// Keterangan dipilih dinamis sesuai divisi terpilih.
// ⚠️ tsalesorder SENGAJA tidak diikutkan — konsisten dengan
// keputusan sebelumnya (modul Planning per SPK murni scope produksi
// garmen SPK/MAP, bukan SO retail/kaosan).
// ─────────────────────────────────────────────────────────
const getBrowseList = async (query) => {
  const today = new Date();
  const defaultStart = new Date(today.getFullYear(), today.getMonth(), 1)
    .toISOString()
    .substring(0, 10);
  const defaultEnd = today.toISOString().substring(0, 10);

  const startDate = query.startDate || defaultStart;
  const endDate = query.endDate || defaultEnd;
  const workshop = query.workshop || "ALL";
  const divisi = query.divisi || "CUTTING";
  const spkNomor = query.spkNomor || "";

  const colMap = DIVISI_COLUMN_MAP[divisi] || DIVISI_COLUMN_MAP.CUTTING;

  const params = [startDate, endDate];
  let extraFilter = "";
  if (spkNomor) {
    extraFilter += ` AND p.plan_spk = ?`;
    params.push(spkNomor);
  }

  let cabFilter = "";
  if (workshop && workshop !== "ALL") {
    cabFilter = ` AND x.Cab = ?`;
    params.push(workshop);
  }

  const sql = `
    SELECT * FROM (
      SELECT
        DATE_FORMAT(p.plan_tanggal, '%Y-%m-%d') AS TglPlanning,
        p.plan_spk AS SPK,
        IFNULL(s.spk_cab, m.mspk_cab) AS Cab,
        IFNULL(s.spk_workshop, m.mspk_workshop) AS Workshop,
        IFNULL(s.spk_cus_kode, m.mspk_cus_kode) AS KdCus,
        IFNULL(s.spk_nama, m.mspk_nama) AS Nama,
        IFNULL(s.spk_jumlah, m.mspk_jumlah) AS QtySPK,
        IFNULL(s.spk_kain, m.mspk_kain) AS Kain,
        IFNULL(s.spk_finishing, m.mspk_finishing) AS Finishing,
        p.${colMap.qty} AS QtyPlanning,
        p.${colMap.ket} AS Keterangan
      FROM tplanningspk p
      LEFT JOIN tspk s ON s.spk_nomor = p.plan_spk
      LEFT JOIN tmemospk m ON m.mspk_nomor = p.plan_spk
      WHERE p.plan_tanggal >= ? AND p.plan_tanggal <= ?
        ${extraFilter}
    ) x
    WHERE x.QtyPlanning <> 0
      ${cabFilter}
    ORDER BY x.SPK, x.TglPlanning
  `;

  const [rows] = await db.query(sql, params);

  // Cast defensif — mysql2 kadang balikin nilai numerik dari
  // ekspresi/agregat sebagai string.
  return rows.map((r) => ({
    ...r,
    QtySPK: Number(r.QtySPK) || 0,
    QtyPlanning: Number(r.QtyPlanning) || 0,
  }));
};

module.exports = {
  getBrowseList,
  DIVISI_OPTIONS,
};
