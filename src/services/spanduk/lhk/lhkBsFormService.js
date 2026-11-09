const db = require("../../../config/database");
const {
  teks,
  parseTanggal,
  bilangan,
  adalahSuperadmin,
  cabangUser,
  pastikanLokasiUser,
} = require("./lhkCommon");
const {
  T,
  galat,
  cekTutupBuku,
  pastikanLhkDiCabang,
  pastikanPabrik,
  pastikanSpk,
  ambilInfoSpk,
  periksaSumber,
} = require("./lhkBsShared");

const PREFIX_NOMOR = "LHK-B";
const NOMOR_LOCK = "lhk_bs_nomor";

// --- validasi payload ---
// Body: { Tanggal, Kode_Pabrik, Detail: [{ Nomor_SPK, BS_Quiring, BS_Cetak,
//         BS_Bahan, BS_Jahit, BS_Lipat }] }  (kosong dianggap 0)
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

    const bsQuiring = bilangan(d.BS_Quiring, `Baris ${n}: BS Quiring`);
    const bsCetak = bilangan(d.BS_Cetak, `Baris ${n}: BS Cetak`);
    const bsBahan = bilangan(d.BS_Bahan, `Baris ${n}: BS Bahan`);
    const bsJahit = bilangan(d.BS_Jahit, `Baris ${n}: BS Jahit`);
    const bsLipat = bilangan(d.BS_Lipat, `Baris ${n}: BS Lipat`);
    if (bsQuiring + bsCetak + bsBahan + bsJahit + bsLipat <= 0) {
      throw galat(`Baris ${n}: minimal satu kolom BS harus lebih dari 0`);
    }

    return { spk, bsQuiring, bsCetak, bsBahan, bsJahit, bsLipat };
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
  await conn.query(`DELETE FROM ${T.dtl} WHERE lbd_lbh_nomor = ?`, [nomor]);
  const values = baris.map((b) => [
    nomor,
    b.spk,
    b.bsQuiring,
    b.bsCetak,
    b.bsBahan,
    b.bsJahit,
    b.bsLipat,
  ]);
  await conn.query(
    `INSERT INTO ${T.dtl}
       (lbd_lbh_nomor, lbd_spk_nomor, lbd_bs_quiring, lbd_bs_cetak,
        lbd_bs_bahan, lbd_bs_jahit, lbd_bs_lipat)
     VALUES ?`,
    [values],
  );
};

// LHK-B.yymm.NNNN, dipanggil di dalam lock + transaksi
const buatNomor = async (conn, tanggalStr) => {
  const yymm = tanggalStr.slice(2, 4) + tanggalStr.slice(5, 7);
  const prefix = `${PREFIX_NOMOR}.${yymm}.`;
  const [rows] = await conn.query(
    `SELECT MAX(CAST(RIGHT(lbh_nomor, 4) AS UNSIGNED)) AS mx
     FROM ${T.hdr} WHERE lbh_nomor LIKE ?`,
    [`${prefix}%`],
  );
  const next = (Number(rows[0]?.mx) || 0) + 1;
  if (next > 9999) {
    throw galat("Nomor LHK bulan ini sudah mencapai batas (9999)");
  }
  return `${prefix}${String(next).padStart(4, "0")}`;
};

// --- LOAD ---
const getLhkBsById = async (nomor, user) => {
  const no = teks(nomor);
  const [hdr] = await db.query(
    `SELECT h.lbh_nomor AS Nomor,
            DATE_FORMAT(h.lbh_tanggal, '%Y-%m-%d') AS Tanggal,
            h.lbh_pab_kode AS Kode_Pabrik,
            p.pab_nama AS Nama_Pabrik
     FROM ${T.hdr} h
     LEFT JOIN ${T.pabrik} p ON p.pab_kode = h.lbh_pab_kode
     WHERE h.lbh_nomor = ?`,
    [no],
  );
  if (hdr.length === 0) {
    throw galat("Data LHK BS tidak ditemukan", "notFound");
  }
  await pastikanLhkDiCabang(db, no, user);

  const [detail] = await db.query(
    `SELECT d.lbd_spk_nomor AS Nomor_SPK,
            x.spk_nama AS Nama_SPK,
            x.spk_jumlah AS Jumlah_Order,
            x.spk_panjang AS Panjang,
            x.spk_lebar AS Lebar,
            d.lbd_bs_quiring AS BS_Quiring,
            d.lbd_bs_cetak AS BS_Cetak,
            d.lbd_bs_bahan AS BS_Bahan,
            d.lbd_bs_jahit AS BS_Jahit,
            d.lbd_bs_lipat AS BS_Lipat
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
     ) x ON x.spk_nomor = d.lbd_spk_nomor
     WHERE d.lbd_lbh_nomor = ?
     ORDER BY d.lbd_spk_nomor`,
    [no],
  );

  return { ...hdr[0], Detail: detail };
};

// --- Info SPK untuk mengisi baris (nama, jumlah, panjang, lebar) ---
// Tanpa gate rantai: cukup SPK valid di cabang user (keputusan 9 Nov)
const getInfoSpk = async (nomor, user) => {
  const no = teks(nomor);
  const peta = await ambilInfoSpk(db, [no]);
  const info = peta.get(no);
  periksaSumber(info, no, user);
  await pastikanSpk(db, [no]);
  return {
    Nomor_SPK: info.nomor,
    Nama_SPK: info.nama,
    Jumlah_Order: info.jumlah,
    Panjang: info.panjang,
    Lebar: info.lebar,
  };
};

// --- Lookup pabrik (non-superadmin hanya cabangnya) ---
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
const createLhkBs = async (body, user) => {
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

    const nomor = await buatNomor(conn, data.tanggal);
    try {
      await conn.query(
        `INSERT INTO ${T.hdr}
           (lbh_nomor, lbh_tanggal, lbh_pab_kode, lbh_date_create, lbh_user_create)
         VALUES (?, ?, ?, CURDATE(), ?)`,
        [nomor, data.tanggal, data.pabrik, user?.kode ?? null],
      );
    } catch (e) {
      if (e.code === "ER_DUP_ENTRY") {
        throw galat(
          `Nomor ${nomor} sudah dipakai input lain. Silakan simpan ulang.`,
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
const updateLhkBs = async (nomor, body, user) => {
  const no = teks(nomor);
  const data = siapkanData(body);
  pastikanLokasiUser(data.pabrik, user);

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [lama] = await conn.query(
      `SELECT DATE_FORMAT(lbh_tanggal, '%Y-%m-%d') AS tgl
       FROM ${T.hdr} WHERE lbh_nomor = ? FOR UPDATE`,
      [no],
    );
    if (lama.length === 0) {
      throw galat("Data LHK BS tidak ditemukan", "notFound");
    }

    // tutup buku: tanggal lama dan tanggal baru sama-sama dicek
    if (lama[0].tgl) {
      await cekTutupBuku(lama[0].tgl);
    }
    await cekTutupBuku(data.tanggal);

    await pastikanLhkDiCabang(conn, no, user);
    await pastikanPabrik(conn, data.pabrik);
    await validasiSumberBaris(conn, data.baris, user);

    await conn.query(
      `UPDATE ${T.hdr}
       SET lbh_tanggal = ?, lbh_pab_kode = ?,
           lbh_date_modified = CURDATE(), lbh_user_modified = ?
       WHERE lbh_nomor = ?`,
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
  getLhkBsById,
  getInfoSpk,
  getLookupPabrik,
  createLhkBs,
  updateLhkBs,
};
