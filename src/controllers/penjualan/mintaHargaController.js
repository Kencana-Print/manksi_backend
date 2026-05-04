const mintaHargaService = require("../../services/penjualan/mintaHargaService");

const getDivisi = async (req, res) => {
  try {
    const data = await mintaHargaService.getDivisiFilter(
      req.user.cabKaos,
      req.user.cabang,
    );
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getBrowseData = async (req, res) => {
  try {
    const { startDate, endDate, divisi } = req.query;
    // user detail: ambil dari req.user yang disediakan oleh verifyToken middleware
    const userInfo = {
      kode: req.user.kode,
      jabatan: req.user.jabatan || "",
      cabKaos: req.user.cabangKaos || "",
    };

    const data = await mintaHargaService.getBrowseData(
      startDate,
      endDate,
      divisi,
      userInfo,
    );
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const deleteData = async (req, res) => {
  try {
    await mintaHargaService.deleteData(req.params.nomor);
    res.status(200).json({ success: true, message: "Data berhasil dihapus." });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const getPengajuanEditStatus = async (req, res) => {
  try {
    const data = await mintaHargaService.checkPengajuanEdit(req.params.nomor);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const submitPengajuan = async (req, res) => {
  try {
    const { urut, alasan } = req.body;
    if (!alasan)
      return res
        .status(400)
        .json({ success: false, message: "Alasan harus diisi." });

    await mintaHargaService.submitPengajuanEdit(
      req.params.nomor,
      urut,
      alasan,
      req.user.kode,
    );
    res.status(200).json({
      success: true,
      message: "Berhasil diajukan. Menunggu ACC Pusat.",
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getDivisi,
  getBrowseData,
  deleteData,
  getPengajuanEditStatus,
  submitPengajuan,
};
