const db = require("../../config/database");
const tutupBukuService = require("../tutupBukuService"); // Asumsi file ini ada di root services

const getBrowse = async (startDate, endDate, isPo, gudang) => {
  // Pastikan isPo ditangani baik sebagai boolean maupun string "true"/"false" dari query params
  const isPoBool = String(isPo).toLowerCase() === "true";
  const jenisPoStr = isPoBool ? "PO" : "NON PO";

  // Sesuai event rbNonPOClick di Delphi
  const gudangFilter = jenisPoStr === "NON PO" ? "GB001" : gudang;

  // 1. Ambil Data Master (Header) Saja
  const masterQuery = `
    SELECT 
      h.bpb_nomor AS Nomor,
      h.bpb_po_nomor AS Nomor_PO,
      DATE_FORMAT(h.bpb_tanggal, "%Y-%m-%d") AS Tanggal,
      DATE_FORMAT(h.bpb_jatuhtempo, "%Y-%m-%d") AS Jatuhtempo,
      IF(h.bpb_create_barcode = "", "BELUM", h.bpb_create_barcode) AS BuatBarcode,
      h.bpb_keterangan AS Keterangan,
      IFNULL(s.sup_nama, "") AS Supplier,
      IF(h.bpb_status_inv = 1, "True", "False") AS Voucher_bayar,
      IF(h.bpb_bayar_realisasi = 1, "Lunas", "Belum") AS Lunas,
      IF(? = 'PO', 
        IFNULL(p.po_keterangan, ""), 
        (
          SELECT CAST(GROUP_CONCAT(DISTINCT IFNULL(IFNULL(k.spk_nama, m.mspk_nama), "") SEPARATOR ", ") AS CHAR)
          FROM tbpb_dtl i
          LEFT JOIN tspk k ON k.spk_nomor = i.bpbd_spk_nomor
          LEFT JOIN tmemospk m ON m.mspk_nomor = i.bpbd_spk_nomor
          WHERE i.bpbd_bpb_nomor = h.bpb_nomor
        )
      ) AS Ket_PO,
      h.bpb_gdg_kode AS Gudang,
      h.user_create AS Usr,
      IFNULL((
        SELECT 
          IF(pin_acc="" AND pin_dipakai="", "WAIT",
          IF(pin_acc="Y" AND pin_dipakai="", "ACC",
          IF(pin_acc="Y" AND pin_dipakai="Y", "",
          IF(pin_acc="N", "TOLAK", ""))))
        FROM tspk_pin5 
        WHERE pin_trs="BPB BAHAN" AND pin_nomor = h.bpb_nomor 
        ORDER BY pin_urut DESC LIMIT 1
      ), "") AS Ngedit
    FROM tbpb_hdr h
    LEFT JOIN tsupplier s ON s.sup_kode = h.bpb_sup_kode
    LEFT JOIN tpo_hdr p ON p.po_nomor = h.bpb_po_nomor
    WHERE h.bpb_tanggal BETWEEN ? AND ?
      AND h.bpb_gdg_kode = ?
      AND (IF(? = 'PO', h.bpb_po_nomor <> "", h.bpb_po_nomor = ""))
    ORDER BY h.bpb_nomor DESC
  `;

  // Urutan Parameter Parameter (Tanda '?'):
  // 1. Ket_PO condition -> jenisPoStr
  // 2. BETWEEN start -> startDate
  // 3. BETWEEN end -> endDate
  // 4. bpb_gdg_kode = -> gudangFilter
  // 5. Kondisi PO/NON PO di WHERE -> jenisPoStr
  const queryParams = [
    jenisPoStr,
    startDate,
    endDate,
    gudangFilter,
    jenisPoStr,
  ];

  const [master] = await db.query(masterQuery, queryParams);

  // Return data master langsung tanpa memproses detail
  return master;
};

const getBrowseDetail = async (nomor) => {
  const detailQuery = `
    SELECT 
      bpbd_bpb_nomor AS Nomor,
      bpbd_bhn_kode AS Kode,
      b.bhn_name AS Nama,
      bpbd_bhn_satuan AS Satuan,
      bpbd_jumlah AS Jumlah,
      bpbd_roll AS Roll,
      bpbd_gramasi AS Gramasi,
      bpbd_warna AS Warna,
      bpbd_setting AS Setting
    FROM tbpb_dtl d
    LEFT JOIN tbahan b ON b.bhn_kode = d.bpbd_bhn_kode
    WHERE bpbd_bpb_nomor = ?
    ORDER BY bpbd_nourut
  `;

  const [detail] = await db.query(detailQuery, [nomor]);
  return detail;
};

