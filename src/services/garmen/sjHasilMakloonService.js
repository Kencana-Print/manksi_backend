const db = require("../../config/database");
const { recomputeStatus } = require("./maklonStatusService");

// ─────────────────────────────────────────────────────────
// OUTSTANDING — baris LHK Maklon (tdtf_maklon) yang belum pernah
// direferensikan di tsj_maklon_dtl sama sekali (belum ada SJ
// Hasil Maklon dibuat untuk baris LHK ini).
// ─────────────────────────────────────────────────────────
const getOutstanding = async ({ startDate, endDate, cab }) => {
  const params = [startDate, endDate];
  let cabFilter = "";
  if (cab && cab !== "ALL") {
    cabFilter = " AND dm.cab = ?";
    params.push(cab);
  }

  const [rows] = await db.query(
    `SELECT
       dm.id AS DtfMaklonId,
       dm.mkl_nomor AS MklNomor,
       dm.tanggal AS Tanggal,
       dm.cab AS Cab,
       h.mkl_cab_asal AS CabAsal,
       ga.pab_nama AS NamaCabAsal,
       h.mkl_cab_tujuan AS CabTujuan,
       gt.pab_nama AS NamaCabTujuan,
       dm.kode_polos AS KodePolos,
       bp.brg_nama AS NamaPolos,
       dm.kode_hasil AS KodeHasil,
       bh.brg_nama AS NamaHasil,
       dm.satuan AS Satuan,
       dm.qty_masuk AS QtyMasuk,
       dm.qty_hasil AS QtyHasil,
       dm.bs_afval AS BsAfval,
       dm.keterangan AS Keterangan
     FROM tdtf_maklon dm
     JOIN tmaklon_hdr h ON h.mkl_nomor = dm.mkl_nomor
     LEFT JOIN tgarmen_brg bp ON bp.brg_kode = dm.kode_polos
     LEFT JOIN tgarmen_brg bh ON bh.brg_kode = dm.kode_hasil
     LEFT JOIN tpabrik ga ON ga.pab_kode = h.mkl_cab_asal
     LEFT JOIN tpabrik gt ON gt.pab_kode = h.mkl_cab_tujuan
     WHERE dm.tanggal BETWEEN ? AND ?
       ${cabFilter}
       AND NOT EXISTS (
         SELECT 1 FROM tsj_maklon_dtl sd WHERE sd.sjmd_dtf_maklon_id = dm.id
       )
     ORDER BY dm.tanggal DESC, dm.id DESC`,
    params,
  );
  return rows;
};

// ─────────────────────────────────────────────────────────
// HISTORY — daftar SJ Hasil Maklon yang sudah dibuat.
// ─────────────────────────────────────────────────────────
const getHistory = async ({ startDate, endDate, cab }) => {
  const params = [startDate, endDate];
  let cabFilter = "";
  if (cab && cab !== "ALL") {
    cabFilter = " AND h.sjm_cab_penerima = ?";
    params.push(cab);
  }

  const [rows] = await db.query(
    `SELECT
       h.sjm_nomor AS Nomor,
       h.sjm_mkl_nomor AS MklNomor,
       h.sjm_tanggal AS Tanggal,
       h.sjm_cab_penerima AS CabPenerima,
       gp.pab_nama AS NamaCabPenerima,
       h.sjm_user_create AS UserCreate,
       COUNT(d.sjmd_id) AS JmlItem,
       SUM(d.sjmd_qty_terima) AS TotalTerima,
       SUM(d.sjmd_qty_bs) AS TotalBs
     FROM tsj_maklon_hdr h
     LEFT JOIN tsj_maklon_dtl d ON d.sjmd_sjm_nomor = h.sjm_nomor
     LEFT JOIN tpabrik gp ON gp.pab_kode = h.sjm_cab_penerima
     WHERE h.sjm_tanggal BETWEEN ? AND ?
       ${cabFilter}
     GROUP BY h.sjm_nomor
     ORDER BY h.sjm_tanggal DESC, h.sjm_nomor DESC`,
    params,
  );
  return rows;
};

const generateNomor = async (conn) => {
  const year = new Date().getFullYear();
  const [[last]] = await conn.query(
    `SELECT sjm_nomor FROM tsj_maklon_hdr WHERE sjm_nomor LIKE ? ORDER BY sjm_nomor DESC LIMIT 1 FOR UPDATE`,
    [`SJHM.${year}.%`],
  );
  const nextUrut = last ? parseInt(last.sjm_nomor.split(".")[2], 10) + 1 : 1;
  return `SJHM.${year}.${String(nextUrut).padStart(5, "0")}`;
};

