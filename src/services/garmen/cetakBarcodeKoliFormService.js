const db = require("../../config/database");
// Sesuaikan path require dengan lokasi mutasiProduksiFormService di proyekmu
const { getGudangByMutasi } = require("./mutasiProduksiFormService");

// ============================================================
// QR KOLI — FORM SERVICE (fase 1)
// Koli dibuat OTOMATIS saat simpan STBJ (generateKoliStbj, satu transaksi
// dengan STBJ). Menu Cetak Barcode Koli = hasil, cetak ulang, dan VOID.
// Header: tkoli_cetak_hdr (satu dokumen CBK per STBJ), koli: tkoli,
// jejak: tkoli_log, snapshot gate: tkoli_cetak_dtl. Isi QR = koli_id.
//
// Aturan: koli aktif per (STBJ, SPK) selalu sama dengan SUM(stbjd_koli).
// Koli TIDAK PERNAH di-VOID otomatis. Mengurangi koli = VOID manual dulu
// (operator memilih label yang hilang/batal), baru simpan STBJ.
// ============================================================

// Gudang jadi STBJ yang masuk cakupan → cabang (divisi 4)
const FG_SCOPE = { GJ001: "P04", GJ002: "P01" };
const MAKS_KOLI_PER_SPK = 500;
// STBJ bertanggal sebelum ini tidak diatur QR koli (legacy)
const QR_KOLI_MULAI = "2026-11-07";
// Sebelum tanggal ini gate LHK hanya memberi peringatan (tidak memblokir)
const GATE_LHK_BLOKIR_MULAI = "2026-11-14";

const hariIni = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const gateMemblokir = () => hariIni() >= GATE_LHK_BLOKIR_MULAI;

// ─────────────────────────────────────────────
// GENERATE NOMOR — CBK.{yymm}{00001}
// ─────────────────────────────────────────────
const getMaxNomor = async (conn, tanggal) => {
  const d = new Date(tanggal);
  const yy = String(d.getFullYear()).slice(-2);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const prefix = `CBK.${yy}${mm}`; // 8 karakter

  const [rows] = await conn.query(
    `SELECT IFNULL(MAX(RIGHT(kch_nomor, 5)), 0) AS jumlah
     FROM tkoli_cetak_hdr
     WHERE LEFT(kch_nomor, 8) = ?
     FOR UPDATE`,
    [prefix],
  );
  return `${prefix}${String(Number(rows[0].jumlah) + 1).padStart(5, "0")}`;
};

// Nomor ID koli berikutnya. FOR UPDATE pada baris terakhir: transaksi lain
// yang juga membuat koli menunggu sampai transaksi ini commit/rollback.
const ambilIdBerikut = async (conn) => {
  const [last] = await conn.query(
    `SELECT koli_id FROM tkoli ORDER BY koli_id DESC LIMIT 1 FOR UPDATE`,
  );
  return last.length ? parseInt(last[0].koli_id.slice(2), 10) + 1 : 1;
};

