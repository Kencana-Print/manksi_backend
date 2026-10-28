const db = require("../../config/database");
const { getRekap } = require("../laporan/marketing/rekapPenawaranService");
const tutupBukuService = require("../tutupBukuService");
const {
  JENIS_PO_BAHAN,
  LABEL_JENIS_PO,
  TANGGAL_MULAI_PO_BAHAN,
  SQL_BPB_MILIK_PO,
} = require("./voucherPoBahanKonstanta");

// ── PO Lain-lain (tipe nota POL) ──────────────────────────────────────
// Rumus total sama persis dengan SQL_TOTAL_PO_LAIN di pengajuanTransferService.js
const SQL_TOTAL_PO_LAIN = `
  ROUND(
    SUM(d.pod_Jumlah * d.pod_hargabeli * (100 - d.pod_disc) / 100)
    * IF(h.po_status_ppn = 1, (100 + h.po_ppn) / 100, 1),
  2)`;

// Syarat tidak boleh lewat Uang Muka (pola sama dengan getPoLainOptions di Pengajuan Transfer)
const SQL_ADA_UANG_MUKA = `
  EXISTS (
    SELECT 1 FROM tpengajuan_uang_muka_dtl pd
    JOIN tpengajuan_uang_muka_hdr ph ON ph.pum_nomor = pd.pumd_pum_nomor
    JOIN tpo_dtl x ON x.pod_po_Nomor = pd.pumd_nomor_sumber
                  AND x.pod_nourut = pd.pumd_item_nourut
    WHERE pd.pumd_sumber = 'PO_LAIN_LAIN'
      AND pd.pumd_nomor_sumber = ?
      AND x.pod_sup_kode = ?
      AND (ph.pum_status = 'DIAJUKAN'
           OR (ph.pum_status = 'REALISASI' AND pd.pumd_status_acc = 'ACC'))
  )`;

// Info satu (PO, supplier): total, yang sudah terpakai (voucher POL lain +
// Pengajuan Transfer langsung), dan status Uang Muka.
// excludeVou = nomor voucher yang sedang diedit; statusPpn null = tanpa filter.
const getInfoPoLain = async (po, sup, excludeVou = "", statusPpn = null) => {
  const [[tot]] = await db.query(
    `SELECT h.po_nomor AS nomor,
            DATE_FORMAT(h.po_tanggal,'%Y-%m-%d') AS tanggal,
            ${SQL_TOTAL_PO_LAIN} AS total
     FROM tpo_hdr h
     INNER JOIN tpo_dtl d
       ON d.pod_po_Nomor = h.po_nomor AND d.pod_bhn_kode <> ''
     WHERE h.po_nomor = ? AND h.po_jenis = 4 AND d.pod_sup_kode = ?
       ${statusPpn === null ? "" : "AND h.po_status_ppn = ?"}
     GROUP BY h.po_nomor, h.po_tanggal, h.po_status_ppn, h.po_ppn`,
    statusPpn === null ? [po, sup] : [po, sup, statusPpn],
  );
  if (!tot) return null;

  const [[vou]] = await db.query(
    `SELECT IFNULL(SUM(v.voud_total), 0) AS sudah
     FROM tvoucher_dtl v
     INNER JOIN tvoucher_hdr vh ON vh.vou_nomor = v.voud_vou_nomor
     WHERE v.voud_nota = ? AND v.voud_type = 'POL'
       AND vh.vou_sup_kode = ? AND v.voud_vou_nomor <> ?`,
    [tot.nomor, sup, excludeVou],
  );
  const [[pt]] = await db.query(
    `SELECT IFNULL(SUM(ptd_nominal), 0) AS sudah
     FROM finance.tpengajuan_transfer_dtl
     WHERE ptd_trs = ? AND ptd_sup_kode = ? AND ptd_batal = ''`,
    [tot.nomor, sup],
  );
  const [[um]] = await db.query(`SELECT ${SQL_ADA_UANG_MUKA} AS ada`, [
    tot.nomor,
    sup,
  ]);

  return {
    nomor: tot.nomor,
    tanggal: tot.tanggal,
    total: Number(tot.total),
    sudah: Number(vou.sudah) + Number(pt.sudah),
    adaUangMuka: Number(um.ada) === 1,
  };
};

// ── PO Bahan (tipe nota POB) — jenis 0/3 Bahan, 1 Greige, 2 Celup ─────
// Dasar nilai: tpo_dtl.pod_Jumlah, rumus sama dengan POL (SQL_TOTAL_PO_LAIN).
// pod_sup_kode di tpo_dtl kosong untuk jenis 0-3 → supplier dari tpo_hdr.po_sup_kode.
// Kepemilikan BPB oleh PO: lihat SQL_BPB_MILIK_PO (PO Greige tidak punya BPB sendiri).
// cekTanggal=false dipakai saat edit voucher yang sudah memuat PO itu.
const getInfoPoBahan = async (
  po,
  sup,
  { excludeVou = "", statusPpn = null, cekTanggal = true } = {},
) => {
  const params = [po, JENIS_PO_BAHAN, sup];
  let filter = "";
  if (cekTanggal) {
    filter += " AND h.po_tanggal >= ?";
    params.push(TANGGAL_MULAI_PO_BAHAN);
  }
  if (statusPpn !== null) {
    filter += " AND h.po_status_ppn = ?";
    params.push(statusPpn);
  }
  const [[tot]] = await db.query(
    `SELECT h.po_nomor AS nomor, h.po_jenis AS jenis,
            DATE_FORMAT(h.po_tanggal,'%Y-%m-%d') AS tanggal,
            ${SQL_TOTAL_PO_LAIN} AS total
     FROM tpo_hdr h
     INNER JOIN tpo_dtl d
       ON d.pod_po_Nomor = h.po_nomor AND d.pod_bhn_kode <> ''
     WHERE h.po_nomor = ? AND h.po_jenis IN (?) AND h.po_sup_kode = ?${filter}
     GROUP BY h.po_nomor, h.po_jenis, h.po_tanggal, h.po_status_ppn, h.po_ppn`,
    params,
  );
  if (!tot) return null;

  const [[vou]] = await db.query(
    `SELECT IFNULL(SUM(v.voud_total), 0) AS sudah
     FROM tvoucher_dtl v
     INNER JOIN tvoucher_hdr vh ON vh.vou_nomor = v.voud_vou_nomor
     WHERE v.voud_nota = ? AND v.voud_type = 'POB'
       AND vh.vou_sup_kode = ? AND v.voud_vou_nomor <> ?`,
    [tot.nomor, sup, excludeVou],
  );

  // Ada BPB milik PO ini yang sudah divoucher (voucher lain) → POB dilarang
  const [[bv]] = await db.query(
    `SELECT COUNT(*) AS n
     FROM tpo_hdr p
     CROSS JOIN tbpb_hdr b
     INNER JOIN tvoucher_dtl v ON v.voud_nota = b.bpb_nomor
     WHERE p.po_nomor = ? AND v.voud_vou_nomor <> ?
       AND ${SQL_BPB_MILIK_PO("b", "p")}`,
    [tot.nomor, excludeVou],
  );

  return {
    nomor: tot.nomor,
    jenis: Number(tot.jenis),
    tanggal: tot.tanggal,
    total: Number(tot.total),
    sudah: Number(vou.sudah),
    adaVoucherBpb: Number(bv.n) > 0,
  };
};

// Alasan spesifik saat getInfoPoBahan mengembalikan null (dipakai getNotaDetail dan save)
const alasanPoBahanTidakValid = async (po, sup, statusPpn) => {
  const [[p]] = await db.query(
    `SELECT po_jenis, po_sup_kode, po_status_ppn,
            DATE_FORMAT(po_tanggal,'%Y-%m-%d') AS tanggal
     FROM tpo_hdr WHERE po_nomor = ?`,
    [po],
  );
  if (!p) return `PO ${po} tidak ditemukan.`;
  if (!JENIS_PO_BAHAN.includes(Number(p.po_jenis))) {
    return `PO ${po} bukan PO Bahan, Greige, atau Celup.`;
  }
  if (String(p.po_sup_kode || "").trim() !== String(sup).trim()) {
    return `PO ${po} milik supplier ${p.po_sup_kode}, bukan ${sup}.`;
  }
  if (Number(p.po_status_ppn) !== Number(statusPpn)) {
    return `Status PPN PO (${Number(p.po_status_ppn) ? "PPN" : "Non PPN"}) tidak sama dengan voucher (${Number(statusPpn) ? "PPN" : "Non PPN"}).`;
  }
  if (p.tanggal < TANGGAL_MULAI_PO_BAHAN) {
    return `PO ${po} bertanggal sebelum ${TANGGAL_MULAI_PO_BAHAN} dan tidak bisa dibayar lewat tipe PO Bahan.`;
  }
  return `PO ${po} tidak memiliki baris bahan.`;
};

