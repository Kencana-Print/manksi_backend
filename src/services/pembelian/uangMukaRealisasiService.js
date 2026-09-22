const db = require("../../config/database");

// ── Lookup account (KAS/BANK) — ported, prefix financenew. ──
const getAccountOptions = async (jenis, cabang) => {
  const effectiveCabang = cabang === "HO-" ? "P01" : cabang;
  let whereClause;
  if (jenis === "KAS") {
    whereClause = `LEFT(rek_kode,5)='A-111'`;
    whereClause += ` AND rek_cabang = '${effectiveCabang && effectiveCabang !== "P01" ? effectiveCabang : "P01"}'`;
  } else {
    whereClause = `(LEFT(rek_kode,5)='A-112' OR LEFT(rek_kode,5)='B-211')`;
    if (effectiveCabang && effectiveCabang !== "P01")
      whereClause += ` AND rek_cabang = '${effectiveCabang}'`;
  }
  const [rows] = await db.query(
    `SELECT rek_kode AS kode, rek_nama AS nama, rek_cabang AS cabang
     FROM financenew.trekening WHERE ${whereClause} ORDER BY rek_kode`,
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

  return { ...hdr, detail };
};

// ── Generate nomor bon — ported, prefix financenew. ──
const getMaxNomor = async (cabang, conn) => {
  const prefix = `${cabang}-BON.${new Date().getFullYear()}.`;
  const [[row]] = await (conn || db).query(
    `SELECT IFNULL(MAX(CAST(RIGHT(bon_nomor,5) AS UNSIGNED)),0) AS max_val
     FROM financenew.tkasbon WHERE bon_nomor LIKE ?`,
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
      `SELECT pum_status, pum_cabang FROM tpengajuan_uang_muka_hdr WHERE pum_nomor = ? FOR UPDATE`,
      [pumNomor],
    );
    if (!hdr) throw new Error("Pengajuan Uang Muka tidak ditemukan.");
    if (hdr.pum_status !== "DIAJUKAN")
      throw new Error(`Pengajuan ini sudah berstatus ${hdr.pum_status}.`);

    const accRows = detail.filter((d) => d.status_acc === "ACC");
    if (!accRows.length)
      throw new Error("Minimal 1 baris harus ACC untuk realisasi.");

    const totalNominal = accRows.reduce(
      (s, d) => s + Number(d.nominal_acc || 0),
      0,
    );
    const jenisInt = jenis === "KAS" ? 0 : 1;
    const bonNomor = await getMaxNomor(hdr.pum_cabang, conn);

    await conn.query(
      `INSERT INTO financenew.tkasbon
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
        hdr.pum_cabang,
        rek_kode,
        keterangan || "",
        user.kode,
      ],
    );

    let nourut = 1;
    for (const d of detail) {
      const isAcc = d.status_acc === "ACC";

      if (d.sumber === "PENGAJUAN_DANA" && d.pmt_nomor) {
        if (isAcc) {
          await conn.query(
            `UPDATE ga2new.tpermintaan_hdr SET pmt_approval = 1 WHERE pmt_nomor = ?`,
            [d.pmt_nomor],
          );
          await conn.query(
            `UPDATE ga2new.tpermintaan_dtl SET
               pmd_tanggal_approved = CURDATE(), pmd_user_approved = ?, pmd_dana_approved = ?,
               pmd_tanggal_reject = NULL, pmd_kode_reject = 0, pmd_user_reject = '', pmd_bon = ?
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
            `UPDATE ga2new.tpermintaan_dtl SET
               pmd_tanggal_reject = CURDATE(), pmd_kode_reject = 2, pmd_user_reject = ?,
               pmd_tanggal_approved = NULL, pmd_user_approved = '', pmd_dana_approved = 0, pmd_bon = ?
             WHERE pmd_pmt_nomor = ? AND pmd_nourut = ?`,
            [user.kode, bonNomor, d.pmt_nomor, d.item_nourut],
          );
        }

        // Close header hanya kalau SEMUA item di permintaan ini sudah dispositioned
        const [[remaining]] = await conn.query(
          `SELECT COUNT(*) AS cnt FROM ga2new.tpermintaan_dtl
           WHERE pmd_pmt_nomor = ? AND pmd_tanggal_approved IS NULL AND pmd_tanggal_reject IS NULL`,
          [d.pmt_nomor],
        );
        if (Number(remaining.cnt) === 0) {
          await conn.query(
            `UPDATE ga2new.tpermintaan_hdr SET pmt_close = 1, pmt_tglclose = NOW() WHERE pmt_nomor = ?`,
            [d.pmt_nomor],
          );
        }
      }

      if (d.sumber === "PERMINTAAN_PEMBELIAN" && isAcc) {
        // Snapshot item ke tkasbonitem — nominal/qty sengaja 0 karena
        // nilai aktual baru diisi Purchasing nanti di Penyelesaian.
        // bond_ref_tipe/bond_ref_nomor menyimpan nomor sumber supaya
        // form Penyelesaian tahu No.Pengajuan-nya tanpa input ulang.
        await conn.query(
          `INSERT INTO financenew.tkasbonitem
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

      await conn.query(
        `UPDATE tpengajuan_uang_muka_dtl SET pumd_status_acc = ?, pumd_nominal_acc = ? WHERE pumd_id = ?`,
        [d.status_acc, Number(d.nominal_acc || 0), d.pumd_id],
      );
    }

    await conn.query(
      `UPDATE tpengajuan_uang_muka_hdr SET
         pum_status = 'REALISASI', pum_bon_nomor = ?, pum_total_nominal = ?,
         pum_user_realisasi = ?, pum_date_realisasi = NOW()
       WHERE pum_nomor = ?`,
      [bonNomor, totalNominal, user.kode, pumNomor],
    );

    await conn.commit();
    return { bonNomor, totalNominal };
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
            DATE_FORMAT(h.pum_tanggal, '%d-%m-%Y') AS tanggal_fmt,
            h.pum_keterangan, h.pum_cabang,
            k.bon_tanggal, DATE_FORMAT(k.bon_tanggal, '%d-%m-%Y') AS bon_tanggal_fmt,
            k.bon_nota, k.bon_penerima, k.bon_keterangan, k.bon_pjh_nomor
     FROM tpengajuan_uang_muka_hdr h
     LEFT JOIN financenew.tkasbon k ON k.bon_nomor = h.pum_bon_nomor
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
  };
};

module.exports = {
  getAccountOptions,
  getSupplierOptions,
  getPumOptions,
  getDetailForRealisasi,
  saveRealisasi,
  getPrintData,
};
