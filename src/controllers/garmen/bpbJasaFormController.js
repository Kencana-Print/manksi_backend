const svc = require("../../services/garmen/bpbJasaFormService");

const getDataPO = async (req, res) => {
  try {
    const { nomor } = req.query;
    if (!nomor)
      return res
        .status(400)
        .json({ success: false, message: "Nomor PO wajib." });
    const data = await svc.getDataPO(nomor);
    res.json({ success: true, data });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const getDataRealisasiMinta = async (req, res) => {
  try {
    const { noMaterial, bhnKode } = req.query;
    if (!noMaterial || !bhnKode)
      return res
        .status(400)
        .json({ success: false, message: "noMaterial dan bhnKode wajib." });
    const data = await svc.getDataRealisasiMinta(noMaterial, bhnKode);
    res.json({ success: true, data });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const getKomponenList = async (req, res) => {
  try {
    const { spkNomor } = req.query;
    const data = await svc.getKomponenList(spkNomor || "");
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getBabaranStd = async (req, res) => {
  try {
    const { spkNomor, komponen } = req.query;
    const data = await svc.getBabaranStd(spkNomor, komponen);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getKelompokTujuan = async (req, res) => {
  try {
    const { cab } = req.query;
    const data = await svc.getKelompokTujuan(cab || "");
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getById = async (req, res) => {
  try {
    const nomor = req.params.nomor || req.query.nomor;
    if (!nomor)
      return res.status(400).json({ success: false, message: "Nomor wajib." });
    const data = await svc.getById(nomor);
    if (!data)
      return res
        .status(404)
        .json({ success: false, message: "Data tidak ditemukan." });
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const save = async (req, res) => {
  try {
    const userKode = req.user?.kode || req.user?.user_kode || "";
    const nomor = await svc.save(req.body, userKode, true);
    res.json({ success: true, data: { nomor }, message: "Berhasil disimpan." });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const update = async (req, res) => {
  try {
    const userKode = req.user?.kode || req.user?.user_kode || "";
    const data = { ...req.body, Nomor: req.body.Nomor || req.params.nomor };
    const nomor = await svc.save(data, userKode, false);
    res.json({ success: true, data: { nomor }, message: "Berhasil diupdate." });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

module.exports = {
  getDataPO,
  getDataRealisasiMinta,
  getKomponenList,
  getBabaranStd,
  getKelompokTujuan,
  getById,
  save,
  update,
};
