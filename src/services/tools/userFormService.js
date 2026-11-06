const db = require("../../config/database");
const rbacService = require("../rbacService");
const { buangCacheAkun } = require("../../middleware/authMiddleware");

// ============================================================
// USER FORM SERVICE — Master User (create/edit + hak akses menu)
// Migrasi dari ufrmUser.pas. Catatan penting:
//
// 1. user_aktif DIBALIK (dipertahankan apa adanya):
//      0 = AKTIF, 1 = PASIF
//    Service ini expose boolean `aktif` yang sudah dinormalisasi
//    (true = aktif); konversi ke 0/1 dilakukan di sini saja.
//
// 2. user_divisi: 0 Pusat, 1 Spanduk, 4 Garmen, 5 MMT. Nilainya mengikuti
//    divisi cabang utama; divisi per cabang disimpan di trbac_user_cabang.
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
    nik: String(row.user_nik || "").trim(),
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

// ── HRD (hrd2.tkaryawan): hanya kolom yang dibutuhkan, tanpa data pribadi ──
const bentukHrd = (r) => ({
  nik: String(r.kar_Nik || "").trim(),
  nama: r.kar_nama || "",
  pabrik: r.kar_pab_kode || "",
  departemen: r.kar_dep_kode || "",
  jabatan: r.kar_jab_kode || "",
  bagian: r.kar_bagian || "",
  aktif: Number(r.kar_status_aktif) === 1,
});

// Cabang MANKSI yang berpadanan dengan pabrik HRD (trbac_cabang.cab_pab_kode)
const tambahCabangHrd = async (daftar) => {
  const pabrik = [...new Set(daftar.map((h) => h.pabrik).filter(Boolean))];
  if (pabrik.length === 0) return daftar.map((h) => ({ ...h, cabangHrd: [] }));
  const [rows] = await db.query(
    `SELECT cab_pab_kode AS pabrik, cab_kode AS cabang
       FROM trbac_cabang
      WHERE cab_aktif = 1 AND cab_pab_kode IN (?)
      ORDER BY cab_kode`,
    [pabrik],
  );
  const peta = new Map();
  for (const r of rows) {
    peta.set(r.pabrik, [...(peta.get(r.pabrik) || []), r.cabang]);
  }
  return daftar.map((h) => ({ ...h, cabangHrd: peta.get(h.pabrik) || [] }));
};

const getHrdByNik = async (nik) => {
  const kunci = String(nik || "").trim();
  if (!kunci) return null;
  const [rows] = await db.query(
    `SELECT kar_Nik, kar_nama, kar_pab_kode, kar_dep_kode, kar_jab_kode,
            kar_bagian, kar_status_aktif
       FROM hrd2.tkaryawan WHERE kar_Nik = ?`,
    [kunci],
  );
  if (rows.length === 0) return null;
  return (await tambahCabangHrd([bentukHrd(rows[0])]))[0];
};

// Karyawan aktif saja. Akun MANKSI yang sudah memakai NIK ikut ditampilkan
// (akun alias orang yang sama sah memakai NIK yang sama). Penggabungan
// dilakukan di kode, bukan JOIN lintas schema, supaya bebas error collation.
const searchHrdKaryawan = async (q = "") => {
  const kata = String(q).trim();
  if (kata.length < 2) return [];
  const [rows] = await db.query(
    `SELECT kar_Nik, kar_nama, kar_pab_kode, kar_dep_kode, kar_jab_kode,
            kar_bagian, kar_status_aktif
       FROM hrd2.tkaryawan
      WHERE kar_status_aktif = 1 AND (kar_Nik LIKE ? OR kar_nama LIKE ?)
      ORDER BY kar_nama LIMIT 50`,
    [`%${kata}%`, `%${kata}%`],
  );
  const hasil = await tambahCabangHrd(rows.map(bentukHrd));
  if (hasil.length === 0) return hasil;

  const [akun] = await db.query(
    `SELECT user_kode, user_nik FROM tuser WHERE user_nik IN (?)`,
    [hasil.map((h) => h.nik)],
  );
  const peta = new Map();
  for (const a of akun) {
    const k = String(a.user_nik || "").trim();
    peta.set(k, [...(peta.get(k) || []), a.user_kode]);
  }
  return hasil.map((h) => ({
    ...h,
    userKode: (peta.get(h.nik) || []).join(", "),
  }));
};

