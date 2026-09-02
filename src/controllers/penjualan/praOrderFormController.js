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

module.exports = {
  getInitGrids,
  getById,
  save,
  uploadGambar,
  setStatusBahan,
  setStatusPpic,
  convertToMintaHarga,
  getKatalogCustomer,
};
