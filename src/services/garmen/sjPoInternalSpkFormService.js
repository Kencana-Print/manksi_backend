const db = require("../../config/database");
const fs = require("fs");
const path = require("path");
const tutupBukuService = require("../tutupBukuService");

// ─────────────────────────────────────────────────────────
// HELPER: cek gambar SPK — sama pola PO Internal SPK (folder flat
// legacy /mnt/image). ⚠️ Delphi punya bug di sini: ckGambar SELALU
// di-set true apa pun hasil FileExists (dua branch isinya sama,
// dead-code). Kita implementasikan cek file BENERAN, bukan replikasi
// bug itu, karena kalau direplikasi checkbox-nya jadi gak berguna
// sama sekali.
// ─────────────────────────────────────────────────────────
const checkGambarSpk = (nomorSpk) => {
  if (!nomorSpk) return false;
  return fs.existsSync(path.join("/mnt/image", `${nomorSpk}.jpg`));
};

// ─────────────────────────────────────────────────────────
// GENERATE NOMOR — format PSJ/00001/2026
// ─────────────────────────────────────────────────────────
const generateNomor = async (tanggal, conn) => {
  const tahun = new Date(tanggal).getFullYear().toString();
  const [rows] = await conn.query(
    `SELECT MAX(CAST(SUBSTRING(poisj_nomor, 5, 5) AS UNSIGNED)) AS max_num
     FROM tpointernalsj_hdr WHERE RIGHT(poisj_nomor, 4) = ?`,
    [tahun],
  );
  const maxNum = rows[0].max_num;
  const nextNum = (maxNum === null ? 0 : Number(maxNum)) + 1;
  return `PSJ/${String(nextNum).padStart(5, "0")}/${tahun}`;
};

// ─────────────────────────────────────────────────────────
// getsudahsj() — total sudah dikirim oleh SJ LAIN (excludeNomor)
// untuk PO+kode+size yang sama.
// ─────────────────────────────────────────────────────────
const getSudahSj = async (excludeNomor, nomorPO, kode, size) => {
  const [rows] = await db.query(
    `SELECT IFNULL(SUM(d.poisjd_jumlah), 0) AS jml
     FROM tpointernalsj_hdr h
     INNER JOIN tpointernalsj_dtl d ON d.poisjd_nomor = h.poisj_nomor
     WHERE h.poisj_nomor <> ? AND h.poisj_nomorpo = ?
       AND d.poisjd_bhn_kode = ? AND d.poisjd_size = ?`,
    [excludeNomor || "", nomorPO, kode, size],
  );
  return Number(rows[0]?.jml) || 0;
};

// ─────────────────────────────────────────────────────────
// getLini() — replikasi persis: cari Lini Asal via
// tgudangproduksi.gdgp_nama2 LIKE %jasa_ket% + cabang, lalu tebak
// Lini Tujuan via peta rantai hardcode (LINI_TUJUAN_MAP).
// ⚠️ Peta ini FACTORY-SPECIFIC (kode gudang produksi tetap milik
// pabrik ini), direplikasi persis dari Delphi, jangan diutak-atik
// tanpa konfirmasi.
// ─────────────────────────────────────────────────────────
const LINI_TUJUAN_MAP = {
  GP015: "GP012", // GD POTONG P1 -> QC POTONG P4
  GP001: "GP021", // GD POTONG P4 -> QC CETAK P1
  GP017: "GP010", // GD CETAK P1 -> QC CETAK P4
  GP002: "GP022", // GD CETAK P4 -> QC CETAK P1
  GP018: "GP004", // GD JAHIT P1 -> QC JAHIT P4
  GP003: "GP019", // GD JAHIT P4 -> QC JAHIT P1
  GP019: "GP013", // GD LIPAT P1 -> QC KOLI P4
  GP004: "GP020", // GD LIPAT P4 -> QC KOLI P1
};

const suggestLini = async (jasaKet, cabang) => {
  if (!jasaKet || !cabang) return null;
  const [rows] = await db.query(
    `SELECT gdgp_kode, gdgp_nama FROM tgudangproduksi
     WHERE gdgp_aktif = 0 AND gdgp_nama2 LIKE ? AND gdgp_cab = ?
     ORDER BY gdgp_kode LIMIT 1`,
    [`%${jasaKet}%`, cabang],
  );
  if (rows.length === 0) return null;
  const asalKode = rows[0].gdgp_kode;
  const asalNama = rows[0].gdgp_nama;

  let tujuanKode = "";
  let tujuanNama = "";
  const mapped = LINI_TUJUAN_MAP[asalKode];
  if (mapped) {
    tujuanKode = mapped;
    const [tRows] = await db.query(
      `SELECT gdgp_nama FROM tgudangproduksi WHERE gdgp_kode = ?`,
      [tujuanKode],
    );
    tujuanNama = tRows[0]?.gdgp_nama || "";
  }

  return { asalKode, asalNama, tujuanKode, tujuanNama };
};

