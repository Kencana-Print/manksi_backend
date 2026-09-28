const db = require("../../config/database");
const tutupBukuService = require("../tutupBukuService");

// ── Account header (rekening bank — rek_rekening<>"" AND rek_jp=0) ────
const getAccountOptions = async () => {
  const [rows] = await db.query(`
    SELECT rek_kode AS kode, rek_nama AS nama, rek_rekening AS rekening
    FROM finance.trekening
    WHERE rek_rekening <> '' AND rek_jp = 0 AND rek_isaktif = 0
    ORDER BY rek_kode
  `);
  return rows;
};

// ── Supplier search ───────────────────────────────────────────────────
const getSupplierOptions = async (search = "") => {
  const [rows] = await db.query(
    `
    SELECT sup_kode AS kode, sup_nama AS nama
    FROM tsupplier
    WHERE sup_aktif = 'Y'
      AND (sup_nama LIKE ? OR sup_kode LIKE ?)
    ORDER BY sup_nama 
  `,
    [`%${search}%`, `%${search}%`],
  );
  return rows;
};

// ── Supplier detail (bank/rekening per supplier) ──────────────────────
const getSupplierDetail = async (kode) => {
  const [rows] = await db.query(
    `
    SELECT a.sup_kode AS kode, a.sup_nama AS nama,
      b.supd_bank AS bank, b.supd_rekening AS rekening,
      b.supd_atasnama AS atasnama
    FROM tsupplier a
    LEFT JOIN tsupplieritem b ON b.supd_kode = a.sup_kode
    WHERE a.sup_aktif = 'Y' AND a.sup_kode = ?
    ORDER BY b.supd_bank
  `,
    [kode],
  );
  return rows;
};

// ── Voucher pembayaran (F2) ───────────────────────────────────────────
// Delphi: voucher belum ada di bayar_debet_detail
const getVoucherOptions = async (search = "") => {
  const [rows] = await db.query(
    `
    SELECT h.vou_nomor AS nomor,
      DATE_FORMAT(h.vou_tanggal,'%Y-%m-%d') AS tanggal,
      s.sup_nama AS supplier,
      h.vou_total - IFNULL((
        SELECT SUM(voud2_harga * voud2_jumlah)
        FROM tvoucher_dtl2
        WHERE voud2_vou_nomor = h.vou_nomor
      ), 0) AS nominal
    FROM tvoucher_hdr h
    INNER JOIN tsupplier s ON s.sup_kode = h.vou_sup_kode
    WHERE h.vou_nomor NOT IN (
      SELECT b.vou_nomor FROM bayar_debet_detail b
    )
    AND (h.vou_nomor LIKE ? OR s.sup_nama LIKE ?)
    ORDER BY h.vou_nomor DESC 
  `,
    [`%${search}%`, `%${search}%`],
  );
  return rows;
};

// ── PO External (F3) ─────────────────────────────────────────────────
const getPoExternalOptions = async (search = "") => {
  const [rows] = await db.query(
    `
    SELECT x.Nomor AS nomor,
      DATE_FORMAT(x.Tanggal,'%Y-%m-%d') AS tanggal,
      x.SPK AS spk,
      x.Supplier AS supplier,
      (x.Nominal - x.DP - x.Voucher) AS nominal
    FROM (
      SELECT h.poe_nomor AS Nomor, h.poe_tanggal AS Tanggal,
        h.poe_spk_nomor AS SPK, u.sup_nama AS Supplier,
        h.poe_total AS Nominal,
        IFNULL((SELECT SUM(c.poed2_nominal) FROM tpoexternal_dtl2 c
                WHERE c.poed2_nomor = h.poe_nomor), 0) AS DP,
        IFNULL((SELECT SUM(v.voud_total) FROM tvoucher_dtl v
                WHERE v.voud_nota = h.poe_nomor), 0) AS Voucher
      FROM tpoexternal_hdr h
      LEFT JOIN tsupplier u ON u.sup_kode = h.poe_sup
    ) x
    WHERE (x.Nominal - x.DP - x.Voucher) > 0
      AND (x.Nomor LIKE ? OR x.Supplier LIKE ? OR x.SPK LIKE ?)
    ORDER BY x.Nomor 
  `,
    [`%${search}%`, `%${search}%`, `%${search}%`],
  );
  return rows;
};

