const db = require("../../config/database");
const {
  galat,
  teks,
  norm,
  fmtTgl,
  parseTanggal,
  adalahSuperadmin,
  cabangUser,
  cekTutupBuku,
} = require("./lhk/lhkCommon");
const {
  T,
  NOMOR_LOCK,
  MAKS_KETERANGAN,
  SUMBER_SPK,
  SQL_INFO_SPK,
  SQL_JOIN_INFO_SPK,
  pastikanMutasiDiCabang,
} = require("./mutasiProduksiSpandukShared");
const {
  DAFTAR_LINI,
  getLini,
  getLiniAsal,
  namaLini,
  daftarLiniTujuan,
  periksaTransisi,
  lhkAdaDiLini,
  ambilDetailLini,
} = require("./mutasiProduksiSpandukLini");

// --- validasi payload ---
const validasiKeterangan = (v) => {
  const ket = teks(v);
  if (ket.length > MAKS_KETERANGAN) {
    throw galat(`Keterangan maksimal ${MAKS_KETERANGAN} karakter`);
  }
  return ket;
};

const wajib = (v, label, maks) => {
  const s = teks(v);
  if (!s) {
    throw galat(`${label} wajib diisi`);
  }
  if (maks && s.length > maks) {
    throw galat(`${label} maksimal ${maks} karakter`);
  }
  return s;
};

const siapkanData = (body = {}) => ({
  tanggal: parseTanggal(body.Tanggal),
  pabrik: wajib(body.Kode_Pabrik, "Lokasi", 10),
  liniAsal: wajib(body.Lini_Asal, "Lini asal", 20),
  liniTujuan: wajib(body.Lini_Tujuan, "Lini tujuan", 20),
  lhk: wajib(body.Nomor_LHK, "Nomor LHK", 20),
  spk: wajib(body.Nomor_SPK, "Nomor SPK/MAP", 20),
  keterangan: validasiKeterangan(body.Keterangan),
});

// MP-14: pada mutasi yang sudah ada hanya tanggal dan keterangan
const siapkanUbah = (body = {}) => ({
  tanggal: parseTanggal(body.Tanggal),
  keterangan: validasiKeterangan(body.Keterangan),
});

// Lokasi non-superadmin harus cabang sendiri (dijaga server)
const pastikanLokasi = (pabrik, user) => {
  if (adalahSuperadmin(user)) {
    return;
  }
  const cab = cabangUser(user);
  if (norm(pabrik) !== cab) {
    throw galat(`Lokasi harus cabang Anda (${cab})`, "forbidden");
  }
};

// Tanggal mutasi tidak boleh lebih awal dari tanggal LHK sumbernya
const pastikanTanggalSetelahLhk = (tanggalMutasi, tanggalLhk) => {
  if (tanggalLhk && tanggalMutasi < tanggalLhk) {
    throw galat(
      `Tanggal mutasi tidak boleh lebih awal dari tanggal LHK (${fmtTgl(tanggalLhk)})`,
    );
  }
};

// SPK atau MAP (menentukan batas lini). Dipanggil setelah periksaSumber.
const ambilJenisSumber = async (q, spk) => {
  const [a] = await q.query(
    `SELECT 1 FROM ${T.spk} WHERE spk_nomor = ? LIMIT 1`,
    [spk],
  );
  if (a.length > 0) {
    return "SPK";
  }
  const [b] = await q.query(
    `SELECT 1 FROM ${T.memoSpk} WHERE mspk_nomor = ? LIMIT 1`,
    [spk],
  );
  if (b.length > 0) {
    return "MAP";
  }
  throw galat(`SPK/MAP ${spk} tidak ditemukan`, "notFound");
};

// MP-11: melewati lini berikutnya mewajibkan keterangan
const pastikanKeteranganBilaLewati = (transisi, keterangan, liniTujuan) => {
  if (transisi.lewati && !keterangan) {
    throw galat(
      `Keterangan wajib diisi: lini tujuan ${namaLini(liniTujuan)} melewati lini ${transisi.berikutnya}`,
    );
  }
};