// ─────────────────────────────────────────────────────────
// CEK PO — replikasi edtNomorPOExit(). Ambil semua info PO + detail
// baris (siap isi grid) + saran Lini Asal/Tujuan.
// ✅ FIX: union tsalesorder (SO baru pasca migrasi) ditambahkan —
// nomor format lama sekarang hidup di sana, bukan lagi di tspk.
// ─────────────────────────────────────────────────────────
const checkPO = async (nomorPO) => {
  if (!nomorPO) throw new Error("Nomor PO wajib diisi.");
  const [rows] = await db.query(
    `SELECT h.poi_nomor,
            DATE_FORMAT(h.poi_tanggal, '%Y-%m-%d') AS poi_tanggal,
            DATE_FORMAT(h.poi_dateline, '%Y-%m-%d') AS poi_dateline,
            h.poi_spk_nomor,
            IFNULL(so.so_nama, IFNULL(s.spk_nama, m.mspk_nama)) AS namaspk,
            IFNULL(so.so_kain, IFNULL(s.spk_kain, m.mspk_kain)) AS bahan,
            IFNULL(so.so_ukuran, IFNULL(s.spk_ukuran, m.mspk_ukuran)) AS ukuran,
            IFNULL(so.so_jumlah, IFNULL(s.spk_jumlah, m.mspk_jumlah)) AS jumlah,
            IFNULL(so.so_sablon, IFNULL(s.spk_sablon, '-')) AS sablon,
            IFNULL(so.so_sublim, IFNULL(s.spk_sublim, '-')) AS sublim,
            IFNULL(so.so_bordir, IFNULL(s.spk_bordir, '-')) AS bordir,
            DATE_FORMAT(
              IFNULL(so.so_tanggal, IFNULL(s.spk_tanggal, m.mspk_tanggal)), '%Y-%m-%d'
            ) AS spk_tanggal,
            h.poi_jasa_kode, j.jasa_nama, j.jasa_ket,
            h.poi_cab, c.pab_nama AS namacab,
            h.poi_sup, u.pab_nama AS namasup
     FROM tpointernal_hdr h
     LEFT JOIN tsalesorder so ON so.so_nomor = h.poi_spk_nomor
     LEFT JOIN tspk s ON s.spk_nomor = h.poi_spk_nomor
     LEFT JOIN tmemospk m ON m.mspk_nomor = h.poi_spk_nomor
     LEFT JOIN tjasa j ON j.jasa_kode = h.poi_jasa_kode
     LEFT JOIN tpabrik c ON c.pab_kode = h.poi_cab
     LEFT JOIN tpabrik u ON u.pab_kode = h.poi_sup
     WHERE h.poi_nomor = ?`,
    [nomorPO],
  );
  if (rows.length === 0) throw new Error("Nomor PO tersebut belum ada.");
  const po = rows[0];

  const [dtlRows] = await db.query(
    `SELECT d.poid_bhn_kode, b.Bhn_Name, b.Bhn_satuan, d.poid_size, d.poid_jumlah
     FROM tpointernal_dtl d
     LEFT JOIN tbahan b ON b.Bhn_kode = d.poid_bhn_kode
     WHERE d.poid_nomor = ?
     ORDER BY d.poid_bhn_kode, d.poid_size`,
    [nomorPO],
  );

  const detail = [];
  for (const d of dtlRows) {
    const sudahsj = await getSudahSj("", nomorPO, d.poid_bhn_kode, d.poid_size);
    detail.push({
      kode: d.poid_bhn_kode,
      nama: d.Bhn_Name,
      satuan: d.Bhn_satuan,
      size: d.poid_size,
      jumlahpo: Number(d.poid_jumlah) || 0,
      jumlah: 0,
      bs: 0,
      sablon: 0,
      kain: 0,
      koli: 0,
      ket: "",
      sudahsj,
      kurang: (Number(d.poid_jumlah) || 0) - sudahsj,
      new: false,
    });
  }

  const lini = await suggestLini(po.jasa_ket, po.poi_sup);

  return {
    header: {
      NomorPO: po.poi_nomor,
      TanggalPO: po.poi_tanggal,
      DatelinePO: po.poi_dateline,
      NomorSPK: po.poi_spk_nomor,
      NamaSPK: po.namaspk,
      Bahan: po.bahan,
      Ukuran: po.ukuran,
      Jumlah: po.jumlah,
      SpkTanggal: po.spk_tanggal,
      CetakFlag: po.sablon === "Y" || po.sublim === "Y",
      BordirFlag: po.bordir === "Y",
      JasaKode: po.poi_jasa_kode,
      JasaNama: po.jasa_nama,
      // ⚠️ Lihat catatan penamaan: "Gudang Asal" = poi_sup (Tujuan
      // ASLI si PO), "Gudang Tujuan" = poi_cab (Asal ASLI si PO,
      // cuma info tampilan, TIDAK ikut disimpan ke tabel SJ).
      GudangAsalKode: po.poi_sup,
      GudangAsalNama: po.namasup,
      GudangTujuanKode: po.poi_cab,
      GudangTujuanNama: po.namacab,
      adaGambar: checkGambarSpk(po.poi_spk_nomor),
    },
    detail,
    lini,
  };
};

// ─────────────────────────────────────────────────────────
// CEK NO. MINTA MATERIAL — replikasi PERSIS edtNoMaterialExit().
// kodeKain WAJIB sudah diketahui (dari pilih RealisasiMintaSearchModal
// yang emang sekalian balikin kode) — endpoint ini cuma re-validasi
// kombinasi Nomor+Kode itu masih ada, sama persis pesan error Delphi
// kalau gak ketemu. TIDAK menebak kodeKain kalau kosong.
// ─────────────────────────────────────────────────────────
const checkNoMaterial = async (noMaterial, kodeBahan, excludeNomor = "") => {
  if (!noMaterial) throw new Error("Nomor Permintaan Material wajib diisi.");
  if (!kodeBahan) {
    throw new Error(
      "Kode kain belum terisi — pilih No. Minta Material lewat tombol cari, jangan ketik manual.",
    );
  }

  const [rows] = await db.query(
    `SELECT b.promind_Jumlah AS jmlkain,
            IFNULL(n.Bhn_Name, '') AS namakain,
            IFNULL(n.Bhn_satuan, '') AS satkain,
            DATE_FORMAT(a.promin_tanggal, '%Y-%m-%d') AS tanggal
     FROM tproduksiminta_dtl b
     INNER JOIN tproduksiminta_hdr a ON a.promin_nomor = b.promind_promin_Nomor
     LEFT JOIN tbahan n ON n.Bhn_kode = b.promind_bhn_kode
     WHERE b.promind_promin_Nomor = ? AND b.promind_bhn_kode = ?`,
    [noMaterial, kodeBahan],
  );
  if (rows.length === 0) {
    throw new Error("No permintaan dengan kode kain tsb tidak ada");
  }
  const r = rows[0];

  let mutasiWhere = `WHERE mph_nomaterial = ? AND mph_bhn_kode = ?`;
  const mutasiParams = [noMaterial, kodeBahan];
  if (excludeNomor) {
    mutasiWhere += ` AND mph_nomor_opr <> ?`;
    mutasiParams.push(excludeNomor);
  }

  const [[lhkRow]] = await db.query(
    `SELECT SUM(jml) AS sudah FROM (
       SELECT IFNULL(SUM(mph_qty_berat), 0) AS jml
       FROM tmutasiproduksi_hdr
       ${mutasiWhere}
       UNION ALL
       SELECT IFNULL(SUM(bpj_qty_berat), 0) AS jml
       FROM tbpj_hdr
       WHERE bpj_nomaterial = ? AND bpj_bhn_kode = ?
     ) x`,
    [...mutasiParams, noMaterial, kodeBahan],
  );

  return {
    kodeKain: kodeBahan,
    tanggalMinta: r.tanggal,
    jmlKain: Number(r.jmlkain) || 0,
    namaKain: r.namakain,
    satKain: r.satkain,
    lhkSudahPakai: Number(lhkRow?.sudah) || 0,
  };
};
// ─────────────────────────────────────────────────────────
// CEK SPK — replikasi edtNomorSPKExit() versi form SJ. Lebih simpel
// dari punya PO Internal SPK sendiri (TANPA cek CMO), karena field
// ini di form SJ cuma safety-net (biasanya auto-terisi dari PO).
// ✅ FIX union tsalesorder juga diterapkan di sini.
// ─────────────────────────────────────────────────────────
const checkSpk = async (nomor) => {
  if (!nomor) throw new Error("Nomor SPK wajib diisi.");
  const [rows] = await db.query(
    `SELECT * FROM (
       SELECT so_nomor AS Nomor, so_nama AS Nama, so_kain AS Kain, so_ukuran AS Ukuran, so_jumlah AS Jumlah
       FROM tsalesorder WHERE so_aktif = 'Y'
       UNION ALL
       SELECT spk_nomor, spk_nama, spk_kain, spk_ukuran, spk_jumlah
       FROM tspk WHERE spk_aktif = 'Y'
       UNION ALL
       SELECT mspk_nomor, mspk_nama, mspk_kain, mspk_ukuran, mspk_jumlah
       FROM tmemospk
     ) x WHERE Nomor = ?`,
    [nomor],
  );
  if (rows.length === 0) throw new Error("Nomor Spk tsb tidak ada.");
  const r = rows[0];
  return {
    Nomor: r.Nomor,
    Nama: r.Nama,
    Bahan: r.Kain,
    Ukuran: r.Ukuran,
    Jumlah: r.Jumlah,
  };
};

