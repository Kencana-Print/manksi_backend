const poBahanService = require("../../services/pembelian/poBahanService");

const getBrowse = async (req, res) => {
  try {
    const data = await poBahanService.getBrowse(req.query);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getBrowseDetail = async (req, res) => {
  try {
    const data = await poBahanService.getBrowseDetail(req.params.nomor);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const deleteData = async (req, res) => {
  try {
    await poBahanService.deleteData(req.params.nomor);
    res.status(200).json({ success: true, message: "Data berhasil dihapus." });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const toggleClose = async (req, res) => {
  try {
    const userKode = req.user?.kode || "ADMIN";
    await poBahanService.toggleClose(req.body.nomor, req.body, userKode);
    res
      .status(200)
      .json({ success: true, message: "Status Close PO berhasil diubah." });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const requestPinEdit = async (req, res) => {
  try {
    const userKode = req.user?.kode || "ADMIN";
    await poBahanService.requestPinEdit(
      req.body.nomor,
      req.body.alasan,
      userKode,
    );
    res
      .status(200)
      .json({ success: true, message: "Pengajuan PIN berhasil dikirim." });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

module.exports = {
  getBrowse,
  getBrowseDetail,
  deleteData,
  toggleClose,
  requestPinEdit,
};
