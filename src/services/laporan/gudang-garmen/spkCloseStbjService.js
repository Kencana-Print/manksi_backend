const db = require("../../../config/database");

// ─────────────────────────────────────────────
// MASTER — SPK yang sudah CLOSE (jumlah_jadi >= jumlah), difilter
// berdasarkan bulan/tahun dari spk_date_last_stbj (bukan spk_tanggal).
// ⚠️ QUIRK DIPERTAHANKAN PERSIS (sesuai konfirmasi): kalau bulan=0
// (opsi "Semua Bulan"), filter tetap MONTH(...)=0 yang TIDAK PERNAH
// match tanggal valid apa pun — hasilnya SELALU KOSONG. Ini bug asli
// Delphi, sengaja tidak diperbaiki jadi "skip filter bulan".
// ─────────────────────────────────────────────
const getBrowse = async (bulan, tahun) => {
  const sql = `
    SELECT
      s.spk_nomor AS Nomor,
      DATE_FORMAT(s.spk_tanggal, '%Y-%m-%d') AS Tanggal,
      DATE_FORMAT(s.spk_dateline, '%Y-%m-%d') AS Dateline,
      DATE_FORMAT(s.spk_date_last_stbj, '%Y-%m-%d') AS LastStbj,
      s.spk_nama AS Nama,
      s.spk_jumlah AS Jumlah,
      s.spk_jumlah_jadi AS JmlJadi
    FROM tspk s
    WHERE s.spk_aktif = 'Y'
      AND s.spk_divisi IN (3, 4, 6)
      AND s.spk_jumlah_jadi >= s.spk_jumlah
      AND MONTH(s.spk_date_last_stbj) = ?
      AND YEAR(s.spk_date_last_stbj) = ?
    ORDER BY s.spk_date_last_stbj
  `;
  const [rows] = await db.query(sql, [bulan, tahun]);
  return rows;
};

// ─────────────────────────────────────────────
// DETAIL — SEMUA transaksi STBJ untuk satu SPK (tidak difilter
// bulan/tahun — persis Delphi, yang detail-nya nampilin histori
// STBJ lengkap terlepas dari filter periode master). Difilter
// eksplisit by Nomor (web tidak punya mekanisme master-detail
// otomatis cxGrid).
// ─────────────────────────────────────────────
const getDetail = async (nomor) => {
  const sql = `
    SELECT
      d.STBJD_SPK_Nomor AS Nomor,
      DATE_FORMAT(h.stbj_tanggal, '%Y-%m-%d') AS TanggalStbj,
      d.STBJD_Jumlah AS JmlJadi
    FROM tstbj_dtl d
    INNER JOIN tstbj_hdr h ON h.stbj_nomor = d.STBJD_STBJ_Nomor
    WHERE d.STBJD_SPK_Nomor = ?
    ORDER BY h.stbj_tanggal
  `;
  const [rows] = await db.query(sql, [nomor]);
  return rows;
};

// ─────────────────────────────────────────────
// ALL DETAIL — gabungan detail semua SPK sesuai filter master
// ─────────────────────────────────────────────
const getAllDetail = async (bulan, tahun) => {
  const master = await getBrowse(bulan, tahun);
  const result = [];
  for (const m of master) {
    const dtl = await getDetail(m.Nomor);
    for (const d of dtl) {
      result.push({ Nama: m.Nama, ...d });
    }
  }
  return result;
};

module.exports = {
  getBrowse,
  getDetail,
  getAllDetail,
};
