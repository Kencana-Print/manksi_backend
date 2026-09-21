const db = require("../../../config/database");

/**
 * Monitoring Status & Stock Transaksi Maklon — 1 baris per rencana
 * Barang Jadi (tmaklon_dtl_jadi), dengan realisasi produksi (Qty
 * Hasil/BS/No. LHK) di-JOIN dari tdtf_maklon kalau sudah ada LHK
 * yang match (mkl_nomor + kode_polos + kode_hasil sama persis —
 * bukan FK, karena kode hasil di LHK memang sengaja tidak dikunci
 * ke rencana). Kalau rencana ini belum diproses sama sekali,
 * Qty Hasil/BS/No.LHK tampil kosong (belum ada realisasi).
 */
const getBrowse = async ({
  startDate,
  endDate,
  cabAsal,
  cabTujuan,
  itemAwal,
  itemJadi,
  status,
  userInput,
}) => {
  const params = [startDate, endDate];
  let where = ` WHERE h.mkl_tanggal BETWEEN ? AND ? `;

  if (cabAsal && cabAsal !== "ALL") {
    where += ` AND h.mkl_cab_asal = ? `;
    params.push(cabAsal);
  }
  if (cabTujuan && cabTujuan !== "ALL") {
    where += ` AND h.mkl_cab_tujuan = ? `;
    params.push(cabTujuan);
  }
  if (itemAwal) {
    where += ` AND (d.mkld_kode_polos LIKE ? OR bp.brg_nama LIKE ?) `;
    params.push(`%${itemAwal}%`, `%${itemAwal}%`);
  }
  if (itemJadi) {
    where += ` AND (j.mkldj_kode_jadi LIKE ? OR bj.brg_nama LIKE ?) `;
    params.push(`%${itemJadi}%`, `%${itemJadi}%`);
  }
  if (status && status !== "ALL") {
    where += ` AND h.mkl_status = ? `;
    params.push(status);
  }
  if (userInput) {
    where += ` AND h.mkl_user_create LIKE ? `;
    params.push(`%${userInput}%`);
  }

  const sql = `
    SELECT
      h.mkl_nomor AS NoMaklon,
      h.mkl_tanggal AS Tanggal,
      h.mkl_cab_asal AS CabAsalKode,
      ga.pab_nama AS GudangAsal,
      h.mkl_cab_tujuan AS CabTujuanKode,
      gt.pab_nama AS GudangTujuan,
      d.mkld_kode_polos AS ItemAwalKode,
      bp.brg_nama AS ItemAwalNama,
      d.mkld_qty_kirim AS QtyKirim,
      d.mkld_satuan_kirim AS SatuanKirim,
      j.mkldj_kode_jadi AS ItemJadiKode,
      bj.brg_nama AS ItemJadiNama,
      j.mkldj_estimasi_qty AS EstimasiQty,
      j.mkldj_dateline AS Dateline,
      dm.qty_hasil AS QtyHasil,
      dm.bs_afval AS Bs,
      dm.lhk_nomor AS NoLhk,
      h.mkl_status AS Status,
      h.mkl_user_create AS UserInput
    FROM tmaklon_hdr h
    INNER JOIN tmaklon_dtl d ON d.mkld_mkl_nomor = h.mkl_nomor
    INNER JOIN tmaklon_dtl_jadi j ON j.mkldj_mkld_id = d.mkld_id
    LEFT JOIN tgarmen_brg bp ON bp.brg_kode = d.mkld_kode_polos
    LEFT JOIN tgarmen_brg bj ON bj.brg_kode = j.mkldj_kode_jadi
    LEFT JOIN tpabrik ga ON ga.pab_kode = h.mkl_cab_asal
    LEFT JOIN tpabrik gt ON gt.pab_kode = h.mkl_cab_tujuan
    LEFT JOIN tdtf_maklon dm
      ON dm.mkl_nomor = h.mkl_nomor
      AND dm.kode_polos = d.mkld_kode_polos
      AND dm.kode_hasil = j.mkldj_kode_jadi
    ${where}
    ORDER BY h.mkl_tanggal DESC, h.mkl_nomor DESC, d.mkld_id, j.mkldj_id
  `;

  const [rows] = await db.query(sql, params);

  return rows.map((r) => ({
    ...r,
    QtyKirim: Number(r.QtyKirim) || 0,
    EstimasiQty: Number(r.EstimasiQty) || 0,
    QtyHasil: r.QtyHasil != null ? Number(r.QtyHasil) : null,
    Bs: r.Bs != null ? Number(r.Bs) : null,
  }));
};

/**
 * Daftar Cabang untuk dropdown filter Gudang Asal/Tujuan — sumber
 * sama dengan module Maklon Barang (tpabrik, subset P01/P02/P04/P05).
 */
const getCabangOptions = async () => {
  const [rows] = await db.query(
    `SELECT pab_kode AS Kode, pab_nama AS Nama
     FROM tpabrik WHERE pab_kode IN ('P01','P02','P04','P05')
     ORDER BY pab_kode`,
  );
  return rows;
};

module.exports = { getBrowse, getCabangOptions };
