const db = require("../../config/database");
const tutupBukuService = require("../../services/tutupBukuService");

/**
 * Generate Nomor Otomatis (Format: PROG/00001/YYYY)
 */
const generateNomor = async (tahun, conn) => {
  const prefix = "PROG/";
  const suffix = `/${tahun}`;

  // Mencari nilai max dari 5 digit tengah
  const query = `
    SELECT IFNULL(MAX(CAST(SUBSTRING(promin_nomor, 6, 5) AS UNSIGNED)), 0) AS max_num 
    FROM tproduksiminta_hdr 
    WHERE LEFT(promin_nomor, 5) = ? AND RIGHT(promin_nomor, 4) = ?
  `;
  const [rows] = await conn.query(query, [prefix, tahun]);
  const nextNum = parseInt(rows[0].max_num, 10) + 1;

  return `${prefix}${String(nextNum).padStart(5, "0")}${suffix}`;
};

/**
 * Mengambil Akumulasi "Sudah Diminta" (meniru fungsi getsudah di Delphi)
 */
const getSudah = async (nomorMinta, kodeBahan, currentNomorRealisasi = "") => {
  const query = `
    SELECT IFNULL(SUM(d.promind_Jumlah), 0) AS jml
    FROM tproduksiminta_hdr h
    INNER JOIN tproduksiminta_dtl d ON d.promind_promin_nomor = h.promin_nomor
    WHERE h.promin_minta = ? AND d.promind_kodem = ? AND h.promin_nomor <> ?
  `;
  const [rows] = await db.query(query, [
    nomorMinta,
    kodeBahan,
    currentNomorRealisasi,
  ]);
  return rows[0].jml || 0;
};

/**
 * Load Data Permintaan saat User memilih No. Permintaan (Minta)
 */
