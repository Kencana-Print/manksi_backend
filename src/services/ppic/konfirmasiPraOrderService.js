const db = require("../../config/database");
const praOrderFormService = require("../penjualan/praOrderFormService");

// ─────────────────────────────────────────────────────────
// Divisi yang TIDAK butuh konfirmasi PPIC sama sekali — sama
// persis daftar isDivisiTanpaCekPpic di praOrderFormService.
// convertToMintaHarga. Pra Order dari divisi ini otomatis
// dikecualikan dari antrian konfirmasi.
// ─────────────────────────────────────────────────────────
const DIVISI_TANPA_KONFIRMASI = ["MMT"];

// Spanduk (divisi 1) dikonfirmasi tim PRODUKSI; divisi lain oleh PPIC.
// Dicek di service karena checkBagian di route tidak tahu divisi pra order.
const assertBagianDivisi = (divisi, bagian, userKode) => {
  if (String(userKode || "").toUpperCase() === "ADMIN") return;
  const b = String(bagian || "").toUpperCase();
  if (Number(divisi) === 1) {
    if (b !== "PRODUKSI") {
      throw new Error(
        "Pra Order Spanduk hanya bisa dikonfirmasi oleh bagian PRODUKSI.",
      );
    }
  } else if (b !== "PPIC") {
    throw new Error("Pra Order ini hanya bisa dikonfirmasi oleh bagian PPIC.");
  }
};

