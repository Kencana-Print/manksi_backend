const db = require("../../config/database");

// ═══════════════════════════════════════════════════════════
// PRA SURAT JALAN — FORM SERVICE
// Migrasi dari ufrmPraSJ.pas (Delphi)
// CATATAN: modul ini TIDAK punya konsep tutup buku/PIN5 sama sekali.
// Nomor generation TIDAK per-perusahaan (fixed prefix 'PRASJ'+YY).
// ═══════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────
// GENERATE NOMOR — Format: PRASJ{YY}{NNNNN}
// Sesuai Delphi getmaxnomor — prefix FIXED, bukan per perusahaan.
// ─────────────────────────────────────────────────────────
const generateNomor = async (tanggal, conn) => {
  const tahunYY = String(new Date(tanggal).getFullYear()).slice(-2);
  const prefix = `PRASJ${tahunYY}`;

  const [[row]] = await conn.query(
    `SELECT IFNULL(MAX(CAST(RIGHT(sj_pra,5) AS UNSIGNED)),0) AS max_val
     FROM tprasj_hdr
     WHERE LEFT(sj_pra,7) = ?
     FOR UPDATE`,
    [prefix],
  );
  const next = parseInt(row.max_val, 10) + 1;
  return `${prefix}${String(next).padStart(5, "0")}`;
};

// ─────────────────────────────────────────────────────────
// HELPER — sesuai 4 fungsi Delphi: getsudahprasj, getsudahsj,
// getsudahsizeprasj, getsudahsizesj
// ─────────────────────────────────────────────────────────
const getSudahPraSj = async (kode, currentPraSj = "") => {
  const [[row]] = await db.query(
    `SELECT IFNULL(SUM(d.sjd_jumlah),0) AS jml FROM tprasj_dtl d
     INNER JOIN tprasj_hdr h ON h.sj_pra = d.sjd_pra
     WHERE d.sjd_spk_nomor = ? AND d.sjd_pra <> ?`,
    [kode, currentPraSj],
  );
  return Number(row.jml) || 0;
};

const getSudahSj = async (kode) => {
  const [[row]] = await db.query(
    `SELECT IFNULL(SUM(d.sjd_jumlah),0) AS jml FROM tsj_dtl d
     INNER JOIN tsj_hdr h ON h.sj_nomor = d.sjd_sj_nomor
     WHERE h.sj_status_otomatis = 0 AND d.sjd_spk_nomor = ?`,
    [kode],
  );
  return Number(row.jml) || 0;
};

const getSudahSizePraSj = async (kode, size, currentPraSj = "") => {
  const [[row]] = await db.query(
    `SELECT IFNULL(SUM(d.sjd_jumlah),0) AS jml FROM tprasj_dtl d
     INNER JOIN tprasj_hdr h ON h.sj_pra = d.sjd_pra
     WHERE d.sjd_spk_nomor = ? AND d.sjd_ukuran = ? AND d.sjd_pra <> ?`,
    [kode, size, currentPraSj],
  );
  return Number(row.jml) || 0;
};

const getSudahSizeSj = async (kode, size) => {
  const [[row]] = await db.query(
    `SELECT IFNULL(SUM(d.sjd_jumlah),0) AS jml FROM tsj_dtl d
     INNER JOIN tsj_hdr h ON h.sj_nomor = d.sjd_sj_nomor
     WHERE h.sj_status_otomatis = 0 AND d.sjd_spk_nomor = ? AND d.sjd_ukuran = ?`,
    [kode, size],
  );
  return Number(row.jml) || 0;
};

