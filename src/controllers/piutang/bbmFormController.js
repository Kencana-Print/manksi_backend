const svc = require("../../services/piutang/bbmFormService");

const getAccountOptions = async (req, res) => {
  try {
    const { cabang } = req.query;
    const data = await svc.getAccountOptions(cabang);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getAccountAll = async (req, res) => {
  try {
    const data = await svc.getAccountAll();
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getCostCenterOptions = async (req, res) => {
  try {
    const data = await svc.getCostCenterOptions();
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getDcOptions = async (req, res) => {
  try {
    const { cckode } = req.query;
    const data = await svc.getDcOptions(cckode);
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
      { ...req.body, isEdit: false },
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
      { ...req.body, isEdit: true },
      { kode: userKode },
    );
    res.json({ success: true, data: result, message: "Berhasil diupdate." });
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
  getDetailForm,
  save,
  update,
  getPrintData,
};
