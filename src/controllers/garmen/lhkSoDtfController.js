const lhkSoDtfService = require("../../services/garmen/lhkSoDtfService");

const getBrowse = async (req, res) => {
  try {
    const { startDate, endDate, cab } = req.query;
    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: "Parameter startDate dan endDate wajib diisi.",
      });
    }
    const data = await lhkSoDtfService.getBrowseData(startDate, endDate, cab);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Dipakai frontend untuk prefill form "Baru" — replikasi defaulting
// Cab (frmMenu.CAB / 'P04' / cabang filter aktif) dan Tanggal (hari ini).
const getDefaultForCreate = async (req, res) => {
  try {
    const userCab = req.user?.cabang || ""; // ← pastikan sudah "cabang"
    const filterCab = req.query.cab || "ALL";
    res.status(200).json({
      success: true,
      data: {
        Cab: lhkSoDtfService.getDefaultCabForInsert(userCab, filterCab),
        Tanggal: new Date().toISOString().substring(0, 10),
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const create = async (req, res) => {
  try {
    const userCab = req.user?.cab || "";
    const filterCab = req.query.cab || req.body.filterCab || "ALL";
    const result = await lhkSoDtfService.createData(
      req.body,
      userCab,
      filterCab,
    );
    res.status(201).json({ success: true, data: result });
  } catch (error) {
    res
      .status(error.statusCode || 500)
      .json({ success: false, message: error.message });
  }
};

const update = async (req, res) => {
  try {
    const { spkNomor, cab, tanggal } = req.params;
    const userCab = req.user?.cab || "";
    const result = await lhkSoDtfService.updateData(
      {
        spkNomor: decodeURIComponent(spkNomor),
        cab: decodeURIComponent(cab),
        tanggal: decodeURIComponent(tanggal),
      },
      req.body,
      userCab,
    );
    res.status(200).json({ success: true, data: result });
  } catch (error) {
    res
      .status(error.statusCode || 500)
      .json({ success: false, message: error.message });
  }
};

const remove = async (req, res) => {
  try {
    const { spkNomor, cab, tanggal } = req.params;
    const userCab = req.user?.cab || "";
    await lhkSoDtfService.deleteData(
      decodeURIComponent(spkNomor),
      decodeURIComponent(cab),
      decodeURIComponent(tanggal),
      userCab,
    );
    res.status(200).json({ success: true, message: "Berhasil dihapus." });
  } catch (error) {
    res
      .status(error.statusCode || 500)
      .json({ success: false, message: error.message });
  }
};

module.exports = { getBrowse, getDefaultForCreate, create, update, remove };
