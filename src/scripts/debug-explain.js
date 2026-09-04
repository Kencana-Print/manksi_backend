const db = require("../config/database"); // sesuaikan path relatif ke file db kamu

const run = async () => {
  const startDate = "2026-08-01";
  const endDate = "2026-09-03";

  const query = `
    EXPLAIN SELECT x.*
    FROM (
      SELECT
        y.spk_nomor AS Nomor, y.user_create AS MO, y.spk_cmo AS CMO,
        y.spk_cmo_tanggal AS TglApproveCmo,
        y.spk_tanggal AS Tanggal, y.spk_dateline AS Dateline,
        y.spk_statuskerja AS Kepentingan, v.divisi AS Divisi,
        y.spk_cus_kode AS KodeCustomer, NULL AS Customer,
        y.spk_nama AS Nama, y.spk_ukuran AS Ukuran,
        y.spk_cab AS Cab, TRIM(y.spk_workshop) AS Workshop,
        y.spk_pending AS Pending, y.spk_ketpending AS KetPending,
        y.spk_tipe AS Tipe, y.spk_panjang AS Panjang,
        y.spk_lebar AS Lebar, y.spk_gramasi AS Gramasi,
        y.spk_kain AS Kain, y.spk_finishing AS Finishing,
        NULL AS Harga,
        y.date_create AS Created, y.spk_jumlah AS Pesan,
        IF(y.spk_jumlah_kirim > 0, y.spk_jumlah_kirim, IFNULL(ppic.spk_jumlah_kirim, 0)) AS Kirim,
        (y.spk_jumlah - IF(y.spk_jumlah_kirim > 0, y.spk_jumlah_kirim, IFNULL(ppic.spk_jumlah_kirim, 0))) AS Kurang,
        sl.sal_nama AS Sales, NULL AS GroupCustomer,
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
        IFNULL(pinCetak.status, "") AS CetakApprovalStatus

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
      LEFT JOIN tspk ppic ON ppic.spk_so_ref<>'' and ppic.spk_is_so = 0 and ppic.spk_so_ref = y.spk_nomor
      LEFT JOIN (
        SELECT p1.pin_nomor, p1.pin_acc, p1.pin_dipakai
        FROM tspk_pin5 p1
        INNER JOIN (
          SELECT pin_nomor, MAX(pin_urut) AS max_urut
          FROM tspk_pin5 WHERE pin_trs = "SO" GROUP BY pin_nomor
        ) p2 ON p2.pin_nomor = p1.pin_nomor AND p2.max_urut = p1.pin_urut
        WHERE p1.pin_trs = "SO"
      ) pin5 ON pin5.pin_nomor = y.spk_nomor
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
      LEFT JOIN (
        SELECT DISTINCT sjd_spk_nomor
        FROM tsj_dtl
        INNER JOIN tsj_hdr ON sj_nomor = sjd_sj_nomor
        WHERE sj_tanggal >= ?
      ) sjChk ON sjChk.sjd_spk_nomor = IFNULL(ppic.spk_nomor, y.spk_nomor)
      LEFT JOIN (
        SELECT DISTINCT d.STBJD_SPK_Nomor AS stbjd_spk_nomor
        FROM tstbj_dtl d
        INNER JOIN tstbj_hdr h ON h.stbj_nomor = d.STBJD_STBJ_Nomor
        WHERE h.stbj_tanggal >= ?
      ) stbjChk ON stbjChk.stbjd_spk_nomor = IFNULL(ppic.spk_nomor, y.spk_nomor)
      WHERE 1=1
    ) x
    ORDER BY x.Tanggal DESC, x.Nomor DESC
  `;

  const params = [startDate, endDate, startDate, endDate, startDate, startDate];

  try {
    const [rows] = await db.query(query, params);
    console.log(JSON.stringify(rows, null, 2));
  } catch (err) {
    console.error("ERROR:", err.message);
  }
  process.exit(0);
};

run();