// MPS/NNNNN/YYYY, dipanggil di dalam lock
const buatNomor = async (conn, tanggalStr) => {
  const tahun = tanggalStr.slice(0, 4);
  const [rows] = await conn.query(
    `SELECT MAX(CAST(SUBSTRING_INDEX(SUBSTRING_INDEX(mps_nomor, '/', 2), '/', -1) AS UNSIGNED)) AS mx
     FROM ${T.mps} WHERE mps_nomor LIKE ?`,
    [`MPS/%/${tahun}`],
  );
  const next = (Number(rows[0]?.mx) || 0) + 1;
  if (next > 99999) {
    throw galat(`Nomor mutasi tahun ${tahun} sudah mencapai batas (99999)`);
  }
  return `MPS/${String(next).padStart(5, "0")}/${tahun}`;
};

// --- LOOKUP ---
// Seluruh rantai kecuali lini terakhir (tidak punya lini berikutnya).
// Tersedia = LHK lini itu sudah ada di web (bisa dipanggil nomor LHK-nya).
const getLookupLiniAsal = () =>
  DAFTAR_LINI.slice(0, -1).map((l, i) => ({
    Kode: l.kode,
    Nama: l.nama,
    Tersedia: l.S !== null,
    Kode_Berikutnya: DAFTAR_LINI[i + 1].kode,
    Nama_Berikutnya: DAFTAR_LINI[i + 1].nama,
  }));

const getLookupLiniTujuan = (liniAsal, jenisSumber) => {
  const asal = teks(liniAsal);
  getLiniAsal(asal);
  const jenis = norm(jenisSumber) === "MAP" ? "MAP" : "SPK";
  return daftarLiniTujuan(asal, jenis).map((l, i) => ({
    Kode: l.kode,
    Nama: l.nama,
    Default: i === 0,
  }));
};

// Lokasi: non-superadmin hanya cabangnya sendiri (selaras dengan pastikanLokasi)
const getLookupPabrik = async (search, user) => {
  const kata = teks(search);
  const kondisi = [];
  const params = [];
  if (!adalahSuperadmin(user)) {
    kondisi.push("pab_kode = ?");
    params.push(cabangUser(user));
  }
  if (kata) {
    kondisi.push("(pab_kode LIKE ? OR pab_nama LIKE ?)");
    params.push(`%${kata}%`, `%${kata}%`);
  }
  const where = kondisi.length > 0 ? `WHERE ${kondisi.join(" AND ")}` : "";
  const [rows] = await db.query(
    `SELECT pab_kode AS Kode, pab_nama AS Nama
     FROM ${T.pabrik} ${where}
     ORDER BY pab_kode`,
    params,
  );
  return rows;
};

// Modal 1: nomor LHK di lini asal yang masih punya SPK belum dimutasi
const getLookupLhk = async (liniAsal, search, user) => {
  const lini = getLiniAsal(teks(liniAsal));
  const { S, kolom: k } = lini;
  const kata = teks(search);
  const cab = S.filterCabang(user, "h");

  const params = [];
  let cari = "";
  if (kata) {
    cari = `AND h.${k.nomorHdr} LIKE ?`;
    params.push(`%${kata}%`);
  }

  const [rows] = await db.query(
    `SELECT h.${k.nomorHdr} AS Nomor,
            DATE_FORMAT(h.${k.tanggalHdr}, '%Y-%m-%d') AS Tanggal,
            h.${k.pabHdr} AS Kode_Pabrik,
            p.pab_nama AS Nama_Pabrik,
            (SELECT COUNT(*) FROM ${S.T.dtl} d
              WHERE d.${k.nomorDtl} = h.${k.nomorHdr}) AS Jml_SPK,
            (SELECT COUNT(*) FROM ${S.T.dtl} d
              WHERE d.${k.nomorDtl} = h.${k.nomorHdr}
                AND NOT EXISTS (
                  SELECT 1 FROM ${T.mps} m
                  WHERE m.mps_lhk_nomor = d.${k.nomorDtl}
                    AND m.mps_spk_nomor = d.${k.spkDtl}
                )) AS Jml_Belum_Mutasi
     FROM ${S.T.hdr} h
     LEFT JOIN ${S.T.pabrik} p ON p.pab_kode = h.${k.pabHdr}
     WHERE 1 = 1
     ${cari}
     ${cab.sql}
     HAVING Jml_Belum_Mutasi > 0
     ORDER BY h.${k.tanggalHdr} DESC, h.${k.nomorHdr} DESC
     LIMIT 100`,
    [...params, ...cab.params],
  );
  return rows;
};

