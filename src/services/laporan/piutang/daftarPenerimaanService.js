const db = require("../../../config/database");

/**
 * MENGAMBIL DAFTAR PENERIMAAN (MASTER)
 */
const getMasterPenerimaan = async (query) => {
  const { startDate, endDate } = query;

  // Default: Awal bulan ini s.d Hari ini
  const dStart =
    startDate ||
    new Date(new Date().getFullYear(), new Date().getMonth(), 1)
      .toISOString()
      .substring(0, 10);
  const dEnd = endDate || new Date().toISOString().substring(0, 10);

  const sql = `
    SELECT 
      x.NoPenerimaan,
      DATE_FORMAT(x.Tanggal, "%d-%m-%Y") AS Tanggal,
      x.Kode,
      x.Customer,
      x.KodeAccount,
      x.Rekening,
      x.NamaAccount,
      x.Debet,
      x.Kredit,
      (x.Debet - x.Kredit) AS Saldo,
      x.Notes
    FROM (
      SELECT 
        t.Nomor AS NoPenerimaan,
        t.Tanggal,
        t.Kode,
        t.Customer,
        t.tb_rek_kode AS KodeAccount,
        t.account AS Rekening,
        IFNULL(r.rek_nama, "") AS NamaAccount,
        t.debet AS Debet,
        IFNULL((
          SELECT SUM(d.kredit) 
          FROM piutang_kredit_detail d 
          WHERE d.no_bukti = t.nomor
        ), 0) AS Kredit, 
        t.Notes
      FROM terima_bayar_debet t
      LEFT JOIN finance.trekening r ON r.rek_kode = t.tb_rek_kode
      WHERE t.tanggal >= ? AND t.tanggal <= ?
    ) x
    ORDER BY x.Tanggal ASC, x.NoPenerimaan ASC
  `;

  const [rows] = await db.query(sql, [dStart, dEnd]);
  return rows;
};

/**
 * MENGAMBIL DETAIL PELUNASAN INVOICE DARI SATU NOMOR PENERIMAAN (DETAIL)
 */
const getDetailPenerimaan = async (noPenerimaan) => {
  const sql = `
    SELECT 
      d.no_bukti AS NoPenerimaan,
      h.nomor AS NoPelunasan,
      DATE_FORMAT(h.tanggal, "%d-%m-%Y") AS Tanggal,
      d.Kredit AS Bayar,
      d.nota AS Invoice,
      IFNULL(n.INV_cus_kode, "") AS KodeCus,
      IFNULL(c.Cus_nama, "") AS Customer,
      IFNULL(c.Cus_alamat, "") AS Alamat,
      IFNULL(c.Cus_kota, "") AS Kota,
      d.Notes
    FROM piutang_kredit_detail d
    LEFT JOIN piutang_kredit_header h ON h.nomor = d.nomor
    LEFT JOIN tinv_hdr n ON n.INV_nomor = d.nota
    LEFT JOIN tcustomer c ON c.Cus_kode = n.INV_cus_kode
    WHERE d.no_bukti = ?
    ORDER BY d.no_bukti ASC, h.tanggal ASC, d.nota ASC
  `;

  const [rows] = await db.query(sql, [noPenerimaan]);
  return rows;
};

module.exports = {
  getMasterPenerimaan,
  getDetailPenerimaan,
};
