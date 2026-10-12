const db = require("../../config/database");

const PREFIX_QC = "RQC";
const isQcRetur = (nomor) => String(nomor || "").startsWith(PREFIX_QC);

// ─────────────────────────────────────────────────────────
// BROWSE — list header retur pembelian
// ─────────────────────────────────────────────────────────
const getBrowseList = async (query) => {
  const today = new Date();
  const defaultStart = new Date(today.getFullYear(), today.getMonth(), 1)
    .toISOString()
    .substring(0, 10);
  const defaultEnd = today.toISOString().substring(0, 10);

  const startDate = query.startDate || defaultStart;
  const endDate = query.endDate || defaultEnd;

  const [bpbRows] = await db.query(
    `
    SELECT
      h.ret_nomor AS nomor,
      h.ret_tanggal AS tanggal,
      h.ret_bpb_nomor AS noBpb,
      '' AS noQc,
      h.ret_sup_kode AS kdSup,
      s.sup_nama AS supplier,
      h.ret_keterangan AS keterangan,
      'BPB' AS jenis
    FROM tret_hdr h
    INNER JOIN tsupplier s ON s.sup_kode = h.ret_sup_kode
    INNER JOIN tgudang g ON h.ret_gdg_kode = g.gdg_kode
    WHERE h.ret_tanggal >= ? AND h.ret_tanggal <= ?
    `,
    [startDate, endDate],
  );

  const [qcRows] = await db.query(
    `
    SELECT
      h.qr_nomor AS nomor,
      h.qr_tanggal AS tanggal,
      '' AS noBpb,
      h.qr_qc_nomor AS noQc,
      h.qr_sup_kode AS kdSup,
      IFNULL(s.sup_nama, '') AS supplier,
      h.qr_keterangan AS keterangan,
      'QC' AS jenis
    FROM tqc_retur_hdr h
    LEFT JOIN tsupplier s ON s.sup_kode = h.qr_sup_kode
    WHERE h.qr_tanggal >= ? AND h.qr_tanggal <= ?
    `,
    [startDate, endDate],
  );

  return [...bpbRows, ...qcRows].sort((a, b) => {
    const t = new Date(a.tanggal).getTime() - new Date(b.tanggal).getTime();
    return t !== 0 ? t : String(a.nomor).localeCompare(String(b.nomor));
  });
};

// ─────────────────────────────────────────────────────────
// DETAIL — dipanggil on-demand saat row di-expand
// ✅ FIX dibanding Delphi: fetch langsung by nomor (bukan preload
//    lintas-tanggal via master-detail grid) — sidestep bug lama
//    "detail gak muncul" di Delphi yang gak bisa didiagnosis pasti
//    dari source ini (kemungkinan besar di binding TfrmCxBrowse
//    ancestor yang gak ikut dikirim).
// ⚠️ Kolom Harga/Total cuma ikut kalau canLihatBeli true — replikasi
//    persis kondisi `zLihatBeli<>0` di Delphi.
// ─────────────────────────────────────────────────────────
const getDetailByNomor = async (nomor, canLihatBeli) => {
  if (isQcRetur(nomor)) {
    const [rows] = await db.query(
      `
      SELECT
        d.qrd_lot AS lot,
        d.qrd_bhn_kode AS kode,
        b.bhn_name AS nama,
        IFNULL(NULLIF(pd.pod_bhn_satuan, ''), b.bhn_satuan) AS satuan,
        d.qrd_qty AS jumlah,
        d.qrd_roll AS roll
      FROM tqc_retur_dtl d
      INNER JOIN tqc_retur_hdr h ON h.qr_nomor = d.qrd_nomor
      INNER JOIN tqc_bahan_hdr q ON q.qc_nomor = h.qr_qc_nomor
      LEFT JOIN tbahan b ON b.bhn_kode = d.qrd_bhn_kode
      LEFT JOIN tpo_dtl pd
        ON pd.pod_po_nomor = q.qc_po_nomor AND pd.pod_nourut = q.qc_pod_nourut
      WHERE d.qrd_nomor = ?
      ORDER BY d.qrd_nourut
      `,
      [nomor],
    );
    return rows;
  }

  const hargaSubquery = canLihatBeli
    ? `, IFNULL((
         SELECT bpbd_harga FROM tbpb_dtl
         WHERE bpbd_bpb_nomor = h.ret_bpb_nomor AND bpbd_bhn_kode = d.retd2_bhn_kode
         LIMIT 1
       ), 0) AS harga`
    : "";

  const sql = `
    SELECT
      d.retd2_bhn_kode AS kode,
      b.bhn_name AS nama,
      b.bhn_satuan AS satuan,
      SUM(d.retd2_jumlah) AS jumlah
      ${hargaSubquery}
    FROM tret_dtl2 d
    INNER JOIN tret_hdr h ON h.ret_nomor = d.retd2_ret_nomor
    LEFT JOIN tbahan b ON b.bhn_kode = d.retd2_bhn_kode
    WHERE d.retd2_ret_nomor = ?
    GROUP BY d.retd2_bhn_kode
    ORDER BY d.retd2_bhn_kode
  `;
  const [rows] = await db.query(sql, [nomor]);

  if (canLihatBeli) {
    return rows.map((r) => ({
      ...r,
      total: (Number(r.jumlah) || 0) * (Number(r.harga) || 0),
    }));
  }
  return rows;
};

