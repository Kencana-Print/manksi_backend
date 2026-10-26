const db = require("../../../config/database");
const { teks, parseTanggal, bilangan } = require("./lhkCommon");
const {
  T,
  galat,
  cekTutupBuku,
  pastikanLhkDiCabang,
  pastikanBelumDipakai,
  ambilInfoSpk,
  periksaSumber,
  pastikanPabrik,
  pastikanSpk,
} = require("./lhkQuiringShared");
const { pastikanRantaiLhk } = require("./lhkGerbangRantai");

const PREFIX_NOMOR = "LHK-Q";
const NOMOR_LOCK = "lhk_quiring_nomor";
// BS wajib diisi (0 bila tidak ada); kosong/tidak dikirim = ditolak
const bsWajib = (v, label) => {
  if (v === undefined || v === null || teks(v) === "") {
    throw galat(`${label} wajib diisi (isi 0 bila tidak ada BS)`);
  }
  return bilangan(v, label);
};

// --- validasi payload ---
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
    throw galat("Minimal satu baris SPK harus diisi");
  }

  const sudah = new Set();
  const baris = detail.map((d, i) => {
    const n = i + 1;
    const spk = teks(d?.Nomor_SPK);
    if (!spk) {
      throw galat(`Baris ${n}: nomor SPK wajib diisi`);
    }
    if (spk.length > 20) {
      throw galat(`Baris ${n}: nomor SPK maksimal 20 karakter`);
    }
    if (sudah.has(spk.toUpperCase())) {
      throw galat(`Baris ${n}: SPK ${spk} sudah ada di baris lain`);
    }
    sudah.add(spk.toUpperCase());

    const koli = bilangan(d.J_Koli, `Baris ${n}: Jumlah koli`);
    const oven = bilangan(d.J_Oven, `Baris ${n}: Jumlah oven`);
    const jemuran = bilangan(d.J_Jemuran, `Baris ${n}: Jumlah jemuran`);
    const potong = bilangan(d.J_Potong, `Baris ${n}: Jumlah potong`);
    if (koli + oven + jemuran + potong <= 0) {
      throw galat(
        `Baris ${n}: minimal satu dari Koli, Oven, Jemuran, atau Potong harus lebih dari 0`,
      );
    }

    const bsQuiring = bsWajib(d.BS_Quiring, `Baris ${n}: BS Quiring`);
    const bsCetak = bsWajib(d.BS_Cetak, `Baris ${n}: BS Cetak`);
    const bsBahan = bsWajib(d.BS_Bahan, `Baris ${n}: BS Bahan`);

    return { spk, koli, oven, jemuran, potong, bsQuiring, bsCetak, bsBahan };
  });

  return { tanggal, pabrik, baris };
};

// Sumber harus ada, divisi 1/5, cabang user, dan SPK (bukan MAP)
const validasiSumberBaris = async (q, baris, user) => {
  const daftar = baris.map((b) => b.spk);
  const peta = await ambilInfoSpk(q, daftar);
  for (const b of baris) {
    periksaSumber(peta.get(b.spk), b.spk, user);
  }
  await pastikanSpk(q, daftar);
};

const simpanDetail = async (conn, nomor, baris) => {
  await conn.query(`DELETE FROM ${T.dtl} WHERE lqd_lqh_nomor = ?`, [nomor]);
  const values = baris.map((b) => [
    nomor,
    b.spk,
    b.koli,
    b.oven,
    b.jemuran,
    b.potong,
    b.bsQuiring,
    b.bsCetak,
    b.bsBahan,
  ]);
  await conn.query(
    `INSERT INTO ${T.dtl}
       (lqd_lqh_nomor, lqd_spk_nomor, lqd_j_koli, lqd_j_oven,
        lqd_j_jemuran, lqd_j_potong,
        lqd_bs_quiring, lqd_bs_cetak, lqd_bs_bahan)
     VALUES ?`,
    [values],
  );
};

// LHK-Q.yymm.NNNN, dipanggil di dalam lock + transaksi
const buatNomor = async (conn, tanggalStr) => {
  const yymm = tanggalStr.slice(2, 4) + tanggalStr.slice(5, 7);
  const prefix = `${PREFIX_NOMOR}.${yymm}.`;
  const [rows] = await conn.query(
    `SELECT MAX(CAST(RIGHT(lqh_nomor, 4) AS UNSIGNED)) AS mx
     FROM ${T.hdr} WHERE lqh_nomor LIKE ?`,
    [`${prefix}%`],
  );
  const next = (Number(rows[0]?.mx) || 0) + 1;
  if (next > 9999) {
    throw galat("Nomor LHK bulan ini sudah mencapai batas (9999)");
  }
  return `${prefix}${String(next).padStart(4, "0")}`;
};