// ── Petty Cash (F4) ───────────────────────────────────────────────────
const getPettyCashOptions = async (search = "") => {
  const [rows] = await db.query(
    `
    SELECT h.pck_nomor AS nomor,
      DATE_FORMAT(h.pck_tanggal,'%Y-%m-%d') AS tanggal,
      h.pck_cab AS store,
      g.gdg_nama AS namaStore,
      h.pck_total AS nominal
    FROM retail.tpettycash_klaim_hdr h
    LEFT JOIN retail.tgudang g ON g.gdg_kode = h.pck_cab
    WHERE h.pck_nomor NOT IN (
      SELECT d.ptd_trs FROM finance.tpengajuan_transfer_dtl d
      WHERE d.ptd_trs <> ''
    )
    AND EXISTS (
      SELECT 1 FROM retail.tpettycash_hdr pc
      WHERE pc.pck_nomor = h.pck_nomor 
      AND pc.pc_status = 'ACC'
    )
    AND (h.pck_nomor LIKE ? OR h.pck_cab LIKE ?)
    ORDER BY h.pck_nomor 
  `,
    [`%${search}%`, `%${search}%`],
  );
  return rows;
};

// ── BKK (F1) — cari nomor BKK yang mau dipanggil ke Pengajuan Transfer.
// Exclude BKK yang sudah pernah dipakai sebagai No. Transaksi di
// Pengajuan Transfer manapun (pola exclude sama dengan Petty Cash di atas).
const getBkkOptions = async (search = "") => {
  const [rows] = await db.query(
    `
    SELECT h.jur_no AS nomor,
      DATE_FORMAT(h.jur_tanggal,'%Y-%m-%d') AS tanggal,
      h.jur_penerima AS penerima,
      h.jur_keterangan AS keterangan,
      IFNULL((
        SELECT SUM(jurd_kredit) FROM finance.tjurnalitem
        WHERE jurd_jur_no = h.jur_no
      ), 0) AS nominal
    FROM finance.tjurnal h
    WHERE h.jur_tipetransaksi = 'BKK'
      AND h.jur_no NOT IN (
        SELECT d.ptd_trs FROM finance.tpengajuan_transfer_dtl d
        WHERE d.ptd_trs <> ''
      )
      AND (h.jur_no LIKE ? OR h.jur_penerima LIKE ? OR h.jur_keterangan LIKE ?)
    ORDER BY h.jur_no DESC
  `,
    [`%${search}%`, `%${search}%`, `%${search}%`],
  );
  return rows.map((r) => ({ ...r, nominal: Number(r.nominal) }));
};

const getAccountAll = async (search = "") => {
  const [rows] = await db.query(
    `
    SELECT rek_kode AS kode, rek_nama AS nama, rek_cabang AS cabang
    FROM finance.trekening
    WHERE rek_isaktif = 0
      AND (rek_kode LIKE ? OR rek_nama LIKE ?)
    ORDER BY rek_kode LIMIT 500
  `,
    [`%${search}%`, `%${search}%`],
  );
  return rows;
};

const getCostCenterOptions = async (search = "") => {
  const [rows] = await db.query(
    `
    SELECT cc_kode AS kode, cc_nama AS nama
    FROM finance.tcostcenter
    WHERE cc_nama LIKE ? OR cc_kode LIKE ?
    ORDER BY cc_nama LIMIT 200
  `,
    [`%${search}%`, `%${search}%`],
  );
  return rows;
};

const getDcOptions = async (cckode, search = "") => {
  const [rows] = await db.query(
    `
    SELECT dc_kode AS kode, dc_nama AS nama
    FROM finance.tcostcenteritem
    WHERE dc_kode = ?
      AND (dc_nama LIKE ? OR dc_kode LIKE ?)
    ORDER BY dc_nama
  `,
    [cckode, `%${search}%`, `%${search}%`],
  );
  return rows;
};

