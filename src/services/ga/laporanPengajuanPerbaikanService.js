const pool = require("../../config/database");

/**
 * Service Laporan Pengajuan Perbaikan GA (bsmcabang.job_butuh_hdr & bsmcabang.job_butuh_dtl)
 * Rujukan dari Delphi 7: ufrmLapJobKP.pas
 */

const getBrowse = async ({ tglAwal, tglAkhir, cabang, search }) => {
  let query = `
    SELECT 
      h.jb_nomor AS Nomor,
      DATE_FORMAT(h.jb_tanggal, '%Y-%m-%d %H:%i') AS Tanggal,
      IFNULL(h.jb_cabang, '') AS Cabang,
      IFNULL(u.user_nama, '') AS Pemohon,
      IFNULL(h.jb_lokasi, '') AS Lokasi,
      IFNULL(h.jb_bagian, '') AS Bagian,
      IFNULL(h.jb_jenis, '') AS Jenis,
      IFNULL(h.jb_ket, '') AS Keterangan,
      DATE_FORMAT(h.jb_tgl_konfirga, '%Y-%m-%d %H:%i') AS TglKonfirmasiGA,
      IFNULL(g.user_nama, '') AS NamaGA,
      DATE_FORMAT(h.jb_jadwal1, '%Y-%m-%d') AS Jadwal1,
      DATE_FORMAT(h.jb_jadwal2, '%Y-%m-%d') AS Jadwal2,
      IFNULL(v.user_nama, '') AS Teknisi,
      IF(h.jb_teknisi = '0' OR h.jb_teknisi = '' OR h.jb_teknisi IS NULL, 'Belum', 'Sudah') AS DiKonfirmasiTeknisi,
      DATE_FORMAT(h.jb_tgl_konfirteknisi, '%Y-%m-%d %H:%i') AS TglKonfirmasiTeknisi,
      IF(h.jb_pengajuan = 0, 'Tidak', 'Ya') AS Pengajuan,
      IF(h.jb_selesai = 0, 'Belum', IF(h.jb_selesai = 1, 'Selesai', 'Proses')) AS StatusPengerjaan,
      IFNULL(h.jb_ket_teknisi, '') AS KetProses,
      DATE_FORMAT(h.jb_tgl_selesai, '%Y-%m-%d %H:%i') AS TglSelesai,
      IF(h.jb_image IS NULL OR h.jb_image = '', 'Belum', 'Sudah') AS IsClose,
      DATE_FORMAT(h.jb_tgl_close, '%Y-%m-%d %H:%i') AS TglClose
    FROM bsmcabang.job_butuh_hdr h
    LEFT JOIN bsmcabang.job_user u ON u.user_kode = h.jb_user
    LEFT JOIN bsmcabang.job_user v ON v.user_kode = h.jb_teknisi
    LEFT JOIN bsmcabang.job_user g ON g.user_kode = h.jb_konfirga_nama
    LEFT JOIN bsmcabang.job_user t ON t.user_kode = h.jb_konfirteknisi_nama
    WHERE DATE_FORMAT(h.jb_tanggal, '%Y-%m-%d') BETWEEN ? AND ?
  `;
  const params = [tglAwal, tglAkhir];

  if (cabang && cabang !== "ALL" && cabang !== "") {
    query += ` AND h.jb_cabang = ?`;
    params.push(cabang);
  }

  if (search && search.trim()) {
    query += ` AND (h.jb_nomor LIKE ? OR h.jb_ket LIKE ? OR h.jb_lokasi LIKE ? OR u.user_nama LIKE ? OR v.user_nama LIKE ?)`;
    const term = `%${search.trim()}%`;
    params.push(term, term, term, term, term);
  }

  query += ` ORDER BY h.jb_tanggal DESC, h.jb_nomor DESC`;

  const [rows] = await pool.query(query, params);
  return rows;
};

