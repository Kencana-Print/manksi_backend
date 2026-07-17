const service = require("../../services/ppic/spkFormService");
const fs = require("fs");

// --- Detail SPK PPIC (mode edit) ---
const getDetail = async (req, res) => {
  try {
    const { nomor } = req.query;
    if (!nomor)
      return res
        .status(400)
        .json({ success: false, message: "Nomor SPK wajib diisi." });

    const data = await service.getDetail(nomor);
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// --- Ambil data SO sebagai dasar create SPK PPIC baru ---
const getSoSource = async (req, res) => {
  try {
    const { soNomor } = req.query;
    if (!soNomor)
      return res
        .status(400)
        .json({ success: false, message: "Nomor SO wajib diisi." });

    const data = await service.getSoSourceDetail(soNomor);
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// --- Save (create & edit) ---
const save = async (req, res) => {
  try {
    if (!req.body.isEdit && !req.body.so_nomor) {
      return res
        .status(400)
        .json({ success: false, message: "No. SO sumber wajib dipilih." });
    }
    if (req.body.isEdit && !req.body.spk_nomor) {
      return res
        .status(400)
        .json({ success: false, message: "No. SPK wajib diisi." });
    }

    const result = await service.saveData(req.body, req.user);
    res.json({
      success: true,
      data: result,
      message: req.body.isEdit
        ? "SPK PPIC berhasil diubah."
        : "SPK PPIC baru berhasil dibuat.",
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const getInitSizes = async (req, res) => {
  try {
    const data = await service.getInitSizes();
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getStandarUkuran = async (req, res) => {
  try {
    const { joKode, varian } = req.query;
    const data = await service.getStandarUkuran(joKode, varian || "STANDAR");
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getMkbDetailBySpk = async (req, res) => {
  try {
    const { spkNomor } = req.query;
    if (!spkNomor)
      return res
        .status(400)
        .json({ success: false, message: "spkNomor wajib diisi." });
    const data = await service.getMkbDetailBySpk(spkNomor);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getKomponenMaster = async (req, res) => {
  try {
    const data = await service.getKomponenMaster(req.query.isBordir);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const importLayoutProses = async (req, res) => {
  try {
    if (!req.file) throw new Error("File Excel tidak ditemukan.");
    const { spkNomor } = req.body;
    if (!spkNomor) throw new Error("Nomor SPK wajib diisi.");

    const result = await service.importLayoutProses(spkNomor, req.file.path);

    if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);

    res.status(200).json({
      success: true,
      message: `Berhasil import: ${result.totalProof} baris proof, ${result.totalSewing} baris sewing.`,
      data: result,
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const getLayoutProses = async (req, res) => {
  try {
    const { spkNomor } = req.query;
    const data = await service.getLayoutProses(spkNomor);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getKeteranganKhusus = async (req, res) => {
  try {
    const { spkNomor } = req.query;
    const data = await service.getKeteranganKhusus(spkNomor);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getKetKomponenMaster = async (req, res) => {
  try {
    const data = await service.getKetKomponenMaster();
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getMkaFromMap = async (req, res) => {
  try {
    const { mapNomor } = req.params;
    const data = await service.getMkaFromMap(mapNomor);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getKomponenFromProof = async (req, res) => {
  try {
    const { identifier } = req.params;
    const data = await service.getKomponenFromProof(identifier);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = {
  getDetail,
  getSoSource,
  save,
  getInitSizes,
  getStandarUkuran,
  getMkbDetailBySpk,
  getKomponenMaster,
  importLayoutProses,
  getLayoutProses,
  getKeteranganKhusus,
  getKetKomponenMaster,
  getMkaFromMap,
  getKomponenFromProof,
};
