const db = require("../../config/database");
const tutupBukuService = require("../tutupBukuService");

const TANGGAL_CUTOFF_SJ = "2020-08-24";

// ─────────────────────────────────────────────────────────
// GENERATE NOMOR INVOICE
// Format: ING/{kodePerush}/{NNNNN}/{YYYY}
// ─────────────────────────────────────────────────────────
const generateNomor = async (kodePerush, tanggal, conn) => {
  const tahun = new Date(tanggal).getFullYear();
  const prefix = `ING/${kodePerush}`;

  const [[row]] = await conn.query(
    `SELECT IFNULL(MAX(CAST(SUBSTR(inv_nomor, 8, 5) AS UNSIGNED)), 0) AS max_val
     FROM tinv_hdr
     WHERE LEFT(inv_nomor, 6) = ?
       AND RIGHT(inv_nomor, 4) = ?
     FOR UPDATE`,
    [prefix, String(tahun)],
  );
  const next = parseInt(row.max_val, 10) + 1;
  return `${prefix}/${String(next).padStart(5, "0")}/${tahun}`;
};

// ─────────────────────────────────────────────────────────
// GET BY NOMOR (load edit — loaddataall)
// ─────────────────────────────────────────────────────────
const getById = async (nomor) => {
  const [[hdr]] = await db.query(
    `SELECT
       a.inv_nomor, DATE_FORMAT(a.inv_tanggal,'%Y-%m-%d') AS inv_tanggal,
       a.inv_divisi, a.inv_keterangan,
       a.inv_perush_kode, p.perush_nama,
       a.inv_cus_kode, c.cus_nama, c.cus_alamat, c.cus_kota,
       a.inv_cus_alamat,
       DATE_FORMAT(a.inv_tanggal_tempo,'%Y-%m-%d') AS inv_tanggal_tempo,
       a.inv_rekening, pd.perushd_bank, pd.perushd_atasnama,
       a.inv_invpro,
       a.inv_sts_ppn, a.inv_ppn, a.inv_pph,
       a.inv_disc, a.inv_flag, a.inv_apvnosj,
       a.inv_no_fp
     FROM tinv_hdr a
     INNER JOIN tperusahaan p ON p.perush_kode = a.inv_perush_kode
     INNER JOIN tcustomer c ON c.cus_kode = a.inv_cus_kode
     LEFT JOIN tperusahaan_dtl pd
       ON pd.perushd_perush_kode = p.perush_kode
       AND pd.perushd_rekening = a.inv_rekening
     WHERE a.inv_nomor = ?`,
    [nomor],
  );
  if (!hdr) throw new Error("Nomor tersebut belum ada.");

  // ── Uang Muka — sesuai Delphi hitung() yang selalu panggil getdebet() ──
  hdr.uang_muka = await getDebet(nomor);

  // Detail — sesuai Delphi loaddataall, JOIN tspk + tbarang
  const [dtl] = await db.query(
    `SELECT
       d.invd_sj_nomor, d.invd_spk_nomor, d.invd_ukuran,
       d.invd_jumlah, d.invd_harga, d.invd_nourut,
       IFNULL(s.spk_nama2, x.brg_name) AS spk_nama2,
       (s.spk_jumlah_inv - d.invd_jumlah) AS jml_inv,
       (s.spk_jumlah - s.spk_jumlah_inv + d.invd_jumlah) AS kurang
     FROM tinv_dtl d
     LEFT JOIN tspk s ON s.spk_nomor = d.invd_spk_nomor
     LEFT JOIN tbarang x ON x.brg_kode = d.invd_spk_nomor
     WHERE d.invd_inv_nomor = ?
     ORDER BY d.invd_nourut, d.invd_sj_nomor DESC`,
    [nomor],
  );

  // Untuk tiap baris — cek isSPK, lalu re-fetch daftar SJ terkait (getsj)
  for (const row of dtl) {
    const [[soCheck]] = await db.query(
      `SELECT spk_nomor FROM tspk WHERE spk_nomor = ? AND spk_is_so = 1`,
      [row.invd_spk_nomor],
    );
    if (soCheck) {
      const [sjRows] = await db.query(
        `SELECT DISTINCT d2.sjd_sj_nomor
         FROM tspk turunan
         INNER JOIN tsj_hdr h2 ON h2.sj_perush_kode = ?
         INNER JOIN tsj_dtl d2 ON d2.sjd_sj_nomor = h2.sj_nomor
           AND d2.sjd_spk_nomor = turunan.spk_nomor
         WHERE turunan.spk_so_ref = ?
           AND turunan.spk_is_so = 0`,
        [hdr.inv_perush_kode, row.invd_spk_nomor],
      );
      row.sjList = sjRows.map((r) => r.sjd_sj_nomor).join(",");
    } else {
      row.sjList = "-";
    }
  }

  // PIN5 status
  const [[pin5]] = await db.query(
    `SELECT pin_urut, pin_acc, pin_dipakai, pin_alasan
     FROM tspk_pin5
     WHERE pin_trs = 'INV' AND pin_nomor = ?
     ORDER BY pin_urut DESC LIMIT 1`,
    [nomor],
  );
  let xminta5 = "";
  let xurut5 = 0;
  if (pin5) {
    xurut5 = pin5.pin_urut;
    if (!pin5.pin_acc && !pin5.pin_dipakai) xminta5 = "WAIT";
    else if (pin5.pin_acc === "Y" && !pin5.pin_dipakai) xminta5 = "ACC";
    else if (pin5.pin_acc === "N") xminta5 = "TOLAK";
    else xminta5 = "MINTA";
  }

  // Cek status tutup buku — pola sama seperti SJ
  const tglTrs = new Date(hdr.inv_tanggal);
  const zMonth = tglTrs.getMonth();
  const zYear = tglTrs.getFullYear();
  let ztglclose = 0;
  const [verRows] = await db.query(
    `SELECT tgl_close FROM tversi WHERE aplikasi = 'MANKSI' LIMIT 1`,
  );
  if (verRows.length > 0) ztglclose = parseInt(verRows[0].tgl_close, 10) || 0;
  const limitDate = new Date(zYear, zMonth + 1, ztglclose);
  limitDate.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const zCloseManual = await tutupBukuService.getManualTutupBuku("INV");
  let isTutupBuku = false;
  if (zCloseManual) {
    zCloseManual.setHours(0, 0, 0, 0);
    if (tglTrs < zCloseManual) isTutupBuku = true;
  } else {
    if (limitDate < today) isTutupBuku = true;
  }
  hdr.isTutupBuku = isTutupBuku;

  return { header: hdr, detail: dtl, xminta5, xurut5 };
};

