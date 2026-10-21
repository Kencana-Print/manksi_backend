const db = require("../config/database");

// Mulai tanggal ini account induk (rek_isheader = 1) tidak boleh dipakai transaksi.
const TANGGAL_MULAI_BLOKIR_INDUK = "2026-11-01";

const toYmd = (tanggal) => {
  if (tanggal instanceof Date) {
    const y = tanggal.getFullYear();
    const m = String(tanggal.getMonth() + 1).padStart(2, "0");
    const d = String(tanggal.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  return String(tanggal).slice(0, 10);
};

// executor: db atau conn transaksi. Dilempar Error bila ada account induk.
const assertBolehPosting = async (kodeList, tanggal, executor = db) => {
  if (!tanggal || toYmd(tanggal) < TANGGAL_MULAI_BLOKIR_INDUK) return;
  const kode = [...new Set((kodeList || []).filter(Boolean))];
  if (!kode.length) return;
  const [rows] = await executor.query(
    `SELECT rek_kode FROM finance.trekening
     WHERE rek_kode IN (?) AND rek_isheader = 1`,
    [kode],
  );
  if (rows.length) {
    throw new Error(
      `Account ${rows.map((r) => r.rek_kode).join(", ")} adalah account induk dan tidak boleh dipakai transaksi mulai ${TANGGAL_MULAI_BLOKIR_INDUK}. Pilih sub-account.`,
    );
  }
};

// Perilaku sub-account (transfer laci, blokir induk) aktif mulai tanggal cut-off.
const isSetelahCutoff = (tanggal) =>
  !!tanggal && toYmd(tanggal) >= TANGGAL_MULAI_BLOKIR_INDUK;

// Induk disembunyikan di dropdown HANYA mulai tanggal cut-off.
// Sebelumnya A-111101 masih dipakai transaksi harian.
const sqlTanpaInduk = (kolom = "rek_isheader") =>
  toYmd(new Date()) >= TANGGAL_MULAI_BLOKIR_INDUK ? ` AND ${kolom} = 0` : "";

// Saldo sendiri satu account. Aturan sama dengan Buku Besar:
// baris nourut 0, ditambah semua baris milik jurnal JUR.
const hitungSaldoAkun = async (kode, executor = db) => {
  const [[row]] = await executor.query(
    `SELECT
       (SELECT IFNULL(SUM(jurd_debet - jurd_kredit), 0)
          FROM finance.tjurnalitem
          WHERE jurd_rek_kode = ? AND jurd_nourut = 0)
       +
       (SELECT IFNULL(SUM(i.jurd_debet - i.jurd_kredit), 0)
          FROM finance.tjurnal j
          JOIN finance.tjurnalitem i ON i.jurd_jur_no = j.jur_no
          WHERE j.jur_tipetransaksi = 'JUR' AND i.jurd_nourut <> 0
            AND i.jurd_rek_kode = ?) AS saldo`,
    [kode, kode],
  );
  return Math.round((Number(row.saldo) || 0) * 100) / 100;
};

// Kode akun + seluruh anaknya (bila akun itu induk). Akun biasa → [kode].
const kodeDenganAnak = async (kode, executor = db) => {
  if (!kode) return [kode]; // rek_parent default '' → jangan cocok ke semua akun
  const [rows] = await executor.query(
    `SELECT rek_kode FROM finance.trekening WHERE rek_parent = ?`,
    [kode],
  );
  return [kode, ...rows.map((r) => r.rek_kode)];
};

module.exports = {
  assertBolehPosting,
  isSetelahCutoff,
  sqlTanpaInduk,
  hitungSaldoAkun,
  kodeDenganAnak,
  TANGGAL_MULAI_BLOKIR_INDUK,
};
