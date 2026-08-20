const db = require("../../config/database");

// ─────────────────────────────────────────────────────────
// GENERATE NOMOR — replikasi getmaxnomor().
// Format: FEE.YYYY.NNNN. Delphi: ajumlah = 10001 + maxLast4Digit,
// hasil = RightStr(4) dari ajumlah → efektifnya next = max+1,
// padded 4 digit. Tahun diambil dari TANGGAL FORM (dttanggal),
// BUKAN tanggal server hari ini — direplikasi persis.
// ─────────────────────────────────────────────────────────
const generateNomor = async (tanggal, conn) => {
  const tahun = new Date(tanggal).getFullYear().toString();
  const prefix = `FEE.${tahun}.`;
  const [rows] = await conn.query(
    `SELECT IFNULL(MAX(CAST(RIGHT(fee_nomor, 4) AS UNSIGNED)), 0) AS jumlah
     FROM tpengajuan_fee
     WHERE LEFT(fee_nomor, 9) = ?
     FOR UPDATE`,
    [prefix],
  );
  const next = Number(rows[0].jumlah) + 1;
  return `${prefix}${String(next).padStart(4, "0")}`;
};

// ─────────────────────────────────────────────────────────
// GET CUSTOMER INFO — replikasi edtCusKodeExit().
// cus_aktif = 1 berarti PASIF (konvensi yang sama dipakai di
// seluruh modul lain, mis. invoiceTakNormalFormService).
// ─────────────────────────────────────────────────────────
const getCustomerInfo = async (kode) => {
  const [rows] = await db.query(
    `SELECT cus_kode, cus_nama, cus_alamat, cus_kota, cus_aktif
     FROM tcustomer WHERE cus_kode = ?`,
    [kode],
  );
  if (rows.length === 0) throw new Error("Kode tidak ditemukan.");
  if (rows[0].cus_aktif === 1) throw new Error("Status pasif.");
  return rows[0];
};

// ─────────────────────────────────────────────────────────
// SEARCH INVOICE (F1 di grid Invoice) — replikasi query
// cxGrdMain2EditKeyDown (sqlbantuan). Sumber: piutang_debet JOIN
// tinv_hdr WHERE inv_status_otomatis=0, discope ke customer terpilih.
// ─────────────────────────────────────────────────────────
const searchInvoiceForCustomer = async (custKode, keyword = "") => {
  if (!custKode) throw new Error("Customer belum dipilih.");
  let where = `h.inv_status_otomatis = 0 AND p.customer = ?`;
  const params = [custKode];
  if (keyword) {
    where += ` AND p.nota LIKE ?`;
    params.push(`%${keyword}%`);
  }
  const [rows] = await db.query(
    `SELECT p.nota AS Invoice, DATE_FORMAT(p.tanggal, '%d-%m-%Y') AS Tanggal,
          ROUND(p.debet, 0) AS Nominal,
          ROUND(IFNULL((SELECT SUM(kredit) FROM piutang_kredit_detail WHERE nota = p.nota), 0), 0) AS Bayar,
          ROUND(p.debet - IFNULL((SELECT SUM(kredit) FROM piutang_kredit_detail WHERE nota = p.nota), 0), 0) AS Sisa
    FROM piutang_debet p
    INNER JOIN tinv_hdr h ON h.INV_nomor = p.nota
    WHERE ${where}
    ORDER BY p.tanggal DESC
    LIMIT 100`,
    params,
  );
  return rows;
};

// ─────────────────────────────────────────────────────────
// GET SPK DETAIL UNTUK 1 INVOICE — dipakai bersama oleh checkInvoice
// & getById. Replikasi query akhir loadkode() (TANPA filter
// spk_hargafee<>0 — semua baris ikut tampil, termasuk fee=0 supaya
// bisa di-highlight merah di frontend).
// ─────────────────────────────────────────────────────────
const getSpkDetailForInvoice = async (nomorInvoice) => {
  const [rows] = await db.query(
    `SELECT d.INVD_Spk_Nomor AS Kode, s.spk_nama AS Nama,
            d.INVD_Jumlah AS Jumlah, d.INVD_Harga AS Harga,
            (s.spk_harga - s.spk_hargariil) AS Xfee,
            s.spk_hargariil AS Riil, s.spk_hargafee AS Fee,
            (d.INVD_Jumlah * s.spk_hargafee) AS Total
     FROM tinv_dtl d
     INNER JOIN tspk s ON s.spk_nomor = d.INVD_Spk_Nomor
     WHERE d.INVD_inv_nomor = ?`,
    [nomorInvoice],
  );
  return rows;
};

