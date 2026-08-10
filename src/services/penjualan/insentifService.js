const db = require("../../config/database");

// ─────────────────────────────────────────────────────────
// GET BROWSE LIST — replikasi btnRefreshClick (ufrmBrowsePengajuanFee.pas)
// Master: tpengajuan_fee + tcustomer (identitas customer)
// Detail: tpengajuan_fee2 + piutang_debet + tinv_hdr (breakdown invoice
// dasar hitung fee/insentif)
// Filter murni fee_tanggal >= start AND <= end — TIDAK ada filter
// cabang, sama persis Delphi (tabel ini tidak scoped per cabang).
// ─────────────────────────────────────────────────────────
const getBrowseList = async (startDate, endDate) => {
  const params = [`${startDate} 00:00:00`, `${endDate} 23:59:59`];

  const [masterRows] = await db.query(
    `SELECT
       h.fee_nomor AS Nomor,
       h.fee_tanggal AS Tanggal,
       c.Cus_nama AS Cus_nama,
       c.Cus_alamat AS Cus_alamat,
       c.Cus_kota AS Cus_kota,
       h.user_create AS Created,
       IF(h.fee_tgl_realisasi IS NULL, "", "SUDAH") AS Realisasi,
       h.fee_tgl_realisasi AS TglRealisasi
     FROM tpengajuan_fee h
     LEFT JOIN tcustomer c ON c.Cus_kode = h.fee_cus_kode
     WHERE h.fee_tanggal >= ? AND h.fee_tanggal <= ?
     ORDER BY h.fee_nomor DESC`,
    params,
  );

  const [detailRows] = await db.query(
    `SELECT
       d.feed_nomor AS Nomor,
       d.feed_inv_nomor AS Invoice,
       j.INV_tanggal AS TglInvoice,
       j.inv_no_fp AS FakturPajak,
       p.debet AS Nominal,
       p.kredit AS Bayar,
       (p.debet - p.kredit) AS SisaPiutang,
       j.INV_Keterangan AS Keterangan
     FROM tpengajuan_fee h
     INNER JOIN tpengajuan_fee2 d ON d.feed_nomor = h.fee_nomor
     LEFT JOIN piutang_debet p ON p.nota = d.feed_inv_nomor
     LEFT JOIN tinv_hdr j ON j.INV_nomor = d.feed_inv_nomor
     WHERE h.fee_tanggal >= ? AND h.fee_tanggal <= ?
     ORDER BY d.feed_nomor`,
    params,
  );

  return masterRows.map((master) => ({
    ...master,
    detail: detailRows.filter((d) => d.Nomor === master.Nomor),
  }));
};

// ─────────────────────────────────────────────────────────
// DELETE — replikasi cxButton4Click.
// ⚠️ DEVIASI DARI DELPHI: source aslinya HANYA delete header
// (tpengajuan_fee), TIDAK PERNAH menghapus baris detail
// (tpengajuan_fee2) → detail jadi orphan permanen (pola bug sama
// dengan tinv_flag di Invoice Tak Normal). DIPERBAIKI: hapus
// header + detail dalam satu transaksi.
// Selain itu, TIDAK ada validasi apa pun sebelum hapus di Delphi
// (tidak cek tutup buku, tidak cek status Realisasi) — direplikasi
// apa adanya, tidak ditambah validasi baru yang tidak ada di source.
// ─────────────────────────────────────────────────────────
const deleteData = async (nomor) => {
  const [rows] = await db.query(
    `SELECT fee_nomor FROM tpengajuan_fee WHERE fee_nomor = ?`,
    [nomor],
  );
  if (rows.length === 0) throw new Error("Data tidak ditemukan.");

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(`DELETE FROM tpengajuan_fee2 WHERE feed_nomor = ?`, [
      nomor,
    ]);
    await conn.query(`DELETE FROM tpengajuan_fee WHERE fee_nomor = ?`, [nomor]);
    await conn.commit();
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
};

// ─────────────────────────────────────────────────────────
// REALISASI TRANSFER — replikasi btnSimpanClick.
// Set fee_tgl_realisasi. Delphi tidak validasi tanggal (selalu ada
// default Date() dari dtRealisasi.Date saat panel dibuka), TIDAK ada
// validasi tutup buku atau validasi lain. Direplikasi apa adanya.
// ─────────────────────────────────────────────────────────
const realisasiTransfer = async (nomor, tanggalRealisasi) => {
  if (!tanggalRealisasi) {
    throw new Error("Tanggal realisasi wajib diisi.");
  }
  const [rows] = await db.query(
    `SELECT fee_nomor FROM tpengajuan_fee WHERE fee_nomor = ?`,
    [nomor],
  );
  if (rows.length === 0) throw new Error("Data tidak ditemukan.");

  await db.query(
    `UPDATE tpengajuan_fee SET fee_tgl_realisasi = ? WHERE fee_nomor = ?`,
    [tanggalRealisasi, nomor],
  );
};

