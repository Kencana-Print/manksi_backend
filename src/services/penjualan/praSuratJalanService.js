const db = require("../../config/database");
const { generateNomor } = require("./suratJalanFormService");

// ═══════════════════════════════════════════════════════════
// PRA SURAT JALAN — SERVICE
// Migrasi dari ufrmBrowsePraSJ.pas (Delphi)
// CATATAN: modul ini TIDAK punya konsep tutup buku/PIN5 sama sekali —
// murni alat staging sebelum SJ resmi dibuat.
// ═══════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────
// BROWSE — Sesuai Delphi btnRefreshClick (SQLMaster)
// ─────────────────────────────────────────────────────────
const getBrowse = async (tglAwal, tglAkhir) => {
  const [rows] = await db.query(
    `SELECT
       h.sj_pra                                       AS PraSJ,
       DATE_FORMAT(h.sj_tanggal,'%Y-%m-%d')            AS Tanggal,
       h.sj_sj                                          AS NomorSJ,
       DATE_FORMAT(j.sj_tanggal,'%Y-%m-%d')            AS TglSJ,
       v.divisi                                         AS Divisi,
       h.sj_cus_kode                                    AS KdCus,
       c.cus_nama                                       AS Customer,
       h.sj_alamat_customer                             AS Alamat,
       h.sj_kota_customer                               AS Kota,
       h.sj_keterangan                                  AS Keterangan,
       g.gdg_nama                                       AS Gudang,
       SUM(d.sjd_jumlah)                                AS QtyKirim
     FROM tprasj_hdr h
     INNER JOIN tprasj_dtl d ON d.sjd_pra = h.sj_pra
     LEFT JOIN tsj_hdr j ON j.sj_nomor = h.sj_sj
     LEFT JOIN tgudang g ON g.gdg_kode = h.sj_gdg_kode
     LEFT JOIN tcustomer c ON c.cus_kode = h.sj_cus_kode
     LEFT JOIN tdivisi v ON v.kode = h.sj_divisi
     WHERE h.sj_tanggal >= ? AND h.sj_tanggal <= ?
     GROUP BY h.sj_pra
     ORDER BY h.sj_tanggal, h.sj_pra`,
    [tglAwal, tglAkhir],
  );
  return rows;
};

// ─────────────────────────────────────────────────────────
// BROWSE DETAIL — Sesuai Delphi btnRefreshClick (SQLDetail)
// ─────────────────────────────────────────────────────────
const getBrowseDetail = async (tglAwal, tglAkhir, praSj = "") => {
  let where = `h.sj_tanggal >= ? AND h.sj_tanggal <= ?`;
  const params = [tglAwal, tglAkhir];

  if (praSj) {
    where += ` AND d.sjd_pra = ?`;
    params.push(praSj);
  }

  const [rows] = await db.query(
    `SELECT
       d.sjd_pra        AS PraSJ,
       d.sjd_spk_nomor  AS SPK,
       s.spk_nama       AS Nama,
       d.sjd_ukuran     AS Ukuran,
       s.spk_panjang    AS Panjang,
       s.spk_lebar      AS Lebar,
       d.sjd_jumlah     AS Jumlah,
       d.sjd_keterangan AS Keterangan
     FROM tprasj_hdr h
     INNER JOIN tprasj_dtl d ON d.sjd_pra = h.sj_pra
     INNER JOIN tspk s ON s.spk_nomor = d.sjd_spk_nomor
     WHERE ${where}
     ORDER BY d.sjd_pra, d.sjd_nourut`,
    params,
  );
  return rows;
};

// ─────────────────────────────────────────────────────────
// CEK BISA UBAH — Sesuai Delphi cxButton1Click
// ─────────────────────────────────────────────────────────
const cekBisaUbah = async (praSj) => {
  const [[row]] = await db.query(
    `SELECT sj_pra, sj_sj FROM tprasj_hdr WHERE sj_pra = ?`,
    [praSj],
  );
  if (!row) throw new Error("Data tidak ditemukan.");

  if (row.sj_sj) {
    return {
      bisa: false,
      reason: "Sudah jadi Surat jalan.\nTidak bisa diUbah.",
    };
  }
  return { bisa: true, reason: null };
};

