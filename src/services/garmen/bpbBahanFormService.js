const db = require("../../config/database");
const tutupBukuService = require("../tutupBukuService");

// --- HELPER: GENERATE NOMOR BPB ---
// Format Delphi: PBG/00001/YYYY
const generateNomorBPB = async (tanggal) => {
  const dateObj = new Date(tanggal);
  const tahun = dateObj.getFullYear().toString();
  const prefix = "PBG";

  const [rows] = await db.query(
    `SELECT IFNULL(MAX(CAST(SUBSTR(bpb_nomor, 5, 5) AS UNSIGNED)), 0) AS max_val 
     FROM tbpb_hdr 
     WHERE LEFT(bpb_nomor, 3) = ? AND RIGHT(bpb_nomor, 4) = ?`,
    [prefix, tahun],
  );

  const nextNum = parseInt(rows[0].max_val, 10) + 1;
  return `${prefix}/${String(nextNum).padStart(5, "0")}/${tahun}`;
};

// --- HELPER: GENERATE HEADER BARCODE ---
// Format Delphi: BAR.YYMM00001
const generateNomorBarcodeHdr = async (tanggal) => {
  const d = new Date(tanggal);
  const yy = String(d.getFullYear()).slice(-2);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const prefix = `BAR.${yy}${mm}`;

  const [rows] = await db.query(
    `SELECT IFNULL(MAX(CAST(RIGHT(bar_nomor, 5) AS UNSIGNED)), 0) AS max_val 
     FROM tbahan_barcode_hdr 
     WHERE LEFT(bar_nomor, 8) = ?`,
    [prefix],
  );

  const nextNum = parseInt(rows[0].max_val, 10) + 1;
  return `${prefix}${String(nextNum).padStart(5, "0")}`;
};

