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

const getSewingReferensi = async (req, res) => {
  try {
    const { tgl1, tgl2, lines, spkList } = req.body || {};

    if (!tgl1 || !tgl2) {
      return res
        .status(400)
        .json({ success: false, message: "tgl1 dan tgl2 wajib diisi" });
    }
    if (tgl1 > tgl2) {
      return res
        .status(400)
        .json({ success: false, message: "tgl1 tidak boleh melewati tgl2" });
    }
    if (
      (lines && !Array.isArray(lines)) ||
      (spkList && !Array.isArray(spkList))
    ) {
      return res
        .status(400)
        .json({ success: false, message: "lines dan spkList harus array" });
    }

    const uniq = (arr) => [...new Set((arr || []).filter(Boolean))];
    const lineList = uniq(lines);
    const spks = uniq(spkList);

    if (lineList.length > 50 || spks.length > 200) {
      return res
        .status(400)
        .json({ success: false, message: "Jumlah line/SPK terlalu banyak" });
    }

    const data = await svc.getSewingReferensi({
      tgl1,
      tgl2,
      lines: lineList,
      spkList: spks,
      withActual: true,
    });

    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/ppic/planning-spk-form/kelompok?lini=POTONG&cab=P04
const getKelompok = async (req, res) => {
  try {
    const lini = String(req.query.lini || "POTONG").toUpperCase();
    const cab = String(req.query.cab || "P04").toUpperCase();
    if (!["POTONG", "JAHIT"].includes(lini)) {
      return res
        .status(400)
        .json({ success: false, message: "Lini tidak dikenali." });
    }
    const data = await svc.getKelompokList(lini, cab);
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
  getSewingReferensi,
  getKelompok,
};
