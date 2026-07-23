const service = require("../../services/garmen/returBeliBahanFormService");

// Helper — padanan zLihatBeli, dari JWT payload (kolom user_lihat_beli)
const canLihatBeli = (req) => req.user?.flags?.lihatBeli === 1;

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
    const data = await service.getFormData(req.params.nomor, canLihatBeli(req));
    res.json({ success: true, data });
  } catch (error) {
    res.status(404).json({ success: false, message: error.message });
  }
};

const getBpb = async (req, res) => {
  try {
    const data = await service.getBpbByNomor(
      req.params.nomor,
      canLihatBeli(req),
    );
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const getBarcode = async (req, res) => {
  try {
    const { bpbNomor } = req.query;
    const data = await service.getBarcodeDetail({
      barcode: req.params.barcode,
      bpbNomor,
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
    res.json({
      success: true,
      data,
      message: `Tersimpan dengan nomor ${data.nomor}`,
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
      message: `Tersimpan dengan nomor ${data.nomor}`,
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

module.exports = {
  getDefaultForm,
  getFormData,
  getBpb,
  getBarcode,
  create,
  update,
};