// --- 1. VALIDASI & TARIK DATA (MIGRASI edtNomorPOExit) ---
const validateField = async (type, value, opts = {}) => {
  if (!value) return { valid: true };
  if (type === "qc") return tarikDariQc(value);

  if (type === "po") {
    // 1. Cek Header PO
    const [hdr] = await db.query(
      `SELECT h.po_nomor, h.po_tanggal, h.po_sup_kode, h.po_close, h.po_jenis,
              s.sup_nama, s.sup_alamat, s.sup_kota, s.sup_top
       FROM tpo_hdr h
       LEFT JOIN tsupplier s ON h.po_sup_kode = s.sup_kode
       WHERE h.po_nomor = ? AND h.po_close NOT IN (1, 9) AND h.po_jenis <> 1
         AND (h.po_jenis = 4 OR s.sup_kode IS NOT NULL)`,
      [value],
    );

    if (hdr.length === 0) {
      const [cekClose] = await db.query(
        `SELECT po_close FROM tpo_hdr WHERE po_nomor = ?`,
        [value],
      );
      if (cekClose.length > 0 && cekClose[0].po_close === 1) {
        throw new Error("PO tersebut sudah diclose.");
      }
      throw new Error(
        "Nomor PO tersebut tidak ada atau tidak valid untuk BPB ini.",
      );
    }

    if (!opts.lewatiQc) await pastikanPoTanpaQc(value);

    // PO Lain-lain: supplier ada di baris PO. Hanya bisa lewat QC (supKode
    // dikirim tarikDariQc), dan hanya baris milik supplier itu yang ditarik.
    const isLainLain = Number(hdr[0].po_jenis) === 4;
    let supFilter = "";
    const supParams = [];
    if (isLainLain) {
      if (!opts.supKode) {
        throw new Error(
          "Supplier PO Lain-lain tidak diketahui. Tarik data melalui dokumen QC Bahan.",
        );
      }
      const [sup] = await db.query(
        `SELECT sup_kode, sup_nama, sup_alamat, sup_kota, sup_top
         FROM tsupplier WHERE sup_kode = ?`,
        [opts.supKode],
      );
      if (sup.length === 0) throw new Error("Supplier PO tidak ditemukan.");
      hdr[0].po_sup_kode = sup[0].sup_kode;
      hdr[0].sup_nama = sup[0].sup_nama;
      hdr[0].sup_alamat = sup[0].sup_alamat;
      hdr[0].sup_kota = sup[0].sup_kota;
      hdr[0].sup_top = sup[0].sup_top;
      supFilter = "AND d.pod_sup_kode = ?";
      supParams.push(opts.supKode);
    }

    // 2. Tarik Detail PO (Grid 2: Realisasi)
    // Sesuai Delphi: SELECT d.pod_bhn_kode, b.bhn_name ... dari tpo_dtl d
    const [poDetails] = await db.query(
      `SELECT 
        d.pod_bhn_kode AS kode, b.bhn_name AS nama, d.pod_namaext AS namaext,
        d.pod_bhn_satuan AS satuan, IFNULL(g.bg_nama,"") AS gramasi, 
        IFNULL(s.bs_nama,"") AS setting, IFNULL(j.bj_nama,"") AS jenis,
        d.pod_jumlah AS jumlahpo, d.pod_hargabeli AS harga,
        IFNULL((
          SELECT SUM(a.bpbd2_jumlah) FROM tbpb_dtl2 a 
          WHERE a.bpbd2_po_nomor = d.pod_po_nomor AND a.bpbd2_nourut = d.pod_nourut
        ), 0) AS sudah,
        d.pod_spk_nomor AS spk, d.pod_mkb_nomor AS mkb, d.pod_nourut AS nourut, COALESCE(k.spk_nama, so.so_nama, "") AS namaspk
       FROM tpo_dtl d
       LEFT JOIN tbahan b ON b.bhn_kode = d.pod_bhn_kode
       LEFT JOIN tbahan_jenis j ON j.bj_kode = LEFT(d.pod_bhn_kode, 2)
       LEFT JOIN tbahan_gramasi g ON g.bg_kode = MID(d.pod_bhn_kode, 6, 2)
       LEFT JOIN tbahan_setting s ON s.bs_kode = RIGHT(d.pod_bhn_kode, 2)
       LEFT JOIN tspk k ON k.spk_nomor = d.pod_spk_nomor
       LEFT JOIN tsalesorder so ON so.so_nomor = d.pod_spk_nomor AND so.so_aktif = 'Y'
       WHERE d.pod_po_nomor = ? AND d.pod_bhn_kode <> '' ${supFilter}
       ORDER BY d.pod_bhn_kode, d.pod_spk_nomor`,
      [value, ...supParams],
    );

    const itemsGrid2 = poDetails.map((d) => ({
      ...d,
      terima: 0,
      kurang: Number(d.jumlahpo) - Number(d.sudah),
    }));

    // 3. Tarik Rekapitulasi (Grid 1: Bahan)
    // Sesuai Delphi: SELECT ... GROUP BY PO_nomor,po_tanggal,pod_bhn_kode ...
    const [rekapDetails] = await db.query(
      `SELECT 
        d.pod_bhn_kode AS kode, 
        d.pod_bhn_satuan AS satuanpo, 
        b.bhn_name AS nama, 
        b.bhn_satuan AS satuan, 
        SUM(d.pod_jumlah) AS totalpo, 
        d.pod_hargabeli AS harga,
        IFNULL((
          SELECT SUM(dd.bpbd_jumlah) 
          FROM tbpb_dtl dd 
          INNER JOIN tbpb_hdr hh ON hh.bpb_nomor = dd.bpbd_bpb_nomor 
          WHERE hh.bpb_po_nomor = h.po_nomor AND dd.bpbd_bhn_kode = d.pod_bhn_kode
        ), 0) AS terima
       FROM tpo_hdr h
       INNER JOIN tpo_dtl d ON d.pod_po_nomor = h.po_nomor AND d.pod_status = 0 AND d.pod_bhn_kode <> ''
       LEFT JOIN tbahan b ON d.pod_bhn_kode = b.bhn_kode
       WHERE h.po_nomor = ? ${supFilter}
       GROUP BY h.po_nomor, h.po_tanggal, d.pod_bhn_kode, d.pod_bhn_satuan, b.bhn_name, b.bhn_satuan, d.pod_hargabeli`,
      [value, ...supParams],
    );

    // Hitung sisa/kurang untuk Grid 1
    const itemsGrid1 = rekapDetails.map((d) => ({
      ...d,
      kurang: Number(d.totalpo) - Number(d.terima),
    }));

    return {
      valid: true,
      header: {
        po_nomor: hdr[0].po_nomor,
        po_tanggal: hdr[0].po_tanggal,
        sup_kode: hdr[0].po_sup_kode,
        sup_nama: hdr[0].sup_nama,
        sup_alamat: hdr[0].sup_alamat,
        sup_kota: hdr[0].sup_kota,
        jatuhtempo_days: hdr[0].sup_top || 0,
      },
      poDetails: itemsGrid2, // Untuk Grid 2 (Bawah)
      items: itemsGrid1, // Untuk Grid 1 (Atas)
    };
  }

  return { valid: true };
};

