const db = require("../../config/database");

/**
 * Mengambil data lengkap untuk Form BAST berdasarkan Nomor MAP
 */
const getBastFormData = async (nomorMap, userCabang) => {
  // 1. Ambil Data Header MAP (tmemospk)
  const [mapRows] = await db.query(
    `SELECT m.*, c.cus_nama, j.jo_nama 
     FROM tmemospk m
     INNER JOIN tcustomer c ON m.mspk_cus_kode = c.cus_kode
     LEFT JOIN tjenisorder j ON m.mspk_jo_kode = j.jo_kode
     WHERE m.mspk_nomor = ?`,
    [nomorMap],
  );

  if (mapRows.length === 0) return null;
  const mapHeader = mapRows[0];

  // 2. Load Checklist BAST
  let [checklist] = await db.query(
    `SELECT a.kode_sesuai AS no, b.nama_sesuai AS kesesuaian, a.status, a.keterangan,
            a.user_create, a.date_create, a.user_modify, a.date_modify
     FROM tkesesuaianmap a 
     INNER JOIN tkesesuaian b ON a.kode_sesuai = b.kode_sesuai
     WHERE a.mspk_nomor = ? ORDER BY a.kode_sesuai`,
    [nomorMap],
  );

  if (checklist.length === 0) {
    [checklist] = await db.query(
      `SELECT kode_sesuai AS no, nama_sesuai AS kesesuaian, "N" AS status, "-" AS keterangan,
            "" AS user_create, NULL AS date_create, "" AS user_modify, NULL AS date_modify
     FROM tkesesuaian ORDER BY kode_sesuai`,
    );
  }

  // 3. Load Komponen / Bahan
  let [komponen] = await db.query(
    `SELECT a.*, b.bhn_name, b.bhn_satuan 
   FROM tkesesuaianmap_komponen a
   LEFT JOIN tbahan b ON b.bhn_kode = a.kode
   WHERE a.nomor = ? ORDER BY a.no_urut`,
    [nomorMap],
  );
  if (komponen.length === 0) {
    // FIX: prioritaskan MKB (Memo Kebutuhan Bahan) sebagai sumber komponen
    // + bahan + babaran untuk MAP — MKB dibuat khusus untuk MAP ini
    // (mkb_spk_nomor = nomorMap) dan sudah punya babaran aktual yang
    // diinput user (mkbd_babaran), bukan cuma daftar bahan kosong seperti
    // fallback tmintabahan_dtl sebelumnya.
    const [mkbRows] = await db.query(
      `SELECT d.mkbd_bhn_kode AS kode, b.bhn_name, b.bhn_satuan,
            d.mkbd_komponen AS komponen, d.mkbd_warna AS warna,
            d.mkbd_babaran AS babaran, 0 AS babarank
     FROM tmkb_hdr h
     INNER JOIN tmkb_dtl d ON d.mkbd_mkb_nomor = h.mkb_nomor
     LEFT JOIN tbahan b ON b.bhn_kode = d.mkbd_bhn_kode
     WHERE h.mkb_spk_nomor = ? AND d.mkbd_komponen <> ''
     ORDER BY d.mkbd_nourut`,
      [nomorMap],
    );
    if (mkbRows.length > 0) {
      komponen = mkbRows;
    } else {
      [komponen] = await db.query(
        `SELECT DISTINCT d.mind_bhn_kode AS kode, b.bhn_name, b.bhn_satuan, d.mind_komponen AS komponen, 0 AS babaran, 0 AS babarank
       FROM tmintabahan_hdr h
       LEFT JOIN tmintabahan_dtl d ON d.mind_nomor = h.min_nomor
       LEFT JOIN tbahan b ON b.bhn_kode = d.mind_bhn_kode
       WHERE h.min_spk_nomor = ?`,
        [nomorMap],
      );
    }
  }

  if (komponen.length === 0) {
    [komponen] = await db.query(
      `SELECT DISTINCT d.mind_bhn_kode AS kode, b.bhn_name, b.bhn_satuan, d.mind_komponen AS komponen, 0 AS babaran, 0 AS babarank
       FROM tmintabahan_hdr h
       LEFT JOIN tmintabahan_dtl d ON d.mind_nomor = h.min_nomor
       LEFT JOIN tbahan b ON b.bhn_kode = d.mind_bhn_kode
       WHERE h.min_spk_nomor = ?`,
      [nomorMap],
    );
  }

  //  A. UPDATE BABARAN KALKULASI & FALLBACK KOMPONEN <---
  const [kalkulasiRows] = await db.query(
    `SELECT k.kk_komponen, k.kk_warna, k.kk_babaran 
      FROM tmemospk m
     INNER JOIN tmintaharga h ON h.mh_nomor = m.mspk_mh_nomor
     INNER JOIN kalkulasi.tkalkulasi2_komponen k ON k.kk_nomor = h.mh_nomor_kalkulasi
     WHERE m.mspk_nomor = ? ORDER BY k.kk_nourut`,
    [nomorMap],
  );
  if (komponen.length === 0) {
    komponen = kalkulasiRows.map((k) => ({
      kode: "",
      bhn_name: "",
      bhn_satuan: "",
      komponen: k.kk_komponen,
      warna: k.kk_warna,
      babaran: 0,
      babarank: k.kk_babaran,
    }));
    if (komponen.length === 0) {
      komponen.push({
        kode: "",
        bhn_name: "",
        bhn_satuan: "",
        komponen: "",
        warna: "",
        babaran: 0,
        babarank: 0,
      });
    }
  } else {
    komponen.forEach((comp) => {
      const calcMatch = kalkulasiRows.find(
        (k) => k.kk_komponen === comp.komponen,
      );
      if (calcMatch) {
        comp.babarank = calcMatch.kk_babaran;
      } else if (comp.babarank === undefined) {
        comp.babarank = 0;
      }
    });
  }

  // 4. Load Aksesoris
  let [aksesoris] = await db.query(
    `SELECT k.*, o.brg_nama AS acc_nama, o.brg_satuan AS acc_satuan, o.brg_note AS acc_note
      FROM tkesesuaianmap_acc k
     LEFT JOIN tgarmen_brg o ON TRIM(o.brg_kode) = TRIM(k.kode) AND o.brg_jenis = 'ACCESORIES'
     WHERE k.nomor = ? ORDER BY k.no_urut`,
    [nomorMap],
  );
  if (aksesoris.length === 0) {
    // ⚠️ FIX: qty SEKARANG selalu 0 sebagai default, BUKAN jumlah yang
    // diminta (SUM(mind_jumlah)) — daftar aksesoris (kode/nama/satuan)
    // tetap otomatis diambil dari Permintaan Accesories/MKA, tapi
    // qty-nya sengaja dikosongkan supaya user isi manual sesuai
    // PEMAKAIAN AKTUAL (bisa beda dari jumlah yang diminta di awal).
    const [mintaRows] = await db.query(
      `SELECT
        d.mind_brg_kode AS kode,
        b.brg_nama AS acc_nama,
        b.brg_satuan AS acc_satuan,
        b.brg_note AS acc_note,
        0 AS qty
      FROM tgarmenminta_hdr h
      INNER JOIN tgarmenminta_dtl d ON d.mind_nomor = h.min_nomor
      LEFT JOIN tgarmen_brg b ON TRIM(b.brg_kode) = TRIM(d.mind_brg_kode) AND b.brg_jenis = 'ACCESORIES'
      WHERE h.min_jenis = 'ACCESORIES' AND h.min_spk_nomor = ?
      GROUP BY d.mind_brg_kode
      ORDER BY b.brg_nama`,
      [nomorMap],
    );
    aksesoris = mintaRows;
  }

  // 5. Load Obat
  const [obat] = await db.query(
    `SELECT k.*, o.brg_nama AS jenisobat
     FROM tkesesuaianmap_obat k
     LEFT JOIN tgarmen_brg o ON o.brg_kode = k.ko_kode AND o.brg_jenis = 'OBAT'
     WHERE k.ko_nomor = ? ORDER BY k.no_urut`,
    [nomorMap],
  );

  // 6. Load Breakdown Size
  const [sizeBreakdown] = await db.query(
    `SELECT ks_komponen AS komponen, ks_size AS size, ks_babaran AS babaran
     FROM tkesesuaianmap_size WHERE ks_nomor = ? ORDER BY ks_urut`,
    [nomorMap],
  );

  // 7. Check Lock Status
  const [lockStatus] = await db.query(
    `SELECT * FROM tkesesuaianmap_lock WHERE map = ?`,
    [nomorMap],
  );
  let lockData = lockStatus[0] || null;
  let globalLockWarning = "";

  // ---> [FIX] B. CEK GLOBAL LOCK 6 HARI (Untuk BAST Baru) <---
  if (checklist.some((c) => c.date_create === null)) {
    // Indikasi BAST baru
    const [globalLock] = await db.query(
      `SELECT DATE_ADD(tgl, INTERVAL 6 DAY) AS xtgl 
       FROM tkesesuaianmap_lock 
       WHERE apv = "N" AND cab = ? 
       ORDER BY tgl DESC LIMIT 1`,
      [userCabang],
    );

    if (globalLock.length > 0 && new Date(globalLock[0].xtgl) <= new Date()) {
      globalLockWarning =
        "Ada BAST MAP On Progress lebih dari 6 hari. Selesaikan dulu supaya bisa membuat BAST MAP yang baru.";
    }
  }

  return {
    header: mapHeader,
    checklist,
    komponen,
    aksesoris,
    obat,
    sizeBreakdown,
    lock: lockData,
    globalLockWarning,
  };
};

