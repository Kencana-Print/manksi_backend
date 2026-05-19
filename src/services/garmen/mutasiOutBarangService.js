const db = require("../../config/database");
const tutupBukuService = require("../tutupBukuService");

// --- 1. GET BROWSE HEADER ---
const getBrowse = async (query, user) => {
  const { startDate, endDate, cabang, jenis } = query;

  // Default tanggal: Awal bulan s/d Hari ini
  const dStart =
    startDate ||
    new Date(new Date().getFullYear(), new Date().getMonth(), 1)
      .toISOString()
      .substring(0, 10);
  const dEnd = endDate || new Date().toISOString().substring(0, 10);

  let sql = `
    SELECT 
      h.mso_nomor AS Nomor,
      h.mso_jenis AS Jenis,
      DATE_FORMAT(h.mso_tanggal, "%Y-%m-%d") AS Tanggal,
      h.mso_cab AS Cab,
      h.mso_kecab AS Tujuan,
      h.mso_ket AS Keterangan,
      h.user_create AS Usr,
      h.mso_bagian AS Bagian,
      DATE_FORMAT(h.date_create, "%Y-%m-%d %H:%i:%s") AS Created,
      h.mso_msi_nomor AS NoTerima,
      h.mso_msi_usr AS UsrTerima,
      DATE_FORMAT(h.mso_msi_date, "%Y-%m-%d %H:%i:%s") AS TglTerima,
      
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
        WHERE pin_trs="MUTASI OUT" AND pin_nomor=h.mso_nomor 
        ORDER BY pin_urut DESC LIMIT 1
      ), "") AS Ngedit
      
    FROM tgarmenmso_hdr h
    WHERE h.mso_tanggal >= ? AND h.mso_tanggal <= ?
  `;

  const params = [dStart, dEnd];

  // Filter Jenis (ACCESORIES, OBAT, SPAREPART, ATK/RTK)
  if (jenis) {
    sql += ` AND h.mso_jenis = ?`;
    params.push(jenis);
  }

  // Filter Bagian (EDP & AUDIT bisa lihat semua, selain itu sesuai bagian user)
  if (user && user.bagian !== "EDP" && user.bagian !== "AUDIT") {
    sql += ` AND h.mso_bagian = ?`;
    params.push(user.bagian);
  }

  // Filter Cabang
  if (cabang && cabang !== "ALL") {
    sql += ` AND h.mso_cab = ?`;
    params.push(cabang);
  }

  sql += ` ORDER BY h.mso_nomor DESC`;

  const [rows] = await db.query(sql, params);
  return rows;
};

// --- 2. GET BROWSE DETAIL ---
const getBrowseDetail = async (nomorMutasi) => {
  const sql = `
    SELECT 
      d.msod_nomor AS Nomor,
      d.msod_mb_nomor AS NoPermintaan,
      d.msod_brg_kode AS Kode,
      IF(b.brg_note="", b.brg_nama, CONCAT(b.brg_nama, " - ", b.brg_note)) AS Nama,
      d.msod_ket AS Spesifikasi,
      b.brg_satuan AS Satuan,
      d.msod_jumlah AS Jumlah
    FROM tgarmenmso_dtl d
    LEFT JOIN tgarmen_brg b ON msod_brg_kode = brg_kode
    WHERE d.msod_nomor = ?
    ORDER BY d.msod_urut ASC
  `;

  const [rows] = await db.query(sql, [nomorMutasi]);
  return rows;
};

// --- 3. DELETE DATA ---
const deleteData = async (nomor) => {
  const conn = await db.getConnection();
  try {
    // 1. Ambil Data Header
    const [headers] = await conn.query(
      `SELECT mso_tanggal, mso_msi_nomor FROM tgarmenmso_hdr WHERE mso_nomor = ?`,
      [nomor],
    );

    if (headers.length === 0) throw new Error("Data tidak ditemukan.");
    const header = headers[0];

    // 2. Cek apakah sudah diterima
    if (header.mso_msi_nomor && header.mso_msi_nomor.trim() !== "") {
      throw new Error(
        "Mutasi tsb sudah diterima di cabang tujuan. Tidak bisa dihapus.",
      );
    }

    // 3. Cek Tutup Buku
    const zdtClose = await tutupBukuService.getTanggalTutupBuku();
    if (zdtClose && new Date(header.mso_tanggal) < zdtClose) {
      throw new Error(
        "Transaksi tersebut sudah close (Tutup Buku). Tidak bisa dihapus.",
      );
    }

    // 4. Hapus Transaksi (Asumsi ON DELETE CASCADE ada di tabel detail)
    await conn.query(`DELETE FROM tgarmenmso_hdr WHERE mso_nomor = ?`, [nomor]);

    // Jika tidak cascade, hapus manual detailnya
    // await conn.query(`DELETE FROM tgarmenmso_dtl WHERE msod_nomor = ?`, [nomor]);

    return true;
  } finally {
    conn.release();
  }
};

// --- 4. PENGAJUAN PIN PERUBAHAN DATA ---
const requestPinEdit = async (payload, userKode) => {
  const { nomor, tanggal, keterangan, alasan } = payload;
  const conn = await db.getConnection();
  try {
    // Cek Urutan Terakhir
    const [lastPin] = await conn.query(
      `SELECT pin_urut, pin_dipakai FROM tspk_pin5 WHERE pin_trs="MUTASI OUT" AND pin_nomor=? ORDER BY pin_urut DESC LIMIT 1`,
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

    // Insert Pengajuan PIN
    await conn.query(
      `
      INSERT INTO tspk_pin5 (pin_trs, pin_nomor, pin_urut, pin_tgl_trs, pin_ket, pin_tgl_minta, pin_user_minta, pin_alasan) 
      VALUES ("MUTASI OUT", ?, ?, ?, ?, NOW(), ?, ?)
      ON DUPLICATE KEY UPDATE 
        pin_tgl_trs=VALUES(pin_tgl_trs), 
        pin_ket=VALUES(pin_ket), 
        pin_acc="", 
        pin_tgl_minta=NOW(), 
        pin_user_minta=VALUES(pin_user_minta), 
        pin_alasan=VALUES(pin_alasan)
    `,
      [nomor, urut, tanggal, keterangan || "", userKode, alasan],
    );

    return true;
  } finally {
    conn.release();
  }
};

module.exports = {
  getBrowse,
  getBrowseDetail,
  deleteData,
  requestPinEdit,
};
