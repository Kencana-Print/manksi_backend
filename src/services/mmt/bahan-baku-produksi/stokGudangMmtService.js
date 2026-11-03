const pool = require('../../../config/database');

exports.getStokByBarcode = async (barcode) => {
  try {
    const sql = `
      SELECT 
        m.mst_barcode AS Barcode,
        m.mst_brg_kode AS Kode,
        m.mst_gdg_kode AS Kode_Gudang,
        b.brg_nama AS Nama_Bahan,
        b.brg_satuan AS Satuan_Bahan, -- 🔥 AMBIL SATUAN BARANG ('ROLL' atau 'Y')
        CAST(ROUND(SUM(m.mst_stok_in * m.mst_panjang) - SUM(m.mst_stok_out * m.mst_panjang), 3) AS DECIMAL(10,2)) AS Sisa_Panjang_Stok,
        MAX(m.mst_lebar) AS Lebar,

        -- 1. Ambil Nomor LHK Terakhir (Dari 4 Jenis LHK)
        (
          SELECT nomor_lhk
          FROM (
            SELECT h.lnomor AS nomor_lhk, h.ldate_create AS tgl
            FROM tlhk_mesin_hdr h WHERE h.lbarcode_roll = ?
            UNION ALL
            SELECT h.lsb_nomor AS nomor_lhk, h.lsb_date_Create AS tgl
            FROM tlhk_sublim_hdr h WHERE h.lsb_barcode = ?
            UNION ALL
            SELECT h.lth_nomor AS nomor_lhk, h.lth_date_create AS tgl
            FROM tlhk_mesintekstil_hdr h WHERE h.lth_barcode = ?
            UNION ALL
            SELECT d.lprd_lpr_nomor AS nomor_lhk, h.lpr_date_Create AS tgl
            FROM tlhk_proofmmt_dtl d
            INNER JOIN tlhk_proofmmt_hdr h ON h.lpr_nomor = d.lprd_lpr_nomor
            WHERE d.lprd_barcode = ?
          ) combined_lhk_hdr
          ORDER BY tgl DESC 
          LIMIT 1
        ) AS Lhk_Terakhir,

        -- 2. Ambil Sisa Meteran Presisi
        (
          SELECT sisa_meter
          FROM (
            SELECT d.ld_sisameter AS sisa_meter, h.ldate_create AS tgl, d.ld_urut AS urut
            FROM tlhk_mesin_dtl d
            INNER JOIN tlhk_mesin_hdr h ON h.lnomor = d.ld_lnomor
            WHERE d.ld_barcode = ?
            UNION ALL
            SELECT d.lsbd_sisameter AS sisa_meter, h.lsb_date_Create AS tgl, d.lsbd_no_urut AS urut
            FROM tlhk_sublim_dtl d
            INNER JOIN tlhk_sublim_hdr h ON h.lsb_nomor = d.lsbd_lsb_nomor
            WHERE h.lsb_barcode = ?
            UNION ALL
            SELECT ROUND(d.ltd_sisameter / 0.9, 2) AS sisa_meter, h.lth_date_create AS tgl, d.ltd_no_urut AS urut
            FROM tlhk_mesintekstil_dtl d
            INNER JOIN tlhk_mesintekstil_hdr h ON h.lth_nomor = d.ltd_lth_nomor
            WHERE h.lth_barcode = ?
            UNION ALL
            SELECT d.lprd_sisa_bahan AS sisa_meter, h.lpr_date_Create AS tgl, d.lprd_no_urut AS urut
            FROM tlhk_proofmmt_dtl d
            INNER JOIN tlhk_proofmmt_hdr h ON h.lpr_nomor = d.lprd_lpr_nomor
            WHERE d.lprd_barcode = ?
          ) combined_lhk_dtl
          ORDER BY tgl DESC, urut DESC
          LIMIT 1
        ) AS Sisa_Panjang_Lhk,

        -- 3. Daftar Semua LHK
        (
          SELECT GROUP_CONCAT(nomor_lhk SEPARATOR ', ')
          FROM (
            SELECT h.lnomor AS nomor_lhk FROM tlhk_mesin_hdr h WHERE h.lbarcode_roll = ?
            UNION ALL
            SELECT h.lsb_nomor AS nomor_lhk FROM tlhk_sublim_hdr h WHERE h.lsb_barcode = ?
            UNION ALL
            SELECT h.lth_nomor AS nomor_lhk FROM tlhk_mesintekstil_hdr h WHERE h.lth_barcode = ?
            UNION ALL
            SELECT d.lprd_lpr_nomor AS nomor_lhk FROM tlhk_proofmmt_dtl d WHERE d.lprd_barcode = ?
          ) combined_all_lhk
        ) AS All_Lhk_List

      FROM tmasterstok_mmt m
      LEFT JOIN tbarang_mmt b ON m.mst_brg_kode = b.brg_kode
      WHERE m.mst_barcode = ?
      GROUP BY m.mst_barcode, m.mst_brg_kode, m.mst_gdg_kode, b.brg_nama, b.brg_satuan;
    `;

    const sqlParams = [
      barcode,
      barcode,
      barcode,
      barcode,
      barcode,
      barcode,
      barcode,
      barcode,
      barcode,
      barcode,
      barcode,
      barcode,
      barcode,
    ];

    const [results] = await pool.query(sql, sqlParams);

    if (!results || results.length === 0) {
      return { data: null, status: "NOT_FOUND" };
    }

    const stokGPM = results.find((r) => r.Kode_Gudang === "GPM");
    const dataRes = stokGPM || results[0];

    // Prioritaskan Sisa_Panjang_Stok (Master Stok / Mutasi),
    // gunakan Sisa_Panjang_Lhk hanya jika Sisa_Panjang_Stok <= 0 atau bernilai null/undefined
    const sisaStokMaster = parseFloat(dataRes.Sisa_Panjang_Stok || 0);
    const sisaStokLhk = parseFloat(dataRes.Sisa_Panjang_Lhk || 0);

    const rawSisaPanjang = sisaStokMaster > 0 ? sisaStokMaster : sisaStokLhk;

    if (rawSisaPanjang <= 0) {
      return { data: null, status: "NOT_FOUND" };
    }

    return {
      status: dataRes.Kode_Gudang === "GPM" ? "READY" : "NEED_MUTATION",
      data: {
        ...dataRes,
        Satuan: (dataRes.Satuan_Bahan || "Y").trim().toUpperCase(),
        Sisa_Panjang: rawSisaPanjang,
        Lebar: parseFloat(dataRes.Lebar || 0),
        Lhk_Terakhir: dataRes.Lhk_Terakhir || null,
        All_Lhk_List: dataRes.All_Lhk_List || "",
      },
    };
  } catch (error) {
    console.error("Error getStokByBarcode:", error);
    throw new Error(`Gagal mengambil stok barcode: ${error.message}`);
  }
};
