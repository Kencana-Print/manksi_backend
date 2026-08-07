const db = require("../../config/database");
const tutupBukuService = require("../tutupBukuService");

// 1. Dapatkan Daftar Divisi untuk Filter (Delphi: FormCreate)
const getDivisiFilter = async (cabKaos, userCab) => {
  let query = "";
  if (cabKaos && cabKaos !== "KDC") {
    query = `SELECT kode AS Kode, Divisi AS Nama FROM tdivisi WHERE kode = 3 ORDER BY kode`;
  } else if (userCab && cabKaos === "KDC") {
    query = `SELECT kode AS Kode, Divisi AS Nama FROM tdivisi WHERE kode IN (3,6) ORDER BY kode`;
  } else if (userCab === "P03") {
    // Tambahkan kondisi khusus untuk cabang P03 agar bisa melihat divisi 3 beserta divisi lainnya
    query = `SELECT kode AS Kode, Divisi AS Nama FROM tdivisi ORDER BY kode`;
  } else {
    // Cabang reguler lainnya secara default tidak memunculkan Divisi 3 (Kaosan)
    query = `SELECT kode AS Kode, Divisi AS Nama FROM tdivisi WHERE kode <> 3 ORDER BY kode`;
  }
  const [rows] = await db.query(query);
  return rows;
};

// 2. Query Utama Browse (Delphi: btnRefreshClick)
const getBrowseData = async (startDate, endDate, divisiKode, userInfo) => {
  // userInfo: { kode, jabatan, cabKaos }
  let query = `
    SELECT 
      h.mh_nomor AS Nomor, 
      v.Divisi AS Divisi,
      DATE_FORMAT(h.mh_tanggal, '%Y-%m-%d') AS Tanggal, 
      h.mh_cus_nama AS Customer, 
      s.sal_nama AS Sales, 
      h.mh_nama AS NamaPekerjaan, 
      h.mh_jmlorder AS RencanaOrder, 
      h.mh_harga AS HargaLama, 
      h.mh_budget AS HargaBudget, 
      DATE_FORMAT(h.mh_dateorder, '%Y-%m-%d') AS OrderTerakhir, 
      h.mh_kain AS Kain, 
      h.mh_panjang AS Panjang, 
      h.mh_lebar AS Lebar, 
      h.mh_ukuran AS Ukuran, 
      h.mh_gramasi AS Gramasi, 
      h.mh_finishing AS Finishing, 
      h.mh_sublim AS Sublim, 
      h.mh_ket AS Keterangan, 
      (
        SELECT IFNULL(IF(IFNULL(m.mspk_hargariil, 0) = 0, m.mspk_harga, m.mspk_hargariil), 0) 
        FROM tmemospk m 
        WHERE m.mspk_mh_nomor <> "" AND m.mspk_mh_nomor = h.mh_nomor 
        ORDER BY m.date_create DESC LIMIT 1
      ) AS HargaMAP, 
      h.mh_harga_kalkulasi AS HargaKalkulasi, 
      IF(k.date_modified IS NOT NULL, DATE_FORMAT(k.date_modified, '%Y-%m-%d'), DATE_FORMAT(k.date_create, '%Y-%m-%d')) AS TglKalkulasi, 
      h.mh_nomor_kalkulasi AS NoKalkulasi, 
      h.mh_ket_kalkulasi AS KeteranganKalkulasi, 
      k.user_create AS KalCreated, 
      k.user_modified AS KalModified, 
      h.mh_status AS Status, 
      DATE_FORMAT(h.mh_apv, '%d-%m-%Y %H:%i:%s') AS Approved, 
      h.mh_apv_usr AS diApvOleh, 
      h.user_create AS usr, 
      DATE_FORMAT(h.date_create, '%Y-%m-%d %H:%i:%s') AS Created, 
      IFNULL((
        SELECT IFNULL(
          IF(pin_acc = "" AND pin_dipakai = "", "WAIT", 
            IF(pin_acc = "Y" AND pin_dipakai = "", "ACC", 
              IF(pin_acc = "Y" AND pin_dipakai = "Y", "", 
                IF(pin_acc = "N", "TOLAK", "")
              )
            )
          ), ""
        ) 
        FROM tspk_pin5 
        WHERE pin_trs = "PERMINTAAN HARGA" AND pin_nomor = h.mh_nomor 
        ORDER BY pin_urut DESC LIMIT 1
      ), "") AS Ngedit 
    FROM tmintaharga h 
    LEFT JOIN tdivisi v ON v.kode = h.mh_divisi 
    LEFT JOIN tsales s ON s.sal_kode = h.mh_sal_kode 
    LEFT JOIN kalkulasi.tkalkulasi2_hdr k ON k.kal_nomor = h.mh_nomor_kalkulasi 
    WHERE h.mh_tanggal >= ? AND h.mh_tanggal <= ?
  `;

  const params = [startDate, endDate];

  // Filter Divisi ("0" di Delphi = ALL)
  if (divisiKode && divisiKode !== "0") {
    query += ` AND h.mh_divisi = ?`;
    params.push(divisiKode);
  }

  // Filter Role Base Access Data (Delphi Logic)
  const isManagerOrAdmin =
    userInfo.jabatan.includes("MANAGER-CMO-MO") ||
    userInfo.kode === "ADMIN" ||
    userInfo.bagian?.toUpperCase() === "AUDIT" ||
    userInfo.bagian?.toUpperCase() === "FINANCE" ||
    userInfo.bagian?.toUpperCase() === "MARKETING" || // <-- Tambahkan pengecualian untuk Bagian Marketing
    userInfo.jabatan?.toUpperCase() === "MARKETING" || // <-- Jaga-jaga jika tercatat di Jabatan
    userInfo.jabatan?.toUpperCase() === "MO" || // <-- Jaga-jaga jika tercatat di Jabatan
    userInfo.flags?.cmo === 1 ||
    userInfo.flags?.cmo === "1" ||
    userInfo.flags?.cmo === "Y";

  if (!isManagerOrAdmin) {
    if (userInfo.jabatan === "CRM") {
      query += ` AND (h.mh_sal_kode = "019" OR h.user_create = ?)`;
      params.push(userInfo.kode);
    } else if (userInfo.cabKaos && userInfo.cabKaos !== "KDC") {
      query += ` AND h.mh_cabkaos = ?`;
      params.push(userInfo.cabKaos);
    } else {
      query += ` AND h.user_create = ?`;
      params.push(userInfo.kode);
    }
  }

  query += ` ORDER BY h.mh_nomor DESC`; // DESC lebih user-friendly untuk web (data terbaru di atas)

  const [rows] = await db.query(query, params);
  return rows;
};

