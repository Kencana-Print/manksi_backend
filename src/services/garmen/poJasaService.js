const db = require("../../config/database");
const tutupBukuService = require("../tutupBukuService");

// ─────────────────────────────────────────────────────────
// GET BROWSE
// Sesuai Delphi btnRefreshClick — query master + sub-detail
// ─────────────────────────────────────────────────────────
const getBrowse = async (tglAwal, tglAkhir, cab = "") => {
  let query = `
    SELECT
      h.pojh_nomor          AS Nomor,
      h.pojh_cab            AS Cab,
      DATE_FORMAT(h.pojh_tanggal, '%Y-%m-%d') AS Tanggal,
      j.jasa_nama           AS Jasa,
      h.pojh_keterangan     AS Keterangan,
      h.pojh_sup_kode       AS KodeSupplier,
      s.sup_nama            AS Supplier,
      RIGHT(g.gdgp_nama, LENGTH(g.gdgp_nama) - 3) AS Gudang,
      h.pojh_spk_nomor      AS SPK,
      sk.spk_nama           AS spk_nama,
      h.pojh_tarif          AS pojh_tarif,
      h.pojh_jumlah         AS pojh_jumlah,
      h.pojh_jasa_kode      AS JasaKode,
      IF(h.pojh_status_rec = 1,
        IF((SELECT COUNT(*) FROM tpojasa_dtl
            WHERE pojd_status = 0 AND pojd_pojh_nomor = h.pojh_nomor) > 0,
          'Proses', 'Closed'),
        'Belum'
      )                     AS Status,
      h.user_create         AS Usr,
      DATE_FORMAT(h.date_create, '%Y-%m-%d %H:%i') AS Created,
      IFNULL((
        SELECT IF(pin_acc='' AND pin_dipakai='','WAIT',
               IF(pin_acc='Y' AND pin_dipakai='','ACC',
               IF(pin_acc='Y' AND pin_dipakai='Y','',
               IF(pin_acc='N','TOLAK',''))))
        FROM tspk_pin5
        WHERE pin_trs = 'PO JASA' AND pin_nomor = h.pojh_nomor
        ORDER BY pin_urut DESC LIMIT 1
      ), '')                AS Ngedit,
      IFNULL((
        SELECT 'Y'
        FROM tspk_pin5
        WHERE pin_acc = '' AND pin_trs = 'PO JASA HAPUS'
          AND pin_nomor = h.pojh_nomor
        ORDER BY pin_urut DESC LIMIT 1
      ), '')                AS hapus
    FROM tpojasa_hdr h
    INNER JOIN tsupplier    s  ON s.sup_kode = h.pojh_sup_kode
    INNER JOIN tspk         sk ON sk.spk_nomor = h.pojh_spk_nomor
    LEFT  JOIN tgudangproduksi g ON g.gdgp_kode = h.pojh_gdgp_kode
    LEFT  JOIN tjasa        j  ON j.jasa_kode = h.pojh_jasa_kode
    WHERE h.pojh_tanggal >= ? AND h.pojh_tanggal <= ?
  `;
  const params = [tglAwal, tglAkhir];
  if (cab && cab !== "ALL") {
    query += ` AND h.pojh_cab = ?`;
    params.push(cab);
  }
  query += ` ORDER BY h.pojh_nomor`;

  const [rows] = await db.query(query, params);
  return rows;
};

// ─────────────────────────────────────────────────────────
// GET BROWSE DETAIL (sub-row per nomor)
// Sesuai Delphi SQLDetail
// ─────────────────────────────────────────────────────────
const getBrowseDetail = async (tglAwal, tglAkhir, cab = "") => {
  let query = `
    SELECT
      d.pojd_pojh_nomor     AS Nomor,
      d.pojd_bhn_kode       AS Kode,
      b.bhn_name            AS Nama,
      d.pojd_bhn_satuan     AS Satuan,
      d.pojd_jumlah         AS Jumlah,
      d.pojd_jumlah_terima  AS Terima,
      IF(d.pojd_status = 0, 'Delay',
         IF(d.pojd_status = 1, 'True', 'Cancel')) AS Status_barang
    FROM tpojasa_dtl d
    INNER JOIN tbahan      b ON b.bhn_kode = d.pojd_bhn_kode
    INNER JOIN tpojasa_hdr h ON h.pojh_nomor = d.pojd_pojh_nomor
    WHERE h.pojh_tanggal >= ? AND h.pojh_tanggal <= ?
  `;
  const params = [tglAwal, tglAkhir];
  if (cab && cab !== "ALL") {
    query += ` AND h.pojh_cab = ?`;
    params.push(cab);
  }
  query += ` ORDER BY d.pojd_pojh_nomor`;

  const [rows] = await db.query(query, params);
  return rows;
};

