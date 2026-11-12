const returService = require("../../../services/mmt/finance/returBeliService");

// Mendapatkan nomor otomatis baru untuk Retur Beli
exports.getNewNomor = async (req, res) => {
  try {
    const nomor = await returService.getNewNomorReturBeli();
    res.status(200).json({ success: true, nomor });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Scan Barcode atau Cari SKU Barang MMT
exports.scanItem = async (req, res) => {
  try {
    const { barcode } = req.params;
    const item = await returService.scanBarcodeOrSku(barcode);
    if (!item) {
      return res.status(404).json({
        success: false,
        message: "Barang tidak ditemukan untuk barcode/kode tersebut",
      });
    }
    res.status(200).json({
      success: true,
      data: item,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Mendapatkan daftar seluruh Retur Beli (dengan pencarian & pagination)
exports.getAllRetur = async (req, res) => {
  try {
    const { search, startDate, endDate, limit, offset = 0 } = req.query;

    const data = await returService.getAllReturBeli({
      search,
      startDate,
      endDate,
      limit: limit ? parseInt(limit, 10) : 500,
      offset: parseInt(offset, 10),
    });

    res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// Mendapatkan detail Retur Beli berdasarkan Nomor (Header + Details)
exports.getReturByNomor = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await returService.getReturBeliByNomor(nomor);

    if (!data) {
      return res.status(404).json({
        success: false,
        message: `Data retur beli dengan nomor ${nomor} tidak ditemukan`,
      });
    }

    res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Menyimpan transaksi Retur Beli baru
exports.createRetur = async (req, res) => {
  try {
    const userLogin = req.user?.kode || req.user?.kdUser || req.user?.nama || "SYSTEM";
    const result = await returService.saveReturBeli(req.body, false, userLogin);

    res.status(201).json({
      success: true,
      message: "Retur beli berhasil disimpan",
      data: result,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Mengubah data Retur Beli
exports.updateRetur = async (req, res) => {
  try {
    const { nomor } = req.params;
    const userLogin = req.user?.kode || req.user?.kdUser || req.user?.nama || "SYSTEM";

    const data = { ...req.body, Nomor: nomor };
    const result = await returService.saveReturBeli(data, true, userLogin);

    res.status(200).json({
      success: true,
      message: "Retur beli berhasil diperbarui",
      data: result,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Menghapus transaksi Retur Beli
exports.deleteRetur = async (req, res) => {
  try {
    const { nomor } = req.params;
    const result = await returService.deleteReturBeli(nomor);

    if (result) {
      res
        .status(200)
        .json({ success: true, message: "Data retur beli berhasil dihapus" });
    } else {
      res
        .status(404)
        .json({ success: false, message: "Data retur beli tidak ditemukan" });
    }
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
