const service = require("../../services/garmen/sjHasilMakloonService");

const getOutstanding = async (req, res) => {
  try {
    const { startDate, endDate, cab } = req.query;
    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: "Parameter startDate dan endDate wajib diisi.",
      });
    }
    const data = await service.getOutstanding({ startDate, endDate, cab });
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getHistory = async (req, res) => {
  try {
    const { startDate, endDate, cab } = req.query;
    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: "Parameter startDate dan endDate wajib diisi.",
      });
    }
    const data = await service.getHistory({ startDate, endDate, cab });
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getCreateData = async (req, res) => {
  try {
    const ids = (req.query.ids || "").split(",").filter(Boolean).map(Number);
    const data = await service.getCreateData(ids);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const create = async (req, res) => {
  try {
    const result = await service.createSjHasilMaklon(req.body, req.user);
    res.status(200).json({
      success: true,
      message: "SJ Hasil Maklon berhasil disimpan.",
      data: result,
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const getPrintData = async (req, res) => {
  try {
    const data = await service.getPrintData(req.params.nomor);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(404).json({ success: false, message: error.message });
  }
};

const getHistoryDetail = async (req, res) => {
  try {
    const data = await service.getHistoryDetail(req.params.nomor);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getOutstanding,
  getHistory,
  getCreateData,
  create,
  getPrintData,
  getHistoryDetail,
};
