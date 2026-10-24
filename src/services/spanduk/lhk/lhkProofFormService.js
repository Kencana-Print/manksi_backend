const db = require("../../../config/database");
const {
  galat,
  teks,
  norm,
  parseTanggal,
  adalahSuperadmin,
  cabangUser,
  bilangan,
  MAKS_INT,
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
const { KODE_RESEP } = require("./lhkProofResep");

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

  return { tanggal, pabrik, baris, resep: siapkanResep(body) };
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

// Bahan resep dari master (nama + satuan diambil dari master, urutan sesuai konfigurasi)
const getLookupResep = async (q = db) => {
  const [rows] = await q.query(
    `SELECT brg_kode AS kode, brg_nama AS nama, brg_satuan AS satuan
     FROM ${T.barang} WHERE brg_kode IN (?)`,
    [KODE_RESEP],
  );
  const peta = new Map(rows.map((r) => [Number(r.kode), r]));
  return KODE_RESEP.filter((k) => peta.has(k)).map((k) => ({
    Kode: k,
    Nama: String(peta.get(k).nama ?? "").trim(),
    Satuan: String(peta.get(k).satuan ?? "").trim(),
  }));
};

const angkaResep = (v, label) => {
  const s = teks(v);
  if (s === "") {
    return 0;
  }
  if (!/^\d+(\.\d{1,4})?$/.test(s)) {
    throw galat(
      `${label} harus angka tidak negatif (maks 4 desimal, pakai titik)`,
    );
  }
  const n = Number(s);
  if (n > 999999999) {
    throw galat(`${label} terlalu besar`);
  }
  return n;
};

// Body.Resep: [{ Brg_Kode, Qty_Resep, Qty_Actual }] -> Map kode -> {resep, actual}
const siapkanResep = (body) => {
  const daftar = Array.isArray(body.Resep) ? body.Resep : [];
  const hasil = new Map();
  for (const r of daftar) {
    const kode = Number(r?.Brg_Kode);
    if (!KODE_RESEP.includes(kode)) {
      throw galat(`Bahan ${r?.Brg_Kode} tidak ada dalam daftar resep`);
    }
    if (hasil.has(kode)) {
      throw galat(`Bahan ${kode} muncul lebih dari sekali`);
    }
    hasil.set(kode, {
      resep: angkaResep(r.Qty_Resep, `Resep bahan ${kode}`),
      actual: angkaResep(r.Qty_Actual, `Actual bahan ${kode}`),
    });
  }
  return hasil;
};

const ambilResepLama = async (q, nomor) => {
  const [rows] = await q.query(
    `SELECT lpv_brg_kode AS kode, lpv_qty_resep AS resep
     FROM ${T.resep} WHERE lpv_lpr_nomor = ?`,
    [nomor],
  );
  return new Map(rows.map((r) => [Number(r.kode), Number(r.resep)]));
};

// Resep terkunci bila dokumen sudah punya resep > 0; Actual selalu dari payload.
const simpanResep = async (conn, nomor, resep, lama = null) => {
  const terkunci = !!lama && [...lama.values()].some((v) => v > 0);
  const master = await getLookupResep(conn);
  await conn.query(`DELETE FROM ${T.resep} WHERE lpv_lpr_nomor = ?`, [nomor]);
  const values = [];
  let urut = 0;
  for (const m of master) {
    const p = resep.get(m.Kode);
    const qResep = terkunci ? (lama.get(m.Kode) ?? 0) : (p?.resep ?? 0);
    const qActual = p?.actual ?? 0;
    if (qResep <= 0 && qActual <= 0) {
      continue;
    }
    urut += 1;
    values.push([nomor, m.Kode, qResep, qActual, m.Satuan.slice(0, 10), urut]);
  }
  if (values.length > 0) {
    await conn.query(
      `INSERT INTO ${T.resep}
         (lpv_lpr_nomor, lpv_brg_kode, lpv_qty_resep, lpv_qty_actual,
          lpv_satuan, lpv_nourut)
       VALUES ?`,
      [values],
    );
  }
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
    const spk = String(r.spk);
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
  const target = baris.filter((b) => !daftarKecuali.has(b.spk));
  const peta = await ambilPlangkanAfdruk(
    q,
    target.map((b) => b.spk),
  );
  for (const b of target) {
    const dariAfdruk = peta.get(b.spk);
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

// Hapus semua detail + dtl_2 LHK per nomor, lalu isi ulang.
// lprd_j_meter tidak ditulis (Delphi juga tidak; default 0).
const simpanDetail = async (conn, nomor, baris) => {
  await conn.query(`DELETE FROM ${T.dtl2} WHERE lprd2_lpr_nomor = ?`, [nomor]);
  await conn.query(`DELETE FROM ${T.dtl} WHERE lprd_lpr_nomor = ?`, [nomor]);

  const valuesDtl = baris.map((b) => [
    nomor,
    b.spk,
    b.jPlangkan,
    b.jProof,
    ...b.warna,
  ]);
  await conn.query(
    `INSERT INTO ${T.dtl}
       (lprd_lpr_nomor, lprd_spk_nomor, lprd_j_plangkan, lprd_j_proof,
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

  const Detail = detail.map((d) => ({
    ...d,
    Plangkan: ukuran.map((u) => ({
      Ukuran: u.Ukuran,
      Qty: peta.get(`${norm(d.Nomor_SPK)}|${kunciUkuran(u.Ukuran)}`) ?? 0,
    })),
  }));

  const opsi = await getLookupResep(db);
  const [resepRows] = await db.query(
    `SELECT lpv_brg_kode AS kode, lpv_qty_resep AS resep, lpv_qty_actual AS actual
     FROM ${T.resep} WHERE lpv_lpr_nomor = ?`,
    [no],
  );
  const petaResep = new Map(resepRows.map((r) => [Number(r.kode), r]));
  const Resep = opsi.map((o) => ({
    ...o,
    Qty_Resep: Number(petaResep.get(o.Kode)?.resep) || 0,
    Qty_Actual: Number(petaResep.get(o.Kode)?.actual) || 0,
  }));

  return {
    ...hdr[0],
    Detail,
    Resep,
    Resep_Terkunci: Resep.some((r) => r.Qty_Resep > 0),
  };
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
  const afdruk = (await ambilPlangkanAfdruk(db, [info.nomor])).get(info.nomor);
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
    await simpanDetail(conn, nomor, data.baris);
    await simpanResep(conn, nomor, data.resep);

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
      new Set(spkLama.map((r) => String(r.spk))),
    );
    await validasiUkuran(conn, data.baris);

    await conn.query(
      `UPDATE ${T.hdr}
       SET lpr_tanggal = ?, lpr_pab_kode = ?,
           lpr_date_modified = CURDATE(), lpr_user_modified = ?
       WHERE lpr_nomor = ?`,
      [data.tanggal, data.pabrik, user?.kode ?? null, no],
    );
    const resepLama = await ambilResepLama(conn, no);
    await simpanDetail(conn, no, data.baris);
    await simpanResep(conn, no, data.resep, resepLama);

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
