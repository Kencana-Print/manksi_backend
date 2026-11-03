const db = require("../../../config/database");
const { validasiPeriode } = require("../../spanduk/lhk/lhkCommon");

// Divisi 1 Spanduk = P02, divisi 5 MMT = P05
const CABANG_LAPORAN = ["P02", "P05"];

const dua = (n) => Math.round((Number(n) || 0) * 100) / 100;
const meter = (panjang, lebar, qty) =>
  dua((Number(panjang) || 0) * (Number(lebar) || 0) * (Number(qty) || 0));
const totalQty = (list) => dua(list.reduce((s, r) => s + r.Qty, 0));
const tglTerakhir = (list) =>
  list.reduce((m, r) => (r.Tanggal > m ? r.Tanggal : m), "") || null;

const kelompokkan = (rows) => {
  const hasil = {};
  for (const r of rows) {
    (hasil[r.Ref] = hasil[r.Ref] || []).push({
      Nomor: r.Nomor,
      Tanggal: r.Tanggal,
      Qty: Number(r.Qty) || 0,
    });
  }
  return hasil;
};

const getKetercapaian = async (tglAwal, tglAkhir, cabang) => {
  validasiPeriode(tglAwal, tglAkhir);
  if (cabang && !CABANG_LAPORAN.includes(cabang)) {
    const err = new Error("Cabang tidak valid untuk laporan ini.");
    err.status = 400;
    throw err;
  }

  // ── Header: periode komitmen kirim ──
  const [periode] = await db.query(
    `SELECT h.pjw_nomor AS Nomor,
            DATE_FORMAT(h.pjw_tgl1, '%Y-%m-%d') AS TglAwal,
            DATE_FORMAT(h.pjw_tgl2, '%Y-%m-%d') AS TglAkhir,
            h.pjw_cab AS Cabang,
            h.pjw_close AS Close,
            h.pjw_keterangan AS Keterangan
     FROM tpenjadwalan_ppic_hdr h
     WHERE h.pjw_tgl1 BETWEEN ? AND ?
       AND h.pjw_cab IN (?)
     ORDER BY h.pjw_tgl1, h.pjw_cab, h.pjw_nomor`,
    [tglAwal, tglAkhir, cabang ? [cabang] : CABANG_LAPORAN],
  );
  if (!periode.length) return [];

  // ── Detail: baris SO per periode (tab SO, bukan MAP/Sampel) ──
  const [detail] = await db.query(
    `SELECT d.pjwd_id AS PjwdId,
            d.pjwd_pjw_nomor AS PjwNomor,
            d.pjwd_so_nomor AS SoNomor,
            COALESCE(so.so_spk_ref, d.pjwd_so_nomor) AS SpkRef,
            so.so_nama AS SoNama,
            so.so_panjang AS Panjang,
            so.so_lebar AS Lebar,
            so.so_jumlah AS QtyOrder,
            d.pjwd_rencana AS PermintaanQty,
            DATE_FORMAT(d.pjwd_tgl_permintaan_kirim, '%Y-%m-%d') AS PermintaanTgl,
            d.pjwd_qty_kesepakatan AS EstimasiQty,
            DATE_FORMAT(d.pjwd_tgl_kesepakatan, '%Y-%m-%d') AS EstimasiTgl
     FROM tpenjadwalan_ppic_dtl d
     LEFT JOIN tsalesorder so ON so.so_nomor = d.pjwd_so_nomor
     WHERE d.pjwd_pjw_nomor IN (?)
       AND d.pjwd_tipe <> 'MAP'
       AND d.pjwd_so_nomor IS NOT NULL
     ORDER BY d.pjwd_pjw_nomor, so.so_tanggal, d.pjwd_so_nomor`,
    [periode.map((p) => p.Nomor)],
  );

  // ── STBJ & SJ: satu query per jenis, rentang = gabungan semua periode;
  // dipilah per periode di JS.
  const refs = [...new Set(detail.map((r) => r.SpkRef).filter(Boolean))];
  const minTgl = periode.reduce(
    (m, p) => (p.TglAwal < m ? p.TglAwal : m),
    periode[0].TglAwal,
  );
  const maxTgl = periode.reduce(
    (m, p) => (p.TglAkhir > m ? p.TglAkhir : m),
    periode[0].TglAkhir,
  );

  let stbj = {};
  let sj = {};
  if (refs.length) {
    const [stbjRows] = await db.query(
      `SELECT td.stbjd_spk_nomor AS Ref,
              th.stbj_nomor AS Nomor,
              DATE_FORMAT(th.stbj_tanggal, '%Y-%m-%d') AS Tanggal,
              SUM(td.stbjd_jumlah) AS Qty
       FROM tstbj_dtl td
       INNER JOIN tstbj_hdr th ON th.stbj_nomor = td.stbjd_stbj_nomor
       WHERE td.stbjd_spk_nomor IN (?)
         AND th.stbj_tanggal >= ?
         AND th.stbj_tanggal < DATE_ADD(?, INTERVAL 1 DAY)
       GROUP BY td.stbjd_spk_nomor, th.stbj_nomor, th.stbj_tanggal`,
      [refs, minTgl, maxTgl],
    );
    stbj = kelompokkan(stbjRows);

    const [sjRows] = await db.query(
      `SELECT sd.sjd_spk_nomor AS Ref,
              sh.sj_nomor AS Nomor,
              DATE_FORMAT(sh.sj_tanggal, '%Y-%m-%d') AS Tanggal,
              SUM(sd.sjd_jumlah) AS Qty
       FROM tsj_dtl sd
       INNER JOIN tsj_hdr sh ON sh.sj_nomor = sd.sjd_sj_nomor
       WHERE sd.sjd_spk_nomor IN (?)
         AND sh.sj_approve <> 2
         AND sh.sj_tanggal >= ?
         AND sh.sj_tanggal < DATE_ADD(?, INTERVAL 1 DAY)
       GROUP BY sd.sjd_spk_nomor, sh.sj_nomor, sh.sj_tanggal`,
      [refs, minTgl, maxTgl],
    );
    sj = kelompokkan(sjRows);
  }

  // ── Rakit header + detail ──
  const detailPerPeriode = {};
  for (const r of detail) {
    (detailPerPeriode[r.PjwNomor] = detailPerPeriode[r.PjwNomor] || []).push(r);
  }

  return periode.map((p) => {
    const dalamPeriode = (list) =>
      (list || []).filter(
        (x) => x.Tanggal >= p.TglAwal && x.Tanggal <= p.TglAkhir,
      );

    const rows = (detailPerPeriode[p.Nomor] || []).map((r) => {
      const stbjList = dalamPeriode(stbj[r.SpkRef]);
      const sjList = dalamPeriode(sj[r.SpkRef]);
      const estimasiQty = Number(r.EstimasiQty) || 0;
      const stbjQty = totalQty(stbjList);
      const aktualQty = totalQty(sjList);

      return {
        PjwdId: r.PjwdId,
        So_Nomor: r.SoNomor,
        So_Nama: r.SoNama,
        Panjang: Number(r.Panjang) || 0,
        Lebar: Number(r.Lebar) || 0,
        Qty_Order: Number(r.QtyOrder) || 0,
        Permintaan_Qty: Number(r.PermintaanQty) || 0,
        Permintaan_Tgl: r.PermintaanTgl,
        Estimasi_Qty: estimasiQty,
        Estimasi_Mtr: meter(r.Panjang, r.Lebar, estimasiQty),
        Estimasi_Tgl: r.EstimasiTgl,
        Stbj_Qty: stbjQty,
        Stbj_Mtr: meter(r.Panjang, r.Lebar, stbjQty),
        Stbj_Tgl: tglTerakhir(stbjList),
        Stbj_Rincian: stbjList,
        Aktual_Qty: aktualQty,
        Aktual_Mtr: meter(r.Panjang, r.Lebar, aktualQty),
        Aktual_Tgl: tglTerakhir(sjList),
        Aktual_Rincian: sjList,
      };
    });

    const sum = (key) => dua(rows.reduce((s, r) => s + r[key], 0));
    return {
      ...p,
      Planning_Qty: sum("Estimasi_Qty"),
      Planning_Mtr: sum("Estimasi_Mtr"),
      Stbj_Qty: sum("Stbj_Qty"),
      Stbj_Mtr: sum("Stbj_Mtr"),
      Aktual_Qty: sum("Aktual_Qty"),
      Aktual_Mtr: sum("Aktual_Mtr"),
      Detail: rows,
    };
  });
};

module.exports = { getKetercapaian };
