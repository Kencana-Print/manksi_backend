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
const createPengajuan = async (
  { tanggal, keterangan, nota, nominalDiajukan, items },
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
           AND h.pum_status NOT IN ('DITOLAK','BATAL')`,
        [it.sumber, nomorSumber],
      );
      if (dup) {
        throw new Error(`${nomorSumber} sudah masuk pengajuan uang muka lain.`);
      }

      if (it.sumber === "PENGAJUAN_DANA") {
        pmtNomor = await ensurePermintaanDana(nomorSumber, conn);
        const [[jml]] = await conn.query(
          `SELECT IFNULL(pjd_qty * pjd_nilai, 0) AS total
           FROM ga2new.tpengajuan2_dtl WHERE pjd_pjh_nomor = ? AND pjd_nourut = ?`,
          [nomorSumber, it.itemNourut],
        );
        nominalSumber = Number(jml.total);
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

      // Nominal per-baris tidak lagi diedit manual — baris hanya menyimpan
      // nilai sumber sebagai referensi/audit trail. Angka yang benar-benar
      // diajukan ke Finance adalah total di header (totalDiajukan),
      // diisi Purchasing sebagai satu nilai gabungan.
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
        (pum_nomor, pum_tanggal, pum_keterangan, pum_nota, pum_cabang, pum_user_create, pum_date_create, pum_status, pum_total_nominal)
       VALUES (?, ?, ?, ?, ?, ?, NOW(), 'DIAJUKAN', ?)`,
      [
        nomor,
        tanggal,
        keterangan || "",
        nota || "",
        user.cabang,
        user.kode,
        totalDiajukan,
      ],
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
        IFNULL((SELECT SUM(d.jurd_kredit) FROM financenew.tjurnalitem d WHERE d.jurd_jur_no = k.bon_jur_no), 0)
      ) AS Terpakai,
      DATE_FORMAT(k.date_create, '%Y-%m-%d %H:%i') AS TglDibuat,
      k.user_create AS DibuatOleh
    FROM tpengajuan_uang_muka_hdr h
    LEFT JOIN financenew.tkasbon k ON k.bon_nomor = h.pum_bon_nomor
    LEFT JOIN financenew.trekening r ON r.rek_kode = k.bon_rek_kode
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

  // Sisa & Closed dihitung di JS — Sisa perlu Nominal (bon_nominal,
  // bukan pum_total_nominal, karena nominal terpakai dihitung dari jurnal
  // atas bon, bukan atas PUM) dan Closed perlu cek periode tutup buku
  // per baris (tidak murah sebagai subquery per-row di SQL).
  for (const row of rows) {
    row.Sisa = Number(row.TotalNominal) - Number(row.Terpakai || 0);
    if (row.BonTanggal) {
      const boundary = await getTanggalTutupBukuUntukTanggal(row.BonTanggal);
      row.Closed = new Date(row.BonTanggal) < boundary;
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
const getPrintData = async (nomor, user) => {
  const [[hdr]] = await db.query(
    `SELECT pum_nomor, DATE_FORMAT(pum_tanggal,'%d-%m-%Y') AS tanggal_fmt,
            pum_keterangan, pum_cabang, pum_total_nominal, pum_user_create
     FROM tpengajuan_uang_muka_hdr WHERE pum_nomor = ?`,
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
    pemohon: user?.nama || user?.kode || hdr.pum_user_create,
    detail,
    totalDiajukan: Number(hdr.pum_total_nominal) || 0,
  };
};

module.exports = {
  createPengajuan,
  getBrowse,
  getDetail,
  ensurePermintaanDana,
  getPrintData,
};
