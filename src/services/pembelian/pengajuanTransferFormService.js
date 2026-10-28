const db = require("../../config/database");
const tutupBukuService = require("../tutupBukuService");
const { assertBolehPosting, sqlTanpaInduk } = require("../postingGuardService");
const {
  TANGGAL_MULAI_KLAIM,
  kasByRek,
  semuaSupKlaim,
} = require("../piutang/klaimKasKecilKonstanta");

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

// ── Voucher hasil Rekap Pembayaran (F7) ───────────────────────────────
// Hanya voucher yang tertaut ke baris rekap AKTIF (rkbd_vou_nomor) dan belum
// dipakai Pengajuan Transfer (belum ada di bayar_debet_detail, sama dengan F2).
// Dua langkah (bukan JOIN lintas tabel) supaya tidak kena collation mismatch.
const getRekapVoucherOptions = async (search = "") => {
  const [rekap] = await db.query(
    `SELECT d.rkbd_vou_nomor AS vouNomor,
            GROUP_CONCAT(DISTINCT d.rkbd_nomor ORDER BY d.rkbd_nomor
                         SEPARATOR ', ') AS rekapNomor,
            DATE_FORMAT(MIN(d.rkbd_tgl_rencana), '%Y-%m-%d') AS tglRencana
     FROM trekap_bayar_dtl d
     INNER JOIN trekap_bayar_hdr rh
       ON rh.rkb_nomor = d.rkbd_nomor AND rh.rkb_status = 'AKTIF'
     WHERE d.rkbd_vou_nomor <> ''
     GROUP BY d.rkbd_vou_nomor`,
  );
  if (!rekap.length) return [];

  const [rows] = await db.query(
    `SELECT h.vou_nomor AS nomor,
        DATE_FORMAT(h.vou_tanggal,'%Y-%m-%d') AS tanggal,
        h.vou_sup_kode AS supKode,
        s.sup_nama AS supplier,
        h.vou_total - IFNULL((
          SELECT SUM(voud2_harga * voud2_jumlah)
          FROM tvoucher_dtl2
          WHERE voud2_vou_nomor = h.vou_nomor
        ), 0) AS nominal
     FROM tvoucher_hdr h
     INNER JOIN tsupplier s ON s.sup_kode = h.vou_sup_kode
     WHERE h.vou_nomor IN (?)
       AND NOT EXISTS (
         SELECT 1 FROM bayar_debet_detail b WHERE b.vou_nomor = h.vou_nomor
       )`,
    [rekap.map((r) => r.vouNomor)],
  );

  const infoRekap = new Map(rekap.map((r) => [r.vouNomor, r]));
  const kata = String(search || "")
    .trim()
    .toLowerCase();
  return rows
    .map((r) => ({
      ...r,
      nominal: Number(r.nominal),
      rekapNomor: infoRekap.get(r.nomor)?.rekapNomor || "",
      tglRencana: infoRekap.get(r.nomor)?.tglRencana || "",
    }))
    .filter(
      (r) =>
        !kata ||
        r.nomor.toLowerCase().includes(kata) ||
        String(r.supplier || "")
          .toLowerCase()
          .includes(kata) ||
        r.rekapNomor.toLowerCase().includes(kata),
    )
    .sort(
      (a, b) =>
        String(a.tglRencana).localeCompare(String(b.tglRencana)) ||
        a.nomor.localeCompare(b.nomor),
    );
};

