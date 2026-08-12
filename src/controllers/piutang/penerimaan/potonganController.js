const service = require("../../../services/piutang/penerimaan/potonganService");

const getBrowse = async (req, res) => {
  try {
    const userFlags = { lihatCus: req.user?.flags?.lihatCus };
    const data = await service.getBrowseList(req.query, userFlags);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const deletePotongan = async (req, res) => {
  try {
    await service.deletePotongan(req.params.nomor);
    res.status(200).json({ success: true, message: "Berhasil dihapus." });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const checkPengajuan = async (req, res) => {
  try {
    await service.checkKelayakanPengajuan(req.params.nomor);
    res.status(200).json({ success: true, message: "Layak mengajukan" });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const requestPin = async (req, res) => {
  try {
    const { nomor, alasan } = req.body;
    await service.requestPin5(nomor, alasan, req.user.kode);
    res
      .status(200)
      .json({ success: true, message: "Berhasil diajukan. Menunggu ACC." });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const updatePph23 = async (req, res) => {
  try {
    await service.updatePph23(req.params.nomor, req.body);
    res
      .status(200)
      .json({ success: true, message: "PPh23 berhasil diupdate." });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

module.exports = {
  getBrowse,
  deletePotongan,
  checkPengajuan,
  requestPin,
  updatePph23,
};
