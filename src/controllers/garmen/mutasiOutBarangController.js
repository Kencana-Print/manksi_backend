const service = require("../../services/garmen/mutasiOutBarangService");

const getBrowse = async (req, res) => {
  try {
    const data = await service.getBrowse(req.query, req.user);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getBrowseDetail = async (req, res) => {
  try {
    const data = await service.getBrowseDetail(req.params.nomor);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const deleteData = async (req, res) => {
  try {
    await service.deleteData(req.params.nomor);
    res
      .status(200)
      .json({ success: true, message: "Data Mutasi Out berhasil dihapus." });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const requestPinEdit = async (req, res) => {
  try {
    const userKode = req.user?.kode || "ADMIN";
    await service.requestPinEdit(req.body, userKode);
    res
      .status(200)
      .json({
        success: true,
        message: "Pengajuan perubahan data berhasil dikirim.",
      });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

module.exports = {
  getBrowse,
  getBrowseDetail,
  deleteData,
  requestPinEdit,
};
