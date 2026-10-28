const svc = require("../../services/piutang/rekapPembayaranFormService");

const userDari = (req) => req.user?.kode || req.user?.user_kode || "";

const searchSupplier = async (req, res) => {
  try {
    const data = await svc.searchSupplier(req.query.search || "");
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getSupplier = async (req, res) => {
  try {
    const data = await svc.getSupplier(req.params.kode);
    res.json({ success: true, data });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const searchNota = async (req, res) => {
  try {
    const { tipe, supKode, search } = req.query;
    const data = await svc.searchNota(tipe, supKode, search || "");
    res.json({ success: true, data });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const getInfoNota = async (req, res) => {
  try {
    const { tipe, nota, supKode, excludeNomor } = req.query;
    const data = await svc.getInfoNota(tipe, nota, supKode, excludeNomor || "");
    res.json({ success: true, data });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const getById = async (req, res) => {
  try {
    const data = await svc.getById(req.params.nomor);
    res.json({ success: true, data });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const create = async (req, res) => {
  try {
    const data = await svc.save(req.body, userDari(req));
    res.json({
      success: true,
      data,
      message: `Rekap pembayaran ${data.nomor} berhasil disimpan.`,
    });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const update = async (req, res) => {
  try {
    const data = await svc.save(req.body, userDari(req), req.params.nomor);
    res.json({
      success: true,
      data,
      message: `Rekap pembayaran ${data.nomor} berhasil diubah.`,
    });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const getTagihan = async (req, res) => {
  try {
    const { supKode, startDate, endDate, excludeNomor } = req.query;
    const data = await svc.getTagihan(
      supKode,
      startDate,
      endDate,
      excludeNomor || "",
    );
    res.json({ success: true, data });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const getVoucherOptions = async (req, res) => {
  try {
    const data = await svc.getVoucherOptions(
      req.query.search || "",
      req.query.excludeNomor || "",
    );
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = {
  searchSupplier,
  getSupplier,
  searchNota,
  getInfoNota,
  getById,
  create,
  update,
  getTagihan,
  getVoucherOptions,
};
