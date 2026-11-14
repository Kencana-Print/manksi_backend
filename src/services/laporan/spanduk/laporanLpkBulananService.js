const db = require("../../../config/database");

const CABANG_SPANDUK = "P02";
const GUDANG_BAHAN = "WH006";
const DIVISI_SPANDUK = [1, 5];
const KODE_KAIN = "SB%";
const FAKTOR_YARD = 0.9;

// Format kunci periode per grain. Nilai ini disisipkan ke SQL, jadi hanya
// boleh berasal dari peta tetap ini (bukan dari input pengguna).
const FORMAT_PERIODE = { bulan: "%Y-%m", hari: "%Y-%m-%d" };

const TGL = /^\d{4}-\d{2}-\d{2}$/;

const galat = (pesan) => Object.assign(new Error(pesan), { status: 400 });

const cekTanggal = (v, label) => {
  const s = String(v ?? "");
  if (!TGL.test(s) || Number.isNaN(new Date(s).getTime()))
    throw galat(`${label} tidak valid (format YYYY-MM-DD).`);
  return s;
};

const cekGrain = (grain) => {
  if (!Object.prototype.hasOwnProperty.call(FORMAT_PERIODE, grain))
    throw galat("Grain tidak valid (bulan atau hari).");
  return grain;
};

const n = (v) => Number(v) || 0;
const bulatkan = (v) => Math.round((v + Number.EPSILON) * 100) / 100;
const kunci = (periode, spk) => `${periode}|${spk}`;
const gabung = (set) => (set.size ? [...set].join(", ") : "-");

// Hindari "IN ()" yang tidak valid bila daftar kosong.
const ambilJika = async (daftar, jalankan) =>
  daftar.length ? jalankan(daftar) : [];

// ── Sumber data ─────────────────────────────────────────────────────────────
// Semua sumber dijumlah per (periode, SPK) menurut tanggalnya sendiri.

// Ambil = Permintaan Bahan (tanggal permintaan)
const queryPermintaan = async (awal, akhir, fmt) => {
  const [rows] = await db.query(
    `SELECT DATE_FORMAT(h.min_tanggal, '${fmt}') AS periode,
            h.min_spk_nomor AS spk,
            SUM(d.mind_jumlah) AS ambil,
            GROUP_CONCAT(DISTINCT NULLIF(h.min_divisi, '')
                         ORDER BY h.min_divisi SEPARATOR ', ') AS lokasi
     FROM tmintabahan_hdr h
     JOIN tmintabahan_dtl d ON d.mind_nomor = h.min_nomor
     WHERE h.min_cab = ?
       AND h.min_tanggal >= ? AND h.min_tanggal < DATE_ADD(?, INTERVAL 1 DAY)
       AND h.min_spk_nomor <> ''
       AND d.mind_bhn_kode LIKE ?
     GROUP BY periode, spk`,
    [CABANG_SPANDUK, awal, akhir, KODE_KAIN],
  );
  return rows;
};

// Aktual = Realisasi Permintaan Bahan (tanggal realisasi)
const queryRealisasi = async (awal, akhir, fmt) => {
  const [rows] = await db.query(
    `SELECT DATE_FORMAT(h.promin_tanggal, '${fmt}') AS periode,
            h.promin_spk_nomor AS spk,
            SUM(d.promind_Jumlah) AS aktual,
            GROUP_CONCAT(DISTINCT d.promind_bhn_kode) AS kode_bahan
     FROM tproduksiminta_hdr h
     JOIN tproduksiminta_dtl d ON d.promind_promin_Nomor = h.promin_nomor
     WHERE h.promin_aktif = 'Y'
       AND h.promin_gdg_asal = ?
       AND h.promin_tanggal >= ? AND h.promin_tanggal < DATE_ADD(?, INTERVAL 1 DAY)
       AND h.promin_spk_nomor <> ''
       AND d.promind_bhn_kode LIKE ?
     GROUP BY periode, spk`,
    [GUDANG_BAHAN, awal, akhir, KODE_KAIN],
  );
  return rows;
};

