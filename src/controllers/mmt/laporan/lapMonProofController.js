// controllers/lapMonProof.controller.js
const reportService = require('../../../services/mmt/laporan/lapMonProofService');

/**
 * Controller untuk Laporan Monitoring Proof
 * Menangani pengambilan data dari Service berbasis logika Delphi
 */
async function getLapMonProof(req, res) {
  const { startDate, endDate } = req.query;

  // Validasi Parameter (Wajib ada untuk query DATEDIFF dan BETWEEN)
  if (!startDate || !endDate) {
    return res.status(400).json({
      success: false,
      message: 'Parameter startDate dan endDate (YYYY-MM-DD) wajib diisi untuk melihat data Proofing'
    });
  }

  try {
    // Memanggil service yang sudah kita update SQL-nya
    const data = await reportService.lapMonProof(startDate, endDate);

    // Kirim response ke Vue
    // Data ini sekarang berisi field: jenis_display, mspk_tanggal, deadline, nama_order, 
    // panjang, lebar, mspk_nomor, jml_order, lprd_jproof, lama_proof, 
    // lpr_tanggal, lokasi_proof, jenis_bahan, gramasi, keterangan, statusmemo, 
    // spktanggal, nomorspk
    res.json({
      success: true,
      count: data.length,
      data: data
    });

  } catch (error) {
    console.error('Error lapMonProof Controller:', error);
    res.status(500).json({
      success: false,
      message: 'Gagal memuat Laporan Monitoring Proof. Periksa koneksi database atau nama kolom.'
    });
  }
}

module.exports = { getLapMonProof };