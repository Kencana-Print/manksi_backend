const pool = require("../../../config/database");
const { format } = require("date-fns");

const NOMERATOR = "MMT-LHK-T";

/**
 * Mengambil daftar master LHK (Header List)
 */
const getAllHeaders = async (startDate, endDate) => {
  const defaultStart = new Date();
  defaultStart.setDate(defaultStart.getDate() - 30);
  const tglMulai = startDate ? format(new Date(startDate), "yyyy-MM-dd") : format(defaultStart, "yyyy-MM-dd");
  const tglSelesai = endDate ? format(new Date(endDate), "yyyy-MM-dd") : format(new Date(), "yyyy-MM-dd");

  const sql = `
        SELECT 
            h.lth_nomor AS Nomor, 
            DATE_FORMAT(h.lth_tanggal, '%Y-%m-%d') AS Tanggal,
            h.lth_gdg_prod AS Gudang, 
            g.gdg_nama AS Nama_Gudang, 
            h.lth_shift AS Shift,
            IFNULL(h.lth_status, 'DRAFT') AS Status,
            
            -- DATA BAHAN
            IFNULL(h.lth_brg_kode, '') AS Kode_bahan,
            b.brg_nama AS nama_Bahan,
            IF(LENGTH(IFNULL(h.lth_brg_kode, '')) > 0, 'Y', 'N') AS Lengkap,
            
            -- DATA MESIN & RINGKASAN SPK
            (SELECT GROUP_CONCAT(DISTINCT dtl.ltd_jns_mesin SEPARATOR ', ') 
             FROM tlhk_mesintekstil_dtl dtl WHERE dtl.ltd_lth_nomor = h.lth_nomor) AS Mesin,
            
            (SELECT CASE 
                WHEN COUNT(DISTINCT dtl.ltd_spk_nomor) > 1 THEN CONCAT('RETAIL (', COUNT(DISTINCT dtl.ltd_spk_nomor), ' SPK)')
                ELSE MIN(dtl.ltd_spk_nomor)
             END FROM tlhk_mesintekstil_dtl dtl WHERE dtl.ltd_lth_nomor = h.lth_nomor) AS NomorSPK,
            
            (SELECT CASE 
                WHEN COUNT(DISTINCT dtl.ltd_spk_nomor) > 1 THEN 'Multi-Pekerjaan Cetak Tekstil'
                ELSE MIN(x.spk_nama)
             END 
             FROM tlhk_mesintekstil_dtl dtl
             LEFT JOIN (SELECT spk_nomor, spk_nama FROM tspk UNION ALL SELECT mspk_nomor, mspk_nama FROM tmemospk) x ON x.spk_nomor = dtl.ltd_spk_nomor
             WHERE dtl.ltd_lth_nomor = h.lth_nomor) AS NamaOrder,
            
            (SELECT MIN(x.spk_panjang) FROM tlhk_mesintekstil_dtl dtl LEFT JOIN (SELECT spk_nomor, spk_panjang FROM tspk UNION ALL SELECT mspk_nomor, mspk_panjang FROM tmemospk) x ON x.spk_nomor = dtl.ltd_spk_nomor WHERE dtl.ltd_lth_nomor = h.lth_nomor) AS spk_panjang,
            (SELECT MIN(x.spk_lebar) FROM tlhk_mesintekstil_dtl dtl LEFT JOIN (SELECT spk_nomor, spk_lebar FROM tspk UNION ALL SELECT mspk_nomor, mspk_lebar FROM tmemospk) x ON x.spk_nomor = dtl.ltd_spk_nomor WHERE dtl.ltd_lth_nomor = h.lth_nomor) AS spk_lebar,
            
            -- JUMLAH ORDER DARI SPK (HEADER)
            IFNULL((SELECT SUM(x.spk_jumlah) FROM tlhk_mesintekstil_dtl dtl LEFT JOIN (SELECT spk_nomor, spk_jumlah FROM tspk UNION ALL SELECT mspk_nomor, mspk_jumlah FROM tmemospk) x ON x.spk_nomor = dtl.ltd_spk_nomor WHERE dtl.ltd_lth_nomor = h.lth_nomor), 0) AS JumlahOrder,
            
            -- Total Hasil Cetak Pcs/Meter
            IFNULL((SELECT SUM(dtl.ltd_qty_cetak) FROM tlhk_mesintekstil_dtl dtl WHERE dtl.ltd_lth_nomor = h.lth_nomor), 0) AS jumlah_cetak,
            
            IFNULL((SELECT MAX(dtl.ltd_ambil_bahan) FROM tlhk_mesintekstil_dtl dtl WHERE dtl.ltd_lth_nomor = h.lth_nomor), 0) AS PanjangBahanAwal,
            
            -- Sisa Bahan Akhir
            IFNULL(
                (SELECT m.mst_panjang 
                 FROM tmasterstok_mmt m 
                 WHERE m.mst_barcode = h.lth_barcode 
                   AND m.mst_noreferensi = h.lth_nomor 
                   AND m.mst_stok_in = '1' 
                 LIMIT 1), 
                0
            ) AS SisaMeterAkhir
             
        FROM tlhk_mesintekstil_hdr h
        LEFT JOIN tGUDANG g ON g.gdg_kode = h.lth_gdg_prod
        LEFT JOIN tbarang_mmt b ON b.brg_kode = h.lth_brg_kode
        WHERE h.lth_tanggal BETWEEN ? AND ?
        ORDER BY h.lth_tanggal DESC, h.lth_nomor DESC
    `;

  const [rows] = await pool.query(sql, [tglMulai, tglSelesai]);
  return rows;
};

