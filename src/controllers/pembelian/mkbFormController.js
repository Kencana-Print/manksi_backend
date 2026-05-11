const mkbFormService = require("../../services/pembelian/mkbFormService");

const getById = async (req, res) => {
  try {
    // UBAH INI: Ambil dari query, bukan params
    const { nomor } = req.query;

    if (!nomor) {
      return res
        .status(400)
        .json({ success: false, message: "Nomor MKB wajib dikirim." });
    }

    const data = await mkbFormService.getDetailForm(nomor);
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const save = async (req, res) => {
  try {
    const result = await mkbFormService.saveData(req.body, req.user);
    res.json({
      success: true,
      message: "Data MKB berhasil disimpan.",
      data: result,
    });
  } catch (error) {
    const statusCode = error.message.includes("sudah diclose") ? 403 : 500;
    res.status(statusCode).json({ success: false, message: error.message });
  }
};

const getPrintData = async (req, res) => {
  try {
    const { nomor } = req.query;
    if (!nomor) {
      return res
        .status(400)
        .json({ success: false, message: "Nomor MKB wajib dikirim." });
    }

    // DECODE nomor agar %2F diterjemahkan kembali menjadi garis miring (/)
    const cleanNomor = decodeURIComponent(nomor);

    const data = await mkbFormService.getPrintData(cleanNomor);
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const checkSpk = async (req, res) => {
  try {
    const { spk, mkb } = req.query;
    if (!spk) {
      return res
        .status(400)
        .json({ success: false, message: "Nomor SPK wajib diisi." });
    }

    const data = await mkbFormService.checkSpkDetails(spk, mkb);
    res.json({ success: true, data });
  } catch (error) {
    // Kirim pesan error yang user-friendly (misal: "SPK sudah ada di MKB...")
    res.status(400).json({ success: false, message: error.message });
  }
};

const getLinkablePo = async (req, res) => {
  try {
    const { kode, mkb } = req.query;
    if (!kode)
      return res
        .status(400)
        .json({ success: false, message: "Kode bahan wajib ada." });
    const data = await mkbFormService.getLinkablePo(kode, mkb);
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getById,
  save,
  getPrintData,
  checkSpk,
  getLinkablePo,
};
