const db = require("../../../config/database");
const {
  galat,
  teks,
  norm,
  parseTanggal,
  adalahSuperadmin,
  cabangUser,
  bolehPotongStok,
} = require("./lhkCommon");
const {
  T,
  sqlLewatBatas,
  cekTutupBuku,
  pastikanLhkDiCabang,
  pastikanPabrik,
  pastikanTintaBelumDikunciProof,
} = require("./lhkTintaShared");
const { KODE_OBAT_PROOF } = require("./lhkProofResep");

const PREFIX_NOMOR = "LHK-T";
const NOMOR_LOCK = "lhk_tinta_nomor";
const MAKS_QTY = 9999999999.9999; // decimal(14,4)
const MAKS_LOKASI_STOK = 3; // mst_cab char(3)

// Master obat = tgarmen_brg jenis OBAT kategori SPANDUK
const JENIS_OBAT = "OBAT";
const KTG_SPANDUK = "SPANDUK";

// Sama dengan LHK Proof: total dalam satuan master (KG atau LITER);
// 1 ons = 0,1 dan 1 gram = 0,001
const FAKTOR_ONS = 0.1;
const FAKTOR_GRAM = 0.001;

const upper = (v) =>
  String(v ?? "")
    .trim()
    .toUpperCase();
const round4 = (n) => Math.round(n * 10000) / 10000;

// --- util ---
// Kosong dianggap 0; maks 4 desimal
const angkaInput = (v, label) => {
  const s = teks(v);
  if (s === "") {
    return 0;
  }
  if (!/^\d+(\.\d{1,4})?$/.test(s)) {
    throw galat(
      `${label} harus angka 0 atau lebih (maks 4 desimal, desimal pakai titik)`,
    );
  }
  return Number(s);
};

// Lokasi dikunci ke cabang user (kecuali superadmin)
const pastikanLokasiUser = (pabrik, user) => {
  if (adalahSuperadmin(user)) {
    return;
  }
  const cab = cabangUser(user);
  if (norm(pabrik) !== cab) {
    throw galat(`Lokasi harus sesuai cabang Anda (${cab})`, "forbidden");
  }
};

// mst_cab char(3): kode lokasi lebih panjang membuat trigger stok gagal
const pastikanLokasiStok = (pabrik, potongStok) => {
  if (potongStok && pabrik.length > MAKS_LOKASI_STOK) {
    throw galat(
      `Kode lokasi maksimal ${MAKS_LOKASI_STOK} karakter bila ada pemakaian obat`,
    );
  }
};

// Urutan baris mengikuti daftar tetap
const urutDaftar = (kode) => {
  const i = KODE_OBAT_PROOF.indexOf(kode);
  return i < 0 ? KODE_OBAT_PROOF.length : i;
};

// --- validasi payload ---
// Body: { Tanggal, Kode_Pabrik, Nomor_Cetak,
//         Bahan: [{ Kode_Bahan, Kg, Ons, Gram }] }
const siapkanData = (body = {}) => {
  const tanggal = parseTanggal(body.Tanggal);

  const pabrik = teks(body.Kode_Pabrik);
  if (!pabrik) {
    throw galat("Lokasi wajib diisi");
  }
  if (pabrik.length > 10) {
    throw galat("Kode lokasi maksimal 10 karakter");
  }

  const nomorCetak = teks(body.Nomor_Cetak);
  if (!nomorCetak) {
    throw galat("Nomor LHK Cetak wajib diisi");
  }
  if (nomorCetak.length > 20) {
    throw galat("Nomor LHK Cetak maksimal 20 karakter");
  }

  const daftar = Array.isArray(body.Bahan) ? body.Bahan : [];
  if (daftar.length === 0) {
    throw galat("Minimal satu pemakaian obat harus diisi");
  }

  const sudah = new Set();
  const bahan = daftar
    .map((t, i) => {
      const label = `Bahan ${i + 1}`;
      const kode = upper(t?.Kode_Bahan);
      if (!kode) {
        throw galat(`${label}: bahan wajib dipilih`);
      }
      if (kode.length > 20) {
        throw galat(`${label}: kode bahan maksimal 20 karakter`);
      }
      if (sudah.has(kode)) {
        throw galat(`${label}: bahan ${kode} sudah ada di daftar`);
      }
      sudah.add(kode);
      const qty = round4(
        angkaInput(t?.Kg, `${label}: KG/LTR`) +
          angkaInput(t?.Ons, `${label}: Ons`) * FAKTOR_ONS +
          angkaInput(t?.Gram, `${label}: Gram`) * FAKTOR_GRAM,
      );
      if (qty > MAKS_QTY) {
        throw galat(`${label}: jumlah terlalu besar`);
      }
      return { kode, qty };
    })
    .filter((b) => b.qty > 0); // baris kosong dibuang, seperti LHK Proof

  if (bahan.length === 0) {
    throw galat("Minimal satu pemakaian obat harus diisi");
  }
  return { tanggal, pabrik, nomorCetak, bahan };
};

