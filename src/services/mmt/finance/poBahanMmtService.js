// backend/src/services/poMmt.service.js

const pool = require("../../../config/database");
const { format, parseISO } = require("date-fns");

// --- Helper: Penanganan Error Database ---
const throwDbError = (message, error) => {
  console.error(`${message}:`, error);
  throw new Error(`${message}: ${error.message || error}`);
};

const toRoman = (num) => {
  if (typeof num !== "number") return "";
  const lookup = { 10: "X", 9: "IX", 5: "V", 4: "IV", 1: "I" };
  let roman = "";
  if (num === 11) return "XI";
  if (num === 12) return "XII";
  for (let i in lookup) {
    while (num >= parseInt(i)) {
      roman += lookup[i];
      num -= parseInt(i);
    }
  }
  return roman;
};

const getNextPoNumber = async (date, prefix = "KP", connection) => {
  const d = new Date(date);
  const year = d.getFullYear();
  const romanMonths = [
    "",
    "I",
    "II",
    "III",
    "IV",
    "V",
    "VI",
    "VII",
    "VIII",
    "IX",
    "X",
    "XI",
    "XII",
  ];
  const romanMonth = romanMonths[d.getMonth() + 1];
  const suffix = `.${prefix}.${romanMonth}.${year}`;
  const db = connection || pool;

  const [rows] = await db.query(
    `SELECT MAX(CAST(SUBSTRING_INDEX(po_nomor, '.', 1) AS UNSIGNED)) AS max_num
     FROM tpo_mmt_hdr
     WHERE po_nomor LIKE ? FOR UPDATE`,
    [`%${suffix}`],
  );

  const lastNum = rows[0]?.max_num || 0;
  const nextNum = lastNum + 1;
  const padded = String(nextNum).padStart(5, "0");
  return `${padded}${suffix}`;
};

