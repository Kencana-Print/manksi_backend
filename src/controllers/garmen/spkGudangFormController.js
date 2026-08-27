const service = require("../../services/garmen/spkGudangFormService");

const getById = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await service.getById(nomor);
    if (!data)
      return res
        .status(404)
        .json({ success: false, message: "Data tidak ditemukan." });
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const lookupJenisKain = async (req, res) => {
  try {
    const { kode } = req.params;
    const data = await service.lookupJenisKain(kode);
    if (!data)
      return res
        .status(404)
        .json({ success: false, message: "Jenis Kain tsb tidak ada." });
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getLenganList = async (req, res) => {
  try {
    const data = await service.getLenganList();
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const searchBarcode = async (req, res) => {
  try {
    const { kdKain, q } = req.query;
    if (!kdKain)
      return res
        .status(400)
        .json({ success: false, message: "kdKain wajib diisi." });
    const data = await service.searchBarcodeBahan(kdKain, q || "");
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const resolveBarcode = async (req, res) => {
  try {
    const { kdKain, barcode } = req.query;
    if (!kdKain || !barcode)
      return res
        .status(400)
        .json({ success: false, message: "kdKain dan barcode wajib diisi." });
    const result = await service.resolveBarcode(kdKain, barcode);
    if (result.error === "notfound")
      return res.status(404).json({
        success: false,
        message: `Barcode tsb tidak ada di Jenis bahan ini.`,
      });
    if (result.error === "empty_stock")
      return res.json({
        success: true,
        data: null,
        message: "Barcode tsb stok nya kosong.",
      });
    res.json({ success: true, data: result.data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const searchBahan = async (req, res) => {
  try {
    const { kdKain, q } = req.query;
    if (!kdKain)
      return res
        .status(400)
        .json({ success: false, message: "kdKain wajib diisi." });
    const data = await service.searchBahanNonBarcode(kdKain, q || "");
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const lookupWarna = async (req, res) => {
  try {
    const { kode } = req.query;
    if (!kode)
      return res
        .status(400)
        .json({ success: false, message: "kode wajib diisi." });
    const data = await service.lookupWarnaByKode(kode);
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const searchJenisKainKaosan = async (req, res) => {
  try {
    const { q = "", page = 1, limit = 50 } = req.query;
    const data = await service.searchJenisKainKaosan(q, page, limit);
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const searchWarna = async (req, res) => {
  try {
    const { q = "", page = 1, limit = 50 } = req.query;
    const data = await service.searchWarnaKaosan(q, page, limit);
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const searchJenisKain = async (req, res) => {
  try {
    const { q = "", page = 1, limit = 50 } = req.query;
    const data = await service.searchJenisKain(q, page, limit);
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getDataCetak = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await service.getDataCetak(nomor);
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const save = async (req, res) => {
  try {
    const result = await service.save(req.body, req.user);
    res.json({
      success: true,
      message: "SPK Gudang berhasil disimpan.",
      data: result,
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

module.exports = {
  getById,
  lookupJenisKain,
  searchBarcode,
  resolveBarcode,
  searchBahan,
  lookupWarna,
  searchJenisKainKaosan,
  searchWarna,
  searchJenisKain,
  getLenganList,
  getDataCetak,
  save,
};
