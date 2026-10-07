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

  const TOL = 1000; // toleransi selisih kecil (Rp)
  const POS = `CASE WHEN base.Sisa > ${TOL} THEN base.Sisa ELSE 0 END`;
  const NEG = `CASE WHEN base.Sisa < -${TOL} THEN base.Sisa ELSE 0 END`;
  const BULAN = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "Mei",
    "Jun",
    "Jul",
    "Agu",
    "Sep",
    "Okt",
    "Nov",
    "Des",
  ];
  const kolomBulan = BULAN.map(
    (b, i) =>
      `SUM(CASE WHEN YEAR(base.tanggal) = ? AND MONTH(base.tanggal) = ${i + 1} THEN ${POS} ELSE 0 END) AS ${b}`,
  ).join(",\n      ");

  let filterPerusahaan = "";
  const subParams = [
    startOfYear, // Tahun Lalu < Tahun ini
    ...Array(12).fill(year), // 12 kolom bulan
    dEnd, // limit subquery Bayar
    dEnd, // limit tanggal base
  ];

  if (perusahaan) {
    filterPerusahaan = " AND p.cabang = ? ";
    subParams.push(perusahaan);
  }

  const sql = `
    SELECT 
      base.customer AS Kode,
      c.Cus_nama AS Customer,
      SUM(CASE WHEN base.tanggal < ? THEN ${POS} ELSE 0 END) AS TahunLalu,
      ${kolomBulan},
      SUM(${POS}) AS GrandTotal,
      SUM(${NEG}) AS LebihBayar,
      SUM(CASE WHEN ABS(base.Sisa) > ${TOL} THEN base.Sisa ELSE 0 END) AS Netto
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
    HAVING GrandTotal <> 0 OR LebihBayar <> 0
    ORDER BY GrandTotal DESC, LebihBayar ASC
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
        SELECT pd2.debet
        FROM piutang_debet pd2
        WHERE pd2.nota = (SELECT tf.invf_taknormal FROM tinv_flag tf WHERE tf.invf_normal = p.nota LIMIT 1)
          AND pd2.is_writeoff = 0
        LIMIT 1
      ), p.debet) AS Debet,
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
    HAVING ABS(Sisa) > 1000
    ORDER BY p.tanggal ASC
  `;

  const [rows] = await db.query(sql, params);
  return rows;
};

module.exports = {
  getRekapPiutang,
  getDetailPiutang,
};
