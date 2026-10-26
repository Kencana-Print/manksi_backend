const db = require("../../config/database");
const {
  BKK_P04_MULAI,
  SQL_NOMINAL_BARIS_PO,
  SQL_SUMBER_FEE,
  SQL_NOMINAL_INSENTIF,
} = require("./pengajuanUangMukaService");

// Qty permintaan yang sudah dipenuhi lewat PO (aturan sama dengan getQtySudah di poNonBahanService):
// PO belum CLOSE = qty PO, PO CLOSE = qty BPB yang benar-benar datang
const SQL_QTY_PO_MB = (d) => `
  (IFNULL((
    SELECT SUM(po_d.pod_jumlah)
    FROM tgarmenpo_hdr po_h
    JOIN tgarmenpo_dtl po_d ON po_d.pod_nomor = po_h.po_nomor
    WHERE po_h.po_mb_nomor = ${d}.mbd_nomor AND po_d.pod_brg_kode = ${d}.mbd_brg_kode
      AND po_h.po_status NOT LIKE '%CLOSE%'
  ), 0) + IFNULL((
    SELECT SUM(bp_i.bpbd_jumlah)
    FROM tgarmenpo_hdr po_h
    JOIN tgarmenbpb_hdr bp_h ON bp_h.bpb_po_nomor = po_h.po_nomor
    JOIN tgarmenbpb_dtl bp_i ON bp_i.bpbd_nomor = bp_h.bpb_nomor
    WHERE po_h.po_mb_nomor = ${d}.mbd_nomor AND bp_i.bpbd_brg_kode = ${d}.mbd_brg_kode
      AND po_h.po_status LIKE '%CLOSE%'
  ), 0))`;

// PUM masih memegang sumber ini (sedang diajukan, atau direalisasi & di-ACC)
const sqlPumAktif = (sumber, kolomNomor, kolomItem = null) => `
  SELECT 1 FROM tpengajuan_uang_muka_dtl pd
  JOIN tpengajuan_uang_muka_hdr ph ON ph.pum_nomor = pd.pumd_pum_nomor
  WHERE pd.pumd_sumber = '${sumber}' AND pd.pumd_nomor_sumber = ${kolomNomor}
    ${kolomItem ? `AND pd.pumd_item_nourut = ${kolomItem}` : ""}
    AND (ph.pum_status = 'DIAJUKAN'
         OR (ph.pum_status = 'REALISASI' AND pd.pumd_status_acc = 'ACC'))`;

