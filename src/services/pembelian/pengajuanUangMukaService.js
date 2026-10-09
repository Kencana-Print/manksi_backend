const db = require("../../config/database");
const {
  getTanggalTutupBukuUntukTanggal,
} = require("../../services/tutupBukuService");

const generateNomor = async (tanggal, conn) => {
  const year = new Date(tanggal).getFullYear();
  const prefix = `PUM.${year}.`;
  const [[row]] = await (conn || db).query(
    `SELECT IFNULL(MAX(CAST(RIGHT(pum_nomor,5) AS UNSIGNED)),0) AS maxVal
     FROM tpengajuan_uang_muka_hdr WHERE pum_nomor LIKE ?`,
    [`${prefix}%`],
  );
  const next = Number(row.maxVal) + 1;
  return `${prefix}${String(next).padStart(5, "0")}`;
};

// ── Port apa adanya dari uangMukaFormService.js (Finance) ──
const generateMntNomor = async (tanggal, conn) => {
  const d = new Date(tanggal);
  const yyyymm = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
  const [[row]] = await (conn || db).query(
    `SELECT IFNULL(MAX(CAST(RIGHT(pmt_nomor, 4) AS UNSIGNED)), 0) AS maxVal
     FROM ga2.tpermintaan_hdr WHERE pmt_nomor LIKE ?`,
    [`MNT.${yyyymm}.%`],
  );
  const next = Number(row.maxVal) + 1;
  return `MNT.${yyyymm}.${String(next).padStart(4, "0")}`;
};

