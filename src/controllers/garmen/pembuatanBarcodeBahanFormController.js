const service = require("../../services/garmen/pembuatanBarcodeBahanFormService");

const getDefaultForm = async (req, res) => {
  try {
    const userCabang = req.user?.cabang || "";
    const data = await service.getDefaultForm(userCabang);
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

const getBarang = async (req, res) => {
  try {
    const data = await service.getBarangDetail(req.params.kode);
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const generateBarcodesForRoll = async (req, res) => {
  try {
    const { kode, nama, roll, tanggal } = req.body;
    const data = await service.generateBarcodesForRoll({
      kode,
      nama,
      roll,
      tanggal,
    });
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const getBpbOrRetur = async (req, res) => {
  try {
    const { tanggal } = req.query;
    const data = await service.getBpbOrRetur(req.params.nomor, tanggal);
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const create = async (req, res) => {
  try {
    const userKode = req.user.kode;
    const data = await service.create(req.body, userKode);
    res.json({
      success: true,
      data,
      message: `Berhasil di simpan dengan nomor: ${data.nomor}`,
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const update = async (req, res) => {
  try {
    const userKode = req.user.kode;
    const data = await service.update(req.params.nomor, req.body, userKode);
    res.json({
      success: true,
      data,
      message: `Berhasil di simpan dengan nomor: ${data.nomor}`,
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const saveRowQty = async (req, res) => {
  try {
    const userKode = req.user.kode;
    const data = await service.saveRowQty(req.body, userKode);
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const getSingleBarcodeCetak = async (req, res) => {
  try {
    const { nomor, barcode } = req.query;
    const data = await service.getSingleBarcodeCetak(nomor, barcode);
    res.json({ success: true, data });
  } catch (error) {
    res.status(404).json({ success: false, message: error.message });
  }
};

module.exports = {
  getDefaultForm,
  getFormData,
  getBarang,
  generateBarcodesForRoll,
  getBpbOrRetur,
  create,
  update,
  saveRowQty,
  getSingleBarcodeCetak,
};
