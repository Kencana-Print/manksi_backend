const db = require("../../../config/database");
const {
  galat,
  teks,
  norm,
  parseTanggal,
  adalahSuperadmin,
  cabangUser,
} = require("./lhkCommon");
const {
  T,
  cekTutupBuku,
  pastikanLhkDiCabang,
  pastikanPabrik,
  pastikanTintaBelumDikunciProof,
} = require("./lhkTintaShared");
const { KODE_RESEP } = require("./lhkProofResep");

const PREFIX_NOMOR = "LHK-T";
const NOMOR_LOCK = "lhk_tinta_nomor";
const MAKS_QTY = 9999999999.9999; // decimal(14,4)

// Bahan tinta/cat = master bahan kategori 3 (OBAT & TINTA) divisi Spanduk
const KATEGORI_TINTA = "3";
const DIVISI_TINTA = 1;

// Konversi satuan massa. Hanya barang yang satuan masternya KG atau GR yang
// boleh diinput dalam KG / ONS / GR (1 ons = 100 gram). Barang bersatuan lain
// (LITER, PCS, ROLL, dst) diinput dalam satuan masternya.
const GRAM_PER_SATUAN = { KG: 1000, ONS: 100, GR: 1 };
const SATUAN_MASTER_MASSA = ["KG", "GR"];
const PILIHAN_SATUAN_MASSA = ["KG", "ONS", "GR"];

const upper = (v) =>
  String(v ?? "")
    .trim()
    .toUpperCase();
const bulat4 = (n) => Math.round(n * 10000) / 10000;

const pilihanSatuan = (satuanMaster) =>
  SATUAN_MASTER_MASSA.includes(upper(satuanMaster)) ? PILIHAN_SATUAN_MASSA : [];

// --- util ---
const qtyInput = (v, label) => {
  const s = teks(v);
  if (!/^\d+(\.\d{1,4})?$/.test(s)) {
    throw galat(
      `${label} harus angka lebih dari 0 (maks 4 desimal, desimal pakai titik)`,
    );
  }
  const n = Number(s);
  if (n <= 0) {
    throw galat(`${label} harus lebih dari 0`);
  }
  if (n > MAKS_QTY) {
    throw galat(`${label} terlalu besar`);
  }
  return n;
};

// Hasil: qty dalam satuan master + satuan yang diketik operator
const konversiQty = (jumlah, satuanInput, satuanMasterRaw, label) => {
  const master = upper(satuanMasterRaw);
  if (SATUAN_MASTER_MASSA.includes(master)) {
    const dari = upper(satuanInput) || master;
    if (!PILIHAN_SATUAN_MASSA.includes(dari)) {
      throw galat(`${label}: satuan harus KG, ONS, atau GR`);
    }
    const hasil = bulat4(
      (jumlah * GRAM_PER_SATUAN[dari]) / GRAM_PER_SATUAN[master],
    );
    if (hasil <= 0) {
      throw galat(
        `${label}: jumlah terlalu kecil setelah dikonversi ke ${master}`,
      );
    }
    if (hasil > MAKS_QTY) {
      throw galat(
        `${label}: jumlah terlalu besar setelah dikonversi ke ${master}`,
      );
    }
    return { qty: hasil, satuan: master, satuanInput: dari };
  }
  const dari = upper(satuanInput);
  if (dari && dari !== master) {
    throw galat(
      `${label}: bahan ini bersatuan ${String(satuanMasterRaw ?? "").trim() || "-"}, tidak bisa diinput dalam ${dari}`,
    );
  }
  return {
    qty: jumlah,
    satuan: String(satuanMasterRaw ?? "").trim() || null,
    satuanInput: master,
  };
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

// --- validasi payload ---
// Body: { Tanggal, Kode_Pabrik, Nomor_Cetak,
//         Bahan: [{ Kode_Bahan, Qty, Satuan }] }
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
    throw galat("Minimal satu pemakaian tinta/cat harus diisi");
  }

  const sudah = new Set();
  const bahan = daftar.map((t, i) => {
    const label = `Bahan ${i + 1}`;
    const s = teks(t?.Kode_Bahan);
    if (!/^\d+$/.test(s) || Number(s) <= 0) {
      throw galat(`${label}: bahan wajib dipilih`);
    }
    const kode = Number(s);
    if (!Number.isSafeInteger(kode)) {
      throw galat(`${label}: kode bahan tidak valid`);
    }
    if (sudah.has(kode)) {
      throw galat(`${label}: bahan ${kode} sudah ada di daftar`);
    }
    sudah.add(kode);
    const satuan = teks(t?.Satuan);
    if (satuan.length > 10) {
      throw galat(`${label}: satuan maksimal 10 karakter`);
    }
    return {
      kode,
      jumlah: qtyInput(t?.Qty, `${label}: Qty`),
      satuanInput: satuan,
    };
  });

  return { tanggal, pabrik, nomorCetak, bahan };
};

