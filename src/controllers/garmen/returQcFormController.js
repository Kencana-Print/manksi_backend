const service = require("../../services/garmen/returQcFormService");

const getQcSiap = async (req, res) => {
  try {
    const data = await service.getQcRejectSiap();
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getLotReject = async (req, res) => {
  try {
    const { qcNomor } = req.query;
    if (!qcNomor) {
      return res
        .status(400)
        .json({ success: false, message: "Parameter qcNomor wajib diisi." });
    }
    const data = await service.getLotReject(String(qcNomor));
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const getFormData = async (req, res) => {
  try {
    const data = await service.getFormData(req.params.nomor);
    res.json({ success: true, data });
  } catch (error) {
    res.status(404).json({ success: false, message: error.message });
  }
};

const create = async (req, res) => {
  try {
    const data = await service.create(req.body, req.user.kode);
    res.json({
      success: true,
      data,
      message: `Tersimpan dengan nomor ${data.nomor}`,
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const update = async (req, res) => {
  try {
    const data = await service.update(
      req.params.nomor,
      req.body,
      req.user.kode,
    );
    res.json({
      success: true,
      data,
      message: `Tersimpan dengan nomor ${data.nomor}`,
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

module.exports = { getQcSiap, getLotReject, getFormData, create, update };
