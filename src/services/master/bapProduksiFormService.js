const db = require("../../config/database");

// --- GENERATE NOMOR BAP ---
const generateNomor = async (cabang, tanggal) => {
  const d = new Date(tanggal);
  const tahun = d.getFullYear(); // ex: 2026
  const prefix = `${cabang}.${tahun}`; // ex: HO-.2026

  // Logic Delphi: select ifnull(max(right(bap_nomor,5)),0) where left(bap_nomor,8) = 'HO-.2026'
  const query = `
    SELECT IFNULL(MAX(CAST(RIGHT(bap_nomor, 5) AS UNSIGNED)), 0) AS max_val 
    FROM tkpi_bapproduksi 
    WHERE LEFT(bap_nomor, 8) = ?
  `;
  const [[row]] = await db.query(query, [prefix]);

  const nextNum = parseInt(row.max_val, 10) + 1;
  const incrementStr = String(nextNum).padStart(5, "0"); // ex: 00001

  return `${prefix}.${incrementStr}`;
};

// --- AMBIL DATA SPK (UNION tspk & tmemospk) ---
const getSpkDetail = async (spkNomor) => {
  const query = `
    SELECT * FROM (
      SELECT spk_nomor AS Nomor, spk_nama AS Nama, spk_jumlah AS Jumlah, spk_harga AS Harga FROM tspk WHERE spk_aktif = 'Y'
      UNION ALL
      SELECT mspk_nomor AS Nomor, mspk_nama AS Nama, mspk_jumlah AS Jumlah, mspk_harga AS Harga FROM tmemospk
    ) final
    WHERE Nomor = ?
  `;
  const [rows] = await db.query(query, [spkNomor]);
  return rows.length > 0 ? rows[0] : null;
};

// --- GET BY ID (LOAD DATA ALL) ---
const getById = async (nomor) => {
  const query = `
    SELECT 
      h.bap_nomor AS Nomor, 
      DATE_FORMAT(h.bap_tanggal, "%Y-%m-%d") AS Tanggal, 
      h.bap_cab AS Cab, 
      h.bap_tipe AS Tipe, 
      h.bap_bag AS BagKode, 
      h.bap_bagnama AS BagNama,
      h.bap_masalah AS Masalah, 
      h.bap_sumber AS SumberMasalah, 
      h.bap_solusi AS Solusi, 
      h.bap_jawab AS Pertanggungjawaban, 
      h.bap_spk_nomor AS SPK, 
      IFNULL(s.spk_nama, m.mspk_nama) AS SpkNama,
      h.bap_jumlah AS Jumlah, 
      h.bap_harga AS Harga,
      h.bap_apv AS Approve
    FROM tkpi_bapproduksi h
    LEFT JOIN tspk s ON s.spk_nomor = h.bap_spk_nomor
    LEFT JOIN tmemospk m ON m.mspk_nomor = h.bap_spk_nomor
    WHERE h.bap_nomor = ?
  `;
  const [rows] = await db.query(query, [nomor]);
  if (rows.length === 0) return null;

  const data = rows[0];

  // --- CEK STATUS PIN 5 (PENGUBAHAN DATA) ---
  const [pinRows] = await db.query(
    `
    SELECT pin_urut, pin_acc, pin_dipakai 
    FROM tspk_pin5 
    WHERE pin_trs = "BAP PRODUKSI" AND pin_nomor = ? 
    ORDER BY pin_urut DESC LIMIT 1
  `,
    [nomor],
  );

  data.StatusEdit = ""; // Default kosong
  data.UrutPin5 = 0;

  if (pinRows.length > 0) {
    const pin = pinRows[0];
    data.UrutPin5 = pin.pin_urut;
    if (pin.pin_acc === "" && pin.pin_dipakai === "") {
      data.StatusEdit = "WAIT";
    } else if (pin.pin_acc === "Y" && pin.pin_dipakai === "") {
      data.StatusEdit = "ACC";
    } else if (pin.pin_acc === "N") {
      data.StatusEdit = "TOLAK";
    } else if (pin.pin_acc === "Y" && pin.pin_dipakai === "Y") {
      data.StatusEdit = ""; // Sudah dipakai, normal kembali
    } else {
      data.StatusEdit = "MINTA";
    }
  }

  // Load kategori
  const [kategoriRows] = await db.query(
    `SELECT bapk_kategori AS kategori FROM tkpi_bap_kategori WHERE bapk_bap_nomor = ?`,
    [nomor],
  );
  data.Kategori = kategoriRows.map((r) => r.kategori);

  // Load karyawan
  const [karyawanRows] = await db.query(
    `SELECT bapkr_nik AS nik, bapkr_nama AS nama FROM tkpi_bap_karyawan WHERE bapkr_bap_nomor = ?`,
    [nomor],
  );
  data.Karyawan = karyawanRows;

  return data;
};

