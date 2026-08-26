const service = require("../../services/tools/agendaKerjaService");

const getBrowse = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    if (!startDate || !endDate) {
      return res
        .status(400)
        .json({
          success: false,
          message: "Parameter startDate dan endDate wajib diisi.",
        });
    }
    const data = await service.getBrowse(
      startDate,
      endDate,
      req.user.bagian,
      req.user.cabang,
    );
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getBadgeCount = async (req, res) => {
  try {
    const count = await service.getBadgeCount(req.user.bagian, req.user.cabang);
    res.json({ success: true, data: { count } });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ── BARU: dipakai FE nentuin tombol Tambah aktif/disable ──
const getIsPic = async (req, res) => {
  try {
    const cab =
      !req.user.cabang || req.user.cabang === "HO-" ? "HO-" : req.user.cabang;
    const isPic = await service.isPicAgenda(
      req.user.kode,
      req.user.bagian,
      cab,
    );
    res.json({ success: true, data: { isPic } });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getById = async (req, res) => {
  try {
    const data = await service.getById(req.params.nomor);
    if (!data)
      return res
        .status(404)
        .json({ success: false, message: "Data tidak ditemukan." });
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const save = async (req, res) => {
  try {
    const result = await service.save(req.body, req.user);
    res.json({
      success: true,
      data: result,
      message: "Agenda berhasil disimpan.",
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const updateStatus = async (req, res) => {
  try {
    const { status } = req.body;
    await service.updateStatus(req.params.nomor, status, req.user.kode);
    res.json({ success: true, message: "Status berhasil diubah." });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const remove = async (req, res) => {
  try {
    await service.remove(req.params.nomor, req.user.kode);
    res.json({ success: true, message: "Agenda berhasil dihapus." });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

module.exports = {
  getBrowse,
  getBadgeCount,
  getIsPic,
  getById,
  save,
  updateStatus,
  remove,
};
