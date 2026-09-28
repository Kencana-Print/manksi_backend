const svc = require("../../services/piutang/terimaSetoranFormService");

const getForm = async (req, res) => {
  try {
    const data = await svc.getForm(req.params.nomor);
    res.json({ success: true, data });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const saveForm = async (req, res) => {
  try {
    const userLogin = req.user?.kode || req.user?.user_kode || "";
    await svc.saveForm(req.params.nomor, req.body, userLogin);
    res.json({ success: true, message: "Berhasil disimpan." });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

module.exports = { getForm, saveForm };
