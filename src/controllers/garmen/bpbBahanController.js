const bpbBahanService = require("../../services/garmen/bpbBahanService");

const browseData = async (req, res) => {
  try {
    const { startDate, endDate, isPo = "true", gudang = "GB001" } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: "startDate dan endDate wajib diisi.",
      });
    }

    const canLihatSup = Number(req.user?.flags?.lihatSup) === 1;

    const data = await bpbBahanService.getBrowse(
      startDate,
      endDate,
      isPo,
      gudang,
      canLihatSup,
    );

    res.status(200).json({
      success: true,
      data,
      canLihatSup,
    });
  } catch (error) {
    console.error("Error Browse BPB Bahan:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

const getBrowseDetail = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await bpbBahanService.getBrowseDetail(nomor);

    res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    console.error("Error Browse Detail BPB Bahan:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

const deleteData = async (req, res) => {
  try {
    // PENTING: Gunakan decodeURIComponent karena rute DELETE sering
    // mengalami masalah jika ada karakter '/' pada parameter.
    const nomor = decodeURIComponent(req.params.nomor);

    await bpbBahanService.deleteBpb(nomor);

    res.status(200).json({
      success: true,
      message: "Data berhasil dihapus",
    });
  } catch (error) {
    console.error("Error Delete BPB Bahan:", error);
    // Gunakan 400 jika error berasal dari validasi (tutup buku, dll)
    res.status(400).json({ success: false, message: error.message });
  }
};

const requestPin = async (req, res) => {
  try {
    const { nomor, alasan } = req.body;
    // Asumsi req.user.kode sudah diset oleh middleware otentikasi
    const userKode = req.user?.kode || "SYSTEM";

    if (!alasan || alasan.trim() === "") {
      return res
        .status(400)
        .json({ success: false, message: "Alasan pengajuan wajib diisi." });
    }

    await bpbBahanService.requestPinPerubahan(nomor, alasan, userKode);

    res.status(200).json({
      success: true,
      message: "Berhasil diajukan. Menunggu ACC.",
    });
  } catch (error) {
    console.error("Error Request PIN BPB Bahan:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  browseData,
  getBrowseDetail,
  deleteData,
  requestPin,
};