const getInksByNomor = async (nomor) => {
  const sqlInk = `
        SELECT 
            lci_msn_kode AS msn_kode,
            lci_msn_kode AS Mesin,      -- Alias tambahan untuk fleksibilitas frontend
            lci_tipe AS tipe,
            lci_c AS c,
            lci_m AS m,
            lci_y AS y,
            lci_k AS k
        FROM tlhk_cetakmmt_ink
        WHERE lci_lch_nomor = ?
    `;
  const [rows] = await pool.query(sqlInk, [nomor]);
  return rows;
};

/**
 * Mengambil detail LHK berdasarkan nomor
 */
const getDetailsByNomor = async (nomor) => {
  const sqlDetail = `
        SELECT 
            d.ltd_lth_nomor AS Nomor,
            d.ltd_no_urut AS urut,
            d.ltd_jns_mesin AS Mesin, 
            d.ltd_spk_nomor AS Nomor_SPK,  
            x.spk_nama AS Nama_SPK,       
            x.spk_jumlah AS Jumlah_SPK,   -- TAMBAHAN: Jumlah Order dari SPK (Alias alternatif)
            x.spk_jumlah AS jumlah_spk,   -- TAMBAHAN: Untuk mengcover key huruf kecil
            x.spk_panjang AS Panjang, 
            x.spk_lebar AS Lebar, 
            d.ltd_pad AS Padding,
            d.ltd_qty_cetak AS Jml_Cetak,  
            
            -- HITUNGAN AKUMULASI 
            IFNULL((
                SELECT SUM(dx.ltd_qty_Cetak) 
                FROM tlhk_mesintekstil_dtl dx
                JOIN tlhk_mesintekstil_hdr hx ON hx.lth_nomor = dx.ltd_lth_nomor
                JOIN tlhk_mesintekstil_hdr h_curr ON h_curr.lth_nomor = d.ltd_lth_nomor
                WHERE dx.ltd_spk_nomor = d.ltd_spk_nomor 
                  AND hx.lth_tanggal < h_curr.lth_tanggal
            ), 0) AS sudah_cetak_sebelumnya,

            (IFNULL((
                SELECT SUM(dx.ltd_qty_Cetak) 
                FROM tlhk_mesintekstil_dtl dx
                JOIN tlhk_mesintekstil_hdr hx ON hx.lth_nomor = dx.ltd_lth_nomor
                JOIN tlhk_mesintekstil_hdr h_curr ON h_curr.lth_nomor = d.ltd_lth_nomor
                WHERE dx.ltd_spk_nomor = d.ltd_spk_nomor 
                  AND hx.lth_tanggal < h_curr.lth_tanggal
            ), 0) + IFNULL(d.ltd_qty_Cetak, 0)) AS total_pernah_cetak, 

            d.ltd_brg_kode AS Kode_Bahan, 
            b.brg_nama AS Nama, 
            
            -- Field Manajemen Bahan Kain/Tekstil
            d.ltd_ambil_bahan AS Ambil_Bahan, 
            IFNULL(d.ltd_aktual_bahan, 0) AS Aktual_Bahan,
            IFNULL(d.ltd_waste_tinta, 0) AS Waste_Tinta,
            
            -- Track Input Data Cetak Multi-Posisi 
            IFNULL(d.ltd_cetak1, 0) AS Cetak_1,
            IFNULL(d.ltd_cetak2, 0) AS Cetak_2,
            IFNULL(d.ltd_cetak3, 0) AS Cetak_3,
            IFNULL(d.ltd_cetak4, 0) AS Cetak_4,
            IFNULL(d.ltd_cetak5, 0) AS Cetak_5,
            IFNULL(d.ltd_cetak6, 0) AS Cetak_6,
            IFNULL(d.ltd_cetak7, 0) AS Cetak_7,
            
            -- Alias Cadangan Huruf Kecil
            IFNULL(d.ltd_qty_cetak, 0) AS totalcetak,
            IFNULL(d.ltd_cetak1, 0) AS cetak1,
            IFNULL(d.ltd_cetak2, 0) AS cetak2,
            IFNULL(d.ltd_cetak3, 0) AS cetak3,
            IFNULL(d.ltd_cetak4, 0) AS cetak4,
            IFNULL(d.ltd_cetak5, 0) AS cetak5,
            IFNULL(d.ltd_cetak6, 0) AS cetak6,
            IFNULL(d.ltd_cetak7, 0) AS cetak7
        FROM tlhk_mesintekstil_dtl d
        LEFT JOIN tbarang_mmt b ON b.brg_kode = d.ltd_brg_kode
        LEFT JOIN (
            SELECT spk_nomor, spk_nama, IFNULL(spk_jumlah, 0) AS spk_jumlah, IFNULL(spk_panjang,0) AS spk_panjang, IFNULL(spk_lebar,0) AS spk_lebar FROM tspk 
            UNION ALL 
            SELECT mspk_nomor, mspk_nama, IFNULL(mspk_jumlah, 0) AS mspk_jumlah, IFNULL(mspk_panjang,0) AS mspk_panjang, IFNULL(mspk_lebar,0) AS mspk_lebar FROM tmemospk 
        ) x ON x.spk_nomor = d.ltd_spk_nomor 
        WHERE d.ltd_lth_nomor = ?
        ORDER BY d.ltd_no_urut ASC
    `;

  const [rows] = await pool.query(sqlDetail, [nomor]);
  return rows;
};

