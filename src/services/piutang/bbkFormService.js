const db = require("../../config/database");
const tutupBukuService = require("../tutupBukuService");

// ── Account header BBK (A-112 atau rek_kol_id=12) ─────────────────────
const getAccountOptions = async (cabang) => {
  let where;
  const params = [];
  if (cabang === "P01" || cabang === "HO-") {
    where = `(LEFT(rek_kode,5)='A-112' OR rek_kol_id=12)`;
  } else {
    where = `rek_cabang = ?`;
    params.push(cabang);
  }

  const [rows] = await db.query(
    `SELECT rek_kode AS kode, rek_nama AS nama, rek_cabang AS cabang
     FROM finance.trekening WHERE ${where} ORDER BY rek_kode`,
    params,
  );
  return rows;
};

// ── Account detail (semua) ────────────────────────────────────────────
const getAccountAll = async () => {
  const [rows] = await db.query(
    `SELECT rek_kode AS kode, rek_nama AS nama, rek_cabang AS cabang
     FROM finance.trekening WHERE rek_isaktif = 0 ORDER BY rek_kode`,
  );
  return rows;
};

// ── Keterangan dari tjenisbayar ───────────────────────────────────────
const getKeteranganOptions = async () => {
  const [rows] = await db.query(
    `SELECT jenisbayar AS nama FROM finance.tjenisbayar ORDER BY jenisbayar`,
  );
  return rows;
};

// ── Cost center ───────────────────────────────────────────────────────
const getCostCenterOptions = async () => {
  const [rows] = await db.query(
    `SELECT cc_kode AS kode, cc_nama AS nama FROM finance.tcostcenter ORDER BY cc_nama`,
  );
  return rows;
};

// ── Detail CC ─────────────────────────────────────────────────────────
const getDcOptions = async (cckode) => {
  const [rows] = await db.query(
    `SELECT dc_kode AS kode, dc_nama AS nama
     FROM finance.tcostcenteritem WHERE dc_kode = ? ORDER BY dc_nama`,
    [cckode],
  );
  return rows;
};

// ── Supplier — kencanaprint adalah DB lokal MANKSI sendiri, jadi
// prefix eksplisit yang ada di referensi Finance dibuang (sama pola
// dengan bkkFormService.getSupplierOptions). Bedanya dari BKK: di sini
// bank/rekening/atasnama langsung dibawa satu query, tidak ada
// getSupplierDetail terpisah.
const getSupplierOptions = async (search = "") => {
  const [rows] = await db.query(
    `SELECT sup_kode AS kode, sup_nama AS nama,
            supd_bank AS bank, supd_rekening AS rekening,
            supd_atasnama AS atasnama
     FROM tsupplier
     LEFT JOIN tsupplieritem ON supd_kode = sup_kode
     WHERE sup_aktif = 'Y' AND (sup_nama LIKE ? OR sup_kode LIKE ?)
     ORDER BY sup_nama LIMIT 50`,
    [`%${search}%`, `%${search}%`],
  );
  return rows;
};

// ── Generate nomor otomatis BBK ───────────────────────────────────────
const getMaxNomor = async (cabang, conn) => {
  const prefix = `${cabang}-BBK.${new Date().getFullYear()}.`;
  const [[row]] = await (conn || db).query(
    `SELECT IFNULL(MAX(CAST(RIGHT(jur_no,5) AS UNSIGNED)),0) AS max_val
     FROM finance.tjurnal WHERE jur_no LIKE ?`,
    [`${prefix}%`],
  );
  return `${prefix}${String(Number(row.max_val) + 1).padStart(5, "0")}`;
};

