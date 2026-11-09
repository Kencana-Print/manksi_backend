const db = require("../../../config/database");
const {
  galat,
  teks,
  norm,
  round2,
  parseTanggal,
  adalahSuperadmin,
  cabangUser,
  bilangan,
  MAKS_INT,
  MAKS_ANGKA,
  bolehPotongStok,
} = require("./lhkCommon");
const {
  T,
  cekTutupBuku,
  pastikanLhkDiCabang,
  pastikanBelumDipakai,
  ambilInfoSpk,
  periksaSumber,
  pastikanPabrik,
} = require("./lhkProofShared");
const { pastikanRantaiLhk } = require("./lhkGerbangRantai");
const { KODE_OBAT_PROOF } = require("./lhkProofResep");

const PREFIX_NOMOR = "LHK-PR";
const NOMOR_LOCK = "lhk_proof_nomor";
const LOKASI_J_PLANGKAN_MANUAL = "MT1"; // hanya MT1 boleh isi J Plangkan manual
const JUMLAH_U = 10;
const MAKS_U = 40; // varchar(40)

// Kunci pembanding ukuran (double 2 desimal) tanpa risiko selisih float
const kunciUkuran = (u) => Math.round(Number(u) * 100);

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

// --- validasi payload ---
// Body: { Tanggal, Kode_Pabrik, Detail: [{ Nomor_SPK, J_Plangkan, J_Proof,
//         U1..U7, Plangkan: [{ Ukuran, Qty }] }] }
// J_Plangkan dari client hanya dipakai bila Lokasi MT1; selain itu dihitung
// server = jumlah Qty semua ukuran.
const siapkanData = (body = {}) => {
  const tanggal = parseTanggal(body.Tanggal);

  const pabrik = teks(body.Kode_Pabrik);
  if (!pabrik) {
    throw galat("Lokasi wajib diisi");
  }
  if (pabrik.length > 10) {
    throw galat("Kode lokasi maksimal 10 karakter");
  }
  const manual = norm(pabrik) === LOKASI_J_PLANGKAN_MANUAL;

  const detail = Array.isArray(body.Detail) ? body.Detail : [];
  if (detail.length === 0) {
    throw galat("Minimal satu baris SPK/MAP harus diisi");
  }

  const sudah = new Set();
  const baris = detail.map((d, i) => {
    const n = i + 1;
    const spk = teks(d?.Nomor_SPK);
    if (!spk) {
      throw galat(`Baris ${n}: nomor SPK/MAP wajib diisi`);
    }
    if (spk.length > 20) {
      throw galat(`Baris ${n}: nomor SPK/MAP maksimal 20 karakter`);
    }
    if (sudah.has(spk)) {
      throw galat(`Baris ${n}: SPK/MAP ${spk} sudah ada di baris lain`);
    }
    sudah.add(spk);

    const daftar = Array.isArray(d.Plangkan) ? d.Plangkan : [];
    const ukuranSudah = new Set();
    const plangkan = [];
    let jumlahQty = 0;
    for (const p of daftar) {
      const u = teks(p?.Ukuran);
      if (!/^\d+(\.\d+)?$/.test(u)) {
        throw galat(`Baris ${n}: ukuran plangkan tidak valid`);
      }
      const key = kunciUkuran(u);
      if (ukuranSudah.has(key)) {
        throw galat(`Baris ${n}: ukuran ${u} muncul lebih dari sekali`);
      }
      ukuranSudah.add(key);

      const qty = bilangan(p.Qty, `Baris ${n}: Qty ukuran ${u}`);
      if (qty > 0) {
        plangkan.push({ key, ukuran: u, qty });
        jumlahQty += qty;
      }
    }
    if (jumlahQty > MAKS_INT) {
      throw galat(`Baris ${n}: jumlah plangkan terlalu besar`);
    }

    const jPlangkan = manual
      ? bilangan(d.J_Plangkan, `Baris ${n}: J Plangkan`)
      : jumlahQty;

    const warna = [];
    for (let k = 1; k <= JUMLAH_U; k += 1) {
      const v = teks(d[`U${k}`]);
      if (v.length > MAKS_U) {
        throw galat(`Baris ${n}: U${k} maksimal ${MAKS_U} karakter`);
      }
      warna.push(v);
    }

    return {
      spk,
      plangkan,
      jPlangkan,
      jProof: bilangan(d.J_Proof, `Baris ${n}: J Proof`),
      warna,
    };
  });

  const resep = siapkanResep(body);
  if (resep.length > 0 && pabrik.length > MAKS_KODE_LOKASI_STOK) {
    throw galat(
      `Kode lokasi maksimal ${MAKS_KODE_LOKASI_STOK} karakter bila ada pemakaian obat`,
    );
  }

  return { tanggal, pabrik, baris, resep };
};

