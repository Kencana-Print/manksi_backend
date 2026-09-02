// controllers/ppic/penjadwalanPpicFormController.js
const penjadwalanPpicFormService = require("../../services/ppic/penjadwalanPpicFormService");

const getCabang = async (req, res) => {
  try {
    const data = await penjadwalanPpicFormService.getCabangOptions();
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getDivisi = async (req, res) => {
  try {
    const data = await penjadwalanPpicFormService.getDivisiOptions();
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const searchSoKandidat = async (req, res) => {
  try {
    const { startDate, endDate, divisi, excludeNomor } = req.query;
    const data = await penjadwalanPpicFormService.searchSoKandidat(
      startDate,
      endDate,
      divisi || "",
      excludeNomor || "",
    );
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const searchPraOrderKandidat = async (req, res) => {
  try {
    const { startDate, endDate, divisi, excludeNomor } = req.query;
    const data = await penjadwalanPpicFormService.searchPraOrderKandidat(
      startDate,
      endDate,
      divisi || "",
      excludeNomor || "",
    );
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const searchMapKandidat = async (req, res) => {
  try {
    const { startDate, endDate, divisi, excludeNomor } = req.query;
    const data = await penjadwalanPpicFormService.searchMapKandidat(
      startDate,
      endDate,
      divisi || "",
      excludeNomor || "",
    );
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getMapInfo = async (req, res) => {
  try {
    const { divisi } = req.query;
    const data = await penjadwalanPpicFormService.getMapInfo(
      req.params.mapNomor,
      divisi || "",
    );
    if (!data)
      return res
        .status(404)
        .json({ success: false, message: "MAP tidak ditemukan." });
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const getSoInfo = async (req, res) => {
  try {
    const { divisi } = req.query;
    const data = await penjadwalanPpicFormService.getSoInfo(
      req.params.soNomor,
      divisi || "",
    );
    if (!data)
      return res
        .status(404)
        .json({ success: false, message: "SO tidak ditemukan." });
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message }); // ⬅ 400, bukan 500 — ini validation error, bukan server error
  }
};

const getFormDetail = async (req, res) => {
  try {
    const data = await penjadwalanPpicFormService.getFormDetail(
      req.params.nomor,
    );
    if (!data)
      return res
        .status(404)
        .json({ success: false, message: "Data tidak ditemukan." });
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const save = async (req, res) => {
  try {
    const result = await penjadwalanPpicFormService.saveData(
      req.body,
      req.user.kode,
      req.user.bagian,
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

const updateHeaderField = async (req, res) => {
  try {
    const { field, value } = req.body;
    const data = await penjadwalanPpicFormService.updateHeaderField(
      req.params.nomor,
      field,
      value,
      req.user.kode,
      req.user.bagian,
    );
    const io = req.app.get("io");
    io.to(req.params.nomor).emit("pjw:header-updated", data);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const createHeader = async (req, res) => {
  try {
    const data = await penjadwalanPpicFormService.createHeader(
      req.body,
      req.user.kode,
      req.user.bagian,
    );
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const addDetailRow = async (req, res) => {
  try {
    const { pjwNomor, row } = req.body;
    const data = await penjadwalanPpicFormService.addDetailRow(
      pjwNomor,
      row,
      req.user.kode,
      req.user.bagian,
    );
    const io = req.app.get("io");
    io.to(pjwNomor).emit("pjw:row-added", {
      ...data,
      row,
      userKode: req.user.kode,
    });
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const updateDetailField = async (req, res) => {
  try {
    const { pjwNomor, field, value } = req.body;
    const data = await penjadwalanPpicFormService.updateDetailField(
      req.params.pjwdId,
      field,
      value,
      req.user.kode,
      req.user.bagian,
    );
    const io = req.app.get("io");
    io.to(pjwNomor).emit("pjw:field-updated", {
      ...data,
      userKode: req.user.kode,
    });
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const deleteDetailRow = async (req, res) => {
  try {
    const { pjwNomor } = req.body;
    const data = await penjadwalanPpicFormService.deleteDetailRow(
      req.params.pjwdId,
      req.user.kode,
      req.user.bagian,
    );
    const io = req.app.get("io");
    io.to(pjwNomor).emit("pjw:row-deleted", data);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

module.exports = {
  getCabang,
  getDivisi,
  searchSoKandidat,
  searchPraOrderKandidat,
  searchMapKandidat,
  getSoInfo,
  getMapInfo,
  getFormDetail,
  save,
  updateHeaderField,
  createHeader,
  addDetailRow,
  updateDetailField,
  deleteDetailRow,
};