// ─────────────────────────────────────────────────────────
// CEK GUDANG PRODUKSI (Lini Asal / Lini Tujuan) — validasi kode,
// filter gdgp_aktif=0 (+ cabang kalau dikirim).
// ─────────────────────────────────────────────────────────
const checkGudangProduksi = async (kode, cabang) => {
  if (!kode) throw new Error("Kode Lini wajib diisi.");
  const params = [kode];
  let where = "gdgp_aktif = 0 AND gdgp_kode = ?";
  if (cabang) {
    where += " AND gdgp_cab = ?";
    params.push(cabang);
  }
  const [rows] = await db.query(
    `SELECT gdgp_kode, gdgp_nama FROM tgudangproduksi WHERE ${where}`,
    params,
  );
  if (rows.length === 0) throw new Error("Kode Lini tidak ditemukan.");
  return { kode: rows[0].gdgp_kode, nama: rows[0].gdgp_nama };
};

// ─────────────────────────────────────────────────────────
// KOMPONEN OPTIONS (dropdown cbkomponen) — replikasi
// edtNomorSPKChange(): coba tspk_babaran per SPK dulu, fallback ke
// master tkomponen kalau SPK itu belum punya babaran custom.
// ─────────────────────────────────────────────────────────
const getKomponenOptions = async (nomorSpk) => {
  if (nomorSpk) {
    const [rows] = await db.query(
      `SELECT DISTINCT spkb_komponen FROM tspk_babaran WHERE spkb_nomor = ?`,
      [nomorSpk],
    );
    if (rows.length > 0) return rows.map((r) => r.spkb_komponen);
  }
  const [rows] = await db.query(`SELECT komponen FROM tkomponen ORDER BY no`);
  return rows.map((r) => r.komponen);
};

// ─────────────────────────────────────────────────────────
// KELOMPOK OPTIONS (cbKelompok) — replikasi persis edtNamaJasaChange().
// Filter lini dari SUBSTRING nama Jasa, urutan cek PENTING (QC POTONG
// harus dicek sebelum POTONG, karena "QC POTONG" juga match substring
// "POTONG" — replikasi urutan if-else Delphi apa adanya).
// ─────────────────────────────────────────────────────────
const LINI_PATTERNS = [
  "QC POTONG",
  "QC CETAK",
  "POTONG",
  "CETAK",
  "JAHIT",
  "LIPAT",
];

const getKelompokOptions = async (jasaNama, cabang) => {
  if (!cabang) return [];
  const nama = (jasaNama || "").toUpperCase();
  const lini = LINI_PATTERNS.find((p) => nama.includes(p)) || null;

  const [rows] = lini
    ? await db.query(
        `SELECT Kelompok FROM tkelompok WHERE lini = ? AND cab = ?`,
        [lini, cabang],
      )
    : await db.query(`SELECT Kelompok FROM tkelompok WHERE cab = ?`, [cabang]);

  return rows.map((r) => r.Kelompok);
};

// ─────────────────────────────────────────────────────────
// BABARAN STANDAR (cbkomponenChange) — spkb_babaran per SPK+komponen.
// ─────────────────────────────────────────────────────────
const getBabaranStandar = async (nomorSpk, komponen) => {
  if (!nomorSpk || !komponen) return 0;
  const [rows] = await db.query(
    `SELECT spkb_babaran FROM tspk_babaran WHERE spkb_nomor = ? AND spkb_komponen = ?`,
    [nomorSpk, komponen],
  );
  return rows.length > 0 ? Number(rows[0].spkb_babaran) || 0 : 0;
};

// ─────────────────────────────────────────────────────────
// KELOMPOK TUJUAN OPTIONS — replikasi persis edtNamaGudangProdtujuanChange().
// Field ini CUMA relevan kalau Lini Tujuan = 'GP003' (hardcode
// persis Delphi), filter lini='JAHIT' + cab = Gudang Tujuan (poi_cab
// PO asli, field GudangTujuanKode di model kita).
// ─────────────────────────────────────────────────────────
const getKelompokTujuanOptions = async (liniTujuan, cab) => {
  if (liniTujuan !== "GP003" || !cab) return [];
  const [rows] = await db.query(
    `SELECT Kelompok FROM tkelompok WHERE lini = 'JAHIT' AND cab = ?`,
    [cab],
  );
  return rows.map((r) => r.Kelompok);
};

// ─────────────────────────────────────────────────────────
// CEK SUPPLIER — replikasi edtsupkodeExit(). ⚠️ Belum ada source
// literal, diimplementasikan pakai pola validate-by-kode standar
// (sama seperti checkGudangProduksi/checkPabrik) — cek sup_aktif='Y'.
// ─────────────────────────────────────────────────────────
const checkSupplier = async (kode) => {
  if (!kode) throw new Error("Kode Supplier wajib diisi.");
  const [rows] = await db.query(
    `SELECT sup_kode, sup_nama FROM tsupplier WHERE sup_aktif = 'Y' AND sup_kode = ?`,
    [kode],
  );
  if (rows.length === 0) throw new Error("Kode tidak ditemukan");
  return { kode: rows[0].sup_kode, nama: rows[0].sup_nama };
};