// ─────────────────────────────────────────────────────────
// CHECK / RESOLVE INVOICE — replikasi loadkode() inti.
// Urutan resolusi PERSIS Delphi:
//   1. Cek tinv_flag: apakah nomor ini "invoice normal" yang sudah
//      di-flag/dipakaikan ke sebuah "invoice tak normal"? Kalau ya,
//      kredit/sisa/no.fp/keterangan diambil dari SISI invoice tak
//      normal (karena pembayaran riil terjadi di sana), tapi nomor
//      yang dipakai tetap nomor invoice normal (ckode).
//   2. Kalau tidak ketemu: cek tinv_hdr utk nomor ini langsung —
//      kalau ternyata ada inv_invpro (nomor invoice proforma
//      terkait), tarik kredit/sisa dari SISI proforma-nya.
//      Kalau tidak, treat sebagai invoice normal biasa.
//   3. Kalau sama sekali tidak ketemu / customer tidak cocok →
//      "Invoice ini tidak ada di customer tsb."
// ⚠️ FIX: Delphi asli punya bug laten — flag `r` bisa ke-set 1 duluan
// lalu query final (branch proforma/normal) ternyata EOF (mis. beda
// customer), tapi kode lanjut baca field dari query kosong itu tanpa
// re-cek. Di sini di-treat eksplisit sebagai error "tidak ditemukan",
// bukan lanjut dengan data kosong/undefined.
// ⚠️ Cek "sudah pernah diajukan" (tpengajuan_fee2.feed_inv_nomor)
// dilakukan DUA KALI: sekali di sini (preview), sekali lagi wajib
// saat save() (defensif thd race condition — Delphi asli cuma cek
// sekali di titik add-row, tidak di-recheck saat simpan).
// ─────────────────────────────────────────────────────────
const checkInvoice = async (custKode, nomorInvoice) => {
  if (!custKode) throw new Error("Customer belum dipilih.");
  if (!nomorInvoice) throw new Error("Nomor invoice wajib diisi.");

  const [sudahRows] = await db.query(
    `SELECT feed_nomor FROM tpengajuan_fee2 WHERE feed_inv_nomor = ?`,
    [nomorInvoice],
  );
  if (sudahRows.length > 0) {
    throw new Error("Invoice tsb sudah pernah di buat pengajuan.");
  }

  let resolved = null; // { nota, tgl, debet, kredit, sisa, nofp, ket, invt }

  // 1. Cek tinv_flag (invoice normal yang sudah dipakaikan ke tak-normal)
  const [flagRows] = await db.query(
    `SELECT f.invf_normal AS nota, DATE_FORMAT(n.tanggal, '%d-%m-%Y') AS tgl,
          ROUND(n.debet, 0) AS debet,
          ROUND(IFNULL((SELECT SUM(kredit) FROM piutang_kredit_detail WHERE nota = t.nota), 0), 0) AS kredit,
          ROUND(t.debet - IFNULL((SELECT SUM(kredit) FROM piutang_kredit_detail WHERE nota = t.nota), 0), 0) AS sisa,
          u.inv_no_fp AS nofp, u.INV_Keterangan AS ket, f.invf_taknormal AS invt
    FROM tinv_flag f
    LEFT JOIN piutang_debet n ON n.nota = f.invf_normal
    LEFT JOIN piutang_debet t ON t.nota = f.invf_taknormal
    LEFT JOIN tinv_hdr u ON u.INV_nomor = f.invf_taknormal
    WHERE f.invf_normal = ? AND n.customer = ?`,
    [nomorInvoice, custKode],
  );
  if (flagRows.length > 0) {
    resolved = flagRows[0];
  } else {
    // 2. Cek tinv_hdr langsung — proforma atau normal
    const [hdrRows] = await db.query(
      `SELECT DATE_FORMAT(h.inv_tanggal, '%d-%m-%Y') AS invtgl,
              ROUND(p.debet, 0) AS debet, h.inv_invpro AS invpro
       FROM tinv_hdr h
       LEFT JOIN piutang_debet p ON p.nota = h.inv_nomor
       WHERE h.inv_nomor = ?`,
      [nomorInvoice],
    );
    if (hdrRows.length > 0) {
      const { invtgl, debet, invpro } = hdrRows[0];
      if (invpro) {
        // Invoice Proforma — kredit/sisa dari sisi proforma
        const [proRows] = await db.query(
          `SELECT
              ROUND(IFNULL((SELECT SUM(kredit) FROM piutang_kredit_detail WHERE nota = p.nota), 0), 0) AS kredit,
              ROUND(p.debet - IFNULL((SELECT SUM(kredit) FROM piutang_kredit_detail WHERE nota = p.nota), 0), 0) AS sisa,
              h.inv_no_fp AS nofp, h.inv_keterangan AS ket, p.nota AS invt
          FROM piutang_debet p
          LEFT JOIN tinv_hdr h ON h.INV_nomor = p.nota
          WHERE p.nota = ? AND p.customer = ?`,
          [invpro, custKode],
        );
        if (proRows.length > 0) {
          resolved = {
            nota: nomorInvoice,
            tgl: invtgl,
            debet,
            kredit: proRows[0].kredit,
            sisa: proRows[0].sisa,
            nofp: proRows[0].nofp,
            ket: proRows[0].ket,
            invt: proRows[0].invt,
          };
        }
      } else {
        // Invoice normal biasa
        const [normRows] = await db.query(
          `SELECT p.nota, DATE_FORMAT(p.tanggal, '%d-%m-%Y') AS tgl,
              ROUND(p.debet, 0) AS debet,
              ROUND(IFNULL((SELECT SUM(kredit) FROM piutang_kredit_detail WHERE nota = p.nota), 0), 0) AS kredit,
              ROUND(p.debet - IFNULL((SELECT SUM(kredit) FROM piutang_kredit_detail WHERE nota = p.nota), 0), 0) AS sisa,
              h.inv_no_fp AS nofp, h.inv_keterangan AS ket
          FROM piutang_debet p
          LEFT JOIN tinv_hdr h ON h.INV_nomor = p.nota
          WHERE p.nota = ? AND p.customer = ?`,
          [nomorInvoice, custKode],
        );
        if (normRows.length > 0) {
          resolved = { ...normRows[0], invt: "" };
        }
      }
    }
  }

  if (!resolved) {
    throw new Error("Invoice ini tidak ada di customer tsb.");
  }

  const detail = await getSpkDetailForInvoice(nomorInvoice);

  return {
    invoice: {
      Kode: nomorInvoice,
      Kodex: nomorInvoice,
      Tanggal: resolved.tgl,
      Pajak: resolved.nofp || "",
      Nominal: Number(resolved.debet) || 0,
      Bayar: Number(resolved.kredit) || 0,
      Sisa: Number(resolved.sisa) || 0,
      Keterangan: resolved.ket || "",
      Invt: resolved.invt || "",
    },
    detail,
  };
};

