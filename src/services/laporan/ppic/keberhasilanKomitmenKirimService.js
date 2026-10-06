const db = require("../../../config/database");

const pad2 = (n) => String(n).padStart(2, "0");
const toYmd = (d) =>
  `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const round1 = (v) => Math.round(v * 10) / 10;
const persen = (tercapai, rencana) =>
  rencana > 0 ? round1((tercapai / rencana) * 100) : 0;
const q = async (sql, params) => (await db.query(sql, params))[0];

// Sama dengan kolom "Sumber" di penjadwalanPpicService.getDetail
const jenisDari = (r) =>
  r.SoNomor
    ? "SO"
    : r.MapNomor
      ? "MAP"
      : r.MhNomor
        ? "PERMINTAAN HARGA"
        : r.PenNomor
          ? "PENAWARAN"
          : r.ProNomor
            ? "PRA ORDER"
            : "MANUAL";

// Map kunci → [{Tgl, Qty}] terurut tanggal
const buildIndex = (list) => {
  const m = new Map();
  for (const s of list) {
    if (!m.has(s.Kunci)) m.set(s.Kunci, []);
    m.get(s.Kunci).push({ Tgl: s.Tgl, Qty: s.Qty });
  }
  for (const arr of m.values()) arr.sort((a, b) => (a.Tgl < b.Tgl ? -1 : 1));
  return m;
};

// Total pergerakan di dalam minggu [tgl1, tgl2]
const totalMinggu = (idx, kunci, tgl1, tgl2) => {
  let t = 0;
  for (const s of idx.get(kunci) || []) {
    if (s.Tgl >= tgl1 && s.Tgl <= tgl2) t += s.Qty;
  }
  return t;
};

// Tanggal target tercapai: saldo awal (sisa dari luar minggu) + pergerakan harian dalam minggu.
// Kalau saldo awal saja sudah cukup, tanggalnya Tgl1 (awal minggu).
const tglCapaiMinggu = (idx, kunci, tgl1, tgl2, saldoAwal, target) => {
  if (saldoAwal >= target) return tgl1;
  let total = saldoAwal;
  for (const s of idx.get(kunci) || []) {
    if (s.Tgl < tgl1) continue;
    if (s.Tgl > tgl2) break;
    total += s.Qty;
    if (total >= target) return s.Tgl;
  }
  return null;
};

/**
 * Keberhasilan Komitmen Kirim (per qty).
 *  - Realisasi per baris = rumus yang SAMA dengan penjadwalanPpicService.getDetail
 *    (MAP/manual = realisasi manual; P02 = SJ approved dalam minggu; cabang lain =
 *    STBJ minggu itu + sisa STBJ di luar minggu yang belum terkirim).
 *  - Tercapai per baris = MIN(Rencana, Realisasi).
 *  - Periode yang belum selesai (tgl2 >= hari ini) tidak ikut persen ringkasan kecuali includeBerjalan=1.
 * Query: startDate, endDate, cabang, tipe (SO|MAP), includeBerjalan
 */
const getKeberhasilanKomitmenKirim = async (query) => {
  const now = new Date();
  const endDate = query.endDate || toYmd(now);
  const startDate = query.startDate || `${endDate.substring(0, 7)}-01`;
  const cabang = query.cabang && query.cabang !== "ALL" ? query.cabang : "";
  const tipe = query.tipe || "";
  const includeBerjalan = ["1", "true"].includes(String(query.includeBerjalan));

  // ── 1. Baris komitmen (tanpa Realisasi, dihitung di langkah 2) ──
  const params = [startDate, endDate];
  let where = `h.pjw_tgl2 >= ? AND h.pjw_tgl1 <= ?`;
  if (cabang) {
    where += ` AND h.pjw_cab = ?`;
    params.push(cabang);
  }
  if (tipe) {
    where += ` AND d.pjwd_tipe = ?`;
    params.push(tipe);
  }

  const rawRows = await q(
    `SELECT
       d.pjwd_id AS Id,
       d.pjwd_pjw_nomor AS Periode,
       DATE_FORMAT(h.pjw_tgl1, '%Y-%m-%d') AS Tgl1,
       DATE_FORMAT(h.pjw_tgl2, '%Y-%m-%d') AS Tgl2,
       h.pjw_cab AS Cab,
       d.pjwd_tipe AS Tipe,
       COALESCE(d.pjwd_so_nomor, sfm.so_nomor) AS SoNomor,
       d.pjwd_pro_nomor AS ProNomor,
       d.pjwd_map_nomor AS MapNomor,
       d.pjwd_mh_nomor AS MhNomor,
       d.pjwd_pen_nomor AS PenNomor,
       d.pjwd_rencana AS Rencana,
       IFNULL(d.pjwd_realisasi_manual, 0) AS RealManual,
       COALESCE(so.so_spk_ref, COALESCE(d.pjwd_so_nomor, sfm.so_nomor)) AS SpkKey,
       COALESCE(so.so_nama, sk.spk_nama, mp.mspk_nama, mh.mh_nama,
                pend.pend_nama_barang, pro.pro_nama_pekerjaan,
                d.pjwd_nama_manual) AS Nama,
       IF(h.pjw_tgl2 < CURDATE(), 1, 0) AS Selesai
     FROM tpenjadwalan_ppic_dtl d
     INNER JOIN tpenjadwalan_ppic_hdr h ON h.pjw_nomor = d.pjwd_pjw_nomor
     LEFT JOIN tsalesorder sfm
       ON sfm.so_memo = d.pjwd_map_nomor
       AND sfm.so_aktif = 'Y'
       AND d.pjwd_so_nomor IS NULL
       AND sfm.so_nomor = (
         SELECT MIN(x.so_nomor) FROM tsalesorder x
         WHERE x.so_memo = d.pjwd_map_nomor AND x.so_aktif = 'Y'
       )
     LEFT JOIN tsalesorder so
       ON so.so_nomor = COALESCE(d.pjwd_so_nomor, sfm.so_nomor)
     LEFT JOIN tspk sk
       ON sk.spk_nomor = CONVERT(COALESCE(d.pjwd_so_nomor, sfm.so_nomor) USING latin1)
       AND sk.spk_is_so = 0
     LEFT JOIN tmemospk mp
       ON mp.mspk_nomor = CONVERT(d.pjwd_map_nomor USING latin1)
       AND sfm.so_nomor IS NULL
     LEFT JOIN tpraorder_hdr pro ON pro.pro_nomor = d.pjwd_pro_nomor
     LEFT JOIN tmintaharga mh
       ON mh.mh_nomor = CONVERT(d.pjwd_mh_nomor USING latin1)
     LEFT JOIN tpenawaran_dtl pend
       ON pend.pend_pen_nomor = CONVERT(d.pjwd_pen_nomor USING latin1)
       AND pend.pend_id = d.pjwd_pen_id
     WHERE ${where}
     ORDER BY h.pjw_tgl1, h.pjw_cab, d.pjwd_pjw_nomor, d.pjwd_id`,
    params,
  );

  const seenId = new Set();
  const dataRows = rawRows.filter((r) => !seenId.has(r.Id) && seenId.add(r.Id));

  const rows = dataRows.map((r) => ({
    Id: r.Id,
    Periode: r.Periode,
    Tgl1: r.Tgl1,
    Tgl2: r.Tgl2,
    Cab: r.Cab,
    Tipe: r.Tipe,
    SoNomor: r.SoNomor,
    ProNomor: r.ProNomor,
    MapNomor: r.MapNomor,
    MhNomor: r.MhNomor,
    PenNomor: r.PenNomor,
    SpkKey: r.SpkKey,
    Nama: r.Nama,
    Selesai: Number(r.Selesai) === 1,
    Rencana: Number(r.Rencana) || 0,
    RealManual: Number(r.RealManual) || 0,
    Jenis: jenisDari(r),
    Aktual: 0,
    Tercapai: 0,
    TglTercapai: null,
  }));

  // ── 2. Realisasi — rumus sama dengan getDetail, tapi dihitung set-based ──
  // Dari mana realisasi diambil: MANUAL | SJ (cabang P02) | STBJ (cabang lain)
  const sumber = (r) => {
    if (r.Tipe === "MAP") return r.MapNomor ? "BAST" : "MANUAL";
    if (!r.SoNomor && !r.MapNomor && !r.ProNomor) return "MANUAL";
    return r.Cab === "P02" ? "SJ" : "STBJ";
  };
  const unik = (arr) => [...new Set(arr)];
  const toQty = (list) =>
    list.map((s) => ({ Kunci: s.Kunci, Tgl: s.Tgl, Qty: Number(s.Qty) || 0 }));

  const butuh = rows.filter(
    (r) => ["SJ", "STBJ"].includes(sumber(r)) && r.SpkKey,
  );
  let sjHarian = new Map();
  let stbjHarian = new Map();
  const sjTotal = new Map();
  const stbjTotal = new Map();

  if (butuh.length) {
    const minTgl = butuh.reduce(
      (m, r) => (r.Tgl1 < m ? r.Tgl1 : m),
      butuh[0].Tgl1,
    );
    const maxTgl = butuh.reduce(
      (m, r) => (r.Tgl2 > m ? r.Tgl2 : m),
      butuh[0].Tgl2,
    );
    const keyP02 = unik(
      butuh.filter((r) => r.Cab === "P02").map((r) => r.SpkKey),
    );
    const keyStbj = unik(
      butuh.filter((r) => r.Cab !== "P02").map((r) => r.SpkKey),
    );
    const none = Promise.resolve([]);

    const [sjH, stbjH, sjT, stbjT] = await Promise.all([
      // SJ approved per tanggal — cabang P02
      keyP02.length
        ? q(
            `SELECT sd.sjd_spk_nomor AS Kunci,
                    DATE_FORMAT(sh.sj_tanggal, '%Y-%m-%d') AS Tgl,
                    SUM(sd.sjd_jumlah) AS Qty
             FROM tsj_dtl sd
             INNER JOIN tsj_hdr sh ON sh.sj_nomor = sd.sjd_sj_nomor
             WHERE sd.sjd_spk_nomor IN (?)
               AND sh.sj_approve <> 2
               AND sh.sj_tanggal >= ?
               AND sh.sj_tanggal < DATE_ADD(?, INTERVAL 1 DAY)
             GROUP BY sd.sjd_spk_nomor, Tgl`,
            [keyP02, minTgl, maxTgl],
          )
        : none,
      // STBJ per tanggal dalam rentang — cabang lain
      keyStbj.length
        ? q(
            `SELECT td.stbjd_spk_nomor AS Kunci,
                    DATE_FORMAT(th.stbj_tanggal, '%Y-%m-%d') AS Tgl,
                    SUM(td.stbjd_jumlah) AS Qty
             FROM tstbj_dtl td
             INNER JOIN tstbj_hdr th ON th.stbj_nomor = td.stbjd_stbj_nomor
             WHERE td.stbjd_spk_nomor IN (?)
               AND th.stbj_tanggal >= ?
               AND th.stbj_tanggal < DATE_ADD(?, INTERVAL 1 DAY)
             GROUP BY td.stbjd_spk_nomor, Tgl`,
            [keyStbj, minTgl, maxTgl],
          )
        : none,
      // Total SJ approved sepanjang waktu — untuk pengurang sisa STBJ
      keyStbj.length
        ? q(
            `SELECT sd.sjd_spk_nomor AS Kunci, SUM(sd.sjd_jumlah) AS Qty
             FROM tsj_dtl sd
             INNER JOIN tsj_hdr sh ON sh.sj_nomor = sd.sjd_sj_nomor
             WHERE sd.sjd_spk_nomor IN (?) AND sh.sj_approve <> 2
             GROUP BY sd.sjd_spk_nomor`,
            [keyStbj],
          )
        : none,
      // Total STBJ sepanjang waktu — luar minggu = total − dalam minggu
      keyStbj.length
        ? q(
            `SELECT td.stbjd_spk_nomor AS Kunci, SUM(td.stbjd_jumlah) AS Qty
             FROM tstbj_dtl td
             INNER JOIN tstbj_hdr th ON th.stbj_nomor = td.stbjd_stbj_nomor
             WHERE td.stbjd_spk_nomor IN (?)
             GROUP BY td.stbjd_spk_nomor`,
            [keyStbj],
          )
        : none,
    ]);

    sjHarian = buildIndex(toQty(sjH));
    stbjHarian = buildIndex(toQty(stbjH));
    sjT.forEach((x) => sjTotal.set(x.Kunci, Number(x.Qty) || 0));
    stbjT.forEach((x) => stbjTotal.set(x.Kunci, Number(x.Qty) || 0));
  }

  // BAST MAP: realisasi tipe MAP = jumlah jadi dari form BAST
  const bastInfo = new Map(); // nomor MAP -> { Jadi, Tgl }
  const mapKeys = unik(
    rows
      .filter((r) => sumber(r) === "BAST")
      .map((r) => String(r.MapNomor).trim()),
  );
  if (mapKeys.length) {
    const [jadiRows, bastRows] = await Promise.all([
      q(
        `SELECT mspk_nomor AS Kunci, IFNULL(mspk_jumlah_jadi, 0) AS Jadi
         FROM tmemospk WHERE mspk_nomor IN (?)`,
        [mapKeys],
      ),
      q(
        `SELECT mspk_nomor AS Kunci,
                DATE_FORMAT(MIN(date_create), '%Y-%m-%d') AS Tgl
         FROM tkesesuaianmap WHERE mspk_nomor IN (?)
         GROUP BY mspk_nomor`,
        [mapKeys],
      ),
    ]);
    const jadi = new Map(
      jadiRows.map((x) => [String(x.Kunci).trim(), Number(x.Jadi) || 0]),
    );
    for (const b of bastRows) {
      const k = String(b.Kunci).trim();
      bastInfo.set(k, { Jadi: jadi.get(k) || 0, Tgl: b.Tgl || null });
    }
  }
  // Satu MAP bisa punya >1 baris di periode yang sama: realisasi dibagi, bukan digandakan
  const bastPool = new Map();
  const bastLast = new Map();
  for (const r of rows) {
    if (sumber(r) !== "BAST") continue;
    const k = `${r.Periode}|${String(r.MapNomor).trim()}`;
    bastLast.set(k, r.Id);
    if (!bastPool.has(k)) {
      const b = bastInfo.get(String(r.MapNomor).trim());
      bastPool.set(k, b && (!b.Tgl || b.Tgl <= r.Tgl2) ? b.Jadi : 0);
    }
  }

  for (const r of rows) {
    const s = sumber(r);
    let realisasi = 0;
    let idx = null;
    let saldoAwal = 0;

    if (s === "MANUAL") {
      realisasi = r.RealManual;
    } else if (s === "BAST") {
      const k = `${r.Periode}|${String(r.MapNomor).trim()}`;
      const sisa = bastPool.get(k) || 0;
      // baris terakhir di grup menampung sisa (tanpa batas Rencana, sama dengan SO)
      const ambil = bastLast.get(k) === r.Id ? sisa : Math.min(sisa, r.Rencana);
      bastPool.set(k, sisa - ambil);
      realisasi = ambil;
    } else if (r.SpkKey && s === "SJ") {
      idx = sjHarian;
      realisasi = totalMinggu(idx, r.SpkKey, r.Tgl1, r.Tgl2);
    } else if (r.SpkKey) {
      idx = stbjHarian;
      const dalam = totalMinggu(idx, r.SpkKey, r.Tgl1, r.Tgl2);
      const luar = (stbjTotal.get(r.SpkKey) || 0) - dalam;
      saldoAwal = Math.max(luar - (sjTotal.get(r.SpkKey) || 0), 0);
      realisasi = dalam + saldoAwal;
    }

    r.Aktual = realisasi;
    r.Tercapai = realisasi;

    // Tanggal target tercapai (diamond) — hanya bila ada data harian
    if (idx && r.Rencana > 0 && r.Tercapai >= r.Rencana) {
      r.TglTercapai =
        tglCapaiMinggu(idx, r.SpkKey, r.Tgl1, r.Tgl2, saldoAwal, r.Rencana) ||
        r.Tgl2;
    }
    if (s === "BAST" && r.Rencana > 0 && r.Tercapai >= r.Rencana) {
      const tglBast = bastInfo.get(String(r.MapNomor).trim())?.Tgl;
      r.TglTercapai = tglBast && tglBast > r.Tgl1 ? tglBast : r.Tgl1;
    }
  }

  // Baris tanpa rencana dan tanpa realisasi tidak relevan
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i].Rencana === 0 && rows[i].Tercapai === 0) rows.splice(i, 1);
  }

  // ── 3. Status ──
  for (const r of rows) {
    r.Status =
      r.Rencana === 0
        ? "TAMBAHAN"
        : r.Tercapai >= r.Rencana
          ? "TERCAPAI"
          : !r.Selesai
            ? "BERJALAN"
            : r.Tercapai > 0
              ? "SEBAGIAN"
              : "GAGAL";
  }

  // ── 4. Agregat per periode & ringkasan ──
  const perPeriode = new Map();
  for (const r of rows) {
    if (!perPeriode.has(r.Periode)) {
      perPeriode.set(r.Periode, {
        Periode: r.Periode,
        Tgl1: r.Tgl1,
        Tgl2: r.Tgl2,
        Cab: r.Cab,
        Selesai: r.Selesai,
        Rencana: 0,
        Tercapai: 0,
        RencanaSO: 0,
        TercapaiSO: 0,
        RencanaMAP: 0,
        TercapaiMAP: 0,
        JmlBaris: 0,
        JmlTercapai: 0,
      });
    }
    const p = perPeriode.get(r.Periode);
    p.Rencana += r.Rencana;
    p.Tercapai += r.Tercapai;
    if (r.Tipe === "MAP") {
      p.RencanaMAP += r.Rencana;
      p.TercapaiMAP += r.Tercapai;
    } else {
      p.RencanaSO += r.Rencana;
      p.TercapaiSO += r.Tercapai;
    }
    p.JmlBaris += 1;
    if (r.Status === "TERCAPAI") p.JmlTercapai += 1;
  }
  const periode = [...perPeriode.values()].map((p) => ({
    ...p,
    Persen: persen(p.Tercapai, p.Rencana),
    PersenSO: persen(p.TercapaiSO, p.RencanaSO),
    PersenMAP: persen(p.TercapaiMAP, p.RencanaMAP),
  }));

  const dihitung = periode.filter((p) => p.Selesai || includeBerjalan);
  const sum = (arr, k) => arr.reduce((s, x) => s + x[k], 0);
  const ringkasan = {
    JmlPeriode: dihitung.length,
    Rencana: sum(dihitung, "Rencana"),
    Tercapai: sum(dihitung, "Tercapai"),
    Persen: persen(sum(dihitung, "Tercapai"), sum(dihitung, "Rencana")),
    PersenSO: persen(sum(dihitung, "TercapaiSO"), sum(dihitung, "RencanaSO")),
    PersenMAP: persen(
      sum(dihitung, "TercapaiMAP"),
      sum(dihitung, "RencanaMAP"),
    ),
    IncludeBerjalan: includeBerjalan,
  };

  const detail = rows.map((r) => ({
    Id: r.Id,
    Periode: r.Periode,
    Tgl1: r.Tgl1,
    Tgl2: r.Tgl2,
    Cab: r.Cab,
    Tipe: r.Tipe,
    Jenis: r.Jenis,
    Nomor:
      r.SoNomor || r.MapNomor || r.ProNomor || r.MhNomor || r.PenNomor || "-",
    Nama: r.Nama || "",
    Rencana: r.Rencana,
    Aktual: r.Aktual,
    Tercapai: r.Tercapai,
    TglTercapai: r.TglTercapai || null,
    Persen: persen(r.Tercapai, r.Rencana),
    Status: r.Status,
  }));

  return { ringkasan, periode, detail };
};

module.exports = { getKeberhasilanKomitmenKirim };