// Ukuran harus ada di master; nilai yang disimpan = nilai master
const validasiUkuran = async (q, baris) => {
  const [master] = await q.query(`SELECT up_uraian AS ukuran FROM ${T.ukuran}`);
  const peta = new Map(
    master.map((m) => [kunciUkuran(m.ukuran), Number(m.ukuran)]),
  );
  baris.forEach((b, i) => {
    for (const p of b.plangkan) {
      if (!peta.has(p.key)) {
        throw galat(`Baris ${i + 1}: ukuran ${p.ukuran} tidak ada di master`);
      }
      p.nilai = peta.get(p.key);
    }
  });
};

// --- Pemakaian obat (Actual) ---
// Master = tgarmen_brg (kategori SPANDUK, jenis OBAT), daftar tetap
// KODE_OBAT_PROOF. Stok = tmasterstok_obat, dipotong trigger
// tlhk_proof_resep_* hanya untuk baris ber-flag lpv_potong_stok = 1.
const KTG_BAHAN = "SPANDUK";
const JENIS_OBAT = "OBAT";
const MAKS_KODE_LOKASI_STOK = 3; // mst_cab char(3)
const MAKS_ACTUAL = 999999999; // decimal(14,4)
const FAKTOR_ONS = 0.1; // 1 ons = 100 gram = 0,1 kg (atau liter)
const FAKTOR_GRAM = 0.001;

const round4 = (n) => Math.round((n + Number.EPSILON) * 10000) / 10000;

const angkaInput = (v, label) => {
  const s = teks(v);
  if (s === "") {
    return 0;
  }
  if (!/^\d+(\.\d{1,4})?$/.test(s)) {
    throw galat(
      `${label} harus angka tidak negatif (maks 4 desimal, pakai titik)`,
    );
  }
  return Number(s);
};

// Body.Resep: [{ Kode_Bahan, Kg, Ons, Gram }] -> [{ kode, qty }]
// qty = total dalam satuan master (KG atau LITER), dihitung server.
// Baris bertotal 0 dibuang. Urutan mengikuti KODE_OBAT_PROOF.
const siapkanResep = (body) => {
  const daftar = Array.isArray(body.Resep) ? body.Resep : [];
  const sudah = new Set();
  const hasil = [];
  daftar.forEach((r, i) => {
    const label = `Obat ${i + 1}`;
    const kode = teks(r?.Kode_Bahan).toUpperCase();
    if (!KODE_OBAT_PROOF.includes(kode)) {
      throw galat(
        `${label}: ${kode || "(kosong)"} tidak ada dalam daftar obat Proof`,
      );
    }
    if (sudah.has(kode)) {
      throw galat(`${label}: ${kode} muncul lebih dari sekali`);
    }
    sudah.add(kode);
    const qty = round4(
      angkaInput(r.Kg, `${label}: KG/LTR`) +
        angkaInput(r.Ons, `${label}: Ons`) * FAKTOR_ONS +
        angkaInput(r.Gram, `${label}: Gram`) * FAKTOR_GRAM,
    );
    if (qty > MAKS_ACTUAL) {
      throw galat(`${label}: jumlah terlalu besar`);
    }
    if (qty > 0) {
      hasil.push({ kode, qty });
    }
  });
  return hasil.sort(
    (a, b) => KODE_OBAT_PROOF.indexOf(a.kode) - KODE_OBAT_PROOF.indexOf(b.kode),
  );
};

