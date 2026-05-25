const db = require("../../config/database");
const tutupBukuService = require("../tutupBukuService");

// --- HELPER UNTUK MENGHITUNG QTY BPB & QTY SUDAH PO (1:1 Logic Delphi) ---
const getQtyBpb = async (poNomor, brgKode, conn) => {
  const [rows] = await conn.query(
    `SELECT IFNULL(SUM(d.bpbd_jumlah), 0) AS jml FROM tgarmenbpb_hdr h 
     INNER JOIN tgarmenbpb_dtl d ON d.bpbd_nomor = h.bpb_nomor 
     WHERE h.bpb_po_nomor = ? AND d.bpbd_brg_kode = ?`,
    [poNomor, brgKode],
  );
  return Number(rows[0]?.jml || 0);
};

const getQtySudah = async (poNomor, mbNomor, brgKode, conn) => {
  // PO Status NOT LIKE %CLOSE%
  const [r1] = await conn.query(
    `SELECT IFNULL(SUM(d.pod_jumlah), 0) AS jml FROM tgarmenpo_hdr h 
     INNER JOIN tgarmenpo_dtl d ON d.pod_nomor = h.po_nomor 
     WHERE h.po_status NOT LIKE "%CLOSE%" AND h.po_nomor <> ? AND d.pod_brg_kode = ? AND h.po_mb_nomor = ?`,
    [poNomor, brgKode, mbNomor],
  );
  // PO Status LIKE %CLOSE% (diambil dari realisasi BPB-nya)
  const [r2] = await conn.query(
    `SELECT IFNULL(SUM(i.bpbd_jumlah), 0) AS jml FROM tgarmenpo_hdr h 
     INNER JOIN tgarmenpo_dtl d ON d.pod_nomor = h.po_nomor 
     INNER JOIN tgarmenbpb_dtl i ON i.bpbd_brg_kode = d.pod_brg_kode 
     INNER JOIN tgarmenbpb_hdr j ON j.bpb_nomor = i.bpbd_nomor 
     WHERE h.po_status LIKE "%CLOSE%" AND j.bpb_po_nomor = d.pod_nomor 
     AND h.po_nomor <> ? AND d.pod_brg_kode = ? AND h.po_mb_nomor = ?`,
    [poNomor, brgKode, mbNomor],
  );
  return Number(r1[0]?.jml || 0) + Number(r2[0]?.jml || 0);
};

// --- AMBIL DETAIL FORM UNTUK EDIT ---
const getDetailForm = async (nomor, user) => {
  const conn = await db.getConnection();
  try {
    const qHdr = `
      SELECT h.*, DATE_FORMAT(h.po_tanggal, '%Y-%m-%d') AS po_tanggal,
             DATE_FORMAT(j.mb_tanggal, '%Y-%m-%d') AS tglminta, j.mb_cab,
             s.sup_nama, s.sup_alamat, s.sup_kota
      FROM tgarmenpo_hdr h
      LEFT JOIN tgarmenmintabeli_hdr j ON j.mb_nomor = h.po_mb_nomor
      LEFT JOIN tsupplier s ON s.sup_kode = h.po_sup_kode
      WHERE h.po_nomor = ?
    `;
    const [hdrRows] = await conn.query(qHdr, [nomor]);
    if (hdrRows.length === 0) throw new Error("Nomor tersebut belum ada.");
    const header = hdrRows[0];

    // Cek Status Kunci Periode & PIN (cekClose Delphi)
    const zdtClose = await tutupBukuService.getTanggalTutupBuku();
    const tglPO = new Date(header.po_tanggal);
    header.isTutupBuku = false;

    const [pinRows] = await conn.query(
      `SELECT pin_urut, pin_acc, pin_dipakai FROM tspk_pin5 WHERE pin_trs="PO GARMEN" AND pin_nomor=? ORDER BY pin_urut DESC LIMIT 1`,
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
    } else if (zdtClose && tglPO < zdtClose) {
      pinStatus = "MINTA";
    }

    if (zdtClose && tglPO < zdtClose && pinStatus !== "ACC") {
      header.isTutupBuku = true;
    }
    header.pin_status = pinStatus;
    header.pin_urut = pinUrut;

    // Ambil baris detail barang
    const qDtl = `
      SELECT 
        m.mbd_brg_kode AS Kode,
        IF(b.brg_note="", b.brg_nama, CONCAT(b.brg_nama, " - ", b.brg_note)) AS Nama,
        b.brg_satuan AS Satuan,
        m.mbd_ket AS ket,
        m.mbd_kegunaan AS kegunaan,
        m.mbd_jumlah AS minta,
        IFNULL(d.pod_jumlah, 0) AS jumlah,
        IFNULL(d.pod_harga, 0) AS harga
      FROM tgarmenmintabeli_dtl m
      INNER JOIN tgarmenpo_hdr h ON h.po_mb_nomor = m.mbd_nomor
      LEFT JOIN tgarmen_brg b ON b.brg_kode = m.mbd_brg_kode
      LEFT JOIN tgarmenpo_dtl d ON d.pod_nomor = h.po_nomor AND d.pod_brg_kode = m.mbd_brg_kode
      WHERE h.po_nomor = ?
      ORDER BY m.mbd_nourut ASC
    `;
    const [dtlRows] = await conn.query(qDtl, [nomor]);

    header.hasBpb = false;
    for (const d of dtlRows) {
      d.sudah = await getQtySudah(nomor, header.po_mb_nomor, d.Kode, conn);
      d.belum = Number(d.minta || 0) - d.sudah;
      d.bpb = await getQtyBpb(nomor, d.Kode, conn);
      d.Harga = user.flags?.lihatBeli ? d.pod_harga : 0;
      d.Total = user.flags?.lihatBeli ? d.pod_jumlah * d.pod_harga : 0;
      if (d.bpb > 0) header.hasBpb = true; // Kunci input supplier jika ada BPB
    }

    return { header, detail: dtlRows };
  } finally {
    conn.release();
  }
};

