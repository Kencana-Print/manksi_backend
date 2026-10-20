const db = require("../../config/database");

const PREFIX = "RQC";
const LOCK_NAME = "retur_qc_nomor";

const generateNomor = async (conn, tanggal) => {
  const prefix = `${PREFIX}${String(tanggal).substring(0, 4)}`;
  const [[row]] = await conn.query(
    `SELECT IFNULL(MAX(CAST(RIGHT(qr_nomor, 5) AS UNSIGNED)), 0) AS maxNum
     FROM tqc_retur_hdr WHERE LEFT(qr_nomor, 7) = ?`,
    [prefix],
  );
  return `${prefix}.${String(Number(row.maxNum) + 1).padStart(5, "0")}`;
};

// Dokumen QC yang masih punya lot REJECT belum habis diretur (untuk dialog pilih)
const getQcRejectSiap = async () => {
  const [rows] = await db.query(
    `
    SELECT
      h.qc_nomor AS Nomor,
      DATE_FORMAT(h.qc_tgl_datang, "%Y-%m-%d") AS TglDatang,
      h.qc_po_nomor AS Nomor_PO,
      h.qc_jenis_kain AS JenisKain,
      s.sup_nama AS Supplier,
      COUNT(*) AS LotReject,
      SUM(d.qcd_qty_kg - IFNULL(r.qty, 0)) AS SisaQty,
      IFNULL(NULLIF(MAX(pd.pod_bhn_satuan), ''), 'Kg') AS Satuan
    FROM tqc_bahan_hdr h
    INNER JOIN tqc_bahan_dtl d
      ON d.qcd_qc_nomor = h.qc_nomor AND d.qcd_keputusan = 'REJECT'
    LEFT JOIN (
      SELECT qrd_qc_nomor, qrd_lot, SUM(qrd_qty) AS qty
      FROM tqc_retur_dtl
      GROUP BY qrd_qc_nomor, qrd_lot
    ) r ON r.qrd_qc_nomor = d.qcd_qc_nomor AND r.qrd_lot = d.qcd_lot
    LEFT JOIN tpo_hdr p ON p.po_nomor = h.qc_po_nomor
    LEFT JOIN tpo_dtl pd
      ON pd.pod_po_nomor = h.qc_po_nomor AND pd.pod_nourut = h.qc_pod_nourut
    LEFT JOIN tsupplier s
      ON s.sup_kode = IFNULL(NULLIF(pd.pod_sup_kode, ''), p.po_sup_kode)
    WHERE h.qc_status <> 'DRAFT'
      AND d.qcd_qty_kg - IFNULL(r.qty, 0) > 0
    GROUP BY h.qc_nomor, h.qc_tgl_datang, h.qc_po_nomor, h.qc_jenis_kain, s.sup_nama
    ORDER BY h.qc_nomor DESC
    `,
  );
  return rows;
};

