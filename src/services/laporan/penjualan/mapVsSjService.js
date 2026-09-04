const db = require("../../../config/database");

/**
 * 1. MENGAMBIL DAFTAR MAP (MASTER)
 */
const getMasterMap = async (query, canLihatCus = false) => {
  const { startDate, endDate, divisi } = query;

  const dStart =
    startDate ||
    new Date(new Date().getFullYear(), new Date().getMonth(), 1)
      .toISOString()
      .substring(0, 10);
  const dEnd = endDate || new Date().toISOString().substring(0, 10);

  let filterDivisi = "";
  const params = [dStart, dEnd];

  if (divisi && divisi !== "0") {
    filterDivisi = " AND mspk_divisi = ? ";
    params.push(divisi);
  }

  const custCol = canLihatCus
    ? "c.cus_nama AS NamaCustomer,"
    : `"" AS NamaCustomer,`;

  const sql = `
    SELECT 
      m.mspk_nomor AS Nomor,
      DATE_FORMAT(m.mspk_tanggal, "%d-%m-%Y") AS Tanggal,
      d.Divisi AS Divisi,
      ${custCol}
      m.mspk_nama AS Nama,
      m.mspk_ukuran AS Ukuran,
      m.mspk_jo_kode AS Jenis,
      m.mspk_jumlah AS Jumlah,
      m.mspk_jumlah_kirim AS Kirim,
      DATE_FORMAT(m.mspk_dateline, "%d-%m-%Y") AS Dateline,
      s.sal_nama AS Sales
    FROM tmemospk m
    INNER JOIN tcustomer c ON m.mspk_cus_kode = c.cus_kode
    LEFT JOIN tsales s ON s.sal_kode = m.mspk_sal_kode
    LEFT JOIN tdivisi d ON d.kode = m.mspk_divisi
    WHERE m.mspk_tanggal >= ? AND m.mspk_tanggal <= ?
      ${filterDivisi}
    ORDER BY m.mspk_tanggal ASC, m.mspk_nomor ASC
  `;

  const [rows] = await db.query(sql, params);
  return rows;
};

/**
 * 2. MENGAMBIL DETAIL SURAT JALAN (DETAIL)
 */
const getDetailSj = async (mapNomor) => {
  const sql = `
    SELECT 
      d.sjd_mspk_nomor AS Nomor,
      h.sj_nomor AS NomorSj,
      DATE_FORMAT(h.sj_tanggal, "%d-%m-%Y") AS TanggalSj,
      h.sj_keterangan AS Keterangan,
      h.sj_alamat_customer AS Alamat,
      h.sj_kota_customer AS Kota,
      d.sjd_jumlah AS Jumlah
    FROM tsj_hdr_memo h
    LEFT JOIN tsj_dtl_memo d ON h.sj_nomor = d.sjd_sj_nomor
    WHERE d.sjd_mspk_nomor = ?
    ORDER BY h.sj_tanggal ASC, h.sj_nomor ASC
  `;

  const [rows] = await db.query(sql, [mapNomor]);
  return rows;
};

/**
 * 3. MENGAMBIL SELURUH DETAIL UNTUK EXPORT KE EXCEL
 */
const getAllDetailSj = async (query, canLihatCus = false) => {
  const { startDate, endDate, divisi } = query;

  const toLocalDateStr = (date) => {
    // Asumsi server perlu dipaksa ke WIB (UTC+7) karena proses Node
    // bisa berjalan di timezone server (sering UTC), beda dari
    // timezone browser user.
    const wibOffsetMs = 7 * 60 * 60 * 1000;
    const wibDate = new Date(date.getTime() + wibOffsetMs);
    const year = wibDate.getUTCFullYear();
    const month = String(wibDate.getUTCMonth() + 1).padStart(2, "0");
    const day = String(wibDate.getUTCDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  const now = new Date();
  const dStart =
    startDate || toLocalDateStr(new Date(now.getFullYear(), now.getMonth(), 1));
  const dEnd = endDate || toLocalDateStr(now);

  let filterDivisi = "";
  const params = [dStart, dEnd];

  if (divisi && divisi !== "0") {
    filterDivisi = " AND m.mspk_divisi = ? ";
    params.push(divisi);
  }

  const custCol = canLihatCus
    ? "c.cus_nama AS NamaCustomer,"
    : `"" AS NamaCustomer,`;

  const sql = `
    SELECT 
      m.mspk_nomor AS NomorMAP,
      m.mspk_tanggal AS TglMAP,
      v.Divisi AS Divisi,
      ${custCol}
      m.mspk_nama AS NamaMAP,
      h.sj_nomor AS NomorSJ,
      h.sj_tanggal AS TglSJ,
      h.sj_keterangan AS KeteranganSJ,
      d.sjd_jumlah AS JumlahKirim
    FROM tmemospk m
    INNER JOIN tcustomer c ON m.mspk_cus_kode = c.cus_kode
    LEFT JOIN tdivisi v ON v.kode = m.mspk_divisi
    LEFT JOIN tsj_dtl_memo d ON m.mspk_nomor = d.sjd_mspk_nomor
    LEFT JOIN tsj_hdr_memo h ON d.sjd_sj_nomor = h.sj_nomor
    WHERE m.mspk_tanggal >= ? AND m.mspk_tanggal <= ?
      ${filterDivisi}
    ORDER BY m.mspk_tanggal ASC, m.mspk_nomor ASC, h.sj_tanggal ASC
  `;

  const [rows] = await db.query(sql, params);
  return rows;
};

module.exports = {
  getMasterMap,
  getDetailSj,
  getAllDetailSj,
};