// ─────────────────────────────────────────────────────────
// LOAD BAHAN (tambah baris ad-hoc di grid, F1/Enter, mode="komponen")
// — replikasi loadkode() versi form SJ ini: TANPA filter bhn_bordir
// (beda dari versi PO Internal SPK yang ada filter khusus jasa J08).
// Semua baris hasil sini SELALU ditandai new=true, karena secara
// definisi bukan bagian baseline PO.
// ─────────────────────────────────────────────────────────
const loadBahan = async ({ kode, nomorSpk, existingRows = [] }) => {
  if (!nomorSpk) throw new Error("SPK belum diketahui — pilih PO dulu.");
  if (!kode) throw new Error("Kode bahan wajib diisi.");

  const [bahanRows] = await db.query(
    `SELECT bhn_kode, bhn_name, bhn_satuan
     FROM tbahan WHERE bhn_aktif = 0 AND bhn_jb_kode = 'LL' AND bhn_kode LIKE ?
     ORDER BY bhn_kode LIMIT 1`,
    [`%${kode}`],
  );
  if (bahanRows.length === 0) throw new Error("Kode tsb tidak ditemukan.");
  const bahan = bahanRows[0];

  const isDup = (size) =>
    existingRows.some(
      (r) => r.kode === bahan.bhn_kode && (r.size || "") === (size || ""),
    );

  const [sizeRows] = await db.query(
    `SELECT spks_size FROM tspk_size WHERE spks_nomor = ?`,
    [nomorSpk],
  );

  const rows = [];
  const skipped = [];
  const pushRow = (size) => {
    if (isDup(size)) {
      skipped.push({ kode: bahan.bhn_kode, size: size || "" });
      return;
    }
    rows.push({
      kode: bahan.bhn_kode,
      nama: bahan.bhn_name,
      satuan: bahan.bhn_satuan,
      size: size || "",
      jumlahpo: 0,
      jumlah: 0,
      bs: 0,
      sablon: 0,
      kain: 0,
      koli: 0,
      ket: "",
      sudahsj: 0,
      kurang: 0,
      new: true,
    });
  };

  if (sizeRows.length === 0) {
    pushRow("");
  } else {
    for (const sz of sizeRows) pushRow(sz.spks_size);
  }

  if (rows.length === 0 && skipped.length > 0) {
    throw new Error("Kode tsb sudah di input.");
  }

  return { rows, skipped };
};

// ─────────────────────────────────────────────────────────
// CEK KOMPONEN IDENTIFIKASI — replikasi cekkomponen(). Cuma dipakai
// internal saat validasi F10 (tidak diekspos endpoint sendiri, sama
// seperti Delphi yang cuma nge-gate saat simpan, bukan interaktif).
// ⚠️ FIX: tabel identitas Cetak & Bordir SUDAH DIGABUNG jadi satu
// (tspk_komponen_cetak_bordir), dibedakan lewat kolom kcb_proses
// ('SABLON'/'SUBLIM' = cetak, 'BORDIR' = bordir). Tabel lama
// tspk_komponen_cetak & tspk_komponen_bordir yang dicek sebelumnya
// SUDAH TIDAK DIPAKAI LAGI — itu sebabnya validasi selalu gagal
// walau user sudah mengisi identitas komponen lewat form barunya.
// ─────────────────────────────────────────────────────────
const cekKomponenIdentifikasi = async (nomorSpk, jenis) => {
  if (jenis === "POTONG") {
    const [rows] = await db.query(
      `SELECT COUNT(*) AS jml FROM tspk_komponen_potong WHERE sk_nomor = ?`,
      [nomorSpk],
    );
    return Number(rows[0]?.jml) > 0;
  }

  if (jenis === "CETAK") {
    const [rows] = await db.query(
      `SELECT COUNT(*) AS jml FROM tspk_komponen_cetak_bordir
       WHERE kcb_nomor = ? AND kcb_proses IN ('SABLON', 'SUBLIM')`,
      [nomorSpk],
    );
    return Number(rows[0]?.jml) > 0;
  }

  if (jenis === "BORDIR") {
    const [rows] = await db.query(
      `SELECT COUNT(*) AS jml FROM tspk_komponen_cetak_bordir
       WHERE kcb_nomor = ? AND kcb_proses = 'BORDIR'`,
      [nomorSpk],
    );
    return Number(rows[0]?.jml) > 0;
  }

  return true;
};

// ─────────────────────────────────────────────────────────
// TUTUP BUKU + PIN5 — pola PERSIS diambil dari suratJalanFormService
// (modul "SJ" biasa), trs type diganti "SJ POINTERNAL". Dipakai saat
// SAVE (mempercayai xminta5 yang di-roundtrip dari client, sama
// seperti pola established modul SJ biasa).
// ─────────────────────────────────────────────────────────
const cekTutupBuku = async (tanggal, xminta5 = "") => {
  if (["MINTA", "WAIT", "TOLAK"].includes(xminta5)) {
    return {
      boleh: false,
      message:
        "Transaksi tsb sudah diclose.\nSilahkan minta approve untuk bisa menyimpan perubahan data.",
    };
  }
  if (xminta5 === "ACC") return { boleh: true };

  const tgl = new Date(tanggal);
  const zMonth = tgl.getMonth();
  const zYear = tgl.getFullYear();

  let ztglclose = 0;
  const [verRows] = await db.query(
    `SELECT tgl_close FROM tversi WHERE aplikasi = 'MANKSI' LIMIT 1`,
  );
  if (verRows.length > 0) ztglclose = parseInt(verRows[0].tgl_close, 10) || 0;

  const limitDate = new Date(zYear, zMonth + 1, ztglclose);
  limitDate.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const zCloseManual =
    await tutupBukuService.getManualTutupBuku("SJ POINTERNAL");

  let boleh = true;
  if (zCloseManual) {
    zCloseManual.setHours(0, 0, 0, 0);
    if (tgl < zCloseManual) boleh = false;
  } else {
    if (limitDate < today) boleh = false;
  }

  if (!boleh) {
    return {
      boleh: false,
      message: "Anda tidak boleh input di tanggal periode yg sudah diclose.",
    };
  }
  return { boleh: true };
};

// ─────────────────────────────────────────────────────────
// STATUS PIN5 UNTUK LOAD (getById) — ⚠️ replikasi persis: status
// PIN5 CUMA dihitung/ditampilkan kalau transaksi ini BENERAN lagi
// butuh approval (dalam window tutup buku). Kalau tidak, dianggap
// kosong ('') walau ada baris lama di tspk_pin5 dari transaksi
// sebelumnya — supaya SJ yang periodenya masih terbuka gak
// kebawa-bawa status approval basi.
// ─────────────────────────────────────────────────────────
const getSjPin5Status = async (nomor, tanggal) => {
  const tgl = new Date(tanggal);
  const zMonth = tgl.getMonth();
  const zYear = tgl.getFullYear();

  let ztglclose = 0;
  const [verRows] = await db.query(
    `SELECT tgl_close FROM tversi WHERE aplikasi = 'MANKSI' LIMIT 1`,
  );
  if (verRows.length > 0) ztglclose = parseInt(verRows[0].tgl_close, 10) || 0;

  const limitDate = new Date(zYear, zMonth + 1, ztglclose);
  limitDate.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const zCloseManual =
    await tutupBukuService.getManualTutupBuku("SJ POINTERNAL");

  let perluCek = false;
  if (zCloseManual) {
    zCloseManual.setHours(0, 0, 0, 0);
    if (tgl < zCloseManual) perluCek = true;
  } else {
    if (limitDate < today) perluCek = true;
  }

  if (!perluCek) return { status: "", urut: 0 };

  const [rows] = await db.query(
    `SELECT pin_urut, pin_acc, pin_dipakai FROM tspk_pin5
     WHERE pin_trs = 'SJ POINTERNAL' AND pin_nomor = ?
     ORDER BY pin_urut DESC LIMIT 1`,
    [nomor],
  );
  if (rows.length === 0) return { status: "MINTA", urut: 0 };
  const pin = rows[0];
  if (pin.pin_acc === "" && pin.pin_dipakai === "")
    return { status: "WAIT", urut: pin.pin_urut };
  if (pin.pin_acc === "Y" && pin.pin_dipakai === "")
    return { status: "ACC", urut: pin.pin_urut };
  if (pin.pin_acc === "N") return { status: "TOLAK", urut: pin.pin_urut };
  return { status: "MINTA", urut: pin.pin_urut };
};

