const db = require("../../config/database");
const tutupBukuService = require("../tutupBukuService"); // Sesuaikan path

// --- HELPER: CEK STATUS PIN 5 ---
const checkPinStatus = async (nomor, conn) => {
  const qPin = `SELECT pin_urut, pin_acc, pin_dipakai FROM tspk_pin5 WHERE pin_trs="MKB" AND pin_nomor=? ORDER BY pin_urut DESC LIMIT 1`;
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

// --- HELPER: GENERATE NOMOR MKB ---
const generateNomor = async (tanggal, conn) => {
  const tahun = new Date(tanggal).getFullYear().toString();
  const query = `
    SELECT IFNULL(MAX(CAST(SUBSTR(mkb_nomor, 5, 4) AS UNSIGNED)), 0) AS max_num 
    FROM tmkb_hdr 
    WHERE LEFT(mkb_nomor, 3) = 'MKB' AND RIGHT(mkb_nomor, 4) = ?
  `;
  const [rows] = await conn.query(query, [tahun]);
  const nextNum = parseInt(rows[0].max_num, 10) + 1;
  return `MKB/${String(nextNum).padStart(4, "0")}/${tahun}`;
};

// --- HELPER: REKALKULASI BPB (bagibpb) ---
const recalcBpbLink = async (conn, mkbNomor) => {
  const [dtl2] = await conn.query(
    `SELECT mkbd2_po_nomor, mkbd_bhn_kode FROM tmkb_dtl2 e LEFT JOIN tmkb_dtl d ON d.mkbd_mkb_nomor=e.mkbd2_mkb_nomor AND d.mkbd_nourut=e.mkbd2_nourut WHERE e.mkbd2_mkb_nomor=? AND TRIM(e.mkbd2_po_nomor) <> ''`,
    [mkbNomor],
  );

  for (const item of dtl2) {
    const poNomor = item.mkbd2_po_nomor;
    const kodeBahan = item.mkbd_bhn_kode;

    // Cari total Qty BPB
    const [bpbRows] = await conn.query(
      `SELECT IFNULL(SUM(d.bpbd_jumlah), 0) as qty FROM tbpb_dtl d INNER JOIN tbpb_hdr h ON h.bpb_nomor=d.bpbd_bpb_nomor WHERE h.bpb_po_nomor=? AND d.bpbd_bhn_kode=?`,
      [poNomor, kodeBahan],
    );
    let q = parseFloat(bpbRows[0].qty || 0);

    if (q !== 0) {
      const [links] = await conn.query(
        `SELECT * FROM tmkb_dtl2 WHERE mkbd2_po_nomor=? ORDER BY RIGHT(mkbd2_mkb_nomor, 4), MID(mkbd2_mkb_nomor, 5, 4), mkbd2_nourut`,
        [poNomor],
      );
      for (const link of links) {
        if (q > 0) {
          const qtyUpdate = q >= link.mkbd2_qty ? link.mkbd2_qty : q;
          q -= qtyUpdate;
          await conn.query(
            `UPDATE tmkb_dtl2 SET mkbd2_terima=? WHERE mkbd2_po_nomor=? AND mkbd2_mkb_nomor=? AND mkbd2_nourut=?`,
            [
              qtyUpdate,
              link.mkbd2_po_nomor,
              link.mkbd2_mkb_nomor,
              link.mkbd2_nourut,
            ],
          );
        }
      }
    }
  }
};

// --- GET DATA FORM (MODE EDIT) ---
const getDetailForm = async (nomor) => {
  // Tambahan JOIN ke tsalesorder (SO baru) — sebelumnya cuma tspk
  // (SPK PPIC + SO legacy) & tmemospk (MAP). Prioritas IFNULL:
  // tsalesorder -> tspk -> tmemospk.
  const qHdr = `
    SELECT a.*,
           IFNULL(so.so_nama, IFNULL(s.spk_nama, m.mspk_nama)) as namaspk,
           IFNULL(so.so_memo, s.spk_memo) as spk_memo,
           IFNULL(joso.jo_nama, IFNULL(ss.jo_nama, mm.jo_nama)) as jenisorder,
           IFNULL(so.so_jumlah, IFNULL(s.spk_jumlah, m.mspk_jumlah)) as jumlahspk
    FROM tmkb_hdr a
    LEFT JOIN tsalesorder so ON so.so_nomor = a.mkb_spk_nomor
    LEFT JOIN tspk s ON s.spk_nomor = a.mkb_spk_nomor
    LEFT JOIN tmemospk m ON m.mspk_nomor = a.mkb_spk_nomor
    LEFT JOIN tjenisorder joso ON so.so_jo_kode = joso.jo_kode
    LEFT JOIN tjenisorder ss ON s.spk_jo_kode = ss.jo_kode
    LEFT JOIN tjenisorder mm ON m.mspk_jo_kode = mm.jo_kode
    WHERE a.mkb_nomor = ?
  `;
  const [hdrRows] = await db.query(qHdr, [nomor]);
  if (hdrRows.length === 0) throw new Error("Data MKB tidak ditemukan.");
  const header = hdrRows[0];

  header.pin_status = (await checkPinStatus(nomor, db)).status;

  const [dtlBahan] = await db.query(
    `SELECT d.*, b.bhn_name, ifnull(g.bg_nama,"") as gramasi FROM tmkb_dtl d LEFT JOIN tbahan b ON d.mkbd_bhn_kode = b.bhn_kode LEFT JOIN tbahan_gramasi g ON g.bg_kode = MID(d.mkbd_bhn_kode,6,2) WHERE d.mkbd_mkb_nomor = ? ORDER BY d.mkbd_nourut`,
    [nomor],
  );
  const [dtlLink] = await db.query(
    `SELECT e.*, d.mkbd_bhn_kode, DATE_FORMAT(h.po_tanggal, '%d-%m-%Y') as tgl FROM tmkb_dtl2 e LEFT JOIN tmkb_dtl d ON d.mkbd_mkb_nomor=e.mkbd2_mkb_nomor AND d.mkbd_nourut=e.mkbd2_nourut LEFT JOIN tpo_hdr h ON h.po_nomor=e.mkbd2_po_nomor WHERE e.mkbd2_mkb_nomor = ? ORDER BY e.mkbd2_nourut`,
    [nomor],
  );
  const [dtlPlan] = await db.query(
    `SELECT * FROM tplanningspk WHERE plan_datang <> 0 AND plan_spk = ? ORDER BY plan_tanggal`,
    [header.mkb_spk_nomor || header.MKB_SPK_NOMOR],
  );
  const [dtlMap] = await db.query(
    `SELECT * FROM tkesesuaianmap_size WHERE ks_nomor = ? ORDER BY ks_urut`,
    [header.spk_memo || ""],
  );

  return { header, dtlBahan, dtlLink, dtlPlan, dtlMap };
};

// --- SIMPAN TRANSAKSI ---
const saveData = async (payload, user) => {
  const conn = await db.getConnection();
  await conn.beginTransaction();

  try {
    let nomor = payload.nomor;
    const isEdit = !!nomor;
    const {
      tanggal,
      keterangan,
      nomorSpk,
      spkLama,
      dtlBahan = [],
      dtlLink = [],
      dtlPlan = [],
    } = payload;

    const tglTrs = new Date(tanggal);
    const dateNow = new Date().toISOString().slice(0, 19).replace("T", " ");
    const isMap = String(nomorSpk).startsWith("MAP");

    let pinInfo = { status: "MINTA", urut: 0 };

    // 1. Validasi Tutup Buku
    if (isEdit) pinInfo = await checkPinStatus(nomor, conn);
    const zdtClose = await tutupBukuService.getTanggalTutupBuku();
    if (zdtClose && tglTrs <= zdtClose && pinInfo.status !== "ACC") {
      throw new Error(
        "Anda tidak boleh input di tanggal periode yg sudah diclose.",
      );
    }

    // 2. Insert / Update Header
    if (isEdit) {
      await conn.query(
        `UPDATE tmkb_hdr SET mkb_tanggal=?, mkb_note=?, mkb_spk_nomor=?, date_modified=?, user_modified=? WHERE mkb_nomor=?`,
        [tanggal, keterangan, nomorSpk, dateNow, user.kode, nomor],
      );
    } else {
      nomor = await generateNomor(tanggal, conn);
      await conn.query(
        `INSERT INTO tmkb_hdr (mkb_nomor, mkb_tanggal, mkb_note, mkb_spk_nomor, date_create, user_create) VALUES (?, ?, ?, ?, ?, ?)`,
        [nomor, tanggal, keterangan, nomorSpk, dateNow, user.kode],
      );
    }

    // 3. Hapus Detail Lama
    await conn.query(`DELETE FROM tmkb_dtl WHERE mkbd_mkb_nomor=?`, [nomor]);
    await conn.query(`DELETE FROM tmkb_dtl2 WHERE mkbd2_mkb_nomor=?`, [nomor]);
    if (spkLama)
      await conn.query(`DELETE FROM tspk_babaran WHERE spkb_nomor=?`, [
        spkLama,
      ]);

    // 4. Insert Rincian Bahan (tmkb_dtl) & SPK Babaran
    for (let i = 0; i < dtlBahan.length; i++) {
      const d = dtlBahan[i];
      // Deteksi baris kosong (Auto Trailing Row) agar tidak ikut tersimpan
      if (
        !d.komponen &&
        !d.kode &&
        !d.namaBahan &&
        parseFloat(d.jumlah || 0) === 0
      ) {
        continue; // Skip baris kosong
      }

      // Format allowance agar mengirim null jika kosong
      const allowanceVal =
        d.allowance !== "" && d.allowance !== null && d.allowance !== undefined
          ? parseFloat(d.allowance)
          : null;

      await conn.query(
        `INSERT INTO tmkb_dtl (
          mkbd_mkb_nomor, mkbd_komponen, mkbd_ketk, mkbd_warna, mkbd_jenis, 
          mkbd_bhn_kode, mkbd_bhn_satuan, mkbd_jumlah, mkbd_allowance, mkbd_jumlah_rs, 
          mkbd_jumlah_po, mkbd_nourut, mkbd_babaran, mkbd_tglbeli, mkbd_keterangan
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ROUND(?, 2), ?, ?, ROUND(?, 2), ?, ?, ?, ?)`,
        [
          nomor,
          d.komponen || "",
          d.ketk || "",
          d.warna || "",
          d.jenis || "",
          d.kode || "",
          d.satuan || "",
          parseFloat(d.jumlah || 0),
          allowanceVal, // <-- Kolom Allowance (Bisa NULL)
          parseFloat(d.ready || 0),
          parseFloat(d.po || 0),
          d.no || i + 1,
          parseFloat(d.babaran || 0),
          d.tglbeli || null,
          d.keterangan || "",
        ],
      );

      // Insert SPK Babaran (Kecuali MAP)
      if (
        d.komponen &&
        parseFloat(d.babaran || 0) !== 0 &&
        nomorSpk &&
        !isMap
      ) {
        await conn.query(
          `INSERT INTO tspk_babaran (spkb_nomor, spkb_komponen, spkb_warna, spkb_jenis, spkb_babaran, spkb_nourut) VALUES (?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE spkb_babaran=?`,
          [
            nomorSpk,
            `${d.komponen} ${d.ketk || ""}`.trim(),
            d.warna || "",
            d.jenis || "",
            parseFloat(d.babaran),
            i + 1,
            parseFloat(d.babaran),
          ],
        );
      }
    }

    // 5. Insert Link PO (tmkb_dtl2)
    for (const d of dtlLink) {
      if (d.nomor) {
        await conn.query(
          `INSERT INTO tmkb_dtl2 (mkbd2_mkb_nomor, mkbd2_nourut, mkbd2_po_nomor, mkbd2_qty, mkbd2_pourut) VALUES (?, ?, ?, ?, ?)`,
          [nomor, d.no, d.nomor, parseFloat(d.qtylink || 0), d.link || "0"],
        );
      }
    }

    // 6. Insert Planning SPK (tplanningspk)
    if (!isMap && nomorSpk) {
      await conn.query(
        `DELETE FROM tplanningspk WHERE (plan_cutting+plan_cetak+plan_sublim+plan_bordir+plan_jahit+plan_finishing+plan_kirim)=0 AND plan_spk=?`,
        [nomorSpk],
      );
      await conn.query(
        `UPDATE tplanningspk SET plan_datang=0 WHERE plan_spk=?`,
        [nomorSpk],
      );

      for (const d of dtlPlan) {
        if (d.tanggal) {
          await conn.query(
            `INSERT INTO tplanningspk (plan_spk, plan_tanggal, plan_datang, plan_ppic) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE plan_datang=?, plan_ppic=?`,
            [
              nomorSpk,
              d.tanggal,
              parseFloat(d.jumlah || 0),
              user.kode,
              parseFloat(d.jumlah || 0),
              user.kode,
            ],
          );
        }
      }
    }

    // 7. Update Status PIN (Jika Edit & ACC)
    if (isEdit && pinInfo.status === "ACC") {
      await conn.query(
        `UPDATE tspk_pin5 SET pin_dipakai="Y" WHERE pin_trs="MKB" AND pin_nomor=? AND pin_urut=?`,
        [nomor, pinInfo.urut],
      );
    }

    // 8. Rekalkulasi BPB Terhadap MKB (Eksekusi bagibpb)
    await recalcBpbLink(conn, nomor);

    await conn.commit();
    return { nomor };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
};

const checkSpkDetails = async (nomorSpk, mkbNomorSekarang) => {
  // 1. Cek apakah sudah ada di MKB lain
  const [existing] = await db.query(
    `SELECT mkb_nomor FROM tmkb_hdr WHERE mkb_spk_nomor = ? AND mkb_nomor <> ?`,
    [nomorSpk, mkbNomorSekarang || ""],
  );
  if (existing.length > 0) {
    throw new Error(`SPK tsb sudah dibuatkan MKB No: ${existing[0].mkb_nomor}`);
  }
  // 2. Ambil detail SPK & Planning-nya — sekarang mencakup 3 sumber:
  // tsalesorder (SO baru), tspk (SPK PPIC + SO legacy), tmemospk (MAP).
  // tbarang tetap dipakai untuk sumber tspk lama (brg_name = nama produk
  // yang tersimpan saat SO/SPK itu dibuat); untuk tsalesorder, nama
  // produk sudah langsung ada di kolom so_nama sendiri.
  const qSpk = `
    SELECT * FROM (
      SELECT so_nomor AS Nomor, so_nama AS Nama, jo_nama AS JenisOrder, so_jumlah AS Jumlah, so_memo AS Memo
      FROM tsalesorder
      LEFT JOIN tjenisorder ON so_jo_kode = jo_kode
      WHERE so_aktif = "Y"
      UNION ALL
      SELECT spk_nomor AS Nomor, brg_name AS Nama, jo_nama AS JenisOrder, spk_jumlah AS Jumlah, spk_memo AS Memo
      FROM tspk 
      INNER JOIN tbarang ON spk_nomor = brg_kode
      LEFT JOIN tjenisorder ON spk_jo_kode = jo_kode
      WHERE spk_aktif = "Y"
      UNION ALL
      SELECT mspk_nomor, mspk_nama, jo_nama, mspk_jumlah, mspk_nomor
      FROM tmemospk
      LEFT JOIN tjenisorder ON mspk_jo_kode = jo_kode
    ) final WHERE Nomor = ?
  `;
  const [spkRows] = await db.query(qSpk, [nomorSpk]);
  if (spkRows.length === 0) throw new Error("SPK tersebut belum ada.");
  const [planRows] = await db.query(
    `SELECT plan_tanggal, plan_datang FROM tplanningspk WHERE plan_datang <> 0 AND plan_spk = ? ORDER BY plan_tanggal`,
    [nomorSpk],
  );
  return { info: spkRows[0], planning: planRows };
};

const getLinkablePo = async (kodeBahan, mkbNomor) => {
  const query = `
    SELECT x.* FROM (
      SELECT 
        h.po_nomor AS NOPO, 
        DATE_FORMAT(h.po_tanggal, '%d-%m-%Y') AS TglPO, 
        d.pod_nourut AS NoUrut, 
        d.pod_bhn_kode AS Kode, 
        d.pod_jumlah AS JmlPO,
        IFNULL((
          SELECT SUM(i.mkbd2_qty) 
          FROM tmkb_dtl2 i 
          WHERE i.mkbd2_mkb_nomor <> ? 
          AND i.mkbd2_po_nomor = d.pod_po_nomor 
          AND i.mkbd2_pourut = d.pod_nourut
        ), 0) AS SudahLink,
        (SELECT COUNT(*) FROM tbpb_hdr WHERE bpb_po_nomor = h.po_nomor) AS BPB
      FROM tpo_hdr h
      INNER JOIN tpo_dtl d ON d.pod_po_nomor = h.po_nomor
      WHERE d.pod_mkb_nomor = "" 
      AND h.po_tanggal > "2022-01-01" 
      AND d.pod_bhn_kode = ?
    ) x
    ORDER BY x.NOPO DESC
  `;
  // mkbNomor dikirim agar tidak memfilter dirinya sendiri jika sedang edit
  const [rows] = await db.query(query, [mkbNomor || "", kodeBahan]);

  // Tambahkan kalkulasi sisa di level JS agar mudah dibaca di frontend
  return rows.map((r) => ({
    ...r,
    Sisa: parseFloat(r.JmlPO) - parseFloat(r.SudahLink),
  }));
};

// --- GET DATA UNTUK CETAK ---
const getPrintData = async (nomor) => {
  const query = `
    SELECT 
      h.mkb_nomor AS Nomor, 
      DATE_FORMAT(h.mkb_tanggal, '%d %M %Y') AS Tanggal, 
      h.mkb_note AS Keterangan, 
      h.mkb_spk_nomor AS NoSPK,
      IFNULL(so.so_nama, IFNULL(s.spk_nama, m.mspk_nama)) AS NamaSpk,
      IFNULL(so.so_jumlah, IFNULL(s.spk_jumlah, m.mspk_jumlah)) AS JumlahSpk,
      d.mkbd_bhn_kode AS KodeBahan, 
      b.bhn_name AS NamaBahan, 
      d.mkbd_bhn_satuan AS Satuan, 
      IFNULL(g.bg_nama, '') AS Gramasi,
      SUM(d.mkbd_jumlah) AS Jumlah,
      SUM(d.mkbd_jumlah_rs) AS Ready,
      SUM(d.mkbd_jumlah_po) AS JumlahPO,
      MAX(d.mkbd_keterangan) AS KeteranganBahan
    FROM tmkb_dtl d
    LEFT JOIN tbahan b ON b.bhn_kode = d.mkbd_bhn_kode
    LEFT JOIN tbahan_gramasi g ON g.bg_kode = MID(d.mkbd_bhn_kode, 6, 2)
    LEFT JOIN tmkb_hdr h ON h.mkb_nomor = d.mkbd_mkb_nomor
    LEFT JOIN tsalesorder so ON so.so_nomor = h.mkb_spk_nomor
    LEFT JOIN tspk s ON s.spk_nomor = h.mkb_spk_nomor
    LEFT JOIN tmemospk m ON m.mspk_nomor = h.mkb_spk_nomor
    WHERE d.mkbd_mkb_nomor = ?
    GROUP BY d.mkbd_bhn_kode, d.mkbd_bhn_satuan 
    ORDER BY b.bhn_name
  `;
  const [rows] = await db.query(query, [nomor]);
  if (rows.length === 0) throw new Error("Data cetak tidak ditemukan.");

  // Pisahkan Header dan Detail untuk mempermudah Vue
  const header = {
    Nomor: rows[0].Nomor,
    Tanggal: rows[0].Tanggal,
    Keterangan: rows[0].Keterangan,
    NoSPK: rows[0].NoSPK,
    NamaSpk: rows[0].NamaSpk,
    JumlahSpk: rows[0].JumlahSpk,
  };

  return { header, details: rows };
};

module.exports = {
  getDetailForm,
  saveData,
  checkSpkDetails,
  getLinkablePo,
  getPrintData,
};