// Lot REJECT satu dokumen QC + sisa yang boleh diretur.
// excludeRetur = nomor retur yang sedang diedit (tidak dihitung sebagai "sudah diretur").
const getLotReject = async (qcNomor, excludeRetur = "") => {
  const [hdr] = await db.query(
    `
    SELECT h.qc_nomor, h.qc_status, h.qc_po_nomor, h.qc_jenis_kain,
           IFNULL(NULLIF(pd.pod_sup_kode, ''), p.po_sup_kode) AS po_sup_kode,
           s.sup_nama, s.sup_alamat
    FROM tqc_bahan_hdr h
    LEFT JOIN tpo_hdr p ON p.po_nomor = h.qc_po_nomor
    LEFT JOIN tpo_dtl pd
      ON pd.pod_po_nomor = h.qc_po_nomor AND pd.pod_nourut = h.qc_pod_nourut
    LEFT JOIN tsupplier s
      ON s.sup_kode = IFNULL(NULLIF(pd.pod_sup_kode, ''), p.po_sup_kode)
    WHERE h.qc_nomor = ?
    `,
    [qcNomor],
  );
  if (hdr.length === 0) throw new Error("Dokumen QC tidak ditemukan.");
  if (hdr[0].qc_status === "DRAFT") {
    throw new Error("Dokumen QC masih DRAFT.");
  }

  const [lots] = await db.query(
    `
    SELECT
      d.qcd_nourut AS Nourut,
      d.qcd_lot AS Lot,
      d.qcd_bhn_kode AS Kode,
      b.bhn_name AS Nama,
      IFNULL(NULLIF(pd.pod_bhn_satuan, ''), b.bhn_satuan) AS Satuan,
      d.qcd_warna AS Warna,
      d.qcd_qty_kg AS Qty,
      d.qcd_qty_roll AS Roll,
      IFNULL(r.qty, 0) AS QtyRetur,
      IFNULL(r.roll, 0) AS RollRetur
    FROM tqc_bahan_dtl d
    INNER JOIN tqc_bahan_hdr h ON h.qc_nomor = d.qcd_qc_nomor
    LEFT JOIN tbahan b ON b.bhn_kode = d.qcd_bhn_kode
    LEFT JOIN tpo_dtl pd
      ON pd.pod_po_nomor = h.qc_po_nomor AND pd.pod_nourut = h.qc_pod_nourut
    LEFT JOIN (
      SELECT qrd_lot, SUM(qrd_qty) AS qty, SUM(qrd_roll) AS roll
      FROM tqc_retur_dtl
      WHERE qrd_qc_nomor = ? AND qrd_nomor <> ?
      GROUP BY qrd_lot
    ) r ON r.qrd_lot = d.qcd_lot
    WHERE d.qcd_qc_nomor = ? AND d.qcd_keputusan = 'REJECT'
    ORDER BY d.qcd_nourut
    `,
    [qcNomor, excludeRetur, qcNomor],
  );

  return {
    header: {
      qcNomor: hdr[0].qc_nomor,
      noPo: hdr[0].qc_po_nomor,
      jenisKain: hdr[0].qc_jenis_kain,
      supKode: hdr[0].po_sup_kode || "",
      supNama: hdr[0].sup_nama || "",
      supAlamat: hdr[0].sup_alamat || "",
    },
    lots: lots.map((l) => ({
      ...l,
      Qty: Number(l.Qty) || 0,
      Roll: Number(l.Roll) || 0,
      QtyRetur: Number(l.QtyRetur) || 0,
      RollRetur: Number(l.RollRetur) || 0,
      SisaQty: (Number(l.Qty) || 0) - (Number(l.QtyRetur) || 0),
      SisaRoll: (Number(l.Roll) || 0) - (Number(l.RollRetur) || 0),
    })),
  };
};

const getFormData = async (nomor) => {
  const [hdr] = await db.query(
    `
    SELECT h.qr_nomor AS nomor, DATE_FORMAT(h.qr_tanggal, "%Y-%m-%d") AS tanggal,
           h.qr_qc_nomor AS qcNomor, h.qr_no_sj AS noSj,
           h.qr_keterangan AS keterangan, h.qr_sup_kode AS supKode,
           s.sup_nama AS supNama, s.sup_alamat AS supAlamat
    FROM tqc_retur_hdr h
    LEFT JOIN tsupplier s ON s.sup_kode = h.qr_sup_kode
    WHERE h.qr_nomor = ?
    `,
    [nomor],
  );
  if (hdr.length === 0) throw new Error("Nomor Retur tidak ditemukan.");

  const { header: qcHdr, lots } = await getLotReject(hdr[0].qcNomor, nomor);

  const [rows] = await db.query(
    `SELECT qrd_lot AS lot, qrd_qty AS qty, qrd_roll AS roll
     FROM tqc_retur_dtl WHERE qrd_nomor = ? ORDER BY qrd_nourut`,
    [nomor],
  );

  return {
    header: { ...hdr[0], noPo: qcHdr.noPo, jenisKain: qcHdr.jenisKain },
    lots,
    rows: rows.map((r) => ({
      lot: r.lot,
      qty: Number(r.qty) || 0,
      roll: Number(r.roll) || 0,
    })),
  };
};

