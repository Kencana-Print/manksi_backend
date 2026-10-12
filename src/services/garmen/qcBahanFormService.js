const db = require("../../config/database");

const PREFIX = "QCB";
const LOCK_NAME = "qc_bahan_nomor";

// "175-185" -> { min: 175, max: 185 }. Teks lain/kosong -> 0/0 (saran nilai dimatikan)
const parseRentang = (txt) => {
  const m = String(txt || "").match(
    /(\d+(?:[.,]\d+)?)\s*-\s*(\d+(?:[.,]\d+)?)/,
  );
  if (!m) return { min: 0, max: 0 };
  return {
    min: Number(m[1].replace(",", ".")),
    max: Number(m[2].replace(",", ".")),
  };
};

// 3 = dalam rentang PO, 2 = di luar rentang tapi dalam toleransi (selisih gram),
// 1 = di luar toleransi, 0 = tidak ada saran
const hitungSaran = (cek, min, max, toleransi) => {
  if (!(min > 0 && max > 0) || !(cek > 0)) return 0;
  if (cek >= min && cek <= max) return 3;
  const selisih = cek < min ? min - cek : cek - max;
  return selisih <= toleransi ? 2 : 1;
};

const getToleransi = async (conn) => {
  const [rows] = await conn.query(
    `SELECT qcm_nilai FROM tqc_bahan_param WHERE qcm_kode = 'TOLERANSI_GRAMASI'`,
  );
  return rows.length ? Number(rows[0].qcm_nilai) : 0;
};

// Vendor sesuai jenis PO: CELUP -> celup = supplier PO, greige = supplier PO greige.
// GREIGE dan BAHAN -> supplier PO ditaruh di vendor greige, vendor celup kosong.
const resolveVendor = async (conn, hdr) => {
  const jenis = Number(hdr.po_jenis);
  if (jenis === 2) {
    let greige = "";
    if (hdr.po_greige) {
      const [g] = await conn.query(
        `SELECT s.sup_nama
         FROM tpo_hdr p
         LEFT JOIN tsupplier s ON s.sup_kode = p.po_sup_kode
         WHERE p.po_nomor = ?`,
        [hdr.po_greige],
      );
      greige = g[0]?.sup_nama || "";
    }
    return { greige, celup: hdr.sup_nama || "" };
  }
  return { greige: hdr.sup_nama || "", celup: "" };
};

const loadPoLine = async (conn, poNomor, nourut) => {
  const [rows] = await conn.query(
    `
    SELECT
      h.po_nomor, h.po_jenis, h.po_greige, h.po_tanggal, h.po_close,
      s.sup_nama,
      d.pod_nourut, d.pod_bhn_kode, d.pod_bhn_satuan,
      IFNULL(NULLIF(d.pod_namaext, ''), b.Bhn_Name) AS nama_kain,
      IFNULL(j.bj_nama, '') AS nama_jenis,
      IFNULL(w.bw_nama, '') AS nama_warna,
      d.pod_gramasia, d.pod_setting, d.pod_roll, d.pod_Jumlah, d.pod_status
    FROM tpo_hdr h
    INNER JOIN tpo_dtl d ON d.pod_po_nomor = h.po_nomor
    LEFT JOIN tbahan b ON b.bhn_kode = d.pod_bhn_kode
    LEFT JOIN tbahan_jenis j ON j.bj_kode = LEFT(d.pod_bhn_kode, 2)
    LEFT JOIN tbahan_warna w ON w.bw_kode = MID(d.pod_bhn_kode, 3, 3)
    LEFT JOIN tsupplier s ON s.sup_kode = h.po_sup_kode
    WHERE h.po_nomor = ? AND d.pod_nourut = ?
    `,
    [poNomor, Number(nourut)],
  );
  if (rows.length === 0) throw new Error("Baris PO Bahan tidak ditemukan.");
  if (Number(rows[0].pod_status) === 2) {
    throw new Error("Baris PO tersebut berstatus Cancel.");
  }
  if (Number(rows[0].po_close) === 9) {
    throw new Error("PO tersebut sudah dibatalkan.");
  }
  return rows[0];
};

