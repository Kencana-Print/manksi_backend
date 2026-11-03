// services/maklonBarang.service.js
// Sumber data maklon berada di database kencanaprint (tabel aplikasi Manksi,
// dipakai bersama). Nama database ditulis eksplisit seperti pola
// "retail.tukuran" supaya query tidak tergantung DB_NAME.
const MKL_DB = "kencanaprint";

const pool = require("../../../../config/database");

// Normalisasi kode cabang (user_cab dari JWT): buang tanda "-", trim, uppercase.
// Mengembalikan null bila kosong / ALL / mulai dengan "HO" (pemakai HO boleh
// melihat semua, mengikuti pola bastMap.service).
const normalizeCabang = (cab) => {
  const val = String(cab ?? "")
    .replace(/-/g, "")
    .trim()
    .toUpperCase();
  if (!val || val === "ALL" || val === "ADMIN" || val.startsWith("HO")) {
    return null;
  }
  return val;
};

// BROWSE — tampilkan dokumen maklon yang cabang asal ATAU cabang tujuannya
// sesuai cabang user yang login (atau semua cabang bila diminta).
const getBrowse = async ({ startDate, endDate, cab, keyword, semuaCabang }) => {
  const start = startDate && String(startDate).trim() !== "" ? String(startDate).trim() : "2000-01-01";
  const end = endDate && String(endDate).trim() !== "" ? String(endDate).trim() : "2099-12-31";

  let sql = `
    SELECT
      h.mkl_nomor, h.mkl_tanggal, h.mkl_deadline, h.mkl_cab_asal, h.mkl_cab_tujuan,
      ga.pab_nama AS NamaCabAsal, gt.pab_nama AS NamaCabTujuan,
      h.mkl_status, h.mkl_keterangan,
      h.mkl_tgl_kirim, h.mkl_tgl_selesai_dtf, h.mkl_tgl_otw_gudang, h.mkl_tgl_selesai,
      h.mkl_user_create, h.mkl_date_create,
      COUNT(d.mkld_id) AS JmlItem,
      SUM(d.mkld_qty_kirim) AS TotalKirim,
      SUM(d.mkld_qty_terima) AS TotalTerima,
      SUM(d.mkld_qty_bs) AS TotalBs,
      (SELECT sjk.sjk_nomor
         FROM ${MKL_DB}.tmaklon_sj_keluar_hdr sjk
        WHERE sjk.sjk_mkl_nomor = h.mkl_nomor
        ORDER BY sjk.sjk_nomor LIMIT 1) AS SjkNomorPertama
    FROM ${MKL_DB}.tmaklon_hdr h
    LEFT JOIN ${MKL_DB}.tpabrik ga ON ga.pab_kode = h.mkl_cab_asal
    LEFT JOIN ${MKL_DB}.tpabrik gt ON gt.pab_kode = h.mkl_cab_tujuan
    LEFT JOIN ${MKL_DB}.tmaklon_dtl d ON d.mkld_mkl_nomor = h.mkl_nomor
    WHERE h.mkl_tanggal BETWEEN ? AND ?
  `;
  const params = [start, end];

  const isAll = semuaCabang === true || semuaCabang === "true" || semuaCabang === "1" || cab === "ALL";
  const cabang = !isAll ? normalizeCabang(cab) : null;
  if (cabang) {
    sql += ` AND (REPLACE(h.mkl_cab_asal, '-', '') = ? OR REPLACE(h.mkl_cab_tujuan, '-', '') = ?)`;
    params.push(cabang, cabang);
  }
  if (keyword && String(keyword).trim() !== "") {
    sql += ` AND (h.mkl_nomor LIKE ? OR h.mkl_keterangan LIKE ? OR ga.pab_nama LIKE ? OR gt.pab_nama LIKE ?)`;
    const kw = `%${String(keyword).trim()}%`;
    params.push(kw, kw, kw, kw);
  }
  sql += ` GROUP BY h.mkl_nomor ORDER BY h.mkl_tanggal DESC, h.mkl_nomor DESC`;

  const [rows] = await pool.query(sql, params);
  return rows;
};

