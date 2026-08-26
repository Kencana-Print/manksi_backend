const db = require("../../config/database");

// ─────────────────────────────────────────────────────────
// GENERATE NOMOR MP — replikasi persis getmaxnomor(). Format
// MP/00001/2026, tahun dari TANGGAL MUTASI (dttanggal = hari ini saat
// approve), BUKAN tanggal SJ aslinya.
// ─────────────────────────────────────────────────────────
const generateMpNomor = async (tanggal, conn) => {
  const tahun = new Date(tanggal).getFullYear().toString();
  const [rows] = await conn.query(
    `SELECT MAX(CAST(MID(mph_nomor, 4, 5) AS UNSIGNED)) AS max_num
     FROM tmutasiproduksi_hdr WHERE RIGHT(mph_nomor, 4) = ?`,
    [tahun],
  );
  const maxNum = rows[0].max_num;
  const nextNum = (maxNum === null ? 0 : Number(maxNum)) + 1;
  return `MP/${String(nextNum).padStart(5, "0")}/${tahun}`;
};

// ─────────────────────────────────────────────────────────
// PROSES SEBELUMNYA — replikasi persis loadprosessebelumnya(). UNION
// tmutasiproduksi_dtl ("Internal") + tbpj_dtl ("Mitra"/outsource),
// dikelompokkan per kode bahan, buat referensi user sebelum konfirmasi
// Jumlah final. agudangmitra default kosong (gak ada call site yang
// keliatan pernah ngisi ini selain default).
// ─────────────────────────────────────────────────────────
const getProsesSebelumnya = async (gudangAsal, nomorSpk, gudangMitra = "") => {
  if (!gudangAsal || !nomorSpk) return [];
  const [rows] = await db.query(
    `SELECT mpd_bhn_kode, mpd_nama, mpd_satuan,
            SUM(mpd_jumlah) AS mpd_jumlah,
            SUM(bpjd_jumlah) AS bpjd_jumlah,
            SUM(mpd_jumlah + bpjd_jumlah) AS total
     FROM (
       SELECT mpd_bhn_kode, mpd_nama, mpd_satuan, SUM(mpd_jumlah) AS mpd_jumlah, 0 AS bpjd_jumlah
       FROM tmutasiproduksi_dtl
       INNER JOIN tmutasiproduksi_hdr ON mpd_mph_nomor = mph_nomor
       WHERE mph_spk_nomor LIKE ? AND mph_gdgasal = ?
       GROUP BY mpd_bhn_kode
       UNION
       SELECT bpjd_bhn_kode AS mpd_bhn_kode, bhn_name AS mpd_nama, bhn_satuan AS mpd_satuan,
              0 AS mpd_jumlah, IFNULL(SUM(bpjd_jumlah), 0) AS bpjd_jumlah
       FROM tbpj_dtl
       INNER JOIN tbpj_hdr ON bpj_nomor = bpjd_bpj_nomor
       INNER JOIN tpojasa_hdr ON pojh_nomor = bpj_po_nomor
       INNER JOIN tjasa ON jasa_kode = pojh_jasa_kode
       INNER JOIN tbahan ON bhn_kode = bpjd_bhn_kode
       WHERE pojh_spk_nomor = ? AND jasa_gdgp_kode = ?
       GROUP BY bpjd_bhn_kode, bhn_name, bhn_satuan
     ) final
     WHERE mpd_nama <> ''
     GROUP BY mpd_bhn_kode, mpd_nama, mpd_satuan`,
    [nomorSpk, gudangAsal, nomorSpk, gudangMitra],
  );
  return rows.map((r) => ({
    kode: r.mpd_bhn_kode,
    nama: r.mpd_nama,
    satuan: r.mpd_satuan,
    mitra: Number(r.bpjd_jumlah) || 0,
    internal: Number(r.mpd_jumlah) || 0,
    total: Number(r.total) || 0,
  }));
};

