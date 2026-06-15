const db = require("../../config/database");
const tutupBukuService = require("../tutupBukuService");

// --- HELPER: GENERATE NOMOR PO ---
const generateNomorPO = async (jenisPO, tanggal) => {
  const dateObj = new Date(tanggal);
  const tahun = dateObj.getFullYear().toString();

  let prefix = "PB"; // Default Bahan
  if (jenisPO === 1)
    prefix = "PG"; // Greige
  else if (jenisPO === 2) prefix = "PC"; // Celup

  const [rows] = await db.query(
    `SELECT IFNULL(MAX(CAST(SUBSTR(po_nomor, 4, 5) AS UNSIGNED)), 0) AS max_val 
     FROM tpo_hdr 
     WHERE LEFT(po_nomor, 2) = ? AND RIGHT(po_nomor, 4) = ?`,
    [prefix, tahun],
  );

  const nextNum = parseInt(rows[0].max_val, 10) + 1;
  return `${prefix}/${String(nextNum).padStart(5, "0")}/${tahun}`;
};

// --- HELPER: GENERATE NOMOR BPB (Khusus PO Celup) ---
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

// --- 1. VALIDASI FIELD (Migrasi OnExit Delphi) ---
const validateField = async (type, value) => {
  if (!value) return { valid: true };

  // A. Validasi MPPB (edtmppbExit)
  if (type === "mppb") {
    const [mppb] = await db.query(
      `SELECT m.*, DATE_FORMAT(m.mpb_tanggal,"%Y-%m-%d") as tgl, IFNULL(h.po_nomor,"") as po 
       FROM tmpb m LEFT JOIN tpo_hdr h ON h.po_mppb_nomor = m.mpb_nomor 
       WHERE m.mpb_nomor = ?`,
      [value],
    );

    if (mppb.length === 0) throw new Error("No. MPPB tersebut tidak ada.");
    if (mppb[0].mpb_approve === "N")
      throw new Error("MPPB tersebut belum di-approve oleh PPIC.");
    if (mppb[0].po && mppb[0].po !== "")
      throw new Error(`MPPB sudah di-input di PO = ${mppb[0].po}`);

    return {
      valid: true,
      data: {
        tanggal: mppb[0].tgl,
        jumlah: mppb[0].mpb_jmlorder,
      },
    };
  }

  // B. Validasi & Load PO Greige (edtpoGreigeExit)
  if (type === "greige") {
    const [hdr] = await db.query(
      `SELECT h.*, s.sup_nama, s.sup_alamat, s.sup_kota 
       FROM tpo_hdr h
       LEFT JOIN tsupplier s ON s.sup_kode = h.po_sup_kode
       WHERE h.po_jenis = 1 AND h.po_nomor = ?`,
      [value],
    );
    if (hdr.length === 0)
      throw new Error("Nomor PO Greige tersebut tidak ditemukan.");

    // Tarik item detail Greige dan kurangi dengan Qty yang sudah dicelup
    const [details] = await db.query(
      `
      SELECT 
        d.pod_bhn_kode as kode, b.bhn_name as nama, d.pod_namaext as namaext,
        d.pod_bhn_satuan as satuan, d.pod_gramasia as gramasia,
        IFNULL(g.bg_nama,"") as gramasi, IFNULL(s.bs_nama,"") as setting, IFNULL(j.bj_nama,"") as jenis,
        d.pod_hargabeli as harga, d.pod_disc as diskon,
        d.pod_spk_nomor as spk, d.pod_mkb_nomor as mkb,
        (d.pod_jumlah - IFNULL((
           SELECT SUM(x.pod_jumlah) FROM tpo_dtl x INNER JOIN tpo_hdr y ON y.po_nomor = x.pod_po_nomor 
           WHERE y.po_greige = ? AND x.pod_bhn_kode = d.pod_bhn_kode
        ), 0)) as sisa_jumlah
      FROM tpo_dtl d
      LEFT JOIN tbahan b ON b.bhn_kode = d.pod_bhn_kode
      LEFT JOIN tbahan_jenis j ON j.bj_kode = LEFT(d.pod_bhn_kode, 2)
      LEFT JOIN tbahan_gramasi g ON g.bg_kode = MID(d.pod_bhn_kode, 6, 2)
      LEFT JOIN tbahan_setting s ON s.bs_kode = RIGHT(d.pod_bhn_kode, 2)
      WHERE d.pod_po_nomor = ?
    `,
      [value, value],
    );

    // Filter hanya yang sisanya > 0
    const filteredDetails = details.filter((item) => item.sisa_jumlah > 0);

    return {
      valid: true,
      header: hdr[0],
      items: filteredDetails,
    };
  }

  return { valid: true };
};

