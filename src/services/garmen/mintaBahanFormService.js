const db = require("../../config/database");

/**
 * Mendapatkan Daftar Komponen untuk Dropdown Grid
 */
const getKomponenOptions = async () => {
  const [rows] = await db.query(`SELECT komponen FROM tkomponen ORDER BY no`);
  return rows.map((r) => r.komponen);
};

/**
 * Validasi dan Load Data SPK + Auto-populate MKB (Translasi dari procedure planning)
 */
const getSpkDetailsAndMkb = async (
  spkNomor,
  cabang,
  keterangan,
  isEdit = false,
) => {
  // 1. Query SPK dengan UNION (Identik dengan Delphi)
  const querySpk = `
    SELECT * FROM (
      SELECT spk_nomor AS Nomor, spk_nama AS Nama, spk_jumlah AS Jumlah, 
             spk_pending, spk_accpending, spk_ppotong, spk_cmo AS cmo 
      FROM tspk WHERE spk_aktif="Y"
      UNION ALL
      SELECT mspk_nomor AS Nomor, mspk_nama AS Nama, mspk_jumlah AS Jumlah, 
             "" AS spk_pending, "" AS spk_accpending, "" AS spk_ppotong, mspk_cmo AS cmo 
      FROM tmemospk
    ) final WHERE Nomor = ?
  `;
  const [spkRows] = await db.query(querySpk, [spkNomor]);

  if (spkRows.length === 0) throw new Error("No.Spk belum terdaftar.");
  const spk = spkRows[0];

  // 2. Validasi PENDING
  if (spk.spk_pending === "PENDING PENUH" && spk.spk_accpending === "N") {
    throw new Error(
      "No.Spk tsb di pending penuh.\nHubungi marketing jika akan tetap melanjutkan transaksi.",
    );
  }
  if (
    spk.spk_pending === "PENDING SEBAGIAN" &&
    spk.spk_ppotong === "Y" &&
    spk.spk_accpending === "N"
  ) {
    throw new Error(
      "No.Spk tsb di pending dibagian Cuting.\nHubungi marketing jika akan tetap melanjutkan transaksi.",
    );
  }

  // 3. Validasi CMO
  if (!spk.cmo || spk.cmo === "") {
    throw new Error("SPK tsb belum di approve oleh Chief Marketing.");
  }

  // 4. Validasi PLANNING (Hanya untuk Non-MAP)
  // 4. Validasi PLANNING (Hanya untuk Non-MAP)
  if (!spkNomor.toUpperCase().startsWith("MAP")) {
    const [planRows] = await db.query(
      `SELECT SUM(plan_datang) as total_datang
     FROM tplanningspk
     WHERE plan_spk = ?`,
      [spkNomor],
    );
    const totalDatang = planRows[0]?.total_datang || 0;

    if (Number(totalDatang) === 0) {
      throw new Error(
        "SPK tsb belum input planning kedatangan bahan.\nHubungi divisi pembelian.",
      );
    }

    // ← DIGANTI: cek planning Cutting dari SUMBER BARU (web PPIC) DULU,
    // fallback ke tabel lama untuk SPK yang planning-nya masih dari desktop.
    const [cuttingRows] = await db.query(
      `SELECT SUM(qty) AS total_cutting FROM (
       SELECT SUM(plan_qty_jadwal) AS qty
       FROM tplan_ppic_dtl2
       WHERE plan_spk = ? AND plan_divisi = 'CUTTING'
       UNION ALL
       SELECT SUM(plan_cutting) AS qty
       FROM tplanningspk
       WHERE plan_spk = ?
     ) x`,
      [spkNomor, spkNomor],
    );
    const totalCutting = cuttingRows[0]?.total_cutting || 0;

    if (Number(totalCutting) === 0) {
      throw new Error("SPK tsb belum input planning Cutting.");
    }
  }

  // 5. Load MKB
  const queryMkb = `
    SELECT j.mkb_nomor, DATE_FORMAT(j.mkb_tanggal, '%Y-%m-%d') as mkb_tanggal, 
           i.mkbd_bhn_kode, SUM(i.mkbd_babaran) AS babaran, SUM(i.mkbd_jumlah) AS butuh, 
           IFNULL(b.Bhn_Name,"") AS nama, IFNULL(b.Bhn_satuan,"") AS sat,
           CAST(GROUP_CONCAT(i.mkbd_komponen SEPARATOR ", ") AS CHAR) AS komponen
    FROM tmkb_hdr j
    INNER JOIN tmkb_dtl i ON i.mkbd_mkb_nomor = j.MKB_NOMOR
    LEFT JOIN tbahan b ON b.Bhn_kode = i.mkbd_bhn_kode
    WHERE j.MKB_SPK_NOMOR = ?
    GROUP BY i.mkbd_bhn_kode
  `;
  const [mkbRows] = await db.query(queryMkb, [spkNomor]);

  // 6. Validasi CEK BARU
  if (!isEdit && keterangan && keterangan.toUpperCase().includes("BARU")) {
    const [cekBaru] = await db.query(
      `SELECT min_nomor FROM tmintabahan_hdr WHERE min_cab = ? AND min_spk_nomor = ? AND min_ket LIKE "%BARU%"`,
      [cabang, spkNomor],
    );
    if (cekBaru.length > 0) {
      throw new Error(
        `SPK tsb sudah dibuatkan permintaan baru dengan nomor: ${cekBaru[0].min_nomor}\nAlihkan ke tambahan atau lainnya.`,
      );
    }
  }

  // --- RETURN DATA DENGAN LOGIKA MAPPING YANG BARU ---
  return {
    spkInfo: { Nama: spk.Nama, Jumlah: spk.Jumlah },
    mkbHeader:
      mkbRows.length > 0
        ? { nomor: mkbRows[0].mkb_nomor, tanggal: mkbRows[0].mkb_tanggal }
        : null,
    mkbDetails: mkbRows.map((r) => {
      const pcs = Number(spk.Jumlah);
      const babaran = Number(r.babaran) || 1;
      let jumlahMinta = 0;

      // RUMUS DELPHI: Satuan KG dibagi, selain itu dikali
      if (r.sat.toUpperCase() === "KG") {
        jumlahMinta = pcs / babaran;
      } else {
        jumlahMinta = pcs * babaran;
      }

      return {
        kode: r.mkbd_bhn_kode,
        nama: r.nama,
        satuan: r.sat,
        babaran: r.babaran,
        pcs: pcs,
        butuh: r.butuh,
        jumlah: Number(jumlahMinta.toFixed(2)),
        komponen: r.komponen,
        ket: "",
      };
    }),
  };
};

