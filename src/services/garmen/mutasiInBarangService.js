const db = require("../../config/database");
const tutupBukuService = require("../tutupBukuService");

// --- GET BROWSE MASTER DETAIL ---
const getBrowse = async (startDate, endDate, jenis, cabang) => {
  let whereHdr = `WHERE h.mso_tanggal >= ? AND h.mso_tanggal <= ?`;
  let paramsHdr = [startDate, endDate];

  if (jenis) {
    whereHdr += ` AND h.mso_jenis = ?`;
    paramsHdr.push(jenis);
  }

  if (cabang && cabang !== "ALL") {
    whereHdr += ` AND h.mso_kecab = ?`;
    paramsHdr.push(cabang);
  }

  // Master Query
  const queryMaster = `
    SELECT 
      h.mso_nomor AS Nomor, h.mso_jenis AS Jenis, DATE_FORMAT(h.mso_tanggal, '%Y-%m-%d') AS Tanggal, 
      h.mso_cab AS Cab, h.mso_kecab AS Tujuan, h.mso_ket AS Keterangan, 
      h.user_create AS Usr, h.mso_bagian AS Bagian, DATE_FORMAT(h.date_create, '%d-%m-%Y %H:%i:%s') AS Created, 
      h.mso_msi_nomor AS NoTerima, h.mso_msi_usr AS UsrTerima, DATE_FORMAT(h.mso_msi_date, '%d-%m-%Y %H:%i:%s') AS TglTerima,
      IFNULL((
        SELECT IFNULL(
          IF(pin_acc="" AND pin_dipakai="", "WAIT", 
            IF(pin_acc="Y" AND pin_dipakai="", "ACC", 
              IF(pin_acc="Y" AND pin_dipakai="Y", "", 
                IF(pin_acc="N", "TOLAK", "")
              )
            )
          ), "")
        FROM tspk_pin5 WHERE pin_trs="MUTASI OUT" AND pin_nomor=h.mso_nomor ORDER BY pin_urut DESC LIMIT 1
      ), "") AS Ngedit
    FROM tgarmenmso_hdr h
    ${whereHdr}
    ORDER BY h.mso_nomor DESC
  `;

  // Detail Query
  const queryDetail = `
    SELECT 
      d.msod_nomor AS Nomor, d.msod_mb_nomor AS NoPermintaan, d.msod_brg_kode AS Kode, 
      IF(b.brg_note="", b.brg_nama, CONCAT(b.brg_nama, " - ", b.brg_note)) AS Nama, 
      d.msod_ket AS Spesifikasi, b.brg_satuan AS Satuan, d.msod_jumlah AS Jumlah
    FROM tgarmenmso_dtl d
    INNER JOIN tgarmenmso_hdr h ON h.mso_nomor = d.msod_nomor
    LEFT JOIN tgarmen_brg b ON d.msod_brg_kode = b.brg_kode
    ${whereHdr}
    ORDER BY d.msod_nomor, d.msod_urut
  `;

  const [master] = await db.query(queryMaster, paramsHdr);
  const [detail] = await db.query(queryDetail, paramsHdr);

  return { master, detail };
};

// --- LOGIKA PENOMORAN TERIMA (Migrasi Delphi getmaxnomor) ---
const generateNomorTerima = async (jenis, tanggal, conn) => {
  const d = new Date(tanggal);
  const year = d.getFullYear().toString(); // format 4 digit YYYY
  let prefix = "MSIK"; // Default ATK/RTK

  if (jenis === "ACCESORIES") prefix = "MSIA";
  else if (jenis === "OBAT") prefix = "MSIO";
  else if (jenis === "SPAREPART") prefix = "MSIS";

  const searchPrefix = prefix + year; // ex: MSIA2026

  const query = `SELECT IFNULL(MAX(CAST(RIGHT(mso_msi_nomor, 5) AS UNSIGNED)), 0) AS max_val FROM tgarmenmso_hdr WHERE LEFT(mso_msi_nomor, 8) = ?`;
  const [[row]] = await conn.query(query, [searchPrefix]);

  const nextNum = parseInt(row.max_val, 10) + 1;
  return searchPrefix + String(nextNum).padStart(5, "0"); // ex: MSIA202600001
};

// --- EKSEKUSI TERIMA (Migrasi Delphi cxButton2Click) ---
const terimaMutasi = async (nomor, userKode) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // 1. Cek Data Eksis & Status Terima
    const [rows] = await conn.query(
      "SELECT mso_jenis, mso_tanggal, mso_msi_nomor FROM tgarmenmso_hdr WHERE mso_nomor = ?",
      [nomor],
    );
    if (rows.length === 0) throw new Error("Data Mutasi tidak ditemukan.");

    const data = rows[0];
    if (data.mso_msi_nomor && data.mso_msi_nomor.trim() !== "") {
      throw new Error("Mutasi tsb sudah diterima.");
    }

    // 2. Validasi Tutup Buku
    const zdtClose = await tutupBukuService.getTanggalTutupBuku();
    const tglMutasi = new Date(data.mso_tanggal);
    if (zdtClose && tglMutasi < zdtClose) {
      throw new Error(
        "Transaksi tersebut sudah close (tutup buku). Tidak bisa menerima mutasi.",
      );
    }

    // 3. Generate Nomor Terima Baru
    const noTerima = await generateNomorTerima(
      data.mso_jenis,
      data.mso_tanggal,
      conn,
    );

    // 4. Update Header
    await conn.query(
      "UPDATE tgarmenmso_hdr SET mso_msi_nomor = ?, mso_msi_usr = ?, mso_msi_date = NOW() WHERE mso_nomor = ?",
      [noTerima, userKode, nomor],
    );

    // 5. Update Detail
    await conn.query(
      "UPDATE tgarmenmso_dtl SET msod_msi_nomor = ? WHERE msod_nomor = ?",
      [noTerima, nomor],
    );

    await conn.commit();
    return { noTerima };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
};

module.exports = {
  getBrowse,
  terimaMutasi,
};
