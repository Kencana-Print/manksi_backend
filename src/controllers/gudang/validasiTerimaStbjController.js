const svc = require("../../services/gudang/validasiTerimaStbjService");

const getBrowse = async (req, res) => {
  try {
    const { tglAwal, tglAkhir, cab = "" } = req.query;
    const status = String(req.query.status || "SEMUA").toUpperCase();

    if (!tglAwal || !tglAkhir) {
      return res
        .status(400)
        .json({ message: "Periode (tglAwal, tglAkhir) wajib diisi." });
    }
    if (!svc.STATUS_FILTER.includes(status)) {
      return res.status(400).json({ message: "Filter status tidak valid." });
    }

    const data = await svc.getBrowse(tglAwal, tglAkhir, status, String(cab));
    res.json({ success: true, data });
  } catch (err) {
    console.error("validasiTerimaStbj getBrowse:", err);
    res.status(500).json({ message: "Gagal memuat data." });
  }
};

const getDetail = async (req, res) => {
  try {
    const data = await svc.getDetail(req.params.nomor);
    res.json({ success: true, data });
  } catch (err) {
    console.error("validasiTerimaStbj getDetail:", err);
    res.status(500).json({ message: "Gagal memuat detail." });
  }
};

module.exports = { getBrowse, getDetail };
