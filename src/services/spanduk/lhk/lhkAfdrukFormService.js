const db = require("../../../config/database");
const {
  galat,
  teks,
  norm,
  round2,
  parseTanggal,
  adalahSuperadmin,
  cabangUser,
  MAKS_ANGKA,
} = require("./lhkCommon");
const {
  T,
  cekTutupBuku,
  pastikanLhkDiCabang,
  pastikanBelumDipakai,
  ambilInfoSpk,
  periksaSumber,
  pastikanPabrik,
} = require("./lhkAfdrukShared");
const { pastikanRantaiLhk } = require("./lhkGerbangRantai");

const PREFIX_NOMOR = "LHK-A";
const NOMOR_LOCK = "lhk_afdruk_nomor";
const MAKS_INT = 2147483647; // int(11)
const MAKS_KETERANGAN = 200; // lad_keterangan varchar(200)

// --- util angka ---
const bilangan = (v, label) => {
  if (v === null || v === undefined || teks(v) === "") {
    return 0;
  }
  const s = teks(v);
  if (!/^\d+$/.test(s)) {
    throw galat(`${label} harus bilangan bulat tidak negatif`);
  }
  const n = Number(s);
  if (n > MAKS_INT) {
    throw galat(`${label} terlalu besar`);
  }
  return n;
};

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
// Body: { Tanggal, Kode_Pabrik, Bahan: [{ Kode_Bahan, Qty }],
//         Detail: [{ Nomor_SPK, Keterangan, Plangkan: [{ Ukuran, Qty }] }] }
// Bahan pemakaian per LHK (bukan per SPK/MAP), boleh kosong.
// J Plangkan tidak diterima dari client: dihitung = jumlah Qty semua ukuran.
const siapkanData = (body = {}) => {
  const tanggal = parseTanggal(body.Tanggal);

  const pabrik = teks(body.Kode_Pabrik);
  if (!pabrik) {
    throw galat("Lokasi wajib diisi");
  }
  if (pabrik.length > 10) {
    throw galat("Kode lokasi maksimal 10 karakter");
  }

  const bahan = siapkanBahan(body.Bahan);

  if (bahan.length > 0 && pabrik.length > MAKS_KODE_LOKASI_STOK) {
    throw galat(
      `Kode lokasi maksimal ${MAKS_KODE_LOKASI_STOK} karakter bila ada pemakaian bahan`,
    );
  }

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
    let jPlangkan = 0;
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
        jPlangkan += qty;
      }
    }
    if (jPlangkan > MAKS_INT) {
      throw galat(`Baris ${n}: jumlah plangkan terlalu besar`);
    }

    const ket = teks(d.Keterangan);
    if (ket.length > MAKS_KETERANGAN) {
      throw galat(
        `Baris ${n}: keterangan maksimal ${MAKS_KETERANGAN} karakter`,
      );
    }

    return { spk, plangkan, jPlangkan, ket };
  });

  return { tanggal, pabrik, bahan, baris };
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

const validasiSumberBaris = async (q, baris, user) => {
  const peta = await ambilInfoSpk(
    q,
    baris.map((b) => b.spk),
  );
  for (const b of baris) {
    periksaSumber(peta.get(b.spk), b.spk, user);
  }
  return peta;
};

