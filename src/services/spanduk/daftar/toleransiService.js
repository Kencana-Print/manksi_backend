const db = require("../../../config/database");

const T = {
  toleransi: "kencanaprint.toleransi",
  jenisOrder: "kencanaprint.tjenisorder",
};

// Delphi: pilihan jenis = tjenisorder WHERE jo_divisi IN (1,5)
const DIVISI_BOLEH = [1, 5];

const teks = (v) => String(v ?? "").trim();

// Delphi menyambung teks edit langsung ke SQL (tanpa kutip), jadi hanya angka
// dengan titik desimal yang lolos. Kosong / bukan angka = "Gagal Simpan".
const parseAngka = (v, label) => {
  const n =
    typeof v === "number"
      ? v
      : /^\d+(\.\d+)?$/.test(teks(v))
        ? Number(teks(v))
        : NaN;
  if (!Number.isFinite(n))
    throw new Error(`${label} harus berupa angka (desimal pakai titik).`);
  return n;
};

const kodeValid = (kode) => {
  const n = Number(kode);
  if (!Number.isInteger(n) || n <= 0) throw new Error("Kode tidak valid.");
  return n;
};

// jo_kode tidak unik sendirian (kuncinya jo_divisi + jo_kode), jadi nama
// dikelompokkan per kode supaya baris toleransi tidak ikut berlipat.
const JOIN_JENIS = `LEFT JOIN (
    SELECT jo_kode, MIN(jo_nama) AS jo_nama FROM ${T.jenisOrder} GROUP BY jo_kode
  ) j ON j.jo_kode = t.jenis`;

// ── BROWSE ── (port btnRefreshClick ufrmBrowsetoleransi)
const getBrowseToleransi = async () => {
  const [rows] = await db.query(
    `SELECT t.id AS Kode, t.jenis AS Jenis, j.jo_nama AS Nama,
            t.ukuran AS Ukuran, t.toleransi AS Toleransi
     FROM ${T.toleransi} t
     ${JOIN_JENIS}
     ORDER BY t.id`,
  );
  return rows;
};

// ── DETAIL ── (port loaddata ufrmtoleransi)
const getToleransiById = async (kode) => {
  const [rows] = await db.query(
    `SELECT t.id AS Kode, t.jenis AS Jenis, j.jo_nama AS Nama,
            t.ukuran AS Ukuran, t.toleransi AS Toleransi
     FROM ${T.toleransi} t
     ${JOIN_JENIS}
     WHERE t.id = ?`,
    [kodeValid(kode)],
  );
  return rows[0];
};

// ── Validasi & normalisasi payload simpan ──
const siapkanData = (data) => {
  const jenis = teks(data.Jenis);
  if (!jenis) throw new Error("Jenis wajib dipilih.");
  if (jenis.length > 2) throw new Error("Kode jenis maksimal 2 karakter.");

  const ukuran = parseAngka(data.Ukuran, "Ukuran");
  if (ukuran <= 0) throw new Error("Ukuran harus lebih dari 0.");

  const toleransi = parseAngka(data.Toleransi, "Toleransi");
  if (toleransi < 0) throw new Error("Toleransi tidak boleh negatif.");

  return { jenis, ukuran, toleransi };
};

// Jenis harus salah satu pilihan form Delphi (divisi 1 dan 5). Jenis lama
// yang tidak diubah saat ubah data tetap lolos (ada data yatim seperti BT/UM/VB).
// Mengembalikan kode dengan huruf besar/kecil persis seperti di tjenisorder.
const validasiJenis = async (jenis, jenisLama = null) => {
  if (jenisLama !== null && jenis.toLowerCase() === jenisLama.toLowerCase())
    return jenisLama;
  const [rows] = await db.query(
    `SELECT jo_kode FROM ${T.jenisOrder} WHERE jo_kode = ? AND jo_divisi IN (?) LIMIT 1`,
    [jenis, DIVISI_BOLEH],
  );
  if (!rows.length) throw new Error("Jenis order tidak valid.");
  return rows[0].jo_kode;
};

// Delphi tidak mengecek duplikat; di web (jenis + ukuran) harus unik.
const pastikanTidakGanda = async (jenis, ukuran, kecualiId = null) => {
  const params = [jenis, ukuran];
  let sql = `SELECT id FROM ${T.toleransi} WHERE jenis = ? AND ukuran = ?`;
  if (kecualiId !== null) {
    sql += " AND id <> ?";
    params.push(kecualiId);
  }
  const [rows] = await db.query(`${sql} LIMIT 1`, params);
  if (rows.length)
    throw new Error(
      `Toleransi jenis ${jenis} ukuran ${ukuran} sudah ada (kode ${rows[0].id}).`,
    );
};

// ── CREATE ──
// id auto_increment (Delphi: kode dikunci dan tidak ikut INSERT).
// Kolom nama dan toleransi_m tidak disentuh (sama dengan Delphi).
const createToleransi = async (data) => {
  const d = siapkanData(data);
  const jenis = await validasiJenis(d.jenis);
  await pastikanTidakGanda(jenis, d.ukuran);

  const [res] = await db.query(
    `INSERT INTO ${T.toleransi} (jenis, ukuran, toleransi) VALUES (?, ?, ?)`,
    [jenis, d.ukuran, d.toleransi],
  );
  return res.insertId;
};

// ── UPDATE ──
const updateToleransi = async (kode, data) => {
  const id = kodeValid(kode);
  const d = siapkanData(data);

  const [[lama]] = await db.query(
    `SELECT jenis, ukuran FROM ${T.toleransi} WHERE id = ?`,
    [id],
  );
  if (!lama) throw new Error("Data tidak ditemukan.");

  const jenis = await validasiJenis(d.jenis, lama.jenis);

  // Cek duplikat hanya kalau jenis/ukuran berubah, supaya baris lama yang
  // sudah ganda (mis. LN ukuran 1) tetap bisa disimpan.
  const berubah =
    jenis.toLowerCase() !== String(lama.jenis).toLowerCase() ||
    d.ukuran !== Number(lama.ukuran);
  if (berubah) await pastikanTidakGanda(jenis, d.ukuran, id);

  await db.query(
    `UPDATE ${T.toleransi} SET jenis = ?, ukuran = ?, toleransi = ? WHERE id = ?`,
    [jenis, d.ukuran, d.toleransi, id],
  );
};

// ── DELETE ──
// Delphi: hard delete tanpa cek apapun. Belum diketahui tabel lain yang
// menyimpan toleransi.id — tambahkan guard di sini kalau ada.
const deleteToleransi = async (kode) => {
  const id = kodeValid(kode);
  const [res] = await db.query(`DELETE FROM ${T.toleransi} WHERE id = ?`, [id]);
  if (res.affectedRows === 0) throw new Error("Data tidak ditemukan.");
};

// ── LOOKUPS ── (sumber: refreshdata ufrmtoleransi)
const getLookups = async (category) => {
  switch (category) {
    case "jenis": {
      const [rows] = await db.query(
        `SELECT jo_kode AS Kode, MIN(jo_nama) AS Nama
         FROM ${T.jenisOrder}
         WHERE jo_divisi IN (?)
         GROUP BY jo_kode
         ORDER BY jo_kode`,
        [DIVISI_BOLEH],
      );
      return rows;
    }
    default:
      return [];
  }
};

module.exports = {
  getBrowseToleransi,
  getToleransiById,
  createToleransi,
  updateToleransi,
  deleteToleransi,
  getLookups,
};