// ── Cek tutup buku — sama pola dengan voucherPembayaranService.js ────
const cekIsTutupBuku = async (tanggal) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const limitDate =
    await tutupBukuService.getTanggalTutupBukuUntukTanggal(tanggal);
  limitDate.setHours(0, 0, 0, 0);

  const zCloseManual = await tutupBukuService.getManualTutupBuku("VOU");
  const tgl = new Date(tanggal);

  if (zCloseManual) {
    zCloseManual.setHours(0, 0, 0, 0);
    return tgl < zCloseManual;
  }
  return limitDate < today;
};

// ── Generate nomor: VOU/XXXXX/YYYY ───────────────────────────────────
// Delphi getmaxnomor: max(substr(vou_nomor,5,5)) + 100001, ambil 5 digit kanan
const getMaxNomor = async (tahun) => {
  const [[row]] = await db.query(
    `SELECT IFNULL(MAX(CAST(SUBSTR(vou_nomor, 5, 5) AS UNSIGNED)), 0) AS jumlah
     FROM tvoucher_hdr
     WHERE LEFT(vou_nomor, 3) = 'VOU'
       AND RIGHT(vou_nomor, 4) = ?`,
    [tahun],
  );
  const jumlah = 100001 + Number(row.jumlah);
  const seq = String(jumlah).slice(-5);
  return `VOU/${seq}/${tahun}`;
};

// ── Supplier ──────────────────────────────────────────────────────────
// Delphi edtSupKodeExit: SELECT sup_kode,sup_nama,sup_rekening,sup_bank,sup_cabang,sup_atasnama
const getSupplier = async (kode) => {
  const [[row]] = await db.query(
    `SELECT sup_kode AS kode, sup_nama AS nama, sup_rekening AS rekening,
            sup_bank AS bank, sup_cabang AS cabang, sup_atasnama AS atasnama
     FROM tsupplier
     WHERE sup_kode = ?`,
    [kode],
  );
  if (!row) throw new Error("Kode supplier tidak ditemukan.");
  return row;
};

// ── Search supplier ───────────────────────────────────────────────────
const searchSupplier = async (search = "") => {
  const [rows] = await db.query(
    `SELECT sup_kode AS kode, sup_nama AS nama
     FROM tsupplier
     WHERE sup_aktif = 'Y'
       AND (sup_kode LIKE ? OR sup_nama LIKE ?)
     ORDER BY sup_nama
     `,
    [`%${search}%`, `%${search}%`],
  );
  return rows;
};

// ── getBS untuk BPJ ───────────────────────────────────────────────────
// Delphi getbs: SELECT SUM(bpjd_bs_mitra) FROM tbpj_dtl WHERE bpjd_bpj_nomor=?
const getBs = async (nomor) => {
  const [[row]] = await db.query(
    `SELECT IFNULL(SUM(bpjd_bs_mitra), 0) AS bs
     FROM tbpj_dtl
     WHERE bpjd_bpj_nomor = ?`,
    [nomor],
  );
  return Number(row?.bs || 0);
};