// --- 2. GET DETAIL (MODE EDIT) ---
const getDetail = async (nomor) => {
  // A. Get Header & Status
  const [headers] = await db.query(
    `SELECT 
      h.*, 
      IFNULL(s.sup_nama,"") AS nmsup, IFNULL(s.sup_alamat,"") AS alamat, IFNULL(s.sup_kota,"") AS kota,
      IFNULL(p.po_close, 0) AS po_close, DATE_FORMAT(p.po_tanggal, "%Y-%m-%d") AS dtpo,
      p.po_jenis AS po_jenis,
      g.gdg_nama,
      (SELECT bar_nomor FROM tbahan_barcode_hdr WHERE bar_bpb = h.bpb_nomor LIMIT 1) AS no_buat_barcode
     FROM tbpb_hdr h
     LEFT JOIN tsupplier s ON h.bpb_sup_kode = s.sup_kode
     LEFT JOIN tpo_hdr p ON p.po_nomor = h.bpb_po_nomor
     LEFT JOIN tgudang g ON h.bpb_gdg_kode = g.gdg_kode
     WHERE h.bpb_nomor = ?`,
    [nomor],
  );

  if (headers.length === 0) throw new Error("Data BPB tidak ditemukan.");
  const header = headers[0];

  // B. Validasi Invoice (cekstatusinv Delphi)
  let statusNgedit = "AMAN";
  if (header.bpb_status_inv === 1) {
    statusNgedit = "VOUCHER"; // Kunci mutlak di frontend jika sudah ada voucher
  } else {
    // Cek PIN 5
    const [pins] = await db.query(
      `SELECT pin_urut, pin_acc, pin_dipakai FROM tspk_pin5 
       WHERE pin_trs="BPB BAHAN" AND pin_nomor=? ORDER BY pin_urut DESC LIMIT 1`,
      [nomor],
    );

    if (pins.length > 0) {
      const p = pins[0];
      if (p.pin_acc === "" && p.pin_dipakai === "") statusNgedit = "WAIT";
      else if (p.pin_acc === "Y" && p.pin_dipakai === "") statusNgedit = "ACC";
      else if (p.pin_acc === "N") statusNgedit = "TOLAK";
    }
  }

  // Cek Tutup Buku
  const zdtClose = await tutupBukuService.getTanggalTutupBuku();
  let isTutupBuku = false;
  if (
    zdtClose &&
    new Date(header.bpb_tanggal) < zdtClose &&
    statusNgedit !== "ACC" &&
    statusNgedit !== "VOUCHER"
  ) {
    isTutupBuku = true;
  }

  // C. Grid 1: Items BPB Detail
  const [items] = await db.query(
    `SELECT 
      d.bpbd_bhn_kode AS kode, b.bhn_name AS nama, d.bpbd_mkb AS mkb,
      d.bpbd_bhn_satuan AS satuan, d.bpbd_jumlahyard AS jumlahyard,
      d.bpbd_jumlah AS jumlah, d.bpbd_roll AS roll, d.bpbd_roll AS rollx,
      d.bpbd_nourut AS nourut_bpb,
      d.bpbd_harga AS harga, d.bpbd_gramasi AS gramasi, d.bpbd_warna AS warna,
      d.bpbd_setting AS setting, d.bpbd_spk_nomor AS spk, IFNULL(COALESCE(k.spk_nama, so.so_nama), "") AS namaspk,
      IFNULL((SELECT t.pod_bhn_satuan FROM tpo_dtl t WHERE t.pod_bhn_kode=d.bpbd_bhn_kode AND t.pod_po_nomor=h.bpb_po_nomor LIMIT 1),"") AS satuanpo,
      IFNULL((SELECT SUM(dd.pod_jumlah) FROM tpo_dtl dd WHERE dd.pod_po_nomor=h.bpb_po_nomor AND dd.pod_bhn_kode=d.bpbd_bhn_kode),0) AS totalpo,
      IFNULL((SELECT SUM(dd.bpbd_jumlah) FROM tbpb_dtl dd INNER JOIN tbpb_hdr hh ON hh.bpb_nomor=dd.bpbd_bpb_nomor WHERE hh.bpb_po_nomor=h.bpb_po_nomor AND dd.bpbd_bhn_kode=d.bpbd_bhn_kode),0) AS total_terima_all
     FROM tbpb_dtl d
     INNER JOIN tbpb_hdr h ON h.bpb_nomor = d.bpbd_bpb_nomor
     LEFT JOIN tbahan b ON b.bhn_kode = d.bpbd_bhn_kode
     LEFT JOIN tspk k ON k.spk_nomor = d.bpbd_spk_nomor
     LEFT JOIN tsalesorder so ON so.so_nomor = d.bpbd_spk_nomor AND so.so_aktif = 'Y'
     WHERE d.bpbd_bpb_nomor = ? AND d.bpbd_bhn_kode <> ''
     ORDER BY d.bpbd_nourut`,
    [nomor],
  );

  const [qcLots] = await db.query(
    `SELECT bql_qc_nomor AS qc, bql_lot AS lot, bql_nourut AS nourut
     FROM tbpb_qc_lot WHERE bql_bpb_nomor = ? ORDER BY bql_nourut`,
    [nomor],
  );
  const lotByUrut = new Map(qcLots.map((l) => [Number(l.nourut), l.lot]));

  const mappedItems = items.map((d) => ({
    ...d,
    lot: lotByUrut.get(Number(d.nourut_bpb)) || "",
    terima: Number(d.total_terima_all) - Number(d.jumlah),
    kurang: Number(d.totalpo) - Number(d.total_terima_all) + Number(d.jumlah),
  }));

  // D. Grid 2: Items PO Detail (Realisasi)
  const poNomor = header.bpb_po_Nomor || header.bpb_po_nomor || "";

  let poItems = [];
  if (poNomor && poNomor.trim() !== "") {
    const filterSup =
      Number(header.po_jenis) === 4 ? "AND d.pod_sup_kode = ?" : "";
    const paramsGrid2 = [nomor, nomor, poNomor];
    if (filterSup) paramsGrid2.push(header.bpb_sup_kode);
    const [grid2] = await db.query(
      `SELECT 
        d.pod_bhn_kode AS kode, b.bhn_name AS nama, d.pod_namaext AS namaext,
        d.pod_bhn_satuan AS satuan, IFNULL(g.bg_nama,"") AS gramasi, 
        IFNULL(s.bs_nama,"") AS setting, IFNULL(j.bj_nama,"") AS jenis,
        d.pod_jumlah AS jumlahpo, d.pod_mkb_nomor AS mkb, d.pod_spk_nomor AS spk,
        d.pod_nourut AS nourut, IFNULL(COALESCE(k.spk_nama, so.so_nama), "") AS namaspk,
        IFNULL((
          SELECT SUM(a.bpbd2_jumlah) FROM tbpb_dtl2 a 
          WHERE a.bpbd2_bpb_nomor <> ? AND a.bpbd2_po_nomor = d.pod_po_nomor AND a.bpbd2_nourut = d.pod_nourut
        ), 0) AS sudah,
        IFNULL((
          SELECT bpbd2_jumlah FROM tbpb_dtl2 
          WHERE bpbd2_bpb_nomor = ? AND bpbd2_po_nomor = d.pod_po_nomor AND bpbd2_nourut = d.pod_nourut
        ), 0) AS terima
       FROM tpo_dtl d
       LEFT JOIN tbahan b ON b.bhn_kode = d.pod_bhn_kode
       LEFT JOIN tbahan_jenis j ON j.bj_kode = LEFT(d.pod_bhn_kode, 2)
       LEFT JOIN tbahan_gramasi g ON g.bg_kode = MID(d.pod_bhn_kode, 6, 2)
       LEFT JOIN tbahan_setting s ON s.bs_kode = RIGHT(d.pod_bhn_kode, 2)
       LEFT JOIN tspk k ON k.spk_nomor = d.pod_spk_nomor
       LEFT JOIN tsalesorder so ON so.so_nomor = d.pod_spk_nomor AND so.so_aktif = 'Y'
       WHERE d.pod_po_nomor = ? AND d.pod_bhn_kode <> '' ${filterSup}
       ORDER BY d.pod_bhn_kode, d.pod_spk_nomor`,
      paramsGrid2,
    );

    poItems = grid2.map((d) => ({
      ...d,
      kurang: Number(d.jumlahpo) - Number(d.sudah),
    }));
  }

  // E. Grid 3: Barcodes
  const [barcodes] = await db.query(
    `SELECT d.bard_kode AS kode, b.bhn_name AS nama, b.bhn_satuan AS satuan,
          d.bard_barcode AS barcode,
          d.bard_barcode AS barcodex, d.bard_jumlah AS jumlah
     FROM tbahan_barcode_dtl d
     INNER JOIN tbahan_barcode_hdr h ON h.bar_nomor = d.bard_nomor
     LEFT JOIN tbahan b ON b.bhn_kode = d.bard_kode
     WHERE h.bar_bpb = ?
     ORDER BY d.bard_barcode`,
    [nomor],
  );

  return {
    header,
    items: mappedItems,
    poItems,
    barcodes,
    qcLots,
    dariQc: qcLots.length > 0,
    statusNgedit,
    isTutupBuku,
  };
};

