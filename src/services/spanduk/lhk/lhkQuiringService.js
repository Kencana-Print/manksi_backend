const db = require("../../../config/database");
const { validasiPeriode } = require("./lhkCommon");
const {
  T,
  galat,
  filterCabang,
  pastikanLhkDiCabang,
  pastikanBelumDipakai,
  cekTutupBuku,
} = require("./lhkQuiringShared");

// Nama/panjang/lebar SPK dan MAP (UNION ALL, sama dengan Delphi)
const SUMBER_SPK = `
  SELECT spk_nomor, spk_nama, spk_jumlah,
         IFNULL(spk_panjang, 0) AS spk_panjang,
         IFNULL(spk_lebar, 0) AS spk_lebar
  FROM ${T.spk}
  UNION ALL
  SELECT mspk_nomor, mspk_nama, mspk_jumlah,
         IFNULL(mspk_panjang, 0),
         IFNULL(mspk_lebar, 0)
  FROM ${T.memoSpk}`;

// Browse master (setara SQLMaster Delphi)
const getBrowseLhkQuiring = async (tglAwal, tglAkhir, user) => {
  validasiPeriode(tglAwal, tglAkhir);
  const cab = filterCabang(user, "h");

  const query = `
    SELECT h.lqh_nomor AS Nomor,
           DATE_FORMAT(h.lqh_tanggal, '%Y-%m-%d') AS Tanggal,
           h.lqh_pab_kode AS Kode_Pabrik,
           p.pab_nama AS Nama_Pabrik
    FROM ${T.hdr} h
    LEFT JOIN ${T.pabrik} p ON p.pab_kode = h.lqh_pab_kode
    WHERE h.lqh_tanggal BETWEEN ? AND ?
    ${cab.sql}
    ORDER BY h.lqh_tanggal DESC, h.lqh_nomor DESC
  `;
  const [rows] = await db.query(query, [tglAwal, tglAkhir, ...cab.params]);
  return rows;
};

// Detail seluruh LHK pada periode (setara SQLDetail Delphi, dibatasi periode header)
const getDetailLhkQuiring = async (tglAwal, tglAkhir, user) => {
  validasiPeriode(tglAwal, tglAkhir);
  const cab = filterCabang(user, "h");

  const query = `
    SELECT d.lqd_lqh_nomor AS Nomor,
           d.lqd_spk_nomor AS Nomor_SPK,
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
    JOIN ${T.hdr} h ON h.lqh_nomor = d.lqd_lqh_nomor
    LEFT JOIN (${SUMBER_SPK}) x ON x.spk_nomor = d.lqd_spk_nomor
    WHERE h.lqh_tanggal BETWEEN ? AND ?
    ${cab.sql}
    ORDER BY d.lqd_lqh_nomor, d.lqd_spk_nomor
  `;
  const [rows] = await db.query(query, [tglAwal, tglAkhir, ...cab.params]);
  return rows;
};

// Hapus LHK: detail lalu header, satu transaksi (Delphi: tanpa transaksi)
const deleteLhkQuiring = async (nomor, user) => {
  const no = String(nomor || "").trim();
  if (!no) {
    throw galat("Nomor LHK tidak boleh kosong");
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [cek] = await conn.query(
      `SELECT DATE_FORMAT(lqh_tanggal, '%Y-%m-%d') AS tgl
       FROM ${T.hdr} WHERE lqh_nomor = ? FOR UPDATE`,
      [no],
    );
    if (cek.length === 0) {
      throw galat("Data LHK Quiring tidak ditemukan", "notFound");
    }

    if (cek[0].tgl) {
      await cekTutupBuku(cek[0].tgl);
    }
    await pastikanLhkDiCabang(conn, no, user);
    await pastikanBelumDipakai(conn, no, user);

    await conn.query(`DELETE FROM ${T.dtl} WHERE lqd_lqh_nomor = ?`, [no]);
    await conn.query(`DELETE FROM ${T.hdr} WHERE lqh_nomor = ?`, [no]);

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
  getBrowseLhkQuiring,
  getDetailLhkQuiring,
  deleteLhkQuiring,
};
