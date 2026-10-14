const db = require("../../../config/database");
const {
  teks,
  parseTanggal,
  angka,
  bilangan,
  MAKS_INT,
} = require("./lhkCommon");
const {
  T,
  galat,
  cekTutupBuku,
  pastikanLhkDiCabang,
  pastikanBelumDipakai,
  ambilInfoSpk,
  periksaSumber,
  pastikanPabrik,
} = require("./lhkJahitShared");
const { pastikanMutasiMasuk } = require("./lhkGerbangMutasi");

const PREFIX_NOMOR = "LHK-J";
const NOMOR_LOCK = "lhk_jahit_nomor";
const LOKASI_QTY_MANUAL = "MT1"; // Delphi: hanya MT1 boleh isi Qty Jahit manual
const MAKS_ABSENSI = 999.99; // double(5,2)

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
  const qtyManual = pabrik === LOKASI_QTY_MANUAL;

  const detail = Array.isArray(body.Detail) ? body.Detail : [];
  if (detail.length === 0) {
    throw galat("Minimal satu baris SPK harus diisi");
  }

  const sudahSpk = new Set();
  const baris = detail.map((d, i) => {
    const n = i + 1;
    const spk = teks(d?.Nomor_SPK);
    if (!spk) {
      throw galat(`Baris ${n}: nomor SPK wajib diisi`);
    }
    if (spk.length > 20) {
      throw galat(`Baris ${n}: nomor SPK maksimal 20 karakter`);
    }
    if (sudahSpk.has(spk.toUpperCase())) {
      throw galat(`Baris ${n}: SPK ${spk} sudah ada di baris lain`);
    }
    sudahSpk.add(spk.toUpperCase());

    const tambahJahit = angka(d.Tambah_Jahit, `Baris ${n}: Tambah jahit`);
    const tambahTali = bilangan(d.Tambah_Tali, `Baris ${n}: Tambah tali`);

    // Karyawan: absensi 0 dan qty 0 dibuang
    const daftar = Array.isArray(d.Karyawan) ? d.Karyawan : [];
    const sudahNik = new Set();
    const karyawan = [];
    daftar.forEach((k, j) => {
      const m = `Baris ${n}, karyawan ${j + 1}`;
      const nik = teks(k?.NIK);
      if (!nik) {
        throw galat(`${m}: NIK wajib diisi`);
      }
      if (nik.length > 20) {
        throw galat(`${m}: NIK maksimal 20 karakter`);
      }
      if (sudahNik.has(nik.toUpperCase())) {
        throw galat(`Baris ${n}: karyawan ${nik} sudah ada di SPK ${spk}`);
      }
      sudahNik.add(nik.toUpperCase());

      const absensi = angka(k.Absensi, `${m}: Absensi`, MAKS_ABSENSI);
      const qty = bilangan(k.Qty, `${m}: Qty jahit`);
      if (absensi === 0 && qty === 0) {
        return;
      }
      karyawan.push({ nik, absensi, qty });
    });
    if (karyawan.length === 0) {
      throw galat(
        `Baris ${n}: SPK ${spk} wajib punya minimal satu karyawan dengan absensi atau qty lebih dari 0`,
      );
    }

    // Qty per SPK: jumlah qty karyawan; di MT1 boleh manual (seperti Delphi)
    const qtyJahit = qtyManual
      ? bilangan(d.Qty_Jahit, `Baris ${n}: Qty jahit`)
      : bilangan(
          String(karyawan.reduce((a, k) => a + k.qty, 0)),
          `Baris ${n}: Total qty jahit`,
        );

    return { spk, qtyJahit, tambahJahit, tambahTali, karyawan };
  });

  return { tanggal, pabrik, baris };
};

// Sumber harus ada, divisi 1/5, dan cabang user (SPK atau MAP)
const validasiSumberBaris = async (q, baris, user) => {
  const peta = await ambilInfoSpk(
    q,
    baris.map((b) => b.spk),
  );
  for (const b of baris) {
    periksaSumber(peta.get(b.spk), b.spk, user);
  }
};

