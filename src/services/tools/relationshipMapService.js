const db = require("../../config/database");

/**
 * ═══════════════════════════════════════════════════════════
 * RELATIONSHIP MAP (v3)
 *
 * - so_memo BENAR ADA — dibuktikan langsung dari salesOrderFormService.js
 *   (JOIN tmemospk ON map.mspk_nomor = s.so_memo, dan validateField
 *   UNION spk_memo/so_memo). MAP<->SO forward/backward via so_memo valid.
 * - SJ_MEMO <-> SO TIDAK punya FK database — hubungan cuma di level UI
 *   (getSjMemoMapList/findSjMemoByMap dipakai buat auto-fill so_memo
 *   saat user pilih SJ Memo di form SO). Sengaja TIDAK dijadikan edge.
 * - MKB<->SO via mkb_spk_nomor=so_nomor, konsisten dengan resolver yang ada.
 *
 * ✅ KONFIRMASI BARU (dari 5 source yang sebelumnya gagal terkirim):
 * - PO Bahan BUKAN tabel terpisah — tetap tpo_hdr, dibedakan kolom
 *   po_jenis (1=Greige, 2=Celup, lainnya=Bahan). tpo_dtl.pod_spk_nomor
 *   dipakai konsisten di semua jenis PO ini (lihat poBahanFormService
 *   saveData: item.spk diinsert ke pod_spk_nomor apa pun po_jenis-nya)
 * - BPB Bahan tetap tbpb_hdr (sama seperti sebelumnya)
 * - PO Non-Bahan/PO Jasa (tpojasa_hdr) dan PO External (tpoexternal_hdr)
 *   itu TABEL TERPISAH TOTAL dari tpo_hdr — jadi getForwardProduksiRelations
 *   yang query tpo_dtl/tbpb_hdr TIDAK PERLU filter po_jenis, karena
 *   kedua tabel itu memang murni domain Bahan/produksi garmen
 * - BPB Non-Bahan Garmen juga TABEL TERPISAH: tgarmenbpb_hdr/tgarmenbpb_dtl
 *   (bukan flag di tbpb_hdr) — jadi node baru BPB_NON_BAHAN
 * - MKB (tmkb_hdr): backward via mkb_spk_nomor (ambigu, pakai resolver),
 *   forward ke PO via tmkb_dtl2.mkbd2_po_nomor
 * - Voucher Pembayaran (tvoucher_hdr): backward ke nota via tvoucher_dtl
 *   (voud_nota + voud_type). Hanya voud_type='BPB' (->BPB) dan
 *   voud_type='BPG' (->BPB_NON_BAHAN) yang masuk graph produksi garmen;
 *   tipe lain (RET/BPJ/PJG/POE/MMT/BPE) di luar scope Relationship Map
 *   ini (domain jasa/eksternal/retur, bukan alur bahan/produksi)
 *
 * * ✅ TERKONFIRMASI:
 * - Permintaan Harga -> Penawaran ADA edge, tapi bukan di header
 *   (pen_mh_nomor tidak ada), melainkan di level DETAIL:
 *   tpenawaran_dtl.pend_minta = mh_nomor. Satu Penawaran bisa berasal
 *   dari beberapa MH sekaligus (per baris item).
 * - MAP tetap backward langsung ke MH (mspk_mh_nomor) SEKALIGUS ke
 *   Penawaran (mspk_pen_nomor) — keduanya kolom independen yang sama-
 *   sama beneran terisi di DB (denormalized by design), BUKAN salah
 *   satunya derivasi dari yang lain. Jadi bentuk diamond/paralel di
 *   graph (MH dan Penawaran sama-sama panah ke MAP) itu akurat
 *   merepresentasikan struktur data asli, bukan bug.
 * ═══════════════════════════════════════════════════════════
 */

const NODE_TYPES = [
  "PERMINTAAN_HARGA",
  "PENAWARAN",
  "MAP",
  "SPK",
  "SO",
  "PROOF",
  "SJ_MEMO",
  "PO",
  "BPB",
  "STBJ",
  "SJ",
  "INVOICE",
  "MKB",
  "BPB_NON_BAHAN",
  "VOUCHER",
  "PLANNING_PPIC",
  "PERMINTAAN_BAHAN",
  "REALISASI_MINTA_BAHAN",
  "RETUR_LOG",
  "RETUR_BAHAN",
  "MKA",
  "PERMINTAAN_GARMEN",
  "REALISASI_GARMEN",
  "PERMINTAAN_PEMBELIAN",
  "KASBON",
  "MUTASI_OUT",
  "PO_NON_BAHAN",
  "MUTASI_PRODUKSI",
  "PO_JASA",
  "BPJ",
  "PO_INTERNAL",
  "SJ_PO_INTERNAL",
  "JADWAL_KIRIM",
  "SJ_TAK_NORMAL",
  "INVOICE_TAK_NORMAL",
  "PENERIMAAN_PIUTANG",
  "PELUNASAN_PIUTANG",
];

const resolveProduksiNomor = async (nomor) => {
  if (!nomor) return null;
  const [spkRows] = await db.query(
    `SELECT spk_nomor AS n FROM tspk WHERE spk_nomor = ?`,
    [nomor],
  );
  if (spkRows.length) return { type: "SPK", nomor: spkRows[0].n };

  const [soRows] = await db.query(
    `SELECT so_nomor AS n FROM tsalesorder WHERE so_nomor = ?`,
    [nomor],
  );
  if (soRows.length) return { type: "SO", nomor: soRows[0].n };

  const [mapRows] = await db.query(
    `SELECT mspk_nomor AS n FROM tmemospk WHERE mspk_nomor = ?`,
    [nomor],
  );
  if (mapRows.length) return { type: "MAP", nomor: mapRows[0].n };

  return null;
};

// ✅ Terkonfirmasi dari GUDANG_MAP di mutasiProduksiFormService.js.
// Dipakai buat urutkan node MUTASI_PRODUKSI sesuai alur proses
// produksi asli (Potong->QC Potong->Cetak->QC Cetak->DC->Jahit->
// Lipat->Koli), bukan urutan default DB (mph_nomor/tanggal) yang
// gak merepresentasikan tahapan produksi. 7 & 8 (QC Potong->DC,
// QC Cetak->DC) sengaja di-nomor besar karena itu cabang tambahan,
// bukan alur utama.
const MUTASI_PRODUKSI_ORDER = {
  // P04
  "GP001|GP012": 1,
  "GP012|GP002": 2,
  "GP002|GP010": 3,
  "GP032|GP003": 4,
  "GP003|GP004": 5,
  "GP004|GP013": 6,
  "GP012|GP032": 7,
  "GP010|GP032": 8,
  // P01 (tidak ada tahap DC->Jahit terpisah, QC Cetak langsung ke Jahit)
  "GP015|GP021": 1,
  "GP021|GP017": 2,
  "GP017|GP022": 3,
  "GP022|GP018": 4,
  "GP018|GP019": 5,
  "GP019|GP020": 6,
};

const sortMutasiProduksiOrder = (rows) => {
  return rows
    .map((r, idx) => ({ ...r, _idx: idx }))
    .sort((a, b) => {
      const orderA =
        MUTASI_PRODUKSI_ORDER[`${a.gdgAsal}|${a.gdgTujuan}`] ?? 999;
      const orderB =
        MUTASI_PRODUKSI_ORDER[`${b.gdgAsal}|${b.gdgTujuan}`] ?? 999;
      if (orderA !== orderB) return orderA - orderB;
      return a._idx - b._idx; // fallback: pertahankan urutan asli DB kalau kombinasi gak dikenali
    });
};

// Gudang tujuan tahap akhir "Lipat -> Koli/Finishing" (order 6 di
// MUTASI_PRODUKSI_ORDER). STBJ dikaitkan ke node Mutasi Produksi yang
// gudang tujuannya salah satu dari ini, BUKAN backward langsung dari
// SPK — karena secara bisnis STBJ baru masuk akal setelah barang
// sampai di Koli. Tetap perlu ditandai: TIDAK ADA FK asli antara
// STBJ dan Mutasi Produksi, ini murni pengelompokan alur (mirip pola
// PO_JASA/PO_INTERNAL -> Mutasi Produksi sebelumnya).
const KOLI_TUJUAN_GDG = new Set(["GP013", "GP020"]);

