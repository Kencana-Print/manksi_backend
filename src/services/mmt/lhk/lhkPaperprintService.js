const pool = require("../../../config/database");
const { format } = require("date-fns");

// Parse rincian ukuran dari tspk.spk_ukuran, mis. "L=15, XL=20, 2XL=10".
// Dipakai untuk mengisi J. Order per size saat tspk_size kosong.
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

const toNumber = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

// Tanggal kosong/invalid => filter tanggal di-skip (tanpa klausa zero-date).
const isValidDate = (v) =>
  typeof v === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(v) &&
  !isNaN(new Date(v).getTime());

const normDate = (v) =>
  isValidDate(v) ? format(new Date(v), "yyyy-MM-dd") : null;

// Konstanta Nomor Bukti
const NOMERATOR_MESIN = "MMT-LHK-S"; // Untuk tabel mesinsublim
const NOMERATOR_APP = "MMT-LHK-SA"; // Untuk tabel sublim (Approval)

/**
 * =============================================================================
 * 1. BAGIAN MESIN SUBLIM (Input Operator)
 * =============================================================================
 */

const accLhkPaperprint = async (nomor, user = "SYSTEM") => {
  // Update kolom lsb_acc menjadi 'ACC' (dan status jika diperlukan)
  const sql = `
    UPDATE tlhk_sublim_hdr 
    SET lsb_acc = 'ACC',
        lsb_user_modified = ?,
        lsb_date_modified = NOW()
    WHERE lsb_nomor = ?
  `;

  const [result] = await pool.query(sql, [user, nomor]);

  if (result.affectedRows === 0) {
    throw new Error(`Data LHK Sublim dengan nomor ${nomor} tidak ditemukan.`);
  }

  return { success: true, nomor };
};

const getAllHeaders = async (startDate, endDate, search = "") => {
  const tglMulai = normDate(startDate);
  const tglSelesai = normDate(endDate);
  const hasDate = !!(tglMulai && tglSelesai);

  const params = [];
  if (hasDate) params.push(tglMulai, tglSelesai);

  let sql = `
    SELECT 
        t1.lsb_nomor AS Nomor, 
        t1.lsb_shift AS Shift, 
        DATE_FORMAT(t1.lsb_tanggal, '%Y-%m-%d') AS Tanggal, 
        IFNULL(x.mesin_lokasi, 'SB01') AS Mesin,
        
        -- Status Utama & ACC
        IFNULL(t1.lsb_status, 'DRAFT') AS Status,
        IFNULL(t1.lsb_acc, '') AS Status_Acc,
        
        t1.lsb_panjang_bs AS lsb_panjang_bs,
        t1.lsb_lebar_bs AS lsb_lebar_bs,
        t1.lsb_gdg_kode AS Gudang,
        g.gdg_nama AS Nama_Gudang,
        
        t1.lsb_barcode AS Barcode_Roll,
        t1.lsb_brg_kode AS Kode_Bahan,
        t3.brg_nama AS Nama_Bahan,
        -- Cek Kelengkapan Bahan (Y / N)
        IF(LENGTH(IFNULL(t1.lsb_brg_kode, '')) > 0, 'Y', 'N') AS Lengkap,

        IFNULL(x.combined_spk, '-') AS NomorSPK,
        IFNULL(x.combined_spk_nama, '-') AS NamaOrder,
        IFNULL(x.qtytotalcetak, 0) AS TotalCetak,
        IFNULL(x.panjang_bahan_awal, 0) AS PanjangBahanAwal,
        IFNULL(x.sisa_akhir, 0) AS SisaMeterAkhir,
        IFNULL(x.total_luas_m2, 0) AS total_meter,
        
        CASE 
            WHEN x.sisa_akhir < 0 THEN ABS(x.sisa_akhir)
            ELSE 0 
        END AS NilaiSurplus,
        
        CASE 
            WHEN x.sisa_akhir > 0 THEN x.sisa_akhir
            ELSE 0 
        END AS NilaiMinus,

        t1.lsb_user_create AS Operator
    FROM tlhk_sublim_hdr t1
    LEFT JOIN tGUDANG g ON g.gdg_kode = t1.lsb_gdg_kode
    LEFT JOIN tbarang_mmt t3 ON t3.brg_kode = t1.lsb_brg_kode
    LEFT JOIN (
        SELECT 
            lsbd_lsb_nomor,
            MAX(lsbd_lokasi) AS mesin_lokasi,
            GROUP_CONCAT(DISTINCT lsbd_spk_nomor SEPARATOR ', ') AS combined_spk,
            GROUP_CONCAT(DISTINCT lsbd_spk_nama SEPARATOR ', ') AS combined_spk_nama,
            SUM(lsbd_jumlah) AS qtytotalcetak,
            SUM(lsbd_j_meter) AS total_luas_m2,
            MAX(lsbd_ambilbahan) AS panjang_bahan_awal,
            (
                SELECT (d2.lsbd_ambilbahan - d2.lsbd_panjang_pakai - h2.lsb_panjang_bs)
                FROM tlhk_sublim_dtl d2
                INNER JOIN tlhk_sublim_hdr h2 ON h2.lsb_nomor = d2.lsbd_lsb_nomor
                WHERE d2.lsbd_lsb_nomor = tlhk_sublim_dtl.lsbd_lsb_nomor 
                ORDER BY d2.lsbd_no_urut DESC LIMIT 1
            ) AS sisa_akhir
        FROM tlhk_sublim_dtl 
        GROUP BY lsbd_lsb_nomor
    ) x ON x.lsbd_lsb_nomor = t1.lsb_nomor
    WHERE ${hasDate ? "t1.lsb_tanggal BETWEEN ? AND ?" : "1=1"}
  `;

  if (search) {
    sql += ` AND (
            t1.lsb_nomor LIKE ? 
            OR t1.lsb_barcode LIKE ? 
            OR t3.brg_nama LIKE ? 
            OR x.combined_spk LIKE ? 
            OR x.combined_spk_nama LIKE ?
        ) `;
    const searchPattern = `%${search}%`;
    params.push(
      searchPattern,
      searchPattern,
      searchPattern,
      searchPattern,
      searchPattern,
    );
  }

  sql += ` ORDER BY t1.lsb_tanggal DESC, t1.lsb_nomor DESC`;

  const [rows] = await pool.query(sql, params);
  return rows;
};

