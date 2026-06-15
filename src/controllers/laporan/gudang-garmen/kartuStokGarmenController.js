const service = require("../../../services/laporan/gudang-garmen/kartuStokGarmenService");

const getMasterStok = async (req, res) => {
  try {
    // Teruskan req.user agar fungsi helper bisa membaca bagian == "FINANCE"
    const data = await service.getMasterStok(req.query, req.user);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getDetailKartuStok = async (req, res) => {
  try {
    const { brgKode } = req.params;
    if (!brgKode) {
      return res
        .status(400)
        .json({ success: false, message: "Kode Barang wajib dikirim" });
    }

    const data = await service.getDetailKartuStok(req.query, brgKode, req.user);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getMasterStok,
  getDetailKartuStok,
};