const ensurePermintaanDana = async (pjhNomor, conn) => {
  const c = conn || db;
  const [[existing]] = await c.query(
    `SELECT pmt_nomor FROM ga2.tpermintaan_hdr WHERE pmt_pjh_nomor = ?`,
    [pjhNomor],
  );
  if (existing) return existing.pmt_nomor;

  // ⬅ DIUBAH: header sekarang cuma dipakai buat pjh_tanggal — pjh_cc_kode/
  // pjh_cc_dcnama TIDAK lagi diambil dari sini, karena CC sudah per item.
  const [[header]] = await c.query(
    `SELECT pjh_tanggal FROM ga2.tpengajuan2_hdr WHERE pjh_nomor = ?`,
    [pjhNomor],
  );
  if (!header) throw new Error("Pengajuan tidak ditemukan.");

  const pmtNomor = await generateMntNomor(header.pjh_tanggal, c);
  await c.query(
    `INSERT INTO ga2.tpermintaan_hdr (pmt_nomor, pmt_tanggal, pmt_pjh_nomor, pmt_keterangan)
     VALUES (?, CURDATE(), ?, '')`,
    [pmtNomor, pjhNomor],
  );

  // ⬅ DIUBAH: tarik pjd_cc_kode/pjd_cc_dcnama per baris juga
  const [items] = await c.query(
    `SELECT pjd_nourut, pjd_nama, pjd_spesifikasi, pjd_qty, pjd_nilai, pjd_satuan,
            pjd_kegunaan, pjd_jobkp, pjd_kode, pjd_cc_kode, pjd_cc_dcnama
     FROM ga2.tpengajuan2_dtl
     WHERE pjd_pjh_nomor = ? AND pjd_nama <> ''`,
    [pjhNomor],
  );
  for (const item of items) {
    await c.query(
      `INSERT INTO ga2.tpermintaan_dtl
         (pmd_pmt_nomor, pmd_nourut, pmd_nama, pmd_spesifikasi, pmd_qty, pmd_qty_riil,
          pmd_satuan, pmd_nilai, pmd_kegunaan, pmd_jobkp, pmd_kode,
          pmd_cc_kode, pmd_dcnama)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        pmtNomor,
        item.pjd_nourut,
        item.pjd_nama,
        item.pjd_spesifikasi || "",
        Number(item.pjd_qty) || 0,
        Number(item.pjd_qty) || 0,
        item.pjd_satuan || "",
        Number(item.pjd_nilai) || 0,
        item.pjd_kegunaan || "",
        item.pjd_jobkp || "",
        item.pjd_kode || "",
        item.pjd_cc_kode || 0, // ⬅ per item, bukan header
        item.pjd_cc_dcnama || "", // ⬅ per item, bukan header
      ],
    );
  }
  return pmtNomor;
};

// ── Create Pengajuan Uang Muka (dialog "Ajukan" Purchasing) ──
// items: [{ sumber: 'PENGAJUAN_DANA'|'PERMINTAAN_PEMBELIAN', nomorSumber, keterangan? }]
// Nominal dihitung ulang server-side dari tabel sumber — TIDAK percaya nominal dari frontend.
const createPengajuan = async (
  { tanggal, keterangan, nominalDiajukan, items },
  user,
) => {
  if (!items || !items.length) throw new Error("Minimal pilih 1 transaksi.");
  const totalDiajukan = Number(nominalDiajukan);
  if (!totalDiajukan || totalDiajukan <= 0) {
    throw new Error("Nominal yang diajukan wajib diisi.");
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const nomor = await generateNomor(tanggal, conn);
    const rowsToInsert = [];

    for (const it of items) {
      let nominalSumber = 0;
      let pmtNomor = null;
      const nomorSumber = it.nomorSumber || it.nomorHeader;

      const [[dup]] = await conn.query(
        `SELECT 1 FROM tpengajuan_uang_muka_dtl d
         JOIN tpengajuan_uang_muka_hdr h ON h.pum_nomor = d.pumd_pum_nomor
         WHERE d.pumd_sumber = ? AND d.pumd_nomor_sumber = ?
           AND d.pumd_item_nourut = ? AND h.pum_status = 'DIAJUKAN'`,
        [it.sumber, nomorSumber, it.itemNourut],
      );
      if (dup) {
        throw new Error(
          `${nomorSumber} item ini masih menunggu approval Finance pada pengajuan lain.`,
        );
      }

      if (it.sumber === "PENGAJUAN_DANA") {
        pmtNomor = await ensurePermintaanDana(nomorSumber, conn);
        const [[jml]] = await conn.query(
          `SELECT IFNULL(pjd_qty * pjd_nilai, 0) AS total
           FROM ga2.tpengajuan2_dtl WHERE pjd_pjh_nomor = ? AND pjd_nourut = ?`,
          [nomorSumber, it.itemNourut],
        );
        nominalSumber = Number(jml.total);

        await conn.query(
          `UPDATE ga2.tpermintaan_dtl SET pmd_status_finance = 'PENDING'
           WHERE pmd_pmt_nomor = ? AND pmd_nourut = ?`,
          [pmtNomor, it.itemNourut],
        );
      } else if (it.sumber === "PERMINTAAN_PEMBELIAN") {
        const [[jml]] = await conn.query(
          `SELECT IFNULL(mbd_jumlah * mbd_harga, 0) AS total
           FROM tgarmenmintabeli_dtl WHERE mbd_nomor = ? AND mbd_nourut = ?`,
          [nomorSumber, it.itemNourut],
        );
        nominalSumber = Number(jml.total);
      } else {
        throw new Error(`Sumber tidak dikenali: ${it.sumber}`);
      }

      rowsToInsert.push({
        ...it,
        nomorSumber,
        nominal: nominalSumber,
        nominalSumber,
        pmtNomor,
      });
    }

    await conn.query(
      `INSERT INTO tpengajuan_uang_muka_hdr
        (pum_nomor, pum_tanggal, pum_keterangan, pum_cabang, pum_user_create, pum_date_create, pum_status, pum_total_nominal)
       VALUES (?, ?, ?, ?, ?, NOW(), 'DIAJUKAN', ?)`,
      [nomor, tanggal, keterangan || "", user.cabang, user.kode, totalDiajukan],
    );

    for (const r of rowsToInsert) {
      await conn.query(
        `INSERT INTO tpengajuan_uang_muka_dtl
           (pumd_pum_nomor, pumd_sumber, pumd_nomor_sumber, pumd_item_nourut,
            pumd_nama, pumd_satuan, pumd_qty, pumd_keterangan,
            pumd_nominal_ajuan, pumd_nominal_sumber, pumd_pmt_nomor)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          nomor,
          r.sumber,
          r.nomorSumber,
          r.itemNourut,
          r.nama || "",
          r.satuan || "",
          r.qty || 0,
          r.keterangan || "",
          r.nominal,
          r.nominalSumber,
          r.pmtNomor,
        ],
      );
    }

    await conn.commit();
    return { nomor, totalNominal: totalDiajukan };
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
};

