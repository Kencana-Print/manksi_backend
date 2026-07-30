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
    ? `s.spk_cus_kode AS Kode,
       c.cus_nama AS Customer,
       c.cus_alamat AS Alamat`
    : `"" AS Kode,
       "" AS Customer,
       "" AS Alamat`;

  const sql = `
    SELECT
      x.Divisi,
      x.Nomor,
      DATE_FORMAT(x.Tanggal, '%Y-%m-%d') AS Tanggal,
      IFNULL(DATEDIFF(x.TanggalJadi, x.Tanggal), '') AS Hari,
      DATE_FORMAT(x.TanggalJadi, '%Y-%m-%d') AS TanggalJadi,
      DATE_FORMAT(x.Dateline, '%Y-%m-%d') AS Dateline,
      x.Nama,
      x.Jumlah,
      x.JumlahJadi,
      x.Kode,
      x.Customer,
      x.Alamat
    FROM (
      SELECT
        s.SPK_Nomor AS Nomor,
        s.spk_tanggal AS Tanggal,
        v.divisi AS Divisi,
        (
          SELECT h.stbj_tanggal
          FROM tstbj_hdr h
          LEFT JOIN tstbj_dtl d ON d.STBJD_STBJ_Nomor = h.stbj_nomor
          WHERE d.STBJD_SPK_Nomor = s.SPK_Nomor
          ORDER BY h.stbj_tanggal DESC LIMIT 1
        ) AS TanggalJadi,
        s.spk_dateline AS Dateline,
        s.spk_nama AS Nama,
        s.spk_jumlah AS Jumlah,
        s.spk_jumlah_jadi AS JumlahJadi,
        ${custCols}
      FROM tspk s
      LEFT JOIN tcustomer c ON s.spk_cus_kode = c.cus_kode
      LEFT JOIN tdivisi v ON v.kode = s.spk_divisi
      WHERE s.spk_aktif = "Y"
        AND s.spk_tanggal >= ?
        AND s.spk_tanggal <= ?
        ${divisiFilter}
    ) x
    ORDER BY x.Tanggal
  `;

  const [rows] = await db.query(sql, params);
  return rows;
};

// ─────────────────────────────────────────────────────────
// DETAIL — dipanggil on-demand saat row di-expand
// ✅ FIX dibanding Delphi: fetch langsung by nomor SPK (bukan preload
//    lintas-tanggal via master-detail grid binding) — sidestep kelas
//    bug yang sama kayak modul laporan/browse lain sebelumnya.
// ─────────────────────────────────────────────────────────
const getDetailByNomor = async (nomor) => {
  const sql = `
    SELECT
      d.STBJD_SPK_Nomor AS Nomor,
      d.STBJD_STBJ_Nomor AS NomorStbj,
      DATE_FORMAT(h.stbj_tanggal, '%Y-%m-%d') AS Tanggal,
      d.STBJD_Jumlah AS Jumlah
    FROM tstbj_dtl d
    LEFT JOIN tstbj_hdr h ON h.stbj_nomor = d.STBJD_STBJ_Nomor
    WHERE d.STBJD_SPK_Nomor = ?
    ORDER BY h.stbj_tanggal
  `;
  const [rows] = await db.query(sql, [nomor]);
  return rows;
};

module.exports = {
  getBrowseList,
  getDetailByNomor,
};
