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
const validateField = async (type, value) => {
  if (!value) return { valid: true };

  if (type === "po") {
    // 1. Cek Header PO
    const [hdr] = await db.query(
      `SELECT h.po_nomor, h.po_tanggal, h.po_sup_kode, h.po_close, 
              s.sup_nama, s.sup_alamat, s.sup_kota, s.sup_top
       FROM tpo_hdr h
       INNER JOIN tsupplier s ON h.po_sup_kode = s.sup_kode
       WHERE h.po_nomor = ? AND h.po_close NOT IN (1, 9) AND h.po_jenis <> 1`,
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
        d.pod_spk_nomor AS spk, d.pod_mkb_nomor AS mkb, d.pod_nourut AS nourut, k.spk_nama AS namaspk
       FROM tpo_dtl d
       LEFT JOIN tbahan b ON b.bhn_kode = d.pod_bhn_kode
       LEFT JOIN tbahan_jenis j ON j.bj_kode = LEFT(d.pod_bhn_kode, 2)
       LEFT JOIN tbahan_gramasi g ON g.bg_kode = MID(d.pod_bhn_kode, 6, 2)
       LEFT JOIN tbahan_setting s ON s.bs_kode = RIGHT(d.pod_bhn_kode, 2)
       LEFT JOIN tspk k ON k.spk_nomor = d.pod_spk_nomor
       WHERE d.pod_po_nomor = ?
       ORDER BY d.pod_bhn_kode, d.pod_spk_nomor`,
      [value],
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
       INNER JOIN tpo_dtl d ON d.pod_po_nomor = h.po_nomor AND d.pod_status = 0
       LEFT JOIN tbahan b ON d.pod_bhn_kode = b.bhn_kode
       WHERE h.po_nomor = ?
       GROUP BY h.po_nomor, h.po_tanggal, d.pod_bhn_kode, d.pod_bhn_satuan, b.bhn_name, b.bhn_satuan, d.pod_hargabeli`,
      [value],
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
      d.bpbd_harga AS harga, d.bpbd_gramasi AS gramasi, d.bpbd_warna AS warna,
      d.bpbd_setting AS setting, d.bpbd_spk_nomor AS spk, IFNULL(k.spk_nama,"") AS namaspk,
      IFNULL((SELECT t.pod_bhn_satuan FROM tpo_dtl t WHERE t.pod_bhn_kode=d.bpbd_bhn_kode AND t.pod_po_nomor=h.bpb_po_nomor LIMIT 1),"") AS satuanpo,
      IFNULL((SELECT SUM(dd.pod_jumlah) FROM tpo_dtl dd WHERE dd.pod_po_nomor=h.bpb_po_nomor AND dd.pod_bhn_kode=d.bpbd_bhn_kode),0) AS totalpo,
      IFNULL((SELECT SUM(dd.bpbd_jumlah) FROM tbpb_dtl dd INNER JOIN tbpb_hdr hh ON hh.bpb_nomor=dd.bpbd_bpb_nomor WHERE hh.bpb_po_nomor=h.bpb_po_nomor AND dd.bpbd_bhn_kode=d.bpbd_bhn_kode),0) AS total_terima_all
     FROM tbpb_dtl d
     INNER JOIN tbpb_hdr h ON h.bpb_nomor = d.bpbd_bpb_nomor
     LEFT JOIN tbahan b ON b.bhn_kode = d.bpbd_bhn_kode
     LEFT JOIN tspk k ON k.spk_nomor = d.bpbd_spk_nomor
     WHERE d.bpbd_bpb_nomor = ?
     ORDER BY d.bpbd_nourut`,
    [nomor],
  );

  const mappedItems = items.map((d) => ({
    ...d,
    // Hitung terima (sebelum transaksi ini) dan kurang (dari query "kurang" Delphi)
    terima: Number(d.total_terima_all) - Number(d.jumlah),
    kurang: Number(d.totalpo) - Number(d.total_terima_all) + Number(d.jumlah),
  }));

  // D. Grid 2: Items PO Detail (Realisasi)
  const poNomor = header.bpb_po_Nomor || header.bpb_po_nomor || "";

  let poItems = [];
  if (poNomor && poNomor.trim() !== "") {
    const [grid2] = await db.query(
      `SELECT 
        d.pod_bhn_kode AS kode, b.bhn_name AS nama, d.pod_namaext AS namaext,
        d.pod_bhn_satuan AS satuan, IFNULL(g.bg_nama,"") AS gramasi, 
        IFNULL(s.bs_nama,"") AS setting, IFNULL(j.bj_nama,"") AS jenis,
        d.pod_jumlah AS jumlahpo, d.pod_mkb_nomor AS mkb, d.pod_spk_nomor AS spk,
        d.pod_nourut AS nourut, IFNULL(k.spk_nama,"") AS namaspk,
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
       WHERE d.pod_po_nomor = ?
       ORDER BY d.pod_bhn_kode, d.pod_spk_nomor`,
      [nomor, nomor, poNomor],
    );

    poItems = grid2.map((d) => ({
      ...d,
      kurang: Number(d.jumlahpo) - Number(d.sudah),
    }));
  }

  // E. Grid 3: Barcodes
  const [barcodes] = await db.query(
    `SELECT d.bard_kode AS kode, b.bhn_name AS nama, d.bard_barcode AS barcode,
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
    statusNgedit,
    isTutupBuku,
  };
};

// --- 3. SIMPAN DATA TRANSAKSI BESAR ---
const saveData = async (payload, userKode) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const { isEdit, header, items, poItems, barcodes, statusNgedit } = payload;
    let nomorBPB = header.bpb_nomor;
    const isPO = !!(header.bpb_po_nomor && header.bpb_po_nomor.trim() !== "");

    // A. Validasi Invoice & Tutup Buku
    if (isEdit) {
      const [cekInv] = await conn.query(
        `SELECT bpb_status_inv FROM tbpb_hdr WHERE bpb_nomor=?`,
        [nomorBPB],
      );
      if (cekInv.length > 0 && cekInv[0].bpb_status_inv === 1) {
        throw new Error(
          "BPB ini sudah dibuat Voucher Pembayaran, tidak bisa di edit",
        );
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
    let nourut1 = 1;
    let totalPoSisa = 0;
    let totalBpb = 0;

    for (const item of items) {
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

      // F. SINKRONISASI STATUS CLOSE PO (Mirip getQtyCelup di delete/simpan)
      let poCloseStatus = 2; // ONPROSES
      if (totalBpb >= totalPoSisa)
        poCloseStatus = 1; // CLOSE
      else if (totalBpb === 0) poCloseStatus = 0; // OPEN

      await conn.query(`UPDATE tpo_hdr SET po_close=? WHERE po_nomor=?`, [
        poCloseStatus,
        header.bpb_po_nomor,
      ]);
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

module.exports = {
  validateField,
  getDetail,
  saveData,
  getMaxBarcode,
};
