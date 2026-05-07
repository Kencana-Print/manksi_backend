const db = require("../../config/database");
const tutupBukuService = require("../tutupBukuService");

// --- GET BROWSE LIST (MASTER + DETAIL) ---
const getBrowseList = async (startDate, endDate) => {
  // Format tanggal agar full 1 hari (00:00:00 s/d 23:59:59)
  const start = `${startDate} 00:00:00`;
  const end = `${endDate} 23:59:59`;

  const conn = await db.getConnection();
  try {
    // 1. Query Master (Persis seperti Delphi ufrmBrowseInvPro)
    const qMaster = `
      SELECT 
        a.inv_nomor AS Nomor, 
        a.inv_tanggal AS Tanggal, 
        v.Divisi,
        c.cus_nama AS NamaCustomer, 
        a.inv_keterangan AS Keterangan,
        IF(a.inv_sts_pro=0, "Normal", IF(a.inv_sts_pro=1, "Proforma", "Tidak Normal")) AS Status,
        IF(a.inv_status_otomatis=1, "Otomatis", "Normal") AS Otomatis,
        (
          SELECT ((SUM(d.invd_harga * d.invd_jumlah) - a.inv_disc) * IF(a.INV_STS_PPN=1, ((100 + a.inv_ppn) / 100), 1)) 
          FROM tinv_dtl d WHERE d.invd_inv_nomor = a.inv_nomor
        ) AS Total,
        a.inv_no_fp AS Faktur_Pajak, 
        IF(a.isexportppn=1, "Sudah Export", "Belum") AS Stat_Exp,
        IFNULL((SELECT SUM(kredit) FROM piutang_kredit_detail WHERE nota = a.inv_nomor), 0) AS Bayar,
        (
          SELECT pkh.tanggal FROM piutang_kredit_detail pkd 
          INNER JOIN piutang_kredit_header pkh ON pkd.nomor = pkh.nomor 
          WHERE pkd.nota = a.inv_nomor ORDER BY pkh.tanggal DESC LIMIT 1
        ) AS Tanggal_Pelunasan,
        (
          SELECT tb.tanggal FROM terima_bayar_debet tb 
          INNER JOIN piutang_kredit_detail pkd ON pkd.no_bukti = tb.nomor 
          WHERE pkd.nota = a.inv_nomor ORDER BY tb.tanggal DESC LIMIT 1
        ) AS Tanggal_bayar,
        DATE_FORMAT(a.date_create, "%d-%m-%Y %H:%i:%s") AS Created,
        IFNULL((
          SELECT IFNULL(
            IF(pin_acc="" AND pin_dipakai="", "WAIT",
              IF(pin_acc="Y" AND pin_dipakai="", "ACC",
                IF(pin_acc="Y" AND pin_dipakai="Y", "",
                  IF(pin_acc="N", "TOLAK", "")
                )
              )
            ), "")
          FROM tspk_pin5 
          WHERE pin_trs="INV PROFORMA" AND pin_nomor = a.inv_nomor 
          ORDER BY pin_urut DESC LIMIT 1
        ), "") AS Ngedit
      FROM tinv_hdr a
      INNER JOIN tcustomer c ON a.inv_cus_kode = c.cus_kode
      INNER JOIN tperusahaan p ON p.perush_kode = a.inv_perush_kode
      LEFT JOIN tdivisi v ON v.kode = a.inv_divisi
      WHERE a.inv_sts_pro = 1 
        AND a.inv_tanggal >= ? AND a.inv_tanggal <= ?
      ORDER BY a.date_create DESC
    `;
    const [masters] = await conn.query(qMaster, [start, end]);

    // 2. Query Detail (Digabung ke Master untuk UI Expand Row)
    const qDetail = `
      SELECT 
        d.invd_inv_nomor AS NomorInv, 
        d.invd_spk_nomor AS Kode, 
        b.brg_name AS Nama, 
        d.invd_ukuran AS Ukuran,
        d.invd_jumlah AS Jumlah, 
        d.invd_harga AS Harga, 
        IFNULL(s.spk_hargariil, 0) AS HargaRiil, 
        IFNULL(s.spk_hargaFEE, 0) AS Fee
      FROM tinv_dtl d
      INNER JOIN tinv_hdr h ON h.inv_nomor = d.invd_inv_nomor
      INNER JOIN tbarang b ON b.brg_kode = d.invd_spk_nomor
      LEFT JOIN tspk s ON s.spk_nomor = d.invd_spk_nomor
      WHERE h.inv_sts_pro = 1 
        AND h.inv_tanggal >= ? AND h.inv_tanggal <= ?
      ORDER BY d.invd_inv_nomor
    `;
    const [details] = await conn.query(qDetail, [start, end]);

    // Grouping detail ke dalam master
    return masters.map((master) => {
      master.details = details.filter((d) => d.NomorInv === master.Nomor);
      return master;
    });
  } finally {
    conn.release();
  }
};

