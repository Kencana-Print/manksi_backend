const svc = require("../../services/garmen/lhkPolaFormService");

const getDetail = async (req, res) => {
  try {
    const data = await svc.getDetail(req.params.nomor);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(404).json({ success: false, message: error.message });
  }
};

const save = async (req, res) => {
  try {
    const userKode = req.user?.kode || "ADMIN";
    const result = await svc.saveData(req.body, { kode: userKode }, false);
    res
      .status(200)
      .json({
        success: true,
        message: "LHK Pola berhasil disimpan.",
        data: result,
      });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const update = async (req, res) => {
  try {
    const userKode = req.user?.kode || "ADMIN";
    const payload = { ...req.body, nomor: req.params.nomor };
    const result = await svc.saveData(payload, { kode: userKode }, true);
    res
      .status(200)
      .json({
        success: true,
        message: "LHK Pola berhasil diupdate.",
        data: result,
      });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const remove = async (req, res) => {
  try {
    await svc.deleteData(req.params.nomor);
    res
      .status(200)
      .json({ success: true, message: "LHK Pola berhasil dihapus." });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
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

const getSpkByNomor = async (req, res) => {
  try {
    const data = await svc.getSpkByNomor(req.params.nomor);
    if (!data) {
      return res
        .status(404)
        .json({ success: false, message: "SPK/MAP tidak ditemukan." });
    }
    const divisiNama = await svc.getDivisiNama(data.Divisi);
    res
      .status(200)
      .json({ success: true, data: { ...data, DivisiNama: divisiNama } });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getDetail,
  save,
  update,
  remove,
  searchSpk,
  getSpkByNomor,
};
