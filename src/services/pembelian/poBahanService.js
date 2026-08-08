const db = require("../../config/database");
const tutupBukuService = require("../tutupBukuService");

// --- 1. GET BROWSE HEADER ---
const getBrowse = async (query, canLihatSup = false) => {
  const { startDate, endDate, search } = query;

  const dStart =
    startDate ||
    new Date(new Date().getFullYear(), new Date().getMonth(), 1)
      .toISOString()
      .substring(0, 10);
  const dEnd = endDate || new Date().toISOString().substring(0, 10);

  // ⚠️ Kolom KodeSupplier/Supplier digated flag lihatSup (user_lihat_sup)
  // — replikasi `if zLihatSup<>0` di ufrmBrowsePO.btnRefreshClick.
  const supCols = canLihatSup
    ? "s.sup_kode AS KodeSupplier, s.sup_nama AS Supplier,"
    : "NULL AS KodeSupplier, NULL AS Supplier,";

  let sql = `
    SELECT DISTINCT 
      h.po_nomor AS Nomor,
      IF(h.po_jenis = 1, "GREIGE", IF(h.po_jenis = 2, "CELUP", "BAHAN")) AS JenisPO,
      h.po_greige AS PoGreige,
      IFNULL((SELECT CAST(GROUP_CONCAT(hh.po_nomor SEPARATOR ", ") AS CHAR) FROM tpo_hdr hh WHERE hh.po_greige = h.po_nomor), "") AS PoCelup,
      h.po_tanggal AS Tanggal,
      h.po_commitdate AS Comm_Delivery,
      
      (SELECT SUM(b.pod_Jumlah) FROM tpo_dtl b WHERE b.pod_po_Nomor = h.po_Nomor GROUP BY b.pod_po_Nomor) AS QtyPO,
      
      IFNULL((
        SELECT SUM(c.bpbd_Jumlah) 
        FROM tbpb_dtl c 
        INNER JOIN tbpb_hdr f ON f.bpb_Nomor = c.bpbd_bpb_Nomor 
        WHERE f.bpb_po_Nomor = h.po_Nomor 
        GROUP BY h.po_Nomor
      ), 0) AS QtyBPB,
      
      IFNULL((
        SELECT SUM(i.retd_jumlah) 
        FROM tret_dtl i
        INNER JOIN tret_hdr j ON j.ret_nomor = i.retd_ret_nomor
        INNER JOIN tbpb_hdr f ON f.bpb_Nomor = j.ret_bpb_nomor 
        WHERE f.bpb_po_Nomor = h.po_Nomor 
        GROUP BY h.po_Nomor
      ), 0) AS QtyRetur,

      h.po_keterangan AS Keterangan,
      ${supCols}
      h.po_note AS Note,
      
      IF(h.po_close = 1, "CLOSE", IF(h.po_close = 0, "OPEN", IF(h.po_close = 9, "DICLOSE", "ONPROSES"))) AS Status,
      h.po_alasanclose AS AlasanClose,
      h.po_tglclose AS TglClose,
      h.po_userclose AS DiCloseOleh,
      h.user_create AS usr,
      h.date_create AS Created,
      
      IFNULL((
        SELECT IFNULL(
          IF(pin_acc="" AND pin_dipakai="", "WAIT",
            IF(pin_acc="Y" AND pin_dipakai="", "ACC",
              IF(pin_acc="Y" AND pin_dipakai="Y", "",
                IF(pin_acc="N", "TOLAK", "")
              )
            )
          ), ""
        )
        FROM tspk_pin5 
        WHERE pin_trs="PO BAHAN" AND pin_nomor=h.po_nomor 
        ORDER BY pin_urut DESC LIMIT 1
      ), "") AS Ngedit

    FROM tpo_hdr h
    INNER JOIN tpo_dtl d ON d.pod_po_nomor = h.po_nomor
    LEFT JOIN tbahan b ON d.pod_bhn_kode = b.bhn_kode
    INNER JOIN tsupplier s ON s.sup_kode = h.po_sup_kode
    WHERE h.po_tanggal >= ? AND h.po_tanggal <= ?
  `;

  const params = [dStart, dEnd];

  if (search) {
    sql += ` AND (b.bhn_name LIKE ? OR h.po_keterangan LIKE ?)`;
    params.push(`%${search}%`, `%${search}%`);
  }

  sql += ` ORDER BY h.date_create DESC, h.po_nomor DESC`;

  const [rows] = await db.query(sql, params);
  return rows;
};

