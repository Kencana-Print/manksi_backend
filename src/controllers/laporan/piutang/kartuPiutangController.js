const service = require("../../../services/laporan/piutang/kartuPiutangService");

const getMasterKartuPiutang = async (req, res) => {
  try {
    const data = await service.getMasterKartuPiutang(req.query);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getInvoiceByCustomer = async (req, res) => {
  try {
    const { cusKode } = req.params;
    if (!cusKode)
      return res
        .status(400)
        .json({ success: false, message: "Kode Customer wajib dikirim" });

    const data = await service.getInvoiceByCustomer(req.query, cusKode);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getPembayaranByInvoice = async (req, res) => {
  try {
    const { invNomor } = req.params;
    if (!invNomor)
      return res
        .status(400)
        .json({ success: false, message: "Nomor Invoice wajib dikirim" });

    const decodedNomor = decodeURIComponent(invNomor);
    const data = await service.getPembayaranByInvoice(req.query, decodedNomor);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getMasterKartuPiutang,
  getInvoiceByCustomer,
  getPembayaranByInvoice,
};
