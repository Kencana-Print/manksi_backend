const db = require("../../../config/database");

// ─────────────────────────────────────────────
// HELPER: gudang asal (GP001/GP015) sesuai filter cabang
// ─────────────────────────────────────────────
const getGudangAsalList = (cabang) => {
  if (cabang === "P01") return ["GP015"];
  if (cabang === "P04") return ["GP001"];
  return ["GP001", "GP015"];
};

// ─────────────────────────────────────────────
// MASTER — dua mode berbeda struktur query, replikasi persis
// Delphi btnRefreshClick (percabangan cbTanggal.Text).
// ─────────────────────────────────────────────
const getBrowse = async (startDate, endDate, cabang = "ALL", mode = "spk") => {
  const gdgList = getGudangAsalList(cabang);

  if (mode === "lhk") {
    // ── Mode "Tanggal LHK" ──
    // y = per SPK+komponen: babaran aktual - babaran standar, dalam
    // rentang tanggal LHK (mph_tanggal). Minus diambil salah satu
    // row (LIMIT 1) per SPK, sesuai perilaku Delphi (temp table
    // xspk unik tidak dijamin — replikasi apa adanya).
    const sql = `
      SELECT
        s.spk_nomor AS Nomor,
        s.spk_tanggal AS TanggalSpk,
        s.spk_dateline AS Dateline,
        s.spk_cus_kode AS KodeCustomer,
        c.cus_nama AS Customer,
        s.spk_nama AS Nama,
        s.spk_jumlah AS SpkJumlah,
        s.spk_jumlah_jadi AS SpkJumlahJadi,
        s.spk_ukuran AS Ukuran,
        s.spk_tipe AS Tipe,
        s.spk_panjang AS Panjang,
        s.spk_lebar AS Lebar,
        s.spk_gramasi AS Gramasi,
        s.spk_kain AS Kain,
        s.spk_finishing AS Finishing,
        IF(s.spk_jumlah_jadi >= s.spk_jumlah, 'CLOSE',
          IF(s.spk_jumlah_jadi <> 0 AND s.spk_jumlah_jadi < s.spk_jumlah, 'OnProses', 'BELUM')
        ) AS Status,
        IFNULL((
          SELECT y.minus FROM (
            SELECT x.spk, x.babaran - IFNULL(k.spkb_babaran, 0) AS minus
            FROM (
              SELECT h.mph_spk_nomor AS spk, h.mph_komponen AS komponen,
                IFNULL(
                  IF(h.mph_sat_berat = 'KG',
                    SUM(h.mph_jumlah) / NULLIF(SUM(h.mph_qty_berat), 0),
                    SUM(h.mph_qty_berat) / NULLIF(SUM(h.mph_jumlah), 0)
                  ), 0
                ) AS babaran
              FROM tmutasiproduksi_hdr h
              WHERE h.mph_gdgasal IN (?)
                AND h.mph_tanggal >= ? AND h.mph_tanggal <= ?
              GROUP BY h.mph_spk_nomor, h.mph_komponen
            ) x
            LEFT JOIN tspk_babaran k
              ON k.spkb_nomor = x.spk AND k.spkb_komponen = x.komponen
          ) y
          WHERE y.spk = s.spk_nomor
          LIMIT 1
        ), 0) AS Minus
      FROM tspk s
      LEFT JOIN tcustomer c ON c.Cus_kode = s.spk_cus_kode
      WHERE s.spk_aktif = 'Y'
        AND s.spk_nomor IN (
          SELECT h.mph_spk_nomor
          FROM tmutasiproduksi_hdr h
          WHERE h.mph_gdgasal IN (?)
            AND h.mph_tanggal >= ? AND h.mph_tanggal <= ?
          GROUP BY h.mph_spk_nomor, h.mph_komponen
        )
      ORDER BY s.spk_tanggal
    `;

    const [rows] = await db.query(sql, [
      gdgList,
      startDate,
      endDate,
      gdgList,
      startDate,
      endDate,
    ]);
    return rows;
  }

  // ── Mode "Tanggal SPK" (default) ──
  // z hanya berisi SPK+komponen yang babaran aktualnya DI BAWAH
  // standar (x.babaran < spkb_babaran) — sesuai Delphi, minus positif
  // tidak pernah tampil di kolom Minus (selalu 0 kalau bukan negatif).
  const sql = `
    SELECT DISTINCT
      s.spk_nomor AS Nomor,
      s.spk_tanggal AS TanggalSpk,
      s.spk_dateline AS Dateline,
      s.spk_cus_kode AS KodeCustomer,
      c.cus_nama AS Customer,
      s.spk_nama AS Nama,
      s.spk_jumlah AS SpkJumlah,
      s.spk_jumlah_jadi AS SpkJumlahJadi,
      s.spk_ukuran AS Ukuran,
      s.spk_tipe AS Tipe,
      s.spk_panjang AS Panjang,
      s.spk_lebar AS Lebar,
      s.spk_gramasi AS Gramasi,
      s.spk_kain AS Kain,
      s.spk_finishing AS Finishing,
      IF(s.spk_jumlah_jadi >= s.spk_jumlah, 'CLOSE',
        IF(s.spk_jumlah_jadi <> 0 AND s.spk_jumlah_jadi < s.spk_jumlah, 'OnProses', 'BELUM')
      ) AS Status,
      IFNULL(z.minus, 0) AS Minus
    FROM tspk s
    LEFT JOIN tcustomer c ON c.Cus_kode = s.spk_cus_kode
    LEFT JOIN (
      SELECT x.spk, x.babaran - IFNULL(k.spkb_babaran, 0) AS minus
      FROM (
        SELECT h.mph_spk_nomor AS spk, h.mph_komponen AS komponen,
          IF(h.mph_sat_berat = 'KG',
            SUM(h.mph_jumlah) / NULLIF(SUM(h.mph_qty_berat), 0),
            SUM(h.mph_qty_berat) / NULLIF(SUM(h.mph_jumlah), 0)
          ) AS babaran
        FROM tmutasiproduksi_hdr h
        WHERE h.mph_gdgasal IN (?)
        GROUP BY h.mph_spk_nomor, h.mph_komponen
      ) x
      LEFT JOIN tspk_babaran k
        ON k.spkb_nomor = x.spk AND k.spkb_komponen = x.komponen
      WHERE x.babaran < IFNULL(k.spkb_babaran, 0)
    ) z ON z.spk = s.spk_nomor
    WHERE s.spk_divisi IN (3,4,6) AND s.spk_aktif = 'Y'
      AND s.spk_nomor IN (
        SELECT mph_spk_nomor FROM tmutasiproduksi_hdr
        WHERE mph_gdgasal IN (?)
        GROUP BY mph_spk_nomor
      )
      AND s.spk_tanggal >= ? AND s.spk_tanggal <= ?
    ORDER BY s.spk_tanggal
  `;

  const [rows] = await db.query(sql, [gdgList, gdgList, startDate, endDate]);
  return rows;
};

