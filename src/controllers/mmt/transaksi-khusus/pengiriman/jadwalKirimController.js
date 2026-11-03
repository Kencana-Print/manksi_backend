// backend/src/controllers/jadwalKirim.controller.js
const jadwalService = require('../../../../services/mmt/transaksi-khusus/pengiriman/jadwalKirimService');

exports.browseJadwal = async (req, res) => {
  try {
    // Ambil 'gudang' dari req.query, bukan 'cab'
    const { startDate, endDate, gudang, search } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({ message: "Periode tanggal harus diisi." });
    }

    // Kirim variabel gudang dan search ke service
    const data = await jadwalService.getJadwalKirimData(startDate, endDate, gudang, search);
    
    return res.status(200).json(data);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};


exports.getDetailJadwal = async (req, res) => {
  try {
    const { nomor } = req.params; // Mengambil nomor dari URL parameter
    
    if (!nomor) {
      return res.status(400).json({ message: "Nomor Kirim tidak valid." });
    }

    const data = await jadwalService.getJadwalKirimByNomor(nomor);

    if (!data) {
      return res.status(404).json({ message: "Data tidak ditemukan." });
    }

    return res.status(200).json(data);
  } catch (error) {
    console.error("Controller Get Detail Error:", error);
    return res.status(500).json({ message: error.message });
  }
};

exports.printJadwal = async (req, res) => {
  try {
    const { startDate, endDate, gudang } = req.query;
    const data = await jadwalService.getPrintData(startDate, endDate, gudang);
    
    // Anda bisa mengirim JSON ini ke library report seperti ExcelJS atau 
    // mengirimnya ke frontend untuk di-render di HTML Print
    res.json({
      success: true,
      company: "CV. Kencana Print",
      periode: `${startDate} s/d ${endDate}`,
      data: data
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.deleteJadwal = async (req, res) => {
  try {
    // Parameter diambil dari body karena di Delphi menggunakan komposit key
    const success = await jadwalService.deleteJadwalKirim(req.body);
    
    if (success) {
      return res.status(200).json({ message: "Berhasil dihapus" });
    } else {
      return res.status(404).json({ message: "Data tidak ditemukan atau gagal dihapus" });
    }
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};


exports.saveJadwal = async (req, res) => {
    try {
        const data = req.body;
        // Jika data.Nomor adalah "AUTO", kirim null agar di-generate nomor baru
        const nomorToEdit = (data.Nomor && data.Nomor !== "AUTO") ? data.Nomor : null;

        // Ambil kdUser dari token (Pastikan nama properti di token adalah kdUser)
        const currentUser = req.user ? (req.user?.kode || req.user?.kdUser || req.user?.nama || 'SYSTEM') : (data.usr_create || 'SYSTEM');

        const result = await jadwalService.saveJadwalKirim(data, nomorToEdit, currentUser);
        
        res.status(200).json({
            ...result,
            oleh: currentUser
        });
    } catch (error) {
        console.error("Controller Save Error:", error);
        res.status(400).json({ message: 'Gagal Simpan.', error: error.message });
    }
};