// Modal 2: SPK/MAP di dalam satu LHK (menandai yang sudah dimutasi)
// Modal 2: SPK/MAP di dalam satu LHK (menandai yang sudah dimutasi)
const getLookupSpkDiLhk = async (liniAsal, lhkNomor, user) => {
  const lini = getLiniAsal(teks(liniAsal));
  const { S, kolom: k } = lini;
  const lhk = teks(lhkNomor);
  if (!lhk) {
    throw galat("Nomor LHK wajib diisi");
  }

  const [ada] = await db.query(
    `SELECT 1 FROM ${S.T.hdr} WHERE ${k.nomorHdr} = ? LIMIT 1`,
    [lhk],
  );
  if (ada.length === 0) {
    throw galat(`LHK ${lini.nama} ${lhk} tidak ditemukan`, "notFound");
  }
  await S.pastikanLhkDiCabang(db, lhk, user);

  const params = [lhk];
  let batasCabang = "";
  if (!adalahSuperadmin(user)) {
    batasCabang = "AND UPPER(TRIM(x.c)) = ?";
    params.push(cabangUser(user));
  }

  const [rows] = await db.query(
    `SELECT d.${k.spkDtl} AS Nomor_SPK,
            x.nm AS Nama_SPK,
            x.jml AS Jumlah_Order,
            x.jenis AS Jenis_Sumber,
            ${SQL_INFO_SPK},
            m.mps_nomor AS Nomor_Mutasi
     FROM ${S.T.dtl} d
     LEFT JOIN (${SUMBER_SPK}) x ON x.n = d.${k.spkDtl}
     ${SQL_JOIN_INFO_SPK}
     LEFT JOIN ${T.mps} m
            ON m.mps_lhk_nomor = d.${k.nomorDtl}
           AND m.mps_spk_nomor = d.${k.spkDtl}
     WHERE d.${k.nomorDtl} = ?
     ${batasCabang}
     ORDER BY d.${k.spkDtl}`,
    params,
  );
  return rows.map((r) => ({
    ...r,
    Sudah_Dimutasi: r.Nomor_Mutasi !== null,
  }));
};

// Baris SPK itu di LHK asal (panel "Hasil di LHK" saat dokumen baru dibuat)
const getLookupHasilLhk = async (liniAsal, lhkNomor, spkNomor, user) => {
  const lini = getLiniAsal(teks(liniAsal));
  const lhk = wajib(lhkNomor, "Nomor LHK", 20);
  const spk = wajib(spkNomor, "Nomor SPK/MAP", 20);
  const { S } = lini;

  await S.pastikanLhkDiCabang(db, lhk, user);
  const peta = await S.ambilInfoSpk(db, [spk]);
  S.periksaSumber(peta.get(spk), spk, user);

  return ambilDetailLini(db, lini.kode, lhk, spk);
};

