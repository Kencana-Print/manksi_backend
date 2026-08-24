const db = require("../../config/database");
const ExcelJS = require("exceljs");
const fs = require("fs");
const path = require("path");

// ─────────────────────────────────────────────
// FOLDER GAMBAR — dua sumber, dicek berurutan:
//   1. Folder baru (upload via form web, pola sama seperti
//      complainCustomerForm — sharp, nama {nomor}-0{slot}.jpg)
//   2. Folder lama (/mnt/image, legacy Delphi apathimage, read-only)
// Nama file KEDUANYA sama persis: {nomor}-01.jpg / -02.jpg / -03.jpg
// — cuma folder induknya beda, jadi fallback ini aman dipakai.
// ─────────────────────────────────────────────
const IMAGE_DIR_NEW = path.join(process.cwd(), "public", "images", "kendala");
const IMAGE_DIR_LEGACY = "/mnt/image";

const resolveImagePath = (nomor, suffix) => {
  const fileName = `${nomor}${suffix}.jpg`;
  const newPath = path.join(IMAGE_DIR_NEW, fileName);
  if (fs.existsSync(newPath)) return newPath;
  const legacyPath = path.join(IMAGE_DIR_LEGACY, fileName);
  if (fs.existsSync(legacyPath)) return legacyPath;
  return null;
};

// ─────────────────────────────────────────────
// BROWSE — replikasi persis btnRefreshClick Delphi.
// ⚠️ TIDAK ADA filter cabang di query Delphi aslinya — beda dari
// modul lain (mis. BAP Produksi) yang membatasi per-cabang. Semua
// user melihat data yang sama, tidak dibatasi cabang.
// ─────────────────────────────────────────────
const getBrowse = async (startDate, endDate) => {
  const query = `
    SELECT
      tk_nomor AS Nomor,
      DATE_FORMAT(tk_date, "%d-%m-%Y") AS Tanggal,
      tk_description AS Kendala,
      tk_keterangan AS Keterangan
    FROM tkendala
    WHERE tk_date >= ? AND tk_date <= ?
    ORDER BY tk_nomor ASC
  `;
  const [rows] = await db.query(query, [startDate, endDate]);
  return rows;
};

const remove = async (nomor) => {
  await db.query(`DELETE FROM tkendala WHERE tk_nomor = ?`, [nomor]);
};

const formatDateID = (v) => {
  if (!v) return "";
  const s = String(v).substring(0, 10);
  const [y, m, d] = s.split("-");
  return `${d}/${m}/${y}`;
};