// LHK Cetak harus ada, milik cabang user, selokasi, dan tidak lebih baru dari
// tanggal Tinta. LHK Tinta baru ditolak bila LHK Cetak-nya pasif (menunggu
// atau ditolak approval); LHK Tinta yang sudah ada tetap bisa diubah.
// [KONFIRMASI] aturan pasif = default Claude 9 Nov (PRD #169).
const pastikanCetak = async (q, data, user, baru = false) => {
  const [rows] = await q.query(
    `SELECT DATE_FORMAT(lch_tanggal, '%Y-%m-%d') AS tgl,
            lch_pab_kode AS pabrik,
            lch_apv_status AS apv
     FROM ${T.cetakHdr} WHERE lch_nomor = ?`,
    [data.nomorCetak],
  );
  if (rows.length === 0) {
    throw galat(`LHK Cetak ${data.nomorCetak} tidak ditemukan`);
  }
  const c = rows[0];
  if (!adalahSuperadmin(user) && norm(c.pabrik) !== cabangUser(user)) {
    throw galat("LHK Cetak ini bukan milik cabang Anda", "forbidden");
  }
  if (norm(c.pabrik) !== norm(data.pabrik)) {
    throw galat(`Lokasi harus sama dengan lokasi LHK Cetak (${c.pabrik})`);
  }
  if (c.tgl && data.tanggal < c.tgl) {
    throw galat(
      `Tanggal tidak boleh lebih awal dari tanggal LHK Cetak (${c.tgl})`,
    );
  }
  if (baru && !["", "Y"].includes(String(c.apv ?? "").trim())) {
    throw galat(
      `LHK Cetak ${data.nomorCetak} belum disetujui (menunggu atau ditolak approval)`,
    );
  }
};

// Master per kode, semua jenis (untuk mendeteksi kode ganda antar jenis)
const bacaMaster = async (q, daftarKode) => {
  const peta = new Map();
  if (daftarKode.length === 0) {
    return peta;
  }
  const [rows] = await q.query(
    `SELECT brg_kode, brg_nama, brg_satuan, brg_aktif, brg_ktg, brg_jenis
     FROM ${T.garmenBrg} WHERE brg_kode IN (?)`,
    [daftarKode],
  );
  for (const r of rows) {
    const k = upper(r.brg_kode);
    peta.set(k, [...(peta.get(k) ?? []), r]);
  }
  return peta;
};

// Stok per Lokasi; pemakaian LHK itu sendiri (nomor) dikecualikan supaya
// peringatan stok kurang tidak menghitungnya dua kali. null bila lokasi kosong.
const ambilStok = async (q, daftarKode, cab, nomor) => {
  if (!cab || daftarKode.length === 0) {
    return null;
  }
  const [rows] = await q.query(
    `SELECT mst_brg_kode AS kode,
            SUM(IFNULL(mst_stok_in, 0) - IFNULL(mst_stok_out, 0)) AS stok
     FROM ${T.stokObat}
     WHERE mst_aktif = 'Y' AND mst_cab = ? AND mst_brg_kode IN (?)
       AND IFNULL(mst_noreferensi, '') <> ?
     GROUP BY mst_brg_kode`,
    [cab, daftarKode, teks(nomor)],
  );
  return new Map(rows.map((r) => [upper(r.kode), Number(r.stok) || 0]));
};