// ── Load form edit ────────────────────────────────────────────────────
const getDetailForm = async (nomor) => {
  const [rows] = await db.query(
    `
    SELECT h.pth_nomor, DATE_FORMAT(h.pth_tanggal,'%Y-%m-%d') AS pth_tanggal,
      h.pth_rek_kode, h.pth_byrvoucher,
      r.rek_nama, r.rek_rekening,
      d.ptd_nourut, d.ptd_sup_kode, s.sup_nama,
      d.ptd_bank, d.ptd_rekening, d.ptd_atasnama,
      d.ptd_trs, d.ptd_nominal, d.ptd_ket,
      DATE_FORMAT(d.ptd_realisasi,'%Y-%m-%d') AS ptd_realisasi,
      d.ptd_akun, k.rek_nama AS akunnama,
      d.ptd_cc_kode, c.cc_nama,
      d.ptd_dc_nama, d.ptd_jur_no, d.ptd_batal
    FROM finance.tpengajuan_transfer_hdr h
    INNER JOIN finance.tpengajuan_transfer_dtl d ON d.ptd_nomor = h.pth_nomor
    LEFT JOIN finance.trekening r ON r.rek_kode = h.pth_rek_kode
    LEFT JOIN tsupplier s ON s.sup_kode = d.ptd_sup_kode
    LEFT JOIN finance.trekening k ON k.rek_kode = d.ptd_akun
    LEFT JOIN finance.tcostcenter c ON c.cc_kode = d.ptd_cc_kode
    WHERE h.pth_nomor = ?
    ORDER BY d.ptd_nourut
  `,
    [nomor],
  );

  if (rows.length === 0)
    throw new Error("Nomor Pengajuan Transfer tersebut belum ada.");

  const h = rows[0];
  const detail = rows
    .filter((r) => r.sup_nama || r.ptd_nominal)
    .map((r) => ({
      nourut: r.ptd_nourut,
      kode: r.ptd_sup_kode || "",
      nama: r.sup_nama || "",
      bank: r.ptd_bank || "",
      rekening: r.ptd_rekening || "",
      atasnama: r.ptd_atasnama || "",
      trs: r.ptd_trs || "",
      nominal: Number(r.ptd_nominal) || 0,
      ket: r.ptd_ket || "",
      tglRealisasi: r.ptd_realisasi || "",
      rekkode: r.ptd_akun || "",
      reknama: r.akunnama || "",
      cckode: r.ptd_cc_kode || 0,
      ccnama: r.cc_nama || "",
      dcnama: r.ptd_dc_nama || "",
      dckode: r.ptd_cc_kode || 0,
      jurnal: r.ptd_jur_no || "",
      batal: r.ptd_batal || "",
    }));

  return {
    nomor: h.pth_nomor,
    tanggal: h.pth_tanggal,
    rek_kode: h.pth_rek_kode,
    rek_nama: h.rek_nama || "",
    rek_rekening: h.rek_rekening || "",
    byrvoucher: h.pth_byrvoucher || "",
    detail,
  };
};

// ── Generate nomor — hardcode P01, sesuai referensi (lihat catatan
// di bawah module.exports) ──
const getMaxNomor = async (conn) => {
  const prefix = `P01-PJT.${new Date().getFullYear()}.`;
  const [[row]] = await (conn || db).query(
    `
    SELECT IFNULL(MAX(CAST(RIGHT(pth_nomor,5) AS UNSIGNED)),0) AS max_val
    FROM finance.tpengajuan_transfer_hdr WHERE pth_nomor LIKE ?
  `,
    [`${prefix}%`],
  );
  return `${prefix}${String(Number(row.max_val) + 1).padStart(5, "0")}`;
};

// ── Generate nomor BBK jurnal ─────────────────────────────────────────
// Delphi getjurnal: P01-BBK.YYYY.NNNNN
const getJurnalNomor = async (conn, noj) => {
  const prefix = `P01-BBK.${new Date().getFullYear()}.`;
  const [[row]] = await (conn || db).query(
    `
    SELECT IFNULL(MAX(CAST(RIGHT(jur_no,5) AS UNSIGNED)),0) AS max_val
    FROM finance.tjurnal WHERE jur_no LIKE ?
  `,
    [`${prefix}%`],
  );
  return `${prefix}${String(Number(row.max_val) + noj).padStart(5, "0")}`;
};

