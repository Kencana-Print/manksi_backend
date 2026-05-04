const formService = require("../../services/garmen/poInternalMapFormService");

const getById = async (req, res) => {
  try {
    const data = await formService.getById(req.params.nomor);
    if (!data) {
      return res.status(404).json({
        success: false,
        message: "Data PO Internal MAP tidak ditemukan.",
      });
    }
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const validateMap = async (req, res) => {
  try {
    const { kodeMap, currentPo } = req.body;
    if (!kodeMap) {
      return res
        .status(400)
        .json({ success: false, message: "Kode MAP wajib diisi." });
    }

    const result = await formService.validateMapCode(kodeMap, currentPo);
    res
      .status(200)
      .json({ success: true, data: result.data, warning: result.warning });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const save = async (req, res) => {
  try {
    const isNewMode =
      !req.body.Nomor || req.body.Nomor === "Baru= Nomor Otomatis";
    const userKode = req.user?.kode || "ADMIN"; // Dari token JWT

    const savedNomor = await formService.save(req.body, userKode, isNewMode);

    res.status(200).json({
      success: true,
      message: "Data berhasil disimpan.",
      nomor: savedNomor,
    });
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

module.exports = {
  getById,
  validateMap,
  save,
  getPrintData,
};
