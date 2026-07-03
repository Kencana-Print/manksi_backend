const db = require("../../config/database");

// ─────────────────────────────────────────────────────────
// GET SPK INFO
// Sesuai Delphi edtNomorSPKExit — UNION tspk+tmemospk
// Validasi pending penuh + CMO dilakukan di controller
// ─────────────────────────────────────────────────────────
const getSpkInfo = async (nomorSpk) => {
  // Sesuai Delphi edtNomorSPKExit — LEFT JOIN tbarang (bukan INNER)
  // karena tidak semua SPK punya tbarang (SPK-JA-xx dll hanya di tspk)
  const [rows] = await db.query(
    `SELECT spk_nomor AS nomor,
            IFNULL(b.brg_name, s.spk_nama) AS nama,
            jo_nama,
            spk_jumlah AS total_jumlah, spk_ukuran AS ukuran,
            spk_pending, spk_accpending, spk_cmo AS cmo
     FROM tspk s
     LEFT  JOIN tbarang     b ON b.brg_kode    = s.spk_nomor
     LEFT  JOIN tjenisorder   ON jo_kode        = s.spk_jo_kode
     WHERE s.spk_aktif = 'Y' AND s.spk_nomor = ?
     UNION ALL
     SELECT mspk_nomor, mspk_nama, jo_nama,
            mspk_jumlah, mspk_ukuran,
            '' AS spk_pending, '' AS spk_accpending, mspk_cmo AS cmo
     FROM tmemospk
     LEFT JOIN tjenisorder ON mspk_jo_kode = jo_kode
     WHERE mspk_nomor = ?
     LIMIT 1`,
    [nomorSpk, nomorSpk],
  );
  return rows[0] || null;
};

// ─────────────────────────────────────────────────────────
// GET JASA LIST — sesuai Delphi F1 edtJasa
// JOIN tgudangproduksi via gdgp_jasa=jasa_ket, auto-fill gudang saat pilih
// Filter per cab
// ─────────────────────────────────────────────────────────
const getJasaList = async (cab = "") => {
  const cabFilter = cab && cab !== "" && cab !== "HO-";
  const [rows] = await db.query(
    `SELECT j.jasa_kode AS Kode, j.jasa_nama AS Nama,
            g.gdgp_kode AS gdgp_kode, g.gdgp_nama AS gdgp_nama
     FROM tjasa j
     LEFT JOIN tgudangproduksi g ON g.gdgp_jasa = j.jasa_ket
     WHERE j.jasa_gdgp_kode IS NOT NULL
       AND g.gdgp_aktif = 0
       AND g.gdgp_nama NOT LIKE '%QC%'
       ${cabFilter ? "AND g.gdgp_cab = ?" : ""}
     ORDER BY j.jasa_nama`,
    cabFilter ? [cab] : [],
  );
  return rows;
};

// ─────────────────────────────────────────────────────────
// GET PLANNING PPIC — sesuai Delphi isiplan
// Query berbeda per kode jasa:
// J07=cutting, J08=bordir, J09=sublim, J01=cetak
// J02=jahit (pakai plan_linea..k UNION)
// Selainnya pakai field dinamis s1
// ─────────────────────────────────────────────────────────
const getPlanningPpic = async (nomorSpk, jasaKode) => {
  // Sesuai struktur tplan_ppic_dtl2 terbaru:
  // plan_divisi = CUTTING/SEWING/KOLI, plan_qty_jadwal = qty
  // Mapping jasa → divisi:
  const divisiMap = {
    J07: "CUTTING", // cutting
    J01: "CUTTING", // cetak
    J08: "CUTTING", // bordir
    J09: "CUTTING", // sublim
    J02: "SEWING", // jahit
    J03: "KOLI", // koli/finishing
  };
  const divisi = divisiMap[jasaKode];
  if (!divisi) return [];

  const [rows] = await db.query(
    `SELECT
       d.plan_pl_nomor                             AS no_planning,
       DATE_FORMAT(d.plan_tgl_jadwal, '%Y-%m-%d') AS tanggal,
       d.plan_qty_jadwal                           AS jumlah,
       d.plan_divisi                               AS status,
       d.plan_line_kelompok                        AS line_kelompok
     FROM tplan_ppic_dtl2 d
     INNER JOIN tplan_ppic_hdr h ON h.pl_nomor = d.plan_pl_nomor
     WHERE h.pl_close = 'N'
       AND d.plan_spk = ?
       AND d.plan_divisi = ?
       AND d.plan_qty_jadwal <> 0
     ORDER BY h.pl_nomor DESC, d.plan_tgl_jadwal ASC`,
    [nomorSpk, divisi],
  );
  return rows;
};