// Sisa = Retur Bahan yang sudah di-approve (RETP, tanggal retur)
const queryRetur = async (awal, akhir, fmt) => {
  const [rows] = await db.query(
    `SELECT DATE_FORMAT(h.proret_tanggal, '${fmt}') AS periode,
            COALESCE(NULLIF(d.proretd_spk, ''), NULLIF(h.proret_spk_nomor, ''), '') AS spk,
            SUM(d.proretd_jumlah) AS sisa
     FROM tproduksiretur_hdr h
     JOIN tproduksiretur_dtl d ON d.proretd_proret_nomor = h.proret_nomor
     WHERE h.proret_gdg_tujuan = ?
       AND h.proret_tanggal >= ? AND h.proret_tanggal < DATE_ADD(?, INTERVAL 1 DAY)
       AND d.proretd_bhn_kode LIKE ?
     GROUP BY periode, spk`,
    [GUDANG_BAHAN, awal, akhir, KODE_KAIN],
  );
  return rows;
};

// Hasil cetak (LHK Cetak). Periode 'SEBELUM' = akumulasi sebelum rentang,
// dipakai untuk pembatasan kumulatif sampai jumlah SPK (aturan Delphi "pernah").
const queryCetak = async (awal, akhir, fmt) => {
  const spanduk = `SELECT spk_nomor FROM tspk WHERE spk_divisi IN (?)
                   UNION
                   SELECT MSPK_Nomor FROM tmemospk WHERE mspk_divisi IN (?)`;
  const [rows] = await db.query(
    `SELECT d.lcd_spk_nomor AS spk,
            IF(h.lch_tanggal < ?, 'SEBELUM', DATE_FORMAT(h.lch_tanggal, '${fmt}')) AS periode,
            SUM(d.lcd_qty_cetak) AS qty
     FROM tlhk_cetak_dtl d
     JOIN tlhk_cetak_hdr h ON h.lch_nomor = d.lcd_lch_nomor
     WHERE h.lch_tanggal < DATE_ADD(?, INTERVAL 1 DAY)
       AND d.lcd_spk_nomor IN (
         SELECT d2.lcd_spk_nomor
         FROM tlhk_cetak_dtl d2
         JOIN tlhk_cetak_hdr h2 ON h2.lch_nomor = d2.lcd_lch_nomor
         WHERE h2.lch_tanggal >= ? AND h2.lch_tanggal < DATE_ADD(?, INTERVAL 1 DAY)
       )
       AND d.lcd_spk_nomor IN (${spanduk})
     GROUP BY spk, periode`,
    [awal, akhir, awal, akhir, DIVISI_SPANDUK, DIVISI_SPANDUK],
  );
  return rows;
};

// ── Master pendukung ────────────────────────────────────────────────────────

const querySpk = (daftar) =>
  ambilJika(daftar, async (spk) => {
    const [rows] = await db.query(
      `SELECT spk_nomor AS nomor, spk_nama AS nama, spk_jumlah AS jumlah,
              spk_panjang AS panjang, spk_lebar AS lebar, spk_jo_kode AS jo
       FROM tspk WHERE spk_nomor IN (?)
       UNION ALL
       SELECT MSPK_Nomor, Mspk_nama, Mspk_jumlah, mspk_panjang, mspk_lebar, MSpk_jo_kode
       FROM tmemospk WHERE MSPK_Nomor IN (?)`,
      [spk, spk],
    );
    return rows;
  });

const queryNamaBahan = (kode) =>
  ambilJika(kode, async (daftar) => {
    const [rows] = await db.query(
      `SELECT Bhn_kode AS kode, Bhn_Name AS nama FROM tbahan WHERE Bhn_kode IN (?)`,
      [daftar],
    );
    return rows;
  });

