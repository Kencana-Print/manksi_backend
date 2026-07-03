const svc = require("../../services/penjualan/exportCsvPajakService");

const getBrowse = async (req, res) => {
  try {
    const {
      tglAwal,
      tglAkhir,
      cusKode = "",
      perushKode = "",
      nomor = "",
    } = req.query;
    const data = await svc.getBrowse(
      tglAwal,
      tglAkhir,
      cusKode,
      perushKode,
      nomor,
    );
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getBrowseDetail = async (req, res) => {
  try {
    const { nomor } = req.query;
    const data = await svc.getBrowseDetail(nomor);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const exportCsv = async (req, res) => {
  try {
    const {
      tglAwal,
      tglAkhir,
      cusKode = "",
      perushKode = "",
      nomor = "",
    } = req.body;
    const csv = await svc.generateCsv(
      tglAwal,
      tglAkhir,
      cusKode,
      perushKode,
      nomor,
    );
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="FakturPajak_${tglAwal}_${tglAkhir}.csv"`,
    );
    res.send(csv);
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const exportXlsx = async (req, res) => {
  try {
    const {
      tglAwal,
      tglAkhir,
      cusKode = "",
      perushKode = "",
      nomor = "",
    } = req.body;
    const buffer = await svc.generateXlsxBuffer(
      tglAwal,
      tglAkhir,
      cusKode,
      perushKode,
      nomor,
    );
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="FakturPajak_${tglAwal}_${tglAkhir}.xlsx"`,
    );
    res.send(buffer);
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

module.exports = {
  getBrowse,
  getBrowseDetail,
  exportCsv,
  exportXlsx,
};
