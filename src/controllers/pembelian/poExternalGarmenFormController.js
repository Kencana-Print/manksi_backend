const service = require("../../services/pembelian/poExternalGarmenFormService");

const getFormInit = async (req, res) => {
  try {
    const data = await service.getFormInit(req.user?.cabang || "");
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getForm = async (req, res) => {
  try {
    const data = await service.getForm(req.params.nomor);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(404).json({ success: false, message: error.message });
  }
};

const getSpkDetail = async (req, res) => {
  try {
    const isNewMode = req.query.isNewMode === "true";
    const data = await service.getSpkDetail(req.params.nomor, isNewMode);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res
      .status(400)
      .json({ success: false, message: error.message, code: error.code });
  }
};

const getSupplierDetail = async (req, res) => {
  try {
    const data = await service.getSupplierDetail(req.params.kode);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res
      .status(400)
      .json({ success: false, message: error.message, code: error.code });
  }
};

const save = async (req, res) => {
  try {
    const { isNewMode, data } = req.body;
    const result = await service.save(data, isNewMode, req.user.kode);
    res.status(200).json({
      success: true,
      data: result,
      message: "PO External berhasil disimpan.",
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const getCetak = async (req, res) => {
  try {
    const data = await service.getCetak(req.params.nomor);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(404).json({ success: false, message: error.message });
  }
};

module.exports = {
  getFormInit,
  getForm,
  getSpkDetail,
  getSupplierDetail,
  save,
  getCetak,
};
