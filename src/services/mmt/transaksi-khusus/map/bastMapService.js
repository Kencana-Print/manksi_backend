const db = require("../../../../config/database");
const { format } = require("date-fns");

// --- GET BROWSE LIST ---
// Aturan tampil seperti SO SPK:
// - Divisi: 3 (KAOSAN), 4 (GARMEN), 5 (MMT), 6 (GARMEN)
// - Jika userCabang = P05 (case-insensitive): tampilkan
//   mspk_cab = 'P05' ATAU UPPER(TRIM(mspk_workshop)) = 'MMT' ATAU mspk_sublim = 'Y'
// - Cabang lain (selain ALL/HO-/HO/ADMIN/kosong): tampilkan mspk_cab = cabang tsb
//   (plus baris dengan cab kosong/null agar data lama tetap terlihat)
// - Jika divisi login = 5 (MMT): tampilkan HANYA divisi 'MMT' (mspk_divisi = 5)
//   ATAU mspk_sublim = 'Y' (berlaku kombinasi dengan aturan cabang di atas)
// - Filter manual cabang/workshop/sublim dari frontend bersifat opsional
const getBrowseList = async (filters, userCabang, userDivisi) => {
  const {
    startDate,
    endDate,
    onProgressOnly,
    search,
    cabang,
    workshop,
    sublim,
  } = filters || {};

  const normCab = String(userCabang || "ALL")
    .trim()
    .toUpperCase();
  const isP05 = normCab === "P05";
  const isDiv5 = Number(userDivisi) === 5;
  const isAll =
    !normCab ||
    normCab === "ALL" ||
    normCab === "HO-" ||
    normCab === "HO" ||
    normCab === "ADMIN";

  let params = [];
  let whereClause = `WHERE m.mspk_divisi IN (3, 4, 5, 6) AND m.mspk_cmo <> ""`;

  // 1. Aturan otomatis mengikuti cabang login (seperti SO SPK)
  if (isP05) {
    whereClause += ` AND (UPPER(TRIM(m.mspk_cab)) = 'P05' OR UPPER(TRIM(m.mspk_workshop)) = 'MMT' OR UPPER(TRIM(m.mspk_sublim)) = 'Y')`;
  } else if (!isAll) {
    whereClause += ` AND (UPPER(TRIM(m.mspk_cab)) = ? OR m.mspk_cab = "" OR m.mspk_cab IS NULL)`;
    params.push(normCab);
  }

  // 1b. Aturan otomatis divisi login 5 (MMT): divisi MMT atau sublim Y.
  if (isDiv5) {
    whereClause += ` AND (m.mspk_divisi = 5 OR UPPER(TRIM(m.mspk_sublim)) = 'Y')`;
  }

  // 2. Filter khusus "On Progress" (ckLock di Delphi)
  if (onProgressOnly === "true" || onProgressOnly === true) {
    whereClause += ` AND m.mspk_nomor IN (SELECT map FROM tkesesuaianmap_lock WHERE apv = "N"`;
    if (!isAll && !isP05) {
      whereClause += ` AND UPPER(TRIM(cab)) = ?`;
      params.push(normCab);
    }
    whereClause += `)`;
  } else if (startDate && endDate) {
    whereClause += ` AND m.mspk_tanggal >= ? AND m.mspk_tanggal <= ?`;
    params.push(`${startDate} 00:00:00`, `${endDate} 23:59:59`);
  }

  // 3. Filter manual opsional dari dropdown frontend
  if (cabang && cabang !== "ALL" && cabang !== "") {
    whereClause += ` AND UPPER(TRIM(m.mspk_cab)) = ?`;
    params.push(String(cabang).trim().toUpperCase());
  }
  if (workshop && workshop !== "ALL" && workshop !== "") {
    whereClause += ` AND UPPER(TRIM(m.mspk_workshop)) = ?`;
    params.push(String(workshop).trim().toUpperCase());
  }
  if (sublim && sublim !== "ALL" && sublim !== "") {
    const s = String(sublim).trim().toUpperCase();
    if (s === "Y" || s === "YA") {
      whereClause += ` AND UPPER(TRIM(m.mspk_sublim)) = 'Y'`;
    } else if (s === "TIDAK" || s === "N" || s === "T") {
      whereClause += ` AND (UPPER(TRIM(m.mspk_sublim)) <> 'Y' OR m.mspk_sublim IS NULL OR m.mspk_sublim = "")`;
    }
  }

  // 4. Search nomor / nama pekerjaan
  if (search && String(search).trim() !== "") {
    whereClause += ` AND (m.mspk_nomor LIKE ? OR m.mspk_nama LIKE ? OR m.mspk_nama2 LIKE ?)`;
    const kw = `%${String(search).trim()}%`;
    params.push(kw, kw, kw);
  }

  const query = `
    SELECT
      m.mspk_nomor AS Nomor,
      CASE 
        WHEN m.mspk_divisi = 3 THEN 'KAOSAN'
        WHEN m.mspk_divisi = 5 THEN 'MMT'
        ELSE 'GARMEN'
      END AS Divisi,
      m.mspk_tipe AS Tipe,
      m.mspk_tanggal AS Tanggal,
      IF((SELECT s.mspk_nomor FROM tkesesuaianmap s WHERE s.mspk_nomor = m.mspk_nomor LIMIT 1) IS NULL, "", "SUDAH") AS CetakBAST,
      m.mspk_nama AS NamaPekerjaan,
      m.mspk_nama2 AS NamaExt,
      m.mspk_ukuran AS Ukuran,
      m.mspk_gramasi AS Gramasi,
      IFNULL((SELECT k.keterangan FROM tkesesuaianmap k WHERE k.kode_sesuai = 2 AND k.mspk_nomor = m.mspk_nomor LIMIT 1), "") AS GramasiSetting_Aktual,
      m.mspk_kain AS Kain,
      m.mspk_finishing AS Finishing,
      m.mspk_keterangan AS Keterangan,
      m.mspk_kendala AS kendalaProduksi,
      m.mspk_jumlah_jadi AS Jumlah,
      m.mspk_cab AS Cabang,
      m.mspk_workshop AS Workshop,
      m.mspk_sublim AS Sublim,
      (SELECT IFNULL(l.apv, "") FROM tkesesuaianmap_lock l WHERE l.map = m.mspk_nomor LIMIT 1) AS OnProgres
    FROM tmemospk m
    ${whereClause}
    ORDER BY m.mspk_tanggal DESC
  `;

  const [rows] = await db.query(query, params);
  return rows;
};