/**
 * Menyimpan seluruh data Form BAST (Update tmemospk + Multi-table Sync)
 */
const saveBastData = async (payload, userKode, userCabang) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const {
      header,
      checklist,
      komponen,
      obat,
      aksesoris,
      sizeBreakdown,
      payloadLock,
    } = payload;
    const nomorMap = header.mspk_nomor || header.MSPK_Nomor;

    // 1. Update tmemospk (Header MAP)
    await conn.query(
      `UPDATE tmemospk SET 
        mspk_jumlah_jadi = ?, mspk_kendala = ?, mspk_tipe = ?, mspk_bastnew = ?
       WHERE mspk_nomor = ?`,
      [
        header.mspk_jumlah_jadi || 0,
        header.mspk_kendala || "",
        header.mspk_tipe || "",
        1, // xBastNew = 1
        nomorMap,
      ],
    );

    // 2. Sync Checklist (tkesesuaianmap) -> Logika Delphi Insert/Update dipisah
    for (const item of checklist) {
      const [existing] = await conn.query(
        `SELECT * FROM tkesesuaianmap WHERE mspk_nomor = ? AND kode_sesuai = ?`,
        [nomorMap, item.no],
      );

      if (existing.length === 0) {
        // Baris Baru -> Insert
        await conn.query(
          `INSERT INTO tkesesuaianmap (mspk_nomor, kode_sesuai, status, keterangan, user_create, date_create)
           VALUES (?, ?, ?, ?, ?, NOW())`,
          [nomorMap, item.no, item.status, item.keterangan || "-", userKode],
        );
      } else {
        // Sudah ada -> Update
        await conn.query(
          `UPDATE tkesesuaianmap SET 
            status = ?, keterangan = ?, user_modify = ?, date_modify = NOW()
           WHERE mspk_nomor = ? AND kode_sesuai = ?`,
          [item.status, item.keterangan || "-", userKode, nomorMap, item.no],
        );
      }
    }

    // 3. Sync Komponen (Delete then Insert)
    await conn.query(`DELETE FROM tkesesuaianmap_komponen WHERE nomor = ?`, [
      nomorMap,
    ]);
    for (let i = 0; i < komponen.length; i++) {
      const k = komponen[i];
      if (k.komponen && k.komponen.trim() !== "") {
        await conn.query(
          `INSERT INTO tkesesuaianmap_komponen (nomor, kode, komponen, warna, babaran, babarank, no_urut, date_create)
           VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
          [
            nomorMap,
            k.kode || "",
            k.komponen,
            k.warna || "",
            k.babaran || 0,
            k.babarank || 0,
            i + 1,
          ],
        );
      }
    }

    // 4. Sync Obat (Delete then Insert)
    await conn.query(`DELETE FROM tkesesuaianmap_obat WHERE ko_nomor = ?`, [
      nomorMap,
    ]);
    for (let i = 0; i < obat.length; i++) {
      const o = obat[i];
      if (o.kode && o.kode.trim() !== "") {
        await conn.query(
          `INSERT INTO tkesesuaianmap_obat (ko_nomor, ko_kode, ko_qty, ko_harga, no_urut, date_create)
           VALUES (?, ?, ?, ?, ?, NOW())`,
          [nomorMap, o.kode, o.qty || 0, o.harga || 0, i + 1],
        );
      }
    }

    // 5. Sync Aksesoris (Delete then Insert)
    await conn.query(`DELETE FROM tkesesuaianmap_acc WHERE nomor = ?`, [
      nomorMap,
    ]);
    for (let i = 0; i < aksesoris.length; i++) {
      const a = aksesoris[i];
      // Delphi: if (Trim(CDS4.fieldbyname('nama').AsString)<>'') and (CDS4.fieldbyname('qty').asfloat<>0)
      if (a.nama && a.nama.trim() !== "" && Number(a.qty) !== 0) {
        await conn.query(
          `INSERT INTO tkesesuaianmap_acc (nomor, kode, qty, no_urut) VALUES (?, ?, ?, ?)`,
          [nomorMap, a.kode || "", a.qty, i + 1],
        );
      }
    }

    // 6. Sync Size Breakdown (Delete then Insert)
    await conn.query(`DELETE FROM tkesesuaianmap_size WHERE ks_nomor = ?`, [
      nomorMap,
    ]);
    let urutSize = 1;
    for (let i = 0; i < sizeBreakdown.length; i++) {
      const s = sizeBreakdown[i];
      if (s.komponen && s.komponen.trim() !== "") {
        await conn.query(
          `INSERT INTO tkesesuaianmap_size (ks_nomor, ks_komponen, ks_size, ks_babaran, ks_urut)
           VALUES (?, ?, ?, ?, ?)`,
          [nomorMap, s.komponen, s.size || "", s.babaran || 0, urutSize],
        );
        urutSize++;
      }
    }

    // 7. Handle Lock Status (Sinkron dengan kondisi frontend)
    const { isLocked, isApproved, alasan } = payloadLock || {};

    if (isLocked && !isApproved) {
      await conn.query(
        `INSERT INTO tkesesuaianmap_lock (map, tgl, cab) VALUES (?, DATE(NOW()), ?)
         ON DUPLICATE KEY UPDATE apv = "N"`,
        [nomorMap, userCabang],
      );
    } else if (isApproved) {
      // ckApv.Checked = True
      await conn.query(
        `UPDATE tkesesuaianmap_lock SET apv = "Y", alasan = ?, approved = ? WHERE map = ?`,
        [alasan || "", userKode, nomorMap],
      );
    } else if (!isLocked) {
      // cLock = False
      await conn.query(
        `UPDATE tkesesuaianmap_lock SET apv = "Y", alasan = "", approved = "" WHERE map = ?`,
        [nomorMap],
      );
    }

    await conn.commit();
    return true;
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
};

// --- GET PRINT DATA ---
const getPrintData = async (nomorMap) => {
  const [headerRows] = await db.query(
    `SELECT m.*, c.cus_nama 
     FROM tmemospk m
     LEFT JOIN tcustomer c ON m.mspk_cus_kode = c.cus_kode
     WHERE m.mspk_nomor = ?`,
    [nomorMap],
  );

  if (headerRows.length === 0) return null;

  const [details] = await db.query(
    `SELECT a.kode_sesuai AS no, b.nama_sesuai AS kesesuaian, a.status, a.keterangan
     FROM tkesesuaianmap a 
     INNER JOIN tkesesuaian b ON a.kode_sesuai = b.kode_sesuai
     WHERE a.mspk_nomor = ? ORDER BY a.kode_sesuai`,
    [nomorMap],
  );

  return {
    header: headerRows[0],
    details,
  };
};

// --- GET SPK SIZES (Untuk Auto Breakdown Size) ---
const getSpkSizes = async (nomorMap) => {
  const query = `
    SELECT mspks_size 
    FROM tmemospk_size 
    WHERE mspks_nomor = ? 
    ORDER BY mspks_size ASC
  `;
  const [rows] = await db.query(query, [nomorMap]);
  return rows;
};

module.exports = {
  getBastFormData,
  saveBastData,
  getPrintData,
  getSpkSizes,
};
