const db = require("../../config/database");

/**
 * Mendapatkan data utama Browse Realisasi Minta Bahan
 */
const getBrowse = async (startDate, endDate) => {
  const query = `
    SELECT 
      h.promin_nomor AS Nomor, 
      DATE_FORMAT(h.promin_tanggal, '%Y-%m-%d') AS Tanggal, 
      h.promin_minta AS NoMinta,
      g.gdg_nama AS Gudang, 
      gp.gdgp_cab AS GdgProduksi, 
      h.promin_keterangan AS Keterangan, 
      h.promin_spk_nomor AS SPK, 
      IFNULL(s.spk_nama, m.mspk_nama) AS NamaSPK, 
      h.promin_jumlah AS Jumlah, 
      IFNULL(s.spk_jumlah, m.mspk_jumlah) AS JmlOrder,
      -- ⚠️ TAMBAHAN: status aktif fisik — 'N' berarti stok BELUM
      -- terpotong (biasanya karena ada beda bahan yang belum di-ACC,
      -- lihat kolom StatusBeda di bawah untuk detail alasannya)
      h.promin_aktif AS Aktif,
      IFNULL((
        SELECT IFNULL(
          IF(pin_acc="" AND pin_dipakai="", "WAIT",
          IF(pin_acc="Y" AND pin_dipakai="", "ACC",
          IF(pin_acc="Y" AND pin_dipakai="Y", "",
          IF(pin_acc="N", "TOLAK", "")))), "")
        FROM tspk_pin5 
        WHERE pin_trs="REALISASI MINTA BAHAN" AND pin_nomor=h.promin_nomor 
        ORDER BY pin_urut DESC LIMIT 1
      ), "") AS Ngedit,
      -- ⚠️ TAMBAHAN: status approval BEDA BAHAN — pin_trs berbeda dari
      -- Ngedit di atas (yang untuk approval edit-setelah-tutup-buku).
      -- Dua alur approval ini terpisah, jangan digabung jadi 1 kolom.
      IFNULL((
        SELECT IFNULL(
          IF(pin_acc="" AND pin_dipakai="", "WAIT",
          IF(pin_acc="Y", "ACC",
          IF(pin_acc="N", "TOLAK", ""))), "")
        FROM tspk_pin5 
        WHERE pin_trs="REALISASI BEDA BAHAN" AND pin_nomor=h.promin_nomor AND pin_urut=1
      ), "") AS StatusBeda,
      h.user_create AS Usr
    FROM tproduksiminta_hdr h
    LEFT JOIN tgudang g ON g.gdg_kode = h.promin_gdg_asal 
    LEFT JOIN tgudangproduksi gp ON gp.gdgp_kode = h.promin_gdgp_kode
    LEFT JOIN tspk s ON s.spk_nomor = h.promin_spk_nomor
    LEFT JOIN tmemospk m ON m.mspk_nomor = h.promin_spk_nomor 
    WHERE h.promin_tanggal >= ? AND h.promin_tanggal <= ?
    ORDER BY h.promin_nomor
  `;
  const [rows] = await db.query(query, [startDate, endDate]);
  return rows;
};

/**
 * Mendapatkan detail untuk satu nomor realisasi (Untuk Expand/View)
 */
const getDetail = async (nomor) => {
  const query = `
    SELECT 
      d.promind_promin_nomor AS Nomor, 
      d.promind_bhn_kode AS Kode, 
      b.bhn_name AS Nama,
      b.bhn_satuan AS Satuan, 
      d.promind_jumlah AS Net, 
      d.promind_gross AS Gross, 
      d.promind_keterangan AS Keterangan
    FROM tproduksiminta_dtl d
    INNER JOIN tproduksiminta_hdr h ON h.promin_nomor = d.promind_promin_nomor 
    LEFT JOIN tbahan b ON b.bhn_kode = d.promind_bhn_kode 
    WHERE h.promin_nomor = ?
    ORDER BY d.promind_bhn_kode
  `;
  const [rows] = await db.query(query, [nomor]);
  return rows;
};

/**
 * Mendapatkan SEMUA detail dalam range tanggal (Untuk Export Detail Excel)
 */
