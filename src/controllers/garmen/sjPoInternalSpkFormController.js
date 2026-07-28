const service = require("../../services/garmen/sjPoInternalSpkFormService");

const checkPO = async (req, res) => {
  try {
    const { nomor } = req.query;
    const data = await service.checkPO(nomor);
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const checkSpk = async (req, res) => {
  try {
    const { nomor } = req.query;
    const data = await service.checkSpk(nomor);
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const checkGudangProduksi = async (req, res) => {
  try {
    const { kode, cabang } = req.query;
    const data = await service.checkGudangProduksi(kode, cabang);
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const getKomponenOptions = async (req, res) => {
  try {
    const { nomorSpk } = req.query;
    const data = await service.getKomponenOptions(nomorSpk);
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getKelompokOptions = async (req, res) => {
  try {
    const { jasaNama, cabang } = req.query;
    const data = await service.getKelompokOptions(jasaNama, cabang);
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const checkNoMaterial = async (req, res) => {
  try {
    const { noMaterial, kodeKain, excludeNomor } = req.query;
    const data = await service.checkNoMaterial(
      noMaterial,
      kodeKain,
      excludeNomor || "",
    );
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const getBabaranStandar = async (req, res) => {
  try {
    const { nomorSpk, komponen } = req.query;
    const data = await service.getBabaranStandar(nomorSpk, komponen);
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getKelompokTujuanOptions = async (req, res) => {
  try {
    const { liniTujuan, cab } = req.query;
    const data = await service.getKelompokTujuanOptions(liniTujuan, cab);
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const checkSupplier = async (req, res) => {
  try {
    const { kode } = req.query;
    const data = await service.checkSupplier(kode);
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const loadBahan = async (req, res) => {
  try {
    const data = await service.loadBahan(req.body);
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const getById = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await service.getById(decodeURIComponent(nomor));
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const save = async (req, res) => {
  try {
    const result = await service.saveData(req.body, req.user);
    res.json({
      success: true,
      message: "Surat Jalan PO Internal berhasil disimpan.",
      data: result,
    });
  } catch (error) {
    const statusCode = error.message.includes("sudah diclose") ? 403 : 400;
    res.status(statusCode).json({ success: false, message: error.message });
  }
};

const getPrintData = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await service.getPrintData(
      decodeURIComponent(nomor),
      req.user.kode,
    );
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  checkPO,
  checkSpk,
  checkGudangProduksi,
  getKomponenOptions,
  getKelompokOptions,
  checkNoMaterial,
  getBabaranStandar,
  getKelompokTujuanOptions,
  checkSupplier,
  loadBahan,
  getById,
  save,
  getPrintData,
};
