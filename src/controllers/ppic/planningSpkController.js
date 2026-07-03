// controllers/ppic/planningSpkController.js
const svc = require("../../services/ppic/planningSpkService");
const ExcelJS = require("exceljs");

const getBrowse = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    if (!startDate || !endDate)
      return res
        .status(400)
        .json({ message: "startDate dan endDate wajib diisi" });
    const data = await svc.getBrowse(startDate, endDate);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getDetail = async (req, res) => {
  try {
    const data = await svc.getDetail(req.params.nomor);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getDetailAktual = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    if (!startDate || !endDate)
      return res
        .status(400)
        .json({ message: "startDate dan endDate wajib diisi" });
    const data = await svc.getDetailAktual(startDate, endDate);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const toggleClose = async (req, res) => {
  try {
    const { isClose } = req.body;
    await svc.toggleClose(req.params.nomor, isClose);
    res.json({
      success: true,
      message: isClose
        ? "Planning berhasil diclose."
        : "Planning berhasil dibuka.",
    });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const deleteData = async (req, res) => {
  try {
    await svc.deleteData(req.params.nomor);
    res.json({ success: true, message: "Planning berhasil dihapus." });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const exportMaster = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const rows = await svc.getExportMaster(startDate, endDate);

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Planning SPK");
    ws.columns = [
      { header: "Nomor", key: "Nomor", width: 22 },
      { header: "Tgl Awal", key: "TglAwal", width: 12 },
      { header: "Tgl Akhir", key: "TglAkhir", width: 12 },
      { header: "Cabang", key: "Cabang", width: 8 },
      { header: "Close", key: "Close", width: 7 },
      { header: "Nomor SPK", key: "NomorSPK", width: 20 },
      { header: "Nama Order", key: "NamaOrder", width: 40 },
      { header: "Jumlah Order", key: "JumlahOrder", width: 13 },
      { header: "Keterangan", key: "Keterangan", width: 30 },
    ];
    ws.getRow(1).font = { bold: true };
    rows.forEach((r) => ws.addRow(r));

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=PlanningSpk_${startDate}_${endDate}.xlsx`,
    );
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const exportDetail = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const rows = await svc.getExportDetail(startDate, endDate);

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Detail Planning SPK");
    ws.columns = [
      { header: "Nomor Plan", key: "NomorPlan", width: 22 },
      { header: "Tgl Awal", key: "TglAwal", width: 12 },
      { header: "Tgl Akhir", key: "TglAkhir", width: 12 },
      { header: "Nomor SPK", key: "NomorSPK", width: 20 },
      { header: "Nama Order", key: "NamaOrder", width: 40 },
      { header: "Qty SPK", key: "QtySPK", width: 10 },
      { header: "Divisi", key: "Divisi", width: 10 },
      { header: "Tgl Jadwal", key: "TglJadwal", width: 12 },
      { header: "WIP", key: "Wip", width: 10 },
      { header: "Qty PO", key: "QtyPO", width: 10 },
      { header: "Qty Jadwal", key: "QtyJadwal", width: 12 },
      { header: "Line/Kelompok", key: "LineKelompok", width: 20 },
    ];
    ws.getRow(1).font = { bold: true };
    rows.forEach((r) => ws.addRow(r));

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=DetailPlanningSpk_${startDate}_${endDate}.xlsx`,
    );
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = {
  getBrowse,
  getDetail,
  getDetailAktual,
  toggleClose,
  deleteData,
  exportMaster,
  exportDetail,
};
