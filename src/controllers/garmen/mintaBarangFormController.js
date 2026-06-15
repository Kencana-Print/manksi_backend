const formService = require("../../services/garmen/mintaBarangFormService");

const validateSpk = async (req, res) => {
  try {
    const data = await formService.validateSpkAndMka(
      req.params.spk,
      req.user.cabang,
      req.user.kode,
    );
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const getDetail = async (req, res) => {
  try {
    const data = await formService.getDetailForm(
      req.params.nomor,
      req.user.cabang,
    );
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const save = async (req, res) => {
  try {
    if (!req.body.details || req.body.details.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Detail barang tidak boleh kosong.",
      });
    }
    const result = await formService.saveData(req.body, req.user);
    res.status(200).json({
      success: true,
      message: "Data berhasil disimpan.",
      data: result,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ── Lookup Gudang by Kode ──
const getGudangByKode = async (req, res) => {
  try {
    const { kode } = req.params;
    const { cabang } = req.query;

    if (!kode) {
      return res
        .status(400)
        .json({ success: false, message: "Kode gudang wajib diisi." });
    }

    const data = await formService.getGudangByKode(kode, cabang || "");
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(404).json({ success: false, message: error.message });
  }
};

// ── Lookup Barang by Kode ──
const getBarangByKode = async (req, res) => {
  try {
    const { kode } = req.params;
    const { jenis, cabang, bagian } = req.query;
    const data = await formService.getBarangByKode(
      kode,
      jenis || "ACCESORIES",
      cabang || "HO-",
      bagian || "",
    );
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(404).json({ success: false, message: error.message });
  }
};

module.exports = {
  validateSpk,
  getDetail,
  save,
  getGudangByKode,
  getBarangByKode,
};
