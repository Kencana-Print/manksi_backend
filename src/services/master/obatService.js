const db = require("../../config/database");

const getBrowse = async () => {
  const query = `
    SELECT 
      x.Kode, x.Nama, x.Satuan, x.Supplier, x.Harga, x.Buffer, x.Stok, 
      IF(x.Buffer = 0, 0, IF(x.Stok < x.Buffer, x.Buffer - x.Stok, 0)) AS Safety, 
      x.Aktif
    FROM (
      SELECT 
        o_kode AS Kode, o_nama AS Nama, o_satuan AS Satuan, o_sup AS Supplier, 
        o_harga AS Harga, o_buffer AS Buffer,
        IFNULL((SELECT SUM(m.mst_stok_in - m.mst_stok_out) FROM tmasterstok_obat m WHERE m.mst_aktif='Y' AND m.mst_brg_kode=o_kode), 0) AS Stok,
        o_aktif AS Aktif
      FROM tobat
      ORDER BY o_kode ASC
    ) x
  `;
  const [rows] = await db.query(query);
  return rows;
};

const getById = async (kode) => {
  const query = "SELECT * FROM tobat WHERE o_kode = ?";
  const [rows] = await db.query(query, [kode]);
  return rows[0];
};

const generateKode = async (kategori) => {
  let prefix = kategori === "GARMEN" ? "G" : kategori === "MMT" ? "M" : "D";

  const query =
    "SELECT IFNULL(MAX(RIGHT(o_kode, 3)), 0) AS max_val FROM tobat WHERE LEFT(o_kode, 1) = ?";
  const [[row]] = await db.query(query, [prefix]);

  const nextNum = parseInt(row.max_val, 10) + 1;
  return prefix + String(nextNum).padStart(3, "0"); // Misal: G001
};

const create = async (data) => {
  // Cek duplikat nama
  const [exist] = await db.query("SELECT o_kode FROM tobat WHERE o_nama = ?", [
    data.Nama,
  ]);
  if (exist.length > 0) throw new Error("Jenis Obat ini sudah dibuat.");

  const generatedKode = await generateKode(data.Kategori);

  const query = `
    INSERT INTO tobat 
    (o_kode, o_nama, o_sup, o_harga, o_buffer, o_satuan, o_aktif) 
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `;

  await db.query(query, [
    generatedKode,
    data.Nama.trim(),
    data.Supplier || "",
    data.Harga || 0,
    data.Buffer || 0,
    data.Satuan,
    data.Aktif || "Y",
  ]);

  return generatedKode;
};

const update = async (kode, data) => {
  const query = `
    UPDATE tobat SET 
      o_nama = ?, o_satuan = ?, o_sup = ?, o_harga = ?, o_buffer = ?, o_aktif = ? 
    WHERE o_kode = ?
  `;

  await db.query(query, [
    data.Nama.trim(),
    data.Satuan,
    data.Supplier || "",
    data.Harga || 0,
    data.Buffer || 0,
    data.Aktif || "Y",
    kode,
  ]);
};

// --- Fungsi untuk Dropdown/Lookup ---
const getLookups = async (category) => {
  if (category === "satuan") {
    const [rows] = await db.query(
      "SELECT os_satuan AS Nama FROM tobat_satuan ORDER BY os_satuan ASC",
    );
    return rows;
  } else if (category === "supplier") {
    // Ambil supplier unik dari tobat
    const [rows] = await db.query(
      "SELECT DISTINCT(o_sup) AS Nama FROM tobat WHERE o_sup != '' ORDER BY o_sup ASC",
    );
    return rows;
  }
  return [];
};

module.exports = { getBrowse, getById, create, update, getLookups };