const getCabangUser = async (kode) => {
  const [rows] = await db.query(
    `SELECT uc_cabang AS cabang, uc_divisi AS divisi, uc_utama AS utama
       FROM trbac_user_cabang WHERE uc_user_kode = ?
      ORDER BY uc_utama DESC, uc_cabang`,
    [kode],
  );
  return rows.map((r) => ({
    cabang: r.cabang,
    divisi: Number(r.divisi) || 0,
    utama: Number(r.utama) === 1,
  }));
};

// --- GET FORM INIT — mode Baru (kode=null) maupun Ubah ---
const getFormData = async (kode) => {
  let header = {
    kode: "",
    nik: "",
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
  const cabangList = isEdit ? await getCabangUser(kode) : [];
  const hrd = isEdit ? await getHrdByNik(header.nik) : null;
  return { header, menu, isEdit, cabangList, hrd };
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
    nik,
    password,
    aktif,
    bagian,
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

  // Daftar cabang user. Form lama hanya mengirim satu cabang + divisi.
  const adaDaftar =
    Array.isArray(payload.cabangList) && payload.cabangList.length > 0;
  const mentah = adaDaftar
    ? payload.cabangList
    : [{ cabang: payload.cabang, divisi: payload.divisi, utama: true }];
  const daftarCab = mentah.map((c) => ({
    cabang: String(c.cabang || "").trim(),
    divisi: Number(c.divisi),
    utama: !!c.utama,
  }));

  if (daftarCab.some((c) => !c.cabang)) {
    throw new Error("Cabang wajib diisi (setiap user harus punya cabang).");
  }
  if (daftarCab.some((c) => ![0, 1, 4, 5].includes(c.divisi))) {
    throw new Error(
      "Kantor/Divisi tidak valid (harus Pusat/Spanduk/Garmen/MMT).",
    );
  }
  if (daftarCab.filter((c) => c.utama).length !== 1) {
    throw new Error("Harus ada tepat satu cabang utama.");
  }

  // Semua cabang harus terdaftar di trbac_cabang
  const [cabOk] = await db.query(
    `SELECT cab_kode FROM trbac_cabang WHERE cab_aktif = 1 AND cab_kode IN (?)`,
    [daftarCab.map((c) => c.cabang)],
  );
  const bentukBaku = new Map(
    cabOk.map((r) => [String(r.cab_kode).toUpperCase(), r.cab_kode]),
  );
  for (const c of daftarCab) {
    const baku = bentukBaku.get(c.cabang.toUpperCase());
    if (!baku) {
      throw new Error(`Cabang "${c.cabang}" tidak terdaftar di trbac_cabang.`);
    }
    c.cabang = baku; // bentuk baku (huruf besar/kecil)
  }
  if (new Set(daftarCab.map((c) => c.cabang)).size !== daftarCab.length) {
    throw new Error("Cabang tidak boleh dobel.");
  }

  const utamaCab = daftarCab.find((c) => c.utama);
  const cab = utamaCab.cabang;
  const divisiNum = utamaCab.divisi; // tuser.user_divisi mengikuti cabang utama

  // NIK HRD: opsional, tetapi bila diisi harus ada di HRD.
  // undefined = form lama, NIK yang tersimpan tidak diubah.
  const nikBaru = nik === undefined ? undefined : String(nik || "").trim();
  if (nikBaru && !(await getHrdByNik(nikBaru))) {
    throw new Error(`NIK ${nikBaru} tidak ditemukan di data HRD.`);
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
          user_nik = IFNULL(?, user_nik),
          date_modify = NOW()
        WHERE user_kode = ?`,
        [
          nama,
          password || "",
          divisiNum,
          bagian || "",
          cab,
          cabangKaos || "",
          aktif ? 0 : 1,
          editReport ? 1 : 0,
          lihatBeli ? 1 : 0,
          lihatHarga ? 1 : 0,
          lihatCustomer ? 1 : 0,
          lihatSupplier ? 1 : 0,
          nikBaru === undefined ? null : nikBaru,
          kode,
        ],
      );
    } else {
      if (exists) {
        throw new Error(
          `Kode user "${kode}" sudah digunakan. Gunakan mode Ubah atau pilih kode lain.`,
        );
      }
      await conn.query(
        `INSERT INTO tuser
          (user_kode, user_nama, user_divisi, user_bagian, user_cab, user_cabkaos,
            date_create, user_password, user_aktif, user_edit_report, user_lihat_beli,
            user_lihat_harga, user_lihat_cus, user_lihat_sup, user_nik)
        VALUES (?, ?, ?, ?, ?, ?, NOW(), ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          kode,
          nama,
          divisiNum,
          bagian || "",
          cab,
          cabangKaos || "",
          password || "",
          aktif ? 0 : 1,
          editReport ? 1 : 0,
          lihatBeli ? 1 : 0,
          lihatHarga ? 1 : 0,
          lihatCustomer ? 1 : 0,
          lihatSupplier ? 1 : 0,
          nikBaru ?? "",
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

    // Samakan trbac_user_cabang dengan daftar dari form (login membaca tabel ini).
    // Form lama (tanpa cabangList) tidak menghapus cabang lain.
    if (adaDaftar) {
      await conn.query(
        `DELETE FROM trbac_user_cabang
          WHERE uc_user_kode = ? AND uc_cabang NOT IN (?)`,
        [kode, daftarCab.map((c) => c.cabang)],
      );
    }
    await conn.query(
      `UPDATE trbac_user_cabang SET uc_utama = 0 WHERE uc_user_kode = ?`,
      [kode],
    );
    for (const c of daftarCab) {
      await conn.query(
        `INSERT INTO trbac_user_cabang (uc_user_kode, uc_cabang, uc_divisi, uc_utama)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE uc_divisi = VALUES(uc_divisi), uc_utama = VALUES(uc_utama)`,
        [kode, c.cabang, c.divisi, c.utama ? 1 : 0],
      );
    }

    // Samakan tabel RBAC dengan thakuser untuk user ini (mode bayangan).
    // Gagal tidak membatalkan penyimpanan legacy; lihat log server.
    await rbacService.sinkronHakLegacy(conn, kode, bagian || "");

    await conn.commit();
    // Buang cache izin dan cache akun aktif; ?. supaya aman bila fungsinya belum diekspor
    rbacService.buangCache?.(kode);
    buangCacheAkun?.(kode);
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

// ============================================================
// MASTER ROLE: hak tambahan per role (role ditetapkan dari HRD)
// ============================================================
const AKSI_ROLE = ["view", "insert", "edit", "delete", "save"];
const KOLOM_HAK = {
  view: "hak_men_view",
  insert: "hak_men_insert",
  edit: "hak_men_edit",
  delete: "hak_men_delete",
  save: "hak_men_save",
};

// Himpunan "menId.aksi" dari grid yang dikirim form
const kunciDariGrid = (menu) => {
  const hasil = new Set();
  for (const m of menu || []) {
    for (const a of AKSI_ROLE) if (m[a]) hasil.add(`${m.menId}.${a}`);
  }
  return hasil;
};

// Izin menu sebuah role dalam bentuk "menId.aksi" (izin non-menu diabaikan)
const kunciRole = async (executor, roleKode) => {
  const [rows] = await executor.query(
    `SELECT p.perm_men_id AS menId, p.perm_aksi AS aksi
       FROM trbac_role_permission rp
       JOIN trbac_permission p ON p.perm_kode = rp.perm_kode
      WHERE rp.role_kode = ? AND p.perm_men_id IS NOT NULL`,
    [roleKode],
  );
  return new Set(rows.map((r) => `${r.menId}.${r.aksi}`));
};

const getRoleAnggota = async (roleKode) => {
  const [rows] = await db.query(
    `SELECT u.user_kode AS kode, u.user_nama AS nama,
            MIN(ur.ur_sumber) AS sumber, u.user_bagian AS bagian
       FROM trbac_user_role ur
       JOIN tuser u ON u.user_kode = ur.ur_user_kode AND u.user_aktif = 0
      WHERE ur.ur_role_kode = ?
      GROUP BY u.user_kode, u.user_nama, u.user_bagian
      ORDER BY u.user_kode`,
    [roleKode],
  );
  return rows;
};

const getRoleList = async () => {
  const [rows] = await db.query(
    `SELECT r.role_kode AS kode, r.role_nama AS nama,
            r.role_keterangan AS keterangan, r.role_sumber AS sumber,
            r.role_aktif AS aktif,
            (SELECT COUNT(DISTINCT ur.ur_user_kode)
               FROM trbac_user_role ur
               JOIN tuser u ON u.user_kode = ur.ur_user_kode AND u.user_aktif = 0
              WHERE ur.ur_role_kode = r.role_kode) AS anggota,
            (SELECT COUNT(*) FROM trbac_role_permission rp
              WHERE rp.role_kode = r.role_kode) AS jmlPerm
       FROM trbac_role r
      ORDER BY r.role_kode`,
  );
  return rows.map((r) => ({
    ...r,
    aktif: Number(r.aktif) === 1,
    anggota: Number(r.anggota),
    jmlPerm: Number(r.jmlPerm),
  }));
};

const getRole = async (kode) => {
  const [rows] = await db.query(
    `SELECT role_kode, role_nama, role_keterangan, role_sumber, role_aktif
       FROM trbac_role WHERE role_kode = ?`,
    [kode],
  );
  if (rows.length === 0) throw new Error("Role tidak ditemukan.");
  const role = rows[0];

  const [punya, menuList, anggota] = await Promise.all([
    kunciRole(db, kode),
    getMenuList(),
    getRoleAnggota(kode),
  ]);

  // Berapa anggota yang sekarang memegang tiap menu/aksi (dari thakuser)
  const dimiliki = new Map();
  if (anggota.length > 0) {
    const [cacah] = await db.query(
      `SELECT hak_men_id AS menId,
              SUM(hak_men_view = 'Y') AS v, SUM(hak_men_insert = 'Y') AS i,
              SUM(hak_men_edit = 'Y') AS e, SUM(hak_men_delete = 'Y') AS d,
              SUM(hak_men_save = 'Y') AS s
         FROM thakuser
        WHERE hak_user_kode IN (?)
        GROUP BY hak_men_id`,
      [anggota.map((a) => a.kode)],
    );
    for (const c of cacah) {
      dimiliki.set(c.menId, {
        view: Number(c.v),
        insert: Number(c.i),
        edit: Number(c.e),
        delete: Number(c.d),
        save: Number(c.s),
      });
    }
  }
  const kosong = { view: 0, insert: 0, edit: 0, delete: 0, save: 0 };

  return {
    kode: role.role_kode,
    nama: role.role_nama,
    keterangan: role.role_keterangan,
    sumber: role.role_sumber,
    aktif: Number(role.role_aktif) === 1,
    jmlAnggota: anggota.length,
    menu: menuList.map((m) => ({
      menId: m.men_id,
      menUrut: m.men_urut,
      keterangan: m.men_keterangan,
      namaMenu: m.men_menu,
      view: punya.has(`${m.men_id}.view`),
      insert: punya.has(`${m.men_id}.insert`),
      edit: punya.has(`${m.men_id}.edit`),
      delete: punya.has(`${m.men_id}.delete`),
      save: punya.has(`${m.men_id}.save`),
      dimiliki: dimiliki.get(m.men_id) || kosong,
    })),
  };
};

// Dampak perubahan terhadap anggota aktif: berapa user mendapat akses baru
// (permission yang belum ada di thakuser-nya) atau kehilangan akses.
const pratinjauRole = async (kode, payload) => {
  const { menu, aktif } = payload || {};
  const lama = await kunciRole(db, kode);
  const baru = aktif === false ? new Set() : kunciDariGrid(menu);
  const tambah = [...baru].filter((k) => !lama.has(k));
  const cabut = [...lama].filter((k) => !baru.has(k));
  const anggota = await getRoleAnggota(kode);

  const hasil = {
    tambah: tambah.length,
    cabut: cabut.length,
    anggota: anggota.length,
    totalUserBertambah: 0,
    totalUserBerkurang: 0,
    userBertambah: [],
    userBerkurang: [],
  };
  if (anggota.length === 0 || (tambah.length === 0 && cabut.length === 0)) {
    return hasil;
  }

  const [hak] = await db.query(
    `SELECT hak_user_kode AS kode, hak_men_id AS menId, hak_men_view,
            hak_men_insert, hak_men_edit, hak_men_delete, hak_men_save
       FROM thakuser WHERE hak_user_kode IN (?)`,
    [anggota.map((a) => a.kode)],
  );
  const punyaUser = new Map();
  for (const h of hak) {
    const kunci = String(h.kode).toUpperCase();
    if (!punyaUser.has(kunci)) punyaUser.set(kunci, new Set());
    for (const a of AKSI_ROLE) {
      if (h[KOLOM_HAK[a]] === "Y") punyaUser.get(kunci).add(`${h.menId}.${a}`);
    }
  }

  for (const a of anggota) {
    const milik = punyaUser.get(String(a.kode).toUpperCase()) || new Set();
    const bertambah = tambah.filter((k) => !milik.has(k)).length;
    const berkurang = cabut.filter((k) => !milik.has(k)).length;
    if (bertambah > 0) {
      hasil.userBertambah.push({ kode: a.kode, nama: a.nama, jml: bertambah });
    }
    if (berkurang > 0) {
      hasil.userBerkurang.push({ kode: a.kode, nama: a.nama, jml: berkurang });
    }
  }
  hasil.totalUserBertambah = hasil.userBertambah.length;
  hasil.totalUserBerkurang = hasil.userBerkurang.length;
  hasil.userBertambah.sort((x, y) => y.jml - x.jml);
  hasil.userBerkurang.sort((x, y) => y.jml - x.jml);
  hasil.userBertambah = hasil.userBertambah.slice(0, 30);
  hasil.userBerkurang = hasil.userBerkurang.slice(0, 30);
  return hasil;
};

// Menu yang belum punya permission di katalog dibuatkan (5 aksi per menu)
const sinkronKatalogMenu = async (conn) => {
  const [r] = await conn.query(
    `INSERT INTO trbac_permission (perm_kode, perm_modul, perm_nama, perm_men_id, perm_aksi)
     SELECT CONCAT('m', m.men_id, '.', a.aksi), '',
            LEFT(CONCAT(m.men_keterangan, ' - ', a.aksi), 150), m.men_id, a.aksi
       FROM tmenu m
       JOIN (SELECT 'view' AS aksi UNION ALL SELECT 'insert' UNION ALL
             SELECT 'edit' UNION ALL SELECT 'delete' UNION ALL SELECT 'save') a
      WHERE m.men_modul = 1
        AND NOT EXISTS (SELECT 1 FROM trbac_permission p
                         WHERE p.perm_men_id = m.men_id AND p.perm_aksi = a.aksi)`,
  );
  return r.affectedRows;
};

const saveRole = async (kode, payload) => {
  const { nama, keterangan, aktif, menu } = payload || {};
  if (!String(nama || "").trim()) throw new Error("Nama role wajib diisi.");

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [ada] = await conn.query(
      `SELECT role_kode FROM trbac_role WHERE role_kode = ? FOR UPDATE`,
      [kode],
    );
    if (ada.length === 0) throw new Error("Role tidak ditemukan.");

    await conn.query(
      `UPDATE trbac_role
          SET role_nama = ?, role_keterangan = ?, role_aktif = ?
        WHERE role_kode = ?`,
      [
        String(nama).trim().slice(0, 100),
        String(keterangan || "").slice(0, 255),
        aktif ? 1 : 0,
        kode,
      ],
    );

    await sinkronKatalogMenu(conn);
    const [katalog] = await conn.query(
      `SELECT perm_kode, perm_men_id, perm_aksi
         FROM trbac_permission
        WHERE perm_aktif = 1 AND perm_men_id IS NOT NULL`,
    );
    const peta = new Map(
      katalog.map((p) => [`${p.perm_men_id}.${p.perm_aksi}`, p.perm_kode]),
    );
    const baris = [];
    for (const k of kunciDariGrid(menu)) {
      const permKode = peta.get(k);
      if (permKode) baris.push([kode, permKode]);
    }

    // Hanya izin menu yang diganti; izin non-menu di role dibiarkan
    await conn.query(
      `DELETE rp FROM trbac_role_permission rp
         JOIN trbac_permission p ON p.perm_kode = rp.perm_kode
        WHERE rp.role_kode = ? AND p.perm_men_id IS NOT NULL`,
      [kode],
    );
    if (baris.length > 0) {
      await conn.query(
        `INSERT INTO trbac_role_permission (role_kode, perm_kode) VALUES ?`,
        [baris],
      );
    }

    const [anggota] = await conn.query(
      `SELECT DISTINCT ur_user_kode AS kode FROM trbac_user_role WHERE ur_role_kode = ?`,
      [kode],
    );
    if (anggota.length > 0) {
      await conn.query(
        `UPDATE tuser SET user_versi_izin = user_versi_izin + 1 WHERE user_kode IN (?)`,
        [anggota.map((a) => a.kode)],
      );
    }

    await conn.commit();
    for (const a of anggota) rbacService.buangCache?.(a.kode);
    return { kode, jmlPerm: baris.length };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
};

module.exports = {
  getFormData,
  checkKodeExists,
  searchActiveUsers,
  getPermissionsForCopy,
  getHrdByNik,
  searchHrdKaryawan,
  saveUser,
  deleteUser,
  getRoleList,
  getRole,
  getRoleAnggota,
  pratinjauRole,
  saveRole,
};
