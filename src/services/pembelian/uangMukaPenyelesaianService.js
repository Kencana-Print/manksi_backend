const db = require("../../config/database");
const { ensurePermintaanDana } = require("./pengajuanUangMukaService");

// ── Load form penyelesaian — by nomor BON (kasbon), sama seperti alur lama ──
const getFormData = async (nomor) => {
  const [[bon]] = await db.query(
    `
      SELECT k.bon_nomor, k.bon_selesai, k.bon_jenis, k.bon_tanggal,
        k.bon_pjh_nomor, k.bon_jur_no, k.bon_rek_kode,
        k.bon_nota, k.bon_nominal, k.bon_penerima,
        k.bon_keterangan,
        k.bon_cabang, k.bon_byrvoucher,
        r.rek_nama,
        DATE_FORMAT(k.bon_tanggal,'%Y-%m-%d') AS bon_tanggal_fmt,
        DATE_FORMAT(t.jur_tanggal, '%Y-%m-%d') AS jur_tanggal_fmt,
        h.pum_user_create AS pum_user_create,
        h.pum_user_realisasi AS pum_user_realisasi
      FROM financenew.tkasbon k
      LEFT JOIN financenew.tjurnal t ON t.jur_no = k.bon_jur_no
      LEFT JOIN financenew.trekening r ON r.rek_kode = k.bon_rek_kode
      LEFT JOIN tpengajuan_uang_muka_hdr h ON h.pum_bon_nomor = k.bon_nomor
      WHERE k.bon_nomor = ?
    `,
    [nomor],
  );

  if (!bon) throw new Error("Nomor kasbon tidak ditemukan.");

  const isEdit = Number(bon.bon_selesai) !== 0;
  const nomerator = Number(bon.bon_jenis) === 0 ? "BKK" : "BBK";
  const today = new Date().toISOString().slice(0, 10);
  const tglBkk = bon.jur_tanggal_fmt || today;

  // ── Detail non-GA dari tkasbonitem (diisi otomatis dari sumber
  // PERMINTAAN_PEMBELIAN saat Realisasi, atau ditambah manual di sini) ──
  const [itemRows] = await db.query(
    `
    SELECT k.*,
      r.rek_nama,
      c.cc_nama,
      k.bond_nourut AS no,
      k.bond_nama   AS uraian,
      k.bond_spesifikasi AS spesifikasi,
      k.bond_satuan AS satuan,
      k.bond_sup_kode AS kdsup,
      k.bond_sup_nama AS supplier,
      k.bond_bank AS bank,
      k.bond_rekening AS rekening,
      k.bond_atasnama AS atasnama,
      k.bond_rek_kode  AS rekkode,
      k.bond_cc_kode   AS cckode,
      k.bond_dcnama    AS dcnama,
      k.bond_verified  AS verified_raw,
      k.bond_qty_realisasi,
      k.bond_nominal_realisasi,
      IF(k.bond_ref_tipe = 'PERMINTAAN_PEMBELIAN', mb.mb_jenis, NULL) AS mb_jenis_item,
      IF(k.bond_ref_tipe = 'PERMINTAAN_PEMBELIAN', mb.mb_cab, NULL) AS mb_cab_item,
      IF(k.bond_ref_tipe = 'PERMINTAAN_PEMBELIAN', mbd.mbd_brg_kode, NULL) AS mb_kdbrg
    FROM financenew.tkasbonitem k
    LEFT JOIN financenew.trekening r ON r.rek_kode = k.bond_rek_kode
    LEFT JOIN financenew.tcostcenter c ON c.cc_kode = k.bond_cc_kode
    LEFT JOIN tgarmenmintabeli_hdr mb
      ON k.bond_ref_tipe = 'PERMINTAAN_PEMBELIAN' AND mb.mb_nomor = k.bond_ref_nomor
    LEFT JOIN tgarmenmintabeli_dtl mbd
      ON k.bond_ref_tipe = 'PERMINTAAN_PEMBELIAN' AND mbd.mbd_nomor = k.bond_ref_nomor
      AND mbd.mbd_nourut = k.bond_ref_nourut
    WHERE k.bond_nomor = ?
    ORDER BY k.bond_nourut
  `,
    [nomor],
  );

  const detailNonGA = itemRows.map((r) => {
    const qtyMinta = Number(r.bond_qty);
    const qtyBeli =
      isEdit && Number(r.verified_raw) !== 0
        ? Number(r.bond_qty_realisasi)
        : Number(r.bond_qty_realisasi) || 0;
    const harga =
      isEdit && Number(r.verified_raw) !== 0
        ? Number(r.bond_nominal_realisasi)
        : Number(r.bond_nominal);
    return {
      no: r.no,
      pjh: r.bond_ref_nomor || "",
      item_nourut: r.bond_ref_nourut,
      pmt: "",
      uraian: r.uraian,
      spesifikasi: r.spesifikasi || "",
      satuan: r.satuan || "",
      qty_minta: qtyMinta,
      qty: qtyBeli,
      harga,
      total: qtyBeli * harga,
      verified: isEdit ? Number(r.verified_raw) !== 0 : true,
      guna: "",
      ga: 2,
      rekkode: r.rekkode || "",
      reknama: r.rek_nama || "",
      cckode: r.cckode || 0,
      ccnama: r.cc_nama || "",
      dcnama: r.dcnama || "",
      kdsup: r.kdsup || "",
      supplier: r.supplier || "",
      bank: r.bank || "",
      rekening: r.rekening || "",
      atasnama: r.atasnama || "",
      gabrg: 0,
      edit: isEdit ? 1 : 0,
      pjh_link: "",
      kdbrg: r.mb_kdbrg || "",
      mb: r.bond_ref_tipe === "PERMINTAAN_PEMBELIAN" ? r.bond_ref_nomor : "",
      jenis_item: r.mb_jenis_item || "",
      cab_item: r.mb_cab_item || "",
    };
  });

  // ── Detail GA dari ga2new.tpermintaan_dtl (diisi otomatis oleh
  // saveRealisasi PUM, atau via F1 manual di sini) ──
  const [gaRows] = await db.query(
    `
    SELECT
      h.pmt_pjh_nomor, h.pmt_nomor, h.pmt_buyed,
      h.pmt_status_finance,
      DATE_FORMAT(j.pjh_tanggal,'%Y-%m-%d') AS pjh_tanggal,
      DATE_FORMAT(h.pmt_tanggal,'%Y-%m-%d') AS pmt_tanggal,
      j.pjh_jenis_permintaan, j.pjh_nonga,
      j.pjh_nik, p.nama, p.bagian, p.lokasi,
      d.pmd_nourut, d.pmd_nama, d.pmd_spesifikasi,
      d.pmd_qty_riil, d.pmd_satuan,
      d.pmd_qty_buyed, d.pmd_nilai, d.pmd_nilai_buyed,
      d.pmd_dana_approved, d.pmd_tanggal_reject,
      d.pmd_bon, d.pmd_kegunaan, d.pmd_verified_buyed,
      d.pmd_nilai_terpakai, d.pmd_tanggal_approved,
      d.pmd_tanggal_buyed, d.pmd_rek_kode, d.pmd_status_finance,
      r.rek_nama, d.pmd_cc_kode, c.cc_nama, d.pmd_dcnama,
      j.pjh_cc_kode, j.pjh_cc_dcnama, pcc.cc_nama AS pjh_cc_nama
    FROM financenew.tkasbon k
    INNER JOIN ga2new.tpermintaan_dtl d ON d.pmd_bon = k.bon_nomor
    INNER JOIN ga2new.tpermintaan_hdr h ON h.pmt_nomor = d.pmd_pmt_nomor
    INNER JOIN ga2new.tpengajuan2_hdr j ON j.pjh_nomor = h.pmt_pjh_nomor
    INNER JOIN ga2new.peminta p ON p.nik = j.pjh_nik
    LEFT JOIN financenew.trekening r ON r.rek_kode = d.pmd_rek_kode
    LEFT JOIN financenew.tcostcenter c ON c.cc_kode = d.pmd_cc_kode
    LEFT JOIN financenew.tcostcenter pcc ON pcc.cc_kode = j.pjh_cc_kode
    WHERE h.pmt_approval = 1 AND d.pmd_tanggal_approved IS NOT NULL
      AND k.bon_nomor = ?
    ORDER BY d.pmd_nourut
  `,
    [nomor],
  );

  let infoPermintaan = null;
  if (gaRows.length > 0 && bon.bon_pjh_nomor) {
    const g = gaRows[0];
    infoPermintaan = {
      pjh_nomor: g.pmt_pjh_nomor,
      pjh_tanggal: g.pjh_tanggal,
      pmt_nomor: g.pmt_nomor,
      pmt_tanggal: g.pmt_tanggal,
      jenis_permintaan: g.pjh_jenis_permintaan,
      pjh_nik: g.pjh_nik,
      nama: g.nama,
      bagian: g.bagian,
      lokasi: g.lokasi,
    };
  }

  const detailGA = gaRows
    .filter((r) => r.pmd_nama)
    .map((r) => {
      const isGabrg =
        r.pjh_jenis_permintaan?.toUpperCase() === "PERMINTAAN BARANG" &&
        Number(r.pjh_nonga) === 0;
      // Delphi: jika flagedit dan pmd_verified_buyed<>0 → pakai buyed, else pakai approved/nilai
      let qty, harga;
      if (isEdit && Number(r.pmd_verified_buyed) !== 0) {
        qty = Number(r.pmd_qty_buyed);
        harga = Number(r.pmd_nilai_buyed);
      } else if (
        Number(r.pmd_dana_approved) === 0 &&
        Number(r.pmd_verified_buyed) === 0
      ) {
        // Item dari Pengajuan Dana yang direalisasi lewat baris KASBON
        // umum (belum pernah diproses Purchasing di Penyelesaian) —
        // biarkan 0, Purchasing wajib input Qty & Nominal aktual
        // sendiri, bukan mewarisi nilai dari pengajuan awal.
        qty = 0;
        harga = 0;
      } else {
        qty = Number(r.pmd_qty_riil);
        harga =
          Number(r.pmd_dana_approved) !== 0
            ? Number(r.pmd_dana_approved)
            : Number(r.pmd_nilai);
      }

      return {
        no: r.pmd_nourut,
        pjh: r.pmt_pjh_nomor || "",
        pmt: r.pmt_nomor,
        uraian: r.pmd_nama,
        spesifikasi: r.pmd_spesifikasi || "",
        satuan: r.pmd_satuan || "",
        qty_minta: Number(r.pmd_qty_riil),
        qty,
        harga,
        total: qty * harga,
        verified: isEdit ? Number(r.pmd_verified_buyed) !== 0 : true,
        guna: r.pmd_kegunaan || "",
        ga: 1,
        rekkode: r.pmd_rek_kode || "",
        reknama: r.rek_nama || "",
        cckode: r.pmd_cc_kode || r.pjh_cc_kode || 0,
        ccnama: r.cc_nama || r.pjh_cc_nama || "",
        dcnama: r.pmd_dcnama || r.pjh_cc_dcnama || "",
        statusFinance: r.pmt_status_finance || "",
        kdsup: "",
        supplier: "",
        bank: "",
        rekening: "",
        atasnama: "",
        gabrg: isGabrg ? 1 : 0,
        edit: isEdit ? 1 : 0,
        pjh_link: "",
        kdbrg: "",
        mb: "",
        jenis_item: "",
        cab_item: "",
      };
    });

  // ── Detail tkasbonitem2 (item baru non-GA/POE/voucher) ──
  const [item2Rows] = await db.query(
    `
    SELECT k.*,
      r.rek_nama, c.cc_nama,
      IF(k.bond2_link='','',
        IFNULL(m.mb_jenis, v.iv_jenis)) AS jenis_item,
      IF(k.bond2_link='','',
        IFNULL(m.mb_cab, v.iv_cab)) AS cab_item,
      IF(k.bond2_link='','',
        IFNULL(m.mb_nomor,'')) AS mb
    FROM financenew.tkasbonitem2 k
    LEFT JOIN financenew.trekening r ON r.rek_kode = k.bond2_rek_kode
    LEFT JOIN financenew.tcostcenter c ON c.cc_kode = k.bond2_cc_kode
    LEFT JOIN tgarmenmintabeli_hdr m ON m.mb_nomor = k.bond2_link
    LEFT JOIN tgarmeniv_hdr v ON v.iv_nomor = k.bond2_link
    WHERE k.bond2_nomor = ?
    ORDER BY k.bond2_nourut
  `,
    [nomor],
  );

  const detailItem2 = item2Rows.map((r) => ({
    no: r.bond2_nourut,
    pjh: r.bond2_link || "",
    pmt: "",
    uraian: r.bond2_nama,
    spesifikasi: r.bond2_spesifikasi || "",
    satuan: r.bond2_satuan || "",
    qty_minta: Number(r.bond2_qty_realisasi),
    qty: Number(r.bond2_qty_realisasi),
    harga: Number(r.bond2_nominal_realisasi),
    total: Number(r.bond2_qty_realisasi) * Number(r.bond2_nominal_realisasi),
    verified: true,
    guna: "",
    ga: 0,
    rekkode: r.bond2_rek_kode || "",
    reknama: r.rek_nama || "",
    cckode: r.bond2_cc_kode || 0,
    ccnama: r.cc_nama || "",
    dcnama: r.bond2_dcnama || "",
    kdsup: r.bond2_sup_kode || "",
    supplier: r.bond2_sup_nama || "",
    bank: r.bond2_bank || "",
    rekening: r.bond2_rekening || "",
    atasnama: r.bond2_atasnama || "",
    gabrg: 0,
    edit: isEdit ? 1 : 0,
    pjh_link: r.bond2_link || "",
    kdbrg: r.bond2_brg_kode || "",
    mb: r.mb || "",
    jenis_item: r.jenis_item || "",
    cab_item: r.cab_item || "",
  }));

  const detail = [...detailNonGA, ...detailGA, ...detailItem2];

  return {
    nomor: bon.bon_nomor,
    jenis: Number(bon.bon_jenis) === 0 ? "KAS" : "BANK",
    nomerator,
    tanggal: bon.bon_tanggal_fmt,
    tgl_bkk: tglBkk,
    no_bkk: bon.bon_jur_no || "",
    rek_kode: bon.bon_rek_kode,
    rek_nama: bon.rek_nama,
    pjh_nomor: bon.bon_pjh_nomor || "",
    nota: bon.bon_nota || "",
    nominal: Number(bon.bon_nominal),
    penerima: bon.bon_penerima || "",
    keterangan: bon.bon_keterangan || "",
    cabang: bon.bon_cabang,
    is_edit: isEdit,
    info_permintaan: infoPermintaan,
    detail,
    pum_user_create: bon.pum_user_create || "",
    pum_user_realisasi: bon.pum_user_realisasi || "",
  };
};