// --- 2. GET BROWSE DETAIL (Sesuai SQLDetail Delphi) ---
const getBrowseDetail = async (nomorPO, canLihatBeli = false) => {
  // ⚠️ Kolom Harga/Disc digated flag lihatBeli (user_lihat_beli) —
  // replikasi `if zLihatBeli=1` di ufrmBrowsePO.btnRefreshClick.
  const hargaCols = canLihatBeli
    ? "d.pod_hargabeli AS Harga, d.pod_disc AS Disc,"
    : "NULL AS Harga, NULL AS Disc,";

  const sql = `
    SELECT 
      d.pod_po_nomor AS Nomor,
      d.pod_bhn_kode AS Kode,
      b.bhn_name AS Nama,
      d.pod_bhn_satuan AS Satuan,
      d.pod_jumlah AS Jumlah,
      
      IFNULL((
        SELECT IFNULL(SUM(i.bpbd2_jumlah), 0)
        FROM tbpb_dtl2 i
        WHERE i.bpbd2_po_nomor = d.pod_po_nomor AND i.bpbd2_nourut = d.pod_nourut
      ), 0) AS QtyBpb,
      
      IFNULL((
        SELECT SUM(i.retd_jumlah) 
        FROM tret_dtl i
        INNER JOIN tret_hdr j ON j.ret_nomor = i.retd_ret_nomor
        INNER JOIN tbpb_hdr f ON f.bpb_Nomor = j.ret_bpb_nomor 
        WHERE f.bpb_po_Nomor = h.po_Nomor AND i.retd_bhn_kode = d.pod_bhn_kode
      ), 0) AS QtyRetur,

      ${hargaCols}
      IF(d.pod_status = 0, "Delay", IF(d.pod_status = 1, "True", "Cancel")) AS Status_barang,
      d.pod_mkb_nomor AS MKB,
      d.pod_spk_nomor AS SPK,
      IF(d.pod_spk_nomor <> "", IFNULL(s.spk_nama, m.Mspk_nama), "") AS Nama_SPK

    FROM tpo_dtl d
    LEFT JOIN tpo_hdr h ON h.po_nomor = d.pod_po_nomor
    LEFT JOIN tbahan b ON d.pod_bhn_kode = b.bhn_kode
    LEFT JOIN tspk s ON s.spk_nomor = d.pod_spk_nomor
    LEFT JOIN tmemospk m ON m.MSPK_Nomor = d.pod_spk_nomor
    WHERE d.pod_po_nomor = ?
    ORDER BY d.pod_nourut ASC
  `;

  const [rows] = await db.query(sql, [nomorPO]);
  return rows;
};