// ─────────────────────────────────────────────────────────
// CEK BISA HAPUS — Sesuai Delphi cxButton4Click
// CATATAN: tidak ada cek tutup buku sama sekali di Delphi untuk modul ini.
// ─────────────────────────────────────────────────────────
const cekBisaHapus = async (praSj) => {
  const [[row]] = await db.query(
    `SELECT sj_pra, sj_sj FROM tprasj_hdr WHERE sj_pra = ?`,
    [praSj],
  );
  if (!row) throw new Error("Data tidak ditemukan.");

  if (row.sj_sj) {
    return {
      bisaHapus: false,
      reason: "Sudah jadi Surat jalan.\nTidak bisa dihapus.",
    };
  }
  return { bisaHapus: true, reason: null };
};

// ─────────────────────────────────────────────────────────
// DELETE — Sesuai Delphi cxButton4Click
// CATATAN: Delphi hanya delete tprasj_hdr, tidak eksplisit delete
// tprasj_dtl (potensi orphan row kalau tidak ada FK cascade di DB).
// Diikuti apa adanya.
// ─────────────────────────────────────────────────────────
const deleteData = async (praSj) => {
  await db.query(`DELETE FROM tprasj_hdr WHERE sj_pra = ?`, [praSj]);
};

// ─────────────────────────────────────────────────────────
// EXPORT
// ─────────────────────────────────────────────────────────
const getExportData = async (tglAwal, tglAkhir) => getBrowse(tglAwal, tglAkhir);
const getExportDetail = async (tglAwal, tglAkhir) =>
  getBrowseDetail(tglAwal, tglAkhir);

// ─────────────────────────────────────────────────────────
// LIST UNTUK CREATE SJ — Pra SJ yang belum jadi SJ (sj_sj kosong)
// Sesuai Delphi ufrmPraSJ2.btnRefreshClick — TIDAK ada filter tanggal,
// beda dari getBrowse (yang punya filter tanggal + GROUP BY qty).
// ─────────────────────────────────────────────────────────
const getListForCreateSj = async () => {
  const [rows] = await db.query(
    `SELECT
       v.divisi                                      AS Divisi,
       h.sj_pra                                       AS Nomor,
       DATE_FORMAT(h.sj_tanggal,'%Y-%m-%d')           AS Tanggal,
       g.gdg_nama                                     AS Gudang,
       h.sj_gdg_kode                                  AS KodeGdg,
       h.sj_cus_kode                                  AS KdCus,
       c.cus_nama                                     AS Nama,
       c.cus_alamat                                   AS Alamat,
       c.cus_kota                                     AS Kota
     FROM tprasj_hdr h
     INNER JOIN tgudang g ON g.gdg_kode = h.sj_gdg_kode
     LEFT JOIN tcustomer c ON c.cus_kode = h.sj_cus_kode
     LEFT JOIN tdivisi v ON v.kode = h.sj_divisi
     WHERE h.sj_sj = ''
     ORDER BY h.sj_tanggal`,
  );
  return rows;
};

