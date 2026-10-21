const db = require("../../config/database");
const {
  assertBolehPosting,
  isSetelahCutoff,
  sqlTanpaInduk,
  hitungSaldoAkun,
  TANGGAL_MULAI_BLOKIR_INDUK,
} = require("../postingGuardService");

// ── Lookup account (KAS/BANK) — ported, prefix finance. ──
const getAccountOptions = async (jenis, cabang) => {
  const effectiveCabang = cabang === "HO-" ? "P01" : cabang;
  const params = [];
  let whereClause;
  if (jenis === "KAS") {
    whereClause = `LEFT(rek_kode,5)='A-111' AND rek_cabang = ?${sqlTanpaInduk()}`;
    params.push(effectiveCabang || "P01");
  } else {
    whereClause = `(LEFT(rek_kode,5)='A-112' OR LEFT(rek_kode,5)='B-211')`;
    if (effectiveCabang && effectiveCabang !== "P01") {
      whereClause += ` AND rek_cabang = ?`;
      params.push(effectiveCabang);
    }
  }
  const [rows] = await db.query(
    `SELECT rek_kode AS kode, rek_nama AS nama, rek_cabang AS cabang
     FROM finance.trekening WHERE ${whereClause} ORDER BY rek_kode`,
    params,
  );
  return rows;
};

const getSupplierOptions = async (search = "") => {
  const [rows] = await db.query(
    `SELECT sup_kode AS kode, sup_nama AS nama,
            supd_bank AS bank, supd_rekening AS rekening, supd_atasnama AS atasnama
     FROM kencanaprint.tsupplier
     LEFT JOIN kencanaprint.tsupplieritem ON supd_kode = sup_kode
     WHERE sup_aktif = 'Y' AND (sup_nama LIKE ? OR sup_kode LIKE ?)
     ORDER BY sup_nama LIMIT 50`,
    [`%${search}%`, `%${search}%`],
  );
  return rows;
};

// ── List PUM yang siap direalisasi ──
const getPumOptions = async (cabang) => {
  let sql = `SELECT pum_nomor AS nomor, DATE_FORMAT(pum_tanggal,'%Y-%m-%d') AS tanggal,
                    pum_cabang AS cabang, pum_keterangan AS keterangan, pum_total_nominal AS totalNominal
             FROM tpengajuan_uang_muka_hdr WHERE pum_status = 'DIAJUKAN'`;
  const params = [];
  if (cabang && cabang !== "HO" && cabang !== "HO-") {
    sql += ` AND pum_cabang = ?`;
    params.push(cabang);
  }
  sql += ` ORDER BY pum_nomor DESC`;
  const [rows] = await db.query(sql, params);
  return rows;
};

