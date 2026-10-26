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
} = require("./lhkKoliShared");
const { pastikanRantaiLhk } = require("./lhkGerbangRantai");

const PREFIX_NOMOR = "LHK-K";
const NOMOR_LOCK = "lhk_koli_nomor";
const MAKS_KOLI = 999;

const SUMBER_SPK = `
  SELECT spk_nomor, spk_nama, spk_jumlah,
         IFNULL(spk_panjang, 0) AS spk_panjang,
         IFNULL(spk_lebar, 0) AS spk_lebar
  FROM ${T.spk}
  UNION ALL
  SELECT mspk_nomor, mspk_nama, mspk_jumlah,
         IFNULL(mspk_panjang, 0), IFNULL(mspk_lebar, 0)
  FROM ${T.memoSpk}`;

// Body: { Tanggal, Kode_Pabrik, Detail: [{ Nomor_SPK, J_Koli }] }
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
    const koli = bilangan(d.J_Koli, `Baris ${n}: J Koli`);
    if (koli <= 0) {
      throw galat(`Baris ${n}: J Koli harus lebih dari 0`);
    }
    if (koli > MAKS_KOLI) {
      throw galat(`Baris ${n}: J Koli maksimal ${MAKS_KOLI}`);
    }
    return { spk, koli };
  });
  return { tanggal, pabrik, baris };
};

// Koli hanya untuk SPK (bukan MAP)
const pastikanSemuaSpk = async (q, daftar) => {
  const [rows] = await q.query(
    `SELECT spk_nomor FROM ${T.spk} WHERE spk_nomor IN (?)`,
    [daftar],
  );
  const ada = new Set(rows.map((r) => String(r.spk_nomor).toUpperCase()));
  const bukan = daftar.filter((n) => !ada.has(n.toUpperCase()));
  if (bukan.length > 0) {
    throw galat(`LHK Koli hanya untuk SPK, bukan MAP: ${bukan.join(", ")}`);
  }
};

const validasiSumberBaris = async (q, baris, user) => {
  const daftar = baris.map((b) => b.spk);
  const peta = await ambilInfoSpk(q, daftar);
  for (const b of baris) {
    periksaSumber(peta.get(b.spk), b.spk, user);
  }
  await pastikanSemuaSpk(q, daftar);
};

// LHK terkunci bila ada koli yang sudah discan (STBJ)
const pastikanBelumDiscan = async (q, nomor) => {
  const [rows] = await q.query(
    `SELECT lku_urut AS urut, lku_spk_nomor AS spk, lku_scan_stbj AS stbj
     FROM ${T.unit}
     WHERE lku_lkh_nomor = ? AND lku_scan_tgl IS NOT NULL LIMIT 1`,
    [nomor],
  );
  if (rows.length > 0) {
    throw galat(
      `LHK Koli ${nomor} tidak bisa diubah/dihapus: koli ${rows[0].urut} SPK ${rows[0].spk} sudah discan${rows[0].stbj ? ` di ${rows[0].stbj}` : ""}`,
    );
  }
};

// Sinkronkan unit: pertahankan urut yang masih berlaku, tambah yang kurang,
// buang yang berlebih (id lama tidak berubah, label lama tetap valid)
const sinkronUnit = async (conn, nomor, baris) => {
  const spkBaru = baris.map((b) => b.spk);
  await conn.query(
    `DELETE FROM ${T.unit} WHERE lku_lkh_nomor = ? AND lku_spk_nomor NOT IN (?)`,
    [nomor, spkBaru],
  );
  for (const b of baris) {
    await conn.query(
      `DELETE FROM ${T.unit}
       WHERE lku_lkh_nomor = ? AND lku_spk_nomor = ? AND lku_urut > ?`,
      [nomor, b.spk, b.koli],
    );
    const [ada] = await conn.query(
      `SELECT lku_urut AS urut FROM ${T.unit}
       WHERE lku_lkh_nomor = ? AND lku_spk_nomor = ?`,
      [nomor, b.spk],
    );
    const punya = new Set(ada.map((r) => Number(r.urut)));
    const baru = [];
    for (let u = 1; u <= b.koli; u += 1) {
      if (!punya.has(u)) {
        baru.push([nomor, b.spk, u, b.koli]);
      }
    }
    if (baru.length > 0) {
      await conn.query(
        `INSERT INTO ${T.unit}
           (lku_lkh_nomor, lku_spk_nomor, lku_urut, lku_total) VALUES ?`,
        [baru],
      );
    }
    await conn.query(
      `UPDATE ${T.unit} SET lku_total = ?
       WHERE lku_lkh_nomor = ? AND lku_spk_nomor = ?`,
      [b.koli, nomor, b.spk],
    );
  }
};

