const db = require("../../config/database");
const fs = require("fs");
const path = require("path");

const STATUS_VALID = [
  "DRAFT",
  "MENUNGGU",
  "LANJUT",
  "REJECT",
  "SEBAGIAN",
  "TUNDA",
];

const getBrowse = async (startDate, endDate, status = "ALL") => {
  const params = [startDate, endDate];
  let statusFilter = "";
  if (status && status !== "ALL" && STATUS_VALID.includes(status)) {
    statusFilter = "AND h.qc_status = ?";
    params.push(status);
  }

  const [rows] = await db.query(
    `
    SELECT
      h.qc_nomor AS Nomor,
      DATE_FORMAT(h.qc_tgl_datang, "%Y-%m-%d") AS TglDatang,
      h.qc_po_nomor AS Nomor_PO,
      h.qc_vendor_greige AS VendorGreige,
      h.qc_jenis_kain AS JenisKain,
      h.qc_vendor_celup AS VendorCelup,
      h.qc_status AS Status,
      h.qc_keterangan AS Keterangan,
      IFNULL(x.jml_lot, 0) AS JumlahLot,
      IFNULL(x.tot_kg, 0) AS TotalKg,
      IFNULL(x.tot_roll, 0) AS TotalRoll,
      IFNULL(NULLIF(pd.pod_bhn_satuan, ''), 'Kg') AS Satuan,
      IFNULL(x.nilai_min, 0) AS NilaiMin,
      h.user_create AS Usr,
      h.date_create AS Created,
      IFNULL((
        SELECT
          IF(pin_acc="" AND pin_dipakai="", "WAIT",
          IF(pin_acc="Y" AND pin_dipakai="", "ACC",
          IF(pin_acc="Y" AND pin_dipakai="Y", "",
          IF(pin_acc="N", "TOLAK", ""))))
        FROM tspk_pin5
        WHERE pin_trs = "QC BAHAN" AND pin_nomor = h.qc_nomor
        ORDER BY pin_urut DESC LIMIT 1
      ), "") AS Ngedit
    FROM tqc_bahan_hdr h
    LEFT JOIN (
      SELECT
        qcd_qc_nomor,
        COUNT(*) AS jml_lot,
        SUM(qcd_qty_kg) AS tot_kg,
        SUM(qcd_qty_roll) AS tot_roll,
        MIN(NULLIF(qcd_nilai, 0)) AS nilai_min
      FROM tqc_bahan_dtl
      GROUP BY qcd_qc_nomor
    ) x ON x.qcd_qc_nomor = h.qc_nomor
    LEFT JOIN tpo_dtl pd
      ON pd.pod_po_nomor = h.qc_po_nomor
    AND pd.pod_nourut = h.qc_pod_nourut
    WHERE h.qc_tgl_datang BETWEEN ? AND ?
      ${statusFilter}
    ORDER BY h.qc_nomor DESC
    `,
    params,
  );

  return rows;
};

const getBrowseDetail = async (nomor) => {
  const [rows] = await db.query(
    `
    SELECT
      d.qcd_qc_nomor AS Nomor,
      d.qcd_nourut AS Nourut,
      d.qcd_lot AS Lot,
      d.qcd_po_nomor AS PO,
      d.qcd_qty_kg AS Kg,
      IFNULL(NULLIF(pd.pod_bhn_satuan, ''), 'Kg') AS Satuan,
      d.qcd_qty_roll AS Roll,
      d.qcd_gramasi_po AS GramasiPO,
      d.qcd_setting_po AS SettingPO,
      d.qcd_warna AS Warna,
      d.qcd_gramasi_cek AS GramasiCek,
      d.qcd_setting_cek AS SettingCek,
      d.qcd_nilai AS Nilai,
      d.qcd_nilai_saran AS Saran,
      d.qcd_alasan_nilai AS AlasanNilai,
      d.qcd_keputusan AS Keputusan
    FROM tqc_bahan_dtl d
    INNER JOIN tqc_bahan_hdr h ON h.qc_nomor = d.qcd_qc_nomor
    LEFT JOIN tpo_dtl pd
      ON pd.pod_po_nomor = h.qc_po_nomor
     AND pd.pod_nourut = h.qc_pod_nourut
    WHERE d.qcd_qc_nomor = ?
    ORDER BY d.qcd_nourut
    `,
    [nomor],
  );
  return rows;
};

const deleteQc = async (nomor) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [hdr] = await conn.query(
      `SELECT qc_status FROM tqc_bahan_hdr WHERE qc_nomor = ? FOR UPDATE`,
      [nomor],
    );
    if (hdr.length === 0) throw new Error("Data QC Bahan tidak ditemukan.");

    if (hdr[0].qc_status !== "DRAFT") {
      throw new Error(
        "Hanya dokumen berstatus DRAFT yang bisa dihapus. Gunakan pengajuan perubahan data.",
      );
    }

    await conn.query(`DELETE FROM tqc_bahan_lampiran WHERE qcl_qc_nomor = ?`, [
      nomor,
    ]);
    await conn.query(`DELETE FROM tqc_bahan_hasil WHERE qch_qc_nomor = ?`, [
      nomor,
    ]);
    await conn.query(`DELETE FROM tqc_bahan_dtl WHERE qcd_qc_nomor = ?`, [
      nomor,
    ]);
    await conn.query(`DELETE FROM tqc_bahan_hdr WHERE qc_nomor = ?`, [nomor]);

    await conn.commit();
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }

  // Hapus folder foto setelah commit (nama folder sama dengan saat upload)
  const folder = path.join(
    process.cwd(),
    "public/uploads/qc-bahan",
    String(nomor).replace(/[^A-Za-z0-9_-]/g, "-"),
  );
  fs.rmSync(folder, { recursive: true, force: true });

  return true;
};

