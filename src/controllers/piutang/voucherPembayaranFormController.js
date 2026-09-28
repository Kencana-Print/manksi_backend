const svc = require("../../services/piutang/voucherPembayaranFormService");

const getSupplier = async (req, res) => {
  try {
    const data = await svc.getSupplier(req.params.kode);
    res.json({ success: true, data });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const searchSupplier = async (req, res) => {
  try {
    const data = await svc.searchSupplier(req.query.search);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getNotaDetail = async (req, res) => {
  try {
    const { kode, statusPpn, type } = req.query;
    const data = await svc.getNotaDetail(
      kode,
      statusPpn ? Number(statusPpn) : 0,
      type || null,
    );
    res.json({ success: true, data });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const searchNota = async (req, res) => {
  try {
    const { type, supKode, search } = req.query;
    const data = await svc.searchNota(type, supKode, search);
    res.json({ success: true, data });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const getDetailForm = async (req, res) => {
  try {
    const data = await svc.getDetailForm(req.params.nomor);
    res.json({ success: true, data });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const cekStatusRealisasi = async (req, res) => {
  try {
    const data = await svc.cekStatusRealisasi(req.params.nomor);
    res.json({ success: true, data: { sudahRealisasi: data } });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const save = async (req, res) => {
  try {
    const userKode = req.user?.kode || req.user?.user_kode || "";
    const result = await svc.save({ ...req.body, isEdit: false }, userKode);
    res.json({ success: true, data: result, message: "Berhasil disimpan." });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const update = async (req, res) => {
  try {
    const userKode = req.user?.kode || req.user?.user_kode || "";
    const result = await svc.save({ ...req.body, isEdit: true }, userKode);
    res.json({ success: true, data: result, message: "Berhasil diupdate." });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

// ── Realisasi ──
const searchKodeBayar = async (req, res) => {
  try {
    const data = await svc.searchKodeBayar(req.query.q);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getKodeBayar = async (req, res) => {
  try {
    const data = await svc.getKodeBayar(req.params.kode);
    res.json({ success: true, data });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const searchAccount = async (req, res) => {
  try {
    const data = await svc.searchAccount(req.query.q);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const searchVoucherRealisasi = async (req, res) => {
  try {
    const { q, excludeNomor } = req.query;
    const data = await svc.searchVoucherRealisasi(q, excludeNomor);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const loadVoucherRealisasiDetail = async (req, res) => {
  try {
    const { vouNomor, currentNomor } = req.query;
    const data = await svc.loadVoucherRealisasiDetail(vouNomor, currentNomor);
    res.json({ success: true, data });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const getDetailFormRealisasi = async (req, res) => {
  try {
    const data = await svc.getDetailFormRealisasi(req.params.nomor);
    res.json({ success: true, data });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const saveRealisasi = async (req, res) => {
  try {
    const userKode = req.user?.kode || req.user?.user_kode || "";
    const result = await svc.saveRealisasi(
      { ...req.body, isEdit: false },
      userKode,
    );
    res.json({ success: true, data: result, message: "Berhasil disimpan." });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const updateRealisasi = async (req, res) => {
  try {
    const userKode = req.user?.kode || req.user?.user_kode || "";
    const result = await svc.saveRealisasi(
      { ...req.body, isEdit: true },
      userKode,
    );
    res.json({ success: true, data: result, message: "Berhasil diupdate." });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const hapusRealisasi = async (req, res) => {
  try {
    await svc.hapusRealisasi(req.params.nomor);
    res.json({ success: true, message: "Realisasi berhasil dihapus." });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

module.exports = {
  getSupplier,
  searchSupplier,
  getNotaDetail,
  searchNota,
  getDetailForm,
  cekStatusRealisasi,
  save,
  update,
  searchKodeBayar,
  getKodeBayar,
  searchAccount,
  searchVoucherRealisasi,
  loadVoucherRealisasiDetail,
  getDetailFormRealisasi,
  saveRealisasi,
  updateRealisasi,
  hapusRealisasi,
};
