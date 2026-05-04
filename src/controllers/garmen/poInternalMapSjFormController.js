const formService = require("../../services/garmen/poInternalMapSjFormService");

const getById = async (req, res) => {
  try {
    const data = await formService.getById(req.params.nomor);
    if (!data)
      return res
        .status(404)
        .json({ success: false, message: "Data tidak ditemukan." });
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const loadPoItems = async (req, res) => {
  try {
    const { nomorPo, currentSj } = req.query;
    const data = await formService.loadPoItems(nomorPo, currentSj);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const save = async (req, res) => {
  try {
    const isNewMode =
      !req.body.Nomor || req.body.Nomor === "Baru= Nomor Otomatis";
    const userKode = req.user?.kode || "ADMIN";
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
    // Memanggil service untuk mengambil data Header & Detail gabungan
    const data = await formService.getPrintData(req.params.nomor);

    if (!data) {
      return res.status(404).json({
        success: false,
        message: "Data cetakan Surat Jalan tidak ditemukan.",
      });
    }

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

module.exports = { getById, loadPoItems, save, getPrintData };
