const bahanPenolongService = require("../../../services/spanduk/daftar/bahanPenolongService");

const getBrowseBahanPenolong = async (req, res) => {
  try {
    const data = await bahanPenolongService.getBrowseBahanPenolong();
    res.status(200).json({ success: true, data });
  } catch (error) {
    console.error("Error Browse Bahan Penolong Spanduk:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

const getBahanPenolongById = async (req, res) => {
  try {
    const data = await bahanPenolongService.getBahanPenolongById(
      req.params.kode,
    );
    if (!data)
      return res
        .status(404)
        .json({ success: false, message: "Data tidak ditemukan." });
    res.status(200).json({ success: true, data });
  } catch (error) {
    console.error("Error Detail Bahan Penolong Spanduk:", error);
    res.status(400).json({ success: false, message: error.message });
  }
};

const createBahanPenolong = async (req, res) => {
  try {
    const userKode = req.user?.kode || "SYSTEM";
    const kode = await bahanPenolongService.createBahanPenolong(
      req.body,
      userKode,
    );
    res.status(201).json({
      success: true,
      message: "Bahan penolong berhasil disimpan.",
      data: { Brg_kode: kode },
    });
  } catch (error) {
    console.error("Error Create Bahan Penolong Spanduk:", error);
    res.status(400).json({ success: false, message: error.message });
  }
};

const updateBahanPenolong = async (req, res) => {
  try {
    const userKode = req.user?.kode || "SYSTEM";
    await bahanPenolongService.updateBahanPenolong(
      req.params.kode,
      req.body,
      userKode,
    );
    res
      .status(200)
      .json({ success: true, message: "Perubahan berhasil disimpan." });
  } catch (error) {
    console.error("Error Update Bahan Penolong Spanduk:", error);
    res.status(400).json({ success: false, message: error.message });
  }
};

const deleteBahanPenolong = async (req, res) => {
  try {
    await bahanPenolongService.deleteBahanPenolong(req.params.kode);
    res.status(200).json({ success: true, message: "Data berhasil dihapus." });
  } catch (error) {
    console.error("Error Delete Bahan Penolong Spanduk:", error);
    res.status(400).json({ success: false, message: error.message });
  }
};

const getLookups = async (req, res) => {
  try {
    const data = await bahanPenolongService.getLookups(
      req.params.category,
      req.query.search,
    );
    res.status(200).json({ success: true, data });
  } catch (error) {
    console.error("Error Lookup Bahan Penolong Spanduk:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getBrowseBahanPenolong,
  getBahanPenolongById,
  createBahanPenolong,
  updateBahanPenolong,
  deleteBahanPenolong,
  getLookups,
};
