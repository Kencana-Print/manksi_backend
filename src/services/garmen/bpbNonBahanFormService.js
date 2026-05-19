const db = require("../../config/database");
const tutupBukuService = require("../tutupBukuService");

// --- HELPER UNTUK MENGHITUNG QTY SUDAH DITERIMA SEBELUMNYA ---
// Replikasi: function TfrmBPBGarmen.getsudah()
const getQtySudah = async (bpbNomorSaatIni, refNomor, brgKode, isPo, conn) => {
  if (!refNomor || refNomor === "") return 0;

  let sql = `
    SELECT IFNULL(SUM(d.bpbd_jumlah), 0) AS jml 
    FROM tgarmenbpb_hdr h 
    INNER JOIN tgarmenbpb_dtl d ON d.bpbd_nomor = h.bpb_nomor 
    WHERE h.bpb_nomor <> ? AND d.bpbd_brg_kode = ?
  `;
  let params = [bpbNomorSaatIni || "", brgKode];

  if (isPo) {
    sql += ` AND h.bpb_po_nomor = ?`;
  } else {
    sql += ` AND h.bpb_mb_nomor = ?`;
  }
  params.push(refNomor);

  const [rows] = await conn.query(sql, params);
  return Number(rows[0]?.jml || 0);
};

// --- AMBIL DETAIL FORM UNTUK EDIT (Replikasi: loaddataall) ---
const getDetailForm = async (nomor) => {
  const conn = await db.getConnection();
  try {
    const qHdr = `
      SELECT h.*, DATE_FORMAT(h.bpb_tanggal, '%Y-%m-%d') AS bpb_tanggal_fmt,
             IFNULL(p.po_ket, "") AS ketpo, 
             IFNULL(i.iv_nomor, "") AS Noiv,
             IFNULL(DATE_FORMAT(p.po_tanggal, '%Y-%m-%d'), "") AS tglpo,
             IFNULL(DATE_FORMAT(j.mb_tanggal, '%Y-%m-%d'), "") AS tglminta,
             s.sup_nama, s.sup_alamat, s.sup_kota
      FROM tgarmenbpb_hdr h
      LEFT JOIN tsupplier s ON s.sup_kode = h.bpb_sup_kode
      LEFT JOIN tgarmenpo_hdr p ON p.po_nomor = h.bpb_po_nomor
      LEFT JOIN tgarmenmintabeli_hdr j ON j.mb_nomor = h.bpb_mb_nomor
      LEFT JOIN tgarmeniv_hdr i ON i.iv_bpb_nomor = h.bpb_nomor
      WHERE h.bpb_nomor = ?
    `;
    const [hdrRows] = await conn.query(qHdr, [nomor]);
    if (hdrRows.length === 0) throw new Error("Nomor BPB tersebut tidak ada.");
    const header = hdrRows[0];

    // Cek Status Tutup Buku & PIN
    const zdtClose = await tutupBukuService.getTanggalTutupBuku();
    const tglBPB = new Date(header.bpb_tanggal_fmt);
    header.isTutupBuku = false;

    // Kunci jika sudah ada Voucher
    header.hasVoucher = header.Noiv !== "";

    const [pinRows] = await conn.query(
      `SELECT pin_urut, pin_acc, pin_dipakai FROM tspk_pin5 WHERE pin_trs="BPB GARMEN" AND pin_nomor=? ORDER BY pin_urut DESC LIMIT 1`,
      [nomor],
    );
    let pinStatus = "";
    let pinUrut = 0;
    if (pinRows.length > 0) {
      pinUrut = pinRows[0].pin_urut;
      pinStatus =
        pinRows[0].pin_acc === "" && pinRows[0].pin_dipakai === ""
          ? "WAIT"
          : pinRows[0].pin_acc === "Y" && pinRows[0].pin_dipakai === ""
            ? "ACC"
            : pinRows[0].pin_acc === "N"
              ? "TOLAK"
              : "MINTA";
    } else if (zdtClose && tglBPB < zdtClose) {
      pinStatus = "MINTA";
    }

    if (zdtClose && tglBPB < zdtClose && pinStatus !== "ACC") {
      header.isTutupBuku = true;
    }
    header.pin_status = pinStatus;
    header.pin_urut = pinUrut;

    // Ambil baris detail barang
    const qDtl = `
    SELECT d.*,
            d.bpbd_jumlah    AS jumlah,
            d.bpbd_harga     AS harga,
            d.bpbd_spk_nomor AS spk,
            d.bpbd_ket       AS ket,
            d.bpbd_kegunaan  AS kegunaan,
            IFNULL(spk.spk_nama, m.mspk_nama) AS NamaSpk,
            IF(b.brg_note="", b.brg_nama, CONCAT(b.brg_nama, " - ", b.brg_note)) AS Nama,
            b.brg_satuan AS Satuan,
            d.bpbd_brg_kode AS Kode
    FROM tgarmenbpb_dtl d
    LEFT JOIN tgarmen_brg b ON b.brg_kode = d.bpbd_brg_kode
    LEFT JOIN tspk spk ON spk.spk_nomor = d.bpbd_spk_nomor
    LEFT JOIN tmemospk m ON m.mspk_nomor = d.bpbd_spk_nomor
    WHERE d.bpbd_nomor = ?
    ORDER BY d.bpbd_nourut ASC
    `;
    const [dtlRows] = await conn.query(qDtl, [nomor]);

    // Kalkulasi master item berdasarkan sumber (PO atau Minta) untuk mendapat Minta & Sudah
    for (const d of dtlRows) {
      let minta = 0;
      let isPo = header.bpb_po_nomor !== "";
      let refNomor = isPo ? header.bpb_po_nomor : header.bpb_mb_nomor;

      if (isPo) {
        const [[rowPo]] = await conn.query(
          `SELECT pod_jumlah, pod_harga FROM tgarmenpo_dtl WHERE pod_nomor=? AND pod_brg_kode=?`,
          [refNomor, d.bpbd_brg_kode],
        );
        minta = Number(rowPo?.pod_jumlah || 0);
      } else {
        const [[rowMb]] = await conn.query(
          `SELECT mbd_jumlah FROM tgarmenmintabeli_dtl WHERE mbd_nomor=? AND mbd_brg_kode=?`,
          [refNomor, d.bpbd_brg_kode],
        );
        minta = Number(rowMb?.mbd_jumlah || 0);
      }

      d.minta = minta;
      d.sudah = await getQtySudah(nomor, refNomor, d.bpbd_brg_kode, isPo, conn);
      d.kurang = minta - d.sudah;
    }

    return { header, detail: dtlRows };
  } finally {
    conn.release();
  }
};

