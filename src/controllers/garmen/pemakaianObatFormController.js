const formService = require("../../services/garmen/pemakaianObatFormService");

const getMeta = async (req, res) => {
  try {
    const [lini, jenisObat] = await Promise.all([
      formService.getLiniOptions(req.user.divisi),
      formService.getJenisObatOptions(),
    ]);
    res.status(200).json({
      success: true,
      data: {
        cabangOptions: formService.getCabangOptions(req.user),
        liniOptions: lini,
        jenisObatOptions: jenisObat,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const resolveSpk = async (req, res) => {
  try {
    const { nomor } = req.params;
    const result = await formService.resolveSpk(nomor);
    if (!result.found) {
      return res
        .status(404)
        .json({ success: false, message: "Nomor SPK tersebut tidak ada." });
    }
    if (!result.approved) {
      return res.status(409).json({
        success: false,
        message: "MAP/SPK tsb belum diapproval Chief Marketing.",
      });
    }
    res.status(200).json({ success: true, data: result.data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const resolveKomponen = async (req, res) => {
  try {
    const { kode } = req.params;
    const data = await formService.resolveKomponen(kode);
    if (!data) {
      return res
        .status(404)
        .json({ success: false, message: "Komponen ini belum ada." });
    }
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getFormData = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await formService.getFormData(nomor);
    if (!data) {
      return res
        .status(404)
        .json({ success: false, message: "Data tidak ditemukan." });
    }
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const create = async (req, res) => {
  try {
    const result = await formService.saveData(req.body, req.user, false);
    res
      .status(201)
      .json({
        success: true,
        data: result,
        message: `Tersimpan dengan nomor ${result.nomor}`,
      });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const update = async (req, res) => {
  try {
    const { nomor } = req.params;
    const result = await formService.saveData(
      { ...req.body, nomor },
      req.user,
      true,
    );
    res
      .status(200)
      .json({
        success: true,
        data: result,
        message: `Tersimpan dengan nomor ${result.nomor}`,
      });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

module.exports = {
  getMeta,
  resolveSpk,
  resolveKomponen,
  getFormData,
  create,
  update,
};
