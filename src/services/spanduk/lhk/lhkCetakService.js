const db = require("../../../config/database");
const { validasiPeriode } = require("./lhkCommon");
const {
  T,
  galat,
  filterCabang,
  pastikanLhkDiCabang,
  pastikanBelumDipakai,
  cekTutupBuku,
} = require("./lhkCetakShared");

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

// Browse master (setara SQLMaster Delphi).
// Jml_Meter = SUM(qty cetak x panjang SPK/MAP) per LHK; agregasi dibatasi
// pada LHK di periode (Delphi menghitung seluruh riwayat lalu di-join).
const getBrowseLhkCetak = async (tglAwal, tglAkhir, user) => {
  validasiPeriode(tglAwal, tglAkhir);
  const cab = filterCabang(user, "h");

  // Jml_Kain NULL = LHK belum punya baris kain (bukan 0)
  const query = `
    SELECT h.lch_nomor AS Nomor,
           DATE_FORMAT(h.lch_tanggal, '%Y-%m-%d') AS Tanggal,
           h.lch_pab_kode AS Kode_Pabrik,
           p.pab_nama AS Nama_Pabrik,
           h.lch_jkar_borongan AS Kar_Borongan,
           h.lch_jkar_harian AS Kar_Harian,
           h.lch_sesi AS Sesi,
           IFNULL(xx.jmeter, 0) AS Jml_Meter,
           kk.kain AS Jml_Kain
    FROM ${T.hdr} h
    LEFT JOIN ${T.pabrik} p ON p.pab_kode = h.lch_pab_kode
    LEFT JOIN (
      SELECT d.lcd_lch_nomor AS xnomor,
             SUM(d.lcd_qty_cetak * x.spk_panjang) AS jmeter
      FROM ${T.dtl} d
      JOIN ${T.hdr} hh ON hh.lch_nomor = d.lcd_lch_nomor
                      AND hh.lch_tanggal BETWEEN ? AND ?
      LEFT JOIN (${SUMBER_SPK}) x ON x.spk_nomor = d.lcd_spk_nomor
      GROUP BY d.lcd_lch_nomor
    ) xx ON xx.xnomor = h.lch_nomor
    LEFT JOIN (
      SELECT k.lck_lch_nomor AS knomor, SUM(k.lck_qty_meter) AS kain
      FROM ${T.kain} k
      JOIN ${T.hdr} hk ON hk.lch_nomor = k.lck_lch_nomor
                      AND hk.lch_tanggal BETWEEN ? AND ?
      GROUP BY k.lck_lch_nomor
    ) kk ON kk.knomor = h.lch_nomor
    WHERE h.lch_tanggal BETWEEN ? AND ?
    ${cab.sql}
    ORDER BY h.lch_tanggal DESC, h.lch_nomor DESC
  `;
  const [rows] = await db.query(query, [
    tglAwal,
    tglAkhir,
    tglAwal,
    tglAkhir,
    tglAwal,
    tglAkhir,
    ...cab.params,
  ]);
  return rows;
};

// Detail seluruh LHK pada periode (setara SQLDetail Delphi, dibatasi periode
// header). Urutan: nomor SPK (kunci unik (lcd_lch_nomor, lcd_spk_nomor) tanpa
// kolom nourut, sama dengan urutan natural Delphi).
const getDetailLhkCetak = async (tglAwal, tglAkhir, user) => {
  validasiPeriode(tglAwal, tglAkhir);
  const cab = filterCabang(user, "h");

  const query = `
    SELECT d.lcd_lch_nomor AS Nomor,
           d.lcd_spk_nomor AS Nomor_SPK,
           x.spk_nama AS Nama_SPK,
           x.spk_jumlah AS Jumlah_Order,
           x.spk_panjang AS Panjang,
           x.spk_lebar AS Lebar,
           d.lcd_qty_cetak AS Qty_Cetak,
           d.lcd_qty_plangkan AS Jml_Plangkan
    FROM ${T.dtl} d
    JOIN ${T.hdr} h ON h.lch_nomor = d.lcd_lch_nomor
    LEFT JOIN (${SUMBER_SPK}) x ON x.spk_nomor = d.lcd_spk_nomor
    WHERE h.lch_tanggal BETWEEN ? AND ?
    ${cab.sql}
    ORDER BY d.lcd_lch_nomor, d.lcd_spk_nomor
  `;
  const [rows] = await db.query(query, [tglAwal, tglAkhir, ...cab.params]);
  return rows;
};

// Pemakaian kain seluruh LHK pada periode
const getKainLhkCetak = async (tglAwal, tglAkhir, user) => {
  validasiPeriode(tglAwal, tglAkhir);
  const cab = filterCabang(user, "h");

  const query = `
    SELECT k.lck_lch_nomor AS Nomor,
           k.lck_brg_kode AS Kode_Bahan,
           b.brg_nama AS Nama_Bahan,
           b.brg_lebar AS Lebar,
           k.lck_qty_meter AS Qty_Meter
    FROM ${T.kain} k
    JOIN ${T.hdr} h ON h.lch_nomor = k.lck_lch_nomor
    LEFT JOIN ${T.barang} b ON b.brg_kode = k.lck_brg_kode
    WHERE h.lch_tanggal BETWEEN ? AND ?
    ${cab.sql}
    ORDER BY k.lck_lch_nomor, b.brg_nama, k.lck_brg_kode
  `;
  const [rows] = await db.query(query, [tglAwal, tglAkhir, ...cab.params]);
  return rows;
};

// Hapus LHK: dtl_2 (rincian karyawan), dtl, lalu header, satu transaksi
// berdasarkan nomor dari parameter (Delphi: tanpa transaksi)
const deleteLhkCetak = async (nomor, user) => {
  const no = String(nomor || "").trim();
  if (!no) {
    throw galat("Nomor LHK tidak boleh kosong");
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [cek] = await conn.query(
      `SELECT DATE_FORMAT(lch_tanggal, '%Y-%m-%d') AS tgl
       FROM ${T.hdr} WHERE lch_nomor = ? FOR UPDATE`,
      [no],
    );
    if (cek.length === 0) {
      throw galat("Data LHK Cetak tidak ditemukan", "notFound");
    }

    if (cek[0].tgl) {
      await cekTutupBuku(cek[0].tgl);
    }
    await pastikanLhkDiCabang(conn, no, user);
    await pastikanBelumDipakai(conn, no, user);

    await conn.query(`DELETE FROM ${T.kain} WHERE lck_lch_nomor = ?`, [no]);
    await conn.query(`DELETE FROM ${T.dtl2} WHERE lcd2_lch_nomor = ?`, [no]);
    await conn.query(`DELETE FROM ${T.dtl} WHERE lcd_lch_nomor = ?`, [no]);
    await conn.query(`DELETE FROM ${T.hdr} WHERE lch_nomor = ?`, [no]);

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
  getBrowseLhkCetak,
  getDetailLhkCetak,
  getKainLhkCetak,
  deleteLhkCetak,
};