// ── Voucher pembayaran (F2) ───────────────────────────────────────────
// Delphi: voucher belum ada di bayar_debet_detail
const getVoucherOptions = async (search = "") => {
  const [rows] = await db.query(
    `
    SELECT h.vou_nomor AS nomor,
      DATE_FORMAT(h.vou_tanggal,'%Y-%m-%d') AS tanggal,
      h.vou_sup_kode AS supKode,
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
    WHERE h.pck_status = 'APPROVED'
      AND IFNULL(h.pck_pth_nomor, '') = ''
      AND NOT EXISTS (
        SELECT 1 FROM finance.tpengajuan_transfer_dtl d
        WHERE d.ptd_trs = h.pck_nomor
      )
      AND (h.pck_nomor LIKE ? OR h.pck_cab LIKE ?)
    ORDER BY h.pck_nomor
  `,
    [`%${search}%`, `%${search}%`],
  );
  return rows.map((r) => ({ ...r, nominal: Number(r.nominal) }));
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

  // BKK yang terkunci di Klaim Kas Kecil aktif diajukan lewat F8, bukan F1
  const [kunci] = await db.query(
    `SELECT kkd_kunci FROM tklaim_kaskecil_dtl WHERE kkd_kunci IS NOT NULL`,
  );
  const dikunci = new Set(kunci.map((r) => r.kkd_kunci));

  return rows
    .filter((r) => !dikunci.has(r.nomor))
    .map((r) => ({ ...r, nominal: Number(r.nominal) }));
};

// ── PO Lain-lain (F6) ─────────────────────────────────────────────────
// Total per (PO, supplier): qty × harga × (100-disc)/100, + PPN kalau
// po_status_ppn = 1. Rumus sama dengan BPB di voucherPembayaranFormService.
// Dipakai di lookup dan validasi simpan supaya angkanya selalu sama.
const SQL_TOTAL_PO_LAIN = `
  ROUND(
    SUM(d.pod_Jumlah * d.pod_hargabeli * (100 - d.pod_disc) / 100)
    * IF(h.po_status_ppn = 1, (100 + h.po_ppn) / 100, 1),
  2)`;

// excludeNomor = nomor pengajuan yang sedang diedit, supaya baris miliknya
// sendiri tidak dihitung sebagai "sudah diajukan".
const getPoLainOptions = async (search = "", excludeNomor = "") => {
  const [rows] = await db.query(
    `
    SELECT x.nomor, x.tanggal, x.supKode, x.supplier,
      x.total, x.sudah, ROUND(x.total - x.sudah, 2) AS nominal
    FROM (
      SELECT h.po_nomor AS nomor,
        DATE_FORMAT(h.po_tanggal,'%Y-%m-%d') AS tanggal,
        d.pod_sup_kode AS supKode,
        IFNULL(s.sup_nama,'') AS supplier,
        ${SQL_TOTAL_PO_LAIN} AS total,
        IFNULL((
          SELECT SUM(t.ptd_nominal)
          FROM finance.tpengajuan_transfer_dtl t
          WHERE t.ptd_trs = h.po_nomor
            AND t.ptd_sup_kode = d.pod_sup_kode
            AND t.ptd_batal = ''
            AND t.ptd_nomor <> ?
        ), 0)
        + IFNULL((
          SELECT SUM(v.voud_total)
          FROM tvoucher_dtl v
          INNER JOIN tvoucher_hdr vh ON vh.vou_nomor = v.voud_vou_nomor
          WHERE v.voud_nota = h.po_nomor AND v.voud_type = 'POL'
            AND vh.vou_sup_kode = d.pod_sup_kode
        ), 0) AS sudah
      FROM tpo_hdr h
      INNER JOIN tpo_dtl d
        ON d.pod_po_Nomor = h.po_nomor AND d.pod_bhn_kode <> ''
      LEFT JOIN tsupplier s ON s.sup_kode = d.pod_sup_kode
      WHERE h.po_jenis = 4
        AND d.pod_sup_kode IS NOT NULL AND d.pod_sup_kode <> ''
        AND NOT EXISTS (
          SELECT 1 FROM tpengajuan_uang_muka_dtl pd
          JOIN tpengajuan_uang_muka_hdr ph ON ph.pum_nomor = pd.pumd_pum_nomor
          JOIN tpo_dtl x ON x.pod_po_Nomor = pd.pumd_nomor_sumber
                        AND x.pod_nourut = pd.pumd_item_nourut
          WHERE pd.pumd_sumber = 'PO_LAIN_LAIN'
            AND pd.pumd_nomor_sumber = h.po_nomor
            AND x.pod_sup_kode = d.pod_sup_kode
            AND (ph.pum_status = 'DIAJUKAN'
                 OR (ph.pum_status = 'REALISASI' AND pd.pumd_status_acc = 'ACC'))
        )
      GROUP BY h.po_nomor, h.po_tanggal, h.po_status_ppn, h.po_ppn,
               d.pod_sup_kode, s.sup_nama
    ) x
    WHERE (x.total - x.sudah) > 0.005
      AND (x.nomor LIKE ? OR x.supplier LIKE ?)
    ORDER BY x.nomor DESC
    LIMIT 200
  `,
    [excludeNomor || "", `%${search}%`, `%${search}%`],
  );
  return rows.map((r) => ({
    ...r,
    total: Number(r.total),
    sudah: Number(r.sudah),
    nominal: Number(r.nominal),
  }));
};

