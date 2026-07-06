const userFormService = require("../../services/tools/userFormService");

const getFormData = async (req, res) => {
  try {
    const kode = req.params.kode || null;
    const data = await userFormService.getFormData(kode);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const checkKode = async (req, res) => {
  try {
    const exists = await userFormService.checkKodeExists(req.params.kode);
    res.status(200).json({ success: true, data: { exists } });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const searchUsers = async (req, res) => {
  try {
    const { q = "" } = req.query;
    const data = await userFormService.searchActiveUsers(q);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getPermissionsForCopy = async (req, res) => {
  try {
    const data = await userFormService.getPermissionsForCopy(req.params.kode);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const createUser = async (req, res) => {
  try {
    const result = await userFormService.saveUser(req.body, false);
    res
      .status(200)
      .json({
        success: true,
        message: "User berhasil disimpan.",
        data: result,
      });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const updateUser = async (req, res) => {
  try {
    const payload = { ...req.body, kode: req.params.kode };
    const result = await userFormService.saveUser(payload, true);
    res
      .status(200)
      .json({
        success: true,
        message: "User berhasil diupdate.",
        data: result,
      });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const deleteUser = async (req, res) => {
  try {
    await userFormService.deleteUser(req.params.kode);
    res.status(200).json({ success: true, message: "User berhasil dihapus." });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

module.exports = {
  getFormData,
  checkKode,
  searchUsers,
  getPermissionsForCopy,
  createUser,
  updateUser,
  deleteUser,
};
