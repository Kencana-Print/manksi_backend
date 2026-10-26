const db = require("../../config/database");
const {
  galat,
  adalahSuperadmin,
  cabangUser,
  cekTutupBuku,
} = require("./lhk/lhkCommon");
const { KESESUAIAN_SPANDUK } = require("./bastMapSpandukFormService");

const T = {
  hdr: "kencanaprint.tmutasi_marketing_spanduk",
  dtl: "kencanaprint.tmutasi_marketing_spanduk_dtl",
  memo: "kencanaprint.tmemospk",
  user: "kencanaprint.tuser",
  bast: "kencanaprint.tkesesuaianmap",
  lock: "kencanaprint.tkesesuaianmap_lock",
  putus: "kencanaprint.tkesesuaianmap_keputusan",
};

const DIVISI_SPANDUK = 1;
const MAKS_KETERANGAN = 200;
const PREFIX_NOMOR = "MTM";
const MAKS_JUMLAH = 99999999.99;
// false = jumlah kirim boleh melebihi jumlah jadi (belum diputuskan)
const BATASI_KIRIM_MAKS_JADI = false;

const str = (v) => String(v ?? "").trim();
const MO_SQL = `IFNULL(NULLIF(u.user_nama, ''), IFNULL(m.user_create, ''))`;
// BAST "semua N" hanya boleh diserahkan bila keputusannya LANJUT.
const KODE_SPANDUK = KESESUAIAN_SPANDUK.join(",");
const SQL_BOLEH_SERAH = `(
  EXISTS (SELECT 1 FROM ${T.putus} p WHERE p.map = m.mspk_nomor AND p.keputusan = 'LANJUT')
  OR NOT (
    EXISTS (SELECT 1 FROM ${T.bast} k WHERE k.mspk_nomor = m.mspk_nomor AND k.kode_sesuai IN (${KODE_SPANDUK}))
    AND NOT EXISTS (SELECT 1 FROM ${T.bast} k WHERE k.mspk_nomor = m.mspk_nomor AND k.kode_sesuai IN (${KODE_SPANDUK}) AND k.status <> 'N')
  )
)`;

// --- Validasi payload ---
const periksaTanggal = (v) => {
  const s = str(v);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw galat("Tanggal tidak valid");
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) {
    throw galat("Tanggal tidak valid");
  }
  return s;
};

const parseKirim = (v, nomor) => {
  const s = str(v);
  if (!/^\d+(\.\d{1,2})?$/.test(s)) {
    throw galat(
      `Jumlah kirim MAP ${nomor} harus angka (maks 2 desimal, desimal pakai titik)`,
    );
  }
  const n = Number(s);
  if (n <= 0) throw galat(`Jumlah kirim MAP ${nomor} harus lebih dari 0`);
  if (n > MAKS_JUMLAH) throw galat(`Jumlah kirim MAP ${nomor} terlalu besar`);
  return n;
};

const siapkanPayload = (p) => {
  const tanggal = periksaTanggal(p?.tanggal);
  const keterangan = str(p?.keterangan);
  if (keterangan.length > MAKS_KETERANGAN) {
    throw galat(`Keterangan maksimal ${MAKS_KETERANGAN} karakter`);
  }
  const daftar = Array.isArray(p?.maps) ? p.maps : [];
  const maps = daftar
    .map((m) => ({ nomor: str(m?.nomor), qtyKirim: m?.qtyKirim }))
    .filter((m) => m.nomor !== "")
    .map((m) => ({
      nomor: m.nomor,
      qtyKirim: parseKirim(m.qtyKirim, m.nomor),
    }));
  if (maps.length === 0) throw galat("Pilih minimal satu MAP");
  if (new Set(maps.map((m) => m.nomor.toUpperCase())).size !== maps.length) {
    throw galat("Ada MAP yang terpilih ganda");
  }
  return { tanggal, keterangan, maps };
};

const petakanGalat = (e) =>
  e && e.code === "ER_DUP_ENTRY"
    ? galat(
        "Ada MAP yang sudah diserahkan di dokumen lain. Muat ulang daftar MAP.",
      )
    : e;

// --- Penomoran: MTM.{YYYY}{MM}.{NNNN}, reset tiap bulan (dipanggil di bawah GET_LOCK) ---
const buatNomor = async (conn, tanggal) => {
  const prefix = `${PREFIX_NOMOR}.${tanggal.slice(0, 4)}${tanggal.slice(5, 7)}.`;
  const [rows] = await conn.query(
    `SELECT MAX(CAST(RIGHT(mmk_nomor, 4) AS UNSIGNED)) AS mx
     FROM ${T.hdr} WHERE mmk_nomor LIKE ?`,
    [`${prefix}%`],
  );
  const next = (Number(rows[0]?.mx) || 0) + 1;
  if (next > 9999)
    throw galat("Nomor Mutasi Marketing bulan ini sudah mencapai batas (9999)");
  return `${prefix}${String(next).padStart(4, "0")}`;
};