// Obat harus di daftar tetap, tunggal di master, jenis OBAT kategori SPANDUK,
// dan aktif. Obat yang sudah tercatat di LHK ini (sudahAda) tetap boleh walau
// belakangan dinonaktifkan atau keluar dari daftar. Hasil: baris siap simpan.
const validasiBahan = async (q, bahan, sudahAda = new Set()) => {
  const master = await bacaMaster(
    q,
    bahan.map((b) => b.kode),
  );

  return bahan
    .map((b, i) => {
      const label = `Bahan ${i + 1}`;
      if (!KODE_OBAT_PROOF.includes(b.kode) && !sudahAda.has(b.kode)) {
        throw galat(
          `${label}: bahan ${b.kode} tidak ada dalam daftar pemakaian obat`,
        );
      }
      const baris = master.get(b.kode) ?? [];
      if (baris.length === 0) {
        throw galat(`${label}: ${b.kode} tidak ada di master barang`);
      }
      if (baris.length > 1) {
        throw galat(
          `${label}: kode ${b.kode} ada di lebih dari satu jenis barang, hubungi admin master`,
        );
      }
      const m = baris[0];
      if (
        upper(m.brg_jenis) !== JENIS_OBAT ||
        upper(m.brg_ktg) !== KTG_SPANDUK
      ) {
        throw galat(`${label}: ${b.kode} bukan obat spanduk`);
      }
      if (upper(m.brg_aktif) !== "Y" && !sudahAda.has(b.kode)) {
        throw galat(`${label}: bahan ${b.kode} sudah tidak aktif`);
      }
      return {
        kode: b.kode,
        qty: b.qty,
        satuan: String(m.brg_satuan ?? "").trim() || null,
      };
    })
    .sort((a, b) => urutDaftar(a.kode) - urutDaftar(b.kode));
};

// Hapus lalu isi ulang. Trigger membalik stok saat DELETE dan memotong saat
// INSERT, jadi header harus sudah ditulis/di-update sebelum fungsi ini.
// ltb_qty_input/ltb_satuan_input tidak dipakai lagi (input = KG/Ons/Gram),
// diisi salinan total dan satuan master supaya kolom lama tetap valid.
const simpanBahan = async (conn, nomor, hasil, potongStok) => {
  await conn.query(`DELETE FROM ${T.bahan} WHERE ltb_lnt_nomor = ?`, [nomor]);
  await conn.query(
    `INSERT INTO ${T.bahan}
       (ltb_lnt_nomor, ltb_brg_kode, ltb_qty_input, ltb_satuan_input,
        ltb_qty, ltb_satuan, ltb_nourut, ltb_potong_stok)
     VALUES ?`,
    [
      hasil.map((h, i) => [
        nomor,
        h.kode,
        h.qty,
        h.satuan ?? "",
        h.qty,
        h.satuan,
        i + 1,
        potongStok ? 1 : 0,
      ]),
    ],
  );
};

// LHK-T.yymm.NNNN, dipanggil di dalam lock + transaksi
const buatNomor = async (conn, tanggalStr) => {
  const yymm = tanggalStr.slice(2, 4) + tanggalStr.slice(5, 7);
  const prefix = `${PREFIX_NOMOR}.${yymm}.`;
  const [rows] = await conn.query(
    `SELECT MAX(CAST(RIGHT(lnt_nomor, 4) AS UNSIGNED)) AS mx
     FROM ${T.hdr} WHERE lnt_nomor LIKE ?`,
    [`${prefix}%`],
  );
  const next = (Number(rows[0]?.mx) || 0) + 1;
  if (next > 9999) {
    throw galat("Nomor LHK bulan ini sudah mencapai batas (9999)");
  }
  return `${prefix}${String(next).padStart(4, "0")}`;
};

// SPK/MAP di dalam satu LHK Cetak (read-only di form Tinta)
const ambilDetailCetak = async (q, nomorCetak) => {
  const [rows] = await q.query(
    `SELECT d.lcd_spk_nomor AS Nomor_SPK,
            x.spk_nama AS Nama_SPK,
            x.spk_jumlah AS Jumlah_Order,
            x.spk_panjang AS Panjang,
            x.spk_lebar AS Lebar
     FROM ${T.cetakDtl} d
     LEFT JOIN (
       SELECT spk_nomor, spk_nama, spk_jumlah,
              IFNULL(spk_panjang, 0) AS spk_panjang,
              IFNULL(spk_lebar, 0) AS spk_lebar
       FROM ${T.spk}
       UNION ALL
       SELECT mspk_nomor, mspk_nama, mspk_jumlah,
              IFNULL(mspk_panjang, 0), IFNULL(mspk_lebar, 0)
       FROM ${T.memoSpk}
     ) x ON x.spk_nomor = d.lcd_spk_nomor
     WHERE d.lcd_lch_nomor = ?
     ORDER BY d.lcd_spk_nomor`,
    [nomorCetak],
  );
  return rows;
};

