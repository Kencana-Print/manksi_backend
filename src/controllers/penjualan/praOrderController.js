const praOrderService = require("../../services/penjualan/praOrderService");

const getDivisi = async (req, res) => {
  try {
    const data = await praOrderService.getDivisiFilter(
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
    const userInfo = {
      kode: req.user.kode,
      jabatan: req.user.jabatan || "",
      cabKaos: req.user.cabangKaos || "",
      bagian: req.user.bagian || "",
      flags: req.user.flags || {},
    };
    const data = await praOrderService.getBrowseData(
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
    await praOrderService.deleteData(req.params.nomor);
    res.status(200).json({ success: true, message: "Data berhasil dihapus." });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const getPengajuanEditStatus = async (req, res) => {
  try {
    const data = await praOrderService.checkPengajuanEdit(req.params.nomor);
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

    await praOrderService.submitPengajuanEdit(
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
