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

    const terimaSup = isLainLain ? "AND hh.bpb_sup_kode = ?" : "";
    const terimaParams = isLainLain ? [opts.supKode] : [];

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
          WHERE hh.bpb_po_nomor = h.po_nomor AND COALESCE(NULLIF(dd.bpbd_bhn_kode_old, ''), dd.bpbd_bhn_kode) = d.pod_bhn_kode ${terimaSup}
        ), 0) AS terima
       FROM tpo_hdr h
       INNER JOIN tpo_dtl d ON d.pod_po_nomor = h.po_nomor AND d.pod_status = 0 AND d.pod_bhn_kode <> ''
       LEFT JOIN tbahan b ON d.pod_bhn_kode = b.bhn_kode
       WHERE h.po_nomor = ? ${supFilter}
       GROUP BY h.po_nomor, h.po_tanggal, d.pod_bhn_kode, d.pod_bhn_satuan, b.bhn_name, b.bhn_satuan, d.pod_hargabeli`,
      [...terimaParams, value, ...supParams],
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

  const lainLain = Number(header.po_jenis) === 4;
  const filterPoSup = lainLain ? "AND dd.pod_sup_kode = h.bpb_sup_kode" : "";
  const filterBpbSup = lainLain ? "AND hh.bpb_sup_kode = h.bpb_sup_kode" : "";

  // C. Grid 1: Items BPB Detail
  const [items] = await db.query(
    `SELECT 
      d.bpbd_bhn_kode AS kode, d.bpbd_bhn_kode_old AS kodepo, b.bhn_name AS nama, d.bpbd_mkb AS mkb,
      d.bpbd_bhn_satuan AS satuan, d.bpbd_jumlahyard AS jumlahyard,
      d.bpbd_jumlah AS jumlah, d.bpbd_roll AS roll, d.bpbd_roll AS rollx,
      d.bpbd_nourut AS nourut_bpb,
      d.bpbd_harga AS harga, d.bpbd_gramasi AS gramasi, d.bpbd_warna AS warna,
      d.bpbd_setting AS setting, d.bpbd_spk_nomor AS spk, IFNULL(COALESCE(k.spk_nama, so.so_nama), "") AS namaspk,
      IFNULL((SELECT t.pod_bhn_satuan FROM tpo_dtl t WHERE t.pod_bhn_kode=COALESCE(NULLIF(d.bpbd_bhn_kode_old,''), d.bpbd_bhn_kode) AND t.pod_po_nomor=h.bpb_po_nomor LIMIT 1),"") AS satuanpo,
      IFNULL((SELECT SUM(dd.pod_jumlah) FROM tpo_dtl dd WHERE dd.pod_po_nomor=h.bpb_po_nomor AND dd.pod_bhn_kode=COALESCE(NULLIF(d.bpbd_bhn_kode_old,''), d.bpbd_bhn_kode) ${filterPoSup}),0) AS totalpo,
      IFNULL((SELECT SUM(dd.bpbd_jumlah) FROM tbpb_dtl dd INNER JOIN tbpb_hdr hh ON hh.bpb_nomor=dd.bpbd_bpb_nomor WHERE hh.bpb_po_nomor=h.bpb_po_nomor AND hh.bpb_nomor<>h.bpb_nomor AND COALESCE(NULLIF(dd.bpbd_bhn_kode_old,''), dd.bpbd_bhn_kode)=COALESCE(NULLIF(d.bpbd_bhn_kode_old,''), d.bpbd_bhn_kode) ${filterBpbSup}),0) AS total_terima_lain
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
  const lotByUrut = new Map();
  for (const l of qcLots) {
    const k = Number(l.nourut);
    lotByUrut.set(k, [...(lotByUrut.get(k) || []), l.lot]);
  }

  const mappedItems = items.map((d) => ({
    ...d,
    lot: (lotByUrut.get(Number(d.nourut_bpb)) || []).join(", "),
    terima: Number(d.total_terima_lain),
    kurang: Number(d.totalpo) - Number(d.total_terima_lain),
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
    let usulan = null;
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

      // Usulan kode dihitung ulang di server; hasil kiriman klien tidak dipercaya
      usulan = await susunUsulanKode(conn, lotQc, gerbang.poNomor);
      if (usulan.masalah.length > 0) {
        throw new Error(usulan.masalah.join("\n"));
      }
      if (usulan.kodeBaru.length > 0 && !payload.kodeDisetujui) {
        throw new Error(
          "Kode bahan baru dari hasil QC belum disetujui gudang.",
        );
      }
      await buatMasterKode(conn, usulan.kodeBaru, userKode);
    }

    const { items, poItems, barcodes, statusNgedit } = payload;
    let nomorBPB = header.bpb_nomor;
    const isPO = !!(header.bpb_po_nomor && header.bpb_po_nomor.trim() !== "");

    // A. Validasi Invoice & Tutup Buku
    let dariQc = daftarQc.length > 0;
    const kodeLama = new Map();
    const jumlahLama = new Map();
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

      if (dariQc) {
        const [lama] = await conn.query(
          `SELECT bpbd_bhn_kode, bpbd_bhn_kode_old, bpbd_jumlah FROM tbpb_dtl WHERE bpbd_bpb_nomor = ?`,
          [nomorBPB],
        );
        lama.forEach((r) => {
          kodeLama.set(r.bpbd_bhn_kode, r.bpbd_bhn_kode_old || "");
          jumlahLama.set(
            r.bpbd_bhn_kode,
            bulat2(
              (jumlahLama.get(r.bpbd_bhn_kode) || 0) +
                Number(r.bpbd_jumlah || 0),
            ),
          );
        });
      }
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

    const usulanByKode = new Map(
      (usulan ? usulan.kodeBaru : []).map((k) => [k.kode, k]),
    );
    if (usulan) {
      // Kode induk yang boleh ada = kode PO dari lot yang tetap di kode PO
      const kodeTetapSet = new Set(
        lotQc
          .filter((l) => {
            const e = usulan.perLot.get(keLot(l));
            return e.kode === e.kodePo;
          })
          .map((l) => l.pod_bhn_kode),
      );
      const nourutQcSet = new Set(lotQc.map((l) => Number(l.qc_pod_nourut)));

      for (const item of validItemsToInsert) {
        if (!usulanByKode.has(item.kode) && !kodeTetapSet.has(item.kode)) {
          throw new Error(
            `Kode ${item.kode} tidak termasuk lot QC yang dipilih.`,
          );
        }
      }
      for (const po of poItems || []) {
        if (Number(po.terima) > 0 && !nourutQcSet.has(Number(po.nourut))) {
          throw new Error(
            `Baris PO ${po.nourut} tidak termasuk dokumen QC yang dipilih.`,
          );
        }
      }
      // Jumlah dikunci: harus sama dengan total qty lot QC per kode dan per baris PO
      for (const item of validItemsToInsert) {
        const harus = bulat2(usulan.qtyPerKode.get(item.kode) || 0);
        if (Math.abs(Number(item.jumlah || 0) - harus) > 0.005) {
          throw new Error(
            `Jumlah ${item.kode} harus ${harus} (total lot QC), bukan ${Number(item.jumlah || 0)}.`,
          );
        }
      }
      for (const n of nourutQcSet) {
        const harus = bulat2(usulan.qtyPerNourut.get(n) || 0);
        const baris = (poItems || []).find((p) => Number(p.nourut) === n);
        if (!baris || Math.abs(Number(baris.terima || 0) - harus) > 0.005) {
          throw new Error(
            `Realisasi PO baris ${n} harus ${harus} (total lot QC).`,
          );
        }
      }
      for (const k of usulan.kodeBaru) {
        const baris = validItemsToInsert.find((i) => i.kode === k.kode);
        if (!baris || !(Number(baris.jumlah) > 0)) {
          throw new Error(
            `Kode bahan baru ${k.kode} (${k.nama}) belum diisi jumlahnya.`,
          );
        }
      }
    }
    if (isEdit && dariQc) {
      const jumlahBaru = new Map();
      for (const item of validItemsToInsert) {
        if (!kodeLama.has(item.kode)) {
          throw new Error("Kode bahan pada BPB dari QC tidak boleh diubah.");
        }
        jumlahBaru.set(
          item.kode,
          bulat2((jumlahBaru.get(item.kode) || 0) + Number(item.jumlah || 0)),
        );
      }
      for (const [kode, lama] of jumlahLama) {
        if (Math.abs((jumlahBaru.get(kode) || 0) - lama) > 0.005) {
          throw new Error(
            `Jumlah kode ${kode} pada BPB dari QC tidak boleh diubah.`,
          );
        }
      }
    }

    let nourut1 = 1;
    const nourutByKode = new Map();
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

      // Baris kode baru: kode lama PO disimpan, harga/spesifikasi dari server
      const baru = usulanByKode.get(item.kode);
      const kodeOld = baru ? baru.kodePo : kodeLama.get(item.kode) || "";
      const yard =
        usulan && item.satuan === "MTR"
          ? bulat2(Number(item.jumlah || 0) / YARD_TO_METER)
          : item.jumlahyard || 0;

      await conn.query(
        `
        INSERT INTO tbpb_dtl (
          bpbd_bpb_nomor, bpbd_bhn_kode, bpbd_bhn_kode_old, bpbd_jumlahyard, bpbd_jumlah, bpbd_roll, 
          bpbd_harga, bpbd_bhn_satuan, bpbd_gramasi, bpbd_warna, bpbd_setting, 
          bpbd_mkb, bpbd_spk_nomor, bpbd_nourut
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
        [
          nomorBPB,
          item.kode,
          kodeOld,
          yard,
          item.jumlah || 0,
          item.roll || 0,
          baru ? baru.harga : item.harga || 0,
          item.satuan || "",
          baru ? baru.gramasi : item.gramasi || "",
          baru ? baru.warna : item.warna || "",
          baru ? baru.setting : item.setting || "",
          item.mkb || "",
          item.spk || "",
          nourut1,
        ],
      );
      if (!nourutByKode.has(item.kode)) nourutByKode.set(item.kode, nourut1);
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

    // Tandai lot QC yang sudah diterima di BPB ini.
    // bql_nourut = nomor urut baris BPB tempat lot itu masuk.
    for (const l of lotQc) {
      const kodeHasil = usulan.perLot.get(keLot(l)).kode;
      const urut = nourutByKode.get(kodeHasil);
      if (!urut) {
        throw new Error(
          `Baris BPB untuk kode ${kodeHasil} tidak ditemukan (QC ${l.qc_nomor} lot ${l.qcd_lot}).`,
        );
      }
      await conn.query(
        `INSERT INTO tbpb_qc_lot
           (bql_bpb_nomor, bql_qc_nomor, bql_lot, bql_nourut, bql_qty, bql_qty_roll)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          nomorBPB,
          l.qc_nomor,
          l.qcd_lot,
          urut,
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

// ===================== KODE BAHAN BARU DARI HASIL QC =====================
const TOLERANSI_GRAMASI = 5;
const TOLERANSI_SETTING = 0.5;

const keLot = (l) => `${l.qc_nomor}|${l.qcd_lot}`;
const YARD_TO_METER = 0.9144;
const bulat2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// Bahan MTR: meter = jumlah, yard dihitung. Satuan lain: 0.
const hitungYard = (satuan, jumlah) =>
  satuan === "MTR"
    ? { jumlahmeter: jumlah, jumlahyard: bulat2(jumlah / YARD_TO_METER) }
    : { jumlahmeter: 0, jumlahyard: 0 };

const angka = (s) => Number(String(s).replace(",", "."));

// Gramasi: hanya master berbentuk rentang ("160-170").
// Setting: hanya master berbentuk inci (36", 29'').
const muatMasterKode = async (executor) => {
  const [gram] = await executor.query(
    `SELECT bg_kode, bg_nama FROM tbahan_gramasi`,
  );
  const [sett] = await executor.query(
    `SELECT bs_kode, bs_nama FROM tbahan_setting`,
  );

  const gramasiList = [];
  const gramasiByKode = new Map();
  for (const g of gram) {
    const nama = String(g.bg_nama || "").trim();
    const m = nama.match(/^(\d+(?:[.,]\d+)?)\s*-\s*(\d+(?:[.,]\d+)?)$/);
    const item = {
      kode: String(g.bg_kode).trim(),
      nama,
      bawah: m ? angka(m[1]) : null,
      atas: m ? angka(m[2]) : null,
    };
    gramasiByKode.set(item.kode, item);
    if (m) gramasiList.push(item);
  }

  const settingByKode = new Map();
  const settingByInch = new Map();
  for (const s of sett) {
    const nama = String(s.bs_nama || "").trim();
    const m = nama.match(/^(\d+(?:[.,]\d+)?)\s*(?:"|''|”)$/);
    const item = {
      kode: String(s.bs_kode).trim(),
      nama,
      inci: m ? angka(m[1]) : null,
    };
    settingByKode.set(item.kode, item);
    if (m) {
      const daftar = settingByInch.get(item.inci) || [];
      daftar.push(item);
      settingByInch.set(item.inci, daftar);
    }
  }
  return { gramasiList, gramasiByKode, settingByKode, settingByInch };
};

// Nilai ganda (mis. 42" = kode 42 dan 2K): pilih kode yang sama dengan angkanya
const pilihSettingInci = (master, inci) => {
  const daftar = master.settingByInch.get(inci);
  if (!daftar || daftar.length === 0) return null;
  return (
    daftar.find((x) => x.kode === String(inci)) ||
    [...daftar].sort((a, b) => a.kode.localeCompare(b.kode))[0]
  );
};

// Struktur kode: jenis(1-2) warna(3-5) gramasi(6-7) setting(8-9) project(10)
const evaluasiLot = (lot, master) => {
  const kodePo = String(lot.pod_bhn_kode || "");
  const hasil = { kodePo, kode: kodePo, masalah: [] };
  if (kodePo.length < 9) return hasil;

  const label = `QC ${lot.qc_nomor} lot ${lot.qcd_lot}`;
  const gKode = kodePo.substr(5, 2);
  const sKode = kodePo.substr(7, 2);
  let gBaru = gKode;
  let sBaru = sKode;

  const g = Number(lot.qcd_gramasi_cek) || 0;
  const bandPo = master.gramasiByKode.get(gKode);
  if (g > 0 && bandPo && bandPo.bawah !== null) {
    const diLuar =
      g < bandPo.bawah - TOLERANSI_GRAMASI ||
      g > bandPo.atas + TOLERANSI_GRAMASI;
    if (diLuar) {
      const band = master.gramasiList.find((b) => g >= b.bawah && g < b.atas);
      if (band) gBaru = band.kode;
      else
        hasil.masalah.push(
          `${label}: gramasi ${g} tidak punya kode di master gramasi.`,
        );
    }
  }

  const s = Number(lot.qcd_setting_cek) || 0;
  const settingPo = master.settingByKode.get(sKode);
  const inciPo = settingPo ? settingPo.inci : null;
  if (
    s > 0 &&
    inciPo !== null &&
    Math.abs(s - inciPo) > TOLERANSI_SETTING + 1e-9
  ) {
    const pilih = pilihSettingInci(master, Math.round(s));
    if (pilih) sBaru = pilih.kode;
    else
      hasil.masalah.push(
        `${label}: setting ${s} inci tidak ada di master setting.`,
      );
  }

  if (hasil.masalah.length === 0) {
    hasil.kode = kodePo.substr(0, 5) + gBaru + sBaru + kodePo.substr(9);
  }
  return hasil;
};

// Usulan kode baru untuk seluruh lot QC yang ditarik
const susunUsulanKode = async (executor, lots, poNomor) => {
  const master = await muatMasterKode(executor);
  const [poKode] = await executor.query(
    `SELECT DISTINCT pod_bhn_kode AS kode FROM tpo_dtl
     WHERE pod_po_nomor = ? AND pod_bhn_kode <> ''`,
    [poNomor],
  );
  const kodeDiPo = new Set(poKode.map((r) => r.kode));

  const masalah = [];
  const perLot = new Map();
  const grup = new Map();
  const qtyPerKode = new Map();
  const qtyPerNourut = new Map();

  for (const l of lots) {
    const e = evaluasiLot(l, master);
    perLot.set(keLot(l), e);
    const qtyLot = Number(l.qcd_qty_kg) || 0;
    const sebelum = qtyPerKode.get(e.kode) || 0;
    qtyPerKode.set(e.kode, sebelum + qtyLot);
    const urutPo = Number(l.qc_pod_nourut);
    qtyPerNourut.set(urutPo, (qtyPerNourut.get(urutPo) || 0) + qtyLot);
    masalah.push(...e.masalah);
    if (e.masalah.length > 0 || e.kode === e.kodePo) continue;

    if (kodeDiPo.has(e.kode)) {
      masalah.push(
        `QC ${l.qc_nomor} lot ${l.qcd_lot}: kode hasil QC ${e.kode} sudah dipakai baris lain di PO ini.`,
      );
      continue;
    }

    let g = grup.get(e.kode);
    if (!g) {
      g = {
        kode: e.kode,
        kodePo: e.kodePo,
        poNourut: Number(l.qc_pod_nourut),
        satuan: l.bhn_satuan || "",
        satuanpo: l.pod_bhn_satuan || "",
        harga: Number(l.pod_hargabeli) || 0,
        warna: new Set(),
        qty: 0,
        roll: 0,
        lots: [],
      };
      grup.set(e.kode, g);
    } else if (g.poNourut !== Number(l.qc_pod_nourut)) {
      masalah.push(
        `Kode baru ${e.kode} dihasilkan dari lebih dari satu baris PO. Buat BPB terpisah per dokumen QC.`,
      );
    }
    const w = String(l.qcd_warna || "").trim();
    if (w) g.warna.add(w);
    g.qty += Number(l.qcd_qty_kg) || 0;
    g.roll += Number(l.qcd_qty_roll) || 0;
    g.lots.push({
      qc: l.qc_nomor,
      lot: l.qcd_lot,
      qty: Number(l.qcd_qty_kg) || 0,
      roll: Number(l.qcd_qty_roll) || 0,
    });
  }

  // Kode hasil yang sudah ada di master: aktif dipakai, nonaktif diblokir
  const ada = new Map();
  if (grup.size > 0) {
    const [rows] = await executor.query(
      `SELECT Bhn_kode, bhn_aktif FROM tbahan WHERE Bhn_kode IN (?)`,
      [[...grup.keys()]],
    );
    rows.forEach((r) => ada.set(r.Bhn_kode, Number(r.bhn_aktif)));
  }

  const kodeBaru = [];
  for (const g of grup.values()) {
    if (ada.get(g.kode) === 1) {
      masalah.push(`Kode bahan ${g.kode} sudah ada di master tetapi nonaktif.`);
      continue;
    }
    const pKode = g.kode.substr(9, 1);
    const [[n]] = await executor.query(
      `SELECT IFNULL((SELECT bj_nama FROM tbahan_jenis WHERE bj_kode = ?), '') AS jenis,
              IFNULL((SELECT bw_nama FROM tbahan_warna WHERE bw_kode = ?), '') AS warna,
              IFNULL((SELECT project FROM tbahan_project WHERE kode = ?), '') AS project`,
      [g.kode.substr(0, 2), g.kode.substr(2, 3), pKode],
    );
    const gr = master.gramasiByKode.get(g.kode.substr(5, 2));
    const st = master.settingByKode.get(g.kode.substr(7, 2));
    const nama = [
      n.jenis,
      n.warna,
      gr ? gr.nama : "",
      st ? st.nama : "",
      pKode ? n.project : "",
    ]
      .map((x) => String(x || "").trim())
      .filter(Boolean)
      .join(" ");

    kodeBaru.push({
      ...g,
      nama,
      gramasi: gr ? gr.nama : "",
      setting: st ? st.nama : "",
      warna: [...g.warna].join(", "),
      sudahAda: ada.has(g.kode),
    });
  }

  return {
    perLot,
    masalah: [...new Set(masalah)],
    kodeDiPo,
    kodeBaru,
    qtyPerKode,
    qtyPerNourut,
  };
};

// Master kode baru = salinan master bahan kode PO: satuan, jenis barang, dan
// flag proses ikut disalin. Identitas, stok, harga, dan ket dibuat baru.
const buatMasterKode = async (conn, daftar, userKode) => {
  for (const k of daftar) {
    if (k.sudahAda) continue;
    const [r] = await conn.query(
      `INSERT INTO tbahan (
         Bhn_kode, Bhn_Name, Bhn_satuan, Bhn_jb_kode, Bhn_stok, bhn_buffer,
         Bhn_hargabeli, Bhn_avgcost, bhn_dead, date_create, user_create,
         bhn_GRAMASI, bhn_setting, bhn_ket, bhn_aktif,
         bhn_bordir, potong, qcpotong, cetak, hotpres, qccetak, jahit, lipat
       )
       SELECT ?, ?, Bhn_satuan, Bhn_jb_kode, 0, 0,
              ?, ?, 0, NOW(), ?,
              ?, ?, '', 0,
              bhn_bordir, potong, qcpotong, cetak, hotpres, qccetak, jahit, lipat
       FROM tbahan WHERE Bhn_kode = ?`,
      [
        k.kode,
        k.nama,
        k.harga,
        k.harga,
        userKode,
        k.gramasi,
        k.setting,
        k.kodePo,
      ],
    );
    if (r.affectedRows !== 1) {
      throw new Error(
        `Master bahan PO ${k.kodePo} tidak ditemukan, kode ${k.kode} gagal dibuat.`,
      );
    }
  }
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

  const usulan = await susunUsulanKode(db, lots, poNomor);
  if (usulan.masalah.length > 0) {
    throw new Error(usulan.masalah.join("\n"));
  }

  const data = await validateField("po", poNomor, { lewatiQc: true, supKode });

  // Baris kode PO hanya dirata-ratakan dari lot yang tetap di kode PO
  const tetap = lots.filter((l) => {
    const e = usulan.perLot.get(keLot(l));
    return e.kode === e.kodePo;
  });
  const hasil = ringkasHasilQc(tetap);

  // Hanya baris PO milik dokumen QC yang dipilih (satu QC = satu baris PO).
  // Terima = total qty lot pada baris itu (dikunci, bukan diketik).
  const nourutQc = new Set(lots.map((l) => Number(l.qc_pod_nourut)));
  const poDetails = data.poDetails
    .filter((p) => nourutQc.has(Number(p.nourut)))
    .map((p) => ({
      ...p,
      terima: bulat2(usulan.qtyPerNourut.get(Number(p.nourut)) || 0),
    }));
  const kodeTetap = new Set(tetap.map((l) => l.pod_bhn_kode));
  const spk = spkPerKode(poDetails);

  const kodeBaru = usulan.kodeBaru.map((k) => {
    const induk = data.items.find((d) => d.kode === k.kodePo) || {};
    const satuan = induk.satuan ?? k.satuan;
    const jumlah = bulat2(usulan.qtyPerKode.get(k.kode) || 0);
    return {
      ...k,
      satuan,
      satuanpo: induk.satuanpo ?? k.satuanpo,
      harga: induk.harga ?? k.harga,
      totalpo: induk.totalpo ?? 0,
      terima: induk.terima ?? 0,
      kurang: induk.kurang ?? 0,
      jumlah,
      ...hitungYard(satuan, jumlah),
      ...(spk.get(k.kodePo) || {}),
    };
  });

  return {
    ...data,
    poDetails,
    items: data.items
      .filter((d) => kodeTetap.has(d.kode))
      .map((d) => {
        const jumlah = bulat2(usulan.qtyPerKode.get(d.kode) || 0);
        return {
          ...d,
          ...(hasil.get(d.kode) || {}),
          ...(spk.get(d.kode) || {}),
          jumlah,
          ...hitungYard(d.satuan, jumlah),
        };
      }),
    kodeBaru,
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