// ─────────────────────────────────────────────────────────
// GET DETAIL BY NOMOR (untuk expand row individual)
// ─────────────────────────────────────────────────────────
const getDetailByNomor = async (nomor) => {
  const [rows] = await db.query(
    `SELECT
       d.pojd_bhn_kode      AS Kode,
       b.bhn_name           AS Nama,
       d.pojd_bhn_satuan    AS Satuan,
       d.pojd_jumlah        AS Jumlah,
       d.pojd_jumlah_terima AS Terima,
       IF(d.pojd_status = 0, 'Delay',
          IF(d.pojd_status = 1, 'True', 'Cancel')) AS Status_barang
     FROM tpojasa_dtl d
     INNER JOIN tbahan b ON b.bhn_kode = d.pojd_bhn_kode
     WHERE d.pojd_pojh_nomor = ?
     ORDER BY d.pojd_bhn_kode`,
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
       DATE_FORMAT(h.pojh_tanggal, '%Y-%m-%d') AS pojh_tanggal_fmt,
       j.jasa_nama,
       s.sup_nama, s.sup_alamat, s.sup_kota,
       sk.spk_nama, sk.spk_jumlah, sk.spk_divisi,
       sk.spk_ukuran, sk.spk_kain, sk.spk_finishing,
       g.gdgp_nama, g.gdgp_cab
     FROM tpojasa_hdr h
     LEFT JOIN tjasa            j  ON j.jasa_kode = h.pojh_jasa_kode
     LEFT JOIN tsupplier        s  ON s.sup_kode = h.pojh_sup_kode
     LEFT JOIN tspk             sk ON sk.spk_nomor = h.pojh_spk_nomor
     LEFT JOIN tgudangproduksi  g  ON g.gdgp_kode = h.pojh_gdgp_kode
     WHERE h.pojh_nomor = ?`,
    [nomor],
  );
  if (!hdr) return null;

  const [dtl] = await db.query(
    `SELECT
       d.*,
       b.bhn_name, b.bhn_satuan
     FROM tpojasa_dtl d
     LEFT JOIN tbahan b ON b.bhn_kode = d.pojd_bhn_kode
     WHERE d.pojd_pojh_nomor = ?
     ORDER BY d.pojd_bhn_kode`,
    [nomor],
  );

  // Cek tutup buku & PIN5
  const zdtClose = await tutupBukuService.getTanggalTutupBuku();
  const zClose = await tutupBukuService.getManualTutupBuku("PO JASA");
  const tglTransaksi = new Date(hdr.pojh_tanggal);
  let isClose = zClose ? tglTransaksi < zClose : tglTransaksi < zdtClose;

  let pin5Status = "";
  let pin5Urut = 0;
  if (isClose) {
    const [pinRows] = await db.query(
      `SELECT pin_acc, pin_dipakai, pin_urut
       FROM tspk_pin5
       WHERE pin_trs = 'PO JASA' AND pin_nomor = ?
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
    header: { ...hdr, pojh_tanggal: hdr.pojh_tanggal_fmt },
    detail: dtl,
    pin5Status,
    pin5Urut,
    isClose,
  };
};

// ─────────────────────────────────────────────────────────
// GENERATE NOMOR
// Format: PJG/NNNNN/YYYY
// ─────────────────────────────────────────────────────────
const generateNomor = async (tanggal, cab) => {
  const tahun = new Date(tanggal).getFullYear();
  // Sesuai screenshot: PJG/04693/2026
  const [[row]] = await db.query(
    `SELECT IFNULL(MAX(CAST(MID(pojh_nomor, 5, 5) AS UNSIGNED)), 0) AS max_val
     FROM tpojasa_hdr
     WHERE RIGHT(pojh_nomor, 4) = ? AND pojh_cab = ?`,
    [String(tahun), cab],
  );
  const next = parseInt(row.max_val, 10) + 1;
  return `PJG/${String(next).padStart(5, "0")}/${tahun}`;
};

