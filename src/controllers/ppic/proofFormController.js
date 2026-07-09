const svc = require("../../services/ppic/proofFormService");

const getMeta = async (req, res) => {
  try {
    const dropdowns = await svc.getDropdownOptions();
    res.status(200).json({
      success: true,
      data: {
        liniOptions: svc.LINI_OPTIONS,
        liniColumnVisibility: svc.LINI_COLUMN_VISIBILITY,
        dropdowns,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getDetail = async (req, res) => {
  try {
    const data = await svc.getDetail(req.params.nomor);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(404).json({ success: false, message: error.message });
  }
};

const searchSpk = async (req, res) => {
  try {
    const { q = "" } = req.query;
    const data = await svc.searchSpk(q);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getSpkInfo = async (req, res) => {
  try {
    const data = await svc.getSpkInfoForBlur(req.params.nomor);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const checkDuplikat = async (req, res) => {
  try {
    const { lini, spkNomor, excludeNomor } = req.query;
    const data = await svc.checkDuplikatLiniSpk(
      lini,
      spkNomor,
      excludeNomor || "",
    );
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const searchNomor = async (req, res) => {
  try {
    const { cab, q = "" } = req.query;
    const data = await svc.searchNomorProof(cab, q);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const loadBahan = async (req, res) => {
  try {
    const { kode, lini } = req.query;
    const data = await svc.loadBahanByKode(kode, lini);
    if (!data) {
      return res
        .status(404)
        .json({
          success: false,
          message: `Kode bahan tsb tidak terdaftar di lini ${lini}`,
        });
    }
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const searchBahan = async (req, res) => {
  try {
    const { lini, q = "" } = req.query;
    const data = await svc.searchBahan(lini, q);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const save = async (req, res) => {
  try {
    const userKode = req.user?.kode || "ADMIN";
    const result = await svc.saveData(req.body, userKode);
    res.status(200).json({
      success: true,
      message: `Berhasil disimpan dgn Nomor: ${result.nomor}`,
      data: result,
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

module.exports = {
  getMeta,
  getDetail,
  searchSpk,
  getSpkInfo,
  checkDuplikat,
  searchNomor,
  loadBahan,
  searchBahan,
  save,
};
