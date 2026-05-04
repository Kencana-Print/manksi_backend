const db = require("../../config/database");
const tutupBukuService = require("../../services/tutupBukuService");

/**
 * Helper untuk menentukan filter Gudang Produksi berdasarkan Cabang
 */
const getGudangProduksi = (cabang) => {
  if (cabang === "P01") return "GP015";
  if (cabang === "P04") return "GP001";
  return null; // Jika pusat/HO, bisa melihat semua atau sesuai role
};

/**
 * Mengambil Data Browse (Master & Detail)
 */
const getBrowseData = async (startDate, endDate, cabang) => {
  const gdgProduksi = getGudangProduksi(cabang);
  const gdgFilter = gdgProduksi
    ? `AND h.proret_gdg_produksi = '${gdgProduksi}'`
    : "";

  // Query Master (UNION ALL antara RETL dan RETP)
  const qMaster = `
    SELECT * FROM (
      -- 1. RETL (Dari Produksi / Log)
      SELECT 
        h.proret_nomor AS Nomor, h.proret_tanggal AS Tanggal, 
        g.gdg_nama AS Tujuan, SUBSTRING(p.gdgp_nama, 4) AS Dari, 
        h.proret_keterangan AS Keterangan, h.user_create AS Created, 
        IFNULL(r.proret_nomor,"") AS NoApprov, r.proret_tanggal AS TglApprov, IFNULL(r.user_create,"") AS Approved,
        IFNULL((
          SELECT IFNULL(IF(pin_acc="" AND pin_dipakai="","WAIT",
                 IF(pin_acc="Y" AND pin_dipakai="","ACC",
                 IF(pin_acc="Y" AND pin_dipakai="Y","",
                 IF(pin_acc="N","TOLAK","")))),"")
          FROM tspk_pin5 WHERE pin_trs="RETUR BAHAN" AND pin_nomor=h.proret_nomor ORDER BY pin_urut DESC LIMIT 1
        ),"") AS Ngedit, 
        h.user_create AS Usr
      FROM tproduksireturlog_hdr h
      LEFT JOIN tgudang g ON g.gdg_kode = h.proret_gdg_tujuan
      LEFT JOIN tgudangproduksi p ON p.gdgp_kode = h.proret_gdg_produksi
      LEFT JOIN tproduksiretur_hdr r ON r.proret_log = h.proret_nomor
      WHERE h.proret_tanggal >= ? AND h.proret_tanggal <= ? ${gdgFilter}

      UNION ALL

      -- 2. RETP (Dari Gudang Langsung)
      SELECT 
        h.proret_nomor AS Nomor, h.proret_tanggal AS Tanggal, 
        g.gdg_nama AS Tujuan, SUBSTRING(p.gdgp_nama, 4) AS Dari, 
        h.proret_keterangan AS Keterangan, h.user_create AS Created, 
        h.proret_nomor AS NoApprov, h.proret_tanggal AS TglApprov, IFNULL(h.user_create,"") AS Approved,
        IFNULL((
          SELECT IFNULL(IF(pin_acc="" AND pin_dipakai="","WAIT",
                 IF(pin_acc="Y" AND pin_dipakai="","ACC",
                 IF(pin_acc="Y" AND pin_dipakai="Y","",
                 IF(pin_acc="N","TOLAK","")))),"")
          FROM tspk_pin5 WHERE pin_trs="RETUR BAHAN" AND pin_nomor=h.proret_nomor ORDER BY pin_urut DESC LIMIT 1
        ),"") AS Ngedit, 
        h.user_create AS Usr
      FROM tproduksiretur_hdr h
      LEFT JOIN tgudang g ON g.gdg_kode = h.proret_gdg_tujuan
      LEFT JOIN tgudangproduksi p ON p.gdgp_kode = h.proret_gdg_produksi
      WHERE h.proret_log = "" AND h.proret_tanggal >= ? AND h.proret_tanggal <= ? ${gdgFilter}
    ) x ORDER BY Tanggal DESC, Nomor DESC
  `;

  // Query Detail (UNION ALL)
  const qDetail = `
    SELECT * FROM (
      SELECT 
        d.proretd_nourut AS No, d.proretd_proret_Nomor AS Nomor, d.proretd_bhn_kode AS Kode, 
        b.Bhn_Name AS Nama, b.Bhn_satuan AS Satuan, d.proretd_Jumlah AS Jumlah, d.proretd_roll AS Roll,
        d.proretd_keterangan AS Keterangan, d.proretd_nominta AS NoMinta, IFNULL(m.promin_spk_nomor,"") AS SPK, u.Sup_nama AS Supplier
      FROM tproduksireturlog_hdr h
      INNER JOIN tproduksireturlog_dtl d ON d.proretd_proret_Nomor = h.proret_nomor
      LEFT JOIN tbahan b ON b.Bhn_kode = d.proretd_bhn_kode
      LEFT JOIN tsupplier u ON u.Sup_kode = d.proretd_sup_kode
      LEFT JOIN tproduksiminta_hdr m ON m.promin_nomor = d.proretd_nominta
      WHERE h.proret_tanggal >= ? AND h.proret_tanggal <= ? ${gdgFilter}

      UNION ALL

      SELECT 
        d.proretd_nourut AS No, d.proretd_proret_Nomor AS Nomor, d.proretd_bhn_kode AS Kode, 
        b.Bhn_Name AS Nama, b.Bhn_satuan AS Satuan, d.proretd_Jumlah AS Jumlah, d.proretd_roll AS Roll,
        d.proretd_keterangan AS Keterangan, "" AS NoMinta, IFNULL(d.proretd_spk,"") AS SPK, u.Sup_nama AS Supplier
      FROM tproduksiretur_hdr h
      INNER JOIN tproduksiretur_dtl d ON d.proretd_proret_Nomor = h.proret_nomor
      LEFT JOIN tbahan b ON b.Bhn_kode = d.proretd_bhn_kode
      LEFT JOIN tsupplier u ON u.Sup_kode = d.proretd_sup_kode
      WHERE h.proret_log = "" AND h.proret_tanggal >= ? AND h.proret_tanggal <= ? ${gdgFilter}
    ) x ORDER BY Nomor, No
  `;

  const params = [startDate, endDate, startDate, endDate];
  const [masterRows] = await db.query(qMaster, params);
  const [detailRows] = await db.query(qDetail, params);

  // Map detail ke dalam master
  const result = masterRows.map((master) => {
    return {
      ...master,
      details: detailRows.filter((d) => d.Nomor === master.Nomor),
    };
  });

  return result;
};