const requestPinPerubahan = async (nomor, alasan, userKode) => {
  const [qc] = await db.query(
    `SELECT qc_tgl_datang, qc_keterangan, qc_status FROM tqc_bahan_hdr WHERE qc_nomor = ?`,
    [nomor],
  );
  if (qc.length === 0) throw new Error("Data QC Bahan tidak ditemukan.");

  const hdr = qc[0];
  if (hdr.qc_status === "DRAFT") {
    throw new Error(
      "Dokumen masih DRAFT, bisa diubah langsung tanpa pengajuan.",
    );
  }

  const [pin] = await db.query(
    `SELECT pin_urut, pin_dipakai FROM tspk_pin5 WHERE pin_trs="QC BAHAN" AND pin_nomor=? ORDER BY pin_urut DESC LIMIT 1`,
    [nomor],
  );

  let pinUrut = 1;
  if (pin.length > 0) {
    if (pin[0].pin_dipakai === "") {
      throw new Error("Pengajuan sebelumnya belum di-ACC atau dipakai.");
    }
    pinUrut = Number(pin[0].pin_urut) + 1;
  }

  await db.query(
    `
    INSERT INTO tspk_pin5 (
      pin_trs, pin_jenis, pin_nomor, pin_urut, pin_tgl_trs, pin_ket, pin_tgl_minta, pin_user_minta, pin_alasan
    ) VALUES (
      "QC BAHAN", "UBAH", ?, ?, ?, ?, NOW(), ?, ?
    ) ON DUPLICATE KEY UPDATE
      pin_tgl_trs=?, pin_ket=?, pin_acc="", pin_tgl_minta=NOW(), pin_user_minta=?, pin_alasan=?
    `,
    [
      nomor,
      pinUrut,
      hdr.qc_tgl_datang,
      hdr.qc_keterangan,
      userKode,
      alasan,
      hdr.qc_tgl_datang,
      hdr.qc_keterangan,
      userKode,
      alasan,
    ],
  );

  return true;
};

// Submit dokumen DRAFT -> MENUNGGU, validasi penuh dari data tersimpan
const submitQc = async (nomor, userKode) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [cur] = await conn.query(
      `SELECT qc_status FROM tqc_bahan_hdr WHERE qc_nomor = ? FOR UPDATE`,
      [nomor],
    );
    if (cur.length === 0) throw new Error("Data QC Bahan tidak ditemukan.");
    if (cur[0].qc_status !== "DRAFT") {
      throw new Error("Hanya dokumen berstatus DRAFT yang dapat disubmit.");
    }

    const [rows] = await conn.query(
      `SELECT qcd_lot, qcd_qty_kg, qcd_qty_roll, qcd_gramasi_cek, qcd_setting_cek, qcd_nilai,
              qcd_nilai_saran, qcd_alasan_nilai
       FROM tqc_bahan_dtl WHERE qcd_qc_nomor = ?`,
      [nomor],
    );
    if (rows.length === 0) throw new Error("Dokumen belum memiliki lot.");

    for (const r of rows) {
      const nilai = Number(r.qcd_nilai) || 0;
      const saran = Number(r.qcd_nilai_saran) || 0;
      if (!(Number(r.qcd_qty_kg) > 0)) {
        throw new Error(`Qty lot ${r.qcd_lot} wajib diisi.`);
      }
      if (!(Number(r.qcd_qty_roll) > 0)) {
        throw new Error(`Roll lot ${r.qcd_lot} wajib diisi.`);
      }
      if (nilai <= 0) throw new Error(`Nilai lot ${r.qcd_lot} wajib diisi.`);
      if (!(Number(r.qcd_gramasi_cek) > 0)) {
        throw new Error(`Gramasi hasil cek lot ${r.qcd_lot} wajib diisi.`);
      }
      if (!String(r.qcd_setting_cek || "").trim()) {
        throw new Error(`Setting hasil cek lot ${r.qcd_lot} wajib diisi.`);
      }
      if (
        saran > 0 &&
        nilai !== saran &&
        !String(r.qcd_alasan_nilai || "").trim()
      ) {
        throw new Error(
          `Nilai lot ${r.qcd_lot} berbeda dari saran sistem (${saran}). Alasan wajib diisi.`,
        );
      }
    }

    await conn.query(
      `UPDATE tqc_bahan_hdr
       SET qc_status = 'MENUNGGU', user_modified = ?, date_modified = NOW()
       WHERE qc_nomor = ?`,
      [userKode, nomor],
    );

    await conn.commit();
    return { qc_nomor: nomor, status: "MENUNGGU" };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
};

module.exports = {
  getBrowse,
  getBrowseDetail,
  deleteQc,
  requestPinPerubahan,
  submitQc,
};
