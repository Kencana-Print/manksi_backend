const db = require("../../../config/database");

// ─────────────────────────────────────────────
// Helper: bangun klausa afilter status (persis logic cbbFilter Delphi)
// status: "ALL" | "OUTSTANDING" (jumlah > kirim) | "SELESAI" (jumlah <= kirim)
// ─────────────────────────────────────────────
const buildStatusFilter = (status, jumlahCol, kirimCol) => {
  if (status === "OUTSTANDING") return ` AND ${jumlahCol} > ${kirimCol}`;
  if (status === "SELESAI") return ` AND ${jumlahCol} <= ${kirimCol}`;
  return "";
};

// ─────────────────────────────────────────────
// MASTER — cabang MAP (tmemospk). Tidak ada kolom JadiP1/JadiP4
// (quirk Delphi: subquery stok jadi hanya ada di cabang tspk).
// ⚠️ Kolom Divisi asumsi td.divisi (belum terverifikasi 100% —
// konfirmasi ke user).
// ─────────────────────────────────────────────
const getBrowseMap = async (
  startDate,
  endDate,
  spkPrefix,
  perushPrefix,
  status,
  divisi,
  canLihatCus,
) => {
  const custCol = canLihatCus ? "c.cus_nama AS Customer," : `"" AS Customer,`;
  let sql = `
    SELECT
      td.divisi AS Divisi,
      DATE_FORMAT(s.mspk_tanggal, '%d-%m-%Y') AS Tanggal,
      DATE_FORMAT(s.mspk_dateline, '%d-%m-%Y') AS Dateline,
      s.mspk_nama AS Nama,
      LEFT(s.mspk_ukuran, LOCATE('X', s.mspk_ukuran) - 1) AS Panjang,
      REPLACE(REPLACE(SUBSTRING(s.mspk_ukuran, LOCATE('X', s.mspk_ukuran), LENGTH(s.mspk_ukuran)), 'X', ''), 'M', '') AS Lebar,
      s.mspk_nomor AS Nomor,
      ${custCol}
      s.mspk_jo_kode AS Jenis,
      s.mspk_kain AS Kain,
      s.mspk_jumlah AS JmlOrder,
      s.mspk_jumlah_jadi AS Jadi,
      NULL AS JadiP1,
      NULL AS JadiP4,
      s.mspk_jumlah_kirim AS Kirim
    FROM tmemospk s
    INNER JOIN tcustomer c ON s.mspk_cus_kode = c.cus_kode
    LEFT JOIN tdivisi td ON td.kode = s.mspk_divisi
    WHERE s.mspk_divisi IN (3, 4, 6)
      AND s.mspk_nomor LIKE ?
      AND s.mspk_tanggal >= ? AND s.mspk_tanggal <= ?
      AND s.mspk_perush_kode LIKE ?
  `;
  const params = [`${spkPrefix}%`, startDate, endDate, `${perushPrefix}%`];
  sql += buildStatusFilter(status, "s.mspk_jumlah", "s.mspk_jumlah_kirim");
  if (divisi && divisi !== "0" && divisi !== "ALL") {
    sql += ` AND s.mspk_divisi = ?`;
    params.push(divisi);
  }
  sql += ` ORDER BY s.mspk_tanggal`;
  const [rows] = await db.query(sql, params);
  return rows;
};

// ─────────────────────────────────────────────
// MASTER — cabang SPK (tspk). Punya kolom JadiP1/JadiP4 dari
// tmasterstok_jadi (quirk penamaan: GJ002→"P1", GJ001→"P4").
// ─────────────────────────────────────────────
const getBrowseSpk = async (
  startDate,
  endDate,
  spkPrefix,
  perushPrefix,
  status,
  divisi,
  canLihatCus,
) => {
  const custCol = canLihatCus ? "c.cus_nama AS Customer," : `"" AS Customer,`;
  let sql = `
    SELECT
      td.divisi AS Divisi,
      DATE_FORMAT(s.spk_tanggal, '%d-%m-%Y') AS Tanggal,
      DATE_FORMAT(s.spk_dateline, '%d-%m-%Y') AS Dateline,
      s.spk_nama AS Nama,
      LEFT(s.spk_ukuran, LOCATE('X', s.spk_ukuran) - 1) AS Panjang,
      REPLACE(REPLACE(SUBSTRING(s.spk_ukuran, LOCATE('X', s.spk_ukuran), LENGTH(s.spk_ukuran)), 'X', ''), 'M', '') AS Lebar,
      s.spk_nomor AS Nomor,
      ${custCol}
      s.spk_jo_kode AS Jenis,
      s.spk_kain AS Kain,
      s.spk_jumlah AS JmlOrder,
      s.spk_jumlah_jadi AS Jadi,
      IFNULL((
        SELECT SUM(mst_stok_in) FROM tmasterstok_jadi
        WHERE mst_tanggal >= ?
          AND LEFT(mst_noreferensi, 4) = 'STBJ'
          AND mst_gdg_kode = 'GJ002'
          AND mst_brg_kode = s.spk_nomor
      ), 0) AS JadiP1,
      IFNULL((
        SELECT SUM(mst_stok_in) FROM tmasterstok_jadi
        WHERE mst_tanggal >= ?
          AND LEFT(mst_noreferensi, 4) = 'STBJ'
          AND mst_gdg_kode = 'GJ001'
          AND mst_brg_kode = s.spk_nomor
      ), 0) AS JadiP4,
      s.spk_jumlah_kirim AS Kirim
    FROM tspk s
    INNER JOIN tcustomer c ON s.spk_cus_kode = c.cus_kode
    LEFT JOIN tsales sl ON sl.sal_kode = s.spk_sal_kode
    LEFT JOIN tdivisi td ON td.kode = s.spk_divisi
    WHERE s.spk_divisi IN (3, 4, 6)
      AND s.spk_aktif = 'Y'
      AND s.spk_nomor LIKE ?
      AND s.spk_tanggal >= ? AND s.spk_tanggal <= ?
      AND s.spk_perush_kode LIKE ?
  `;
  const params = [
    startDate,
    startDate,
    `${spkPrefix}%`,
    startDate,
    endDate,
    `${perushPrefix}%`,
  ];
  sql += buildStatusFilter(status, "s.spk_jumlah", "s.spk_jumlah_kirim");
  if (divisi && divisi !== "0" && divisi !== "ALL") {
    sql += ` AND s.spk_divisi = ?`;
    params.push(divisi);
  }
  sql += ` ORDER BY s.spk_tanggal`;
  const [rows] = await db.query(sql, params);
  return rows;
};

