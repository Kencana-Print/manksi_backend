const service = require("../../services/tools/agendaPicService");

const getPicList = async (req, res) => {
  try {
    const data = await service.getPicList(req.user.bagian, req.user.cabang);
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getCandidateUsers = async (req, res) => {
  try {
    const data = await service.getCandidateUsers(
      req.user.bagian,
      req.user.cabang,
    );
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const addPic = async (req, res) => {
  try {
    const { userKode } = req.body;
    if (!userKode)
      return res
        .status(400)
        .json({ success: false, message: "userKode wajib diisi." });
    await service.addPic(
      req.user.bagian,
      req.user.cabang,
      userKode,
      req.user.kode,
    );
    res.json({ success: true, message: "PIC berhasil ditambahkan." });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const removePic = async (req, res) => {
  try {
    await service.removePic(
      req.user.bagian,
      req.user.cabang,
      req.params.userKode,
    );
    res.json({ success: true, message: "PIC berhasil dihapus." });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

module.exports = { getPicList, getCandidateUsers, addPic, removePic };
