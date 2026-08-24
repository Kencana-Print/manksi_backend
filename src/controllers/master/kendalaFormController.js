const service = require("../../services/master/kendalaFormService");

const getDetail = async (req, res) => {
  try {
    const data = await service.getDetail(req.params.nomor);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const save = async (req, res) => {
  try {
    const nomor = req.params.nomor || null;
    const payload = { ...req.body, isEdit: !!nomor };
    const result = await service.saveData(nomor, payload, req.files, req.user);
    res.status(200).json({
      success: true,
      message: "Data berhasil disimpan.",
      data: result,
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const resetImages = async (req, res) => {
  try {
    const { nomor } = req.body;
    if (!nomor) throw new Error("Nomor kendala wajib disertakan.");
    await service.resetImages(nomor);
    res.status(200).json({ success: true, message: "Reset gambar berhasil." });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

module.exports = { getDetail, save, resetImages };