// --- LOAD ---
const getLhkTintaById = async (nomor, user) => {
  const no = teks(nomor);
  const [hdr] = await db.query(
    `SELECT h.lnt_nomor AS Nomor,
            DATE_FORMAT(h.lnt_tanggal, '%Y-%m-%d') AS Tanggal,
            h.lnt_pab_kode AS Kode_Pabrik,
            p.pab_nama AS Nama_Pabrik,
            h.lnt_lch_nomor AS Nomor_Cetak,
            DATE_FORMAT(c.lch_tanggal, '%Y-%m-%d') AS Tanggal_Cetak
     FROM ${T.hdr} h
     LEFT JOIN ${T.pabrik} p ON p.pab_kode = h.lnt_pab_kode
     LEFT JOIN ${T.cetakHdr} c ON c.lch_nomor = h.lnt_lch_nomor
     WHERE h.lnt_nomor = ?`,
    [no],
  );
  if (hdr.length === 0) {
    throw galat("Data LHK Tinta tidak ditemukan", "notFound");
  }
  await pastikanLhkDiCabang(db, no, user);

  const Detail = await ambilDetailCetak(db, hdr[0].Nomor_Cetak);

  // Nama jatuh ke kode bila master tak ketemu (LHK lama sebelum remap)
  const [bahan] = await db.query(
    `SELECT b.ltb_brg_kode AS Kode_Bahan,
            IFNULL(m.brg_nama, b.ltb_brg_kode) AS Nama_Bahan,
            IFNULL(b.ltb_satuan, m.brg_satuan) AS Satuan,
            b.ltb_qty AS Qty
     FROM ${T.bahan} b
     LEFT JOIN ${T.garmenBrg} m
       ON m.brg_kode = b.ltb_brg_kode AND m.brg_jenis = '${JENIS_OBAT}'
     WHERE b.ltb_lnt_nomor = ?
     ORDER BY b.ltb_nourut`,
    [no],
  );

  return {
    ...hdr[0],
    Detail,
    Bahan: bahan.map((r) => ({
      Kode_Bahan: upper(r.Kode_Bahan),
      Nama_Bahan: String(r.Nama_Bahan ?? "").trim(),
      Satuan: r.Satuan,
      Qty: Number(r.Qty),
    })),
  };
};

// --- Info LHK Cetak untuk mengisi form (SPK/MAP di dalamnya) ---
// Lewat_Batas = hari ini sudah lewat h+7 dari tanggal LHK Cetak (hanya penanda)
const getInfoCetak = async (nomor, user) => {
  const no = teks(nomor);
  const [rows] = await db.query(
    `SELECT c.lch_nomor AS Nomor,
            DATE_FORMAT(c.lch_tanggal, '%Y-%m-%d') AS Tanggal,
            c.lch_pab_kode AS Kode_Pabrik,
            p.pab_nama AS Nama_Pabrik,
            c.lch_apv_status AS Apv_Status,
            ${sqlLewatBatas("c")} AS Lewat_Batas
     FROM ${T.cetakHdr} c
     LEFT JOIN ${T.pabrik} p ON p.pab_kode = c.lch_pab_kode
     WHERE c.lch_nomor = ?`,
    [no],
  );
  if (rows.length === 0) {
    throw galat(`LHK Cetak ${no} tidak ditemukan`, "notFound");
  }
  if (
    !adalahSuperadmin(user) &&
    norm(rows[0].Kode_Pabrik) !== cabangUser(user)
  ) {
    throw galat("LHK Cetak ini bukan milik cabang Anda", "forbidden");
  }
  return {
    ...rows[0],
    Lewat_Batas: Number(rows[0].Lewat_Batas),
    Detail: await ambilDetailCetak(db, no),
  };
};