// ── OUTSTANDING (browse) ──
const getOutstanding = async ({
  search = "",
  startDate,
  endDate,
  page = 1,
  limit = 25,
  cabang,
  semuaCabang = false,
}) => {
  const searchParam = `%${search}%`;

  // P01 dan HO- setara Head Office: lihat yang ditujukan ke HO- maupun P01,
  // plus sumber khusus HO (insentif, PO Lain-lain, BKK kas kecil P04).
  // semuaCabang: lihat seluruh cabang + semua sumber (termasuk sumber khusus HO)
  const isHO = semuaCabang || cabang === "HO-" || cabang === "P01";
  const buildCabangClause = (kolom) => {
    if (semuaCabang || !cabang) return "";
    if (isHO) return ` AND (${kolom} = 'HO-' OR ${kolom} = 'P01')`;
    return ` AND ${kolom} = ?`;
  };
  const cabangClauseGA = buildCabangClause("a.pjh_ke");
  const cabangClauseMB = buildCabangClause("h.mb_mintake");
  const cabangParams = cabang && !isHO ? [cabang] : [];
  const tglSql = (kolom) =>
    startDate && endDate
      ? `AND ${kolom} >= ? AND ${kolom} < DATE_ADD(?, INTERVAL 1 DAY)`
      : "";
  const sqlPengajuanDana = `
    (
      SELECT
        'PENGAJUAN_DANA' AS Sumber,
        a.pjh_nomor AS Nomor,
        a.pjh_tanggal AS Tanggal,
        a.pjh_keterangan AS Keterangan,
        c.nama AS Pemohon,
        c.bagian AS Bagian,
        c.lokasi AS Cabang,
        IFNULL((
          SELECT SUM(
            (d.pjd_qty - IFNULL((
              SELECT SUM(td.pmd_qty_buyed)
              FROM ga2.tpermintaan_dtl td
              JOIN ga2.tpermintaan_hdr th ON th.pmt_nomor = td.pmd_pmt_nomor
              WHERE th.pmt_pjh_nomor = a.pjh_nomor AND td.pmd_nourut = d.pjd_nourut
                AND td.pmd_verified_buyed <> 0
            ), 0)) * d.pjd_nilai
          )
          FROM ga2.tpengajuan2_dtl d
          WHERE d.pjd_pjh_nomor = a.pjh_nomor AND d.pjd_nama <> ''
            AND d.pjd_closed_manual = 0
            AND (d.pjd_qty - IFNULL((
              SELECT SUM(td.pmd_qty_buyed)
              FROM ga2.tpermintaan_dtl td
              JOIN ga2.tpermintaan_hdr th ON th.pmt_nomor = td.pmd_pmt_nomor
              WHERE th.pmt_pjh_nomor = a.pjh_nomor AND td.pmd_nourut = d.pjd_nourut
                AND td.pmd_verified_buyed <> 0
            ), 0)) > 0
            AND NOT EXISTS (
              SELECT 1 FROM tpengajuan_uang_muka_dtl pd
              JOIN tpengajuan_uang_muka_hdr ph ON ph.pum_nomor = pd.pumd_pum_nomor
              WHERE pd.pumd_sumber = 'PENGAJUAN_DANA' AND pd.pumd_nomor_sumber = a.pjh_nomor
                AND pd.pumd_item_nourut = d.pjd_nourut AND ph.pum_status NOT IN ('DITOLAK','BATAL','REALISASI')
            )
        ), 0) AS Nominal
      FROM ga2.tpengajuan2_hdr a
      LEFT JOIN ga2.peminta c ON c.nik = a.pjh_nik
      WHERE EXISTS (
        SELECT 1 FROM ga2.tpengajuan2_dtl d
        WHERE d.pjd_pjh_nomor = a.pjh_nomor AND d.pjd_nama <> ''
          AND d.pjd_closed_manual = 0
          AND (d.pjd_qty - IFNULL((
            SELECT SUM(td.pmd_qty_buyed)
            FROM ga2.tpermintaan_dtl td
            JOIN ga2.tpermintaan_hdr th ON th.pmt_nomor = td.pmd_pmt_nomor
            WHERE th.pmt_pjh_nomor = a.pjh_nomor AND td.pmd_nourut = d.pjd_nourut
              AND td.pmd_verified_buyed <> 0
          ), 0)) > 0
          AND NOT EXISTS (
            SELECT 1 FROM tpengajuan_uang_muka_dtl pd
            JOIN tpengajuan_uang_muka_hdr ph ON ph.pum_nomor = pd.pumd_pum_nomor
            WHERE pd.pumd_sumber = 'PENGAJUAN_DANA' AND pd.pumd_nomor_sumber = a.pjh_nomor
              AND pd.pumd_item_nourut = d.pjd_nourut AND ph.pum_status NOT IN ('DITOLAK','BATAL','REALISASI')
          )
      )
      ${startDate && endDate ? "AND a.pjh_tanggal BETWEEN ? AND ?" : ""}
      AND (a.pjh_nomor LIKE ? OR a.pjh_keterangan LIKE ?)
      ${cabangClauseGA}
    )
  `;

  const sqlPermintaanPembelian = `
    (
      SELECT
        'PERMINTAAN_PEMBELIAN' AS Sumber,
        h.mb_nomor AS Nomor,
        h.mb_tanggal AS Tanggal,
        h.mb_ket AS Keterangan,
        h.user_create AS Pemohon,
        h.mb_bagian AS Bagian,
        h.mb_cab AS Cabang,
        IFNULL((
          SELECT SUM(
            (d.mbd_jumlah - IFNULL((
              SELECT SUM(ki.bond_qty_realisasi)
              FROM finance.tkasbonitem ki
              WHERE ki.bond_ref_tipe = 'PERMINTAAN_PEMBELIAN'
                AND ki.bond_ref_nomor = h.mb_nomor AND ki.bond_ref_nourut = d.mbd_nourut
                AND ki.bond_verified <> 0
            ), 0) - ${SQL_QTY_PO_MB("d")}) * d.mbd_harga
          )
          FROM tgarmenmintabeli_dtl d
          WHERE d.mbd_nomor = h.mb_nomor
            AND d.mbd_closed_manual = 0
            AND (d.mbd_jumlah - IFNULL((
              SELECT SUM(ki.bond_qty_realisasi)
              FROM finance.tkasbonitem ki
              WHERE ki.bond_ref_tipe = 'PERMINTAAN_PEMBELIAN'
                AND ki.bond_ref_nomor = h.mb_nomor AND ki.bond_ref_nourut = d.mbd_nourut
                AND ki.bond_verified <> 0
            ), 0) - IFNULL((
              SELECT SUM(ki2.bond2_qty_realisasi)
              FROM finance.tkasbonitem2 ki2
              WHERE ki2.bond2_link = h.mb_nomor AND ki2.bond2_brg_kode = d.mbd_brg_kode
                AND ki2.bond2_verified <> 0
            ), 0) - ${SQL_QTY_PO_MB("d")}) > IFNULL((
              SELECT SUM(d2.mbd2_jumlah) FROM tgarmenmintabeli_dtl2 d2
              WHERE d2.mbd2_nomor = d.mbd_nomor AND d2.mbd2_brg_kode = d.mbd_brg_kode
            ), 0)
            AND NOT EXISTS (
              SELECT 1 FROM tpengajuan_uang_muka_dtl pd
              JOIN tpengajuan_uang_muka_hdr ph ON ph.pum_nomor = pd.pumd_pum_nomor
              WHERE pd.pumd_sumber = 'PERMINTAAN_PEMBELIAN' AND pd.pumd_nomor_sumber = h.mb_nomor
                AND pd.pumd_item_nourut = d.mbd_nourut AND ph.pum_status NOT IN ('DITOLAK','BATAL','REALISASI')
            )
        ), 0) AS Nominal
      FROM tgarmenmintabeli_hdr h
      WHERE EXISTS (
        SELECT 1 FROM tgarmenmintabeli_dtl d
        WHERE d.mbd_nomor = h.mb_nomor
          AND d.mbd_closed_manual = 0
          AND (d.mbd_jumlah - IFNULL((
            SELECT SUM(ki.bond_qty_realisasi)
            FROM finance.tkasbonitem ki
            WHERE ki.bond_ref_tipe = 'PERMINTAAN_PEMBELIAN'
              AND ki.bond_ref_nomor = h.mb_nomor AND ki.bond_ref_nourut = d.mbd_nourut
              AND ki.bond_verified <> 0
          ), 0) - IFNULL((
            SELECT SUM(ki2.bond2_qty_realisasi)
            FROM finance.tkasbonitem2 ki2
            WHERE ki2.bond2_link = h.mb_nomor AND ki2.bond2_brg_kode = d.mbd_brg_kode
              AND ki2.bond2_verified <> 0
          ), 0) - ${SQL_QTY_PO_MB("d")}) > IFNULL((
            SELECT SUM(d2.mbd2_jumlah) FROM tgarmenmintabeli_dtl2 d2
            WHERE d2.mbd2_nomor = d.mbd_nomor AND d2.mbd2_brg_kode = d.mbd_brg_kode
          ), 0)
          AND NOT EXISTS (
            SELECT 1 FROM tpengajuan_uang_muka_dtl pd
            JOIN tpengajuan_uang_muka_hdr ph ON ph.pum_nomor = pd.pumd_pum_nomor
            WHERE pd.pumd_sumber = 'PERMINTAAN_PEMBELIAN' AND pd.pumd_nomor_sumber = h.mb_nomor
              AND pd.pumd_item_nourut = d.mbd_nourut AND ph.pum_status NOT IN ('DITOLAK','BATAL','REALISASI')
          )
      )
      ${startDate && endDate ? "AND h.mb_tanggal BETWEEN ? AND ?" : ""}
      AND (h.mb_nomor LIKE ? OR h.mb_ket LIKE ?)
      ${cabangClauseMB}
    )
  `;

  const sqlInsentif = `
    (
      SELECT
        'INSENTIF' AS Sumber,
        h.fee_nomor AS Nomor,
        h.fee_tanggal AS Tanggal,
        CONCAT('Insentif ', IFNULL(c.Cus_nama, '')) AS Keterangan,
        h.user_create AS Pemohon,
        '' AS Bagian,
        'HO-' AS Cabang,
        ${SQL_NOMINAL_INSENTIF} AS Nominal
      FROM tpengajuan_fee h
      LEFT JOIN tcustomer c ON c.Cus_kode = h.fee_cus_kode
      WHERE h.fee_tgl_realisasi IS NULL
        AND NOT EXISTS (${sqlPumAktif("INSENTIF", "h.fee_nomor")})
        ${tglSql("h.fee_tanggal")}
        AND (h.fee_nomor LIKE ? OR c.Cus_nama LIKE ?)
    )
  `;

  const sqlPoLain = `
    (
      SELECT
        'PO_LAIN_LAIN' AS Sumber,
        h.po_nomor AS Nomor,
        h.po_tanggal AS Tanggal,
        IFNULL(h.po_keterangan, '') AS Keterangan,
        IFNULL(h.user_create, '') AS Pemohon,
        '' AS Bagian,
        'HO-' AS Cabang,
        ROUND(SUM(${SQL_NOMINAL_BARIS_PO}), 2) AS Nominal
      FROM tpo_hdr h
      JOIN tpo_dtl d ON d.pod_po_Nomor = h.po_nomor
      WHERE h.po_jenis = 4
        AND d.pod_bhn_kode <> ''
        AND IFNULL(d.pod_sup_kode, '') <> ''
        AND NOT EXISTS (${sqlPumAktif("PO_LAIN_LAIN", "h.po_nomor", "d.pod_nourut")})
        AND NOT EXISTS (
          SELECT 1 FROM finance.tpengajuan_transfer_dtl t
          WHERE t.ptd_trs = h.po_nomor
            AND t.ptd_sup_kode = d.pod_sup_kode
            AND t.ptd_batal = ''
        )
        AND NOT EXISTS (
          SELECT 1 FROM tvoucher_dtl v
          INNER JOIN tvoucher_hdr vh ON vh.vou_nomor = v.voud_vou_nomor
          WHERE v.voud_nota = h.po_nomor AND v.voud_type = 'POL'
            AND vh.vou_sup_kode = d.pod_sup_kode
        )
        ${tglSql("h.po_tanggal")}
        AND (h.po_nomor LIKE ? OR h.po_keterangan LIKE ?)
      GROUP BY h.po_nomor, h.po_tanggal, h.po_keterangan, h.user_create
    )
  `;

  const sqlBkkP04 = `
    (
      SELECT
        'BKK_P04' AS Sumber,
        h.jur_no AS Nomor,
        h.jur_tanggal AS Tanggal,
        h.jur_keterangan AS Keterangan,
        h.jur_penerima AS Pemohon,
        '' AS Bagian,
        h.jur_cabang AS Cabang,
        IFNULL((
          SELECT SUM(i.jurd_debet) FROM finance.tjurnalitem i
          WHERE i.jurd_jur_no = h.jur_no AND i.jurd_trs = 'BKK'
        ), 0) AS Nominal
      FROM finance.tjurnal h
      WHERE h.jur_tipetransaksi = 'BKK'
        AND h.jur_cabang = 'P04'
        AND h.jur_otomatis = 0
        AND LEFT(h.jur_rek_kode, 5) = 'A-111'
        AND h.jur_tanggal >= '${BKK_P04_MULAI}'
        AND NOT EXISTS (
          SELECT 1 FROM finance.tkasbon k WHERE k.bon_jur_no = h.jur_no
        )
        AND NOT EXISTS (${sqlPumAktif("BKK_P04", "h.jur_no")})
        ${tglSql("h.jur_tanggal")}
        AND (h.jur_no LIKE ? OR h.jur_keterangan LIKE ?)
    )
  `;

  const dateParams = startDate && endDate ? [startDate, endDate] : [];
  const paramsGaMb = [...dateParams, searchParam, searchParam, ...cabangParams];
  const paramsHeader = [...dateParams, searchParam, searchParam];

  const sumber = [
    { sql: sqlPengajuanDana, params: paramsGaMb },
    { sql: sqlPermintaanPembelian, params: paramsGaMb },
  ];
  if (isHO) {
    sumber.push(
      { sql: sqlInsentif, params: paramsHeader },
      { sql: sqlPoLain, params: paramsHeader },
      { sql: sqlBkkP04, params: paramsHeader },
    );
  }
  const unionSql = sumber.map((s) => s.sql).join(" UNION ALL ");
  const baseParams = sumber.flatMap((s) => s.params);

  const [[{ total }]] = await db.query(
    `SELECT COUNT(*) AS total FROM (${unionSql}) x`,
    baseParams,
  );
  const offset = (Number(page) - 1) * Number(limit);
  const [rows] = await db.query(
    `SELECT * FROM (${unionSql}) x ORDER BY x.Tanggal DESC, x.Nomor DESC LIMIT ? OFFSET ?`,
    [...baseParams, Number(limit), offset],
  );
  return { items: rows, total: Number(total) };
};

