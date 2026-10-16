const db = require("../../../config/database");

// --- 1. GET BROWSE HEADER (Master PO) ---
const getBrowse = async (query) => {
  const { startDate, endDate } = query;

  // Default: Awal bulan s/d Hari ini
  const dStart =
    startDate ||
    new Date(new Date().getFullYear(), new Date().getMonth(), 1)
      .toISOString()
      .substring(0, 10);
  const dEnd = endDate || new Date().toISOString().substring(0, 10);

  const sql = `
    SELECT 
      h.po_nomor AS Nomor,
      DATE_FORMAT(h.po_tanggal, "%Y-%m-%d") AS Tanggal,
      h.po_keterangan AS Keterangan,
      IF(h.po_jenis = 4,
         IF(IFNULL(ps.jml_sup, 0) > 1, '', IFNULL(ps.kode_sup, '')),
         h.po_sup_kode) AS KodeSupplier,
      IF(h.po_jenis = 4 AND IFNULL(ps.jml_sup, 0) > 1,
         CONCAT(ps.jml_sup, ' supplier'),
         s.sup_nama) AS Supplier,
      s.sup_nama AS Supplier,
      
      (SELECT IFNULL(SUM(b.pod_Jumlah), 0) FROM tpo_dtl b WHERE b.pod_po_Nomor = h.po_Nomor) AS QtyPO,
      (SELECT IFNULL(SUM(j.pod2_jumlah), 0) FROM tpo_dtl2 j WHERE j.pod2_nomor = h.po_Nomor) AS QtyCommit,
      
      (SELECT IFNULL(SUM(c.bpbd_Jumlah), 0) 
       FROM tbpb_dtl c 
       INNER JOIN tbpb_hdr f ON f.bpb_Nomor = c.bpbd_bpb_Nomor 
       WHERE f.bpb_po_Nomor = h.po_Nomor) AS QtyBPB,
       
      (SELECT IFNULL(SUM(b.retd_jumlah), 0) 
       FROM tret_hdr a 
       INNER JOIN tret_dtl b ON b.retd_ret_nomor = a.ret_nomor 
       INNER JOIN tbpb_hdr p ON p.bpb_Nomor = a.ret_bpb_nomor 
       WHERE p.bpb_po_Nomor = h.po_nomor) AS QtyRetur,
       
      IF(h.po_close = 1, 'CLOSE', IF(h.po_close = 0, 'OPEN', 'ONPROSES')) AS Status
    FROM tpo_hdr h
    LEFT JOIN (
      SELECT d.pod_po_nomor,
             COUNT(DISTINCT d.pod_sup_kode) AS jml_sup,
             MIN(d.pod_sup_kode) AS kode_sup
      FROM tpo_dtl d
      INNER JOIN tpo_hdr hh ON hh.po_nomor = d.pod_po_nomor
      WHERE hh.po_jenis = 4
        AND hh.po_tanggal >= ? AND hh.po_tanggal <= ?
        AND IFNULL(d.pod_sup_kode, '') <> ''
      GROUP BY d.pod_po_nomor
    ) ps ON ps.pod_po_nomor = h.po_nomor
    LEFT JOIN tsupplier s
      ON s.sup_kode = IF(h.po_jenis = 4, ps.kode_sup, h.po_sup_kode)
    WHERE h.po_jenis <> 1 
      AND h.po_tanggal >= ? 
      AND h.po_tanggal <= ?
    ORDER BY h.po_nomor DESC
  `;

  const [rows] = await db.query(sql, [dStart, dEnd, dStart, dEnd]);
  return rows;
};