// ── Load detail nota berdasarkan prefix ───────────────────────────────
// Delphi loaddatadetail: prefix determines query
// statusPpn: 0 atau 1
const getNotaDetail = async (
  kode,
  statusPpn = 0,
  type = null,
  supKode = "",
) => {
  const prefix = kode.substring(0, 3).toUpperCase();
  const resolvedType = type || prefix;

  if (prefix === "PBG") {
    const [[lain]] = await db.query(
      `SELECT 1 AS x
       FROM tbpb_hdr b
       INNER JOIN tpo_hdr p ON p.po_nomor = b.bpb_po_nomor
       WHERE b.bpb_nomor = ? AND p.po_jenis = 4`,
      [kode],
    );
    if (lain) {
      throw new Error(
        "BPB dari PO Lain-lain dibayar lewat Pengajuan Transfer atau Uang Muka. Tidak bisa dibuat Voucher.",
      );
    }
    const [[sudahPob]] = await db.query(
      `SELECT 1 AS x
       FROM tvoucher_dtl v
       INNER JOIN tpo_hdr c ON c.po_nomor = v.voud_nota
       INNER JOIN tbpb_hdr b ON b.bpb_nomor = ?
       WHERE v.voud_type = 'POB'
         AND ${SQL_BPB_MILIK_PO("b", "c")}
       LIMIT 1`,
      [kode],
    );
    if (sudahPob) {
      throw new Error(
        "BPB ini milik PO yang sudah dibayar lewat tipe PO Bahan. Tidak bisa divoucher lagi.",
      );
    }
  }

  if (type === "POL") {
    if (!supKode) throw new Error("Pilih supplier dahulu.");
    const info = await getInfoPoLain(kode, supKode, "", Number(statusPpn));
    if (!info) {
      throw new Error(
        "PO Lain-lain tidak ditemukan untuk supplier ini (atau status PPN tidak sama dengan voucher).",
      );
    }
    if (info.adaUangMuka) {
      throw new Error(
        `PO ${info.nomor} (supplier ${supKode}) sudah diajukan lewat Uang Muka.`,
      );
    }
    const nilai = Math.round((info.total - info.sudah) * 100) / 100;
    if (nilai <= 0.005) {
      throw new Error(`PO ${info.nomor} sudah terbayar / diajukan seluruhnya.`);
    }
    return {
      tipe: "POL",
      nomor: info.nomor,
      tanggal: info.tanggal,
      keterangan: "PO Lain-lain",
      jenis: "",
      nilai,
      nilaiMax: nilai,
      bs: 0,
      tarif: 0,
      potongan: 0,
      total: nilai,
    };
  }

  if (type === "POB") {
    if (!supKode) throw new Error("Pilih supplier dahulu.");
    const info = await getInfoPoBahan(kode, supKode, {
      statusPpn: Number(statusPpn),
    });
    if (!info) {
      throw new Error(await alasanPoBahanTidakValid(kode, supKode, statusPpn));
    }
    if (info.adaVoucherBpb) {
      throw new Error(
        `BPB dari PO ${info.nomor} sudah pernah divoucher. Tidak bisa dibayar lewat PO Bahan.`,
      );
    }
    const nilai = Math.round((info.total - info.sudah) * 100) / 100;
    if (nilai <= 0.005) {
      throw new Error(`PO ${info.nomor} sudah terbayar seluruhnya.`);
    }
    return {
      tipe: "POB",
      nomor: info.nomor,
      tanggal: info.tanggal,
      keterangan: LABEL_JENIS_PO[info.jenis] || "PO Bahan",
      jenis: "",
      nilai,
      nilaiMax: nilai,
      bs: 0,
      tarif: 0,
      potongan: 0,
      total: nilai,
    };
  }

  let sql = "";
  let params = [kode];

  if (prefix === "RTG") {
    sql = `
      SELECT 'RET' AS Tipe, ret_nomor AS Nomor,
             DATE_FORMAT(ret_tanggal, '%Y-%m-%d') AS Tanggal,
             ret_keterangan AS Keterangan,
             SUM(RETD_HARGA * RETD_jumlah *
               IF(ret_sts_ppn=1,((100+ret_ppn)/100),1)) AS Total,
             IFNULL((
               SELECT SUM(voud_total) FROM tvoucher_dtl
               WHERE voud_nota = ret_nomor
             ), 0) AS SudahDibayar
      FROM tret_hdr
      INNER JOIN tret_dtl ON ret_nomor = retd_ret_nomor
      WHERE ret_nomor = ? AND ret_sts_ppn = ${statusPpn}`;
  } else if (prefix === "PBG") {
    sql = `
      SELECT 'BPB' AS Tipe, bpb_nomor AS Nomor,
             DATE_FORMAT(bpb_tanggal, '%Y-%m-%d') AS Tanggal,
             bpb_keterangan AS Keterangan,
             SUM((bpbD_HARGA*(100-bpbd_disc)/100)*bpbD_jumlah*
               IF(po_status_ppn=1,((100+po_ppn)/100),1)) AS Total,
             IFNULL((
               SELECT SUM(voud_total) FROM tvoucher_dtl
               WHERE voud_nota = bpb_nomor
             ), 0) AS SudahDibayar
      FROM tbpb_hdr
      INNER JOIN tbpb_dtl ON bpb_nomor = bpbd_bpb_nomor
      INNER JOIN tpo_hdr ON bpb_po_nomor = po_nomor
      WHERE bpb_nomor = ? AND po_status_ppn = ${statusPpn}`;
  } else if (prefix === "BJG") {
    sql = `
      SELECT 'BPJ' AS Tipe, bpj_nomor AS Nomor,
             DATE_FORMAT(bpj_tanggal, '%Y-%m-%d') AS Tanggal,
             bpj_keterangan AS Keterangan,
             pojh_TARIF * BPJ_JUMLAH *
               IF(pojh_status_ppn=1,((100+pojh_ppn)/100),1) AS Total,
             IFNULL((
               SELECT SUM(voud_total) FROM tvoucher_dtl
               WHERE voud_nota = bpj_nomor
             ), 0) AS SudahDibayar
      FROM tbpj_hdr
      INNER JOIN tpojasa_hdr ON bpj_po_nomor = pojh_nomor
      WHERE bpj_nomor = ? AND pojh_status_ppn = ${statusPpn}`;
  } else if (prefix === "PJG") {
    // PJG tidak pakai filter statusPpn
    sql = `
      SELECT 'PJG' AS Tipe, pojh_nomor AS Nomor,
             DATE_FORMAT(pojh_tanggal, '%Y-%m-%d') AS Tanggal,
             'Potongan bahan' AS Keterangan,
             SUM(pojd_harga * pojd_jumlah) AS Total,
             IFNULL((
               SELECT SUM(voud_total) FROM tvoucher_dtl
               WHERE voud_nota = pojh_nomor
             ), 0) AS SudahDibayar
      FROM tpojasa_hdr
      INNER JOIN tpojasa_dtl ON pojh_nomor = pojd_pojh_nomor
      WHERE pojh_nomor = ?`;
  } else if (prefix === "POE") {
    sql = `
      SELECT 'POE' AS Tipe, h.poe_nomor AS Nomor,
             DATE_FORMAT(h.poe_tanggal, '%Y-%m-%d') AS Tanggal,
             'PO External' AS Keterangan,
             (h.poe_total - IFNULL((
               SELECT SUM(c.poed2_nominal) FROM tpoexternal_dtl2 c
               WHERE c.poed2_nomor = h.poe_nomor
             ), 0)) AS Total,
             IFNULL((
               SELECT SUM(v.voud_total) FROM tvoucher_dtl v
               WHERE v.voud_nota = h.poe_nomor
             ), 0) AS SudahDibayar
      FROM tpoexternal_hdr h
      WHERE h.poe_nomor = ?`;
  } else if (resolvedType === "MMT") {
    sql = `
    SELECT 'MMT' AS Tipe, h.rec_nomor AS Nomor,
           DATE_FORMAT(h.rec_tanggal, '%Y-%m-%d') AS Tanggal,
           IFNULL(h.rec_keterangan, IFNULL(h.rec_memo, '')) AS Keterangan,
           IFNULL((
             SELECT SUM(
               IF(d.recd_harga < 200000,
                 d.recd_harga * d.recd_qty_terima,
                 d.recd_harga
               )
             )
             FROM trec_mmt_dtl d
             WHERE d.recd_rec_nomor = h.rec_nomor
           ), 0) AS Total,
           IFNULL((
             SELECT SUM(voud_total) FROM tvoucher_dtl
             WHERE voud_nota = h.rec_nomor
           ), 0) AS SudahDibayar
    FROM trec_mmt_hdr h
    WHERE h.rec_nomor = ?`;
  } else if (resolvedType === "BPE") {
    sql = `
    SELECT 'BPE' AS Tipe, h.bpe_nomor AS Nomor,
           DATE_FORMAT(h.bpe_tanggal, '%Y-%m-%d') AS Tanggal,
           IFNULL(h.bpe_spk_nomor, IFNULL(h.bpe_ket, '')) AS Keterangan,
           IFNULL(poe.poe_total, 0) AS Total,
           IFNULL((
             SELECT SUM(voud_total) FROM tvoucher_dtl
             WHERE voud_nota = h.bpe_nomor
           ), 0) AS SudahDibayar
    FROM tbpbpoexternal_hdr h
    LEFT JOIN tpoexternal_hdr poe ON poe.poe_nomor = h.bpe_po
    WHERE h.bpe_nomor = ?`;
  } else if (resolvedType === "BPG") {
    sql = `
    SELECT 'BPG' AS Tipe, h.bpb_nomor AS Nomor,
           DATE_FORMAT(h.bpb_tanggal, '%Y-%m-%d') AS Tanggal,
           IFNULL(h.bpb_ket, '') AS Keterangan,
           h.bpb_jenis AS Jenis,
           IFNULL((
             SELECT SUM(d.bpbd_jumlah * d.bpbd_harga)
             FROM tgarmenbpb_dtl d
             WHERE d.bpbd_nomor = h.bpb_nomor
           ), 0) AS Total,
           IFNULL((
             SELECT SUM(voud_total) FROM tvoucher_dtl
             WHERE voud_nota = h.bpb_nomor
           ), 0) AS SudahDibayar
    FROM tgarmenbpb_hdr h
    WHERE h.bpb_nomor = ?`;
  } else {
    throw new Error("Tipe nota tidak dikenali.");
  }

  const [[row]] = await db.query(sql, params);
  // Query agregat (SUM tanpa GROUP BY) selalu mengembalikan 1 baris berisi NULL
  // kalau tidak ada yang cocok, jadi yang dicek harus Nomor, bukan hanya row.
  if (!row || !row.Nomor) {
    if (["RTG", "PBG", "BJG"].includes(prefix)) {
      throw new Error(
        `Nota ${kode} tidak ditemukan, atau status PPN nota tidak sama dengan voucher (voucher: ${Number(statusPpn) === 1 ? "PPN" : "Non PPN"}).`,
      );
    }
    throw new Error("Nota tidak ditemukan.");
  }

  const nilai = Number(row.Total) - Number(row.SudahDibayar);
  const nilaiMax = nilai;

  let bs = 0;
  if (prefix === "BJG") bs = await getBs(kode);

  return {
    tipe: row.Tipe,
    nomor: row.Nomor,
    tanggal: row.Tanggal,
    keterangan: row.Keterangan,
    jenis: row.Jenis || "",
    nilai,
    nilaiMax,
    bs,
    tarif: 0,
    potongan: 0,
    total: nilai,
  };
};

