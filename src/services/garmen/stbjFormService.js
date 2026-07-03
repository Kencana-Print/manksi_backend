const db = require("../../config/database");

// ─────────────────────────────────────────────────────────
// GENERATE NOMOR — STBJ/NNNNN/YYYY
// Sesuai Delphi getmaxnomor
// ─────────────────────────────────────────────────────────
const generateNomor = async (tanggal, conn) => {
  const tahun = new Date(tanggal).getFullYear();
  const [[row]] = await conn.query(
    `SELECT IFNULL(MAX(CAST(SUBSTR(stbj_nomor, 6, 5) AS UNSIGNED)), 0) AS max_val
     FROM tstbj_hdr
     WHERE LEFT(stbj_nomor, 4) = 'STBJ'
       AND RIGHT(stbj_nomor, 4) = ?
     FOR UPDATE`,
    [String(tahun)],
  );
  const next = parseInt(row.max_val, 10) + 1;
  return `STBJ/${String(next).padStart(5, "0")}/${tahun}`;
};

// ─────────────────────────────────────────────────────────
// GET BY NOMOR (untuk form edit)
// Sesuai Delphi loaddataall
// ─────────────────────────────────────────────────────────
const getById = async (nomor) => {
  // Header
  const [[hdr]] = await db.query(
    `SELECT
       h.stbj_nomor,
       DATE_FORMAT(h.stbj_tanggal, '%Y-%m-%d') AS stbj_tanggal,
       h.stbj_keterangan,
       h.stbj_gdg_kode,
       g.gdg_nama,
       h.stbj_gdgp_kode,
       gp.gdgp_nama,
       h.user_create
     FROM tstbj_hdr h
     LEFT JOIN tgudang g ON g.gdg_kode = h.stbj_gdg_kode
     LEFT JOIN tgudangproduksi gp ON gp.gdgp_kode = h.stbj_gdgp_kode
     WHERE h.stbj_nomor = ?`,
    [nomor],
  );
  if (!hdr) throw new Error("Data tidak ditemukan.");

  // Detail Grid 1
  const [dtl] = await db.query(
    `SELECT
       d.stbjd_packing     AS Packing,
       d.stbjd_spk_nomor   AS SpkNomor,
       IFNULL(s.spk_nama, i.spgi_nama) AS NamaSpk,
       s.spk_ukuran        AS Ukuran,
       s.spk_jumlah        AS TotalOrder,
       d.stbjd_size        AS Size,
       IFNULL(z.spks_qty, 0) AS QtyOrder,
       d.stbjd_jumlah      AS Jumlah,
       d.stbjd_koli        AS Koli,
       d.stbjd_keterangan  AS Keterangan
     FROM tstbj_dtl d
     LEFT JOIN tspk s ON s.spk_nomor = d.stbjd_spk_nomor
     LEFT JOIN tspk_size z
       ON z.spks_nomor = d.stbjd_spk_nomor
       AND z.spks_size = d.stbjd_size
     LEFT JOIN tspk_gudangitem i ON i.spgi_spk = d.stbjd_spk_nomor
     WHERE d.stbjd_stbj_nomor = ?
     ORDER BY d.stbjd_spk_nomor, d.stbjd_size`,
    [nomor],
  );

  // Hitung Jadi & Kurang per row
  for (const row of dtl) {
    const [[jadiRow]] = await db.query(
      `SELECT IFNULL(SUM(stbjd_jumlah), 0) AS jadi
       FROM tstbj_dtl
       WHERE stbjd_spk_nomor = ?
         AND stbjd_size = ?
         AND stbjd_stbj_nomor <> ?`,
      [row.SpkNomor, row.Size || "", nomor],
    );
    row.Jadi = jadiRow?.jadi ?? 0;
    row.Kurang = (row.Size ? row.QtyOrder : row.TotalOrder) - row.Jadi;
    row.Selisih = row.Jumlah - row.Kurang;
  }

  // Detail Grid 2 (hanya WH003)
  let dtl2 = [];
  if (hdr.stbj_gdg_kode === "WH003") {
    const [rows2] = await db.query(
      `SELECT
         e.tsd_packing   AS Packing,
         e.tsd_spk_nomor AS SpkNomor,
         e.tsd_kode      AS KodeKaosan,
         TRIM(CONCAT(
           a.brg_jeniskaos,' ',a.brg_tipe,' ',
           a.brg_lengan,' ',a.brg_jeniskain,' ',a.brg_warna
         ))              AS NamaKaosan,
         e.tsd_ukuran    AS Size,
         e.tsd_jumlah    AS Jumlah
       FROM retail.tdc_stbj e
       LEFT JOIN retail.tbarangdc a ON a.brg_kode = e.tsd_kode
       LEFT JOIN retail.tbarangdc_dtl b
         ON b.brgd_kode = e.tsd_kode AND b.brgd_ukuran = e.tsd_ukuran
       WHERE e.tsd_nomor = ?
       ORDER BY e.tsd_spk_nomor, e.tsd_kode, b.brgd_barcode`,
      [nomor],
    );
    dtl2 = rows2;
  }

  return { header: hdr, detail: dtl, detail2: dtl2 };
};

