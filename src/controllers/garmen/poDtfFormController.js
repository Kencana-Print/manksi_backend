const formService = require("../../services/garmen/poDtfFormService");

const getMeta = async (req, res) => {
  try {
    res.status(200).json({
      success: true,
      data: { cabangOptions: formService.getCabangOptions(req.user) },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const resolveSupplier = async (req, res) => {
  try {
    const { kode } = req.params;
    const data = await formService.resolveSupplier(kode);
    if (!data) {
      return res
        .status(404)
        .json({
          success: false,
          message: "Supplier tsb tidak ada di database.",
        });
    }
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const resolveSpk = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await formService.resolveSpkManual(nomor);
    if (!data) {
      return res
        .status(404)
        .json({ success: false, message: "Spk ini belum ada." });
    }
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getFormData = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await formService.getFormData(nomor);
    if (!data) {
      return res
        .status(404)
        .json({ success: false, message: "Data tidak ditemukan." });
    }
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const buildFilesByField = (files) => {
  const map = {};
  (files || []).forEach((f) => {
    map[f.fieldname] = f;
  });
  return map;
};

const create = async (req, res) => {
  try {
    const payload = JSON.parse(req.body.data);
    const filesByField = buildFilesByField(req.files);
    const result = await formService.saveData(
      payload,
      filesByField,
      req.user,
      false,
    );
    res
      .status(201)
      .json({ success: true, data: result, message: "Berhasil disimpan." });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const update = async (req, res) => {
  try {
    const { nomor } = req.params;
    const payload = { ...JSON.parse(req.body.data), nomor };
    const filesByField = buildFilesByField(req.files);
    const result = await formService.saveData(
      payload,
      filesByField,
      req.user,
      true,
    );
    res
      .status(200)
      .json({ success: true, data: result, message: "Berhasil disimpan." });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

module.exports = {
  getMeta,
  resolveSupplier,
  resolveSpk,
  getFormData,
  create,
  update,
};
