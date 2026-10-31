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
  "PRA_ORDER",
  "KONFIRMASI_PRA_ORDER",
  "PERMINTAAN_HARGA",
  "PENAWARAN",
  "MAP",
  "SPK",
  "SO",
  "PROOF",
  "SJ_MEMO",
  "MPPB",
  "PERMINTAAN_DESAIN",
  "LHK_DESAIN",
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
  "PENGAJUAN_DANA",
  "PENGAJUAN_UANG_MUKA",
  "PENYELESAIAN_UANG_MUKA",
  "BKK",
  "BBK",
  "KLAIM_KAS_KECIL",
  "PENGAJUAN_TRANSFER",
  "REALISASI_PENGAJUAN_TRANSFER",
  "BKM",
  "REKAP_PEMBAYARAN",
  "QC_BAHAN",
  "TINDAK_LANJUT_QC",
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
  "MAKLON",
  "SJ_KELUAR_MAKLON",
  "LHK_MAKLON",
  "SJ_HASIL_MAKLON",
  "TERIMA_MAKLON",
  "COMPLAIN_CUSTOMER",
  "BAP_PRODUKSI",
];

// ── Hak akses per tipe node ──
// Tipe node boleh dilihat bila user punya hak VIEW (thakuser.hak_men_view = 'Y')
// di SALAH SATU menu (tmenu.men_id) berikut. Id 55xx = menu MMT yang terpisah.
// Tanda (?) = dipetakan dari nama menu di tmenu, belum dicocokkan dengan route.
const NODE_MENU = {
  PRA_ORDER: [175],
  KONFIRMASI_PRA_ORDER: [1325],
  PERMINTAAN_HARGA: [166],
  PENAWARAN: [151],
  MAP: [162, 5520],
  SPK: [152, 5523],
  SO: [172, 5523],
  PROOF: [122], // (?) tmenu "Proof Garmen"
  SJ_MEMO: [163],
  MPPB: [150],
  PERMINTAAN_DESAIN: [184],
  LHK_DESAIN: [185],
  PO: [52, 5504],
  BPB: [101, 100],
  STBJ: [105, 5524],
  SJ: [153, 5525],
  // Node INVOICE juga memuat proforma dan tak normal (satu tabel tinv_hdr)
  INVOICE: [156, 157, 158],
  MKB: [51],
  BPB_NON_BAHAN: [67],
  VOUCHER: [201],
  PLANNING_PPIC: [56],
  PERMINTAAN_BAHAN: [127],
  REALISASI_MINTA_BAHAN: [108],
  RETUR_LOG: [110], // (?)
  RETUR_BAHAN: [110, 137],
  MKA: [57],
  PERMINTAAN_GARMEN: [60],
  REALISASI_GARMEN: [62],
  PERMINTAAN_PEMBELIAN: [65],
  KASBON: [315],
  PENGAJUAN_DANA: [177],
  PENGAJUAN_UANG_MUKA: [315],
  PENYELESAIAN_UANG_MUKA: [315],
  BKK: [953],
  BBK: [955],
  KLAIM_KAS_KECIL: [971],
  PENGAJUAN_TRANSFER: [958],
  REALISASI_PENGAJUAN_TRANSFER: [958],
  BKM: [952],
  QC_BAHAN: [186],
  TINDAK_LANJUT_QC: [187],
  REKAP_PEMBAYARAN: [970],
  MUTASI_OUT: [70],
  PO_NON_BAHAN: [66],
  MUTASI_PRODUKSI: [109],
  PO_JASA: [102],
  BPJ: [104],
  PO_INTERNAL: [124], // (?)
  SJ_PO_INTERNAL: [125],
  JADWAL_KIRIM: [119, 5527],
  SJ_TAK_NORMAL: [154],
  INVOICE_TAK_NORMAL: [158],
  PENERIMAAN_PIUTANG: [251, 252, 253, 254],
  PELUNASAN_PIUTANG: [255],
  MAKLON: [181, 180],
  SJ_KELUAR_MAKLON: [181, 180],
  LHK_MAKLON: [123],
  SJ_HASIL_MAKLON: [182],
  TERIMA_MAKLON: [182, 181, 180],
  COMPLAIN_CUSTOMER: [36],
  BAP_PRODUKSI: [142],
};

// Fail-fast: tipe node baru tanpa pemetaan menu jangan diam-diam terbuka/tertutup
const tipeTanpaMenu = NODE_TYPES.filter((t) => !NODE_MENU[t]?.length);
if (tipeTanpaMenu.length) {
  throw new Error(`NODE_MENU belum lengkap: ${tipeTanpaMenu.join(", ")}`);
}

const noAkses = () => {
  const err = new Error(
    "Anda tidak memiliki hak lihat untuk tipe dokumen ini.",
  );
  err.forbidden = true;
  return err;
};

// Himpunan tipe node yang boleh dilihat user (1 query ke thakuser)
const getTipeBoleh = async (userKode) => {
  const [rows] = await db.query(
    `SELECT hak_men_id AS id FROM thakuser
     WHERE hak_user_kode = ? AND hak_men_view = 'Y'`,
    [userKode],
  );
  const punya = new Set(rows.map((r) => Number(r.id)));
  return new Set(
    NODE_TYPES.filter((t) => NODE_MENU[t].some((id) => punya.has(id))),
  );
};

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

// ── Finance: Uang Muka ──
// PUM yang sudah direalisasi dan menghasilkan bon ini
const getPumDariBon = async (bonNomor) => {
  const [rows] = await db.query(
    `SELECT pum_nomor FROM tpengajuan_uang_muka_hdr
     WHERE pum_bon_nomor = ? AND pum_status = 'REALISASI'`,
    [bonNomor],
  );
  return rows.map((r) => r.pum_nomor);
};

// Node BKK/BBK dari nomor jurnal; null bila kosong, tidak ada, atau bukan BKK/BBK
// (sisa kasbon mode non-laci berupa BKM/BBM, sengaja tidak dijadikan node)
const jurnalKeluarNode = async (jurNo) => {
  if (!jurNo) return null;
  const [[row]] = await db.query(
    `SELECT jur_tipetransaksi AS tipe FROM finance.tjurnal WHERE jur_no = ?`,
    [jurNo],
  );
  return row && ["BKK", "BBK"].includes(row.tipe)
    ? { type: row.tipe, nomor: jurNo }
    : null;
};

// Status Pengajuan Transfer — aturan sama dengan pengajuanTransferService
// (BELUM / PROSES / CLOSE) + jumlah baris yang sudah punya jurnal (terealisasi)
const getStatusPengajuanTransfer = async (nomor) => {
  const [[row]] = await db.query(
    `SELECT
       IFNULL((SELECT COUNT(b.ptd_jur_no) FROM finance.tpengajuan_transfer_dtl b
               WHERE (b.ptd_jur_no<>'' OR b.ptd_batal<>'') AND b.ptd_nomor = ?), 0) AS sudah,
       IFNULL((SELECT COUNT(*) FROM finance.tpengajuan_transfer_dtl b
               WHERE b.ptd_nomor = ?), 0) AS item,
       IFNULL((SELECT COUNT(*) FROM finance.tpengajuan_transfer_dtl b
               WHERE b.ptd_nomor = ? AND b.ptd_jur_no <> ''), 0) AS terealisasi`,
    [nomor, nomor, nomor],
  );
  const sudah = Number(row.sudah);
  const item = Number(row.item);
  return {
    status: sudah === 0 ? "BELUM" : sudah < item ? "PROSES" : "CLOSE",
    terealisasi: Number(row.terealisasi),
  };
};

// Jurnal otomatis Realisasi Pengajuan Transfer bernomor NN + nomor PJT
// (BKM tujuan dan BBK biaya manual klaim). Mengembalikan nomor PJT bila ada.
const pjtDariJurnalOtomatis = async (jurNo) => {
  const [[j]] = await db.query(
    `SELECT SUBSTRING(jur_no, 3) AS dasar FROM finance.tjurnal
     WHERE jur_no = ? AND jur_otomatis = 1`,
    [jurNo],
  );
  if (!j?.dasar) return null;
  const [[p]] = await db.query(
    `SELECT pth_nomor FROM finance.tpengajuan_transfer_hdr WHERE pth_nomor = ?`,
    [j.dasar],
  );
  return p ? p.pth_nomor : null;
};

// ── QC Bahan ──
// Tindak Lanjut QC = tahap keputusan Pembelian pada dokumen QC yang sama.
// Dianggap ada bila dokumen sudah disubmit (bukan DRAFT) dan sudah ada keputusan
// tahap PEMBELIAN, atau masih ada lot tanpa keputusan / berstatus TUNDA.
const adaTindakLanjutQc = async (qcNomor) => {
  const [[h]] = await db.query(
    `SELECT qc_status FROM tqc_bahan_hdr WHERE qc_nomor = ?`,
    [qcNomor],
  );
  if (!h || h.qc_status === "DRAFT") return false;
  const [[k]] = await db.query(
    `SELECT 1 AS x FROM tqc_bahan_keputusan
     WHERE qck_qc_nomor = ? AND qck_tahap = 'PEMBELIAN' LIMIT 1`,
    [qcNomor],
  );
  if (k) return true;
  const [[p]] = await db.query(
    `SELECT 1 AS x FROM tqc_bahan_dtl
     WHERE qcd_qc_nomor = ? AND IFNULL(qcd_keputusan, '') IN ('', 'TUNDA') LIMIT 1`,
    [qcNomor],
  );
  return !!p;
};

// BPB yang dibuat dari dokumen QC ini (tbpb_qc_lot)
const bpbDariQc = async (qcNomor) => {
  const [rows] = await db.query(
    `SELECT DISTINCT bql_bpb_nomor AS nomor FROM tbpb_qc_lot WHERE bql_qc_nomor = ?`,
    [qcNomor],
  );
  return rows.map((r) => r.nomor);
};

// Realisasi Pengajuan Transfer yang membayar PO Lain-lain untuk supplier tertentu
const getRealisasiPjtPoLain = async (poNomor, supKode) => {
  const [rows] = await db.query(
    `SELECT DISTINCT ptd_nomor AS nomor
     FROM finance.tpengajuan_transfer_dtl
     WHERE ptd_trs = ? AND ptd_sup_kode = ? AND ptd_batal = '' AND ptd_jur_no <> ''`,
    [poNomor, supKode],
  );
  return rows.map((r) => r.nomor);
};