// ─────────────────────────────────────────────────────────
// GET JADI PER SPK+SIZE (untuk kalkulasi saat input)
// Sesuai Delphi getjadisize + getjadi
// ─────────────────────────────────────────────────────────
const getJadi = async (spkNomor, size, excludeNomor = "") => {
  if (size) {
    const [[row]] = await db.query(
      `SELECT IFNULL(SUM(stbjd_jumlah), 0) AS jadi
       FROM tstbj_dtl
       WHERE stbjd_spk_nomor = ?
         AND stbjd_size = ?
         AND stbjd_stbj_nomor <> ?`,
      [spkNomor, size, excludeNomor],
    );
    return row?.jadi ?? 0;
  } else {
    const [[row]] = await db.query(
      `SELECT IFNULL(SUM(stbjd_jumlah), 0) AS jadi
       FROM tstbj_dtl
       WHERE stbjd_spk_nomor = ?
         AND stbjd_stbj_nomor <> ?`,
      [spkNomor, excludeNomor],
    );
    return row?.jadi ?? 0;
  }
};

// ─────────────────────────────────────────────────────────
// GET SPK DETAIL untuk auto-fill grid saat pilih SPK
// Sesuai Delphi loaddatadetail — SPK biasa (ada/tidak tspk_size)
// ─────────────────────────────────────────────────────────
const getSpkDetail = async (spkNomor, gudangKode, excludeNomor = "") => {
  // Cek SPK atau MemoSPK
  const [[spkRow]] = await db.query(
    `SELECT kode, spk_pending, spk_accpending FROM (
       SELECT spk_nomor kode, spk_pending, spk_accpending FROM tspk
       WHERE spk_cmo <> '' AND spk_aktif = 'Y'
       UNION ALL
       SELECT mspk_nomor, '' spk_pending, '' spk_accpending FROM tmemospk
       WHERE mspk_cmo <> ''
     ) X WHERE X.kode = ?`,
    [spkNomor],
  );
  if (!spkRow) throw new Error("SPK tidak ditemukan.");

  // Cek apakah ada tspk_size (SPK baru per size)
  const [[sizeCheck]] = await db.query(
    `SELECT COUNT(*) AS cnt FROM tspk_size WHERE spks_nomor = ?`,
    [spkNomor],
  );

  let rows = [];

  if (sizeCheck.cnt > 0) {
    // SPK baru — per size
    const [sizes] = await db.query(
      `SELECT z.spks_nomor, s.spk_nama, s.spk_ukuran, s.spk_jumlah,
              z.spks_size, z.spks_qty
       FROM tspk_size z
       LEFT JOIN tspk s ON s.spk_nomor = z.spks_nomor
       WHERE z.spks_nomor = ?`,
      [spkNomor],
    );
    for (const r of sizes) {
      const jadi = await getJadi(spkNomor, r.spks_size, excludeNomor);
      rows.push({
        SpkNomor: r.spks_nomor,
        NamaSpk: r.spk_nama,
        Ukuran: r.spk_ukuran,
        TotalOrder: r.spk_jumlah,
        Size: r.spks_size,
        QtyOrder: r.spks_qty,
        Jumlah: 0,
        Koli: 0,
        Jadi: jadi,
        Kurang: r.spks_qty - jadi,
        Keterangan: "",
        Packing: "",
      });
    }
  } else {
    // SPK lama — 1 row tanpa size
    const [[spkInfo]] = await db.query(
      `SELECT spk_nomor, spk_nama, spk_ukuran, spk_jumlah FROM tspk
       WHERE spk_aktif = 'Y' AND spk_nomor = ?
       UNION ALL
       SELECT mspk_nomor, mspk_nama, mspk_ukuran, mspk_jumlah FROM tmemospk
       WHERE mspk_nomor = ?
       LIMIT 1`,
      [spkNomor, spkNomor],
    );
    if (spkInfo) {
      const jadi = await getJadi(spkNomor, "", excludeNomor);
      rows.push({
        SpkNomor: spkInfo.spk_nomor,
        NamaSpk: spkInfo.spk_nama,
        Ukuran: spkInfo.spk_ukuran,
        TotalOrder: spkInfo.spk_jumlah,
        Size: "",
        QtyOrder: 0,
        Jumlah: 0,
        Koli: 0,
        Jadi: jadi,
        Kurang: spkInfo.spk_jumlah - jadi,
        Keterangan: "",
        Packing: "",
      });
    }
  }

  // Load CDS2 jika WH003
  let dc = [];
  if (gudangKode === "WH003") {
    const [dcRows] = await db.query(
      `SELECT e.spkd_nomor, e.spkd_kode, e.spkd_ukuran, e.spkd_qtyorder,
              TRIM(CONCAT(
                a.brg_jeniskaos,' ',a.brg_tipe,' ',
                a.brg_lengan,' ',a.brg_jeniskain,' ',a.brg_warna
              )) AS Nama
       FROM tspk_dc e
       LEFT JOIN retail.tbarangdc a ON a.brg_kode = e.spkd_kode
       LEFT JOIN retail.tbarangdc_dtl b
         ON b.brgd_kode = e.spkd_kode AND b.brgd_ukuran = e.spkd_ukuran
       WHERE e.spkd_nomor = ?
       ORDER BY e.spkd_kode, b.brgd_barcode`,
      [spkNomor],
    );
    dc = dcRows.map((r) => ({
      Packing: "",
      SpkNomor: r.spkd_nomor,
      KodeKaosan: r.spkd_kode,
      NamaKaosan: r.Nama,
      Size: r.spkd_ukuran,
      Jumlah: 0,
    }));
  }

  return { detail: rows, detail2: dc };
};

