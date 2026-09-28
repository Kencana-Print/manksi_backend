const db = require("../../../config/database");

// ── Master: Daftar Seluruh Jenis BPB / Nota Hutang ─────────────────────
const getBrowse = async (startDate, endDate) => {
  const [rows] = await db.query(
    `SELECT 
        x.Nomor,
        x.Tipe,
        x.Tanggal,
        x.JatuhTempo,
        x.SupKode,
        x.Nama,
        x.Total,
        IFNULL(v.TotalVoucher, 0) AS Voucher,
        IFNULL(b.TotalBayar, 0) AS Bayar
     FROM (
        -- 1. PBG (BPB dari PO)
        SELECT 
          h.bpb_nomor AS Nomor,
          'PBG' AS Tipe,
          DATE_FORMAT(h.bpb_tanggal, '%Y-%m-%d') AS Tanggal,
          DATE_FORMAT(h.bpb_jatuhtempo, '%Y-%m-%d') AS JatuhTempo,
          h.bpb_sup_kode AS SupKode,
          s.sup_nama AS Nama,
          ROUND(SUM((d.bpbd_harga * (100 - d.bpbd_disc) / 100) * d.bpbd_jumlah * IF(p.po_status_ppn = 1, (100 + p.po_ppn) / 100, 1)), 2) AS Total
        FROM .tbpb_hdr h
        INNER JOIN .tbpb_dtl d ON d.bpbd_bpb_nomor = h.bpb_nomor
        INNER JOIN .tpo_hdr p ON p.po_nomor = h.bpb_po_nomor
        INNER JOIN .tsupplier s ON s.sup_kode = h.bpb_sup_kode
        WHERE h.bpb_tanggal >= ? AND h.bpb_tanggal <= ?
        GROUP BY h.bpb_nomor

        UNION ALL

        -- 2. BJG (BPJ dari PO Jasa)
        SELECT 
          h.bpj_nomor AS Nomor,
          'BJG' AS Tipe,
          DATE_FORMAT(h.bpj_tanggal, '%Y-%m-%d') AS Tanggal,
          DATE_FORMAT(h.bpj_tanggal, '%Y-%m-%d') AS JatuhTempo, -- Default hari h
          h.bpj_sup_kode AS SupKode,
          s.sup_nama AS Nama,
          ROUND(p.pojh_tarif * h.bpj_jumlah * IF(p.pojh_status_ppn = 1, ((100 + p.pojh_ppn) / 100), 1), 2) AS Total
        FROM .tbpj_hdr h
        INNER JOIN .tpojasa_hdr p ON p.pojh_nomor = h.bpj_po_nomor
        INNER JOIN .tsupplier s ON s.sup_kode = h.bpj_sup_kode
        WHERE h.bpj_tanggal >= ? AND h.bpj_tanggal <= ?
        GROUP BY h.bpj_nomor

        UNION ALL

        -- 3. RTG (Retur Pembelian)
        SELECT 
          h.ret_nomor AS Nomor,
          'RTG' AS Tipe,
          DATE_FORMAT(h.ret_tanggal, '%Y-%m-%d') AS Tanggal,
          DATE_FORMAT(h.ret_tanggal, '%Y-%m-%d') AS JatuhTempo,
          h.ret_sup_kode AS SupKode,
          s.sup_nama AS Nama,
          ROUND(SUM(d.retd_harga * d.retd_jumlah * IF(h.ret_sts_ppn = 1, ((100 + h.ret_ppn) / 100), 1)), 2) AS Total
        FROM .tret_hdr h
        INNER JOIN .tret_dtl d ON d.retd_ret_nomor = h.ret_nomor
        INNER JOIN .tsupplier s ON s.sup_kode = h.ret_sup_kode
        WHERE h.ret_tanggal >= ? AND h.ret_tanggal <= ?
        GROUP BY h.ret_nomor

        UNION ALL

        -- 4. PJG (Potongan Jasa)
        SELECT 
          h.pojh_nomor AS Nomor,
          'PJG' AS Tipe,
          DATE_FORMAT(h.pojh_tanggal, '%Y-%m-%d') AS Tanggal,
          DATE_FORMAT(h.pojh_tanggal, '%Y-%m-%d') AS JatuhTempo,
          h.pojh_sup_kode AS SupKode,
          s.sup_nama AS Nama,
          ROUND(SUM(d.pojd_harga * d.pojd_jumlah), 2) AS Total
        FROM tpojasa_hdr h
        INNER JOIN tpojasa_dtl d ON d.pojd_pojh_nomor = h.pojh_nomor
        INNER JOIN tsupplier s ON s.sup_kode = h.pojh_sup_kode
        WHERE h.pojh_tanggal >= ? AND h.pojh_tanggal <= ?
        GROUP BY h.pojh_nomor

        UNION ALL

        -- 5. POE (PO External)
        SELECT 
          h.poe_nomor AS Nomor,
          'POE' AS Tipe,
          DATE_FORMAT(h.poe_tanggal, '%Y-%m-%d') AS Tanggal,
          DATE_FORMAT(h.poe_tanggal, '%Y-%m-%d') AS JatuhTempo,
          h.poe_sup AS SupKode,
          s.sup_nama AS Nama,
          ROUND((h.poe_total - IFNULL((SELECT SUM(c.poed2_nominal) FROM tpoexternal_dtl2 c WHERE c.poed2_nomor = h.poe_nomor), 0)), 2) AS Total
        FROM tpoexternal_hdr h
        INNER JOIN tsupplier s ON s.sup_kode = h.poe_sup
        WHERE h.poe_tanggal >= ? AND h.poe_tanggal <= ?
        GROUP BY h.poe_nomor

        UNION ALL

        -- 6. MMT (Penerimaan Mutasi)
        SELECT 
          h.rec_nomor AS Nomor,
          'MMT' AS Tipe,
          DATE_FORMAT(h.rec_tanggal, '%Y-%m-%d') AS Tanggal,
          DATE_FORMAT(h.rec_tanggal, '%Y-%m-%d') AS JatuhTempo,
          h.rec_sup_kode AS SupKode,
          s.sup_nama AS Nama,
          ROUND(IFNULL((SELECT SUM(IF(d.recd_harga < 200000, d.recd_harga * d.recd_qty_terima, d.recd_harga)) FROM .trec_mmt_dtl d WHERE d.recd_rec_nomor = h.rec_nomor), 0), 2) AS Total
        FROM trec_mmt_hdr h
        INNER JOIN tsupplier s ON s.sup_kode = h.rec_sup_kode
        WHERE h.rec_tanggal >= ? AND h.rec_tanggal <= ?
        GROUP BY h.rec_nomor

        UNION ALL

        -- 7. BPE (BPB PO External)
        SELECT 
          h.bpe_nomor AS Nomor,
          'BPE' AS Tipe,
          DATE_FORMAT(h.bpe_tanggal, '%Y-%m-%d') AS Tanggal,
          DATE_FORMAT(h.bpe_tanggal, '%Y-%m-%d') AS JatuhTempo,
          h.bpe_sup AS SupKode,
          s.sup_nama AS Nama,
          ROUND(IFNULL(poe.poe_total, 0), 2) AS Total
        FROM tbpbpoexternal_hdr h
        INNER JOIN tsupplier s ON s.sup_kode = h.bpe_sup
        LEFT JOIN tpoexternal_hdr poe ON poe.poe_nomor = h.bpe_po
        WHERE h.bpe_tanggal >= ? AND h.bpe_tanggal <= ?
        GROUP BY h.bpe_nomor

        UNION ALL

        -- 8. BPG (Garmen BPB)
        SELECT 
          h.bpb_nomor AS Nomor,
          'BPG' AS Tipe,
          DATE_FORMAT(h.bpb_tanggal, '%Y-%m-%d') AS Tanggal,
          DATE_FORMAT(h.bpb_tanggal, '%Y-%m-%d') AS JatuhTempo,
          h.bpb_sup_kode AS SupKode,
          s.sup_nama AS Nama,
          ROUND(IFNULL((SELECT SUM(d.bpbd_jumlah * d.bpbd_harga) FROM .tgarmenbpb_dtl d WHERE d.bpbd_nomor = h.bpb_nomor), 0), 2) AS Total
        FROM tgarmenbpb_hdr h
        INNER JOIN .tsupplier s ON s.sup_kode = h.bpb_sup_kode
        WHERE h.bpb_tanggal >= ? AND h.bpb_tanggal <= ?
        GROUP BY h.bpb_nomor
     ) x
     LEFT JOIN (
        -- Hitung total pembentukan voucher berdasarkan nota
        SELECT voud_nota, SUM(voud_total) AS TotalVoucher 
        FROM tvoucher_dtl 
        GROUP BY voud_nota
     ) v ON v.voud_nota = x.Nomor
     LEFT JOIN (
        -- Hitung total realisasi pembayaran kas/bank dari voucher terkait
        SELECT vd.voud_nota, SUM(bd.nilai) AS TotalBayar
        FROM bayar_debet_detail bd
        INNER JOIN tvoucher_dtl vd ON vd.voud_vou_nomor = bd.vou_nomor
        GROUP BY vd.voud_nota
     ) b ON b.voud_nota = x.Nomor
     ORDER BY x.Tanggal ASC, x.Nomor ASC`,
    [
      startDate,
      endDate, // PBG
      startDate,
      endDate, // BJG
      startDate,
      endDate, // RTG
      startDate,
      endDate, // PJG
      startDate,
      endDate, // POE
      startDate,
      endDate, // MMT
      startDate,
      endDate, // BPE
      startDate,
      endDate, // BPG
    ],
  );
  return rows;
};

