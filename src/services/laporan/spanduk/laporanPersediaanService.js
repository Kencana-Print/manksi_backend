const db = require("../../../config/database");

const GUDANG_UTAMA = "WH006";

const normalisasiTanggal = (tanggal) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tanggal || "")) {
    throw new Error("Tanggal periode tidak valid (format YYYY-MM-DD)");
  }
  return tanggal;
};

const bulat = (n) => Math.round((Number(n) || 0) * 100) / 100;

const getData = async ({ tanggal, sembunyiNol = false }) => {
  const tgl = normalisasiTanggal(tanggal);

  const [bahan] = await db.query(
    `SELECT b.Bhn_kode AS kode, b.Bhn_Name AS nama, b.bhn_konstruksi AS konstruksi,
            IFNULL(b.bhn_lebar, 0) AS lebar, IFNULL(b.bhn_panjang, 0) AS panjang,
            b.bhn_aktif AS aktif
     FROM tbahan b
     WHERE b.Bhn_kode LIKE 'SB%'
     ORDER BY b.Bhn_kode`,
  );

  const [stok] = await db.query(
    `SELECT mst_brg_kode AS kode, mst_gdg_kode AS gdg,
            SUM(mst_stok_in - mst_stok_out) AS stok
     FROM tmasterstok_bahan
     WHERE mst_aktif = 'Y' AND mst_brg_kode LIKE 'SB%' AND mst_tanggal <= ?
     GROUP BY mst_brg_kode, mst_gdg_kode`,
    [tgl],
  );

  // PO terakhir per bahan (hasil sudah terurut terbaru dulu, ambil kemunculan pertama)
  const [po] = await db.query(
    `SELECT d.pod_bhn_kode AS kode,
            COALESCE(NULLIF(d.pod_sup_kode, ''), h.po_sup_kode) AS sup_kode,
            s.sup_nama
     FROM tpo_dtl d
     JOIN tpo_hdr h ON h.po_nomor = d.pod_po_nomor
     LEFT JOIN tsupplier s ON s.sup_kode = COALESCE(NULLIF(d.pod_sup_kode, ''), h.po_sup_kode)
     WHERE d.pod_bhn_kode LIKE 'SB%' AND h.po_jenis = 5 AND h.po_close <> 9
       AND h.po_tanggal <= ?
     ORDER BY h.po_tanggal DESC, h.po_nomor DESC`,
    [tgl],
  );
  const supplierByKode = new Map();
  po.forEach((p) => {
    if (!supplierByKode.has(p.kode)) supplierByKode.set(p.kode, p);
  });

  const stokByKode = new Map();
  const kodeGudang = new Set([GUDANG_UTAMA]);
  stok.forEach((s) => {
    if (!stokByKode.has(s.kode)) stokByKode.set(s.kode, {});
    stokByKode.get(s.kode)[s.gdg] = bulat(s.stok);
    if (bulat(s.stok) !== 0) kodeGudang.add(s.gdg);
  });

  const kodeList = [...kodeGudang];
  const [namaGudang] = await db.query(
    `SELECT gdg_kode AS kode, gdg_nama AS nama FROM tgudang WHERE gdg_kode IN (?)`,
    [kodeList],
  );
  const namaMap = new Map(namaGudang.map((g) => [g.kode, g.nama]));
  const gudang = kodeList
    .sort((a, b) =>
      a === GUDANG_UTAMA ? -1 : b === GUDANG_UTAMA ? 1 : a.localeCompare(b),
    )
    .map((kode) => ({ kode, nama: namaMap.get(kode) || kode }));

  const total = {
    jumlah: 0,
    stok: Object.fromEntries(gudang.map((g) => [g.kode, 0])),
  };
  const rows = [];

  bahan.forEach((b) => {
    const stokGdg = stokByKode.get(b.kode) || {};
    const perGudang = {};
    let jumlah = 0;
    gudang.forEach((g) => {
      const v = stokGdg[g.kode] || 0;
      perGudang[g.kode] = v;
      jumlah += v;
    });
    jumlah = bulat(jumlah);
    // stok di gudang lain (tidak tampil sebagai kolom) tetap dihitung agar bahan tidak tersembunyi
    const adaStok = Object.values(stokGdg).some((v) => v !== 0);

    if (b.aktif !== 0 && !adaStok) return;
    if (sembunyiNol && !adaStok) return;

    const sup = supplierByKode.get(b.kode);
    rows.push({
      kategori: "BAHAN BAKU UTAMA",
      divisi: "SPANDUK",
      kode: b.kode,
      nama: b.nama,
      konstruksi: b.konstruksi || "-",
      lebar: Number(b.lebar),
      panjang: Number(b.panjang),
      satuan: "METER",
      supplier_kode: sup?.sup_kode || "-",
      supplier_nama: sup?.sup_nama || "-",
      stok: perGudang,
      jumlah,
    });
    gudang.forEach(
      (g) =>
        (total.stok[g.kode] = bulat(total.stok[g.kode] + perGudang[g.kode])),
    );
    total.jumlah = bulat(total.jumlah + jumlah);
  });

  return { tanggal: tgl, gudang, rows, total };
};

module.exports = { getData };