// Validasi server: nomor PO bisa diketik manual di grid (kolom No.
// Transaksi tidak readonly), jadi lookup saja tidak cukup. Dipanggil di
// dalam transaksi SETELAH baris yang belum direalisasi dihapus, sehingga
// "sudah diajukan" otomatis tidak ikut menghitung baris pengajuan ini.
// Sekalian menormalkan d.trs ke penulisan nomor PO asli di database.
const validasiPoLain = async (conn, detail) => {
  const baris = detail.filter((d) => d.nama && d.trs && !d.jurnal && !d.batal);
  if (!baris.length) return;

  const daftarTrs = [...new Set(baris.map((d) => String(d.trs).trim()))];
  const [lain] = await conn.query(
    `SELECT po_nomor FROM tpo_hdr WHERE po_jenis = 4 AND po_nomor IN (?)`,
    [daftarTrs],
  );
  if (!lain.length) return;
  const kanonik = new Map(
    lain.map((r) => [r.po_nomor.toUpperCase(), r.po_nomor]),
  );

  const grup = new Map();
  for (const d of baris) {
    const po = kanonik.get(String(d.trs).trim().toUpperCase());
    if (!po) continue;
    d.trs = po;
    const sup = String(d.kode || "").trim();
    const key = `${po}|${sup}`;
    const g = grup.get(key) || { po, sup, nominal: 0 };
    g.nominal += Number(d.nominal) || 0;
    grup.set(key, g);
  }

  for (const g of grup.values()) {
    const [[tot]] = await conn.query(
      `SELECT ${SQL_TOTAL_PO_LAIN} AS total
       FROM tpo_hdr h
       INNER JOIN tpo_dtl d
         ON d.pod_po_Nomor = h.po_nomor AND d.pod_bhn_kode <> ''
       WHERE h.po_nomor = ? AND d.pod_sup_kode = ?
       GROUP BY h.po_nomor, h.po_status_ppn, h.po_ppn`,
      [g.po, g.sup],
    );
    if (!tot) {
      throw new Error(
        `Supplier ${g.sup || "(kosong)"} tidak ada pada PO ${g.po}.`,
      );
    }
    const [[pum]] = await conn.query(
      `SELECT 1 AS x
       FROM tpengajuan_uang_muka_dtl pd
       JOIN tpengajuan_uang_muka_hdr ph ON ph.pum_nomor = pd.pumd_pum_nomor
       JOIN tpo_dtl x ON x.pod_po_Nomor = pd.pumd_nomor_sumber
                     AND x.pod_nourut = pd.pumd_item_nourut
       WHERE pd.pumd_sumber = 'PO_LAIN_LAIN'
         AND pd.pumd_nomor_sumber = ? AND x.pod_sup_kode = ?
         AND (ph.pum_status = 'DIAJUKAN'
              OR (ph.pum_status = 'REALISASI' AND pd.pumd_status_acc = 'ACC'))
       LIMIT 1`,
      [g.po, g.sup],
    );
    if (pum) {
      throw new Error(
        `PO ${g.po} (supplier ${g.sup}) sudah diajukan lewat Uang Muka.`,
      );
    }
    const [[sd]] = await conn.query(
      `SELECT IFNULL(SUM(ptd_nominal), 0) AS sudah
       FROM finance.tpengajuan_transfer_dtl
       WHERE ptd_trs = ? AND ptd_sup_kode = ? AND ptd_batal = ''`,
      [g.po, g.sup],
    );
    const [[vd]] = await conn.query(
      `SELECT IFNULL(SUM(v.voud_total), 0) AS sudah
       FROM tvoucher_dtl v
       INNER JOIN tvoucher_hdr vh ON vh.vou_nomor = v.voud_vou_nomor
       WHERE v.voud_nota = ? AND v.voud_type = 'POL' AND vh.vou_sup_kode = ?`,
      [g.po, g.sup],
    );
    const sisa = Number(tot.total) - Number(sd.sudah) - Number(vd.sudah);
    if (g.nominal > sisa + 0.005) {
      throw new Error(
        `Nominal melebihi sisa PO ${g.po} (supplier ${g.sup}). Sisa: ${sisa.toLocaleString("id-ID")}.`,
      );
    }
  }
};