// ─────────────────────────────────────────────────────────
// GET DETAIL SO (F1 di grid) — sesuai Delphi loadkode()
// Sudah dijembatani SO -> SPK PPIC turunan, karena sjd_spk_nomor yang
// tersimpan di sini akan disalin MENTAH ke tsj_dtl.sjd_spk_nomor saat
// nanti dikonversi jadi SJ (lihat ufrmPraSJ2 btnCreateClick) — jadi
// WAJIB nomor turunan, bukan SO, persis seperti SJ form.
// ─────────────────────────────────────────────────────────
const getDetailSo = async (
  soNomor,
  cusKode,
  divisi,
  currentPraSj = "",
  existingRows = [],
) => {
  // 1. Validasi SO
  const [[soRow]] = await db.query(
    `SELECT spk_nomor, spk_cmo FROM tspk
     WHERE spk_aktif = 'Y' AND spk_nomor = ? AND spk_cus_kode = ? AND spk_is_so = 1`,
    [soNomor, cusKode],
  );
  if (!soRow) throw new Error("SO Tidak ditemukan di Customer tsb.");
  if (!soRow.spk_cmo) throw new Error("SO tsb belum di Approve oleh CMO.");

  // 2. Jembatani ke SPK PPIC turunan
  const [[turunan]] = await db.query(
    `SELECT spk_nomor FROM tspk
     WHERE spk_so_ref = ? AND spk_is_so = 0 AND spk_aktif = 'Y'`,
    [soNomor],
  );
  if (!turunan) {
    throw new Error(
      "SPK PPIC untuk SO ini belum dibuat. Silahkan buat SPK PPIC terlebih dahulu sebelum membuat Pra Surat Jalan.",
    );
  }
  const spkNomor = turunan.spk_nomor;
  const divisiStr = String(divisi).charAt(0);
  const isSizeDivisi = divisiStr === "3" || divisiStr === "4";

  // 3. Cek tspk_size
  const [[sizeCheck]] = await db.query(
    `SELECT COUNT(*) AS cnt FROM tspk_size WHERE spks_nomor = ?`,
    [spkNomor],
  );

  const rows = [];

  if (sizeCheck.cnt > 0) {
    // SPK baru — per size. Duplikat di sini di-SKIP DIAM-DIAM (sesuai
    // Delphi — tidak ada pesan warning di cabang ini).
    const [sizes] = await db.query(
      `SELECT z.spks_size, z.spks_qty, s.spk_nama, s.spk_ukuran
       FROM tspk_size z
       INNER JOIN tspk s ON s.spk_nomor = z.spks_nomor
       WHERE z.spks_nomor = ?`,
      [spkNomor],
    );
    for (const r of sizes) {
      const ukuran = isSizeDivisi ? r.spks_size : r.spk_ukuran;
      const dup = existingRows.find(
        (er) => er.Kode === spkNomor && er.Ukuran === ukuran,
      );
      if (dup) continue; // silent skip — sesuai Delphi

      const pra = await getSudahSizePraSj(spkNomor, r.spks_size, currentPraSj);
      const sudah = await getSudahSizeSj(spkNomor, r.spks_size);
      rows.push({
        Kode: spkNomor,
        Nama: r.spk_nama,
        Ukuran: ukuran,
        Jumlah: 0,
        Koli: 0,
        Pra: pra,
        Sudah: sudah,
        Kurang: r.spks_qty - (pra + sudah),
        Keterangan: "",
      });
    }
  } else {
    // SPK lama — 1 row. Duplikat di sini WAJIB error (sesuai Delphi).
    const dup = existingRows.find((er) => er.Kode === spkNomor);
    if (dup) {
      const idx = existingRows.indexOf(dup);
      throw new Error(`SO tsb sudah di input, di baris ${idx + 1}.`);
    }

    const [[info]] = await db.query(
      `SELECT spk_nomor, spk_nama2, spk_ukuran, spk_jumlah
       FROM tspk WHERE spk_aktif = 'Y' AND spk_nomor = ?`,
      [spkNomor],
    );
    if (!info) throw new Error("SO tidak ditemukan.");

    const ukuran = isSizeDivisi ? "" : info.spk_ukuran;
    const pra = await getSudahPraSj(spkNomor, currentPraSj);
    const sudah = await getSudahSj(spkNomor);
    rows.push({
      Kode: spkNomor,
      Nama: info.spk_nama2,
      Ukuran: ukuran,
      Jumlah: 0,
      Koli: 0,
      Pra: pra,
      Sudah: sudah,
      Kurang: info.spk_jumlah - (pra + sudah),
      Keterangan: "",
    });
  }

  return rows;
};