// Status PO dihitung dari realisasi penerimaan, bukan hanya kolom pod_qty_terima.
// Kolom pod_qty_terima bisa tidak sinkron (mis. PO diubah setelah barang diterima,
// atau penerimaan lama dibuat sebelum trigger penambahan berjalan), sehingga qty
// diterima juga diambil dari trec_mmt_dtl yang mereferensikan PO lewat rec_memo.
//
// Penilaian dilakukan per satuan (bukan per kode barang semata) agar:
// - barang pengganti/substitusi dengan kode berbeda tetapi satuan sama tetap
//   dihitung sebagai realisasi PO;
// - qty diterima berlebih pada satu item tidak menutupi kekurangan item lain
//   dalam satuan yang sama (masing-masing item dibatasi qty PO-nya).
// Penerimaan keluar/retur (rec_type <> 0) tidak dihitung sebagai penerimaan PO.
const PO_RECEIPT_STATUS_JOINS_SQL = `
  LEFT JOIN (
    SELECT
      v.pod_po_nomor,
      SUM(CASE WHEN v.qty_po > v.qty_received + 0.01 THEN 1 ELSE 0 END) AS unit_kurang,
      SUM(CASE WHEN v.qty_received > 0 THEN 1 ELSE 0 END) AS unit_terima_ada,
      SUM(v.qty_po) AS qty_po_total,
      SUM(v.qty_received) AS qty_received_total
    FROM (
      SELECT
        u.pod_po_nomor,
        u.satuan,
        SUM(u.qty_po) AS qty_po,
        SUM(u.qty_received) AS qty_received
      FROM (
      -- Item PO yang kode barangnya juga ada di penerimaan
      SELECT
        pi.pod_po_nomor,
        pi.satuan,
        SUM(IFNULL(pi.qty_po, 0)) AS qty_po,
        SUM(
          LEAST(
            IFNULL(pi.qty_po, 0),
            GREATEST(IFNULL(pi.qty_terima_po, 0), IFNULL(rr.qty_terima, 0))
          )
        ) AS qty_received
      FROM (
        SELECT
          UPPER(TRIM(pod_po_nomor)) AS pod_po_nomor,
          TRIM(pod_brg_kode) AS brg_kode,
          UPPER(TRIM(IFNULL(pod_brg_satuan, ''))) AS satuan,
          SUM(IFNULL(pod_qty, 0)) AS qty_po,
          SUM(IFNULL(pod_qty_terima, 0)) AS qty_terima_po
        FROM tpo_mmt_dtl
        GROUP BY UPPER(TRIM(pod_po_nomor)), TRIM(pod_brg_kode), UPPER(TRIM(IFNULL(pod_brg_satuan, '')))
      ) pi
      LEFT JOIN (
        SELECT
          r.pod_po_nomor,
          r.brg_kode,
          SUM(r.qty_terima) AS qty_terima
        FROM (
          SELECT
            x.pod_po_nomor,
            x.brg_kode,
            x.satuan,
            SUM(x.qty_terima) AS qty_terima
          FROM (
            SELECT
              UPPER(TRIM(rh.rec_memo)) AS pod_po_nomor,
              TRIM(rd.recd_brg_kode) AS brg_kode,
              UPPER(TRIM(IFNULL(rd.recd_brg_satuan, ''))) AS satuan,
              IFNULL(rd.recd_qty_terima, 0) AS qty_terima
            FROM trec_mmt_hdr rh
            INNER JOIN trec_mmt_dtl rd
              ON rd.recd_rec_nomor = rh.rec_nomor
            WHERE IFNULL(rh.rec_type, 0) = 0
              AND rh.rec_memo IS NOT NULL
              AND TRIM(rh.rec_memo) <> ''
          ) x
          GROUP BY x.pod_po_nomor, x.brg_kode, x.satuan
        ) r
        GROUP BY r.pod_po_nomor, r.brg_kode
      ) rr
        ON rr.pod_po_nomor = pi.pod_po_nomor
       AND rr.brg_kode = pi.brg_kode
      GROUP BY pi.pod_po_nomor, pi.satuan

      UNION ALL

      -- Item penerimaan yang kode barangnya tidak ada di PO (substitusi)
      SELECT
        rr.pod_po_nomor,
        rr.satuan,
        0 AS qty_po,
        SUM(rr.qty_terima) AS qty_received
      FROM (
        SELECT
          x.pod_po_nomor,
          x.brg_kode,
          x.satuan,
          SUM(x.qty_terima) AS qty_terima
        FROM (
          SELECT
            UPPER(TRIM(rh.rec_memo)) AS pod_po_nomor,
            TRIM(rd.recd_brg_kode) AS brg_kode,
            UPPER(TRIM(IFNULL(rd.recd_brg_satuan, ''))) AS satuan,
            IFNULL(rd.recd_qty_terima, 0) AS qty_terima
          FROM trec_mmt_hdr rh
          INNER JOIN trec_mmt_dtl rd
            ON rd.recd_rec_nomor = rh.rec_nomor
          WHERE IFNULL(rh.rec_type, 0) = 0
            AND rh.rec_memo IS NOT NULL
            AND TRIM(rh.rec_memo) <> ''
        ) x
        GROUP BY x.pod_po_nomor, x.brg_kode, x.satuan
      ) rr
      LEFT JOIN (
        SELECT
          UPPER(TRIM(pod_po_nomor)) AS pod_po_nomor,
          TRIM(pod_brg_kode) AS brg_kode,
          UPPER(TRIM(IFNULL(pod_brg_satuan, ''))) AS satuan
        FROM tpo_mmt_dtl
        GROUP BY UPPER(TRIM(pod_po_nomor)), TRIM(pod_brg_kode), UPPER(TRIM(IFNULL(pod_brg_satuan, '')))
      ) pi
        ON pi.pod_po_nomor = rr.pod_po_nomor
       AND pi.brg_kode = rr.brg_kode
      WHERE pi.brg_kode IS NULL
      GROUP BY rr.pod_po_nomor, rr.satuan
      ) u
      GROUP BY u.pod_po_nomor, u.satuan
    ) v
    GROUP BY v.pod_po_nomor
  ) st ON st.pod_po_nomor = UPPER(TRIM(h.po_nomor))
`;

const PO_STATUS_CASE_SQL = `
  CASE
    -- 1. Ditutup manual oleh user
    WHEN h.po_isclosed = 1 THEN 'CLOSE'

    -- 2. Semua satuan sudah terpenuhi (termasuk substitusi barang)
    WHEN IFNULL(st.qty_po_total, 0) > 0
         AND IFNULL(st.unit_kurang, 0) = 0 THEN 'CLOSE'

    -- 3. Sudah ada penerimaan, tetapi belum penuh
    WHEN IFNULL(st.unit_terima_ada, 0) > 0 THEN 'ONPROSES'

    -- 4. Belum ada penerimaan sama sekali
    ELSE 'OPEN'
  END
`;

const formatDateForPrint = (dateValue) => {
  if (!dateValue) return "N/A";
  if (dateValue instanceof Date) return format(dateValue, "dd/MM/yyyy");
  try {
    return format(parseISO(String(dateValue)), "dd/MM/yyyy");
  } catch (e) {
    return String(dateValue);
  }
};