// ── Generate voucher nomor ────────────────────────────────────────────
const getVoucherNomor = async (tanggal, conn) => {
  const yy = new Date(tanggal).getFullYear().toString().slice(-2);
  const prefix = `BYR/BT/${yy}`;
  const [[row]] = await (conn || db).query(
    `
    SELECT IFNULL(MAX(CAST(RIGHT(nomor,5) AS UNSIGNED)),0) AS max_val
    FROM bayar_debet WHERE LEFT(nomor,9) = ?
  `,
    [prefix],
  );
  return `${prefix}${String(Number(row.max_val) + 1).padStart(5, "0")}`;
};

// ── Cek tutup buku — pola sama dengan pengajuanTransferService.js ─────
const cekIsTutupBuku = async (tanggal) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const limitDate =
    await tutupBukuService.getTanggalTutupBukuUntukTanggal(tanggal);
  limitDate.setHours(0, 0, 0, 0);

  const zCloseManual = await tutupBukuService.getManualTutupBuku("PJT");
  const tgl = new Date(tanggal);

  if (zCloseManual) {
    zCloseManual.setHours(0, 0, 0, 0);
    return tgl < zCloseManual;
  }
  return limitDate < today;
};

// ── Simpan (mode baru/edit — bukan realisasi) ─────────────────────────
const saveData = async (payload, user) => {
  const { isEdit, isRealisasi, nomor, tanggal, rek_kode, detail } = payload;

  if (await cekIsTutupBuku(tanggal)) {
    throw new Error("Periode sudah ditutup. Tidak bisa disimpan.");
  }

  const conn = await db.getConnection();
  await conn.beginTransaction();
  let nn = 0;
  let noj = 0;

  try {
    // ════════════════════════════════════════════════════════════════════
    // MODE REALISASI
    // ════════════════════════════════════════════════════════════════════
    if (isRealisasi) {
      // Delphi: delete semua jurnal otomatis realisasi lama
      await conn.query(
        `DELETE FROM finance.tjurnal WHERE jur_otomatis=1 AND MID(jur_no,3,18)=?`,
        [nomor],
      );

      for (const d of detail) {
        if (!d.nama) continue;

        if (d.jurnal) {
          // ── Realisasi existing → edit atau hapus ──
          if (!d.tglRealisasi) {
            // Delphi: tglRealisasi dihapus → reset realisasi + delete jurnal
            await conn.query(
              `
              UPDATE finance.tpengajuan_transfer_dtl SET
                ptd_realisasi = NULL,
                ptd_akun      = '',
                ptd_jur_no    = '',
                ptd_cc_kode   = 0,
                ptd_dc_nama   = '',
                ptd_batal     = ?
              WHERE ptd_nomor = ? AND ptd_nourut = ?
            `,
              [d.batal || "", nomor, d.nourut],
            );
            await conn.query(`DELETE FROM finance.tjurnal WHERE jur_no = ?`, [
              d.jurnal,
            ]);
          } else {
            // Delphi: realisasi diubah → update dtl + update jurnal BBK
            await conn.query(
              `
              UPDATE finance.tpengajuan_transfer_dtl SET
                ptd_realisasi = ?,
                ptd_ket       = ?,
                ptd_akun      = ?,
                ptd_cc_kode   = ?,
                ptd_dc_nama   = ?
              WHERE ptd_nomor = ? AND ptd_nourut = ?
            `,
              [
                d.tglRealisasi,
                d.ket || "",
                d.rekkode || "",
                d.cckode || 0,
                d.dcnama || "",
                nomor,
                d.nourut,
              ],
            );

            // Update BBK header
            await conn.query(
              `
              UPDATE finance.tjurnal SET
                jur_tanggal    = ?,
                jur_keterangan = ?,
                jur_rek_kode   = ?
              WHERE jur_no = ?
            `,
              [d.tglRealisasi, d.ket || "", d.rekkode || "", d.jurnal],
            );

            // Rebuild BBK detail
            await conn.query(
              `DELETE FROM finance.tjurnalitem WHERE jurd_jur_no = ?`,
              [d.jurnal],
            );
            // Header kredit
            await conn.query(
              `
              INSERT INTO finance.tjurnalitem (jurd_jur_no, jurd_rek_kode, jurd_kredit, jurd_uraian, jurd_nourut)
              VALUES (?, ?, ?, ?, 0)
            `,
              [d.jurnal, rek_kode, d.nominal, d.ket || ""],
            );
            // Detail debet
            await conn.query(
              `
              INSERT INTO finance.tjurnalitem
                (jurd_jur_no, jurd_trs, jurd_nourut, jurd_uraian,
                 jurd_debet, jurd_rek_kode, jurd_cc_kode, jurd_dcnama)
              VALUES (?, 'BBK', 1, ?, ?, ?, ?, ?)
            `,
              [
                d.jurnal,
                d.ket || "",
                d.nominal,
                d.rekkode || "",
                d.cckode || 0,
                d.dcnama || "",
              ],
            );

            // ── FIX: regenerate BKM/BBM otomatis (kena hapus oleh delete blanket di atas) ──
            nn++;
            const [[rowMasuk]] = await conn.query(
              `SELECT IFNULL(MAX(CAST(LEFT(jur_no,2) AS UNSIGNED)),0) AS max_val
               FROM finance.tjurnal WHERE jur_otomatis=1 AND SUBSTRING(jur_no,3)=?`,
              [nomor],
            );
            const noMasuk =
              String(100 + nn + Number(rowMasuk.max_val)).slice(-2) + nomor;
            const rekPrefix = (d.rekkode || "").substring(0, 5);

            if (rekPrefix === "A-111") {
              await conn.query(
                `
                INSERT INTO finance.tjurnal
                  (jur_no, jur_tanggal, jur_tipetransaksi, jur_cabang,
                  jur_keterangan, jur_rek_kode, jur_otomatis, date_create, user_create)
                VALUES (?, ?, 'BKM', 'P01',
                  'BKM OTOMATIS: REALISASI PENGAJUAN TRANSFER',
                  ?, 1, NOW(), ?)
              `,
                [noMasuk, d.tglRealisasi, d.rekkode, user.kode],
              );
              await conn.query(
                `
                INSERT INTO finance.tjurnalitem (jurd_jur_no, jurd_rek_kode, jurd_debet, jurd_uraian, jurd_nourut)
                VALUES (?, ?, ?, ?, 0)
              `,
                [noMasuk, d.rekkode, d.nominal, d.ket || ""],
              );
              await conn.query(
                `
                INSERT INTO finance.tjurnalitem
                  (jurd_jur_no, jurd_trs, jurd_nourut, jurd_uraian,
                   jurd_kredit, jurd_rek_kode)
                VALUES (?, 'BKM', 1, 'REALISASI TRANSFER', ?, ?)
              `,
                [noMasuk, d.nominal, rek_kode],
              );
            } else if (
              rekPrefix === "A-112" ||
              (d.rekkode || "").startsWith("B-211")
            ) {
              await conn.query(
                `
                INSERT INTO finance.tjurnal
                  (jur_no, jur_tanggal, jur_tipetransaksi, jur_cabang,
                  jur_keterangan, jur_rek_kode, jur_otomatis, date_create, user_create)
                VALUES (?, ?, 'BBM', 'P01',
                  'BBM OTOMATIS: REALISASI PENGAJUAN TRANSFER',
                  ?, 1, NOW(), ?)
              `,
                [noMasuk, d.tglRealisasi, d.rekkode, user.kode],
              );
              await conn.query(
                `
                INSERT INTO finance.tjurnalitem (jurd_jur_no, jurd_rek_kode, jurd_debet, jurd_uraian, jurd_nourut)
                VALUES (?, ?, ?, ?, 0)
              `,
                [noMasuk, d.rekkode, d.nominal, d.ket || ""],
              );
              await conn.query(
                `
                  INSERT INTO finance.tjurnalitem
                    (jurd_jur_no, jurd_trs, jurd_nourut, jurd_uraian,
                    jurd_kredit, jurd_rek_kode)
                  VALUES (?, 'BBM', 1, 'REALISASI TRANSFER', ?, ?)
                `,
                [noMasuk, d.nominal, rek_kode],
              );
            }
          }
        } else {
          // ── Realisasi baru ──
          if (d.tglRealisasi) {
            noj++;
            const jurnalNomor = await getJurnalNomor(conn, noj);

            // Update dtl — set realisasi & nomor jurnal
            await conn.query(
              `
              UPDATE finance.tpengajuan_transfer_dtl SET
                ptd_realisasi = ?,
                ptd_ket       = ?,
                ptd_akun      = ?,
                ptd_jur_no    = ?,
                ptd_cc_kode   = ?,
                ptd_dc_nama   = ?
              WHERE ptd_nomor = ? AND ptd_nourut = ?
            `,
              [
                d.tglRealisasi,
                d.ket || "",
                d.rekkode || "",
                jurnalNomor,
                d.cckode || 0,
                d.dcnama || "",
                nomor,
                d.nourut,
              ],
            );

            // Insert jurnal BBK
            await conn.query(
              `
              INSERT INTO finance.tjurnal
                (jur_no, jur_tanggal, jur_tipetransaksi, jur_cabang,
                 jur_penerima, jur_keterangan, jur_rek_kode,
                 date_create, user_create)
              VALUES (?, ?, 'BBK', 'P01', '',
                CONCAT('BBK OTOMATIS : ', ?), ?, NOW(), ?)
            `,
              [jurnalNomor, d.tglRealisasi, nomor, rek_kode, user.kode],
            );

            // BBK tjurnalitem
            await conn.query(
              `DELETE FROM finance.tjurnalitem WHERE jurd_jur_no = ?`,
              [jurnalNomor],
            );
            // Header kredit
            await conn.query(
              `
              INSERT INTO finance.tjurnalitem (jurd_jur_no, jurd_rek_kode, jurd_kredit, jurd_uraian, jurd_nourut)
              VALUES (?, ?, ?, ?, 0)
            `,
              [jurnalNomor, rek_kode, d.nominal, d.ket || ""],
            );
            // Detail debet
            await conn.query(
              `
              INSERT INTO finance.tjurnalitem
                (jurd_jur_no, jurd_trs, jurd_nourut, jurd_uraian,
                 jurd_debet, jurd_rek_kode, jurd_cc_kode, jurd_dcnama)
              VALUES (?, 'BBK', 1, ?, ?, ?, ?, ?)
            `,
              [
                jurnalNomor,
                d.ket || "",
                d.nominal,
                d.rekkode || "",
                d.cckode || 0,
                d.dcnama || "",
              ],
            );

            // ── BKM/BBM otomatis berdasarkan account ──
            // Delphi: getnomasuk pakai jur_no = cno (bukan MID)
            nn++;
            const [[rowMasuk]] = await conn.query(
              `SELECT IFNULL(MAX(CAST(LEFT(jur_no,2) AS UNSIGNED)),0) AS max_val
               FROM finance.tjurnal WHERE jur_otomatis=1 AND SUBSTRING(jur_no,3)=?`,
              [nomor],
            );
            const noMasuk =
              String(100 + nn + Number(rowMasuk.max_val)).slice(-2) + nomor;

            const rekPrefix = (d.rekkode || "").substring(0, 5);

            if (rekPrefix === "A-111") {
              // Delphi simpanbkm
              await conn.query(
                `
                INSERT INTO finance.tjurnal
                  (jur_no, jur_tanggal, jur_tipetransaksi, jur_cabang,
                   jur_keterangan, jur_rek_kode, jur_otomatis, date_create, user_create)
                VALUES (?, ?, 'BKM', 'P01',
                  'BKM OTOMATIS: REALISASI PENGAJUAN TRANSFER',
                  ?, 1, NOW(), ?)
              `,
                [noMasuk, d.tglRealisasi, d.rekkode, user.kode],
              );
              await conn.query(
                `
                INSERT INTO finance.tjurnalitem (jurd_jur_no, jurd_rek_kode, jurd_debet, jurd_uraian, jurd_nourut)
                VALUES (?, ?, ?, ?, 0)
              `,
                [noMasuk, d.rekkode, d.nominal, d.ket || ""],
              );
              await conn.query(
                `
                INSERT INTO finance.tjurnalitem
                  (jurd_jur_no, jurd_trs, jurd_nourut, jurd_uraian,
                   jurd_kredit, jurd_rek_kode)
                VALUES (?, 'BKM', 1, 'REALISASI TRANSFER', ?, ?)
              `,
                [noMasuk, d.nominal, rek_kode],
              );
            } else if (
              rekPrefix === "A-112" ||
              (d.rekkode || "").startsWith("B-211")
            ) {
              // Delphi simpanbbm
              await conn.query(
                `
                INSERT INTO finance.tjurnal
                  (jur_no, jur_tanggal, jur_tipetransaksi, jur_cabang,
                   jur_keterangan, jur_rek_kode, jur_otomatis, date_create, user_create)
                VALUES (?, ?, 'BBM', 'P01',
                  'BBM OTOMATIS: REALISASI PENGAJUAN TRANSFER',
                  ?, 1, NOW(), ?)
              `,
                [noMasuk, d.tglRealisasi, d.rekkode, user.kode],
              );
              await conn.query(
                `
                INSERT INTO finance.tjurnalitem (jurd_jur_no, jurd_rek_kode, jurd_debet, jurd_uraian, jurd_nourut)
                VALUES (?, ?, ?, ?, 0)
              `,
                [noMasuk, d.rekkode, d.nominal, d.ket || ""],
              );
              await conn.query(
                `
                INSERT INTO finance.tjurnalitem
                  (jurd_jur_no, jurd_trs, jurd_nourut, jurd_uraian,
                   jurd_kredit, jurd_rek_kode)
                VALUES (?, 'BBM', 1, 'REALISASI TRANSFER', ?, ?)
              `,
                [noMasuk, d.nominal, rek_kode],
              );
            }
          } else if (d.batal) {
            // Delphi: tidak ada tglRealisasi tapi ada batal → update batal saja
            await conn.query(
              `
              UPDATE finance.tpengajuan_transfer_dtl SET ptd_batal = ?
              WHERE ptd_nomor = ? AND ptd_nourut = ?
            `,
              [d.batal, nomor, d.nourut],
            );
          }
        }
      }

      await conn.commit();
      return { nomor };
    }

    // ════════════════════════════════════════════════════════════════════
    // MODE BARU / EDIT
    // ════════════════════════════════════════════════════════════════════
    let actualNomor = nomor;

    if (isEdit) {
      await conn.query(
        `
        UPDATE finance.tpengajuan_transfer_hdr SET
          pth_tanggal   = ?,
          pth_rek_kode  = ?,
          date_modified = NOW(),
          user_modified = ?
        WHERE pth_nomor = ?
      `,
        [tanggal, rek_kode, user.kode, nomor],
      );
    } else {
      actualNomor = await getMaxNomor(conn);
      await conn.query(
        `
        INSERT INTO finance.tpengajuan_transfer_hdr
          (pth_nomor, pth_tanggal, pth_rek_kode, date_create, user_create)
        VALUES (?, ?, ?, NOW(), ?)
      `,
        [actualNomor, tanggal, rek_kode, user.kode],
      );
    }

    // Delphi: delete detail yang belum realisasi
    await conn.query(
      `
      DELETE FROM finance.tpengajuan_transfer_dtl
      WHERE ptd_jur_no = '' AND ptd_nomor = ?
    `,
      [actualNomor],
    );

    // Delphi: delete link voucher & po external lama
    await conn.query(`DELETE FROM tpoexternal_dtl2 WHERE poed2_link = ?`, [
      actualNomor,
    ]);
    await conn.query(`DELETE FROM bayar_debet_detail WHERE vou_link = ?`, [
      actualNomor,
    ]);

    // Get nourut existing
    const [[maxNourut]] = await conn.query(
      `
      SELECT IFNULL(MAX(ptd_nourut), 0) AS max_val
      FROM finance.tpengajuan_transfer_dtl WHERE ptd_nomor = ?
    `,
      [actualNomor],
    );
    let nourut = Number(maxNourut.max_val);

    // Delphi: xRpVou — total nominal VOU
    let xRpVou = 0;
    for (const d of detail) {
      if (d.nama && d.trs && d.trs.startsWith("VOU")) {
        xRpVou += Number(d.nominal) || 0;
      }
    }

    let vouNomor = "";
    let vouInserted = false;

    for (const d of detail) {
      if (!d.nama) continue;
      if (d.jurnal) continue; // sudah realisasi → skip

      nourut++;
      await conn.query(
        `
        INSERT INTO finance.tpengajuan_transfer_dtl
          (ptd_nomor, ptd_nourut, ptd_sup_kode, ptd_bank,
           ptd_rekening, ptd_atasnama, ptd_trs,
           ptd_nominal, ptd_ket, ptd_batal)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
        [
          actualNomor,
          nourut,
          d.kode || "",
          d.bank || "",
          d.rekening || "",
          d.atasnama || "",
          d.trs || "",
          Number(d.nominal) || 0,
          d.ket || "",
          d.batal || "",
        ],
      );

      // Delphi: link voucher (trs prefix VOU)
      if ((d.trs || "").startsWith("VOU")) {
        if (!vouInserted) {
          vouNomor =
            payload.byrvoucher || (await getVoucherNomor(tanggal, conn));
          await conn.query(
            `
            UPDATE finance.tpengajuan_transfer_hdr SET pth_byrvoucher = ?
            WHERE pth_nomor = ?
          `,
            [vouNomor, actualNomor],
          );
          await conn.query(
            `
            INSERT INTO bayar_debet
              (nomor, kode, account, tanggal, tanggal_tempo, total, kodeuser)
            VALUES (?, 'BT', ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE total = ?
          `,
            [vouNomor, rek_kode, tanggal, tanggal, xRpVou, user.kode, xRpVou],
          );
          vouInserted = true;
        }
        await conn.query(
          `
          INSERT INTO bayar_debet_detail
            (nomor, vou_nomor, vou_link, nilai)
          VALUES (?, ?, ?, ?)
        `,
          [vouNomor, d.trs, actualNomor, Number(d.nominal) || 0],
        );
      }

      // Delphi: link PO External (trs prefix POE)
      if ((d.trs || "").startsWith("POE")) {
        await conn.query(
          `
          INSERT INTO tpoexternal_dtl2
            (poed2_nomor, poed2_tanggal, poed2_nominal, poed2_akun, poed2_link)
          VALUES (?, ?, ?, ?, ?)
        `,
          [d.trs, tanggal, Number(d.nominal) || 0, rek_kode, actualNomor],
        );
      }
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
  const [[h]] = await db.query(
    `
    SELECT h.pth_nomor AS nomor,
      DATE_FORMAT(h.pth_tanggal,'%Y-%m-%d') AS tanggal,
      DATE_FORMAT(h.pth_tanggal,'%d %b %Y') AS tanggal_fmt,
      h.pth_rek_kode AS account,
      r.rek_rekening AS noRekAsal,
      r.rek_nama AS namaRekening,
      h.user_create
    FROM finance.tpengajuan_transfer_hdr h
    LEFT JOIN finance.trekening r ON r.rek_kode = h.pth_rek_kode
    WHERE h.pth_nomor = ?
  `,
    [nomor],
  );
  if (!h) throw new Error("Data tidak ditemukan.");

  const [detail] = await db.query(
    `
    SELECT s.sup_nama AS namaSupplier,
      d.ptd_bank AS bank,
      d.ptd_atasnama AS atasNama,
      d.ptd_rekening AS rekening,
      d.ptd_nominal AS nominal,
      d.ptd_ket AS keterangan,
      DATE_FORMAT(d.ptd_realisasi,'%d %b %Y') AS tglRealisasi
    FROM finance.tpengajuan_transfer_dtl d
    LEFT JOIN tsupplier s ON s.sup_kode = d.ptd_sup_kode
    WHERE d.ptd_nomor = ? AND d.ptd_batal = ''
    ORDER BY d.ptd_nourut
  `,
    [nomor],
  );

  const total = detail.reduce((s, d) => s + Number(d.nominal), 0);
  return { ...h, detail, total };
};

module.exports = {
  getAccountOptions,
  getAccountAll,
  getCostCenterOptions,
  getDcOptions,
  getSupplierOptions,
  getSupplierDetail,
  getVoucherOptions,
  getPoExternalOptions,
  getPettyCashOptions,
  getBkkOptions,
  getDetailForm,
  saveData,
  getPrintData,
};
