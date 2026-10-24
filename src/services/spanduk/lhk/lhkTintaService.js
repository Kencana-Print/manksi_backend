const db = require("../../../config/database");
const { validasiPeriode } = require("./lhkCommon");
const {
  T,
  galat,
  filterCabang,
  pastikanLhkDiCabang,
  pastikanTintaBelumDikunciProof,
  cekTutupBuku,
} = require("./lhkTintaShared");

// Browse master: satu baris per LHK Tinta
const getBrowseLhkTinta = async (tglAwal, tglAkhir, user) => {
  validasiPeriode(tglAwal, tglAkhir);
  const cab = filterCabang(user, "h");

  const query = `
    SELECT h.lnt_nomor AS Nomor,
           DATE_FORMAT(h.lnt_tanggal, '%Y-%m-%d') AS Tanggal,
           h.lnt_pab_kode AS Kode_Pabrik,
           p.pab_nama AS Nama_Pabrik,
           h.lnt_lch_nomor AS Nomor_Cetak,
           DATE_FORMAT(c.lch_tanggal, '%Y-%m-%d') AS Tanggal_Cetak,
           (SELECT COUNT(*) FROM ${T.cetakDtl} cd
             WHERE cd.lcd_lch_nomor = h.lnt_lch_nomor) AS Jml_SPK,
           (SELECT COUNT(*) FROM ${T.bahan} b
             WHERE b.ltb_lnt_nomor = h.lnt_nomor) AS Jml_Bahan
    FROM ${T.hdr} h
    LEFT JOIN ${T.pabrik} p ON p.pab_kode = h.lnt_pab_kode
    LEFT JOIN ${T.cetakHdr} c ON c.lch_nomor = h.lnt_lch_nomor
    WHERE h.lnt_tanggal BETWEEN ? AND ?
    ${cab.sql}
    ORDER BY h.lnt_tanggal DESC, h.lnt_nomor DESC
  `;
  const [rows] = await db.query(query, [tglAwal, tglAkhir, ...cab.params]);
  return rows;
};

// Detail periode: satu baris per LHK per bahan
const getDetailLhkTinta = async (tglAwal, tglAkhir, user) => {
  validasiPeriode(tglAwal, tglAkhir);
  const cab = filterCabang(user, "h");

  const query = `
    SELECT h.lnt_nomor AS Nomor,
           DATE_FORMAT(h.lnt_tanggal, '%Y-%m-%d') AS Tanggal,
           h.lnt_lch_nomor AS Nomor_Cetak,
           b.ltb_brg_kode AS Kode_Bahan,
           m.brg_nama AS Nama_Bahan,
           b.ltb_qty_input AS Qty_Input,
           b.ltb_satuan_input AS Satuan_Input,
           b.ltb_qty AS Qty,
           IFNULL(b.ltb_satuan, m.brg_satuan) AS Satuan
    FROM ${T.hdr} h
    JOIN ${T.bahan} b ON b.ltb_lnt_nomor = h.lnt_nomor
    LEFT JOIN ${T.barang} m ON m.brg_kode = b.ltb_brg_kode
    WHERE h.lnt_tanggal BETWEEN ? AND ?
    ${cab.sql}
    ORDER BY h.lnt_nomor, b.ltb_nourut
  `;
  const [rows] = await db.query(query, [tglAwal, tglAkhir, ...cab.params]);
  return rows.map((r) => ({
    ...r,
    Qty_Input: Number(r.Qty_Input),
    Qty: Number(r.Qty),
  }));
};

// Hapus LHK: bahan lalu header, satu transaksi
const deleteLhkTinta = async (nomor, user) => {
  const no = String(nomor || "").trim();
  if (!no) {
    throw galat("Nomor LHK tidak boleh kosong");
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [cek] = await conn.query(
      `SELECT DATE_FORMAT(lnt_tanggal, '%Y-%m-%d') AS tgl,
              lnt_lch_nomor AS cetak
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
    await pastikanTintaBelumDikunciProof(conn, {
      nomorCetak: cek[0].cetak,
      nomor: no,
      user,
    });

    await conn.query(`DELETE FROM ${T.bahan} WHERE ltb_lnt_nomor = ?`, [no]);
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
