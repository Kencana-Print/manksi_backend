const pool = require('../../../config/database');
const { format } = require("date-fns");

/**
 * Service untuk menarik data Laporan Monitoring Sublim
 * Diselaraskan sepenuhnya dengan format dan struktur output paperprint
 * @param {string} startDate - Format 'YYYY-MM-DD'
 * @param {string} endDate - Format 'YYYY-MM-DD'
 */
const lapMonSublim = async (startDate, endDate) => {
  const tglMulai = format(new Date(startDate), "yyyy-MM-dd");
  const tglSelesai = format(new Date(endDate), "yyyy-MM-dd");

  // 1. Query Utama: Data SPK, Agregasi LHK Sublim, dan PO Internal
  const ssql = `
    SELECT 
        spk.spk_perush_kode AS PERUSH,
        spk.spk_nomor AS NO_SPK,
        spk.spk_nama AS NAMA_ORDER,
        spk.spk_jumlah AS ORDER_SPK_PCS,
        
        /* PANJANG DAN LEBAR DARI tlhk_sublim_dtl */
        COALESCE(lhk.PANJANG, 0) AS PANJANG,
        COALESCE(lhk.LEBAR, 0) AS LEBAR,

        DATE_FORMAT(spk.spk_tanggal, '%Y-%m-%d') AS TGL_SPK,
        DATE_FORMAT(spk.spk_dateline, '%Y-%m-%d') AS DEADLINE,

        /* DATA LHK */
        COALESCE(lhk.NO_LHK, '-') AS NO_LHK,
        CASE
            WHEN lhk.TANGGAL_LHK IS NULL THEN '-'
            ELSE DATE_FORMAT(lhk.TANGGAL_LHK, '%Y-%m-%d')
        END AS TANGGAL_LHK,

        /* ORDER METER */
        (
            COALESCE(spk.spk_jumlah, 0)
            * COALESCE(spk.spk_panjang, 0)
            * COALESCE(spk.spk_lebar, 0)
        ) AS ORDER_SPK_METER,

        /* PO INTERNAL (P05) SEBAGAI CETAK LUAR / PO */
        COALESCE(poi.PO_JUMLAH, 0) AS CETAK_LUAR,

        /* PCS PER MESIN DARI LHK */
        COALESCE(lhk.PCS_SB01, 0) AS PCS_SB01,
        COALESCE(lhk.PCS_SB02, 0) AS PCS_SB02,
        COALESCE(lhk.PCS_SB03, 0) AS PCS_SB03,
        COALESCE(lhk.PCS_SB04, 0) AS PCS_SB04,
        COALESCE(lhk.PCS_SB05, 0) AS PCS_SB05,

        /* METER PER MESIN */
        COALESCE(lhk.METER_SB01, 0) AS METER_SB01,
        COALESCE(lhk.METER_SB02, 0) AS METER_SB02,
        COALESCE(lhk.METER_SB03, 0) AS METER_SB03,
        COALESCE(lhk.METER_SB04, 0) AS METER_SB04,
        COALESCE(lhk.METER_SB05, 0) AS METER_SB05,
        COALESCE(lhk.JUMLAH_METER, 0) AS JUMLAH_METER

    FROM tspk spk

    /* LEFT JOIN LHK SUBLIM PER SPK */
    LEFT JOIN (
        SELECT
            d.lsbd_spk_nomor AS NOMOR_SPK,

            MAX(COALESCE(d.lsbd_panjang, 0)) AS PANJANG,
            MAX(COALESCE(d.lsbd_lebar, 0)) AS LEBAR,

            MAX(h.lsb_nomor) AS NO_LHK,
            MAX(h.lsb_tanggal) AS TANGGAL_LHK,

            SUM(
                COALESCE(d.lsbd_panjang, 0) 
                * COALESCE(d.lsbd_lebar, 0) 
                * COALESCE(d.lsbd_jumlah, 0)
            ) AS JUMLAH_METER,

            SUM(CASE WHEN TRIM(d.lsbd_lokasi) = 'SB01' THEN COALESCE(d.lsbd_jumlah, 0) ELSE 0 END) AS PCS_SB01,
            SUM(CASE WHEN TRIM(d.lsbd_lokasi) = 'SB02' THEN COALESCE(d.lsbd_jumlah, 0) ELSE 0 END) AS PCS_SB02,
            SUM(CASE WHEN TRIM(d.lsbd_lokasi) = 'SB03' THEN COALESCE(d.lsbd_jumlah, 0) ELSE 0 END) AS PCS_SB03,
            SUM(CASE WHEN TRIM(d.lsbd_lokasi) = 'SB04' THEN COALESCE(d.lsbd_jumlah, 0) ELSE 0 END) AS PCS_SB04,
            SUM(CASE WHEN TRIM(d.lsbd_lokasi) = 'SB05' THEN COALESCE(d.lsbd_jumlah, 0) ELSE 0 END) AS PCS_SB05,

            SUM(CASE WHEN TRIM(d.lsbd_lokasi) = 'SB01' THEN (COALESCE(d.lsbd_panjang, 0) * COALESCE(d.lsbd_lebar, 0) * COALESCE(d.lsbd_jumlah, 0)) ELSE 0 END) AS METER_SB01,
            SUM(CASE WHEN TRIM(d.lsbd_lokasi) = 'SB02' THEN (COALESCE(d.lsbd_panjang, 0) * COALESCE(d.lsbd_lebar, 0) * COALESCE(d.lsbd_jumlah, 0)) ELSE 0 END) AS METER_SB02,
            SUM(CASE WHEN TRIM(d.lsbd_lokasi) = 'SB03' THEN (COALESCE(d.lsbd_panjang, 0) * COALESCE(d.lsbd_lebar, 0) * COALESCE(d.lsbd_jumlah, 0)) ELSE 0 END) AS METER_SB03,
            SUM(CASE WHEN TRIM(d.lsbd_lokasi) = 'SB04' THEN (COALESCE(d.lsbd_panjang, 0) * COALESCE(d.lsbd_lebar, 0) * COALESCE(d.lsbd_jumlah, 0)) ELSE 0 END) AS METER_SB04,
            SUM(CASE WHEN TRIM(d.lsbd_lokasi) = 'SB05' THEN (COALESCE(d.lsbd_panjang, 0) * COALESCE(d.lsbd_lebar, 0) * COALESCE(d.lsbd_jumlah, 0)) ELSE 0 END) AS METER_SB05

        FROM tlhk_sublim_dtl d
        INNER JOIN tlhk_sublim_hdr h
            ON TRIM(h.lsb_nomor) = TRIM(d.lsbd_lsb_nomor)
        WHERE h.lsb_tanggal BETWEEN ? AND ?
        GROUP BY d.lsbd_spk_nomor
    ) lhk ON TRIM(lhk.NOMOR_SPK) = TRIM(spk.spk_nomor)

    /* LEFT JOIN PO INTERNAL (P05 & LL-000400) */
    LEFT JOIN (
        SELECT
            h.poi_spk_nomor,
            SUM(COALESCE(d.poid_jumlah, 0)) AS PO_JUMLAH
        FROM tpointernal_hdr h
        INNER JOIN tpointernal_dtl d ON d.poid_nomor = h.poi_nomor
        WHERE h.poi_sup = 'P05'
          AND d.poid_bhn_kode = 'LL-000400'
          AND h.poi_tanggal BETWEEN ? AND ?
        GROUP BY h.poi_spk_nomor
    ) poi ON TRIM(poi.poi_spk_nomor) = TRIM(spk.spk_nomor)

    WHERE spk.spk_aktif = 'Y'
      AND spk.spk_sublim = 'Y'
      AND spk.spk_tanggal BETWEEN ? AND ?
    ORDER BY spk.spk_tanggal ASC, spk.spk_nomor ASC
  `;

  // Filter parameter (LHK, PO Internal, SPK)
  const params = [
    tglMulai,
    tglSelesai,
    tglMulai,
    tglSelesai,
    tglMulai,
    tglSelesai,
  ];
  const connection = await pool.getConnection();

  try {
    console.time("QUERY LAP MON SUBLIM");
    const [rows] = await connection.execute(ssql, params);
    console.timeEnd("QUERY LAP MON SUBLIM");

    const spkNomors = rows.map((r) => r.NO_SPK);
    let sizeMap = {};

    // 2. Query Detail Ukuran & Komponen Berdasarkan SPK (Batch Query)
    if (spkNomors.length > 0) {
      const placeholders = spkNomors.map(() => "?").join(",");

      const structureSql = `
        SELECT 
            spks_nomor,
            spks_size AS size_name,
            spks_qty AS size_qty,
            COALESCE(kp.sk_kode, '-') AS komponen_code,
            COALESCE(b.bhn_name, '-') AS komponen_name
        FROM tspk_size
        LEFT JOIN tspk_komponen_potong kp ON kp.sk_nomor = spks_nomor 
        LEFT JOIN tbahan b ON b.bhn_kode = kp.sk_kode
        WHERE spks_nomor IN (${placeholders})
      `;
      const [structureRows] = await connection.execute(structureSql, spkNomors);

      const lhkDetailSql = `
        SELECT 
            lsbd_spk_nomor,
            lsbd_poid_size,
            lsbd_komponen,
            IFNULL(lsbd_jumlah, 0) AS lsbd_jumlah
        FROM tlhk_sublim_dtl
        WHERE lsbd_spk_nomor IN (${placeholders})
      `;
      const [lhkDetailRows] = await connection.execute(lhkDetailSql, spkNomors);

      let tempSizeMap = {};

      structureRows.forEach((r) => {
        if (!tempSizeMap[r.spks_nomor]) {
          tempSizeMap[r.spks_nomor] = {};
        }
        if (!tempSizeMap[r.spks_nomor][r.size_name]) {
          tempSizeMap[r.spks_nomor][r.size_name] = {
            size_name: r.size_name,
            size_qty: Number(r.size_qty || 0),
            komponenMap: {},
          };
        }
        if (
          !tempSizeMap[r.spks_nomor][r.size_name].komponenMap[r.komponen_name]
        ) {
          tempSizeMap[r.spks_nomor][r.size_name].komponenMap[r.komponen_name] =
            {
              komponen_code: r.komponen_code,
              komponen_name: r.komponen_name,
              qty_cetak: 0,
            };
        }
      });

      lhkDetailRows.forEach((lhk) => {
        const spkNo = lhk.lsbd_spk_nomor;
        if (!tempSizeMap[spkNo]) return;

        const lhkSize = String(lhk.lsbd_poid_size || "").trim();
        const lhkKomponen = String(lhk.lsbd_komponen || "")
          .trim()
          .toUpperCase();
        const jumlah = Number(lhk.lsbd_jumlah || 0);

        Object.keys(tempSizeMap[spkNo]).forEach((sizeName) => {
          const matchSize =
            lhkSize === "-" || lhkSize === "" || lhkSize === sizeName;
          if (!matchSize) return;

          const sizeObj = tempSizeMap[spkNo][sizeName];

          Object.keys(sizeObj.komponenMap).forEach((kompName) => {
            const kompNameUpper = kompName.toUpperCase();
            const matchKomponen =
              lhkKomponen === "ALL SET" || kompNameUpper === lhkKomponen;
            if (matchKomponen) {
              sizeObj.komponenMap[kompName].qty_cetak += jumlah;
            }
          });
        });
      });

      // Mapping akhir dan kalkulasi kekurangan per ukuran & komponen
      Object.keys(tempSizeMap).forEach((spkNomor) => {
        sizeMap[spkNomor] = {};
        Object.keys(tempSizeMap[spkNomor]).forEach((sizeName) => {
          const sizeObj = tempSizeMap[spkNomor][sizeName];
          const komponenArray = Object.values(sizeObj.komponenMap);
          const qtyValues = komponenArray.map((k) => k.qty_cetak);

          const minQtyCetak = qtyValues.length > 0 ? Math.min(...qtyValues) : 0;
          const sizeKrgCetak = sizeObj.size_qty - minQtyCetak;

          sizeMap[spkNomor][sizeName] = {
            size_name: sizeObj.size_name,
            size_qty: sizeObj.size_qty,
            qty_cetak_size: minQtyCetak,
            size_krg_cetak: sizeKrgCetak,
            komponen: komponenArray.map((k) => ({
              ...k,
              size_krg_cetak: sizeObj.size_qty - k.qty_cetak,
            })),
          };
        });
      });
    }

    // 3. Gabungkan Hasil Akhir dengan Proporsi Mesin & Kalkulasi Varian
    const finalRows = rows.map((row) => {
      const sizesArray = Object.values(sizeMap[row.NO_SPK] || {});
      const totalJmlPcs = sizesArray.reduce(
        (sum, s) => sum + s.qty_cetak_size,
        0,
      );

      const orderPcs = Number(row.ORDER_SPK_PCS || 0);
      const cetakLuar = Number(row.CETAK_LUAR || 0);
      const kurangVariant = orderPcs - (totalJmlPcs + cetakLuar);

      let pcsSb01 = Number(row.PCS_SB01 || 0);
      let pcsSb02 = Number(row.PCS_SB02 || 0);
      let pcsSb03 = Number(row.PCS_SB03 || 0);
      let pcsSb04 = Number(row.PCS_SB04 || 0);
      let pcsSb05 = Number(row.PCS_SB05 || 0);
      const totalMesinAsli = pcsSb01 + pcsSb02 + pcsSb03 + pcsSb04 + pcsSb05;

      if (
        totalMesinAsli > 0 &&
        totalMesinAsli !== totalJmlPcs &&
        totalJmlPcs > 0
      ) {
        const ratio = totalJmlPcs / totalMesinAsli;
        pcsSb01 = Math.round(pcsSb01 * ratio);
        pcsSb02 = Math.round(pcsSb02 * ratio);
        pcsSb03 = Math.round(pcsSb03 * ratio);
        pcsSb04 = Math.round(pcsSb04 * ratio);
        pcsSb05 = Math.round(pcsSb05 * ratio);
      } else if (totalMesinAsli === 0 && totalJmlPcs > 0) {
        pcsSb03 = totalJmlPcs; // Fallback default ke mesin utama
      }

      return {
        ...row,
        PCS_SB01: String(pcsSb01),
        PCS_SB02: String(pcsSb02),
        PCS_SB03: String(pcsSb03),
        PCS_SB04: String(pcsSb04),
        PCS_SB05: String(pcsSb05),
        JUMLAH_PCS: String(totalJmlPcs),
        KURANG_VARIANT: kurangVariant,
        sizes: sizesArray,
      };
    });

    return finalRows;
  } catch (error) {
    console.error("Backend Error lapMonSublim:", error);
    throw error;
  } finally {
    if (connection) connection.release();
  }
};

module.exports = { lapMonSublim };
