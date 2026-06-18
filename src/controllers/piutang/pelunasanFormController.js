const service = require("../../services/piutang/pelunasanFormService");

const getFormEditData = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await service.getFormEditData(decodeURIComponent(nomor));
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const getInfoInvoice = async (req, res) => {
  try {
    const { nota } = req.query;
    if (!nota) throw new Error("Nota wajib dikirim.");
    const data = await service.getInfoInvoice(decodeURIComponent(nota));
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const getInfoPembayaran = async (req, res) => {
  try {
    const { noPembayaran, cabang } = req.query;
    if (!noPembayaran || !cabang)
      throw new Error("Nomor Pembayaran dan Cabang wajib dikirim.");
    const data = await service.getInfoPembayaran(
      decodeURIComponent(noPembayaran),
      cabang,
    );
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const saveFormPelunasan = async (req, res) => {
  try {
    const userKode = req.user.kode;
    const data = await service.saveFormPelunasan(req.body, userKode);
    res.status(200).json({
      success: true,
      data,
      message: "Berhasil menyimpan pelunasan piutang.",
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getPrintData = async (req, res) => {
  try {
    const { nomor } = req.params;
    if (!nomor)
      return res
        .status(400)
        .json({ success: false, message: "Nomor wajib dikirim." });

    const data = await service.getPrintData(decodeURIComponent(nomor));
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getFormEditData,
  getInfoInvoice,
  getInfoPembayaran,
  saveFormPelunasan,
  getPrintData,
};