// Supplier = PO bahan terakhir (po_jenis 5 = spanduk, po_close 9 = batal).
const querySupplier = (kode) =>
  ambilJika(kode, async (daftar) => {
    const [rows] = await db.query(
      `SELECT d.pod_bhn_kode AS kode, s.sup_nama AS nama
       FROM tpo_hdr h
       JOIN tpo_dtl d ON d.pod_po_nomor = h.po_nomor
       LEFT JOIN tsupplier s ON s.sup_kode = h.po_sup_kode
       WHERE h.po_jenis = 5 AND h.po_close <> 9 AND d.pod_bhn_kode IN (?)
       ORDER BY h.po_tanggal DESC, h.po_nomor DESC`,
      [daftar],
    );
    return rows;
  });

// Tabel toleransi bisa memuat baris ganda (jenis + ukuran); ambil yang pertama
// menurut id supaya hasilnya deterministik dan baris laporan tidak berlipat.
const queryToleransi = async () => {
  const [rows] = await db.query(
    `SELECT jenis, ukuran, toleransi FROM toleransi ORDER BY id`,
  );
  const peta = new Map();
  for (const r of rows) {
    const k = `${String(r.jenis).toLowerCase()}|${Number(r.ukuran)}`;
    if (!peta.has(k)) peta.set(k, Number(r.toleransi));
  }
  return peta;
};

// ── Hasil cetak: batasi kumulatif sampai jumlah SPK ─────────────────────────
// order(periode) = min(kumulatif s/d periode, jumlahSPK) - min(kumulatif sebelumnya, jumlahSPK)
// Kunci periode (YYYY-MM atau YYYY-MM-DD) terurut leksikografis = kronologis.
const hitungOrder = (cetak, infoSpk) => {
  const perSpk = new Map();
  for (const r of cetak) {
    if (!perSpk.has(r.spk))
      perSpk.set(r.spk, { sebelum: 0, periode: new Map() });
    const e = perSpk.get(r.spk);
    if (r.periode === "SEBELUM") e.sebelum += n(r.qty);
    else e.periode.set(r.periode, (e.periode.get(r.periode) || 0) + n(r.qty));
  }

  const hasil = new Map();
  for (const [spk, e] of perSpk) {
    const info = infoSpk.get(spk);
    const batas = info && Number.isFinite(info.jumlah) ? info.jumlah : Infinity;
    let kumulatif = e.sebelum;
    for (const periode of [...e.periode.keys()].sort()) {
      const qty = e.periode.get(periode);
      const order = Math.max(
        0,
        Math.min(kumulatif + qty, batas) - Math.min(kumulatif, batas),
      );
      hasil.set(kunci(periode, spk), { cetak: qty, order });
      kumulatif += qty;
    }
  }
  return hasil;
};

