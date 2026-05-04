const formService = require("../../services/garmen/bastFormService");

const getBastDetails = async (req, res) => {
  try {
    // Ambil cabang user untuk pengecekan Global Lock (Maks 6 Hari)
    const userCabang = req.user?.cabang || "P04";

    // Passing userCabang ke service
    const data = await formService.getBastFormData(
      req.params.nomor,
      userCabang,
    );

    if (!data)
      return res
        .status(404)
        .json({ success: false, message: "Data MAP tidak ditemukan." });

    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const saveBast = async (req, res) => {
  try {
    const userKode = req.user?.kode || "ADMIN";
    const userCabang = req.user?.cabang || "P04";
    await formService.saveBastData(req.body, userKode, userCabang);
    res
      .status(200)
      .json({ success: true, message: "Data BAST berhasil disimpan." });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const getPrintData = async (req, res) => {
  try {
    const data = await formService.getPrintData(req.params.nomor);
    if (!data)
      return res
        .status(404)
        .json({ success: false, message: "Data tidak ditemukan." });
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getSpkSizes = async (req, res) => {
  try {
    const data = await formService.getSpkSizes(req.params.nomor);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getBastDetails,
  saveBast,
  getPrintData,
  getSpkSizes,
};
