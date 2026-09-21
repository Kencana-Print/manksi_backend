// Hitung ulang status Maklon dari kondisi data aktual (bukan disimpan
// manual di titik aksi) — supaya status selalu konsisten walau ada
// aksi susulan/dibatalkan di titik mana pun. Dipanggil dalam transaksi
// yang sama (pakai conn) setiap kali ada perubahan di: SJ Keluar,
// LHK (tdtf_maklon), SJ Hasil Maklon, atau Terima Hasil Maklon.
const recomputeStatus = async (conn, mklNomor) => {
  const [dtlRows] = await conn.query(
    `SELECT mkld_qty_kirim, mkld_qty_sudah_kirim, mkld_qty_terima, mkld_qty_bs
     FROM tmaklon_dtl WHERE mkld_mkl_nomor = ?`,
    [mklNomor],
  );
  if (!dtlRows.length) return;

  const totalRows = dtlRows.length;
  const sentFullCount = dtlRows.filter(
    (r) => Number(r.mkld_qty_sudah_kirim) >= Number(r.mkld_qty_kirim),
  ).length;
  const sentAnyCount = dtlRows.filter(
    (r) => Number(r.mkld_qty_sudah_kirim) > 0,
  ).length;
  const receivedFullCount = dtlRows.filter(
    (r) =>
      Number(r.mkld_qty_terima) + Number(r.mkld_qty_bs) >=
      Number(r.mkld_qty_kirim),
  ).length;
  const receivedAnyCount = dtlRows.filter(
    (r) => Number(r.mkld_qty_terima) + Number(r.mkld_qty_bs) > 0,
  ).length;

  const [[dtfRow]] = await conn.query(
    `SELECT COUNT(DISTINCT kode_polos) AS cnt FROM tdtf_maklon
     WHERE mkl_nomor = ? AND kode_hasil IS NOT NULL AND kode_hasil <> ''`,
    [mklNomor],
  );
  const dtfDoneCount = Number(dtfRow.cnt);

  const [[sjRow]] = await conn.query(
    `SELECT COUNT(*) AS cnt FROM tsj_maklon_hdr WHERE sjm_mkl_nomor = ?`,
    [mklNomor],
  );
  const sjExists = Number(sjRow.cnt) > 0;

  let status;
  if (receivedFullCount === totalRows) status = "SELESAI";
  else if (receivedAnyCount > 0) status = "DITERIMA SEBAGIAN";
  else if (sjExists) status = "OTW GUDANG";
  else if (dtfDoneCount >= totalRows) status = "SELESAI DTF";
  else if (sentFullCount === totalRows) status = "DIKIRIM";
  else if (sentAnyCount > 0) status = "SEBAGIAN DIKIRIM";
  else status = "DRAFT";

  await conn.query(
    `UPDATE tmaklon_hdr SET
       mkl_status = ?,
       mkl_tgl_kirim = IF(mkl_tgl_kirim IS NULL AND ? >= 1, NOW(), mkl_tgl_kirim),
       mkl_tgl_selesai_dtf = IF(mkl_tgl_selesai_dtf IS NULL AND ? >= ?, NOW(), mkl_tgl_selesai_dtf),
       mkl_tgl_otw_gudang = IF(mkl_tgl_otw_gudang IS NULL AND ?, NOW(), mkl_tgl_otw_gudang),
       mkl_tgl_selesai = IF(mkl_tgl_selesai IS NULL AND ? = ?, NOW(), mkl_tgl_selesai)
     WHERE mkl_nomor = ?`,
    [
      status,
      sentFullCount,
      dtfDoneCount,
      totalRows,
      sjExists ? 1 : 0,
      receivedFullCount,
      totalRows,
      mklNomor,
    ],
  );

  return status;
};

module.exports = { recomputeStatus };
