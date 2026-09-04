const service = require("../../services/pembelian/settingHargaBahanService");

// --- GARMEN KAIN ---
const getKainGarmen = async (req, res) => {
  try {
    const data = await service.getKainGarmen();
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const createKainGarmen = async (req, res) => {
  try {
    const result = await service.createKainGarmen(req.body);
    res.json({ success: true, message: "Harga kain garmen berhasil ditambahkan", data: result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const updateKainGarmen = async (req, res) => {
  try {
    const result = await service.updateKainGarmen(req.params.id, req.body);
    res.json({ success: true, message: "Harga kain garmen berhasil diperbarui", data: result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const deleteKainGarmen = async (req, res) => {
  try {
    const result = await service.deleteKainGarmen(req.body);
    res.json({ success: true, message: "Harga kain garmen berhasil dihapus", data: result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// --- GARMEN TAMBAHAN ---
const getTambahanGarmen = async (req, res) => {
  try {
    const data = await service.getTambahanGarmen();
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const createTambahanGarmen = async (req, res) => {
  try {
    const result = await service.createTambahanGarmen(req.body);
    res.json({ success: true, message: "Biaya tambahan garmen berhasil ditambahkan", data: result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const updateTambahanGarmen = async (req, res) => {
  try {
    const oldKet = decodeURIComponent(req.params.ket);
    const result = await service.updateTambahanGarmen(oldKet, req.body);
    res.json({ success: true, message: "Biaya tambahan garmen berhasil diperbarui", data: result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const deleteTambahanGarmen = async (req, res) => {
  try {
    const mht_ket = decodeURIComponent(req.params.ket);
    const result = await service.deleteTambahanGarmen(mht_ket);
    res.json({ success: true, message: "Biaya tambahan garmen berhasil dihapus", data: result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// --- SPANDUK ---
const getSpanduk = async (req, res) => {
  try {
    const data = await service.getSpanduk();
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const createSpanduk = async (req, res) => {
  try {
    const result = await service.createSpanduk(req.body, req.user);
    res.json({ success: true, message: "Strata harga spanduk berhasil ditambahkan", data: result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const updateSpanduk = async (req, res) => {
  try {
    const result = await service.updateSpanduk(req.params.id, req.body);
    res.json({ success: true, message: "Strata harga spanduk berhasil diperbarui", data: result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const deleteSpanduk = async (req, res) => {
  try {
    const result = await service.deleteSpanduk(req.params.id);
    res.json({ success: true, message: "Strata harga spanduk berhasil dihapus", data: result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// --- MMT BAHAN ---
const getMmt = async (req, res) => {
  try {
    const data = await service.getMmt();
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const createMmt = async (req, res) => {
  try {
    const result = await service.createMmt(req.body, req.user);
    res.json({ success: true, message: "Strata bahan MMT berhasil ditambahkan", data: result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const updateMmt = async (req, res) => {
  try {
    const result = await service.updateMmt(req.params.id, req.body);
    res.json({ success: true, message: "Strata bahan MMT berhasil diperbarui", data: result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const deleteMmt = async (req, res) => {
  try {
    const result = await service.deleteMmt(req.params.id);
    res.json({ success: true, message: "Strata bahan MMT berhasil dihapus", data: result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// --- MMT TAMBAHAN / TOPPING ---
const getMmtTambahan = async (req, res) => {
  try {
    const data = await service.getMmtTambahan();
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const createMmtTambahan = async (req, res) => {
  try {
    const result = await service.createMmtTambahan(req.body, req.user);
    res.json({ success: true, message: "Topping MMT berhasil ditambahkan", data: result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const updateMmtTambahan = async (req, res) => {
  try {
    const result = await service.updateMmtTambahan(req.params.id, req.body);
    res.json({ success: true, message: "Topping MMT berhasil diperbarui", data: result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const deleteMmtTambahan = async (req, res) => {
  try {
    const result = await service.deleteMmtTambahan(req.params.id);
    res.json({ success: true, message: "Topping MMT berhasil dihapus", data: result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = {
  getKainGarmen,
  createKainGarmen,
  updateKainGarmen,
  deleteKainGarmen,
  getTambahanGarmen,
  createTambahanGarmen,
  updateTambahanGarmen,
  deleteTambahanGarmen,
  getSpanduk,
  createSpanduk,
  updateSpanduk,
  deleteSpanduk,
  getMmt,
  createMmt,
  updateMmt,
  deleteMmt,
  getMmtTambahan,
  createMmtTambahan,
  updateMmtTambahan,
  deleteMmtTambahan,
};