// ─────────────────────────────────────────────────────────
// HITUNG SUDAH PO + SUDAH LHK per bahan (sesuai Delphi lhkpo)
// Dipanggil saat load kode bahan ke grid
// ─────────────────────────────────────────────────────────
const getLhkPo = async (kodeBahan, nomorSpk, gdgpKode, excludeNomor = "") => {
  const [[row]] = await db.query(
    `SELECT
       IFNULL((
         SELECT SUM(d.pojd_jumlah)
         FROM tpojasa_hdr h
         INNER JOIN tpojasa_dtl d ON d.pojd_pojh_nomor = h.pojh_nomor
         WHERE h.pojh_spk_nomor = ? AND h.pojh_gdgp_kode = ?
           AND h.pojh_nomor <> ?
           AND d.pojd_bhn_kode = ?
       ), 0) AS sudah_po,
       IFNULL((
         SELECT SUM(d.mpd_jumlah)
         FROM tmutasiproduksi_hdr h
         INNER JOIN tmutasiproduksi_dtl d ON d.mpd_mph_nomor = h.mph_nomor
         WHERE h.mph_spk_nomor = ? AND h.mph_gdgasal = ?
           AND d.mpd_bhn_kode = ?
       ), 0) AS sudah_lhk`,
    [
      nomorSpk,
      gdgpKode,
      excludeNomor,
      kodeBahan,
      nomorSpk,
      gdgpKode,
      kodeBahan,
    ],
  );
  return {
    sudah_po: Number(row.sudah_po) || 0,
    sudah_lhk: Number(row.sudah_lhk) || 0,
  };
};

// ─────────────────────────────────────────────────────────
// LOAD KODE BAHAN ke grid (Tab Komponen)
// Sesuai Delphi loaddatadetail + lhkpo
// Jasa J08 (bordir) → filter bhn_bordir=1
// ─────────────────────────────────────────────────────────
const loadKodeBahan = async (
  kodeBahan,
  jasaKode,
  nomorSpk,
  gdgpKode,
  excludeNomor = "",
) => {
  const isBordir = jasaKode === "J08";
  let query = `SELECT bhn_kode AS kode, bhn_name AS nama, bhn_satuan AS satuan
               FROM tbahan
               WHERE bhn_aktif = 0 AND bhn_jb_kode = 'LL'
                 AND bhn_kode LIKE ?`;
  if (isBordir) query += ` AND bhn_bordir = 1`;
  query += ` LIMIT 1`;

  const [[bahan]] = await db.query(query, [`%${kodeBahan}`]);
  if (!bahan) {
    return {
      error: isBordir
        ? "Kode tsb bukan titik bordir. Tekan F1 untuk bantuan."
        : "Kode tsb tidak ditemukan.",
    };
  }

  const lhkpo = await getLhkPo(bahan.kode, nomorSpk, gdgpKode, excludeNomor);
  return {
    kode: bahan.kode,
    nama: bahan.nama,
    satuan: bahan.satuan,
    sudah_po: lhkpo.sudah_po,
    sudah_lhk: lhkpo.sudah_lhk,
    total_sudah: lhkpo.sudah_po + lhkpo.sudah_lhk,
    // kurang dihitung di frontend: jumlahPO - total_sudah
  };
};

// ─────────────────────────────────────────────────────────
// SEARCH BAHAN (F1 di grid)
// Jasa J08 → filter bhn_bordir=1
// Tab Bahan → include stok dari vmasterstok_bahan
// ─────────────────────────────────────────────────────────
const searchBahan = async (
  q = "",
  jasaKode = "",
  withStok = false,
  page = 1,
  limit = 30,
) => {
  const isBordir = jasaKode === "J08";
  const offset = (page - 1) * limit;

  let query = withStok
    ? `SELECT b.bhn_kode AS Kode, b.bhn_name AS Nama, b.bhn_satuan AS Satuan,
              IFNULL((SELECT SUM(m.vStok) FROM vmasterstok_bahan m WHERE m.vKode = b.bhn_kode), 0) AS Stok
       FROM tbahan b`
    : `SELECT bhn_kode AS Kode, bhn_name AS Nama, bhn_satuan AS Satuan FROM tbahan b`;

  query += ` WHERE b.bhn_jb_kode = 'LL' AND b.bhn_aktif = 0`;
  if (isBordir) query += ` AND b.bhn_bordir = 1`;
  if (q) query += ` AND (b.bhn_kode LIKE ? OR b.bhn_name LIKE ?)`;
  query += ` ORDER BY b.bhn_kode LIMIT ? OFFSET ?`;

  const params = q ? [`%${q}%`, `%${q}%`, limit, offset] : [limit, offset];
  const [rows] = await db.query(query, params);
  return rows;
};

