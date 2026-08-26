const db = require("../../config/database");
const ExcelJS = require("exceljs");

// ═══════════════════════════════════════════════════════════
// EXPORT CSV/XLSX KE FAKTUR PAJAK — SERVICE
// Migrasi dari ufrmExportCsvFP.pas (Delphi)
//
// CATATAN PENTING (deviasi dari Delphi):
//   1. Button4Click/dolaporan (laporan Penawaran vs SPK) DIABAIKAN —
//      itu kode mati, "Button4" tidak dideklarasikan sbg komponen di
//      form ini, handler-nya tidak pernah bisa ter-trigger dari UI.
//   2. Bug Kode_transaksi di path XLSX DIPERBAIKI: Delphi asli
//      membandingkan SELURUH inv_no_fp dgn literal "02"/"03" (nyaris
//      tidak pernah match), sehingga hasil SELALU "04". Di sini dipakai
//      LEFT(inv_no_fp,2) yang benar, konsisten dgn path CSV.
//   3. Baris "LT" di CSV export DIREPLIKASI APA ADANYA termasuk bug-nya
//      (kolom NPWP ketiban nama perusahaan, 7 kolom terakhir hilang) —
//      TIDAK diperbaiki, karena importer eksternal mungkin sudah
//      terbiasa dgn format ini.
//   4. Staging table global temp_pkhead/temp_pkdet DIHAPUS TOTAL (sama
//      race-condition risk seperti tampung sebelumnya) — nomor "Baris"
//      dihitung in-memory dari index array.
//   5. Export CSV & XLSX SAMA-SAMA menandai inv_hdr.isexportppn=1,
//      dibungkus transaksi (Delphi tidak transaksional per-baris).
// ═══════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────
// BROWSE — sesuai Delphi loaddata()
// Filter: customer/perusahaan prefix-match, nomor contains-match,
// SEMUA opsional, WAJIB inv_no_fp <> ''
// ─────────────────────────────────────────────────────────
const getBrowse = async (
  tglAwal,
  tglAkhir,
  cusKode = "",
  perushKode = "",
  nomor = "",
) => {
  const [rows] = await db.query(
    `SELECT
       a.inv_nomor                                    AS Nomor,
       DATE_FORMAT(a.inv_tanggal,'%Y-%m-%d')          AS Tanggal,
       c.cus_nama                                       AS NamaCustomer,
       a.inv_keterangan                                 AS Keterangan,
       IF(a.inv_sts_pro=0,'Normal', IF(a.inv_sts_pro=1,'Proforma','Tidak Normal')) AS Status,
       IF(a.inv_status_otomatis=1,'Otomatis','Normal') AS Otomatis,
       (
         SELECT SUM(invd_harga*invd_jumlah*IF(a.inv_sts_ppn=1,((100+a.inv_ppn)/100),1))
         FROM tinv_dtl WHERE invd_inv_nomor = a.inv_nomor
       )                                                AS Total,
       a.inv_no_fp                                      AS FakturPajak
     FROM tinv_hdr a
     INNER JOIN tcustomer c ON c.cus_kode = a.inv_cus_kode
     INNER JOIN tperusahaan p ON p.perush_kode = a.inv_perush_kode
     WHERE a.inv_cus_kode LIKE ?
       AND a.inv_tanggal >= ? AND a.inv_tanggal <= ?
       AND a.inv_perush_kode LIKE ?
       AND a.inv_nomor LIKE ?
       AND a.inv_no_fp <> ''`,
    [`${cusKode}%`, tglAwal, tglAkhir, `${perushKode}%`, `%${nomor}%`],
  );
  return rows;
};

// ─────────────────────────────────────────────────────────
// BROWSE DETAIL — sesuai Delphi DBGridEh1CellClick
// Filter HANYA by nomor (tidak ikut filter tanggal, sesuai Delphi)
// ─────────────────────────────────────────────────────────
const getBrowseDetail = async (nomor) => {
  const [rows] = await db.query(
    `SELECT
       d.invd_spk_nomor AS Kode, b.brg_name AS Nama, b.brg_ukuran AS Ukuran,
       d.invd_jumlah AS Jumlah, d.invd_harga AS Harga
     FROM tinv_dtl d
     INNER JOIN tbarang b ON b.brg_kode = d.invd_spk_nomor
     WHERE d.invd_inv_nomor = ?`,
    [nomor],
  );
  return rows;
};

