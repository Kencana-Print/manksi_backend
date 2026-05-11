const db = require("../../config/database");
const tutupBukuService = require("../tutupBukuService");

// --- 1. GENERATE NOMOR SPK OTOMATIS ---
// Sesuai Delphi: getmaxnomor(akodeperus, akodejo) -> 'SM-KA-000001'
const generateNomor = async (perushKode, joKode) => {
  // Menggunakan RIGHT(spk_nomor, 6) lebih aman untuk mengekstrak angka
  // karena panjang prefix bisa berubah (contoh: SO-SM-KO-000001)
  const [rows] = await db.query(
    `SELECT IFNULL(MAX(CAST(RIGHT(spk_nomor, 6) AS UNSIGNED)), 0) AS jumlah 
     FROM tspk 
     WHERE spk_perush_kode = ? AND spk_jo_kode = ?`,
    [perushKode, joKode],
  );
  const nextVal = rows[0].jumlah + 1;
  return `SO-${perushKode}-${joKode}-${String(nextVal).padStart(6, "0")}`;
};

// --- 2. GET DETAIL UNTUK MODE UBAH ---
const getDetail = async (nomor) => {
  // A. Header
  const [header] = await db.query(
    `SELECT s.*, j.jo_nama, a.sal_nama, p.perush_nama, c.cus_nama, k.cus_nama AS cusk, c.cus_perfect,
      IFNULL((SELECT mkb_nomor FROM tmkb_hdr WHERE mkb_spk_nomor=spk_nomor ORDER BY mkb_tanggal DESC LIMIT 1),"") AS mkb,
      IFNULL((SELECT DATE_FORMAT(mkb_tanggal,"%Y-%m-%d") FROM tmkb_hdr WHERE mkb_spk_nomor=spk_nomor ORDER BY mkb_tanggal DESC LIMIT 1),"") AS dtmkb,
      IFNULL(m.mpb_jmlorder, 0) AS jmlmppb
     FROM tspk s
     LEFT JOIN tjenisorder j ON s.spk_jo_kode = j.jo_kode
     LEFT JOIN tsales a ON s.spk_sal_kode = a.sal_kode
     LEFT JOIN tperusahaan p ON s.spk_perush_kode = p.perush_kode
     LEFT JOIN tcustomer c ON s.spk_cus_kode = c.cus_kode
     LEFT JOIN retail.tcustomer k ON s.spk_cus_kaosan = k.cus_kode
     LEFT JOIN tmpb m ON s.spk_mppb = m.mpb_nomor
     WHERE s.spk_nomor = ?`,
    [nomor],
  );

  if (header.length === 0) throw new Error("Data SPK tidak ditemukan.");

  // B. Detail Alokasi
  const [alokasi] = await db.query(
    `SELECT * FROM talokasi WHERE spk_nomor = ? ORDER BY urut`,
    [nomor],
  );

  // C. Detail Kaosan (tspk_dc) - Hanya untuk Divisi 3
  const [dtlKaosan] = await db.query(
    `SELECT d.spkd_kode AS kode, 
            TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)) AS nama,
            d.spkd_ukuran AS ukuran, d.spkd_qtyorder AS qtyorder
     FROM tspk_dc d
     LEFT JOIN retail.tbarangdc a ON a.brg_kode = d.spkd_kode 
     WHERE d.spkd_nomor = ?`,
    [nomor],
  );

  // D. Detail Size (tspk_size) - Divisi 3, 4, 6
  const [dtlSize] = await db.query(
    `SELECT spks_size AS size, spks_qty AS qty, spks_a AS lb, spks_b AS pb 
     FROM tspk_size WHERE spks_nomor = ? AND spks_qty > 0`,
    [nomor],
  );

  return {
    header: header[0],
    alokasi,
    dtlKaosan,
    dtlSize,
  };
};

