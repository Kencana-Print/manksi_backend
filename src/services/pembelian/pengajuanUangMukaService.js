const db = require("../../config/database");
const {
  getTanggalTutupBukuUntukTanggal,
} = require("../../services/tutupBukuService");
const { hitungSaldoAkun } = require("../postingGuardService");
const {
  cariLaciPemilik,
  BATAS_SALDO_LACI_MANDIRI,
  saveRealisasi,
} = require("./uangMukaRealisasiService");

// ── Konstanta & fragmen SQL bersama (dipakai uangMukaService, Realisasi, dst.) ──
const BKK_P04_MULAI = "2026-09-28";

// Nilai satu baris PO Lain-lain, sudah termasuk PPN baris (alias tabel: d = tpo_dtl)
const SQL_NOMINAL_BARIS_PO = `
  d.pod_Jumlah * d.pod_hargabeli * (100 - d.pod_disc) / 100
  * (100 + d.pod_ppn) / 100`;

// Sumber fee per SPK/SO — sama dengan query cetak Pengajuan Insentif
const SQL_SUMBER_FEE = `
  (SELECT spk_nomor AS nomor, spk_nama AS nama, spk_hargafee AS hargafee
     FROM tspk WHERE spk_aktif = 'Y'
   UNION ALL
   SELECT so_nomor, so_nama, so_hargafee
     FROM tsalesorder WHERE so_aktif = 'Y')`;

// Nominal satu dokumen insentif (alias: h = tpengajuan_fee)
const SQL_NOMINAL_INSENTIF = `
  IFNULL((
    SELECT SUM(i.INVD_Jumlah * s.hargafee)
    FROM tpengajuan_fee2 d
    JOIN tinv_dtl i ON i.INVD_inv_nomor = d.feed_inv_nomor
    JOIN ${SQL_SUMBER_FEE} s ON s.nomor = i.INVD_Spk_Nomor
    WHERE d.feed_nomor = h.fee_nomor AND s.hargafee <> 0
  ), 0)`;

// Sumber yang satu dokumennya = satu baris PUM
const SUMBER_HEADER = ["INSENTIF", "BKK_P04"];

// Sumber masih "dipegang" PUM: sedang diajukan, atau sudah direalisasi
// dengan baris di-ACC. itemNourut = null berarti cek tingkat dokumen.
const sumberSudahDipakai = async (conn, sumber, nomorSumber, itemNourut) => {
  const [[row]] = await conn.query(
    `SELECT 1 AS x
     FROM tpengajuan_uang_muka_dtl pd
     JOIN tpengajuan_uang_muka_hdr ph ON ph.pum_nomor = pd.pumd_pum_nomor
     WHERE pd.pumd_sumber = ? AND pd.pumd_nomor_sumber = ?
       ${itemNourut === null ? "" : "AND pd.pumd_item_nourut = ?"}
       AND (ph.pum_status = 'DIAJUKAN'
            OR (ph.pum_status = 'REALISASI' AND pd.pumd_status_acc = 'ACC'))
     LIMIT 1`,
    itemNourut === null
      ? [sumber, nomorSumber]
      : [sumber, nomorSumber, itemNourut],
  );
  return !!row;
};