// --- LOAD DATA BERDASARKAN NO PERMINTAAN (Delphi: edtMintaExit) ---
const getPermintaanDetail = async (mbNomor, poNomor = "") => {
  const qDtl = `
    SELECT d.mbd_brg_kode AS Kode, IF(b.brg_note="", b.brg_nama, CONCAT(b.brg_nama, " - ", b.brg_note)) AS Nama, 
           b.brg_satuan AS Satuan, d.mbd_ket AS ket, d.mbd_kegunaan AS kegunaan, d.mbd_jumlah AS minta,
           h.mb_cab AS cab, DATE_FORMAT(h.mb_tanggal, '%Y-%m-%d') AS tglminta
    FROM tgarmenmintabeli_dtl d
    INNER JOIN tgarmenmintabeli_hdr h ON h.mb_nomor = d.mbd_nomor
    LEFT JOIN tgarmen_brg b ON b.brg_kode = d.mbd_brg_kode
    WHERE d.mbd_nomor = ? ORDER BY d.mbd_nourut
  `;
  const [rows] = await db.query(qDtl, [mbNomor]);
  if (rows.length === 0) throw new Error("No. Permintaan tersebut tidak ada.");

  for (const r of rows) {
    r.sudah = await getQtySudah(poNomor, mbNomor, r.Kode, db);
    r.belum = Number(r.minta || 0) - r.sudah;
    r.jumlah = r.belum; // Default jumlah PO = sisa yang belum di-PO
    r.harga = 0;
    r.total = 0;
    r.bpb = 0;
  }
  return rows;
};

