const pool = require("../config/database");
const jwt = require("jsonwebtoken");
const { getIzinRole } = require("./rbacService");

// Gudang default per cabang + divisi (logika Delphi). Dipakai saat login
// dan saat ganti cabang.
const hitungGudang = (userCab, divisi) => {
  const gudang = {
    jadi: { kode: "", nama: "" },
    bahan: { kode: "", nama: "" },
  };

  if (divisi === 1 || divisi === 5) {
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
  return gudang;
};

// Cabang awal dan daftar cabang yang boleh dipilih (trbac_user_cabang).
// Belum ada barisnya -> pakai kolom tuser seperti sebelumnya (kosong = HO-).
const ambilCabangUser = async (user) => {
  const [rows] = await pool.query(
    `SELECT uc_cabang AS cabang, uc_divisi AS divisi
     FROM trbac_user_cabang
     WHERE uc_user_kode = ?
     ORDER BY uc_utama DESC, uc_cabang`,
    [user.user_kode],
  );
  if (rows.length === 0) {
    const cab =
      user.user_cab && user.user_cab.trim() !== ""
        ? user.user_cab.trim()
        : "HO-";
    return { daftar: [], awal: { cabang: cab, divisi: user.user_divisi } };
  }
  return { daftar: rows, awal: rows[0] };
};

const bangunPayload = (user, cabang, divisi) => ({
  kode: user.user_kode,
  nama: user.user_nama,
  cabang,
  cabangKaos: user.user_cabkaos,
  divisi,
  bagian: user.user_bagian,
  jabatan: user.user_jabat,
  gudang: hitungGudang(cabang, divisi),
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
});

// Nama lengkap dari HRD (hanya untuk tampilan). Gagal / NIK kosong /
// karyawan tidak ditemukan -> pakai user_nama, tidak pernah melempar error.
const ambilNamaLengkap = async (user) => {
  if (!user.user_nik || user.user_nik.trim() === "") return user.user_nama;
  try {
    const [hrdRows] = await pool.query(
      `SELECT kar_nama FROM hrd2.tkaryawan
       WHERE kar_Nik = ? AND kar_status_aktif = 1 LIMIT 1`,
      [user.user_nik.trim()],
    );
    const nama = hrdRows[0]?.kar_nama?.trim();
    return nama ? nama : user.user_nama;
  } catch (err) {
    console.error("Gagal ambil nama dari HRD:", err.message);
    return user.user_nama;
  }
};

// Bagian dan jabatan menurut HRD (hanya untuk tampilan footer). Logika akses
// tetap memakai user.user_bagian. Gagal / NIK kosong -> objek kosong.
const ambilInfoHrd = async (user) => {
  if (!user.user_nik || user.user_nik.trim() === "") return {};
  try {
    const [hrdRows] = await pool.query(
      `SELECT kar_bagian, kar_jab_kode FROM hrd2.tkaryawan
       WHERE kar_Nik = ? AND kar_status_aktif = 1 LIMIT 1`,
      [user.user_nik.trim()],
    );
    if (hrdRows.length === 0) return {};
    return {
      bagianHrd: (hrdRows[0].kar_bagian || "").trim(),
      jabatanHrd: (hrdRows[0].kar_jab_kode || "").trim(),
    };
  } catch (err) {
    console.error("Gagal ambil bagian dari HRD:", err.message);
    return {};
  }
};

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

  // Cabang awal + divisi: dari trbac_user_cabang bila sudah ada barisnya,
  // kalau belum dari kolom tuser (kosong = HO- seperti Delphi)
  const cabangUser = await ambilCabangUser(user);
  const userCab = cabangUser.awal.cabang;

  // 5. AMBIL HAK AKSES USER DARI thakuser
  const [permissionRows] = await pool.query(
    `SELECT 
      hak_men_id AS id, 
      hak_men_view AS view, 
      hak_men_insert AS \`insert\`, 
      hak_men_edit AS edit, 
      hak_men_delete AS \`delete\`,
      hak_men_save AS save
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
    save: row.save === "Y",
  }));

  // Hak tambahan dari role (HRD): digabung ke daftar hak yang dikirim ke
  // frontend, sehingga can() dan navbar tidak perlu diubah.
  try {
    const izinRole = await getIzinRole(user.user_kode, userCab);
    const petaHak = new Map(permissions.map((p) => [p.id, p]));
    for (const kode of izinRole) {
      const [idStr, aksi] = kode.split(".");
      const id = Number(idStr);
      let p = petaHak.get(id);
      if (!p) {
        p = {
          id,
          view: false,
          insert: false,
          edit: false,
          delete: false,
          save: false,
        };
        petaHak.set(id, p);
        permissions.push(p);
      }
      p[aksi] = true;
    }
  } catch (err) {
    console.error("[rbac] hak role gagal digabung saat login:", err.message);
  }

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
  // ⬅ BARU: GA, TEKNISI, IT tidak butuh notifikasi SPK dateline — bukan
  // bagian yang menangani produksi/deadline SPK sama sekali.
  const EXCLUDED_SPK_URGENT_BAGIAN = [
    "GA",
    "TEKNISI",
    "IT",
    "FINANCE",
    "PEMBELIAN",
  ];
  const isMarketing = user.user_bagian.toUpperCase() === "MARKETING";
  let spkUrgent = [];
  if (!EXCLUDED_SPK_URGENT_BAGIAN.includes(user.user_bagian.toUpperCase())) {
    const spkQuery = `
      SELECT s.spk_nomor AS Spk, s.spk_nama AS Nama, 
             ${isMarketing ? "c.Cus_nama AS Customer," : ""}
             DATE_FORMAT(s.spk_tanggal, "%d-%m-%Y") AS Tanggal, 
             DATE_FORMAT(s.spk_dateline, "%d-%m-%Y") AS Dateline,
             s.spk_jumlah AS QtyOrder, s.spk_jumlah_jadi AS QtyJadi,
             s.spk_jumlah_kirim AS QtyKirim,
             s.spk_divisi AS Divisi, s.spk_cab AS Cab, s.spk_workshop AS Workshop
      FROM tspk s
      LEFT JOIN tcustomer c ON c.Cus_kode = s.spk_cus_kode
      WHERE s.spk_aktif = "Y" AND s.spk_close = 0 
      AND s.spk_cus_kode IN (SELECT cus_kode FROM tcustomer WHERE cus_keramat = "Y")
      AND s.spk_tanggal >= "2024-01-01"
      AND IFNULL(s.spk_jumlah_kirim, 0) < s.spk_jumlah
      AND DATEDIFF(s.spk_dateline, CURDATE()) <= 3
      ORDER BY s.spk_tanggal DESC
    `;
    const [rows] = await pool.query(spkQuery);
    spkUrgent = rows;
  }

  // 7b. Data BAP baru untuk AUDIT (belum direview)
  let bapBaruAudit = [];
  if (user.user_bagian.toUpperCase() === "AUDIT") {
    const [bapRows] = await pool.query(
      `SELECT
         h.bap_nomor AS Nomor,
         DATE_FORMAT(h.bap_tanggal, "%d-%m-%Y") AS Tanggal,
         h.bap_tipe AS Tipe,
         h.bap_bagnama AS BagNama,
         h.bap_masalah AS Masalah,
         h.bap_cab AS Cab
       FROM tkpi_bapproduksi h
       WHERE IFNULL(h.bap_review_audit, 'N') <> 'Y'
       ORDER BY h.bap_tanggal DESC, h.bap_nomor DESC
       LIMIT 50`,
    );
    bapBaruAudit = bapRows;
  }

  // 7c. Data BAP yang sudah direview AUDIT, belum dibaca pembuatnya
  const [bapReviewedRows] = await pool.query(
    `SELECT
       h.bap_nomor AS Nomor,
       DATE_FORMAT(h.bap_tanggal, "%d-%m-%Y") AS Tanggal,
       h.bap_tipe AS Tipe,
       h.bap_bagnama AS BagNama,
       h.bap_masalah AS Masalah,
       h.bap_review_audit_catatan AS Catatan,
       h.bap_review_audit_by AS ReviewedBy,
       DATE_FORMAT(h.bap_review_audit_tgl, "%d-%m-%Y") AS ReviewedTgl
     FROM tkpi_bapproduksi h
     WHERE h.bap_review_audit = 'Y'
       AND IFNULL(h.bap_review_audit_dibaca, 'N') <> 'Y'
       AND h.user_create = ?
     ORDER BY h.bap_review_audit_tgl DESC
     LIMIT 50`,
    [user.user_kode],
  );
  const bapReviewedNotif = bapReviewedRows;

  // 7d. Data Pra Order PENDING konfirmasi PPIC (belum ditindaklanjuti)
  // Exclude divisi SPANDUK/MMT — sama seperti getBrowse di
  // konfirmasiPraOrderService.js, karena divisi itu bypass alur cek
  // PPIC sama sekali (lihat isDivisiTanpaCekPpic di praOrderFormService).
  let praOrderPendingPpic = [];
  if (user.user_bagian.toUpperCase() === "PPIC") {
    const [rows] = await pool.query(
      `SELECT
         h.pro_nomor AS Nomor,
         h.pro_nama_pekerjaan AS NamaPekerjaan,
         h.pro_cus_kode AS CusKode,
         h.pro_cus_nama AS Customer,
         DATE_FORMAT(h.pro_tanggal, "%d-%m-%Y") AS Tanggal,
         DATE_FORMAT(h.pro_tgl_kirim, "%d-%m-%Y") AS TglKirim,
         v.Divisi AS Divisi
       FROM tpraorder_hdr h
       LEFT JOIN tdivisi v ON v.kode = h.pro_divisi
       WHERE h.pro_status_ppic = 'PENDING'
         AND UPPER(IFNULL(v.Divisi, '')) NOT IN ('SPANDUK', 'MMT')
       ORDER BY h.pro_tanggal ASC, h.pro_nomor ASC
       LIMIT 50`,
    );
    praOrderPendingPpic = rows;
  }

  // 8. Update tuser_lastupdate
  await pool.query(
    `INSERT INTO pengaturan.tuser_lastupdate (computer, app, versi, usr, date_update) 
     VALUES (?, 'WEB-MANKSI', '1.0.0', ?, NOW()) 
     ON DUPLICATE KEY UPDATE app='WEB-MANKSI', usr = VALUES(usr), date_update = NOW()`,
    ["WEB-BROWSER", user.user_kode],
  );

  const namaLengkap = await ambilNamaLengkap(user);

  const infoHrd = await ambilInfoHrd(user);

  // 9. Generate Payload & Token
  const payload = bangunPayload(user, userCab, cabangUser.awal.divisi);

  const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: "12h" });

  return {
    token,
    user: { ...payload, namaLengkap, ...infoHrd },
    permissions,
    isDefaultPassword:
      password === "123" || username.toUpperCase() === password.toUpperCase(),
    specialMessage,
    spkUrgent,
    bapBaruAudit,
    bapReviewedNotif,
    praOrderPendingPpic,
    cabangBoleh: cabangUser.daftar.map((c) => c.cabang),
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
    `UPDATE tuser SET user_password = ? WHERE UPPER(user_kode) = UPPER(?)`,
    [newPassword, userKode],
  );

  return true;
};

// Ganti cabang aktif: token baru, tanpa menulis tuser.user_cab (kolom itu masih
// dibaca Delphi dan sesi lain). Cabang harus ada di trbac_user_cabang user.
const gantiCabang = async (userKode, cabangBaru) => {
  const [rows] = await pool.query(
    `SELECT * FROM tuser WHERE user_kode = ? AND user_aktif = 0`,
    [userKode],
  );
  if (rows.length === 0)
    throw new Error("User tidak ditemukan atau sudah pasif.");
  const user = rows[0];

  const [cab] = await pool.query(
    `SELECT uc_cabang AS cabang, uc_divisi AS divisi
     FROM trbac_user_cabang
     WHERE uc_user_kode = ? AND uc_cabang = ?`,
    [userKode, cabangBaru],
  );
  if (cab.length === 0)
    throw new Error("Cabang tidak diizinkan untuk user ini.");

  const payload = bangunPayload(user, cab[0].cabang, cab[0].divisi);
  const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: "12h" });

  return {
    token,
    user: {
      ...payload,
      namaLengkap: await ambilNamaLengkap(user),
      ...(await ambilInfoHrd(user)),
    },
    message: "Cabang berhasil diganti",
  };
};

module.exports = { loginUser, changePassword, gantiCabang };