// --- 3. SIMPAN DATA TRANSAKSI BESAR ---
const saveData = async (payload, userKode) => {
  const { isEdit, header } = payload;
  const daftarQc =
    !isEdit && Array.isArray(payload.qcNomor)
      ? [
          ...new Set(
            payload.qcNomor.map((q) => String(q).trim()).filter(Boolean),
          ),
        ]
      : [];

  if (!isEdit && String(header?.bpb_po_nomor || "").trim() === "") {
    throw new Error(
      "BPB Non PO sudah dikunci. Buat BPB dari PO atau QC Bahan.",
    );
  }

  // PO yang sudah punya QC Bahan hanya boleh diterima lewat jalur QC
  if (
    !isEdit &&
    daftarQc.length === 0 &&
    header.bpb_po_nomor &&
    header.bpb_po_nomor.trim() !== ""
  ) {
    await pastikanPoTanpaQc(header.bpb_po_nomor);
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // Gerbang QC: dokumen dikunci, harus punya lot LANJUT yang belum diterima,
    // dan PO-nya harus sama dengan PO pada BPB
    let lotQc = [];
    if (daftarQc.length > 0) {
      await conn.query(
        `SELECT qc_nomor FROM tqc_bahan_hdr WHERE qc_nomor IN (?) FOR UPDATE`,
        [daftarQc],
      );
      const gerbang = await muatLotQc(conn, daftarQc);
      if (gerbang.poNomor !== header.bpb_po_nomor) {
        throw new Error("Nomor PO pada BPB tidak sama dengan PO dokumen QC.");
      }
      if (
        gerbang.poJenis === 4 &&
        String(header.bpb_sup_kode || "").trim() !== gerbang.supKode
      ) {
        throw new Error(
          "Supplier BPB tidak sama dengan supplier pada dokumen QC.",
        );
      }
      lotQc = gerbang.lots;
    }

    const { items, poItems, barcodes, statusNgedit } = payload;
    let nomorBPB = header.bpb_nomor;
    const isPO = !!(header.bpb_po_nomor && header.bpb_po_nomor.trim() !== "");

    // A. Validasi Invoice & Tutup Buku
    let dariQc = daftarQc.length > 0;
    if (isEdit) {
      const [cekInv] = await conn.query(
        `SELECT h.bpb_status_inv, h.bpb_po_nomor, h.bpb_sup_kode, p.po_jenis
         FROM tbpb_hdr h
         LEFT JOIN tpo_hdr p ON p.po_nomor = h.bpb_po_nomor
         WHERE h.bpb_nomor=?`,
        [nomorBPB],
      );
      if (cekInv.length === 0) {
        throw new Error("BPB tidak ditemukan.");
      }
      if (cekInv[0].bpb_status_inv === 1) {
        throw new Error(
          "BPB ini sudah dibuat Voucher Pembayaran, tidak bisa di edit",
        );
      }
      const poLama = String(cekInv[0].bpb_po_nomor || "").trim();
      const poBaru = String(header.bpb_po_nomor || "").trim();
      if (poLama !== poBaru) {
        throw new Error("Nomor PO pada BPB tidak boleh diubah.");
      }
      if (
        Number(cekInv[0].po_jenis) === 4 &&
        String(cekInv[0].bpb_sup_kode || "").trim() !==
          String(header.bpb_sup_kode || "").trim()
      ) {
        throw new Error("Supplier BPB PO Lain-lain tidak boleh diubah.");
      }
      const [qcLot] = await conn.query(
        `SELECT 1 FROM tbpb_qc_lot WHERE bql_bpb_nomor = ? LIMIT 1`,
        [nomorBPB],
      );
      dariQc = qcLot.length > 0;
    }

    const zdtClose = await tutupBukuService.getTanggalTutupBuku();
    if (
      zdtClose &&
      new Date(header.bpb_tanggal) < zdtClose &&
      statusNgedit !== "ACC"
    ) {
      throw new Error("Transaksi sudah close. Silakan minta PIN pengajuan.");
    }

    // B. Cek status baris barcode
    let cdone = "DONE";
    if (barcodes && barcodes.length > 0) {
      for (const b of barcodes) {
        if (Number(b.jumlah) === 0) cdone = "BELUM";
      }
    } else {
      cdone = "BELUM"; // Jika sama sekali tidak ada barcode
    }

    // C. INSERT / UPDATE HEADER
    if (!isEdit) {
      nomorBPB = await generateNomorBPB(header.bpb_tanggal);

      const insertHdr = `
        INSERT INTO tbpb_hdr (
          bpb_nomor, bpb_tanggal, bpb_keterangan, bpb_po_nomor, bpb_sup_kode, 
          bpb_gdg_kode, bpb_create_barcode, bpb_jatuhtempo, date_create, user_create
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?)
      `;
      await conn.query(insertHdr, [
        nomorBPB,
        header.bpb_tanggal,
        header.bpb_keterangan,
        header.bpb_po_nomor || "",
        header.bpb_sup_kode,
        header.bpb_gdg_kode,
        cdone,
        header.bpb_jatuhtempo,
        userKode,
      ]);
    } else {
      const updateHdr = `
        UPDATE tbpb_hdr SET 
          bpb_tanggal=?, bpb_keterangan=?, bpb_po_nomor=?, bpb_sup_kode=?, 
          bpb_gdg_kode=?, bpb_jatuhtempo=?, bpb_create_barcode=?, 
          date_modified=NOW(), user_modified=?
        WHERE bpb_nomor=?
      `;
      await conn.query(updateHdr, [
        header.bpb_tanggal,
        header.bpb_keterangan,
        header.bpb_po_nomor || "",
        header.bpb_sup_kode,
        header.bpb_gdg_kode,
        header.bpb_jatuhtempo,
        cdone,
        userKode,
        nomorBPB,
      ]);

      // Bersihkan Detail
      await conn.query(`DELETE FROM tbpb_dtl WHERE bpbd_bpb_nomor=?`, [
        nomorBPB,
      ]);
      await conn.query(`DELETE FROM tbpb_dtl2 WHERE bpbd2_bpb_nomor=?`, [
        nomorBPB,
      ]);
    }

    // D. INSERT DETAIL 1 (tbpb_dtl)
    // ⚠️ FIX: filter baris kode kosong SEBELUM insert — sebelumnya semua
    // baris di array `items` (termasuk baris trailing/kosong yang
    // mungkin lolos dari frontend) ikut ke-insert ke tbpb_dtl, bikin
    // baris hantu ber-kode '' yang muncul duluan di urutan tampilan
    // (string kosong < kode manapun secara alfabet).
    const validItemsToInsert = items.filter(
      (item) => item.kode && String(item.kode).trim() !== "",
    );

    let nourut1 = 1;
    let totalPoSisa = 0;
    let totalBpb = 0;

    for (const item of validItemsToInsert) {
      // Kalkulasi sinkronisasi PO (Sesuai tpo, tbpb Delphi di simpandata)
      totalPoSisa += Number(item.totalpo || 0);
      const jmlTrmPlusBpb = Number(item.terima || 0) + Number(item.jumlah || 0);
      if (jmlTrmPlusBpb > Number(item.totalpo || 0)) {
        totalBpb += Number(item.totalpo || 0);
      } else {
        totalBpb += jmlTrmPlusBpb;
      }

      await conn.query(
        `
        INSERT INTO tbpb_dtl (
          bpbd_bpb_nomor, bpbd_bhn_kode, bpbd_jumlahyard, bpbd_jumlah, bpbd_roll, 
          bpbd_harga, bpbd_bhn_satuan, bpbd_gramasi, bpbd_warna, bpbd_setting, 
          bpbd_mkb, bpbd_spk_nomor, bpbd_nourut
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
        [
          nomorBPB,
          item.kode,
          item.jumlahyard || 0,
          item.jumlah || 0,
          item.roll || 0,
          item.harga || 0,
          item.satuan || "",
          item.gramasi || "",
          item.warna || "",
          item.setting || "",
          item.mkb || "",
          item.spk || "",
          nourut1,
        ],
      );
      nourut1++;
    }

    // E. INSERT DETAIL 2 (tbpb_dtl2) Khusus PO
    if (isPO && poItems && poItems.length > 0) {
      for (const po of poItems) {
        if (Number(po.terima) > 0) {
          await conn.query(
            `
            INSERT INTO tbpb_dtl2 (bpbd2_bpb_nomor, bpbd2_po_nomor, bpbd2_jumlah, bpbd2_nourut)
            VALUES (?, ?, ?, ?)
          `,
            [nomorBPB, header.bpb_po_nomor, po.terima, po.nourut],
          );
        }
      }

      // F. SINKRONISASI STATUS CLOSE PO
      // BPB dari QC: dihitung dari DB untuk seluruh PO (PO Lain-lain multi-supplier
      // tidak boleh CLOSE hanya karena satu supplier selesai).
      if (dariQc) {
        await syncStatusClosePo(conn, header.bpb_po_nomor);
      } else {
        let poCloseStatus = 2; // ONPROSES
        if (totalBpb >= totalPoSisa)
          poCloseStatus = 1; // CLOSE
        else if (totalBpb === 0) poCloseStatus = 0; // OPEN

        await conn.query(`UPDATE tpo_hdr SET po_close=? WHERE po_nomor=?`, [
          poCloseStatus,
          header.bpb_po_nomor,
        ]);
      }
    }

    // Tandai lot QC yang sudah diterima di BPB ini
    for (const [i, l] of lotQc.entries()) {
      await conn.query(
        `INSERT INTO tbpb_qc_lot
           (bql_bpb_nomor, bql_qc_nomor, bql_lot, bql_nourut, bql_qty, bql_qty_roll)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          nomorBPB,
          l.qc_nomor,
          l.qcd_lot,
          i + 1,
          Number(l.qcd_qty_kg) || 0,
          Number(l.qcd_qty_roll) || 0,
        ],
      );
    }

    // G. GENERATE & INSERT BARCODES (tabel barcode hdr & dtl)
    let noBarcodeHdr = header.no_buat_barcode;
    if (barcodes && barcodes.length > 0) {
      if (!noBarcodeHdr) {
        noBarcodeHdr = await generateNomorBarcodeHdr(header.bpb_tanggal);
      }

      await conn.query(
        `
        INSERT INTO tbahan_barcode_hdr (bar_nomor, bar_tanggal, bar_bpb, user_create, date_create)
        VALUES (?, ?, ?, ?, NOW())
        ON DUPLICATE KEY UPDATE bar_bpb = ?
      `,
        [noBarcodeHdr, header.bpb_tanggal, nomorBPB, userKode, nomorBPB],
      );

      // Delphi melakukan delete dtl manual yang count > roll, tapi karena di frontend state nya kita kirim bersih,
      // kita gunakan ON DUPLICATE KEY UPDATE.
      for (const b of barcodes) {
        await conn.query(
          `
          INSERT INTO tbahan_barcode_dtl (bard_nomor, bard_kode, bard_barcode, bard_jumlah)
          VALUES (?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE bard_jumlah = ?
        `,
          [noBarcodeHdr, b.kode, b.barcode, b.jumlah || 0, b.jumlah || 0],
        );
      }
    }

    // H. MATIKAN PIN 5 JIKA ACC
    if (statusNgedit === "ACC") {
      await conn.query(
        `UPDATE tspk_pin5 SET pin_dipakai="Y" WHERE pin_trs="BPB BAHAN" AND pin_nomor=? AND pin_dipakai=""`,
        [nomorBPB],
      );
    }

    await conn.commit();
    return { nomor: nomorBPB, noBarcodeHdr };
  } catch (error) {
    await conn.rollback();
    if (error.code === "ER_DUP_ENTRY" && daftarQc.length > 0) {
      throw new Error(
        "Ada lot QC yang sudah diterima di BPB lain. Muat ulang data QC.",
      );
    }
    throw error;
  } finally {
    conn.release();
  }
};

