const toleransiService = require("../../../services/spanduk/daftar/toleransiService");

const getBrowseToleransi = async (req, res) => {
  try {
    const data = await toleransiService.getBrowseToleransi();
    res.status(200).json({ success: true, data });
  } catch (error) {
    console.error("Error Browse Toleransi Spanduk:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

const getToleransiById = async (req, res) => {
  try {
    const data = await toleransiService.getToleransiById(req.params.kode);
    if (!data)
      return res
        .status(404)
        .json({ success: false, message: "Data tidak ditemukan." });
    res.status(200).json({ success: true, data });
  } catch (error) {
    console.error("Error Detail Toleransi Spanduk:", error);
    res.status(400).json({ success: false, message: error.message });
  }
};

const createToleransi = async (req, res) => {
  try {
    const kode = await toleransiService.createToleransi(req.body);
    res.status(201).json({
      success: true,
      message: `Tersimpan dengan kode: ${kode}`,
      data: { Kode: kode },
    });
  } catch (error) {
    console.error("Error Create Toleransi Spanduk:", error);
    res.status(400).json({ success: false, message: error.message });
  }
};

const updateToleransi = async (req, res) => {
  try {
    await toleransiService.updateToleransi(req.params.kode, req.body);
    res
      .status(200)
      .json({ success: true, message: "Perubahan berhasil disimpan." });
  } catch (error) {
    console.error("Error Update Toleransi Spanduk:", error);
    res.status(400).json({ success: false, message: error.message });
  }
};

const deleteToleransi = async (req, res) => {
  try {
    await toleransiService.deleteToleransi(req.params.kode);
    res.status(200).json({ success: true, message: "Data berhasil dihapus." });
  } catch (error) {
    console.error("Error Delete Toleransi Spanduk:", error);
    res.status(400).json({ success: false, message: error.message });
  }
};

const getLookups = async (req, res) => {
  try {
    const data = await toleransiService.getLookups(req.params.category);
    res.status(200).json({ success: true, data });
  } catch (error) {
    console.error("Error Lookup Toleransi Spanduk:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getBrowseToleransi,
  getToleransiById,
  createToleransi,
  updateToleransi,
  deleteToleransi,
  getLookups,
};
