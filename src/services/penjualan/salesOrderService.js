const db = require("../../config/database");
const tutupBukuService = require("../tutupBukuService");

// ============================================================
// HELPER: cari lokasi fisik SO — "new" (tsalesorder) atau
// "legacy" (tspk, data lama pre-migrasi). Dipakai oleh semua
// fungsi tulis (delete/close/pin/approve) supaya tau harus
// UPDATE/DELETE ke tabel yang mana.
// ============================================================
const resolveSoLocation = async (nomor) => {
  const [rows] = await db.query(
    `SELECT 'new' AS src FROM tsalesorder WHERE so_nomor = ?
     UNION ALL
     SELECT 'legacy' AS src FROM tspk WHERE spk_nomor = ? AND spk_is_so = 1
     LIMIT 1`,
    [nomor, nomor],
  );
  return rows[0]?.src || null;
};

const isValidDateStr = (s) => {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s);
  if (isNaN(d.getTime())) return false;
  const year = Number(s.substring(0, 4));
  return year >= 2000 && year <= 2100; // sesuaikan batas wajar bisnis
};

// --- GET BROWSE LIST ---
// Sumber "s" adalah UNION ALL: SO lama (tspk, spk_is_so=1) + SO baru
// (tsalesorder), kolom di-alias supaya namanya identik dengan tspk
// asli — sehingga seluruh JOIN & SELECT di bawah TIDAK perlu diubah.
const getBrowseList = async (filters) => {
  const {
    startDate,
    endDate,
    workshop,
    customer,
    userCabang,
    userKode,
    userDivisi,
    userBagian,
    isCmo,
    isCmo3,
    canLihatCus,
    canLihatHarga,
  } = filters;

  if (!isValidDateStr(startDate) || !isValidDateStr(endDate)) {
    throw new Error("Rentang tanggal tidak valid.");
  }
  if (new Date(startDate) > new Date(endDate)) {
    throw new Error("Tanggal awal tidak boleh lebih besar dari tanggal akhir.");
  }

  // ⚡ OPTIMASI: startDate dipakai juga sebagai lower-bound filter untuk
  // subquery agregat sjChk/mp/bpj — supaya MySQL tidak scan SELURUH
  // histori tsj_dtl/tmutasiproduksi_dtl/tbpj_dtl, cukup baris yang
  // tanggalnya >= awal periode laporan. Aman selama aktivitas
  // produksi/pengiriman untuk sebuah SPK/SO selalu terjadi PADA ATAU
  // SETELAH tanggal SPK/SO itu sendiri (sudah >= startDate karena
  // SPK/SO-nya sendiri difilter begitu di UNION di bawah). ⚠️ Perlu
  // diverifikasi dulu terhadap data riil sebelum dianggap final — lihat
  // query pembanding di komentar service ini / dokumentasi terkait.
  let params = [
    startDate,
    endDate,
    startDate,
    endDate, // UNION tspk + tsalesorder (tidak berubah)
    startDate, // sjChk: tsj_hdr.sj_tanggal >= ?
    startDate, // mp: tmutasiproduksi_hdr.mph_tanggal >= ?
    startDate, // bpj: tbpj_hdr.bpj_tanggal >= ?
  ];

  let whereClause = `WHERE 1=1`;

  if (workshop && workshop !== "ALL" && workshop !== "") {
    whereClause += ` AND y.spk_cab = ?`;
    params.push(workshop);
  }
  if (customer) {
    whereClause += ` AND y.spk_cus_kode = ?`;
    params.push(customer);
  }

  if (
    userCabang &&
    userCabang !== "HO-" &&
    userCabang !== "ADMIN" &&
    userCabang !== "" &&
    userKode !== "DINDUN" &&
    userKode !== "ANTA"
  ) {
    const isCmoDivisi3 =
      ["LUTFI", "ESTU"].includes(userKode) ||
      (String(userDivisi) === "3" && (isCmo || isCmo3))
        ? 1
        : 0;
    const isGudang = (userBagian || "").toUpperCase() === "GUDANG";
    const isDonaExtraCab = userKode === "DONADONG" ? 1 : 0;

    if (isGudang) {
      whereClause += ` AND (y.spk_cab = ? OR y.spk_cab = "" OR y.spk_cab IS NULL OR y.user_create = ? OR (LEFT(y.spk_divisi, 1) = '3' AND ? = 1) OR y.spk_cab IN ('P01','P04') OR (y.spk_cab = 'P05' AND ? = 1))`;
    } else {
      whereClause += ` AND (y.spk_cab = ? OR y.spk_cab = "" OR y.spk_cab IS NULL OR y.user_create = ? OR (LEFT(y.spk_divisi, 1) = '3' AND ? = 1) OR (y.spk_cab = 'P05' AND ? = 1))`;
    }
    params.push(userCabang, userKode || "", isCmoDivisi3, isDonaExtraCab);
  }

  const custNameCol = canLihatCus
    ? "c.cus_nama AS Customer,"
    : "NULL AS Customer,";
  const groupCusCol = canLihatCus
    ? 'IFNULL(c1.cus_nama, "") AS GroupCustomer,'
    : "NULL AS GroupCustomer,";
  const hargaCol = canLihatHarga ? "y.spk_harga AS Harga," : "NULL AS Harga,";

  const query = `
    SELECT x.*,
      (x.Potong0 + x.Potong1) AS Potong,
      (x.QcPotong0 + x.QcPotong1) AS QcPotong,
      (IF(x.titik=0, 0, ROUND(x.Bordir0/x.titik) + ROUND(x.Bordir1/x.titik))) AS Bordir,
      (x.Cetak0 + x.Cetak1 + x.ctk1 + x.ctkm) AS Cetak,
      (x.QcCetak0 + x.QcCetak1) AS QcCetak,
      (x.dc0 + x.dc1) AS DC,
      (x.Jahit0 + x.Jahit1 + x.jht1) AS Jahit,
      (x.lipat0 + x.lipat1 + x.lpt1) AS Lipat,
      (x.Pesan - x.Jadi) AS Kurang_Jadi,
      (x.Pesan - (x.Potong0 + x.Potong1)) AS Kurang_Potong,
      (x.Pesan - (IF(x.titik=0, 0, ROUND(x.Bordir0/x.titik) + ROUND(x.Bordir1/x.titik)))) AS Kurang_Bordir,
      (x.Pesan - (x.Cetak0 + x.Cetak1 + x.ctk1 + x.ctkm)) AS Kurang_Cetak,
      (x.Pesan - (x.QcCetak0 + x.QcCetak1)) AS Kurang_QcCetak,
      (x.Pesan - (x.Jahit0 + x.Jahit1 + x.jht1)) AS Kurang_Jahit,
      (x.Pesan - (x.Lipat0 + x.Lipat1 + x.lpt1)) AS Kurang_Lipat
    FROM (
      SELECT
        y.spk_nomor AS Nomor, y.user_create AS MO, y.spk_cmo AS CMO,
        y.spk_cmo_tanggal AS TglApproveCmo,
        y.spk_tanggal AS Tanggal, y.spk_dateline AS Dateline,
        y.spk_statuskerja AS Kepentingan, v.divisi AS Divisi,
        y.spk_cus_kode AS KodeCustomer, ${custNameCol}
        y.spk_nama AS Nama, y.spk_ukuran AS Ukuran,
        y.spk_cab AS Cab, TRIM(y.spk_workshop) AS Workshop,
        y.spk_pending AS Pending, y.spk_ketpending AS KetPending,
        y.spk_tipe AS Tipe, y.spk_panjang AS Panjang,
        y.spk_lebar AS Lebar, y.spk_gramasi AS Gramasi,
        y.spk_kain AS Kain, y.spk_finishing AS Finishing,
        ${hargaCol}
        y.date_create AS Created, y.spk_jumlah AS Pesan,
        IF(y.spk_jumlah_kirim > 0, y.spk_jumlah_kirim, IFNULL(ppic.spk_jumlah_kirim, 0)) AS Kirim,
        (y.spk_jumlah - IF(y.spk_jumlah_kirim > 0, y.spk_jumlah_kirim, IFNULL(ppic.spk_jumlah_kirim, 0))) AS Kurang,
        sl.sal_nama AS Sales, ${groupCusCol}
        y.spk_nomor_po AS PO, y.spk_ketpo AS KetPO,
        y.spk_tgl_po AS DatePO, y.spk_DatelinePO AS DatelinePO,
        IF(y.spk_close=1 OR IFNULL(ppic.spk_close, 0)=1, 
          IF(ppic.spk_nomor IS NOT NULL, "Closed (PPIC)", "Closed"), 
          "Open") AS Status,
        y.spk_close_alasan AS AlasanClose, y.spk_pen_nomor AS NoPenawaran,
        y.spk_memo AS MAP, y.spk_repeat AS 'Repeat', y.spk_aktif AS Aktif,
        y.spk_is_so AS is_so,
        IFNULL(ppic.spk_nomor, "") AS SpkPpic,
        DATE_FORMAT(ppic.spk_tanggal, '%Y-%m-%d') AS TglSpkPpic,
        IFNULL(ppic.spk_close, 0) AS SpkPpicClose, 
        IFNULL(pin5.pin_acc, "") AS pin_acc,
        IFNULL(pin5.pin_dipakai, "") AS pin_dipakai,
        IFNULL(IF(pin5.pin_acc="" AND pin5.pin_dipakai="","WAIT",IF(pin5.pin_acc="Y" AND pin5.pin_dipakai="","ACC",IF(pin5.pin_acc="N","TOLAK",""))), "") AS Ngedit,
        IF(y.spk_divisi=5 AND (LENGTH(y.spk_repeat)>5 OR LENGTH(y.spk_memo)>5), l.lch_tanggal, k.lds_tgl) AS Design_Tanggal,
        k.lds_user AS Design_User, k.lds_note AS Design_Note,
        y.spk_newdesign AS Design_Baru, y.spk_designdone AS Design_Done,
        y.spk_keterangan AS Keterangan, y.spk_invdc AS 'Pesanan/Invoice',
        y.spk_ketbatal AS StsPembatalan,
        IF(ppic.spk_nomor IS NOT NULL, 1, 0) AS HasSpkPpic,
        IF(sjChk.sjd_spk_nomor IS NOT NULL OR stbjChk.stbjd_spk_nomor IS NOT NULL, 1, 0) AS HasSj,

        IFNULL(ppic.spk_jumlah_jadi, 0) AS Jadi,
        IFNULL(ppic.spk_cetak_count, 0) AS CetakCount,
        IFNULL(pinCetak.status, "") AS CetakApprovalStatus,

        -- ── Produksi: semua di-JOIN dari subquery pre-agregat (bukan
        -- correlated subquery per baris) — jauh lebih cepat karena
        -- tabel produksi cuma di-scan SEKALI lalu di-GROUP BY, baru
        -- di-JOIN. Key gabungan: SPK PPIC turunan kalau ada, kalau
        -- belum pakai nomor SO sendiri.
        IFNULL(proof.titik, 0) AS titik,
        IFNULL(mp.Potong0, 0) AS Potong0,
        IFNULL(mp.QcPotong0, 0) AS QcPotong0,
        IFNULL(mp.Bordir0, 0) AS Bordir0,
        IFNULL(mp.Cetak0, 0) AS Cetak0,
        IFNULL(mp.QcCetak0, 0) AS QcCetak0,
        IFNULL(mp.dc0, 0) AS dc0,
        IFNULL(mp.Jahit0, 0) AS Jahit0,
        IFNULL(mp.Lipat0, 0) AS Lipat0,
        IFNULL(bpj.Potong1, 0) AS Potong1,
        IFNULL(bpj.QcPotong1, 0) AS QcPotong1,
        IFNULL(bpj.Bordir1, 0) AS Bordir1,
        IFNULL(bpj.Cetak1, 0) AS Cetak1,
        IFNULL(bpj.QcCetak1, 0) AS QcCetak1,
        IFNULL(bpj.dc1, 0) AS dc1,
        IFNULL(bpj.Jahit1, 0) AS Jahit1,
        IFNULL(bpj.Lipat1, 0) AS Lipat1,
        IFNULL(lhkCetak.ctk1, 0) AS ctk1,
        IFNULL(lhkJahit.jht1, 0) AS jht1,
        IFNULL(lhkLipat.lpt1, 0) AS lpt1,
        IFNULL(l.lcd_qty_Cetak, 0) AS ctkm

      FROM (
        SELECT
          spk_nomor, user_create, spk_cmo, NULL AS spk_cmo_tanggal, spk_tanggal, spk_dateline, spk_statuskerja,
          spk_divisi, spk_cus_kode, spk_nama, spk_ukuran, spk_cab, spk_workshop,
          spk_pending, spk_ketpending, spk_tipe, spk_panjang, spk_lebar, spk_gramasi,
          spk_kain, spk_finishing, spk_harga, date_create, spk_jumlah, spk_jumlah_kirim,
          spk_jumlah_jadi, spk_cetak_count, spk_sal_kode,
          spk_nomor_po, spk_ketpo, spk_tgl_po, spk_DatelinePO, spk_close, spk_close_alasan,
          spk_pen_nomor, spk_memo, spk_repeat, spk_aktif, spk_pinjo, spk_accpending,
          spk_mppb, spk_newdesign, spk_designdone, spk_keterangan, spk_invdc, spk_is_so,
          spk_ketbatal
        FROM tspk
        WHERE spk_tanggal >= CONCAT(?, ' 00:00:00') AND spk_tanggal <= CONCAT(?, ' 23:59:59')
          AND (
            (spk_is_so = 1 AND spk_nomor LIKE 'SO-%')
            OR (
              spk_is_so = 0
              AND spk_nomor NOT LIKE 'SO-%'
              AND (spk_so_ref IS NULL OR spk_so_ref = '')
            )
          )
        UNION ALL
        SELECT
          so_nomor AS spk_nomor, user_create, so_cmo AS spk_cmo, so_cmo_tanggal AS spk_cmo_tanggal,
          so_tanggal AS spk_tanggal,
          so_dateline AS spk_dateline, so_statuskerja AS spk_statuskerja,
          so_divisi AS spk_divisi, so_cus_kode AS spk_cus_kode, so_nama AS spk_nama,
          so_ukuran AS spk_ukuran, so_cab AS spk_cab, so_workshop AS spk_workshop,
          so_pending AS spk_pending, so_ketpending AS spk_ketpending, so_tipe AS spk_tipe,
          so_panjang AS spk_panjang, so_lebar AS spk_lebar, so_gramasi AS spk_gramasi,
          so_kain AS spk_kain, so_finishing AS spk_finishing, so_harga AS spk_harga,
          date_create, so_jumlah AS spk_jumlah, so_jumlah_kirim AS spk_jumlah_kirim,
          NULL AS spk_jumlah_jadi, NULL AS spk_cetak_count,
          so_sal_kode AS spk_sal_kode,
          so_nomor_po AS spk_nomor_po, so_ketpo AS spk_ketpo, so_tgl_po AS spk_tgl_po,
          so_datelinepo AS spk_DatelinePO, so_close AS spk_close, so_close_alasan AS spk_close_alasan,
          so_pen_nomor AS spk_pen_nomor, so_memo AS spk_memo, so_repeat AS spk_repeat,
          so_aktif AS spk_aktif, so_pinjo AS spk_pinjo, so_accpending AS spk_accpending,
          so_mppb AS spk_mppb, so_newdesign AS spk_newdesign, so_designdone AS spk_designdone,
          so_keterangan AS spk_keterangan, so_invdc AS spk_invdc, 1 AS spk_is_so,
          so_ketbatal AS spk_ketbatal
        FROM tsalesorder
        WHERE so_tanggal >= CONCAT(?, ' 00:00:00') AND so_tanggal <= CONCAT(?, ' 23:59:59')
      ) y
      LEFT JOIN tcustomer c ON y.spk_cus_kode = c.cus_kode
      LEFT JOIN tcustomer c1 ON c.cus_kodei = c1.cus_kode
      LEFT JOIN tsales sl ON y.spk_sal_kode = sl.sal_kode
      LEFT JOIN tdivisi v ON y.spk_divisi = v.kode
      LEFT JOIN (SELECT lds_spk, lds_user, MAX(lds_tgl) AS lds_tgl, lds_note FROM tlhkdesign_status WHERE UPPER(lds_status)="DONE" GROUP BY lds_spk) k ON k.lds_spk = y.spk_nomor
      LEFT JOIN (SELECT lcd_spk_nomor, SUM(IFNULL(lcd_qty_Cetak,0)) AS lcd_qty_Cetak, MIN(lch_tanggal) AS lch_tanggal FROM tlhk_cetakmmt_dtl INNER JOIN tlhk_cetakmmt_hdr ON (lch_nomor=lcd_lch_nomor) GROUP BY 1) l ON l.lcd_spk_nomor = y.spk_nomor
      
      
      LEFT JOIN tspk ppic ON ppic.spk_so_ref<>'' and  ppic.spk_is_so = 0  and ppic.spk_so_ref = y.spk_nomor
      
      
      -- pin_acc/Ngedit — sebelumnya 2 correlated subquery per baris, sekarang 1 JOIN
      LEFT JOIN (
        SELECT p1.pin_nomor, p1.pin_acc, p1.pin_dipakai
        FROM tspk_pin5 p1
        INNER JOIN (
          SELECT pin_nomor, MAX(pin_urut) AS max_urut
          FROM tspk_pin5 WHERE pin_trs = "SO" GROUP BY pin_nomor
        ) p2 ON p2.pin_nomor = p1.pin_nomor AND p2.max_urut = p1.pin_urut
        WHERE p1.pin_trs = "SO"
      ) pin5 ON pin5.pin_nomor = y.spk_nomor

      -- status approval cetak ulang — dipakai untuk SPK PPIC turunan
      LEFT JOIN (
        SELECT p1.pin_nomor,
          IF(p1.pin_acc="Y" AND p1.pin_dipakai="", "ACC_READY",
            IF(p1.pin_acc="", "WAIT", IF(p1.pin_acc="N", "TOLAK", ""))) AS status
        FROM tspk_pin5 p1
        INNER JOIN (
          SELECT pin_nomor, MAX(pin_urut) AS max_urut
          FROM tspk_pin5 WHERE pin_trs = "SPK CETAK ULANG" GROUP BY pin_nomor
        ) p2 ON p2.pin_nomor = p1.pin_nomor AND p2.max_urut = p1.pin_urut
        WHERE p1.pin_trs = "SPK CETAK ULANG"
      ) pinCetak ON pinCetak.pin_nomor = ppic.spk_nomor

      -- cek sudah ada SJ — 1 row per spk kalau ada minimal 1 SJ
      LEFT JOIN (
        SELECT DISTINCT sjd_spk_nomor
        FROM tsj_dtl
        INNER JOIN tsj_hdr ON sj_nomor = sjd_sj_nomor
        WHERE sj_tanggal >= ?
      ) sjChk ON sjChk.sjd_spk_nomor = IFNULL(ppic.spk_nomor, y.spk_nomor)

      LEFT JOIN (
        SELECT DISTINCT stbjd_spk_nomor
        FROM tstbj_dtl
      ) stbjChk ON stbjChk.stbjd_spk_nomor = IFNULL(ppic.spk_nomor, y.spk_nomor)

      -- titik proof bordir
      LEFT JOIN (
        SELECT h.pf_spk_nomor, COUNT(*) AS titik
        FROM tproofgarmen_hdr h
        LEFT JOIN tproofgarmen_dtl d ON d.pfd_nomor = h.pf_nomor
        WHERE h.pf_lini = "BORDIR"
        GROUP BY h.pf_spk_nomor
      ) proof ON proof.pf_spk_nomor = IF(y.spk_memo<>"", y.spk_memo, IFNULL(ppic.spk_nomor, y.spk_nomor))

      -- mutasi produksi (Potong0..Lipat0)
      LEFT JOIN (
        SELECT mpd_spk,
          SUM(IF(mpd_bhn_kode="LL-000400" AND mpd_gdgp_asal IN ("GP015","GP001"), mpd_jumlah, 0)) AS Potong0,
          SUM(IF(mpd_bhn_kode="LL-000400" AND mpd_gdgp_asal IN ("GP012","GP021"), mpd_jumlah, 0)) AS QcPotong0,
          SUM(IF(mpd_bhn_kode IN ("LL-000237","LL-000407","LL-000412","LL-000413","LL-000447","LL-000448","LL-000450","LL-000451","LL-000452") AND mpd_gdgp_asal IN ("GP014","GP016"), mpd_jumlah, 0)) AS Bordir0,
          SUM(IF(mpd_bhn_kode="LL-000400" AND mpd_gdgp_asal IN ("GP017","GP002"), mpd_jumlah, 0)) AS Cetak0,
          SUM(IF(mpd_bhn_kode="LL-000400" AND mpd_gdgp_asal IN ("GP010","GP022"), mpd_jumlah, 0)) AS QcCetak0,
          SUM(IF(mpd_bhn_kode="LL-000400" AND mpd_gdgp_asal IN ("GP032"), mpd_jumlah, 0)) AS dc0,
          SUM(IF(mpd_bhn_kode="LL-000400" AND mpd_gdgp_asal IN ("GP018","GP003"), mpd_jumlah, 0)) AS Jahit0,
          SUM(IF(mpd_bhn_kode="LL-000400" AND mpd_gdgp_asal IN ("GP019","GP004"), mpd_jumlah, 0)) AS Lipat0
        FROM tmutasiproduksi_dtl
        INNER JOIN tmutasiproduksi_hdr ON mph_nomor = mpd_mph_nomor
        WHERE mph_tanggal >= ?
        GROUP BY mpd_spk
      ) mp ON mp.mpd_spk = IFNULL(ppic.spk_nomor, y.spk_nomor)

      -- BPJ (mitra luar) — Potong1..Lipat1
      LEFT JOIN (
        SELECT bpjd_spk,
          SUM(IF(bpjd_bhn_kode="LL-000400" AND bpjd_gdgp_asal IN ("GP015","GP001"), bpjd_Jumlah, 0)) AS Potong1,
          SUM(IF(bpjd_bhn_kode="LL-000400" AND bpjd_gdgp_asal IN ("GP012","GP021"), bpjd_Jumlah, 0)) AS QcPotong1,
          SUM(IF(bpjd_bhn_kode IN ("LL-000237","LL-000407","LL-000412","LL-000413","LL-000447","LL-000448","LL-000450","LL-000451","LL-000452") AND bpjd_gdgp_asal IN ("GP016","GP014"), bpjd_Jumlah, 0)) AS Bordir1,
          SUM(IF(bpjd_bhn_kode="LL-000400" AND bpjd_gdgp_asal IN ("GP017","GP002"), bpjd_Jumlah, 0)) AS Cetak1,
          SUM(IF(bpjd_bhn_kode="LL-000400" AND bpjd_gdgp_asal IN ("GP010","GP022"), bpjd_Jumlah, 0)) AS QcCetak1,
          SUM(IF(bpjd_bhn_kode="LL-000400" AND bpjd_gdgp_asal IN ("GP032"), bpjd_Jumlah, 0)) AS dc1,
          SUM(IF(bpjd_bhn_kode="LL-000400" AND bpjd_gdgp_asal IN ("GP018","GP003"), bpjd_Jumlah, 0)) AS Jahit1,
          SUM(IF(bpjd_bhn_kode="LL-000400" AND bpjd_gdgp_asal IN ("GP019","GP004"), bpjd_Jumlah, 0)) AS Lipat1
        FROM tbpj_dtl
        INNER JOIN tbpj_hdr ON bpj_nomor = bpjd_bpj_nomor
        WHERE bpj_tanggal >= ?
        GROUP BY bpjd_spk
      ) bpj ON bpj.bpjd_spk = IFNULL(ppic.spk_nomor, y.spk_nomor)

      -- LHK Cetak/Jahit/Lipat manual
      LEFT JOIN (
        SELECT lcd_spk_nomor, SUM(lcd_qty_Cetak) AS ctk1
        FROM tlhk_cetak_dtl GROUP BY lcd_spk_nomor
      ) lhkCetak ON lhkCetak.lcd_spk_nomor = IFNULL(ppic.spk_nomor, y.spk_nomor)
      LEFT JOIN (
        SELECT ljd_spk_nomor, SUM(ljd_qty_jahit) AS jht1
        FROM tlhk_jahit_dtl GROUP BY ljd_spk_nomor
      ) lhkJahit ON lhkJahit.ljd_spk_nomor = IFNULL(ppic.spk_nomor, y.spk_nomor)
      LEFT JOIN (
        SELECT lld_spk_nomor, SUM(lld_qty_lipat) AS lpt1
        FROM tlhk_lipat_dtl GROUP BY lld_spk_nomor
      ) lhkLipat ON lhkLipat.lld_spk_nomor = IFNULL(ppic.spk_nomor, y.spk_nomor)

      ${whereClause}
    ) x
    ORDER BY x.Tanggal DESC, x.Nomor DESC
  `;
  const [rows] = await db.query(query, params);
  return rows;
};

