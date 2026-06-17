const db = require("../../../config/database");

/**
 * 1. MENGAMBIL DAFTAR GAGAL LINK (MASTER)
 * Menampilkan piutang yang nilai kreditnya (di tabel piutang_debet)
 * tidak sama dengan total nilai bayar (dari tabel piutang_kredit_detail).
 */
const getMasterGagalLink = async () => {
  const sql = `
    SELECT 
      x.Nota, 
      DATE_FORMAT(x.Tanggal, "%d-%m-%Y") AS Tanggal, 
      x.Customer, 
      x.NamaCustomer, 
      x.Alamat, 
      x.Debet, 
      x.Kredit, 
      x.Bayar, 
      (x.Bayar - x.Kredit) AS Selisih
    FROM (
      SELECT 
        p.Nota, 
        p.Tanggal, 
        p.Customer, 
        IFNULL(c.Cus_nama, "") AS NamaCustomer, 
        IFNULL(c.Cus_alamat, "") AS Alamat, 
        p.Debet, 
        p.Kredit,
        IFNULL((
          SELECT SUM(b.kredit) 
          FROM piutang_kredit_detail b 
          WHERE b.nota = p.nota
        ), 0) AS Bayar
      FROM piutang_debet p
      LEFT JOIN tcustomer c ON c.Cus_kode = p.customer 
      WHERE p.flag = 0
    ) x
    WHERE (x.Bayar - x.Kredit) <> 0
    ORDER BY x.Tanggal ASC, x.Nota ASC
  `;

  // Laporan ini menelusuri semua data tanpa batas tanggal
  const [rows] = await db.query(sql);
  return rows;
};

/**
 * 2. MENGAMBIL DETAIL PEMBAYARAN PER NOTA (DETAIL)
 */
const getDetailGagalLink = async (nota) => {
  const sql = `
    SELECT 
      d.Nota, 
      d.Nomor, 
      DATE_FORMAT(h.Tanggal, "%d-%m-%Y") AS Tanggal, 
      d.No_Bukti AS NoBukti, 
      d.Kredit AS Bayar
    FROM piutang_kredit_detail d
    LEFT JOIN piutang_kredit_header h ON h.nomor = d.nomor
    WHERE d.Nota = ?
    ORDER BY h.Tanggal ASC, d.Nomor ASC
  `;

  const [rows] = await db.query(sql, [nota]);
  return rows;
};

/**
 * 3. SINKRONISASI (FIX) GAGAL LINK
 * Aksi ini setara dengan tombol "Link Pembayaran" di Delphi.
 * Mengubah nilai kredit di piutang_debet agar sama dengan total bayar aslinya.
 */
const fixGagalLink = async (nota, bayar) => {
  const sql = `UPDATE piutang_debet SET kredit = ? WHERE nota = ?`;
  const [result] = await db.query(sql, [bayar, nota]);

  if (result.affectedRows === 0) {
    throw new Error("Gagal melakukan sinkronisasi. Nota tidak ditemukan.");
  }
  return true;
};

module.exports = {
  getMasterGagalLink,
  getDetailGagalLink,
  fixGagalLink,
};
