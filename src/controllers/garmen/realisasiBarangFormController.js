const formService = require("../../services/garmen/realisasiBarangFormService");

const getPermintaanDetail = async (req, res) => {
  try {
    const { nomorMinta } = req.params;
    // Parameter ke-3 kosong (karena ini create baru, blm ada nomor realisasi)
    const data = await formService.getPermintaanDetail(
      nomorMinta,
      req.user.cabang,
    );
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const getDetail = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await formService.getDetailForm(nomor, req.user.cabang);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const saveData = async (req, res) => {
  try {
    const result = await formService.saveData(req.body, req.user);
    res
      .status(200)
      .json({ success: true, data: result, message: "Berhasil disimpan." });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const getPrint = async (req, res) => {
  try {
    const data = await formService.getPrintData(req.params.nomor);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

module.exports = { getPermintaanDetail, getDetail, saveData, getPrint };