/**
 * Mengambil Header + Detail untuk Mode Edit
 */
const getLhkByNomor = async (nomor) => {
  const sqlHeader = `
        SELECT 
            lth_nomor AS Nomor, 
            DATE_FORMAT(lth_tanggal, '%Y-%m-%d') AS Tanggal, 
            lth_gdg_prod AS Gudang, 
            lth_shift AS Shift,
            lth_brg_kode AS Kode_Bahan,
            lth_barcode AS Barcode_Roll,
            lth_status AS Status,
            lth_panjang_bs AS Panjang_BS,
            lth_lebar_bs AS Lebar_BS,
            brg_nama AS Nama_Bahan,
            (SELECT GROUP_CONCAT(DISTINCT dtl.ltd_jns_mesin ORDER BY dtl.ltd_jns_mesin ASC SEPARATOR ', ')
             FROM tlhk_mesintekstil_dtl dtl
             WHERE dtl.ltd_lth_nomor = lth_nomor) AS Mesin
        FROM tlhk_mesintekstil_hdr 
        LEFT JOIN tbarang_mmt ON brg_kode = lth_brg_kode
        WHERE lth_nomor = ?
    `;

  const [headerRows] = await pool.query(sqlHeader, [nomor]);
  if (headerRows.length === 0) return null;

  const details = await getDetailsByNomor(nomor);

  return {
    header: headerRows[0],
    details: details,
  };
};

/**
 * Menghapus LHK
 */
const deleteLhk = async (nomor) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(
      "DELETE FROM tlhk_mesintekstil_dtl WHERE ltd_lth_nomor = ?",
      [nomor],
    );
    await conn.query("DELETE FROM tlhk_mesintekstil_hdr WHERE lth_nomor = ?", [
      nomor,
    ]);
    await conn.query("DELETE FROM tmasterstok_mmt WHERE mst_noreferensi = ?", [
      nomor,
    ]);
    await conn.commit();
    return { success: true };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
};

/**
 * Generate Nomor LHK Otomatis
 */
const generateNewNomor = async (date, connection = null) => {
  const db = connection || pool;
  const dateToUse = date instanceof Date ? date : new Date(date);
  const yymm = format(dateToUse, "yyMM");
  const prefixMatch = `${NOMERATOR}.${yymm}.%`;

  const sqlMax = `
        SELECT MAX(CAST(SUBSTRING_INDEX(lth_nomor, '.', -1) AS UNSIGNED)) AS max_num
        FROM tlhk_mesintekstil_hdr
        WHERE lth_nomor LIKE ?
    `;

  const [rows] = await db.query(sqlMax, [prefixMatch]);
  const maxNum = rows && rows[0].max_num ? rows[0].max_num : 0;
  const nextSequence = maxNum + 1;
  const formattedSequence = String(nextSequence).padStart(4, "0");

  return `${NOMERATOR}.${yymm}.${formattedSequence}`;
};

/**
 * Simpan LHK (Create / Update + Stok)
 */
/**
 * Simpan LHK (Create / Update + Stok + Afal Sisa Samping)
 */
