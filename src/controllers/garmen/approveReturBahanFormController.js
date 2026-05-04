const formService = require("../../services/garmen/approveReturBahanFormService");

const getDetail = async (req, res) => {
  try {
    const { nomor } = req.params;
    if (!nomor) {
      return res
        .status(400)
        .json({ success: false, message: "Nomor dokumen wajib disertakan." });
    }
    const data = await formService.getDetailApprove(nomor);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const save = async (req, res) => {
  try {
    const payload = req.body;
    const user = req.user;
    if (!payload.details || payload.details.length === 0) {
      return res
        .status(400)
        .json({ success: false, message: "Detail bahan tidak boleh kosong." });
    }
    if (!payload.barcodes || payload.barcodes.length === 0) {
      return res
        .status(400)
        .json({
          success: false,
          message: "Detail barcode tidak boleh kosong.",
        });
    }

    const result = await formService.saveData(payload, user);
    res
      .status(200)
      .json({
        success: true,
        message: "Data berhasil di-approve / disimpan.",
        data: result,
      });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getDetail,
  save,
};
