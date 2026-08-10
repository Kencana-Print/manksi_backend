const lhkSoDtfFormService = require("../../services/garmen/lhkSoDtfFormService");

const getDetail = async (req, res) => {
  try {
    const { cab, tanggal } = req.query;
    if (!cab || !tanggal) {
      return res.status(400).json({
        success: false,
        message: "Parameter cab dan tanggal wajib diisi.",
      });
    }
    const data = await lhkSoDtfFormService.getDetail(cab, tanggal);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res
      .status(error.statusCode || 500)
      .json({ success: false, message: error.message });
  }
};

const getDefaultCab = async (req, res) => {
  const userCab = req.user?.cab || "";
  const filterCab = req.query.filterCab || "ALL";
  res.status(200).json({
    success: true,
    data: { cab: lhkSoDtfFormService.getDefaultCab(userCab, filterCab) },
  });
};

const lookupSpkMap = async (req, res) => {
  try {
    const data = await lhkSoDtfFormService.lookupSpkMap(req.query.keyword);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const lookupSoDtf = async (req, res) => {
  try {
    const { keyword, page, limit } = req.query;
    const data = await lhkSoDtfFormService.lookupSoDtf(keyword, page, limit);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const validateKode = async (req, res) => {
  try {
    const data = await lhkSoDtfFormService.validateKode(req.params.kode);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res
      .status(error.statusCode || 500)
      .json({ success: false, message: error.message });
  }
};

const save = async (req, res) => {
  try {
    const { cab, tanggal, rows } = req.body;
    if (!cab || !tanggal) {
      return res.status(400).json({
        success: false,
        message: "Parameter cab dan tanggal wajib diisi.",
      });
    }
    const userKode = req.user?.kode || req.user?.username || "";
    const userCab = req.user?.cab || "";
    const result = await lhkSoDtfFormService.save(
      cab,
      tanggal,
      rows,
      userKode,
      userCab,
    );
    res
      .status(200)
      .json({ success: true, message: "Berhasil Simpan", data: result });
  } catch (error) {
    res
      .status(error.statusCode || 500)
      .json({ success: false, message: error.message });
  }
};

module.exports = {
  getDetail,
  getDefaultCab,
  lookupSpkMap,
  lookupSoDtf,
  validateKode,
  save,
};