const generateNomor = async (conn, tgl) => {
  const tahun = String(tgl).substring(0, 4);
  const [rows] = await conn.query(
    `SELECT IFNULL(MAX(CAST(SUBSTRING_INDEX(SUBSTRING_INDEX(qc_nomor, '/', 2), '/', -1) AS UNSIGNED)), 0) AS maks
     FROM tqc_bahan_hdr
     WHERE qc_nomor LIKE ?`,
    [`${PREFIX}/%/${tahun}`],
  );
  const next = Number(rows[0].maks) + 1;
  return `${PREFIX}/${String(next).padStart(5, "0")}/${tahun}`;
};

// --- LOOKUP PO (dipakai modal pilih PO saat membuat QC) ---
const lookupPo = async (query) => {
  const now = new Date();
  const dStart =
    query.startDate ||
    new Date(now.getFullYear(), now.getMonth(), 1)
      .toISOString()
      .substring(0, 10);
  const dEnd = query.endDate || now.toISOString().substring(0, 10);

  const params = [dStart, dEnd];
  let searchSql = "";
  if (query.search) {
    searchSql = `AND (h.po_nomor LIKE ? OR d.pod_namaext LIKE ? OR b.Bhn_Name LIKE ? OR s.sup_nama LIKE ?)`;
    const like = `%${query.search}%`;
    params.push(like, like, like, like);
  }

  const [rows] = await db.query(
    `
    SELECT
      h.po_nomor AS PO,
      IF(h.po_jenis = 1, "GREIGE", IF(h.po_jenis = 2, "CELUP", "BAHAN")) AS JenisPO,
      DATE_FORMAT(h.po_tanggal, "%Y-%m-%d") AS TanggalPO,
      s.sup_nama AS Supplier,
      d.pod_nourut AS Nourut,
      d.pod_bhn_kode AS KodeBahan,
      IFNULL(NULLIF(d.pod_namaext, ''), b.Bhn_Name) AS NamaKain,
      d.pod_gramasia AS Gramasi,
      d.pod_setting AS Setting,
      d.pod_roll AS Roll,
      d.pod_Jumlah AS Qty,
      d.pod_bhn_satuan AS Satuan
    FROM tpo_hdr h
    INNER JOIN tpo_dtl d ON d.pod_po_nomor = h.po_nomor
    LEFT JOIN tbahan b ON b.bhn_kode = d.pod_bhn_kode
    LEFT JOIN tsupplier s ON s.sup_kode = h.po_sup_kode
    WHERE h.po_tanggal >= ? AND h.po_tanggal < DATE_ADD(?, INTERVAL 1 DAY)
      AND h.po_close <> 9
      AND d.pod_status <> 2
      ${searchSql}
    ORDER BY h.po_tanggal DESC, h.po_nomor DESC, d.pod_nourut ASC
    LIMIT 200
    `,
    params,
  );

  // Jumlah QC yang sudah ada per baris PO (kedatangan bertahap diperbolehkan,
  // jadi hanya informasi, bukan filter). Dihitung terpisah agar tidak terkena
  // masalah collation antar tabel.
  const countMap = {};
  if (rows.length > 0) {
    const poList = [...new Set(rows.map((r) => r.PO))];
    const [cnt] = await db.query(
      `SELECT qc_po_nomor, qc_pod_nourut, COUNT(*) AS jml
       FROM tqc_bahan_hdr
       WHERE qc_po_nomor IN (?)
       GROUP BY qc_po_nomor, qc_pod_nourut`,
      [poList],
    );
    cnt.forEach((c) => {
      countMap[`${c.qc_po_nomor}|${c.qc_pod_nourut}`] = Number(c.jml);
    });
  }

  return rows.map((r) => ({
    ...r,
    QcCount: countMap[`${r.PO}|${r.Nourut}`] || 0,
  }));
};