/**
 * Generate Auto Nomor (Delphi: getmaxnomor)
 */
const generateNomor = async (tahun, conn) => {
  const prefix = `MIN${tahun}.`;
  const [rows] = await conn.query(
    `SELECT IFNULL(MAX(RIGHT(min_nomor, 5)), 0) AS jumlah FROM tmintabahan_hdr WHERE LEFT(min_nomor, 8) = ?`,
    [prefix],
  );
  const nextNum = parseInt(rows[0].jumlah, 10) + 1;
  return `${prefix}${String(nextNum).padStart(5, "0")}`;
};

/**
 * Load Data untuk Mode Edit (Delphi: loaddataall)
 */
const getMintaBahan = async (nomor) => {
  const queryHdr = `
    SELECT 
      h.*, 
      IFNULL(k.mkb_nomor, "") AS mkb_nomor, DATE_FORMAT(k.mkb_tanggal, '%Y-%m-%d') AS mkb_tanggal,
      IFNULL(s.spk_nama, m.Mspk_nama) AS namaspk, IFNULL(s.spk_jumlah, m.Mspk_jumlah) AS jumlahspk,
      (SELECT pin_dipakai FROM tspk_pin5 WHERE pin_trs="MINTA BAHAN" AND pin_nomor=h.min_nomor ORDER BY pin_urut DESC LIMIT 1) AS pin_dipakai,
      (SELECT pin_acc FROM tspk_pin5 WHERE pin_trs="MINTA BAHAN" AND pin_nomor=h.min_nomor ORDER BY pin_urut DESC LIMIT 1) AS pin_acc
    FROM tmintabahan_hdr h
    LEFT JOIN tspk s ON s.spk_nomor = h.min_spk_nomor
    LEFT JOIN tmemospk m ON m.mspk_nomor = h.min_spk_nomor
    LEFT JOIN tmkb_hdr k ON k.mkb_spk_nomor = h.min_spk_nomor
    WHERE h.min_nomor = ?
  `;
  const [hdr] = await db.query(queryHdr, [nomor]);
  if (hdr.length === 0) throw new Error("Nomor tsb tidak ditemukan");

  const queryDtl = `
    SELECT 
      d.mind_bhn_kode AS kode, b.Bhn_Name AS nama, b.Bhn_satuan AS satuan,
      d.mind_babaran AS babaran, d.mind_pcs AS pcs, d.mind_jumlah AS jumlah,
      d.mind_komponen AS komponen, d.mind_ket AS ket,
      IFNULL((
        SELECT SUM(i.mkbd_jumlah) FROM tmkb_hdr j 
        INNER JOIN tmkb_dtl i ON i.mkbd_mkb_nomor=j.MKB_NOMOR 
        WHERE j.MKB_SPK_NOMOR=h.min_spk_nomor AND i.mkbd_bhn_kode=d.mind_bhn_kode 
        GROUP BY i.mkbd_bhn_kode
      ), 0) AS butuh
    FROM tmintabahan_dtl d
    INNER JOIN tmintabahan_hdr h ON d.mind_nomor = h.min_nomor
    LEFT JOIN tbahan b ON b.Bhn_kode = d.mind_bhn_kode
    WHERE d.mind_nomor = ?
  `;
  const [dtl] = await db.query(queryDtl, [nomor]);

  return { header: hdr[0], details: dtl };
};

