const formService = require("../../services/penjualan/sjMapFormService");

const getDetails = async (req, res) => {
  try {
    const data = await formService.getSjMapDetails(req.params.nomor);
    if (!data)
      return res
        .status(404)
        .json({ success: false, message: "Data tidak ditemukan." });
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getMapItem = async (req, res) => {
  try {
    const { nomorMap, cusKode, divisi } = req.query;
    const data = await formService.getMapItemDetails(nomorMap, cusKode, divisi);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const saveSj = async (req, res) => {
  try {
    const userKode = req.user?.kode || "ADMIN";
    const nomor = await formService.saveSjMap(req.body, userKode);
    res.status(200).json({
      success: true,
      message: `Berhasil disimpan dengan nomor ${nomor}`,
      nomor,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getPrintData = async (req, res) => {
  try {
    const data = await formService.getPrintData(req.params.nomor);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = { getDetails, getMapItem, saveSj, getPrintData };