const getPermintaanInfo = async (nomorMinta, currentRealisasi = "", user) => {
  // Ambil kode gudang bahan dari session user (login)
  const kodeGudangBahanUser = user.gudang.bahan.kode; // Contoh: 'GB001'

  const query = `
    SELECT 
      h.min_nomor, h.min_tanggal, h.min_cab, h.min_spk_nomor, h.min_apv, h.min_close,
      -- 1. Gudang Bahan Baku (Sesuai parameter dari session user)
      ? AS kode_gdg_bahan, 
      (SELECT gdg_nama FROM tgudang WHERE gdg_kode = ?) AS nama_gdg_bahan,
      (SELECT mkb_nomor FROM tmkb_hdr WHERE mkb_spk_nomor = h.min_spk_nomor LIMIT 1) AS mkb_nomor,

      -- 2. Gudang Produksi (Ambil dari tgudangproduksi sesuai logic Delphi)
      IF(h.min_cab = 'P01', 'GP015', 'GP001') AS kode_gdg_prod,
      gp.gdgp_nama AS nama_gdg_prod,

      IFNULL(s.spk_nama, m.mspk_nama) AS namaspk,
      IFNULL(s.spk_jumlah, m.mspk_jumlah) AS jumlahspk,
      d.mind_bhn_kode, d.mind_jumlah, b.Bhn_Name, b.Bhn_satuan,
      IFNULL((SELECT SUM(mst_stok_in - mst_stok_out) FROM tmasterstok_bahan WHERE mst_aktif="Y" AND mst_brg_kode=b.Bhn_kode), 0) AS stok
    FROM tmintabahan_hdr h
    INNER JOIN tmintabahan_dtl d ON d.mind_nomor = h.min_nomor
    LEFT JOIN tgudangproduksi gp ON gp.gdgp_kode = IF(h.min_cab = 'P01', 'GP015', 'GP001')
    LEFT JOIN tbahan b ON b.Bhn_kode = d.mind_bhn_kode
    LEFT JOIN tspk s ON s.spk_nomor = h.min_spk_nomor
    LEFT JOIN tmemospk m ON m.mspk_nomor = h.min_spk_nomor
    WHERE h.min_nomor = ?
  `;

  // Masukkan kodeGudangBahanUser ke dalam query parameter
  const [rows] = await db.query(query, [
    kodeGudangBahanUser,
    kodeGudangBahanUser,
    nomorMinta,
  ]);
  if (rows.length === 0) throw new Error("No. Permintaan tidak ditemukan.");

  const header = rows[0];

  // VALIDASI APPROVAL GUDANG
  if (header.min_apv === "N")
    throw new Error("No. Permintaan tsb belum di Approve oleh Divisi Gudang.");
  if (header.min_apv === "TOLAK")
    throw new Error("No. Permintaan tsb ditolak oleh Divisi Gudang.");
  // ⬅ BARU: cegah realisasi baru kalau permintaan sudah CLOSE (realisasi
  // penuh). min_close=2 (ONPROSES/sebagian) TETAP diizinkan lanjut —
  // itu justru alur normal realisasi bertahap.
  if (Number(header.min_close) === 1 && !currentRealisasi) {
    throw new Error(
      "No. Permintaan tsb sudah CLOSE (realisasi sudah penuh). Tidak bisa direalisasikan lagi.",
    );
  }

  const resultDetails = [];
  for (const row of rows) {
    const sudah = await getSudah(
      nomorMinta,
      row.mind_bhn_kode,
      currentRealisasi,
    );
    const minta = parseFloat(row.mind_jumlah) || 0;

    resultDetails.push({
      kode: row.mind_bhn_kode,
      kodem: row.mind_bhn_kode,
      nama: row.Bhn_Name,
      namam: row.Bhn_Name,
      satuan: row.Bhn_satuan,
      satuanm: row.Bhn_satuan,
      stk: parseFloat(row.stok) || 0,
      minta: minta,
      sudah: sudah,
      kurang: minta - sudah,
      netto: 0,
      gross: 0,
      ket: "",
      kdsup: "",
      nmsup: "",
      relaxtgl: "",
      relaxpic: "",
      roll: 0,
    });
  }

  return {
    header: {
      nomorMinta: header.min_nomor,
      tanggalMinta: header.min_tanggal,
      spk: header.min_spk_nomor,
      namaSpk: header.namaspk,
      jumlahSpk: header.jumlahspk,
      // Mapping Field yang sudah disesuaikan
      gudangBahanKode: header.kode_gdg_bahan,
      gudangBahanNama: header.nama_gdg_bahan,
      gudangProduksiKode: header.kode_gdg_prod,
      gudangProduksiNama: header.nama_gdg_prod,
    },
    details: resultDetails,
  };
};

/**
 * Mendapatkan Info Barcode Bahan (Tabel 1) beserta info Supplier
 */
const getBarcodeInfo = async (barcode) => {
  const query = `
    SELECT 
      a.bard_barcode, a.bard_kode, b.Bhn_Name, b.Bhn_satuan,
      IFNULL((SELECT SUM(m.mst_stok_in - m.mst_stok_out) FROM tmasterstok_barcode m WHERE m.mst_aktif="Y" AND m.mst_brg_kode=a.bard_barcode), 0) AS stok,
      -- LOGIKA GETSUPPLIER: Melacak Supplier dari BPB
      IFNULL(bpb.bpb_sup_kode, "") AS kode_supplier,
      IFNULL(sup.sup_nama, "") AS nama_supplier
    FROM tbahan_barcode_dtl a
    INNER JOIN tbahan b ON b.Bhn_kode = a.bard_kode
    LEFT JOIN tbahan_barcode_hdr h ON h.bar_nomor = a.bard_nomor
    LEFT JOIN tbpb_hdr bpb ON bpb.bpb_Nomor = h.bar_bpb
    LEFT JOIN tsupplier sup ON sup.sup_kode = bpb.bpb_sup_kode
    WHERE a.bard_barcode = ?
  `;
  const [rows] = await db.query(query, [barcode]);

  if (rows.length === 0)
    throw new Error("Barcode tidak terdaftar di master bahan.");

  return {
    barcode: rows[0].bard_barcode,
    kode: rows[0].bard_kode,
    nama: rows[0].Bhn_Name,
    satuan: rows[0].Bhn_satuan,
    stok: parseFloat(rows[0].stok),
    jumlah: parseFloat(rows[0].stok), // Default jumlah = stok full
    // Tambahan dari getsupplier
    kdsup: rows[0].kode_supplier,
    nmsup: rows[0].nama_supplier,
  };
};

