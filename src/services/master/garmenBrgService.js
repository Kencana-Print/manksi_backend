const db = require("../../config/database");

const getBrowse = async (jenis, cabang, bagian) => {
  const validJenis = ["ACCESORIES", "OBAT", "SPAREPART", "ATK/RTK"];
  const selectedJenis = validJenis.includes(jenis) ? jenis : "ACCESORIES";

  let selectNote = "";
  let stokQuery = "";
  let whereClause = `WHERE b.brg_jenis = '${selectedJenis}'`;

  if (selectedJenis === "ACCESORIES") {
    selectNote = "x.Note,";
    stokQuery = `IFNULL((SELECT SUM(m.mst_stok_in - m.mst_stok_out) FROM tmasterstok_acc m WHERE m.mst_aktif="Y" AND m.mst_brg_kode=b.brg_kode AND m.mst_cab=?), 0) AS Stok`;
  } else if (selectedJenis === "OBAT") {
    stokQuery = `IFNULL((SELECT SUM(m.mst_stok_in - m.mst_stok_out) FROM tmasterstok_obat m WHERE m.mst_aktif="Y" AND m.mst_brg_kode=b.brg_kode AND m.mst_cab=?), 0) AS Stok`;
  } else if (selectedJenis === "SPAREPART") {
    stokQuery = `IFNULL((SELECT SUM(m.mst_stok_in - m.mst_stok_out) FROM tmasterstok_sparepart m WHERE m.mst_aktif="Y" AND m.mst_brg_kode=b.brg_kode AND m.mst_cab=?), 0) AS Stok`;
    if (bagian === "TEKNISI") whereClause += ` AND b.brg_ktg <> 'IT'`;
    else if (bagian === "IT") whereClause += ` AND b.brg_ktg = 'IT'`;
  } else if (selectedJenis === "ATK/RTK") {
    stokQuery = `IFNULL((SELECT SUM(m.mst_stok_in - m.mst_stok_out) FROM tmasterstok_atk m WHERE m.mst_aktif="Y" AND m.mst_brg_kode=b.brg_kode AND m.mst_cab=?), 0) AS Stok`;
  }

  const query = `
    SELECT 
      x.Jenis, x.Kategori, x.Kode, x.Nama, x.Satuan, 
      ${selectNote}
      x.Buffer, x.Stok, 
      IF(x.Buffer = 0, 0, IF(x.Stok < x.Buffer, x.Buffer - x.Stok, 0)) AS Safety, 
      x.Aktif
    FROM (
      SELECT 
        b.brg_jenis AS Jenis, b.brg_ktg AS Kategori, b.brg_kode AS Kode, 
        b.brg_nama AS Nama, b.brg_satuan AS Satuan, b.brg_buffer AS Buffer, 
        b.brg_note AS Note, b.brg_aktif AS Aktif,
        ${stokQuery}
      FROM tgarmen_brg b
      ${whereClause}
      ORDER BY b.brg_nama ASC
    ) x
  `;
  const [rows] = await db.query(query, [cabang]);
  return rows;
};

const getById = async (kode) => {
  const query = `
    SELECT b.*, 
      IFNULL(j.ab_nama, "") as nmBarang, 
      IFNULL(w.aw_nama, "") as nmWarna, 
      IFNULL(u.au_nama, "") as nmUkuran, 
      IFNULL(k.ak_nama, "") as nmKet, 
      IFNULL(p.project, "REGULER") as project
    FROM tgarmen_brg b
    LEFT JOIN taccesories_barang j ON j.ab_kode = LEFT(b.brg_kode, 2)
    LEFT JOIN taccesories_warna w ON w.aw_kode = MID(b.brg_kode, 3, 3)
    LEFT JOIN taccesories_ukuran u ON u.au_kode = MID(b.brg_kode, 6, 3)
    LEFT JOIN taccesories_ket k ON k.ak_kode = MID(b.brg_kode, 9, 2)
    LEFT JOIN tbahan_project p ON p.kode = RIGHT(b.brg_kode, 1)
    WHERE b.brg_kode = ?
  `;
  const [rows] = await db.query(query, [kode]);
  return rows[0];
};

