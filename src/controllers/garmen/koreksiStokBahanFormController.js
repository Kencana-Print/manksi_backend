const service = require("../../services/garmen/koreksiStokBahanFormService");

const getDefaultForm = async (req, res) => {
  try {
    const data = await service.getDefaultForm();
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getFormData = async (req, res) => {
  try {
    const data = await service.getFormData(req.params.nomor);
    res.json({ success: true, data });
  } catch (error) {
    res.status(404).json({ success: false, message: error.message });
  }
};

const getGudang = async (req, res) => {
  try {
    const data = await service.getGudangByKode(req.params.kode);
    res.json({ success: true, data });
  } catch (error) {
    res.status(404).json({ success: false, message: error.message });
  }
};

const getBarang = async (req, res) => {
  try {
    const { gdgKode, tanggal, nomorSedangDiedit } = req.query;
    const data = await service.getBarangDetail({
      kode: req.params.kode,
      gdgKode,
      tanggal,
      nomorSedangDiedit: nomorSedangDiedit || "",
    });
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const create = async (req, res) => {
  try {
    const userKode = req.user.kode;
    const data = await service.create(req.body, userKode);
    res.json({ success: true, data, message: "Berhasil Simpan." });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const update = async (req, res) => {
  try {
    const userKode = req.user.kode;
    const data = await service.update(req.params.nomor, req.body, userKode);
    res.json({ success: true, data, message: "Berhasil Simpan." });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

module.exports = {
  getDefaultForm,
  getFormData,
  getGudang,
  getBarang,
  create,
  update,
};
