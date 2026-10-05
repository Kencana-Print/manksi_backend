const db = require("../../../config/database");

/**
 * MENGAMBIL REKAP PIUTANG (PIVOT BULAN)
 * Menjumlahkan saldo per customer (Debet - Bayar) yang dikelompokkan
 * ke dalam kolom Tahun Lalu, Jan, Feb, dst hingga bulan dari batas endDate.
 * Piutang yang sudah ditandai write-off dikecualikan dari perhitungan.
 */
const getRekapPiutang = async (query) => {
  const { endDate, perusahaan } = query;

  const dEnd = endDate || new Date().toISOString().substring(0, 10);
  const year = new Date(dEnd).getFullYear();
  const startOfYear = `${year}-01-01`;

  let filterPerusahaan = "";
  const subParams = [
    startOfYear, // Tahun Lalu < Tahun ini
    year,
    year,
    year,
    year,
    year,
    year,
    year,
    year,
    year,
    year,
    year,
    year, // 12 Parameter Tahun
    dEnd, // Tgl limit untuk subquery Bayar (tak-normal aware)
    dEnd, // Tgl limit untuk filter tanggal di base
  ];

  if (perusahaan) {
    filterPerusahaan = " AND p.cabang = ? ";
    subParams.push(perusahaan);
  }

  const sql = `
    SELECT 
      base.customer AS Kode,
      c.Cus_nama AS Customer,
      SUM(CASE WHEN base.tanggal < ? THEN base.Sisa ELSE 0 END) AS TahunLalu,
      SUM(CASE WHEN YEAR(base.tanggal) = ? AND MONTH(base.tanggal) = 1 THEN base.Sisa ELSE 0 END) AS Jan,
      SUM(CASE WHEN YEAR(base.tanggal) = ? AND MONTH(base.tanggal) = 2 THEN base.Sisa ELSE 0 END) AS Feb,
      SUM(CASE WHEN YEAR(base.tanggal) = ? AND MONTH(base.tanggal) = 3 THEN base.Sisa ELSE 0 END) AS Mar,
      SUM(CASE WHEN YEAR(base.tanggal) = ? AND MONTH(base.tanggal) = 4 THEN base.Sisa ELSE 0 END) AS Apr,
      SUM(CASE WHEN YEAR(base.tanggal) = ? AND MONTH(base.tanggal) = 5 THEN base.Sisa ELSE 0 END) AS Mei,
      SUM(CASE WHEN YEAR(base.tanggal) = ? AND MONTH(base.tanggal) = 6 THEN base.Sisa ELSE 0 END) AS Jun,
      SUM(CASE WHEN YEAR(base.tanggal) = ? AND MONTH(base.tanggal) = 7 THEN base.Sisa ELSE 0 END) AS Jul,
      SUM(CASE WHEN YEAR(base.tanggal) = ? AND MONTH(base.tanggal) = 8 THEN base.Sisa ELSE 0 END) AS Agu,
      SUM(CASE WHEN YEAR(base.tanggal) = ? AND MONTH(base.tanggal) = 9 THEN base.Sisa ELSE 0 END) AS Sep,
      SUM(CASE WHEN YEAR(base.tanggal) = ? AND MONTH(base.tanggal) = 10 THEN base.Sisa ELSE 0 END) AS Okt,
      SUM(CASE WHEN YEAR(base.tanggal) = ? AND MONTH(base.tanggal) = 11 THEN base.Sisa ELSE 0 END) AS Nov,
      SUM(CASE WHEN YEAR(base.tanggal) = ? AND MONTH(base.tanggal) = 12 THEN base.Sisa ELSE 0 END) AS Des,
      SUM(base.Sisa) AS GrandTotal
    FROM (
      SELECT
        p.customer,
        p.nota,
        p.tanggal,
        (IFNULL((
            SELECT pd2.debet
            FROM piutang_debet pd2
            WHERE pd2.nota = (SELECT tf.invf_taknormal FROM tinv_flag tf WHERE tf.invf_normal = p.nota LIMIT 1)
              AND pd2.is_writeoff = 0
            LIMIT 1
          ), p.debet) - IFNULL((
          SELECT SUM(kd.kredit)
          FROM piutang_kredit_detail kd
          INNER JOIN piutang_kredit_header kh ON kh.nomor = kd.nomor
          WHERE kd.nota = IFNULL(
            (SELECT tf.invf_taknormal FROM tinv_flag tf WHERE tf.invf_normal = p.nota LIMIT 1),
            p.nota
          )
          AND kh.tanggal <= ?
        ), 0)) AS Sisa
      FROM piutang_debet p
      WHERE p.flag = 0
        AND p.is_writeoff = 0
        AND p.tanggal <= ?
        AND p.nota NOT IN (SELECT x.inv_nomor FROM tinv_hdr x WHERE x.INV_Keterangan LIKE '%INV YG DIKIRIM%')
        ${filterPerusahaan}
    ) base
    LEFT JOIN tcustomer c ON c.Cus_kode = base.customer
    GROUP BY base.customer, c.Cus_nama
    HAVING GrandTotal <> 0 OR TahunLalu <> 0
    ORDER BY TahunLalu DESC, Jan DESC, Feb DESC, Mar DESC, Apr DESC, Mei DESC, Jun DESC, Jul DESC, Agu DESC, Sep DESC, Okt DESC, Nov DESC, Des DESC
  `;

  const [rows] = await db.query(sql, subParams);
  return rows;
};