// ── OUTSTANDING DETAIL (per sumber) ──
const getOutstandingDetail = async (sumber, nomorHeader) => {
  if (sumber === "PENGAJUAN_DANA") {
    const [rows] = await db.query(
      `SELECT
         a.pjd_nourut AS ItemNourut,
         a.pjd_nama AS Nama,
         a.pjd_spesifikasi AS Spesifikasi,
         a.pjd_satuan AS Satuan,
         a.pjd_qty AS QtyPengajuan,
         a.QtyRealisasi AS QtyRealisasi,
         (a.pjd_qty * a.pjd_nilai) AS RpPengajuan,
         a.RpApproved AS RpApproved,
         a.Deadline AS Deadline,
         a.NameApproved AS NameApproved,
         a.Keterangan AS Keterangan
       FROM ga2.viewpengajuan a
       JOIN ga2.tpengajuan2_dtl pd2 ON pd2.pjd_pjh_nomor = a.pjh_nomor AND pd2.pjd_nourut = a.pjd_nourut
       WHERE a.pjh_nomor = ?
         AND pd2.pjd_closed_manual = 0
         AND (a.pjd_qty - IFNULL((
           SELECT SUM(td.pmd_qty_buyed)
           FROM ga2.tpermintaan_dtl td
           JOIN ga2.tpermintaan_hdr th ON th.pmt_nomor = td.pmd_pmt_nomor
           WHERE th.pmt_pjh_nomor = a.pjh_nomor AND td.pmd_nourut = a.pjd_nourut
             AND td.pmd_verified_buyed <> 0
         ), 0)) > 0
         AND NOT EXISTS (
           SELECT 1 FROM tpengajuan_uang_muka_dtl pd
           JOIN tpengajuan_uang_muka_hdr ph ON ph.pum_nomor = pd.pumd_pum_nomor
           WHERE pd.pumd_sumber = 'PENGAJUAN_DANA' AND pd.pumd_nomor_sumber = ?
           AND pd.pumd_item_nourut = a.pjd_nourut AND ph.pum_status NOT IN ('DITOLAK','BATAL','REALISASI')
         )
       ORDER BY a.pjd_nourut`,
      [nomorHeader, nomorHeader],
    );
    return rows;
  }

  if (sumber === "PERMINTAAN_PEMBELIAN") {
    const [rows] = await db.query(
      `SELECT d.mbd_nourut AS ItemNourut,
              d.mbd_brg_kode AS Kode,
              IF(b.brg_note="", b.brg_nama, CONCAT(b.brg_nama, " - ", b.brg_note)) AS Nama,
              b.brg_satuan AS Satuan, d.mbd_jumlah AS Qty, (d.mbd_jumlah * d.mbd_harga) AS Nominal,
              (IFNULL((
                SELECT SUM(ki.bond_qty_realisasi)
                FROM finance.tkasbonitem ki
                WHERE ki.bond_ref_tipe = 'PERMINTAAN_PEMBELIAN'
                  AND ki.bond_ref_nomor = d.mbd_nomor AND ki.bond_ref_nourut = d.mbd_nourut
                  AND ki.bond_verified <> 0
              ), 0) + IFNULL((
                SELECT SUM(ki2.bond2_qty_realisasi)
                FROM finance.tkasbonitem2 ki2
                WHERE ki2.bond2_link = d.mbd_nomor AND ki2.bond2_brg_kode = d.mbd_brg_kode
                  AND ki2.bond2_verified <> 0
              ), 0) + ${SQL_QTY_PO_MB("d")}) AS QtyRealisasi,
              (IFNULL((
                SELECT SUM(ki.bond_qty_realisasi * ki.bond_nominal_realisasi)
                FROM finance.tkasbonitem ki
                WHERE ki.bond_ref_tipe = 'PERMINTAAN_PEMBELIAN'
                  AND ki.bond_ref_nomor = d.mbd_nomor AND ki.bond_ref_nourut = d.mbd_nourut
                  AND ki.bond_verified <> 0
              ), 0) + IFNULL((
                SELECT SUM(ki2.bond2_nominal_realisasi)
                FROM finance.tkasbonitem2 ki2
                WHERE ki2.bond2_link = d.mbd_nomor AND ki2.bond2_brg_kode = d.mbd_brg_kode
                  AND ki2.bond2_verified <> 0
              ), 0)) AS NominalRealisasi
       FROM tgarmenmintabeli_dtl d
       LEFT JOIN tgarmen_brg b ON b.brg_kode = d.mbd_brg_kode
       WHERE d.mbd_nomor = ?
         AND d.mbd_closed_manual = 0
         AND (d.mbd_jumlah - IFNULL((
           SELECT SUM(ki.bond_qty_realisasi)
           FROM finance.tkasbonitem ki
           WHERE ki.bond_ref_tipe = 'PERMINTAAN_PEMBELIAN'
             AND ki.bond_ref_nomor = d.mbd_nomor AND ki.bond_ref_nourut = d.mbd_nourut
             AND ki.bond_verified <> 0
         ), 0) - IFNULL((
           SELECT SUM(ki2.bond2_qty_realisasi)
           FROM finance.tkasbonitem2 ki2
           WHERE ki2.bond2_link = d.mbd_nomor AND ki2.bond2_brg_kode = d.mbd_brg_kode
             AND ki2.bond2_verified <> 0
         ), 0) - ${SQL_QTY_PO_MB("d")}) > IFNULL((
           SELECT SUM(d2.mbd2_jumlah) FROM tgarmenmintabeli_dtl2 d2
           WHERE d2.mbd2_nomor = d.mbd_nomor AND d2.mbd2_brg_kode = d.mbd_brg_kode
         ), 0)
         AND NOT EXISTS (
           SELECT 1 FROM tpengajuan_uang_muka_dtl pd
           JOIN tpengajuan_uang_muka_hdr ph ON ph.pum_nomor = pd.pumd_pum_nomor
           WHERE pd.pumd_sumber = 'PERMINTAAN_PEMBELIAN' AND pd.pumd_nomor_sumber = ?
             AND pd.pumd_item_nourut = d.mbd_nourut AND ph.pum_status NOT IN ('DITOLAK','BATAL','REALISASI')
         )
       ORDER BY d.mbd_nourut`,
      [nomorHeader, nomorHeader],
    );
    return rows;
  }

  if (sumber === "INSENTIF") {
    const [rows] = await db.query(
      `SELECT d.feed_inv_nomor AS Invoice, i.INVD_Spk_Nomor AS Kode,
              s.nama AS Nama, '' AS Satuan, i.INVD_Jumlah AS Qty,
              s.hargafee AS Fee, (i.INVD_Jumlah * s.hargafee) AS Nominal
       FROM tpengajuan_fee2 d
       JOIN tinv_dtl i ON i.INVD_inv_nomor = d.feed_inv_nomor
       JOIN ${SQL_SUMBER_FEE} s ON s.nomor = i.INVD_Spk_Nomor
       WHERE d.feed_nomor = ? AND s.hargafee <> 0
       ORDER BY d.feed_inv_nomor, i.INVD_Spk_Nomor`,
      [nomorHeader],
    );
    return rows.map((r, i) => ({ ...r, ItemNourut: i + 1 }));
  }

  if (sumber === "BKK_P04") {
    const [rows] = await db.query(
      `SELECT i.jurd_nourut AS ItemNourut, i.jurd_uraian AS Nama,
              '' AS Satuan, i.jurd_qty AS Qty, i.jurd_debet AS Nominal,
              i.jurd_rek_kode AS Account
       FROM finance.tjurnalitem i
       WHERE i.jurd_jur_no = ? AND i.jurd_trs = 'BKK' AND i.jurd_debet <> 0
       ORDER BY i.jurd_nourut`,
      [nomorHeader],
    );
    return rows;
  }

  if (sumber === "PO_LAIN_LAIN") {
    const [rows] = await db.query(
      `SELECT d.pod_nourut AS ItemNourut, d.pod_bhn_kode AS Kode,
              IF(IFNULL(d.pod_namaext, '') <> '', d.pod_namaext, d.pod_bhn_kode) AS Nama,
              d.pod_bhn_satuan AS Satuan, d.pod_Jumlah AS Qty,
              d.pod_sup_kode AS SupKode, IFNULL(s.sup_nama, '') AS Supplier,
              ROUND(${SQL_NOMINAL_BARIS_PO}, 2) AS Nominal
       FROM tpo_hdr h
       JOIN tpo_dtl d ON d.pod_po_Nomor = h.po_nomor
       LEFT JOIN tsupplier s ON s.sup_kode = d.pod_sup_kode
       WHERE h.po_nomor = ? AND h.po_jenis = 4
         AND d.pod_bhn_kode <> '' AND IFNULL(d.pod_sup_kode, '') <> ''
         AND NOT EXISTS (${sqlPumAktif("PO_LAIN_LAIN", "h.po_nomor", "d.pod_nourut")})
         AND NOT EXISTS (
           SELECT 1 FROM finance.tpengajuan_transfer_dtl t
           WHERE t.ptd_trs = h.po_nomor AND t.ptd_sup_kode = d.pod_sup_kode
             AND t.ptd_batal = ''
         )
         AND NOT EXISTS (
          SELECT 1 FROM tvoucher_dtl v
          INNER JOIN tvoucher_hdr vh ON vh.vou_nomor = v.voud_vou_nomor
          WHERE v.voud_nota = h.po_nomor AND v.voud_type = 'POL'
            AND vh.vou_sup_kode = d.pod_sup_kode
        )
       ORDER BY d.pod_nourut`,
      [nomorHeader],
    );
    return rows;
  }

  throw new Error("Sumber tidak dikenali.");
};

