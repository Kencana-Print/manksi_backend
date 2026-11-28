const db = require("../../../config/database");
// [SESUAIKAN path] file tempat BAGIAN_PO_ASET_LIHAT diekspor (service PO Non Bahan)
const { BAGIAN_PO_ASET_LIHAT } = require("../../garmen/poNonBahanFormService");

// PO Bahan yang masuk laporan: 0/3 Bahan, 4 Lain-lain, 5 Spanduk.
// Greige (1) dan Celup (2) dikeluarkan: BPB Celup dibuat otomatis saat PO dibuat
// dan menempel ke nomor PO Greige, jadi tidak bisa dibandingkan dengan jalur biasa.
const JENIS_PO_BAHAN = [0, 3, 4, 5];
const FORMAT_TANGGAL = /^\d{4}-\d{2}-\d{2}$/;

const rapikan = (r) => ({
  ...r,
  Umur: Number(r.Umur) || 0,
  QtyPo: Number(r.QtyPo) || 0,
  QtyTerima: Number(r.QtyTerima) || 0,
  Sisa: Number(r.Sisa) || 0,
  Telat: Number(r.Telat) === 1,
});

// ── PO Bahan (tpo_hdr / tpo_dtl) ─────────────────────────────────────
// Qty PO dijumlah per (PO, kode); BPB tercatat per PO + kode, jadi
// dibandingkan di level yang sama (tanpa alokasi per baris).
const ambilBahan = async ({ startDate, endDate, supKode, like }) => {
  const where = ["h.po_jenis IN (?)", "IFNULL(h.po_close, 0) <> 1"];
  const params = [JENIS_PO_BAHAN];

  if (startDate) {
    where.push("h.po_tanggal >= ?");
    params.push(startDate);
  }
  if (endDate) {
    where.push("h.po_tanggal < DATE_ADD(?, INTERVAL 1 DAY)");
    params.push(endDate);
  }
  if (supKode) {
    where.push("(h.po_sup_kode = ? OR d.pod_sup_kode = ?)");
    params.push(supKode, supKode);
  }
  if (like) {
    where.push(
      "(h.po_nomor LIKE ? OR d.pod_bhn_kode LIKE ? OR b.bhn_name LIKE ?)",
    );
    params.push(like, like, like);
  }

  const [rows] = await db.query(
    `SELECT
       'BAHAN' AS Tipe,
       CASE h.po_jenis WHEN 4 THEN 'Rekap Belanja' WHEN 5 THEN 'Spanduk' ELSE 'Bahan' END AS Jenis,
       h.po_nomor AS Nomor,
       DATE_FORMAT(h.po_tanggal, '%Y-%m-%d') AS Tanggal,
       DATEDIFF(CURDATE(), h.po_tanggal) AS Umur,
       IFNULL(GROUP_CONCAT(DISTINCT s.sup_kode ORDER BY s.sup_kode SEPARATOR ', '), '') AS KodeSupplier,
       IFNULL(GROUP_CONCAT(DISTINCT s.sup_nama ORDER BY s.sup_nama SEPARATOR ', '), '') AS Supplier,
       d.pod_bhn_kode AS Kode,
       IFNULL(MAX(b.bhn_name), '') AS Nama,
       IFNULL(MAX(d.pod_bhn_satuan), '') AS Satuan,
       SUM(d.pod_jumlah) AS QtyPo,
       IFNULL(MAX(r.terima), 0) AS QtyTerima,
       SUM(d.pod_jumlah) - IFNULL(MAX(r.terima), 0) AS Sisa,
       '' AS Cabang,
       DATE_FORMAT(MAX(j.tgl), '%Y-%m-%d') AS TglJanji,
       IFNULL(MAX(j.tgl) < CURDATE(), 0) AS Telat
     FROM tpo_hdr h
     INNER JOIN tpo_dtl d
       ON d.pod_po_nomor = h.po_nomor AND d.pod_bhn_kode <> ''
     LEFT JOIN tbahan b ON b.bhn_kode = d.pod_bhn_kode
     LEFT JOIN tsupplier s
       ON s.sup_kode = IF(IFNULL(d.pod_sup_kode, '') <> '', d.pod_sup_kode, h.po_sup_kode)
     LEFT JOIN (
       SELECT bh.bpb_po_nomor AS po, bd.bpbd_bhn_kode AS kode,
              SUM(bd.bpbd_jumlah) AS terima
       FROM tbpb_hdr bh
       INNER JOIN tbpb_dtl bd ON bd.bpbd_bpb_nomor = bh.bpb_nomor
       WHERE IFNULL(bh.bpb_po_nomor, '') <> ''
       GROUP BY bh.bpb_po_nomor, bd.bpbd_bhn_kode
     ) r ON r.po = h.po_nomor AND r.kode = d.pod_bhn_kode
     LEFT JOIN (
       SELECT pod2_nomor, pod2_bhn_kode, MAX(pod2_tanggal) AS tgl
       FROM tpo_dtl2
       GROUP BY pod2_nomor, pod2_bhn_kode
     ) j ON j.pod2_nomor = h.po_nomor AND j.pod2_bhn_kode = d.pod_bhn_kode
     WHERE ${where.join(" AND ")}
     GROUP BY h.po_nomor, h.po_tanggal, h.po_jenis, d.pod_bhn_kode
     HAVING ROUND(SUM(d.pod_jumlah) - IFNULL(MAX(r.terima), 0), 4) > 0
     ORDER BY h.po_tanggal, h.po_nomor, d.pod_bhn_kode`,
    params,
  );
  return rows;
};

