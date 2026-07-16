// services/ppic/planningSpkFormService.js
const db = require("../../config/database");

// ─────────────────────────────────────────────
// Generate nomor: PL/PPIC/00001/2026
// ─────────────────────────────────────────────
const generateNomor = async (tahun) => {
  const [rows] = await db.query(
    `SELECT IFNULL(MAX(CAST(SUBSTRING(pl_nomor, 9, 5) AS UNSIGNED)), 0) AS jumlah
     FROM tplan_ppic_hdr
     WHERE LEFT(pl_nomor, 7) = 'PL/PPIC'
       AND RIGHT(pl_nomor, 4) = ?`,
    [String(tahun)],
  );
  // FIX: rows[0].jumlah balik sebagai STRING dari mysql2 meski sudah
  // di-CAST AS UNSIGNED di SQL — wajib Number() dulu sebelum +1,
  // kalau tidak jadi string concat ("1"+1="11" bukan 2).
  const nextVal = Number(rows[0].jumlah) + 1;
  return `PL/PPIC/${String(nextVal).padStart(5, "0")}/${tahun}`;
};

// ─────────────────────────────────────────────
// getFormDetail — load untuk mode edit
// ─────────────────────────────────────────────
const getFormDetail = async (nomor) => {
  // Header — tanpa info SPK (multi SPK sekarang per baris)
  const [hdrRows] = await db.query(
    `SELECT
       h.pl_nomor,
       DATE_FORMAT(h.pl_tgl1, '%Y-%m-%d') AS pl_tgl1,
       DATE_FORMAT(h.pl_tgl2, '%Y-%m-%d') AS pl_tgl2,
       h.pl_cab,
       h.pl_keterangan
     FROM tplan_ppic_hdr h
     WHERE h.pl_nomor = ?`,
    [nomor],
  );
  if (!hdrRows.length) return null;
  const hdr = hdrRows[0];

  // Detail per divisi — setiap baris punya SPK sendiri
  const loadDivisi = async (divisi) => {
    const [rows] = await db.query(
      `SELECT
        d.plan_spk             AS NomorSPK,
        s.spk_nama             AS NamaSPK,
        s.spk_jumlah           AS QtySPK,
        DATE_FORMAT(d.plan_tgl_jadwal, '%Y-%m-%d') AS plan_tgl_jadwal,
        d.plan_wip             AS plan_wip,
        d.plan_qty_po          AS plan_qty_po,
        d.plan_qty_jadwal      AS plan_qty_jadwal,
        d.plan_line_kelompok   AS plan_line_kelompok,
        d.plan_supplier_kode   AS supplierKode,
        d.plan_supplier_nama   AS supplierNama
      FROM tplan_ppic_dtl2 d
      LEFT JOIN tspk s ON s.spk_nomor = d.plan_spk
      WHERE d.plan_pl_nomor = ? AND d.plan_divisi = ?
      ORDER BY d.plan_tgl_jadwal ASC`,
      [nomor, divisi],
    );
    return rows;
  };

  const [cutting, sewing, koli] = await Promise.all([
    loadDivisi("CUTTING"),
    loadDivisi("SEWING"),
    loadDivisi("KOLI"),
  ]);

  // Riwayat: semua planning lain yang punya SPK yang sama
  // dengan SPK yang ada di salah satu tab
  const allSpk = [
    ...cutting.map((r) => r.NomorSPK),
    ...sewing.map((r) => r.NomorSPK),
    ...koli.map((r) => r.NomorSPK),
  ].filter(Boolean);
  const uniqueSpk = [...new Set(allSpk)];

  const riwayat = uniqueSpk.length
    ? await getRiwayatBySpkList(uniqueSpk, nomor)
    : [];

  return {
    header: hdr,
    detail: { cutting, sewing, koli },
    riwayat,
  };
};