const saveLhk = async (data) => {
  const { header, details } = data;
  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();
    let nomorLhk = header.nomor;
    let isActuallyNew = false;
    const currentStatus = header.lstatus || "DRAFT";
    const currentUser = header.user || "SYSTEM";

    // 1. Cek / Generate Nomor LHK
    if (!nomorLhk || nomorLhk === "AUTO") {
      nomorLhk = await generateNewNomor(header.tanggal, conn);
      isActuallyNew = true;
    } else {
      const [rows] = await conn.query(
        "SELECT lth_nomor FROM tlhk_mesintekstil_hdr WHERE lth_nomor = ?",
        [nomorLhk],
      );
      isActuallyNew = rows.length === 0;
    }

    // 2. Ekstrak Semua Nomor SPK unik untuk pencatatan di kartu stok
    const uniqueSpks =
      details && details.length > 0
        ? [
            ...new Set(
              details.map((d) => d.nomor_spk || d.Nomor_SPK).filter((s) => s),
            ),
          ]
        : [];
    const combinedSpkNomor = uniqueSpks.join(", ") || "";

    // 3. Insert atau Update Header
    if (isActuallyNew) {
      const sqlInsHeader = `
        INSERT INTO tlhk_mesintekstil_hdr (
          lth_nomor, lth_tanggal, lth_shift, lth_gdg_prod, 
          lth_user_create, lth_date_create, lth_brg_kode, lth_barcode, lth_status,
          lth_panjang_bs, lth_lebar_bs
        ) VALUES (?, ?, ?, ?, ?, NOW(), ?, ?, ?, ?, ?)
      `;

      await conn.query(sqlInsHeader, [
        nomorLhk,
        header.tanggal,
        header.shift || 1,
        header.gdgKode,
        currentUser,
        header.brg_kode,
        header.barcode_input,
        currentStatus,
        Number(header.panjang_bs || 0),
        Number(header.lebar_bs || 0),
      ]);
    } else {
      const sqlUpdHeader = `
      UPDATE tlhk_mesintekstil_hdr SET 
        lth_tanggal = ?, 
        lth_shift = ?, 
        lth_gdg_prod = ?, 
        lth_status = ?, 
        lth_brg_kode = ?, 
        lth_barcode = ?,
        lth_panjang_bs = ?, 
        lth_lebar_bs = ?,
        lth_date_modified = NOW(),
        lth_user_modified = ?
      WHERE lth_nomor = ?
    `;

      await conn.query(sqlUpdHeader, [
        header.tanggal,
        header.shift || 1,
        header.gdgKode,
        currentStatus,
        header.brg_kode,
        header.barcode_input,
        Number(header.panjang_bs || 0),
        Number(header.lebar_bs || 0),
        currentUser,
        nomorLhk,
      ]);

      await conn.query(
        "DELETE FROM tlhk_mesintekstil_dtl WHERE ltd_lth_nomor = ?",
        [nomorLhk],
      );
    }

    // 4. Bersihkan stok lama di tmasterstok_mmt untuk nomor LHK ini
    if (!isActuallyNew) {
      await conn.query(
        `DELETE FROM tmasterstok_mmt WHERE mst_noreferensi = ? OR mst_spk_nomor = ?`,
        [nomorLhk, nomorLhk],
      );
    }

    // 5. Simpan Data Detail Pekerjaan
    let totalPanjangPakaiMeter = 0;

    if (details && details.length > 0) {
      const sqlDetail = `
        INSERT INTO tlhk_mesintekstil_dtl (
          ltd_lth_nomor, ltd_no_urut, ltd_jns_mesin, ltd_spk_nomor, 
          ltd_qty_Cetak, ltd_brg_kode, ltd_panjang_pakai, ltd_lebar_pakai,
          ltd_cetak1, ltd_cetak2, ltd_cetak3, ltd_cetak4, ltd_cetak5, ltd_cetak6, ltd_cetak7,
          ltd_ambil_bahan, ltd_pad, ltd_sisameter
        ) VALUES ?
      `;

      const values = details.map((d, i) => {
        const panjangPerPcs = Number(d.panjang_per_pcs || d.Panjang || 0);
        const jmlCetak = Number(d.jumlah_cetak || d.Jml_Cetak || 0);
        const paddingPerPcs = Number(d.padding ?? d.ltd_pad ?? 0);

        const subtotalMeter = (panjangPerPcs + paddingPerPcs) * jmlCetak;
        totalPanjangPakaiMeter += subtotalMeter;

        const sisaFisikMeter = Number(
          d.sisabahan_meter ?? d.ltd_sisameter ?? 0,
        );

        return [
          nomorLhk,
          i + 1,
          d.mesin || d.Mesin,
          d.nomor_spk || d.Nomor_SPK,
          jmlCetak,
          header.brg_kode,
          subtotalMeter,
          d.lebar_spk || d.Lebar || 0,
          Number(d.cetak_1 ?? d.cetak1 ?? 0),
          Number(d.cetak_2 ?? d.cetak2 ?? 0),
          Number(d.cetak_3 ?? d.cetak3 ?? 0),
          Number(d.cetak_4 ?? d.cetak4 ?? 0),
          Number(d.cetak_5 ?? d.cetak5 ?? 0),
          Number(d.cetak_6 ?? d.cetak6 ?? 0),
          Number(d.cetak_7 ?? d.cetak7 ?? 0),
          Number(d.ltd_ambil_bahan || d.ambil_bahan || d.PanjangBahanAwal || 0),
          paddingPerPcs,
          sisaFisikMeter,
        ];
      });

      await conn.query(sqlDetail, [values]);
    }

    // 6. Potong & Perbarui Stok Otomatis (Hanya jika Status POSTED)
    if (currentStatus === "POSTED" && header.barcode_input) {
      const [rows] = await conn.query(
        `
          SELECT 
            s.mst_hargabeli, 
            s.mst_satuan_harga, 
            s.mst_lebar, 
            brg.brg_type 
          FROM tmasterstok_mmt s
          LEFT JOIN tbarang_mmt brg ON s.mst_brg_kode = brg.brg_kode
          WHERE s.mst_barcode = ? 
          ORDER BY s.id DESC 
          LIMIT 1
        `,
        [header.barcode_input],
      );

      let hargaBeliLama = 0;
      let satuanHargaLama = "YRD";
      let lebarBahanLama = Number(header.lebar_bahan) || 0;

      if (rows && rows.length > 0) {
        const info = rows[0];
        hargaBeliLama = info.mst_hargabeli || 0;
        satuanHargaLama = info.mst_satuan_harga || "YRD";
        lebarBahanLama = info.mst_lebar || Number(header.lebar_bahan) || 0;
      }

      const saldoAwalRoll =
        Number(
          Number(header.panjang_awal || header.panjang_bahan).toFixed(2),
        ) || 0;

      // MUTASI 1: OUT (Keluarkan Roll Awal)
      const sqlOut = `
        INSERT INTO tmasterstok_mmt (
          mst_brg_kode, mst_barcode, mst_gdg_kode, mst_stok_in, mst_stok_out, 
          mst_tanggal, mst_panjang, mst_lebar, mst_spk_nomor, mst_noreferensi, 
          mst_satuan_harga, mst_hargabeli, date_create, mst_kategori
        ) VALUES (?, ?, ?, 0, 1, ?, ?, ?, ?, ?, ?, ?, NOW(), 'ROLL')
      `;
      await conn.query(sqlOut, [
        header.brg_kode,
        header.barcode_input,
        header.gdgKode,
        header.tanggal,
        saldoAwalRoll,
        lebarBahanLama,
        combinedSpkNomor,
        nomorLhk,
        satuanHargaLama,
        hargaBeliLama,
      ]);

      // MUTASI 2: IN (Masukkan Sisa Roll Baru)
      const sisaBaru =
        Number(Number(header.sisa_panjang_manual).toFixed(2)) || 0;

      if (sisaBaru > 0) {
        const sqlIn = `
          INSERT INTO tmasterstok_mmt (
            mst_brg_kode, mst_barcode, mst_gdg_kode, mst_stok_in, mst_stok_out, 
            mst_tanggal, mst_panjang, mst_lebar, mst_spk_nomor, mst_noreferensi, 
            mst_satuan_harga, mst_hargabeli, date_create, mst_kategori
          ) VALUES (?, ?, ?, 1, 0, ?, ?, ?, ?, ?, ?, ?, NOW(), 'ROLL')
        `;
        await conn.query(sqlIn, [
          header.brg_kode,
          header.barcode_input,
          header.gdgKode,
          header.tanggal,
          sisaBaru,
          lebarBahanLama,
          combinedSpkNomor,
          nomorLhk,
          satuanHargaLama,
          hargaBeliLama,
        ]);
      }

      // 7. 🔥 CEK & BUAT BARCODE AFAL BARU JIKA LEBAR SISA > 0.50 METER
      let afalDataObj = null;
      const panjangAfal = Number(header.lpanjang_afal || 0);
      const lebarAfal = Number(header.llebar_afal || 0);

      if (lebarAfal > 0.5 && panjangAfal > 0) {
        const barcodeAfal = `${header.barcode_input}-AFL-${Date.now().toString().slice(-4)}`;

        const sqlInsertAfal = `
          INSERT INTO tmasterstok_mmt (
            mst_brg_kode, mst_barcode, mst_gdg_kode, mst_stok_in, mst_stok_out, 
            mst_tanggal, mst_panjang, mst_lebar, mst_spk_nomor, mst_noreferensi, 
            mst_satuan_harga, mst_hargabeli, date_create, mst_kategori
          ) VALUES (?, ?, ?, 1, 0, ?, ?, ?, ?, ?, ?, ?, NOW(), 'AFAL')
        `;

        await conn.query(sqlInsertAfal, [
          header.brg_kode,
          barcodeAfal,
          header.gdgKode,
          header.tanggal,
          panjangAfal,
          lebarAfal,
          combinedSpkNomor,
          nomorLhk,
          satuanHargaLama,
          hargaBeliLama,
        ]);

        afalDataObj = {
          barcode: barcodeAfal,
          panjang: panjangAfal,
          lebar: lebarAfal,
        };
      }

      await conn.commit();

      return {
        success: true,
        nomor: nomorLhk,
        message: "Data LHK berhasil disimpan",
        totalPanjangPakaiSistem: totalPanjangPakaiMeter,
        afalData: afalDataObj,
      };
    }

    await conn.commit();

    return {
      success: true,
      nomor: nomorLhk,
      message: "Data LHK berhasil disimpan",
      totalPanjangPakaiSistem: totalPanjangPakaiMeter,
    };
  } catch (error) {
    await conn.rollback();
    console.error("Error pada saveLhk Mesin Tekstil:", error);
    throw error;
  } finally {
    conn.release();
  }
};

