const svc = require("../../../services/laporan/gudang-garmen/laporanKekuranganProduksiService");

const parseIsMap = (val) => val === "true" || val === "1" || val === true;

const getBrowse = async (req, res) => {
  try {
    const {
      startDate,
      endDate,
      komponen = "LL-000400",
      spk = "",
      nama = "",
      status = "ALL",
      map = "false",
    } = req.query;
    if (!startDate || !endDate) {
      return res
        .status(400)
        .json({ success: false, message: "Periode Mutasi wajib diisi." });
    }
    const data = await svc.getBrowse(
      startDate,
      endDate,
      komponen,
      spk,
      nama,
      status,
      parseIsMap(map),
    );
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { getBrowse };