// --- Validasi & kunci MAP yang akan diserahkan ---
// nomorDok: nomor dokumen yang sedang diubah ("" untuk dokumen baru)
const siapkanMap = async (conn, daftar, user, nomorDok) => {
  await conn.query(
    `SELECT mspk_nomor FROM ${T.memo} WHERE mspk_nomor IN (?) FOR UPDATE`,
    [daftar],
  );

  const [rows] = await conn.query(
    `SELECT m.mspk_nomor, m.mspk_divisi, m.mspk_cmo, m.mspk_cab,
            m.mspk_jumlah_jadi, m.mspk_nama, m.mspk_ukuran,
            (SELECT COUNT(*) FROM ${T.bast} k WHERE k.mspk_nomor = m.mspk_nomor) AS jml_bast,
            (SELECT COUNT(*) FROM ${T.lock} l
              WHERE l.map = m.mspk_nomor AND l.apv = 'N') AS jml_lock,
            (SELECT IF(${SQL_BOLEH_SERAH}, 1, 0)) AS boleh_serah,
            (SELECT d.mmkd_nomor FROM ${T.dtl} d
              WHERE d.mmkd_mspk_nomor = m.mspk_nomor LIMIT 1) AS doc_lain
     FROM ${T.memo} m
     WHERE m.mspk_nomor IN (?)`,
    [daftar],
  );
  const peta = new Map(
    rows.map((r) => [String(r.mspk_nomor).toUpperCase(), r]),
  );

  const cabUser = adalahSuperadmin(user) ? null : cabangUser(user);
  const hasil = [];
  for (const n of daftar) {
    const r = peta.get(n.toUpperCase());
    if (!r) throw galat(`MAP ${n} tidak ditemukan`, "notFound");
    const no = r.mspk_nomor;
    if (!str(r.mspk_cab)) {
      throw galat(
        `MAP ${no} belum punya cabang (data lama), tidak bisa diserahkan`,
      );
    }
    if (Number(r.mspk_divisi) !== DIVISI_SPANDUK)
      throw galat(`MAP ${no} bukan MAP Spanduk`);
    if (!str(r.mspk_cmo)) throw galat(`MAP ${no} belum di-approve CMO`);
    if (cabUser && str(r.mspk_cab) !== cabUser) {
      throw galat(`MAP ${no} bukan milik cabang Anda`, "forbidden");
    }
    if (!Number(r.jml_bast)) throw galat(`MAP ${no} belum dibuatkan BAST MAP`);
    if (Number(r.jml_lock)) throw galat(`BAST MAP ${no} masih On Progress`);
    if (!Number(r.boleh_serah)) {
      throw galat(
        `BAST MAP ${no} berstatus N dan belum diputuskan LANJUT (lihat Cetak BAST MAP)`,
      );
    }
    if (r.doc_lain && r.doc_lain !== nomorDok) {
      throw galat(`MAP ${no} sudah diserahkan pada ${r.doc_lain}`);
    }
    hasil.push(r);
  }
  if (new Set(hasil.map((r) => str(r.mspk_cab))).size > 1) {
    throw galat(
      "Semua MAP dalam satu dokumen harus berasal dari cabang yang sama",
    );
  }
  return hasil;
};

// qtyLama: snapshot jumlah jadi dokumen lama. kirim: Map nomor(UPPER) -> jumlah kirim.
const sisipDetail = async (conn, nomor, maps, qtyLama, kirim) => {
  let urut = 1;
  for (const r of maps) {
    const kunci = String(r.mspk_nomor).toUpperCase();
    const jadi = qtyLama?.get(kunci) ?? Number(r.mspk_jumlah_jadi);
    if (!(jadi > 0))
      throw galat(`Jumlah jadi BAST MAP ${r.mspk_nomor} masih 0`);
    const qtyKirim = kirim.get(kunci);
    if (!(qtyKirim > 0)) {
      throw galat(`Jumlah kirim MAP ${r.mspk_nomor} harus lebih dari 0`);
    }
    if (BATASI_KIRIM_MAKS_JADI && qtyKirim > jadi) {
      throw galat(
        `Jumlah kirim MAP ${r.mspk_nomor} (${qtyKirim}) melebihi jumlah jadi (${jadi})`,
      );
    }
    await conn.query(
      `INSERT INTO ${T.dtl}
         (mmkd_nomor, mmkd_mspk_nomor, mmkd_qty, mmkd_qty_kirim, mmkd_no_urut, date_create)
       VALUES (?, ?, ?, ?, ?, NOW())`,
      [nomor, r.mspk_nomor, jadi, qtyKirim, urut++],
    );
  }
};