const getBrowse = async (
  startDate,
  endDate,
  spk = "",
  perusahaan = "",
  status = "ALL",
  divisi = "ALL",
  isMap = false,
  canLihatCus = false,
) =>
  isMap
    ? getBrowseMap(
        startDate,
        endDate,
        spk,
        perusahaan,
        status,
        divisi,
        canLihatCus,
      )
    : getBrowseSpk(
        startDate,
        endDate,
        spk,
        perusahaan,
        status,
        divisi,
        canLihatCus,
      );

// ─────────────────────────────────────────────
// DETAIL STBJ — per SPK. ⚠️ QUIRK: Delphi selalu INNER JOIN ke tspk
// meski kolomnya tak dipakai — efeknya STBJ cuma muncul kalau nomor
// SPK ADA row-nya di tspk, walau master-nya dari tmemospk (MAP).
// Dipertahankan persis, jangan diperbaiki jadi LEFT JOIN.
// ─────────────────────────────────────────────
const getStbjDetail = async (spk) => {
  const sql = `
    SELECT
      h.STBJ_nomor AS NomorStbj,
      DATE_FORMAT(h.STBJ_tanggal, '%Y-%m-%d') AS TglStbj,
      d.STBJd_keterangan AS Keterangan,
      d.STBJd_jumlah AS Jumlah,
      g.gdg_nama AS GudangJadi
    FROM tstbj_hdr h
    INNER JOIN tstbj_dtl d ON h.STBJ_nomor = d.STBJd_STBJ_nomor
    INNER JOIN tspk sp ON d.STBJd_spk_nomor = sp.spk_nomor
    LEFT JOIN tgudang g ON g.gdg_kode = h.STBJ_gdg_kode
    WHERE d.STBJd_spk_nomor = ?
  `;
  const [rows] = await db.query(sql, [spk]);
  return rows;
};

// ─────────────────────────────────────────────
// DETAIL SJ — per SPK. ⚠️ QUIRK: kondisi tambahan
// LEFT(sjd_spk_nomor,2)=MID(sj_nomor,4,2) — cocokkan 2 karakter
// pertama SPK dengan karakter ke-4&5 nomor SJ. Dipertahankan persis.
// ─────────────────────────────────────────────
const getSjDetail = async (spk) => {
  const sql = `
    SELECT
      h.sj_nomor AS NomorSj,
      DATE_FORMAT(h.sj_tanggal, '%Y-%m-%d') AS TglSj,
      g.gdg_nama AS Gudang,
      d.sjd_jumlah AS Jumlah,
      h.sj_alamat_customer AS Alamat,
      h.sj_kota_customer AS Kota
    FROM tsj_hdr h
    INNER JOIN tgudang g ON h.sj_gdg_kode = g.gdg_kode
    INNER JOIN tsj_dtl d
      ON h.sj_nomor = d.sjd_sj_nomor
      AND d.sjd_spk_nomor = ?
      AND LEFT(d.sjd_spk_nomor, 2) = MID(h.sj_nomor, 4, 2)
    WHERE h.sj_approve <> 2
  `;
  const [rows] = await db.query(sql, [spk]);
  return rows;
};

const getDetail = async (spk) => {
  const [stbj, sj] = await Promise.all([getStbjDetail(spk), getSjDetail(spk)]);
  return { stbj, sj };
};

// ─────────────────────────────────────────────
// ALL DETAIL — gabungan detail semua SPK sesuai filter master,
// dipisah 2 array (stbj, sj) dengan info SPK/Nama menempel
// ─────────────────────────────────────────────
const getAllDetail = async (
  startDate,
  endDate,
  spk = "",
  perusahaan = "",
  status = "ALL",
  divisi = "ALL",
  isMap = false,
  canLihatCus = false,
) => {
  const master = await getBrowse(
    startDate,
    endDate,
    spk,
    perusahaan,
    status,
    divisi,
    isMap,
    canLihatCus,
  );
  const stbjResult = [];
  const sjResult = [];
  for (const m of master) {
    const { stbj, sj } = await getDetail(m.Nomor);
    for (const d of stbj) {
      stbjResult.push({
        Spk: m.Nomor,
        Nama: m.Nama,
        Customer: m.Customer,
        ...d,
      });
    }
    for (const d of sj) {
      sjResult.push({ Spk: m.Nomor, Nama: m.Nama, Customer: m.Customer, ...d });
    }
  }
  return { stbj: stbjResult, sj: sjResult };
};

module.exports = {
  getBrowse,
  getDetail,
  getAllDetail,
};