// ─────────────────────────────────────────────────────────
// AUTO-FILL GRID DARI MUTASI (sesuai Delphi CheckBox1Click "Set")
// Load bahan dari tmutasiproduksi_dtl untuk SPK yang sama
// ─────────────────────────────────────────────────────────
const getSetFromMutasi = async (
  nomorSpk,
  gdgpKode,
  jumlahPO,
  excludeNomor = "",
) => {
  const [rows] = await db.query(
    `SELECT DISTINCT d.mpd_bhn_kode AS kode, d.MPD_NAMA AS nama, d.MPD_satuan AS satuan
     FROM tmutasiproduksi_dtl d
     INNER JOIN tmutasiproduksi_hdr h ON d.mpd_mph_nomor = h.mph_nomor
     WHERE h.mph_spk_nomor = ? AND d.mpd_bhn_kode IS NOT NULL AND d.MPD_satuan <> ''`,
    [nomorSpk],
  );

  // Hitung lhkpo per bahan
  const result = [];
  for (const r of rows) {
    const lhkpo = await getLhkPo(r.kode, nomorSpk, gdgpKode, excludeNomor);
    result.push({
      kode: r.kode,
      nama: r.nama,
      satuan: r.satuan,
      jumlah: Number(jumlahPO) || 0,
      sudah_po: lhkpo.sudah_po,
      sudah_lhk: lhkpo.sudah_lhk,
      total_sudah: lhkpo.sudah_po + lhkpo.sudah_lhk,
      kurang: Number(jumlahPO) - (lhkpo.sudah_po + lhkpo.sudah_lhk),
    });
  }
  return result;
};

// ─────────────────────────────────────────────────────────
// SEARCH SUPPLIER (sesuai Delphi F1 edtSupKode)
// ─────────────────────────────────────────────────────────
const searchSupplier = async (q = "", page = 1, limit = 30) => {
  const offset = (page - 1) * limit;
  const [rows] = await db.query(
    `SELECT sup_kode AS Kode, sup_nama AS Nama, sup_alamat AS Alamat, sup_kota AS Kota
     FROM tsupplier
     WHERE sup_aktif = 'Y'
       AND (sup_kode LIKE ? OR sup_nama LIKE ? OR sup_kota LIKE ?)
     ORDER BY sup_nama
     LIMIT ? OFFSET ?`,
    [`%${q}%`, `%${q}%`, `%${q}%`, limit, offset],
  );
  return rows;
};

// ─────────────────────────────────────────────────────────
// GET SUPPLIER BY KODE (sesuai Delphi edtSupKodeExit)
// ─────────────────────────────────────────────────────────
const getSupplierByKode = async (kode) => {
  const [[row]] = await db.query(
    `SELECT sup_kode AS Kode, sup_nama AS Nama, sup_alamat AS Alamat, sup_kota AS Kota
     FROM tsupplier WHERE sup_aktif = 'Y' AND sup_kode = ? LIMIT 1`,
    [kode],
  );
  return row || null;
};

// ─────────────────────────────────────────────────────────
// SEARCH GUDANG PRODUKSI (sesuai Delphi F1 edtGdgProduksi)
// Filter: gdgp_jasa <> "" AND NOT LIKE %QC% per cab
// ─────────────────────────────────────────────────────────
const searchGudangProduksi = async (q = "", cab = "") => {
  let query = `SELECT gdgp_kode AS Kode, gdgp_nama AS Nama
               FROM tgudangproduksi
               WHERE gdgp_aktif = 0 AND gdgp_jasa <> ''
                 AND gdgp_nama NOT LIKE '%QC%'`;
  const params = [];
  if (cab) {
    query += ` AND gdgp_cab = ?`;
    params.push(cab);
  }
  if (q) {
    query += ` AND (gdgp_kode LIKE ? OR gdgp_nama LIKE ?)`;
    params.push(`%${q}%`, `%${q}%`);
  }
  query += ` ORDER BY gdgp_nama`;
  const [rows] = await db.query(query, params);
  return rows;
};