// Validasi + bentuk baris detail. Harus dipanggil di dalam transaksi.
const siapkan = async (conn, payload, excludeRetur) => {
  const tanggal = String(payload.tanggal || "").substring(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tanggal)) {
    throw new Error("Tanggal wajib diisi.");
  }
  const qcNomor = String(payload.qcNomor || "").trim();
  if (!qcNomor) throw new Error("Dokumen QC wajib dipilih.");

  const inputRows = Array.isArray(payload.rows) ? payload.rows : [];
  if (inputRows.length === 0) {
    throw new Error("Minimal satu lot harus diretur.");
  }

  // Kunci per dokumen QC agar dua retur bersamaan tidak melebihi qty lot
  const [qc] = await conn.query(
    `SELECT qc_status FROM tqc_bahan_hdr WHERE qc_nomor = ? FOR UPDATE`,
    [qcNomor],
  );
  if (qc.length === 0) throw new Error("Dokumen QC tidak ditemukan.");
  if (qc[0].qc_status === "DRAFT") throw new Error("Dokumen QC masih DRAFT.");

  const [sup] = await conn.query(
    `SELECT IFNULL(NULLIF(pd.pod_sup_kode, ''), p.po_sup_kode) AS sup_kode
     FROM tqc_bahan_hdr h
     LEFT JOIN tpo_hdr p ON p.po_nomor = h.qc_po_nomor
     LEFT JOIN tpo_dtl pd
       ON pd.pod_po_nomor = h.qc_po_nomor AND pd.pod_nourut = h.qc_pod_nourut
     WHERE h.qc_nomor = ?`,
    [qcNomor],
  );
  const supKode = sup[0]?.sup_kode || "";
  if (!supKode) {
    throw new Error("Supplier PO dokumen QC ini tidak ditemukan.");
  }
  const [lots] = await conn.query(
    `
    SELECT d.qcd_lot, d.qcd_bhn_kode, d.qcd_keputusan, d.qcd_qty_kg, d.qcd_qty_roll,
           IFNULL(r.qty, 0) AS qty_retur, IFNULL(r.roll, 0) AS roll_retur
    FROM tqc_bahan_dtl d
    LEFT JOIN (
      SELECT qrd_lot, SUM(qrd_qty) AS qty, SUM(qrd_roll) AS roll
      FROM tqc_retur_dtl
      WHERE qrd_qc_nomor = ? AND qrd_nomor <> ?
      GROUP BY qrd_lot
    ) r ON r.qrd_lot = d.qcd_lot
    WHERE d.qcd_qc_nomor = ?
    `,
    [qcNomor, excludeRetur, qcNomor],
  );
  const lotMap = new Map(lots.map((l) => [l.qcd_lot, l]));

  const dipakai = new Set();
  const rows = inputRows.map((r, i) => {
    const lotNo = String(r.lot || "").trim();
    const lot = lotMap.get(lotNo);
    if (!lot) throw new Error(`Lot ${lotNo} tidak ada di dokumen QC ini.`);
    if (lot.qcd_keputusan !== "REJECT") {
      throw new Error(`Lot ${lotNo} bukan lot REJECT.`);
    }
    if (dipakai.has(lotNo)) throw new Error(`Lot ${lotNo} terduplikasi.`);
    dipakai.add(lotNo);

    const qty = Number(r.qty) || 0;
    const roll = Number(r.roll) || 0;
    if (!(qty > 0)) throw new Error(`Qty retur lot ${lotNo} wajib diisi.`);
    if (roll < 0 || !Number.isInteger(roll)) {
      throw new Error(`Roll retur lot ${lotNo} tidak valid.`);
    }

    const sisaQty = Number(lot.qcd_qty_kg) - Number(lot.qty_retur);
    const sisaRoll = Number(lot.qcd_qty_roll) - Number(lot.roll_retur);
    if (qty > sisaQty + 0.0001) {
      throw new Error(
        `Qty retur lot ${lotNo} (${qty}) melebihi sisa yang boleh diretur (${sisaQty}).`,
      );
    }
    if (roll > sisaRoll) {
      throw new Error(
        `Roll retur lot ${lotNo} (${roll}) melebihi sisa yang boleh diretur (${sisaRoll}).`,
      );
    }

    return {
      nourut: i + 1,
      lot: lotNo,
      bhnKode: lot.qcd_bhn_kode,
      qty,
      roll,
    };
  });

  return { tanggal, qcNomor, supKode, rows };
};