// ─────────────────────────────────────────────────────────
// GET BY ID (VIEW/REPRINT ONLY — replikasi loaddataall) — form ini
// TIDAK punya mode edit sama sekali di Delphi; "Ubah" di Browse cuma
// menampilkan lalu form langsung ditutup (release). Endpoint ini
// murni untuk keperluan yang sama: preview + siap-cetak-ulang.
// ⚠️ FIX #1: query asli punya bug rumus sisa utk baris non-tak-normal
// (`p.kredit - p.kredit` = selalu 0, jelas typo dari `p.debet - p.kredit`)
// — diperbaiki jadi p.debet - p.kredit.
// ⚠️ FIX #2: query detail SPK di loaddataall asli TIDAK menyertakan
// kolom Xfee sama sekali (beda dari loadkode) — akan merusak
// pewarnaan merah/abu grid di halaman view. Ditambahkan di sini
// pakai getSpkDetailForInvoice() yang sama dgn checkInvoice, supaya
// konsisten.
// ⚠️ FIX #3: loop asli query detail SPK menggunakan referensi field
// yang salah (CDS grid SPK, bukan CDS2 grid invoice yang sedang
// di-iterasi) DAN me-reset (EmptyDataSet) akumulasi tiap iterasi —
// efeknya cuma invoice TERAKHIR yang detailnya benar2 muncul kalau
// pengajuan itu multi-invoice. Diperbaiki: detail dikumpulkan per
// invoice dengan benar, semua baris tetap ada.
// ─────────────────────────────────────────────────────────
const getById = async (nomor) => {
  const [rows] = await db.query(
    `SELECT h.fee_nomor, h.fee_tanggal, h.fee_bank, h.fee_rekening, h.fee_atasnama,
          d.feed_inv_nomor, d.feed_invt_nomor,
          DATE_FORMAT(p.tanggal, '%d-%m-%Y') AS tgl,
          ROUND(p.debet, 0) AS debet,
          IF(d.feed_invt_nomor <> '',
             ROUND(IFNULL((SELECT SUM(kredit) FROM piutang_kredit_detail WHERE nota = t.nota), 0), 0),
             ROUND(IFNULL((SELECT SUM(kredit) FROM piutang_kredit_detail WHERE nota = p.nota), 0), 0)) AS kredit,
          IF(d.feed_invt_nomor <> '',
             ROUND(t.debet - IFNULL((SELECT SUM(kredit) FROM piutang_kredit_detail WHERE nota = t.nota), 0), 0),
             ROUND(p.debet - IFNULL((SELECT SUM(kredit) FROM piutang_kredit_detail WHERE nota = p.nota), 0), 0)) AS sisa,
          IF(d.feed_invt_nomor <> '', u.inv_no_fp, i.inv_no_fp) AS nofp,
          IF(d.feed_invt_nomor <> '', u.inv_keterangan, i.inv_keterangan) AS ket,
          p.customer, c.Cus_nama, c.Cus_alamat, c.Cus_kota
    FROM tpengajuan_fee h
    INNER JOIN tpengajuan_fee2 d ON d.feed_nomor = h.fee_nomor
    LEFT JOIN piutang_debet p ON p.nota = d.feed_inv_nomor
    LEFT JOIN piutang_debet t ON t.nota = d.feed_invt_nomor
    LEFT JOIN tinv_hdr i ON i.INV_nomor = d.feed_inv_nomor
    LEFT JOIN tinv_hdr u ON u.INV_nomor = d.feed_invt_nomor
    LEFT JOIN tcustomer c ON c.Cus_kode = h.fee_cus_kode
    WHERE h.fee_nomor = ?`,
    [nomor],
  );
  if (rows.length === 0)
    throw new Error("Invoice tidak ditemukan di customer tsb.");

  const header = {
    Nomor: rows[0].fee_nomor,
    Tanggal: rows[0].fee_tanggal,
    CusKode: rows[0].customer,
    CusNama: rows[0].Cus_nama,
    CusAlamat: rows[0].Cus_alamat,
    CusKota: rows[0].Cus_kota,
    Bank: rows[0].fee_bank,
    NoRek: rows[0].fee_rekening,
    AtasNama: rows[0].fee_atasnama,
  };

  const invoiceList = [];
  let allDetail = [];
  for (const r of rows) {
    invoiceList.push({
      Kode: r.feed_inv_nomor,
      Kodex: r.feed_inv_nomor,
      Tanggal: r.tgl,
      Pajak: r.nofp || "",
      Nominal: Number(r.debet) || 0,
      Bayar: Number(r.kredit) || 0,
      Sisa: Number(r.sisa) || 0,
      Keterangan: r.ket || "",
      Invt: r.feed_invt_nomor || "",
    });
    const detailRows = await getSpkDetailForInvoice(r.feed_inv_nomor);
    allDetail = allDetail.concat(
      detailRows.map((d) => ({ ...d, Inv: r.feed_inv_nomor })),
    );
  }

  return { header, invoiceList, detail: allDetail };
};

