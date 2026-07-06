const service = require("../../services/ppic/spkService");

const getBrowse = async (req, res) => {
  try {
    const filters = {
      startDate: req.query.startDate,
      endDate: req.query.endDate,
      workshop: req.query.workshop,
      customer: req.query.customer,
      userCabang: req.user.cabang,
    };
    const data = await service.getBrowseList(filters);
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getSizes = async (req, res) => {
  try {
    const { nomor } = req.params;
    if (!nomor)
      return res
        .status(400)
        .json({ success: false, message: "Nomor SPK wajib disertakan." });
    const data = await service.getSizes(nomor);
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const deleteSpk = async (req, res) => {
  try {
    await service.deleteSpk(req.params.nomor, req.user);
    res.json({ success: true, message: "SPK berhasil dihapus." });
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

const approveCmo = async (req, res) => {
  try {
    const { nomor } = req.params;
    const flags = req.user.flags || {};
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

const checkPrintPermission = async (req, res) => {
  try {
    const data = await service.checkPrintPermission(req.params.nomor);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const requestPrintApproval = async (req, res) => {
  try {
    const { alasan } = req.body;
    const userKode = req.user?.kode || "ADMIN";
    await service.requestPrintApproval(req.params.nomor, alasan, userKode);
    res
      .status(200)
      .json({ success: true, message: "Pengajuan approval cetak dikirim." });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const recordPrint = async (req, res) => {
  try {
    await service.recordPrint(req.params.nomor);
    res.status(200).json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getBrowse,
  getSizes,
  deleteSpk,
  toggleClose,
  requestPin,
  approveCmo,
  checkPrintPermission,
  requestPrintApproval,
  recordPrint,
};