// GET DETAIL — untuk melihat rincian barang yang dimaklon
const getDetail = async (nomor) => {
  const [[header]] = await pool.query(
    `SELECT h.*, ga.pab_nama AS NamaCabAsal, gt.pab_nama AS NamaCabTujuan
     FROM ${MKL_DB}.tmaklon_hdr h
     LEFT JOIN ${MKL_DB}.tpabrik ga ON ga.pab_kode = h.mkl_cab_asal
     LEFT JOIN ${MKL_DB}.tpabrik gt ON gt.pab_kode = h.mkl_cab_tujuan
     WHERE h.mkl_nomor = ?`,
    [nomor],
  );
  if (!header) throw new Error("Nomor Maklon tidak ditemukan.");

  const [details] = await pool.query(
    `SELECT d.*,
            IF(d.mkld_is_freetext = 1, d.mkld_nama_polos_manual, b.brg_nama) AS NamaPolos
     FROM ${MKL_DB}.tmaklon_dtl d
     LEFT JOIN ${MKL_DB}.tgarmen_brg b ON b.brg_kode = d.mkld_kode_polos
     WHERE d.mkld_mkl_nomor = ?
     ORDER BY d.mkld_id`,
    [nomor],
  );

  for (const d of details) {
    const [targetJadi] = await pool.query(
      `SELECT j.*, b.brg_nama AS NamaJadi
       FROM ${MKL_DB}.tmaklon_dtl_jadi j
       LEFT JOIN ${MKL_DB}.tgarmen_brg b ON b.brg_kode = j.mkldj_kode_jadi
       WHERE j.mkldj_mkld_id = ?
       ORDER BY j.mkldj_id`,
      [d.mkld_id],
    );
    for (const t of targetJadi) {
      const [gambar] = await pool.query(
        `SELECT mklg_id, mklg_file_path, mklg_keterangan FROM ${MKL_DB}.tmaklon_gambar WHERE mklg_mkldj_id = ?`,
        [t.mkldj_id],
      );
      t.gambar = gambar;
    }
    d.target_jadi = targetJadi;
  }

  return { header, details };
};

// GET PRINT DATA — untuk cetak Maklon Barang (2 rangkap / referensi produksi)
const getPrintData = async (nomor) => {
  const [[header]] = await pool.query(
    `SELECT h.*, ga.pab_nama AS NamaCabAsal, gt.pab_nama AS NamaCabTujuan
     FROM ${MKL_DB}.tmaklon_hdr h
     LEFT JOIN ${MKL_DB}.tpabrik ga ON ga.pab_kode = h.mkl_cab_asal
     LEFT JOIN ${MKL_DB}.tpabrik gt ON gt.pab_kode = h.mkl_cab_tujuan
     WHERE h.mkl_nomor = ?`,
    [nomor],
  );
  if (!header) throw new Error("Nomor Maklon tidak ditemukan.");

  const [details] = await pool.query(
    `SELECT d.mkld_id, d.mkld_kode_polos,
            IF(d.mkld_is_freetext = 1, d.mkld_nama_polos_manual, b.brg_nama) AS NamaPolos,
            d.mkld_qty_kirim, d.mkld_satuan_kirim, d.mkld_keterangan, d.mkld_is_freetext
     FROM ${MKL_DB}.tmaklon_dtl d
     LEFT JOIN ${MKL_DB}.tgarmen_brg b ON b.brg_kode = d.mkld_kode_polos
     WHERE d.mkld_mkl_nomor = ?
     ORDER BY d.mkld_id`,
    [nomor],
  );

  for (const d of details) {
    const [targetJadi] = await pool.query(
      `SELECT j.mkldj_id, j.mkldj_kode_jadi, bj.brg_nama AS NamaJadi,
              j.mkldj_estimasi_qty, j.mkldj_dateline
       FROM ${MKL_DB}.tmaklon_dtl_jadi j
       LEFT JOIN ${MKL_DB}.tgarmen_brg bj ON bj.brg_kode = j.mkldj_kode_jadi
       WHERE j.mkldj_mkld_id = ?
       ORDER BY j.mkldj_id`,
      [d.mkld_id],
    );
    for (const t of targetJadi) {
      const [gambar] = await pool.query(
        `SELECT mklg_file_path, mklg_keterangan FROM ${MKL_DB}.tmaklon_gambar WHERE mklg_mkldj_id = ?`,
        [t.mkldj_id],
      );
      t.gambar = gambar;
    }
    d.target_jadi = targetJadi;
  }

  return { header, details };
};

