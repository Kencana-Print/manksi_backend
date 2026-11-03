const pool = require("../../../../config/database");

const fmtDate = (v) => {
  if (!v) return "";
  const d = new Date(v);
  if (isNaN(d.getTime())) return "";
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

const toNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

// 11 tipe MMT yang disepakati (tidak tambah tipe garmen Manksi).
const NODE_TYPES = [
  "MAP",
  "SPK",
  "SO",
  "LHK_CETAK",
  "LHK_TEKSTIL",
  "LHK_PROOF",
  "LHK_PAPERPRINT",
  "LHK_SUBLIM",
  "LHK_FINISHING",
  "STBJ",
  "JADWAL_KIRIM",
  "SJ",
];

const normType = (t) => String(t || "").trim().toUpperCase();

// Batasi LIMIT interpolasi ke integer aman (pola anti-injeksi).
const lim = (n, def = 20) => {
  const v = parseInt(n, 10);
  if (!Number.isFinite(v)) return def;
  return Math.min(Math.max(v, 1), 50);
};

// ---------- SEARCH (per tipe, kolom sudah terbukti ada di query expand) ----------
const searchMap = async (kw, n) => {
  const [rows] = await pool.query(
    `SELECT m.mspk_nomor AS nomor, m.mspk_nama AS label, m.mspk_tanggal AS tanggal, m.mspk_jumlah AS jumlah
     FROM tmemospk m WHERE m.mspk_nomor LIKE ? OR m.mspk_nama LIKE ?
     ORDER BY m.mspk_tanggal DESC LIMIT ${lim(n)}`,
    [kw, kw],
  );
  return rows.map((r) => ({
    type: "MAP",
    nomor: r.nomor,
    label: r.label,
    tanggal: fmtDate(r.tanggal),
    jumlah: toNum(r.jumlah),
  }));
};

const searchSpk = async (kw, n) => {
  const [rows] = await pool.query(
    `SELECT nomor, label, tanggal, jumlah, is_memo FROM (
       SELECT s.spk_nomor AS nomor, s.spk_nama AS label, s.spk_tanggal AS tanggal, s.spk_jumlah AS jumlah, 0 AS is_memo
       FROM tspk s WHERE s.spk_nomor LIKE ? OR s.spk_nama LIKE ?
       UNION ALL
       SELECT m.mspk_nomor AS nomor, m.mspk_nama AS label, m.mspk_tanggal AS tanggal, m.mspk_jumlah AS jumlah, 1 AS is_memo
       FROM tmemospk m WHERE m.mspk_nomor LIKE ? OR m.mspk_nama LIKE ?
     ) x ORDER BY tanggal DESC LIMIT ${lim(n)}`,
    [kw, kw, kw, kw],
  );
  return rows.map((r) => ({
    // Baris memo dilabel MAP agar expand memakai graf kanonis MAP.
    type: Number(r.is_memo) === 1 ? "MAP" : "SPK",
    nomor: r.nomor,
    label: r.label,
    tanggal: fmtDate(r.tanggal),
    jumlah: toNum(r.jumlah),
  }));
};

const searchSo = async (kw, n) => {
  const [rows] = await pool.query(
    `SELECT s.so_nomor AS nomor, s.so_nama AS label, s.so_tanggal AS tanggal, s.so_jumlah AS jumlah
     FROM tsalesorder s WHERE s.so_nomor LIKE ? OR s.so_nama LIKE ?
     ORDER BY s.so_tanggal DESC LIMIT ${lim(n)}`,
    [kw, kw],
  );
  return rows.map((r) => ({
    type: "SO",
    nomor: r.nomor,
    label: r.label,
    tanggal: fmtDate(r.tanggal),
    jumlah: toNum(r.jumlah),
  }));
};

const searchLhkCetak = async (kw, n) => {
  const [rows] = await pool.query(
    `SELECT h.lnomor AS nomor, h.lmesin AS label, h.ltanggal AS tanggal
     FROM tlhk_mesin_hdr h WHERE h.lnomor LIKE ?
     ORDER BY h.ltanggal DESC LIMIT ${lim(n)}`,
    [kw],
  );
  return rows.map((r) => ({
    type: "LHK_CETAK",
    nomor: r.nomor,
    label: r.label,
    tanggal: fmtDate(r.tanggal),
  }));
};

const searchLhkTekstil = async (kw, n) => {
  const [rows] = await pool.query(
    `SELECT h.lth_nomor AS nomor, h.lth_barcode AS label, h.lth_tanggal AS tanggal
     FROM tlhk_tekstilmmt_hdr h WHERE h.lth_nomor LIKE ?
     ORDER BY h.lth_tanggal DESC LIMIT ${lim(n)}`,
    [kw],
  );
  return rows.map((r) => ({
    type: "LHK_TEKSTIL",
    nomor: r.nomor,
    label: r.label,
    tanggal: fmtDate(r.tanggal),
  }));
};

const searchLhkProof = async (kw, n) => {
  const [rows] = await pool.query(
    `SELECT h.lpr_nomor AS nomor, h.lpr_tanggal AS tanggal
     FROM tlhk_proofmmt_hdr h WHERE h.lpr_nomor LIKE ?
     ORDER BY h.lpr_tanggal DESC LIMIT ${lim(n)}`,
    [kw],
  );
  return rows.map((r) => ({
    type: "LHK_PROOF",
    nomor: r.nomor,
    tanggal: fmtDate(r.tanggal),
  }));
};

const searchLhkPaperprint = async (kw, n) => {
  const [rows] = await pool.query(
    `SELECT h.lsb_nomor AS nomor, h.lsb_barcode AS label, h.lsb_tanggal AS tanggal
     FROM tlhk_sublim_hdr h WHERE h.lsb_nomor LIKE ?
     ORDER BY h.lsb_tanggal DESC LIMIT ${lim(n)}`,
    [kw],
  );
  return rows.map((r) => ({
    type: "LHK_PAPERPRINT",
    nomor: r.nomor,
    label: r.label ? `Bahan: ${r.label}` : "",
    tanggal: fmtDate(r.tanggal),
  }));
};

const searchLhkSublim = async (kw, n) => {
  const [rows] = await pool.query(
    `SELECT h.lr_nomor AS nomor, h.lr_tanggal AS tanggal
     FROM tlhk_rtr_hdr h WHERE h.lr_nomor LIKE ?
     ORDER BY h.lr_tanggal DESC LIMIT ${lim(n)}`,
    [kw],
  );
  return rows.map((r) => ({
    type: "LHK_SUBLIM",
    nomor: r.nomor,
    tanggal: fmtDate(r.tanggal),
  }));
};

const searchLhkFinishing = async (kw, n) => {
  const [rows] = await pool.query(
    `SELECT h.lfh_nomor AS nomor, h.lfh_tanggal AS tanggal
     FROM tlhk_finishingmmt_hdr h WHERE h.lfh_nomor LIKE ?
     ORDER BY h.lfh_tanggal DESC LIMIT ${lim(n)}`,
    [kw],
  );
  return rows.map((r) => ({
    type: "LHK_FINISHING",
    nomor: r.nomor,
    tanggal: fmtDate(r.tanggal),
  }));
};

const searchStbj = async (kw, n) => {
  const [rows] = await pool.query(
    `SELECT h.stbj_nomor AS nomor, h.stbj_tanggal AS tanggal
     FROM tstbj_hdr h WHERE h.stbj_nomor LIKE ?
     ORDER BY h.stbj_tanggal DESC LIMIT ${lim(n)}`,
    [kw],
  );
  return rows.map((r) => ({
    type: "STBJ",
    nomor: r.nomor,
    tanggal: fmtDate(r.tanggal),
  }));
};

const searchJadwal = async (kw, n) => {
  const [rows] = await pool.query(
    `SELECT j.nomor_kirim AS nomor, j.gudang AS label, j.tanggal AS tanggal, j.jumlah AS jumlah
     FROM tjadwalkirim j WHERE j.nomor_kirim LIKE ?
     ORDER BY j.tanggal DESC LIMIT ${lim(n)}`,
    [kw],
  );
  return rows.map((r) => ({
    type: "JADWAL_KIRIM",
    nomor: r.nomor,
    label: r.label ? `Gudang: ${r.label}` : "",
    tanggal: fmtDate(r.tanggal),
    jumlah: toNum(r.jumlah),
  }));
};

const searchSj = async (kw, n) => {
  const [rows] = await pool.query(
    `SELECT nomor, tanggal FROM (
       SELECT h.SJ_Nomor AS nomor, h.SJ_Tanggal AS tanggal
       FROM tsj_hdr h WHERE h.SJ_Nomor LIKE ?
       UNION ALL
       SELECT h.SJ_Nomor AS nomor, h.SJ_Tanggal AS tanggal
       FROM tsj_hdr_memo h WHERE h.SJ_Nomor LIKE ?
     ) x ORDER BY tanggal DESC LIMIT ${lim(n)}`,
    [kw, kw],
  );
  return rows.map((r) => ({
    type: "SJ",
    nomor: r.nomor,
    tanggal: fmtDate(r.tanggal),
  }));
};

const SEARCHERS = {
  MAP: searchMap,
  SPK: searchSpk,
  SO: searchSo,
  LHK_CETAK: searchLhkCetak,
  LHK_TEKSTIL: searchLhkTekstil,
  LHK_PROOF: searchLhkProof,
  LHK_PAPERPRINT: searchLhkPaperprint,
  LHK_SUBLIM: searchLhkSublim,
  LHK_FINISHING: searchLhkFinishing,
  STBJ: searchStbj,
  JADWAL_KIRIM: searchJadwal,
  SJ: searchSj,
};

const search = async (type, q) => {
  const keyword = String(q || "").trim();
  if (!keyword) return [];
  const kw = `%${keyword}%`;
  const t = normType(type);
  if (t) {
    if (!NODE_TYPES.includes(t)) return [];
    return await SEARCHERS[t](kw, 20);
  }
  // Semua tipe: masing-masing LIMIT 5 agar tetap ringan.
  const out = [];
  for (const key of NODE_TYPES) {
    try {
      const rows = await SEARCHERS[key](kw, 5);
      out.push(...rows);
    } catch {
      // Satu tipe gagal (mis. tabel belum ada) jangan gugurkan sisanya.
    }
    if (out.length >= 30) break;
  }
  return out.slice(0, 30);
};

// ---------- HELPERS ----------
const spkHeader = async (conn, nomor) => {
  const [r] = await conn.query(
    `SELECT nomor, label, tanggal, jumlah FROM (
       SELECT s.spk_nomor AS nomor, s.spk_nama AS label, s.spk_tanggal AS tanggal, s.spk_jumlah AS jumlah, s.spk_memo AS memo, s.spk_so_ref AS so_ref
       FROM tspk s WHERE s.spk_nomor = ?
       UNION ALL
       SELECT m.mspk_nomor AS nomor, m.mspk_nama AS label, m.mspk_tanggal AS tanggal, m.mspk_jumlah AS jumlah, '' AS memo, '' AS so_ref
       FROM tmemospk m WHERE m.mspk_nomor = ?
     ) x LIMIT 2`,
    [nomor, nomor],
  );
  return r[0] || null;
};

// Header diperkaya per tipe (pola Manksi: node selalu bawa label/tanggal/jumlah).
// Return null bila dokumen tidak ada → controller balas 404.
const nodeHeader = async (conn, type, nomor) => {
  switch (type) {
    case "MAP": {
      const [m] = await conn.query(
        `SELECT mspk_nomor, mspk_nama, mspk_tanggal, mspk_jumlah
         FROM tmemospk WHERE TRIM(mspk_nomor) = TRIM(?) LIMIT 1`,
        [nomor],
      );
      if (!m.length) return null;
      return {
        type: "MAP",
        nomor: m[0].mspk_nomor,
        label: m[0].mspk_nama,
        tanggal: fmtDate(m[0].mspk_tanggal),
        jumlah: toNum(m[0].mspk_jumlah),
      };
    }
    case "SO": {
      const [s] = await conn.query(
        `SELECT so_nomor, so_nama, so_tanggal, so_jumlah
         FROM tsalesorder WHERE TRIM(so_nomor) = TRIM(?) LIMIT 1`,
        [nomor],
      );
      if (!s.length) return null;
      return {
        type: "SO",
        nomor: s[0].so_nomor,
        label: s[0].so_nama,
        tanggal: fmtDate(s[0].so_tanggal),
        jumlah: toNum(s[0].so_jumlah),
      };
    }
    case "JADWAL_KIRIM": {
      const [j] = await conn.query(
        `SELECT nomor_kirim, tanggal, jumlah, gudang
         FROM tjadwalkirim WHERE TRIM(nomor_kirim) = TRIM(?) LIMIT 1`,
        [nomor],
      );
      if (!j.length) return null;
      return {
        type: "JADWAL_KIRIM",
        nomor: j[0].nomor_kirim,
        label: `Gudang: ${j[0].gudang || "-"}`,
        tanggal: fmtDate(j[0].tanggal),
        jumlah: toNum(j[0].jumlah),
      };
    }
    case "STBJ": {
      const [h] = await conn.query(
        `SELECT stbj_nomor, stbj_tanggal
         FROM tstbj_hdr WHERE TRIM(stbj_nomor) = TRIM(?) LIMIT 1`,
        [nomor],
      );
      if (!h.length) return null;
      const [d] = await conn.query(
        `SELECT SUM(stbjd_jumlah) AS qty
         FROM tstbj_dtl WHERE TRIM(stbjd_stbj_nomor) = TRIM(?)`,
        [nomor],
      );
      return {
        type: "STBJ",
        nomor: h[0].stbj_nomor,
        label: "Barang jadi",
        tanggal: fmtDate(h[0].stbj_tanggal),
        jumlah: toNum(d[0] && d[0].qty),
      };
    }
    case "SJ": {
      const [h] = await conn.query(
        `SELECT SJ_Nomor, SJ_Tanggal, sj_approve
         FROM tsj_hdr WHERE TRIM(SJ_Nomor) = TRIM(?) LIMIT 1`,
        [nomor],
      );
      if (h.length) {
        const [d] = await conn.query(
          `SELECT SUM(SJD_Jumlah) AS qty
           FROM tsj_dtl WHERE TRIM(SJD_SJ_Nomor) = TRIM(?)`,
          [nomor],
        );
        return {
          type: "SJ",
          nomor: h[0].SJ_Nomor,
          label: "Pengiriman",
          tanggal: fmtDate(h[0].SJ_Tanggal),
          jumlah: toNum(d[0] && d[0].qty),
          approveStatus: h[0].sj_approve === "Y" ? "APPROVED" : "",
        };
      }
      const [hm] = await conn.query(
        `SELECT SJ_Nomor, SJ_Tanggal
         FROM tsj_hdr_memo WHERE TRIM(SJ_Nomor) = TRIM(?) LIMIT 1`,
        [nomor],
      );
      if (hm.length) {
        const [dm] = await conn.query(
          `SELECT SUM(SJD_Jumlah) AS qty
           FROM tsj_dtl_memo WHERE TRIM(SJD_SJ_Nomor) = TRIM(?)`,
          [nomor],
        );
        return {
          type: "SJ",
          nomor: hm[0].SJ_Nomor,
          label: "Pengiriman (Memo)",
          tanggal: fmtDate(hm[0].SJ_Tanggal),
          jumlah: toNum(dm[0] && dm[0].qty),
          approveStatus: "",
        };
      }
      return null;
    }
    case "LHK_CETAK": {
      const [h] = await conn.query(
        `SELECT lnomor, ltanggal, lmesin, lbarcode_roll, lbahan
         FROM tlhk_mesin_hdr WHERE TRIM(lnomor) = TRIM(?) LIMIT 1`,
        [nomor],
      );
      if (!h.length) return null;
      const [d] = await conn.query(
        `SELECT SUM(ld_total_qtycetak) AS qty
         FROM tlhk_mesin_dtl WHERE TRIM(ld_lnomor) = TRIM(?)`,
        [nomor],
      );
      const bahan = h[0].lbarcode_roll || h[0].lbahan || "-";
      return {
        type: "LHK_CETAK",
        nomor: h[0].lnomor,
        label: `${h[0].lmesin || ""} | ${bahan}`.trim(),
        tanggal: fmtDate(h[0].ltanggal),
        jumlah: toNum(d[0] && d[0].qty),
        kategori: h[0].lbarcode_roll || h[0].lbahan || "",
      };
    }
    case "LHK_TEKSTIL": {
      const [h] = await conn.query(
        `SELECT lth_nomor, lth_tanggal, lth_barcode
         FROM tlhk_tekstilmmt_hdr WHERE TRIM(lth_nomor) = TRIM(?) LIMIT 1`,
        [nomor],
      );
      if (!h.length) return null;
      const [d] = await conn.query(
        `SELECT SUM(ltd_qty_cetak) AS qty, MAX(ltd_brg_kode) AS brg
         FROM tlhk_tekstilmmt_dtl WHERE TRIM(ltd_lth_nomor) = TRIM(?)`,
        [nomor],
      );
      const bahan = (h[0].lth_barcode || (d[0] && d[0].brg) || "-");
      return {
        type: "LHK_TEKSTIL",
        nomor: h[0].lth_nomor,
        label: `Bahan: ${bahan}`,
        tanggal: fmtDate(h[0].lth_tanggal),
        jumlah: toNum(d[0] && d[0].qty),
        kategori: bahan === "-" ? "" : bahan,
      };
    }
    case "LHK_PROOF": {
      const [h] = await conn.query(
        `SELECT lpr_nomor, lpr_tanggal
         FROM tlhk_proofmmt_hdr WHERE TRIM(lpr_nomor) = TRIM(?) LIMIT 1`,
        [nomor],
      );
      if (!h.length) return null;
      const [d] = await conn.query(
        `SELECT SUM(lprd_j_meter) AS qty, MAX(lprd_barcode) AS barcode, MAX(lprd_bahan) AS bahan
         FROM tlhk_proofmmt_dtl WHERE TRIM(lprd_lpr_nomor) = TRIM(?)`,
        [nomor],
      );
      const bahan = ((d[0] && d[0].barcode) || (d[0] && d[0].bahan) || "-");
      return {
        type: "LHK_PROOF",
        nomor: h[0].lpr_nomor,
        label: `Bahan: ${bahan}`,
        tanggal: fmtDate(h[0].lpr_tanggal),
        jumlah: toNum(d[0] && d[0].qty),
        kategori: bahan === "-" ? "" : bahan,
      };
    }
    case "LHK_PAPERPRINT": {
      const [h] = await conn.query(
        `SELECT lsb_nomor, lsb_tanggal
         FROM tlhk_sublim_hdr WHERE TRIM(lsb_nomor) = TRIM(?) LIMIT 1`,
        [nomor],
      );
      if (!h.length) return null;
      const [d] = await conn.query(
        `SELECT SUM(lsbd_jumlah) AS qty, MAX(lsbd_bahan) AS bahan
         FROM tlhk_sublim_dtl WHERE TRIM(lsbd_lsb_nomor) = TRIM(?)`,
        [nomor],
      );
      const bahan = ((d[0] && d[0].bahan) || "-");
      return {
        type: "LHK_PAPERPRINT",
        nomor: h[0].lsb_nomor,
        label: `Bahan: ${bahan}`,
        tanggal: fmtDate(h[0].lsb_tanggal),
        jumlah: toNum(d[0] && d[0].qty),
        kategori: bahan === "-" ? "" : bahan,
      };
    }
    case "LHK_SUBLIM": {
      const [h] = await conn.query(
        `SELECT lr_nomor, lr_tanggal
         FROM tlhk_rtr_hdr WHERE TRIM(lr_nomor) = TRIM(?) LIMIT 1`,
        [nomor],
      );
      if (!h.length) return null;
      const [d] = await conn.query(
        `SELECT SUM(lrd_jumlah) AS qty, MAX(lrd_bahan) AS bahan
         FROM tlhk_rtr_dtl WHERE TRIM(lrd_lr_nomor) = TRIM(?)`,
        [nomor],
      );
      const bahan = ((d[0] && d[0].bahan) || "-");
      return {
        type: "LHK_SUBLIM",
        nomor: h[0].lr_nomor,
        label: `Bahan: ${bahan}`,
        tanggal: fmtDate(h[0].lr_tanggal),
        jumlah: toNum(d[0] && d[0].qty),
        kategori: bahan === "-" ? "" : bahan,
      };
    }
    case "LHK_FINISHING": {
      const [h] = await conn.query(
        `SELECT lfh_nomor, lfh_tanggal
         FROM tlhk_finishingmmt_hdr WHERE TRIM(lfh_nomor) = TRIM(?) LIMIT 1`,
        [nomor],
      );
      if (!h.length) return null;
      const [d] = await conn.query(
        `SELECT SUM(COALESCE(lfd_j_seaming,0) + COALESCE(lfd_j_mataayam,0) + COALESCE(lfd_j_coly,0)) AS qty
         FROM tlhk_finishingmmt_dtl WHERE TRIM(lfd_lfh_nomor) = TRIM(?)`,
        [nomor],
      );
      return {
        type: "LHK_FINISHING",
        nomor: h[0].lfh_nomor,
        label: "Finishing",
        tanggal: fmtDate(h[0].lfh_tanggal),
        jumlah: toNum(d[0] && d[0].qty),
      };
    }
    default:
      return null;
  }
};

// ---------- FORWARD DOWNSTREAM generik ----------
// LHK_*, STBJ, JADWAL_KIRIM, SJ untuk sekumpulan nomor SPK/memo.
// Dipakai expandSpk (target = SPK + memonya) maupun expand MAP
// (target = nomor memo, karena LHK/Jadwal/SJ bisa mereferensikan
// nomor memo secara langsung di kolom *_spk_nomor).
const forwardDownstream = async (conn, targetNomors) => {
  const forward = [];
  if (!targetNomors.length) return forward;
  const placeholders = targetNomors.map(() => "?").join(",");

  // 3. LHK CETAK (Cek relasi ke spk_nomor ATAU memo)
  const [cetak] = await conn.query(
    `SELECT h.lnomor, h.ltanggal, h.lmesin, h.lbarcode_roll, h.lbahan,
            SUM(d.ld_total_qtycetak) AS qty
     FROM tlhk_mesin_dtl d
     INNER JOIN tlhk_mesin_hdr h ON h.lnomor = d.ld_lnomor
     WHERE TRIM(d.ld_spk_nomor) IN (${placeholders})
     GROUP BY h.lnomor ORDER BY h.ltanggal`,
    targetNomors,
  );
  cetak.forEach((x) =>
    forward.push({
      type: "LHK_CETAK",
      nomor: x.lnomor,
      label: `${x.lmesin || ""} | ${x.lbarcode_roll || x.lbahan || "-"}`.trim(),
      tanggal: fmtDate(x.ltanggal),
      jumlah: toNum(x.qty),
      kategori: x.lbarcode_roll || x.lbahan || "",
    }),
  );

  // 4. LHK TEKSTIL
  const [tekstil] = await conn.query(
    `SELECT h.lth_nomor, h.lth_tanggal, SUM(d.ltd_qty_cetak) AS qty,
            MAX(h.lth_barcode) AS barcode, MAX(d.ltd_brg_kode) AS brg
     FROM tlhk_tekstilmmt_dtl d
     INNER JOIN tlhk_tekstilmmt_hdr h ON h.lth_nomor = d.ltd_lth_nomor
     WHERE TRIM(d.ltd_spk_nomor) IN (${placeholders})
     GROUP BY h.lth_nomor ORDER BY h.lth_tanggal`,
    targetNomors,
  );
  tekstil.forEach((x) =>
    forward.push({
      type: "LHK_TEKSTIL",
      nomor: x.lth_nomor,
      label: `Bahan: ${x.barcode || x.brg || "-"}`,
      tanggal: fmtDate(x.lth_tanggal),
      jumlah: toNum(x.qty),
      kategori: x.barcode || x.brg || "",
    }),
  );

  // 5. LHK PROOF
  const [proof] = await conn.query(
    `SELECT h.lpr_nomor, h.lpr_tanggal, MAX(d.lprd_barcode) AS lprd_barcode, MAX(d.lprd_bahan) AS lprd_bahan,
            SUM(d.lprd_j_meter) AS jmeter
     FROM tlhk_proofmmt_dtl d
     INNER JOIN tlhk_proofmmt_hdr h ON h.lpr_nomor = d.lprd_lpr_nomor
     WHERE TRIM(d.lprd_spk_nomor) IN (${placeholders})
     GROUP BY h.lpr_nomor ORDER BY h.lpr_tanggal`,
    targetNomors,
  );
  proof.forEach((x) =>
    forward.push({
      type: "LHK_PROOF",
      nomor: x.lpr_nomor,
      label: `Bahan: ${x.lprd_barcode || x.lprd_bahan || "-"}`,
      tanggal: fmtDate(x.lpr_tanggal),
      jumlah: toNum(x.jmeter),
      kategori: x.lprd_barcode || x.lprd_bahan || "",
    }),
  );

  // 6. LHK PAPERPRINT (tabel tlhk_sublim_*)
  const [paperprint] = await conn.query(
    `SELECT h.lsb_nomor, h.lsb_tanggal, SUM(d.lsbd_jumlah) AS qty, MAX(d.lsbd_bahan) AS bahan
     FROM tlhk_sublim_dtl d
     INNER JOIN tlhk_sublim_hdr h ON h.lsb_nomor = d.lsbd_lsb_nomor
     WHERE TRIM(d.lsbd_spk_nomor) IN (${placeholders})
     GROUP BY h.lsb_nomor ORDER BY h.lsb_tanggal`,
    targetNomors,
  );
  paperprint.forEach((x) =>
    forward.push({
      type: "LHK_PAPERPRINT",
      nomor: x.lsb_nomor,
      label: `Bahan: ${x.bahan || "-"}`,
      tanggal: fmtDate(x.lsb_tanggal),
      jumlah: toNum(x.qty),
      kategori: x.bahan || "",
    }),
  );

  // 7. LHK SUBLIM / ROLL TO ROLL (tabel tlhk_rtr_*)
  const [sublim] = await conn.query(
    `SELECT h.lr_nomor, h.lr_tanggal, SUM(d.lrd_jumlah) AS qty, MAX(d.lrd_bahan) AS bahan
     FROM tlhk_rtr_dtl d
     INNER JOIN tlhk_rtr_hdr h ON h.lr_nomor = d.lrd_lr_nomor
     WHERE TRIM(d.lrd_spk_nomor) IN (${placeholders})
     GROUP BY h.lr_nomor ORDER BY h.lr_tanggal`,
    targetNomors,
  );
  sublim.forEach((x) =>
    forward.push({
      type: "LHK_SUBLIM",
      nomor: x.lr_nomor,
      label: `Bahan: ${x.bahan || "-"}`,
      tanggal: fmtDate(x.lr_tanggal),
      jumlah: toNum(x.qty),
      kategori: x.bahan || "",
    }),
  );

  // 7. LHK FINISHING
  const [fin] = await conn.query(
    `SELECT h.lfh_nomor, h.lfh_tanggal,
            SUM(COALESCE(d.lfd_j_seaming,0) + COALESCE(d.lfd_j_mataayam,0) + COALESCE(d.lfd_j_coly,0)) AS qty
     FROM tlhk_finishingmmt_dtl d
     INNER JOIN tlhk_finishingmmt_hdr h ON h.lfh_nomor = d.lfd_lfh_nomor
     WHERE TRIM(d.lfd_spk_nomor) IN (${placeholders})
     GROUP BY h.lfh_nomor ORDER BY h.lfh_tanggal`,
    targetNomors,
  );
  fin.forEach((x) =>
    forward.push({
      type: "LHK_FINISHING",
      nomor: x.lfh_nomor,
      label: "Finishing",
      tanggal: fmtDate(x.lfh_tanggal),
      jumlah: toNum(x.qty),
    }),
  );

  // 8. STBJ
  const [stbj] = await conn.query(
    `SELECT h.stbj_nomor, h.stbj_tanggal, SUM(d.stbjd_jumlah) AS qty
     FROM tstbj_dtl d
     INNER JOIN tstbj_hdr h ON h.stbj_nomor = d.stbjd_stbj_nomor
     WHERE TRIM(d.stbjd_spk_nomor) IN (${placeholders})
     GROUP BY h.stbj_nomor ORDER BY h.stbj_tanggal`,
    targetNomors,
  );
  stbj.forEach((x) =>
    forward.push({
      type: "STBJ",
      nomor: x.stbj_nomor,
      label: "Barang jadi",
      tanggal: fmtDate(x.stbj_tanggal),
      jumlah: toNum(x.qty),
    }),
  );

  // 9. JADWAL KIRIM
  const [jadwal] = await conn.query(
    `SELECT nomor_kirim, tanggal, jumlah, gudang
     FROM tjadwalkirim
     WHERE TRIM(spk_nomor) IN (${placeholders})
     ORDER BY tanggal`,
    targetNomors,
  );
  jadwal.forEach((x) =>
    forward.push({
      type: "JADWAL_KIRIM",
      nomor: x.nomor_kirim,
      label: `Gudang: ${x.gudang || "-"}`,
      tanggal: fmtDate(x.tanggal),
      jumlah: toNum(x.jumlah),
    }),
  );

  // 10. SURAT JALAN (reguler + memo)
  const [sj] = await conn.query(
    `SELECT h.SJ_Nomor AS nomor, h.SJ_Tanggal AS tanggal, SUM(d.SJD_Jumlah) AS qty,
            h.sj_approve AS approve
     FROM tsj_dtl d
     INNER JOIN tsj_hdr h ON h.SJ_Nomor = d.SJD_SJ_Nomor
     WHERE TRIM(d.SJD_SPK_Nomor) IN (${placeholders})
     GROUP BY h.SJ_Nomor
     UNION ALL
     SELECT h.SJ_Nomor AS nomor, h.SJ_Tanggal AS tanggal, SUM(d.SJD_Jumlah) AS qty,
            '' AS approve
     FROM tsj_dtl_memo d
     INNER JOIN tsj_hdr_memo h ON h.SJ_Nomor = d.SJD_SJ_Nomor
     WHERE TRIM(d.SJD_MSPK_Nomor) IN (${placeholders})
     GROUP BY h.SJ_Nomor
     ORDER BY tanggal`,
    [...targetNomors, ...targetNomors],
  );
  sj.forEach((x) =>
    forward.push({
      type: "SJ",
      nomor: x.nomor,
      label: "Pengiriman",
      tanggal: fmtDate(x.tanggal),
      jumlah: toNum(x.qty),
      approveStatus: x.approve === "Y" ? "APPROVED" : "",
    }),
  );

  return forward;
};

// ---------- EXPAND SPK (DIPERBAIKI) ----------
const expandSpk = async (conn, nomor) => {
  const head = await spkHeader(conn, nomor);
  if (!head) return null;

  const node = {
    type: "SPK",
    nomor: head.nomor,
    label: head.label,
    tanggal: fmtDate(head.tanggal),
    jumlah: toNum(head.jumlah),
  };
  const backward = [];
  const forward = [];

  // 1. Ambil detail SPK reguler (memo & so_ref).
  // tspk punya 3 kolom kandidat memo; yang pertama resolve di tmemospk menang.
  // (spk_nomormemo kadang berisi nomor non-memo, jadi wajib resolve, bukan
  // langsung dipercaya.)
  const [reg] = await conn.query(
    `SELECT spk_memo, spk_mspk_nomor, spk_nomormemo, spk_so_ref FROM tspk WHERE TRIM(spk_nomor) = TRIM(?) LIMIT 1`,
    [nomor],
  );

  let memoNomor = "";
  if (reg.length > 0) {
    const candidates = [
      reg[0].spk_memo,
      reg[0].spk_mspk_nomor,
      reg[0].spk_nomormemo,
    ]
      .map((v) => String(v || "").trim())
      .filter(Boolean);
    for (const cand of candidates) {
      const mapNode = await nodeHeader(conn, "MAP", cand);
      if (mapNode) {
        backward.push(mapNode);
        memoNomor = cand;
        break;
      }
    }

    // Fallback konvensi penomoran MAP-<spk_nomor> bila FK memo kosong.
    // Terbukti sistematis di DB (ratusan pasangan MAP-X/SPK X cocok,
    // FK sering kosong) dan divalidasi user sebagai satu kesatuan.
    // Sengaja TIDAK dimasukkan ke targetNomors downstream agar tidak
    // menciptakan edge semu SPK->LHK milik memo (falsafah Manksi:
    // jangan merepresentasikan relasi yang tidak ada di database).
    if (!backward.some((b) => b.type === "MAP")) {
      const conv = await nodeHeader(conn, "MAP", `MAP-${nomor}`);
      if (conv) backward.unshift(conv);
    }

    // SO (Forward)
    if (reg[0].spk_so_ref) {
      const soNode = await nodeHeader(conn, "SO", String(reg[0].spk_so_ref).trim());
      if (soNode) forward.push(soNode);
    }
  }

  // 2. Jika SPK yang dicari adalah SPK Memo (tmemospk)
  const [memoSelf] = await conn.query(
    `SELECT mspk_nomor FROM tmemospk WHERE TRIM(mspk_nomor) = TRIM(?) LIMIT 1`,
    [nomor],
  );
  if (memoSelf.length > 0) {
    memoNomor = nomor;
    // SO via tsalesorder.so_memo
    const [s] = await conn.query(
      `SELECT so_nomor, so_nama, so_tanggal, so_jumlah
       FROM tsalesorder WHERE TRIM(so_memo) = TRIM(?) ORDER BY so_tanggal DESC LIMIT 5`,
      [nomor],
    );
    s.forEach((x) =>
      backward.push({
        type: "SO",
        nomor: x.so_nomor,
        label: x.so_nama,
        tanggal: fmtDate(x.so_tanggal),
        jumlah: toNum(x.so_jumlah),
      }),
    );

    // Cari SPK reguler turunan dari memo ini
    const [derivedSpk] = await conn.query(
      `SELECT spk_nomor, spk_nama, spk_tanggal, spk_jumlah
       FROM tspk WHERE TRIM(spk_memo) = TRIM(?) LIMIT 10`,
      [nomor],
    );
    derivedSpk.forEach((ds) => {
      forward.push({
        type: "SPK",
        nomor: ds.spk_nomor,
        label: ds.spk_nama,
        tanggal: fmtDate(ds.spk_tanggal),
        jumlah: toNum(ds.spk_jumlah),
      });
    });
  }

  // Kumpulan nomor pencarian (SPK nomor asli dan memo bila ada relasi ganda)
  const targetNomors = [nomor];
  if (memoNomor && memoNomor !== nomor) {
    targetNomors.push(memoNomor);
  }

  // Downstream LHK_*/STBJ/Jadwal/SJ (helper bersama dengan expand MAP).
  forward.push(...(await forwardDownstream(conn, targetNomors)));

  return { node, backward, forward };
};

// ---------- EXPAND GENERIC (node selain SPK) ----------
const expandOther = async (conn, type, nomor) => {
  const backSpk = async (spkNomor) => {
    const h = await spkHeader(conn, String(spkNomor || "").trim());
    if (!h) return null;
    return {
      type: "SPK",
      nomor: h.nomor,
      label: h.label,
      tanggal: fmtDate(h.tanggal),
      jumlah: toNum(h.jumlah),
    };
  };
  const empty = (t, n, label = "") => ({
    node: { type: t, nomor: n, label },
    backward: [],
    forward: [],
  });

  // MAP: backward SO via so_memo (pola Manksi MAP<->SO);
  // forward SPK turunan (FK spk_memo + fallback konvensi MAP-<spk>)
  // + downstream LHK/STBJ/Jadwal/SJ yang mereferensikan nomor memo langsung.
  if (type === "MAP") {
    const node = await nodeHeader(conn, "MAP", nomor);
    if (!node) return null;
    const backward = [];
    const [sos] = await conn.query(
      `SELECT so_nomor, so_nama, so_tanggal, so_jumlah
       FROM tsalesorder WHERE TRIM(so_memo) = TRIM(?) ORDER BY so_tanggal DESC LIMIT 5`,
      [nomor],
    );
    sos.forEach((x) =>
      backward.push({
        type: "SO",
        nomor: x.so_nomor,
        label: x.so_nama,
        tanggal: fmtDate(x.so_tanggal),
        jumlah: toNum(x.so_jumlah),
      }),
    );
    const [spks] = await conn.query(
      `SELECT spk_nomor FROM tspk WHERE TRIM(spk_memo) = TRIM(?) LIMIT 20`,
      [nomor],
    );
    const forward = [];
    const seenSpk = new Set();
    for (const r of spks) {
      const b = await backSpk(r.spk_nomor);
      if (b && !seenSpk.has(b.nomor)) {
        seenSpk.add(b.nomor);
        forward.push(b);
      }
    }
    // Fallback konvensi: SPK yang nomornya = suffix memo (MAP-xxx → xxx)
    // dan belum tertaut FK ke memo mana pun (cerminan fallback di expandSpk).
    if (String(nomor).trim().toUpperCase().startsWith("MAP-")) {
      const suffix = String(nomor).trim().slice(4).trim();
      if (suffix && !seenSpk.has(suffix)) {
        const [cs] = await conn.query(
          `SELECT spk_nomor, spk_memo, spk_mspk_nomor FROM tspk WHERE TRIM(spk_nomor) = TRIM(?) LIMIT 1`,
          [suffix],
        );
        if (cs.length) {
          const fkMemo = `${cs[0].spk_memo || ""}${cs[0].spk_mspk_nomor || ""}`.trim();
          if (!fkMemo) {
            const b = await backSpk(suffix);
            if (b) {
              seenSpk.add(b.nomor);
              forward.push(b);
            }
          }
        }
      }
    }
    // Downstream yang menunjuk nomor memo secara langsung.
    forward.push(...(await forwardDownstream(conn, [nomor])));
    return { node, backward, forward };
  }

  // SO: backward MAP via so_memo, forward SPK via spk_so_ref.
  if (type === "SO") {
    const node = await nodeHeader(conn, "SO", nomor);
    if (!node) return null;
    const backward = [];
    const [s] = await conn.query(
      `SELECT so_memo FROM tsalesorder WHERE TRIM(so_nomor) = TRIM(?) LIMIT 1`,
      [nomor],
    );
    const memo = s.length ? String(s[0].so_memo || "").trim() : "";
    if (memo) {
      const mapNode = await nodeHeader(conn, "MAP", memo);
      if (mapNode) backward.push(mapNode);
    }
    const [spks] = await conn.query(
      `SELECT spk_nomor FROM tspk WHERE TRIM(spk_so_ref) = TRIM(?) LIMIT 20`,
      [nomor],
    );
    const forward = [];
    for (const r of spks) {
      const b = await backSpk(r.spk_nomor);
      if (b) forward.push(b);
    }
    return { node, backward, forward };
  }

  // SJ: node diperkaya + backward ke SPK reguler & memo.
  if (type === "SJ") {
    const node = await nodeHeader(conn, "SJ", nomor);
    if (!node) return null;
    const [reg] = await conn.query(
      `SELECT DISTINCT TRIM(SJD_SPK_Nomor) AS spk FROM tsj_dtl
       WHERE TRIM(SJD_SJ_Nomor) = TRIM(?) LIMIT 20`,
      [nomor],
    );
    const [mem] = await conn.query(
      `SELECT DISTINCT TRIM(SJD_MSPK_Nomor) AS spk FROM tsj_dtl_memo
       WHERE TRIM(SJD_SJ_Nomor) = TRIM(?) LIMIT 20`,
      [nomor],
    );
    const seen = new Set();
    const backward = [];
    for (const r of [...reg, ...mem]) {
      const spk = String(r.spk || "").trim();
      if (!spk || seen.has(spk)) continue;
      seen.add(spk);
      const b = await backSpk(spk);
      if (b) backward.push(b);
    }
    return { node, backward, forward: [] };
  }

  const linkSpecs = {
    JADWAL_KIRIM: {
      table: "tjadwalkirim",
      col: "spk_nomor",
      key: "nomor_kirim",
    },
    STBJ: {
      table: "tstbj_dtl",
      col: "stbjd_spk_nomor",
      key: "stbjd_stbj_nomor",
    },
    LHK_CETAK: {
      table: "tlhk_mesin_dtl",
      col: "ld_spk_nomor",
      key: "ld_lnomor",
    },
    LHK_TEKSTIL: {
      table: "tlhk_tekstilmmt_dtl",
      col: "ltd_spk_nomor",
      key: "ltd_lth_nomor",
    },
    LHK_PROOF: {
      table: "tlhk_proofmmt_dtl",
      col: "lprd_spk_nomor",
      key: "lprd_lpr_nomor",
    },
    LHK_PAPERPRINT: {
      table: "tlhk_sublim_dtl",
      col: "lsbd_spk_nomor",
      key: "lsbd_lsb_nomor",
    },
    LHK_SUBLIM: {
      table: "tlhk_rtr_dtl",
      col: "lrd_spk_nomor",
      key: "lrd_lr_nomor",
    },
    LHK_FINISHING: {
      table: "tlhk_finishingmmt_dtl",
      col: "lfd_spk_nomor",
      key: "lfd_lfh_nomor",
    },
  };
  const spec = linkSpecs[type];
  if (!spec) return empty(type, nomor);
  // Node diperkaya dulu; null = dokumen tidak ada → 404.
  const node = await nodeHeader(conn, type, nomor);
  if (!node) return null;
  const [rows] = await conn.query(
    `SELECT DISTINCT TRIM(${spec.col}) AS spk FROM ${spec.table}
     WHERE TRIM(${spec.key}) = TRIM(?) LIMIT 20`,
    [nomor],
  );
  const backward = [];
  for (const r of rows) {
    const spk = String(r.spk || "").trim();
    if (!spk) continue;
    const b = await backSpk(spk);
    if (b) backward.push(b);
  }
  return { node, backward, forward: [] };
};

const expand = async (type, nomor) => {
  const t = normType(type);
  const n = String(nomor || "").trim();
  const conn = await pool.getConnection();
  try {
    if (t === "SPK") {
      // Satu dokumen, satu graf kanonis: nomor yang hanya ada di tmemospk
      // (memo dibuka sebagai SPK) dinormalisasi ke expand MAP.
      const [inTspk] = await conn.query(
        `SELECT 1 AS ok FROM tspk WHERE TRIM(spk_nomor) = TRIM(?) LIMIT 1`,
        [n],
      );
      if (!inTspk.length) {
        const [inMemo] = await conn.query(
          `SELECT 1 AS ok FROM tmemospk WHERE TRIM(mspk_nomor) = TRIM(?) LIMIT 1`,
          [n],
        );
        if (inMemo.length) return await expandOther(conn, "MAP", n);
      }
      return await expandSpk(conn, n);
    }
    return await expandOther(conn, t, n);
  } finally {
    conn.release();
  }
};

module.exports = { search, expand, NODE_TYPES };
