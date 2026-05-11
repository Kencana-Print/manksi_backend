const db = require("../../config/database");
const tutupBukuService = require("../tutupBukuService"); // Pastikan path sesuai

// --- QUERY BROWSE MKB ---
const getBrowseMkb = async (startDate, endDate) => {
  const query = `
    SELECT 
      h.mkb_nomor AS Nomor, 
      h.mkb_tanggal AS Tanggal, 
      (z.po1 + z.po2) AS PO,
      IFNULL(s.spk_nomor, m.mspk_nomor) AS SPK, 
      IFNULL(s.spk_tanggal, m.mspk_tanggal) AS TglSPK, 
      IFNULL(s.spk_dateline, m.mspk_dateline) AS Dateline, 
      IFNULL(s.spk_nama, m.mspk_nama) AS NamaSpk,
      IFNULL(s.spk_jumlah, m.mspk_jumlah) AS JumlahSPK, 
      IFNULL(s.spk_kain, m.mspk_kain) AS Kain, 
      IFNULL(s.spk_finishing, m.mspk_finishing) AS Finishing,
      c.cus_nama AS Customer, 
      c.cus_alamat AS Alamat,
      
      IF((z.readyterima) >= z.butuh, 'Stok ready',
        IF(z.crs = z.item AND z.ready >= z.butuh, 'Stok ready',
          IF(z.crs0 = z.item AND (z.po1 + z.po2) = 0 AND z.terima = 0, 'Belum ready',
            IF(z.crs0 = z.item AND (z.po1 + z.po2) <> 0 AND z.terima = 0, 'Belum ready dan sudah po',
              IF(z.ready < z.butuh AND z.ready <> 0 AND (z.po1 + z.po2) = 0 AND z.terima = 0, 'Ready sebagian dan belum po',
                IF(z.ready < z.butuh AND z.ready <> 0 AND (z.po1 + z.po2) <> 0 AND z.terima = 0, 'Ready sebagian dan sudah po',
                  IF(z.terima > 0 AND z.readyterima < z.butuh AND z.terima <> 0, 'Belum ready dan kedatangan partial', 
                  '')
                )
              )
            )
          )
        )
      ) AS Keterangan,
      
      IF(LEFT(h.mkb_spk_nomor, 3) = 'MAP', 1, 
        IFNULL((SELECT COUNT(*) FROM tplanningspk p WHERE p.plan_spk = h.mkb_spk_nomor), 0)
      ) AS Plan,
      
      IFNULL((
        SELECT IFNULL(
          IF(pin_acc = '' AND pin_dipakai = '', 'WAIT',
            IF(pin_acc = 'Y' AND pin_dipakai = '', 'ACC',
              IF(pin_acc = 'Y' AND pin_dipakai = 'Y', '',
                IF(pin_acc = 'N', 'TOLAK', '')
              )
            )
          ), '')
        FROM tspk_pin5 
        WHERE pin_trs = 'MKB' AND pin_nomor = h.mkb_nomor 
        ORDER BY pin_urut DESC LIMIT 1
      ), '') AS Ngedit,
      
      h.user_create AS usr, 
      h.date_create AS Created
      
    FROM tmkb_hdr h
    LEFT JOIN tspk s ON s.spk_nomor = h.mkb_spk_nomor
    LEFT JOIN tmemospk m ON m.mspk_nomor = h.mkb_spk_nomor
    LEFT JOIN tcustomer c ON c.cus_kode = IFNULL(s.spk_cus_kode, m.mspk_cus_kode)
    LEFT JOIN (
      SELECT a.*,
        IFNULL((SELECT COUNT(DISTINCT p.pod_po_nomor) FROM tpo_dtl p WHERE p.pod_mkb_nomor = a.nomor), 0) AS po1,
        IFNULL((SELECT COUNT(DISTINCT i.mkbd2_po_nomor) FROM tmkb_dtl2 i WHERE i.mkbd2_mkb_nomor = a.nomor), 0) AS po2,
        IFNULL((SELECT COUNT(i.mkbd_jumlah) FROM tmkb_dtl i WHERE i.mkbd_mkb_nomor = a.nomor AND i.mkbd_jumlah_rs = 0), 0) AS crs0,
        IFNULL((SELECT COUNT(i.mkbd_jumlah) FROM tmkb_dtl i WHERE i.mkbd_mkb_nomor = a.nomor AND i.mkbd_jumlah_rs <> 0), 0) AS crs,
        IFNULL((SELECT COUNT(i.mkbd_jumlah) FROM tmkb_dtl i WHERE i.mkbd_mkb_nomor = a.nomor), 0) AS item
      FROM (
        SELECT 
          x.Nomor, 
          SUM(x.Butuh) AS butuh, 
          SUM(x.ready) AS ready, 
          SUM(x.SudahPO1 + x.SudahPO2) AS sudahpo, 
          SUM(IF((x.terimapo + x.nonpo + x.linkpo) > x.butuh, x.butuh, (x.terimapo + x.nonpo + x.linkpo))) AS terima,
          SUM(IF((x.terimapo + x.nonpo + x.linkpo + x.ready) > x.butuh, x.butuh, (x.terimapo + x.nonpo + x.linkpo + x.ready))) AS readyterima
        FROM (
          SELECT 
            d.mkbd_mkb_nomor AS Nomor,
            d.mkbd_jumlah AS Butuh, 
            d.mkbd_jumlah_rs AS ready,
            IFNULL((SELECT SUM(i.pod_jumlah) FROM tpo_dtl i WHERE i.pod_mkb_nomor = h.mkb_nomor AND i.pod_bhn_kode = d.mkbd_bhn_kode), 0) AS SudahPO1,
            IFNULL((SELECT SUM(i.mkbd2_qty) FROM tmkb_dtl2 i WHERE i.mkbd2_mkb_nomor = d.mkbd_mkb_nomor AND i.mkbd2_nourut = d.mkbd_nourut), 0) AS SudahPO2,
            IFNULL((SELECT IFNULL(SUM(i.bpbd2_jumlah), 0) FROM tpo_dtl p 
                    LEFT JOIN tbpb_dtl2 i ON i.bpbd2_po_nomor = p.pod_po_nomor AND i.bpbd2_nourut = p.pod_nourut 
                    WHERE p.pod_mkb_nomor = d.mkbd_mkb_nomor AND p.pod_bhn_kode = d.mkbd_bhn_kode 
                    GROUP BY p.pod_bhn_kode, p.pod_mkb_nomor), 0) AS Terimapo,
            IFNULL((SELECT IF(k.mkbd2_qty <= SUM(p.bpbd2_jumlah), k.mkbd2_qty, SUM(p.bpbd2_jumlah)) FROM tbpb_dtl2 p 
                    INNER JOIN tmkb_dtl2 k ON k.mkbd2_po_nomor = p.bpbd2_po_nomor AND k.mkbd2_pourut = p.bpbd2_nourut 
                    WHERE k.mkbd2_mkb_nomor = d.mkbd_mkb_nomor AND k.mkbd2_nourut = d.mkbd_nourut), 0) AS linkpo,
            IFNULL((SELECT SUM(i.bpbd_jumlah) FROM tbpb_dtl i WHERE i.bpbd_mkb = h.mkb_nomor AND i.bpbd_bhn_kode = d.mkbd_bhn_kode AND i.bpbd_nourut = d.mkbd_nourut), 0) AS nonpo
          FROM tmkb_dtl d
          LEFT JOIN tmkb_hdr h ON h.mkb_nomor = d.mkbd_mkb_nomor
          WHERE h.mkb_tanggal >= ? AND h.mkb_tanggal <= ?
        ) X
        GROUP BY x.Nomor
      ) a
    ) z ON z.Nomor = h.mkb_nomor
    WHERE h.mkb_tanggal >= ? AND h.mkb_tanggal <= ?
    ORDER BY h.mkb_nomor
  `;

  const [rows] = await db.query(query, [
    startDate,
    endDate,
    startDate,
    endDate,
  ]);
  return rows;
};

