// services/ppic/planningSpkFormService.js
const db = require("../../config/database");

// ─────────────────────────────────────────────
// Generate nomor: PL/PPIC/00001/2026
// ─────────────────────────────────────────────
const generateNomor = async (tahun) => {
  const [rows] = await db.query(
    `SELECT IFNULL(MAX(CAST(SUBSTRING(pl_nomor, 9, 5) AS UNSIGNED)), 0) AS jumlah
     FROM tplan_ppic_hdr
     WHERE LEFT(pl_nomor, 7) = 'PL/PPIC'
       AND RIGHT(pl_nomor, 4) = ?`,
    [String(tahun)],
  );
  // FIX: rows[0].jumlah balik sebagai STRING dari mysql2 meski sudah
  // di-CAST AS UNSIGNED di SQL — wajib Number() dulu sebelum +1,
  // kalau tidak jadi string concat ("1"+1="11" bukan 2).
  const nextVal = Number(rows[0].jumlah) + 1;
  return `PL/PPIC/${String(nextVal).padStart(5, "0")}/${tahun}`;
};

// ═════════════════════════════════════════════
// SEWING — referensi MP, SMV, actual output, actual jam kerja
// ═════════════════════════════════════════════
const SEWING_DEFAULT_HARI = 5;
const SEWING_DEFAULT_JAM = 6.5;
const JAM_MULAI_KERJA = "08:00:00";

// 'LINE A' -> 'JAHIT A', 'LINE PREPARATION' -> 'PREPARATION'
// (cocok dengan hrd2.tkaryawan.kar_bagian).
// LINE EXTERNAL / nama lain -> null (tidak punya MP internal).
const lineToBagian = (line) => {
  const s = String(line || "")
    .trim()
    .toUpperCase();
  if (/^(LINE\s+)?PREPARATION$/.test(s)) return "PREPARATION";
  const m = /^LINE\s+([A-Z])$/.exec(s);
  return m ? `JAHIT ${m[1]}` : null;
};

// MP = jumlah operator aktif per bagian jahit
const getMpByBagian = async (bagianList) => {
  if (!bagianList.length) return {};
  const [rows] = await db.query(
    `SELECT k.kar_bagian AS bagian, COUNT(*) AS mp
     FROM hrd2.tkaryawan k
     WHERE k.kar_status_aktif = 1
       AND k.kar_pab_kode = 'P04'
       AND k.kar_dep_kode = 'PRD2'
       AND k.kar_jab_kode = 'OPR'
       AND k.kar_bagian IN (?)
     GROUP BY k.kar_bagian`,
    [bagianList],
  );
  const map = {};
  for (const r of rows) map[r.bagian] = Number(r.mp) || 0;
  return map;
};

// SMV (menit) per SPK = total pfd_waktu proof garmen lini JAHIT (tanpa dikali jumlah).
// Proof bisa tersimpan atas nomor SPK, SO ref, atau MAP (spk_memo): prioritas SPK > SO ref > MAP.
// Hasil: { [spk]: { smv, sumber: 'PROOF' | 'MANUAL' } }
const getSmvBySpk = async (spkList) => {
  if (!spkList.length) return {};
  const [spkRows] = await db.query(
    `SELECT spk_nomor, spk_so_ref, spk_memo FROM tspk WHERE spk_nomor IN (?)`,
    [spkList],
  );
  const keysBySpk = {};
  const allKeys = new Set();
  for (const r of spkRows) {
    const keys = [r.spk_nomor, r.spk_so_ref, r.spk_memo].filter(Boolean);
    keysBySpk[r.spk_nomor] = keys;
    keys.forEach((k) => allKeys.add(k));
  }
  if (!allKeys.size) return {};

  const [rows] = await db.query(
    `SELECT h.pf_spk_nomor AS k, SUM(d.pfd_waktu) AS smv
     FROM tproofgarmen_hdr h
     INNER JOIN tproofgarmen_dtl d ON d.pfd_nomor = h.pf_nomor
     WHERE h.pf_lini = 'JAHIT' AND h.pf_spk_nomor IN (?)
     GROUP BY h.pf_spk_nomor`,
    [[...allKeys]],
  );
  const smvByKey = {};
  for (const r of rows) smvByKey[r.k] = Number(r.smv) || 0;

  const map = {};
  for (const [spk, keys] of Object.entries(keysBySpk)) {
    const hit = keys.find((k) => smvByKey[k] > 0);
    map[spk] = hit
      ? { smv: smvByKey[hit], sumber: "PROOF" }
      : { smv: 0, sumber: "MANUAL" };
  }
  return map;
};