// Supplier tujuan klaim per kas (master tsupplier + rekening pertama).
// Bila supplier punya lebih dari satu rekening, dipakai yang pertama
// berdasarkan nama bank.
const ambilSupplierKlaim = async (conn, rekKode) => {
  const kode = kasByRek(rekKode)?.sup;
  if (!kode)
    throw new Error(`Supplier tujuan untuk kas ${rekKode} belum diatur.`);
  const [rows] = await conn.query(
    `SELECT a.sup_kode AS kode, a.sup_nama AS nama,
            b.supd_bank AS bank, b.supd_rekening AS rekening,
            b.supd_atasnama AS atasnama
     FROM tsupplier a
     LEFT JOIN tsupplieritem b ON b.supd_kode = a.sup_kode
     WHERE a.sup_aktif = 'Y' AND a.sup_kode = ?
     ORDER BY b.supd_bank
     LIMIT 1`,
    [kode],
  );
  if (!rows.length)
    throw new Error(`Supplier ${kode} tidak ditemukan atau tidak aktif.`);
  const r = rows[0];
  return {
    kode: r.kode,
    nama: r.nama || "",
    bank: r.bank || "",
    rekening: r.rekening || "",
    atasnama: r.atasnama || "",
  };
};

// ── Klaim Kas Kecil (F8) ──────────────────────────────────────────────
// Klaim AKTIF yang belum dipanggil baris PJT aktif lain. Dua langkah
// (bukan JOIN lintas schema). excludeNomor = pengajuan yang sedang diedit.
const getKlaimKasKecilOptions = async (search = "", excludeNomor = "") => {
  const [rows] = await db.query(
    `SELECT h.kkh_nomor AS nomor,
        DATE_FORMAT(h.kkh_tanggal,'%Y-%m-%d') AS tanggal,
        h.kkh_cabang AS cabang,
        h.kkh_rek_tujuan AS rekKode,
        h.kkh_total AS nominal,
        h.kkh_keterangan AS keterangan,
        (SELECT COUNT(*) FROM tklaim_kaskecil_dtl d
          WHERE d.kkd_kkh_nomor = h.kkh_nomor) AS jumlahBkk
     FROM tklaim_kaskecil_hdr h
     WHERE h.kkh_status = 'AKTIF'
       AND (h.kkh_nomor LIKE ? OR h.kkh_cabang LIKE ?)
     ORDER BY h.kkh_nomor DESC
     LIMIT 200`,
    [`%${search}%`, `%${search}%`],
  );
  if (!rows.length) return [];

  const [dipakai] = await db.query(
    `SELECT DISTINCT ptd_trs FROM finance.tpengajuan_transfer_dtl
     WHERE ptd_trs IN (?) AND ptd_batal = '' AND ptd_nomor <> ?`,
    [rows.map((r) => r.nomor), excludeNomor || ""],
  );
  const terpakai = new Set(dipakai.map((r) => r.ptd_trs));

  const kodeRek = [...new Set(rows.map((r) => r.rekKode))];
  const [rek] = await db.query(
    `SELECT rek_kode, rek_nama, rek_rekening
     FROM finance.trekening WHERE rek_kode IN (?)`,
    [kodeRek],
  );
  const infoRek = new Map(rek.map((r) => [r.rek_kode, r]));

  const supPerRek = new Map();
  const hasil = [];
  for (const r of rows.filter((x) => !terpakai.has(x.nomor))) {
    if (!supPerRek.has(r.rekKode))
      supPerRek.set(r.rekKode, await ambilSupplierKlaim(db, r.rekKode));
    hasil.push({
      ...r,
      nominal: Number(r.nominal),
      jumlahBkk: Number(r.jumlahBkk),
      rekNama: infoRek.get(r.rekKode)?.rek_nama || "",
      rekRekening: infoRek.get(r.rekKode)?.rek_rekening || "",
      sup: supPerRek.get(r.rekKode),
    });
  }
  return hasil;
};