// ── Browse PUM (tab "Pengajuan Uang Muka") ──
const getBrowse = async ({ startDate, endDate, cabang, status }) => {
  const filterCabang = cabang && cabang !== "HO-" ? cabang : null;

  const unionSql = `
    (
      SELECT
        h.pum_nomor AS Nomor,
        DATE_FORMAT(h.pum_tanggal, '%Y-%m-%d') AS Tanggal,
        h.pum_keterangan AS Keterangan,
        h.pum_cabang AS Cabang,
        h.pum_status AS Status,
        h.pum_total_nominal AS TotalNominal,
        h.pum_bon_nomor AS BonNomor,
        h.pum_user_create AS UserCreate,
        h.pum_user_realisasi AS UserRealisasi,
        k.bon_selesai AS BonSelesai,
        IF(k.bon_jenis=0,'KAS','BANK') AS Jenis,
        r.rek_nama AS Account,
        k.bon_pjh_nomor AS Pjh,
        k.bon_nota AS Nota,
        k.bon_penerima AS Penerima,
        k.bon_jur_no AS NoBukti,
        k.bon_tanggal AS BonTanggal,
        IF(k.bon_jur_no='', 0,
          IFNULL((SELECT SUM(d.jurd_kredit) FROM finance.tjurnalitem d WHERE d.jurd_jur_no = k.bon_jur_no), 0)
        ) AS Terpakai,
        DATE_FORMAT(k.date_create, '%Y-%m-%d %H:%i') AS TglDibuat,
        k.user_create AS DibuatOleh
      FROM tpengajuan_uang_muka_hdr h
      LEFT JOIN finance.tkasbon k ON k.bon_nomor = h.pum_bon_nomor
      LEFT JOIN finance.trekening r ON r.rek_kode = k.bon_rek_kode
      WHERE 1=1
      ${startDate && endDate ? "AND h.pum_tanggal BETWEEN ? AND ?" : ""}
      ${filterCabang ? "AND h.pum_cabang = ?" : ""}
    )
    UNION ALL
    (
      -- Kasbon dari sistem lama: dibuat langsung atas Pengajuan Dana
      -- tanpa pernah lewat tahap Pengajuan Uang Muka baru. Ditampilkan
      -- dengan Nomor (PUM) kosong; Status dianggap REALISASI karena
      -- kasbonnya memang sudah ada/cair, statusnya tinggal soal sudah
      -- diselesaikan (BonSelesai) atau belum.
      SELECT
        NULL AS Nomor,
        DATE_FORMAT(k.bon_tanggal, '%Y-%m-%d') AS Tanggal,
        k.bon_keterangan AS Keterangan,
        k.bon_cabang AS Cabang,
        'REALISASI' AS Status,
        k.bon_nominal AS TotalNominal,
        k.bon_nomor AS BonNomor,
        '' AS UserCreate,
        '' AS UserRealisasi,
        k.bon_selesai AS BonSelesai,
        IF(k.bon_jenis=0,'KAS','BANK') AS Jenis,
        r.rek_nama AS Account,
        k.bon_pjh_nomor AS Pjh,
        k.bon_nota AS Nota,
        k.bon_penerima AS Penerima,
        k.bon_jur_no AS NoBukti,
        k.bon_tanggal AS BonTanggal,
        IF(k.bon_jur_no='', 0,
          IFNULL((SELECT SUM(d.jurd_kredit) FROM finance.tjurnalitem d WHERE d.jurd_jur_no = k.bon_jur_no), 0)
        ) AS Terpakai,
        DATE_FORMAT(k.date_create, '%Y-%m-%d %H:%i') AS TglDibuat,
        k.user_create AS DibuatOleh
      FROM finance.tkasbon k
      LEFT JOIN finance.trekening r ON r.rek_kode = k.bon_rek_kode
      WHERE NOT EXISTS (
          SELECT 1 FROM tpengajuan_uang_muka_hdr h2 WHERE h2.pum_bon_nomor = k.bon_nomor
        )
      ${startDate && endDate ? "AND k.bon_tanggal BETWEEN ? AND ?" : ""}
      ${filterCabang ? "AND k.bon_cabang = ?" : ""}
    )
  `;

  const dateParams = startDate && endDate ? [startDate, endDate] : [];
  const cabangParams = filterCabang ? [filterCabang] : [];
  const params = [
    ...dateParams,
    ...cabangParams,
    ...dateParams,
    ...cabangParams,
  ];

  let sql = `SELECT * FROM (${unionSql}) x WHERE 1=1`;
  if (status === "OUTSTANDING") {
    sql += ` AND x.Status = 'DIAJUKAN'`;
  } else if (status === "HISTORY") {
    sql += ` AND x.Status IN ('REALISASI', 'DITOLAK', 'BATAL')`;
  }
  sql += ` ORDER BY x.Tanggal DESC, x.Nomor DESC`;

  const [rows] = await db.query(sql, params);

  const tutupCache = new Map();
  for (const row of rows) {
    row.Sisa = Number(row.TotalNominal) - Number(row.Terpakai || 0);
    if (row.BonTanggal) {
      const key = new Date(row.BonTanggal).toISOString().slice(0, 10);
      if (!tutupCache.has(key)) {
        tutupCache.set(
          key,
          await getTanggalTutupBukuUntukTanggal(row.BonTanggal),
        );
      }
      row.Closed = new Date(row.BonTanggal) < tutupCache.get(key);
    } else {
      row.Closed = false;
    }
  }

  return rows;
};

