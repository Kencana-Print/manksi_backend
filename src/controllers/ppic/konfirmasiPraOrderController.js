const konfirmasiPraOrderService = require("../../services/ppic/konfirmasiPraOrderService");

const getBrowse = async (req, res) => {
  try {
    const { startDate, endDate, divisi, status } = req.query;
    const data = await konfirmasiPraOrderService.getBrowse({
      startDate,
      endDate,
      divisi,
      status,
    });
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

const getDetail = async (req, res) => {
  try {
    const data = await konfirmasiPraOrderService.getDetail(req.params.nomor);
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

const confirmKesanggupan = async (req, res) => {
  try {
    const { status, catatan, tglSoEstimasi, tglMap } = req.body;
    await konfirmasiPraOrderService.confirmKesanggupan(
      req.params.nomor,
      status,
      catatan,
      req.user.kode,
      { tglSoEstimasi, tglMap },
    );
    res.json({
      success: true,
      message: "Konfirmasi kesanggupan berhasil disimpan.",
    });
  } catch (e) {
    res.status(400).json({ success: false, message: e.message });
  }
};

const confirmStatusBahan = async (req, res) => {
  try {
    const { status } = req.body;
    await konfirmasiPraOrderService.confirmStatusBahan(
      req.params.probId,
      status,
    );
    res.json({ success: true, message: "Status bahan berhasil diperbarui." });
  } catch (e) {
    res.status(400).json({ success: false, message: e.message });
  }
};

const getDivisi = async (req, res) => {
  try {
    const data = await konfirmasiPraOrderService.getDivisi();
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

module.exports = {
  getBrowse,
  getDetail,
  confirmKesanggupan,
  confirmStatusBahan,
  getDivisi,
};