// Nominal tiap BKK di jurnal harus sama dengan snapshot klaim. Menutup
// jendela waktu antara klaim dibuat dan diajukan/direalisasi (tabel
// Finance MyISAM, tidak bisa satu transaksi dengan klaim).
const pastikanNominalBkk = async (conn, klaim) => {
  const [dtl] = await conn.query(
    `SELECT kkd_jur_no, kkd_nominal FROM tklaim_kaskecil_dtl
     WHERE kkd_kkh_nomor = ?`,
    [klaim.kkh_nomor],
  );
  if (!dtl.length)
    throw new Error(`Klaim ${klaim.kkh_nomor} tidak memiliki BKK.`);

  const [jur] = await conn.query(
    `SELECT jurd_jur_no AS bkk, SUM(jurd_kredit) AS nominal
     FROM finance.tjurnalitem
     WHERE jurd_nourut = 0 AND jurd_rek_kode = ? AND jurd_jur_no IN (?)
     GROUP BY jurd_jur_no`,
    [klaim.kkh_rek_tujuan, dtl.map((d) => d.kkd_jur_no)],
  );
  const peta = new Map(jur.map((r) => [r.bkk, Number(r.nominal)]));
  const beda = dtl
    .filter(
      (d) =>
        Math.abs((peta.get(d.kkd_jur_no) ?? -1) - Number(d.kkd_nominal)) >
        0.005,
    )
    .map((d) => d.kkd_jur_no);
  if (beda.length)
    throw new Error(
      `Nominal atau akun BKK berikut berubah sejak klaim ${klaim.kkh_nomor} dibuat: ${beda.join(", ")}. Batalkan klaim lalu buat ulang.`,
    );
};