// QC Bahan atas baris PO milik supplier tertentu (PO Lain-lain multi-supplier)
const qcPoLainBySupplier = async (poNomor, supKode) => {
  const [rows] = await db.query(
    `SELECT h.qc_nomor AS nomor
     FROM tqc_bahan_hdr h
     INNER JOIN tpo_dtl p ON p.pod_po_nomor = h.qc_po_nomor AND p.pod_nourut = h.qc_pod_nourut
     WHERE h.qc_po_nomor = ? AND p.pod_sup_kode = ?`,
    [poNomor, supKode],
  );
  return rows.map((r) => r.nomor);
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

// Sama dengan DIVISI_TANPA_KONFIRMASI di konfirmasiPraOrderService:
// Pra Order divisi ini tidak melewati konfirmasi PPIC/Produksi.
const DIVISI_TANPA_KONFIRMASI = ["MMT"];
const SQL_DIVISI_TANPA_KONFIRMASI = DIVISI_TANPA_KONFIRMASI.map(
  (d) => `'${d}'`,
).join(", ");

const praOrderTanpaKonfirmasi = async (nomor) => {
  const [[row]] = await db.query(
    `SELECT UPPER(IFNULL(v.Divisi, '')) AS divisi
     FROM tpraorder_hdr h
     LEFT JOIN tdivisi v ON v.kode = h.pro_divisi
     WHERE h.pro_nomor = ?`,
    [nomor],
  );
  return !!row && DIVISI_TANPA_KONFIRMASI.includes(row.divisi);
};

// Permintaan Harga hasil konversi sebuah Pra Order (dua kolom penghubung)
const getMhDariPraOrder = async (proNomor) => {
  const [a] = await db.query(
    `SELECT mh_nomor AS nomor FROM tmintaharga WHERE mh_pro_nomor = ?`,
    [proNomor],
  );
  const [b] = await db.query(
    `SELECT pro_mh_nomor AS nomor FROM tpraorder_hdr
     WHERE pro_nomor = ? AND IFNULL(pro_mh_nomor, '') <> ''`,
    [proNomor],
  );
  return [...new Set([...a, ...b].map((r) => r.nomor))];
};

// Pra Order asal sebuah Permintaan Harga
const getPraOrderDariMh = async (mhNomor) => {
  const [a] = await db.query(
    `SELECT mh_pro_nomor AS nomor FROM tmintaharga
     WHERE mh_nomor = ? AND IFNULL(mh_pro_nomor, '') <> ''`,
    [mhNomor],
  );
  const [b] = await db.query(
    `SELECT pro_nomor AS nomor FROM tpraorder_hdr WHERE pro_mh_nomor = ?`,
    [mhNomor],
  );
  return [...new Set([...a, ...b].map((r) => r.nomor))];
};

// LHK Desain yang terkait sebuah SO/MAP: referensi eksplisit di dokumennya
// (so_lhk_nomor / mspk_lhk_nomor) + LHK milik PD yang di-close ke SO/MAP itu
// (pd_so_map_nomor). Digabung tanpa duplikat.
const getLhkDesainSoMap = async (nomor, lhkRef) => {
  const [rows] = await db.query(
    `SELECT l.lhk_nomor AS nomor
     FROM tlhk_desain l
     INNER JOIN tpermintaan_desain p ON p.pd_nomor = l.lhk_pd_nomor
     WHERE p.pd_so_map_nomor = ?
     ORDER BY l.lhk_nomor`,
    [nomor],
  );
  return [
    ...new Set([...(lhkRef ? [lhkRef] : []), ...rows.map((r) => r.nomor)]),
  ];
};

const getNodeDetail = async (type, nomor, context = {}) => {
  switch (type) {
    case "PERMINTAAN_DESAIN": {
      const [[row]] = await db.query(
        `SELECT pd_nomor AS nomor, DATE_FORMAT(pd_tanggal,'%Y-%m-%d') AS tanggal,
                pd_nama_project AS label, pd_jml AS jumlah,
                pd_status AS status, pd_status_klien AS statusKlien
         FROM tpermintaan_desain WHERE pd_nomor = ?`,
        [nomor],
      );
      return row
        ? {
            type,
            nomor: row.nomor,
            tanggal: row.tanggal,
            label: row.label || row.nomor,
            jumlah: row.jumlah,
            status: row.status || undefined,
            statusKlien: row.statusKlien || undefined,
          }
        : null;
    }
    case "LHK_DESAIN": {
      const [[row]] = await db.query(
        `SELECT l.lhk_nomor AS nomor, DATE_FORMAT(l.lhk_tanggal,'%Y-%m-%d') AS tanggal,
                p.pd_nama_project AS label, l.lhk_pd_jml AS jumlah,
                l.lhk_pd_status AS status
         FROM tlhk_desain l
         LEFT JOIN tpermintaan_desain p ON p.pd_nomor = l.lhk_pd_nomor
         WHERE l.lhk_nomor = ?`,
        [nomor],
      );
      return row
        ? {
            type,
            nomor: row.nomor,
            tanggal: row.tanggal,
            label: row.label || row.nomor,
            jumlah: row.jumlah,
            status: row.status || undefined,
          }
        : null;
    }
    case "PRA_ORDER": {
      const [[row]] = await db.query(
        `SELECT h.pro_nomor AS nomor, DATE_FORMAT(h.pro_tanggal,'%Y-%m-%d') AS tanggal,
                h.pro_nama_pekerjaan AS label, h.pro_status AS status, v.Divisi AS divisi
         FROM tpraorder_hdr h
         LEFT JOIN tdivisi v ON v.kode = h.pro_divisi
         WHERE h.pro_nomor = ?`,
        [nomor],
      );
      return row
        ? {
            type,
            nomor: row.nomor,
            tanggal: row.tanggal,
            label: row.label || row.nomor,
            kategori: row.divisi || undefined,
            status: row.status || undefined,
          }
        : null;
    }
    // Tahap konfirmasi pada baris Pra Order yang sama (tanpa nomor sendiri)
    case "KONFIRMASI_PRA_ORDER": {
      const [[row]] = await db.query(
        `SELECT h.pro_nomor AS nomor, h.pro_nama_pekerjaan AS label,
                h.pro_status_ppic AS statusPpic, h.pro_catatan_ppic AS catatan,
                DATE_FORMAT(h.pro_tgl_so_estimasi,'%Y-%m-%d') AS tglEstimasiSo,
                DATE_FORMAT(h.pro_tgl_map,'%Y-%m-%d') AS tglEstimasiMap,
                UPPER(IFNULL(v.Divisi, '')) AS divisi
         FROM tpraorder_hdr h
         LEFT JOIN tdivisi v ON v.kode = h.pro_divisi
         WHERE h.pro_nomor = ?`,
        [nomor],
      );
      if (!row || DIVISI_TANPA_KONFIRMASI.includes(row.divisi)) return null;
      return {
        type,
        nomor: row.nomor,
        label: row.label || row.nomor,
        statusPpic: row.statusPpic || undefined,
        catatan: row.catatan || undefined,
        tglEstimasiSo: row.tglEstimasiSo || undefined,
        tglEstimasiMap: row.tglEstimasiMap || undefined,
      };
    }
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
    case "MPPB": {
      const [[row]] = await db.query(
        `SELECT mpb_nomor AS nomor, DATE_FORMAT(mpb_tanggal,'%Y-%m-%d') AS tanggal,
          mpb_nama AS label, mpb_jmlorder AS jumlah, mpb_approve AS approveStatus
         FROM tmpb WHERE mpb_nomor = ?`,
        [nomor],
      );
      return row
        ? {
            type,
            nomor: row.nomor,
            tanggal: row.tanggal,
            label: row.label || row.nomor,
            jumlah: row.jumlah,
            approveStatus: row.approveStatus === "Y" ? "APPROVED" : undefined,
          }
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
      const jenisLabel =
        { 1: "Greige", 2: "Celup", 4: "Lain-lain" }[row.jenis] || "Bahan";
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
    case "QC_BAHAN":
    case "TINDAK_LANJUT_QC": {
      const [[row]] = await db.query(
        `SELECT h.qc_nomor AS nomor, DATE_FORMAT(h.qc_tgl_datang,'%Y-%m-%d') AS tanggal,
                h.qc_keterangan AS label, h.qc_status AS status,
                IFNULL((SELECT SUM(d.qcd_qty_kg) FROM tqc_bahan_dtl d
                        WHERE d.qcd_qc_nomor = h.qc_nomor), 0) AS jumlah
         FROM tqc_bahan_hdr h WHERE h.qc_nomor = ?`,
        [nomor],
      );
      if (!row) return null;
      if (type === "TINDAK_LANJUT_QC" && !(await adaTindakLanjutQc(nomor)))
        return null;
      return {
        type,
        nomor: row.nomor,
        tanggal: row.tanggal,
        label: row.label || row.nomor,
        status: row.status,
        jumlah: Number(row.jumlah),
      };
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
    case "REKAP_PEMBAYARAN": {
      const [[row]] = await db.query(
        `SELECT h.rkb_nomor AS nomor, DATE_FORMAT(h.rkb_tanggal,'%Y-%m-%d') AS tanggal,
                h.rkb_keterangan AS label, h.rkb_status AS status,
                IFNULL((SELECT SUM(d.rkbd_nominal) FROM trekap_bayar_dtl d
                        WHERE d.rkbd_nomor = h.rkb_nomor), 0) AS jumlah
         FROM trekap_bayar_hdr h WHERE h.rkb_nomor = ?`,
        [nomor],
      );
      return row
        ? {
            type,
            nomor: row.nomor,
            tanggal: row.tanggal,
            label: row.label || row.nomor,
            status: row.status,
            jumlah: Number(row.jumlah),
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
         FROM tplan_ppic_dtl2
         WHERE plan_pl_nomor = ? AND plan_divisi IN ('CUTTING', 'SEWING')
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
      if (!row) return null;
      const pumNomors = await getPumDariBon(nomor);
      return {
        type,
        nomor: row.nomor,
        tanggal: row.tanggal,
        label: row.label || row.nomor,
        jenis: Number(row.jenis) === 0 ? "KAS" : "BANK",
        jumlah: row.jumlah,
        isSelesai: Number(row.selesaiStatus) !== 0,
        jurNo: row.jurNo || undefined,
        pumNomor: pumNomors[0] || undefined,
      };
    }
    case "PENGAJUAN_DANA": {
      const [[row]] = await db.query(
        `SELECT h.pjh_nomor AS nomor, DATE_FORMAT(h.pjh_tanggal,'%Y-%m-%d') AS tanggal,
                h.pjh_keterangan AS label, h.pjh_jenis_permintaan AS kategori,
                IFNULL((SELECT SUM(d.pjd_qty * d.pjd_nilai)
                        FROM ga2.tpengajuan2_dtl d
                        WHERE d.pjd_pjh_nomor = h.pjh_nomor AND d.pjd_nama <> ''), 0) AS jumlah
         FROM ga2.tpengajuan2_hdr h WHERE h.pjh_nomor = ?`,
        [nomor],
      );
      return row
        ? {
            type,
            nomor: row.nomor,
            tanggal: row.tanggal,
            label: row.label || row.nomor,
            kategori: row.kategori || undefined,
            jumlah: row.jumlah,
          }
        : null;
    }
    case "PENGAJUAN_UANG_MUKA": {
      const [[row]] = await db.query(
        `SELECT pum_nomor AS nomor, DATE_FORMAT(pum_tanggal,'%Y-%m-%d') AS tanggal,
                pum_keterangan AS label, pum_status AS status,
                pum_total_nominal AS jumlah, pum_cabang AS cabang
         FROM tpengajuan_uang_muka_hdr WHERE pum_nomor = ?`,
        [nomor],
      );
      return row
        ? {
            type,
            nomor: row.nomor,
            tanggal: row.tanggal,
            label: row.label || row.nomor,
            status: row.status,
            jumlah: row.jumlah,
            cabang: row.cabang,
          }
        : null;
    }
    case "PENYELESAIAN_UANG_MUKA": {
      const [[row]] = await db.query(
        `SELECT k.bon_nomor AS nomor,
                IFNULL(DATE_FORMAT(t.jur_tanggal,'%Y-%m-%d'), DATE_FORMAT(k.bon_tanggal,'%Y-%m-%d')) AS tanggal,
                k.bon_keterangan AS label, k.bon_jur_no AS jurNo,
                IF(k.bon_jur_no = '', 0,
                   IFNULL((SELECT SUM(i.jurd_kredit) FROM finance.tjurnalitem i
                           WHERE i.jurd_jur_no = k.bon_jur_no), 0)) AS jumlah
         FROM finance.tkasbon k
         LEFT JOIN finance.tjurnal t ON t.jur_no = k.bon_jur_no
         WHERE k.bon_nomor = ? AND k.bon_selesai <> 0`,
        [nomor],
      );
      return row
        ? {
            type,
            nomor: row.nomor,
            tanggal: row.tanggal,
            label: row.label || row.nomor,
            jumlah: row.jumlah,
            jurNo: row.jurNo || undefined,
          }
        : null;
    }
    case "BKK":
    case "BBK": {
      const [[row]] = await db.query(
        `SELECT h.jur_no AS nomor, DATE_FORMAT(h.jur_tanggal,'%Y-%m-%d') AS tanggal,
                h.jur_keterangan AS label,
                IFNULL((SELECT SUM(i.jurd_debet) FROM finance.tjurnalitem i
                        WHERE i.jurd_jur_no = h.jur_no), 0) AS jumlah
         FROM finance.tjurnal h
         WHERE h.jur_no = ? AND h.jur_tipetransaksi = ?`,
        [nomor, type],
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
    case "KLAIM_KAS_KECIL": {
      const [[row]] = await db.query(
        `SELECT kkh_nomor AS nomor, DATE_FORMAT(kkh_tanggal,'%Y-%m-%d') AS tanggal,
                kkh_keterangan AS label, kkh_status AS status,
                kkh_total AS jumlah, kkh_cabang AS cabang
         FROM tklaim_kaskecil_hdr WHERE kkh_nomor = ?`,
        [nomor],
      );
      return row
        ? {
            type,
            nomor: row.nomor,
            tanggal: row.tanggal,
            label: row.label || row.nomor,
            status: row.status,
            jumlah: Number(row.jumlah),
            cabang: row.cabang,
          }
        : null;
    }
    case "BKM": {
      const [[row]] = await db.query(
        `SELECT h.jur_no AS nomor, DATE_FORMAT(h.jur_tanggal,'%Y-%m-%d') AS tanggal,
                h.jur_keterangan AS label,
                IFNULL((SELECT SUM(i.jurd_kredit) FROM finance.tjurnalitem i
                        WHERE i.jurd_jur_no = h.jur_no), 0) AS jumlah
         FROM finance.tjurnal h
         WHERE h.jur_no = ? AND h.jur_tipetransaksi = 'BKM'`,
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
    case "PENGAJUAN_TRANSFER":
    case "REALISASI_PENGAJUAN_TRANSFER": {
      const [[row]] = await db.query(
        `SELECT h.pth_nomor AS nomor,
                DATE_FORMAT(h.pth_tanggal,'%Y-%m-%d') AS tanggal,
                DATE_FORMAT((SELECT MAX(d.ptd_realisasi) FROM finance.tpengajuan_transfer_dtl d
                             WHERE d.ptd_nomor = h.pth_nomor AND d.ptd_jur_no <> ''),'%Y-%m-%d') AS tglRealisasi,
                IFNULL(r.rek_nama,'') AS label,
                IFNULL((SELECT SUM(d.ptd_nominal) FROM finance.tpengajuan_transfer_dtl d
                        WHERE d.ptd_nomor = h.pth_nomor AND d.ptd_batal = ''), 0) AS jumlah,
                IFNULL((SELECT SUM(d.ptd_nominal) FROM finance.tpengajuan_transfer_dtl d
                        WHERE d.ptd_nomor = h.pth_nomor AND d.ptd_jur_no <> ''), 0) AS jumlahRealisasi
         FROM finance.tpengajuan_transfer_hdr h
         LEFT JOIN finance.trekening r ON r.rek_kode = h.pth_rek_kode
         WHERE h.pth_nomor = ?`,
        [nomor],
      );
      if (!row) return null;
      const st = await getStatusPengajuanTransfer(nomor);
      const isRealisasi = type === "REALISASI_PENGAJUAN_TRANSFER";
      if (isRealisasi && st.terealisasi === 0) return null;
      return {
        type,
        nomor: row.nomor,
        tanggal: isRealisasi ? row.tglRealisasi || row.tanggal : row.tanggal,
        label: row.label || row.nomor,
        status: st.status,
        jumlah: Number(isRealisasi ? row.jumlahRealisasi : row.jumlah),
      };
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
    case "MAKLON": {
      const [[row]] = await db.query(
        `SELECT h.mkl_nomor AS nomor, DATE_FORMAT(h.mkl_tanggal,'%Y-%m-%d') AS tanggal,
                h.mkl_keterangan AS label, h.mkl_status AS status,
                h.mkl_cab_asal AS cabangAsal, h.mkl_cab_tujuan AS cabangTujuan,
                IFNULL((SELECT SUM(d.mkld_qty_kirim) FROM tmaklon_dtl d
                        WHERE d.mkld_mkl_nomor = h.mkl_nomor), 0) AS jumlah
         FROM tmaklon_hdr h WHERE h.mkl_nomor = ?`,
        [nomor],
      );
      return row
        ? {
            type,
            nomor: row.nomor,
            tanggal: row.tanggal,
            label: row.label || row.nomor,
            status: row.status,
            cabangAsal: row.cabangAsal,
            cabangTujuan: row.cabangTujuan,
            jumlah: Number(row.jumlah),
          }
        : null;
    }
    case "SJ_KELUAR_MAKLON": {
      const [[row]] = await db.query(
        `SELECT s.sjk_nomor AS nomor, DATE_FORMAT(s.sjk_tanggal,'%Y-%m-%d') AS tanggal,
                s.sjk_mkl_nomor AS label,
                m.mkl_cab_asal AS cabangAsal, m.mkl_cab_tujuan AS cabangTujuan,
                IFNULL((SELECT SUM(d.sjkd_qty_kirim) FROM tmaklon_sj_keluar_dtl d
                        WHERE d.sjkd_sjk_nomor = s.sjk_nomor), 0) AS jumlah
         FROM tmaklon_sj_keluar_hdr s
         LEFT JOIN tmaklon_hdr m ON m.mkl_nomor = s.sjk_mkl_nomor
         WHERE s.sjk_nomor = ?`,
        [nomor],
      );
      return row
        ? {
            type,
            nomor: row.nomor,
            tanggal: row.tanggal,
            label: row.label || row.nomor,
            cabangAsal: row.cabangAsal,
            cabangTujuan: row.cabangTujuan,
            jumlah: Number(row.jumlah),
          }
        : null;
    }
    case "LHK_MAKLON": {
      const [[row]] = await db.query(
        `SELECT lhk_nomor AS nomor, DATE_FORMAT(tanggal,'%Y-%m-%d') AS tanggal,
                mkl_nomor AS label, cab AS cabang, qty_masuk AS jumlah
         FROM tdtf_maklon WHERE lhk_nomor = ? LIMIT 1`,
        [nomor],
      );
      return row
        ? {
            type,
            nomor: row.nomor,
            tanggal: row.tanggal,
            label: row.label || row.nomor,
            cabang: row.cabang,
            jumlah: Number(row.jumlah),
          }
        : null;
    }
    case "SJ_HASIL_MAKLON": {
      const [[row]] = await db.query(
        `SELECT h.sjm_nomor AS nomor, DATE_FORMAT(h.sjm_tanggal,'%Y-%m-%d') AS tanggal,
                h.sjm_mkl_nomor AS label, h.sjm_cab_penerima AS cabang,
                IFNULL((SELECT SUM(d.sjmd_qty_terima) FROM tsj_maklon_dtl d
                        WHERE d.sjmd_sjm_nomor = h.sjm_nomor), 0) AS jumlah
         FROM tsj_maklon_hdr h WHERE h.sjm_nomor = ?`,
        [nomor],
      );
      return row
        ? {
            type,
            nomor: row.nomor,
            tanggal: row.tanggal,
            label: row.label || row.nomor,
            cabang: row.cabang,
            jumlah: Number(row.jumlah),
          }
        : null;
    }
    case "TERIMA_MAKLON": {
      const [[row]] = await db.query(
        `SELECT t.mth_nomor AS nomor, DATE_FORMAT(t.mth_tanggal,'%Y-%m-%d') AS tanggal,
                t.mth_mkl_nomor AS label,
                IFNULL((SELECT SUM(d.mtd_qty_terima) FROM tmaklon_terima_dtl d
                        WHERE d.mtd_mth_nomor = t.mth_nomor), 0) AS jumlah
         FROM tmaklon_terima_hdr t WHERE t.mth_nomor = ?`,
        [nomor],
      );
      return row
        ? {
            type,
            nomor: row.nomor,
            tanggal: row.tanggal,
            label: row.label || row.nomor,
            jumlah: Number(row.jumlah),
          }
        : null;
    }
    case "COMPLAIN_CUSTOMER": {
      const [[row]] = await db.query(
        `SELECT tc_nomor AS nomor, DATE_FORMAT(tc_date,'%Y-%m-%d') AS tanggal,
                tc_description AS label, tc_jenis AS kategori
         FROM tcomplain WHERE tc_nomor = ?`,
        [nomor],
      );
      return row
        ? {
            type,
            nomor: row.nomor,
            tanggal: row.tanggal,
            label: row.label || row.nomor,
            kategori: row.kategori || undefined,
          }
        : null;
    }
    case "BAP_PRODUKSI": {
      const [[row]] = await db.query(
        `SELECT bap_nomor AS nomor, DATE_FORMAT(bap_tanggal,'%Y-%m-%d') AS tanggal,
                bap_masalah AS label, bap_tipe AS kategori, bap_cab AS cabang
         FROM tkpi_bapproduksi WHERE bap_nomor = ?`,
        [nomor],
      );
      return row
        ? {
            type,
            nomor: row.nomor,
            tanggal: row.tanggal,
            label: row.label || row.nomor,
            kategori: row.kategori || undefined,
            cabang: row.cabang || undefined,
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

  // Complain Customer dan BAP Produksi menunjuk nomor SPK/MAP/SO (tc_spk_nomor,
  // bap_spk_nomor); jenis nomor dikenali lewat resolveProduksiNomor di sisi mereka
  const [complainRows] = await db.query(
    `SELECT tc_nomor AS nomor FROM tcomplain WHERE tc_spk_nomor = ?`,
    [nomor],
  );
  complainRows.forEach((r) =>
    forward.push({ type: "COMPLAIN_CUSTOMER", nomor: r.nomor }),
  );

  const [bapRows] = await db.query(
    `SELECT bap_nomor AS nomor FROM tkpi_bapproduksi WHERE bap_spk_nomor = ?`,
    [nomor],
  );
  bapRows.forEach((r) =>
    forward.push({ type: "BAP_PRODUKSI", nomor: r.nomor }),
  );

  return forward;
};

const getRelated = async (type, nomor) => {
  const backward = [];
  const forward = [];

  switch (type) {
    case "PERMINTAAN_DESAIN": {
      const [lhkRows] = await db.query(
        `SELECT lhk_nomor AS nomor FROM tlhk_desain WHERE lhk_pd_nomor = ? ORDER BY lhk_nomor`,
        [nomor],
      );
      lhkRows.forEach((r) =>
        forward.push({ type: "LHK_DESAIN", nomor: r.nomor }),
      );
      break;
    }
    case "LHK_DESAIN": {
      const [[lhk]] = await db.query(
        `SELECT lhk_pd_nomor AS pd FROM tlhk_desain WHERE lhk_nomor = ?`,
        [nomor],
      );
      if (lhk?.pd) backward.push({ type: "PERMINTAAN_DESAIN", nomor: lhk.pd });

      const tujuan = new Map();
      const tambah = (t) => tujuan.set(`${t.type}:${t.nomor}`, t);

      // Referensi eksplisit di SO / MAP
      const [soRows] = await db.query(
        `SELECT so_nomor AS nomor FROM tsalesorder WHERE so_lhk_nomor = ? AND so_aktif = 'Y'`,
        [nomor],
      );
      soRows.forEach((r) => tambah({ type: "SO", nomor: r.nomor }));
      const [mapRows] = await db.query(
        `SELECT mspk_nomor AS nomor FROM tmemospk WHERE mspk_lhk_nomor = ? AND mspk_aktif = 'Y'`,
        [nomor],
      );
      mapRows.forEach((r) => tambah({ type: "MAP", nomor: r.nomor }));

      // Hasil close PD: pd_so_map_nomor (bisa SO baru, SO lama di tspk, atau MAP)
      if (lhk?.pd) {
        const [[pd]] = await db.query(
          `SELECT pd_so_map_nomor AS target FROM tpermintaan_desain WHERE pd_nomor = ?`,
          [lhk.pd],
        );
        if (pd?.target) {
          const resolved = await resolveProduksiNomor(pd.target);
          if (resolved) tambah(resolved);
        }
      }
      forward.push(...tujuan.values());
      break;
    }
    case "PRA_ORDER": {
      if (await praOrderTanpaKonfirmasi(nomor)) {
        (await getMhDariPraOrder(nomor)).forEach((mh) =>
          forward.push({ type: "PERMINTAAN_HARGA", nomor: mh }),
        );
      } else {
        forward.push({ type: "KONFIRMASI_PRA_ORDER", nomor });
      }
      break;
    }
    case "KONFIRMASI_PRA_ORDER": {
      backward.push({ type: "PRA_ORDER", nomor });
      (await getMhDariPraOrder(nomor)).forEach((mh) =>
        forward.push({ type: "PERMINTAAN_HARGA", nomor: mh }),
      );
      break;
    }
    case "PERMINTAAN_HARGA": {
      // Pembuka alur: Pra Order (-> Konfirmasi) -> Permintaan Harga
      for (const pro of await getPraOrderDariMh(nomor)) {
        backward.push({
          type: (await praOrderTanpaKonfirmasi(pro))
            ? "PRA_ORDER"
            : "KONFIRMASI_PRA_ORDER",
          nomor: pro,
        });
      }
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

      const [mppbRows] = await db.query(
        `SELECT mpb_nomor AS nomor FROM tmpb WHERE mpb_pen_nomor = ?`,
        [nomor],
      );
      mppbRows.forEach((r) => forward.push({ type: "MPPB", nomor: r.nomor }));

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
        `SELECT mspk_pen_nomor AS pen, mspk_mh_nomor AS mh, mspk_lhk_nomor AS lhk FROM tmemospk WHERE mspk_nomor = ?`,
        [nomor],
      );
      if (row?.pen) backward.push({ type: "PENAWARAN", nomor: row.pen });
      if (row?.mh) backward.push({ type: "PERMINTAAN_HARGA", nomor: row.mh });
      for (const lhk of await getLhkDesainSoMap(nomor, row?.lhk)) {
        backward.push({ type: "LHK_DESAIN", nomor: lhk });
      }

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
        `SELECT DISTINCT plan_pl_nomor AS nomor FROM tplan_ppic_dtl2
         WHERE plan_spk = ? AND plan_divisi IN ('CUTTING', 'SEWING')`,
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
        `SELECT so_memo AS map, so_pen_nomor AS pen, so_mppb AS mppb, so_lhk_nomor AS lhk FROM tsalesorder WHERE so_nomor = ?`,
        [nomor],
      );
      if (row?.map) backward.push({ type: "MAP", nomor: row.map });
      else if (row?.pen) backward.push({ type: "PENAWARAN", nomor: row.pen });
      if (row?.mppb) backward.push({ type: "MPPB", nomor: row.mppb });
      for (const lhk of await getLhkDesainSoMap(nomor, row?.lhk)) {
        backward.push({ type: "LHK_DESAIN", nomor: lhk });
      }

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
      // ⚠️ ASUMSI (derived, BUKAN FK langsung) — lihat catatan lengkap di
      // case PERMINTAAN_BAHAN. mkb_spk_nomor bisa terisi nomor SO,
      // sementara tmintabahan_hdr.min_spk_nomor selalu nomor SPK turunan
      // — jadi perlu cari SPK turunan dari SO ini dulu (spk_so_ref) buat
      // dapat kandidat lookup yang benar, konsisten dgn
      // mintaBahanFormService.getSpkDetailsAndMkb.
      if (row?.ref) {
        const [[turunanRow]] = await db.query(
          `SELECT spk_nomor FROM tspk WHERE spk_so_ref = ? AND spk_is_so = 0`,
          [row.ref],
        );
        const lookupNomors = [row.ref, turunanRow?.spk_nomor].filter(Boolean);
        const [permintaanBahanRows] = await db.query(
          `SELECT DISTINCT min_nomor AS nomor
           FROM tmintabahan_hdr
           WHERE min_spk_nomor IN (?)`,
          [lookupNomors],
        );
        permintaanBahanRows.forEach((r) =>
          forward.push({ type: "PERMINTAAN_BAHAN", nomor: r.nomor }),
        );
      }
      break;
    }
    case "MPPB": {
      // MPPB wajib punya Penawaran (tmpb.mpb_pen_nomor)
      const [[hdr]] = await db.query(
        `SELECT mpb_pen_nomor AS pen FROM tmpb WHERE mpb_nomor = ?`,
        [nomor],
      );
      if (hdr?.pen) backward.push({ type: "PENAWARAN", nomor: hdr.pen });

      // ✅ Terkonfirmasi poBahanFormService.js: relasi 1:1, 1 MPPB cuma
      // bisa dipakai 1 PO (validateField blok kalau MPPB sudah terpakai).
      const [poRows] = await db.query(
        `SELECT po_nomor AS nomor FROM tpo_hdr WHERE po_mppb_nomor = ?`,
        [nomor],
      );
      poRows.forEach((r) => forward.push({ type: "PO", nomor: r.nomor }));

      // SO yang menunjuk MPPB ini (tsalesorder.so_mppb)
      const [soRows] = await db.query(
        `SELECT so_nomor AS nomor FROM tsalesorder WHERE so_mppb = ? AND so_aktif = 'Y'`,
        [nomor],
      );
      soRows.forEach((r) => forward.push({ type: "SO", nomor: r.nomor }));
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
      const [mkbRefRows] = await db.query(
        `SELECT DISTINCT pod_mkb_nomor AS nomor FROM tpo_dtl WHERE pod_po_nomor = ? AND pod_mkb_nomor <> ''`,
        [nomor],
      );
      mkbRefRows.forEach((r) => backward.push({ type: "MKB", nomor: r.nomor }));
      // ✅ Terkonfirmasi poBahanFormService.js: tpo_hdr.po_mppb_nomor = FK
      // LANGSUNG ke tmpb.mpb_nomor (level header, bukan derived). Validasi
      // validateField bahkan mencegah 1 MPPB dipakai >1 PO ("MPPB sudah
      // di-input di PO"), jadi relasinya 1:1 per PO.
      const [[hdrRow]] = await db.query(
        `SELECT po_mppb_nomor AS mppb FROM tpo_hdr WHERE po_nomor = ?`,
        [nomor],
      );
      if (hdrRow?.mppb) backward.push({ type: "MPPB", nomor: hdrRow.mppb });
      // PO Celup mengolah PO Greige (tpo_hdr.po_greige)
      const [greigeRows] = await db.query(
        `SELECT po_greige AS nomor FROM tpo_hdr WHERE po_nomor = ? AND po_greige <> ''`,
        [nomor],
      );
      greigeRows.forEach((r) => backward.push({ type: "PO", nomor: r.nomor }));
      const [celupRows] = await db.query(
        `SELECT po_nomor AS nomor FROM tpo_hdr WHERE po_greige = ?`,
        [nomor],
      );
      celupRows.forEach((r) => forward.push({ type: "PO", nomor: r.nomor }));
      // PO Lain-lain dibayar dulu: PO -> Pengajuan Transfer -> Realisasi -> QC
      const [[poHdr]] = await db.query(
        `SELECT po_jenis AS jenis FROM tpo_hdr WHERE po_nomor = ?`,
        [nomor],
      );
      const supSudahDibayar = new Set();
      if (Number(poHdr?.jenis) === 4) {
        const [pjtRows] = await db.query(
          `SELECT DISTINCT ptd_nomor AS nomor
           FROM finance.tpengajuan_transfer_dtl
           WHERE ptd_trs = ? AND ptd_batal = ''`,
          [nomor],
        );
        pjtRows.forEach((r) =>
          forward.push({ type: "PENGAJUAN_TRANSFER", nomor: r.nomor }),
        );
        const [supRows] = await db.query(
          `SELECT DISTINCT ptd_sup_kode AS sup
           FROM finance.tpengajuan_transfer_dtl
           WHERE ptd_trs = ? AND ptd_batal = '' AND ptd_jur_no <> ''`,
          [nomor],
        );
        supRows.forEach((r) => supSudahDibayar.add(r.sup));
      }

      // QC Bahan; yang sudah terjangkau lewat Realisasi tidak digambar langsung dari PO
      const [qcRows] = await db.query(
        `SELECT h.qc_nomor AS nomor,
                COALESCE(NULLIF(p.pod_sup_kode, ''), ph.po_sup_kode) AS sup
         FROM tqc_bahan_hdr h
         INNER JOIN tpo_hdr ph ON ph.po_nomor = h.qc_po_nomor
         LEFT JOIN tpo_dtl p ON p.pod_po_nomor = h.qc_po_nomor
                            AND p.pod_nourut = h.qc_pod_nourut
         WHERE h.qc_po_nomor = ?`,
        [nomor],
      );
      qcRows
        .filter((r) => !supSudahDibayar.has(r.sup))
        .forEach((r) => forward.push({ type: "QC_BAHAN", nomor: r.nomor }));

      // BPB tanpa lot QC (jalur lama / BPB Celup otomatis); BPB dari QC lewat QC
      const [bpbRows] = await db.query(
        `SELECT DISTINCT h.bpb_nomor AS nomor FROM tbpb_hdr h
         WHERE h.bpb_po_nomor = ?
           AND NOT EXISTS (SELECT 1 FROM tbpb_qc_lot q WHERE q.bql_bpb_nomor = h.bpb_nomor)`,
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
      // BPB dari QC: hulunya QC (atau Tindak Lanjut bila ada), bukan PO langsung
      const [qcRows] = await db.query(
        `SELECT DISTINCT bql_qc_nomor AS nomor FROM tbpb_qc_lot WHERE bql_bpb_nomor = ?`,
        [nomor],
      );
      if (qcRows.length) {
        for (const r of qcRows) {
          backward.push({
            type: (await adaTindakLanjutQc(r.nomor))
              ? "TINDAK_LANJUT_QC"
              : "QC_BAHAN",
            nomor: r.nomor,
          });
        }
      } else if (row?.po) {
        backward.push({ type: "PO", nomor: row.po });
      }

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
      // Rekap Pembayaran: baris nota rekap yang dipakai membuat voucher ini = hulu;
      // voucher yang dimasukkan ke rekap (rkbd_tipe = 'VOU') = hilir
      const [rekapRows] = await db.query(
        `SELECT DISTINCT rkbd_nomor AS nomor, rkbd_tipe AS tipe
         FROM trekap_bayar_dtl WHERE rkbd_vou_nomor = ?`,
        [nomor],
      );
      rekapRows.forEach((r) => {
        if (r.tipe === "VOU")
          forward.push({ type: "REKAP_PEMBAYARAN", nomor: r.nomor });
        else backward.push({ type: "REKAP_PEMBAYARAN", nomor: r.nomor });
      });

      // Pengajuan Transfer yang memanggil voucher ini (ptd_trs = nomor voucher)
      const [pjtVouRows] = await db.query(
        `SELECT DISTINCT ptd_nomor AS nomor
         FROM finance.tpengajuan_transfer_dtl
         WHERE ptd_trs = ? AND ptd_batal = ''`,
        [nomor],
      );
      pjtVouRows.forEach((r) =>
        forward.push({ type: "PENGAJUAN_TRANSFER", nomor: r.nomor }),
      );
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
      // ⚠️ ASUMSI (derived, sama seperti case MKB) — min_spk_nomor di
      // sini SELALU nomor SPK turunan. Tapi tmkb_hdr.mkb_spk_nomor bisa
      // tercatat pakai nomor SO INDUK (spk_so_ref dari SPK turunan ini),
      // bukan nomor SPK turunan itu sendiri — jadi cari MKB berdasarkan
      // kedua kemungkinan (SPK turunan ATAU SO induknya).
      if (row?.ref) {
        const [[spkRow]] = await db.query(
          `SELECT spk_so_ref FROM tspk WHERE spk_nomor = ? AND spk_is_so = 0`,
          [row.ref],
        );
        const lookupNomors = [row.ref, spkRow?.spk_so_ref].filter(Boolean);
        const [mkbRows] = await db.query(
          `SELECT DISTINCT mkb_nomor AS nomor FROM tmkb_hdr WHERE mkb_spk_nomor IN (?)`,
          [lookupNomors],
        );
        mkbRows.forEach((r) => backward.push({ type: "MKB", nomor: r.nomor }));
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
      // Hilir baru: Pengajuan Uang Muka yang memuat Permintaan Pembelian ini
      const [pumRows] = await db.query(
        `SELECT DISTINCT pumd_pum_nomor AS nomor FROM tpengajuan_uang_muka_dtl
         WHERE pumd_sumber = 'PERMINTAAN_PEMBELIAN' AND pumd_nomor_sumber = ?`,
        [nomor],
      );
      pumRows.forEach((r) =>
        forward.push({ type: "PENGAJUAN_UANG_MUKA", nomor: r.nomor }),
      );

      // Edge langsung ke KASBON hanya untuk bon yang belum terjangkau lewat PUM
      const [kasbonRows] = await db.query(
        `SELECT DISTINCT bond2_nomor AS nomor FROM finance.tkasbonitem2 WHERE bond2_link = ?`,
        [nomor],
      );
      let bonViaPum = new Set();
      if (pumRows.length) {
        const [r] = await db.query(
          `SELECT pum_bon_nomor AS nomor FROM tpengajuan_uang_muka_hdr
           WHERE pum_nomor IN (?) AND pum_status = 'REALISASI'`,
          [pumRows.map((x) => x.nomor)],
        );
        bonViaPum = new Set(r.map((x) => x.nomor));
      }
      kasbonRows
        .filter((r) => !bonViaPum.has(r.nomor))
        .forEach((r) => forward.push({ type: "KASBON", nomor: r.nomor }));

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
      // Realisasi: PUM yang menerbitkan bon ini
      const pumNomors = await getPumDariBon(nomor);
      pumNomors.forEach((p) =>
        backward.push({ type: "PENGAJUAN_UANG_MUKA", nomor: p }),
      );

      // Permintaan Pembelian dari baris tambahan Penyelesaian (tkasbonitem2);
      // buang yang sudah terwakili lewat PUM supaya tidak jadi segitiga
      const [ppRows] = await db.query(
        `SELECT DISTINCT bond2_link AS nomor FROM finance.tkasbonitem2
         WHERE bond2_nomor = ? AND bond2_link LIKE 'MB%'`,
        [nomor],
      );
      let ppViaPum = new Set();
      if (pumNomors.length) {
        const [r] = await db.query(
          `SELECT DISTINCT pumd_nomor_sumber AS nomor FROM tpengajuan_uang_muka_dtl
           WHERE pumd_pum_nomor IN (?) AND pumd_sumber = 'PERMINTAAN_PEMBELIAN'`,
          [pumNomors],
        );
        ppViaPum = new Set(r.map((x) => x.nomor));
      }
      ppRows
        .filter((r) => !ppViaPum.has(r.nomor))
        .forEach((r) =>
          backward.push({ type: "PERMINTAAN_PEMBELIAN", nomor: r.nomor }),
        );

      // Kasbon sistem lama (tanpa PUM): langsung dari Pengajuan Dana.
      // bon_pjh_nomor bisa berisi nomor MB/VOU/POE/IV, jadi divalidasi dulu.
      if (!pumNomors.length) {
        const [[b]] = await db.query(
          `SELECT bon_pjh_nomor AS pjh FROM finance.tkasbon WHERE bon_nomor = ?`,
          [nomor],
        );
        if (b?.pjh) {
          const [[pd]] = await db.query(
            `SELECT pjh_nomor FROM ga2.tpengajuan2_hdr WHERE pjh_nomor = ?`,
            [b.pjh],
          );
          if (pd) backward.push({ type: "PENGAJUAN_DANA", nomor: b.pjh });
        }
      }

      // Hilir: Penyelesaian (bila sudah selesai) dan BKK transfer laci
      const [[bon]] = await db.query(
        `SELECT bon_selesai AS selesai, bon_transfer_jur_no AS transfer
         FROM finance.tkasbon WHERE bon_nomor = ?`,
        [nomor],
      );
      if (bon) {
        if (Number(bon.selesai) !== 0)
          forward.push({ type: "PENYELESAIAN_UANG_MUKA", nomor });
        const trf = await jurnalKeluarNode(bon.transfer);
        if (trf) forward.push(trf);
      }
      break;
    }
    case "PENGAJUAN_DANA": {
      const [pumRows] = await db.query(
        `SELECT DISTINCT pumd_pum_nomor AS nomor FROM tpengajuan_uang_muka_dtl
         WHERE pumd_sumber = 'PENGAJUAN_DANA' AND pumd_nomor_sumber = ?`,
        [nomor],
      );
      pumRows.forEach((r) =>
        forward.push({ type: "PENGAJUAN_UANG_MUKA", nomor: r.nomor }),
      );

      // Kasbon sistem lama yang langsung atas Pengajuan Dana (tanpa PUM)
      const [bonRows] = await db.query(
        `SELECT bon_nomor AS nomor FROM finance.tkasbon WHERE bon_pjh_nomor = ?`,
        [nomor],
      );
      if (bonRows.length) {
        const [dipakai] = await db.query(
          `SELECT pum_bon_nomor AS nomor FROM tpengajuan_uang_muka_hdr
           WHERE pum_bon_nomor IN (?)`,
          [bonRows.map((r) => r.nomor)],
        );
        const adaPum = new Set(dipakai.map((r) => r.nomor));
        bonRows
          .filter((r) => !adaPum.has(r.nomor))
          .forEach((r) => forward.push({ type: "KASBON", nomor: r.nomor }));
      }
      break;
    }
    case "PENGAJUAN_UANG_MUKA": {
      const [src] = await db.query(
        `SELECT DISTINCT pumd_sumber AS sumber, pumd_nomor_sumber AS nomor
         FROM tpengajuan_uang_muka_dtl
         WHERE pumd_pum_nomor = ?
           AND pumd_sumber IN ('PENGAJUAN_DANA', 'PERMINTAAN_PEMBELIAN')`,
        [nomor],
      );
      src.forEach((r) => backward.push({ type: r.sumber, nomor: r.nomor }));

      // pum_bon_nomor tidak dikosongkan saat PUM dibatalkan (deleteHistory),
      // jadi edge hanya untuk status REALISASI dan bon yang masih ada
      const [[hdr]] = await db.query(
        `SELECT pum_status AS status, pum_bon_nomor AS bon
         FROM tpengajuan_uang_muka_hdr WHERE pum_nomor = ?`,
        [nomor],
      );
      if (hdr?.status === "REALISASI" && hdr.bon) {
        const [[bon]] = await db.query(
          `SELECT bon_nomor FROM finance.tkasbon WHERE bon_nomor = ?`,
          [hdr.bon],
        );
        if (bon) forward.push({ type: "KASBON", nomor: hdr.bon });
      }
      break;
    }
    case "PENYELESAIAN_UANG_MUKA": {
      backward.push({ type: "KASBON", nomor });
      const [[bon]] = await db.query(
        `SELECT bon_jur_no AS jur, bon_sisa_jur_no AS sisa
         FROM finance.tkasbon WHERE bon_nomor = ? AND bon_selesai <> 0`,
        [nomor],
      );
      if (bon) {
        for (const j of [bon.jur, bon.sisa]) {
          const n = await jurnalKeluarNode(j);
          if (n) forward.push(n);
        }
      }
      break;
    }
    case "BKK":
    case "BBK": {
      const [rows] = await db.query(
        `SELECT bon_nomor AS nomor, bon_transfer_jur_no AS transfer
         FROM finance.tkasbon
         WHERE bon_jur_no = ? OR bon_sisa_jur_no = ? OR bon_transfer_jur_no = ?`,
        [nomor, nomor, nomor],
      );
      rows.forEach((r) => {
        if (r.transfer === nomor)
          backward.push({ type: "KASBON", nomor: r.nomor });
        else backward.push({ type: "PENYELESAIAN_UANG_MUKA", nomor: r.nomor });
      });

      // BBK utama hasil Realisasi Pengajuan Transfer (ptd_jur_no)
      const [pjtRows] = await db.query(
        `SELECT DISTINCT ptd_nomor AS nomor
         FROM finance.tpengajuan_transfer_dtl WHERE ptd_jur_no = ?`,
        [nomor],
      );
      pjtRows.forEach((r) =>
        backward.push({
          type: "REALISASI_PENGAJUAN_TRANSFER",
          nomor: r.nomor,
        }),
      );

      // BBK otomatis biaya manual klaim ATM (nomor = NN + nomor PJT)
      if (type === "BBK") {
        const pjt = await pjtDariJurnalOtomatis(nomor);
        if (pjt)
          backward.push({ type: "REALISASI_PENGAJUAN_TRANSFER", nomor: pjt });
      }
      break;
    }
    case "KLAIM_KAS_KECIL": {
      // Dipanggil di Pengajuan Transfer: ptd_trs = nomor klaim, baris tidak batal
      const [pjtRows] = await db.query(
        `SELECT DISTINCT ptd_nomor AS nomor
         FROM finance.tpengajuan_transfer_dtl
         WHERE ptd_trs = ? AND ptd_batal = ''`,
        [nomor],
      );
      pjtRows.forEach((r) =>
        forward.push({ type: "PENGAJUAN_TRANSFER", nomor: r.nomor }),
      );
      break;
    }
    case "PENGAJUAN_TRANSFER": {
      // ptd_trs berisi dokumen sumber yang beragam (klaim, voucher, PO Lain-lain, dst.),
      // jadi dicocokkan ke tabel masing-masing; query terpisah karena beda database
      const [trsRows] = await db.query(
        `SELECT DISTINCT ptd_trs AS nomor
         FROM finance.tpengajuan_transfer_dtl
         WHERE ptd_nomor = ? AND ptd_batal = '' AND ptd_trs <> ''`,
        [nomor],
      );
      if (trsRows.length) {
        const daftar = trsRows.map((r) => r.nomor);
        const [klaimRows] = await db.query(
          `SELECT kkh_nomor AS nomor FROM tklaim_kaskecil_hdr WHERE kkh_nomor IN (?)`,
          [daftar],
        );
        klaimRows.forEach((r) =>
          backward.push({ type: "KLAIM_KAS_KECIL", nomor: r.nomor }),
        );
        const [vouRows] = await db.query(
          `SELECT vou_nomor AS nomor FROM tvoucher_hdr WHERE vou_nomor IN (?)`,
          [daftar],
        );
        vouRows.forEach((r) =>
          backward.push({ type: "VOUCHER", nomor: r.nomor }),
        );
        const [poRows] = await db.query(
          `SELECT po_nomor AS nomor FROM tpo_hdr WHERE po_jenis = 4 AND po_nomor IN (?)`,
          [daftar],
        );
        poRows.forEach((r) => backward.push({ type: "PO", nomor: r.nomor }));
      }
      const st = await getStatusPengajuanTransfer(nomor);
      if (st.terealisasi > 0)
        forward.push({ type: "REALISASI_PENGAJUAN_TRANSFER", nomor });
      break;
    }
    case "REALISASI_PENGAJUAN_TRANSFER": {
      backward.push({ type: "PENGAJUAN_TRANSFER", nomor });

      // BBK utama, satu per baris yang sudah direalisasi
      const [jurRows] = await db.query(
        `SELECT DISTINCT ptd_jur_no AS jur
         FROM finance.tpengajuan_transfer_dtl
         WHERE ptd_nomor = ? AND ptd_jur_no <> ''`,
        [nomor],
      );
      for (const r of jurRows) {
        const n = await jurnalKeluarNode(r.jur);
        if (n) forward.push(n);
      }

      // Jurnal otomatis: BKM tujuan + BBK biaya manual klaim (NN + nomor PJT)
      const [otoRows] = await db.query(
        `SELECT jur_no AS nomor, jur_tipetransaksi AS tipe
         FROM finance.tjurnal
         WHERE jur_otomatis = 1 AND jur_tipetransaksi IN ('BKM', 'BBK')
           AND SUBSTRING(jur_no, 3) = ?
         ORDER BY jur_no`,
        [nomor],
      );
      otoRows.forEach((r) => forward.push({ type: r.tipe, nomor: r.nomor }));

      // PO Lain-lain yang dibayar lewat baris ini -> QC Bahan atas PO + supplier yang sama
      const [bayarRows] = await db.query(
        `SELECT DISTINCT ptd_trs AS po, ptd_sup_kode AS sup
         FROM finance.tpengajuan_transfer_dtl
         WHERE ptd_nomor = ? AND ptd_batal = '' AND ptd_jur_no <> ''
           AND ptd_trs <> '' AND ptd_sup_kode <> ''`,
        [nomor],
      );
      if (bayarRows.length) {
        const [poLain] = await db.query(
          `SELECT po_nomor FROM tpo_hdr WHERE po_jenis = 4 AND po_nomor IN (?)`,
          [[...new Set(bayarRows.map((r) => r.po))]],
        );
        const poLainSet = new Set(poLain.map((r) => r.po_nomor));
        for (const r of bayarRows.filter((x) => poLainSet.has(x.po))) {
          const qc = await qcPoLainBySupplier(r.po, r.sup);
          qc.forEach((n) => forward.push({ type: "QC_BAHAN", nomor: n }));
        }
      }
      break;
    }
    case "BKM": {
      const pjt = await pjtDariJurnalOtomatis(nomor);
      if (pjt)
        backward.push({ type: "REALISASI_PENGAJUAN_TRANSFER", nomor: pjt });
      break;
    }
    case "REKAP_PEMBAYARAN": {
      const [rows] = await db.query(
        `SELECT DISTINCT rkbd_vou_nomor AS vou, rkbd_tipe AS tipe
         FROM trekap_bayar_dtl
         WHERE rkbd_nomor = ? AND rkbd_vou_nomor <> ''`,
        [nomor],
      );
      const hulu = new Set();
      const hilir = new Set();
      rows.forEach((r) => (r.tipe === "VOU" ? hulu : hilir).add(r.vou));
      hulu.forEach((v) => backward.push({ type: "VOUCHER", nomor: v }));
      hilir.forEach((v) => forward.push({ type: "VOUCHER", nomor: v }));
      break;
    }
    case "QC_BAHAN": {
      const [[qc]] = await db.query(
        `SELECT h.qc_po_nomor AS po, ph.po_jenis AS jenis,
                COALESCE(NULLIF(p.pod_sup_kode, ''), ph.po_sup_kode) AS sup
         FROM tqc_bahan_hdr h
         LEFT JOIN tpo_hdr ph ON ph.po_nomor = h.qc_po_nomor
         LEFT JOIN tpo_dtl p ON p.pod_po_nomor = h.qc_po_nomor
                            AND p.pod_nourut = h.qc_pod_nourut
         WHERE h.qc_nomor = ?`,
        [nomor],
      );
      if (qc?.po) {
        // PO Lain-lain yang sudah dibayar: hulunya Realisasi, bukan PO langsung
        let lewatPjt = false;
        if (Number(qc.jenis) === 4 && qc.sup) {
          const pjt = await getRealisasiPjtPoLain(qc.po, qc.sup);
          pjt.forEach((n) =>
            backward.push({ type: "REALISASI_PENGAJUAN_TRANSFER", nomor: n }),
          );
          lewatPjt = pjt.length > 0;
        }
        if (!lewatPjt) backward.push({ type: "PO", nomor: qc.po });
      }

      if (await adaTindakLanjutQc(nomor)) {
        forward.push({ type: "TINDAK_LANJUT_QC", nomor });
      } else {
        (await bpbDariQc(nomor)).forEach((b) =>
          forward.push({ type: "BPB", nomor: b }),
        );
      }
      break;
    }
    case "TINDAK_LANJUT_QC": {
      backward.push({ type: "QC_BAHAN", nomor });
      (await bpbDariQc(nomor)).forEach((b) =>
        forward.push({ type: "BPB", nomor: b }),
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
    case "MAKLON": {
      const [sjkRows] = await db.query(
        `SELECT sjk_nomor AS nomor FROM tmaklon_sj_keluar_hdr WHERE sjk_mkl_nomor = ? ORDER BY sjk_nomor`,
        [nomor],
      );
      sjkRows.forEach((r) =>
        forward.push({ type: "SJ_KELUAR_MAKLON", nomor: r.nomor }),
      );
      const [lhkRows] = await db.query(
        `SELECT lhk_nomor AS nomor FROM tdtf_maklon
         WHERE mkl_nomor = ? AND lhk_nomor <> '' ORDER BY lhk_nomor`,
        [nomor],
      );
      lhkRows.forEach((r) =>
        forward.push({ type: "LHK_MAKLON", nomor: r.nomor }),
      );
      break;
    }
    case "SJ_KELUAR_MAKLON": {
      const [[row]] = await db.query(
        `SELECT sjk_mkl_nomor AS mkl FROM tmaklon_sj_keluar_hdr WHERE sjk_nomor = ?`,
        [nomor],
      );
      if (row?.mkl) backward.push({ type: "MAKLON", nomor: row.mkl });
      break;
    }
    case "LHK_MAKLON": {
      const [[row]] = await db.query(
        `SELECT mkl_nomor AS mkl FROM tdtf_maklon WHERE lhk_nomor = ? LIMIT 1`,
        [nomor],
      );
      if (row?.mkl) backward.push({ type: "MAKLON", nomor: row.mkl });
      const [sjRows] = await db.query(
        `SELECT DISTINCT sd.sjmd_sjm_nomor AS nomor
         FROM tsj_maklon_dtl sd
         INNER JOIN tdtf_maklon dm ON dm.id = sd.sjmd_dtf_maklon_id
         WHERE dm.lhk_nomor = ?`,
        [nomor],
      );
      sjRows.forEach((r) =>
        forward.push({ type: "SJ_HASIL_MAKLON", nomor: r.nomor }),
      );
      break;
    }
    case "SJ_HASIL_MAKLON": {
      const [lhkRows] = await db.query(
        `SELECT DISTINCT dm.lhk_nomor AS nomor
         FROM tsj_maklon_dtl sd
         INNER JOIN tdtf_maklon dm ON dm.id = sd.sjmd_dtf_maklon_id
         WHERE sd.sjmd_sjm_nomor = ? AND dm.lhk_nomor <> ''`,
        [nomor],
      );
      lhkRows.forEach((r) =>
        backward.push({ type: "LHK_MAKLON", nomor: r.nomor }),
      );
      if (!lhkRows.length) {
        const [[row]] = await db.query(
          `SELECT sjm_mkl_nomor AS mkl FROM tsj_maklon_hdr WHERE sjm_nomor = ?`,
          [nomor],
        );
        if (row?.mkl) backward.push({ type: "MAKLON", nomor: row.mkl });
      }
      const [trmRows] = await db.query(
        `SELECT DISTINCT t.mtd_mth_nomor AS nomor
         FROM tmaklon_terima_dtl t
         INNER JOIN tsj_maklon_dtl sd ON sd.sjmd_id = t.mtd_sjmd_id
         WHERE sd.sjmd_sjm_nomor = ?`,
        [nomor],
      );
      trmRows.forEach((r) =>
        forward.push({ type: "TERIMA_MAKLON", nomor: r.nomor }),
      );
      break;
    }
    case "TERIMA_MAKLON": {
      const [sjRows] = await db.query(
        `SELECT DISTINCT sd.sjmd_sjm_nomor AS nomor
         FROM tmaklon_terima_dtl t
         INNER JOIN tsj_maklon_dtl sd ON sd.sjmd_id = t.mtd_sjmd_id
         WHERE t.mtd_mth_nomor = ?`,
        [nomor],
      );
      sjRows.forEach((r) =>
        backward.push({ type: "SJ_HASIL_MAKLON", nomor: r.nomor }),
      );
      break;
    }
    case "COMPLAIN_CUSTOMER": {
      const [[row]] = await db.query(
        `SELECT tc_spk_nomor AS ref FROM tcomplain WHERE tc_nomor = ?`,
        [nomor],
      );
      if (row?.ref) {
        const resolved = await resolveProduksiNomor(row.ref);
        if (resolved) backward.push(resolved);
      }
      break;
    }
    case "BAP_PRODUKSI": {
      const [[row]] = await db.query(
        `SELECT bap_spk_nomor AS ref FROM tkpi_bapproduksi WHERE bap_nomor = ?`,
        [nomor],
      );
      if (row?.ref) {
        const resolved = await resolveProduksiNomor(row.ref);
        if (resolved) backward.push(resolved);
      }
      break;
    }

    default:
      throw new Error(`Tipe node tidak dikenali: ${type}`);
  }

  return { backward, forward };
};

const expand = async (type, nomor, userKode) => {
  if (!NODE_TYPES.includes(type))
    throw new Error(`Tipe node tidak dikenali: ${type}`);
  const boleh = await getTipeBoleh(userKode);
  if (!boleh.has(type)) throw noAkses();

  const node = await getNodeDetail(type, nomor);
  if (!node)
    throw new Error(`Data ${type} dengan nomor "${nomor}" tidak ditemukan.`);

  const related = await getRelated(type, nomor);

  const withContext = (r) =>
    r.filterSpk ? { filterSpk: r.filterSpk } : undefined;

  // Tetangga yang tipenya tidak boleh dilihat: hanya tipe + nomor (terkunci)
  const detailAtauKunci = (r) =>
    boleh.has(r.type)
      ? getNodeDetail(r.type, r.nomor, withContext(r))
      : { type: r.type, nomor: r.nomor, label: r.nomor, locked: true };

  const [backwardDetails, forwardDetails] = await Promise.all([
    Promise.all(related.backward.map(detailAtauKunci)),
    Promise.all(related.forward.map(detailAtauKunci)),
  ]);

  return {
    node,
    backward: backwardDetails.filter(Boolean),
    forward: forwardDetails.filter(Boolean),
  };
};

// Node virtual (nomor sama dengan dokumen induk): hanya dicari bila tipenya
// dipilih eksplisit, supaya tidak muncul dobel di "Semua Tipe".
const TIPE_LEWATI_SEMUA_TIPE = new Set([
  "PENYELESAIAN_UANG_MUKA",
  "REALISASI_PENGAJUAN_TRANSFER",
  "TINDAK_LANJUT_QC",
]);

const search = async (type, query, userKode) => {
  if (!query) return [];
  const boleh = await getTipeBoleh(userKode);
  if (type && NODE_TYPES.includes(type) && !boleh.has(type)) throw noAkses();
  const like = `%${query}%`;
  const limit = 20;

  const queries = {
    PENGAJUAN_DANA: `SELECT pjh_nomor AS nomor, pjh_keterangan AS label, pjh_tanggal AS tgl FROM ga2.tpengajuan2_hdr WHERE pjh_nomor LIKE ? ORDER BY pjh_tanggal DESC LIMIT ${limit}`,
    PENGAJUAN_UANG_MUKA: `SELECT pum_nomor AS nomor, pum_keterangan AS label, pum_tanggal AS tgl FROM tpengajuan_uang_muka_hdr WHERE pum_nomor LIKE ? ORDER BY pum_tanggal DESC LIMIT ${limit}`,
    PENYELESAIAN_UANG_MUKA: `SELECT bon_nomor AS nomor, bon_keterangan AS label, bon_tanggal AS tgl FROM finance.tkasbon WHERE bon_selesai <> 0 AND bon_nomor LIKE ? ORDER BY bon_tanggal DESC LIMIT ${limit}`,
    BKK: `SELECT jur_no AS nomor, jur_keterangan AS label, jur_tanggal AS tgl FROM finance.tjurnal WHERE jur_tipetransaksi = 'BKK' AND jur_otomatis = 0 AND jur_no LIKE ? ORDER BY jur_tanggal DESC LIMIT ${limit}`,
    BBK: `SELECT jur_no AS nomor, jur_keterangan AS label, jur_tanggal AS tgl FROM finance.tjurnal WHERE jur_tipetransaksi = 'BBK' AND jur_otomatis = 0 AND jur_no LIKE ? ORDER BY jur_tanggal DESC LIMIT ${limit}`,
    KLAIM_KAS_KECIL: `SELECT kkh_nomor AS nomor, kkh_keterangan AS label, kkh_tanggal AS tgl FROM tklaim_kaskecil_hdr WHERE kkh_nomor LIKE ? ORDER BY kkh_tanggal DESC LIMIT ${limit}`,
    PENGAJUAN_TRANSFER: `SELECT pth_nomor AS nomor, pth_nomor AS label, pth_tanggal AS tgl FROM finance.tpengajuan_transfer_hdr WHERE pth_nomor LIKE ? ORDER BY pth_tanggal DESC LIMIT ${limit}`,
    REALISASI_PENGAJUAN_TRANSFER: `SELECT h.pth_nomor AS nomor, h.pth_nomor AS label, h.pth_tanggal AS tgl FROM finance.tpengajuan_transfer_hdr h WHERE h.pth_nomor LIKE ? AND EXISTS (SELECT 1 FROM finance.tpengajuan_transfer_dtl d WHERE d.ptd_nomor = h.pth_nomor AND d.ptd_jur_no <> '') ORDER BY h.pth_tanggal DESC LIMIT ${limit}`,
    BKM: `SELECT jur_no AS nomor, jur_keterangan AS label, jur_tanggal AS tgl FROM finance.tjurnal WHERE jur_tipetransaksi = 'BKM' AND jur_no LIKE ? ORDER BY jur_tanggal DESC LIMIT ${limit}`,
    REKAP_PEMBAYARAN: `SELECT rkb_nomor AS nomor, rkb_keterangan AS label, rkb_tanggal AS tgl FROM trekap_bayar_hdr WHERE rkb_nomor LIKE ? ORDER BY rkb_tanggal DESC LIMIT ${limit}`,
    PERMINTAAN_DESAIN: `SELECT pd_nomor AS nomor, pd_nama_project AS label, pd_tanggal AS tgl FROM tpermintaan_desain WHERE pd_nomor LIKE ? ORDER BY pd_tanggal DESC LIMIT ${limit}`,
    LHK_DESAIN: `SELECT l.lhk_nomor AS nomor, p.pd_nama_project AS label, l.lhk_tanggal AS tgl FROM tlhk_desain l LEFT JOIN tpermintaan_desain p ON p.pd_nomor = l.lhk_pd_nomor WHERE l.lhk_nomor LIKE ? ORDER BY l.lhk_tanggal DESC LIMIT ${limit}`,
    PRA_ORDER: `SELECT pro_nomor AS nomor, pro_nama_pekerjaan AS label, pro_tanggal AS tgl FROM tpraorder_hdr WHERE pro_nomor LIKE ? ORDER BY pro_tanggal DESC LIMIT ${limit}`,
    KONFIRMASI_PRA_ORDER: `SELECT h.pro_nomor AS nomor, h.pro_nama_pekerjaan AS label, h.pro_tanggal AS tgl FROM tpraorder_hdr h LEFT JOIN tdivisi v ON v.kode = h.pro_divisi WHERE h.pro_nomor LIKE ? AND UPPER(IFNULL(v.Divisi, '')) NOT IN (${SQL_DIVISI_TANPA_KONFIRMASI}) ORDER BY h.pro_tanggal DESC LIMIT ${limit}`,
    PERMINTAAN_HARGA: `SELECT mh_nomor AS nomor, mh_nama AS label, mh_tanggal AS tgl FROM tmintaharga WHERE mh_nomor LIKE ? ORDER BY mh_tanggal DESC LIMIT ${limit}`,
    PENAWARAN: `SELECT pen_nomor AS nomor, pen_keterangan AS label, pen_tanggal AS tgl FROM tpenawaran_hdr WHERE pen_nomor LIKE ? ORDER BY pen_tanggal DESC LIMIT ${limit}`,
    MAP: `SELECT mspk_nomor AS nomor, mspk_nama AS label, mspk_tanggal AS tgl FROM tmemospk WHERE mspk_nomor LIKE ? ORDER BY mspk_tanggal DESC LIMIT ${limit}`,
    SPK: `SELECT spk_nomor AS nomor, spk_nama AS label, spk_tanggal AS tgl FROM tspk WHERE spk_nomor LIKE ? AND spk_aktif = 'Y' ORDER BY spk_tanggal DESC LIMIT ${limit}`,
    SO: `SELECT so_nomor AS nomor, so_nama AS label, so_tanggal AS tgl FROM tsalesorder WHERE so_nomor LIKE ? AND so_aktif = 'Y' ORDER BY so_tanggal DESC LIMIT ${limit}`,
    PROOF: `SELECT pf_nomor AS nomor, pf_nomor AS label, pf_tanggal AS tgl FROM tproofgarmen_hdr WHERE pf_nomor LIKE ? ORDER BY pf_tanggal DESC LIMIT ${limit}`,
    SJ_MEMO: `SELECT sj_nomor AS nomor, sj_nomor AS label, sj_tanggal AS tgl FROM tsj_hdr_memo WHERE sj_nomor LIKE ? ORDER BY sj_tanggal DESC LIMIT ${limit}`,
    MPPB: `SELECT mpb_nomor AS nomor, mpb_nama AS label, mpb_tanggal AS tgl FROM tmpb WHERE mpb_nomor LIKE ? ORDER BY mpb_tanggal DESC LIMIT ${limit}`,
    PO: `SELECT po_nomor AS nomor, po_nomor AS label, po_tanggal AS tgl FROM tpo_hdr WHERE po_nomor LIKE ? ORDER BY po_tanggal DESC LIMIT ${limit}`,
    BPB: `SELECT bpb_nomor AS nomor, bpb_nomor AS label, bpb_tanggal AS tgl FROM tbpb_hdr WHERE bpb_nomor LIKE ? ORDER BY bpb_tanggal DESC LIMIT ${limit}`,
    QC_BAHAN: `SELECT qc_nomor AS nomor, qc_keterangan AS label, qc_tgl_datang AS tgl FROM tqc_bahan_hdr WHERE qc_nomor LIKE ? ORDER BY qc_tgl_datang DESC LIMIT ${limit}`,
    TINDAK_LANJUT_QC: `SELECT h.qc_nomor AS nomor, h.qc_keterangan AS label, h.qc_tgl_datang AS tgl FROM tqc_bahan_hdr h WHERE h.qc_nomor LIKE ? AND h.qc_status <> 'DRAFT' AND (EXISTS (SELECT 1 FROM tqc_bahan_keputusan k WHERE k.qck_qc_nomor = h.qc_nomor AND k.qck_tahap = 'PEMBELIAN') OR EXISTS (SELECT 1 FROM tqc_bahan_dtl d WHERE d.qcd_qc_nomor = h.qc_nomor AND IFNULL(d.qcd_keputusan, '') IN ('', 'TUNDA'))) ORDER BY h.qc_tgl_datang DESC LIMIT ${limit}`,
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
    MAKLON: `SELECT mkl_nomor AS nomor, mkl_keterangan AS label, mkl_tanggal AS tgl FROM tmaklon_hdr WHERE mkl_nomor LIKE ? ORDER BY mkl_tanggal DESC LIMIT ${limit}`,
    SJ_KELUAR_MAKLON: `SELECT sjk_nomor AS nomor, sjk_mkl_nomor AS label, sjk_tanggal AS tgl FROM tmaklon_sj_keluar_hdr WHERE sjk_nomor LIKE ? ORDER BY sjk_tanggal DESC LIMIT ${limit}`,
    LHK_MAKLON: `SELECT lhk_nomor AS nomor, mkl_nomor AS label, tanggal AS tgl FROM tdtf_maklon WHERE lhk_nomor LIKE ? ORDER BY tanggal DESC LIMIT ${limit}`,
    SJ_HASIL_MAKLON: `SELECT sjm_nomor AS nomor, sjm_mkl_nomor AS label, sjm_tanggal AS tgl FROM tsj_maklon_hdr WHERE sjm_nomor LIKE ? ORDER BY sjm_tanggal DESC LIMIT ${limit}`,
    TERIMA_MAKLON: `SELECT mth_nomor AS nomor, mth_mkl_nomor AS label, mth_tanggal AS tgl FROM tmaklon_terima_hdr WHERE mth_nomor LIKE ? ORDER BY mth_tanggal DESC LIMIT ${limit}`,
    COMPLAIN_CUSTOMER: `SELECT tc_nomor AS nomor, tc_description AS label, tc_date AS tgl FROM tcomplain WHERE tc_nomor LIKE ? ORDER BY tc_date DESC LIMIT ${limit}`,
    BAP_PRODUKSI: `SELECT bap_nomor AS nomor, bap_masalah AS label, bap_tanggal AS tgl FROM tkpi_bapproduksi WHERE bap_nomor LIKE ? ORDER BY bap_tanggal DESC LIMIT ${limit}`,
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
  const entries = Object.entries(queries).filter(
    ([t]) =>
      boleh.has(t) &&
      !TIPE_LEWATI_SEMUA_TIPE.has(t) &&
      !(t === "KONFIRMASI_PRA_ORDER" && boleh.has("PRA_ORDER")),
  );
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

module.exports = { expand, search, getTipeBoleh, NODE_TYPES };