// ── PO Non Bahan (tgarmenpo_hdr / tgarmenpo_dtl) ─────────────────────
// Sama dengan hitungStatusPo di service PO Non Bahan: dihitung per KODE.
const ambilNonBahan = async ({
  startDate,
  endDate,
  supKode,
  like,
  bolehAset,
}) => {
  const where = ["IFNULL(h.po_status, '') NOT LIKE '%CLOSE%'"];
  const params = [];

  if (!bolehAset) where.push("h.po_jenis <> 'ASET'");
  if (startDate) {
    where.push("h.po_tanggal >= ?");
    params.push(startDate);
  }
  if (endDate) {
    where.push("h.po_tanggal < DATE_ADD(?, INTERVAL 1 DAY)");
    params.push(endDate);
  }
  if (supKode) {
    where.push("h.po_sup_kode = ?");
    params.push(supKode);
  }
  if (like) {
    where.push(
      "(h.po_nomor LIKE ? OR d.pod_brg_kode LIKE ? OR b.brg_nama LIKE ?)",
    );
    params.push(like, like, like);
  }

  const [rows] = await db.query(
    `SELECT
       'NON_BAHAN' AS Tipe,
       h.po_jenis AS Jenis,
       h.po_nomor AS Nomor,
       DATE_FORMAT(h.po_tanggal, '%Y-%m-%d') AS Tanggal,
       DATEDIFF(CURDATE(), h.po_tanggal) AS Umur,
       IFNULL(MAX(h.po_sup_kode), '') AS KodeSupplier,
       IFNULL(MAX(s.sup_nama), '') AS Supplier,
       d.pod_brg_kode AS Kode,
       IFNULL(MAX(IF(IFNULL(b.brg_note, '') = '', b.brg_nama,
                     CONCAT(b.brg_nama, ' - ', b.brg_note))), '') AS Nama,
       IFNULL(MAX(b.brg_satuan), '') AS Satuan,
       SUM(d.pod_jumlah) AS QtyPo,
       IFNULL(MAX(r.terima), 0) AS QtyTerima,
       SUM(d.pod_jumlah) - IFNULL(MAX(r.terima), 0) AS Sisa,
       IFNULL(MAX(h.po_kecab), '') AS Cabang,
       NULL AS TglJanji,
       0 AS Telat
     FROM tgarmenpo_hdr h
     INNER JOIN tgarmenpo_dtl d ON d.pod_nomor = h.po_nomor
     LEFT JOIN tgarmen_brg b ON b.brg_kode = d.pod_brg_kode
     LEFT JOIN tsupplier s ON s.sup_kode = h.po_sup_kode
     LEFT JOIN (
       SELECT bh.bpb_po_nomor AS po, bd.bpbd_brg_kode AS kode,
              SUM(bd.bpbd_jumlah) AS terima
       FROM tgarmenbpb_hdr bh
       INNER JOIN tgarmenbpb_dtl bd ON bd.bpbd_nomor = bh.bpb_nomor
       WHERE IFNULL(bh.bpb_po_nomor, '') <> ''
       GROUP BY bh.bpb_po_nomor, bd.bpbd_brg_kode
     ) r ON r.po = h.po_nomor AND r.kode = d.pod_brg_kode
     WHERE ${where.join(" AND ")}
     GROUP BY h.po_nomor, h.po_tanggal, h.po_jenis, d.pod_brg_kode
     HAVING ROUND(SUM(d.pod_jumlah) - IFNULL(MAX(r.terima), 0), 4) > 0
     ORDER BY h.po_tanggal, h.po_nomor, d.pod_brg_kode`,
    params,
  );
  return rows;
};

// ── Laporan PO Outstanding ───────────────────────────────────────────
// filter: { startDate, endDate, jenis: ALL|BAHAN|NON_BAHAN, supKode, search }
const getPoOutstanding = async (filter = {}, user = {}) => {
  const startDate = String(filter.startDate || "").trim();
  const endDate = String(filter.endDate || "").trim();
  if (startDate && !FORMAT_TANGGAL.test(startDate))
    throw new Error("Format tanggal awal harus YYYY-MM-DD.");
  if (endDate && !FORMAT_TANGGAL.test(endDate))
    throw new Error("Format tanggal akhir harus YYYY-MM-DD.");

  const jenis = String(filter.jenis || "ALL").toUpperCase();
  const search = String(filter.search || "").trim();

  const f = {
    startDate,
    endDate,
    supKode: String(filter.supKode || "").trim(),
    like: search ? `%${search}%` : "",
    // PO Aset hanya terlihat oleh bagian yang sama dengan browse PO Non Bahan
    bolehAset: BAGIAN_PO_ASET_LIHAT.includes(
      String(user?.bagian || "").toUpperCase(),
    ),
  };

  const [bahan, nonBahan] = await Promise.all([
    jenis === "NON_BAHAN" ? [] : ambilBahan(f),
    jenis === "BAHAN" ? [] : ambilNonBahan(f),
  ]);

  return [...bahan, ...nonBahan]
    .map(rapikan)
    .sort(
      (a, b) =>
        a.Tanggal.localeCompare(b.Tanggal) ||
        a.Nomor.localeCompare(b.Nomor) ||
        a.Kode.localeCompare(b.Kode),
    )
    .map((r, i) => ({ id: i + 1, ...r }));
};

module.exports = { getPoOutstanding };
