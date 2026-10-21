const db = require("../../config/database");
const { kategoriDari, urutanKategori } = require("./rekapKategori");

const buildWhere = (startDate, endDate) => {
  const where = [];
  const params = [];
  if (startDate) {
    where.push("h.rkb_tanggal >= ?");
    params.push(startDate);
  }
  if (endDate) {
    where.push("h.rkb_tanggal <= ?");
    params.push(endDate);
  }
  return {
    sql: where.length ? `WHERE ${where.join(" AND ")}` : "",
    params,
  };
};

const getBrowse = async (startDate, endDate) => {
  const { sql, params } = buildWhere(startDate, endDate);
  const [rows] = await db.query(
    `SELECT h.rkb_nomor AS nomor,
            DATE_FORMAT(h.rkb_tanggal, '%Y-%m-%d') AS tanggal,
            IFNULL(d.sup, 0) AS jumlahSupplier,
            IFNULL(d.jml, 0) AS jumlahTransaksi,
            IFNULL(d.total, 0) AS totalNominal,
            h.rkb_status AS status,
            h.rkb_keterangan AS keterangan,
            h.rkb_alasan_batal AS alasanBatal,
            h.user_create AS userCreate
     FROM trekap_bayar_hdr h
     LEFT JOIN (
       SELECT rkbd_nomor,
              SUM(rkbd_nominal) AS total,
              COUNT(*) AS jml,
              COUNT(DISTINCT rkbd_sup_kode) AS sup
       FROM trekap_bayar_dtl
       GROUP BY rkbd_nomor
     ) d ON d.rkbd_nomor = h.rkb_nomor
     ${sql}
     ORDER BY h.rkb_tanggal DESC, h.rkb_nomor DESC`,
    params,
  );
  return rows;
};

const getBrowseDetail = async (startDate, endDate) => {
  const { sql, params } = buildWhere(startDate, endDate);
  const [rows] = await db.query(
    `SELECT h.rkb_nomor AS nomor,
            DATE_FORMAT(h.rkb_tanggal, '%Y-%m-%d') AS tanggal,
            h.rkb_status AS status,
            d.rkbd_nourut AS noUrut,
            d.rkbd_sup_kode AS kodeSupplier,
            IFNULL(s.sup_nama, '') AS namaSupplier,
            d.rkbd_bulan_tagihan AS bulanTagihan,
            d.rkbd_tipe AS tipe,
            d.rkbd_nota AS nota,
            DATE_FORMAT(d.rkbd_tgl_nota, '%Y-%m-%d') AS tglNota,
            d.rkbd_nilai_nota AS nilaiNota,
            d.rkbd_nominal AS nominal,
            DATE_FORMAT(d.rkbd_tgl_rencana, '%Y-%m-%d') AS tglRencana,
            d.rkbd_faktur_pajak AS fakturPajak,
            d.rkbd_invoice AS invoice,
            d.rkbd_keterangan AS keterangan,
            IFNULL(d.rkbd_vou_nomor, '') AS vouNomor
     FROM trekap_bayar_hdr h
     INNER JOIN trekap_bayar_dtl d ON d.rkbd_nomor = h.rkb_nomor
     LEFT JOIN tsupplier s ON s.sup_kode = d.rkbd_sup_kode
     ${sql}
     ORDER BY h.rkb_tanggal DESC, h.rkb_nomor DESC, d.rkbd_nourut`,
    params,
  );
  return rows.map((r) => ({
    ...r,
    kategori: kategoriDari(r.tipe),
    kategoriUrut: urutanKategori(r.tipe),
  }));
};

const batalData = async (nomor, alasan, userKode) => {
  const alasanBersih = String(alasan || "").trim();
  if (!alasanBersih) {
    throw new Error("Alasan batal wajib diisi.");
  }
  const [[hdr]] = await db.query(
    `SELECT rkb_status FROM trekap_bayar_hdr WHERE rkb_nomor = ?`,
    [nomor],
  );
  if (!hdr) {
    throw new Error("Rekap pembayaran tidak ditemukan.");
  }
  if (hdr.rkb_status !== "AKTIF") {
    throw new Error("Rekap pembayaran sudah dibatalkan.");
  }
  const [[pakai]] = await db.query(
    `SELECT COUNT(*) AS n FROM trekap_bayar_dtl
     WHERE rkbd_nomor = ? AND rkbd_vou_nomor <> ''`,
    [nomor],
  );
  if (Number(pakai.n) > 0) {
    throw new Error(
      "Rekap ini sudah dipakai di Voucher Pembayaran. Hapus voucher terkait dahulu.",
    );
  }
  const [result] = await db.query(
    `UPDATE trekap_bayar_hdr
     SET rkb_status = 'BATAL',
         rkb_alasan_batal = ?,
         user_modified = ?,
         date_modified = NOW()
     WHERE rkb_nomor = ? AND rkb_status = 'AKTIF'`,
    [alasanBersih.slice(0, 200), userKode, nomor],
  );
  if (result.affectedRows === 0) {
    throw new Error("Rekap pembayaran gagal dibatalkan, silakan muat ulang.");
  }
};

const deleteData = async (nomor) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [[hdr]] = await conn.query(
      `SELECT rkb_status FROM trekap_bayar_hdr WHERE rkb_nomor = ? FOR UPDATE`,
      [nomor],
    );
    if (!hdr) {
      throw new Error("Rekap pembayaran tidak ditemukan.");
    }
    if (hdr.rkb_status !== "AKTIF") {
      throw new Error("Rekap yang sudah dibatalkan tidak dapat dihapus.");
    }
    const [[pakai]] = await conn.query(
      `SELECT COUNT(*) AS n FROM trekap_bayar_dtl
       WHERE rkbd_nomor = ? AND rkbd_vou_nomor <> ''`,
      [nomor],
    );
    if (Number(pakai.n) > 0) {
      throw new Error(
        "Rekap ini sudah dipakai di Voucher Pembayaran. Hapus voucher terkait dahulu.",
      );
    }
    await conn.query(`DELETE FROM trekap_bayar_dtl WHERE rkbd_nomor = ?`, [
      nomor,
    ]);
    await conn.query(`DELETE FROM trekap_bayar_hdr WHERE rkb_nomor = ?`, [
      nomor,
    ]);
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
};

module.exports = { getBrowse, getBrowseDetail, batalData, deleteData };