/**
 * Simpan Data Baru / Edit (Delphi: simpandata)
 */
const saveMintaBahan = async (payload, user, isEdit = false) => {
  const conn = await db.getConnection();
  await conn.beginTransaction();

  try {
    let nomor = payload.nomor;
    const dateModified = new Date()
      .toISOString()
      .slice(0, 19)
      .replace("T", " ");

    if (isEdit) {
      const qUpdate = `
        UPDATE tmintabahan_hdr SET 
          min_tanggal = ?, min_cab = ?, min_spk_nomor = ?, min_ket = ?, min_divisi = ?,
          date_modified = ?, user_modified = ?
        WHERE min_nomor = ?
      `;
      await conn.query(qUpdate, [
        payload.tanggal,
        payload.cabang,
        payload.spk,
        payload.keterangan,
        payload.divisi,
        dateModified,
        user.kode,
        nomor,
      ]);

      // Update tspk_pin5 jika status sebelumnya ACC
      if (payload.pin_acc === "Y" && !payload.pin_dipakai) {
        await conn.query(
          `UPDATE tspk_pin5 SET pin_dipakai="Y" WHERE pin_trs="MINTA BAHAN" AND pin_nomor=? AND pin_dipakai=""`,
          [nomor],
        );
      }
      // Hapus detail lama
      await conn.query(`DELETE FROM tmintabahan_dtl WHERE mind_nomor = ?`, [
        nomor,
      ]);
    } else {
      nomor = await generateNomor(payload.tanggal.substring(0, 4), conn);

      // Default Approval Logic
      let min_apv = payload.keterangan === "BARU" ? "" : "N";

      let min_apvmgr = "";
      if (
        ["GANTI BS", "GANTI HILANG", "TAMBAHAN"].includes(payload.keterangan)
      ) {
        min_apvmgr = "N";
      }

      const qInsert = `
        INSERT INTO tmintabahan_hdr 
        (min_nomor, min_tanggal, min_cab, min_divisi, min_spk_nomor, min_ket, min_apv, min_apvmgr, date_create, user_create) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;

      await conn.query(qInsert, [
        nomor,
        payload.tanggal,
        payload.cabang,
        payload.divisi,
        payload.spk,
        payload.keterangan,
        min_apv, // Status Apv Gudang
        min_apvmgr, // Status Apv Manager
        dateModified,
        user.kode,
      ]);
    }

    // Insert Detail Baru
    for (const d of payload.details) {
      if (d.kode && d.nama) {
        const qDtl = `
          INSERT INTO tmintabahan_dtl (mind_nomor, mind_bhn_kode, mind_jumlah, mind_pcs, mind_babaran, mind_komponen, mind_ket) 
          VALUES (?, ?, ROUND(?, 2), ?, ?, ?, ?)
        `;
        await conn.query(qDtl, [
          nomor,
          d.kode,
          d.jumlah || 0,
          d.pcs || 0,
          d.babaran || 0,
          d.komponen || "",
          d.ket || "",
        ]);
      }
    }

    await conn.commit();
    return { nomor };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
};

const getPrintData = async (nomor) => {
  const queryHdr = `
    SELECT 
      h.min_nomor AS Nomor, 
      DATE_FORMAT(h.min_tanggal, '%d %b %Y') AS Tanggal, 
      h.min_ket AS Keterangan, 
      h.min_cab AS Cabang, 
      h.min_divisi AS Divisi, 
      h.min_spk_nomor AS SpkNomor, 
      IFNULL(s.spk_nama, m.Mspk_nama) AS SpkNama
    FROM tmintabahan_hdr h
    LEFT JOIN tspk s ON s.spk_nomor = h.min_spk_nomor
    LEFT JOIN tmemospk m ON m.mspk_nomor = h.min_spk_nomor
    WHERE h.min_nomor = ?
  `;
  const [hdr] = await db.query(queryHdr, [nomor]);
  if (hdr.length === 0) throw new Error("Data tidak ditemukan");

  const queryDtl = `
    SELECT 
      d.mind_bhn_kode AS Kode, 
      b.Bhn_Name AS Nama, 
      b.Bhn_satuan AS Satuan, 
      d.mind_jumlah AS Jumlah, 
      d.mind_komponen AS Komponen, 
      d.mind_ket AS Keterangan
    FROM tmintabahan_dtl d
    LEFT JOIN tbahan b ON b.Bhn_kode = d.mind_bhn_kode
    WHERE d.mind_nomor = ?
    ORDER BY d.mind_bhn_kode
  `;
  const [dtl] = await db.query(queryDtl, [nomor]);

  return { header: hdr[0], details: dtl };
};

module.exports = {
  getKomponenOptions,
  getSpkDetailsAndMkb,
  getMintaBahan,
  saveMintaBahan,
  getPrintData,
};
