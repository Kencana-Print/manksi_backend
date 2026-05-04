const db = require("../../config/database");

const getBrowse = async () => {
  const query = `
    SELECT 
      sup_kode AS Kode, sup_nama AS Nama, sup_alamat AS Alamat, sup_kota AS Kota, 
      sup_fax AS Fax, sup_telp AS Telp, sup_cp AS Contact, sup_hp AS HP, 
      sup_targetmitra AS TargetMitra, sup_ket AS Keterangan, sup_aktif AS Aktif, 
      user_create AS Usr, date_create AS Created
    FROM tsupplier 
    ORDER BY sup_nama ASC
  `;
  const [rows] = await db.query(query);
  return rows;
};

const getById = async (kode) => {
  // Ambil Data Header
  const queryHeader = "SELECT * FROM tsupplier WHERE sup_kode = ?";
  const [rowsHeader] = await db.query(queryHeader, [kode]);
  if (rowsHeader.length === 0) return null;

  // Ambil Data Detail (Rekening)
  const queryDetail =
    "SELECT supd_bank AS Bank, supd_rekening AS Rekening, supd_atasnama AS AtasNama FROM tsupplieritem WHERE supd_kode = ?";
  const [rowsDetail] = await db.query(queryDetail, [kode]);

  return {
    ...rowsHeader[0],
    RekeningList: rowsDetail,
  };
};

const generateKode = async () => {
  // Format: S + 7 Digit
  const query =
    'SELECT IFNULL(MAX(RIGHT(sup_kode, 7)), 0) AS max_val FROM tsupplier WHERE LEFT(sup_kode, 1) = "S"';
  const [[row]] = await db.query(query);

  const nextNum = parseInt(row.max_val, 10) + 1;
  return "S" + String(nextNum).padStart(7, "0");
};

const create = async (data, user) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const kode = await generateKode();

    const queryHeader = `
      INSERT INTO tsupplier (
        sup_kode, sup_nama, sup_alamat, sup_kota, sup_telp, sup_hp, sup_fax, sup_cp, 
        sup_npwp, sup_nama_npwp, sup_alamat_npwp, sup_kota_npwp, sup_top, sup_targetmitra, 
        sup_ket, sup_bahan, sup_cmt, sup_accesories, sup_obat, sup_sparepart, sup_atk, sup_jasa, 
        sup_aktif, user_create, date_create
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
    `;

    await conn.query(queryHeader, [
      kode,
      data.Nama,
      data.Alamat,
      data.Kota,
      data.Telp,
      data.Hp,
      data.Fax,
      data.Contact,
      data.NpwpKode,
      data.NpwpNama,
      data.NpwpAlamat,
      data.NpwpKota,
      data.Top || 0,
      data.TargetMitra || 0,
      data.Keterangan || "",
      data.Jenis.Bahan ? "Y" : "N",
      data.Jenis.Cmt ? "Y" : "N",
      data.Jenis.Acc ? "Y" : "N",
      data.Jenis.Obat ? "Y" : "N",
      data.Jenis.Sparepart ? "Y" : "N",
      data.Jenis.Atk ? "Y" : "N",
      data.Jenis.Jasa ? "Y" : "N",
      data.Aktif,
      user,
    ]);

    // Insert Detail Rekening
    if (data.RekeningList && data.RekeningList.length > 0) {
      const detailVals = data.RekeningList.filter(
        (r) => r.Rekening && r.Rekening.trim() !== "",
      ).map((r) => [kode, r.Bank, r.Rekening, r.AtasNama]);

      if (detailVals.length > 0) {
        await conn.query(
          "INSERT INTO tsupplieritem (supd_kode, supd_bank, supd_rekening, supd_atasnama) VALUES ?",
          [detailVals],
        );
      }
    }

    await conn.commit();
    return kode;
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
};

const update = async (kode, data, user) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const queryHeader = `
      UPDATE tsupplier SET 
        sup_nama = ?, sup_alamat = ?, sup_kota = ?, sup_telp = ?, sup_hp = ?, sup_fax = ?, sup_cp = ?, 
        sup_npwp = ?, sup_nama_npwp = ?, sup_alamat_npwp = ?, sup_kota_npwp = ?, sup_top = ?, sup_targetmitra = ?, 
        sup_ket = ?, sup_bahan = ?, sup_cmt = ?, sup_accesories = ?, sup_obat = ?, sup_sparepart = ?, sup_atk = ?, sup_jasa = ?, 
        sup_aktif = ?, user_modified = ?, date_modified = NOW()
      WHERE sup_kode = ?
    `;

    await conn.query(queryHeader, [
      data.Nama,
      data.Alamat,
      data.Kota,
      data.Telp,
      data.Hp,
      data.Fax,
      data.Contact,
      data.NpwpKode,
      data.NpwpNama,
      data.NpwpAlamat,
      data.NpwpKota,
      data.Top || 0,
      data.TargetMitra || 0,
      data.Keterangan || "",
      data.Jenis.Bahan ? "Y" : "N",
      data.Jenis.Cmt ? "Y" : "N",
      data.Jenis.Acc ? "Y" : "N",
      data.Jenis.Obat ? "Y" : "N",
      data.Jenis.Sparepart ? "Y" : "N",
      data.Jenis.Atk ? "Y" : "N",
      data.Jenis.Jasa ? "Y" : "N",
      data.Aktif,
      user,
      kode,
    ]);

    // Hapus detail lama
    await conn.query("DELETE FROM tsupplieritem WHERE supd_kode = ?", [kode]);

    // Insert detail baru
    if (data.RekeningList && data.RekeningList.length > 0) {
      const detailVals = data.RekeningList.filter(
        (r) => r.Rekening && r.Rekening.trim() !== "",
      ).map((r) => [kode, r.Bank, r.Rekening, r.AtasNama]);

      if (detailVals.length > 0) {
        await conn.query(
          "INSERT INTO tsupplieritem (supd_kode, supd_bank, supd_rekening, supd_atasnama) VALUES ?",
          [detailVals],
        );
      }
    }

    await conn.commit();
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
};

module.exports = { getBrowse, getById, create, update };