// ── Search nota untuk modal bantuan ──────────────────────────────────
// Delphi F1/F2/F3/F4/F5 pada GridDetail col2
const searchNota = async (type, supKode, search = "") => {
  let sql = "";
  const params = [];
  const like = `%${search}%`;

  if (type === "RTG") {
    sql = `SELECT ret_nomor AS Nomor, DATE_FORMAT(ret_tanggal,'%Y-%m-%d') AS Tanggal,
            ret_keterangan AS Keterangan, sup_nama AS Supplier
           FROM tret_hdr
           INNER JOIN tsupplier ON sup_kode = ret_sup_kode
           WHERE sup_kode = ?
             ${search ? "AND (ret_nomor LIKE ? OR sup_nama LIKE ?)" : ""}
           ORDER BY ret_tanggal DESC LIMIT 100`;
    params.push(supKode);
    if (search) params.push(like, like);
  } else if (type === "BPB") {
    sql = `SELECT bpb_nomor AS Nomor, DATE_FORMAT(bpb_tanggal,'%Y-%m-%d') AS Tanggal,
            bpb_keterangan AS Keterangan, sup_nama AS Supplier
           FROM tbpb_hdr
           INNER JOIN tsupplier ON sup_kode = bpb_sup_kode
           WHERE sup_kode = ?
             AND NOT EXISTS (
               SELECT 1 FROM tpo_hdr px
               WHERE px.po_nomor = bpb_po_nomor AND px.po_jenis = 4
             )
             AND NOT EXISTS (
               SELECT 1 FROM tvoucher_dtl pv
               INNER JOIN tpo_hdr pc ON pc.po_nomor = pv.voud_nota
               WHERE pv.voud_type = 'POB'
                 AND ${SQL_BPB_MILIK_PO("tbpb_hdr", "pc")}
             )
             ${search ? "AND (bpb_nomor LIKE ? OR sup_nama LIKE ?)" : ""}
           ORDER BY bpb_tanggal DESC LIMIT 100`;
    params.push(supKode);
    if (search) params.push(like, like);
  } else if (type === "BPJ") {
    sql = `SELECT bpj_nomor AS Nomor, 
                  DATE_FORMAT(bpj_tanggal,'%Y-%m-%d') AS Tanggal,
                  bpj_keterangan AS Keterangan, 
                  sup_nama AS Supplier,
                  (pojh_TARIF * BPJ_JUMLAH * IF(pojh_status_ppn=1,((100+pojh_ppn)/100),1)) AS Total,
                  IFNULL((
                    SELECT SUM(voud_total) FROM tvoucher_dtl
                    WHERE voud_nota = bpj_nomor
                  ), 0) AS SudahDibayar
           FROM tbpj_hdr
           INNER JOIN tpojasa_hdr ON bpj_po_nomor = pojh_nomor
           INNER JOIN tsupplier ON sup_kode = bpj_sup_kode
           WHERE sup_kode = ?
             ${search ? "AND (bpj_nomor LIKE ? OR sup_nama LIKE ?)" : ""}
           HAVING (Total - SudahDibayar) > 0
           ORDER BY bpj_tanggal DESC LIMIT 100`;
    params.push(supKode);
    if (search) params.push(like, like);
  } else if (type === "PJG") {
    // Delphi F5: pojd_statuspotong=1
    sql = `SELECT DISTINCT pojh_nomor AS Nomor, DATE_FORMAT(pojh_tanggal,'%Y-%m-%d') AS Tanggal,
            pojh_keterangan AS Keterangan, sup_nama AS Supplier
           FROM tpojasa_hdr
           INNER JOIN tpojasa_dtl ON pojd_pojh_nomor = pojh_nomor
           INNER JOIN tsupplier ON sup_kode = pojh_sup_kode
           WHERE sup_kode = ? AND pojd_statuspotong = 1
             ${search ? "AND (pojh_nomor LIKE ? OR sup_nama LIKE ?)" : ""}
           ORDER BY pojh_tanggal DESC LIMIT 100`;
    params.push(supKode);
    if (search) params.push(like, like);
  } else if (type === "POE") {
    // Delphi F4: poe_status='CLOSE'
    sql = `SELECT poe_nomor AS Nomor, DATE_FORMAT(poe_tanggal,'%Y-%m-%d') AS Tanggal,
            sup_nama AS Supplier, poe_spk_nomor AS Spk,
            IFNULL(spk_nama,'') AS NamaSpk
           FROM tpoexternal_hdr
           INNER JOIN tsupplier ON sup_kode = poe_sup AND poe_sup = ?
           LEFT JOIN tspk ON spk_nomor = poe_spk_nomor
           WHERE poe_status = 'CLOSE'
             ${search ? "AND (poe_nomor LIKE ? OR sup_nama LIKE ?)" : ""}
           ORDER BY poe_tanggal DESC LIMIT 100`;
    params.push(supKode);
    if (search) params.push(like, like);
  } else if (type === "MMT") {
    // Hanya yang belum closed
    sql = `SELECT h.rec_nomor AS Nomor,
          DATE_FORMAT(h.rec_tanggal, '%Y-%m-%d') AS Tanggal,
          IFNULL(h.rec_keterangan, IFNULL(h.rec_memo, '')) AS Keterangan,
          s.sup_nama AS Supplier
         FROM trec_mmt_hdr h
         INNER JOIN tsupplier s ON s.sup_kode = h.rec_sup_kode
         WHERE h.rec_sup_kode = ?
           AND h.rec_isclosed = 0
           ${search ? "AND (h.rec_nomor LIKE ? OR h.rec_keterangan LIKE ? OR s.sup_nama LIKE ?)" : ""}
         ORDER BY h.rec_tanggal DESC LIMIT 100`;
    params.push(supKode);
    if (search) params.push(like, like, like);
  } else if (type === "BPE") {
    sql = `SELECT h.bpe_nomor AS Nomor,
          DATE_FORMAT(h.bpe_tanggal, '%Y-%m-%d') AS Tanggal,
          IFNULL(h.bpe_ket, '') AS Keterangan,
          IFNULL(s.sup_nama, '') AS Supplier,
          IFNULL(h.bpe_spk_nomor, '') AS Spk
         FROM tbpbpoexternal_hdr h
         INNER JOIN tsupplier s ON s.sup_kode = h.bpe_sup
         WHERE h.bpe_sup = ?
           ${search ? "AND (h.bpe_nomor LIKE ? OR h.bpe_ket LIKE ? OR s.sup_nama LIKE ?)" : ""}
         ORDER BY h.bpe_tanggal DESC LIMIT 100`;
    params.push(supKode);
    if (search) params.push(like, like, like);
  } else if (type === "POL") {
    sql = `SELECT x.Nomor, x.Tanggal, x.Supplier,
                  CONCAT('Sisa: ', FORMAT(x.Total - x.Sudah, 0)) AS Keterangan
           FROM (
             SELECT h.po_nomor AS Nomor,
                    DATE_FORMAT(h.po_tanggal,'%Y-%m-%d') AS Tanggal,
                    IFNULL(s.sup_nama,'') AS Supplier,
                    ${SQL_TOTAL_PO_LAIN} AS Total,
                    IFNULL((
                      SELECT SUM(v.voud_total)
                      FROM tvoucher_dtl v
                      INNER JOIN tvoucher_hdr vh ON vh.vou_nomor = v.voud_vou_nomor
                      WHERE v.voud_nota = h.po_nomor AND v.voud_type = 'POL'
                        AND vh.vou_sup_kode = d.pod_sup_kode
                    ), 0)
                    + IFNULL((
                      SELECT SUM(t.ptd_nominal)
                      FROM finance.tpengajuan_transfer_dtl t
                      WHERE t.ptd_trs = h.po_nomor
                        AND t.ptd_sup_kode = d.pod_sup_kode
                        AND t.ptd_batal = ''
                    ), 0) AS Sudah
             FROM tpo_hdr h
             INNER JOIN tpo_dtl d
               ON d.pod_po_Nomor = h.po_nomor AND d.pod_bhn_kode <> ''
             LEFT JOIN tsupplier s ON s.sup_kode = d.pod_sup_kode
             WHERE h.po_jenis = 4 AND d.pod_sup_kode = ?
               ${search ? "AND h.po_nomor LIKE ?" : ""}
               AND NOT EXISTS (
                 SELECT 1 FROM tpengajuan_uang_muka_dtl pd
                 JOIN tpengajuan_uang_muka_hdr ph ON ph.pum_nomor = pd.pumd_pum_nomor
                 JOIN tpo_dtl x2 ON x2.pod_po_Nomor = pd.pumd_nomor_sumber
                                AND x2.pod_nourut = pd.pumd_item_nourut
                 WHERE pd.pumd_sumber = 'PO_LAIN_LAIN'
                   AND pd.pumd_nomor_sumber = h.po_nomor
                   AND x2.pod_sup_kode = d.pod_sup_kode
                   AND (ph.pum_status = 'DIAJUKAN'
                        OR (ph.pum_status = 'REALISASI' AND pd.pumd_status_acc = 'ACC'))
               )
             GROUP BY h.po_nomor, h.po_tanggal, h.po_status_ppn, h.po_ppn,
                      d.pod_sup_kode, s.sup_nama
           ) x
           WHERE (x.Total - x.Sudah) > 0.005
           ORDER BY x.Nomor DESC LIMIT 100`;
    params.push(supKode);
    if (search) params.push(like);
  } else if (type === "POB") {
    sql = `SELECT x.Nomor, x.Tanggal, x.Supplier, x.JenisPo,
                  CONCAT(CASE x.JenisPo WHEN 1 THEN 'Greige' WHEN 2 THEN 'Celup' ELSE 'Bahan' END,
                         ' | Sisa: ', FORMAT(x.Total - x.Sudah, 0)) AS Keterangan
           FROM (
             SELECT h.po_nomor AS Nomor,
                    DATE_FORMAT(h.po_tanggal,'%Y-%m-%d') AS Tanggal,
                    IFNULL(s.sup_nama,'') AS Supplier,
                    h.po_jenis AS JenisPo,
                    ${SQL_TOTAL_PO_LAIN} AS Total,
                    IFNULL((
                      SELECT SUM(v.voud_total)
                      FROM tvoucher_dtl v
                      INNER JOIN tvoucher_hdr vh ON vh.vou_nomor = v.voud_vou_nomor
                      WHERE v.voud_nota = h.po_nomor AND v.voud_type = 'POB'
                        AND vh.vou_sup_kode = h.po_sup_kode
                    ), 0) AS Sudah
             FROM tpo_hdr h
             INNER JOIN tpo_dtl d
               ON d.pod_po_Nomor = h.po_nomor AND d.pod_bhn_kode <> ''
             LEFT JOIN tsupplier s ON s.sup_kode = h.po_sup_kode
             WHERE h.po_jenis IN (?) AND h.po_sup_kode = ?
               AND h.po_tanggal >= ?
               ${search ? "AND h.po_nomor LIKE ?" : ""}
               AND NOT EXISTS (
                 SELECT 1 FROM tbpb_hdr b
                 INNER JOIN tvoucher_dtl bv ON bv.voud_nota = b.bpb_nomor
                 WHERE ${SQL_BPB_MILIK_PO("b", "h")}
               )
             GROUP BY h.po_nomor, h.po_tanggal, h.po_jenis, h.po_status_ppn,
                      h.po_ppn, h.po_sup_kode, s.sup_nama
           ) x
           WHERE (x.Total - x.Sudah) > 0.005
           ORDER BY x.Tanggal DESC, x.Nomor DESC LIMIT 100`;
    params.push(JENIS_PO_BAHAN, supKode, TANGGAL_MULAI_PO_BAHAN);
    if (search) params.push(like);
  } else if (type === "BPG") {
    const hasSupKode = supKode && supKode.trim() !== "";
    sql = `
    SELECT h.bpb_nomor AS Nomor,
           DATE_FORMAT(h.bpb_tanggal, '%Y-%m-%d') AS Tanggal,
           IFNULL(h.bpb_ket, '') AS Keterangan,
           IFNULL(s.sup_nama, '') AS Supplier,
           IFNULL(h.bpb_sup_kode, '') AS SupKode,
           h.bpb_jenis AS Jenis,
           IFNULL((
             SELECT SUM(d.bpbd_jumlah * d.bpbd_harga)
             FROM tgarmenbpb_dtl d
             WHERE d.bpbd_nomor = h.bpb_nomor
           ), 0) AS Total,
           IFNULL((
             SELECT SUM(voud_total) FROM tvoucher_dtl
             WHERE voud_nota = h.bpb_nomor
           ), 0) AS SudahDibayar
    FROM tgarmenbpb_hdr h
    LEFT JOIN tsupplier s ON s.sup_kode = h.bpb_sup_kode
    WHERE 1=1
      ${hasSupKode ? "AND h.bpb_sup_kode = ?" : ""}
      ${search ? "AND (h.bpb_nomor LIKE ? OR h.bpb_ket LIKE ? OR s.sup_nama LIKE ?)" : ""}
    HAVING Total > SudahDibayar OR Total = 0
    ORDER BY h.bpb_tanggal DESC LIMIT 100`;
    if (hasSupKode) params.push(supKode);
    if (search) params.push(like, like, like);
  } else {
    throw new Error("Tipe tidak dikenali.");
  }

  const [rows] = await db.query(sql, params);
  return rows;
};

