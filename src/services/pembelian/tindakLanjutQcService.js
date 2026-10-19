const db = require("../../config/database");

// Nilai pin_trs untuk pengajuan perubahan keputusan oleh Pembelian.
// Sengaja dipisah dari "QC BAHAN" (pengajuan edit dokumen oleh Gudang)
// supaya dua rantai PIN tidak saling mengunci.
const PIN_TRS = "QC KEPUTUSAN";

const STATUS_VALID = ["MENUNGGU", "LANJUT", "REJECT", "SEBAGIAN", "TUNDA"];
const KEPUTUSAN_VALID = ["LANJUT", "REJECT", "TUNDA"];

// Status dokumen = ringkasan keputusan semua lot
const hitungStatusDok = (keputusanList) => {
  if (keputusanList.some((k) => !k)) return "MENUNGGU";
  if (keputusanList.every((k) => k === "LANJUT")) return "LANJUT";
  if (keputusanList.every((k) => k === "REJECT")) return "REJECT";
  if (keputusanList.every((k) => k === "TUNDA")) return "TUNDA";
  return "SEBAGIAN";
};

// Browse dokumen QC yang sudah disubmit Gudang (DRAFT tidak tampil)
const getBrowse = async (startDate, endDate, status = "ALL") => {
  const params = [PIN_TRS, startDate, endDate];
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
      h.qc_vendor_celup AS VendorCelup,
      h.qc_jenis_kain AS JenisKain,
      h.qc_status AS Status,
      h.qc_keterangan AS Keterangan,
      IFNULL(x.jml_lot, 0) AS JumlahLot,
      IFNULL(x.lot_lanjut, 0) AS LotLanjut,
      IFNULL(x.lot_reject, 0) AS LotReject,
      IFNULL(x.lot_tunda, 0) AS LotTunda,
      IFNULL(x.lot_belum, 0) AS LotBelum,
      IFNULL(x.tot_kg, 0) AS TotalKg,
      IFNULL(x.tot_roll, 0) AS TotalRoll,
      IFNULL(NULLIF(pd.pod_bhn_satuan, ''), 'Kg') AS Satuan,
      h.user_create AS Usr,
      h.date_create AS Created,
      IFNULL((
        SELECT
          IF(pin_acc="" AND pin_dipakai="", "WAIT",
          IF(pin_acc="Y" AND pin_dipakai="", "ACC",
          IF(pin_acc="Y" AND pin_dipakai="Y", "",
          IF(pin_acc="N", "TOLAK", ""))))
        FROM tspk_pin5
        WHERE pin_trs = ? AND pin_nomor = h.qc_nomor
        ORDER BY pin_urut DESC LIMIT 1
      ), "") AS Ngedit
    FROM tqc_bahan_hdr h
    LEFT JOIN (
      SELECT
        qcd_qc_nomor,
        COUNT(*) AS jml_lot,
        SUM(qcd_keputusan = 'LANJUT') AS lot_lanjut,
        SUM(qcd_keputusan = 'REJECT') AS lot_reject,
        SUM(qcd_keputusan = 'TUNDA') AS lot_tunda,
        SUM(IFNULL(qcd_keputusan, '') = '') AS lot_belum,
        SUM(qcd_qty_kg) AS tot_kg,
        SUM(qcd_qty_roll) AS tot_roll
      FROM tqc_bahan_dtl
      GROUP BY qcd_qc_nomor
    ) x ON x.qcd_qc_nomor = h.qc_nomor
    LEFT JOIN tpo_dtl pd
      ON pd.pod_po_nomor = h.qc_po_nomor
     AND pd.pod_nourut = h.qc_pod_nourut
    WHERE h.qc_status <> 'DRAFT'
      AND h.qc_tgl_datang BETWEEN ? AND ?
      ${statusFilter}
    ORDER BY h.qc_nomor DESC
    `,
    // PIN_TRS dipakai di subquery SELECT (urutan ? pertama), lalu tanggal & status
    params,
  );

  return rows;
};

// Detail lot untuk dialog keputusan: data cek + keputusan terakhir + penanda sudah di BPB
const getDetailLot = async (nomor) => {
  const [hdr] = await db.query(
    `SELECT qc_status FROM tqc_bahan_hdr WHERE qc_nomor = ?`,
    [nomor],
  );
  if (hdr.length === 0) throw new Error("Data QC Bahan tidak ditemukan.");

  const [rows] = await db.query(
    `
    SELECT
      d.qcd_nourut AS Nourut,
      d.qcd_lot AS Lot,
      d.qcd_qty_kg AS Kg,
      IFNULL(NULLIF(pd.pod_bhn_satuan, ''), 'Kg') AS Satuan,
      d.qcd_qty_roll AS Roll,
      d.qcd_warna AS Warna,
      d.qcd_gramasi_po AS GramasiPO,
      d.qcd_setting_po AS SettingPO,
      d.qcd_gramasi_cek AS GramasiCek,
      d.qcd_setting_cek AS SettingCek,
      d.qcd_nilai AS Nilai,
      IFNULL(d.qcd_keputusan, '') AS Keputusan,
      IFNULL(k.qck_user, '') AS KeputusanOleh,
      DATE_FORMAT(k.qck_tanggal, "%Y-%m-%d %H:%i") AS KeputusanTgl,
      IFNULL(k.qck_catatan, '') AS KeputusanCatatan,
      IFNULL(k.qck_atas_nama, '') AS KeputusanAtasNama,
      IFNULL(k.qck_tahap, '') AS KeputusanTahap,
      IFNULL(k.qck_klien_kontak, '') AS KlienKontak,
      IF(b.bql_lot IS NULL, 0, 1) AS SudahBpb,
      IFNULL(rt.qty, 0) AS QtyRetur
    FROM tqc_bahan_dtl d
    INNER JOIN tqc_bahan_hdr h ON h.qc_nomor = d.qcd_qc_nomor
    LEFT JOIN tpo_dtl pd
      ON pd.pod_po_nomor = h.qc_po_nomor
     AND pd.pod_nourut = h.qc_pod_nourut
    LEFT JOIN (
      SELECT x.*
      FROM tqc_bahan_keputusan x
      INNER JOIN (
        SELECT qck_lot, MAX(qck_id) AS maks
        FROM tqc_bahan_keputusan
        WHERE qck_qc_nomor = ?
        GROUP BY qck_lot
      ) m ON m.maks = x.qck_id
    ) k ON k.qck_lot = d.qcd_lot AND k.qck_qc_nomor = d.qcd_qc_nomor
    LEFT JOIN tbpb_qc_lot b
      ON b.bql_qc_nomor = d.qcd_qc_nomor AND b.bql_lot = d.qcd_lot
    LEFT JOIN (
      SELECT qrd_lot, SUM(qrd_qty) AS qty
      FROM tqc_retur_dtl
      WHERE qrd_qc_nomor = ?
      GROUP BY qrd_lot
    ) rt ON rt.qrd_lot = d.qcd_lot
    WHERE d.qcd_qc_nomor = ?
    ORDER BY d.qcd_nourut
    `,
    [nomor, nomor, nomor],
  );
  return rows;
};

// Riwayat seluruh keputusan dokumen (audit)
const getRiwayat = async (nomor) => {
  const [rows] = await db.query(
    `
    SELECT
      qck_id AS Id,
      qck_lot AS Lot,
      qck_tahap AS Tahap,
      qck_keputusan AS Keputusan,
      qck_catatan AS Catatan,
      qck_klien_kontak AS KlienKontak,
      qck_user AS Usr,
      DATE_FORMAT(qck_tanggal, "%Y-%m-%d %H:%i") AS Tanggal
    FROM tqc_bahan_keputusan
    WHERE qck_qc_nomor = ?
    ORDER BY qck_id DESC
    `,
    [nomor],
  );
  return rows;
};

// payload: { kontak, items: [{ nourut, keputusan, catatan, atas_nama }] }
// kontak    = nama kontak klien (opsional)
// catatan   = hasil konfirmasi klien per lot (wajib)
// atas_nama = nama orang internal yang menyetujui keputusan lot (wajib)
// Lot yang keputusannya tidak berubah diabaikan.
const saveKeputusan = async (nomor, payload, userKode) => {
  const kontak = String(payload?.kontak || "")
    .trim()
    .slice(0, 100);
  const items = Array.isArray(payload?.items) ? payload.items : [];

  if (items.length === 0) throw new Error("Tidak ada keputusan yang dikirim.");

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [cur] = await conn.query(
      `SELECT qc_status FROM tqc_bahan_hdr WHERE qc_nomor = ? FOR UPDATE`,
      [nomor],
    );
    if (cur.length === 0) throw new Error("Data QC Bahan tidak ditemukan.");
    if (cur[0].qc_status === "DRAFT") {
      throw new Error("Dokumen masih DRAFT. Belum disubmit oleh Gudang.");
    }

    const [lots] = await conn.query(
      `SELECT qcd_nourut, qcd_lot, qcd_keputusan
       FROM tqc_bahan_dtl WHERE qcd_qc_nomor = ? ORDER BY qcd_nourut`,
      [nomor],
    );
    const lotMap = new Map(lots.map((l) => [Number(l.qcd_nourut), l]));

    const [diterima] = await conn.query(
      `SELECT bql_lot FROM tbpb_qc_lot WHERE bql_qc_nomor = ?`,
      [nomor],
    );
    const lotDiterima = new Set(diterima.map((r) => r.bql_lot));

    const [diretur] = await conn.query(
      `SELECT DISTINCT qrd_lot FROM tqc_retur_dtl WHERE qrd_qc_nomor = ?`,
      [nomor],
    );
    const lotDiretur = new Set(diretur.map((r) => r.qrd_lot));

    // Hanya lot yang keputusannya benar-benar berubah
    const perubahan = [];
    let butuhPin = false;
    for (const it of items) {
      const lot = lotMap.get(Number(it.nourut));
      if (!lot) throw new Error(`Lot urutan ${it.nourut} tidak ditemukan.`);

      const kep = String(it.keputusan || "").toUpperCase();
      if (!KEPUTUSAN_VALID.includes(kep)) {
        throw new Error(`Keputusan lot ${lot.qcd_lot} tidak valid.`);
      }
      if ((lot.qcd_keputusan || "") === kep) continue;

      const catatan = String(it.catatan || "").trim();
      if (!catatan) {
        throw new Error(
          `Hasil konfirmasi klien lot ${lot.qcd_lot} wajib diisi.`,
        );
      }
      const atasNama = String(it.atas_nama || "")
        .trim()
        .slice(0, 100);
      if (!atasNama) {
        throw new Error(
          `Atas nama yang menyetujui lot ${lot.qcd_lot} wajib diisi.`,
        );
      }
      if (lotDiterima.has(lot.qcd_lot)) {
        throw new Error(
          `Lot ${lot.qcd_lot} sudah diterima di BPB. Hapus BPB-nya dulu sebelum mengubah keputusan.`,
        );
      }
      if (lotDiretur.has(lot.qcd_lot)) {
        throw new Error(
          `Lot ${lot.qcd_lot} sudah diretur ke supplier. Hapus dokumen retur-nya dulu sebelum mengubah keputusan.`,
        );
      }
      if (["LANJUT", "REJECT"].includes(lot.qcd_keputusan)) butuhPin = true;

      perubahan.push({ lot, kep, catatan, atasNama });
    }

    if (perubahan.length === 0) {
      throw new Error("Tidak ada perubahan keputusan.");
    }

    let pinUrut = null;
    if (butuhPin) {
      const [pin] = await conn.query(
        `SELECT pin_urut, pin_acc, pin_dipakai FROM tspk_pin5
         WHERE pin_trs = ? AND pin_nomor = ?
         ORDER BY pin_urut DESC LIMIT 1`,
        [PIN_TRS, nomor],
      );
      if (
        pin.length === 0 ||
        pin[0].pin_acc !== "Y" ||
        pin[0].pin_dipakai !== ""
      ) {
        throw new Error(
          "Ada lot yang sudah diputus. Ajukan perubahan data dan tunggu ACC terlebih dahulu.",
        );
      }
      pinUrut = pin[0].pin_urut;
    }

    for (const { lot, kep, catatan, atasNama } of perubahan) {
      await conn.query(
        `UPDATE tqc_bahan_dtl SET qcd_keputusan = ?
         WHERE qcd_qc_nomor = ? AND qcd_nourut = ?`,
        [kep, nomor, lot.qcd_nourut],
      );
      await conn.query(
        `INSERT INTO tqc_bahan_keputusan
           (qck_qc_nomor, qck_lot, qck_tahap, qck_keputusan, qck_catatan,
            qck_klien_kontak, qck_atas_nama, qck_user)
         VALUES (?, ?, 'PEMBELIAN', ?, ?, ?, ?, ?)`,
        [nomor, lot.qcd_lot, kep, catatan, kontak, atasNama, userKode],
      );
      lot.qcd_keputusan = kep;
    }

    const status = hitungStatusDok(lots.map((l) => l.qcd_keputusan));
    await conn.query(
      `UPDATE tqc_bahan_hdr
       SET qc_status = ?, user_modified = ?, date_modified = NOW()
       WHERE qc_nomor = ?`,
      [status, userKode, nomor],
    );

    if (pinUrut !== null) {
      await conn.query(
        `UPDATE tspk_pin5 SET pin_dipakai = 'Y'
         WHERE pin_trs = ? AND pin_nomor = ? AND pin_urut = ?`,
        [PIN_TRS, nomor, pinUrut],
      );
    }

    await conn.commit();
    return { qc_nomor: nomor, status, jumlah_lot: perubahan.length };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
};

// Pengajuan perubahan keputusan lot yang sudah LANJUT/REJECT
// Pengajuan perubahan keputusan lot yang sudah LANJUT/REJECT
const requestPinKeputusan = async (nomor, alasan, userKode) => {
  const [qc] = await db.query(
    `SELECT qc_tgl_datang, qc_keterangan, qc_status FROM tqc_bahan_hdr WHERE qc_nomor = ?`,
    [nomor],
  );
  if (qc.length === 0) throw new Error("Data QC Bahan tidak ditemukan.");
  if (qc[0].qc_status === "DRAFT") {
    throw new Error("Dokumen masih DRAFT. Belum disubmit oleh Gudang.");
  }

  // Pengajuan hanya bermakna kalau ada lot LANJUT/REJECT yang masih bisa
  // diubah (belum masuk BPB dan belum diretur). Lot yang belum diputuskan
  // atau TUNDA bisa diubah langsung tanpa PIN.
  const [bisaUbah] = await db.query(
    `SELECT COUNT(*) AS jml
     FROM tqc_bahan_dtl d
     WHERE d.qcd_qc_nomor = ?
       AND d.qcd_keputusan IN ('LANJUT', 'REJECT')
       AND NOT EXISTS (
         SELECT 1 FROM tbpb_qc_lot b
         WHERE b.bql_qc_nomor = d.qcd_qc_nomor AND b.bql_lot = d.qcd_lot
       )
       AND NOT EXISTS (
         SELECT 1 FROM tqc_retur_dtl r
         WHERE r.qrd_qc_nomor = d.qcd_qc_nomor AND r.qrd_lot = d.qcd_lot
       )`,
    [nomor],
  );
  if (Number(bisaUbah[0].jml) === 0) {
    throw new Error(
      "Tidak ada lot LANJUT/REJECT yang bisa diubah (belum ada keputusan, atau sudah masuk BPB/retur). Lot yang belum diputuskan atau TUNDA bisa diubah langsung lewat Keputusan Lot.",
    );
  }

  const [pin] = await db.query(
    `SELECT pin_urut, pin_acc, pin_dipakai FROM tspk_pin5
     WHERE pin_trs = ? AND pin_nomor = ? ORDER BY pin_urut DESC LIMIT 1`,
    [PIN_TRS, nomor],
  );

  // Pemetaan status sama dengan kolom Ngedit di getBrowse:
  // WAIT = acc kosong & belum dipakai, ACC = Y & belum dipakai,
  // selain itu (TOLAK / sudah dipakai) boleh mengajukan lagi.
  let pinUrut = 1;
  if (pin.length > 0) {
    const p = pin[0];
    if (p.pin_acc === "" && p.pin_dipakai === "") {
      throw new Error("Pengajuan sebelumnya masih menunggu ACC.");
    }
    if (p.pin_acc === "Y" && p.pin_dipakai === "") {
      throw new Error("Pengajuan sudah di-ACC. Silakan ubah keputusan.");
    }
    pinUrut = Number(p.pin_urut) + 1;
  }

  await db.query(
    `
    INSERT INTO tspk_pin5 (
      pin_trs, pin_jenis, pin_nomor, pin_urut, pin_tgl_trs, pin_ket, pin_tgl_minta, pin_user_minta, pin_alasan
    ) VALUES (
      ?, 'UBAH', ?, ?, ?, ?, NOW(), ?, ?
    ) ON DUPLICATE KEY UPDATE
      pin_tgl_trs=?, pin_ket=?, pin_acc="", pin_tgl_minta=NOW(), pin_user_minta=?, pin_alasan=?
    `,
    [
      PIN_TRS,
      nomor,
      pinUrut,
      qc[0].qc_tgl_datang,
      qc[0].qc_keterangan,
      userKode,
      alasan,
      qc[0].qc_tgl_datang,
      qc[0].qc_keterangan,
      userKode,
      alasan,
    ],
  );

  return true;
};

module.exports = {
  getBrowse,
  getDetailLot,
  getRiwayat,
  saveKeputusan,
  requestPinKeputusan,
};
