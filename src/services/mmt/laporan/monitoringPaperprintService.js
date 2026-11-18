const pool = require('../../../config/database');
const { format } = require("date-fns");

const lapMonCetakPaperprint = async (startDate, endDate) => {
  const tglMulai = format(new Date(startDate), "yyyy-MM-dd");
  const tglSelesai = format(new Date(endDate), "yyyy-MM-dd");

  const ssql = `
    SELECT
        /* =====================================================
            DATA SPK
        ===================================================== */
        spk.spk_perush_kode AS PERUSH,
        spk.spk_nomor AS NO_SPK,
        spk.spk_nama AS NAMA_ORDER,
        spk.spk_jumlah AS ORDER_SPK_PCS,
        
        /* PANJANG DAN LEBAR DARI tlhk_sublim_dtl */
        COALESCE(lhk.PANJANG, 0) AS PANJANG,
        COALESCE(lhk.LEBAR, 0) AS LEBAR,

        DATE_FORMAT(spk.spk_tanggal, '%Y-%m-%d') AS TGL_SPK,
        DATE_FORMAT(spk.spk_dateline, '%Y-%m-%d') AS DEADLINE,

        /* =====================================================
            DATA LHK
        ===================================================== */
        COALESCE(lhk.NO_LHK, '-') AS NO_LHK,
        CASE
            WHEN lhk.TANGGAL_LHK IS NULL THEN '-'
            ELSE DATE_FORMAT(lhk.TANGGAL_LHK, '%Y-%m-%d')
        END AS TANGGAL_LHK,

        /* =====================================================
            ORDER METER
        ===================================================== */
        (
            COALESCE(spk.spk_jumlah, 0)
            * COALESCE(spk.spk_panjang, 0)
            * COALESCE(spk.spk_lebar, 0)
        ) AS ORDER_SPK_METER,

        /* CETAK LUAR */
        COALESCE(ext.CETAK_LUAR, 0) AS CETAK_LUAR,

        /* PCS PER MESIN MENTAH DARI LHK */
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

    /* =========================================================
        LHK SUBLIM (DIKUMPULKAN PER SPK)
    ========================================================= */
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

            SUM(
                CASE WHEN TRIM(d.lsbd_lokasi) = 'SB01' 
                THEN (COALESCE(d.lsbd_panjang, 0) * COALESCE(d.lsbd_lebar, 0) * COALESCE(d.lsbd_jumlah, 0)) ELSE 0 END
            ) AS METER_SB01,
            SUM(
                CASE WHEN TRIM(d.lsbd_lokasi) = 'SB02' 
                THEN (COALESCE(d.lsbd_panjang, 0) * COALESCE(d.lsbd_lebar, 0) * COALESCE(d.lsbd_jumlah, 0)) ELSE 0 END
            ) AS METER_SB02,
            SUM(
                CASE WHEN TRIM(d.lsbd_lokasi) = 'SB03' 
                THEN (COALESCE(d.lsbd_panjang, 0) * COALESCE(d.lsbd_lebar, 0) * COALESCE(d.lsbd_jumlah, 0)) ELSE 0 END
            ) AS METER_SB03,
            SUM(
                CASE WHEN TRIM(d.lsbd_lokasi) = 'SB04' 
                THEN (COALESCE(d.lsbd_panjang, 0) * COALESCE(d.lsbd_lebar, 0) * COALESCE(d.lsbd_jumlah, 0)) ELSE 0 END
            ) AS METER_SB04,
            SUM(
                CASE WHEN TRIM(d.lsbd_lokasi) = 'SB05' 
                THEN (COALESCE(d.lsbd_panjang, 0) * COALESCE(d.lsbd_lebar, 0) * COALESCE(d.lsbd_jumlah, 0)) ELSE 0 END
            ) AS METER_SB05

        FROM tlhk_sublim_dtl d
        INNER JOIN tlhk_sublim_hdr h
            ON TRIM(h.lsb_nomor) = TRIM(d.lsbd_lsb_nomor)
        GROUP BY d.lsbd_spk_nomor
    ) lhk ON TRIM(lhk.NOMOR_SPK) = TRIM(spk.spk_nomor)

    /* =========================================================
        CETAK LUAR
    ========================================================= */
    LEFT JOIN (
        SELECT
            poe_spk_nomor,
            SUM(COALESCE(poe_jumlah, 0)) AS CETAK_LUAR
        FROM tpoexternal_hdr
        WHERE poe_cab = 'P05'
        GROUP BY poe_spk_nomor
    ) ext ON TRIM(ext.poe_spk_nomor) = TRIM(spk.spk_nomor)

    WHERE spk.spk_aktif = 'Y'
      AND spk.spk_sublim = 'Y'
      AND spk.spk_tanggal BETWEEN ? AND ?
    ORDER BY
      spk.spk_tanggal ASC,
      spk.spk_nomor ASC
  `;

  const params = [tglMulai, tglSelesai];
  const connection = await pool.getConnection();

  try {
    const [rows] = await connection.execute(ssql, params);

    const spkNomors = rows.map((r) => r.NO_SPK);
    let sizeMap = {};

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

      sizeMap = {};
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

    const finalRows = rows.map((row) => {
      const sizesArray = Object.values(sizeMap[row.NO_SPK] || {});
      const totalJmlPcs = sizesArray.reduce(
        (sum, s) => sum + s.qty_cetak_size,
        0,
      );

      const orderPcs = Number(row.ORDER_SPK_PCS || 0);
      const cetakLuar = Number(row.CETAK_LUAR || 0);
      const kurangVariant = orderPcs - (totalJmlPcs + cetakLuar);

      // Menyesuaikan proporsi mesin jika total mesin asli berbeda dari totalJmlPcs yang valid
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
        // Jika data mesin dari SQL kosong tapi ukuran valid, asumsikan masuk ke mesin utama (misal SB03 atau default)
        pcsSb03 = totalJmlPcs;
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
    console.error("Error lapMonCetakPaperprint:", error);
    throw error;
  } finally {
    connection.release();
  }
};

module.exports = {
  lapMonCetakPaperprint,
};
