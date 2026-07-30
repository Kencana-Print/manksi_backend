const db = require("../../config/database");

/**
 * Mendapatkan daftar Penawaran (Browse Master)
 */
const getPenawaranList = async (startDate, endDate, status, user) => {
  const canLihatCus = Number(user.flags?.lihatCus) === 1;
  const isCusRestricted = !canLihatCus;

  const custCols = canLihatCus
    ? `p.perush_nama AS Perusahaan,
       IF(h.pen_cetaktotal = 1,
         (SELECT SUM(d.pend_qty * d.pend_harga) FROM tpenawaran_dtl d WHERE d.pend_pen_nomor = h.pen_nomor),
         (SELECT MIN(d.pend_qty * d.pend_harga) FROM tpenawaran_dtl d WHERE d.pend_pen_nomor = h.pen_nomor)
       ) AS Nominal,
       c.cus_nama AS NamaCustomer,`
    : `"" AS Perusahaan, NULL AS Nominal, "" AS NamaCustomer,`;

  let query = `
    SELECT 
      h.pen_nomor AS Nomor,
      h.pen_tanggal AS Tanggal,
      v.divisi AS Divisi,
      h.pen_tipe AS Tipe,
      ${custCols}
      h.pen_keterangan AS Keterangan,
      s.sal_nama AS Sales,
      h.pen_fu1 AS Fu1, 
      h.pen_fu2 AS Fu2, 
      h.pen_fu3 AS Fu3,
      h.pen_proyeksi AS Proyeksi,
      IFNULL((
        SELECT 
          IFNULL(
            IF(pin_acc="" AND pin_dipakai="", "WAIT",
              IF(pin_acc="Y" AND pin_dipakai="", "ACC",
                IF(pin_acc="Y" AND pin_dipakai="Y", "",
                  IF(pin_acc="N", "TOLAK", "")
                )
              )
            ), 
          "")
        FROM tspk_pin5 
        WHERE pin_trs = "PENAWARAN" AND pin_nomor = h.pen_nomor 
        ORDER BY pin_urut DESC LIMIT 1
      ), "") AS StatusApproval,
      (SELECT COUNT(*) FROM tpenawaran_dtl WHERE pend_pen_nomor = h.pen_nomor 
        ${status && status !== "ALL" ? (status === "OPEN" ? `AND pend_status = ''` : `AND pend_status = '${status}'`) : ""}
      ) AS jumlahDetail
      
    FROM tpenawaran_hdr h
    INNER JOIN tcustomer c ON h.pen_cus_kode = c.cus_kode
    INNER JOIN tperusahaan p ON p.perush_kode = h.pen_perush_kode
    LEFT JOIN tsales s ON s.sal_kode = h.pen_sal_kode
    LEFT JOIN tdivisi v ON v.kode = h.pen_divisi
    WHERE h.pen_tanggal >= ? AND h.pen_tanggal <= ?
  `;

  if (isCusRestricted) {
    query += ` AND h.pen_proyeksi <> '' `;
  }

  query += ` HAVING jumlahDetail > 0 `;
  query += ` ORDER BY h.pen_tanggal DESC, h.pen_nomor DESC`;

  const [rows] = await db.query(query, [startDate, endDate]);
  return rows;
};

/**
 * Mendapatkan detail dari Penawaran tertentu (Browse Detail)
 */

const getPenawaranDetail = async (nomor, canLihatCus = false) => {
  const hargaCols = canLihatCus
    ? `pend_harga AS Harga, (pend_qty * pend_harga) AS Nominal,`
    : `NULL AS Harga, NULL AS Nominal,`;

  const query = `
    SELECT 
      pend_id AS ID,
      pend_minta AS NoPermintaan,
      pend_gambar AS Gambar,
      pend_nama_barang AS NamaBarang,
      pend_bahan AS Bahan,
      pend_ukuran AS Ukuran,
      pend_panjang AS Panjang,
      pend_lebar AS Lebar,
      IF(pen_divisi = 1, (pend_qty * pend_panjang), 
         IF(pen_divisi = 5, (pend_qty * pend_lebar * pend_panjang), 0)
      ) AS QtyMeter,
      pend_satuan AS Satuan,
      pend_qty AS Qty,
      ${hargaCols}
      pend_status AS Status,
      pend_batal AS KetBatal,
      pend_confirm AS KetConfirm
    FROM tpenawaran_dtl d
    INNER JOIN tpenawaran_hdr h ON h.pen_nomor = d.pend_pen_nomor
    WHERE pend_pen_nomor = ?
    ORDER BY pend_id ASC
  `;

  const [rows] = await db.query(query, [nomor]);
  return rows;
};

/**
 * Menghapus Penawaran (dan detailnya)
 */
const deletePenawaran = async (nomor) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // Hapus detail terlebih dahulu
    await conn.query("DELETE FROM tpenawaran_dtl WHERE pend_pen_nomor = ?", [
      nomor,
    ]);

    // Hapus header
    const [result] = await conn.query(
      "DELETE FROM tpenawaran_hdr WHERE pen_nomor = ?",
      [nomor],
    );

    await conn.commit();
    return result.affectedRows > 0;
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
};

const updateStatusDetail = async (nomor, detailItems) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    // detailItems adalah array dari { ID, Status, KetBatal, KetConfirm }
    for (const item of detailItems) {
      await conn.query(
        `UPDATE tpenawaran_dtl SET pend_status=?, pend_batal=?, pend_confirm=? WHERE pend_pen_nomor=? AND pend_id=?`,
        [
          item.Status || "",
          item.KetBatal || "",
          item.KetConfirm || "",
          nomor,
          item.ID,
        ],
      );
    }
    await conn.commit();
    return true;
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
};

module.exports = {
  getPenawaranList,
  getPenawaranDetail,
  deletePenawaran,
  updateStatusDetail,
};