// --- LOAD (form ubah + cetak) ---
const getMutasiProduksiSpandukById = async (nomor, user) => {
  const no = teks(nomor);
  const [rows] = await db.query(
    `SELECT m.mps_nomor AS Nomor,
            DATE_FORMAT(m.mps_tanggal, '%Y-%m-%d') AS Tanggal,
            m.mps_pab_kode AS Kode_Pabrik,
            p.pab_nama AS Nama_Pabrik,
            m.mps_lini_asal AS Lini_Asal,
            m.mps_lini_tujuan AS Lini_Tujuan,
            m.mps_lhk_nomor AS Nomor_LHK,
            m.mps_spk_nomor AS Nomor_SPK,
            x.nm AS Nama_SPK,
            x.jml AS Jumlah_Order,
            x.jenis AS Jenis_Sumber,
            ${SQL_INFO_SPK},
            m.mps_keterangan AS Keterangan
     FROM ${T.mps} m
     LEFT JOIN ${T.pabrik} p ON p.pab_kode = m.mps_pab_kode
     LEFT JOIN (${SUMBER_SPK}) x ON x.n = m.mps_spk_nomor
     ${SQL_JOIN_INFO_SPK}
     WHERE m.mps_nomor = ?`,
    [no],
  );
  if (rows.length === 0) {
    throw galat("Data mutasi produksi tidak ditemukan", "notFound");
  }
  const h = rows[0];
  await pastikanMutasiDiCabang(db, h.Nomor_SPK, user);

  const liniAsal = getLini(h.Lini_Asal);
  const [hdrLhk] = await db.query(
    `SELECT DATE_FORMAT(${liniAsal.kolom.tanggalHdr}, '%Y-%m-%d') AS tgl
     FROM ${liniAsal.S.T.hdr} WHERE ${liniAsal.kolom.nomorHdr} = ?`,
    [h.Nomor_LHK],
  );

  const Detail = await ambilDetailLini(
    db,
    h.Lini_Asal,
    h.Nomor_LHK,
    h.Nomor_SPK,
  );
  const terkunci = await lhkAdaDiLini(db, h.Lini_Tujuan, h.Nomor_SPK);

  return {
    ...h,
    Nama_Lini_Asal: namaLini(h.Lini_Asal),
    Nama_Lini_Tujuan: namaLini(h.Lini_Tujuan),
    Tanggal_LHK: hdrLhk[0]?.tgl ?? null,
    Detail,
    Terkunci: terkunci,
    Pesan_Kunci: terkunci
      ? `SPK/MAP ${h.Nomor_SPK} sudah punya LHK ${namaLini(h.Lini_Tujuan)}, mutasi tidak bisa diubah atau dihapus`
      : null,
  };
};

