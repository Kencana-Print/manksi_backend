const db = require("../../config/database");

// Voucher yang dipilih langsung di Rekap Pembayaran (baris tipe VOU, rekap
// AKTIF) tidak boleh diubah atau dihapus dari form voucher. Voucher yang
// dibuat dari baris Rekap tipe transaksi sengaja tidak ikut dicek: alurnya
// memang "hapus voucher dahulu" sebelum rekap dibatalkan.
const assertVoucherTidakDiRekap = async (vouNomor, conn = db) => {
  const daftar = (Array.isArray(vouNomor) ? vouNomor : [vouNomor]).filter(
    Boolean,
  );
  if (!daftar.length) return;
  const [rows] = await conn.query(
    `SELECT d.rkbd_vou_nomor AS vou, d.rkbd_nomor AS rekap
     FROM trekap_bayar_dtl d
     INNER JOIN trekap_bayar_hdr h
       ON h.rkb_nomor = d.rkbd_nomor AND h.rkb_status = 'AKTIF'
     WHERE d.rkbd_tipe = 'VOU' AND d.rkbd_vou_nomor IN (?)
     LIMIT 1`,
    [daftar],
  );
  if (rows.length) {
    throw new Error(
      `Voucher ${rows[0].vou} ada di Rekap Pembayaran ${rows[0].rekap}. Keluarkan dari rekap dahulu.`,
    );
  }
};

module.exports = { assertVoucherTidakDiRekap };
