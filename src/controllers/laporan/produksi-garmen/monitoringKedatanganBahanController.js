const svc = require("../../../services/laporan/produksi-garmen/monitoringKedatanganBahanService");

const getBrowse = async (req, res) => {
  try {
    const {
      startDate,
      endDate,
      cab = "P04",
      mapSpk = "ALL",
      ket = "",
    } = req.query;
    if (!startDate || !endDate) {
      return res
        .status(400)
        .json({ success: false, message: "Tgl. Permintaan wajib diisi." });
    }
    const data = await svc.getBrowse(startDate, endDate, cab, mapSpk, ket);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getDetail = async (req, res) => {
  try {
    const { spk, tglMinta } = req.params;
    const { cab = "P04" } = req.query;
    const data = await svc.getDetail(spk, tglMinta, cab);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getAllDetail = async (req, res) => {
  try {
    const {
      startDate,
      endDate,
      cab = "P04",
      mapSpk = "ALL",
      ket = "",
    } = req.query;
    if (!startDate || !endDate) {
      return res
        .status(400)
        .json({ success: false, message: "Tgl. Permintaan wajib diisi." });
    }
    const data = await svc.getAllDetail(startDate, endDate, cab, mapSpk, ket);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getFlattenedRows = async (req, res) => {
  try {
    const {
      startDate,
      endDate,
      cab = "P04",
      mapSpk = "ALL",
      ket = "",
    } = req.query;
    if (!startDate || !endDate) {
      return res
        .status(400)
        .json({ success: false, message: "Tgl. Permintaan wajib diisi." });
    }
    const data = await svc.getFlattenedRows(
      startDate,
      endDate,
      cab,
      mapSpk,
      ket,
    );
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { getBrowse, getDetail, getAllDetail, getFlattenedRows };
