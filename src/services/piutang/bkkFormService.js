const db = require("../../config/database");
const tutupBukuService = require("../tutupBukuService");

// ── Lookup account header (KAS sesuai cabang) ─────────────────────────
const getAccountOptions = async (cabang) => {
  let where = `LEFT(rek_kode,5)='A-111'`;
  const params = [];

  if (cabang === "P02" || cabang === "P04") {
    where += ` AND rek_cabang = ?`;
    params.push(cabang);
  } else {
    where += ` AND rek_cabang = 'P01'`;
  }

  const [rows] = await db.query(
    `SELECT rek_kode AS kode, rek_nama AS nama, rek_cabang AS cabang
     FROM finance.trekening WHERE ${where} ORDER BY rek_kode`,
    params,
  );
  return rows;
};

// ── Lookup account detail (semua) ─────────────────────────────────────
const getAccountAll = async () => {
  const [rows] = await db.query(
    `SELECT rek_kode AS kode, rek_nama AS nama, rek_cabang AS cabang
     FROM finance.trekening WHERE rek_isaktif = 0 ORDER BY rek_kode`,
  );
  return rows;
};

// ── Lookup keterangan (tjenisbayar) ───────────────────────────────────
const getKeteranganOptions = async () => {
  const [rows] = await db.query(
    `SELECT jenisbayar AS nama FROM finance.tjenisbayar ORDER BY jenisbayar`,
  );
  return rows;
};

// ── Lookup cost center ────────────────────────────────────────────────
const getCostCenterOptions = async () => {
  const [rows] = await db.query(
    `SELECT cc_kode AS kode, cc_nama AS nama FROM finance.tcostcenter ORDER BY cc_nama`,
  );
  return rows;
};

// ── Lookup detail CC ──────────────────────────────────────────────────
const getDcOptions = async (cckode) => {
  const [rows] = await db.query(
    `SELECT dc_kode AS kode, dc_nama AS nama
     FROM finance.tcostcenteritem WHERE dc_kode = ? ORDER BY dc_nama`,
    [cckode],
  );
  return rows;
};

// ── Supplier search (F-lookup) — kencanaprint adalah DB lokal MANKSI
// sendiri, jadi prefix eksplisit yang ada di referensi Finance dibuang ──
const getSupplierOptions = async (search = "") => {
  const [rows] = await db.query(
    `
    SELECT sup_kode AS kode, sup_nama AS nama
    FROM tsupplier
    WHERE sup_aktif = 'Y'
      AND (sup_nama LIKE ? OR sup_kode LIKE ?)
    ORDER BY sup_nama
  `,
    [`%${search}%`, `%${search}%`],
  );
  return rows;
};

// ── Supplier detail (bank/rekening per supplier) ────────────────────────
const getSupplierDetail = async (kode) => {
  const [rows] = await db.query(
    `
    SELECT a.sup_kode AS kode, a.sup_nama AS nama,
      b.supd_bank AS bank, b.supd_rekening AS rekening,
      b.supd_atasnama AS atasnama
    FROM tsupplier a
    LEFT JOIN tsupplieritem b ON b.supd_kode = a.sup_kode
    WHERE a.sup_aktif = 'Y' AND a.sup_kode = ?
    ORDER BY b.supd_bank
  `,
    [kode],
  );
  return rows;
};

// ── Petty Cash (nomor klaim) — dipanggil dari form BKK. Modal
// pencariannya BELUM dibuat di frontend; endpoint ini disiapkan lebih
// dulu supaya siap dipakai begitu modalnya jadi. Nomor petty cash yang
// sudah dipakai di BKK manapun (pck_bkk_nomor terisi) di-exclude.
// ─────────────────────────────────────────────────────────────────────
const getPettyCashOptions = async (search = "") => {
  const [rows] = await db.query(
    `
    SELECT h.pck_nomor AS nomor,
      DATE_FORMAT(h.pck_tanggal,'%Y-%m-%d') AS tanggal,
      h.pck_cab AS store,
      g.gdg_nama AS namaStore,
      h.pck_total AS nominal
    FROM retail.tpettycash_klaim_hdr h
    LEFT JOIN retail.tgudang g ON g.gdg_kode = h.pck_cab
    WHERE h.pck_status = 'APPROVED'
      AND (h.pck_bkk_nomor IS NULL OR h.pck_bkk_nomor = '')
      AND (h.pck_nomor LIKE ? OR h.pck_cab LIKE ?)
    ORDER BY h.pck_nomor
  `,
    [`%${search}%`, `%${search}%`],
  );
  return rows;
};