const generateNomor = async (tanggal, conn, kode = "PUM") => {
  const year = new Date(tanggal).getFullYear();
  const prefix = `${kode}.${year}.`;
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
  {
    tanggal,
    keterangan,
    nominalDiajukan,
    items,
    jenis = "UM",
    laciTujuan = "",
  },
  user,
  extConn = null,
) => {
  if (!items || !items.length) throw new Error("Minimal pilih 1 transaksi.");
  const totalDiajukan = Number(nominalDiajukan);
  if (!totalDiajukan || totalDiajukan <= 0) {
    throw new Error("Nominal yang diajukan wajib diisi.");
  }

  // Sumber tingkat-dokumen: satu dokumen = satu baris PUM
  const vistos = new Set();
  const itemsFinal = items.filter((it) => {
    if (!SUMBER_HEADER.includes(it.sumber)) return true;
    const key = `${it.sumber}|${it.nomorSumber || it.nomorHeader}`;
    if (vistos.has(key)) return false;
    vistos.add(key);
    return true;
  });

  const eksternal = !!extConn;
  const conn = extConn || (await db.getConnection());
  try {
    if (!eksternal) await conn.beginTransaction();

    const nomor = await generateNomor(
      tanggal,
      conn,
      jenis === "PD" ? "PD" : "PUM",
    );
    const rowsToInsert = [];

    for (const it of itemsFinal) {
      let nominalSumber = 0;
      let pmtNomor = null;
      let override = {};
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
      } else if (it.sumber === "INSENTIF") {
        const [[fee]] = await conn.query(
          `SELECT fee_tgl_realisasi FROM tpengajuan_fee WHERE fee_nomor = ? FOR UPDATE`,
          [nomorSumber],
        );
        if (!fee)
          throw new Error(`Pengajuan insentif ${nomorSumber} tidak ditemukan.`);
        if (fee.fee_tgl_realisasi)
          throw new Error(`Insentif ${nomorSumber} sudah direalisasi.`);
        if (await sumberSudahDipakai(conn, "INSENTIF", nomorSumber, null))
          throw new Error(
            `Insentif ${nomorSumber} sudah ada di pengajuan uang muka lain.`,
          );
        const [[tot]] = await conn.query(
          `SELECT ${SQL_NOMINAL_INSENTIF} AS total
           FROM tpengajuan_fee h WHERE h.fee_nomor = ?`,
          [nomorSumber],
        );
        nominalSumber = Number(tot.total);
        if (nominalSumber <= 0)
          throw new Error(`Insentif ${nomorSumber} tidak punya nominal fee.`);
        override = {
          itemNourut: 0,
          nama: `Insentif ${nomorSumber}`,
          satuan: "",
          qty: 1,
        };
      } else if (it.sumber === "BKK_P04") {
        const [[bkk]] = await conn.query(
          `SELECT h.jur_cabang, h.jur_otomatis, h.jur_tanggal >= ? AS sesudahMulai,
                  LEFT(h.jur_rek_kode, 5) AS pref,
                  EXISTS(SELECT 1 FROM finance.tkasbon k WHERE k.bon_jur_no = h.jur_no) AS dariKasbon,
                  IFNULL((
                    SELECT SUM(i.jurd_debet) FROM finance.tjurnalitem i
                    WHERE i.jurd_jur_no = h.jur_no AND i.jurd_trs = 'BKK'
                  ), 0) AS total
           FROM finance.tjurnal h
           WHERE h.jur_no = ? AND h.jur_tipetransaksi = 'BKK'`,
          [BKK_P04_MULAI, nomorSumber],
        );
        if (!bkk) throw new Error(`BKK ${nomorSumber} tidak ditemukan.`);
        if (
          bkk.jur_cabang !== "P04" ||
          Number(bkk.jur_otomatis) !== 0 ||
          bkk.pref !== "A-111" ||
          !Number(bkk.sesudahMulai) ||
          Number(bkk.dariKasbon)
        ) {
          throw new Error(
            `BKK ${nomorSumber} tidak memenuhi syarat penggantian kas kecil P04.`,
          );
        }
        if (await sumberSudahDipakai(conn, "BKK_P04", nomorSumber, null))
          throw new Error(
            `BKK ${nomorSumber} sudah ada di pengajuan uang muka lain.`,
          );
        nominalSumber = Number(bkk.total);
        if (nominalSumber <= 0)
          throw new Error(`BKK ${nomorSumber} tidak punya nominal.`);
        override = {
          itemNourut: 0,
          nama: `Ganti kas kecil ${nomorSumber}`,
          satuan: "",
          qty: 1,
        };
      } else if (it.sumber === "PO_LAIN_LAIN") {
        const [[ln]] = await conn.query(
          `SELECT d.pod_bhn_kode AS kode, d.pod_namaext AS nama,
                  d.pod_bhn_satuan AS satuan, d.pod_Jumlah AS qty,
                  d.pod_sup_kode AS sup,
                  ROUND(${SQL_NOMINAL_BARIS_PO}, 2) AS total
           FROM tpo_hdr h
           JOIN tpo_dtl d ON d.pod_po_Nomor = h.po_nomor
           WHERE h.po_nomor = ? AND h.po_jenis = 4
             AND d.pod_nourut = ? AND d.pod_bhn_kode <> ''`,
          [nomorSumber, it.itemNourut],
        );
        if (!ln)
          throw new Error(`Baris PO Lain-lain ${nomorSumber} tidak ditemukan.`);
        if (!ln.sup)
          throw new Error(`Baris PO ${nomorSumber} belum punya supplier.`);
        if (
          await sumberSudahDipakai(
            conn,
            "PO_LAIN_LAIN",
            nomorSumber,
            it.itemNourut,
          )
        )
          throw new Error(
            `Baris PO ${nomorSumber} sudah ada di pengajuan uang muka lain.`,
          );
        const [[trf]] = await conn.query(
          `SELECT 1 AS x FROM finance.tpengajuan_transfer_dtl
           WHERE ptd_trs = ? AND ptd_sup_kode = ? AND ptd_batal = '' LIMIT 1`,
          [nomorSumber, ln.sup],
        );
        if (trf)
          throw new Error(
            `PO ${nomorSumber} (supplier ${ln.sup}) sudah diajukan lewat Pengajuan Transfer.`,
          );
        const [[vouPol]] = await conn.query(
          `SELECT 1 AS x
           FROM tvoucher_dtl v
           INNER JOIN tvoucher_hdr vh ON vh.vou_nomor = v.voud_vou_nomor
           WHERE v.voud_nota = ? AND v.voud_type = 'POL'
             AND vh.vou_sup_kode = ?
           LIMIT 1`,
          [nomorSumber, ln.sup],
        );
        if (vouPol)
          throw new Error(
            `PO ${nomorSumber} (supplier ${ln.sup}) sudah dibuatkan Voucher Pembayaran.`,
          );
        nominalSumber = Number(ln.total);
        override = {
          nama: ln.nama || ln.kode,
          satuan: ln.satuan || "",
          qty: Number(ln.qty) || 0,
        };
      }

      rowsToInsert.push({
        ...it,
        ...override,
        nomorSumber,
        nominal: nominalSumber,
        nominalSumber,
        pmtNomor,
      });
    }

    await conn.query(
      `INSERT INTO tpengajuan_uang_muka_hdr
        (pum_nomor, pum_tanggal, pum_keterangan, pum_cabang, pum_user_create, pum_date_create, pum_status, pum_jenis, pum_laci_tujuan, pum_total_nominal)
       VALUES (?, ?, ?, ?, ?, NOW(), 'DIAJUKAN', ?, ?, ?)`,
      [
        nomor,
        tanggal,
        keterangan || "",
        user.cabang,
        user.kode,
        jenis,
        laciTujuan,
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

    if (!eksternal) await conn.commit();
    return { nomor, totalNominal: totalDiajukan };
  } catch (e) {
    if (!eksternal) await conn.rollback();
    throw e;
  } finally {
    if (!eksternal) conn.release();
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
        k.user_create AS DibuatOleh,
        k.bon_transfer_jur_no AS TransferJurNo,
        k.bon_konfirmasi_tgl AS KonfirmasiTgl,
        r.rek_pemilik AS LaciPemilik,
        (SELECT v.val_aksi FROM tpengajuan_uang_muka_validasi v
          WHERE v.val_pum_nomor = h.pum_nomor AND v.val_jenis = 'PENGAJUAN'
          ORDER BY v.val_id DESC LIMIT 1) AS ValAksi,
        (SELECT v.val_aksi FROM tpengajuan_uang_muka_validasi v
          WHERE v.val_pum_nomor = h.pum_nomor AND v.val_jenis = 'PENYELESAIAN'
          ORDER BY v.val_id DESC LIMIT 1) AS ValAksiSelesai
      FROM tpengajuan_uang_muka_hdr h
      LEFT JOIN finance.tkasbon k ON k.bon_nomor = h.pum_bon_nomor
      LEFT JOIN finance.trekening r ON r.rek_kode = k.bon_rek_kode
      WHERE h.pum_jenis = 'UM'
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
        k.user_create AS DibuatOleh,
        k.bon_transfer_jur_no AS TransferJurNo,
        k.bon_konfirmasi_tgl AS KonfirmasiTgl,
        r.rek_pemilik AS LaciPemilik,
        NULL AS ValAksi,
        NULL AS ValAksiSelesai
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
    // "" = tidak pakai transfer kas (tidak perlu konfirmasi)
    row.KonfirmasiStatus = !row.TransferJurNo
      ? ""
      : row.KonfirmasiTgl
        ? "SUDAH"
        : "BELUM";
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

// ── Petty Cash (HO-/P01) ──
const CABANG_PETTY = ["HO-", "P01"];
const LOCK_NOMOR_PC = "manksi_penomoran_pc";

const generateNomorPettyCash = async (tanggal, conn) => {
  const year = new Date(tanggal).getFullYear();
  const prefix = `PC.${year}.`;
  const [[row]] = await conn.query(
    `SELECT IFNULL(MAX(CAST(RIGHT(pum_nomor,5) AS UNSIGNED)),0) AS maxVal
     FROM tpengajuan_uang_muka_hdr WHERE pum_nomor LIKE ?`,
    [`${prefix}%`],
  );
  return `${prefix}${String(Number(row.maxVal) + 1).padStart(5, "0")}`;
};

// Pengajuan Petty Cash: nominal saja, tanpa memilih transaksi outstanding.
// Laci tujuan = laci milik pembuat (rek_pemilik), dikunci saat dibuat.
const createPettyCash = async ({ tanggal, keterangan, nominal }, user) => {
  const cabang = String(user?.cabang || "")
    .trim()
    .toUpperCase();
  if (!CABANG_PETTY.includes(cabang))
    throw new Error("Petty Cash hanya untuk cabang HO-/P01.");
  if (!tanggal) throw new Error("Tanggal wajib diisi.");
  const total = Math.round((Number(nominal) || 0) * 100) / 100;
  if (total <= 0) throw new Error("Nominal pengajuan wajib diisi.");

  const conn = await db.getConnection();
  let locked = false;
  try {
    await conn.beginTransaction();

    const laci = await cariLaciPemilik(conn, user.kode);
    if (!laci)
      throw new Error(
        `User ${user.kode} belum punya laci kas. Hubungi Finance.`,
      );

    const [[lk]] = await conn.query(`SELECT GET_LOCK(?, 10) AS ok`, [
      LOCK_NOMOR_PC,
    ]);
    if (!Number(lk.ok))
      throw new Error("Penomoran sedang dipakai, coba lagi sebentar.");
    locked = true;

    const nomor = await generateNomorPettyCash(tanggal, conn);
    await conn.query(
      `INSERT INTO tpengajuan_uang_muka_hdr
         (pum_nomor, pum_tanggal, pum_keterangan, pum_cabang, pum_user_create,
          pum_date_create, pum_status, pum_jenis, pum_total_nominal, pum_laci_tujuan)
       VALUES (?, ?, ?, ?, ?, NOW(), 'DIAJUKAN', 'PC', ?, ?)`,
      [
        nomor,
        tanggal,
        String(keterangan || "").slice(0, 255),
        user.cabang,
        user.kode,
        total,
        laci,
      ],
    );

    await conn.commit();
    return { nomor, totalNominal: total, laciTujuan: laci };
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    if (locked) {
      try {
        await conn.query(`SELECT RELEASE_LOCK(?)`, [LOCK_NOMOR_PC]);
      } catch (_) {
        /* lock otomatis lepas saat koneksi ditutup */
      }
    }
    conn.release();
  }
};

// semua = true: lihat pengajuan semua user; selain itu hanya milik userKode.
const getBrowsePettyCash = async ({
  startDate,
  endDate,
  cabang,
  status,
  userKode,
  semua,
}) => {
  const params = [];
  let where = `WHERE h.pum_jenis = 'PC'`;
  if (startDate && endDate) {
    where += ` AND (h.pum_tanggal BETWEEN ? AND ? OR h.pum_status = 'DIAJUKAN')`;
    params.push(startDate, endDate);
  }
  if (cabang) {
    where += ` AND h.pum_cabang = ?`;
    params.push(cabang);
  }
  if (!semua) {
    where += ` AND h.pum_user_create = ?`;
    params.push(userKode);
  }
  if (status === "OUTSTANDING") where += ` AND h.pum_status = 'DIAJUKAN'`;
  else if (status === "HISTORY")
    where += ` AND h.pum_status IN ('REALISASI','DITOLAK','BATAL')`;

  const [rows] = await db.query(
    `SELECT
       h.pum_nomor AS Nomor,
       DATE_FORMAT(h.pum_tanggal, '%Y-%m-%d') AS Tanggal,
       h.pum_keterangan AS Keterangan,
       h.pum_cabang AS Cabang,
       h.pum_status AS Status,
       h.pum_total_nominal AS Nominal,
       h.pum_user_create AS UserCreate,
       h.pum_user_realisasi AS UserRealisasi,
       DATE_FORMAT(h.pum_date_realisasi, '%Y-%m-%d %H:%i') AS TglRealisasi,
       h.pum_laci_tujuan AS LaciKode,
       r.rek_nama AS LaciNama,
       h.pum_laci_asal AS LaciAsal,
       h.pum_alasan_tolak AS AlasanTolak,
       h.pum_transfer_jur_no AS TransferJurNo,
       h.pum_konfirmasi_tgl AS KonfirmasiTgl,
       (SELECT v.val_aksi FROM tpengajuan_uang_muka_validasi v
         WHERE v.val_pum_nomor = h.pum_nomor AND v.val_jenis = 'PENGAJUAN'
         ORDER BY v.val_id DESC LIMIT 1) AS ValAksi
     FROM tpengajuan_uang_muka_hdr h
     LEFT JOIN finance.trekening r ON r.rek_kode = h.pum_laci_tujuan
     ${where}
     ORDER BY h.pum_tanggal DESC, h.pum_nomor DESC`,
    params,
  );

  return rows.map((row) => ({
    ...row,
    // "" = belum direalisasi atau realisasi mandiri (tidak perlu konfirmasi terima)
    KonfirmasiStatus:
      !row.TransferJurNo ||
      String(row.UserRealisasi || "").toUpperCase() ===
        String(row.UserCreate || "").toUpperCase()
        ? ""
        : row.KonfirmasiTgl
          ? "SUDAH"
          : "BELUM",
  }));
};

// ── Penyerahan Dana Belanja (PD): dana sudah ada di laci pembuat ──
const LOCK_NOMOR_PD = "manksi_penomoran_pd";
const SUMBER_PD = [
  "PERMINTAAN_PEMBELIAN",
  "PO_LAIN_LAIN",
  "INSENTIF",
  "PENGAJUAN_DANA",
];
const fmtRp = (n) => Number(n || 0).toLocaleString("id-ID");

// PD yang sudah diserahkan tetapi belum diselesaikan: uang sudah keluar secara
// fisik, sedangkan saldo buku baru turun saat Penyelesaian.
const hitungPdBelumSelesai = async (conn, laci) => {
  const [[r]] = await conn.query(
    `SELECT IFNULL(SUM(k.bon_nominal), 0) AS total
     FROM tpengajuan_uang_muka_hdr h
     JOIN finance.tkasbon k ON k.bon_nomor = h.pum_bon_nomor
     WHERE h.pum_jenis = 'PD' AND h.pum_status = 'REALISASI'
       AND h.pum_laci_tujuan = ? AND k.bon_selesai = 0`,
    [laci],
  );
  return Number(r.total) || 0;
};

// Detail untuk saveRealisasi mode penyerahan: semua baris ACC, nominal
// dana hanya pada baris KASBON (sama seperti form Realisasi Uang Muka).
const bangunDetailPenyerahan = async (conn, pumNomor, total) => {
  const [dtl] = await conn.query(
    `SELECT pumd_id, pumd_sumber, pumd_nomor_sumber, pumd_item_nourut,
            pumd_nama, pumd_satuan, pumd_qty, pumd_pmt_nomor
     FROM tpengajuan_uang_muka_dtl WHERE pumd_pum_nomor = ? ORDER BY pumd_id`,
    [pumNomor],
  );
  const itemRows = dtl.map((d) => ({
    pumd_id: d.pumd_id,
    sumber: d.pumd_sumber,
    nomor_header: d.pumd_nomor_sumber,
    item_nourut: d.pumd_item_nourut,
    pmt_nomor: d.pumd_pmt_nomor,
    nama: d.pumd_nama,
    satuan: d.pumd_satuan,
    qty: Number(d.pumd_qty),
    status_acc: "ACC",
    nominal_acc: 0,
  }));
  const kasbonRow = {
    pumd_id: null,
    sumber: "KASBON",
    nomor_header: pumNomor,
    item_nourut: null,
    pmt_nomor: null,
    nama: "KASBON",
    satuan: "",
    qty: 1,
    status_acc: "ACC",
    nominal_acc: total,
  };
  return [kasbonRow, ...itemRows];
};

// items: sama seperti dialog Ajukan Uang Muka
// [{ sumber, nomorHeader, itemNourut, nama, satuan, qty, keterangan }]
const createPenyerahan = async (
  { tanggal, keterangan, nominal, items },
  user,
) => {
  const cabang = String(user?.cabang || "")
    .trim()
    .toUpperCase();
  if (!CABANG_PETTY.includes(cabang))
    throw new Error("Penyerahan Dana Belanja hanya untuk cabang HO-/P01.");
  if (!tanggal) throw new Error("Tanggal wajib diisi.");
  if (!items || !items.length) throw new Error("Minimal pilih 1 transaksi.");
  const tidakBoleh = items.find((it) => !SUMBER_PD.includes(it.sumber));
  if (tidakBoleh)
    throw new Error(
      `Sumber ${tidakBoleh.sumber} tidak dapat diserahkan lewat Penyerahan Dana Belanja.`,
    );
  const total = Math.round((Number(nominal) || 0) * 100) / 100;
  if (total <= 0) throw new Error("Nominal penyerahan wajib diisi.");

  const conn = await db.getConnection();
  let locked = false;
  try {
    // Kunci global PD diambil SEBELUM transaksi dimulai, supaya snapshot InnoDB
    // baru dibuat sesudah kunci didapat dan cek dana/item melihat PD yang baru commit.
    const [[lk]] = await conn.query(`SELECT GET_LOCK(?, 10) AS ok`, [
      LOCK_NOMOR_PD,
    ]);
    if (!Number(lk.ok))
      throw new Error("Penyerahan lain sedang diproses, coba lagi sebentar.");
    locked = true;

    await conn.beginTransaction();

    const laci = await cariLaciPemilik(conn, user.kode);
    if (!laci)
      throw new Error(
        `User ${user.kode} belum punya laci kas. Hubungi Finance.`,
      );

    const saldo = await hitungSaldoAkun(laci, conn);
    const belumSelesai = await hitungPdBelumSelesai(conn, laci);
    const tersedia = saldo - belumSelesai;
    if (total > tersedia + 0.005)
      throw new Error(
        `Nominal ${fmtRp(total)} melebihi dana tersedia di laci ${laci}: saldo ${fmtRp(saldo)} − penyerahan belum selesai ${fmtRp(belumSelesai)} = ${fmtRp(tersedia)}.`,
      );

    for (const it of items) {
      if (
        await sumberSudahDipakai(conn, it.sumber, it.nomorHeader, it.itemNourut)
      )
        throw new Error(
          `Item "${it.nama}" dari ${it.nomorHeader} sudah diserahkan atau sedang diajukan.`,
        );
    }

    const { nomor } = await createPengajuan(
      {
        tanggal,
        keterangan,
        nominalDiajukan: total,
        items,
        jenis: "PD",
        laciTujuan: laci,
      },
      user,
      conn,
    );

    const detail = await bangunDetailPenyerahan(conn, nomor, total);
    const hasil = await saveRealisasi(
      nomor,
      {
        jenis: "KAS",
        rek_kode: laci,
        tanggal,
        nota: "",
        penerima: user.kode,
        keterangan: String(keterangan || ""),
        detail,
      },
      user,
      { penyerahan: true, conn },
    );

    await conn.commit();
    return {
      nomor,
      bonNomor: hasil.bonNomor,
      totalNominal: total,
      laciKode: laci,
    };
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    if (locked) {
      try {
        await conn.query(`SELECT RELEASE_LOCK(?)`, [LOCK_NOMOR_PD]);
      } catch (_) {
        /* lock otomatis lepas saat koneksi ditutup */
      }
    }
    conn.release();
  }
};

// Batalkan PD yang belum diselesaikan. Hanya pemilik laci. Baris PUM tetap ada
// (status BATAL) sebagai jejak audit; bon dan penanda "sudah diserahkan" dibalik.
// Tabel finance/ga2 berengine MyISAM: rollback tidak menjangkaunya, jadi urutan tulis
// dan sifat idempotent di bawah yang menjaga konsistensi. Bon dihapus PALING AKHIR:
// selama bon masih ada, PD tetap tampil di tab Penyerahan dan Batal bisa diulang.
const batalPenyerahan = async (pumNomor, alasan, user) => {
  const alasanBersih = String(alasan || "").trim();
  if (alasanBersih.length < 3)
    throw new Error("Alasan pembatalan wajib diisi (min. 3 karakter).");

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // Kunci baris PUM; saveData Penyelesaian mengambil kunci yang sama.
    const [[hdr]] = await conn.query(
      `SELECT pum_jenis, pum_status, pum_bon_nomor, pum_laci_tujuan
       FROM tpengajuan_uang_muka_hdr WHERE pum_nomor = ? FOR UPDATE`,
      [pumNomor],
    );
    if (!hdr) throw new Error("Penyerahan Dana Belanja tidak ditemukan.");
    if (hdr.pum_jenis !== "PD")
      throw new Error("Dokumen ini bukan Penyerahan Dana Belanja.");
    if (hdr.pum_status === "BATAL")
      throw new Error("Penyerahan ini sudah dibatalkan.");
    if (hdr.pum_status !== "REALISASI" || !hdr.pum_bon_nomor)
      throw new Error(
        `Penyerahan ini berstatus ${hdr.pum_status}, tidak dapat dibatalkan.`,
      );

    const [[laci]] = await conn.query(
      `SELECT rek_pemilik FROM finance.trekening WHERE rek_kode = ?`,
      [hdr.pum_laci_tujuan],
    );
    if (
      String(laci?.rek_pemilik || "").toUpperCase() !==
      String(user.kode || "").toUpperCase()
    )
      throw new Error(
        `Pembatalan hanya dapat dilakukan oleh pemilik laci ${hdr.pum_laci_tujuan}.`,
      );

    const bonNomor = hdr.pum_bon_nomor;
    const [[bon]] = await conn.query(
      `SELECT bon_selesai, bon_jur_no, bon_transfer_jur_no, bon_sisa_jur_no
       FROM finance.tkasbon WHERE bon_nomor = ?`,
      [bonNomor],
    );
    if (
      bon &&
      (Number(bon.bon_selesai) !== 0 ||
        bon.bon_jur_no ||
        bon.bon_transfer_jur_no ||
        bon.bon_sisa_jur_no)
    )
      throw new Error(
        "Penyerahan ini sudah diselesaikan. Koreksi dilakukan Finance, tidak lewat pembatalan.",
      );

    const [dtl] = await conn.query(
      `SELECT pumd_sumber, pumd_nomor_sumber, pumd_item_nourut, pumd_pmt_nomor
       FROM tpengajuan_uang_muka_dtl WHERE pumd_pum_nomor = ?`,
      [pumNomor],
    );

    const pmtTerkena = new Set();
    for (const d of dtl) {
      if (d.pumd_sumber === "PENGAJUAN_DANA" && d.pumd_pmt_nomor) {
        // Nilai "belum approved" sama dengan cabang reject di saveRealisasi.
        await conn.query(
          `UPDATE ga2.tpermintaan_dtl SET
             pmd_tanggal_approved = NULL, pmd_user_approved = '', pmd_dana_approved = 0,
             pmd_bon = '', pmd_status_finance = NULL
           WHERE pmd_pmt_nomor = ? AND pmd_nourut = ? AND pmd_bon = ?`,
          [d.pumd_pmt_nomor, d.pumd_item_nourut, bonNomor],
        );
        pmtTerkena.add(d.pumd_pmt_nomor);
      } else if (d.pumd_sumber === "INSENTIF") {
        await conn.query(
          `UPDATE tpengajuan_fee SET fee_tgl_realisasi = NULL WHERE fee_nomor = ?`,
          [d.pumd_nomor_sumber],
        );
      }
    }

    // Permintaan (MNT) dipakai bersama PD lain atas pengajuan yang sama: tidak
    // dihapus. Item kita kembali belum approved, jadi permintaan pasti belum tutup;
    // approval dihitung ulang dari item lain yang masih approved.
    for (const pmt of pmtTerkena) {
      await conn.query(
        `UPDATE ga2.tpermintaan_hdr SET pmt_close = 0, pmt_tglclose = NULL
         WHERE pmt_nomor = ?`,
        [pmt],
      );
      await conn.query(
        `UPDATE ga2.tpermintaan_hdr h SET h.pmt_approval = 0
         WHERE h.pmt_nomor = ?
           AND NOT EXISTS (
             SELECT 1 FROM ga2.tpermintaan_dtl d
             WHERE d.pmd_pmt_nomor = h.pmt_nomor AND d.pmd_tanggal_approved IS NOT NULL)`,
        [pmt],
      );
    }

    // Hapus bon terakhir; trigger tkasbon_before_delete menghapus tkasbonitem/2.
    if (bon) {
      await conn.query(
        `DELETE FROM finance.tkasbon WHERE bon_nomor = ? AND bon_selesai = 0`,
        [bonNomor],
      );
    }

    await conn.query(
      `UPDATE tpengajuan_uang_muka_hdr SET
         pum_status = 'BATAL', pum_alasan_batal = ?, pum_user_batal = ?,
         pum_date_batal = NOW(), pum_bon_batal = ?, pum_bon_nomor = NULL
       WHERE pum_nomor = ?`,
      [alasanBersih.slice(0, 255), user.kode, bonNomor, pumNomor],
    );

    await conn.commit();
    return { nomor: pumNomor, bonNomor };
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
};

// Info laci milik user yang login (untuk header form: saldo, batas, dana tersedia)
const getInfoLaci = async (user) => {
  const kode = await cariLaciPemilik(db, user.kode);
  if (!kode)
    return {
      kode: "",
      nama: "",
      saldo: 0,
      batas: BATAS_SALDO_LACI_MANDIRI,
      belumSelesai: 0,
      tersedia: 0,
    };
  const [[r]] = await db.query(
    `SELECT rek_nama FROM finance.trekening WHERE rek_kode = ?`,
    [kode],
  );
  const saldo = await hitungSaldoAkun(kode);
  const belumSelesai = await hitungPdBelumSelesai(db, kode);
  return {
    kode,
    nama: r?.rek_nama || "",
    saldo,
    batas: BATAS_SALDO_LACI_MANDIRI,
    belumSelesai,
    tersedia: saldo - belumSelesai,
  };
};

module.exports = {
  BKK_P04_MULAI,
  SQL_NOMINAL_BARIS_PO,
  SQL_SUMBER_FEE,
  SQL_NOMINAL_INSENTIF,
  createPengajuan,
  getBrowse,
  getDetail,
  ensurePermintaanDana,
  getPrintData,
  getPrintPenyerahan,
  createPettyCash,
  createPenyerahan,
  batalPenyerahan,
  getBrowsePettyCash,
  getInfoLaci,
};
