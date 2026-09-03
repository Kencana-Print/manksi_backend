const mkbService = require("../../services/pembelian/mkbService");

const getBrowse = async (req, res) => {
  try {
    let { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
      const now = new Date();
      startDate = new Date(now.getFullYear(), now.getMonth(), 1)
        .toISOString()
        .split("T")[0];
      endDate = now.toISOString().split("T")[0];
    }

    const canLihatCus = Number(req.user?.flags?.lihatCus) === 1;

    const [soPending, mkbRows] = await Promise.all([
      mkbService.getSoBelumMkb(),
      mkbService.getBrowseMkb(startDate, endDate, canLihatCus),
    ]);

    const soPendingRows = soPending.map((r) => ({
      ...r,
      RowType: "SO_PENDING",
      PO: 0,
      Keterangan: "",
      Plan: 0,
      Ngedit: "",
      usr: "",
      Created: null,
    }));

    const data = [...soPendingRows, ...mkbRows];

    res.json({ success: true, data, canLihatCus });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getLinkedPo = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await mkbService.getLinkedPo(nomor);
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const deleteMkb = async (req, res) => {
  try {
    const { nomor } = req.params;
    const { tglTransaksi } = req.body;

    if (!tglTransaksi) {
      return res.status(400).json({
        success: false,
        message: "Tanggal transaksi dibutuhkan untuk validasi tutup buku.",
      });
    }

    await mkbService.deleteMkb(nomor, tglTransaksi);
    res.json({ success: true, message: `MKB ${nomor} berhasil dihapus.` });
  } catch (error) {
    const statusCode = error.message.includes("sudah close") ? 403 : 500;
    res.status(statusCode).json({ success: false, message: error.message });
  }
};

const requestPin = async (req, res) => {
  try {
    const { nomor, tanggal, spk, alasan } = req.body;
    const result = await mkbService.requestPin(
      { nomor, tanggal, spk, alasan },
      req.user,
    );
    res.json({
      success: true,
      message: "Berhasil diajukan. Menunggu ACC.",
      data: result,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getDetailData = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await mkbService.getDetailData(nomor);
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getAllDetailData = async (req, res) => {
  try {
    let { startDate, endDate } = req.query;
    if (!startDate || !endDate) {
      const now = new Date();
      startDate = new Date(now.getFullYear(), now.getMonth(), 1)
        .toISOString()
        .split("T")[0];
      endDate = now.toISOString().split("T")[0];
    }
    const canLihatCus = Number(req.user?.flags?.lihatCus) === 1;
    const data = await mkbService.getAllDetailData(
      startDate,
      endDate,
      canLihatCus,
    );
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getBrowse,
  getDetailData,
  getLinkedPo,
  deleteMkb,
  requestPin,
  getAllDetailData,
};
