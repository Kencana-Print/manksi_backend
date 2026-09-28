const svc = require("../../services/piutang/bbkFormService");

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

const getKeteranganOptions = async (req, res) => {
  try {
    const data = await svc.getKeteranganOptions();
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

const getSupplierOptions = async (req, res) => {
  try {
    const { search } = req.query;
    const data = await svc.getSupplierOptions(search);
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

const getOutstandingMintaBeli = async (req, res) => {
  try {
    const { keyword, jenis, page, limit } = req.query;
    const data = await svc.getOutstandingMintaBeli({
      keyword,
      jenis,
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 50,
    });
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getOutstandingMintaBeliDetail = async (req, res) => {
  try {
    const data = await svc.getOutstandingMintaBeliDetail(req.query.nomor);
    res.json({ success: true, data });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

module.exports = {
  getAccountOptions,
  getAccountAll,
  getKeteranganOptions,
  getCostCenterOptions,
  getDcOptions,
  getSupplierOptions,
  getDetailForm,
  save,
  update,
  getPrintData,
  getOutstandingMintaBeli,
  getOutstandingMintaBeliDetail,
};