/**
 * Load Data Edit Realisasi (loaddataall)
 */
const getDetailRealisasi = async (nomor) => {
  const qHdr = `
    SELECT h.*, 
      IFNULL(s.spk_nama, m.mspk_nama) AS namaspk,
      IFNULL(s.spk_jumlah, m.mspk_jumlah) AS jumlahspk,
      (SELECT pin_dipakai FROM tspk_pin5 WHERE pin_trs="REALISASI MINTA BAHAN" AND pin_nomor=h.promin_nomor ORDER BY pin_urut DESC LIMIT 1) AS pin_dipakai,
      (SELECT pin_acc FROM tspk_pin5 WHERE pin_trs="REALISASI MINTA BAHAN" AND pin_nomor=h.promin_nomor ORDER BY pin_urut DESC LIMIT 1) AS pin_acc
    FROM tproduksiminta_hdr h
    LEFT JOIN tspk s ON s.spk_nomor = h.promin_spk_nomor
    LEFT JOIN tmemospk m ON m.mspk_nomor = h.promin_spk_nomor
    WHERE h.promin_nomor = ?
  `;
  const [hdrRows] = await db.query(qHdr, [nomor]);
  if (hdrRows.length === 0) throw new Error("Nomor Realisasi tidak ditemukan");

  const qDtl = `
    SELECT d.*, b.Bhn_Name, b.Bhn_satuan, c.Bhn_Name AS namam, c.Bhn_satuan AS satuanm, p.sup_nama,
      -- PERBAIKAN: Ditambah dengan promind_gross sesuai logika Delphi (Sisa stok dikembalikan seperti sebelum transaksi)
      (IFNULL((SELECT SUM(m.mst_stok_in - m.mst_stok_out) FROM tmasterstok_bahan m WHERE m.mst_aktif="Y" AND m.mst_brg_kode=b.bhn_kode), 0) + d.promind_gross) AS Stk,
      IFNULL((SELECT i.mind_jumlah FROM tmintabahan_hdr j INNER JOIN tmintabahan_dtl i ON i.mind_nomor=j.min_nomor WHERE j.min_nomor=h.promin_minta AND i.mind_bhn_kode=d.promind_kodem LIMIT 1), 0) AS minta
    FROM tproduksiminta_dtl d
    INNER JOIN tproduksiminta_hdr h ON h.promin_nomor = d.promind_promin_nomor
    LEFT JOIN tbahan b ON b.Bhn_kode = d.promind_bhn_kode
    LEFT JOIN tbahan c ON c.Bhn_kode = d.promind_kodem
    LEFT JOIN tsupplier p ON p.sup_kode = d.promind_sup_kode
    WHERE d.promind_promin_nomor = ?
  `;
  const [dtlRows] = await db.query(qDtl, [nomor]);

  const qDtlBarcode = `
    SELECT d.*, b.Bhn_Name, b.Bhn_satuan,
      IFNULL((SELECT SUM(m.mst_stok_in - m.mst_stok_out) FROM tmasterstok_barcode m WHERE m.mst_aktif="Y" AND m.mst_brg_kode=d.promind2_barcode AND m.mst_noreferensi <> d.promind2_promin_nomor), 0) AS stok
    FROM tproduksiminta_dtl2 d
    LEFT JOIN tbahan b ON b.Bhn_kode = d.promind2_bhn_kode
    WHERE d.promind2_promin_nomor = ?
  `;
  const [barcodeRows] = await db.query(qDtlBarcode, [nomor]);

  return {
    header: hdrRows[0],
    details: dtlRows,
    barcodes: barcodeRows,
  };
};

