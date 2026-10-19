const svc = require("../../services/tools/notulensiMeetingFormService");

const kirimError = (res, err) =>
  res.status(err.status || 500).json({ success: false, message: err.message });

// GET /api/tools/notulensi-meeting-form/lookups/bagian
const getLookupBagian = async (req, res) => {
  try {
    const data = await svc.getLookupBagian();
    res.json({ success: true, data });
  } catch (err) {
    kirimError(res, err);
  }
};

// GET /api/tools/notulensi-meeting-form/:nomor
const getById = async (req, res) => {
  try {
    const data = await svc.getById(req.params.nomor, req.user);
    res.json({ success: true, data });
  } catch (err) {
    kirimError(res, err);
  }
};

// GET /api/tools/notulensi-meeting-form/:nomor/cetak
const getCetak = async (req, res) => {
  try {
    const data = await svc.getCetak(req.params.nomor, req.user);
    res.json({ success: true, data });
  } catch (err) {
    kirimError(res, err);
  }
};

// POST /api/tools/notulensi-meeting-form
const create = async (req, res) => {
  try {
    const data = await svc.create(req.body, req.user);
    res.json({
      success: true,
      message: `Notulensi ${data.nomor} berhasil disimpan.`,
      data,
    });
  } catch (err) {
    kirimError(res, err);
  }
};

// PUT /api/tools/notulensi-meeting-form/:nomor
const update = async (req, res) => {
  try {
    const data = await svc.update(req.params.nomor, req.body, req.user);
    res.json({
      success: true,
      message: `Notulensi ${data.nomor} berhasil diubah.`,
      data,
    });
  } catch (err) {
    kirimError(res, err);
  }
};

// PATCH /api/tools/notulensi-meeting-form/:nomor/status
const updateStatus = async (req, res) => {
  try {
    const data = await svc.updateStatus(req.params.nomor, req.body, req.user);
    res.json({
      success: true,
      message: `Status notulensi ${data.nomor} berhasil diperbarui.`,
      data,
    });
  } catch (err) {
    kirimError(res, err);
  }
};

module.exports = {
  getLookupBagian,
  getById,
  getCetak,
  create,
  update,
  updateStatus,
};
