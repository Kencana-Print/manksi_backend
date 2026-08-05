const db = require("../../config/database");

/**
 * Browse PO Paperprint.
 * ⚠️ Tidak ada dropdown Cabang di UI — filter cabang OTOMATIS & implisit
 * berdasarkan user.cabang, TANPA exemption bagian apapun (beda dari
 * modul lain yang exempt FINANCE/AUDIT/EDP). Siapapun dengan cabang
 * home terisi selalu terkunci ke cabang itu.
 * ⚠️ Filter SPK pakai LIKE ke child table via LEFT JOIN dinamis —
 * direplikasi persis termasuk potensi baris master terduplikasi kalau
 * 1 PO match >1 SPK (bawaan dari LEFT JOIN tanpa DISTINCT di source).
 */
const getBrowseData = async (startDate, endDate, spkFilter, user) => {
  // ⚠️ FIX: "HO-" adalah fallback backend utk cabang kosong, disamakan
  // perlakuannya dgn frmMenu.CAB='' di Delphi (tidak dikunci cabang)
  const userCab = user.cabang && user.cabang !== "HO-" ? user.cabang : "";
  const hasSpkFilter = spkFilter && spkFilter.trim() !== "";

  let joinDtl = "";
  let filterSpk = "";
  const paramsMaster = [startDate, endDate];

  if (hasSpkFilter) {
    joinDtl = "LEFT JOIN tpopaper_dtl d ON d.pjd_nomor = h.pjh_nomor";
  }

  let filterCabang = "";
  if (userCab !== "") {
    filterCabang = "AND h.pjh_cab = ?";
  }

  if (hasSpkFilter) {
    filterSpk = "AND d.pjd_spk LIKE ?";
  }

  const qMaster = `
    SELECT h.pjh_nomor AS Nomor, h.pjh_cab AS Cab, h.pjh_tanggal AS Tanggal,
      h.pjh_dateline AS Dateline, h.pjh_sup_kode AS KodeSup,
      s.Sup_nama AS Nama, s.Sup_alamat AS Alamat, h.pjh_ket AS Keterangan
    FROM tpopaper_hdr h
    LEFT JOIN tsupplier s ON s.Sup_kode = h.pjh_sup_kode
    ${joinDtl}
    WHERE h.pjh_tanggal >= ? AND h.pjh_tanggal <= ?
    ${filterCabang}
    ${filterSpk}
    ORDER BY h.pjh_tanggal
  `;
  if (userCab !== "") paramsMaster.push(userCab);
  if (hasSpkFilter) paramsMaster.push(`%${spkFilter.trim()}%`);

  const [masterRows] = await db.query(qMaster, paramsMaster);

  const qDetail = `
    SELECT d.pjd_nomor AS Nomor, d.pjd_spk AS Spk, d.pjd_nama AS NamaSpk,
      d.pjd_ukuran AS Ukuran, d.pjd_bahan AS Bahan, d.pjd_qty AS Qty,
      d.pjd_harga AS Harga, d.pjd_ket AS Keterangan
    FROM tpopaper_dtl d
    ORDER BY d.pjd_nomor
  `;
  const [detailRows] = await db.query(qDetail);

  // Dedup master (LEFT JOIN filter SPK bisa gandakan baris) — tampilan
  // browse tetap 1 baris per Nomor, detail tetap lengkap semua row-nya
  const uniqueMasters = [];
  const seenNomor = new Set();
  for (const m of masterRows) {
    if (!seenNomor.has(m.Nomor)) {
      seenNomor.add(m.Nomor);
      uniqueMasters.push(m);
    }
  }

  return uniqueMasters.map((master) => ({
    ...master,
    details: detailRows.filter((d) => d.Nomor === master.Nomor),
  }));
};

/**
 * Hapus PO Paperprint.
 * ⚠️ Replikasi persis: TIDAK ada pengecekan cabang sama sekali di
 * source (beda dari Pemakaian Obat) — hanya cek row ada. Trigger DB
 * yang urus cascade tpopaper_dtl (sesuai kesepakatan sebelumnya).
 */
const deleteData = async (nomor) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [rows] = await conn.query(
      `SELECT pjh_nomor FROM tpopaper_hdr WHERE pjh_nomor = ? FOR UPDATE`,
      [nomor],
    );
    if (rows.length === 0) throw new Error("Data tidak ditemukan.");

    await conn.query(`DELETE FROM tpopaper_hdr WHERE pjh_nomor = ?`, [nomor]);

    await conn.commit();
    return true;
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
};

/**
 * Data cetak PO Paperprint — replikasi query cetak() Delphi (source
 * pakai temp table utk feed FastReport, di sini langsung SELECT
 * gabungan). Info perusahaan pakai perush_kode="KP" (pola sama seperti
 * print-print sebelumnya).
 */
const getPrintData = async (nomor) => {
  const [[header]] = await db.query(
    `SELECT h.pjh_nomor, h.pjh_tanggal, h.pjh_dateline, h.pjh_ket, h.pjh_cab,
       h.pjh_sup_kode, s.sup_nama, s.sup_alamat,
       p.perush_nama, p.perush_alamat, p.perush_kota, p.perush_telp, p.perush_fax
     FROM tpopaper_hdr h
     LEFT JOIN tsupplier s ON s.sup_kode = h.pjh_sup_kode
     LEFT JOIN tperusahaan p ON p.perush_kode = "KP"
     WHERE h.pjh_nomor = ?`,
    [nomor],
  );
  if (!header) return null;

  const [detail] = await db.query(
    `SELECT pjd_spk AS spk, pjd_nama AS nama, pjd_ukuran AS ukuran,
       pjd_bahan AS bahan, pjd_finishing AS finishing, pjd_qty AS jumlah,
       pjd_ket AS ket, pjd_idgambar AS idgambar
     FROM tpopaper_dtl WHERE pjd_nomor = ?`,
    [nomor],
  );

  const details = detail.map((d) => ({
    ...d,
    // ⚠️ Gambar UPLOAD KHUSUS PO ini (prioritas #1). Kalau kosong,
    // frontend fallback ke gambar desain asli SPK (pola SO).
    uploadedImageUrl: d.idgambar
      ? `/images/${encodeURIComponent(`${nomor}${d.spk}${d.idgambar}`)}.jpg`
      : null,
  }));

  return { ...header, details };
};

module.exports = {
  getBrowseData,
  deleteData,
  getPrintData,
};
