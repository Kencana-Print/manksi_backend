const db = require("../../../config/database");

// ── PO Lain-lain via Uang Muka. Satu baris PUM = satu baris PO.
// Aktual = hasil Penyelesaian (tkasbonitem terverifikasi). Selama belum
// diverifikasi, dipakai nominal sumber (nilai baris PO).
const SQL_PUM_PO_DASAR = `
  FROM tpengajuan_uang_muka_dtl d
  INNER JOIN tpengajuan_uang_muka_hdr ph ON ph.pum_nomor = d.pumd_pum_nomor
  INNER JOIN tpo_dtl pd
    ON pd.pod_po_Nomor = d.pumd_nomor_sumber AND pd.pod_nourut = d.pumd_item_nourut
  LEFT JOIN (
    SELECT bond_ref_nomor, bond_ref_nourut, 1 AS Ada,
           SUM(bond_qty_realisasi * bond_nominal_realisasi) AS Aktual
    FROM finance.tkasbonitem
    WHERE bond_ref_tipe = 'PO_LAIN_LAIN' AND bond_verified <> 0
    GROUP BY bond_ref_nomor, bond_ref_nourut
  ) a ON a.bond_ref_nomor = d.pumd_nomor_sumber
     AND a.bond_ref_nourut = d.pumd_item_nourut
  WHERE d.pumd_sumber = 'PO_LAIN_LAIN'
    AND (ph.pum_status = 'DIAJUKAN'
         OR (ph.pum_status = 'REALISASI' AND d.pumd_status_acc = 'ACC'))`;

