const db = require("../../../config/database");
const { validasiPeriode } = require("./lhkCommon");
const {
  T,
  galat,
  filterCabang,
  pastikanLhkDiCabang,
  cekTutupBuku,
} = require("./lhkBsShared");

// Nama/panjang/lebar SPK dan MAP (UNION ALL, sama dengan LHK lain)
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

// Browse master
const getBrowseLhkBs = async (tglAwal, tglAkhir, user) => {
  validasiPeriode(tglAwal, tglAkhir);
  const cab = filterCabang(user, "h");

  const query = `
    SELECT h.lbh_nomor AS Nomor,
           DATE_FORMAT(h.lbh_tanggal, '%Y-%m-%d') AS Tanggal,
           h.lbh_pab_kode AS Kode_Pabrik,
           p.pab_nama AS Nama_Pabrik,
           (SELECT IFNULL(SUM(d.lbd_bs_quiring + d.lbd_bs_cetak + d.lbd_bs_bahan
                              + d.lbd_bs_jahit + d.lbd_bs_lipat), 0)
              FROM ${T.dtl} d
             WHERE d.lbd_lbh_nomor = h.lbh_nomor) AS Total_BS
    FROM ${T.hdr} h
    LEFT JOIN ${T.pabrik} p ON p.pab_kode = h.lbh_pab_kode
    WHERE h.lbh_tanggal BETWEEN ? AND ?
    ${cab.sql}
    ORDER BY h.lbh_tanggal DESC, h.lbh_nomor DESC
  `;
  const [rows] = await db.query(query, [tglAwal, tglAkhir, ...cab.params]);
  return rows;
};

// Detail seluruh LHK BS pada periode
const getDetailLhkBs = async (tglAwal, tglAkhir, user) => {
  validasiPeriode(tglAwal, tglAkhir);
  const cab = filterCabang(user, "h");

  const query = `
    SELECT d.lbd_lbh_nomor AS Nomor,
           d.lbd_spk_nomor AS Nomor_SPK,
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
    JOIN ${T.hdr} h ON h.lbh_nomor = d.lbd_lbh_nomor
    LEFT JOIN (${SUMBER_SPK}) x ON x.spk_nomor = d.lbd_spk_nomor
    WHERE h.lbh_tanggal BETWEEN ? AND ?
    ${cab.sql}
    ORDER BY d.lbd_lbh_nomor, d.lbd_spk_nomor
  `;
  const [rows] = await db.query(query, [tglAwal, tglAkhir, ...cab.params]);
  return rows;
};

// Hapus LHK BS: detail lalu header, satu transaksi
const deleteLhkBs = async (nomor, user) => {
  const no = String(nomor || "").trim();
  if (!no) {
    throw galat("Nomor LHK tidak boleh kosong");
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [cek] = await conn.query(
      `SELECT DATE_FORMAT(lbh_tanggal, '%Y-%m-%d') AS tgl
       FROM ${T.hdr} WHERE lbh_nomor = ? FOR UPDATE`,
      [no],
    );
    if (cek.length === 0) {
      throw galat("Data LHK BS tidak ditemukan", "notFound");
    }

    if (cek[0].tgl) {
      await cekTutupBuku(cek[0].tgl);
    }
    await pastikanLhkDiCabang(conn, no, user);

    await conn.query(`DELETE FROM ${T.dtl} WHERE lbd_lbh_nomor = ?`, [no]);
    await conn.query(`DELETE FROM ${T.hdr} WHERE lbh_nomor = ?`, [no]);

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
  getBrowseLhkBs,
  getDetailLhkBs,
  deleteLhkBs,
};
