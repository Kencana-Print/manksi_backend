const db = require("../../config/database");
const tutupBukuService = require("../tutupBukuService");
const sharp = require("sharp");
const fs = require("fs");
const path = require("path");

// --- GENERATE NOMOR ---
const generateNomor = async (perushKode, tanggal) => {
  const d = new Date(tanggal);
  const tahun = d.getFullYear(); // ex: 2026
  const bulan = String(d.getMonth() + 1).padStart(2, "0");

  // Format: 00023/KP/2026 (Urut/KodePerush/Tahun)
  const query = `
    SELECT IFNULL(MAX(CAST(LEFT(pen_nomor, 5) AS UNSIGNED)), 0) AS max_val 
    FROM tpenawaran_hdr 
    WHERE RIGHT(pen_nomor, 7) = ? AND SUBSTR(pen_nomor, 4, 1) <> "/"
  `;
  const suffix = `${perushKode}/${tahun}`;
  const [[row]] = await db.query(query, [suffix]);

  const nextNum = parseInt(row.max_val, 10) + 1;
  // Urutan mulai dari 100001 di Delphi, tapi biasanya urutan standar:
  // (Jika di Delphi: 100001+fields[0], lalu di-right 5. Sama saja dengan padStart 5)
  const incrementStr = String(nextNum).padStart(5, "0");

  return `${incrementStr}/${suffix}`;
};

// --- GET BY ID (LOAD DATA) ---
const getById = async (nomor) => {
  const queryHdr = `
    SELECT a.*, 
           c.Perush_nama, c.perush_alamatnpwp, c.perush_telp, c.perush_fax, c.perush_email, 
           b.cus_nama, b.cus_alamat, b.cus_kota, b.cus_cp,
           f.sal_nama, 
           e.perushd_bank, e.perushd_atasnama, e.perushd_cabang
    FROM tpenawaran_hdr a
    LEFT JOIN tcustomer b ON a.pen_cus_kode = b.cus_kode 
    LEFT JOIN tperusahaan c ON a.pen_perush_kode = c.perush_kode
    LEFT JOIN tsales f ON f.sal_kode = a.pen_sal_kode 
    LEFT JOIN tperusahaan_dtl e ON c.perush_kode = e.perushd_perush_kode AND e.perushd_rekening = a.pen_rekening
    WHERE a.pen_nomor = ?
  `;
  const [rowsHdr] = await db.query(queryHdr, [nomor]);
  if (rowsHdr.length === 0) return null;

  const data = rowsHdr[0];

  // 2. Ambil Detail + Cek Referensi SPK
  const queryDtl = `
    SELECT d.*, 
           IFNULL((IFNULL(s.spk_nomor, m.MSPK_Nomor)), "") AS spk
    FROM tpenawaran_dtl d
    LEFT JOIN tspk s ON s.spk_pen_nomor = d.pend_pen_nomor AND s.spk_pen_id = d.pend_id
    LEFT JOIN tmemospk m ON m.mspk_pen_nomor = d.pend_pen_nomor AND m.mspk_pen_id = d.pend_id
    WHERE d.pend_pen_nomor = ?
    ORDER BY d.pend_urutan
  `;
  const [rowsDtl] = await db.query(queryDtl, [nomor]);
  data.Details = rowsDtl;

  // 3. Status PIN 5 (Approval Perubahan)
  const [pinRows] = await db.query(
    `SELECT pin_urut, pin_acc, pin_dipakai FROM tspk_pin5 
     WHERE pin_trs = "PENAWARAN" AND pin_nomor = ? ORDER BY pin_urut DESC LIMIT 1`,
    [nomor],
  );

  data.StatusEdit = "MINTA"; // Default form state
  data.UrutPin = 0;

  if (pinRows.length > 0) {
    const pin = pinRows[0];
    data.UrutPin = pin.pin_urut;

    if (pin.pin_acc === "" && pin.pin_dipakai === "") {
      data.StatusEdit = "WAIT";
    } else if (pin.pin_acc === "Y" && pin.pin_dipakai === "") {
      data.StatusEdit = "ACC";
    } else if (pin.pin_acc === "N") {
      data.StatusEdit = "TOLAK";
    } else {
      // Sama seperti Delphi: else begin xminta5:='MINTA'; end;
      data.StatusEdit = "MINTA";
    }
  }

  // 4. Cek Tutup Buku
  const zdtClose = await tutupBukuService.getTanggalTutupBuku();
  const tglDokumen = new Date(data.pen_tanggal);
  data.isTutupBuku = false;

  // Jika dokumen di-close, TAPI tidak sedang dalam status ACC pin5, maka lock.
  if (zdtClose && tglDokumen < zdtClose && data.StatusEdit !== "ACC") {
    data.isTutupBuku = true;
  }

  return data;
};