// --- 3. SAVE DATA (INSERT & UPDATE) ---
const saveData = async (payload, user) => {
  const { header, alokasi, dtlKaosan, dtlSize, isEdit } = payload;
  const conn = await db.getConnection();

  try {
    await conn.beginTransaction();

    let nomor = header.spk_nomor;
    const divisiStr = String(header.spk_divisi).charAt(0);

    // ==========================================
    // 1. VALIDASI DATA (MENGADOPSI LOGIKA DELPHI)
    // ==========================================

    // Tutup Buku
    const zdtClose = await tutupBukuService.getTanggalTutupBuku();
    if (zdtClose && new Date(header.spk_tanggal) < zdtClose) {
      throw new Error(
        "Anda tidak boleh input/ubah di tanggal periode yang sudah diclose.",
      );
    }

    if (!header.spk_perush_kode) throw new Error("Perusahaan belum diisi.");
    if (!header.spk_cus_kode) throw new Error("Customer belum diisi.");
    if (!header.spk_sal_kode) throw new Error("Sales belum diisi.");
    if (!header.spk_jo_kode) throw new Error("Jenis Order belum diisi.");
    if (!header.spk_nama) throw new Error("Nama SPK belum diisi.");
    if (!header.spk_cab) throw new Error("Kode Workshop (Cabang) harus diisi.");

    if (
      header.spk_datelinepo &&
      header.spk_tgl_po &&
      new Date(header.spk_datelinepo) < new Date(header.spk_tgl_po)
    ) {
      throw new Error(
        "Tanggal Dateline PO harus lebih besar atau sama dengan Tanggal PO.",
      );
    }

    if (
      (divisiStr === "1" || divisiStr === "5") &&
      (!header.spk_panjang || !header.spk_lebar)
    ) {
      throw new Error(
        "Ukuran Panjang dan Lebar harus diisi untuk divisi MMT/Spanduk.",
      );
    }

    // Validasi Harga 0
    if (
      Number(header.spk_harga) === 0 &&
      !header.spk_ketpo &&
      divisiStr !== "3"
    ) {
      throw new Error("Jika harga 0, Ket.PO wajib dipilih.");
    }
    const reqSpkLama = [
      "BARANG PENDUKUNG",
      "BARANG PER SET",
      "PRODUK PENGGANTI",
      "JASA TAMBAHAN",
    ];
    if (!header.spk_lama && reqSpkLama.includes(header.spk_ketpo)) {
      throw new Error(
        `Untuk Ket.Po '${header.spk_ketpo}', SPK Lama wajib diisi.`,
      );
    }

    // Validasi Total Quantity (Alokasi, Kaosan, Size)
    const qtyPesan = Number(header.spk_jumlah);

    if (alokasi && alokasi.length > 0) {
      const sumAlokasi = alokasi.reduce(
        (acc, curr) => acc + Number(curr.jumlah || 0),
        0,
      );
      if (sumAlokasi > 0 && sumAlokasi !== qtyPesan) {
        throw new Error(
          "Jumlah SPK vs Total Qty Alokasi beda. Silahkan cek dulu.",
        );
      }
    }

    if (divisiStr === "3") {
      if (!dtlKaosan || dtlKaosan.length === 0)
        throw new Error("Detail barang kaosan harus diisi.");
      const sumKaosan = dtlKaosan.reduce(
        (acc, curr) => acc + Number(curr.qtyorder || 0),
        0,
      );
      if (sumKaosan === 0)
        throw new Error("Detail barang kaosan Qty Order harus diisi.");
      if (sumKaosan !== qtyPesan)
        throw new Error(
          "Jumlah SPK vs Total Qty Order di Detail Barang Kaosan harus sama.",
        );
    }

    if (
      ["3", "4", "6"].includes(divisiStr) &&
      !["BR", "SB", "SD", "PL", "DP", "TG", "PM"].some((sub) =>
        header.spk_jo_kode.includes(sub),
      )
    ) {
      const sumSize = dtlSize
        ? dtlSize.reduce((acc, curr) => acc + Number(curr.qty || 0), 0)
        : 0;
      if (sumSize === 0)
        throw new Error(
          "Divisi Garmen/Kaosan: Qty Order di Detail Size harus diisi.",
        );
      if (sumSize !== qtyPesan)
        throw new Error(
          "Jumlah SPK vs Total Qty Order di Detail Size harus sama.",
        );
    }

    // ==========================================
    // 2. EKSEKUSI HEADER (TSPK & TBARANG)
    // ==========================================

    if (!isEdit) {
      nomor = await generateNomor(header.spk_perush_kode, header.spk_jo_kode);
      header.spk_nomor = nomor;
      header.user_create = user.kode;
      header.date_create = new Date();
      header.spk_aktif = "Y";
      await conn.query(`INSERT INTO tspk SET ?`, [header]);
    } else {
      header.user_modified = user.kode;
      header.date_modified = new Date();
      await conn.query(`UPDATE tspk SET ? WHERE spk_nomor = ?`, [
        header,
        nomor,
      ]);
      // Bersihkan data lama untuk multi-table insert
      await conn.query(`DELETE FROM talokasi WHERE spk_nomor = ?`, [nomor]);
      await conn.query(`DELETE FROM tspk_dc WHERE spkd_nomor = ?`, [nomor]);
      await conn.query(`DELETE FROM tspk_size WHERE spks_nomor = ?`, [nomor]);
    }

    // Sinkronisasi tbarang
    await conn.query(`DELETE FROM tbarang WHERE brg_kode = ?`, [nomor]);
    await conn.query(
      `
      INSERT INTO tbarang (brg_kode, brg_name, brg_ukuran, brg_kain, brg_finishing, brg_harga, brg_divisi, user_create, date_create) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())
    `,
      [
        nomor,
        header.spk_nama,
        header.spk_ukuran,
        header.spk_kain,
        header.spk_finishing,
        header.spk_harga,
        header.spk_divisi,
        user.kode,
      ],
    );

    // ==========================================
    // 3. EKSEKUSI DETAIL ALOKASI
    // ==========================================
    if (alokasi && alokasi.length > 0) {
      for (let i = 0; i < alokasi.length; i++) {
        const item = alokasi[i];
        if (item.alamat || item.kota) {
          await conn.query(
            `
            INSERT INTO talokasi (spk_nomor, urut, alamat, kota, person, hp, jumlah) 
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `,
            [
              nomor,
              i + 1,
              item.alamat,
              item.kota,
              item.person,
              item.hp,
              item.jumlah,
            ],
          );
        }
      }
    }

    // ==========================================
    // 4. EKSEKUSI DETAIL KAOSAN (tspk_dc)
    // ==========================================
    if (divisiStr === "3" && dtlKaosan && dtlKaosan.length > 0) {
      for (const item of dtlKaosan) {
        if (item.ukuran) {
          const kodeItem = ["BR", "SB", "SD", "PL", "DP", "TG", "PM"].some(
            (sub) => header.spk_jo_kode.includes(sub),
          )
            ? nomor
            : item.kode;
          await conn.query(
            `
            INSERT INTO tspk_dc (spkd_nomor, spkd_kode, spkd_ukuran, spkd_qtyorder) 
            VALUES (?, ?, ?, ?)
          `,
            [nomor, kodeItem, item.ukuran, item.qtyorder],
          );

          // Sinkronisasi ke tbarangdc_dtl (Ignore if exist)
          await conn.query(
            `
            INSERT IGNORE INTO retail.tbarangdc_dtl (brgd_kode, brgd_ukuran, brgd_hrg1) 
            VALUES (?, ?, 0)
          `,
            [nomor, item.ukuran],
          );
        }
      }

      // Sinkronisasi khusus retail.tbarangdc jika jasa bordir/sablon
      if (
        ["BR", "SB", "SD", "PL", "DP", "TG", "PM"].some((sub) =>
          header.spk_jo_kode.includes(sub),
        )
      ) {
        await conn.query(`DELETE FROM retail.tbarangdc WHERE brg_kode = ?`, [
          nomor,
        ]);
        await conn.query(
          `
          INSERT INTO retail.tbarangdc (brg_kode, brg_warna, brg_otomatis, brg_cab, user_create, date_create) 
          VALUES (?, ?, 1, ?, ?, NOW())
        `,
          [
            nomor,
            header.spk_nama.substring(0, 50),
            user.cabangKaos || "",
            user.kode,
          ],
        );
      }
    }

    // ==========================================
    // 5. EKSEKUSI DETAIL SIZE (tspk_size)
    // ==========================================
    if (
      ["3", "4", "6"].includes(divisiStr) &&
      !["BR", "SB", "SD", "PL", "DP", "TG", "PM"].some((sub) =>
        header.spk_jo_kode.includes(sub),
      )
    ) {
      if (dtlSize && dtlSize.length > 0) {
        for (const item of dtlSize) {
          if (Number(item.qty) > 0) {
            // Generate barcode khusus premium garmen
            let barcode = "";
            if (divisiStr === "4" && header.spk_tipe === "Premium") {
              // Pseudo barcode generator (ambil 2 digit terakhir no size dicombine no spk)
              barcode = `99${nomor}`; // Simplified for example, implement logic as needed
            }
            await conn.query(
              `
              INSERT INTO tspk_size (spks_nomor, spks_size, spks_qty, spks_a, spks_b, spks_barcode) 
              VALUES (?, ?, ?, ?, ?, ?)
            `,
              [nomor, item.size, item.qty, item.lb || 0, item.pb || 0, barcode],
            );
          }
        }
      }
    }

    // ==========================================
    // 6. UPDATE STATUS TRASAKSI TERKAIT
    // ==========================================
    if (header.spk_pen_nomor) {
      await conn.query(
        `UPDATE tpenawaran_dtl SET pend_status="CLOSE" WHERE pend_pen_nomor=? AND pend_id=?`,
        [header.spk_pen_nomor, header.spk_pen_id],
      );
    }
    if (header.spk_memo) {
      await conn.query(
        `UPDATE tmemospk SET mspk_close="Y" WHERE mspk_nomor=?`,
        [header.spk_memo],
      );
    }

    await conn.commit();
    return { nomor };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
};

// --- VALIDASI FIELD FORM (MIRIP EVENT EXIT DELPHI) ---
const validateField = async (type, value, extraParam = "") => {
  if (!value) return { valid: true };

  if (type === "memo") {
    const [memo] = await db.query(
      `SELECT mspk_nomor FROM tmemospk WHERE mspk_nomor=?`,
      [value],
    );
    if (memo.length === 0) throw new Error("Map/Memo tsb tidak ada.");
    const [spk] = await db.query(
      `SELECT spk_nomor FROM tspk WHERE spk_memo=?`,
      [value],
    );
    if (spk.length > 0 && spk[0].spk_nomor !== extraParam) {
      return {
        valid: false,
        warn: `MAP tsb sudah dipakai oleh ${spk[0].spk_nomor}. Yakin akan dilanjutkan?`,
      };
    }
    return { valid: true };
  }

  if (type === "mppb") {
    const [mppb] = await db.query(
      `SELECT mpb_approve, mpb_jmlorder FROM tmpb WHERE mpb_nomor=?`,
      [value],
    );
    if (mppb.length === 0) throw new Error("No.MPPB tsb tidak ada.");
    if (mppb[0].mpb_approve === "N")
      throw new Error("MPPB tsb belum di approve oleh PPIC.");
    return { valid: true, data: { jumlah: mppb[0].mpb_jmlorder } };
  }

  if (type === "invdc") {
    const [inv] = await db.query(
      `SELECT SUM(d.invd_jumlah) AS jml FROM retail.tinv_hdr h INNER JOIN retail.tinv_dtl d ON d.invd_inv_nomor=h.inv_nomor WHERE h.inv_nomor=?`,
      [value],
    );
    if (!inv[0].jml)
      throw new Error("No.Invoice tsb tidak ada atau jumlah kosong.");
    const [spk] = await db.query(
      `SELECT spk_nomor FROM tspk WHERE spk_invdc=?`,
      [value],
    );
    if (spk.length > 0 && spk[0].spk_nomor !== extraParam) {
      throw new Error(
        `No.Invoice dari DC tsb sudah dibuatkan SPK Nomor: ${spk[0].spk_nomor}`,
      );
    }
    return { valid: true, data: { jumlah: inv[0].jml } };
  }

  if (type === "spklama") {
    const [spk] = await db.query(
      `SELECT spk_nomor FROM tspk WHERE spk_aktif="Y" AND spk_nomor=?`,
      [value],
    );
    if (spk.length === 0)
      throw new Error("SPK Lama tsb tidak ada atau tidak aktif.");
    return { valid: true };
  }

  return { valid: true };
};

// --- HELPER: Normalisasi Key Object menjadi lowercase ---
const normalizeKeys = (obj) => {
  if (!obj) return obj;
  return Object.keys(obj).reduce((acc, key) => {
    acc[key.toLowerCase()] = obj[key];
    return acc;
  }, {});
};

// --- GET DETAIL MEMO (UNTUK AUTO-FILL SPK) ---
const getMemoDetail = async (nomor) => {
  const [header] = await db.query(
    `SELECT m.*, e.sal_nama, j.jo_nama, c.cus_nama, p.perush_nama, 
            p1.pab_nama AS workshop, p2.pab_nama AS workshop2 
     FROM tmemospk m 
     LEFT JOIN tsales e ON e.sal_kode = m.mspk_sal_kode 
     LEFT JOIN tjenisorder j ON j.jo_kode = m.mspk_jo_kode 
     LEFT JOIN tcustomer c ON c.cus_kode = m.mspk_cus_kode 
     LEFT JOIN tperusahaan p ON p.perush_kode = m.mspk_perush_kode
     LEFT JOIN tpabrik p1 ON p1.pab_kode = m.mspk_cab 
     LEFT JOIN tpabrik p2 ON p2.pab_kode = m.mspk_cab2 
     WHERE m.mspk_nomor = ?`,
    [nomor],
  );

  if (header.length === 0) throw new Error("Memo/MAP tidak ditemukan.");

  const [sizes] = await db.query(
    `SELECT mspks_size, mspks_qty, mspks_a, mspks_b 
     FROM tmemospk_size 
     WHERE mspks_nomor = ? AND mspks_qty > 0`,
    [nomor],
  );

  // Normalisasi keys untuk header dan semua baris sizes
  const normalizedHeader = normalizeKeys(header[0]);
  const normalizedSizes = sizes.map(normalizeKeys);

  return { header: normalizedHeader, sizes: normalizedSizes };
};

module.exports = { getDetail, saveData, validateField, getMemoDetail };