// Actual output = LHK Sewing: mutasi produksi GP003 -> GP004 (Jahit ke Lipat).
// Line = mph_kelompok, sama seperti yang dipakai getPlanningPpic.
const getActualOutputBySpkLine = async (spkList, tgl1, tgl2) => {
  if (!spkList.length) return {};
  const [rows] = await db.query(
    `SELECT h.mph_spk_nomor AS spk, h.mph_kelompok AS line,
            IFNULL(SUM(h.mph_jumlah), 0) AS qty
     FROM tmutasiproduksi_hdr h
     WHERE h.mph_spk_nomor IN (?)
       AND h.mph_gdgasal = 'GP003'
       AND h.mph_gdgtujuan = 'GP004'
       AND h.mph_tanggal >= ? AND h.mph_tanggal < DATE_ADD(?, INTERVAL 1 DAY)
     GROUP BY h.mph_spk_nomor, h.mph_kelompok`,
    [spkList, tgl1, tgl2],
  );
  const map = {};
  for (const r of rows) map[`${r.spk}|${r.line}`] = Number(r.qty) || 0;
  return map;
};

// Actual jam kerja per bagian: per hari = scan2 (pulang) TERAKHIR di antara
// operator bagian itu dikurangi jam 08:00, lalu dijumlah sepanjang range.
// ⚠️ cek nama kolom tanggal di hrd2.tabsensi (diasumsikan `tanggal`)
const getActualJamByBagian = async (bagianList, tgl1, tgl2) => {
  if (!bagianList.length) return {};
  const [rows] = await db.query(
    `SELECT x.bagian,
            ROUND(SUM(GREATEST(TIME_TO_SEC(TIMEDIFF(x.pulang_terakhir, ?)), 0)) / 3600, 2) AS jam
     FROM (
       SELECT k.kar_bagian AS bagian,
              DATE(a.tanggal) AS tgl,
              MAX(TIME(a.scan2)) AS pulang_terakhir
       FROM hrd2.tabsensi a
       INNER JOIN hrd2.tkaryawan k ON k.kar_kode_absensi = a.nik
       WHERE k.kar_status_aktif = 1
         AND k.kar_pab_kode = 'P04'
         AND k.kar_dep_kode = 'PRD2'
         AND k.kar_jab_kode = 'OPR'
         AND k.kar_bagian IN (?)
         AND a.tanggal >= ? AND a.tanggal < DATE_ADD(?, INTERVAL 1 DAY)
         AND a.scan2 IS NOT NULL
         AND TIME(a.scan2) > ?
       GROUP BY k.kar_bagian, DATE(a.tanggal)
     ) x
     GROUP BY x.bagian`,
    [JAM_MULAI_KERJA, bagianList, tgl1, tgl2, JAM_MULAI_KERJA],
  );
  const map = {};
  for (const r of rows) map[r.bagian] = Number(r.jam) || 0;
  return map;
};

// Satu pintu untuk semua referensi sewing.
// withActual=false dipakai saat simpan (tidak perlu query absensi/mutasi).
const getSewingReferensi = async ({
  tgl1,
  tgl2,
  lines = [],
  spkList = [],
  withActual = true,
}) => {
  const bagianByLine = {};
  for (const l of [...new Set(lines.filter(Boolean))]) {
    const b = lineToBagian(l);
    if (b) bagianByLine[l] = b;
  }
  const bagianList = [...new Set(Object.values(bagianByLine))];
  const spk = [...new Set(spkList.filter(Boolean))];

  const [mpMap, smvMap, outMap, jamMap] = await Promise.all([
    getMpByBagian(bagianList),
    getSmvBySpk(spk),
    withActual ? getActualOutputBySpkLine(spk, tgl1, tgl2) : {},
    withActual ? getActualJamByBagian(bagianList, tgl1, tgl2) : {},
  ]);

  const mpByLine = {};
  const actualJamByLine = {};
  for (const [line, bagian] of Object.entries(bagianByLine)) {
    mpByLine[line] = mpMap[bagian] || 0;
    actualJamByLine[line] = jamMap[bagian] ?? 0;
  }
  return {
    mpByLine,
    actualJamByLine,
    smvBySpk: smvMap,
    actualOutputBySpkLine: outMap,
  };
};