// Master obat Proof + stok per Lokasi. cab kosong = tanpa stok (Stok null,
// tabel stok tidak disentuh). nomor = LHK yang sedang diubah: pemakaiannya
// sendiri tidak dihitung supaya peringatan stok tidak menghitung ganda.
const ambilMasterObat = async (q, cab = "", nomor = "") => {
  let kolomStok = "NULL";
  let joinStok = "";
  const params = [];
  if (cab) {
    kolomStok = "IFNULL(s.stok, 0)";
    joinStok = `
     LEFT JOIN (
       SELECT mst_brg_kode AS kode, SUM(mst_stok_in - mst_stok_out) AS stok
       FROM ${T.stokObat}
       WHERE mst_aktif = 'Y' AND mst_cab = ?
         AND (? = '' OR mst_noreferensi <> ?)
       GROUP BY mst_brg_kode
     ) s ON s.kode = b.brg_kode`;
    params.push(cab, nomor, nomor);
  }
  params.push(KTG_BAHAN, JENIS_OBAT, KODE_OBAT_PROOF);

  const [rows] = await q.query(
    `SELECT b.brg_kode AS kode,
            IF(IFNULL(b.brg_note, '') = '', b.brg_nama,
               CONCAT(b.brg_nama, ' - ', b.brg_note)) AS nama,
            b.brg_satuan AS satuan, b.brg_aktif AS aktif,
            ${kolomStok} AS stok
     FROM ${T.garmenBrg} b${joinStok}
     WHERE b.brg_ktg = ? AND b.brg_jenis = ? AND b.brg_kode IN (?)`,
    params,
  );
  const peta = new Map(rows.map((r) => [String(r.kode).toUpperCase(), r]));
  return KODE_OBAT_PROOF.filter((k) => peta.has(k)).map((k) => {
    const r = peta.get(k);
    return {
      Kode: k,
      Nama: String(r.nama ?? "").trim(),
      Satuan: String(r.satuan ?? "").trim(),
      Aktif: r.aktif === "Y",
      Stok: r.stok === null ? null : round4(Number(r.stok)),
    };
  });
};

// Lookup untuk baris default form. Stok hanya bila Lokasi dikirim;
// non-superadmin selalu memakai cabangnya sendiri.
const getLookupResep = async (user, pabrik, nomor) => {
  let cab = "";
  if (norm(pabrik) !== "") {
    cab = adalahSuperadmin(user) ? norm(pabrik) : cabangUser(user);
  }
  const master = await ambilMasterObat(db, cab, teks(nomor));
  return master
    .filter((m) => m.Aktif)
    .map((m) => ({
      Kode: m.Kode,
      Nama: m.Nama,
      Satuan: m.Satuan,
      Stok: m.Stok,
    }));
};

// Obat harus ada di master (kategori SPANDUK, jenis OBAT) dan aktif; obat yang
// sudah tercatat di LHK ini (sudahAda) boleh walau dinonaktifkan. Kode yang
// sama di dua jenis barang ditolak: trigger tidak bisa menentukan tabel stok.
const validasiObat = async (q, resep, sudahAda = new Set()) => {
  if (resep.length === 0) {
    return new Map();
  }
  const [ganda] = await q.query(
    `SELECT brg_kode FROM ${T.garmenBrg}
     WHERE brg_kode IN (?) GROUP BY brg_kode HAVING COUNT(*) > 1`,
    [resep.map((r) => r.kode)],
  );
  if (ganda.length > 0) {
    throw galat(
      `Kode obat ${ganda[0].brg_kode} ada di lebih dari satu jenis barang master`,
    );
  }
  const peta = new Map((await ambilMasterObat(q)).map((m) => [m.Kode, m]));
  for (const r of resep) {
    const m = peta.get(r.kode);
    if (!m) {
      throw galat(`Obat ${r.kode} bukan obat spanduk atau tidak ada di master`);
    }
    if (!m.Aktif && !sudahAda.has(r.kode)) {
      throw galat(`Obat ${r.kode} sudah tidak aktif`);
    }
  }
  return peta;
};