// ─────────────────────────────────────────────────────────
// GET BY ID — replikasi loaddataall(), TAPI ✅ FIX bug duplikasi
// baris ad-hoc: Delphi loop utama ambil SEMUA poisjd (termasuk
// new='Y'), lalu getnew() nambahin new='Y' LAGI secara terpisah →
// baris ad-hoc bakal muncul dobel. Di sini cuma 1 query bersih, flag
// `new` per baris langsung dari kolom poisjd_new, tanpa duplikasi.
// ✅ FIX union tsalesorder juga diterapkan (bug berulang yang sudah
// kita benerin di modul2 lain).
// ─────────────────────────────────────────────────────────
const getById = async (nomor) => {
  const [hdrRows] = await db.query(
    `SELECT h.poisj_nomor, DATE_FORMAT(h.poisj_tanggal, '%Y-%m-%d') AS poisj_tanggal,
            h.poisj_spk_nomor, h.poisj_gdgasal, h.poisj_gdgtujuan, h.poisj_jumlah,
            IFNULL(so.so_nama, IFNULL(s.spk_nama, m.mspk_nama)) AS namaspk,
            IFNULL(so.so_kain, IFNULL(s.spk_kain, m.mspk_kain)) AS bahan,
            IFNULL(so.so_ukuran, IFNULL(s.spk_ukuran, m.mspk_ukuran)) AS ukuran,
            IFNULL(so.so_jumlah, IFNULL(s.spk_jumlah, m.mspk_jumlah)) AS jumlah,
            o.poi_jasa_kode, j.jasa_nama,
            h.poisj_cab, c.pab_nama AS namacab,
            o.poi_cab, u.pab_nama AS namacus,
            h.poisj_kelompok, h.poisj_ket, h.poisj_cmt,
            h.poisj_sup_kode, h.poisj_supplierkain, h.poisj_nomaterial,
            DATE_FORMAT(a.promin_tanggal, '%Y-%m-%d') AS promin_tanggal,
            h.poisj_bhn_kode, h.poisj_komponen,
            IFNULL(k.spkb_babaran, 0) AS bbrstd,
            h.poisj_alasan,
            IFNULL(n.Bhn_Name, '') AS namakain,
            IFNULL(b.promind_Jumlah, 0) AS jmlkain,
            IFNULL(n.Bhn_satuan, '') AS satkain,
            IFNULL(h.poisj_qty_berat, 0) AS qtyberat,
            IFNULL(h.poisj_sat_berat, '') AS satberat,
            la.gdgp_nama AS liniasalnama,
            lt.gdgp_nama AS linitujuannama
     FROM tpointernalsj_hdr h
     LEFT JOIN tpointernal_hdr o ON o.poi_nomor = h.poisj_nomorpo
     LEFT JOIN tsalesorder so ON so.so_nomor = h.poisj_spk_nomor
     LEFT JOIN tspk s ON s.spk_nomor = h.poisj_spk_nomor
     LEFT JOIN tmemospk m ON m.mspk_nomor = h.poisj_spk_nomor
     LEFT JOIN tproduksiminta_hdr a ON a.promin_nomor = h.poisj_nomaterial
     LEFT JOIN tproduksiminta_dtl b ON b.promind_promin_Nomor = a.promin_nomor AND b.promind_bhn_kode = h.poisj_bhn_kode
     LEFT JOIN tjasa j ON j.jasa_kode = o.poi_jasa_kode
     LEFT JOIN tpabrik c ON c.pab_kode = h.poisj_cab
     LEFT JOIN tpabrik u ON u.pab_kode = o.poi_cab
     LEFT JOIN tbahan n ON n.Bhn_kode = h.poisj_bhn_kode
     LEFT JOIN tspk_babaran k ON k.spkb_nomor = h.poisj_spk_nomor AND k.spkb_komponen = h.poisj_komponen
     LEFT JOIN tgudangproduksi la ON la.gdgp_kode = h.poisj_gdgasal
     LEFT JOIN tgudangproduksi lt ON lt.gdgp_kode = h.poisj_gdgtujuan
     WHERE h.poisj_nomor = ?`,
    [nomor],
  );
  if (hdrRows.length === 0) {
    throw new Error("Nomor Mutasi produksi tidak di temukan");
  }
  const h = hdrRows[0];

  // ⚠️ Replikasi persis pos(...,'GP001-GP015') Delphi: satBerat cuma
  // diisi otomatis dari satkain kalau Lini Asal termasuk GP001/GP015.
  let satBerat = "";
  if (["GP001", "GP015"].includes(h.poisj_gdgasal)) {
    satBerat = h.satkain === "KG" ? h.satkain : "MTR";
  }

  const [dtlRows] = await db.query(
    `SELECT d.poisjd_bhn_kode, b.Bhn_Name, b.Bhn_satuan, d.poisjd_size,
            d.poisjd_jumlah, d.poisjd_bs, d.poisjd_sablon, d.poisjd_kain, d.poisjd_new
     FROM tpointernalsj_dtl d
     LEFT JOIN tbahan b ON b.Bhn_kode = d.poisjd_bhn_kode
     WHERE d.poisjd_nomor = ?
     ORDER BY d.poisjd_bhn_kode`,
    [nomor],
  );
  const detail = dtlRows.map((d) => ({
    kode: d.poisjd_bhn_kode,
    nama: d.Bhn_Name,
    satuan: d.Bhn_satuan,
    size: d.poisjd_size,
    // "Jumlah" (editable) & "Sudah"/LHK (readonly, beku) — default
    // sama-sama dari poisjd_jumlah, persis floats[4]=floats[5] di
    // Delphi saat pertama kali di-load.
    jumlah: Number(d.poisjd_jumlah) || 0,
    sudah: Number(d.poisjd_jumlah) || 0,
    bsLini: Number(d.poisjd_bs) || 0,
    bsSablon: Number(d.poisjd_sablon) || 0,
    bsKain: Number(d.poisjd_kain) || 0,
    new: d.poisjd_new === "Y",
  }));

  const prosesSebelumnya = await getProsesSebelumnya(
    h.poisj_gdgasal,
    h.poisj_spk_nomor,
  );

  return {
    header: {
      NomorSJ: h.poisj_nomor,
      Tanggal: h.poisj_tanggal,
      NomorSPK: h.poisj_spk_nomor,
      NamaSPK: h.namaspk,
      Bahan: h.bahan,
      Ukuran: h.ukuran,
      Jumlah: h.jumlah,
      Keterangan: h.poisj_ket,
      GudangAsalKode: h.poisj_cab,
      GudangAsalNama: h.namacab,
      GudangTujuanKode: h.poi_cab,
      GudangTujuanNama: h.namacus,
      JasaKode: h.poi_jasa_kode,
      JasaNama: h.jasa_nama,
      LiniAsal: h.poisj_gdgasal,
      LiniAsalNama: h.liniasalnama || "",
      LiniTujuan: h.poisj_gdgtujuan,
      LiniTujuanNama: h.linitujuannama || "",
      JumlahJasa: Number(h.poisj_jumlah) || 0,
      Kelompok: h.poisj_kelompok,
      Cmt: h.poisj_cmt === "Y",
      SupKode: h.poisj_sup_kode,
      SupplierKain: h.poisj_supplierkain,
      NoMaterial: h.poisj_nomaterial,
      TanggalMinta: h.promin_tanggal,
      KodeKain: h.poisj_bhn_kode,
      NamaKain: h.namakain,
      SatKain: h.satkain,
      JmlKain: Number(h.jmlkain) || 0,
      QtyBerat: Number(h.qtyberat) || 0,
      SatBerat: satBerat,
      Komponen: h.poisj_komponen,
      BabaranStd: Number(h.bbrstd) || 0,
      Alasan: h.poisj_alasan,
    },
    detail,
    prosesSebelumnya,
  };
};