// --- DATA DETAIL MKB (Rincian Barang) ---
const getDetailData = async (nomor) => {
  const query = `
    SELECT 
      x.Nomor, x.Nopo, x.Komponen, x.Warna, x.Jenis, x.Babaran, x.Kode, 
      x.NamaBahan, x.Satuan, x.Gramasi, x.Butuh, x.Ready, x.Akan_PO, 
      (x.SudahPO1 + x.SudahPO2) AS SudahPO, 
      (x.Terimapo + x.nonpo + x.linkpo) AS Terima, 
      (x.Butuh - x.Ready - (x.Terimapo + x.nonpo + x.linkpo)) AS Kurang
    FROM (
      SELECT 
        d.mkbd_mkb_nomor AS Nomor,
        IFNULL((SELECT hh.po_nomor FROM tpo_hdr hh INNER JOIN tpo_dtl dd ON hh.po_nomor=dd.pod_po_nomor WHERE dd.pod_bhn_kode=d.mkbd_bhn_kode AND dd.pod_mkb_nomor=d.mkbd_mkb_nomor LIMIT 1), "") AS Nopo,
        d.mkbd_komponen AS Komponen, 
        d.mkbd_warna AS Warna, 
        d.mkbd_jenis AS Jenis, 
        d.mkbd_babaran AS Babaran,
        d.mkbd_bhn_kode AS Kode,
        b.bhn_name AS NamaBahan,
        d.mkbd_bhn_satuan AS Satuan,
        b.bhn_gramasi AS Gramasi,
        d.mkbd_jumlah AS Butuh,
        d.mkbd_jumlah_rs AS Ready,
        d.mkbd_jumlah_po AS Akan_PO,
        IFNULL((SELECT SUM(i.pod_jumlah) FROM tpo_dtl i WHERE i.pod_mkb_nomor = h.mkb_nomor AND i.pod_bhn_kode = d.mkbd_bhn_kode), 0) AS SudahPO1,
        IFNULL((SELECT SUM(i.mkbd2_qty) FROM tmkb_dtl2 i WHERE i.mkbd2_mkb_nomor = d.mkbd_mkb_nomor AND i.mkbd2_nourut = d.mkbd_nourut), 0) AS SudahPO2,
        IFNULL((SELECT IFNULL(SUM(i.bpbd2_jumlah), 0) FROM tpo_dtl p LEFT JOIN tbpb_dtl2 i ON i.bpbd2_po_nomor = p.pod_po_nomor AND i.bpbd2_nourut = p.pod_nourut WHERE p.pod_mkb_nomor = d.mkbd_mkb_nomor AND p.pod_bhn_kode = d.mkbd_bhn_kode GROUP BY p.pod_bhn_kode, p.pod_mkb_nomor), 0) AS Terimapo,
        IFNULL((SELECT IF(k.mkbd2_qty <= SUM(p.bpbd2_jumlah), k.mkbd2_qty, SUM(p.bpbd2_jumlah)) FROM tbpb_dtl2 p INNER JOIN tmkb_dtl2 k ON k.mkbd2_po_nomor = p.bpbd2_po_nomor AND k.mkbd2_pourut = p.bpbd2_nourut WHERE k.mkbd2_mkb_nomor = d.mkbd_mkb_nomor AND k.mkbd2_nourut = d.mkbd_nourut), 0) AS linkpo,
        IFNULL((SELECT SUM(i.bpbd_jumlah) FROM tbpb_dtl i WHERE i.bpbd_mkb = h.mkb_nomor AND i.bpbd_bhn_kode = d.mkbd_bhn_kode AND i.bpbd_nourut = d.mkbd_nourut), 0) AS nonpo
      FROM tmkb_dtl d
      LEFT JOIN tmkb_hdr h ON h.mkb_nomor = d.mkbd_mkb_nomor
      LEFT JOIN tbahan b ON b.bhn_kode = d.mkbd_bhn_kode
      WHERE d.mkbd_mkb_nomor = ?
      ORDER BY d.mkbd_mkb_nomor, d.mkbd_nourut
    ) x
  `;
  const [rows] = await db.query(query, [nomor]);
  return rows;
};

