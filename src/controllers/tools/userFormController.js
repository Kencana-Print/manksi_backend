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
    res.status(200).json({
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
    res.status(200).json({
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

const searchHrd = async (req, res) => {
  try {
    const data = await userFormService.searchHrdKaryawan(req.query.q);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getRoleList = async (req, res) => {
  try {
    const data = await userFormService.getRoleList();
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getRole = async (req, res) => {
  try {
    const data = await userFormService.getRole(req.params.kode);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const getRoleAnggota = async (req, res) => {
  try {
    const data = await userFormService.getRoleAnggota(req.params.kode);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const pratinjauRole = async (req, res) => {
  try {
    const data = await userFormService.pratinjauRole(req.params.kode, req.body);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const saveRole = async (req, res) => {
  try {
    const data = await userFormService.saveRole(req.params.kode, req.body);
    res
      .status(200)
      .json({ success: true, message: "Role berhasil disimpan.", data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

module.exports = {
  getFormData,
  checkKode,
  searchUsers,
  getPermissionsForCopy,
  searchHrd,
  createUser,
  updateUser,
  deleteUser,
  getRoleList,
  getRole,
  getRoleAnggota,
  pratinjauRole,
  saveRole,
};
