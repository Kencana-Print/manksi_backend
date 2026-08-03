const service = require("../../services/penjualan/salesOrderService");

const getBrowse = async (req, res) => {
  try {
    const canLihatCus = Number(req.user?.flags?.lihatCus) === 1;
    const canLihatHarga = Number(req.user?.flags?.lihatHarga) === 1;
    const filters = {
      startDate: req.query.startDate,
      endDate: req.query.endDate,
      workshop: req.query.workshop,
      customer: req.query.customer,
      userCabang: req.user.cabang,
      canLihatCus,
      canLihatHarga,
    };
    const data = await service.getBrowseList(filters);
    res.json({ success: true, data, canLihatCus, canLihatHarga });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const deleteOrder = async (req, res) => {
  try {
    await service.deleteOrder(req.params.nomor, req.user);
    res.json({ success: true, message: "Sales Order berhasil dihapus." });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const toggleClose = async (req, res) => {
  try {
    const { nomor } = req.params;
    const { alasan, isClose } = req.body;
    await service.toggleStatus(nomor, alasan, isClose);
    res.json({
      success: true,
      message: `Status berhasil diubah ke ${isClose ? "Closed" : "Open"}.`,
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const requestPin = async (req, res) => {
  try {
    const { nomor } = req.params;
    const { alasan } = req.body;
    await service.requestPin(nomor, alasan, req.user.kode);
    res.json({ success: true, message: "Pengajuan PIN berhasil dikirim." });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getSizes = async (req, res) => {
  try {
    const { nomor } = req.params; // Mengambil nomor dari URL parameter
    if (!nomor) {
      return res
        .status(400)
        .json({ success: false, message: "Nomor SO wajib disertakan." });
    }

    const data = await service.getSizes(nomor);
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Handler untuk Approve CMO
const approveCmo = async (req, res) => {
  try {
    const { nomor } = req.params;

    // Ambil flags dari payload JWT (hasil dari authService)
    const flags = req.user.flags || {};

    // Cek apakah user punya hak CMO (cmo umum ATAU cmo3 khusus Kaosan)
    // Asumsi nilai di DB adalah 1 (True) atau "Y"
    const isCmo =
      flags.cmo === 1 ||
      flags.cmo === "Y" ||
      flags.cmo3 === 1 ||
      flags.cmo3 === "Y";

    if (!isCmo) {
      return res.status(403).json({
        success: false,
        message: "Akses ditolak. Anda tidak memiliki hak sebagai CMO.",
      });
    }

    await service.approveCmo(nomor, req.user.kode);
    res.json({ success: true, message: "Berhasil di-approve." });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getPendingDesigns = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const data = await service.getPendingDesigns(startDate, endDate);
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const updateDesignStatus = async (req, res) => {
  try {
    const { listNomor } = req.body; // array of string (nomor SPK)
    await service.updateDesignStatus(listNomor);
    res.json({ success: true, message: "Status desain berhasil diperbarui." });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getPembatalanDetail = async (req, res) => {
  try {
    const { fbNomor, spkNomor } = req.query;
    if (!fbNomor && !spkNomor) {
      return res.status(400).json({
        success: false,
        message: "fbNomor atau spkNomor wajib diisi.",
      });
    }
    const data = await service.getPembatalanDetail(fbNomor, spkNomor);
    res.json({ success: true, data });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const ajukanPembatalan = async (req, res) => {
  try {
    const userKode = req.user?.kode || req.user?.user_kode || "";
    const result = await service.ajukanPembatalan(req.body, userKode);
    res.json({
      success: true,
      data: result,
      message: "Pengajuan pembatalan berhasil disimpan.",
    });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const getGantiQtyKainStatus = async (req, res) => {
  try {
    const { nomor } = req.query;
    if (!nomor) {
      return res
        .status(400)
        .json({ success: false, message: "Nomor wajib diisi." });
    }
    const data = await service.getGantiQtyKainStatus(nomor);
    res.json({ success: true, data });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const ajukanGantiQtyKain = async (req, res) => {
  try {
    const { nomor, alasan } = req.body;
    if (!nomor) {
      return res
        .status(400)
        .json({ success: false, message: "Nomor wajib diisi." });
    }
    const userKode = req.user?.kode || req.user?.user_kode || "";
    const result = await service.ajukanGantiQtyKain(nomor, alasan, userKode);
    res.json({
      success: true,
      data: result,
      message: "Pengajuan berhasil. Menunggu ACC.",
    });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

module.exports = {
  getBrowse,
  getSizes,
  deleteOrder,
  toggleClose,
  requestPin,
  approveCmo,
  getPendingDesigns,
  updateDesignStatus,
  getPembatalanDetail,
  ajukanPembatalan,
  getGantiQtyKainStatus,
  ajukanGantiQtyKain,
};
