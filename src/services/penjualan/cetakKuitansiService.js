const db = require("../../config/database");

// ═══════════════════════════════════════════════════════════
// CETAK KUITANSI — SERVICE (BROWSE ONLY)
// Migrasi dari ufrmBrowseKuitansi.pas (Delphi)
//
// SCOPE SAAT INI: hanya list (getBrowse), sesuai instruksi — browse
// cuma punya tombol "Baru", tanpa Ubah/Hapus/Cetak/Export Excel.
// Endpoint form/aksi lain menyusul saat form Kuitansi dibangun.
//
// DEVIASI DARI DELPHI (disepakati):
//   1. Filter tanggal DIBETULKAN jadi konsisten satu kolom (kui_tanggal
//      di kedua batas awal & akhir) — Delphi asli asimetris (batas
//      awal pakai kui_date_Create, batas akhir pakai kui_tanggal).
//   2. Nama perusahaan di-JOIN ke tperusahaan (Delphi asli cuma
//      nampilin kode kui_perush_kode mentah).
//
// CATATAN: Delphi handler Ubah/Hapus/Cetak manggil field "Nomor" yang
// TIDAK ADA di query select ini (cuma ada "Nomor_Inv") — perlu
// diklarifikasi primary key kuitansi yang benar (kui_inv_nomor vs
// tc_nomor) saat form dibangun nanti.
// ═══════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────
// BROWSE — sesuai Delphi btnRefreshClick
// ─────────────────────────────────────────────────────────
const getBrowse = async (tglAwal, tglAkhir) => {
  const [rows] = await db.query(
    `SELECT
       k.kui_inv_nomor    AS Nomor_Inv,
       DATE_FORMAT(k.kui_tanggal, '%Y-%m-%d') AS Tanggal_Inv,
       k.kui_perush_kode  AS PerusahaanKode,
       p.perush_nama      AS Perusahaan,
       k.kui_cus_kode     AS Cus_kode,
       c.cus_nama         AS cus_nama,
       DATE_FORMAT(k.kui_date_create, '%Y-%m-%d %H:%i:%s') AS Date_Create,
       k.kui_user_Create  AS User_Create
     FROM tkuitansi k
     LEFT JOIN tcustomer c ON c.cus_kode = k.kui_cus_kode
     LEFT JOIN tperusahaan p ON p.perush_kode = k.kui_perush_kode
     WHERE k.kui_tanggal >= ? AND k.kui_tanggal <= ?
     ORDER BY k.kui_tanggal`,
    [tglAwal, tglAkhir],
  );
  return rows;
};

// ─────────────────────────────────────────────────────────
// SEARCH INVOICE — sesuai Delphi edtinvnomorClickBtn/KeyDown.
// TIDAK ADA filter PPN sama sekali (beda dari Cetak Faktur Pajak) —
// mencakup SEMUA invoice apapun jenis & status PPN-nya.
// ─────────────────────────────────────────────────────────
const searchInvoice = async (q = "", page = 1, limit = 50) => {
  const limitNum = Number(limit);
  const offset = (Number(page) - 1) * limitNum;
  const like = `%${q}%`;

  let where = "1=1";
  const params = [];
  if (q) {
    where = "(a.inv_nomor LIKE ? OR c.cus_nama LIKE ?)";
    params.push(like, like);
  }

  const [[{ total }]] = await db.query(
    `SELECT COUNT(*) AS total
     FROM tinv_hdr a INNER JOIN tcustomer c ON c.cus_kode = a.inv_cus_kode
     WHERE ${where}`,
    params,
  );

  const [rows] = await db.query(
    `SELECT a.inv_nomor AS Nomor, DATE_FORMAT(a.inv_tanggal,'%d/%m/%Y') AS Tanggal,
            c.cus_kode AS KodeCus, c.cus_nama AS Customer, a.inv_keterangan AS Keterangan
     FROM tinv_hdr a
     INNER JOIN tcustomer c ON c.cus_kode = a.inv_cus_kode
     WHERE ${where}
     ORDER BY a.date_create DESC
     LIMIT ? OFFSET ?`,
    [...params, limitNum, offset],
  );
  return { items: rows, total, page: Number(page), limit: limitNum };
};

// ─────────────────────────────────────────────────────────
// HITUNG TOTAL — sesuai Invoice.hitung() (disc/PPN/PPh), direplikasi
// identik dgn logic yg sudah ada di InvoiceFormView/invoiceFormService.
// ─────────────────────────────────────────────────────────
const computeTotal = (detail, disc, stsPpn, ppn, pph) => {
  const totalBarang = detail.reduce(
    (s, r) => s + Number(r.invd_harga) * Number(r.invd_jumlah),
    0,
  );
  const discVal = Number(disc || 0);
  if (!stsPpn) return totalBarang - discVal;
  if (pph === "PPh") {
    return totalBarang - discVal + (totalBarang * Number(ppn)) / 100;
  }
  const baseAfterDisc = totalBarang - discVal;
  return baseAfterDisc + (baseAfterDisc * Number(ppn)) / 100;
};

