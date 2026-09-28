const db = require("../../../config/database");

// ── Lookup Divisi (Cost Center) ────────────────────────────────────────
const getListDivisi = async () => {
  const [rows] = await db.query(
    `SELECT cc_kode AS kode, cc_nama AS nama
     FROM finance.tcostcenter
     ORDER BY cc_kode`,
  );
  return rows;
};

// ── Laporan Biaya per Divisi ────────────────────────────────────────────
// Sumber ada 2 alur, digabung via UNION ALL:
//
// (A) Uang Muka / Penyelesaian Uang Muka — tjurnalitem di-link ke tkasbon
//     via bon_jur_no. No. Pengajuan diambil per-BARIS jurnal karena
//     jurd_nourut selalu sama persis dengan nourut di tabel detail asalnya
//     (pmd_nourut / bond_nourut / bond2_nourut — lihat
//     uangMukaPenyelesaianService saveData). Urutan pencarian:
//       1. Item GA (tpermintaan_dtl, pmd_bon + pmd_nourut) → pengajuan asli
//       2. Item baru non-GA dengan link (tkasbonitem2, bond2_link)
//          → MB/IV/POE/VOU
//       3. Fallback ke bon_pjh_nomor header — kasbon format lama.
//
// (B) Pengajuan Transfer — tjurnalitem BBK di-link ke
//     tpengajuan_transfer_dtl via ptd_jur_no (bukan lewat tkasbon sama
//     sekali, makanya harus dipisah). Tiap detail transfer yang
//     direalisasi punya jur_no sendiri-sendiri, dengan 1 baris debet
//     (jurd_nourut selalu = 1, lihat pengajuanTransferService saveData).
//     No. Pengajuan diambil dari ptd_trs (link VOU/POE) kalau ada,
//     fallback ke nomor pengajuan transfer itu sendiri (pth_nomor).
const getBiayaPerDivisi = async (cckode, startDate, endDate) => {
  const [divisiRow] = await db.query(
    `SELECT cc_kode AS kode, cc_nama AS nama FROM finance.tcostcenter WHERE cc_kode = ?`,
    [cckode],
  );
  if (!divisiRow.length) throw new Error("Divisi tidak ditemukan.");

  const [rows] = await db.query(
    `SELECT * FROM (
       -- (A) Alur Uang Muka
       SELECT
         IFNULL(r.rek_kode, i.jurd_rek_kode)               AS RekKode,
         IFNULL(r.rek_nama, i.jurd_rek_kode)               AS NamaAkun,
         COALESCE(
           gaPjh.pjh_nomor,
           NULLIF(item2.bond2_link, ''),
           NULLIF(k.bon_pjh_nomor, '')
         )                                                  AS NoPengajuan,
         DATE_FORMAT(
           COALESCE(gaPjh.pjh_tanggal, headerPjh.pjh_tanggal, k.bon_tanggal),
           '%Y-%m-%d'
         )                                                  AS TanggalPengajuan,
         j.jur_no                                           AS NoBkkBbk,
         DATE_FORMAT(j.jur_tanggal, '%Y-%m-%d')             AS TanggalBkkBbk,
         IFNULL(i.jurd_dcnama, '')                          AS DetailCC,
         i.jurd_uraian                                      AS Uraian,
         IFNULL(i.jurd_debet, 0)                            AS Nominal
       FROM finance.tjurnalitem i
       INNER JOIN finance.tjurnal j ON j.jur_no = i.jurd_jur_no
       INNER JOIN finance.tkasbon k ON k.bon_jur_no = j.jur_no
       LEFT JOIN finance.trekening r ON r.rek_kode = i.jurd_rek_kode
       LEFT JOIN ga2.tpermintaan_dtl gaDtl
              ON gaDtl.pmd_bon = k.bon_nomor
             AND gaDtl.pmd_nourut = i.jurd_nourut
       LEFT JOIN ga2.tpermintaan_hdr gaHdr
              ON gaHdr.pmt_nomor = gaDtl.pmd_pmt_nomor
       LEFT JOIN ga2.tpengajuan2_hdr gaPjh
              ON gaPjh.pjh_nomor = gaHdr.pmt_pjh_nomor
       LEFT JOIN finance.tkasbonitem2 item2
              ON item2.bond2_nomor = k.bon_nomor
             AND item2.bond2_nourut = i.jurd_nourut
       LEFT JOIN ga2.tpengajuan2_hdr headerPjh
              ON headerPjh.pjh_nomor = k.bon_pjh_nomor
       WHERE i.jurd_nourut <> 0
         AND i.jurd_trs IN ('BKK', 'BBK')
         AND i.jurd_cc_kode = ?
         AND j.jur_tanggal >= ? AND j.jur_tanggal <= ?

       UNION ALL

       -- (B) Alur Pengajuan Transfer
       SELECT
         IFNULL(r.rek_kode, i.jurd_rek_kode)               AS RekKode,
         IFNULL(r.rek_nama, i.jurd_rek_kode)               AS NamaAkun,
         COALESCE(NULLIF(d.ptd_trs, ''), NULLIF(h.pth_nomor, '')) AS NoPengajuan,
         DATE_FORMAT(h.pth_tanggal, '%Y-%m-%d')             AS TanggalPengajuan,
         j.jur_no                                           AS NoBkkBbk,
         DATE_FORMAT(j.jur_tanggal, '%Y-%m-%d')             AS TanggalBkkBbk,
         IFNULL(i.jurd_dcnama, '')                          AS DetailCC,
         i.jurd_uraian                                      AS Uraian,
         IFNULL(i.jurd_debet, 0)                            AS Nominal
       FROM finance.tjurnalitem i
       INNER JOIN finance.tjurnal j ON j.jur_no = i.jurd_jur_no
       INNER JOIN finance.tpengajuan_transfer_dtl d ON d.ptd_jur_no = j.jur_no
       INNER JOIN finance.tpengajuan_transfer_hdr h ON h.pth_nomor = d.ptd_nomor
       LEFT JOIN finance.trekening r ON r.rek_kode = i.jurd_rek_kode
       WHERE i.jurd_nourut <> 0
         AND i.jurd_trs = 'BBK'
         AND i.jurd_cc_kode = ?
         AND j.jur_tanggal >= ? AND j.jur_tanggal <= ?
     ) x
     ORDER BY x.NamaAkun, x.TanggalBkkBbk, x.NoBkkBbk`,
    [cckode, startDate, endDate, cckode, startDate, endDate],
  );

  // ── Group per Nama Akun (sesuai format cetak: header akun + detail) ──
  const grouped = new Map();
  for (const row of rows) {
    const key = row.RekKode;
    if (!grouped.has(key)) {
      grouped.set(key, {
        rekKode: row.RekKode,
        namaAkun: row.NamaAkun,
        totalNominal: 0,
        detail: [],
      });
    }
    const g = grouped.get(key);
    g.totalNominal += Number(row.Nominal) || 0;
    g.detail.push({
      noPengajuan: row.NoPengajuan || "",
      tanggalPengajuan: row.TanggalPengajuan,
      noBkkBbk: row.NoBkkBbk,
      tanggalBkkBbk: row.TanggalBkkBbk,
      detailCC: row.DetailCC,
      uraian: row.Uraian,
      nominal: Number(row.Nominal) || 0,
    });
  }

  const akunList = Array.from(grouped.values());
  const grandTotal = akunList.reduce((s, a) => s + a.totalNominal, 0);

  return {
    divisi: divisiRow[0],
    akunList,
    grandTotal,
  };
};

module.exports = {
  getListDivisi,
  getBiayaPerDivisi,
};
