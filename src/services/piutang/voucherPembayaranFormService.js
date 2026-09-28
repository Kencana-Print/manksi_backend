const db = require("../../config/database");
const tutupBukuService = require("../tutupBukuService");

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
const getNotaDetail = async (kode, statusPpn = 0, type = null) => {
  const prefix = kode.substring(0, 3).toUpperCase();
  const resolvedType = type || prefix;

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
  if (!row) throw new Error("Nota tidak ditemukan.");

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

const getNilaiSisa = async (nota) => {
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
        const sisa = await getNilaiSisa(r.voud_nota);
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
            voud2_jumlah AS jumlah, voud2_harga AS harga
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

  // Hitung total — Delphi hitung():
  // BPB/BPJ/POE → += total, RET/PJG → -= total
  // Total = xtotal - xpotongan (bahan tambahan)
  let xtotal = 0;
  for (const d of detail) {
    if (d.tipe && d.nomor) {
      if (["BPB", "BPJ", "POE", "MMT", "BPE", "BPG"].includes(d.tipe)) {
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
             (voud2_vou_nomor, voud2_nama, voud2_satuan, voud2_harga, voud2_jumlah)
           VALUES (?, ?, ?, ?, ?)`,
          [anomor, b.nama, b.satuan || "", Number(b.harga), Number(b.jumlah)],
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