/**
 * Lookup LHK Tekstil dengan Filter Tanggal dan Shift
 */
const getLookupLhkTekstil = async (tanggal, shift) => {
  let params = [];
  let sql = `
        SELECT 
            h.lth_nomor AS Nomor, 
            DATE_FORMAT(h.lth_tanggal, '%Y-%m-%d') AS Tanggal, 
            CASE 
                WHEN h.lth_status = 'APPROVED' THEN 'CLOSED'
                ELSE 'OPEN'
            END AS StatusAmbil,
            h.lth_shift AS Shift,
            h.lth_barcode AS Barcode,
            h.lth_brg_kode AS Kode_Bahan, 
            b.brg_nama AS Nama_Bahan,
            
            -- Mengambil Jenis Mesin (Baris pertama)
            (SELECT ltd_jns_mesin FROM tlhk_mesintekstil_dtl WHERE ltd_lth_nomor = h.lth_nomor LIMIT 1) AS Mesin,
            
            -- Mengambil Nomor SPK (Baris pertama / representasi utama)
            (SELECT ltd_spk_nomor FROM tlhk_mesintekstil_dtl WHERE ltd_lth_nomor = h.lth_nomor LIMIT 1) AS NomorSPK,
            
            -- Mengambil Nama Pekerjaan / SPK dari subquery union tspk & tmemospk
            (SELECT x.spk_nama 
             FROM tlhk_mesintekstil_dtl dtl
             LEFT JOIN (
                SELECT spk_nomor, spk_nama FROM tspk 
                UNION ALL 
                SELECT mspk_nomor, mspk_nama FROM tmemospk 
             ) x ON x.spk_nomor = dtl.ltd_spk_nomor
             WHERE dtl.ltd_lth_nomor = h.lth_nomor LIMIT 1) AS NamaOrder,

            -- Menghitung total jumlah jenis SPK di dalam LHK ini (untuk deteksi mode RETAIL)
            (SELECT COUNT(DISTINCT ltd_spk_nomor) FROM tlhk_mesintekstil_dtl WHERE ltd_lth_nomor = h.lth_nomor) AS JumlahSPK,

            -- Mengambil Total Qty Order dari SPK terkait
            (SELECT SUM(x.spk_jumlah) 
             FROM tlhk_mesintekstil_dtl dtl
             LEFT JOIN (
                SELECT spk_nomor, spk_jumlah FROM tspk 
                UNION ALL 
                SELECT mspk_nomor, mspk_jumlah FROM tmemospk 
             ) x ON x.spk_nomor = dtl.ltd_spk_nomor
             WHERE dtl.ltd_lth_nomor = h.lth_nomor) AS JumlahOrder,
            
            -- Mengambil Total Qty Cetak Pcs (Hasil SUM dari semua detail)
            (SELECT SUM(ltd_qty_Cetak) FROM tlhk_mesintekstil_dtl WHERE ltd_lth_nomor = h.lth_nomor) AS TotalCetak,
            
            -- Mengambil Total Luas Meter Persegi / Panjang Pakai
            (SELECT SUM(ltd_panjang_pakai) FROM tlhk_mesintekstil_dtl WHERE ltd_lth_nomor = h.lth_nomor) AS KurangCetak
            
        FROM tlhk_mesintekstil_hdr h
        LEFT JOIN tbarang_mmt b ON h.lth_brg_kode = b.brg_kode
        WHERE h.lth_status = 'POSTED'
    `;

  if (tanggal) {
    sql += ` AND h.lth_tanggal = ?`;
    params.push(tanggal);
  }

  if (shift && shift !== "Semua") {
    sql += ` AND h.lth_shift = ?`;
    params.push(shift);
  }

  sql += ` ORDER BY h.lth_nomor DESC LIMIT 100`;

  const [rows] = await pool.query(sql, params);
  return rows;
};