// ─────────────────────────────────────────────────────────
// GET BY ID — sesuai Delphi loaddataall + query Total di doslip
// ─────────────────────────────────────────────────────────
const getById = async (nomor) => {
  const [[hdr]] = await db.query(
    `SELECT
       a.inv_nomor, a.inv_tanggal, a.inv_keterangan,
       a.inv_perush_kode, p.perush_nama, p.perush_alamat, p.perush_telp,
       a.inv_cus_kode, c.cus_nama, c.cus_alamat, c.cus_kota, c.cus_telp,
       a.inv_cus_alamat, a.inv_disc, a.inv_sts_ppn, a.inv_ppn, a.inv_pph
     FROM tinv_hdr a
     INNER JOIN tperusahaan p ON p.perush_kode = a.inv_perush_kode
     INNER JOIN tcustomer c ON c.cus_kode = a.inv_cus_kode
     WHERE a.inv_nomor = ?`,
    [nomor],
  );
  if (!hdr) throw new Error("Invoice tidak ditemukan.");

  const [detail] = await db.query(
    `SELECT
      d.invd_spk_nomor, d.invd_jumlah, d.invd_harga,
      COALESCE(
        NULLIF(
          IF(SUBSTRING(d.invd_spk_nomor,4,2)='BI', b.brg_name, s.spk_nama2),
          ''
        ),
        s.spk_nama2, b.brg_name, ''
      ) AS nama_barang
    FROM tinv_dtl d
    LEFT JOIN tspk s ON s.spk_nomor = d.invd_spk_nomor
    LEFT JOIN tbarang b ON b.brg_kode = d.invd_spk_nomor
    WHERE d.invd_inv_nomor = ?
    ORDER BY d.invd_nourut`,
    [nomor],
  );

  // Hanya 2 file .fr3 tersedia — 'kuitansi_MD.fr3' khusus company MD,
  // 'Kuitansi.fr3' dipakai default utk SEMUA perusahaan lain (termasuk
  // KP dan JA). Ini juga yg bikin kondisi unit "Lembar utk JA" di bawah
  // jadi masuk akal (JA memang bagian dari grup template 'kp' ini) —
  // ASUMSI, tolong dikonfirmasi kalau ada perusahaan lain yg
  // sebenarnya juga punya template sendiri.
  const isMD = hdr.inv_perush_kode === "MD";
  const total = computeTotal(
    detail,
    hdr.inv_disc,
    hdr.inv_sts_ppn,
    hdr.inv_ppn,
    hdr.inv_pph,
  );

  return {
    header: {
      ...hdr,
      variant: isMD ? "generic" : "kp",
      // Sesuai formula asli fr3 'Kuitansi.fr3': unit "Lembar" HANYA
      // kalau invoice dari perusahaan JA, selain itu "Pcs". Kondisi
      // ini cuma relevan di grup template 'kp' (krn cuma ada di file
      // itu) — utk grup 'generic' (MD) selalu "Pcs" tanpa kondisi.
      unit: !isMD && hdr.inv_perush_kode === "JA" ? "Lembar" : "Pcs",
      nama_mgr: isMD ? "Catur Kadarini" : "Darul Arifin",
      jabatan_mgr: isMD ? "Direktur" : "",
      Total: total,
    },
    detail,
  };
};

// ─────────────────────────────────────────────────────────
// SAVE + GET DATA CETAK — sesuai Delphi btncetakClick (simpandata +
// dosliP digabung jadi satu aksi, konsisten pola modul lain).
// CATATAN: kui_date_create diisi CURDATE() (tanggal server SAAT INI
// tanpa jam) — sesuai Delphi pakai "Date" bukan "Now". Ini alasan
// kolom itu historisnya selalu 00:00:00, BUKAN data korup.
// ─────────────────────────────────────────────────────────
const saveAndGetDataCetak = async (nomor, userKode) => {
  const [[inv]] = await db.query(
    `SELECT inv_nomor, inv_tanggal, inv_perush_kode, inv_cus_kode
     FROM tinv_hdr WHERE inv_nomor = ?`,
    [nomor],
  );
  if (!inv) throw new Error("Invoice tidak ditemukan.");

  await db.query(
    `REPLACE INTO tkuitansi
       (kui_inv_nomor, kui_tanggal, kui_perush_kode, kui_cus_kode, kui_date_create, kui_user_Create)
     VALUES (?, ?, ?, ?, CURDATE(), ?)`,
    [
      inv.inv_nomor,
      inv.inv_tanggal,
      inv.inv_perush_kode,
      inv.inv_cus_kode,
      userKode,
    ],
  );

  return getById(nomor);
};

module.exports = {
  getBrowse,
  searchInvoice,
  getById,
  saveAndGetDataCetak,
};