const getNilaiSisa = async (nota, tipe = "") => {
  if (tipe === "POB") {
    const [[pc]] = await db.query(
      `SELECT ${SQL_TOTAL_PO_LAIN} AS total,
              IFNULL((SELECT SUM(v.voud_total) FROM tvoucher_dtl v
                      WHERE v.voud_nota = h.po_nomor AND v.voud_type = 'POB'), 0) AS sudah
       FROM tpo_hdr h
       INNER JOIN tpo_dtl d
         ON d.pod_po_Nomor = h.po_nomor AND d.pod_bhn_kode <> ''
       WHERE h.po_nomor = ? AND h.po_jenis IN (?)
       GROUP BY h.po_nomor, h.po_status_ppn, h.po_ppn`,
      [nota, JENIS_PO_BAHAN],
    );
    if (!pc) return 0;
    return Math.max(0, Number(pc.total) - Number(pc.sudah));
  }
  if (!nota.startsWith("PBG")) return 0;
  const [[row]] = await db.query(
    `SELECT
       SUM((bpbD_HARGA*(100-bpbd_disc)/100)*bpbD_jumlah*
         IF(po_status_ppn=1,((100+po_ppn)/100),1)) AS Total,
       bpb_nilai_voucher
     FROM tbpb_hdr
     INNER JOIN tbpb_dtl ON bpb_nomor = bpbd_bpb_nomor
     INNER JOIN tpo_hdr ON bpb_po_nomor = po_nomor
     WHERE bpb_nomor = ?`,
    [nota],
  );
  if (!row) return 0;
  return Number(row.Total || 0) - Number(row.bpb_nilai_voucher || 0);
};

// ── Load data existing voucher (edit) ─────────────────────────────────
// Delphi loaddataall + cekClose
const getDetailForm = async (nomor) => {
  const [rows] = await db.query(
    `SELECT h.vou_nomor, DATE_FORMAT(h.vou_tanggal,'%Y-%m-%d') AS vou_tanggal,
            h.vou_sup_kode, h.vou_disc, h.vou_total, h.vou_keterangan,
            h.vou_nomor_pajak, h.vou_sts_ppn, h.vou_ppn,
            d.voud_nota, DATE_FORMAT(d.voud_tgl_nota,'%Y-%m-%d') AS voud_tgl_nota,
            d.voud_type, d.voud_total AS voud_nilai,
            d.voud_bs, d.voud_tarifbs,
            s.sup_nama, s.sup_rekening, s.sup_bank,
            s.sup_cabang, s.sup_atasnama
     FROM tvoucher_hdr h
     INNER JOIN tsupplier s ON s.sup_kode = h.vou_sup_kode
     LEFT JOIN tvoucher_dtl d ON d.voud_vou_nomor = h.vou_nomor
     WHERE h.vou_nomor = ?`,
    [nomor],
  );
  if (!rows.length) throw new Error("Nomor tidak ditemukan.");

  const hdr = rows[0];

  const detail = await Promise.all(
    rows
      .filter((r) => r.voud_nota)
      .map(async (r) => {
        const sisa = await getNilaiSisa(r.voud_nota, r.voud_type);
        const potongan = Number(r.voud_bs) * Number(r.voud_tarifbs);
        return {
          tipe: r.voud_type,
          nomor: r.voud_nota,
          tanggal: r.voud_tgl_nota,
          keterangan: "-",
          nilai: Number(r.voud_nilai),
          nilaiMax: Number(r.voud_nilai) + sisa, // ← fix
          bs: Number(r.voud_bs),
          tarif: Number(r.voud_tarifbs),
          potongan,
          total: Number(r.voud_nilai) - potongan,
        };
      }),
  );

  // Bahan tambahan
  const [dtl2] = await db.query(
    `SELECT voud2_nama AS nama, voud2_satuan AS satuan,
            voud2_jumlah AS jumlah, voud2_harga AS harga,
            voud2_tambah AS tambah
     FROM tvoucher_dtl2
     WHERE voud2_vou_nomor = ?`,
    [nomor],
  );
  const bahanTambahan = dtl2.map((r) => ({
    nama: r.nama,
    satuan: r.satuan,
    jumlah: Number(r.jumlah),
    harga: Number(r.harga),
    nilai: Number(r.jumlah) * Number(r.harga),
    tambah: Number(r.tambah) === 1,
  }));

  // cekClose / pin5 status — Delphi cekClose, sekarang pakai
  // tutupBukuService (bukan cekTutupPeriode)
  let pin5Status = "";
  let pin5Urut = 0;
  const tutup = await cekIsTutupBuku(hdr.vou_tanggal);
  if (tutup) {
    const [[lastPin]] = await db.query(
      `SELECT pin_acc, pin_dipakai, pin_urut
       FROM tspk_pin5
       WHERE pin_trs = 'VOUCHER HUTANG' AND pin_nomor = ?
       ORDER BY pin_urut DESC LIMIT 1`,
      [nomor],
    );
    if (!lastPin) {
      pin5Status = "MINTA";
    } else {
      pin5Urut = lastPin.pin_urut;
      if (lastPin.pin_acc === "" && lastPin.pin_dipakai === "") {
        pin5Status = "WAIT";
      } else if (lastPin.pin_acc === "Y" && lastPin.pin_dipakai === "") {
        pin5Status = "ACC";
      } else if (lastPin.pin_acc === "N") {
        pin5Status = "TOLAK";
      } else {
        // pin_dipakai='Y' → sudah dipakai, sudah close biasa
        pin5Status = "MINTA";
      }
    }
  }

  return {
    nomor: hdr.vou_nomor,
    tanggal: hdr.vou_tanggal,
    supKode: hdr.vou_sup_kode,
    supNama: hdr.sup_nama,
    supRekening: hdr.sup_rekening,
    supBank: hdr.sup_bank,
    supCabang: hdr.sup_cabang,
    supAtasnama: hdr.sup_atasnama,
    nomorPajak: hdr.vou_nomor_pajak || "",
    statusPpn: Number(hdr.vou_sts_ppn) === 1,
    ppn: Number(hdr.vou_ppn) || 0,
    disc: Number(hdr.vou_disc) || 0,
    keterangan: hdr.vou_keterangan || "",
    detail,
    bahanTambahan,
    pin5Status,
    pin5Urut,
  };
};