const insertRows = async (conn, nomor, qcNomor, rows) => {
  for (const r of rows) {
    await conn.query(
      `INSERT INTO tqc_retur_dtl
         (qrd_nomor, qrd_nourut, qrd_qc_nomor, qrd_lot, qrd_bhn_kode, qrd_qty, qrd_roll)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [nomor, r.nourut, qcNomor, r.lot, r.bhnKode, r.qty, r.roll],
    );
  }
};

const create = async (payload, userKode) => {
  const conn = await db.getConnection();
  let locked = false;
  try {
    const [lk] = await conn.query(`SELECT GET_LOCK(?, 10) AS ok`, [LOCK_NAME]);
    if (!lk[0].ok) throw new Error("Sistem sibuk, coba lagi.");
    locked = true;

    await conn.beginTransaction();

    const s = await siapkan(conn, payload, "");
    const nomor = await generateNomor(conn, s.tanggal);

    await conn.query(
      `INSERT INTO tqc_retur_hdr
         (qr_nomor, qr_tanggal, qr_qc_nomor, qr_sup_kode, qr_no_sj,
          qr_keterangan, user_create, date_create)
       VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        nomor,
        s.tanggal,
        s.qcNomor,
        s.supKode,
        String(payload.noSj || "").trim(),
        String(payload.keterangan || "").trim(),
        userKode,
      ],
    );
    await insertRows(conn, nomor, s.qcNomor, s.rows);

    await conn.commit();
    return { nomor };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    if (locked) await conn.query(`SELECT RELEASE_LOCK(?)`, [LOCK_NAME]);
    conn.release();
  }
};

const update = async (nomor, payload, userKode) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [cur] = await conn.query(
      `SELECT qr_qc_nomor FROM tqc_retur_hdr WHERE qr_nomor = ? FOR UPDATE`,
      [nomor],
    );
    if (cur.length === 0) throw new Error("Nomor Retur tidak ditemukan.");

    // Dokumen QC tidak boleh diganti saat edit
    const s = await siapkan(
      conn,
      { ...payload, qcNomor: cur[0].qr_qc_nomor },
      nomor,
    );

    await conn.query(
      `UPDATE tqc_retur_hdr
       SET qr_tanggal = ?, qr_no_sj = ?, qr_keterangan = ?, qr_sup_kode = ?,
           user_modified = ?, date_modified = NOW()
       WHERE qr_nomor = ?`,
      [
        s.tanggal,
        String(payload.noSj || "").trim(),
        String(payload.keterangan || "").trim(),
        s.supKode,
        userKode,
        nomor,
      ],
    );
    await conn.query(`DELETE FROM tqc_retur_dtl WHERE qrd_nomor = ?`, [nomor]);
    await insertRows(conn, nomor, s.qcNomor, s.rows);

    await conn.commit();
    return { nomor };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
};

module.exports = {
  getQcRejectSiap,
  getLotReject,
  getFormData,
  create,
  update,
};