// --- SIMPAN DATA (CREATE / UPDATE) ---
const save = async (data, userKode, isNewMode) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    let nomor = data.Nomor;

    const jumlah = Number(data.Jumlah) || 0;
    const harga = Number(data.Harga) || 0;
    const approve = data.Approve ? userKode : ""; // Jika dicentang, isi dengan user yang login (harus ada pengecekan AccKor di frontend)

    if (isNewMode) {
      nomor = await generateNomor(data.Cab, data.Tanggal);

      const insertQuery = `
        INSERT INTO tkpi_bapproduksi (
          bap_nomor, bap_tanggal, bap_cab, bap_tipe, bap_bag, bap_bagnama, 
          bap_masalah, bap_sumber, bap_solusi, bap_jawab, bap_apv, bap_spk_nomor, 
          bap_jumlah, bap_harga, date_create, user_create
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?)
      `;
      await conn.query(insertQuery, [
        nomor,
        data.Tanggal,
        data.Cab,
        data.Tipe,
        data.BagKode,
        data.BagNama,
        data.Masalah,
        data.SumberMasalah,
        data.Solusi,
        data.Pertanggungjawaban,
        approve,
        data.SPK,
        jumlah,
        harga,
        userKode,
      ]);
    } else {
      // UPDATE MODE
      const updateQuery = `
        UPDATE tkpi_bapproduksi SET 
          bap_tanggal = ?, bap_cab = ?, bap_tipe = ?, bap_bag = ?, bap_bagnama = ?, 
          bap_masalah = ?, bap_sumber = ?, bap_solusi = ?, bap_jawab = ?, bap_apv = ?, 
          bap_spk_nomor = ?, bap_jumlah = ?, bap_harga = ?, date_modified = NOW(), user_modified = ?
        WHERE bap_nomor = ?
      `;
      await conn.query(updateQuery, [
        data.Tanggal,
        data.Cab,
        data.Tipe,
        data.BagKode,
        data.BagNama,
        data.Masalah,
        data.SumberMasalah,
        data.Solusi,
        data.Pertanggungjawaban,
        approve,
        data.SPK,
        jumlah,
        harga,
        userKode,
        nomor,
      ]);

      // Jika dia ngedit lewat jalur PIN 5 ACC, update pin_dipakai jadi "Y"
      if (data.StatusEdit === "ACC" && data.UrutPin5 > 0) {
        await conn.query(
          `
          UPDATE tspk_pin5 SET pin_dipakai = "Y" 
          WHERE pin_trs = "BAP PRODUKSI" AND pin_nomor = ? AND pin_urut = ?
        `,
          [nomor, data.UrutPin5],
        );
      }
    }
    // Hapus & insert ulang kategori
    await conn.query(`DELETE FROM tkpi_bap_kategori WHERE bapk_bap_nomor = ?`, [
      nomor,
    ]);
    if (data.Kategori && data.Kategori.length > 0) {
      for (const kat of data.Kategori) {
        await conn.query(
          `INSERT INTO tkpi_bap_kategori (bapk_bap_nomor, bapk_kategori) VALUES (?, ?)`,
          [nomor, kat],
        );
      }
    }

    // Hapus & insert ulang karyawan
    await conn.query(
      `DELETE FROM tkpi_bap_karyawan WHERE bapkr_bap_nomor = ?`,
      [nomor],
    );
    if (data.Karyawan && data.Karyawan.length > 0) {
      for (const kar of data.Karyawan) {
        if (kar.nik) {
          await conn.query(
            `INSERT INTO tkpi_bap_karyawan (bapkr_bap_nomor, bapkr_nik, bapkr_nama) VALUES (?, ?, ?)`,
            [nomor, kar.nik, kar.nama],
          );
        }
      }
    }

    await conn.commit();
    return nomor;
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
};

const getPrintData = async (nomor) => {
  const query = `
    SELECT 
      h.*, 
      b.kb_nama, 
      IFNULL(s.spk_nama, m.mspk_nama) AS namaspk
    FROM tkpi_bapproduksi h
    LEFT JOIN kpi.tbagian b ON b.kb_kode = h.bap_bag
    LEFT JOIN tspk s ON s.spk_nomor = h.bap_spk_nomor
    LEFT JOIN tmemospk m ON m.mspk_nomor = h.bap_spk_nomor
    WHERE h.bap_nomor = ?
  `;
  const [rows] = await db.query(query, [nomor]);
  return rows.length > 0 ? rows[0] : null;
};

module.exports = { getById, getSpkDetail, save, getPrintData };
