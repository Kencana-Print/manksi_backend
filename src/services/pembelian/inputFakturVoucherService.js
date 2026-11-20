const db = require("../../config/database");
const { sqlNominalVoucher } = require("./pengajuanTransferFormService");

// Harus <= panjang kolom tvoucher_hdr.vou_nomor_pajak (cek query di atas)
const MAX_NO_FAKTUR = 30;
const STATUS_VALID = ["OUTSTANDING", "SUDAH", "SEMUA"];

// Outstanding = PPN dicentang tapi nomor faktur pajak masih kosong.
const SQL_KOSONG = `TRIM(IFNULL(a.vou_nomor_pajak, '')) = ''`;

// Bandingkan faktur tanpa titik, strip, spasi (010.000-24.123 = 01000024123)
const sqlNormal = (kol) =>
  `REPLACE(REPLACE(REPLACE(${kol}, '.', ''), '-', ''), ' ', '')`;
const normal = (s) => String(s).replace(/[.\-\s]/g, "");

// ── Browse ────────────────────────────────────────────────────────────
// OUTSTANDING mengabaikan rentang tanggal supaya voucher lama tidak hilang
// dari daftar; SUDAH/SEMUA memakai rentang tanggal.
const getBrowse = async (startDate, endDate, status = "OUTSTANDING") => {
  const st = STATUS_VALID.includes(status) ? status : "OUTSTANDING";
  const where = ["a.vou_sts_ppn = 1"];
  const params = [];

  if (st === "OUTSTANDING") where.push(SQL_KOSONG);
  else {
    where.push("a.vou_tanggal >= ? AND a.vou_tanggal <= ?");
    params.push(startDate, endDate);
    if (st === "SUDAH") where.push(`NOT (${SQL_KOSONG})`);
  }

  const [rows] = await db.query(
    `SELECT
       a.vou_nomor                                      AS Nomor,
       DATE_FORMAT(a.vou_tanggal, '%Y-%m-%d')           AS Tanggal,
       a.vou_sup_kode                                   AS KodeSupplier,
       IFNULL(b.sup_nama, '')                           AS Supplier,
       IFNULL(a.vou_nomor_invoice, '')                  AS NomorInvoice,
       IFNULL(a.vou_ppn, 0)                             AS Ppn,
       IFNULL(a.vou_nomor_pajak, '')                    AS NomorPajak,
       a.vou_total                                      AS Total,
       ${sqlNominalVoucher("a")}                        AS Net,
       IF(${SQL_KOSONG}, 'OUTSTANDING', 'SUDAH')        AS StatusFaktur,
       DATEDIFF(CURDATE(), a.vou_tanggal)               AS UmurHari,
       IFNULL(a.vou_status_realisasi, '')               AS StatusRealisasi,
       IFNULL(a.vou_keterangan, '')                     AS Keterangan,
       DATE_FORMAT(a.vou_faktur_tgl, '%Y-%m-%d %H:%i')  AS TglInputFaktur,
       IFNULL(a.vou_faktur_user, '')                    AS UserInputFaktur
     FROM tvoucher_hdr a
     LEFT JOIN tsupplier b ON b.sup_kode = a.vou_sup_kode
     WHERE ${where.join(" AND ")}
     ORDER BY a.vou_tanggal, a.vou_nomor`,
    params,
  );
  return rows;
};

// ── Simpan nomor faktur pajak (dialog) ────────────────────────────────
// Sengaja TIDAK memeriksa tutup buku, realisasi, pengajuan transfer, atau
// rekap: faktur pajak biasanya datang sesudah voucher dibayar dan angka
// voucher tidak berubah. Yang diubah hanya vou_nomor_pajak + jejak audit.
const simpanFaktur = async (nomor, noFaktur, userKode) => {
  const vou = String(nomor || "").trim();
  const faktur = String(noFaktur || "").trim();
  if (!vou) throw new Error("Nomor voucher kosong.");
  if (!faktur) throw new Error("Nomor faktur pajak harus diisi.");
  if (faktur.length > MAX_NO_FAKTUR)
    throw new Error(`Nomor faktur pajak maksimal ${MAX_NO_FAKTUR} karakter.`);

  const conn = await db.getConnection();
  await conn.beginTransaction();
  try {
    const [[hdr]] = await conn.query(
      `SELECT vou_nomor, vou_sup_kode, vou_sts_ppn
       FROM tvoucher_hdr WHERE vou_nomor = ? FOR UPDATE`,
      [vou],
    );
    if (!hdr) throw new Error("Voucher tidak ditemukan.");
    if (Number(hdr.vou_sts_ppn) !== 1)
      throw new Error("Voucher ini tidak memakai PPN.");

    // Faktur yang sama di voucher lain: supplier beda = ditolak,
    // supplier sama = hanya peringatan (satu faktur bisa dipecah voucher).
    const [dobel] = await conn.query(
      `SELECT vou_nomor, vou_sup_kode FROM tvoucher_hdr
       WHERE vou_nomor <> ? AND ${sqlNormal("vou_nomor_pajak")} = ?`,
      [vou, normal(faktur)],
    );
    const lain = dobel.filter((d) => d.vou_sup_kode !== hdr.vou_sup_kode);
    if (lain.length)
      throw new Error(
        `Faktur ${faktur} sudah dipakai supplier lain di voucher ${lain[0].vou_nomor}.`,
      );
    const sama = dobel.map((d) => d.vou_nomor);

    await conn.query(
      `UPDATE tvoucher_hdr
       SET vou_nomor_pajak = ?, vou_faktur_tgl = NOW(), vou_faktur_user = ?
       WHERE vou_nomor = ?`,
      [faktur, userKode || "", vou],
    );
    await conn.commit();
    return {
      nomor: vou,
      nomorPajak: faktur,
      peringatan: sama.length
        ? `Faktur ini juga ada di voucher ${sama.join(", ")} (supplier yang sama).`
        : "",
    };
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
};

module.exports = { getBrowse, simpanFaktur };
