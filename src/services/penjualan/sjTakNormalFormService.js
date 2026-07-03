const db = require("../../config/database");

// ═══════════════════════════════════════════════════════════
// SURAT JALAN TAK NORMAL — FORM SERVICE
// Migrasi dari ufrmSJBayangan.pas (Delphi)
// CATATAN PENTING:
//   - Nomor SJ MANUAL (tidak ada generate), wajib diisi user dulu.
//   - Tabel terpisah: tsj_hdr_bayangan / tsj_dtl_bayangan.
//   - TIDAK ADA harga/nominal, TIDAK ADA validasi kurang/tutup buku/
//     PIN5 sama sekali di modul ini.
//   - sjd_nourut TIDAK dipakai di tsj_dtl_bayangan (beda dari SJ
//     normal/PraSJ) — diikuti apa adanya.
// ═══════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────
// CEK NOMOR — sesuai Delphi edtNomorExit -> loaddataall
// TIDAK melempar error kalau tidak ketemu (itu artinya "nomor baru",
// bukan "nomor tidak valid" — beda dari pola getById modul lain).
// ─────────────────────────────────────────────────────────
const checkNomor = async (nomor) => {
  const [[hdr]] = await db.query(
    `SELECT
       a.sj_nomor, DATE_FORMAT(a.sj_tanggal,'%Y-%m-%d') AS sj_tanggal,
       a.sj_divisi, a.sj_keterangan,
       a.sj_perush_kode, p.perush_nama,
       a.sj_cus_kode, c.cus_nama, c.cus_alamat, c.cus_kota,
       a.sj_alamat_customer, a.sj_kota_customer,
       a.sj_gdg_kode, g.gdg_nama,
       a.sj_inv_pro
     FROM tsj_hdr_bayangan a
     INNER JOIN tperusahaan p ON p.perush_kode = a.sj_perush_kode
     INNER JOIN tcustomer c ON c.cus_kode = a.sj_cus_kode
     LEFT JOIN tgudang g ON g.gdg_kode = a.sj_gdg_kode
     WHERE a.sj_nomor = ?`,
    [nomor],
  );

  if (!hdr) {
    return { exists: false };
  }

  const [dtl] = await db.query(
    `SELECT
       d.sjd_spk_nomor, d.sjd_ukuran, d.sjd_jumlah, d.sjd_koli, d.sjd_keterangan,
       IFNULL(s.spk_nama, b.brg_name) AS nama_barang,
       IFNULL(s.spk_jo_kode, '') AS jenis_order
     FROM tsj_dtl_bayangan d
     LEFT JOIN tspk s ON s.spk_nomor = d.sjd_spk_nomor
     LEFT JOIN tbarang b ON b.brg_kode = d.sjd_spk_nomor
     WHERE d.sjd_sj_nomor = ?`,
    [nomor],
  );

  return { exists: true, header: hdr, detail: dtl };
};

// ─────────────────────────────────────────────────────────
// LOAD DETAIL BARANG — sesuai Delphi loaddatadetail
// Ukuran HANYA diisi kalau divisi='1' (Spanduk), selain itu kosong.
// Tidak ada Harga sama sekali di modul ini.
// ─────────────────────────────────────────────────────────
const loadBarangDetail = async (kode, divisi) => {
  const [[row]] = await db.query(
    `SELECT b.brg_kode, IFNULL(s.spk_nama2, b.brg_name) AS nama,
            b.brg_ukuran, IFNULL(s.spk_jo_kode, '') AS jenis_order
     FROM tbarang b
     LEFT JOIN tspk s ON s.spk_nomor = b.brg_kode AND s.spk_aktif = 'Y'
     WHERE b.brg_kode = ?`,
    [kode],
  );
  if (!row) throw new Error("Barang Tidak di temukan");

  const divisiStr = String(divisi).charAt(0);
  return {
    Kode: row.brg_kode,
    Nama: row.nama,
    Ukuran: divisiStr === "1" ? row.brg_ukuran : "",
    JenisOrder: row.jenis_order,
    Jumlah: 0,
    Koli: 0,
  };
};

// ─────────────────────────────────────────────────────────
// GET CUSTOMER SPK — helper untuk cek mismatch customer vs baris
// pertama grid, sesuai Delphi edtCusKodeExit:
//   getnama('tspk','spk_nomor',GridDetail.Cells[1,1],'spk_cus_kode')
// ─────────────────────────────────────────────────────────
const getSpkCustomer = async (kode) => {
  if (!kode) return "";
  const [[row]] = await db.query(
    `SELECT spk_cus_kode FROM tspk WHERE spk_nomor = ?`,
    [kode],
  );
  return row?.spk_cus_kode || "";
};

// ─────────────────────────────────────────────────────────
// CUSTOMER INFO — sesuai Delphi edtCusKodeExit (branch normal)
// ─────────────────────────────────────────────────────────
const getCustomerInfo = async (kode) => {
  const [[row]] = await db.query(
    `SELECT cus_kode, cus_nama, cus_alamat, cus_kota, cus_aktif
     FROM tcustomer WHERE cus_kode = ?`,
    [kode],
  );
  if (!row) throw new Error("Kode tidak ditemukan");
  if (row.cus_aktif === 1) throw new Error("Status pasif.");
  return row;
};

