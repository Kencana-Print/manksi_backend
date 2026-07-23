const db = require("../../config/database");

// ─────────────────────────────────────────────────────────
// DEFAULT FORM (mode Baru) — replikasi refreshdata + FormCreate
// ⚠️ List cabang combo (cbcab) gak ketemu sumbernya di source ini
// (kemungkinan hardcode di .dfm designer) — frontend disaranin
// pakai endpoint lookup yang udah ada (/lookups/cabang-pabrik).
// ─────────────────────────────────────────────────────────
const getDefaultForm = async (userCabang) => ({
  tanggal: new Date().toISOString().substring(0, 10),
  // ✅ replikasi FormCreate: kalau user punya cabang spesifik (bukan
  // HQ), cabang di-lock ke situ; kalau kosong/HO-, user pilih manual.
  cabang: userCabang && userCabang !== "HO-" ? userCabang : "",
  cabangLocked: !!(userCabang && userCabang !== "HO-"),
});

// ─────────────────────────────────────────────────────────
// GENERATE NOMOR — replikasi getmaxnomor (BAR + yymm + 5 digit,
// TANPA titik pemisah)
// ─────────────────────────────────────────────────────────
const generateNomor = async (conn, tanggal) => {
  const d = new Date(tanggal);
  const yy = String(d.getFullYear()).slice(-2);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const prefix = `BAR.${yy}${mm}`;

  const [[row]] = await conn.query(
    `SELECT IFNULL(MAX(RIGHT(bar_nomor, 5)), 0) AS maxNum
     FROM tbahan_barcode_hdr WHERE LEFT(bar_nomor, 8) = ?`,
    [prefix],
  );
  const next = Number(row.maxNum) + 1;
  return `${prefix}${String(next).padStart(5, "0")}`;
};

// ─────────────────────────────────────────────────────────
// GENERATE BARCODE — replikasi getBarcode (kode+2digit tahun+5digit
// urut, urut = MAX existing yg match prefix + index-dlm-batch)
// ─────────────────────────────────────────────────────────
const generateNextBarcode = async (kode, tahun2, ano) => {
  const [[row]] = await db.query(
    `SELECT IFNULL(MAX(RIGHT(bard_barcode, 5)), 0) AS maxSeq
     FROM tbahan_barcode_dtl WHERE bard_barcode LIKE ?`,
    [`${kode}${tahun2}%`],
  );
  const next = 100000 + Number(ano) + Number(row.maxSeq);
  return `${kode}${tahun2}${String(next).slice(-5)}`;
};

// ─────────────────────────────────────────────────────────
// BARANG (mode manual, gak lewat BPB/Retur) — replikasi loadkode
// ⚠️ Filter cuma bhn_aktif=0, TANPA exclude prefix "LL" (beda dari
// modul lain).
// ─────────────────────────────────────────────────────────
const getBarangDetail = async (kode) => {
  const [[row]] = await db.query(
    `SELECT Bhn_kode AS kode, bhn_name AS nama, bhn_satuan AS satuan
     FROM tbahan WHERE bhn_aktif = 0 AND Bhn_kode = ?`,
    [kode],
  );
  if (!row) throw new Error("Kode Bahan tsb tidak ada.");
  return row;
};

// ─────────────────────────────────────────────────────────
// GENERATE BARCODE BUAT ROLL (mode manual) — replikasi
// clrollPropertiesEditValueChanged (cabang rollx=0 / entry manual)
// ─────────────────────────────────────────────────────────
const generateBarcodesForRoll = async ({ kode, nama, roll, tanggal }) => {
  const tahun2 = String(new Date(tanggal).getFullYear()).slice(-2);
  const rows = [];
  for (let i = 1; i <= roll; i++) {
    const barcode = await generateNextBarcode(kode, tahun2, i);
    rows.push({ no: i, kode, nama, barcode, jumlah: 0 });
  }
  return rows;
};