// ─────────────────────────────────────────────────────────
// GET BY ID (mode edit) — replikasi loaddataall(). Detail = baseline
// PO (LEFT JOIN nilai SJ ini sendiri) + baris ad-hoc (poisjd_new='Y').
// ⚠️ Untuk namakain/satkain/jmlkain: query Delphi aslinya ambigu
// (banyak alias tbahan sekaligus dalam 1 query multi-join, gampang
// ke-resolve ke tabel yang salah). Di sini pakai JOIN eksplisit yang
// BENAR secara intent (by poisj_bhn_kode / poisj_nomaterial), bukan
// replikasi ambiguitas itu.
// ─────────────────────────────────────────────────────────
const getById = async (nomor) => {
  const [hdrRows] = await db.query(
    `SELECT h.*,
            DATE_FORMAT(h.poisj_tanggal, '%Y-%m-%d') AS poisj_tanggal_fmt,
            o.poi_cab, o.poi_sup,
            DATE_FORMAT(o.poi_tanggal, '%Y-%m-%d') AS poi_tanggal_fmt,
            DATE_FORMAT(o.poi_dateline, '%Y-%m-%d') AS poi_dateline_fmt,
            la.gdgp_nama AS liniasalnama,
            lt.gdgp_nama AS linitujuannama,
            IFNULL(so.so_nama, IFNULL(s.spk_nama, m.mspk_nama)) AS namaspk,
            IFNULL(so.so_kain, IFNULL(s.spk_kain, m.mspk_kain)) AS bahan,
            IFNULL(so.so_ukuran, IFNULL(s.spk_ukuran, m.mspk_ukuran)) AS ukuran,
            IFNULL(so.so_jumlah, IFNULL(s.spk_jumlah, m.mspk_jumlah)) AS jumlah,
            IFNULL(so.so_sablon, IFNULL(s.spk_sablon, '-')) AS xsablon,
            IFNULL(so.so_sublim, IFNULL(s.spk_sublim, '-')) AS xsublim,
            IFNULL(so.so_bordir, IFNULL(s.spk_bordir, '-')) AS xbordir,
            DATE_FORMAT(
              IFNULL(so.so_tanggal, IFNULL(s.spk_tanggal, m.mspk_tanggal)), '%Y-%m-%d'
            ) AS tglspk,
            o.poi_jasa_kode, j.jasa_nama,
            c.pab_nama AS namacab, u.pab_nama AS namasup,
            DATE_FORMAT(a.promin_tanggal, '%Y-%m-%d') AS promin_tanggal_fmt,
            IFNULL(k.spkb_babaran, 0) AS bbrstd,
            IFNULL(bh.Bhn_Name, '') AS namakain,
            IFNULL(bh.Bhn_satuan, '') AS satkainmaster,
            IFNULL(pmd.promind_Jumlah, 0) AS jmlkainmaster
     FROM tpointernalsj_hdr h
     LEFT JOIN tpointernal_hdr o ON o.poi_nomor = h.poisj_nomorpo
     LEFT JOIN tsalesorder so ON so.so_nomor = h.poisj_spk_nomor
     LEFT JOIN tspk s ON s.spk_nomor = h.poisj_spk_nomor AND s.spk_aktif = 'Y'
     LEFT JOIN tmemospk m ON m.mspk_nomor = h.poisj_spk_nomor
     LEFT JOIN tjasa j ON j.jasa_kode = o.poi_jasa_kode
     LEFT JOIN tpabrik c ON c.pab_kode = h.poisj_cab
     LEFT JOIN tpabrik u ON u.pab_kode = o.poi_cab
     LEFT JOIN tproduksiminta_hdr a ON a.promin_nomor = h.poisj_nomaterial
     LEFT JOIN tproduksiminta_dtl pmd
       ON pmd.promind_promin_Nomor = h.poisj_nomaterial AND pmd.promind_bhn_kode = h.poisj_bhn_kode
     LEFT JOIN tspk_babaran k ON k.spkb_nomor = h.poisj_spk_nomor AND k.spkb_komponen = h.poisj_komponen
     LEFT JOIN tbahan bh ON bh.Bhn_kode = h.poisj_bhn_kode
     LEFT JOIN tgudangproduksi la ON la.gdgp_kode = h.poisj_gdgasal
     LEFT JOIN tgudangproduksi lt ON lt.gdgp_kode = h.poisj_gdgtujuan
     WHERE h.poisj_nomor = ?`,
    [nomor],
  );
  if (hdrRows.length === 0)
    throw new Error("Data Surat Jalan tidak ditemukan.");
  const h = hdrRows[0];

  const [poDtlRows] = await db.query(
    `SELECT i.poid_bhn_kode, n.Bhn_Name, n.Bhn_satuan, i.poid_size, i.poid_jumlah,
            IFNULL(d.poisjd_jumlah, 0) AS jmlsj,
            IFNULL(d.poisjd_bs, 0) AS bs,
            IFNULL(d.poisjd_sablon, 0) AS sablon,
            IFNULL(d.poisjd_kain, 0) AS kain,
            IFNULL(d.poisjd_koli, 0) AS koli,
            IFNULL(d.poisjd_ket, '') AS ket
     FROM tpointernal_dtl i
     LEFT JOIN tbahan n ON n.Bhn_kode = i.poid_bhn_kode
     LEFT JOIN tpointernalsj_dtl d
       ON d.poisjd_nomor = ? AND d.poisjd_bhn_kode = i.poid_bhn_kode AND d.poisjd_size = i.poid_size
     WHERE i.poid_nomor = ?
     ORDER BY i.poid_bhn_kode, i.poid_size`,
    [nomor, h.poisj_nomorpo],
  );

  const detail = [];
  for (const d of poDtlRows) {
    const sudahsj = await getSudahSj(
      nomor,
      h.poisj_nomorpo,
      d.poid_bhn_kode,
      d.poid_size,
    );
    detail.push({
      kode: d.poid_bhn_kode,
      nama: d.Bhn_Name,
      satuan: d.Bhn_satuan,
      size: d.poid_size,
      jumlahpo: Number(d.poid_jumlah) || 0,
      jumlah: Number(d.jmlsj) || 0,
      bs: Number(d.bs) || 0,
      sablon: Number(d.sablon) || 0,
      kain: Number(d.kain) || 0,
      koli: Number(d.koli) || 0,
      ket: d.ket || "",
      sudahsj,
      kurang: (Number(d.poid_jumlah) || 0) - sudahsj,
      new: false,
    });
  }

  const [newRows] = await db.query(
    `SELECT d.poisjd_bhn_kode, b.Bhn_Name, b.Bhn_satuan, d.poisjd_size, d.poisjd_jumlah,
            d.poisjd_bs, d.poisjd_sablon, d.poisjd_kain, d.poisjd_koli, d.poisjd_ket
     FROM tpointernalsj_dtl d
     LEFT JOIN tbahan b ON b.Bhn_kode = d.poisjd_bhn_kode
     WHERE d.poisjd_new = 'Y' AND d.poisjd_nomor = ?`,
    [nomor],
  );
  for (const r of newRows) {
    detail.push({
      kode: r.poisjd_bhn_kode,
      nama: r.Bhn_Name,
      satuan: r.Bhn_satuan,
      size: r.poisjd_size,
      jumlahpo: 0,
      jumlah: Number(r.poisjd_jumlah) || 0,
      bs: Number(r.poisjd_bs) || 0,
      sablon: Number(r.poisjd_sablon) || 0,
      kain: Number(r.poisjd_kain) || 0,
      koli: Number(r.poisjd_koli) || 0,
      ket: r.poisjd_ket || "",
      sudahsj: 0,
      kurang: 0,
      new: true,
    });
  }

  const pin5 = await getSjPin5Status(nomor, h.poisj_tanggal_fmt);

  return {
    header: {
      Nomor: h.poisj_nomor,
      Tanggal: h.poisj_tanggal_fmt,
      NomorPO: h.poisj_nomorpo,
      TanggalPO: h.poi_tanggal_fmt,
      DatelinePO: h.poi_dateline_fmt,
      NomorSPK: h.poisj_spk_nomor,
      NamaSPK: h.namaspk,
      Bahan: h.bahan,
      Ukuran: h.ukuran,
      Jumlah: h.jumlah,
      SpkTanggal: h.tglspk,
      CetakFlag: h.xsablon === "Y" || h.xsublim === "Y",
      BordirFlag: h.xbordir === "Y",
      JasaKode: h.poi_jasa_kode,
      JasaNama: h.jasa_nama,
      GudangAsalKode: h.poisj_cab,
      GudangAsalNama: h.namacab,
      GudangTujuanKode: h.poi_cab,
      GudangTujuanNama: h.namasup,
      LiniAsal: h.poisj_gdgasal,
      LiniAsalNama: h.liniasalnama || "",
      LiniTujuan: h.poisj_gdgtujuan,
      LiniTujuanNama: h.linitujuannama || "",
      JumlahJasa: Number(h.poisj_jumlah) || 0,
      Kelompok: h.poisj_kelompok,
      KelompokTujuan: h.poisj_kelompok_tujuan,
      Cmt: h.poisj_cmt === "Y",
      Keterangan: h.poisj_ket,
      SupKode: h.poisj_sup_kode,
      SupplierKain: h.poisj_supplierkain,
      NoMaterial: h.poisj_nomaterial,
      TanggalMinta: h.promin_tanggal_fmt,
      KodeKain: h.poisj_bhn_kode,
      NamaKain: h.namakain,
      SatKain: h.satkainmaster,
      JmlKain: Number(h.jmlkainmaster) || 0,
      QtyBerat: Number(h.poisj_qty_berat) || 0,
      SatBerat: h.poisj_sat_berat,
      Komponen: h.poisj_komponen,
      BabaranStd: Number(h.bbrstd) || 0,
      Alasan: h.poisj_alasan,
      adaGambar: checkGambarSpk(h.poisj_spk_nomor),
    },
    detail,
    pinStatus: pin5.status,
    pinUrut: pin5.urut,
  };
};

