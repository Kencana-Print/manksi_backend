const service = require("../../services/garmen/mutasiOutBarangFormService");

const getDetail = async (req, res) => {
  try {
    // Pastikan di service nama fungsinya juga ikut diubah menjadi getDetail
    const data = await service.getDetail(req.params.nomor);
    if (!data) {
      return res
        .status(404)
        .json({ success: false, message: "Data tidak ditemukan" });
    }
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const searchBarang = async (req, res) => {
  try {
    const data = await service.searchBarang(req.query);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const save = async (req, res) => {
  try {
    const { isNewMode, data } = req.body;
    const userKode = req.user?.kode || "ADMIN";
    const userBagian = req.user?.bagian || "ADMIN";

    // 1. Validasi Basic
    if (!data.CabangTujuan) {
      return res
        .status(400)
        .json({ success: false, message: "Cabang Tujuan harus dipilih." });
    }

    // 2. Validasi Status PIN
    if (!isNewMode && ["MINTA", "WAIT", "TOLAK"].includes(data.StatusEdit)) {
      return res.status(400).json({
        success: false,
        message:
          "Transaksi sudah diclose. Silahkan minta approve untuk bisa menyimpan perubahan data.",
      });
    }

    const nomor = await service.save(data, userKode, userBagian, isNewMode);
    res
      .status(200)
      .json({ success: true, message: "Mutasi Out berhasil disimpan", nomor });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const searchPermintaanFinance = async (req, res) => {
  try {
    const { jenis, cabangTujuan, search } = req.query;
    const data = await service.searchPermintaanFinance(
      jenis,
      cabangTujuan,
      search,
    );
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getDetailPermintaanFinance = async (req, res) => {
  try {
    const { noPermintaan, cabangAsal, nomorMso } = req.query;
    const data = await service.getDetailPermintaanFinance(
      noPermintaan,
      cabangAsal,
      nomorMso,
    );
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getDetail,
  searchBarang,
  save,
  searchPermintaanFinance,
  getDetailPermintaanFinance,
};