const getNodeDetail = async (type, nomor, context = {}) => {
  switch (type) {
    case "PERMINTAAN_HARGA": {
      const [[row]] = await db.query(
        `SELECT mh_nomor AS nomor, DATE_FORMAT(mh_tanggal,'%Y-%m-%d') AS tanggal,
                mh_nama AS label
         FROM tmintaharga WHERE mh_nomor = ?`,
        [nomor],
      );
      return row
        ? {
            type,
            nomor: row.nomor,
            tanggal: row.tanggal,
            label: row.label || row.nomor,
          }
        : null;
    }
    case "PENAWARAN": {
      const [[row]] = await db.query(
        `SELECT pen_nomor AS nomor, DATE_FORMAT(pen_tanggal,'%Y-%m-%d') AS tanggal,
                pen_keterangan AS label
         FROM tpenawaran_hdr WHERE pen_nomor = ?`,
        [nomor],
      );
      return row
        ? {
            type,
            nomor: row.nomor,
            tanggal: row.tanggal,
            label: row.label || row.nomor,
          }
        : null;
    }
    case "MAP": {
      const [[row]] = await db.query(
        `SELECT mspk_nomor AS nomor, DATE_FORMAT(mspk_tanggal,'%Y-%m-%d') AS tanggal,
                mspk_nama AS label, mspk_bastnew AS hasBast, mspk_jumlah_jadi AS jumlahJadi
         FROM tmemospk WHERE mspk_nomor = ?`,
        [nomor],
      );
      return row
        ? {
            type,
            nomor: row.nomor,
            tanggal: row.tanggal,
            label: row.label || row.nomor,
            hasBast: !!row.hasBast,
            jumlahJadi: row.hasBast ? Number(row.jumlahJadi) || 0 : undefined,
          }
        : null;
    }
    case "SPK": {
      const [[row]] = await db.query(
        `SELECT spk_nomor AS nomor, DATE_FORMAT(spk_tanggal,'%Y-%m-%d') AS tanggal,
                spk_nama AS label, spk_jumlah AS jumlah
         FROM tspk WHERE spk_nomor = ?`,
        [nomor],
      );
      return row
        ? {
            type,
            nomor: row.nomor,
            tanggal: row.tanggal,
            label: row.label || row.nomor,
            jumlah: row.jumlah,
          }
        : null;
    }
    case "SO": {
      const [[row]] = await db.query(
        `SELECT so_nomor AS nomor, DATE_FORMAT(so_tanggal,'%Y-%m-%d') AS tanggal,
                so_nama AS label, so_jumlah AS jumlah
         FROM tsalesorder WHERE so_nomor = ?`,
        [nomor],
      );
      return row
        ? {
            type,
            nomor: row.nomor,
            tanggal: row.tanggal,
            label: row.label || row.nomor,
            jumlah: row.jumlah,
          }
        : null;
    }
    case "PROOF": {
      const [[row]] = await db.query(
        `SELECT pf_nomor AS nomor, DATE_FORMAT(pf_tanggal,'%Y-%m-%d') AS tanggal,
                pf_lini AS label
         FROM tproofgarmen_hdr WHERE pf_nomor = ?`,
        [nomor],
      );
      return row
        ? {
            type,
            nomor: row.nomor,
            tanggal: row.tanggal,
            label: row.label || row.nomor,
          }
        : null;
    }
    case "SJ_MEMO": {
      const [[row]] = await db.query(
        `SELECT sj_nomor AS nomor, DATE_FORMAT(sj_tanggal,'%Y-%m-%d') AS tanggal
         FROM tsj_hdr_memo WHERE sj_nomor = ?`,
        [nomor],
      );
      return row
        ? { type, nomor: row.nomor, tanggal: row.tanggal, label: row.nomor }
        : null;
    }
    case "PO": {
      const [[row]] = await db.query(
        `SELECT po_nomor AS nomor, DATE_FORMAT(po_tanggal,'%Y-%m-%d') AS tanggal,
                po_jenis AS jenis
         FROM tpo_hdr WHERE po_nomor = ?`,
        [nomor],
      );
      if (!row) return null;
      // ⚠️ ASUMSI label: 0/3(default)=Bahan, 1=Greige, 2=Celup — dari
      // generateNomorPO (prefix PB/PG/PC), belum ada kamus resmi po_jenis
      const jenisLabel = { 1: "Greige", 2: "Celup" }[row.jenis] || "Bahan";
      return {
        type,
        nomor: row.nomor,
        tanggal: row.tanggal,
        label: `${row.nomor} (${jenisLabel})`,
        jenis: row.jenis,
      };
    }
    case "BPB": {
      const [[row]] = await db.query(
        `SELECT bpb_nomor AS nomor, DATE_FORMAT(bpb_tanggal,'%Y-%m-%d') AS tanggal
         FROM tbpb_hdr WHERE bpb_nomor = ?`,
        [nomor],
      );
      return row
        ? { type, nomor: row.nomor, tanggal: row.tanggal, label: row.nomor }
        : null;
    }
    case "BPB_NON_BAHAN": {
      const [[row]] = await db.query(
        `SELECT bpb_nomor AS nomor, DATE_FORMAT(bpb_tanggal,'%Y-%m-%d') AS tanggal,
                bpb_ket AS label
         FROM tgarmenbpb_hdr WHERE bpb_nomor = ?`,
        [nomor],
      );
      return row
        ? {
            type,
            nomor: row.nomor,
            tanggal: row.tanggal,
            label: row.label || row.nomor,
          }
        : null;
    }
    case "STBJ": {
      const [[row]] = await db.query(
        `SELECT stbj_nomor AS nomor, DATE_FORMAT(stbj_tanggal,'%Y-%m-%d') AS tanggal
         FROM tstbj_hdr WHERE stbj_nomor = ?`,
        [nomor],
      );
      return row
        ? { type, nomor: row.nomor, tanggal: row.tanggal, label: row.nomor }
        : null;
    }
    case "SJ": {
      const [[row]] = await db.query(
        `SELECT h.sj_nomor AS nomor, DATE_FORMAT(h.sj_tanggal,'%Y-%m-%d') AS tanggal,
                h.sj_approve AS approveStatus, h.sj_stssj_kode AS statusKode,
                s.stssj_nama AS statusNama
         FROM tsj_hdr h
         LEFT JOIN tstatussj s ON s.stssj_kode = h.sj_stssj_kode
         WHERE h.sj_nomor = ?`,
        [nomor],
      );
      if (!row) return null;
      const approveLabel = { 0: undefined, 1: "APPROVED", 2: "BATAL" }[
        Number(row.approveStatus)
      ];
      return {
        type,
        nomor: row.nomor,
        tanggal: row.tanggal,
        label: row.nomor,
        approveStatus: approveLabel,
        statusPengiriman: row.statusNama || undefined,
      };
    }
    case "INVOICE": {
      const [[row]] = await db.query(
        `SELECT inv_nomor AS nomor, DATE_FORMAT(inv_tanggal,'%Y-%m-%d') AS tanggal,
                inv_sts_pro AS stsPro, inv_no_fp AS noFakturPajak, isexportppn AS isExportedRaw
         FROM tinv_hdr WHERE inv_nomor = ?`,
        [nomor],
      );
      if (!row) return null;

      const [[kuiRow]] = await db.query(
        `SELECT kui_inv_nomor FROM tkuitansi WHERE kui_inv_nomor = ?`,
        [nomor],
      );

      return {
        type,
        nomor: row.nomor,
        tanggal: row.tanggal,
        label: row.nomor,
        isProforma: Number(row.stsPro) === 1,
        hasKuitansi: !!kuiRow,
        noFakturPajak: row.noFakturPajak || undefined,
        isExportedPpn: !!Number(row.isExportedRaw),
      };
    }
    case "MKB": {
      const [[row]] = await db.query(
        `SELECT mkb_nomor AS nomor, DATE_FORMAT(mkb_tanggal,'%Y-%m-%d') AS tanggal,
                mkb_note AS label
         FROM tmkb_hdr WHERE mkb_nomor = ?`,
        [nomor],
      );
      return row
        ? {
            type,
            nomor: row.nomor,
            tanggal: row.tanggal,
            label: row.label || row.nomor,
          }
        : null;
    }
    case "VOUCHER": {
      const [[row]] = await db.query(
        `SELECT vou_nomor AS nomor, DATE_FORMAT(vou_tanggal,'%Y-%m-%d') AS tanggal,
                vou_keterangan AS label, vou_total AS jumlah
         FROM tvoucher_hdr WHERE vou_nomor = ?`,
        [nomor],
      );
      return row
        ? {
            type,
            nomor: row.nomor,
            tanggal: row.tanggal,
            label: row.label || row.nomor,
            jumlah: row.jumlah,
          }
        : null;
    }
    case "PLANNING_PPIC": {
      const [[row]] = await db.query(
        `SELECT pl_nomor AS nomor, DATE_FORMAT(pl_tgl1,'%Y-%m-%d') AS tanggal,
                pl_keterangan AS label, pl_cab AS cabang
         FROM tplan_ppic_hdr WHERE pl_nomor = ?`,
        [nomor],
      );
      if (!row) return null;

      const [dtlRowsRaw] = await db.query(
        `SELECT plan_spk AS spk, plan_divisi AS divisi,
                DATE_FORMAT(plan_tgl_jadwal,'%Y-%m-%d') AS tglJadwal,
                plan_wip AS wip, plan_qty_po AS qtyPo,
                plan_qty_jadwal AS qtyJadwal, plan_line_kelompok AS lineKelompok
         FROM tplan_ppic_dtl2 WHERE plan_pl_nomor = ?
         ORDER BY plan_divisi, plan_tgl_jadwal`,
        [nomor],
      );

      // Kalau node ini dicapai lewat expand dari SPK tertentu
      // (context.filterSpk terisi), tampilkan HANYA baris planning
      // milik SPK itu — 1 planning bisa berisi banyak SPK berbeda,
      // dan tidak semuanya relevan buat pencarian user. Kalau node
      // PLANNING_PPIC ini dicapai langsung (search manual, context
      // kosong), tampilkan SEMUA SPK di dalamnya.
      const dtlRows = context.filterSpk
        ? dtlRowsRaw.filter((r) => r.spk === context.filterSpk)
        : dtlRowsRaw;

      const groupBy = (divisi) =>
        dtlRows
          .filter((r) => r.divisi === divisi)
          .map((r) => ({
            spk: r.spk,
            tglJadwal: r.tglJadwal,
            wip: Number(r.wip) || 0,
            qtyPo: Number(r.qtyPo) || 0,
            qtyJadwal: Number(r.qtyJadwal) || 0,
            lineKelompok: r.lineKelompok || "",
          }));

      return {
        type,
        nomor: row.nomor,
        tanggal: row.tanggal,
        label: row.label || row.nomor,
        cabang: row.cabang,
        filteredBySpk: context.filterSpk || undefined,
        planningDetail: {
          cutting: groupBy("CUTTING"),
          sewing: groupBy("SEWING"),
          koli: groupBy("KOLI"),
        },
      };
    }
    case "PERMINTAAN_BAHAN": {
      const [[row]] = await db.query(
        `SELECT min_nomor AS nomor, DATE_FORMAT(min_tanggal,'%Y-%m-%d') AS tanggal,
                min_ket AS label, min_close AS closeStatus
         FROM tmintabahan_hdr WHERE min_nomor = ?`,
        [nomor],
      );
      return row
        ? {
            type,
            nomor: row.nomor,
            tanggal: row.tanggal,
            label: row.label || row.nomor,
            closeStatus: row.closeStatus,
          }
        : null;
    }
    case "REALISASI_MINTA_BAHAN": {
      const [[row]] = await db.query(
        `SELECT promin_nomor AS nomor, DATE_FORMAT(promin_tanggal,'%Y-%m-%d') AS tanggal,
                promin_keterangan AS label, promin_jumlah AS jumlah
         FROM tproduksiminta_hdr WHERE promin_nomor = ?`,
        [nomor],
      );
      return row
        ? {
            type,
            nomor: row.nomor,
            tanggal: row.tanggal,
            label: row.label || row.nomor,
            jumlah: row.jumlah,
          }
        : null;
    }
    case "RETUR_LOG": {
      const [[row]] = await db.query(
        `SELECT proret_nomor AS nomor, DATE_FORMAT(proret_tanggal,'%Y-%m-%d') AS tanggal,
                proret_keterangan AS label
         FROM tproduksireturlog_hdr WHERE proret_nomor = ?`,
        [nomor],
      );
      return row
        ? {
            type,
            nomor: row.nomor,
            tanggal: row.tanggal,
            label: row.label || row.nomor,
          }
        : null;
    }
    case "RETUR_BAHAN": {
      const [[row]] = await db.query(
        `SELECT proret_nomor AS nomor, DATE_FORMAT(proret_tanggal,'%Y-%m-%d') AS tanggal,
                proret_keterangan AS label, proret_log AS logRef
         FROM tproduksiretur_hdr WHERE proret_nomor = ?`,
        [nomor],
      );
      return row
        ? {
            type,
            nomor: row.nomor,
            tanggal: row.tanggal,
            label: row.label || row.nomor,
            isFromLog: !!row.logRef,
          }
        : null;
    }
    case "MKA": {
      const [[row]] = await db.query(
        `SELECT mkb_nomor AS nomor, DATE_FORMAT(mkb_tanggal,'%Y-%m-%d') AS tanggal,
                mkb_note AS label
         FROM tmka_hdr WHERE mkb_nomor = ?`,
        [nomor],
      );
      return row
        ? {
            type,
            nomor: row.nomor,
            tanggal: row.tanggal,
            label: row.label || row.nomor,
          }
        : null;
    }
    case "PERMINTAAN_GARMEN": {
      const [[row]] = await db.query(
        `SELECT min_nomor AS nomor, DATE_FORMAT(min_tanggal,'%Y-%m-%d') AS tanggal,
                min_ket AS label, min_jenis AS kategori
         FROM tgarmenminta_hdr WHERE min_nomor = ?`,
        [nomor],
      );
      return row
        ? {
            type,
            nomor: row.nomor,
            tanggal: row.tanggal,
            label: row.label || row.nomor,
            kategori: row.kategori,
          }
        : null;
    }
    case "REALISASI_GARMEN": {
      const [[row]] = await db.query(
        `SELECT re_nomor AS nomor, DATE_FORMAT(re_tanggal,'%Y-%m-%d') AS tanggal,
                re_keterangan AS label, re_jenis AS kategori
         FROM tgarmenrealisasi_hdr WHERE re_nomor = ?`,
        [nomor],
      );
      return row
        ? {
            type,
            nomor: row.nomor,
            tanggal: row.tanggal,
            label: row.label || row.nomor,
            kategori: row.kategori,
          }
        : null;
    }
    case "PERMINTAAN_PEMBELIAN": {
      const [[row]] = await db.query(
        `SELECT mb_nomor AS nomor, DATE_FORMAT(mb_tanggal,'%Y-%m-%d') AS tanggal,
                mb_ket AS label, mb_jenis AS kategori
         FROM tgarmenmintabeli_hdr WHERE mb_nomor = ?`,
        [nomor],
      );
      return row
        ? {
            type,
            nomor: row.nomor,
            tanggal: row.tanggal,
            label: row.label || row.nomor,
            kategori: row.kategori,
          }
        : null;
    }
    case "KASBON": {
      const [[row]] = await db.query(
        `SELECT bon_nomor AS nomor, DATE_FORMAT(bon_tanggal,'%Y-%m-%d') AS tanggal,
                bon_keterangan AS label, bon_jenis AS jenis, bon_nominal AS jumlah,
                bon_selesai AS selesaiStatus, bon_jur_no AS jurNo
         FROM finance.tkasbon WHERE bon_nomor = ?`,
        [nomor],
      );
      return row
        ? {
            type,
            nomor: row.nomor,
            tanggal: row.tanggal,
            label: row.label || row.nomor,
            jenis: Number(row.jenis) === 0 ? "KAS" : "BANK",
            jumlah: row.jumlah,
            isSelesai: Number(row.selesaiStatus) !== 0,
            jurNo: row.jurNo || undefined,
          }
        : null;
    }
    case "MUTASI_OUT": {
      const [[row]] = await db.query(
        `SELECT mso_nomor AS nomor, DATE_FORMAT(mso_tanggal,'%Y-%m-%d') AS tanggal,
                mso_ket AS label, mso_jenis AS kategori, mso_cab AS cabangAsal,
                mso_kecab AS cabangTujuan, mso_msi_nomor AS msiNomor
         FROM tgarmenmso_hdr WHERE mso_nomor = ?`,
        [nomor],
      );
      return row
        ? {
            type,
            nomor: row.nomor,
            tanggal: row.tanggal,
            label: row.label || row.nomor,
            kategori: row.kategori,
            cabangAsal: row.cabangAsal,
            cabangTujuan: row.cabangTujuan,
            isDiterima: !!row.msiNomor,
            msiNomor: row.msiNomor || undefined,
          }
        : null;
    }
    case "PO_NON_BAHAN": {
      const [[row]] = await db.query(
        `SELECT po_nomor AS nomor, DATE_FORMAT(po_tanggal,'%Y-%m-%d') AS tanggal,
                po_ket AS label, po_jenis AS kategori, po_status AS status
         FROM tgarmenpo_hdr WHERE po_nomor = ?`,
        [nomor],
      );
      return row
        ? {
            type,
            nomor: row.nomor,
            tanggal: row.tanggal,
            label: row.label || row.nomor,
            kategori: row.kategori,
            status: row.status,
          }
        : null;
    }
    case "MUTASI_PRODUKSI": {
      const [[row]] = await db.query(
        `SELECT MPH_nomor AS nomor, DATE_FORMAT(mph_tanggal,'%Y-%m-%d') AS tanggal,
                MPH_keterangan AS label, mph_gdgasal AS gdgAsal, mph_gdgtujuan AS gdgTujuan,
                MPH_jumlah AS jumlah
         FROM tmutasiproduksi_hdr WHERE MPH_nomor = ?`,
        [nomor],
      );
      return row
        ? {
            type,
            nomor: row.nomor,
            tanggal: row.tanggal,
            label: row.label || row.nomor,
            jumlah: row.jumlah,
            gdgAsal: row.gdgAsal,
            gdgTujuan: row.gdgTujuan,
          }
        : null;
    }
    case "PO_JASA": {
      const [[row]] = await db.query(
        `SELECT pojh_nomor AS nomor, DATE_FORMAT(pojh_tanggal,'%Y-%m-%d') AS tanggal,
                pojh_keterangan AS label, pojh_jasa_kode AS kategori, pojh_status AS status
         FROM tpojasa_hdr WHERE pojh_nomor = ?`,
        [nomor],
      );
      return row
        ? {
            type,
            nomor: row.nomor,
            tanggal: row.tanggal,
            label: row.label || row.nomor,
            kategori: row.kategori,
            status: row.status,
          }
        : null;
    }
    case "BPJ": {
      const [[row]] = await db.query(
        `SELECT bpj_nomor AS nomor, DATE_FORMAT(bpj_tanggal,'%Y-%m-%d') AS tanggal,
                bpj_jumlah AS jumlah
         FROM tbpj_hdr WHERE bpj_nomor = ?`,
        [nomor],
      );
      return row
        ? {
            type,
            nomor: row.nomor,
            tanggal: row.tanggal,
            label: row.nomor,
            jumlah: row.jumlah,
          }
        : null;
    }
    case "PO_INTERNAL": {
      const [[row]] = await db.query(
        `SELECT poi_nomor AS nomor, DATE_FORMAT(poi_tanggal,'%Y-%m-%d') AS tanggal,
                poi_ket AS label, poi_jasa_kode AS kategori, poi_close AS status
         FROM tpointernal_hdr WHERE poi_nomor = ?`,
        [nomor],
      );
      return row
        ? {
            type,
            nomor: row.nomor,
            tanggal: row.tanggal,
            label: row.label || row.nomor,
            kategori: row.kategori,
            status: row.status,
          }
        : null;
    }
    case "SJ_PO_INTERNAL": {
      const [[row]] = await db.query(
        `SELECT poisj_nomor AS nomor, DATE_FORMAT(poisj_tanggal,'%Y-%m-%d') AS tanggal,
                poisj_ket AS label, poisj_approve AS status
         FROM tpointernalsj_hdr WHERE poisj_nomor = ?`,
        [nomor],
      );
      return row
        ? {
            type,
            nomor: row.nomor,
            tanggal: row.tanggal,
            label: row.label || row.nomor,
            status: row.status,
          }
        : null;
    }
    case "JADWAL_KIRIM": {
      const [[row]] = await db.query(
        `SELECT Nomor_Kirim AS nomor, DATE_FORMAT(Tanggal,'%Y-%m-%d') AS tanggal,
                Gudang AS label
         FROM tjadwalkirim WHERE Nomor_Kirim = ?`,
        [nomor],
      );
      return row
        ? {
            type,
            nomor: row.nomor,
            tanggal: row.tanggal,
            label: row.label || row.nomor,
          }
        : null;
    }
    case "SJ_TAK_NORMAL": {
      const [[row]] = await db.query(
        `SELECT sj_nomor AS nomor, DATE_FORMAT(sj_tanggal,'%Y-%m-%d') AS tanggal,
                sj_keterangan AS label
         FROM tsj_hdr_bayangan WHERE sj_nomor = ?`,
        [nomor],
      );
      return row
        ? {
            type,
            nomor: row.nomor,
            tanggal: row.tanggal,
            label: row.label || row.nomor,
          }
        : null;
    }
    case "INVOICE_TAK_NORMAL": {
      const [[row]] = await db.query(
        `SELECT inv_nomor AS nomor, DATE_FORMAT(inv_tanggal,'%Y-%m-%d') AS tanggal,
                inv_keterangan AS label
         FROM tinv_hdr WHERE inv_nomor = ? AND inv_sts_pro = 2`,
        [nomor],
      );
      return row
        ? {
            type,
            nomor: row.nomor,
            tanggal: row.tanggal,
            label: row.label || row.nomor,
          }
        : null;
    }
    case "PENERIMAAN_PIUTANG": {
      const [[row]] = await db.query(
        `SELECT a.nomor AS nomor, DATE_FORMAT(a.tanggal,'%Y-%m-%d') AS tanggal,
                a.notes AS label, a.kode AS kategori, a.debet AS jumlah
         FROM terima_bayar_debet a WHERE a.nomor = ?`,
        [nomor],
      );
      return row
        ? {
            type,
            nomor: row.nomor,
            tanggal: row.tanggal,
            label: row.label || row.nomor,
            kategori: row.kategori,
            jumlah: row.jumlah,
          }
        : null;
    }
    case "PELUNASAN_PIUTANG": {
      const [[row]] = await db.query(
        `SELECT nomor AS nomor, DATE_FORMAT(tanggal,'%Y-%m-%d') AS tanggal,
                notes AS label
         FROM piutang_kredit_header WHERE nomor = ?`,
        [nomor],
      );
      return row
        ? {
            type,
            nomor: row.nomor,
            tanggal: row.tanggal,
            label: row.label || row.nomor,
          }
        : null;
    }
    default:
      throw new Error(`Tipe node tidak dikenali: ${type}`);
  }
};

