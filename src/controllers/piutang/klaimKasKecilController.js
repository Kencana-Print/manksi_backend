const svc = require("../../services/piutang/klaimKasKecilService");

const CABANG_PUSAT = ["P01", "HO-"];

// Cabang user dibaca dari token (bukan dari query string).
// Pusat -> null (boleh lihat semua); cabang lain -> dipaksa ke cabangnya.
// Gagal tertutup: kalau cabang user tidak terbaca, tolak, jangan anggap pusat.
const resolveCabang = (req) => {
  const c = String(req.user?.cabang || "").trim(); // <-- satu-satunya asumsi, lihat catatan
  if (!c) {
    const e = new Error("Cabang user tidak diketahui.");
    e.status = 403;
    throw e;
  }
  return CABANG_PUSAT.includes(c) ? null : c;
};

const kirimError = (res, err, statusDefault = 500) =>
  res
    .status(err.status || statusDefault)
    .json({ success: false, message: err.message });

const getBrowse = async (req, res) => {
  try {
    const { startDate, endDate, cabang } = req.query;
    const scope = resolveCabang(req);
    const data = await svc.getBrowse(startDate, endDate, scope || cabang);
    res.json({ success: true, data });
  } catch (err) {
    kirimError(res, err);
  }
};

const getBrowseDetail = async (req, res) => {
  try {
    const { startDate, endDate, cabang } = req.query;
    const scope = resolveCabang(req);
    const data = await svc.getBrowseDetail(startDate, endDate, scope || cabang);
    res.json({ success: true, data });
  } catch (err) {
    kirimError(res, err);
  }
};

const batalKlaim = async (req, res) => {
  try {
    const { nomor } = req.params;
    await svc.batalKlaim(nomor, req.user, resolveCabang(req));
    res.json({ success: true, message: "Klaim berhasil dibatalkan." });
  } catch (err) {
    kirimError(res, err, 400);
  }
};

module.exports = { getBrowse, getBrowseDetail, batalKlaim };