// ─────────────────────────────────────────────────────────
// GET CETAK DATA — replikasi PERSIS query cetak() Delphi
// (ufrmPengajuanFee.pas). Query ini BEDA dari getBrowseList: join
// ke tinv_dtl + tspk untuk breakdown fee PER ITEM SPK (bukan per
// invoice), filter spk_hargafee<>0 sebagai syarat wajib.
// ⚠️ ASUMSI: fee_bank/fee_norek/fee_atasnama adalah kolom header
// tpengajuan_fee (padanan edtbank/edtnorek/edtatasnama Delphi) —
// belum terverifikasi terhadap skema tabel sebenarnya, sesuaikan
// nama kolom kalau berbeda.
// ─────────────────────────────────────────────────────────
const getCetakData = async (nomor) => {
  const [headerRows] = await db.query(
    `SELECT h.fee_nomor AS Nomor, h.fee_tanggal AS Tanggal,
            c.Cus_nama AS CusNama,
            h.fee_bank AS Bank, h.fee_rekening AS NoRek, h.fee_atasnama AS AtasNama
     FROM tpengajuan_fee h
     LEFT JOIN tcustomer c ON c.Cus_kode = h.fee_cus_kode
     WHERE h.fee_nomor = ?`,
    [nomor],
  );
  if (headerRows.length === 0) throw new Error("Data tidak ditemukan.");

  // ⚠️ ORDER BY ditambahkan (Delphi tidak punya, urutan asli tidak
  // eksplisit) — supaya grouping "baris kedua dst kosong" di frontend
  // konsisten per-invoice, tidak acak.
  const [rows] = await db.query(
    `SELECT
       d.feed_inv_nomor AS Nomor,
       DATE_FORMAT(j.INV_tanggal, '%d-%m-%Y') AS Tanggal,
       IF(d.feed_invt_nomor <> '', u.INV_Keterangan, j.INV_Keterangan) AS Keterangan,
       ROUND(p.debet, 0) AS Total,
       IF(d.feed_invt_nomor <> '', u.inv_no_fp, j.inv_no_fp) AS FakturPajak,
       IF(d.feed_invt_nomor <> '', ROUND(t.kredit, 0), ROUND(p.kredit, 0)) AS Bayar,
       (SELECT DATE_FORMAT(a.tanggal, '%d-%m-%Y')
        FROM terima_bayar_debet a
        INNER JOIN piutang_kredit_detail b ON b.no_bukti = a.nomor
        WHERE b.nota = IF(d.feed_invt_nomor <> '', d.feed_invt_nomor, d.feed_inv_nomor)
        ORDER BY a.tanggal DESC LIMIT 1) AS TanggalBayar,
       i.INVD_Spk_Nomor AS Kode,
       s.spk_nama AS Nama,
       i.INVD_Jumlah AS Jumlah,
       i.INVD_Harga AS Harga,
       s.spk_hargariil AS HargaRiil,
       s.spk_hargafee AS Fee,
       (i.INVD_Jumlah * s.spk_hargafee) AS TotalFee
     FROM tpengajuan_fee h
     LEFT JOIN tpengajuan_fee2 d ON d.feed_nomor = h.fee_nomor
     LEFT JOIN piutang_debet p ON p.nota = d.feed_inv_nomor
     LEFT JOIN piutang_debet t ON t.nota = d.feed_invt_nomor
     LEFT JOIN tinv_hdr u ON u.INV_nomor = d.feed_invt_nomor
     LEFT JOIN tinv_hdr j ON j.INV_nomor = d.feed_inv_nomor
     LEFT JOIN tinv_dtl i ON i.INVD_inv_nomor = j.INV_nomor
     LEFT JOIN tcustomer c ON c.Cus_kode = h.fee_cus_kode
     INNER JOIN tspk s ON s.spk_nomor = i.INVD_Spk_Nomor
     WHERE s.spk_hargafee <> 0 AND h.fee_nomor = ?
     ORDER BY d.feed_inv_nomor`,
    [nomor],
  );

  return { header: headerRows[0], rows };
};

module.exports = {
  getBrowseList,
  deleteData,
  realisasiTransfer,
  getCetakData,
};
