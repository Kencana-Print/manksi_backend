const pengajuanUangMukaService = require("../../services/pembelian/pengajuanUangMukaService");
const validasiService = require("../../services/pembelian/pengajuanUangMukaValidasiService");
const { adalahAksesPenuh } = require("../../config/aksesPenuh");

const create = async (req, res) => {
  try {
    const { tanggal, keterangan, nota, nominalDiajukan, items } = req.body;
    const result = await pengajuanUangMukaService.createPengajuan(
      { tanggal, keterangan, nota, nominalDiajukan, items },
      req.user,
    );
    res.json(result);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

// Bagian yang boleh melihat semua cabang selain user cabang HO- dan ADMIN.
const BAGIAN_SEMUA_CABANG = ["FINANCE", "AUDIT", "EDP"];

const bolehSemuaCabang = (u) =>
  u?.cabang === "HO-" ||
  adalahAksesPenuh(u) ||
  BAGIAN_SEMUA_CABANG.includes(String(u?.bagian || "").toUpperCase());

const getBrowse = async (req, res) => {
  try {
    const { startDate, endDate, status } = req.query;

    if (!req.user?.cabang && !bolehSemuaCabang(req.user)) {
      return res
        .status(403)
        .json({ message: "Cabang user tidak terbaca dari token." });
    }

    // Boleh semua cabang: ikuti dropdown. Selain itu: paksa cabang dari token.
    const cabang = bolehSemuaCabang(req.user)
      ? req.query.cabang || ""
      : req.user.cabang;

    const rows = await pengajuanUangMukaService.getBrowse({
      startDate,
      endDate,
      cabang,
      status,
    });
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const getDetail = async (req, res) => {
  try {
    const rows = await pengajuanUangMukaService.getDetail(req.params.nomor);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const getPrintData = async (req, res) => {
  try {
    const data = await pengajuanUangMukaService.getPrintData(
      req.params.nomor,
      req.user,
    );
    res.json({ success: true, data });
  } catch (err) {
    res.status(404).json({ success: false, message: err.message });
  }
};

const getPrintPenyerahan = async (req, res) => {
  try {
    const data = await pengajuanUangMukaService.getPrintPenyerahan(
      req.params.nomor,
    );
    res.json(data);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

const getValidasi = async (req, res) => {
  try {
    const data = await validasiService.getStatus(req.params.nomor, req.user);
    res.json({ success: true, data });
  } catch (e) {
    res.status(400).json({ success: false, message: e.message });
  }
};

const postValidasi = async (req, res) => {
  try {
    const data = await validasiService.validasi(req.params.nomor, req.user);
    res.json({ success: true, data });
  } catch (e) {
    res.status(400).json({ success: false, message: e.message });
  }
};

const postBatalValidasi = async (req, res) => {
  try {
    const data = await validasiService.batalValidasi(
      req.params.nomor,
      req.body?.alasan,
      req.user,
    );
    res.json({ success: true, data });
  } catch (e) {
    res.status(400).json({ success: false, message: e.message });
  }
};

const getValidasiPenyelesaian = async (req, res) => {
  try {
    const data = await validasiService.getStatus(
      req.params.bon,
      req.user,
      "PENYELESAIAN",
    );
    res.json({ success: true, data });
  } catch (e) {
    res.status(400).json({ success: false, message: e.message });
  }
};

const postValidasiPenyelesaian = async (req, res) => {
  try {
    const data = await validasiService.validasi(
      req.params.bon,
      req.user,
      "PENYELESAIAN",
    );
    res.json({ success: true, data });
  } catch (e) {
    res.status(400).json({ success: false, message: e.message });
  }
};

const postBatalValidasiPenyelesaian = async (req, res) => {
  try {
    const data = await validasiService.batalValidasi(
      req.params.bon,
      req.body?.alasan,
      req.user,
      "PENYELESAIAN",
    );
    res.json({ success: true, data });
  } catch (e) {
    res.status(400).json({ success: false, message: e.message });
  }
};

module.exports = {
  create,
  getBrowse,
  getDetail,
  getPrintData,
  getPrintPenyerahan,
  getValidasi,
  postValidasi,
  postBatalValidasi,
  getValidasiPenyelesaian,
  postValidasiPenyelesaian,
  postBatalValidasiPenyelesaian,
};