// --- GET MAX BARCODE (MIGRASI getMaxBarcode DELPHI) ---
const getMaxBarcode = async (kode, tahun) => {
  // Format LIKE: Kode + Tahun + '%'
  const likeFormat = `${kode}${tahun}%`;

  const [rows] = await db.query(
    `SELECT IFNULL(MAX(CAST(RIGHT(bard_barcode, 5) AS UNSIGNED)), 0) AS max_val 
     FROM tbahan_barcode_dtl 
     WHERE bard_barcode LIKE ?`,
    [likeFormat],
  );

  return Number(rows[0].max_val);
};

// ===================== BPB DARI QC BAHAN =====================

// PO yang sudah punya dokumen QC Bahan wajib diterima lewat QC.
// PO lama yang tidak punya QC tetap boleh lewat jalur PO.
const pastikanPoTanpaQc = async (poNomor) => {
  const [jns] = await db.query(
    `SELECT po_jenis FROM tpo_hdr WHERE po_nomor = ?`,
    [poNomor],
  );
  if (jns.length > 0 && Number(jns[0].po_jenis) === 4) {
    throw new Error(
      `PO ${poNomor} adalah PO Lain-lain. Buat BPB dari QC Bahan.`,
    );
  }

  const [rows] = await db.query(
    `SELECT qc_nomor FROM tqc_bahan_hdr WHERE qc_po_nomor = ? LIMIT 1`,
    [poNomor],
  );
  if (rows.length > 0) {
    throw new Error(
      `PO ${poNomor} sudah memiliki QC Bahan (${rows[0].qc_nomor}). Buat BPB dari QC Bahan.`,
    );
  }
};

