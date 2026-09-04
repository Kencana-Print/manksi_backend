const db = require("../../config/database");

// ── Generate nomor: PJW.2026.00001 ── (tidak berubah)
const generateNomor = async (tahun) => {
  const prefix = `KK.${tahun}.`;
  const [[row]] = await db.query(
    `SELECT IFNULL(MAX(CAST(SUBSTRING(pjw_nomor, ?, 5) AS UNSIGNED)), 0) AS jumlah
     FROM tpenjadwalan_ppic_hdr WHERE pjw_nomor LIKE ?`,
    [prefix.length + 1, `${prefix}%`],
  );
  const nextVal = Number(row.jumlah) + 1;
  return `${prefix}${String(nextVal).padStart(5, "0")}`;
};

// ── Lookup Cabang (workshop) — dibatasi 4 cabang yang relevan utk
// Komitmen Kirim PPIC (P01/P02/P04/P05); cabang lain sengaja tidak
// ditampilkan sebagai opsi di form ini.
const getCabangOptions = async () => {
  const [rows] = await db.query(
    `SELECT pab_kode AS Kode, pab_nama AS Nama
     FROM tpabrik
     WHERE pab_kode IN ('P01','P02','P04','P05')
     ORDER BY pab_kode`,
  );
  return rows;
};

// ── Lookup Divisi ──
const getDivisiOptions = async () => {
  const [rows] = await db.query(
    `SELECT kode AS Kode, Divisi AS Nama FROM tdivisi ORDER BY kode`,
  );
  return rows;
};

// ── Tarik SO — sekarang dengan filter divisi opsional ──
const searchSoKandidat = async (
  startDate,
  endDate,
  divisi = "",
  excludeNomor = "",
) => {
  let query = `
    SELECT src.Nomor, src.Nama, src.Tanggal, src.Pesan, src.Kirim, src.Kurang, src.DatelineAsli
    FROM (
      SELECT so_nomor AS Nomor, so_nama AS Nama, DATE_FORMAT(so_tanggal,'%Y-%m-%d') AS Tanggal,
             so_jumlah AS Pesan, IFNULL(so_jumlah_kirim,0) AS Kirim,
             (so_jumlah - IFNULL(so_jumlah_kirim,0)) AS Kurang,
             so_dateline AS DatelineAsli, so_divisi AS Divisi
      FROM tsalesorder
      WHERE so_aktif = 'Y' AND so_close = 0
      UNION ALL
      SELECT spk_nomor, spk_nama, DATE_FORMAT(spk_tanggal,'%Y-%m-%d'),
             spk_jumlah, IFNULL(spk_jumlah_kirim,0), (spk_jumlah - IFNULL(spk_jumlah_kirim,0)),
             spk_dateline, spk_divisi
      FROM tspk
      WHERE spk_aktif = 'Y' AND spk_close = 0 AND spk_is_so = 0
    ) src
    WHERE src.DatelineAsli BETWEEN ? AND ?
      AND src.Nomor NOT IN (
        SELECT pjwd_so_nomor FROM tpenjadwalan_ppic_dtl
        WHERE pjwd_so_nomor IS NOT NULL AND pjwd_pjw_nomor <> ?
      )
  `;
  const params = [startDate, endDate, excludeNomor];

  if (divisi && divisi !== "0") {
    query += ` AND src.Divisi = ?`;
    params.push(divisi);
  }
  query += ` ORDER BY src.DatelineAsli ASC`;

  const [rows] = await db.query(query, params);
  return rows;
};

