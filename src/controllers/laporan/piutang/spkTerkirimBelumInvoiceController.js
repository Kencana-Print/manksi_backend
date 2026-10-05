const service = require("../../../services/laporan/piutang/spkTerkirimBelumInvoiceService");

const isTanggalValid = (v) => !v || /^\d{4}-\d{2}-\d{2}$/.test(String(v));

const getSpkTerkirimBelumInvoice = async (req, res) => {
  try {
    const { endDate, startDate, perusahaan } = req.query;
    if (!isTanggalValid(endDate) || !isTanggalValid(startDate)) {
      return res
        .status(400)
        .json({ success: false, message: "Format tanggal harus YYYY-MM-DD." });
    }
    if (startDate && endDate && startDate > endDate) {
      return res.status(400).json({
        success: false,
        message: "Tanggal awal tidak boleh melebihi tanggal akhir.",
      });
    }
    if (perusahaan && !/^[A-Za-z0-9]{1,10}$/.test(String(perusahaan))) {
      return res
        .status(400)
        .json({ success: false, message: "Kode perusahaan tidak valid." });
    }
    const data = await service.getSpkTerkirimBelumInvoice(req.query);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = { getSpkTerkirimBelumInvoice };