// ── Nomor otomatis BKM/BBM — BBK pakai RIGHT(jur_no, CHAR_LENGTH(?))
// bukan MID(jur_no,3,18) seperti BKK, dipertahankan apa adanya sesuai
// referensi (logika matching-nya berbeda, bukan salah ketik).
const getNomorOtomatis = async (bbkNomor, localNn, conn) => {
  const [[row]] = await (conn || db).query(
    `SELECT IFNULL(MAX(CAST(LEFT(jur_no,2) AS UNSIGNED)),0) AS max_val
     FROM finance.tjurnal
     WHERE jur_otomatis=1
       AND RIGHT(jur_no, CHAR_LENGTH(?)) = ?`,
    [bbkNomor, bbkNomor],
  );
  return String(100 + localNn + Number(row.max_val)).slice(-2) + bbkNomor;
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
      d.jurd_cc_kode, c.cc_nama,
      d.jurd_dcnama,
      d.jurd_sup_kode, d.jurd_sup_nama,
      d.jurd_bank, d.jurd_rekening, d.jurd_atasnama,
      d.jurd_satuan,d.jurd_qty,d.jurd_harga,d.jurd_mb,d.jurd_brg_kode,
      m.mb_jenis,m.mb_cab
    FROM finance.tjurnal h
    LEFT JOIN finance.tjurnalitem d ON d.jurd_jur_no = h.jur_no
    LEFT JOIN finance.trekening r ON r.rek_kode = d.jurd_rek_kode
    LEFT JOIN finance.tcostcenter c ON c.cc_kode = d.jurd_cc_kode
    LEFT JOIN tgarmenmintabeli_hdr m ON m.mb_nomor=d.jurd_mb
    WHERE d.jurd_trs = 'BBK' AND h.jur_no = ?
    ORDER BY d.jurd_nourut
  `,
    [nomor],
  );

  if (rows.length === 0) throw new Error("Nomor BBK tersebut belum ada.");

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
      kdbrg: r.jurd_brg_kode || "",
      satuan: r.jurd_satuan || "",
      qty: Number(r.jurd_qty),
      harga: Number(r.jurd_harga),
      // ── Kolom supplier (BBK punya, BKK tidak) ──
      kdsup: r.jurd_sup_kode || "",
      supplier: r.jurd_sup_nama || "",
      bank: r.jurd_bank || "",
      rekening: r.jurd_rekening || "",
      atasnama: r.jurd_atasnama || "",
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

  // Cek tutup buku — pola sama dengan bbkService.js (browse/delete):
  // getTanggalTutupBukuUntukTanggal dibanding hari ini, manual override
  // (pengaturan.tclose, cid="BBK") menang kalau ada.
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const limitDate =
    await tutupBukuService.getTanggalTutupBukuUntukTanggal(tanggal);
  limitDate.setHours(0, 0, 0, 0);

  const zCloseManual = await tutupBukuService.getManualTutupBuku("BBK");

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
  let localNn = 0;

  try {
    let actualNomor = nomor;
    let flagEdit = isEdit;

    // Delphi: jika edit dan cabang berubah → delete lalu insert baru
    if (isEdit && cabang !== cabang_old) {
      await conn.query(`DELETE FROM finance.tjurnal WHERE jur_no = ?`, [nomor]);
      flagEdit = false;
    }

    if (flagEdit) {
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
      actualNomor = await getMaxNomor(cabang, conn);
      await conn.query(
        `
        INSERT INTO finance.tjurnal
          (jur_no, jur_tanggal, jur_tipetransaksi, jur_cabang,
           jur_nota, jur_penerima, jur_keterangan, jur_rek_kode,
           date_create, user_create)
        VALUES (?, ?, 'BBK', ?, ?, ?, ?, ?, NOW(), ?)
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

    // Delete jurnal otomatis
    await conn.query(
      `DELETE FROM finance.tjurnal
       WHERE jur_otomatis=1
        AND RIGHT(jur_no, CHAR_LENGTH(?)) = ?`,
      [actualNomor, actualNomor],
    );
    // Delete tjurnalitem
    await conn.query(`DELETE FROM finance.tjurnalitem WHERE jurd_jur_no=?`, [
      actualNomor,
    ]);

    const total = detail.reduce((s, d) => s + (Number(d.total) || 0), 0);

    // Insert kredit header
    await conn.query(
      `
      INSERT INTO finance.tjurnalitem (jurd_jur_no, jurd_rek_kode, jurd_kredit, jurd_uraian)
      VALUES (?, ?, ?, ?)
    `,
      [actualNomor, rek_kode, total, keterangan || ""],
    );

    // Insert debet per baris — BBK include supplier
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
          jurd_satuan,jurd_qty,jurd_harga,jurd_mb,jurd_brg_kode,
           jurd_debet, jurd_rek_kode, jurd_cc_kode, jurd_dcnama,
           jurd_sup_kode, jurd_sup_nama, jurd_bank, jurd_rekening, jurd_atasnama)
        VALUES (?, 'BBK', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
        [
          actualNomor,
          i,
          d.uraian,
          d.satuan,
          Number(d.qty),
          Number(d.harga),
          d.mb,
          d.kdbrg,
          Number(d.total),
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

      // BKM otomatis jika account A-111
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

      // BBM otomatis jika account A-112 atau B-211
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

// ── Print data ────────────────────────────────────────────────────────
const getPrintData = async (nomor) => {
  // ⬅ join ke tuser MANKSI (bukan finance.tuser) — konsisten dengan
  // keputusan BKM/BKK/BBM.
  const [[h]] = await db.query(
    `
    SELECT h.jur_no AS nomor, h.jur_penerima AS pic,
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
    SELECT jurd_nourut AS no, jurd_uraian AS uraian, jurd_debet AS nominal
    FROM finance.tjurnalitem
    WHERE jurd_debet<>0 and jurd_jur_no = ? AND jurd_trs = 'BBK'
    ORDER BY jurd_nourut
  `,
    [nomor],
  );

  const total = detail.reduce((s, d) => s + Number(d.nominal), 0);
  return { ...h, total, detail };
};

// ── Minta Beli — HANYA outstanding (belum kesedot BBK lain). Sama
// pola dengan bkkFormService, exclusion source jurd_trs='BBK'.
const getUsedMbBrgSet = async () => {
  const [rows] = await db.query(
    `SELECT DISTINCT jurd_mb AS mb, jurd_brg_kode AS brgKode
     FROM finance.tjurnalitem
     WHERE jurd_trs = 'BBK' AND jurd_mb IS NOT NULL AND jurd_mb <> ''`,
  );
  const set = new Set();
  rows.forEach((r) => set.add(`${r.mb}::${r.brgKode}`));
  return set;
};

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

  const [headers] = await db.query(
    `SELECT h.mb_nomor AS Nomor, DATE_FORMAT(h.mb_tanggal,"%Y-%m-%d") AS Tanggal,
            h.mb_jenis AS Jenis, h.mb_ket AS Keterangan, h.mb_cab AS Cab
     FROM tgarmenmintabeli_hdr h
     ${where}
     ORDER BY h.mb_nomor DESC`,
    params,
  );
  if (headers.length === 0) return { items: [], total: 0 };

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
      "Minta Beli ini sudah tidak ada item outstanding (semua sudah dibayarkan lewat BBK lain).",
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
  getDetailForm,
  saveData,
  getPrintData,
  getOutstandingMintaBeli,
  getOutstandingMintaBeliDetail,
};