// LHK Cetak harus ada, milik cabang user, selokasi, dan tidak lebih baru dari
// tanggal Tinta
const pastikanCetak = async (q, data, user) => {
  const [rows] = await q.query(
    `SELECT DATE_FORMAT(lch_tanggal, '%Y-%m-%d') AS tgl,
            lch_pab_kode AS pabrik
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
};

// Bahan harus ada di master, kategori Obat & Tinta, divisi Spanduk, dan aktif.
// Bahan yang sudah tercatat di LHK ini (sudahAda) tetap boleh walau
// belakangan dinonaktifkan. Mengembalikan baris siap simpan (sudah dikonversi).
const validasiBahan = async (q, bahan, sudahAda = new Set()) => {
  const [master] = await q.query(
    `SELECT brg_kode, brg_satuan, brg_isaktif
     FROM ${T.barang}
     WHERE brg_kode IN (?) AND brg_ktg_kode = ? AND brg_divisi = ?`,
    [bahan.map((b) => b.kode), KATEGORI_TINTA, DIVISI_TINTA],
  );
  const peta = new Map(master.map((m) => [Number(m.brg_kode), m]));

  return bahan.map((b, i) => {
    const label = `Bahan ${i + 1}`;
    if (!KODE_RESEP.includes(b.kode) && !sudahAda.has(b.kode)) {
      throw galat(
        `${label}: bahan ${b.kode} tidak ada dalam daftar pemakaian obat`,
      );
    }
    const m = peta.get(b.kode);
    if (!m) {
      throw galat(
        `${label}: ${b.kode} bukan tinta/cat (Obat & Tinta) atau tidak ada di master`,
      );
    }
    if (Number(m.brg_isaktif) !== 1 && !sudahAda.has(b.kode)) {
      throw galat(`${label}: bahan ${b.kode} sudah tidak aktif`);
    }
    const k = konversiQty(b.jumlah, b.satuanInput, m.brg_satuan, label);
    return {
      kode: b.kode,
      qtyInput: b.jumlah,
      satuanInput: k.satuanInput,
      qty: k.qty,
      satuan: k.satuan,
    };
  });
};

const simpanBahan = async (conn, nomor, hasil) => {
  await conn.query(`DELETE FROM ${T.bahan} WHERE ltb_lnt_nomor = ?`, [nomor]);
  await conn.query(
    `INSERT INTO ${T.bahan}
       (ltb_lnt_nomor, ltb_brg_kode, ltb_qty_input, ltb_satuan_input,
        ltb_qty, ltb_satuan, ltb_nourut)
     VALUES ?`,
    [
      hasil.map((h, i) => [
        nomor,
        h.kode,
        h.qtyInput,
        h.satuanInput,
        h.qty,
        h.satuan,
        i + 1,
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

  const [bahan] = await db.query(
    `SELECT b.ltb_brg_kode AS Kode_Bahan,
            m.brg_nama AS Nama_Bahan,
            m.brg_satuan AS Satuan_Master,
            b.ltb_qty_input AS Qty_Input,
            b.ltb_satuan_input AS Satuan_Input,
            b.ltb_qty AS Qty,
            IFNULL(b.ltb_satuan, m.brg_satuan) AS Satuan
     FROM ${T.bahan} b
     LEFT JOIN ${T.barang} m ON m.brg_kode = b.ltb_brg_kode
     WHERE b.ltb_lnt_nomor = ?
     ORDER BY b.ltb_nourut`,
    [no],
  );

  return {
    ...hdr[0],
    Detail,
    Bahan: bahan.map((r) => ({
      Kode_Bahan: Number(r.Kode_Bahan),
      Nama_Bahan: r.Nama_Bahan,
      Satuan_Master: r.Satuan_Master,
      Pilihan_Satuan: pilihanSatuan(r.Satuan_Master),
      Qty_Input: Number(r.Qty_Input),
      Satuan_Input: r.Satuan_Input,
      Qty: Number(r.Qty),
      Satuan: r.Satuan,
    })),
  };
};

// --- Info LHK Cetak untuk mengisi form (SPK/MAP di dalamnya) ---
const getInfoCetak = async (nomor, user) => {
  const no = teks(nomor);
  const [rows] = await db.query(
    `SELECT c.lch_nomor AS Nomor,
            DATE_FORMAT(c.lch_tanggal, '%Y-%m-%d') AS Tanggal,
            c.lch_pab_kode AS Kode_Pabrik,
            p.pab_nama AS Nama_Pabrik
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
  return { ...rows[0], Detail: await ambilDetailCetak(db, no) };
};

// --- Lookup LHK Cetak berhalaman (non-superadmin hanya cabangnya sendiri) ---
const getLookupCetak = async (keyword, page, limit, user) => {
  const kata = teks(keyword);
  const limitNum = Math.min(Math.max(Math.floor(Number(limit)) || 50, 1), 100);
  const halaman = Math.max(Math.floor(Number(page)) || 1, 1);
  const offset = (halaman - 1) * limitNum;

  const kondisi = [];
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
  const where = kondisi.length ? `WHERE ${kondisi.join(" AND ")}` : "";

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

// --- Daftar bahan = baris default form: hanya bahan dalam daftar KODE_RESEP
// (sama dengan Resep LHK Proof), urutan mengikuti konfigurasi.
const getLookupBahan = async (search) => {
  const kata = teks(search);
  const kondisi = [
    "brg_ktg_kode = ?",
    "brg_divisi = ?",
    "brg_isaktif = 1",
    "brg_kode IN (?)",
  ];
  const params = [KATEGORI_TINTA, DIVISI_TINTA, KODE_RESEP];
  if (kata) {
    kondisi.push("(brg_nama LIKE ? OR brg_kode LIKE ?)");
    params.push(`%${kata}%`, `%${kata}%`);
  }
  const [rows] = await db.query(
    `SELECT brg_kode AS Kode, brg_nama AS Nama, brg_satuan AS Satuan
     FROM ${T.barang}
     WHERE ${kondisi.join(" AND ")}
     ORDER BY FIELD(brg_kode, ${KODE_RESEP.join(",")})`,
    params,
  );
  return rows.map((r) => ({
    Kode: Number(r.Kode),
    Nama: String(r.Nama ?? "").trim(),
    Satuan: r.Satuan,
    Pilihan_Satuan: pilihanSatuan(r.Satuan),
  }));
};

// --- CREATE ---
const createLhkTinta = async (body, user) => {
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
    await pastikanCetak(conn, data, user);
    const hasil = await validasiBahan(conn, data.bahan);

    const nomor = await buatNomor(conn, data.tanggal);
    await conn.query(
      `INSERT INTO ${T.hdr}
         (lnt_nomor, lnt_tanggal, lnt_pab_kode, lnt_lch_nomor,
          lnt_date_create, lnt_user_create)
       VALUES (?, ?, ?, ?, CURDATE(), ?)`,
      [nomor, data.tanggal, data.pabrik, data.nomorCetak, user?.kode ?? null],
    );
    await simpanBahan(conn, nomor, hasil);

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
    await pastikanCetak(conn, data, user);

    const [ada] = await conn.query(
      `SELECT ltb_brg_kode AS kode FROM ${T.bahan} WHERE ltb_lnt_nomor = ?`,
      [no],
    );
    const hasil = await validasiBahan(
      conn,
      data.bahan,
      new Set(ada.map((r) => Number(r.kode))),
    );

    await conn.query(
      `UPDATE ${T.hdr}
       SET lnt_tanggal = ?, lnt_pab_kode = ?,
           lnt_date_modified = CURDATE(), lnt_user_modified = ?
       WHERE lnt_nomor = ?`,
      [data.tanggal, data.pabrik, user?.kode ?? null, no],
    );
    await simpanBahan(conn, no, hasil);

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