// ── HISTORY (browse) ──
const getHistory = async ({ startDate, endDate, cabang }) => {
  let sql = `
    SELECT
      b.bon_nomor        AS Nomor,
      DATE_FORMAT(b.bon_tanggal, '%Y-%m-%d') AS Tanggal,
      IF(b.bon_jenis=0,'KAS','BANK') AS Jenis,
      r.rek_nama         AS NamaAccount,
      b.bon_pjh_nomor    AS Pjh,
      b.bon_nota         AS Nota,
      b.bon_penerima     AS Penerima,
      b.bon_nominal      AS Nominal,
      IF(b.bon_jur_no='', 0,
        IFNULL((SELECT SUM(d.jurd_kredit) FROM finance.tjurnalitem d WHERE d.jurd_jur_no = b.bon_jur_no), 0)
      ) AS Terpakai,
      (b.bon_nominal - IF(b.bon_jur_no='', 0,
        IFNULL((SELECT SUM(d.jurd_kredit) FROM finance.tjurnalitem d WHERE d.jurd_jur_no = b.bon_jur_no), 0)
      )) AS Sisa,
      b.bon_keterangan   AS Keterangan,
      IF(b.bon_selesai=0,'Belum','Sudah') AS Selesai,
      DATE_FORMAT(b.date_create, '%Y-%m-%d %H:%i:%s') AS TanggalDibuat,
      b.user_create      AS UserDibuat
    FROM finance.tkasbon b
    LEFT JOIN finance.trekening r ON r.rek_kode = b.bon_rek_kode
    WHERE 1=1
  `;
  const params = [];

  if (startDate && endDate) {
    sql += ` AND b.bon_tanggal BETWEEN ? AND ?`;
    params.push(startDate, endDate);
  }
  if (cabang) {
    sql += ` AND b.bon_cabang = ?`;
    params.push(cabang);
  }
  sql += ` ORDER BY b.bon_tanggal DESC, b.bon_nomor DESC`;

  const [rows] = await db.query(sql, params);
  return rows;
};

