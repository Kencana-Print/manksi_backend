const db = require("../../config/database");

const MENU_ID = "155";

// ═══════════════════════════════════════════════════════════
// BROWSE
// ═══════════════════════════════════════════════════════════

const getBrowse = async (tglAwal, tglAkhir, canLihatCus = false) => {
  const custCols = canLihatCus
    ? `c.cus_kode AS KodeCustomer,
       c.cus_nama AS Customer,
       h.sj_alamat_customer AS Alamat,
       h.sj_kota_customer AS Kota,`
    : `"" AS KodeCustomer,
       "" AS Customer,
       "" AS Alamat,
       "" AS Kota,`;

  const [rows] = await db.query(
    `SELECT
       Nomor, Tanggal, Divisi,
       KodeCustomer, Customer, Alamat, Kota,
       Status, Expedisi, Kurir, Nomor_Resi, Tanggal_Kirim, Biaya_Kirim,
       Total_Qty,
       IF(Total_Qty > 0, Biaya_Kirim / Total_Qty, 0) AS Harga,
       Tanggal_Terima, Penerima_Barang, Tanggal_Terima_Sj,
       Contact_Person, Tanggal_Konfirmasi, Tanggal_Terima_1, Tanggal_SerahTerima
     FROM (
       SELECT
         h.sj_nomor                                  AS Nomor,
         DATE_FORMAT(h.sj_tanggal, '%Y-%m-%d')        AS Tanggal,
         d.divisi                                     AS Divisi,
         ${custCols}
         s.stssj_nama                                  AS Status,
         h.expedisi                                    AS Expedisi,
         h.kurir                                       AS Kurir,
         h.nomor_resi                                  AS Nomor_Resi,
         DATE_FORMAT(h.tanggal_kirim, '%Y-%m-%d')      AS Tanggal_Kirim,
         h.biaya_kirim                                 AS Biaya_Kirim,
         (
           SELECT SUM(
             IF(spk.spk_jo_kode IN ('MI','MT'), spk.spk_panjang * spk.spk_lebar,
               IF(spk.spk_jo_kode IN ('SP','UU','LT','BN','BB','BD'), spk.spk_panjang, 1)
             ) * sjd.sjd_jumlah
           )
           FROM tsj_dtl sjd
           INNER JOIN tspk spk ON spk.spk_nomor = sjd.sjd_spk_nomor
           WHERE sjd.sjd_sj_nomor = h.sj_nomor
         )                                              AS Total_Qty,
         DATE_FORMAT(h.tanggal_kembali, '%Y-%m-%d')    AS Tanggal_Terima,
         h.penerima_barang                              AS Penerima_Barang,
         DATE_FORMAT(h.tanggal_terima_sj, '%Y-%m-%d')  AS Tanggal_Terima_Sj,
         h.contact_person                               AS Contact_Person,
         DATE_FORMAT(h.tanggal_konfirmasi, '%Y-%m-%d') AS Tanggal_Konfirmasi,
         DATE_FORMAT(h.tanggal_terima, '%Y-%m-%d')     AS Tanggal_Terima_1,
         DATE_FORMAT(h.tanggal_serahterima, '%Y-%m-%d')AS Tanggal_SerahTerima
       FROM tsj_hdr h
       INNER JOIN tcustomer c ON h.sj_cus_kode = c.cus_kode
       INNER JOIN tstatussj s ON s.stssj_kode = h.sj_stssj_kode
       LEFT JOIN tdivisi d ON d.kode = h.sj_divisi
       WHERE h.sj_status_otomatis <> 1
         AND h.sj_tanggal >= ?
         AND h.sj_tanggal <= ?
       ORDER BY h.sj_tanggal
     ) Final`,
    [tglAwal, tglAkhir],
  );
  return rows;
};

