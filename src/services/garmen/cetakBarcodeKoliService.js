const db = require("../../config/database");
const { FG_SCOPE } = require("./cetakBarcodeKoliFormService");

// ============================================================
// CETAK BARCODE KOLI — BROWSE SERVICE (fase 1)
// Tabel: tkoli_cetak_hdr / tkoli / tstbj_hdr / tstbj_dtl.
// Filter cabang mengikuti pola Cetak Barcode Kaosan (literal).
// ============================================================

const STATUS_DITERIMA = ["DITERIMA_FG", "DIMUAT"];

// ─────────────────────────────────────────────
// BROWSE MASTER — daftar dokumen CBK + ringkasan koli
// ─────────────────────────────────────────────
const getBrowse = async (tglAwal, tglAkhir, userCabang) => {
  let sql = `
    SELECT
      h.kch_nomor AS Nomor,
      DATE_FORMAT(h.kch_tanggal, '%Y-%m-%d') AS Tanggal,
      h.kch_cab AS Cab,
      h.kch_stbj_nomor AS StbjNomor,
      u.user_nama AS UserNama,
      (SELECT COUNT(*) FROM tkoli k
        WHERE k.koli_kch_nomor = h.kch_nomor AND k.koli_status <> 'VOID') AS KoliAktif,
      (SELECT COUNT(*) FROM tkoli k
        WHERE k.koli_kch_nomor = h.kch_nomor AND k.koli_status IN (?)) AS KoliDiterima,
      (SELECT COUNT(*) FROM tkoli k
        WHERE k.koli_kch_nomor = h.kch_nomor AND k.koli_status = 'VOID') AS KoliVoid
    FROM tkoli_cetak_hdr h
    LEFT JOIN tuser u ON u.user_kode = h.user_create
    WHERE h.kch_tanggal >= ? AND h.kch_tanggal <= ?
  `;
  const params = [STATUS_DITERIMA, tglAwal, tglAkhir];

  if (
    userCabang &&
    userCabang !== "HO-" &&
    userCabang !== "ADMIN" &&
    userCabang !== ""
  ) {
    sql += ` AND h.kch_cab = ?`;
    params.push(userCabang);
  }

  sql += ` ORDER BY h.kch_tanggal, h.kch_nomor`;

  const [rows] = await db.query(sql, params);
  return rows.map((r) => ({
    ...r,
    KoliAktif: Number(r.KoliAktif) || 0,
    KoliDiterima: Number(r.KoliDiterima) || 0,
    KoliVoid: Number(r.KoliVoid) || 0,
  }));
};

// ─────────────────────────────────────────────
// DETAIL (expand baris) — ringkasan per SPK.
// Daftar koli per ID ada di form service (getDetail).
// ─────────────────────────────────────────────
const getDetail = async (nomor) => {
  const [rows] = await db.query(
    `SELECT
       k.koli_spk_nomor AS Spk,
       s.spk_nama AS NamaSpk,
       COUNT(*) AS Dibuat,
       SUM(k.koli_status <> 'VOID') AS Aktif,
       SUM(k.koli_status IN (?)) AS Diterima,
       SUM(k.koli_status = 'VOID') AS Void,
       SUM(k.koli_cetak_count) AS TotalCetak
     FROM tkoli k
     LEFT JOIN tspk s ON s.spk_nomor = k.koli_spk_nomor
     WHERE k.koli_kch_nomor = ?
     GROUP BY k.koli_spk_nomor, s.spk_nama
     ORDER BY k.koli_spk_nomor`,
    [STATUS_DITERIMA, nomor],
  );
  return rows.map((r) => ({
    ...r,
    Dibuat: Number(r.Dibuat) || 0,
    Aktif: Number(r.Aktif) || 0,
    Diterima: Number(r.Diterima) || 0,
    Void: Number(r.Void) || 0,
    TotalCetak: Number(r.TotalCetak) || 0,
  }));
};

