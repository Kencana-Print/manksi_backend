const db = require("../../config/database");

// g.gdg_jadi=4 → replikasi persis dari WHERE clause .pas (flag gudang
// tipe Barang Jadi). Tidak ada filter cabang/jenis/bagian di source ini.
const GDG_JADI_FLAG = 4;

/**
 * Browse Koreksi Stok Barang Jadi.
 * ⚠️ Direplikasi PERSIS dari ufrmBrowseKorJadi.btnRefreshClick — source
 * TIDAK memfilter cabang, jenis, atau bagian user sama sekali. Filter
 * hanya rentang tanggal + gdg_jadi=4.
 * ⚠️ Kolom nama barang literal `b.brg_name` (BUKAN `brg_nama`) sesuai
 * source — tabel `tbarang` beda dari `tgarmen_brg` yang dipakai modul
 * cluster Garmen>Barang.
 */
const getBrowseData = async (startDate, endDate) => {
  const qMaster = `
    SELECT h.kor_nomor AS Nomor, h.kor_tanggal AS Tanggal, h.kor_gdg_kode AS Kode,
      g.gdg_nama AS Nama, h.kor_ket AS Keterangan
    FROM tkor_hdr h
    LEFT JOIN tgudang g ON g.gdg_kode = h.kor_gdg_kode
    WHERE g.gdg_jadi = ? AND h.kor_tanggal >= ? AND h.kor_tanggal <= ?
    ORDER BY h.kor_nomor
  `;
  const [masterRows] = await db.query(qMaster, [
    GDG_JADI_FLAG,
    startDate,
    endDate,
  ]);

  const qDetail = `
    SELECT d.kord_kor_nomor AS Nomor, d.kord_brg_kode AS Kode, b.brg_name AS Nama,
      "PCS" AS Satuan, d.kord_stok AS Stok,
      d.kord_qty AS Jumlah, d.kord_selisih AS Selisih
    FROM tkor_dtl d
    LEFT JOIN tkor_hdr h ON h.kor_nomor = d.kord_kor_nomor
    LEFT JOIN tgudang g ON g.gdg_kode = h.kor_gdg_kode
    LEFT JOIN tbarang b ON b.brg_kode = d.kord_brg_kode AND b.brg_divisi IN (3, 4, 6)
    WHERE g.gdg_jadi = ? AND h.kor_tanggal >= ? AND h.kor_tanggal <= ?
    ORDER BY d.kord_kor_nomor
  `;
  const [detailRows] = await db.query(qDetail, [
    GDG_JADI_FLAG,
    startDate,
    endDate,
  ]);

  return masterRows.map((master) => ({
    ...master,
    details: detailRows.filter((d) => d.Nomor === master.Nomor),
  }));
};

/**
 * Hapus Koreksi Stok Barang Jadi.
 * Replikasi literal source: hanya DELETE tkor_hdr — detail (tkor_dtl)
 * di-cascade oleh DB trigger (dikonfirmasi user). Tidak ada tutup-buku/
 * PIN5 di modul ini (dikonfirmasi tidak ada di source .pas).
 */
const deleteData = async (nomor) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [rows] = await conn.query(
      `SELECT kor_nomor FROM tkor_hdr WHERE kor_nomor = ? FOR UPDATE`,
      [nomor],
    );
    if (rows.length === 0) throw new Error("Data koreksi tidak ditemukan.");

    await conn.query(`DELETE FROM tkor_hdr WHERE kor_nomor = ?`, [nomor]);

    await conn.commit();
    return true;
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
};

/**
 * Data cetak — replikasi query cetak() Delphi + info perusahaan (pola
 * sama seperti getDataCetak Retur Pembelian Barang Garmen).
 */
const getPrintData = async (nomor) => {
  const [[header]] = await db.query(
    `SELECT h.kor_nomor, h.kor_tanggal, h.kor_ket, h.user_create,
       p.perush_nama, p.perush_alamat, p.perush_kota, p.perush_telp, p.perush_fax
     FROM tkor_hdr h
     LEFT JOIN tperusahaan p ON p.perush_kode = "KP"
     WHERE h.kor_nomor = ?`,
    [nomor],
  );
  if (!header) return null;

  const [detail] = await db.query(
    `SELECT d.kord_brg_kode AS kode, b.brg_name AS nama, "PCS" AS satuan,
      d.kord_stok AS stok, d.kord_qty AS jumlah, d.kord_selisih AS selisih
    FROM tkor_dtl d
    LEFT JOIN tbarang b ON b.brg_kode = d.kord_brg_kode AND b.brg_divisi IN (3, 4, 6)
    WHERE d.kord_kor_nomor = ?
    ORDER BY d.kord_brg_kode`,
    [nomor],
  );

  return { ...header, details: detail };
};

module.exports = {
  getBrowseData,
  deleteData,
  getPrintData,
};