const getBrowseDetail = async (tglAwal, tglAkhir, nomor = "") => {
  let where = `h.sj_tanggal >= ? AND h.sj_tanggal <= ?`;
  const params = [tglAwal, tglAkhir];

  if (nomor) {
    where += ` AND h.sj_nomor = ?`;
    params.push(nomor);
  }

  const [rows] = await db.query(
    `SELECT
       d.sjd_sj_nomor   AS Nomor,
       d.sjd_spk_nomor  AS SpkNomor,
       s.spk_nama       AS Nama,
       s.spk_ukuran     AS Ukuran,
       s.spk_panjang    AS Panjang,
       s.spk_lebar      AS Lebar,
       d.sjd_jumlah     AS Jumlah,
       d.sjd_keterangan AS Keterangan
     FROM tsj_hdr h
     INNER JOIN tsj_dtl d ON d.sjd_sj_nomor = h.sj_nomor
     INNER JOIN tspk s ON s.spk_nomor = d.sjd_spk_nomor
     WHERE ${where}
     ORDER BY d.sjd_sj_nomor, d.sjd_nourut`,
    params,
  );
  return rows;
};

const getExportData = async (tglAwal, tglAkhir, canLihatCus = false) =>
  getBrowse(tglAwal, tglAkhir, canLihatCus);
// ═══════════════════════════════════════════════════════════
// EXPORT DETAIL — flat per baris detail, TAPI ikut sertakan semua
// kolom header (sama seperti getBrowse) supaya FE bisa kelompokkan
// per Nomor SJ dan render header cuma sekali per grup.
// ═══════════════════════════════════════════════════════════
const getExportDetail = async (tglAwal, tglAkhir, canLihatCus = false) => {
  const custCols = canLihatCus
    ? `c.cus_kode AS KodeCustomer,
       c.cus_nama AS Customer,
       h.sj_alamat_customer AS Alamat,
       h.sj_kota_customer AS Kota,`
    : `"" AS KodeCustomer,
       "" AS Customer,
       "" AS Alamat,
       "" AS Kota,`;

  const [rows] = await db.query(
    `SELECT
       Nomor, Tanggal, Divisi,
       KodeCustomer, Customer, Alamat, Kota,
       Status, Expedisi, Kurir, Nomor_Resi, Tanggal_Kirim, Biaya_Kirim,
       Total_Qty,
       IF(Total_Qty > 0, Biaya_Kirim / Total_Qty, 0) AS Harga,
       Tanggal_Terima, Penerima_Barang, Tanggal_Terima_Sj,
       Contact_Person, Tanggal_Konfirmasi, Tanggal_Terima_1, Tanggal_SerahTerima,
       SpkNomor, NamaBarang, Ukuran, Panjang, Lebar, Jumlah, KetDetail
     FROM (
       SELECT
         h.sj_nomor                                  AS Nomor,
         DATE_FORMAT(h.sj_tanggal, '%Y-%m-%d')        AS Tanggal,
         d.divisi                                     AS Divisi,
         ${custCols}
         s.stssj_nama                                  AS Status,
         h.expedisi                                    AS Expedisi,
         h.kurir                                       AS Kurir,
         h.nomor_resi                                  AS Nomor_Resi,
         DATE_FORMAT(h.tanggal_kirim, '%Y-%m-%d')      AS Tanggal_Kirim,
         h.biaya_kirim                                 AS Biaya_Kirim,
         (
           SELECT SUM(
             IF(spk.spk_jo_kode IN ('MI','MT'), spk.spk_panjang * spk.spk_lebar,
               IF(spk.spk_jo_kode IN ('SP','UU','LT','BN','BB','BD'), spk.spk_panjang, 1)
             ) * sjd.sjd_jumlah
           )
           FROM tsj_dtl sjd
           INNER JOIN tspk spk ON spk.spk_nomor = sjd.sjd_spk_nomor
           WHERE sjd.sjd_sj_nomor = h.sj_nomor
         )                                              AS Total_Qty,
         DATE_FORMAT(h.tanggal_kembali, '%Y-%m-%d')    AS Tanggal_Terima,
         h.penerima_barang                              AS Penerima_Barang,
         DATE_FORMAT(h.tanggal_terima_sj, '%Y-%m-%d')  AS Tanggal_Terima_Sj,
         h.contact_person                               AS Contact_Person,
         DATE_FORMAT(h.tanggal_konfirmasi, '%Y-%m-%d') AS Tanggal_Konfirmasi,
         DATE_FORMAT(h.tanggal_terima, '%Y-%m-%d')     AS Tanggal_Terima_1,
         DATE_FORMAT(h.tanggal_serahterima, '%Y-%m-%d')AS Tanggal_SerahTerima,
         d2.sjd_spk_nomor  AS SpkNomor,
         s2.spk_nama       AS NamaBarang,
         s2.spk_ukuran     AS Ukuran,
         s2.spk_panjang    AS Panjang,
         s2.spk_lebar      AS Lebar,
         d2.sjd_jumlah     AS Jumlah,
         d2.sjd_keterangan AS KetDetail
       FROM tsj_hdr h
       INNER JOIN tcustomer c ON h.sj_cus_kode = c.cus_kode
       INNER JOIN tstatussj s ON s.stssj_kode = h.sj_stssj_kode
       LEFT JOIN tdivisi d ON d.kode = h.sj_divisi
       INNER JOIN tsj_dtl d2 ON d2.sjd_sj_nomor = h.sj_nomor
       INNER JOIN tspk s2 ON s2.spk_nomor = d2.sjd_spk_nomor
       WHERE h.sj_status_otomatis <> 1
         AND h.sj_tanggal >= ?
         AND h.sj_tanggal <= ?
       ORDER BY h.sj_nomor, d2.sjd_nourut
     ) Final`,
    [tglAwal, tglAkhir],
  );
  return rows;
};

