const db = require("../../config/database");
const tutupBukuService = require("../tutupBukuService");

// ─────────────────────────────────────────────────────────
// GET BROWSE
// Sesuai Delphi btnRefreshClick — query master
// ─────────────────────────────────────────────────────────
const getBrowse = async (tglAwal, tglAkhir, cab = "") => {
  let query = `
    SELECT
      h.bpj_nomor           AS Nomor,
      h.bpj_po_nomor        AS Nomor_PO,
      h.bpj_cab             AS Cab,
      DATE_FORMAT(h.bpj_tanggal, '%Y-%m-%d')       AS Tanggal,
      DATE_FORMAT(h.bpj_jatuhtempo, '%Y-%m-%d')    AS Jatuhtempo,
      RIGHT(g.gdgp_nama, LENGTH(g.gdgp_nama) - 6)  AS Gudang,
      h.bpj_keterangan      AS Keterangan,
      s.sup_nama            AS Supplier,
      po.pojh_spk_nomor     AS Spk_Nomor,
      sk.spk_nama           AS SPK,
      h.bpj_jumlah          AS Jumlah,
      po.pojh_tarif         AS Tarif,
      h.bpj_jumlah * po.pojh_tarif  AS Total,
      IF(h.bpj_status_inv = 1, 'Sudah', 'Belum')       AS Voucher_bayar,
      IF(h.bpj_bayar_realisasi = 1, 'Sudah', 'Belum')  AS BayarkeProduksi,
      (SELECT voud_vou_nomor FROM tvoucher_dtl
       WHERE voud_nota = h.bpj_nomor LIMIT 1)           AS No_voucher,
      IFNULL((
        SELECT IF(pin_acc='' AND pin_dipakai='','WAIT',
               IF(pin_acc='Y' AND pin_dipakai='','ACC',
               IF(pin_acc='Y' AND pin_dipakai='Y','',
               IF(pin_acc='N','TOLAK',''))))
        FROM tspk_pin5
        WHERE pin_trs = 'BPB JASA' AND pin_nomor = h.bpj_nomor
        ORDER BY pin_urut DESC LIMIT 1
      ), '')  AS Ngedit,
      IFNULL((
        SELECT 'Y'
        FROM tspk_pin5
        WHERE pin_acc = '' AND pin_trs = 'BPB JASA HAPUS'
          AND pin_nomor = h.bpj_nomor
        ORDER BY pin_urut DESC LIMIT 1
      ), '')  AS hapus,
      h.user_create         AS Usr,
      DATE_FORMAT(h.date_create, '%Y-%m-%d %H:%i')  AS created
    FROM tbpj_hdr h
    LEFT JOIN tsupplier        s   ON s.sup_kode   = h.bpj_sup_kode
    LEFT JOIN tpojasa_hdr      po  ON po.pojh_nomor = h.bpj_po_nomor
    LEFT JOIN tspk             sk  ON sk.spk_nomor  = po.pojh_spk_nomor
    LEFT JOIN tgudangproduksi  g   ON g.gdgp_kode   = h.bpj_gdgp_kode
    WHERE h.bpj_tanggal >= ? AND h.bpj_tanggal <= ?
  `;
  const params = [tglAwal, tglAkhir];
  if (cab && cab !== "ALL") {
    query += ` AND h.bpj_cab = ?`;
    params.push(cab);
  }
  query += ` ORDER BY h.bpj_nomor`;

  const [rows] = await db.query(query, params);
  return rows;
};

// ─────────────────────────────────────────────────────────
// GET BROWSE DETAIL (sub-row per periode)
// Sesuai Delphi SQLDetail
// ─────────────────────────────────────────────────────────
const getBrowseDetail = async (tglAwal, tglAkhir, cab = "") => {
  let query = `
    SELECT
      h.bpj_nomor           AS Nomor,
      d.bpjd_bhn_kode       AS Kode,
      b.bhn_name            AS Nama,
      d.bpjd_bhn_satuan     AS Satuan,
      d.bpjd_jumlah         AS Jumlah
    FROM tbpj_dtl d
    INNER JOIN tbpj_hdr h ON h.bpj_nomor = d.bpjd_bpj_nomor
    LEFT  JOIN tbahan   b ON b.bhn_kode  = d.bpjd_bhn_kode
    WHERE h.bpj_tanggal >= ? AND h.bpj_tanggal <= ?
  `;
  const params = [tglAwal, tglAkhir];
  if (cab && cab !== "ALL") {
    query += ` AND h.bpj_cab = ?`;
    params.push(cab);
  }
  query += ` ORDER BY h.bpj_nomor`;

  const [rows] = await db.query(query, params);
  return rows;
};

