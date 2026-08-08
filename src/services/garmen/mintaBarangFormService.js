const db = require("../../config/database");
const tutupBukuService = require("../../services/tutupBukuService");

/**
 * Generate Nomor Permintaan sesuai logic Delphi
 */
const generateNomor = async (jenis, tanggal, conn) => {
  const tahun = new Date(tanggal).getFullYear().toString();
  let prefix = "";
  let searchPattern = "";

  if (jenis === "ACCESORIES") {
    prefix = `MIA${tahun}.`;
    searchPattern = `MIA${tahun}.%`;
  } else if (jenis === "OBAT") {
    prefix = `MIO${tahun}.`;
    searchPattern = `MIO${tahun}.%`;
  } else if (jenis === "SPAREPART") {
    prefix = `SPP-${tahun}-`;
    searchPattern = `SPP-${tahun}-%`;
  } else {
    // ATK/RTK
    prefix = `MIK${tahun}.`;
    searchPattern = `MIK${tahun}.%`;
  }

  const query = `
    SELECT IFNULL(MAX(CAST(RIGHT(min_nomor, 5) AS UNSIGNED)), 0) AS max_num 
    FROM tgarmenminta_hdr 
    WHERE min_nomor LIKE ?
  `;
  const [rows] = await conn.query(query, [searchPattern]);
  const nextNum = parseInt(rows[0].max_num, 10) + 1;

  return `${prefix}${String(nextNum).padStart(5, "0")}`;
};

/**
 * Pengecekan PIN5 (Pengajuan Edit)
 */
const checkPinStatus = async (nomor, conn) => {
  const qPin = `
    SELECT pin_urut, pin_acc, pin_dipakai 
    FROM tspk_pin5 
    WHERE pin_trs="PERMINTAAN GARMEN" AND pin_nomor=? 
    ORDER BY pin_urut DESC LIMIT 1
  `;
  const [rows] = await conn.query(qPin, [nomor]);
  if (rows.length === 0) return { status: "MINTA", urut: 0 };

  const pin = rows[0];
  if (pin.pin_acc === "" && pin.pin_dipakai === "")
    return { status: "WAIT", urut: pin.pin_urut };
  if (pin.pin_acc === "Y" && pin.pin_dipakai === "")
    return { status: "ACC", urut: pin.pin_urut };
  if (pin.pin_acc === "N") return { status: "TOLAK", urut: pin.pin_urut };

  return { status: "MINTA", urut: pin.pin_urut };
};

/**
 * Validasi SPK & Ambil Data MKA
 */