// ── Load detail PUM untuk form realisasi ──
const getDetailForRealisasi = async (pumNomor) => {
  const [[hdr]] = await db.query(
    `SELECT pum_nomor, pum_status, DATE_FORMAT(pum_tanggal,'%Y-%m-%d') AS pum_tanggal,
            pum_keterangan, pum_nota, pum_cabang, pum_total_nominal, pum_user_create
     FROM tpengajuan_uang_muka_hdr WHERE pum_nomor = ?`,
    [pumNomor],
  );
  if (!hdr) throw new Error("Pengajuan Uang Muka tidak ditemukan.");
  if (hdr.pum_status !== "DIAJUKAN")
    throw new Error(`Pengajuan ini sudah berstatus ${hdr.pum_status}.`);

  const [dtl] = await db.query(
    `SELECT pumd_id, pumd_sumber, pumd_nomor_sumber, pumd_item_nourut,
            pumd_nama, pumd_satuan, pumd_qty, pumd_keterangan,
            pumd_nominal_ajuan, pumd_nominal_sumber, pumd_pmt_nomor
     FROM tpengajuan_uang_muka_dtl WHERE pumd_pum_nomor = ? ORDER BY pumd_id`,
    [pumNomor],
  );

  const itemRows = dtl.map((d) => {
    // Baik Pengajuan Dana maupun Permintaan Pembelian sama-sama belum
    // punya nominal aktual di tahap Realisasi — nominal riilnya baru
    // ditentukan Purchasing nanti di Penyelesaian (setelah barang
    // dibeli/harga pasti). Baris ini murni informasi: ACC otomatis,
    // terkunci, nominal 0.
    return {
      pumd_id: d.pumd_id,
      sumber: d.pumd_sumber,
      nomor_header: d.pumd_nomor_sumber,
      item_nourut: d.pumd_item_nourut,
      pmt_nomor: d.pumd_pmt_nomor,
      nama: d.pumd_nama,
      satuan: d.pumd_satuan,
      qty: Number(d.pumd_qty),
      keterangan: d.pumd_keterangan,
      nominal_sumber: Number(d.pumd_nominal_sumber) || 0,
      nominal_ajuan: 0,
      nominal_acc: 0,
      status_acc: "ACC",
      locked: true,
      kdsup: "",
      supplier: "",
      bank: "",
      rekening: "",
      atasnama: "",
    };
  });

  // Baris sintetis "KASBON" — mewakili total nominal yang benar-benar
  // diajukan Purchasing ke Finance (pum_total_nominal), terpisah dari
  // rincian per item Pengajuan Dana yang sifatnya baru estimasi. Baris
  // inilah satu-satunya yang Finance toggle ACC/Tolak dan tentukan
  // Total Realisasi — tidak tersimpan sebagai baris tpengajuan_uang_muka_dtl
  // tersendiri (pumd_id null), murni konstruksi tampilan/perhitungan.
  const kasbonRow = {
    pumd_id: null,
    sumber: "KASBON",
    nomor_header: hdr.pum_nomor,
    item_nourut: null,
    pmt_nomor: null,
    nama: "KASBON",
    satuan: "",
    qty: 1,
    keterangan: hdr.pum_keterangan || "",
    nominal_sumber: Number(hdr.pum_total_nominal) || 0,
    nominal_ajuan: Number(hdr.pum_total_nominal) || 0,
    nominal_acc: Number(hdr.pum_total_nominal) || 0,
    status_acc: "ACC",
    locked: false,
    kdsup: "",
    supplier: "",
    bank: "",
    rekening: "",
    atasnama: "",
  };

  const detail = [kasbonRow, ...itemRows];

  const [laciRows] = await db.query(
    `SELECT rek_kode, rek_nama FROM finance.trekening
     WHERE rek_parent = ? AND rek_pemilik = ? AND rek_isaktif = 0`,
    [KODE_INDUK_KAS, hdr.pum_user_create],
  );
  const laci = laciRows.length === 1 ? laciRows[0] : null;

  return {
    ...hdr,
    detail,
    laci_kode: laci?.rek_kode || "",
    laci_nama: laci?.rek_nama || "",
    laci_asal: KODE_LACI_FINANCE,
    cutoff: TANGGAL_MULAI_BLOKIR_INDUK,
  };
};

// Konvensi lama: cabang HO- memakai P01 untuk nomor bon/BKK/BBM
const cabangDokumen = (cabang) => (cabang === "HO-" ? "P01" : cabang);

// ── Transfer kas Finance -> laci penerima (sub-account A-111101) ──
const KODE_INDUK_KAS = "A-111101";
const KODE_LACI_FINANCE = "A-111118";
// Tolak realisasi bila saldo laci Finance kurang. Matikan (false) bila saldo
// awal cut-off bermasalah dan memblokir operasional.
const CEK_SALDO_LACI_SUMBER = true;

const fmtRupiah = (n) =>
  new Intl.NumberFormat("id-ID").format(Math.round(Number(n) || 0));

const getMaxNomorBkk = async (cabang, nomerator, conn) => {
  const prefix = `${cabang}-${nomerator}.${new Date().getFullYear()}.`;
  const [[row]] = await conn.query(
    `SELECT IFNULL(MAX(CAST(RIGHT(jur_no,5) AS UNSIGNED)),0) AS max_val
     FROM finance.tjurnal WHERE jur_no LIKE ?`,
    [`${prefix}%`],
  );
  return `${prefix}${String(Number(row.max_val) + 1).padStart(5, "0")}`;
};

// Laci milik user (anak A-111101). Lebih dari satu = data salah, hentikan.
const cariLaciPemilik = async (conn, userKode) => {
  if (!userKode) return "";
  const [rows] = await conn.query(
    `SELECT rek_kode FROM finance.trekening
     WHERE rek_parent = ? AND rek_pemilik = ? AND rek_isaktif = 0`,
    [KODE_INDUK_KAS, userKode],
  );
  if (rows.length > 1)
    throw new Error(
      `User ${userKode} memiliki lebih dari satu laci kas. Rapikan data account.`,
    );
  return rows[0]?.rek_kode || "";
};

