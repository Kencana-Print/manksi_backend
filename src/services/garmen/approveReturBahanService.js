const db = require("../../config/database");
const tutupBukuService = require("../../services/tutupBukuService");

/**
 * Mengambil Data Browse Approve Retur (Master & Detail)
 * Mereplikasi query dari ufrmBrowseProdukReturApprove.pas
 */
const getBrowseData = async (startDate, endDate) => {
  // Query Master
  const qMaster = `
    SELECT 
      h.proret_nomor AS Nomor, 
      h.proret_tanggal AS Tanggal, 
      g.gdg_nama AS Tujuan, 
      SUBSTRING(p.gdgp_nama, 4) AS Dari, 
      h.proret_keterangan AS Keterangan, 
      h.user_create AS Created, 
      IFNULL(r.proret_nomor, "") AS NoApprov, 
      r.proret_tanggal AS TglApprov, 
      IFNULL(r.user_create, "") AS Approved
    FROM tproduksireturlog_hdr h
    LEFT JOIN tgudang g ON g.gdg_kode = h.proret_gdg_tujuan
    LEFT JOIN tgudangproduksi p ON p.gdgp_kode = h.proret_gdg_produksi
    LEFT JOIN tproduksiretur_hdr r ON r.proret_log = h.proret_nomor
    WHERE h.proret_tanggal >= ? AND h.proret_tanggal <= ?
    ORDER BY h.proret_nomor DESC
  `;

  // Query Detail dengan UNION ALL
  const qDetail = `
    SELECT * FROM (
      -- Detail dari log (Belum Approve)
      SELECT 
        d.proretd_proret_Nomor AS Nomor, d.proretd_nourut AS NoUrut, d.proretd_bhn_kode AS Kode, 
        b.Bhn_Name AS Nama, b.Bhn_satuan AS Satuan, d.proretd_Jumlah AS Jumlah, 
        d.proretd_roll AS Roll, d.proretd_keterangan AS Keterangan, d.proretd_nominta AS NoMinta, 
        IFNULL(m.promin_spk_nomor, "") AS SPK, u.Sup_nama AS Supplier
      FROM tproduksireturlog_hdr h
      INNER JOIN tproduksireturlog_dtl d ON d.proretd_proret_Nomor = h.proret_nomor
      LEFT JOIN tbahan b ON b.Bhn_kode = d.proretd_bhn_kode
      LEFT JOIN tsupplier u ON u.Sup_kode = d.proretd_sup_kode
      LEFT JOIN tproduksiminta_hdr m ON m.promin_nomor = d.proretd_nominta
      WHERE h.proret_tanggal >= ? AND h.proret_tanggal <= ?
      AND h.proret_nomor NOT IN (SELECT proret_log FROM tproduksiretur_hdr WHERE proret_log <> "")
      
      UNION ALL
      
      -- Detail dari retur final (Sudah Approve)
      -- Nomor diisi dengan proret_log (RETL) agar mapping ke header master berhasil
      SELECT 
        h.proret_log AS Nomor, d.proretd_nourut AS NoUrut, d.proretd_bhn_kode AS Kode, 
        b.Bhn_Name AS Nama, b.Bhn_satuan AS Satuan, d.proretd_Jumlah AS Jumlah, 
        d.proretd_roll AS Roll, d.proretd_keterangan AS Keterangan, d.proretd_nominta AS NoMinta, 
        IFNULL(m.promin_spk_nomor, "") AS SPK, u.Sup_nama AS Supplier
      FROM tproduksiretur_hdr h
      INNER JOIN tproduksiretur_dtl d ON d.proretd_proret_Nomor = h.proret_nomor
      LEFT JOIN tbahan b ON b.Bhn_kode = d.proretd_bhn_kode
      LEFT JOIN tsupplier u ON u.Sup_kode = d.proretd_sup_kode
      LEFT JOIN tproduksiminta_hdr m ON m.promin_nomor = d.proretd_nominta
      WHERE h.proret_log IN (
        SELECT l.proret_nomor FROM tproduksireturlog_hdr l 
        WHERE l.proret_tanggal >= ? AND l.proret_tanggal <= ?
      )
    ) x ORDER BY Nomor, NoUrut
  `;

  const params = [startDate, endDate];
  const detailParams = [startDate, endDate, startDate, endDate]; // 4 parameter untuk UNION

  const [masterRows] = await db.query(qMaster, params);
  const [detailRows] = await db.query(qDetail, detailParams);

  // Map details ke master array
  const result = masterRows.map((master) => ({
    ...master,
    details: detailRows.filter((d) => d.Nomor === master.Nomor),
  }));

  return result;
};

/**
 * Batal Approve (Hapus data RETP)
 */
const batalApprove = async (noApprov) => {
  if (!noApprov)
    throw new Error("No. Retur belum di-approve, tidak bisa dibatalkan.");

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // 1. Ambil data tanggal approve untuk validasi tutup buku
    const [rows] = await conn.query(
      `SELECT proret_tanggal FROM tproduksiretur_hdr WHERE proret_nomor = ?`,
      [noApprov],
    );
    if (rows.length === 0) throw new Error("Data Approve tidak ditemukan.");

    // 2. Validasi Tutup Buku
    const tglTrs = new Date(rows[0].proret_tanggal);
    const zdtClose = await tutupBukuService.getTanggalTutupBuku();
    if (tglTrs <= zdtClose) {
      throw new Error(
        "Transaksi sudah Close (Tutup Buku). Batal Approve tidak diizinkan.",
      );
    }

    // 3. Eksekusi Hapus Header dan Detail RETP
    await conn.query(
      `DELETE FROM tproduksiretur_dtl WHERE proretd_proret_nomor = ?`,
      [noApprov],
    );
    await conn.query(`DELETE FROM tproduksiretur_hdr WHERE proret_nomor = ?`, [
      noApprov,
    ]);

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
  getBrowseData,
  batalApprove,
};