// NIK harus ada di master karyawan; nama diambil dari master, bukan dari klien
const lengkapiKaryawan = async (q, baris) => {
  const semua = [
    ...new Set(baris.flatMap((b) => b.karyawan.map((k) => k.nik))),
  ];
  const [rows] = await q.query(
    `SELECT kar_nik AS nik, kar_nama AS nama
     FROM ${T.karyawan} WHERE kar_nik IN (?)`,
    [semua],
  );
  const peta = new Map(rows.map((r) => [String(r.nik).toUpperCase(), r]));
  for (const b of baris) {
    for (const k of b.karyawan) {
      const r = peta.get(k.nik.toUpperCase());
      if (!r) {
        throw galat(`Karyawan dengan NIK ${k.nik} tidak ditemukan`);
      }
      k.nik = r.nik;
      k.nama = r.nama;
    }
  }
};

const simpanDetail = async (conn, nomor, baris) => {
  await conn.query(`DELETE FROM ${T.dtl2} WHERE ljd2_ljh_nomor = ?`, [nomor]);
  await conn.query(`DELETE FROM ${T.dtl} WHERE ljd_ljh_nomor = ?`, [nomor]);

  await conn.query(
    `INSERT INTO ${T.dtl}
       (ljd_ljh_nomor, ljd_spk_nomor, ljd_qty_jahit,
        ljd_tambah_jahit, ljd_tambah_tali)
     VALUES ?`,
    [baris.map((b) => [nomor, b.spk, b.qtyJahit, b.tambahJahit, b.tambahTali])],
  );

  const values = baris.flatMap((b) =>
    b.karyawan.map((k) => [nomor, b.spk, k.nik, k.nama, k.absensi, k.qty]),
  );
  await conn.query(
    `INSERT INTO ${T.dtl2}
       (ljd2_ljh_nomor, ljd2_spk_nomor, ljd2_kar_nik, ljd2_kar_nama,
        ljd2_absensi, ljd2_qty_jahit)
     VALUES ?`,
    [values],
  );
};

// LHK-J.yymm.NNNN, dipanggil di dalam lock + transaksi
const buatNomor = async (conn, tanggalStr) => {
  const yymm = tanggalStr.slice(2, 4) + tanggalStr.slice(5, 7);
  const prefix = `${PREFIX_NOMOR}.${yymm}.`;
  const [rows] = await conn.query(
    `SELECT MAX(CAST(RIGHT(ljh_nomor, 4) AS UNSIGNED)) AS mx
     FROM ${T.hdr} WHERE ljh_nomor LIKE ?`,
    [`${prefix}%`],
  );
  const next = (Number(rows[0]?.mx) || 0) + 1;
  if (next > 9999) {
    throw galat("Nomor LHK bulan ini sudah mencapai batas (9999)");
  }
  return `${prefix}${String(next).padStart(4, "0")}`;
};