const getPoMmtData = async (startDate, endDate, supplier) => {
  // Guard: tanggal kosong/invalid TIDAK boleh jadi klausa zero-date —
  // filter tanggal di-skip (tanpa filter) bila tidak valid.
  const isDateStr = (v) =>
    typeof v === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(v) &&
    !Number.isNaN(Date.parse(v));
  const dateConds = [];
  const params = [];
  if (isDateStr(startDate)) {
    dateConds.push("h.po_tanggal >= ?");
    params.push(startDate);
  }
  if (isDateStr(endDate)) {
    dateConds.push("h.po_tanggal <= ?");
    params.push(endDate);
  }

  const sql = `
    SELECT
      h.po_nomor AS Nomor, 
      h.po_tanggal AS Tanggal, 
      h.po_dateline AS Dateline,
      h.po_sup_kode AS KodeSup, 
      s.sup_nama AS Nama, 
      h.po_gdg_kode AS Cab,
      h.po_acc AS Acc,

      ${PO_STATUS_CASE_SQL} AS Status,
      h.po_isclosed AS IsClosedManual,
      IFNULL(st.unit_kurang, 0) AS UnitKurang,
      IFNULL(st.qty_po_total, 0) AS QtyPoTotal,
      IFNULL(st.qty_received_total, 0) AS QtyReceivedTotal,
      CASE WHEN IFNULL(st.qty_po_total, 0) > 0 AND IFNULL(st.unit_kurang, 0) = 0 THEN 1 ELSE 0 END AS IsAutoClosed,
      h.po_istax AS IsTax, 
      h.po_memo AS Keterangan
    FROM tpo_mmt_hdr h
    LEFT JOIN tsupplier s ON h.po_sup_kode = s.sup_kode
    ${PO_RECEIPT_STATUS_JOINS_SQL}
    WHERE ${dateConds.length ? dateConds.join(" AND ") : "1=1"}
    ${supplier ? `AND (h.po_sup_kode LIKE ? OR s.sup_nama LIKE ?)` : ""}
    ORDER BY h.po_tanggal DESC, h.po_nomor DESC
  `;

  if (supplier) params.push(`%${supplier}%`, `%${supplier}%`);

  try {
    const [rows] = await pool.query(sql, params);
    return rows;
  } catch (error) {
    // Pastikan fungsi throwDbError sudah didefinisikan di file Anda
    console.error("Database Error:", error);
    throw new Error("Gagal mengambil data laporan PO");
  }
};

const getPoDetailByNomor = async (nomor) => {
  const sql = `
    SELECT 
      d.pod_nourut AS no, d.pod_brg_kode AS kode, 
      COALESCE(b.brg_nama, t.brg_nama) AS nama,
      d.pod_keterangan AS namaext, d.pod_brg_satuan AS Satuan, d.pod_qty AS QTY,
      d.pod_qty_terima AS QtyBPB, d.pod_harga AS harga, d.pod_discpr AS diskon, d.pod_spk_nomor AS spk,
      d.pod_m2 AS m2,
      d.pod_qty * COALESCE(NULLIF(d.pod_m2, 0), 1) * d.pod_harga * (1 - d.pod_discpr / 100) AS total
    FROM tpo_mmt_dtl d
    LEFT JOIN tbarang_mmt b ON d.pod_brg_kode = b.brg_kode
    LEFT JOIN tgarmen_brg t ON d.pod_brg_kode = t.brg_kode
    WHERE d.pod_po_nomor = ? 
    ORDER BY d.pod_nourut
  `;
  const [rows] = await pool.query(sql, [nomor]);
  return rows;
};