const validateSpkAndMka = async (spkNomor, userCabang, userId) => {
  // 1. Ambil info SPK (Ditambah kolom pending per-departemen)
  const qSpk = `
    SELECT a.Nomor, a.Tanggal, v.divisi AS Divisi, a.Nama, a.spk_jumlah AS Jumlah, 
           a.spk_pending AS Pending, a.spk_accpending AS AccPending, a.cmo AS CMO,
           a.spk_ppotong, a.spk_pcetak, a.spk_pbordir, a.spk_pjahit, a.spk_pfinishing
    FROM (
      SELECT spk_nomor AS Nomor, spk_nama AS Nama, spk_tanggal AS Tanggal, spk_jumlah, 
             spk_pending, spk_accpending, spk_cmo AS cmo, spk_divisi,
             spk_ppotong, spk_pcetak, spk_pbordir, spk_pjahit, spk_pfinishing FROM tspk
      UNION ALL
      SELECT mspk_nomor, mspk_nama, mspk_tanggal, mspk_jumlah, 
             "" AS spk_pending, "" AS spk_accpending, mspk_cmo AS cmo, mspk_divisi,
             "N", "N", "N", "N", "N" FROM tmemospk
    ) a
    LEFT JOIN tdivisi v ON v.kode = a.spk_divisi
    WHERE a.Nomor = ?
  `;
  const [spkRows] = await db.query(qSpk, [spkNomor]);
  if (spkRows.length === 0)
    throw new Error("SPK tidak ditemukan atau belum terdaftar.");

  const spkData = spkRows[0];

  // VALIDASI 1: PENDING PENUH
  if (spkData.Pending === "PENDING PENUH" && spkData.AccPending === "N") {
    throw new Error(
      "SPK tsb sedang di pending penuh. Hubungi marketing jika akan tetap melanjutkan transaksi.",
    );
  }

  // VALIDASI 2: BELUM DI APPROVE MARKETING (CMO KOSONG)
  if (!spkData.CMO || spkData.CMO.trim() === "") {
    throw new Error("SPK tsb belum di approve oleh Chief Marketing.");
  }

  // -------------------------------------------------------------
  // VALIDASI 3: CEK DOBEL KETERANGAN "BARU" SECARA LIVE
  // Pengecualian untuk P03 dan P05 (sesuai Delphi cbCab.Text<>'P03')
  let isBaruDobel = false;
  let referensiBaru = "";

  if (userCabang !== "P03" && userCabang !== "P05") {
    const qCekBaru = `
      SELECT min_nomor FROM tgarmenminta_hdr 
      WHERE min_cab=? AND user_create=? AND min_spk_nomor=? AND min_ket LIKE "%BARU%"
    `;
    const [cekBaru] = await db.query(qCekBaru, [userCabang, userId, spkNomor]);
    if (cekBaru.length > 0) {
      isBaruDobel = true;
      referensiBaru = cekBaru[0].min_nomor;
    }
  }
  // -------------------------------------------------------------

  let mkaData = null;
  let mkaDetails = [];

  const isMap = spkNomor.toUpperCase().startsWith("MAP");
  const isGarmen = spkData.Divisi && spkData.Divisi.toUpperCase() === "GARMEN";

  // Cek MKA (Gunakan tabel tmka_hdr)
  const qMkaHdr = `SELECT mkb_nomor, mkb_tanggal FROM tmka_hdr WHERE mkb_spk_nomor = ?`;
  const [mkaHdrRows] = await db.query(qMkaHdr, [spkNomor]);

  // Validasi Wajib MKA (Kecuali MAP)
  if (!isMap && isGarmen) {
    if (mkaHdrRows.length === 0) {
      throw new Error(
        "SPK tsb divisi Garmen, belum dibuatkan MKA. Hubungi Gudang ya.",
      );
    }
  }

  // Jika MKA ada, ambil rincian barangnya
  if (mkaHdrRows.length > 0) {
    mkaData = mkaHdrRows[0];
    const qMkaDtl = `
      SELECT i.mkbd_brg_kode AS kode, b.brg_nama AS nama, b.brg_satuan AS satuan,
             SUM(i.mkbd_pemakaian) AS pemakaian, SUM(i.mkbd_jumlah) AS butuh
      FROM tmka_hdr j
      INNER JOIN tmka_dtl i ON i.mkbd_nomor = j.MKB_NOMOR
      LEFT JOIN tgarmen_brg b ON b.brg_kode = i.mkbd_brg_kode
      WHERE j.MKB_SPK_NOMOR = ?
      GROUP BY i.mkbd_brg_kode
    `;
    const [dtlRows] = await db.query(qMkaDtl, [spkNomor]);

    mkaDetails = dtlRows.map((d) => ({
      kode: d.kode,
      nama: d.nama,
      satuan: d.satuan,
      butuh: d.butuh || 0,
      pemakaian: d.pemakaian || 0,
      pcs: 0,
      jumlah: 0,
      ket: "",
    }));
  }

  return {
    spk: spkData,
    mka: mkaData,
    details: mkaDetails,
    isBaruDobel,
    referensiBaru,
  };
};