// --- GET DETAIL SIZE (Untuk Expand Baris) ---
// Cek tsalesorder_size dulu (SO baru); kalau kosong, fallback ke
// tspk_size (SO lama). Kolom Stbj/Kurang tetap generic by nomor
// string, tidak terpengaruh lokasi fisik header.
const getSizes = async (nomor) => {
  const [newRows] = await db.query(
    `SELECT 
       z.sos_so_nomor AS Nomor, 
       z.sos_size AS Size, 
       z.sos_qty AS Qty,
       IFNULL((SELECT SUM(d.stbjd_jumlah) FROM tstbj_dtl d WHERE d.stbjd_spk_nomor=z.sos_so_nomor AND d.stbjd_size=z.sos_size), 0) AS Stbj,
       (z.sos_qty - IFNULL((SELECT SUM(d.stbjd_jumlah) FROM tstbj_dtl d WHERE d.stbjd_spk_nomor=z.sos_so_nomor AND d.stbjd_size=z.sos_size), 0)) AS Kurang
     FROM tsalesorder_size z
     WHERE z.sos_so_nomor = ?
     ORDER BY z.sos_size`,
    [nomor],
  );
  if (newRows.length > 0) return newRows;

  const [legacyRows] = await db.query(
    `SELECT 
       z.spks_nomor AS Nomor, 
       z.spks_size AS Size, 
       z.spks_qty AS Qty,
       IFNULL((SELECT SUM(d.stbjd_jumlah) FROM tstbj_dtl d WHERE d.stbjd_spk_nomor=z.spks_nomor AND d.stbjd_size=z.spks_size), 0) AS Stbj,
       (z.spks_qty - IFNULL((SELECT SUM(d.stbjd_jumlah) FROM tstbj_dtl d WHERE d.stbjd_spk_nomor=z.spks_nomor AND d.stbjd_size=z.spks_size), 0)) AS Kurang
     FROM tspk_size z
     WHERE z.spks_nomor = ?
     ORDER BY z.spks_size`,
    [nomor],
  );
  return legacyRows;
};