const getForwardProduksiRelations = async (nomor) => {
  const forward = [];

  // Catatan: tpo_dtl & tbpb_hdr di sini murni domain Bahan/produksi
  // garmen (PO Non-Bahan/Jasa/External ada di tabel lain sama sekali:
  // tpojasa_hdr, tpoexternal_hdr) — jadi TIDAK PERLU filter po_jenis.
  const [poRows] = await db.query(
    `SELECT DISTINCT pod_po_nomor AS nomor FROM tpo_dtl WHERE pod_spk_nomor = ?`,
    [nomor],
  );
  poRows.forEach((r) => forward.push({ type: "PO", nomor: r.nomor }));

  const [sjRows] = await db.query(
    `SELECT DISTINCT sjd_sj_nomor AS nomor FROM tsj_dtl WHERE sjd_spk_nomor = ?`,
    [nomor],
  );
  sjRows.forEach((r) => forward.push({ type: "SJ", nomor: r.nomor }));

  // ✅ Terkonfirmasi sjTakNormalFormService.js: sjd_spk_nomor langsung
  // ke tspk (tabel terpisah tsj_hdr_bayangan, bukan tsj_hdr biasa)
  const [sjTakNormalRows] = await db.query(
    `SELECT DISTINCT sjd_sj_nomor AS nomor FROM tsj_dtl_bayangan WHERE sjd_spk_nomor = ?`,
    [nomor],
  );
  sjTakNormalRows.forEach((r) =>
    forward.push({ type: "SJ_TAK_NORMAL", nomor: r.nomor }),
  );

  const [invRows] = await db.query(
    `SELECT DISTINCT invd_inv_nomor AS nomor FROM tinv_dtl WHERE invd_spk_nomor = ?`,
    [nomor],
  );
  invRows.forEach((r) => forward.push({ type: "INVOICE", nomor: r.nomor }));

  const [proofRows] = await db.query(
    `SELECT pf_nomor AS nomor FROM tproofgarmen_hdr WHERE pf_spk_nomor = ?`,
    [nomor],
  );
  proofRows.forEach((r) => forward.push({ type: "PROOF", nomor: r.nomor }));

  // MKB juga direct link ke SPK/MAP/SO via mkb_spk_nomor (bukan lewat
  // tabel detail), jadi ditambahkan terpisah di sini
  const [mkbRows] = await db.query(
    `SELECT mkb_nomor AS nomor FROM tmkb_hdr WHERE mkb_spk_nomor = ?`,
    [nomor],
  );
  mkbRows.forEach((r) => forward.push({ type: "MKB", nomor: r.nomor }));

  // Terkonfirmasi mintaBahanFormService.js: min_spk_nomor bisa nunjuk
  // SPK PPIC atau MAP langsung (querySpk UNION tspk+tmemospk, tanpa SO)
  const [permintaanBahanRows] = await db.query(
    `SELECT min_nomor AS nomor FROM tmintabahan_hdr WHERE min_spk_nomor = ?`,
    [nomor],
  );
  permintaanBahanRows.forEach((r) =>
    forward.push({ type: "PERMINTAAN_BAHAN", nomor: r.nomor }),
  );

  return forward;
};

