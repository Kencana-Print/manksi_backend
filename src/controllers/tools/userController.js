const userService = require("../../services/tools/userService");

const getBrowse = async (req, res) => {
  try {
    const data = await userService.getBrowse();
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getById = async (req, res) => {
  try {
    const { kode } = req.params;
    const data = await userService.getById(kode);
    if (!data) {
      return res
        .status(404)
        .json({ success: false, message: "User tidak ditemukan" });
    }
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getBrowse,
  getById,
};
