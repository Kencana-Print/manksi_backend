const mapFormService = require("../../services/penjualan/mapFormService");

const getInitGrids = async (req, res) => {
  try {
    const data = await mapFormService.getInitGrids();
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getSpkInformasi = async (req, res) => {
  try {
    const data = await mapFormService.getSpkInformasi(req.params.divisi);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const loadMintaHarga = async (req, res) => {
  try {
    const data = await mapFormService.loadMintaHarga(req.params.nomor);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const getById = async (req, res) => {
  try {
    const data = await mapFormService.getById(req.params.nomor);
    if (!data)
      return res
        .status(404)
        .json({ success: false, message: "Data tidak ditemukan." });
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const save = async (req, res) => {
  try {
    const isNewMode =
      !req.body.Nomor || req.body.Nomor === "Baru= Nomor Otomatis";
    // userKode didapat dari token otentikasi (middleware)
    const userKode = req.user?.kode || "ADMIN";

    const savedNomor = await mapFormService.save(req.body, userKode, isNewMode);
    res.status(200).json({
      success: true,
      message: "Berhasil menyimpan MAP.",
      nomor: savedNomor,
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const uploadImage = async (req, res) => {
  try {
    if (!req.file) throw new Error("File gambar tidak ditemukan.");
    const { mapNomor, cabang, type } = req.body; // type: 'MAIN' atau 'EMAIL'

    if (!mapNomor || !cabang || !type) {
      throw new Error(
        "Nomor MAP, Cabang, dan Tipe gambar (MAIN/EMAIL) harus disertakan.",
      );
    }

    const filename = await mapFormService.processImage(
      req.file.path,
      cabang,
      type,
      mapNomor,
    );
    res
      .status(200)
      .json({ success: true, message: "Gambar berhasil diupload.", filename });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const getPrintData = async (req, res) => {
  try {
    const data = await mapFormService.getPrintData(req.params.nomor);
    if (!data)
      return res
        .status(404)
        .json({ success: false, message: "Data tidak ditemukan." });
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getNamaSuggestions = async (req, res) => {
  try {
    const { q = "", divisi = "", cusKode = "" } = req.query;
    if (!q.trim() || !divisi || !cusKode) {
      return res.json({ success: true, data: [] });
    }
    const data = await mapFormService.getNamaSuggestions(
      q.trim(),
      divisi,
      cusKode,
    );
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const checkDuplikatNama = async (req, res) => {
  try {
    const {
      nama = "",
      divisi = "",
      cusKode = "",
      excludeNomor = "",
    } = req.query;
    if (!nama.trim() || !divisi || !cusKode) {
      return res.json({ success: true, data: [] });
    }
    const data = await mapFormService.checkDuplikatNama(
      nama.trim(),
      divisi,
      cusKode,
      excludeNomor,
    );
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getKatalogCustomer = async (req, res) => {
  try {
    const { cusKode } = req.params;
    const { divisi = "", q = "", page = 1, limit = 20 } = req.query;

    if (!cusKode || cusKode.trim() === "") {
      return res.json({ success: true, data: [], total: 0 });
    }

    const result = await mapFormService.getKatalogCustomer(cusKode, divisi, q.trim(), parseInt(page), parseInt(limit));
    
    // Kirim data array (items) dan nilai total
    res.status(200).json({ success: true, data: result.items, total: result.total });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getInitGrids,
  getSpkInformasi,
  loadMintaHarga,
  getById,
  save,
  uploadImage,
  getPrintData,
  getNamaSuggestions,
  checkDuplikatNama,
  getKatalogCustomer, 
};