// ─────────────────────────────────────────────────────────
// GET BY NOMOR (load edit) — sesuai Delphi loaddataall
// ─────────────────────────────────────────────────────────
const getById = async (praSj) => {
  const [[hdr]] = await db.query(
    `SELECT
       h.sj_pra, DATE_FORMAT(h.sj_tanggal,'%Y-%m-%d') AS sj_tanggal,
       h.sj_divisi, h.sj_keterangan,
       h.sj_perush_kode, p.perush_nama,
       h.sj_cus_kode, c.cus_nama, c.cus_alamat, c.cus_kota,
       h.sj_alamat_customer, h.sj_kota_customer,
       h.sj_gdg_kode, g.gdg_nama,
       h.sj_sj
     FROM tprasj_hdr h
     INNER JOIN tperusahaan p ON p.perush_kode = h.sj_perush_kode
     INNER JOIN tcustomer c ON c.cus_kode = h.sj_cus_kode
     LEFT JOIN tgudang g ON g.gdg_kode = h.sj_gdg_kode
     WHERE h.sj_pra = ?`,
    [praSj],
  );
  if (!hdr) throw new Error("Nomor tersebut belum ada.");

  const [dtl] = await db.query(
    `SELECT
       d.sjd_spk_nomor, d.sjd_ukuran, d.sjd_jumlah, d.sjd_koli,
       d.sjd_keterangan, d.sjd_nourut,
       IFNULL(s.spk_nama2, s.spk_nama) AS nama_barang,
       s.spk_jumlah,
       IFNULL(z.spks_qty, 0) AS qtyorder,
       IFNULL(z.spks_size, '') AS size
     FROM tprasj_dtl d
     LEFT JOIN tspk s ON s.spk_nomor = d.sjd_spk_nomor
     LEFT JOIN tspk_size z
       ON z.spks_nomor = d.sjd_spk_nomor AND z.spks_size = d.sjd_ukuran
     WHERE d.sjd_pra = ?
     ORDER BY d.sjd_nourut`,
    [praSj],
  );

  for (const row of dtl) {
    if (row.size) {
      row.pra = await getSudahSizePraSj(
        row.sjd_spk_nomor,
        row.sjd_ukuran,
        praSj,
      );
      row.sudah = await getSudahSizeSj(row.sjd_spk_nomor, row.sjd_ukuran);
      row.kurang = row.qtyorder - (row.pra + row.sudah);
    } else {
      row.pra = await getSudahPraSj(row.sjd_spk_nomor, praSj);
      row.sudah = await getSudahSj(row.sjd_spk_nomor);
      row.kurang = row.spk_jumlah - (row.pra + row.sudah);
    }
  }

  return { header: hdr, detail: dtl };
};

// ─────────────────────────────────────────────────────────
// SEARCH PERUSAHAAN
// ─────────────────────────────────────────────────────────
const searchPerusahaan = async (q = "") => {
  const like = `%${q}%`;
  const [rows] = await db.query(
    `SELECT perush_kode, perush_nama
     FROM tperusahaan
     WHERE perush_kode LIKE ? OR perush_nama LIKE ?
     ORDER BY perush_kode
     LIMIT 50`,
    [like, like],
  );
  return rows;
};

// ─────────────────────────────────────────────────────────
// CUSTOMER INFO — sesuai Delphi edtCusKodeExit
// ─────────────────────────────────────────────────────────
const getCustomerInfo = async (kode) => {
  const [[row]] = await db.query(
    `SELECT cus_kode, cus_nama, cus_alamat, cus_kota, cus_aktif
     FROM tcustomer WHERE cus_kode = ?`,
    [kode],
  );
  if (!row) throw new Error("Kode tidak ditemukan.");
  if (row.cus_aktif === 1) throw new Error("Customer tsb Status nya pasif.");
  return row;
};

// ─────────────────────────────────────────────────────────
// ALOKASI HISTORY — sesuai Delphi btnalokasiClick, TAPI DIPERBAIKI.
// Delphi asli filter join-nya salah (INNER JOIN tcustomer ON cus_kode=
// [cusKode] tanpa mengaitkan ke sj_cus_kode milik baris tprasj_hdr),
// sehingga menampilkan alamat/kota dari SEMUA customer, bukan cuma
// histori customer yang dipilih. Di sini difilter dengan benar.
// CATATAN: pola bug yang identik ditemukan juga di
// suratJalanFormService.getAlokasiHistory — kemungkinan perlu fix sama.
// ─────────────────────────────────────────────────────────
const getAlokasiHistory = async (cusKode) => {
  const [rows] = await db.query(
    `SELECT DISTINCT h.sj_alamat_customer AS Alamat, h.sj_kota_customer AS Kota
     FROM tprasj_hdr h
     WHERE h.sj_cus_kode = ? AND h.sj_alamat_customer <> ''
     ORDER BY h.sj_alamat_customer`,
    [cusKode],
  );
  return rows;
};

