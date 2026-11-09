const db = require("../../../config/database");
const {
  validasiPeriode,
  adalahSuperadmin,
  cabangUser,
} = require("./lhkCommon");
const {
  T,
  BATAS_HARI,
  TANGGAL_MULAI_OUTSTANDING,
  sqlLewatBatas,
  galat,
  filterCabang,
  pastikanLhkDiCabang,
  pastikanTintaBelumDikunciProof,
  cekTutupBuku,
} = require("./lhkTintaShared");

// Browse: baris merah (Outstanding = 1) = LHK Cetak yang belum punya LHK
// Pemakaian Obat, tampil di atas dan tidak terikat periode, definisinya mengikuti
// lookup form (lch_pab_kode = cabang user, LHK Cetak pasif dikecualikan).
// Setelahnya satu baris per LHK Tinta pada periode. Kunci = nomor Tinta, atau
// 'CETAK:<nomor LHK Cetak>' untuk baris merah (Nomor dan Tanggal null).
// Lewat_Batas = 1 bila lewat h+7 dari tanggal LHK Cetak: pada baris Tinta
// artinya diinput lewat h+7, pada baris merah artinya hari ini sudah lewat h+7.
const getBrowseLhkTinta = async (tglAwal, tglAkhir, user) => {
  validasiPeriode(tglAwal, tglAkhir);
  const cab = filterCabang(user, "h");

  const [rows] = await db.query(
    `SELECT h.lnt_nomor AS Kunci,
            h.lnt_nomor AS Nomor,
            DATE_FORMAT(h.lnt_tanggal, '%Y-%m-%d') AS Tanggal,
            h.lnt_pab_kode AS Kode_Pabrik,
            p.pab_nama AS Nama_Pabrik,
            h.lnt_lch_nomor AS Nomor_Cetak,
            DATE_FORMAT(c.lch_tanggal, '%Y-%m-%d') AS Tanggal_Cetak,
            (SELECT COUNT(*) FROM ${T.cetakDtl} cd
              WHERE cd.lcd_lch_nomor = h.lnt_lch_nomor) AS Jml_SPK,
            (SELECT COUNT(*) FROM ${T.bahan} b
              WHERE b.ltb_lnt_nomor = h.lnt_nomor) AS Jml_Bahan,
            0 AS Outstanding,
            IF(h.lnt_date_create >
                 DATE_ADD(c.lch_tanggal, INTERVAL ${BATAS_HARI} DAY), 1, 0)
              AS Lewat_Batas
     FROM ${T.hdr} h
     LEFT JOIN ${T.pabrik} p ON p.pab_kode = h.lnt_pab_kode
     LEFT JOIN ${T.cetakHdr} c ON c.lch_nomor = h.lnt_lch_nomor
     WHERE h.lnt_tanggal BETWEEN ? AND ?
     ${cab.sql}
     ORDER BY h.lnt_tanggal DESC, h.lnt_nomor DESC`,
    [tglAwal, tglAkhir, ...cab.params],
  );

  const kondisiOut = [
    "c.lch_tanggal >= ?",
    "c.lch_apv_status IN ('', 'Y')",
    `NOT EXISTS (SELECT 1 FROM ${T.hdr} t WHERE t.lnt_lch_nomor = c.lch_nomor)`,
  ];
  const paramsOut = [TANGGAL_MULAI_OUTSTANDING];
  if (!adalahSuperadmin(user)) {
    kondisiOut.push("c.lch_pab_kode = ?");
    paramsOut.push(cabangUser(user));
  }
  const [outstanding] = await db.query(
    `SELECT CONCAT('CETAK:', c.lch_nomor) AS Kunci,
            NULL AS Nomor,
            NULL AS Tanggal,
            c.lch_pab_kode AS Kode_Pabrik,
            p.pab_nama AS Nama_Pabrik,
            c.lch_nomor AS Nomor_Cetak,
            DATE_FORMAT(c.lch_tanggal, '%Y-%m-%d') AS Tanggal_Cetak,
            (SELECT COUNT(*) FROM ${T.cetakDtl} cd
              WHERE cd.lcd_lch_nomor = c.lch_nomor) AS Jml_SPK,
            0 AS Jml_Bahan,
            1 AS Outstanding,
            ${sqlLewatBatas("c")} AS Lewat_Batas
     FROM ${T.cetakHdr} c
     LEFT JOIN ${T.pabrik} p ON p.pab_kode = c.lch_pab_kode
     WHERE ${kondisiOut.join(" AND ")}
     ORDER BY c.lch_tanggal, c.lch_nomor`,
    paramsOut,
  );

  return [...outstanding, ...rows];
};

// Detail periode: satu baris per LHK per obat. Nama jatuh ke kode bila master
// tak ketemu (LHK lama sebelum remap).
const getDetailLhkTinta = async (tglAwal, tglAkhir, user) => {
  validasiPeriode(tglAwal, tglAkhir);
  const cab = filterCabang(user, "h");

  const [rows] = await db.query(
    `SELECT h.lnt_nomor AS Nomor,
            DATE_FORMAT(h.lnt_tanggal, '%Y-%m-%d') AS Tanggal,
            h.lnt_lch_nomor AS Nomor_Cetak,
            b.ltb_brg_kode AS Kode_Bahan,
            IFNULL(m.brg_nama, b.ltb_brg_kode) AS Nama_Bahan,
            b.ltb_qty AS Qty,
            IFNULL(b.ltb_satuan, m.brg_satuan) AS Satuan
     FROM ${T.hdr} h
     JOIN ${T.bahan} b ON b.ltb_lnt_nomor = h.lnt_nomor
     LEFT JOIN ${T.garmenBrg} m
       ON m.brg_kode = b.ltb_brg_kode AND m.brg_jenis = 'OBAT'
     WHERE h.lnt_tanggal BETWEEN ? AND ?
     ${cab.sql}
     ORDER BY h.lnt_nomor, b.ltb_nourut`,
    [tglAwal, tglAkhir, ...cab.params],
  );
  return rows.map((r) => ({ ...r, Qty: Number(r.Qty) }));
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