// ── HISTORY DELETE ──
const deleteHistory = async (nomor) => {
  const [[bon]] = await db.query(
    `SELECT bon_selesai, bon_pjh_nomor, bon_transfer_jur_no, bon_konfirmasi_tgl
     FROM finance.tkasbon WHERE bon_nomor = ?`,
    [nomor],
  );
  if (!bon) throw new Error("Data tidak ditemukan.");
  if (Number(bon.bon_selesai) !== 0)
    throw new Error("Sudah ada penyelesaian. Tidak bisa dihapus.");
  if (bon.bon_transfer_jur_no && bon.bon_konfirmasi_tgl)
    throw new Error(
      "Kasbon ini sudah dikonfirmasi diterima. Tidak bisa dihapus; koreksi lewat transfer balik oleh Finance.",
    );

  const conn = await db.getConnection();
  await conn.beginTransaction();
  try {
    if (bon.bon_pjh_nomor) {
      await conn.query(
        `UPDATE ga2.tpermintaan_hdr SET pmt_approval = 0 WHERE pmt_pjh_nomor = ?`,
        [bon.bon_pjh_nomor],
      );
      await conn.query(
        `UPDATE ga2.tpermintaan_dtl SET
           pmd_tanggal_approved = NULL, pmd_user_approved = '',
           pmd_bon = '', pmd_dana_approved = 0,
           pmd_user_reject = '', pmd_tanggal_reject = NULL,
           pmd_kode_reject = 0
         WHERE pmd_bon = ?`,
        [nomor],
      );
    }
    // PUM yang menghasilkan bon ini dibatalkan supaya sumbernya terlepas
    // (BKK P04, Insentif, baris PO Lain-lain muncul lagi di Outstanding)
    const [pumRows] = await conn.query(
      `SELECT pum_nomor FROM tpengajuan_uang_muka_hdr
       WHERE pum_bon_nomor = ? FOR UPDATE`,
      [nomor],
    );
    for (const p of pumRows) {
      await conn.query(
        `UPDATE tpengajuan_fee f
         JOIN tpengajuan_uang_muka_dtl d ON d.pumd_nomor_sumber = f.fee_nomor
         SET f.fee_tgl_realisasi = NULL
         WHERE d.pumd_pum_nomor = ? AND d.pumd_sumber = 'INSENTIF'
           AND d.pumd_status_acc = 'ACC'`,
        [p.pum_nomor],
      );
      await conn.query(
        `UPDATE tpengajuan_uang_muka_hdr SET pum_status = 'BATAL'
         WHERE pum_nomor = ?`,
        [p.pum_nomor],
      );
    }
    // Hapus jurnal transfer laci (BKK + BKM otomatisnya) bila ada.
    if (bon.bon_transfer_jur_no) {
      const t = bon.bon_transfer_jur_no;
      await conn.query(
        `DELETE FROM finance.tjurnalitem WHERE jurd_jur_no IN (
           SELECT jur_no FROM finance.tjurnal
           WHERE jur_no = ? OR (jur_otomatis = 1 AND MID(jur_no,3,18) = ?))`,
        [t, t],
      );
      await conn.query(
        `DELETE FROM finance.tjurnal
         WHERE jur_no = ? OR (jur_otomatis = 1 AND MID(jur_no,3,18) = ?)`,
        [t, t],
      );
    }
    await conn.query(`DELETE FROM finance.tkasbonitem WHERE bond_nomor = ?`, [
      nomor,
    ]);
    await conn.query(`DELETE FROM finance.tkasbon WHERE bon_nomor = ?`, [
      nomor,
    ]);
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
};

module.exports = {
  getOutstanding,
  getOutstandingDetail,
  getHistory,
  deleteHistory,
};
