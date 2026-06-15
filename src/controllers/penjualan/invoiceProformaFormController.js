const formService = require("../../services/penjualan/invoiceProformaFormService");

const getDetail = async (req, res) => {
  try {
    const data = await formService.getDetailForm(req.params.nomor);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const getUangMuka = async (req, res) => {
  try {
    const uangMuka = await formService.getUangMuka(req.params.nomor);
    res.status(200).json({ success: true, data: uangMuka });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const saveData = async (req, res) => {
  try {
    const result = await formService.saveData(req.body, req.user);
    res
      .status(200)
      .json({ success: true, data: result, message: "Berhasil disimpan." });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const getPerusahaanByKode = async (req, res) => {
  try {
    const data = await formService.getPerusahaanByKode(req.params.kode);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(404).json({ success: false, message: error.message });
  }
};

const getCustomerByKode = async (req, res) => {
  try {
    const data = await formService.getCustomerByKode(req.params.kode);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(404).json({ success: false, message: error.message });
  }
};

const getRekeningByNomor = async (req, res) => {
  try {
    const { rekening } = req.params;
    const { perushKode } = req.query;
    const data = await formService.getRekeningByNomor(rekening, perushKode);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(404).json({ success: false, message: error.message });
  }
};

const getBarangByKode = async (req, res) => {
  try {
    const { kode } = req.params;
    const { perushKode, cusKode } = req.query;
    const data = await formService.getBarangByKode(kode, perushKode, cusKode);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(404).json({ success: false, message: error.message });
  }
};

module.exports = {
  getDetail,
  getUangMuka,
  saveData,
  getPerusahaanByKode,
  getCustomerByKode,
  getRekeningByNomor,
  getBarangByKode,
};