// ─────────────────────────────────────────────────────────
// GET SPG DETAIL (F2 — dari tspk_gudangitem, khusus WH003)
// Sesuai Delphi loaddatadetail bagian SPG
// ─────────────────────────────────────────────────────────
const getSpgDetail = async (spgNomor, excludeNomor = "") => {
  const [rows] = await db.query(
    `SELECT i.spgi_spk, i.spgi_kodek, i.spgi_nama, b.brgd_ukuran
     FROM tspk_gudangitem i
     INNER JOIN retail.tbarangdc_dtl b ON b.brgd_kode = i.spgi_kodek
     WHERE i.spgi_spk = ?`,
    [spgNomor],
  );
  if (!rows.length) throw new Error("SPK Tidak ditemukan.");

  const detail = [];
  const detail2 = [];

  for (const r of rows) {
    const jadi = await getJadi(r.spgi_spk, r.brgd_ukuran, excludeNomor);
    detail.push({
      SpkNomor: r.spgi_spk,
      NamaSpk: r.spgi_nama,
      Ukuran: "",
      TotalOrder: 0,
      Size: r.brgd_ukuran,
      QtyOrder: 0,
      Jumlah: 0,
      Koli: 0,
      Jadi: jadi,
      Kurang: 0 - jadi,
      Keterangan: "",
      Packing: "",
    });
    detail2.push({
      Packing: "",
      SpkNomor: r.spgi_spk,
      KodeKaosan: r.spgi_kodek,
      NamaKaosan: r.spgi_nama,
      Size: r.brgd_ukuran,
      Jumlah: 0,
    });
  }

  return { detail, detail2 };
};