const getParentAccount = async (conn, kode) => {
  const [[r]] = await conn.query(
    `SELECT rek_parent FROM finance.trekening WHERE rek_kode = ?`,
    [kode],
  );
  return r?.rek_parent || "";
};

// BKK: kredit laci asal (nourut 0), debet laci tujuan (nourut 1)
// + BKM otomatis (debet tujuan nourut 0, kredit asal nourut 1).
// Nomor BKM dibangun dari nomor BKK ini, BUKAN nomor BON, supaya tidak ikut
// terhapus oleh pembersihan jurnal otomatis di Penyelesaian.
const buatTransferLaci = async (
  conn,
  { tanggal, bonNomor, pumNomor, asal, tujuan, total, penerima, userKode },
) => {
  if (CEK_SALDO_LACI_SUMBER) {
    const saldo = await hitungSaldoAkun(asal, conn);
    if (saldo + 0.005 < total)
      throw new Error(
        `Saldo laci Finance (${asal}) tidak cukup: tersedia ${fmtRupiah(saldo)}, dibutuhkan ${fmtRupiah(total)}.`,
      );
  }

  const noBkk = await getMaxNomorBkk("P01", "BKK", conn);
  const uraian = `TRANSFER KAS UANG MUKA ${pumNomor} (${bonNomor})`;

  await conn.query(
    `INSERT INTO finance.tjurnal
       (jur_no, jur_tanggal, jur_tipetransaksi, jur_cabang, jur_nota,
        jur_penerima, jur_keterangan, jur_rek_kode, jur_otomatis,
        date_create, user_create)
     VALUES (?, ?, 'BKK', 'P01', ?, ?, ?, ?, 0, NOW(), ?)`,
    [noBkk, tanggal, bonNomor, penerima || "", uraian, asal, userKode],
  );
  await conn.query(
    `INSERT INTO finance.tjurnalitem
       (jurd_jur_no, jurd_rek_kode, jurd_kredit, jurd_uraian)
     VALUES (?, ?, ?, ?)`,
    [noBkk, asal, total, uraian],
  );
  await conn.query(
    `INSERT INTO finance.tjurnalitem
       (jurd_jur_no, jurd_trs, jurd_nourut, jurd_uraian, jurd_debet,
        jurd_rek_kode, jurd_cc_kode, jurd_dcnama)
     VALUES (?, 'BKK', 1, ?, ?, ?, 0, '')`,
    [noBkk, uraian, total, tujuan],
  );

  const noBkm = `01${noBkk}`;
  await conn.query(
    `INSERT INTO finance.tjurnal
       (jur_no, jur_tanggal, jur_tipetransaksi, jur_cabang, jur_penerima,
        jur_keterangan, jur_rek_kode, jur_otomatis, date_create, user_create)
     VALUES (?, ?, 'BKM', 'P01', ?, ?, ?, 1, NOW(), ?)`,
    [
      noBkm,
      tanggal,
      penerima || "",
      `BKM OTOMATIS: ${uraian}`,
      tujuan,
      userKode,
    ],
  );
  await conn.query(
    `INSERT INTO finance.tjurnalitem
       (jurd_jur_no, jurd_rek_kode, jurd_debet, jurd_uraian)
     VALUES (?, ?, ?, ?)`,
    [noBkm, tujuan, total, uraian],
  );
  await conn.query(
    `INSERT INTO finance.tjurnalitem
       (jurd_jur_no, jurd_trs, jurd_nourut, jurd_uraian, jurd_kredit,
        jurd_rek_kode)
     VALUES (?, 'BKM', 1, ?, ?, ?)`,
    [noBkm, uraian, total, asal],
  );
  return noBkk;
};

// ── Generate nomor bon — ported, prefix finance. ──
const getMaxNomor = async (cabang, conn) => {
  const prefix = `${cabangDokumen(cabang)}-BON.${new Date().getFullYear()}.`;
  const [[row]] = await (conn || db).query(
    `SELECT IFNULL(MAX(CAST(RIGHT(bon_nomor,5) AS UNSIGNED)),0) AS max_val
     FROM finance.tkasbon WHERE bon_nomor LIKE ?`,
    [`${prefix}%`],
  );
  return `${prefix}${String(Number(row.max_val) + 1).padStart(5, "0")}`;
};

