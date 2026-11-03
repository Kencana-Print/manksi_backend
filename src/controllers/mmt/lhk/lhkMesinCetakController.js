const lhkCetakService = require('../../../services/mmt/lhk/lhkMesinCetakService');
const { subDays } = require('date-fns'); // Untuk tanggal default

exports.getAllHeaders = async (req, res) => {
    try {
        // AMBIL 'search' dari req.query di sini
        const { startDate, endDate, search } = req.query; 
        
        // Kirim 'search' ke service. Jika frontend tidak mengirim, nilainya undefined.
        // Kita beri default string kosong '' agar service tidak error.
        const data = await lhkCetakService.getAllHeaders(startDate, endDate, search || '');
        
        res.json(data);
    } catch (error) {
        // Jika 'search' tidak diambil di atas, maka error "search is not defined" muncul di sini
        res.status(500).json({ 
            message: "Gagal mengambil data master LHK", 
            error: error.message 
        });
    }
};

exports.getLookup = async (req, res) => {
    try {
        // 1. Tambahkan 'shift' untuk diambil dari req.query
        const { startDate, endDate, shift, search } = req.query; 
        
        // 2. Teruskan 'shift' ke service sesuai urutan argumen di getLookup
        // Urutan di service: (startDate, endDate, shift, search)
        const data = await lhkCetakService.getLookup(
            startDate, 
            endDate, 
            shift || '', 
            search || ''
        );
        
        res.json(data);
    } catch (error) {
        console.error("Lookup Error:", error); // Bagus untuk debugging di console
        res.status(500).json({ 
            message: "Gagal mengambil data master LHK", 
            error: error.message 
        });
    }
};

exports.getDetails = async (req, res) => {
  try {
    const { nomor } = req.query;
    if (!nomor) {
      return res.status(400).json({ message: 'Nomor LHK diperlukan' });
    }
    const data = await lhkCetakService.getDetailsByNomor(nomor);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: 'Gagal mengambil detail', error: error.message });
  }
};

// backend/controllers/lhkMesinCetak.controller.js

exports.getDetailForLookup = async (req, res) => {
    try {
        // Kita ambil dari query agar bisa menerima multiple: ?nomor=LHK001,LHK002
        let { nomor } = req.query; 

        if (!nomor) {
            // Cek juga params jika user hanya kirim satu nomor via URL
            nomor = req.params.nomor;
        }

        if (!nomor) {
            return res.status(400).json({
                success: false,
                message: "Nomor LHK tidak boleh kosong"
            });
        }

        // Jika nomor datang sebagai string "LHK01,LHK02", ubah jadi array
        const daftarNomor = typeof nomor === 'string' ? nomor.split(',') : nomor;

        // Panggil service yang baru (getLookupByMultipleNomor)
        const data = await lhkCetakService.getLookupByMultipleNomor(daftarNomor);
        
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};


exports.deleteHeader = async (req, res) => {
  try {
    const { nomor } = req.params; // Ambil 'nomor' dari URL
    const result = await lhkCetakService.deleteLhk(nomor);
    res.json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.saveLhk = async (req, res) => {
  try {
    const userLogin = (req.user?.kode || req.user?.kdUser || req.user?.nama || 'SYSTEM');

    if (!userLogin) {
      return res.status(401).json({
        success: false,
        message: 'User login tidak valid. Silakan login ulang.'
      });
    }

    // ===============================
    // 2. Ambil payload dari body
    // ===============================
    const { existingNomor, header, details } = req.body;

    // ===============================
    // 3. Validasi dasar payload
    // ===============================
    if (!header || !Array.isArray(details) || details.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Data header atau detail tidak lengkap.'
      });
    }

    // ===============================
    // 4. Panggil SERVICE
    // ===============================
    const result = await lhkCetakService.saveLhk(
      header,
      details,
      existingNomor,
      userLogin
    );

    // =========================================================================
    // 5. Response sukses (KUNCI: Tambahkan 'afalData' agar dibaca oleh Frontend)
    // =========================================================================
    return res.status(200).json({
      success: true,
      message: result.message || 'LHK berhasil disimpan.',
      nomor: result.nomor,
      isEdit: result.isEdit || false,
      afalData: result.afalData // <-- PASTI KAN BARIS INI ADA DI CONTROLLER
    });

  } catch (error) {
    console.error('Error di saveLhk controller:', error);

    return res.status(500).json({
      success: false,
      message: error.message || 'Terjadi kesalahan saat menyimpan data LHK.'
    });
  }
};

exports.getLookupByNomor = async (req, res) => {
  try {
    const { nomor } = req.params;

    if (!nomor) {
      return res.status(400).json({
        success: false,
        message: "Nomor LHK tidak boleh kosong"
      });
    }

    const data = await lhkCetakService.getLookupByNomor(nomor);

    return res.json({
      success: true,
      data
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};


exports.getDashboardAgregasi = async (req, res) => {
    try {
        const { startDate, endDate } = req.query;
        if (!startDate || !endDate) return res.status(400).json({ message: "Filter tanggal diperlukan" });
        
        const data = await lhkCetakService.getLaporanAgregasi(startDate, endDate);
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.getReportRekap = async (req, res) => {
    try {
        const { startDate, endDate } = req.query;
        const data = await lhkCetakService.getRekapLhk(startDate, endDate);
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.getExcelCrossTab = async (req, res) => {
    try {
        const { month, year } = req.query;
        const data = await lhkCetakService.getExportLhkCrossTab(month, year);
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.getExportLhk = async (req, res) => {
    try {
        const { startDate, endDate, mesin } = req.query;
        const data = await lhkCetakService.getAllDataForExport(startDate, endDate, mesin);
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};



exports.getDetailRekapPerMesin = async (req, res) => {
    try {
        const { startDate, endDate, mesin } = req.query;
        
        if (!mesin) {
            return res.status(400).json({ success: false, message: "Parameter mesin diperlukan" });
        }

        const data = await lhkCetakService.getDetailRekapMesin(startDate, endDate, mesin);
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
