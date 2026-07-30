const db = require("../../config/database");

/**
 * Ambil data browse SJ Map untuk update status
 */
const getBrowseData = async (startDate, endDate, canLihatCus = false) => {
  const custCols = canLihatCus
    ? `c.cus_nama AS Customer,
       h.sj_alamat_customer AS Alamat,
       h.sj_kota_customer AS Kota,`
    : `"" AS Customer,
       "" AS Alamat,
       "" AS Kota,`;

  const query = `
    SELECT 
      h.sj_nomor AS Nomor,
      h.sj_tanggal AS Tanggal,
      d.divisi AS Divisi,
      ${custCols}
      s.stssj_nama AS Status,
      h.sj_stssj_kode AS StatusCode,
      h.expedisi AS Expedisi,
      h.kurir AS Kurir,
      h.nomor_resi AS Nomor_resi,
      h.tanggal_kirim AS Tanggal_kirim,
      h.biaya_kirim AS Biaya_Kirim,
      h.tanggal_kembali AS Tanggal_kembali,
      h.penerima_barang AS Penerima_barang,
      h.tanggal_terima_sj AS Tanggal_terima_sj,
      h.contact_person AS Contact_person,
      h.tanggal_konfirmasi AS Tanggal_konfirmasi,
      h.tanggal_terima AS Tanggal_terima,
      h.tanggal_serahterima AS Tanggal_serahterima
    FROM tsj_hdr_memo h
    INNER JOIN tcustomer c ON h.sj_cus_kode = c.cus_kode
    INNER JOIN tstatussj s ON h.sj_stssj_kode = s.stssj_kode
    LEFT JOIN tdivisi d ON h.sj_divisi = d.kode
    WHERE h.sj_tanggal BETWEEN ? AND ?
    ORDER BY h.sj_tanggal DESC, h.sj_nomor DESC
  `;
  const [rows] = await db.query(query, [startDate, endDate]);
  return rows;
};

/**
 * Ambil daftar pilihan status (tstatussj) untuk dropdown di form
 */
const getStatusOptions = async () => {
  const [rows] = await db.query(
    "SELECT stssj_kode AS value, stssj_nama AS title FROM tstatussj ORDER BY stssj_kode",
  );
  return rows;
};

/**
 * Update Status dan Data Logistik SJ
 */
const updateStatusSj = async (nomorSj, payload, userKode) => {
  const query = `
    UPDATE tsj_hdr_memo SET 
      sj_stssj_kode = ?,
      expedisi = ?,
      kurir = ?,
      nomor_resi = ?,
      tanggal_kirim = ?,
      biaya_kirim = ?,
      tanggal_kembali = ?,
      penerima_barang = ?,
      tanggal_terima_sj = ?,
      contact_person = ?,
      tanggal_konfirmasi = ?,
      tanggal_terima = ?,
      tanggal_serahterima = ?,
      user_modified = ?,
      date_modified = NOW()
    WHERE sj_nomor = ?
  `;

  const params = [
    payload.sj_stssj_kode,
    payload.expedisi,
    payload.kurir,
    payload.nomor_resi,
    payload.tanggal_kirim || null,
    payload.biaya_kirim || 0,
    payload.tanggal_kembali || null,
    payload.penerima_barang,
    payload.tanggal_terima_sj || null,
    payload.contact_person,
    payload.tanggal_konfirmasi || null,
    payload.tanggal_terima || null,
    payload.tanggal_serahterima || null,
    userKode,
    nomorSj,
  ];

  const [result] = await db.query(query, params);
  return result;
};

const getSjDetailForUpdate = async (nomor, canLihatCus = false) => {
  const custCols = canLihatCus
    ? `c.cus_nama, c.cus_alamat, c.cus_kota,`
    : `"" AS cus_nama, "" AS cus_alamat, "" AS cus_kota,`;

  const [header] = await db.query(
    `SELECT 
      a.sj_nomor, a.sj_tanggal, a.sj_keterangan, a.sj_perush_kode, a.sj_alamat_customer, a.sj_kota_customer, p.perush_nama,
      a.sj_cus_kode, ${custCols}
      a.sj_stssj_kode, a.expedisi, a.biaya_kirim, a.kurir, a.tanggal_kirim, a.nomor_resi, 
      a.tanggal_kembali, a.contact_person, a.tanggal_konfirmasi, a.tanggal_terima, 
      a.tanggal_terima_sj, a.tanggal_serahterima, a.penerima_barang, a.pic_acc
    FROM tsj_hdr_memo a
    INNER JOIN tperusahaan p ON a.sj_perush_kode = p.perush_kode 
    INNER JOIN tcustomer c ON a.sj_cus_kode = c.cus_kode
    WHERE a.sj_nomor = ?`,
    [nomor],
  );

  const [details] = await db.query(
    `SELECT 
      d.sjd_mspk_nomor AS kode, m.mspk_nama AS nama, d.sjd_ukuran AS ukuran, 
      m.mspk_jo_kode AS jenis_order, d.sjd_jumlah AS jumlah, 
      (m.mspk_jumlah_kirim - d.sjd_jumlah) AS jumlah_kirim, 
      (m.mspk_jumlah - m.mspk_jumlah_kirim + d.sjd_jumlah) AS kurang
     FROM tsj_dtl_memo d
     LEFT JOIN tmemospk m ON d.sjd_mspk_nomor = m.mspk_nomor
     WHERE d.sjd_sj_nomor = ?`,
    [nomor],
  );

  return { header: header[0], details };
};

module.exports = {
  getBrowseData,
  getStatusOptions,
  updateStatusSj,
  getSjDetailForUpdate,
};
