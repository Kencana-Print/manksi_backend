const db = require("../../config/database"); // samakan dengan require db di cetakBarcodeKoliService

const STATUS_FILTER = ["SEMUA", "PROSES", "SELESAI"];
const TOLERANSI = 0.001;

const num = (v) => (v === null || v === undefined ? 0 : Number(v));

const getBrowse = async (tglAwal, tglAkhir, status = "SEMUA", cab = "") => {
  const params = [tglAwal, tglAkhir];
  let filter = "";

  if (status !== "SEMUA") {
    filter += " AND h.ktr_status = ?";
    params.push(status);
  }
  if (cab) {
    filter += " AND h.ktr_cab = ?";
    params.push(cab);
  }

  const [rows] = await db.query(
    `SELECT
        h.ktr_nomor AS Nomor,
        DATE_FORMAT(h.ktr_tanggal, '%Y-%m-%d') AS Tanggal,
        h.ktr_stbj_nomor AS StbjNomor,
        h.ktr_kch_nomor AS CbkNomor,
        h.ktr_cab AS Cab,
        h.ktr_status AS Status,
        h.ktr_keterangan AS Keterangan,
        COALESCE(u.user_nama, h.user_create) AS UserNama,
        h.ktr_tgl_selesai AS TglSelesai,
        (SELECT COUNT(*) FROM tkoli k
          WHERE k.koli_kch_nomor = h.ktr_kch_nomor
            AND k.koli_status <> 'VOID') AS KoliAktif,
        (SELECT COUNT(*) FROM tkoli k
          WHERE k.koli_ktr_nomor = h.ktr_nomor) AS KoliDiterima,
        (SELECT COUNT(*) FROM tkoli_terima_dtl d
          WHERE d.ktd_ktr_nomor = h.ktr_nomor) AS JumlahSpk,
        (SELECT COUNT(*) FROM tkoli_terima_dtl d
          WHERE d.ktd_ktr_nomor = h.ktr_nomor
            AND d.ktd_pcs_fisik IS NOT NULL) AS SpkPcsDiisi,
        (SELECT COUNT(*) FROM tkoli_terima_dtl d
          WHERE d.ktd_ktr_nomor = h.ktr_nomor
            AND d.ktd_pcs_fisik IS NOT NULL
            AND ABS(d.ktd_pcs_fisik - d.ktd_pcs_stbj) > ${TOLERANSI}) AS SpkPcsSelisih
     FROM tkoli_terima_hdr h
     LEFT JOIN tuser u ON u.user_kode = h.user_create
     WHERE h.ktr_tanggal >= ? AND h.ktr_tanggal <= ?
       ${filter}
     ORDER BY h.ktr_tanggal DESC, h.ktr_nomor DESC`,
    params,
  );

  return rows.map((r) => ({
    ...r,
    KoliAktif: num(r.KoliAktif),
    KoliDiterima: num(r.KoliDiterima),
    JumlahSpk: num(r.JumlahSpk),
    SpkPcsDiisi: num(r.SpkPcsDiisi),
    SpkPcsSelisih: num(r.SpkPcsSelisih),
  }));
};

const getDetail = async (nomor) => {
  const [hdr] = await db.query(
    `SELECT ktr_kch_nomor, ktr_stbj_nomor
       FROM tkoli_terima_hdr WHERE ktr_nomor = ?`,
    [nomor],
  );
  if (!hdr.length) return [];
  const { ktr_kch_nomor: kch, ktr_stbj_nomor: stbj } = hdr[0];

  const [koli] = await db.query(
    `SELECT
        k.koli_spk_nomor AS SpkNomor,
        SUM(k.koli_status <> 'VOID') AS Aktif,
        SUM(k.koli_ktr_nomor = ?) AS Diterima,
        SUM(k.koli_status = 'VOID') AS Void
     FROM tkoli k
     WHERE k.koli_kch_nomor = ?
     GROUP BY k.koli_spk_nomor`,
    [nomor, kch],
  );

  const [dtl] = await db.query(
    `SELECT ktd_spk_nomor AS SpkNomor, ktd_pcs_stbj AS PcsSnapshot,
            ktd_pcs_fisik AS PcsFisik, ktd_alasan AS Alasan
       FROM tkoli_terima_dtl WHERE ktd_ktr_nomor = ?`,
    [nomor],
  );

  const [live] = await db.query(
    `SELECT stbjd_spk_nomor AS SpkNomor, SUM(stbjd_jumlah) AS Pcs
       FROM tstbj_dtl
      WHERE stbjd_stbj_nomor = ?
      GROUP BY stbjd_spk_nomor`,
    [stbj],
  );

  const spkSet = new Set([
    ...koli.map((r) => r.SpkNomor),
    ...dtl.map((r) => r.SpkNomor),
    ...live.map((r) => r.SpkNomor),
  ]);
  if (!spkSet.size) return [];

  const [spk] = await db.query(
    `SELECT spk_nomor, spk_nama FROM tspk WHERE spk_nomor IN (?)`,
    [[...spkSet]],
  );

  const mKoli = new Map(koli.map((r) => [r.SpkNomor, r]));
  const mDtl = new Map(dtl.map((r) => [r.SpkNomor, r]));
  const mLive = new Map(live.map((r) => [r.SpkNomor, num(r.Pcs)]));
  const mNama = new Map(spk.map((r) => [r.spk_nomor, r.spk_nama]));

  return [...spkSet].sort().map((spkNomor) => {
    const k = mKoli.get(spkNomor);
    const d = mDtl.get(spkNomor);
    const aktif = k ? num(k.Aktif) : 0;
    const diterima = k ? num(k.Diterima) : 0;
    const voidCnt = k ? num(k.Void) : 0;

    let statusSpk = "BELUM";
    if (aktif === 0 && voidCnt > 0) statusSpk = "VOID";
    else if (aktif > 0 && diterima >= aktif) statusSpk = "LENGKAP";
    else if (diterima > 0) statusSpk = "SEBAGIAN";

    const pcsLive = mLive.has(spkNomor) ? mLive.get(spkNomor) : null;
    const pcsSnapshot = d ? num(d.PcsSnapshot) : null;
    const pcsFisik = d && d.PcsFisik !== null ? num(d.PcsFisik) : null;

    let statusPcs = "BELUM_ISI";
    if (pcsFisik !== null) {
      if (
        pcsSnapshot !== null &&
        Math.abs((pcsLive ?? 0) - pcsSnapshot) > TOLERANSI
      ) {
        statusPcs = "STBJ_BERUBAH";
      } else if (Math.abs(pcsFisik - (pcsLive ?? 0)) > TOLERANSI) {
        statusPcs = "SELISIH";
      } else {
        statusPcs = "SESUAI";
      }
    }

    return {
      SpkNomor: spkNomor,
      SpkNama: mNama.get(spkNomor) || "",
      KoliAktif: aktif,
      KoliDiterima: diterima,
      KoliVoid: voidCnt,
      StatusSpk: statusSpk,
      PcsStbj: pcsLive,
      PcsSnapshot: pcsSnapshot,
      PcsFisik: pcsFisik,
      StatusPcs: statusPcs,
      Alasan: d ? d.Alasan : null,
    };
  });
};

module.exports = { STATUS_FILTER, getBrowse, getDetail };