// Qty plangkan per ukuran dari semua LHK Hapus Plankan yang memuat MAP tsb
// (dijumlahkan). Mengembalikan Map norm(spk) -> Map kunciUkuran -> qty
const ambilPlangkanHp = async (q, daftarSpk) => {
  const hasil = new Map();
  if (daftarSpk.length === 0) {
    return hasil;
  }
  const [rows] = await q.query(
    `SELECT lhpd2_spk_nomor AS spk, lhpd2_up_kode AS ukuran,
            SUM(lhpd2_qty) AS qty
     FROM ${T.hpDtl2}
     WHERE lhpd2_spk_nomor IN (?)
     GROUP BY lhpd2_spk_nomor, lhpd2_up_kode`,
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

// Baris yang HP-nya punya data per ukuran: plangkan ditimpa dari HP (terkunci).
// Tanpa data HP (MAP tanpa HP, HP lama, SPK biasa) isian client dipakai apa adanya.
// daftarKecuali: baris yang sudah ada di LHK ini (mode ubah), dibiarkan.
const terapkanKunciHp = async (q, baris, daftarKecuali = new Set()) => {
  const target = baris.filter((b) => !daftarKecuali.has(norm(b.spk)));
  const peta = await ambilPlangkanHp(
    q,
    target.map((b) => b.spk),
  );
  for (const b of target) {
    const dariHp = peta.get(norm(b.spk));
    if (!dariHp) {
      continue;
    }
    b.plangkan = [...dariHp.entries()].map(([key, qty]) => ({
      key,
      ukuran: String(key / 100),
      qty,
    }));
    b.jPlangkan = [...dariHp.values()].reduce((a, v) => a + v, 0);
  }
};

// Bahan pemakaian Afdruk = master tgarmen_brg kategori SPANDUK. Stok = buku
// besar per jenis barang (tmasterstok_obat/acc/sparepart/atk), dipotong oleh
// trigger tlhk_afdruk_bahan_* hanya untuk baris ber-flag lab_potong_stok = 1.
const KTG_BAHAN = "SPANDUK";
const MAKS_QTY_BAHAN = 9999999999.99; // decimal(12,2)
const MAKS_KODE_BAHAN = 20; // lab_brg_kode varchar(20)
const MAKS_KODE_LOKASI_STOK = 3; // mst_cab char(3)
// Batas tanggal potong stok = tanggal stok awal P02 diinput (opname go-live).
// LHK bertanggal sebelum ini tidak memotong stok, baru maupun diubah, karena
// stoknya belum ada. GANTI saat cutover ke tanggal stok awal di DB prod.
const TANGGAL_MULAI_POTONG_STOK = "2026-11-01";

// tanggal = 'YYYY-MM-DD' (tanggal LHK yang disimpan). lhkLama = LHK yang
// baris bahannya sudah bertanda lab_potong_stok = 0.
const bolehPotongStok = (tanggal, lhkLama) =>
  !lhkLama && tanggal >= TANGGAL_MULAI_POTONG_STOK;

const qtyBahan = (v, label) => {
  const s = teks(v);
  if (!/^\d+(\.\d+)?$/.test(s)) {
    throw galat(`${label} harus angka lebih dari 0 (desimal pakai titik)`);
  }
  const n = round2(Number(s));
  if (n <= 0) {
    throw galat(`${label} harus lebih dari 0`);
  }
  if (n > MAKS_QTY_BAHAN) {
    throw galat(`${label} terlalu besar`);
  }
  return n;
};

// Body.Bahan: [{ Kode_Bahan (string), Qty }], boleh kosong
const siapkanBahan = (daftar) => {
  const list = Array.isArray(daftar) ? daftar : [];
  const sudah = new Set();
  return list.map((t, i) => {
    const label = `Bahan ${i + 1}`;
    const kode = teks(t?.Kode_Bahan).toUpperCase();
    if (!kode) {
      throw galat(`${label}: bahan wajib dipilih`);
    }
    if (kode.length > MAKS_KODE_BAHAN) {
      throw galat(`${label}: kode bahan maksimal ${MAKS_KODE_BAHAN} karakter`);
    }
    if (sudah.has(kode)) {
      throw galat(`${label}: bahan ${kode} sudah ada di daftar`);
    }
    sudah.add(kode);
    return { kode, qty: qtyBahan(t.Qty, `${label}: Qty`) };
  });
};

// Bahan harus ada di master tgarmen_brg kategori SPANDUK dan aktif. Bahan yang
// sudah tercatat di LHK ini (sudahAda) tetap boleh walau dinonaktifkan.
// PK master = (brg_jenis, brg_kode): kode yang sama di dua jenis ditolak,
// karena trigger tidak bisa menentukan tabel stok mana yang dipotong.
// Mengembalikan peta kode (huruf besar) -> baris master.
const validasiBahan = async (q, bahan, sudahAda = new Set()) => {
  if (bahan.length === 0) {
    return new Map();
  }
  const [master] = await q.query(
    `SELECT brg_kode, brg_satuan, brg_aktif
     FROM ${T.garmenBrg}
     WHERE brg_ktg = ? AND brg_kode IN (?)`,
    [KTG_BAHAN, bahan.map((b) => b.kode)],
  );
  const peta = new Map();
  for (const m of master) {
    const k = String(m.brg_kode).toUpperCase();
    if (peta.has(k)) {
      throw galat(`Kode bahan ${k} ada di lebih dari satu jenis barang master`);
    }
    peta.set(k, m);
  }
  bahan.forEach((b, i) => {
    const m = peta.get(b.kode);
    if (!m) {
      throw galat(
        `Bahan ${i + 1}: ${b.kode} bukan bahan spanduk atau tidak ada di master`,
      );
    }
    if (m.brg_aktif !== "Y" && !sudahAda.has(b.kode)) {
      throw galat(`Bahan ${i + 1}: ${b.kode} sudah tidak aktif`);
    }
  });
  return peta;
};

// Hapus lalu isi ulang. DELETE memicu trigger yang membalik stok, INSERT
// (potongStok = true) memicu trigger yang memotong. Satuan disalin dari master.
// Header harus sudah ditulis/di-update sebelum fungsi ini dipanggil: trigger
// membaca tanggal dan lokasi dari tlhk_afdruk_hdr.
const simpanBahan = async (conn, nomor, bahan, peta, potongStok) => {
  await conn.query(`DELETE FROM ${T.bahan} WHERE lab_lah_nomor = ?`, [nomor]);
  if (bahan.length === 0) {
    return;
  }
  await conn.query(
    `INSERT INTO ${T.bahan}
       (lab_lah_nomor, lab_brg_kode, lab_qty, lab_satuan, lab_nourut,
        lab_potong_stok)
     VALUES ?`,
    [
      bahan.map((b, i) => {
        const m = peta.get(b.kode);
        return [
          nomor,
          m.brg_kode,
          b.qty,
          m.brg_satuan,
          i + 1,
          potongStok ? 1 : 0,
        ];
      }),
    ],
  );
};

const getBahanLhk = async (q, nomor) => {
  const [rows] = await q.query(
    `SELECT a.lab_brg_kode AS Kode_Bahan,
            IF(IFNULL(b.brg_note, '') = '', b.brg_nama,
               CONCAT(b.brg_nama, ' - ', b.brg_note)) AS Nama_Bahan,
            IFNULL(a.lab_satuan, b.brg_satuan) AS Satuan,
            a.lab_qty AS Qty
     FROM ${T.bahan} a
     LEFT JOIN ${T.garmenBrg} b ON b.brg_kode = a.lab_brg_kode
     WHERE a.lab_lah_nomor = ?
     ORDER BY a.lab_nourut`,
    [nomor],
  );
  return rows.map((r) => ({
    Kode_Bahan: String(r.Kode_Bahan),
    Nama_Bahan: r.Nama_Bahan,
    Satuan: r.Satuan,
    Qty: Number(r.Qty),
  }));
};

// Stok per lokasi (mst_cab). Pemakaian LHK itu sendiri (mst_noreferensi =
// nomor) tidak dihitung, supaya peringatan stok kurang saat ubah LHK tidak
// menghitung ganda. Tabel stok dipilih dari brg_jenis lewat CASE (bukan
// membandingkan kolom jenis hasil UNION: menghindari galat collation 1267).
const stokSub = (tabel) => `(
  SELECT mst_brg_kode AS kode, SUM(mst_stok_in - mst_stok_out) AS stok
  FROM ${tabel}
  WHERE mst_aktif = 'Y' AND mst_cab = ?
    AND (? = '' OR mst_noreferensi <> ?)
  GROUP BY mst_brg_kode
)`;

// Stok hanya dihitung bila Lokasi dikirim (form). Tanpa Lokasi (browse, untuk
// judul kolom) Stok = null dan tabel stok tidak disentuh. Non-superadmin selalu
// memakai cabangnya sendiri, apa pun isi parameter pabrik.
const getLookupBahan = async (search, user, pabrik, nomor) => {
  let cab = "";
  if (norm(pabrik) !== "") {
    cab = adalahSuperadmin(user) ? norm(pabrik) : cabangUser(user);
  }
  const no = teks(nomor);
  const kata = teks(search);

  let kolomStok = "NULL";
  let joinStok = "";
  // urutan params mengikuti urutan ? di SQL: empat subquery stok dulu
  const params = [];
  if (cab) {
    kolomStok = `IFNULL(CASE b.brg_jenis
              WHEN 'OBAT' THEN so.stok
              WHEN 'ACCESORIES' THEN sa.stok
              WHEN 'SPAREPART' THEN ss.stok
              ELSE sk.stok
            END, 0)`;
    joinStok = `
     LEFT JOIN ${stokSub(T.stokObat)} so ON so.kode = b.brg_kode
     LEFT JOIN ${stokSub(T.stokAcc)} sa ON sa.kode = b.brg_kode
     LEFT JOIN ${stokSub(T.stokSparepart)} ss ON ss.kode = b.brg_kode
     LEFT JOIN ${stokSub(T.stokAtk)} sk ON sk.kode = b.brg_kode`;
    for (let i = 0; i < 4; i += 1) {
      params.push(cab, no, no);
    }
  }

  const kondisi = ["b.brg_ktg = ?", "b.brg_aktif = 'Y'"];
  params.push(KTG_BAHAN);
  if (kata) {
    kondisi.push("(b.brg_nama LIKE ? OR b.brg_kode LIKE ?)");
    params.push(`%${kata}%`, `%${kata}%`);
  }

  const [rows] = await db.query(
    `SELECT b.brg_kode AS Kode,
            IF(IFNULL(b.brg_note, '') = '', b.brg_nama,
               CONCAT(b.brg_nama, ' - ', b.brg_note)) AS Nama,
            b.brg_satuan AS Satuan,
            ${kolomStok} AS Stok
     FROM ${T.garmenBrg} b${joinStok}
     WHERE ${kondisi.join(" AND ")}
     ORDER BY b.brg_nama
     LIMIT 500`,
    params,
  );
  return rows.map((r) => ({
    Kode: String(r.Kode),
    Nama: r.Nama,
    Satuan: r.Satuan,
    Stok: r.Stok === null ? null : round2(Number(r.Stok)),
  }));
};

// J Meter = jumlah (ukuran x Qty) seluruh ukuran pada Detail Plangkan.
// Dihitung dari data yang sama dengan yang disimpan di dtl2, jadi tidak ada
// nilai lama yang perlu dipertahankan. Dipanggil setelah validasiUkuran
// (p.nilai sudah terisi dari master).
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

// Hapus semua detail + Detail Plangkan LHK, lalu isi ulang.
// Menghapus dtl2 per nomor (bukan per SPK) supaya SPK yang dibuang ikut bersih
// dan nomor yang dipakai ulang tidak mewarisi baris sisa.
const simpanDetail = async (conn, nomor, baris) => {
  await conn.query(`DELETE FROM ${T.dtl2} WHERE lad2_lah_nomor = ?`, [nomor]);
  await conn.query(`DELETE FROM ${T.dtl} WHERE lad_lah_nomor = ?`, [nomor]);

  const valuesDtl = baris.map((b) => [
    nomor,
    b.spk,
    b.jPlangkan,
    b.jumlahMeter,
    b.ket,
  ]);
  await conn.query(
    `INSERT INTO ${T.dtl}
       (lad_lah_nomor, lad_spk_nomor, lad_j_plangkan, lad_jumlahmeter,
        lad_keterangan)
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
         (lad2_lah_nomor, lad2_spk_nomor, lad2_up_kode, lad2_qty)
       VALUES ?`,
      [valuesDtl2],
    );
  }
};

// LHK-A.yymm.NNNN, dipanggil di dalam lock + transaksi
const buatNomor = async (conn, tanggalStr) => {
  const yymm = tanggalStr.slice(2, 4) + tanggalStr.slice(5, 7);
  const prefix = `${PREFIX_NOMOR}.${yymm}.`;
  const [rows] = await conn.query(
    `SELECT MAX(CAST(RIGHT(lah_nomor, 4) AS UNSIGNED)) AS mx
     FROM ${T.hdr} WHERE lah_nomor LIKE ?`,
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
const getLhkAfdrukById = async (nomor, user) => {
  const no = teks(nomor);
  const [hdr] = await db.query(
    `SELECT h.lah_nomor AS Nomor,
            DATE_FORMAT(h.lah_tanggal, '%Y-%m-%d') AS Tanggal,
            h.lah_pab_kode AS Kode_Pabrik,
            p.pab_nama AS Nama_Pabrik
     FROM ${T.hdr} h
     LEFT JOIN ${T.pabrik} p ON p.pab_kode = h.lah_pab_kode
     WHERE h.lah_nomor = ?`,
    [no],
  );
  if (hdr.length === 0) {
    throw galat("Data LHK Afdruk tidak ditemukan", "notFound");
  }
  await pastikanLhkDiCabang(db, no, user);

  const [detail] = await db.query(
    `SELECT d.lad_spk_nomor AS Nomor_SPK,
            x.spk_nama AS Nama_SPK,
            x.spk_jumlah AS Jumlah_Order,
            x.spk_panjang AS Panjang,
            x.spk_lebar AS Lebar,
            d.lad_keterangan AS Keterangan
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
     ) x ON x.spk_nomor = d.lad_spk_nomor
     WHERE d.lad_lah_nomor = ?
     ORDER BY d.lad_spk_nomor`,
    [no],
  );

  const [qtyRows] = await db.query(
    `SELECT lad2_spk_nomor AS spk, lad2_up_kode AS ukuran, lad2_qty AS qty
     FROM ${T.dtl2} WHERE lad2_lah_nomor = ?`,
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
      J_Plangkan: Plangkan.reduce((a, p) => a + p.Qty, 0),
      Jumlah_Meter: round2(Plangkan.reduce((a, p) => a + p.Ukuran * p.Qty, 0)),
      Plangkan,
    };
  });

  const Bahan = await getBahanLhk(db, no);
  return { ...hdr[0], Bahan, Detail };
};

// --- Info SPK/MAP untuk mengisi baris ---
const getInfoSpk = async (nomor, user) => {
  const no = teks(nomor);
  const peta = await ambilInfoSpk(db, [no]);
  const info = peta.get(no);
  periksaSumber(info, no, user);
  // Cek rantai saat nomor di-Enter / dipilih, supaya penolakan muncul sebelum
  // Simpan. Cek di createLhkAfdruk / updateLhkAfdruk tetap berjalan.
  await pastikanRantaiLhk(db, { kodeLini: "AFDRUK", daftarSpk: [no] });
  const hp = (await ambilPlangkanHp(db, [info.nomor])).get(norm(info.nomor));
  const ukuran = await getLookupUkuran();
  return {
    Nomor_SPK: info.nomor,
    Nama_SPK: info.nama,
    Jumlah_Order: info.jumlah,
    Panjang: info.panjang,
    Lebar: info.lebar,
    Terkunci: !!hp,
    Plangkan: ukuran.map((u) => ({
      Ukuran: u.Ukuran,
      Qty: hp?.get(kunciUkuran(u.Ukuran)) ?? 0,
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
const createLhkAfdruk = async (body, user) => {
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
      kodeLini: "AFDRUK",
      daftarSpk: data.baris.map((b) => b.spk),
    });
    await terapkanKunciHp(conn, data.baris);
    await validasiUkuran(conn, data.baris);
    const baris = hitungJumlahMeter(data.baris);
    const petaBahan = await validasiBahan(conn, data.bahan);

    const nomor = await buatNomor(conn, data.tanggal);
    try {
      await conn.query(
        `INSERT INTO ${T.hdr}
           (lah_nomor, lah_tanggal, lah_pab_kode, lah_date_create, lah_user_create)
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
    await simpanBahan(
      conn,
      nomor,
      data.bahan,
      petaBahan,
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
const updateLhkAfdruk = async (nomor, body, user) => {
  const no = teks(nomor);
  const data = siapkanData(body);
  pastikanLokasiUser(data.pabrik, user);

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [lama] = await conn.query(
      `SELECT DATE_FORMAT(lah_tanggal, '%Y-%m-%d') AS tgl
       FROM ${T.hdr} WHERE lah_nomor = ? FOR UPDATE`,
      [no],
    );
    if (lama.length === 0) {
      throw galat("Data LHK Afdruk tidak ditemukan", "notFound");
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
      kodeLini: "AFDRUK",
      daftarSpk: data.baris.map((b) => b.spk),
      nomorLhk: no,
    });
    const [spkLama] = await conn.query(
      `SELECT lad_spk_nomor AS spk FROM ${T.dtl} WHERE lad_lah_nomor = ?`,
      [no],
    );
    await terapkanKunciHp(
      conn,
      data.baris,
      new Set(spkLama.map((r) => norm(r.spk))),
    );
    await validasiUkuran(conn, data.baris);
    const baris = hitungJumlahMeter(data.baris);

    const [bahanAda] = await conn.query(
      `SELECT lab_brg_kode AS kode, lab_potong_stok AS potong
       FROM ${T.bahan} WHERE lab_lah_nomor = ?`,
      [no],
    );
    // LHK lama (baris bahan bertanda 0) tetap tidak memotong stok saat diubah
    const lhkLama = bahanAda.some((r) => Number(r.potong) === 0);
    const petaBahan = await validasiBahan(
      conn,
      data.bahan,
      new Set(bahanAda.map((r) => String(r.kode).toUpperCase())),
    );

    await conn.query(
      `UPDATE ${T.hdr}
       SET lah_tanggal = ?, lah_pab_kode = ?,
           lah_date_modified = CURDATE(), lah_user_modified = ?
       WHERE lah_nomor = ?`,
      [data.tanggal, data.pabrik, user?.kode ?? null, no],
    );
    await simpanDetail(conn, no, baris);
    await simpanBahan(
      conn,
      no,
      data.bahan,
      petaBahan,
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
  getLhkAfdrukById,
  getInfoSpk,
  getLookupPabrik,
  getLookupUkuran,
  getLookupBahan,
  createLhkAfdruk,
  updateLhkAfdruk,
};
