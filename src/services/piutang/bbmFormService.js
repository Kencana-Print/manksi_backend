const db = require("../../config/database");
const tutupBukuService = require("../tutupBukuService");

// ── Account header BBM (A-112 atau rek_kol_id=12) ─────────────────────
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
    `SELECT rek_kode AS kode, rek_nama AS nama, rek_cabang AS cabang,
            rek_rekening AS rekening
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

// ── Generate nomor otomatis BBM ───────────────────────────────────────
const getMaxNomor = async (cabang, conn) => {
  const prefix = `${cabang}-BBM.${new Date().getFullYear()}.`;
  const [[row]] = await (conn || db).query(
    `SELECT IFNULL(MAX(CAST(RIGHT(jur_no,5) AS UNSIGNED)),0) AS max_val
     FROM finance.tjurnal WHERE jur_no LIKE ?`,
    [`${prefix}%`],
  );
  return `${prefix}${String(Number(row.max_val) + 1).padStart(5, "0")}`;
};

// ── Nomor otomatis BKK/BBK ────────────────────────────────────────────
const getNomorOtomatis = async (bbmNomor, localNn, conn) => {
  const [[row]] = await (conn || db).query(
    `SELECT IFNULL(MAX(CAST(LEFT(jur_no,2) AS UNSIGNED)),0) AS max_val
     FROM finance.tjurnal WHERE jur_otomatis=1 AND MID(jur_no,3,18)=?`,
    [bbmNomor],
  );
  return String(100 + localNn + Number(row.max_val)).slice(-2) + bbmNomor;
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
      d.jurd_uraian, d.jurd_kredit AS det_nominal,
      r.rek_nama AS det_reknama,
      d.jurd_cc_kode, c.cc_nama,
      d.jurd_dcnama
    FROM finance.tjurnal h
    LEFT JOIN finance.tjurnalitem d ON d.jurd_jur_no = h.jur_no
    LEFT JOIN finance.trekening r ON r.rek_kode = d.jurd_rek_kode
    LEFT JOIN finance.tcostcenter c ON c.cc_kode = d.jurd_cc_kode
    WHERE d.jurd_trs = 'BBM' AND h.jur_no = ?
    ORDER BY d.jurd_nourut
  `,
    [nomor],
  );

  if (rows.length === 0) throw new Error("Nomor BBM tersebut belum ada.");

  const h = rows[0];
  const detail = rows
    .filter((r) => r.jurd_uraian)
    .map((r) => ({
      no: r.jurd_nourut,
      uraian: r.jurd_uraian,
      nominal: Number(r.det_nominal), // ← jurd_kredit untuk BBM
      rekkode: r.det_rek_kode || "",
      reknama: r.det_reknama || "",
      cckode: r.jurd_cc_kode || 0,
      ccnama: r.cc_nama || "",
      dcnama: r.jurd_dcnama || "",
      dckode: r.jurd_cc_kode || 0,
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

  // Cek tutup buku — pola sama dengan bbmService.js (browse/delete):
  // getTanggalTutupBukuUntukTanggal dibanding hari ini, manual override
  // (pengaturan.tclose, cid="BBM") menang kalau ada.
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const limitDate =
    await tutupBukuService.getTanggalTutupBukuUntukTanggal(tanggal);
  limitDate.setHours(0, 0, 0, 0);

  const zCloseManual = await tutupBukuService.getManualTutupBuku("BBM");

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

  // Delphi BBM: TIDAK ada cek cabang di F10 (berbeda dari BKM) — sengaja
  // tidak ada validasi cabang-vs-user di sini, sesuai perilaku asli.

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
        VALUES (?, ?, 'BBM', ?, ?, ?, ?, ?, NOW(), ?)
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

    await conn.query(
      `DELETE FROM finance.tjurnal WHERE jur_otomatis=1 AND MID(jur_no,3,18)=?`,
      [actualNomor],
    );

    await conn.query(`DELETE FROM finance.tjurnalitem WHERE jurd_jur_no=?`, [
      actualNomor,
    ]);

    const total = detail.reduce((s, d) => s + (Number(d.nominal) || 0), 0);

    // Header DEBET — BBM sama seperti BKM
    await conn.query(
      `
      INSERT INTO finance.tjurnalitem (jurd_jur_no, jurd_rek_kode, jurd_debet, jurd_uraian)
      VALUES (?, ?, ?, ?)
    `,
      [actualNomor, rek_kode, total, keterangan || ""],
    );

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
           jurd_kredit, jurd_rek_kode, jurd_cc_kode, jurd_dcnama)
        VALUES (?, 'BBM', ?, ?, ?, ?, ?, ?)
      `,
        [
          actualNomor,
          i,
          d.uraian,
          Number(d.nominal),
          d.rekkode || "",
          d.cckode || 0,
          d.dcnama || "",
        ],
      );

      // BKK otomatis jika account A-111
      if ((d.rekkode || "").startsWith("A-111")) {
        localNn++;
        const noBkk = await getNomorOtomatis(actualNomor, localNn, conn);
        await conn.query(
          `
          INSERT INTO finance.tjurnal
            (jur_no, jur_tanggal, jur_tipetransaksi, jur_cabang,
             jur_penerima, jur_keterangan, jur_rek_kode,
             jur_otomatis, date_create, user_create)
          VALUES (?, ?, 'BKK', ?, ?, ?, ?, 1, NOW(), ?)
        `,
          [
            noBkk,
            tanggal,
            cabang,
            penerima || "",
            `BKK OTOMATIS: ${d.uraian}`,
            d.rekkode,
            user.kode,
          ],
        );
        await conn.query(
          `INSERT INTO finance.tjurnalitem (jurd_jur_no, jurd_rek_kode, jurd_kredit, jurd_uraian)
           VALUES (?, ?, ?, ?)`,
          [noBkk, d.rekkode, d.nominal, d.uraian],
        );
        await conn.query(
          `INSERT INTO finance.tjurnalitem (jurd_jur_no, jurd_trs, jurd_nourut, jurd_uraian, jurd_debet, jurd_rek_kode)
           VALUES (?, 'BKK', 1, ?, ?, ?)`,
          [noBkk, keterangan || "", d.nominal, rek_kode],
        );
      }

      // BBK otomatis jika account A-112 atau B-211
      if (
        (d.rekkode || "").startsWith("A-112") ||
        (d.rekkode || "").startsWith("B-211")
      ) {
        localNn++;
        const noBbk = await getNomorOtomatis(actualNomor, localNn, conn);
        await conn.query(
          `
          INSERT INTO finance.tjurnal
            (jur_no, jur_tanggal, jur_tipetransaksi, jur_cabang,
             jur_penerima, jur_keterangan, jur_rek_kode,
             jur_otomatis, date_create, user_create)
          VALUES (?, ?, 'BBK', ?, ?, ?, ?, 1, NOW(), ?)
        `,
          [
            noBbk,
            tanggal,
            cabang,
            penerima || "",
            `BBK OTOMATIS: ${d.uraian}`,
            d.rekkode,
            user.kode,
          ],
        );
        await conn.query(
          `INSERT INTO finance.tjurnalitem (jurd_jur_no, jurd_rek_kode, jurd_kredit, jurd_uraian)
           VALUES (?, ?, ?, ?)`,
          [noBbk, d.rekkode, d.nominal, d.uraian],
        );
        await conn.query(
          `INSERT INTO finance.tjurnalitem (jurd_jur_no, jurd_trs, jurd_nourut, jurd_uraian, jurd_debet, jurd_rek_kode)
           VALUES (?, 'BBK', 1, ?, ?, ?)`,
          [noBbk, keterangan || "", d.nominal, rek_kode],
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
  // keputusan BKM/BKK.
  const [[h]] = await db.query(
    `
    SELECT h.jur_no AS nomor, h.jur_penerima AS penerima,
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
      jurd_kredit AS nominal
    FROM finance.tjurnalitem
    WHERE jurd_jur_no = ? AND jurd_trs = 'BBM'
    ORDER BY jurd_nourut
  `,
    [nomor],
  );

  const total = detail.reduce((s, d) => s + Number(d.nominal), 0);
  return { ...h, total, detail };
};

module.exports = {
  getAccountOptions,
  getAccountAll,
  getCostCenterOptions,
  getDcOptions,
  getDetailForm,
  saveData,
  getPrintData,
};