// Hapus lalu isi ulang. DELETE memicu trigger yang membalik stok, INSERT
// (potongStok = true) memicu trigger yang memotong. Header harus sudah
// ditulis/di-update sebelum dipanggil: trigger membaca tanggal dan lokasi.
// lpv_qty_resep tidak ditulis lagi (default 0).
const simpanResep = async (conn, nomor, resep, peta, potongStok) => {
  await conn.query(`DELETE FROM ${T.resep} WHERE lpv_lpr_nomor = ?`, [nomor]);
  if (resep.length === 0) {
    return;
  }
  await conn.query(
    `INSERT INTO ${T.resep}
       (lpv_lpr_nomor, lpv_brg_kode, lpv_qty_actual, lpv_satuan,
        lpv_nourut, lpv_potong_stok)
     VALUES ?`,
    [
      resep.map((r, i) => [
        nomor,
        r.kode,
        r.qty,
        peta.get(r.kode).Satuan.slice(0, 10),
        i + 1,
        potongStok ? 1 : 0,
      ]),
    ],
  );
};

// Qty plangkan per ukuran dari semua LHK Afdruk yang memuat SPK/MAP tsb (dijumlahkan).
// Mengembalikan Map spk -> Map kunciUkuran -> qty
const ambilPlangkanAfdruk = async (q, daftarSpk) => {
  const hasil = new Map();
  if (daftarSpk.length === 0) {
    return hasil;
  }
  const [rows] = await q.query(
    `SELECT lad2_spk_nomor AS spk, lad2_up_kode AS ukuran,
            SUM(lad2_qty) AS qty
     FROM ${T.afdrukDtl2}
     WHERE lad2_spk_nomor IN (?)
     GROUP BY lad2_spk_nomor, lad2_up_kode`,
    [daftarSpk],
  );
  for (const r of rows) {
    const qty = Number(r.qty) || 0;
    if (qty <= 0) {
      continue;
    }
    const spk = norm(r.spk);
    if (!hasil.has(spk)) {
      hasil.set(spk, new Map());
    }
    hasil.get(spk).set(kunciUkuran(r.ukuran), qty);
  }
  return hasil;
};

// Baris yang Afdruk-nya punya data: qty ditimpa dari Afdruk (terkunci).
// daftarKecuali: SPK yang dibiarkan apa adanya (mode ubah, baris lama).
const terapkanKunciAfdruk = async (q, baris, daftarKecuali = new Set()) => {
  const target = baris.filter((b) => !daftarKecuali.has(norm(b.spk)));
  const peta = await ambilPlangkanAfdruk(
    q,
    target.map((b) => b.spk),
  );
  for (const b of target) {
    const dariAfdruk = peta.get(norm(b.spk));
    if (!dariAfdruk) {
      continue;
    }
    b.plangkan = [...dariAfdruk.entries()].map(([key, qty]) => ({
      key,
      ukuran: String(key / 100),
      qty,
    }));
    b.jPlangkan = [...dariAfdruk.values()].reduce((a, v) => a + v, 0);
  }
};

const validasiSumberBaris = async (q, baris, user) => {
  const peta = await ambilInfoSpk(
    q,
    baris.map((b) => b.spk),
  );
  for (const b of baris) {
    periksaSumber(peta.get(b.spk), b.spk, user);
  }
};

// J Meter = jumlah (ukuran x Qty) seluruh ukuran pada Detail Plangkan, yang
// sudah terkunci dari Afdruk (Afdruk dari Hapus Plankan), jadi satu sumber.
// Dipanggil setelah validasiUkuran (p.nilai terisi dari master).
const hitungJumlahMeter = (baris) =>
  baris.map((b) => {
    const jumlahMeter = round2(
      b.plangkan.reduce((a, p) => a + p.nilai * p.qty, 0),
    );
    if (jumlahMeter > MAKS_ANGKA) {
      throw galat(`SPK/MAP ${b.spk}: J Meter terlalu besar`);
    }
    return { ...b, jumlahMeter };
  });

