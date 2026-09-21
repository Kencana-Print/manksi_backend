const db = require("../../config/database");

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
     FROM ga2new.tpermintaan_hdr WHERE pmt_nomor LIKE ?`,
    [`MNT.${yyyymm}.%`],
  );
  const next = Number(row.maxVal) + 1;
  return `MNT.${yyyymm}.${String(next).padStart(4, "0")}`;
};

const ensurePermintaanDana = async (pjhNomor, conn) => {
  const c = conn || db;
  const [[existing]] = await c.query(
    `SELECT pmt_nomor FROM ga2new.tpermintaan_hdr WHERE pmt_pjh_nomor = ?`,
    [pjhNomor],
  );
  if (existing) return existing.pmt_nomor;

  const [[header]] = await c.query(
    `SELECT pjh_tanggal, pjh_cc_kode, pjh_cc_dcnama
     FROM ga2new.tpengajuan2_hdr WHERE pjh_nomor = ?`,
    [pjhNomor],
  );
  if (!header) throw new Error("Pengajuan tidak ditemukan.");

  const pmtNomor = await generateMntNomor(header.pjh_tanggal, c);
  await c.query(
    `INSERT INTO ga2new.tpermintaan_hdr (pmt_nomor, pmt_tanggal, pmt_pjh_nomor, pmt_keterangan)
     VALUES (?, CURDATE(), ?, '')`,
    [pmtNomor, pjhNomor],
  );

  const [items] = await c.query(
    `SELECT pjd_nourut, pjd_nama, pjd_spesifikasi, pjd_qty, pjd_nilai, pjd_satuan,
            pjd_kegunaan, pjd_jobkp, pjd_kode
     FROM ga2new.tpengajuan2_dtl
     WHERE pjd_pjh_nomor = ? AND pjd_nama <> ''`,
    [pjhNomor],
  );
  for (const item of items) {
    await c.query(
      `INSERT INTO ga2new.tpermintaan_dtl
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
        header.pjh_cc_kode || 0,
        header.pjh_cc_dcnama || "",
      ],
    );
  }
  return pmtNomor;
};

