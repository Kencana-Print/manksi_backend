const db = require("../../config/database");

const PREFIX = "QCB";
const LOCK_NAME = "qc_bahan_nomor";

const EPS = 1e-9;
const num = (v) => {
  const n = Number(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};
const r2 = (n) => Math.round(n * 100) / 100;

// "165-170" -> {165,170}; "170" -> {170,170}; "-", kosong, teks tanpa angka -> {0,0}.
// cmKeInci: angka ber-"CM" dikonversi ke inci (untuk setting).
const parseSpec = (txt, { cmKeInci = false } = {}) => {
  const s = String(txt || "");
  const angka = "(\\d+(?:[.,]\\d+)?)";
  let min = 0;
  let max = 0;
  const rg = s.match(new RegExp(`${angka}\\s*-\\s*${angka}`));
  if (rg) {
    min = num(rg[1]);
    max = num(rg[2]);
    if (min > max) [min, max] = [max, min];
  } else {
    const one = s.match(new RegExp(angka));
    if (one) min = max = num(one[1]);
  }
  if (cmKeInci && /cm/i.test(s)) {
    min = r2(min / 2.54);
    max = r2(max / 2.54);
  }
  return { min, max };
};

// Spesifikasi PO. terbaca=false -> penilaian otomatis dimatikan (nilai manual + alasan)
const bacaSpec = (line) => {
  const g = parseSpec(line.pod_gramasia);
  const s = parseSpec(line.pod_setting, { cmKeInci: true });
  const gramasiAda = g.min > 0 && g.max > 0;
  // Gramasi PO benar-benar kosong ("" atau "-"): tidak dinilai, cukup setting
  const gramasiKosong = !String(line.pod_gramasia ?? "").replace(/[-\s]/g, "");
  const settingAda = s.min > 0 && s.max > 0;
  return {
    gMin: g.min,
    gMax: g.max,
    sMin: s.min,
    sMax: s.max,
    gramasiAda,
    settingAda,
    terbaca: gramasiAda || settingAda,
  };
};

const getParam = async (conn) => {
  const [rows] = await conn.query(
    `SELECT qcm_kode, qcm_nilai FROM tqc_bahan_param
     WHERE qcm_kode IN ('TOLERANSI_GRAMASI','TOLERANSI_SETTING','PERSEN_CEK_KAOSAN','PERSEN_CEK_CORPORATE','PERSEN_CEK_KATUN','WARNA_BATAS_NILAI3','WARNA_BATAS_NILAI2')`,
  );
  const m = {};
  rows.forEach((r) => {
    m[r.qcm_kode] = Number(r.qcm_nilai);
  });
  return {
    tolGramasi: m.TOLERANSI_GRAMASI ?? 5,
    tolSetting: m.TOLERANSI_SETTING ?? 0.5,
    persenKaosan: m.PERSEN_CEK_KAOSAN ?? 50,
    persenCorporate: m.PERSEN_CEK_CORPORATE ?? 20,
    persenKatun: m.PERSEN_CEK_KATUN ?? 30,
    warnaBatas3: m.WARNA_BATAS_NILAI3 ?? 1.5,
    warnaBatas2: m.WARNA_BATAS_NILAI2 ?? 2,
  };
};

// KAOSAN bila project bahan = 'KAOSAN', selain itu CORPORATE
// Persen sampling. Prioritas: KAOSAN 50 > PE 20 > katun/drill 30 > lainnya 20.
const KATUN_COMBED = ["CM16", "CM20", "CM24", "CM30"]; // sama dengan COMBED_GROUP di MkbFormView

const getJenisCek = async (conn, bhnKode, p) => {
  const [rows] = await conn.query(
    `SELECT IFNULL(pr.project, 'REGULER') AS project,
            IFNULL(j.bj_nama, '') AS nama_jenis,
            IFNULL(b.Bhn_Name, '') AS nama_bahan
     FROM tbahan b
     LEFT JOIN tbahan_project pr ON pr.kode = MID(b.Bhn_kode, 10, 1)
     LEFT JOIN tbahan_jenis j ON j.bj_kode = LEFT(b.Bhn_kode, 2)
     WHERE b.Bhn_kode = ?`,
    [bhnKode],
  );
  const up = (s) =>
    String(s || "")
      .trim()
      .toUpperCase();
  const r = rows[0] || {};

  if (up(r.project) === "KAOSAN") {
    return { jenis: "KAOSAN", persen: p.persenKaosan };
  }

  const jenis = up(r.nama_jenis);
  const kataPertama = up(r.nama_bahan).split(/\s+/)[0];
  const adaPe = /(^|[^A-Z])PE/.test(jenis); // kata berawalan PE
  const katunDrill =
    jenis.includes("KATUN") ||
    jenis.includes("DRILL") ||
    KATUN_COMBED.includes(kataPertama);

  if (!adaPe && katunDrill) {
    return { jenis: "CORPORATE", persen: p.persenKatun };
  }
  return { jenis: "CORPORATE", persen: p.persenCorporate };
};

// Dibulatkan ke atas, minimal 1 roll
const hitungRollCek = (roll, persen) =>
  roll > 0 ? Math.max(1, Math.ceil((roll * persen) / 100)) : 0;

const OK_NO = ["OK", "NO"];
const okNo = (v) =>
  String(v ?? "")
    .trim()
    .toUpperCase();

// null = kosong, NaN = bukan angka
const parseWarna = (v) => {
  const s = String(v ?? "")
    .trim()
    .replace(",", ".");
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : NaN;
};

const nilaiWarna = (w, p) =>
  w <= p.warnaBatas3 + EPS ? 3 : w <= p.warnaBatas2 + EPS ? 2 : 1;

const arahSpec = (v, min, max, tol) =>
  v < min - tol - EPS ? "RENDAH" : v > max + tol + EPS ? "TINGGI" : "";

// Satu roll. Nilai roll = nilai terendah dari semua parameter.
// Gramasi dan setting hanya dinilai bila spesifikasi PO terbaca.
const evalRoll = (rl, spec, p) => {
  const atas = num(rl.gramasi_atas);
  const bawah = num(rl.gramasi_bawah);
  const st = num(rl.setting_cek);
  const h = rl.hasil || {};
  const warna = parseWarna(h.warna);
  const hf = okNo(h.handfeel);
  const bw = okNo(h.bowing);
  const sh = okNo(h.shrinkage);
  const kl = okNo(h.kelunturan);
  const warnaValid = warna !== null && !Number.isNaN(warna);

  const kurang = [];
  if (spec.gramasiAda) {
    if (!(atas > 0)) kurang.push("gramasi atas");
    if (!(bawah > 0)) kurang.push("gramasi bawah");
  }
  if (!(st > 0)) kurang.push("setting");
  if (!warnaValid) kurang.push("warna");
  if (!OK_NO.includes(hf)) kurang.push("handfeel");
  if (!OK_NO.includes(bw)) kurang.push("bowing");
  if (!OK_NO.includes(sh)) kurang.push("shrinkage");
  if (!OK_NO.includes(kl)) kurang.push("kelunturan");
  const terisi = kurang.length === 0;

  const okG = (v) =>
    v >= spec.gMin - p.tolGramasi - EPS && v <= spec.gMax + p.tolGramasi + EPS;
  const okS =
    st >= spec.sMin - p.tolSetting - EPS &&
    st <= spec.sMax + p.tolSetting + EPS;

  let nilai = 0;
  if (terisi) {
    const skor = [
      nilaiWarna(warna, p),
      hf === "OK" ? 3 : 2,
      bw === "OK" ? 3 : 1,
      sh === "OK" ? 3 : 1,
      kl === "OK" ? 3 : 1,
    ];
    if (spec.gramasiAda) skor.push(okG(atas) && okG(bawah) ? 3 : 1);
    if (spec.settingAda) skor.push(okS ? 3 : 1);
    nilai = Math.min(...skor);
  }

  // Teks hasil gramasi/setting untuk kolom qcr_h_* (dipakai Cetak)
  let gramasiTxt = "-";
  let settingTxt = "-";
  if (spec.gramasiAda && atas > 0 && bawah > 0) {
    const arah = [
      ...new Set(
        [
          arahSpec(atas, spec.gMin, spec.gMax, p.tolGramasi),
          arahSpec(bawah, spec.gMin, spec.gMax, p.tolGramasi),
        ].filter(Boolean),
      ),
    ].join("/");
    gramasiTxt = arah || "OK";
  }
  if (spec.settingAda && st > 0) {
    settingTxt = arahSpec(st, spec.sMin, spec.sMax, p.tolSetting) || "OK";
  }

  return {
    atas,
    bawah,
    st,
    terisi,
    kurang,
    nilai,
    sesuai: nilai === 3,
    hf,
    bw,
    sh,
    kl,
    warnaTxt: warnaValid
      ? String(warna)
      : String(h.warna ?? "")
          .trim()
          .slice(0, 100),
    gramasiTxt,
    settingTxt,
  };
};

// Semua roll bernilai 3 -> 3; semua bernilai 1 -> 1; selain itu 2; belum ada roll lengkap -> 0
const hitungNilaiLot = (rollsEval) => {
  const dicek = rollsEval.filter((x) => x.terisi);
  if (dicek.length === 0) return 0;
  if (dicek.every((x) => x.nilai === 3)) return 3;
  if (dicek.every((x) => x.nilai === 1)) return 1;
  return 2;
};

// Sisa PO = qty PO - kedatangan QC sebelumnya (tanpa DRAFT, tanpa lot REJECT, tanpa dokumen ini)
const hitungSisaPo = async (
  conn,
  poNomor,
  podNourut,
  qtyPo,
  excludeNomor = "",
) => {
  const [r] = await conn.query(
    `SELECT IFNULL(SUM(d.qcd_qty_kg), 0) AS terima
     FROM tqc_bahan_hdr h
     INNER JOIN tqc_bahan_dtl d ON d.qcd_qc_nomor = h.qc_nomor
     WHERE h.qc_po_nomor = ? AND h.qc_pod_nourut = ?
       AND h.qc_status <> 'DRAFT' AND h.qc_nomor <> ?
       AND d.qcd_keputusan <> 'REJECT'`,
    [poNomor, Number(podNourut), excludeNomor],
  );
  return r2(qtyPo - Number(r[0].terima));
};

const hitungStatusDok = (keps) => {
  if (keps.some((k) => !k)) return "MENUNGGU";
  if (keps.every((k) => k === "LANJUT")) return "LANJUT";
  if (keps.every((k) => k === "REJECT")) return "REJECT";
  if (keps.every((k) => k === "TUNDA")) return "TUNDA";
  return "SEBAGIAN";
};

// Vendor sesuai jenis PO: CELUP -> celup = supplier PO, greige = supplier PO greige.
// GREIGE dan BAHAN -> supplier PO ditaruh di vendor greige, vendor celup kosong.
const resolveVendor = async (conn, hdr) => {
  const jenis = Number(hdr.po_jenis);
  if (jenis === 2) {
    let greige = "";
    if (hdr.po_greige) {
      const [g] = await conn.query(
        `SELECT s.sup_nama
         FROM tpo_hdr p
         LEFT JOIN tsupplier s ON s.sup_kode = p.po_sup_kode
         WHERE p.po_nomor = ?`,
        [hdr.po_greige],
      );
      greige = g[0]?.sup_nama || "";
    }
    return { greige, celup: hdr.sup_nama || "" };
  }
  return { greige: hdr.sup_nama || "", celup: "" };
};

const loadPoLine = async (conn, poNomor, nourut) => {
  const [rows] = await conn.query(
    `
    SELECT
      h.po_nomor, h.po_jenis, h.po_greige, h.po_tanggal, h.po_close,
      s.sup_nama,
      d.pod_nourut, d.pod_bhn_kode, d.pod_bhn_satuan,
      IFNULL(NULLIF(d.pod_namaext, ''), b.Bhn_Name) AS nama_kain,
      IFNULL(j.bj_nama, '') AS nama_jenis,
      IFNULL(w.bw_nama, '') AS nama_warna,
      d.pod_gramasia, d.pod_setting, d.pod_roll, d.pod_Jumlah, d.pod_status
    FROM tpo_hdr h
    INNER JOIN tpo_dtl d ON d.pod_po_nomor = h.po_nomor
    LEFT JOIN tbahan b ON b.bhn_kode = d.pod_bhn_kode
    LEFT JOIN tbahan_jenis j ON j.bj_kode = LEFT(d.pod_bhn_kode, 2)
    LEFT JOIN tbahan_warna w ON w.bw_kode = MID(d.pod_bhn_kode, 3, 3)
    LEFT JOIN tsupplier s ON s.sup_kode = COALESCE(NULLIF(d.pod_sup_kode, ''), h.po_sup_kode)
    WHERE h.po_nomor = ? AND d.pod_nourut = ?
    `,
    [poNomor, Number(nourut)],
  );
  if (rows.length === 0) throw new Error("Baris PO Bahan tidak ditemukan.");
  if (Number(rows[0].pod_status) === 2) {
    throw new Error("Baris PO tersebut berstatus Cancel.");
  }
  if (Number(rows[0].po_close) === 9) {
    throw new Error("PO tersebut sudah dibatalkan.");
  }
  return rows[0];
};

const generateNomor = async (conn, tgl) => {
  const tahun = String(tgl).substring(0, 4);
  const [rows] = await conn.query(
    `SELECT IFNULL(MAX(CAST(SUBSTRING_INDEX(SUBSTRING_INDEX(qc_nomor, '/', 2), '/', -1) AS UNSIGNED)), 0) AS maks
     FROM tqc_bahan_hdr
     WHERE qc_nomor LIKE ?`,
    [`${PREFIX}/%/${tahun}`],
  );
  const next = Number(rows[0].maks) + 1;
  return `${PREFIX}/${String(next).padStart(5, "0")}/${tahun}`;
};

// --- LOOKUP PO (dipakai modal pilih PO saat membuat QC) ---
const lookupPo = async (query) => {
  const now = new Date();
  const dStart =
    query.startDate ||
    new Date(now.getFullYear(), now.getMonth(), 1)
      .toISOString()
      .substring(0, 10);
  const dEnd = query.endDate || now.toISOString().substring(0, 10);

  const params = [dStart, dEnd];
  let searchSql = "";
  if (query.search) {
    searchSql = `AND (h.po_nomor LIKE ? OR d.pod_namaext LIKE ? OR b.Bhn_Name LIKE ? OR s.sup_nama LIKE ?)`;
    const like = `%${query.search}%`;
    params.push(like, like, like, like);
  }

  const [rows] = await db.query(
    `
    SELECT
      h.po_nomor AS PO,
      IF(h.po_jenis = 1, "GREIGE", IF(h.po_jenis = 2, "CELUP", IF(h.po_jenis = 4, "LAIN-LAIN", "BAHAN"))) AS JenisPO,
      DATE_FORMAT(h.po_tanggal, "%Y-%m-%d") AS TanggalPO,
      s.sup_nama AS Supplier,
      d.pod_nourut AS Nourut,
      d.pod_bhn_kode AS KodeBahan,
      IFNULL(NULLIF(d.pod_namaext, ''), b.Bhn_Name) AS NamaKain,
      d.pod_gramasia AS Gramasi,
      d.pod_setting AS Setting,
      d.pod_roll AS Roll,
      d.pod_Jumlah AS Qty,
      d.pod_bhn_satuan AS Satuan
    FROM tpo_hdr h
    INNER JOIN tpo_dtl d ON d.pod_po_nomor = h.po_nomor
    LEFT JOIN tbahan b ON b.bhn_kode = d.pod_bhn_kode
    LEFT JOIN tsupplier s ON s.sup_kode = COALESCE(NULLIF(d.pod_sup_kode, ''), h.po_sup_kode)
    WHERE h.po_tanggal >= ? AND h.po_tanggal < DATE_ADD(?, INTERVAL 1 DAY)
      AND h.po_close <> 9
      AND d.pod_status <> 2
      ${searchSql}
    ORDER BY h.po_tanggal DESC, h.po_nomor DESC, d.pod_nourut ASC
    LIMIT 200
    `,
    params,
  );

  // Jumlah QC yang sudah ada per baris PO (kedatangan bertahap diperbolehkan,
  // jadi hanya informasi, bukan filter). Dihitung terpisah agar tidak terkena
  // masalah collation antar tabel.
  const countMap = {};
  if (rows.length > 0) {
    const poList = [...new Set(rows.map((r) => r.PO))];
    const [cnt] = await db.query(
      `SELECT qc_po_nomor, qc_pod_nourut, COUNT(*) AS jml
       FROM tqc_bahan_hdr
       WHERE qc_po_nomor IN (?)
       GROUP BY qc_po_nomor, qc_pod_nourut`,
      [poList],
    );
    cnt.forEach((c) => {
      countMap[`${c.qc_po_nomor}|${c.qc_pod_nourut}`] = Number(c.jml);
    });
  }

  return rows.map((r) => ({
    ...r,
    QcCount: countMap[`${r.PO}|${r.Nourut}`] || 0,
  }));
};

// --- PREFILL dari baris PO (mode buat) ---
const getPoSource = async (poNomor, nourut) => {
  const conn = await db.getConnection();
  try {
    const line = await loadPoLine(conn, poNomor, nourut);
    const vendor = await resolveVendor(conn, line);
    const p = await getParam(conn);
    const spec = bacaSpec(line);
    const { jenis, persen } = await getJenisCek(conn, line.pod_bhn_kode, p);
    const qtyPo = Number(line.pod_Jumlah) || 0;
    const sisa = await hitungSisaPo(
      conn,
      line.po_nomor,
      line.pod_nourut,
      qtyPo,
    );

    return {
      header: {
        qc_po_nomor: line.po_nomor,
        qc_bhn_kode: line.pod_bhn_kode,
        qc_pod_nourut: line.pod_nourut,
        qc_vendor_greige: vendor.greige,
        qc_vendor_celup: vendor.celup,
        qc_jenis_kain: line.nama_jenis || line.nama_kain || "",
        qc_jenis_cek: jenis,
        qc_persen_cek: persen,
        jenis_po:
          Number(line.po_jenis) === 1
            ? "GREIGE"
            : Number(line.po_jenis) === 2
              ? "CELUP"
              : Number(line.po_jenis) === 4
                ? "LAIN-LAIN"
                : "BAHAN",
      },
      po: {
        qty: qtyPo,
        sisa,
        roll: Number(line.pod_roll) || 0,
        satuan: line.pod_bhn_satuan,
        gramasi: line.pod_gramasia || "",
        gramasi_min: spec.gMin,
        gramasi_max: spec.gMax,
        setting: line.pod_setting || "",
        setting_min: spec.sMin,
        setting_max: spec.sMax,
        spec_terbaca: spec.terbaca,
        warna: line.nama_warna || line.nama_kain || "",
      },
      toleransi: {
        gramasi: p.tolGramasi,
        setting: p.tolSetting,
        warna_nilai3: p.warnaBatas3,
        warna_nilai2: p.warnaBatas2,
      },
    };
  } finally {
    conn.release();
  }
};

// --- DETAIL (mode ubah) ---
const getDetail = async (nomor) => {
  const [hdr] = await db.query(
    `
    SELECT
      qc_nomor, DATE_FORMAT(qc_tgl_datang, "%Y-%m-%d") AS qc_tgl_datang,
      qc_po_nomor, qc_bhn_kode, qc_pod_nourut,
      qc_vendor_greige, qc_jenis_kain, qc_vendor_celup,
      qc_qty_datang, qc_jml_lot, qc_jenis_cek, qc_persen_cek,
      qc_status, qc_keterangan, user_create, date_create
    FROM tqc_bahan_hdr
    WHERE qc_nomor = ?
    `,
    [nomor],
  );
  if (hdr.length === 0) throw new Error("Data QC Bahan tidak ditemukan.");

  const [dtl] = await db.query(
    `
    SELECT
      qcd_nourut AS nourut, qcd_lot AS lot, qcd_qty_kg AS qty_kg,
      qcd_qty_roll AS qty_roll, qcd_roll_cek AS roll_cek,
      qcd_qty_kg_po AS qty_kg_po, qcd_gramasi_po AS gramasi_po,
      qcd_gramasi_min AS gramasi_min, qcd_gramasi_max AS gramasi_max,
      qcd_setting_po AS setting_po, qcd_warna AS warna,
      qcd_gramasi_cek AS gramasi_cek, qcd_setting_cek AS setting_cek,
      qcd_nilai AS nilai, qcd_nilai_saran AS nilai_saran,
      qcd_alasan_nilai AS alasan_nilai, qcd_keputusan AS keputusan
    FROM tqc_bahan_dtl
    WHERE qcd_qc_nomor = ?
    ORDER BY qcd_nourut
    `,
    [nomor],
  );

  const [rolls] = await db.query(
    `SELECT * FROM tqc_bahan_roll WHERE qcr_qc_nomor = ?
     ORDER BY qcr_lot_nourut, qcr_nourut`,
    [nomor],
  );
  const rollMap = {};
  rolls.forEach((x) => {
    (rollMap[x.qcr_lot_nourut] ||= []).push({
      no_roll: x.qcr_no_roll,
      qty: Number(x.qcr_qty),
      gramasi_atas: Number(x.qcr_gramasi_atas),
      gramasi_bawah: Number(x.qcr_gramasi_bawah),
      setting_cek: Number(x.qcr_setting_cek),
      sesuai: Number(x.qcr_sesuai) === 1,
      nilai: Number(x.qcr_nilai) || 0,
      catatan: x.qcr_catatan,
      hasil: {
        gramasi: x.qcr_h_gramasi,
        setting: x.qcr_h_setting,
        warna: x.qcr_h_warna,
        handfeel: x.qcr_h_handfeel,
        bowing: x.qcr_h_bowing,
        shrinkage: x.qcr_h_shrinkage,
        kelunturan: x.qcr_h_kelunturan,
      },
    });
  });

  const [kep] = await db.query(
    `SELECT qck_user, DATE_FORMAT(qck_tanggal, "%Y-%m-%d") AS tanggal
     FROM tqc_bahan_keputusan
     WHERE qck_qc_nomor = ? AND qck_tahap = 'PEMBELIAN'
     ORDER BY qck_id DESC LIMIT 1`,
    [nomor],
  );
  const pengesah = {
    pembelian: kep[0]?.qck_user || "",
    tgl_pembelian: kep[0]?.tanggal || "",
  };

  const conn = await db.getConnection();
  try {
    const [po] = await conn.query(
      `SELECT pod_Jumlah, pod_roll, pod_bhn_satuan, pod_gramasia, pod_setting
       FROM tpo_dtl WHERE pod_po_nomor = ? AND pod_nourut = ?`,
      [hdr[0].qc_po_nomor, hdr[0].qc_pod_nourut],
    );
    const p = await getParam(conn);
    const spec = po[0] ? bacaSpec(po[0]) : null;
    const qtyPo = po[0] ? Number(po[0].pod_Jumlah) || 0 : 0;
    const sisa = await hitungSisaPo(
      conn,
      hdr[0].qc_po_nomor,
      hdr[0].qc_pod_nourut,
      qtyPo,
      nomor,
    );

    return {
      header: {
        ...hdr[0],
        qc_qty_datang: Number(hdr[0].qc_qty_datang),
        qc_jml_lot: Number(hdr[0].qc_jml_lot),
        qc_persen_cek: Number(hdr[0].qc_persen_cek),
      },
      dtl: dtl.map((d) => ({
        nourut: d.nourut,
        lot: d.lot,
        qty_kg: Number(d.qty_kg),
        qty_roll: Number(d.qty_roll),
        roll_cek: Number(d.roll_cek),
        qty_kg_po: Number(d.qty_kg_po),
        gramasi_po: d.gramasi_po,
        gramasi_min: Number(d.gramasi_min),
        gramasi_max: Number(d.gramasi_max),
        setting_po: d.setting_po,
        warna: d.warna,
        gramasi_cek: Number(d.gramasi_cek),
        setting_cek: d.setting_cek,
        nilai: Number(d.nilai),
        nilai_saran: Number(d.nilai_saran),
        alasan_nilai: d.alasan_nilai,
        keputusan: d.keputusan,
        rolls: rollMap[d.nourut] || [],
      })),
      po: po[0]
        ? {
            qty: qtyPo,
            sisa,
            roll: Number(po[0].pod_roll) || 0,
            satuan: po[0].pod_bhn_satuan,
            gramasi_min: spec.gMin,
            gramasi_max: spec.gMax,
            setting_min: spec.sMin,
            setting_max: spec.sMax,
            spec_terbaca: spec.terbaca,
          }
        : null,
      pengesah,
      toleransi: {
        gramasi: p.tolGramasi,
        setting: p.tolSetting,
        warna_nilai3: p.warnaBatas3,
        warna_nilai2: p.warnaBatas2,
      },
    };
  } finally {
    conn.release();
  }
};

const fs = require("fs");
const path = require("path");

const JENIS_FOTO = ["BAHAN", "TRIMCARD"];
const UPLOAD_ROOT = path.join(process.cwd(), "public/uploads");

const folderNomor = (nomor) => String(nomor).replace(/[^A-Za-z0-9_-]/g, "-");

const getLampiran = async (nomor) => {
  const [rows] = await db.query(
    `SELECT qcl_id AS Id, qcl_jenis AS Jenis, qcl_file AS File, qcl_nama AS Nama
     FROM tqc_bahan_lampiran WHERE qcl_qc_nomor = ? ORDER BY qcl_id`,
    [nomor],
  );
  return rows;
};

const FOTO_MIME = ["image/jpeg", "image/png", "image/webp"];
const FOTO_EXT = [".jpg", ".jpeg", ".png", ".webp"];

// Satu foto per jenis per dokumen: unggah ulang menggantikan yang lama
const saveLampiran = async (nomor, jenis, file, userKode) => {
  const jenisUp = String(jenis || "").toUpperCase();
  try {
    if (!JENIS_FOTO.includes(jenisUp)) {
      throw new Error("Jenis foto harus BAHAN atau TRIMCARD.");
    }
    if (!file) throw new Error("File foto wajib dipilih.");
    const extFile = path.extname(file.originalname).toLowerCase();
    if (!FOTO_MIME.includes(file.mimetype) || !FOTO_EXT.includes(extFile)) {
      throw new Error("Foto harus berformat JPG, PNG, atau WEBP.");
    }

    const [hdr] = await db.query(
      `SELECT qc_nomor FROM tqc_bahan_hdr WHERE qc_nomor = ?`,
      [nomor],
    );
    if (hdr.length === 0) throw new Error("Data QC Bahan tidak ditemukan.");

    const [sudahDiterima] = await db.query(
      `SELECT 1 FROM tbpb_qc_lot WHERE bql_qc_nomor = ? LIMIT 1`,
      [nomor],
    );
    if (sudahDiterima.length > 0) {
      throw new Error("Dokumen sudah diterima di BPB Bahan. Foto dikunci.");
    }

    const folderRel = path.join("qc-bahan", folderNomor(nomor));
    const folderAbs = path.join(UPLOAD_ROOT, folderRel);
    fs.mkdirSync(folderAbs, { recursive: true });

    const namaFile = `${jenisUp.toLowerCase()}-${Date.now()}${extFile}`;
    fs.renameSync(file.path, path.join(folderAbs, namaFile));
    const fileRel = path.posix.join("qc-bahan", folderNomor(nomor), namaFile);

    const [lama] = await db.query(
      `SELECT qcl_id, qcl_file FROM tqc_bahan_lampiran
       WHERE qcl_qc_nomor = ? AND qcl_jenis = ?`,
      [nomor, jenisUp],
    );
    for (const l of lama) {
      fs.rmSync(path.join(UPLOAD_ROOT, l.qcl_file), { force: true });
      await db.query(`DELETE FROM tqc_bahan_lampiran WHERE qcl_id = ?`, [
        l.qcl_id,
      ]);
    }

    await db.query(
      `INSERT INTO tqc_bahan_lampiran
         (qcl_qc_nomor, qcl_lot, qcl_jenis, qcl_file, qcl_nama, user_create)
       VALUES (?, '', ?, ?, ?, ?)`,
      [nomor, jenisUp, fileRel, file.originalname, userKode],
    );
    return { jenis: jenisUp, file: fileRel };
  } catch (error) {
    if (file?.path) fs.rmSync(file.path, { force: true });
    throw error;
  }
};

const deleteLampiran = async (nomor, jenis) => {
  const [rows] = await db.query(
    `SELECT qcl_id, qcl_file FROM tqc_bahan_lampiran
     WHERE qcl_qc_nomor = ? AND qcl_jenis = ?`,
    [nomor, String(jenis || "").toUpperCase()],
  );
  for (const r of rows) {
    fs.rmSync(path.join(UPLOAD_ROOT, r.qcl_file), { force: true });
    await db.query(`DELETE FROM tqc_bahan_lampiran WHERE qcl_id = ?`, [
      r.qcl_id,
    ]);
  }
};

// --- SIMPAN (buat / ubah), opsional langsung submit ---
const saveData = async (payload, userKode) => {
  const conn = await db.getConnection();
  let locked = false;
  try {
    const isEdit = !!payload.isEdit;
    const tgl = String(payload.qc_tgl_datang || "").substring(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(tgl)) {
      throw new Error("Tanggal kedatangan wajib diisi.");
    }

    const inputRows = Array.isArray(payload.dtl) ? payload.dtl : [];
    if (inputRows.length === 0) {
      throw new Error("Minimal satu lot harus diisi.");
    }

    const lotSet = new Set();
    for (const r of inputRows) {
      const lot = String(r.lot || "").trim();
      if (!lot) throw new Error("Lot No. wajib diisi pada semua baris.");
      const key = lot.toUpperCase();
      if (lotSet.has(key)) throw new Error(`Lot ${lot} terduplikasi.`);
      lotSet.add(key);
    }

    if (!isEdit) {
      const [lk] = await conn.query(`SELECT GET_LOCK(?, 10) AS ok`, [
        LOCK_NAME,
      ]);
      if (!lk[0].ok) throw new Error("Sistem sibuk, coba lagi.");
      locked = true;
    }

    await conn.beginTransaction();

    let nomor = payload.qc_nomor;
    let poNomor = payload.qc_po_nomor;
    let podNourut = Number(payload.qc_pod_nourut);
    let oldStatus = "DRAFT";
    let pinUrut = null;
    let jenisTersimpan = "";
    let persenTersimpan = 0;

    if (isEdit) {
      const [cur] = await conn.query(
        `SELECT qc_status, qc_po_nomor, qc_pod_nourut, qc_jenis_cek, qc_persen_cek, qc_versi_nilai
         FROM tqc_bahan_hdr WHERE qc_nomor = ? FOR UPDATE`,
        [nomor],
      );
      if (cur.length === 0) throw new Error("Data QC Bahan tidak ditemukan.");
      oldStatus = cur[0].qc_status;
      poNomor = cur[0].qc_po_nomor;
      podNourut = Number(cur[0].qc_pod_nourut);
      jenisTersimpan = cur[0].qc_jenis_cek || "";
      persenTersimpan = Number(cur[0].qc_persen_cek) || 0;
      if (Number(cur[0].qc_versi_nilai) === 1 && oldStatus !== "DRAFT") {
        throw new Error(
          "Dokumen ini dibuat dengan aturan penilaian lama dan tidak dapat diubah.",
        );
      }

      const [sudahDiterima] = await conn.query(
        `SELECT 1 FROM tbpb_qc_lot WHERE bql_qc_nomor = ? LIMIT 1`,
        [nomor],
      );
      if (sudahDiterima.length > 0) {
        throw new Error(
          "Dokumen ini sudah diterima di BPB Bahan. Hapus BPB-nya terlebih dahulu sebelum mengubah QC.",
        );
      }
      const [sudahDiretur] = await conn.query(
        `SELECT 1 FROM tqc_retur_dtl WHERE qrd_qc_nomor = ? LIMIT 1`,
        [nomor],
      );
      if (sudahDiretur.length > 0) {
        throw new Error(
          "Dokumen ini sudah diretur ke supplier. Hapus dokumen retur-nya terlebih dahulu sebelum mengubah QC.",
        );
      }

      if (oldStatus !== "DRAFT") {
        const [pin] = await conn.query(
          `SELECT pin_urut, pin_acc, pin_dipakai FROM tspk_pin5
           WHERE pin_trs = "QC BAHAN" AND pin_nomor = ?
           ORDER BY pin_urut DESC LIMIT 1`,
          [nomor],
        );
        if (
          pin.length === 0 ||
          pin[0].pin_acc !== "Y" ||
          pin[0].pin_dipakai !== ""
        ) {
          throw new Error(
            "Dokumen sudah disubmit. Ajukan perubahan data dan tunggu ACC terlebih dahulu.",
          );
        }
        pinUrut = pin[0].pin_urut;
      }
    } else if (!poNomor || !podNourut) {
      throw new Error("PO Bahan dan baris bahan wajib dipilih.");
    }

    const line = await loadPoLine(conn, poNomor, podNourut);
    const p = await getParam(conn);
    const spec = bacaSpec(line);
    let { jenis: jenisCek, persen: persenCek } = await getJenisCek(
      conn,
      line.pod_bhn_kode,
      p,
    );
    if (isEdit && persenTersimpan > 0) {
      jenisCek = jenisTersimpan || jenisCek;
      persenCek = persenTersimpan;
    }
    const qtyPo = Number(line.pod_Jumlah) || 0;
    const qtyDatang = num(payload.qc_qty_datang);

    // Dokumen yang sudah pernah disubmit selalu divalidasi penuh
    const submit = !!payload.submit || oldStatus !== "DRAFT";
    const warnings = [];
    const lanjutMap = new Map(
      (Array.isArray(payload.lanjut_gudang) ? payload.lanjut_gudang : []).map(
        (x) => [
          String(x.lot || "")
            .trim()
            .toUpperCase(),
          String(x.alasan || "").trim(),
        ],
      ),
    );
    if (!submit && lanjutMap.size > 0) {
      throw new Error(
        "Pelanjutan oleh Gudang hanya dapat dilakukan saat submit.",
      );
    }
    let totalKg = 0;

    const rows = inputRows.map((r, i) => {
      const lot = String(r.lot).trim();
      const kg = num(r.qty_kg);
      const roll = Math.floor(num(r.qty_roll));
      totalKg += kg;
      if (kg < 0 || roll < 0) {
        throw new Error(`Qty dan roll lot ${lot} tidak boleh negatif.`);
      }
      const rollCek = hitungRollCek(roll, persenCek);

      const rolls = (Array.isArray(r.rolls) ? r.rolls : []).map((x, j) => ({
        nourut: j + 1,
        noRoll: String(x.no_roll || "").trim(),
        qty: num(x.qty),
        ev: evalRoll(x, spec, p),
        catatan: String(x.catatan || "").trim(),
        hasil: x.hasil || {},
      }));

      const evals = rolls.map((x) => x.ev);
      if (submit) {
        const idxKurang = rolls.findIndex((x) => !x.ev.terisi);
        if (idxKurang >= 0) {
          throw new Error(
            `Lot ${lot}, baris roll ke-${idxKurang + 1}: ${rolls[idxKurang].ev.kurang.join(", ")} harus diisi lengkap.`,
          );
        }
        if (rolls.length < rollCek) {
          throw new Error(
            `Lot ${lot}: minimal ${rollCek} roll harus dicek (${persenCek}% dari ${roll} roll). Baru ${rolls.length}.`,
          );
        }
        if (rolls.length > roll) {
          throw new Error(
            `Lot ${lot}: roll yang dicek (${rolls.length}) melebihi jumlah roll lot.`,
          );
        }
      }
      // Nilai dihitung server dan dikunci. Nilai dari client diabaikan.
      const saran = hitungNilaiLot(evals);
      const nilai = saran;
      const alasan = "";

      if (submit && !nilai) {
        throw new Error(
          `Lot ${lot}: belum ada roll yang dicek lengkap sehingga nilai belum dapat dihitung.`,
        );
      }

      const dicek = evals.filter((x) => x.terisi);
      const bacaan = dicek
        .flatMap((x) => [x.atas, x.bawah])
        .filter((v) => v > 0);
      const gramasiRata = bacaan.length
        ? r2(bacaan.reduce((a, b) => a + b, 0) / bacaan.length)
        : 0;
      const settingRata = dicek.length
        ? r2(dicek.reduce((a, b) => a + b.st, 0) / dicek.length)
        : 0;

      const kunciLot = lot.toUpperCase();
      const alasanLanjut = lanjutMap.get(kunciLot);
      lanjutMap.delete(kunciLot);

      let keputusan = "";
      let tahapLog = "";
      let catatanLog = "";
      if (submit && nilai === 3) {
        keputusan = "LANJUT";
        tahapLog = "SISTEM";
        catatanLog = "Otomatis: semua roll yang dicek sesuai spesifikasi PO.";
      } else if (submit && alasanLanjut !== undefined) {
        if (nilai !== 2) {
          throw new Error(
            `Lot ${lot}: hanya lot bernilai 2 yang dapat dilanjutkan oleh Gudang.`,
          );
        }
        if (!alasanLanjut) {
          throw new Error(`Lot ${lot}: alasan melanjutkan wajib diisi.`);
        }
        keputusan = "LANJUT";
        tahapLog = "GUDANG";
        catatanLog = `Gudang melanjutkan lot nilai 2. Alasan: ${alasanLanjut}`;
      }
      return {
        nourut: i + 1,
        lot,
        kg,
        roll,
        rollCek,
        warna: String(r.warna || "").trim(),
        gramasiCek: gramasiRata,
        settingCek: settingRata ? String(settingRata) : "",
        nilai,
        saran,
        alasan,
        rolls,
        keputusan,
        tahapLog,
        catatanLog,
      };
    });

    if (lanjutMap.size > 0) {
      throw new Error(
        `Lot ${[...lanjutMap.keys()].join(", ")} tidak ditemukan pada dokumen.`,
      );
    }

    if (submit) {
      if (!(qtyDatang > 0)) throw new Error("Qty kedatangan wajib diisi.");
      if (Math.abs(totalKg - qtyDatang) > 0.01) {
        throw new Error(
          `Total qty lot (${r2(totalKg)}) tidak sama dengan qty kedatangan (${r2(qtyDatang)}).`,
        );
      }
    }

    const sisaPo = await hitungSisaPo(
      conn,
      poNomor,
      podNourut,
      qtyPo,
      isEdit ? nomor : "",
    );
    if (qtyDatang > sisaPo + 0.01) {
      warnings.push(
        `Qty kedatangan (${r2(qtyDatang)} ${line.pod_bhn_satuan}) melebihi sisa PO (${Math.max(sisaPo, 0).toFixed(2)} ${line.pod_bhn_satuan}).`,
      );
    }

    const newStatus = submit
      ? hitungStatusDok(rows.map((r) => r.keputusan))
      : "DRAFT";

    if (!isEdit) {
      const vendor = await resolveVendor(conn, line);
      nomor = await generateNomor(conn, tgl);
      await conn.query(
        `
        INSERT INTO tqc_bahan_hdr (
          qc_nomor, qc_tgl_datang, qc_po_nomor, qc_bhn_kode, qc_pod_nourut,
          qc_vendor_greige, qc_jenis_kain, qc_vendor_celup,
          qc_qty_datang, qc_jml_lot, qc_jenis_cek, qc_persen_cek,
          qc_status, qc_keterangan, qc_versi_nilai, user_create, date_create
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 2, ?, NOW())
        `,
        [
          nomor,
          tgl,
          poNomor,
          line.pod_bhn_kode,
          podNourut,
          vendor.greige,
          line.nama_jenis || line.nama_kain || "",
          vendor.celup,
          qtyDatang,
          rows.length,
          jenisCek,
          persenCek,
          newStatus,
          payload.qc_keterangan || "",
          userKode,
        ],
      );
    } else {
      await conn.query(
        `
        UPDATE tqc_bahan_hdr
        SET qc_tgl_datang = ?, qc_keterangan = ?, qc_status = ?, qc_versi_nilai = 2,
            qc_qty_datang = ?, qc_jml_lot = ?, qc_jenis_cek = ?, qc_persen_cek = ?,
            user_modified = ?, date_modified = NOW()
        WHERE qc_nomor = ?
        `,
        [
          tgl,
          payload.qc_keterangan || "",
          newStatus,
          qtyDatang,
          rows.length,
          jenisCek,
          persenCek,
          userKode,
          nomor,
        ],
      );
      await conn.query(`DELETE FROM tqc_bahan_roll WHERE qcr_qc_nomor = ?`, [
        nomor,
      ]);
      await conn.query(`DELETE FROM tqc_bahan_dtl WHERE qcd_qc_nomor = ?`, [
        nomor,
      ]);
    }

    for (const r of rows) {
      await conn.query(
        `
        INSERT INTO tqc_bahan_dtl (
          qcd_qc_nomor, qcd_nourut, qcd_lot, qcd_po_nomor, qcd_bhn_kode,
          qcd_qty_kg, qcd_qty_roll, qcd_roll_cek, qcd_qty_kg_po,
          qcd_gramasi_po, qcd_gramasi_min, qcd_gramasi_max, qcd_setting_po,
          qcd_warna, qcd_gramasi_cek, qcd_setting_cek,
          qcd_nilai, qcd_nilai_saran, qcd_alasan_nilai, qcd_keputusan
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          nomor,
          r.nourut,
          r.lot,
          poNomor,
          line.pod_bhn_kode,
          r.kg,
          r.roll,
          r.rollCek,
          qtyPo,
          line.pod_gramasia || "",
          spec.gMin,
          spec.gMax,
          line.pod_setting || "",
          r.warna,
          r.gramasiCek,
          r.settingCek,
          r.nilai,
          r.saran,
          r.alasan,
          r.keputusan,
        ],
      );

      if (r.rolls.length > 0) {
        await conn.query(
          `
          INSERT INTO tqc_bahan_roll (
            qcr_qc_nomor, qcr_lot_nourut, qcr_lot, qcr_nourut, qcr_no_roll,
            qcr_qty, qcr_gramasi_atas, qcr_gramasi_bawah, qcr_setting_cek,
            qcr_sesuai, qcr_nilai, qcr_h_gramasi, qcr_h_setting, qcr_h_warna,
            qcr_h_handfeel, qcr_h_bowing, qcr_h_shrinkage, qcr_h_kelunturan,
            qcr_catatan
          ) VALUES ?
          `,
          [
            r.rolls.map((x) => [
              nomor,
              r.nourut,
              r.lot,
              x.nourut,
              x.noRoll,
              x.qty,
              x.ev.atas,
              x.ev.bawah,
              x.ev.st,
              x.ev.sesuai ? 1 : 0,
              x.ev.nilai,
              x.ev.gramasiTxt,
              x.ev.settingTxt,
              x.ev.warnaTxt,
              x.ev.hf,
              x.ev.bw,
              x.ev.sh,
              x.ev.kl,
              x.catatan,
            ]),
          ],
        );
      }

      // Nilai final 3 -> otomatis LANJUT, dicatat di log keputusan
      if (r.keputusan === "LANJUT") {
        await conn.query(
          `INSERT INTO tqc_bahan_keputusan
             (qck_qc_nomor, qck_lot, qck_tahap, qck_keputusan, qck_catatan,
              qck_klien_kontak, qck_user)
           VALUES (?, ?, ?, 'LANJUT', ?, '', ?)`,
          [nomor, r.lot, r.tahapLog, r.catatanLog, userKode],
        );
      }
    }

    if (pinUrut !== null) {
      await conn.query(
        `UPDATE tspk_pin5 SET pin_dipakai = 'Y'
         WHERE pin_trs = "QC BAHAN" AND pin_nomor = ? AND pin_urut = ?`,
        [nomor, pinUrut],
      );
    }

    await conn.commit();
    return {
      qc_nomor: nomor,
      status: newStatus,
      warnings,
      lot_lanjut: rows.filter((r) => r.keputusan === "LANJUT").length,
      lot_pembelian: submit ? rows.filter((r) => r.keputusan === "").length : 0,
    };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    if (locked) {
      await conn.query(`SELECT RELEASE_LOCK(?)`, [LOCK_NAME]);
    }
    conn.release();
  }
};

module.exports = {
  lookupPo,
  getPoSource,
  getDetail,
  getLampiran,
  saveLampiran,
  deleteLampiran,
  saveData,
};