// --- 2. GET DETAIL PO (Mode Edit) ---
const getDetail = async (nomor) => {
  // A. Get Header
  const [headers] = await db.query(
    `
    SELECT h.*, s.sup_nama, s.sup_alamat, s.sup_kota, s.sup_cp,
           DATE_FORMAT(p.mpb_tanggal,"%Y-%m-%d") as tgl_mppb, p.mpb_jmlorder as jmlmppb
    FROM tpo_hdr h
    LEFT JOIN tsupplier s ON h.po_sup_kode = s.sup_kode
    LEFT JOIN tmpb p ON p.mpb_nomor = h.po_mppb_nomor
    WHERE h.po_nomor = ?
  `,
    [nomor],
  );

  if (headers.length === 0) throw new Error("Data PO tidak ditemukan.");
  const header = headers[0];

  // B. Get PIN 5 Status (Tutup Buku Bypass)
  const [pins] = await db.query(
    `
    SELECT pin_urut, pin_acc, pin_dipakai FROM tspk_pin5 
    WHERE pin_trs="PO BAHAN" AND pin_nomor=? ORDER BY pin_urut DESC LIMIT 1
  `,
    [nomor],
  );

  let statusNgedit = "AMAN";
  let urutPin = 0;
  if (pins.length > 0) {
    const p = pins[0];
    urutPin = p.pin_urut;
    if (p.pin_acc === "" && p.pin_dipakai === "") statusNgedit = "WAIT";
    else if (p.pin_acc === "Y" && p.pin_dipakai === "") statusNgedit = "ACC";
    else if (p.pin_acc === "N") statusNgedit = "TOLAK";
  }

  // C. Cek Tutup Buku
  const zdtClose = await tutupBukuService.getTanggalTutupBuku();
  let isTutupBuku = false;
  if (
    zdtClose &&
    new Date(header.po_tanggal) < zdtClose &&
    statusNgedit !== "ACC"
  ) {
    isTutupBuku = true;
  }

  // D. Get Grid 1 (Items)
  const [items] = await db.query(
    `
    SELECT d.*, b.bhn_name, 
           IFNULL(j.bj_nama,"") as jenis, IFNULL(g.bg_nama,"") as gramasi, IFNULL(s.bs_nama,"") as setting
    FROM tpo_dtl d
    LEFT JOIN tbahan b ON b.bhn_kode = d.pod_bhn_kode
    LEFT JOIN tbahan_jenis j ON j.bj_kode = LEFT(d.pod_bhn_kode, 2)
    LEFT JOIN tbahan_gramasi g ON g.bg_kode = MID(d.pod_bhn_kode, 6, 2)
    LEFT JOIN tbahan_setting s ON s.bs_kode = RIGHT(d.pod_bhn_kode, 2)
    WHERE d.pod_po_nomor = ? ORDER BY d.pod_nourut
  `,
    [nomor],
  );

  // E. Get Grid 2 (Delivery Commitment - tpo_dtl2)
  const [delivery] = await db.query(
    `
    SELECT a.*, b.bhn_name 
    FROM tpo_dtl2 a LEFT JOIN tbahan b ON b.bhn_kode = a.pod2_bhn_kode
    WHERE a.pod2_nomor = ? ORDER BY a.pod2_tanggal
  `,
    [nomor],
  );

  // F. Get Grid 3 (Rincian Roll - tpo_dtl3)
  const [rolls] = await db.query(
    `
    SELECT c.*, b.bhn_name, b.bhn_satuan 
    FROM tpo_dtl3 c LEFT JOIN tbahan b ON b.bhn_kode = c.pod3_bhn_kode
    LEFT JOIN tpo_dtl d ON d.pod_po_nomor = c.pod3_nomor AND d.pod_bhn_kode = c.pod3_bhn_kode
    WHERE c.pod3_nomor = ? ORDER BY d.pod_nourut, c.pod3_no
  `,
    [nomor],
  );

  // G. Get No BPB (Jika PO Celup)
  let noBPB = "";
  if (header.po_jenis === 2) {
    const [bpb] = await db.query(
      `SELECT bpb_nomor FROM tbpb_hdr WHERE bpb_keterangan = ? OR bpb_po_nomor = ? LIMIT 1`,
      [nomor, nomor],
    );
    if (bpb.length > 0) noBPB = bpb[0].bpb_nomor;
  }

  return {
    header,
    items,
    delivery,
    rolls,
    noBPB,
    statusNgedit,
    urutPin,
    isTutupBuku,
  };
};