// ─────────────────────────────────────────────────────────
// CEK STATUS PELUNASAN — sesuai Delphi cekstatuspelunasan
// ─────────────────────────────────────────────────────────
const cekStatusPelunasan = async (nomor) => {
  const [[row]] = await db.query(
    `SELECT kredit FROM piutang_debet WHERE nota = ?`,
    [nomor],
  );
  return row ? Number(row.kredit) > 0 : false;
};

// ─────────────────────────────────────────────────────────
// GET DEBET (uang muka) — sesuai Delphi getdebet
// ─────────────────────────────────────────────────────────
const getDebet = async (nomor) => {
  const [[row]] = await db.query(
    `SELECT kredit FROM piutang_debet WHERE nota = ?`,
    [nomor],
  );
  return row ? Number(row.kredit) || 0 : 0;
};

// ─────────────────────────────────────────────────────────
// IS SPK — cek apakah kode adalah SO aktif (bukan SPK turunan)
// Sesuai struktur baru: invd_spk_nomor selalu merujuk ke SO
// ─────────────────────────────────────────────────────────
const isSpk = async (kode) => {
  const [[row]] = await db.query(
    `SELECT spk_nomor FROM tspk WHERE spk_nomor = ? AND spk_is_so = 1`,
    [kode],
  );
  return !!row;
};

// ─────────────────────────────────────────────────────────
// GET SJ LIST untuk SO tertentu
// Sesuai struktur baru: harus lewat jembatan SO → SPK turunan (spk_so_ref) → SJ
// ─────────────────────────────────────────────────────────
const getSjForSpk = async (soNomor, perushKode) => {
  const [rows] = await db.query(
    `SELECT DISTINCT d.sjd_sj_nomor
     FROM tspk turunan
     INNER JOIN tsj_hdr h ON h.sj_perush_kode = ?
     INNER JOIN tsj_dtl d ON d.sjd_sj_nomor = h.sj_nomor
       AND d.sjd_spk_nomor = turunan.spk_nomor
     WHERE turunan.spk_so_ref = ?
       AND turunan.spk_is_so = 0`,
    [perushKode, soNomor],
  );
  return rows.map((r) => r.sjd_sj_nomor).join(",");
};

