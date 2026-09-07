const pengajuanDanaFormService = require("../../services/piutang/pengajuanDanaFormService");
const pengajuanDanaService = require("../../services/piutang/pengajuanDanaService");

const searchNik = async (req, res) => {
  try {
    const { query, lokasi, page, limit } = req.query;
    const data = await pengajuanDanaFormService.searchNik(
      query,
      lokasi,
      page,
      limit,
    );
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getNikInfo = async (req, res) => {
  try {
    const data = await pengajuanDanaFormService.getNikInfo(req.params.nik);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const getFormDetail = async (req, res) => {
  try {
    const data = await pengajuanDanaFormService.getFormDetail(req.params.nomor);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(404).json({ success: false, message: error.message });
  }
};

const create = async (req, res) => {
  try {
    const result = await pengajuanDanaFormService.saveData(
      { isEdit: false, header: req.body.header, items: req.body.items },
      req.user.kode,
      req.user.cabang,
    );
    res.status(200).json({
      success: true,
      message: "Data berhasil disimpan.",
      data: result,
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const update = async (req, res) => {
  try {
    const result = await pengajuanDanaFormService.saveData(
      {
        isEdit: true,
        nomor: req.params.nomor,
        header: req.body.header,
        items: req.body.items,
      },
      req.user.kode,
      req.user.cabang,
    );
    res.status(200).json({
      success: true,
      message: "Data berhasil disimpan.",
      data: result,
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const searchPermintaanPjh = async (req, res) => {
  try {
    const { query, page, limit } = req.query;
    const data = await pengajuanDanaFormService.searchPermintaanPjh(
      query,
      page,
      limit,
    );
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getPermintaanDtl = async (req, res) => {
  try {
    const data = await pengajuanDanaFormService.getPermintaanDtl(
      req.params.pmtNomor,
    );
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const searchJobButuh = async (req, res) => {
  try {
    const { query, page, limit } = req.query;
    const userKode = req.user.kode;
    const isAdmin = userKode.toUpperCase() === "ADMIN";
    const gaStatus = isAdmin
      ? null
      : await pengajuanDanaService.getGaUserStatus(userKode);
    // Sama seperti browse: ADMIN, user_ga=1, atau tidak terdaftar di ga2
    // sekaligus → treat sebagai boleh lihat semua cabang.
    const isUserGA = isAdmin || gaStatus === true || gaStatus === null;

    const data = await pengajuanDanaFormService.searchJobButuh(
      query,
      req.user.cabang,
      isUserGA,
      page,
      limit,
    );
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getJobButuhDtl = async (req, res) => {
  try {
    const jbNomor = req.params.jbNomor;
    const usedIn = await pengajuanDanaFormService.checkJobAlreadyUsed(jbNomor);
    if (usedIn) {
      return res.status(400).json({
        success: false,
        message: `Sudah dibuat pengajuan dengan Nomor: ${usedIn}`,
      });
    }
    const data = await pengajuanDanaFormService.getJobButuhDtl(jbNomor);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

module.exports = {
  searchNik,
  getNikInfo,
  getFormDetail,
  create,
  update,
  searchPermintaanPjh,
  getPermintaanDtl,
  searchJobButuh,
  getJobButuhDtl,
};
