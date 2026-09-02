const service = require("../../services/garmen/poInternalSpkFormService");

const getDefaultGudang = async (req, res) => {
  try {
    const data = await service.getDefaultGudang(req.user.cabang);
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const checkPabrik = async (req, res) => {
  try {
    const { kode, other } = req.query;
    const data = await service.checkPabrik(kode, other);
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const checkSpk = async (req, res) => {
  try {
    const { nomor } = req.query;
    const data = await service.checkSpk(nomor);
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const checkJasa = async (req, res) => {
  try {
    const { kode, nomorSpk } = req.query;
    const data = await service.checkJasa(kode, nomorSpk);
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const loadBahan = async (req, res) => {
  try {
    const data = await service.loadBahan(req.body);
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const loadAccesories = async (req, res) => {
  try {
    const data = await service.loadAccesories(req.body);
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const getById = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await service.getDetailForm(decodeURIComponent(nomor));
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const save = async (req, res) => {
  try {
    const result = await service.saveData(req.body, req.user);
    res.json({
      success: true,
      message: "Data PO Internal SPK berhasil disimpan.",
      data: result,
    });
  } catch (error) {
    const statusCode = error.message.includes("sudah Close") ? 403 : 400;
    res.status(statusCode).json({ success: false, message: error.message });
  }
};

const getPrintData = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await service.getPrintData(decodeURIComponent(nomor));
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getDefaultGudang,
  checkPabrik,
  checkSpk,
  checkJasa,
  loadBahan,
  loadAccesories,
  getById,
  save,
  getPrintData,
};
