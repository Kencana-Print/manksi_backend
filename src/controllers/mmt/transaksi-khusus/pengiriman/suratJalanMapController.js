// suratJalanMap.controller.js
const sjMapService = require("../../../../services/mmt/transaksi-khusus/pengiriman/suratJalanMapService");

/* ==========================================================================
   BAGIAN: CONTROLLER SURAT JALAN MAP
   ========================================================================== */

/**
 * Browse List Master Surat Jalan MAP
 */
const browseSjMap = async (req, res) => {
  try {
    const { startDate, endDate, canLihatCus } = req.query;

    if (!startDate || !endDate) {
      return res
        .status(400)
        .json({ message: "Parameter startDate dan endDate wajib diisi" });
    }

    const isCanLihatCus =
      canLihatCus === "true" || canLihatCus === true || canLihatCus === "1";

    const data = await sjMapService.getSjMapList(
      startDate,
      endDate,
      isCanLihatCus,
    );
    res.status(200).json({ data });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

/**
 * Get Detail Surat Jalan MAP Berdasarkan Nomor SJ
 */
const getDetailSjMapByNomor = async (req, res) => {
  try {
    const { nomor } = req.query;

    if (!nomor) {
      return res
        .status(400)
        .json({ message: "Parameter nomor Surat Jalan MAP wajib diisi" });
    }

    const data = await sjMapService.getDetailSjMap(nomor);
    res.status(200).json({ data, details: data });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

/**
 * Delete Surat Jalan MAP
 */
const deleteSjMap = async (req, res) => {
  try {
    const { nomor } = req.params;

    if (!nomor) {
      return res.status(400).json({ message: "Parameter nomor wajib diisi" });
    }

    const success = await sjMapService.deleteSjMap(nomor);
    if (success) {
      res
        .status(200)
        .json({ message: `Surat Jalan MAP ${nomor} berhasil dihapus` });
    } else {
      res.status(404).json({ message: "Data Surat Jalan MAP tidak ditemukan" });
    }
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

/**
 * Cek Urutan Pengajuan Edit Terakhir Surat Jalan MAP
 */
const getUrutPengajuanMap = async (req, res) => {
  try {
    const { nomor } = req.params;

    if (!nomor) {
      return res
        .status(400)
        .json({ message: "Nomor Surat Jalan MAP wajib diisi" });
    }

    const data = await sjMapService.getUrutPengajuanSjMap(nomor);
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

/**
 * Submit Pengajuan Edit Perubahan Data Surat Jalan MAP
 */
const submitPengajuanMap = async (req, res) => {
  try {
    const userLogin =
      (req.user?.kode || req.user?.kdUser || req.user?.nama || 'SYSTEM') || (req.user?.nama || req.user?.username || req.user?.kode || 'SYSTEM') || req.body.kdUser || "ADMIN";
    const result = await sjMapService.ajukanPerubahan(req.body, userLogin);
    res.status(200).json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

/**
 * Get Status PIN 5 Surat Jalan MAP Terakhir
 */
const getPin5StatusMap = async (req, res) => {
  try {
    const { nomor } = req.params;

    if (!nomor) {
      return res
        .status(400)
        .json({ message: "Nomor Surat Jalan MAP wajib diisi" });
    }

    const data = await sjMapService.getPin5Status(nomor);
    res.status(200).json({ data });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  browseSjMap,
  getDetailSjMapByNomor,
  deleteSjMap,
  getUrutPengajuanMap,
  submitPengajuanMap,
  getPin5StatusMap,
};