// ── Create Pengajuan Uang Muka (dialog "Ajukan" Purchasing) ──
// items: [{ sumber: 'PENGAJUAN_DANA'|'PERMINTAAN_PEMBELIAN', nomorSumber, keterangan? }]
// Nominal dihitung ulang server-side dari tabel sumber — TIDAK percaya nominal dari frontend.
const createPengajuan = async ({ tanggal, keterangan, items }, user) => {
  if (!items || !items.length) throw new Error("Minimal pilih 1 transaksi.");

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const nomor = await generateNomor(tanggal, conn);
    let totalNominal = 0;
    const rowsToInsert = [];

    for (const it of items) {
      let nominalSumber = 0;
      let nominal = 0;
      let pmtNomor = null;

      const [[dup]] = await conn.query(
        `SELECT 1 FROM tpengajuan_uang_muka_dtl d
         JOIN tpengajuan_uang_muka_hdr h ON h.pum_nomor = d.pumd_pum_nomor
         WHERE d.pumd_sumber = ? AND d.pumd_nomor_sumber = ?
           AND h.pum_status NOT IN ('DITOLAK','BATAL')`,
        [it.sumber, it.nomorSumber],
      );
      if (dup) {
        throw new Error(
          `${it.nomorSumber} sudah masuk pengajuan uang muka lain.`,
        );
      }

      if (it.sumber === "PENGAJUAN_DANA") {
        pmtNomor = await ensurePermintaanDana(it.nomorSumber, conn);
        const [[jml]] = await conn.query(
          `SELECT IFNULL(SUM(d.pjd_qty * d.pjd_nilai),0) AS total
           FROM ga2new.tpengajuan2_dtl d WHERE d.pjd_pjh_nomor = ?`,
          [it.nomorSumber],
        );
        nominalSumber = Number(jml.total);
      } else if (it.sumber === "PERMINTAAN_PEMBELIAN") {
        const [[jml]] = await conn.query(
          `SELECT IFNULL(SUM(d.mbd_jumlah * d.mbd_harga),0) AS total
           FROM tgarmenmintabeli_dtl d WHERE d.mbd_nomor = ?`,
          [it.nomorSumber],
        );
        nominalSumber = Number(jml.total);
      } else {
        throw new Error(`Sumber tidak dikenali: ${it.sumber}`);
      }

      // Nominal FINAL ditentukan Purchasing (kadang harga belum ada dari
      // peminta, Purchasing yang mencarikan/mengisi harga saat mengajukan).
      // nominalSumber tetap disimpan sebagai referensi/audit trail.
      if (
        it.nominal !== undefined &&
        it.nominal !== null &&
        it.nominal !== ""
      ) {
        nominal = Number(it.nominal);
        if (Number.isNaN(nominal) || nominal < 0) {
          throw new Error(`Nominal untuk ${it.nomorSumber} tidak valid.`);
        }
      } else {
        nominal = nominalSumber;
      }

      totalNominal += nominal;
      rowsToInsert.push({ ...it, nominal, nominalSumber, pmtNomor });
    }

    await conn.query(
      `INSERT INTO tpengajuan_uang_muka_hdr
        (pum_nomor, pum_tanggal, pum_keterangan, pum_cabang, pum_user_create, pum_date_create, pum_status, pum_total_nominal)
       VALUES (?, ?, ?, ?, ?, NOW(), 'DIAJUKAN', ?)`,
      [nomor, tanggal, keterangan || "", user.cabang, user.kode, totalNominal],
    );

    for (const r of rowsToInsert) {
      await conn.query(
        `INSERT INTO tpengajuan_uang_muka_dtl
           (pumd_pum_nomor, pumd_sumber, pumd_nomor_sumber, pumd_keterangan,
            pumd_nominal_ajuan, pumd_nominal_sumber, pumd_pmt_nomor)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          nomor,
          r.sumber,
          r.nomorSumber,
          r.keterangan || "",
          r.nominal,
          r.nominalSumber,
          r.pmtNomor,
        ],
      );
    }

    await conn.commit();
    return { nomor, totalNominal };
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
};

// ── Browse PUM (tab "Pengajuan Uang Muka") ──
const getBrowse = async ({ startDate, endDate, cabang, status }) => {
  let sql = `
    SELECT
      h.pum_nomor AS Nomor,
      DATE_FORMAT(h.pum_tanggal, '%Y-%m-%d') AS Tanggal,
      h.pum_keterangan AS Keterangan,
      h.pum_cabang AS Cabang,
      h.pum_status AS Status,
      h.pum_total_nominal AS TotalNominal,
      h.pum_bon_nomor AS BonNomor,
      h.pum_user_create AS UserCreate,
      h.pum_user_realisasi AS UserRealisasi
    FROM tpengajuan_uang_muka_hdr h
    WHERE 1=1
  `;
  const params = [];
  if (startDate && endDate) {
    sql += ` AND h.pum_tanggal BETWEEN ? AND ?`;
    params.push(startDate, endDate);
  }
  if (cabang) {
    sql += ` AND h.pum_cabang = ?`;
    params.push(cabang);
  }
  if (status === "OUTSTANDING") {
    sql += ` AND h.pum_status = 'DIAJUKAN'`;
  } else if (status === "HISTORY") {
    sql += ` AND h.pum_status IN ('REALISASI', 'DITOLAK', 'BATAL')`;
  }
  sql += ` ORDER BY h.pum_tanggal DESC, h.pum_nomor DESC`;

  const [rows] = await db.query(sql, params);
  return rows;
};

const getDetail = async (nomor) => {
  const [rows] = await db.query(
    `SELECT pumd_id AS Id, pumd_sumber AS Sumber, pumd_nomor_sumber AS NomorSumber,
            pumd_keterangan AS Keterangan, pumd_nominal_ajuan AS NominalAjuan,
            pumd_nominal_sumber AS NominalSumber,
            pumd_status_acc AS StatusAcc, pumd_nominal_acc AS NominalAcc
     FROM tpengajuan_uang_muka_dtl WHERE pumd_pum_nomor = ? ORDER BY pumd_id`,
    [nomor],
  );
  return rows;
};

module.exports = {
  createPengajuan,
  getBrowse,
  getDetail,
  ensurePermintaanDana,
};