// --- SIMPAN / UPDATE PO DATA ---
const saveData = async (payload, user) => {
  const conn = await db.getConnection();
  await conn.beginTransaction();
  try {
    let {
      isEdit,
      po_nomor,
      po_tanggal,
      po_mb_nomor,
      po_kecab,
      po_ket,
      po_sup_kode,
      po_jenis,
      detail,
    } = payload;
    const tglPO = new Date(po_tanggal);

    // 1. Validasi Awal & Tutup Buku
    if (!po_sup_kode || po_sup_kode.trim() === "")
      throw new Error("Supplier harus di isi. Tidak bisa disimpan.");

    const zdtClose = await tutupBukuService.getTanggalTutupBuku();
    let pinStatus = "";
    let pinUrut = 0;

    if (isEdit) {
      const [pinRows] = await conn.query(
        `SELECT pin_urut, pin_acc, pin_dipakai FROM tspk_pin5 WHERE pin_trs="PO GARMEN" AND pin_nomor=? ORDER BY pin_urut DESC LIMIT 1`,
        [po_nomor],
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

    if (zdtClose && tglPO < zdtClose && pinStatus !== "ACC") {
      throw new Error(
        "Anda tidak boleh input di tanggal periode yg sudah diclose.",
      );
    }

    if (isEdit) {
      const [cekBpbExist] = await conn.query(
        `SELECT COUNT(*) AS total FROM tgarmenbpb_hdr WHERE bpb_po_nomor = ?`,
        [po_nomor],
      );
      if (cekBpbExist[0].total > 0) {
        throw new Error(
          "PO tsb sudah ada penerimaan BPB. Tidak bisa disimpan.",
        );
      }
    }

    // 2. Tarik / Ganti Nomor Baru Jika Mode Create
    if (!isEdit) {
      const year = tglPO.getFullYear().toString();
      let cjenis =
        po_jenis === "ACCESORIES"
          ? "POA"
          : po_jenis === "OBAT"
            ? "POO"
            : po_jenis === "SPAREPART"
              ? "POS"
              : "POK";
      const searchPrefix = cjenis + year;
      const [[maxRow]] = await conn.query(
        `SELECT IFNULL(MAX(CAST(RIGHT(po_nomor, 5) AS UNSIGNED)), 0) AS max_val FROM tgarmenpo_hdr WHERE LEFT(po_nomor, 7) = ?`,
        [searchPrefix],
      );
      po_nomor =
        searchPrefix +
        String(parseInt(maxRow.max_val, 10) + 1).padStart(5, "0");
    }

    // 3. Validasi Qty Detail Grid
    let totalQty = 0;
    for (const d of detail) {
      totalQty += Number(d.jumlah || 0);
      if (Number(d.jumlah || 0) !== 0 && Number(d.harga || 0) === 0) {
        throw new Error("harga harus di isi.");
      }
    }
    if (totalQty === 0)
      throw new Error("Jumlah kosong semua, belum bisa disimpan.");

    // 4. Eksekusi Header Upsert
    if (isEdit) {
      await conn.query(
        `UPDATE tgarmenpo_hdr SET po_tanggal=?, po_mb_nomor=?, po_kecab=?, po_ket=?, po_sup_kode=?, date_modified=NOW(), user_modified=? WHERE po_nomor=?`,
        [
          po_tanggal,
          po_mb_nomor,
          po_kecab,
          po_ket || "",
          po_sup_kode,
          user.kode,
          po_nomor,
        ],
      );
    } else {
      await conn.query(
        `INSERT INTO tgarmenpo_hdr (po_jenis, po_nomor, po_tanggal, po_mb_nomor, po_cab, po_kecab, po_sup_kode, po_bagian, po_ket, date_create, user_create) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?)`,
        [
          po_jenis,
          po_nomor,
          po_tanggal,
          po_mb_nomor,
          user.cabang || "HO-",
          po_kecab,
          po_sup_kode,
          user.bagian || "",
          po_ket || "",
          user.kode,
        ],
      );
    }

    // 5. Eksekusi Detail Grid
    await conn.query("DELETE FROM tgarmenpo_dtl WHERE pod_nomor = ?", [
      po_nomor,
    ]);
    let nourut = 0;
    for (const d of detail) {
      if (d.Nama && Number(d.jumlah || 0) !== 0) {
        nourut++;
        await conn.query(
          `INSERT INTO tgarmenpo_dtl (pod_nomor, pod_brg_kode, pod_jumlah, pod_harga, pod_ket, pod_kegunaan, pod_nourut) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            po_nomor,
            d.Kode,
            Number(d.jumlah),
            Number(d.harga),
            d.ket || "",
            d.kegunaan || "",
            nourut,
          ],
        );
      }
    }

    // Update Status Permintaan & PIN
    await conn.query(
      `UPDATE tgarmenmintabeli_hdr SET mb_status=IF(mb_status="","PROSES",mb_status) WHERE mb_nomor=?`,
      [po_mb_nomor],
    );
    if (isEdit && pinStatus === "ACC") {
      await conn.query(
        `UPDATE tspk_pin5 SET pin_dipakai="Y" WHERE pin_trs="PO GARMEN" AND pin_nomor=? AND pin_urut=?`,
        [po_nomor, pinUrut],
      );
    }

    await conn.commit();
    return { po_nomor };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
};

module.exports = { getDetailForm, getPermintaanDetail, saveData };