// ─────────────────────────────────────────────────────────
// SEARCH BARANG/SPK untuk modal F1 di grid
// Tetap dari tbarang LEFT JOIN tspk, tapi sekarang filter spk_is_so=1
// karena barang/harga ada di level SO
// ─────────────────────────────────────────────────────────
const searchBarang = async (
  perushKode,
  cusKode,
  q = "",
  page = 1,
  limit = 50,
) => {
  const limitNum = Number(limit);
  const offset = (Number(page) - 1) * limitNum;
  const like = `%${q}%`;

  let where = `(s.spk_nomor IS NULL OR (s.spk_perush_kode = ? AND s.spk_cus_kode = ? AND s.spk_is_so = 1))`;
  const params = [perushKode, cusKode];

  if (q) {
    where += ` AND (b.brg_kode LIKE ? OR b.brg_name LIKE ?)`;
    params.push(like, like);
  }

  const [[{ total }]] = await db.query(
    `SELECT COUNT(*) AS total
     FROM tbarang b
     LEFT JOIN tspk s ON s.spk_nomor = b.brg_kode AND s.spk_aktif = 'Y'
     WHERE ${where}`,
    params,
  );

  const [rows] = await db.query(
    `SELECT b.brg_kode AS Kode, b.brg_name AS Nama,
            b.brg_ukuran AS Ukuran, b.brg_harga AS Harga
     FROM tbarang b
     LEFT JOIN tspk s ON s.spk_nomor = b.brg_kode AND s.spk_aktif = 'Y'
     WHERE ${where}
     ORDER BY b.brg_kode
     LIMIT ? OFFSET ?`,
    [...params, limitNum, offset],
  );
  return { items: rows, total, page: Number(page), limit: limitNum };
};

// ─────────────────────────────────────────────────────────
// LOAD DETAIL BARANG (saat barang dipilih dari modal/manual)
// Sesuai Delphi loaddatadetail — query ke tspk filter spk_is_so=1
// ─────────────────────────────────────────────────────────
const loadBarangDetail = async (kode, perushKode) => {
  const [[row]] = await db.query(
    `SELECT b.brg_kode, b.brg_name, b.brg_ukuran, b.brg_harga,
            IFNULL(s.spk_jumlah - s.spk_jumlah_inv, 0) AS jumlah,
            s.spk_jumlah_inv,
            (s.spk_jumlah - s.spk_jumlah_inv) AS kurang,
            s.spk_nomor, s.spk_perush_kode, s.spk_cus_kode, s.spk_is_so
     FROM tbarang b
     LEFT JOIN tspk s ON s.spk_nomor = b.brg_kode AND s.spk_aktif = 'Y' AND s.spk_is_so = 1
     WHERE b.brg_kode = ?`,
    [kode],
  );
  if (!row) throw new Error("Barang Tidak di temukan.");

  const spkAda = await isSpk(kode); // sekarang cek SO aktif
  let sjList = "-";
  if (spkAda) {
    sjList = await getSjForSpk(kode, perushKode); // kode di sini = nomor SO
  }

  return {
    Kode: row.brg_kode,
    Nama: row.brg_name,
    Ukuran: row.brg_ukuran,
    Jumlah: row.jumlah,
    Harga: row.brg_harga,
    Total: Number(row.brg_harga) * Number(row.jumlah),
    SjNomor: sjList,
    JmlInv: row.spk_jumlah_inv || 0,
    Kurang: row.kurang || 0,
  };
};

// ─────────────────────────────────────────────────────────
// GET ADA SJ — tidak berubah, logic-nya tetap sama
// karena cuma cek field SjNomor di level row, bukan struktur DB
// ─────────────────────────────────────────────────────────
const cekAdaSjSemua = (detail) => {
  for (const row of detail) {
    const namaSpk = row.NamaSpk || row.spk_nama2 || "";
    const sjNomor = row.SjNomor || "";
    if (namaSpk && (!sjNomor || sjNomor === "" || sjNomor === "-")) {
      return false;
    }
  }
  return true;
};

