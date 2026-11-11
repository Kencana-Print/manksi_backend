const db = require("../../config/database");
const tutupBukuService = require("../tutupBukuService");
const {
  KECAB_ASET,
  BAGIAN_PO_ASET_LIHAT,
  refreshStatusBpb,
  getQtyBpbPerMinta,
} = require("./poNonBahanFormService");

const JENIS_BPB = ["ACCESORIES", "OBAT", "SPAREPART", "ATK/RTK", "ASET"];
const PREFIX_BPB = {
  ACCESORIES: "PBA",
  OBAT: "PBO",
  SPAREPART: "PBS",
  "ATK/RTK": "PBK",
  ASET: "PBI",
};
// Boleh membuat/mengubah BPB Aset
const BAGIAN_BPB_ASET_PROSES = ["GA", "EDP", "PEMBELIAN", "PURCHASING"];

// --- HELPER UNTUK MENGHITUNG QTY SUDAH DITERIMA SEBELUMNYA ---
// Replikasi: function TfrmBPBGarmen.getsudah()
// Mode PO: total BPB PO itu per kode. Mode permintaan: BPB langsung + BPB lewat PO
// yang dialokasikan ke permintaan tsb (petaMinta boleh diberikan agar tidak query berulang).
const getQtySudah = async (
  bpbNomorSaatIni,
  refNomor,
  brgKode,
  isPo,
  conn,
  petaMinta = null,
) => {
  if (!refNomor || refNomor === "") return 0;

  if (isPo) {
    const [rows] = await conn.query(
      `SELECT IFNULL(SUM(d.bpbd_jumlah), 0) AS jml
       FROM tgarmenbpb_hdr h
       INNER JOIN tgarmenbpb_dtl d ON d.bpbd_nomor = h.bpb_nomor
       WHERE h.bpb_nomor <> ? AND d.bpbd_brg_kode = ? AND h.bpb_po_nomor = ?`,
      [bpbNomorSaatIni || "", brgKode, refNomor],
    );
    return Number(rows[0]?.jml || 0);
  }

  const peta =
    petaMinta ||
    (await getQtyBpbPerMinta(refNomor, conn, bpbNomorSaatIni || ""));
  return Number(peta.get(brgKode) || 0);
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
    const isPo = header.bpb_po_nomor !== "";
    const refNomor = isPo ? header.bpb_po_nomor : header.bpb_mb_nomor;

    let mintaPo = new Map(); // PO: qty minta per kode (SUM semua baris PO)
    let petaMinta = null; // Permintaan: peta qty sudah-terima per kode
    if (isPo) {
      const [rows] = await conn.query(
        `SELECT pod_brg_kode AS kode, SUM(pod_jumlah) AS jml
         FROM tgarmenpo_dtl WHERE pod_nomor = ? GROUP BY pod_brg_kode`,
        [refNomor],
      );
      mintaPo = new Map(rows.map((r) => [r.kode, Number(r.jml) || 0]));

      const [mbs] = await conn.query(
        `SELECT DISTINCT pod_mb_nomor FROM tgarmenpo_dtl
         WHERE pod_nomor = ? AND pod_mb_nomor <> '' ORDER BY pod_mb_nomor`,
        [refNomor],
      );
      header.po_mb_daftar = mbs.length
        ? mbs.map((r) => r.pod_mb_nomor).join(", ")
        : header.bpb_mb_nomor;
    } else {
      petaMinta = await getQtyBpbPerMinta(refNomor, conn, nomor);
    }

    for (const d of dtlRows) {
      let minta = 0;
      if (isPo) {
        minta = mintaPo.get(d.bpbd_brg_kode) || 0;
      } else {
        const [[rowMb]] = await conn.query(
          `SELECT mbd_jumlah FROM tgarmenmintabeli_dtl WHERE mbd_nomor=? AND mbd_brg_kode=?`,
          [refNomor, d.bpbd_brg_kode],
        );
        minta = Number(rowMb?.mbd_jumlah || 0);
      }

      d.minta = minta;
      d.sudah = await getQtySudah(
        nomor,
        refNomor,
        d.bpbd_brg_kode,
        isPo,
        conn,
        petaMinta,
      );
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

    const peta = await getQtyBpbPerMinta(mbNomor, conn, bpbNomor);
    for (const r of rows) {
      r.sudah = Number(peta.get(r.Kode) || 0);
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
// Satu baris per KODE barang (qty dijumlah dari semua baris PO, termasuk dari
// permintaan berbeda). Harga seragam per kode dijamin saat simpan PO.
const getPoDetail = async (poNomor, bpbNomor = "") => {
  const conn = await db.getConnection();
  try {
    const [hdrRows] = await conn.query(
      `SELECT h.po_mb_nomor, DATE_FORMAT(m.mb_tanggal, '%Y-%m-%d') AS tglminta,
              DATE_FORMAT(h.po_tanggal, '%Y-%m-%d') AS tglpo, h.po_ket AS ketpo,
              h.po_sup_kode, s.sup_nama, s.sup_alamat, s.sup_kota
       FROM tgarmenpo_hdr h
       LEFT JOIN tsupplier s ON s.sup_kode = h.po_sup_kode
       LEFT JOIN tgarmenmintabeli_hdr m ON m.mb_nomor = h.po_mb_nomor
       WHERE h.po_nomor = ?`,
      [poNomor],
    );
    if (hdrRows.length === 0) throw new Error("NO PO tsb tidak ada.");

    const qDtl = `
      SELECT d.pod_brg_kode AS Kode,
             IF(b.brg_note="", b.brg_nama, CONCAT(b.brg_nama, " - ", b.brg_note)) AS Nama,
             b.brg_satuan AS Satuan,
             SUM(d.pod_jumlah) AS minta,
             MAX(d.pod_harga) AS harga,
             IFNULL(GROUP_CONCAT(DISTINCT NULLIF(d.pod_ket, '') SEPARATOR ' / '), '') AS ket,
             IFNULL(GROUP_CONCAT(DISTINCT NULLIF(d.pod_kegunaan, '') SEPARATOR ' / '), '') AS kegunaan,
             MIN(d.pod_nourut) AS urut
      FROM tgarmenpo_dtl d
      LEFT JOIN tgarmen_brg b ON b.brg_kode = d.pod_brg_kode
      WHERE d.pod_nomor = ?
      GROUP BY d.pod_brg_kode, b.brg_nama, b.brg_note, b.brg_satuan
      ORDER BY urut
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

    const [mbs] = await conn.query(
      `SELECT DISTINCT pod_mb_nomor FROM tgarmenpo_dtl
       WHERE pod_nomor = ? AND pod_mb_nomor <> '' ORDER BY pod_mb_nomor`,
      [poNomor],
    );
    const h = hdrRows[0];
    const headerInfo = {
      po_mb_nomor: h.po_mb_nomor,
      po_mb_daftar: mbs.length
        ? mbs.map((r) => r.pod_mb_nomor).join(", ")
        : h.po_mb_nomor,
      tglminta: h.tglminta,
      tglpo: h.tglpo,
      ketpo: h.ketpo,
      po_sup_kode: h.po_sup_kode,
      sup_nama: h.sup_nama,
      sup_alamat: h.sup_alamat,
      sup_kota: h.sup_kota,
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

    // 3b. Sumber dokumen divalidasi & diambil dari DB, bukan dari payload
    if (isEdit) {
      const [[cur]] = await conn.query(
        `SELECT bpb_jenis, bpb_mb_nomor, bpb_po_nomor, bpb_sup_kode, bpb_tanggal
         FROM tgarmenbpb_hdr WHERE bpb_nomor = ? FOR UPDATE`,
        [bpb_nomor],
      );
      if (!cur) throw new Error("Nomor BPB tersebut tidak ada.");
      if (
        zdtClose &&
        new Date(cur.bpb_tanggal) < zdtClose &&
        pinStatus !== "ACC"
      ) {
        throw new Error(
          "Transaksi tsb sudah diclose. Silahkan minta approve untuk bisa menyimpan perubahan data.",
        );
      }
      bpb_jenis = cur.bpb_jenis;
      bpb_mb_nomor = cur.bpb_mb_nomor;
      bpb_po_nomor = cur.bpb_po_nomor;
      bpb_sup_kode = cur.bpb_sup_kode;
    } else if (bpb_po_nomor) {
      const [[po]] = await conn.query(
        `SELECT po_mb_nomor, po_sup_kode, po_jenis FROM tgarmenpo_hdr WHERE po_nomor = ?`,
        [bpb_po_nomor],
      );
      if (!po) throw new Error("NO PO tsb tidak ada.");
      if (po.po_jenis !== bpb_jenis) {
        throw new Error("Jenis PO tidak sama dengan jenis BPB.");
      }
      bpb_mb_nomor = po.po_mb_nomor;
      bpb_sup_kode = po.po_sup_kode;
    } else if (bpb_mb_nomor) {
      bpb_sup_kode = "";
    }
    if (!bpb_po_nomor && !bpb_mb_nomor) {
      throw new Error("No. Permintaan atau No. PO harus di isi.");
    }

    // Jenis hanya diputihkan saat buat; BPB lama tidak diutak-atik
    if (!isEdit && !JENIS_BPB.includes(bpb_jenis)) {
      throw new Error("Jenis BPB tidak dikenal.");
    }
    if (
      bpb_jenis === "ASET" &&
      !BAGIAN_BPB_ASET_PROSES.includes(String(user.bagian || "").toUpperCase())
    ) {
      throw new Error("BPB Aset hanya untuk bagian GA, EDP, atau Pembelian.");
    }

    const kodeList = [
      ...new Set(
        detail.filter((d) => Number(d.jumlah || 0) !== 0).map((d) => d.Kode),
      ),
    ];
    const [src] = bpb_po_nomor
      ? await conn.query(
          `SELECT d.pod_brg_kode AS kode, MAX(d.pod_harga) AS harga
           FROM tgarmenpo_dtl d
           INNER JOIN tgarmen_brg b ON b.brg_kode = d.pod_brg_kode
           WHERE d.pod_nomor = ? AND d.pod_brg_kode IN (?) AND b.brg_jenis = ?
           GROUP BY d.pod_brg_kode`,
          [bpb_po_nomor, kodeList, bpb_jenis],
        )
      : await conn.query(
          `SELECT d.mbd_brg_kode AS kode, 0 AS harga
           FROM tgarmenmintabeli_dtl d
           INNER JOIN tgarmen_brg b ON b.brg_kode = d.mbd_brg_kode
           WHERE d.mbd_nomor = ? AND d.mbd_brg_kode IN (?) AND b.brg_jenis = ?
           GROUP BY d.mbd_brg_kode`,
          [bpb_mb_nomor, kodeList, bpb_jenis],
        );
    if (src.length !== kodeList.length) {
      throw new Error(
        "Ada barang yang bukan dari PO/permintaan tsb atau beda jenis dengan BPB.",
      );
    }
    const hargaPo = new Map(src.map((r) => [r.kode, Number(r.harga || 0)]));

    // 3c. BPB langsung dari permintaan ditolak untuk barang yang sudah ada di PO
    // (penerimaan harus lewat No. PO supaya PO ikut tercatat). Hanya saat buat baru.
    if (!isEdit && !bpb_po_nomor && bpb_mb_nomor) {
      const [diPo] = await conn.query(
        `SELECT d.pod_brg_kode AS kode,
                GROUP_CONCAT(DISTINCT d.pod_nomor ORDER BY d.pod_nomor SEPARATOR ', ') AS po
         FROM tgarmenpo_dtl d
         WHERE d.pod_mb_nomor = ? AND d.pod_brg_kode IN (?)
         GROUP BY d.pod_brg_kode`,
        [bpb_mb_nomor, kodeList],
      );
      if (diPo.length > 0) {
        const daftar = diPo.map((r) => `${r.kode} (PO ${r.po})`).join(", ");
        throw new Error(
          `Barang berikut sudah di-PO-kan, terima lewat No. PO: ${daftar}`,
        );
      }
    }

    // 4. Tarik / Ganti Nomor Baru Jika Mode Create
    if (!isEdit) {
      const year = tglBPB.getFullYear().toString();
      const cjenis = PREFIX_BPB[bpb_jenis];
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
          bpb_jenis === "ASET" ? KECAB_ASET : user.cabang || "HO-",
          user.kode,
        ],
      );
    }

    // 6. Eksekusi Detail Grid
    await conn.query("DELETE FROM tgarmenbpb_dtl WHERE bpbd_nomor = ?", [
      bpb_nomor,
    ]);
    let nourut = 0;

    for (const d of detail) {
      if (d.Nama && Number(d.jumlah || 0) !== 0) {
        nourut++;
        await conn.query(
          `INSERT INTO tgarmenbpb_dtl (bpbd_nomor, bpbd_brg_kode, bpbd_jumlah, bpbd_harga, bpbd_spk_nomor, bpbd_ket, bpbd_kegunaan, bpbd_nourut) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            bpb_nomor,
            d.Kode,
            Number(d.jumlah),
            hargaPo.get(d.Kode) ?? 0,
            d.spk || "",
            d.ket || "",
            d.kegunaan || "",
            nourut,
          ],
        );
      }
    }

    // 7. Update Status PO & semua Permintaan di PO tsb
    await refreshStatusBpb(conn, {
      poNomor: bpb_po_nomor || "",
      mbNomor: bpb_mb_nomor || "",
      bolehKosong: false,
    });

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

const getSupplierByKode = async (kode, jenis) => {
  let whereClause = `WHERE sup_aktif = "Y" AND sup_kode = ?`;
  const params = [kode];

  // Filter sesuai jenis — sama dengan lookupService searchSupplier
  if (jenis === "ACCESORIES") whereClause += ` AND sup_accesories = "Y"`;
  else if (jenis === "OBAT") whereClause += ` AND sup_obat = "Y"`;
  else if (jenis === "SPAREPART") whereClause += ` AND sup_sparepart = "Y"`;
  else if (jenis === "ATK/RTK") whereClause += ` AND sup_atk = "Y"`;

  const [rows] = await db.query(
    `SELECT sup_kode AS Kode, sup_nama AS Nama,
            sup_alamat AS Alamat, sup_kota AS Kota
     FROM tsupplier ${whereClause} LIMIT 1`,
    params,
  );
  if (rows.length === 0) throw new Error("Supplier tidak ditemukan.");
  return rows[0];
};

const getSpkByNomor = async (nomor) => {
  // Sesuai searchSpk di lookupService — cek tspk dan tmemospk
  const [rows] = await db.query(
    `SELECT Nomor, Nama FROM (
       SELECT spk_nomor AS Nomor, spk_nama AS Nama, spk_aktif AS Aktif
       FROM tspk
       UNION ALL
       SELECT mspk_nomor, mspk_nama, "Y"
       FROM tmemospk
     ) a
     WHERE Aktif = "Y" AND Nomor = ?
     LIMIT 1`,
    [nomor],
  );
  if (rows.length === 0) throw new Error("Nomor SPK tidak ditemukan.");
  return rows[0];
};

module.exports = {
  getDetailForm,
  getPermintaanDetail,
  getPoDetail,
  saveData,
  getSupplierByKode,
  getSpkByNomor,
};