// ─────────────────────────────────────────────
// getRiwayatBySpkList — semua planning lain
// yang punya salah satu dari SPK yang ada di grid
// ─────────────────────────────────────────────
const getRiwayatBySpkList = async (spkList, excludeNomor = "") => {
  if (!spkList.length) return [];
  const placeholders = spkList.map(() => "?").join(",");
  const [rows] = await db.query(
    `SELECT DISTINCT
       h.pl_nomor   AS Nomor,
       DATE_FORMAT(h.pl_tgl1, '%Y-%m-%d') AS Tgl1,
       DATE_FORMAT(h.pl_tgl2, '%Y-%m-%d') AS Tgl2,
       h.pl_cab     AS Cabang,
       h.pl_close   AS Close,
       h.pl_keterangan AS Keterangan,
       d.plan_spk   AS NomorSPK,
       s.spk_nama   AS NamaSPK
     FROM tplan_ppic_hdr h
     INNER JOIN tplan_ppic_dtl2 d ON d.plan_pl_nomor = h.pl_nomor
     LEFT JOIN tspk s ON s.spk_nomor = d.plan_spk
     WHERE d.plan_spk IN (${placeholders})
       AND h.pl_nomor <> ?
     ORDER BY h.pl_nomor ASC`,
    [...spkList, excludeNomor],
  );
  return rows;
};

// ─────────────────────────────────────────────
// getRiwayatBySpkList — versi untuk dipanggil
// dari controller saat frontend kirim list SPK
// ─────────────────────────────────────────────
const getRiwayatSpk = async (spkList, excludeNomor = "") => {
  const list = Array.isArray(spkList) ? spkList : [spkList];
  return getRiwayatBySpkList(list, excludeNomor);
};

// ─────────────────────────────────────────────
// getSpkInfo — saat user ketik/pilih SPK per baris
// ─────────────────────────────────────────────
const getSpkInfo = async (spkNomor) => {
  const [rows] = await db.query(
    `SELECT
       s.spk_nomor, s.spk_nama,
       s.spk_jumlah, s.spk_jumlah_kirim,
       (s.spk_jumlah - s.spk_jumlah_kirim) AS spk_kurang,
       DATE_FORMAT(s.spk_tanggal,  '%Y-%m-%d') AS spk_tanggal,
       DATE_FORMAT(s.spk_dateline, '%Y-%m-%d') AS spk_dateline,
       s.spk_cab        AS spk_workshop_kode,
       TRIM(s.spk_workshop) AS spk_workshop,
       s.spk_tipe, s.spk_kain, s.spk_finishing,
       s.spk_sablon, s.spk_sublim, s.spk_bordir
     FROM tspk s
     WHERE s.spk_aktif = 'Y'
       AND s.spk_divisi IN (3,4,6)
       AND s.spk_nomor = ?`,
    [spkNomor],
  );
  if (!rows.length) return null;
  return rows[0];
};