const getDetailPiutang = async (query) => {
  const { customer, endDate, perusahaan } = query;

  const dEnd = endDate || new Date().toISOString().substring(0, 10);

  let filterPerusahaan = "";
  const params = [dEnd, dEnd, dEnd];

  if (perusahaan) {
    filterPerusahaan = " AND p.cabang = ? ";
    params.push(perusahaan);
  }

  params.push(customer);

  const sql = `
    SELECT
      p.nota AS Nota,
      p.tanggal AS Tanggal,
      CAST(h.inv_no_fp AS CHAR(60)) AS FakturPajak,
      IFNULL((
        SELECT GROUP_CONCAT(
                 DISTINCT NULLIF(TRIM(COALESCE(
                   NULLIF(s.spk_nomor_po, ''),
                   NULLIF(so1.so_nomor_po, ''),
                   so2.so_nomor_po
                 )), '')
                 SEPARATOR ', '
               )
        FROM tinv_dtl d
        INNER JOIN tspk s ON s.spk_nomor = d.invd_spk_nomor
        LEFT JOIN tsalesorder so1 ON so1.so_nomor = s.spk_so_ref
        LEFT JOIN tsalesorder so2 ON so2.so_nomormemo = s.spk_memo AND s.spk_memo <> ''
        WHERE d.invd_inv_nomor = p.nota
      ), '') AS NoPO,
      IFNULL((
        SELECT SUM(kd.kredit)
        FROM piutang_kredit_detail kd
        INNER JOIN piutang_kredit_header kh ON kh.nomor = kd.nomor
        WHERE kd.nota = IFNULL(
          (SELECT tf.invf_taknormal FROM tinv_flag tf WHERE tf.invf_normal = p.nota LIMIT 1),
          p.nota
        )
        AND kh.tanggal <= ?
      ), 0) AS Bayar,
      (IFNULL((
          SELECT pd2.debet
          FROM piutang_debet pd2
          WHERE pd2.nota = (SELECT tf.invf_taknormal FROM tinv_flag tf WHERE tf.invf_normal = p.nota LIMIT 1)
            AND pd2.is_writeoff = 0
          LIMIT 1
        ), p.debet) - IFNULL((
        SELECT SUM(kd.kredit)
        FROM piutang_kredit_detail kd
        INNER JOIN piutang_kredit_header kh ON kh.nomor = kd.nomor
        WHERE kd.nota = IFNULL(
          (SELECT tf.invf_taknormal FROM tinv_flag tf WHERE tf.invf_normal = p.nota LIMIT 1),
          p.nota
        )
        AND kh.tanggal <= ?
      ), 0)) AS Sisa
    FROM piutang_debet p
    LEFT JOIN tinv_hdr h ON h.inv_nomor = p.nota
    WHERE p.flag = 0
      AND p.is_writeoff = 0
      AND p.tanggal <= ?
      AND p.nota NOT IN (SELECT x.inv_nomor FROM tinv_hdr x WHERE x.INV_Keterangan LIKE '%INV YG DIKIRIM%')
      ${filterPerusahaan}
      AND p.customer = ?
    HAVING Sisa <> 0
    ORDER BY p.tanggal ASC
  `;

  const [rows] = await db.query(sql, params);
  return rows;
};

module.exports = {
  getRekapPiutang,
  getDetailPiutang,
};