// Status close PO dihitung dari database per baris PO, bukan dari payload
const syncStatusClosePo = async (conn, poNomor) => {
  const [rows] = await conn.query(
    `SELECT d.pod_jumlah AS po,
            IFNULL((SELECT SUM(a.bpbd2_jumlah) FROM tbpb_dtl2 a
                    WHERE a.bpbd2_po_nomor = d.pod_po_nomor
                      AND a.bpbd2_nourut = d.pod_nourut), 0) AS terima
     FROM tpo_dtl d
     WHERE d.pod_po_nomor = ? AND d.pod_status = 0 AND d.pod_bhn_kode <> ''`,
    [poNomor],
  );
  if (rows.length === 0) return;

  let totalPo = 0;
  let totalTerima = 0;
  for (const r of rows) {
    const po = Number(r.po) || 0;
    totalPo += po;
    totalTerima += Math.min(Number(r.terima) || 0, po);
  }

  let status = 2; // ONPROSES
  if (totalTerima >= totalPo)
    status = 1; // CLOSE
  else if (totalTerima === 0) status = 0; // OPEN

  await conn.query(`UPDATE tpo_hdr SET po_close = ? WHERE po_nomor = ?`, [
    status,
    poNomor,
  ]);
};

// Lot QC siap diterima: keputusan LANJUT dan belum pernah masuk BPB.
// Semua QC yang digabung harus dari PO yang sama.
const muatLotQc = async (executor, daftarQc) => {
  if (daftarQc.length === 0) {
    throw new Error("Pilih minimal satu dokumen QC Bahan.");
  }

  const [rows] = await executor.query(
    `SELECT h.qc_nomor, h.qc_po_nomor, h.qc_pod_nourut,
            d.qcd_nourut, d.qcd_lot, d.qcd_qty_kg, d.qcd_qty_roll, d.qcd_warna,
            d.qcd_gramasi_cek, d.qcd_setting_cek,
            p.pod_bhn_kode, p.pod_bhn_satuan, p.pod_hargabeli, p.pod_jumlah,
            p.pod_mkb_nomor, p.pod_spk_nomor,
            b.bhn_name, b.bhn_satuan,
            ph.po_jenis,
            COALESCE(NULLIF(p.pod_sup_kode, ''), ph.po_sup_kode) AS sup_kode
     FROM tqc_bahan_hdr h
     INNER JOIN tqc_bahan_dtl d ON d.qcd_qc_nomor = h.qc_nomor
     INNER JOIN tpo_dtl p ON p.pod_po_nomor = h.qc_po_nomor
                         AND p.pod_nourut = h.qc_pod_nourut
     LEFT JOIN tpo_hdr ph ON ph.po_nomor = h.qc_po_nomor
     LEFT JOIN tbahan b ON b.bhn_kode = p.pod_bhn_kode
     LEFT JOIN tbpb_qc_lot x ON x.bql_qc_nomor = d.qcd_qc_nomor
                            AND x.bql_lot = d.qcd_lot
     WHERE h.qc_nomor IN (?)
       AND d.qcd_keputusan = 'LANJUT'
       AND x.bql_id IS NULL
     ORDER BY h.qc_nomor, d.qcd_nourut`,
    [daftarQc],
  );

  const ada = new Set(rows.map((r) => r.qc_nomor));
  const kosong = daftarQc.filter((q) => !ada.has(q));
  if (kosong.length > 0) {
    throw new Error(
      `QC ${kosong.join(", ")} tidak punya lot LANJUT yang siap diterima.`,
    );
  }
  if (new Set(rows.map((r) => r.qc_po_nomor)).size > 1) {
    throw new Error("QC yang digabung harus berasal dari PO yang sama.");
  }

  const poJenis = Number(rows[0].po_jenis);
  let supKode = "";
  if (poJenis === 4) {
    if (new Set(rows.map((r) => r.sup_kode || "")).size > 1) {
      throw new Error(
        "QC yang digabung harus berasal dari supplier yang sama.",
      );
    }
    supKode = String(rows[0].sup_kode || "").trim();
    if (!supKode) {
      throw new Error("Supplier baris PO pada dokumen QC tidak terisi.");
    }
  }
  return { poNomor: rows[0].qc_po_nomor, lots: rows, poJenis, supKode };
};