const simpanDetail = async (conn, nomor, baris) => {
  await conn.query(`DELETE FROM ${T.dtl} WHERE lkd_lkh_nomor = ?`, [nomor]);
  await conn.query(
    `INSERT INTO ${T.dtl} (lkd_lkh_nomor, lkd_spk_nomor, lkd_j_koli) VALUES ?`,
    [baris.map((b) => [nomor, b.spk, b.koli])],
  );
  await sinkronUnit(conn, nomor, baris);
};

const buatNomor = async (conn, tanggalStr) => {
  const yymm = tanggalStr.slice(2, 4) + tanggalStr.slice(5, 7);
  const prefix = `${PREFIX_NOMOR}.${yymm}.`;
  const [rows] = await conn.query(
    `SELECT MAX(CAST(RIGHT(lkh_nomor, 4) AS UNSIGNED)) AS mx
     FROM ${T.hdr} WHERE lkh_nomor LIKE ?`,
    [`${prefix}%`],
  );
  const next = (Number(rows[0]?.mx) || 0) + 1;
  if (next > 9999) {
    throw galat("Nomor LHK bulan ini sudah mencapai batas (9999)");
  }
  return `${prefix}${String(next).padStart(4, "0")}`;
};

const getLhkKoliById = async (nomor, user) => {
  const no = teks(nomor);
  const [hdr] = await db.query(
    `SELECT h.lkh_nomor AS Nomor,
            DATE_FORMAT(h.lkh_tanggal, '%Y-%m-%d') AS Tanggal,
            h.lkh_pab_kode AS Kode_Pabrik,
            p.pab_nama AS Nama_Pabrik
     FROM ${T.hdr} h
     LEFT JOIN ${T.pabrik} p ON p.pab_kode = h.lkh_pab_kode
     WHERE h.lkh_nomor = ?`,
    [no],
  );
  if (hdr.length === 0) {
    throw galat("Data LHK Koli tidak ditemukan", "notFound");
  }
  await pastikanLhkDiCabang(db, no, user);

  const [detail] = await db.query(
    `SELECT d.lkd_spk_nomor AS Nomor_SPK,
            x.spk_nama AS Nama_SPK,
            x.spk_jumlah AS Jumlah_Order,
            x.spk_panjang AS Panjang,
            x.spk_lebar AS Lebar,
            d.lkd_j_koli AS J_Koli
     FROM ${T.dtl} d
     LEFT JOIN (${SUMBER_SPK}) x ON x.spk_nomor = d.lkd_spk_nomor
     WHERE d.lkd_lkh_nomor = ?
     ORDER BY d.lkd_spk_nomor`,
    [no],
  );
  const [[sc]] = await db.query(
    `SELECT COUNT(*) AS n FROM ${T.unit}
     WHERE lku_lkh_nomor = ? AND lku_scan_tgl IS NOT NULL`,
    [no],
  );
  return { ...hdr[0], Detail: detail, Jml_Discan: Number(sc.n) };
};

