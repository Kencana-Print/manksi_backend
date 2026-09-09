const ExcelJS = require("exceljs");
const path = require("path");
const service = require("../../services/master/complainCustomerService");

const getBrowse = async (req, res) => {
  try {
    const data = await service.getBrowseList(req.query);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const deleteComplain = async (req, res) => {
  try {
    await service.deleteComplain(req.params.nomor);
    res.status(200).json({ success: true, message: "Berhasil dihapus." });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const exportExcel = async (req, res) => {
  try {
    const rows = await service.getExportRows(req.query);

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Complain Customer");

    sheet.mergeCells("A1:P1");
    sheet.getCell("A1").value =
      `Daftar Complain Customer | Periode: ${req.query.startDate} s.d ${req.query.endDate}`;
    sheet.getCell("A1").font = {
      bold: true,
      size: 12,
      color: { argb: "FF1565C0" },
    };
    sheet.addRow([]);

    const headerRow = sheet.addRow([
      "Nomor",
      "Tgl Complain",
      "No. SPK/Memo",
      "Customer",
      "Divisi",
      "Tipe",
      "Nama SPK",
      "Jenis Complain",
      "Uraian",
      "Action/Solution",
      "Ket Div1",
      "Ket Div2",
      "Ket Div3",
      "Foto 1",
      "Foto 2",
      "Foto 3",
    ]);
    headerRow.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF1565C0" },
      };
      cell.alignment = { vertical: "middle", horizontal: "center" };
    });

    const widths = [
      16, 12, 18, 28, 12, 12, 28, 22, 28, 28, 24, 24, 24, 18, 18, 18,
    ];
    widths.forEach((w, i) => (sheet.getColumn(i + 1).width = w));

    const IMG_COL_START = 13; // kolom "Foto 1" (index 0-based)
    const IMG_SIZE = 110; // px

    for (const r of rows) {
      const row = sheet.addRow([
        r.Nomor,
        r.TglComplain,
        r.NoSpkMemo,
        r.Customer,
        r.Divisi,
        r.Tipe,
        r.NamaSpk,
        r.JenisComplain,
        r.Uraian,
        r.ActionSolution,
        r.KetDiv1,
        r.KetDiv2,
        r.KetDiv3,
        "",
        "",
        "",
      ]);
      row.height = 85;

      r.Images.forEach((imgPath, idx) => {
        try {
          const ext = path.extname(imgPath).replace(".", "") || "jpeg";
          const imageId = workbook.addImage({
            filename: imgPath,
            extension: ext === "jpg" ? "jpeg" : ext,
          });
          sheet.addImage(imageId, {
            tl: { col: IMG_COL_START + idx, row: row.number - 1 },
            ext: { width: IMG_SIZE, height: IMG_SIZE },
          });
        } catch (imgErr) {
          console.error(`Gagal embed gambar ${imgPath}:`, imgErr.message);
        }
      });
    }

    const fileName = `Complain_Customer_${req.query.startDate}_sd_${req.query.endDate}.xlsx`;
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);

    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error("Export Complain Customer error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getBrowse,
  deleteComplain,
  exportExcel,
};
