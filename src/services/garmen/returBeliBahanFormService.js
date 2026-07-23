const db = require("../../config/database");

const DEFAULT_GUDANG_KODE = "GB001"; // ✅ hidden default, gak ada field UI-nya

// ─────────────────────────────────────────────────────────
// DEFAULT FORM (mode Baru) — replikasi refreshdata
// ─────────────────────────────────────────────────────────
const getDefaultForm = async () => ({
  tanggal: new Date().toISOString().substring(0, 10),
});

// ─────────────────────────────────────────────────────────
// GENERATE NOMOR — replikasi getmaxnomor('RBB', tahun)
// Format: RBB2026.00001 (increment tahunan, bukan bulanan)
// ─────────────────────────────────────────────────────────
const generateNomor = async (conn, tanggal) => {
  const year = String(new Date(tanggal).getFullYear());
  const prefix = `RBB${year}`;

  const [[row]] = await conn.query(
    `SELECT IFNULL(MAX(RIGHT(ret_nomor, 5)), 0) AS maxNum
     FROM tret_hdr WHERE LEFT(ret_nomor, 7) = ?`,
    [prefix],
  );
  const next = Number(row.maxNum) + 100001;
  return `${prefix}.${String(next).slice(-5)}`;
};

// ─────────────────────────────────────────────────────────
// BPB LOOKUP — replikasi edtbpbExit
// ⚠️ Cuma nerima BPB yang asalnya dari PO (bpb_po_nomor<>"") —
// aturan bisnis eksplisit di Delphi, BPB non-PO ditolak.
// PPN diambil dari PO ASLI (tpo_hdr), bukan dari BPB.
// ─────────────────────────────────────────────────────────
const getBpbByNomor = async (bpbNomor, canLihatBeli) => {
  const [[header]] = await db.query(
    `SELECT h.bpb_nomor AS bpbNomor, h.bpb_tanggal AS bpbTanggal,
            h.bpb_sup_kode AS supKode, s.sup_nama AS supNama,
            s.sup_alamat AS supAlamat, s.sup_kota AS supKota,
            p.po_status_ppn AS ppnChecked, p.po_ppn AS ppnValue
     FROM tbpb_hdr h
     LEFT JOIN tsupplier s ON s.sup_kode = h.bpb_sup_kode
     LEFT JOIN tpo_hdr p ON p.po_nomor = h.bpb_po_nomor
     WHERE h.bpb_po_nomor <> "" AND h.bpb_nomor = ?`,
    [bpbNomor],
  );
  if (!header) throw new Error("BPB tsb belum ada.");

  const [detailRows] = await db.query(
    `SELECT d.bpbd_bhn_kode AS kode, b.bhn_name AS nama, b.bhn_satuan AS satuan,
            d.bpbd_jumlah AS qtybpb, d.bpbd_harga AS harga, d.bpbd_roll AS roll
     FROM tbpb_dtl d
     LEFT JOIN tbahan b ON b.bhn_kode = d.bpbd_bhn_kode
     WHERE d.bpbd_bpb_nomor = ? AND d.bpbd_jumlah <> 0
     ORDER BY d.bpbd_nourut`,
    [bpbNomor],
  );

  const grid2 = detailRows.map((r) => {
    const row = {
      kode: r.kode,
      nama: r.nama,
      satuan: r.satuan,
      qtybpb: Number(r.qtybpb) || 0,
      roll: Number(r.roll) || 0,
      jumlah: 0,
    };
    if (canLihatBeli) {
      row.harga = Number(r.harga) || 0;
      row.total = 0;
    }
    return row;
  });

  return { header, grid2 };
};

