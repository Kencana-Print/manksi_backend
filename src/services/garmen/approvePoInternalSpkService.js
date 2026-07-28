const db = require("../../config/database");

const isHeadOffice = (userCabang) => !userCabang || userCabang === "HO-";

// ─────────────────────────────────────────────────────────
// MASTER — replikasi persis btnRefreshClick(). ⚠️ CATATAN PENTING:
// filter cabang di sini pakai o.poi_cab (Gudang ASAL milik PO
// referensi), BUKAN h.poisj_cab (Cab milik SJ itu sendiri) — beda
// semantik dari getBrowseList di sjPoInternalSpkService.js (Browse SJ
// biasa) yang filter pakai h.poisj_cab. Direplikasi persis apa adanya
// sesuai source Delphi form approval ini, bukan salah ketik.
// ─────────────────────────────────────────────────────────
const getBrowseList = async (query, userCabang) => {
  const today = new Date();
  const defaultStart = new Date(today.getFullYear(), today.getMonth(), 1)
    .toISOString()
    .substring(0, 10);
  const defaultEnd = today.toISOString().substring(0, 10);

  const startDate = query.startDate || defaultStart;
  const endDate = query.endDate || defaultEnd;

  // ⚠️ DEVIASI DISENGAJA dari Delphi: "hanya belum approve" di sini
  // dijadikan filter TAMBAHAN yang tetap menghormati rentang tanggal
  // (bukan MENGGANTI TOTAL filter tanggal seperti btnShowClick asli,
  // yang membuang WHERE tanggal sepenuhnya). Lebih predictable buat
  // user. Konfirmasi kalau maunya replikasi persis Delphi.
  const onlyNotApproved =
    query.onlyNotApproved === "true" || query.onlyNotApproved === true;

  const params = [startDate, endDate];
  let extraFilter = "";

  if (!isHeadOffice(userCabang)) {
    extraFilter += ` AND o.poi_cab = ?`;
    params.push(userCabang);
  }
  if (onlyNotApproved) {
    extraFilter += ` AND h.poisj_approve = 'N'`;
  }

  const sql = `
    SELECT
      h.poisj_nomor AS Nomor,
      DATE_FORMAT(h.poisj_tanggal, '%Y-%m-%d') AS Tanggal,
      h.poisj_nomorpo AS NomorPO,
      h.poisj_spk_nomor AS SPK,
      j.jasa_nama AS Jasa,
      h.poisj_cab AS Dari,
      o.poi_cab AS Tujuan,
      h.poisj_ket AS Keterangan,
      h.poisj_approve AS Approved
    FROM tpointernalsj_hdr h
    LEFT JOIN tpointernal_hdr o ON o.poi_nomor = h.poisj_nomorpo
    LEFT JOIN tjasa j ON j.jasa_kode = o.poi_jasa_kode
    WHERE h.poisj_tanggal >= ? AND h.poisj_tanggal <= ?
      ${extraFilter}
    ORDER BY h.poisj_nomor
  `;

  const [rows] = await db.query(sql, params);
  return rows;
};

// ─────────────────────────────────────────────────────────
// DETAIL — dipanggil on-demand saat row di-expand. Pakai kolom
// lengkap (Size + BsLini/BsSablon/BsKain), konsisten dengan variasi
// query btnRefreshClick — bukan versi ringkas btnShowClick (yang cuma
// Kode/Komponen/Satuan/Jumlah). Strictly nampilin LEBIH BANYAK info,
// gak menghilangkan apa pun, jadi aman dipakai buat kedua mode filter.
// ─────────────────────────────────────────────────────────
const getDetailByNomor = async (nomor) => {
  const sql = `
    SELECT
      d.poisjd_nomor AS Nomor,
      d.poisjd_bhn_kode AS Kode,
      b.Bhn_Name AS Komponen,
      b.Bhn_satuan AS Satuan,
      d.poisjd_size AS Size,
      d.poisjd_jumlah AS Jumlah,
      d.poisjd_bs AS BsLini,
      d.poisjd_sablon AS BsSablon,
      d.poisjd_kain AS BsKain
    FROM tpointernalsj_dtl d
    LEFT JOIN tbahan b ON b.Bhn_kode = d.poisjd_bhn_kode
    WHERE d.poisjd_nomor = ?
    ORDER BY d.poisjd_bhn_kode
  `;
  const [rows] = await db.query(sql, [nomor]);
  return rows;
};

// ─────────────────────────────────────────────────────────
// CEK BOLEH DI-APPROVE — replikasi persis 2 gate awal btnApvClick():
// 1) flag poisj_approve harus masih 'N'
// 2) tmutasiproduksi_hdr TIDAK BOLEH sudah ada baris dengan
//    mph_nomor_opr = nomor SJ ini (double-check independen dari flag
//    approve, jaga-jaga kalau dua data itu somehow gak sinkron)
//
// ⚠️ Ini CUMA validasi gate pembuka. Proses approve SEBENARNYA (yang
// generate Mutasi Produksi baru dari ufrmPOISJapv2) BELUM
// diimplementasikan — modul terpisah yang jauh lebih besar, masih
// nunggu klarifikasi (lihat chat).
// ─────────────────────────────────────────────────────────
const checkApprovable = async (nomor) => {
  const [rows] = await db.query(
    `SELECT poisj_approve FROM tpointernalsj_hdr WHERE poisj_nomor = ?`,
    [nomor],
  );
  if (rows.length === 0) {
    return { allowed: false, message: "Data tidak ditemukan." };
  }
  if (rows[0].poisj_approve === "Y") {
    return { allowed: false, message: "Sudah Approve." };
  }

  const [mpRows] = await db.query(
    `SELECT 1 FROM tmutasiproduksi_hdr WHERE mph_nomor_opr = ? LIMIT 1`,
    [nomor],
  );
  if (mpRows.length > 0) {
    return { allowed: false, message: "Sudah Approve." };
  }

  return { allowed: true, message: "" };
};

module.exports = {
  getBrowseList,
  getDetailByNomor,
  checkApprovable,
};
