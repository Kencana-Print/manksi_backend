const db = require("../../../config/database");

// ── Default account per cabang ────────────────────────────────────────
// Delphi FormShow: P01→A-111101, P02→A-111102, P04→A-111103
// HO- (kantor pusat) tidak punya default spesifik di Delphi asli —
// tetap fallback ke A-111101 (kas P01) sebagai titik awal browse,
// user tinggal ganti via search
const getDefaultAccount = (cabang) => {
  if (cabang === "P01") return "A-111101";
  if (cabang === "P02") return "A-111102";
  if (cabang === "P04") return "A-111103";
  return "A-111101";
};

// ── Search account ────────────────────────────────────────────────────
// Delphi bantuanreka:
//   P01: rek_kol_id=1 OR rek_kol_id=12
//   HO- (kantor pusat, lihat lintas cabang): tanpa filter cabang, semua account aktif
//   Lainnya: rek_cabang = cabang
const searchAccount = async (cabang, search) => {
  let sql;
  const params = [];

  if (cabang === "P01") {
    sql = `SELECT rek_kode AS kode, rek_nama AS nama
           FROM finance.trekening
           WHERE rek_isaktif = 0
             AND (rek_kol_id = 1 OR rek_kol_id = 12)
           ORDER BY rek_kode`;
  } else if (!cabang || cabang === "HO-" || cabang === "ALL") {
    sql = `SELECT rek_kode AS kode, rek_nama AS nama
           FROM finance.trekening
           WHERE rek_isaktif = 0
           ORDER BY rek_kode`;
  } else {
    sql = `SELECT rek_kode AS kode, rek_nama AS nama
           FROM finance.trekening
           WHERE rek_isaktif = 0
             AND rek_cabang = ?
           ORDER BY rek_kode`;
    params.push(cabang);
  }

  const [rows] = await db.query(sql, params);
  return rows;
};

// ── Validasi account ──────────────────────────────────────────────────
// Delphi edtrekkodeExit: cek apakah kode ada di trekening
const getAccountByKode = async (kode) => {
  const [[row]] = await db.query(
    `SELECT rek_kode AS kode, rek_nama AS nama
     FROM finance.trekening WHERE rek_kode = ?`,
    [kode],
  );
  return row || null;
};