/**
 * Menerapkan mutasi stok utk semua baris dtl & dtl2 milik 1 realisasi.
 * Dipanggil SEKALI saat realisasi pindah status pasif -> aktif (approval ACC=Y).
 * Meniru persis logic trigger after_insert (dtl) & dtl2_after_insert,
 * karena trigger itu cuma nyala saat event INSERT baris baru, bukan saat
 * header di-UPDATE belakangan.
 */
const applyStokKeluar = async (nomor, conn) => {
  const [[hdr]] = await conn.query(
    `SELECT promin_gdg_asal, promin_tanggal, promin_mkb, promin_spk_nomor, promin_minta
     FROM tproduksiminta_hdr WHERE promin_nomor = ?`,
    [nomor],
  );
  if (!hdr) throw new Error("Header realisasi tidak ditemukan.");

  const [[minta]] = await conn.query(
    `SELECT min_cab, min_divisi FROM tmintabahan_hdr WHERE min_nomor = ?`,
    [hdr.promin_minta],
  );
  const acab = minta?.min_cab || "";
  const adiv = minta?.min_divisi || "";

  let atglmkb = null;
  if (hdr.promin_mkb) {
    const [[mkb]] = await conn.query(
      `SELECT MKB_TANGGAL AS tgl FROM tmkb_hdr WHERE MKB_NOMOR = ?`,
      [hdr.promin_mkb],
    );
    atglmkb = mkb?.tgl ? new Date(mkb.tgl) : null;
  }
  const batasMkb = new Date("2022-05-01");
  const batasCuting = new Date("2026-04-23");
  const tglRealisasi = new Date(hdr.promin_tanggal);

  // --- Mirror after_insert (dtl) utk tiap baris bahan yg sudah tersimpan ---
  const [dtlRows] = await conn.query(
    `SELECT promind_bhn_kode, promind_gross, promind_rs FROM tproduksiminta_dtl WHERE promind_promin_nomor = ?`,
    [nomor],
  );
  for (const d of dtlRows) {
    await conn.query(
      `INSERT INTO tmasterstok_bahan (mst_gdg_kode, mst_brg_kode, mst_stok_out, mst_noreferensi, mst_tanggal)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE mst_stok_out = mst_stok_out + VALUES(mst_stok_out)`,
      [
        hdr.promin_gdg_asal,
        d.promind_bhn_kode,
        d.promind_gross,
        nomor,
        hdr.promin_tanggal,
      ],
    );

    if (hdr.promin_mkb && atglmkb && atglmkb >= batasMkb) {
      await conn.query(
        `INSERT INTO tmasterstok_keepstok (mst_tanggal, mst_noreferensi, mst_spk, mst_brg_kode, mst_stok_out)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE mst_stok_out = mst_stok_out + VALUES(mst_stok_out)`,
        [
          hdr.promin_tanggal,
          nomor,
          hdr.promin_spk_nomor,
          d.promind_bhn_kode,
          d.promind_gross,
        ],
      );

      if (d.promind_rs && Number(d.promind_rs) !== 0) {
        await conn.query(
          `UPDATE tmasterstok_keepstok SET mst_minta = mst_minta + ?
           WHERE mst_noreferensi = ? AND mst_spk = ? AND mst_brg_kode = ?`,
          [
            d.promind_gross,
            hdr.promin_mkb,
            hdr.promin_spk_nomor,
            d.promind_bhn_kode,
          ],
        );
      }
    }

    if (adiv === "CUTING" && tglRealisasi >= batasCuting) {
      await conn.query(
        `INSERT INTO tmasterstok_cuting (mst_cab, mst_brg_kode, mst_stok_in, mst_noreferensi, mst_tanggal)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE mst_stok_in = mst_stok_in + VALUES(mst_stok_in)`,
        [acab, d.promind_bhn_kode, d.promind_gross, nomor, hdr.promin_tanggal],
      );
    }
  }

  // --- Mirror dtl2_after_insert utk tiap baris barcode yg sudah tersimpan ---
  const [dtl2Rows] = await conn.query(
    `SELECT promind2_barcode, promind2_jumlah FROM tproduksiminta_dtl2 WHERE promind2_promin_nomor = ?`,
    [nomor],
  );
  for (const b of dtl2Rows) {
    await conn.query(
      `INSERT INTO tmasterstok_barcode (mst_brg_kode, mst_stok_out, mst_noreferensi, mst_tanggal)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE mst_stok_out = VALUES(mst_stok_out)`,
      [b.promind2_barcode, b.promind2_jumlah, nomor, hdr.promin_tanggal],
    );
  }
};