// Validasi server saat simpan (mode baru/edit). Dipanggil SETELAH baris
// yang belum direalisasi dihapus, jadi baris pengajuan ini sendiri tidak
// terhitung sebagai "sudah dipakai". Sekaligus mengisi ulang kolom baris
// klaim dari data server (nomor, nominal, nama, rekening, atas nama).
const validasiKlaimKasKecil = async (conn, detail, rekKode, nomorPjt) => {
  const baris = detail.filter((d) => d.nama && d.trs && !d.jurnal && !d.batal);
  if (!baris.length) return;

  const daftarTrs = [...new Set(baris.map((d) => String(d.trs).trim()))];

  // BKK yang terkunci klaim aktif tidak boleh diajukan langsung (F1/ketik manual)
  const [kunci] = await conn.query(
    `SELECT kkd_kunci, kkd_kkh_nomor FROM tklaim_kaskecil_dtl
     WHERE kkd_kunci IN (?) LIMIT 1`,
    [daftarTrs],
  );
  if (kunci.length)
    throw new Error(
      `BKK ${kunci[0].kkd_kunci} sudah diklaim di Klaim Kas Kecil ${kunci[0].kkd_kkh_nomor}. Ajukan lewat F8 Klaim Kas Kecil.`,
    );

  const [klaim] = await conn.query(
    `SELECT kkh_nomor, kkh_cabang, kkh_status, kkh_total, kkh_rek_tujuan
     FROM tklaim_kaskecil_hdr WHERE kkh_nomor IN (?)`,
    [daftarTrs],
  );
  if (!klaim.length) return;
  const peta = new Map(klaim.map((k) => [k.kkh_nomor.toUpperCase(), k]));

  const dipakaiDiForm = new Set();
  for (const d of baris) {
    const k = peta.get(String(d.trs).trim().toUpperCase());
    if (!k) continue;

    if (k.kkh_status !== "AKTIF")
      throw new Error(`Klaim ${k.kkh_nomor} sudah dibatalkan.`);
    if (dipakaiDiForm.has(k.kkh_nomor))
      throw new Error(`Klaim ${k.kkh_nomor} diinput lebih dari satu kali.`);
    dipakaiDiForm.add(k.kkh_nomor);
    if (rekKode === k.kkh_rek_tujuan)
      throw new Error(
        `Rekening asal tidak boleh sama dengan kas kecil tujuan (${k.kkh_rek_tujuan}).`,
      );

    const [[lain]] = await conn.query(
      `SELECT ptd_nomor FROM finance.tpengajuan_transfer_dtl
       WHERE ptd_trs = ? AND ptd_batal = '' AND ptd_nomor <> ? LIMIT 1`,
      [k.kkh_nomor, nomorPjt],
    );
    if (lain)
      throw new Error(
        `Klaim ${k.kkh_nomor} sudah dipanggil di Pengajuan Transfer ${lain.ptd_nomor}.`,
      );

    await pastikanNominalBkk(conn, k);

    const sup = await ambilSupplierKlaim(conn, k.kkh_rek_tujuan);
    d.trs = k.kkh_nomor;
    d.nominal = Number(k.kkh_total);
    d.kode = sup.kode;
    d.nama = sup.nama;
    d.bank = sup.bank;
    d.rekening = sup.rekening;
    d.atasnama = sup.atasnama;
  }
};

// Supplier tujuan klaim (kas kecil cabang / ATM) hanya boleh dipakai lewat
// baris klaim, yaitu No. Transaksi berisi nomor klaim yang ada. Baris manual
// ke supplier itu ditolak mulai tanggal mulai klaim (sebelumnya alur lama).
// Dipanggil SETELAH validasiKlaimKasKecil (baris klaim sudah dinormalkan).
const assertSupplierKlaimHanyaLewatKlaim = async (conn, detail, tanggal) => {
  if (!tanggal || String(tanggal).slice(0, 10) < TANGGAL_MULAI_KLAIM) return;
  const supKlaim = new Set(semuaSupKlaim());
  const baris = detail.filter(
    (d) =>
      d.nama &&
      !d.jurnal &&
      !d.batal &&
      supKlaim.has(String(d.kode || "").trim()),
  );
  if (!baris.length) return;

  const daftarTrs = [
    ...new Set(baris.map((d) => String(d.trs || "").trim()).filter(Boolean)),
  ];
  let klaimAda = new Set();
  if (daftarTrs.length) {
    const [klaim] = await conn.query(
      `SELECT kkh_nomor FROM tklaim_kaskecil_hdr WHERE kkh_nomor IN (?)`,
      [daftarTrs],
    );
    klaimAda = new Set(klaim.map((k) => k.kkh_nomor.toUpperCase()));
  }
  const salah = baris.filter(
    (d) =>
      !klaimAda.has(
        String(d.trs || "")
          .trim()
          .toUpperCase(),
      ),
  );
  if (salah.length)
    throw new Error(
      `Supplier ${[...new Set(salah.map((d) => d.nama))].join(", ")} khusus pengisian kas lewat Klaim. Ajukan lewat F8 Klaim Kas Kecil.`,
    );
};

