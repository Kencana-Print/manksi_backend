const db = require("../../../config/database");
const {
  galat,
  teks,
  norm,
  round2,
  parseTanggal,
  adalahSuperadmin,
  cabangUser,
} = require("./lhkCommon");
const {
  T,
  cekTutupBuku,
  pastikanLhkDiCabang,
  pastikanBelumDipakai,
  ambilInfoSpk,
  periksaSumber,
  pastikanPabrik,
} = require("./lhkTintaShared");
const { pastikanRantaiLhk } = require("./lhkGerbangRantai");

const PREFIX_NOMOR = "LHK-T";
const NOMOR_LOCK = "lhk_tinta_nomor";
const MAKS_QTY = 9999999999.99; // decimal(12,2)

// Bahan tinta/cat = master bahan kategori 3 (OBAT & TINTA) divisi Spanduk
const KATEGORI_TINTA = "3";
const DIVISI_TINTA = 1;

// --- util ---
const qtyTinta = (v, label) => {
  const s = teks(v);
  if (!/^\d+(\.\d+)?$/.test(s)) {
    throw galat(`${label} harus angka lebih dari 0 (desimal pakai titik)`);
  }
  const n = round2(Number(s));
  if (n <= 0) {
    throw galat(`${label} harus lebih dari 0`);
  }
  if (n > MAKS_QTY) {
    throw galat(`${label} terlalu besar`);
  }
  return n;
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
// Body: { Tanggal, Kode_Pabrik, Detail: [{ Nomor_SPK,
//         Tinta: [{ Kode_Bahan, Qty }] }] }
const siapkanData = (body = {}) => {
  const tanggal = parseTanggal(body.Tanggal);

  const pabrik = teks(body.Kode_Pabrik);
  if (!pabrik) {
    throw galat("Lokasi wajib diisi");
  }
  if (pabrik.length > 10) {
    throw galat("Kode lokasi maksimal 10 karakter");
  }

  const detail = Array.isArray(body.Detail) ? body.Detail : [];
  if (detail.length === 0) {
    throw galat("Minimal satu baris SPK/MAP harus diisi");
  }

  const sudahSpk = new Set();
  const baris = detail.map((d, i) => {
    const n = i + 1;
    const spk = teks(d?.Nomor_SPK);
    if (!spk) {
      throw galat(`Baris ${n}: nomor SPK/MAP wajib diisi`);
    }
    if (spk.length > 20) {
      throw galat(`Baris ${n}: nomor SPK/MAP maksimal 20 karakter`);
    }
    if (sudahSpk.has(spk)) {
      throw galat(`Baris ${n}: SPK/MAP ${spk} sudah ada di baris lain`);
    }
    sudahSpk.add(spk);

    const daftar = Array.isArray(d.Tinta) ? d.Tinta : [];
    if (daftar.length === 0) {
      throw galat(`Baris ${n}: minimal satu pemakaian tinta harus diisi`);
    }

    const sudahBahan = new Set();
    const tinta = daftar.map((t, j) => {
      const label = `Baris ${n}, tinta ${j + 1}`;
      const s = teks(t?.Kode_Bahan);
      if (!/^\d+$/.test(s) || Number(s) <= 0) {
        throw galat(`${label}: bahan wajib dipilih`);
      }
      const kode = Number(s);
      if (!Number.isSafeInteger(kode)) {
        throw galat(`${label}: kode bahan tidak valid`);
      }
      if (sudahBahan.has(kode)) {
        throw galat(`${label}: bahan ${kode} sudah ada di SPK yang sama`);
      }
      sudahBahan.add(kode);
      return { kode, qty: qtyTinta(t.Qty, `${label}: Qty`) };
    });

    return { spk, tinta };
  });

  return { tanggal, pabrik, baris };
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

// Bahan harus ada di master, kategori Obat & Tinta, divisi Spanduk, dan aktif.
// Bahan yang sudah tercatat di LHK ini (sudahAda) tetap boleh walau
// belakangan dinonaktifkan, supaya LHK lama masih bisa diubah.
const validasiBahan = async (q, baris, sudahAda = new Set()) => {
  const semua = [...new Set(baris.flatMap((b) => b.tinta.map((t) => t.kode)))];
  const [master] = await q.query(
    `SELECT brg_kode, brg_isaktif
     FROM ${T.barang}
     WHERE brg_kode IN (?) AND brg_ktg_kode = ? AND brg_divisi = ?`,
    [semua, KATEGORI_TINTA, DIVISI_TINTA],
  );
  const peta = new Map(master.map((m) => [Number(m.brg_kode), m]));

  baris.forEach((b, i) => {
    for (const t of b.tinta) {
      const m = peta.get(t.kode);
      if (!m) {
        throw galat(
          `Baris ${i + 1}: bahan ${t.kode} bukan tinta/cat (Obat & Tinta) atau tidak ada di master`,
        );
      }
      if (Number(m.brg_isaktif) !== 1 && !sudahAda.has(t.kode)) {
        throw galat(`Baris ${i + 1}: bahan ${t.kode} sudah tidak aktif`);
      }
    }
  });
};

// Hapus semua detail LHK lalu isi ulang (dtl2 per nomor, bukan per SPK,
// supaya SPK yang dibuang ikut bersih)
const simpanDetail = async (conn, nomor, baris) => {
  await conn.query(`DELETE FROM ${T.dtl2} WHERE lnd2_lnt_nomor = ?`, [nomor]);
  await conn.query(`DELETE FROM ${T.dtl} WHERE lnd_lnt_nomor = ?`, [nomor]);

  await conn.query(
    `INSERT INTO ${T.dtl} (lnd_lnt_nomor, lnd_spk_nomor) VALUES ?`,
    [baris.map((b) => [nomor, b.spk])],
  );

  const valuesDtl2 = [];
  for (const b of baris) {
    for (const t of b.tinta) {
      valuesDtl2.push([nomor, b.spk, t.kode, t.qty]);
    }
  }
  await conn.query(
    `INSERT INTO ${T.dtl2}
       (lnd2_lnt_nomor, lnd2_spk_nomor, lnd2_brg_kode, lnd2_qty)
     VALUES ?`,
    [valuesDtl2],
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

// --- LOAD ---
const getLhkTintaById = async (nomor, user) => {
  const no = teks(nomor);
  const [hdr] = await db.query(
    `SELECT h.lnt_nomor AS Nomor,
            DATE_FORMAT(h.lnt_tanggal, '%Y-%m-%d') AS Tanggal,
            h.lnt_pab_kode AS Kode_Pabrik,
            p.pab_nama AS Nama_Pabrik
     FROM ${T.hdr} h
     LEFT JOIN ${T.pabrik} p ON p.pab_kode = h.lnt_pab_kode
     WHERE h.lnt_nomor = ?`,
    [no],
  );
  if (hdr.length === 0) {
    throw galat("Data LHK Tinta tidak ditemukan", "notFound");
  }
  await pastikanLhkDiCabang(db, no, user);

  const [detail] = await db.query(
    `SELECT d.lnd_spk_nomor AS Nomor_SPK,
            x.spk_nama AS Nama_SPK,
            x.spk_jumlah AS Jumlah_Order,
            x.spk_panjang AS Panjang,
            x.spk_lebar AS Lebar
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
     ) x ON x.spk_nomor = d.lnd_spk_nomor
     WHERE d.lnd_lnt_nomor = ?
     ORDER BY d.lnd_spk_nomor`,
    [no],
  );

  const [tintaRows] = await db.query(
    `SELECT t.lnd2_spk_nomor AS spk,
            t.lnd2_brg_kode AS Kode_Bahan,
            b.brg_nama AS Nama_Bahan,
            b.brg_satuan AS Satuan,
            t.lnd2_qty AS Qty
     FROM ${T.dtl2} t
     LEFT JOIN ${T.barang} b ON b.brg_kode = t.lnd2_brg_kode
     WHERE t.lnd2_lnt_nomor = ?
     ORDER BY b.brg_nama, t.lnd2_brg_kode`,
    [no],
  );
  const peta = new Map();
  for (const r of tintaRows) {
    const kunci = norm(r.spk);
    if (!peta.has(kunci)) {
      peta.set(kunci, []);
    }
    peta.get(kunci).push({
      Kode_Bahan: Number(r.Kode_Bahan),
      Nama_Bahan: r.Nama_Bahan,
      Satuan: r.Satuan,
      Qty: Number(r.Qty),
    });
  }

  const Detail = detail.map((d) => ({
    ...d,
    Tinta: peta.get(norm(d.Nomor_SPK)) ?? [],
  }));

  return { ...hdr[0], Detail };
};

// --- Info SPK/MAP untuk mengisi baris ---
const getInfoSpk = async (nomor, user) => {
  const no = teks(nomor);
  const peta = await ambilInfoSpk(db, [no]);
  const info = peta.get(no);
  periksaSumber(info, no, user);
  return {
    Nomor_SPK: info.nomor,
    Nama_SPK: info.nama,
    Jumlah_Order: info.jumlah,
    Panjang: info.panjang,
    Lebar: info.lebar,
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

// --- Lookup bahan tinta/cat (aktif, kategori Obat & Tinta, divisi Spanduk) ---
const getLookupBahan = async (search) => {
  const kata = teks(search);
  const kondisi = ["brg_ktg_kode = ?", "brg_divisi = ?", "brg_isaktif = 1"];
  const params = [KATEGORI_TINTA, DIVISI_TINTA];
  if (kata) {
    kondisi.push("(brg_nama LIKE ? OR brg_kode LIKE ?)");
    params.push(`%${kata}%`, `%${kata}%`);
  }
  const [rows] = await db.query(
    `SELECT brg_kode AS Kode, brg_nama AS Nama, brg_satuan AS Satuan
     FROM ${T.barang}
     WHERE ${kondisi.join(" AND ")}
     ORDER BY brg_nama
     LIMIT 100`,
    params,
  );
  return rows.map((r) => ({
    Kode: Number(r.Kode),
    Nama: r.Nama,
    Satuan: r.Satuan,
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
    await validasiSumberBaris(conn, data.baris, user);
    await pastikanRantaiLhk(conn, {
      kodeLini: "TINTA",
      daftarSpk: data.baris.map((b) => b.spk),
    });
    await validasiBahan(conn, data.baris);

    const nomor = await buatNomor(conn, data.tanggal);
    await conn.query(
      `INSERT INTO ${T.hdr}
         (lnt_nomor, lnt_tanggal, lnt_pab_kode, lnt_date_create, lnt_user_create)
       VALUES (?, ?, ?, CURDATE(), ?)`,
      [nomor, data.tanggal, data.pabrik, user?.kode ?? null],
    );
    await simpanDetail(conn, nomor, data.baris);

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
      `SELECT DATE_FORMAT(lnt_tanggal, '%Y-%m-%d') AS tgl
       FROM ${T.hdr} WHERE lnt_nomor = ? FOR UPDATE`,
      [no],
    );
    if (lama.length === 0) {
      throw galat("Data LHK Tinta tidak ditemukan", "notFound");
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
      kodeLini: "TINTA",
      daftarSpk: data.baris.map((b) => b.spk),
      nomorLhk: no,
    });

    const [ada] = await conn.query(
      `SELECT DISTINCT lnd2_brg_kode AS kode FROM ${T.dtl2}
       WHERE lnd2_lnt_nomor = ?`,
      [no],
    );
    await validasiBahan(
      conn,
      data.baris,
      new Set(ada.map((r) => Number(r.kode))),
    );

    await conn.query(
      `UPDATE ${T.hdr}
       SET lnt_tanggal = ?, lnt_pab_kode = ?,
           lnt_date_modified = CURDATE(), lnt_user_modified = ?
       WHERE lnt_nomor = ?`,
      [data.tanggal, data.pabrik, user?.kode ?? null, no],
    );
    await simpanDetail(conn, no, data.baris);

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
  getInfoSpk,
  getLookupPabrik,
  getLookupBahan,
  createLhkTinta,
  updateLhkTinta,
};