// ─────────────────────────────────────────────────────────
// SAVE APPROVE — replikasi persis simpandata(). Kalau CMT dicentang,
// SKIP total pembuatan Mutasi Produksi (cuma tandai SJ approved).
// Kalau tidak, generate MP baru + insert detail (baris cuma disimpan
// kalau kode terisi DAN total sudah+jumlah+bsLini+bsSablon+bsKain<>0
// — persis kondisi j<>0 di Delphi). mpd_jumlah_jahit SELALU 0 (kolom
// mati, gak pernah ditampilkan/diedit di UI form ini).
// ─────────────────────────────────────────────────────────
const saveApprove = async (nomorSj, payload, user) => {
  // Re-validasi gate — defense in depth, walau browse sudah cek
  // checkApprovable sebelum modal dibuka (race condition tetap mungkin).
  const [hdrCheck] = await db.query(
    `SELECT poisj_approve FROM tpointernalsj_hdr WHERE poisj_nomor = ?`,
    [nomorSj],
  );
  if (hdrCheck.length === 0) throw new Error("Data tidak ditemukan.");
  if (hdrCheck[0].poisj_approve === "Y") throw new Error("Sudah Approve.");
  const [mpCheck] = await db.query(
    `SELECT 1 FROM tmutasiproduksi_hdr WHERE mph_nomor_opr = ? LIMIT 1`,
    [nomorSj],
  );
  if (mpCheck.length > 0) throw new Error("Sudah Approve.");

  const {
    tanggal,
    keterangan,
    nomorSpk,
    cab,
    jumlahJasa,
    liniAsal,
    liniTujuan,
    kelompok,
    supplierKain,
    noMaterial,
    kodeKain,
    supKode,
    qtyBerat,
    satBerat,
    komponen,
    alasan,
    cmt,
    detail = [],
  } = payload;

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    let mpNomor = null;
    const now = new Date();
    const dateNow =
      now.getFullYear() +
      "-" +
      String(now.getMonth() + 1).padStart(2, "0") +
      "-" +
      String(now.getDate()).padStart(2, "0") +
      " " +
      String(now.getHours()).padStart(2, "0") +
      ":" +
      String(now.getMinutes()).padStart(2, "0") +
      ":" +
      String(now.getSeconds()).padStart(2, "0");

    if (!cmt) {
      mpNomor = await generateMpNomor(tanggal, conn);

      await conn.query(
        `INSERT INTO tmutasiproduksi_hdr
           (MPH_nomor, mph_nomor_opr, MPH_tanggal, MPH_keterangan, MPH_SPK_nomor, mph_cab,
            MPH_jumlah, mph_gdgasal, mph_gdgtujuan, mph_kelompok, mph_supplierkain,
            mph_nomaterial, mph_bhn_kode, mph_sup_kode, mph_qty_berat, mph_sat_berat,
            mph_komponen, mph_alasan, date_create, user_create)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          mpNomor,
          nomorSj,
          tanggal,
          keterangan || "",
          nomorSpk,
          cab,
          Number(jumlahJasa) || 0,
          liniAsal,
          liniTujuan,
          kelompok || "",
          supplierKain || "",
          noMaterial || "",
          kodeKain || "",
          supKode || "",
          Number(qtyBerat) || 0,
          satBerat || "",
          komponen || "",
          alasan || "",
          dateNow,
          user.kode,
        ],
      );

      for (const d of detail) {
        const jTotal =
          (Number(d.sudah) || 0) +
          (Number(d.jumlah) || 0) +
          (Number(d.bsLini) || 0) +
          (Number(d.bsSablon) || 0) +
          (Number(d.bsKain) || 0);
        if (!d.kode || jTotal === 0) continue;

        await conn.query(
          `INSERT INTO tmutasiproduksi_dtl
             (MPD_MPH_nomor, mpd_bhn_kode, MPD_NAMA, MPD_satuan, mpd_lhk, mpd_jumlah,
              mpd_jumlah_bs, mpd_jumlah_sablon, mpd_jumlah_kain, mpd_jumlah_jahit,
              mpd_size, mpd_spk, mpd_gdgp_asal)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            mpNomor,
            d.kode,
            d.nama,
            d.satuan,
            Number(d.sudah) || 0,
            Number(d.jumlah) || 0,
            Number(d.bsLini) || 0,
            Number(d.bsSablon) || 0,
            Number(d.bsKain) || 0,
            0, // mpd_jumlah_jahit — kolom mati, gak pernah ditampilkan/diedit di form ini
            d.size || "",
            nomorSpk,
            liniAsal,
          ],
        );
      }
    }

    await conn.query(
      `UPDATE tpointernalsj_hdr SET poisj_approve = 'Y' WHERE poisj_nomor = ?`,
      [nomorSj],
    );

    await conn.commit();
    return { mpNomor };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
};