// ── cekStatusRealisasi ────────────────────────────────────────────────
// Delphi cekstatusrealisasi: vou_status_realisasi <> '0'
const cekStatusRealisasi = async (nomor) => {
  const [[row]] = await db.query(
    `SELECT vou_status_realisasi FROM tvoucher_hdr WHERE vou_nomor = ?`,
    [nomor],
  );
  if (!row) return false;
  return row.vou_status_realisasi !== "0" && row.vou_status_realisasi !== 0;
};

// ── Rekap Pembayaran yang belum dipakai, untuk satu supplier ──────────
// Satu unit = satu voucher: baris berfaktur dikelompokkan per faktur,
// baris tanpa faktur berdiri sendiri (satu nota satu voucher).
const getRekapTersedia = async (supKode) => {
  const sup = String(supKode || "").trim();
  if (!sup) throw new Error("Pilih supplier dahulu.");

  const [rows] = await db.query(
    `SELECT d.rkbd_nomor AS rekapNomor, d.rkbd_nourut AS noUrut,
            DATE_FORMAT(h.rkb_tanggal, '%Y-%m-%d') AS tanggalRekap,
            d.rkbd_bulan_tagihan AS bulanTagihan,
            d.rkbd_tipe AS tipe, d.rkbd_nota AS nota,
            ABS(d.rkbd_nominal) AS nominal,
            DATE_FORMAT(d.rkbd_tgl_rencana, '%Y-%m-%d') AS tglRencana,
            d.rkbd_faktur_pajak AS fakturPajak, d.rkbd_invoice AS invoice,
            d.rkbd_keterangan AS keterangan
     FROM trekap_bayar_dtl d
     INNER JOIN trekap_bayar_hdr h ON h.rkb_nomor = d.rkbd_nomor
     WHERE d.rkbd_sup_kode = ? AND d.rkbd_vou_nomor = ''
       AND h.rkb_status = 'AKTIF'
     ORDER BY d.rkbd_faktur_pajak = '', d.rkbd_faktur_pajak,
              h.rkb_tanggal DESC, d.rkbd_nomor, d.rkbd_nourut`,
    [sup],
  );

  const unit = new Map();
  for (const r of rows) {
    const faktur = String(r.fakturPajak || "").trim();
    const key = faktur ? `F|${faktur}` : `R|${r.rekapNomor}|${r.noUrut}`;
    let u = unit.get(key);
    if (!u) {
      u = { key, fakturPajak: faktur, invoice: "", total: 0, baris: [] };
      unit.set(key, u);
    }
    const nominal = Number(r.nominal);
    const tanda = ["RET", "PJG"].includes(r.tipe) ? -1 : 1;
    u.total = Math.round((u.total + tanda * nominal) * 100) / 100;
    if (!u.invoice && r.invoice) u.invoice = r.invoice;
    u.baris.push({ ...r, nominal });
  }
  return [...unit.values()];
};