// ─────────────────────────────────────────────────────────
// GET DETAIL BY NOMOR (expand row individual)
// ─────────────────────────────────────────────────────────
const getDetailByNomor = async (nomor) => {
  const [rows] = await db.query(
    `SELECT
       d.bpjd_bhn_kode   AS Kode,
       b.bhn_name        AS Nama,
       d.bpjd_bhn_satuan AS Satuan,
       d.bpjd_jumlah     AS Jumlah
     FROM tbpj_dtl d
     LEFT JOIN tbahan b ON b.bhn_kode = d.bpjd_bhn_kode
     WHERE d.bpjd_bpj_nomor = ?
     ORDER BY d.bpjd_bhn_kode`,
    [nomor],
  );
  return rows;
};

// ─────────────────────────────────────────────────────────
// GET BY NOMOR (untuk form edit)
// ─────────────────────────────────────────────────────────
const getById = async (nomor) => {
  const [[hdr]] = await db.query(
    `SELECT
       h.*,
       DATE_FORMAT(h.bpj_tanggal,    '%Y-%m-%d') AS bpj_tanggal_fmt,
       DATE_FORMAT(h.bpj_jatuhtempo, '%Y-%m-%d') AS bpj_jatuhtempo_fmt,
       s.sup_nama, s.sup_alamat, s.sup_kota,
       po.pojh_tarif, po.pojh_jasa_kode, po.pojh_spk_nomor,
       po.pojh_jumlah AS pojh_jumlah,
       j.jasa_nama,
       sk.spk_nama, sk.spk_jumlah, sk.spk_divisi,
       sk.spk_ukuran, sk.spk_kain, sk.spk_finishing,
       g.gdgp_nama, g.gdgp_cab
     FROM tbpj_hdr h
     LEFT JOIN tsupplier       s   ON s.sup_kode    = h.bpj_sup_kode
     LEFT JOIN tpojasa_hdr     po  ON po.pojh_nomor = h.bpj_po_nomor
     LEFT JOIN tjasa           j   ON j.jasa_kode   = po.pojh_jasa_kode
     LEFT JOIN tspk            sk  ON sk.spk_nomor  = po.pojh_spk_nomor
     LEFT JOIN tgudangproduksi g   ON g.gdgp_kode   = h.bpj_gdgp_kode
     WHERE h.bpj_nomor = ?`,
    [nomor],
  );
  if (!hdr) return null;

  const [dtl] = await db.query(
    `SELECT
       d.*,
       b.bhn_name, b.bhn_satuan
     FROM tbpj_dtl d
     LEFT JOIN tbahan b ON b.bhn_kode = d.bpjd_bhn_kode
     WHERE d.bpjd_bpj_nomor = ?
     ORDER BY d.bpjd_bhn_kode`,
    [nomor],
  );

  // Cek tutup buku & PIN5
  const zdtClose = await tutupBukuService.getTanggalTutupBuku();
  const zClose = await tutupBukuService.getManualTutupBuku("BPB JASA");
  const tglTransaksi = new Date(hdr.bpj_tanggal);
  const isClose = zClose ? tglTransaksi < zClose : tglTransaksi < zdtClose;

  let pin5Status = "";
  let pin5Urut = 0;
  if (isClose) {
    const [pinRows] = await db.query(
      `SELECT pin_acc, pin_dipakai, pin_urut
       FROM tspk_pin5
       WHERE pin_trs = 'BPB JASA' AND pin_nomor = ?
       ORDER BY pin_urut DESC LIMIT 1`,
      [nomor],
    );
    if (!pinRows.length) {
      pin5Status = "MINTA";
    } else {
      const p = pinRows[0];
      pin5Urut = p.pin_urut;
      if (p.pin_acc === "" && p.pin_dipakai === "") pin5Status = "WAIT";
      else if (p.pin_acc === "Y" && p.pin_dipakai === "") pin5Status = "ACC";
      else if (p.pin_acc === "N") pin5Status = "TOLAK";
      else pin5Status = "MINTA";
    }
  }

  return {
    header: {
      ...hdr,
      bpj_tanggal: hdr.bpj_tanggal_fmt,
      bpj_jatuhtempo: hdr.bpj_jatuhtempo_fmt,
    },
    detail: dtl,
    pin5Status,
    pin5Urut,
    isClose,
  };
};