const getDetail = async (nomor) => {
  const [[hdr]] = await db.query(
    `SELECT pum_total_nominal, pum_keterangan FROM tpengajuan_uang_muka_hdr WHERE pum_nomor = ?`,
    [nomor],
  );

  const [rows] = await db.query(
    `SELECT pumd_id AS Id, pumd_sumber AS Sumber, pumd_nomor_sumber AS NomorSumber,
            pumd_item_nourut AS ItemNourut, pumd_nama AS Nama, pumd_satuan AS Satuan,
            pumd_qty AS Qty, pumd_keterangan AS Keterangan, pumd_nominal_ajuan AS NominalAjuan,
            pumd_nominal_sumber AS NominalSumber,
            pumd_status_acc AS StatusAcc, pumd_nominal_acc AS NominalAcc
     FROM tpengajuan_uang_muka_dtl WHERE pumd_pum_nomor = ? ORDER BY pumd_id`,
    [nomor],
  );

  // Baris sintetis KASBON — mewakili total nominal yang benar-benar
  // diajukan Purchasing ke Finance (pum_total_nominal), terpisah dari
  // rincian per item yang nominalnya murni informasi/estimasi.
  const kasbonRow = {
    Id: null,
    Sumber: "KASBON",
    NomorSumber: nomor,
    ItemNourut: null,
    Nama: "KASBON",
    Satuan: "",
    Qty: null,
    Keterangan: hdr?.pum_keterangan || "",
    NominalAjuan: Number(hdr?.pum_total_nominal) || 0,
    NominalSumber: Number(hdr?.pum_total_nominal) || 0,
    StatusAcc: null,
    NominalAcc: null,
  };

  return [...rows, kasbonRow];
};