const generateAppNomor = async (date, connection) => {
  const yymm = format(new Date(date), "yyMM");
  const prefix = `MMT-LHK-TA.${yymm}.%`;
  const sql = `SELECT MAX(CAST(SUBSTRING_INDEX(lth_nomor, '.', -1) AS UNSIGNED)) AS max_num 
                 FROM tlhk_tekstilmmt_hdr WHERE lth_nomor LIKE ?`;

  const [rows] = await connection.query(sql, [prefix]);
  const nextNum = (rows[0].max_num || 0) + 1;
  return `MMT-LHK-TA.${yymm}.${String(nextNum).padStart(4, "0")}`;
};

/**
 * Menyimpan data Approval dan Update status LHK asal
 */
const saveApproval = async (data) => {
  const { header, details, inkData } = data;
  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    let nomorApp = header.nomor || header.Nomor;
    let isActuallyNew = false;

    if (!nomorApp || nomorApp === "AUTO") {
      nomorApp = await generateAppNomor(header.tanggal, conn);
      isActuallyNew = true;
    } else {
      const [rows] = await conn.query(
        "SELECT lth_nomor FROM tlhk_tekstilmmt_hdr WHERE lth_nomor = ?",
        [nomorApp],
      );
      isActuallyNew = rows.length === 0;
    }

    const sampleBrgKode =
      details && details.length > 0 ? details[0].brg_kode || "" : "";
    const sampleBarcode =
      details && details.length > 0 ? details[0].barcode || "" : "";

    if (isActuallyNew) {
      const sqlInsHeader = `
                INSERT INTO tlhk_tekstilmmt_hdr (
                    lth_nomor, lth_tanggal, lth_shift, lth_gdg_prod, 
                    lth_user_create, lth_date_create, lth_brg_kode, lth_barcode, lth_status
                ) VALUES (?, ?, ?, ?, ?, NOW(), ?, ?, ?)
            `;
      await conn.query(sqlInsHeader, [
        nomorApp,
        header.tanggal,
        Number(header.shift) || 1,
        header.gdgKode || "",
        header.admin || "ADMIN",
        sampleBrgKode,
        sampleBarcode,
        "APPROVE",
      ]);
    } else {
      const sqlUpdHeader = `
                UPDATE tlhk_tekstilmmt_hdr SET 
                    lth_tanggal = ?, lth_shift = ?, lth_gdg_prod = ?, 
                    lth_user_create = ?, lth_brg_kode = ?, lth_barcode = ?
                WHERE lth_nomor = ?
            `;
      await conn.query(sqlUpdHeader, [
        header.tanggal,
        Number(header.shift) || 1,
        header.gdgKode || "",
        header.admin || "ADMIN",
        sampleBrgKode,
        sampleBarcode,
        nomorApp,
      ]);

      await conn.query(
        "DELETE FROM tlhk_tekstilmmt_dtl WHERE ltd_lth_nomor = ?",
        [nomorApp],
      );
      await conn.query(
        "DELETE FROM tlhk_cetakmmt_ink WHERE lci_lch_nomor = ?",
        [nomorApp],
      );
    }

    if (details && details.length > 0) {
      const sqlDetail = `
                INSERT INTO tlhk_tekstilmmt_dtl (
                    ltd_lth_nomor, ltd_no_urut, ltd_jns_mesin, ltd_spk_nomor, 
                    ltd_qty_cetak, ltd_brg_kode, ltd_panjang_pakai, ltd_lebar_pakai,
                    ltd_lth_mesin_nomor, ltd_shift
                ) VALUES ?
            `;
      const values = details.map((d, i) => [
        nomorApp,
        i + 1,
        d.mesin || d.Mesin || "",
        d.nomor_spk || d.Nomor_SPK || "",
        parseFloat(d.qty || d.jumlah_cetak || d.Jml_Cetak) || 0,
        d.brg_kode || d.Kode_Bahan || sampleBrgKode,
        parseFloat(d.total_m2 || d.Total_Panjang) || 0,
        parseFloat(d.lebar || d.lebar_spk || d.Lebar) || 0,
        d.lhk_mesin || d.Nomor_Lhk_Mesin || "",
        Number(d.shift || d.ShiftDetail) || Number(header.shift) || 1,
      ]);
      await conn.query(sqlDetail, [values]);

      const lhkNomorsAsal = details
        .map((d) => d.lhk_mesin || d.Nomor_Lhk_Mesin)
        .filter((n) => n && n !== "MANUAL");
      if (lhkNomorsAsal.length > 0) {
        await conn.query(
          `UPDATE tlhk_mesintekstil_hdr SET lth_status = 'APPROVED' WHERE lth_nomor IN (?)`,
          [lhkNomorsAsal],
        );
      }
    }

    if (inkData && inkData.length > 0) {
      const validInkData = inkData.filter(
        (ink) => ink.lci_msn_kode || ink.msn_kode || ink.Mesin,
      );

      if (validInkData.length > 0) {
        const sqlInk = `
                    INSERT INTO tlhk_cetakmmt_ink (
                        lci_lch_nomor, lci_msn_kode, lci_tipe, lci_c, lci_m, lci_y, lci_k
                    ) VALUES ?
                `;

        const inkValues = validInkData.map((ink) => [
          nomorApp,
          ink.lci_msn_kode || ink.msn_kode || ink.Mesin,
          ink.lci_tipe || ink.tipe || "Tekstil",
          parseFloat(ink.lci_c ?? ink.c) || 0,
          parseFloat(ink.lci_m ?? ink.m) || 0,
          parseFloat(ink.lci_y ?? ink.y) || 0,
          parseFloat(ink.lci_k ?? ink.k) || 0,
        ]);

        await conn.query(sqlInk, [inkValues]);
      }
    }

    await conn.commit();
    return {
      success: true,
      nomor: nomorApp,
      message: isActuallyNew
        ? "LHK Berhasil di-Approve beserta Data Tinta"
        : "Perubahan Data Rekap & Tinta Berhasil Diperbarui",
    };
  } catch (error) {
    await conn.rollback();
    console.error("Error pada saveApproval Tekstil:", error);
    throw error;
  } finally {
    conn.release();
  }
};

