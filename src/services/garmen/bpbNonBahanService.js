const db = require("../../config/database");
const tutupBukuService = require("../tutupBukuService");
const {
  BAGIAN_PO_ASET_LIHAT,
  refreshStatusBpb,
} = require("./poNonBahanFormService");

// --- GET BROWSE MASTER DETAIL ---
const getBrowse = async (startDate, endDate, jenis, cabang, user) => {
  let whereClause = `WHERE h.bpb_tanggal >= ? AND h.bpb_tanggal <= ?`;
  const params = [startDate, endDate];

  const bagianUser = user.bagian ? user.bagian.toUpperCase() : "";
  const bolehAset = BAGIAN_PO_ASET_LIHAT.includes(bagianUser);

  // Filter Jenis & Bagian
  if (jenis) {
    if (jenis === "ASET" && !bolehAset) {
      throw new Error("Bagian Anda tidak berhak melihat BPB Aset.");
    }
    whereClause += ` AND h.bpb_jenis = ?`;
    params.push(jenis);

    if (jenis === "SPAREPART") {
      if (bagianUser === "TEKNISI" || bagianUser === "IT") {
        whereClause += ` AND h.bpb_bagian = ?`;
        params.push(bagianUser);
      }
    }
  } else if (!bolehAset) {
    whereClause += ` AND h.bpb_jenis <> 'ASET'`;
  }

  // Filter Cabang
  if (cabang && cabang !== "ALL") {
    whereClause += ` AND h.bpb_cab = ?`;
    params.push(cabang);
  }

  // --- MASTER QUERY ---
  const canLihatSup = Number(user.flags?.lihatSup) === 1;
  let selectSup = canLihatSup
    ? `h.bpb_sup_kode AS KdSup, s.sup_nama AS Supplier,`
    : `"" AS KdSup, "" AS Supplier,`;

  const queryMaster = `
    SELECT 
      h.bpb_nomor AS Nomor, h.bpb_jenis AS Jenis, DATE_FORMAT(h.bpb_tanggal, '%Y-%m-%d') AS Tanggal, 
      IF(IFNULL(h.bpb_po_nomor,'') <> '',
         IFNULL((SELECT GROUP_CONCAT(DISTINCT x.pod_mb_nomor ORDER BY x.pod_mb_nomor SEPARATOR ', ')
                 FROM tgarmenpo_dtl x
                 WHERE x.pod_nomor = h.bpb_po_nomor AND x.pod_mb_nomor <> ''), h.bpb_mb_nomor),
         h.bpb_mb_nomor) AS NoMinta,
      h.bpb_po_nomor AS NoPO,
      IFNULL(i.iv_nomor, "") AS VoucherPembelian,
      ${selectSup}
      h.bpb_ket AS Keterangan, 
      IFNULL(h.user_create, "") AS Usr, 
      IFNULL(DATE_FORMAT(h.date_create, '%d-%m-%Y %H:%i:%s'), "") AS Created,
      IFNULL((
        SELECT IFNULL(
          IF(pin_acc="" AND pin_dipakai="", "WAIT", 
            IF(pin_acc="Y" AND pin_dipakai="", "ACC", 
              IF(pin_acc="Y" AND pin_dipakai="Y", "", 
                IF(pin_acc="N", "TOLAK", "")
              )
            )
          ), "")
        FROM tspk_pin5 WHERE pin_trs="BPB GARMEN" AND pin_nomor=h.bpb_nomor ORDER BY pin_urut DESC LIMIT 1
      ), "") AS Ngedit
    FROM tgarmenbpb_hdr h
    LEFT JOIN tsupplier s ON s.sup_kode = h.bpb_sup_kode
    LEFT JOIN tgarmeniv_hdr i ON i.iv_bpb_nomor = h.bpb_nomor
    ${whereClause}
    ORDER BY h.bpb_nomor DESC
  `;

  // --- DETAIL QUERY ---
  let selectSpesifikasi =
    jenis === "SPAREPART" || jenis === "ATK/RTK" || jenis === "ASET"
      ? `d.bpbd_ket AS Spesifikasi, d.bpbd_kegunaan AS Kegunaan,`
      : `"" AS Spesifikasi, "" AS Kegunaan,`;

  let selectSpk =
    jenis === "ACCESORIES"
      ? `, d.bpbd_spk_nomor AS Spk, IFNULL(spk.spk_nama, m.mspk_nama) AS NamaSpk`
      : `, "" AS Spk, "" AS NamaSpk`;

  const queryDetail = `
    SELECT 
      d.bpbd_nomor AS Nomor, d.bpbd_brg_kode AS Kode, 
      IF(b.brg_note="", b.brg_nama, CONCAT(b.brg_nama, " - ", b.brg_note)) AS Nama, 
      b.brg_satuan AS Satuan,
      ${selectSpesifikasi}
      d.bpbd_jumlah AS Jumlah
      ${selectSpk}
    FROM tgarmenbpb_dtl d
    LEFT JOIN tgarmenbpb_hdr h ON h.bpb_nomor = d.bpbd_nomor
    LEFT JOIN tgarmen_brg b ON b.brg_kode = d.bpbd_brg_kode
    LEFT JOIN tspk spk ON spk.spk_nomor = d.bpbd_spk_nomor
    LEFT JOIN tmemospk m ON m.mspk_nomor = d.bpbd_spk_nomor
    ${whereClause}
    ORDER BY d.bpbd_nomor, d.bpbd_nourut ASC
  `;

  const [master] = await db.query(queryMaster, params);
  const [detail] = await db.query(queryDetail, params);

  return { master, detail };
};