// ── PO Lain-lain: BPB dibayar lewat Pengajuan Transfer, bukan Voucher.
// Voucher = total pengajuan (belum batal), Bayar = yang sudah direalisasi
// (ptd_jur_no terisi). Pengajuan tercatat per (PO, supplier) sedangkan BPB
// bisa lebih dari satu, jadi dialokasikan ke BPB tertua dulu.
// BPB di luar rentang tanggal tetap diambil (untuk alokasi), lalu dibuang.
const getHutangPoLainLain = async (startDate, endDate) => {
  const [bpb] = await db.query(
    `SELECT h.bpb_nomor AS Nomor,
        'PBG' AS Tipe,
        DATE_FORMAT(h.bpb_tanggal, '%Y-%m-%d') AS Tanggal,
        DATE_FORMAT(h.bpb_jatuhtempo, '%Y-%m-%d') AS JatuhTempo,
        h.bpb_sup_kode AS SupKode,
        s.sup_nama AS Nama,
        h.bpb_po_nomor AS PoNomor,
        (h.bpb_tanggal >= ? AND h.bpb_tanggal <= ?) AS DalamRentang,
        ROUND(SUM((d.bpbd_harga * (100 - d.bpbd_disc) / 100) * d.bpbd_jumlah * IF(p.po_status_ppn = 1, (100 + p.po_ppn) / 100, 1)), 2) AS Total
     FROM tbpb_hdr h
     INNER JOIN tbpb_dtl d ON d.bpbd_bpb_nomor = h.bpb_nomor
     INNER JOIN tpo_hdr p ON p.po_nomor = h.bpb_po_nomor
     INNER JOIN tsupplier s ON s.sup_kode = h.bpb_sup_kode
     WHERE p.po_jenis = 4
       AND h.bpb_po_nomor IN (
         SELECT bpb_po_nomor FROM tbpb_hdr
         WHERE bpb_tanggal >= ? AND bpb_tanggal <= ?
       )
     GROUP BY h.bpb_nomor, h.bpb_tanggal, h.bpb_jatuhtempo,
              h.bpb_sup_kode, s.sup_nama, h.bpb_po_nomor
     ORDER BY h.bpb_tanggal ASC, h.bpb_nomor ASC`,
    [startDate, endDate, startDate, endDate],
  );
  if (!bpb.length) return [];

  const daftarPo = [...new Set(bpb.map((r) => r.PoNomor))];
  const [pengajuan] = await db.query(
    `SELECT ptd_trs AS PoNomor, ptd_sup_kode AS SupKode,
        SUM(ptd_nominal) AS Diajukan,
        SUM(IF(ptd_jur_no <> '', ptd_nominal, 0)) AS Terealisasi
     FROM finance.tpengajuan_transfer_dtl
     WHERE ptd_batal = '' AND ptd_trs IN (?)
     GROUP BY ptd_trs, ptd_sup_kode`,
    [daftarPo],
  );

  // Voucher Pembayaran tipe POL: Diajukan = nilai baris POL, Terealisasi =
  // bila voucher tsb sudah punya pengajuan transfer yang terealisasi
  // (realisasi per voucher utuh, sama seperti nota lain)
  const [vouPol] = await db.query(
    `SELECT v.voud_nota AS PoNomor, vh.vou_sup_kode AS SupKode,
        SUM(v.voud_total) AS Diajukan,
        SUM(IF(EXISTS (
          SELECT 1 FROM finance.tpengajuan_transfer_dtl t
          WHERE t.ptd_trs = v.voud_vou_nomor
            AND t.ptd_batal = '' AND t.ptd_jur_no <> ''
        ), v.voud_total, 0)) AS Terealisasi
     FROM tvoucher_dtl v
     INNER JOIN tvoucher_hdr vh ON vh.vou_nomor = v.voud_vou_nomor
     WHERE v.voud_type = 'POL' AND v.voud_nota IN (?)
     GROUP BY v.voud_nota, vh.vou_sup_kode`,
    [daftarPo],
  );

  const [pum] = await db.query(
    `SELECT d.pumd_nomor_sumber AS PoNomor, pd.pod_sup_kode AS SupKode,
        SUM(IF(a.Ada = 1, a.Aktual, d.pumd_nominal_sumber)) AS Diajukan,
        SUM(IFNULL(a.Aktual, 0)) AS Terealisasi
     ${SQL_PUM_PO_DASAR}
       AND d.pumd_nomor_sumber IN (?)
     GROUP BY d.pumd_nomor_sumber, pd.pod_sup_kode`,
    [daftarPo],
  );

  const kunci = (po, sup) => `${po}|${String(sup).trim()}`;
  const bulat = (n) => Math.round(n * 100) / 100;
  const sisa = new Map();
  for (const r of [...pengajuan, ...pum, ...vouPol]) {
    const k = kunci(r.PoNomor, r.SupKode);
    const s = sisa.get(k) || { v: 0, b: 0 };
    s.v += Number(r.Diajukan) || 0;
    s.b += Number(r.Terealisasi) || 0;
    sisa.set(k, s);
  }

  const hasil = [];
  for (const r of bpb) {
    const s = sisa.get(kunci(r.PoNomor, r.SupKode)) || { v: 0, b: 0 };
    const total = Number(r.Total) || 0;
    const voucher = bulat(Math.min(total, s.v));
    const bayar = bulat(Math.min(voucher, s.b));
    s.v = bulat(s.v - voucher);
    s.b = bulat(s.b - bayar);
    if (!Number(r.DalamRentang)) continue;
    const { PoNomor, DalamRentang, ...row } = r;
    hasil.push({ ...row, Total: total, Voucher: voucher, Bayar: bayar });
  }
  return hasil;
};

