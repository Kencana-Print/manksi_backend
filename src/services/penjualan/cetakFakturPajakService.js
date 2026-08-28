const db = require("../../config/database");

// ═══════════════════════════════════════════════════════════
// CETAK FAKTUR PAJAK — SERVICE
// Migrasi dari ufrmCetakFakturPajak.pas (Delphi)
//
// DEVIASI DARI DELPHI:
//   1. Tabel `tampung` DIHAPUS TOTAL. Delphi pakai tabel global ini
//      sbg staging area (delete-all lalu insert ulang) sebelum cetak
//      — di aplikasi single-user Delphi ini aman, tapi di web
//      multi-user ini race condition nyata (user A bisa nimpa staging
//      punya user B yang lagi proses cetak bersamaan). Detail cetak
//      di sini diambil LANGSUNG dari tinv_dtl tanpa staging apapun.
//   2. Padding baris ke-9 (kertas Faktur Pajak fisik biasanya area
//      tetap ~9 baris) DIPINDAH ke frontend/print view — murni
//      concern layout cetak, tidak perlu nyentuh DB sama sekali.
//   3. Simpan `inv_no_fp` dan generate data cetak DIGABUNG jadi satu
//      aksi (klik Cetak), sesuai Delphi Button1Click.
//
// CATATAN: GetCompanyLineSQL (fungsi Delphi utk baris SQL company)
// tidak diketahui isinya dari source yang tersedia — bagian itu
// di-skip di sini, field company diambil langsung dari JOIN tperusahaan.
// ═══════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────
// CEK NOMOR — sesuai Delphi edtNomorExit
// Validasi: invoice harus ada & ber-PPN (inv_sts_ppn=1).
// Mengembalikan info existing inv_no_fp utk warning di frontend
// kalau user mau ganti nomor faktur yg sudah ada sebelumnya.
// ─────────────────────────────────────────────────────────
const checkNomor = async (nomor) => {
  const [[row]] = await db.query(
    `SELECT
       a.inv_nomor, a.inv_sts_ppn, a.inv_no_fp,
       DATE_FORMAT(a.inv_tanggal,'%d-%m-%Y') AS inv_tanggal_fmt,
       c.cus_nama
     FROM tinv_hdr a
     INNER JOIN tcustomer c ON c.cus_kode = a.inv_cus_kode
     WHERE a.inv_nomor = ?`,
    [nomor],
  );

  if (!row) {
    throw new Error("Nomor Penjualan tidak ditemukan.");
  }
  if (Number(row.inv_sts_ppn) !== 1) {
    throw new Error("Invoice ini tidak ada PPN.");
  }

  return {
    Nomor: row.inv_nomor,
    Tanggal: row.inv_tanggal_fmt,
    Customer: row.cus_nama,
    NoFpExisting: row.inv_no_fp || "",
    SudahAdaFaktur: !!row.inv_no_fp,
  };
};

// ─────────────────────────────────────────────────────────
// SAVE + GET DATA CETAK — sesuai Delphi Button1Click
// (insertketampungan dihapus, langsung UPDATE inv_no_fp lalu ambil
// data cetak dari tinv_dtl langsung tanpa staging table)
// ─────────────────────────────────────────────────────────
const saveAndGetDataCetak = async (nomor, noSeri) => {
  if (!nomor) throw new Error("Nomor Penjualan wajib diisi.");
  if (!noSeri || !noSeri.trim()) throw new Error("Nomor Pajak wajib diisi.");

  // Validasi ulang — jaga-jaga kalau endpoint ini dipanggil langsung
  // tanpa lewat checkNomor dulu (defense in depth)
  const [[hdr]] = await db.query(
    `SELECT inv_nomor, inv_sts_ppn FROM tinv_hdr WHERE inv_nomor = ?`,
    [nomor],
  );
  if (!hdr) throw new Error("Nomor Penjualan tidak ditemukan.");
  if (Number(hdr.inv_sts_ppn) !== 1) {
    throw new Error("Invoice ini tidak ada PPN.");
  }

  await db.query(`UPDATE tinv_hdr SET inv_no_fp = ? WHERE inv_nomor = ?`, [
    noSeri.trim(),
    nomor,
  ]);

  return getDataCetak(nomor, noSeri.trim());
};

