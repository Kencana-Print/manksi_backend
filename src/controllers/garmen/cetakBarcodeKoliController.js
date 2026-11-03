const svc = require("../../services/garmen/cetakBarcodeKoliService");

const getBrowse = async (req, res) => {
  try {
    const { tglAwal, tglAkhir } = req.query;
    if (!tglAwal || !tglAkhir) {
      return res
        .status(400)
        .json({ success: false, message: "Periode wajib diisi." });
    }
    const data = await svc.getBrowse(tglAwal, tglAkhir, req.user?.cabang);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getDetail = async (req, res) => {
  try {
    const { nomor } = req.params;
    if (!nomor) {
      return res
        .status(400)
        .json({ success: false, message: "Nomor wajib diisi." });
    }
    const data = await svc.getDetail(nomor);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getSelisih = async (req, res) => {
  try {
    const { tglAwal, tglAkhir, hanyaSelisih } = req.query;
    if (!tglAwal || !tglAkhir) {
      return res
        .status(400)
        .json({ success: false, message: "Periode wajib diisi." });
    }
    const data = await svc.getSelisih(
      tglAwal,
      tglAkhir,
      req.user?.cabang,
      hanyaSelisih === "1" || hanyaSelisih === "true",
    );
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = {
  getBrowse,
  getDetail,
  getSelisih,
};
