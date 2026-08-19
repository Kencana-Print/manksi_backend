const db = require("../../../config/database");

const STATUS_LABEL = {
  CLOSED: "Closed",
  OPEN: "Open",
  PROCESS: "Process",
};

// ── Warna baris — kombinasi background (kuning/hijau) & teks (hitam/merah),
// berdasarkan matriks Status × Qty Potong vs Qty Order:
//   Closed + potong >= order → HITAM (teks)   — closed penuh
//   Closed + potong <  order → KUNING (bg)    — closed tapi potong kurang
//   Open   + potong >= order → HIJAU (bg)     — masih open tapi potong cukup
//   Open   + potong <  order → MERAH (teks)   — masih open, potong kurang
//   Process (apapun)         → tanpa warna
const getRowColor = (status, qtyPotong, qtyOrder) => {
  const potongCukup = Number(qtyPotong) >= Number(qtyOrder);
  if (status === STATUS_LABEL.CLOSED) {
    return potongCukup ? "black" : "yellow";
  }
  if (status === STATUS_LABEL.OPEN) {
    return potongCukup ? "green" : "red";
  }
  return "";
};

const getBrowse = async (filters) => {
  const { startDate, endDate, spkNomor } = filters;

  let whereClause = `WHERE s.spk_tanggal >= ? AND s.spk_tanggal <= ?`;
  const params = [`${startDate} 00:00:00`, `${endDate} 23:59:59`];

  if (spkNomor) {
    whereClause += ` AND s.spk_nomor = ?`;
    params.push(spkNomor);
  }

  const [rows] = await db.query(
    `SELECT
       s.spk_nomor, DATE_FORMAT(s.spk_tanggal, '%Y-%m-%d') AS spk_tanggal,
       s.spk_nama, s.spk_jumlah AS qty_order, s.spk_cab, s.spk_workshop,
       s.spk_memo,
       d.mkbd_komponen AS komponen,
       d.mkbd_bhn_kode AS kode_bahan,
       b.bhn_name AS nama_bahan,
       b.bhn_satuan AS satuan,
       d.mkbd_babaran AS std_mkb
     FROM tspk s
     INNER JOIN tmkb_hdr h ON h.mkb_spk_nomor = s.spk_nomor
     INNER JOIN tmkb_dtl d ON d.mkbd_mkb_nomor = h.mkb_nomor
     LEFT JOIN tbahan b ON b.bhn_kode = d.mkbd_bhn_kode
     ${whereClause}
       AND d.mkbd_komponen <> ''
     ORDER BY s.spk_nomor, d.mkbd_nourut`,
    params,
  );

  if (rows.length === 0) return [];

  // ── Batch Qty Potong SEKALI di luar loop — keyed by spk+komponen,
  // karena tahap Potong sering dicatat pakai kode bahan generik yang
  // beda dari kode bahan spesifik hasil realisasi (skenario "beda bahan").
  const spkList = [...new Set(rows.map((r) => r.spk_nomor))];
  const komponenList = [...new Set(rows.map((r) => r.komponen))];

  const [potongRows] = await db.query(
    `SELECT mph_spk_nomor AS spk_nomor, mph_komponen AS komponen,
            SUM(mph_jumlah) AS jml
     FROM tmutasiproduksi_hdr
     WHERE mph_spk_nomor IN (?) AND mph_komponen IN (?)
       AND mph_gdgasal IN ('GP001', 'GP015')
     GROUP BY mph_spk_nomor, mph_komponen`,
    [spkList, komponenList],
  );
  const potongLookup = new Map(
    potongRows.map((p) => [`${p.spk_nomor}|${p.komponen}`, Number(p.jml) || 0]),
  );

  const result = [];

  for (const r of rows) {
    let stdMap = 0;
    if (r.spk_memo) {
      const [[mapRow]] = await db.query(
        `SELECT babaran FROM tkesesuaianmap_komponen
         WHERE nomor = ? AND komponen = ? LIMIT 1`,
        [r.spk_memo, r.komponen],
      );
      stdMap = Number(mapRow?.babaran) || 0;
    }

    const [[realRow]] = await db.query(
      `SELECT IFNULL(SUM(d2.promind_jumlah), 0) AS jml,
              GROUP_CONCAT(DISTINCT h2.promin_nomor SEPARATOR ',') AS nomor
       FROM tproduksiminta_hdr h2
       INNER JOIN tproduksiminta_dtl d2 ON d2.promind_promin_nomor = h2.promin_nomor
       WHERE h2.promin_spk_nomor = ? AND d2.promind_bhn_kode = ?
         AND h2.promin_aktif = 'Y'`,
      [r.spk_nomor, r.kode_bahan],
    );
    const realisasiKeluar = Number(realRow?.jml) || 0;
    const noRealisasi = realRow?.nomor || "";

    const [[mintaRow]] = await db.query(
      `SELECT IFNULL(SUM(d3.mind_jumlah), 0) AS jml,
              GROUP_CONCAT(DISTINCT h3.min_nomor SEPARATOR ',') AS nomor,
              GROUP_CONCAT(DISTINCT h3.min_ket SEPARATOR ', ') AS ket,
              MIN(h3.min_close) AS min_close_worst
       FROM tmintabahan_hdr h3
       INNER JOIN tmintabahan_dtl d3 ON d3.mind_nomor = h3.min_nomor
       WHERE h3.min_spk_nomor = ? AND d3.mind_bhn_kode = ?`,
      [r.spk_nomor, r.kode_bahan],
    );
    const qtyPermintaan = Number(mintaRow?.jml) || 0;
    const noPermintaan = mintaRow?.nomor || "";
    const keterangan = mintaRow?.ket || "";
    const mintaClosed = Number(mintaRow?.min_close_worst) === 1;

    // ── Qty Potong dari lookup yang sudah dihitung sekali di atas ────────
    const qtyPotong = potongLookup.get(`${r.spk_nomor}|${r.komponen}`) || 0;

    // ── Selisih by KG — GANTI: join by KOMPONEN saja (bukan +kode_bahan),
    // alasan sama seperti Qty Potong di atas ────────────────────────────
    const [mutasiRows] = await db.query(
      `SELECT mph_jumlah, mph_qty_berat, mph_sat_berat
       FROM tmutasiproduksi_hdr
       WHERE mph_spk_nomor = ? AND mph_komponen = ?
         AND mph_gdgasal IN ('GP001', 'GP015')
         AND mph_qty_berat <> 0 AND mph_jumlah <> 0`,
      [r.spk_nomor, r.komponen],
    );
    let selisihKg = 0;
    if (mutasiRows.length > 0) {
      const std = Number(r.std_mkb) || 0;
      for (const m of mutasiRows) {
        const j = Number(m.mph_jumlah) || 0;
        const b = Number(m.mph_qty_berat) || 0;
        const actual = m.mph_sat_berat === "KG" ? j / b : b / j;
        const selisih =
          !std || !actual
            ? 0
            : m.mph_sat_berat === "KG"
              ? actual - std
              : std - actual;
        selisihKg += selisih;
      }
    }

    let status;
    if (qtyPermintaan > 0 && realisasiKeluar >= qtyPermintaan) {
      status = STATUS_LABEL.CLOSED;
    } else if (realisasiKeluar === 0) {
      status = STATUS_LABEL.OPEN;
    } else {
      status = STATUS_LABEL.PROCESS;
    }
    const realisasiClosed = status === STATUS_LABEL.CLOSED;
    const rowColor = getRowColor(status, qtyPotong, r.qty_order);

    result.push({
      Spk: r.spk_nomor,
      TanggalSpk: r.spk_tanggal,
      NamaSpk: r.spk_nama,
      QtyOrder: Number(r.qty_order) || 0,
      Komponen: r.komponen,
      NamaBahan: r.nama_bahan || "",
      Satuan: r.satuan || "",
      StdMap: stdMap,
      StdMkb: Number(r.std_mkb) || 0,
      NoRealisasi: noRealisasi,
      RealisasiKeluar: realisasiKeluar,
      Status: status,
      NoPermintaan: noPermintaan,
      QtyPermintaan: qtyPermintaan,
      Keterangan: keterangan,
      QtyPotong: qtyPotong,
      Workshop: r.spk_workshop || "",
      SelisihKg: Number(selisihKg.toFixed(2)),
      RowColor: rowColor,
    });
  }

  return result;
};

module.exports = { getBrowse };