// ─────────────────────────────────────────────────────────
// CEK PENDING GUDANG PRODUKSI (sesuai Delphi edtGdgProduksiExit)
// ─────────────────────────────────────────────────────────
const cekPendingGudang = async (nomorSpk, gdgpKode) => {
  const [[row]] = await db.query(
    `SELECT spk_ppotong, spk_pcetak, spk_pbordir, spk_pjahit, spk_pfinishing
     FROM tspk
     WHERE spk_pending = 'PENDING SEBAGIAN' AND spk_accpending = 'N'
       AND spk_cmo <> '' AND spk_aktif = 'Y' AND spk_nomor = ?
     LIMIT 1`,
    [nomorSpk],
  );
  if (!row) return null;

  const pendingMap = {
    GP001: { field: "spk_ppotong", msg: "Cuting" },
    GP015: { field: "spk_ppotong", msg: "Cuting" },
    GP002: { field: "spk_pcetak", msg: "Cetak" },
    GP017: { field: "spk_pcetak", msg: "Cetak" },
    GP014: { field: "spk_pbordir", msg: "Bordir" },
    GP016: { field: "spk_pbordir", msg: "Bordir" },
    GP003: { field: "spk_pjahit", msg: "Jahit" },
    GP018: { field: "spk_pjahit", msg: "Jahit" },
    GP004: { field: "spk_pfinishing", msg: "Finishing" },
    GP019: { field: "spk_pfinishing", msg: "Finishing" },
  };
  const info = pendingMap[gdgpKode];
  if (info && row[info.field] === "Y") {
    return `No.Spk tsb di pending dibagian ${info.msg}.\nHubungi marketing jika akan tetap melanjutkan transaksi.`;
  }
  return null;
};