// ─────────────────────────────────────────────────────────
// LOAD FROM PACKING (btnPacking — semua packing belum ada STBJ)
// Sesuai Delphi btnPackingClick
// ─────────────────────────────────────────────────────────
const getPackingAvailable = async () => {
  const [rows] = await db.query(
    `SELECT DISTINCT y.nomor, y.spk, y.spk_nama, y.spk_ukuran, y.spk_jumlah,
            y.size, y.qtyorder, y.jml
     FROM (
       SELECT h.pack_nomor nomor, h.pack_spk_nomor spk,
              s.spk_nama, s.spk_ukuran, s.spk_jumlah,
              k.spkd_ukuran size, k.spkd_qtyorder qtyorder,
              IFNULL((
                SELECT SUM(b.packd_qty)
                FROM retail.tpacking_dtl b
                INNER JOIN retail.tpacking a
                  ON a.pack_nomor = b.packd_pack_nomor
                  AND a.pack_nostbj IS NULL
                WHERE a.pack_nomor = h.pack_nomor
                  AND a.pack_spk_nomor = h.pack_spk_nomor
                  AND b.size = k.spkd_ukuran
              ), 0) jml
       FROM retail.tpacking h
       LEFT JOIN tspk s ON s.spk_nomor = h.pack_spk_nomor
       LEFT JOIN tspk_dc k ON k.spkd_nomor = h.pack_spk_nomor
       WHERE h.pack_nostbj IS NULL
     ) y WHERE y.jml <> 0`,
  );

  // Untuk setiap packing row, load detail2 dari retail.tpacking_dtl
  const result = [];
  for (const r of rows) {
    const [dc] = await db.query(
      `SELECT a.brg_kode,
              TRIM(CONCAT(
                a.brg_jeniskaos,' ',a.brg_tipe,' ',
                a.brg_lengan,' ',a.brg_jeniskain,' ',a.brg_warna
              )) AS Nama,
              d.size, d.packd_qty
       FROM retail.tpacking_dtl d
       LEFT JOIN retail.tbarangdc_dtl b ON b.brgd_barcode = d.packd_barcode
       LEFT JOIN retail.tbarangdc a ON a.brg_kode = b.brgd_kode
       WHERE d.packd_pack_nomor = ? AND d.size = ?
       ORDER BY d.packd_barcode`,
      [r.nomor, r.size],
    );
    result.push({ ...r, dc });
  }

  return result;
};

// ─────────────────────────────────────────────────────────
// GET PACKING DETAIL (untuk lookup packing per item)
// ─────────────────────────────────────────────────────────
const getPackingDetail = async (packNomor, excludeNomor = "") => {
  const [rows] = await db.query(
    `SELECT h.pack_nomor nomor, h.pack_spk_nomor spk,
            s.spk_nama, s.spk_ukuran, s.spk_jumlah,
            k.spkd_ukuran size, k.spkd_qtyorder qtyorder,
            IFNULL(SUM(d.packd_qty), 0) jml
     FROM retail.tpacking h
     LEFT JOIN tspk s ON s.spk_nomor = h.pack_spk_nomor
     LEFT JOIN tspk_dc k ON k.spkd_nomor = h.pack_spk_nomor
     LEFT JOIN retail.tpacking_dtl d
       ON d.packd_pack_nomor = h.pack_nomor
       AND d.size = k.spkd_ukuran
       AND h.pack_spk_nomor = k.spkd_nomor
     WHERE h.pack_nomor = ?
     GROUP BY h.pack_nomor, h.pack_spk_nomor, k.spkd_ukuran
     HAVING jml <> 0`,
    [packNomor],
  );

  const result = [];
  for (const r of rows) {
    const jadi = await getJadi(r.spk, r.size, excludeNomor);
    const [dc] = await db.query(
      `SELECT a.brg_kode,
              TRIM(CONCAT(
                a.brg_jeniskaos,' ',a.brg_tipe,' ',
                a.brg_lengan,' ',a.brg_jeniskain,' ',a.brg_warna
              )) AS Nama,
              d.size, d.packd_qty
       FROM retail.tpacking_dtl d
       LEFT JOIN retail.tbarangdc_dtl b ON b.brgd_barcode = d.packd_barcode
       LEFT JOIN retail.tbarangdc a ON a.brg_kode = b.brgd_kode
       WHERE d.packd_pack_nomor = ? AND d.size = ?
       ORDER BY d.packd_barcode`,
      [packNomor, r.size],
    );
    result.push({
      Packing: r.nomor,
      SpkNomor: r.spk,
      NamaSpk: r.spk_nama,
      Ukuran: r.spk_ukuran,
      TotalOrder: r.spk_jumlah,
      Size: r.size,
      QtyOrder: r.qtyorder,
      Jumlah: r.jml,
      Koli: 0,
      Jadi: jadi,
      Kurang: r.qtyorder - jadi,
      Keterangan: "",
      dc,
    });
  }
  return result;
};

