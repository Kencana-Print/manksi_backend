const db = require("../../config/database");

// ============================================================
// USER FORM SERVICE — Master User (create/edit + hak akses menu)
// Migrasi dari ufrmUser.pas. Catatan penting:
//
// 1. user_aktif DIBALIK (dipertahankan apa adanya):
//      0 = AKTIF, 1 = PASIF
//    Service ini expose boolean `aktif` yang sudah dinormalisasi
//    (true = aktif); konversi ke 0/1 dilakukan di sini saja.
//
// 2. user_divisi: 0 Pusat, 1 Spanduk, 4 Garmen — hanya 3 opsi ini
//    yang valid (sesuai radio button Delphi).
//
// 3. Daftar menu = GABUNGAN 2 query, urutan dipertahankan persis:
//      a. tmenu WHERE men_urut<>0 AND men_modul=1 ORDER BY men_urut
//      b. tmenu WHERE men_urut=0  AND men_modul=1 ORDER BY men_id
//    (a) di atas, (b) di bawah.
//
// 4. thakuser: SELALU delete-then-insert per user (bukan update
//    per baris). Baris HANYA disimpan jika View/Insert/Edit/Delete
//    = Y. PENTING: "Save" SENDIRIAN tanpa satupun dari 4 lainnya
//    TIDAK memicu insert — quirk asli Delphi (kondisi if di
//    simpandetailuser tidak menyertakan kolom Save), dipertahankan
//    1:1 sesuai instruksi migrasi.
//
// 5. Fitur "Cek All" adalah logika UI berbasis POSISI BARIS grid
//    (bukan men_id): baris ke-1 & ke-2 selalu View=Y saat dicentang;
//    baris dengan men_id>10 dapat semua 5 kolom=Y; uncheck = reset
//    semua ke N tanpa syarat. Ini state client-side murni (belum
//    disimpan sampai klik Simpan) — diimplementasikan di frontend.
// ============================================================

const mapUserRow = (row) => {
  if (!row) return null;
  return {
    kode: row.user_kode,
    nama: row.user_nama,
    password: row.user_password || "", // TODO: masih plaintext, sama seperti Delphi
    divisi: Number(row.user_divisi) || 0,
    bagian: row.user_bagian || "",
    cabang: row.user_cab || "",
    cabangKaos: row.user_cabkaos || "",
    aktif: Number(row.user_aktif) !== 1, // 0/NULL => aktif, 1 => pasif
    editReport: Number(row.user_edit_report) === 1,
    lihatBeli: Number(row.user_lihat_beli) === 1,
    lihatHarga: Number(row.user_lihat_harga) === 1,
    lihatCustomer: Number(row.user_lihat_cus) === 1,
    lihatSupplier: Number(row.user_lihat_sup) === 1,
  };
};

const getMenuList = async () => {
  const [group1] = await db.query(
    `SELECT men_id, men_urut, men_keterangan, men_menu
     FROM tmenu WHERE men_urut <> 0 AND men_modul = 1
     ORDER BY men_urut`,
  );
  const [group2] = await db.query(
    `SELECT men_id, men_urut, men_keterangan, men_menu
     FROM tmenu WHERE men_urut = 0 AND men_modul = 1
     ORDER BY men_id`,
  );
  return [...group1, ...group2];
};

// Menu yang belum pernah dikonfigurasi hak aksesnya oleh siapapun —
// untuk highlight "Menu Baru" di form.
const getConfiguredMenuIds = async () => {
  const [rows] = await db.query(`SELECT DISTINCT hak_men_id FROM thakuser`);
  return new Set(rows.map((r) => String(r.hak_men_id)));
};

const getPermissionMap = async (userKode) => {
  const [rows] = await db.query(
    `SELECT hak_men_id, hak_men_view, hak_men_insert, hak_men_edit,
            hak_men_delete, hak_men_save
     FROM thakuser WHERE hak_user_kode = ?`,
    [userKode],
  );
  const map = {};
  for (const r of rows) {
    map[String(r.hak_men_id)] = {
      view: r.hak_men_view === "Y",
      insert: r.hak_men_insert === "Y",
      edit: r.hak_men_edit === "Y",
      delete: r.hak_men_delete === "Y",
      save: r.hak_men_save === "Y",
    };
  }
  return map;
};

const buildMenuGrid = async (userKode = null) => {
  const [menuList, configuredIds, permMap] = await Promise.all([
    getMenuList(),
    getConfiguredMenuIds(),
    userKode ? getPermissionMap(userKode) : Promise.resolve({}),
  ]);

  return menuList.map((m) => {
    const key = String(m.men_id);
    const perm = permMap[key] || {
      view: false,
      insert: false,
      edit: false,
      delete: false,
      save: false,
    };
    return {
      menId: m.men_id,
      menUrut: m.men_urut,
      keterangan: m.men_keterangan,
      namaMenu: m.men_menu,
      isNewMenu: !configuredIds.has(key),
      ...perm,
    };
  });
};

// --- GET FORM INIT — mode Baru (kode=null) maupun Ubah ---
const getFormData = async (kode) => {
  let header = {
    kode: "",
    nama: "",
    password: "",
    divisi: 0,
    bagian: "",
    cabang: "",
    cabangKaos: "",
    aktif: true, // default Delphi: refreshdata -> ckaktif.Checked=true
    editReport: false,
    lihatBeli: false,
    lihatHarga: false,
    lihatCustomer: false,
    lihatSupplier: false,
  };
  let isEdit = false;

  if (kode) {
    const [rows] = await db.query(`SELECT * FROM tuser WHERE user_kode = ?`, [
      kode,
    ]);
    if (rows.length > 0) {
      header = mapUserRow(rows[0]);
      isEdit = true;
    }
  }

  const menu = await buildMenuGrid(isEdit ? kode : null);
  return { header, menu, isEdit };
};