// ─────────────────────────────────────────────────────────
// CEK IN TINV_FLAG (invoice tidak normal) — sesuai cekinINT
// ─────────────────────────────────────────────────────────
const cekInINT = async (nomor) => {
  const [[row]] = await db.query(
    `SELECT invf_normal FROM tinv_flag WHERE invf_normal = ?`,
    [nomor],
  );
  return !!row;
};

// ─────────────────────────────────────────────────────────
// CEK TUTUP BUKU — sesuai pola SJ
// ─────────────────────────────────────────────────────────
const cekTutupBuku = async (tanggal, xminta5 = "") => {
  if (["MINTA", "WAIT", "TOLAK"].includes(xminta5)) {
    return {
      boleh: false,
      message:
        "Transaksi tsb sudah diclose.\nSilahkan minta approve untuk bisa menyimpan perubahan data.",
    };
  }
  if (xminta5 === "ACC") return { boleh: true };

  const tgl = new Date(tanggal);
  const zMonth = tgl.getMonth();
  const zYear = tgl.getFullYear();

  let ztglclose = 0;
  const [verRows] = await db.query(
    `SELECT tgl_close FROM tversi WHERE aplikasi = 'MANKSI' LIMIT 1`,
  );
  if (verRows.length > 0) ztglclose = parseInt(verRows[0].tgl_close, 10) || 0;

  const limitDate = new Date(zYear, zMonth + 1, ztglclose);
  limitDate.setHours(0, 0, 0, 0);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const zCloseManual = await tutupBukuService.getManualTutupBuku("INV");

  let boleh = true;
  if (zCloseManual) {
    zCloseManual.setHours(0, 0, 0, 0);
    if (tgl < zCloseManual) boleh = false;
  } else {
    if (limitDate < today) boleh = false;
  }

  if (!boleh) {
    return {
      boleh: false,
      message: "Anda tidak boleh input di tanggal periode yg sudah diclose.",
    };
  }
  return { boleh: true };
};

