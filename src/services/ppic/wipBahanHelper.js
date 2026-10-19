// services/ppic/wipBahanHelper.js
const db = require("../../config/database");

const KOMPONEN_WIP = "BODY";
const bulat2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// WIP Bahan per SPK dari Realisasi Permintaan Bahan (komponen BODY).
// Rumus jumlah/terpakai sama dengan searchNoMaterial (Mutasi Produksi):
//   jumlah   = promind_jumlah - retur
//   terpakai = mutasi (mph_qty_berat) + BPJ (bpj_qty_berat)
//   Qty      = SUM(jumlah)
//   WIP      = SUM(MAX(jumlah - terpakai, 0))   (sisa realisasi yang belum dipakai)
const getWipBahanBySpk = async (spkList) => {
  const list = [
    ...new Set(
      (spkList || []).map((s) => String(s || "").trim()).filter(Boolean),
    ),
  ];
  if (!list.length) return {};

  const [rows] = await db.query(
    `SELECT x.spk,
            IFNULL(b.Bhn_satuan, '') AS satuan,
            SUM(x.jumlah) AS qty,
            SUM(GREATEST(x.jumlah - x.terpakai, 0)) AS wip
     FROM (
       SELECT h.promin_spk_nomor AS spk,
              d.promind_bhn_kode AS kode,
              d.promind_jumlah - IFNULL((
                SELECT SUM(rt.proretd_Jumlah)
                FROM tproduksiretur_dtl rt
                WHERE rt.proretd_nominta = h.promin_nomor
                  AND rt.proretd_bhn_kode = d.promind_bhn_kode
              ), 0) AS jumlah,
              IFNULL((
                SELECT SUM(m.mph_qty_berat)
                FROM tmutasiproduksi_hdr m
                WHERE m.mph_nomaterial = h.promin_nomor
                  AND m.mph_bhn_kode = d.promind_bhn_kode
              ), 0)
              + IFNULL((
                SELECT SUM(p.bpj_qty_berat)
                FROM tbpj_hdr p
                WHERE p.bpj_nomaterial = h.promin_nomor
                  AND p.bpj_bhn_kode = d.promind_bhn_kode
              ), 0) AS terpakai
       FROM tproduksiminta_hdr h
       INNER JOIN tproduksiminta_dtl d ON d.promind_promin_nomor = h.promin_nomor
       WHERE h.promin_spk_nomor IN (?)
         AND h.promin_aktif = 'Y'
         AND EXISTS (
           SELECT 1 FROM tmintabahan_dtl md
           WHERE md.mind_nomor = h.promin_minta
             AND md.mind_bhn_kode = d.promind_kodem
             AND md.mind_komponen = ?
         )
     ) x
     LEFT JOIN tbahan b ON b.Bhn_kode = x.kode
     GROUP BY x.spk, b.Bhn_satuan`,
    [list, KOMPONEN_WIP],
  );

  const perSpk = {};
  for (const r of rows) {
    (perSpk[r.spk] = perSpk[r.spk] || []).push({
      satuan: r.satuan,
      qty: bulat2(r.qty),
      wip: bulat2(r.wip),
    });
  }

  // Satuan dengan Qty terbesar jadi utama; satuan lain tidak bisa dijumlahkan,
  // jadi dikirim sebagai catatan teks.
  const hasil = {};
  for (const [spk, arr] of Object.entries(perSpk)) {
    arr.sort((a, b) => b.qty - a.qty);
    const [utama, ...lain] = arr;
    hasil[spk] = {
      wip: utama.wip,
      qty: utama.qty,
      satuan: utama.satuan,
      catatan: lain.map((l) => `${l.wip} ${l.satuan}`).join(" + "),
    };
  }
  return hasil;
};

// Tempelkan WipBahan/WipQty/WipSatuan/WipCatatan ke baris yang punya NomorSPK
const withWipBahan = async (rows, spkKey = "NomorSPK") => {
  const map = await getWipBahanBySpk(rows.map((r) => r[spkKey]));
  return rows.map((r) => {
    const w = map[r[spkKey]];
    return {
      ...r,
      WipBahan: w ? w.wip : 0,
      WipQty: w ? w.qty : 0,
      WipSatuan: w ? w.satuan : "",
      WipCatatan: w ? w.catatan : "",
    };
  });
};

module.exports = { getWipBahanBySpk, withWipBahan };
