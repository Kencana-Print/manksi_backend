const pool = require("../../config/database");

/**
 * Mendapatkan daftar MPPB untuk modal lookup
 * Query mereplikasi logika Delphi btnRefreshClick pada modul MMT
 */
const getMPPBLookup = async (startDate, endDate) => {
  try {
    const sql = `
      SELECT 
        h.mpb_nomor AS nomor,
        DATE_FORMAT(h.mpb_tanggal, '%Y-%m-%d') AS tanggal, 
        h.mpb_nama AS nama_produk,
        h.mpb_ukuran AS ukuran, 
        h.mpb_bahan AS bahan,
        h.mpb_gramasi AS gramasi,
        h.mpb_jmlorder AS qty_order,
        h.mpb_dokumen AS no_dokumen,
        h.mpb_approve AS approve,
        IFNULL(s.spk_nomor, '') AS spk,
        h.mpb_ket AS keterangan,
        h.user_create AS created,
        IFNULL((
          SELECT po_nomor 
          FROM tpo_hdr p 
          WHERE p.po_mppb_nomor = h.mpb_nomor 
          ORDER BY p.po_tanggal DESC LIMIT 1
        ), '') AS no_po,
        IFNULL((
          SELECT
            IF(pin_acc = '' AND pin_dipakai = '', 'WAIT',
            IF(pin_acc = 'Y' AND pin_dipakai = '', 'ACC',
            IF(pin_acc = 'Y' AND pin_dipakai = 'Y', '',
            IF(pin_acc = 'N', 'TOLAK', ''))))
          FROM tspk_pin5 
          WHERE pin_trs = 'MPPB' AND pin_nomor = h.mpb_nomor 
          ORDER BY pin_urut DESC LIMIT 1
        ), '') AS ngedit
      FROM tmpb h
      LEFT JOIN tspk s ON s.spk_mppb = h.mpb_nomor
      WHERE h.mpb_tanggal >= ? AND h.mpb_tanggal <= ?
      ORDER BY h.date_create DESC
    `;

    const [rows] = await pool.query(sql, [startDate, endDate]);
    return rows;
  } catch (error) {
    throw error;
  }
};

/**
 * Mendapatkan detail header dan item MPPB berdasarkan nomor
 */
const getMPPBByNomor = async (nomor) => {
  try {
    const headerSql = `
      SELECT 
        h.mpb_nomor AS Nomor,
        DATE_FORMAT(h.mpb_tanggal, '%Y-%m-%d') AS Tanggal,
        h.mpb_nama AS mpb_nama,
        h.mpb_ukuran AS mpb_ukuran,
        h.mpb_bahan AS mpb_bahan,
        h.mpb_gramasi AS mpb_gramasi,
        h.mpb_jmlorder AS mpb_jmlorder,
        h.mpb_ket AS Keterangan,
        h.mpb_approve AS Approve,
        h.user_create AS User_Create,
        IFNULL(s.spk_nomor, '') AS spk
      FROM tmpb h
      LEFT JOIN tspk s ON s.spk_mppb = h.mpb_nomor
      WHERE h.mpb_nomor = ?
    `;

    const [headerRows] = await pool.query(headerSql, [nomor]);

    if (headerRows.length === 0) {
      return null;
    }

    const mppbData = headerRows[0];

    // Detail dibentuk dari item MPPB master untuk kompatibilitas form Purchase Request
    mppbData.Detail = [
      {
        Kode: mppbData.mpb_bahan,
        Nama_Bahan: mppbData.mpb_nama,
        Jumlah: mppbData.mpb_jmlorder,
        Satuan: "MTR",
        Panjang: mppbData.mpb_gramasi,
        Lebar: mppbData.mpb_ukuran,
        Keterangan: mppbData.Keterangan,
        Nomor_SPK: mppbData.spk,
      },
    ];

    return mppbData;
  } catch (error) {
    throw error;
  }
};

module.exports = {
  getMPPBLookup,
  getMPPBByNomor,
};

