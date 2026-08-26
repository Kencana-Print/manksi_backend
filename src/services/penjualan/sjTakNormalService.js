const db = require("../../config/database");

// ═══════════════════════════════════════════════════════════
// SURAT JALAN TAK NORMAL — SERVICE
// Migrasi dari ufrmBrowseSJb.pas (Delphi)
// Tabel terpisah: tsj_hdr_bayangan / tsj_dtl_bayangan (BUKAN tsj_hdr
// biasa). Tidak ada keterkaitan ke Invoice/piutang di modul ini.
// TIDAK ADA validasi tutup buku/approval/PIN5 sama sekali.
// ═══════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────
// BROWSE — Sesuai Delphi btnRefreshClick (SQLMaster)
// ─────────────────────────────────────────────────────────
const getBrowse = async (tglAwal, tglAkhir, canLihatCus = false) => {
  const custCols = canLihatCus
    ? `a.sj_cus_kode AS KdCus,
       c.cus_nama AS Customer,
       a.sj_alamat_customer AS Alamat,
       a.sj_kota_customer AS Kota,`
    : `"" AS KdCus,
       "" AS Customer,
       "" AS Alamat,
       "" AS Kota,`;

  const [rows] = await db.query(
    `SELECT
       a.sj_nomor                                     AS Nomor,
       DATE_FORMAT(a.sj_tanggal,'%Y-%m-%d')            AS Tanggal,
       v.divisi                                        AS Divisi,
       ${custCols}
       a.sj_keterangan                                  AS Keterangan,
       g.gdg_nama                                       AS Gudang,
       SUM(d.sjd_jumlah)                                AS QtyKirim,
       DATE_FORMAT(a.date_create,'%d-%m-%Y %T')         AS Created
     FROM tsj_hdr_bayangan a
     INNER JOIN tsj_dtl_bayangan d ON d.sjd_sj_nomor = a.sj_nomor
     INNER JOIN tgudang g ON g.gdg_kode = a.sj_gdg_kode
     LEFT JOIN tcustomer c ON c.cus_kode = a.sj_cus_kode
     LEFT JOIN tdivisi v ON v.kode = a.sj_divisi
     WHERE a.sj_tanggal >= ? AND a.sj_tanggal <= ?
     GROUP BY a.sj_nomor
     ORDER BY a.sj_tanggal, a.sj_nomor`,
    [tglAwal, tglAkhir],
  );
  return rows;
};

// ─────────────────────────────────────────────────────────
// BROWSE DETAIL — Sesuai Delphi btnRefreshClick (SQLDetail)
// ─────────────────────────────────────────────────────────
const getBrowseDetail = async (tglAwal, tglAkhir, nomor = "") => {
  let where = `h.sj_tanggal >= ? AND h.sj_tanggal <= ?`;
  const params = [tglAwal, tglAkhir];

  if (nomor) {
    where += ` AND d.sjd_sj_nomor = ?`;
    params.push(nomor);
  }

  const [rows] = await db.query(
    `SELECT
       d.sjd_sj_nomor   AS Nomor,
       d.sjd_spk_nomor  AS Kode,
       s.spk_nama       AS Nama,
       s.spk_ukuran     AS Ukuran,
       s.spk_panjang    AS Panjang,
       s.spk_lebar      AS Lebar,
       d.sjd_jumlah     AS Jumlah,
       d.sjd_keterangan AS Keterangan
     FROM tsj_hdr_bayangan h
     INNER JOIN tsj_dtl_bayangan d ON d.sjd_sj_nomor = h.sj_nomor
     INNER JOIN tspk s ON s.spk_nomor = d.sjd_spk_nomor
     WHERE ${where}
     ORDER BY d.sjd_sj_nomor`,
    params,
  );
  return rows;
};

// ─────────────────────────────────────────────────────────
// CEK BISA UBAH — sesuai Delphi cxButton1Click (existence only,
// tidak ada validasi status tambahan)
// ─────────────────────────────────────────────────────────
const cekBisaUbah = async (nomor) => {
  const [[row]] = await db.query(
    `SELECT sj_nomor FROM tsj_hdr_bayangan WHERE sj_nomor = ?`,
    [nomor],
  );
  if (!row) return { bisa: false, reason: "Data tidak ditemukan." };
  return { bisa: true, reason: null };
};