const getDetailsByNomor = async (nomor) => {
  const sqlDetail = `
        SELECT 
            d.lsbd_lsb_nomor AS Nomor,
            d.lsbd_no_urut AS No_Urut,
            d.lsbd_poi_nomor AS Poi_Nomor,
            d.lsbd_poid_size AS Poi_Size,
            d.lsbd_lokasi AS Lokasi, 
            d.lsbd_spk_nomor AS Nomor_SPK, 
            IF(LENGTH(d.lsbd_spk_nama) > 0, d.lsbd_spk_nama, x.spk_nama) AS Nama_SPK, 
            
            -- 🌟 Tambahkan ini agar nama komponen ter-load saat edit
            IFNULL(d.lsbd_komponen, 'ALL SET') AS lsbd_komponen,
            IFNULL(d.lsbd_komponen, 'ALL SET') AS Komponen,
            
            d.lsbd_panjang AS Panjang, 
            d.lsbd_lebar AS Lebar, 
            d.lsbd_jumlah_order AS J_Order_Simpan, 
            d.lsbd_jumlah_order AS J_Order_SPK, 
            IFNULL(sz.qty, 0) AS Order_Size,
            IFNULL(rtr.qty_order, 0) AS Order_Rtr,
            IFNULL(t.spk_jumlah, 0) AS spk_jumlah,
            t.spk_ukuran AS spk_ukuran,
            d.lsbd_bahan AS Bahan, 
            d.lsbd_jumlah AS Jumlah,
            (d.lsbd_panjang * d.lsbd_lebar * d.lsbd_jumlah) AS Jumlah_Meter,
            
            -- Menarik data penunjang dari header
            h.lsb_panjang_bs AS lsb_panjang_bs,
            h.lsb_lebar_bs AS lsb_lebar_bs,
            h.lsb_tanggal AS lsb_tanggal,
            h.lsb_shift AS lsb_shift,
            h.lsb_gdg_kode AS lsb_gdg_kode,
            h.lsb_status AS lstatus,
            h.lsb_barcode AS Barcode_Roll,   -- 🌟 Barcode roll
            h.lsb_brg_kode AS Kode_Bahan,     -- 🌟 Kode barang
            d.lsbd_ambilbahan AS panjang_awal,
            d.lsbd_panjang_pakai AS panjang_terpakai,
            d.lsbd_sisameter AS lsbd_sisameter
        FROM tlhk_sublim_dtl d
        LEFT JOIN tlhk_sublim_hdr h ON h.lsb_nomor = d.lsbd_lsb_nomor 
        LEFT JOIN (
            SELECT spk_nomor, spk_nama FROM tspk 
            UNION ALL 
            SELECT mspk_nomor, mspk_nama FROM tmemospk 
        ) x ON x.spk_nomor = d.lsbd_spk_nomor 
        LEFT JOIN tspk t ON t.spk_nomor = d.lsbd_spk_nomor
        LEFT JOIN (
            SELECT spks_nomor,
                   UPPER(TRIM(spks_size)) AS size,
                   MAX(IFNULL(spks_qty, 0)) AS qty
            FROM tspk_size
            GROUP BY spks_nomor, UPPER(TRIM(spks_size))
        ) sz
            ON sz.spks_nomor = d.lsbd_spk_nomor
           AND sz.size = UPPER(TRIM(d.lsbd_poid_size))
        LEFT JOIN (
            SELECT lrd_spk_nomor,
                   UPPER(TRIM(lrd_poid_size)) AS poid_size,
                   MAX(IFNULL(lrd_order, 0)) AS qty_order
            FROM tlhk_rtr_dtl
            WHERE lrd_poid_size IS NOT NULL
              AND TRIM(lrd_poid_size) NOT IN ('', '-')
            GROUP BY lrd_spk_nomor, UPPER(TRIM(lrd_poid_size))
        ) rtr
            ON rtr.lrd_spk_nomor = d.lsbd_spk_nomor
           AND rtr.poid_size = UPPER(TRIM(d.lsbd_poid_size))
        WHERE d.lsbd_lsb_nomor = ?
        ORDER BY d.lsbd_no_urut
    `;

  const [rows] = await pool.query(sqlDetail, [nomor]);

  // J. Order per size: pakai tspk_size, lalu rincian spk_ukuran, lalu order RTR.
  // Jika tidak ada rincian size sama sekali, tampilkan total order per SPK.
  const ukuranMap = {};
  rows.forEach((r) => {
    const spk = r.Nomor_SPK;
    if (!spk || Object.prototype.hasOwnProperty.call(ukuranMap, spk)) return;
    const parsed = parseUkuranText(r.spk_ukuran);
    if (parsed.length) {
      ukuranMap[spk] = {};
      parsed.forEach(({ size, qty }) => {
        ukuranMap[spk][size] = qty;
      });
    } else {
      ukuranMap[spk] = null;
    }
  });

  return rows.map((r) => {
    const size = String(r.Poi_Size || "").trim().toUpperCase();
    const totalSpk = toNumber(r.J_Order_Simpan) || toNumber(r.spk_jumlah);
    const orderPerSize =
      toNumber(r.Order_Size) ||
      toNumber(ukuranMap[r.Nomor_SPK]?.[size]) ||
      toNumber(r.Order_Rtr) ||
      0;

    const {
      J_Order_Simpan,
      Order_Size,
      Order_Rtr,
      spk_jumlah,
      spk_ukuran,
      ...rest
    } = r;
    return {
      ...rest,
      J_Order: orderPerSize > 0 ? orderPerSize : totalSpk,
      J_Order_SPK: totalSpk,
      Order_Per_Size: orderPerSize > 0,
    };
  });
};