// ── PO Celup via Voucher Pembayaran (tipe PCL) ──────────────────────────
// Satu PO Celup bisa punya banyak BPB. Voucher PCL dibagi ke BPB tertua dulu,
// masing-masing maksimal sebesar total BPB-nya. Semua BPB PO dihitung (termasuk
// di luar rentang tanggal), hanya yang dalam rentang yang dikembalikan.
// Relasi BPB ke PO: bpb_po_nomor (Delphi/manual) atau bpb_keterangan (auto-BPB web).
const getAlokasiPcl = async (startDate, endDate) => {
  const [vou] = await db.query(
    `SELECT v.voud_nota AS Po, vh.vou_nomor AS NomorVoucher,
            DATE_FORMAT(vh.vou_tanggal, '%Y-%m-%d') AS TanggalVoucher,
            v.voud_total AS Total,
            vh.vou_status_realisasi AS StatusRealisasi,
            EXISTS (
              SELECT 1 FROM bayar_debet_detail bd
              WHERE bd.vou_nomor = vh.vou_nomor
            ) AS Bayar
     FROM tvoucher_dtl v
     INNER JOIN tvoucher_hdr vh ON vh.vou_nomor = v.voud_vou_nomor
     WHERE v.voud_type = 'PCL'
     ORDER BY v.voud_nota, vh.vou_tanggal, vh.vou_nomor`,
  );
  if (!vou.length) return { perBpb: new Map(), detail: [] };

  const poList = [...new Set(vou.map((v) => v.Po))];
  const [bpb] = await db.query(
    `SELECT h.bpb_nomor AS Bpb, c.po_nomor AS Po,
            (h.bpb_tanggal >= ? AND h.bpb_tanggal <= ?) AS DalamRentang,
            ROUND(SUM((d.bpbd_harga * (100 - d.bpbd_disc) / 100) * d.bpbd_jumlah
              * IF(p.po_status_ppn = 1, (100 + p.po_ppn) / 100, 1)), 2) AS Total
     FROM tbpb_hdr h
     INNER JOIN tpo_hdr c
       ON c.po_jenis = 2 AND c.po_nomor IN (h.bpb_po_nomor, h.bpb_keterangan)
     INNER JOIN tbpb_dtl d ON d.bpbd_bpb_nomor = h.bpb_nomor
     INNER JOIN tpo_hdr p ON p.po_nomor = h.bpb_po_nomor
     WHERE c.po_nomor IN (?)
     GROUP BY h.bpb_nomor, c.po_nomor, h.bpb_tanggal
     ORDER BY c.po_nomor, h.bpb_tanggal, h.bpb_nomor`,
    [startDate, endDate, poList],
  );

  const bulat = (n) => Math.round(n * 100) / 100;
  const antrian = {};
  vou.forEach((v) => {
    (antrian[v.Po] ||= []).push({ ...v, sisa: Number(v.Total) || 0 });
  });

  const perBpb = new Map();
  const detail = [];
  for (const b of bpb) {
    let butuh = Number(b.Total) || 0;
    const alok = { v: 0, b: 0 };
    for (const v of antrian[b.Po] || []) {
      if (butuh <= 0.005) break;
      if (v.sisa <= 0.005) continue;
      const ambil = bulat(Math.min(butuh, v.sisa));
      v.sisa = bulat(v.sisa - ambil);
      butuh = bulat(butuh - ambil);
      alok.v += ambil;
      if (Number(v.Bayar) === 1) alok.b += ambil;
      if (Number(b.DalamRentang)) {
        detail.push({
          Nomor: b.Bpb,
          NomorVoucher: v.NomorVoucher,
          TanggalVoucher: v.TanggalVoucher,
          Total: ambil,
          StatusRealisasi: v.StatusRealisasi,
        });
      }
    }
    if (Number(b.DalamRentang)) {
      perBpb.set(b.Bpb, { v: bulat(alok.v), b: bulat(alok.b) });
    }
  }
  return { perBpb, detail };
};

