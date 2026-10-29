const db = require("../../config/database");
const {
  getTanggalTutupBukuUntukTanggal,
} = require("../../services/tutupBukuService");

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

  // Sumber tingkat-dokumen: satu dokumen = satu baris PUM
  const vistos = new Set();
  const itemsFinal = items.filter((it) => {
    if (!SUMBER_HEADER.includes(it.sumber)) return true;
    const key = `${it.sumber}|${it.nomorSumber || it.nomorHeader}`;
    if (vistos.has(key)) return false;
    vistos.add(key);
    return true;
  });

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const nomor = await generateNomor(tanggal, conn);
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
};