// GET SJ KELUAR PRINT DATA — untuk cetak Surat Jalan Maklon Keluar
const getSjKeluarPrintData = async (sjkNomor) => {
  const [[header]] = await pool.query(
    `SELECT h.sjk_nomor, h.sjk_tanggal, h.sjk_mkl_nomor, h.sjk_user_create,
            m.mkl_cab_asal, m.mkl_cab_tujuan,
            ga.pab_nama AS NamaCabAsal, gt.pab_nama AS NamaCabTujuan
     FROM ${MKL_DB}.tmaklon_sj_keluar_hdr h
     JOIN ${MKL_DB}.tmaklon_hdr m ON m.mkl_nomor = h.sjk_mkl_nomor
     LEFT JOIN ${MKL_DB}.tpabrik ga ON ga.pab_kode = m.mkl_cab_asal
     LEFT JOIN ${MKL_DB}.tpabrik gt ON gt.pab_kode = m.mkl_cab_tujuan
     WHERE h.sjk_nomor = ?`,
    [sjkNomor],
  );
  if (!header) throw new Error("SJ Keluar tidak ditemukan.");

  const [details] = await pool.query(
    `SELECT d.sjkd_qty_kirim, dd.mkld_kode_polos AS KodePolos,
            IF(dd.mkld_is_freetext = 1, dd.mkld_nama_polos_manual, b.brg_nama) AS NamaPolos,
            IF(dd.mkld_is_freetext = 1, dd.mkld_satuan_kirim, b.brg_satuan) AS Satuan,
            dd.mkld_keterangan AS Keterangan
     FROM ${MKL_DB}.tmaklon_sj_keluar_dtl d
     JOIN ${MKL_DB}.tmaklon_dtl dd ON dd.mkld_id = d.sjkd_mkld_id
     LEFT JOIN ${MKL_DB}.tgarmen_brg b ON b.brg_kode = dd.mkld_kode_polos
     WHERE d.sjkd_sjk_nomor = ?`,
    [sjkNomor],
  );

  return { header, details };
};

// LOOKUP MAKLON — seperti lookup di Manksi web, tetapi data yang tampil
// hanya dokumen maklon yang CABANG TUJUANNYA sesuai cabang user yang login.
const lookupMaklon = async ({ keyword, cab, limit = 100 }) => {
  let sql = `
    SELECT
      h.mkl_nomor AS Nomor,
      h.mkl_keterangan AS Nama,
      h.mkl_tanggal AS Tanggal,
      h.mkl_cab_tujuan AS CabTujuan,
      h.mkl_status AS Status,
      IFNULL(r.rencana, 0) AS Rencana,
      (IFNULL(p_dtf.hasil, 0) + IFNULL(p_mesin.hasil, 0)) AS SudahHasil,
      'MAKLON' AS Tipe
    FROM ${MKL_DB}.tmaklon_hdr h
    LEFT JOIN (
      SELECT d.mkld_mkl_nomor AS nomor, SUM(j.mkldj_estimasi_qty) AS rencana
        FROM ${MKL_DB}.tmaklon_dtl d
        INNER JOIN ${MKL_DB}.tmaklon_dtl_jadi j ON j.mkldj_mkld_id = d.mkld_id
       GROUP BY d.mkld_mkl_nomor
    ) r ON r.nomor = h.mkl_nomor
    LEFT JOIN (
      SELECT dm.mkl_nomor AS nomor, SUM(dh.dmh_qty_hasil + dh.dmh_bs_afval) AS hasil
        FROM ${MKL_DB}.tdtf_maklon dm
        INNER JOIN ${MKL_DB}.tdtf_maklon_hasil dh ON dh.dmh_dtf_maklon_id = dm.id
       GROUP BY dm.mkl_nomor
    ) p_dtf ON p_dtf.nomor = h.mkl_nomor
    LEFT JOIN (
      SELECT TRIM(md.ld_spk_nomor) AS nomor, SUM(md.ld_total_qtycetak) AS hasil
        FROM ${MKL_DB}.tlhk_mesin_dtl md
       GROUP BY TRIM(md.ld_spk_nomor)
    ) p_mesin ON p_mesin.nomor = h.mkl_nomor
    WHERE h.mkl_status IN ('DIKIRIM','SEBAGIAN DIKIRIM','OTW GUDANG','DITERIMA SEBAGIAN','SELESAI')
      AND (h.mkl_nomor LIKE ? OR h.mkl_keterangan LIKE ?)
      AND NOT (IFNULL(r.rencana, 0) > 0 AND (IFNULL(p_dtf.hasil, 0) + IFNULL(p_mesin.hasil, 0)) >= r.rencana)
  `;
  const like = `%${(keyword || "").trim()}%`;
  const params = [like, like];

  const cabang = normalizeCabang(cab);
  if (cabang) {
    sql += ` AND REPLACE(h.mkl_cab_tujuan, '-', '') = ?`;
    params.push(cabang);
  }

  sql += ` ORDER BY h.mkl_tanggal DESC, h.mkl_nomor DESC LIMIT ?`;
  params.push(Number(limit) || 100);

  const [rows] = await pool.query(sql, params);
  return rows;
};

module.exports = {
  getBrowse,
  getDetail,
  getPrintData,
  getSjKeluarPrintData,
  lookupMaklon,
  normalizeCabang,
};