// ─────────────────────────────────────────────────────────
// GET DIVISI LIST
// ─────────────────────────────────────────────────────────
const getDivisiList = async () => {
  const [rows] = await db.query(
    `SELECT kode, divisi AS nama FROM tdivisi WHERE kode <> 0 ORDER BY kode`,
  );
  return rows;
};

// ─────────────────────────────────────────────────────────
// SAVE — sesuai Delphi simpandata + validasi VK_F10
// ─────────────────────────────────────────────────────────
const save = async (data, userKode, isNew) => {
  const {
    Divisi,
    Tanggal,
    Keterangan,
    KodePerush,
    KodeCus,
    GudangKode,
    AlamatCus,
    KotaCus,
    Detail = [],
    NomorPra = "",
  } = data;

  // ── Validasi dasar — sesuai Delphi VK_F10 ───────────────
  if (!KodePerush) throw new Error("Perusahaan belum di isi.");
  if (!GudangKode) throw new Error("Gudang tidak boleh kosong.");
  if (!KodeCus) throw new Error("Customer belum di isi.");

  const validDetail = Detail.filter((r) => r.Nama && Number(r.Jumlah) !== 0);
  if (!validDetail.length) throw new Error("Detail harus diisi.");

  for (const row of validDetail) {
    if (Number(row.Jumlah) > Number(row.Kurang)) {
      throw new Error(
        `Jumlah tidak boleh melebihi kekurangannya (SO: ${row.Kode}).`,
      );
    }
  }

  const totalJumlah = validDetail.reduce((s, r) => s + Number(r.Jumlah), 0);
  if (totalJumlah === 0) throw new Error("Jumlah SJ masih kosong semua.");

  // ── Defense-in-depth: cek sudah jadi SJ — sesuai cxButton1Click browse
  if (!isNew) {
    const [[existing]] = await db.query(
      `SELECT sj_sj FROM tprasj_hdr WHERE sj_pra = ?`,
      [NomorPra],
    );
    if (existing?.sj_sj) {
      throw new Error("Sudah jadi Surat jalan.\nTidak bisa diUbah.");
    }
  }

  const divisiStr = String(Divisi).charAt(0);

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    let nomor = isNew ? await generateNomor(Tanggal, conn) : NomorPra;

    if (isNew) {
      await conn.query(
        `INSERT INTO tprasj_hdr
           (sj_pra, sj_divisi, sj_tanggal, sj_keterangan,
            sj_perush_kode, sj_cus_kode, sj_gdg_kode,
            sj_alamat_customer, sj_kota_customer, date_create, user_create)
         VALUES (?,?,?,?,?,?,?,?,?,NOW(),?)`,
        [
          nomor,
          divisiStr,
          Tanggal,
          Keterangan,
          KodePerush,
          KodeCus,
          GudangKode,
          AlamatCus,
          KotaCus,
          userKode,
        ],
      );
    } else {
      await conn.query(
        `UPDATE tprasj_hdr SET
           sj_tanggal = ?, sj_keterangan = ?,
           sj_perush_kode = ?, sj_cus_kode = ?, sj_gdg_kode = ?,
           sj_alamat_customer = ?, sj_kota_customer = ?,
           date_modified = NOW(), user_modified = ?
         WHERE sj_pra = ?`,
        [
          Tanggal,
          Keterangan,
          KodePerush,
          KodeCus,
          GudangKode,
          AlamatCus,
          KotaCus,
          userKode,
          nomor,
        ],
      );
    }

    await conn.query(`DELETE FROM tprasj_dtl WHERE sjd_pra = ?`, [nomor]);
    let urut = 1;
    for (const row of validDetail) {
      await conn.query(
        `INSERT INTO tprasj_dtl
           (sjd_pra, sjd_spk_nomor, sjd_jumlah, sjd_koli, sjd_ukuran, sjd_keterangan, sjd_nourut)
         VALUES (?,?,?,?,?,?,?)`,
        [
          nomor,
          row.Kode,
          Number(row.Jumlah),
          Number(row.Koli || 0),
          row.Ukuran || "",
          row.Keterangan || "",
          urut,
        ],
      );
      urut++;
    }

    await conn.commit();
    return { nomor };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
};

module.exports = {
  generateNomor,
  getSudahPraSj,
  getSudahSj,
  getSudahSizePraSj,
  getSudahSizeSj,
  getDetailSo,
  getById,
  searchPerusahaan,
  getCustomerInfo,
  getAlokasiHistory,
  getDivisiList,
  save,
};
