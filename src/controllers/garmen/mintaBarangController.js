const mintaBarangService = require("../../services/garmen/mintaBarangService");

const getBrowse = async (req, res) => {
  try {
    const { startDate, endDate, cabang, jenis } = req.query;
    if (!startDate || !endDate || !jenis) {
      return res.status(400).json({
        success: false,
        message: "Parameter startDate, endDate, dan jenis wajib diisi.",
      });
    }

    const data = await mintaBarangService.getBrowseData(
      startDate,
      endDate,
      cabang,
      jenis,
      req.user,
    );
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const deleteData = async (req, res) => {
  try {
    const { nomor } = req.params;
    await mintaBarangService.deleteData(nomor, req.user.cabang);
    res.status(200).json({ success: true, message: "Berhasil dihapus." });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const closeData = async (req, res) => {
  try {
    const { nomor, alasan } = req.body;
    if (!alasan) {
      return res
        .status(400)
        .json({ success: false, message: "Alasan close wajib diisi." });
    }
    await mintaBarangService.closeData({ nomor, alasan }, req.user);
    res.status(200).json({ success: true, message: "Berhasil diclose." });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const requestEdit = async (req, res) => {
  try {
    if (!req.body.alasan) {
      return res
        .status(400)
        .json({ success: false, message: "Alasan pengajuan wajib diisi." });
    }
    await mintaBarangService.ajukanPerubahan(req.body, req.user);
    res
      .status(200)
      .json({ success: true, message: "Berhasil diajukan. Menunggu ACC." });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const checkBlockApprove = async (req, res) => {
  try {
    const isBlocked = await mintaBarangService.checkUnapprovedRealisasi(
      req.user.kode,
      req.user.cabang, // <--- TAMBAHKAN INI AGAR BYPASS CABANG BERFUNGSI
    );
    res.status(200).json({ success: true, isBlocked });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const approveRealisasi = async (req, res) => {
  try {
    const { nomor } = req.body; // nomor = No. Realisasi
    if (!nomor) {
      return res
        .status(400)
        .json({ success: false, message: "Nomor realisasi wajib dikirim." });
    }

    await mintaBarangService.approveRealisasi(nomor, req.user.cabang);
    res.status(200).json({ success: true, message: "Berhasil diapprove." });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

module.exports = {
  getBrowse,
  deleteData,
  closeData,
  requestEdit,
  checkBlockApprove,
  approveRealisasi,
};