// --- LOAD DATA DARI NO. PERMINTAAN (edtMintaExit) ---
const getPermintaanDetail = async (mbNomor, bpbNomor = "") => {
  const conn = await db.getConnection();
  try {
    const qDtl = `
      SELECT d.mbd_brg_kode AS Kode, IF(b.brg_note="", b.brg_nama, CONCAT(b.brg_nama, " - ", b.brg_note)) AS Nama, 
             b.brg_satuan AS Satuan, d.mbd_jumlah AS minta, h.mb_cab, DATE_FORMAT(h.mb_tanggal, '%Y-%m-%d') AS tglminta
      FROM tgarmenmintabeli_dtl d
      INNER JOIN tgarmenmintabeli_hdr h ON h.mb_nomor = d.mbd_nomor
      LEFT JOIN tgarmen_brg b ON b.brg_kode = d.mbd_brg_kode
      WHERE d.mbd_nomor = ? ORDER BY d.mbd_nourut
    `;
    const [rows] = await conn.query(qDtl, [mbNomor]);
    if (rows.length === 0) throw new Error("NO Permintaan tsb tidak ada.");

    for (const r of rows) {
      r.sudah = await getQtySudah(bpbNomor, mbNomor, r.Kode, false, conn);
      r.kurang = Number(r.minta || 0) - r.sudah;
      r.jumlah = 0; // Default di Delphi = 0
      r.harga = 0;
      r.spk = "";
      r.namaspk = "";
      r.ket = "";
      r.kegunaan = "";
    }
    return {
      header: { mb_cab: rows[0]?.mb_cab, tglminta: rows[0]?.tglminta },
      detail: rows,
    };
  } finally {
    conn.release();
  }
};

