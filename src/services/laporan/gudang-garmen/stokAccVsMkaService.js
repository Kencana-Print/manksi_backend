const db = require("../../../config/database");

// ─────────────────────────────────────────────
// MASTER — replikasi persis query Delphi btnRefreshClick.
// CATATAN: form Delphi punya field edtFilter (kode bahan) tapi
// TIDAK pernah dipakai di query btnRefreshClick — jadi field itu
// nonfungsional di aslinya. Direplikasi tanpa filter kode, sesuai
// perilaku yang benar-benar jalan (bukan yang terlihat di UI).
// ─────────────────────────────────────────────
const getBrowse = async (startDate, endDate) => {
  const sql = `
    SELECT z.*, (z.StokAcc - z.Mka) AS Free
    FROM (
      SELECT
        b.brg_kode AS Kode,
        b.brg_nama AS Nama,
        b.brg_satuan AS Satuan,
        IFNULL((
          SELECT SUM(m.mst_stok_in - m.mst_stok_out)
          FROM tmasterstok_acc m
          WHERE m.mst_aktif = 'Y' AND m.mst_brg_kode = b.brg_kode
        ), 0) AS StokAcc,
        IFNULL(k.mka, 0) AS Mka
      FROM tgarmen_brg b
      LEFT JOIN (
        SELECT y.Kode, SUM(y.Mka - y.Realisasi) AS mka
        FROM (
          SELECT x.*,
            (
              SELECT IFNULL(SUM(d.red_jumlah), 0)
              FROM tgarmenrealisasi_hdr h
              INNER JOIN tgarmenrealisasi_dtl d ON d.red_nomor = h.re_nomor
              WHERE h.re_spk_nomor = x.Spk AND d.red_brg_kode = x.Kode
            ) AS Realisasi
          FROM (
            SELECT a.mkb_nomor AS NomorMKA, a.mkb_tanggal AS TglMKA,
                   a.mkb_spk_nomor AS Spk, b.mkbd_brg_kode AS Kode,
                   SUM(b.mkbd_jumlah) AS Mka
            FROM tmka_hdr a
            INNER JOIN tmka_dtl b ON b.mkbd_nomor = a.mkb_nomor
            WHERE a.mkb_tanggal BETWEEN ? AND ?
              AND a.mkb_spk_nomor IN (SELECT spk_nomor FROM tspk WHERE spk_close = 0)
            GROUP BY b.mkbd_brg_kode, a.mkb_nomor
          ) x
        ) y
        WHERE y.Mka > y.Realisasi
        GROUP BY y.Kode
      ) k ON k.Kode = b.brg_kode
      WHERE b.brg_aktif = 'Y' AND b.brg_jenis = 'ACCESORIES'
    ) z
    WHERE z.StokAcc <> z.Mka
    ORDER BY z.Nama
  `;

  const [rows] = await db.query(sql, [startDate, endDate]);
  return rows;
};

// ─────────────────────────────────────────────
// DETAIL — sesuai Delphi SQLDetail, difilter per kode via
// MasterKeyField saat expand baris (di Delphi filter ini otomatis
// dari framework grid; di web dijadikan parameter eksplisit).
// ─────────────────────────────────────────────
const getDetail = async (kode, startDate, endDate) => {
  const sql = `
    SELECT y.Kode, y.NomorMKA, y.TglMKA, y.Spk,
           s.spk_nama AS Nama, y.Mka, y.Realisasi
    FROM (
      SELECT x.*,
        (
          SELECT IFNULL(SUM(d.red_jumlah), 0)
          FROM tgarmenrealisasi_hdr h
          INNER JOIN tgarmenrealisasi_dtl d ON d.red_nomor = h.re_nomor
          WHERE h.re_spk_nomor = x.Spk AND d.red_brg_kode = x.Kode
        ) AS Realisasi
      FROM (
        SELECT b.mkbd_brg_kode AS Kode, a.mkb_nomor AS NomorMKA,
               a.mkb_tanggal AS TglMKA, a.mkb_spk_nomor AS Spk,
               SUM(b.mkbd_jumlah) AS Mka
        FROM tmka_hdr a
        INNER JOIN tmka_dtl b ON b.mkbd_nomor = a.mkb_nomor
        WHERE a.mkb_tanggal BETWEEN ? AND ?
          AND a.mkb_spk_nomor IN (SELECT spk_nomor FROM tspk WHERE spk_close = 0)
        GROUP BY b.mkbd_brg_kode, a.mkb_nomor
      ) x
    ) y
    LEFT JOIN tspk s ON s.spk_nomor = y.Spk
    WHERE y.Mka > y.Realisasi
      AND y.Kode = ?
    ORDER BY y.TglMKA
  `;

  const [rows] = await db.query(sql, [startDate, endDate, kode]);
  return rows;
};

// ─────────────────────────────────────────────
// ALL DETAIL — untuk tombol "Export Detail" (semua baris master
// sesuai filter periode, digabung jadi satu daftar flat).
// ─────────────────────────────────────────────
const getAllDetail = async (startDate, endDate) => {
  const master = await getBrowse(startDate, endDate);

  const result = [];
  for (const b of master) {
    const dtl = await getDetail(b.Kode, startDate, endDate);
    for (const d of dtl) {
      result.push({
        Kode: d.Kode,
        NamaBarang: b.Nama,
        Satuan: b.Satuan,
        ...d,
      });
    }
  }
  return result;
};

module.exports = {
  getBrowse,
  getDetail,
  getAllDetail,
};