// ─────────────────────────────────────────────────────────
// SAVE — sesuai Delphi simpandata
// ─────────────────────────────────────────────────────────
const save = async (data, userKode, isNew) => {
  const {
    Divisi,
    KodePerush,
    Tanggal,
    Keterangan,
    KodeCus,
    AlamatCus,
    TanggalTempo,
    RekBank = "",
    InvPro = "",
    StsPpn = 0,
    Ppn = 0,
    Pph = "",
    Disc = 0,
    Detail = [],
    NomorInv = "",
    Xminta5 = "",
    Xurut5 = 0,
    ApvOverride, // 'N' | '' | undefined — hasil keputusan frontend soal approval
  } = data;

  // ── Validasi dasar ──────────────────────────────────────
  if (!KodePerush) throw new Error("Perusahaan belum di isi.");
  if (!KodeCus) throw new Error("Customer belum di isi.");

  const validDetail = Detail.filter((r) => r.NamaSpk || r.Kode);
  if (!validDetail.length)
    throw new Error("Tidak ada detail, tidak dapat di simpan.");

  // Cek status pelunasan saat edit — sesuai Delphi
  if (!isNew) {
    const sudahLunas = await cekStatusPelunasan(NomorInv);
    if (sudahLunas) {
      throw new Error(
        "Invoice ini sudah dibuat pelunasan, tidak bisa di edit.",
      );
    }
  }

  // Cek tutup buku
  const tutupBuku = await cekTutupBuku(Tanggal, Xminta5);
  if (!tutupBuku.boleh) {
    throw new Error(tutupBuku.message);
  }

  const divisiStr = String(Divisi).charAt(0);

  // ── Logic apv & pro — sesuai Delphi simpandata ──────────
  let apv = ApvOverride !== undefined ? ApvOverride : "";
  let pro;

  if (!InvPro || !InvPro.trim()) {
    const adaSjSemua = cekAdaSjSemua(validDetail);
    if (adaSjSemua) {
      pro = 0;
      apv = "";
    } else {
      if (apv && apv !== "N" && apv !== "T") {
        pro = 0;
      } else {
        pro = 1;
        apv = "N";
      }
    }
  } else {
    pro = 1;
    apv = "";
  }

  const xppn = StsPpn ? Number(Ppn) : 0;
  const cpph = Pph === "PPh" ? "PPh" : "";

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    let nomor = isNew
      ? await generateNomor(KodePerush, Tanggal, conn)
      : NomorInv;
    const isFlagExcluded = !isNew ? await cekInINT(nomor) : false;

    // ── Header ────────────────────────────────────────────
    if (isNew) {
      await conn.query(
        `INSERT INTO tinv_hdr
           (inv_nomor, inv_divisi, inv_tanggal, inv_keterangan,
            inv_perush_kode, inv_cus_kode, inv_cus_alamat,
            inv_tanggal_tempo, inv_rekening, inv_invpro,
            inv_sts_ppn, inv_ppn, inv_flag, inv_disc, inv_pph,
            inv_apvnosj, date_create, user_create)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NOW(),?)`,
        [
          nomor,
          divisiStr,
          Tanggal,
          Keterangan,
          KodePerush,
          KodeCus,
          AlamatCus,
          TanggalTempo,
          RekBank,
          InvPro,
          StsPpn,
          xppn,
          pro,
          Disc,
          cpph,
          apv,
          userKode,
        ],
      );
    } else {
      let updateFields = `
        inv_tanggal = ?, inv_keterangan = ?,
        inv_perush_kode = ?, inv_cus_kode = ?, inv_cus_alamat = ?,
        inv_tanggal_tempo = ?, inv_rekening = ?, inv_invpro = ?,
        inv_sts_ppn = ?, inv_ppn = ?,`;
      const updateParams = [
        Tanggal,
        Keterangan,
        KodePerush,
        KodeCus,
        AlamatCus,
        TanggalTempo,
        RekBank,
        InvPro,
        StsPpn,
        xppn,
      ];

      if (!isFlagExcluded) {
        updateFields += ` inv_flag = ?,`;
        updateParams.push(pro);
      }

      updateFields += `
        inv_disc = ?, inv_pph = ?, inv_apvnosj = ?,
        date_modified = NOW(), user_modified = ?
        WHERE inv_nomor = ?`;
      updateParams.push(Disc, cpph, apv, userKode, nomor);

      await conn.query(`UPDATE tinv_hdr SET ${updateFields}`, updateParams);
    }

    // ── Detail ─────────────────────────────────────────────
    await conn.query(`DELETE FROM tinv_dtl WHERE invd_inv_nomor = ?`, [nomor]);
    await conn.query(
      `UPDATE tsj_hdr SET sj_inv_nomor = "" WHERE sj_inv_nomor = ?`,
      [nomor],
    );

    let urut = 1;
    for (const row of validDetail) {
      const sjNomor = row.SjNomor && row.SjNomor !== "-" ? row.SjNomor : "";

      await conn.query(
        `INSERT INTO tinv_dtl
           (invd_inv_nomor, invd_sj_nomor, invd_spk_nomor,
            invd_ukuran, invd_jumlah, invd_harga, invd_nourut)
         VALUES (?,?,?,?,?,?,?)`,
        [
          nomor,
          sjNomor,
          row.Kode,
          row.Ukuran || "",
          Number(row.Jumlah),
          Number(row.Harga || 0),
          urut,
        ],
      );

      // ── Update SJ terkait + auto-approval ────────────────
      if (sjNomor) {
        const sjArray = sjNomor
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        for (const csj of sjArray) {
          await conn.query(
            `UPDATE tsj_hdr SET sj_approve = 1, sj_inv_nomor = ? WHERE sj_nomor = ?`,
            [nomor, csj],
          );

          // Cari SPK turunan yang terkait dengan SO ini & SJ ini
          const [[sjInfo]] = await conn.query(
            `SELECT h.sj_gdg_kode, d.sjd_jumlah, h.date_create, d.sjd_spk_nomor AS spk_turunan
       FROM tsj_hdr h
       INNER JOIN tsj_dtl d ON d.sjd_sj_nomor = h.sj_nomor
       INNER JOIN tspk turunan ON turunan.spk_nomor = d.sjd_spk_nomor
         AND turunan.spk_so_ref = ?
         AND turunan.spk_is_so = 0
       WHERE h.sj_nomor = ?`,
            [row.Kode, csj], // row.Kode = nomor SO
          );

          if (
            sjInfo &&
            new Date(sjInfo.date_create) >= new Date(TANGGAL_CUTOFF_SJ)
          ) {
            const [[existing]] = await conn.query(
              `SELECT * FROM tsj_approve
         WHERE sja_nomor = ? AND sja_spk_nomor = ? AND sja_gdg_kode = ?`,
              [csj, sjInfo.spk_turunan, sjInfo.sj_gdg_kode],
            );
            if (!existing) {
              await conn.query(
                `INSERT INTO tsj_approve (sja_nomor, sja_spk_nomor, sja_jumlah, sja_gdg_kode)
           VALUES (?, ?, ?, ?)`,
                [
                  csj,
                  sjInfo.spk_turunan,
                  sjInfo.sjd_jumlah,
                  sjInfo.sj_gdg_kode,
                ],
              );
            }
          }
        }
      }
      urut++;
    }

    // ── Approval invoice belum buat SJ (tapprove) ──────────
    if (apv === "") {
      await conn.query(
        `DELETE FROM tapprove WHERE pin_jenis = 'INVBLMSJ' AND pin_nomor = ? AND pin_acc = ''`,
        [nomor],
      );
    } else if (apv === "N") {
      await conn.query(
        `INSERT INTO tapprove (pin_jenis, pin_nomor, pin_tgl_minta, pin_user_minta)
         VALUES ('INVBLMSJ', ?, NOW(), ?)
         ON DUPLICATE KEY UPDATE
           pin_tgl_pin = NULL, pin_user_pin = '', pin_acc = '',
           pin_tgl_minta = NOW(), pin_user_minta = ?`,
        [nomor, userKode, userKode],
      );
    }

    // ── PIN5 ACC dipakai ────────────────────────────────────
    if (Xminta5 === "ACC" && Xurut5) {
      await conn.query(
        `UPDATE tspk_pin5 SET pin_dipakai = 'Y'
         WHERE pin_trs = 'INV' AND pin_nomor = ? AND pin_urut = ?`,
        [nomor, Xurut5],
      );
    }

    // ── Update piutang_debet.flag (exclude jika invoice tidak normal) ──
    if (!isFlagExcluded) {
      await conn.query(`UPDATE piutang_debet SET flag = ? WHERE nota = ?`, [
        pro,
        nomor,
      ]);
    }

    await conn.commit();
    return { nomor, apv };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
};