// --- 3, 4, 5: deleteData, toggleClose, requestPinEdit — tidak berubah ---
const deleteData = async (nomor) => {
  const conn = await db.getConnection();
  let deletedGreige = null;
  let deletedJenis = null;

  try {
    await conn.beginTransaction();

    const [headers] = await conn.query(
      `SELECT po_tanggal, po_close, po_jenis, po_greige FROM tpo_hdr WHERE po_nomor = ?`,
      [nomor],
    );
    if (headers.length === 0) throw new Error("Data tidak ditemukan.");
    const header = headers[0];

    const zdtClose = await tutupBukuService.getTanggalTutupBuku();
    if (zdtClose && new Date(header.po_tanggal) < zdtClose) {
      throw new Error(
        "Transaksi tersebut sudah close (Tutup Buku). Tidak bisa dihapus.",
      );
    }

    if (header.po_close === 1 || header.po_close === 9) {
      throw new Error("PO Sudah di-Close. Tidak bisa dihapus.");
    }

    if (header.po_jenis === 2 && header.po_greige) {
      deletedGreige = header.po_greige;
      deletedJenis = header.po_jenis;
    }

    await conn.query(`DELETE FROM tpo_hdr WHERE po_nomor = ?`, [nomor]);

    await conn.commit();
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }

  if (deletedGreige) {
    try {
      const [greigePo] = await db.query(
        `SELECT IFNULL(SUM(pod_Jumlah), 0) AS po FROM tpo_dtl WHERE pod_po_nomor = ?`,
        [deletedGreige],
      );
      const npo = Number(greigePo[0]?.po) || 0;

      const [greigeSj] = await db.query(
        `SELECT IFNULL(SUM(d.pod_Jumlah), 0) AS sj 
         FROM tpo_dtl d
         INNER JOIN tpo_hdr h ON h.po_nomor = d.pod_po_nomor
         WHERE h.po_greige = ?`,
        [deletedGreige],
      );
      const nsj = Number(greigeSj[0]?.sj) || 0;

      let newStatus = 2;
      if (nsj >= npo) newStatus = 1;
      else if (nsj === 0) newStatus = 0;

      await db.query(`UPDATE tpo_hdr SET po_close = ? WHERE po_nomor = ?`, [
        newStatus,
        deletedGreige,
      ]);
    } catch (syncErr) {
      console.error(
        "Gagal sinkronisasi status PO Greige setelah hapus:",
        syncErr,
      );
    }
  }

  return true;
};

const toggleClose = async (nomor, payload, userKode) => {
  const { isClose, alasan } = payload;
  const conn = await db.getConnection();

  try {
    if (isClose) {
      if (!alasan) throw new Error("Alasan close harus diisi.");
      await conn.query(
        `UPDATE tpo_hdr SET po_close=9, po_alasanclose=?, po_userclose=?, po_tglclose=NOW() WHERE po_nomor=?`,
        [alasan, userKode, nomor],
      );
    } else {
      await conn.query(
        `UPDATE tpo_hdr SET po_close=0, po_alasanclose="", po_userclose="", po_tglclose=NULL WHERE po_nomor=?`,
        [nomor],
      );
    }
    return true;
  } finally {
    conn.release();
  }
};

const requestPinEdit = async (nomor, alasan, userKode) => {
  const conn = await db.getConnection();
  try {
    const [headers] = await conn.query(
      `SELECT po_tanggal, IF(po_jenis=1,"GREIGE",IF(po_jenis=2,"CELUP","BAHAN")) AS JenisPO FROM tpo_hdr WHERE po_nomor=?`,
      [nomor],
    );
    if (headers.length === 0) throw new Error("Data PO tidak ditemukan.");
    const header = headers[0];

    const [lastPin] = await conn.query(
      `SELECT pin_urut, pin_dipakai FROM tspk_pin5 WHERE pin_trs="PO BAHAN" AND pin_nomor=? ORDER BY pin_urut DESC LIMIT 1`,
      [nomor],
    );

    let urut = 1;
    if (lastPin.length > 0) {
      if (lastPin[0].pin_dipakai === "") {
        throw new Error(
          "Pengajuan sebelumnya masih pending (Belum digunakan/Di-ACC).",
        );
      } else {
        urut = lastPin[0].pin_urut + 1;
      }
    }

    await conn.query(
      `
      INSERT INTO tspk_pin5 (pin_trs, pin_nomor, pin_urut, pin_tgl_trs, pin_ket, pin_tgl_minta, pin_user_minta, pin_alasan) 
      VALUES ("PO BAHAN", ?, ?, ?, ?, NOW(), ?, ?)
      ON DUPLICATE KEY UPDATE 
        pin_tgl_trs=VALUES(pin_tgl_trs), 
        pin_ket=VALUES(pin_ket), 
        pin_acc="", 
        pin_tgl_minta=NOW(), 
        pin_user_minta=VALUES(pin_user_minta), 
        pin_alasan=VALUES(pin_alasan)
    `,
      [nomor, urut, header.po_tanggal, header.JenisPO, userKode, alasan],
    );

    return true;
  } finally {
    conn.release();
  }
};