// waktu produksi = hari x jam x 60 ; resume = target x SMV / MP (menit per operator)
const hitungSewing = ({ hari, jam, target, smv, mp }) => {
  const waktuProduksi = (Number(hari) || 0) * (Number(jam) || 0) * 60;
  const resume = mp > 0 && smv > 0 ? ((Number(target) || 0) * smv) / mp : null;
  return { waktuProduksi, resume };
};

// Tambah kolom turunan (MP, SMV, waktu produksi, resume, actual) ke tiap baris sewing
// Resume WAJIB dijumlah per line: 1 line bisa pegang beberapa SPK dengan
// operator yang sama, jadi cek kelayakan = total resume vs waktu produksi line.
const enrichSewing = async (rows, tgl1, tgl2) => {
  if (!rows.length) return [];

  const ref = await getSewingReferensi({
    tgl1,
    tgl2,
    lines: rows.map((r) => r.plan_line_kelompok),
    spkList: rows.map((r) => r.NomorSPK),
  });

  return rows.map((r) => {
    const mp =
      Number(r.plan_mp) > 0
        ? Number(r.plan_mp)
        : ref.mpByLine[r.plan_line_kelompok] || 0;

    // SMV: pakai yang tersimpan; kalau belum ada, ambil dari proof (live)
    const live = ref.smvBySpk[r.NomorSPK] || { smv: 0, sumber: "MANUAL" };
    const snapSmv = Number(r.plan_smv) || 0;
    let smv;
    let smvSumber;
    if (r.plan_smv_sumber === "PROOF" && snapSmv > 0) {
      // sudah terkunci dari proof sejak disimpan
      smv = snapSmv;
      smvSumber = "PROOF";
    } else if (live.sumber === "PROOF") {
      // proof baru muncul setelah disimpan manual: ikut proof
      smv = live.smv;
      smvSumber = "PROOF";
    } else {
      smv = snapSmv;
      smvSumber = "MANUAL";
    }

    const { waktuProduksi, resume } = hitungSewing({
      hari: r.plan_hari,
      jam: r.plan_jam,
      target: r.plan_target_output,
      smv,
      mp,
    });
    return {
      ...r,
      plan_hari: Number(r.plan_hari),
      plan_jam: Number(r.plan_jam),
      plan_target_output: Number(r.plan_target_output) || 0,
      mp,
      smv,
      smv_sumber: smvSumber, // 'PROOF' = terkunci, 'MANUAL' = boleh diedit
      waktu_produksi: waktuProduksi,
      resume,
      actual_output:
        ref.actualOutputBySpkLine[`${r.NomorSPK}|${r.plan_line_kelompok}`] || 0,
      actual_jam: ref.actualJamByLine[r.plan_line_kelompok] ?? null,
    };
  });
};

