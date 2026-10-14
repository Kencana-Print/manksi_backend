const db = require("../../../config/database");

// Tabel master Spanduk ada di skema kencanaprint. Nama huruf kecil sesuai
// information_schema (Delphi: tbarang_NEW — tabel yang sama).
const T = {
  barang: "kencanaprint.tbarang_new",
  stokNew: "kencanaprint.tmasterstok_new",
  stokPenolong: "kencanaprint.tmasterstok_penolong",
  kategori: "kencanaprint.tkategori",
  jenis: "kencanaprint.tjenisbarang",
  supplier: "kencanaprint.tsupplier",
  gudang: "kencanaprint.tgudang",
  divisi: "kencanaprint.tdivisi",
};

const DIVISI_SPANDUK = 1;
const DIVISI_MMT = 5;
const DIVISI_BOLEH = [DIVISI_SPANDUK, DIVISI_MMT];
// Kategori yang dipakai di data: 1 = BAHAN BAKU UTAMA, 2 = BAHAN PENOLONG, 3 = OBAT & TINTA.
// Stok kategori 1 dibaca dari tmasterstok_new, kategori lain dari tmasterstok_penolong (sama dengan browse Delphi).
const KTG_BAHAN_UTAMA = 1;
const KATEGORI_BOLEH = [1, 2, 3];
const STATUS_BOLEH = ["F", "S", "P", "B"];
const STATUS_DEFAULT = "S"; // Delphi: RadioGroupStatus default index 1
const STATUS_LABEL = {
  F: "F - FAST MOVING",
  S: "S - SLOW MOVING",
  P: "P - SAMPLE",
  B: "B - BATIK",
};