// ─────────────────────────────────────────────────────────
// GET DATA CETAK — sesuai query Button1Click (tanpa staging tampung)
// ─────────────────────────────────────────────────────────
const getDataCetak = async (nomor, noSeri) => {
  const [[hdr]] = await db.query(
    `SELECT
       a.inv_nomor, a.inv_tanggal, a.inv_ppn,
       a.inv_cus_kode, a.inv_cus_alamat, a.inv_no_fp,
       c.cus_nama, c.cus_kota, c.cus_alamat, c.cus_telp, c.cus_fax,
       c.cus_npwp, c.cus_nama_npwp, c.cus_alamat_npwp, c.cus_kota_npwp,
       p.perush_nama, p.perush_alamat, p.perush_npwp, p.perush_kota,
       p.perush_tgpkp, p.perush_namapemilik, p.perush_jabatan,
       -- Dipertahankan meski tidak dipakai template asli slipfakturpajak.fr3
       p.perush_telp, p.perush_fax, p.perush_kdpos, p.perush_tglnpwp
     FROM tinv_hdr a
     INNER JOIN tcustomer c ON c.cus_kode = a.inv_cus_kode
     INNER JOIN tperusahaan p ON p.perush_kode = a.inv_perush_kode
     WHERE a.inv_nomor = ?`,
    [nomor],
  );
  if (!hdr) throw new Error("Data tidak ditemukan.");

  // Sesuai Delphi Button1Click: ifnull(spk_nama2, brg_name) spk_nama
  const [dtl] = await db.query(
    `SELECT
       d.invd_spk_nomor, d.invd_harga, d.invd_jumlah AS qty,
       IFNULL(s.spk_nama2, b.brg_name) AS spk_nama
     FROM tinv_dtl d
     LEFT JOIN tspk s ON s.spk_nomor = d.invd_spk_nomor
     LEFT JOIN tbarang b ON b.brg_kode = d.invd_spk_nomor
     WHERE d.invd_inv_nomor = ?
     ORDER BY d.invd_sj_nomor DESC`,
    [nomor],
  );

  return {
    header: { ...hdr, NoSeri: noSeri || hdr.inv_no_fp || "" },
    detail: dtl,
  };
};

// ─────────────────────────────────────────────────────────
// SEARCH INVOICE (F1) — sesuai Delphi FormKeyDown edtnomor.
// TIDAK filter inv_sts_pro sama sekali — mencakup Normal, Proforma,
// dan Tak Normal, asal inv_sts_ppn=1. Beda dari InvoiceNormalSearchModal
// (khusus Tak Normal pairing) dan InvProformaSearchModal (sts_pro=1 saja).
// ─────────────────────────────────────────────────────────
const searchInvoice = async (q = "", page = 1, limit = 50) => {
  const limitNum = Number(limit);
  const offset = (Number(page) - 1) * limitNum;
  const like = `%${q}%`;

  let where = `a.inv_sts_ppn = 1`;
  const params = [];

  if (q) {
    where += ` AND (a.inv_nomor LIKE ? OR c.cus_nama LIKE ?)`;
    params.push(like, like);
  }

  const [[{ total }]] = await db.query(
    `SELECT COUNT(*) AS total
     FROM tinv_hdr a
     INNER JOIN tcustomer c ON c.cus_kode = a.inv_cus_kode
     WHERE ${where}`,
    params,
  );

  const [rows] = await db.query(
    `SELECT a.inv_nomor AS Nomor, c.cus_nama AS Customer,
            DATE_FORMAT(a.inv_tanggal,'%d/%m/%Y') AS Tanggal
     FROM tinv_hdr a
     INNER JOIN tcustomer c ON c.cus_kode = a.inv_cus_kode
     WHERE ${where}
     ORDER BY a.inv_tanggal DESC
     LIMIT ? OFFSET ?`,
    [...params, limitNum, offset],
  );
  return { items: rows, total, page: Number(page), limit: limitNum };
};

// ─────────────────────────────────────────────────────────
// HAPUS NOMOR PAJAK — kembalikan inv_no_fp jadi kosong.
// Begitu ini jalan, kolom Faktur_Pajak di Browse Invoice otomatis
// ikut hilang di fetch berikutnya — getBrowse() SELECT langsung dari
// inv_no_fp, tidak ada cache/staging (lihat catatan deviasi Delphi
// #1 di atas file ini: tabel `tampung` sudah dihapus total).
// ─────────────────────────────────────────────────────────
const hapusNomorPajak = async (nomor) => {
  if (!nomor) throw new Error("Nomor Penjualan wajib diisi.");

  const [[hdr]] = await db.query(
    `SELECT inv_nomor, inv_no_fp FROM tinv_hdr WHERE inv_nomor = ?`,
    [nomor],
  );
  if (!hdr) throw new Error("Nomor Penjualan tidak ditemukan.");
  if (!hdr.inv_no_fp) {
    throw new Error("Invoice ini belum punya Nomor Pajak.");
  }

  await db.query(`UPDATE tinv_hdr SET inv_no_fp = '' WHERE inv_nomor = ?`, [
    nomor,
  ]);
};

module.exports = {
  checkNomor,
  saveAndGetDataCetak,
  getDataCetak,
  searchInvoice,
  hapusNomorPajak,
};