// Hapus semua detail + dtl_2 LHK per nomor, lalu isi ulang.
const simpanDetail = async (conn, nomor, baris) => {
  await conn.query(`DELETE FROM ${T.dtl2} WHERE lprd2_lpr_nomor = ?`, [nomor]);
  await conn.query(`DELETE FROM ${T.dtl} WHERE lprd_lpr_nomor = ?`, [nomor]);

  const valuesDtl = baris.map((b) => [
    nomor,
    b.spk,
    b.jPlangkan,
    b.jProof,
    b.jumlahMeter,
    ...b.warna,
  ]);
  await conn.query(
    `INSERT INTO ${T.dtl}
       (lprd_lpr_nomor, lprd_spk_nomor, lprd_j_plangkan, lprd_j_proof,
        lprd_j_meter,
        lprd_u1, lprd_u2, lprd_u3, lprd_u4, lprd_u5, lprd_u6, lprd_u7,
        lprd_u8, lprd_u9, lprd_u10)
     VALUES ?`,
    [valuesDtl],
  );

  const valuesDtl2 = [];
  for (const b of baris) {
    for (const p of b.plangkan) {
      valuesDtl2.push([nomor, b.spk, p.nilai, p.qty]);
    }
  }
  if (valuesDtl2.length > 0) {
    await conn.query(
      `INSERT INTO ${T.dtl2}
         (lprd2_lpr_nomor, lprd2_spk_nomor, lprd2_up_kode, lprd2_qty)
       VALUES ?`,
      [valuesDtl2],
    );
  }
};

// LHK-PR.yymm.NNNN, dipanggil di dalam lock + transaksi
const buatNomor = async (conn, tanggalStr) => {
  const yymm = tanggalStr.slice(2, 4) + tanggalStr.slice(5, 7);
  const prefix = `${PREFIX_NOMOR}.${yymm}.`;
  const [rows] = await conn.query(
    `SELECT MAX(CAST(RIGHT(lpr_nomor, 4) AS UNSIGNED)) AS mx
     FROM ${T.hdr} WHERE lpr_nomor LIKE ?`,
    [`${prefix}%`],
  );
  const next = (Number(rows[0]?.mx) || 0) + 1;
  if (next > 9999) {
    throw galat("Nomor LHK bulan ini sudah mencapai batas (9999)");
  }
  return `${prefix}${String(next).padStart(4, "0")}`;
};

// --- Lookup ukuran plangkan (master 15 ukuran) ---
const getLookupUkuran = async () => {
  const [rows] = await db.query(
    `SELECT up_kode AS Kode, up_uraian AS Ukuran
     FROM ${T.ukuran} ORDER BY up_kode`,
  );
  return rows.map((r) => ({ Kode: r.Kode, Ukuran: Number(r.Ukuran) }));
};