// --- ALL DETAIL PO BAHAN (Untuk Export) ---
const getAllDetail = async (
  query,
  canLihatSup = false,
  canLihatBeli = false,
) => {
  const { startDate, endDate, search } = query;

  const dStart = startDate || new Date().toISOString().substring(0, 10);
  const dEnd = endDate || new Date().toISOString().substring(0, 10);

  const supCols = canLihatSup
    ? "s.sup_kode AS KodeSupplier, s.sup_nama AS Supplier,"
    : "NULL AS KodeSupplier, NULL AS Supplier,";

  const hargaCols = canLihatBeli
    ? "d.pod_hargabeli AS Harga, d.pod_disc AS Disc,"
    : "NULL AS Harga, NULL AS Disc,";

  let sql = `
    SELECT 
      h.po_nomor AS Nomor,
      h.po_tanggal AS Tanggal,
      h.po_commitdate AS Comm_Delivery,
      IF(h.po_jenis = 1, "GREIGE", IF(h.po_jenis = 2, "CELUP", "BAHAN")) AS JenisPO,
      ${supCols}
      d.pod_bhn_kode AS Kode,
      b.bhn_name AS Nama,
      d.pod_bhn_satuan AS Satuan,
      d.pod_jumlah AS Jumlah,
      
      IFNULL((SELECT IFNULL(SUM(i.bpbd2_jumlah), 0) FROM tbpb_dtl2 i WHERE i.bpbd2_po_nomor = d.pod_po_nomor AND i.bpbd2_nourut = d.pod_nourut), 0) AS QtyBpb,
      IFNULL((SELECT SUM(i.retd_jumlah) FROM tret_dtl i INNER JOIN tret_hdr j ON j.ret_nomor = i.retd_ret_nomor INNER JOIN tbpb_hdr f ON f.bpb_Nomor = j.ret_bpb_nomor WHERE f.bpb_po_Nomor = h.po_Nomor AND i.retd_bhn_kode = d.pod_bhn_kode), 0) AS QtyRetur,
      
      ${hargaCols}
      IF(d.pod_status = 0, "Delay", IF(d.pod_status = 1, "True", "Cancel")) AS Status_barang,
      d.pod_mkb_nomor AS MKB,
      d.pod_spk_nomor AS SPK,
      IF(d.pod_spk_nomor <> "", IFNULL(spk.spk_nama, m.Mspk_nama), "") AS Nama_SPK
    FROM tpo_hdr h
    INNER JOIN tpo_dtl d ON d.pod_po_nomor = h.po_nomor
    LEFT JOIN tbahan b ON d.pod_bhn_kode = b.bhn_kode
    INNER JOIN tsupplier s ON s.sup_kode = h.po_sup_kode
    LEFT JOIN tspk spk ON spk.spk_nomor = d.pod_spk_nomor
    LEFT JOIN tmemospk m ON m.MSPK_Nomor = d.pod_spk_nomor
    WHERE h.po_tanggal >= ? AND h.po_tanggal <= ?
  `;

  const params = [dStart, dEnd];

  if (search) {
    sql += ` AND (b.bhn_name LIKE ? OR h.po_keterangan LIKE ?)`;
    params.push(`%${search}%`, `%${search}%`);
  }

  sql += ` ORDER BY h.date_create DESC, h.po_nomor DESC, d.pod_nourut ASC`;

  const [rows] = await db.query(sql, params);
  return rows;
};

module.exports = {
  getBrowse,
  getBrowseDetail,
  deleteData,
  toggleClose,
  requestPinEdit,
  getAllDetail,
};
