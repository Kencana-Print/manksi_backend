const service = require("../../services/pembelian/tindakLanjutQcService");
const { bolehPembelian, tolakHak } = require("../garmen/qcAkses");

const decodeNomor = (req) => decodeURIComponent(req.params.nomor);

const browseData = async (req, res) => {
  try {
    const { startDate, endDate, status = "ALL" } = req.query;
    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: "startDate dan endDate wajib diisi.",
      });
    }
    const data = await service.getBrowse(startDate, endDate, status);
    res.status(200).json({ success: true, data });
  } catch (error) {
    console.error("Error Browse Tindak Lanjut QC:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

const getDetailLot = async (req, res) => {
  try {
    const data = await service.getDetailLot(decodeNomor(req));
    res.status(200).json({ success: true, data });
  } catch (error) {
    console.error("Error Detail Lot Tindak Lanjut QC:", error);
    res.status(400).json({ success: false, message: error.message });
  }
};

const getRiwayat = async (req, res) => {
  try {
    const data = await service.getRiwayat(decodeNomor(req));
    res.status(200).json({ success: true, data });
  } catch (error) {
    console.error("Error Riwayat Tindak Lanjut QC:", error);
    res.status(400).json({ success: false, message: error.message });
  }
};

const saveKeputusan = async (req, res) => {
  try {
    if (!bolehPembelian(req.user)) return tolakHak(res);

    const data = await service.saveKeputusan(
      decodeNomor(req),
      req.body,
      req.user?.kode || "ADMIN",
    );
    res.status(200).json({
      success: true,
      message: "Keputusan berhasil disimpan.",
      data,
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const requestPin = async (req, res) => {
  try {
    if (!bolehPembelian(req.user)) return tolakHak(res);

    const { nomor, alasan } = req.body;
    if (!nomor) {
      return res
        .status(400)
        .json({ success: false, message: "Nomor wajib diisi." });
    }
    if (!alasan || alasan.trim() === "") {
      return res
        .status(400)
        .json({ success: false, message: "Alasan pengajuan wajib diisi." });
    }

    await service.requestPinKeputusan(
      nomor,
      alasan.trim(),
      req.user?.kode || "SYSTEM",
    );
    res.status(200).json({
      success: true,
      message: "Berhasil diajukan. Menunggu ACC.",
    });
  } catch (error) {
    console.error("Error Request PIN Tindak Lanjut QC:", error);
    res.status(400).json({ success: false, message: error.message });
  }
};

module.exports = {
  browseData,
  getDetailLot,
  getRiwayat,
  saveKeputusan,
  requestPin,
};
