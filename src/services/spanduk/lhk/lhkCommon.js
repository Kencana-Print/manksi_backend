const { getTanggalTutupBuku } = require("../../tutupBukuService");

const BAGIAN_SUPERADMIN = ["EDP", "DIR", "AUDIT"];
const DIVISI_BOLEH = [1, 5];
// MP-13: batas "SPK/MAP lama" yang dikecualikan dari gate rantai LHK
const TANGGAL_MULAI_MUTASI = "2026-10-13";
const REGEX_TANGGAL = /^\d{4}-\d{2}-\d{2}$/;

const galat = (pesan, jenis) => {
  const e = new Error(pesan);
  if (jenis) {
    e[jenis] = true;
  }
  return e;
};

const teks = (v) => String(v ?? "").trim();
const norm = (v) => teks(v).toUpperCase();
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const MAKS_ANGKA = 99999999.99; // double(10,2)
const MAKS_INT = 2147483647; // int(11)

// Angka tidak negatif, desimal pakai titik; kosong dianggap 0
const angka = (v, label, maks = MAKS_ANGKA) => {
  if (v === null || v === undefined || teks(v) === "") {
    return 0;
  }
  const s = teks(v);
  if (!/^\d+(\.\d+)?$/.test(s)) {
    throw galat(`${label} harus angka tidak negatif (desimal pakai titik)`);
  }
  const n = Number(s);
  if (n > maks) {
    throw galat(`${label} terlalu besar (maksimum ${maks})`);
  }
  return round2(n);
};

// Bilangan bulat tidak negatif; kosong dianggap 0
const bilangan = (v, label, maks = MAKS_INT) => {
  const s = teks(v);
  if (s === "") {
    return 0;
  }
  if (!/^\d+$/.test(s)) {
    throw galat(`${label} harus bilangan bulat tidak negatif`);
  }
  const n = Number(s);
  if (n > maks) {
    throw galat(`${label} terlalu besar`);
  }
  return n;
};

const fmtTgl = (v) => {
  if (v instanceof Date) {
    const d = String(v.getDate()).padStart(2, "0");
    const m = String(v.getMonth() + 1).padStart(2, "0");
    return `${d}-${m}-${v.getFullYear()}`;
  }
  const [y, m, d] = String(v).slice(0, 10).split("-");
  return `${d}-${m}-${y}`;
};

const parseTanggal = (v) => {
  const s = teks(v);
  if (!REGEX_TANGGAL.test(s)) {
    throw galat("Tanggal tidak valid (format YYYY-MM-DD)");
  }
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) {
    throw galat("Tanggal tidak valid");
  }
  return s;
};

const validasiPeriode = (tglAwal, tglAkhir) => {
  if (!REGEX_TANGGAL.test(String(tglAwal || ""))) {
    throw galat("Tanggal awal tidak valid (format YYYY-MM-DD)");
  }
  if (!REGEX_TANGGAL.test(String(tglAkhir || ""))) {
    throw galat("Tanggal akhir tidak valid (format YYYY-MM-DD)");
  }
  if (tglAwal > tglAkhir) {
    throw galat("Tanggal awal tidak boleh lebih besar dari tanggal akhir");
  }
};

const adalahSuperadmin = (user) =>
  BAGIAN_SUPERADMIN.includes(norm(user?.bagian));

const cabangUser = (user) => {
  const cab = norm(user?.cabang);
  if (!cab) {
    throw galat("Cabang user tidak terdeteksi", "forbidden");
  }
  return cab;
};

// Tutup buku otomatis (tanggal LHK dibanding batas periode terbuka)
const cekTutupBuku = async (tanggalStr) => {
  const batas = await getTanggalTutupBuku();
  const [y, m, d] = String(tanggalStr).slice(0, 10).split("-").map(Number);
  if (new Date(y, m - 1, d) < batas) {
    throw galat(
      `Periode ${fmtTgl(tanggalStr)} sudah ditutup (tutup buku). ` +
        `Tanggal paling awal yang boleh: ${fmtTgl(batas)}`,
    );
  }
};