const getRelated = async (type, nomor) => {
  const backward = [];
  const forward = [];

  switch (type) {
    case "PERMINTAAN_HARGA": {
      const [mapRows] = await db.query(
        `SELECT mspk_nomor AS nomor FROM tmemospk WHERE mspk_mh_nomor = ?`,
        [nomor],
      );
      mapRows.forEach((r) => forward.push({ type: "MAP", nomor: r.nomor }));

      // ✅ Terkonfirmasi dari penawaranFormService.js: TIDAK ADA kolom
      // pen_mh_nomor di header tpenawaran_hdr. Link ke MH ada di level
      // DETAIL — tpenawaran_dtl.pend_minta (diisi dari d.NoPermintaan,
      // sumbernya mh_nomor lewat getMintaHargaDetail). Satu Penawaran
      // bisa gabung item dari beberapa MH berbeda, makanya DISTINCT.
      const [penRows] = await db.query(
        `SELECT DISTINCT pend_pen_nomor AS nomor FROM tpenawaran_dtl WHERE pend_minta = ?`,
        [nomor],
      );
      penRows.forEach((r) =>
        forward.push({ type: "PENAWARAN", nomor: r.nomor }),
      );
      break;
    }
    case "PENAWARAN": {
      const [mapRows] = await db.query(
        `SELECT mspk_nomor AS nomor FROM tmemospk WHERE mspk_pen_nomor = ?`,
        [nomor],
      );
      mapRows.forEach((r) => forward.push({ type: "MAP", nomor: r.nomor }));

      const [spkRows] = await db.query(
        `SELECT spk_nomor AS nomor FROM tspk WHERE spk_pen_nomor = ? AND spk_aktif = 'Y'`,
        [nomor],
      );
      spkRows.forEach((r) => forward.push({ type: "SPK", nomor: r.nomor }));

      const [soRows] = await db.query(
        `SELECT so_nomor AS nomor FROM tsalesorder WHERE so_pen_nomor = ? AND so_aktif = 'Y'`,
        [nomor],
      );
      soRows.forEach((r) => forward.push({ type: "SO", nomor: r.nomor }));
      break;
    }
    case "MAP": {
      const [[row]] = await db.query(
        `SELECT mspk_pen_nomor AS pen, mspk_mh_nomor AS mh FROM tmemospk WHERE mspk_nomor = ?`,
        [nomor],
      );
      if (row?.pen) backward.push({ type: "PENAWARAN", nomor: row.pen });
      if (row?.mh) backward.push({ type: "PERMINTAAN_HARGA", nomor: row.mh });

      // Urutan insersi forward SENGAJA diatur (Proof -> SJ Memo -> MKB -> SO
      // -> SPK) supaya urutan tampil di graph mengikuti alur bisnis yang
      // dijelaskan user, walau secara struktur DB semuanya paralel dari
      // MAP (tidak ada FK berantai Proof->SJMemo->dst).
      const mapFwd = await getForwardProduksiRelations(nomor);
      mapFwd.filter((f) => f.type === "PROOF").forEach((f) => forward.push(f));

      const [sjMemoRows] = await db.query(
        `SELECT DISTINCT sjd_sj_nomor AS nomor FROM tsj_dtl_memo WHERE sjd_mspk_nomor = ?`,
        [nomor],
      );
      sjMemoRows.forEach((r) =>
        forward.push({ type: "SJ_MEMO", nomor: r.nomor }),
      );

      mapFwd.filter((f) => f.type === "MKB").forEach((f) => forward.push(f));

      const [soRows] = await db.query(
        `SELECT so_nomor AS nomor FROM tsalesorder WHERE so_memo = ? AND so_aktif = 'Y'`,
        [nomor],
      );
      soRows.forEach((r) => forward.push({ type: "SO", nomor: r.nomor }));

      const [spkRows] = await db.query(
        `SELECT spk_nomor AS nomor FROM tspk WHERE spk_memo = ? AND spk_aktif = 'Y'`,
        [nomor],
      );
      spkRows.forEach((r) => forward.push({ type: "SPK", nomor: r.nomor }));
      break;
    }
    case "SPK": {
      const [[row]] = await db.query(
        `SELECT spk_memo AS map, spk_pen_nomor AS pen, spk_so_ref AS soRef FROM tspk WHERE spk_nomor = ?`,
        [nomor],
      );
      if (row?.map) backward.push({ type: "MAP", nomor: row.map });
      else if (row?.pen) backward.push({ type: "PENAWARAN", nomor: row.pen });

      if (row?.soRef) {
        const resolvedSo = await resolveProduksiNomor(row.soRef);
        if (resolvedSo) backward.push(resolvedSo);
      }

      forward.push(...(await getForwardProduksiRelations(nomor)));

      // ✅ Terkonfirmasi dari planningSpkFormService.js: Planning PPIC
      // (tplan_ppic_dtl2.plan_spk) khusus referensi SPK produksi
      // (spk_divisi IN (3,4,6)), TIDAK melalui getForwardProduksiRelations
      // yang shared dengan SO/MAP — jadi edge ini sengaja hanya di case
      // SPK, bukan di fungsi shared.
      const [planRows] = await db.query(
        `SELECT DISTINCT plan_pl_nomor AS nomor FROM tplan_ppic_dtl2 WHERE plan_spk = ?`,
        [nomor],
      );
      planRows.forEach((r) =>
        forward.push({
          type: "PLANNING_PPIC",
          nomor: r.nomor,
          filterSpk: nomor,
        }),
      );

      // ✅ Terkonfirmasi mkaFormService.js getSpkInfo: validasi ketat
      // lewat tspk saja (bukan UNION dgn tmemospk/tsalesorder seperti
      // Permintaan Garmen), jadi edge ini khusus SPK.
      const [mkaRows] = await db.query(
        `SELECT mkb_nomor AS nomor FROM tmka_hdr WHERE mkb_spk_nomor = ?`,
        [nomor],
      );
      mkaRows.forEach((r) => forward.push({ type: "MKA", nomor: r.nomor }));

      // ✅ Terkonfirmasi garmenMintaFormService.js: min_spk_nomor.
      // TIDAK ADA FK langsung ke MKA — keduanya sibling di bawah SPK
      // yang sama (getDetailForm JOIN tmka_hdr via mkb_spk_nomor =
      // min_spk_nomor, bukan lewat nomor MKA). Jadi sengaja paralel
      // dari SPK, bukan rantai MKA->PermintaanGarmen.
      // ⚠️ min_spk_nomor JUGA bisa berasal dari MAP (validateSpkAndMka
      // punya isMap check + UNION tspk/tmemospk) — belum ditambahkan
      // ke case MAP, tandai kalau perlu dikejar juga.
      const [permintaanGarmenRows] = await db.query(
        `SELECT min_nomor AS nomor FROM tgarmenminta_hdr WHERE min_spk_nomor = ?`,
        [nomor],
      );
      permintaanGarmenRows.forEach((r) =>
        forward.push({ type: "PERMINTAAN_GARMEN", nomor: r.nomor }),
      );

      // ✅ Terkonfirmasi mutasiProduksiFormService.js: mph_spk_nomor
      // (via UNION tspk+tmemospk di getSpkInfo, sama seperti MKA).
      // Diurutkan sesuai tahapan proses produksi asli (lihat
      // MUTASI_PRODUKSI_ORDER), bukan urutan default DB.
      const [mutasiProduksiRowsRaw] = await db.query(
        `SELECT MPH_nomor AS nomor, mph_gdgasal AS gdgAsal, mph_gdgtujuan AS gdgTujuan
         FROM tmutasiproduksi_hdr WHERE MPH_SPK_nomor = ?`,
        [nomor],
      );
      sortMutasiProduksiOrder(mutasiProduksiRowsRaw).forEach((r) =>
        forward.push({ type: "MUTASI_PRODUKSI", nomor: r.nomor }),
      );

      // ✅ Terkonfirmasi poJasaFormService.js getSpkInfo: pojh_spk_nomor
      // via UNION tspk+tmemospk (tanpa SO), sama pola dengan MKA/Mutasi Produksi
      const [poJasaRows] = await db.query(
        `SELECT pojh_nomor AS nomor FROM tpojasa_hdr WHERE pojh_spk_nomor = ?`,
        [nomor],
      );
      poJasaRows.forEach((r) =>
        forward.push({ type: "PO_JASA", nomor: r.nomor }),
      );

      // ✅ Terkonfirmasi poInternalSpkFormService.js checkSpk: poi_spk_nomor
      // via UNION tsalesorder+tspk+tmemospk (divisi 3,4,6)
      const [poInternalRows] = await db.query(
        `SELECT poi_nomor AS nomor FROM tpointernal_hdr WHERE poi_spk_nomor = ?`,
        [nomor],
      );
      poInternalRows.forEach((r) =>
        forward.push({ type: "PO_INTERNAL", nomor: r.nomor }),
      );

      // ✅ Terkonfirmasi getJadwalKirimList (suratJalanFormService.js):
      // tjadwalkirim.spk_nomor merujuk SPK PPIC turunan, BUKAN SO/MAP
      const [jadwalKirimRows] = await db.query(
        `SELECT Nomor_Kirim AS nomor FROM tjadwalkirim WHERE spk_nomor = ?`,
        [nomor],
      );
      jadwalKirimRows.forEach((r) =>
        forward.push({ type: "JADWAL_KIRIM", nomor: r.nomor }),
      );

      break;
    }
    case "PLANNING_PPIC": {
      // ✅ FIX: sebelumnya SELALU narik semua SPK di planning ini,
      // dengan alasan "berguna kalau user sedang di titik planning".
      // Ternyata di praktik ini bikin bingung: user expand dari SPK
      // A -> dapat Planning (sudah terfilter ke SPK A) -> klik expand
      // titik di node Planning itu -> backward-nya narik SEMUA SPK di
      // planning itu tanpa filter, jadi SPK lain yang tidak diminta
      // muncul di graph. Sekarang: backward planning TIDAK narik SPK
      // apa pun (planning bukan hub buat "lompat" ke SPK lain lewat
      // expand titik). Kalau user mau lihat semua SPK di 1 planning,
      // search planning itu langsung dari search box — getNodeDetail
      // akan menampilkan semua baris tanpa filter (context kosong).
      break;
    }
    case "SO": {
      const [[row]] = await db.query(
        `SELECT so_memo AS map, so_pen_nomor AS pen FROM tsalesorder WHERE so_nomor = ?`,
        [nomor],
      );
      if (row?.map) backward.push({ type: "MAP", nomor: row.map });
      else if (row?.pen) backward.push({ type: "PENAWARAN", nomor: row.pen });

      // ✅ Terkonfirmasi dari spkFormService.js: SPK PPIC (spk_is_so=0)
      // selalu punya spk_so_ref yang nunjuk balik ke SO ini
      const [spkPpicRows] = await db.query(
        `SELECT spk_nomor AS nomor FROM tspk WHERE spk_so_ref = ? AND spk_is_so = 0`,
        [nomor],
      );
      spkPpicRows.forEach((r) => forward.push({ type: "SPK", nomor: r.nomor }));

      forward.push(...(await getForwardProduksiRelations(nomor)));
      break;
    }
    case "PROOF": {
      const [[row]] = await db.query(
        `SELECT pf_spk_nomor AS ref FROM tproofgarmen_hdr WHERE pf_nomor = ?`,
        [nomor],
      );
      if (row?.ref) {
        const resolved = await resolveProduksiNomor(row.ref);
        if (resolved) backward.push(resolved);
      }
      break;
    }
    case "SJ_MEMO": {
      const [mapRows] = await db.query(
        `SELECT DISTINCT sjd_mspk_nomor AS nomor FROM tsj_dtl_memo WHERE sjd_sj_nomor = ?`,
        [nomor],
      );
      mapRows.forEach((r) => backward.push({ type: "MAP", nomor: r.nomor }));
      break;
    }
    case "MKB": {
      const [[row]] = await db.query(
        `SELECT mkb_spk_nomor AS ref FROM tmkb_hdr WHERE mkb_nomor = ?`,
        [nomor],
      );
      if (row?.ref) {
        const resolved = await resolveProduksiNomor(row.ref);
        if (resolved) backward.push(resolved);
      }

      const [poRows] = await db.query(
        `SELECT DISTINCT mkbd2_po_nomor AS nomor FROM tmkb_dtl2 WHERE mkbd2_mkb_nomor = ? AND mkbd2_po_nomor <> ''`,
        [nomor],
      );
      poRows.forEach((r) => forward.push({ type: "PO", nomor: r.nomor }));
      break;
    }
    case "PO": {
      const [refRows] = await db.query(
        `SELECT DISTINCT pod_spk_nomor AS ref FROM tpo_dtl WHERE pod_po_nomor = ? AND pod_spk_nomor <> ''`,
        [nomor],
      );
      for (const r of refRows) {
        const resolved = await resolveProduksiNomor(r.ref);
        if (resolved) backward.push(resolved);
      }

      // Link balik ke MKB (kalau item PO ini di-generate dari MKB, lihat
      // poBahanFormService saveData: pod_mkb_nomor diisi dari item.mkb)
      const [mkbRefRows] = await db.query(
        `SELECT DISTINCT pod_mkb_nomor AS nomor FROM tpo_dtl WHERE pod_po_nomor = ? AND pod_mkb_nomor <> ''`,
        [nomor],
      );
      mkbRefRows.forEach((r) => backward.push({ type: "MKB", nomor: r.nomor }));

      const [bpbRows] = await db.query(
        `SELECT DISTINCT bpb_nomor AS nomor FROM tbpb_hdr WHERE bpb_po_nomor = ?`,
        [nomor],
      );
      bpbRows.forEach((r) => forward.push({ type: "BPB", nomor: r.nomor }));
      break;
    }
    case "BPB": {
      const [[row]] = await db.query(
        `SELECT bpb_po_nomor AS po FROM tbpb_hdr WHERE bpb_nomor = ?`,
        [nomor],
      );
      if (row?.po) backward.push({ type: "PO", nomor: row.po });

      const [voucherRows] = await db.query(
        `SELECT DISTINCT voud_vou_nomor AS nomor FROM tvoucher_dtl WHERE voud_nota = ? AND voud_type = 'BPB'`,
        [nomor],
      );
      voucherRows.forEach((r) =>
        forward.push({ type: "VOUCHER", nomor: r.nomor }),
      );
      break;
    }
    case "BPB_NON_BAHAN": {
      const [[row]] = await db.query(
        `SELECT bpb_po_nomor AS po, bpb_mb_nomor AS minta FROM tgarmenbpb_hdr WHERE bpb_nomor = ?`,
        [nomor],
      );
      if (row?.po) backward.push({ type: "PO_NON_BAHAN", nomor: row.po });
      else if (row?.minta)
        backward.push({ type: "PERMINTAAN_PEMBELIAN", nomor: row.minta });

      // ✅ Terkonfirmasi bpbGarmenFormService.js getDetailForm: level
      // detail bpbd_spk_nomor, ambigu SPK/MAP (JOIN ke tspk & tmemospk)
      const [spkRows] = await db.query(
        `SELECT DISTINCT bpbd_spk_nomor AS ref FROM tgarmenbpb_dtl WHERE bpbd_nomor = ? AND bpbd_spk_nomor <> ''`,
        [nomor],
      );
      for (const r of spkRows) {
        const resolved = await resolveProduksiNomor(r.ref);
        if (resolved) backward.push(resolved);
      }

      const [voucherRows] = await db.query(
        `SELECT DISTINCT voud_vou_nomor AS nomor FROM tvoucher_dtl WHERE voud_nota = ? AND voud_type = 'BPG'`,
        [nomor],
      );
      voucherRows.forEach((r) =>
        forward.push({ type: "VOUCHER", nomor: r.nomor }),
      );

      // ⚠️ BELUM DIKONFIRMASI: file bpbGarmenFormService.js juga
      // menyebut tgarmeniv_hdr.iv_bpb_nomor (untuk header.hasVoucher/
      // Noiv) — kemungkinan jalur invoice/voucher TERPISAH dari
      // tvoucher_hdr di atas, khusus garmen non-bahan. BELUM ditambah
      // sebagai edge/node karena belum ada source servicenya untuk
      // dipastikan strukturnya (node baru atau sama dengan VOUCHER).
      break;
    }
    case "VOUCHER": {
      const [rows] = await db.query(
        `SELECT DISTINCT voud_nota AS nomor, voud_type AS tipe FROM tvoucher_dtl WHERE voud_vou_nomor = ? AND voud_nota <> ''`,
        [nomor],
      );
      rows.forEach((r) => {
        if (r.tipe === "BPB") backward.push({ type: "BPB", nomor: r.nomor });
        else if (r.tipe === "BPG")
          backward.push({ type: "BPB_NON_BAHAN", nomor: r.nomor });
        else if (r.tipe === "BPJ")
          backward.push({ type: "BPJ", nomor: r.nomor });
        // tipe lain (RET/PJG/POE/MMT/BPE) di luar domain Relationship
        // Map ini (jasa potong bahan/eksternal/retur) — sengaja tidak dijadikan node
      });
      break;
    }
    case "STBJ": {
      const [refRows] = await db.query(
        `SELECT DISTINCT STBJD_SPK_Nomor AS ref FROM tstbj_dtl WHERE STBJD_STBJ_Nomor = ?`,
        [nomor],
      );
      for (const r of refRows) {
        const resolved = await resolveProduksiNomor(r.ref);
        if (resolved) backward.push(resolved);
      }
      break;
    }
    case "SJ": {
      const [refRows] = await db.query(
        `SELECT DISTINCT sjd_spk_nomor AS ref FROM tsj_dtl WHERE sjd_sj_nomor = ?`,
        [nomor],
      );
      for (const r of refRows) {
        const resolved = await resolveProduksiNomor(r.ref);
        if (resolved) backward.push(resolved);
      }

      // ✅ Terkonfirmasi suratJalanFormService.js: sjd_nokirim = FK ke
      // Jadwal Kirim asal baris SJ ini
      const [jadwalRows] = await db.query(
        `SELECT DISTINCT sjd_nokirim AS nomor FROM tsj_dtl WHERE sjd_sj_nomor = ? AND sjd_nokirim <> ''`,
        [nomor],
      );
      jadwalRows.forEach((r) =>
        backward.push({ type: "JADWAL_KIRIM", nomor: r.nomor }),
      );

      // ✅ Terkonfirmasi suratJalanFormService.js save(): sj_inv_pro
      // (header) = Invoice Proforma dasar pembuatan SJ ini
      const [[hdrRow]] = await db.query(
        `SELECT sj_inv_pro AS invPro FROM tsj_hdr WHERE sj_nomor = ?`,
        [nomor],
      );
      if (hdrRow?.invPro)
        backward.push({ type: "INVOICE", nomor: hdrRow.invPro });

      const [invRows] = await db.query(
        `SELECT DISTINCT invd_inv_nomor AS nomor FROM tinv_dtl WHERE invd_sj_nomor = ?`,
        [nomor],
      );
      invRows.forEach((r) => forward.push({ type: "INVOICE", nomor: r.nomor }));
      break;
    }
    case "SJ_TAK_NORMAL": {
      const [refRows] = await db.query(
        `SELECT DISTINCT sjd_spk_nomor AS ref FROM tsj_dtl_bayangan WHERE sjd_sj_nomor = ? AND sjd_spk_nomor <> ''`,
        [nomor],
      );
      for (const r of refRows) {
        // ⚠️ sjd_spk_nomor ambigu SPK vs tbarang biasa (LEFT JOIN
        // tbarang di checkNomor/getDataCetak) — kalau bukan SPK/SO/MAP,
        // sengaja tidak ada backward yang ditambahkan.
        const resolved = await resolveProduksiNomor(r.ref);
        if (resolved) backward.push(resolved);
      }

      const [[hdrRow]] = await db.query(
        `SELECT sj_inv_pro AS invPro FROM tsj_hdr_bayangan WHERE sj_nomor = ?`,
        [nomor],
      );
      if (hdrRow?.invPro)
        backward.push({ type: "INVOICE", nomor: hdrRow.invPro });
      break;
    }
    case "INVOICE": {
      const [rows] = await db.query(
        `SELECT DISTINCT invd_sj_nomor AS sj, invd_spk_nomor AS ref FROM tinv_dtl WHERE invd_inv_nomor = ?`,
        [nomor],
      );
      const seenSj = new Set();
      const seenRef = new Set();
      for (const r of rows) {
        if (r.sj && !seenSj.has(r.sj)) {
          seenSj.add(r.sj);
          backward.push({ type: "SJ", nomor: r.sj });
        }
        if (r.ref && !seenRef.has(r.ref)) {
          seenRef.add(r.ref);
          const resolved = await resolveProduksiNomor(r.ref);
          if (resolved) backward.push(resolved);
        }
      }

      // ✅ Terkonfirmasi invTakNormalFormService.js: tinv_flag.invf_normal
      // menandai invoice normal ini sudah "dinaungi" sebuah Invoice
      // Tak Normal (invf_taknormal). Satu Invoice Normal cuma bisa
      // dinaungi 1 Tak Normal (inv_flag=1 exclusive lock, lihat
      // validateInvoiceNormal), jadi forward-nya paling banyak 1 baris.
      const [[flagRow]] = await db.query(
        `SELECT invf_taknormal AS nomor FROM tinv_flag WHERE invf_normal = ?`,
        [nomor],
      );
      if (flagRow?.nomor)
        forward.push({ type: "INVOICE_TAK_NORMAL", nomor: flagRow.nomor });

      // ✅ Terkonfirmasi pelunasanFormService.js getInfoInvoice:
      // piutang_kredit_detail.nota = Invoice ini
      const [pelunasanRows] = await db.query(
        `SELECT DISTINCT nomor AS nomor FROM piutang_kredit_detail WHERE nota = ?`,
        [nomor],
      );
      pelunasanRows.forEach((r) =>
        forward.push({ type: "PELUNASAN_PIUTANG", nomor: r.nomor }),
      );
      break;
    }
    case "PERMINTAAN_BAHAN": {
      const [[row]] = await db.query(
        `SELECT min_spk_nomor AS ref FROM tmintabahan_hdr WHERE min_nomor = ?`,
        [nomor],
      );
      if (row?.ref) {
        const resolved = await resolveProduksiNomor(row.ref);
        if (resolved) backward.push(resolved);
      }

      const [realisasiRows] = await db.query(
        `SELECT promin_nomor AS nomor FROM tproduksiminta_hdr WHERE promin_minta = ?`,
        [nomor],
      );
      realisasiRows.forEach((r) =>
        forward.push({ type: "REALISASI_MINTA_BAHAN", nomor: r.nomor }),
      );
      break;
    }
    case "REALISASI_MINTA_BAHAN": {
      const [[row]] = await db.query(
        `SELECT promin_minta AS minta, promin_spk_nomor AS spkRef, promin_mkb AS mkbRef FROM tproduksiminta_hdr WHERE promin_nomor = ?`,
        [nomor],
      );
      if (row?.minta)
        backward.push({ type: "PERMINTAAN_BAHAN", nomor: row.minta });

      // ⚠️ Field tambahan yang diisi langsung saat create (saveData),
      // paralel dengan promin_minta -> PERMINTAAN_BAHAN, bukan
      // pengganti. Konsisten dengan pola edge paralel yang sudah ada
      // (mis. MH+Penawaran -> MAP).
      if (row?.spkRef) {
        const resolvedSpk = await resolveProduksiNomor(row.spkRef);
        if (resolvedSpk) backward.push(resolvedSpk);
      }
      if (row?.mkbRef) backward.push({ type: "MKB", nomor: row.mkbRef });

      const [retlRows] = await db.query(
        `SELECT DISTINCT proretd_proret_nomor AS nomor FROM tproduksireturlog_dtl WHERE proretd_nominta = ?`,
        [nomor],
      );
      retlRows.forEach((r) =>
        forward.push({ type: "RETUR_LOG", nomor: r.nomor }),
      );

      // ✅ Terkonfirmasi bpbJasaFormService.js getById: h.bpj_nomaterial
      // eksplisit ada di tbpj_hdr, match ke promin_nomor. Sibling
      // dari edge ke MUTASI_PRODUKSI (mph_nomaterial) di atas — jasa
      // luar dan mutasi internal sama-sama bisa konsumsi 1 realisasi
      // bahan yang sama.
      const [bpjRows] = await db.query(
        `SELECT bpj_nomor AS nomor FROM tbpj_hdr WHERE bpj_nomaterial = ?`,
        [nomor],
      );
      bpjRows.forEach((r) => forward.push({ type: "BPJ", nomor: r.nomor }));

      break;
    }
    case "RETUR_LOG": {
      const [rows] = await db.query(
        `SELECT DISTINCT proretd_nominta AS nominta, proretd_spk AS spk
         FROM tproduksireturlog_dtl WHERE proretd_proret_nomor = ?`,
        [nomor],
      );
      const seenMinta = new Set();
      const seenSpk = new Set();
      for (const r of rows) {
        if (r.nominta && !seenMinta.has(r.nominta)) {
          seenMinta.add(r.nominta);
          backward.push({ type: "REALISASI_MINTA_BAHAN", nomor: r.nominta });
        }
        if (r.spk && !seenSpk.has(r.spk)) {
          seenSpk.add(r.spk);
          const resolved = await resolveProduksiNomor(r.spk);
          if (resolved) backward.push(resolved);
        }
      }

      const [retpRows] = await db.query(
        `SELECT proret_nomor AS nomor FROM tproduksiretur_hdr WHERE proret_log = ?`,
        [nomor],
      );
      retpRows.forEach((r) =>
        forward.push({ type: "RETUR_BAHAN", nomor: r.nomor }),
      );
      break;
    }
    case "RETUR_BAHAN": {
      const [[row]] = await db.query(
        `SELECT proret_log AS logRef FROM tproduksiretur_hdr WHERE proret_nomor = ?`,
        [nomor],
      );
      if (row?.logRef) backward.push({ type: "RETUR_LOG", nomor: row.logRef });

      const [spkRows] = await db.query(
        `SELECT DISTINCT proretd_spk AS spk FROM tproduksiretur_dtl WHERE proretd_proret_nomor = ? AND proretd_spk <> ''`,
        [nomor],
      );
      for (const r of spkRows) {
        const resolved = await resolveProduksiNomor(r.spk);
        if (resolved) backward.push(resolved);
      }
      break;
    }
    case "MKA": {
      const [[row]] = await db.query(
        `SELECT mkb_spk_nomor AS spk FROM tmka_hdr WHERE mkb_nomor = ?`,
        [nomor],
      );
      if (row?.spk) backward.push({ type: "SPK", nomor: row.spk });

      // ✅ Terkonfirmasi garmenRealisasiFormService.js saveData:
      // re_mka diisi LANGSUNG merujuk ke tmka_hdr.mkb_nomor — edge
      // langsung MKA->Realisasi, terpisah/paralel dari rantai
      // re_minta->PermintaanGarmen->Realisasi.
      const [realisasiRows] = await db.query(
        `SELECT re_nomor AS nomor FROM tgarmenrealisasi_hdr WHERE re_mka = ?`,
        [nomor],
      );
      realisasiRows.forEach((r) =>
        forward.push({ type: "REALISASI_GARMEN", nomor: r.nomor }),
      );
      break;
    }
    case "PERMINTAAN_GARMEN": {
      const [[row]] = await db.query(
        `SELECT min_spk_nomor AS ref FROM tgarmenminta_hdr WHERE min_nomor = ?`,
        [nomor],
      );
      if (row?.ref) {
        const resolved = await resolveProduksiNomor(row.ref);
        if (resolved) backward.push(resolved);
      }

      const [realisasiRows] = await db.query(
        `SELECT re_nomor AS nomor FROM tgarmenrealisasi_hdr WHERE re_minta = ?`,
        [nomor],
      );
      realisasiRows.forEach((r) =>
        forward.push({ type: "REALISASI_GARMEN", nomor: r.nomor }),
      );
      break;
    }
    case "REALISASI_GARMEN": {
      const [[row]] = await db.query(
        `SELECT re_minta AS minta, re_spk_nomor AS spkRef, re_mka AS mka FROM tgarmenrealisasi_hdr WHERE re_nomor = ?`,
        [nomor],
      );
      if (row?.minta)
        backward.push({ type: "PERMINTAAN_GARMEN", nomor: row.minta });

      if (row?.spkRef) {
        const resolved = await resolveProduksiNomor(row.spkRef);
        if (resolved) backward.push(resolved);
      }
      if (row?.mka) backward.push({ type: "MKA", nomor: row.mka });
      break;
    }
    case "PERMINTAAN_PEMBELIAN": {
      // ⚠️ Tidak ada backward ke SPK/MKA/Permintaan Garmen — belum
      // ketemu kolom penghubungnya di tgarmenmintabeli_hdr. Jangan
      // ditambah sampai ada bukti.

      // ⚠️ CEK PREFIX DB Finance ERP untuk tkasbonitem2
      const [kasbonRows] = await db.query(
        `SELECT DISTINCT bond2_nomor AS nomor FROM finance.tkasbonitem2 WHERE bond2_link = ?`,
        [nomor],
      );
      kasbonRows.forEach((r) =>
        forward.push({ type: "KASBON", nomor: r.nomor }),
      );

      const [mutasiOutRows] = await db.query(
        `SELECT DISTINCT msod_nomor AS nomor FROM tgarmenmso_dtl WHERE msod_mb_nomor = ?`,
        [nomor],
      );
      mutasiOutRows.forEach((r) =>
        forward.push({ type: "MUTASI_OUT", nomor: r.nomor }),
      );

      // ✅ Terkonfirmasi poGarmenFormService.js: po_mb_nomor selalu
      // diisi saat create (jalur PO/pesan-dulu untuk barang non-bahan)
      const [poNonBahanRows] = await db.query(
        `SELECT po_nomor AS nomor FROM tgarmenpo_hdr WHERE po_mb_nomor = ?`,
        [nomor],
      );
      poNonBahanRows.forEach((r) =>
        forward.push({ type: "PO_NON_BAHAN", nomor: r.nomor }),
      );

      // ✅ Terkonfirmasi bpbGarmenFormService.js: bpb_mb_nomor bisa
      // diisi LANGSUNG (jalur kasbon/bayar-nanti, bypass PO Non Bahan)
      const [bpbLangsungRows] = await db.query(
        `SELECT bpb_nomor AS nomor FROM tgarmenbpb_hdr WHERE bpb_mb_nomor = ? AND bpb_po_nomor = ''`,
        [nomor],
      );
      bpbLangsungRows.forEach((r) =>
        forward.push({ type: "BPB_NON_BAHAN", nomor: r.nomor }),
      );
      break;
    }
    case "KASBON": {
      const [permintaanRows] = await db.query(
        `SELECT DISTINCT bond2_link AS nomor FROM finance.tkasbonitem2 WHERE bond2_nomor = ? AND bond2_link LIKE 'MB%'`,
        [nomor],
      );
      permintaanRows.forEach((r) =>
        backward.push({ type: "PERMINTAAN_PEMBELIAN", nomor: r.nomor }),
      );
      break;
    }
    case "MUTASI_OUT": {
      const [permintaanRows] = await db.query(
        `SELECT DISTINCT msod_mb_nomor AS nomor FROM tgarmenmso_dtl WHERE msod_nomor = ? AND msod_mb_nomor <> ''`,
        [nomor],
      );
      permintaanRows.forEach((r) =>
        backward.push({ type: "PERMINTAAN_PEMBELIAN", nomor: r.nomor }),
      );
      break;
    }
    case "PO_NON_BAHAN": {
      const [[row]] = await db.query(
        `SELECT po_mb_nomor AS ref FROM tgarmenpo_hdr WHERE po_nomor = ?`,
        [nomor],
      );
      if (row?.ref)
        backward.push({ type: "PERMINTAAN_PEMBELIAN", nomor: row.ref });

      const [bpbRows] = await db.query(
        `SELECT bpb_nomor AS nomor FROM tgarmenbpb_hdr WHERE bpb_po_nomor = ?`,
        [nomor],
      );
      bpbRows.forEach((r) =>
        forward.push({ type: "BPB_NON_BAHAN", nomor: r.nomor }),
      );
      break;
    }
    case "MUTASI_PRODUKSI": {
      const [[row]] = await db.query(
        `SELECT MPH_SPK_nomor AS spk, mph_nomaterial AS material, mph_nomor_opr AS opr,
                mph_gdgtujuan AS gdgTujuan
         FROM tmutasiproduksi_hdr WHERE MPH_nomor = ?`,
        [nomor],
      );
      if (row?.spk) {
        const resolved = await resolveProduksiNomor(row.spk);
        if (resolved) backward.push(resolved);
      }
      if (row?.material) {
        backward.push({ type: "REALISASI_MINTA_BAHAN", nomor: row.material });
      }
      if (row?.opr) {
        backward.push({ type: "SJ_PO_INTERNAL", nomor: row.opr });
      }

      // ⚠️ ASUMSI (derived, bukan FK asli): kalau MP ini tahap
      // "Lipat -> Koli/Finishing" (gudang tujuan GP013/GP020),
      // tarik STBJ untuk SPK yang sama sebagai forward di sini —
      // bukan lagi backward langsung dari SPK.
      if (row?.spk && row?.gdgTujuan && KOLI_TUJUAN_GDG.has(row.gdgTujuan)) {
        const [stbjRows] = await db.query(
          `SELECT DISTINCT STBJD_STBJ_Nomor AS nomor FROM tstbj_dtl WHERE STBJD_SPK_Nomor = ?`,
          [row.spk],
        );
        stbjRows.forEach((r) => forward.push({ type: "STBJ", nomor: r.nomor }));
      }
      break;
    }
    case "PO_JASA": {
      const [[row]] = await db.query(
        `SELECT pojh_spk_nomor AS ref FROM tpojasa_hdr WHERE pojh_nomor = ?`,
        [nomor],
      );
      if (row?.ref) {
        const resolved = await resolveProduksiNomor(row.ref);
        if (resolved) backward.push(resolved);
      }

      const [bpjRows] = await db.query(
        `SELECT bpj_nomor AS nomor FROM tbpj_hdr WHERE bpj_po_nomor = ?`,
        [nomor],
      );
      bpjRows.forEach((r) => forward.push({ type: "BPJ", nomor: r.nomor }));

      // ⚠️ ASUMSI (derived join, BUKAN FK langsung): cari gudang
      // tujuan untuk jenis jasa PO ini (pojh_jasa_kode -> tjasa.jasa_ket
      // -> tgudangproduksi.gdgp_jasa), filter cab + exclude QC persis
      // seperti getJasaList di bpjJasaFormService.js. Lalu cocokkan ke
      // Mutasi Produksi dengan SPK & gudang tujuan yang sama — misal
      // PO Jasa Jahit -> gudang Jahit -> Mutasi Produksi "... ke Jahit"
      // untuk SPK yang sama. Kalau ada >1 gudang match per jasa/cab,
      // cuma ambil yang pertama (LIMIT 1) — perlu verifikasi manual
      // kalau ternyata hasilnya salah gudang.
      if (row?.ref) {
        const [[gudangRow]] = await db.query(
          `SELECT g.gdgp_kode AS kode
           FROM tpojasa_hdr h
           INNER JOIN tjasa j ON j.jasa_kode = h.pojh_jasa_kode
           INNER JOIN tgudangproduksi g
             ON g.gdgp_jasa = j.jasa_ket AND g.gdgp_cab = h.pojh_cab
           WHERE h.pojh_nomor = ?
             AND g.gdgp_aktif = 0
             AND g.gdgp_nama NOT LIKE '%QC%'
           LIMIT 1`,
          [nomor],
        );
        if (gudangRow?.kode) {
          const [mpRows] = await db.query(
            `SELECT MPH_nomor AS nomor
             FROM tmutasiproduksi_hdr
             WHERE MPH_SPK_nomor = ? AND mph_gdgtujuan = ?`,
            [row.ref, gudangRow.kode],
          );
          mpRows.forEach((r) =>
            forward.push({ type: "MUTASI_PRODUKSI", nomor: r.nomor }),
          );
        }
      }
      break;
    }

    case "BPJ": {
      const [[row]] = await db.query(
        `SELECT bpj_po_nomor AS po, bpj_nomaterial AS material FROM tbpj_hdr WHERE bpj_nomor = ?`,
        [nomor],
      );
      if (row?.po) backward.push({ type: "PO_JASA", nomor: row.po });
      if (row?.material)
        backward.push({ type: "REALISASI_MINTA_BAHAN", nomor: row.material });

      // ✅ Terkonfirmasi bpbJasaFormService.js (getById/save): level
      // detail bpjd_spk, mirip pola BPB Bahan/Non-Bahan — ambigu
      // SPK/MAP, dicek terpisah dari backward via PO_JASA di atas.
      const [spkRows] = await db.query(
        `SELECT DISTINCT bpjd_spk AS ref FROM tbpj_dtl WHERE bpjd_bpj_nomor = ? AND bpjd_spk <> ''`,
        [nomor],
      );
      for (const r of spkRows) {
        const resolved = await resolveProduksiNomor(r.ref);
        if (resolved) backward.push(resolved);
      }

      const [voucherRows] = await db.query(
        `SELECT DISTINCT voud_vou_nomor AS nomor FROM tvoucher_dtl WHERE voud_nota = ? AND voud_type = 'BPJ'`,
        [nomor],
      );
      voucherRows.forEach((r) =>
        forward.push({ type: "VOUCHER", nomor: r.nomor }),
      );
      break;
    }

    case "PO_INTERNAL": {
      const [[row]] = await db.query(
        `SELECT poi_spk_nomor AS spk, poi_jasa_kode AS jasaKode, poi_sup AS supCab FROM tpointernal_hdr WHERE poi_nomor = ?`,
        [nomor],
      );
      if (row?.spk) {
        const resolved = await resolveProduksiNomor(row.spk);
        if (resolved) backward.push(resolved);
      }

      const [sjRows] = await db.query(
        `SELECT poisj_nomor AS nomor FROM tpointernalsj_hdr WHERE poisj_nomorpo = ?`,
        [nomor],
      );
      sjRows.forEach((r) =>
        forward.push({ type: "SJ_PO_INTERNAL", nomor: r.nomor }),
      );

      // ⚠️ ASUMSI (derived, pola sama dengan PO_JASA): tebak gudang
      // produksi tujuan dari jasa_ket -> tgudangproduksi.gdgp_nama2,
      // cabang = poi_sup (pabrik tujuan PO Internal ini), diteruskan
      // via LINI_TUJUAN_MAP (peta rantai hardcode factory-specific
      // dari poInternalSjFormService.js) buat dapat lini QC tujuan
      // akhir. Dipakai buat prediksi Mutasi Produksi SEBELUM SJ+Approve
      // beneran dibuat. Begitu SJ sudah ada, edge EKSAK di case
      // SJ_PO_INTERNAL (via mph_nomor_opr) jauh lebih bisa diandalkan
      // — ini cuma pelengkap awal.
      if (row?.spk && row?.jasaKode && row?.supCab) {
        const [[jasaRow]] = await db.query(
          `SELECT jasa_ket FROM tjasa WHERE jasa_kode = ?`,
          [row.jasaKode],
        );
        if (jasaRow?.jasa_ket) {
          const [[gudangRow]] = await db.query(
            `SELECT gdgp_kode FROM tgudangproduksi
             WHERE gdgp_aktif = 0 AND gdgp_nama2 LIKE ? AND gdgp_cab = ?
             ORDER BY gdgp_kode LIMIT 1`,
            [`%${jasaRow.jasa_ket}%`, row.supCab],
          );
          const LINI_TUJUAN_MAP = {
            GP015: "GP012",
            GP001: "GP021",
            GP017: "GP010",
            GP002: "GP022",
            GP018: "GP004",
            GP003: "GP019",
            GP019: "GP013",
            GP004: "GP020",
          };
          const tujuanKode = gudangRow?.gdgp_kode
            ? LINI_TUJUAN_MAP[gudangRow.gdgp_kode]
            : null;
          if (tujuanKode) {
            const [mpRows] = await db.query(
              `SELECT MPH_nomor AS nomor FROM tmutasiproduksi_hdr WHERE MPH_SPK_nomor = ? AND mph_gdgtujuan = ?`,
              [row.spk, tujuanKode],
            );
            mpRows.forEach((r) =>
              forward.push({ type: "MUTASI_PRODUKSI", nomor: r.nomor }),
            );
          }
        }
      }
      break;
    }

    case "SJ_PO_INTERNAL": {
      const [[row]] = await db.query(
        `SELECT poisj_nomorpo AS po FROM tpointernalsj_hdr WHERE poisj_nomor = ?`,
        [nomor],
      );
      if (row?.po) backward.push({ type: "PO_INTERNAL", nomor: row.po });

      // ✅ Terkonfirmasi poInternalSjApproveService.js saveApprove:
      // mph_nomor_opr = poisj_nomor, FK LANGSUNG (bukan derived) —
      // hanya terisi kalau SJ ini di-approve TANPA centang CMT (CMT
      // skip total pembuatan Mutasi Produksi).
      const [mpRows] = await db.query(
        `SELECT MPH_nomor AS nomor FROM tmutasiproduksi_hdr WHERE mph_nomor_opr = ?`,
        [nomor],
      );
      mpRows.forEach((r) =>
        forward.push({ type: "MUTASI_PRODUKSI", nomor: r.nomor }),
      );
      break;
    }

    case "JADWAL_KIRIM": {
      const [[row]] = await db.query(
        `SELECT spk_nomor AS spk, jk_plan_nomor AS planNomor FROM tjadwalkirim WHERE Nomor_Kirim = ?`,
        [nomor],
      );
      if (row?.spk) {
        const resolved = await resolveProduksiNomor(row.spk);
        if (resolved) backward.push(resolved);
      }

      // ✅ Terkonfirmasi jadwalKirimFormService.js save(): jk_plan_nomor
      // FK asli ke tplan_ppic_hdr.pl_nomor (procedure isiplan)
      if (row?.planNomor) {
        backward.push({
          type: "PLANNING_PPIC",
          nomor: row.planNomor,
          filterSpk: row.spk || undefined,
        });
      }

      // ✅ Terkonfirmasi suratJalanFormService.js: tsj_dtl.sjd_nokirim
      // = Nomor_Kirim (level detail), FK asli
      const [sjRows] = await db.query(
        `SELECT DISTINCT sjd_sj_nomor AS nomor FROM tsj_dtl WHERE sjd_nokirim = ?`,
        [nomor],
      );
      sjRows.forEach((r) => forward.push({ type: "SJ", nomor: r.nomor }));
      break;
    }

    case "INVOICE_TAK_NORMAL": {
      // ✅ Terkonfirmasi invTakNormalFormService.js: satu Tak Normal
      // wajib menaungi >=1 Invoice Normal (validasi save: "Invoice
      // normal belum ditunjuk"), via tinv_flag.invf_taknormal=nomor
      const [flagRows] = await db.query(
        `SELECT invf_normal AS nomor FROM tinv_flag WHERE invf_taknormal = ?`,
        [nomor],
      );
      flagRows.forEach((r) =>
        backward.push({ type: "INVOICE", nomor: r.nomor }),
      );
      break;
    }

    case "PENERIMAAN_PIUTANG": {
      // ✅ Terkonfirmasi pelunasanFormService.js getInfoPembayaran:
      // piutang_kredit_detail.no_bukti = terima_bayar_debet.nomor
      // (kecuali prefix RET, itu retur penjualan — di luar scope
      // Relationship Map ini, tidak ada node RETUR_PENJUALAN)
      const [pelunasanRows] = await db.query(
        `SELECT DISTINCT nomor AS nomor FROM piutang_kredit_detail WHERE no_bukti = ?`,
        [nomor],
      );
      pelunasanRows.forEach((r) =>
        forward.push({ type: "PELUNASAN_PIUTANG", nomor: r.nomor }),
      );
      break;
    }

    case "PELUNASAN_PIUTANG": {
      const [rows] = await db.query(
        `SELECT DISTINCT nota, no_bukti FROM piutang_kredit_detail WHERE nomor = ?`,
        [nomor],
      );
      const seenNota = new Set();
      const seenBukti = new Set();
      for (const r of rows) {
        if (r.nota && !seenNota.has(r.nota)) {
          seenNota.add(r.nota);
          backward.push({ type: "INVOICE", nomor: r.nota });
        }
        // ⚠️ no_bukti bisa berupa nomor Retur (prefix RET) — di luar
        // domain graph ini, sengaja tidak ditambahkan sebagai backward
        if (
          r.no_bukti &&
          !r.no_bukti.toUpperCase().startsWith("RET") &&
          !seenBukti.has(r.no_bukti)
        ) {
          seenBukti.add(r.no_bukti);
          backward.push({ type: "PENERIMAAN_PIUTANG", nomor: r.no_bukti });
        }
      }
      break;
    }

    default:
      throw new Error(`Tipe node tidak dikenali: ${type}`);
  }

  return { backward, forward };
};