// --- SAVE TRANSAKSI ---
const save = async (data, userKode, isNewMode) => {
  // Validasi Tutup Buku
  const zdtClose = await tutupBukuService.getTanggalTutupBuku();
  const tglInput = new Date(data.Tanggal);
  if (zdtClose && tglInput < zdtClose && data.StatusEdit !== "ACC") {
    throw new Error(
      "Anda tidak boleh input/edit di tanggal periode yang sudah diclose.",
    );
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    let nomorPen = data.Nomor;

    // --- 1. SIMPAN HEADER ---
    if (isNewMode) {
      nomorPen = await generateNomor(data.PerushKode, data.Tanggal);
      const insertQ = `
        INSERT INTO tpenawaran_hdr (
          pen_nomor, pen_divisi, pen_tanggal, pen_tipe, pen_perush_kode, 
          pen_cus_kode, pen_sal_kode, pen_keterangan, pen_note, pen_rekening, 
          pen_dpper, pen_status_harga, pen_ttd, pen_ttd_jabatan, pen_up, 
          pen_marketing, pen_marketing_telp, pen_cetaktotal, pen_panjang, pen_lebar, 
          pen_tambahan, pen_fu1, pen_fu2, pen_fu3, pen_proyeksi, pen_sample,
          pen_mx, pen_digitalsign, date_create, user_create
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?)
      `;
      await conn.query(insertQ, [
        nomorPen,
        data.Divisi,
        data.Tanggal,
        data.Tipe,
        data.PerushKode,
        data.CustKode,
        data.SalesKode,
        data.Keterangan,
        data.Note,
        data.Rekening,
        data.DpPer || 0,
        data.StatusHarga || 0,
        data.TtdNama,
        data.TtdJabatan,
        data.Up,
        data.Marketing,
        data.MarketingTelp,
        data.CetakTotal ? 1 : 0,
        data.Panjang || 0,
        data.Lebar || 0,
        data.TambahanText,
        data.Fu1,
        data.Fu2,
        data.Fu3,
        data.Proyeksi,
        data.SampleText || "",
        data.Mx,
        data.DigitalSign,
        userKode,
      ]);
    } else {
      const updateQ = `
        UPDATE tpenawaran_hdr SET 
          pen_tanggal=?, pen_tipe=?, pen_perush_kode=?, pen_cus_kode=?, pen_sal_kode=?, 
          pen_keterangan=?, pen_note=?, pen_rekening=?, pen_dpper=?, pen_status_harga=?, 
          pen_ttd=?, pen_ttd_jabatan=?, pen_up=?, pen_marketing=?, pen_marketing_telp=?, 
          pen_cetaktotal=?, pen_panjang=?, pen_lebar=?, pen_tambahan=?, 
          pen_fu1=?, pen_fu2=?, pen_fu3=?, pen_proyeksi=?, pen_sample = ?, pen_mx=?, pen_digitalsign=?,
          date_modified=NOW(), user_modified=?
        WHERE pen_nomor=?
      `;
      await conn.query(updateQ, [
        data.Tanggal,
        data.Tipe,
        data.PerushKode,
        data.CustKode,
        data.SalesKode,
        data.Keterangan,
        data.Note,
        data.Rekening,
        data.DpPer || 0,
        data.StatusHarga || 0,
        data.TtdNama,
        data.TtdJabatan,
        data.Up,
        data.Marketing,
        data.MarketingTelp,
        data.CetakTotal ? 1 : 0,
        data.Panjang || 0,
        data.Lebar || 0,
        data.TambahanText,
        data.Fu1,
        data.Fu2,
        data.Fu3,
        data.Proyeksi,
        data.SampleText || "",
        data.Mx,
        data.DigitalSign,
        userKode,
        nomorPen,
      ]);

      // Jika edit hasil ACC, matikan PIN
      if (data.StatusEdit === "ACC") {
        await conn.query(
          `UPDATE tspk_pin5 SET pin_dipakai="Y" WHERE pin_trs="PENAWARAN" AND pin_nomor=? AND pin_dipakai=""`,
          [nomorPen],
        );
      }
    }

    // --- 2. HAPUS DETAIL LAMA (Kecuali yang nempel di SPK) ---
    const delDtlQ = `
      DELETE FROM tpenawaran_dtl 
      WHERE pend_pen_nomor = ? AND pend_id NOT IN (
        SELECT x.id FROM (
          SELECT spk_pen_id AS id FROM tspk WHERE spk_pen_nomor = ?
          UNION ALL
          SELECT mspk_pen_id AS id FROM tmemospk WHERE mspk_pen_nomor = ?
        ) x GROUP BY x.id
      )
    `;
    await conn.query(delDtlQ, [nomorPen, nomorPen, nomorPen]);

    // --- 3. SIMPAN DETAIL BARU/UPDATE ---
    for (let i = 0; i < data.Details.length; i++) {
      const d = data.Details[i];
      // Jika baris valid (ada nama) dan belum nempel ke SPK, Insert
      if (d.NamaBarang && !d.Spk) {
        const insDtl = `
          INSERT INTO tpenawaran_dtl (
            pend_urutan, pend_pen_nomor, pend_minta, pend_nama_barang, pend_bahan, pend_ukuran,
            pend_panjang, pend_lebar, pend_satuan, pend_qty, pend_harga, pend_gambar, 
            pend_status, pend_batal, pend_confirm, pend_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        await conn.query(insDtl, [
          i + 1,
          nomorPen,
          d.NoPermintaan || "",
          d.NamaBarang,
          d.Bahan || "",
          d.Ukuran || "",
          d.Panjang || 0,
          d.Lebar || 0,
          d.Satuan || "",
          d.Qty || 0,
          d.Harga || 0,
          d.Gambar || "",
          d.Status || "",
          d.Batal || "",
          d.Confirm || "",
          d.ID || String(i + 101).slice(-2),
        ]);
      }
      // Jika sudah nempel ke SPK, hanya update urutannya (Delphi logic)
      else if (d.NamaBarang && d.Spk) {
        await conn.query(
          `UPDATE tpenawaran_dtl SET pend_urutan=? WHERE pend_pen_nomor=? AND pend_nama_barang=? AND pend_bahan=? AND pend_ukuran=?`,
          [i + 1, nomorPen, d.NamaBarang, d.Bahan || "", d.Ukuran || ""],
        );
      }
    }

    await conn.commit();
    return nomorPen;
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
};

const getMintaHargaDetail = async (nomorMintaHarga) => {
  const query = `
    SELECT m.mh_nomor, m.mh_nama, m.mh_kain, m.mh_ukuran, m.mh_panjang, m.mh_lebar, 
           m.mh_harga_kalkulasi, m.mh_jmlorder, m.mh_status
    FROM tmintaharga m
    WHERE m.mh_nomor = ?
  `;
  const [rows] = await db.query(query, [nomorMintaHarga]);
  if (rows.length === 0) throw new Error("No. Permintaan tidak ditemukan.");

  const mh = rows[0];
  if (mh.mh_status === "CANCEL")
    throw new Error("No. Permintaan tsb telah dicancel.");

  // -----------------------------------------------------------------
  // HAPUS ATAU KOMENTARI 2 BARIS DI BAWAH INI AGAR HARGA 0 DIPERBOLEHKAN
  // -----------------------------------------------------------------
  // if (Number(mh.mh_harga_kalkulasi) === 0)
  //   throw new Error("Belum ada kalkulasi harga untuk No. Permintaan ini.");

  return {
    minta: mh.mh_nomor,
    nama: mh.mh_nama,
    bahan: mh.mh_kain,
    ukuran: mh.mh_ukuran,
    panjang: Number(mh.mh_panjang) || 0,
    lebar: Number(mh.mh_lebar) || 0,
    qty: Number(mh.mh_jmlorder) || 0,
    harga: Number(mh.mh_harga_kalkulasi) || 0, // Akan bernilai 0
  };
};

/**
 * @description Memproses gambar Penawaran Detail: Konversi ke JPG dan pindah ke folder cabang.
 */
const processImage = async (tempFilePath, cabang) => {
  if (!fs.existsSync(tempFilePath)) {
    throw new Error("File sumber sementara tidak ditemukan.");
  }

  // Generate nama unik karena 1 penawaran bisa punya banyak gambar di detail
  const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
  const finalFileName = `PEN_DTL_${uniqueSuffix}.jpg`;

  // Path: public/images/K01/penawaran/PEN_DTL_1690123.jpg
  const branchFolderPath = path.join(
    process.cwd(),
    "public",
    "images",
    cabang,
    "penawaran",
  );

  if (!fs.existsSync(branchFolderPath)) {
    fs.mkdirSync(branchFolderPath, { recursive: true });
  }

  const finalPath = path.join(branchFolderPath, finalFileName);

  try {
    // Konversi dengan Sharp (kompresi dan standarisasi format)
    await sharp(tempFilePath)
      .flatten({ background: { r: 255, g: 255, b: 255 } }) // Jika PNG transparan jadi putih
      .toFormat("jpeg")
      .jpeg({ quality: 80 })
      .toFile(finalPath);

    // Hapus file temp
    if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);

    return finalFileName;
  } catch (error) {
    if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
    console.error("Gagal memproses gambar Penawaran:", error);
    throw new Error("Gagal memproses gambar ke format JPG.");
  }
};

module.exports = {
  getById,
  save,
  getMintaHargaDetail,
  processImage,
};
