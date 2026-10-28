const svc = require("../../services/piutang/klaimKasKecilFormService");
const {
  aksesPenuh,
  normCabang,
  cabangKlaimUser,
  CABANG_PUSAT,
} = require("../../services/piutang/klaimKasKecilKonstanta");

const kirimError = (res, err, statusDefault = 500) =>
  res
    .status(err.status || statusDefault)
    .json({ success: false, message: err.message });

// Hak BACA: akses penuh dan pusat -> null (baca semua); cabang lain -> cabangnya
const scopeBaca = (req) => {
  if (aksesPenuh(req.user)) return null;
  const c = String(req.user?.cabang || "").trim();
  if (!c) {
    const e = new Error("Cabang user tidak diketahui.");
    e.status = 403;
    throw e;
  }
  return CABANG_PUSAT.includes(c) ? null : normCabang(c);
};

const getDefaults = async (req, res) => {
  try {
    const cabang = svc.cabangKerja(req.user, req.query.cabang);
    const data = await svc.getDefaults(cabang, aksesPenuh(req.user));
    res.json({ success: true, data });
  } catch (err) {
    kirimError(res, err);
  }
};

const getBkkOptions = async (req, res) => {
  try {
    const cabang = svc.cabangKerja(req.user, req.query.cabang);
    const data = await svc.getBkkOptions(
      cabang,
      req.query.rekTujuan || "",
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
    const data = await svc.getDetailForm(
      req.params.nomor,
      scopeBaca(req),
      aksesPenuh(req.user),
      cabangKlaimUser(req.user),
    );
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

const getPrint = async (req, res) => {
  try {
    const data = await svc.getPrintData(req.params.nomor, scopeBaca(req));
    res.json({ success: true, data });
  } catch (err) {
    kirimError(res, err);
  }
};

module.exports = {
  getDefaults,
  getBkkOptions,
  getDetail,
  getPrint,
  create,
  update,
};