// ── Tarik dari Pra Order — TIDAK menunggu pro_status_ppic='SANGGUP'.
// Syaratnya cukup pro_status='OPEN' (belum dikonversi ke Permintaan
// Harga) dan tanggal rencana kirim jatuh di periode ini. Tujuannya:
// PPIC memasukkan rencana order ke jadwal SEBAGAI bagian dari proses
// menimbang kesanggupan itu sendiri — bukan langkah sesudahnya.
const searchPraOrderKandidat = async (
  startDate,
  endDate,
  divisi = "",
  excludeNomor = "",
) => {
  let query = `
    SELECT
      h.pro_nomor AS Nomor,
      h.pro_nama_pekerjaan AS Nama,
      DATE_FORMAT(h.pro_tanggal, '%Y-%m-%d') AS Tanggal,
      h.pro_qty_rencana AS QtyRencana,
      DATE_FORMAT(h.pro_tgl_kirim, '%Y-%m-%d') AS TglKirim,
      h.pro_status_ppic AS StatusPpic,
      h.pro_divisi AS Divisi
    FROM tpraorder_hdr h
    WHERE h.pro_status = 'OPEN'
      AND h.pro_tgl_kirim BETWEEN ? AND ?
      AND h.pro_nomor NOT IN (
        SELECT pjwd_pro_nomor FROM tpenjadwalan_ppic_dtl
        WHERE pjwd_pro_nomor IS NOT NULL AND pjwd_pjw_nomor <> ?
      )
  `;
  const params = [startDate, endDate, excludeNomor];

  if (divisi && divisi !== "0") {
    query += ` AND h.pro_divisi = ?`;
    params.push(divisi);
  }
  query += ` ORDER BY h.pro_tgl_kirim ASC`;

  const [rows] = await db.query(query, params);
  return rows;
};

// ── Info 1 SO (tambah manual) ── (tidak berubah)
const getSoInfo = async (soNomor, divisi = "") => {
  const [rows] = await db.query(
    `SELECT Nomor, Nama, Tanggal, Pesan, Kirim, Kurang, Divisi, DatelineAsli FROM (
       SELECT so_nomor AS Nomor, so_nama AS Nama, DATE_FORMAT(so_tanggal,'%Y-%m-%d') AS Tanggal,
              so_jumlah AS Pesan, IFNULL(so_jumlah_kirim,0) AS Kirim,
              (so_jumlah - IFNULL(so_jumlah_kirim,0)) AS Kurang, so_divisi AS Divisi,
              DATE_FORMAT(so_dateline,'%Y-%m-%d') AS DatelineAsli
       FROM tsalesorder WHERE so_nomor = ?
       UNION ALL
       SELECT spk_nomor, spk_nama, DATE_FORMAT(spk_tanggal,'%Y-%m-%d'),
              spk_jumlah, IFNULL(spk_jumlah_kirim,0), (spk_jumlah - IFNULL(spk_jumlah_kirim,0)), spk_divisi,
              DATE_FORMAT(spk_dateline,'%Y-%m-%d')
       FROM tspk WHERE spk_nomor = ? AND spk_is_so = 0
     ) x LIMIT 1`,
    [soNomor, soNomor],
  );
  const row = rows[0];
  if (!row) return null;

  if (divisi && String(row.Divisi) !== String(divisi)) {
    throw new Error(
      `SO ${soNomor} bukan divisi yang sesuai dengan Cabang terpilih (Divisi SO: ${row.Divisi}).`,
    );
  }
  return row;
};

// ── Tarik dari MAP (Memo Approval Produk) — tahap sebelum SPK/SO,
// filter mspk_aktif='Y' AND mspk_close=0 (belum jadi SPK/SO), dan
// belum ditarik ke periode lain.
const searchMapKandidat = async (
  startDate,
  endDate,
  divisi = "",
  excludeNomor = "",
) => {
  let query = `
    SELECT mspk_nomor AS Nomor, mspk_nama AS Nama,
           DATE_FORMAT(mspk_tanggal,'%Y-%m-%d') AS Tanggal,
           mspk_rencana_order AS Pesan,
           0 AS Kirim,
           mspk_rencana_order AS Kurang,
           DATE_FORMAT(mspk_dateline, '%Y-%m-%d') AS DatelineAsli, mspk_divisi AS Divisi
    FROM tmemospk
    WHERE mspk_aktif = 'Y' AND mspk_close = 0
      AND mspk_dateline BETWEEN ? AND ?
      AND mspk_nomor NOT IN (
        SELECT pjwd_map_nomor FROM tpenjadwalan_ppic_dtl
        WHERE pjwd_map_nomor IS NOT NULL AND pjwd_pjw_nomor <> ?
      )
  `;
  const params = [startDate, endDate, excludeNomor];

  if (divisi && divisi !== "0") {
    query += ` AND mspk_divisi = ?`;
    params.push(divisi);
  }
  query += ` ORDER BY mspk_dateline ASC`;

  const [rows] = await db.query(query, params);
  return rows;
};