// ─────────────────────────────────────────────────────────
// SEARCH PERUSAHAAN
// ─────────────────────────────────────────────────────────
const searchPerusahaan = async (q = "") => {
  const like = `%${q}%`;
  const [rows] = await db.query(
    `SELECT perush_kode, perush_nama
     FROM tperusahaan
     WHERE perush_kode LIKE ? OR perush_nama LIKE ?
     ORDER BY perush_kode
     LIMIT 50`,
    [like, like],
  );
  return rows;
};

// ─────────────────────────────────────────────────────────
// GET DIVISI LIST
// ─────────────────────────────────────────────────────────
const getDivisiList = async () => {
  const [rows] = await db.query(
    `SELECT kode, divisi AS nama FROM tdivisi WHERE kode <> 0 ORDER BY kode`,
  );
  return rows;
};

// ─────────────────────────────────────────────────────────
// SEARCH BARANG — MODE A: InvPro kosong
// Sesuai Delphi: tbarang WHERE brg_divisi=[divisi], TANPA cek customer.
// ─────────────────────────────────────────────────────────
const searchBarangByDivisi = async (divisi, q = "", page = 1, limit = 50) => {
  const divisiStr = String(divisi).charAt(0);
  const limitNum = Number(limit);
  const offset = (Number(page) - 1) * limitNum;
  const like = `%${q}%`;

  let where = `b.brg_divisi = ?`;
  const params = [divisiStr];

  if (q) {
    where += ` AND (b.brg_kode LIKE ? OR b.brg_name LIKE ?)`;
    params.push(like, like);
  }

  const [[{ total }]] = await db.query(
    `SELECT COUNT(*) AS total FROM tbarang b WHERE ${where}`,
    params,
  );

  const [rows] = await db.query(
    `SELECT b.brg_kode AS Kode, b.brg_name AS Nama,
            b.brg_ukuran AS Ukuran, b.brg_harga AS Harga
     FROM tbarang b
     WHERE ${where}
     ORDER BY b.brg_kode
     LIMIT ? OFFSET ?`,
    [...params, limitNum, offset],
  );
  return { items: rows, total, page: Number(page), limit: limitNum };
};

// ─────────────────────────────────────────────────────────
// SEARCH BARANG — MODE B: InvPro terisi
// Sesuai Delphi: HANYA barang yang tercatat di tinv_dtl milik invoice
// proforma tsb (invd_inv_nomor spesifik), bukan katalog umum customer.
// ─────────────────────────────────────────────────────────
const searchBarangByInvPro = async (
  invPro,
  cusKode,
  divisi,
  q = "",
  page = 1,
  limit = 50,
) => {
  const divisiStr = String(divisi).charAt(0);
  const limitNum = Number(limit);
  const offset = (Number(page) - 1) * limitNum;
  const like = `%${q}%`;

  let where = `s.spk_aktif = 'Y' AND s.spk_cus_kode = ? AND s.spk_divisi = ? AND d.invd_inv_nomor = ?`;
  const params = [cusKode, divisiStr, invPro];

  if (q) {
    where += ` AND (s.spk_nomor LIKE ? OR s.spk_nama LIKE ?)`;
    params.push(like, like);
  }

  const [[{ total }]] = await db.query(
    `SELECT COUNT(*) AS total
     FROM tspk s
     INNER JOIN tinv_dtl d ON d.invd_spk_nomor = s.spk_nomor
     WHERE ${where}`,
    params,
  );

  const [rows] = await db.query(
    `SELECT s.spk_nomor AS Kode, s.spk_nama AS Nama,
            s.spk_ukuran AS Ukuran, 0 AS Harga
     FROM tspk s
     INNER JOIN tinv_dtl d ON d.invd_spk_nomor = s.spk_nomor
     WHERE ${where}
     ORDER BY s.spk_tanggal DESC
     LIMIT ? OFFSET ?`,
    [...params, limitNum, offset],
  );
  return { items: rows, total, page: Number(page), limit: limitNum };
};