// ─────────────────────────────────────────────────────────
// GENERATE NOMOR BPB JASA
// Format: BPJ/YYMM/NNNN  (perlu konfirmasi format aktual)
// Sesuai pola BPB Bahan: RI.YYMM.XXXX — kemungkinan BPJ/YYMM/NNNN
// ─────────────────────────────────────────────────────────
const generateNomor = async (tanggal, cab) => {
  const d = new Date(tanggal);
  const yy = String(d.getFullYear()).slice(-2);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const prefix = `BPJ/${yy}${mm}/`;

  const conn = await db.getConnection();
  try {
    // FOR UPDATE agar tidak race condition — dipanggil di dalam transaksi
    const [[row]] = await conn.query(
      `SELECT IFNULL(MAX(CAST(RIGHT(bpj_nomor, 4) AS UNSIGNED)), 0) AS max_val
       FROM tbpj_hdr
       WHERE bpj_nomor LIKE ? AND bpj_cab = ?
       FOR UPDATE`,
      [`${prefix}%`, cab],
    );
    const next = parseInt(row.max_val, 10) + 1;
    return `${prefix}${String(next).padStart(4, "0")}`;
  } finally {
    conn.release();
  }
};

// ─────────────────────────────────────────────────────────
// SAVE (INSERT / UPDATE)
// ─────────────────────────────────────────────────────────
const save = async (data, userKode, isNew) => {
  const {
    Tanggal,
    Cab,
    Keterangan = "",
    SupKode,
    PoNomor,
    GdgpKode,
    Jatuhtempo,
    Jumlah,
    StatusInv = 0,
    Detail = [],
    pin5Status = "",
    pin5Urut = null,
  } = data;

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    let nomor = isNew ? null : data.Nomor;

    if (isNew) {
      // Generate nomor di dalam transaksi (sudah FOR UPDATE di generateNomor)
      // Karena generateNomor pakai getConnection sendiri, kita inline di sini:
      const d = new Date(Tanggal);
      const yy = String(d.getFullYear()).slice(-2);
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const prefix = `BPJ/${yy}${mm}/`;
      const [[row]] = await conn.query(
        `SELECT IFNULL(MAX(CAST(RIGHT(bpj_nomor, 4) AS UNSIGNED)), 0) AS max_val
         FROM tbpj_hdr
         WHERE bpj_nomor LIKE ? AND bpj_cab = ?
         FOR UPDATE`,
        [`${prefix}%`, Cab],
      );
      const next = parseInt(row.max_val, 10) + 1;
      nomor = `${prefix}${String(next).padStart(4, "0")}`;

      await conn.query(
        `INSERT INTO tbpj_hdr
           (bpj_nomor, bpj_cab, bpj_tanggal, bpj_keterangan,
            bpj_sup_kode, bpj_po_nomor, bpj_gdgp_kode,
            bpj_jatuhtempo, bpj_jumlah, bpj_status_inv,
            bpj_bayar_realisasi, date_create, user_create)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NOW(), ?)`,
        [
          nomor,
          Cab,
          Tanggal,
          Keterangan,
          SupKode,
          PoNomor,
          GdgpKode,
          Jatuhtempo || Tanggal,
          Number(Jumlah) || 0,
          StatusInv,
          userKode,
        ],
      );
    } else {
      await conn.query(
        `UPDATE tbpj_hdr SET
           bpj_tanggal    = ?, bpj_cab        = ?, bpj_keterangan = ?,
           bpj_sup_kode   = ?, bpj_po_nomor   = ?, bpj_gdgp_kode  = ?,
           bpj_jatuhtempo = ?, bpj_jumlah     = ?,
           date_modified  = NOW(), user_modified  = ?
         WHERE bpj_nomor = ?`,
        [
          Tanggal,
          Cab,
          Keterangan,
          SupKode,
          PoNomor,
          GdgpKode,
          Jatuhtempo || Tanggal,
          Number(Jumlah) || 0,
          userKode,
          nomor,
        ],
      );
    }

    // Delete + insert detail
    await conn.query(`DELETE FROM tbpj_dtl WHERE bpjd_bpj_nomor = ?`, [nomor]);
    const validDetail = Detail.filter((d) => d.kode && Number(d.jumlah) > 0);
    for (const row of validDetail) {
      await conn.query(
        `INSERT INTO tbpj_dtl
           (bpjd_bpj_nomor, bpjd_bhn_kode, bpjd_bhn_satuan, bpjd_jumlah)
         VALUES (?, ?, ?, ?)`,
        [nomor, row.kode, row.satuan || "", Number(row.jumlah) || 0],
      );
    }

    // Jika ACC → tandai PIN5 sudah dipakai
    if (pin5Status === "ACC" && pin5Urut) {
      await conn.query(
        `UPDATE tspk_pin5 SET pin_dipakai = 'Y'
         WHERE pin_trs = 'BPB JASA' AND pin_nomor = ? AND pin_urut = ?`,
        [nomor, pin5Urut],
      );
    }

    await conn.commit();
    return nomor;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
};

