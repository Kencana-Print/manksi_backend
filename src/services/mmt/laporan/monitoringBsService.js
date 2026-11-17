const pool = require("../../../config/database");
const { format } = require("date-fns");

/**
 * Mengambil data laporan BS dari semua modul LHK:
 * 1. Digital Printing MMT (tlhk_mesin_hdr) -> P x L x 1
 * 2. Mesin Tekstil (tlhk_mesintekstil_hdr) -> P x L x 1
 * 3. Finishing MMT (tlhk_finishingmmt_hdr & dtl + tspk) -> P_SPK x L_SPK x Qty_BS
 * 4. Paperprint / Sublim Paper (tlhk_sublim_hdr & dtl) -> P x L x 1
 * 5. Sublim Roll to Roll / RTR (tlhk_rtr_hdr & dtl) -> P x L x 1
 */
const getLaporanBsData = async (filters) => {
  const { startDate, endDate, gdgKode, search, type } = filters;

  // Normalisasi format tanggal
  const tglMulai = format(new Date(startDate), "yyyy-MM-dd");
  const tglSelesai = format(new Date(endDate), "yyyy-MM-dd");

  const filterType = (type || "ALL").toUpperCase();

  // -------------------------------------------------------------------------
  // 1. QUERY BS: LHK Mesin MMT (Jumlah BS = 1)
  // -------------------------------------------------------------------------
  let paramsMesin = [tglMulai, tglSelesai];
  let queryMesin = `
        SELECT 
            'MMT' AS Jenis_LHK,
            h.lnomor AS Nomor_LHK,
            DATE_FORMAT(h.ltanggal, '%Y-%m-%d') AS Tanggal,
            h.lgdg_prod AS Gdg_Kode,
            IFNULL(h.loperator, 'SYSTEM') AS Operator,
            IFNULL(h.lmesin, 'Mesin MMT') AS Mesin,
            IFNULL(h.lbahan, '-') AS Brg_Kode,
            IFNULL(b.brg_nama, '-') AS Brg_Nama,
            IFNULL(h.lbarcode_roll, '-') AS Barcode,
            IFNULL(h.lpanjang_bs, 0) AS Panjang_BS,
            IFNULL(h.llebar_bs, 0) AS Lebar_BS,
            1 AS Jumlah_BS,
            (IFNULL(h.lpanjang_bs, 0) * IFNULL(h.llebar_bs, 0) * 1) AS Luas_BS_M2,
            IFNULL(h.lstatus, 'POSTED') AS Status
        FROM tlhk_mesin_hdr h
        LEFT JOIN tbarang_mmt b ON h.lbahan = b.brg_kode
        WHERE h.ltanggal BETWEEN ? AND ? 
          AND h.lpanjang_bs > 0
    `;

  if (gdgKode) {
    queryMesin += ` AND h.lgdg_prod = ?`;
    paramsMesin.push(gdgKode);
  }
  if (search) {
    queryMesin += ` AND (h.lnomor LIKE ? OR h.lbarcode_roll LIKE ? OR b.brg_nama LIKE ?)`;
    paramsMesin.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }

  // -------------------------------------------------------------------------
  // 2. QUERY BS: LHK Mesin Tekstil (Jumlah BS = 1)
  // -------------------------------------------------------------------------
  let paramsTekstil = [tglMulai, tglSelesai];
  let queryTekstil = `
        SELECT 
            'TEKSTIL' AS Jenis_LHK,
            h.lth_nomor AS Nomor_LHK,
            DATE_FORMAT(h.lth_tanggal, '%Y-%m-%d') AS Tanggal,
            h.lth_gdg_prod AS Gdg_Kode,
            'SYSTEM' AS Operator, 
            IFNULL((
                SELECT GROUP_CONCAT(DISTINCT dtl.ltd_jns_mesin SEPARATOR ', ')
                FROM tlhk_mesintekstil_dtl dtl 
                WHERE dtl.ltd_lth_nomor = h.lth_nomor
            ), 'Mesin Tekstil') AS Mesin,
            IFNULL(h.lth_brg_kode, '-') AS Brg_Kode,
            IFNULL(b.brg_nama, '-') AS Brg_Nama,
            IFNULL(h.lth_barcode, '-') AS Barcode,
            IFNULL(h.lth_panjang_bs, 0) AS Panjang_BS,
            IFNULL(h.lth_lebar_bs, 0) AS Lebar_BS,
            1 AS Jumlah_BS,
            (IFNULL(h.lth_panjang_bs, 0) * IFNULL(h.lth_lebar_bs, 0) * 1) AS Luas_BS_M2,
            IFNULL(h.lth_status, 'POSTED') AS Status
        FROM tlhk_mesintekstil_hdr h
        LEFT JOIN tbarang_mmt b ON h.lth_brg_kode = b.brg_kode
        WHERE h.lth_tanggal BETWEEN ? AND ? 
          AND h.lth_panjang_bs > 0
    `;

  if (gdgKode) {
    queryTekstil += ` AND h.lth_gdg_prod = ?`;
    paramsTekstil.push(gdgKode);
  }
  if (search) {
    queryTekstil += ` AND (h.lth_nomor LIKE ? OR h.lth_barcode LIKE ? OR b.brg_nama LIKE ?)`;
    paramsTekstil.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }

  // -------------------------------------------------------------------------
  // 3. QUERY BS: LHK Finishing MMT (Panjang SPK * Lebar SPK * Jumlah BS)
  // -------------------------------------------------------------------------
  let paramsFinishing = [tglMulai, tglSelesai];
  let queryFinishing = `
        SELECT 
            'FINISHING' AS Jenis_LHK,
            h.lfh_nomor AS Nomor_LHK,
            DATE_FORMAT(h.lfh_tanggal, '%Y-%m-%d') AS Tanggal,
            'GPM' AS Gdg_Kode,
            'SYSTEM' AS Operator,
            'Finishing Manual' AS Mesin,
            '-' AS Brg_Kode,
            CONCAT('BS Finishing SPK: ', d.lfd_spk_nomor) AS Brg_Nama,
            '-' AS Barcode,
            IFNULL(spk.spk_panjang, 0) AS Panjang_BS,
            IFNULL(spk.spk_lebar, 0) AS Lebar_BS,
            IFNULL(d.lfd_j_bs, 0) AS Jumlah_BS,
            (IFNULL(spk.spk_panjang, 0) * IFNULL(spk.spk_lebar, 0) * IFNULL(d.lfd_j_bs, 0)) AS Luas_BS_M2,
            'POSTED' AS Status
        FROM tlhk_finishingmmt_dtl d
        INNER JOIN tlhk_finishingmmt_hdr h ON d.lfd_lfh_nomor = h.lfh_nomor
        LEFT JOIN tspk spk ON d.lfd_spk_nomor = spk.spk_nomor
        WHERE h.lfh_tanggal BETWEEN ? AND ?
          AND d.lfd_j_bs > 0
    `;

  if (gdgKode && gdgKode !== "GPM") {
    queryFinishing += ` AND 1 = 0`;
  }
  if (search) {
    queryFinishing += ` AND (h.lfh_nomor LIKE ? OR d.lfd_spk_nomor LIKE ?)`;
    paramsFinishing.push(`%${search}%`, `%${search}%`);
  }

  // -------------------------------------------------------------------------
  // 4. QUERY BS: LHK Paperprint / Sublim Kertas (Jumlah BS = 1)
  // -------------------------------------------------------------------------
  let paramsPaperprint = [tglMulai, tglSelesai];
  let queryPaperprint = `
        SELECT 
            'PAPERPRINT' AS Jenis_LHK,
            h.lsb_nomor AS Nomor_LHK,
            DATE_FORMAT(h.lsb_tanggal, '%Y-%m-%d') AS Tanggal,
            h.lsb_gdg_kode AS Gdg_Kode,
            IFNULL(h.lsb_user_create, 'SYSTEM') AS Operator,
            IFNULL((
                SELECT MAX(d.lsbd_lokasi) 
                FROM tlhk_sublim_dtl d 
                WHERE d.lsbd_lsb_nomor = h.lsb_nomor
            ), 'Mesin Paperprint') AS Mesin,
            IFNULL(h.lsb_brg_kode, '-') AS Brg_Kode,
            IFNULL(b.brg_nama, '-') AS Brg_Nama,
            IFNULL(h.lsb_barcode, '-') AS Barcode,
            IFNULL(h.lsb_panjang_bs, 0) AS Panjang_BS,
            IFNULL(h.lsb_lebar_bs, 0) AS Lebar_BS,
            1 AS Jumlah_BS,
            (IFNULL(h.lsb_panjang_bs, 0) * IFNULL(h.lsb_lebar_bs, 0) * 1) AS Luas_BS_M2,
            IFNULL(h.lsb_status, 'POSTED') AS Status
        FROM tlhk_sublim_hdr h
        LEFT JOIN tbarang_mmt b ON h.lsb_brg_kode = b.brg_kode
        WHERE h.lsb_tanggal BETWEEN ? AND ? 
          AND h.lsb_panjang_bs > 0
    `;

  if (gdgKode) {
    queryPaperprint += ` AND h.lsb_gdg_kode = ?`;
    paramsPaperprint.push(gdgKode);
  }
  if (search) {
    queryPaperprint += ` AND (h.lsb_nomor LIKE ? OR h.lsb_barcode LIKE ? OR b.brg_nama LIKE ?)`;
    paramsPaperprint.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }

  // -------------------------------------------------------------------------
  // 5. QUERY BS: LHK Sublim RTR / Roll to Roll (Jumlah BS = 1)
  // -------------------------------------------------------------------------
  let paramsRtr = [tglMulai, tglSelesai];
  let queryRtr = `
        SELECT 
            'SUBLIM_RTR' AS Jenis_LHK,
            h.lr_nomor AS Nomor_LHK,
            DATE_FORMAT(h.lr_tanggal, '%Y-%m-%d') AS Tanggal,
            h.lr_gdg_kode AS Gdg_Kode,
            'SYSTEM' AS Operator,
            IFNULL(d.lrd_lokasi, 'Mesin Sublim RTR') AS Mesin,
            IFNULL(d.lrd_bahan, '-') AS Brg_Kode,
            CONCAT('SPK: ', d.lrd_spk_nomor, ' - ', IFNULL(d.lrd_spk_nama, '')) AS Brg_Nama,
            '-' AS Barcode,
            IFNULL(d.lrd_panjang, 0) AS Panjang_BS,
            IFNULL(d.lrd_lebar, 0) AS Lebar_BS,
            1 AS Jumlah_BS,
            (IFNULL(d.lrd_panjang, 0) * IFNULL(d.lrd_lebar, 0) * 1) AS Luas_BS_M2,
            'POSTED' AS Status
        FROM tlhk_rtr_dtl d
        INNER JOIN tlhk_rtr_hdr h ON d.lrd_lr_nomor = h.lr_nomor
        WHERE h.lr_tanggal BETWEEN ? AND ?
          AND d.lrd_panjang > 0
    `;

  if (gdgKode) {
    queryRtr += ` AND h.lr_gdg_kode = ?`;
    paramsRtr.push(gdgKode);
  }
  if (search) {
    queryRtr += ` AND (h.lr_nomor LIKE ? OR d.lrd_spk_nomor LIKE ? OR d.lrd_spk_nama LIKE ?)`;
    paramsRtr.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }

  // -------------------------------------------------------------------------
  // EKSEKUSI QUERY DENGAN PARALLEL PROMISE
  // -------------------------------------------------------------------------
  let rawData = [];

  if (filterType === "MMT") {
    const [rows] = await pool.query(
      `${queryMesin} ORDER BY h.ltanggal DESC, h.lnomor DESC`,
      paramsMesin,
    );
    rawData = rows;
  } else if (filterType === "TEKSTIL") {
    const [rows] = await pool.query(
      `${queryTekstil} ORDER BY h.lth_tanggal DESC, h.lth_nomor DESC`,
      paramsTekstil,
    );
    rawData = rows;
  } else if (filterType === "FINISHING") {
    const [rows] = await pool.query(
      `${queryFinishing} ORDER BY h.lfh_tanggal DESC, h.lfh_nomor DESC`,
      paramsFinishing,
    );
    rawData = rows;
  } else if (filterType === "PAPERPRINT" || filterType === "SUBLIM_PAPER") {
    const [rows] = await pool.query(
      `${queryPaperprint} ORDER BY h.lsb_tanggal DESC, h.lsb_nomor DESC`,
      paramsPaperprint,
    );
    rawData = rows;
  } else if (
    filterType === "SUBLIM" ||
    filterType === "SUBLIM_RTR" ||
    filterType === "RTR"
  ) {
    const [rows] = await pool.query(
      `${queryRtr} ORDER BY h.lr_tanggal DESC, h.lr_nomor DESC`,
      paramsRtr,
    );
    rawData = rows;
  } else {
    const [
      [rowsMesin],
      [rowsTekstil],
      [rowsFinishing],
      [rowsPaperprint],
      [rowsRtr],
    ] = await Promise.all([
      pool.query(queryMesin, paramsMesin),
      pool.query(queryTekstil, paramsTekstil),
      pool.query(queryFinishing, paramsFinishing),
      pool.query(queryPaperprint, paramsPaperprint),
      pool.query(queryRtr, paramsRtr),
    ]);

    rawData = [
      ...rowsMesin,
      ...rowsTekstil,
      ...rowsFinishing,
      ...rowsPaperprint,
      ...rowsRtr,
    ].sort(
      (a, b) => new Date(b.Tanggal).getTime() - new Date(a.Tanggal).getTime(),
    );
  }

  // -------------------------------------------------------------------------
  // SUMMARY DATA
  // -------------------------------------------------------------------------
  const summary = rawData.reduce(
    (acc, cur) => {
      acc.total_records += 1;
      acc.total_qty_bs += Number(cur.Jumlah_BS || 0);
      acc.total_luas_m2 += Number(cur.Luas_BS_M2 || 0);
      return acc;
    },
    { total_records: 0, total_qty_bs: 0, total_luas_m2: 0 },
  );

  summary.total_qty_bs = Number(summary.total_qty_bs.toFixed(2));
  summary.total_luas_m2 = Number(summary.total_luas_m2.toFixed(2));

  const formattedData = rawData.map((row) => ({
    ...row,
    Panjang_BS: Number(Number(row.Panjang_BS || 0).toFixed(2)),
    Lebar_BS: Number(Number(row.Lebar_BS || 0).toFixed(2)),
    Jumlah_BS: Number(Number(row.Jumlah_BS || 0).toFixed(2)),
    Luas_BS_M2: Number(Number(row.Luas_BS_M2 || 0).toFixed(2)),
  }));

  return {
    summary,
    list: formattedData,
  };
};

module.exports = {
  getLaporanBsData,
};