// ─────────────────────────────────────────────
// getFormDetail — load untuk mode edit
// ─────────────────────────────────────────────
const getFormDetail = async (nomor) => {
  // Header — tanpa info SPK (multi SPK sekarang per baris)
  const [hdrRows] = await db.query(
    `SELECT
       h.pl_nomor,
       DATE_FORMAT(h.pl_tgl1, '%Y-%m-%d') AS pl_tgl1,
       DATE_FORMAT(h.pl_tgl2, '%Y-%m-%d') AS pl_tgl2,
       h.pl_cab,
       h.pl_keterangan
     FROM tplan_ppic_hdr h
     WHERE h.pl_nomor = ?`,
    [nomor],
  );
  if (!hdrRows.length) return null;
  const hdr = hdrRows[0];

  // Detail per divisi — setiap baris punya SPK sendiri
  const loadDivisi = async (divisi) => {
    const [rows] = await db.query(
      `SELECT
        d.plan_spk             AS NomorSPK,
        s.spk_nama             AS NamaSPK,
        s.spk_jumlah           AS QtySPK,
        DATE_FORMAT(d.plan_tgl_jadwal, '%Y-%m-%d') AS plan_tgl_jadwal,
        d.plan_wip             AS plan_wip,
        d.plan_qty_po          AS plan_qty_po,
        d.plan_qty_jadwal      AS plan_qty_jadwal,
        d.plan_line_kelompok   AS plan_line_kelompok,
        d.plan_keterangan      AS plan_keterangan,
        d.plan_supplier_kode   AS supplierKode,
        d.plan_supplier_nama   AS supplierNama,
        d.plan_hari            AS plan_hari,
        d.plan_jam             AS plan_jam,
        d.plan_target_output   AS plan_target_output,
        d.plan_mp              AS plan_mp,
        d.plan_smv             AS plan_smv,
        d.plan_smv_sumber      AS plan_smv_sumber
      FROM tplan_ppic_dtl2 d
      LEFT JOIN tspk s ON s.spk_nomor = d.plan_spk
      WHERE d.plan_pl_nomor = ? AND d.plan_divisi = ?
      ORDER BY d.plan_tgl_jadwal ASC`,
      [nomor, divisi],
    );
    return rows;
  };

  const [cutting, sewing, koli] = await Promise.all([
    loadDivisi("CUTTING"),
    loadDivisi("SEWING"),
    loadDivisi("KOLI"),
  ]);

  // Riwayat: semua planning lain yang punya SPK yang sama
  // dengan SPK yang ada di salah satu tab
  const allSpk = [
    ...cutting.map((r) => r.NomorSPK),
    ...sewing.map((r) => r.NomorSPK),
    ...koli.map((r) => r.NomorSPK),
  ].filter(Boolean);
  const uniqueSpk = [...new Set(allSpk)];

  const [riwayat, sewingItems] = await Promise.all([
    uniqueSpk.length ? getRiwayatBySpkList(uniqueSpk, nomor) : [],
    enrichSewing(sewing, hdr.pl_tgl1, hdr.pl_tgl2),
  ]);

  return {
    header: hdr,
    detail: { cutting, sewing: sewingItems, koli },
    riwayat,
  };
};

// ─────────────────────────────────────────────
// getRiwayatBySpkList — semua planning lain
// yang punya salah satu dari SPK yang ada di grid
// ─────────────────────────────────────────────
const getRiwayatBySpkList = async (spkList, excludeNomor = "") => {
  if (!spkList.length) return [];
  const placeholders = spkList.map(() => "?").join(",");
  const [rows] = await db.query(
    `SELECT DISTINCT
       h.pl_nomor   AS Nomor,
       DATE_FORMAT(h.pl_tgl1, '%Y-%m-%d') AS Tgl1,
       DATE_FORMAT(h.pl_tgl2, '%Y-%m-%d') AS Tgl2,
       h.pl_cab     AS Cabang,
       h.pl_close   AS Close,
       h.pl_keterangan AS Keterangan,
       d.plan_spk   AS NomorSPK,
       s.spk_nama   AS NamaSPK
     FROM tplan_ppic_hdr h
     INNER JOIN tplan_ppic_dtl2 d ON d.plan_pl_nomor = h.pl_nomor
     LEFT JOIN tspk s ON s.spk_nomor = d.plan_spk
     WHERE d.plan_spk IN (${placeholders})
       AND h.pl_nomor <> ?
     ORDER BY h.pl_nomor ASC`,
    [...spkList, excludeNomor],
  );
  return rows;
};

