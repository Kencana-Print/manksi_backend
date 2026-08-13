const service = require("../../services/master/complainCustomerFormService");

const getJenisComplain = async (req, res) => {
  try {
    const data = await service.getJenisComplainOptions();
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getSpkDetail = async (req, res) => {
  try {
    const data = await service.getSpkOrMemoDetail(req.params.nomor);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const getDetail = async (req, res) => {
  try {
    const data = await service.getDetailForm(req.params.nomor);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const save = async (req, res) => {
  try {
    const nomor = req.params.nomor || null;
    const payload = { ...req.body, isEdit: !!nomor };
    const result = await service.saveData(nomor, payload, req.user);
    res.status(200).json({
      success: true,
      message: "Data berhasil disimpan.",
      data: result,
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const uploadImage = async (req, res) => {
  try {
    if (!req.file) throw new Error("File gambar tidak ditemukan.");
    const { nomor, slot } = req.body;
    if (!nomor || !slot) throw new Error("Nomor dan slot wajib disertakan.");

    const filename = await service.processImage(req.file.path, nomor, slot);
    res
      .status(200)
      .json({ success: true, message: "Gambar berhasil diupload.", filename });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const resetImages = async (req, res) => {
  try {
    const { nomor } = req.body;
    if (!nomor) throw new Error("Nomor complain wajib disertakan.");
    await service.resetImages(nomor);
    res.status(200).json({ success: true, message: "Reset gambar berhasil." });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

module.exports = {
  getJenisComplain,
  getSpkDetail,
  getDetail,
  save,
  uploadImage,
  resetImages,
};
