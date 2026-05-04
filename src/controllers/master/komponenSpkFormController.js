const formService = require("../../services/master/komponenSpkFormService");

const getLoadData = async (req, res) => {
  try {
    const data = await formService.getFormLoadData(req.query.nomor);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const getLookupBahan = async (req, res) => {
  try {
    const data = await formService.getLookupBahanLL(req.query.isBordir);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const saveForm = async (req, res) => {
  try {
    await formService.saveForm(req.body.NomorSPK, req.body);
    res
      .status(200)
      .json({ success: true, message: "Komponen SPK berhasil disimpan" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = { getLoadData, getLookupBahan, saveForm };
