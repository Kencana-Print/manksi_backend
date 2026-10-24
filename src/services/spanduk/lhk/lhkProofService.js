const db = require("../../../config/database");
const { validasiPeriode } = require("./lhkCommon");
const {
  T,
  galat,
  filterCabang,
  pastikanLhkDiCabang,
  pastikanBelumDipakai,
  cekTutupBuku,
} = require("./lhkProofShared");

// Panjang/lebar SPK dan MAP (UNION ALL, sama dengan Delphi)
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
const getBrowseLhkProof = async (tglAwal, tglAkhir, user) => {
  validasiPeriode(tglAwal, tglAkhir);
  const cab = filterCabang(user, "h");

  const query = `
    SELECT h.lpr_nomor AS Nomor,
           DATE_FORMAT(h.lpr_tanggal, '%Y-%m-%d') AS Tanggal,
           h.lpr_pab_kode AS Kode_Pabrik,
           p.pab_nama AS Nama_Pabrik
    FROM ${T.hdr} h
    LEFT JOIN ${T.pabrik} p ON p.pab_kode = h.lpr_pab_kode
    WHERE h.lpr_tanggal BETWEEN ? AND ?
    ${cab.sql}
    ORDER BY h.lpr_tanggal DESC, h.lpr_nomor DESC
  `;
  const [rows] = await db.query(query, [tglAwal, tglAkhir, ...cab.params]);
  return rows;
};

// Detail seluruh LHK pada periode (setara SQLDetail Delphi, dibatasi periode header)
const getDetailLhkProof = async (tglAwal, tglAkhir, user) => {
  validasiPeriode(tglAwal, tglAkhir);
  const cab = filterCabang(user, "h");

  const query = `
    SELECT d.lprd_lpr_nomor AS Nomor,
           d.lprd_spk_nomor AS Nomor_SPK,
           x.spk_nama AS Nama_SPK,
           x.spk_jumlah AS Jumlah_Order,
           x.spk_panjang AS Panjang,
           x.spk_lebar AS Lebar,
           d.lprd_j_plangkan AS J_Plangkan,
           d.lprd_j_proof AS J_Proof,
           d.lprd_j_meter AS J_Meter,
           d.lprd_u1 AS U1, d.lprd_u2 AS U2, d.lprd_u3 AS U3,
           d.lprd_u4 AS U4, d.lprd_u5 AS U5, d.lprd_u6 AS U6,
           d.lprd_u7 AS U7, d.lprd_u8 AS U8, d.lprd_u9 AS U9,
           d.lprd_u10 AS U10
    FROM ${T.dtl} d
    JOIN ${T.hdr} h ON h.lpr_nomor = d.lprd_lpr_nomor
    LEFT JOIN (${SUMBER_SPK}) x ON x.spk_nomor = d.lprd_spk_nomor
    WHERE h.lpr_tanggal BETWEEN ? AND ?
    ${cab.sql}
    ORDER BY d.lprd_lpr_nomor, d.lprd_spk_nomor
  `;
  const [rows] = await db.query(query, [tglAwal, tglAkhir, ...cab.params]);
  return rows;
};

// Resep & Actual pemakaian obat seluruh LHK pada periode (per dokumen)
const getResepLhkProof = async (tglAwal, tglAkhir, user) => {
  validasiPeriode(tglAwal, tglAkhir);
  const cab = filterCabang(user, "h");

  const query = `
    SELECT v.lpv_lpr_nomor AS Nomor,
           v.lpv_brg_kode AS Kode,
           b.brg_nama AS Nama,
           v.lpv_satuan AS Satuan,
           v.lpv_qty_resep AS Qty_Resep,
           v.lpv_qty_actual AS Qty_Actual
    FROM ${T.resep} v
    JOIN ${T.hdr} h ON h.lpr_nomor = v.lpv_lpr_nomor
    LEFT JOIN ${T.barang} b ON b.brg_kode = v.lpv_brg_kode
    WHERE h.lpr_tanggal BETWEEN ? AND ?
    ${cab.sql}
    ORDER BY v.lpv_lpr_nomor, v.lpv_nourut
  `;
  const [rows] = await db.query(query, [tglAwal, tglAkhir, ...cab.params]);
  return rows.map((r) => ({
    ...r,
    Nama: String(r.Nama ?? "").trim(),
    Qty_Resep: Number(r.Qty_Resep) || 0,
    Qty_Actual: Number(r.Qty_Actual) || 0,
  }));
};

// Hapus LHK: dtl_2, dtl, lalu header dalam satu transaksi (Delphi: tanpa transaksi)
const deleteLhkProof = async (nomor, user) => {
  const no = String(nomor || "").trim();
  if (!no) {
    throw galat("Nomor LHK tidak boleh kosong");
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [cek] = await conn.query(
      `SELECT DATE_FORMAT(lpr_tanggal, '%Y-%m-%d') AS tgl
       FROM ${T.hdr} WHERE lpr_nomor = ? FOR UPDATE`,
      [no],
    );
    if (cek.length === 0) {
      throw galat("Data LHK Proof tidak ditemukan", "notFound");
    }

    if (cek[0].tgl) {
      await cekTutupBuku(cek[0].tgl);
    }
    await pastikanLhkDiCabang(conn, no, user);
    await pastikanBelumDipakai(conn, no, user);

    await conn.query(`DELETE FROM ${T.dtl2} WHERE lprd2_lpr_nomor = ?`, [no]);
    await conn.query(`DELETE FROM ${T.dtl} WHERE lprd_lpr_nomor = ?`, [no]);
    await conn.query(`DELETE FROM ${T.hdr} WHERE lpr_nomor = ?`, [no]);

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
  getBrowseLhkProof,
  getDetailLhkProof,
  getResepLhkProof,
  deleteLhkProof,
};
