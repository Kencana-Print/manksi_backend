const svc = require("../../services/piutang/klaimKasKecilService");
const {
  aksesPenuh,
  normCabang,
  cabangKlaimUser,
  CABANG_PUSAT,
} = require("../../services/piutang/klaimKasKecilKonstanta");

// Scope baca. Akses penuh dan pusat -> null (semua cabang);
// cabang lain -> dipaksa ke cabangnya. Gagal tertutup bila cabang kosong.
const resolveCabang = (req) => {
  if (aksesPenuh(req.user)) return null;
  const c = String(req.user?.cabang || "").trim();
  if (!c) {
    const e = new Error("Cabang user tidak diketahui.");
    e.status = 403;
    throw e;
  }
  return CABANG_PUSAT.includes(c) ? null : normCabang(c);
};

// Scope batal. Akses penuh -> null (boleh semua); selain itu hanya klaim milik
// cabang terdaftar user (P04 -> klaim P04, P01/HO- -> klaim ATM pusat).
const scopeBatal = (req) => {
  if (aksesPenuh(req.user)) return null;
  const c = cabangKlaimUser(req.user);
  if (!c) {
    const e = new Error(
      "Klaim hanya dapat dibatalkan oleh user cabang yang terdaftar.",
    );
    e.status = 403;
    throw e;
  }
  return c;
};

const kirimError = (res, err, statusDefault = 500) =>
  res
    .status(err.status || statusDefault)
    .json({ success: false, message: err.message });

const getBrowse = async (req, res) => {
  try {
    const { startDate, endDate, cabang, jenis } = req.query;
    const scope = resolveCabang(req);
    const data = await svc.getBrowse(
      startDate,
      endDate,
      scope || cabang,
      jenis,
    );
    res.json({ success: true, data });
  } catch (err) {
    kirimError(res, err);
  }
};

const getBrowseDetail = async (req, res) => {
  try {
    const { startDate, endDate, cabang, jenis } = req.query;
    const scope = resolveCabang(req);
    const data = await svc.getBrowseDetail(
      startDate,
      endDate,
      scope || cabang,
      jenis,
    );
    res.json({ success: true, data });
  } catch (err) {
    kirimError(res, err);
  }
};

const batalKlaim = async (req, res) => {
  try {
    const { nomor } = req.params;
    await svc.batalKlaim(nomor, req.user, scopeBatal(req));
    res.json({ success: true, message: "Klaim berhasil dibatalkan." });
  } catch (err) {
    kirimError(res, err, 400);
  }
};

module.exports = { getBrowse, getBrowseDetail, batalKlaim };
