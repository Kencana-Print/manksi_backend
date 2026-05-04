const service = require("../../services/garmen/mintaBahanService");

const getBrowse = async (req, res) => {
  try {
    const { startDate, endDate, cabang } = req.query;
    if (!startDate || !endDate)
      return res
        .status(400)
        .json({ success: false, message: "Tanggal dibutuhkan" });

    // Tambahkan " 00:00:00" untuk startDate dan " 23:59:59" untuk endDate
    const data = await service.getBrowse(
      startDate + " 00:00:00",
      endDate + " 23:59:59",
      cabang || "ALL",
    );

    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getDetail = async (req, res) => {
  try {
    const { nomor } = req.params;
    const bahan = await service.getDetailBahan(nomor);
    const realisasi = await service.getDetailRealisasi(nomor);
    const realisasiDtl = await service.getDetailRealisasiDtl(nomor); // <--- Ambil detailnya

    res.status(200).json({
      success: true,
      data: { bahan, realisasi, realisasiDtl }, // <--- Kirim 3 objek data
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const checkInsertEligibility = async (req, res) => {
  try {
    const cabang = req.user?.cabang || "";
    const pendingCount = await service.checkPendingApproval(cabang);

    if (pendingCount > 0) {
      return res.status(400).json({
        success: false,
        message:
          "Ada realisasi permintaan > 1 hari yang belum di approve.\nSilahkan di approve dulu supaya bisa membuat permintaan baru.",
      });
    }

    res.status(200).json({ success: true, message: "OK" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const deleteData = async (req, res) => {
  try {
    const { nomor } = req.params;
    await service.deleteMintaBahan(nomor);
    res.status(200).json({ success: true, message: "Data berhasil dihapus." });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Gagal menghapus data: " + error.message,
    });
  }
};

const setClose = async (req, res) => {
  try {
    const { nomor } = req.params;
    const { alasan } = req.body;
    if (!alasan)
      return res
        .status(400)
        .json({ success: false, message: "Alasan harus diisi" });

    await service.setCloseManual(nomor, alasan);
    res.status(200).json({ success: true, message: "Berhasil diclose." });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const approveGudang = async (req, res) => {
  try {
    // 1. VALIDASI BACKEND: zBagian<>'GUDANG'
    const bagian = req.user?.bagian?.toUpperCase() || "";
    if (!bagian.includes("GUDANG")) {
      return res
        .status(403)
        .json({ success: false, message: "Anda tidak punya hak." });
    }

    const { nomor } = req.params;
    const { status, alasan } = req.body;
    const userKode = req.user?.kode || "ADMIN";
    const capv =
      status === "APPROVE"
        ? new Date().toISOString().slice(0, 19).replace("T", " ")
        : "TOLAK";

    await service.saveApproveGudang(nomor, capv, userKode, alasan || "");
    res
      .status(200)
      .json({ success: true, message: "Approve Gudang berhasil disimpan." });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const approveManager = async (req, res) => {
  try {
    // 1. VALIDASI BACKEND: isManager() = False
    const isManager = req.user?.flags?.isManager;
    if (!isManager) {
      return res
        .status(403)
        .json({ success: false, message: "Anda tidak punya hak." });
    }

    const { nomor } = req.params;
    const { status, alasan } = req.body;
    const userKode = req.user?.kode || "ADMIN";
    const capv =
      status === "APPROVE"
        ? new Date().toISOString().slice(0, 19).replace("T", " ")
        : "TOLAK";

    await service.saveApproveManager(nomor, capv, userKode, alasan || "");
    res
      .status(200)
      .json({ success: true, message: "Approve Manager berhasil disimpan." });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const ajukanPerubahan = async (req, res) => {
  try {
    const { nomor } = req.params;
    const { alasan, tgl, spk, urut } = req.body;
    const userKode = req.user?.kode || "ADMIN";

    await service.submitAjukanPerubahan(
      nomor,
      urut,
      tgl,
      spk,
      userKode,
      alasan,
    );
    res.status(200).json({
      success: true,
      message: "Pengajuan Perubahan berhasil dikirim.",
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const approveRealisasi = async (req, res) => {
  try {
    const { nomorRealisasi } = req.params;

    await service.saveApproveRealisasi(nomorRealisasi);
    res
      .status(200)
      .json({ success: true, message: "Realisasi berhasil diapprove." });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getBrowse,
  getDetail,
  checkInsertEligibility,
  deleteData,
  setClose,
  approveGudang,
  approveManager,
  ajukanPerubahan,
  approveRealisasi,
};
