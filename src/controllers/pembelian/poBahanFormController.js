const poBahanFormService = require("../../services/pembelian/poBahanFormService");
const rekapBelanjaFormService = require("../../services/pembelian/rekapBelanjaFormService");

const validateField = async (req, res) => {
  try {
    const { type, value, exclude } = req.query;
    const data = await poBahanFormService.validateField(type, value, exclude);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const getDetail = async (req, res) => {
  try {
    const data = await poBahanFormService.getDetail(req.params.nomor);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(404).json({ success: false, message: error.message });
  }
};

const save = async (req, res) => {
  try {
    const userKode = req.user?.kode || "ADMIN";
    const result = await poBahanFormService.saveData(req.body, userKode);
    res.status(200).json({
      success: true,
      message: "PO Bahan berhasil disimpan.",
      data: result,
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const getMkbDetail = async (req, res) => {
  try {
    const { nomor } = req.params;
    const result = await poBahanFormService.getDetailMkbForPo(nomor);

    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error("Error getMkbDetail:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Terjadi kesalahan saat memuat detail MKB",
    });
  }
};

const getSupplierByKode = async (req, res) => {
  try {
    const data = await poBahanFormService.getSupplierByKode(req.params.kode);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(404).json({ success: false, message: error.message });
  }
};

const getMbbOutstanding = async (req, res) => {
  try {
    const { jenis, exclude } = req.query;
    const data = await poBahanFormService.getMbbOutstanding(jenis, exclude);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const getRekap = async (req, res) => {
  try {
    const data = await rekapBelanjaFormService.getGrup(
      req.params.nomor,
      req.user,
    );
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(404).json({ success: false, message: error.message });
  }
};

const saveRekap = async (req, res) => {
  try {
    const result = await rekapBelanjaFormService.saveGrup(req.body, req.user);
    res.status(200).json({
      success: true,
      message: "Rekap Belanja berhasil disimpan.",
      data: result,
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

module.exports = {
  validateField,
  getDetail,
  save,
  getMkbDetail,
  getSupplierByKode,
  getMbbOutstanding,
  getRekap,
  saveRekap,
};