// --- LOAD ---
const getLhkQuiringById = async (nomor, user) => {
  const no = teks(nomor);
  const [hdr] = await db.query(
    `SELECT h.lqh_nomor AS Nomor,
            DATE_FORMAT(h.lqh_tanggal, '%Y-%m-%d') AS Tanggal,
            h.lqh_pab_kode AS Kode_Pabrik,
            p.pab_nama AS Nama_Pabrik
     FROM ${T.hdr} h
     LEFT JOIN ${T.pabrik} p ON p.pab_kode = h.lqh_pab_kode
     WHERE h.lqh_nomor = ?`,
    [no],
  );
  if (hdr.length === 0) {
    throw galat("Data LHK Quiring tidak ditemukan", "notFound");
  }
  await pastikanLhkDiCabang(db, no, user);

  const [detail] = await db.query(
    `SELECT d.lqd_spk_nomor AS Nomor_SPK,
            x.spk_nama AS Nama_SPK,
            x.spk_jumlah AS Jumlah_Order,
            x.spk_panjang AS Panjang,
            x.spk_lebar AS Lebar,
            d.lqd_j_koli AS J_Koli,
            d.lqd_j_oven AS J_Oven,
            d.lqd_j_jemuran AS J_Jemuran,
            d.lqd_j_potong AS J_Potong,
            d.lqd_bs_quiring AS BS_Quiring,
            d.lqd_bs_cetak AS BS_Cetak,
            d.lqd_bs_bahan AS BS_Bahan
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
     ) x ON x.spk_nomor = d.lqd_spk_nomor
     WHERE d.lqd_lqh_nomor = ?
     ORDER BY d.lqd_spk_nomor`,
    [no],
  );

  return { ...hdr[0], Detail: detail };
};

// --- Info SPK untuk mengisi baris (nama, jumlah, panjang, lebar) ---
const getInfoSpk = async (nomor, user) => {
  const no = teks(nomor);
  const peta = await ambilInfoSpk(db, [no]);
  const info = peta.get(no);
  periksaSumber(info, no, user);
  await pastikanSpk(db, [no]);
  // Cek rantai dini (Enter / pilih modal): SPK wajib sudah punya LHK Cetak.
  // Cek saat simpan tetap jadi pengaman utama.
  await pastikanRantaiLhk(db, {
    kodeLini: "QUIRING",
    daftarSpk: [no],
  });
  return {
    Nomor_SPK: info.nomor,
    Nama_SPK: info.nama,
    Jumlah_Order: info.jumlah,
    Panjang: info.panjang,
    Lebar: info.lebar,
  };
};

// --- Lookup pabrik ---
const getLookupPabrik = async (search) => {
  const kata = teks(search);
  const params = [];
  let where = "";
  if (kata) {
    where = "WHERE pab_kode LIKE ? OR pab_nama LIKE ?";
    params.push(`%${kata}%`, `%${kata}%`);
  }
  const [rows] = await db.query(
    `SELECT pab_kode AS Kode, pab_nama AS Nama
     FROM ${T.pabrik} ${where}
     ORDER BY pab_kode`,
    params,
  );
  return rows;
};

// --- CREATE ---
const createLhkQuiring = async (body, user) => {
  const data = siapkanData(body);
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
      kodeLini: "QUIRING",
      daftarSpk: data.baris.map((b) => b.spk),
    });

    const nomor = await buatNomor(conn, data.tanggal);
    try {
      await conn.query(
        `INSERT INTO ${T.hdr}
           (lqh_nomor, lqh_tanggal, lqh_pab_kode, lqh_date_create, lqh_user_create)
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
const updateLhkQuiring = async (nomor, body, user) => {
  const no = teks(nomor);
  const data = siapkanData(body);

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [lama] = await conn.query(
      `SELECT DATE_FORMAT(lqh_tanggal, '%Y-%m-%d') AS tgl
       FROM ${T.hdr} WHERE lqh_nomor = ? FOR UPDATE`,
      [no],
    );
    if (lama.length === 0) {
      throw galat("Data LHK Quiring tidak ditemukan", "notFound");
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
      kodeLini: "QUIRING",
      daftarSpk: data.baris.map((b) => b.spk),
      nomorLhk: no,
    });

    await conn.query(
      `UPDATE ${T.hdr}
       SET lqh_tanggal = ?, lqh_pab_kode = ?,
           lqh_date_modified = CURDATE(), lqh_user_modified = ?
       WHERE lqh_nomor = ?`,
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
  getLhkQuiringById,
  getInfoSpk,
  getLookupPabrik,
  createLhkQuiring,
  updateLhkQuiring,
};
