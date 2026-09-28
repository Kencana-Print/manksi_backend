const db = require("../../config/database");
const tutupBukuService = require("../tutupBukuService");

// ── Account detail (semua aktif) ──────────────────────────────────────
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

// ── Generate nomor otomatis JUR — cabang dinamis (dipilih user saat
// create), pola prefix sama seperti BKM/BKK/BBM/BBK ──
const getMaxNomor = async (cabang, conn) => {
  const prefix = `${cabang}-JUR.${new Date().getFullYear()}.`;
  const [[row]] = await (conn || db).query(
    `SELECT IFNULL(MAX(CAST(RIGHT(jur_no,5) AS UNSIGNED)),0) AS max_val
     FROM finance.tjurnal WHERE jur_no LIKE ?`,
    [`${prefix}%`],
  );
  return `${prefix}${String(Number(row.max_val) + 1).padStart(5, "0")}`;
};

// ── Load form edit ────────────────────────────────────────────────────
const getDetailForm = async (nomor) => {
  const [rows] = await db.query(
    `
    SELECT h.jur_no, DATE_FORMAT(h.jur_tanggal,'%Y-%m-%d') AS jur_tanggal,
      h.jur_keterangan, h.jur_cabang,
      d.jurd_nourut, d.jurd_rek_kode AS det_rek_kode,
      d.jurd_uraian, d.jurd_debet, d.jurd_kredit,
      r.rek_nama AS det_reknama,
      d.jurd_cc_kode, c.cc_nama,
      d.jurd_dcnama
    FROM finance.tjurnal h
    LEFT JOIN finance.tjurnalitem d ON d.jurd_jur_no = h.jur_no
    LEFT JOIN finance.trekening r ON r.rek_kode = d.jurd_rek_kode
    LEFT JOIN finance.tcostcenter c ON c.cc_kode = d.jurd_cc_kode
    WHERE h.jur_tipetransaksi = 'JUR' AND h.jur_no = ?
    ORDER BY d.jurd_nourut
  `,
    [nomor],
  );

  if (rows.length === 0)
    throw new Error("Nomor Jurnal Umum tersebut belum ada.");

  const h = rows[0];
  const detail = rows
    .filter((r) => r.jurd_uraian !== null && r.jurd_uraian !== undefined)
    .map((r) => ({
      no: r.jurd_nourut,
      uraian: r.jurd_uraian || "",
      debet: Number(r.jurd_debet) || 0,
      kredit: Number(r.jurd_kredit) || 0,
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
    keterangan: h.jur_keterangan || "",
    cabang: h.jur_cabang || "",
    detail,
  };
};

// ── Simpan ────────────────────────────────────────────────────────────
const saveData = async (payload, user) => {
  const { isEdit, nomor, tanggal, keterangan, cabang, detail } = payload;

  if (!isEdit && !cabang) {
    throw new Error("Cabang wajib diisi.");
  }
  // Cek tutup buku — pola sama dengan jurnalUmumService.js
  // (browse/delete): getTanggalTutupBukuUntukTanggal dibanding hari
  // ini, manual override (pengaturan.tclose, cid="JUR") menang kalau
  // ada.
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const limitDate =
    await tutupBukuService.getTanggalTutupBukuUntukTanggal(tanggal);
  limitDate.setHours(0, 0, 0, 0);

  const zCloseManual = await tutupBukuService.getManualTutupBuku("JUR");

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

  try {
    let actualNomor = nomor;

    if (isEdit) {
      await conn.query(
        `
        UPDATE finance.tjurnal SET
          jur_keterangan = ?,
          jur_tanggal    = ?,
          date_modified  = NOW(),
          user_modified  = ?
        WHERE jur_no = ?
      `,
        [keterangan || "", tanggal, user.kode, nomor],
      );
    } else {
      actualNomor = await getMaxNomor(cabang, conn);
      await conn.query(
        `
        INSERT INTO finance.tjurnal
            (jur_no, jur_tanggal, jur_tipetransaksi,
            jur_cabang, jur_keterangan, date_create, user_create)
        VALUES (?, ?, 'JUR', ?, ?, NOW(), ?)
        `,
        [actualNomor, tanggal, cabang, keterangan || "", user.kode],
      );
    }

    // Delete tjurnalitem
    await conn.query(`DELETE FROM finance.tjurnalitem WHERE jurd_jur_no = ?`, [
      actualNomor,
    ]);

    // Insert detail — Jurnal Umum punya debet DAN kredit per baris
    let i = 1;
    for (const d of detail) {
      if (!d.uraian && !d.debet && !d.kredit) {
        i++;
        continue;
      }

      await conn.query(
        `
        INSERT INTO finance.tjurnalitem
            (jurd_jur_no, jurd_trs, jurd_nourut, jurd_uraian,
            jurd_debet, jurd_kredit,
            jurd_rek_kode, jurd_cc_kode, jurd_dcnama)
        VALUES (?, 'JUR', ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          actualNomor,
          i,
          d.uraian || "",
          Number(d.debet) || 0,
          Number(d.kredit) || 0,
          d.rekkode || "",
          d.cckode || 0,
          d.dcnama || "",
        ],
      );
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

module.exports = {
  getAccountAll,
  getCostCenterOptions,
  getDcOptions,
  getDetailForm,
  saveData,
};