/**
 * Mengambil daftar history Approval (tlhk_tekstilmmt_hdr)
 */
const getAllApprovalHeaders = async (startDate, endDate) => {
  const tglMulai = format(new Date(startDate), "yyyy-MM-dd");
  const tglSelesai = format(new Date(endDate), "yyyy-MM-dd");

  const sql = `
        SELECT 
            h.lth_nomor AS Nomor, 
            DATE_FORMAT(h.lth_tanggal, '%d/%m/%Y') AS Tanggal, 
            h.lth_shift AS Shift,
            h.lth_user_create AS Admin,
            h.lth_status AS Status,
            
            (SELECT IFNULL(SUM(d.ltd_panjang_pakai), 0) 
             FROM tlhk_tekstilmmt_dtl d
             WHERE d.ltd_lth_nomor = h.lth_nomor) AS Total_Meter,
             
            (SELECT COUNT(*) 
             FROM tlhk_tekstilmmt_dtl d
             WHERE d.ltd_lth_nomor = h.lth_nomor) AS Jumlah_Item
        FROM tlhk_tekstilmmt_hdr h
        WHERE h.lth_tanggal BETWEEN ? AND ?
        ORDER BY h.lth_tanggal DESC, h.lth_nomor DESC
    `;

  const [rows] = await pool.query(sql, [tglMulai, tglSelesai]);
  return rows;
};

