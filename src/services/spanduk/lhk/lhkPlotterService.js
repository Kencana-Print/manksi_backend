const db = require("../../../config/database");
const { galat, validasiPeriode } = require("./lhkCommon");
const {
  T,
  filterCabang,
  pastikanLhkDiCabang,
  pastikanBelumDipakai,
  cekTutupBuku,
} = require("./lhkPlotterShared");

// Browse master (setara SQLMaster Delphi)
const getBrowseLhkPlotter = async (tglAwal, tglAkhir, user) => {
  validasiPeriode(tglAwal, tglAkhir);
  const cab = filterCabang(user, "h");

  const query = `
    SELECT h.lph_nomor AS Nomor,
           DATE_FORMAT(h.lph_tanggal, '%Y-%m-%d') AS Tanggal,
           h.lph_pab_kode AS Kode_Pabrik,
           p.pab_nama AS Nama_Pabrik
    FROM ${T.hdr} h
    LEFT JOIN ${T.pabrik} p ON p.pab_kode = h.lph_pab_kode
    WHERE h.lph_tanggal BETWEEN ? AND ?
    ${cab.sql}
    ORDER BY h.lph_tanggal DESC, h.lph_nomor DESC
  `;
  const [rows] = await db.query(query, [tglAwal, tglAkhir, ...cab.params]);
  return rows;
};

// Detail seluruh LHK pada periode (setara SQLDetail Delphi, dibatasi periode header)
const getDetailLhkPlotter = async (tglAwal, tglAkhir, user) => {
  validasiPeriode(tglAwal, tglAkhir);
  const cab = filterCabang(user, "h");

  const query = `
    SELECT d.lpd_lph_nomor AS Nomor,
           d.lpd_spk_nomor AS Nomor_SPK,
           x.spk_nama AS Nama_SPK,
           x.spk_jumlah AS Jumlah_Order,
           x.spk_panjang AS Panjang,
           x.spk_lebar AS Lebar,
           d.lpd_j_meter AS J_Meter,
           d.lpd_j_lembar AS J_Lembar,
           d.lpd_j_totalmeter AS J_TotalMeter,
           d.lpd_j_pk AS J_PK,
           d.lpd_j_mk AS J_MK,
           d.lpd_j_totaltinta AS J_Tinta,
           d.lpd_keterangan AS Keterangan
    FROM ${T.dtl} d
    JOIN ${T.hdr} h ON h.lph_nomor = d.lpd_lph_nomor
    LEFT JOIN (
      SELECT spk_nomor, spk_nama, spk_jumlah,
             IFNULL(spk_panjang, 0) AS spk_panjang,
             IFNULL(spk_lebar, 0) AS spk_lebar
      FROM ${T.spk}
      UNION ALL
      SELECT mspk_nomor, mspk_nama, mspk_jumlah,
             IFNULL(mspk_panjang, 0),
             IFNULL(mspk_lebar, 0)
      FROM ${T.memoSpk}
    ) x ON x.spk_nomor = d.lpd_spk_nomor
    WHERE h.lph_tanggal BETWEEN ? AND ?
    ${cab.sql}
    ORDER BY d.lpd_lph_nomor, d.lpd_spk_nomor
  `;
  const [rows] = await db.query(query, [tglAwal, tglAkhir, ...cab.params]);
  return rows;
};

// Hapus LHK: detail lalu header, satu transaksi (Delphi: tanpa transaksi)
const deleteLhkPlotter = async (nomor, user) => {
  const no = String(nomor || "").trim();
  if (!no) {
    throw galat("Nomor LHK tidak boleh kosong");
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [cek] = await conn.query(
      `SELECT DATE_FORMAT(lph_tanggal, '%Y-%m-%d') AS tgl
       FROM ${T.hdr} WHERE lph_nomor = ? FOR UPDATE`,
      [no],
    );
    if (cek.length === 0) {
      throw galat("Data LHK Plotter tidak ditemukan", "notFound");
    }

    if (cek[0].tgl) {
      await cekTutupBuku(cek[0].tgl);
    }
    await pastikanLhkDiCabang(conn, no, user);
    await pastikanBelumDipakai(conn, no);

    await conn.query(`DELETE FROM ${T.dtl} WHERE lpd_lph_nomor = ?`, [no]);
    await conn.query(`DELETE FROM ${T.hdr} WHERE lph_nomor = ?`, [no]);

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
  getBrowseLhkPlotter,
  getDetailLhkPlotter,
  deleteLhkPlotter,
};
