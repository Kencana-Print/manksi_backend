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
      h.bap_apv AS Approve,
      h.bap_spk_nomor AS LegacySpk,
      h.bap_jumlah AS LegacyJumlah,
      h.bap_harga AS LegacyHarga
    FROM tkpi_bapproduksi h
    WHERE h.bap_nomor = ?
  `;
  const [rows] = await db.query(query, [nomor]);
  if (rows.length === 0) return null;
  const data = rows[0];
  // --- CEK STATUS PIN 5 (tidak berubah) ---
  const [pinRows] = await db.query(
    `SELECT pin_urut, pin_acc, pin_dipakai 
     FROM tspk_pin5 
     WHERE pin_trs = "BAP PRODUKSI" AND pin_nomor = ? 
     ORDER BY pin_urut DESC LIMIT 1`,
    [nomor],
  );
  data.StatusEdit = "";
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
      data.StatusEdit = "";
    } else {
      data.StatusEdit = "MINTA";
    }
  }
  const [kategoriRows] = await db.query(
    `SELECT bapk_kategori AS kategori FROM tkpi_bap_kategori WHERE bapk_bap_nomor = ?`,
    [nomor],
  );
  data.Kategori = kategoriRows.map((r) => r.kategori);
  const [karyawanRows] = await db.query(
    `SELECT bapkr_nik AS nik, bapkr_nama AS nama FROM tkpi_bap_karyawan WHERE bapkr_bap_nomor = ?`,
    [nomor],
  );
  data.Karyawan = karyawanRows;
  // --- Daftar SPK (multi-baris, skema baru) ---
  const [spkRows] = await db.query(
    `SELECT bapspk_spk_nomor AS Spk, bapspk_spk_nama AS SpkNama,
            bapspk_jumlah AS Jumlah, bapspk_harga AS Harga
     FROM tkpi_bap_spk WHERE bapspk_bap_nomor = ? ORDER BY bapspk_nourut`,
    [nomor],
  );
  // [BARU] BACKWARD COMPAT — BAP lama (dibuat sebelum fitur multi-SPK)
  // tidak punya baris di tkpi_bap_spk sama sekali, datanya masih
  // tersimpan di kolom lama header (bap_spk_nomor/jumlah/harga).
  // Kalau tabel detail kosong TAPI kolom lama terisi, bangun satu
  // baris SpkList dari situ — nama SPK di-lookup ulang karena kolom
  // lama tidak menyimpannya.
  if (spkRows.length === 0 && data.LegacySpk) {
    const [[legacySpkInfo]] = await db.query(
      `SELECT * FROM (
         SELECT spk_nomor AS Nomor, spk_nama AS Nama FROM tspk
         UNION ALL
         SELECT mspk_nomor AS Nomor, mspk_nama AS Nama FROM tmemospk
       ) final WHERE Nomor = ? LIMIT 1`,
      [data.LegacySpk],
    );
    data.SpkList = [
      {
        Spk: data.LegacySpk,
        SpkNama: legacySpkInfo?.Nama || "",
        Jumlah: Number(data.LegacyJumlah) || 0,
        Harga: Number(data.LegacyHarga) || 0,
      },
    ];
  } else {
    data.SpkList = spkRows;
  }
  // Bersihkan field internal yang cuma dipakai untuk fallback ini
  delete data.LegacySpk;
  delete data.LegacyJumlah;
  delete data.LegacyHarga;
  return data;
};

// --- SIMPAN DATA (CREATE / UPDATE) ---
const save = async (data, userKode, isNewMode) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    let nomor = data.Nomor;
    const approve = data.Approve ? userKode : "";
    // [BARU] SpkList dari payload — fallback ke array kosong kalau tidak dikirim
    const spkList = (data.SpkList || []).filter((s) => s.Spk);
    // Kolom lama tetap diisi dari baris SPK pertama (kompatibilitas mundur)
    const firstSpk = spkList[0] || {
      Spk: "",
      SpkNama: "",
      Jumlah: 0,
      Harga: 0,
    };
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
        firstSpk.Spk,
        Number(firstSpk.Jumlah) || 0,
        Number(firstSpk.Harga) || 0,
        userKode,
      ]);
    } else {
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
        firstSpk.Spk,
        Number(firstSpk.Jumlah) || 0,
        Number(firstSpk.Harga) || 0,
        userKode,
        nomor,
      ]);
      if (data.StatusEdit === "ACC" && data.UrutPin5 > 0) {
        await conn.query(
          `UPDATE tspk_pin5 SET pin_dipakai = "Y" 
           WHERE pin_trs = "BAP PRODUKSI" AND pin_nomor = ? AND pin_urut = ?`,
          [nomor, data.UrutPin5],
        );
      }
    }
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
    // [BARU] Hapus & insert ulang daftar SPK
    await conn.query(`DELETE FROM tkpi_bap_spk WHERE bapspk_bap_nomor = ?`, [
      nomor,
    ]);
    if (spkList.length > 0) {
      for (let i = 0; i < spkList.length; i++) {
        const s = spkList[i];
        await conn.query(
          `INSERT INTO tkpi_bap_spk 
             (bapspk_bap_nomor, bapspk_nourut, bapspk_spk_nomor, bapspk_spk_nama, bapspk_jumlah, bapspk_harga)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            nomor,
            i + 1,
            s.Spk,
            s.SpkNama || "",
            Number(s.Jumlah) || 0,
            Number(s.Harga) || 0,
          ],
        );
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
      b.kb_nama
    FROM tkpi_bapproduksi h
    LEFT JOIN kpi.tbagian b ON b.kb_kode = h.bap_bag
    WHERE h.bap_nomor = ?
  `;
  const [rows] = await db.query(query, [nomor]);
  if (rows.length === 0) return null;
  const data = rows[0];
  // Daftar SPK (multi-baris, skema baru)
  const [spkRows] = await db.query(
    `SELECT bapspk_spk_nomor AS Spk, bapspk_spk_nama AS SpkNama,
            bapspk_jumlah AS Jumlah, bapspk_harga AS Harga
     FROM tkpi_bap_spk WHERE bapspk_bap_nomor = ? ORDER BY bapspk_nourut`,
    [nomor],
  );
  // [BARU] BACKWARD COMPAT — sama pola dengan getById: BAP lama
  // (dibuat sebelum fitur multi-SPK) tidak punya baris di
  // tkpi_bap_spk, datanya masih di kolom lama header. Kalau tabel
  // detail kosong TAPI kolom lama terisi, bangun satu baris SpkList
  // dari situ supaya halaman cetak tidak menampilkan tabel SPK kosong.
  if (spkRows.length === 0 && data.bap_spk_nomor) {
    const [[legacySpkInfo]] = await db.query(
      `SELECT * FROM (
         SELECT spk_nomor AS Nomor, spk_nama AS Nama FROM tspk
         UNION ALL
         SELECT mspk_nomor AS Nomor, mspk_nama AS Nama FROM tmemospk
       ) final WHERE Nomor = ? LIMIT 1`,
      [data.bap_spk_nomor],
    );
    data.SpkList = [
      {
        Spk: data.bap_spk_nomor,
        SpkNama: legacySpkInfo?.Nama || "",
        Jumlah: Number(data.bap_jumlah) || 0,
        Harga: Number(data.bap_harga) || 0,
      },
    ];
  } else {
    data.SpkList = spkRows;
  }
  return data;
};

module.exports = { getById, getSpkDetail, save, getPrintData };