// ─────────────────────────────────────────────────────────
// DELETE
// Syarat: bpj_status_inv != 1 (belum ada voucher)
//         date_create = hari ini (WIB)
//         Selain itu → harus via pengajuan PIN5
// ─────────────────────────────────────────────────────────
const deleteData = async (nomor, userCab) => {
  const [[row]] = await db.query(
    `SELECT bpj_cab, bpj_status_inv,
            DATE(date_create) AS tgl_create
     FROM tbpj_hdr WHERE bpj_nomor = ?`,
    [nomor],
  );
  if (!row) throw new Error("Data tidak ditemukan.");

  if (userCab && row.bpj_cab !== userCab)
    throw new Error("Data tsb bukan cabang anda.");

  if (row.bpj_status_inv === 1)
    throw new Error("BPB Jasa ini sudah dibayar. Tidak bisa dihapus.");

  const now = new Date(
    new Date().toLocaleString("en-US", { timeZone: "Asia/Jakarta" }),
  );
  const todayWIB = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  if (row.tgl_create !== todayWIB)
    throw new Error("Perlu Pengajuan Hapus Data.");

  await db.query(`DELETE FROM tbpj_hdr WHERE bpj_nomor = ?`, [nomor]);
  return nomor;
};

// ─────────────────────────────────────────────────────────
// UPDATE STATUS BAYAR KE PRODUKSI
// Sesuai Delphi cxButton5Click — toggle bpj_bayar_realisasi 0↔1
// Syarat: harus ada No_voucher dulu
// ─────────────────────────────────────────────────────────
const updateBayarProduksi = async (nomor, status) => {
  // status: 1 = Sudah, 0 = Belum
  const nilai = status === "Sudah" ? 1 : 0;
  const [result] = await db.query(
    `UPDATE tbpj_hdr SET bpj_bayar_realisasi = ? WHERE bpj_nomor = ?`,
    [nilai, nomor],
  );
  if (result.affectedRows === 0) throw new Error("Data tidak ditemukan.");
  return nilai;
};

// ─────────────────────────────────────────────────────────
// CEK ADA VOUCHER (syarat update bayar produksi)
// ─────────────────────────────────────────────────────────
const cekVoucher = async (nomor) => {
  const [[row]] = await db.query(
    `SELECT voud_vou_nomor
     FROM tvoucher_dtl
     WHERE voud_nota = ? LIMIT 1`,
    [nomor],
  );
  return row ? row.voud_vou_nomor : null;
};

// ─────────────────────────────────────────────────────────
// PENGAJUAN UBAH DATA (PIN5)
// pin_trs = 'BPB JASA'
// ─────────────────────────────────────────────────────────
const pengajuanUbah = async (nomor, tanggal, keterangan, alasan, userKode) => {
  const [[lastPin]] = await db.query(
    `SELECT pin_urut, pin_dipakai
     FROM tspk_pin5
     WHERE pin_trs = 'BPB JASA' AND pin_nomor = ?
     ORDER BY pin_urut DESC LIMIT 1`,
    [nomor],
  );

  let urut = 1;
  if (lastPin) {
    urut =
      lastPin.pin_dipakai === ""
        ? lastPin.pin_urut // belum dipakai → overwrite urut yang sama
        : lastPin.pin_urut + 1; // sudah dipakai → urut baru
  }

  await db.query(
    `INSERT INTO tspk_pin5
       (pin_trs, pin_nomor, pin_urut, pin_tgl_trs, pin_ket,
        pin_tgl_minta, pin_user_minta, pin_alasan)
     VALUES ('BPB JASA', ?, ?, ?, ?, NOW(), ?, ?)
     ON DUPLICATE KEY UPDATE
       pin_tgl_trs = ?, pin_ket = ?,
       pin_acc = '', pin_tgl_minta = NOW(),
       pin_user_minta = ?, pin_alasan = ?`,
    [
      nomor,
      urut,
      tanggal,
      keterangan || "",
      userKode,
      alasan,
      tanggal,
      keterangan || "",
      userKode,
      alasan,
    ],
  );
  return urut;
};

