const db = require("../../config/database");
const { recomputeStatus } = require("./maklonStatusService");

const generateNomor = async (conn) => {
  const year = new Date().getFullYear();
  const [[last]] = await conn.query(
    `SELECT mth_nomor FROM tmaklon_terima_hdr WHERE mth_nomor LIKE ? ORDER BY mth_nomor DESC LIMIT 1 FOR UPDATE`,
    [`TRM-MKL.${year}.%`],
  );
  const nextUrut = last ? parseInt(last.mth_nomor.split(".")[2], 10) + 1 : 1;
  return `TRM-MKL.${year}.${String(nextUrut).padStart(5, "0")}`;
};

// ── Cek apakah suatu Maklon masih punya sisa qty SJ yang belum divalidasi ──
const getOutstandingByMkl = async (mklNomor) => {
  const [rows] = await db.query(
    `SELECT
       h.sjm_nomor AS SjmNomor,
       h.sjm_tanggal AS SjmTanggal,
       d.sjmd_id AS SjmdId,
       d.sjmd_kode_jadi AS KodeJadi,
       b.brg_nama AS NamaJadi,
       b.brg_satuan AS Satuan,
       d.sjmd_qty_terima AS QtySjTerima,
       d.sjmd_qty_bs AS QtySjBs,
       IFNULL((SELECT SUM(t.mtd_qty_terima) FROM tmaklon_terima_dtl t WHERE t.mtd_sjmd_id = d.sjmd_id), 0) AS SudahTerima,
       IFNULL((SELECT SUM(t.mtd_qty_bs) FROM tmaklon_terima_dtl t WHERE t.mtd_sjmd_id = d.sjmd_id), 0) AS SudahBs
     FROM tsj_maklon_hdr h
     JOIN tsj_maklon_dtl d ON d.sjmd_sjm_nomor = h.sjm_nomor
     LEFT JOIN tgarmen_brg b ON b.brg_kode = d.sjmd_kode_jadi
     WHERE h.sjm_mkl_nomor = ?
     ORDER BY h.sjm_tanggal, h.sjm_nomor, d.sjmd_id`,
    [mklNomor],
  );

  const items = rows
    .map((r) => ({
      ...r,
      SisaTerima: Number(r.QtySjTerima) - Number(r.SudahTerima),
      SisaBs: Number(r.QtySjBs) - Number(r.SudahBs),
    }))
    .filter((r) => r.SisaTerima > 0 || r.SisaBs > 0);

  return items;
};

const getMklHeader = async (mklNomor) => {
  const [[hdr]] = await db.query(
    `SELECT h.mkl_nomor, h.mkl_cab_asal, h.mkl_cab_tujuan, h.mkl_status,
            ga.pab_nama AS NamaCabAsal, gt.pab_nama AS NamaCabTujuan
     FROM tmaklon_hdr h
     LEFT JOIN tpabrik ga ON ga.pab_kode = h.mkl_cab_asal
     LEFT JOIN tpabrik gt ON gt.pab_kode = h.mkl_cab_tujuan
     WHERE h.mkl_nomor = ?`,
    [mklNomor],
  );
  if (!hdr) throw new Error("Nomor Maklon tidak ditemukan.");
  return hdr;
};

