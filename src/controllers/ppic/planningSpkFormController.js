// controllers/ppic/planningSpkFormController.js
const svc = require("../../services/ppic/planningSpkFormService");

const getFormDetail = async (req, res) => {
  try {
    const data = await svc.getFormDetail(req.params.nomor);
    if (!data)
      return res
        .status(404)
        .json({ success: false, message: "Data tidak ditemukan." });
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getSpkInfo = async (req, res) => {
  try {
    const { nomor } = req.query;
    if (!nomor)
      return res
        .status(400)
        .json({ success: false, message: "Nomor SPK wajib diisi." });
    const data = await svc.getSpkInfo(nomor);
    if (!data)
      return res.status(404).json({
        success: false,
        message: "SPK tidak ditemukan atau tidak aktif.",
      });
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Terima spkList sebagai query string: ?spk=SPK-001&spk=SPK-002
// atau body POST: { spkList: [], excludeNomor: "" }
const getRiwayatSpk = async (req, res) => {
  try {
    // Support GET dengan ?spk=A&spk=B atau POST dengan body
    let spkList = req.query.spk || req.body?.spkList || [];
    const excludeNomor = req.query.excludeNomor || req.body?.excludeNomor || "";

    if (!Array.isArray(spkList)) spkList = [spkList];
    if (!spkList.length) return res.json({ success: true, data: [] });

    const data = await svc.getRiwayatSpk(spkList, excludeNomor);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const saveData = async (req, res) => {
  try {
    const userKode = req.user?.kode || req.user?.username || "SYSTEM";
    const result = await svc.saveData(req.body, userKode);
    res.json({
      success: true,
      message: "Planning berhasil disimpan.",
      data: result,
    });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

// GET /api/ppic/planning-spk-form/qty-po?spkNomor=SPK-JA-KK-000001
const getQtyPoJasa = async (req, res) => {
  try {
    const { spkNomor } = req.query;
    if (!spkNomor)
      return res
        .status(400)
        .json({ success: false, message: "spkNomor wajib diisi." });
    const data = await svc.getQtyPoJasa(spkNomor);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = {
  getFormDetail,
  getSpkInfo,
  getRiwayatSpk,
  saveData,
  getQtyPoJasa,
};