// ─────────────────────────────────────────────────────────
// PENGAJUAN HAPUS DATA (PIN5)
// pin_trs = 'BPB JASA HAPUS'
// Catatan: Delphi pakai 'HAPUS BPB JASA' di insert tapi cek pakai 'BPB JASA HAPUS'
// → ikuti yang di cxGrdMasterCustomDrawCell (hapus field check) = 'BPB JASA HAPUS'
// ─────────────────────────────────────────────────────────
const pengajuanHapus = async (nomor, tanggal, keterangan, alasan, userKode) => {
  const [[lastPin]] = await db.query(
    `SELECT pin_urut FROM tspk_pin5
     WHERE pin_trs = 'BPB JASA HAPUS' AND pin_acc = '' AND pin_nomor = ?`,
    [nomor],
  );

  const urut = lastPin ? lastPin.pin_urut : 1;

  await db.query(
    `INSERT INTO tspk_pin5
       (pin_trs, pin_nomor, pin_urut, pin_tgl_trs, pin_ket, pin_jenis,
        pin_tgl_minta, pin_user_minta, pin_alasan)
     VALUES ('BPB JASA HAPUS', ?, ?, ?, ?, 'HAPUS', NOW(), ?, ?)
     ON DUPLICATE KEY UPDATE
       pin_tgl_trs = ?, pin_ket = ?,
       pin_acc = '', pin_tgl_minta = NOW(),
       pin_user_minta = ?, pin_alasan = ?`,
    [
      nomor,
      urut,
      tanggal,
      keterangan || "",
      userKode,
      alasan,
      tanggal,
      keterangan || "",
      userKode,
      alasan,
    ],
  );
  return urut;
};

// ─────────────────────────────────────────────────────────
// GET DATA CETAK
// ─────────────────────────────────────────────────────────
const getDataCetak = async (nomor) => {
  const [[hdr]] = await db.query(
    `SELECT
       h.bpj_nomor,
       DATE_FORMAT(h.bpj_tanggal, '%Y-%m-%d') AS bpj_tanggal,
       h.bpj_jumlah,
       h.bpj_po_nomor,
       h.user_create,
       po.pojh_nomor,
       po.pojh_tarif,
       po.pojh_jumlah   AS pojh_jumlah,
       po.pojh_status_ppn,
       po.pojh_spk_nomor,
       j.jasa_nama,
       s.sup_nama, s.sup_alamat, s.sup_telp,
       IFNULL(sk.spk_nama,  ms.mspk_nama)    AS spk_nama,
       IFNULL(sk.spk_ukuran, ms.mspk_ukuran) AS spk_ukuran,
       p.perush_nama   AS comp_nama,
       p.perush_alamat AS comp_alamat,
       p.perush_telp   AS comp_telp
     FROM tbpj_hdr h
     INNER JOIN tpojasa_hdr po ON po.pojh_nomor  = h.bpj_po_nomor
     INNER JOIN tjasa        j  ON j.jasa_kode   = po.pojh_jasa_kode
     INNER JOIN tsupplier    s  ON s.sup_kode    = po.pojh_sup_kode
     LEFT  JOIN tspk         sk ON sk.spk_nomor  = po.pojh_spk_nomor
     LEFT  JOIN tmemospk     ms ON ms.mspk_nomor = po.pojh_spk_nomor
     LEFT  JOIN tperusahaan  p  ON p.perush_kode = 'KP'
     WHERE h.bpj_nomor = ?`,
    [nomor],
  );
  if (!hdr) throw new Error("Data tidak ditemukan.");

  // Detail: ambil dari tbpj_dtl langsung (bukan dari pojasa_dtl)
  // karena data yang sudah tersimpan ada di tbpj_dtl
  const [dtl] = await db.query(
    `SELECT
       bd.bpjd_bhn_kode  AS kode,
       b.bhn_name        AS nama,
       bd.bpjd_bhn_satuan AS satuan,
       bd.bpjd_jumlah    AS jumlah
     FROM tbpj_dtl bd
     LEFT JOIN tbahan b ON b.bhn_kode = bd.bpjd_bhn_kode
     WHERE bd.bpjd_bpj_nomor = ?
       AND bd.bpjd_jumlah > 0
     ORDER BY bd.bpjd_bhn_kode`,
    [nomor],
  );

  return { ...hdr, detail: dtl };
};