// ─────────────────────────────────────────────────────────
// BARCODE SCAN — replikasi clbarcodePropertiesEditValueChanged +
// isbpb(). ⚠️ Cek "barcode sudah discan di baris lain" TIDAK
// direplikasi di sini — itu murni state in-memory grid Delphi,
// jadi ditangani di frontend (state lokal array baris), sama
// persis pola "barang sudah diinput di baris lain" modul lain.
// ─────────────────────────────────────────────────────────
const getBarcodeDetail = async ({ barcode, bpbNomor }) => {
  if (!bpbNomor) throw new Error("No.BPB di isi dulu ya!");

  // ✅ Strip tanda kurung — replikasi stringreplace ckode di Delphi
  // (beberapa alat scan barcode kadang bungkus hasil scan dgn "(...)")
  const ckode = String(barcode || "")
    .replace(/[()]/g, "")
    .trim();
  if (!ckode) throw new Error("Barcode tidak boleh kosong.");

  const [[bpbCheck]] = await db.query(
    `SELECT h.bar_bpb AS barBpb
     FROM tbahan_barcode_dtl d
     INNER JOIN tbahan_barcode_hdr h ON h.bar_nomor = d.bard_nomor
     WHERE d.bard_barcode = ?`,
    [ckode],
  );
  if (!bpbCheck || bpbCheck.barBpb !== bpbNomor) {
    throw new Error("Barcode tsb tidak ada di No.BPB tsb");
  }

  const [[detail]] = await db.query(
    `SELECT a.bard_barcode AS barcode, a.bard_kode AS kode,
            b.Bhn_Name AS nama, b.Bhn_satuan AS satuan,
            IFNULL((
              SELECT SUM(m.mst_stok_in - m.mst_stok_out)
              FROM tmasterstok_barcode m
              WHERE m.mst_aktif = "Y" AND m.mst_brg_kode = a.bard_barcode
            ), 0) AS stok
     FROM tbahan_barcode_dtl a
     INNER JOIN tbahan b ON b.Bhn_kode = a.bard_kode
     WHERE a.bard_barcode = ?`,
    [ckode],
  );
  if (!detail) throw new Error("Barcode tsb tidak terdaftar.");

  const stok = Number(detail.stok) || 0;
  return {
    barcode: detail.barcode,
    kode: detail.kode,
    nama: detail.nama,
    satuan: detail.satuan,
    stok,
    jumlah: stok, // ✅ default jumlah = full stok aktif (sesuai Delphi)
  };
};

