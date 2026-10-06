const db = require("../../config/database");

const getBrowse = async () => {
  const query = `
    SELECT 
      sup_kode AS Kode, sup_nama AS Nama, sup_alamat AS Alamat, sup_kota AS Kota, 
      sup_fax AS Fax, sup_telp AS Telp, sup_cp AS Contact, sup_hp AS HP, 
      sup_targetmitra AS TargetMitra, sup_ket AS Keterangan, sup_aktif AS Aktif, 
      user_create AS Usr, DATE_FORMAT(date_create, '%d/%m/%Y %H:%i:%s') AS Created
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

const normalisasiNama = (s) =>
  String(s || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");

const cariNamaKembar = async (nama, excludeKode = "", conn = db) => {
  const norm = normalisasiNama(nama);
  if (!norm) return [];
  const [rows] = await conn.query(
    `SELECT sup_kode AS Kode, sup_nama AS Nama, sup_kota AS Kota, sup_aktif AS Aktif
       FROM tsupplier
      WHERE REGEXP_REPLACE(UPPER(sup_nama), '[^A-Z0-9]', '') = ?
        AND sup_kode <> ?
      LIMIT 5`,
    [norm, excludeKode || ""],
  );
  return rows;
};

const cariNamaMirip = async (nama, excludeKode = "") => {
  const norm = normalisasiNama(nama);
  if (norm.length < 3) return [];
  const [rows] = await db.query(
    `SELECT x.Kode, x.Nama, x.Kota, x.Aktif, (x.norm = ?) AS Sama
       FROM (
         SELECT sup_kode AS Kode, sup_nama AS Nama, sup_kota AS Kota, sup_aktif AS Aktif,
                REGEXP_REPLACE(UPPER(sup_nama), '[^A-Z0-9]', '') AS norm
           FROM tsupplier
          WHERE sup_kode <> ?
       ) x
      WHERE x.norm = ?
         OR x.norm LIKE CONCAT('%', ?, '%')
         OR (CHAR_LENGTH(x.norm) >= 5 AND ? LIKE CONCAT('%', x.norm, '%'))
      ORDER BY Sama DESC, x.Nama
      LIMIT 8`,
    [norm, excludeKode || "", norm, norm, norm],
  );
  return rows;
};

const errNamaKembar = (s) => {
  const err = new Error(
    `Nama supplier sudah terdaftar: ${s.Kode} - ${s.Nama}${s.Kota ? " (" + s.Kota + ")" : ""}${s.Aktif === "N" ? " [non-aktif]" : ""}`,
  );
  err.status = 409;
  return err;
};

const errNamaKosong = () => {
  const err = new Error("Nama supplier wajib diisi");
  err.status = 400;
  return err;
};

const insertSupplier = async (data, user) => {
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

const create = async (data, user) => {
  if (!normalisasiNama(data.Nama)) throw errNamaKosong();

  const lockConn = await db.getConnection();
  try {
    const [[lock]] = await lockConn.query(
      `SELECT GET_LOCK('tsupplier_create', 10) AS got`,
    );
    if (Number(lock.got) !== 1) {
      throw new Error("Sistem sedang memproses supplier lain, coba lagi.");
    }
    const kembar = await cariNamaKembar(data.Nama, "", lockConn);
    if (kembar.length) throw errNamaKembar(kembar[0]);

    return await insertSupplier(data, user);
  } finally {
    await lockConn
      .query(`SELECT RELEASE_LOCK('tsupplier_create')`)
      .catch(() => {});
    lockConn.release();
  }
};

const update = async (kode, data, user) => {
  if (!normalisasiNama(data.Nama)) throw errNamaKosong();

  const [[lama]] = await db.query(
    `SELECT sup_nama FROM tsupplier WHERE sup_kode = ?`,
    [kode],
  );
  if (!lama) throw new Error("Supplier tidak ditemukan");
  if (normalisasiNama(lama.sup_nama) !== normalisasiNama(data.Nama)) {
    const kembar = await cariNamaKembar(data.Nama, kode);
    if (kembar.length) throw errNamaKembar(kembar[0]);
  }

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

module.exports = {
  getBrowse,
  getById,
  create,
  update,
  cariNamaKembar,
  cariNamaMirip,
};