// --- LOAD ---
const getLhkProofById = async (nomor, user) => {
  const no = teks(nomor);
  const [hdr] = await db.query(
    `SELECT h.lpr_nomor AS Nomor,
            DATE_FORMAT(h.lpr_tanggal, '%Y-%m-%d') AS Tanggal,
            h.lpr_pab_kode AS Kode_Pabrik,
            p.pab_nama AS Nama_Pabrik
     FROM ${T.hdr} h
     LEFT JOIN ${T.pabrik} p ON p.pab_kode = h.lpr_pab_kode
     WHERE h.lpr_nomor = ?`,
    [no],
  );
  if (hdr.length === 0) {
    throw galat("Data LHK Proof tidak ditemukan", "notFound");
  }
  await pastikanLhkDiCabang(db, no, user);

  const [detail] = await db.query(
    `SELECT d.lprd_spk_nomor AS Nomor_SPK,
            x.spk_nama AS Nama_SPK,
            x.spk_jumlah AS Jumlah_Order,
            x.spk_panjang AS Panjang,
            x.spk_lebar AS Lebar,
            d.lprd_j_plangkan AS J_Plangkan,
            d.lprd_j_proof AS J_Proof,
            d.lprd_u1 AS U1, d.lprd_u2 AS U2, d.lprd_u3 AS U3,
            d.lprd_u4 AS U4, d.lprd_u5 AS U5, d.lprd_u6 AS U6,
            d.lprd_u7 AS U7, d.lprd_u8 AS U8, d.lprd_u9 AS U9,
            d.lprd_u10 AS U10
     FROM ${T.dtl} d
     LEFT JOIN (
       SELECT spk_nomor, spk_nama, spk_jumlah,
              IFNULL(spk_panjang, 0) AS spk_panjang,
              IFNULL(spk_lebar, 0) AS spk_lebar
       FROM ${T.spk}
       UNION ALL
       SELECT mspk_nomor, mspk_nama, mspk_jumlah,
              IFNULL(mspk_panjang, 0), IFNULL(mspk_lebar, 0)
       FROM ${T.memoSpk}
     ) x ON x.spk_nomor = d.lprd_spk_nomor
     WHERE d.lprd_lpr_nomor = ?
     ORDER BY d.lprd_spk_nomor`,
    [no],
  );

  const [qtyRows] = await db.query(
    `SELECT lprd2_spk_nomor AS spk, lprd2_up_kode AS ukuran, lprd2_qty AS qty
     FROM ${T.dtl2} WHERE lprd2_lpr_nomor = ?`,
    [no],
  );
  const peta = new Map(
    qtyRows.map((r) => [
      `${norm(r.spk)}|${kunciUkuran(r.ukuran)}`,
      Number(r.qty),
    ]),
  );
  const ukuran = await getLookupUkuran();

  const Detail = detail.map((d) => {
    const Plangkan = ukuran.map((u) => ({
      Ukuran: u.Ukuran,
      Qty: peta.get(`${norm(d.Nomor_SPK)}|${kunciUkuran(u.Ukuran)}`) ?? 0,
    }));
    return {
      ...d,
      Jumlah_Meter: round2(Plangkan.reduce((a, p) => a + p.Ukuran * p.Qty, 0)),
      Plangkan,
    };
  });

  const [obatRows] = await db.query(
    `SELECT lpv_brg_kode AS kode, lpv_qty_actual AS actual
     FROM ${T.resep} WHERE lpv_lpr_nomor = ?`,
    [no],
  );
  const petaObat = new Map(
    obatRows.map((r) => [String(r.kode).toUpperCase(), Number(r.actual) || 0]),
  );
  const master = await ambilMasterObat(db);
  const Resep = master
    .filter((m) => m.Aktif || petaObat.has(m.Kode))
    .map((m) => ({
      Kode: m.Kode,
      Nama: m.Nama,
      Satuan: m.Satuan,
      Qty_Actual: petaObat.get(m.Kode) ?? 0,
    }));

  return { ...hdr[0], Detail, Resep };
};

