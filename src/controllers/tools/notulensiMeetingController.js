const svc = require("../../services/tools/notulensiMeetingService");

const kirimError = (res, err) =>
  res.status(err.status || 500).json({ success: false, message: err.message });

// GET /api/tools/notulensi-meeting?startDate=&endDate=
const getBrowseList = async (req, res) => {
  try {
    const data = await svc.getBrowseList(req.query, req.user);
    res.json({ success: true, data });
  } catch (err) {
    kirimError(res, err);
  }
};

// GET /api/tools/notulensi-meeting/:nomor/detail
const getDetail = async (req, res) => {
  try {
    const data = await svc.getDetail(req.params.nomor);
    res.json({ success: true, data });
  } catch (err) {
    kirimError(res, err);
  }
};

// GET /api/tools/notulensi-meeting/export-detail?startDate=&endDate=
const getExportDetail = async (req, res) => {
  try {
    const data = await svc.getExportDetail(req.query);
    res.json({ success: true, data });
  } catch (err) {
    kirimError(res, err);
  }
};

// DELETE /api/tools/notulensi-meeting/:nomor
const deleteData = async (req, res) => {
  try {
    await svc.deleteData(req.params.nomor, req.user);
    res.json({
      success: true,
      message: `Notulensi ${req.params.nomor} berhasil dihapus.`,
    });
  } catch (err) {
    kirimError(res, err);
  }
};

module.exports = { getBrowseList, getDetail, getExportDetail, deleteData };