// --- 2. GET BROWSE DETAIL (Pengganti Logika Temp Table Delphi) ---
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const getBrowseDetail = async (nomorPO) => {
  const [hdr] = await db.query(
    `SELECT po_jenis FROM tpo_hdr WHERE po_nomor = ?`,
    [nomorPO],
  );
  if (hdr.length === 0) return [];

  // PO Lain-lain (jenis 4): baris dipisah per (bahan, supplier, SPK).
  // Jenis lain: per bahan saja (perilaku lama).
  const lain = Number(hdr[0].po_jenis) === 4;

  const [items] = await db.query(
    `SELECT d.pod_bhn_kode AS Kode, b.Bhn_Name AS Nama, b.Bhn_satuan AS Satuan,
            ${lain ? "IFNULL(d.pod_sup_kode, '')" : "''"} AS KodeSup,
            ${lain ? "MIN(sp.sup_nama)" : "''"} AS Supplier,
            ${lain ? "IFNULL(d.pod_spk_nomor, '')" : "''"} AS SPK,
            ${lain ? "MIN(COALESCE(k.spk_nama, so.so_nama, ''))" : "''"} AS NamaSPK,
            SUM(d.pod_Jumlah) AS QtyPO
     FROM tpo_dtl d
     LEFT JOIN tbahan b ON b.Bhn_kode = d.pod_bhn_kode
     LEFT JOIN tsupplier sp ON sp.sup_kode = d.pod_sup_kode
     LEFT JOIN tspk k ON k.spk_nomor = d.pod_spk_nomor
     LEFT JOIN tsalesorder so ON so.so_nomor = d.pod_spk_nomor AND so.so_aktif = 'Y'
     WHERE d.pod_po_Nomor = ?
     GROUP BY d.pod_bhn_kode${lain ? ", d.pod_sup_kode, d.pod_spk_nomor" : ""}
     ORDER BY d.pod_bhn_kode${lain ? ", d.pod_sup_kode, d.pod_spk_nomor" : ""}`,
    [nomorPO],
  );

  // Delivery commitment hanya punya supplier (tidak punya SPK)
  const [commits] = await db.query(
    `SELECT pod2_bhn_kode AS Kode,
            ${lain ? "IFNULL(pod2_sup_kode, '')" : "''"} AS KodeSup,
            DATE_FORMAT(pod2_tanggal, '%Y-%m-%d') AS TglCommit,
            SUM(pod2_jumlah) AS QtyCommit
     FROM tpo_dtl2
     WHERE pod2_nomor = ? AND pod2_jumlah <> 0
     GROUP BY pod2_bhn_kode${lain ? ", pod2_sup_kode" : ""}, pod2_tanggal
     ORDER BY pod2_tanggal`,
    [nomorPO],
  );

  const [bpbs] = await db.query(
    `SELECT
        d.bpbd_bhn_kode AS Kode,
        ${lain ? "IFNULL(h.bpb_sup_kode, '')" : "''"} AS KodeSup,
        ${lain ? "IFNULL(d.bpbd_spk_nomor, '')" : "''"} AS SPK,
        h.bpb_nomor AS NoBPB,
        DATE_FORMAT(h.bpb_tanggal, '%Y-%m-%d') AS TglBPB,
        SUM(d.bpbd_jumlah) AS QtyBPB,

        (SELECT CAST(GROUP_CONCAT(DISTINCT a.ret_nomor SEPARATOR ', ') AS CHAR)
         FROM tret_hdr a INNER JOIN tret_dtl b ON b.retd_ret_nomor = a.ret_nomor
         WHERE a.ret_bpb_nomor = h.bpb_nomor AND b.retd_bhn_kode = d.bpbd_bhn_kode) AS NoRetur,

        (SELECT MAX(DATE_FORMAT(a.ret_tanggal, '%Y-%m-%d'))
         FROM tret_hdr a INNER JOIN tret_dtl b ON b.retd_ret_nomor = a.ret_nomor
         WHERE a.ret_bpb_nomor = h.bpb_nomor AND b.retd_bhn_kode = d.bpbd_bhn_kode) AS TglRetur,

        (SELECT IFNULL(SUM(b.retd_jumlah), 0)
         FROM tret_hdr a INNER JOIN tret_dtl b ON b.retd_ret_nomor = a.ret_nomor
         WHERE a.ret_bpb_nomor = h.bpb_nomor AND b.retd_bhn_kode = d.bpbd_bhn_kode) AS QtyRetur

     FROM tbpb_hdr h
     INNER JOIN tbpb_dtl d ON d.bpbd_bpb_Nomor = h.bpb_nomor
     WHERE h.bpb_po_nomor = ? AND d.bpbd_jumlah <> 0
     GROUP BY d.bpbd_bhn_kode${lain ? ", h.bpb_sup_kode, d.bpbd_spk_nomor" : ""}, h.bpb_nomor, h.bpb_tanggal
     ORDER BY d.bpbd_bhn_kode, h.bpb_nomor`,
    [nomorPO],
  );

  // ── Kelompokkan: satu grup = satu baris PO (bahan[, supplier, SPK]) ──
  const groups = new Map();
  const keyOf = (kode, sup, spk) => `${kode}\u0000${sup}\u0000${spk}`;
  const ensure = (kode, sup, spk) => {
    const k = keyOf(kode, sup, spk);
    let g = groups.get(k);
    if (!g) {
      g = {
        Kode: kode,
        Nama: "",
        Satuan: "",
        KodeSup: sup,
        Supplier: "",
        SPK: spk,
        NamaSPK: "",
        QtyPO: 0,
        commits: [],
        bpbs: [],
      };
      groups.set(k, g);
    }
    return g;
  };

  const infoBahan = new Map();
  const namaSup = new Map();
  for (const it of items) {
    const g = ensure(it.Kode, it.KodeSup, it.SPK);
    g.Nama = g.Nama || it.Nama || "";
    g.Satuan = g.Satuan || it.Satuan || "";
    g.Supplier = g.Supplier || it.Supplier || "";
    g.NamaSPK = g.NamaSPK || it.NamaSPK || "";
    g.QtyPO += Number(it.QtyPO) || 0;
    if (it.Supplier && !namaSup.has(it.KodeSup)) {
      namaSup.set(it.KodeSup, it.Supplier);
    }
    if (!infoBahan.has(it.Kode)) {
      infoBahan.set(it.Kode, { Nama: it.Nama || "", Satuan: it.Satuan || "" });
    }
  }

  // Commit: ke grup pertama dengan bahan + supplier yang sama (commit tidak punya SPK)
  for (const c of commits) {
    const semua = [...groups.values()];
    const g =
      semua.find((x) => x.Kode === c.Kode && x.KodeSup === c.KodeSup) ||
      semua.find((x) => x.Kode === c.Kode) ||
      ensure(c.Kode, c.KodeSup, "");
    g.commits.push(c);
  }

  // BPB: ke grup yang cocok persis; kalau tidak ada buat grup baru supaya tidak hilang
  for (const b of bpbs) {
    ensure(b.Kode, b.KodeSup, b.SPK).bpbs.push(b);
  }

  const sorted = [...groups.values()].sort(
    (a, b) =>
      String(a.Kode).localeCompare(String(b.Kode)) ||
      String(a.KodeSup).localeCompare(String(b.KodeSup)) ||
      String(a.SPK).localeCompare(String(b.SPK)),
  );

  // Retur tercatat per (BPB, bahan), bukan per SPK. Bila satu BPB terpecah ke beberapa
  // grup SPK, retur hanya dimunculkan satu kali (grup pertama) agar tidak terhitung ganda.
  const returSeen = new Set();
  const results = [];

  for (const g of sorted) {
    const infoBhn = infoBahan.get(g.Kode);
    const nama = g.Nama || infoBhn?.Nama || "";
    const satuan = g.Satuan || infoBhn?.Satuan || "";
    const totalBpb = g.bpbs.reduce((s, x) => s + (Number(x.QtyBPB) || 0), 0);
    const maxRows = Math.max(1, g.commits.length, g.bpbs.length);

    for (let i = 0; i < maxRows; i++) {
      const c = g.commits[i];
      const b = g.bpbs[i];

      let noRetur = "";
      let tglRetur = null;
      let qtyRetur = 0;
      if (b) {
        const rk = `${b.NoBPB}\u0000${b.Kode}`;
        if (!returSeen.has(rk)) {
          returSeen.add(rk);
          noRetur = b.NoRetur || "";
          tglRetur = b.TglRetur || null;
          qtyRetur = Number(b.QtyRetur) || 0;
        }
      }

      results.push({
        Nomor: nomorPO,
        Kode: g.Kode,
        Nama: nama,
        Satuan: satuan,
        Supplier: g.Supplier || namaSup.get(g.KodeSup) || g.KodeSup,
        SPK: g.SPK,
        NamaSPK: g.NamaSPK,
        Awal: i === 0, // baris pertama grup: hanya baris ini yang membawa Qty PO & Sisa
        QtyPO: i === 0 ? r2(g.QtyPO) : 0,
        Sisa: i === 0 ? r2(g.QtyPO - totalBpb) : 0,

        TglCommit: c?.TglCommit || null,
        QtyCommit: r2(c?.QtyCommit),

        NoBPB: b?.NoBPB || "",
        TglBPB: b?.TglBPB || null,
        QtyBPB: r2(b?.QtyBPB),

        NoRetur: noRetur,
        TglRetur: tglRetur,
        QtyRetur: r2(qtyRetur),
      });
    }
  }

  return results;
};

module.exports = {
  getBrowse,
  getBrowseDetail,
};