/**
 * Simpan Data Realisasi (Create/Edit)
 */
const saveData = async (payload, user, isEdit = false) => {
  const conn = await db.getConnection();
  await conn.beginTransaction();

  try {
    let nomor = payload.nomor;
    const now = new Date();
    const dateModified =
      now.getFullYear() +
      "-" +
      String(now.getMonth() + 1).padStart(2, "0") +
      "-" +
      String(now.getDate()).padStart(2, "0") +
      " " +
      String(now.getHours()).padStart(2, "0") +
      ":" +
      String(now.getMinutes()).padStart(2, "0") +
      ":" +
      String(now.getSeconds()).padStart(2, "0");

    // 1. VALIDASI TUTUP BUKU
    const zdtClose = await tutupBukuService.getTanggalTutupBuku();
    const tglTrs = new Date(payload.tanggal);
    if (tglTrs <= zdtClose && payload.pin_acc !== "Y") {
      throw new Error(
        "Anda tidak boleh input di tanggal periode yg sudah diclose.",
      );
    }

    if (!isEdit) {
      const [[mintaRow]] = await conn.query(
        `SELECT min_close FROM tmintabahan_hdr WHERE min_nomor = ?`,
        [payload.noMinta],
      );
      if (mintaRow && Number(mintaRow.min_close) === 1) {
        throw new Error(
          "No. Permintaan tsb sudah CLOSE (realisasi sudah penuh). Tidak bisa direalisasikan lagi.",
        );
      }
    }

    // ── DETEKSI BEDA BAHAN ── (kode = discan, kodem = yang diminta
    // aslinya; baris "_extra" dari frontend selalu kodem="")
    const bedaBahanRows = (payload.details || []).filter(
      (d) =>
        d.kode && (d._extra || (d.kodem && String(d.kode) !== String(d.kodem))),
    );
    const adaBedaBahan = bedaBahanRows.length > 0;

    if (adaBedaBahan && !String(payload.alasanBedaBahan || "").trim()) {
      throw new Error(
        "Alasan wajib diisi kalau ada bahan yang berbeda dari permintaan.",
      );
    }

    // Semua realisasi sekarang langsung AKTIF — tidak ada lagi status
    // PASIF/menunggu approval untuk kasus beda bahan.
    const isNomorAktif = "Y";

    if (isEdit) {
      await conn.query(
        `DELETE FROM tproduksiminta_dtl2 WHERE promind2_promin_nomor=?`,
        [nomor],
      );
      await conn.query(
        `DELETE FROM tproduksiminta_dtl WHERE promind_promin_nomor=?`,
        [nomor],
      );

      await conn.query(
        `
          UPDATE tproduksiminta_hdr SET 
            promin_tanggal=?, promin_minta=?, promin_keterangan=?, promin_alasan_beda=?, promin_gdg_asal=?, 
            promin_spk_nomor=?, promin_gdgp_kode=?, promin_jumlah=?, isstatus=?, 
            promin_aktif=?, date_modified=?, user_modified=? 
          WHERE promin_nomor=?
        `,
        [
          payload.tanggal,
          payload.noMinta,
          payload.keterangan,
          payload.alasanBedaBahan || null, // ⬅ baru
          payload.gudangAsal,
          payload.spk,
          payload.gudangProduksi,
          payload.jumlah,
          payload.isUtama,
          isNomorAktif,
          dateModified,
          user.kode,
          nomor,
        ],
      );

      if (payload.pin_acc === "Y" && !payload.pin_dipakai) {
        await conn.query(
          `UPDATE tspk_pin5 SET pin_dipakai="Y" WHERE pin_trs="REALISASI MINTA BAHAN" AND pin_nomor=? AND pin_dipakai=""`,
          [nomor],
        );
      }
    } else {
      const tahun = payload.tanggal.substring(0, 4);
      nomor = await generateNomor(tahun, conn);

      await conn.query(
        `
          INSERT INTO tproduksiminta_hdr 
          (promin_nomor, promin_tanggal, promin_minta, promin_keterangan, promin_alasan_beda, promin_spk_nomor, promin_mkb, promin_gdg_asal, promin_gdgp_kode, promin_jumlah, isstatus, promin_aktif, date_create, user_create)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          nomor,
          payload.tanggal,
          payload.noMinta,
          payload.keterangan,
          payload.alasanBedaBahan || null, // ⬅ baru
          payload.spk,
          payload.mkb,
          payload.gudangAsal,
          payload.gudangProduksi,
          payload.jumlah,
          payload.isUtama,
          isNomorAktif,
          dateModified,
          user.kode,
        ],
      );
    }

    // 2. INSERT DETAILS BARCODE (dtl2)
    for (const b of payload.barcodes) {
      if (b.barcode && b.kode) {
        await conn.query(
          `
          INSERT INTO tproduksiminta_dtl2 (promind2_promin_nomor, promind2_barcode, promind2_bhn_kode, promind2_jumlah)
          VALUES (?, ?, ?, ?)
        `,
          [nomor, b.barcode, b.kode, b.jumlah],
        );
      }
    }

    // ── KALAU ADA BEDA BAHAN: tambah baris ke Permintaan Bahan &
    // MKB existing (SEBELUM insert detail realisasi, karena
    // getSudah() nanti butuh baris Permintaan Bahan-nya sudah ada) ──
    if (adaBedaBahan) {
      for (const d of bedaBahanRows) {
        const kodePengganti = d.kode;
        const qtyPengganti = Number(d.netto) || 0;

        // a. Tambah baris ke tmintabahan_dtl (Permintaan Bahan existing)
        //    — kalau kode ini SUDAH ada di permintaan (dari substitusi
        //    sebelumnya), jumlahkan; kalau belum, insert baris baru.
        const [[existingMintaDtl]] = await conn.query(
          `SELECT mind_jumlah FROM tmintabahan_dtl WHERE mind_nomor = ? AND mind_bhn_kode = ?`,
          [payload.noMinta, kodePengganti],
        );
        if (existingMintaDtl) {
          await conn.query(
            `UPDATE tmintabahan_dtl SET mind_jumlah = mind_jumlah + ? WHERE mind_nomor = ? AND mind_bhn_kode = ?`,
            [qtyPengganti, payload.noMinta, kodePengganti],
          );
        } else {
          // Salin komponen/babaran dari baris ASLI yang digantikan
          // (baris pertama non-extra di payload.details sebagai acuan)
          const baseRow = payload.details.find((r) => !r._extra) || {};
          await conn.query(
            `INSERT INTO tmintabahan_dtl (mind_nomor, mind_bhn_kode, mind_jumlah, mind_pcs, mind_babaran, mind_komponen, mind_ket)
             VALUES (?, ?, ROUND(?, 2), ?, ?, ?, ?)`,
            [
              payload.noMinta,
              kodePengganti,
              qtyPengganti,
              baseRow.pcs || 0,
              baseRow.babaran || 0,
              baseRow.komponen || "",
              `Substitusi — ${payload.alasanBedaBahan}`,
            ],
          );
        }

        // b. Close Permintaan Bahan
        await conn.query(
          `UPDATE tmintabahan_hdr SET min_close = 1 WHERE min_nomor = ?`,
          [payload.noMinta],
        );

        // c. Tambah baris ke tmkb_dtl (MKB existing), kalau MKB-nya ada
        if (payload.mkb) {
          const [[existingMkbDtl]] = await conn.query(
            `SELECT mkbd_jumlah FROM tmkb_dtl WHERE mkbd_mkb_nomor = ? AND mkbd_bhn_kode = ?`,
            [payload.mkb, kodePengganti],
          );
          if (!existingMkbDtl) {
            // Salin komponen, babaran, satuan dari baris MKB asli yang digantikan
            const [[baseMkbRow]] = await conn.query(
              `SELECT mkbd_komponen, mkbd_ketk, mkbd_warna, mkbd_jenis, mkbd_bhn_satuan, mkbd_babaran
               FROM tmkb_dtl
               WHERE mkbd_mkb_nomor = ?
               ORDER BY mkbd_nourut LIMIT 1`,
              [payload.mkb],
            );
            const [[maxUrut]] = await conn.query(
              `SELECT IFNULL(MAX(mkbd_nourut), 0) + 1 AS next_urut FROM tmkb_dtl WHERE mkbd_mkb_nomor = ?`,
              [payload.mkb],
            );
            await conn.query(
              `INSERT INTO tmkb_dtl (
                mkbd_mkb_nomor, mkbd_komponen, mkbd_ketk, mkbd_warna, mkbd_jenis,
                mkbd_bhn_kode, mkbd_bhn_satuan, mkbd_jumlah, mkbd_jumlah_rs,
                mkbd_jumlah_po, mkbd_nourut, mkbd_babaran, mkbd_keterangan
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ROUND(?, 2), 0, 0, ?, ?, ?)`,
              [
                payload.mkb,
                baseMkbRow?.mkbd_komponen || "",
                baseMkbRow?.mkbd_ketk || "",
                baseMkbRow?.mkbd_warna || "",
                baseMkbRow?.mkbd_jenis || "",
                kodePengganti,
                baseMkbRow?.mkbd_bhn_satuan || "",
                qtyPengganti,
                maxUrut.next_urut,
                baseMkbRow?.mkbd_babaran || 0,
                `Substitusi — ${payload.alasanBedaBahan}`,
              ],
            );
          }
        }

        // d. Set kodem realisasi = kode pengganti itu sendiri (bukan
        // dikosongkan lagi) — sekarang dia "match" ke baris Permintaan
        // Bahan yang baru ditambahkan, jadi getSudah() bisa ngitung benar.
        d.kodem = kodePengganti;
      }
    }

    // 3. INSERT DETAILS MINTA (dtl) & KALKULASI TOTAL
    let tpo = 0;
    let tjumlah = 0;
    let tsudah = 0;

    for (const d of payload.details) {
      if (d.kode && d.nama) {
        const minta = parseFloat(d.minta) || 0;
        const netto = parseFloat(d.netto) || 0;
        const sudah = parseFloat(d.sudah) || 0;

        tpo += minta;
        tjumlah += netto <= minta ? netto : minta;
        tsudah += sudah <= minta ? sudah : minta;

        await conn.query(
          `
          INSERT INTO tproduksiminta_dtl 
          (promind_promin_nomor, promind_bhn_kode, promind_jumlah, promind_gross, promind_sup_kode, promind_keterangan, promind_kodem, promind_relaxpic, promind_relaxtgl)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
          [
            nomor,
            d.kode,
            netto,
            d.gross || netto,
            d.kdsup || "",
            d.ket || "",
            d.kodem || "",
            d.relaxpic || "",
            d.relaxtgl || null,
          ],
        );
      }
    }

    // 4. UPDATE STATUS tmintabahan_hdr.min_close (jalur normal, non-beda-bahan)
    // — kalau ada beda bahan, sudah di-close paksa di langkah atas;
    // untuk kasus normal (tidak ada beda bahan), hitung seperti biasa.
    if (!adaBedaBahan) {
      const tq = tjumlah + tsudah;
      let minCloseStatus = 0;
      if (tq >= tpo && tpo > 0) {
        minCloseStatus = 1;
      } else if (tq > 0 && tq < tpo) {
        minCloseStatus = 2;
      }
      await conn.query(
        `UPDATE tmintabahan_hdr SET min_close=? WHERE min_nomor=?`,
        [minCloseStatus, payload.noMinta],
      );
    }

    // ── Approval "REALISASI BEDA BAHAN" (tspk_pin5) TIDAK DIPAKAI LAGI
    // untuk alur baru ini — dihapus dari saveData. Kode approval-nya
    // (submitRealisasiBedaBahanOtorisasi dkk) dibiarkan ada untuk data
    // lama yang masih PASIF, tapi tidak dipanggil dari sini lagi.

    await conn.commit();
    return { nomor, aktif: isNomorAktif, adaBedaBahan };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
};

