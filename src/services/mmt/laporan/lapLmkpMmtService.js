const pool = require('../../../config/database');

const throwDbError = (message, error) => {
  console.error(message, error.message);
  throw new Error(message + ": " + error.message);
};

// Parse rincian ukuran dari tspk.spk_ukuran, mis. "L=15, XL=20, 2XL=10".
// String dimensi (mis. "3X1 M") atau nama size tanpa qty tidak diambil.
const normalizeKey = (value) =>
  String(value ?? "")
    .trim()
    .toUpperCase();

// Filter mutasi produksi dari Sublim/RTR ke Gudang Potong P04 (GP001).
// Alias wajib: h = tmutasiproduksi_hdr, d = tmutasiproduksi_dtl.
const SUBLIM_TO_POTONG_P04_FILTER = `
  h.mph_gdgtujuan = 'GP001'
  AND (
    h.mph_gdgasal IN ('GP031', 'GPM')
    OR h.mph_kelompok LIKE '%SUBLIM%'
    OR d.mpd_gdgp_asal IN ('GP031', 'GPM')
  )
`;

const parseUkuranText = (text) => {
  const result = [];
  String(text || "")
    .split(/[,;\n]+/)
    .forEach((part) => {
      const s = part.trim();
      if (!s) return;
      const m = s.match(
        /^([A-Za-z0-9][A-Za-z0-9/.\- ]*?)\s*(?:=|:)\s*(\d+)\s*(?:pcs|pc)?\s*$/i,
      );
      if (!m) return;
      const size = m[1].trim().toUpperCase();
      const qty = Number(m[2]);
      if (!size || !Number.isFinite(qty) || qty <= 0) return;
      result.push({ size, qty });
    });
  return result;
};

// KATEGORI MAKLON (cbJenisIndex = '4')
// ------------------------------------
// Sumber: dokumen Maklon (tmaklon_hdr) yang gudang tujuannya P05 (MMT).
// "Order" = total estimasi barang jadi (tmaklon_dtl_jadi.mkldj_estimasi_qty),
// sama dengan angka "Rencana" yang dipakai form LHK Cetak saat menambah
// Maklon. "Kurang Cetak" = Order - total qty cetak di LHK Cetak MMT
// (tlhk_cetakmmt_dtl.lcd_qty_cetak dengan lcd_spk_nomor = nomor Maklon).
// Tabel sengaja tidak memakai prefix database agar otomatis mengikuti
// mode REAL/TRIAL dari pool (AsyncLocalStorage).
const getMaklonMonitoring = async (startDate, endDate) => {
  const sql = `
    SELECT
      h.mkl_nomor AS NOMOR,
      h.mkl_keterangan AS spk_memo,
      h.mkl_tanggal AS spk_tanggal,
      h.mkl_deadline AS deadline,
      COALESCE(NULLIF(TRIM(h.mkl_keterangan), ''), h.mkl_nomor) AS spk_nama,
      h.mkl_status AS spk_statuskerja,
      NULL AS spk_workshop,
      NULL AS DIVISI,
      'MAKLON' AS jo_nama,
      IF(
        IFNULL(o.qty_order, 0) > 0
          AND IFNULL(c.qty_cetak, 0) >= IFNULL(o.qty_order, 0),
        'Closed',
        'Open'
      ) AS status,
      NULL AS PANJANG,
      NULL AS LEBAR,
      b.bahan AS KAIN,
      NULL AS spk_gramasi,
      NULL AS FINISHING,
      IFNULL(o.qty_order, 0) AS spk_jumlah,
      0 AS spk_jumlah_kirim,
      0 AS krg_kirim,
      0 AS krg_Seaming,
      0 AS krg_mataayam,
      0 AS krg_coly,
      GREATEST(
        0,
        IFNULL(o.qty_order, 0) - IFNULL(c.qty_cetak, 0)
      ) AS krg_Cetak,
      0 AS krg_mutasi_p04,
      0 AS krg_kirim_meter,
      0 AS krg_Cetak_meter,
      0 AS krg_coly_meter,
      0 AS mt01, 0 AS mt02, 0 AS mt03, 0 AS mt04, 0 AS mt05, 0 AS mi,
      0 AS mx01, 0 AS mx02, 0 AS mx03, 0 AS mx04, 0 AS mx05,
      0 AS sb01, 0 AS sb02, 0 AS sb03, 0 AS sb04, 0 AS sb05,
      0 AS rtr,
      0 AS cetak_luarx
    FROM tmaklon_hdr h
    LEFT JOIN (
      SELECT d.mkld_mkl_nomor,
             SUM(IFNULL(j.mkldj_estimasi_qty, 0)) AS qty_order
      FROM tmaklon_dtl d
      LEFT JOIN tmaklon_dtl_jadi j ON j.mkldj_mkld_id = d.mkld_id
      GROUP BY d.mkld_mkl_nomor
    ) o ON o.mkld_mkl_nomor = h.mkl_nomor
    LEFT JOIN (
      SELECT TRIM(lcd_spk_nomor) AS mkl_nomor,
             SUM(IFNULL(lcd_qty_cetak, 0)) AS qty_cetak
      FROM tlhk_cetakmmt_dtl
      WHERE UPPER(TRIM(lcd_spk_nomor)) LIKE 'MKL%'
      GROUP BY TRIM(lcd_spk_nomor)
    ) c ON c.mkl_nomor = h.mkl_nomor
    LEFT JOIN (
      SELECT d.mkld_mkl_nomor,
             GROUP_CONCAT(
               DISTINCT COALESCE(
                 NULLIF(TRIM(IF(d.mkld_is_freetext = 1,
                                d.mkld_nama_polos_manual,
                                b.brg_nama)), ''),
                 NULLIF(TRIM(d.mkld_kode_polos), '')
               )
               SEPARATOR ', '
             ) AS bahan
      FROM tmaklon_dtl d
      LEFT JOIN tgarmen_brg b ON b.brg_kode = d.mkld_kode_polos
      GROUP BY d.mkld_mkl_nomor
    ) b ON b.mkld_mkl_nomor = h.mkl_nomor
    WHERE UPPER(TRIM(h.mkl_cab_tujuan)) = 'P05'
      AND h.mkl_tanggal >= CONCAT(?, ' 00:00:00')
      AND h.mkl_tanggal <= CONCAT(?, ' 23:59:59')
    ORDER BY spk_nama
  `;

  const [rows] = await pool.query(sql, [startDate, endDate]);
  return rows;
};