// ─────────────────────────────────────────────
// DETAIL — per satu SPK. Sama untuk kedua mode, bedanya cuma
// posisi filter tanggal (mph_tanggal utk mode LHK, spk_tanggal utk
// mode SPK — sesuai percabangan Delphi).
// ─────────────────────────────────────────────
const getDetail = async (
  nomor,
  startDate,
  endDate,
  cabang = "ALL",
  mode = "spk",
) => {
  const gdgList = getGudangAsalList(cabang);

  const tglLhkFilter =
    mode === "lhk" ? `AND h.mph_tanggal >= ? AND h.mph_tanggal <= ?` : "";
  const tglSpkFilter =
    mode === "spk" ? `AND s.spk_tanggal >= ? AND s.spk_tanggal <= ?` : "";

  const sql = `
    SELECT
      x.Nomor,
      x.Komponen,
      x.BabaranStandar,
      IF(x.sat = 'KG',
        x.JumlahLHK / NULLIF(x.Terpakai, 0),
        x.Terpakai / NULLIF(x.JumlahLHK, 0)
      ) AS BabaranRealisasi,
      (
        IF(x.sat = 'KG', x.JumlahLHK / NULLIF(x.Terpakai, 0), x.Terpakai / NULLIF(x.JumlahLHK, 0))
        - x.BabaranStandar
      ) AS Selisih,
      IFNULL((
        (
          IF(x.sat = 'KG', x.JumlahLHK / NULLIF(x.Terpakai, 0), x.Terpakai / NULLIF(x.JumlahLHK, 0))
          - x.BabaranStandar
        ) / NULLIF(x.BabaranStandar, 0) * 100
      ), 0) AS SelisihPersen,
      x.JumlahMKB,
      x.JumlahLHK,
      x.Terpakai,
      x.Alasan
    FROM (
      SELECT
        h.mph_spk_nomor AS Nomor,
        h.mph_komponen AS Komponen,
        IFNULL(b.spkb_babaran, 0) AS BabaranStandar,
        IFNULL((
          SELECT SUM(dd.mkbd_jumlah)
          FROM tmkb_hdr hh
          LEFT JOIN tmkb_dtl dd ON dd.mkbd_mkb_nomor = hh.MKB_NOMOR
          WHERE hh.MKB_SPK_NOMOR = h.mph_spk_nomor AND dd.mkbd_komponen = h.mph_komponen
          GROUP BY hh.MKB_SPK_NOMOR, dd.mkbd_komponen
        ), 0) AS JumlahMKB,
        SUM(h.mph_jumlah) AS JumlahLHK,
        SUM(h.mph_qty_berat) AS Terpakai,
        h.mph_sat_berat AS sat,
        h.mph_alasan AS Alasan
      FROM tmutasiproduksi_hdr h
      LEFT JOIN tspk_babaran b
        ON b.spkb_nomor = h.mph_spk_nomor AND b.spkb_komponen = h.mph_komponen
      WHERE h.mph_gdgasal IN (?)
        ${tglLhkFilter}
        AND h.mph_spk_nomor IN (
          SELECT s.spk_nomor FROM tspk s
          WHERE s.spk_divisi IN (3,4,6) AND s.spk_aktif = 'Y'
            ${tglSpkFilter}
        )
        AND h.mph_spk_nomor = ?
      GROUP BY h.mph_spk_nomor, h.mph_komponen
    ) x
  `;

  const params = [gdgList];
  if (mode === "lhk") params.push(startDate, endDate);
  if (mode === "spk") params.push(startDate, endDate);
  params.push(nomor);

  const [rows] = await db.query(sql, params);
  return rows;
};

// ─────────────────────────────────────────────
// ALL DETAIL — untuk "Export Detail" (semua SPK sesuai filter
// master saat ini, digabung jadi satu daftar flat).
// ─────────────────────────────────────────────
const getAllDetail = async (
  startDate,
  endDate,
  cabang = "ALL",
  mode = "spk",
) => {
  const master = await getBrowse(startDate, endDate, cabang, mode);

  const result = [];
  for (const s of master) {
    const dtl = await getDetail(s.Nomor, startDate, endDate, cabang, mode);
    for (const d of dtl) {
      result.push({ ...d, Nama: s.Nama, Customer: s.Customer });
    }
  }
  return result;
};

module.exports = {
  getBrowse,
  getDetail,
  getAllDetail,
};