// --- Lookup LHK Cetak berhalaman (non-superadmin hanya cabangnya sendiri) ---
// LHK Cetak pasif tidak ditawarkan ([KONFIRMASI], lihat pastikanCetak)
const getLookupCetak = async (keyword, page, limit, user) => {
  const kata = teks(keyword);
  const limitNum = Math.min(Math.max(Math.floor(Number(limit)) || 50, 1), 100);
  const halaman = Math.max(Math.floor(Number(page)) || 1, 1);
  const offset = (halaman - 1) * limitNum;

  const kondisi = ["c.lch_apv_status IN ('', 'Y')"];
  const params = [];
  if (kata) {
    kondisi.push(
      `(c.lch_nomor LIKE ? OR EXISTS (
         SELECT 1 FROM ${T.cetakDtl} x
         WHERE x.lcd_lch_nomor = c.lch_nomor AND x.lcd_spk_nomor LIKE ?))`,
    );
    params.push(`%${kata}%`, `%${kata}%`);
  }
  if (!adalahSuperadmin(user)) {
    kondisi.push("c.lch_pab_kode = ?");
    params.push(cabangUser(user));
  }
  const where = `WHERE ${kondisi.join(" AND ")}`;

  const [hitung] = await db.query(
    `SELECT COUNT(*) AS total FROM ${T.cetakHdr} c ${where}`,
    params,
  );

  const [rows] = await db.query(
    `SELECT c.lch_nomor AS Nomor,
            DATE_FORMAT(c.lch_tanggal, '%Y-%m-%d') AS Tanggal,
            c.lch_pab_kode AS Kode_Pabrik,
            (SELECT COUNT(*) FROM ${T.cetakDtl} d
              WHERE d.lcd_lch_nomor = c.lch_nomor) AS Jml_SPK,
            (SELECT GROUP_CONCAT(d.lcd_spk_nomor ORDER BY d.lcd_spk_nomor
                                 SEPARATOR ', ')
               FROM ${T.cetakDtl} d
              WHERE d.lcd_lch_nomor = c.lch_nomor) AS Daftar_SPK
     FROM ${T.cetakHdr} c
     ${where}
     ORDER BY c.lch_tanggal DESC, c.lch_nomor DESC
     LIMIT ? OFFSET ?`,
    [...params, limitNum, offset],
  );
  return { items: rows, total: Number(hitung[0].total) };
};

// --- Lookup pabrik (non-superadmin hanya cabangnya sendiri) ---
const getLookupPabrik = async (search, user) => {
  const kata = teks(search);
  const kondisi = [];
  const params = [];
  if (kata) {
    kondisi.push("(pab_kode LIKE ? OR pab_nama LIKE ?)");
    params.push(`%${kata}%`, `%${kata}%`);
  }
  if (!adalahSuperadmin(user)) {
    kondisi.push("pab_kode = ?");
    params.push(cabangUser(user));
  }
  const where = kondisi.length ? `WHERE ${kondisi.join(" AND ")}` : "";
  const [rows] = await db.query(
    `SELECT pab_kode AS Kode, pab_nama AS Nama
     FROM ${T.pabrik} ${where}
     ORDER BY pab_kode`,
    params,
  );
  return rows;
};

// --- Daftar obat = baris default form: daftar tetap KODE_OBAT_PROOF (sama
// dengan LHK Proof), hanya yang aktif dan tunggal di master. Stok per Lokasi
// (non-superadmin dipaksa cabangnya sendiri); null bila lokasi kosong.
const getLookupBahan = async (user, pabrik, nomor) => {
  const cab = adalahSuperadmin(user) ? upper(pabrik) : cabangUser(user);
  const master = await bacaMaster(db, KODE_OBAT_PROOF);
  const stok = await ambilStok(db, KODE_OBAT_PROOF, cab, nomor);

  return KODE_OBAT_PROOF.flatMap((kode) => {
    const baris = master.get(kode) ?? [];
    if (baris.length !== 1) {
      return [];
    }
    const m = baris[0];
    if (
      upper(m.brg_jenis) !== JENIS_OBAT ||
      upper(m.brg_ktg) !== KTG_SPANDUK ||
      upper(m.brg_aktif) !== "Y"
    ) {
      return [];
    }
    return [
      {
        Kode: kode,
        Nama: String(m.brg_nama ?? "").trim(),
        Satuan: String(m.brg_satuan ?? "").trim(),
        Stok: stok ? (stok.get(kode) ?? 0) : null,
      },
    ];
  });
};