// ─────────────────────────────────────────────
// getRiwayatBySpkList — versi untuk dipanggil
// dari controller saat frontend kirim list SPK
// ─────────────────────────────────────────────
const getRiwayatSpk = async (spkList, excludeNomor = "") => {
  const list = Array.isArray(spkList) ? spkList : [spkList];
  return getRiwayatBySpkList(list, excludeNomor);
};

// ─────────────────────────────────────────────
// getSpkInfo — saat user ketik/pilih SPK per baris
// ─────────────────────────────────────────────
const getSpkInfo = async (spkNomor) => {
  const [rows] = await db.query(
    `SELECT
       s.spk_nomor, s.spk_nama,
       s.spk_jumlah, s.spk_jumlah_kirim,
       (s.spk_jumlah - s.spk_jumlah_kirim) AS spk_kurang,
       DATE_FORMAT(s.spk_tanggal,  '%Y-%m-%d') AS spk_tanggal,
       DATE_FORMAT(s.spk_dateline, '%Y-%m-%d') AS spk_dateline,
       s.spk_cab        AS spk_workshop_kode,
       TRIM(s.spk_workshop) AS spk_workshop,
       s.spk_tipe, s.spk_kain, s.spk_finishing,
       s.spk_sablon, s.spk_sublim, s.spk_bordir
     FROM tspk s
     WHERE s.spk_aktif = 'Y'
       AND s.spk_divisi IN (3,4,6)
       AND s.spk_nomor = ?`,
    [spkNomor],
  );
  if (!rows.length) return null;
  return rows[0];
};