// ─────────────────────────────────────────────
// saveData — create / edit, multi-SPK per baris
// payload.detail = { cutting: [], sewing: [], koli: [] }
// setiap row: { NomorSPK, plan_tgl_jadwal, plan_wip,
//               plan_qty_po, plan_qty_jadwal, plan_line_kelompok }
// ─────────────────────────────────────────────
const saveData = async (payload, userKode) => {
  const {
    pl_nomor,
    pl_tgl1,
    pl_tgl2,
    pl_cab,
    pl_keterangan,
    detail = { cutting: [], sewing: [], koli: [] },
  } = payload;

  if (!pl_tgl1 || !pl_tgl2) throw new Error("Periode planning wajib diisi.");

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const tahun = new Date(pl_tgl1).getFullYear();
    let nomor = pl_nomor;

    if (nomor) {
      // UPDATE header
      await conn.query(
        `UPDATE tplan_ppic_hdr SET
           pl_tgl1       = ?,
           pl_tgl2       = ?,
           pl_cab        = ?,
           pl_keterangan = ?,
           user_modified = ?,
           date_modified = NOW()
         WHERE pl_nomor = ?`,
        [pl_tgl1, pl_tgl2, pl_cab || "", pl_keterangan || "", userKode, nomor],
      );
    } else {
      // INSERT header — kolom pl_spk_nomor sudah tidak ada secara
      // fisik di tabel (sisa skema lama sebelum multi-SPK per baris)
      nomor = await generateNomor(tahun);
      await conn.query(
        `INSERT INTO tplan_ppic_hdr
           (pl_nomor, pl_tgl1, pl_tgl2, pl_cab,
            pl_keterangan, user_create, date_create)
         VALUES (?, ?, ?, ?, ?, ?, NOW())`,
        [nomor, pl_tgl1, pl_tgl2, pl_cab || "", pl_keterangan || "", userKode],
      );
    }

    // Hapus semua detail lama lalu insert ulang
    await conn.query(`DELETE FROM tplan_ppic_dtl2 WHERE plan_pl_nomor = ?`, [
      nomor,
    ]);
    await conn.query(`DELETE FROM tplan_ppic_dtl WHERE pld_nomor = ?`, [nomor]);

    const insertDivisi = async (rows, divisi) => {
      for (const row of rows) {
        // skip baris yang tidak punya SPK atau tanggal
        if (!row.NomorSPK || !row.plan_tgl_jadwal) continue;

        // Supplier cuma relevan buat Sewing dengan Line Eksternal
        const isExternal =
          divisi === "SEWING" && row.plan_line_kelompok === "LINE EXTERNAL";

        // Validasi duplikat SPK di divisi yang sama sudah di frontend
        // tapi backend cek juga untuk safety
        await conn.query(
          `INSERT IGNORE INTO tplan_ppic_dtl2
            (plan_pl_nomor, plan_spk, plan_divisi, plan_tanggal,
              plan_tgl_jadwal, plan_wip, plan_qty_po,
              plan_qty_jadwal, plan_line_kelompok,
              plan_supplier_kode, plan_supplier_nama)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            nomor,
            row.NomorSPK,
            divisi,
            row.plan_tgl_jadwal, // plan_tanggal = tgl_jadwal (PK)
            row.plan_tgl_jadwal,
            Number(row.plan_wip) || 0,
            Number(row.plan_qty_po) || 0,
            Number(row.plan_qty_jadwal) || 0,
            divisi === "KOLI" ? "" : row.plan_line_kelompok || "",
            isExternal ? row.supplierKode || "" : "",
            isExternal ? row.supplierNama || "" : "",
          ],
        );
      }
    };

    await insertDivisi(detail.cutting || [], "CUTTING");
    await insertDivisi(detail.sewing || [], "SEWING");
    await insertDivisi(detail.koli || [], "KOLI");

    await conn.commit();
    return { nomor };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
};

// Ambil qty PO Jasa per SPK per divisi
// Sewing = J02, Koli = J03
const getQtyPoJasa = async (spkNomor) => {
  const [rows] = await db.query(
    `SELECT
       h.pojh_jasa_kode                    AS jasa_kode,
       IFNULL(SUM(h.pojh_jumlah), 0)       AS qty_po
     FROM tpojasa_hdr h
     WHERE h.pojh_spk_nomor = ?
       AND h.pojh_jasa_kode IN ('J02', 'J03')
     GROUP BY h.pojh_jasa_kode`,
    [spkNomor],
  );

  // Default 0
  const result = { sewing: 0, koli: 0 };
  for (const r of rows) {
    if (r.jasa_kode === "J02") result.sewing = Number(r.qty_po) || 0;
    if (r.jasa_kode === "J03") result.koli = Number(r.qty_po) || 0;
  }
  return result;
};

module.exports = {
  generateNomor,
  getFormDetail,
  getRiwayatSpk,
  getSpkInfo,
  saveData,
  getQtyPoJasa,
};
