const db = require("../../config/database");
const {
  TANGGAL_MULAI_KLAIM,
  semuaRekKlaim,
} = require("./klaimKasKecilKonstanta");

// Tolak ubah BKK/BBK yang sedang terkunci di klaim aktif.
// kkd_kunci bernilai NULL bila klaimnya dibatalkan, jadi hanya klaim aktif yang kena.
const assertBkkBelumDiklaim = async (jurNo, conn = db) => {
  if (!jurNo) return;
  const [[row]] = await conn.query(
    `SELECT kkd_kkh_nomor FROM tklaim_kaskecil_dtl
     WHERE kkd_kunci = ? LIMIT 1`,
    [jurNo],
  );
  if (row)
    throw Object.assign(
      new Error(
        `${jurNo} sudah diklaim di Klaim ${row.kkd_kkh_nomor}. Batalkan klaim itu dulu bila transaksi perlu diubah.`,
      ),
      { status: 400 },
    );
};

// Kas klaim (kas kecil cabang / ATM) diisi ulang hanya lewat Klaim +
// Pengajuan Transfer. Mulai tanggal mulai klaim, rekening itu tidak boleh
// muncul sebagai detail BKK/BBK manual (jalur pengisian kas di luar alur klaim).
const assertTidakKeKasKlaim = (rekKodes, tanggal) => {
  if (!tanggal || String(tanggal).slice(0, 10) < TANGGAL_MULAI_KLAIM) return;
  const rekKlaim = semuaRekKlaim();
  const kena = [...new Set(rekKodes)].filter((k) => rekKlaim.includes(k));
  if (kena.length > 0)
    throw Object.assign(
      new Error(
        `Account ${kena.join(", ")} adalah kas klaim (kas kecil / ATM) yang diisi ulang lewat Klaim. Tidak boleh dipakai sebagai detail BKK/BBK.`,
      ),
      { status: 400 },
    );
};

module.exports = { assertBkkBelumDiklaim, assertTidakKeKasKlaim };
