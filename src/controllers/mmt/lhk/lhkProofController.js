const lhkService = require("../../../services/mmt/lhk/lhkProofService");

/**
 * Mendapatkan daftar semua header (Browse)
 */
exports.getBrowse = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    if (!startDate || !endDate) {
      return res.status(400).json({ message: "Parameter tanggal harus diisi" });
    }
    const data = await lhkService.getAllHeaders(startDate, endDate);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

/**
 * Mendapatkan satu data lengkap (Header + Detail) untuk Edit
 */
exports.getOne = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await lhkService.getLhkByNomor(nomor);
    if (!data) {
      return res.status(404).json({ message: "Data LHK tidak ditemukan" });
    }
    res.json({ data });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

/**
 * Menyimpan data (Create baru atau Update existing)
 */
exports.save = async (req, res) => {
  try {
    const result = await lhkService.saveLhk(req.body);
    res.json({
      success: true,
      message: "Data LHK Proof berhasil disimpan",
      nomor: result.nomor,
    });
  } catch (error) {
    console.error("Controller Error Save LHK:", error);
    res.status(500).json({ message: error.message });
  }
};

exports.accLhk = async (req, res) => {
  try {
    const { nomor } = req.params;
    const userAction = (req.user?.kode || req.user?.kdUser || req.user?.nama || 'SYSTEM') || "SYSTEM"; // Ambil user dari session/JWT jika ada

    const result = await lhkService.accLhk(nomor, userAction);

    return res.status(200).json({
      success: true,
      message: `LHK ${nomor} berhasil di-ACC.`,
      data: result,
    });
  } catch (error) {
    console.error("Error ACC LHK:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Gagal memproses ACC LHK.",
    });
  }
};

/**
 * Menghapus data LHK
 */
exports.delete = async (req, res) => {
  try {
    const { nomor } = req.params;
    await lhkService.deleteLhk(nomor);
    res.json({ success: true, message: `LHK ${nomor} berhasil dihapus` });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

/**
 * Mendapatkan detail item saja (untuk fungsi expand di tabel browse)
 */
exports.getDetailItems = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await lhkService.getDetailsByNomor(nomor);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