// ─────────────────────────────────────────────────────────
// REKALKULASI STATUS CLOSE PO INTERNAL — ⚠️ dipakai KHUSUS di form
// SJ ini (dijalankan SETIAP simpan, bukan cuma pas hapus). Rumusnya
// BEDA dari punya Browse PO Internal SPK (yang membatasi tiap baris
// max = qty PO row itu): di sini Delphi bandingin TOTAL polos tanpa
// pembatasan per baris. Direplikasi persis apa adanya walau kedua
// modul asli Delphi memang tidak konsisten satu sama lain.
// ─────────────────────────────────────────────────────────
const recalcPoCloseStatusSimple = async (conn, nomorPO) => {
  if (!nomorPO) return;
  const [[poRow]] = await conn.query(
    `SELECT IFNULL(SUM(poid_jumlah), 0) AS po FROM tpointernal_dtl WHERE poid_nomor = ?`,
    [nomorPO],
  );
  const totalPo = Number(poRow?.po) || 0;

  const [[sjRow]] = await conn.query(
    `SELECT IFNULL(SUM(d.poisjd_jumlah), 0) AS sj
     FROM tpointernalsj_dtl d
     INNER JOIN tpointernalsj_hdr h ON h.poisj_nomor = d.poisjd_nomor
     WHERE h.poisj_nomorpo = ?`,
    [nomorPO],
  );
  const totalSj = Number(sjRow?.sj) || 0;

  const closeStatus = totalSj >= totalPo ? "Y" : "N";
  await conn.query(
    `UPDATE tpointernal_hdr SET poi_close = ? WHERE poi_nomor = ?`,
    [closeStatus, nomorPO],
  );
};

