const db = require("../../../config/database");

const getBrowse = async (query) => {
  const { startDate, endDate, cabang = "", divisi = "" } = query;

  const today = new Date().toISOString().substring(0, 10);
  const dStart = startDate || today;
  const dEnd = endDate || today;

  let whereSpkExtra = "";
  let whereSoExtra = "";
  const paramsSpk = [dStart, dEnd];
  const paramsSo = [dStart, dEnd];

  if (cabang) {
    whereSpkExtra += " AND s.spk_cab = ?";
    paramsSpk.push(cabang);
    whereSoExtra += " AND so.so_cab = ?";
    paramsSo.push(cabang);
  }
  if (divisi && divisi !== "0") {
    whereSpkExtra += " AND s.spk_divisi = ?";
    paramsSpk.push(divisi);
    whereSoExtra += " AND so.so_divisi = ?";
    paramsSo.push(divisi);
  }

  const sql = `
    SELECT
      Nomor, Tanggal, Customer, Nama, Divisi, DivisiNama, Cabang,
      Sales, Pesan, Kirim, Kurang, Dateline
    FROM (
      -- ── Cabang SPK (legacy) — exclude yang sudah punya SO
      -- (spk_so_ref terisi), supaya tidak double count dengan
      -- baris SO-nya. Pola sama seperti realisasiPenjualanService.
      SELECT
        s.spk_nomor                                       AS Nomor,
        DATE_FORMAT(s.spk_tanggal, '%d-%m-%Y')            AS Tanggal,
        s.spk_tanggal                                      AS Tanggal_Raw,
        c.Cus_nama                                         AS Customer,
        s.spk_nama                                          AS Nama,
        v.Divisi                                            AS DivisiNama,
        s.spk_divisi                                        AS Divisi,
        s.spk_cab                                           AS Cabang,
        a.sal_nama                                          AS Sales,
        s.spk_jumlah                                        AS Pesan,
        IFNULL(s.spk_jumlah_kirim, 0)                      AS Kirim,
        (s.spk_jumlah - IFNULL(s.spk_jumlah_kirim, 0))     AS Kurang,
        DATE_FORMAT(s.spk_dateline, '%d-%m-%Y')            AS Dateline
      FROM tspk s
      LEFT JOIN tdivisi v    ON v.kode     = s.spk_divisi
      LEFT JOIN tsales a     ON a.sal_kode = s.spk_sal_kode
      LEFT JOIN tcustomer c  ON c.Cus_kode = s.spk_cus_kode
      WHERE s.spk_aktif = 'Y'
        AND s.spk_close = 0
        AND s.spk_is_so = 0
        AND (s.spk_so_ref IS NULL OR s.spk_so_ref = '')
        AND s.spk_tanggal >= ?
        AND s.spk_tanggal <= ?
        AND s.spk_nomor NOT IN (
          SELECT pjwd_so_nomor FROM tpenjadwalan_ppic_dtl
          WHERE pjwd_so_nomor IS NOT NULL
        )
        ${whereSpkExtra}

      UNION ALL

      -- ── Cabang SO (baru) ──
      SELECT
        so.so_nomor                                       AS Nomor,
        DATE_FORMAT(so.so_tanggal, '%d-%m-%Y')            AS Tanggal,
        so.so_tanggal                                      AS Tanggal_Raw,
        c2.Cus_nama                                         AS Customer,
        so.so_nama                                          AS Nama,
        v2.Divisi                                           AS DivisiNama,
        so.so_divisi                                        AS Divisi,
        so.so_cab                                           AS Cabang,
        a2.sal_nama                                         AS Sales,
        so.so_jumlah                                        AS Pesan,
        IFNULL(so.so_jumlah_kirim, 0)                      AS Kirim,
        (so.so_jumlah - IFNULL(so.so_jumlah_kirim, 0))     AS Kurang,
        DATE_FORMAT(so.so_dateline, '%d-%m-%Y')            AS Dateline
      FROM tsalesorder so
      LEFT JOIN tdivisi v2    ON v2.kode     = so.so_divisi
      LEFT JOIN tsales a2     ON a2.sal_kode = so.so_sal_kode
      LEFT JOIN tcustomer c2  ON c2.Cus_kode = so.so_cus_kode
      WHERE so.so_aktif = 'Y'
        AND so.so_close = 0
        AND so.so_tanggal >= ?
        AND so.so_tanggal <= ?
        AND so.so_nomor NOT IN (
          SELECT pjwd_so_nomor FROM tpenjadwalan_ppic_dtl
          WHERE pjwd_so_nomor IS NOT NULL
        )
        ${whereSoExtra}
    ) x
    ORDER BY Tanggal_Raw ASC, Nomor ASC
  `;

  const [rows] = await db.query(sql, [...paramsSpk, ...paramsSo]);
  return rows;
};

// ── Lookup Cabang (workshop) — dipakai buat dropdown filter ──
const getCabangOptions = async () => {
  const [rows] = await db.query(
    `SELECT pab_kode AS Kode, pab_nama AS Nama
     FROM tpabrik
     WHERE pab_kode IN ('P01','P02','P04','P05')
     ORDER BY pab_kode`,
  );
  return rows;
};

// ── Lookup Divisi — dipakai buat dropdown filter ──
const getDivisiOptions = async () => {
  const [rows] = await db.query(
    `SELECT kode AS Kode, Divisi AS Nama FROM tdivisi ORDER BY kode`,
  );
  return rows;
};

module.exports = { getBrowse, getCabangOptions, getDivisiOptions };