const teks = (v) => String(v ?? "").trim();
const flag = (v) => (v === true || Number(v) === 1 ? 1 : 0);
// Delphi membuang koma pemisah ribuan sebelum disimpan
const angka = (v) => {
  const n = Number(String(v ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
};
const kodeValid = (kode) => {
  const n = Number(kode);
  if (!Number.isInteger(n) || n <= 0) throw new Error("Kode tidak valid.");
  return n;
};

// ── BROWSE ── (port btnRefreshClick ufrmBrowseBarang_spanduk)
const getBrowseMasterBahan = async () => {
  const [rows] = await db.query(
    `SELECT
       g.gdg_nama AS Gudang,
       z.divisi AS Divisi,
       k.ktg_nama AS Kategori,
       b.brg_kode AS Kode,
       b.brg_nama AS Nama,
       j.jb_nama AS Jenis,
       s.sup_nama AS Supplier,
       b.brg_gramasi AS Konstruksi,
       b.brg_panjang AS Panjang,
       b.brg_lebar AS Lebar,
       b.brg_satuan AS Satuan,
       CONCAT(
         CASE b.brg_status
           WHEN 'F' THEN 'FM'
           WHEN 'S' THEN 'SM'
           WHEN 'P' THEN 'SA'
           WHEN 'B' THEN 'BA'
           ELSE b.brg_status
         END,
         ROUND(b.brg_lebar * 100)
       ) AS Status,
       IF(b.brg_ktg_kode = ${KTG_BAHAN_UTAMA}, IFNULL(x.stock_1, 0), IFNULL(y.stock_2, 0)) AS Stok
     FROM ${T.barang} b
     LEFT JOIN (
       SELECT mst_brg_kode, SUM(IFNULL(mst_stok_in, 0) - IFNULL(mst_stok_out, 0)) AS stock_1
       FROM ${T.stokNew} GROUP BY mst_brg_kode
     ) x ON x.mst_brg_kode = b.brg_kode
     LEFT JOIN (
       SELECT mst_brg_kode, SUM(IFNULL(mst_stok_in, 0) - IFNULL(mst_stok_out, 0)) AS stock_2
       FROM ${T.stokPenolong} GROUP BY mst_brg_kode
     ) y ON y.mst_brg_kode = b.brg_kode
     LEFT JOIN ${T.kategori} k ON k.ktg_kode = b.brg_ktg_kode
     LEFT JOIN ${T.jenis} j ON j.jb_kode = b.brg_jenis
     LEFT JOIN ${T.supplier} s ON s.sup_kode = b.brg_sup_kode
     LEFT JOIN ${T.gudang} g ON g.gdg_kode = b.brg_gdg_default
     LEFT JOIN ${T.divisi} z ON z.kode = b.brg_divisi
     WHERE b.brg_divisi IN (?)
     ORDER BY b.brg_kode`,
    [DIVISI_BOLEH],
  );
  return rows;
};

// ── DETAIL ── (port loaddata ufrmBarang_spanduk)
const getMasterBahanById = async (kode) => {
  const [rows] = await db.query(
    `SELECT
       b.brg_kode AS Brg_kode,
       b.brg_nama AS Brg_nama,
       b.brg_satuan AS Brg_satuan,
       b.brg_gramasi AS Brg_gramasi,
       b.brg_panjang AS Brg_panjang,
       b.brg_lebar AS Brg_lebar,
       b.brg_jenis AS Brg_jenis,
       IFNULL(j.jb_nama, '') AS nmJenis,
       b.brg_ktg_kode AS Brg_ktg_kode,
       IFNULL(k.ktg_nama, '') AS nmKategori,
       b.brg_gdg_default AS Brg_gdg_default,
       IFNULL(g.gdg_nama, '') AS nmGudang,
       b.brg_sup_kode AS Brg_sup_kode,
       IFNULL(s.sup_nama, '') AS nmSupplier,
       b.brg_divisi AS Brg_divisi,
       IFNULL(z.divisi, '') AS nmDivisi,
       b.brg_hrgbeli AS Brg_hrgbeli,
       b.brg_hrgjual AS Brg_hrgjual,
       b.brg_isaktif AS Brg_isaktif,
       b.brg_isstok AS Brg_isstok,
       b.brg_isexpired AS Brg_isexpired,
       b.brg_status AS Brg_status
     FROM ${T.barang} b
     LEFT JOIN ${T.jenis} j ON j.jb_kode = b.brg_jenis
     LEFT JOIN ${T.kategori} k ON k.ktg_kode = b.brg_ktg_kode
     LEFT JOIN ${T.gudang} g ON g.gdg_kode = b.brg_gdg_default
     LEFT JOIN ${T.supplier} s ON s.sup_kode = b.brg_sup_kode
     LEFT JOIN ${T.divisi} z ON z.kode = b.brg_divisi
     WHERE b.brg_kode = ? AND b.brg_divisi IN (?)`,
    [kodeValid(kode), DIVISI_BOLEH],
  );
  return rows[0];
};

// ── Validasi & normalisasi payload simpan ──
const siapkanData = (data) => {
  const nama = teks(data.Brg_nama).toUpperCase();
  if (!nama) throw new Error("Nama barang wajib diisi.");

  const divisi = Number(data.Brg_divisi);
  if (!DIVISI_BOLEH.includes(divisi))
    throw new Error("Divisi harus Spanduk (1) atau MMT (5).");

  const ktg = Number(teks(data.Brg_ktg_kode));
  if (!KATEGORI_BOLEH.includes(ktg))
    throw new Error(
      "Kategori harus Bahan Baku Utama, Bahan Penolong, atau Obat & Tinta.",
    );
  const kategori = String(ktg);

  const status = (teks(data.Brg_status) || STATUS_DEFAULT).toUpperCase();
  if (!STATUS_BOLEH.includes(status)) throw new Error("Status tidak valid.");

  const panjang = teks(data.Brg_panjang);
  const lebar = teks(data.Brg_lebar);
  for (const [label, v] of [
    ["Panjang", panjang],
    ["Lebar", lebar],
  ]) {
    if (v !== "" && !/^\d+(\.\d+)?$/.test(v))
      throw new Error(`${label} harus berupa angka (desimal pakai titik).`);
  }

  return {
    nama,
    satuan: teks(data.Brg_satuan),
    gramasi: teks(data.Brg_gramasi),
    panjang,
    lebar,
    jenis: teks(data.Brg_jenis),
    kategori,
    gudang: teks(data.Brg_gdg_default),
    supplier: teks(data.Brg_sup_kode),
    hrgBeli: angka(data.Brg_hrgbeli),
    hrgJual: angka(data.Brg_hrgjual),
    isAktif: flag(data.Brg_isaktif),
    isStok: flag(data.Brg_isstok),
    isExpired: flag(data.Brg_isexpired),
    divisi,
    status,
  };
};

// Delphi getmaxkode: MAX(brg_kode)+1 (seluruh tabel), 10001 kalau kosong
const getNextKode = async () => {
  const [[row]] = await db.query(
    `SELECT IFNULL(MAX(brg_kode), 10000) + 1 AS next FROM ${T.barang}`,
  );
  return Number(row.next);
};

// ── CREATE ──
const createMasterBahan = async (data, user) => {
  const d = siapkanData(data);
  const manual = data.Brg_kode ? kodeValid(data.Brg_kode) : null;

  // brg_kode adalah PRIMARY KEY, jadi dua user yang menyimpan bersamaan
  // tidak akan menghasilkan kode ganda — yang kalah ditangkap dan diulang.
  for (let percobaan = 0; percobaan < 3; percobaan++) {
    const kode = manual ?? (await getNextKode());
    try {
      await db.query(
        `INSERT INTO ${T.barang}
           (brg_kode, brg_nama, brg_satuan, brg_gr_kode, brg_gramasi,
            brg_panjang, brg_lebar, brg_ktg_kode, brg_gdg_default, brg_sup_kode,
            brg_hrgjual, brg_hrgbeli, brg_isaktif, brg_isstok, brg_isexpired,
            date_create, user_create, brg_status, brg_jenis, brg_divisi)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?, ?, ?)`,
        [
          kode,
          d.nama,
          d.satuan,
          Number(d.kategori), // Delphi mengisi brg_gr_kode dengan kode kategori
          d.gramasi,
          d.panjang,
          d.lebar,
          d.kategori,
          d.gudang,
          d.supplier,
          d.hrgJual,
          d.hrgBeli,
          d.isAktif,
          d.isStok,
          d.isExpired,
          user,
          d.status,
          d.jenis,
          d.divisi,
        ],
      );
      return kode;
    } catch (e) {
      if (e.code !== "ER_DUP_ENTRY") throw e;
      if (manual != null) throw new Error(`Kode ${kode} sudah dipakai.`);
      if (percobaan === 2)
        throw new Error("Gagal membuat kode baru, silakan coba lagi.");
    }
  }
};

// ── UPDATE ──
const pastikanAda = async (kode) => {
  const [rows] = await db.query(
    `SELECT brg_kode FROM ${T.barang} WHERE brg_kode = ? AND brg_divisi IN (?)`,
    [kode, DIVISI_BOLEH],
  );
  if (!rows.length) throw new Error("Data tidak ditemukan.");
};

const updateMasterBahan = async (kode, data, user) => {
  const id = kodeValid(kode);
  const d = siapkanData(data);
  await pastikanAda(id);

  await db.query(
    `UPDATE ${T.barang} SET
       brg_nama = ?, brg_jenis = ?, brg_gr_kode = ?, brg_satuan = ?,
       brg_gramasi = ?, brg_panjang = ?, brg_lebar = ?, brg_ktg_kode = ?,
       brg_gdg_default = ?, brg_sup_kode = ?, brg_hrgjual = ?, brg_hrgbeli = ?,
       brg_isaktif = ?, brg_isstok = ?, brg_divisi = ?, brg_isexpired = ?,
       brg_status = ?, date_modified = NOW(), user_modified = ?
     WHERE brg_kode = ?`,
    [
      d.nama,
      d.jenis,
      Number(d.kategori),
      d.satuan,
      d.gramasi,
      d.panjang,
      d.lebar,
      d.kategori,
      d.gudang,
      d.supplier,
      d.hrgJual,
      d.hrgBeli,
      d.isAktif,
      d.isStok,
      d.divisi,
      d.isExpired,
      d.status,
      user,
      id,
    ],
  );
};

// ── DELETE ──
// Delphi: hard delete tanpa cek apapun. Di web diblokir kalau barang sudah
// dipakai di tabel transaksi di bawah. Tabel modul yang belum dimigrasi
// (SO, SPK, LHK spanduk, dll) ditambahkan ke daftar ini saat modulnya dibuat.
const TABEL_PEMAKAI_BARANG = [
  ["tmasterstok_new", "mst_brg_kode"],
  ["tmasterstok_penolong", "mst_brg_kode"],
  ["tmasterstok_mmt", "mst_brg_kode"],
  ["tkor_dtl_spanduk", "KORD_BRG_KODE"],
  ["tkor_dtl_mmt", "KORD_BRG_KODE"],
  ["tkor_bsdtl_mmt", "KORD_BRG_KODE"],
  ["tmutasi_dtl_spanduk", "mutd_brg_kode"],
  ["tmutasi_dtl_mmt", "mutd_brg_kode"],
  ["tret_dtl_spanduk", "retd_brg_kode"],
  ["tret_dtl_mmt", "retd_brg_kode"],
  ["tlhk_cetakmmt_dtl", "lcd_brg_kode"],
  ["tlhk_cetakmmt_dtl_bahan", "lcb_brg_kode"],
  ["tlhk_tekstilmmt_dtl", "ltd_brg_kode"],
  ["tlhk_tekstilmmt_hdr", "lth_brg_kode"],
  ["tlhk_mesintekstil_dtl", "ltd_brg_kode"],
  ["tlhk_mesintekstil_hdr", "lth_brg_kode"],
  ["tlhk_sublim_hdr", "lsb_brg_kode"],
  ["tpo_mmt_dtl", "pod_brg_kode"],
  ["trec_mmt_dtl", "recd_brg_kode"],
  ["tminta_mmt_dtl", "mntd_brg_kode"],
  ["tmintabahan_mmt_dtl", "mbd_brg_kode"],
  ["treturminta_mmt_dtl", "rmntd_brg_kode"],
  ["tpengajuan_permintaan_dtl", "ppd_brg_kode"],
  ["tpermintaan_prod_dtl", "mntd_brg_kode"],
  ["tlhk_tinta_dtl2", "lnd2_brg_kode"],
];

const deleteMasterBahan = async (kode) => {
  const id = kodeValid(kode);
  await pastikanAda(id);

  const sql = TABEL_PEMAKAI_BARANG.map(
    ([tabel, kolom]) =>
      `(SELECT '${tabel}' AS tabel FROM kencanaprint.${tabel} WHERE ${kolom} = ? LIMIT 1)`,
  ).join(" UNION ALL ");
  const [dipakai] = await db.query(
    sql,
    TABEL_PEMAKAI_BARANG.map(() => id),
  );

  if (dipakai.length > 0)
    throw new Error(
      `Barang ${id} tidak bisa dihapus karena sudah dipakai di transaksi (${dipakai
        .map((r) => r.tabel)
        .join(", ")}). Nonaktifkan saja lewat centang Aktif.`,
    );

  await db.query(`DELETE FROM ${T.barang} WHERE brg_kode = ?`, [id]);
};

// ── LOOKUPS ── (sumber: picker di ufrmBarang_spanduk)
const getLookups = async (category, search = "") => {
  switch (category) {
    case "kategori": {
      const [rows] = await db.query(
        `SELECT ktg_kode AS Kode, ktg_nama AS Nama FROM ${T.kategori}
         WHERE ktg_kode IN ('1','2','3') ORDER BY ktg_kode`,
      );
      return rows;
    }
    case "gudang": {
      const [rows] = await db.query(
        `SELECT gdg_kode AS Kode, gdg_nama AS Nama FROM ${T.gudang}
         WHERE gdg_kode LIKE 'WH-%' ORDER BY gdg_kode`,
      );
      return rows;
    }
    case "jenis": {
      const [rows] = await db.query(
        `SELECT jb_kode AS Kode, jb_nama AS Nama FROM ${T.jenis} ORDER BY jb_nama`,
      );
      return rows;
    }
    case "supplier": {
      const like = `%${teks(search)}%`;
      const [rows] = await db.query(
        `SELECT sup_kode AS Kode, sup_nama AS Nama FROM ${T.supplier}
         WHERE sup_nama LIKE ? OR sup_kode LIKE ?
         ORDER BY sup_nama LIMIT 50`,
        [like, like],
      );
      return rows;
    }
    case "divisi": {
      const [rows] = await db.query(
        `SELECT kode AS Kode, divisi AS Nama FROM ${T.divisi}
         WHERE kode IN (?) ORDER BY kode`,
        [DIVISI_BOLEH],
      );
      return rows;
    }
    case "status":
      return STATUS_BOLEH.map((k) => ({ Kode: k, Nama: STATUS_LABEL[k] }));
    default:
      return [];
  }
};

module.exports = {
  getBrowseMasterBahan,
  getMasterBahanById,
  createMasterBahan,
  updateMasterBahan,
  deleteMasterBahan,
  getLookups,
};
