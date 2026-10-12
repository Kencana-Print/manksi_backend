const qcBahanFormService = require("../../services/garmen/qcBahanFormService");
const { bolehGudang, tolakHak } = require("./qcAkses");

const lookupPo = async (req, res) => {
  try {
    const data = await qcBahanFormService.lookupPo(req.query);
    res.status(200).json({ success: true, data });
  } catch (error) {
    console.error("Error Lookup PO QC Bahan:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

const getPoSource = async (req, res) => {
  try {
    const { po, nourut } = req.query;
    if (!po || !nourut) {
      return res.status(400).json({
        success: false,
        message: "Parameter po dan nourut wajib diisi.",
      });
    }
    const data = await qcBahanFormService.getPoSource(po, nourut);
    res.status(200).json({ success: true, data });
  } catch (error) {
    console.error("Error PO Source QC Bahan:", error);
    res.status(400).json({ success: false, message: error.message });
  }
};

const getDetail = async (req, res) => {
  try {
    const { nomor } = req.query;
    if (!nomor) {
      return res
        .status(400)
        .json({ success: false, message: "Parameter nomor wajib diisi." });
    }
    const data = await qcBahanFormService.getDetail(nomor);
    res.status(200).json({ success: true, data });
  } catch (error) {
    console.error("Error Detail QC Bahan:", error);
    res.status(400).json({ success: false, message: error.message });
  }
};

const getLampiran = async (req, res) => {
  try {
    const data = await qcBahanFormService.getLampiran(req.params.nomor);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const saveLampiran = async (req, res) => {
  try {
    if (!bolehGudang(req.user)) return tolakHak(res);

    const data = await qcBahanFormService.saveLampiran(
      decodeURIComponent(req.params.nomor),
      req.body.jenis,
      req.file,
      req.user?.kode || "ADMIN",
    );
    res.status(200).json({ success: true, message: "Foto tersimpan.", data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const deleteLampiran = async (req, res) => {
  try {
    if (!bolehGudang(req.user)) return tolakHak(res);

    await qcBahanFormService.deleteLampiran(
      decodeURIComponent(req.params.nomor),
      req.params.jenis,
    );
    res.status(200).json({ success: true, message: "Foto dihapus." });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const saveData = async (req, res) => {
  try {
    if (!bolehGudang(req.user)) return tolakHak(res);

    const userKode = req.user?.kode || "SYSTEM";
    const result = await qcBahanFormService.saveData(req.body, userKode);
    res.status(200).json({
      success: true,
      message: result.warnings.length
        ? "Data tersimpan dengan peringatan."
        : "Data berhasil disimpan.",
      data: result,
    });
  } catch (error) {
    console.error("Error Save QC Bahan:", error);
    res.status(400).json({ success: false, message: error.message });
  }
};

module.exports = {
  lookupPo,
  getPoSource,
  getDetail,
  getLampiran,
  saveLampiran,
  deleteLampiran,
  saveData,
};
