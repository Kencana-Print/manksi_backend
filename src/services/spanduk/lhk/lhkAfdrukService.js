const db = require("../../../config/database");
const { validasiPeriode } = require("./lhkCommon");
const {
  T,
  galat,
  filterCabang,
  pastikanLhkDiCabang,
  pastikanBelumDipakai,
  cekTutupBuku,
} = require("./lhkAfdrukShared");

// Slot bahan tetap (sama dengan form). alias = nama kolom di hasil browse.
// kode null = belum ada di master: kolom tetap ada, selalu kosong.
const SLOT_BAHAN = [
  { alias: "Rinso", kode: 10401 },
  { alias: "Porstek", kode: 10400 },
  { alias: "M46", kode: null },
  { alias: "Kaporit", kode: 10438 },
  { alias: "Caustik", kode: 10439 },
  { alias: "Ulano", kode: 10435 },
  { alias: "Screen", kode: 10436 },
  { alias: "Lem", kode: 10441 },
  { alias: "Katalis", kode: 10437 },
];

// Qty per bahan jadi satu kolom per LHK (kode angka dari konstanta di atas,
// bukan input user). "* 1e0" supaya SUM(DECIMAL) kembali sebagai angka.
const SQL_PIVOT_BAHAN = SLOT_BAHAN.filter((s) => s.kode !== null)
  .map(
    (s) =>
      `SUM(CASE WHEN lab_brg_kode = ${s.kode} THEN lab_qty END) * 1e0 AS ${s.alias}`,
  )
  .join(",\n           ");

const SQL_KOLOM_BAHAN = SLOT_BAHAN.map((s) =>
  s.kode === null ? `NULL AS ${s.alias}` : `bhn.${s.alias} AS ${s.alias}`,
).join(",\n           ");

// Browse master (setara SQLMaster Delphi)
const getBrowseLhkAfdruk = async (tglAwal, tglAkhir, user) => {
  validasiPeriode(tglAwal, tglAkhir);
  const cab = filterCabang(user, "h");

  const query = `
    SELECT h.lah_nomor AS Nomor,
           DATE_FORMAT(h.lah_tanggal, '%Y-%m-%d') AS Tanggal,
           h.lah_pab_kode AS Kode_Pabrik,
           p.pab_nama AS Nama_Pabrik,
           h.lah_jkar_borongan AS Kar_Borongan,
           h.lah_jkar_harian AS Kar_Harian,
           ${SQL_KOLOM_BAHAN}
    FROM ${T.hdr} h
    LEFT JOIN ${T.pabrik} p ON p.pab_kode = h.lah_pab_kode
    LEFT JOIN (
      SELECT lab_lah_nomor,
           ${SQL_PIVOT_BAHAN}
      FROM ${T.bahan}
      GROUP BY lab_lah_nomor
    ) bhn ON bhn.lab_lah_nomor = h.lah_nomor
    WHERE h.lah_tanggal BETWEEN ? AND ?
    ${cab.sql}
    ORDER BY h.lah_tanggal DESC, h.lah_nomor DESC
  `;
  const [rows] = await db.query(query, [tglAwal, tglAkhir, ...cab.params]);
  return rows;
};

// Detail seluruh LHK pada periode (setara SQLDetail Delphi, dibatasi periode header)
// Urutan: nomor SPK (sama dengan urutan natural Delphi karena kunci unik
// (lad_lah_nomor, lad_spk_nomor) menjadi clustered key; tabel tanpa nourut)
const getDetailLhkAfdruk = async (tglAwal, tglAkhir, user) => {
  validasiPeriode(tglAwal, tglAkhir);
  const cab = filterCabang(user, "h");

  const query = `
    SELECT d.lad_lah_nomor AS Nomor,
           d.lad_spk_nomor AS Nomor_SPK,
           x.spk_nama AS Nama_SPK,
           x.spk_jumlah AS Jumlah_Order,
           x.spk_panjang AS Panjang,
           x.spk_lebar AS Lebar,
           d.lad_j_plangkan AS J_Plangkan,
           IFNULL(d.lad_jumlahmeter,
            ROUND(IFNULL(d.lad_j_plangkan, 0) * IFNULL(x.spk_panjang, 0), 2)
           ) AS J_Meter,
           d.lad_keterangan AS Keterangan
    FROM ${T.dtl} d
    JOIN ${T.hdr} h ON h.lah_nomor = d.lad_lah_nomor
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
    ) x ON x.spk_nomor = d.lad_spk_nomor
    WHERE h.lah_tanggal BETWEEN ? AND ?
    ${cab.sql}
    ORDER BY d.lad_lah_nomor, d.lad_spk_nomor
  `;
  const [rows] = await db.query(query, [tglAwal, tglAkhir, ...cab.params]);
  return rows;
};

// Hapus LHK: detail lalu header, satu transaksi berdasarkan nomor dari parameter
// (Delphi: tanpa transaksi, dan detail dihapus memakai baris grid sesudah
// CDSMaster.Delete sehingga yang terhapus detail LHK lain)
const deleteLhkAfdruk = async (nomor, user) => {
  const no = String(nomor || "").trim();
  if (!no) {
    throw galat("Nomor LHK tidak boleh kosong");
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [cek] = await conn.query(
      `SELECT DATE_FORMAT(lah_tanggal, '%Y-%m-%d') AS tgl
       FROM ${T.hdr} WHERE lah_nomor = ? FOR UPDATE`,
      [no],
    );
    if (cek.length === 0) {
      throw galat("Data LHK Afdruk tidak ditemukan", "notFound");
    }

    if (cek[0].tgl) {
      await cekTutupBuku(cek[0].tgl);
    }
    await pastikanLhkDiCabang(conn, no, user);
    await pastikanBelumDipakai(conn, no, user);

    await conn.query(`DELETE FROM ${T.dtl2} WHERE lad2_lah_nomor = ?`, [no]);
    await conn.query(`DELETE FROM ${T.bahan} WHERE lab_lah_nomor = ?`, [no]);
    await conn.query(`DELETE FROM ${T.dtl} WHERE lad_lah_nomor = ?`, [no]);
    await conn.query(`DELETE FROM ${T.hdr} WHERE lah_nomor = ?`, [no]);

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
  getBrowseLhkAfdruk,
  getDetailLhkAfdruk,
  deleteLhkAfdruk,
};
