const service = require("../../services/penjualan/salesOrderFormService");

const getDetail = async (req, res) => {
  try {
    const { nomor } = req.query;
    if (!nomor)
      return res
        .status(400)
        .json({ success: false, message: "Nomor SPK wajib diisi." });

    const data = await service.getDetail(nomor);
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const save = async (req, res) => {
  try {
    // Validasi basic structure payload
    if (!req.body.header)
      return res
        .status(400)
        .json({ success: false, message: "Data header tidak lengkap." });

    const result = await service.saveData(req.body, req.user);
    res.json({
      success: true,
      data: result,
      message: req.body.isEdit
        ? "SPK berhasil diubah."
        : "SPK baru berhasil dibuat.",
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const validateField = async (req, res) => {
  try {
    const { type, value, extra } = req.query;
    // service.validateField sudah kita buat di percakapan sebelumnya
    const result = await service.validateField(type, value, extra);
    res.json(result);
  } catch (error) {
    res.status(400).json({ valid: false, message: error.message });
  }
};

const getMemoDetail = async (req, res) => {
  try {
    const data = await service.getMemoDetail(req.query.nomor);
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// --- Fungsi Upload Gambar ---
const uploadImage = async (req, res) => {
  try {
    if (!req.file) throw new Error("File gambar tidak ditemukan.");
    const { spkNomor, cabang } = req.body;

    if (!spkNomor || !cabang) {
      throw new Error("Nomor SPK dan Cabang harus disertakan.");
    }

    const filename = await service.processImage(
      req.file.path,
      cabang,
      spkNomor,
    );
    res
      .status(200)
      .json({ success: true, message: "Gambar berhasil diupload.", filename });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const getDatelineLimits = async (req, res) => {
  try {
    // Tangkap parameter dari URL (query)
    const { divisi, joKode, kepentingan } = req.query;

    // Tangkap data cabang dari token user (disematkan oleh middleware)
    const cabKaos = req.user?.cabangKaos || "";

    if (!divisi || !kepentingan) {
      return res.status(400).json({
        success: false,
        message: "Parameter divisi dan kepentingan harus dikirim.",
      });
    }

    const data = await service.getDatelineLimits(
      divisi,
      joKode,
      kepentingan,
      cabKaos,
    );

    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const checkHakTopUrgent = async (req, res) => {
  try {
    const { cusKode, divisi } = req.query;
    if (!cusKode)
      return res
        .status(400)
        .json({ success: false, message: "cusKode diperlukan." });

    const berhak = await service.checkHakTopUrgent(cusKode, divisi);
    res.status(200).json({ success: true, berhak });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getInitSizes = async (req, res) => {
  try {
    const data = await service.getInitSizes();
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getStandarUkuran = async (req, res) => {
  try {
    const { joKode, varian } = req.query;
    const data = await service.getStandarUkuran(joKode, varian || "STANDAR");
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getKatalogCustomer = async (req, res) => {
  try {
    const { cusKode } = req.params;
    const { divisi = "", q = "", page = 1, limit = 20 } = req.query;

    if (!cusKode || cusKode.trim() === "") {
      return res.json({ success: true, data: [], total: 0 });
    }

    const result = await service.getKatalogCustomer(
      cusKode,
      divisi,
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

module.exports = {
  getDetail,
  save,
  validateField,
  getMemoDetail,
  uploadImage,
  getDatelineLimits,
  checkHakTopUrgent,
  getInitSizes,
  getStandarUkuran,
  getKatalogCustomer,
};
