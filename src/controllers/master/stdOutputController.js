const stdOutputService = require("../../services/master/stdOutputService");

const getBrowse = async (req, res) => {
  try {
    const data = await stdOutputService.getBrowse();
    res.status(200).json({ success: true, data: data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const update = async (req, res) => {
  try {
    await stdOutputService.update(req.body);
    res
      .status(200)
      .json({ success: true, message: "Standar Output berhasil diperbarui" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = { getBrowse, update };