// --- PREFILL dari baris PO (mode buat) ---
const getPoSource = async (poNomor, nourut) => {
  const conn = await db.getConnection();
  try {
    const line = await loadPoLine(conn, poNomor, nourut);
    const vendor = await resolveVendor(conn, line);
    const toleransi = await getToleransi(conn);
    const { min, max } = parseRentang(line.pod_gramasia);

    return {
      header: {
        qc_po_nomor: line.po_nomor,
        qc_bhn_kode: line.pod_bhn_kode,
        qc_pod_nourut: line.pod_nourut,
        qc_vendor_greige: vendor.greige,
        qc_vendor_celup: vendor.celup,
        qc_jenis_kain: line.nama_jenis || line.nama_kain || "",
        jenis_po:
          Number(line.po_jenis) === 1
            ? "GREIGE"
            : Number(line.po_jenis) === 2
              ? "CELUP"
              : "BAHAN",
      },
      po: {
        qty: Number(line.pod_Jumlah) || 0,
        roll: Number(line.pod_roll) || 0,
        satuan: line.pod_bhn_satuan,
        gramasi: line.pod_gramasia || "",
        gramasi_min: min,
        gramasi_max: max,
        setting: line.pod_setting || "",
        // Warna tidak punya kolom sendiri di PO; nilai awal diambil dari nama
        // kain dan boleh diedit petugas per lot.
        warna: line.nama_warna || line.nama_kain || "",
      },
      toleransi,
    };
  } finally {
    conn.release();
  }
};

// --- DETAIL (mode ubah) ---
const getDetail = async (nomor) => {
  const [hdr] = await db.query(
    `
    SELECT
      qc_nomor, DATE_FORMAT(qc_tgl_datang, "%Y-%m-%d") AS qc_tgl_datang,
      qc_po_nomor, qc_bhn_kode, qc_pod_nourut,
      qc_vendor_greige, qc_jenis_kain, qc_vendor_celup,
      qc_status, qc_keterangan, user_create, date_create
    FROM tqc_bahan_hdr
    WHERE qc_nomor = ?
    `,
    [nomor],
  );
  if (hdr.length === 0) throw new Error("Data QC Bahan tidak ditemukan.");

  const [dtl] = await db.query(
    `
    SELECT
      d.qcd_nourut AS nourut, d.qcd_lot AS lot, d.qcd_qty_kg AS qty_kg,
      d.qcd_qty_roll AS qty_roll, d.qcd_qty_kg_po AS qty_kg_po,
      d.qcd_gramasi_po AS gramasi_po, d.qcd_gramasi_min AS gramasi_min,
      d.qcd_gramasi_max AS gramasi_max, d.qcd_setting_po AS setting_po,
      d.qcd_warna AS warna, d.qcd_gramasi_cek AS gramasi_cek,
      d.qcd_setting_cek AS setting_cek, d.qcd_nilai AS nilai,
      d.qcd_nilai_saran AS nilai_saran, d.qcd_alasan_nilai AS alasan_nilai,
      d.qcd_keputusan AS keputusan,
      r.qch_gramasi AS h_gramasi, r.qch_setting AS h_setting,
      r.qch_warna AS h_warna, r.qch_handfeel AS h_handfeel,
      r.qch_bowing AS h_bowing, r.qch_shrinkage AS h_shrinkage,
      r.qch_kelunturan AS h_kelunturan
    FROM tqc_bahan_dtl d
    LEFT JOIN tqc_bahan_hasil r
      ON r.qch_qc_nomor = d.qcd_qc_nomor AND r.qch_nourut = d.qcd_nourut
    WHERE d.qcd_qc_nomor = ?
    ORDER BY d.qcd_nourut
    `,
    [nomor],
  );

  // Pengesah keputusan terakhir (Pembelian) untuk kolom tanda tangan di cetak
  const [kep] = await db.query(
    `SELECT qck_user, DATE_FORMAT(qck_tanggal, "%Y-%m-%d") AS tanggal
     FROM tqc_bahan_keputusan
     WHERE qck_qc_nomor = ? AND qck_tahap = 'PEMBELIAN'
     ORDER BY qck_id DESC LIMIT 1`,
    [nomor],
  );
  const pengesah = {
    pembelian: kep[0]?.qck_user || "",
    tgl_pembelian: kep[0]?.tanggal || "",
  };

  const [[po]] = await Promise.all([
    db.query(
      `SELECT pod_Jumlah, pod_roll, pod_bhn_satuan FROM tpo_dtl WHERE pod_po_nomor = ? AND pod_nourut = ?`,
      [hdr[0].qc_po_nomor, hdr[0].qc_pod_nourut],
    ),
  ]);

  const conn = await db.getConnection();
  let toleransi = 0;
  try {
    toleransi = await getToleransi(conn);
  } finally {
    conn.release();
  }

  return {
    header: hdr[0],
    dtl: dtl.map((d) => ({
      nourut: d.nourut,
      lot: d.lot,
      qty_kg: Number(d.qty_kg),
      qty_roll: Number(d.qty_roll),
      qty_kg_po: Number(d.qty_kg_po),
      gramasi_po: d.gramasi_po,
      gramasi_min: Number(d.gramasi_min),
      gramasi_max: Number(d.gramasi_max),
      setting_po: d.setting_po,
      warna: d.warna,
      gramasi_cek: Number(d.gramasi_cek),
      setting_cek: d.setting_cek,
      nilai: Number(d.nilai),
      nilai_saran: Number(d.nilai_saran),
      alasan_nilai: d.alasan_nilai,
      keputusan: d.keputusan,
      hasil: {
        gramasi: d.h_gramasi || "",
        setting: d.h_setting || "",
        warna: d.h_warna || "",
        handfeel: d.h_handfeel || "",
        bowing: d.h_bowing || "",
        shrinkage: d.h_shrinkage || "",
        kelunturan: d.h_kelunturan || "",
      },
    })),
    po: po[0]
      ? {
          qty: Number(po[0].pod_Jumlah) || 0,
          roll: Number(po[0].pod_roll) || 0,
          satuan: po[0].pod_bhn_satuan,
        }
      : null,
    pengesah,
    toleransi,
  };
};

