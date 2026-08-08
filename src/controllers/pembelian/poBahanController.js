const poBahanService = require("../../services/pembelian/poBahanService");

const getBrowse = async (req, res) => {
  try {
    const canLihatSup = Number(req.user?.flags?.lihatSup) === 1;
    const data = await poBahanService.getBrowse(req.query, canLihatSup);
    res.status(200).json({ success: true, data, canLihatSup });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getBrowseDetail = async (req, res) => {
  try {
    const canLihatBeli = Number(req.user?.flags?.lihatBeli) === 1;
    const data = await poBahanService.getBrowseDetail(
      req.params.nomor,
      canLihatBeli,
    );
    res.status(200).json({ success: true, data, canLihatBeli });
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

const getAllDetail = async (req, res) => {
  try {
    const canLihatSup = Number(req.user?.flags?.lihatSup) === 1;
    const canLihatBeli = Number(req.user?.flags?.lihatBeli) === 1;

    const data = await poBahanService.getAllDetail(
      req.query,
      canLihatSup,
      canLihatBeli,
    );
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getBrowse,
  getBrowseDetail,
  deleteData,
  toggleClose,
  requestPinEdit,
  getAllDetail,
};
