const db = require("../../../config/database");
const { galat, validasiPeriode } = require("./lhkCommon");
const {
  T,
  filterCabang,
  pastikanLhkDiCabang,
  pastikanBelumDipakai,
  cekTutupBuku,
} = require("./lhkHapusPlankanShared");

// Browse master (setara SQLMaster Delphi)
const getBrowseLhkHapusPlankan = async (tglAwal, tglAkhir, user) => {
  validasiPeriode(tglAwal, tglAkhir);
  const cab = filterCabang(user, "h");

  const query = `
    SELECT h.lhp_nomor AS Nomor,
           DATE_FORMAT(h.lhp_tanggal, '%Y-%m-%d') AS Tanggal,
           h.lhp_pab_kode AS Kode_Pabrik,
           p.pab_nama AS Nama_Pabrik
    FROM ${T.hdr} h
    LEFT JOIN ${T.pabrik} p ON p.pab_kode = h.lhp_pab_kode
    WHERE h.lhp_tanggal BETWEEN ? AND ?
    ${cab.sql}
    ORDER BY h.lhp_tanggal DESC, h.lhp_nomor DESC
  `;
  const [rows] = await db.query(query, [tglAwal, tglAkhir, ...cab.params]);
  return rows;
};

// Detail seluruh LHK pada periode (setara SQLDetail Delphi, dibatasi periode header)
const getDetailLhkHapusPlankan = async (tglAwal, tglAkhir, user) => {
  validasiPeriode(tglAwal, tglAkhir);
  const cab = filterCabang(user, "h");

  const query = `
    SELECT d.lhpd_lhp_nomor AS Nomor,
           d.lhpd_spk_nomor AS Nomor_SPK,
           x.spk_nama AS Nama_SPK,
           x.spk_jumlah AS Jumlah_Order,
           x.spk_panjang AS Panjang,
           x.spk_lebar AS Lebar,
           d.lhpd_jml_plangkan AS J_Plangkan,
           d.lhpd_jumlahmeter AS J_Meter,
           d.lhpd_ukuran AS Ukuran,
           ROUND(IFNULL(d.lhpd_ukuran, 0) * IFNULL(d.lhpd_jml_plangkan, 0), 2) AS Jumlah_Meter,
           d.lhpd_rinso AS Rinso,
           d.lhpd_porstek AS Porstek,
           d.lhpd_m46 AS M46,
           d.lhpd_kaporit AS Kaporit,
           d.lhpd_caustik AS Caustik,
           d.lhpd_keterangan AS Keterangan
    FROM ${T.dtl} d
    JOIN ${T.hdr} h ON h.lhp_nomor = d.lhpd_lhp_nomor
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
    ) x ON x.spk_nomor = d.lhpd_spk_nomor
    WHERE h.lhp_tanggal BETWEEN ? AND ?
    ${cab.sql}
    ORDER BY d.lhpd_lhp_nomor, d.lhpd_nourut, d.lhpd_spk_nomor
  `;
  const [rows] = await db.query(query, [tglAwal, tglAkhir, ...cab.params]);
  return rows;
};

// Hapus LHK: detail lalu header, satu transaksi (Delphi: tanpa transaksi)
const deleteLhkHapusPlankan = async (nomor, user) => {
  const no = String(nomor || "").trim();
  if (!no) {
    throw galat("Nomor LHK tidak boleh kosong");
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [cek] = await conn.query(
      `SELECT DATE_FORMAT(lhp_tanggal, '%Y-%m-%d') AS tgl
       FROM ${T.hdr} WHERE lhp_nomor = ? FOR UPDATE`,
      [no],
    );
    if (cek.length === 0) {
      throw galat("Data LHK Hapus Plankan tidak ditemukan", "notFound");
    }

    if (cek[0].tgl) {
      await cekTutupBuku(cek[0].tgl);
    }
    await pastikanLhkDiCabang(conn, no, user);
    await pastikanBelumDipakai(conn, no);

    await conn.query(`DELETE FROM ${T.dtl} WHERE lhpd_lhp_nomor = ?`, [no]);
    await conn.query(`DELETE FROM ${T.hdr} WHERE lhp_nomor = ?`, [no]);

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
  getBrowseLhkHapusPlankan,
  getDetailLhkHapusPlankan,
  deleteLhkHapusPlankan,
};
