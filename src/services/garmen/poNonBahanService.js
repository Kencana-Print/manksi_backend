const db = require("../../config/database");
const tutupBukuService = require("../tutupBukuService");

// --- GET BROWSE MASTER DETAIL ---
const getBrowse = async (startDate, endDate, jenis, cabang, user) => {
  let whereClause = `WHERE h.po_tanggal >= ? AND h.po_tanggal <= ?`;
  const params = [startDate, endDate];

  // Filter Jenis & Bagian (Logic Delphi FormCreate)
  if (jenis) {
    whereClause += ` AND h.po_jenis = ?`;
    params.push(jenis);

    if (jenis === "SPAREPART") {
      const bagian = user.bagian ? user.bagian.toUpperCase() : "";
      if (bagian === "TEKNISI" || bagian === "IT") {
        whereClause += ` AND h.po_bagian = ?`;
        params.push(bagian);
      }
    }
  }

  // Filter Cabang
  if (cabang && cabang !== "ALL") {
    whereClause += ` AND h.po_kecab = ?`;
    params.push(cabang);
  }

  // --- MASTER QUERY ---
  let selectSup =
    Number(user.flags?.lihatSup) === 1
      ? `h.po_sup_kode AS KdSup, s.sup_nama AS Supplier,`
      : `"" AS KdSup, "" AS Supplier,`;

  const queryMaster = `
    SELECT 
      h.po_nomor AS Nomor, h.po_jenis AS Jenis, DATE_FORMAT(h.po_tanggal, '%Y-%m-%d') AS Tanggal, 
      h.po_mb_nomor AS NoMinta, 
      ${selectSup}
      h.po_ket AS Keterangan, h.po_status AS Status, h.po_cab AS Cab, h.po_kecab AS KeCab, 
      IFNULL(h.user_create, "") AS Usr, IFNULL(h.user_modified, "") AS Modified,
      IFNULL((
        SELECT IFNULL(
          IF(pin_acc="" AND pin_dipakai="", "WAIT", 
            IF(pin_acc="Y" AND pin_dipakai="", "ACC", 
              IF(pin_acc="Y" AND pin_dipakai="Y", "", 
                IF(pin_acc="N", "TOLAK", "")
              )
            )
          ), "")
        FROM tspk_pin5 WHERE pin_trs="PO GARMEN" AND pin_nomor=h.po_nomor ORDER BY pin_urut DESC LIMIT 1
      ), "") AS Ngedit
    FROM tgarmenpo_hdr h
    LEFT JOIN tsupplier s ON s.sup_kode = h.po_sup_kode
    ${whereClause}
    ORDER BY h.po_nomor DESC
  `;

  // --- DETAIL QUERY ---
  let selectSpesifikasi =
    jenis === "SPAREPART" || jenis === "ATK/RTK"
      ? `d.pod_ket AS Spesifikasi, d.pod_kegunaan AS Kegunaan,`
      : `"" AS Spesifikasi, "" AS Kegunaan,`;

  let selectBeli =
    Number(user.flags?.lihatBeli) === 1
      ? `, d.pod_harga AS Harga, (d.pod_jumlah * d.pod_harga) AS Total`
      : `, 0 AS Harga, 0 AS Total`;

  const queryDetail = `
    SELECT 
      d.pod_nomor AS Nomor, d.pod_brg_kode AS Kode, 
      IF(b.brg_note="", b.brg_nama, CONCAT(b.brg_nama, " - ", b.brg_note)) AS Nama, 
      b.brg_satuan AS Satuan,
      ${selectSpesifikasi}
      d.pod_jumlah AS Jumlah,
      IFNULL((
        SELECT IFNULL(SUM(i.bpbd_jumlah), 0)
        FROM tgarmenbpb_dtl i
        INNER JOIN tgarmenbpb_hdr j ON j.bpb_nomor = i.bpbd_nomor
        WHERE j.bpb_po_nomor = d.pod_nomor AND i.bpbd_brg_kode = d.pod_brg_kode
      ), 0) AS QtyBpb
      ${selectBeli}
    FROM tgarmenpo_dtl d
    LEFT JOIN tgarmenpo_hdr h ON h.po_nomor = d.pod_nomor
    LEFT JOIN tgarmen_brg b ON b.brg_kode = d.pod_brg_kode
    ${whereClause}
    ORDER BY d.pod_nomor, d.pod_nourut ASC
  `;

  const [master] = await db.query(queryMaster, params);
  const [detail] = await db.query(queryDetail, params);

  return { master, detail };
};

// --- DELETE DATA ---
const deleteData = async (nomor) => {
  const conn = await db.getConnection();
  try {
    const [rows] = await conn.query(
      "SELECT po_tanggal, po_status FROM tgarmenpo_hdr WHERE po_nomor = ?",
      [nomor],
    );
    if (rows.length === 0) throw new Error("Data tidak ditemukan.");

    const data = rows[0];

    // 1. Cek Tutup Buku
    const zdtClose = await tutupBukuService.getTanggalTutupBuku();
    const tglPO = new Date(data.po_tanggal);
    if (zdtClose && tglPO < zdtClose) {
      throw new Error("Transaksi tersebut sudah close. Tidak bisa dihapus.");
    }

    // 2. Cek Status (Sesuai Delphi: if Status <> '' then Tidak bisa dihapus)
    if (data.po_status && data.po_status.trim() !== "") {
      throw new Error(`Sudah ${data.po_status.trim()}. Tidak bisa dihapus.`);
    }

    await conn.beginTransaction();
    await conn.query("DELETE FROM tgarmenpo_hdr WHERE po_nomor = ?", [nomor]);
    await conn.query("DELETE FROM tgarmenpo_dtl WHERE pod_nomor = ?", [nomor]);
    await conn.commit();
    return true;
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
};

// --- REQUEST PIN 5 (Pengajuan Edit) ---
const requestPin = async (payload, userKode) => {
  const { nomor, tanggal, keterangan, alasan } = payload;
  const tglTrs = new Date(tanggal);

  // A. Validasi Kelayakan PIN (Delphi Logic: Hanya boleh ajukan jika sudah close)
  const zdtClose = await tutupBukuService.getTanggalTutupBuku();
  if (zdtClose && tglTrs >= zdtClose) {
    throw new Error(
      "Tidak perlu pengajuan perubahan data. Transaksi masih open.",
    );
  }

  // B. Hitung Counter Urut PIN (Delphi Logic: Cek pin_dipakai)
  const queryCek = `
    SELECT pin_urut, pin_dipakai FROM tspk_pin5 
    WHERE pin_trs="PO GARMEN" AND pin_nomor=? 
    ORDER BY pin_urut DESC LIMIT 1
  `;
  const [rowsCek] = await db.query(queryCek, [nomor]);

  let urut = 1;
  if (rowsCek.length > 0) {
    // Jika PIN terakhir belum dipakai, timpa urutan yang sama (Edit alasan)
    if (rowsCek[0].pin_dipakai === "") urut = rowsCek[0].pin_urut;
    // Jika sudah terpakai, naikkan urutan (+1)
    else urut = rowsCek[0].pin_urut + 1;
  }

  // C. Execute Upsert PIN
  const queryUpsert = `
    INSERT INTO tspk_pin5 (
      pin_trs, pin_nomor, pin_urut, pin_tgl_trs, pin_ket, pin_tgl_minta, pin_user_minta, pin_alasan
    ) VALUES ("PO GARMEN", ?, ?, ?, ?, NOW(), ?, ?) 
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
