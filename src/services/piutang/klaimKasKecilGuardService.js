const db = require("../../config/database");
const {
  TANGGAL_MULAI_KLAIM,
  REK_TUJUAN_PER_CABANG,
} = require("./klaimKasKecilKonstanta");

const REK_KAS_KLAIM = Object.values(REK_TUJUAN_PER_CABANG);

// Tolak ubah BKK yang sedang terkunci di klaim aktif.
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
        `BKK ${jurNo} sudah diklaim di Klaim Kas Kecil ${row.kkd_kkh_nomor}. Batalkan klaim itu dulu bila BKK perlu diubah.`,
      ),
      { status: 400 },
    );
};

// Kas kecil cabang terdaftar diisi ulang hanya lewat Klaim Kas Kecil +
// Pengajuan Transfer. Mulai tanggal mulai klaim, rekening itu tidak boleh
// muncul sebagai detail BKK (akan memicu BKM otomatis di luar alur klaim).
const assertTidakKeKasKlaim = (rekKodes, tanggal) => {
  if (!tanggal || String(tanggal).slice(0, 10) < TANGGAL_MULAI_KLAIM) return;
  const kena = [...new Set(rekKodes)].filter((k) => REK_KAS_KLAIM.includes(k));
  if (kena.length > 0)
    throw Object.assign(
      new Error(
        `Account ${kena.join(", ")} adalah kas kecil yang diisi ulang lewat Klaim Kas Kecil. Tidak boleh dipakai sebagai detail BKK.`,
      ),
      { status: 400 },
    );
};

module.exports = { assertBkkBelumDiklaim, assertTidakKeKasKlaim };
