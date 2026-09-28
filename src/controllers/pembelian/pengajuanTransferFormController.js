const svc = require("../../services/pembelian/pengajuanTransferFormService");

const getAccountOptions = async (req, res) => {
  try {
    const data = await svc.getAccountOptions();
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getAccountAll = async (req, res) => {
  try {
    const { search } = req.query;
    const data = await svc.getAccountAll(search);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getCostCenterOptions = async (req, res) => {
  try {
    const { search } = req.query;
    const data = await svc.getCostCenterOptions(search);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getDcOptions = async (req, res) => {
  try {
    const { cckode, search } = req.query;
    const data = await svc.getDcOptions(cckode, search);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getSupplierOptions = async (req, res) => {
  try {
    const { search } = req.query;
    const data = await svc.getSupplierOptions(search);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getSupplierDetail = async (req, res) => {
  try {
    const { kode } = req.query;
    const data = await svc.getSupplierDetail(kode);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getVoucherOptions = async (req, res) => {
  try {
    const { search } = req.query;
    const data = await svc.getVoucherOptions(search);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getPoExternalOptions = async (req, res) => {
  try {
    const { search } = req.query;
    const data = await svc.getPoExternalOptions(search);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getPettyCashOptions = async (req, res) => {
  try {
    const { search } = req.query;
    const data = await svc.getPettyCashOptions(search);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getDetailForm = async (req, res) => {
  try {
    const data = await svc.getDetailForm(req.query.nomor);
    res.json({ success: true, data });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const save = async (req, res) => {
  try {
    const userKode = req.user?.kode || req.user?.user_kode || "";
    const result = await svc.saveData(
      { ...req.body, isEdit: false, isRealisasi: false },
      { kode: userKode },
    );
    res.json({ success: true, data: result, message: "Berhasil disimpan." });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const update = async (req, res) => {
  try {
    const userKode = req.user?.kode || req.user?.user_kode || "";
    const result = await svc.saveData(
      { ...req.body, isEdit: true, isRealisasi: false },
      { kode: userKode },
    );
    res.json({ success: true, data: result, message: "Berhasil diupdate." });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const realisasi = async (req, res) => {
  try {
    const userKode = req.user?.kode || req.user?.user_kode || "";
    const result = await svc.saveData(
      { ...req.body, isEdit: false, isRealisasi: true },
      { kode: userKode },
    );
    res.json({
      success: true,
      data: result,
      message: "Realisasi berhasil disimpan.",
    });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const getPrintData = async (req, res) => {
  try {
    const data = await svc.getPrintData(req.query.nomor);
    res.json({ success: true, data });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

module.exports = {
  getAccountOptions,
  getAccountAll,
  getCostCenterOptions,
  getDcOptions,
  getSupplierOptions,
  getSupplierDetail,
  getVoucherOptions,
  getPoExternalOptions,
  getPettyCashOptions,
  getDetailForm,
  save,
  update,
  realisasi,
  getPrintData,
};