/**
 * Mengambil detail Approval berdasarkan nomor rekap
 */
const getApprovalDetailsByNomor = async (nomor) => {
  const sqlDetail = `
        SELECT 
            d.ltd_lth_nomor AS Nomor_App,
            d.ltd_no_urut AS No_Urut,
            d.ltd_jns_mesin AS Mesin, 
            d.ltd_spk_nomor AS Nomor_SPK, 
            x.spk_nama AS Nama_SPK,
            x.spk_jumlah AS Jumlah_SPK,   -- TAMBAHAN: Jumlah Order dari SPK
            x.spk_jumlah AS jumlah_spk,   -- TAMBAHAN: Untuk mengcover key huruf kecil
            d.ltd_qty_cetak AS Jml_Cetak, 
            d.ltd_brg_kode AS Kode_Bahan, 
            b.brg_nama AS Nama_Bahan,
            
            IFNULL(x.spk_panjang, 0) AS Panjang,
            IFNULL(x.spk_lebar, 0) AS Lebar,
            
            ROUND(IFNULL(x.spk_panjang, 0) * IFNULL(x.spk_lebar, 0) * IFNULL(d.ltd_qty_cetak, 0), 2) AS Total_Panjang,
            ROUND(IFNULL(x.spk_panjang, 0) * IFNULL(x.spk_lebar, 0) * IFNULL(d.ltd_qty_cetak, 0), 2) AS total_m2,
            
            d.ltd_lth_mesin_nomor AS Nomor_Lhk_Mesin, 
            d.ltd_shift AS ShiftDetail             
        FROM tlhk_tekstilmmt_dtl d
        LEFT JOIN tbarang_mmt b ON d.ltd_brg_kode = b.brg_kode
        LEFT JOIN (
            SELECT spk_nomor, spk_nama, IFNULL(spk_jumlah, 0) AS spk_jumlah, IFNULL(spk_panjang, 0) AS spk_panjang, IFNULL(spk_lebar, 0) AS spk_lebar FROM tspk 
            UNION ALL 
            SELECT mspk_nomor, mspk_nama, IFNULL(mspk_jumlah, 0) AS mspk_jumlah, IFNULL(mspk_panjang, 0) AS mspk_panjang, IFNULL(mspk_lebar, 0) AS mspk_lebar FROM tmemospk 
        ) x ON x.spk_nomor = d.ltd_spk_nomor 
        WHERE d.ltd_lth_nomor = ?
        ORDER BY d.ltd_no_urut
    `;

  const [rows] = await pool.query(sqlDetail, [nomor]);
  return rows;
};

/**
 * Mengambil data lengkap Approval (Header + Detail)
 */
const getApprovalFullByNomor = async (nomor) => {
  const sqlHeader = `
        SELECT 
            lth_nomor AS Nomor, 
            DATE_FORMAT(lth_tanggal, '%Y-%m-%d') AS Tanggal, 
            lth_shift AS Shift,
            lth_user_create AS Admin,
            lth_status AS Status
        FROM tlhk_tekstilmmt_hdr
        WHERE lth_nomor = ?
    `;

  const [headerRows] = await pool.query(sqlHeader, [nomor]);
  if (headerRows.length === 0) return null;

  const details = await getApprovalDetailsByNomor(nomor);
  const inks = await getInksByNomor(nomor);

  return {
    header: headerRows[0],
    details: details,
    inkData: inks,
  };
};

module.exports = {
  getAllHeaders,
  getDetailsByNomor,
  getLhkByNomor,
  getAllApprovalHeaders,
  getApprovalDetailsByNomor,
  getApprovalFullByNomor,
  deleteLhk,
  generateNewNomor,
  saveLhk,
  getLookupLhkTekstil,
  saveApproval,
};
