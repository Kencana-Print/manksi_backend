const db = require("../../config/database");

// ============================================================
// CETAK BARCODE KAOSAN — replikasi uBrowseBcd.pas (BUKAN uBrowseBcdNew.pas
// yang sebelumnya salah dijadikan referensi). Tabel: tbarcode_hdr /
// tbarcode_dtl (bukan tbcd_hdr/tbcd_dtl).
// ============================================================

// ─────────────────────────────────────────────
// BROWSE MASTER — sesuai btnRefreshClick Delphi
// ⚠️ Filter cabang: Delphi cuma cek `frmMenu.CAB<>''` (non-blank),
// TIDAK ADA pengecualian utk HO-/ADMIN seperti pola modul lain di
// project ini. Direplikasi literal — kalau user cabang-nya "HO-",
// dia TETAP kefilter cuma lihat cabang "HO-" saja, bukan semua.
// ─────────────────────────────────────────────
const getBrowse = async (tglAwal, tglAkhir, userCabang) => {
  let sql = `
    SELECT
      h.bch_nomor AS Nomor,
      DATE_FORMAT(h.bch_tanggal, '%Y-%m-%d') AS Tanggal,
      h.bch_cab AS Cab,
      u.user_nama AS UserNama
    FROM tbarcode_hdr h
    LEFT JOIN tuser u ON u.user_kode = h.user_create
    WHERE h.bch_tanggal >= ? AND h.bch_tanggal <= ?
  `;
  const params = [tglAwal, tglAkhir];

  if (
    userCabang &&
    userCabang !== "HO-" &&
    userCabang !== "ADMIN" &&
    userCabang !== ""
  ) {
    sql += ` AND h.bch_cab = ?`;
    params.push(userCabang);
  }

  sql += ` ORDER BY h.bch_tanggal, h.bch_nomor`;

  const [rows] = await db.query(sql, params);
  return rows;
};

// ─────────────────────────────────────────────
// DETAIL (dipanggil saat expand baris) — sesuai SQLDetail Delphi.
// Difilter langsung by bcd_nomor (bukan re-scan seluruh rentang
// tanggal seperti cxGrid master-detail Delphi yang load semua lalu
// filter di client) — hasil akhir identik, lebih efisien di web.
// ─────────────────────────────────────────────
const getDetail = async (nomor) => {
  const [rows] = await db.query(
    `SELECT
       d.bcd_nomor AS Nomor,
       d.bcd_spk_nomor AS Spk,
       IFNULL(b.brgd_barcode, z.spks_barcode) AS Barcode,
       CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna) AS Nama,
       d.bcd_ukuran AS Ukuran,
       d.bcd_awal AS Awal,
       d.bcd_akhir AS Akhir,
       d.bcd_jumlah AS Jumlah,
       d.bcd_packing AS PackingList
     FROM tbarcode_dtl d
     LEFT JOIN retail.tbarangdc a ON a.brg_kode = d.bcd_kode
     LEFT JOIN retail.tbarangdc_dtl b ON b.brgd_kode = d.bcd_kode AND b.brgd_ukuran = d.bcd_ukuran
     LEFT JOIN tspk_size z ON z.spks_nomor = d.bcd_spk_nomor AND z.spks_size = d.bcd_ukuran
     WHERE d.bcd_nomor = ?
     ORDER BY d.bcd_nourut`,
    [nomor],
  );
  return rows.map((r) => ({
    ...r,
    Awal: Number(r.Awal) || 0,
    Akhir: Number(r.Akhir) || 0,
    Jumlah: Number(r.Jumlah) || 0,
  }));
};

// ─────────────────────────────────────────────
// DELETE — [DEVIASI DARI DELPHI] cxButton4Click asli cuma:
//   DELETE FROM tbarcode_hdr WHERE bch_nomor = ?
// (detail tbarcode_dtl DIBIARKAN nyangkut/orphan). Sesuai keputusan
// user, versi web hapus header+detail sekaligus dalam transaksi —
// lebih bersih, tanpa validasi tambahan (tutup buku dll, karena
// Delphi juga tidak punya validasi itu di modul ini selain cek hak
// akses generik cekdelete()).
// ─────────────────────────────────────────────
const deleteData = async (nomor) => {
  const [check] = await db.query(
    `SELECT bch_nomor FROM tbarcode_hdr WHERE bch_nomor = ?`,
    [nomor],
  );
  if (check.length === 0) throw new Error("Data tidak ditemukan.");

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(`DELETE FROM tbarcode_dtl WHERE bcd_nomor = ?`, [nomor]);
    await conn.query(`DELETE FROM tbarcode_hdr WHERE bch_nomor = ?`, [nomor]);
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
};

module.exports = {
  getBrowse,
  getDetail,
  deleteData,
};