// 3. Delete Data (Delphi: cxButton4Click)
const deleteData = async (nomor) => {
  const conn = await db.getConnection();
  try {
    // A. Cek data eksis
    const [rows] = await conn.query(
      "SELECT mh_tanggal, mh_harga_kalkulasi FROM tmintaharga WHERE mh_nomor = ?",
      [nomor],
    );
    if (rows.length === 0) throw new Error("Data tidak ditemukan.");
    const data = rows[0];

    // B. Cek Closing menggunakan tutupBukuService (Konsistensi Arsitektur)
    const zdtClose = await tutupBukuService.getTanggalTutupBuku();
    const tglTransaksi = new Date(data.mh_tanggal);

    if (zdtClose && tglTransaksi < zdtClose) {
      throw new Error("Transaksi tersebut sudah close. Tidak bisa dihapus.");
    }

    // C. Cek Kalkulasi
    if (Number(data.mh_harga_kalkulasi) !== 0) {
      throw new Error(
        "Sudah ada Kalkulasi Harga. Jika ingin tetap dihapus, batalkan kalkulasi harga dulu.",
      );
    }

    // Execute Delete
    await conn.query("DELETE FROM tmintaharga WHERE mh_nomor = ?", [nomor]);
    return true;
  } finally {
    conn.release();
  }
};

// 4. Cek Status Pengajuan Edit / PIN 5 (Delphi: PengajuanPerubahanData1Click)
const checkPengajuanEdit = async (nomor) => {
  const query = `
    SELECT pin_urut, pin_alasan, pin_dipakai 
    FROM tspk_pin5 
    WHERE pin_trs = "PERMINTAAN HARGA" AND pin_nomor = ? 
    ORDER BY pin_urut DESC LIMIT 1
  `;
  const [rows] = await db.query(query, [nomor]);

  if (rows.length === 0) {
    return { urut: 1, alasan: "" };
  } else {
    const pin = rows[0];
    if (pin.pin_dipakai === "") {
      return { urut: pin.pin_urut, alasan: pin.pin_alasan };
    } else {
      return { urut: pin.pin_urut + 1, alasan: "" };
    }
  }
};

