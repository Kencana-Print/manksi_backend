const kartuStokBahanPenolongService = require("../../../services/laporan/spanduk/kartuStokBahanPenolongService");

const BAGIAN_LIHAT_SEMUA = ["EDP", "DIREKSI", "AUDIT"];
const CABANG_HO = "HO-";

const cabangUser = (req) => (req.user?.cabang || "").toUpperCase();

const bolehPilihCabang = (req) => {
  const bagian = (req.user?.bagian || "").toUpperCase();
  return (
    BAGIAN_LIHAT_SEMUA.some((b) => bagian.includes(b)) ||
    cabangUser(req) === CABANG_HO
  );
};

// Cabang ditentukan server: user biasa dikunci ke cabang token, kiriman klien diabaikan.
// Yang berhak: kosong = semua cabang.
const cabangEfektif = (req) => {
  if (bolehPilihCabang(req)) return req.query.cabang || "";
  const cabang = cabangUser(req);
  if (!cabang) {
    throw Object.assign(new Error("Cabang user tidak diketahui"), {
      status: 403,
    });
  }
  return cabang;
};

const jalankan = (aksi) => async (req, res) => {
  try {
    const data = await aksi(req);
    res.json({ success: true, data });
  } catch (error) {
    console.error("Error kartu stok bahan penolong:", error);
    res
      .status(error.status || 500)
      .json({ success: false, message: error.message });
  }
};

const getBrowse = jalankan((req) =>
  kartuStokBahanPenolongService.getBrowse({
    ...req.query,
    cabang: cabangEfektif(req),
  }),
);

const getDetail = jalankan((req) =>
  kartuStokBahanPenolongService.getDetail({
    ...req.query,
    cabang: cabangEfektif(req),
  }),
);

// Dropdown cabang: user biasa hanya melihat cabangnya sendiri (tanpa pilihan)
const getCabang = jalankan(async (req) => {
  if (!bolehPilihCabang(req)) return [{ kode: cabangEfektif(req) }];
  return kartuStokBahanPenolongService.getCabang(req.query);
});

module.exports = { getBrowse, getDetail, getCabang, bolehPilihCabang };