// ─────────────────────────────────────────────────────────
// CEK BISA HAPUS — sesuai Delphi cxButton4Click (existence only,
// TIDAK ADA cek tutup buku sama sekali)
// ─────────────────────────────────────────────────────────
const cekBisaHapus = async (nomor) => {
  const [[row]] = await db.query(
    `SELECT sj_nomor FROM tsj_hdr_bayangan WHERE sj_nomor = ?`,
    [nomor],
  );
  if (!row) return { bisaHapus: false, reason: "Data tidak ditemukan." };
  return { bisaHapus: true, reason: null };
};

// ─────────────────────────────────────────────────────────
// CEK BISA CETAK — sesuai Delphi cxButton3Click (existence only,
// tidak ada permission/status check khusus di Delphi)
// ─────────────────────────────────────────────────────────
const cekBisaCetak = async (nomor) => {
  const [[row]] = await db.query(
    `SELECT sj_nomor FROM tsj_hdr_bayangan WHERE sj_nomor = ?`,
    [nomor],
  );
  if (!row) return { bisa: false, reason: "Data tidak ditemukan." };
  return { bisa: true, reason: null };
};

// ─────────────────────────────────────────────────────────
// DELETE — sesuai Delphi cxButton4Click
// CATATAN: Delphi hanya delete tsj_hdr_bayangan, tidak eksplisit
// delete tsj_dtl_bayangan (potensi orphan row kalau tidak ada FK
// cascade di DB). Diikuti apa adanya, pola sama seperti modul
// Invoice Tak Normal & Pra SJ.
// ─────────────────────────────────────────────────────────
const deleteData = async (nomor) => {
  await db.query(`DELETE FROM tsj_hdr_bayangan WHERE sj_nomor = ?`, [nomor]);
};

// ─────────────────────────────────────────────────────────
// EXPORT
// ─────────────────────────────────────────────────────────
const getExportData = async (tglAwal, tglAkhir, canLihatCus = false) =>
  getBrowse(tglAwal, tglAkhir, canLihatCus);
// ─────────────────────────────────────────────────────────
// EXPORT DETAIL — flat per baris detail, TAPI ikut sertakan semua
// kolom header (sama seperti getBrowse) supaya FE bisa kelompokkan
// per Nomor SJ dan render header cuma sekali per grup.
// ─────────────────────────────────────────────────────────
const getExportDetail = async (tglAwal, tglAkhir, canLihatCus = false) => {
  const custCols = canLihatCus
    ? `a.sj_cus_kode AS KdCus,
       c.cus_nama AS Customer,
       a.sj_alamat_customer AS Alamat,
       a.sj_kota_customer AS Kota,`
    : `"" AS KdCus,
       "" AS Customer,
       "" AS Alamat,
       "" AS Kota,`;

  const [rows] = await db.query(
    `SELECT
       a.sj_nomor                                     AS Nomor,
       DATE_FORMAT(a.sj_tanggal,'%Y-%m-%d')            AS Tanggal,
       v.divisi                                        AS Divisi,
       ${custCols}
       a.sj_keterangan                                  AS Keterangan,
       g.gdg_nama                                       AS Gudang,
       DATE_FORMAT(a.date_create,'%d-%m-%Y %T')         AS Created,
       d.sjd_spk_nomor  AS Kode,
       s.spk_nama       AS Nama,
       s.spk_ukuran     AS Ukuran,
       s.spk_panjang    AS Panjang,
       s.spk_lebar      AS Lebar,
       d.sjd_jumlah     AS Jumlah,
       d.sjd_keterangan AS KetDetail
     FROM tsj_hdr_bayangan a
     INNER JOIN tsj_dtl_bayangan d ON d.sjd_sj_nomor = a.sj_nomor
     INNER JOIN tspk s ON s.spk_nomor = d.sjd_spk_nomor
     INNER JOIN tgudang g ON g.gdg_kode = a.sj_gdg_kode
     LEFT JOIN tcustomer c ON c.cus_kode = a.sj_cus_kode
     LEFT JOIN tdivisi v ON v.kode = a.sj_divisi
     WHERE a.sj_tanggal >= ? AND a.sj_tanggal <= ?
     ORDER BY a.sj_nomor`,
    [tglAwal, tglAkhir],
  );
  return rows;
};

module.exports = {
  getBrowse,
  getBrowseDetail,
  cekBisaUbah,
  cekBisaHapus,
  cekBisaCetak,
  deleteData,
  getExportData,
  getExportDetail,
};
