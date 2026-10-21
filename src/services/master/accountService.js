const db = require("../../config/database");
const { hitungSaldoAkun } = require("../postingGuardService");

const getAll = async () => {
  const [rows] = await db.query(
    `SELECT r.rek_kode AS kode, r.rek_nama AS nama,
            r.rek_rekening AS no_rekening, r.rek_kaosan AS store,
            k.kol_nama AS kelompok, r.rek_kol_id AS kol_id,
            r.rek_cabang AS cabang, r.rek_ket AS keterangan,
            r.rek_parent AS parent, r.rek_pemilik AS pemilik,
            IFNULL(u.user_nama, '') AS pemilik_nama,
            r.rek_isheader AS is_header,
            IF(r.rek_isaktif=0,'Aktif','Pasif') AS status,
            IFNULL(s.saldo, 0) AS saldo_akhir
     FROM finance.trekening r
     LEFT JOIN finance.tkelompok k ON k.kol_id = r.rek_kol_id
     LEFT JOIN tuser u ON u.user_kode = r.rek_pemilik AND r.rek_pemilik <> ''
     LEFT JOIN (
       SELECT t.kode, SUM(t.saldo) AS saldo
       FROM (
         SELECT jurd_rek_kode AS kode, SUM(jurd_debet - jurd_kredit) AS saldo
         FROM finance.tjurnalitem
         WHERE jurd_nourut = 0
         GROUP BY jurd_rek_kode
         UNION ALL
         SELECT i.jurd_rek_kode, SUM(i.jurd_debet - i.jurd_kredit)
         FROM finance.tjurnal j
         JOIN finance.tjurnalitem i ON i.jurd_jur_no = j.jur_no
         WHERE j.jur_tipetransaksi = 'JUR' AND i.jurd_nourut <> 0
         GROUP BY i.jurd_rek_kode
       ) t
       GROUP BY t.kode
     ) s ON s.kode = r.rek_kode
     ORDER BY IF(r.rek_parent = '', r.rek_kode, r.rek_parent),
              r.rek_parent <> '', r.rek_kode`,
  );

  // Saldo induk = saldo sendiri + saldo semua anak (maksimal 1 tingkat).
  const sendiri = new Map(
    rows.map((r) => [r.kode, Number(r.saldo_akhir) || 0]),
  );
  const byKode = new Map(rows.map((r) => [r.kode, r]));
  for (const r of rows) {
    if (r.parent && byKode.has(r.parent)) {
      const p = byKode.get(r.parent);
      p.saldo_akhir = Number(p.saldo_akhir) + (sendiri.get(r.kode) || 0);
    }
  }
  return rows;
};

const getById = async (kode) => {
  const [[row]] = await db.query(
    `SELECT r.rek_kode AS kode, r.rek_nama AS nama,
            r.rek_rekening AS no_rekening, r.rek_kaosan AS store, r.rek_kol_id AS kol_id,
            r.rek_cabang AS cabang, r.rek_ket AS keterangan,
            r.rek_isaktif AS is_aktif,
            r.rek_parent AS parent, r.rek_pemilik AS pemilik,
            r.rek_isheader AS is_header
     FROM finance.trekening r WHERE r.rek_kode = ?`,
    [kode],
  );
  if (!row) throw new Error("Rekening tidak ditemukan.");
  return row;
};

const getKelompok = async () => {
  const [rows] = await db.query(
    `SELECT kol_id AS id, kol_nama AS nama FROM finance.tkelompok ORDER BY kol_nama`,
  );
  return rows;
};

const getCabang = async () => {
  const [rows] = await db.query(
    `SELECT Cabang AS cabang FROM finance.tcabang ORDER BY Cabang`,
  );
  return rows;
};

const cekPakai = async (kode) => {
  const [[row]] = await db.query(
    `SELECT COUNT(*) AS total FROM (
       SELECT jur_rek_kode AS kode FROM finance.tjurnal WHERE jur_rek_kode <> ''
       UNION
       SELECT jurd_rek_kode AS kode FROM finance.tjurnalitem WHERE jurd_rek_kode <> ''
     ) X WHERE kode = ?`,
    [kode],
  );
  return row.total > 0;
};

const hitungSaldoSendiri = (kode) => hitungSaldoAkun(kode);

// Validasi relasi induk/pemilik. kol_id & cabang sub-account DIPAKSA dari induk
// karena filter dropdown (Buku Besar, BKK, Kasbon) bergantung pada nilai itu.
const siapkanRelasi = async ({ kode, parent, pemilik }) => {
  const hasil = { parent: "", pemilik: "", kol_id: null, cabang: null };

  if (pemilik && !parent)
    throw new Error("Pemilik hanya boleh diisi untuk sub-account.");

  if (parent) {
    if (parent === kode)
      throw new Error("Account tidak boleh menjadi induk dirinya sendiri.");
    const [[p]] = await db.query(
      `SELECT rek_parent, rek_isheader, rek_kol_id, rek_cabang
       FROM finance.trekening WHERE rek_kode = ?`,
      [parent],
    );
    if (!p) throw new Error("Account induk tidak ditemukan.");
    if (!p.rek_isheader)
      throw new Error("Account induk belum ditandai sebagai induk.");
    if (p.rek_parent)
      throw new Error(
        "Induk tidak boleh berupa sub-account (maksimal 1 tingkat).",
      );
    if (String(parent).slice(0, 5) !== String(kode).slice(0, 5))
      throw new Error(
        `Kode sub-account harus berawalan ${String(parent).slice(0, 5)}.`,
      );
    hasil.parent = parent;
    hasil.kol_id = p.rek_kol_id;
    hasil.cabang = p.rek_cabang;
  }

  if (pemilik) {
    const [[u]] = await db.query(
      `SELECT user_kode FROM tuser WHERE user_kode = ? AND user_aktif = 0`,
      [pemilik],
    );
    if (!u)
      throw new Error(
        `User pemilik "${pemilik}" tidak ditemukan atau tidak aktif.`,
      );
    hasil.pemilik = pemilik;
  }
  return hasil;
};

