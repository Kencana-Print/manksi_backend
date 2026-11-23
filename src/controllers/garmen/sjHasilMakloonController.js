const service = require("../../services/garmen/sjHasilMakloonService");

const getOutstanding = async (req, res) => {
  try {
    const { startDate, endDate, cab, semuaCabang, keyword } = req.query;
    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: "Parameter startDate dan endDate wajib diisi.",
      });
    }
    const data = await service.getOutstanding({
      startDate,
      endDate,
      cab,
      semuaCabang,
      keyword,
    });
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getAvailableMaklon = async (req, res) => {
  try {
    const { cab, semuaCabang } = req.query;
    const data = await service.getAvailableMaklon({ cab, semuaCabang });
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getHistory = async (req, res) => {
  try {
    const { startDate, endDate, cab, semuaCabang, keyword } = req.query;
    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: "Parameter startDate dan endDate wajib diisi.",
      });
    }
    const data = await service.getHistory({
      startDate,
      endDate,
      cab,
      semuaCabang,
      keyword,
    });
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getCreateData = async (req, res) => {
  try {
    const ids = req.query.ids
      ? req.query.ids.split(",").map((s) => s.trim()).filter(Boolean)
      : [];
    const mklNomor = req.query.mklNomor || req.query.mkl_nomor || null;
    const data = await service.getCreateData({ ids, mklNomor });
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
  getAvailableMaklon,
  getHistory,
  getCreateData,
  create,
  getPrintData,
  getHistoryDetail,
};
