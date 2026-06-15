const db = require("../../../config/database");

/**
 * 1. MASTER: DAFTAR KARTU PIUTANG PER CUSTOMER
 * Merangkum total debet, kredit, dan saldo piutang per customer
 * yang terjadi sejak '2021-01-01' hingga batas tanggal (endDate).
 */
const getMasterKartuPiutang = async (query) => {
  const { endDate } = query;
  const dEnd = endDate || new Date().toISOString().substring(0, 10);

  const sql = `
    SELECT 
      x.Customer AS Kode,
      x.Nama,
      x.Alamat,
      x.Kota,
      x.Debet,
      x.Kredit,
      (x.Debet - x.Kredit) AS Saldo,
      x.status_ AS Status
    FROM (
      SELECT 
        c.cus_kode AS Customer,
        c.cus_nama AS Nama,
        c.cus_alamat AS Alamat,
        c.cus_kota AS Kota,
        IF(c.cus_aktif = 0, "Aktif", "Pasif") AS status_,
        IFNULL((
          SELECT SUM(p.debet) 
          FROM piutang_debet p 
          WHERE p.flag = 0 
            AND p.tanggal >= '2021-01-01' 
            AND p.tanggal <= ? 
            AND p.customer = c.cus_kode 
            AND p.nota NOT IN (SELECT x.inv_nomor FROM tinv_hdr x WHERE x.INV_Keterangan LIKE '%INV YG DIKIRIM%')
        ), 0) AS Debet,
        IFNULL((
          SELECT SUM(d.kredit) 
          FROM piutang_kredit_detail d 
          INNER JOIN piutang_kredit_header h ON h.nomor = d.nomor
          INNER JOIN piutang_debet p ON d.nota = p.nota
          WHERE p.flag = 0 
            AND p.customer = c.cus_kode 
            AND h.tanggal >= '2021-01-01' 
            AND h.tanggal <= ? 
            AND RIGHT(d.nota, 4) >= 2021
        ), 0) AS Kredit
      FROM tcustomer c
    ) x
    WHERE (x.Debet - x.Kredit) <> 0 OR x.status_ = "Aktif"
    ORDER BY x.Customer ASC
  `;

  const [rows] = await db.query(sql, [dEnd, dEnd]);
  return rows;
};

/**
 * 2. DETAIL 1: DAFTAR INVOICE MILIK SATU CUSTOMER
 * Menampilkan rincian nota piutang (invoice) untuk satu customer.
 */
const getInvoiceByCustomer = async (query, customerKode) => {
  const { endDate } = query;
  const dEnd = endDate || new Date().toISOString().substring(0, 10);

  const sql = `
    SELECT 
      p.customer AS Customer,
      p.nota AS Invoice,
      DATE_FORMAT(p.tanggal, '%d-%m-%Y') AS Tanggal,
      DATE_FORMAT(p.tanggal_tempo, '%d-%m-%Y') AS Tempo,
      p.debet AS Debet,
      IFNULL((
        SELECT SUM(d.kredit) 
        FROM piutang_kredit_detail d
        INNER JOIN piutang_kredit_header h ON h.nomor = d.nomor
        WHERE h.tanggal >= '2021-01-01' 
          AND h.tanggal <= ? 
          AND d.nota = p.nota
      ), 0) AS Kredit,
      (p.debet - IFNULL((
        SELECT SUM(d.kredit) 
        FROM piutang_kredit_detail d
        INNER JOIN piutang_kredit_header h ON h.nomor = d.nomor
        WHERE h.tanggal >= '2021-01-01' 
          AND h.tanggal <= ? 
          AND d.nota = p.nota
      ), 0)) AS Saldo
    FROM piutang_debet p
    WHERE p.flag = 0
      AND p.nota NOT IN (SELECT x.inv_nomor FROM tinv_hdr x WHERE x.INV_Keterangan LIKE '%INV YG DIKIRIM%')
      AND p.tanggal >= '2021-01-01' 
      AND p.tanggal <= ? 
      AND p.customer = ?
    ORDER BY p.tanggal ASC, p.nota ASC
  `;

  // Filter end date diulang karena dipakai dalam subquery bayar juga
  const [rows] = await db.query(sql, [dEnd, dEnd, dEnd, customerKode]);
  return rows;
};

/**
 * 3. DETAIL 2: DAFTAR PEMBAYARAN MILIK SATU INVOICE
 * Menampilkan histori pembayaran untuk satu nomor nota tertentu.
 */
const getPembayaranByInvoice = async (query, invNomor) => {
  const { endDate } = query;
  const dEnd = endDate || new Date().toISOString().substring(0, 10);

  const sql = `
    SELECT 
      d.nota AS Invoice,
      DATE_FORMAT(t.tanggal, '%d-%m-%Y') AS TglPenerimaan,
      DATE_FORMAT(h.tanggal, '%d-%m-%Y') AS TglPelunasan,
      d.kode AS Trs,
      0 AS Debet,
      d.kredit AS Kredit,
      d.no_bukti AS NoPenerimaan,
      d.nomor AS NoPelunasan,
      d.notes AS Keterangan
    FROM piutang_kredit_detail d
    LEFT JOIN piutang_kredit_header h ON h.nomor = d.nomor
    LEFT JOIN terima_bayar_debet t ON t.nomor = d.no_bukti
    WHERE h.tanggal >= '2021-01-01' 
      AND h.tanggal <= ? 
      AND d.nota = ?
    ORDER BY h.tanggal ASC
  `;

  const [rows] = await db.query(sql, [dEnd, invNomor]);
  return rows;
};

module.exports = {
  getMasterKartuPiutang,
  getInvoiceByCustomer,
  getPembayaranByInvoice,
};