// --- Info SPK/MAP untuk mengisi baris ---
const getInfoSpk = async (nomor, user) => {
  const no = teks(nomor);
  const peta = await ambilInfoSpk(db, [no]);
  const info = peta.get(no);
  periksaSumber(info, no, user);
  await pastikanRantaiLhk(db, {
    kodeLini: "PROOF",
    daftarSpk: [no],
  });
  const afdruk = (await ambilPlangkanAfdruk(db, [info.nomor])).get(
    norm(info.nomor),
  );
  const ukuran = await getLookupUkuran();
  return {
    Nomor_SPK: info.nomor,
    Nama_SPK: info.nama,
    Jumlah_Order: info.jumlah,
    Panjang: info.panjang,
    Lebar: info.lebar,
    Terkunci: !!afdruk,
    Plangkan: ukuran.map((u) => ({
      Ukuran: u.Ukuran,
      Qty: afdruk?.get(kunciUkuran(u.Ukuran)) ?? 0,
    })),
  };
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

// --- CREATE ---
const createLhkProof = async (body, user) => {
  const data = siapkanData(body);
  pastikanLokasiUser(data.pabrik, user);
  await cekTutupBuku(data.tanggal);

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
    await validasiSumberBaris(conn, data.baris, user);
    await pastikanRantaiLhk(conn, {
      kodeLini: "PROOF",
      daftarSpk: data.baris.map((b) => b.spk),
    });
    await terapkanKunciAfdruk(conn, data.baris);
    await validasiUkuran(conn, data.baris);
    const baris = hitungJumlahMeter(data.baris);
    const petaObat = await validasiObat(conn, data.resep);

    const nomor = await buatNomor(conn, data.tanggal);
    try {
      await conn.query(
        `INSERT INTO ${T.hdr}
           (lpr_nomor, lpr_tanggal, lpr_pab_kode, lpr_date_create, lpr_user_create)
         VALUES (?, ?, ?, CURDATE(), ?)`,
        [nomor, data.tanggal, data.pabrik, user?.kode ?? null],
      );
    } catch (e) {
      // Aplikasi desktop tidak memakai lock penomoran ini
      if (e.code === "ER_DUP_ENTRY") {
        throw galat(
          `Nomor ${nomor} sudah dipakai input lain (mungkin dari aplikasi desktop). Silakan simpan ulang.`,
        );
      }
      throw e;
    }
    await simpanDetail(conn, nomor, baris);
    await simpanResep(
      conn,
      nomor,
      data.resep,
      petaObat,
      bolehPotongStok(data.tanggal, false),
    );

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
const updateLhkProof = async (nomor, body, user) => {
  const no = teks(nomor);
  const data = siapkanData(body);
  pastikanLokasiUser(data.pabrik, user);

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [lama] = await conn.query(
      `SELECT DATE_FORMAT(lpr_tanggal, '%Y-%m-%d') AS tgl
       FROM ${T.hdr} WHERE lpr_nomor = ? FOR UPDATE`,
      [no],
    );
    if (lama.length === 0) {
      throw galat("Data LHK Proof tidak ditemukan", "notFound");
    }

    // tutup buku: tanggal lama dan tanggal baru sama-sama dicek
    if (lama[0].tgl) {
      await cekTutupBuku(lama[0].tgl);
    }
    await cekTutupBuku(data.tanggal);

    await pastikanLhkDiCabang(conn, no, user);
    await pastikanBelumDipakai(conn, no, user);
    await pastikanPabrik(conn, data.pabrik);
    await validasiSumberBaris(conn, data.baris, user);
    await pastikanRantaiLhk(conn, {
      kodeLini: "PROOF",
      daftarSpk: data.baris.map((b) => b.spk),
      nomorLhk: no,
    });
    const [spkLama] = await conn.query(
      `SELECT lprd_spk_nomor AS spk FROM ${T.dtl} WHERE lprd_lpr_nomor = ?`,
      [no],
    );
    await terapkanKunciAfdruk(
      conn,
      data.baris,
      new Set(spkLama.map((r) => norm(r.spk))),
    );
    await validasiUkuran(conn, data.baris);
    const baris = hitungJumlahMeter(data.baris);

    const [obatAda] = await conn.query(
      `SELECT lpv_brg_kode AS kode, lpv_potong_stok AS potong
       FROM ${T.resep} WHERE lpv_lpr_nomor = ?`,
      [no],
    );
    // LHK lama (baris bertanda 0) tetap tidak memotong stok saat diubah
    const lhkLama = obatAda.some((r) => Number(r.potong) === 0);
    const petaObat = await validasiObat(
      conn,
      data.resep,
      new Set(obatAda.map((r) => String(r.kode).toUpperCase())),
    );

    await conn.query(
      `UPDATE ${T.hdr}
       SET lpr_tanggal = ?, lpr_pab_kode = ?,
           lpr_date_modified = CURDATE(), lpr_user_modified = ?
       WHERE lpr_nomor = ?`,
      [data.tanggal, data.pabrik, user?.kode ?? null, no],
    );
    await simpanDetail(conn, no, baris);
    await simpanResep(
      conn,
      no,
      data.resep,
      petaObat,
      bolehPotongStok(data.tanggal, lhkLama),
    );

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
  getLhkProofById,
  getInfoSpk,
  getLookupPabrik,
  getLookupUkuran,
  getLookupResep,
  createLhkProof,
  updateLhkProof,
};
