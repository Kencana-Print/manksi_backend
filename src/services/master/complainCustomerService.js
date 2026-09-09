const db = require("../../config/database");
const fs = require("fs");
const path = require("path");

// --- 1. GET BROWSE ---
const getBrowseList = async (query) => {
  const today = new Date();
  const defaultStart = new Date(today.getFullYear(), today.getMonth(), 1)
    .toISOString()
    .substring(0, 10);
  const defaultEnd = today.toISOString().substring(0, 10);

  const startDate = query.startDate || defaultStart;
  const endDate = query.endDate || defaultEnd;

  // ⚠️ Replikasi persis Delphi: filter spk_aktif="Y" HANYA berlaku
  // untuk cabang tspk. Cabang tmemospk SENGAJA tidak difilter aktif
  // sama sekali — jangan disamakan, itu bukan bug di kode asli.
  const sql = `
    SELECT 
      a.tc_nomor                          AS Nomor,
      DATE_FORMAT(a.tc_date, '%Y-%m-%d')  AS TglComplain,
      a.tc_spk_nomor                      AS NoSpkMemo,
      b.cus_nama                          AS Customer,
      xx.divisi                           AS Divisi,
      xx.spk_tipe                         AS Tipe,
      xx.spk_nama                         AS NamaSpk,
      a.tc_jenis                          AS JenisComplain,
      a.tc_description                    AS Uraian,
      a.tc_action                         AS ActionSolution,
      a.tc_ket_div1                       AS KetDiv1,
      a.tc_ket_div2                       AS KetDiv2,
      a.tc_ket_div3                       AS KetDiv3
    FROM tcomplain a
    LEFT JOIN tcustomer b ON b.cus_kode = a.tc_cus_kode
    LEFT JOIN (
      SELECT aa.*, bb.divisi
      FROM (
        SELECT spk_nomor, spk_tanggal, spk_cus_kode, spk_divisi, spk_nama, spk_tipe, 'SPK' AS jenis
        FROM tspk
        WHERE spk_aktif = 'Y'
        UNION ALL
        SELECT mspk_nomor, mspk_tanggal, mspk_cus_kode, mspk_divisi, mspk_nama, mspk_tipe, 'MEMO' AS jenis
        FROM tmemospk
        UNION ALL
        SELECT so_nomor, so_tanggal, so_cus_kode, so_divisi, so_nama, so_tipe, 'SO' AS jenis
        FROM tsalesorder
        WHERE so_aktif = 'Y'
      ) aa
      LEFT JOIN tdivisi bb ON bb.kode = aa.spk_divisi
    ) xx ON xx.spk_nomor = a.tc_spk_nomor
    WHERE a.tc_date >= ? AND a.tc_date <= ?
    ORDER BY a.tc_nomor
  `;

  const [rows] = await db.query(sql, [startDate, endDate]);
  return rows;
};

// --- 2. DELETE COMPLAIN ---
// ⚠️ Sesuai Delphi: DELETE murni, TIDAK ada cek tutup buku (komplain
// bukan transaksi berperiode). Hak akses hapus (cekdelete di Delphi)
// diserahkan ke gate permission menu di level frontend, sama pola
// dengan modul browse lain (mis. Master Bahan).
const deleteComplain = async (nomor) => {
  const [result] = await db.query(`DELETE FROM tcomplain WHERE tc_nomor = ?`, [
    nomor,
  ]);
  if (result.affectedRows === 0) {
    throw new Error("Data Complain tidak ditemukan.");
  }
  return result;
};

// ── Cari file gambar untuk 1 nomor complain, slot 1-3. Cek lokasi
// upload baru dulu (public/images/complain/), fallback ke lokasi
// legacy Delphi (/mnt/image/, tanpa subfolder, sesuai konvensi
// file-gambar route). Return absolute path atau null kalau nggak ada.
const resolveImagePath = (nomor, slot) => {
  const newPath = path.join(
    process.cwd(),
    "public",
    "images",
    "complain",
    `${nomor}-0${slot}.jpg`,
  );
  if (fs.existsSync(newPath)) return newPath;

  const legacyPath = path.join("/mnt", "image", `${nomor}-0${slot}.jpg`);
  if (fs.existsSync(legacyPath)) return legacyPath;

  return null;
};

// ── Data lengkap untuk export (browse + path gambar per baris) ──
const getExportRows = async (query) => {
  const rows = await getBrowseList(query); // reuse fungsi getBrowseList yang sudah ada

  return rows.map((r) => ({
    ...r,
    Images: [1, 2, 3]
      .map((slot) => resolveImagePath(r.Nomor, slot))
      .filter(Boolean),
  }));
};

module.exports = {
  getBrowseList,
  deleteComplain,
  getExportRows, // ⬅ tambahkan ke exports yang sudah ada
};