// ── Buku Besar ────────────────────────────────────────────────────────
// Delphi btnRefreshClick — dua langkah:
//   1. Hitung saldo awal: SUM(jurd_kredit - jurd_debet) sebelum startDate
//   2. Query transaksi periode + hitung running saldo di Node.js
//
// ── FIX Jurnal Umum (JUR) tidak masuk Buku Besar ──────────────────────
// Root cause: jurnalUmumFormService.js memberi jurd_nourut mulai dari 1
// untuk SEMUA baris (tidak ada baris "header" ber-nourut=0), padahal
// query ini dari awal hanya mengambil baris ber-jurd_nourut=0 sebagai
// posting utama suatu akun (pola BKM/BKK/BBM/BBK: 1 akun Kas/Bank jadi
// header di nourut=0, akun lawan di nourut=1,2,3...). Karena Jurnal
// Umum tidak punya konsep "akun header" (tiap baris setara, punya
// Debet DAN Kredit sendiri), solusinya BUKAN mengubah nourut di
// form-nya (itu bisa merusak constraint/urutan tampilan detail), tapi
// melonggarkan filter di sini: untuk transaksi bertipe 'JUR', anggap
// SEMUA baris (berapapun nourut-nya) sebagai posting utama yang valid
// untuk akun yang bersangkutan.
//
// Konsekuensi ikutan yang diantisipasi:
//   - Debet/Kredit JUR diambil LANGSUNG dari nilai baris itu sendiri
//     (b.jurd_debet/b.jurd_kredit) — sama seperti pola jur_otomatis=1
//     — BUKAN dari "tarik nilai baris lawan" seperti BKM/BKK, karena
//     JUR bisa multi-baris (bukan cuma 1 lawan), jadi tidak ada satu
//     "lawan" tunggal yang bisa dipakai.
//   - Join ke tabel lawan (c) SENGAJA diblok untuk transaksi JUR
//     (kondisi `a.jur_tipetransaksi <> 'JUR'` di ON clause), supaya
//     tidak terjadi cartesian join yang menduplikasi baris/nominal
//     saat satu transaksi JUR punya lebih dari 2 baris.
//   - Keterangan diambil dari uraian baris itu sendiri (b.jurd_uraian)
//     sebagai fallback ketika tidak ada baris lawan (c NULL) — Jurnal
//     Umum memang punya uraian per baris, jadi ini pas.
const getBukuBesar = async (rekkode, startDate, endDate) => {
  // ── Step 1: Saldo Awal ─────────────────────────────────────────────
  const [[saldoRow]] = await db.query(
    `SELECT IFNULL(SUM(b.jurd_debet - b.jurd_kredit), 0) AS Saldo
     FROM finance.tjurnalitem b
     LEFT JOIN finance.tjurnal a ON a.jur_no = b.jurd_jur_no
     WHERE (b.jurd_nourut = 0 OR a.jur_tipetransaksi = 'JUR')
       AND b.jurd_rek_kode = ?
       AND a.jur_tanggal < ?`,
    [rekkode, startDate],
  );
  let xsaldo = Number(saldoRow.Saldo) || 0;

  // ── Step 2: Transaksi periode ──────────────────────────────────────
  const [rows] = await db.query(
    `SELECT
       DATE_FORMAT(a.jur_tanggal, '%Y-%m-%d')    AS Tanggal,
       IF(a.jur_otomatis = 0 OR a.jur_otomatis = 2,
         a.jur_no,
         MID(a.jur_no, 3, 18)
       )                                         AS Nomor,
       a.jur_tipetransaksi                       AS Trs,
       IFNULL(a.jur_nota, '')                    AS Nota,
       IFNULL(a.jur_penerima, '')                AS Penerima,
       -- Keterangan: pakai baris lawan (c) bila ada, jatuh ke uraian
       -- baris sendiri (b) bila tidak ada lawan (selalu terjadi untuk JUR)
       IFNULL(IFNULL(c.jurd_uraian, b.jurd_uraian), '') AS Keterangan,
       -- Debet/Kredit: transaksi otomatis DAN Jurnal Umum sama-sama
       -- pakai nilai baris itu sendiri (tidak menarik dari baris lawan)
       IF(a.jur_otomatis = 1 OR a.jur_tipetransaksi = 'JUR',
         b.jurd_debet,
         IF(c.jurd_kredit <> 0, c.jurd_kredit, 0)
       )                                         AS Debet,
       IF(a.jur_otomatis = 1 OR a.jur_tipetransaksi = 'JUR',
         b.jurd_kredit,
         IF(c.jurd_debet <> 0, c.jurd_debet, 0)
       )                                         AS Kredit,
       IFNULL(c.jurd_rek_kode, '')               AS Account,
       IFNULL(c.rek_nama, '')                    AS NamaAccount,
       DATE_FORMAT(
         IFNULL(t.tanggal, s.sh_tgltransfer),
         '%Y-%m-%d'
       )                                         AS TglTransfer
     FROM finance.tjurnalitem b
     LEFT JOIN finance.tjurnal a ON a.jur_no = b.jurd_jur_no

     LEFT JOIN (
       SELECT nomor, MAX(tanggal) AS tanggal
       FROM terima_bayar_debet
       GROUP BY nomor
     ) t ON t.nomor = a.jur_nomor
     LEFT JOIN (
       SELECT sh_nomor, MAX(sh_tgltransfer) AS sh_tgltransfer
       FROM retail.tsetor_hdr
       GROUP BY sh_nomor
     ) s ON s.sh_nomor = a.jur_nomor
     LEFT JOIN (
       SELECT kode, MAX(nourut) AS nourut
       FROM finance.ttrs
       GROUP BY kode
     ) v ON v.kode = a.jur_tipetransaksi

     -- Baris lawan — SENGAJA tidak match untuk transaksi JUR
     -- (a.jur_tipetransaksi <> 'JUR'), agar tidak terjadi cartesian
     -- join yang menduplikasi baris pada JUR multi-baris.
     LEFT JOIN (
       SELECT
         x.jurd_jur_no,
         x.jurd_nourut,
         x.jurd_rek_kode,
         y.rek_nama,
         x.jurd_debet,
         x.jurd_kredit,
         x.jurd_uraian
       FROM finance.tjurnalitem x
       LEFT JOIN finance.trekening y ON y.rek_kode = x.jurd_rek_kode
       WHERE x.jurd_nourut <> 0
     ) c ON c.jurd_jur_no = b.jurd_jur_no
        AND (a.jur_tipetransaksi IS NULL OR a.jur_tipetransaksi <> 'JUR')

     WHERE (b.jurd_nourut = 0 OR a.jur_tipetransaksi = 'JUR')
       AND b.jurd_rek_kode = ?
       AND a.jur_tanggal BETWEEN ? AND ?
     ORDER BY a.jur_tanggal, v.nourut, a.jur_no`,
    [rekkode, startDate, endDate],
  );

  // ── Step 3: Hitung running saldo ────────────────────────────────────
  const result = [];
  let rowId = 1;

  result.push({
    id: rowId++,
    Tanggal: startDate,
    Nomor: "",
    Trs: "",
    Nota: "",
    Penerima: "",
    Keterangan: "Saldo Awal",
    Debet: 0,
    Kredit: 0,
    Saldo: xsaldo,
    Account: "",
    NamaAccount: "",
    TglTransfer: null,
  });

  for (const row of rows) {
    xsaldo = xsaldo + Number(row.Debet) - Number(row.Kredit);
    result.push({
      id: rowId++,
      Tanggal: row.Tanggal,
      Nomor: row.Nomor,
      Trs: row.Trs,
      Nota: row.Nota,
      Penerima: row.Penerima,
      Keterangan: row.Keterangan,
      Debet: Number(row.Debet),
      Kredit: Number(row.Kredit),
      Saldo: xsaldo,
      Account: row.Account,
      NamaAccount: row.NamaAccount,
      TglTransfer: row.TglTransfer,
    });
  }

  return result;
};

module.exports = {
  getDefaultAccount,
  searchAccount,
  getAccountByKode,
  getBukuBesar,
};
