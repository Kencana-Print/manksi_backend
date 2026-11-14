// services/laporan/spanduk/pemakaianBahanService.js
// Rekap Pemakaian Kain: baris per LHK Cetak x kain (web) + master kain + stok per gudang (desktop ufrmBrowsepemakaian).
const db = require("../../../config/database");
const { validasiPeriode } = require("../../spanduk/lhk/lhkCommon");

const GUDANG_UTAMA = "WH006"; // gudang bahan baku P2, selalu tampil dan pertama

const dua = (v) => Math.round((Number(v) || 0) * 100) / 100;

async function getPemakaianBahan(tglAwal, tglAkhir) {
  validasiPeriode(tglAwal, tglAkhir);

  // 1. Baris LHK x kain + master tbahan (lck_brg_kode sudah kode SB, PRD #167)
  const [rows] = await db.query(
    `SELECT CONCAT(h.lch_nomor, '|', k.lck_brg_kode) AS Kunci,
            DATE_FORMAT(h.lch_tanggal, '%Y-%m-%d') AS Tanggal,
            h.lch_nomor    AS Nomor_LHK,
            h.lch_sesi     AS Sesi,
            h.lch_pab_kode AS Kode_Pabrik,
            k.lck_brg_kode AS Kode_Bahan,
            b.Bhn_Name       AS Nama_Bahan,
            b.bhn_konstruksi AS Konstruksi,
            b.bhn_lebar      AS Lebar,
            k.lck_qty_meter  AS Qty_Meter
       FROM tlhk_cetak_hdr h
       JOIN tlhk_cetak_kain k ON k.lck_lch_nomor = h.lch_nomor
       LEFT JOIN tbahan b     ON b.Bhn_kode = k.lck_brg_kode
      WHERE h.lch_tanggal BETWEEN ? AND ?
      ORDER BY h.lch_tanggal, h.lch_nomor, b.Bhn_Name, k.lck_brg_kode`,
    [tglAwal, tglAkhir],
  );

  const kodeList = [...new Set(rows.map((r) => r.Kode_Bahan).filter(Boolean))];
  const stok = new Map(); // kode -> { gdg: saldo }
  const supplier = new Map(); // kode -> { kode, nama }
  const gudangAda = new Set([GUDANG_UTAMA]);

  if (kodeList.length) {
    // 2. Saldo akhir periode per bahan per gudang (aturan sama dengan Laporan Persediaan, #7.46)
    const [rs] = await db.query(
      `SELECT mst_brg_kode AS kode, mst_gdg_kode AS gdg,
              SUM(mst_stok_in - mst_stok_out) AS saldo
         FROM tmasterstok_bahan
        WHERE mst_aktif = 'Y' AND mst_tanggal <= ? AND mst_brg_kode IN (?)
        GROUP BY mst_brg_kode, mst_gdg_kode`,
      [tglAkhir, kodeList],
    );
    for (const s of rs) {
      const v = dua(s.saldo);
      if (!stok.has(s.kode)) stok.set(s.kode, {});
      stok.get(s.kode)[s.gdg] = v;
      if (v !== 0) gudangAda.add(s.gdg);
    }

    // 3. Supplier = PO terakhir bahan (po_jenis 5, po_close <> 9) s/d akhir periode
    const [sp] = await db.query(
      `SELECT x.kode, x.sup_kode, s.sup_nama
         FROM (
           SELECT d.pod_bhn_kode AS kode,
                  COALESCE(NULLIF(d.pod_sup_kode,''), h.po_sup_kode) AS sup_kode,
                  ROW_NUMBER() OVER (PARTITION BY d.pod_bhn_kode
                                     ORDER BY h.po_tanggal DESC, h.po_nomor DESC) AS rn
             FROM tpo_dtl d
             JOIN tpo_hdr h ON h.po_nomor = d.pod_po_nomor
            WHERE h.po_jenis = 5 AND h.po_close <> 9
              AND h.po_tanggal < DATE_ADD(?, INTERVAL 1 DAY)
              AND d.pod_bhn_kode IN (?)
         ) x
         LEFT JOIN tsupplier s ON s.sup_kode = x.sup_kode
        WHERE x.rn = 1`,
      [tglAkhir, kodeList],
    );
    for (const s of sp)
      supplier.set(s.kode, {
        kode: s.sup_kode || "-",
        nama: s.sup_nama || "-",
      });
  }

  // 4. Nama gudang dinamis (WH006 pertama, sisanya urut kode)
  const kodeGdg = [
    GUDANG_UTAMA,
    ...[...gudangAda].filter((g) => g !== GUDANG_UTAMA).sort(),
  ];
  const [gd] = await db.query(
    `SELECT gdg_kode, gdg_nama FROM tgudang WHERE gdg_kode IN (?)`,
    [kodeGdg],
  );
  const namaGdg = new Map(gd.map((g) => [g.gdg_kode, g.gdg_nama]));
  const gudang = kodeGdg.map((kode) => ({
    kode,
    nama: namaGdg.get(kode) || kode,
  }));

  const hasil = rows.map((r) => {
    const sup = supplier.get(r.Kode_Bahan) || { kode: "-", nama: "-" };
    const st = stok.get(r.Kode_Bahan) || {};
    const g = {};
    for (const x of gudang) g[x.kode] = st[x.kode] || 0;
    return {
      Kunci: r.Kunci,
      Tanggal: r.Tanggal,
      Nomor_LHK: r.Nomor_LHK,
      Sesi: r.Sesi,
      Kode_Pabrik: r.Kode_Pabrik,
      Kode_Bahan: r.Kode_Bahan,
      Kode_Supplier: sup.kode,
      Nama_Bahan: r.Nama_Bahan || "",
      Nama_Supplier: sup.nama,
      Konstruksi: r.Konstruksi || "",
      Satuan: "METER",
      Lebar: r.Lebar,
      Qty_Meter: dua(r.Qty_Meter),
      Gudang: g,
    };
  });

  return { rows: hasil, gudang };
}

module.exports = { getPemakaianBahan };