// --- GET FORM DATA (BAST Baru / Inisialisasi Form) ---
const getBastFormData = async (nomorMap, userCabang) => {
  if (!nomorMap) throw new Error("Nomor MAP wajib diisi.");

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
      `SELECT kode_sesuai AS no, nama_sesuai AS kesesuaian, "N" AS status, "" AS keterangan,
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
    const [mkbRows] = await db.query(
      `SELECT d.mkbd_bhn_kode AS kode, b.bhn_name, b.bhn_satuan,
              d.mkbd_komponen AS komponen, d.mkbd_warna AS warna,
              0 AS babaran, 0 AS babarank
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
      const [realisasiRows] = await db.query(
        `SELECT DISTINCT
            pd.promind_kodem AS kode,
            b.bhn_name, b.bhn_satuan,
            md.mind_komponen AS komponen,
            0 AS babaran,
            0 AS babarank
         FROM tproduksiminta_dtl pd
         INNER JOIN tproduksiminta_hdr ph ON ph.promin_nomor = pd.promind_promin_Nomor
         INNER JOIN tmintabahan_hdr mh ON mh.min_nomor = ph.promin_minta
         LEFT JOIN tmintabahan_dtl md ON md.mind_nomor = mh.min_nomor AND md.mind_bhn_kode = pd.promind_kodem
         LEFT JOIN tbahan b ON b.bhn_kode = pd.promind_kodem
         WHERE mh.min_spk_nomor = ? AND ph.promin_aktif = 'Y'`,
        [nomorMap],
      );
      komponen = realisasiRows;
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

  // Kalkulasi babaran
  const [kalkulasiRows] = await db
    .query(
      `SELECT k.kk_komponen, k.kk_warna, k.kk_babaran 
     FROM tmemospk m
     INNER JOIN tmintaharga h ON h.mh_nomor = m.mspk_mh_nomor
     INNER JOIN kalkulasi.tkalkulasi2_komponen k ON k.kk_nomor = h.mh_nomor_kalkulasi
     WHERE m.mspk_nomor = ? ORDER BY k.kk_nourut`,
      [nomorMap],
    )
    .catch(() => [[]]);

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
  let [aksesoris] = await db
    .query(
      `SELECT k.*, o.brg_nama AS acc_nama, o.brg_satuan AS acc_satuan, o.brg_note AS acc_note
     FROM tkesesuaianmap_acc k
     LEFT JOIN tgarmen_brg o ON TRIM(o.brg_kode) = TRIM(k.kode) AND o.brg_jenis = 'ACCESORIES'
     WHERE k.nomor = ? ORDER BY k.no_urut`,
      [nomorMap],
    )
    .catch(() => [[]]);

  if (aksesoris.length === 0) {
    const [mintaRows] = await db
      .query(
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
      )
      .catch(() => [[]]);
    aksesoris = mintaRows;
  }

  // 5. Load Obat
  const [obat] = await db
    .query(
      `SELECT k.*, o.brg_nama AS jenisobat
     FROM tkesesuaianmap_obat k
     LEFT JOIN tgarmen_brg o ON o.brg_kode = k.ko_kode AND o.brg_jenis = 'OBAT'
     WHERE k.ko_nomor = ? ORDER BY k.no_urut`,
      [nomorMap],
    )
    .catch(() => [[]]);

  // 6. Load Breakdown Size
  const [sizeBreakdown] = await db
    .query(
      `SELECT ks_komponen AS komponen, ks_size AS size, ks_babaran AS babaran
     FROM tkesesuaianmap_size WHERE ks_nomor = ? ORDER BY ks_urut`,
      [nomorMap],
    )
    .catch(() => [[]]);

  // 7. Check Lock Status
  const [lockStatus] = await db.query(
    `SELECT * FROM tkesesuaianmap_lock WHERE map = ? LIMIT 1`,
    [nomorMap],
  );
  let lockData = lockStatus[0] || null;
  let globalLockWarning = "";

  // Cek Global Lock 6 Hari (Untuk BAST Baru)
  if (checklist.some((c) => c.date_create === null)) {
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

// --- SAVE BAST DATA ---
const saveBastData = async (payload, userKode, userCabang) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const {
      header = {},
      checklist = [],
      komponen = [],
      obat = [],
      aksesoris = [],
      sizeBreakdown = [],
      payloadLock = {},
    } = payload;
    const nomorMap = header.mspk_nomor || header.MSPK_Nomor || header.Nomor;

    if (!nomorMap) throw new Error("Nomor MAP tidak ditemukan pada payload.");

    // 1. Update tmemospk (Header MAP)
    await conn.query(
      `UPDATE tmemospk SET 
         mspk_jumlah_jadi = ?, mspk_kendala = ?, mspk_tipe = ?, mspk_bastnew = ?
       WHERE mspk_nomor = ?`,
      [
        header.mspk_jumlah_jadi || header.JumlahJadi || 0,
        header.mspk_kendala || header.Kendala || "",
        header.mspk_tipe || header.Tipe || "",
        1,
        nomorMap,
      ],
    );

    // 2. Sync Checklist (tkesesuaianmap) — hanya 4 item, sisa Babaran lama dibersihkan
    await conn.query(
      `DELETE FROM tkesesuaianmap WHERE mspk_nomor = ? AND kode_sesuai NOT IN (1, 2, 3, 4)`,
      [nomorMap],
    );
    for (const item of checklist) {
      const kodeSesuai = Number(item.no || item.kode);
      if (![1, 2, 3, 4].includes(kodeSesuai)) continue;
      // Aturan: keterangan diisi → status otomatis Y (ditegakkan di server).
      const ket = String(item.keterangan ?? "").trim();
      const status = ket ? "Y" : item.status || "N";
      const [existing] = await conn.query(
        `SELECT kode_sesuai FROM tkesesuaianmap WHERE mspk_nomor = ? AND kode_sesuai = ?`,
        [nomorMap, kodeSesuai],
      );

      if (existing.length === 0) {
        await conn.query(
          `INSERT INTO tkesesuaianmap (mspk_nomor, kode_sesuai, status, keterangan, user_create, date_create)
           VALUES (?, ?, ?, ?, ?, NOW())`,
          [nomorMap, kodeSesuai, status, ket || "", userKode],
        );
      } else {
        await conn.query(
          `UPDATE tkesesuaianmap SET 
             status = ?, keterangan = ?, user_modify = ?, date_modify = NOW()
           WHERE mspk_nomor = ? AND kode_sesuai = ?`,
          [status, ket || "", userKode, nomorMap, kodeSesuai],
        );
      }
    }

    // 3. Sync Komponen
    await conn.query(`DELETE FROM tkesesuaianmap_komponen WHERE nomor = ?`, [
      nomorMap,
    ]);
    for (let i = 0; i < komponen.length; i++) {
      const k = komponen[i];
      if (k.komponen && String(k.komponen).trim() !== "") {
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

    // 4. Sync Obat
    await conn.query(`DELETE FROM tkesesuaianmap_obat WHERE ko_nomor = ?`, [
      nomorMap,
    ]);
    for (let i = 0; i < obat.length; i++) {
      const o = obat[i];
      if (o.kode && String(o.kode).trim() !== "") {
        await conn.query(
          `INSERT INTO tkesesuaianmap_obat (ko_nomor, ko_kode, ko_qty, ko_harga, no_urut, date_create)
           VALUES (?, ?, ?, ?, ?, NOW())`,
          [nomorMap, o.kode, o.qty || 0, o.harga || 0, i + 1],
        );
      }
    }

    // 5. Sync Aksesoris
    await conn.query(`DELETE FROM tkesesuaianmap_acc WHERE nomor = ?`, [
      nomorMap,
    ]);
    for (let i = 0; i < aksesoris.length; i++) {
      const a = aksesoris[i];
      const accNama = a.nama || a.acc_nama;
      if (accNama && String(accNama).trim() !== "" && Number(a.qty) !== 0) {
        await conn.query(
          `INSERT INTO tkesesuaianmap_acc (nomor, kode, qty, no_urut) VALUES (?, ?, ?, ?)`,
          [nomorMap, a.kode || "", a.qty, i + 1],
        );
      }
    }

    // 6. Sync Size Breakdown
    await conn.query(`DELETE FROM tkesesuaianmap_size WHERE ks_nomor = ?`, [
      nomorMap,
    ]);
    let urutSize = 1;
    for (let i = 0; i < sizeBreakdown.length; i++) {
      const s = sizeBreakdown[i];
      if (s.komponen && String(s.komponen).trim() !== "") {
        await conn.query(
          `INSERT INTO tkesesuaianmap_size (ks_nomor, ks_komponen, ks_size, ks_babaran, ks_urut)
           VALUES (?, ?, ?, ?, ?)`,
          [nomorMap, s.komponen, s.size || "", s.babaran || 0, urutSize],
        );
        urutSize++;
      }
    }

    // 7. Handle Lock Status
    const { isLocked, isApproved, alasan } = payloadLock || {};
    if (isLocked && !isApproved) {
      await conn.query(
        `INSERT INTO tkesesuaianmap_lock (map, tgl, cab) VALUES (?, DATE(NOW()), ?)
         ON DUPLICATE KEY UPDATE apv = "N"`,
        [nomorMap, userCabang],
      );
    } else if (isApproved) {
      await conn.query(
        `UPDATE tkesesuaianmap_lock SET apv = "Y", alasan = ?, approved = ? WHERE map = ?`,
        [alasan || "", userKode, nomorMap],
      );
    } else if (!isLocked) {
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

// --- Kandidat nomor untuk mencari LHK Proof ---
// Proof bisa dicatat atas nomor MAP maupun nomor SPK turunannya, maka cari
// di: nomor MAP itu sendiri + SPK ber-FK spk_memo + SPK konvensi MAP-xxx→xxx
// (konsisten dengan relationship map MMT).
const proofTargetNomors = async (queryable, nomorMap) => {
  const targets = [nomorMap];
  const [derived] = await queryable.query(
    `SELECT spk_nomor FROM tspk WHERE TRIM(spk_memo) = TRIM(?) LIMIT 20`,
    [nomorMap],
  );
  for (const r of derived || []) {
    const s = String(r.spk_nomor || "").trim();
    if (s && !targets.includes(s)) targets.push(s);
  }
  const m = String(nomorMap || "").trim();
  if (m.toUpperCase().startsWith("MAP-")) {
    const suffix = m.slice(4).trim();
    if (suffix && !targets.includes(suffix)) targets.push(suffix);
  }
  return targets;
};

// --- GET DETAIL BAST (Form Edit / View) ---
const getBastDetail = async (nomor) => {
  if (!nomor) throw new Error("Nomor BAST wajib diisi.");

  const [mapRows] = await db.query(
    `SELECT
       m.mspk_nomor AS Nomor,
       m.mspk_tanggal AS Tanggal,
       m.mspk_nama AS Nama,
       m.mspk_nama2 AS Nama2,
       m.mspk_ukuran AS Ukuran,
       m.mspk_kain AS Kain,
       m.mspk_finishing AS Finishing,
       m.mspk_gramasi AS Gramasi,
       m.mspk_rencana_size AS RencanaSize,
       m.mspk_keterangan AS Keterangan,
       m.mspk_kendala AS Kendala,
       m.mspk_jumlah AS Jumlah,
       m.mspk_jumlah_jadi AS JumlahJadi,
       m.mspk_tipe AS Tipe,
       m.mspk_cab AS Cabang,
       m.mspk_workshop AS Workshop,
       m.mspk_sublim AS Sublim
     FROM tmemospk m
     WHERE m.mspk_nomor = ?
     LIMIT 1`,
    [nomor],
  );
  if (mapRows.length === 0) return null;
  const map = mapRows[0];

  const [checklist] = await db.query(
    `SELECT kode_sesuai AS no, kode_sesuai AS kode, status, keterangan
     FROM tkesesuaianmap WHERE mspk_nomor = ? ORDER BY kode_sesuai`,
    [nomor],
  );

  const [komponen] = await db.query(
    `SELECT c.nomor, c.kode, c.komponen, c.ketk, c.warna,
            c.babaran, c.babarank, c.mkb, c.no_urut,
            b.bhn_name AS bhn_name, b.bhn_satuan AS bhn_satuan
     FROM tkesesuaianmap_komponen c
     LEFT JOIN tbahan b ON b.bhn_kode = c.kode
     WHERE c.nomor = ? ORDER BY c.no_urut, c.kode`,
    [nomor],
  );

  const [obat] = await db.query(
    `SELECT o.ko_nomor AS nomor, o.ko_kode AS kode, o.ko_qty AS qty,
            o.ko_harga AS harga, o.no_urut,
            b.bhn_name AS nama, b.bhn_satuan AS satuan
     FROM tkesesuaianmap_obat o
     LEFT JOIN tbahan b ON b.bhn_kode = o.ko_kode
     WHERE o.ko_nomor = ? ORDER BY o.no_urut`,
    [nomor],
  );

  const [acc] = await db
    .query(
      `SELECT k.kode AS kode, b.bhn_name AS nama, b.bhn_satuan AS satuan, k.qty
     FROM tkesesuaianmap_acc k
     LEFT JOIN tbahan b ON b.bhn_kode = k.kode
     WHERE k.nomor = ? ORDER BY k.kode`,
      [nomor],
    )
    .catch(() => [[]]);

  const [sizeRows] = await db
    .query(
      `SELECT ks_komponen AS komponen, ks_size AS size, ks_babaran AS babaran
     FROM tkesesuaianmap_size WHERE ks_nomor = ? ORDER BY ks_urut, ks_size`,
      [nomor],
    )
    .catch(() => [[]]);

  const [lockRows] = await db.query(
    `SELECT map, tgl, cab, apv, approved, alasan
     FROM tkesesuaianmap_lock WHERE map = ? LIMIT 1`,
    [nomor],
  );
  const lock = lockRows[0] || null;

  const proofTargets = await proofTargetNomors(db, nomor);
  const proofPh = proofTargets.map(() => "?").join(",");
  const [proofRows] = await db.query(
    `SELECT h.lpr_nomor AS nomor_proof,
            DATE_FORMAT(h.lpr_tanggal, '%Y-%m-%d') AS tanggal_proof,
            d.lprd_spk_nomor AS spk_nomor,
            d.lprd_bahan AS bahan,
            d.lprd_barcode AS barcode,
            d.lprd_panjang AS panjang,
            d.lprd_lebar AS lebar,
            d.lprd_j_proof AS j_proof,
            d.lprd_j_meter AS j_meter,
            s.mst_brg_kode AS kode_bahan,
            b.brg_nama AS nama_bahan,
            b.brg_satuan AS satuan_bahan
     FROM tlhk_proofmmt_dtl d
     INNER JOIN tlhk_proofmmt_hdr h ON h.lpr_nomor = d.lprd_lpr_nomor
     LEFT JOIN (
       SELECT mst_barcode, MAX(mst_brg_kode) AS mst_brg_kode
       FROM tmasterstok_mmt GROUP BY mst_barcode
     ) s ON s.mst_barcode = REPLACE(TRIM(d.lprd_barcode), '\t', '')
     LEFT JOIN tbarang_mmt b ON b.brg_kode = s.mst_brg_kode
     WHERE TRIM(d.lprd_spk_nomor) IN (${proofPh})
     ORDER BY h.lpr_tanggal DESC, h.lpr_nomor DESC`,
    proofTargets,
  );

  // Jumlah cetak = TOTAL J_Proof seluruh baris proof MAP ini (satu MAP bisa
  // punya beberapa dokumen proof beda bahan/tahap — semuanya dihitung).
  // j_meter satuannya meter bahan (bukan hasil cetak) — hanya dipakai sebagai
  // fallback bila tidak ada satu pun J_Proof terisi (data lama).
  const proofJumlahProof = (proofRows || []).reduce(
    (sum, r) => sum + (Number(r.j_proof) || 0),
    0,
  );
  const proofJumlahMeter = (proofRows || []).reduce(
    (sum, r) => sum + (Number(r.j_meter) || 0),
    0,
  );
  const proofJumlah =
    proofJumlahProof > 0 ? proofJumlahProof : proofJumlahMeter;
  // Satu MAP bisa punya beberapa dokumen proof: header tampilkan semuanya
  // (urutan tanggal DESC) agar konsisten dengan tabel detail bahan.
  const proofNumbers = [
    ...new Set(
      (proofRows || [])
        .map((r) => String(r.nomor_proof || "").trim())
        .filter(Boolean),
    ),
  ];
  const jumlahFromProof = proofJumlah > 0;

  const header = {
    mmpt_nomor: map.Nomor,
    mmpt_tanggal: map.Tanggal,
    mmpt_nama: map.Nama,
    mmpt_nama2: map.Nama2,
    mmpt_ukuran: map.Ukuran,
    mmpt_kain: map.Kain,
    mmpt_finishing: map.Finishing,
    mmpt_gramasi: map.Gramasi,
    mmpt_rencana_size: map.RencanaSize,
    mmpt_keterangan: map.Keterangan,
    mmpt_kendala: map.Kendala,
    mmpt_jumlah_jadi: jumlahFromProof
      ? proofJumlah
      : (map.JumlahJadi ?? map.Jumlah ?? 0),
    mmpt_tipe: map.Tipe || "Standard",
    mmpt_cabang: map.Cabang,
    mmpt_workshop: map.Workshop,
    mmpt_sublim: map.Sublim,
    mmpt_proof_number: proofNumbers.join(", "),
    proof_jumlah: proofJumlah,
    jumlah_from_proof: jumlahFromProof,
  };

  return {
    header,
    // Kesesuaian hanya 4 item (Babaran/no 5 dan kode lain dikecualikan)
    checklist: checklist
      .filter((c) => [1, 2, 3, 4].includes(Number(c.no)))
      .map((c) => ({
        no: c.no,
        kesesuaian:
          c.no === 1
            ? "Bahan"
            : c.no === 2
              ? "Desain"
              : c.no === 3
                ? "Model Finishing"
                : "Ukuran",
        status: c.status,
        keterangan: c.keterangan,
      })),
    komponen: komponen.map((k) => ({
      kode: k.kode || "",
      bhn_name: k.bhn_name || "",
      bhn_satuan: k.bhn_satuan || "",
      komponen: k.komponen || "",
      warna: k.warna || "",
      babaran: Number(k.babaran) || 0,
      babarank: Number(k.babarank) || 0,
    })),
    aksesoris: (acc || []).map((a) => ({
      kode: a.kode || "",
      nama: a.nama || "",
      satuan: a.satuan || "",
      qty: Number(a.qty) || 0,
      note: "",
    })),
    obat,
    acc: acc || [],
    sizeBreakdown: (sizeRows || []).map((s) => ({
      komponen: s.komponen || "",
      size: s.size || "",
      babaran: Number(s.babaran) || 0,
    })),
    lock,
    isLocked: !!lock,
    isApproved: lock?.apv === "Y",
    alasanApproval: lock?.alasan || "",
    proof: proofRows[0] || null,
    proofList: proofRows,
  };
};

// --- PRINT DATA ---
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

// --- GET SIZES (Dropdown Form) ---
const getSizes = async (nomor) => {
  const [mapSize] = await db
    .query(
      `SELECT mspks_size AS size FROM tmemospk_size WHERE mspks_nomor = ? ORDER BY mspks_size`,
      [nomor],
    )
    .catch(() => [[]]);
  if (mapSize && mapSize.length > 0) {
    return mapSize.map((r) => ({ mmpts_size: r.size, size: r.size }));
  }
  const [bastSize] = await db
    .query(
      `SELECT DISTINCT ks_size AS size FROM tkesesuaianmap_size WHERE ks_nomor = ? ORDER BY ks_size`,
      [nomor],
    )
    .catch(() => [[]]);
  return (bastSize || []).map((r) => ({ mmpts_size: r.size, size: r.size }));
};

// --- GET SPK SIZES (Auto Breakdown) ---
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

// --- GET PROOF BY SPK ---
const getProofBySpk = async (spkNomor) => {
  const proofTargets = await proofTargetNomors(db, spkNomor);
  const proofPh = proofTargets.map(() => "?").join(",");
  const [rows] = await db.query(
    `SELECT h.lpr_nomor AS nomor_proof,
            DATE_FORMAT(h.lpr_tanggal, '%Y-%m-%d') AS tanggal_proof,
            d.lprd_spk_nomor AS spk_nomor,
            d.lprd_bahan AS bahan,
            d.lprd_barcode AS barcode,
            d.lprd_panjang AS panjang,
            d.lprd_lebar AS lebar,
            d.lprd_j_proof AS j_proof,
            d.lprd_j_meter AS j_meter,
            s.mst_brg_kode AS kode_bahan,
            b.brg_nama AS nama_bahan,
            b.brg_satuan AS satuan_bahan
     FROM tlhk_proofmmt_dtl d
     INNER JOIN tlhk_proofmmt_hdr h ON h.lpr_nomor = d.lprd_lpr_nomor
     LEFT JOIN (
       SELECT mst_barcode, MAX(mst_brg_kode) AS mst_brg_kode
       FROM tmasterstok_mmt GROUP BY mst_barcode
     ) s ON s.mst_barcode = REPLACE(TRIM(d.lprd_barcode), '\t', '')
     LEFT JOIN tbarang_mmt b ON b.brg_kode = s.mst_brg_kode
     WHERE TRIM(d.lprd_spk_nomor) IN (${proofPh})
     ORDER BY h.lpr_tanggal DESC, h.lpr_nomor DESC
     LIMIT 20`,
    proofTargets,
  );
  return rows;
};

// --- DELETE BAST ---
const deleteBast = async (nomor, userKode) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    await conn.query(`DELETE FROM tkesesuaianmap WHERE mspk_nomor = ?`, [
      nomor,
    ]);
    await conn.query(
      `UPDATE tmemospk SET mspk_jumlah_jadi = 0, mspk_kendala = "", mspk_tipe = NULL WHERE mspk_nomor = ?`,
      [nomor],
    );
    await conn.query(`DELETE FROM tkesesuaianmap_komponen WHERE nomor = ?`, [
      nomor,
    ]);
    await conn.query(`DELETE FROM tkesesuaianmap_obat WHERE ko_nomor = ?`, [
      nomor,
    ]);
    await conn.query(`DELETE FROM tkesesuaianmap_acc WHERE nomor = ?`, [nomor]);
    await conn.query(`DELETE FROM tkesesuaianmap_size WHERE ks_nomor = ?`, [
      nomor,
    ]);
    await conn.query(`DELETE FROM tkesesuaianmap_lock WHERE map = ?`, [nomor]);

    await conn.commit();
    return true;
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
};

// --- GET EXPORT DETAIL ---
const getExportDetail = async (filters, userCabang, userDivisi) => {
  const headers = await getBrowseList(filters, userCabang, userDivisi);
  if (headers.length === 0) return [];

  const mapNomors = headers.map((h) => h.Nomor);
  const placeholders = mapNomors.map(() => "?").join(",");

  const [komponen] = await db.query(
    `
    SELECT
      c.nomor AS Nomor,
      c.kode AS Kode,
      b.bhn_name AS Nama,
      c.babaran AS Qty,
      b.bhn_satuan AS Satuan,
      'KOMPONEN' AS Jenis
    FROM tkesesuaianmap_komponen c
    LEFT JOIN tbahan b ON b.bhn_kode = c.kode
    WHERE c.nomor IN (${placeholders})
  `,
    mapNomors,
  );

  const [obat] = await db.query(
    `
    SELECT
      o.ko_nomor AS Nomor,
      o.ko_kode AS Kode,
      b.bhn_name AS Nama,
      o.ko_qty AS Qty,
      b.bhn_satuan AS Satuan,
      'OBAT' AS Jenis
    FROM tkesesuaianmap_obat o
    LEFT JOIN tbahan b ON b.bhn_kode = o.ko_kode
    WHERE o.ko_nomor IN (${placeholders})
  `,
    mapNomors,
  );

  const allDetails = [...komponen, ...obat];

  return headers.map((h) => ({
    ...h,
    details: allDetails.filter((d) => d.Nomor === h.Nomor),
  }));
};

// --- PRINT HTML (dibuka di tab baru via window.open) ---
const escHtml = (v) => {
  if (v === null || v === undefined) return "";
  return String(v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
};

const fmtTgl = (v) => {
  if (!v) return "-";
  const d = new Date(v);
  if (isNaN(d.getTime())) return escHtml(v);
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
};

const getBastPrintHtml = async (nomorMap) => {
  const data = await getBastDetail(nomorMap);
  if (!data) return null;
  const h = data.header || {};
  const checklist = data.checklist || [];
  const komponen = data.komponen || [];
  const aksesoris = data.aksesoris || [];
  const sizes = data.sizeBreakdown || [];
  const proof = data.proof || null;
  const lock = data.lock || null;

  const rowChecklist =
    checklist.length > 0
      ? checklist
          .map(
            (c, i) => `<tr><td class="c">${i + 1}</td>
          <td>${escHtml(c.kesesuaian || c.kode || "")}</td>
          <td class="c b">${escHtml(c.status || "")}</td>
          <td>${escHtml(c.keterangan || "-")}</td></tr>`,
          )
          .join("")
      : `<tr><td colspan="4" class="c">-</td></tr>`;

  const rowKomponen =
    komponen.length > 0
      ? komponen
          .map(
            (k, i) => `<tr><td class="c">${i + 1}</td>
          <td>${escHtml(k.komponen || "")}</td>
          <td>${escHtml(k.kode || "")}</td>
          <td>${escHtml(k.bhn_name || k.nama || "")}</td>
          <td>${escHtml(k.warna || "")}</td>
          <td class="r">${Number(k.babaran) || 0}</td></tr>`,
          )
          .join("")
      : `<tr><td colspan="6" class="c">-</td></tr>`;

  const rowAksesoris =
    aksesoris.length > 0
      ? aksesoris
          .map(
            (a, i) => `<tr><td class="c">${i + 1}</td>
          <td>${escHtml(a.kode || "")}</td>
          <td>${escHtml(a.nama || "")}</td>
          <td class="r">${Number(a.qty) || 0}</td>
          <td>${escHtml(a.satuan || a.note || "")}</td></tr>`,
          )
          .join("")
      : `<tr><td colspan="5" class="c">-</td></tr>`;

  const rowSizes =
    sizes.length > 0
      ? sizes
          .map(
            (s, i) => `<tr><td class="c">${i + 1}</td>
          <td>${escHtml(s.komponen || "")}</td>
          <td class="c">${escHtml(s.size || "")}</td>
          <td class="r">${Number(s.babaran) || 0}</td></tr>`,
          )
          .join("")
      : `<tr><td colspan="4" class="c">-</td></tr>`;

  const statusApv = data.isApproved
    ? `SUDAH APPROVAL${lock?.approved ? ` oleh ${escHtml(lock.approved)}` : ""}${data.alasanApproval ? ` (${escHtml(data.alasanApproval)})` : ""}`
    : data.isLocked
      ? "ON PROGRESS (menunggu approval)"
      : "TERBUKA";

  return `<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="utf-8" />
<title>BAST MAP ${escHtml(h.mmpt_nomor)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: Arial, sans-serif; font-size: 11pt; color: #000; margin: 0; padding: 16px; }
  .kop { text-align: center; margin-bottom: 6px; }
  .kop h2 { margin: 0; font-size: 16pt; }
  .kop p { margin: 2px 0; font-size: 9pt; color: #333; }
  h3.doc { text-align: center; margin: 10px 0; font-size: 13pt; text-decoration: underline; }
  table.info { width: 100%; border-collapse: collapse; margin-bottom: 10px; font-size: 10pt; }
  table.info td { padding: 2px 6px; vertical-align: top; }
  table.grid { width: 100%; border-collapse: collapse; margin-bottom: 10px; font-size: 10pt; }
  table.grid th, table.grid td { border: 1px solid #000; padding: 4px 6px; }
  table.grid th { background: #eee; }
  .c { text-align: center; } .r { text-align: right; } .b { font-weight: bold; }
  .sec { font-weight: bold; margin: 12px 0 4px; font-size: 11pt; }
  .sig { display: flex; gap: 12px; margin-top: 24px; }
  .sig div { flex: 1; text-align: center; font-size: 10pt; }
  .sig .box { height: 70px; }
  @page { size: A4 portrait; margin: 12mm; }
  @media print {
    body { padding: 0; }
    .no-print { display: none !important; }
  }
</style>
</head>
<body>
<div class="kop"><h2>CV. KENCANA PRINT</h2>
<p>Padakan, RT. 04 / RW. 04, Sawahan, Ngemplak, Boyolali &mdash; Telp. 0271-740634</p></div>
<h3 class="doc">BERITA ACARA KESESUAIAN MAP (BAST)</h3>
<table class="info">
  <tr><td width="18%">No. Order MMT</td><td width="32%">: <b>${escHtml(h.mmpt_nomor)}</b></td>
      <td width="18%">Tanggal</td><td>: ${fmtTgl(h.mmpt_tanggal)}</td></tr>
  <tr><td>Nama Pekerjaan</td><td>: ${escHtml(h.mmpt_nama)}</td>
      <td>Nama Ext</td><td>: ${escHtml(h.mmpt_nama2)}</td></tr>
  <tr><td>Ukuran</td><td>: ${escHtml(h.mmpt_ukuran)}</td>
      <td>Bahan MMT</td><td>: ${escHtml(h.mmpt_kain)}</td></tr>
  <tr><td>Finishing</td><td>: ${escHtml(h.mmpt_finishing)}</td>
      <td>Gramasi</td><td>: ${escHtml(h.mmpt_gramasi)}</td></tr>
  <tr><td>Jumlah Cetak</td><td>: ${Number(h.mmpt_jumlah_jadi) || 0}</td>
      <td>Cabang / Workshop</td><td>: ${escHtml(h.mmpt_cabang)} / ${escHtml(h.mmpt_workshop)} (${escHtml(h.mmpt_sublim)})</td></tr>
  <tr><td>Nomor Proof</td><td>: ${escHtml(h.mmpt_proof_number || (proof && proof.nomor_proof) || "-")}</td>
      <td>Bahan Proof</td><td>: ${escHtml((proof && (proof.nama_bahan || proof.kode_bahan)) || "-")}${proof && proof.barcode ? ` (${escHtml(proof.barcode)})` : ""}</td></tr>
  <tr><td>Status</td><td colspan="3">: <b>${statusApv}</b></td></tr>
</table>
<div class="sec">KESESUAIAN</div>
<table class="grid"><thead><tr><th width="40">No</th><th>Kesesuaian</th><th width="60">Y/N</th><th>Keterangan</th></tr></thead>
<tbody>${rowChecklist}</tbody></table>
<div class="sec">BAHAN MMT &amp; TINTA</div>
<table class="grid"><thead><tr><th width="40">No</th><th>Komponen</th><th>Kode</th><th>Nama Bahan</th><th>Warna</th><th width="80">Babaran</th></tr></thead>
<tbody>${rowKomponen}</tbody></table>
<div class="sec">AKSESORIS / OBAT</div>
<table class="grid"><thead><tr><th width="40">No</th><th>Kode</th><th>Nama</th><th width="80">Qty</th><th>Satuan/Note</th></tr></thead>
<tbody>${rowAksesoris}</tbody></table>
<div class="sec">BABARAN PER SIZE</div>
<table class="grid"><thead><tr><th width="40">No</th><th>Komponen</th><th width="100">Size</th><th width="80">Babaran</th></tr></thead>
<tbody>${rowSizes}</tbody></table>
<div class="sig">
  <div>Dibuat Oleh<br /><div class="box"></div>( .............. )</div>
  <div>Diperiksa (QC)<br /><div class="box"></div>( .............. )</div>
  <div>Disetujui<br /><div class="box"></div>( .............. )</div>
</div>
<div class="no-print" style="margin-top:16px;text-align:center;">
  <button onclick="window.print()" style="padding:8px 24px;font-size:11pt;cursor:pointer;">Cetak</button>
</div>
<script>window.addEventListener('load', function(){ setTimeout(function(){ window.print(); }, 400); });</script>
</body>
</html>`;
};

module.exports = {
  getBrowseList,
  getBastDetail,
  getBastFormData,
  saveBastData,
  getPrintData,
  getBastPrintHtml,
  getSizes,
  getSpkSizes,
  getProofBySpk,
  deleteBast,
  getExportDetail,
};
