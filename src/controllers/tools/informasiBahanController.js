const svc = require("../../services/tools/informasiBahanService");

// GET /api/tools/sistem-informasi-bahan/search?keyword=&onlyWithStok=
const search = async (req, res) => {
  try {
    const { keyword = "", onlyWithStok = "true" } = req.query;
    const data = await svc.searchBahan(keyword, onlyWithStok !== "false");
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/tools/sistem-informasi-bahan/slow-moving?keyword=&minTahun=
const slowMoving = async (req, res) => {
  try {
    const { keyword = "", minTahun = "3" } = req.query;
    const data = await svc.getSlowMoving(keyword, minTahun);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/tools/sistem-informasi-bahan/reminder?keyword=&minTahun=&limit=
// Dipanggil dari form MAP/SPK/SO — tidak perlu izin ketat, cukup verifyToken.
const reminder = async (req, res) => {
  try {
    const { keyword = "", minTahun = "3", limit = "5" } = req.query;
    const data = await svc.getReminderKain(keyword, minTahun, limit);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/tools/sistem-informasi-bahan/kartu/:kode?startDate=&endDate=
const kartuPergerakan = async (req, res) => {
  try {
    const { kode } = req.params;
    const { startDate = null, endDate = null } = req.query;
    const data = await svc.getKartuPergerakan(kode, startDate, endDate);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = {
  search,
  slowMoving,
  reminder,
  kartuPergerakan,
};