// ── Save ──────────────────────────────────────────────────────────────
// Delphi simpandata:
// - UPDATE/INSERT tvoucher_hdr
// - DELETE + INSERT tvoucher_dtl
// - DELETE + INSERT tvoucher_dtl2
// - Jika pin5Status='ACC' → UPDATE tspk_pin5 SET pin_dipakai='Y'
// - Validasi tutup periode (bypass jika ACC)
const save = async (payload, userKode) => {
  const {
    isEdit,
    nomor,
    tanggal,
    supKode,
    nomorPajak,
    statusPpn,
    ppn,
    disc,
    keterangan,
    detail,
    bahanTambahan,
    pin5Status,
    pin5Urut,
  } = payload;

  // Validasi tutup periode — bypass jika ACC (Delphi: or (xminta5='ACC'))
  const tutup = await cekIsTutupBuku(tanggal);
  if (tutup && pin5Status !== "ACC") {
    if (pin5Status === "MINTA") {
      throw new Error(
        "Transaksi tsb sudah diclose. Silahkan minta approve untuk bisa menyimpan perubahan data.",
      );
    }
    if (pin5Status === "WAIT") {
      throw new Error("Transaksi tsb sudah diclose. Sedang menunggu approve.");
    }
    if (pin5Status === "TOLAK") {
      throw new Error(
        "Transaksi tsb sudah diclose. Pengajuan perubahan ditolak.",
      );
    }
    throw new Error(
      "Anda tidak boleh input di tanggal periode yang sudah diclose.",
    );
  }

  // Cek realisasi jika edit
  if (isEdit) {
    const sudahRealisasi = await cekStatusRealisasi(nomor);
    if (sudahRealisasi)
      throw new Error("Voucher ini sudah di realisasi, tidak bisa di edit.");
  }

  if (!supKode) throw new Error("Supplier belum diisi.");

  const daftarBpb = detail
    .filter((d) => d.tipe === "BPB" && d.nomor)
    .map((d) => d.nomor);
  if (daftarBpb.length) {
    const [lain] = await db.query(
      `SELECT b.bpb_nomor
       FROM tbpb_hdr b
       INNER JOIN tpo_hdr p ON p.po_nomor = b.bpb_po_nomor
       WHERE b.bpb_nomor IN (?) AND p.po_jenis = 4`,
      [daftarBpb],
    );
    if (lain.length) {
      throw new Error(
        `BPB ${lain.map((r) => r.bpb_nomor).join(", ")} berasal dari PO Lain-lain dan dibayar lewat Pengajuan Transfer.`,
      );
    }

    // BPB milik PO yang sudah dibayar lewat tipe POB (voucher lain) tidak boleh divoucher
    const [sudahPob] = await db.query(
      `SELECT DISTINCT b.bpb_nomor
       FROM tvoucher_dtl v
       INNER JOIN tpo_hdr c ON c.po_nomor = v.voud_nota
       INNER JOIN tbpb_hdr b ON b.bpb_nomor IN (?)
       WHERE v.voud_type = 'POB' AND v.voud_vou_nomor <> ?
         AND ${SQL_BPB_MILIK_PO("b", "c")}`,
      [daftarBpb, isEdit ? nomor : ""],
    );
    if (sudahPob.length) {
      throw new Error(
        `BPB ${sudahPob.map((r) => r.bpb_nomor).join(", ")} milik PO yang sudah dibayar lewat tipe PO Bahan.`,
      );
    }
  }

  for (const d of detail.filter((x) => x.tipe === "POL" && x.nomor)) {
    const info = await getInfoPoLain(d.nomor, supKode, isEdit ? nomor : "");
    if (!info) {
      throw new Error(
        `PO ${d.nomor} tidak ditemukan untuk supplier ${supKode}.`,
      );
    }
    if (info.adaUangMuka) {
      throw new Error(
        `PO ${info.nomor} (supplier ${supKode}) sudah diajukan lewat Uang Muka.`,
      );
    }
    const sisa = info.total - info.sudah;
    if (Number(d.nilai) > sisa + 0.005) {
      throw new Error(
        `Nilai PO ${info.nomor} melebihi sisa. Sisa: ${sisa.toLocaleString("id-ID")}.`,
      );
    }
    d.nomor = info.nomor; // normalkan ke penulisan asli di database
  }

  const daftarPob = detail
    .filter((d) => d.tipe === "POB" && d.nomor)
    .map((d) => d.nomor);
  const unikPob = new Set(daftarPob.map((n) => String(n).toUpperCase()));
  if (unikPob.size !== daftarPob.length) {
    throw new Error(
      "PO yang sama tidak boleh dipanggil dua kali dalam satu voucher.",
    );
  }
  if (daftarPob.length && daftarBpb.length) {
    const [campur] = await db.query(
      `SELECT DISTINCT b.bpb_nomor
       FROM tpo_hdr c
       CROSS JOIN tbpb_hdr b
       WHERE c.po_nomor IN (?) AND b.bpb_nomor IN (?)
         AND ${SQL_BPB_MILIK_PO("b", "c")}`,
      [daftarPob, daftarBpb],
    );
    if (campur.length) {
      throw new Error(
        `BPB ${campur.map((r) => r.bpb_nomor).join(", ")} milik PO yang juga ada di voucher ini sebagai PO Bahan. Pilih salah satu.`,
      );
    }
  }

  // Saat edit, PO yang sudah ada di voucher ini tidak kena batas tanggal mulai
  const nomorPobLama = new Set();
  if (isEdit) {
    const [lamaPob] = await db.query(
      `SELECT voud_nota FROM tvoucher_dtl
       WHERE voud_vou_nomor = ? AND voud_type = 'POB'`,
      [nomor],
    );
    for (const r of lamaPob)
      nomorPobLama.add(String(r.voud_nota).toUpperCase());
  }

  for (const d of detail.filter((x) => x.tipe === "POB" && x.nomor)) {
    const info = await getInfoPoBahan(d.nomor, supKode, {
      excludeVou: isEdit ? nomor : "",
      statusPpn: Number(statusPpn),
      cekTanggal: !nomorPobLama.has(String(d.nomor).toUpperCase()),
    });
    if (!info) {
      throw new Error(
        await alasanPoBahanTidakValid(d.nomor, supKode, statusPpn),
      );
    }
    if (info.adaVoucherBpb) {
      throw new Error(
        `BPB dari PO ${info.nomor} sudah pernah divoucher. Tidak bisa dibayar lewat PO Bahan.`,
      );
    }
    const sisa = info.total - info.sudah;
    if (Number(d.nilai) > sisa + 0.005) {
      throw new Error(
        `Nilai PO ${info.nomor} melebihi sisa. Sisa: ${sisa.toLocaleString("id-ID")}.`,
      );
    }
    d.nomor = info.nomor;
  }

  // Hitung total — Delphi hitung():
  // BPB/BPJ/POE → += total, RET/PJG → -= total
  // Total = xtotal - xpotongan (bahan tambahan)
  let xtotal = 0;
  for (const d of detail) {
    if (d.tipe && d.nomor) {
      if (
        ["BPB", "BPJ", "POE", "MMT", "BPE", "BPG", "POL", "POB"].includes(
          d.tipe,
        )
      ) {
        xtotal += Number(d.total);
      } else if (["RET", "PJG"].includes(d.tipe)) {
        xtotal -= Number(d.total);
      }
    }
  }
  // vou_total disimpan gross (belum dikurangi bahan tambahan).
  // Pengurangan bahan tambahan dilakukan saat browse/tampil (kolom Net),
  // bukan saat simpan — supaya Total header konsisten dengan total detail.
  const vouTotal = xtotal;

  const tahun = tanggal.substring(0, 4);
  const conn = await db.getConnection();
  await conn.beginTransaction();
  try {
    let anomor = nomor;

    if (isEdit) {
      // Delphi UPDATE tvoucher_hdr
      await conn.query(
        `UPDATE tvoucher_hdr SET
           vou_tanggal = ?, vou_sup_kode = ?, vou_nomor_pajak = ?,
           vou_sts_ppn = ?, vou_ppn = ?, vou_disc = ?, vou_total = ?,
           vou_keterangan = ?, date_modified = NOW(), user_modified = ?
         WHERE vou_nomor = ?`,
        [
          tanggal,
          supKode,
          nomorPajak,
          statusPpn ? 1 : 0,
          ppn || 0,
          disc || 0,
          vouTotal,
          keterangan || "",
          userKode,
          nomor,
        ],
      );
    } else {
      // Delphi INSERT tvoucher_hdr
      anomor = await getMaxNomor(tahun);
      await conn.query(
        `INSERT INTO tvoucher_hdr
           (vou_nomor, vou_tanggal, vou_sup_kode, vou_nomor_pajak,
            vou_sts_ppn, vou_ppn, vou_disc, vou_total, vou_keterangan,
            date_create, user_create)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?)`,
        [
          anomor,
          tanggal,
          supKode,
          nomorPajak || "",
          statusPpn ? 1 : 0,
          ppn || 0,
          disc || 0,
          vouTotal,
          keterangan || "",
          userKode,
        ],
      );
    }

    // Delphi: DELETE FROM tvoucher_dtl WHERE vouD_vou_nomor = FID
    const deleteNomor = isEdit ? nomor : anomor;
    await conn.query(`DELETE FROM tvoucher_dtl WHERE voud_vou_nomor = ?`, [
      deleteNomor,
    ]);
    for (const d of detail) {
      if (d.tipe && d.nomor) {
        await conn.query(
          `INSERT INTO tvoucher_dtl
             (voud_vou_nomor, voud_type, voud_nota, voud_tgl_nota,
              voud_total, voud_bs, voud_tarifbs)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            anomor,
            d.tipe,
            d.nomor,
            d.tanggal,
            Number(d.nilai),
            Number(d.bs) || 0,
            Number(d.tarif) || 0,
          ],
        );
      }
    }

    // Delphi: DELETE FROM tvoucher_dtl2 WHERE vouD2_vou_nomor = FID
    await conn.query(`DELETE FROM tvoucher_dtl2 WHERE voud2_vou_nomor = ?`, [
      deleteNomor,
    ]);
    for (const b of bahanTambahan) {
      if (b.nama) {
        await conn.query(
          `INSERT INTO tvoucher_dtl2
             (voud2_vou_nomor, voud2_nama, voud2_satuan, voud2_harga, voud2_jumlah, voud2_tambah)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            anomor,
            b.nama,
            b.satuan || "",
            Number(b.harga),
            Number(b.jumlah),
            b.tambah ? 1 : 0,
          ],
        );
      }
    }

    // ── Rujukan Rekap Pembayaran ──
    // 1. Lepas baris rekap yang notanya sudah tidak ada di voucher ini (edit)
    const dipakai = new Set(
      detail
        .filter((d) => d.tipe && d.nomor)
        .map((d) => `${d.tipe}|${d.nomor}`),
    );
    const [lama] = await conn.query(
      `SELECT rkbd_nomor, rkbd_nourut, rkbd_tipe, rkbd_nota
       FROM trekap_bayar_dtl WHERE rkbd_vou_nomor = ?`,
      [anomor],
    );
    for (const r of lama) {
      if (!dipakai.has(`${r.rkbd_tipe}|${r.rkbd_nota}`)) {
        await conn.query(
          `UPDATE trekap_bayar_dtl SET rkbd_vou_nomor = ''
           WHERE rkbd_nomor = ? AND rkbd_nourut = ? AND rkbd_vou_nomor = ?`,
          [r.rkbd_nomor, r.rkbd_nourut, anomor],
        );
      }
    }
    // 2. Pasang baris rekap yang dipanggil (harus masih bebas dan AKTIF)
    for (const d of detail.filter(
      (x) => x.tipe && x.nomor && x.rekapNomor && x.rekapNoUrut,
    )) {
      const [ok] = await conn.query(
        `UPDATE trekap_bayar_dtl d
         INNER JOIN trekap_bayar_hdr h ON h.rkb_nomor = d.rkbd_nomor
         SET d.rkbd_vou_nomor = ?
         WHERE d.rkbd_nomor = ? AND d.rkbd_nourut = ?
           AND d.rkbd_vou_nomor = '' AND h.rkb_status = 'AKTIF'
           AND d.rkbd_sup_kode = ? AND d.rkbd_tipe = ? AND d.rkbd_nota = ?`,
        [anomor, d.rekapNomor, d.rekapNoUrut, supKode, d.tipe, d.nomor],
      );
      if (ok.affectedRows !== 1) {
        throw new Error(
          `Baris rekap ${d.rekapNomor} no. ${d.rekapNoUrut} (${d.nomor}) sudah dipakai voucher lain, dibatalkan, atau berubah. Muat ulang rekap.`,
        );
      }
    }

    // Delphi simpandata: jika xminta5='ACC' → UPDATE tspk_pin5 SET pin_dipakai='Y'
    if (pin5Status === "ACC" && pin5Urut > 0) {
      await conn.query(
        `UPDATE tspk_pin5
         SET pin_dipakai = 'Y'
         WHERE pin_trs = 'VOUCHER HUTANG' AND pin_nomor = ? AND pin_urut = ?`,
        [deleteNomor, pin5Urut],
      );
    }

    await conn.commit();
    return { nomor: anomor };
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
};

// ══════════════════════════════════════════════════════════════════════
// REALISASI VOUCHER
// ══════════════════════════════════════════════════════════════════════

// ── Auto nomor realisasi: BYR/KODE/YY/NNNNN ──────────────────────────
const getMaxNomorRealisasi = async (kode, tanggal) => {
  const yy = new Date(tanggal).getFullYear().toString().slice(-2);
  const prefix = `BYR/${kode}/${yy}`;
  const [[row]] = await db.query(
    `SELECT IFNULL(MAX(RIGHT(nomor,5)),'00000') AS mx
     FROM bayar_debet
     WHERE LEFT(nomor,?) = ?`,
    [prefix.length, prefix],
  );
  const next = Number(row.mx) + 1;
  return `${prefix}${String(next).padStart(5, "0")}`;
};

// ── Kode Bayar ────────────────────────────────────────────────────────
const searchKodeBayar = async (q = "") => {
  const like = `%${q}%`;
  const [rows] = await db.query(
    `SELECT kb_kode AS kode, kb_nama AS nama
     FROM tkodebayar
     ${q ? "WHERE kb_kode LIKE ? OR kb_nama LIKE ?" : ""}
     ORDER BY kb_kode`,
    q ? [like, like] : [],
  );
  return rows;
};