// ─────────────────────────────────────────────────────────
// SAVE — replikasi simpandata() + seluruh validasi F10.
// ─────────────────────────────────────────────────────────
const saveData = async (payload, user) => {
  const {
    nomor: nomorPayload,
    tanggal,
    nomorPO,
    nomorSpk,
    gdgAsal,
    liniAsal,
    liniTujuan,
    jumlahJasa,
    kelompok,
    kelompokTujuan,
    cmt,
    keterangan,
    supKode,
    supplierKain,
    noMaterial,
    kodeKain,
    qtyBerat,
    satBerat,
    komponen,
    alasan,
    jmlKain,
    lhkSudahPakai,
    detail = [],
    xminta5 = "",
    xurut5 = 0,
  } = payload;

  const isEdit = !!nomorPayload;

  // ── 1. Gate PIN5 / tutup buku ──
  const tutupBuku = await cekTutupBuku(tanggal, xminta5);
  if (!tutupBuku.boleh) throw new Error(tutupBuku.message);

  // ── 2. Validasi cutoff identifikasi komponen (⚠️ tanggal
  // 01-12-2024 hardcode persis sesuai Delphi) ──
  const CUTOFF_IDENTIFIKASI = new Date("2024-12-01");
  const [spkInfoRows] = await db.query(
    `SELECT * FROM (
       SELECT spk_tanggal AS tgl, spk_sablon AS sablon, spk_sublim AS sublim, spk_bordir AS bordir
       FROM tspk WHERE spk_nomor = ? AND spk_aktif = 'Y'
       UNION ALL
       SELECT so_tanggal, so_sablon, so_sublim, so_bordir
       FROM tsalesorder WHERE so_nomor = ? AND so_aktif = 'Y'
       UNION ALL
       SELECT mspk_tanggal, '-', '-', '-' FROM tmemospk WHERE mspk_nomor = ?
     ) x LIMIT 1`,
    [nomorSpk, nomorSpk, nomorSpk],
  );
  const spkTanggal = spkInfoRows[0]?.tgl ? new Date(spkInfoRows[0].tgl) : null;
  const cetakFlag =
    spkInfoRows[0]?.sablon === "Y" || spkInfoRows[0]?.sublim === "Y";
  const bordirFlag = spkInfoRows[0]?.bordir === "Y";

  if (spkTanggal && spkTanggal >= CUTOFF_IDENTIFIKASI) {
    if (
      liniAsal === "GP001" &&
      !(await cekKomponenIdentifikasi(nomorSpk, "POTONG"))
    ) {
      throw new Error("Komponen cutting belum di identifikasi pada SPK tsb.");
    }
    if (
      cetakFlag &&
      liniAsal === "GP002" &&
      !(await cekKomponenIdentifikasi(nomorSpk, "CETAK"))
    ) {
      throw new Error("Komponen cetak belum di identifikasi pada SPK tsb.");
    }
    if (
      bordirFlag &&
      liniAsal === "GP014" &&
      !(await cekKomponenIdentifikasi(nomorSpk, "BORDIR"))
    ) {
      throw new Error("Komponen bordir belum di identifikasi pada SPK tsb.");
    }
  }

  // ── 3. Validasi F10 lainnya ──
  const todayStr = new Date().toISOString().substring(0, 10);
  if (tanggal > todayStr) throw new Error("Tanggal SJ tidak boleh maju.");
  if (!nomorPO?.trim()) throw new Error("Nomor PO belum di isi.");
  if (!liniAsal?.trim()) throw new Error("Lini Asal harus di isi.");
  if (!liniTujuan?.trim()) throw new Error("Lini Tujuan harus di isi.");

  if (liniAsal === "GP001" || liniAsal === "GP015") {
    if (!noMaterial?.trim()) {
      throw new Error("Nomor Permintaan Material harus di isi.");
    }
    const k = Number(jmlKain) || 0;
    const b = Number(qtyBerat) || 0;
    const j = Number(jumlahJasa) || 0;
    const l = Number(lhkSudahPakai) || 0;

    if (j < 0) throw new Error("Jumlah tidak boleh minus.");
    if (b === 0) {
      throw new Error(
        "Babaran tidak boleh kosong.\nCek jumlah dan berat kain!",
      );
    }
    if (b + l > k + 0.01) {
      throw new Error("Berat kain melebihi Jumlah kain.");
    }

    // Rekalkulasi babaran & selisih SERVER-SIDE (jangan percaya nilai
    // tampilan client) — replikasi hitung() Delphi persis.
    const babaranStd = await getBabaranStandar(nomorSpk, komponen);
    let babaran = 0;
    if (j !== 0 && b !== 0) {
      babaran = satBerat === "KG" ? j / b : b / j;
    }
    const selisihBabaran =
      babaranStd === 0 || babaran === 0 ? 0 : babaran - babaranStd;

    if (selisihBabaran < 0 && !alasan?.trim()) {
      throw new Error("Babaran < Babaran standart.\nAlasan harus diisi.");
    }
  }

  const validDetail = detail.filter((d) => d.kode);
  const totalJumlah = validDetail.reduce(
    (s, d) => s + (Number(d.jumlah) || 0),
    0,
  );
  if (totalJumlah === 0) {
    throw new Error("Jumlahnya kosong semua.\nBelum bisa disimpan.");
  }

  // ── 4. Simpan (transaksi) ──
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    let nomor = nomorPayload;
    const dateNow = new Date().toISOString().slice(0, 19).replace("T", " ");
    const ccmt = cmt ? "Y" : "N";

    if (isEdit) {
      await conn.query(
        `UPDATE tpointernalsj_hdr SET
           poisj_tanggal = ?, poisj_nomorpo = ?, poisj_spk_nomor = ?,
           poisj_cab = ?, poisj_gdgasal = ?, poisj_gdgtujuan = ?,
           poisj_jumlah = ?, poisj_kelompok = ?, poisj_kelompok_tujuan = ?,
           poisj_cmt = ?, poisj_ket = ?,
           poisj_sup_kode = ?, poisj_supplierkain = ?, poisj_nomaterial = ?,
           poisj_bhn_kode = ?, poisj_qty_berat = ?, poisj_sat_berat = ?,
           poisj_komponen = ?, poisj_alasan = ?,
           date_modified = ?, user_modified = ?
         WHERE poisj_nomor = ?`,
        [
          tanggal,
          nomorPO,
          nomorSpk,
          gdgAsal,
          liniAsal,
          liniTujuan,
          Number(jumlahJasa) || 0,
          kelompok || "",
          kelompokTujuan || "",
          ccmt,
          keterangan || "",
          supKode || "",
          supplierKain || "",
          noMaterial || "",
          kodeKain || "",
          Number(qtyBerat) || 0,
          satBerat || "",
          komponen || "",
          alasan || "",
          dateNow,
          user.kode,
          nomor,
        ],
      );
    } else {
      nomor = await generateNomor(tanggal, conn);
      await conn.query(
        `INSERT INTO tpointernalsj_hdr
           (poisj_nomor, poisj_tanggal, poisj_nomorpo, poisj_spk_nomor,
            poisj_cab, poisj_gdgasal, poisj_gdgtujuan, poisj_jumlah,
            poisj_kelompok, poisj_kelompok_tujuan, poisj_cmt, poisj_ket,
            poisj_sup_kode, poisj_supplierkain, poisj_nomaterial,
            poisj_bhn_kode, poisj_qty_berat, poisj_sat_berat,
            poisj_komponen, poisj_alasan, date_create, user_create)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          nomor,
          tanggal,
          nomorPO,
          nomorSpk,
          gdgAsal,
          liniAsal,
          liniTujuan,
          Number(jumlahJasa) || 0,
          kelompok || "",
          kelompokTujuan || "",
          ccmt,
          keterangan || "",
          supKode || "",
          supplierKain || "",
          noMaterial || "",
          kodeKain || "",
          Number(qtyBerat) || 0,
          satBerat || "",
          komponen || "",
          alasan || "",
          dateNow,
          user.kode,
        ],
      );
    }

    await conn.query(`DELETE FROM tpointernalsj_dtl WHERE POisjD_nomor = ?`, [
      nomor,
    ]);

    for (const d of validDetail) {
      const jTotal =
        (Number(d.jumlah) || 0) +
        (Number(d.bs) || 0) +
        (Number(d.sablon) || 0) +
        (Number(d.kain) || 0);
      if (jTotal === 0) continue; // replikasi persis: baris cuma disimpan kalau totalnya <>0

      await conn.query(
        `INSERT INTO tpointernalsj_dtl
           (poisjd_nomor, poisjd_bhn_kode, poisjd_size, poisjd_jumlah,
            poisjd_bs, poisjd_sablon, poisjd_kain, poisjd_koli, poisjd_new, poisjd_ket)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          nomor,
          d.kode,
          d.size || "",
          Number(d.jumlah) || 0,
          Number(d.bs) || 0,
          Number(d.sablon) || 0,
          Number(d.kain) || 0,
          Number(d.koli) || 0,
          d.new ? "Y" : "N",
          d.ket || "",
        ],
      );
    }

    if (xminta5 === "ACC" && xurut5) {
      await conn.query(
        `UPDATE tspk_pin5 SET pin_dipakai = 'Y'
         WHERE pin_trs = 'SJ POINTERNAL' AND pin_nomor = ? AND pin_urut = ?`,
        [nomor, xurut5],
      );
    }

    await recalcPoCloseStatusSimple(conn, nomorPO);

    await conn.commit();
    return { nomor };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
};