const getPOById = async (nomor) => {
  const [headerRows] = await pool.query(
    `SELECT 
      h.po_nomor AS Nomor, h.po_tanggal AS Tanggal, h.po_sup_kode AS KodeSup,
      s.sup_nama AS SupNama, s.sup_alamat AS SupAlamat, s.sup_kota AS SupKota,
      h.po_memo AS Keterangan, h.po_istax AS IsPpn,
      h.po_taxamount AS PpnRate, h.po_isclosed AS IsClosed, h.po_type AS JenisPo,
      h.po_dateline AS Dateline,
      h.po_kirim AS AlamatPabrik,  h.po_acc AS PoAcc,
      h.po_pemesan AS Pemesan, h.user_create AS UserCreate   
    FROM tpo_mmt_hdr h
    LEFT JOIN tsupplier s ON h.po_sup_kode = s.sup_kode
    WHERE h.po_nomor = ?`,
    [nomor],
  );

  if (headerRows.length === 0) return null;
  const header = headerRows[0];

  const [detailRows] = await pool.query(
    `SELECT d.pod_nourut AS no, d.pod_brg_kode AS kode, 
      COALESCE(b.brg_nama, t.brg_nama) AS nama,
      d.pod_keterangan AS namaext, d.pod_brg_satuan AS satuan, d.pod_qty AS jumlah, d.pod_m2 AS m2,
      d.pod_harga AS harga, d.pod_discpr AS diskon, d.pod_spk_nomor AS spk,
      d.pod_mb_nomor AS mb_nomor, 
      COALESCE(b.brg_panjang, 0) AS panjang, 
      COALESCE(b.brg_lebar, 0) AS lebar,
      d.pod_qty * d.pod_m2 * d.pod_harga * (1 - d.pod_discpr / 100) AS total
    FROM tpo_mmt_dtl d
    LEFT JOIN tbarang_mmt b ON d.pod_brg_kode = b.brg_kode
    LEFT JOIN tgarmen_brg t ON d.pod_brg_kode = t.brg_kode
    WHERE d.pod_po_nomor = ? ORDER BY d.pod_nourut`,
    [nomor],
  );

  const nomorPermintaan = detailRows.find((d) => d.mb_nomor)?.mb_nomor || "";

  return {
    ...header,
    NomorPermintaan: nomorPermintaan,
    Detail: detailRows,
    Commitments: [],
    rolls: [],
    Status: header.IsClosed === 1 ? "CLOSE" : "OPEN",
    PinStatus: "",
  };
};

