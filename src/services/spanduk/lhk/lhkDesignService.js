const db = require("../../../config/database");
const { validasiPeriode } = require("./lhkCommon");
const {
  T,
  TIPE,
  galat,
  teks,
  norm,
  filterCabang,
  pastikanLhkDiCabang,
  pastikanBelumDipakai,
  cekTutupBuku,
} = require("./lhkDesignShared");

// Rentang tanggal tanpa DATE(kolom) supaya indeks ld_tanggal bisa terpakai
const WHERE_PERIODE = `h.ld_tipe = '${TIPE}'
    AND h.ld_tanggal BETWEEN ? AND ?`;

// Browse master (setara SQLMaster Delphi): satu baris per SPK/MAP
const getBrowseLhkDesign = async (tglAwal, tglAkhir, user) => {
  validasiPeriode(tglAwal, tglAkhir);
  const cab = filterCabang(user, "h");

  const [rows] = await db.query(
    `SELECT h.ld_spk AS Nomor,
            IFNULL(s.spk_nama, m.mspk_nama) AS Nama_SPK,
            DATE_FORMAT(IFNULL(s.spk_tanggal, m.mspk_tanggal), '%Y-%m-%d') AS Tanggal_SPK,
            DATE_FORMAT(IFNULL(s.spk_dateline, m.mspk_dateline), '%Y-%m-%d') AS Dateline,
            DATE_FORMAT(h.ld_tanggal, '%Y-%m-%d') AS Tanggal_LHK,
            IFNULL((SELECT d.lds_status
                    FROM ${T.status} d
                    WHERE d.lds_spk = h.ld_spk AND d.lds_tipe = '${TIPE}'
                    ORDER BY d.lds_tgl DESC LIMIT 1), '') AS Status_Terakhir,
            h.user_create AS User_Create
     FROM ${T.hdr} h
     LEFT JOIN ${T.spk} s ON s.spk_nomor = h.ld_spk
     LEFT JOIN ${T.memoSpk} m ON m.mspk_nomor = h.ld_spk
     WHERE ${WHERE_PERIODE}
     ${cab.sql}
     ORDER BY h.ld_tanggal, h.ld_spk`,
    [tglAwal, tglAkhir, ...cab.params],
  );
  return rows;
};

// Detail komponen seluruh LHK pada periode (kolom sama dengan SQLDetail Delphi)
const getDetailLhkDesign = async (tglAwal, tglAkhir, user) => {
  validasiPeriode(tglAwal, tglAkhir);
  const cab = filterCabang(user, "h");

  const [rows] = await db.query(
    `SELECT d.ldk_spk AS Nomor,
            d.ldk_bahan AS Bahan,
            d.ldk_panjang AS Panjang_Output,
            d.ldk_jumlah AS Jumlah_Output,
            d.ldk_output AS Total_Output,
            d.ldk_c AS Tinta_C,
            d.ldk_m AS Tinta_M,
            d.ldk_y AS Tinta_Y,
            d.ldk_k AS Tinta_K,
            d.ldk_mesin AS Mesin,
            d.ldk_keterangan AS Keterangan
     FROM ${T.hdr} h
     JOIN ${T.komponen} d ON d.ldk_spk = h.ld_spk AND d.ldk_tipe = '${TIPE}'
     WHERE ${WHERE_PERIODE}
     ${cab.sql}
     ORDER BY d.ldk_spk`,
    [tglAwal, tglAkhir, ...cab.params],
  );
  return rows;
};

// Riwayat status seluruh LHK pada periode, urut per SPK lalu waktu
const getStatusLhkDesign = async (tglAwal, tglAkhir, user) => {
  validasiPeriode(tglAwal, tglAkhir);
  const cab = filterCabang(user, "h");

  const [rows] = await db.query(
    `SELECT d.lds_spk AS Nomor,
            d.lds_user AS Design,
            d.lds_status AS Status,
            DATE_FORMAT(d.lds_tgl, '%Y-%m-%d %H:%i:%s') AS Tanggal,
            d.lds_durasi AS Durasi,
            d.lds_note AS Catatan
     FROM ${T.hdr} h
     JOIN ${T.status} d ON d.lds_spk = h.ld_spk AND d.lds_tipe = '${TIPE}'
     WHERE ${WHERE_PERIODE}
     ${cab.sql}
     ORDER BY d.lds_spk, d.lds_tgl`,
    [tglAwal, tglAkhir, ...cab.params],
  );
  return rows;
};

// Hapus LHK (aturan Delphi: hanya pemilik data). Status, komponen, lalu header
// dalam satu transaksi; Delphi hanya menghapus header.
const deleteLhkDesign = async (nomor, user) => {
  const no = teks(nomor);
  if (!no) {
    throw galat("Nomor LHK tidak boleh kosong");
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [cek] = await conn.query(
      `SELECT DATE_FORMAT(ld_tanggal, '%Y-%m-%d') AS tgl, user_create
       FROM ${T.hdr}
       WHERE ld_spk = ? AND ld_tipe = '${TIPE}' FOR UPDATE`,
      [no],
    );
    if (cek.length === 0) {
      throw galat("Data LHK Design tidak ditemukan", "notFound");
    }
    if (norm(cek[0].user_create) !== norm(user?.kode)) {
      throw galat(`Data tersebut milik ${cek[0].user_create}`, "forbidden");
    }

    if (cek[0].tgl) {
      await cekTutupBuku(cek[0].tgl);
    }
    await pastikanLhkDiCabang(conn, no, user);
    await pastikanBelumDipakai(conn, no, user);

    await conn.query(
      `DELETE FROM ${T.status} WHERE lds_spk = ? AND lds_tipe = '${TIPE}'`,
      [no],
    );
    await conn.query(
      `DELETE FROM ${T.komponen} WHERE ldk_spk = ? AND ldk_tipe = '${TIPE}'`,
      [no],
    );
    await conn.query(
      `DELETE FROM ${T.hdr} WHERE ld_spk = ? AND ld_tipe = '${TIPE}'`,
      [no],
    );

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
  getBrowseLhkDesign,
  getDetailLhkDesign,
  getStatusLhkDesign,
  deleteLhkDesign,
};
