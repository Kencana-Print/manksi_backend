const service = require("../../../services/laporan/piutang/detailPiutangService");

const getMasterPiutang = async (req, res) => {
  try {
    const data = await service.getMasterPiutang(req.query);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getDetailPiutang = async (req, res) => {
  try {
    const { invNomor } = req.params;
    if (!invNomor) {
      return res
        .status(400)
        .json({ success: false, message: "Nomor Invoice wajib dikirim" });
    }

    // Nomor invoice dari URL bisa jadi di-encode (misal mengandung garis miring /), kita decode
    const decodedNomor = decodeURIComponent(invNomor);
    const data = await service.getDetailPiutang(req.query, decodedNomor);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getMasterPiutang,
  getDetailPiutang,
};
