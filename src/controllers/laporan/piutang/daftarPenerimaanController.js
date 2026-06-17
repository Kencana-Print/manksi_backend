const service = require("../../../services/laporan/piutang/daftarPenerimaanService");

const getMasterPenerimaan = async (req, res) => {
  try {
    const data = await service.getMasterPenerimaan(req.query);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getDetailPenerimaan = async (req, res) => {
  try {
    const { noPenerimaan } = req.params;
    if (!noPenerimaan) {
      return res
        .status(400)
        .json({ success: false, message: "Nomor Penerimaan wajib dikirim" });
    }

    // Melakukan decode URL karena noPenerimaan mungkin mengandung karakter garis miring (/)
    const decodedNomor = decodeURIComponent(noPenerimaan);
    const data = await service.getDetailPenerimaan(decodedNomor);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getMasterPenerimaan,
  getDetailPenerimaan,
};