// Supplier baris PJT dari database (bukan payload klien), dicatat di baris
// debit BBK hasil realisasi supaya BBK menampilkan supplier/bank/rekening.
const ambilSupplierBaris = async (conn, nomorPjt, nourut) => {
  const [[r]] = await conn.query(
    `SELECT d.ptd_sup_kode AS kode,
            COALESCE(NULLIF(s.sup_nama, ''), d.ptd_atasnama) AS nama,
            d.ptd_bank AS bank, d.ptd_rekening AS rekening,
            d.ptd_atasnama AS atasnama
     FROM finance.tpengajuan_transfer_dtl d
     LEFT JOIN tsupplier s ON s.sup_kode = d.ptd_sup_kode
     WHERE d.ptd_nomor = ? AND d.ptd_nourut = ?`,
    [nomorPjt, nourut],
  );
  return {
    kode: r?.kode || "",
    nama: r?.nama || "",
    bank: r?.bank || "",
    rekening: r?.rekening || "",
    atasnama: r?.atasnama || "",
  };
};

// Mode realisasi: baris klaim dipaksa ke akun kas kecil dan nominal tersimpan.
// Data dibaca dari baris PJT di database, bukan dari payload klien.
const terapkanKlaimRealisasi = async (conn, nomorPjt, d, rekKode) => {
  const [[row]] = await conn.query(
    `SELECT ptd_trs, ptd_nominal FROM finance.tpengajuan_transfer_dtl
     WHERE ptd_nomor = ? AND ptd_nourut = ?`,
    [nomorPjt, d.nourut],
  );
  if (!row || !row.ptd_trs) return;
  const [[k]] = await conn.query(
    `SELECT kkh_nomor, kkh_status, kkh_total, kkh_rek_tujuan
     FROM tklaim_kaskecil_hdr WHERE kkh_nomor = ?`,
    [row.ptd_trs],
  );
  if (!k) return;

  if (k.kkh_status !== "AKTIF")
    throw new Error(`Klaim ${k.kkh_nomor} sudah dibatalkan.`);
  if (rekKode === k.kkh_rek_tujuan)
    throw new Error(
      `Rekening asal tidak boleh sama dengan kas kecil tujuan (${k.kkh_rek_tujuan}).`,
    );

  d.rekkode = k.kkh_rek_tujuan;
  d.nominal = Number(row.ptd_nominal);
  d.cckode = 0;
  d.dcnama = "";
  d.dckode = 0;

  if (!d.jurnal && d.tglRealisasi) await pastikanNominalBkk(conn, k);
};

