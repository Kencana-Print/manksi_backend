const db = require("../../../config/database");

// ─────────────────────────────────────────────────────────
// MASTER — replikasi persis query btnRefreshClick
// ─────────────────────────────────────────────────────────
const getBrowseList = async (query, canLihatCus = false) => {
  const today = new Date();
  const defaultStart = new Date(today.getFullYear(), today.getMonth(), 1)
    .toISOString()
    .substring(0, 10);
  const defaultEnd = today.toISOString().substring(0, 10);

  const startDate = query.startDate || defaultStart;
  const endDate = query.endDate || defaultEnd;
  const divisi = query.divisi || "4";

  const params = [startDate, endDate];
  let divisiFilter = "";
  if (divisi && divisi !== "0") {
    divisiFilter = ` AND s.spk_divisi = ?`;
    params.push(divisi);
  }

  const custCols = canLihatCus
    ? `s.spk_cus_kode AS KodeCustomer,
       c.cus_nama AS NamaCustomer,`
    : `"" AS KodeCustomer,
       "" AS NamaCustomer,`;

  const sql = `
    SELECT
      s.spk_nomor AS Nomor,
      DATE_FORMAT(s.spk_tanggal, '%Y-%m-%d') AS Tanggal,
      v.divisi AS Divisi,
      ${custCols}
      s.spk_nama AS Nama,
      s.spk_ukuran AS Ukuran,
      s.spk_panjang AS Panjang,
      s.spk_lebar AS Lebar,
      s.spk_jo_kode AS Jenis,
      s.spk_jumlah AS Jumlah,
      s.spk_prasj AS Prasj,
      s.spk_jumlah_kirim AS Kirim,
      DATE_FORMAT(s.spk_dateline, '%Y-%m-%d') AS Dateline,
      IF(
        s.spk_jumlah_kirim = 0,
        'Belum Terkirim',
        IF(
          s.spk_jumlah_kirim < s.spk_jumlah,
          'Terkirim Sebagian',
          'Terkirim'
        )
      ) AS Stat
    FROM tspk s
    INNER JOIN tcustomer c ON s.spk_cus_kode = c.cus_kode
    LEFT JOIN tdivisi v ON v.kode = s.spk_divisi
    WHERE s.spk_aktif = "Y"
      AND s.spk_tanggal >= ?
      AND s.spk_tanggal <= ?
      ${divisiFilter}
    ORDER BY s.spk_tanggal
  `;

  const [rows] = await db.query(sql, params);
  return rows;
};

// ─────────────────────────────────────────────────────────
// DETAIL — dipanggil on-demand saat row di-expand
// ✅ FIX dibanding Delphi: fetch langsung by nomor SPK (bukan preload
//    lintas-tanggal via master-detail grid binding) — sidestep kelas
//    bug yang sama kayak modul laporan/browse lain sebelumnya.
// ⚠️ Filter bisnis dipertahankan persis: sj_approve<>2 (exclude SJ
//    ditolak) dan sj_perush_kode='KP' (cuma SJ badan usaha Kencana
//    Print, bukan JA/MD).
// ─────────────────────────────────────────────────────────
const getDetailByNomor = async (nomor) => {
  const sql = `
    SELECT
      d.sjd_spk_nomor AS Nomor,
      IF(h.sj_status_otomatis = 1, h.sj_keterangan, h.sj_nomor) AS NomorSJ,
      DATE_FORMAT(h.sj_tanggal, '%Y-%m-%d') AS TanggalSJ,
      h.sj_alamat_customer AS Alamat,
      h.sj_kota_customer AS Kota,
      g.gdg_nama AS Gudang,
      h.sj_perush_kode AS Perusahaan,
      d.sjd_jumlah AS Jumlah
    FROM tsj_dtl d
    INNER JOIN tsj_hdr h ON h.sj_nomor = d.sjd_sj_nomor
    INNER JOIN tgudang g ON g.gdg_kode = h.sj_gdg_kode
    WHERE d.sjd_spk_nomor = ?
      AND h.sj_approve <> 2
    ORDER BY h.sj_tanggal
  `;
  const [rows] = await db.query(sql, [nomor]);
  return rows;
};

module.exports = {
  getBrowseList,
  getDetailByNomor,
};
