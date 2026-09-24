// controllers/penjualan/praOrderFormController.js
const praOrderFormService = require("../../services/penjualan/praOrderFormService");
const upload = require("../../middleware/uploadMiddleware");

const getInitGrids = async (req, res) => {
  try {
    const data = await praOrderFormService.getInitGrids();
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getById = async (req, res) => {
  try {
    const data = await praOrderFormService.getById(req.params.nomor);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const save = async (req, res) => {
  try {
    const isNewMode = !req.body.nomor;
    const nomor = await praOrderFormService.save(
      req.body,
      req.user.kode,
      isNewMode,
    );
    res
      .status(200)
      .json({ success: true, message: "Pra Order berhasil disimpan.", nomor });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const uploadGambar = async (req, res) => {
  try {
    const { nomor } = req.params;
    const files = req.files || [];
    if (files.length === 0) {
      return res
        .status(400)
        .json({ success: false, message: "Tidak ada file yang diupload." });
    }
    let urut = await praOrderFormService.getNextGambarUrut(nomor);
    const results = [];
    for (const file of files) {
      const urlPath = await praOrderFormService.processGambar(
        file.path,
        nomor,
        urut,
      );
      await praOrderFormService.addGambar(nomor, urlPath, "", urut);
      results.push(urlPath);
      urut++;
    }
    res.status(200).json({
      success: true,
      message: "Gambar berhasil diupload.",
      data: results,
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const setStatusBahan = async (req, res) => {
  try {
    await praOrderFormService.setStatusBahan(
      req.params.prob_id,
      req.body.status,
    );
    res
      .status(200)
      .json({ success: true, message: "Status bahan diperbarui." });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const setStatusPpic = async (req, res) => {
  try {
    const { status, catatan } = req.body;
    await praOrderFormService.setStatusPpic(
      req.params.nomor,
      status,
      catatan,
      req.user.kode,
    );
    res.status(200).json({ success: true, message: "Status PPIC diperbarui." });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const convertToMintaHarga = async (req, res) => {
  try {
    const mhNomor = await praOrderFormService.convertToMintaHarga(
      req.params.nomor,
      req.user.kode,
    );
    res.status(200).json({
      success: true,
      message: "Berhasil dikonversi ke Permintaan Harga.",
      mhNomor,
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const getPrintData = async (req, res) => {
  try {
    const data = await praOrderFormService.getPrintData(req.params.nomor);
    if (!data) {
      return res
        .status(404)
        .json({ success: false, message: "Data Pra Order tidak ditemukan." });
    }
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

const getKatalogCustomer = async (req, res) => {
  try {
    const { custKode } = req.params;
    const { status, q, page, limit } = req.query;
    const result = await praOrderFormService.getKatalogCustomer(
      custKode,
      status,
      q,
      Number(page) || 1,
      Number(limit) || 20,
    );
    res.status(200).json({
      success: true,
      data: result.items,
      total: result.total,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getLookupData = async (req, res) => {
  try {
    const data = await praOrderFormService.getLookupData(req.params.nomor);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(404).json({ success: false, message: error.message });
  }
};

const searchPraOrder = async (req, res) => {
  try {
    const { q = "", page = 1, limit = 20 } = req.query;
    const result = await praOrderFormService.searchPraOrder(
      q.trim(),
      parseInt(page),
      parseInt(limit),
    );
    res
      .status(200)
      .json({ success: true, data: result.items, total: result.total });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const copyImageToMintaHarga = async (req, res) => {
  try {
    const { proNomor, mhNomor } = req.params;
    const copied = await praOrderFormService.copyGambarPertamaKeMintaHarga(
      proNomor,
      mhNomor,
    );
    res.json({ success: true, data: { copied } });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

module.exports = {
  getInitGrids,
  getById,
  save,
  uploadGambar,
  setStatusBahan,
  setStatusPpic,
  convertToMintaHarga,
  getPrintData,
  getKatalogCustomer,
  getLookupData,
  searchPraOrder,
  copyImageToMintaHarga,
};