// Daftar QC yang siap dibuatkan BPB (untuk modal pencarian)
const getQcSiap = async (poNomor = "") => {
  const [rows] = await db.query(
    `SELECT h.qc_nomor AS nomor,
            DATE_FORMAT(h.qc_tgl_datang, "%Y-%m-%d") AS tanggal,
            h.qc_po_nomor AS po, h.qc_jenis_kain AS jenis,
            h.qc_vendor_greige AS vendor, h.qc_status AS status,
            COUNT(*) AS jml_lot, SUM(d.qcd_qty_kg) AS qty,
            SUM(d.qcd_qty_roll) AS roll, MAX(p.pod_bhn_satuan) AS satuan,
            COALESCE(NULLIF(p.pod_sup_kode, ''), ph.po_sup_kode) AS sup_kode,
            IFNULL(sp.sup_nama, '') AS supplier
            FROM tqc_bahan_hdr h
     INNER JOIN tpo_hdr ph ON ph.po_nomor = h.qc_po_nomor
                          AND ph.po_close NOT IN (1, 9)
                          AND ph.po_jenis <> 1
     INNER JOIN tqc_bahan_dtl d ON d.qcd_qc_nomor = h.qc_nomor
                               AND d.qcd_keputusan = 'LANJUT'
     INNER JOIN tpo_dtl p ON p.pod_po_nomor = h.qc_po_nomor
                         AND p.pod_nourut = h.qc_pod_nourut
     LEFT JOIN tsupplier sp
            ON sp.sup_kode = COALESCE(NULLIF(p.pod_sup_kode, ''), ph.po_sup_kode)
     LEFT JOIN tbpb_qc_lot x ON x.bql_qc_nomor = d.qcd_qc_nomor
                            AND x.bql_lot = d.qcd_lot
     WHERE x.bql_id IS NULL
       AND (? = '' OR h.qc_po_nomor = ?)
     GROUP BY h.qc_nomor, h.qc_tgl_datang, h.qc_po_nomor, h.qc_jenis_kain,
              h.qc_vendor_greige, h.qc_status,
              COALESCE(NULLIF(p.pod_sup_kode, ''), ph.po_sup_kode), sp.sup_nama
     ORDER BY h.qc_nomor DESC`,
    [poNomor, poNomor],
  );
  return rows;
};