const checkKodeExists = async (kode) => {
  const [rows] = await db.query(
    `SELECT user_kode FROM tuser WHERE user_kode = ?`,
    [kode],
  );
  return rows.length > 0;
};

// F1 lookup Delphi — user AKTIF saja (user_aktif=0)
const searchActiveUsers = async (q = "") => {
  let sql = `SELECT user_kode AS Kode, user_nama AS Nama
             FROM tuser WHERE user_aktif = 0`;
  const params = [];
  if (q) {
    sql += ` AND (user_kode LIKE ? OR user_nama LIKE ?)`;
    params.push(`%${q}%`, `%${q}%`);
  }
  sql += ` ORDER BY user_nama`;
  const [rows] = await db.query(sql, params);
  return rows;
};

// Fetch-only untuk fitur "Copy dari User" — FE yang menerapkan ke grid
// form yang sedang dibuka, baru persist saat user klik Simpan.
const getPermissionsForCopy = async (sourceKode) => {
  const exists = await checkKodeExists(sourceKode);
  if (!exists) throw new Error("User sumber tidak ditemukan.");
  return getPermissionMap(sourceKode);
};

const saveUser = async (payload, isEdit) => {
  const {
    kode,
    nama,
    password,
    divisi,
    aktif,
    bagian,
    cabang,
    cabangKaos,
    editReport,
    lihatBeli,
    lihatHarga,
    lihatCustomer,
    lihatSupplier,
    menu,
  } = payload;

  if (!kode || !String(kode).trim()) {
    throw new Error("Kode Kosong, tidak dapat disimpan");
  }

  const divisiNum = Number(divisi);
  if (![0, 1, 4].includes(divisiNum)) {
    throw new Error("Kantor/Divisi tidak valid (harus Pusat/Spanduk/Garmen).");
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const exists = await checkKodeExists(kode);

    if (isEdit) {
      if (!exists) throw new Error("Data user tidak ditemukan untuk diubah.");
      await conn.query(
        `UPDATE tuser SET
          user_nama = ?, user_password = ?, user_divisi = ?,
          user_bagian = ?, user_cab = ?, user_cabkaos = ?,
          user_aktif = ?, user_edit_report = ?, user_lihat_beli = ?,
          user_lihat_harga = ?, user_lihat_cus = ?, user_lihat_sup = ?,
          date_modify = NOW()
        WHERE user_kode = ?`,
        [
          nama,
          password || "",
          divisiNum,
          bagian || "",
          cabang || "",
          cabangKaos || "",
          aktif ? 0 : 1,
          editReport ? 1 : 0,
          lihatBeli ? 1 : 0,
          lihatHarga ? 1 : 0,
          lihatCustomer ? 1 : 0,
          lihatSupplier ? 1 : 0,
          kode,
        ],
      );
    } else {
      // Cek duplikat kode — TIDAK ada di Delphi (di sana mode create/
      // update ditentukan otomatis via edtKodeExit), tapi diperlukan di
      // web karena mode create/edit ditentukan eksplisit dari FE.
      if (exists) {
        throw new Error(
          `Kode user "${kode}" sudah digunakan. Gunakan mode Ubah atau pilih kode lain.`,
        );
      }
      await conn.query(
        `INSERT INTO tuser
          (user_kode, user_nama, user_divisi, user_bagian, user_cab, user_cabkaos,
            date_create, user_password, user_aktif, user_edit_report, user_lihat_beli,
            user_lihat_harga, user_lihat_cus, user_lihat_sup)
        VALUES (?, ?, ?, ?, ?, ?, NOW(), ?, ?, ?, ?, ?, ?, ?)`,
        [
          kode,
          nama,
          divisiNum,
          bagian || "",
          cabang || "",
          cabangKaos || "",
          password || "",
          aktif ? 0 : 1,
          editReport ? 1 : 0,
          lihatBeli ? 1 : 0,
          lihatHarga ? 1 : 0,
          lihatCustomer ? 1 : 0,
          lihatSupplier ? 1 : 0,
        ],
      );
    }

    // Replace total thakuser — persis simpandetailuser
    await conn.query(`DELETE FROM thakuser WHERE hak_user_kode = ?`, [kode]);

    const rowsToInsert = (menu || []).filter(
      (m) => m.view || m.insert || m.edit || m.delete,
      // "save" sengaja TIDAK ikut syarat — lihat catatan #4 di atas.
    );

    if (rowsToInsert.length > 0) {
      const vals = rowsToInsert.map((m) => [
        kode,
        m.menId,
        m.view ? "Y" : "N",
        m.insert ? "Y" : "N",
        m.edit ? "Y" : "N",
        m.delete ? "Y" : "N",
        m.save ? "Y" : "N",
      ]);
      await conn.query(
        `INSERT INTO thakuser
           (hak_user_kode, hak_men_id, hak_men_view, hak_men_insert,
            hak_men_edit, hak_men_delete, hak_men_save)
         VALUES ?`,
        [vals],
      );
    }

    await conn.commit();
    return { kode };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
};

// Persis hapusdata Delphi — hanya hapus tuser, TIDAK membersihkan
// thakuser terkait (jadi orphan, sama seperti aslinya).
const deleteUser = async (kode) => {
  const exists = await checkKodeExists(kode);
  if (!exists) throw new Error("Data user tidak ditemukan.");
  await db.query(`DELETE FROM tuser WHERE user_kode = ?`, [kode]);
};

module.exports = {
  getFormData,
  checkKodeExists,
  searchActiveUsers,
  getPermissionsForCopy,
  saveUser,
  deleteUser,
};