const fs = require("fs");
const path = require("path");

const JENIS_FOTO = ["BAHAN", "TRIMCARD"];
const UPLOAD_ROOT = path.join(process.cwd(), "public/uploads");

const folderNomor = (nomor) => String(nomor).replace(/[^A-Za-z0-9_-]/g, "-");

const getLampiran = async (nomor) => {
  const [rows] = await db.query(
    `SELECT qcl_id AS Id, qcl_jenis AS Jenis, qcl_file AS File, qcl_nama AS Nama
     FROM tqc_bahan_lampiran WHERE qcl_qc_nomor = ? ORDER BY qcl_id`,
    [nomor],
  );
  return rows;
};

const FOTO_MIME = ["image/jpeg", "image/png", "image/webp"];
const FOTO_EXT = [".jpg", ".jpeg", ".png", ".webp"];

// Satu foto per jenis per dokumen: unggah ulang menggantikan yang lama
const saveLampiran = async (nomor, jenis, file, userKode) => {
  const jenisUp = String(jenis || "").toUpperCase();
  try {
    if (!JENIS_FOTO.includes(jenisUp)) {
      throw new Error("Jenis foto harus BAHAN atau TRIMCARD.");
    }
    if (!file) throw new Error("File foto wajib dipilih.");
    const extFile = path.extname(file.originalname).toLowerCase();
    if (!FOTO_MIME.includes(file.mimetype) || !FOTO_EXT.includes(extFile)) {
      throw new Error("Foto harus berformat JPG, PNG, atau WEBP.");
    }

    const [hdr] = await db.query(
      `SELECT qc_nomor FROM tqc_bahan_hdr WHERE qc_nomor = ?`,
      [nomor],
    );
    if (hdr.length === 0) throw new Error("Data QC Bahan tidak ditemukan.");

    const [sudahDiterima] = await db.query(
      `SELECT 1 FROM tbpb_qc_lot WHERE bql_qc_nomor = ? LIMIT 1`,
      [nomor],
    );
    if (sudahDiterima.length > 0) {
      throw new Error("Dokumen sudah diterima di BPB Bahan. Foto dikunci.");
    }

    const folderRel = path.join("qc-bahan", folderNomor(nomor));
    const folderAbs = path.join(UPLOAD_ROOT, folderRel);
    fs.mkdirSync(folderAbs, { recursive: true });

    const namaFile = `${jenisUp.toLowerCase()}-${Date.now()}${extFile}`;
    fs.renameSync(file.path, path.join(folderAbs, namaFile));
    const fileRel = path.posix.join("qc-bahan", folderNomor(nomor), namaFile);

    const [lama] = await db.query(
      `SELECT qcl_id, qcl_file FROM tqc_bahan_lampiran
       WHERE qcl_qc_nomor = ? AND qcl_jenis = ?`,
      [nomor, jenisUp],
    );
    for (const l of lama) {
      fs.rmSync(path.join(UPLOAD_ROOT, l.qcl_file), { force: true });
      await db.query(`DELETE FROM tqc_bahan_lampiran WHERE qcl_id = ?`, [
        l.qcl_id,
      ]);
    }

    await db.query(
      `INSERT INTO tqc_bahan_lampiran
         (qcl_qc_nomor, qcl_lot, qcl_jenis, qcl_file, qcl_nama, user_create)
       VALUES (?, '', ?, ?, ?, ?)`,
      [nomor, jenisUp, fileRel, file.originalname, userKode],
    );
    return { jenis: jenisUp, file: fileRel };
  } catch (error) {
    if (file?.path) fs.rmSync(file.path, { force: true });
    throw error;
  }
};