// ─────────────────────────────────────────────────────────
// Helper — bangun grid1+grid2 dari baris sumber (BPB atau Retur)
// ─────────────────────────────────────────────────────────
const buildGridsFromSource = async (detailRows, tanggal) => {
  const grid1 = [];
  const grid2 = [];
  const tahun2 = String(new Date(tanggal).getFullYear()).slice(-2);

  for (const r of detailRows) {
    const roll = Number(r.roll) || 0;
    const jumlah = Number(r.jumlah) || 0;

    grid1.push({
      kode: r.kode,
      kodex: r.kode, // ✅ locked (dari sumber BPB/Retur)
      nama: r.nama,
      satuan: r.satuan,
      jumlah,
      roll,
      rollx: roll, // ✅ locked
    });

    for (let i = 1; i <= roll; i++) {
      const barcode = await generateNextBarcode(r.kode, tahun2, i);
      grid2.push({
        no: i,
        kode: r.kode,
        nama: r.nama,
        barcode,
        // ✅ replikasi: kalau roll=1, jumlah langsung diisi penuh;
        // kalau roll>1, jumlah dikosongin (diisi manual per barcode)
        jumlah: roll === 1 ? jumlah : 0,
      });
    }
  }

  return { grid1, grid2 };
};

// ─────────────────────────────────────────────────────────
// LOOKUP BPB / RETUR — replikasi edtbpbExit (auto-deteksi prefix
// "PBG" = BPB, selain itu = No. Retur Produksi). Kalau nomor ini
// udah pernah dibuatkan barcode, return existingNomor buat redirect
// ke mode edit.
// ⚠️ Beda dari Retur Pembelian Bahan: di sini BPB TIDAK dibatasi
// harus dari PO (gak ada filter bpb_po_nomor<>"").
// ─────────────────────────────────────────────────────────
const getBpbOrRetur = async (inputNomor, tanggal) => {
  const kode = (inputNomor || "").trim();

  const [[existing]] = await db.query(
    `SELECT bar_nomor FROM tbahan_barcode_hdr WHERE bar_bpb = ?`,
    [kode],
  );
  if (existing) {
    return { existingNomor: existing.bar_nomor };
  }

  const isPbg = kode.toUpperCase().startsWith("PBG");

  if (isPbg) {
    const [[bpbHeader]] = await db.query(
      `SELECT bpb_tanggal AS tanggal, bpb_po_nomor AS poNomor
       FROM tbpb_hdr WHERE bpb_nomor = ?`,
      [kode],
    );
    if (!bpbHeader) throw new Error("BPB tsb belum ada.");

    const [detailRows] = await db.query(
      `SELECT d.bpbd_bhn_kode AS kode, b.bhn_name AS nama, b.bhn_satuan AS satuan,
              d.bpbd_jumlah AS jumlah, d.bpbd_roll AS roll
       FROM tbpb_dtl d
       LEFT JOIN tbahan b ON b.bhn_kode = d.bpbd_bhn_kode
       WHERE d.bpbd_bpb_nomor = ?
       ORDER BY d.bpbd_nourut`,
      [kode],
    );

    const { grid1, grid2 } = await buildGridsFromSource(detailRows, tanggal);
    return { poNomor: bpbHeader.poNomor || "", grid1, grid2 };
  }

  const [headRows] = await db.query(
    `SELECT proret_nomor FROM tproduksiretur_hdr WHERE proret_nomor = ?`,
    [kode],
  );
  if (headRows.length === 0) throw new Error("No.Retur tsb belum ada.");

  const [detailRows] = await db.query(
    `SELECT d.proretd_bhn_kode AS kode, b.bhn_name AS nama, b.bhn_satuan AS satuan,
            d.proretd_jumlah AS jumlah, d.proretd_roll AS roll
     FROM tproduksiretur_dtl d
     LEFT JOIN tbahan b ON b.bhn_kode = d.proretd_bhn_kode
     WHERE d.proretd_proret_nomor = ?
     ORDER BY d.proretd_nourut`,
    [kode],
  );

  const { grid1, grid2 } = await buildGridsFromSource(detailRows, tanggal);
  return { poNomor: "", grid1, grid2 };
};

