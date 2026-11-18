const pool = require('../../../config/database');
const { format } = require("date-fns");

const lapMonProof = async (startDate, endDate) => {
  const tglMulai = format(new Date(startDate), "yyyy-MM-dd");
  const tglSelesai = format(new Date(endDate), "yyyy-MM-dd");

  const ssql = `
  SELECT 
      mspk.mspk_nomor,
      mspk.mspk_tanggal,
      mspk.mspk_dateline,
      mspk.mspk_nama AS nama_order,
      mspk.mspk_panjang,
      mspk.mspk_lebar,
      mspk.mspk_jumlah AS jml_order,
      mspk.mspk_rencana_order AS rencana_order,
      mspk.mspk_keterangan AS keterangan,
      mspk.mspk_cab AS lokasi_proof,
      zz.mesin_proof, -- <--- PERBAIKAN: Diambil dari subquery 'zz'
      mspk.mspk_kain AS jenis_bahan,
      
      IFNULL(zz.lprd_jproof, 0) AS lprd_jproof,
      zz.lpr_tanggal,
      zz.jenis,
      zz.lama_proof,

      yy.nomorspk,
      yy.spktanggal,
      IF(LENGTH(yy.nomorspk) > 5, 'ACC', '') AS statusmemo

  FROM tmemospk mspk

  LEFT JOIN (
      SELECT 
          a.lprd_spk_nomor,
          a.lprd_j_proof AS lprd_jproof,
          -- PERBAIKAN: Pastikan ejaan kolom lokasi sesuai di DB Anda (lprd_lokasi / lrpd_lokasi)
          a.lprd_lokasi AS mesin_proof, 
          b.lpr_tanggal,

          IF(b.lpr_jenis = 'M', 'MMT',
             IF(b.lpr_jenis = 'S', 'SUBLIM',
                IF(b.lpr_jenis = 'T', 'TEKSTIL', '')
             )
          ) AS jenis,

          DATEDIFF(b.lpr_tanggal, c.mspk_tanggal) AS lama_proof

      FROM tlhk_proofmmt_dtl a
      INNER JOIN tlhk_proofmmt_hdr b 
          ON b.lpr_nomor = a.lprd_lpr_nomor
      INNER JOIN tmemospk c 
          ON c.mspk_nomor = a.lprd_spk_nomor

      WHERE b.lpr_tanggal BETWEEN ? AND ?
  ) zz 
      ON zz.lprd_spk_nomor = mspk.mspk_nomor

  LEFT JOIN (
      SELECT 
          spk_memo,
          spk_nomor AS nomorspk,
          spk_tanggal AS spktanggal
      FROM tspk
      WHERE spk_Aktif = 'Y'
  ) yy 
      ON yy.spk_memo = mspk.mspk_nomor

  WHERE 
      mspk.mspk_tanggal BETWEEN ? AND ?
      AND mspk.mspk_aktif = 'Y'
      AND mspk.mspk_divisi = 5

  ORDER BY mspk.mspk_tanggal ASC
  LIMIT 500
`;
  const params = [tglMulai, tglSelesai, tglMulai, tglSelesai];

  let connection;
  try {
    connection = await pool.getConnection();

    console.time("QUERY LAP MON PROOF");
    const [rows] = await connection.execute(ssql, params);
    console.timeEnd("QUERY LAP MON PROOF");

    return rows;
  } catch (error) {
    console.error("Error lapMonProof:", error);
    throw error;
  } finally {
    if (connection) connection.release();
  }
};

module.exports = { lapMonProof };
