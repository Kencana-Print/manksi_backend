const jadwalKirimService = require('../../../services/mmt/laporan/lapMonJadwalKirimService');

const getLaporanJadwalKirim = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({
        status: false,
        message: 'Parameter startDate dan endDate wajib diisi (YYYY-MM-DD)',
      });
    }

    const data = await jadwalKirimService.getLapJadwalKirim(startDate, endDate);

    return res.status(200).json({
      status: true,
      message: 'Berhasil mengambil data laporan jadwal kirim',
      data,
    });
  } catch (error) {
    console.error('Error getLaporanJadwalKirim:', error);
    return res.status(500).json({
      status: false,
      message: 'Terjadi kesalahan pada server',
      error: error.message,
    });
  }
};

const deleteJadwalKirim = async (req, res) => {
  try {
    const { nomorKirim } = req.params;
    const userKd = (req.user?.kode || req.user?.kdUser || req.user?.nama || 'SYSTEM') || req.body.kdUser; // Disesuaikan dengan middleware auth Anda

    if (!nomorKirim) {
      return res.status(400).json({
        status: false,
        message: 'Nomor kirim wajib diisi',
      });
    }

    await jadwalKirimService.deleteJadwalKirim(nomorKirim, userKd);

    return res.status(200).json({
      status: true,
      message: 'Hapus data berhasil',
    });
  } catch (error) {
    console.error('Error deleteJadwalKirim:', error);
    return res.status(400).json({
      status: false,
      message: error.message || 'Gagal menghapus data',
    });
  }
};

module.exports = {
  getLaporanJadwalKirim,
  deleteJadwalKirim,
};