// ── Detail: Sub-grid seluruh Voucher terkait data di atas ────────────────
const getDetail = async (startDate, endDate) => {
  const [rows] = await db.query(
    `SELECT
       vd.voud_nota AS Nomor,
       vh.vou_nomor AS NomorVoucher,
       DATE_FORMAT(vh.vou_tanggal, '%Y-%m-%d') AS TanggalVoucher,
       vd.voud_total AS Total,
       vh.vou_status_realisasi AS StatusRealisasi
     FROM tvoucher_hdr vh
     INNER JOIN .tvoucher_dtl vd ON vd.voud_vou_nomor = vh.vou_nomor
     WHERE vd.voud_nota IN (
       -- Ambil daftar semua nomor transaksi dalam rentang tanggal terkait
       SELECT bpb_nomor FROM tbpb_hdr WHERE bpb_tanggal >= ? AND bpb_tanggal <= ?
       UNION
       SELECT bpj_nomor FROM tbpj_hdr WHERE bpj_tanggal >= ? AND bpj_tanggal <= ?
       UNION
       SELECT ret_nomor FROM tret_hdr WHERE ret_tanggal >= ? AND ret_tanggal <= ?
       UNION
       SELECT pojh_nomor FROM tpojasa_hdr WHERE pojh_tanggal >= ? AND pojh_tanggal <= ?
       UNION
       SELECT poe_nomor FROM tpoexternal_hdr WHERE poe_tanggal >= ? AND poe_tanggal <= ?
       UNION
       SELECT rec_nomor FROM trec_mmt_hdr WHERE rec_tanggal >= ? AND rec_tanggal <= ?
       UNION
       SELECT bpe_nomor FROM tbpbpoexternal_hdr WHERE bpe_tanggal >= ? AND bpe_tanggal <= ?
       UNION
       SELECT bpb_nomor FROM tgarmenbpb_hdr WHERE bpb_tanggal >= ? AND bpb_tanggal <= ?
     )
     ORDER BY vd.voud_nota ASC, vh.vou_tanggal ASC`,
    [
      startDate,
      endDate, // tbpb_hdr
      startDate,
      endDate, // tbpj_hdr
      startDate,
      endDate, // tret_hdr
      startDate,
      endDate, // tpojasa_hdr
      startDate,
      endDate, // tpoexternal_hdr
      startDate,
      endDate, // trec_mmt_hdr
      startDate,
      endDate, // tbpbpoexternal_hdr
      startDate,
      endDate, // tgarmenbpb_hdr
    ],
  );
  return rows;
};

module.exports = { getBrowse, getDetail };
