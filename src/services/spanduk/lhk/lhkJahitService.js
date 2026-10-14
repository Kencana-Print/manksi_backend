const db = require("../../../config/database");
const { validasiPeriode } = require("./lhkCommon");
const {
  T,
  galat,
  filterCabang,
  pastikanLhkDiCabang,
  pastikanBelumDipakai,
  cekTutupBuku,
} = require("./lhkJahitShared");

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
const getBrowseLhkJahit = async (tglAwal, tglAkhir, user) => {
  validasiPeriode(tglAwal, tglAkhir);
  const cab = filterCabang(user, "h");

  const query = `
    SELECT h.ljh_nomor AS Nomor,
           DATE_FORMAT(h.ljh_tanggal, '%Y-%m-%d') AS Tanggal,
           h.ljh_pab_kode AS Kode_Pabrik,
           p.pab_nama AS Nama_Pabrik
    FROM ${T.hdr} h
    LEFT JOIN ${T.pabrik} p ON p.pab_kode = h.ljh_pab_kode
    WHERE h.ljh_tanggal BETWEEN ? AND ?
    ${cab.sql}
    ORDER BY h.ljh_tanggal DESC, h.ljh_nomor DESC
  `;
  const [rows] = await db.query(query, [tglAwal, tglAkhir, ...cab.params]);
  return rows;
};

// Detail seluruh LHK pada periode (setara SQLDetail Delphi, dibatasi periode header)
const getDetailLhkJahit = async (tglAwal, tglAkhir, user) => {
  validasiPeriode(tglAwal, tglAkhir);
  const cab = filterCabang(user, "h");

  const query = `
    SELECT d.ljd_ljh_nomor AS Nomor,
           d.ljd_spk_nomor AS Nomor_SPK,
           x.spk_nama AS Nama_SPK,
           x.spk_jumlah AS Jumlah_Order,
           x.spk_panjang AS Panjang,
           x.spk_lebar AS Lebar,
           d.ljd_qty_jahit AS Qty_Jahit,
           d.ljd_tambah_jahit AS Tambah_Jahit,
           d.ljd_tambah_tali AS Tambah_Tali
    FROM ${T.dtl} d
    JOIN ${T.hdr} h ON h.ljh_nomor = d.ljd_ljh_nomor
    LEFT JOIN (${SUMBER_SPK}) x ON x.spk_nomor = d.ljd_spk_nomor
    WHERE h.ljh_tanggal BETWEEN ? AND ?
    ${cab.sql}
    ORDER BY d.ljd_ljh_nomor, d.ljd_spk_nomor
  `;
  const [rows] = await db.query(query, [tglAwal, tglAkhir, ...cab.params]);
  return rows;
};

// Hapus LHK: dtl_2, dtl, lalu header, satu transaksi (Delphi: tanpa transaksi)
const deleteLhkJahit = async (nomor, user) => {
  const no = String(nomor || "").trim();
  if (!no) {
    throw galat("Nomor LHK tidak boleh kosong");
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [cek] = await conn.query(
      `SELECT DATE_FORMAT(ljh_tanggal, '%Y-%m-%d') AS tgl
       FROM ${T.hdr} WHERE ljh_nomor = ? FOR UPDATE`,
      [no],
    );
    if (cek.length === 0) {
      throw galat("Data LHK Jahit tidak ditemukan", "notFound");
    }

    if (cek[0].tgl) {
      await cekTutupBuku(cek[0].tgl);
    }
    await pastikanLhkDiCabang(conn, no, user);
    await pastikanBelumDipakai(conn, no);

    await conn.query(`DELETE FROM ${T.dtl2} WHERE ljd2_ljh_nomor = ?`, [no]);
    await conn.query(`DELETE FROM ${T.dtl} WHERE ljd_ljh_nomor = ?`, [no]);
    await conn.query(`DELETE FROM ${T.hdr} WHERE ljh_nomor = ?`, [no]);

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
  getBrowseLhkJahit,
  getDetailLhkJahit,
  deleteLhkJahit,
};