// ─────────────────────────────────────────────────────────
// GET DATA CETAK — replikasi cetak().
// ─────────────────────────────────────────────────────────
const getPrintData = async (nomor, currentUser) => {
  const [rows] = await db.query(
    `SELECT h.poisj_nomor, DATE_FORMAT(h.poisj_tanggal,'%Y-%m-%d') AS poisj_tanggal,
            h.poisj_nomorpo,
            DATE_FORMAT(o.poi_tanggal,'%Y-%m-%d') AS poi_tanggal,
            DATE_FORMAT(o.poi_dateline,'%Y-%m-%d') AS poi_dateline,
            h.poisj_spk_nomor,
            IFNULL(so.so_nama, IFNULL(s.spk_nama, m.mspk_nama)) AS namaspk,
            IFNULL(so.so_kain, IFNULL(s.spk_kain, m.mspk_kain)) AS bahan,
            IFNULL(so.so_ukuran, IFNULL(s.spk_ukuran, m.mspk_ukuran)) AS ukuran,
            IFNULL(so.so_jumlah, IFNULL(s.spk_jumlah, m.mspk_jumlah)) AS jumlah,
            o.poi_jasa_kode, j.jasa_nama,
            h.poisj_cab, c.pab_nama AS namacab,
            o.poi_cab, u.pab_nama AS namacus,
            h.poisj_ket,
            d.poisjd_bhn_kode, b.Bhn_Name, b.Bhn_satuan, d.poisjd_size, d.poisjd_jumlah,
            d.poisjd_bs, d.poisjd_sablon, d.poisjd_kain, d.poisjd_koli, d.poisjd_ket
     FROM tpointernalsj_hdr h
     LEFT JOIN tpointernalsj_dtl d ON d.poisjd_nomor = h.poisj_nomor
     LEFT JOIN tpointernal_hdr o ON o.poi_nomor = h.poisj_nomorpo
     LEFT JOIN tsalesorder so ON so.so_nomor = h.poisj_spk_nomor
     LEFT JOIN tspk s ON s.spk_nomor = h.poisj_spk_nomor AND s.spk_aktif = 'Y'
     LEFT JOIN tmemospk m ON m.mspk_nomor = h.poisj_spk_nomor
     LEFT JOIN tjasa j ON j.jasa_kode = o.poi_jasa_kode
     LEFT JOIN tpabrik c ON c.pab_kode = h.poisj_cab
     LEFT JOIN tpabrik u ON u.pab_kode = o.poi_cab
     LEFT JOIN tbahan b ON b.Bhn_kode = d.poisjd_bhn_kode
     WHERE h.poisj_nomor = ?`,
    [nomor],
  );
  if (rows.length === 0) throw new Error("Data cetak tidak ditemukan.");

  const header = {
    Nomor: rows[0].poisj_nomor,
    Tanggal: rows[0].poisj_tanggal,
    NomorPO: rows[0].poisj_nomorpo,
    TanggalPO: rows[0].poi_tanggal,
    DatelinePO: rows[0].poi_dateline,
    NomorSPK: rows[0].poisj_spk_nomor,
    NamaSpk: rows[0].namaspk,
    Bahan: rows[0].bahan,
    Ukuran: rows[0].ukuran,
    JumlahSpk: rows[0].jumlah,
    JasaKode: rows[0].poi_jasa_kode,
    JasaNama: rows[0].jasa_nama,
    Cab: rows[0].poisj_cab,
    NamaCab: rows[0].namacab,
    Tujuan: rows[0].poi_cab,
    NamaTujuan: rows[0].namacus,
    Keterangan: rows[0].poisj_ket,
    Foto: checkGambarSpk(rows[0].poisj_spk_nomor) ? "YA" : "",
    // ⚠️ Replikasi persis Delphi: "usr" = user yang SEDANG login pas
    // cetak (frmmenu.KDUSER), BUKAN kolom user_create tersimpan di DB.
    Usr: currentUser || "",
  };

  const detail = rows
    .filter((r) => r.poisjd_bhn_kode)
    .map((r) => ({
      Kode: r.poisjd_bhn_kode,
      Nama: r.Bhn_Name,
      Satuan: r.Bhn_satuan,
      Size: r.poisjd_size,
      Jumlah: r.poisjd_jumlah,
      BsLini: r.poisjd_bs,
      BsSablon: r.poisjd_sablon,
      BsKain: r.poisjd_kain,
      Koli: r.poisjd_koli,
      Keterangan: r.poisjd_ket,
    }));

  return { header, detail };
};

module.exports = {
  checkPO,
  checkSpk,
  checkNoMaterial,
  checkGudangProduksi,
  getKomponenOptions,
  getKelompokOptions,
  getBabaranStandar,
  getKelompokTujuanOptions,
  checkSupplier,
  loadBahan,
  getById,
  saveData,
  getPrintData,
};