// Helper yang bergantung pada nama tabel/kolom tiap jenis LHK.
// cfg: { T: {dtl, spk, memoSpk}, kolomNomorHdr, kolomNomorDtl, kolomSpkDtl,
//        tabelPemakai: [{tabel, kolom}], sqlCabSpk, sqlCabMemo }
// Nilai cfg hanya konstanta di kode (bukan input user).
const buatPembantuLhk = ({
  T,
  kolomNomorHdr,
  kolomNomorDtl,
  kolomSpkDtl,
  tabelPemakai = [],
  sqlCabSpk = "spk_cab",
  sqlCabMemo = "mspk_cab", // mspk_cab2 belum dipakai: lihat catatan di PRD
}) => {
  const sumberCab = `
    SELECT spk_nomor AS n, ${sqlCabSpk} AS c FROM ${T.spk}
    UNION ALL
    SELECT mspk_nomor, ${sqlCabMemo} FROM ${T.memoSpk}`;

  // Browse: hanya LHK yang punya baris SPK/MAP dari cabang user
  const filterCabang = (user, alias = "h") => {
    if (adalahSuperadmin(user)) {
      return { sql: "", params: [] };
    }
    const cab = cabangUser(user);
    return {
      sql: `AND EXISTS (
        SELECT 1 FROM ${T.dtl} dc
        JOIN (${sumberCab}) sc ON sc.n = dc.${kolomSpkDtl}
        WHERE dc.${kolomNomorDtl} = ${alias}.${kolomNomorHdr}
          AND UPPER(TRIM(sc.c)) = ?
      )`,
      params: [cab],
    };
  };

  // LHK yang sudah ada harus punya baris dari cabang user (kecuali superadmin)
  const pastikanLhkDiCabang = async (q, nomor, user) => {
    if (adalahSuperadmin(user)) {
      return;
    }
    const cab = cabangUser(user);
    const [tot] = await q.query(
      `SELECT COUNT(*) AS jml FROM ${T.dtl} WHERE ${kolomNomorDtl} = ?`,
      [nomor],
    );
    if (Number(tot[0].jml) === 0) {
      return;
    }
    const [rows] = await q.query(
      `SELECT 1
       FROM ${T.dtl} d
       JOIN (${sumberCab}) sc ON sc.n = d.${kolomSpkDtl}
       WHERE d.${kolomNomorDtl} = ? AND UPPER(TRIM(sc.c)) = ?
       LIMIT 1`,
      [nomor, cab],
    );
    if (rows.length === 0) {
      throw galat("LHK ini milik cabang lain", "forbidden");
    }
  };

  // Guard: LHK sudah dipakai modul lain, dan kunci rantai LHK
  // (lini berikutnya sudah ada untuk SPK/MAP di LHK ini). Superadmin
  // dibebaskan dari kunci rantai.
  const pastikanBelumDipakai = async (q, nomor, user) => {
    for (const { tabel, kolom, label } of tabelPemakai) {
      const [rows] = await q.query(
        `SELECT 1 FROM ${tabel} WHERE ${kolom} = ? LIMIT 1`,
        [nomor],
      );
      if (rows.length > 0) {
        throw galat(
          `LHK ${nomor} sudah dipakai di ${label ?? tabel}, tidak bisa diubah/dihapus`,
        );
      }
    }
    // require di sini, bukan di atas file: lhkLini memuat semua Shared LHK
    // dan Shared memuat lhkCommon (menghindari ketergantungan melingkar)
    const { pastikanTidakTerkunciRantai } = require("./lhkKunciRantai");
    await pastikanTidakTerkunciRantai(q, {
      tabelDtl: T.dtl,
      kolomNomorDtl,
      nomor,
      user,
    });
  };

  // Sumber: SPK + memo/MAP
  const ambilInfoSpk = async (q, daftarNomor) => {
    const [rows] = await q.query(
      `SELECT x.nomor, x.nama, x.jumlah, x.panjang, x.lebar, x.divisi, x.cab
       FROM (
         SELECT spk_nomor AS nomor, spk_nama AS nama, spk_jumlah AS jumlah,
                IFNULL(spk_panjang, 0) AS panjang, IFNULL(spk_lebar, 0) AS lebar,
                spk_divisi AS divisi, ${sqlCabSpk} AS cab
         FROM ${T.spk}
         UNION ALL
         SELECT mspk_nomor, mspk_nama, mspk_jumlah,
                IFNULL(mspk_panjang, 0), IFNULL(mspk_lebar, 0),
                mspk_divisi, ${sqlCabMemo}
         FROM ${T.memoSpk}
       ) x
       WHERE x.nomor IN (?)`,
      [daftarNomor],
    );
    const peta = new Map();
    for (const r of rows) {
      if (!peta.has(r.nomor)) {
        peta.set(r.nomor, r);
      }
    }
    return peta;
  };

  const periksaSumber = (info, nomor, user) => {
    if (!info) {
      throw galat(`SPK/MAP ${nomor} tidak ditemukan`, "notFound");
    }
    if (!DIVISI_BOLEH.includes(Number(info.divisi))) {
      throw galat(`SPK/MAP ${nomor} bukan divisi Spanduk/MMT`);
    }
    if (!adalahSuperadmin(user)) {
      const cab = cabangUser(user);
      if (norm(info.cab) !== cab) {
        throw galat(
          `SPK/MAP ${nomor} berasal dari cabang ${norm(info.cab) || "-"}, ` +
            `bukan cabang Anda (${cab})`,
        );
      }
    }
  };

  const pastikanPabrik = async (q, kode) => {
    const [rows] = await q.query(
      `SELECT pab_kode FROM ${T.pabrik} WHERE pab_kode = ?`,
      [kode],
    );
    if (rows.length === 0) {
      throw galat(`Pabrik ${kode} tidak ditemukan`);
    }
  };

  return {
    filterCabang,
    pastikanLhkDiCabang,
    pastikanBelumDipakai,
    ambilInfoSpk,
    periksaSumber,
    pastikanPabrik,
  };
};

module.exports = {
  galat,
  teks,
  norm,
  round2,
  angka,
  bilangan,
  MAKS_ANGKA,
  MAKS_INT,
  fmtTgl,
  parseTanggal,
  validasiPeriode,
  adalahSuperadmin,
  cabangUser,
  cekTutupBuku,
  buatPembantuLhk,
  DIVISI_BOLEH,
  TANGGAL_MULAI_MUTASI,
};