// --- LOAD DATA DARI NO. PO (edtpoExit) ---
const getPoDetail = async (poNomor, bpbNomor = "") => {
  const conn = await db.getConnection();
  try {
    const qDtl = `
      SELECT d.pod_brg_kode AS Kode, IF(b.brg_note="", b.brg_nama, CONCAT(b.brg_nama, " - ", b.brg_note)) AS Nama, 
             b.brg_satuan AS Satuan, d.pod_jumlah AS minta, d.pod_harga AS harga,
             d.pod_ket AS ket, d.pod_kegunaan AS kegunaan,
             h.po_mb_nomor, DATE_FORMAT(m.mb_tanggal, '%Y-%m-%d') AS tglminta,
             DATE_FORMAT(h.po_tanggal, '%Y-%m-%d') AS tglpo, h.po_ket AS ketpo,
             h.po_sup_kode, s.sup_nama, s.sup_alamat, s.sup_kota
      FROM tgarmenpo_dtl d
      INNER JOIN tgarmenpo_hdr h ON h.po_nomor = d.pod_nomor
      LEFT JOIN tsupplier s ON s.sup_kode = h.po_sup_kode
      LEFT JOIN tgarmenmintabeli_hdr m ON m.mb_nomor = h.po_mb_nomor
      LEFT JOIN tgarmen_brg b ON b.brg_kode = d.pod_brg_kode
      WHERE d.pod_nomor = ? ORDER BY d.pod_nourut
    `;
    const [rows] = await conn.query(qDtl, [poNomor]);
    if (rows.length === 0) throw new Error("NO PO tsb tidak ada.");

    for (const r of rows) {
      r.sudah = await getQtySudah(bpbNomor, poNomor, r.Kode, true, conn);
      r.kurang = Number(r.minta || 0) - r.sudah;
      r.jumlah = 0; // Default di Delphi = 0
      r.spk = "";
      r.namaspk = "";
    }

    const headerInfo = {
      po_mb_nomor: rows[0].po_mb_nomor,
      tglminta: rows[0].tglminta,
      tglpo: rows[0].tglpo,
      ketpo: rows[0].ketpo,
      po_sup_kode: rows[0].po_sup_kode,
      sup_nama: rows[0].sup_nama,
      sup_alamat: rows[0].sup_alamat,
      sup_kota: rows[0].sup_kota,
    };

    return { header: headerInfo, detail: rows };
  } finally {
    conn.release();
  }
};