// ── Info 1 MAP (tambah manual) — dengan validasi Divisi ──
const getMapInfo = async (mapNomor, divisi = "") => {
  const [rows] = await db.query(
    `SELECT mspk_nomor AS Nomor, mspk_nama AS Nama,
            DATE_FORMAT(mspk_tanggal,'%Y-%m-%d') AS Tanggal,
            mspk_rencana_order AS Pesan,
            0 AS Kirim,
            mspk_rencana_order AS Kurang,
            DATE_FORMAT(mspk_dateline, '%Y-%m-%d') AS DatelineAsli,
            mspk_divisi AS Divisi
     FROM tmemospk WHERE mspk_nomor = ?`,
    [mapNomor],
  );
  const row = rows[0];
  if (!row) return null;

  if (divisi && String(row.Divisi) !== String(divisi)) {
    throw new Error(
      `MAP ${mapNomor} bukan divisi yang sesuai dengan Cabang terpilih (Divisi MAP: ${row.Divisi}).`,
    );
  }
  return row;
};

// ── Load untuk mode edit ── (tidak berubah, tetap panggil getDetail dari service browse)
const getFormDetail = async (nomor) => {
  const [hdrRows] = await db.query(
    `SELECT h.pjw_nomor, DATE_FORMAT(h.pjw_tgl1, '%Y-%m-%d') AS pjw_tgl1,
          DATE_FORMAT(h.pjw_tgl2, '%Y-%m-%d') AS pjw_tgl2,
          h.pjw_cab, h.pjw_divisi, h.pjw_keterangan, h.pjw_close
     FROM tpenjadwalan_ppic_hdr h WHERE h.pjw_nomor = ?`,
    [nomor],
  );
  if (!hdrRows.length) return null;

  const penjadwalanPpicService = require("./penjadwalanPpicService");
  const detail = await penjadwalanPpicService.getDetail(nomor);
  return { header: hdrRows[0], detail };
};

