const db = require("../../config/database"); // Sesuaikan path

const getBrowse = async () => {
  // Hanya ada satu baris data di tabel tstandar_output
  const query =
    "SELECT Potong, Cetak, Bordir, Hotpres, QcCetak AS QcCetak, DC, Jahit, Lipat FROM tstandar_output LIMIT 1";
  const [rows] = await db.query(query);
  return rows;
};

// Karena hanya ada satu baris, kita tidak perlu ID spesifik untuk Update
const update = async (data) => {
  const query = `
    UPDATE tstandar_output SET 
      potong = ?, 
      cetak = ?, 
      bordir = ?, 
      hotpres = ?, 
      qccetak = ?, 
      dc = ?, 
      jahit = ?, 
      lipat = ?
  `;

  await db.query(query, [
    Number(data.Potong) || 0,
    Number(data.Cetak) || 0,
    Number(data.Bordir) || 0,
    Number(data.Hotpres) || 0,
    Number(data.QcCetak) || 0,
    Number(data.DC) || 0,
    Number(data.Jahit) || 0,
    Number(data.Lipat) || 0,
  ]);
};

module.exports = { getBrowse, update };