const getBrowseDetail = async (startDate, endDate) => {
  const query = `
    SELECT 
      d.promind_promin_nomor AS Nomor, 
      d.promind_bhn_kode AS Kode, 
      b.bhn_name AS Nama,
      b.bhn_satuan AS Satuan, 
      d.promind_jumlah AS Net, 
      d.promind_gross AS Gross, 
      d.promind_keterangan AS Keterangan
    FROM tproduksiminta_dtl d
    INNER JOIN tproduksiminta_hdr h ON h.promin_nomor = d.promind_promin_nomor 
    LEFT JOIN tbahan b ON b.bhn_kode = d.promind_bhn_kode 
    WHERE h.promin_tanggal >= ? AND h.promin_tanggal <= ?
    ORDER BY d.promind_promin_nomor, h.promin_tanggal, d.promind_bhn_kode
  `;
  const [rows] = await db.query(query, [startDate, endDate]);
  return rows;
};

/**
 * Hapus Data & Kalkulasi Ulang Status Close Minta Bahan
 */
const deleteData = async (nomor) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // 1. Cari Nomor Minta Bahan referensinya
    const [hdrRows] = await conn.query(
      `SELECT promin_minta FROM tproduksiminta_hdr WHERE promin_nomor = ?`,
      [nomor],
    );
    if (hdrRows.length === 0)
      throw new Error("Data Realisasi tidak ditemukan.");
    const noMinta = hdrRows[0].promin_minta;

    // 2. Query kalkulasi sisa (Replikasi logika Delphi: tpo vs tbpb)
    const queryKalkulasi = `
      SELECT 
        b.mind_bhn_kode, 
        b.mind_jumlah,
        IFNULL((
          SELECT SUM(d.promind_Jumlah) 
          FROM tproduksiminta_hdr h 
          INNER JOIN tproduksiminta_dtl d ON d.promind_promin_Nomor = h.promin_nomor
          WHERE h.promin_minta = b.mind_nomor 
            AND d.promind_bhn_kode = b.mind_bhn_kode 
            AND d.promind_promin_Nomor <> ?
        ), 0) AS bpb
      FROM tmintabahan_dtl b
      WHERE b.mind_nomor = ?
    `;
    const [calcRows] = await conn.query(queryKalkulasi, [nomor, noMinta]);

    let tpo = 0;
    let tbpb = 0;

    calcRows.forEach((r) => {
      const mindJumlah = parseFloat(r.mind_jumlah) || 0;
      const bpb = parseFloat(r.bpb) || 0;

      tpo += mindJumlah;
      if (bpb <= mindJumlah) {
        tbpb += bpb;
      } else {
        tbpb += mindJumlah;
      }
    });

    // 3. Tentukan status min_close
    let minCloseStatus = 0;
    if (tbpb >= tpo) {
      minCloseStatus = 1; // Full terpenuhi
    } else if (tbpb !== 0 && tbpb < tpo) {
      minCloseStatus = 2; // Parsial
    } else {
      minCloseStatus = 0; // Belum terpenuhi sama sekali
    }

    // 4. Eksekusi Update & Delete
    await conn.query(
      `UPDATE tmintabahan_hdr SET min_close = ? WHERE min_nomor = ?`,
      [minCloseStatus, noMinta],
    );
    await conn.query(`DELETE FROM tproduksiminta_hdr WHERE promin_nomor = ?`, [
      nomor,
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

/**
 * Pengajuan Perubahan Data (PIN 5)
 */
const ajukanPerubahan = async (payload, userKode) => {
  const query = `
    INSERT INTO tspk_pin5 
    (pin_trs, pin_nomor, pin_urut, pin_tgl_trs, pin_ket, pin_tgl_minta, pin_user_minta, pin_alasan) 
    VALUES ("REALISASI MINTA BAHAN", ?, ?, ?, ?, NOW(), ?, ?)
    ON DUPLICATE KEY UPDATE 
      pin_tgl_trs = ?, 
      pin_ket = ?, 
      pin_acc = "", 
      pin_tgl_minta = NOW(), 
      pin_user_minta = ?, 
      pin_alasan = ?
  `;
  const params = [
    payload.nomor,
    payload.urut,
    payload.tanggal,
    payload.keterangan,
    userKode,
    payload.alasan,
    payload.tanggal,
    payload.keterangan,
    userKode,
    payload.alasan,
  ];

  const [result] = await db.query(query, params);
  return result;
};

module.exports = {
  getBrowse,
  getDetail,
  getBrowseDetail,
  deleteData,
  ajukanPerubahan,
};
