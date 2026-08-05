const formService = require("../../services/garmen/koreksiStokBarangJadiFormService");

const getFormData = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await formService.getFormData(nomor);
    if (!data) {
      return res
        .status(404)
        .json({ success: false, message: "Nomor tersebut belum ada." });
    }
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const validateGudang = async (req, res) => {
  try {
    const { kode } = req.params;
    const data = await formService.validateGudang(kode);
    if (!data) {
      return res
        .status(404)
        .json({ success: false, message: "Kode gudang tsb tidak ada." });
    }
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const lookupBarang = async (req, res) => {
  try {
    const { kode } = req.params;
    const { gdgKode, tanggal, excludeNomor } = req.query;
    if (!gdgKode || !tanggal) {
      return res.status(400).json({
        success: false,
        message: "Parameter gdgKode dan tanggal wajib diisi.",
      });
    }

    const result = await formService.lookupBarang(
      kode,
      gdgKode,
      tanggal,
      excludeNomor || "",
    );

    if (!result.found) {
      return res
        .status(404)
        .json({ success: false, message: "Kode tsb tidak ada." });
    }
    if (result.duplikat) {
      return res.status(409).json({
        success: false,
        message: `Sudah ada koreksi pada tgl tsb dengan No: ${result.nomorBentrok}`,
      });
    }

    res.status(200).json({ success: true, data: result.data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const create = async (req, res) => {
  try {
    const result = await formService.saveData(req.body, req.user, false);
    res
      .status(201)
      .json({ success: true, data: result, message: "Berhasil disimpan." });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const update = async (req, res) => {
  try {
    const { nomor } = req.params;
    const result = await formService.saveData(
      { ...req.body, nomor },
      req.user,
      true,
    );
    res
      .status(200)
      .json({ success: true, data: result, message: "Berhasil disimpan." });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const searchBarang = async (req, res) => {
  try {
    const { q, gdgKode, page, limit } = req.query;
    if (!gdgKode) {
      return res.status(400).json({
        success: false,
        message: "Parameter gdgKode wajib diisi.",
      });
    }
    const result = await formService.searchBarang(
      q,
      gdgKode,
      Number(page) || 1,
      Number(limit) || 50,
    );
    res.status(200).json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getFormData,
  validateGudang,
  lookupBarang,
  searchBarang,
  create,
  update,
};