// ═══════════════════════════════════════════════════════════
// FORM — Update Status
// Sesuai Delphi ufrmUpdateStatusSJ.loaddataall
// ═══════════════════════════════════════════════════════════

const getStatusList = async () => {
  const [rows] = await db.query(
    `SELECT stssj_kode AS kode, stssj_nama AS nama
     FROM tstatussj
     ORDER BY stssj_kode`,
  );
  return rows;
};

const getFormById = async (nomor, canLihatCus = false) => {
  const custCols = canLihatCus
    ? `h.sj_alamat_customer, h.sj_kota_customer,
       h.sj_cus_kode, c.cus_nama, c.cus_alamat, c.cus_kota,`
    : `h.sj_alamat_customer, h.sj_kota_customer,
       h.sj_cus_kode, "" AS cus_nama, "" AS cus_alamat, "" AS cus_kota,`;
  // sj_alamat_customer/sj_kota_customer tetap tampil — itu snapshot SJ,
  // bukan cus_nama/cus_alamat/cus_kota dari tabel customer

  const [[hdr]] = await db.query(
    `SELECT
       h.sj_nomor, DATE_FORMAT(h.sj_tanggal,'%Y-%m-%d') AS sj_tanggal,
       h.sj_keterangan,
       h.sj_perush_kode, p.perush_nama,
       h.sj_gdg_kode, g.gdg_nama,
       ${custCols}
       h.sj_inv_pro,
       h.sj_stssj_kode,
       h.expedisi, h.kurir, h.biaya_kirim,
       DATE_FORMAT(IFNULL(h.tanggal_kirim, CURDATE()), '%Y-%m-%d')        AS tanggal_kirim,
       h.nomor_resi,
       DATE_FORMAT(IFNULL(h.tanggal_kembali, CURDATE()), '%Y-%m-%d')      AS tanggal_kembali,
       h.contact_person,
       DATE_FORMAT(IFNULL(h.tanggal_konfirmasi, CURDATE()), '%Y-%m-%d')   AS tanggal_konfirmasi,
       DATE_FORMAT(IFNULL(h.tanggal_terima, CURDATE()), '%Y-%m-%d')       AS tanggal_terima,
       DATE_FORMAT(IFNULL(h.tanggal_terima_sj, CURDATE()), '%Y-%m-%d')    AS tanggal_terima_sj,
       DATE_FORMAT(IFNULL(h.tanggal_serahterima, CURDATE()), '%Y-%m-%d')  AS tanggal_serahterima,
       h.penerima_barang
     FROM tsj_hdr h
     INNER JOIN tperusahaan p ON p.perush_kode = h.sj_perush_kode
     INNER JOIN tcustomer c ON c.cus_kode = h.sj_cus_kode
     LEFT JOIN tgudang g ON g.gdg_kode = h.sj_gdg_kode
     WHERE h.sj_nomor = ?`,
    [nomor],
  );
  if (!hdr) throw new Error("Nomor tersebut belum ada.");

  // Detail — sesuai Delphi: hitung sudah/kurang per row (exclude diri sendiri)
  const [dtl] = await db.query(
    `SELECT
       d.sjd_spk_nomor   AS kode,
       s.spk_nama2       AS nama,
       d.sjd_ukuran      AS ukuran,
       s.spk_jo_kode     AS jenisOrder,
       d.sjd_jumlah      AS jumlah,
       d.sjd_koli        AS jumlahKoli,
       d.sjd_keterangan  AS keterangan,
       s.spk_jumlah      AS spkJumlah,
       IFNULL(z.spks_qty, 0)  AS qtyOrder,
       IFNULL(z.spks_size,'') AS size
     FROM tsj_dtl d
     LEFT JOIN tspk s ON s.spk_nomor = d.sjd_spk_nomor
     LEFT JOIN tspk_size z
       ON z.spks_nomor = d.sjd_spk_nomor AND z.spks_size = d.sjd_ukuran
     WHERE d.sjd_sj_nomor = ?
     ORDER BY d.sjd_nourut`,
    [nomor],
  );

  for (const row of dtl) {
    if (row.size) {
      const [[r]] = await db.query(
        `SELECT IFNULL(SUM(d2.sjd_jumlah),0) AS sudah
         FROM tsj_dtl d2
         INNER JOIN tsj_hdr h2 ON h2.sj_nomor = d2.sjd_sj_nomor
         WHERE h2.sj_status_otomatis <> 1
           AND d2.sjd_spk_nomor = ?
           AND d2.sjd_ukuran = ?
           AND d2.sjd_sj_nomor <> ?`,
        [row.kode, row.ukuran, nomor],
      );
      row.sudah = r.sudah;
      row.kurang = row.qtyOrder - r.sudah;
    } else {
      const [[r]] = await db.query(
        `SELECT IFNULL(SUM(d2.sjd_jumlah),0) AS sudah
         FROM tsj_dtl d2
         INNER JOIN tsj_hdr h2 ON h2.sj_nomor = d2.sjd_sj_nomor
         WHERE h2.sj_status_otomatis <> 1
           AND d2.sjd_spk_nomor = ?
           AND d2.sjd_sj_nomor <> ?`,
        [row.kode, nomor],
      );
      row.sudah = r.sudah;
      row.kurang = row.spkJumlah - r.sudah;
    }
  }

  return { header: hdr, detail: dtl };
};