// --- DATA PO TERKAIT (Sub-table) ---
const getLinkedPo = async (nomor) => {
  const query = `
    SELECT DISTINCT h.po_nomor AS nomor, DATE_FORMAT(h.po_tanggal, '%d-%m-%Y') AS tanggal, 'N' AS link
    FROM tpo_hdr h
    INNER JOIN tpo_dtl d ON d.pod_po_nomor = h.po_nomor
    WHERE d.pod_mkb_nomor = ?
    UNION ALL
    SELECT DISTINCT i.mkbd2_po_nomor, DATE_FORMAT(j.po_tanggal, '%d-%m-%Y'), 'Y' AS link
    FROM tmkb_dtl2 i
    LEFT JOIN tpo_hdr j ON j.po_nomor = i.mkbd2_po_nomor
    WHERE i.mkbd2_mkb_nomor = ?
  `;
  const [rows] = await db.query(query, [nomor, nomor]);
  return rows;
};

// --- HAPUS MKB ---
const deleteMkb = async (nomor, tglTransaksi) => {
  const conn = await db.getConnection();
  await conn.beginTransaction();
  try {
    // Validasi Tutup Buku
    const zdtClose = await tutupBukuService.getTanggalTutupBuku();
    if (zdtClose && new Date(tglTransaksi) <= zdtClose) {
      throw new Error("Transaksi tsb sudah close. Tidak bisa dihapus.");
    }

    // Eksekusi Hapus (Sesuai Delphi)
    await conn.query(`DELETE FROM tmkb_hdr WHERE mkb_nomor = ?`, [nomor]);
    await conn.query(
      `UPDATE tmkb_hdr SET mkb_spk_nomor = "" WHERE mkb_spk_nomor = ?`,
      [nomor],
    );

    await conn.commit();
    return true;
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
};

// --- PENGAJUAN PIN (PERUBAHAN DATA) ---
const requestPin = async (payload, user) => {
  const { nomor, tanggal, spk, alasan } = payload;

  if (!alasan?.trim()) throw new Error("Alasan harus diisi.");

  const conn = await db.getConnection();
  try {
    // Cek status/urut PIN sebelumnya
    const [existing] = await conn.query(
      `SELECT pin_urut, pin_dipakai FROM tspk_pin5 WHERE pin_trs="MKB" AND pin_nomor=? ORDER BY pin_urut DESC LIMIT 1`,
      [nomor],
    );

    let urut = 1;
    if (existing.length > 0) {
      urut =
        existing[0].pin_dipakai === ""
          ? existing[0].pin_urut
          : existing[0].pin_urut + 1;
    }

    const queryInsert = `
      INSERT INTO tspk_pin5 (
        pin_trs, pin_nomor, pin_urut, pin_tgl_trs, pin_ket, 
        pin_tgl_minta, pin_user_minta, pin_alasan
      ) VALUES ('MKB', ?, ?, ?, ?, NOW(), ?, ?)
      ON DUPLICATE KEY UPDATE 
        pin_tgl_trs = ?, 
        pin_ket = ?, 
        pin_acc = "", 
        pin_tgl_minta = NOW(), 
        pin_user_minta = ?, 
        pin_alasan = ?
    `;

    await conn.query(queryInsert, [
      nomor,
      urut,
      tanggal,
      spk,
      user.kode,
      alasan,
      tanggal,
      spk,
      user.kode,
      alasan,
    ]);

    return { urut, status: "WAIT" };
  } finally {
    conn.release();
  }
};

module.exports = {
  getBrowseMkb,
  getDetailData,
  getLinkedPo,
  deleteMkb,
  requestPin,
};
