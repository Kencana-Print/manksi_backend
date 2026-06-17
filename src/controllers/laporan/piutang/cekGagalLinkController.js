const service = require("../../../services/laporan/piutang/cekGagalLinkService");

const getMasterGagalLink = async (req, res) => {
  try {
    const data = await service.getMasterGagalLink();
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getDetailGagalLink = async (req, res) => {
  try {
    const { nota } = req.params;
    if (!nota)
      return res
        .status(400)
        .json({ success: false, message: "Nota wajib dikirim" });

    const decodedNota = decodeURIComponent(nota);
    const data = await service.getDetailGagalLink(decodedNota);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const fixGagalLink = async (req, res) => {
  try {
    const { nota } = req.params;
    const { bayar } = req.body;

    if (!nota || bayar === undefined) {
      return res
        .status(400)
        .json({
          success: false,
          message: "Nota dan nilai bayar wajib dikirim",
        });
    }

    const decodedNota = decodeURIComponent(nota);
    await service.fixGagalLink(decodedNota, bayar);
    res
      .status(200)
      .json({ success: true, message: "Berhasil dilink/sinkronkan." });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getMasterGagalLink,
  getDetailGagalLink,
  fixGagalLink,
};
