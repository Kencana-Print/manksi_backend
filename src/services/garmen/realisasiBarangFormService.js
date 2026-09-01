const db = require("../../config/database");
const tutupBukuService = require("../tutupBukuService");

const getStokTable = (jenis) => {
  if (jenis === "ACCESORIES") return "tmasterstok_acc";
  if (jenis === "OBAT") return "tmasterstok_obat";
  if (jenis === "SPAREPART") return "tmasterstok_sparepart";
  return "tmasterstok_atk";
};

const generateNomor = async (jenis, tanggal, conn) => {
  const tahun = new Date(tanggal).getFullYear().toString();
  let prefix = "";
  if (jenis === "ACCESORIES") prefix = `REA${tahun}.`;
  else if (jenis === "OBAT") prefix = `REO${tahun}.`;
  else if (jenis === "SPAREPART") prefix = `RES${tahun}.`;
  else prefix = `REK${tahun}.`;

  const query = `SELECT IFNULL(MAX(CAST(RIGHT(re_nomor, 5) AS UNSIGNED)), 0) AS max_num FROM tgarmenrealisasi_hdr WHERE re_nomor LIKE ?`;
  const [rows] = await conn.query(query, [`${prefix}%`]);
  const nextNum = parseInt(rows[0].max_num, 10) + 1;
  return `${prefix}${String(nextNum).padStart(5, "0")}`;
};