const deleteBpb = async (nomor) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // 1. Cek Header Info
    const [bpb] = await conn.query(
      `SELECT * FROM tbpb_hdr WHERE bpb_nomor = ?`,
      [nomor],
    );
    if (bpb.length === 0) throw new Error("Data BPB tidak ditemukan.");

    const hdr = bpb[0];

    // 2. Validasi Gudang Celup
    if (hdr.bpb_gdg_kode === "GC001") {
      throw new Error("Transaksi tsb punya gudang celup. Tidak bisa dihapus.");
    }

    // 3. Validasi Tutup Buku
    const zdtClose = await tutupBukuService.getTanggalTutupBuku();
    if (zdtClose && new Date(hdr.bpb_tanggal) < zdtClose) {
      throw new Error("Transaksi tsb sudah close. Tidak bisa dihapus.");
    }

    // 4. Eksekusi Hapus Sesuai Delphi
    await conn.query(`DELETE FROM tbpb_hdr WHERE bpb_nomor = ?`, [nomor]);
    await conn.query(`DELETE FROM tbahan_barcode_hdr WHERE bar_bpb = ?`, [
      nomor,
    ]);
    // Tambahan safety untuk menghapus detailnya agar tidak jadi orphan data
    await conn.query(`DELETE FROM tbpb_dtl WHERE bpbd_bpb_nomor = ?`, [nomor]);

    // 5. Update Status PO Induk Jika Ada
    if (hdr.bpb_po_nomor && hdr.bpb_po_nomor.trim() !== "") {
      const [recalc] = await conn.query(
        `
        SELECT SUM(x.po) as po, SUM(IF(x.bpb > x.po, x.po, x.bpb)) as bpb
        FROM (
          SELECT d.pod_jumlah as po,
          IFNULL((
            SELECT IFNULL(SUM(b.bpbd_jumlah),0)
            FROM tbpb_dtl b
            INNER JOIN tbpb_hdr a ON a.bpb_nomor = b.bpbd_bpb_nomor
            WHERE a.bpb_po_nomor = d.pod_po_nomor AND b.bpbd_bhn_kode = d.pod_bhn_kode
          ), 0) as bpb
          FROM tpo_dtl d
          WHERE d.pod_po_nomor = ?
        ) x
      `,
        [hdr.bpb_po_nomor],
      );

      const tpo = Number(recalc[0]?.po) || 0;
      const tbpb = Number(recalc[0]?.bpb) || 0;

      let poCloseStatus = 2; // ONPROSES
      if (tbpb >= tpo)
        poCloseStatus = 1; // CLOSE
      else if (tbpb === 0) poCloseStatus = 0; // OPEN

      await conn.query(`UPDATE tpo_hdr SET po_close = ? WHERE po_nomor = ?`, [
        poCloseStatus,
        hdr.bpb_po_nomor,
      ]);
    }

    await conn.commit();
    return true;
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
};

const requestPinPerubahan = async (nomor, alasan, userKode) => {
  // 1. Dapatkan info BPB
  const [bpb] = await db.query(
    `SELECT bpb_tanggal, bpb_keterangan FROM tbpb_hdr WHERE bpb_nomor = ?`,
    [nomor],
  );
  if (bpb.length === 0) throw new Error("Data BPB tidak ditemukan.");

  const hdr = bpb[0];

  // 2. Cari urutan PIN terakhir
  const [pin] = await db.query(
    `SELECT pin_urut, pin_dipakai, pin_alasan FROM tspk_pin5 WHERE pin_trs="BPB BAHAN" AND pin_nomor=? ORDER BY pin_urut DESC LIMIT 1`,
    [nomor],
  );

  let pinUrut = 1;
  if (pin.length > 0) {
    if (pin[0].pin_dipakai === "") {
      throw new Error("Pengajuan sebelumnya belum di-ACC atau dipakai.");
    } else {
      pinUrut = Number(pin[0].pin_urut) + 1;
    }
  }

  // 3. Insert On Duplicate Key Update Sesuai Delphi
  const upsertQuery = `
    INSERT INTO tspk_pin5 (
      pin_trs, pin_nomor, pin_urut, pin_tgl_trs, pin_ket, pin_tgl_minta, pin_user_minta, pin_alasan
    ) VALUES (
      "BPB BAHAN", ?, ?, ?, ?, NOW(), ?, ?
    ) ON DUPLICATE KEY UPDATE 
      pin_tgl_trs=?, pin_ket=?, pin_acc="", pin_tgl_minta=NOW(), pin_user_minta=?, pin_alasan=?
  `;

  await db.query(upsertQuery, [
    nomor,
    pinUrut,
    hdr.bpb_tanggal,
    hdr.bpb_keterangan,
    userKode,
    alasan,
    hdr.bpb_tanggal,
    hdr.bpb_keterangan,
    userKode,
    alasan,
  ]);

  return true;
};

module.exports = {
  getBrowse,
  getBrowseDetail,
  deleteBpb,
  requestPinPerubahan,
};