// ── Simpan realisasi ──
// payload.detail: [{ pumd_id, sumber, nomor_sumber, pmt_nomor, status_acc, nominal_acc, kdsup, supplier, bank, rekening, atasnama }]
const saveRealisasi = async (pumNomor, payload, user) => {
  const { jenis, rek_kode, tanggal, nota, penerima, keterangan, detail } =
    payload;
  if (!detail || !detail.length) throw new Error("Detail realisasi kosong.");

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [[hdr]] = await conn.query(
      `SELECT pum_status, pum_cabang, pum_user_create FROM tpengajuan_uang_muka_hdr WHERE pum_nomor = ? FOR UPDATE`,
      [pumNomor],
    );
    if (!hdr) throw new Error("Pengajuan Uang Muka tidak ditemukan.");
    if (hdr.pum_status !== "DIAJUKAN")
      throw new Error(`Pengajuan ini sudah berstatus ${hdr.pum_status}.`);

    const accRows = detail.filter((d) => d.status_acc === "ACC");
    const isFullTolak = accRows.length === 0;

    if (
      !isFullTolak &&
      ["HO-", "P01"].includes(String(hdr.pum_cabang).trim().toUpperCase())
    ) {
      const [[v]] = await conn.query(
        `SELECT val_aksi FROM tpengajuan_uang_muka_validasi
         WHERE val_pum_nomor = ? ORDER BY val_id DESC LIMIT 1`,
        [pumNomor],
      );
      if (!v || v.val_aksi !== "VALIDASI")
        throw new Error(
          "Pengajuan cabang HO-/P01 harus divalidasi dulu sebelum direalisasi.",
        );
    }

    let bonNomor = null;
    let totalNominal = 0;
    let rekFinal = rek_kode;
    let transferJurNo = "";

    if (!isFullTolak) {
      if (!rek_kode)
        throw new Error("Rekening/Kas wajib diisi untuk realisasi.");

      totalNominal = accRows.reduce(
        (s, d) => s + Number(d.nominal_acc || 0),
        0,
      );
      const jenisInt = jenis === "KAS" ? 0 : 1;
      const cabangDok = cabangDokumen(hdr.pum_cabang);

      // Setelah cut-off: kas otomatis ke laci milik pembuat PUM (jika punya).
      const modeLaci =
        jenis === "KAS" && cabangDok === "P01" && isSetelahCutoff(tanggal);
      if (modeLaci) {
        const laci = await cariLaciPemilik(conn, hdr.pum_user_create);
        if (laci) rekFinal = laci;
      }
      await assertBolehPosting([rekFinal], tanggal, conn);

      bonNomor = await getMaxNomor(hdr.pum_cabang, conn);

      await conn.query(
        `INSERT INTO finance.tkasbon
          (bon_nomor, bon_tanggal, bon_pjh_nomor, bon_jenis, bon_nota, bon_nominal,
           bon_penerima, bon_cabang, bon_rek_kode, bon_keterangan, date_create, user_create)
         VALUES (?, ?, '', ?, ?, ?, ?, ?, ?, ?, NOW(), ?)`,
        [
          bonNomor,
          tanggal,
          jenisInt,
          nota || "",
          totalNominal,
          penerima || "",
          cabangDok,
          rekFinal,
          keterangan || "",
          user.kode,
        ],
      );

      // Transfer hanya bila kas tujuan adalah laci (anak A-111101) dan bukan
      // laci Finance sendiri, serta ada nominal yang direalisasi.
      if (
        modeLaci &&
        totalNominal > 0 &&
        rekFinal !== KODE_LACI_FINANCE &&
        (await getParentAccount(conn, rekFinal)) === KODE_INDUK_KAS
      ) {
        transferJurNo = await buatTransferLaci(conn, {
          tanggal,
          bonNomor,
          pumNomor,
          asal: KODE_LACI_FINANCE,
          tujuan: rekFinal,
          total: totalNominal,
          penerima,
          userKode: user.kode,
        });
        await conn.query(
          `UPDATE finance.tkasbon
           SET bon_transfer_jur_no = ?, bon_transfer_asal = ?
           WHERE bon_nomor = ?`,
          [transferJurNo, KODE_LACI_FINANCE, bonNomor],
        );
      }
    }

    let nourut = 1;
    for (const d of detail) {
      const isAcc = d.status_acc === "ACC";

      if (d.sumber === "PENGAJUAN_DANA" && d.pmt_nomor) {
        if (isAcc) {
          await conn.query(
            `UPDATE ga2.tpermintaan_hdr SET pmt_approval = 1 WHERE pmt_nomor = ?`,
            [d.pmt_nomor],
          );
          await conn.query(
            `UPDATE ga2.tpermintaan_dtl SET
               pmd_tanggal_approved = CURDATE(), pmd_user_approved = ?, pmd_dana_approved = ?,
               pmd_tanggal_reject = NULL, pmd_kode_reject = 0, pmd_user_reject = '', pmd_bon = ?,
               pmd_status_finance = 'MENUNGGU_PEMBELIAN'
             WHERE pmd_pmt_nomor = ? AND pmd_nourut = ?`,
            [
              user.kode,
              Number(d.nominal_acc),
              bonNomor,
              d.pmt_nomor,
              d.item_nourut,
            ],
          );
        } else {
          await conn.query(
            `UPDATE ga2.tpermintaan_dtl SET
               pmd_tanggal_reject = CURDATE(), pmd_kode_reject = 2, pmd_user_reject = ?,
               pmd_tanggal_approved = NULL, pmd_user_approved = '', pmd_dana_approved = 0, pmd_bon = ?,
               pmd_status_finance = NULL
             WHERE pmd_pmt_nomor = ? AND pmd_nourut = ?`,
            [user.kode, bonNomor, d.pmt_nomor, d.item_nourut],
          );
        }

        const [[remaining]] = await conn.query(
          `SELECT COUNT(*) AS cnt FROM ga2.tpermintaan_dtl
           WHERE pmd_pmt_nomor = ? AND pmd_tanggal_approved IS NULL AND pmd_tanggal_reject IS NULL`,
          [d.pmt_nomor],
        );
        if (Number(remaining.cnt) === 0) {
          await conn.query(
            `UPDATE ga2.tpermintaan_hdr SET pmt_close = 1, pmt_tglclose = NOW() WHERE pmt_nomor = ?`,
            [d.pmt_nomor],
          );
        }
      }

      if (d.sumber === "PERMINTAAN_PEMBELIAN" && isAcc) {
        await conn.query(
          `INSERT INTO finance.tkasbonitem
            (bond_nomor, bond_nourut, bond_nama, bond_spesifikasi, bond_satuan,
             bond_qty, bond_nominal, bond_verified, bond_ref_tipe, bond_ref_nomor, bond_ref_nourut)
           VALUES (?, ?, ?, '', ?, ?, 0, 0, ?, ?, ?)`,
          [
            bonNomor,
            nourut,
            d.nama || d.nomor_header,
            d.satuan || "",
            d.qty || 0,
            "PERMINTAAN_PEMBELIAN",
            d.nomor_header,
            d.item_nourut,
          ],
        );
        nourut++;
      }

      // Sumber dokumen/PO: siapkan baris bon supaya Penyelesaian langsung
      // terisi (nominal, akun, rekening). Data dibaca dari DB, bukan payload.
      if (isAcc && ["BKK_P04", "INSENTIF", "PO_LAIN_LAIN"].includes(d.sumber)) {
        const [[src]] = await conn.query(
          `SELECT pumd_nomor_sumber, pumd_item_nourut, pumd_nama,
                  pumd_satuan, pumd_nominal_sumber
           FROM tpengajuan_uang_muka_dtl
           WHERE pumd_id = ? AND pumd_pum_nomor = ?`,
          [d.pumd_id, pumNomor],
        );
        if (!src) throw new Error("Baris pengajuan tidak ditemukan.");
        const nominal = Number(src.pumd_nominal_sumber) || 0;
        let rekKode = "";
        let supKode = "";
        let supNama = "";
        let bank = "";
        let rekening = "";
        let atasnama = "";

        if (d.sumber === "BKK_P04") {
          // Ganti kas kecil: akun default = kas P04 pada BKK itu, supaya
          // Penyelesaian mengisi kas (bukan membiayakan lagi).
          const [[j]] = await conn.query(
            `SELECT jur_rek_kode FROM finance.tjurnal WHERE jur_no = ?`,
            [src.pumd_nomor_sumber],
          );
          rekKode = j?.jur_rek_kode || "";
        } else if (d.sumber === "INSENTIF") {
          const [[f]] = await conn.query(
            `SELECT c.Cus_nama, f.fee_bank, f.fee_rekening, f.fee_atasnama
             FROM tpengajuan_fee f
             LEFT JOIN tcustomer c ON c.Cus_kode = f.fee_cus_kode
             WHERE f.fee_nomor = ?`,
            [src.pumd_nomor_sumber],
          );
          supNama = f?.Cus_nama || "";
          bank = f?.fee_bank || "";
          rekening = f?.fee_rekening || "";
          atasnama = f?.fee_atasnama || "";
        } else {
          const [[p]] = await conn.query(
            `SELECT d.pod_sup_kode, s.sup_nama
             FROM tpo_dtl d
             LEFT JOIN tsupplier s ON s.sup_kode = d.pod_sup_kode
             WHERE d.pod_po_Nomor = ? AND d.pod_nourut = ?`,
            [src.pumd_nomor_sumber, src.pumd_item_nourut],
          );
          supKode = p?.pod_sup_kode || "";
          supNama = p?.sup_nama || "";
        }

        await conn.query(
          `INSERT INTO finance.tkasbonitem
            (bond_nomor, bond_nourut, bond_nama, bond_spesifikasi, bond_satuan,
             bond_qty, bond_nominal, bond_qty_realisasi, bond_nominal_realisasi,
             bond_verified, bond_ref_tipe, bond_ref_nomor, bond_ref_nourut,
             bond_rek_kode, bond_sup_kode, bond_sup_nama,
             bond_bank, bond_rekening, bond_atasnama)
           VALUES (?, ?, ?, '', ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            bonNomor,
            nourut,
            src.pumd_nama || src.pumd_nomor_sumber,
            src.pumd_satuan || "",
            Number(d.qty) || 1,
            nominal,
            Number(d.qty) || 1,
            nominal,
            d.sumber,
            src.pumd_nomor_sumber,
            src.pumd_item_nourut,
            rekKode,
            supKode,
            supNama,
            bank,
            rekening,
            atasnama,
          ],
        );
        nourut++;
      }

      if (d.sumber === "INSENTIF" && isAcc) {
        const [upd] = await conn.query(
          `UPDATE tpengajuan_fee SET fee_tgl_realisasi = ?
           WHERE fee_nomor = ? AND fee_tgl_realisasi IS NULL`,
          [tanggal, d.nomor_header],
        );
        if (upd.affectedRows === 0)
          throw new Error(`Insentif ${d.nomor_header} sudah direalisasi.`);
      }

      await conn.query(
        `UPDATE tpengajuan_uang_muka_dtl SET pumd_status_acc = ?, pumd_nominal_acc = ? WHERE pumd_id = ?`,
        [d.status_acc, Number(d.nominal_acc || 0), d.pumd_id],
      );
    }

    if (isFullTolak) {
      await conn.query(
        `UPDATE tpengajuan_uang_muka_hdr SET
           pum_status = 'DITOLAK', pum_user_realisasi = ?, pum_date_realisasi = NOW()
         WHERE pum_nomor = ?`,
        [user.kode, pumNomor],
      );
    } else {
      await conn.query(
        `UPDATE tpengajuan_uang_muka_hdr SET
           pum_status = 'REALISASI', pum_bon_nomor = ?, pum_total_nominal = ?,
           pum_user_realisasi = ?, pum_date_realisasi = NOW()
         WHERE pum_nomor = ?`,
        [bonNomor, totalNominal, user.kode, pumNomor],
      );
    }

    await conn.commit();
    return {
      bonNomor,
      totalNominal,
      status: isFullTolak ? "DITOLAK" : "REALISASI",
      rekKode: isFullTolak ? "" : rekFinal,
      transferJurNo,
    };
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
};

// ── Data cetak Bukti Kasbon — dari PUM + tkasbon terkait ──
const getPrintData = async (pumNomor) => {
  const [[hdr]] = await db.query(
    `SELECT h.pum_nomor, h.pum_bon_nomor, h.pum_total_nominal,
            h.pum_user_create, h.pum_user_realisasi,
            DATE_FORMAT(h.pum_date_realisasi, '%d-%m-%Y %H:%i') AS realisasi_fmt,
            IFNULL(ur.user_nama, h.pum_user_realisasi) AS kasir_nama,
            DATE_FORMAT(h.pum_tanggal, '%d-%m-%Y') AS tanggal_fmt,
            h.pum_keterangan, h.pum_cabang,
            k.bon_tanggal, DATE_FORMAT(k.bon_tanggal, '%d-%m-%Y') AS bon_tanggal_fmt,
            k.bon_nota, k.bon_penerima, k.bon_keterangan, k.bon_pjh_nomor
     FROM tpengajuan_uang_muka_hdr h
     LEFT JOIN finance.tkasbon k ON k.bon_nomor = h.pum_bon_nomor
     LEFT JOIN tuser ur ON ur.user_kode = h.pum_user_realisasi
     WHERE h.pum_nomor = ?`,
    [pumNomor],
  );
  if (!hdr) throw new Error("Pengajuan Uang Muka tidak ditemukan.");
  if (!hdr.pum_bon_nomor)
    throw new Error("Pengajuan ini belum direalisasi, belum ada nomor bon.");

  const [dtl] = await db.query(
    `SELECT pumd_sumber, pumd_nomor_sumber, pumd_nama, pumd_satuan, pumd_qty,
            pumd_nominal_acc
     FROM tpengajuan_uang_muka_dtl
     WHERE pumd_pum_nomor = ? AND pumd_status_acc = 'ACC'
     ORDER BY pumd_id`,
    [pumNomor],
  );

  const itemRows = dtl.map((d) => {
    const qty = Number(d.pumd_qty) || 1;
    const nominal = Number(d.pumd_nominal_acc) || 0;
    return {
      sumber: d.pumd_sumber,
      nomorSumber: d.pumd_nomor_sumber,
      nama: d.pumd_nama,
      spesifikasi: d.pumd_satuan || "",
      qty,
      nilai: qty > 0 ? nominal / qty : nominal,
      total: nominal,
    };
  });

  const gtotal = Number(hdr.pum_total_nominal) || 0;

  const kasbonRow = {
    sumber: "KASBON",
    nomorSumber: "",
    nama: "KASBON",
    spesifikasi: "",
    qty: 1,
    nilai: gtotal,
    total: gtotal,
  };

  const detail = [...itemRows, kasbonRow];

  return {
    nomor: hdr.pum_bon_nomor,
    tanggal_fmt: hdr.bon_tanggal_fmt || hdr.tanggal_fmt,
    pjh: hdr.bon_pjh_nomor || "",
    nota: hdr.bon_nota || "",
    keterangan: hdr.bon_keterangan || hdr.pum_keterangan || "",
    detail,
    penerima: hdr.pum_user_create || "",
    kasir: hdr.pum_user_realisasi || "",
    gtotal,
    kasir_stempel:
      ["HO-", "P01"].includes(String(hdr.pum_cabang).trim().toUpperCase()) &&
      hdr.pum_user_realisasi &&
      hdr.realisasi_fmt
        ? { nama: hdr.kasir_nama, tanggal_fmt: hdr.realisasi_fmt }
        : null,
  };
};

// Pemilik laci penerima mengonfirmasi uang kasbon sudah diterima.
// Tidak ada pengecualian untuk ADMIN/Finance: hanya pemilik laci.
const konfirmasiTerima = async (bonNomor, user) => {
  const [[bon]] = await db.query(
    `SELECT k.bon_transfer_jur_no, k.bon_konfirmasi_tgl, r.rek_pemilik
     FROM finance.tkasbon k
     LEFT JOIN finance.trekening r ON r.rek_kode = k.bon_rek_kode
     WHERE k.bon_nomor = ?`,
    [bonNomor],
  );
  if (!bon) throw new Error("Kasbon tidak ditemukan.");
  if (!bon.bon_transfer_jur_no)
    throw new Error(
      "Kasbon ini tidak memakai transfer kas, tidak perlu konfirmasi.",
    );
  if (bon.bon_konfirmasi_tgl) throw new Error("Kasbon ini sudah dikonfirmasi.");
  if (
    String(bon.rek_pemilik || "").toUpperCase() !==
    String(user.kode || "").toUpperCase()
  )
    throw new Error("Hanya pemilik laci penerima yang dapat mengonfirmasi.");

  const [res] = await db.query(
    `UPDATE finance.tkasbon
     SET bon_konfirmasi_tgl = NOW(), bon_konfirmasi_user = ?
     WHERE bon_nomor = ? AND bon_konfirmasi_tgl IS NULL`,
    [user.kode, bonNomor],
  );
  if (res.affectedRows === 0) throw new Error("Kasbon ini sudah dikonfirmasi.");
  return { bonNomor };
};

module.exports = {
  getAccountOptions,
  getSupplierOptions,
  getPumOptions,
  getDetailForRealisasi,
  saveRealisasi,
  getPrintData,
  konfirmasiTerima,
};