// ── Data cetak Bukti Pengajuan Uang Muka — dari PUM sebelum Realisasi ──
const getPrintData = async (nomor) => {
  const [[hdr]] = await db.query(
    `SELECT h.pum_nomor, DATE_FORMAT(h.pum_tanggal,'%d-%m-%Y') AS tanggal_fmt,
            h.pum_keterangan, h.pum_cabang, h.pum_total_nominal, h.pum_user_create,
            IFNULL(u.user_nama, h.pum_user_create) AS pemohon
     FROM tpengajuan_uang_muka_hdr h
     LEFT JOIN tuser u ON u.user_kode = h.pum_user_create
     WHERE h.pum_nomor = ?`,
    [nomor],
  );
  if (!hdr) throw new Error("Pengajuan Uang Muka tidak ditemukan.");

  const [dtl] = await db.query(
    `SELECT pumd_sumber, pumd_nomor_sumber, pumd_nama, pumd_satuan, pumd_qty, pumd_nominal_sumber
     FROM tpengajuan_uang_muka_dtl WHERE pumd_pum_nomor = ? ORDER BY pumd_id`,
    [nomor],
  );

  const detail = dtl.map((d) => ({
    sumber: d.pumd_sumber,
    nomorSumber: d.pumd_nomor_sumber,
    nama: d.pumd_nama,
    spesifikasi: d.pumd_satuan || "",
    qty: Number(d.pumd_qty) || 0,
    nominal: Number(d.pumd_nominal_sumber) || 0,
  }));

  return {
    nomor: hdr.pum_nomor,
    tanggal_fmt: hdr.tanggal_fmt,
    keterangan: hdr.pum_keterangan || "",
    cabang: hdr.pum_cabang,
    pemohon: hdr.pemohon,
    detail,
    totalDiajukan: Number(hdr.pum_total_nominal) || 0,
  };
};

// ── Data cetak Penyerahan Dana Belanja (serah terima uang ke purchasing lapangan) ──
const getPrintPenyerahan = async (nomor) => {
  const [[hdr]] = await db.query(
    `SELECT h.pum_nomor, h.pum_status,
            DATE_FORMAT(h.pum_tanggal,'%d-%m-%Y') AS tanggal_fmt,
            h.pum_keterangan, h.pum_cabang,
            IFNULL(k.bon_nominal, h.pum_total_nominal) AS total,
            IFNULL(uc.user_nama, h.pum_user_create) AS penyerah
     FROM tpengajuan_uang_muka_hdr h
     LEFT JOIN finance.tkasbon k ON k.bon_nomor = h.pum_bon_nomor
     LEFT JOIN tuser uc ON uc.user_kode = h.pum_user_create
     WHERE h.pum_nomor = ?`,
    [nomor],
  );
  if (!hdr) throw new Error("Pengajuan Uang Muka tidak ditemukan.");
  if (hdr.pum_status !== "REALISASI") {
    throw new Error(
      "Penyerahan dana hanya untuk pengajuan yang sudah direalisasi.",
    );
  }

  const [dtl] = await db.query(
    `SELECT pumd_nama, pumd_satuan, pumd_qty
     FROM tpengajuan_uang_muka_dtl
     WHERE pumd_pum_nomor = ? ORDER BY pumd_id`,
    [nomor],
  );

  return {
    tanggal_fmt: hdr.tanggal_fmt,
    keterangan: hdr.pum_keterangan || "",
    cabang: hdr.pum_cabang,
    penyerah: hdr.penyerah || "",
    total: Number(hdr.total) || 0,
    detail: dtl.map((d) => ({
      uraian: d.pumd_nama,
      satuan: d.pumd_satuan || "",
      qty: Number(d.pumd_qty) || 0,
    })),
  };
};

module.exports = {
  createPengajuan,
  getBrowse,
  getDetail,
  ensurePermintaanDana,
  getPrintData,
  getPrintPenyerahan,
};