const getAccountAll = async (search = "") => {
  const [rows] = await db.query(
    `
    SELECT rek_kode AS kode, rek_nama AS nama, rek_cabang AS cabang
    FROM finance.trekening
    WHERE rek_isaktif = 0${sqlTanpaInduk()}
      AND (rek_kode LIKE ? OR rek_nama LIKE ?)
    ORDER BY rek_kode LIMIT 500
  `,
    [`%${search}%`, `%${search}%`],
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
      nama: r.sup_nama || r.ptd_atasnama || "",
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
      klaim: false,
    }));

  // Tandai baris Klaim Kas Kecil dan isi akun tujuan untuk realisasi
  const daftarTrs = [...new Set(detail.map((d) => d.trs).filter(Boolean))];
  if (daftarTrs.length) {
    const [klaim] = await db.query(
      `SELECT kkh_nomor, kkh_rek_tujuan FROM tklaim_kaskecil_hdr
       WHERE kkh_nomor IN (?)`,
      [daftarTrs],
    );
    if (klaim.length) {
      const petaRek = new Map(
        klaim.map((k) => [k.kkh_nomor.toUpperCase(), k.kkh_rek_tujuan]),
      );
      const [rek] = await db.query(
        `SELECT rek_kode, rek_nama FROM finance.trekening WHERE rek_kode IN (?)`,
        [[...new Set(petaRek.values())]],
      );
      const namaRek = new Map(rek.map((r) => [r.rek_kode, r.rek_nama]));
      for (const d of detail) {
        const rk = petaRek.get(String(d.trs).toUpperCase());
        if (!rk) continue;
        d.klaim = true;
        if (!d.rekkode) {
          d.rekkode = rk;
          d.reknama = namaRek.get(rk) || "";
        }
      }
    }
  }

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

        // Baris Klaim Kas Kecil: akun dan nominal dipaksa dari data server
        if (!d.batal) await terapkanKlaimRealisasi(conn, nomor, d, rek_kode);

        if (d.tglRealisasi)
          await assertBolehPosting([d.rekkode], d.tglRealisasi, conn);

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

            // Update BBK header (jur_rek_kode = rekening bank header pengajuan,
            // sama dengan saat BBK dibuat pertama kali)
            await conn.query(
              `
              UPDATE finance.tjurnal SET
                jur_tanggal    = ?,
                jur_keterangan = ?,
                jur_rek_kode   = ?
              WHERE jur_no = ?
            `,
              [d.tglRealisasi, d.ket || "", rek_kode, d.jurnal],
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
            // Detail debet (dengan supplier baris PJT)
            const sup = await ambilSupplierBaris(conn, nomor, d.nourut);
            await conn.query(
              `
              INSERT INTO finance.tjurnalitem
                (jurd_jur_no, jurd_trs, jurd_nourut, jurd_uraian,
                 jurd_debet, jurd_rek_kode, jurd_cc_kode, jurd_dcnama,
                 jurd_sup_kode, jurd_sup_nama, jurd_bank, jurd_rekening,
                 jurd_atasnama)
              VALUES (?, 'BBK', 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `,
              [
                d.jurnal,
                d.ket || "",
                d.nominal,
                d.rekkode || "",
                d.cckode || 0,
                d.dcnama || "",
                sup.kode,
                sup.nama,
                sup.bank,
                sup.rekening,
                sup.atasnama,
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
            // Detail debet (dengan supplier baris PJT)
            const supBaru = await ambilSupplierBaris(conn, nomor, d.nourut);
            await conn.query(
              `
              INSERT INTO finance.tjurnalitem
                (jurd_jur_no, jurd_trs, jurd_nourut, jurd_uraian,
                 jurd_debet, jurd_rek_kode, jurd_cc_kode, jurd_dcnama,
                 jurd_sup_kode, jurd_sup_nama, jurd_bank, jurd_rekening,
                 jurd_atasnama)
              VALUES (?, 'BBK', 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `,
              [
                jurnalNomor,
                d.ket || "",
                d.nominal,
                d.rekkode || "",
                d.cckode || 0,
                d.dcnama || "",
                supBaru.kode,
                supBaru.nama,
                supBaru.bank,
                supBaru.rekening,
                supBaru.atasnama,
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

    await validasiPoLain(conn, detail);
    await validasiKlaimKasKecil(conn, detail, rek_kode, actualNomor);
    await assertSupplierKlaimHanyaLewatKlaim(conn, detail, tanggal);

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
    SELECT COALESCE(NULLIF(s.sup_nama, ''), d.ptd_atasnama) AS namaSupplier,
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
  getSupplierOptions,
  getSupplierDetail,
  getRekapVoucherOptions,
  getVoucherOptions,
  getPoExternalOptions,
  getPettyCashOptions,
  getBkkOptions,
  getPoLainOptions,
  getKlaimKasKecilOptions,
  getDetailForm,
  saveData,
  getPrintData,
};