// ─────────────────────────────────────────────────────────
// HELPER — daftar invoice + detail lengkap utk export (dipakai CSV & XLSX)
// ─────────────────────────────────────────────────────────
const getExportInvoices = async (
  tglAwal,
  tglAkhir,
  cusKode = "",
  perushKode = "",
  nomor = "",
) => {
  const [invoices] = await db.query(
    `SELECT
      a.inv_nomor, DATE_FORMAT(a.inv_tanggal, '%Y-%m-%d') AS inv_tanggal, a.inv_ppn, a.inv_cus_alamat,
      a.inv_no_fp,
      c.cus_npwp, c.cus_nama_npwp, c.cus_alamat_npwp, c.cus_email,
      p.perush_npwp, p.perush_namanpwp, p.perush_alamatnpwp,
      p.perush_kdpos, p.perush_telp
     FROM tinv_hdr a
     INNER JOIN tcustomer c ON c.cus_kode = a.inv_cus_kode
     INNER JOIN tperusahaan p ON p.perush_kode = a.inv_perush_kode
     WHERE a.inv_cus_kode LIKE ?
       AND a.inv_tanggal >= ? AND a.inv_tanggal <= ?
       AND a.inv_perush_kode LIKE ?
       AND a.inv_nomor LIKE ?
       AND a.inv_no_fp <> ''
     ORDER BY a.inv_nomor`,
    [`${cusKode}%`, tglAwal, tglAkhir, `${perushKode}%`, `%${nomor}%`],
  );

  if (!invoices.length) return [];

  const nomorList = invoices.map((i) => i.inv_nomor);
  const placeholders = nomorList.map(() => "?").join(",");
  const [details] = await db.query(
    `SELECT
       d.invd_inv_nomor, d.invd_spk_nomor, d.invd_harga, d.invd_jumlah,
       IFNULL(s.spk_nama2, b.brg_name) AS nama_barang
     FROM tinv_dtl d
     LEFT JOIN tspk s ON s.spk_nomor = d.invd_spk_nomor
     LEFT JOIN tbarang b ON b.brg_kode = d.invd_spk_nomor
     WHERE d.invd_inv_nomor IN (${placeholders})`,
    nomorList,
  );

  const detailMap = {};
  for (const d of details) {
    if (!detailMap[d.invd_inv_nomor]) detailMap[d.invd_inv_nomor] = [];
    detailMap[d.invd_inv_nomor].push(d);
  }

  return invoices.map((inv) => ({
    ...inv,
    detail: detailMap[inv.inv_nomor] || [],
  }));
};

// ─────────────────────────────────────────────────────────
// TANDAI SUDAH DIEXPORT — sesuai Delphi (per invoice, di sini
// dibungkus transaksi tunggal utk seluruh batch)
// ─────────────────────────────────────────────────────────
const markExported = async (nomorList) => {
  if (!nomorList.length) return;
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const placeholders = nomorList.map(() => "?").join(",");
    await conn.query(
      `UPDATE tinv_hdr SET isexportppn = 1 WHERE inv_nomor IN (${placeholders})`,
      nomorList,
    );
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
};

// ─────────────────────────────────────────────────────────
// EXPORT CSV — sesuai Delphi Button3Click (format e-Faktur klasik)
// ─────────────────────────────────────────────────────────
const cleanNpwp = (v) => (v || "").replace(/\./g, "").replace(/-/g, "");
const cleanDots = (v) => (v || "").replace(/\./g, "");
const dec3 = (v) => Number(v || 0).toFixed(3);
const fmtDateSlash = (v) => {
  if (!v) return "";
  const [y, m, d] = String(v).split("-");
  if (!y || !m || !d) return "";
  return `${d}/${m}/${y}`;
};