// --- CREATE ---
const createMutasiProduksiSpanduk = async (body, user) => {
  const data = siapkanData(body);
  await cekTutupBuku(data.tanggal);
  pastikanLokasi(data.pabrik, user);
  const asal = getLiniAsal(data.liniAsal);
  getLini(data.liniTujuan);
  const { S, kolom: k } = asal;

  const conn = await db.getConnection();
  let lockDiambil = false;
  try {
    await conn.beginTransaction();
    await S.pastikanPabrik(conn, data.pabrik);

    // Kunci header LHK sumber: bersaing dengan ubah/hapus LHK yang juga
    // mengunci header yang sama (FOR UPDATE), sehingga tidak ada yang lolos
    const [lhk] = await conn.query(
      `SELECT DATE_FORMAT(${k.tanggalHdr}, '%Y-%m-%d') AS tgl
       FROM ${S.T.hdr} WHERE ${k.nomorHdr} = ? FOR UPDATE`,
      [data.lhk],
    );
    if (lhk.length === 0) {
      throw galat(`LHK ${asal.nama} ${data.lhk} tidak ditemukan`, "notFound");
    }
    pastikanTanggalSetelahLhk(data.tanggal, lhk[0].tgl);
    await S.pastikanLhkDiCabang(conn, data.lhk, user);

    const [dalamLhk] = await conn.query(
      `SELECT 1 FROM ${S.T.dtl}
       WHERE ${k.nomorDtl} = ? AND ${k.spkDtl} = ? LIMIT 1`,
      [data.lhk, data.spk],
    );
    if (dalamLhk.length === 0) {
      throw galat(`SPK/MAP ${data.spk} tidak ada di LHK ${data.lhk}`);
    }

    const peta = await S.ambilInfoSpk(conn, [data.spk]);
    S.periksaSumber(peta.get(data.spk), data.spk, user);

    const jenis = await ambilJenisSumber(conn, data.spk);
    const transisi = periksaTransisi(data.liniAsal, data.liniTujuan, jenis);
    pastikanKeteranganBilaLewati(transisi, data.keterangan, data.liniTujuan);

    // MP-4: pasangan (LHK, SPK) tidak boleh dimutasi dua kali
    const [sudah] = await conn.query(
      `SELECT mps_nomor FROM ${T.mps}
       WHERE mps_lhk_nomor = ? AND mps_spk_nomor = ? LIMIT 1`,
      [data.lhk, data.spk],
    );
    if (sudah.length > 0) {
      throw galat(
        `SPK/MAP ${data.spk} dari LHK ${data.lhk} sudah dimutasi (${sudah[0].mps_nomor})`,
      );
    }

    const [lock] = await conn.query("SELECT GET_LOCK(?, 10) AS ok", [
      NOMOR_LOCK,
    ]);
    if (Number(lock[0].ok) !== 1) {
      throw galat(
        "Sistem sedang membuat nomor mutasi lain, coba lagi sebentar",
      );
    }
    lockDiambil = true;

    const nomor = await buatNomor(conn, data.tanggal);
    try {
      await conn.query(
        `INSERT INTO ${T.mps}
           (mps_nomor, mps_tanggal, mps_pab_kode, mps_lini_asal,
            mps_lini_tujuan, mps_lhk_nomor, mps_spk_nomor, mps_keterangan,
            mps_date_create, mps_user_create)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURDATE(), ?)`,
        [
          nomor,
          data.tanggal,
          data.pabrik,
          data.liniAsal,
          data.liniTujuan,
          data.lhk,
          data.spk,
          data.keterangan,
          user?.kode ?? null,
        ],
      );
    } catch (e) {
      if (e.code === "ER_DUP_ENTRY") {
        throw galat(
          String(e.sqlMessage || "").includes("uq_mps_lhk_spk")
            ? `SPK/MAP ${data.spk} dari LHK ${data.lhk} baru saja dimutasi oleh input lain`
            : `Nomor ${nomor} sudah dipakai input lain. Silakan simpan ulang.`,
        );
      }
      throw e;
    }

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

// --- UPDATE (MP-14: hanya tanggal dan keterangan) ---
const updateMutasiProduksiSpanduk = async (nomor, body, user) => {
  const no = teks(nomor);
  const data = siapkanUbah(body);

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [lama] = await conn.query(
      `SELECT DATE_FORMAT(mps_tanggal, '%Y-%m-%d') AS tgl,
              mps_lhk_nomor AS lhk, mps_spk_nomor AS spk,
              mps_lini_asal AS asal, mps_lini_tujuan AS tujuan
       FROM ${T.mps} WHERE mps_nomor = ? FOR UPDATE`,
      [no],
    );
    if (lama.length === 0) {
      throw galat("Data mutasi produksi tidak ditemukan", "notFound");
    }
    const { tgl, lhk, spk, asal, tujuan } = lama[0];

    // tutup buku: tanggal lama dan tanggal baru sama-sama dicek
    if (tgl) {
      await cekTutupBuku(tgl);
    }
    await cekTutupBuku(data.tanggal);

    await pastikanMutasiDiCabang(conn, spk, user);

    // Tanggal baru tetap tidak boleh lebih awal dari tanggal LHK sumber
    const liniAsal = getLini(asal);
    const [hdrLhk] = await conn.query(
      `SELECT DATE_FORMAT(${liniAsal.kolom.tanggalHdr}, '%Y-%m-%d') AS tgl
       FROM ${liniAsal.S.T.hdr} WHERE ${liniAsal.kolom.nomorHdr} = ?`,
      [lhk],
    );
    pastikanTanggalSetelahLhk(data.tanggal, hdrLhk[0]?.tgl);

    // MP-14: terkunci selama SPK sudah punya LHK di lini tujuan
    if (await lhkAdaDiLini(conn, tujuan, spk)) {
      throw galat(
        `SPK/MAP ${spk} sudah punya LHK ${namaLini(tujuan)}, mutasi tidak bisa diubah`,
      );
    }

    // MP-11: aturan keterangan wajib berlaku juga saat keterangan diubah
    const jenis = await ambilJenisSumber(conn, spk);
    pastikanKeteranganBilaLewati(
      periksaTransisi(asal, tujuan, jenis),
      data.keterangan,
      tujuan,
    );

    await conn.query(
      `UPDATE ${T.mps}
       SET mps_tanggal = ?, mps_keterangan = ?,
           mps_date_modified = CURDATE(), mps_user_modified = ?
       WHERE mps_nomor = ?`,
      [data.tanggal, data.keterangan, user?.kode ?? null, no],
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
  getLookupLiniAsal,
  getLookupLiniTujuan,
  getLookupPabrik,
  getLookupLhk,
  getLookupSpkDiLhk,
  getLookupHasilLhk,
  getMutasiProduksiSpandukById,
  createMutasiProduksiSpanduk,
  updateMutasiProduksiSpanduk,
};
