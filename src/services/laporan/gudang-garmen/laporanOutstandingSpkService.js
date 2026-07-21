const db = require("../../../config/database");

// ─────────────────────────────────────────────
// MASTER — SPK aktif yang belum lunas kirim (spk_jumlah_kirim
// spk_jumlah), replikasi persis filter tahun >=2018 dari Delphi
// (fungsinya cuma exclude data lawas/testing, bukan filter dinamis).
// ─────────────────────────────────────────────
const getBrowse = async () => {
  const sql = `
    SELECT
      spk_nomor AS SPK,
      DATE_FORMAT(spk_tanggal, '%Y-%m-%d') AS Tanggal,
      spk_nama AS Nama,
      spk_jumlah AS Jumlah,
      spk_jumlah_kirim AS Kirim,
      spk_jumlah_jadi AS Jadi
    FROM tspk
    WHERE spk_aktif = 'Y'
      AND spk_jumlah_kirim < spk_jumlah
      AND YEAR(spk_tanggal) >= 2018
    ORDER BY spk_tanggal
  `;
  const [rows] = await db.query(sql);
  return rows;
};

// ─────────────────────────────────────────────
// DETAIL — progress produksi per lini (Gudang_asal) untuk satu SPK.
// Marker komponen "BADAN DEPAN" dipakai buat representasi progress
// SPK (bukan hitung semua komponen — cukup 1 representatif per
// transaksi), persis Delphi.
// ✅ BUG FIXED (sesuai konfirmasi): cabang STBJ sebelumnya selalu
// kosong karena join tbahan dipaksa ke 'LL-000400' tapi difilter
// WHERE bhn_name='BADAN DEPAN' (kontradiktif — tstbj_dtl gak punya
// kolom bhn_kode). Sekarang bypass join tbahan, Komponen/Nama
// di-hardcode 'BADAN DEPAN' langsung biar STBJ ikut kehitung.
// Baris dengan Gudang_asal NULL (label fallback '6.QC') maupun
// gudang yang namanya mengandung 'QC' dikecualikan di WHERE luar,
// persis Delphi.
// ─────────────────────────────────────────────
const getDetail = async (spkNomor) => {
  const sql = `
    SELECT spk, proses, jumlah AS Jumlah, bs AS Bs
    FROM (
      SELECT
        spk_nomor AS spk,
        IF(GudangAsal IS NOT NULL, GudangAsal, '6.QC') AS proses,
        IF(GudangAsal IS NOT NULL, SUM(Jumlah), 0) AS jumlah,
        SUM(IFNULL(bs_kain, 0) + IFNULL(bs_kain_sablon, 0) + IFNULL(bs_sablon, 0)) AS bs
      FROM (
        SELECT
          s.spk_nomor,
          REPLACE(b.gdgp_nama2, 'GD', '') AS GudangAsal,
          d.mpd_jumlah AS Jumlah,
          d.mpd_jumlah_kain AS bs_kain,
          d.mpd_jumlah_sablon AS bs_kain_sablon,
          d.mpd_jumlah_bs AS bs_sablon,
          bh.bhn_name AS BhnName
        FROM tmutasiproduksi_hdr h
        INNER JOIN tmutasiproduksi_dtl d ON d.mpd_mph_nomor = h.mph_nomor
        INNER JOIN tspk s ON s.spk_nomor = h.mph_spk_nomor
          AND s.spk_jumlah > s.spk_jumlah_kirim AND s.spk_aktif = 'Y'
        INNER JOIN tbahan bh ON bh.bhn_kode = d.mpd_bhn_kode
        INNER JOIN tgudangproduksi b ON b.gdgp_kode = h.mph_gdgasal
        INNER JOIN tgudangproduksi c ON c.gdgp_kode = h.mph_gdgtujuan
        WHERE bh.bhn_name = 'BADAN DEPAN' AND s.spk_nomor = ?

        UNION ALL

        SELECT
          s.spk_nomor,
          REPLACE(gp.gdgp_nama2, 'GD', '') AS GudangAsal,
          d.bpjd_jumlah AS Jumlah,
          d.bpjd_bs_kain AS bs_kain,
          d.bpjd_bs_mitra AS bs_kain_sablon,
          d.bpjd_bs AS bs_sablon,
          bh.bhn_name AS BhnName
        FROM tbpj_hdr h
        INNER JOIN tbpj_dtl d ON d.bpjd_bpj_nomor = h.bpj_nomor
        INNER JOIN tpojasa_hdr po ON po.pojh_nomor = h.bpj_po_nomor
        INNER JOIN tspk s ON s.spk_nomor = po.pojh_spk_nomor
          AND s.spk_jumlah > s.spk_jumlah_kirim AND s.spk_aktif = 'Y'
        INNER JOIN tbahan bh ON bh.bhn_kode = d.bpjd_bhn_kode
        INNER JOIN tjasa j ON j.jasa_kode = po.pojh_jasa_kode
        LEFT JOIN tgudangproduksi gp ON gp.gdgp_kode = j.jasa_gdgp_kode
        WHERE bh.bhn_name = 'BADAN DEPAN' AND s.spk_nomor = ?

        UNION ALL

        SELECT
          s.spk_nomor,
          REPLACE(gp.gdgp_nama2, 'GD', '') AS GudangAsal,
          d.stbjd_jumlah AS Jumlah,
          NULL AS bs_kain,
          NULL AS bs_kain_sablon,
          NULL AS bs_sablon,
          'BADAN DEPAN' AS BhnName
        FROM tstbj_hdr h
        INNER JOIN tstbj_dtl d ON d.stbjd_stbj_nomor = h.stbj_nomor
        INNER JOIN tspk s ON s.spk_nomor = d.stbjd_spk_nomor
          AND s.spk_jumlah > s.spk_jumlah_kirim AND s.spk_aktif = 'Y'
        LEFT JOIN tgudangproduksi gp ON gp.gdgp_kode = h.stbj_gdgp_kode
        WHERE s.spk_nomor = ?
      ) final
      WHERE BhnName = 'BADAN DEPAN'
      GROUP BY spk_nomor, GudangAsal
    ) a
    WHERE proses NOT LIKE '%QC%'
    ORDER BY spk
  `;
  const [rows] = await db.query(sql, [spkNomor, spkNomor, spkNomor]);
  return rows;
};

// ─────────────────────────────────────────────
// ALL DETAIL — gabungan detail semua SPK sesuai filter master
// ─────────────────────────────────────────────
const getAllDetail = async () => {
  const master = await getBrowse();
  const result = [];
  for (const m of master) {
    const dtl = await getDetail(m.SPK);
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
