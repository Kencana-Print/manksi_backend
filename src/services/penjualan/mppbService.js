const db = require("../../config/database");
const tutupBukuService = require("../tutupBukuService");

// --- GET BROWSE LIST ---
const getBrowseList = async (startDate, endDate) => {
  const start = `${startDate} 00:00:00`;
  const end = `${endDate} 23:59:59`;

  const conn = await db.getConnection();
  try {
    const query = `
      SELECT DISTINCT 
        h.mpb_nomor AS Nomor,
        h.mpb_pen_nomor AS NoPenawaran,
        IFNULL((SELECT po_nomor FROM tpo_hdr p WHERE p.po_mppb_nomor=h.mpb_nomor ORDER BY p.po_tanggal DESC LIMIT 1), "") AS NO_PO,
        h.mpb_tanggal AS Tanggal,
        v.Divisi, 
        h.mpb_nama AS NamaProduk,
        h.mpb_ukuran AS Ukuran, 
        h.mpb_bahan AS Bahan,
        h.mpb_gramasi AS Gramasi,
        h.mpb_jmlorder AS QtyOrder,
        h.mpb_dokumen AS NoDokumen,
        h.mpb_approve AS Approve,
        IFNULL(s.spk_nomor, "") AS SPK,
        h.mpb_ket AS Keterangan,
        h.user_create AS Created,
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
          WHERE pin_trs="MPPB" AND pin_nomor=h.mpb_nomor 
          ORDER BY pin_urut DESC LIMIT 1
        ), "") AS Ngedit
      FROM tmpb h
      LEFT JOIN tspk s ON s.spk_mppb = h.mpb_nomor
      LEFT JOIN tdivisi v ON v.kode = h.mpb_divisi
      WHERE h.mpb_tanggal >= ? AND h.mpb_tanggal <= ?
      ORDER BY h.mpb_nomor
    `;

    const [rows] = await conn.query(query, [start, end]);
    return rows;
  } finally {
    conn.release();
  }
};

// --- DELETE DATA ---
const deleteData = async (nomor) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // 1. Ambil data Header untuk pengecekan
    const [hdr] = await conn.query(
      `SELECT mpb_tanggal, mpb_approve FROM tmpb WHERE mpb_nomor = ?`,
      [nomor],
    );
    if (hdr.length === 0) throw new Error("Data tidak ditemukan.");

    const mpbData = hdr[0];

    // 2. Validasi Tutup Buku
    const tglTrs = new Date(mpbData.mpb_tanggal);
    const zdtClose = await tutupBukuService.getTanggalTutupBuku();
    if (zdtClose && tglTrs <= zdtClose) {
      throw new Error(
        "Transaksi tersebut sudah close (Tutup Buku). Tidak bisa dihapus.",
      );
    }

    // 3. Validasi Status Approve
    if (mpbData.mpb_approve === "Y") {
      throw new Error("Nomor tsb sudah di Approve. Tidak bisa dihapus.");
    }

    // 4. Validasi Relasi ke SPK
    const [spkRows] = await conn.query(
      `SELECT spk_nomor FROM tspk WHERE spk_mppb = ? LIMIT 1`,
      [nomor],
    );
    if (spkRows.length > 0) {
      throw new Error(`Nomor tsb sudah link ke SPK = ${spkRows[0].spk_nomor}.`);
    }

    // 5. Eksekusi Hapus (Tabel Utama)
    await conn.query(`DELETE FROM tmpb WHERE mpb_nomor = ?`, [nomor]);

    await conn.commit();
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
};

// --- TOGGLE APPROVE ---
const toggleApprove = async (nomor, currentStatus) => {
  const conn = await db.getConnection();
  try {
    // Determine new status
    const newStatus = currentStatus === "N" ? "Y" : "N";

    // Asumsi: Validasi hak akses "apv_mppb" (Delphi) di-handle
    // oleh middleware permission "approve" di Route/Controller.

    await conn.query(`UPDATE tmpb SET mpb_approve = ? WHERE mpb_nomor = ?`, [
      newStatus,
      nomor,
    ]);
    return newStatus;
  } finally {
    conn.release();
  }
};

// --- PENGAJUAN PIN 5 ---
const requestPin5 = async (nomor, alasan, userKode) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // 1. Ambil data Header untuk Insert PIN
    const qHdr = `SELECT mpb_tanggal, mpb_nama, mpb_approve FROM tmpb WHERE mpb_nomor = ?`;
    const [hdr] = await conn.query(qHdr, [nomor]);
    if (hdr.length === 0) throw new Error("Data MPPB tidak ditemukan.");

    const mpbData = hdr[0];

    // Validasi tambahan (Sesuai Delphi): Tidak boleh mengajukan jika sudah di-Approve
    if (mpbData.mpb_approve === "Y") {
      throw new Error(
        "Nomor tsb sudah di Approve. Tidak bisa melakukan pengajuan.",
      );
    }

    const tglTrs = mpbData.mpb_tanggal;
    const namaProduk = mpbData.mpb_nama; // pin_ket diisi dengan NamaProduk

    // 2. Cari urutan terakhir PIN
    const qPin = `
      SELECT pin_urut, pin_dipakai 
      FROM tspk_pin5 
      WHERE pin_trs="MPPB" AND pin_nomor=? 
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
        "MPPB", ?, ?, ?, ?, NOW(), ?, ?
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
      namaProduk,
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
  deleteData,
  toggleApprove,
  requestPin5,
};