// ─────────────────────────────────────────────────────────
// GET FORM DATA (mode Ubah) — replikasi loaddataall
// ─────────────────────────────────────────────────────────
const getFormData = async (nomor) => {
  const [[header]] = await db.query(
    `SELECT h.bar_nomor AS nomor, h.bar_tanggal AS tanggal, h.bar_bpb AS bpbNomor,
            h.bar_cab AS cabang, j.bpb_tanggal AS bpbTanggal, j.bpb_po_nomor AS poNomor
     FROM tbahan_barcode_hdr h
     LEFT JOIN tbpb_hdr j ON j.bpb_nomor = h.bar_bpb
     WHERE h.bar_nomor = ?`,
    [nomor],
  );
  if (!header) throw new Error("Nomor tersebut belum ada.");

  const [dtlRows] = await db.query(
    `SELECT d.bard_kode AS kode, d.bard_barcode AS barcode, b.bhn_name AS nama,
            b.bhn_satuan AS satuan, d.bard_jumlah AS jumlah
     FROM tbahan_barcode_dtl d
     LEFT JOIN tbahan b ON b.bhn_kode = d.bard_kode
     WHERE d.bard_nomor = ?
     ORDER BY d.bard_nourut`,
    [nomor],
  );

  // ✅ replikasi nomor urut per-kode (reset "i" tiap ganti kode)
  let lastKode = "";
  let i = 1;
  const grid2 = dtlRows.map((r) => {
    if (r.kode !== lastKode) i = 1;
    lastKode = r.kode;
    const row = {
      no: i,
      kode: r.kode,
      nama: r.nama,
      barcode: r.barcode,
      jumlah: Number(r.jumlah) || 0,
    };
    i++;
    return row;
  });

  let grid1 = [];
  if (!header.bpbNomor) {
    // Mode manual — sumber dari tbahan_barcode_det
    const [detRows] = await db.query(
      `SELECT d.bart_kode AS kode, b.Bhn_Name AS nama, b.Bhn_satuan AS satuan,
              d.bart_roll AS roll
       FROM tbahan_barcode_det d
       LEFT JOIN tbahan b ON b.Bhn_kode = d.bart_kode
       WHERE d.bart_nomor = ?`,
      [nomor],
    );
    grid1 = detRows.map((r) => ({
      kode: r.kode,
      kodex: r.kode,
      nama: r.nama,
      satuan: r.satuan,
      jumlah: 0,
      roll: Number(r.roll) || 0,
      rollx: Number(r.roll) || 0,
    }));
  } else if (header.bpbNomor.trim().toUpperCase().startsWith("PBG")) {
    const [srcRows] = await db.query(
      `SELECT d.bpbd_bhn_kode AS kode, b.Bhn_Name AS nama, b.Bhn_satuan AS satuan,
              d.bpbd_Jumlah AS jumlah, d.bpbd_roll AS roll
       FROM tbpb_dtl d
       LEFT JOIN tbahan b ON b.Bhn_kode = d.bpbd_bhn_kode
       WHERE d.bpbd_bpb_Nomor = ?`,
      [header.bpbNomor],
    );
    grid1 = srcRows.map((r) => ({
      kode: r.kode,
      kodex: r.kode,
      nama: r.nama,
      satuan: r.satuan,
      jumlah: Number(r.jumlah) || 0,
      roll: Number(r.roll) || 0,
      rollx: Number(r.roll) || 0,
    }));
  } else {
    const [srcRows] = await db.query(
      `SELECT d.proretd_bhn_kode AS kode, b.Bhn_Name AS nama, b.Bhn_satuan AS satuan,
              d.proretd_Jumlah AS jumlah, d.proretd_roll AS roll
       FROM tproduksiretur_dtl d
       LEFT JOIN tbahan b ON b.Bhn_kode = d.proretd_bhn_kode
       WHERE d.proretd_proret_Nomor = ?
       ORDER BY d.proretd_nourut`,
      [header.bpbNomor],
    );
    grid1 = srcRows.map((r) => ({
      kode: r.kode,
      kodex: r.kode,
      nama: r.nama,
      satuan: r.satuan,
      jumlah: Number(r.jumlah) || 0,
      roll: Number(r.roll) || 0,
      rollx: Number(r.roll) || 0,
    }));
  }

  return { header, grid1, grid2 };
};

