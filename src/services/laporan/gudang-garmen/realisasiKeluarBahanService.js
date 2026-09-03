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

const getStatusChip = (status, qtyPotong, qtyOrder) => {
  const potongCukup = Number(qtyPotong) >= Number(qtyOrder);
  if (status === STATUS_LABEL.CLOSED) {
    return potongCukup
      ? { label: "Closed", color: "black" }
      : { label: "Closed · Potong Kurang", color: "yellow" };
  }
  if (status === STATUS_LABEL.OPEN) {
    return potongCukup
      ? { label: "Open · Potong Cukup", color: "green" }
      : { label: "Open · Potong Kurang", color: "red" };
  }
  return { label: "Process", color: "blue" };
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

  const spkList = [...new Set(rows.map((r) => r.spk_nomor))];
  const komponenList = [...new Set(rows.map((r) => r.komponen))];
  const kodeBahanList = [...new Set(rows.map((r) => r.kode_bahan))];
  const memoList = [...new Set(rows.map((r) => r.spk_memo).filter(Boolean))];

  // ── Batch 1: Qty Potong + Berat Potong (sudah ada) ──
  const [potongRows] = await db.query(
    `SELECT mph_spk_nomor AS spk_nomor, mph_komponen AS komponen,
          SUM(mph_jumlah) AS jml,
          SUM(CASE WHEN mph_sat_berat = 'KG' THEN mph_qty_berat ELSE 0 END) AS berat_kg
    FROM tmutasiproduksi_hdr
    WHERE mph_spk_nomor IN (?) AND mph_komponen IN (?)
      AND mph_gdgasal IN ('GP001', 'GP015')
    GROUP BY mph_spk_nomor, mph_komponen`,
    [spkList, komponenList],
  );
  const potongLookup = new Map();
  const beratPotongLookup = new Map();
  potongRows.forEach((p) => {
    const key = `${p.spk_nomor}|${p.komponen}`;
    potongLookup.set(key, Number(p.jml) || 0);
    beratPotongLookup.set(key, Number(p.berat_kg) || 0);
  });

  // ── Batch 2: Std MAP (by memo + komponen) ──
  const stdMapLookup = new Map();
  if (memoList.length > 0) {
    const [mapRows] = await db.query(
      `SELECT nomor, komponen, babaran
       FROM tkesesuaianmap_komponen
       WHERE nomor IN (?) AND komponen IN (?)`,
      [memoList, komponenList],
    );
    mapRows.forEach((m) => {
      stdMapLookup.set(`${m.nomor}|${m.komponen}`, Number(m.babaran) || 0);
    });
  }

  // ── Batch 3: Realisasi Keluar (by spk + kode_bahan) ──
  const [realRows] = await db.query(
    `SELECT h2.promin_spk_nomor AS spk_nomor, d2.promind_bhn_kode AS kode_bahan,
            SUM(d2.promind_jumlah) AS jml,
            GROUP_CONCAT(DISTINCT h2.promin_nomor SEPARATOR ',') AS nomor
     FROM tproduksiminta_hdr h2
     INNER JOIN tproduksiminta_dtl d2 ON d2.promind_promin_nomor = h2.promin_nomor
     WHERE h2.promin_spk_nomor IN (?) AND d2.promind_bhn_kode IN (?)
       AND h2.promin_aktif = 'Y'
     GROUP BY h2.promin_spk_nomor, d2.promind_bhn_kode`,
    [spkList, kodeBahanList],
  );
  const realisasiLookup = new Map();
  realRows.forEach((r) => {
    realisasiLookup.set(`${r.spk_nomor}|${r.kode_bahan}`, {
      jml: Number(r.jml) || 0,
      nomor: r.nomor || "",
    });
  });

  // ── Batch 4: Minta Bahan detail (by spk + kode_bahan) — dikelompokkan di JS ──
  const [mintaRows] = await db.query(
    `SELECT h3.min_spk_nomor AS spk_nomor, d3.mind_bhn_kode AS kode_bahan,
            d3.mind_jumlah AS jml, h3.min_nomor, h3.min_ket
     FROM tmintabahan_hdr h3
     INNER JOIN tmintabahan_dtl d3 ON d3.mind_nomor = h3.min_nomor
     WHERE h3.min_spk_nomor IN (?) AND d3.mind_bhn_kode IN (?)`,
    [spkList, kodeBahanList],
  );
  const mintaLookup = new Map();
  mintaRows.forEach((m) => {
    const key = `${m.spk_nomor}|${m.kode_bahan}`;
    if (!mintaLookup.has(key)) mintaLookup.set(key, []);
    mintaLookup.get(key).push(m);
  });

  // ── Batch 5: Mutasi detail (untuk Selisih Babaran) — by spk + komponen ──
  const [mutasiRows] = await db.query(
    `SELECT mph_spk_nomor AS spk_nomor, mph_komponen AS komponen,
            mph_jumlah, mph_qty_berat, mph_sat_berat
     FROM tmutasiproduksi_hdr
     WHERE mph_spk_nomor IN (?) AND mph_komponen IN (?)
       AND mph_gdgasal IN ('GP001', 'GP015')
       AND mph_qty_berat <> 0 AND mph_jumlah <> 0`,
    [spkList, komponenList],
  );
  const mutasiLookup = new Map();
  mutasiRows.forEach((m) => {
    const key = `${m.spk_nomor}|${m.komponen}`;
    if (!mutasiLookup.has(key)) mutasiLookup.set(key, []);
    mutasiLookup.get(key).push(m);
  });

  // ── Assemble hasil — murni in-memory, tanpa query tambahan ──
  const result = rows.map((r) => {
    const stdMap = r.spk_memo
      ? stdMapLookup.get(`${r.spk_memo}|${r.komponen}`) || 0
      : 0;

    const realisasi = realisasiLookup.get(`${r.spk_nomor}|${r.kode_bahan}`);
    const realisasiKeluar = realisasi?.jml || 0;
    const noRealisasi = realisasi?.nomor || "";

    const mintaDtlRows =
      mintaLookup.get(`${r.spk_nomor}|${r.kode_bahan}`) || [];
    const qtyPermintaan = mintaDtlRows.reduce(
      (s, m) => s + (Number(m.jml) || 0),
      0,
    );
    const noPermintaan = [
      ...new Set(mintaDtlRows.map((m) => m.min_nomor)),
    ].join(", ");
    const kategoriSet = new Set(
      mintaDtlRows.map((m) =>
        m.min_ket && m.min_ket.trim() !== ""
          ? m.min_ket.trim().toUpperCase()
          : "BARU",
      ),
    );
    const keteranganKategori = [...kategoriSet].join(", ");

    const qtyPotong = potongLookup.get(`${r.spk_nomor}|${r.komponen}`) || 0;
    const beratPotongKg =
      beratPotongLookup.get(`${r.spk_nomor}|${r.komponen}`) || 0;
    const stdActual =
      realisasiKeluar > 0
        ? Number((qtyPotong / realisasiKeluar).toFixed(2))
        : 0;
    const selisihBeratKg = Number((beratPotongKg - realisasiKeluar).toFixed(2));

    const mutasiForRow = mutasiLookup.get(`${r.spk_nomor}|${r.komponen}`) || [];
    let selisihKg = 0;
    if (mutasiForRow.length > 0) {
      const std = Number(r.std_mkb) || 0;
      for (const m of mutasiForRow) {
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
    const statusChip = getStatusChip(status, qtyPotong, r.qty_order);

    return {
      Spk: r.spk_nomor,
      TanggalSpk: r.spk_tanggal,
      NamaSpk: r.spk_nama,
      QtyOrder: Number(r.qty_order) || 0,
      Komponen: r.komponen,
      NamaBahan: r.nama_bahan || "",
      Satuan: r.satuan || "",
      StdMap: stdMap,
      StdMkb: Number(r.std_mkb) || 0,
      StdActual: stdActual,
      NoRealisasi: noRealisasi,
      RealisasiKeluar: realisasiKeluar,
      Status: status,
      StatusChip: statusChip,
      NoPermintaan: noPermintaan,
      QtyPermintaan: qtyPermintaan,
      Keterangan: keteranganKategori,
      QtyPotong: qtyPotong,
      BeratPotongKg: Number(beratPotongKg.toFixed(2)),
      SelisihBeratKg: selisihBeratKg,
      Workshop: r.spk_workshop || "",
      SelisihBabaran: Number(selisihKg.toFixed(2)),
    };
  });

  return result;
};

module.exports = { getBrowse };
