const db = require("../../config/database");

/**
 * Resolusi cabang default filter — sama pola Pemakaian Obat: dropdown
 * ALL/P01/P04, default ke cabang user kalau termasuk salah satunya,
 * else ALL. Beda dari PO Paperprint yg tidak punya dropdown sama sekali.
 */
const resolveDefaultCabang = (user) => {
  const userCab = user.cabang || "";
  return ["P01", "P04"].includes(userCab) ? userCab : "ALL";
};

/**
 * Browse PO DTF.
 * ⚠️ Filter SPK pakai LIKE ke child table via LEFT JOIN dinamis — sama
 * pola PO Paperprint, termasuk potensi duplikat baris master (di-dedup
 * di sini, replikasi behavioral bukan literal SQL).
 */
const getBrowseData = async (startDate, endDate, cabang, spkFilter) => {
  const hasSpkFilter = spkFilter && spkFilter.trim() !== "";

  let joinDtl = "";
  let filterSpk = "";
  const paramsMaster = [startDate, endDate];

  if (hasSpkFilter) {
    joinDtl = "LEFT JOIN tpodtf_dtl d ON d.pjd_nomor = h.pjh_nomor";
  }

  let filterCabang = "";
  if (cabang && cabang !== "ALL") {
    filterCabang = "AND h.pjh_cab = ?";
  }

  if (hasSpkFilter) {
    filterSpk = "AND d.pjd_spk LIKE ?";
  }

  const qMaster = `
    SELECT h.pjh_nomor AS Nomor, h.pjh_cab AS Cab, h.pjh_tanggal AS Tanggal,
      h.pjh_dateline AS Dateline, h.pjh_sup_kode AS KodeSup,
      s.Sup_nama AS Nama, s.Sup_alamat AS Alamat, h.pjh_ket AS Keterangan
    FROM tpodtf_hdr h
    LEFT JOIN tsupplier s ON s.Sup_kode = h.pjh_sup_kode
    ${joinDtl}
    WHERE h.pjh_tanggal >= ? AND h.pjh_tanggal <= ?
    ${filterCabang}
    ${filterSpk}
    ORDER BY h.pjh_tanggal
  `;
  if (cabang && cabang !== "ALL") paramsMaster.push(cabang);
  if (hasSpkFilter) paramsMaster.push(`%${spkFilter.trim()}%`);

  const [masterRows] = await db.query(qMaster, paramsMaster);

  const qDetail = `
    SELECT d.pjd_nomor AS Nomor, d.pjd_spk AS Spk, d.pjd_nama AS NamaSpk,
      d.pjd_ukuran AS Ukuran, d.pjd_bahan AS Bahan,
      d.pjd_qty AS JmlCetak, d.pjd_qtyl AS JmlLayout, d.pjd_ket AS Keterangan
    FROM tpodtf_dtl d
    ORDER BY d.pjd_nomor
  `;
  const [detailRows] = await db.query(qDetail);

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
 * Hapus PO DTF.
 * ⚠️ Replikasi persis: ADA pengecekan cabang (beda dari PO Paperprint
 * yang TIDAK ada sama sekali). "HO-"/kosong dianggap tidak terkunci.
 */
const deleteData = async (nomor, user) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [rows] = await conn.query(
      `SELECT pjh_nomor, pjh_cab FROM tpodtf_hdr WHERE pjh_nomor = ? FOR UPDATE`,
      [nomor],
    );
    if (rows.length === 0) throw new Error("Data tidak ditemukan.");

    const userCab = user.cabang || "";
    if (userCab !== "" && userCab !== "HO-" && rows[0].pjh_cab !== userCab) {
      throw new Error("Data tsb bukan cabang anda.");
    }

    await conn.query(`DELETE FROM tpodtf_hdr WHERE pjh_nomor = ?`, [nomor]);

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
 * Data cetak PO DTF — replikasi cetak() Delphi. Info perusahaan pakai
 * perush_kode="KP" (pola sama seperti print-print PO lain).
 * ⚠️ TIDAK ada Finishing di report ini (dikonfirmasi dari .fr3 & form).
 */
const getPrintData = async (nomor) => {
  const [[header]] = await db.query(
    `SELECT h.pjh_nomor, h.pjh_tanggal, h.pjh_dateline, h.pjh_ket, h.pjh_cab,
       h.pjh_sup_kode, s.sup_nama, s.sup_alamat,
       p.perush_nama, p.perush_alamat, p.perush_kota, p.perush_telp, p.perush_fax
     FROM tpodtf_hdr h
     LEFT JOIN tsupplier s ON s.sup_kode = h.pjh_sup_kode
     LEFT JOIN tperusahaan p ON p.perush_kode = "KP"
     WHERE h.pjh_nomor = ?`,
    [nomor],
  );
  if (!header) return null;

  const [detail] = await db.query(
    `SELECT pjd_spk AS spk, pjd_nama AS nama, pjd_ukuran AS ukuran,
       pjd_bahan AS bahan, pjd_qty AS jumlah, pjd_qtyl AS jmlLayout,
       pjd_ket AS ket, pjd_idgambar AS idgambar
     FROM tpodtf_dtl WHERE pjd_nomor = ?`,
    [nomor],
  );

  const details = detail.map((d) => ({
    ...d,
    uploadedImageUrl: d.idgambar
      ? `/images/${encodeURIComponent(`${nomor}${d.spk}${d.idgambar}`)}.jpg`
      : null,
  }));

  return { ...header, details };
};

module.exports = {
  resolveDefaultCabang,
  getBrowseData,
  deleteData,
  getPrintData,
};