const getPrintData = async (nomor) => {
  const queryHdr = `
    SELECT 
      h.promin_nomor, DATE_FORMAT(h.promin_tanggal, '%d %b %Y') AS tgl_realisasi,
      h.promin_minta, DATE_FORMAT(t.min_tanggal, '%d-%m-%Y') AS tgl_minta,
      h.promin_spk_nomor, IFNULL(s.spk_nama, m.mspk_nama) AS spk_nama,
      h.promin_keterangan,
      g.gdgp_nama AS tujuan
    FROM tproduksiminta_hdr h
    LEFT JOIN tmintabahan_hdr t ON t.min_nomor = h.promin_minta
    LEFT JOIN tgudangproduksi g ON g.gdgp_kode = h.promin_gdgp_kode
    LEFT JOIN tspk s ON s.spk_nomor = h.promin_spk_nomor
    LEFT JOIN tmemospk m ON m.mspk_nomor = h.promin_spk_nomor
    WHERE h.promin_nomor = ?
  `;
  const [hdr] = await db.query(queryHdr, [nomor]);
  if (hdr.length === 0) throw new Error("Data Realisasi tidak ditemukan.");

  const queryDtl = `
    SELECT 
      b.Bhn_kode AS kode, 
      b.Bhn_Name AS nama, 
      b.Bhn_satuan AS satuan, 
      d.promind_jumlah AS jumlah
    FROM tproduksiminta_dtl d
    LEFT JOIN tbahan b ON b.Bhn_kode = d.promind_bhn_kode
    WHERE d.promind_promin_nomor = ?
    ORDER BY b.Bhn_Name ASC
  `;
  const [details] = await db.query(queryDtl, [nomor]);

  const queryBar = `
    SELECT promind2_barcode AS barcode, promind2_jumlah AS qty
    FROM tproduksiminta_dtl2
    WHERE promind2_promin_nomor = ?
  `;
  const [barcodes] = await db.query(queryBar, [nomor]);
  const totalBarcode = barcodes.reduce(
    (sum, b) => sum + (parseFloat(b.qty) || 0),
    0,
  );

  return {
    header: hdr[0],
    details,
    barcodes,
    totalBarcode,
  };
};

module.exports = {
  getPermintaanInfo,
  getBarcodeInfo,
  getDetailRealisasi,
  saveData,
  applyStokKeluar,
  getPrintData,
};
