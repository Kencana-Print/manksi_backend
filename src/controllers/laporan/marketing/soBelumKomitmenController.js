const soBelumKomitmenService = require("../../../services/laporan/marketing/soBelumKomitmenService");

const getBrowse = async (req, res) => {
  try {
    const data = await soBelumKomitmenService.getBrowse(req.query);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getCabang = async (req, res) => {
  try {
    const data = await soBelumKomitmenService.getCabangOptions();
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getDivisi = async (req, res) => {
  try {
    const data = await soBelumKomitmenService.getDivisiOptions();
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = { getBrowse, getCabang, getDivisi };