// ─────────────────────────────────────────────
// EXPORT — replikasi persis cxButton6Click Delphi:
//   - Letterhead perusahaan + blok NAMA LAPORAN/PERIODE
//   - Header data biru (Nomor/Tanggal/Kendala/Keterangan)
//   - 3 kolom tambahan: FOTO SAMPLE, HASIL PRODUKSI, FOTO SPK —
//     gambar di-embed kalau file-nya ADA (cek folder baru dulu,
//     fallback folder lama). Beda dari Delphi yang JUGA mensyaratkan
//     kolom tk_imageN di DB terisi — syarat itu SENGAJA DILEPAS di
//     sini, karena upload via form web (pola complainCustomerForm)
//     tidak selalu menuliskan balik ke kolom tk_imageN; cukup andalkan
//     keberadaan file fisik, lebih robust terhadap data yang tak
//     konsisten.
// ─────────────────────────────────────────────
const buildExportWorkbook = async (startDate, endDate) => {
  const [rows] = await db.query(
    `SELECT
       tk_nomor AS Nomor,
       DATE_FORMAT(tk_date, "%d-%m-%Y") AS Tanggal,
       tk_description AS Kendala,
       tk_keterangan AS Keterangan
     FROM tkendala
     WHERE tk_date >= ? AND tk_date <= ?
     ORDER BY tk_nomor ASC`,
    [startDate, endDate],
  );
  const [perushRows] = await db.query(
    `SELECT perush_nama, perush_alamat FROM tperusahaan LIMIT 1`,
  );
  const namaPerush = perushRows[0]?.perush_nama || "";
  const alamatPerush = perushRows[0]?.perush_alamat || "";

  const wb = new ExcelJS.Workbook();
  wb.creator = "MANKSI ERP";
  wb.created = new Date();
  const ws = wb.addWorksheet("Sheet1");
  const lastCol = 7; // A..G — 4 kolom data + 3 kolom foto

  // ── Kop perusahaan ──
  ws.mergeCells(1, 1, 1, lastCol);
  ws.getCell(1, 1).value = `${namaPerush}\n${alamatPerush}`;
  ws.getCell(1, 1).alignment = {
    horizontal: "center",
    vertical: "middle",
    wrapText: true,
  };
  ws.getCell(1, 1).font = { bold: true, size: 12 };
  ws.getRow(1).height = 40;

  // ── Blok NAMA LAPORAN / PERIODE ──
  ws.mergeCells(2, 1, 2, 2);
  ws.getCell(2, 1).value = "NAMA LAPORAN\n \nPERIODE";
  ws.getCell(2, 1).alignment = { wrapText: true, vertical: "top" };
  ws.mergeCells(2, 3, 2, lastCol);
  ws.getCell(2, 3).value =
    `: LAPORAN KENDALA\n:\n: ${formatDateID(startDate)} s.d ${formatDateID(endDate)}`;
  ws.getCell(2, 3).alignment = {
    wrapText: true,
    vertical: "top",
    horizontal: "left",
  };
  ws.getRow(2).height = 45;

  // ── Header kolom data (baris 4, meniru posisi Delphi) ──
  const dataHeaders = [
    "NOMOR",
    "TANGGAL",
    "KENDALA",
    "KETERANGAN",
    "FOTO SAMPLE",
    "HASIL PRODUKSI",
    "FOTO SPK",
  ];
  dataHeaders.forEach((h, i) => (ws.getCell(4, i + 1).value = h));
  for (let c = 1; c <= lastCol; c++) {
    const cell = ws.getCell(4, c);
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF87CEEB" },
    };
    cell.font = { bold: true };
    cell.alignment = { horizontal: "center", vertical: "middle" };
  }

  ws.getColumn(1).width = 16; // Nomor
  ws.getColumn(2).width = 12; // Tanggal
  ws.getColumn(3).width = 40; // Kendala
  ws.getColumn(4).width = 40; // Keterangan
  ws.getColumn(5).width = 16; // Foto Sample
  ws.getColumn(6).width = 16; // Hasil Produksi
  ws.getColumn(7).width = 16; // Foto SPK

  // ── Data rows + embed gambar ──
  let jRow = 5;
  for (const r of rows) {
    ws.getCell(jRow, 1).value = r.Nomor ?? "";
    ws.getCell(jRow, 2).value = r.Tanggal ?? "";
    ws.getCell(jRow, 3).value = r.Kendala ?? "";
    ws.getCell(jRow, 4).value = r.Keterangan ?? "";
    ws.getCell(jRow, 3).alignment = { wrapText: true, vertical: "middle" };
    ws.getCell(jRow, 4).alignment = { wrapText: true, vertical: "middle" };
    ws.getRow(jRow).height = 86; // sama seperti Delphi (rowheight:=86)

    const imageSlots = [
      { suffix: "-01", col: 5 }, // FOTO SAMPLE
      { suffix: "-02", col: 6 }, // HASIL PRODUKSI
      { suffix: "-03", col: 7 }, // FOTO SPK
    ];
    for (const slot of imageSlots) {
      const filePath = resolveImagePath(r.Nomor, slot.suffix);
      if (!filePath) continue;
      try {
        const imgId = wb.addImage({ filename: filePath, extension: "jpeg" });
        ws.addImage(imgId, {
          tl: { col: slot.col - 1 + 0.1, row: jRow - 1 + 0.1 },
          ext: { width: 80, height: 80 },
        });
      } catch (e) {
        console.error(`Gagal embed gambar ${filePath}:`, e.message);
      }
    }
    jRow++;
  }
  const lastRow = jRow - 1;

  // ── Border seluruh area tabel ──
  for (let r = 4; r <= lastRow; r++) {
    for (let c = 1; c <= lastCol; c++) {
      ws.getCell(r, c).border = {
        top: { style: "thin" },
        left: { style: "thin" },
        bottom: { style: "thin" },
        right: { style: "thin" },
      };
    }
  }

  ws.pageSetup = {
    orientation: "portrait",
    scale: 60,
    margins: {
      left: 0.2,
      right: 0.2,
      top: 0.2,
      bottom: 0.2,
      header: 0,
      footer: 0,
    },
  };

  return wb;
};

module.exports = { getBrowse, remove, buildExportWorkbook };