// ─────────────────────────────────────────────────────────
// Data untuk form Create — dipanggil dengan daftar id tdtf_maklon
// yang sudah dipilih di tab Outstanding (semua harus 1 mkl_nomor).
// ─────────────────────────────────────────────────────────
const getCreateData = async (ids) => {
  if (!ids || !ids.length) throw new Error("Tidak ada baris yang dipilih.");

  const [rows] = await db.query(
    `SELECT dm.id AS DtfMaklonId, dm.mkl_nomor AS MklNomor, dm.tanggal AS Tanggal,
            dm.kode_polos AS KodePolos, bp.brg_nama AS NamaPolos,
            dm.kode_hasil AS KodeHasil, bh.brg_nama AS NamaHasil,
            dm.satuan AS Satuan, dm.qty_hasil AS QtyHasil, dm.bs_afval AS BsAfval,
            dm.lhk_nomor AS LhkNomor
     FROM tdtf_maklon dm
     LEFT JOIN tgarmen_brg bp ON bp.brg_kode = dm.kode_polos
     LEFT JOIN tgarmen_brg bh ON bh.brg_kode = dm.kode_hasil
     WHERE dm.id IN (?)
       AND NOT EXISTS (SELECT 1 FROM tsj_maklon_dtl sd WHERE sd.sjmd_dtf_maklon_id = dm.id)`,
    [ids],
  );

  if (!rows.length)
    throw new Error("Baris tidak ditemukan atau sudah dibuatkan SJ.");

  const mklNomorSet = new Set(rows.map((r) => r.MklNomor));
  if (mklNomorSet.size > 1) {
    throw new Error("Semua baris harus berasal dari No. Maklon yang sama.");
  }
  if (rows.length !== ids.length) {
    throw new Error(
      "Sebagian baris sudah dibuatkan SJ oleh transaksi lain. Silakan refresh.",
    );
  }

  const [[hdr]] = await db.query(
    `SELECT h.mkl_nomor, h.mkl_cab_asal, h.mkl_cab_tujuan,
            ga.pab_nama AS NamaCabAsal, gt.pab_nama AS NamaCabTujuan
     FROM tmaklon_hdr h
     LEFT JOIN tpabrik ga ON ga.pab_kode = h.mkl_cab_asal
     LEFT JOIN tpabrik gt ON gt.pab_kode = h.mkl_cab_tujuan
     WHERE h.mkl_nomor = ?`,
    [rows[0].MklNomor],
  );

  return { header: hdr, items: rows };
};

