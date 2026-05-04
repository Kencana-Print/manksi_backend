const db = require("../../config/database");

// --- GET MAX NOMOR ---
// Logika Delphi: 'POI.'+FormatDateTime('yyyy',dtTanggal.Date)+'.'+RightStr(IntToStr(100001+fields[0].AsInteger),5)
const getNextNomor = async (tanggal) => {
  const tgl = new Date(tanggal);
  const year = tgl.getFullYear();

  const query = `
    SELECT IFNULL(MAX(CAST(RIGHT(poi_nomor, 5) AS UNSIGNED)), 0) AS max_val 
    FROM tpointernalmap_hdr 
    WHERE MID(poi_nomor, 5, 4) = ?
  `;
  const [rows] = await db.query(query, [year]);
  const nextVal = rows[0].max_val + 1;
  const numStr = String(nextVal).padStart(5, "0");

  return `POI.${year}.${numStr}`;
};

// --- GET HEADER & DETAIL BY NOMOR (Untuk mode Edit) ---
const getById = async (nomor) => {
  // 1. Cek Header
  const [headerRows] = await db.query(
    `SELECT h.*, c.pab_nama AS namacab, u.pab_nama AS namasup
     FROM tpointernalmap_hdr h
     LEFT JOIN tpabrik c ON c.pab_kode = h.poi_cab
     LEFT JOIN tpabrik u ON u.pab_kode = h.poi_sup
     WHERE h.poi_nomor = ?`,
    [nomor],
  );

  if (headerRows.length === 0) return null;
  const header = headerRows[0];

  // Cek Status Close
  if (header.poi_close === "Y") {
    throw new Error("PO ini sudah Close. Tidak bisa diedit.");
  }

  // 2. Cek Detail
  const [detailRows] = await db.query(
    `SELECT d.*, m.mspk_nama, m.Mspk_kain, m.Mspk_ukuran, m.mspk_jumlah
     FROM tpointernalmap_dtl d
     LEFT JOIN tmemospk m ON m.mspk_nomor = d.poid_kode
     WHERE d.poid_nomor = ?
     ORDER BY d.poid_nourut`,
    [nomor],
  );

  return { header, detail: detailRows };
};

// --- VALIDASI PENAMBAHAN MAP KE GRID ---
const validateMapCode = async (kodeMap, currentPoNomor) => {
  // 1. Cek apakah MAP sudah di-BAST
  const [bastRows] = await db.query(
    `SELECT * FROM tkesesuaianmap WHERE mspk_nomor = ?`,
    [kodeMap],
  );
  if (bastRows.length > 0) {
    throw new Error("MAP tsb sudah dibuatkan BAST.");
  }

  // 2. Cek apakah MAP sudah pernah di-PO (Warning saja, tidak throw Error keras)
  const [poExisting] = await db.query(
    `SELECT poid_nomor FROM tpointernalmap_dtl 
     WHERE poid_kode = ? AND poid_nomor <> ?`,
    [kodeMap, currentPoNomor || ""],
  );

  let warningMessage = null;
  if (poExisting.length > 0) {
    warningMessage = `MAP tsb pernah dibuatkan PO dengan nomor: ${poExisting[0].poid_nomor}. Yakin akan dibuat lagi?`;
  }

  // 3. Cek Data MAP & Approval CMO
  const [mapRows] = await db.query(
    `SELECT mspk_nomor, mspk_nama, mspk_kain, mspk_ukuran, mspk_jumlah, mspk_cmo 
     FROM tmemospk WHERE mspk_nomor = ?`,
    [kodeMap],
  );

  if (mapRows.length === 0) {
    throw new Error("MAP tsb Tidak di temukan.");
  }

  const mapData = mapRows[0];
  if (!mapData.mspk_cmo || mapData.mspk_cmo.trim() === "") {
    throw new Error("Map tsb belum di approval oleh chief marketing.");
  }

  return { data: mapData, warning: warningMessage };
};

// --- SAVE FORM (HEADER + DETAILS) ---
const save = async (data, userKode, isNewMode) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    let nomorPO = data.Nomor;

    // --- INSERT / UPDATE HEADER ---
    if (isNewMode) {
      nomorPO = await getNextNomor(data.Tanggal);
      const insertHdr = `
        INSERT INTO tpointernalmap_hdr 
        (poi_nomor, poi_tanggal, poi_cab, poi_sup, date_create, user_create)
        VALUES (?, ?, ?, ?, NOW(), ?)
      `;
      await conn.query(insertHdr, [
        nomorPO,
        data.Tanggal,
        data.GudangAsal,
        data.Tujuan,
        userKode,
      ]);
    } else {
      const updateHdr = `
        UPDATE tpointernalmap_hdr SET 
          poi_tanggal = ?, 
          poi_cab = ?, 
          poi_sup = ?, 
          date_modified = NOW(), 
          user_modified = ?
        WHERE poi_nomor = ?
      `;
      await conn.query(updateHdr, [
        data.Tanggal,
        data.GudangAsal,
        data.Tujuan,
        userKode,
        nomorPO,
      ]);
    }

    // --- DELETE DETAIL LAMA & INSERT DETAIL BARU ---
    await conn.query(`DELETE FROM tpointernalmap_dtl WHERE poid_nomor = ?`, [
      nomorPO,
    ]);

    if (data.Details && data.Details.length > 0) {
      let nourut = 1;
      for (const d of data.Details) {
        // Abaikan baris yang kosong atau jumlahnya 0 (seperti Delphi)
        if (d.KodeMAP && Number(d.JumlahPO) > 0) {
          await conn.query(
            `INSERT INTO tpointernalmap_dtl 
             (poid_nomor, poid_kode, poid_jumlah, poid_dateline, poid_ket, poid_nourut)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [
              nomorPO,
              d.KodeMAP,
              Number(d.JumlahPO),
              d.Dateline || null, // Harus dalam format YYYY-MM-DD
              d.Keterangan || "",
              nourut,
            ],
          );
          nourut++;
        }
      }
    }

    await conn.commit();
    return nomorPO;
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
};

const getPrintData = async (nomor) => {
  // Ambil Header
  const [headerRows] = await db.query(
    `SELECT 
      h.poi_nomor AS Nomor, 
      DATE_FORMAT(h.poi_tanggal, '%d-%m-%Y') AS Tanggal, 
      c.pab_nama AS GudangAsal, 
      u.pab_nama AS Tujuan,
      h.user_create AS User
     FROM tpointernalmap_hdr h
     LEFT JOIN tpabrik c ON c.pab_kode = h.poi_cab
     LEFT JOIN tpabrik u ON u.pab_kode = h.poi_sup
     WHERE h.poi_nomor = ?`,
    [nomor],
  );

  if (headerRows.length === 0) return null;

  // Ambil Detail
  const [detailRows] = await db.query(
    `SELECT 
      d.poid_kode AS Kode,
      m.mspk_nama AS Nama,
      m.Mspk_kain AS Bahan,
      m.Mspk_ukuran AS Ukuran,
      d.poid_jumlah AS Qty,
      DATE_FORMAT(d.poid_dateline, '%d-%m-%Y') AS Dateline,
      d.poid_ket AS Keterangan
     FROM tpointernalmap_dtl d
     LEFT JOIN tmemospk m ON m.mspk_nomor = d.poid_kode
     WHERE d.poid_nomor = ?
     ORDER BY d.poid_nourut`,
    [nomor],
  );

  return { header: headerRows[0], details: detailRows };
};

module.exports = {
  getById,
  validateMapCode,
  save,
  getPrintData,
};
