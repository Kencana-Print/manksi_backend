const db = require("../../config/database");
const praOrderFormService = require("../penjualan/praOrderFormService");

// ─────────────────────────────────────────────────────────
// Divisi yang TIDAK butuh konfirmasi PPIC sama sekali — sama
// persis daftar isDivisiTanpaCekPpic di praOrderFormService.
// convertToMintaHarga. Pra Order dari divisi ini otomatis
// dikecualikan dari antrian konfirmasi.
// ─────────────────────────────────────────────────────────
const DIVISI_TANPA_KONFIRMASI = ["SPANDUK", "MMT"];

// --- BROWSE: daftar Pra Order yang butuh/sudah dikonfirmasi PPIC ---
const getBrowse = async ({ startDate, endDate, divisi, status }) => {
  const params = [];
  let where = `WHERE UPPER(IFNULL(v.Divisi, '')) NOT IN (?, ?)`;
  params.push(...DIVISI_TANPA_KONFIRMASI);

  if (startDate && endDate) {
    where += ` AND h.pro_tanggal BETWEEN ? AND ?`;
    params.push(startDate, endDate);
  }
  if (divisi && divisi !== "0") {
    where += ` AND h.pro_divisi = ?`;
    params.push(divisi);
  }
  // Default: cuma yang PENDING (perlu tindakan). Kirim status=ALL untuk
  // lihat semua, atau status spesifik (SANGGUP/TIDAK SANGGUP) untuk histori.
  if (!status || status === "PENDING") {
    where += ` AND h.pro_status_ppic = 'PENDING'`;
  } else if (status !== "ALL") {
    where += ` AND h.pro_status_ppic = ?`;
    params.push(status);
  }

  const [rows] = await db.query(
    `SELECT
       h.pro_nomor AS Nomor,
       v.Divisi AS Divisi,
       DATE_FORMAT(h.pro_tanggal, '%Y-%m-%d') AS Tanggal,
       h.pro_cus_kode AS CusKode,
       h.pro_cus_nama AS Customer,
       s.sal_nama AS Sales,
       h.pro_nama_pekerjaan AS NamaPekerjaan,
       (SELECT GROUP_CONCAT(m.bj_nama SEPARATOR ' / ')
        FROM tpraorder_bahan b
        LEFT JOIN tbahan_jenis m ON m.bj_kode = b.prob_bahan_kode
        WHERE b.prob_pro_nomor = h.pro_nomor) AS Bahan,
       h.pro_qty_rencana AS QtyRencana,
       DATE_FORMAT(h.pro_tgl_kirim, '%Y-%m-%d') AS TglKirim,
       h.pro_status_ppic AS StatusPpic,
       h.pro_catatan_ppic AS CatatanPpic,
       h.pro_status AS Status,
       h.pro_mh_nomor AS NomorMH,
       DATE_FORMAT(h.date_create, '%Y-%m-%d %H:%i') AS Created,
       h.user_create AS UserCreate
     FROM tpraorder_hdr h
     LEFT JOIN tdivisi v ON v.kode = h.pro_divisi
     LEFT JOIN tsales s ON s.sal_kode = h.pro_sal_kode
     ${where}
     ORDER BY h.pro_tanggal DESC, h.pro_nomor DESC`,
    params,
  );
  return rows;
};

// --- DETAIL/PREVIEW: dipakai panel konfirmasi ---
// Reuse getById dari praOrderFormService — sama persis struktur data
// (header + bahan + ukuran + gambar) yang dipakai form Pra Order,
// supaya preview di sisi PPIC 1:1 dengan apa yang MO input.
const getDetail = async (nomor) => {
  return praOrderFormService.getById(nomor);
};

// --- KONFIRMASI KESANGGUPAN ---
const confirmKesanggupan = async (nomor, status, catatan, userKode) => {
  if (!["SANGGUP", "TIDAK SANGGUP"].includes(status)) {
    throw new Error("Status konfirmasi tidak valid.");
  }
  if (status === "TIDAK SANGGUP" && !catatan?.trim()) {
    throw new Error("Catatan wajib diisi untuk status Tidak Sanggup.");
  }
  await praOrderFormService.setStatusPpic(nomor, status, catatan, userKode);
  return true;
};

// --- KONFIRMASI STATUS PER BAHAN (opsional, dipanggil dari panel detail) ---
const confirmStatusBahan = async (probId, status) => {
  await praOrderFormService.setStatusBahan(probId, status);
  return true;
};

// --- LOOKUP DIVISI (untuk dropdown filter) ---
// Sama pola dengan comment di PraOrderView.vue — buang kode "6" (FIT U).
const getDivisi = async () => {
  const [rows] = await db.query(
    `SELECT kode AS Kode, Divisi AS Nama FROM tdivisi WHERE kode <> 6 ORDER BY kode`,
  );
  return rows;
};

module.exports = {
  getBrowse,
  getDetail,
  confirmKesanggupan,
  confirmStatusBahan,
  getDivisi,
};