const getAccountOptions = async (jenis, cabang) => {
  let where =
    jenis === "KAS"
      ? `LEFT(rek_kode,5)='A-111'`
      : `(LEFT(rek_kode,5)='A-112' OR LEFT(rek_kode,5)='B-211')`;
  if (cabang && cabang !== "P01") where += ` AND rek_cabang = '${cabang}'`;

  const [rows] = await db.query(
    `SELECT rek_kode AS kode, rek_nama AS nama, rek_cabang AS cabang
     FROM financenew.trekening WHERE ${where} ORDER BY rek_kode`,
  );
  return rows;
};

// ── Semua account (dipakai modal pilih Account per baris detail) ──
const getAllAccounts = async () => {
  const [rows] = await db.query(
    `SELECT rek_kode AS kode, rek_nama AS nama, rek_cabang AS cabang
     FROM financenew.trekening ORDER BY rek_kode`,
  );
  return rows;
};

const getAccountByKode = async (kode) => {
  const [[row]] = await db.query(
    `SELECT rek_kode AS kode, rek_nama AS nama, rek_cabang AS cabang
     FROM financenew.trekening WHERE rek_kode = ? AND rek_isaktif = 0`,
    [kode],
  );
  return row || null;
};

const getCostCenterOptions = async () => {
  const [rows] = await db.query(
    `SELECT cc_kode AS kode, cc_nama AS nama FROM financenew.tcostcenter ORDER BY cc_nama`,
  );
  return rows;
};

