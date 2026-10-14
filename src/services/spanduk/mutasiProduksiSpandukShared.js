const {
  galat,
  norm,
  adalahSuperadmin,
  cabangUser,
} = require("./lhk/lhkCommon");

const T = {
  mps: "kencanaprint.tmutasi_produksi_spanduk",
  pabrik: "kencanaprint.tpabrik",
  spk: "kencanaprint.tspk",
  memoSpk: "kencanaprint.tmemospk",
  jenisOrder: "kencanaprint.tjenisorder",
  divisi: "kencanaprint.tdivisi",
};

const NOMOR_LOCK = "mutasi_produksi_spanduk_nomor";
const MAKS_KETERANGAN = 200;

// Sumber SPK/MAP: n=nomor, nm=nama, jml=jumlah order, c=cabang, jenis,
// tgl=tanggal SPK/MAP, divisi=kode divisi, jo=kode jenis order
// Cabang efektif sama dengan SQL_CAB_* di file lhk*Shared
const SUMBER_SPK = `
  SELECT spk_nomor AS n, spk_nama AS nm, spk_jumlah AS jml,
         spk_cab AS c, 'SPK' AS jenis,
         spk_tanggal AS tgl, spk_divisi AS divisi, spk_jo_kode AS jo
  FROM ${T.spk}
  UNION ALL
  SELECT mspk_nomor, mspk_nama, mspk_jumlah, mspk_cab, 'MAP',
         Mspk_Tanggal, mspk_divisi, MSpk_jo_kode
  FROM ${T.memoSpk}`;

// Info tampilan form. Alias derived table SUMBER_SPK harus `x`.
// tjenisorder berkunci (jo_kode, jo_divisi), jadi join memakai keduanya.
const SQL_INFO_SPK = `
  DATE_FORMAT(x.tgl, '%Y-%m-%d') AS Tgl_SPK,
  x.divisi AS Kode_Divisi,
  dv.divisi AS Nama_Divisi,
  x.jo AS Kode_Jenis_Order,
  jo.jo_nama AS Jenis_Produk`;

const SQL_JOIN_INFO_SPK = `
  LEFT JOIN ${T.divisi} dv ON dv.kode = x.divisi
  LEFT JOIN ${T.jenisOrder} jo ON jo.jo_kode = x.jo AND jo.jo_divisi = x.divisi`;

// Mutasi harus dari SPK/MAP cabang user (kecuali superadmin)
const pastikanMutasiDiCabang = async (q, spkNomor, user) => {
  if (adalahSuperadmin(user)) {
    return;
  }
  const cab = cabangUser(user);
  const [rows] = await q.query(
    `SELECT c FROM (${SUMBER_SPK}) sc WHERE sc.n = ? LIMIT 1`,
    [spkNomor],
  );
  if (rows.length === 0 || norm(rows[0].c) !== cab) {
    throw galat("Mutasi ini milik cabang lain", "forbidden");
  }
};

module.exports = {
  T,
  NOMOR_LOCK,
  MAKS_KETERANGAN,
  SUMBER_SPK,
  SQL_INFO_SPK,
  SQL_JOIN_INFO_SPK,
  pastikanMutasiDiCabang,
};