// 5. Submit Pengajuan Edit / PIN 5 (Delphi: btnAjukkanClick)
const submitPengajuanEdit = async (nomor, urut, alasan, userKode) => {
  // Ambil Tgl & Pekerjaan
  const [rows] = await db.query(
    "SELECT mh_tanggal, mh_nama FROM tmintaharga WHERE mh_nomor = ?",
    [nomor],
  );
  if (rows.length === 0) throw new Error("Data Permintaan tidak ditemukan.");
  const tglTrs = rows[0].mh_tanggal;
  const namaPek = rows[0].mh_nama;

  const query = `
    INSERT INTO tspk_pin5 (
      pin_trs, pin_nomor, pin_urut, pin_tgl_trs, pin_ket, 
      pin_tgl_minta, pin_user_minta, pin_alasan
    ) VALUES (
      "PERMINTAAN HARGA", ?, ?, ?, ?, 
      NOW(), ?, ?
    ) ON DUPLICATE KEY UPDATE 
      pin_tgl_trs = VALUES(pin_tgl_trs), 
      pin_ket = VALUES(pin_ket), 
      pin_acc = "", 
      pin_tgl_minta = NOW(), 
      pin_user_minta = VALUES(pin_user_minta), 
      pin_alasan = VALUES(pin_alasan)
  `;

  await db.query(query, [nomor, urut, tglTrs, namaPek, userKode, alasan]);
  return true;
};

/**
 * Update data Approve Gudang (Minta Bahan)
 */
const saveApproveGudang = async (nomor, capv, userKode, alasan) => {
  const query = `
    UPDATE tmintabahan_hdr 
    SET min_apv = ?, min_apvusr = ?, min_apvalasan = ? 
    WHERE min_nomor = ?
  `;
  const [result] = await db.query(query, [capv, userKode, alasan, nomor]);
  return result;
};

/**
 * Update data Approve Manager (Minta Bahan)
 */
const saveApproveManager = async (nomor, capv, userKode, alasan) => {
  const query = `
    UPDATE tmintabahan_hdr 
    SET min_apvmgr = ?, min_apvmgrusr = ?, min_apvalasanmgr = ? 
    WHERE min_nomor = ?
  `;
  const [result] = await db.query(query, [capv, userKode, alasan, nomor]);
  return result;
};

/**
 * Insert/Update Pengajuan Perubahan Data (Pin 5)
 */
const submitAjukanPerubahan = async (
  nomor,
  urut,
  tgl,
  spk,
  userKode,
  alasan,
) => {
  const query = `
    INSERT INTO tspk_pin5 (pin_trs, pin_nomor, pin_urut, pin_tgl_trs, pin_ket, pin_tgl_minta, pin_user_minta, pin_alasan) 
    VALUES ("MINTA BAHAN", ?, ?, ?, ?, NOW(), ?, ?) 
    ON DUPLICATE KEY UPDATE 
    pin_tgl_trs = ?, pin_ket = ?, pin_acc = "", pin_tgl_minta = NOW(), pin_user_minta = ?, pin_alasan = ?
  `;
  const [result] = await db.query(query, [
    nomor,
    urut,
    tgl,
    spk,
    userKode,
    alasan,
    tgl,
    spk,
    userKode,
    alasan,
  ]);
  return result;
};

/**
 * Approve Data Realisasi
 */
const saveApproveRealisasi = async (nomorRealisasi) => {
  const query = `UPDATE tproduksiminta_hdr SET promin_apv = NOW() WHERE promin_nomor = ?`;
  const [result] = await db.query(query, [nomorRealisasi]);
  return result;
};

module.exports = {
  getDivisiFilter,
  getBrowseData,
  deleteData,
  checkPengajuanEdit,
  submitPengajuanEdit,
  saveApproveGudang,
  saveApproveManager,
  submitAjukanPerubahan,
  saveApproveRealisasi,
};