const getDetailForm = async (nomor, userCabang) => {
  const qHdr = `
    SELECT 
      h.*, 
      IF(h.min_gp="", p.pab_nama, g.gdgp_nama) AS nama_gdg,
      IFNULL(s.spk_nama, m.Mspk_nama) AS namaspk,
      IFNULL(s.spk_jumlah, m.Mspk_jumlah) AS jumlahspk,
      IFNULL(v.divisi, w.divisi) AS nama_divisi,
      k.mkb_nomor, k.mkb_tanggal
    FROM tgarmenminta_hdr h
    LEFT JOIN tgudangproduksi g ON g.gdgp_kode = h.min_gp
    LEFT JOIN tpabrik p ON p.pab_kode = h.min_cab
    LEFT JOIN tspk s ON s.spk_nomor = h.min_spk_nomor
    LEFT JOIN tmemospk m ON m.mspk_nomor = h.min_spk_nomor
    LEFT JOIN tdivisi v ON v.kode = s.spk_divisi
    LEFT JOIN tdivisi w ON w.kode = m.mspk_divisi
    LEFT JOIN tmka_hdr k ON k.mkb_spk_nomor = h.min_spk_nomor
    WHERE h.min_nomor = ?
  `;
  const [hdrRows] = await db.query(qHdr, [nomor]);
  if (hdrRows.length === 0) throw new Error("Data transaksi tidak ditemukan.");

  const header = hdrRows[0];

  if (
    userCabang &&
    header.min_cab !== userCabang &&
    userCabang !== "ALL" &&
    !userCabang.startsWith("HO")
  ) {
    throw new Error("Bukan cabang Anda.");
  }

  const pinInfo = await checkPinStatus(nomor, db);
  header.pin_status = pinInfo.status;

  const qDtl = `
    SELECT 
      d.mind_brg_kode AS kode, b.brg_nama AS nama, b.brg_satuan AS satuan, 
      d.mind_jumlah AS jumlah, d.mind_pcs AS pcs, d.mind_pemakaian AS pemakaian, 
      d.mind_ket AS ket,
      IFNULL((
        SELECT SUM(i.mkbd_jumlah) 
        FROM tmka_hdr j 
        INNER JOIN tmka_dtl i ON i.mkbd_nomor=j.MKB_NOMOR 
        WHERE j.MKB_SPK_NOMOR=? AND i.mkbd_brg_kode=d.mind_brg_kode 
        GROUP BY i.mkbd_brg_kode
      ), 0) AS butuh
    FROM tgarmenminta_dtl d
    LEFT JOIN tgarmen_brg b ON b.brg_kode = d.mind_brg_kode
    WHERE d.mind_nomor = ?
    ORDER BY d.mind_urut
  `;
  const [details] = await db.query(qDtl, [header.min_spk_nomor || "", nomor]);

  return { header, details };
};