// ─────────────────────────────────────────────────────────
// SAVE (INSERT / UPDATE)
// ─────────────────────────────────────────────────────────
const save = async (data, userKode, isNew) => {
  const {
    Tanggal,
    Cab,
    Keterangan,
    JasaKode,
    SupKode,
    GdgpKode,
    SpkNomor,
    Tarif,
    Jumlah,
    StatusRec = 1,
    Detail = [],
    pin5Status = "",
    pin5Urut = null,
  } = data;

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    let nomor = isNew ? await generateNomor(Tanggal, Cab) : data.Nomor;

    if (isNew) {
      await conn.query(
        `INSERT INTO tpojasa_hdr
           (pojh_nomor, pojh_cab, pojh_tanggal, pojh_keterangan,
            pojh_jasa_kode, pojh_sup_kode, pojh_gdgp_kode,
            pojh_spk_nomor, pojh_tarif, pojh_jumlah, pojh_status_rec,
            date_create, user_create)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?)`,
        [
          nomor,
          Cab,
          Tanggal,
          Keterangan || "",
          JasaKode,
          SupKode,
          GdgpKode,
          SpkNomor,
          Tarif || 0,
          Jumlah || 0,
          StatusRec,
          userKode,
        ],
      );
    } else {
      await conn.query(
        `UPDATE tpojasa_hdr SET
           pojh_tanggal = ?, pojh_cab = ?, pojh_keterangan = ?,
           pojh_jasa_kode = ?, pojh_sup_kode = ?, pojh_gdgp_kode = ?,
           pojh_spk_nomor = ?, pojh_tarif = ?, pojh_jumlah = ?,
           date_modified = NOW(), user_modified = ?
         WHERE pojh_nomor = ?`,
        [
          Tanggal,
          Cab,
          Keterangan || "",
          JasaKode,
          SupKode,
          GdgpKode,
          SpkNomor,
          Tarif || 0,
          Jumlah || 0,
          userKode,
          nomor,
        ],
      );
    }

    // Delete + insert detail
    await conn.query(`DELETE FROM tpojasa_dtl WHERE pojd_pojh_nomor = ?`, [
      nomor,
    ]);

    const validDetail = Detail.filter((d) => d.kode && Number(d.jumlah) > 0);
    for (const row of validDetail) {
      await conn.query(
        `INSERT INTO tpojasa_dtl
           (pojd_pojh_nomor, pojd_bhn_kode, pojd_bhn_satuan,
            pojd_jumlah, pojd_jumlah_terima, pojd_status)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          nomor,
          row.kode,
          row.satuan || "",
          Number(row.jumlah) || 0,
          Number(row.terima) || 0,
          row.status ?? 0,
        ],
      );
    }

    // Jika ACC → tandai PIN5 sudah dipakai
    if (pin5Status === "ACC" && pin5Urut) {
      await conn.query(
        `UPDATE tspk_pin5 SET pin_dipakai = 'Y'
         WHERE pin_trs = 'PO JASA' AND pin_nomor = ? AND pin_urut = ?`,
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
// Hanya boleh hapus jika date_create = hari ini
// Selain itu harus via pengajuan PIN5
// ─────────────────────────────────────────────────────────
const deleteData = async (nomor, userCab) => {
  const [[row]] = await db.query(
    `SELECT pojh_cab, DATE(date_create) AS tgl_create FROM tpojasa_hdr WHERE pojh_nomor = ?`,
    [nomor],
  );
  if (!row) throw new Error("Data tidak ditemukan.");

  // Validasi cabang
  if (userCab && row.pojh_cab !== userCab) {
    throw new Error("Data tsb bukan cabang anda.");
  }

  // Hanya boleh hapus jika dibuat hari ini
  const today = new Date().toISOString().split("T")[0];
  // Gunakan WIB
  const d = new Date(
    new Date().toLocaleString("en-US", { timeZone: "Asia/Jakarta" }),
  );
  const todayWIB = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  if (row.tgl_create !== todayWIB) {
    throw new Error("Perlu Pengajuan Hapus Data.");
  }

  await db.query(`DELETE FROM tpojasa_hdr WHERE pojh_nomor = ?`, [nomor]);
  return nomor;
};

// ─────────────────────────────────────────────────────────
// PENGAJUAN UBAH DATA (PIN5)
// Sesuai Delphi PengajuanPerubahanData1Click
// ─────────────────────────────────────────────────────────
const pengajuanUbah = async (nomor, tanggal, keterangan, alasan, userKode) => {
  // Ambil urut terakhir
  const [[lastPin]] = await db.query(
    `SELECT pin_urut, pin_dipakai
     FROM tspk_pin5
     WHERE pin_trs = 'PO JASA' AND pin_nomor = ?
     ORDER BY pin_urut DESC LIMIT 1`,
    [nomor],
  );

  let urut = 1;
  if (lastPin) {
    urut =
      lastPin.pin_dipakai === ""
        ? lastPin.pin_urut // belum dipakai → overwrite
        : lastPin.pin_urut + 1; // sudah dipakai → urut baru
  }

  await db.query(
    `INSERT INTO tspk_pin5
       (pin_trs, pin_nomor, pin_urut, pin_tgl_trs, pin_ket,
        pin_tgl_minta, pin_user_minta, pin_alasan)
     VALUES ('PO JASA', ?, ?, ?, ?, NOW(), ?, ?)
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
// Sesuai Delphi PengajuanPenghapusanData1Click
// ─────────────────────────────────────────────────────────
const pengajuanHapus = async (nomor, tanggal, keterangan, alasan, userKode) => {
  const [[lastPin]] = await db.query(
    `SELECT pin_urut FROM tspk_pin5
     WHERE pin_trs = 'PO JASA HAPUS' AND pin_acc = '' AND pin_nomor = ?`,
    [nomor],
  );

  const urut = lastPin ? lastPin.pin_urut : 1;

  await db.query(
    `INSERT INTO tspk_pin5
       (pin_trs, pin_nomor, pin_urut, pin_tgl_trs, pin_ket, pin_jenis,
        pin_tgl_minta, pin_user_minta, pin_alasan)
     VALUES ('HAPUS PO JASA', ?, ?, ?, ?, 'HAPUS', NOW(), ?, ?)
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
// LOOKUP: Jasa
// ─────────────────────────────────────────────────────────
const getJasaList = async () => {
  const [rows] = await db.query(
    `SELECT jasa_kode AS Kode, jasa_nama AS Nama
     FROM tjasa ORDER BY jasa_nama`,
  );
  return rows;
};

// ─────────────────────────────────────────────────────────
// LOOKUP: Gudang Produksi per cab
// ─────────────────────────────────────────────────────────
const getGudangList = async (cab = "") => {
  let q = `SELECT gdgp_kode AS Kode, gdgp_nama AS Nama, gdgp_cab AS Cab
            FROM tgudangproduksi WHERE gdgp_aktif = 0`;
  const params = [];
  if (cab && cab !== "ALL") {
    q += ` AND gdgp_cab = ?`;
    params.push(cab);
  }
  q += ` ORDER BY gdgp_nama`;
  const [rows] = await db.query(q, params);
  return rows;
};

// ─────────────────────────────────────────────────────────
// EXPORT EXCEL DATA (browse master)
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
      h.pojh_nomor          AS Nomor,
      h.pojh_cab            AS Cab,
      DATE_FORMAT(h.pojh_tanggal, '%Y-%m-%d') AS Tanggal,
      j.jasa_nama           AS Jasa,
      h.pojh_keterangan     AS Keterangan,
      s.sup_nama            AS Supplier,
      sk.spk_nama           AS spk_nama,
      d.pojd_bhn_kode       AS Kode,
      b.bhn_name            AS Nama,
      d.pojd_bhn_satuan     AS Satuan,
      d.pojd_jumlah         AS Jumlah,
      d.pojd_jumlah_terima  AS Terima,
      IF(d.pojd_status=0,'Delay',IF(d.pojd_status=1,'True','Cancel')) AS Status_barang
    FROM tpojasa_hdr h
    INNER JOIN tpojasa_dtl d   ON d.pojd_pojh_nomor = h.pojh_nomor
    INNER JOIN tbahan      b   ON b.bhn_kode = d.pojd_bhn_kode
    INNER JOIN tsupplier   s   ON s.sup_kode = h.pojh_sup_kode
    INNER JOIN tspk        sk  ON sk.spk_nomor = h.pojh_spk_nomor
    LEFT  JOIN tjasa       j   ON j.jasa_kode = h.pojh_jasa_kode
    WHERE h.pojh_tanggal >= ? AND h.pojh_tanggal <= ?
  `;
  const params = [tglAwal, tglAkhir];
  if (cab && cab !== "ALL") {
    query += ` AND h.pojh_cab = ?`;
    params.push(cab);
  }
  query += ` ORDER BY h.pojh_nomor, d.pojd_bhn_kode`;
  const [rows] = await db.query(query, params);
  return rows;
};

// ─────────────────────────────────────────────────────────
// GET DATA CETAK (untuk print)
// ─────────────────────────────────────────────────────────
const getDataCetak = async (nomor) => {
  const [[hdr]] = await db.query(
    `SELECT
       h.pojh_nomor,
       DATE_FORMAT(h.pojh_tanggal,  '%Y-%m-%d') AS pojh_tanggal,
       DATE_FORMAT(h.pojh_dateline, '%Y-%m-%d') AS pojh_dateline,
       h.pojh_keterangan, h.pojh_tarif, h.pojh_jumlah,
       h.pojh_status_ppn, h.pojh_ppn, h.pojh_cab,
       h.pojh_cetak, h.pojh_jasa_kode, h.pojh_spk_nomor,
       j.jasa_nama,
       s.sup_nama, s.sup_alamat, s.sup_kota,
       IFNULL(sk.spk_nama, ms.mspk_nama) AS spk_nama,
       IFNULL(sk.spk_ukuran, ms.mspk_ukuran) AS spk_ukuran,
       IFNULL(sk.spk_jumlah, ms.mspk_jumlah) AS spk_jumlah,
       p.perush_nama AS comp_nama,
       p.perush_alamat AS comp_alamat,
       p.perush_telp AS comp_telp
     FROM tpojasa_hdr h
     LEFT JOIN tjasa           j  ON j.jasa_kode  = h.pojh_jasa_kode
     LEFT JOIN tsupplier       s  ON s.sup_kode   = h.pojh_sup_kode
     LEFT JOIN tspk            sk ON sk.spk_nomor = h.pojh_spk_nomor
     LEFT JOIN tmemospk        ms ON ms.mspk_nomor = h.pojh_spk_nomor
     LEFT JOIN tperusahaan     p  ON p.perush_kode = 'KP'
     WHERE h.pojh_nomor = ?`,
    [nomor],
  );
  if (!hdr) throw new Error("Data tidak ditemukan.");

  // Hanya tab komponen (pojd_statuspotong IS NULL atau bukan 1)
  const [dtl] = await db.query(
    `SELECT d.pojd_bhn_kode, b.bhn_name,
            d.pojd_bhn_satuan, d.pojd_jumlah,
            d.pojd_statuspotong
     FROM tpojasa_dtl d
     LEFT JOIN tbahan b ON b.bhn_kode = d.pojd_bhn_kode
     WHERE d.pojd_pojh_nomor = ?
     ORDER BY d.pojd_statuspotong, d.pojd_bhn_kode`,
    [nomor],
  );

  return { ...hdr, detail: dtl };
};

// ─────────────────────────────────────────────────────────
// GET DATA CETAK SJ (Surat Jalan)
// ─────────────────────────────────────────────────────────
const getDataCetakSJ = async (nomor) => {
  // SJ menggunakan data yang sama tapi format berbeda (lihat Delphi PRNSJ=true)
  return getDataCetak(nomor);
};

// ─────────────────────────────────────────────────────────
// CEK APAKAH BISA HAPUS (tanpa proses hapus)
// ─────────────────────────────────────────────────────────
const cekBisaHapus = async (nomor) => {
  const [[row]] = await db.query(
    `SELECT DATE(date_create) AS tgl_create FROM tpojasa_hdr WHERE pojh_nomor = ?`,
    [nomor],
  );
  if (!row) throw new Error("Data tidak ditemukan.");
  const d = new Date(
    new Date().toLocaleString("en-US", { timeZone: "Asia/Jakarta" }),
  );
  const todayWIB = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return row.tgl_create === todayWIB;
};

const approveData = async (nomor) => {
  const [result] = await db.query(
    `UPDATE tpojasa_hdr SET pojh_cetak = 1 WHERE pojh_nomor = ?`,
    [nomor],
  );
  if (result.affectedRows === 0) throw new Error("Data tidak ditemukan.");
};

module.exports = {
  getBrowse,
  getBrowseDetail,
  getDetailByNomor,
  getById,
  generateNomor,
  save,
  deleteData,
  pengajuanUbah,
  pengajuanHapus,
  getJasaList,
  getGudangList,
  getExportData,
  getExportDetail,
  getDataCetak,
  getDataCetakSJ,
  cekBisaHapus,
  approveData,
};