// ─────────────────────────────────────────────
// GENERATE KOLI SAAT SIMPAN STBJ
// Dipanggil dari stbjFormService.save SEBELUM commit, memakai connection
// transaksi STBJ (supaya melihat detail STBJ yang belum commit).
//
// Return null bila STBJ di luar cakupan dan tidak punya koli aktif.
// Selain itu: { nomor, koliIdBaru, peringatan }.
// Melempar Error (STBJ ikut rollback) bila:
//  - koli per SPK tidak bulat / 0 / > MAKS
//  - koli STBJ lebih kecil dari koli aktif (VOID manual dulu)
//  - gate LHK gagal setelah GATE_LHK_BLOKIR_MULAI
// ─────────────────────────────────────────────
const generateKoliStbj = async (conn, stbjNomor, { user, perangkat = "" }) => {
  const [h] = await conn.query(
    `SELECT DATE_FORMAT(stbj_tanggal, '%Y-%m-%d') AS tanggal,
            stbj_gdg_kode AS gdg
     FROM tstbj_hdr WHERE stbj_nomor = ?`,
    [stbjNomor],
  );
  if (!h.length) throw new Error("STBJ tidak ditemukan.");
  const { tanggal, gdg } = h[0];
  const cab = FG_SCOPE[gdg] || null;
  const dalamCakupan = !!cab && tanggal >= QR_KOLI_MULAI;

  // Koli yang sudah ada untuk STBJ ini (dikunci selama transaksi)
  const [ada] = await conn.query(
    `SELECT koli_spk_nomor AS spk, koli_urut AS urut, koli_status AS status
     FROM tkoli WHERE koli_stbj_nomor = ? FOR UPDATE`,
    [stbjNomor],
  );
  if (!dalamCakupan && !ada.length) return null;

  const aktifPerSpk = new Map();
  const urutMax = new Map(); // termasuk koli VOID, supaya nomor urut tidak dipakai ulang
  for (const k of ada) {
    urutMax.set(k.spk, Math.max(urutMax.get(k.spk) || 0, Number(k.urut) || 0));
    if (k.status !== "VOID") {
      aktifPerSpk.set(k.spk, (aktifPerSpk.get(k.spk) || 0) + 1);
    }
  }

  const [rows] = await conn.query(
    `SELECT stbjd_spk_nomor AS spk,
            IFNULL(NULLIF(stbjd_size, ''), 'ALLSIZE') AS size,
            SUM(stbjd_jumlah) AS pcs,
            SUM(stbjd_koli) AS koli
     FROM tstbj_dtl
     WHERE stbjd_stbj_nomor = ?
     GROUP BY stbjd_spk_nomor, IFNULL(NULLIF(stbjd_size, ''), 'ALLSIZE')`,
    [stbjNomor],
  );

  // ── Target koli per SPK (luar cakupan = 0) ──
  const target = new Map();
  if (dalamCakupan) {
    const salah = new Set();
    for (const r of rows) {
      const n = Number(r.koli) || 0;
      if (!Number.isInteger(n)) salah.add(r.spk);
      target.set(r.spk, (target.get(r.spk) || 0) + n);
    }
    for (const [spk, n] of target) {
      if (!Number.isInteger(n) || n < 1 || n > MAKS_KOLI_PER_SPK)
        salah.add(spk);
    }
    if (salah.size) {
      throw new Error(
        [...salah]
          .map(
            (spk) =>
              `SPK ${spk}: jumlah koli (${target.get(spk)}) harus bilangan bulat 1-${MAKS_KOLI_PER_SPK}.`,
          )
          .join("\n"),
      );
    }
  }

  // ── Bandingkan target dengan koli aktif ──
  const kurang = [];
  const buat = [];
  for (const spk of new Set([...target.keys(), ...aktifPerSpk.keys()])) {
    const t = target.get(spk) || 0;
    const a = aktifPerSpk.get(spk) || 0;
    if (t < a) kurang.push(`SPK ${spk}: koli di STBJ ${t}, koli aktif ${a}.`);
    else if (t > a) buat.push({ spk, jumlah: t - a, total: t });
  }
  if (kurang.length) {
    throw new Error(
      `${kurang.join("\n")}\nVOID dulu koli yang tidak jadi dikirim di menu Cetak Barcode Koli (pilih label yang hilang/batal), lalu simpan STBJ lagi.`,
    );
  }
  if (!dalamCakupan) return null;

  // ── Dokumen CBK yang sudah ada untuk STBJ ini (satu dokumen per STBJ) ──
  const [dok] = await conn.query(
    `SELECT kch_nomor FROM tkoli_cetak_hdr
     WHERE kch_stbj_nomor = ? ORDER BY kch_nomor LIMIT 1 FOR UPDATE`,
    [stbjNomor],
  );
  let kch = dok.length ? dok[0].kch_nomor : null;

  // pcs yang sudah lolos gate pada simpan sebelumnya (dasar: hanya baris
  // baru/bertambah yang dicek ulang)
  const dasar = new Map();
  if (kch) {
    const [b] = await conn.query(
      `SELECT kcd_spk_nomor AS spk, kcd_size AS size, kcd_pcs AS pcs, kcd_gate_ok AS ok
       FROM tkoli_cetak_dtl WHERE kcd_kch_nomor = ?`,
      [kch],
    );
    b.forEach((r) =>
      dasar.set(`${r.spk}|${r.size}`, {
        pcs: Number(r.pcs) || 0,
        ok: Number(r.ok) === 1,
      }),
    );
  }

  // ── Gate LHK: pcs STBJ <= LHK Finishing (ter-approve) − pcs STBJ lain ──
  // LHK = MAX per kode bahan dari SUM(mpd_jumlah) mutasi lipat→koli.
  const spkList = [...new Set(rows.map((r) => r.spk))];
  const pair = getGudangByMutasi(cab, 6); // lipat → koli

  const [lhkRows] = await conn.query(
    `SELECT h.mph_spk_nomor AS spk,
            IFNULL(NULLIF(d.mpd_size, ''), 'ALLSIZE') AS size,
            d.mpd_bhn_kode AS bhn,
            SUM(d.mpd_jumlah) AS qty
     FROM tmutasiproduksi_hdr h
     INNER JOIN tmutasiproduksi_dtl d ON d.mpd_mph_nomor = h.mph_nomor
     WHERE h.mph_spk_nomor IN (?) AND h.mph_gdgasal = ? AND h.mph_gdgtujuan = ?
       AND h.mph_apv = 'Y'
     GROUP BY h.mph_spk_nomor, IFNULL(NULLIF(d.mpd_size, ''), 'ALLSIZE'), d.mpd_bhn_kode`,
    [spkList, pair.asal, pair.tujuan],
  );
  const lhkMap = new Map();
  for (const r of lhkRows) {
    const k = `${r.spk}|${r.size}`;
    lhkMap.set(k, Math.max(lhkMap.get(k) ?? 0, Number(r.qty) || 0));
  }

  const [lainRows] = await conn.query(
    `SELECT stbjd_spk_nomor AS spk,
            IFNULL(NULLIF(stbjd_size, ''), 'ALLSIZE') AS size,
            SUM(stbjd_jumlah) AS qty
     FROM tstbj_dtl
     WHERE stbjd_spk_nomor IN (?) AND stbjd_stbj_nomor <> ?
     GROUP BY stbjd_spk_nomor, IFNULL(NULLIF(stbjd_size, ''), 'ALLSIZE')`,
    [spkList, stbjNomor],
  );
  const lainMap = new Map(
    lainRows.map((r) => [`${r.spk}|${r.size}`, Number(r.qty) || 0]),
  );

  const gate = rows.map((r) => {
    const k = `${r.spk}|${r.size}`;
    const pcs = Number(r.pcs) || 0;
    const lhk = lhkMap.has(k) ? lhkMap.get(k) : null;
    const lain = lainMap.get(k) || 0;
    const sisa = (lhk ?? 0) - lain;
    const d = dasar.get(k);
    const dicek = !d || pcs > d.pcs + 0.001; // baris baru atau bertambah
    const ok = lhk !== null && pcs <= sisa + 0.001;
    return {
      spk: r.spk,
      size: r.size,
      pcs,
      lhk,
      lain,
      sisa,
      dicek,
      ok,
      okSimpan: dicek ? ok : d.ok,
    };
  });

  const pesanGate = gate
    .filter((g) => g.dicek && !g.ok)
    .map((g) =>
      g.lhk === null
        ? `SPK ${g.spk} size ${g.size}: LHK Finishing (ter-approve) belum ada.`
        : `SPK ${g.spk} size ${g.size}: STBJ ${g.pcs} > sisa LHK ${g.sisa} (LHK ${g.lhk}, dipakai STBJ lain ${g.lain}).`,
    );
  const peringatan = [];
  if (pesanGate.length) {
    if (gateMemblokir()) throw new Error(pesanGate.join("\n"));
    peringatan.push(
      ...pesanGate.map((p) => `${p} (masa toleransi, belum memblokir)`),
    );
  }

  // ── Buat koli baru ──
  const koliIdBaru = [];
  if (buat.length) {
    let next = await ambilIdBerikut(conn);

    if (!kch) {
      kch = await getMaxNomor(conn, tanggal);
      await conn.query(
        `INSERT INTO tkoli_cetak_hdr
           (kch_nomor, kch_tanggal, kch_cab, kch_stbj_nomor, kch_keterangan, user_create)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [kch, tanggal, cab, stbjNomor, "", user.kode],
      );
    }

    const koliRows = [];
    const logRows = [];
    for (const b of buat) {
      let urut = urutMax.get(b.spk) || 0;
      for (let i = 0; i < b.jumlah; i++) {
        urut++;
        const id = `KL${String(next++).padStart(8, "0")}`;
        koliRows.push([
          id,
          kch,
          stbjNomor,
          b.spk,
          urut,
          b.total, // informasi: total saat koli dibuat, bukan acuan
          cab,
          gdg,
          "DIBUAT",
          0,
          user.kode,
        ]);
        logRows.push([
          id,
          "BUAT",
          "OK",
          `STBJ ${stbjNomor}`,
          user.kode,
          perangkat,
        ]);
        koliIdBaru.push(id);
      }
    }
    await conn.query(
      `INSERT INTO tkoli
         (koli_id, koli_kch_nomor, koli_stbj_nomor, koli_spk_nomor, koli_urut,
          koli_total, koli_cab, koli_gdg_kode, koli_status, koli_cetak_count, user_create)
       VALUES ?`,
      [koliRows],
    );
    await conn.query(
      `INSERT INTO tkoli_log
         (log_koli_id, log_aksi, log_hasil, log_alasan, log_user, log_perangkat)
       VALUES ?`,
      [logRows],
    );
  }

  // ── Snapshot gate terbaru (dasar pengecekan simpan berikutnya + audit) ──
  if (kch) {
    await conn.query(`DELETE FROM tkoli_cetak_dtl WHERE kcd_kch_nomor = ?`, [
      kch,
    ]);
    await conn.query(
      `INSERT INTO tkoli_cetak_dtl
         (kcd_kch_nomor, kcd_spk_nomor, kcd_size, kcd_pcs, kcd_lhk, kcd_terpakai_lain, kcd_gate_ok)
       VALUES ?`,
      [
        gate.map((g) => [
          kch,
          g.spk,
          g.size,
          g.pcs,
          g.lhk,
          g.lain,
          g.okSimpan ? 1 : 0,
        ]),
      ],
    );
  }

  return { nomor: kch, koliIdBaru, peringatan };
};

// Dipanggil di dalam transaksi hapus STBJ, SEBELUM DELETE tstbj_hdr.
// 1) STBJ yang masih punya koli aktif tidak boleh dihapus (VOID dulu).
// 2) Nomor STBJ terakhir bisa dipakai ulang oleh STBJ baru (penomoran MAX+1),
//    jadi dokumen/koli lama dilepas dari nomor itu. Kalau tidak, STBJ baru
//    mewarisi dokumen lama dan snapshot gate-nya (gate bisa terlewati).
const lepasKoliStbj = async (conn, stbjNomor) => {
  // kunci header: simpan dan hapus STBJ yang sama tidak bisa berjalan bersamaan
  await conn.query(
    `SELECT stbj_nomor FROM tstbj_hdr WHERE stbj_nomor = ? FOR UPDATE`,
    [stbjNomor],
  );
  const [r] = await conn.query(
    `SELECT COUNT(*) AS n FROM tkoli
     WHERE koli_stbj_nomor = ? AND koli_status <> 'VOID' FOR UPDATE`,
    [stbjNomor],
  );
  const n = Number(r[0].n) || 0;
  if (n > 0) {
    throw new Error(
      `STBJ ${stbjNomor} masih punya ${n} koli aktif. VOID semua koli di menu Cetak Barcode Koli sebelum menghapus STBJ.`,
    );
  }

  // urutan penting: snapshot → koli → header (header dicari lewat nomor STBJ)
  await conn.query(
    `DELETE FROM tkoli_cetak_dtl
     WHERE kcd_kch_nomor IN (SELECT kch_nomor FROM tkoli_cetak_hdr WHERE kch_stbj_nomor = ?)`,
    [stbjNomor],
  );
  await conn.query(
    `UPDATE tkoli SET koli_stbj_nomor = CONCAT('#', koli_kch_nomor)
     WHERE koli_stbj_nomor = ?`,
    [stbjNomor],
  );
  await conn.query(
    `UPDATE tkoli_cetak_hdr
     SET kch_keterangan = CONCAT('STBJ dihapus: ', kch_stbj_nomor),
         kch_stbj_nomor = CONCAT('#', kch_nomor)
     WHERE kch_stbj_nomor = ?`,
    [stbjNomor],
  );
};

// ─────────────────────────────────────────────
// SEARCH STBJ (lookup modal, hanya gudang cakupan). Format {items, total}
// ─────────────────────────────────────────────
const searchStbj = async ({ q = "", page = 1, limit = 50 }) => {
  const p = Math.max(1, Number(page) || 1);
  const l = Math.min(200, Math.max(1, Number(limit) || 50));
  const like = `%${String(q).trim()}%`;

  const whereSql = `h.stbj_gdg_kode IN (?)
    AND (h.stbj_nomor LIKE ?
         OR IFNULL(h.stbj_keterangan, '') LIKE ?
         OR EXISTS (SELECT 1 FROM tstbj_dtl x
                    WHERE x.stbjd_stbj_nomor = h.stbj_nomor AND x.stbjd_spk_nomor LIKE ?))`;
  const params = [Object.keys(FG_SCOPE), like, like, like];

  const [[{ total }]] = await db.query(
    `SELECT COUNT(*) AS total FROM tstbj_hdr h WHERE ${whereSql}`,
    params,
  );

  const [rows] = await db.query(
    `SELECT
       h.stbj_nomor AS Nomor,
       DATE_FORMAT(h.stbj_tanggal, '%Y-%m-%d') AS Tanggal,
       h.stbj_gdg_kode AS Gudang,
       g.gdg_nama AS GudangNama,
       h.stbj_keterangan AS Keterangan,
       (SELECT COUNT(DISTINCT d.stbjd_spk_nomor) FROM tstbj_dtl d
         WHERE d.stbjd_stbj_nomor = h.stbj_nomor) AS JumlahSpk,
       (SELECT IFNULL(SUM(d.stbjd_koli), 0) FROM tstbj_dtl d
         WHERE d.stbjd_stbj_nomor = h.stbj_nomor) AS TotalKoli,
       (SELECT COUNT(*) FROM tkoli k
         WHERE k.koli_stbj_nomor = h.stbj_nomor AND k.koli_status <> 'VOID') AS KoliQr
     FROM tstbj_hdr h
     LEFT JOIN tgudang g ON g.gdg_kode = h.stbj_gdg_kode
     WHERE ${whereSql}
     ORDER BY h.stbj_tanggal DESC, h.stbj_nomor DESC
     LIMIT ? OFFSET ?`,
    [...params, l, (p - 1) * l],
  );

  return {
    items: rows.map((r) => ({
      ...r,
      JumlahSpk: Number(r.JumlahSpk) || 0,
      TotalKoli: Number(r.TotalKoli) || 0,
      KoliQr: Number(r.KoliQr) || 0,
    })),
    total: Number(total) || 0,
  };
};

// Data label untuk dicetak (tanpa koli VOID)
const ambilUnits = async (q, nomor, koliIds = []) => {
  const params = [nomor];
  let filter = "";
  if (koliIds.length) {
    filter = "AND k.koli_id IN (?)";
    params.push(koliIds);
  }
  const [rows] = await q.query(
    `SELECT k.koli_id AS koliId,
            k.koli_spk_nomor AS spk,
            COALESCE(s.spk_nama,
                     (SELECT MAX(i.spgi_nama) FROM tspk_gudangitem i WHERE i.spgi_spk = k.koli_spk_nomor),
                     (SELECT MAX(m.mspk_nama) FROM tmemospk m WHERE m.mspk_nomor = k.koli_spk_nomor),
                     '') AS namaSpk,
            k.koli_stbj_nomor AS stbj,
            DATE_FORMAT(t.stbj_tanggal, '%Y-%m-%d') AS tanggal,
            k.koli_urut AS urut,
            k.koli_cab AS cab
     FROM tkoli k
     LEFT JOIN tspk s ON s.spk_nomor = k.koli_spk_nomor
     LEFT JOIN tstbj_hdr t ON t.stbj_nomor = k.koli_stbj_nomor
     WHERE k.koli_kch_nomor = ? AND k.koli_status <> 'VOID' ${filter}
     ORDER BY k.koli_spk_nomor, k.koli_urut`,
    params,
  );
  return rows;
};

// ─────────────────────────────────────────────
// GET DETAIL dokumen
// ─────────────────────────────────────────────
const getDetail = async (nomor) => {
  const [h] = await db.query(
    `SELECT kch_nomor AS nomor,
            DATE_FORMAT(kch_tanggal, '%Y-%m-%d') AS tanggal,
            kch_cab AS cab,
            kch_stbj_nomor AS stbjNomor,
            kch_keterangan AS keterangan,
            user_create AS userCreate
     FROM tkoli_cetak_hdr WHERE kch_nomor = ?`,
    [nomor],
  );
  if (!h.length) return null;

  const [koli] = await db.query(
    `SELECT k.koli_id AS koliId,
            k.koli_spk_nomor AS spk,
            s.spk_nama AS namaSpk,
            k.koli_urut AS urut,
            k.koli_status AS status,
            k.koli_cetak_count AS jumlahCetak,
            k.koli_void_alasan AS voidAlasan
     FROM tkoli k
     LEFT JOIN tspk s ON s.spk_nomor = k.koli_spk_nomor
     WHERE k.koli_kch_nomor = ?
     ORDER BY k.koli_spk_nomor, k.koli_urut`,
    [nomor],
  );
  return { header: h[0], koli };
};

// ─────────────────────────────────────────────
// CETAK — semua koli non-VOID dokumen, atau sebagian (koliIds).
// Dipakai untuk cetak pertama (dialog setelah simpan STBJ) dan cetak ulang.
// ─────────────────────────────────────────────
const cetakUlang = async (nomor, koliIds, user, perangkat = "") => {
  const ids = [...new Set((koliIds || []).map(String))];
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [ada] = await conn.query(
      `SELECT koli_id, koli_cetak_count FROM tkoli
       WHERE koli_kch_nomor = ? AND koli_status <> 'VOID'
       ${ids.length ? "AND koli_id IN (?)" : ""}
       FOR UPDATE`,
      ids.length ? [nomor, ids] : [nomor],
    );
    if (!ada.length) throw new Error("Tidak ada koli yang bisa dicetak.");
    if (ids.length && ada.length !== ids.length) {
      throw new Error("Sebagian koli bukan milik dokumen ini atau sudah VOID.");
    }
    const target = ada.map((r) => r.koli_id);

    await conn.query(
      `UPDATE tkoli SET koli_cetak_count = koli_cetak_count + 1 WHERE koli_id IN (?)`,
      [target],
    );
    await conn.query(
      `INSERT INTO tkoli_log
         (log_koli_id, log_aksi, log_hasil, log_alasan, log_user, log_perangkat)
       VALUES ?`,
      [
        ada.map((r) => [
          r.koli_id,
          "CETAK",
          "OK",
          Number(r.koli_cetak_count) === 0 ? "CETAK PERTAMA" : "CETAK ULANG",
          user.kode,
          perangkat,
        ]),
      ],
    );

    const units = await ambilUnits(conn, nomor, target);
    await conn.commit();
    return { nomor, units };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
};

// ─────────────────────────────────────────────
// VOID — hanya koli berstatus DIBUAT (belum divalidasi Gudang FG), wajib alasan
// ─────────────────────────────────────────────
const voidKoli = async (payload, user, perangkat = "") => {
  const ids = [...new Set((payload.koliIds || []).map(String))];
  const alasan = String(payload.alasan || "").trim();
  if (!ids.length) throw new Error("Pilih koli yang akan di-VOID.");
  if (alasan.length < 5) {
    throw new Error("Alasan VOID wajib diisi (minimal 5 karakter).");
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [rows] = await conn.query(
      `SELECT koli_id, koli_status FROM tkoli WHERE koli_id IN (?) FOR UPDATE`,
      [ids],
    );
    if (rows.length !== ids.length) {
      throw new Error("Sebagian ID koli tidak ditemukan.");
    }
    const bukan = rows.filter((r) => r.koli_status !== "DIBUAT");
    if (bukan.length) {
      throw new Error(
        `Hanya koli berstatus DIBUAT yang bisa di-VOID. Tidak memenuhi: ${bukan
          .map((r) => `${r.koli_id} (${r.koli_status})`)
          .join(", ")}`,
      );
    }

    await conn.query(
      `UPDATE tkoli
       SET koli_status = 'VOID', koli_user_void = ?, koli_tgl_void = NOW(), koli_void_alasan = ?
       WHERE koli_id IN (?)`,
      [user.kode, alasan, ids],
    );
    await conn.query(
      `INSERT INTO tkoli_log
         (log_koli_id, log_aksi, log_hasil, log_alasan, log_user, log_perangkat)
       VALUES ?`,
      [ids.map((id) => [id, "VOID", "OK", alasan, user.kode, perangkat])],
    );

    await conn.commit();
    return { jumlah: ids.length };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
};

module.exports = {
  FG_SCOPE,
  generateKoliStbj,
  lepasKoliStbj,
  searchStbj,
  getDetail,
  cetakUlang,
  voidKoli,
};
