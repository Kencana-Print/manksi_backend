const db = require("../../config/database");

const getBrowse = async () => {
  const query = `
    SELECT 
      x.Kode, x.Nama, x.Satuan, x.Buffer, x.Stok, 
      IF(x.Buffer = 0, 0, IF(x.Stok < x.Buffer, x.Buffer - x.Stok, 0)) AS Safety, 
      x.Tambahan, x.Note, x.Aktif
    FROM (
      SELECT 
        b.acc_kode AS Kode, b.acc_nama AS Nama, b.acc_satuan AS Satuan,
        IFNULL((SELECT SUM(m.mst_stok_in - m.mst_stok_out) FROM tmasterstok_acc m WHERE m.mst_aktif='Y' AND m.mst_brg_kode=b.acc_kode), 0) AS Stok,
        b.acc_buffer AS Buffer, b.acc_tambahan AS Tambahan, b.acc_note AS Note, b.acc_aktif AS Aktif
      FROM taccesories b
      ORDER BY b.acc_nama ASC
    ) x
  `;
  const [rows] = await db.query(query);
  return rows;
};

const getById = async (kode) => {
  const query = `
    SELECT b.*,
      IFNULL(j.ab_nama, "") AS barang,
      IFNULL(w.aw_nama, "") AS warna,
      IFNULL(u.au_nama, "") AS ukuran,
      IFNULL(k.ak_nama, "") AS ket,
      IFNULL(p.project, "REGULER") AS project
    FROM taccesories b
    LEFT JOIN taccesories_barang j ON j.ab_kode = LEFT(b.acc_kode, 2)
    LEFT JOIN taccesories_warna w ON w.aw_kode = MID(b.acc_kode, 3, 3)
    LEFT JOIN taccesories_ukuran u ON u.au_kode = MID(b.acc_kode, 6, 3)
    LEFT JOIN taccesories_ket k ON k.ak_kode = MID(b.acc_kode, 9, 2)
    LEFT JOIN tbahan_project p ON p.kode = RIGHT(b.acc_kode, 1)
    WHERE b.acc_kode = ?
  `;
  const [rows] = await db.query(query, [kode]);
  return rows[0];
};

const create = async (data, user) => {
  // Jahit kode persis seperti di Garmen Barang
  const p = data.project === "REGULER" ? "" : data.project.substring(0, 1);
  const generatedKode = (
    data.kdBarang +
    data.kdWarna +
    data.kdUkuran +
    data.kdKet +
    p
  ).toUpperCase();

  // Cek Duplikat
  const [exist] = await db.query(
    "SELECT acc_kode FROM taccesories WHERE acc_kode = ?",
    [generatedKode],
  );
  if (exist.length > 0)
    throw new Error("Master Accesories yang akan Anda buat sudah ada.");

  const query = `
    INSERT INTO taccesories 
    (acc_kode, acc_nama, acc_satuan, acc_tambahan, acc_note, acc_buffer, acc_aktif, user_create, date_create)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())
  `;
  await db.query(query, [
    generatedKode,
    data.acc_nama,
    data.acc_satuan,
    data.acc_tambahan || "N",
    data.acc_note || "",
    data.acc_buffer || 0,
    data.acc_aktif || "Y",
    user,
  ]);

  return generatedKode;
};

const update = async (kode, data, user) => {
  const query = `
    UPDATE taccesories SET 
      acc_nama = ?, acc_satuan = ?, acc_tambahan = ?, acc_note = ?, acc_buffer = ?, acc_aktif = ?, 
      user_modified = ?, date_modified = NOW()
    WHERE acc_kode = ?
  `;
  await db.query(query, [
    data.acc_nama,
    data.acc_satuan,
    data.acc_tambahan || "N",
    data.acc_note || "",
    data.acc_buffer || 0,
    data.acc_aktif || "Y",
    user,
    kode,
  ]);
};

// Tidak ada remove() karena di referensi Delphi tidak ada tombol hapus

module.exports = { getBrowse, getById, create, update };
