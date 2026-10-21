const db = require("../../config/database");
const voucherForm = require("./voucherPembayaranFormService");
const { kategoriDari, urutanKategori } = require("./rekapKategori");
const daftarHutang = require("../laporan/finance/daftarHutangService");

const PREFIX_CABANG = "P01";
const NAMA_LOCK = "trekap_bayar_simpan";

const TIPE_VALID = [
  "BPB",
  "BPJ",
  "RET",
  "PJG",
  "POE",
  "MMT",
  "BPE",
  "BPG",
  "POL",
  "PCL",
];
// RET dan PJG adalah pengurang (sama dengan Voucher)
const TIPE_MINUS = ["RET", "PJG"];
// searchNota Voucher memakai kode "RTG" untuk retur
const TIPE_KE_SEARCH = { RET: "RTG" };
// Kode tipe di Daftar Hutang → tipe rekap (POL/PCL tidak ada di sana)
const TIPE_DARI_HUTANG = {
  PBG: "BPB",
  BJG: "BPJ",
  RTG: "RET",
  PJG: "PJG",
  POE: "POE",
  MMT: "MMT",
  BPE: "BPE",
  BPG: "BPG",
};

const SQL_SUPPLIER_NOTA = {
  BPB: "SELECT bpb_sup_kode AS sup FROM tbpb_hdr WHERE bpb_nomor = ?",
  BPJ: "SELECT bpj_sup_kode AS sup FROM tbpj_hdr WHERE bpj_nomor = ?",
  RET: "SELECT ret_sup_kode AS sup FROM tret_hdr WHERE ret_nomor = ?",
  PJG: "SELECT pojh_sup_kode AS sup FROM tpojasa_hdr WHERE pojh_nomor = ?",
  POE: "SELECT poe_sup AS sup FROM tpoexternal_hdr WHERE poe_nomor = ?",
  MMT: "SELECT rec_sup_kode AS sup FROM trec_mmt_hdr WHERE rec_nomor = ?",
  BPE: "SELECT bpe_sup AS sup FROM tbpbpoexternal_hdr WHERE bpe_nomor = ?",
  BPG: "SELECT bpb_sup_kode AS sup FROM tgarmenbpb_hdr WHERE bpb_nomor = ?",
};

const SQL_STATUS_PPN = {
  BPB: `SELECT p.po_status_ppn AS s
        FROM tbpb_hdr b
        INNER JOIN tpo_hdr p ON p.po_nomor = b.bpb_po_nomor
        WHERE b.bpb_nomor = ?`,
  BPJ: `SELECT p.pojh_status_ppn AS s
        FROM tbpj_hdr b
        INNER JOIN tpojasa_hdr p ON p.pojh_nomor = b.bpj_po_nomor
        WHERE b.bpj_nomor = ?`,
  RET: "SELECT ret_sts_ppn AS s FROM tret_hdr WHERE ret_nomor = ?",
  POL: "SELECT po_status_ppn AS s FROM tpo_hdr WHERE po_nomor = ?",
  PCL: "SELECT po_status_ppn AS s FROM tpo_hdr WHERE po_nomor = ?",
};

// ── Helper ────────────────────────────────────────────────────────────
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const fmt = (n) => Number(n).toLocaleString("id-ID");

