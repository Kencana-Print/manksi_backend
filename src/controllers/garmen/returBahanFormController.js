const formService = require("../../services/garmen/returBahanFormService");

const getGudangBahan = async (req, res) => {
  try {
    const data = await formService.getGudangBahan();
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const getGudangProduksi = async (req, res) => {
  try {
    const cabang = req.user.cabang;
    const data = await formService.getGudangProduksi(cabang);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const getDetailRealisasiMinta = async (req, res) => {
  try {
    const { nominta, gdgproduksi } = req.query;
    if (!nominta || !gdgproduksi) throw new Error("Parameter tidak lengkap.");

    const data = await formService.getDetailRealisasi(nominta, gdgproduksi);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const getEditDetail = async (req, res) => {
  try {
    const data = await formService.getEditDetail(req.params.nomor);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(404).json({ success: false, message: error.message });
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

const getPrintData = async (req, res) => {
  try {
    const { nomor } = req.params;
    if (!nomor) {
      return res
        .status(400)
        .json({ success: false, message: "Nomor transaksi wajib disertakan." });
    }

    const data = await formService.getPrintData(nomor);

    if (data.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Data cetak tidak ditemukan." });
    }

    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getGudangBahan,
  getGudangProduksi,
  getDetailRealisasiMinta,
  getEditDetail,
  saveData,
  getPrintData,
};