// ─────────────────────────────────────────────────────────
// CREATE (simpan penuh, F10) — replikasi simpandata cabang INSERT
// ─────────────────────────────────────────────────────────
const create = async (payload, userKode) => {
  const { tanggal, bpbNomor, cabang, grid1, grid2 } = payload;

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const nomor = await generateNomor(conn, tanggal);

    await conn.query(
      `INSERT INTO tbahan_barcode_hdr
        (bar_nomor, bar_tanggal, bar_bpb, bar_cab, user_create, date_create)
       VALUES (?, ?, ?, ?, ?, NOW())`,
      [nomor, tanggal, bpbNomor || "", cabang, userKode],
    );

    // ✅ replikasi filter insert grid1: nama<>'' AND roll>0
    const g1Filled = (grid1 || []).filter((r) => r.nama && Number(r.roll) > 0);
    for (const r of g1Filled) {
      await conn.query(
        `INSERT INTO tbahan_barcode_det (bart_nomor, bart_kode, bart_roll)
         VALUES (?, ?, ?)`,
        [nomor, r.kode, r.roll],
      );
    }

    // ✅ replikasi filter insert grid2: nama<>''
    const g2Filled = (grid2 || []).filter((r) => r.nama);
    let i = 1;
    for (const r of g2Filled) {
      await conn.query(
        `INSERT INTO tbahan_barcode_dtl
          (bard_nomor, bard_kode, bard_barcode, bard_jumlah, bard_nourut)
         VALUES (?, ?, ?, ?, ?)`,
        [nomor, r.kode, r.barcode, r.jumlah || 0, i],
      );
      i++;
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

// ─────────────────────────────────────────────────────────
// UPDATE (simpan penuh, F10) — replikasi simpandata cabang UPDATE
// ⚠️ bar_bpb & bar_cab TIDAK diubah pas update (cuma tanggal) —
// sesuai source, field itu emang udah di-disable pas mode Ubah.
// ─────────────────────────────────────────────────────────
const update = async (nomor, payload, userKode) => {
  const { tanggal, grid1, grid2 } = payload;

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    await conn.query(
      `UPDATE tbahan_barcode_hdr
       SET bar_tanggal = ?, user_modified = ?, date_modified = NOW()
       WHERE bar_nomor = ?`,
      [tanggal, userKode, nomor],
    );

    await conn.query(`DELETE FROM tbahan_barcode_det WHERE bart_nomor = ?`, [
      nomor,
    ]);
    const g1Filled = (grid1 || []).filter((r) => r.nama && Number(r.roll) > 0);
    for (const r of g1Filled) {
      await conn.query(
        `INSERT INTO tbahan_barcode_det (bart_nomor, bart_kode, bart_roll)
         VALUES (?, ?, ?)`,
        [nomor, r.kode, r.roll],
      );
    }

    await conn.query(`DELETE FROM tbahan_barcode_dtl WHERE bard_nomor = ?`, [
      nomor,
    ]);
    const g2Filled = (grid2 || []).filter((r) => r.nama);
    let i = 1;
    for (const r of g2Filled) {
      await conn.query(
        `INSERT INTO tbahan_barcode_dtl
          (bard_nomor, bard_kode, bard_barcode, bard_jumlah, bard_nourut)
         VALUES (?, ?, ?, ?, ?)`,
        [nomor, r.kode, r.barcode, r.jumlah || 0, i],
      );
      i++;
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

// ─────────────────────────────────────────────────────────
// SAVE ROW QTY (workflow "Langsung Cetak") — replikasi simpanqty.
// Dipanggil tiap 1 baris Grid 2 "Jml Terima/Roll" diisi. Kalau
// isFirstSave, auto-generate nomor + insert semua grid1/grid2
// sekaligus (replikasi cabang baru=true). Kalau bukan, cuma update
// SATU baris via WHERE bard_barcode=... (replikasi persis — TANPA
// filter bard_nomor, sesuai source asli).
// ─────────────────────────────────────────────────────────
const saveRowQty = async (payload, userKode) => {
  const { nomor, tanggal, bpbNomor, cabang, grid1, grid2, isFirstSave, row } =
    payload;

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    let finalNomor = nomor;
    if (isFirstSave) {
      finalNomor = await generateNomor(conn, tanggal);
      await conn.query(
        `INSERT INTO tbahan_barcode_hdr
          (bar_nomor, bar_tanggal, bar_bpb, bar_cab, user_create, date_create)
         VALUES (?, ?, ?, ?, ?, NOW())`,
        [finalNomor, tanggal, bpbNomor || "", cabang, userKode],
      );
    } else {
      await conn.query(
        `UPDATE tbahan_barcode_hdr
         SET bar_tanggal = ?, user_modified = ?, date_modified = NOW()
         WHERE bar_nomor = ?`,
        [tanggal, userKode, finalNomor],
      );
    }

    // Grid1 selalu di-replace total tiap panggilan (replikasi persis)
    await conn.query(`DELETE FROM tbahan_barcode_det WHERE bart_nomor = ?`, [
      finalNomor,
    ]);
    const g1Filled = (grid1 || []).filter((r) => r.nama && Number(r.roll) > 0);
    for (const r of g1Filled) {
      await conn.query(
        `INSERT INTO tbahan_barcode_det (bart_nomor, bart_kode, bart_roll)
         VALUES (?, ?, ?)`,
        [finalNomor, r.kode, r.roll],
      );
    }

    if (isFirstSave) {
      const g2Filled = (grid2 || []).filter((r) => r.nama);
      let i = 1;
      for (const r of g2Filled) {
        await conn.query(
          `INSERT INTO tbahan_barcode_dtl
            (bard_nomor, bard_kode, bard_barcode, bard_jumlah, bard_nourut)
           VALUES (?, ?, ?, ?, ?)`,
          [finalNomor, r.kode, r.barcode, r.jumlah || 0, i],
        );
        i++;
      }
    } else {
      // ⚠️ Replikasi persis — WHERE cuma bard_barcode, gak ada
      // bard_nomor. Aman selama barcode unik global (by design).
      await conn.query(
        `UPDATE tbahan_barcode_dtl SET bard_jumlah = ? WHERE bard_barcode = ?`,
        [row.jumlah || 0, row.barcode],
      );
    }

    await conn.commit();
    return { nomor: finalNomor, shouldPrint: Number(row.jumlah) !== 0 };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
};

// ─────────────────────────────────────────────────────────
// CETAK 1 BARCODE — replikasi cetak() (tanpa temp-table hack,
// langsung query)
// ─────────────────────────────────────────────────────────
const getSingleBarcodeCetak = async (nomor, barcode) => {
  const [[header]] = await db.query(
    `SELECT h.bar_nomor AS nomor, h.bar_bpb AS bpbNomor, j.bpb_po_nomor AS poNomor
     FROM tbahan_barcode_hdr h
     LEFT JOIN tbpb_hdr j ON j.bpb_nomor = h.bar_bpb
     WHERE h.bar_nomor = ?`,
    [nomor],
  );
  if (!header) throw new Error("Data tidak ditemukan.");

  const [[detail]] = await db.query(
    `SELECT d.bard_kode AS kode, d.bard_barcode AS barcode, b.bhn_name AS nama,
            b.bhn_satuan AS satuan, d.bard_jumlah AS jumlah
     FROM tbahan_barcode_dtl d
     LEFT JOIN tbahan b ON b.bhn_kode = d.bard_kode
     WHERE d.bard_nomor = ? AND d.bard_barcode = ?`,
    [nomor, barcode],
  );
  if (!detail) throw new Error("Barcode tidak ditemukan.");

  return {
    nomor: header.nomor,
    po: header.poNomor || "",
    ...detail,
  };
};

module.exports = {
  getDefaultForm,
  getBarangDetail,
  generateBarcodesForRoll,
  getBpbOrRetur,
  getFormData,
  create,
  update,
  saveRowQty,
  getSingleBarcodeCetak,
};
