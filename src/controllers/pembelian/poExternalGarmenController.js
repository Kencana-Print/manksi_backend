const service = require("../../services/pembelian/poExternalGarmenService");

// ⚠️ ASUMSI nama flag: req.user.flags.lihatHarga (mengikuti pola
// lihatCus yang sudah ada di modul lain). Tolong konfirmasi kalau
// beda.
const getCanLihatHarga = (req) => req.user?.flags?.lihatHarga === 1;

const getBrowse = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: "Parameter startDate dan endDate wajib diisi",
      });
    }
    const data = await service.getBrowse({
      startDate,
      endDate,
      canLihatHarga: getCanLihatHarga(req),
    });
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getDetail = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await service.getDetail(nomor, getCanLihatHarga(req));
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const remove = async (req, res) => {
  try {
    await service.remove(req.params.nomor, req.user.kode, req.user.cabang);
    res
      .status(200)
      .json({ success: true, message: "PO External berhasil dihapus" });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const exportHeader = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const data = await service.getExportHeader({
      startDate,
      endDate,
      canLihatHarga: getCanLihatHarga(req),
    });
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const exportDetail = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const data = await service.getExportDetail({
      startDate,
      endDate,
      canLihatHarga: getCanLihatHarga(req),
    });
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getPengajuanInfo = async (req, res) => {
  try {
    const data = await service.getPengajuanInfo(req.params.nomor);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const ajukanPerubahan = async (req, res) => {
  try {
    const { urut, alasan } = req.body;
    if (!alasan || !alasan.trim()) {
      return res
        .status(400)
        .json({ success: false, message: "Alasan harus di isi." });
    }
    await service.ajukanPerubahan(
      req.params.nomor,
      urut,
      alasan,
      req.user.kode,
    );
    res
      .status(200)
      .json({ success: true, message: "Berhasil diajukkan. Nunggu ACC" });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

module.exports = {
  getBrowse,
  getDetail,
  remove,
  exportHeader,
  exportDetail,
  getPengajuanInfo,
  ajukanPerubahan,
};
