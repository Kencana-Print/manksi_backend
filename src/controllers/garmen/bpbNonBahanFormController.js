const bpbNonBahanFormService = require("../../services/garmen/bpbNonBahanFormService");

const getDetailForm = async (req, res) => {
  try {
    const data = await bpbNonBahanFormService.getDetailForm(req.params.nomor);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(404).json({ success: false, message: error.message });
  }
};

const getPermintaanDetail = async (req, res) => {
  try {
    const { mbNomor } = req.params;
    const { bpbNomor } = req.query;
    const data = await bpbNonBahanFormService.getPermintaanDetail(
      mbNomor,
      bpbNomor,
    );
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const getPoDetail = async (req, res) => {
  try {
    const { poNomor } = req.params;
    const { bpbNomor } = req.query;
    const data = await bpbNonBahanFormService.getPoDetail(poNomor, bpbNomor);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const saveData = async (req, res) => {
  try {
    const data = await bpbNonBahanFormService.saveData(req.body, req.user);
    res.status(200).json({ success: true, message: "Berhasil disimpan", data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const getSupplierByKode = async (req, res) => {
  try {
    const { kode } = req.params;
    const { jenis } = req.query;
    const data = await bpbNonBahanFormService.getSupplierByKode(
      kode,
      jenis || "ACCESORIES",
    );
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(404).json({ success: false, message: error.message });
  }
};

const getSpkByNomor = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await bpbNonBahanFormService.getSpkByNomor(nomor);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(404).json({ success: false, message: error.message });
  }
};

module.exports = {
  getDetailForm,
  getPermintaanDetail,
  getPoDetail,
  saveData,
  getSupplierByKode,
  getSpkByNomor,
};