// ─────────────────────────────────────────────────────────
// GET FORM DATA (mode Ubah) — replikasi loaddataall
// ─────────────────────────────────────────────────────────
const getFormData = async (nomor, canLihatBeli) => {
  const [[header]] = await db.query(
    `SELECT h.ret_nomor AS nomor, h.ret_tanggal AS tanggal, h.ret_keterangan AS keterangan,
            h.ret_gdg_kode AS gdgKode, h.ret_sup_kode AS supKode, h.ret_bpb_nomor AS bpbNomor,
            h.ret_sts_ppn AS ppnChecked, h.ret_ppn AS ppnValue,
            s.sup_nama AS supNama, s.sup_alamat AS supAlamat, s.sup_kota AS supKota,
            p.bpb_tanggal AS bpbTanggal
     FROM tret_hdr h
     LEFT JOIN tsupplier s ON s.sup_kode = h.ret_sup_kode
     LEFT JOIN tbpb_hdr p ON p.bpb_nomor = h.ret_bpb_nomor
     WHERE h.ret_nomor = ?`,
    [nomor],
  );
  if (!header) throw new Error("Nomor Retur tidak di temukan");

  // ── Grid 1 (tret_dtl2) — per-scan barcode ──
  const [barcodeRows] = await db.query(
    `SELECT d.retd2_barcode AS barcode, d.retd2_bhn_kode AS kode,
            b.bhn_name AS nama, b.bhn_satuan AS satuan, d.retd2_jumlah AS jumlah,
            IFNULL((
              SELECT SUM(m.mst_stok_in - m.mst_stok_out)
              FROM tmasterstok_barcode m
              WHERE m.mst_aktif = "Y" AND m.mst_brg_kode = d.retd2_bhn_kode
            ), 0) AS stokAktif
     FROM tret_dtl2 d
     LEFT JOIN tbahan b ON b.bhn_kode = d.retd2_bhn_kode
     WHERE d.retd2_ret_nomor = ?
     ORDER BY d.retd2_barcode`,
    [nomor],
  );
  const grid1 = barcodeRows.map((r) => ({
    barcode: r.barcode,
    kode: r.kode,
    nama: r.nama,
    satuan: r.satuan,
    jumlah: Number(r.jumlah) || 0,
    // ✅ Stok ditampilkan SEOLAH retur ini belum terjadi (stok aktif +
    // jumlah yg udah diretur ditambahkan balik) — replikasi persis.
    stok: (Number(r.stokAktif) || 0) + (Number(r.jumlah) || 0),
  }));

  // ── Grid 2 (fresh dari tbpb_dtl, cross-match ke tret_dtl buat
  // isi jumlah/total real yang tersimpan) ──
  const [bpbDtlRows] = await db.query(
    `SELECT d.bpbd_bhn_kode AS kode, b.bhn_name AS nama, b.bhn_satuan AS satuan,
            d.bpbd_jumlah AS qtybpb, d.bpbd_harga AS harga, d.bpbd_roll AS roll
     FROM tbpb_dtl d
     LEFT JOIN tbahan b ON b.bhn_kode = d.bpbd_bhn_kode
     WHERE d.bpbd_bpb_nomor = ? AND d.bpbd_jumlah <> 0
     ORDER BY d.bpbd_nourut`,
    [header.bpbNomor],
  );
  const agregatMap = {};
  grid1.forEach((r) => {
    agregatMap[r.kode] = (agregatMap[r.kode] || 0) + (Number(r.jumlah) || 0);
  });

  const grid2 = bpbDtlRows.map((r) => {
    const jumlah = agregatMap[r.kode] || 0;
    const harga = Number(r.harga) || 0;
    const row = {
      kode: r.kode,
      nama: r.nama,
      satuan: r.satuan,
      qtybpb: Number(r.qtybpb) || 0,
      roll: Number(r.roll) || 0,
      jumlah,
    };
    if (canLihatBeli) {
      row.harga = harga;
      row.total = jumlah * harga;
    }
    return row;
  });

  const totalNominal = canLihatBeli
    ? grid2.reduce((s, r) => s + (r.total || 0), 0)
    : null;

  return { header, grid1, grid2, totalNominal };
};

// ─────────────────────────────────────────────────────────
// VALIDASI — replikasi cek F10 SEBELUM simpandata
// ⚠️ cekstatusretur (cek sudah dibuat Voucher Pembayaran) SENGAJA
// tidak diaktifkan — pemanggilannya di-comment di source Delphi
// (non-aktif di production), jadi web ikut TIDAK menegakkan itu.
// ─────────────────────────────────────────────────────────
const validateBeforeSave = (bpbNomor, barcodeRows) => {
  const filled = (barcodeRows || []).filter((r) => r.kode && r.kode.trim());
  if (filled.length === 0) {
    throw new Error("Tidak ada detail,tidak dapat di simpan");
  }
  const totalQty = filled.reduce((s, r) => s + (Number(r.jumlah) || 0), 0);
  if (totalQty === 0) {
    throw new Error("Qty Retur 0 semua , tidak bisa di simpan.");
  }
  if (!bpbNomor) {
    throw new Error("Nomor BPB harus diisi.");
  }
  return filled;
};