const savePoMmt = async (data, nomorToEdit, currentUser) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    let poNomor;

    // VALIDASI AGAR STRING "AUTO" ATAU PENGIRIMAN KOSONG TIDAK DIANGGAP SEBAGAI UPDATE
    const isUpdating =
      !!nomorToEdit && nomorToEdit !== "AUTO" && nomorToEdit !== "";
    const {
      tanggal,
      supKode,
      keterangan,
      isPpn,
      ppnRate,
      detail,
      dateline,
      jenisPo,
      AlamatPabrik,
    } = data;

    const totalAmount = detail
      .filter((d) => d.kode)
      .reduce((sum, d) => sum + (Number(d.total) || 0), 0);
    const isTaxInt = isPpn ? 1 : 0;

    if (isUpdating) {
      poNomor = nomorToEdit;
      await connection.query(
        `UPDATE tpo_mmt_hdr SET 
          po_tanggal = ?, 
          po_sup_kode = ?, 
          po_memo = ?, 
          po_istax = ?, 
          po_taxamount = ?, 
          po_amount = ?, 
          date_modified = NOW(), 
          user_modified = ?, 
          po_dateline = ?, 
          po_type = ?, 
          po_kirim = ?
         WHERE po_nomor = ?`,
        [
          tanggal,
          supKode,
          keterangan,
          isTaxInt,
          ppnRate,
          totalAmount,
          currentUser,
          dateline,
          jenisPo,
          AlamatPabrik, // 👈 Posisinya harus di sini sebelum poNomor
          poNomor, // 👈 Nilai untuk WHERE po_nomor = ?
        ],
      );
      await connection.query("DELETE FROM tpo_mmt_dtl WHERE pod_po_nomor = ?", [
        poNomor,
      ]);
    } else {
      poNomor = await getNextPoNumber(new Date(tanggal), "KP", connection);
      await connection.query(
        `INSERT INTO tpo_mmt_hdr (po_nomor, po_tanggal, po_sup_kode, po_memo, po_istax, po_taxamount, po_amount,
         po_gdg_kode, date_create, user_create, po_dateline, po_type, po_kirim) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?, ?, ?)`,
        [
          poNomor,
          tanggal,
          supKode,
          keterangan,
          isTaxInt,
          ppnRate,
          totalAmount,
          "WH-16",
          currentUser,
          dateline,
          jenisPo,
          AlamatPabrik,
        ],
      );
    }

    const validItems = detail.filter((d) => d.kode);
    for (const [index, item] of validItems.entries()) {
      await connection.query(
        `INSERT INTO tpo_mmt_dtl (
          pod_po_nomor, pod_nourut, pod_mb_nomor, pod_brg_kode, pod_brg_satuan,
          pod_qty, pod_m2, pod_harga, pod_discpr, pod_keterangan, pod_spk_nomor
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          poNomor,
          index + 1,
          item.mb_nomor || null,
          item.kode,
          item.satuan,
          parseFloat(item.jumlah) || 0,
          parseFloat(item.m2) || 0,
          parseFloat(item.harga) || 0,
          Number(item.diskon) || 0,
          String(item.namaext || item.nama || ""),
          item.spk || null,
        ],
      );
    }

    // Update Permintaan Bahan status
    const uniqueMbNomors = [
      ...new Set(validItems.map((d) => d.mb_nomor).filter(Boolean)),
    ];
    for (const mbNomor of uniqueMbNomors) {
      const [statusRows] = await connection.query(
        `SELECT req.mbd_brg_kode AS Kode, req.mbd_qty AS Required_Qty, COALESCE(SUM(pod.pod_qty), 0) AS Committed_PO_Qty
         FROM tmintabahan_mmt_dtl req
         LEFT JOIN tpo_mmt_dtl pod ON pod.pod_mb_nomor = req.mbd_mb_nomor AND pod.pod_brg_kode = req.mbd_brg_kode
         WHERE req.mbd_mb_nomor = ? GROUP BY req.mbd_brg_kode`,
        [mbNomor],
      );
      let isAllFullyPoed = true;
      for (const sItem of statusRows) {
        await connection.query(
          `UPDATE tmintabahan_mmt_dtl SET mbd_qty_po = ? WHERE mbd_mb_nomor = ? AND mbd_brg_kode = ?`,
          [Number(sItem.Committed_PO_Qty), mbNomor, sItem.Kode],
        );
        if (Number(sItem.Committed_PO_Qty) < Number(sItem.Required_Qty))
          isAllFullyPoed = false;
      }
      await connection.query(
        `UPDATE tmintabahan_mmt_hdr SET mb_close_po = ? WHERE mb_nomor = ?`,
        [isAllFullyPoed ? 1 : 0, mbNomor],
      );
    }

    await connection.commit();
    return { Nomor: poNomor };
  } catch (error) {
    await connection.rollback();
    throw error; // Biarkan error asli naik ke controller agar terbaca jelas
  } finally {
    connection.release();
  }
};

const deletePoMmt = async (nomor) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query(
      "SELECT po_isclosed FROM tpo_mmt_hdr WHERE po_nomor = ?",
      [nomor],
    );
    if (rows.length === 0) return false;
    if (rows[0].po_isclosed === 1)
      throw new Error("PO sudah di-CLOSE dan tidak dapat dihapus.");
    await connection.query("DELETE FROM tpo_mmt_dtl WHERE pod_po_nomor = ?", [
      nomor,
    ]);
    const [result] = await connection.query(
      "DELETE FROM tpo_mmt_hdr WHERE po_nomor = ?",
      [nomor],
    );
    await connection.commit();
    return result.affectedRows > 0;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

const toggleCloseStatus = async (nomor, action, user) => {
  // 1. Cek dulu status receipt dan kondisi auto-close
  const checkSql = `
    SELECT 
      h.po_nomor,
      h.po_isclosed,
      IFNULL(st.qty_po_total, 0) AS qty_po_total,
      IFNULL(st.unit_kurang, 0) AS unit_kurang,
      IFNULL(st.qty_received_total, 0) AS qty_received_total
    FROM tpo_mmt_hdr h
    ${PO_RECEIPT_STATUS_JOINS_SQL}
    WHERE h.po_nomor = ?
  `;
  const [checkRows] = await pool.query(checkSql, [nomor]);
  if (checkRows.length === 0) throw new Error("Nomor PO tidak ditemukan.");

  const poInfo = checkRows[0];
  const isFullyReceived = poInfo.qty_po_total > 0 && Number(poInfo.unit_kurang) === 0;

  // 2. Lakukan update status penutupan di database
  const [result] = await pool.query(
    `UPDATE tpo_mmt_hdr SET po_isclosed = ?, user_modified = ? WHERE po_nomor = ?`,
    [action === "CLOSE" ? 1 : 0, user || "SYSTEM", nomor],
  );
  if (result.affectedRows === 0) throw new Error("Gagal mengupdate status PO.");

  // 3. Susun respons informatif
  const isAutoClosed = isFullyReceived;
  let warning = null;
  let message = `PO nomor ${nomor} berhasil di-${action === "CLOSE" ? "Close" : "Open"}.`;

  if (action === "OPEN" && isAutoClosed) {
    warning = `Barang pada PO nomor ${nomor} sudah diterima 100% (unit_kurang = 0). Di sistem MMT, status PO otomatis tetap CLOSE karena penerimaan barang telah lengkap.`;
    message = `PO nomor ${nomor} berhasil dibuka (Open PO) di database, namun statusnya secara otomatis tetap CLOSE oleh sistem karena seluruh barang sudah diterima 100%.`;
  }

  return {
    success: true,
    nomor,
    action,
    isAutoClosed,
    isFullyReceived,
    unitKurang: poInfo.unit_kurang,
    message,
    warning,
  };
};

const loadMkbDetail = async (nomorMkb) => {
  const sql = `SELECT d.mkbd_bhn_kode AS kode, b.brg_nama AS nama, d.mkbd_bhn_satuan AS satuan,
      d.mkbd_jumlah_po AS jumlah, b.brg_hargabeli AS harga, 0 AS diskon, d.mkbd_spk_nomor AS spk, ? AS mkb
      FROM tmkb_dtl d LEFT JOIN tbarang_mmt b ON b.brg_kode = d.mkbd_bhn_kode WHERE d.mkbd_mkb_nomor = ?`;
  const [rows] = await pool.query(sql, [nomorMkb, nomorMkb]);
  if (rows.length === 0) throw new Error("MKB tidak ditemukan.");
  return {
    Detail: rows.map((i) => ({
      ...i,
      total: i.jumlah * i.harga,
      namaext: i.nama,
      roll: 0,
    })),
  };
};

const getPoDataForPrint = async (nomor) => {
  const poData = await getPOById(nomor);
  if (!poData) throw new Error("Data PO tidak ditemukan.");

  const [compRows] = await pool.query(`
    SELECT perush_nama, perush_alamat, perush_npwp
    FROM tperusahaan
    WHERE perush_kode = 'KP'
  `);
  const comp = compRows[0] || {};

  // 1. Hitung detail barang
  const detailPrint = poData.Detail.map((d) => {
    const qty = Number(d.jumlah) || 0;
    const m2 = Number(d.m2) || 0;
    const harga = Number(d.harga) || 0;
    const diskon = Number(d.diskon) || 0;
    const panjang = Number(d.panjang) || 0;
    const lebar = Number(d.lebar) || 0;

    const qtyHitung = m2 > 0 ? qty * m2 : qty;
    const total = qtyHitung * harga * (1 - diskon / 100);

    return {
      NoUrut: d.no,
      Kode: d.kode,
      Deskripsi: d.namaext || d.nama,
      Panjang: panjang,
      Lebar: lebar,
      Quantity: qty,
      Satuan: d.satuan,
      UnitPrice: harga,
      Diskon: diskon,
      Total: total,
      _qty: qty,
      _m2: m2,
      _qtyHitung: qtyHitung,
    };
  });

  // 2. Akumulasi total kotor (Grand Total sebelum dipisah PPN)
  const grandTotal = detailPrint.reduce((sum, d) => sum + d.Total, 0);
  const ppnRate = poData.PpnRate || 11;

  let subTotal = grandTotal;
  let totalPpn = 0;

  // 3. Hitung mundur jika IsPpn = 1 (Include PPN)
  if (poData.IsPpn === 1) {
    subTotal = grandTotal / (1 + ppnRate / 100);
    totalPpn = grandTotal - subTotal;
  }

  return {
    Header: {
      Nomor: poData.Nomor,
      Tanggal: formatDateForPrint(poData.Tanggal),
      TglPengiriman: formatDateForPrint(poData.Dateline),
      KeteranganHeader: poData.Keterangan,
      IsAcc: poData.PoAcc,
      IsPpn: poData.IsPpn,
      PpnRate: ppnRate,

      SubTotal: subTotal,
      TotalPpn: totalPpn,
      GrandTotal: grandTotal,

      NamaSupplier: poData.SupNama,
      AlamatSupplier: poData.SupAlamat,
      KotaSupplier: poData.SupKota,
      AlamatPabrik: poData.AlamatPabrik,
      AlamatPbrik: poData.AlamatPabrik,
      Pemesan: poData.Pemesan || poData.UserCreate || "Lia",

      NamaPerusahaan: comp.perush_nama || "CV. Kencana Print",
      AlamatPerusahaan: comp.perush_alamat,
      NPWPPerusahaan: comp.perush_npwp,
    },
    Detail: detailPrint,
  };
};

const getUnfulfilledMbDetail = async (mbNomor) => {
  // Cek apakah nomor diawali MO (Gudang WH-20)
  const isObat = mbNomor.startsWith("MO");

  const sql = `
    SELECT 
      req.mbd_brg_kode AS Kode,
      -- Jika MO ambil dari tgarmen_brg (brg_nama), jika tidak dari tbarang_mmt (brg_nama)
      ${isObat ? "TRIM(t.brg_nama)" : "TRIM(b.brg_nama)"} AS Nama_Bahan,
      req.mbd_brg_satuan AS Satuan,
      req.mbd_spk_nomor AS Nomor_SPK,

      req.mbd_qty AS Qty_Roll,
      req.mbd_qty_po AS Committed_PO_Qty,
      (req.mbd_qty - COALESCE(req.mbd_qty_po, 0)) AS Sisa_Qty_Roll,

      -- Untuk Obat biasanya tidak ada panjang lebar, kita set 0 atau ambil dari kolom yang sesuai
      ${isObat ? "0" : "b.brg_panjang"} AS Panjang,
      ${isObat ? "0" : "b.brg_lebar"}   AS Lebar,
      ${isObat ? "t.brg_harga" : "b.brg_hrgbeli"} AS Harga_Master,
      ${isObat ? "'PCS'" : "b.brg_satuan_harga"} AS brg_satuan_harga

    FROM tmintabahan_mmt_dtl req
    -- Join kondisional berdasarkan jenis gudang
    LEFT JOIN tbarang_mmt b ON req.mbd_brg_kode = b.brg_kode AND '${isObat}' = 'false'
    LEFT JOIN tgarmen_brg t ON req.mbd_brg_kode = t.brg_kode AND '${isObat}' = 'true'

    WHERE 
      req.mbd_mb_nomor = ?
      AND req.mbd_acc = 'Y'
      AND (req.mbd_qty - COALESCE(req.mbd_qty_po, 0)) > 0

    ORDER BY req.mbd_nourut
  `;

  const [rows] = await pool.query(sql, [mbNomor]);

  const [hRows] = await pool.query(
    `SELECT mb_keterangan FROM tmintabahan_mmt_hdr WHERE mb_nomor = ?`,
    [mbNomor],
  );

  return {
    Nomor: mbNomor,
    Keterangan: hRows[0]?.mb_keterangan || "", // Pastikan nama kolom benar (mb_keterangan/mb_memo)
    Detail: rows.map((item) => {
      const panjang = parseFloat(item.Panjang) || 0;
      const lebar = parseFloat(item.Lebar) || 0;
      const m2 = panjang * lebar;

      return {
        Kode: item.Kode,
        Nama_Bahan: item.Nama_Bahan,
        Satuan: item.Satuan,
        Nomor_SPK: item.Nomor_SPK,

        Jumlah: parseFloat(item.Sisa_Qty_Roll),
        Panjang: panjang,
        Lebar: lebar,
        M2: m2 > 0 ? m2 : 0,
        brg_satuan_harga: item.brg_satuan_harga,

        Harga: parseFloat(item.Harga_Master) || 0, // Ambil harga master sebagai default
        Diskon: 0,
        mb_nomor: mbNomor,
        total: parseFloat(item.Sisa_Qty_Roll) * (parseFloat(item.Harga_Master) || 0),
      };
    }),
  };
};

const getPOLookupData = async (keyword) => {
  try {
    let sql = `
            SELECT * FROM (
                SELECT 
                    h.po_nomor AS Nomor, 
                    DATE_FORMAT(h.po_tanggal, '%d/%m/%Y') AS Tanggal, 
                    h.po_sup_kode AS Supplier,
                    s.sup_nama AS NamaSupplier,
                    (SELECT GROUP_CONCAT(DISTINCT d2.pod_mb_nomor SEPARATOR ', ') 
                     FROM tpo_mmt_dtl d2 
                     WHERE d2.pod_po_nomor = h.po_nomor AND d2.pod_mb_nomor IS NOT NULL) AS NomorRequest,
                    (SELECT SUM(d.pod_qty * d.pod_harga) 
                     FROM tpo_mmt_dtl d 
                     WHERE d.pod_po_nomor = h.po_nomor) AS TotalHarga,
                    ${PO_STATUS_CASE_SQL} AS Status
                FROM tpo_mmt_hdr h
                LEFT JOIN tsupplier s ON h.po_sup_kode = s.sup_kode
                ${PO_RECEIPT_STATUS_JOINS_SQL}
            ) AS LookupTable
            WHERE 1=1 -- <--- UBAH DI SINI (Hapus Status IN ('OPEN', 'ONPROSES'))
        `;

    const params = [];
    if (keyword) {
      sql += ` AND (Nomor LIKE ? OR Supplier LIKE ? OR NamaSupplier LIKE ? OR NomorRequest LIKE ?)`;
      const searchKeyword = `%${keyword}%`;
      params.push(searchKeyword, searchKeyword, searchKeyword, searchKeyword);
    }

    sql += ` ORDER BY Nomor DESC LIMIT 100`;

    const [rows] = await pool.query(sql, params);
    return rows;
  } catch (error) {
    throwDbError("Gagal mengambil data PO untuk lookup", error);
  }
};

const getPODetail = async (poNomor) => {
  // <-- Namanya poNomor
  try {
    // 1. Ambil Header
    const [hRows] = await pool.query(
      `
      SELECT 
        po_nomor AS Nomor, 
        DATE_FORMAT(po_tanggal, '%Y-%m-%d') AS Tanggal, 
        po_sup_kode AS Kode_Supplier 
      FROM tpo_mmt_hdr 
      WHERE po_nomor = ?
    `,
      [poNomor],
    );

    if (hRows.length === 0) {
      throw new Error(`Nomor PO ${poNomor} tidak ditemukan.`);
    }

    // 2. Ambil Detail
    const [detailRows] = await pool.query(
      `
      SELECT 
        d.pod_nourut AS no, d.pod_brg_kode AS kode, 
        COALESCE(b.brg_nama, t.brg_nama) AS nama,
        d.pod_keterangan AS namaext, d.pod_brg_satuan AS satuan, 
        d.pod_qty AS jumlah, d.pod_m2 AS m2,
        d.pod_harga AS harga, d.pod_discpr AS diskon, d.pod_spk_nomor AS spk,
        d.pod_mb_nomor AS mb_nomor, 
        COALESCE(b.brg_panjang, 0) AS panjang, COALESCE(b.brg_lebar, 0) AS lebar,
        d.pod_qty_terima AS qty_terima_po,
        -- Qty yang sudah diterima: ambil dari realisasi penerimaan (rec_memo = PO),
        -- lalu bandingkan dengan kolom pod_qty_terima agar data lama tetap terhitung.
        LEAST(
          IFNULL(d.pod_qty, 0),
          GREATEST(
            IFNULL(d.pod_qty_terima, 0),
            IFNULL(rr.qty_terima, 0)
          )
        ) AS sudah_terima,
        d.pod_qty * d.pod_m2 * d.pod_harga * (1 - d.pod_discpr / 100) AS total
      FROM tpo_mmt_dtl d
      LEFT JOIN tbarang_mmt b ON d.pod_brg_kode = b.brg_kode
    LEFT JOIN tgarmen_brg t ON d.pod_brg_kode = t.brg_kode
      LEFT JOIN (
        SELECT
          UPPER(TRIM(rh.rec_memo)) AS po_nomor,
          TRIM(rd.recd_brg_kode) AS brg_kode,
          SUM(IFNULL(rd.recd_qty_terima, 0)) AS qty_terima
        FROM trec_mmt_hdr rh
        INNER JOIN trec_mmt_dtl rd
          ON rd.recd_rec_nomor = rh.rec_nomor
        WHERE IFNULL(rh.rec_type, 0) = 0
          AND rh.rec_memo IS NOT NULL
          AND TRIM(rh.rec_memo) <> ''
        GROUP BY UPPER(TRIM(rh.rec_memo)), TRIM(rd.recd_brg_kode)
      ) rr
        ON rr.po_nomor = UPPER(TRIM(d.pod_po_nomor))
       AND rr.brg_kode = TRIM(d.pod_brg_kode)
      WHERE d.pod_po_nomor = ? 
      ORDER BY d.pod_nourut
    `,
      [poNomor],
    ); // <-- Tadi di sini 'nomor' (SALAH), diubah jadi poNomor (BENAR)

    // 3. Return Data
    // Tadi di sini 'dRows' (SALAH), diubah jadi detailRows (BENAR)
    return { header: hRows[0], details: detailRows };
  } catch (error) {
    // Pastikan fungsi throwDbError sudah didefinisikan di tempat lain
    throw error;
  }
};

const accManagerPO = async (nomor, user) => {
  const [result] = await pool.query(
    `UPDATE tpo_mmt_hdr
     SET po_acc = 'Y',
         user_modified = ?,
         date_modified = NOW()
     WHERE po_nomor = ?`,
    [user, nomor],
  );

  if (result.affectedRows === 0) {
    throw new Error("PO tidak ditemukan atau gagal ACC");
  }

  return true;
};

module.exports = {
  getPoMmtData,
  getPoDetailByNomor,
  getPoDataForPrint,
  getPOById,
  savePoMmt,
  deletePoMmt,
  toggleCloseStatus,
  loadMkbDetail,
  getUnfulfilledMbDetail,
  getPOLookupData,
  getPODetail,
  accManagerPO,
};