// ─────────────────────────────────────────────────────────
// EXPORT EXCEL MASTER
// ─────────────────────────────────────────────────────────
const getExportData = async (tglAwal, tglAkhir, cab = "") => {
  return getBrowse(tglAwal, tglAkhir, cab);
};

// ─────────────────────────────────────────────────────────
// EXPORT EXCEL DETAIL
// ─────────────────────────────────────────────────────────
const getExportDetail = async (tglAwal, tglAkhir, cab = "") => {
  let query = `
    SELECT
      h.bpj_nomor                                       AS Nomor,
      h.bpj_cab                                         AS Cab,
      DATE_FORMAT(h.bpj_tanggal, '%Y-%m-%d')           AS Tanggal,
      s.sup_nama                                        AS Supplier,
      po.pojh_spk_nomor                                 AS Spk_Nomor,
      sk.spk_nama                                       AS SPK,
      d.bpjd_bhn_kode                                   AS Kode,
      b.bhn_name                                        AS Nama,
      d.bpjd_bhn_satuan                                 AS Satuan,
      d.bpjd_jumlah                                     AS Jumlah
    FROM tbpj_dtl d
    INNER JOIN tbpj_hdr   h   ON h.bpj_nomor    = d.bpjd_bpj_nomor
    LEFT  JOIN tbahan     b   ON b.bhn_kode     = d.bpjd_bhn_kode
    LEFT  JOIN tsupplier  s   ON s.sup_kode     = h.bpj_sup_kode
    LEFT  JOIN tpojasa_hdr po ON po.pojh_nomor  = h.bpj_po_nomor
    LEFT  JOIN tspk       sk  ON sk.spk_nomor   = po.pojh_spk_nomor
    WHERE h.bpj_tanggal >= ? AND h.bpj_tanggal <= ?
  `;
  const params = [tglAwal, tglAkhir];
  if (cab && cab !== "ALL") {
    query += ` AND h.bpj_cab = ?`;
    params.push(cab);
  }
  query += ` ORDER BY h.bpj_nomor, d.bpjd_bhn_kode`;
  const [rows] = await db.query(query, params);
  return rows;
};

// ─────────────────────────────────────────────────────────
// CEK BISA HAPUS (tanpa proses hapus)
// ─────────────────────────────────────────────────────────
const cekBisaHapus = async (nomor) => {
  const [[row]] = await db.query(
    `SELECT bpj_status_inv, DATE(date_create) AS tgl_create
     FROM tbpj_hdr WHERE bpj_nomor = ?`,
    [nomor],
  );
  if (!row) throw new Error("Data tidak ditemukan.");

  if (row.bpj_status_inv === 1)
    throw new Error("BPB Jasa ini sudah dibayar. Tidak bisa dihapus.");

  const now = new Date(
    new Date().toLocaleString("en-US", { timeZone: "Asia/Jakarta" }),
  );
  const todayWIB = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  return row.tgl_create === todayWIB;
};

// ─────────────────────────────────────────────────────────
// CEK TUTUP BUKU untuk satu nomor
// Dipakai sebelum pengajuan ubah — sesuai Delphi PengajuanPerubahanData1Click
// ─────────────────────────────────────────────────────────
const cekTutupBuku = async (nomor) => {
  const [[row]] = await db.query(
    `SELECT bpj_tanggal, bpj_keterangan FROM tbpj_hdr WHERE bpj_nomor = ?`,
    [nomor],
  );
  if (!row) throw new Error("Data tidak ditemukan.");

  const zdtClose = await tutupBukuService.getTanggalTutupBuku();
  const zClose = await tutupBukuService.getManualTutupBuku("BPB JASA");
  const tglTrx = new Date(row.bpj_tanggal);

  const isClose = zClose ? tglTrx < zClose : tglTrx < zdtClose;

  return {
    isClose,
    tanggal: row.bpj_tanggal,
    keterangan: row.bpj_keterangan,
  };
};

module.exports = {
  getBrowse,
  getBrowseDetail,
  getDetailByNomor,
  getById,
  generateNomor,
  save,
  deleteData,
  updateBayarProduksi,
  cekVoucher,
  pengajuanUbah,
  pengajuanHapus,
  getDataCetak,
  getExportData,
  getExportDetail,
  cekBisaHapus,
  cekTutupBuku,
};
