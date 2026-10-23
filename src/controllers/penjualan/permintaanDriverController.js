const service = require("../../services/penjualan/permintaanDriverService");

// ── GET BROWSE ─────────────────────────────────────────────────────────
const getBrowse = async (req, res) => {
  try {
    const { tglAwal, tglAkhir } = req.query;
    if (!tglAwal || !tglAkhir) {
      return res.status(400).json({
        success: false,
        message: "Parameter tglAwal dan tglAkhir wajib diisi.",
      });
    }

    const data = await service.getBrowse({ tglAwal, tglAkhir });
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── GET DETAIL PER NOMOR ───────────────────────────────────────────────
const getDetail = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await service.getDetail(nomor);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── GET BY ID (Header + Detail) ────────────────────────────────────────
const getById = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await service.getById(nomor);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── GENERATE NOMOR ─────────────────────────────────────────────────────
const generateNomor = async (req, res) => {
  try {
    const { tanggal } = req.query;
    const nomor = await service.generateNomor(tanggal);
    res.json({ success: true, data: { nomor } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── SEARCH SPK / MEMO SPK ──────────────────────────────────────────────
const searchSpk = async (req, res) => {
  try {
    const { q } = req.query;
    const data = await service.searchSpk(q || "");
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── CREATE DATA ────────────────────────────────────────────────────────
const create = async (req, res) => {
  try {
    const userKode = req.user?.kode || req.user?.nama || "USER";
    const result = await service.create(req.body, userKode);
    res.status(201).json({
      success: true,
      message: `Permintaan driver ${result.nomor} berhasil dibuat.`,
      data: result,
    });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

// ── UPDATE DATA ────────────────────────────────────────────────────────
const update = async (req, res) => {
  try {
    const { nomor } = req.params;
    const userKode = req.user?.kode || req.user?.nama || "USER";
    const isAdmin = req.user?.bagian?.toUpperCase() === "IT" || req.user?.isAdmin;
    const result = await service.update(nomor, req.body, userKode, isAdmin);
    res.json({
      success: true,
      message: `Permintaan driver ${result.nomor} berhasil diperbarui.`,
      data: result,
    });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

// ── DELETE DATA ────────────────────────────────────────────────────────
const deleteData = async (req, res) => {
  try {
    const { nomor } = req.params;
    const userKode = req.user?.kode || req.user?.nama || "USER";
    const isAdmin = req.user?.bagian?.toUpperCase() === "IT" || req.user?.isAdmin;
    await service.deleteData(nomor, userKode, isAdmin);
    res.json({
      success: true,
      message: `Permintaan driver ${nomor} berhasil dibatalkan.`,
    });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

module.exports = {
  getBrowse,
  getDetail,
  getById,
  generateNomor,
  searchSpk,
  create,
  update,
  deleteData,
};
