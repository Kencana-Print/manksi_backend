const db = require("../../../config/database");

// Jenis (tgarmen_brg.brg_jenis) -> tabel stok. [KONFIRMASI] PRD #304
const TABEL_STOK = {
  ACCESORIES: "tmasterstok_acc",
  OBAT: "tmasterstok_obat",
  SPAREPART: "tmasterstok_sparepart",
  "ATK/RTK": "tmasterstok_atk",
  ASET: "tmasterstok_aset",
};

// Awalan nomor referensi -> keterangan (urutan: yang lebih spesifik dulu). PRD #308
const KETERANGAN_REFERENSI = [
  ["AWAL", "Saldo Awal"],
  ["APVS", "Approve Realisasi Sparepart"],
  ["SJ-M", "SJ Maklon Keluar"],
  ["TRM-", "Terima SJ Maklon"],
  ["LHK-", "LHK Pemakaian"],
  ["KOR", "Koreksi"],
  ["KR", "Koreksi"],
  ["PB", "Pembelian (BPB)"],
  ["RE", "Realisasi Permintaan"],
  ["RT", "Retur"],
  ["RB", "Retur Barang"],
  ["MSI", "Mutasi In"],
  ["MSO", "Mutasi Out"],
];

const galat = (pesan, status = 400) =>
  Object.assign(new Error(pesan), { status });

const bulat = (n) => Math.round((Number(n) || 0) * 100) / 100;

// hasOwnProperty: jenis "constructor" dkk tidak boleh lolos sebagai nama tabel
const tabelStok = (jenis) => {
  if (!Object.prototype.hasOwnProperty.call(TABEL_STOK, jenis)) {
    throw galat("Jenis barang tidak valid");
  }
  return TABEL_STOK[jenis];
};

const cekPeriode = (tglAwal, tglAkhir) => {
  const re = /^\d{4}-\d{2}-\d{2}$/;
  if (!re.test(tglAwal || "") || !re.test(tglAkhir || "")) {
    throw galat("Periode tidak valid (format YYYY-MM-DD)");
  }
  if (tglAwal > tglAkhir) {
    throw galat("Tanggal awal tidak boleh melebihi tanggal akhir");
  }
};

const keteranganReferensi = (nomor) => {
  const ref = String(nomor || "").toUpperCase();
  const cocok = KETERANGAN_REFERENSI.find(([awalan]) => ref.startsWith(awalan));
  return cocok ? cocok[1] : `Lainnya (${ref.slice(0, 4)})`;
};

const TANPA_MASTER = "(tidak ada di master jenis ini)";
// Baris tanpa cabang (mis. KOR. lama) selalu diabaikan, juga untuk hak "semua cabang"
const filterCabang = (cabang) =>
  cabang ? "AND m.mst_cab = ?" : "AND m.mst_cab <> ''";

const getCabang = async ({ jenis }) => {
  const [rows] = await db.query(
    `SELECT DISTINCT mst_cab AS kode FROM ${tabelStok(jenis)}
     WHERE mst_aktif = 'Y' AND mst_cab <> '' ORDER BY mst_cab`,
  );
  return rows;
};

// cabang kosong = semua cabang (hanya boleh dikirim controller untuk user yang berhak)
const getBrowse = async ({ jenis, cabang = "", tglAwal, tglAkhir }) => {
  const tabel = tabelStok(jenis);
  cekPeriode(tglAwal, tglAkhir);
  const params = [tglAwal, tglAwal, tglAwal, jenis, tglAkhir];
  if (cabang) params.push(cabang);

  const [rows] = await db.query(
    `SELECT m.mst_brg_kode AS kode,
            IFNULL(b.brg_nama, '${TANPA_MASTER}') AS nama,
            IFNULL(b.brg_ktg, '') AS kategori,
            IFNULL(b.brg_note, '') AS spesifikasi,
            IFNULL(b.brg_satuan, '-') AS satuan,
            SUM(CASE WHEN m.mst_tanggal < ? THEN m.mst_stok_in - m.mst_stok_out ELSE 0 END) AS stock_awal,
            SUM(CASE WHEN m.mst_tanggal >= ? THEN m.mst_stok_in ELSE 0 END) AS jml_in,
            SUM(CASE WHEN m.mst_tanggal >= ? THEN m.mst_stok_out ELSE 0 END) AS jml_out
     FROM ${tabel} m
     LEFT JOIN tgarmen_brg b ON b.brg_kode = m.mst_brg_kode AND b.brg_jenis = ?
     WHERE m.mst_aktif = 'Y' AND m.mst_tanggal <= ? ${filterCabang(cabang)}
     GROUP BY m.mst_brg_kode, b.brg_nama, b.brg_ktg, b.brg_note, b.brg_satuan
     HAVING stock_awal <> 0 OR jml_in <> 0 OR jml_out <> 0
     ORDER BY m.mst_brg_kode`,
    params,
  );

  return rows.map((r) => {
    const awal = bulat(r.stock_awal);
    const masuk = bulat(r.jml_in);
    const keluar = bulat(r.jml_out);
    return {
      kode: r.kode,
      nama: r.nama,
      kategori: r.kategori,
      spesifikasi: r.spesifikasi,
      satuan: r.satuan,
      stock_awal: awal,
      jml_in: masuk,
      jml_out: keluar,
      stock_akhir: bulat(awal + masuk - keluar),
    };
  });
};

// Detail transaksi: satu bahan (kode diisi) atau semua (kode kosong, untuk Export Detail)
const getDetail = async ({
  jenis,
  cabang = "",
  tglAwal,
  tglAkhir,
  kode = "",
}) => {
  const tabel = tabelStok(jenis);
  cekPeriode(tglAwal, tglAkhir);
  const params = [jenis, tglAwal, tglAkhir];
  if (kode) params.push(kode);
  if (cabang) params.push(cabang);

  const [rows] = await db.query(
    `SELECT m.mst_brg_kode AS kode,
            IFNULL(b.brg_nama, '${TANPA_MASTER}') AS nama,
            IFNULL(b.brg_ktg, '') AS kategori,
            IFNULL(b.brg_note, '') AS spesifikasi,
            IFNULL(b.brg_satuan, '-') AS satuan,
            m.mst_noreferensi AS nomor_ref,
            DATE_FORMAT(m.mst_tanggal, '%Y-%m-%d') AS tanggal,
            m.mst_stok_in AS jml_in, m.mst_stok_out AS jml_out
     FROM ${tabel} m
     LEFT JOIN tgarmen_brg b ON b.brg_kode = m.mst_brg_kode AND b.brg_jenis = ?
     WHERE m.mst_aktif = 'Y' AND m.mst_tanggal BETWEEN ? AND ?
       ${kode ? "AND m.mst_brg_kode = ?" : ""} ${filterCabang(cabang)}
     ORDER BY m.mst_brg_kode, m.mst_tanggal, m.mst_noreferensi`,
    params,
  );

  return rows.map((r) => ({
    kode: r.kode,
    nama: r.nama,
    kategori: r.kategori,
    spesifikasi: r.spesifikasi,
    satuan: r.satuan,
    nomor_ref: r.nomor_ref,
    tanggal: r.tanggal,
    keterangan: keteranganReferensi(r.nomor_ref),
    jml_in: bulat(r.jml_in),
    jml_out: bulat(r.jml_out),
  }));
};

module.exports = { getCabang, getBrowse, getDetail };