// --- LOGIKA PEMBENTUKAN KODE OTOMATIS (Migrasi Delphi getmaxnomor) ---
const generateKode = async (jenis, kategori, accKodeAssembled) => {
  if (jenis === "ACCESORIES") return accKodeAssembled; // Hasil jahitan 5 kode dari frontend

  const date = new Date();
  const yy = date.getFullYear().toString().slice(-2);

  if (jenis === "OBAT") {
    let prefix = kategori === "GARMEN" ? "G" : kategori === "MMT" ? "M" : "D";
    const [[row]] = await db.query(
      `SELECT IFNULL(MAX(RIGHT(brg_kode, 3)), 0) AS max_val FROM tgarmen_brg WHERE brg_jenis="OBAT" AND LEFT(brg_kode, 1) = ?`,
      [prefix],
    );
    const nextNum = parseInt(row.max_val, 10) + 1;
    return prefix + String(nextNum).padStart(3, "0"); // ex: G001
  }

  if (jenis === "SPAREPART") {
    let prefix =
      kategori === "MESIN"
        ? "MS"
        : kategori === "NONMESIN"
          ? "NM"
          : kategori === "LISTRIK"
            ? "LT"
            : kategori === "OIL"
              ? "OL"
              : "IT";
    const searchPrefix = prefix + yy;
    const [[row]] = await db.query(
      `SELECT IFNULL(MAX(RIGHT(brg_kode, 4)), 0) AS max_val FROM tgarmen_brg WHERE brg_jenis="SPAREPART" AND LEFT(brg_kode, 4) = ?`,
      [searchPrefix],
    );
    const nextNum = parseInt(row.max_val, 10) + 1;
    return searchPrefix + String(nextNum).padStart(4, "0"); // ex: MS260001
  }

  if (jenis === "ATK/RTK") {
    const searchPrefix = "AK" + yy;
    const [[row]] = await db.query(
      `SELECT IFNULL(MAX(RIGHT(brg_kode, 4)), 0) AS max_val FROM tgarmen_brg WHERE brg_jenis="ATK/RTK" AND LEFT(brg_kode, 4) = ?`,
      [searchPrefix],
    );
    const nextNum = parseInt(row.max_val, 10) + 1;
    return searchPrefix + String(nextNum).padStart(4, "0"); // ex: AK260001
  }

  return null;
};

const create = async (data, user) => {
  const generatedKode = await generateKode(
    data.brg_jenis,
    data.brg_ktg,
    data.accKodeAssembled,
  );

  if (data.brg_jenis === "ACCESORIES") {
    const [exist] = await db.query(
      "SELECT brg_kode FROM tgarmen_brg WHERE brg_kode = ?",
      [generatedKode],
    );
    if (exist.length > 0)
      throw new Error("Master Accesories yang akan dibuat sudah ada.");
  }

  const query = `
    INSERT INTO tgarmen_brg 
    (brg_jenis, brg_kode, brg_ktg, brg_nama, brg_satuan, brg_note, brg_buffer, brg_aktif, user_create, date_create)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
  `;
  await db.query(query, [
    data.brg_jenis,
    generatedKode,
    data.brg_ktg || "",
    data.brg_nama,
    data.brg_satuan,
    data.brg_note || "",
    data.brg_buffer || 0,
    data.brg_aktif || "Y",
    user,
  ]);
  return generatedKode;
};

const update = async (kode, data, user) => {
  const query = `
    UPDATE tgarmen_brg SET 
      brg_nama = ?, brg_satuan = ?, brg_note = ?, brg_buffer = ?, brg_aktif = ?, 
      user_modified = ?, date_modified = NOW()
    WHERE brg_kode = ?
  `;
  await db.query(query, [
    data.brg_nama,
    data.brg_satuan,
    data.brg_note || "",
    data.brg_buffer || 0,
    data.brg_aktif || "Y",
    user,
    kode,
  ]);
};

const remove = async (kode) => {
  await db.query("DELETE FROM tgarmen_brg WHERE brg_kode = ?", [kode]);
};

// Fungsi Lookups untuk dropdown form (Sesuai F1 dan FormCreate Delphi)
const getLookups = async (category) => {
  switch (category) {
    case "cabang":
      return (
        await db.query(
          "SELECT pab_kode AS Kode, pab_nama AS Nama FROM tpabrik ORDER BY pab_kode ASC",
        )
      )[0];
    case "acc_barang":
      return (
        await db.query(
          "SELECT ab_kode AS Kode, ab_nama AS Nama FROM taccesories_barang ORDER BY ab_kode ASC",
        )
      )[0];
    case "acc_warna":
      return (
        await db.query(
          "SELECT aw_kode AS Kode, aw_nama AS Nama FROM taccesories_warna ORDER BY aw_kode ASC",
        )
      )[0];
    case "acc_ukuran":
      return (
        await db.query(
          "SELECT au_kode AS Kode, au_nama AS Nama FROM taccesories_ukuran ORDER BY au_kode ASC",
        )
      )[0];
    case "acc_ket":
      return (
        await db.query(
          "SELECT ak_kode AS Kode, ak_nama AS Nama FROM taccesories_ket ORDER BY ak_kode ASC",
        )
      )[0];
    case "project":
      return (
        await db.query(
          "SELECT kode AS Kode, project AS Nama FROM tbahan_project ORDER BY kode ASC",
        )
      )[0];

    // Satuan spesifik
    case "satuan_acc":
      return (
        await db.query(
          "SELECT satuan AS Nama FROM taccesories_satuan ORDER BY satuan ASC",
        )
      )[0];
    case "satuan_obat":
      return (
        await db.query(
          "SELECT os_satuan AS Nama FROM tobat_satuan ORDER BY os_satuan ASC",
        )
      )[0];
    case "satuan_sparepart":
      return (
        await db.query(
          "SELECT ss_satuan AS Nama FROM tsparepart_satuan ORDER BY ss_satuan ASC",
        )
      )[0];
    case "satuan_atk":
      return (
        await db.query(
          "SELECT as_satuan AS Nama FROM tatk_satuan ORDER BY as_satuan ASC",
        )
      )[0];

    default:
      return [];
  }
};

module.exports = { getBrowse, getById, create, update, remove, getLookups };
