const service = require("../../services/system/versionService");

const getVersion = (req, res) => {
  try {
    const data = service.getVersionInfo();
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = { getVersion };
