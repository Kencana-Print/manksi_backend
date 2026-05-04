const db = require("../../config/database");

const getSpkInfo = async (nomor) => {
  // Ambil data SPK dan pastikan sudah diapprove CMO
  const query = `
    SELECT s.*, o.jo_nama
    FROM tspk s
    LEFT JOIN tjenisorder o ON o.jo_kode = s.spk_jo_kode
    WHERE s.spk_aktif = 'Y' AND s.spk_nomor = ?
  `;
  const [rows] = await db.query(query, [nomor]);
  if (rows.length === 0) throw new Error("SPK tersebut tidak ditemukan.");

  const spk = rows[0];
  if (!spk.spk_cmo || spk.spk_cmo.trim() === "") {
    throw new Error("SPK tersebut belum di approve oleh CMO.");
  }
  return spk;
};

// Fungsi dinamis untuk memuat komponen potong/cetak/bordir
const loadKomponenLini = async (nomor, map, lini) => {
  let tableName = "";
  if (lini === "POTONG") tableName = "tspk_komponen_potong";
  else if (lini === "CETAK") tableName = "tspk_komponen_cetak";
  else if (lini === "BORDIR") tableName = "tspk_komponen_bordir";

  // 1. Cek apakah sudah ada komponen tersimpan
  const queryExist = `
    SELECT a.sk_kode AS Kode, b.Bhn_Name AS Nama
    FROM ${tableName} a
    LEFT JOIN tbahan b ON b.Bhn_kode = a.sk_kode
    WHERE a.sk_nomor = ?
    ORDER BY a.sk_nourut ASC
  `;
  const [existRows] = await db.query(queryExist, [nomor]);

  if (existRows.length > 0) return existRows;

  // 2. Jika belum ada, dan ada MAP (Memo), coba tarik dari proof garmen
  if (map && map.trim() !== "") {
    const queryProof = `
      SELECT DISTINCT d.pfd_kode AS Kode, b.Bhn_Name AS Nama 
      FROM tproofgarmen_dtl d
      LEFT JOIN tbahan b ON b.Bhn_kode = d.pfd_kode
      WHERE d.pfd_nomor IN (
        SELECT h.pf_nomor FROM tproofgarmen_hdr h
        WHERE h.pf_lini = ? AND h.pf_spk_nomor = ?
      )
    `;
    const [proofRows] = await db.query(queryProof, [lini, map]);
    return proofRows;
  }

  return [];
};

const getFormLoadData = async (nomor) => {
  const spk = await getSpkInfo(nomor);
  const map = spk.spk_memo;

  // Load data untuk ke-3 grid sekaligus (paralel agar cepat)
  const [potong, cetak, bordir] = await Promise.all([
    loadKomponenLini(nomor, map, "POTONG"),
    loadKomponenLini(nomor, map, "CETAK"),
    loadKomponenLini(nomor, map, "BORDIR"),
  ]);

  return {
    NomorSPK: spk.spk_nomor,
    NamaBarang: spk.spk_nama,
    JenisBarang: spk.jo_nama,
    Jumlah: spk.spk_jumlah,
    Map: map,
    Cetak: spk.spk_sablon === "Y" || spk.spk_sublim === "Y",
    Bordir: spk.spk_bordir === "Y",
    ListPotong: potong,
    ListCetak: cetak,
    ListBordir: bordir,
  };
};

const getLookupBahanLL = async (isBordir) => {
  let query = `SELECT bhn_kode AS Kode, bhn_name AS Nama FROM tbahan WHERE bhn_aktif=0 AND bhn_jb_kode='LL'`;
  if (isBordir === "true") {
    query += ` AND bhn_bordir <> 0`;
  }
  query += ` ORDER BY bhn_name ASC`;

  const [rows] = await db.query(query);
  return rows;
};

const saveForm = async (nomor, payload) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // 1. Bersihkan data lama
    await conn.query("DELETE FROM tspk_komponen_potong WHERE sk_nomor = ?", [
      nomor,
    ]);
    await conn.query("DELETE FROM tspk_komponen_cetak WHERE sk_nomor = ?", [
      nomor,
    ]);
    await conn.query("DELETE FROM tspk_komponen_bordir WHERE sk_nomor = ?", [
      nomor,
    ]);

    // 2. Insert Potong
    if (payload.ListPotong && payload.ListPotong.length > 0) {
      const potongVals = payload.ListPotong.map((p, i) => [
        nomor,
        p.Kode,
        i + 1,
      ]);
      await conn.query(
        "INSERT INTO tspk_komponen_potong (sk_nomor, sk_kode, sk_nourut) VALUES ?",
        [potongVals],
      );
    }
    // 3. Insert Cetak
    if (payload.ListCetak && payload.ListCetak.length > 0) {
      const cetakVals = payload.ListCetak.map((p, i) => [nomor, p.Kode, i + 1]);
      await conn.query(
        "INSERT INTO tspk_komponen_cetak (sk_nomor, sk_kode, sk_nourut) VALUES ?",
        [cetakVals],
      );
    }
    // 4. Insert Bordir
    if (payload.ListBordir && payload.ListBordir.length > 0) {
      const bordirVals = payload.ListBordir.map((p, i) => [
        nomor,
        p.Kode,
        i + 1,
      ]);
      await conn.query(
        "INSERT INTO tspk_komponen_bordir (sk_nomor, sk_kode, sk_nourut) VALUES ?",
        [bordirVals],
      );
    }

    await conn.commit();
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
};

module.exports = { getFormLoadData, getLookupBahanLL, saveForm };