const generateCsv = async (tglAwal, tglAkhir, cusKode, perushKode, nomor) => {
  const invoices = await getExportInvoices(
    tglAwal,
    tglAkhir,
    cusKode,
    perushKode,
    nomor,
  );

  const lines = [];
  lines.push(
    '"FK","KD_JENIS_TRANSAKSI","FG_PENGGANTI","NOMOR_FAKTUR","MASA_PAJAK","TAHUN_PAJAK","TANGGAL_FAKTUR","NPWP","NAMA","ALAMAT_LENGKAP","JUMLAH_DPP","JUMLAH_PPN","JUMLAH_PPNBM","ID_KETERANGAN_TAMBAHAN","FG_UANG_MUKA","UANG_MUKA_DPP","UANG_MUKA_PPN","UANG_MUKA_PPNBM","REFERENSI","KODE_DOKUMEN_PENDUKUNG"',
  );
  lines.push(
    '"LT","NPWP","NAMA","JALAN","BLOK","NOMOR","RT","RW","KECAMATAN","KELURAHAN","KABUPATEN","PROPINSI","KODE_POS","NOMOR_TELEPON"',
  );
  lines.push(
    '"OF","KODE_OBJEK","NAMA","HARGA_SATUAN","JUMLAH_BARANG","HARGA_TOTAL","DISKON","DPP","PPN","TARIF_PPNBM","PPNBM"',
  );

  for (const inv of invoices) {
    const noFpNoDots = cleanDots(inv.inv_no_fp);
    const kdJenisTransaksi = noFpNoDots.substring(0, 2);
    const nomorFakturTrimmed = noFpNoDots.slice(3); // Copy(s,4,len-3)
    const [tahunPajak, masaPajakRaw] = inv.inv_tanggal.split("-").map(Number);
    const masaPajak = masaPajakRaw;
    const npwp = cleanNpwp(inv.cus_npwp);
    const alamatLengkap = inv.inv_cus_alamat || inv.cus_alamat_npwp || "";

    const dpp = inv.detail.reduce(
      (s, r) => s + Number(r.invd_harga) * Number(r.invd_jumlah),
      0,
    );
    const ppnTotal = dpp * (Number(inv.inv_ppn) / 100);

    // ── Baris FK ──
    lines.push(
      [
        '"FK"',
        `"${kdJenisTransaksi}"`,
        `"0"`,
        `"${nomorFakturTrimmed}"`,
        masaPajak,
        tahunPajak,
        `"${fmtDateSlash(inv.inv_tanggal)}"`,
        `"${npwp}"`,
        `"${inv.cus_nama_npwp || ""}"`,
        `"${alamatLengkap}"`,
        `"${dec3(dpp)}"`,
        `"${dec3(ppnTotal)}"`,
        `"0"`,
        `""`,
        `"0"`,
        `"0"`,
        `"0"`,
        `"0"`,
        `"${inv.inv_nomor}"`,
      ].join(","),
    );

    // ── Baris LT — DIPERBAIKI. Bug asli Delphi: marker record literal
    // "FAPR" (harusnya "LT", tidak konsisten dgn pola marker "FK"/"OF"
    // yg lain), field NPWP perusahaan tidak pernah di-select sama sekali
    // (posisi NPWP malah ketiban perush_namanpwp), dan 7 kolom terakhir
    // (KECAMATAN..NOMOR_TELEPON) tidak pernah ditulis. Di sini dilengkapi
    // 14 kolom: field alamat terstruktur (BLOK/NOMOR/RT/RW/KECAMATAN/
    // KELURAHAN/KABUPATEN/PROPINSI) diisi kosong/"0" krn memang tidak
    // ditrack di skema (konsisten pola placeholder Delphi utk field
    // serupa) — KODE_POS & NOMOR_TELEPON diisi data asli krn field itu
    // memang tersedia di tperusahaan (perbaikan nyata, Delphi selalu "0").
    const perushNpwpClean = cleanNpwp(inv.perush_npwp);
    lines.push(
      [
        '"LT"',
        `"${perushNpwpClean}"`,
        `"${inv.perush_namanpwp || ""}"`,
        `"${inv.perush_alamatnpwp || ""}"`,
        `""`,
        `""`,
        `""`,
        `""`,
        `"0"`,
        `"0"`,
        `"0"`,
        `"0"`,
        `"${inv.perush_kdpos || "0"}"`,
        `"${inv.perush_telp || "0"}"`,
      ].join(","),
    );

    // ── Baris OF per item ──
    for (const r of inv.detail) {
      const hargaTotal = Number(r.invd_harga) * Number(r.invd_jumlah);
      const ppnItem = (Number(inv.inv_ppn) / 100) * hargaTotal;
      lines.push(
        [
          '"OF"',
          `"${r.invd_spk_nomor}"`,
          `"${r.nama_barang}"`,
          `"${dec3(r.invd_harga)}"`,
          `"${Number(r.invd_jumlah)}"`,
          `"${dec3(hargaTotal)}"`,
          `"0.000"`,
          `"${dec3(hargaTotal)}"`,
          `"${dec3(ppnItem)}"`,
          `"0"`,
          `"0"`,
        ].join(","),
      );
    }
  }

  await markExported(invoices.map((i) => i.inv_nomor));

  return lines.join("\r\n");
};

