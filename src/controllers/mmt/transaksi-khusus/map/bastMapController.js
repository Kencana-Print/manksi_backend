const bastMapService = require("../../../../services/mmt/transaksi-khusus/map/bastMapService");

// --- GET BROWSE LIST ---
const getBrowseList = async (req, res, next) => {
  try {
    const filters = {
      startDate: req.query.startDate,
      endDate: req.query.endDate,
      onProgressOnly: req.query.onProgress,
      search: req.query.search,
      cabang: req.query.cabang,
      workshop: req.query.workshop,
      sublim: req.query.sublim,
    };

    const userCabang =
      req.user?.cabang ||
      req.user?.cab ||
      req.user?.Cab ||
      req.user?.cabang_kode ||
      "ALL";
    // Payload auth memakai 'divisi' (lih. permintaanProduksi.controller).
    const userDivisi = req.user?.divisi ?? req.user?.Divisi ?? null;

    const data = await bastMapService.getBrowseList(filters, userCabang, userDivisi);

    return res.status(200).json({
      status: true,
      message: "Berhasil mengambil data browse BAST MAP",
      data: data,
    });
  } catch (error) {
    next(error);
  }
};

// --- GET DETAIL BAST (untuk form Ubah) ---
const getBastDetail = async (req, res, next) => {
  try {
    const { nomor } = req.params;
    const data = await bastMapService.getBastDetail(nomor);
    if (!data) {
      return res.status(404).json({
        success: false,
        message: `Data BAST ${nomor} tidak ditemukan.`,
      });
    }
    return res.status(200).json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

// --- GET SIZES ---
const getSizes = async (req, res, next) => {
  try {
    const { nomor } = req.params;
    const data = await bastMapService.getSizes(nomor);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

// --- GET PROOF BY SPK (bahan + nomor proof dari LHK Proof) ---
const getProofBySpk = async (req, res, next) => {
  try {
    const { spk } = req.params;
    const data = await bastMapService.getProofBySpk(spk);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

// --- SAVE BAST (untuk form Baru & Ubah) ---
// Service membaca header mspk_*, sedangkan frontend mengirim mmpt_*
// sehingga dinormalisasi di sini sebelum diteruskan ke service.
const normalizeSavePayload = (body) => {
  const data = { ...(body || {}) };
  const h = { ...(data.header || {}) };
  data.header = {
    ...h,
    mspk_nomor: h.mspk_nomor || h.mmpt_nomor || h.Nomor || "",
    mspk_jumlah_jadi:
      h.mspk_jumlah_jadi ?? h.mmpt_jumlah_jadi ?? h.Jumlah ?? 0,
    mspk_kendala: h.mspk_kendala ?? h.mmpt_kendala ?? h.Kendala ?? "",
    mspk_tipe: h.mspk_tipe ?? h.mmpt_tipe ?? h.Tipe ?? "",
  };
  return data;
};

const saveBast = async (req, res, next) => {
  try {
    const payload = normalizeSavePayload(req.body);
    if (!payload.header?.mspk_nomor) {
      return res.status(400).json({
        success: false,
        message: "Nomor MAP/Order wajib diisi.",
      });
    }

    const userKode =
      (req.user?.kode || req.user?.kdUser || req.user?.nama || 'SYSTEM') ||
      req.user?.kode ||
      (req.user?.nama || req.user?.username || req.user?.kode || 'SYSTEM') ||
      payload.header?.user ||
      "SYSTEM";
    const userCabang =
      req.user?.cabang ||
      req.user?.cab ||
      req.user?.Cab ||
      req.user?.cabang_kode ||
      "ALL";

    await bastMapService.saveBastData(payload, userKode, userCabang);

    return res.status(200).json({
      success: true,
      message: `BAST ${payload.header.mspk_nomor} berhasil disimpan.`,
      nomor: payload.header.mspk_nomor,
    });
  } catch (error) {
    next(error);
  }
};

// --- PRINT BAST (HTML siap cetak, dibuka via window.open) ---
const printBast = async (req, res, next) => {
  try {
    const { nomor } = req.params;
    const html = await bastMapService.getBastPrintHtml(nomor);
    if (!html) {
      return res
        .status(404)
        .send(`<h3>Data BAST ${nomor} tidak ditemukan.</h3>`);
    }
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(200).send(html);
  } catch (error) {
    next(error);
  }
};

// --- DELETE BAST ---
const deleteBast = async (req, res, next) => {
  try {
    const { nomor } = req.params;
    const userKode = req.user?.kode || "SYSTEM";

    await bastMapService.deleteBast(nomor, userKode);

    return res.status(200).json({
      status: true,
      message: `BAST MAP dengan nomor ${nomor} berhasil dihapus.`,
    });
  } catch (error) {
    next(error);
  }
};

// --- GET EXPORT DETAIL ---
const getExportDetail = async (req, res, next) => {
  try {
    const filters = {
      startDate: req.query.startDate,
      endDate: req.query.endDate,
      onProgressOnly: req.query.onProgress,
      search: req.query.search,
      cabang: req.query.cabang,
      workshop: req.query.workshop,
      sublim: req.query.sublim,
    };

    const userCabang =
      req.user?.cabang ||
      req.user?.cab ||
      req.user?.Cab ||
      req.user?.cabang_kode ||
      "ALL";
    const userDivisi = req.user?.divisi ?? req.user?.Divisi ?? null;

    const data = await bastMapService.getExportDetail(filters, userCabang, userDivisi);

    return res.status(200).json({
      status: true,
      message: "Berhasil mengambil data export detail BAST MAP",
      data: data,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getBrowseList,
  getBastDetail,
  getSizes,
  getProofBySpk,
  saveBast,
  printBast,
  deleteBast,
  getExportDetail,
};
