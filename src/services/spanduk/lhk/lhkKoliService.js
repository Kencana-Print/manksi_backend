const db = require("../../../config/database");
const { validasiPeriode } = require("./lhkCommon");
const {
  T,
  galat,
  filterCabang,
  pastikanLhkDiCabang,
  pastikanBelumDipakai,
  cekTutupBuku,
} = require("./lhkKoliShared");
const { pastikanBelumDiscan } = require("./lhkKoliFormService");

const SUMBER_SPK = `
  SELECT spk_nomor, spk_nama, spk_jumlah,
         IFNULL(spk_panjang, 0) AS spk_panjang,
         IFNULL(spk_lebar, 0) AS spk_lebar
  FROM ${T.spk}
  UNION ALL
  SELECT mspk_nomor, mspk_nama, mspk_jumlah,
         IFNULL(mspk_panjang, 0), IFNULL(mspk_lebar, 0)
  FROM ${T.memoSpk}`;

const getBrowseLhkKoli = async (tglAwal, tglAkhir, user) => {
  validasiPeriode(tglAwal, tglAkhir);
  const cab = filterCabang(user, "h");

  const query = `
    SELECT h.lkh_nomor AS Nomor,
           DATE_FORMAT(h.lkh_tanggal, '%Y-%m-%d') AS Tanggal,
           h.lkh_pab_kode AS Kode_Pabrik,
           p.pab_nama AS Nama_Pabrik,
           IFNULL(x.jml_spk, 0) AS Jml_SPK,
           IFNULL(x.total_koli, 0) AS Total_Koli
    FROM ${T.hdr} h
    LEFT JOIN ${T.pabrik} p ON p.pab_kode = h.lkh_pab_kode
    LEFT JOIN (
      SELECT d.lkd_lkh_nomor AS xnomor,
             COUNT(*) AS jml_spk,
             SUM(d.lkd_j_koli) AS total_koli
      FROM ${T.dtl} d
      JOIN ${T.hdr} hh ON hh.lkh_nomor = d.lkd_lkh_nomor
                      AND hh.lkh_tanggal BETWEEN ? AND ?
      GROUP BY d.lkd_lkh_nomor
    ) x ON x.xnomor = h.lkh_nomor
    WHERE h.lkh_tanggal BETWEEN ? AND ?
    ${cab.sql}
    ORDER BY h.lkh_tanggal DESC, h.lkh_nomor DESC
  `;
  const [rows] = await db.query(query, [
    tglAwal,
    tglAkhir,
    tglAwal,
    tglAkhir,
    ...cab.params,
  ]);
  return rows;
};

const getDetailLhkKoli = async (tglAwal, tglAkhir, user) => {
  validasiPeriode(tglAwal, tglAkhir);
  const cab = filterCabang(user, "h");

  const query = `
    SELECT d.lkd_lkh_nomor AS Nomor,
           d.lkd_spk_nomor AS Nomor_SPK,
           x.spk_nama AS Nama_SPK,
           x.spk_jumlah AS Jumlah_Order,
           x.spk_panjang AS Panjang,
           x.spk_lebar AS Lebar,
           d.lkd_j_koli AS J_Koli
    FROM ${T.dtl} d
    JOIN ${T.hdr} h ON h.lkh_nomor = d.lkd_lkh_nomor
    LEFT JOIN (${SUMBER_SPK}) x ON x.spk_nomor = d.lkd_spk_nomor
    WHERE h.lkh_tanggal BETWEEN ? AND ?
    ${cab.sql}
    ORDER BY d.lkd_lkh_nomor, d.lkd_spk_nomor
  `;
  const [rows] = await db.query(query, [tglAwal, tglAkhir, ...cab.params]);
  return rows;
};

const deleteLhkKoli = async (nomor, user) => {
  const no = String(nomor || "").trim();
  if (!no) {
    throw galat("Nomor LHK tidak boleh kosong");
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [cek] = await conn.query(
      `SELECT DATE_FORMAT(lkh_tanggal, '%Y-%m-%d') AS tgl
       FROM ${T.hdr} WHERE lkh_nomor = ? FOR UPDATE`,
      [no],
    );
    if (cek.length === 0) {
      throw galat("Data LHK Koli tidak ditemukan", "notFound");
    }
    if (cek[0].tgl) {
      await cekTutupBuku(cek[0].tgl);
    }
    await pastikanLhkDiCabang(conn, no, user);
    await pastikanBelumDipakai(conn, no, user);
    await pastikanBelumDiscan(conn, no);
    await conn.query(`DELETE FROM ${T.unit} WHERE lku_lkh_nomor = ?`, [no]);
    await conn.query(`DELETE FROM ${T.hdr} WHERE lkh_nomor = ?`, [no]);

    await conn.commit();
    return true;
  } catch (e) {
    await conn.rollback().catch(() => {});
    throw e;
  } finally {
    conn.release();
  }
};

module.exports = { getBrowseLhkKoli, getDetailLhkKoli, deleteLhkKoli };
