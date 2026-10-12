const qcBahanService = require("../../services/garmen/qcBahanService");
const { bolehGudang, tolakHak } = require("./qcAkses");

const browseData = async (req, res) => {
  try {
    const { startDate, endDate, status = "ALL" } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: "startDate dan endDate wajib diisi.",
      });
    }

    const data = await qcBahanService.getBrowse(startDate, endDate, status);

    res.status(200).json({ success: true, data });
  } catch (error) {
    console.error("Error Browse QC Bahan:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

const getBrowseDetail = async (req, res) => {
  try {
    const nomor = decodeURIComponent(req.params.nomor);
    const data = await qcBahanService.getBrowseDetail(nomor);

    res.status(200).json({ success: true, data });
  } catch (error) {
    console.error("Error Browse Detail QC Bahan:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

const deleteData = async (req, res) => {
  try {
    if (!bolehGudang(req.user)) return tolakHak(res);

    const nomor = decodeURIComponent(req.params.nomor);
    await qcBahanService.deleteQc(nomor);

    res.status(200).json({ success: true, message: "Data berhasil dihapus" });
  } catch (error) {
    console.error("Error Delete QC Bahan:", error);
    res.status(400).json({ success: false, message: error.message });
  }
};

const requestPin = async (req, res) => {
  try {
    if (!bolehGudang(req.user)) return tolakHak(res);

    const { nomor, alasan } = req.body;
    const userKode = req.user?.kode || "SYSTEM";

    if (!nomor) {
      return res
        .status(400)
        .json({ success: false, message: "Nomor wajib diisi." });
    }
    if (!alasan || alasan.trim() === "") {
      return res
        .status(400)
        .json({ success: false, message: "Alasan pengajuan wajib diisi." });
    }

    await qcBahanService.requestPinPerubahan(nomor, alasan, userKode);

    res.status(200).json({
      success: true,
      message: "Berhasil diajukan. Menunggu ACC.",
    });
  } catch (error) {
    console.error("Error Request PIN QC Bahan:", error);
    res.status(400).json({ success: false, message: error.message });
  }
};

const submitData = async (req, res) => {
  try {
    if (!bolehGudang(req.user)) return tolakHak(res);

    const data = await qcBahanService.submitQc(
      decodeURIComponent(req.params.nomor),
      req.user?.kode || "ADMIN",
      req.body?.lanjut,
    );
    res.status(200).json({
      success: true,
      message: "Dokumen berhasil disubmit.",
      data,
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

module.exports = {
  browseData,
  getBrowseDetail,
  deleteData,
  requestPin,
  submitData,
};