// --- EXPORT DETAIL (CSV/EXCEL FLAT) ---
const getExportDetail = async (startDate, endDate) => {
  const start = `${startDate} 00:00:00`;
  const end = `${endDate} 23:59:59`;

  const qExport = `
    SELECT 
      d.invd_inv_nomor AS Nomor, 
      d.invd_spk_nomor AS Kode, 
      b.brg_name AS Nama, 
      d.invd_ukuran AS Ukuran,
      d.invd_jumlah AS Jumlah, 
      d.invd_harga AS Harga, 
      IFNULL(s.spk_hargariil, 0) AS HargaRiil, 
      IFNULL(s.spk_hargaFEE, 0) AS Fee
    FROM tinv_dtl d
    INNER JOIN tinv_hdr h ON h.inv_nomor = d.invd_inv_nomor
    INNER JOIN tbarang b ON b.brg_kode = d.invd_spk_nomor
    LEFT JOIN tspk s ON s.spk_nomor = d.invd_spk_nomor
    WHERE h.inv_sts_pro = 1 
      AND h.inv_tanggal >= ? AND h.inv_tanggal <= ?
    ORDER BY d.invd_inv_nomor
  `;
  const [rows] = await db.query(qExport, [start, end]);
  return rows;
};

// --- DELETE DATA ---
const deleteData = async (nomor) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // 1. Cek Tutup Buku
    const [hdr] = await conn.query(
      `SELECT inv_tanggal FROM tinv_hdr WHERE inv_nomor = ?`,
      [nomor],
    );
    if (hdr.length === 0) throw new Error("Data tidak ditemukan.");

    const tglTrs = new Date(hdr[0].inv_tanggal);
    const zdtClose = await tutupBukuService.getTanggalTutupBuku();

    if (zdtClose && tglTrs <= zdtClose) {
      throw new Error(
        "Transaksi tersebut sudah close (Tutup Buku). Tidak bisa dihapus.",
      );
    }

    // 2. Hapus Transaksi
    await conn.query(`DELETE FROM tinv_dtl WHERE invd_inv_nomor = ?`, [nomor]);
    await conn.query(`DELETE FROM tinv_hdr WHERE inv_nomor = ?`, [nomor]);

    await conn.commit();
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
};

// --- PENGAJUAN PIN 5 (EDIT CLOSED DATA) ---
const requestPin5 = async (nomor, alasan, userKode) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // 1. Ambil data Header & Customer untuk Insert PIN (pin_ket diset Nama Customer)
    const qHdr = `
      SELECT a.inv_tanggal, c.cus_nama 
      FROM tinv_hdr a 
      INNER JOIN tcustomer c ON a.inv_cus_kode = c.cus_kode 
      WHERE a.inv_nomor = ?
    `;
    const [hdr] = await conn.query(qHdr, [nomor]);
    if (hdr.length === 0) throw new Error("Data Invoice tidak ditemukan.");

    const tglTrs = hdr[0].inv_tanggal;
    const namaCustomer = hdr[0].cus_nama;

    // 2. Cari urutan terakhir PIN
    const qPin = `
      SELECT pin_urut, pin_dipakai 
      FROM tspk_pin5 
      WHERE pin_trs="INV PROFORMA" AND pin_nomor=? 
      ORDER BY pin_urut DESC LIMIT 1
    `;
    const [pinRows] = await conn.query(qPin, [nomor]);

    let urut = 1;
    if (pinRows.length > 0) {
      const lastPin = pinRows[0];
      urut =
        lastPin.pin_dipakai === "" ? lastPin.pin_urut : lastPin.pin_urut + 1;
    }

    // 3. Upsert ke tabel PIN
    const qInsert = `
      INSERT INTO tspk_pin5 (
        pin_trs, pin_nomor, pin_urut, pin_tgl_trs, pin_ket, pin_tgl_minta, pin_user_minta, pin_alasan
      ) VALUES (
        "INV PROFORMA", ?, ?, ?, ?, NOW(), ?, ?
      ) ON DUPLICATE KEY UPDATE 
        pin_tgl_trs=VALUES(pin_tgl_trs), 
        pin_ket=VALUES(pin_ket), 
        pin_acc="", 
        pin_tgl_minta=NOW(), 
        pin_user_minta=VALUES(pin_user_minta), 
        pin_alasan=VALUES(pin_alasan)
    `;
    await conn.query(qInsert, [
      nomor,
      urut,
      tglTrs,
      namaCustomer,
      userKode,
      alasan,
    ]);

    await conn.commit();
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
};

module.exports = {
  getBrowseList,
  getExportDetail,
  deleteData,
  requestPin5,
};