// --- SIMPAN / UPDATE DATA (Replikasi: simpandata) ---
const saveData = async (payload, user) => {
  const conn = await db.getConnection();
  await conn.beginTransaction();
  try {
    let {
      isEdit,
      bpb_nomor,
      bpb_jenis,
      bpb_tanggal,
      bpb_mb_nomor,
      bpb_po_nomor,
      bpb_sup_kode,
      bpb_ket,
      detail,
    } = payload;
    const tglBPB = new Date(bpb_tanggal);

    // 1. Validasi Tutup Buku & PIN (Cegah modifikasi jika status != ACC)
    const zdtClose = await tutupBukuService.getTanggalTutupBuku();
    let pinStatus = "";
    let pinUrut = 0;

    if (isEdit) {
      // 2. Validasi Invoice (Voucher)
      const [cekIv] = await conn.query(
        `SELECT iv_nomor FROM tgarmeniv_hdr WHERE iv_bpb_nomor = ?`,
        [bpb_nomor],
      );
      if (cekIv.length > 0) {
        throw new Error(
          "BPB tsb sudah dibuatkan Voucher Pembelian. Tidak bisa disimpan.",
        );
      }

      const [pinRows] = await conn.query(
        `SELECT pin_urut, pin_acc, pin_dipakai FROM tspk_pin5 WHERE pin_trs="BPB GARMEN" AND pin_nomor=? ORDER BY pin_urut DESC LIMIT 1`,
        [bpb_nomor],
      );
      if (pinRows.length > 0) {
        pinUrut = pinRows[0].pin_urut;
        pinStatus =
          pinRows[0].pin_acc === "" && pinRows[0].pin_dipakai === ""
            ? "WAIT"
            : pinRows[0].pin_acc === "Y" && pinRows[0].pin_dipakai === ""
              ? "ACC"
              : "MINTA";
      }
      if (["MINTA", "WAIT", "TOLAK"].includes(pinStatus)) {
        throw new Error(
          "Transaksi tsb sudah diclose. Silahkan minta approve untuk bisa menyimpan perubahan data.",
        );
      }
    }

    if (zdtClose && tglBPB < zdtClose && pinStatus !== "ACC") {
      throw new Error(
        "Anda tidak boleh input di tanggal periode yg sudah diclose.",
      );
    }

    // 3. Validasi Qty Detail Grid
    let totalQty = 0;
    for (const d of detail) {
      totalQty += Number(d.jumlah || 0);
    }
    if (totalQty === 0)
      throw new Error("Jumlah kosong semua, belum bisa disimpan.");

    // 4. Tarik / Ganti Nomor Baru Jika Mode Create
    if (!isEdit) {
      const year = tglBPB.getFullYear().toString();
      let cjenis =
        bpb_jenis === "ACCESORIES"
          ? "PBA"
          : bpb_jenis === "OBAT"
            ? "PBO"
            : bpb_jenis === "SPAREPART"
              ? "PBS"
              : "PBK";
      const searchPrefix = cjenis + year;
      const [[maxRow]] = await conn.query(
        `SELECT IFNULL(MAX(CAST(RIGHT(bpb_nomor, 5) AS UNSIGNED)), 0) AS max_val FROM tgarmenbpb_hdr WHERE LEFT(bpb_nomor, 7) = ?`,
        [searchPrefix],
      );
      bpb_nomor =
        searchPrefix +
        String(parseInt(maxRow.max_val, 10) + 1).padStart(5, "0");
    }

    // 5. Eksekusi Header Upsert
    if (isEdit) {
      await conn.query(
        `UPDATE tgarmenbpb_hdr SET bpb_tanggal=?, bpb_ket=?, date_modified=NOW(), user_modified=? WHERE bpb_nomor=?`,
        [bpb_tanggal, bpb_ket || "", user.kode, bpb_nomor],
      );
    } else {
      await conn.query(
        `INSERT INTO tgarmenbpb_hdr (bpb_jenis, bpb_nomor, bpb_tanggal, bpb_mb_nomor, bpb_po_nomor, bpb_sup_kode, bpb_ket, bpb_cab, date_create, user_create) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?)`,
        [
          bpb_jenis,
          bpb_nomor,
          bpb_tanggal,
          bpb_mb_nomor || "",
          bpb_po_nomor || "",
          bpb_sup_kode || "",
          bpb_ket || "",
          user.cabang || "HO-",
          user.kode,
        ],
      );
    }

    // 6. Eksekusi Detail Grid
    await conn.query("DELETE FROM tgarmenbpb_dtl WHERE bpbd_nomor = ?", [
      bpb_nomor,
    ]);
    let nourut = 0;
    let totalMinta = 0;
    let totalBpb = 0; // Kalkulasi untuk update status PO / Minta

    for (const d of detail) {
      totalMinta += Number(d.minta || 0);
      let qtyBpbCalc = Number(d.sudah || 0) + Number(d.jumlah || 0);
      totalBpb +=
        qtyBpbCalc >= Number(d.minta || 0) ? Number(d.minta || 0) : qtyBpbCalc;

      if (d.Nama && Number(d.jumlah || 0) !== 0) {
        nourut++;
        await conn.query(
          `INSERT INTO tgarmenbpb_dtl (bpbd_nomor, bpbd_brg_kode, bpbd_jumlah, bpbd_harga, bpbd_spk_nomor, bpbd_ket, bpbd_kegunaan, bpbd_nourut) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            bpb_nomor,
            d.Kode,
            Number(d.jumlah),
            Number(d.harga || 0),
            d.spk || "",
            d.ket || "",
            d.kegunaan || "",
            nourut,
          ],
        );
      }
    }

    // 7. Update Status Permintaan & PO (1:1 Delphi)
    if (bpb_po_nomor && bpb_po_nomor !== "") {
      let statPO = "PROSES";
      if (totalBpb >= totalMinta) statPO = "CLOSE";
      else if (totalBpb === 0) statPO = "";
      await conn.query(
        `UPDATE tgarmenpo_hdr SET po_status=? WHERE po_nomor=?`,
        [statPO, bpb_po_nomor],
      );
    }

    // Jalankan juga update status Minta jika bersumber dari Minta
    if (bpb_mb_nomor && bpb_mb_nomor !== "") {
      // Re-query kalkulasi kompleks Minta (dari procedure delete/save Delphi)
      const qCekMinta = `
        SELECT SUM(x.po) po, (SUM(if(x.bpb>x.po,x.po,x.bpb)) + SUM(if(x.mso>x.po,x.po,x.mso))) terima
        FROM (
          SELECT d.mbd_brg_kode, d.mbd_jumlah po,
          IFNULL((SELECT ifnull(SUM(bpbd_jumlah),0) FROM tgarmenbpb_dtl b INNER JOIN tgarmenbpb_hdr a ON a.bpb_nomor=b.bpbd_nomor WHERE a.bpb_mb_nomor=d.mbd_nomor AND b.bpbd_brg_kode=d.mbd_brg_kode),0) bpb,
          IFNULL((SELECT ifnull(SUM(msod_jumlah),0) FROM tgarmenmso_dtl i INNER JOIN tgarmenmso_hdr j ON j.mso_nomor=i.msod_nomor AND j.mso_msi_nomor<>"" WHERE i.msod_mb_nomor=d.mbd_nomor AND i.msod_brg_kode=d.mbd_brg_kode),0) mso
          FROM tgarmenmintabeli_dtl d
          WHERE d.mbd_nomor = ?
        ) x
      `;
      const [resMinta] = await conn.query(qCekMinta, [bpb_mb_nomor]);
      const tpo = Number(resMinta[0].po || 0);
      const tterima = Number(resMinta[0].terima || 0);

      let statMinta = "PROSES";
      if (tterima >= tpo) statMinta = "CLOSE";
      await conn.query(
        `UPDATE tgarmenmintabeli_hdr SET mb_status=? WHERE mb_nomor=?`,
        [statMinta, bpb_mb_nomor],
      );
    }

    // 8. Update PIN dipakai
    if (isEdit && pinStatus === "ACC") {
      await conn.query(
        `UPDATE tspk_pin5 SET pin_dipakai="Y" WHERE pin_trs="BPB GARMEN" AND pin_nomor=? AND pin_urut=?`,
        [bpb_nomor, pinUrut],
      );
    }

    await conn.commit();
    return { bpb_nomor };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
};

module.exports = { getDetailForm, getPermintaanDetail, getPoDetail, saveData };