const getInfoSpk = async (nomor, user) => {
  const no = teks(nomor);
  const peta = await ambilInfoSpk(db, [no]);
  const info = peta.get(no);
  periksaSumber(info, no, user);
  await pastikanSemuaSpk(db, [no]);
  // Cek rantai dini: SPK wajib sudah punya LHK Lipat
  await pastikanRantaiLhk(db, { kodeLini: "KOLI", daftarSpk: [no] });
  return {
    Nomor_SPK: info.nomor,
    Nama_SPK: info.nama,
    Jumlah_Order: info.jumlah,
    Panjang: info.panjang,
    Lebar: info.lebar,
  };
};

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
     FROM ${T.pabrik} ${where} ORDER BY pab_kode`,
    params,
  );
  return rows;
};

// Data label QR: satu baris per koli
const getPrintKoli = async (nomor, user) => {
  const no = teks(nomor);
  const [hdr] = await db.query(
    `SELECT h.lkh_nomor AS Nomor,
            DATE_FORMAT(h.lkh_tanggal, '%Y-%m-%d') AS Tanggal,
            h.lkh_pab_kode AS Kode_Pabrik
     FROM ${T.hdr} h WHERE h.lkh_nomor = ?`,
    [no],
  );
  if (hdr.length === 0) {
    throw galat("Data LHK Koli tidak ditemukan", "notFound");
  }
  await pastikanLhkDiCabang(db, no, user);
  const [units] = await db.query(
    `SELECT u.lku_id AS Id, u.lku_spk_nomor AS Nomor_SPK,
            x.spk_nama AS Nama_SPK, x.spk_panjang AS Panjang,
            x.spk_lebar AS Lebar, u.lku_urut AS Urut, u.lku_total AS Total
     FROM ${T.unit} u
     LEFT JOIN (${SUMBER_SPK}) x ON x.spk_nomor = u.lku_spk_nomor
     WHERE u.lku_lkh_nomor = ?
     ORDER BY u.lku_spk_nomor, u.lku_urut`,
    [no],
  );
  return { ...hdr[0], Units: units };
};

const createLhkKoli = async (body, user) => {
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
      kodeLini: "KOLI",
      daftarSpk: data.baris.map((b) => b.spk),
    });

    const nomor = await buatNomor(conn, data.tanggal);
    try {
      await conn.query(
        `INSERT INTO ${T.hdr}
           (lkh_nomor, lkh_tanggal, lkh_pab_kode, lkh_date_create, lkh_user_create)
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

const updateLhkKoli = async (nomor, body, user) => {
  const no = teks(nomor);
  const data = siapkanData(body);

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [lama] = await conn.query(
      `SELECT DATE_FORMAT(lkh_tanggal, '%Y-%m-%d') AS tgl
       FROM ${T.hdr} WHERE lkh_nomor = ? FOR UPDATE`,
      [no],
    );
    if (lama.length === 0) {
      throw galat("Data LHK Koli tidak ditemukan", "notFound");
    }
    if (lama[0].tgl) {
      await cekTutupBuku(lama[0].tgl);
    }
    await cekTutupBuku(data.tanggal);

    await pastikanLhkDiCabang(conn, no, user);
    await pastikanBelumDipakai(conn, no, user);
    await pastikanBelumDiscan(conn, no);
    await pastikanPabrik(conn, data.pabrik);
    await validasiSumberBaris(conn, data.baris, user);
    await pastikanRantaiLhk(conn, {
      kodeLini: "KOLI",
      daftarSpk: data.baris.map((b) => b.spk),
      nomorLhk: no,
    });

    await conn.query(
      `UPDATE ${T.hdr}
       SET lkh_tanggal = ?, lkh_pab_kode = ?,
           lkh_date_modified = CURDATE(), lkh_user_modified = ?
       WHERE lkh_nomor = ?`,
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
  getLhkKoliById,
  getInfoSpk,
  getLookupPabrik,
  getPrintKoli,
  createLhkKoli,
  updateLhkKoli,
  pastikanBelumDiscan,
};