const expand = async (type, nomor) => {
  if (!NODE_TYPES.includes(type))
    throw new Error(`Tipe node tidak dikenali: ${type}`);
  const node = await getNodeDetail(type, nomor);
  if (!node)
    throw new Error(`Data ${type} dengan nomor "${nomor}" tidak ditemukan.`);

  const related = await getRelated(type, nomor);

  const withContext = (r) =>
    r.filterSpk ? { filterSpk: r.filterSpk } : undefined;

  const [backwardDetails, forwardDetails] = await Promise.all([
    Promise.all(
      related.backward.map((r) =>
        getNodeDetail(r.type, r.nomor, withContext(r)),
      ),
    ),
    Promise.all(
      related.forward.map((r) =>
        getNodeDetail(r.type, r.nomor, withContext(r)),
      ),
    ),
  ]);

  return {
    node,
    backward: backwardDetails.filter(Boolean),
    forward: forwardDetails.filter(Boolean),
  };
};

const search = async (type, query) => {
  if (!query) return [];
  const like = `%${query}%`;
  const limit = 20;

  const queries = {
    PERMINTAAN_HARGA: `SELECT mh_nomor AS nomor, mh_nama AS label, mh_tanggal AS tgl FROM tmintaharga WHERE mh_nomor LIKE ? ORDER BY mh_tanggal DESC LIMIT ${limit}`,
    PENAWARAN: `SELECT pen_nomor AS nomor, pen_keterangan AS label, pen_tanggal AS tgl FROM tpenawaran_hdr WHERE pen_nomor LIKE ? ORDER BY pen_tanggal DESC LIMIT ${limit}`,
    MAP: `SELECT mspk_nomor AS nomor, mspk_nama AS label, mspk_tanggal AS tgl FROM tmemospk WHERE mspk_nomor LIKE ? ORDER BY mspk_tanggal DESC LIMIT ${limit}`,
    SPK: `SELECT spk_nomor AS nomor, spk_nama AS label, spk_tanggal AS tgl FROM tspk WHERE spk_nomor LIKE ? AND spk_aktif = 'Y' ORDER BY spk_tanggal DESC LIMIT ${limit}`,
    SO: `SELECT so_nomor AS nomor, so_nama AS label, so_tanggal AS tgl FROM tsalesorder WHERE so_nomor LIKE ? AND so_aktif = 'Y' ORDER BY so_tanggal DESC LIMIT ${limit}`,
    PROOF: `SELECT pf_nomor AS nomor, pf_nomor AS label, pf_tanggal AS tgl FROM tproofgarmen_hdr WHERE pf_nomor LIKE ? ORDER BY pf_tanggal DESC LIMIT ${limit}`,
    SJ_MEMO: `SELECT sj_nomor AS nomor, sj_nomor AS label, sj_tanggal AS tgl FROM tsj_hdr_memo WHERE sj_nomor LIKE ? ORDER BY sj_tanggal DESC LIMIT ${limit}`,
    PO: `SELECT po_nomor AS nomor, po_nomor AS label, po_tanggal AS tgl FROM tpo_hdr WHERE po_nomor LIKE ? ORDER BY po_tanggal DESC LIMIT ${limit}`,
    BPB: `SELECT bpb_nomor AS nomor, bpb_nomor AS label, bpb_tanggal AS tgl FROM tbpb_hdr WHERE bpb_nomor LIKE ? ORDER BY bpb_tanggal DESC LIMIT ${limit}`,
    BPB_NON_BAHAN: `SELECT bpb_nomor AS nomor, bpb_ket AS label, bpb_tanggal AS tgl FROM tgarmenbpb_hdr WHERE bpb_nomor LIKE ? ORDER BY bpb_tanggal DESC LIMIT ${limit}`,
    STBJ: `SELECT stbj_nomor AS nomor, stbj_nomor AS label, stbj_tanggal AS tgl FROM tstbj_hdr WHERE stbj_nomor LIKE ? ORDER BY stbj_tanggal DESC LIMIT ${limit}`,
    SJ: `SELECT sj_nomor AS nomor, sj_nomor AS label, sj_tanggal AS tgl FROM tsj_hdr WHERE sj_nomor LIKE ? ORDER BY sj_tanggal DESC LIMIT ${limit}`,
    INVOICE: `SELECT inv_nomor AS nomor, inv_nomor AS label, inv_tanggal AS tgl FROM tinv_hdr WHERE inv_nomor LIKE ? ORDER BY inv_tanggal DESC LIMIT ${limit}`,
    MKB: `SELECT mkb_nomor AS nomor, mkb_note AS label, mkb_tanggal AS tgl FROM tmkb_hdr WHERE mkb_nomor LIKE ? ORDER BY mkb_tanggal DESC LIMIT ${limit}`,
    VOUCHER: `SELECT vou_nomor AS nomor, vou_keterangan AS label, vou_tanggal AS tgl FROM tvoucher_hdr WHERE vou_nomor LIKE ? ORDER BY vou_tanggal DESC LIMIT ${limit}`,
    PLANNING_PPIC: `SELECT pl_nomor AS nomor, pl_keterangan AS label, pl_tgl1 AS tgl FROM tplan_ppic_hdr WHERE pl_nomor LIKE ? ORDER BY pl_tgl1 DESC LIMIT ${limit}`,
    PERMINTAAN_BAHAN: `SELECT min_nomor AS nomor, min_ket AS label, min_tanggal AS tgl FROM tmintabahan_hdr WHERE min_nomor LIKE ? ORDER BY min_tanggal DESC LIMIT ${limit}`,
    REALISASI_MINTA_BAHAN: `SELECT promin_nomor AS nomor, promin_keterangan AS label, promin_tanggal AS tgl FROM tproduksiminta_hdr WHERE promin_nomor LIKE ? ORDER BY promin_tanggal DESC LIMIT ${limit}`,
    RETUR_LOG: `SELECT proret_nomor AS nomor, proret_keterangan AS label, proret_tanggal AS tgl FROM tproduksireturlog_hdr WHERE proret_nomor LIKE ? ORDER BY proret_tanggal DESC LIMIT ${limit}`,
    RETUR_BAHAN: `SELECT proret_nomor AS nomor, proret_keterangan AS label, proret_tanggal AS tgl FROM tproduksiretur_hdr WHERE proret_nomor LIKE ? ORDER BY proret_tanggal DESC LIMIT ${limit}`,
    MKA: `SELECT mkb_nomor AS nomor, mkb_note AS label, mkb_tanggal AS tgl FROM tmka_hdr WHERE mkb_nomor LIKE ? ORDER BY mkb_tanggal DESC LIMIT ${limit}`,
    PERMINTAAN_GARMEN: `SELECT min_nomor AS nomor, min_ket AS label, min_tanggal AS tgl FROM tgarmenminta_hdr WHERE min_nomor LIKE ? ORDER BY min_tanggal DESC LIMIT ${limit}`,
    REALISASI_GARMEN: `SELECT re_nomor AS nomor, re_keterangan AS label, re_tanggal AS tgl FROM tgarmenrealisasi_hdr WHERE re_nomor LIKE ? ORDER BY re_tanggal DESC LIMIT ${limit}`,
    PERMINTAAN_PEMBELIAN: `SELECT mb_nomor AS nomor, mb_ket AS label, mb_tanggal AS tgl FROM tgarmenmintabeli_hdr WHERE mb_nomor LIKE ? ORDER BY mb_tanggal DESC LIMIT ${limit}`,
    KASBON: `SELECT bon_nomor AS nomor, bon_keterangan AS label, bon_tanggal AS tgl FROM finance.tkasbon WHERE bon_nomor LIKE ? ORDER BY bon_tanggal DESC LIMIT ${limit}`,
    MUTASI_OUT: `SELECT mso_nomor AS nomor, mso_ket AS label, mso_tanggal AS tgl FROM tgarmenmso_hdr WHERE mso_nomor LIKE ? ORDER BY mso_tanggal DESC LIMIT ${limit}`,
    PO_NON_BAHAN: `SELECT po_nomor AS nomor, po_ket AS label, po_tanggal AS tgl FROM tgarmenpo_hdr WHERE po_nomor LIKE ? ORDER BY po_tanggal DESC LIMIT ${limit}`,
    MUTASI_PRODUKSI: `SELECT MPH_nomor AS nomor, MPH_keterangan AS label, mph_tanggal AS tgl FROM tmutasiproduksi_hdr WHERE MPH_nomor LIKE ? ORDER BY mph_tanggal DESC LIMIT ${limit}`,
    PO_JASA: `SELECT pojh_nomor AS nomor, pojh_keterangan AS label, pojh_tanggal AS tgl FROM tpojasa_hdr WHERE pojh_nomor LIKE ? ORDER BY pojh_tanggal DESC LIMIT ${limit}`,
    BPJ: `SELECT bpj_nomor AS nomor, bpj_nomor AS label, bpj_tanggal AS tgl FROM tbpj_hdr WHERE bpj_nomor LIKE ? ORDER BY bpj_tanggal DESC LIMIT ${limit}`,
    PO_INTERNAL: `SELECT poi_nomor AS nomor, poi_ket AS label, poi_tanggal AS tgl FROM tpointernal_hdr WHERE poi_nomor LIKE ? ORDER BY poi_tanggal DESC LIMIT ${limit}`,
    SJ_PO_INTERNAL: `SELECT poisj_nomor AS nomor, poisj_ket AS label, poisj_tanggal AS tgl FROM tpointernalsj_hdr WHERE poisj_nomor LIKE ? ORDER BY poisj_tanggal DESC LIMIT ${limit}`,
    JADWAL_KIRIM: `SELECT Nomor_Kirim AS nomor, Gudang AS label, Tanggal AS tgl FROM tjadwalkirim WHERE Nomor_Kirim LIKE ? ORDER BY Tanggal DESC LIMIT ${limit}`,
    SJ_TAK_NORMAL: `SELECT sj_nomor AS nomor, sj_keterangan AS label, sj_tanggal AS tgl FROM tsj_hdr_bayangan WHERE sj_nomor LIKE ? ORDER BY sj_tanggal DESC LIMIT ${limit}`,
    INVOICE_TAK_NORMAL: `SELECT inv_nomor AS nomor, inv_keterangan AS label, inv_tanggal AS tgl FROM tinv_hdr WHERE inv_nomor LIKE ? AND inv_sts_pro = 2 ORDER BY inv_tanggal DESC LIMIT ${limit}`,
    PENERIMAAN_PIUTANG: `SELECT nomor AS nomor, notes AS label, tanggal AS tgl FROM terima_bayar_debet WHERE nomor LIKE ? ORDER BY tanggal DESC LIMIT ${limit}`,
    PELUNASAN_PIUTANG: `SELECT nomor AS nomor, notes AS label, tanggal AS tgl FROM piutang_kredit_header WHERE nomor LIKE ? ORDER BY tanggal DESC LIMIT ${limit}`,
  };

  if (type && queries[type]) {
    const [rows] = await db.query(queries[type], [like]);
    return rows.map((r) => ({
      type,
      nomor: r.nomor,
      label: r.label || r.nomor,
    }));
  }

  // "Semua Tipe" — search paralel ke semua tabel, gabung, urut
  // tanggal terbaru, potong ke limit gabungan. Sebelumnya bug: cuma
  // fallback ke SPK doang, jadi tipe lain (termasuk MAP) gak pernah
  // ketemu saat dropdown di "Semua Tipe".
  const entries = Object.entries(queries);
  const results = await Promise.all(
    entries.map(async ([t, sql]) => {
      const [rows] = await db.query(sql, [like]);
      return rows.map((r) => ({
        type: t,
        nomor: r.nomor,
        label: r.label || r.nomor,
        tgl: r.tgl,
      }));
    }),
  );

  return results
    .flat()
    .sort((a, b) => new Date(b.tgl) - new Date(a.tgl))
    .slice(0, limit)
    .map(({ type: t, nomor, label }) => ({ type: t, nomor, label }));
};

module.exports = { expand, search, NODE_TYPES };
