const db = require("../../config/database");

// Browse Master User: identitas diambil dari HRD (hrd2.tkaryawan) lewat NIK;
// akun tanpa NIK atau NIK yang tidak ada di HRD memakai data tuser (DariHrd = false).
const getBrowse = async () => {
  const [rows] = await db.query(`
    SELECT u.user_kode AS Kode,
           u.user_nama AS NamaUser,
           u.user_cab AS CabUser,
           u.user_bagian AS BagianUser,
           u.user_nik AS Nik,
           u.user_tipe_akun AS Tipe,
           IF(u.user_aktif = 0, 'YA', 'TIDAK') AS Aktif,
           k.kar_Nik AS KarNik,
           k.kar_nama AS KarNama,
           k.kar_dep_kode AS Dep,
           k.kar_jab_kode AS Jab,
           k.kar_bagian AS BagianHrd,
           k.kar_pab_kode AS Pabrik,
           k.kar_status_aktif AS StatusHrd,
           (SELECT uc.uc_cabang FROM trbac_user_cabang uc
             WHERE uc.uc_user_kode = u.user_kode
             ORDER BY uc.uc_utama DESC, uc.uc_cabang LIMIT 1) AS CabUtama,
           (SELECT COUNT(*) FROM trbac_user_cabang uc2
             WHERE uc2.uc_user_kode = u.user_kode) AS JmlCabang,
           (SELECT GROUP_CONCAT(ur.ur_role_kode ORDER BY ur.ur_role_kode SEPARATOR ', ')
              FROM trbac_user_role ur
             WHERE ur.ur_user_kode = u.user_kode) AS Role
      FROM tuser u
      LEFT JOIN hrd2.tkaryawan k
        ON u.user_nik <> '' AND BINARY TRIM(k.kar_Nik) = BINARY TRIM(u.user_nik)
  `);

  // Padanan pabrik HRD ke cabang, dan daftar cabang tiap user
  const [padanan] = await db.query(
    `SELECT cab_pab_kode AS pabrik, cab_kode AS cabang
       FROM trbac_cabang
      WHERE cab_aktif = 1 AND cab_pab_kode IS NOT NULL AND cab_pab_kode <> ''`,
  );
  const cabangPerPabrik = new Map();
  for (const p of padanan) {
    cabangPerPabrik.set(p.pabrik, [
      ...(cabangPerPabrik.get(p.pabrik) || []),
      p.cabang,
    ]);
  }
  const [ucRows] = await db.query(
    `SELECT uc_user_kode AS kode, uc_cabang AS cabang FROM trbac_user_cabang`,
  );
  const cabangUser = new Map();
  for (const r of ucRows) {
    const k = String(r.kode).toUpperCase();
    cabangUser.set(k, [...(cabangUser.get(k) || []), r.cabang]);
  }

  return rows
    .map((r) => {
      const dariHrd = !!r.KarNik;
      return {
        Kode: r.Kode,
        Nama:
          dariHrd && String(r.KarNama || "").trim()
            ? r.KarNama.trim()
            : r.NamaUser,
        Nik: r.Nik || "",
        DepJab: dariHrd ? [r.Dep, r.Jab].filter(Boolean).join("/") : "",
        Bagian:
          dariHrd && String(r.BagianHrd || "").trim()
            ? r.BagianHrd
            : r.BagianUser,
        Pabrik: dariHrd ? r.Pabrik || "" : "",
        Cabang:
          r.CabUtama ||
          (r.CabUser && r.CabUser.trim() !== "" ? r.CabUser.trim() : "HO-"),
        JmlCabang: Number(r.JmlCabang) || 0,
        CabangHrd: dariHrd
          ? (cabangPerPabrik.get(r.Pabrik) || []).join(", ")
          : "",
        CabangSesuai: (() => {
          if (!dariHrd) return true;
          const hrd = cabangPerPabrik.get(r.Pabrik) || [];
          if (hrd.length === 0) return true; // pabrik tanpa padanan: tidak dinilai
          const milik = cabangUser.get(String(r.Kode).toUpperCase()) || [];
          return milik.some((c) => hrd.includes(c));
        })(),
        Role: r.Role || "",
        Aktif: r.Aktif,
        Tipe: r.Tipe || "PRIBADI",
        DariHrd: dariHrd,
        KeluarHrd: dariHrd && Number(r.StatusHrd) !== 1,
      };
    })
    .sort((a, b) => String(a.Nama).localeCompare(String(b.Nama)));
};

// --- GET BY ID (Persiapan untuk form ubah) ---
const getById = async (kode) => {
  const query = `SELECT * FROM tuser WHERE user_kode = ?`;
  const [rows] = await db.query(query, [kode]);
  return rows.length > 0 ? rows[0] : null;
};

// Persiapan untuk Insert/Update (akan didetailkan di form)
const save = async (data, isNewMode) => {
  // Logic save / update tuser dan thakuser akan ditaruh di sini nanti
};

module.exports = {
  getBrowse,
  getById,
  save,
};