// ─────────────────────────────────────────────────────────
// LOOKUP — Daftar SPK (F1 di grid)
// Sesuai Delphi cxGrdMasterEditKeyDown F1
// ─────────────────────────────────────────────────────────
const getSpkList = async (q = "") => {
  const like = `%${q}%`;
  const [rows] = await db.query(
    `SELECT * FROM (
       SELECT spk_nomor Nomor, spk_nama Nama, spk_tanggal, spk_jumlah,
              spk_ukuran, spk_kain, spk_finishing
       FROM tspk WHERE spk_cmo <> '' AND spk_aktif = 'Y'
       UNION ALL
       SELECT mspk_nomor, mspk_nama, mspk_tanggal, mspk_jumlah,
              mspk_ukuran, mspk_kain, mspk_finishing
       FROM tmemospk WHERE mspk_cmo <> ''
     ) a
     WHERE a.Nama LIKE ? OR a.Nomor LIKE ?
     ORDER BY a.Nama
     LIMIT 100`,
    [like, like],
  );
  return rows;
};

// ─────────────────────────────────────────────────────────
// LOOKUP — Daftar SPG (F2 di grid, khusus WH003)
// Sesuai Delphi cxGrdMasterEditKeyDown F2
// ─────────────────────────────────────────────────────────
const getSpgList = async (q = "") => {
  const like = `%${q}%`;
  const [rows] = await db.query(
    `SELECT DISTINCT i.spgi_spk AS Nomor,
            DATE_FORMAT(j.spg_tanggal, '%Y-%m-%d') AS Tanggal,
            i.spgi_nama AS Nama
     FROM tspk_gudangitem i
     LEFT JOIN tspk_gudang j ON j.spg_nomor = i.spgi_nomor
     WHERE i.spgi_spk LIKE ? OR i.spgi_nama LIKE ?
     ORDER BY j.date_create DESC
     LIMIT 100`,
    [like, like],
  );
  return rows;
};