// ─────────────────────────────────────────────────────────
// GET DATA CETAK (slip MP) — ⚠️ Delphi pakai TTSReport (native report
// generator) + macro GetCompanyLineSQL yang gak portable ke web. Ini
// versi modern: query bersih sendiri (dengan fix union tsalesorder),
// bukan port literal dari doslipPO. Detail tampilan print masih perlu
// dirancang di sesi frontend nanti.
// ─────────────────────────────────────────────────────────
const getPrintData = async (mpNomor) => {
  const [rows] = await db.query(
    `SELECT a.mph_nomor, DATE_FORMAT(a.mph_tanggal, '%Y-%m-%d') AS mph_tanggal,
            a.mph_nomor_opr, a.mph_keterangan, a.mph_spk_nomor, a.mph_cab,
            a.mph_jumlah, a.mph_gdgasal, x.gdgp_nama AS namagdgtujuan,
            a.mph_gdgtujuan, y.gdgp_nama AS namagdgasal,
            IFNULL(so.so_nama, IFNULL(s.spk_nama, m.mspk_nama)) AS namaspk,
            b.mpd_bhn_kode, b.mpd_nama, b.mpd_satuan, b.mpd_lhk, b.mpd_jumlah,
            b.mpd_jumlah_bs, b.mpd_jumlah_sablon, b.mpd_jumlah_kain, b.mpd_size
     FROM tmutasiproduksi_hdr a
     LEFT JOIN tmutasiproduksi_dtl b ON a.mph_nomor = b.mpd_mph_nomor
     LEFT JOIN tsalesorder so ON so.so_nomor = a.mph_spk_nomor
     LEFT JOIN tspk s ON s.spk_nomor = a.mph_spk_nomor
     LEFT JOIN tmemospk m ON m.mspk_nomor = a.mph_spk_nomor
     LEFT JOIN tgudangproduksi x ON x.gdgp_kode = a.mph_gdgtujuan
     LEFT JOIN tgudangproduksi y ON y.gdgp_kode = a.mph_gdgasal
     WHERE a.mph_nomor = ?`,
    [mpNomor],
  );
  if (rows.length === 0) throw new Error("Data cetak tidak ditemukan.");

  const header = {
    Nomor: rows[0].mph_nomor,
    Tanggal: rows[0].mph_tanggal,
    NomorSJ: rows[0].mph_nomor_opr,
    Keterangan: rows[0].mph_keterangan,
    NomorSPK: rows[0].mph_spk_nomor,
    NamaSPK: rows[0].namaspk,
    Cab: rows[0].mph_cab,
    Jumlah: rows[0].mph_jumlah,
    GudangAsal: rows[0].mph_gdgasal,
    NamaGudangAsal: rows[0].namagdgasal,
    GudangTujuan: rows[0].mph_gdgtujuan,
    NamaGudangTujuan: rows[0].namagdgtujuan,
  };

  const detail = rows
    .filter((r) => r.mpd_bhn_kode)
    .map((r) => ({
      Kode: r.mpd_bhn_kode,
      Nama: r.mpd_nama,
      Satuan: r.mpd_satuan,
      Lhk: r.mpd_lhk,
      Jumlah: r.mpd_jumlah,
      BsLini: r.mpd_jumlah_bs,
      BsSablon: r.mpd_jumlah_sablon,
      BsKain: r.mpd_jumlah_kain,
      Size: r.mpd_size,
    }));

  return { header, detail };
};

module.exports = {
  getById,
  saveApprove,
  getPrintData,
};