// ─────────────────────────────────────────────────────────
// CONVERT KE SJ (bulk) — sesuai Delphi ufrmPraSJ2.btnCreateClick
// Untuk tiap Pra SJ yang dicentang:
//   1. Generate nomor SJ baru (reuse generateNomor dari suratJalanFormService)
//   2. Insert tsj_hdr — tanggal = tanggal BARU dari dialog ini, BUKAN
//      tanggal Pra SJ aslinya
//   3. Kalau perusahaan asal BUKAN 'KP', bikin SJ bayangan otomatis
//      kedua di bawah 'KP' (sj_status_otomatis=1, sj_cus_kode diisi
//      kode perusahaan asal, sj_keterangan diisi nomor SJ utama)
//   4. Copy semua tprasj_dtl -> tsj_dtl (dan ke SJ bayangan KP juga)
//   5. Tandai tprasj_hdr.sj_sj = nomor SJ baru
//
// DEVIASI: dibungkus transaksi DB beneran (Delphi tidak — komentar
// //xRollback/xCommit menunjukkan ini bug laten, bisa nyisain data
// setengah-jadi kalau ada baris gagal di tengah). Baris yang ternyata
// sudah punya sj_sj (race condition) di-skip dengan pesan per-baris,
// bukan gagalkan seluruh batch — defensif, tidak ada di Delphi asli.
// ─────────────────────────────────────────────────────────
const convertToSj = async (tanggal, praSjList, userKode) => {
  if (!praSjList || !praSjList.length) {
    throw new Error(
      "Tidak ada data yang akan di approval.\nSilahkan di refresh dulu.",
    );
  }

  const conn = await db.getConnection();
  const results = [];

  try {
    await conn.beginTransaction();

    for (const praSj of praSjList) {
      const [[hdr]] = await conn.query(
        `SELECT * FROM tprasj_hdr WHERE sj_pra = ? FOR UPDATE`,
        [praSj],
      );
      if (!hdr) {
        results.push({
          praSj,
          success: false,
          message: "Data tidak ditemukan.",
        });
        continue;
      }
      if (hdr.sj_sj) {
        results.push({
          praSj,
          success: false,
          message: `Sudah jadi Surat Jalan sebelumnya (${hdr.sj_sj}).`,
        });
        continue;
      }

      const [detailRows] = await conn.query(
        `SELECT * FROM tprasj_dtl WHERE sjd_pra = ? ORDER BY sjd_nourut`,
        [praSj],
      );

      const sjNomor = await generateNomor(hdr.sj_perush_kode, tanggal, conn);

      await conn.query(
        `INSERT INTO tsj_hdr
           (sj_nomor, sj_divisi, sj_tanggal, sj_keterangan,
            sj_perush_kode, sj_cus_kode, sj_gdg_kode,
            sj_alamat_customer, sj_kota_customer, date_create, user_create)
         VALUES (?,?,?,?,?,?,?,?,?,NOW(),?)`,
        [
          sjNomor,
          hdr.sj_divisi,
          tanggal,
          hdr.sj_keterangan,
          hdr.sj_perush_kode,
          hdr.sj_cus_kode,
          hdr.sj_gdg_kode,
          hdr.sj_alamat_customer,
          hdr.sj_kota_customer,
          userKode,
        ],
      );

      const isKP = hdr.sj_perush_kode === "KP";
      let sjNomorKP = null;

      if (!isKP) {
        sjNomorKP = await generateNomor("KP", tanggal, conn);
        await conn.query(
          `INSERT INTO tsj_hdr
             (sj_nomor, sj_divisi, sj_tanggal, sj_keterangan,
              sj_perush_kode, sj_cus_kode, sj_gdg_kode,
              sj_status_otomatis, date_create, user_create)
           VALUES (?,?,?,?,?,?,?,1,NOW(),?)`,
          [
            sjNomorKP,
            hdr.sj_divisi,
            tanggal,
            sjNomor,
            "KP",
            hdr.sj_perush_kode,
            hdr.sj_gdg_kode,
            userKode,
          ],
        );
      }

      for (const d of detailRows) {
        await conn.query(
          `INSERT INTO tsj_dtl
             (sjd_sj_nomor, sjd_spk_nomor, sjd_jumlah, sjd_koli, sjd_ukuran, sjd_keterangan, sjd_nourut)
           VALUES (?,?,?,?,?,?,?)`,
          [
            sjNomor,
            d.sjd_spk_nomor,
            d.sjd_jumlah,
            d.sjd_koli,
            d.sjd_ukuran,
            d.sjd_keterangan,
            d.sjd_nourut,
          ],
        );
        if (!isKP) {
          await conn.query(
            `INSERT INTO tsj_dtl
               (sjd_sj_nomor, sjd_spk_nomor, sjd_jumlah, sjd_koli, sjd_ukuran, sjd_keterangan, sjd_nourut)
             VALUES (?,?,?,?,?,?,?)`,
            [
              sjNomorKP,
              d.sjd_spk_nomor,
              d.sjd_jumlah,
              d.sjd_koli,
              d.sjd_ukuran,
              d.sjd_keterangan,
              d.sjd_nourut,
            ],
          );
        }
      }

      await conn.query(`UPDATE tprasj_hdr SET sj_sj = ? WHERE sj_pra = ?`, [
        sjNomor,
        praSj,
      ]);

      results.push({ praSj, success: true, sjNomor, sjNomorKP });
    }

    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  const successCount = results.filter((r) => r.success).length;
  return { successCount, results };
};

module.exports = {
  getBrowse,
  getBrowseDetail,
  cekBisaUbah,
  cekBisaHapus,
  deleteData,
  getExportData,
  getExportDetail,
  getListForCreateSj,
  convertToSj,
};