// ─────────────────────────────────────────────────────────
// VALIDASI: ada SPK baru tanpa SJ saat invoice sudah approved
// Sesuai Delphi pengecekan sebelum tombol simpan
// ─────────────────────────────────────────────────────────
const cekSpkBaruTanpaSj = (detail, currentApv) => {
  if (!currentApv || currentApv === "N" || currentApv === "T") return false;
  for (const row of detail) {
    const isNewRow = !row.IsExisting; // baris baru ditambahkan user
    if (row.NamaSpk && (!row.SjNomor || row.SjNomor === "") && isNewRow) {
      return true;
    }
  }
  return false;
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
// CUSTOMER EXIT — get TOP untuk jatuh tempo otomatis
// ─────────────────────────────────────────────────────────
const getCustomerInfo = async (kode) => {
  const [[row]] = await db.query(
    `SELECT cus_kode, cus_nama, cus_alamat, cus_kota, cus_top, cus_aktif
     FROM tcustomer WHERE cus_kode = ?`,
    [kode],
  );
  if (!row) throw new Error("Kode tidak ditemukan.");
  if (row.cus_aktif === 1) throw new Error("Status pasif.");
  return row;
};

// ─────────────────────────────────────────────────────────
// VALIDASI INVOICE PROFORMA — sesuai edtinvproExit
// ─────────────────────────────────────────────────────────
const validateInvPro = async (nomorPro, cusKode) => {
  const [[row]] = await db.query(
    `SELECT inv_nomor, inv_sts_pro FROM tinv_hdr
     WHERE inv_nomor = ? AND inv_cus_kode = ?`,
    [nomorPro, cusKode],
  );
  if (!row) throw new Error("Invoice tidak ditemukan di Customer ini.");
  if (row.inv_sts_pro !== 1)
    throw new Error("Invoice ini bukan Invoice Proforma.");
  return row;
};

// ─────────────────────────────────────────────────────────
// GET REKENING PERUSAHAAN (lookup bank)
// ─────────────────────────────────────────────────────────
const getRekeningPerush = async (perushKode) => {
  const [rows] = await db.query(
    `SELECT perushd_rekening AS Rekening,
            perushd_bank AS Bank,
            perushd_atasnama AS AtasNama
     FROM tperusahaan_dtl
     WHERE perushd_perush_kode = ?`,
    [perushKode],
  );
  return rows;
};

const getDataCetak = async (nomor) => {
  const [[hdr]] = await db.query(
    `SELECT
       a.inv_nomor, DATE_FORMAT(a.inv_tanggal,'%d-%m-%Y') AS inv_tanggal_fmt,
       a.inv_keterangan, a.inv_cus_alamat,
       a.inv_disc, a.inv_sts_ppn, a.inv_ppn, a.inv_pph,
       a.inv_rekening, a.inv_perush_kode,
       a.user_create,
       p.perush_nama, p.perush_alamat, p.perush_kota, p.perush_telp,
       c.cus_nama, c.cus_alamat, c.cus_telp, c.cus_fax,
       pd.perushd_bank, pd.perushd_atasnama,
       DATE_FORMAT(a.date_create,'%d-%m-%Y %T') AS created
     FROM tinv_hdr a
     INNER JOIN tperusahaan p ON p.perush_kode = a.inv_perush_kode
     INNER JOIN tcustomer c   ON c.cus_kode    = a.inv_cus_kode
     LEFT JOIN tperusahaan_dtl pd
       ON pd.perushd_perush_kode = p.perush_kode
       AND pd.perushd_rekening = a.inv_rekening
     WHERE a.inv_nomor = ?`,
    [nomor],
  );
  if (!hdr) throw new Error("Data tidak ditemukan.");

  const [dtl] = await db.query(
    `SELECT
       d.invd_spk_nomor, d.invd_ukuran, d.invd_jumlah, d.invd_harga,
       d.invd_nourut,
       IFNULL(s.spk_nama2, x.brg_name) AS nama_barang
     FROM tinv_dtl d
     LEFT JOIN tspk s    ON s.spk_nomor = d.invd_spk_nomor
     LEFT JOIN tbarang x ON x.brg_kode  = d.invd_spk_nomor
     WHERE d.invd_inv_nomor = ?
     ORDER BY d.invd_nourut, d.invd_sj_nomor DESC`,
    [nomor],
  );

  const totalBarang = dtl.reduce(
    (s, r) => s + Number(r.invd_jumlah || 0) * Number(r.invd_harga || 0),
    0,
  );
  const disc = Number(hdr.inv_disc || 0);

  let totalPpn = 0;
  let grandTotal;
  if (hdr.inv_sts_ppn === 1) {
    if (hdr.inv_pph === "PPh") {
      totalPpn = totalBarang * (Number(hdr.inv_ppn) / 100);
      grandTotal = totalBarang - disc + totalPpn;
    } else {
      const baseAfterDisc = totalBarang - disc;
      totalPpn = baseAfterDisc * (Number(hdr.inv_ppn) / 100);
      grandTotal = baseAfterDisc + totalPpn;
    }
  } else {
    grandTotal = totalBarang - disc;
  }

  const [[debetRow]] = await db.query(
    `SELECT kredit FROM piutang_debet WHERE nota = ?`,
    [nomor],
  );
  const uangMuka = debetRow ? Number(debetRow.kredit) || 0 : 0;
  const nilaiPiutang = grandTotal - uangMuka;

  return {
    header: hdr,
    detail: dtl,
    totalBarang,
    totalPpn,
    grandTotal,
    uangMuka,
    nilaiPiutang,
    disc,
  };
};

module.exports = {
  generateNomor,
  getById,
  cekStatusPelunasan,
  getDebet,
  isSpk,
  getSjForSpk,
  searchBarang,
  loadBarangDetail,
  cekAdaSjSemua,
  cekInINT,
  cekTutupBuku,
  save,
  cekSpkBaruTanpaSj,
  getDivisiList,
  getCustomerInfo,
  validateInvPro,
  getRekeningPerush,
  getDataCetak,
};