// ── Master: Daftar Seluruh Jenis BPB / Nota Hutang ─────────────────────
const getBrowse = async (startDate, endDate) => {
  const [rowsUtama] = await db.query(
    `SELECT 
        x.Nomor,
        x.Tipe,
        x.Tanggal,
        x.JatuhTempo,
        x.SupKode,
        x.Nama,
        x.Total,
        IFNULL((
          SELECT SUM(vd.voud_total)
          FROM tvoucher_dtl vd
          WHERE vd.voud_nota = x.Nomor
        ), 0) AS Voucher,
        IFNULL((
          SELECT SUM(vd.voud_total)
          FROM tvoucher_dtl vd
          WHERE vd.voud_nota = x.Nomor
            AND EXISTS (
              SELECT 1 FROM bayar_debet_detail bd
              WHERE bd.vou_nomor = vd.voud_vou_nomor
            )
        ), 0) AS Bayar
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
          AND p.po_jenis <> 4
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

  const { perBpb } = await getAlokasiPcl(startDate, endDate);
  rowsUtama.forEach((r) => {
    const a = r.Tipe === "PBG" ? perBpb.get(r.Nomor) : null;
    if (a) {
      r.Voucher = Number(r.Voucher) + a.v;
      r.Bayar = Number(r.Bayar) + a.b;
    }
  });

  const lain = await getHutangPoLainLain(startDate, endDate);
  const gabung = [...rowsUtama, ...lain];
  gabung.sort(
    (a, b) =>
      String(a.Tanggal || "").localeCompare(String(b.Tanggal || "")) ||
      String(a.Nomor).localeCompare(String(b.Nomor)),
  );
  return gabung;
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
     FROM (
       -- Daftar semua nomor transaksi dalam rentang tanggal terkait
       SELECT bpb_nomor AS Nomor FROM tbpb_hdr WHERE bpb_tanggal >= ? AND bpb_tanggal <= ?
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
     ) n
     INNER JOIN tvoucher_dtl vd ON vd.voud_nota = n.Nomor
     INNER JOIN tvoucher_hdr vh ON vh.vou_nomor = vd.voud_vou_nomor
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
  // PO Lain-lain: tampilkan pengajuan transfer sebagai "voucher". Dokumen
  // yang sama muncul di setiap BPB milik PO + supplier yang sama.
  const [rowsLain] = await db.query(
    `SELECT h.bpb_nomor AS Nomor,
        t.ptd_nomor AS NomorVoucher,
        DATE_FORMAT(th.pth_tanggal, '%Y-%m-%d') AS TanggalVoucher,
        t.ptd_nominal AS Total,
        IF(t.ptd_jur_no <> '', 1, 0) AS StatusRealisasi
     FROM tbpb_hdr h
     INNER JOIN tpo_hdr p ON p.po_nomor = h.bpb_po_nomor AND p.po_jenis = 4
     INNER JOIN finance.tpengajuan_transfer_dtl t
       ON t.ptd_trs = h.bpb_po_nomor
      AND t.ptd_sup_kode = h.bpb_sup_kode
      AND t.ptd_batal = ''
     INNER JOIN finance.tpengajuan_transfer_hdr th ON th.pth_nomor = t.ptd_nomor
     WHERE h.bpb_tanggal >= ? AND h.bpb_tanggal <= ?`,
    [startDate, endDate],
  );
  // PO Lain-lain via Uang Muka: nomor PUM tampil sebagai "voucher"
  const [rowsPum] = await db.query(
    `SELECT h.bpb_nomor AS Nomor,
        x.PumNomor AS NomorVoucher,
        DATE_FORMAT(x.PumTanggal, '%Y-%m-%d') AS TanggalVoucher,
        x.Total AS Total,
        x.Selesai AS StatusRealisasi
     FROM tbpb_hdr h
     INNER JOIN tpo_hdr p ON p.po_nomor = h.bpb_po_nomor AND p.po_jenis = 4
     INNER JOIN (
       SELECT d.pumd_pum_nomor AS PumNomor, ph.pum_tanggal AS PumTanggal,
              d.pumd_nomor_sumber AS PoNomor, pd.pod_sup_kode AS SupKode,
              SUM(IF(a.Ada = 1, a.Aktual, d.pumd_nominal_sumber)) AS Total,
              MIN(IF(a.Ada = 1, 1, 0)) AS Selesai
       ${SQL_PUM_PO_DASAR}
       GROUP BY d.pumd_pum_nomor, ph.pum_tanggal,
                d.pumd_nomor_sumber, pd.pod_sup_kode
     ) x ON x.PoNomor = h.bpb_po_nomor AND x.SupKode = h.bpb_sup_kode
     WHERE h.bpb_tanggal >= ? AND h.bpb_tanggal <= ?`,
    [startDate, endDate],
  );
  // PO Lain-lain via Voucher Pembayaran (tipe POL)
  const [rowsVouPol] = await db.query(
    `SELECT h.bpb_nomor AS Nomor,
        vh.vou_nomor AS NomorVoucher,
        DATE_FORMAT(vh.vou_tanggal, '%Y-%m-%d') AS TanggalVoucher,
        v.voud_total AS Total,
        vh.vou_status_realisasi AS StatusRealisasi
     FROM tbpb_hdr h
     INNER JOIN tpo_hdr p ON p.po_nomor = h.bpb_po_nomor AND p.po_jenis = 4
     INNER JOIN tvoucher_dtl v
       ON v.voud_nota = h.bpb_po_nomor AND v.voud_type = 'POL'
     INNER JOIN tvoucher_hdr vh
       ON vh.vou_nomor = v.voud_vou_nomor AND vh.vou_sup_kode = h.bpb_sup_kode
     WHERE h.bpb_tanggal >= ? AND h.bpb_tanggal <= ?`,
    [startDate, endDate],
  );

  const { detail: rowsVouPcl } = await getAlokasiPcl(startDate, endDate);
  return [...rows, ...rowsLain, ...rowsPum, ...rowsVouPol, ...rowsVouPcl].sort(
    (a, b) =>
      String(a.Nomor).localeCompare(String(b.Nomor)) ||
      String(a.TanggalVoucher).localeCompare(String(b.TanggalVoucher)),
  );
};

module.exports = { getBrowse, getDetail };