// ─────────────────────────────────────────────────────────
// SAVE (INSERT / UPDATE)
// Sesuai Delphi simpandata
// ─────────────────────────────────────────────────────────
const save = async (data, userKode, isNew) => {
  const {
    Tanggal,
    GudangKode,
    GudangProduksiKode,
    Keterangan = "",
    Detail = [],
    Detail2 = [],
  } = data;

  // ── Validasi ──────────────────────────────────────────
  if (!GudangKode) throw new Error("Gudang tidak boleh kosong.");
  if (!GudangProduksiKode)
    throw new Error("Gudang Produksi tidak boleh kosong.");

  const validDetail = Detail.filter((r) => r.NamaSpk && Number(r.Jumlah) !== 0);
  if (!validDetail.length) throw new Error("Detail harus diisi.");

  const totalJumlah = validDetail.reduce((s, r) => s + Number(r.Jumlah), 0);
  const totalKoli = validDetail.reduce((s, r) => s + Number(r.Koli), 0);
  if (totalKoli === 0) throw new Error("Qty Koli belum diisi.");
  if (totalJumlah === 0) throw new Error("Jumlah belum diisi.");

  // Validasi WH003: total jumlah Grid1 = total jumlah Grid2
  if (GudangKode === "WH003") {
    const validDetail2 = Detail2.filter(
      (r) => r.NamaKaosan && Number(r.Jumlah) !== 0,
    );
    const totalJumlah2 = validDetail2.reduce((s, r) => s + Number(r.Jumlah), 0);
    if (totalJumlah !== totalJumlah2) {
      throw new Error("Total Qty STBJ vs Qty DC harus sama.");
    }
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    let nomor = isNew ? await generateNomor(Tanggal, conn) : data.Nomor;

    if (isNew) {
      await conn.query(
        `INSERT INTO tstbj_hdr
           (stbj_nomor, stbj_tanggal, stbj_keterangan,
            stbj_gdg_kode, stbj_gdgp_kode, date_create, user_create)
         VALUES (?, ?, ?, ?, ?, NOW(), ?)`,
        [nomor, Tanggal, Keterangan, GudangKode, GudangProduksiKode, userKode],
      );
    } else {
      await conn.query(
        `UPDATE tstbj_hdr SET
           stbj_tanggal      = ?,
           stbj_keterangan   = ?,
           stbj_gdg_kode     = ?,
           stbj_gdgp_kode    = ?,
           date_modified     = NOW(),
           user_modified     = ?
         WHERE stbj_nomor = ?`,
        [Tanggal, Keterangan, GudangKode, GudangProduksiKode, userKode, nomor],
      );
    }

    // Delete + Insert detail
    await conn.query(`DELETE FROM tstbj_dtl WHERE stbjd_stbj_nomor = ?`, [
      nomor,
    ]);

    for (const row of validDetail) {
      await conn.query(
        `INSERT INTO tstbj_dtl
           (stbjd_stbj_nomor, stbjd_spk_nomor, stbjd_size,
            stbjd_jumlah, stbjd_koli, stbjd_keterangan, stbjd_packing)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          nomor,
          row.SpkNomor || "",
          row.Size || "",
          Number(row.Jumlah),
          Number(row.Koli),
          row.Keterangan || "",
          row.Packing || "",
        ],
      );
      // Update packing jika ada
      if (row.Packing) {
        await conn.query(
          `UPDATE retail.tpacking SET pack_nostbj = ?
           WHERE pack_nomor = ?`,
          [nomor, row.Packing],
        );
      }
    }

    // Delete + Insert retail.tdc_stbj (hanya WH003)
    await conn.query(`DELETE FROM retail.tdc_stbj WHERE tsd_nomor = ?`, [
      nomor,
    ]);

    if (GudangKode === "WH003") {
      const validDetail2 = Detail2.filter(
        (r) => r.NamaKaosan && Number(r.Jumlah) !== 0,
      );
      for (const row of validDetail2) {
        await conn.query(
          `INSERT INTO retail.tdc_stbj
             (tsd_nomor, tsd_packing, tsd_spk_nomor,
              tsd_kode, tsd_ukuran, tsd_jumlah)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            nomor,
            row.Packing || "",
            row.SpkNomor || "",
            row.KodeKaosan || "",
            row.Size || "",
            Number(row.Jumlah),
          ],
        );
      }
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
// CETAK — data untuk print view
// Sesuai Delphi cetak
// ─────────────────────────────────────────────────────────
const getDataCetak = async (nomor) => {
  const [[hdr]] = await db.query(
    `SELECT h.stbj_nomor, DATE_FORMAT(h.stbj_tanggal,'%Y-%m-%d') AS stbj_tanggal,
            h.stbj_keterangan, h.stbj_gdg_kode, g.gdg_nama,
            h.stbj_gdgp_kode, gp.gdgp_nama, h.user_create
     FROM tstbj_hdr h
     LEFT JOIN tgudang g ON g.gdg_kode = h.stbj_gdg_kode
     LEFT JOIN tgudangproduksi gp ON gp.gdgp_kode = h.stbj_gdgp_kode
     WHERE h.stbj_nomor = ?`,
    [nomor],
  );
  if (!hdr) throw new Error("Data tidak ditemukan.");

  const [dtl] = await db.query(
    `SELECT d.stbjd_packing, d.stbjd_spk_nomor,
            IFNULL(s.spk_nama, i.spgi_nama) AS spk_nama,
            s.spk_ukuran, s.spk_jumlah, d.stbjd_size,
            IFNULL(z.spks_qty, 0) AS qtyorder,
            d.stbjd_jumlah, d.stbjd_koli, d.stbjd_keterangan
     FROM tstbj_dtl d
     LEFT JOIN tspk s ON s.spk_nomor = d.stbjd_spk_nomor
     LEFT JOIN tspk_gudangitem i ON i.spgi_spk = d.stbjd_spk_nomor
     LEFT JOIN tspk_size z
       ON z.spks_nomor = d.stbjd_spk_nomor AND z.spks_size = d.stbjd_size
     WHERE d.stbjd_stbj_nomor = ?
     ORDER BY d.stbjd_spk_nomor, d.stbjd_size`,
    [nomor],
  );

  return { header: hdr, detail: dtl };
};

module.exports = {
  generateNomor,
  getById,
  getJadi,
  getSpkDetail,
  getSpgDetail,
  getPackingAvailable,
  getPackingDetail,
  getSpkList,
  getSpgList,
  save,
  getDataCetak,
};
