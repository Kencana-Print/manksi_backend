const {
  galat,
  cekTutupBuku,
  buatPembantuLhk,
  round2,
  norm,
} = require("./lhkCommon");

const T = {
  hdr: "tlhk_cetak_hdr",
  dtl: "tlhk_cetak_dtl",
  dtl2: "tlhk_cetak_dtl_2",
  kain: "tlhk_cetak_kain",
  bahan: "tbahan",
  so: "tsalesorder",
  hp: "tlhk_hapusplangkan_dtl",
  pabrik: "tpabrik",
  spk: "tspk",
  memoSpk: "tmemospk",
  karyawan: "hrd2.tkaryawan",
};

// Kain = master bahan Spanduk di tbahan (kode SB + 7 digit, aktif = bhn_aktif 0)
const KAIN = { prefix: "SB" };
// Meter kain melebihi kebutuhan lebih dari 2,5% = perlu approval
const TOLERANSI_KAIN = 0.025;

// Jabatan HRD (kar_jab_kode) yang boleh meng-approve kelebihan kain; superadmin juga boleh
const JABATAN_APPROVE = ["SPV", "MGR", "DIR"];

// Status approval kelebihan kain di lch_apv_status:
// '' tidak perlu, 'W' menunggu, 'Y' disetujui, 'N' ditolak.
// LHK aktif = '' atau 'Y' (default '' menjaga LHK dari desktop tetap aktif).
const APV = { TIDAK_PERLU: "", MENUNGGU: "W", SETUJU: "Y", TOLAK: "N" };
const sqlLhkAktif = (alias = "h") => `${alias}.lch_apv_status IN ('', 'Y')`;

// Kebutuhan kain = Σ qty_cetak × panjang SPK/MAP (meter lari, per LHK).
// Panjang kosong dihitung 0, sehingga baris itu memicu approval (konservatif).
// baris: [{ spk, qtyCetak }], kain: [{ qty }], peta: Map hasil ambilInfoSpk
const hitungKelebihanKain = (baris, kain, peta) => {
  const kebutuhan = round2(
    baris.reduce(
      (t, b) => t + b.qtyCetak * (Number(peta.get(b.spk)?.panjang) || 0),
      0,
    ),
  );
  const dipakai = round2(kain.reduce((t, k) => t + k.qty, 0));
  const batas = round2(kebutuhan * (1 + TOLERANSI_KAIN));
  return { kebutuhan, dipakai, batas, perluApproval: dipakai > batas };
};

// Kolom tsalesorder yang menyimpan nomor MAP
const KOLOM_SO_MAP = "so_memo";

// Plangkan otomatis dari LHK Hapus Plangkan (HP). daftarNomor = nomor SPK atau MAP
// baris LHK Cetak. Rantai: SPK -> SO (spk_so_ref) -> nomor MAP; baris MAP langsung
// memakai MAP itu sendiri.
// sisa = total HP semua baris MAP - plangkan di LHK Cetak lain (nomorLhk dikecualikan).
// otomatis = false bila tidak ada MAP atau MAP belum punya HP (isi manual).
// kunci = true di dalam transaksi: pembacaan memakai FOR UPDATE supaya LHK Cetak lain
// untuk SPK yang sama tidak bisa menyisip bersamaan.
const ambilPlangkanMap = async (
  q,
  daftarNomor,
  nomorLhk = "",
  kunci = false,
) => {
  const hasil = new Map();
  if (daftarNomor.length === 0) {
    return hasil;
  }

  const [langsung] = await q.query(
    `SELECT mspk_nomor AS nomor FROM ${T.memoSpk} WHERE mspk_nomor IN (?)`,
    [daftarNomor],
  );
  const petaMap = new Map(
    langsung.map((r) => [String(r.nomor), String(r.nomor)]),
  );
  const [lewatSo] = await q.query(
    `SELECT s.spk_nomor AS nomor, o.${KOLOM_SO_MAP} AS map
     FROM ${T.spk} s
     JOIN ${T.so} o ON o.so_nomor = s.spk_so_ref
     WHERE s.spk_nomor IN (?) AND IFNULL(o.${KOLOM_SO_MAP}, '') <> ''`,
    [daftarNomor],
  );
  for (const r of lewatSo) {
    if (!petaMap.has(String(r.nomor))) {
      petaMap.set(String(r.nomor), String(r.map).trim());
    }
  }

  const total = new Map();
  const daftarMap = [...new Set(petaMap.values())];
  if (daftarMap.length > 0) {
    const [hp] = await q.query(
      `SELECT lhpd_spk_nomor AS map, SUM(lhpd_jml_plangkan) AS total
       FROM ${T.hp} WHERE lhpd_spk_nomor IN (?) GROUP BY lhpd_spk_nomor`,
      [daftarMap],
    );
    for (const r of hp) {
      total.set(norm(r.map), Number(r.total) || 0);
    }
  }

  const [pakai] = await q.query(
    `SELECT lcd_spk_nomor AS nomor, SUM(lcd_qty_plangkan) AS terpakai
     FROM ${T.dtl}
     WHERE lcd_spk_nomor IN (?) AND lcd_lch_nomor <> ?
     GROUP BY lcd_spk_nomor${kunci ? " FOR UPDATE" : ""}`,
    [daftarNomor, nomorLhk],
  );
  const petaPakai = new Map(
    pakai.map((r) => [String(r.nomor), Number(r.terpakai) || 0]),
  );

  for (const nomor of daftarNomor) {
    const map = petaMap.get(nomor) ?? "";
    const tot = map ? total.get(norm(map)) : undefined;
    if (tot === undefined) {
      hasil.set(nomor, {
        map,
        total: 0,
        terpakai: 0,
        sisa: 0,
        otomatis: false,
      });
      continue;
    }
    const terpakai = petaPakai.get(nomor) ?? 0;
    hasil.set(nomor, {
      map,
      total: tot,
      terpakai,
      sisa: Math.max(0, tot - terpakai),
      otomatis: true,
    });
  }
  return hasil;
};

// LHK Cetak tidak boleh diubah/dihapus selama masih dirujuk LHK Tinta/Cat
const TABEL_PEMAKAI_LHK = [
  {
    tabel: "tlhk_tinta_hdr",
    kolom: "lnt_lch_nomor",
    label: "LHK Tinta/Cat",
  },
];

const pembantu = buatPembantuLhk({
  T,
  kolomNomorHdr: "lch_nomor",
  kolomNomorDtl: "lcd_lch_nomor",
  kolomSpkDtl: "lcd_spk_nomor",
  tabelPemakai: TABEL_PEMAKAI_LHK,
});

module.exports = {
  T,
  TOLERANSI_KAIN,
  JABATAN_APPROVE,
  APV,
  sqlLhkAktif,
  hitungKelebihanKain,
  ambilPlangkanMap,
  KAIN,
  galat,
  cekTutupBuku,
  filterCabang: pembantu.filterCabang,
  pastikanLhkDiCabang: pembantu.pastikanLhkDiCabang,
  pastikanBelumDipakai: pembantu.pastikanBelumDipakai,
  ambilInfoSpk: pembantu.ambilInfoSpk,
  periksaSumber: pembantu.periksaSumber,
  pastikanPabrik: pembantu.pastikanPabrik,
};
