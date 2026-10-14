const db = require("../../config/database");
const {
  galat,
  teks,
  validasiPeriode,
  adalahSuperadmin,
  cabangUser,
  cekTutupBuku,
} = require("./lhk/lhkCommon");
const {
  T,
  SUMBER_SPK,
  pastikanMutasiDiCabang,
} = require("./mutasiProduksiSpandukShared");
const {
  namaLini,
  lhkAdaDiLini,
  ambilDetailLini,
} = require("./mutasiProduksiSpandukLini");

// Browse: hanya mutasi yang SPK/MAP-nya dari cabang user (superadmin: semua)
const filterCabangMutasi = (user, alias = "m") => {
  if (adalahSuperadmin(user)) {
    return { sql: "", params: [] };
  }
  const cab = cabangUser(user);
  return {
    sql: `AND EXISTS (
      SELECT 1 FROM (${SUMBER_SPK}) sc
      WHERE sc.n = ${alias}.mps_spk_nomor AND UPPER(TRIM(sc.c)) = ?
    )`,
    params: [cab],
  };
};

// --- BROWSE ---
const getBrowseMutasiProduksiSpanduk = async (tglAwal, tglAkhir, user) => {
  validasiPeriode(tglAwal, tglAkhir);
  const cab = filterCabangMutasi(user, "m");

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
            m.mps_keterangan AS Keterangan,
            m.mps_user_create AS User_Create,
            DATE_FORMAT(m.mps_date_create, '%Y-%m-%d') AS Tgl_Create
     FROM ${T.mps} m
     LEFT JOIN ${T.pabrik} p ON p.pab_kode = m.mps_pab_kode
     LEFT JOIN (${SUMBER_SPK}) x ON x.n = m.mps_spk_nomor
     WHERE m.mps_tanggal BETWEEN ? AND ?
     ${cab.sql}
     ORDER BY m.mps_tanggal DESC, m.mps_nomor DESC`,
    [tglAwal, tglAkhir, ...cab.params],
  );

  return rows.map((r) => ({
    ...r,
    Nama_Lini_Asal: namaLini(r.Lini_Asal),
    Nama_Lini_Tujuan: namaLini(r.Lini_Tujuan),
  }));
};

// --- DETAIL (dipanggil saat baris di-expand) ---
const getDetailMutasiProduksiSpanduk = async (nomor, user) => {
  const no = teks(nomor);
  const [rows] = await db.query(
    `SELECT mps_lhk_nomor AS lhk, mps_spk_nomor AS spk, mps_lini_asal AS asal
     FROM ${T.mps} WHERE mps_nomor = ?`,
    [no],
  );
  if (rows.length === 0) {
    throw galat("Data mutasi produksi tidak ditemukan", "notFound");
  }
  const { lhk, spk, asal } = rows[0];
  await pastikanMutasiDiCabang(db, spk, user);

  const detail = await ambilDetailLini(db, asal, lhk, spk);
  return {
    Nomor_LHK: lhk,
    Nomor_SPK: spk,
    Lini_Asal: asal,
    Nama_Lini_Asal: namaLini(asal),
    ...detail,
  };
};

// --- DELETE ---
const deleteMutasiProduksiSpanduk = async (nomor, user) => {
  const no = teks(nomor);
  if (!no) {
    throw galat("Nomor mutasi tidak boleh kosong");
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [cek] = await conn.query(
      `SELECT DATE_FORMAT(mps_tanggal, '%Y-%m-%d') AS tgl,
              mps_spk_nomor AS spk, mps_lini_tujuan AS tujuan
       FROM ${T.mps} WHERE mps_nomor = ? FOR UPDATE`,
      [no],
    );
    if (cek.length === 0) {
      throw galat("Data mutasi produksi tidak ditemukan", "notFound");
    }
    const { tgl, spk, tujuan } = cek[0];

    if (tgl) {
      await cekTutupBuku(tgl);
    }
    await pastikanMutasiDiCabang(conn, spk, user);

    // MP-14: selama SPK sudah punya LHK di lini tujuan, mutasi terkunci
    if (await lhkAdaDiLini(conn, tujuan, spk)) {
      throw galat(
        `SPK/MAP ${spk} sudah punya LHK ${namaLini(tujuan)}, mutasi tidak bisa dihapus`,
      );
    }

    await conn.query(`DELETE FROM ${T.mps} WHERE mps_nomor = ?`, [no]);

    await conn.commit();
    return true;
  } catch (e) {
    await conn.rollback().catch(() => {});
    throw e;
  } finally {
    conn.release();
  }
};

module.exports = {
  getBrowseMutasiProduksiSpanduk,
  getDetailMutasiProduksiSpanduk,
  deleteMutasiProduksiSpanduk,
};