// ─────────────────────────────────────────────────────────
// INSERT DETAIL — replikasi bagian tret_dtl2 + tret_dtl di
// simpandata. Agregasi per-kode (replikasi hitung()) dihitung di
// SERVER dari baris barcode yang dikirim, BUKAN dipercaya dari
// frontend. Harga per kode diambil ULANG dari tbpb_dtl (bukan dari
// payload) — frontend gak perlu/gak bisa kirim harga manipulatif.
// ─────────────────────────────────────────────────────────
const insertDetailRows = async (conn, nomor, bpbNomor, filled) => {
  for (const r of filled) {
    await conn.query(
      `INSERT INTO tret_dtl2 (retd2_ret_nomor, retd2_barcode, retd2_bhn_kode, retd2_jumlah)
       VALUES (?, ?, ?, ?)`,
      [nomor, r.barcode || "", r.kode, r.jumlah || 0],
    );
  }

  const agregat = {};
  for (const r of filled) {
    agregat[r.kode] = (agregat[r.kode] || 0) + (Number(r.jumlah) || 0);
  }

  const [hargaRows] = await conn.query(
    `SELECT bpbd_bhn_kode AS kode, bpbd_harga AS harga
     FROM tbpb_dtl WHERE bpbd_bpb_nomor = ?`,
    [bpbNomor],
  );
  const hargaMap = {};
  hargaRows.forEach((h) => {
    hargaMap[h.kode] = Number(h.harga) || 0;
  });

  for (const kode of Object.keys(agregat)) {
    const jumlah = agregat[kode];
    if (jumlah === 0) continue; // replikasi "jumlah<>0" di Delphi
    const harga = hargaMap[kode] || 0;
    await conn.query(
      `INSERT INTO tret_dtl (retd_ret_nomor, retd_bhn_kode, retd_jumlah, retd_harga)
       VALUES (?, ?, ?, ?)`,
      [nomor, kode, jumlah, harga],
    );
  }
};

// ─────────────────────────────────────────────────────────
// CREATE — replikasi simpandata (cabang INSERT)
// ─────────────────────────────────────────────────────────
const create = async (payload, userKode) => {
  const {
    tanggal,
    keterangan,
    bpbNomor,
    supKode,
    ppnChecked,
    ppnValue,
    barcodeRows,
  } = payload;

  const filled = validateBeforeSave(bpbNomor, barcodeRows);

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const nomor = await generateNomor(conn, tanggal);
    const statusPpn = ppnChecked ? 1 : 0;
    const ppn = ppnChecked ? Number(ppnValue) || 0 : 0;

    await conn.query(
      `INSERT INTO tret_hdr
        (ret_nomor, ret_tanggal, ret_keterangan, ret_sup_kode, ret_sts_ppn,
         ret_ppn, ret_bpb_nomor, ret_gdg_kode, date_create, user_create)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?)`,
      [
        nomor,
        tanggal,
        keterangan || "",
        supKode,
        statusPpn,
        ppn,
        bpbNomor,
        DEFAULT_GUDANG_KODE,
        userKode,
      ],
    );

    await insertDetailRows(conn, nomor, bpbNomor, filled);

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
// UPDATE — replikasi simpandata (cabang UPDATE)
// ─────────────────────────────────────────────────────────
const update = async (nomor, payload, userKode) => {
  const {
    tanggal,
    keterangan,
    bpbNomor,
    supKode,
    ppnChecked,
    ppnValue,
    barcodeRows,
  } = payload;

  const filled = validateBeforeSave(bpbNomor, barcodeRows);

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const statusPpn = ppnChecked ? 1 : 0;
    const ppn = ppnChecked ? Number(ppnValue) || 0 : 0;

    await conn.query(
      `UPDATE tret_hdr
       SET ret_tanggal = ?, ret_keterangan = ?, ret_gdg_kode = ?,
           ret_bpb_nomor = ?, ret_sup_kode = ?, ret_sts_ppn = ?, ret_ppn = ?,
           date_modified = NOW(), user_modified = ?
       WHERE ret_nomor = ?`,
      [
        tanggal,
        keterangan || "",
        DEFAULT_GUDANG_KODE,
        bpbNomor,
        supKode,
        statusPpn,
        ppn,
        userKode,
        nomor,
      ],
    );

    await conn.query(`DELETE FROM tret_dtl2 WHERE retd2_ret_nomor = ?`, [
      nomor,
    ]);
    await conn.query(`DELETE FROM tret_dtl WHERE retd_ret_nomor = ?`, [nomor]);

    await insertDetailRows(conn, nomor, bpbNomor, filled);

    await conn.commit();
    return { nomor };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
};

module.exports = {
  getDefaultForm,
  getBpbByNomor,
  getBarcodeDetail,
  getFormData,
  create,
  update,
};
