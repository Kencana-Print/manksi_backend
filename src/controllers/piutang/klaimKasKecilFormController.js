const svc = require("../../services/piutang/klaimKasKecilFormService");

const CABANG_PUSAT = ["P01", "HO-"];

const kirimError = (res, err, statusDefault = 500) =>
  res
    .status(err.status || statusDefault)
    .json({ success: false, message: err.message });

// Pusat -> null (boleh baca semua, tidak boleh menulis); cabang lain -> cabangnya
const scopeBaca = (req) => {
  const c = String(req.user?.cabang || "").trim();
  if (!c) {
    const e = new Error("Cabang user tidak diketahui.");
    e.status = 403;
    throw e;
  }
  return CABANG_PUSAT.includes(c) ? null : c;
};

const cabangTulis = (req) => String(req.user?.cabang || "").trim();

const getDefaults = async (req, res) => {
  try {
    const data = await svc.getDefaults(cabangTulis(req));
    res.json({ success: true, data });
  } catch (err) {
    kirimError(res, err);
  }
};

const getBkkOptions = async (req, res) => {
  try {
    const data = await svc.getBkkOptions(
      cabangTulis(req),
      req.query.search || "",
      req.query.exceptNomor || "",
    );
    res.json({ success: true, data });
  } catch (err) {
    kirimError(res, err);
  }
};

const getDetail = async (req, res) => {
  try {
    const data = await svc.getDetailForm(req.params.nomor, scopeBaca(req));
    res.json({ success: true, data });
  } catch (err) {
    kirimError(res, err);
  }
};

const create = async (req, res) => {
  try {
    const data = await svc.saveData({ ...req.body, isEdit: false }, req.user);
    res.json({ success: true, message: "Klaim berhasil disimpan.", data });
  } catch (err) {
    kirimError(res, err, 400);
  }
};

const update = async (req, res) => {
  try {
    const data = await svc.saveData(
      { ...req.body, isEdit: true, nomor: req.params.nomor },
      req.user,
    );
    res.json({ success: true, message: "Klaim berhasil diubah.", data });
  } catch (err) {
    kirimError(res, err, 400);
  }
};

module.exports = { getDefaults, getBkkOptions, getDetail, create, update };
