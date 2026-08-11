const svc = require("../../services/garmen/cetakBarcodeKaosanFormService");

const getDetail = async (req, res) => {
  try {
    const { nomor } = req.params;
    if (!nomor) {
      return res
        .status(400)
        .json({ success: false, message: "Nomor wajib diisi." });
    }
    const data = await svc.getDetail(nomor);
    if (!data) {
      return res
        .status(404)
        .json({ success: false, message: "Nomor tersebut belum ada." });
    }
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const searchKaosanMaster = async (req, res) => {
  try {
    const { q = "", limit = 50 } = req.query;
    const data = await svc.searchKaosanMaster(q, limit);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const lookupSpk = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await svc.lookupSpk(nomor);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const lookupKodeKaosan = async (req, res) => {
  try {
    const { kode } = req.params;
    const data = await svc.lookupKodeKaosan(kode);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const lookupByBarcode = async (req, res) => {
  try {
    const { barcode } = req.params;
    const data = await svc.lookupByBarcode(barcode);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const save = async (req, res) => {
  try {
    if (!req.body.isEdit && !req.body.tanggal) {
      return res
        .status(400)
        .json({ success: false, message: "Tanggal wajib diisi." });
    }
    if (req.body.isEdit && !req.body.nomor) {
      return res
        .status(400)
        .json({ success: false, message: "Nomor wajib diisi." });
    }
    const result = await svc.saveData(req.body, req.user);
    res.json({
      success: true,
      data: result,
      message: req.body.isEdit
        ? "Berhasil diubah."
        : `Berhasil disimpan dengan nomor: ${result.nomor}`,
    });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

module.exports = {
  getDetail,
  searchKaosanMaster,
  lookupSpk,
  lookupKodeKaosan,
  lookupByBarcode,
  save,
};