// ── Generate nomor otomatis BKK ───────────────────────────────────────
const getMaxNomor = async (cabang, conn) => {
  const prefix = `${cabang}-BKK.${new Date().getFullYear()}.`;
  const [[row]] = await (conn || db).query(
    `SELECT IFNULL(MAX(CAST(RIGHT(jur_no,5) AS UNSIGNED)),0) AS max_val
     FROM finance.tjurnal WHERE jur_no LIKE ?`,
    [`${prefix}%`],
  );
  return `${prefix}${String(Number(row.max_val) + 1).padStart(5, "0")}`;
};

// ── Nomor otomatis BKM/BBM ────────────────────────────────────────────
const getNomorOtomatis = async (bkkNomor, localNn, conn) => {
  const [[row]] = await (conn || db).query(
    `SELECT IFNULL(MAX(CAST(LEFT(jur_no,2) AS UNSIGNED)),0) AS max_val
     FROM finance.tjurnal WHERE jur_otomatis=1 AND MID(jur_no,3,18)=?`,
    [bkkNomor],
  );
  return String(100 + localNn + Number(row.max_val)).slice(-2) + bkkNomor;
};

// ── Load form edit ────────────────────────────────────────────────────
const getDetailForm = async (nomor) => {
  const [rows] = await db.query(
    `
    SELECT h.jur_no, DATE_FORMAT(h.jur_tanggal,'%Y-%m-%d') AS jur_tanggal,
      h.jur_rek_kode, h.jur_penerima, h.jur_nota, h.jur_cabang,
      h.jur_keterangan,
      (SELECT e.rek_nama FROM finance.trekening e WHERE e.rek_kode=h.jur_rek_kode) AS reknama,
      d.jurd_nourut, d.jurd_trs, d.jurd_rek_kode AS det_rek_kode,
      d.jurd_uraian, d.jurd_debet,
      r.rek_nama AS det_reknama,
      d.jurd_cc_kode, c.cc_nama, d.jurd_dcnama,
      d.jurd_satuan, d.jurd_qty, d.jurd_harga, d.jurd_mb, d.jurd_pck, d.jurd_brg_kode,
      m.mb_jenis, m.mb_cab,
      p.pck_cab AS pck_store, gp.gdg_nama AS pck_namaStore,
      d.jurd_sup_kode, d.jurd_sup_nama, d.jurd_bank, d.jurd_rekening, d.jurd_atasnama
    FROM finance.tjurnal h
    LEFT JOIN finance.tjurnalitem d ON d.jurd_jur_no = h.jur_no
    LEFT JOIN finance.trekening r ON r.rek_kode = d.jurd_rek_kode
    LEFT JOIN finance.tcostcenter c ON c.cc_kode = d.jurd_cc_kode
    LEFT JOIN tgarmenmintabeli_hdr m ON m.mb_nomor = d.jurd_mb
    LEFT JOIN retail.tpettycash_klaim_hdr p ON p.pck_nomor = d.jurd_pck
    LEFT JOIN retail.tgudang gp ON gp.gdg_kode = p.pck_cab
    WHERE d.jurd_trs = 'BKK' AND h.jur_no = ?
    ORDER BY d.jurd_nourut
  `,
    [nomor],
  );

  if (rows.length === 0) throw new Error("Nomor BKK tersebut belum ada.");

  const h = rows[0];
  const detail = rows
    .filter((r) => r.jurd_uraian)
    .map((r) => ({
      no: r.jurd_nourut,
      uraian: r.jurd_uraian,
      total: Number(r.jurd_debet),
      rekkode: r.det_rek_kode || "",
      reknama: r.det_reknama || "",
      cckode: r.jurd_cc_kode || 0,
      ccnama: r.cc_nama || "",
      dcnama: r.jurd_dcnama || "",
      dckode: r.jurd_cc_kode || 0,
      mb: r.jurd_mb || "",
      pck: r.jurd_pck || "",
      pckStore: r.pck_namaStore || "",
      kdbrg: r.jurd_brg_kode || "",
      satuan: r.jurd_satuan || "",
      qty: Number(r.jurd_qty),
      harga: Number(r.jurd_harga),
      supkode: r.jurd_sup_kode || "",
      supnama: r.jurd_sup_nama || "",
      bank: r.jurd_bank || "",
      rekening: r.jurd_rekening || "",
      atasnama: r.jurd_atasnama || "",
      jenis_item: r.mb_jenis || "",
      cab_item: r.mb_cab || "",
    }));

  return {
    nomor: h.jur_no,
    tanggal: h.jur_tanggal,
    rek_kode: h.jur_rek_kode,
    rek_nama: h.reknama || "",
    penerima: h.jur_penerima || "",
    nota: h.jur_nota || "",
    keterangan: h.jur_keterangan || "",
    cabang: h.jur_cabang,
    cabang_old: h.jur_cabang,
    detail,
  };
};