const isTanggal = (t) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(t || ""))) {
    return false;
  }
  const d = new Date(`${t}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === t;
};

const isBulan = (b) => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(b || ""));

// ── Lookup ────────────────────────────────────────────────────────────
const searchSupplier = (search = "") => voucherForm.searchSupplier(search);

const getSupplier = (kode) => voucherForm.getSupplier(kode);

const searchNota = async (tipe, supKode, search = "") => {
  if (!TIPE_VALID.includes(tipe)) {
    throw new Error("Tipe nota tidak dikenali.");
  }
  if (!supKode) {
    throw new Error("Pilih supplier dahulu.");
  }
  return voucherForm.searchNota(TIPE_KE_SEARCH[tipe] || tipe, supKode, search);
};

// Nilai nota lewat getNotaDetail Voucher (sumber kebenaran saat simpan)
const ambilNota = async (tipe, nota, supKode) => {
  const nomor = String(nota || "").trim();
  if (!nomor) {
    throw new Error("Nomor nota wajib diisi.");
  }
  if (!TIPE_VALID.includes(tipe)) {
    throw new Error(`Tipe nota ${tipe} tidak dikenali.`);
  }

  let statusPpn = 0;
  if (SQL_STATUS_PPN[tipe]) {
    const [[row]] = await db.query(SQL_STATUS_PPN[tipe], [nomor]);
    if (!row) {
      throw new Error(`Nota ${nomor} tidak ditemukan sebagai ${tipe}.`);
    }
    statusPpn = Number(row.s) === 1 ? 1 : 0;
  }

  const info = await voucherForm.getNotaDetail(nomor, statusPpn, tipe, supKode);
  if (info.tipe !== tipe) {
    throw new Error(`Nota ${nomor} bukan bertipe ${tipe}.`);
  }

  if (SQL_SUPPLIER_NOTA[tipe]) {
    const [[row]] = await db.query(SQL_SUPPLIER_NOTA[tipe], [info.nomor]);
    if (!row || String(row.sup || "").trim() !== String(supKode).trim()) {
      throw new Error(`Nota ${info.nomor} bukan milik supplier ${supKode}.`);
    }
  }
  return info;
};

// Rencana pada rekap AKTIF lain untuk nota yang sama
const getRencanaLain = async (tipe, nota, excludeNomor) => {
  const [[row]] = await db.query(
    `SELECT IFNULL(SUM(ABS(d.rkbd_nominal)), 0) AS rencana
     FROM trekap_bayar_dtl d
     INNER JOIN trekap_bayar_hdr h ON h.rkb_nomor = d.rkbd_nomor
     WHERE d.rkbd_tipe = ? AND d.rkbd_nota = ?
        AND h.rkb_status = 'AKTIF' AND d.rkbd_vou_nomor = '' AND h.rkb_nomor <> ?`,
    [tipe, nota, excludeNomor || ""],
  );
  return Number(row.rencana);
};

// Sama, tapi sekali jalan untuk seluruh nota satu supplier
const getRencanaMap = async (supKode, excludeNomor) => {
  const [rows] = await db.query(
    `SELECT d.rkbd_tipe AS tipe, d.rkbd_nota AS nota,
            SUM(ABS(d.rkbd_nominal)) AS rencana
     FROM trekap_bayar_dtl d
     INNER JOIN trekap_bayar_hdr h ON h.rkb_nomor = d.rkbd_nomor
     WHERE d.rkbd_sup_kode = ? AND h.rkb_status = 'AKTIF' AND d.rkbd_vou_nomor = ''
       AND h.rkb_nomor <> ?
     GROUP BY d.rkbd_tipe, d.rkbd_nota`,
    [supKode, excludeNomor || ""],
  );
  return new Map(rows.map((r) => [`${r.tipe}|${r.nota}`, Number(r.rencana)]));
};

const getInfoNota = async (tipe, nota, supKode, excludeNomor = "") => {
  if (!supKode) {
    throw new Error("Pilih supplier dahulu.");
  }
  const info = await ambilNota(tipe, nota, supKode);
  const sisaNota = round2(info.nilai);
  const rencanaLain = round2(
    await getRencanaLain(tipe, info.nomor, excludeNomor),
  );
  return {
    tipe,
    kategori: kategoriDari(tipe),
    nomor: info.nomor,
    tanggal: info.tanggal,
    keterangan: info.keterangan,
    sisaNota,
    rencanaLain,
    tersedia: round2(sisaNota - rencanaLain),
    pengurang: TIPE_MINUS.includes(tipe),
  };
};

// ── Tarik Tagihan: semua nota outstanding satu supplier ───────────────
// Angka mengikuti layar Daftar Hutang (getBrowse) supaya sama persis.
// Hanya untuk dipilih user; saat simpan server tetap validasi ulang (ambilNota).
const getTagihan = async (supKode, startDate, endDate, excludeNomor = "") => {
  const sup = String(supKode || "").trim();
  if (!sup) {
    throw new Error("Pilih supplier dahulu.");
  }
  if (!isTanggal(startDate) || !isTanggal(endDate)) {
    throw new Error("Rentang tanggal nota tidak valid.");
  }
  if (startDate > endDate) {
    throw new Error("Tanggal awal tidak boleh melebihi tanggal akhir.");
  }
  await voucherForm.getSupplier(sup);

  const [hutang, [poLainRows], rencana] = await Promise.all([
    daftarHutang.getBrowse(startDate, endDate),
    db.query(
      `SELECT h.bpb_nomor AS nomor
       FROM tbpb_hdr h
       INNER JOIN tpo_hdr p ON p.po_nomor = h.bpb_po_nomor
       WHERE p.po_jenis = 4 AND h.bpb_sup_kode = ?
         AND h.bpb_tanggal >= ? AND h.bpb_tanggal <= ?`,
      [sup, startDate, endDate],
    ),
    getRencanaMap(sup, excludeNomor),
  ]);
  // BPB milik PO Lain-lain dibayar per PO (tipe POL), bukan per BPB
  const bpbPoLain = new Set(poLainRows.map((r) => r.nomor));

  const hasil = [];
  const tambah = (tipe, nota, tanggal, jatuhTempo, sisaNota) => {
    const lain = round2(rencana.get(`${tipe}|${nota}`) || 0);
    const tersedia = round2(sisaNota - lain);
    if (tersedia <= 0.005) {
      return;
    }
    hasil.push({
      tipe,
      kategori: kategoriDari(tipe),
      kategoriUrut: urutanKategori(tipe),
      nota,
      tanggal,
      jatuhTempo: jatuhTempo || null,
      sisaNota,
      rencanaLain: lain,
      tersedia,
    });
  };

  for (const r of hutang) {
    if (String(r.SupKode || "").trim() !== sup) {
      continue;
    }
    const tipe = TIPE_DARI_HUTANG[r.Tipe];
    if (!tipe || (tipe === "BPB" && bpbPoLain.has(r.Nomor))) {
      continue;
    }
    const sisa = round2(Number(r.Total) - Number(r.Voucher));
    if (sisa > 0.005) {
      tambah(tipe, r.Nomor, r.Tanggal, r.JatuhTempo, sisa);
    }
  }

  // PO Lain-lain dan PO Celup dibayar di tingkat PO
  for (const tipe of ["POL", "PCL"]) {
    const daftar = await voucherForm.searchNota(tipe, sup, "");
    for (const n of daftar) {
      try {
        const info = await ambilNota(tipe, n.Nomor, sup);
        if (info.tanggal >= startDate && info.tanggal <= endDate) {
          tambah(tipe, info.nomor, info.tanggal, null, round2(info.nilai));
        }
      } catch (e) {
        // PO yang tidak bisa dibayar lewat rekap dilewati
      }
    }
  }

  hasil.sort(
    (a, b) =>
      urutanKategori(a.tipe) - urutanKategori(b.tipe) ||
      String(a.tanggal).localeCompare(String(b.tanggal)) ||
      String(a.nota).localeCompare(String(b.nota)),
  );
  return hasil;
};

// ── Ambil satu (edit + print) ─────────────────────────────────────────
const getById = async (nomor) => {
  const [[h]] = await db.query(
    `SELECT h.rkb_nomor AS nomor,
            DATE_FORMAT(h.rkb_tanggal, '%Y-%m-%d') AS tanggal,
            h.rkb_keterangan AS keterangan,
            h.rkb_status AS status,
            h.rkb_alasan_batal AS alasanBatal,
            h.user_create AS userCreate
     FROM trekap_bayar_hdr h
     WHERE h.rkb_nomor = ?`,
    [nomor],
  );
  if (!h) {
    throw new Error("Rekap pembayaran tidak ditemukan.");
  }
  const [rows] = await db.query(
    `SELECT d.rkbd_nourut AS noUrut,
            d.rkbd_sup_kode AS supKode,
            IFNULL(s.sup_nama, '') AS supNama,
            d.rkbd_bulan_tagihan AS bulanTagihan,
            d.rkbd_tipe AS tipe,
            d.rkbd_nota AS nota,
            DATE_FORMAT(d.rkbd_tgl_nota, '%Y-%m-%d') AS tglNota,
            d.rkbd_nilai_nota AS nilaiNota,
            d.rkbd_nominal AS nominal,
            DATE_FORMAT(d.rkbd_tgl_rencana, '%Y-%m-%d') AS tglRencana,
            d.rkbd_faktur_pajak AS fakturPajak,
            d.rkbd_invoice AS invoice,
            d.rkbd_keterangan AS keterangan,
            d.rkbd_vou_nomor AS vouNomor
     FROM trekap_bayar_dtl d
     LEFT JOIN tsupplier s ON s.sup_kode = d.rkbd_sup_kode
     WHERE d.rkbd_nomor = ?
     ORDER BY d.rkbd_nourut`,
    [nomor],
  );
  const detail = rows.map((r) => ({
    ...r,
    nilaiNota: Number(r.nilaiNota),
    nominal: Number(r.nominal),
    kategori: kategoriDari(r.tipe),
    kategoriUrut: urutanKategori(r.tipe),
  }));
  return {
    ...h,
    bisaUbah: h.status === "AKTIF",
    total: round2(detail.reduce((s, d) => s + d.nominal, 0)),
    jumlahSupplier: new Set(detail.map((d) => d.supKode)).size,
    detail,
  };
};

// ── Nomor: P01-RKP.{tahun}.{5 digit}, dipanggil di dalam lock ─────────
const generateNomor = async (conn, tahun) => {
  const prefix = `${PREFIX_CABANG}-RKP.${tahun}.`;
  const [[row]] = await conn.query(
    `SELECT IFNULL(MAX(CAST(SUBSTRING(rkb_nomor, ?) AS UNSIGNED)), 0) AS mx
     FROM trekap_bayar_hdr
     WHERE rkb_nomor LIKE ?`,
    [prefix.length + 1, `${prefix}%`],
  );
  return `${prefix}${String(Number(row.mx) + 1).padStart(5, "0")}`;
};

// ── Validasi + normalisasi isi rekap ──────────────────────────────────
const siapkanData = async (payload, nomorEdit, bolehKosong = false) => {
  const { tanggal, keterangan, detail } = payload;

  if (!isTanggal(tanggal)) {
    throw new Error("Tanggal rekap tidak valid.");
  }
  const ket = String(keterangan || "").trim();
  if (ket.length > 200) {
    throw new Error("Keterangan maksimal 200 karakter.");
  }
  if (!Array.isArray(detail)) {
    throw new Error("Detail transaksi tidak valid.");
  }

  const supValid = new Set();
  const infoCache = new Map();
  const baris = [];

  for (let i = 0; i < detail.length; i++) {
    const d = detail[i] || {};
    const no = i + 1;
    const supKode = String(d.supKode || "").trim();
    const tipe = String(d.tipe || "")
      .trim()
      .toUpperCase();
    const nota = String(d.nota || "").trim();
    if (!supKode && !tipe && !nota) {
      continue; // baris kosong dilewati
    }
    if (!supKode || !tipe || !nota) {
      throw new Error(`Baris ${no}: supplier, tipe, dan nota harus diisi.`);
    }
    if (!supValid.has(supKode)) {
      try {
        await voucherForm.getSupplier(supKode);
      } catch (e) {
        throw new Error(`Baris ${no}: supplier ${supKode} tidak ditemukan.`);
      }
      supValid.add(supKode);
    }
    if (!isBulan(d.bulanTagihan)) {
      throw new Error(`Baris ${no}: bulan tagihan tidak valid (YYYY-MM).`);
    }

    const nominal = round2(Math.abs(Number(d.nominal)));
    if (!(nominal > 0)) {
      throw new Error(`Baris ${no}: nominal harus lebih dari 0.`);
    }
    const tglRencana = d.tglRencana ? String(d.tglRencana) : null;
    if (tglRencana && !isTanggal(tglRencana)) {
      throw new Error(`Baris ${no}: tanggal rencana pembayaran tidak valid.`);
    }
    const faktur = String(d.fakturPajak || "").trim();
    const invoice = String(d.invoice || "").trim();
    const ketBaris = String(d.keterangan || "").trim();
    if (faktur.length > 30) {
      throw new Error(`Baris ${no}: faktur pajak maksimal 30 karakter.`);
    }
    if (invoice.length > 50) {
      throw new Error(`Baris ${no}: invoice maksimal 50 karakter.`);
    }
    if (ketBaris.length > 200) {
      throw new Error(`Baris ${no}: keterangan maksimal 200 karakter.`);
    }

    const cacheKey = `${tipe}|${nota.toUpperCase()}|${supKode}`;
    let info = infoCache.get(cacheKey);
    if (!info) {
      try {
        info = await getInfoNota(tipe, nota, supKode, nomorEdit || "");
      } catch (e) {
        throw new Error(`Baris ${no}: ${e.message}`);
      }
      infoCache.set(cacheKey, info);
    }

    baris.push({
      supKode,
      bulanTagihan: String(d.bulanTagihan),
      tipe,
      info,
      nominal,
      tglRencana,
      faktur,
      invoice,
      ketBaris,
    });
  }

  if (!baris.length && !bolehKosong) {
    throw new Error("Minimal satu transaksi harus diisi.");
  }

  // Total per nota (nota yang sama boleh muncul lebih dari sekali, mis. cicilan)
  const totalPerNota = new Map();
  for (const b of baris) {
    const key = `${b.tipe}|${b.info.nomor}`;
    const cur = totalPerNota.get(key) || { total: 0, info: b.info };
    cur.total += b.nominal;
    totalPerNota.set(key, cur);
  }
  for (const { total, info } of totalPerNota.values()) {
    if (info.tersedia <= 0.005) {
      throw new Error(
        `Nota ${info.nomor} sudah terbayar atau sudah direncanakan seluruhnya di rekap lain.`,
      );
    }
    if (round2(total) > info.tersedia + 0.005) {
      throw new Error(
        `Nota ${info.nomor}: total rencana ${fmt(round2(total))} melebihi sisa yang tersedia ${fmt(info.tersedia)}.`,
      );
    }
  }

  return { ket, baris };
};

// Peringatan (tidak menolak simpan): faktur yang sama dipakai supplier berbeda
const cariPeringatan = async (baris, nomorEdit) => {
  const peringatan = [];

  // Dalam rekap ini sendiri
  const perFaktur = new Map();
  for (const b of baris) {
    if (!b.faktur) {
      continue;
    }
    const set = perFaktur.get(b.faktur) || new Set();
    set.add(b.supKode);
    perFaktur.set(b.faktur, set);
  }
  for (const [f, sups] of perFaktur) {
    if (sups.size > 1) {
      peringatan.push(
        `Faktur pajak ${f} dipakai lebih dari satu supplier di rekap ini.`,
      );
    }
  }

  // Terhadap rekap AKTIF lain
  const pasang = [
    ...new Set(
      baris.filter((b) => b.faktur).map((b) => `${b.faktur}|${b.supKode}`),
    ),
  ];
  for (const p of pasang) {
    const [f, sup] = p.split("|");
    const [rows] = await db.query(
      `SELECT DISTINCT h.rkb_nomor AS nomor
       FROM trekap_bayar_dtl d
       INNER JOIN trekap_bayar_hdr h ON h.rkb_nomor = d.rkbd_nomor
       WHERE d.rkbd_faktur_pajak = ? AND h.rkb_status = 'AKTIF'
         AND d.rkbd_sup_kode <> ? AND h.rkb_nomor <> ?`,
      [f, sup, nomorEdit || ""],
    );
    if (rows.length) {
      peringatan.push(
        `Faktur pajak ${f} juga dipakai supplier lain di ${rows.map((r) => r.nomor).join(", ")}.`,
      );
    }
  }
  return peringatan;
};

// ── Simpan (baru bila nomorEdit kosong) ───────────────────────────────
// Satu named lock untuk baru + ubah: mencegah dua pengguna sama-sama lolos
// batas sisa nota dan mencegah nomor kembar.
const save = async (payload, userKode, nomorEdit = "") => {
  const conn = await db.getConnection();
  let lockDiambil = false;
  let transaksiMulai = false;
  try {
    const [[lk]] = await conn.query(`SELECT GET_LOCK(?, 10) AS ok`, [
      NAMA_LOCK,
    ]);
    if (Number(lk.ok) !== 1) {
      throw new Error("Sedang ada penyimpanan rekap lain, coba lagi sebentar.");
    }
    lockDiambil = true;

    let adaTerkunci = false;

    if (nomorEdit) {
      const [[cur]] = await conn.query(
        `SELECT rkb_status FROM trekap_bayar_hdr WHERE rkb_nomor = ?`,
        [nomorEdit],
      );
      if (!cur) {
        throw new Error("Rekap pembayaran tidak ditemukan.");
      }
      if (cur.rkb_status !== "AKTIF") {
        throw new Error("Rekap yang sudah dibatalkan tidak dapat diubah.");
      }
      const [[k]] = await conn.query(
        `SELECT COUNT(*) AS n FROM trekap_bayar_dtl
         WHERE rkbd_nomor = ? AND rkbd_vou_nomor <> ''`,
        [nomorEdit],
      );
      adaTerkunci = Number(k.n) > 0;
    }

    const { ket, baris } = await siapkanData(payload, nomorEdit, adaTerkunci);
    const peringatan = await cariPeringatan(baris, nomorEdit);

    await conn.beginTransaction();
    transaksiMulai = true;

    let nomor = nomorEdit;
    if (nomorEdit) {
      await conn.query(
        `UPDATE trekap_bayar_hdr
         SET rkb_tanggal = ?, rkb_keterangan = ?,
             user_modified = ?, date_modified = NOW()
         WHERE rkb_nomor = ?`,
        [payload.tanggal, ket, userKode, nomorEdit],
      );
      await conn.query(
        `DELETE FROM trekap_bayar_dtl WHERE rkbd_nomor = ? AND rkbd_vou_nomor = ''`,
        [nomorEdit],
      );
    } else {
      nomor = await generateNomor(conn, payload.tanggal.substring(0, 4));
      await conn.query(
        `INSERT INTO trekap_bayar_hdr
           (rkb_nomor, rkb_tanggal, rkb_keterangan, rkb_status,
            user_create, date_create)
         VALUES (?, ?, ?, 'AKTIF', ?, NOW())`,
        [nomor, payload.tanggal, ket, userKode],
      );
    }

    let urut = 0;
    if (nomorEdit) {
      const [[mx]] = await conn.query(
        `SELECT IFNULL(MAX(rkbd_nourut), 0) AS mx
         FROM trekap_bayar_dtl WHERE rkbd_nomor = ?`,
        [nomorEdit],
      );
      urut = Number(mx.mx);
    }
    for (const b of baris) {
      urut++;
      await conn.query(
        `INSERT INTO trekap_bayar_dtl
           (rkbd_nomor, rkbd_nourut, rkbd_sup_kode, rkbd_bulan_tagihan,
            rkbd_tipe, rkbd_nota, rkbd_tgl_nota, rkbd_nilai_nota,
            rkbd_nominal, rkbd_tgl_rencana, rkbd_faktur_pajak,
            rkbd_invoice, rkbd_keterangan)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          nomor,
          urut,
          b.supKode,
          b.bulanTagihan,
          b.tipe,
          b.info.nomor,
          b.info.tanggal || null,
          b.info.sisaNota,
          TIPE_MINUS.includes(b.tipe) ? -b.nominal : b.nominal,
          b.tglRencana,
          b.faktur,
          b.invoice,
          b.ketBaris,
        ],
      );
    }

    await conn.commit();
    return { nomor, peringatan };
  } catch (e) {
    if (transaksiMulai) {
      await conn.rollback();
    }
    throw e;
  } finally {
    if (lockDiambil) {
      try {
        await conn.query(`SELECT RELEASE_LOCK(?)`, [NAMA_LOCK]);
      } catch (err) {
        // lock otomatis lepas saat koneksi ditutup
      }
    }
    conn.release();
  }
};

module.exports = {
  searchSupplier,
  getSupplier,
  searchNota,
  getInfoNota,
  getTagihan,
  getById,
  save,
};