// ─────────────────────────────────────────────────────────
// EXPORT XLSX — sesuai Delphi Button2Click (format Coretax bulk import)
// DIPERBAIKI: Kode_transaksi pakai LEFT(no_fp,2) yg benar (lihat
// catatan bug #1 di atas — Delphi asli selalu hasilkan "04").
// ─────────────────────────────────────────────────────────
const generateXlsxBuffer = async (
  tglAwal,
  tglAkhir,
  cusKode,
  perushKode,
  nomor,
) => {
  const invoices = await getExportInvoices(
    tglAwal,
    tglAkhir,
    cusKode,
    perushKode,
    nomor,
  );

  const wb = new ExcelJS.Workbook();
  const shFaktur = wb.addWorksheet("Faktur");
  const shDetail = wb.addWorksheet("DetailFaktur");

  // ── Sheet Faktur ──
  shFaktur.mergeCells("A1:B1");
  shFaktur.getCell("A1").value = "NPWP Penjual";

  const fakturHeaders = [
    "Baris",
    "Tanggal Faktur",
    "Jenis Faktur",
    "Kode Transaksi",
    "Keterangan Tambahan",
    "Dokumen Pendukung",
    "Referensi",
    "Cap Fasilitas",
    "ID TKU Penjual",
    "NPWP/NIK Pembeli",
    "Jenis ID Pembeli",
    "Negara Pembeli",
    "Nomor Dokumen Pembeli",
    "Nama Pembeli",
    "Alamat Pembeli",
    "Email Pembeli",
    "ID TKU Pembeli",
  ];
  shFaktur.getRow(3).values = fakturHeaders;

  const detailRows = [];
  invoices.forEach((inv, idx) => {
    const baris = idx + 1;
    const npwpPenjual = "0" + cleanNpwp(inv.perush_npwp) + "000000";
    const npwpPembeli = "0" + cleanNpwp(inv.cus_npwp);
    const idTkuPembeli = npwpPembeli + "000000";

    if (idx === 0) {
      shFaktur.getCell("C1").value = npwpPenjual.substring(0, 16);
    }

    const noFpNoDots = cleanDots(inv.inv_no_fp);
    // Bug Delphi asli: bandingkan SELURUH inv_no_fp dgn "02"/"03" (selalu
    // gagal → selalu "04"). Di sini pakai LEFT 2 digit yg benar.
    const kodeTransaksi = ["02", "03"].includes(noFpNoDots.substring(0, 2))
      ? noFpNoDots.substring(0, 2)
      : "04";

    const row = shFaktur.getRow(4 + idx);
    row.getCell(1).value = String(baris);
    const [y, m, d] = inv.inv_tanggal.split("-").map(Number);
    row.getCell(2).value = new Date(Date.UTC(y, m - 1, d));
    row.getCell(2).numFmt = "mm-dd-yy";
    row.getCell(3).value = "Normal";
    row.getCell(4).value = kodeTransaksi;
    row.getCell(5).value = " ";
    row.getCell(6).value = " ";
    row.getCell(7).value = inv.inv_nomor;
    row.getCell(8).value = " ";
    row.getCell(9).value = npwpPenjual;
    row.getCell(10).value = npwpPembeli;
    row.getCell(11).value = "TIN";
    row.getCell(12).value = "IDN";
    row.getCell(13).value = "-";
    row.getCell(14).value = inv.cus_nama_npwp || "";
    row.getCell(15).value = inv.cus_alamat_npwp || "";
    row.getCell(16).value = inv.cus_email || "";
    row.getCell(17).value = idTkuPembeli;

    // Kolom yang wajib TEXT (leading zero) — sesuai Delphi NumberFormat '@'
    [1, 4, 9, 10, 17].forEach((c) => (row.getCell(c).numFmt = "@"));

    for (const d of inv.detail) {
      const isJasa = /jasa/i.test(d.nama_barang || "");
      const hargaTotal = Number(d.invd_harga) * Number(d.invd_jumlah);
      const dppNilaiLain = Math.round((11 / 12) * hargaTotal * 100) / 100;
      const ppn = Math.round(0.12 * dppNilaiLain * 100) / 100;
      detailRows.push({
        baris,
        barangjasa: isJasa ? "B" : "A",
        kode: "000000",
        nama: d.nama_barang,
        satuan: isJasa ? "UM.0033" : "UM.0021",
        hargaSatuan: Number(d.invd_harga).toFixed(2),
        jumlah: Number(d.invd_jumlah).toFixed(2),
        diskon: 0,
        dpp: hargaTotal.toFixed(2),
        dppNilaiLain: dppNilaiLain.toFixed(2),
        tarifPpn: 12,
        ppn: ppn.toFixed(2),
        tarifPpnbm: 0,
        ppnbm: 0,
      });
    }
  });

  shFaktur.getRow(4 + invoices.length).getCell(1).value = "END";

  // ── Sheet DetailFaktur ──
  const detailHeaders = [
    "Baris",
    "Barang/Jasa",
    "kode Barang/jasa",
    "Nama barang/jasa",
    "Nama Satuan Ukur",
    "Harga Satuan",
    "Jumlah Barang/jasa",
    "Total Diskon",
    "DPP",
    "DPP Nilai Lain",
    "Tarif PPN",
    "PPN",
    "Tarif PPNBM",
    "PPNBM",
  ];
  shDetail.getRow(1).values = [...detailHeaders];

  detailRows.forEach((d, i) => {
    const row = shDetail.getRow(2 + i);
    row.getCell(1).value = d.baris;
    row.getCell(2).value = d.barangjasa;
    row.getCell(3).value = d.kode;
    row.getCell(3).numFmt = "@";
    row.getCell(4).value = d.nama;
    row.getCell(5).value = d.satuan;
    row.getCell(6).value = Number(d.hargaSatuan);
    row.getCell(7).value = Number(d.jumlah);
    row.getCell(8).value = Number(d.diskon) || 0;
    row.getCell(9).value = Number(d.dpp);
    row.getCell(10).value = Number(d.dppNilaiLain);
    row.getCell(11).value = Number(d.tarifPpn) || 0;
    row.getCell(12).value = Number(d.ppn);
    row.getCell(13).value = Number(d.tarifPpnbm) || 0;
    row.getCell(14).value = Number(d.ppnbm) || 0;
  });

  shDetail.getRow(2 + detailRows.length).getCell(1).value = "END";

  await markExported(invoices.map((i) => i.inv_nomor));

  return wb.xlsx.writeBuffer();
};

module.exports = {
  getBrowse,
  getBrowseDetail,
  generateCsv,
  generateXlsxBuffer,
};