// ── Simpan ────────────────────────────────────────────────────────────
const saveData = async (payload, user) => {
  const {
    isEdit,
    nomor,
    tanggal,
    rek_kode,
    penerima,
    nota,
    keterangan,
    cabang,
    cabang_old,
    detail,
  } = payload;

  // Cek tutup buku — pola sama dengan bkkService.js (browse/delete):
  // getTanggalTutupBukuUntukTanggal dibanding hari ini, manual override
  // (pengaturan.tclose, cid="BKK") menang kalau ada.
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const limitDate =
    await tutupBukuService.getTanggalTutupBukuUntukTanggal(tanggal);
  limitDate.setHours(0, 0, 0, 0);

  const zCloseManual = await tutupBukuService.getManualTutupBuku("BKK");

  let isTutupBuku = false;
  const tglTrs = new Date(tanggal);
  if (zCloseManual) {
    zCloseManual.setHours(0, 0, 0, 0);
    if (tglTrs < zCloseManual) isTutupBuku = true;
  } else {
    if (limitDate < today) isTutupBuku = true;
  }

  if (isTutupBuku)
    throw new Error("Periode sudah ditutup. Tidak bisa disimpan.");

  const conn = await db.getConnection();
  await conn.beginTransaction();
  let localNn = 0; // reset counter otomatis per transaksi

  try {
    let actualNomor = nomor;
    let flagEdit = isEdit;

    // Delphi: jika edit dan cabang berubah → delete lalu insert baru
    if (isEdit && cabang !== cabang_old) {
      await conn.query(`DELETE FROM finance.tjurnal WHERE jur_no = ?`, [nomor]);
      flagEdit = false;
    }

    if (flagEdit) {
      // UPDATE header
      await conn.query(
        `
        UPDATE finance.tjurnal SET
          jur_rek_kode   = ?,
          jur_penerima   = ?,
          jur_nota       = ?,
          jur_keterangan = ?,
          jur_tanggal    = ?,
          date_modified  = NOW(),
          user_modified  = ?
        WHERE jur_no = ?
      `,
        [
          rek_kode,
          penerima || "",
          nota || "",
          keterangan || "",
          tanggal,
          user.kode,
          nomor,
        ],
      );
    } else {
      // INSERT header baru
      actualNomor = await getMaxNomor(cabang, conn);
      await conn.query(
        `
        INSERT INTO finance.tjurnal
          (jur_no, jur_tanggal, jur_tipetransaksi, jur_cabang,
           jur_nota, jur_penerima, jur_keterangan, jur_rek_kode,
           date_create, user_create)
        VALUES (?, ?, 'BKK', ?, ?, ?, ?, ?, NOW(), ?)
      `,
        [
          actualNomor,
          tanggal,
          cabang,
          nota || "",
          penerima || "",
          keterangan || "",
          rek_kode,
          user.kode,
        ],
      );
    }

    // Delphi: delete jurnal otomatis dulu
    await conn.query(
      `DELETE FROM finance.tjurnal WHERE jur_otomatis=1 AND MID(jur_no,3,18)=?`,
      [actualNomor],
    );

    // Delphi: delete semua tjurnalitem dulu
    await conn.query(`DELETE FROM finance.tjurnalitem WHERE jurd_jur_no=?`, [
      actualNomor,
    ]);

    // Hitung total
    const total = detail.reduce((s, d) => s + (Number(d.total) || 0), 0);

    // Insert kredit header di tjurnalitem
    await conn.query(
      `
      INSERT INTO finance.tjurnalitem (jurd_jur_no, jurd_rek_kode, jurd_kredit, jurd_uraian)
      VALUES (?, ?, ?, ?)
    `,
      [actualNomor, rek_kode, total, keterangan || ""],
    );

    // Insert debet per baris detail
    let i = 1;
    for (const d of detail) {
      if (!d.uraian) {
        i++;
        continue;
      }

      await conn.query(
        `
        INSERT INTO finance.tjurnalitem
          (jurd_jur_no, jurd_trs, jurd_nourut, jurd_uraian,
           jurd_satuan, jurd_qty, jurd_harga, jurd_mb, jurd_pck, jurd_brg_kode,
           jurd_debet, jurd_rek_kode, jurd_cc_kode, jurd_dcnama,
           jurd_sup_kode, jurd_sup_nama, jurd_bank, jurd_rekening, jurd_atasnama)
        VALUES (?, 'BKK', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
        [
          actualNomor,
          i,
          d.uraian,
          d.satuan,
          Number(d.qty),
          Number(d.harga),
          d.mb || "",
          d.pck || "",
          d.kdbrg,
          Number(d.total),
          d.rekkode || "",
          d.cckode || 0,
          d.dcnama || "",
          d.supkode || "",
          d.supnama || "",
          d.bank || "",
          d.rekening || "",
          d.atasnama || "",
        ],
      );

      // ── Link balik ke petty cash: BKK ini bayar klaim petty cash tsb ──
      if (d.pck) {
        const [updPck] = await conn.query(
          `
          UPDATE retail.tpettycash_klaim_hdr
          SET pck_bkk_nomor = ?,
              pck_status    = 'ON_TRANSFER',
              date_transfer = NOW(),
              user_modified = ?,
              date_modified = NOW()
          WHERE pck_nomor = ? AND pck_status = 'APPROVED'
        `,
          [actualNomor, user.kode, d.pck],
        );
        if (updPck.affectedRows === 0) {
          throw new Error(
            `Klaim Petty Cash ${d.pck} sudah tidak berstatus APPROVED. Tidak bisa dibuatkan BKK.`,
          );
        }
        await conn.query(
          `UPDATE retail.tpettycash_hdr SET pc_status = 'ON_TRANSFER', user_modified = ?, date_modified = NOW()
           WHERE pck_nomor = ?`,
          [user.kode, d.pck],
        );
      }

      // Delphi: BKM otomatis jika account A-111
      if ((d.rekkode || "").startsWith("A-111")) {
        localNn++;
        const noBkm = await getNomorOtomatis(actualNomor, localNn, conn);
        await conn.query(
          `
          INSERT INTO finance.tjurnal
            (jur_no, jur_tanggal, jur_tipetransaksi, jur_cabang,
             jur_penerima, jur_keterangan, jur_rek_kode,
             jur_otomatis, date_create, user_create)
          VALUES (?, ?, 'BKM', ?, ?, ?, ?, 1, NOW(), ?)
        `,
          [
            noBkm,
            tanggal,
            cabang,
            penerima || "",
            `BKM OTOMATIS: ${d.uraian}`,
            d.rekkode,
            user.kode,
          ],
        );
        await conn.query(
          `INSERT INTO finance.tjurnalitem (jurd_jur_no, jurd_rek_kode, jurd_debet, jurd_uraian)
           VALUES (?, ?, ?, ?)`,
          [noBkm, d.rekkode, d.total, d.uraian],
        );
        await conn.query(
          `INSERT INTO finance.tjurnalitem (jurd_jur_no, jurd_trs, jurd_nourut, jurd_uraian, jurd_kredit, jurd_rek_kode)
           VALUES (?, 'BKM', 1, ?, ?, ?)`,
          [noBkm, keterangan || "", d.total, rek_kode],
        );
      }

      // Delphi: BBM otomatis jika account A-112 atau B-211
      if (
        (d.rekkode || "").startsWith("A-112") ||
        (d.rekkode || "").startsWith("B-211")
      ) {
        localNn++;
        const noBbm = await getNomorOtomatis(actualNomor, localNn, conn);
        await conn.query(
          `
          INSERT INTO finance.tjurnal
            (jur_no, jur_tanggal, jur_tipetransaksi, jur_cabang,
             jur_penerima, jur_keterangan, jur_rek_kode,
             jur_otomatis, date_create, user_create)
          VALUES (?, ?, 'BBM', ?, ?, ?, ?, 1, NOW(), ?)
        `,
          [
            noBbm,
            tanggal,
            cabang,
            penerima || "",
            `BBM OTOMATIS: ${d.uraian}`,
            d.rekkode,
            user.kode,
          ],
        );
        await conn.query(
          `INSERT INTO finance.tjurnalitem (jurd_jur_no, jurd_rek_kode, jurd_debet, jurd_uraian)
           VALUES (?, ?, ?, ?)`,
          [noBbm, d.rekkode, d.total, d.uraian],
        );
        await conn.query(
          `INSERT INTO finance.tjurnalitem (jurd_jur_no, jurd_trs, jurd_nourut, jurd_uraian, jurd_kredit, jurd_rek_kode)
           VALUES (?, 'BBM', 1, ?, ?, ?)`,
          [noBbm, keterangan || "", d.total, rek_kode],
        );
      }

      i++;
    }

    await conn.commit();
    return { nomor: actualNomor };
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
};

// ── Data print ────────────────────────────────────────────────────────
const getPrintData = async (nomor) => {
  // ⬅ join ke tuser MANKSI (bukan finance.tuser) — konsisten dengan
  // keputusan BKM: record baru pakai kode user MANKSI.
  const [[h]] = await db.query(
    `
    SELECT h.jur_no AS nomor, h.jur_nota AS nota,
      h.jur_penerima AS penerima,
      DATE_FORMAT(h.jur_tanggal,'%Y-%m-%d') AS tanggal,
      DATE_FORMAT(h.jur_tanggal,'%d %b %Y') AS tanggal_fmt,
      h.jur_keterangan AS keterangan, h.jur_cabang AS cabang,
      u.user_nama AS kasir
    FROM finance.tjurnal h
    LEFT JOIN tuser u ON u.user_kode = h.user_create
    WHERE h.jur_no = ?
  `,
    [nomor],
  );
  if (!h) throw new Error("Data tidak ditemukan.");

  const [detail] = await db.query(
    `
    SELECT jurd_nourut AS no, jurd_uraian AS uraian,
      jurd_debet AS nominal,
      jurd_sup_nama AS supplier, jurd_bank AS bank,
      jurd_rekening AS rekening, jurd_atasnama AS atasnama
    FROM finance.tjurnalitem
    WHERE jurd_debet<>0 and jurd_jur_no = ? AND jurd_trs = 'BKK'
    ORDER BY jurd_nourut
  `,
    [nomor],
  );

  const total = detail.reduce((s, d) => s + Number(d.nominal), 0);

  return { ...h, total, detail };
};

// ── Account header (KAS) lintas cabang — dipakai modal pilih Account
// header BKK; cabang BKK diturunkan OTOMATIS dari cabang account yang
// dipilih, bukan dropdown manual.
const getAccountKasHeaderOptions = async () => {
  const [rows] = await db.query(
    `SELECT rek_kode AS kode, rek_nama AS nama, rek_cabang AS cabang
     FROM finance.trekening WHERE LEFT(rek_kode,5)='A-111' ORDER BY rek_kode`,
  );
  return rows;
};

// ── Helper: satu query buat ambil SEMUA pasangan (mb, brg_kode) yang
// sudah kepakai BKK — dipanggil sekali, dipakai buat filter di memory,
// bukan correlated subquery per baris (jauh lebih cepat).
const getUsedMbBrgSet = async () => {
  const [rows] = await db.query(
    `SELECT DISTINCT jurd_mb AS mb, jurd_brg_kode AS brgKode
     FROM finance.tjurnalitem
     WHERE jurd_trs = 'BKK' AND jurd_mb IS NOT NULL AND jurd_mb <> ''`,
  );
  const set = new Set();
  rows.forEach((r) => set.add(`${r.mb}::${r.brgKode}`));
  return set;
};

// ── Minta Beli — HANYA outstanding (belum kesedot BKK lain).
const getOutstandingMintaBeli = async ({
  keyword = "",
  jenis = "ALL",
  page = 1,
  limit = 50,
}) => {
  const usedSet = await getUsedMbBrgSet();

  let where = `WHERE h.mb_status NOT IN ("CLOSE", "DICLOSE")`;
  const params = [];

  if (jenis && jenis !== "ALL") {
    where += ` AND h.mb_jenis = ?`;
    params.push(jenis);
  }
  if (keyword && keyword.trim() !== "") {
    where += ` AND (h.mb_nomor LIKE ? OR h.mb_ket LIKE ?)`;
    params.push(`%${keyword}%`, `%${keyword}%`);
  }

  // Ambil kandidat header dulu (tanpa cek outstanding — itu di JS)
  const [headers] = await db.query(
    `SELECT h.mb_nomor AS Nomor, DATE_FORMAT(h.mb_tanggal,"%Y-%m-%d") AS Tanggal,
            h.mb_jenis AS Jenis, h.mb_ket AS Keterangan, h.mb_cab AS Cab
     FROM tgarmenmintabeli_hdr h
     ${where}
     ORDER BY h.mb_nomor DESC`,
    params,
  );
  if (headers.length === 0) return { items: [], total: 0 };

  // Ambil semua brg_kode utk header-header itu dalam SATU query,
  // lalu cek outstanding-nya di memory pakai usedSet.
  const nomorList = headers.map((h) => h.Nomor);
  const [details] = await db.query(
    `SELECT mbd_nomor AS Nomor, mbd_brg_kode AS BrgKode
     FROM tgarmenmintabeli_dtl
     WHERE mbd_nomor IN (?)`,
    [nomorList],
  );
  const outstandingNomorSet = new Set();
  details.forEach((d) => {
    if (!usedSet.has(`${d.Nomor}::${d.BrgKode}`)) {
      outstandingNomorSet.add(d.Nomor);
    }
  });

  const filtered = headers.filter((h) => outstandingNomorSet.has(h.Nomor));
  const total = filtered.length;
  const offset = (Number(page) - 1) * Number(limit);
  const items = filtered.slice(offset, offset + Number(limit));

  return { items, total };
};

// ── Detail item outstanding untuk 1 nomor Minta Beli.
const getOutstandingMintaBeliDetail = async (nomor) => {
  const usedSet = await getUsedMbBrgSet();

  const [rows] = await db.query(
    `SELECT d.mbd_nourut AS Nourut, d.mbd_brg_kode AS KodeBrg,
            IF(b.brg_note="", b.brg_nama, CONCAT(b.brg_nama, " - ", b.brg_note)) AS Nama,
            b.brg_satuan AS Satuan, d.mbd_jumlah AS Qty, d.mbd_harga AS Harga
     FROM tgarmenmintabeli_dtl d
     LEFT JOIN tgarmen_brg b ON b.brg_kode = d.mbd_brg_kode
     WHERE d.mbd_nomor = ?
     ORDER BY d.mbd_nourut`,
    [nomor],
  );

  const outstanding = rows.filter(
    (r) => !usedSet.has(`${nomor}::${r.KodeBrg}`),
  );

  if (outstanding.length === 0) {
    throw new Error(
      "Minta Beli ini sudah tidak ada item outstanding (semua sudah dibayarkan lewat BKK lain).",
    );
  }
  return outstanding;
};

module.exports = {
  getAccountOptions,
  getAccountAll,
  getKeteranganOptions,
  getCostCenterOptions,
  getDcOptions,
  getSupplierOptions,
  getSupplierDetail,
  getPettyCashOptions,
  getDetailForm,
  saveData,
  getPrintData,
  getAccountKasHeaderOptions,
  getOutstandingMintaBeli,
  getOutstandingMintaBeliDetail,
};
