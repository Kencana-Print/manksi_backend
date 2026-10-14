const db = require("../../../config/database");
const {
  teks,
  round2,
  parseTanggal,
  angka,
  MAKS_ANGKA,
} = require("./lhkCommon");
const {
  T,
  galat,
  cekTutupBuku,
  filterCabang,
  pastikanLhkDiCabang,
  pastikanBelumDipakai,
  ambilInfoSpk,
  periksaSumber,
  pastikanPabrik,
} = require("./lhkPlotterShared");

const PREFIX_NOMOR = "LHK-P";
const NOMOR_LOCK = "lhk_plotter_nomor";
const MAKS_KETERANGAN = 200;

// --- validasi payload ---
const siapkanData = (body = {}) => {
  const tanggal = parseTanggal(body.Tanggal);

  const pabrik = teks(body.Kode_Pabrik);
  if (!pabrik) {
    throw galat("Pabrik wajib diisi");
  }
  if (pabrik.length > 10) {
    throw galat("Kode pabrik maksimal 10 karakter");
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

    const meter = angka(d.J_Meter, `Baris ${n}: Jumlah meter`);
    const lembar = angka(d.J_Lembar, `Baris ${n}: Jumlah lembar`);
    const pk = angka(d.J_PK, `Baris ${n}: Jumlah PK`);
    const mk = angka(d.J_MK, `Baris ${n}: Jumlah MK`);

    // Total dihitung server; faktor <= 0 => 0 (Delphi: nilai tak terinisialisasi)
    const totalMeter = meter > 0 && lembar > 0 ? round2(meter * lembar) : 0;
    const totalTinta = pk > 0 && mk > 0 ? round2(pk * mk) : 0;
    if (totalMeter > MAKS_ANGKA || totalTinta > MAKS_ANGKA) {
      throw galat(`Baris ${n}: hasil total terlalu besar`);
    }

    const ket = teks(d.Keterangan);
    if (ket.length > MAKS_KETERANGAN) {
      throw galat(
        `Baris ${n}: keterangan maksimal ${MAKS_KETERANGAN} karakter`,
      );
    }

    return { spk, meter, lembar, totalMeter, pk, mk, totalTinta, ket };
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

const simpanDetail = async (conn, nomor, baris) => {
  await conn.query(`DELETE FROM ${T.dtl} WHERE lpd_lph_nomor = ?`, [nomor]);
  const values = baris.map((b) => [
    nomor,
    b.spk,
    b.meter,
    b.lembar,
    b.totalMeter,
    b.pk,
    b.mk,
    b.totalTinta,
    b.ket,
  ]);
  await conn.query(
    `INSERT INTO ${T.dtl}
       (lpd_lph_nomor, lpd_spk_nomor, lpd_j_meter, lpd_j_lembar,
        lpd_j_totalmeter, lpd_j_pk, lpd_j_mk, lpd_j_totaltinta, lpd_keterangan)
     VALUES ?`,
    [values],
  );
};

// LHK-P.yymm.NNNN, dipanggil di dalam lock + transaksi
const buatNomor = async (conn, tanggalStr) => {
  const yymm = tanggalStr.slice(2, 4) + tanggalStr.slice(5, 7);
  const prefix = `${PREFIX_NOMOR}.${yymm}.`;
  const [rows] = await conn.query(
    `SELECT MAX(CAST(RIGHT(lph_nomor, 4) AS UNSIGNED)) AS mx
     FROM ${T.hdr} WHERE lph_nomor LIKE ?`,
    [`${prefix}%`],
  );
  const next = (Number(rows[0]?.mx) || 0) + 1;
  if (next > 9999) {
    throw galat(`Nomor LHK bulan ini sudah mencapai batas (9999)`);
  }
  return `${prefix}${String(next).padStart(4, "0")}`;
};

// --- LOAD ---
const getLhkPlotterById = async (nomor, user) => {
  const no = teks(nomor);
  const [hdr] = await db.query(
    `SELECT h.lph_nomor AS Nomor,
            DATE_FORMAT(h.lph_tanggal, '%Y-%m-%d') AS Tanggal,
            h.lph_pab_kode AS Kode_Pabrik,
            p.pab_nama AS Nama_Pabrik
     FROM ${T.hdr} h
     LEFT JOIN ${T.pabrik} p ON p.pab_kode = h.lph_pab_kode
     WHERE h.lph_nomor = ?`,
    [no],
  );
  if (hdr.length === 0) {
    throw galat("Data LHK Plotter tidak ditemukan", "notFound");
  }
  await pastikanLhkDiCabang(db, no, user);

  const [detail] = await db.query(
    `SELECT d.lpd_spk_nomor AS Nomor_SPK,
            x.spk_nama AS Nama_SPK,
            x.spk_jumlah AS Jumlah_Order,
            x.spk_panjang AS Panjang,
            x.spk_lebar AS Lebar,
            d.lpd_j_meter AS J_Meter,
            d.lpd_j_lembar AS J_Lembar,
            d.lpd_j_totalmeter AS J_TotalMeter,
            d.lpd_j_pk AS J_PK,
            d.lpd_j_mk AS J_MK,
            d.lpd_j_totaltinta AS J_Tinta,
            d.lpd_keterangan AS Keterangan
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
     ) x ON x.spk_nomor = d.lpd_spk_nomor
     WHERE d.lpd_lph_nomor = ?
     ORDER BY d.lpd_spk_nomor`,
    [no],
  );

  return { ...hdr[0], Detail: detail };
};

// --- Info SPK/MAP untuk mengisi baris (nama, jumlah, panjang, lebar) ---
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
const createLhkPlotter = async (body, user) => {
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

    const nomor = await buatNomor(conn, data.tanggal);
    try {
      await conn.query(
        `INSERT INTO ${T.hdr}
           (lph_nomor, lph_tanggal, lph_pab_kode, lph_date_create, lph_user_create)
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
const updateLhkPlotter = async (nomor, body, user) => {
  const no = teks(nomor);
  const data = siapkanData(body);

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [lama] = await conn.query(
      `SELECT DATE_FORMAT(lph_tanggal, '%Y-%m-%d') AS tgl
       FROM ${T.hdr} WHERE lph_nomor = ? FOR UPDATE`,
      [no],
    );
    if (lama.length === 0) {
      throw galat("Data LHK Plotter tidak ditemukan", "notFound");
    }

    // tutup buku: tanggal lama dan tanggal baru sama-sama dicek
    if (lama[0].tgl) {
      await cekTutupBuku(lama[0].tgl);
    }
    await cekTutupBuku(data.tanggal);

    await pastikanLhkDiCabang(conn, no, user);
    await pastikanBelumDipakai(conn, no);
    await pastikanPabrik(conn, data.pabrik);
    await validasiSumberBaris(conn, data.baris, user);

    await conn.query(
      `UPDATE ${T.hdr}
       SET lph_tanggal = ?, lph_pab_kode = ?,
           lph_date_modified = CURDATE(), lph_user_modified = ?
       WHERE lph_nomor = ?`,
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
  getLhkPlotterById,
  getInfoSpk,
  getLookupPabrik,
  createLhkPlotter,
  updateLhkPlotter,
};