const checkPinStatus = async (nomor, conn) => {
  const qPin = `SELECT pin_urut, pin_acc, pin_dipakai FROM tspk_pin5 WHERE pin_trs="REALISASI MINTA GARMEN" AND pin_nomor=? ORDER BY pin_urut DESC LIMIT 1`;
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
 * Tarik Data Permintaan
 * @param bypassCloseCheck Jika true (saat edit), abaikan filter min_close
 */
const getPermintaanDetail = async (
  nomorMinta,
  cabangStok, // <-- Parameter diubah agar bisa menerima cabang dari dokumen
  realisasiId_Abaikan = "",
  bypassCloseCheck = false,
) => {
  let qHdr = `
    SELECT h.min_jenis, h.min_nomor, h.min_tanggal, h.min_cab, h.user_create, 
           h.min_spk_nomor, h.min_ket,
           IF(LEFT(h.min_gp,1)="K", g.gdgp_nama, RIGHT(g.gdgp_nama, LENGTH(g.gdgp_nama)-6)) AS gudang_nama,
           IFNULL(s.spk_nama, m.mspk_nama) AS namaspk,
           IFNULL(s.spk_jumlah, m.mspk_jumlah) AS jumlahspk,
           k.mkb_nomor, k.mkb_tanggal
    FROM tgarmenminta_hdr h
    LEFT JOIN tgudangproduksi g ON g.gdgp_kode = h.min_gp
    LEFT JOIN tspk s ON s.spk_nomor = h.min_spk_nomor
    LEFT JOIN tmemospk m ON m.mspk_nomor = h.min_spk_nomor
    LEFT JOIN tmka_hdr k ON k.mkb_spk_nomor = h.min_spk_nomor
    WHERE h.min_nomor = ?
  `;

  // Filter Close hanya berlaku saat Buat Baru
  if (!bypassCloseCheck) {
    qHdr += ` AND h.min_close IN (0, 2)`;
  }

  const [hdrRows] = await db.query(qHdr, [nomorMinta]);
  if (hdrRows.length === 0)
    throw new Error(
      "Nomor permintaan tsb tidak ada atau sudah di-close penuh.",
    );

  const header = hdrRows[0];
  const jenis = header.min_jenis;
  const tblStok = getStokTable(jenis);

  // Penambahan mst_noreferensi <> ? agar tidak memotong stok dari dokumennya sendiri
  const qDtl = `
    SELECT 
      d.mind_brg_kode AS kode, b.brg_nama AS nama, b.brg_satuan AS satuan,
      d.mind_jumlah AS minta,
      IFNULL((SELECT SUM(mst_stok_in - mst_stok_out) FROM ${tblStok} 
              WHERE mst_aktif="Y" AND mst_cab=? AND mst_brg_kode=d.mind_brg_kode 
              AND mst_noreferensi <> ?), 0) AS stk,
      IFNULL((SELECT SUM(rd.red_jumlah) FROM tgarmenrealisasi_hdr rh 
              INNER JOIN tgarmenrealisasi_dtl rd ON rd.red_nomor = rh.re_nomor
              WHERE rh.re_minta=? AND rd.red_brg_kode=d.mind_brg_kode AND rh.re_nomor <> ?), 0) AS sudah
    FROM tgarmenminta_dtl d
    LEFT JOIN tgarmen_brg b ON b.brg_kode = d.mind_brg_kode
    WHERE d.mind_nomor = ?
    ORDER BY d.mind_urut
  `;

  const [dtlRows] = await db.query(qDtl, [
    cabangStok, // Param 1: Cabang untuk stok
    realisasiId_Abaikan, // Param 2: Abaikan dokumen ini di kalkulasi stok
    nomorMinta, // Param 3: re_minta
    realisasiId_Abaikan, // Param 4: Abaikan dokumen ini di kalkulasi Sudah Realisasi
    nomorMinta, // Param 5: mind_nomor
  ]);

  const details = dtlRows.map((row) => {
    const minta = parseFloat(row.minta) || 0;
    const sudah = parseFloat(row.sudah) || 0;
    return {
      kode: row.kode,
      nama: row.nama,
      satuan: row.satuan,
      stk: parseFloat(row.stk) || 0,
      minta: minta,
      sudah: sudah,
      kurang: Math.max(0, minta - sudah),
      jumlah: 0,
      ket: "",
    };
  });

  return { header, details };
};

const getDetailForm = async (nomor, userCabang) => {
  const qHdr = `
    SELECT h.*, 
           IFNULL(DATE_FORMAT(h.re_apv,"%Y-%m-%d %H:%i:%s"),"") AS apv,
           t.min_tanggal, ifnull(t.min_cab,'') AS min_cab , ifnull(t.user_create,'') AS peminta,
           IFNULL(s.spk_nama, m.mspk_nama) AS spknama,
           IFNULL(s.spk_jumlah, m.mspk_jumlah) AS spkjml,
           k.mkb_tanggal
    FROM tgarmenrealisasi_hdr h
    LEFT JOIN tgarmenminta_hdr t ON t.min_nomor = h.re_minta
    LEFT JOIN tspk s ON s.spk_nomor = h.re_spk_nomor
    LEFT JOIN tmemospk m ON m.mspk_nomor = h.re_spk_nomor
    LEFT JOIN tmka_hdr k ON k.mkb_nomor = h.re_mka
    WHERE h.re_nomor = ?
  `;
  const [hdrRows] = await db.query(qHdr, [nomor]);
  if (hdrRows.length === 0) throw new Error("Data realisasi tidak ditemukan.");
  const header = hdrRows[0];

  let reqData = { header: {}, details: [] };

  // JIKA ADA NO MINTA: Tarik detail dari permintaan
  if (header.re_minta && header.re_minta.trim() !== "") {
    reqData = await getPermintaanDetail(
      header.re_minta,
      header.re_cab,
      nomor,
      true,
    );
  }

  // Tarik detail barang dari tabel realisasi
  const qRed = `
    SELECT d.red_brg_kode, d.red_jumlah, d.red_keterangan,
           b.brg_nama, b.brg_satuan
    FROM tgarmenrealisasi_dtl d
    LEFT JOIN tgarmen_brg b ON b.brg_kode = d.red_brg_kode
    WHERE d.red_nomor = ?
    ORDER BY d.red_urut
  `;
  const [redRows] = await db.query(qRed, [nomor]);

  let details = [];

  if (header.re_minta && header.re_minta.trim() !== "") {
    // Jika dari Permintaan: Mapping detail permintaan dengan jumlah realisasi
    const redMap = {};
    redRows.forEach(
      (r) =>
        (redMap[r.red_brg_kode] = { jml: r.red_jumlah, ket: r.red_keterangan }),
    );

    details = reqData.details.map((d) => {
      if (redMap[d.kode]) {
        d.jumlah = parseFloat(redMap[d.kode].jml) || 0;
        d.ket = redMap[d.kode].ket || "";
      }
      return d;
    });
  } else {
    // JIKA TANPA NO MINTA (Langsung Sparepart): Map item langsung dari detail realisasi
    details = redRows.map((r) => ({
      kode: r.red_brg_kode,
      nama: r.brg_nama || "",
      satuan: r.brg_satuan || "",
      stk: 0,
      minta: 0,
      sudah: 0,
      kurang: 0,
      jumlah: parseFloat(r.red_jumlah) || 0,
      ket: r.red_keterangan || "",
    }));
  }

  const pinInfo = await checkPinStatus(nomor, db);
  header.pin_status = pinInfo.status;

  return { header, reqHeader: reqData.header || {}, details };
};

// Dipanggil setelah detail baru selesai di-insert, menggantikan
// blok penghitungan tpo/tjumlah/tsudah/minClose yang lama.
const recalcMinClose = async (conn, noMinta) => {
  const [rows] = await conn.query(
    `SELECT
       d.mind_brg_kode AS kode,
       d.mind_jumlah AS minta,
       IFNULL((
         SELECT SUM(LEAST(rd.red_jumlah, d.mind_jumlah - IFNULL(prev.sudah_lain, 0)))
         FROM tgarmenrealisasi_hdr rh
         INNER JOIN tgarmenrealisasi_dtl rd ON rd.red_nomor = rh.re_nomor
         WHERE rh.re_minta = d.mind_nomor AND rd.red_brg_kode = d.mind_brg_kode
       ), 0) AS realisasi_kotor
     FROM tgarmenminta_dtl d
     LEFT JOIN (SELECT 0 AS sudah_lain) prev ON 1=1
     WHERE d.mind_nomor = ?`,
    [noMinta],
  );

  // Pendekatan lebih sederhana & tepat: jumlahkan langsung SUM realisasi
  // per item, cap di level ITEM (bukan digabung lintas item), baru
  // dibandingkan ke minta ITEM tsb — supaya tidak ada over-counting.
  const [dtlRows] = await conn.query(
    `SELECT
       d.mind_brg_kode AS kode,
       d.mind_jumlah AS minta,
       IFNULL((
         SELECT SUM(rd.red_jumlah)
         FROM tgarmenrealisasi_hdr rh
         INNER JOIN tgarmenrealisasi_dtl rd ON rd.red_nomor = rh.re_nomor
         WHERE rh.re_minta = ? AND rd.red_brg_kode = d.mind_brg_kode
       ), 0) AS total_realisasi
     FROM tgarmenminta_dtl d
     WHERE d.mind_nomor = ?`,
    [noMinta, noMinta],
  );

  let tpo = 0;
  let tqCapped = 0;
  let adaYangTerisi = false;

  for (const r of dtlRows) {
    const minta = parseFloat(r.minta) || 0;
    const realisasi = parseFloat(r.total_realisasi) || 0;
    const cappedRealisasi = Math.min(realisasi, minta); // ← cap PER ITEM, gabungan sudah+baru
    tpo += minta;
    tqCapped += cappedRealisasi;
    if (cappedRealisasi > 0) adaYangTerisi = true;
  }

  let minClose = 0;
  if (tpo > 0 && tqCapped >= tpo) minClose = 1;
  else if (adaYangTerisi) minClose = 2;

  await conn.query(
    `UPDATE tgarmenminta_hdr SET min_close=? WHERE min_nomor=?`,
    [minClose, noMinta],
  );
};

const saveData = async (payload, user) => {
  const conn = await db.getConnection();
  await conn.beginTransaction();

  try {
    let nomor = payload.nomor;
    const isEdit = !!nomor;
    const { jenis, tanggal, noMinta, spk, mka, keterangan, cabMinta } = payload;
    const tglTrs = new Date(tanggal);
    const dateModified = new Date()
      .toISOString()
      .slice(0, 19)
      .replace("T", " ");
    const userCabang = user.cabang;
    let pinInfo = { status: "MINTA", urut: 0 };

    if (isEdit) {
      pinInfo = await checkPinStatus(nomor, conn);
      const [cek] = await conn.query(
        `SELECT re_apv FROM tgarmenrealisasi_hdr WHERE re_nomor=?`,
        [nomor],
      );
      if (cek.length > 0 && cek[0].re_apv !== null) {
        throw new Error("Realisasi tsb sudah di approve. Tidak bisa disimpan.");
      }
    }

    const zdtClose = await tutupBukuService.getTanggalTutupBuku();
    if (tglTrs <= zdtClose && pinInfo.status !== "ACC") {
      throw new Error(
        "Anda tidak boleh input di tanggal periode yg sudah diclose.",
      );
    }

    const totalQty = payload.details.reduce(
      (sum, d) => sum + (parseFloat(d.jumlah) || 0),
      0,
    );
    if (totalQty <= 0) throw new Error("Jumlah realisasi masih kosong semua!");

    if (isEdit) {
      await conn.query(
        `UPDATE tgarmenrealisasi_hdr SET 
         re_tanggal=?, re_minta=?, re_keterangan=?, re_spk_nomor=?, date_modified=?, user_modified=?
         WHERE re_nomor=?`,
        [
          tanggal,
          noMinta,
          keterangan || "",
          spk || "",
          dateModified,
          user.kode,
          nomor,
        ],
      );
    } else {
      nomor = await generateNomor(jenis, tanggal, conn);

      const autoApprove =
        jenis === "SPAREPART" && userCabang === cabMinta ? new Date() : null;

      await conn.query(
        `INSERT INTO tgarmenrealisasi_hdr 
         (re_jenis, re_nomor, re_tanggal, re_apv, re_minta, re_keterangan, re_spk_nomor, re_mka, re_cab, re_bagian, date_create, user_create)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          jenis,
          nomor,
          tanggal,
          autoApprove,
          noMinta,
          keterangan || "",
          spk || "",
          mka || "",
          userCabang,
          user.bagian,
          dateModified,
          user.kode,
        ],
      );
    }

    await conn.query(`DELETE FROM tgarmenrealisasi_dtl WHERE red_nomor=?`, [
      nomor,
    ]);

    // ── INSERT detail — TIDAK BERUBAH, tapi sekarang variabel
    // tpo/tjumlah/tsudah TIDAK dihitung lagi di sini ──
    const detailValues = [];
    let noUrut = 1;

    for (const d of payload.details) {
      const jml = parseFloat(d.jumlah) || 0;
      if (!d.kode || d.nama === "") continue;

      if (jml > 0) {
        detailValues.push([nomor, d.kode, jml, noUrut, d.ket || ""]);
        noUrut++;
      }
    }

    if (detailValues.length > 0) {
      await conn.query(
        `INSERT INTO tgarmenrealisasi_dtl (red_nomor, red_brg_kode, red_jumlah, red_urut, red_keterangan) VALUES ?`,
        [detailValues],
      );
    }

    // ══════════════════════════════════════════════════════
    // GANTI TOTAL blok lama:
    //   const tq = tjumlah + tsudah;
    //   let minClose = 0;
    //   if (tq >= tpo && tpo > 0) minClose = 1;
    //   else if (tq > 0 && tq < tpo) minClose = 2;
    //   await conn.query(`UPDATE tgarmenminta_hdr SET min_close=? WHERE min_nomor=?`, [minClose, noMinta]);
    //
    // DENGAN satu baris ini — dipanggil SETELAH detail baru
    // selesai di-insert (di atas), supaya realisasi dari SAVE
    // INI SENDIRI ikut terhitung saat query ulang ke DB:
    // ══════════════════════════════════════════════════════
    if (noMinta) {
      await recalcMinClose(conn, noMinta);
    }

    if (isEdit && pinInfo.status === "ACC") {
      await conn.query(
        `UPDATE tspk_pin5 SET pin_dipakai="Y" WHERE pin_trs="REALISASI MINTA GARMEN" AND pin_nomor=? AND pin_urut=?`,
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

const getPrintData = async (nomor) => {
  // Query persis seperti s:= ' select *,ifnull(date_format... di Delphi
  const qHdr = `
    SELECT 
      a.re_nomor, a.re_tanggal, a.re_jenis, a.re_cab, a.re_keterangan, a.re_spk_nomor,
      DATE_FORMAT(a.re_tanggal, "%d %b %Y") AS tgl_realisasi,
      h.min_nomor, 
      DATE_FORMAT(h.min_tanggal, "%d %b %Y") AS tgl_minta,
      h.user_create AS peminta,
      IF(LEFT(h.min_gp,1)="K", g.gdgp_nama, RIGHT(g.gdgp_nama, LENGTH(g.gdgp_nama)-6)) AS GdgProduksi,
      IFNULL(s.spk_nama, m.mspk_nama) AS NamaSpk
    FROM tgarmenrealisasi_hdr a
    LEFT JOIN tgarmenminta_hdr h ON h.min_nomor = a.re_minta
    LEFT JOIN tgudangproduksi g ON g.gdgp_kode = h.min_gp
    LEFT JOIN tspk s ON s.spk_nomor = a.re_spk_nomor
    LEFT JOIN tmemospk m ON m.mspk_nomor = a.re_spk_nomor
    WHERE a.re_nomor = ?
  `;
  const [hdr] = await db.query(qHdr, [nomor]);
  if (hdr.length === 0) throw new Error("Data realisasi tidak ditemukan.");

  const qDtl = `
    SELECT 
      b.red_brg_kode AS Kode, 
      IF(c.brg_note="", c.brg_nama, CONCAT(c.brg_nama," - ",c.brg_note)) AS Nama,
      c.brg_satuan AS Satuan, 
      b.red_jumlah AS Jumlah, 
      b.red_keterangan AS Keterangan
    FROM tgarmenrealisasi_dtl b
    LEFT JOIN tgarmen_brg c ON c.brg_kode = b.red_brg_kode
    WHERE b.red_nomor = ?
    ORDER BY b.red_urut
  `;
  const [dtl] = await db.query(qDtl, [nomor]);

  return { header: hdr[0], details: dtl };
};

module.exports = { getPermintaanDetail, getDetailForm, saveData, getPrintData };
