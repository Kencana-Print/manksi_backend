const db = require("../../../config/database");
const { validasiPeriode } = require("../../spanduk/lhk/lhkCommon");

const DIVISI_SPANDUK = 1;
const FMT_TGL = "%Y-%m-%d";

// Laporan Monitoring Proof (Delphi: ufrmBrowseProof)
// Sumber: tmemospk (MAP) divisi Spanduk pada periode mspk_tanggal
const getMonitoringProof = async (tglAwal, tglAkhir) => {
  validasiPeriode(tglAwal, tglAkhir);

  const params = [DIVISI_SPANDUK, tglAwal, tglAkhir];

  const [rows] = await db.query(
    `SELECT m.mspk_nomor AS Nomor,
            DATE_FORMAT(m.mspk_tanggal, '${FMT_TGL}') AS Tanggal,
            DATE_FORMAT(m.mspk_dateline, '${FMT_TGL}') AS Deadline,
            m.mspk_nama AS Nama,
            m.mspk_jo_kode AS Jo_Kode,
            jo.jo_nama AS Jenis_Order,
            m.mspk_panjang AS Panjang,
            m.mspk_lebar AS Lebar,
            m.mspk_rencana_order AS Rencana_Order,
            IFNULL(p.tph_qty, 0) AS Jml_Proof,
            CASE
              WHEN p.tph_tanggal_proof IS NULL
                THEN DATEDIFF(CURDATE(), m.mspk_tanggal)
              ELSE DATEDIFF(p.tph_tanggal_proof, m.mspk_tanggal)
            END AS Lama_Proof,
            DATE_FORMAT(p.tph_tanggal_proof, '${FMT_TGL}') AS Tgl_Proof,
            p.tph_gdg_kode AS Gudang,
            IF(p.tph_status IS NOT NULL, p.tph_status,
               IF(EXISTS(SELECT 1 FROM kencanaprint.tspk s
                         WHERE s.spk_memo = m.mspk_nomor), 'OK', '')) AS Status,
            DATE_FORMAT(p.tph_tanggal_status, '${FMT_TGL}') AS Tg_Status,
            p.tph_arsip AS No_Arsip,
            m.mspk_kain AS Kain
     FROM kencanaprint.tmemospk m
     LEFT JOIN kencanaprint.tproof_hdr p ON p.tph_mspk_nomor = m.mspk_nomor
     LEFT JOIN kencanaprint.tjenisorder jo
       ON jo.jo_kode = m.mspk_jo_kode AND jo.jo_divisi = m.mspk_divisi
     WHERE m.mspk_divisi = ?
       AND m.mspk_tanggal >= ?
       AND m.mspk_tanggal < DATE_ADD(?, INTERVAL 1 DAY)
     ORDER BY m.mspk_tanggal, m.mspk_nomor`,
    params,
  );

  return rows;
};

module.exports = { getMonitoringProof };