// ─────────────────────────────────────────────────────────
// GET BY NOMOR (loaddataall)
// ─────────────────────────────────────────────────────────
const getById = async (nomor) => {
  const [[hdr]] = await db.query(
    `SELECT
       h.*,
       DATE_FORMAT(h.pojh_tanggal, '%Y-%m-%d')  AS pojh_tanggal_fmt,
       DATE_FORMAT(h.pojh_dateline,'%Y-%m-%d')  AS pojh_dateline_fmt,
       j.jasa_nama,
       s.sup_nama, s.sup_alamat, s.sup_kota,
       g.gdgp_nama
     FROM tpojasa_hdr h
     LEFT JOIN tjasa           j ON j.jasa_kode  = h.pojh_jasa_kode
     LEFT JOIN tsupplier       s ON s.sup_kode   = h.pojh_sup_kode
     LEFT JOIN tgudangproduksi g ON g.gdgp_kode  = h.pojh_gdgp_kode
     WHERE h.pojh_nomor = ?`,
    [nomor],
  );
  if (!hdr) return null;

  // Load SPK info
  const spkInfo = hdr.pojh_spk_nomor
    ? await getSpkInfo(hdr.pojh_spk_nomor)
    : null;

  // Detail — pisah tab komponen (statuspotong bukan 1) vs bahan (statuspotong=1)
  const [dtl] = await db.query(
    `SELECT d.*, b.bhn_name AS nama, b.bhn_satuan
     FROM tpojasa_dtl d
     LEFT JOIN tbahan b ON b.bhn_kode = d.pojd_bhn_kode
     WHERE d.pojd_pojh_nomor = ?
     ORDER BY d.pojd_statuspotong, d.pojd_bhn_kode`,
    [nomor],
  );

  // Hitung lhkpo untuk setiap baris komponen saat load edit
  const komponen = [];
  const bahan = [];
  for (const r of dtl) {
    const lhkpo = await getLhkPo(
      r.pojd_bhn_kode,
      hdr.pojh_spk_nomor,
      hdr.pojh_gdgp_kode,
      nomor,
    );
    const row = {
      kode: r.pojd_bhn_kode,
      nama: r.nama || r.pojd_nama || "",
      satuan: r.pojd_bhn_satuan || "",
      jumlah: Number(r.pojd_jumlah) || 0,
      harga: Number(r.pojd_harga) || 0,
      gdg_kode: r.pojd_gdg_kode || "",
      sudah_po: lhkpo.sudah_po,
      sudah_lhk: lhkpo.sudah_lhk,
      total_sudah: lhkpo.sudah_po + lhkpo.sudah_lhk,
    };
    if (r.pojd_statuspotong === 1) bahan.push(row);
    else komponen.push(row);
  }

  // Planning tersimpan (pojh_plan_nomor dll)
  const planning = hdr.pojh_plan_nomor
    ? [
        {
          no_planning: hdr.pojh_plan_nomor,
          tanggal: hdr.pojh_plan_tanggal
            ? new Date(hdr.pojh_plan_tanggal).toISOString().substring(0, 10)
            : "",
          jumlah: Number(hdr.pojh_plan_jumlah) || 0,
          status: "",
          ambil: true,
        },
      ]
    : [];

  // PIN5 / tutup buku
  const tutupBukuService = require("../tutupBukuService");
  const zdtClose = await tutupBukuService.getTanggalTutupBuku();
  const zClose = await tutupBukuService.getManualTutupBuku("PO JASA");
  const tglTrs = new Date(hdr.pojh_tanggal);
  const isClose = zClose ? tglTrs < zClose : tglTrs < zdtClose;

  let pin5Status = "",
    pin5Urut = 0;
  if (isClose) {
    const [pinRows] = await db.query(
      `SELECT pin_acc, pin_dipakai, pin_urut FROM tspk_pin5
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
    header: {
      ...hdr,
      pojh_tanggal: hdr.pojh_tanggal_fmt,
      pojh_dateline: hdr.pojh_dateline_fmt,
    },
    spkInfo,
    komponen,
    bahan,
    planning,
    pin5Status,
    pin5Urut,
  };
};

// ─────────────────────────────────────────────────────────
// GENERATE NOMOR — PJG/NNNNN/YYYY per cab
// Sesuai Delphi getmaxnomor
// ─────────────────────────────────────────────────────────
const generateNomor = async (conn, tanggal, cab) => {
  const tahun = new Date(tanggal).getFullYear();
  const prefix = `PJG/`;
  const suffix = `/${tahun}`;

  // Lock table level agar aman dari race condition
  const [[row]] = await conn.query(
    `SELECT IFNULL(MAX(CAST(SUBSTRING(pojh_nomor, 5, 5) AS UNSIGNED)), 0) AS max_val
   FROM tpojasa_hdr
   WHERE pojh_nomor LIKE ?`,
    [`PJG/%/${tahun}`],
  );
  const next = parseInt(row.max_val, 10) + 1;
  return `${prefix}${String(next).padStart(5, "0")}${suffix}`;
};

// ─────────────────────────────────────────────────────────
// SAVE — sesuai Delphi simpandata
// Tab Komponen → pojd_statuspotong = NULL/0
// Tab Bahan    → pojd_statuspotong = 1
// Planning     → ambil row dengan ambil=true
// ─────────────────────────────────────────────────────────
const save = async (data, userKode, isNew) => {
  const {
    Tanggal,
    Dateline,
    Cab,
    Keterangan = "",
    Note = "",
    JasaKode,
    SupKode,
    GdgpKode,
    SpkNomor,
    Tarif = 0,
    JumlahPO = 0,
    StatusPPN = 0,
    PPN = 0,
    KomponenRows = [],
    BahanRows = [],
    PlanNomor = "",
    PlanTanggal = null,
    PlanJumlah = 0,
    pin5Status = "",
    pin5Urut = null,
  } = data;

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    let nomor = isNew ? await generateNomor(conn, Tanggal, Cab) : data.Nomor;

    if (isNew) {
      const [result] = await conn.query(
        `INSERT IGNORE INTO tpojasa_hdr
       (pojh_nomor, pojh_tanggal, pojh_dateline, pojh_keterangan, pojh_note,
        pojh_sup_kode, pojh_spk_nomor, pojh_status_ppn, pojh_ppn,
        pojh_gdgp_kode, pojh_jumlah, pojh_tarif, pojh_jasa_kode, pojh_cab,
        pojh_plan_nomor, pojh_plan_tanggal, pojh_plan_jumlah,
        date_create, user_create)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NOW(),?)`,
        [
          nomor,
          Tanggal,
          Dateline || Tanggal,
          Keterangan,
          Note,
          SupKode,
          SpkNomor,
          StatusPPN,
          Number(PPN) || 0,
          GdgpKode,
          Number(JumlahPO) || 0,
          Number(Tarif) || 0,
          JasaKode,
          Cab,
          PlanNomor,
          PlanTanggal,
          Number(PlanJumlah) || 0,
          userKode,
        ],
      );

      // Jika nomor duplikat (INSERT IGNORE → affectedRows = 0), retry generate
      if (result.affectedRows === 0) {
        nomor = await generateNomor(conn, Tanggal, Cab);
        await conn.query(
          `INSERT INTO tpojasa_hdr
         (pojh_nomor, pojh_tanggal, pojh_dateline, pojh_keterangan, pojh_note,
          pojh_sup_kode, pojh_spk_nomor, pojh_status_ppn, pojh_ppn,
          pojh_gdgp_kode, pojh_jumlah, pojh_tarif, pojh_jasa_kode, pojh_cab,
          pojh_plan_nomor, pojh_plan_tanggal, pojh_plan_jumlah,
          date_create, user_create)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NOW(),?)`,
          [
            nomor,
            Tanggal,
            Dateline || Tanggal,
            Keterangan,
            Note,
            SupKode,
            SpkNomor,
            StatusPPN,
            Number(PPN) || 0,
            GdgpKode,
            Number(JumlahPO) || 0,
            Number(Tarif) || 0,
            JasaKode,
            Cab,
            PlanNomor,
            PlanTanggal,
            Number(PlanJumlah) || 0,
            userKode,
          ],
        );
      }
    } else {
      await conn.query(
        `UPDATE tpojasa_hdr SET
           pojh_tanggal = ?, pojh_dateline = ?, pojh_keterangan = ?, pojh_note = ?,
           pojh_sup_kode = ?, pojh_spk_nomor = ?, pojh_status_ppn = ?, pojh_ppn = ?,
           pojh_gdgp_kode = ?, pojh_jumlah = ?, pojh_tarif = ?, pojh_jasa_kode = ?,
           pojh_plan_nomor = ?, pojh_plan_tanggal = ?, pojh_plan_jumlah = ?,
           date_modified = NOW(), user_modified = ?
         WHERE pojh_nomor = ?`,
        [
          Tanggal,
          Dateline || Tanggal,
          Keterangan,
          Note,
          SupKode,
          SpkNomor,
          StatusPPN,
          Number(PPN) || 0,
          GdgpKode,
          Number(JumlahPO) || 0,
          Number(Tarif) || 0,
          JasaKode,
          PlanNomor,
          PlanTanggal,
          Number(PlanJumlah) || 0,
          userKode,
          nomor,
        ],
      );
    }

    await conn.query(`DELETE FROM tpojasa_dtl WHERE pojd_pojh_nomor = ?`, [
      nomor,
    ]);

    // Tab Komponen (pojd_statuspotong = NULL)
    for (const r of KomponenRows.filter(
      (r) => r.kode && Number(r.jumlah) > 0,
    )) {
      await conn.query(
        `INSERT INTO tpojasa_dtl
           (pojd_pojh_nomor, pojd_bhn_kode, pojd_bhn_satuan, pojd_jumlah, pojd_gdg_kode)
         VALUES (?,?,?,?,?)`,
        [
          nomor,
          r.kode,
          r.satuan || "",
          Number(r.jumlah) || 0,
          r.gdg_kode || "",
        ],
      );
    }

    // Tab Bahan (pojd_statuspotong = 1)
    for (const r of BahanRows.filter((r) => r.kode && Number(r.jumlah) > 0)) {
      await conn.query(
        `INSERT INTO tpojasa_dtl
           (pojd_pojh_nomor, pojd_bhn_kode, pojd_bhn_satuan,
            pojd_jumlah, pojd_harga, pojd_gdg_kode, pojd_statuspotong)
         VALUES (?,?,?,?,?,?,1)`,
        [
          nomor,
          r.kode,
          r.satuan || "",
          Number(r.jumlah) || 0,
          Number(r.harga) || 0,
          r.gdg_kode || "",
        ],
      );
    }

    // PIN5 ACC → tandai dipakai
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

module.exports = {
  getSpkInfo,
  getJasaList,
  getPlanningPpic,
  getLhkPo,
  loadKodeBahan,
  searchBahan,
  getSetFromMutasi,
  searchSupplier,
  getSupplierByKode,
  searchGudangProduksi,
  cekPendingGudang,
  getById,
  generateNomor,
  save,
};