const getKodeBayar = async (kode) => {
  const [[row]] = await db.query(
    `SELECT kb_kode AS kode, kb_nama AS nama
     FROM tkodebayar WHERE kb_kode = ?`,
    [kode],
  );
  if (!row) throw new Error("Kode bayar tidak ditemukan.");
  return row;
};

// ── Account (tperusahaan_dtl) ─────────────────────────────────────────
const searchAccount = async (q = "") => {
  const like = `%${q}%`;
  const [rows] = await db.query(
    `SELECT d.perushd_rekening AS rekening, d.perushd_bank AS bank,
            d.perushd_atasnama AS atasnama, d.perushd_cabang AS cabang
     FROM tperusahaan_dtl d
     INNER JOIN tperusahaan p
       ON p.perush_kode = d.perushd_perush_kode AND p.perush_status_utama = 1
     ${q ? "WHERE d.perushd_rekening LIKE ? OR d.perushd_bank LIKE ? OR d.perushd_atasnama LIKE ?" : ""}
     ORDER BY d.perushd_rekening`,
    q ? [like, like, like] : [],
  );
  return rows;
};

// ── Search Voucher belum direalisasi ──────────────────────────────────
const searchVoucherRealisasi = async (q = "", excludeNomor = "") => {
  const like = `%${q}%`;
  const [rows] = await db.query(
    `SELECT h.vou_nomor AS Nomor,
            DATE_FORMAT(h.vou_tanggal, '%Y-%m-%d') AS Tanggal,
            s.sup_nama AS Supplier,
            (h.vou_total - h.vou_disc) AS Total
     FROM tvoucher_hdr h
     INNER JOIN tsupplier s ON s.sup_kode = h.vou_sup_kode
     WHERE h.vou_nomor NOT IN (
       SELECT b.vou_nomor FROM bayar_debet_detail b
       ${excludeNomor ? "WHERE b.nomor != ?" : ""}
     )
     ${q ? "AND (h.vou_nomor LIKE ? OR s.sup_nama LIKE ?)" : ""}
     ORDER BY h.vou_nomor DESC LIMIT 100`,
    [...(excludeNomor ? [excludeNomor] : []), ...(q ? [like, like] : [])],
  );
  return rows;
};

// ── Load satu baris voucher untuk detail realisasi ────────────────────
const loadVoucherRealisasiDetail = async (vouNomor, currentNomor = "") => {
  const [[row]] = await db.query(
    `SELECT h.vou_nomor AS vouNomor, s.sup_nama AS supplier,
            DATE_FORMAT(h.vou_tanggal, '%Y-%m-%d') AS tanggalVou,
            (h.vou_total - h.vou_disc) AS nilai,
            h.vou_status_realisasi AS statusReal
     FROM tvoucher_hdr h
     INNER JOIN tsupplier s ON s.sup_kode = h.vou_sup_kode
     WHERE h.vou_nomor = ?`,
    [vouNomor],
  );
  if (!row) throw new Error("Voucher tidak ditemukan.");
  if (Number(row.statusReal) === 1) {
    if (currentNomor) {
      const [[own]] = await db.query(
        `SELECT 1 FROM bayar_debet_detail
         WHERE nomor = ? AND vou_nomor = ?`,
        [currentNomor, vouNomor],
      );
      if (!own) throw new Error("Voucher ini sudah direalisasi.");
    } else {
      throw new Error("Voucher ini sudah direalisasi.");
    }
  }
  return {
    vouNomor: row.vouNomor,
    supplier: row.supplier,
    tanggalVou: row.tanggalVou,
    nilai: Number(row.nilai),
  };
};

// ── Get detail form realisasi (edit mode) ─────────────────────────────
const getDetailFormRealisasi = async (nomor) => {
  const [rows] = await db.query(
    `SELECT a.nomor, a.kode AS kodeBayar, kb.kb_nama AS namaBayar,
            DATE_FORMAT(a.tanggal, '%Y-%m-%d') AS tanggal,
            DATE_FORMAT(a.tanggal_tempo, '%Y-%m-%d') AS tanggalTempo,
            a.account, IFNULL(d.perushd_bank, '') AS namaAccount,
            b.vou_nomor AS vouNomor, s.sup_nama AS supplier,
            DATE_FORMAT(h.vou_tanggal, '%Y-%m-%d') AS tanggalVou,
            (h.vou_total - h.vou_disc) AS nilai
     FROM bayar_debet a
     INNER JOIN tkodebayar kb ON kb.kb_kode = a.kode
     INNER JOIN bayar_debet_detail b ON b.nomor = a.nomor
     INNER JOIN tvoucher_hdr h ON h.vou_nomor = b.vou_nomor
     INNER JOIN tsupplier s ON s.sup_kode = h.vou_sup_kode
     LEFT JOIN tperusahaan_dtl d ON d.perushd_rekening = a.account
     LEFT JOIN tperusahaan p
       ON p.perush_kode = d.perushd_perush_kode AND p.perush_status_utama = 1
     WHERE a.nomor = ?`,
    [nomor],
  );
  if (!rows.length) throw new Error("Data tidak ditemukan.");
  const hdr = rows[0];
  return {
    nomor: hdr.nomor,
    kodeBayar: hdr.kodeBayar,
    namaBayar: hdr.namaBayar,
    tanggal: hdr.tanggal,
    tanggalTempo: hdr.tanggalTempo,
    account: hdr.account,
    namaAccount: hdr.namaAccount,
    detail: rows.map((r) => ({
      vouNomor: r.vouNomor,
      supplier: r.supplier,
      tanggalVou: r.tanggalVou,
      nilai: Number(r.nilai),
    })),
  };
};

// ── Save realisasi ────────────────────────────────────────────────────
const saveRealisasi = async (payload, userKode) => {
  const { isEdit, nomor, kodeBayar, account, tanggal, tanggalTempo, detail } =
    payload;
  const total = detail.reduce((s, d) => s + Number(d.nilai), 0);
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    let finalNomor = nomor;

    if (!isEdit) {
      if (kodeBayar !== "BG")
        finalNomor = await getMaxNomorRealisasi(kodeBayar, tanggal);
      await conn.query(
        `INSERT INTO bayar_debet
         (nomor, kode, account, tanggal, tanggal_tempo, total, kodeuser)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          finalNomor,
          kodeBayar,
          account,
          tanggal,
          tanggalTempo,
          total,
          userKode,
        ],
      );
    } else {
      await conn.query(
        `UPDATE bayar_debet
         SET tanggal=?, tanggal_tempo=?, account=?, total=?
         WHERE nomor=?`,
        [tanggal, tanggalTempo, account, total, nomor],
      );
      // Reset status realisasi voucher lama
      await conn.query(
        `UPDATE tvoucher_hdr h
         INNER JOIN bayar_debet_detail d ON d.vou_nomor = h.vou_nomor
         SET h.vou_status_realisasi = 0 WHERE d.nomor = ?`,
        [nomor],
      );
    }

    await conn.query(`DELETE FROM bayar_debet_detail WHERE nomor = ?`, [
      finalNomor,
    ]);
    for (const d of detail) {
      await conn.query(
        `INSERT INTO bayar_debet_detail (nomor, vou_nomor, nilai)
         VALUES (?, ?, ?)`,
        [finalNomor, d.vouNomor, d.nilai],
      );
      await conn.query(
        `UPDATE tvoucher_hdr SET vou_status_realisasi = 1
         WHERE vou_nomor = ?`,
        [d.vouNomor],
      );
    }

    await conn.commit();
    return { nomor: finalNomor };
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
};

// ── Hapus realisasi ───────────────────────────────────────────────────
const hapusRealisasi = async (nomor) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(
      `UPDATE tvoucher_hdr h
       INNER JOIN bayar_debet_detail d ON d.vou_nomor = h.vou_nomor
       SET h.vou_status_realisasi = 0 WHERE d.nomor = ?`,
      [nomor],
    );
    await conn.query(`DELETE FROM bayar_debet_detail WHERE nomor = ?`, [nomor]);
    await conn.query(`DELETE FROM bayar_debet WHERE nomor = ?`, [nomor]);
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
};

module.exports = {
  getMaxNomor,
  getSupplier,
  searchSupplier,
  getNotaDetail,
  searchNota,
  getDetailForm,
  cekStatusRealisasi,
  getRekapTersedia,
  save,
  // Realisasi
  getMaxNomorRealisasi,
  searchKodeBayar,
  getKodeBayar,
  searchAccount,
  searchVoucherRealisasi,
  loadVoucherRealisasiDetail,
  getDetailFormRealisasi,
  saveRealisasi,
  hapusRealisasi,
};