// --- LOAD ---
const getLhkJahitById = async (nomor, user) => {
  const no = teks(nomor);
  const [hdr] = await db.query(
    `SELECT h.ljh_nomor AS Nomor,
            DATE_FORMAT(h.ljh_tanggal, '%Y-%m-%d') AS Tanggal,
            h.ljh_pab_kode AS Kode_Pabrik,
            p.pab_nama AS Nama_Pabrik
     FROM ${T.hdr} h
     LEFT JOIN ${T.pabrik} p ON p.pab_kode = h.ljh_pab_kode
     WHERE h.ljh_nomor = ?`,
    [no],
  );
  if (hdr.length === 0) {
    throw galat("Data LHK Jahit tidak ditemukan", "notFound");
  }
  await pastikanLhkDiCabang(db, no, user);

  const [detail] = await db.query(
    `SELECT d.ljd_spk_nomor AS Nomor_SPK,
            x.spk_nama AS Nama_SPK,
            x.spk_jumlah AS Jumlah_Order,
            x.spk_panjang AS Panjang,
            x.spk_lebar AS Lebar,
            d.ljd_qty_jahit AS Qty_Jahit,
            d.ljd_tambah_jahit AS Tambah_Jahit,
            d.ljd_tambah_tali AS Tambah_Tali
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
     ) x ON x.spk_nomor = d.ljd_spk_nomor
     WHERE d.ljd_ljh_nomor = ?
     ORDER BY d.ljd_spk_nomor`,
    [no],
  );

  const [kar] = await db.query(
    `SELECT ljd2_spk_nomor AS Nomor_SPK,
            ljd2_kar_nik AS NIK,
            ljd2_kar_nama AS Nama,
            ljd2_absensi AS Absensi,
            ljd2_qty_jahit AS Qty
     FROM ${T.dtl2}
     WHERE ljd2_ljh_nomor = ?
     ORDER BY ljd2_kar_nama`,
    [no],
  );
  const perSpk = new Map();
  for (const k of kar) {
    const { Nomor_SPK, ...sisa } = k;
    if (!perSpk.has(Nomor_SPK)) {
      perSpk.set(Nomor_SPK, []);
    }
    perSpk.get(Nomor_SPK).push(sisa);
  }

  return {
    ...hdr[0],
    Detail: detail.map((d) => ({
      ...d,
      Karyawan: perSpk.get(d.Nomor_SPK) ?? [],
    })),
  };
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

// --- Lookup karyawan jahit aktif per lokasi (untuk mengisi baris SPK baru) ---
const getLookupKaryawan = async (pabrik) => {
  const kode = teks(pabrik);
  if (!kode) {
    throw galat("Lokasi wajib diisi");
  }
  const [rows] = await db.query(
    `SELECT kar_nik AS NIK, kar_nama AS Nama
     FROM ${T.karyawan}
     WHERE kar_bagian LIKE '%JAHIT%'
       AND kar_status_aktif = 1
       AND kar_pab_kode = ?
     ORDER BY kar_nama`,
    [kode],
  );
  return rows;
};

// --- CREATE ---
const createLhkJahit = async (body, user) => {
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
    await pastikanMutasiMasuk(conn, {
      kodeLini: "JAHIT",
      tanggal: data.tanggal,
      daftarSpk: data.baris.map((b) => b.spk),
    });
    await lengkapiKaryawan(conn, data.baris);

    const nomor = await buatNomor(conn, data.tanggal);
    try {
      await conn.query(
        `INSERT INTO ${T.hdr}
           (ljh_nomor, ljh_tanggal, ljh_pab_kode, ljh_date_create, ljh_user_create)
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
const updateLhkJahit = async (nomor, body, user) => {
  const no = teks(nomor);
  const data = siapkanData(body);

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [lama] = await conn.query(
      `SELECT DATE_FORMAT(ljh_tanggal, '%Y-%m-%d') AS tgl
       FROM ${T.hdr} WHERE ljh_nomor = ? FOR UPDATE`,
      [no],
    );
    if (lama.length === 0) {
      throw galat("Data LHK Jahit tidak ditemukan", "notFound");
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
    await pastikanMutasiMasuk(conn, {
      kodeLini: "JAHIT",
      tanggal: data.tanggal,
      daftarSpk: data.baris.map((b) => b.spk),
      nomorLhk: no,
    });
    await lengkapiKaryawan(conn, data.baris);

    await conn.query(
      `UPDATE ${T.hdr}
       SET ljh_tanggal = ?, ljh_pab_kode = ?,
           ljh_date_modified = CURDATE(), ljh_user_modified = ?
       WHERE ljh_nomor = ?`,
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
  getLhkJahitById,
  getInfoSpk,
  getLookupPabrik,
  getLookupKaryawan,
  createLhkJahit,
  updateLhkJahit,
};