// --- 3. SAVE DATA (INSERT & UPDATE MASSIVE TRANSACTION) ---
const saveData = async (payload, userKode) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const { isEdit, header, items, delivery, rolls, statusNgedit, urutPin } =
      payload;

    let nomorPO = header.po_nomor;
    const jpo = Number(header.po_jenis); // 1: Greige, 2: Celup, 3: Bahan
    let nomorBPB = header.no_bpb || "";

    // A. Validasi Tutup Buku Lanjutan
    const zdtClose = await tutupBukuService.getTanggalTutupBuku();
    if (
      zdtClose &&
      new Date(header.po_tanggal) < zdtClose &&
      statusNgedit !== "ACC"
    ) {
      throw new Error(
        "Anda tidak boleh input/edit di tanggal periode yang sudah diclose.",
      );
    }

    // B. Header Eksekusi
    if (!isEdit) {
      nomorPO = await generateNomorPO(jpo, header.po_tanggal);

      const insertHdr = `
        INSERT INTO tpo_hdr (
          po_nomor, po_greige, po_tanggal, po_jenis, po_keterangan, po_sup_kode, 
          po_mppb_nomor, po_status_ppn, po_ppn, date_create, user_create, po_note
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?)
      `;
      await conn.query(insertHdr, [
        nomorPO,
        header.po_greige || "",
        header.po_tanggal,
        jpo,
        header.po_keterangan,
        header.po_sup_kode,
        header.po_mppb_nomor,
        header.po_status_ppn,
        header.po_ppn,
        userKode,
        header.po_note || "",
      ]);

      // KHUSUS CELUP: AUTO CREATE BPB (Penerimaan Barang)
      if (jpo === 2) {
        nomorBPB = await generateNomorBPB(header.po_tanggal);
        const insertBPB = `
          INSERT INTO tbpb_hdr (
            bpb_nomor, bpb_tanggal, bpb_keterangan, bpb_po_nomor, bpb_sup_kode, 
            bpb_gdg_kode, bpb_jatuhtempo, date_create, user_create
          ) VALUES (?, ?, ?, ?, ?, "GC001", ?, NOW(), ?)
        `;
        await conn.query(insertBPB, [
          nomorBPB,
          header.po_tanggal,
          nomorPO,
          header.po_greige,
          header.po_sup_kode,
          header.po_tanggal,
          userKode,
        ]);
      }
    } else {
      // === TAMBAHAN VALIDASI EDIT (MIGRASI DARI DELPHI) ===

      // 1. Cek Status PO (Tidak Boleh Edit Jika Close/OnProses)
      const [cekStatus] = await conn.query(
        `SELECT po_close FROM tpo_hdr WHERE po_nomor=?`,
        [nomorPO],
      );
      if (cekStatus.length > 0) {
        if (cekStatus[0].po_close === 1)
          throw new Error("Sudah CLOSE. Tidak bisa disimpan.");
        if (cekStatus[0].po_close === 2)
          throw new Error("Sudah ONPROSES. Tidak bisa disimpan.");
      }

      // 2. Cek Sudah Link MKB (Migrasi ceksudahlink Delphi)
      const [cekMKB] = await conn.query(
        `SELECT COUNT(*) AS total FROM tmkb_dtl2 WHERE mkbd2_po_nomor = ?`,
        [nomorPO],
      );
      if (cekMKB[0].total > 0) {
        throw new Error("PO ini sudah link di MKB, tidak bisa di edit");
      }

      // ====================================================

      // UPDATE
      const updateHdr = `
        UPDATE tpo_hdr SET 
          po_tanggal=?, po_jenis=?, po_keterangan=?, po_sup_kode=?, po_mppb_nomor=?, 
          po_status_ppn=?, po_ppn=?, po_note=?, date_modified=NOW(), user_modified=?
        WHERE po_nomor=?
      `;
      await conn.query(updateHdr, [
        header.po_tanggal,
        jpo,
        header.po_keterangan,
        header.po_sup_kode,
        header.po_mppb_nomor,
        header.po_status_ppn,
        header.po_ppn,
        header.po_note || "",
        userKode,
        nomorPO,
      ]);

      // UPDATE TANGGAL BPB JIKA CELUP
      if (jpo === 2 && nomorBPB) {
        await conn.query(
          `UPDATE tbpb_hdr SET bpb_tanggal=?, date_modified=NOW(), user_modified=? WHERE bpb_nomor=?`,
          [header.po_tanggal, userKode, nomorBPB],
        );
      }

      // Bersihkan Detail Lama
      await conn.query(`DELETE FROM tpo_dtl WHERE pod_po_nomor=?`, [nomorPO]);
      await conn.query(`DELETE FROM tpo_dtl2 WHERE pod2_nomor=?`, [nomorPO]);
      await conn.query(`DELETE FROM tpo_dtl3 WHERE pod3_nomor=?`, [nomorPO]);
      if (jpo === 2 && nomorBPB) {
        await conn.query(`DELETE FROM tbpb_dtl WHERE bpbd_bpb_nomor=?`, [
          nomorBPB,
        ]);
      }
    }

    // C. INSERT DETAIL 1 (Item PO) & AUTO BPB DETAIL
    if (items && items.length > 0) {
      let nourut = 1;
      for (const item of items) {
        const namaExt = item.namaext ? item.namaext : item.nama;
        await conn.query(
          `
          INSERT INTO tpo_dtl (
            pod_po_nomor, pod_nourut, pod_bhn_kode, pod_namaext, pod_bhn_satuan, 
            pod_gramasia, pod_roll, pod_jumlah, pod_disc, pod_hargabeli, pod_spk_nomor, pod_mkb_nomor
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
          [
            nomorPO,
            nourut,
            item.kode,
            namaExt,
            item.satuan,
            item.gramasia || "",
            item.roll || 0,
            item.jumlah || 0,
            item.diskon || 0,
            item.harga || 0,
            item.spk || "",
            item.mkb || "",
          ],
        );

        // Auto Insert ke tabel BPB DTL jika ini PO Celup
        if (jpo === 2 && nomorBPB) {
          await conn.query(
            `
            INSERT INTO tbpb_dtl (
              bpbd_bpb_nomor, bpbd_bhn_kode, bpbd_bhn_satuan, bpbd_gramasi, bpbd_jumlah, 
              bpbd_roll, bpbd_harga, bpbd_spk_nomor, bpbd_nourut
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
            [
              nomorBPB,
              item.kode,
              item.satuan,
              item.gramasi || "",
              item.jumlah || 0,
              item.roll || 0,
              item.harga || 0,
              item.spk || "",
              nourut,
            ],
          );
        }
        nourut++;
      }
    }

    // D. INSERT DETAIL 2 (Delivery Commitment - Hanya Bahan)
    if (jpo === 3 && delivery && delivery.length > 0) {
      for (const d of delivery) {
        await conn.query(
          `
          INSERT INTO tpo_dtl2 (pod2_nomor, pod2_tanggal, pod2_jumlah, pod2_bhn_kode)
          VALUES (?, ?, ?, ?)
        `,
          [nomorPO, d.tanggal, d.jumlah || 0, d.kode],
        );
      }
    }

    // E. INSERT DETAIL 3 (Roll - Hanya Celup)
    if (jpo === 2 && rolls && rolls.length > 0) {
      for (const r of rolls) {
        await conn.query(
          `
          INSERT INTO tpo_dtl3 (pod3_nomor, pod3_bhn_kode, pod3_jumlah, pod3_no)
          VALUES (?, ?, ?, ?)
        `,
          [nomorPO, r.kode, r.jumlah || 0, r.no],
        );
      }
    }

    // F. MATIKAN PIN 5 JIKA EDIT HASIL ACC
    if (statusNgedit === "ACC" && urutPin > 0) {
      await conn.query(
        `UPDATE tspk_pin5 SET pin_dipakai="Y" WHERE pin_trs="PO BAHAN" AND pin_nomor=? AND pin_urut=?`,
        [nomorPO, urutPin],
      );
    }

    await conn.commit();

    // G. SINKRONISASI STATUS PO GREIGE — setelah commit agar data baru terbaca
    if (jpo === 2 && header.po_greige) {
      try {
        const [greigePo] = await db.query(
          `SELECT IFNULL(SUM(pod_Jumlah), 0) AS po FROM tpo_dtl WHERE pod_po_nomor = ?`,
          [header.po_greige],
        );
        const npo = Number(greigePo[0]?.po) || 0;

        const [greigeSj] = await db.query(
          `SELECT IFNULL(SUM(d.pod_Jumlah), 0) AS sj 
       FROM tpo_dtl d 
       INNER JOIN tpo_hdr h ON h.po_nomor = d.pod_po_nomor
       WHERE h.po_greige = ?`,
          [header.po_greige],
        );
        const nsj = Number(greigeSj[0]?.sj) || 0;

        let newStatus = 2; // ONPROSES
        if (nsj >= npo)
          newStatus = 1; // CLOSE
        else if (nsj === 0) newStatus = 0; // OPEN

        await db.query(`UPDATE tpo_hdr SET po_close = ? WHERE po_nomor = ?`, [
          newStatus,
          header.po_greige,
        ]);
      } catch (syncErr) {
        console.error("Gagal sinkronisasi status PO Greige:", syncErr);
        // Tidak throw — data PO Celup sudah tersimpan
      }
    }

    return { nomor: nomorPO, nomorBPB };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
};