const getPemilikOptions = async (search = "") => {
  const [rows] = await db.query(
    `SELECT user_kode AS kode, user_nama AS nama
     FROM tuser
     WHERE user_aktif = 0 AND (user_nama LIKE ? OR user_kode LIKE ?)
     ORDER BY user_nama LIMIT 50`,
    [`%${search}%`, `%${search}%`],
  );
  return rows;
};

const getIndukOptions = async () => {
  const [rows] = await db.query(
    `SELECT rek_kode AS kode, rek_nama AS nama,
            rek_kol_id AS kol_id, rek_cabang AS cabang
     FROM finance.trekening
     WHERE rek_isheader = 1 AND rek_parent = ''
     ORDER BY rek_kode`,
  );
  return rows;
};

const saveData = async (payload) => {
  const {
    isEdit,
    kode,
    nama,
    no_rekening,
    kol_id,
    cabang,
    store,
    keterangan,
    is_aktif,
    parent,
    pemilik,
  } = payload;

  if (isEdit) {
    const [[lama]] = await db.query(
      `SELECT rek_isaktif, rek_isheader, rek_parent, rek_pemilik, rek_kol_id
       FROM finance.trekening WHERE rek_kode = ?`,
      [kode],
    );
    if (!lama) throw new Error("Rekening tidak ditemukan.");

    // Induk tidak bisa diubah setelah dibuat. Pemilik yang tidak dikirim
    // dianggap tidak berubah (aman untuk form lama yang belum punya field ini).
    const rel = await siapkanRelasi({
      kode,
      parent: lama.rek_parent,
      pemilik: pemilik === undefined ? lama.rek_pemilik : pemilik || "",
    });
    const kolFinal = rel.kol_id ?? kol_id;

    // Pasif: tolak jika masih ada saldo / induk masih punya anak aktif.
    if (!is_aktif && Number(lama.rek_isaktif) === 0) {
      const saldo = await hitungSaldoSendiri(kode);
      if (saldo !== 0)
        throw new Error(
          "Account masih memiliki saldo. Nol-kan saldo sebelum dipasifkan.",
        );
      const [[anak]] = await db.query(
        `SELECT COUNT(*) AS c FROM finance.trekening
         WHERE rek_parent = ? AND rek_isaktif = 0`,
        [kode],
      );
      if (anak.c > 0)
        throw new Error("Masih ada sub-account aktif di bawah account ini.");
    }

    await db.query(
      `UPDATE finance.trekening SET
         rek_nama = ?, rek_rekening = ?, rek_kaosan = ?,
         rek_ket = ?, rek_isaktif = ?, rek_kol_id = ?, rek_pemilik = ?
       WHERE rek_kode = ?`,
      [
        nama,
        no_rekening || "",
        store || "",
        keterangan || "",
        is_aktif ? 0 : 1,
        kolFinal,
        rel.pemilik,
        kode,
      ],
    );

    // Kelompok induk berubah -> anak ikut, supaya filter dropdown tetap konsisten.
    if (
      Number(lama.rek_isheader) === 1 &&
      Number(kolFinal) !== Number(lama.rek_kol_id)
    ) {
      await db.query(
        `UPDATE finance.trekening SET rek_kol_id = ? WHERE rek_parent = ?`,
        [kolFinal, kode],
      );
    }
  } else {
    const [[cek]] = await db.query(
      `SELECT COUNT(*) AS c FROM finance.trekening WHERE rek_kode = ?`,
      [kode],
    );
    if (cek.c > 0) throw new Error(`Kode "${kode}" sudah ada.`);

    const rel = await siapkanRelasi({
      kode,
      parent: parent || "",
      pemilik: pemilik || "",
    });

    await db.query(
      `INSERT INTO finance.trekening
         (rek_kode, rek_nama, rek_rekening, rek_kol_id, rek_cabang,
          rek_kaosan, rek_ket, rek_isaktif, rek_parent, rek_pemilik)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        kode,
        nama,
        no_rekening || "",
        rel.kol_id ?? kol_id,
        rel.cabang ?? (cabang || ""),
        store || "",
        keterangan || "",
        is_aktif ? 0 : 1,
        rel.parent,
        rel.pemilik,
      ],
    );
  }

  return { kode };
};

const deleteData = async (kode) => {
  const dipakai = await cekPakai(kode);
  if (dipakai)
    throw new Error(
      "Account ini sudah dipakai untuk transaksi. Tidak bisa dihapus.",
    );

  const [[anak]] = await db.query(
    `SELECT COUNT(*) AS c FROM finance.trekening WHERE rek_parent = ?`,
    [kode],
  );
  if (anak.c > 0)
    throw new Error(
      "Account ini memiliki sub-account. Hapus sub-account lebih dulu.",
    );

  await db.query(`DELETE FROM finance.trekening WHERE rek_kode = ?`, [kode]);
};

module.exports = {
  getAll,
  getById,
  getKelompok,
  getCabang,
  getPemilikOptions,
  getIndukOptions,
  saveData,
  deleteData,
};