// ── Laporan ─────────────────────────────────────────────────────────────────
const getData = async ({ tglAwal, tglAkhir, grain = "bulan" }) => {
  const awal = cekTanggal(tglAwal, "Tanggal awal");
  const akhir = cekTanggal(tglAkhir, "Tanggal akhir");
  if (awal > akhir)
    throw galat("Tanggal awal tidak boleh melebihi tanggal akhir.");
  const fmt = FORMAT_PERIODE[cekGrain(grain)];

  const [permintaan, realisasi, retur, cetak, toleransi] = await Promise.all([
    queryPermintaan(awal, akhir, fmt),
    queryRealisasi(awal, akhir, fmt),
    queryRetur(awal, akhir, fmt),
    queryCetak(awal, akhir, fmt),
    queryToleransi(),
  ]);

  // Retur tanpa nomor SPK tidak bisa dipetakan ke baris laporan.
  const returValid = retur.filter((r) => r.spk);
  const returTanpaSpk = retur
    .filter((r) => !r.spk)
    .reduce((t, r) => t + n(r.sisa), 0);

  const daftarSpk = new Set();
  [permintaan, realisasi, returValid, cetak].forEach((src) =>
    src.forEach((r) => daftarSpk.add(r.spk)),
  );

  const kodeBahan = new Set();
  realisasi.forEach((r) =>
    String(r.kode_bahan || "")
      .split(",")
      .filter(Boolean)
      .forEach((k) => kodeBahan.add(k)),
  );

  const [spkRows, bahanRows, supplierRows] = await Promise.all([
    querySpk([...daftarSpk]),
    queryNamaBahan([...kodeBahan]),
    querySupplier([...kodeBahan]),
  ]);

  const infoSpk = new Map(
    spkRows.map((r) => [
      r.nomor,
      {
        nama: r.nama,
        jumlah: r.jumlah == null ? NaN : n(r.jumlah),
        panjang: n(r.panjang),
        lebar: n(r.lebar),
        jo: r.jo,
      },
    ]),
  );
  const namaBahan = new Map(bahanRows.map((r) => [r.kode, r.nama]));
  const supplierBahan = new Map();
  for (const r of supplierRows)
    if (!supplierBahan.has(r.kode)) supplierBahan.set(r.kode, r.nama);

  const orderCetak = hitungOrder(cetak, infoSpk);

  // Gabungkan per (periode, SPK)
  const baris = new Map();
  const ambilBaris = (periode, spk) => {
    const k = kunci(periode, spk);
    if (!baris.has(k))
      baris.set(k, {
        periode,
        spk,
        ambil: 0,
        sisa: 0,
        aktual: 0,
        lokasi: "-",
        kodeBahan: [],
      });
    return baris.get(k);
  };

  permintaan.forEach((r) => {
    const b = ambilBaris(r.periode, r.spk);
    b.ambil += n(r.ambil);
    if (r.lokasi) b.lokasi = r.lokasi;
  });
  realisasi.forEach((r) => {
    const b = ambilBaris(r.periode, r.spk);
    b.aktual += n(r.aktual);
    b.kodeBahan = String(r.kode_bahan || "")
      .split(",")
      .filter(Boolean);
  });
  returValid.forEach((r) => {
    ambilBaris(r.periode, r.spk).sisa += n(r.sisa);
  });
  for (const k of orderCetak.keys()) {
    const [periode, spk] = k.split("|");
    ambilBaris(periode, spk);
  }

  const rows = [...baris.values()]
    .sort(
      (a, b) =>
        a.periode.localeCompare(b.periode) || a.spk.localeCompare(b.spk),
    )
    .map((b) => {
      const info = infoSpk.get(b.spk);
      const panjang = info ? info.panjang : 0;
      const c = orderCetak.get(kunci(b.periode, b.spk)) || {
        cetak: 0,
        order: 0,
      };

      const yardOrder = (c.order * panjang) / FAKTOR_YARD;
      const persenTol = info
        ? toleransi.get(`${String(info.jo).toLowerCase()}|${panjang}`)
        : undefined;
      const yardToleransi = ((persenTol || 0) / 100) * yardOrder;

      const yardPakai = b.aktual - b.sisa;
      const waste = 0; // belum ada pembahasan sumber waste di web
      const loss = yardPakai - yardOrder - yardToleransi;

      const kain = new Set(
        b.kodeBahan.map((k) => namaBahan.get(k)).filter(Boolean),
      );
      const supplier = new Set(
        b.kodeBahan.map((k) => supplierBahan.get(k)).filter(Boolean),
      );

      return {
        periode: b.periode,
        spk: b.spk,
        nama: info?.nama || "-",
        kodeProduk: info?.jo || "-",
        panjang,
        lebar: info ? info.lebar : 0,
        lokasi: b.lokasi,
        kain: gabung(kain),
        supplier: gabung(supplier),
        jmlSpk: info && Number.isFinite(info.jumlah) ? info.jumlah : 0,
        hasilCetak: c.cetak,
        yardCetak: bulatkan((c.cetak * panjang) / FAKTOR_YARD),
        jmlOrder: c.order,
        yardOrder: bulatkan(yardOrder),
        toleransiPersen: persenTol ?? null,
        yardToleransi: bulatkan(yardToleransi),
        ambil: bulatkan(b.ambil),
        sisa: bulatkan(b.sisa),
        aktual: bulatkan(b.aktual),
        yardPakai: bulatkan(yardPakai),
        waste,
        loss: bulatkan(loss),
        persenLoss:
          yardOrder > 0 ? bulatkan(((loss + waste) / yardOrder) * 100) : null,
      };
    });

  return { rows, catatan: { returTanpaSpk: bulatkan(returTanpaSpk) } };
};

module.exports = { getData };
