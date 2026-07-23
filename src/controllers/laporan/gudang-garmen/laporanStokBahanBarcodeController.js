const service = require("../../../services/laporan/gudang-garmen/laporanStokBahanBarcodeService");

const getBrowse = async (req, res) => {
  try {
    const data = await service.getBrowse(req.query);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getBrowseDetail = async (req, res) => {
  try {
    // req.params.kode = Kode Bahan dari Master Header
    const data = await service.getBrowseDetail(req.params.kode, req.query);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getKeteranganList = async (req, res) => {
  try {
    const data = await service.getKeteranganList(req.params.kode);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const updateKeteranganList = async (req, res) => {
  try {
    await service.updateKeteranganList(req.body.items);
    res.status(200).json({
      success: true,
      message: "Keterangan barcode berhasil disimpan.",
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getMkbBelumRealisasiDetail = async (req, res) => {
  try {
    const { kode } = req.params;
    const data = await service.getMkbBelumRealisasiDetail(kode);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = {
  getBrowse,
  getBrowseDetail,
  getKeteranganList,
  updateKeteranganList,
  getMkbBelumRealisasiDetail,
};