// ─────────────────────────────────────────────────────────
// SIMPAN UPDATE STATUS
// Sesuai Delphi simpandata
// ─────────────────────────────────────────────────────────
const saveStatus = async (nomor, payload) => {
  if (!nomor) throw new Error("Nomor SJ wajib diisi.");
  const statusIndex = Number(payload.statusIndex);

  if (statusIndex === 0) {
    // Status 0 — reset semua field ke NULL, sesuai Delphi (tidak berubah)
    await db.query(
      `UPDATE tsj_hdr SET
         sj_stssj_kode = 0,
         expedisi = NULL, kurir = NULL, tanggal_kirim = NULL,
         nomor_resi = NULL, biaya_kirim = 0, tanggal_kembali = NULL,
         contact_person = NULL, tanggal_konfirmasi = NULL,
         tanggal_terima = NULL, tanggal_serahterima = NULL,
         tanggal_terima_sj = NULL, penerima_barang = NULL
       WHERE sj_nomor = ?`,
      [nomor],
    );
    return { nomor };
  }

  // ⚠️ FIX: ambil data existing dulu, supaya field milik status LAIN
  // (bukan status yang sedang di-set sekarang) TIDAK ikut ter-timpa
  // null. Frontend cuma mengirim field yang relevan untuk statusIndex
  // aktif — kalau backend selalu SET semua kolom mentah dari payload,
  // riwayat status sebelumnya (misal tanggal_kirim di status
  // "Pengiriman") hilang begitu user pindah ke status berikutnya.
  const [[existing]] = await db.query(
    `SELECT * FROM tsj_hdr WHERE sj_nomor = ?`,
    [nomor],
  );
  if (!existing) throw new Error("Data SJ tidak ditemukan.");

  // Default: pertahankan nilai lama untuk semua field
  let expedisi = existing.expedisi;
  let kurir = existing.kurir;
  let tanggal_kirim = existing.tanggal_kirim;
  let nomor_resi = existing.nomor_resi;
  let biaya_kirim = existing.biaya_kirim;
  let tanggal_kembali = existing.tanggal_kembali;
  let tanggal_terima_sj = existing.tanggal_terima_sj;
  let contact_person = existing.contact_person;
  let tanggal_konfirmasi = existing.tanggal_konfirmasi;
  let tanggal_terima = existing.tanggal_terima;
  let tanggal_serahterima = existing.tanggal_serahterima;
  let penerima_barang = existing.penerima_barang;

  // Timpa HANYA field milik grup status yang sedang aktif disimpan
  if (statusIndex === 1) {
    // Pengiriman
    expedisi = payload.expedisi ?? expedisi;
    kurir = payload.kurir ?? kurir;
    tanggal_kirim = payload.tanggalKirim ?? tanggal_kirim;
    nomor_resi = payload.nomorResi ?? nomor_resi;
    biaya_kirim = payload.biayaKirim ?? biaya_kirim;
  } else if (statusIndex === 2) {
    // Penyerahan Dokumen Kembali
    tanggal_kembali = payload.tanggalKembali ?? tanggal_kembali;
    penerima_barang = payload.penerimaBarang ?? penerima_barang;
    tanggal_terima_sj = payload.tanggalTerimaSj ?? tanggal_terima_sj;
  } else if (statusIndex === 3) {
    // Konfirmasi Ke Client
    contact_person = payload.contactPerson ?? contact_person;
    tanggal_konfirmasi = payload.tanggalKonfirmasi ?? tanggal_konfirmasi;
    tanggal_terima = payload.tanggalTerima ?? tanggal_terima;
  } else if (statusIndex === 4) {
    // Serah Terima ke Bag. Piutang
    tanggal_serahterima = payload.tanggalSerahTerima ?? tanggal_serahterima;
  }

  await db.query(
    `UPDATE tsj_hdr SET
       sj_stssj_kode = ?, expedisi = ?, kurir = ?, tanggal_kirim = ?,
       nomor_resi = ?, biaya_kirim = ?, tanggal_kembali = ?,
       contact_person = ?, tanggal_konfirmasi = ?, tanggal_terima = ?,
       tanggal_serahterima = ?, tanggal_terima_sj = ?, penerima_barang = ?
     WHERE sj_nomor = ?`,
    [
      statusIndex,
      expedisi,
      kurir,
      tanggal_kirim,
      nomor_resi,
      biaya_kirim,
      tanggal_kembali,
      contact_person,
      tanggal_konfirmasi,
      tanggal_terima,
      tanggal_serahterima,
      tanggal_terima_sj,
      penerima_barang,
      nomor,
    ],
  );

  return { nomor };
};

module.exports = {
  getBrowse,
  getBrowseDetail,
  getExportData,
  getExportDetail,
  getStatusList,
  getFormById,
  saveStatus,
};
