const service = require("../../services/piutang/pelunasanService");

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
    const { nomor } = req.params;
    if (!nomor)
      return res
        .status(400)
        .json({ success: false, message: "Nomor wajib dikirim." });

    const data = await service.getDetail(decodeURIComponent(nomor));
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getAllDetail = async (req, res) => {
  try {
    const data = await service.getAllDetail(req.query);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const deletePelunasan = async (req, res) => {
  try {
    const { nomor } = req.params;
    if (!nomor)
      return res
        .status(400)
        .json({ success: false, message: "Nomor wajib dikirim." });

    await service.deletePelunasan(decodeURIComponent(nomor));
    res
      .status(200)
      .json({ success: true, message: "Data pelunasan berhasil dihapus." });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Cek kelayakan sebelum memunculkan modal Alasan (FormCreate Delphi)
const checkKelayakanPengajuan = async (req, res) => {
  try {
    const { nomor } = req.params;
    await service.checkKelayakanPengajuan(decodeURIComponent(nomor));
    res.status(200).json({ success: true, message: "Bisa diajukan." });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// Submit pengajuan PIN5 (btnAjukkanClick Delphi)
const requestPin5 = async (req, res) => {
  try {
    const { nomor } = req.params;
    const { alasan } = req.body;
    const userKode = req.user.kode; // Dari token middleware

    if (!alasan)
      return res
        .status(400)
        .json({ success: false, message: "Alasan wajib diisi." });

    await service.requestPin5(decodeURIComponent(nomor), alasan, userKode);
    res
      .status(200)
      .json({ success: true, message: "Berhasil diajukan. Menunggu ACC." });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getBrowse,
  getDetail,
  getAllDetail,
  deletePelunasan,
  checkKelayakanPengajuan,
  requestPin5,
};