// --- CREATE ---
const createLhkTinta = async (body, user) => {
  const data = siapkanData(body);
  pastikanLokasiUser(data.pabrik, user);
  await cekTutupBuku(data.tanggal);
  const potongStok = bolehPotongStok(data.tanggal, false);
  pastikanLokasiStok(data.pabrik, potongStok);

  const conn = await db.getConnection();
  let lockDiambil = false;
  try {
    const [lock] = await conn.query("SELECT GET_LOCK(?, 10) AS ok", [
      NOMOR_LOCK,
    ]);
    if (Number(lock[0].ok) !== 1) {
      throw galat("Sistem sedang membuat nomor LHK lain, coba lagi sebentar");
    }
    lockDiambil = true;

    await conn.beginTransaction();
    await pastikanPabrik(conn, data.pabrik);
    await pastikanCetak(conn, data, user, true);
    const hasil = await validasiBahan(conn, data.bahan);

    const nomor = await buatNomor(conn, data.tanggal);
    await conn.query(
      `INSERT INTO ${T.hdr}
         (lnt_nomor, lnt_tanggal, lnt_pab_kode, lnt_lch_nomor,
          lnt_date_create, lnt_user_create)
       VALUES (?, ?, ?, ?, CURDATE(), ?)`,
      [nomor, data.tanggal, data.pabrik, data.nomorCetak, user?.kode ?? null],
    );
    await simpanBahan(conn, nomor, hasil, potongStok);

    await conn.commit();
    return nomor;
  } catch (e) {
    await conn.rollback().catch(() => {});
    throw e;
  } finally {
    if (lockDiambil) {
      await conn.query("SELECT RELEASE_LOCK(?)", [NOMOR_LOCK]).catch(() => {});
    }
    conn.release();
  }
};

// --- UPDATE ---
const updateLhkTinta = async (nomor, body, user) => {
  const no = teks(nomor);
  const data = siapkanData(body);
  pastikanLokasiUser(data.pabrik, user);

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [lama] = await conn.query(
      `SELECT DATE_FORMAT(lnt_tanggal, '%Y-%m-%d') AS tgl,
              lnt_lch_nomor AS cetak
       FROM ${T.hdr} WHERE lnt_nomor = ? FOR UPDATE`,
      [no],
    );
    if (lama.length === 0) {
      throw galat("Data LHK Tinta tidak ditemukan", "notFound");
    }
    if (norm(lama[0].cetak) !== norm(data.nomorCetak)) {
      throw galat(
        "Nomor LHK Cetak tidak bisa diubah. Hapus LHK Tinta ini lalu buat yang baru",
      );
    }

    // tutup buku: tanggal lama dan tanggal baru sama-sama dicek
    if (lama[0].tgl) {
      await cekTutupBuku(lama[0].tgl);
    }
    await cekTutupBuku(data.tanggal);

    await pastikanLhkDiCabang(conn, no, user);
    await pastikanTintaBelumDikunciProof(conn, {
      nomorCetak: lama[0].cetak,
      nomor: no,
      user,
    });
    await pastikanPabrik(conn, data.pabrik);
    await pastikanCetak(conn, data, user, false);

    const [ada] = await conn.query(
      `SELECT ltb_brg_kode AS kode, ltb_potong_stok AS potong
       FROM ${T.bahan} WHERE ltb_lnt_nomor = ?`,
      [no],
    );
    // LHK lama (ada baris bertanda tidak potong stok) tetap tidak memotong stok
    const lhkLama = ada.some((r) => Number(r.potong) === 0);
    const potongStok = bolehPotongStok(data.tanggal, lhkLama);
    pastikanLokasiStok(data.pabrik, potongStok);

    const hasil = await validasiBahan(
      conn,
      data.bahan,
      new Set(ada.map((r) => upper(r.kode))),
    );

    // header dulu: trigger stok membaca lnt_tanggal dan lnt_pab_kode
    await conn.query(
      `UPDATE ${T.hdr}
       SET lnt_tanggal = ?, lnt_pab_kode = ?,
           lnt_date_modified = CURDATE(), lnt_user_modified = ?
       WHERE lnt_nomor = ?`,
      [data.tanggal, data.pabrik, user?.kode ?? null, no],
    );
    await simpanBahan(conn, no, hasil, potongStok);

    await conn.commit();
    return no;
  } catch (e) {
    await conn.rollback().catch(() => {});
    throw e;
  } finally {
    conn.release();
  }
};

module.exports = {
  getLhkTintaById,
  getInfoCetak,
  getLookupCetak,
  getLookupPabrik,
  getLookupBahan,
  createLhkTinta,
  updateLhkTinta,
};
