const sublimService = require("../../../services/mmt/lhk/lhkPaperprintService");

const getLhkList = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const data = await sublimService.getAllHeaders(startDate, endDate);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getLhkDetails = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await sublimService.getDetailsByNomor(nomor);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getLhkFullData = async (req, res) => {
  try {
    const { nomor } = req.params;
    // Mengasumsikan service memiliki fungsi getLhkByNomor untuk mode EDIT
    const data = await sublimService.getLhkByNomor(nomor);

    if (!data) {
      return res
        .status(404)
        .json({ success: false, message: "Data LHK Sublim tidak ditemukan." });
    }

    res.json({ success: true, data: data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const handleSaveLhk = async (req, res) => {
  try {
    const result = await sublimService.saveLhkMesin(req.body);

    if (!result.success) {
      return res.status(500).json(result);
    }

    return res.json({
      success: true,
      message: "Data LHK Sublim berhasil disimpan.",
      nomor: result.nomor,
    });
  } catch (error) {
    console.error("Error Saving LHK Sublim:", error);
    return res.status(500).json({
      success: false,
      message: `Gagal menyimpan data LHK Sublim. Error: ${error.message}`,
    });
  }
};

const accLhk = async (req, res) => {
  try {
    const { nomor } = req.params;
    const userAction = req.user?.username || "SYSTEM";

    const result = await sublimService.accLhkPaperprint(nomor, userAction);

    return res.status(200).json({
      success: true,
      message: `LHK Paperprint/Sublim ${nomor} berhasil di-ACC.`,
      data: result,
    });
  } catch (error) {
    console.error("Error ACC LHK Paperprint:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Gagal memproses ACC LHK Paperprint.",
    });
  }
};

const removeLhk = async (req, res) => {
  try {
    const { nomor } = req.params;
    await sublimService.deleteLhk(nomor);
    res.json({ success: true, message: "Berhasil dihapus." });
  } catch (error) {
    res
      .status(500)
      .json({ success: false, message: "Gagal menghapus data LHK Sublim." });
  }
};

const getNextNumber = async (req, res) => {
  try {
    const { date } = req.query;
    const nomor = await sublimService.generateNewNomor(date);
    res.json({ success: true, nomor });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getApprovalList = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const data = await sublimService.getAllApprovalHeaders(startDate, endDate);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getApprovalDetails = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await sublimService.getApprovalDetailsByNomor(nomor);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// 🌟 FUNGSI BARU UNTUK LOOKUP PAPERPRINT
const getLookupPaperprint = async (req, res) => {
  try {
    const { startDate, endDate, search } = req.query;
    const data = await sublimService.getLookupLhkPaperprint(
      startDate,
      endDate,
      search,
    );
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  getLhkList,
  getLhkDetails,
  getLhkFullData,
  handleSaveLhk,
  removeLhk,
  getNextNumber,
  getApprovalList,
  getApprovalDetails,
  accLhk,
  getLookupPaperprint, // 🌟 Ekspor fungsi baru
};
