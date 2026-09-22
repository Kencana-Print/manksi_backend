const service = require("../../services/pembelian/uangMukaPenyelesaianService");

const getFormData = async (req, res) => {
  try {
    const data = await service.getFormData(req.params.nomor);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(404).json({ success: false, message: error.message });
  }
};

const getAccountOptions = async (req, res) => {
  try {
    const { jenis, cabang } = req.query;
    const data = await service.getAccountOptions(jenis, cabang);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getAllAccounts = async (req, res) => {
  try {
    const data = await service.getAllAccounts();
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getAccountByKode = async (req, res) => {
  try {
    const data = await service.getAccountByKode(req.params.kode);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getCostCenterOptions = async (req, res) => {
  try {
    const data = await service.getCostCenterOptions();
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getDcOptions = async (req, res) => {
  try {
    const data = await service.getDcOptions(req.query.cckode);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getSupplierOptions = async (req, res) => {
  try {
    const data = await service.getSupplierOptions(req.query.search || "");
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getListPengajuanGA = async (req, res) => {
  try {
    const data = await service.getListPengajuanGA(req.query.cabang);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getDetailPengajuanGA = async (req, res) => {
  try {
    const data = await service.getDetailPengajuanGA(req.params.pjhNomor);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getListPoExternal = async (req, res) => {
  try {
    const data = await service.getListPoExternal();
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getListVoucher = async (req, res) => {
  try {
    const data = await service.getListVoucher();
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getListPermintaanGarmen = async (req, res) => {
  try {
    const data = await service.getListPermintaanGarmen(req.query.cabang);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getDetailPermintaanGarmen = async (req, res) => {
  try {
    const data = await service.getDetailPermintaanGarmen(req.params.mbNomor);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getListInvoiceGarmen = async (req, res) => {
  try {
    const data = await service.getListInvoiceGarmen();
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getDetailInvoiceGarmen = async (req, res) => {
  try {
    const data = await service.getDetailInvoiceGarmen(req.params.ivNomor);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const createSupplier = async (req, res) => {
  try {
    const kode = await service.createSupplier(req.body, req.user.kode);
    res.status(200).json({ success: true, data: { kode } });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const updateStatusFinance = async (req, res) => {
  try {
    const { pmtNomor, nourut, status } = req.body;
    await service.updateStatusFinance(pmtNomor, nourut, status);
    res.status(200).json({ success: true });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const saveData = async (req, res) => {
  try {
    const data = await service.saveData(
      { ...req.body, nomor: req.params.nomor },
      req.user,
    );
    res.status(200).json({ success: true, data });
  } catch (error) {
    res
      .status(error.status || 500)
      .json({ success: false, message: error.message });
  }
};

module.exports = {
  getFormData,
  getAccountOptions,
  getAllAccounts,
  getAccountByKode,
  getCostCenterOptions,
  getDcOptions,
  getSupplierOptions,
  getListPengajuanGA,
  getDetailPengajuanGA,
  getListPoExternal,
  getListVoucher,
  getListPermintaanGarmen,
  getDetailPermintaanGarmen,
  getListInvoiceGarmen,
  getDetailInvoiceGarmen,
  createSupplier,
  updateStatusFinance,
  saveData,
};