// ─────────────────────────────────────────────────────────
// CREATE — generate No. SJ, insert header + detail. Qty Diterima
// SELALU = Qty Hasil dari LHK (readonly, tidak boleh dikoreksi di
// sini — sesuai keputusan). Gudang Penerima default cabang ASAL
// (barang balik ke pengirim polos), tapi tetap dikirim eksplisit
// dari payload agar form bisa override kalau memang perlu.
// ─────────────────────────────────────────────────────────
// ── Inti logic — dipakai internal (share conn dari caller, mis. LHK
// save) MAUPUN dari createSjHasilMaklon publik (buka conn sendiri) ──
const generateSjForIds = async (conn, mklNomor, ids, tanggal, userKode) => {
  const [rows] = await conn.query(
    `SELECT dm.id AS DtfMaklonId, dm.mkl_nomor AS MklNomor, dm.kode_polos AS KodePolos,
            dm.kode_hasil AS KodeHasil, dm.qty_hasil AS QtyHasil, dm.bs_afval AS BsAfval
     FROM tdtf_maklon dm
     WHERE dm.id IN (?)
       AND NOT EXISTS (SELECT 1 FROM tsj_maklon_dtl sd WHERE sd.sjmd_dtf_maklon_id = dm.id)
     FOR UPDATE`,
    [ids],
  );

  if (!rows.length) return null; // semua id sudah punya SJ / tidak valid — skip diam-diam

  const mklNomorSet = new Set(rows.map((r) => r.MklNomor));
  if (mklNomorSet.size > 1) {
    throw new Error("Semua baris harus berasal dari No. Maklon yang sama.");
  }
  const validRows = rows.filter((r) => r.KodeHasil);
  if (!validRows.length) return null;

  const [[mklHdr]] = await conn.query(
    `SELECT mkl_cab_asal FROM tmaklon_hdr WHERE mkl_nomor = ?`,
    [mklNomor],
  );
  if (!mklHdr) throw new Error("Data Maklon induk tidak ditemukan.");
  const cabPenerima = mklHdr.mkl_cab_asal;

  const nomor = await generateNomor(conn);

  await conn.query(
    `INSERT INTO tsj_maklon_hdr (sjm_nomor, sjm_mkl_nomor, sjm_tanggal, sjm_cab_penerima, sjm_user_create, sjm_date_create)
     VALUES (?, ?, ?, ?, ?, NOW())`,
    [nomor, mklNomor, tanggal, cabPenerima, userKode],
  );

  for (const r of validRows) {
    const [[mkld]] = await conn.query(
      `SELECT mkld_id FROM tmaklon_dtl WHERE mkld_mkl_nomor = ? AND mkld_kode_polos = ? LIMIT 1`,
      [mklNomor, r.KodePolos],
    );
    if (!mkld) {
      throw new Error(
        `Baris Maklon untuk bahan ${r.KodePolos} tidak ditemukan.`,
      );
    }

    await conn.query(
      `INSERT INTO tsj_maklon_dtl (sjmd_sjm_nomor, sjmd_mkld_id, sjmd_dtf_maklon_id, sjmd_kode_jadi, sjmd_qty_terima, sjmd_qty_bs)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        nomor,
        mkld.mkld_id,
        r.DtfMaklonId,
        r.KodeHasil,
        Number(r.QtyHasil) || 0,
        Number(r.BsAfval) || 0,
      ],
    );
  }

  return { nomor, cabPenerima };
};

// ── Publik — dipakai dialog manual dari tab Outstanding (buka conn sendiri) ──
const createSjHasilMaklon = async (payload, user) => {
  const { tanggal, ids } = payload;
  if (!ids || !ids.length) throw new Error("Minimal 1 baris harus dipilih.");
  if (!tanggal) throw new Error("Tanggal wajib diisi.");

  const [[first]] = await db.query(
    `SELECT mkl_nomor FROM tdtf_maklon WHERE id = ?`,
    [ids[0]],
  );
  if (!first) throw new Error("Baris tidak ditemukan.");

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const result = await generateSjForIds(
      conn,
      first.mkl_nomor,
      ids,
      tanggal,
      user.kode,
    );
    if (!result) {
      throw new Error(
        "Sebagian/semua baris sudah dibuatkan SJ oleh transaksi lain. Silakan refresh.",
      );
    }
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
};

const getPrintData = async (sjmNomor) => {
  const [[header]] = await db.query(
    `SELECT h.sjm_nomor, h.sjm_tanggal, h.sjm_mkl_nomor, h.sjm_cab_penerima, h.sjm_user_create,
            m.mkl_cab_asal, m.mkl_cab_tujuan,
            ga.pab_nama AS NamaCabAsal, gt.pab_nama AS NamaCabTujuan
     FROM tsj_maklon_hdr h
     JOIN tmaklon_hdr m ON m.mkl_nomor = h.sjm_mkl_nomor
     LEFT JOIN tpabrik ga ON ga.pab_kode = m.mkl_cab_asal
     LEFT JOIN tpabrik gt ON gt.pab_kode = m.mkl_cab_tujuan
     WHERE h.sjm_nomor = ?`,
    [sjmNomor],
  );
  if (!header) throw new Error("SJ Hasil Maklon tidak ditemukan.");

  const [details] = await db.query(
    `SELECT d.sjmd_qty_terima, d.sjmd_qty_bs, d.sjmd_kode_jadi,
            b.brg_nama AS NamaJadi, b.brg_satuan AS Satuan,
            dm.lhk_nomor AS LhkNomor
     FROM tsj_maklon_dtl d
     LEFT JOIN tgarmen_brg b ON b.brg_kode = d.sjmd_kode_jadi
     LEFT JOIN tdtf_maklon dm ON dm.id = d.sjmd_dtf_maklon_id
     WHERE d.sjmd_sjm_nomor = ?`,
    [sjmNomor],
  );

  return { header, details };
};

// sjHasilMakloonService.js
const getHistoryDetail = async (sjmNomor) => {
  const [rows] = await db.query(
    `SELECT d.sjmd_kode_jadi AS KodeJadi, b.brg_nama AS NamaJadi, b.brg_satuan AS Satuan,
            d.sjmd_qty_terima AS QtyTerima, d.sjmd_qty_bs AS QtyBs,
            dm.lhk_nomor AS LhkNomor
     FROM tsj_maklon_dtl d
     LEFT JOIN tgarmen_brg b ON b.brg_kode = d.sjmd_kode_jadi
     LEFT JOIN tdtf_maklon dm ON dm.id = d.sjmd_dtf_maklon_id
     WHERE d.sjmd_sjm_nomor = ?`,
    [sjmNomor],
  );
  return rows;
};

module.exports = {
  getOutstanding,
  getHistory,
  getCreateData,
  createSjHasilMaklon,
  generateSjForIds,
  getPrintData,
  getHistoryDetail,
};