// --- 4. LOAD DETAIL MKB & CEK WARNING (Migrasi loadDetailMkb Delphi) ---
const getDetailMkbForPo = async (mkbNomor) => {
  let warnings = [];

  // Pengecekan 1: Apakah MKB sudah di-link di tabel tmkb_dtl2?
  const [cekMkb2] = await db.query(
    `SELECT mkbd2_po_nomor FROM tmkb_dtl2 WHERE mkbd2_mkb_nomor = ? LIMIT 1`,
    [mkbNomor],
  );
  if (cekMkb2.length > 0) {
    warnings.push(
      `MKB tsb sudah di link di MKB dengan No.PO: ${cekMkb2[0].mkbd2_po_nomor}\nYakin akan dilanjutkan?`,
    );
  }

  // Pengecekan 2: Apakah MKB sudah ada di PO lain?
  const [cekPo] = await db.query(
    `SELECT pod_po_nomor FROM tpo_dtl WHERE pod_mkb_nomor = ? LIMIT 1`,
    [mkbNomor],
  );
  if (cekPo.length > 0) {
    warnings.push(
      `MKB tsb sudah tambah No.PO: ${cekPo[0].pod_po_nomor}\nYakin akan dilanjutkan?`,
    );
  }

  // Tarik Data Bahan MKB
  const [items] = await db.query(
    `SELECT d.mkbd_bhn_kode as kode, b.bhn_name as nama, b.bhn_name as namaext,
            d.mkbd_bhn_satuan as satuan, IFNULL(j.bj_nama,"") as jenis, b.bhn_hargabeli as harga,
            IFNULL(g.bg_nama,"") as gramasi, IFNULL(s.bs_nama,"") as setting,
            SUM(d.mkbd_jumlah_po) as jumlah, h.mkb_spk_nomor as spk
     FROM tmkb_dtl d
     INNER JOIN tmkb_hdr h ON h.mkb_nomor = d.mkbd_mkb_nomor
     LEFT JOIN tbahan b ON b.bhn_kode = d.mkbd_bhn_kode
     LEFT JOIN tbahan_jenis j ON j.bj_kode = LEFT(d.mkbd_bhn_kode, 2)
     LEFT JOIN tbahan_gramasi g ON g.bg_kode = MID(d.mkbd_bhn_kode, 6, 2)
     LEFT JOIN tbahan_setting s ON s.bs_kode = RIGHT(d.mkbd_bhn_kode, 2)
     WHERE mkb_nomor = ?
     GROUP BY d.mkbd_bhn_kode`,
    [mkbNomor],
  );

  return { warnings, items };
};

const getSupplierByKode = async (kode) => {
  const [rows] = await db.query(
    `SELECT sup_kode AS Kode, sup_nama AS Nama, 
            sup_alamat AS Alamat, sup_kota AS Kota
     FROM tsupplier WHERE sup_kode = ? LIMIT 1`,
    [kode],
  );
  if (rows.length === 0) throw new Error("Supplier tidak ditemukan.");
  return rows[0];
};

module.exports = {
  validateField,
  getDetail,
  saveData,
  getDetailMkbForPo,
  getSupplierByKode,
};