// --- DELETE SALES ORDER ---
const deleteOrder = async (nomor, userDetails) => {
  const loc = await resolveSoLocation(nomor);
  if (!loc) throw new Error("Data tidak ditemukan.");

  const table = loc === "new" ? "tsalesorder" : "tspk";
  const prefix = loc === "new" ? "so_" : "spk_";
  const [rows] = await db.query(
    `SELECT ${prefix}tanggal AS tanggal, ${prefix}mppb AS mppb, ${prefix}jumlah_kirim AS jumlah_kirim,
            (SELECT IFNULL(SUM(spk_jumlah_kirim), 0) FROM tspk WHERE spk_so_ref = ? AND spk_is_so = 0) AS ppic_kirim
     FROM ${table} WHERE ${prefix}nomor = ?`,
    [nomor, nomor],
  );
  const data = rows[0];

  const zdtClose = await tutupBukuService.getTanggalTutupBuku();
  if (zdtClose && new Date(data.tanggal) < zdtClose) {
    throw new Error(
      "Transaksi tersebut sudah close (Tutup Buku). Tidak bisa dihapus.",
    );
  }
  if (Number(data.jumlah_kirim) > 0) {
    throw new Error("Sudah ada pengiriman pada SO ini. Tidak bisa dihapus.");
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(`DELETE FROM tbarang WHERE brg_kode = ?`, [nomor]);

    if (loc === "new") {
      await conn.query(
        `DELETE FROM tsalesorder_alokasi WHERE soa_so_nomor = ?`,
        [nomor],
      );
      await conn.query(
        `DELETE FROM tsalesorder_kaosan WHERE sok_so_nomor = ?`,
        [nomor],
      );
      await conn.query(`DELETE FROM tsalesorder_size WHERE sos_so_nomor = ?`, [
        nomor,
      ]);
      await conn.query(`DELETE FROM tsalesorder WHERE so_nomor = ?`, [nomor]);
    } else {
      await conn.query(`DELETE FROM tspk WHERE spk_nomor = ?`, [nomor]);
    }

    if (data.mppb) {
      await conn.query(
        `UPDATE tmkb_hdr SET mkb_spk_nomor="" WHERE mkb_mppb=? AND mkb_spk_nomor=?`,
        [data.mppb, nomor],
      );
    }
    await conn.commit();
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
};

// --- TOGGLE CLOSE ---
const toggleStatus = async (nomor, alasan, isClose) => {
  const loc = await resolveSoLocation(nomor);
  if (!loc) throw new Error("Data tidak ditemukan.");
  const statusBit = isClose ? 1 : 0;

  if (loc === "new") {
    await db.query(
      `UPDATE tsalesorder SET so_close = ?, so_close_alasan = ? WHERE so_nomor = ?`,
      [statusBit, alasan || "", nomor],
    );
  } else {
    await db.query(
      `UPDATE tspk SET spk_close = ?, spk_close_alasan = ? WHERE spk_nomor = ?`,
      [statusBit, alasan || "", nomor],
    );
  }
};

// --- REQUEST PIN (EDIT DATA CLOSED) ---
// Tabel tspk_pin5 sendiri tidak ikut migrasi (generic by nomor
// string), hanya SELECT nama/tanggal SO-nya yang perlu branching.
const requestPin = async (nomor, alasan, userKode) => {
  const loc = await resolveSoLocation(nomor);
  if (!loc) throw new Error("SO tidak ditemukan.");

  const [spk] =
    loc === "new"
      ? await db.query(
          `SELECT so_nama AS spk_nama, so_tanggal AS spk_tanggal FROM tsalesorder WHERE so_nomor=?`,
          [nomor],
        )
      : await db.query(
          `SELECT spk_nama, spk_tanggal FROM tspk WHERE spk_nomor=?`,
          [nomor],
        );

  const [lastPin] = await db.query(
    `SELECT pin_urut, pin_dipakai FROM tspk_pin5 WHERE pin_trs="SO" AND pin_nomor=? ORDER BY pin_urut DESC LIMIT 1`,
    [nomor],
  );
  let urut = 1;
  if (lastPin.length > 0) {
    urut =
      lastPin[0].pin_dipakai === ""
        ? lastPin[0].pin_urut
        : lastPin[0].pin_urut + 1;
  }
  const query = `
    INSERT INTO tspk_pin5 (pin_trs, pin_nomor, pin_urut, pin_jenis, pin_tgl_trs, pin_ket, pin_tgl_minta, pin_user_minta, pin_alasan)
    VALUES ("SO", ?, ?, "UBAH", ?, ?, NOW(), ?, ?)
    ON DUPLICATE KEY UPDATE pin_acc="", pin_tgl_minta=NOW(), pin_user_minta=VALUES(pin_user_minta), pin_alasan=VALUES(pin_alasan)
  `;
  await db.query(query, [
    nomor,
    urut,
    spk[0].spk_tanggal,
    spk[0].spk_nama,
    userKode,
    alasan,
  ]);
};

// --- APPROVE CMO ---
const approveCmo = async (nomor, userKode) => {
  const loc = await resolveSoLocation(nomor);
  if (!loc) throw new Error("Data SO tidak ditemukan.");

  if (loc === "new") {
    // Hanya SO baru (tsalesorder) yang mencatat tanggal approve —
    // tspk legacy tidak punya kolom ini dan tidak di-ALTER, sesuai
    // keputusan: data lama memang tidak akan pernah akurat historinya.
    await db.query(
      `UPDATE tsalesorder SET so_cmo = ?, so_cmo_tanggal = NOW() WHERE so_nomor = ?`,
      [userKode, nomor],
    );
  } else {
    await db.query(`UPDATE tspk SET spk_cmo = ? WHERE spk_nomor = ?`, [
      userKode,
      nomor,
    ]);
  }
};

// --- PENDING DESIGN — UNION dua sumber, sama seperti browse list ---
const getPendingDesigns = async (startDate, endDate) => {
  const query = `
    SELECT Nomor, Nama, DesignDone FROM (
      SELECT spk_nomor AS Nomor, spk_nama AS Nama, spk_designdone AS DesignDone, spk_tanggal AS Tanggal
      FROM tspk
      WHERE spk_is_so = 1 AND spk_nomor LIKE 'SO-%'
        AND spk_newdesign = 'Y' AND spk_designdone = 'N'
        AND DATE(spk_tanggal) >= ? AND DATE(spk_tanggal) <= ?
      UNION ALL
      SELECT so_nomor AS Nomor, so_nama AS Nama, so_designdone AS DesignDone, so_tanggal AS Tanggal
      FROM tsalesorder
      WHERE so_newdesign = 'Y' AND so_designdone = 'N'
        AND DATE(so_tanggal) >= ? AND DATE(so_tanggal) <= ?
    ) x
    ORDER BY x.Tanggal DESC, x.Nomor DESC
  `;
  const [rows] = await db.query(query, [
    startDate,
    endDate,
    startDate,
    endDate,
  ]);
  return rows;
};

// --- UPDATE DESIGN STATUS — massal, perlu branching per nomor
// karena satu batch checklist bisa berisi campuran SO lama & baru ---
const updateDesignStatus = async (nomorList) => {
  if (!nomorList || !Array.isArray(nomorList) || nomorList.length === 0) return;

  const [newRows] = await db.query(
    `SELECT so_nomor FROM tsalesorder WHERE so_nomor IN (?)`,
    [nomorList],
  );
  const newNomors = newRows.map((r) => r.so_nomor);
  const legacyNomors = nomorList.filter((n) => !newNomors.includes(n));

  if (newNomors.length > 0) {
    await db.query(
      `UPDATE tsalesorder SET so_designdone = 'Y' WHERE so_nomor IN (?)`,
      [newNomors],
    );
  }
  if (legacyNomors.length > 0) {
    await db.query(
      `UPDATE tspk SET spk_designdone = 'Y' WHERE spk_nomor IN (?)`,
      [legacyNomors],
    );
  }
};

// ─────────────────────────────────────────────────────────
// PEMBATALAN SPK/SO — sesuai Delphi ufrmPembatalanSpk.pas ✅
// Diakses dari klik-kanan browse SO → "Form Pembatalan SPK".
// ─────────────────────────────────────────────────────────

// LOAD DATA — dua mode:
//  - spkNomor diisi → mulai pengajuan baru (checkbox kosong semua)
//  - fbNomor diisi  → buka pengajuan yang sudah ada (mode approval/readonly)
const getPembatalanDetail = async (fbNomor, spkNomor) => {
  if (spkNomor) {
    const loc = await resolveSoLocation(spkNomor);
    if (!loc) throw new Error("Data SPK/SO tidak ditemukan.");

    const [rows] =
      loc === "new"
        ? await db.query(
            `SELECT so_nomor AS spk_nomor, so_tanggal AS spk_tanggal,
                    so_cus_kode AS spk_cus_kode, so_nama AS spk_nama,
                    so_jumlah AS spk_jumlah, c.cus_nama AS cus_nama
             FROM tsalesorder s
             LEFT JOIN tcustomer c ON c.Cus_kode = s.so_cus_kode
             WHERE s.so_nomor = ?`,
            [spkNomor],
          )
        : await db.query(
            `SELECT s.spk_nomor, s.spk_tanggal, s.spk_cus_kode, s.spk_nama,
                    s.spk_jumlah, c.cus_nama
             FROM tspk s
             LEFT JOIN tcustomer c ON c.Cus_kode = s.spk_cus_kode
             WHERE s.spk_nomor = ?`,
            [spkNomor],
          );
    if (!rows[0]) throw new Error("Data SPK/SO tidak ditemukan.");

    return {
      fb_nomor: "",
      ...rows[0],
      fb_abubah: "",
      fb_abmap: "",
      fb_abbahan: "",
      fb_abqty: "",
      fb_ablain: "",
      fb_ablain2: "",
      fb_abket: "",
      fb_spbelum: "",
      fb_spcuting: "",
      fb_spsewing: "",
      fb_spfinishing: "",
      fb_spsudah: "",
      fb_sbbeli: "",
      fb_sbdireksi: "",
      fb_sbsup: "",
      fb_sbsudah: "",
      fb_dampak: "",
      fb_rtbatal: "",
      fb_rtalih: "",
      fb_rtsisa: "",
      fb_rtlain: "",
      fb_rtlain2: "",
      fb_user_create: "",
      Created: "",
      fb_apv: "",
      fb_apv_user: "",
      Approved: "",
    };
  }

  const [fbRows] = await db.query(
    `SELECT * FROM tspk_formbatal WHERE fb_nomor = ?`,
    [fbNomor],
  );
  if (!fbRows[0]) throw new Error("Data pengajuan tidak ditemukan.");
  const fb = fbRows[0];

  const loc = await resolveSoLocation(fb.fb_spk);
  const [soRows] =
    loc === "new"
      ? await db.query(
          `SELECT so_nomor AS spk_nomor, so_tanggal AS spk_tanggal,
                  so_cus_kode AS spk_cus_kode, so_nama AS spk_nama,
                  so_jumlah AS spk_jumlah, c.cus_nama AS cus_nama
           FROM tsalesorder s
           LEFT JOIN tcustomer c ON c.Cus_kode = s.so_cus_kode
           WHERE s.so_nomor = ?`,
          [fb.fb_spk],
        )
      : await db.query(
          `SELECT s.spk_nomor, s.spk_tanggal, s.spk_cus_kode, s.spk_nama,
                  s.spk_jumlah, c.cus_nama
           FROM tspk s
           LEFT JOIN tcustomer c ON c.Cus_kode = s.spk_cus_kode
           WHERE s.spk_nomor = ?`,
          [fb.fb_spk],
        );

  return {
    ...fb,
    ...(soRows[0] || {}),
    Created: fb.fb_date_create,
    Approved: fb.fb_apv_tgl,
  };
};

// GENERATE NOMOR — sesuai Delphi getmaxnomor() ✅
// ⚠️ diperbaiki: prefix length dinamis (bukan hardcode 11 seperti source
// asli), karena panjang nomor SPK/SO sekarang variatif.
const getMaxNomorBatal = async (spkNomor, conn) => {
  const runner = conn || db;
  const prefixLen = spkNomor.length;
  const [[row]] = await runner.query(
    `SELECT IFNULL(MAX(RIGHT(fb_nomor, 2)), 0) AS jumlah
     FROM tspk_formbatal
     WHERE LEFT(fb_nomor, ?) = ?`,
    [prefixLen, spkNomor],
  );
  const next = 101 + Number(row.jumlah);
  return `${spkNomor}-${String(next).slice(-2)}`;
};

// AJUKAN PEMBATALAN — sesuai Delphi simpandata() cabang APV=false ✅
const ajukanPembatalan = async (payload, userKode) => {
  const {
    spkNomor,
    tanggal,
    abUbah,
    abMap,
    abBahan,
    abQty,
    abLain,
    abLain2,
    abKet,
    spBelum,
    spCuting,
    spSewing,
    spFinishing,
    spSudah,
    sbBeli,
    sbDireksi,
    sbSup,
    sbSudah,
    dampak,
    rtBatal,
    rtAlih,
    rtSisa,
    rtLain,
    rtLain2,
  } = payload;

  if (!spkNomor) throw new Error("Nomor SPK/SO wajib diisi.");
  const y = (v) => (v ? "Y" : "N");

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const fbNomor = await getMaxNomorBatal(spkNomor, conn);

    await conn.query(
      `INSERT INTO tspk_formbatal
         (fb_nomor, fb_tanggal, fb_spk, fb_abubah, fb_abmap, fb_abbahan, fb_abqty,
          fb_ablain, fb_ablain2, fb_abket,
          fb_spbelum, fb_spcuting, fb_spsewing, fb_spfinishing, fb_spsudah,
          fb_sbbeli, fb_sbdireksi, fb_sbsup, fb_sbsudah, fb_dampak,
          fb_rtbatal, fb_rtalih, fb_rtsisa, fb_rtlain, fb_rtlain2,
          fb_user_create, fb_date_create)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE
         fb_abubah=VALUES(fb_abubah), fb_abmap=VALUES(fb_abmap), fb_abbahan=VALUES(fb_abbahan),
         fb_abqty=VALUES(fb_abqty), fb_ablain=VALUES(fb_ablain), fb_ablain2=VALUES(fb_ablain2),
         fb_abket=VALUES(fb_abket), fb_spbelum=VALUES(fb_spbelum), fb_spcuting=VALUES(fb_spcuting),
         fb_spsewing=VALUES(fb_spsewing), fb_spfinishing=VALUES(fb_spfinishing),
         fb_spsudah=VALUES(fb_spsudah), fb_sbbeli=VALUES(fb_sbbeli), fb_sbdireksi=VALUES(fb_sbdireksi),
         fb_sbsup=VALUES(fb_sbsup), fb_sbsudah=VALUES(fb_sbsudah), fb_dampak=VALUES(fb_dampak),
         fb_rtbatal=VALUES(fb_rtbatal), fb_rtalih=VALUES(fb_rtalih), fb_rtsisa=VALUES(fb_rtsisa),
         fb_rtlain=VALUES(fb_rtlain), fb_rtlain2=VALUES(fb_rtlain2),
         fb_user_create=VALUES(fb_user_create), fb_date_modified=NOW()`,
      [
        fbNomor,
        tanggal,
        spkNomor,
        y(abUbah),
        y(abMap),
        y(abBahan),
        y(abQty),
        y(abLain),
        abLain2 || "",
        abKet || "",
        y(spBelum),
        y(spCuting),
        y(spSewing),
        y(spFinishing),
        y(spSudah),
        y(sbBeli),
        y(sbDireksi),
        y(sbSup),
        y(sbSudah),
        dampak || "",
        y(rtBatal),
        y(rtAlih),
        y(rtSisa),
        y(rtLain),
        rtLain2 || "",
        userKode,
      ],
    );

    const loc = await resolveSoLocation(spkNomor);
    if (!loc) throw new Error("SPK/SO tidak ditemukan.");
    if (loc === "new") {
      await conn.query(
        `UPDATE tsalesorder SET so_aktif = "N", so_ketbatal = "PENGAJUAN" WHERE so_nomor = ?`,
        [spkNomor],
      );
    } else {
      await conn.query(
        `UPDATE tspk SET spk_aktif = "N", spk_ketbatal = "PENGAJUAN" WHERE spk_nomor = ?`,
        [spkNomor],
      );
    }

    await conn.commit();
    return { fbNomor };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
};

// GET STATUS PENGAJUAN GANTI QTY/KAIN TERAKHIR — sesuai Delphi
// PengajuanGantiQtydanJenisKain1Click, dipakai frontend buat prefill
// form (kalau ada pengajuan pending, tampilkan urut & alasan lama)
const getGantiQtyKainStatus = async (nomor) => {
  const [[lastPin]] = await db.query(
    `SELECT pin_urut, pin_dipakai, pin_alasan
     FROM tspk_pin5
     WHERE pin_trs = "SO" AND pin_nomor = ? AND pin_jenis = "GANTI"
     ORDER BY pin_urut DESC LIMIT 1`,
    [nomor],
  );

  if (!lastPin) {
    return { urut: 1, alasan: "" };
  }
  if (lastPin.pin_dipakai === "") {
    // masih pending, belum di-approve → reuse urut yang sama, prefill alasan
    return { urut: lastPin.pin_urut, alasan: lastPin.pin_alasan || "" };
  }
  // sudah pernah dipakai → pengajuan baru, urut naik
  return { urut: lastPin.pin_urut + 1, alasan: "" };
};

// AJUKAN GANTI QTY/KAIN — sesuai Delphi btnSimpanClick cabang
// "Pengajuan Ganti Qty dan Jeni Kain" ✅
const ajukanGantiQtyKain = async (nomor, alasan, userKode) => {
  if (!alasan?.trim()) throw new Error("Alasan harus diisi.");

  const loc = await resolveSoLocation(nomor);
  if (!loc) throw new Error("Data SPK/SO tidak ditemukan.");

  const [header] =
    loc === "new"
      ? await db.query(
          `SELECT so_tanggal AS tanggal, so_nama AS nama FROM tsalesorder WHERE so_nomor = ?`,
          [nomor],
        )
      : await db.query(
          `SELECT spk_tanggal AS tanggal, spk_nama AS nama FROM tspk WHERE spk_nomor = ?`,
          [nomor],
        );
  if (!header[0]) throw new Error("Data SPK/SO tidak ditemukan.");

  const { urut } = await getGantiQtyKainStatus(nomor);

  await db.query(
    `INSERT INTO tspk_pin5
       (pin_trs, pin_nomor, pin_urut, pin_jenis, pin_tgl_trs, pin_ket,
        pin_tgl_minta, pin_user_minta, pin_alasan)
     VALUES ("SO", ?, ?, "GANTI", ?, ?, NOW(), ?, ?)
     ON DUPLICATE KEY UPDATE
       pin_tgl_trs = VALUES(pin_tgl_trs),
       pin_ket = VALUES(pin_ket),
       pin_acc = "",
       pin_tgl_minta = NOW(),
       pin_user_minta = VALUES(pin_user_minta),
       pin_alasan = VALUES(pin_alasan)`,
    [nomor, urut, header[0].tanggal, header[0].nama, userKode, alasan],
  );

  return { urut };
};

// --- SEARCH SO UNTUK PEMBUATAN SPK PPIC (dipakai SalesOrderSearchModal) ---
// Filter WAJIB: Aktif='Y', sudah di-approve CMO (CMO<>''), dan BELUM
// ada SPK PPIC turunannya (spk_is_so=0 yang spk_so_ref-nya = nomor SO
// ini). Sebelumnya filter ini dilakukan di frontend setelah fetch
// semua data lewat getBrowse — sekarang difilter di SQL supaya lebih
// ringan dan konsisten dengan sumber SO (UNION tsalesorder + tspk
// legacy) yang sama dipakai getBrowseList.
const searchAvailableForSpk = async (
  keyword,
  startDate,
  endDate,
  page = 1,
  limit = 50,
  canLihatCus = false,
  userCab = null,
) => {
  const limitNum = Number(limit);
  const offset = (Number(page) - 1) * limitNum;
  const like = `%${keyword || ""}%`;

  let source = `
    FROM tsalesorder s
    LEFT JOIN tcustomer c ON c.cus_kode = s.so_cus_kode
    LEFT JOIN tmemospk map ON map.mspk_nomor = s.so_memo
    LEFT JOIN tuser u ON u.user_kode = s.user_create
    WHERE s.so_aktif = 'Y'
      AND s.so_cmo <> ''
      AND (s.so_spk_ref IS NULL OR s.so_spk_ref = '')
      AND DATE(s.so_tanggal) >= ? AND DATE(s.so_tanggal) <= ?
      AND (s.so_nomor LIKE ? OR s.so_nama LIKE ? OR c.cus_nama LIKE ?)
  `;

  const params = [startDate, endDate, like, like, like];

  if (userCab && userCab !== "HO-") {
    source += ` AND s.so_cab = ?`;
    params.push(userCab);
  }

  const [[{ total }]] = await db.query(
    `SELECT COUNT(*) AS total ${source}`,
    params,
  );

  const custNameCol = canLihatCus ? "c.cus_nama" : "NULL";

  const [rows] = await db.query(
    `SELECT
       s.so_nomor AS Nomor, s.so_tanggal AS Tanggal, s.so_nama AS Nama, s.so_jumlah AS Pesan, s.so_workshop AS Workshop,
       s.so_cus_kode AS KodeCustomer,
       ${custNameCol} AS Customer,
       s.so_memo AS MAP,
       IFNULL(u.user_nama, s.user_create) AS MO,
       CASE
         WHEN s.so_memo IS NULL OR s.so_memo = '' THEN 'TANPA_MAP'
         WHEN map.mspk_cmo IS NULL OR map.mspk_cmo = '' THEN 'MENUNGGU_APV'
         ELSE 'SUDAH_APPROVE'
       END AS StatusMap
     ${source}
     ORDER BY s.so_tanggal DESC
     LIMIT ? OFFSET ?`,
    [...params, limitNum, offset],
  );

  return { items: rows, total: Number(total) };
};

module.exports = {
  getBrowseList,
  getSizes,
  deleteOrder,
  toggleStatus,
  requestPin,
  approveCmo,
  getPendingDesigns,
  updateDesignStatus,
  resolveSoLocation,
  getPembatalanDetail,
  ajukanPembatalan,
  getGantiQtyKainStatus,
  ajukanGantiQtyKain,
  searchAvailableForSpk,
};