// ─────────────────────────────────────────────
// saveData — create / edit, multi-SPK per baris
// payload.detail = { cutting: [], sewing: [], koli: [] }
// setiap row: { NomorSPK, plan_tgl_jadwal, plan_wip,
//               plan_qty_po, plan_qty_jadwal, plan_line_kelompok,
//               (sewing) plan_hari, plan_jam, plan_target_output }
// MP dari client (default dari DB, boleh diedit). SMV tetap di-stamp server
// ─────────────────────────────────────────────
const saveData = async (payload, userKode) => {
  const {
    pl_nomor,
    pl_tgl1,
    pl_tgl2,
    pl_cab,
    pl_keterangan,
    detail = { cutting: [], sewing: [], koli: [] },
  } = payload;

  if (!pl_tgl1 || !pl_tgl2) throw new Error("Periode planning wajib diisi.");

  // ── Pra-proses sewing (read-only, di luar transaksi) ──
  const sewingRows = (detail.sewing || []).filter((r) => r.NomorSPK);
  const sewingRef = await getSewingReferensi({
    tgl1: pl_tgl1,
    tgl2: pl_tgl2,
    lines: sewingRows.map((r) => r.plan_line_kelompok),
    spkList: sewingRows.map((r) => r.NomorSPK),
    withActual: false,
  });

  // Snapshot lama per (SPK, line) — dipertahankan saat simpan ulang
  const oldSnap = {};
  const oldMpByLine = {}; // MP lama per line: SPK baru di line yang sama ikut nilai ini
  if (pl_nomor) {
    const [oldRows] = await db.query(
      `SELECT plan_spk, plan_line_kelompok, plan_mp, plan_smv, plan_smv_sumber
       FROM tplan_ppic_dtl2
       WHERE plan_pl_nomor = ? AND plan_divisi = 'SEWING'`,
      [pl_nomor],
    );
    for (const o of oldRows) {
      oldSnap[`${o.plan_spk}|${o.plan_line_kelompok}`] = {
        mp: Number(o.plan_mp) || 0,
        smv: Number(o.plan_smv) || 0,
        sumber: o.plan_smv_sumber || "",
      };
      if (!oldMpByLine[o.plan_line_kelompok] && Number(o.plan_mp) > 0) {
        oldMpByLine[o.plan_line_kelompok] = Number(o.plan_mp);
      }
    }
  }

  // MP dari client (boleh diedit user): satu nilai per line, ambil yang pertama > 0
  const clientMpByLine = {};
  for (const r of sewingRows) {
    const v = Math.floor(Number(r.plan_mp) || 0);
    if (v > 0 && !clientMpByLine[r.plan_line_kelompok]) {
      clientMpByLine[r.plan_line_kelompok] = v;
    }
  }

  // MP & SMV per baris sewing. Aturan SMV:
  //  1) baris lama yang sudah PROOF -> dipertahankan (terkunci)
  //  2) SPK punya Proof Garmen JAHIT -> dari proof, client tidak bisa mengubah
  //  3) selain itu -> manual dari client (wajib > 0 untuk line internal)
  const sewingStamp = {};
  for (const row of sewingRows) {
    if (!row.plan_line_kelompok) {
      throw new Error(`Line wajib dipilih untuk SPK ${row.NomorSPK}.`);
    }
    if (!(Number(row.plan_target_output) > 0)) {
      throw new Error(
        `Target output untuk SPK ${row.NomorSPK} wajib diisi (lebih dari 0).`,
      );
    }
    const key = `${row.NomorSPK}|${row.plan_line_kelompok}`;
    const old = oldSnap[key];
    const proof = sewingRef.smvBySpk[row.NomorSPK] || {
      smv: 0,
      sumber: "MANUAL",
    };

    const mp =
      clientMpByLine[row.plan_line_kelompok] ||
      old?.mp ||
      oldMpByLine[row.plan_line_kelompok] ||
      sewingRef.mpByLine[row.plan_line_kelompok] ||
      0;

    let smv;
    let sumber;
    if (old?.sumber === "PROOF" && old.smv > 0) {
      smv = old.smv;
      sumber = "PROOF";
    } else if (proof.sumber === "PROOF") {
      smv = proof.smv;
      sumber = "PROOF";
    } else {
      smv = Number(row.plan_smv) || 0;
      sumber = "MANUAL";
      if (smv <= 0 && lineToBagian(row.plan_line_kelompok)) {
        throw new Error(
          `SMV untuk SPK ${row.NomorSPK} wajib diisi (SPK ini tidak punya Proof Garmen lini Jahit).`,
        );
      }
    }
    sewingStamp[key] = { mp, smv, sumber };
  }

  const conn = await db.getConnection();
  let fase = "header";
  try {
    await conn.beginTransaction();

    const tahun = new Date(pl_tgl1).getFullYear();
    let nomor = pl_nomor;

    if (nomor) {
      // UPDATE header
      await conn.query(
        `UPDATE tplan_ppic_hdr SET
           pl_tgl1       = ?,
           pl_tgl2       = ?,
           pl_cab        = ?,
           pl_keterangan = ?,
           user_modified = ?,
           date_modified = NOW()
         WHERE pl_nomor = ?`,
        [pl_tgl1, pl_tgl2, pl_cab || "", pl_keterangan || "", userKode, nomor],
      );
    } else {
      // INSERT header — kolom pl_spk_nomor sudah tidak ada secara
      // fisik di tabel (sisa skema lama sebelum multi-SPK per baris)
      nomor = await generateNomor(tahun);
      await conn.query(
        `INSERT INTO tplan_ppic_hdr
           (pl_nomor, pl_tgl1, pl_tgl2, pl_cab,
            pl_keterangan, user_create, date_create)
         VALUES (?, ?, ?, ?, ?, ?, NOW())`,
        [nomor, pl_tgl1, pl_tgl2, pl_cab || "", pl_keterangan || "", userKode],
      );
    }

    // Hapus semua detail lama lalu insert ulang
    await conn.query(`DELETE FROM tplan_ppic_dtl2 WHERE plan_pl_nomor = ?`, [
      nomor,
    ]);
    await conn.query(`DELETE FROM tplan_ppic_dtl WHERE pld_nomor = ?`, [nomor]);

    fase = "detail";

    const insertDivisi = async (rows, divisi) => {
      const isSewing = divisi === "SEWING";
      for (const row of rows) {
        // Sewing tidak punya tanggal per baris (granularitas mingguan):
        // tanggal jadwal = awal periode, supaya tetap terbaca getPlanningPpic
        const tgl = isSewing
          ? row.plan_tgl_jadwal || pl_tgl1
          : row.plan_tgl_jadwal;
        if (!row.NomorSPK || !tgl) continue;

        // Supplier cuma relevan buat Sewing dengan Line Eksternal
        const isExternal =
          isSewing && row.plan_line_kelompok === "LINE EXTERNAL";

        const stamp = isSewing
          ? sewingStamp[`${row.NomorSPK}|${row.plan_line_kelompok}`]
          : null;
        const hari =
          isSewing && Number(row.plan_hari) > 0
            ? Number(row.plan_hari)
            : SEWING_DEFAULT_HARI;
        const jam =
          isSewing && Number(row.plan_jam) > 0
            ? Number(row.plan_jam)
            : SEWING_DEFAULT_JAM;
        const target = isSewing ? Number(row.plan_target_output) || 0 : 0;
        // Sewing: qty jadwal = target output (dibaca modul Mutasi Produksi)
        const qtyJadwal = isSewing ? target : Number(row.plan_qty_jadwal) || 0;

        await conn.query(
          `INSERT INTO tplan_ppic_dtl2
            (plan_pl_nomor, plan_spk, plan_divisi, plan_tanggal,
              plan_tgl_jadwal, plan_wip, plan_qty_po,
              plan_qty_jadwal, plan_line_kelompok, plan_keterangan,
              plan_supplier_kode, plan_supplier_nama,
              plan_hari, plan_jam, plan_target_output,
              plan_mp, plan_smv, plan_smv_sumber)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            nomor,
            row.NomorSPK,
            divisi,
            tgl,
            tgl,
            Number(row.plan_wip) || 0,
            Number(row.plan_qty_po) || 0,
            qtyJadwal,
            divisi === "KOLI" ? "" : row.plan_line_kelompok || "",
            row.plan_keterangan || "",
            isExternal ? row.supplierKode || "" : "",
            isExternal ? row.supplierNama || "" : "",
            hari,
            jam,
            target,
            stamp ? stamp.mp : 0,
            stamp ? stamp.smv : 0,
            stamp ? stamp.sumber : "",
          ],
        );
      }
    };

    await insertDivisi(detail.cutting || [], "CUTTING");
    await insertDivisi(detail.sewing || [], "SEWING");
    await insertDivisi(detail.koli || [], "KOLI");

    await conn.commit();
    return { nomor };
  } catch (err) {
    await conn.rollback();
    if (err.code === "ER_DUP_ENTRY" && fase === "detail") {
      throw new Error(
        "Ada baris dobel dalam planning ini (SPK, divisi, line, dan tanggal yang sama).",
      );
    }
    throw err;
  } finally {
    conn.release();
  }
};

// Ambil qty PO Jasa per SPK per divisi
// Sewing = J02, Koli = J03
const getQtyPoJasa = async (spkNomor) => {
  const [rows] = await db.query(
    `SELECT
       h.pojh_jasa_kode                    AS jasa_kode,
       IFNULL(SUM(h.pojh_jumlah), 0)       AS qty_po
     FROM tpojasa_hdr h
     WHERE h.pojh_spk_nomor = ?
       AND h.pojh_jasa_kode IN ('J02', 'J03')
     GROUP BY h.pojh_jasa_kode`,
    [spkNomor],
  );

  // Default 0
  const result = { sewing: 0, koli: 0 };
  for (const r of rows) {
    if (r.jasa_kode === "J02") result.sewing = Number(r.qty_po) || 0;
    if (r.jasa_kode === "J03") result.koli = Number(r.qty_po) || 0;
  }
  return result;
};

// Daftar kelompok per lini dari master tkelompok (default Potong P04)
const getKelompokList = async (lini = "POTONG", cab = "P04") => {
  const [rows] = await db.query(
    `SELECT Kelompok FROM tkelompok WHERE lini = ? AND cab = ? ORDER BY Kelompok`,
    [lini, cab],
  );
  return rows.map((r) => r.Kelompok);
};

module.exports = {
  generateNomor,
  getFormDetail,
  getRiwayatSpk,
  getSpkInfo,
  saveData,
  getQtyPoJasa,
  getSewingReferensi,
  enrichSewing, // dipakai browse (planningSpkService) untuk tampilan sewing format baru
  getKelompokList,
};