// --- BROWSE: daftar Pra Order yang butuh/sudah dikonfirmasi PPIC ---
const getBrowse = async ({ startDate, endDate, divisi, status }) => {
  const params = [];
  const phDivisi = DIVISI_TANPA_KONFIRMASI.map(() => "?").join(", ");
  let where = `WHERE UPPER(IFNULL(v.Divisi, '')) NOT IN (${phDivisi})`;
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
       IF(
         h.pro_divisi = 1,
         bsp.brg_nama,
         (SELECT GROUP_CONCAT(m.bj_nama SEPARATOR ' / ')
          FROM tpraorder_bahan b
          LEFT JOIN tbahan_jenis m ON m.bj_kode = b.prob_bahan_kode
          WHERE b.prob_pro_nomor = h.pro_nomor)
       ) AS Bahan,
       h.pro_sumber_bahan AS SumberBahan,
       IF(h.pro_divisi = 1, h.pro_bahan_status, h.pro_status_bahan) AS StatusBahan,
       h.pro_qty_rencana AS QtyRencana,
       h.pro_jml_desain AS JmlDesain,
       h.pro_panjang AS Panjang,
       h.pro_lebar AS Lebar,
       REPLACE(REPLACE(IFNULL(h.pro_ukuran_bebas, ''), CHAR(13), ' '), CHAR(10), ' ') AS KetUkuran,
       h.pro_finishing AS Finishing,
       DATE_FORMAT(h.pro_tgl_kirim, '%Y-%m-%d') AS TglKirim,
       DATE_FORMAT(h.pro_tgl_so_estimasi, '%Y-%m-%d') AS TglEstimasiSO,
       DATE_FORMAT(h.pro_tgl_map, '%Y-%m-%d') AS TglEstimasiMAP,
       h.pro_status_ppic AS StatusPpic,
       h.pro_catatan_ppic AS CatatanPpic,
       h.pro_syarat_ketentuan AS SyaratKetentuan,
       h.pro_status AS Status,
       h.pro_mh_nomor AS NomorMH,
       DATE_FORMAT(h.date_create, '%Y-%m-%d %H:%i') AS Created,
       h.user_create AS UserCreate
     FROM tpraorder_hdr h
     LEFT JOIN tdivisi v ON v.kode = h.pro_divisi
     LEFT JOIN tsales s ON s.sal_kode = h.pro_sal_kode
     LEFT JOIN tbarang_new bsp ON bsp.brg_kode = h.pro_brg_kode
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
const confirmKesanggupan = async (
  nomor,
  status,
  catatan,
  userKode,
  { tglSoEstimasi, tglMap, bagian, syaratKetentuan, kirim, kirimKet } = {},
) => {
  if (!["SANGGUP", "TIDAK SANGGUP"].includes(status)) {
    throw new Error("Status konfirmasi tidak valid.");
  }
  if (status === "TIDAK SANGGUP" && !catatan?.trim()) {
    throw new Error("Catatan wajib diisi untuk status Tidak Sanggup.");
  }
  if (status === "SANGGUP" && (!tglSoEstimasi || !tglMap)) {
    throw new Error(
      "Tanggal Estimasi SO dan Estimasi MAP wajib diisi untuk status Sanggup.",
    );
  }
  const [[hdr]] = await db.query(
    `SELECT pro_divisi, pro_bahan_status FROM tpraorder_hdr WHERE pro_nomor = ?`,
    [nomor],
  );
  if (!hdr) throw new Error("Pra Order tidak ditemukan.");
  assertBagianDivisi(hdr.pro_divisi, bagian, userKode);
  if (
    status === "SANGGUP" &&
    Number(hdr.pro_divisi) === 1 &&
    !hdr.pro_bahan_status
  ) {
    throw new Error(
      "Status bahan Spanduk wajib dikonfirmasi (READY / TIDAK READY) sebelum Sanggup.",
    );
  }
  if (status === "SANGGUP") {
    const sk = String(syaratKetentuan ?? "").trim();
    if (sk.length > 500) {
      throw new Error("Syarat & Ketentuan maksimal 500 karakter.");
    }
    if (!["CLOSED", "PARSIAL"].includes(kirim)) {
      throw new Error("Pilih pengiriman: Closed atau Parsial.");
    }
    const ketKirim = kirim === "PARSIAL" ? String(kirimKet ?? "").trim() : "";
    if (kirim === "PARSIAL" && !ketKirim) {
      throw new Error("Keterangan wajib diisi untuk pengiriman Parsial.");
    }
    if (ketKirim.length > 255) {
      throw new Error("Keterangan kirim maksimal 255 karakter.");
    }
    // Disimpan sebelum setStatusPpic: kalau setStatusPpic gagal, order masih
    // PENDING dan nilai tertimpa saat konfirmasi ulang. Filter PENDING mencegah
    // data order yang sudah dikonfirmasi tertimpa lewat pemanggilan API langsung.
    await db.query(
      `UPDATE tpraorder_hdr
       SET pro_syarat_ketentuan = ?, pro_kirim = ?, pro_kirim_ket = ?
       WHERE pro_nomor = ? AND pro_status_ppic = 'PENDING'`,
      [sk, kirim, ketKirim, nomor],
    );
  }
  await praOrderFormService.setStatusPpic(nomor, status, catatan, userKode, {
    tglSoEstimasi,
    tglMap,
  });
  return true;
};

// --- KONFIRMASI STATUS PER BAHAN (opsional, dipanggil dari panel detail) ---
const confirmStatusBahan = async (probId, status) => {
  await praOrderFormService.setStatusBahan(probId, status);
  return true;
};

// --- KONFIRMASI STATUS BAHAN SPANDUK (level header, 1 bahan per pra order) ---
const confirmStatusBahanSpanduk = async (nomor, status, userKode, bagian) => {
  if (!["READY", "TIDAK READY"].includes(status)) {
    throw new Error("Status bahan tidak valid.");
  }
  const [[hdr]] = await db.query(
    `SELECT pro_divisi, pro_brg_kode, pro_mh_nomor
     FROM tpraorder_hdr WHERE pro_nomor = ?`,
    [nomor],
  );
  if (!hdr) throw new Error("Pra Order tidak ditemukan.");
  if (Number(hdr.pro_divisi) !== 1) {
    throw new Error("Konfirmasi bahan ini hanya untuk divisi Spanduk.");
  }
  assertBagianDivisi(hdr.pro_divisi, bagian, userKode);
  if (!hdr.pro_brg_kode) {
    throw new Error("Pra Order ini belum memiliki bahan.");
  }
  if (hdr.pro_mh_nomor) {
    throw new Error("Pra Order sudah dikonversi ke Minta Harga.");
  }
  await db.query(
    `UPDATE tpraorder_hdr
     SET pro_bahan_status = ?, pro_bahan_user = ?, pro_bahan_tgl = NOW()
     WHERE pro_nomor = ?`,
    [status, userKode, nomor],
  );
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
  confirmStatusBahanSpanduk,
  getDivisi,
};