// ── Simpan validasi — qty aktual boleh beda dari qty SJ (kasus selisih) ──
const saveValidasi = async (payload, user) => {
  const { mklNomor, tanggal, items } = payload;
  if (!mklNomor) throw new Error("No. Maklon wajib diisi.");
  if (!tanggal) throw new Error("Tanggal wajib diisi.");
  if (!items || !items.length) throw new Error("Minimal 1 baris harus diisi.");

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const nomor = await generateNomor(conn);
    await conn.query(
      `INSERT INTO tmaklon_terima_hdr (mth_nomor, mth_mkl_nomor, mth_tanggal, mth_user_create, mth_date_create)
       VALUES (?, ?, ?, ?, NOW())`,
      [nomor, mklNomor, tanggal, user.kode],
    );

    let anyInserted = false;
    for (const it of items) {
      const qtyTerima = Number(it.qty_terima) || 0;
      const qtyBs = Number(it.qty_bs) || 0;
      if (qtyTerima <= 0 && qtyBs <= 0) continue;

      const [[dtl]] = await conn.query(
        `SELECT d.sjmd_qty_terima, d.sjmd_qty_bs,
                IFNULL((SELECT SUM(t.mtd_qty_terima) FROM tmaklon_terima_dtl t WHERE t.mtd_sjmd_id = d.sjmd_id), 0) AS SudahTerima,
                IFNULL((SELECT SUM(t.mtd_qty_bs) FROM tmaklon_terima_dtl t WHERE t.mtd_sjmd_id = d.sjmd_id), 0) AS SudahBs
         FROM tsj_maklon_dtl d WHERE d.sjmd_id = ? FOR UPDATE`,
        [it.sjmd_id],
      );
      if (!dtl) throw new Error(`Baris detail ${it.sjmd_id} tidak ditemukan.`);

      const sisaTerima = Number(dtl.sjmd_qty_terima) - Number(dtl.SudahTerima);
      const sisaBs = Number(dtl.sjmd_qty_bs) - Number(dtl.SudahBs);
      if (qtyTerima > sisaTerima) {
        throw new Error(
          `Qty Terima (${qtyTerima}) melebihi sisa (${sisaTerima}) pada salah satu baris.`,
        );
      }
      if (qtyBs > sisaBs) {
        throw new Error(
          `Qty BS (${qtyBs}) melebihi sisa (${sisaBs}) pada salah satu baris.`,
        );
      }

      await conn.query(
        `INSERT INTO tmaklon_terima_dtl (mtd_mth_nomor, mtd_sjmd_id, mtd_qty_terima, mtd_qty_bs)
         VALUES (?, ?, ?, ?)`,
        [nomor, it.sjmd_id, qtyTerima, qtyBs],
      );
      anyInserted = true;
    }

    if (!anyInserted)
      throw new Error("Minimal 1 baris harus diisi qty terima atau qty BS.");

    await recomputeStatus(conn, mklNomor);

    await conn.commit();
    return { nomor };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
};

const getHistory = async ({ startDate, endDate, cab }) => {
  const params = [startDate, endDate];
  let cabFilter = "";
  if (cab && cab !== "ALL") {
    cabFilter = " AND h.sjm_cab_penerima = ?";
    params.push(cab);
  }

  const [rows] = await db.query(
    `SELECT
       t.mth_nomor AS Nomor,
       t.mth_mkl_nomor AS SjmNomor,
       t.mth_tanggal AS Tanggal,
       h.sjm_cab_penerima AS CabPenerima,
       gp.pab_nama AS NamaCabPenerima,
       t.mth_user_create AS UserCreate,
       COUNT(d.mtd_id) AS JmlItem,
       SUM(d.mtd_qty_terima) AS TotalTerima,
       SUM(d.mtd_qty_bs) AS TotalBs
     FROM tmaklon_terima_hdr t
     JOIN tsj_maklon_hdr h ON h.sjm_nomor = t.mth_mkl_nomor
     LEFT JOIN tpabrik gp ON gp.pab_kode = h.sjm_cab_penerima
     LEFT JOIN tmaklon_terima_dtl d ON d.mtd_mth_nomor = t.mth_nomor
     WHERE t.mth_tanggal BETWEEN ? AND ?
       ${cabFilter}
     GROUP BY t.mth_nomor
     ORDER BY t.mth_tanggal DESC, t.mth_nomor DESC`,
    params,
  );
  return rows;
};

const getHistoryDetail = async (mthNomor) => {
  const [rows] = await db.query(
    `SELECT d.mtd_qty_terima AS QtyTerima, d.mtd_qty_bs AS QtyBs,
            sd.sjmd_kode_jadi AS KodeJadi, b.brg_nama AS NamaJadi, b.brg_satuan AS Satuan,
            sd.sjmd_qty_terima AS QtySjTerima, sd.sjmd_qty_bs AS QtySjBs
     FROM tmaklon_terima_dtl d
     JOIN tsj_maklon_dtl sd ON sd.sjmd_id = d.mtd_sjmd_id
     LEFT JOIN tgarmen_brg b ON b.brg_kode = sd.sjmd_kode_jadi
     WHERE d.mtd_mth_nomor = ?`,
    [mthNomor],
  );
  return rows;
};

module.exports = {
  getOutstandingByMkl,
  getMklHeader,
  saveValidasi,
  getHistory,
  getHistoryDetail,
};