// --- DELETE DATA & TRIGGER UPDATE STATUS PERMINTAAN/PO ---
const deleteData = async (nomor) => {
  const conn = await db.getConnection();
  try {
    // JOIN ke iv_hdr dihapus
    const [rows] = await conn.query(
      `SELECT h.bpb_tanggal, h.bpb_mb_nomor, h.bpb_po_nomor
       FROM tgarmenbpb_hdr h
       WHERE h.bpb_nomor = ?`,
      [nomor],
    );
    if (rows.length === 0) throw new Error("Data tidak ditemukan.");

    const data = rows[0];

    // 1. Cek Tutup Buku
    const zdtClose = await tutupBukuService.getTanggalTutupBuku();
    const tglBPB = new Date(data.bpb_tanggal);
    if (zdtClose && tglBPB < zdtClose) {
      throw new Error("Transaksi tsb sudah close. Tidak bisa dihapus.");
    }

    // 2. Cek Voucher Pembelian (kunci hapus jika sudah dibuat voucher)
    const [cekIv] = await conn.query(
      `SELECT iv_nomor FROM tgarmeniv_hdr WHERE iv_bpb_nomor = ? LIMIT 1`,
      [nomor],
    );
    if (cekIv.length > 0) {
      throw new Error(
        "Sudah di dibuatkan Voucher Pembelian. Tidak bisa dihapus.",
      );
    }

    await conn.beginTransaction();

    // 3. Hapus Transaksi Utama
    await conn.query("DELETE FROM tgarmenbpb_hdr WHERE bpb_nomor = ?", [nomor]);
    await conn.query("DELETE FROM tgarmenbpb_dtl WHERE bpbd_nomor = ?", [
      nomor,
    ]);

    // 4. Update status PO & semua Permintaan di PO tsb
    await refreshStatusBpb(conn, {
      poNomor: data.bpb_po_nomor || "",
      mbNomor: data.bpb_mb_nomor || "",
      bolehKosong: true,
    });

    await conn.commit();
    return true;
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
};

// --- REQUEST PIN 5 (Pengajuan Edit BPB) ---
const requestPin = async (payload, userKode) => {
  const { nomor, tanggal, keterangan, alasan } = payload;
  const tglTrs = new Date(tanggal);

  // A. Validasi Kelayakan PIN
  const zdtClose = await tutupBukuService.getTanggalTutupBuku();
  if (zdtClose && tglTrs >= zdtClose) {
    throw new Error(
      "Tidak perlu pengajuan perubahan data. Transaksi masih open.",
    );
  }

  // B. Hitung Counter Urut PIN
  const queryCek = `
    SELECT pin_urut, pin_dipakai FROM tspk_pin5 
    WHERE pin_trs="BPB GARMEN" AND pin_nomor=? 
    ORDER BY pin_urut DESC LIMIT 1
  `;
  const [rowsCek] = await db.query(queryCek, [nomor]);

  let urut = 1;
  if (rowsCek.length > 0) {
    if (rowsCek[0].pin_dipakai === "") urut = rowsCek[0].pin_urut;
    else urut = rowsCek[0].pin_urut + 1;
  }

  // C. Execute Upsert PIN
  const queryUpsert = `
    INSERT INTO tspk_pin5 (
      pin_trs, pin_nomor, pin_urut, pin_tgl_trs, pin_ket, pin_tgl_minta, pin_user_minta, pin_alasan
    ) VALUES ("BPB GARMEN", ?, ?, ?, ?, NOW(), ?, ?) 
    ON DUPLICATE KEY UPDATE 
      pin_acc = "", pin_tgl_minta = NOW(), pin_user_minta = VALUES(pin_user_minta), pin_alasan = VALUES(pin_alasan)
  `;

  const tglFormatted = tglTrs.toISOString().slice(0, 10);
  await db.query(queryUpsert, [
    nomor,
    urut,
    tglFormatted,
    keterangan || "",
    userKode,
    alasan,
  ]);
  return true;
};

module.exports = {
  getBrowse,
  deleteData,
  requestPin,
};
