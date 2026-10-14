const db = require("../../../config/database");
const { validasiPeriode } = require("./lhkCommon");
const {
  T,
  galat,
  filterCabang,
  pastikanLhkDiCabang,
  pastikanBelumDipakai,
  cekTutupBuku,
} = require("./lhkTintaShared");

// Browse master
const getBrowseLhkTinta = async (tglAwal, tglAkhir, user) => {
  validasiPeriode(tglAwal, tglAkhir);
  const cab = filterCabang(user, "h");

  const query = `
    SELECT h.lnt_nomor AS Nomor,
           DATE_FORMAT(h.lnt_tanggal, '%Y-%m-%d') AS Tanggal,
           h.lnt_pab_kode AS Kode_Pabrik,
           p.pab_nama AS Nama_Pabrik,
           (SELECT COUNT(*) FROM ${T.dtl} d
             WHERE d.lnd_lnt_nomor = h.lnt_nomor) AS Jml_SPK
    FROM ${T.hdr} h
    LEFT JOIN ${T.pabrik} p ON p.pab_kode = h.lnt_pab_kode
    WHERE h.lnt_tanggal BETWEEN ? AND ?
    ${cab.sql}
    ORDER BY h.lnt_tanggal DESC, h.lnt_nomor DESC
  `;
  const [rows] = await db.query(query, [tglAwal, tglAkhir, ...cab.params]);
  return rows;
};

// Detail periode: satu baris per SPK per bahan. SPK yang belum punya
// pemakaian tinta tetap muncul (LEFT JOIN) dengan kolom bahan kosong.
const getDetailLhkTinta = async (tglAwal, tglAkhir, user) => {
  validasiPeriode(tglAwal, tglAkhir);
  const cab = filterCabang(user, "h");

  const query = `
    SELECT d.lnd_lnt_nomor AS Nomor,
           d.lnd_spk_nomor AS Nomor_SPK,
           x.spk_nama AS Nama_SPK,
           x.spk_jumlah AS Jumlah_Order,
           x.spk_panjang AS Panjang,
           x.spk_lebar AS Lebar,
           t.lnd2_brg_kode AS Kode_Bahan,
           b.brg_nama AS Nama_Bahan,
           b.brg_satuan AS Satuan,
           t.lnd2_qty AS Qty
    FROM ${T.dtl} d
    JOIN ${T.hdr} h ON h.lnt_nomor = d.lnd_lnt_nomor
    LEFT JOIN ${T.dtl2} t
           ON t.lnd2_lnt_nomor = d.lnd_lnt_nomor
          AND t.lnd2_spk_nomor = d.lnd_spk_nomor
    LEFT JOIN ${T.barang} b ON b.brg_kode = t.lnd2_brg_kode
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
    ) x ON x.spk_nomor = d.lnd_spk_nomor
    WHERE h.lnt_tanggal BETWEEN ? AND ?
    ${cab.sql}
    ORDER BY d.lnd_lnt_nomor, d.lnd_spk_nomor, b.brg_nama
  `;
  const [rows] = await db.query(query, [tglAwal, tglAkhir, ...cab.params]);
  return rows;
};

// Hapus LHK: dtl2, dtl, lalu header, satu transaksi
const deleteLhkTinta = async (nomor, user) => {
  const no = String(nomor || "").trim();
  if (!no) {
    throw galat("Nomor LHK tidak boleh kosong");
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [cek] = await conn.query(
      `SELECT DATE_FORMAT(lnt_tanggal, '%Y-%m-%d') AS tgl
       FROM ${T.hdr} WHERE lnt_nomor = ? FOR UPDATE`,
      [no],
    );
    if (cek.length === 0) {
      throw galat("Data LHK Tinta tidak ditemukan", "notFound");
    }

    if (cek[0].tgl) {
      await cekTutupBuku(cek[0].tgl);
    }
    await pastikanLhkDiCabang(conn, no, user);
    await pastikanBelumDipakai(conn, no);

    await conn.query(`DELETE FROM ${T.dtl2} WHERE lnd2_lnt_nomor = ?`, [no]);
    await conn.query(`DELETE FROM ${T.dtl} WHERE lnd_lnt_nomor = ?`, [no]);
    await conn.query(`DELETE FROM ${T.hdr} WHERE lnt_nomor = ?`, [no]);

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
  getBrowseLhkTinta,
  getDetailLhkTinta,
  deleteLhkTinta,
};