const saveLhkMesin = async (data) => {
  const { header, details } = data;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    let nomorLhk = header.lsb_nomor;
    const currentStatus = header.lstatus || "DRAFT";
    const tanggalForm = header.lsb_tanggal;
    const gdgKode = header.lsb_gdg_kode || "GPM";
    const shiftForm = header.lsb_shift || 1;
    const userAction = header.kdUser || header.user_create || "SYSTEM";

    const panjangBs = parseFloat(header.panjang_bs || 0);
    const lebarBs = parseFloat(header.lebar_bs || 0);
    const formattedDate = format(new Date(tanggalForm), "yyyy-MM-dd");
    const formattedNow = format(new Date(), "yyyy-MM-dd HH:mm:ss");

    const usedBarcode = header.barcode_input || "";
    const usedKodeBahan = header.brg_kode || "";
    let maxAmbilPanjang = parseFloat(
      header.Panjang_bahan || header.panjang_bahan || 0,
    );
    const initialLebar = parseFloat(
      header.Lebar_bahan || header.lebar_bahan || 0,
    );

    // Penanganan Sisa Meter: Prioritas Manual -> Otomatis -> 0
    const sisaManual =
      header.sisa_panjang_manual ??
      header.sisa_manual ??
      header.sisaPanjangManual;
    const sisaOtomatis = header.sisabahan ?? header.sisa_panjang_otomatis ?? 0;

    const finalSisaMeter =
      sisaManual !== null &&
      sisaManual !== undefined &&
      String(sisaManual).trim() !== "" &&
      !isNaN(parseFloat(sisaManual))
        ? parseFloat(sisaManual)
        : parseFloat(sisaOtomatis);

    const uniqueSpks = [
      ...new Set(details.map((d) => d.spk_nomor).filter((s) => s)),
    ];
    const combinedSpkNomor = uniqueSpks.join(", ");

    const getKategori = (panjang, lebar) => {
      if (panjang >= 3 && lebar >= 0.5) {
        return "RETUR";
      }
      return "SCRAP";
    };

    // 1. PROSES SNAPSHOT LOGGING JIKA MODE EDIT
    if (nomorLhk && nomorLhk !== "AUTO") {
      const [oldHeader] = await conn.query(
        `SELECT * FROM tlhk_sublim_hdr WHERE lsb_nomor = ?`,
        [nomorLhk],
      );
      const [oldDetails] = await conn.query(
        `SELECT * FROM tlhk_sublim_dtl WHERE lsbd_lsb_nomor = ?`,
        [nomorLhk],
      );
      const [oldStock] = await conn.query(
        `SELECT * FROM tmasterstok_mmt WHERE mst_noreferensi = ?`,
        [nomorLhk],
      );

      if (oldHeader.length > 0) {
        const snapshotDataLama = {
          header: oldHeader[0],
          details: oldDetails,
          stock: oldStock,
        };

        await conn.query(
          `INSERT INTO tlhk_history_log (
             lhl_nomor_lhk, lhl_action, lhl_data_old, lhl_user_action, lhl_date_action
           ) VALUES (?, 'EDIT', ?, ?, ?)`,
          [
            nomorLhk,
            JSON.stringify(snapshotDataLama),
            userAction,
            formattedNow,
          ],
        );
      }

      await conn.query(`DELETE FROM tlhk_sublim_dtl WHERE lsbd_lsb_nomor = ?`, [
        nomorLhk,
      ]);
      await conn.query(
        `DELETE FROM tmasterstok_mmt WHERE mst_noreferensi = ?`,
        [nomorLhk],
      );
    }

    // 2. PROSES INSERT / UPDATE HEADER SUBLIM
    if (!nomorLhk || nomorLhk === "AUTO") {
      const yymm = format(new Date(tanggalForm), "yyMM");
      const [maxRows] = await conn.query(
        `SELECT MAX(CAST(SUBSTRING_INDEX(lsb_nomor, '.', -1) AS UNSIGNED)) AS max_num 
         FROM tlhk_sublim_hdr 
         WHERE lsb_nomor LIKE ?`,
        [`${NOMERATOR_MESIN}.${yymm}.%`],
      );

      const nextNum = (maxRows[0].max_num || 0) + 1;
      nomorLhk = `${NOMERATOR_MESIN}.${yymm}.${String(nextNum).padStart(4, "0")}`;

      await conn.query(
        `INSERT INTO tlhk_sublim_hdr 
            (lsb_nomor, lsb_tanggal, lsb_jenis, lsb_shift, lsb_date_Create, lsb_user_create, lsb_gdg_kode, lsb_status, lsb_barcode, lsb_brg_kode, lsb_panjang_bs, lsb_lebar_bs) 
         VALUES (?, ?, 'S', ?, NOW(), ?, ?, ?, ?, ?, ?, ?)`,
        [
          nomorLhk,
          tanggalForm,
          shiftForm,
          userAction,
          gdgKode,
          currentStatus,
          usedBarcode,
          usedKodeBahan,
          panjangBs,
          lebarBs,
        ],
      );
    } else {
      await conn.query(
        `UPDATE tlhk_sublim_hdr 
         SET lsb_tanggal=?, lsb_shift=?, lsb_user_modified=?, lsb_gdg_kode=?, lsb_status=?, lsb_barcode=?, lsb_brg_kode=?, lsb_panjang_bs=?, lsb_lebar_bs=?, lsb_date_modified=NOW() 
         WHERE lsb_nomor=?`,
        [
          tanggalForm,
          shiftForm,
          userAction,
          gdgKode,
          currentStatus,
          usedBarcode,
          usedKodeBahan,
          panjangBs,
          lebarBs,
          nomorLhk,
        ],
      );
    }

    // 3. PROSES DATA DETAIL
    if (details && details.length > 0) {
      const values = details.map((d, i) => {
        const p = parseFloat(d.spk_panjang || 0);
        const l = parseFloat(d.spk_lebar || 0);
        const qtyHasilLhk = parseFloat(d.jumlah_sublim || 0);
        const qtyOrderSpk = parseFloat(d.spk_jmlorder || d.Jumlah_Order || d.qty_order || 0);
        const jMeter = p * l * qtyHasilLhk;

        // Tangkap panjang pakai spesifik baris dari payload frontend
        const panjangPakaiBaris = parseFloat(d.lsbd_panjang_pakai || 0);

        // Tangkap sisa meter spesifik baris, fallback ke finalSisaMeter header jika kosong
        const sisaMeterBaris =
          d.lsbd_sisameter !== null &&
          d.lsbd_sisameter !== undefined &&
          !isNaN(parseFloat(d.lsbd_sisameter))
            ? parseFloat(d.lsbd_sisameter)
            : finalSisaMeter;

        const namaKomponen = d.lsbd_komponen || d.spk_komponen || "ALL SET";

        return [
          nomorLhk,
          d.spk_nomor,
          d.spk_nama || "",
          tanggalForm,
          tanggalForm,
          qtyOrderSpk,
          p,
          l,
          "-",
          qtyHasilLhk,
          jMeter,
          d.lokasi || "SB01",
          usedKodeBahan,
          i + 1,
          0,
          0,
          d.lsbd_poi_nomor || "",
          d.lsbd_poid_size || "",
          parseFloat(d.lsbd_ambilbahan || maxAmbilPanjang),
          panjangPakaiBaris, // Menggunakan nilai per baris
          parseFloat(d.lsbd_lebar_pakai || 0),
          sisaMeterBaris, // Menggunakan nilai sisa per baris / otomatis
          namaKomponen,
        ];
      });

      const sqlInsertDtl = `
        INSERT INTO tlhk_sublim_dtl (
            lsbd_lsb_nomor, lsbd_spk_nomor, lsbd_spk_nama, lsbd_spk_tanggal, lsbd_dateline, 
            lsbd_jumlah_order, lsbd_panjang, lsbd_lebar, lsbd_mesin, lsbd_jumlah, 
            lsbd_j_meter, lsbd_lokasi, lsbd_bahan, lsbd_no_urut, lsbd_toleransi, 
            lsbd_waste, lsbd_poi_nomor, lsbd_poid_size,
            lsbd_ambilbahan, lsbd_panjang_pakai, lsbd_lebar_pakai, lsbd_sisameter,
            lsbd_komponen
        ) VALUES ?`;

      await conn.query(sqlInsertDtl, [values]);
    }

    // 4. LOGIKA MUTASI STOK BARCODE ROLL (JIKA POSTED)
    if (currentStatus === "POSTED") {
      if (usedBarcode && maxAmbilPanjang > 0) {
        const [oldStockData] = await conn.query(
          `SELECT mst_hargabeli, mst_satuan_harga, mst_lebar 
           FROM tmasterstok_mmt 
           WHERE mst_barcode = ? 
           ORDER BY id DESC LIMIT 1`,
          [usedBarcode],
        );

        const hargaBeliLama =
          oldStockData.length > 0 ? oldStockData[0].mst_hargabeli : 0;
        const satuanHargaLama =
          oldStockData.length > 0 ? oldStockData[0].mst_satuan_harga : null;
        const lebarAwal =
          oldStockData.length > 0 ? oldStockData[0].mst_lebar : initialLebar;

        // A. MUTASI KELUAR
        await conn.query(
          `INSERT INTO tmasterstok_mmt (
              mst_brg_kode, mst_gdg_kode, mst_stok_in, mst_stok_out,
              mst_panjang, mst_lebar, mst_spk_nomor, mst_noreferensi,
              mst_hargabeli, mst_satuan_harga, mst_tanggal, mst_barcode, mst_kategori
           ) VALUES (?, ?, 0, 1, ?, ?, ?, ?, ?, ?, ?, ?, 'RETUR')`,
          [
            usedKodeBahan,
            gdgKode,
            maxAmbilPanjang,
            lebarAwal,
            combinedSpkNomor,
            nomorLhk,
            hargaBeliLama,
            satuanHargaLama,
            formattedDate,
            usedBarcode,
          ],
        );

        // B. MUTASI MASUK (SISA METER)
        if (finalSisaMeter > 0) {
          const kategoriSisa = getKategori(finalSisaMeter, initialLebar);
          await conn.query(
            `INSERT INTO tmasterstok_mmt (
                mst_brg_kode, mst_gdg_kode, mst_stok_in, mst_stok_out,
                mst_panjang, mst_lebar, mst_spk_nomor, mst_noreferensi,
                mst_hargabeli, mst_satuan_harga, mst_tanggal, mst_barcode, mst_kategori
             ) VALUES (?, ?, 1, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              usedKodeBahan,
              gdgKode,
              finalSisaMeter,
              initialLebar,
              combinedSpkNomor,
              nomorLhk,
              hargaBeliLama,
              satuanHargaLama,
              formattedDate,
              usedBarcode,
              kategoriSisa,
            ],
          );
        }
      }
    }

    await conn.commit();
    return { success: true, nomor: nomorLhk, status: currentStatus };
  } catch (error) {
    await conn.rollback();
    console.error("CRITICAL SQL ERROR:", error.message);
    return { success: false, message: `Database Error: ${error.message}` };
  } finally {
    conn.release();
  }
};

/**
 * =============================================================================
 * 2. BAGIAN PENGAMBILAN LOOKUP LHK PAPERPRINT
 * =============================================================================
 */
const getLookupLhkPaperprint = async (startDate, endDate, search = "") => {
  const tglMulai = normDate(startDate);
  const tglSelesai = normDate(endDate);
  const hasDate = !!(tglMulai && tglSelesai);
  const params = hasDate ? [tglMulai, tglSelesai] : [];

  let sql = `
    SELECT 
        h.lsb_nomor AS Nomor_Paperprint, 
        DATE_FORMAT(h.lsb_tanggal, '%Y-%m-%d') AS Tanggal, 
        h.lsb_shift AS Shift, 
        d.lsbd_spk_nomor AS Nomor_SPK, 
        d.lsbd_spk_nama AS Nama_SPK, 
        d.lsbd_panjang AS Panjang, 
        d.lsbd_lebar AS Lebar, 
        d.lsbd_jumlah AS Jumlah,
        COALESCE(
          NULLIF(d.lsbd_jumlah_order, 0),
          (SELECT s.spk_jumlah FROM tspk s WHERE s.spk_nomor = d.lsbd_spk_nomor LIMIT 1),
          (SELECT m.Mspk_jumlah FROM tmemospk m WHERE m.mspk_nomor = d.lsbd_spk_nomor LIMIT 1),
          d.lsbd_jumlah,
          0
        ) AS Jumlah_Order,
        COALESCE((SELECT SUM(r.lrd_jumlah) FROM tlhk_rtr_dtl r WHERE r.lrd_spk_nomor = d.lsbd_spk_nomor), 0) AS Sudah_Cetak,
        (d.lsbd_panjang * d.lsbd_lebar * d.lsbd_jumlah) AS Total_Meter,
        d.lsbd_bahan AS Nama_Bahan, 
        IFNULL(d.lsbd_komponen, 'ALL SET') AS Komponen,
        d.lsbd_poi_nomor AS Poi_Nomor,
        d.lsbd_poid_size AS Poi_Size
    FROM tlhk_sublim_hdr h
    INNER JOIN tlhk_sublim_dtl d ON h.lsb_nomor = d.lsbd_lsb_nomor
    WHERE ${hasDate ? "h.lsb_tanggal BETWEEN ? AND ?" : "1=1"}
      AND h.lsb_status = 'POSTED' 
      -- 🔥 Hapus filter h.lsb_jenis = 'P' di sini agar data 'S' (Sublim) bisa muncul
  `;

  if (search) {
    sql += ` AND (
        h.lsb_nomor LIKE ? 
        OR d.lsbd_spk_nomor LIKE ? 
        OR d.lsbd_spk_nama LIKE ?
    ) `;
    const searchPattern = `%${search}%`;
    params.push(searchPattern, searchPattern, searchPattern);
  }

  sql += ` ORDER BY h.lsb_tanggal DESC, h.lsb_nomor DESC `;

  const [rows] = await pool.query(sql, params);
  return rows;
};

/**
 * =============================================================================
 * 3. BAGIAN APPROVAL (Rekap ke tlhk_sublim)
 * =============================================================================
 */

const getLookupForApproval = async (tanggal, shift) => {
  let params = [tanggal];

  // 🐛 FIX: Mengganti lms_nomor, lms_tanggal, lms_status menjadi lsb_ karena mengarah ke tabel tlhk_sublim_hdr
  let sql = `
        SELECT 
            h.lsb_nomor AS Nomor, 
            DATE_FORMAT(h.lsb_tanggal, '%d/%m/%Y') AS Tanggal, 
            h.lsb_shift AS Shift,
            (SELECT lsbd_lokasi FROM tlhk_sublim_dtl WHERE lsbd_lsb_nomor = h.lsb_nomor LIMIT 1) AS Mesin,
            (SELECT SUM(lsbd_panjang * lsbd_lebar * lsbd_jumlah) FROM tlhk_sublim_dtl WHERE lsbd_lsb_nomor = h.lsb_nomor) AS Total_Meter
        FROM tlhk_sublim_hdr h
        WHERE h.lsb_status = 'POSTED' AND h.lsb_tanggal = ?
    `;
  if (shift && shift !== "Semua") {
    sql += ` AND h.lsb_shift = ?`;
    params.push(shift);
  }
  const [rows] = await pool.query(sql, params);
  return rows;
};

const saveApproval = async (data) => {
  const { header, details } = data;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    // Generate nomor approval (MMT-LHK-SA...)
    const yymm = format(new Date(header.tanggal), "yyMM");
    const [maxRows] = await conn.query(
      `SELECT MAX(CAST(SUBSTRING_INDEX(lsb_nomor, '.', -1) AS UNSIGNED)) AS max_num FROM tlhk_sublim_hdr WHERE lsb_nomor LIKE ?`,
      [`${NOMERATOR_APP}.${yymm}.%`],
    );
    const nomorApp = `${NOMERATOR_APP}.${yymm}.${String((maxRows[0].max_num || 0) + 1).padStart(4, "0")}`;

    // 1. Insert ke tlhk_sublim_hdr
    await conn.query(
      `INSERT INTO tlhk_sublim_hdr (lsb_nomor, lsb_tanggal, lsb_gdg_kode, lsb_shift, lsb_user_create, lsb_date_create, lsb_jenis) VALUES (?, ?, ?, ?, ?, NOW(), 'S')`,
      [nomorApp, header.tanggal, header.gdgKode, header.shift, header.admin],
    );

    // 2. Insert ke tlhk_sublim_dtl
    if (details.length > 0) {
      const values = details.map((d, i) => [
        nomorApp,
        i + 1,
        d.nomor_spk,
        d.nama_spk,
        d.panjang,
        d.lebar,
        d.jumlah,
        d.lokasi,
        d.bahan,
        d.jml_order,
      ]);
      await conn.query(
        `INSERT INTO tlhk_sublim_dtl (lsbd_lsb_nomor, lsbd_no_urut, lsbd_spk_nomor, lsbd_spk_nama, lsbd_panjang, lsbd_lebar, lsbd_jumlah, lsbd_lokasi, lsbd_bahan, lsbd_jumlah_order) VALUES ?`,
        [values],
      );

      // 3. Update status di tabel asal (mesinsublim)
      // 🐛 FIX: lms_status -> lsb_status dan lms_nomor -> lsb_nomor
      const idsAsal = details.map((d) => d.lhk_nomor);
      await conn.query(
        `UPDATE tlhk_sublim_hdr SET lsb_status = 'APPROVED' WHERE lsb_nomor IN (?)`,
        [idsAsal],
      );
    }

    await conn.commit();
    return { success: true, nomor: nomorApp };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
};

/**
 * Mengambil daftar history Approval (tlhk_sublim_hdr)
 */
const getAllApprovalHeaders = async (startDate, endDate) => {
  const tglMulai = normDate(startDate);
  const tglSelesai = normDate(endDate);
  const hasDate = !!(tglMulai && tglSelesai);

  const sql = `
        SELECT 
            h.lsb_nomor AS Nomor, 
            DATE_FORMAT(h.lsb_tanggal, '%d/%m/%Y') AS Tanggal, 
            h.lsb_shift AS Shift,
            h.lsb_user_create AS Admin,
            h.lsb_jenis AS Jenis,
            (SELECT SUM(lsbd_panjang * lsbd_lebar * lsbd_jumlah) 
             FROM tlhk_sublim_dtl 
             WHERE lsbd_lsb_nomor = h.lsb_nomor) AS Total_Meter,
            (SELECT COUNT(*) 
             FROM tlhk_sublim_dtl 
             WHERE lsbd_lsb_nomor = h.lsb_nomor) AS Jumlah_Item
        FROM tlhk_sublim_hdr h
        WHERE ${hasDate ? "h.lsb_tanggal BETWEEN ? AND ?" : "1=1"}
        ORDER BY h.lsb_tanggal DESC, h.lsb_nomor DESC
    `;

  const [rows] = await pool.query(sql, hasDate ? [tglMulai, tglSelesai] : []);
  return rows;
};

/**
 * Mengambil detail Approval berdasarkan nomor (untuk expand row di Browse Approval)
 */
const getApprovalDetailsByNomor = async (nomor) => {
  const sqlDetail = `
        SELECT 
            d.lsbd_lsb_nomor AS Nomor_App,
            d.lsbd_no_urut AS No_Urut,
            d.lsbd_lokasi AS Lokasi, 
            d.lsbd_spk_nomor AS Nomor_SPK, 
            d.lsbd_spk_nama AS Nama_SPK,
            d.lsbd_jumlah AS Jumlah, 
            d.lsbd_bahan AS Bahan, 
            d.lsbd_panjang AS Panjang,
            d.lsbd_lebar AS Lebar,
            (d.lsbd_panjang * d.lsbd_lebar * d.lsbd_jumlah) AS Total_M2
        FROM tlhk_sublim_dtl d
        WHERE d.lsbd_lsb_nomor = ?
        ORDER BY d.lsbd_no_urut
    `;

  const [rows] = await pool.query(sqlDetail, [nomor]);
  return rows;
};

module.exports = {
  getAllHeaders,
  getDetailsByNomor,
  saveLhkMesin,
  getLookupForApproval,
  saveApproval,
  getAllApprovalHeaders,
  getApprovalDetailsByNomor,
  accLhkPaperprint,
  getLookupLhkPaperprint, // 🌟 Pastikan fungsi ini diekspor
};