// ─────────────────────────────────────────────────────────
// GET DATA CETAK — sesuai Delphi doslipsj (query dasar TTSReport
// 'SJ3'). Layout visual report .fr3 tidak tersedia sumbernya —
// direplikasi dari referensi gambar, lihat catatan di frontend.
// ─────────────────────────────────────────────────────────
const getDataCetak = async (nomor) => {
  const [[hdr]] = await db.query(
    `SELECT
       h.sj_nomor, DATE_FORMAT(h.sj_tanggal,'%d-%m-%Y') AS sj_tanggal_fmt,
       h.sj_keterangan,
       h.sj_alamat_customer, h.sj_kota_customer,
       p.perush_nama, p.perush_alamat, p.perush_kota,
       p.perush_telp, p.perush_fax, p.perush_email,
       c.cus_nama, c.cus_alamat, c.cus_kota,
       DATE_FORMAT(h.date_create,'%d-%m-%Y %T') AS created
     FROM tsj_hdr_bayangan h
     INNER JOIN tcustomer c ON c.cus_kode = h.sj_cus_kode
     INNER JOIN tperusahaan p ON p.perush_kode = h.sj_perush_kode
     WHERE h.sj_nomor = ?`,
    [nomor],
  );
  if (!hdr) throw new Error("Data tidak ditemukan.");

  const [dtl] = await db.query(
    `SELECT
       d.sjd_spk_nomor, d.sjd_ukuran, d.sjd_jumlah, d.sjd_koli, d.sjd_keterangan,
       IFNULL(s.spk_nama, b.brg_name) AS nama_barang
     FROM tsj_dtl_bayangan d
     LEFT JOIN tspk s ON s.spk_nomor = d.sjd_spk_nomor
     LEFT JOIN tbarang b ON b.brg_kode = d.sjd_spk_nomor
     WHERE d.sjd_sj_nomor = ?`,
    [nomor],
  );

  const totalJumlah = dtl.reduce((s, r) => s + Number(r.sjd_jumlah || 0), 0);

  return { header: hdr, detail: dtl, totalJumlah };
};

// ─────────────────────────────────────────────────────────
// SAVE — sesuai Delphi simpandata + validasi VK_F10
// Nomor SJ MANUAL — dikirim dari frontend, bukan digenerate di sini.
// ─────────────────────────────────────────────────────────
const save = async (data, userKode, isNew) => {
  const {
    NomorSJ,
    Divisi,
    Tanggal,
    Keterangan,
    KodePerush,
    KodeCus,
    GudangKode,
    AlamatCus,
    KotaCus,
    InvPro = "",
    Detail = [],
  } = data;

  // ── Validasi — sesuai Delphi VK_F10 (TIDAK ada cek kurang/tutup buku)
  if (!NomorSJ) throw new Error("Nomor SJ wajib diisi.");
  if (!KodePerush) throw new Error("Perusahaan belum di isi");
  if (!GudangKode) throw new Error("Gudang tidak boleh kosong");
  if (!KodeCus) throw new Error("Customer belum di isi");

  const validDetail = Detail.filter((r) => r.Kode);
  if (!validDetail.length)
    throw new Error("Surat Jalan tidak ada detail,tidak dapat di simpan");

  const divisiStr = String(Divisi).charAt(0);

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    if (isNew) {
      await conn.query(
        `INSERT INTO tsj_hdr_bayangan
           (sj_nomor, sj_divisi, sj_tanggal, sj_keterangan,
            sj_perush_kode, sj_cus_kode, sj_gdg_kode,
            sj_alamat_customer, sj_kota_customer, sj_inv_pro,
            date_create, user_create)
         VALUES (?,?,?,?,?,?,?,?,?,?,NOW(),?)`,
        [
          NomorSJ,
          divisiStr,
          Tanggal,
          Keterangan,
          KodePerush,
          KodeCus,
          GudangKode,
          AlamatCus,
          KotaCus,
          InvPro,
          userKode,
        ],
      );
    } else {
      await conn.query(
        `UPDATE tsj_hdr_bayangan SET
           sj_tanggal = ?, sj_keterangan = ?,
           sj_perush_kode = ?, sj_cus_kode = ?, sj_gdg_kode = ?,
           sj_alamat_customer = ?, sj_kota_customer = ?, sj_inv_pro = ?,
           date_modified = NOW(), user_modified = ?
         WHERE sj_nomor = ?`,
        [
          Tanggal,
          Keterangan,
          KodePerush,
          KodeCus,
          GudangKode,
          AlamatCus,
          KotaCus,
          InvPro,
          userKode,
          NomorSJ,
        ],
      );
    }

    // Detail — sesuai Delphi: TIDAK ada sjd_nourut sama sekali
    await conn.query(`DELETE FROM tsj_dtl_bayangan WHERE sjd_sj_nomor = ?`, [
      NomorSJ,
    ]);
    for (const row of validDetail) {
      await conn.query(
        `INSERT INTO tsj_dtl_bayangan
           (sjd_sj_nomor, sjd_spk_nomor, sjd_jumlah, sjd_koli, sjd_ukuran, sjd_keterangan)
         VALUES (?,?,?,?,?,?)`,
        [
          NomorSJ,
          row.Kode,
          Number(row.Jumlah || 0),
          Number(row.Koli || 0),
          row.Ukuran || "",
          row.Keterangan || "",
        ],
      );
    }

    await conn.commit();
    return { nomor: NomorSJ };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
};

module.exports = {
  checkNomor,
  loadBarangDetail,
  getSpkCustomer,
  getCustomerInfo,
  searchPerusahaan,
  getDivisiList,
  searchBarangByDivisi,
  searchBarangByInvPro,
  getDataCetak,
  save,
};
