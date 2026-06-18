const service = require("../../../services/laporan/marketing/rekapMapService");

const getRekap = async (req, res) => {
  try {
    const data = await service.getRekap(req.query);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getDetail = async (req, res) => {
  try {
    const data = await service.getDetail(req.query);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const updateNote = async (req, res) => {
  try {
    const affected = await service.updateNote(req.body);
    res.status(200).json({ success: true, data: { affected } });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = { getRekap, getDetail, updateNote };