// --- LOOKUP: MAP yang boleh diserahkan (dimuat sekali, dicari di klien) ---
const getLookupMap = async (user) => {
  const params = [];
  let sqlCab = "";
  if (!adalahSuperadmin(user)) {
    sqlCab = "AND m.mspk_cab = ?";
    params.push(cabangUser(user));
  }
  const [rows] = await db.query(
    `SELECT m.mspk_nomor AS Nomor,
            DATE_FORMAT(m.mspk_tanggal, '%Y-%m-%d') AS Tanggal,
            IFNULL(m.mspk_nama, '') AS Nama,
            IFNULL(m.mspk_ukuran, '') AS Ukuran,
            IFNULL(m.mspk_jumlah_jadi, 0) AS Jumlah,
            IFNULL(m.mspk_tipe, '') AS Tipe,
            m.mspk_cab AS Lokasi,
            ${MO_SQL} AS MO
     FROM ${T.memo} m
     LEFT JOIN ${T.user} u ON u.user_kode = m.user_create
     WHERE m.mspk_divisi = ${DIVISI_SPANDUK}
       AND m.mspk_cmo <> ''
       AND m.mspk_jumlah_jadi > 0
       AND m.mspk_cab <> ''
       AND EXISTS (SELECT 1 FROM ${T.bast} k WHERE k.mspk_nomor = m.mspk_nomor)
       AND NOT EXISTS (SELECT 1 FROM ${T.lock} l WHERE l.map = m.mspk_nomor AND l.apv = 'N')
       AND NOT EXISTS (SELECT 1 FROM ${T.dtl} d WHERE d.mmkd_mspk_nomor = m.mspk_nomor)
       AND ${SQL_BOLEH_SERAH}
       ${sqlCab}
     ORDER BY m.mspk_tanggal DESC, m.mspk_nomor DESC`,
    params,
  );
  return rows;
};

// --- LOAD dokumen (mode ubah) ---
const getFormData = async (nomor, user) => {
  const no = str(nomor);
  const [hdr] = await db.query(
    `SELECT mmk_nomor AS nomor,
            DATE_FORMAT(mmk_tanggal, '%Y-%m-%d') AS tanggal,
            mmk_cab AS cab,
            IFNULL(mmk_keterangan, '') AS keterangan
     FROM ${T.hdr} WHERE mmk_nomor = ?`,
    [no],
  );
  if (hdr.length === 0)
    throw galat("Dokumen Mutasi Marketing tidak ditemukan", "notFound");
  if (!adalahSuperadmin(user) && str(hdr[0].cab) !== cabangUser(user)) {
    throw galat("Dokumen ini bukan milik cabang Anda", "forbidden");
  }

  const [maps] = await db.query(
    `SELECT d.mmkd_mspk_nomor AS nomor,
            IFNULL(m.mspk_nama, '') AS nama,
            IFNULL(m.mspk_ukuran, '') AS ukuran,
            d.mmkd_qty AS qtyJadi,
            d.mmkd_qty_kirim AS qtyKirim,
            ${MO_SQL} AS mo,
            DATE_FORMAT(d.mmkd_diterima_tgl, '%Y-%m-%d') AS tglDiterima
     FROM ${T.dtl} d
     LEFT JOIN ${T.memo} m ON m.mspk_nomor = d.mmkd_mspk_nomor
     LEFT JOIN ${T.user} u ON u.user_kode = m.user_create
     WHERE d.mmkd_nomor = ?
     ORDER BY d.mmkd_no_urut, d.mmkd_mspk_nomor`,
    [no],
  );
  return {
    header: hdr[0],
    maps,
    sudahDiterima: maps.some((r) => r.tglDiterima),
  };
};

// --- CREATE ---
const create = async (payload, user) => {
  const d = siapkanPayload(payload);
  await cekTutupBuku(d.tanggal);

  const conn = await db.getConnection();
  const kunci = `MTM-${d.tanggal.slice(0, 4)}${d.tanggal.slice(5, 7)}`;
  let dapatKunci = false;
  try {
    const [[lk]] = await conn.query("SELECT GET_LOCK(?, 10) AS ok", [kunci]);
    if (Number(lk.ok) !== 1)
      throw galat("Sistem sedang membuat nomor, coba lagi");
    dapatKunci = true;

    await conn.beginTransaction();
    const maps = await siapkanMap(
      conn,
      d.maps.map((m) => m.nomor),
      user,
      "",
    );
    const nomor = await buatNomor(conn, d.tanggal);

    await conn.query(
      `INSERT INTO ${T.hdr}
         (mmk_nomor, mmk_tanggal, mmk_cab, mmk_keterangan, date_create, user_create)
       VALUES (?, ?, ?, ?, NOW(), ?)`,
      [nomor, d.tanggal, str(maps[0].mspk_cab), d.keterangan, user.kode],
    );
    const kirim = new Map(
      d.maps.map((m) => [m.nomor.toUpperCase(), m.qtyKirim]),
    );
    await sisipDetail(conn, nomor, maps, null, kirim);

    await conn.commit();
    return { nomor };
  } catch (e) {
    await conn.rollback().catch(() => {});
    throw petakanGalat(e);
  } finally {
    if (dapatKunci)
      await conn.query("SELECT RELEASE_LOCK(?)", [kunci]).catch(() => {});
    conn.release();
  }
};