// ── Save — sekarang so_nomor boleh kosong asal pro_nomor ada ──
const saveData = async (payload, userKode, userBagian) => {
  const {
    pjw_nomor,
    pjw_tgl1,
    pjw_tgl2,
    pjw_cab,
    pjw_divisi,
    pjw_keterangan,
    detail = [],
  } = payload;

  if (!pjw_tgl1 || !pjw_tgl2) throw new Error("Periode wajib diisi.");
  if (!detail.length)
    throw new Error("Minimal satu SO/Pra Order/MAP harus ditambahkan.");

  const isAdmin = (userKode || "").toUpperCase() === "ADMIN";
  const bagianUpper = (userBagian || "").toUpperCase();
  const isPpic = !isAdmin && bagianUpper === "PPIC";
  const isMarketing = !isAdmin && bagianUpper === "MARKETING";

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const tahun = new Date(pjw_tgl1).getFullYear();
    let nomor = pjw_nomor;

    let existingByKey = {};
    if (nomor) {
      const [oldRows] = await conn.query(
        `SELECT pjwd_so_nomor, pjwd_pro_nomor, pjwd_map_nomor,
                pjwd_rencana, pjwd_tgl_permintaan_kirim, pjwd_status_permintaan,
                pjwd_tgl_kesepakatan, pjwd_ket_kesepakatan
         FROM tpenjadwalan_ppic_dtl WHERE pjwd_pjw_nomor = ?`,
        [nomor],
      );
      for (const r of oldRows) {
        const key = r.pjwd_so_nomor || r.pjwd_pro_nomor || r.pjwd_map_nomor;
        existingByKey[key] = r;
      }
    }

    if (nomor) {
      await conn.query(
        `UPDATE tpenjadwalan_ppic_hdr SET
           pjw_tgl1 = ?, pjw_tgl2 = ?, pjw_cab = ?, pjw_divisi = ?, pjw_keterangan = ?,
           user_modified = ?, date_modified = NOW()
         WHERE pjw_nomor = ?`,
        [
          pjw_tgl1,
          pjw_tgl2,
          pjw_cab || "",
          pjw_divisi || null,
          pjw_keterangan || "",
          userKode,
          nomor,
        ],
      );
    } else {
      nomor = await generateNomor(tahun);
      await conn.query(
        `INSERT INTO tpenjadwalan_ppic_hdr
           (pjw_nomor, pjw_tgl1, pjw_tgl2, pjw_cab, pjw_divisi, pjw_keterangan, user_create, date_create)
         VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
        [
          nomor,
          pjw_tgl1,
          pjw_tgl2,
          pjw_cab || "",
          pjw_divisi || null,
          pjw_keterangan || "",
          userKode,
        ],
      );
    }

    await conn.query(
      `DELETE FROM tpenjadwalan_ppic_dtl WHERE pjwd_pjw_nomor = ?`,
      [nomor],
    );

    for (const row of detail) {
      if (!row.SoNomor && !row.NomorPraOrder && !row.MapNomor) continue;

      const key = row.SoNomor || row.NomorPraOrder || row.MapNomor;
      const old = existingByKey[key];

      let rencana = Number(row.Rencana) || 0;
      let permintaanKirim = row.PermintaanKirim || null;
      let statusPermintaan = row.StatusPermintaan || "CLOSE";
      let kesepakatan = row.Kesepakatan || null;
      let ketKesepakatan = row.KetKesepakatan || "";

      if (isPpic) {
        rencana = old ? old.pjwd_rencana : rencana;
        permintaanKirim = old ? old.pjwd_tgl_permintaan_kirim : permintaanKirim;
        statusPermintaan = old ? old.pjwd_status_permintaan : statusPermintaan;
      } else if (isMarketing) {
        kesepakatan = old ? old.pjwd_tgl_kesepakatan : kesepakatan;
        ketKesepakatan = old ? old.pjwd_ket_kesepakatan : ketKesepakatan;
      }

      await conn.query(
        `INSERT INTO tpenjadwalan_ppic_dtl
           (pjwd_pjw_nomor, pjwd_so_nomor, pjwd_pro_nomor, pjwd_map_nomor, pjwd_rencana,
            pjwd_tgl_permintaan_kirim, pjwd_status_permintaan,
            pjwd_tgl_kesepakatan, pjwd_ket_kesepakatan)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          nomor,
          row.SoNomor || null,
          row.NomorPraOrder || null,
          row.MapNomor || null,
          rencana,
          permintaanKirim,
          statusPermintaan,
          kesepakatan,
          ketKesepakatan,
        ],
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

// ═══════════════════════════════════════════════════════════
// GRANULAR ROW-LEVEL OPERATIONS — untuk realtime auto-save
// Menggantikan pola delete-lalu-insert-ulang saveData() lama.
// Setiap operasi langsung commit ke DB satu unit kerja saja.
// ═══════════════════════════════════════════════════════════

const FIELD_OWNERSHIP = {
  pjwd_rencana: "MARKETING",
  pjwd_tgl_permintaan_kirim: "MARKETING",
  pjwd_status_permintaan: "MARKETING",
  pjwd_tgl_kesepakatan: "PPIC",
  pjwd_ket_kesepakatan: "PPIC",
  pjwd_nama_manual: "MARKETING",
  pjwd_pesan_manual: "MARKETING",
  pjwd_kirim_manual: "MARKETING",
  pjwd_realisasi_manual: "MARKETING",
};

const HEADER_FIELD_OWNERSHIP = {
  pjw_tgl1: "MARKETING",
  pjw_tgl2: "MARKETING",
  pjw_cab: "MARKETING",
  pjw_divisi: "MARKETING",
  pjw_keterangan: "MARKETING",
};

const assertFieldOwnership = (field, ownershipMap, userKode, userBagian) => {
  const isAdmin = (userKode || "").toUpperCase() === "ADMIN";
  if (isAdmin) return;

  const owner = ownershipMap[field];
  if (!owner) return; // field tidak diatur kepemilikannya — bebas siapa saja

  const bagianUpper = (userBagian || "").toUpperCase();
  if (bagianUpper !== owner) {
    throw new Error(`Field ini hanya bisa diubah oleh bagian ${owner}.`);
  }
};

// ── UPDATE HEADER — satu field per call (Periode/Cabang/Keterangan) ──
const updateHeaderField = async (
  pjwNomor,
  field,
  value,
  userKode,
  userBagian,
) => {
  if (!Object.prototype.hasOwnProperty.call(HEADER_FIELD_OWNERSHIP, field)) {
    throw new Error("Field header tidak dikenal.");
  }
  assertFieldOwnership(field, HEADER_FIELD_OWNERSHIP, userKode, userBagian);

  await db.query(
    `UPDATE tpenjadwalan_ppic_hdr SET ${field} = ?, user_modified = ?, date_modified = NOW() WHERE pjw_nomor = ?`,
    [value, userKode, pjwNomor],
  );
  return { pjw_nomor: pjwNomor, field, value };
};

// ── CREATE HEADER (baru — sebelumnya bagian dari saveData()) ──
const createHeader = async (payload, userKode, userBagian) => {
  const isAdmin = (userKode || "").toUpperCase() === "ADMIN";
  const bagianUpper = (userBagian || "").toUpperCase();
  if (!isAdmin && bagianUpper !== "MARKETING") {
    throw new Error(
      "Membuat Komitmen Kirim baru hanya bisa dilakukan oleh bagian MARKETING.",
    );
  }

  const { pjw_tgl1, pjw_tgl2, pjw_cab, pjw_divisi, pjw_keterangan } = payload;
  if (!pjw_tgl1 || !pjw_tgl2) throw new Error("Periode wajib diisi.");

  const tahun = new Date(pjw_tgl1).getFullYear();
  const nomor = await generateNomor(tahun);

  await db.query(
    `INSERT INTO tpenjadwalan_ppic_hdr
       (pjw_nomor, pjw_tgl1, pjw_tgl2, pjw_cab, pjw_divisi, pjw_keterangan, user_create, date_create)
     VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
    [
      nomor,
      pjw_tgl1,
      pjw_tgl2,
      pjw_cab || "",
      pjw_divisi || null,
      pjw_keterangan || "",
      userKode,
    ],
  );
  return { nomor };
};

// ── Helper: total Rencana SAAT INI untuk satu periode, opsional exclude
// satu baris (dipakai saat update baris itu sendiri, supaya tidak
// menghitung nilai lamanya dobel dengan nilai barunya).
const getTotalRencana = async (pjwNomor, excludePjwdId = null) => {
  let query = `SELECT IFNULL(SUM(pjwd_rencana), 0) AS total FROM tpenjadwalan_ppic_dtl WHERE pjwd_pjw_nomor = ?`;
  const params = [pjwNomor];
  if (excludePjwdId) {
    query += ` AND pjwd_id <> ?`;
    params.push(excludePjwdId);
  }
  const [[row]] = await db.query(query, params);
  return Number(row.total) || 0;
};

const MAX_QTY_PER_PERIODE = 15000;

// ── ADD DETAIL ROW — satu baris SO/Pra Order/MAP ──
const addDetailRow = async (pjwNomor, rowData, userKode, userBagian) => {
  const isAdmin = (userKode || "").toUpperCase() === "ADMIN";
  const bagianUpper = (userBagian || "").toUpperCase();
  if (!isAdmin && bagianUpper !== "MARKETING") {
    throw new Error(
      "Menambah baris hanya bisa dilakukan oleh bagian MARKETING.",
    );
  }
  const {
    SoNomor,
    NomorPraOrder,
    MapNomor,
    Rencana,
    PermintaanKirim,
    NamaManual,
    PesanManual,
    KirimManual,
    RealisasiManual,
  } = rowData;
  const isManual = !SoNomor && !NomorPraOrder && !MapNomor;
  if (isManual && !NamaManual) {
    throw new Error("Baris manual harus punya Nama.");
  }
  const rencanaVal = Number(Rencana) || 0;
  const totalSekarang = await getTotalRencana(pjwNomor);
  const totalSetelah = totalSekarang + rencanaVal;
  const melebihiBatas = totalSetelah > MAX_QTY_PER_PERIODE;
  const permintaanKirimSafe = PermintaanKirim
    ? String(PermintaanKirim).substring(0, 10)
    : null;
  const [result] = await db.query(
    `INSERT INTO tpenjadwalan_ppic_dtl
       (pjwd_pjw_nomor, pjwd_so_nomor, pjwd_pro_nomor, pjwd_map_nomor, pjwd_rencana,
        pjwd_tgl_permintaan_kirim, pjwd_status_permintaan, pjwd_user_create,
        pjwd_nama_manual, pjwd_pesan_manual, pjwd_kirim_manual, pjwd_realisasi_manual)
     VALUES (?, ?, ?, ?, ?, ?, 'CLOSE', ?, ?, ?, ?, ?)`,
    [
      pjwNomor,
      SoNomor || null,
      NomorPraOrder || null,
      MapNomor || null,
      rencanaVal,
      permintaanKirimSafe,
      userKode,
      isManual ? NamaManual : null,
      isManual ? Number(PesanManual) || 0 : null,
      isManual ? Number(KirimManual) || 0 : null,
      isManual ? Number(RealisasiManual) || 0 : null,
    ],
  );
  return {
    pjwd_id: result.insertId,
    warning: melebihiBatas
      ? { totalSetelah, batas: MAX_QTY_PER_PERIODE }
      : null,
  };
};

// ── UPDATE DETAIL FIELD — satu kolom di satu baris ──
const DATE_FIELDS = ["pjwd_tgl_permintaan_kirim", "pjwd_tgl_kesepakatan"];

const updateDetailField = async (
  pjwdId,
  field,
  value,
  userKode,
  userBagian,
) => {
  if (!Object.prototype.hasOwnProperty.call(FIELD_OWNERSHIP, field)) {
    throw new Error("Field detail tidak dikenal.");
  }
  assertFieldOwnership(field, FIELD_OWNERSHIP, userKode, userBagian);

  let sanitizedValue = value;
  if (DATE_FIELDS.includes(field) && (value === "" || value === undefined)) {
    sanitizedValue = null;
  }

  let melebihiBatas = false;
  let totalSetelah = null;

  if (field === "pjwd_rencana") {
    const [[row]] = await db.query(
      `SELECT pjwd_pjw_nomor FROM tpenjadwalan_ppic_dtl WHERE pjwd_id = ?`,
      [pjwdId],
    );
    if (!row) throw new Error("Baris tidak ditemukan.");

    const rencanaBaru = Number(value) || 0;
    const totalLain = await getTotalRencana(row.pjwd_pjw_nomor, pjwdId);
    totalSetelah = totalLain + rencanaBaru;
    melebihiBatas = totalSetelah > MAX_QTY_PER_PERIODE;
  }

  await db.query(
    `UPDATE tpenjadwalan_ppic_dtl SET ${field} = ? WHERE pjwd_id = ?`,
    [sanitizedValue, pjwdId],
  );
  return {
    pjwd_id: Number(pjwdId),
    field,
    value: sanitizedValue,
    warning: melebihiBatas
      ? { totalSetelah, batas: MAX_QTY_PER_PERIODE }
      : null,
  };
};

// ── DELETE DETAIL ROW ──
const deleteDetailRow = async (pjwdId, userKode, userBagian) => {
  const isAdmin = (userKode || "").toUpperCase() === "ADMIN";
  const bagianUpper = (userBagian || "").toUpperCase();
  if (!isAdmin && bagianUpper !== "MARKETING") {
    throw new Error(
      "Menghapus baris hanya bisa dilakukan oleh bagian MARKETING.",
    );
  }
  await db.query(`DELETE FROM tpenjadwalan_ppic_dtl WHERE pjwd_id = ?`, [
    pjwdId,
  ]);
  return { pjwd_id: Number(pjwdId) }; // ⬅ cast ke Number
};

// ═══════════════════════════════════════════════════════════
// PINDAH PERIODE OTOMATIS — saat Kesepakatan mundur/maju ke
// minggu lain. Dua tahap: cek target (utk dialog konfirmasi),
// lalu eksekusi (transaksional).
// ═══════════════════════════════════════════════════════════

const getMondayOfWeek = (dateStr) => {
  const d = new Date(dateStr + "T00:00:00");
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const mon = new Date(d);
  mon.setDate(d.getDate() + diff);
  return mon;
};
const toLocalDate = (d) => {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const getWeekRange = (tanggal) => {
  const monday = getMondayOfWeek(tanggal);
  const saturday = new Date(monday);
  saturday.setDate(monday.getDate() + 5);
  return { tgl1: toLocalDate(monday), tgl2: toLocalDate(saturday) };
};

// ── CEK TARGET (dipanggil saat blur, SEBELUM pindah beneran) ──
const checkTargetPeriod = async (pjwdId, tanggalBaru) => {
  const [[row]] = await db.query(
    `SELECT d.pjwd_so_nomor, d.pjwd_pro_nomor, d.pjwd_map_nomor,
            h.pjw_tgl1, h.pjw_tgl2, h.pjw_cab
     FROM tpenjadwalan_ppic_dtl d
     INNER JOIN tpenjadwalan_ppic_hdr h ON h.pjw_nomor = d.pjwd_pjw_nomor
     WHERE d.pjwd_id = ?`,
    [pjwdId],
  );
  if (!row) throw new Error("Baris tidak ditemukan.");

  if (tanggalBaru >= row.pjw_tgl1 && tanggalBaru <= row.pjw_tgl2) {
    return { needMove: false };
  }

  const { tgl1, tgl2 } = getWeekRange(tanggalBaru);
  const [[target]] = await db.query(
    `SELECT pjw_nomor FROM tpenjadwalan_ppic_hdr
     WHERE pjw_cab = ? AND pjw_close = 'N' AND ? BETWEEN pjw_tgl1 AND pjw_tgl2
     LIMIT 1`,
    [row.pjw_cab, tanggalBaru],
  );

  const key = row.pjwd_so_nomor || row.pjwd_pro_nomor || row.pjwd_map_nomor;
  if (target && key) {
    const [[dup]] = await db.query(
      `SELECT pjwd_id FROM tpenjadwalan_ppic_dtl
       WHERE pjwd_pjw_nomor = ? AND (pjwd_so_nomor = ? OR pjwd_pro_nomor = ? OR pjwd_map_nomor = ?)`,
      [target.pjw_nomor, key, key, key],
    );
    if (dup)
      throw new Error(
        `${key} sudah ada di periode ${target.pjw_nomor}. Tidak bisa dipindah otomatis.`,
      );
  }

  return {
    needMove: true,
    willCreateNew: !target,
    targetNomor: target ? target.pjw_nomor : null,
    targetTgl1: tgl1,
    targetTgl2: tgl2,
  };
};

// ── EKSEKUSI PINDAH (dipanggil setelah PPIC konfirmasi dialog) ──
const moveDetailRowToPeriod = async (
  pjwdId,
  tanggalBaru,
  userKode,
  userBagian,
) => {
  assertFieldOwnership(
    "pjwd_tgl_kesepakatan",
    FIELD_OWNERSHIP,
    userKode,
    userBagian,
  );

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [[row]] = await conn.query(
      `SELECT d.pjwd_pjw_nomor, d.pjwd_so_nomor, d.pjwd_pro_nomor, d.pjwd_map_nomor,
              h.pjw_cab, h.pjw_divisi, h.pjw_tgl1, h.pjw_tgl2
       FROM tpenjadwalan_ppic_dtl d
       INNER JOIN tpenjadwalan_ppic_hdr h ON h.pjw_nomor = d.pjwd_pjw_nomor
       WHERE d.pjwd_id = ? FOR UPDATE`,
      [pjwdId],
    );
    if (!row) throw new Error("Baris tidak ditemukan.");

    // Race condition: sudah pindah/tanggal sudah pas — cukup update kolomnya
    if (tanggalBaru >= row.pjw_tgl1 && tanggalBaru <= row.pjw_tgl2) {
      await conn.query(
        `UPDATE tpenjadwalan_ppic_dtl SET pjwd_tgl_kesepakatan = ? WHERE pjwd_id = ?`,
        [tanggalBaru, pjwdId],
      );
      await conn.commit();
      return {
        moved: false,
        nomor: row.pjwd_pjw_nomor,
        pjwd_id: Number(pjwdId),
      };
    }

    const { tgl1, tgl2 } = getWeekRange(tanggalBaru);
    const [[target]] = await conn.query(
      `SELECT pjw_nomor FROM tpenjadwalan_ppic_hdr
       WHERE pjw_cab = ? AND pjw_close = 'N' AND ? BETWEEN pjw_tgl1 AND pjw_tgl2
       LIMIT 1 FOR UPDATE`,
      [row.pjw_cab, tanggalBaru],
    );

    const key = row.pjwd_so_nomor || row.pjwd_pro_nomor || row.pjwd_map_nomor;
    let targetNomor;

    if (target) {
      targetNomor = target.pjw_nomor;
      if (key) {
        const [[dup]] = await conn.query(
          `SELECT pjwd_id FROM tpenjadwalan_ppic_dtl
           WHERE pjwd_pjw_nomor = ? AND (pjwd_so_nomor = ? OR pjwd_pro_nomor = ? OR pjwd_map_nomor = ?)`,
          [targetNomor, key, key, key],
        );
        if (dup)
          throw new Error(
            `${key} sudah ada di periode ${targetNomor}. Tidak bisa dipindah otomatis.`,
          );
      }
    } else {
      targetNomor = await generateNomor(new Date(tgl1).getFullYear());
      await conn.query(
        `INSERT INTO tpenjadwalan_ppic_hdr
           (pjw_nomor, pjw_tgl1, pjw_tgl2, pjw_cab, pjw_divisi, pjw_keterangan, user_create, date_create)
         VALUES (?, ?, ?, ?, ?, '', ?, NOW())`,
        [targetNomor, tgl1, tgl2, row.pjw_cab, row.pjw_divisi, userKode],
      );
    }

    await conn.query(
      `UPDATE tpenjadwalan_ppic_dtl SET pjwd_pjw_nomor = ?, pjwd_tgl_kesepakatan = ? WHERE pjwd_id = ?`,
      [targetNomor, tanggalBaru, pjwdId],
    );

    await conn.commit();
    return {
      moved: true,
      fromNomor: row.pjwd_pjw_nomor,
      nomor: targetNomor,
      pjwd_id: Number(pjwdId),
    };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
};

module.exports = {
  generateNomor,
  getCabangOptions,
  getDivisiOptions,
  searchSoKandidat,
  searchPraOrderKandidat,
  searchMapKandidat,
  getSoInfo,
  getMapInfo,
  getFormDetail,
  saveData,
  updateHeaderField,
  createHeader,
  addDetailRow,
  updateDetailField,
  deleteDetailRow,
  checkTargetPeriod,
  moveDetailRowToPeriod,
};
