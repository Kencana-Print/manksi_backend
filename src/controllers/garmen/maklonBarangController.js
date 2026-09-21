const service = require("../../services/garmen/maklonBarangService");

const getBrowse = async (req, res) => {
  try {
    const data = await service.getBrowse(req.query);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getDetail = async (req, res) => {
  try {
    const data = await service.getDetail(req.params.nomor);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(404).json({ success: false, message: error.message });
  }
};

const deleteData = async (req, res) => {
  try {
    await service.deleteData(req.params.nomor, req.user.kode, req.user.cab);
    res
      .status(200)
      .json({ success: true, message: "Maklon berhasil dihapus." });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const pengajuanUbah = async (req, res) => {
  try {
    const result = await service.pengajuanUbah(
      req.params.nomor,
      req.body.alasan,
      req.user.kode,
    );
    res.status(200).json({
      success: true,
      message: "Pengajuan berhasil dikirim.",
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

module.exports = {
  getBrowse,
  getDetail,
  deleteData,
  pengajuanUbah,
  getPrintData,
};