// --- UPDATE ---
const update = async (nomorUrl, payload, user) => {
  const nomor = str(nomorUrl);
  const d = siapkanPayload(payload);

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [lama] = await conn.query(
      `SELECT mmk_nomor, mmk_cab, DATE_FORMAT(mmk_tanggal, '%Y-%m-%d') AS tgl
       FROM ${T.hdr} WHERE mmk_nomor = ? FOR UPDATE`,
      [nomor],
    );
    if (lama.length === 0)
      throw galat("Dokumen Mutasi Marketing tidak ditemukan", "notFound");
    if (!adalahSuperadmin(user) && str(lama[0].mmk_cab) !== cabangUser(user)) {
      throw galat("Dokumen ini bukan milik cabang Anda", "forbidden");
    }

    const [dtlLama] = await conn.query(
      `SELECT mmkd_mspk_nomor, mmkd_qty, mmkd_diterima_tgl FROM ${T.dtl} WHERE mmkd_nomor = ?`,
      [nomor],
    );
    if (dtlLama.some((r) => r.mmkd_diterima_tgl)) {
      throw galat(
        "Dokumen tidak bisa diubah: sudah ada MAP yang diterima marketing",
      );
    }

    await cekTutupBuku(lama[0].tgl);
    await cekTutupBuku(d.tanggal);

    const maps = await siapkanMap(
      conn,
      d.maps.map((m) => m.nomor),
      user,
      nomor,
    );
    // Qty MAP yang sudah ada di dokumen dipertahankan (snapshot saat diserahkan)
    const qtyLama = new Map(
      dtlLama.map((r) => [
        String(r.mmkd_mspk_nomor).toUpperCase(),
        Number(r.mmkd_qty),
      ]),
    );

    await conn.query(`DELETE FROM ${T.dtl} WHERE mmkd_nomor = ?`, [nomor]);
    await conn.query(
      `UPDATE ${T.hdr}
       SET mmk_tanggal = ?, mmk_cab = ?, mmk_keterangan = ?,
           date_modified = NOW(), user_modified = ?
       WHERE mmk_nomor = ?`,
      [d.tanggal, str(maps[0].mspk_cab), d.keterangan, user.kode, nomor],
    );
    const kirim = new Map(
      d.maps.map((m) => [m.nomor.toUpperCase(), m.qtyKirim]),
    );
    await sisipDetail(conn, nomor, maps, qtyLama, kirim);

    await conn.commit();
    return { nomor };
  } catch (e) {
    await conn.rollback().catch(() => {});
    throw petakanGalat(e);
  } finally {
    conn.release();
  }
};

// --- DATA CETAK: header + MAP (dengan tipe dari memo), guard sama dengan getFormData ---
const getPrintData = async (nomor, user) => {
  const data = await getFormData(nomor, user);
  const daftar = data.maps.map((m) => m.nomor);

  const [pembuat] = await db.query(
    `SELECT IFNULL(NULLIF(u.user_nama, ''), IFNULL(h.user_create, '')) AS pembuat
     FROM ${T.hdr} h
     LEFT JOIN ${T.user} u ON u.user_kode = h.user_create
     WHERE h.mmk_nomor = ?`,
    [data.header.nomor],
  );

  const tipe = new Map();
  if (daftar.length > 0) {
    const [rows] = await db.query(
      `SELECT mspk_nomor, IFNULL(mspk_tipe, '') AS tipe
       FROM ${T.memo} WHERE mspk_nomor IN (?)`,
      [daftar],
    );
    for (const r of rows) tipe.set(String(r.mspk_nomor).toUpperCase(), r.tipe);
  }

  return {
    header: { ...data.header, pembuat: str(pembuat[0]?.pembuat) },
    maps: data.maps.map((m) => ({
      nomor: m.nomor,
      nama: m.nama,
      ukuran: m.ukuran,
      tipe: tipe.get(String(m.nomor).toUpperCase()) ?? "",
      qty: Number(m.qtyKirim) || 0,
      qtyJadi: Number(m.qtyJadi) || 0,
      mo: str(m.mo) || "-",
    })),
  };
};

module.exports = { getLookupMap, getFormData, getPrintData, create, update };
