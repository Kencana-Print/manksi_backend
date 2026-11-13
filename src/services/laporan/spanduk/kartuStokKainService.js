const db = require("../../../config/database");

// Awalan nomor referensi -> keterangan transaksi
const KETERANGAN_REFERENSI = [
  ["PBG", "Bukti Penerimaan Barang"],
  ["PROG", "Realisasi Permintaan Bahan"],
  ["RETP", "Retur Permintaan Bahan"],
  ["KOR", "Koreksi Stok"],
];

const galat = (pesan) => Object.assign(new Error(pesan), { status: 400 });

const bulat = (n) => Math.round((Number(n) || 0) * 100) / 100;

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

const filterGudang = (gudang) => (gudang ? "AND m.mst_gdg_kode = ?" : "");

const getGudang = async () => {
  const [rows] = await db.query(
    `SELECT DISTINCT m.mst_gdg_kode AS kode, IFNULL(g.gdg_nama, m.mst_gdg_kode) AS nama
     FROM tmasterstok_bahan m
     LEFT JOIN tgudang g ON g.gdg_kode = m.mst_gdg_kode
     WHERE m.mst_aktif = 'Y' AND m.mst_brg_kode LIKE 'SB%'
     ORDER BY m.mst_gdg_kode`,
  );
  return rows;
};

const getBrowse = async ({ tglAwal, tglAkhir, gudang = "" }) => {
  cekPeriode(tglAwal, tglAkhir);
  const params = [tglAwal, tglAwal, tglAwal, tglAkhir];
  if (gudang) params.push(gudang);

  const [rows] = await db.query(
    `SELECT m.mst_brg_kode AS kode, b.Bhn_Name AS nama,
            IFNULL(b.bhn_panjang, 0) AS panjang, IFNULL(b.bhn_lebar, 0) AS lebar,
            b.bhn_konstruksi AS konstruksi,
            SUM(CASE WHEN m.mst_tanggal < ? THEN m.mst_stok_in - m.mst_stok_out ELSE 0 END) AS stock_awal,
            SUM(CASE WHEN m.mst_tanggal >= ? THEN m.mst_stok_in ELSE 0 END) AS jml_in,
            SUM(CASE WHEN m.mst_tanggal >= ? THEN m.mst_stok_out ELSE 0 END) AS jml_out
     FROM tmasterstok_bahan m
     JOIN tbahan b ON b.Bhn_kode = m.mst_brg_kode
     WHERE m.mst_aktif = 'Y' AND m.mst_brg_kode LIKE 'SB%'
       AND m.mst_tanggal <= ? ${filterGudang(gudang)}
     GROUP BY m.mst_brg_kode, b.Bhn_Name, b.bhn_panjang, b.bhn_lebar, b.bhn_konstruksi
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
      divisi: "SPANDUK",
      kategori: "BAHAN BAKU UTAMA",
      konstruksi: r.konstruksi || "-",
      panjang: Number(r.panjang),
      lebar: Number(r.lebar),
      satuan: "METER",
      stock_awal: awal,
      jml_in: masuk,
      jml_out: keluar,
      stock_akhir: bulat(awal + masuk - keluar),
    };
  });
};

// Detail transaksi: satu bahan (kode diisi) atau semua bahan yang punya transaksi (kode kosong)
const getDetail = async ({ kode = "", tglAwal, tglAkhir, gudang = "" }) => {
  cekPeriode(tglAwal, tglAkhir);
  const params = [tglAwal, tglAkhir];
  if (kode) params.push(kode);
  if (gudang) params.push(gudang);

  const [rows] = await db.query(
    `SELECT m.mst_brg_kode AS kode, b.Bhn_Name AS nama,
            IFNULL(b.bhn_panjang, 0) AS panjang, IFNULL(b.bhn_lebar, 0) AS lebar,
            b.bhn_konstruksi AS konstruksi,
            m.mst_noreferensi AS nomor_ref,
            DATE_FORMAT(m.mst_tanggal, '%Y-%m-%d') AS tanggal,
            IFNULL(g.gdg_nama, m.mst_gdg_kode) AS gudang,
            m.mst_stok_in AS jml_in, m.mst_stok_out AS jml_out
     FROM tmasterstok_bahan m
     JOIN tbahan b ON b.Bhn_kode = m.mst_brg_kode
     LEFT JOIN tgudang g ON g.gdg_kode = m.mst_gdg_kode
     WHERE m.mst_aktif = 'Y' AND m.mst_brg_kode LIKE 'SB%'
       AND m.mst_tanggal BETWEEN ? AND ?
       ${kode ? "AND m.mst_brg_kode = ?" : ""} ${filterGudang(gudang)}
     ORDER BY m.mst_brg_kode, m.mst_tanggal, m.date_create, m.mst_noreferensi`,
    params,
  );

  return rows.map((r) => ({
    kode: r.kode,
    nama: r.nama,
    kategori: "BAHAN BAKU UTAMA",
    konstruksi: r.konstruksi || "-",
    panjang: Number(r.panjang),
    lebar: Number(r.lebar),
    nomor_ref: r.nomor_ref,
    tanggal: r.tanggal,
    keterangan: keteranganReferensi(r.nomor_ref),
    gudang: r.gudang,
    jml_in: bulat(r.jml_in),
    jml_out: bulat(r.jml_out),
    satuan: "METER",
  }));
};

module.exports = { getGudang, getBrowse, getDetail };