/**
 * Validasi apakah data boleh diubah atau dihapus
 */
const validateAccess = async (nomor, bagianUser, action = "edit") => {
  const isRETL = nomor.startsWith("RETL");
  const isRETP = nomor.startsWith("RETP");

  // 1. Ambil data Header & Status Approval
  const table = isRETP ? "tproduksiretur_hdr" : "tproduksireturlog_hdr";
  const [rows] = await db.query(
    `SELECT proret_tanggal, proret_nomor FROM ${table} WHERE proret_nomor = ?`,
    [nomor],
  );
  if (rows.length === 0) throw new Error("Data tidak ditemukan.");

  // 2. Cek Approval untuk RETL
  if (isRETL) {
    const [cekApprov] = await db.query(
      `SELECT proret_nomor FROM tproduksiretur_hdr WHERE proret_log = ?`,
      [nomor],
    );
    if (cekApprov.length > 0) {
      throw new Error(
        `No. Retur ${nomor} sudah di-approve. Tidak dapat di-${action === "edit" ? "ubah" : "hapus"}.`,
      );
    }
  }

  // 3. Cek Otoritas Gudang untuk RETP
  if (isRETP && bagianUser.toUpperCase() !== "GUDANG") {
    throw new Error(
      "Retur ini di-input oleh Admin Gudang. Anda tidak berhak memanipulasi data ini.",
    );
  }

  // 4. Khusus Hapus: Cek Tutup Buku
  if (action === "delete") {
    const tglTrs = new Date(rows[0].proret_tanggal);
    const zdtClose = await tutupBukuService.getTanggalTutupBuku();
    if (tglTrs <= zdtClose) {
      throw new Error(
        "Transaksi tersebut sudah close (Tutup Buku). Tidak bisa dihapus.",
      );
    }
  }

  return rows[0];
};

/**
 * Update deleteData menggunakan helper validateAccess
 */
const deleteData = async (nomor, bagianUser) => {
  await validateAccess(nomor, bagianUser, "delete");

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const table = nomor.startsWith("RETP")
      ? "tproduksiretur_hdr"
      : "tproduksireturlog_hdr";
    const dtlTable = nomor.startsWith("RETP")
      ? "tproduksiretur_dtl"
      : "tproduksireturlog_dtl";

    await conn.query(`DELETE FROM ${dtlTable} WHERE proretd_proret_nomor = ?`, [
      nomor,
    ]);
    await conn.query(`DELETE FROM ${table} WHERE proret_nomor = ?`, [nomor]);

    await conn.commit();
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
};

/**
 * Pengajuan Perubahan Data (Buka Tutup Buku - PIN5)
 */
const ajukanPerubahan = async (payload, user) => {
  // Cek apakah tanggal transaksi sudah masuk tutup buku
  const zdtClose = await tutupBukuService.getTanggalTutupBuku();
  const tglTrs = new Date(payload.tanggal);

  if (tglTrs > zdtClose) {
    throw new Error(
      "Tidak perlu pengajuan perubahan data. Periode ini belum di-close.",
    );
  }

  // Cek pin urut terakhir
  const [pinRows] = await db.query(
    `SELECT pin_urut, pin_dipakai, pin_alasan FROM tspk_pin5 WHERE pin_trs="RETUR BAHAN" AND pin_nomor=? ORDER BY pin_urut DESC LIMIT 1`,
    [payload.nomor],
  );

  let urut = 1;
  if (pinRows.length > 0) {
    if (!pinRows[0].pin_dipakai) {
      urut = pinRows[0].pin_urut; // Replace yang belum dipakai
    } else {
      urut = pinRows[0].pin_urut + 1; // Buat urutan baru
    }
  }

  const qInsert = `
    INSERT INTO tspk_pin5 (pin_trs, pin_nomor, pin_urut, pin_tgl_trs, pin_ket, pin_tgl_minta, pin_user_minta, pin_alasan)
    VALUES ("RETUR BAHAN", ?, ?, ?, ?, NOW(), ?, ?)
    ON DUPLICATE KEY UPDATE 
      pin_tgl_trs = ?, pin_ket = ?, pin_acc = "", pin_tgl_minta = NOW(), pin_user_minta = ?, pin_alasan = ?
  `;

  await db.query(qInsert, [
    payload.nomor,
    urut,
    payload.tanggal,
    payload.keterangan || "",
    user.kode,
    payload.alasan,
    payload.tanggal,
    payload.keterangan || "",
    user.kode,
    payload.alasan,
  ]);

  return true;
};

module.exports = {
  getBrowseData,
  deleteData,
  ajukanPerubahan,
};