const deleteLampiran = async (nomor, jenis) => {
  const [rows] = await db.query(
    `SELECT qcl_id, qcl_file FROM tqc_bahan_lampiran
     WHERE qcl_qc_nomor = ? AND qcl_jenis = ?`,
    [nomor, String(jenis || "").toUpperCase()],
  );
  for (const r of rows) {
    fs.rmSync(path.join(UPLOAD_ROOT, r.qcl_file), { force: true });
    await db.query(`DELETE FROM tqc_bahan_lampiran WHERE qcl_id = ?`, [
      r.qcl_id,
    ]);
  }
};

// --- SIMPAN (buat / ubah), opsional langsung submit ---
const saveData = async (payload, userKode) => {
  const conn = await db.getConnection();
  let locked = false;
  try {
    const isEdit = !!payload.isEdit;
    const tgl = String(payload.qc_tgl_datang || "").substring(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(tgl)) {
      throw new Error("Tanggal kedatangan wajib diisi.");
    }

    const inputRows = Array.isArray(payload.dtl) ? payload.dtl : [];
    if (inputRows.length === 0) {
      throw new Error("Minimal satu lot harus diisi.");
    }

    const lotSet = new Set();
    for (const r of inputRows) {
      const lot = String(r.lot || "").trim();
      if (!lot) throw new Error("Lot No. wajib diisi pada semua baris.");
      const key = lot.toUpperCase();
      if (lotSet.has(key)) throw new Error(`Lot ${lot} terduplikasi.`);
      lotSet.add(key);
    }

    const toleransi = await getToleransi(conn);

    // Pastikan hanya satu proses yang membuat nomor pada saat yang sama
    if (!isEdit) {
      const [lk] = await conn.query(`SELECT GET_LOCK(?, 10) AS ok`, [
        LOCK_NAME,
      ]);
      if (!lk[0].ok) throw new Error("Sistem sibuk, coba lagi.");
      locked = true;
    }

    await conn.beginTransaction();

    let nomor = payload.qc_nomor;
    let poNomor = payload.qc_po_nomor;
    let podNourut = Number(payload.qc_pod_nourut);
    let oldStatus = "DRAFT";
    let pinUrut = null;

    if (isEdit) {
      const [cur] = await conn.query(
        `SELECT qc_status, qc_po_nomor, qc_pod_nourut FROM tqc_bahan_hdr WHERE qc_nomor = ? FOR UPDATE`,
        [nomor],
      );
      if (cur.length === 0) throw new Error("Data QC Bahan tidak ditemukan.");
      oldStatus = cur[0].qc_status;
      poNomor = cur[0].qc_po_nomor;
      podNourut = Number(cur[0].qc_pod_nourut);

      const [sudahDiterima] = await conn.query(
        `SELECT 1 FROM tbpb_qc_lot WHERE bql_qc_nomor = ? LIMIT 1`,
        [nomor],
      );
      if (sudahDiterima.length > 0) {
        throw new Error(
          "Dokumen ini sudah diterima di BPB Bahan. Hapus BPB-nya terlebih dahulu sebelum mengubah QC.",
        );
      }
      const [sudahDiretur] = await conn.query(
        `SELECT 1 FROM tqc_retur_dtl WHERE qrd_qc_nomor = ? LIMIT 1`,
        [nomor],
      );
      if (sudahDiretur.length > 0) {
        throw new Error(
          "Dokumen ini sudah diretur ke supplier. Hapus dokumen retur-nya terlebih dahulu sebelum mengubah QC.",
        );
      }

      if (oldStatus !== "DRAFT") {
        const [pin] = await conn.query(
          `SELECT pin_urut, pin_acc, pin_dipakai FROM tspk_pin5
           WHERE pin_trs = "QC BAHAN" AND pin_nomor = ?
           ORDER BY pin_urut DESC LIMIT 1`,
          [nomor],
        );
        if (
          pin.length === 0 ||
          pin[0].pin_acc !== "Y" ||
          pin[0].pin_dipakai !== ""
        ) {
          throw new Error(
            "Dokumen sudah disubmit. Ajukan perubahan data dan tunggu ACC terlebih dahulu.",
          );
        }
        pinUrut = pin[0].pin_urut;
      }
    } else {
      if (!poNomor || !podNourut) {
        throw new Error("PO Bahan dan baris bahan wajib dipilih.");
      }
    }

    const line = await loadPoLine(conn, poNomor, podNourut);
    const { min, max } = parseRentang(line.pod_gramasia);
    const qtyPo = Number(line.pod_Jumlah) || 0;

    // Dokumen yang sudah pernah disubmit selalu divalidasi penuh
    const submit = !!payload.submit || oldStatus !== "DRAFT";
    const newStatus = submit ? "MENUNGGU" : "DRAFT";
    const warnings = [];
    let totalKg = 0;

    const rows = inputRows.map((r, i) => {
      const gramasiCek = Number(r.gramasi_cek) || 0;
      const nilai = Number(r.nilai) || 0;
      const saran = hitungSaran(gramasiCek, min, max, toleransi);
      const alasan = String(r.alasan_nilai || "").trim();
      const kg = Number(r.qty_kg) || 0;
      totalKg += kg;

      if (nilai < 0) {
        throw new Error(`Nilai lot ${r.lot} tidak boleh negatif.`);
      }
      if (kg < 0 || Number(r.qty_roll) < 0) {
        throw new Error(`Qty dan roll lot ${r.lot} tidak boleh negatif.`);
      }
      if (submit) {
        if (!(kg > 0)) throw new Error(`Qty lot ${r.lot} wajib diisi.`);
        if (!(Number(r.qty_roll) > 0)) {
          throw new Error(`Roll lot ${r.lot} wajib diisi.`);
        }
        if (!(gramasiCek > 0)) {
          throw new Error(`Gramasi hasil cek lot ${r.lot} wajib diisi.`);
        }
        if (!String(r.setting_cek || "").trim()) {
          throw new Error(`Setting hasil cek lot ${r.lot} wajib diisi.`);
        }
        if (saran > 0 && nilai !== saran && !alasan) {
          throw new Error(
            `Nilai lot ${r.lot} berbeda dari saran sistem (${saran}). Alasan wajib diisi.`,
          );
        }
      }
      return {
        nourut: i + 1,
        lot: String(r.lot).trim(),
        kg,
        roll: Number(r.qty_roll) || 0,
        warna: String(r.warna || "").trim(),
        gramasiCek,
        settingCek: String(r.setting_cek || "").trim(),
        nilai,
        saran,
        alasan,
        hasil: r.hasil || {},
      };
    });

    if (totalKg > qtyPo) {
      warnings.push(
        `Total qty lot (${totalKg.toFixed(2)} ${line.pod_bhn_satuan}) melebihi qty PO (${qtyPo.toFixed(2)} ${line.pod_bhn_satuan}).`,
      );
    }

    if (!isEdit) {
      const vendor = await resolveVendor(conn, line);
      nomor = await generateNomor(conn, tgl);
      await conn.query(
        `
        INSERT INTO tqc_bahan_hdr (
          qc_nomor, qc_tgl_datang, qc_po_nomor, qc_bhn_kode, qc_pod_nourut,
          qc_vendor_greige, qc_jenis_kain, qc_vendor_celup,
          qc_status, qc_keterangan, user_create, date_create
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
        `,
        [
          nomor,
          tgl,
          poNomor,
          line.pod_bhn_kode,
          podNourut,
          vendor.greige,
          line.nama_jenis || line.nama_kain || "",
          vendor.celup,
          newStatus,
          payload.qc_keterangan || "",
          userKode,
        ],
      );
    } else {
      await conn.query(
        `
        UPDATE tqc_bahan_hdr
        SET qc_tgl_datang = ?, qc_keterangan = ?, qc_status = ?,
            user_modified = ?, date_modified = NOW()
        WHERE qc_nomor = ?
        `,
        [tgl, payload.qc_keterangan || "", newStatus, userKode, nomor],
      );
      await conn.query(`DELETE FROM tqc_bahan_hasil WHERE qch_qc_nomor = ?`, [
        nomor,
      ]);
      await conn.query(`DELETE FROM tqc_bahan_dtl WHERE qcd_qc_nomor = ?`, [
        nomor,
      ]);
    }

    for (const r of rows) {
      await conn.query(
        `
        INSERT INTO tqc_bahan_dtl (
          qcd_qc_nomor, qcd_nourut, qcd_lot, qcd_po_nomor, qcd_bhn_kode,
          qcd_qty_kg, qcd_qty_roll, qcd_qty_kg_po,
          qcd_gramasi_po, qcd_gramasi_min, qcd_gramasi_max, qcd_setting_po,
          qcd_warna, qcd_gramasi_cek, qcd_setting_cek,
          qcd_nilai, qcd_nilai_saran, qcd_alasan_nilai, qcd_keputusan
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '')
        `,
        [
          nomor,
          r.nourut,
          r.lot,
          poNomor,
          line.pod_bhn_kode,
          r.kg,
          r.roll,
          qtyPo,
          line.pod_gramasia || "",
          min,
          max,
          line.pod_setting || "",
          r.warna,
          r.gramasiCek,
          r.settingCek,
          r.nilai,
          r.saran,
          r.alasan,
        ],
      );

      await conn.query(
        `
        INSERT INTO tqc_bahan_hasil (
          qch_qc_nomor, qch_nourut, qch_lot, qch_gramasi, qch_setting,
          qch_warna, qch_handfeel, qch_bowing, qch_shrinkage, qch_kelunturan
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          nomor,
          r.nourut,
          r.lot,
          r.hasil.gramasi || "",
          r.hasil.setting || "",
          r.hasil.warna || "",
          r.hasil.handfeel || "",
          r.hasil.bowing || "",
          r.hasil.shrinkage || "",
          r.hasil.kelunturan || "",
        ],
      );
    }

    if (pinUrut !== null) {
      await conn.query(
        `UPDATE tspk_pin5 SET pin_dipakai = 'Y'
         WHERE pin_trs = "QC BAHAN" AND pin_nomor = ? AND pin_urut = ?`,
        [nomor, pinUrut],
      );
    }

    await conn.commit();
    return { qc_nomor: nomor, status: newStatus, warnings };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    if (locked) {
      await conn.query(`SELECT RELEASE_LOCK(?)`, [LOCK_NAME]);
    }
    conn.release();
  }
};

module.exports = {
  lookupPo,
  getPoSource,
  getDetail,
  getLampiran,
  saveLampiran,
  deleteLampiran,
  saveData,
};
