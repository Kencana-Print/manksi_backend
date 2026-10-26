// Helper absensi fingerprint HRD (sesi Pagi/Siang) untuk LHK
const SESI_VALID = ["PAGI", "SIANG"];
const BATAS_SIANG = 13 * 3600; // 13:00

// TIME dari fingerprint: NULL atau 00:00:00 = belum scan
const detik = (t) => {
  const m = /^(\d{2}):(\d{2})(?::(\d{2}))?/.exec(String(t ?? ""));
  if (!m) {
    return null;
  }
  const s = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3] ?? 0);
  return s === 0 ? null : s;
};

const selisihMenit = (dari, sampai) =>
  Math.max(0, Math.floor((sampai - dari) / 60));

const fmtJam = (menit) => {
  const m = Math.max(0, Number(menit) || 0);
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};

// null = tidak memenuhi syarat sesi
const hitungJam = (sesi, row, detikAkhirPagi) => {
  const s1 = detik(row.scan1);
  const s2 = detik(row.scan2);
  if (s1 === null) {
    return null;
  }
  if (sesi === "PAGI") {
    if (s2 !== null) {
      return null;
    }
    return { kerja: selisihMenit(s1, detikAkhirPagi) };
  }
  if (s2 === null) {
    return null;
  }
  return { kerja: selisihMenit(Math.max(BATAS_SIANG, s1), s2) };
};

const sekarangServer = async (q) => {
  const [r] = await q.query(
    `SELECT DATE_FORMAT(CURDATE(), '%Y-%m-%d') AS tgl,
            TIME_FORMAT(CURTIME(), '%H:%i:%s') AS jam`,
  );
  return { tgl: r[0].tgl, jam: r[0].jam };
};

// Karyawan aktif bagian tertentu di lokasi yang punya absensi pada tanggal tsb
const ambilAbsensi = async (
  q,
  { tabelKaryawan, bagian, tanggal, pabrik, niks = null },
) => {
  const params = [tanggal, `%${bagian}%`, pabrik];
  let filterNik = "";
  if (niks) {
    filterNik = "AND k.kar_nik IN (?)";
    params.push(niks);
  }
  const [rows] = await q.query(
    `SELECT k.kar_nik AS nik, k.kar_nama AS nama, a.scan1, a.scan2
     FROM ${tabelKaryawan} k
     JOIN hrd2.tabsensi a
       ON a.nik = k.kar_kode_absensi AND a.tanggal = ?
     WHERE k.kar_bagian LIKE ?
       AND k.kar_status_aktif = 1
       AND k.kar_pab_kode = ?
       AND k.kar_kode_absensi <> ''
       ${filterNik}`,
    params,
  );
  return rows;
};

module.exports = {
  SESI_VALID,
  BATAS_SIANG,
  detik,
  fmtJam,
  hitungJam,
  sekarangServer,
  ambilAbsensi,
};