// Ringkas hasil cek lot LANJUT per kode bahan:
// gramasi dan setting = rata-rata tertimbang qty, warna = warna unik digabung
const ringkasHasilQc = (lots) => {
  const hasil = new Map();
  for (const l of lots) {
    const h = hasil.get(l.pod_bhn_kode) || {
      g: 0,
      gBobot: 0,
      s: 0,
      sBobot: 0,
      warna: new Set(),
    };
    const bobot = Number(l.qcd_qty_kg) || 0;
    const g = Number(l.qcd_gramasi_cek) || 0;
    const s = Number(l.qcd_setting_cek) || 0;
    if (g > 0) {
      h.g += g * bobot;
      h.gBobot += bobot;
    }
    if (s > 0) {
      h.s += s * bobot;
      h.sBobot += bobot;
    }
    const w = String(l.qcd_warna || "").trim();
    if (w) h.warna.add(w);
    hasil.set(l.pod_bhn_kode, h);
  }

  const rata = (jumlah, bobot) =>
    bobot > 0 ? String(Math.round((jumlah / bobot) * 100) / 100) : "";

  return new Map(
    [...hasil].map(([kode, h]) => [
      kode,
      {
        gramasi: rata(h.g, h.gBobot),
        setting: rata(h.s, h.sBobot),
        warna: [...h.warna].join(", "),
      },
    ]),
  );
};

// SPK per kode bahan dari baris PO: dipakai kalau semua baris sekode
// yang punya SPK, SPK-nya sama. Kalau berbeda dibiarkan kosong.
const spkPerKode = (poDetails) => {
  const hasil = new Map();
  const bentrok = new Set();
  for (const p of poDetails) {
    const spk = String(p.spk || "").trim();
    if (!spk) continue;
    const ada = hasil.get(p.kode);
    if (!ada) {
      hasil.set(p.kode, { spk, namaspk: p.namaspk || "" });
    } else if (ada.spk !== spk) {
      bentrok.add(p.kode);
    }
  }
  bentrok.forEach((kode) => hasil.delete(kode));
  return hasil;
};

// Gerbang QC lalu tarik data PO seperti BPB PO biasa.
// Gramasi/warna/setting dari hasil QC lot LANJUT, SPK dari baris PO.
const tarikDariQc = async (value) => {
  const daftar = [
    ...new Set(
      String(value)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ];
  const { poNomor, lots, supKode } = await muatLotQc(db, daftar);
  const data = await validateField("po", poNomor, { lewatiQc: true, supKode });
  const hasil = ringkasHasilQc(lots);
  const spk = spkPerKode(data.poDetails);

  return {
    ...data,
    items: data.items.map((d) => ({
      ...d,
      ...(hasil.get(d.kode) || {}),
      ...(spk.get(d.kode) || {}),
    })),
    qcNomor: daftar,
  };
};

module.exports = {
  validateField,
  getDetail,
  saveData,
  getMaxBarcode,
  getQcSiap,
  syncStatusClosePo,
};