const getDetailByNomor = async (nomor) => {
  const query = `
    SELECT 
      d.jbd_nomor AS Nomor,
      d.jbd_id AS Id,
      IFNULL(d.jbd_nama, '') AS Nama,
      IFNULL(d.jbd_spesifikasi, '') AS Spesifikasi,
      IFNULL(d.jbd_satuan, '') AS Satuan,
      IFNULL(d.jbd_qty, 0) AS Qty,
      IFNULL(d.jbd_qtyv, 0) AS Verifikasi,
      IFNULL(d.jbd_qtyr, 0) AS Realisasi,
      IFNULL(d.jbd_qtyp, 0) AS Terpakai,
      IF(d.jbd_reject = 'Y', 'Ditolak', 
        IF(h.jb_selesai = 1, 'Selesai', 
          IF(d.jbd_qtyr = d.jbd_qtyv, 'Proses GA', 'Proses Beli')
        )
      ) AS Keterangan
    FROM bsmcabang.job_butuh_dtl d
    INNER JOIN bsmcabang.job_butuh_hdr h ON h.jb_nomor = d.jbd_nomor
    WHERE d.jbd_nomor = ?
    ORDER BY d.jbd_id ASC
  `;

  const [rows] = await pool.query(query, [nomor]);
  return rows;
};

const getAllDetail = async ({ tglAwal, tglAkhir, cabang, search }) => {
  let query = `
    SELECT 
      d.jbd_nomor AS Nomor,
      DATE_FORMAT(h.jb_tanggal, '%Y-%m-%d %H:%i') AS Tanggal,
      IFNULL(h.jb_cabang, '') AS Cabang,
      IFNULL(u.user_nama, '') AS Pemohon,
      IFNULL(h.jb_lokasi, '') AS Lokasi,
      IFNULL(h.jb_bagian, '') AS Bagian,
      IFNULL(h.jb_jenis, '') AS JenisPekerjaan,
      IFNULL(d.jbd_nama, '') AS NamaBarang,
      IFNULL(d.jbd_spesifikasi, '') AS Spesifikasi,
      IFNULL(d.jbd_satuan, '') AS Satuan,
      IFNULL(d.jbd_qty, 0) AS Qty,
      IFNULL(d.jbd_qtyv, 0) AS Verifikasi,
      IFNULL(d.jbd_qtyr, 0) AS Realisasi,
      IFNULL(d.jbd_qtyp, 0) AS Terpakai,
      IF(d.jbd_reject = 'Y', 'Ditolak', 
        IF(h.jb_selesai = 1, 'Selesai', 
          IF(d.jbd_qtyr = d.jbd_qtyv, 'Proses GA', 'Proses Beli')
        )
      ) AS StatusItem,
      IF(h.jb_selesai = 0, 'Belum', IF(h.jb_selesai = 1, 'Selesai', 'Proses')) AS StatusPengerjaan,
      IFNULL(v.user_nama, '') AS Teknisi
    FROM bsmcabang.job_butuh_dtl d
    INNER JOIN bsmcabang.job_butuh_hdr h ON h.jb_nomor = d.jbd_nomor
    LEFT JOIN bsmcabang.job_user u ON u.user_kode = h.jb_user
    LEFT JOIN bsmcabang.job_user v ON v.user_kode = h.jb_teknisi
    WHERE DATE_FORMAT(h.jb_tanggal, '%Y-%m-%d') BETWEEN ? AND ?
  `;
  const params = [tglAwal, tglAkhir];

  if (cabang && cabang !== "ALL" && cabang !== "") {
    query += ` AND h.jb_cabang = ?`;
    params.push(cabang);
  }

  if (search && search.trim()) {
    query += ` AND (h.jb_nomor LIKE ? OR d.jbd_nama LIKE ? OR h.jb_ket LIKE ? OR u.user_nama LIKE ?)`;
    const term = `%${search.trim()}%`;
    params.push(term, term, term, term);
  }

  query += ` ORDER BY h.jb_tanggal DESC, d.jbd_nomor DESC, d.jbd_id ASC`;

  const [rows] = await pool.query(query, params);
  return rows;
};

module.exports = {
  getBrowse,
  getDetailByNomor,
  getAllDetail,
};