// ─────────────────────────────────────────────────────────
// SAVE — replikasi simpandata() + validasi F10.
// Form ini SELALU CREATE (tidak ada mode edit di source Delphi
// sama sekali — loaddataall murni utk lihat+cetak lalu form ditutup).
// Nomor SELALU digenerate baru di sini, payload TIDAK BOLEH bawa
// nomor existing.
// ─────────────────────────────────────────────────────────
const save = async (payload, user) => {
  const {
    tanggal,
    cusKode,
    bank = "",
    noRek = "",
    atasNama = "",
    invoiceList = [],
  } = payload;

  // ── Validasi dasar ────────────────────────────────────
  if (!cusKode) throw new Error("Customer harus di isi.");

  // Baris invoice valid = yang benar2 sudah diisi (bukan baris
  // kosong trailing) — replikasi filter `tanggal <> ''` di simpandata.
  const validInvoices = invoiceList.filter((r) => r.Kode && r.Tanggal);
  if (validInvoices.length === 0) {
    throw new Error("Minimal harus ada 1 invoice.");
  }

  // ── Validasi #1: semua invoice harus sudah (nyaris) lunas ─
  // Direkalkulasi ULANG dari DB (jangan percaya nilai `Sisa` dari
  // client) — pola yang sama dgn poInternalSjFormService.
  for (const inv of validInvoices) {
    const sisaAktual = await getSisaAktual(inv.Kode, inv.Invt);
    if (sisaAktual >= 500) {
      throw new Error(`Invoice ${inv.Kode} belum lunas.`);
    }
  }

  // ── Validasi #2: SPK dgn selisih harga (xfee<>0) wajib sudah
  // punya fee rate (spk_hargafee<>0) di master tspk ────────────
  for (const inv of validInvoices) {
    const detailRows = await getSpkDetailForInvoice(inv.Kode);
    for (const d of detailRows) {
      const fee = Number(d.Fee) || 0;
      const xfee = Number(d.Xfee) || 0;
      if (fee === 0 && xfee !== 0) {
        throw new Error(`SPK: ${d.Kode} Belum input Fee.`);
      }
    }
  }

  // ── Cek ulang duplikasi "sudah pernah diajukan" (defensif thd
  // race condition antar-user, tidak ada di Delphi tapi masuk akal
  // ditambahkan di sini) ────────────────────────────────────────
  for (const inv of validInvoices) {
    const [dup] = await db.query(
      `SELECT feed_nomor FROM tpengajuan_fee2 WHERE feed_inv_nomor = ?`,
      [inv.Kode],
    );
    if (dup.length > 0) {
      throw new Error(`Invoice ${inv.Kode} sudah pernah di buat pengajuan.`);
    }
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const nomor = await generateNomor(tanggal, conn);

    await conn.query(
      `INSERT INTO tpengajuan_fee
         (fee_nomor, fee_tanggal, fee_cus_kode, fee_bank, fee_rekening,
          fee_atasnama, user_create, date_create)
       VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
      [nomor, tanggal, cusKode, bank, noRek, atasNama, user.kode],
    );

    for (const inv of validInvoices) {
      await conn.query(
        `INSERT INTO tpengajuan_fee2 (feed_nomor, feed_inv_nomor, feed_invt_nomor)
         VALUES (?, ?, ?)`,
        [nomor, inv.Kode, inv.Invt || ""],
      );
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

// Helper: hitung ulang sisa piutang aktual dari DB, mengikuti pola
// sama seperti checkInvoice (tak-normal pakai sisi invt, selain itu
// pakai sisi invoice itu sendiri).
const getSisaAktual = async (nomorInvoice, invt) => {
  const nota = invt && invt.trim() !== "" ? invt : nomorInvoice;
  const [rows] = await db.query(
    `SELECT
       ROUND(p.debet - IFNULL((
         SELECT SUM(kredit) FROM piutang_kredit_detail WHERE nota = p.nota
       ), 0), 0) AS sisa
     FROM piutang_debet p WHERE p.nota = ?`,
    [nota],
  );
  return rows.length > 0 ? Number(rows[0].sisa) || 0 : 0;
};

// ─────────────────────────────────────────────────────────
// GET PRINT DATA — replikasi cetak(). Filter WHERE spk_hargafee<>0
// (baris tanpa fee rate TIDAK ikut tercetak — konsisten dgn temuan
// bahwa fee harus sudah diisi di master sebelum bisa dicetak/diajukan).
// ─────────────────────────────────────────────────────────
const getPrintData = async (nomor) => {
  const [rows] = await db.query(
    `SELECT
       d.feed_inv_nomor AS Invoice,
       DATE_FORMAT(j.INV_tanggal, '%d-%m-%Y') AS Tanggal,
       IF(d.feed_invt_nomor <> '', u.INV_Keterangan, j.INV_Keterangan) AS Keterangan,
       ROUND(p.debet, 0) AS Total,
       IF(d.feed_invt_nomor <> '', u.inv_no_fp, j.inv_no_fp) AS FakturPajak,
       IF(d.feed_invt_nomor <> '', ROUND(t.kredit, 0), ROUND(p.kredit, 0)) AS Bayar,
       (SELECT DATE_FORMAT(a.tanggal, '%d-%m-%Y')
        FROM terima_bayar_debet a
        INNER JOIN piutang_kredit_detail b ON b.no_bukti = a.nomor
        WHERE b.nota = IF(d.feed_invt_nomor <> '', d.feed_invt_nomor, d.feed_inv_nomor)
        ORDER BY a.tanggal DESC LIMIT 1) AS TglBayar,
       i.INVD_Spk_Nomor AS KodeSpk, s.spk_nama AS NamaSpk,
       i.INVD_Jumlah AS Jumlah, i.INVD_Harga AS Harga,
       s.spk_hargariil AS HargaRiil, s.spk_hargafee AS Fee,
       (i.INVD_Jumlah * s.spk_hargafee) AS TotalFee
     FROM tpengajuan_fee h
     LEFT JOIN tpengajuan_fee2 d ON d.feed_nomor = h.fee_nomor
     LEFT JOIN piutang_debet p ON p.nota = d.feed_inv_nomor
     LEFT JOIN piutang_debet t ON t.nota = d.feed_invt_nomor
     LEFT JOIN tinv_hdr u ON u.INV_nomor = d.feed_invt_nomor
     LEFT JOIN tinv_hdr j ON j.INV_nomor = d.feed_inv_nomor
     LEFT JOIN tinv_dtl i ON i.INVD_inv_nomor = j.INV_nomor
     LEFT JOIN tcustomer c ON c.Cus_kode = h.fee_cus_kode
     INNER JOIN tspk s ON s.spk_nomor = i.INVD_Spk_Nomor
     WHERE s.spk_hargafee <> 0 AND h.fee_nomor = ?`,
    [nomor],
  );
  if (rows.length === 0) throw new Error("Data cetak tidak ditemukan.");

  const [[headerRow]] = await db.query(
    `SELECT h.fee_nomor, h.fee_tanggal, h.fee_bank, h.fee_rekening, h.fee_atasnama,
            c.Cus_nama, c.Cus_alamat, c.Cus_kota
     FROM tpengajuan_fee h
     LEFT JOIN tcustomer c ON c.Cus_kode = h.fee_cus_kode
     WHERE h.fee_nomor = ?`,
    [nomor],
  );

  const totalFeeTransfer = rows.reduce(
    (s, r) => s + (Number(r.Jumlah) || 0) * (Number(r.Fee) || 0),
    0,
  );

  return { header: headerRow, detail: rows, totalFeeTransfer };
};

module.exports = {
  generateNomor,
  getCustomerInfo,
  searchInvoiceForCustomer,
  checkInvoice,
  getById,
  save,
  getPrintData,
};
