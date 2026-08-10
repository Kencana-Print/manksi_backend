const db = require("../../config/database");

/**
 * Load semua baris tdtf untuk Cab + Tanggal tertentu — replikasi
 * loaddataall() di ufrmDtf.pas persis, termasuk kondisi JOIN
 * retail.tsodtf_hdr yang mencegah duplikasi SO DTF K01 yang sudah
 * direferensikan sebagai spk_nomor_po di tspk.
 *
 * ⚠️ Fallback nama BEDA dari browse (lhkSoDtfService.getBrowseData):
 * di sini urutannya spk_nama -> sd_nama -> mspk_nama (bukan
 * spk_nama -> mspk_nama -> sd_nama seperti di browse). Ini
 * inkonsistensi asli di source Delphi, direplikasi apa adanya.
 */
const getDetail = async (cab, tanggal) => {
  const q = `
    SELECT
      d.spk_nomor AS Kode,
      IFNULL(IFNULL(s.spk_nama, h.sd_nama), m.mspk_nama) AS Nama,
      d.Depan,
      d.Belakang,
      d.Lengan,
      d.Variasi,
      d.Saku,
      d.Panjang,
      d.Buangan,
      d.Keterangan AS Ket
    FROM tdtf d
    LEFT JOIN tspk s ON s.spk_nomor = d.spk_nomor
    LEFT JOIN tmemospk m ON m.mspk_nomor = d.spk_nomor
    LEFT JOIN retail.tsodtf_hdr h
      ON h.sd_nomor = d.spk_nomor
      AND LEFT(h.sd_nomor, 3) = 'K01'
      AND h.sd_nomor NOT IN (
        SELECT spk_nomor_po FROM tspk WHERE LEFT(spk_nomor_po, 3) = 'K01'
      )
    WHERE DATE(d.Tanggal) = ? AND d.Cab = ?
  `;
  const [rows] = await db.query(q, [tanggal, cab]);

  if (rows.length === 0) {
    // Replikasi initgrid() — kalau tidak ada data, kembalikan 1 baris
    // kosong sebagai starting point form.
    return [
      {
        Kode: "",
        Nama: "",
        Depan: 0,
        Belakang: 0,
        Lengan: 0,
        Variasi: 0,
        Saku: 0,
        Panjang: 0,
        Buangan: 0,
        Ket: "",
      },
    ];
  }

  return rows.map((r) => ({
    ...r,
    Depan: Number(r.Depan) || 0,
    Belakang: Number(r.Belakang) || 0,
    Lengan: Number(r.Lengan) || 0,
    Variasi: Number(r.Variasi) || 0,
    Saku: Number(r.Saku) || 0,
    Panjang: Number(r.Panjang) || 0,
    Buangan: Number(r.Buangan) || 0,
  }));
};

const getDefaultCab = (userCab, filterCab) => {
  if (userCab) return userCab; // user terkunci ke cabangnya sendiri
  if (!filterCab || filterCab === "ALL") return "P04";
  return filterCab;
};

/**
 * F1 — Help SPK/MAP. Union tspk (spk_divisi IN (3,4,6)) +
 * tmemospk (mspk_divisi IN (3,4,6)). Filter keyword ke Nomor & Nama
 * (replikasi sqlfilter:='Nomor,Nama' pada frmbantuan).
 */
const lookupSpkMap = async (keyword) => {
  const like = `%${keyword || ""}%`;
  const q = `
    SELECT * FROM (
      SELECT spk_nomor AS Nomor, spk_nama AS Nama, spk_jumlah AS Jumlah, spk_tanggal AS Tanggal
      FROM tspk WHERE spk_divisi IN (3,4,6)
      UNION ALL
      SELECT mspk_nomor AS Nomor, mspk_nama AS Nama, mspk_jumlah AS Jumlah, mspk_tanggal AS Tanggal
      FROM tmemospk WHERE mspk_divisi IN (3,4,6)
    ) x
    WHERE x.Nomor LIKE ? OR x.Nama LIKE ?
    ORDER BY x.Tanggal DESC
    LIMIT 100
  `;
  const [rows] = await db.query(q, [like, like]);
  return rows;
};

/**
 * F2 — Help SO DTF Kaosan. retail.tsodtf_hdr TANPA filter apapun
 * (beda dari F1 yang filter divisi). Dilengkapi pagination supaya
 * konsisten dengan pola SearchModal lain (bukan bagian dari source
 * Delphi asli — frmbantuan tidak berpaginasi — tapi diperlukan untuk
 * UX komponen reusable web).
 */
