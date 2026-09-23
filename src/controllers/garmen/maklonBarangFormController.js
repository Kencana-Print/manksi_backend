const service = require("../../services/garmen/maklonBarangFormService");
const fs = require("fs");
const sjKeluarService = require("../../services/garmen/maklonSjKeluarService");
const browseService = require("../../services/garmen/maklonBarangService");

const getCabangOptions = async (req, res) => {
  try {
    const data = await service.getCabangOptions();
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const save = async (req, res) => {
  try {
    // ⬅ DIUBAH: sekarang multipart — header & details datang sebagai JSON
    // string di req.body (dari FormData), file mentah di req.files, dan
    // pendingKeys (urutan yang sama persis dengan urutan file di-append
    // di frontend) untuk mapping file → slot gambar mana.
    const header = JSON.parse(req.body.header || "{}");
    const details = JSON.parse(req.body.details || "[]");
    const pendingKeys = JSON.parse(req.body.pendingKeys || "[]");

    const result = await service.saveData(
      { header, details },
      req.user,
      req.files || [],
      pendingKeys,
    );
    res.status(200).json({
      success: true,
      message: "Maklon Barang berhasil disimpan.",
      data: result,
    });
  } catch (error) {
    // Bersihkan file temp yang sudah ke-upload tapi transaksi DB gagal —
    // sama seperti pola cleanup di uploadGambar, supaya folder temp
    // tidak numpuk file orphan.
    if (req.files) {
      for (const f of req.files) {
        if (fs.existsSync(f.path)) fs.unlinkSync(f.path);
      }
    }
    res.status(400).json({ success: false, message: error.message });
  }
};

const uploadGambar = async (req, res) => {
  try {
    const result = await service.uploadGambar(req.files);
    res.status(200).json({ success: true, data: result });
  } catch (error) {
    // Bersihkan file temp kalau proses gagal di tengah jalan
    if (req.files) {
      for (const f of req.files) {
        if (fs.existsSync(f.path)) fs.unlinkSync(f.path);
      }
    }
    res.status(400).json({ success: false, message: error.message });
  }
};

const getSjKeluarDialog = async (req, res) => {
  try {
    const data = await sjKeluarService.getDetailUntukDialog(req.params.nomor);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(404).json({ success: false, message: error.message });
  }
};

const createSjKeluar = async (req, res) => {
  try {
    const { tanggal, items } = req.body;
    const result = await sjKeluarService.createSjKeluar(
      req.params.nomor,
      tanggal,
      items,
      req.user,
    );
    res.status(200).json({
      success: true,
      message: "SJ Keluar berhasil dibuat.",
      data: result,
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const getSjKeluarPrintData = async (req, res) => {
  try {
    const data = await sjKeluarService.getPrintData(req.params.sjkNomor);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(404).json({ success: false, message: error.message });
  }
};

const getById = async (req, res) => {
  try {
    const data = await browseService.getDetail(req.params.nomor);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(404).json({ success: false, message: error.message });
  }
};

module.exports = {
  save,
  uploadGambar,
  getCabangOptions,
  getSjKeluarDialog,
  createSjKeluar,
  getSjKeluarPrintData,
  getById,
};
