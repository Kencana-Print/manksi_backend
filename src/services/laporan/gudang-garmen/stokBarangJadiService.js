const db = require("../../../config/database");

const getBrowse = async (gudang = "") => {
  let where = `WHERE b.brg_divisi IN (3,4,6)`;
  const params = [];
  if (gudang) {
    where += ` AND m.vgdg LIKE ?`;
    params.push(`%${gudang}%`);
  }

  const sql = `
    SELECT x.*, c.Cus_nama AS Customer, c.Cus_alamat AS Alamat
    FROM (
      SELECT
        b.brg_kode AS Kode,
        DATE_FORMAT(s.spk_Tanggal, '%d-%m-%Y') AS Tanggal,
        b.brg_name AS Nama,
        b.brg_ukuran AS Ukuran,
        b.brg_kain AS Kain,
        b.brg_finishing AS Finishing,
        SUM(m.vstok) AS Stok,
        g.gdg_nama AS Gudang,
        IFNULL(s.spk_cus_kode, o.mspk_cus_kode) AS Kodecus
      FROM tbarang b
      INNER JOIN vmasterstok_jadi m ON m.vkode = b.brg_kode
      LEFT JOIN tspk s ON s.SPK_Nomor = b.Brg_kode
      LEFT JOIN tgudang g ON g.gdg_kode = m.vgdg
      LEFT JOIN tmemospk o ON o.mSPK_Nomor = b.Brg_kode
      ${where}
      GROUP BY b.brg_kode, m.vgdg
    ) x
    LEFT JOIN tcustomer c ON c.Cus_kode = x.Kodecus
    ORDER BY x.Nama
  `;

  const [rows] = await db.query(sql, params);
  return rows;
};

const getExportData = async (gudang = "") => {
  const sql = `
    SELECT
      x.Gudang,
      x.Kode,
      x.Nama,
      x.Ukuran,
      x.Kain,
      x.Finishing,
      x.Stok,
      x.Kodecus,
      c.Cus_nama AS Customer,
      c.Cus_alamat AS Alamat
    FROM (
      SELECT
        ? AS Gudang,
        b.brg_kode AS Kode,
        b.brg_name AS Nama,
        b.brg_ukuran AS Ukuran,
        b.brg_kain AS Kain,
        b.brg_finishing AS Finishing,
        SUM(m.vstok) AS Stok,
        IFNULL(s.spk_cus_kode, o.mspk_cus_kode) AS Kodecus
      FROM tbarang b
      INNER JOIN vmasterstok_jadi m ON m.vkode = b.brg_kode
      LEFT JOIN tspk s ON s.SPK_Nomor = b.Brg_kode
      LEFT JOIN tmemospk o ON o.mSPK_Nomor = b.Brg_kode
      WHERE m.vgdg LIKE ?
      GROUP BY b.brg_kode
    ) x
    LEFT JOIN tcustomer c ON c.Cus_kode = x.Kodecus
    ORDER BY x.Nama
  `;

  const gudangLabel = gudang ? gudang : "All";
  const [rows] = await db.query(sql, [gudangLabel, `%${gudang}%`]);
  return rows;
};

module.exports = {
  getBrowse,
  getExportData,
};