const getDcOptions = async (cckode) => {
  const [rows] = await db.query(
    `SELECT dc_kode AS kode, dc_nama AS nama FROM financenew.tcostcenteritem WHERE dc_kode=? ORDER BY dc_nama`,
    [cckode],
  );
  return rows;
};

const getSupplierOptions = async (search = "") => {
  const [rows] = await db.query(
    `SELECT sup_kode AS kode, sup_nama AS nama,
            supd_bank AS bank, supd_rekening AS rekening, supd_atasnama AS atasnama
     FROM tsupplier
     LEFT JOIN tsupplieritem ON supd_kode = sup_kode
     WHERE sup_aktif = 'Y' AND (sup_nama LIKE ? OR sup_kode LIKE ?)
     ORDER BY sup_nama LIMIT 50`,
    [`%${search}%`, `%${search}%`],
  );
  return rows;
};

const getMaxNomorBkk = async (cabang, nomerator, conn) => {
  const prefix = `${cabang}-${nomerator}.${new Date().getFullYear()}.`;
  const [[row]] = await (conn || db).query(
    `SELECT IFNULL(MAX(CAST(RIGHT(jur_no,5) AS UNSIGNED)),0) AS max_val
     FROM financenew.tjurnal WHERE jur_no LIKE ?`,
    [`${prefix}%`],
  );
  return `${prefix}${String(Number(row.max_val) + 1).padStart(5, "0")}`;
};

const getVoucherNomor = async (kode, tanggal, conn) => {
  const yy = new Date(tanggal).getFullYear().toString().slice(-2);
  const prefix = `BYR/${kode}/${yy}`;
  const [[row]] = await (conn || db).query(
    `SELECT IFNULL(MAX(RIGHT(nomor,5)),'00000') AS mx
     FROM bayar_debet
     WHERE LEFT(nomor,?) = ?`,
    [prefix.length, prefix],
  );
  const next = Number(row.mx) + 1;
  return `${prefix}${String(next).padStart(5, "0")}`;
};