const saveData = async (payload, user) => {
  const conn = await db.getConnection();
  await conn.beginTransaction();

  try {
    let nomor = payload.nomor;
    const isEdit = !!nomor;
    const dateModified = new Date()
      .toISOString()
      .slice(0, 19)
      .replace("T", " ");
    const { jenis, tanggal, cabang, gudangPeminta, spk, keterangan } = payload;

    // Normalisasi Bagian User (Upper case)
    const bagianUser = user.bagian ? user.bagian.toUpperCase() : "";
    const userCabang = user.cabang ? user.cabang.toUpperCase() : "";

    let pinInfo = { status: "MINTA", urut: 0 };

    // --- 1. Validasi Cabang User ---
    if (
      userCabang &&
      userCabang !== "ALL" &&
      !userCabang.startsWith("HO") &&
      cabang !== userCabang
    ) {
      throw new Error(
        "Nomor permintaan tsb bukan cabang anda. Tidak bisa disimpan.",
      );
    }

    // --- 2. Validasi Khusus Sparepart ---
    if (jenis === "SPAREPART") {
      if (bagianUser !== "TEKNISI" && bagianUser !== "IT") {
        throw new Error(
          "Hanya bagian Teknisi/IT yg diizinkan untuk menyimpan.",
        );
      }
    }

    // --- 3. Cek Status Edit & Tutup Buku (PIN 5) ---
    if (isEdit) {
      pinInfo = await checkPinStatus(nomor, conn);

      const [cekRows] = await conn.query(
        `SELECT min_close FROM tgarmenminta_hdr WHERE min_nomor = ?`,
        [nomor],
      );
      if (cekRows.length > 0) {
        const minClose = cekRows[0].min_close;
        // Jika status bukan OPEN (0)
        if (minClose !== 0) {
          if (
            pinInfo.status === "MINTA" ||
            pinInfo.status === "WAIT" ||
            pinInfo.status === "TOLAK"
          ) {
            throw new Error(
              "Transaksi tsb sudah diclose. Silahkan minta approve untuk bisa menyimpan perubahan data.",
            );
          }
        }
      }
    }

    const tglTrs = new Date(tanggal);
    const zdtClose = await tutupBukuService.getTanggalTutupBuku();
    if (tglTrs <= zdtClose && pinInfo.status !== "ACC") {
      throw new Error(
        "Anda tidak boleh input di tanggal periode yg sudah diclose.",
      );
    }

    // --- 4. Validasi Keterangan "BARU" (Bypass P03 & P05) ---
    if (
      !isEdit &&
      jenis === "ACCESORIES" &&
      cabang !== "P03" &&
      cabang !== "P05" &&
      keterangan.toUpperCase().includes("BARU")
    ) {
      const qCekBaru = `
        SELECT min_nomor FROM tgarmenminta_hdr 
        WHERE min_cab=? AND user_create=? AND min_spk_nomor=? AND min_ket LIKE "%BARU%"
      `;
      const [cekBaru] = await conn.query(qCekBaru, [cabang, user.kode, spk]);
      if (cekBaru.length > 0) {
        throw new Error(
          `SPK tsb sudah dibuatkan permintaan baru dengan nomor: ${cekBaru[0].min_nomor}. Alihkan keterangan ke TAMBAHAN atau lainnya.`,
        );
      }
    }

    // --- 5. Simpan Header ---
    const finalGudang = jenis === "ACCESORIES" ? gudangPeminta || "" : "";
    const finalSPK = jenis === "ACCESORIES" ? spk || "" : "";

    if (isEdit) {
      await conn.query(
        `UPDATE tgarmenminta_hdr SET 
          min_tanggal=?, min_cab=?, min_gp=?, min_spk_nomor=?, min_ket=?, date_modified=NOW(), user_modified=? 
         WHERE min_nomor=?`,
        [
          tanggal,
          cabang,
          finalGudang,
          finalSPK,
          keterangan || "",
          user.kode,
          nomor,
        ],
      );
    } else {
      nomor = await generateNomor(jenis, tanggal, conn);
      await conn.query(
        `INSERT INTO tgarmenminta_hdr 
          (min_jenis, min_nomor, min_tanggal, min_cab, min_gp, min_spk_nomor, min_bagian, min_ket, date_create, user_create, min_close)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, 0)`,
        [
          jenis,
          nomor,
          tanggal,
          cabang,
          finalGudang,
          finalSPK,
          bagianUser,
          keterangan || "",
          user.kode,
        ],
      );
    }

    // --- 6. Simpan Detail Barang ---
    await conn.query(`DELETE FROM tgarmenminta_dtl WHERE mind_nomor=?`, [
      nomor,
    ]);

    if (payload.details && payload.details.length > 0) {
      const detailValues = [];
      let noUrut = 1;

      for (const d of payload.details) {
        if (!d.kode || d.kode.trim() === "") continue; // Skip jika kosong

        const jml = parseFloat(d.jumlah) || 0;
        if (jml === 0) {
          throw new Error(`Barang ${d.nama} jumlahnya tidak boleh 0!`); // Sesuai pesan di Delphi
        }

        detailValues.push([
          nomor,
          d.kode,
          jml.toFixed(2), // Rounding 2 desimal seperti di Delphi
          parseFloat(d.pcs) || 0,
          parseFloat(d.pemakaian) || 0,
          d.ket || "",
          noUrut,
        ]);
        noUrut++;
      }

      if (detailValues.length > 0) {
        await conn.query(
          `INSERT INTO tgarmenminta_dtl (mind_nomor, mind_brg_kode, mind_jumlah, mind_pcs, mind_pemakaian, mind_ket, mind_urut) VALUES ?`,
          [detailValues],
        );
      } else {
        throw new Error("Detail barang harus diisi.");
      }
    } else {
      throw new Error("Detail barang harus diisi.");
    }

    // --- 7. Update PIN 5 ---
    if (isEdit && pinInfo.status === "ACC") {
      await conn.query(
        `UPDATE tspk_pin5 SET pin_dipakai="Y" WHERE pin_trs="PERMINTAAN GARMEN" AND pin_nomor=? AND pin_urut=?`,
        [nomor, pinInfo.urut],
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

const getGudangByKode = async (kode, cabang) => {
  // Replikasi logika filter dari searchGudangProduksi di lookupService
  let whereClause = "";
  let params = [];

  if (cabang === "P03") {
    whereClause = `WHERE gdgp_kode = "K0001" AND gdgp_kode = ?`;
    params = [kode];
  } else if (cabang === "P05") {
    whereClause = `WHERE gdgp_kode = "MMT01" AND gdgp_kode = ?`;
    params = [kode];
  } else {
    whereClause = `WHERE gdgp_aktif = 0 AND gdgp_jasa <> "" AND gdgp_nama NOT LIKE "%QC%" AND gdgp_kode = ?`;
    params = [kode];

    // Tambah filter cabang jika bukan HO
    if (cabang && cabang !== "ALL" && !cabang.startsWith("HO")) {
      whereClause += ` AND gdgp_cab = ?`;
      params.push(cabang);
    }
  }

  const [rows] = await db.query(
    `SELECT gdgp_kode AS Kode, gdgp_nama AS Nama
     FROM tgudangproduksi
     ${whereClause}
     LIMIT 1`,
    params,
  );

  if (rows.length === 0) throw new Error("Kode gudang tidak ditemukan.");
  return rows[0];
};

const getBarangByKode = async (kode, jenis, cabang, bagian) => {
  let whereClause = `WHERE b.brg_aktif = "Y" AND b.brg_jenis = ? AND b.brg_kode = ?`;
  let params = [jenis, kode];

  // Replikasi filter sparepart dari searchBarangGarmen
  if (jenis === "SPAREPART") {
    if (bagian === "TEKNISI") {
      whereClause += ` AND b.brg_ktg <> "IT"`;
    } else if (bagian === "IT") {
      whereClause += ` AND b.brg_ktg = "IT"`;
    }
  }

  // Tentukan tabel stok sesuai jenis
  let stockTable = "tmasterstok_atk";
  if (jenis === "ACCESORIES") stockTable = "tmasterstok_acc";
  else if (jenis === "OBAT") stockTable = "tmasterstok_obat";
  else if (jenis === "SPAREPART") stockTable = "tmasterstok_sparepart";

  const [rows] = await db.query(
    `SELECT 
       b.brg_kode AS Kode,
       IF(b.brg_note="", b.brg_nama, CONCAT(b.brg_nama, " - ", b.brg_note)) AS Nama,
       b.brg_satuan AS Satuan,
       IFNULL((
         SELECT SUM(m.mst_stok_in - m.mst_stok_out)
         FROM ${stockTable} m
         WHERE m.mst_aktif = "Y" AND m.mst_cab = ? AND m.mst_brg_kode = b.brg_kode
       ), 0) AS Stok
     FROM tgarmen_brg b
     ${whereClause}
     LIMIT 1`,
    [cabang, ...params],
  );

  if (rows.length === 0) throw new Error("Kode barang tidak ditemukan.");
  return rows[0];
};

module.exports = {
  validateSpkAndMka,
  getDetailForm,
  saveData,
  getGudangByKode,
  getBarangByKode,
};
