const pool = require("../config/database");
const jwt = require("jsonwebtoken");

const loginUser = async (username, password) => {
  // 1. Query user (Case Sensitive password dengan BINARY)
  const [rows] = await pool.query(
    `SELECT * FROM tuser WHERE UPPER(user_kode) = UPPER(?) AND BINARY user_password = ?`,
    [username, password],
  );

  if (rows.length === 0) throw new Error("User atau password salah.");

  const user = rows[0];

  // 2. Cek user aktif
  if (user.user_aktif !== 0) throw new Error("User sudah pasif.");

  // 3. Validasi Divisi (Bagian)
  if (!user.user_bagian || user.user_bagian.trim() === "") {
    throw new Error("Divisi anda belum disetting.");
  }

  // Definisikan Cabang (Seperti Delphi: if Trim(user_cab)='' then zcab:='HO-')
  const userCab =
    user.user_cab && user.user_cab.trim() !== "" ? user.user_cab.trim() : "HO-";

  // 4. Logika Gudang (PERBAIKAN LOGIKA DELPHI)
  let gudang = { jadi: { kode: "", nama: "" }, bahan: { kode: "", nama: "" } };

  if (user.user_divisi === 1) {
    if (userCab === "P02") {
      gudang.jadi = { kode: "WH002", nama: "GUDANG JADI P2" };
      gudang.bahan = { kode: "WH006", nama: "GUDANG BAHAN BAKU P2" };
    } else {
      // Menangkap kondisi MMT sesuai Delphi
      gudang.jadi = { kode: "WH-010", nama: "GUDANG JADI MMT" };
      gudang.bahan = { kode: "WH-16", nama: "GUDANG UTAMA MMT" };
    }
  } else {
    if (userCab === "P01") {
      gudang.jadi = { kode: "GJ002", nama: "GUDANG BARANG JADI P1" };
    } else {
      gudang.jadi = { kode: "GJ001", nama: "GUDANG BARANG JADI JERON" };
    }
    gudang.bahan = { kode: "GB001", nama: "GUDANG BAHAN BAKU JERON" };
  }

  // 5. AMBIL HAK AKSES USER DARI thakuser
  const [permissionRows] = await pool.query(
    `SELECT 
      hak_men_id AS id, 
      hak_men_view AS view, 
      hak_men_insert AS \`insert\`, 
      hak_men_edit AS edit, 
      hak_men_delete AS \`delete\` 
     FROM thakuser 
     WHERE hak_user_kode = ?`,
    [user.user_kode],
  );

  const permissions = permissionRows.map((row) => ({
    id: row.id,
    view: row.view === "Y",
    insert: row.insert === "Y",
    edit: row.edit === "Y",
    delete: row.delete === "Y",
  }));

  // 6. Cek Pesan Khusus User ERNA
  let specialMessage = null;
  if (user.user_kode.toUpperCase() === "ERNA") {
    const [statusKain] = await pool.query(
      "SELECT DATEDIFF(CURDATE(), tgl) as lama, sts FROM kalkulasi.thargakain_status",
    );
    if (statusKain.length > 0) {
      const isMonday = new Date().getDay() === 1;
      if (isMonday || statusKain[0].lama > 7) {
        if (statusKain[0].sts === "N") {
          specialMessage = isMonday
            ? `Mbak ${user.user_kode}, ini hari senin. Jangan lupa update harga beli kain di KALKULASI ya...`
            : `Mbak ${user.user_kode}, lebih dari 7 hari harga beli kain di KALKULASI tidak diupdate.`;
        }
      } else {
        await pool.query('UPDATE kalkulasi.thargakain_status SET sts = "N"');
      }
    }
  }

  // 7. Data SPK Urgent
  const isMarketing = user.user_bagian.toUpperCase() === "MARKETING";
  const spkQuery = `
    SELECT s.spk_nomor AS Spk, s.spk_nama AS Nama, 
           ${isMarketing ? "c.Cus_nama AS Customer," : ""}
           DATE_FORMAT(s.spk_tanggal, "%d-%m-%Y") AS Tanggal, 
           DATE_FORMAT(s.spk_dateline, "%d-%m-%Y") AS Dateline,
           s.spk_jumlah AS QtyOrder, s.spk_jumlah_jadi AS QtyJadi,
           s.spk_jumlah_kirim AS QtyKirim, -- Tambahkan ini sesuai query Delphi
           s.spk_divisi AS Divisi, s.spk_cab AS Cab, s.spk_workshop AS Workshop
    FROM tspk s
    LEFT JOIN tcustomer c ON c.Cus_kode = s.spk_cus_kode
    WHERE s.spk_aktif = "Y" AND s.spk_close = 0 
    AND s.spk_cus_kode IN (SELECT cus_kode FROM tcustomer WHERE cus_keramat = "Y")
    AND s.spk_tanggal >= "2024-01-01"
    AND DATEDIFF(s.spk_dateline, CURDATE()) <= 3
    ORDER BY s.spk_tanggal DESC
  `;
  const [spkUrgent] = await pool.query(spkQuery);

  // 8. Update tuser_lastupdate
  await pool.query(
    `INSERT INTO pengaturan.tuser_lastupdate (computer, app, versi, usr, date_update) 
     VALUES (?, 'WEB-MANKSI', '1.0.0', ?, NOW()) 
     ON DUPLICATE KEY UPDATE app='WEB-MANKSI', usr = VALUES(usr), date_update = NOW()`,
    ["WEB-BROWSER", user.user_kode],
  );

  // 9. Generate Payload & Token (PERBAIKAN FLAGS)
  const payload = {
    kode: user.user_kode,
    nama: user.user_nama,
    cabang: userCab,
    cabangKaos: user.user_cabkaos,
    divisi: user.user_divisi,
    bagian: user.user_bagian,
    jabatan: user.user_jabat,
    gudang: gudang,
    flags: {
      editReport: user.user_edit_report,
      lihatBeli: user.user_lihat_beli,
      lihatHarga: user.user_lihat_harga,
      lihatSup: user.user_lihat_sup,
      lihatCus: user.user_lihat_cus,
      cmo: user.user_cmo, 
      cmo3: user.user_cmo3, 
      isManager: user.user_manager,
      accKor: user.user_acckor,
    },
  };

  const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: "12h" });

  return {
    token,
    user: payload,
    permissions,
    isDefaultPassword:
      password === "123" || username.toUpperCase() === password.toUpperCase(),
    specialMessage,
    spkUrgent,
    message: "Login Berhasil",
  };
};

const changePassword = async (userKode, oldPassword, newPassword) => {
  // 1. Verifikasi password lama sesuai logika Delphi (Case Sensitive dengan BINARY)
  const [rows] = await pool.query(
    `SELECT user_kode FROM tuser WHERE UPPER(user_kode) = UPPER(?) AND BINARY user_password = ?`,
    [userKode, oldPassword],
  );

  if (rows.length === 0) {
    throw new Error("Password lama salah.");
  }

  // 2. Eksekusi update password baru
  await pool.query(
    `UPDATE tuser SET user_password = ?, date_modified = NOW(), user_modified = ? WHERE UPPER(user_kode) = UPPER(?)`,
    [newPassword, userKode, userKode],
  );

  return true;
};

module.exports = { loginUser, changePassword };