const saveData = async (payload, user) => {
  const {
    nomor,
    tgl_bkk,
    rek_kode,
    nota,
    penerima,
    keterangan,
    cabang,
    jenis,
    nomerator,
    detail,
    pjh_nomor,
    is_edit,
    no_bkk_lama,
    byrvoucher,
  } = payload;

  const conn = await db.getConnection();
  await conn.beginTransaction();

  try {
    const totalTerpakai = detail.reduce(
      (s, d) => s + (d.verified && d.total > 0 ? d.total : 0),
      0,
    );

    let noBkk = no_bkk_lama || "";

    if (totalTerpakai !== 0) {
      if (is_edit && noBkk) {
        await conn.query(
          `
          UPDATE financenew.tjurnal SET
            jur_tanggal    = ?, jur_rek_kode   = ?, jur_nota       = ?,
            jur_penerima   = ?, jur_keterangan = ?, jur_otomatis   = 0,
            date_modified  = NOW(), user_modified  = ?
          WHERE jur_no = ?
        `,
          [
            tgl_bkk,
            rek_kode,
            nota || "",
            penerima,
            keterangan || "",
            user.kode,
            noBkk,
          ],
        );
      } else {
        noBkk = await getMaxNomorBkk(cabang, nomerator, conn);
        await conn.query(
          `
          INSERT INTO financenew.tjurnal
            (jur_no, jur_tanggal, jur_tipetransaksi, jur_keterangan,
             jur_nota, jur_penerima, jur_cabang, jur_rek_kode,
             jur_otomatis, date_create, user_create)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, NOW(), ?)
        `,
          [
            noBkk,
            tgl_bkk,
            nomerator,
            keterangan || "",
            nota || "",
            penerima,
            cabang,
            rek_kode,
            user.kode,
          ],
        );
      }

      await conn.query(
        `UPDATE financenew.tkasbon SET bon_selesai=1, bon_jur_no=?, bon_rek_kode=? WHERE bon_nomor=?`,
        [noBkk, rek_kode, nomor],
      );
    } else {
      await conn.query(
        `UPDATE financenew.tkasbon SET bon_selesai=1, bon_rek_kode=? WHERE bon_nomor=?`,
        [rek_kode, nomor],
      );
    }

    await conn.query(
      `DELETE FROM financenew.tjurnal WHERE jur_otomatis=1 AND MID(jur_no,3,18)=?`,
      [nomor],
    );
    if (noBkk) {
      await conn.query(
        `DELETE FROM financenew.tjurnalitem WHERE jurd_jur_no=?`,
        [noBkk],
      );
    }
    await conn.query(
      `DELETE FROM financenew.tkasbonitem2 WHERE bond2_nomor=?`,
      [nomor],
    );
    await conn.query(`DELETE FROM tpoexternal_dtl2 WHERE poed2_link=?`, [
      nomor,
    ]);
    await conn.query(`DELETE FROM bayar_debet_detail WHERE vou_link=?`, [
      nomor,
    ]);

    if (totalTerpakai !== 0 && noBkk) {
      const firstVerified = detail.find((d) => d.verified && d.total > 0);
      await conn.query(
        `
        INSERT INTO financenew.tjurnalitem
          (jurd_jur_no, jurd_rek_kode, jurd_kredit, jurd_uraian,
           jurd_sup_kode, jurd_sup_nama, jurd_bank, jurd_rekening, jurd_atasnama)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
        [
          noBkk,
          rek_kode,
          totalTerpakai,
          keterangan || "",
          firstVerified?.kdsup || "",
          firstVerified?.supplier || "",
          firstVerified?.bank || "",
          firstVerified?.rekening || "",
          firstVerified?.atasnama || "",
        ],
      );
    }

    let nourut = 1;
    if (pjh_nomor) {
      const [[maxPjh]] = await conn.query(
        `
        SELECT IFNULL(MAX(x.nomer),0) AS max_val FROM (
          SELECT d.pmd_nourut AS nomer FROM ga2new.tpermintaan_dtl d
          LEFT JOIN ga2new.tpermintaan_hdr h ON h.pmt_nomor=d.pmd_pmt_nomor
          WHERE h.pmt_pjh_nomor=?
          UNION
          SELECT bond_nourut AS nomer FROM financenew.tkasbonitem WHERE bond_nomor=?
        ) x
      `,
        [pjh_nomor, nomor],
      );
      nourut = Number(maxPjh.max_val) + 1;
    }

    let autoCounter = 0;
    let vou = 0;
    let currentByrVoucher = byrvoucher || "";
    let cpmt = "";

    for (const d of detail) {
      const v = d.verified ? 1 : 0;

      if (!d.uraian) {
        nourut++;
        continue;
      }

      if (d.pmt && d.pmt !== cpmt) {
        await conn.query(
          `UPDATE ga2new.tpermintaan_hdr SET pmt_approval=1, pmt_buyed=1 WHERE pmt_nomor=?`,
          [d.pmt],
        );
        cpmt = d.pmt;
      }

      if (d.pjh) {
        await conn.query(
          `UPDATE financenew.tkasbon SET bon_pjh_nomor = ? WHERE bon_nomor = ? AND (bon_pjh_nomor = '' OR bon_pjh_nomor IS NULL)`,
          [d.pjh, nomor],
        );
      }

      if (d.ga === 1) {
        if (!v) {
          let sql = `UPDATE ga2new.tpermintaan_dtl SET
            pmd_qty_buyed=0, pmd_nilai_buyed=0, pmd_verified_buyed=0, pmd_bon=?`;
          if (d.gabrg === 0)
            sql += `, pmd_tanggal_closed=CURDATE(), pmd_user_closed='${user.kode}'`;
          sql += ` WHERE pmd_pmt_nomor=? AND pmd_nourut=?`;
          await conn.query(sql, [nomor, d.pmt, d.no]);
        } else {
          let sql = `UPDATE ga2new.tpermintaan_dtl SET
            pmd_qty_buyed=?, pmd_nilai_buyed=?, pmd_verified_buyed=?,
            pmd_rek_kode=?, pmd_cc_kode=?, pmd_dcnama=?, pmd_bon=?,
            pmd_tanggal_approved=CURDATE(), pmd_user_approved=?,
            pmd_dana_approved=?, pmd_tanggal_reject=NULL,
            pmd_kode_reject=0, pmd_user_reject='',
            pmd_tanggal_buyed=CURDATE(), pmd_user_buyed=?`;
          if (d.gabrg === 0)
            sql += `, pmd_tanggal_closed=CURDATE(), pmd_user_closed='${user.kode}'`;
          sql += ` WHERE pmd_pmt_nomor=? AND pmd_nourut=?`;
          await conn.query(sql, [
            d.qty,
            d.harga,
            v,
            d.rekkode || "",
            d.cckode || 0,
            d.dcnama || "",
            nomor,
            user.kode,
            d.harga,
            penerima,
            d.pmt,
            d.no,
          ]);
        }
      }

      if (d.ga === 2) {
        await conn.query(
          `
          UPDATE financenew.tkasbonitem SET
            bond_qty_realisasi=?, bond_nominal_realisasi=?,
            bond_rek_kode=?, bond_cc_kode=?, bond_dcnama=?,
            bond_verified=?,
            bond_sup_kode=?, bond_sup_nama=?,
            bond_bank=?, bond_rekening=?, bond_atasnama=?
          WHERE bond_nomor=? AND bond_nourut=?
        `,
          [
            d.qty,
            d.harga,
            d.rekkode || "",
            d.cckode || 0,
            d.dcnama || "",
            v,
            d.kdsup || "",
            d.supplier || "",
            d.bank || "",
            d.rekening || "",
            d.atasnama || "",
            nomor,
            d.no,
          ],
        );
      }

      if (d.ga === 0) {
        const hasPjhLink =
          ["POE", "VOU"].includes((d.pjh || "").substring(0, 3)) ||
          ["MBA", "MBO", "MBS", "MBK"].includes(
            (d.pjh || "").substring(0, 3),
          ) ||
          (d.pjh || "").substring(0, 2) === "IV";

        await conn.query(
          `
            INSERT INTO financenew.tkasbonitem2
              (bond2_nomor, bond2_nourut,
              ${hasPjhLink ? "bond2_link, bond2_brg_kode," : ""}
              bond2_nama, bond2_spesifikasi, bond2_satuan,
              bond2_qty_realisasi, bond2_nominal_realisasi,
              bond2_rek_kode, bond2_cc_kode, bond2_dcnama,
              bond2_sup_kode, bond2_sup_nama,
              bond2_bank, bond2_rekening, bond2_atasnama,
              bond2_verified)
            VALUES (?, ?${hasPjhLink ? ", ?, ?" : ""}, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
          [
            nomor,
            nourut,
            ...(hasPjhLink ? [d.pjh || "", d.kdbrg || ""] : []),
            d.uraian,
            d.spesifikasi || "",
            d.satuan || "",
            d.qty,
            d.harga,
            d.rekkode || "",
            d.cckode || 0,
            d.dcnama || "",
            d.kdsup || "",
            d.supplier || "",
            d.bank || "",
            d.rekening || "",
            d.atasnama || "",
            v,
          ],
        );
        nourut++;

        const cpjh3 = (d.pjh || "").substring(0, 3);

        if (v && cpjh3 === "VOU") {
          if (vou === 0) {
            if (!currentByrVoucher) {
              const kodeBayar = jenis === "KAS" ? "CS" : "BT";
              currentByrVoucher = await getVoucherNomor(
                kodeBayar,
                tgl_bkk,
                conn,
              );
              await conn.query(
                `UPDATE financenew.tkasbon SET bon_byrvoucher=? WHERE bon_nomor=?`,
                [currentByrVoucher, nomor],
              );
            }
            await conn.query(
              `INSERT INTO bayar_debet
                (nomor, kode, account, tanggal, tanggal_tempo, total, kodeuser)
               VALUES (?, ?, ?, ?, ?, ?, ?)
               ON DUPLICATE KEY UPDATE total=?`,
              [
                currentByrVoucher,
                jenis === "KAS" ? "CS" : "BT",
                rek_kode,
                tgl_bkk,
                tgl_bkk,
                totalTerpakai,
                user.kode,
                totalTerpakai,
              ],
            );
            vou++;
          }
          await conn.query(
            `INSERT INTO bayar_debet_detail (nomor, vou_nomor, vou_link, nilai)
             VALUES (?, ?, ?, ?)`,
            [currentByrVoucher, d.pjh, nomor, d.total],
          );
        }

        if (v && cpjh3 === "POE") {
          await conn.query(
            `INSERT INTO tpoexternal_dtl2
              (poed2_nomor, poed2_tanggal, poed2_nominal, poed2_akun, poed2_link)
             VALUES (?, ?, ?, ?, ?)`,
            [d.pjh, tgl_bkk, d.total, rek_kode, nomor],
          );
        }
      }

      if (v && totalTerpakai !== 0 && noBkk) {
        const cUraian =
          `${d.uraian} ${d.spesifikasi || ""} ${d.qty} ${d.satuan || ""}${d.guna ? ` (${d.guna})` : ""}`.trim();
        const noUrut = d.ga !== 0 ? d.no : nourut - 1;

        await conn.query(
          `
          INSERT INTO financenew.tjurnalitem
            (jurd_jur_no, jurd_trs, jurd_nourut, jurd_uraian,
             jurd_debet, jurd_rek_kode, jurd_cc_kode, jurd_dcnama,
             jurd_sup_kode, jurd_sup_nama, jurd_bank, jurd_rekening, jurd_atasnama)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
          [
            noBkk,
            nomerator,
            noUrut,
            cUraian,
            d.total,
            d.rekkode || "",
            d.cckode || 0,
            d.dcnama || "",
            d.kdsup || "",
            d.supplier || "",
            d.bank || "",
            d.rekening || "",
            d.atasnama || "",
          ],
        );

        if ((d.rekkode || "").startsWith("A-111")) {
          autoCounter++;
          const noBkm = `${String(autoCounter).padStart(2, "0")}${nomor}`;
          await conn.query(
            `
            INSERT INTO financenew.tjurnal
              (jur_no, jur_tanggal, jur_tipetransaksi, jur_cabang,
               jur_penerima, jur_keterangan, jur_rek_kode,
               jur_otomatis, date_create, user_create)
            VALUES (?, ?, 'BKM', ?, ?, ?, ?, 1, NOW(), ?)
          `,
            [
              noBkm,
              new Date(tgl_bkk).toISOString().slice(0, 10).replace("T", " "),
              cabang,
              penerima,
              `BKM OTOMATIS: ${d.uraian}`,
              d.rekkode,
              user.kode,
            ],
          );
          await conn.query(
            `INSERT INTO financenew.tjurnalitem (jurd_jur_no, jurd_rek_kode, jurd_debet, jurd_uraian)
            VALUES (?, ?, ?, ?)`,
            [noBkm, d.rekkode, d.harga, d.uraian],
          );
          await conn.query(
            `INSERT INTO financenew.tjurnalitem (jurd_jur_no, jurd_trs, jurd_nourut, jurd_uraian, jurd_kredit, jurd_rek_kode)
            VALUES (?, 'BKM', 1, ?, ?, ?)`,
            [noBkm, keterangan || "", d.harga, rek_kode],
          );
        }

        if (
          (d.rekkode || "").startsWith("A-112") ||
          (d.rekkode || "").startsWith("B-211")
        ) {
          autoCounter++;
          const noBbm = `${String(autoCounter).padStart(2, "0")}${nomor}`;
          await conn.query(
            `
            INSERT INTO financenew.tjurnal
              (jur_no, jur_tanggal, jur_tipetransaksi, jur_cabang,
               jur_penerima, jur_keterangan, jur_rek_kode,
               jur_otomatis, date_create, user_create)
            VALUES (?, ?, 'BBM', ?, ?, ?, ?, 1, NOW(), ?)
          `,
            [
              noBbm,
              tgl_bkk,
              cabang,
              penerima,
              `BBM OTOMATIS: ${d.uraian}`,
              d.rekkode,
              user.kode,
            ],
          );
          await conn.query(
            `INSERT INTO financenew.tjurnalitem (jurd_jur_no, jurd_rek_kode, jurd_debet, jurd_uraian)
            VALUES (?, ?, ?, ?)`,
            [noBbm, d.rekkode, d.harga, d.uraian],
          );
          await conn.query(
            `INSERT INTO financenew.tjurnalitem (jurd_jur_no, jurd_trs, jurd_nourut, jurd_uraian, jurd_kredit, jurd_rek_kode)
            VALUES (?, 'BBM', 1, ?, ?, ?)`,
            [noBbm, keterangan || "", d.harga, rek_kode],
          );
        }
      }
    }

    const affectedPmt = new Set(
      detail.filter((d) => d.pmt && d.uraian).map((d) => d.pmt),
    );
    for (const pmt of affectedPmt) {
      const [[sisa]] = await conn.query(
        `SELECT COUNT(*) AS cnt FROM ga2new.tpermintaan_dtl
     WHERE pmd_pmt_nomor = ? AND pmd_bon = '' AND pmd_tanggal_reject IS NULL`,
        [pmt],
      );
      if (Number(sisa.cnt) === 0) {
        await conn.query(
          `UPDATE ga2new.tpermintaan_hdr SET pmt_close = 1 WHERE pmt_nomor = ?`,
          [pmt],
        );
      }
    }

    await conn.commit();
    return { nomor, no_bkk: noBkk };
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
};

const getListPengajuanGA = async (cabang) => {
  let sql = `
    SELECT j.pjh_nomor AS nomor, DATE_FORMAT(j.pjh_tanggal,"%d-%m-%Y") AS tanggal,
      j.pjh_ke, j.pjh_user_kode AS nama, j.pjh_keterangan AS keterangan
    FROM ga2new.tpengajuan2_hdr j
    LEFT JOIN ga2new.tpermintaan_hdr h ON h.pmt_pjh_nomor = j.pjh_nomor
    WHERE (
        j.pjh_nonga = 0
        OR UPPER(j.pjh_jenis_permintaan) = 'PERMINTAAN BARANG'
      )
      AND (
        h.pmt_nomor IS NULL
        OR (
          h.pmt_close = 0
          AND EXISTS (
            SELECT 1 FROM ga2new.tpermintaan_dtl d
            WHERE d.pmd_pmt_nomor = h.pmt_nomor AND d.pmd_bon = ''
          )
        )
      )
  `;
  const params = [];
  if (cabang && cabang !== "P01") {
    sql += ` AND j.pjh_ke = ?`;
    params.push(cabang);
  }
  sql += ` ORDER BY j.pjh_tanggal DESC, j.pjh_nomor DESC`;
  const [rows] = await db.query(sql, params);
  return rows;
};

const getDetailPengajuanGA = async (pjhNomor) => {
  await ensurePermintaanDana(pjhNomor);

  const [rows] = await db.query(
    `SELECT h.pmt_nomor, d.pmd_nourut, d.pmd_nama, d.pmd_spesifikasi,
      d.pmd_qty_riil, d.pmd_satuan, d.pmd_qty_buyed, d.pmd_nilai,
      d.pmd_nilai_buyed, d.pmd_dana_approved, d.pmd_tanggal_reject, d.pmd_bon,
      d.pmd_kegunaan, (d.pmd_qty_riil * d.pmd_nilai) AS total, d.pmd_verified_buyed,
      h.pmt_buyed, d.pmd_nilai_terpakai, d.pmd_tanggal_approved, d.pmd_tanggal_buyed,
      d.pmd_status_finance,
      j.pjh_jenis_permintaan, j.pjh_nonga,
      d.pmd_cc_kode, d.pmd_dcnama, cc.cc_nama
    FROM ga2new.tpermintaan_dtl d
    INNER JOIN ga2new.tpermintaan_hdr h ON h.pmt_nomor = d.pmd_pmt_nomor
    LEFT JOIN ga2new.tpengajuan2_hdr j ON j.pjh_nomor = h.pmt_pjh_nomor
    LEFT JOIN financenew.tcostcenter cc ON cc.cc_kode = d.pmd_cc_kode
    WHERE h.pmt_pjh_nomor = ?
      AND d.pmd_bon = ''
    ORDER BY d.pmd_nourut`,
    [pjhNomor],
  );
  return rows.map((r) => {
    const isGabrg =
      (r.pjh_jenis_permintaan || "").toUpperCase() === "PERMINTAAN BARANG" &&
      Number(r.pjh_nonga) === 0;
    return {
      pmt: r.pmt_nomor,
      no: r.pmd_nourut,
      pjh: pjhNomor,
      uraian: r.pmd_nama,
      spesifikasi: r.pmd_spesifikasi || "",
      satuan: r.pmd_satuan || "",
      qty: Number(r.pmd_qty_riil),
      harga: Number(r.pmd_nilai),
      total: Number(r.total),
      guna: r.pmd_kegunaan || "",
      verified: true,
      ga: 1,
      cckode: r.pmd_cc_kode || 0,
      ccnama: r.cc_nama || "",
      dcnama: r.pmd_dcnama || "",
      statusFinance: r.pmd_status_finance || "",
      rekkode: "",
      reknama: "",
      edit: 0,
      gabrg: isGabrg ? 1 : 0,
      kdbrg: "",
      mb: "",
      jenis_item: "",
      cab_item: "",
      kdsup: "",
      supplier: "",
      bank: "",
      rekening: "",
      atasnama: "",
      dckode: 0,
      pjh_link: "",
    };
  });
};

const updateStatusFinance = async (pmtNomor, nourut, status) => {
  const validStatus = [
    "PENDING",
    "MENUNGGU_PEMBELIAN",
    "BULAN_DEPAN",
    "OTORISASI",
    null,
  ];
  if (!validStatus.includes(status)) throw new Error("Status tidak valid.");

  const [result] = await db.query(
    `UPDATE ga2new.tpermintaan_dtl SET pmd_status_finance = ?
     WHERE pmd_pmt_nomor = ? AND pmd_nourut = ?`,
    [status, pmtNomor, nourut],
  );
  if (result.affectedRows === 0)
    throw new Error("Item permintaan tidak ditemukan.");
};

const getListPoExternal = async () => {
  const [rows] = await db.query(`
    SELECT x.Nomor AS nomor, DATE_FORMAT(x.Tanggal, "%d-%m-%Y") AS tanggal, x.SPK AS spk,
           x.Nominal AS nominal, x.Supplier AS supplier
    FROM (
      SELECT h.poe_nomor AS Nomor, h.poe_tanggal AS Tanggal, h.poe_spk_nomor AS SPK,
        h.poe_sup AS Kdsup, u.Sup_nama AS Supplier, h.poe_total AS Nominal,
        (SELECT IFNULL(SUM(c.poed2_nominal),0) FROM tpoexternal_dtl2 c WHERE c.poed2_nomor=h.poe_nomor) AS DP,
        (SELECT IFNULL(SUM(v.voud_total),0) FROM tvoucher_dtl v WHERE v.voud_nota=h.poe_nomor) AS Voucher
      FROM tpoexternal_hdr h
      LEFT JOIN tsupplier u ON u.Sup_kode = h.poe_sup
    ) x
    WHERE (x.Nominal - (x.DP + x.Voucher)) > 0
    ORDER BY x.Tanggal DESC, x.Nomor DESC
  `);
  return rows.map((r) => ({ ...r, nominal: Number(r.nominal) }));
};

const getListVoucher = async () => {
  const [rows] = await db.query(`
    SELECT h.vou_nomor AS nomor, DATE_FORMAT(h.vou_tanggal, "%d-%m-%Y") AS tanggal,
           s.sup_nama AS supplier, h.vou_total AS total
    FROM tvoucher_hdr h
    INNER JOIN tsupplier s ON s.sup_kode = h.vou_sup_kode
    WHERE h.vou_nomor NOT IN (SELECT b.vou_nomor FROM bayar_debet_detail b)
    ORDER BY h.vou_tanggal DESC, h.vou_nomor DESC
  `);
  return rows.map((r) => ({ ...r, total: Number(r.total) }));
};

const getListPermintaanGarmen = async (cabang) => {
  let sql = `
    SELECT h.mb_nomor AS nomor, DATE_FORMAT(h.mb_tanggal, "%d-%m-%Y") AS tanggal, h.mb_jenis AS jenis,
      h.mb_ket AS keterangan, h.mb_priority AS priority, h.mb_cab AS cab,
      h.user_create AS usr, h.mb_bagian AS bagian
    FROM tgarmenmintabeli_hdr h
    WHERE h.mb_status <> 'CLOSE' AND h.mb_status <> 'DICLOSE'
      AND EXISTS (
        SELECT 1
        FROM tgarmenmintabeli_dtl d
        WHERE d.mbd_nomor = h.mb_nomor
          AND d.mbd_jumlah > (
            IFNULL((
              SELECT SUM(dd.bpbd_jumlah)
              FROM tgarmenbpb_hdr hh
              INNER JOIN tgarmenbpb_dtl dd ON dd.bpbd_nomor = hh.bpb_nomor
              WHERE hh.bpb_mb_nomor = d.mbd_nomor AND dd.bpbd_brg_kode = d.mbd_brg_kode
            ), 0)
            +
            IFNULL((
              SELECT SUM(msod_jumlah)
              FROM tgarmenmso_dtl
              WHERE msod_msi_nomor <> ''
                AND msod_mb_nomor = d.mbd_nomor
                AND msod_brg_kode = d.mbd_brg_kode
            ), 0)
          )
          AND NOT EXISTS (
            SELECT 1 FROM tgarmenmintabeli_dtl2 c
            WHERE c.mbd2_nomor = d.mbd_nomor AND c.mbd2_brg_kode = d.mbd_brg_kode
          )
      )
  `;
  const params = [];
  if (cabang === "P01") {
    sql += ` AND (h.mb_mintake = 'P01' OR h.mb_mintake = 'HO' OR h.mb_mintake = 'HO-')`;
  } else if (cabang) {
    sql += ` AND h.mb_mintake = ?`;
    params.push(cabang);
  }
  sql += ` ORDER BY h.mb_tanggal DESC, h.mb_nomor DESC`;

  const [rows] = await db.query(sql, params);
  return rows;
};

const getDetailPermintaanGarmen = async (mbNomor) => {
  const [rows] = await db.query(
    `SELECT h.*, d.*, b.brg_satuan,
      IF(IFNULL(b.brg_note,'') = '',
        CONCAT(IFNULL(b.brg_nama,''), ' ', IFNULL(d.mbd_ket,'')),
        CONCAT(IFNULL(b.brg_nama,''), ' - ', b.brg_note, ' ', IFNULL(d.mbd_ket,''))
      ) AS nama,
      (
        IFNULL((
          SELECT SUM(dd.bpbd_jumlah)
          FROM tgarmenbpb_hdr hh
          INNER JOIN tgarmenbpb_dtl dd ON dd.bpbd_nomor = hh.bpb_nomor
          WHERE hh.bpb_mb_nomor = d.mbd_nomor AND dd.bpbd_brg_kode = d.mbd_brg_kode
        ), 0)
        +
        IFNULL((
          SELECT SUM(msod_jumlah)
          FROM tgarmenmso_dtl
          WHERE msod_msi_nomor <> ''
            AND msod_mb_nomor = d.mbd_nomor
            AND msod_brg_kode = d.mbd_brg_kode
        ), 0)
      ) AS sudahTerima,
      IF(EXISTS (
        SELECT 1 FROM tgarmenmintabeli_dtl2 c
        WHERE c.mbd2_nomor = d.mbd_nomor AND c.mbd2_brg_kode = d.mbd_brg_kode
      ), 1, 0) AS sudahProsesBeli
    FROM tgarmenmintabeli_dtl d
    LEFT JOIN tgarmenmintabeli_hdr h ON h.mb_nomor = d.mbd_nomor
    LEFT JOIN tgarmen_brg b ON b.brg_kode = d.mbd_brg_kode
    WHERE d.mbd_nomor = ?
    ORDER BY d.mbd_nourut`,
    [mbNomor],
  );

  return rows
    .filter(
      (r) =>
        Number(r.mbd_jumlah) > Number(r.sudahTerima || 0) &&
        Number(r.sudahProsesBeli) === 0,
    )
    .map((r) => ({
      pmt: "",
      no: r.mbd_nourut,
      pjh: r.mbd_nomor,
      mb: r.mbd_nomor,
      uraian: r.nama,
      spesifikasi: r.mbd_ket || "",
      satuan: r.brg_satuan || "",
      qty: Number(r.mbd_jumlah) - Number(r.sudahTerima || 0),
      harga: 0,
      total: 0,
      guna: r.mbd_kegunaan || "",
      verified: true,
      ga: 0,
      gabrg: 1,
      kdbrg: r.mbd_brg_kode,
      jenis_item: r.mb_jenis,
      cab_item: r.mb_cab,
      rekkode: "",
      reknama: "",
      cckode: 0,
      ccnama: "",
      dcnama: "",
      kdsup: "",
      supplier: "",
      bank: "",
      rekening: "",
      atasnama: "",
      edit: 0,
      pjh_link: r.mbd_nomor,
      dckode: 0,
    }));
};

const getListInvoiceGarmen = async () => {
  const [rows] = await db.query(`
    SELECT h.iv_jenis AS jenis, h.iv_nomor AS invoice, DATE_FORMAT(h.iv_tanggal, "%d-%m-%Y") AS tanggal,
      (SELECT IFNULL(bpb_po_nomor,"") FROM tgarmenbpb_hdr b WHERE b.bpb_nomor=h.iv_bpb_nomor LIMIT 1) AS nopo,
      h.iv_bpb_nomor AS nobpb
    FROM tgarmeniv_hdr h
    WHERE h.iv_bbk = ""
    ORDER BY h.iv_tanggal DESC, h.iv_nomor DESC
  `);
  return rows;
};

const getDetailInvoiceGarmen = async (ivNomor) => {
  const [rows] = await db.query(
    `SELECT h.*, d.*, b.brg_satuan, m.bpb_cab AS cab, s.sup_nama,
      IF(IFNULL(b.brg_note,'') = '',
         b.brg_nama,
         CONCAT(IFNULL(b.brg_nama,''), ' - ', b.brg_note)
      ) AS nama
    FROM tgarmeniv_dtl d
    LEFT JOIN tgarmeniv_hdr h ON h.iv_nomor = d.ivd_nomor
    LEFT JOIN tgarmenbpb_hdr m ON m.bpb_nomor = h.iv_bpb_nomor
    LEFT JOIN tgarmen_brg b ON b.brg_kode = d.ivd_brg_kode
    LEFT JOIN tsupplier s ON s.sup_kode = h.iv_sup_kode
    WHERE d.ivd_nomor = ?
    ORDER BY d.ivd_nourut`,
    [ivNomor],
  );

  return rows.map((r) => {
    const qty = Number(r.ivd_jumlah);
    const harga = Number(r.ivd_harga);
    return {
      mb: "",
      no: r.ivd_nourut,
      pjh: r.ivd_nomor,
      uraian: r.nama,
      kdbrg: r.ivd_brg_kode,
      spesifikasi: r.ivd_ket || "",
      satuan: r.brg_satuan || "",
      qty,
      harga,
      total: qty * harga,
      guna: r.ivd_kegunaan || "",
      verified: true,
      ga: 0,
      gabrg: 1,
      jenis_item: r.iv_jenis,
      cab_item: r.cab,
      kdsup: r.iv_sup_kode,
      supplier: r.sup_nama,
      rekkode: "",
      reknama: "",
      cckode: 0,
      ccnama: "",
      dcnama: "",
      bank: "",
      rekening: "",
      atasnama: "",
      edit: 0,
      pjh_link: r.ivd_nomor,
      dckode: 0,
      pmt: "",
    };
  });
};

const generateSupplierKode = async (conn) => {
  const [[row]] = await (conn || db).query(
    'SELECT IFNULL(MAX(RIGHT(sup_kode, 7)), 0) AS max_val FROM tsupplier WHERE LEFT(sup_kode, 1) = "S"',
  );
  const nextNum = parseInt(row.max_val, 10) + 1;
  return "S" + String(nextNum).padStart(7, "0");
};

const createSupplier = async (data, user) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const kode = await generateSupplierKode(conn);

    await conn.query(
      `INSERT INTO tsupplier (
        sup_kode, sup_nama, sup_alamat, sup_kota, sup_telp, sup_hp, sup_fax, sup_cp,
        sup_npwp, sup_nama_npwp, sup_alamat_npwp, sup_kota_npwp, sup_top, sup_targetmitra,
        sup_ket, sup_bahan, sup_cmt, sup_accesories, sup_obat, sup_sparepart, sup_atk, sup_jasa,
        sup_aktif, user_create, date_create
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        kode,
        data.Nama,
        data.Alamat || "",
        data.Kota || "",
        data.Telp || "",
        data.Hp || "",
        data.Fax || "",
        data.Contact || "",
        data.NpwpKode || "",
        data.NpwpNama || "",
        data.NpwpAlamat || "",
        data.NpwpKota || "",
        data.Top || 0,
        data.TargetMitra || 0,
        data.Keterangan || "",
        data.Jenis?.Bahan ? "Y" : "N",
        data.Jenis?.Cmt ? "Y" : "N",
        data.Jenis?.Acc ? "Y" : "N",
        data.Jenis?.Obat ? "Y" : "N",
        data.Jenis?.Sparepart ? "Y" : "N",
        data.Jenis?.Atk ? "Y" : "N",
        data.Jenis?.Jasa ? "Y" : "N",
        data.Aktif || "Y",
        user,
      ],
    );

    if (data.RekeningList && data.RekeningList.length > 0) {
      const detailVals = data.RekeningList.filter(
        (r) => r.Rekening && r.Rekening.trim() !== "",
      ).map((r) => [kode, r.Bank || "", r.Rekening, r.AtasNama || ""]);
      if (detailVals.length > 0) {
        await conn.query(
          "INSERT INTO tsupplieritem (supd_kode, supd_bank, supd_rekening, supd_atasnama) VALUES ?",
          [detailVals],
        );
      }
    }

    await conn.commit();
    return kode;
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
};

module.exports = {
  getFormData,
  getAccountOptions,
  getAllAccounts,
  saveData,
  getAccountByKode,
  getCostCenterOptions,
  getDcOptions,
  getSupplierOptions,
  getListPengajuanGA,
  getDetailPengajuanGA,
  getListPoExternal,
  getListVoucher,
  getListPermintaanGarmen,
  getDetailPermintaanGarmen,
  getListInvoiceGarmen,
  getDetailInvoiceGarmen,
  createSupplier,
  updateStatusFinance,
};