const lookupSoDtf = async (keyword, page = 1, limit = 50) => {
  const like = `%${keyword || ""}%`;
  const offset = (Number(page) - 1) * Number(limit);

  const [[{ total }]] = await db.query(
    `SELECT COUNT(*) AS total FROM retail.tsodtf_hdr h WHERE h.sd_nomor LIKE ? OR h.sd_nama LIKE ?`,
    [like, like],
  );

  const [rows] = await db.query(
    `SELECT h.sd_nomor AS Nomor, h.sd_nama AS Nama, h.sd_tanggal AS Tanggal
     FROM retail.tsodtf_hdr h
     WHERE h.sd_nomor LIKE ? OR h.sd_nama LIKE ?
     ORDER BY h.sd_tanggal DESC
     LIMIT ? OFFSET ?`,
    [like, like, Number(limit), offset],
  );

  return { items: rows, total: Number(total) };
};

/**
 * Replikasi loadspk() — validasi kode yang diketik MANUAL (bukan via
 * F1/F2 popup). ⚠️ Scope BEDA dari F1: union tspk (spk_aktif='Y',
 * TANPA filter divisi) + retail.tsodtf_hdr. tmemospk TIDAK termasuk
 * di sini sama sekali — kalau kode cuma ada di tmemospk, validasi
 * manual ini akan gagal walau bisa dipilih via F1. Behavior asli,
 * dipertahankan.
 */
const validateKode = async (kode) => {
  const q = `
    SELECT * FROM (
      SELECT spk_nomor AS Nomor, spk_nama AS Nama FROM tspk WHERE spk_aktif = 'Y'
      UNION ALL
      SELECT sd_nomor, sd_nama FROM retail.tsodtf_hdr
    ) x WHERE x.Nomor = ?
  `;
  const [[row]] = await db.query(q, [kode]);
  if (!row) {
    const err = new Error("Spk/SO DTF tsb belum ada.");
    err.statusCode = 404;
    throw err;
  }
  return row;
};

/**
 * Replikasi assertCabAccess dari lhkSoDtfService (browse) — dipakai
 * juga di sini karena save() menghapus SELURUH baris cab+tanggal.
 */
const assertCabAccess = (cab, userCab) => {
  if (userCab && cab !== userCab) {
    const err = new Error("Data tersebut bukan cabang anda.");
    err.statusCode = 403;
    throw err;
  }
};

/**
 * Replikasi validasi F10 di FormKeyDown, urutan & pesan PERSIS:
 *  1. Semua baris kosong (tidak ada nama terisi) -> "Detail harus diisi."
 *  2. Per baris terisi: Ket kosong -> "Keterangan harus diisi."
 *  3. Per baris terisi: Depan+Belakang+Lengan+Variasi+Saku = 0
 *     (⚠️ Panjang & Buangan TIDAK ikut dijumlah) -> "Qty harus di isi"
 */
const validateRows = (rows) => {
  const filled = (rows || []).filter((r) => (r.Kode || "").trim() !== "");

  if (filled.length === 0) {
    const err = new Error("Detail harus diisi.");
    err.statusCode = 400;
    throw err;
  }

  for (const r of filled) {
    if (!r.Ket || !String(r.Ket).trim()) {
      const err = new Error("Keterangan harus diisi.");
      err.statusCode = 400;
      throw err;
    }
    const qtySum =
      (Number(r.Depan) || 0) +
      (Number(r.Belakang) || 0) +
      (Number(r.Lengan) || 0) +
      (Number(r.Variasi) || 0) +
      (Number(r.Saku) || 0);
    if (qtySum === 0) {
      const err = new Error("Qty harus di isi");
      err.statusCode = 400;
      throw err;
    }
  }

  return filled;
};

/**
 * Replikasi simpandata() — FULL REPLACE. DELETE semua baris
 * cab+tanggal ini, lalu INSERT ulang baris-baris yang terisi.
 * Dibungkus transaction supaya atomik (bukan delete-lalu-gagal-insert
 * yang meninggalkan data kosong).
 */
const save = async (cab, tanggal, rows, userKode, userCab) => {
  assertCabAccess(cab, userCab);
  const filled = validateRows(rows);

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    await conn.query(`DELETE FROM tdtf WHERE Cab = ? AND Tanggal = ?`, [
      cab,
      tanggal,
    ]);

    for (const r of filled) {
      await conn.query(
        `INSERT INTO tdtf
          (tanggal, spk_nomor, depan, belakang, lengan, variasi, saku, panjang, buangan, keterangan, cab, user_create, date_create)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
        [
          tanggal,
          r.Kode,
          Number(r.Depan) || 0,
          Number(r.Belakang) || 0,
          Number(r.Lengan) || 0,
          Number(r.Variasi) || 0,
          Number(r.Saku) || 0,
          Number(r.Panjang) || 0,
          Number(r.Buangan) || 0,
          r.Ket || "",
          cab,
          userKode,
        ],
      );
    }

    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }

  return { cab, tanggal, count: filled.length };
};

module.exports = {
  getDetail,
  getDefaultCab,
  lookupSpkMap,
  lookupSoDtf,
  validateKode,
  save,
};