exports.getMonitoringData = async (cbJenisIndex, startDate, endDate) => {
  try {
    // Maklon memakai query tersendiri (bukan tspk), jadi ditangani lebih awal.
    if (String(cbJenisIndex) === "4") {
      return await getMaklonMonitoring(startDate, endDate);
    }

    let conditionExtra = "";
    let joinLhkCetak = "";
    let fieldJmlCetak = "";
    let joinSizeLhk = "";
    let joinMutasiP04 = "";
    let fieldKrgMutasiP04 = "0 AS krg_mutasi_p04";
    let selectMesinFields = `
        0 AS mt01, 0 AS mt02, 0 AS mt03, 0 AS mt04, 0 AS mt05, 0 AS mi,
        0 AS mx01, 0 AS mx02, 0 AS mx03, 0 AS mx04, 0 AS mx05,
        0 AS sb01, 0 AS sb02, 0 AS sb03, 0 AS sb04, 0 AS sb05,
        0 AS rtr
      `;

    // 1. KATEGORI MT & LM (cbJenisIndex = '0')
    if (cbJenisIndex === "0") {
      fieldJmlCetak = "ifnull(ee.jml_cetak_mmt, 0)";
      conditionExtra =
        "AND spk_cab = 'P05' AND spk_divisi IN (5) AND spk_jo_kode IN ('MT', 'LM')";
      selectMesinFields = `
            ROUND(IFNULL(ee.MT01, 0), 0) AS mt01, ROUND(IFNULL(ee.MT02, 0), 0) AS mt02,
            ROUND(IFNULL(ee.MT03, 0), 0) AS mt03, ROUND(IFNULL(ee.MT04, 0), 0) AS mt04,
            ROUND(IFNULL(ee.MT05, 0), 0) AS mt05, ROUND(IFNULL(ee.MI, 0), 0) AS mi,
            0 AS mx01, 0 AS mx02, 0 AS mx03, 0 AS mx04, 0 AS mx05,
            0 AS sb01, 0 AS sb02, 0 AS sb03, 0 AS sb04, 0 AS sb05,
            0 AS rtr
          `;
      joinLhkCetak = `
            LEFT JOIN (
                SELECT lcd_spk_nomor, 
                    SUM(IF(lcd_jns_mesin='MT01',lcd_qty_cetak,0)) MT01,
                    SUM(IF(lcd_jns_mesin='MT02',lcd_qty_cetak,0)) MT02,
                    SUM(IF(lcd_jns_mesin='MT03',lcd_qty_cetak,0)) MT03,
                    SUM(IF(lcd_jns_mesin='MT04',lcd_qty_cetak,0)) MT04,
                    SUM(IF(lcd_jns_mesin='MT05',lcd_qty_cetak,0)) MT05,
                    SUM(IF(lcd_jns_mesin='MI',lcd_qty_cetak,0)) MI,
                    SUM(IFNULL(lcd_qty_cetak,0)) jml_cetak_mmt
                FROM tlhk_cetakmmt_dtl
                GROUP BY 1
            ) ee ON ee.lcd_spk_nomor = spk_nomor`;
    }
    // 2. KATEGORI MX (cbJenisIndex = '1')
    else if (cbJenisIndex === "1") {
      fieldJmlCetak = "ifnull(ff.jml_cetak_tekstil, 0)";
      conditionExtra =
        "AND spk_cab = 'P05' AND spk_divisi IN (5) AND spk_jo_kode='MX'";
      selectMesinFields = `
            0 AS mt01, 0 AS mt02, 0 AS mt03, 0 AS mt04, 0 AS mt05, 0 AS mi,
            ROUND(IFNULL(ff.MX01, 0), 0) AS mx01, ROUND(IFNULL(ff.MX02, 0), 0) AS mx02,
            ROUND(IFNULL(ff.MX03, 0), 0) AS mx03, ROUND(IFNULL(ff.MX04, 0), 0) AS mx04,
            ROUND(IFNULL(ff.MX05, 0), 0) AS mx05,
            0 AS sb01, 0 AS sb02, 0 AS sb03, 0 AS sb04, 0 AS sb05,
            0 AS rtr
          `;
      joinLhkCetak = `
            LEFT JOIN (
                SELECT ltd_spk_nomor, 
                    SUM(IF(ltd_jns_mesin='MX01',ltd_qty_cetak,0)) MX01,
                    SUM(IF(ltd_jns_mesin='MX02',ltd_qty_cetak,0)) MX02,
                    SUM(IF(ltd_jns_mesin='MX03',ltd_qty_cetak,0)) MX03,
                    SUM(IF(ltd_jns_mesin='MX04',ltd_qty_cetak,0)) MX04,
                    SUM(IF(ltd_jns_mesin='MX05',ltd_qty_cetak,0)) MX05,
                    SUM(IFNULL(ltd_qty_cetak,0)) jml_cetak_tekstil
                FROM tlhk_tekstilmmt_dtl
                GROUP BY 1
            ) ff ON ff.ltd_spk_nomor = spk_nomor`;
    }
    // 3. KATEGORI PAPERPRINT (cbJenisIndex = '2')
    else if (cbJenisIndex === "2") {
      fieldJmlCetak = "ifnull(sb.jml_cetak_paperprint, 0)";
      conditionExtra = "AND spk_sublim = 'Y'";
      selectMesinFields = `
        0 AS mt01, 0 AS mt02, 0 AS mt03, 0 AS mt04, 0 AS mt05, 0 AS mi,
        0 AS mx01, 0 AS mx02, 0 AS mx03, 0 AS mx04, 0 AS mx05,
        ROUND(IFNULL(sb.SB01, 0), 0) AS sb01, ROUND(IFNULL(sb.SB02, 0), 0) AS sb02,
        ROUND(IFNULL(sb.SB03, 0), 0) AS sb03, ROUND(IFNULL(sb.SB04, 0), 0) AS sb04,
        ROUND(IFNULL(sb.SB05, 0), 0) AS sb05,
        0 AS rtr
      `;
      joinLhkCetak = `
        LEFT JOIN (
            SELECT lsbd_spk_nomor, 
                SUM(IF(lsbd_lokasi='SB01',lsbd_jumlah,0)) SB01,
                SUM(IF(lsbd_lokasi='SB02',lsbd_jumlah,0)) SB02,
                SUM(IF(lsbd_lokasi='SB03',lsbd_jumlah,0)) SB03,
                SUM(IF(lsbd_lokasi='SB04',lsbd_jumlah,0)) SB04,
                SUM(IF(lsbd_lokasi='SB05',lsbd_jumlah,0)) SB05,
                SUM(IFNULL(lsbd_jumlah,0)) jml_cetak_paperprint
            FROM tlhk_sublim_dtl
            GROUP BY 1
        ) sb ON sb.lsbd_spk_nomor = spk_nomor`;

      // Perbaikan: Ambil juga detail komponen per size untuk akurasi perhitungan
      joinSizeLhk = `
        LEFT JOIN (
            SELECT 
                lsbd_spk_nomor, 
                lsbd_poid_size, 
                lsbd_komponen,
                SUM(IFNULL(lsbd_jumlah, 0)) AS qty_cetak_komponen
            FROM tlhk_sublim_dtl
            WHERE lsbd_poid_size != '-' AND lsbd_poid_size != ''
            GROUP BY lsbd_spk_nomor, lsbd_poid_size, lsbd_komponen
        ) sz_lhk ON sz_lhk.lsbd_spk_nomor = spks_nomor AND sz_lhk.lsbd_poid_size = spks_size
      `;
    }
    // 4. KATEGORI SUBLIM (cbJenisIndex = '3') — memakai LHK Roll to Roll (RTR)
    else if (cbJenisIndex === "3") {
      fieldJmlCetak = "ifnull(rtr.jml_cetak_sublim, 0)";
      conditionExtra = "AND spk_sublim = 'Y'";
      selectMesinFields = `
        0 AS mt01, 0 AS mt02, 0 AS mt03, 0 AS mt04, 0 AS mt05, 0 AS mi,
        0 AS mx01, 0 AS mx02, 0 AS mx03, 0 AS mx04, 0 AS mx05,
        0 AS sb01, 0 AS sb02, 0 AS sb03, 0 AS sb04, 0 AS sb05,
        ROUND(IFNULL(rtr.RTR, 0), 0) AS rtr
      `;
      joinLhkCetak = `
        LEFT JOIN (
            SELECT lrd_spk_nomor, 
                SUM(IF(lrd_lokasi='RTR',lrd_jumlah,0)) RTR,
                SUM(IFNULL(lrd_jumlah,0)) jml_cetak_sublim
            FROM tlhk_rtr_dtl
            GROUP BY 1
        ) rtr ON rtr.lrd_spk_nomor = spk_nomor`;

      joinSizeLhk = `
        LEFT JOIN (
            SELECT 
                lrd_spk_nomor, 
                lrd_poid_size, 
                lrd_komponen,
                SUM(IFNULL(lrd_jumlah, 0)) AS qty_cetak_komponen
            FROM tlhk_rtr_dtl
            WHERE lrd_poid_size != '-' AND lrd_poid_size != ''
            GROUP BY lrd_spk_nomor, lrd_poid_size, lrd_komponen
        ) sz_lhk ON sz_lhk.lrd_spk_nomor = spks_nomor AND sz_lhk.lrd_poid_size = spks_size
      `;

      // K-Mutasi P04 = qty order yang belum dimutasi dari Sublim (RTR/P04)
      // ke Gudang Potong P04 (GP001). Sumber qty mutasi: tmutasiproduksi_*.
      // Mutasi lanjutan dari Potong (GP001 -> QC Potong, DC, dll.) tidak
      // dihitung karena asalnya bukan gudang Sublim.
      joinMutasiP04 = `
        LEFT JOIN (
            SELECT d.mpd_spk AS mut_spk,
                   SUM(IFNULL(d.mpd_jumlah, 0)) AS qty_mutasi
            FROM tmutasiproduksi_dtl d
            INNER JOIN tmutasiproduksi_hdr h ON h.mph_nomor = d.mpd_mph_nomor
            WHERE ${SUBLIM_TO_POTONG_P04_FILTER}
            GROUP BY d.mpd_spk
        ) mut_p04 ON mut_p04.mut_spk = tspk.spk_nomor
      `;
      fieldKrgMutasiP04 = "GREATEST(0, spk_jumlah - IFNULL(mut_p04.qty_mutasi, 0)) AS krg_mutasi_p04";
    }
    // Query Utama Monitoring LMKP
    const sql = `
        SELECT 
            spk_nomor AS NOMOR, spk_memo, spk_tanggal, spk_dateline AS deadline, spk_nama,
            spk_statuskerja, spk_workshop, zz.DIVISI, jo_nama,
            IF(spk_jumlah_kirim >= spk_jumlah, 'Closed', 'Open') AS status,
            spk_panjang AS PANJANG, spk_lebar AS LEBAR, spk_kain AS KAIN, spk_gramasi, spk_finishing AS FINISHING,
            spk_jumlah, spk_jumlah_kirim,

            spk_jumlah - spk_jumlah_kirim AS krg_kirim,
            spk_jumlah - IFNULL(gg.jseaming, 0) AS krg_Seaming,
            spk_jumlah - IFNULL(gg.jmataayam, 0) AS krg_mataayam,
            spk_jumlah - IFNULL(gg.jcoly, 0) AS krg_coly,
            
            spk_jumlah - IF(spk_jumlah < ${fieldJmlCetak}, spk_jumlah, ${fieldJmlCetak}) - IFNULL(h.cetak_luarx, 0) AS krg_Cetak,
            ${fieldKrgMutasiP04},

            (spk_jumlah - spk_jumlah_kirim) * spk_panjang * IF(spk_divisi=5, IFNULL(spk_lebar, 0), 1) AS krg_kirim_meter,
            (spk_jumlah - IF(spk_jumlah < ${fieldJmlCetak}, spk_jumlah, ${fieldJmlCetak}) - IFNULL(h.cetak_luarx, 0)) * spk_panjang * IFNULL(spk_lebar, 0) AS krg_Cetak_meter,
            (spk_jumlah - IFNULL(gg.jcoly, 0)) * spk_panjang * IFNULL(spk_lebar, 0) AS krg_coly_meter,

            ${selectMesinFields},
            IFNULL(h.cetak_luarx, 0) AS cetak_luarx

        FROM tspk
        INNER JOIN tcustomer ON spk_cus_kode = cus_kode
        LEFT JOIN tsales ON sal_kode = spk_sal_kode
        LEFT JOIN tjenisorder ON jo_kode = spk_jo_kode
        LEFT JOIN tdivisi zz ON zz.kode = spk_divisi
        
        LEFT JOIN (
            SELECT poe_spk_nomor poe_Spk, SUM(IFNULL(poe_jumlah, 0)) cetak_luarx 
            FROM tpoexternal_hdr WHERE poe_cab='P05' GROUP BY 1
        ) h ON h.poe_spk = spk_nomor

        ${joinLhkCetak}
        ${joinMutasiP04}

        LEFT JOIN (
            SELECT lfd_spk_nomor, 
                   SUM(lfd_j_Seaming) jseaming, 
                   SUM(lfd_j_mataayam) jmataayam, 
                   SUM(lfd_j_coly) jcoly 
            FROM tlhk_finishingmmt_dtl 
            GROUP BY 1
        ) gg ON gg.lfd_spk_nomor = spk_nomor

        WHERE spk_aktif = 'Y' 
          ${conditionExtra}
          AND spk_tanggal >= CONCAT(?, ' 00:00:00') 
          AND spk_tanggal <= CONCAT(?, ' 23:59:59')
        ORDER BY spk_nama
      `;

    const [rows] = await pool.query(sql, [startDate, endDate]);

    // Ambil data size HANYA jika kategori adalah Paperprint ('2') atau Sublim ('3')
    // Ambil data size & komponen HANYA jika kategori Paperprint ('2') atau Sublim ('3')
    let sizes = [];
    let spkKomponenMap = {};
    let spkKomponenKodeMap = {};
    let lhkSizeMap = {};
    let lhkAllSetMap = {};
    let mutasiSizeMap = {};
    const authoritativeSizeSpk = new Set();

    if (["2", "3"].includes(cbJenisIndex)) {
      // Paperprint membaca LHK Sublim; Sublim membaca LHK Roll to Roll (RTR).
      const tableDtl =
        cbJenisIndex === "2" ? "tlhk_sublim_dtl" : "tlhk_rtr_dtl";
      const prefix = cbJenisIndex === "2" ? "lsbd" : "lrd";
      const orderCol =
        cbJenisIndex === "2" ? "lsbd_jumlah_order" : "lrd_order";

      // Pastikan rows ada isinya sebelum mengambil nomor SPK
      if (rows && rows.length > 0) {
        const spkNomors = rows.map((r) => `'${r.NOMOR}'`).join(",");

        // 1. Ambil daftar komponen wajib dari tspk_komponen_potong dan tspk_komponen HANYA untuk SPK yang tampil
        const kompSql = `
        SELECT p.sk_nomor AS spk_nomor, p.sk_kode AS komponen_kode,
          k.bhn_name AS komponen_nama 
        FROM tspk_komponen_potong p
        INNER JOIN tbahan k ON k.bhn_kode = p.sk_kode
        WHERE p.sk_nomor IN (${spkNomors})
        UNION
        SELECT DISTINCT ${prefix}_spk_nomor AS spk_nomor,
          NULL AS komponen_kode,
          COALESCE(NULLIF(TRIM(${prefix}_komponen), ''), 'ALL SET') AS komponen_nama
        FROM ${tableDtl}
        WHERE ${prefix}_spk_nomor IN (${spkNomors}) 
          AND COALESCE(NULLIF(TRIM(${prefix}_komponen), ''), 'ALL SET') != 'ALL SET'
      `;
        const [kompRows] = await pool.query(kompSql);

        kompRows.forEach((k) => {
          if (!spkKomponenMap[k.spk_nomor]) {
            spkKomponenMap[k.spk_nomor] = [];
          }
          if (!spkKomponenMap[k.spk_nomor].includes(k.komponen_nama)) {
            spkKomponenMap[k.spk_nomor].push(k.komponen_nama);
          }

          const kompKode = normalizeKey(k.komponen_kode);
          if (kompKode) {
            if (!spkKomponenKodeMap[k.spk_nomor]) {
              spkKomponenKodeMap[k.spk_nomor] = {};
            }
            spkKomponenKodeMap[k.spk_nomor][kompKode] = k.komponen_nama;
          }
        });

        // 2. Ambil seluruh data LHK untuk SPK yang tampil
        const lhkDetailSql = `
        SELECT 
          ${prefix}_spk_nomor AS spk_nomor,
          ${prefix}_poid_size AS poid_size,
          COALESCE(NULLIF(TRIM(${prefix}_komponen), ''), 'ALL SET') AS komponen_nama,
          SUM(IFNULL(${prefix}_jumlah, 0)) AS qty_cetak
        FROM ${tableDtl}
        WHERE ${prefix}_spk_nomor IN (${spkNomors})
        GROUP BY ${prefix}_spk_nomor, ${prefix}_poid_size,
          COALESCE(NULLIF(TRIM(${prefix}_komponen), ''), 'ALL SET')
      `;
        const [lhkRows] = await pool.query(lhkDetailSql);

        // Qty order per size. Sumber paling akurat: LHK Roll to Roll
        // (lrd_order, per size). LHK Sublim menyimpan lsbd_jumlah_order
        // sebagai TOTAL order (nilainya sama untuk semua size), jadi hanya
        // dipakai bila memang berbeda per size.
        const rtrOrderSql = `
        SELECT lrd_spk_nomor AS spk_nomor,
               lrd_poid_size AS poid_size,
               MAX(IFNULL(lrd_order, 0)) AS qty_order
        FROM tlhk_rtr_dtl
        WHERE lrd_spk_nomor IN (${spkNomors})
        GROUP BY lrd_spk_nomor, lrd_poid_size
      `;
        const [rtrOrderRows] = await pool.query(rtrOrderSql);
        const rtrOrderMap = {};
        rtrOrderRows.forEach((o) => {
          const poidSize = String(o.poid_size ?? "").trim();
          if (!poidSize || poidSize === "-") return;
          if (!rtrOrderMap[o.spk_nomor]) rtrOrderMap[o.spk_nomor] = {};
          rtrOrderMap[o.spk_nomor][poidSize.toUpperCase()] = Number(
            o.qty_order || 0,
          );
        });

        const lhkOrderSql = `
        SELECT ${prefix}_spk_nomor AS spk_nomor,
               ${prefix}_poid_size AS poid_size,
               MAX(IFNULL(${orderCol}, 0)) AS qty_order
        FROM ${tableDtl}
        WHERE ${prefix}_spk_nomor IN (${spkNomors})
        GROUP BY ${prefix}_spk_nomor, ${prefix}_poid_size
      `;
        const [lhkOrderRows] = await pool.query(lhkOrderSql);
        const lhkOrderMap = {};
        lhkOrderRows.forEach((o) => {
          const poidSize = String(o.poid_size ?? "").trim();
          if (!poidSize || poidSize === "-") return;
          if (!lhkOrderMap[o.spk_nomor]) lhkOrderMap[o.spk_nomor] = {};
          lhkOrderMap[o.spk_nomor][poidSize.toUpperCase()] = Number(
            o.qty_order || 0,
          );
        });

        lhkRows.forEach((l) => {
          if (!lhkSizeMap[l.spk_nomor]) lhkSizeMap[l.spk_nomor] = {};

          // LHK lama tidak menyimpan komponen (NULL/'').
          // Anggap "ALL SET" agar qty produksi tetap dihitung untuk semua
          // komponen, bukan dianggap 0 (yang membuat K-Cetak tampak penuh).
          const komponenNama =
            String(l.komponen_nama ?? "").trim() || "ALL SET";
          const poidSize = String(l.poid_size ?? "").trim();
          const isNoSize = poidSize === "" || poidSize === "-";

          if (isNoSize) {
            if (komponenNama === "ALL SET") {
              if (!lhkAllSetMap[l.spk_nomor])
                lhkAllSetMap[l.spk_nomor] = { ALL_SET_GLOBAL: 0 };
              lhkAllSetMap[l.spk_nomor]["ALL_SET_GLOBAL"] += Number(
                l.qty_cetak,
              );
            } else {
              if (!lhkAllSetMap[l.spk_nomor]) lhkAllSetMap[l.spk_nomor] = {};
              lhkAllSetMap[l.spk_nomor][komponenNama] =
                (lhkAllSetMap[l.spk_nomor][komponenNama] || 0) +
                Number(l.qty_cetak);
            }
          } else {
            const sizeKey = poidSize.toUpperCase();
            if (!lhkSizeMap[l.spk_nomor][sizeKey])
              lhkSizeMap[l.spk_nomor][sizeKey] = {};
            lhkSizeMap[l.spk_nomor][sizeKey][komponenNama] =
              (lhkSizeMap[l.spk_nomor][sizeKey][komponenNama] || 0) +
              Number(l.qty_cetak);
          }
        });

        // 3. Ambil data mutasi per ukuran/komponen untuk detail Sublim.
        // Hanya mutasi Sublim/RTR -> Potong P04 yang dipakai, sama seperti
        // kolom K-Mutasi P04 pada tabel utama.
        if (cbJenisIndex === "3") {
          const mutasiDetailSql = `
          SELECT
            d.mpd_spk AS spk_nomor,
            d.mpd_size AS size,
            d.mpd_bhn_kode AS komponen_kode,
            d.mpd_nama AS komponen_nama,
            SUM(IFNULL(d.mpd_jumlah, 0)) AS qty_mutasi
          FROM tmutasiproduksi_dtl d
          INNER JOIN tmutasiproduksi_hdr h ON h.mph_nomor = d.mpd_mph_nomor
          WHERE d.mpd_spk IN (${spkNomors})
            AND ${SUBLIM_TO_POTONG_P04_FILTER}
          GROUP BY d.mpd_spk, d.mpd_size, d.mpd_bhn_kode, d.mpd_nama
        `;
          const [mutasiRows] = await pool.query(mutasiDetailSql);

          mutasiRows.forEach((m) => {
            const spk = m.spk_nomor;
            if (!spk) return;

            const sizeKey = normalizeKey(m.size) || "*";
            const rawCode = normalizeKey(m.komponen_kode);
            const rawName = normalizeKey(m.komponen_nama);
            const codeMap = spkKomponenKodeMap[spk] || {};
            const nameSet = new Set(
              (spkKomponenMap[spk] || []).map((name) => normalizeKey(name)),
            );

            // Mutasi baru menyimpan kode/nama bahan (bukan nama komponen),
            // sehingga diperlakukan sebagai ALL SET untuk ukuran tersebut.
            // Mutasi lama yang menyimpan kode/nama komponen dipetakan ke
            // komponen yang sesuai.
            let kompKey = "ALL SET";
            if (rawCode && codeMap[rawCode]) {
              kompKey = normalizeKey(codeMap[rawCode]);
            } else if (rawName && nameSet.has(rawName)) {
              kompKey = rawName;
            }

            if (!mutasiSizeMap[spk]) mutasiSizeMap[spk] = {};
            if (!mutasiSizeMap[spk][sizeKey]) mutasiSizeMap[spk][sizeKey] = {};
            mutasiSizeMap[spk][sizeKey][kompKey] =
              (mutasiSizeMap[spk][sizeKey][kompKey] || 0) +
              Number(m.qty_mutasi || 0);
          });
        }

        // 4. Ambil data size dari tspk_size
        const sizeSql = `
        SELECT spks_nomor, spks_size, spks_qty 
        FROM tspk_size 
        WHERE spks_nomor IN (${spkNomors})
      `;
        const [sizeRows] = await pool.query(sizeSql);
        sizes = sizeRows;
        sizeRows.forEach((s) => authoritativeSizeSpk.add(s.spks_nomor));

        // Fallback detail ukuran: sebagian SPK lama tidak punya baris
        // tspk_size, tetapi rincian ukurannya masih tersimpan di
        // tspk.spk_ukuran (contoh: "L=15, XL=20, 2XL=10, 3XL=5").
        const sizeSpkSet = new Set(sizeRows.map((s) => s.spks_nomor));
        const missingSizeSpk = rows
          .map((r) => r.NOMOR)
          .filter((n) => n && !sizeSpkSet.has(n));

        if (missingSizeSpk.length > 0) {
          const inList = missingSizeSpk.map((n) => `'${n}'`).join(",");
          const [ukuranRows] = await pool.query(
            `SELECT spk_nomor, spk_ukuran, spk_jumlah
             FROM tspk WHERE spk_nomor IN (${inList})`,
          );
          const sizeFilled = new Set();

          ukuranRows.forEach((u) => {
            const parsed = parseUkuranText(u.spk_ukuran);
            if (parsed.length === 0) return;

            parsed.forEach((p) => {
              sizes.push({
                spks_nomor: u.spk_nomor,
                spks_size: p.size,
                spks_qty: p.qty,
              });
            });
            sizeFilled.add(u.spk_nomor);

            // Anggap otoritatif bila total qty ukuran = jumlah order, agar
            // krg_Cetak total tetap akurat. Bila tidak, detail tetap tampil
            // tetapi total memakai hasil SQL.
            const totalSize = parsed.reduce((sum, p) => sum + p.qty, 0);
            if (totalSize === Number(u.spk_jumlah || 0)) {
              authoritativeSizeSpk.add(u.spk_nomor);
            }
          });

          // Fallback terakhir: SPK lama yang tspk_size & spk_ukuran-nya
          // kosong. Urutan sumber qty order per size:
          // 1) LHK Roll to Roll (lrd_order) — per size.
          // 2) LHK Sublim (lsbd_jumlah_order) — hanya bila bukan total
          //    order yang diulang untuk semua size.
          // 3) Qty produksi LHK per size (agar rincian tetap tampil).
          ukuranRows.forEach((u) => {
            if (sizeFilled.has(u.spk_nomor)) return;
            const spkNo = u.spk_nomor;
            const spkQty = Number(u.spk_jumlah || 0);

            const rtrSizes = rtrOrderMap[spkNo] || {};
            const hasRtrOrder = Object.values(rtrSizes).some(
              (q) => Number(q) > 0,
            );

            let orderSizes = null;

            if (hasRtrOrder) {
              orderSizes = rtrSizes;
            } else {
              const sublSizes = lhkOrderMap[spkNo] || {};
              const sublEntries = Object.entries(sublSizes).filter(
                ([, qty]) => Number(qty) > 0,
              );
              const allSameTotal =
                sublEntries.length > 0 &&
                sublEntries.every(([, qty]) => Number(qty) === spkQty);

              // Bila semua size berisi total order yang sama dan size-nya
              // lebih dari satu, angka itu tidak bisa dipakai per size.
              if (!allSameTotal || sublEntries.length === 1) {
                orderSizes = sublSizes;
              }
            }

            if (!orderSizes) {
              const prodSizes = lhkSizeMap[spkNo] || {};
              const derived = {};
              Object.entries(prodSizes).forEach(([size, komps]) => {
                const qty = Object.values(komps).reduce(
                  (sum, v) => sum + Number(v || 0),
                  0,
                );
                if (qty > 0) derived[size] = qty;
              });
              orderSizes = derived;
            }

            const entries = Object.entries(orderSizes || {}).filter(
              ([, qty]) => Number(qty) > 0,
            );
            if (entries.length === 0) return;

            let totalSize = 0;
            entries.forEach(([size, qty]) => {
              const qtyNum = Number(qty);
              sizes.push({
                spks_nomor: spkNo,
                spks_size: size,
                spks_qty: qtyNum,
              });
              totalSize += qtyNum;
            });

            if (totalSize === spkQty) {
              authoritativeSizeSpk.add(spkNo);
            }
          });
        }
      }
    }

    // Mapping data size dan komponen secara manual di Javascript
    const sizeMap = {};

    sizes.forEach((s) => {
      const spkNo = s.spks_nomor;
      const sizeName = s.spks_size;
      const sizeQty = Number(s.spks_qty || 0);

      if (!sizeMap[spkNo]) {
        sizeMap[spkNo] = [];
      }

      // Komponen wajib dari DB (tspk_komponen_potong / komponen eksplisit LHK).
      // Jika SPK memang tidak punya rincian komponen, jangan mengarang
      // BADAN DEPAN/BADAN BELAKANG/TANGAN-LENGAN; pakai "ALL SET" sesuai
      // data LHK (lsbd_komponen/lrd_komponen) yang ada.
      const standardKomponen = spkKomponenMap[spkNo] || ["ALL SET"];

      const lhkForThisSize =
        (lhkSizeMap[spkNo] &&
          lhkSizeMap[spkNo][String(sizeName ?? "").trim().toUpperCase()]) ||
        {};
      const lhkGlobalAllSet =
        (lhkAllSetMap[spkNo] && lhkAllSetMap[spkNo]["ALL_SET_GLOBAL"]) || 0;

      const sizeKey = normalizeKey(sizeName);
      const mutasiForThisSize =
        (mutasiSizeMap[spkNo] && mutasiSizeMap[spkNo][sizeKey]) || {};
      const mutasiGlobal =
        (mutasiSizeMap[spkNo] && mutasiSizeMap[spkNo]["*"]) || {};

      const components = [];

      standardKomponen.forEach((komp) => {
        const isAllSet = String(komp).trim().toUpperCase() === "ALL SET";
        let qtyCetakKomponen = Number(lhkForThisSize[komp] || 0);

        // Qty "ALL SET" berlaku untuk semua komponen, kecuali komponennya
        // memang ALL SET itu sendiri (agar tidak terhitung dua kali).
        if (!isAllSet && lhkForThisSize["ALL SET"]) {
          qtyCetakKomponen += Number(lhkForThisSize["ALL SET"]);
        }
        qtyCetakKomponen += lhkGlobalAllSet;

        const kompKey = normalizeKey(komp);
        const qtyMutasiKomponen =
          Number(mutasiForThisSize[kompKey] || 0) +
          (kompKey === "ALL SET"
            ? 0
            : Number(mutasiForThisSize["ALL SET"] || 0)) +
          Number(mutasiGlobal[kompKey] || 0) +
          (kompKey === "ALL SET"
            ? 0
            : Number(mutasiGlobal["ALL SET"] || 0));

        components.push({
          komponen_nama: komp,
          qty_cetak: qtyCetakKomponen,
          kurang_cetak: Math.max(0, sizeQty - qtyCetakKomponen),
          qty_mutasi: qtyMutasiKomponen,
          kurang_mutasi: Math.max(0, sizeQty - qtyMutasiKomponen),
        });
      });

      const minComponentCetak =
        components.length > 0
          ? Math.min(...components.map((c) => c.qty_cetak))
          : 0;
      const sizeKrgCetak = Math.max(0, sizeQty - minComponentCetak);

      const minComponentMutasi =
        components.length > 0
          ? Math.min(...components.map((c) => c.qty_mutasi))
          : 0;
      const sizeKrgMutasi = Math.max(0, sizeQty - minComponentMutasi);

      sizeMap[spkNo].push({
        size_name: sizeName,
        size_qty: sizeQty,
        size_krg_cetak: sizeKrgCetak,
        size_krg_mutasi: sizeKrgMutasi,
        components: components,
      });
    });

    const finalRows = rows.map((row) => {
      const sizesForThisSpk = sizeMap[row.NOMOR] || [];

      let finalKrgCetak = row.krg_Cetak; // Ambil bawaan dari SQL

      // Jika kategori Paperprint ('2') atau Sublim ('3'), baru timpa dengan
      // hitungan size — hanya bila SPK memang punya daftar size. Bila
      // tspk_size kosong, pakai hasil SQL (total LHK) agar tidak selalu 0.
      if (
        ["2", "3"].includes(cbJenisIndex) &&
        authoritativeSizeSpk.has(row.NOMOR)
      ) {
        finalKrgCetak = sizesForThisSpk.reduce(
          (sum, s) => sum + Number(s.size_krg_cetak || 0),
          0,
        );
      }

      return {
        ...row,
        krg_Cetak: finalKrgCetak,
        sizes: sizesForThisSpk,
      };
    });

    return finalRows;
  } catch (error) {
    throwDbError("Gagal mengambil data LMKP", error);
  }
};

exports.getKapasitasMesin = async (cbJenisIndex) => {
  try {
    let sql = "";
    if (cbJenisIndex === "0" || cbJenisIndex === "4") {
      // Maklon P05 juga dikerjakan di mesin cetak (MT), jadi kapasitasnya
      // memakai kelompok mesin 'C' seperti kategori MT.
      sql =
        "SELECT SUM(msn_kapasitas) output FROM tmesin_mmt WHERE msn_JENIS='C'";
    } else {
      sql =
        "SELECT SUM(msn_kapasitas) output FROM tmesin_mmt WHERE msn_JENIS='T'";
    }

    const [rows] = await pool.query(sql);
    return rows[0]?.output || 0;
  } catch (error) {
    throwDbError("Gagal mengambil kapasitas mesin", error);
  }
};