// ─────────────────────────────────────────────────────────
// DELETE — replikasi cxButton4Click PERSIS (cuma hapus header,
// tret_dtl dibiarkan — konfirmasi dari user, TIDAK ada penyesuaian).
// ⚠️ Modul ini juga TIDAK punya pengecekan tutup buku/closing period
// sama sekali di source Delphi — jadi delete di sini murni permission
// check doang (di-handle checkPermission di routes), tanpa syarat
// periode.
// ─────────────────────────────────────────────────────────
const deleteRetur = async (nomor) => {
  if (isQcRetur(nomor)) {
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query(`DELETE FROM tqc_retur_dtl WHERE qrd_nomor = ?`, [
        nomor,
      ]);
      const [result] = await conn.query(
        `DELETE FROM tqc_retur_hdr WHERE qr_nomor = ?`,
        [nomor],
      );
      if (result.affectedRows === 0) throw new Error("Data tidak ditemukan.");
      await conn.commit();
      return { nomor };
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }
  }

  const [result] = await db.query(`DELETE FROM tret_hdr WHERE ret_nomor = ?`, [
    nomor,
  ]);
  if (result.affectedRows === 0) {
    throw new Error("Data tidak ditemukan.");
  }
  return { nomor };
};

// ─────────────────────────────────────────────────────────
// CETAK — data header + detail utk print view
// ─────────────────────────────────────────────────────────
const getDataCetak = async (nomor, canLihatBeli) => {
  if (isQcRetur(nomor)) {
    const [[header]] = await db.query(
      `SELECT h.qr_nomor AS nomor, h.qr_tanggal AS tanggal,
              '' AS noBpb, h.qr_qc_nomor AS noQc, h.qr_no_sj AS noSj,
              h.qr_sup_kode AS kdSup, s.sup_nama AS supplier,
              s.sup_alamat AS supAlamat, h.qr_keterangan AS keterangan,
              h.user_create AS usr, 'QC' AS jenis
       FROM tqc_retur_hdr h
       LEFT JOIN tsupplier s ON s.sup_kode = h.qr_sup_kode
       WHERE h.qr_nomor = ?`,
      [nomor],
    );
    if (!header) throw new Error("Data tidak ditemukan.");

    const detail = await getDetailByNomor(nomor, canLihatBeli);
    return { header, detail };
  }

  const [[header]] = await db.query(
    `SELECT h.ret_nomor AS nomor, h.ret_tanggal AS tanggal,
            h.ret_bpb_nomor AS noBpb, h.ret_sup_kode AS kdSup,
            s.sup_nama AS supplier, s.sup_alamat AS supAlamat,
            h.ret_keterangan AS keterangan, h.user_create AS usr,
            'BPB' AS jenis
     FROM tret_hdr h
     INNER JOIN tsupplier s ON s.sup_kode = h.ret_sup_kode
     WHERE h.ret_nomor = ?`,
    [nomor],
  );
  if (!header) throw new Error("Data tidak ditemukan.");

  const detail = await getDetailByNomor(nomor, canLihatBeli);
  return { header, detail };
};

module.exports = {
  getBrowseList,
  getDetailByNomor,
  deleteRetur,
  getDataCetak,
};