// ─────────────────────────────────────────────
// LAPORAN SELISIH — STBJ (gudang cakupan) vs koli aktif, per SPK.
// Status:
//   BELUM_CETAK  : koli STBJ > 0, belum ada koli aktif
//   SESUAI       : koli aktif = koli STBJ
//   SELISIH      : koli aktif <> koli STBJ (STBJ diedit setelah cetak)
//   KOLI_TIDAK_VALID : koli di STBJ pecahan / 0
//   SPK_TIDAK_ADA    : ada koli aktif tapi SPK-nya sudah tidak ada di STBJ
//   STBJ_HILANG      : ada koli aktif tapi STBJ-nya sudah dihapus
// hanyaSelisih=true → buang baris SESUAI.
// ─────────────────────────────────────────────
const getSelisih = async (
  tglAwal,
  tglAkhir,
  userCabang,
  hanyaSelisih = false,
) => {
  let gudang = Object.keys(FG_SCOPE);
  if (userCabang && userCabang !== "HO-" && userCabang !== "ADMIN") {
    gudang = gudang.filter((g) => FG_SCOPE[g] === userCabang);
  }
  const hasil = [];

  // 1) STBJ dalam rentang tanggal
  const [hdr] = gudang.length
    ? await db.query(
        `SELECT stbj_nomor AS nomor,
                DATE_FORMAT(stbj_tanggal, '%Y-%m-%d') AS tanggal,
                stbj_gdg_kode AS gdg
         FROM tstbj_hdr
         WHERE stbj_tanggal >= ? AND stbj_tanggal <= ? AND stbj_gdg_kode IN (?)`,
        [tglAwal, tglAkhir, gudang],
      )
    : [[]];

  if (hdr.length) {
    const nomorList = hdr.map((h) => h.nomor);
    const hdrMap = new Map(hdr.map((h) => [h.nomor, h]));

    const [dtl] = await db.query(
      `SELECT stbjd_stbj_nomor AS stbj, stbjd_spk_nomor AS spk,
              SUM(stbjd_koli) AS koli, SUM(stbjd_jumlah) AS pcs
       FROM tstbj_dtl
       WHERE stbjd_stbj_nomor IN (?)
       GROUP BY stbjd_stbj_nomor, stbjd_spk_nomor`,
      [nomorList],
    );
    const [koli] = await db.query(
      `SELECT koli_stbj_nomor AS stbj, koli_spk_nomor AS spk,
              SUM(koli_status <> 'VOID') AS aktif,
              SUM(koli_status IN (?)) AS diterima
       FROM tkoli
       WHERE koli_stbj_nomor IN (?)
       GROUP BY koli_stbj_nomor, koli_spk_nomor`,
      [STATUS_DITERIMA, nomorList],
    );
    const koliMap = new Map(koli.map((k) => [`${k.stbj}|${k.spk}`, k]));

    // pcs saat cetak, hanya dari dokumen yang masih punya koli aktif untuk SPK itu
    const [snap] = await db.query(
      `SELECT h.kch_stbj_nomor AS stbj, c.kcd_spk_nomor AS spk, SUM(c.kcd_pcs) AS pcs
       FROM tkoli_cetak_dtl c
       INNER JOIN tkoli_cetak_hdr h ON h.kch_nomor = c.kcd_kch_nomor
       WHERE h.kch_stbj_nomor IN (?)
         AND EXISTS (
           SELECT 1 FROM tkoli k
           WHERE k.koli_kch_nomor = c.kcd_kch_nomor
             AND k.koli_spk_nomor = c.kcd_spk_nomor
             AND k.koli_status <> 'VOID')
       GROUP BY h.kch_stbj_nomor, c.kcd_spk_nomor`,
      [nomorList],
    );
    const pcsMap = new Map(
      snap.map((r) => [`${r.stbj}|${r.spk}`, Number(r.pcs) || 0]),
    );
    const dipakai = new Set();

    for (const d of dtl) {
      const key = `${d.stbj}|${d.spk}`;
      dipakai.add(key);
      const k = koliMap.get(key);
      const koliStbj = Number(d.koli) || 0;
      const aktif = Number(k?.aktif) || 0;
      const diterima = Number(k?.diterima) || 0;
      let status;
      if (!Number.isInteger(koliStbj) || koliStbj <= 0) {
        status = "KOLI_TIDAK_VALID";
      } else if (aktif === 0) {
        status = "BELUM_CETAK";
      } else {
        status = aktif === koliStbj ? "SESUAI" : "SELISIH";
      }
      const pcsStbj = Number(d.pcs) || 0;
      const pcsCetak = pcsMap.has(key) ? pcsMap.get(key) : null;
      if (
        status === "SESUAI" &&
        pcsCetak !== null &&
        Math.abs(pcsCetak - pcsStbj) > 0.001
      ) {
        status = "PCS_BERUBAH";
      }
      hasil.push({
        StbjNomor: d.stbj,
        Tanggal: hdrMap.get(d.stbj).tanggal,
        Gudang: hdrMap.get(d.stbj).gdg,
        Spk: d.spk,
        PcsStbj: pcsStbj,
        PcsCetak: pcsCetak,
        KoliStbj: koliStbj,
        KoliAktif: aktif,
        KoliDiterima: diterima,
        Status: status,
      });
    }

    // koli aktif yang SPK-nya sudah tidak ada di STBJ
    for (const k of koli) {
      const key = `${k.stbj}|${k.spk}`;
      if (dipakai.has(key) || !(Number(k.aktif) > 0)) continue;
      hasil.push({
        StbjNomor: k.stbj,
        Tanggal: hdrMap.get(k.stbj).tanggal,
        Gudang: hdrMap.get(k.stbj).gdg,
        Spk: k.spk,
        PcsStbj: 0,
        KoliStbj: 0,
        KoliAktif: Number(k.aktif) || 0,
        KoliDiterima: Number(k.diterima) || 0,
        Status: "SPK_TIDAK_ADA",
      });
    }
  }

  // 2) koli aktif yang STBJ-nya sudah dihapus (dicari lewat tanggal buat koli)
  const [yatim] = await db.query(
    `SELECT k.koli_stbj_nomor AS stbj, k.koli_spk_nomor AS spk, k.koli_gdg_kode AS gdg,
            SUM(k.koli_status <> 'VOID') AS aktif,
            SUM(k.koli_status IN (?)) AS diterima
     FROM tkoli k
     LEFT JOIN tstbj_hdr h ON h.stbj_nomor = k.koli_stbj_nomor
     WHERE h.stbj_nomor IS NULL
       AND k.date_create >= ? AND k.date_create < DATE_ADD(?, INTERVAL 1 DAY)
       ${gudang.length ? "AND k.koli_gdg_kode IN (?)" : "AND 1 = 0"}
     GROUP BY k.koli_stbj_nomor, k.koli_spk_nomor, k.koli_gdg_kode
     HAVING aktif > 0`,
    gudang.length
      ? [STATUS_DITERIMA, tglAwal, tglAkhir, gudang]
      : [STATUS_DITERIMA, tglAwal, tglAkhir],
  );
  for (const y of yatim) {
    hasil.push({
      StbjNomor: y.stbj,
      Tanggal: "",
      Gudang: y.gdg,
      Spk: y.spk,
      PcsStbj: 0,
      KoliStbj: 0,
      KoliAktif: Number(y.aktif) || 0,
      KoliDiterima: Number(y.diterima) || 0,
      Status: "STBJ_HILANG",
    });
  }

  const urut = hasil.sort(
    (a, b) =>
      String(a.Tanggal).localeCompare(String(b.Tanggal)) ||
      a.StbjNomor.localeCompare(b.StbjNomor) ||
      a.Spk.localeCompare(b.Spk),
  );
  return hanyaSelisih ? urut.filter((r) => r.Status !== "SESUAI") : urut;
};

module.exports = {
  getBrowse,
  getDetail,
  getSelisih,
};
