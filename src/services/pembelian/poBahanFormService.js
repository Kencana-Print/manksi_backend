const db = require("../../config/database");
const tutupBukuService = require("../tutupBukuService");

// Jenis PO Spanduk (jenis 5, prefix PS): bahan dibatasi kode SB
const JENIS_SPANDUK = 5;
const adalahKodeSpanduk = (kode) =>
  String(kode || "")
    .trim()
    .toUpperCase()
    .startsWith("SB");

// --- HELPER: GENERATE NOMOR PO ---
const generateNomorPO = async (jenisPO, tanggal) => {
  const dateObj = new Date(tanggal);
  const tahun = dateObj.getFullYear().toString();

  let prefix = "PB"; // Default Bahan (jenis 0 & 3)
  if (jenisPO === 1)
    prefix = "PG"; // Greige
  else if (jenisPO === 2)
    prefix = "PC"; // Celup
  else if (jenisPO === 4)
    prefix = "PL"; // Lain-lain
  else if (jenisPO === JENIS_SPANDUK) prefix = "PS"; // Spanduk

  const [rows] = await db.query(
    `SELECT IFNULL(MAX(CAST(SUBSTR(po_nomor, 4, 5) AS UNSIGNED)), 0) AS max_val 
     FROM tpo_hdr 
     WHERE LEFT(po_nomor, 2) = ? AND RIGHT(po_nomor, 4) = ?`,
    [prefix, tahun],
  );

  const nextNum = parseInt(rows[0].max_val, 10) + 1;
  return `${prefix}/${String(nextNum).padStart(5, "0")}/${tahun}`;
};

// --- HELPER: GENERATE NOMOR BPB (Khusus PO Celup) ---
const generateNomorBPB = async (tanggal) => {
  const dateObj = new Date(tanggal);
  const tahun = dateObj.getFullYear().toString();
  const prefix = "PBG";

  const [rows] = await db.query(
    `SELECT IFNULL(MAX(CAST(SUBSTR(bpb_nomor, 5, 5) AS UNSIGNED)), 0) AS max_val 
     FROM tbpb_hdr 
     WHERE LEFT(bpb_nomor, 3) = ? AND RIGHT(bpb_nomor, 4) = ?`,
    [prefix, tahun],
  );

  const nextNum = parseInt(rows[0].max_val, 10) + 1;
  return `${prefix}/${String(nextNum).padStart(5, "0")}/${tahun}`;
};

// --- 1. VALIDASI FIELD (Migrasi OnExit Delphi) ---
const validateField = async (type, value, exclude = "") => {
  if (!value) return { valid: true };

  // A. Validasi MPPB (edtmppbExit) — MPPB kini ada di detail PO.
  // exclude = nomor PO yang sedang diedit, supaya MPPB miliknya sendiri tidak dianggap terpakai.
  if (type === "mppb") {
    const [mppb] = await db.query(
      `SELECT m.*, DATE_FORMAT(m.mpb_tanggal,"%Y-%m-%d") as tgl,
              IFNULL((SELECT d.pod_po_nomor FROM tpo_dtl d
                       WHERE d.pod_mppb_nomor = m.mpb_nomor AND d.pod_po_nomor <> ?
                       LIMIT 1), "") as po
         FROM tmpb m
        WHERE m.mpb_nomor = ?`,
      [exclude || "", value],
    );

    if (mppb.length === 0) throw new Error("No. MPPB tersebut tidak ada.");
    if (mppb[0].mpb_approve === "N")
      throw new Error("MPPB tersebut belum di-approve oleh PPIC.");
    if (mppb[0].po && mppb[0].po !== "")
      throw new Error(`MPPB sudah di-input di PO = ${mppb[0].po}`);

    return {
      valid: true,
      data: {
        tanggal: mppb[0].tgl,
        jumlah: mppb[0].mpb_jmlorder,
        spk: await cariSpkDariMppb(db, value),
      },
    };
  }

  // B. Validasi & Load PO Greige (edtpoGreigeExit)
  if (type === "greige") {
    const [hdr] = await db.query(
      `SELECT h.*, s.sup_nama, s.sup_alamat, s.sup_kota 
       FROM tpo_hdr h
       LEFT JOIN tsupplier s ON s.sup_kode = h.po_sup_kode
       WHERE h.po_jenis = 1 AND h.po_nomor = ?`,
      [value],
    );
    if (hdr.length === 0)
      throw new Error("Nomor PO Greige tersebut tidak ditemukan.");

    // Tarik item detail Greige dan kurangi dengan Qty yang sudah dicelup
    const [details] = await db.query(
      `
      SELECT 
        d.pod_bhn_kode as kode, b.bhn_name as nama, d.pod_namaext as namaext,
        d.pod_bhn_satuan as satuan, d.pod_gramasia as gramasia,
        IFNULL(g.bg_nama,"") as gramasi, IFNULL(s.bs_nama,"") as setting, IFNULL(j.bj_nama,"") as jenis,
        d.pod_hargabeli as harga, d.pod_disc as diskon,
        d.pod_spk_nomor as spk, d.pod_mkb_nomor as mkb,
        d.pod_mppb_nomor as mppb, mp.mpb_jmlorder as jmlmppb,
        DATE_FORMAT(mp.mpb_tanggal,"%Y-%m-%d") as tglmppb,
        (d.pod_jumlah - IFNULL((
           SELECT SUM(x.pod_jumlah) FROM tpo_dtl x INNER JOIN tpo_hdr y ON y.po_nomor = x.pod_po_nomor 
           WHERE y.po_greige = ? AND x.pod_bhn_kode = d.pod_bhn_kode
        ), 0)) as sisa_jumlah
      FROM tpo_dtl d
      LEFT JOIN tbahan b ON b.bhn_kode = d.pod_bhn_kode
      LEFT JOIN tbahan_jenis j ON j.bj_kode = LEFT(d.pod_bhn_kode, 2)
      LEFT JOIN tbahan_gramasi g ON g.bg_kode = MID(d.pod_bhn_kode, 6, 2)
      LEFT JOIN tbahan_setting s ON s.bs_kode = RIGHT(d.pod_bhn_kode, 2)
      LEFT JOIN tmpb mp ON mp.mpb_nomor = d.pod_mppb_nomor AND d.pod_mppb_nomor <> ''
      WHERE d.pod_po_nomor = ?
    `,
      [value, value],
    );

    // Filter hanya yang sisanya > 0
    const filteredDetails = details.filter((item) => item.sisa_jumlah > 0);

    return {
      valid: true,
      header: hdr[0],
      items: filteredDetails,
    };
  }

  return { valid: true };
};

// --- 2. GET DETAIL PO (Mode Edit) ---
const getDetail = async (nomor) => {
  // A. Get Header
  const [headers] = await db.query(
    `
    SELECT h.*, s.sup_nama, s.sup_alamat, s.sup_kota, s.sup_cp,
           DATE_FORMAT(p.mpb_tanggal,"%Y-%m-%d") as tgl_mppb, p.mpb_jmlorder as jmlmppb
    FROM tpo_hdr h
    LEFT JOIN tsupplier s ON h.po_sup_kode = s.sup_kode
    LEFT JOIN tmpb p ON p.mpb_nomor = h.po_mppb_nomor
    WHERE h.po_nomor = ?
  `,
    [nomor],
  );

  if (headers.length === 0) throw new Error("Data PO tidak ditemukan.");
  const header = headers[0];

  // B. Get PIN 5 Status (Tutup Buku Bypass)
  const [pins] = await db.query(
    `
    SELECT pin_urut, pin_acc, pin_dipakai FROM tspk_pin5 
    WHERE pin_trs="PO BAHAN" AND pin_nomor=? ORDER BY pin_urut DESC LIMIT 1
  `,
    [nomor],
  );

  let statusNgedit = "AMAN";
  let urutPin = 0;
  if (pins.length > 0) {
    const p = pins[0];
    urutPin = p.pin_urut;
    if (p.pin_acc === "" && p.pin_dipakai === "") statusNgedit = "WAIT";
    else if (p.pin_acc === "Y" && p.pin_dipakai === "") statusNgedit = "ACC";
    else if (p.pin_acc === "N") statusNgedit = "TOLAK";
  }

  // C. Cek Tutup Buku
  const zdtClose = await tutupBukuService.getTanggalTutupBuku();
  let isTutupBuku = false;
  if (
    zdtClose &&
    new Date(header.po_tanggal) < zdtClose &&
    statusNgedit !== "ACC"
  ) {
    isTutupBuku = true;
  }

  // D. Get Grid 1 (Items)
  const [items] = await db.query(
    `
      SELECT d.*, b.bhn_name, 
            IFNULL(sp.sup_nama, '') as pod_sup_nama,
            IFNULL(j.bj_nama,"") as jenis, 
            IFNULL(b.bhn_konstruksi, '') AS konstruksi, b.bhn_panjang AS panjang, b.bhn_lebar AS lebar,
            IF(IFNULL(d.pod_gramasia, '') <> '', d.pod_gramasia, IFNULL(g.bg_nama,"")) as gramasi,
            IF(IFNULL(d.pod_gramasia_awal, '') <> '', d.pod_gramasia_awal, IFNULL(g.bg_nama,"")) as gramasiAwal,
            IF(IFNULL(d.pod_setting, '') <> '', d.pod_setting, IFNULL(s.bs_nama,"")) as setting,
            DATE_FORMAT(mp.mpb_tanggal,"%Y-%m-%d") AS tgl_mppb, mp.mpb_jmlorder AS jmlmppb
      FROM tpo_dtl d
      INNER JOIN tpo_hdr h ON h.po_nomor = d.pod_po_nomor
      LEFT JOIN tbahan b ON b.bhn_kode = d.pod_bhn_kode
      LEFT JOIN tsupplier sp ON sp.sup_kode = d.pod_sup_kode
      LEFT JOIN tbahan_jenis j ON j.bj_kode = LEFT(d.pod_bhn_kode, 2)
      LEFT JOIN tbahan_gramasi g ON g.bg_kode = MID(d.pod_bhn_kode, 6, 2) AND LEFT(d.pod_bhn_kode, 2) <> 'SB'
      LEFT JOIN tbahan_setting s ON s.bs_kode = RIGHT(d.pod_bhn_kode, 2) AND LEFT(d.pod_bhn_kode, 2) <> 'SB'
      LEFT JOIN tmpb mp ON mp.mpb_nomor = d.pod_mppb_nomor AND d.pod_mppb_nomor <> ''
      WHERE d.pod_po_nomor = ? AND d.pod_bhn_kode <> '' ORDER BY d.pod_nourut
    `,
    [nomor],
  );

  // E. Get Grid 2 (Delivery Commitment - tpo_dtl2)
  const [delivery] = await db.query(
    `
    SELECT a.*, b.bhn_name, IFNULL(sp.sup_nama, '') AS pod2_sup_nama
    FROM tpo_dtl2 a
    LEFT JOIN tbahan b ON b.bhn_kode = a.pod2_bhn_kode
    LEFT JOIN tsupplier sp ON sp.sup_kode = a.pod2_sup_kode
    WHERE a.pod2_nomor = ? ORDER BY a.pod2_tanggal
  `,
    [nomor],
  );

  // F. Get Grid 3 (Rincian Roll - tpo_dtl3)
  const [rolls] = await db.query(
    `
    SELECT c.*, b.bhn_name, b.bhn_satuan 
    FROM tpo_dtl3 c LEFT JOIN tbahan b ON b.bhn_kode = c.pod3_bhn_kode
    LEFT JOIN tpo_dtl d ON d.pod_po_nomor = c.pod3_nomor AND d.pod_bhn_kode = c.pod3_bhn_kode
    WHERE c.pod3_nomor = ? ORDER BY d.pod_nourut, c.pod3_no
  `,
    [nomor],
  );

  // G. Get No BPB (Jika PO Celup) — hanya BPB otomatis; BPB dari QC Bahan
  // (punya lot di tbpb_qc_lot) memakai bpb_po_nomor yang sama tetapi bukan miliknya
  let noBPB = "";
  if (header.po_jenis === 2) {
    const [bpb] = await db.query(
      `SELECT h.bpb_nomor FROM tbpb_hdr h
       WHERE (h.bpb_keterangan = ? OR h.bpb_po_nomor = ?)
         AND NOT EXISTS (
           SELECT 1 FROM tbpb_qc_lot q WHERE q.bql_bpb_nomor = h.bpb_nomor
         )
       ORDER BY h.bpb_nomor LIMIT 1`,
      [nomor, nomor],
    );
    if (bpb.length > 0) noBPB = bpb[0].bpb_nomor;
  }

  // H. Sudah ada BPB? Tanggal PO boleh diubah selama belum ada BPB.
  // PO Celup dikecualikan: BPB-nya otomatis dan tanggalnya ikut PO.
  let sudahBpb = false;
  if (Number(header.po_jenis) !== 2) {
    const [cekBpb] = await db.query(
      `SELECT 1 FROM tbpb_hdr WHERE bpb_po_nomor = ? LIMIT 1`,
      [nomor],
    );
    sudahBpb = cekBpb.length > 0;
  }

  return {
    header,
    items,
    delivery,
    rolls,
    noBPB,
    statusNgedit,
    urutPin,
    isTutupBuku,
    sudahBpb,
  };
};

// Cek keberadaan nomor SPK / SO / MAP (memo SPK). Hasil: Set nomor (huruf besar).
const cekNomorSpk = async (conn, daftar) => {
  const [rows] = await conn.query(
    `SELECT spk_nomor AS nomor FROM tspk WHERE spk_nomor IN (?)
     UNION
     SELECT so_nomor FROM tsalesorder WHERE so_aktif = 'Y' AND so_nomor IN (?)
     UNION
     SELECT MSPK_Nomor FROM tmemospk WHERE MSPK_Nomor IN (?)`,
    [daftar, daftar, daftar],
  );
  return new Set(rows.map((r) => String(r.nomor).toUpperCase()));
};

// --- SPK OTOMATIS DARI MPPB ---
// Urutan: SO aktif terbaru yang memanggil MPPB; bila belum ada, MAP aktif
// terbaru dari baris penawaran yang sama dengan MPPB (nomor + id).
// Hasil '' bila keduanya belum ada.
const cariSpkDariMppb = async (runner, mppb) => {
  const nomor = String(mppb || "").trim();
  if (!nomor) return "";

  const [so] = await runner.query(
    `SELECT so_nomor FROM tsalesorder
      WHERE so_mppb = ? AND so_aktif = 'Y'
      ORDER BY so_tanggal DESC, so_nomor DESC
      LIMIT 1`,
    [nomor],
  );
  if (so.length > 0) return so[0].so_nomor;

  const [map] = await runner.query(
    `SELECT m.mspk_nomor
       FROM tmpb p
       JOIN tmemospk m ON m.mspk_pen_nomor = p.mpb_pen_nomor
                      AND m.mspk_pen_id = p.mpb_pen_id
      WHERE p.mpb_nomor = ?
        AND IFNULL(p.mpb_pen_nomor, '') <> ''
        AND m.mspk_aktif = 'Y'
      ORDER BY m.mspk_tanggal DESC, m.mspk_nomor DESC
      LIMIT 1`,
    [nomor],
  );
  return map.length > 0 ? map[0].mspk_nomor : "";
};

// Isi kolom SPK baris PO yang ber-MPPB ini dengan `spk` (nomor SO atau MAP).
// Dipanggil dari simpan SO dan simpan MAP, memakai conn transaksi pemanggil.
// Yang diisi: baris yang SPK-nya kosong, atau berisi MAP milik MPPB ini
// (MAP asal SO `mapNomor`, atau MAP dari baris penawaran MPPB itu).
// Dilewati: baris yang sudah ber-BPB, dan PO yang sudah melewati tutup buku.
const isiSpkPoDariMppb = async (conn, mppb, spk, mapNomor = "") => {
  const m = String(mppb || "").trim();
  const isi = String(spk || "").trim();
  if (!m || !isi) return 0;

  const zdtClose = await tutupBukuService.getTanggalTutupBuku();
  const params = [isi, m, String(mapNomor || "")];
  let syaratTutup = "";
  if (zdtClose) {
    syaratTutup = "AND h.po_tanggal >= ?";
    params.push(zdtClose);
  }

  const [res] = await conn.query(
    `UPDATE tpo_dtl d
       JOIN tpo_hdr h ON h.po_nomor = d.pod_po_nomor
        SET d.pod_spk_nomor = ?
      WHERE d.pod_mppb_nomor = ?
        AND d.pod_bhn_kode <> ''
        AND (
          d.pod_spk_nomor = ''
          OR d.pod_spk_nomor = ?
          OR d.pod_spk_nomor IN (
            SELECT mm.mspk_nomor
              FROM tmpb p
              JOIN tmemospk mm ON mm.mspk_pen_nomor = p.mpb_pen_nomor
                              AND mm.mspk_pen_id = p.mpb_pen_id
             WHERE p.mpb_nomor = d.pod_mppb_nomor
               AND IFNULL(p.mpb_pen_nomor, '') <> ''
          )
        )
        AND d.pod_spk_nomor <> ?
        ${syaratTutup}
        AND NOT EXISTS (
          SELECT 1
            FROM tbpb_hdr b
            JOIN tbpb_dtl bd ON bd.bpbd_bpb_Nomor = b.bpb_Nomor
           WHERE b.bpb_po_Nomor = d.pod_po_nomor
             AND bd.bpbd_bhn_kode = d.pod_bhn_kode
        )`,
    [...params.slice(0, 3), isi, ...params.slice(3)],
  );
  return res.affectedRows;
};

// --- 3. SAVE DATA (INSERT & UPDATE MASSIVE TRANSACTION) ---
const saveData = async (payload, userKode) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const { isEdit, header, items, delivery, rolls, statusNgedit, urutPin } =
      payload;

    let nomorPO = header.po_nomor;
    const jpo = Number(header.po_jenis); // 0: PO Bahan lama, 1: Greige, 2: Celup, 3: Bahan, 4: Lain-lain, 5: Spanduk
    if (![0, 1, 2, 3, 4, JENIS_SPANDUK].includes(jpo))
      throw new Error("Jenis PO tidak valid.");
    const isLainLain = jpo === 4;
    const isSpanduk = jpo === JENIS_SPANDUK;
    const bhnMap = new Map(); // master bahan hasil validasi (PO Spanduk)
    // PO Lain-lain: supplier ada di detail, header dibiarkan NULL
    const supHeader = isLainLain ? null : header.po_sup_kode;
    // PO Lain-lain: PPN ada di detail (beda supplier beda ketentuan), header selalu 0
    const statusPpnHeader = isLainLain ? 0 : header.po_status_ppn;
    const ppnHeader = isLainLain ? 0 : header.po_ppn;
    let jenisTersimpan = jpo; // bisa dipertahankan ke nilai lama saat edit (lihat bawah)
    let nomorBPB = header.no_bpb || "";

    // A. Validasi Tutup Buku Lanjutan
    const zdtClose = await tutupBukuService.getTanggalTutupBuku();
    if (
      zdtClose &&
      new Date(header.po_tanggal) < zdtClose &&
      statusNgedit !== "ACC"
    ) {
      throw new Error(
        "Anda tidak boleh input/edit di tanggal periode yang sudah diclose.",
      );
    }

    // A2. Validasi khusus PO Lain-lain: supplier di level detail
    if (isLainLain) {
      const itemsValid = (items || []).filter(
        (i) => i.kode && String(i.kode).trim() !== "",
      );
      if (itemsValid.length === 0)
        throw new Error("Minimal satu bahan harus diisi.");

      const kunciSet = new Set();
      for (const [idx, it] of itemsValid.entries()) {
        const sup = String(it.supKode || "").trim();
        const spk = String(it.spk || "").trim();
        if (!sup)
          throw new Error(
            `Baris ${idx + 1}: Supplier untuk bahan ${it.kode} wajib diisi.`,
          );
        if (!spk)
          throw new Error(
            `Baris ${idx + 1}: Nomor SPK/MAP untuk bahan ${it.kode} wajib diisi.`,
          );
        if ((Number(it.harga) || 0) <= 0)
          throw new Error(
            `Baris ${idx + 1}: Harga Beli untuk bahan ${it.kode} wajib diisi.`,
          );
        const ppn = Number(it.ppn) || 0;
        if (ppn < 0 || ppn > 100)
          throw new Error(
            `Baris ${idx + 1}: PPN untuk bahan ${it.kode} harus antara 0 dan 100.`,
          );
        const kunci = `${it.kode}|${sup}|${spk.toUpperCase()}`;
        if (kunciSet.has(kunci))
          throw new Error(
            `Baris ${idx + 1}: Bahan ${it.kode} dengan supplier ${sup} dan SPK/MAP ${spk} dobel.`,
          );
        kunciSet.add(kunci);
      }

      const supList = [...new Set(itemsValid.map((i) => i.supKode))];
      const [supRows] = await conn.query(
        `SELECT sup_kode FROM tsupplier WHERE sup_kode IN (?)`,
        [supList],
      );
      const ada = new Set(supRows.map((r) => r.sup_kode));
      const tidakAda = supList.filter((k) => !ada.has(k));
      if (tidakAda.length)
        throw new Error(`Supplier tidak ditemukan: ${tidakAda.join(", ")}`);

      // SPK/MAP harus ada
      const spkList = [
        ...new Set(itemsValid.map((i) => String(i.spk || "").trim())),
      ];
      const spkAda = await cekNomorSpk(conn, spkList);
      const spkTidakAda = spkList.filter((s) => !spkAda.has(s.toUpperCase()));
      if (spkTidakAda.length)
        throw new Error(
          `Nomor SPK/MAP tidak ditemukan: ${spkTidakAda.join(", ")}`,
        );

      // Delivery Commitment: supplier wajib dan harus pasangan (bahan, supplier) yang ada di baris PO
      const pasangan = new Set(
        itemsValid.map((i) => `${i.kode}|${String(i.supKode).trim()}`),
      );
      for (const [idx, d] of (delivery || []).entries()) {
        const sup = String(d.supKode || "").trim();
        if (!sup)
          throw new Error(`Delivery baris ${idx + 1}: Supplier wajib diisi.`);
        if (!pasangan.has(`${d.kode}|${sup}`))
          throw new Error(
            `Delivery baris ${idx + 1}: Bahan ${d.kode} tidak dipesan ke supplier ${sup} di PO ini.`,
          );
      }
    }

    // A3. PO Spanduk (jenis 5): bahan wajib SB, satuan dari master. Jenis 0-3 menolak SB.
    const itemsTerisi = (items || []).filter(
      (i) => i.kode && String(i.kode).trim() !== "",
    );

    if (
      !isSpanduk &&
      [0, 1, 2, 3].includes(jpo) &&
      itemsTerisi.some((i) => adalahKodeSpanduk(i.kode))
    ) {
      throw new Error(
        "Bahan spanduk (SB) hanya boleh dipesan lewat PO Spanduk.",
      );
    }

    if (isSpanduk) {
      if (!String(header.po_sup_kode || "").trim())
        throw new Error("Supplier wajib diisi.");
      const [supRow] = await conn.query(
        `SELECT sup_kode FROM tsupplier WHERE sup_kode = ?`,
        [header.po_sup_kode],
      );
      if (supRow.length === 0)
        throw new Error(`Supplier ${header.po_sup_kode} tidak ditemukan.`);
      if (itemsTerisi.length === 0)
        throw new Error("Minimal satu bahan harus diisi.");

      const kodeList = [
        ...new Set(itemsTerisi.map((i) => String(i.kode).trim().toUpperCase())),
      ];
      const [bhnRows] = await conn.query(
        `SELECT bhn_kode, bhn_name, bhn_satuan, bhn_aktif FROM tbahan WHERE bhn_kode IN (?)`,
        [kodeList],
      );
      bhnRows.forEach((r) => bhnMap.set(String(r.bhn_kode).toUpperCase(), r));

      const spkSet = new Set();
      for (const [idx, it] of itemsTerisi.entries()) {
        const baris = `Baris ${idx + 1}`;
        const kode = String(it.kode).trim().toUpperCase();
        const bhn = bhnMap.get(kode);

        if (!adalahKodeSpanduk(kode))
          throw new Error(`${baris}: Bahan ${it.kode} bukan bahan spanduk.`);
        if (!bhn)
          throw new Error(`${baris}: Bahan ${it.kode} tidak ditemukan.`);
        if (Number(bhn.bhn_aktif) !== 0)
          throw new Error(`${baris}: Bahan ${it.kode} tidak aktif.`);
        if (!String(bhn.bhn_satuan || "").trim())
          throw new Error(
            `${baris}: Bahan ${it.kode} belum punya satuan di master bahan.`,
          );
        if (!(Number(it.jumlah) > 0))
          throw new Error(`${baris}: Qty PO harus lebih dari 0.`);
        if (!(Number(it.harga) >= 0))
          throw new Error(`${baris}: Harga tidak valid.`);
        const disc = Number(it.diskon) || 0;
        if (disc < 0 || disc > 100)
          throw new Error(`${baris}: Disc harus antara 0 dan 100.`);
        if (String(it.keterangan || "").trim().length > 150)
          throw new Error(`${baris}: Keterangan maksimal 150 karakter.`);

        const spk = String(it.spk || "").trim();
        if (spk) spkSet.add(spk);
      }

      if (spkSet.size > 0) {
        const ada = await cekNomorSpk(conn, [...spkSet]);
        const tidakAda = [...spkSet].filter((s) => !ada.has(s.toUpperCase()));
        if (tidakAda.length)
          throw new Error(
            `Nomor SPK/MAP tidak ditemukan: ${tidakAda.join(", ")}`,
          );
      }
    }

    // A4. Permintaan Pembelian Bahan (MBB) ada di header: satu PO satu permintaan.
    // MPPB ada di detail. Jumlah PO boleh melebihi sisa permintaan, jadi tidak ada
    // cek sisa di sini.
    const mppbBaris = (it) => String(it.mppb || "").trim();

    // Tautan yang sudah ada di PO ini (edit) tidak divalidasi ulang agar PO lama
    // tetap bisa disimpan walau permintaan/MPPB-nya berubah status.
    let mbbLama = "";
    const lamaMppb = new Set();
    if (isEdit) {
      const [lamaHdr] = await conn.query(
        `SELECT po_mbb_nomor FROM tpo_hdr WHERE po_nomor = ?`,
        [nomorPO],
      );
      mbbLama = String(lamaHdr[0]?.po_mbb_nomor || "").trim();

      const [lama] = await conn.query(
        `SELECT pod_mppb_nomor FROM tpo_dtl WHERE pod_po_nomor = ?`,
        [nomorPO],
      );
      for (const r of lama) {
        if (r.pod_mppb_nomor)
          lamaMppb.add(String(r.pod_mppb_nomor).toUpperCase());
      }
    }

    // A4a. MBB di header. PO Celup mewarisi PO Greige, jadi tidak punya permintaan
    // sendiri. Saat edit, permintaan tidak boleh diganti (form juga mengunci).
    const mbbHeader = jpo === 2 ? "" : String(header.po_mbb_nomor || "").trim();
    if (isEdit && mbbHeader !== mbbLama)
      throw new Error(
        "Permintaan Pembelian Bahan tidak boleh diubah saat edit.",
      );

    if (mbbHeader) {
      const [mbb] = await conn.query(
        `SELECT mbb_status FROM tmintabelibahan_hdr WHERE mbb_nomor = ?`,
        [mbbHeader],
      );
      if (mbb.length === 0)
        throw new Error(`Permintaan ${mbbHeader} tidak ditemukan.`);
      if (mbb[0].mbb_status && mbbHeader !== mbbLama)
        throw new Error(`Permintaan ${mbbHeader} sudah ${mbb[0].mbb_status}.`);

      // Semua bahan di PO harus ada di dokumen permintaan tersebut
      const kodeList = [
        ...new Set(itemsTerisi.map((i) => String(i.kode).trim())),
      ];
      if (kodeList.length > 0) {
        const [adaBahan] = await conn.query(
          `SELECT mbbd_bhn_kode FROM tmintabelibahan_dtl
            WHERE mbbd_nomor = ? AND mbbd_bhn_kode IN (?)`,
          [mbbHeader, kodeList],
        );
        const adaSet = new Set(
          adaBahan.map((r) => String(r.mbbd_bhn_kode).toUpperCase()),
        );
        const luar = itemsTerisi.findIndex(
          (i) => !adaSet.has(String(i.kode).trim().toUpperCase()),
        );
        if (luar >= 0)
          throw new Error(
            `Baris ${luar + 1}: bahan ${itemsTerisi[luar].kode} tidak ada di permintaan ${mbbHeader}.`,
          );
      }
    }

    // A4b. MPPB: satu MPPB boleh di banyak baris dalam satu PO, tapi tidak boleh
    // sudah dipakai PO lain. PO Celup mewarisi MPPB PO Greige-nya, jadi dilewati.
    const refMppb = itemsTerisi
      .map((it, idx) => ({ idx, mppb: mppbBaris(it) }))
      .filter((r) => r.mppb);
    const mppbBaru = new Map(); // nomor (huruf besar) -> baris pertama pemakainya
    for (const r of refMppb) {
      const k = r.mppb.toUpperCase();
      if (!lamaMppb.has(k) && !mppbBaru.has(k)) mppbBaru.set(k, r);
    }
    if (jpo !== 2 && mppbBaru.size > 0) {
      const [cekMppb] = await conn.query(
        `SELECT m.mpb_nomor, m.mpb_approve,
                (SELECT d.pod_po_nomor FROM tpo_dtl d
                  WHERE d.pod_mppb_nomor = m.mpb_nomor AND d.pod_po_nomor <> ?
                  LIMIT 1) AS po
           FROM tmpb m WHERE m.mpb_nomor IN (?)`,
        [nomorPO || "", [...mppbBaru.values()].map((r) => r.mppb)],
      );
      const petaMppb = new Map(
        cekMppb.map((r) => [String(r.mpb_nomor).toUpperCase(), r]),
      );
      for (const [k, r] of mppbBaru) {
        const m = petaMppb.get(k);
        if (!m)
          throw new Error(`Baris ${r.idx + 1}: MPPB ${r.mppb} tidak ada.`);
        if (m.mpb_approve === "N") {
          throw new Error(
            `Baris ${r.idx + 1}: MPPB ${r.mppb} belum di-approve oleh PPIC.`,
          );
        }
        if (m.po) {
          throw new Error(
            `Baris ${r.idx + 1}: MPPB ${r.mppb} sudah di-input di PO ${m.po}.`,
          );
        }
      }
    }

    // Kompatibilitas sementara: header tetap diisi MPPB baris pertama yang punya
    // MPPB, untuk modul lain yang masih membaca tpo_hdr.po_mppb_nomor.
    const mppbHeader = refMppb.length > 0 ? refMppb[0].mppb : "";

    // B. Header Eksekusi
    if (!isEdit) {
      nomorPO = await generateNomorPO(jpo, header.po_tanggal);

      const insertHdr = `
        INSERT INTO tpo_hdr (
          po_nomor, po_greige, po_tanggal, po_jenis, po_keterangan, po_sup_kode, 
          po_mppb_nomor, po_mbb_nomor, po_status_ppn, po_ppn, date_create, user_create, po_note
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?)
      `;
      await conn.query(insertHdr, [
        nomorPO,
        header.po_greige || "",
        header.po_tanggal,
        jpo,
        header.po_keterangan,
        supHeader,
        mppbHeader,
        mbbHeader,
        statusPpnHeader,
        ppnHeader,
        userKode,
        header.po_note || "",
      ]);

      // KHUSUS CELUP: AUTO CREATE BPB (Penerimaan Barang)
      if (jpo === 2) {
        nomorBPB = await generateNomorBPB(header.po_tanggal);
        const insertBPB = `
          INSERT INTO tbpb_hdr (
            bpb_nomor, bpb_tanggal, bpb_keterangan, bpb_po_nomor, bpb_sup_kode, 
            bpb_gdg_kode, bpb_jatuhtempo, date_create, user_create
          ) VALUES (?, ?, ?, ?, ?, "GC001", ?, NOW(), ?)
        `;
        await conn.query(insertBPB, [
          nomorBPB,
          header.po_tanggal,
          nomorPO,
          header.po_greige,
          header.po_sup_kode,
          header.po_tanggal,
          userKode,
        ]);
      }
    } else {
      // === TAMBAHAN VALIDASI EDIT (MIGRASI DARI DELPHI) ===

      // 1. Cek Status PO (Tidak Boleh Edit Jika Close/OnProses)
      const [cekStatus] = await conn.query(
        `SELECT po_close, po_jenis, DATE_FORMAT(po_tanggal, '%Y-%m-%d') AS tgl_lama
           FROM tpo_hdr WHERE po_nomor=?`,
        [nomorPO],
      );
      if (cekStatus.length === 0) throw new Error("PO tidak ditemukan.");
      if (cekStatus[0].po_close === 1)
        throw new Error("Sudah CLOSE. Tidak bisa disimpan.");
      if (cekStatus[0].po_close === 2)
        throw new Error("Sudah ONPROSES. Tidak bisa disimpan.");

      // Tanggal PO boleh diubah selama tanggal LAMA belum tutup buku dan belum ada BPB.
      // (Tanggal baru sudah dicek di langkah A di atas.)
      if (
        zdtClose &&
        new Date(cekStatus[0].tgl_lama) < zdtClose &&
        statusNgedit !== "ACC"
      ) {
        throw new Error(
          "Anda tidak boleh input/edit di tanggal periode yang sudah diclose.",
        );
      }
      const tanggalBerubah =
        String(header.po_tanggal || "").slice(0, 10) !== cekStatus[0].tgl_lama;
      if (tanggalBerubah && Number(cekStatus[0].po_jenis) !== 2) {
        const [adaBpb] = await conn.query(
          `SELECT bpb_nomor FROM tbpb_hdr WHERE bpb_po_nomor = ? LIMIT 1`,
          [nomorPO],
        );
        if (adaBpb.length > 0) {
          throw new Error(
            `PO sudah ada BPB ${adaBpb[0].bpb_nomor}, tanggal PO tidak bisa diubah.`,
          );
        }
      }

      // Jenis 1/2/4 tidak boleh berpindah jenis (nomor, BPB & struktur detail
      // berbeda). 0 <-> 3 dibolehkan, tapi nilai yang tersimpan dipertahankan
      // supaya PO lama (0) tidak berubah jadi 3 diam-diam.
      const jenisDb = Number(cekStatus[0].po_jenis);
      if (
        jenisDb !== jpo &&
        [jenisDb, jpo].some((j) => [1, 2, 4, JENIS_SPANDUK].includes(j))
      )
        throw new Error("Jenis PO tidak boleh diubah saat edit.");
      if ([0, 3].includes(jenisDb) && [0, 3].includes(jpo))
        jenisTersimpan = jenisDb;

      // 2. Cek Sudah Link MKB (Migrasi ceksudahlink Delphi)
      const [cekMKB] = await conn.query(
        `SELECT COUNT(*) AS total FROM tmkb_dtl2 WHERE mkbd2_po_nomor = ?`,
        [nomorPO],
      );
      if (cekMKB[0].total > 0) {
        throw new Error("PO ini sudah link di MKB, tidak bisa di edit");
      }
      // 2b. QC Bahan menyimpan nomor urut baris PO (qc_pod_nourut), sedangkan
      // simpan PO menulis ulang tpo_dtl dengan nomor urut baru.
      const [cekQc] = await conn.query(
        `SELECT qc_nomor FROM tqc_bahan_hdr WHERE qc_po_nomor = ? LIMIT 1`,
        [nomorPO],
      );
      if (cekQc.length > 0) {
        throw new Error(
          `PO ini sudah punya QC Bahan ${cekQc[0].qc_nomor}, tidak bisa di edit.`,
        );
      }
      // PO yang sudah divoucher tidak boleh diedit
      // (POB: Bahan/Greige/Celup, POL: Lain-lain)
      const [cekVoucher] = await conn.query(
        jenisDb === JENIS_SPANDUK
          ? `SELECT voud_vou_nomor FROM tvoucher_dtl WHERE voud_nota = ? LIMIT 1`
          : `SELECT voud_vou_nomor FROM tvoucher_dtl
             WHERE voud_nota = ? AND voud_type IN ('POB', 'POL') LIMIT 1`,
        [nomorPO],
      );
      if (cekVoucher.length > 0) {
        throw new Error(
          `PO ini sudah dibayar di Voucher ${cekVoucher[0].voud_vou_nomor}, tidak bisa di edit.`,
        );
      }

      // PO Celup: edit menimpa detail BPB-nya. No. BPB dari klien harus milik PO
      // ini, dan BPB itu tidak boleh sudah divoucher.
      if (jenisDb === 2 && nomorBPB) {
        const [bpbSah] = await conn.query(
          `SELECT h.bpb_nomor FROM tbpb_hdr h
           WHERE h.bpb_nomor = ? AND (h.bpb_keterangan = ? OR h.bpb_po_nomor = ?)
             AND NOT EXISTS (
               SELECT 1 FROM tbpb_qc_lot q WHERE q.bql_bpb_nomor = h.bpb_nomor
             )`,
          [nomorBPB, nomorPO, nomorPO],
        );
        if (bpbSah.length === 0) {
          throw new Error(
            "No. BPB tidak sesuai dengan PO ini, atau BPB tersebut dibuat dari QC Bahan.",
          );
        }
        const [cekVoucherBpb] = await conn.query(
          `SELECT voud_vou_nomor FROM tvoucher_dtl WHERE voud_nota = ? LIMIT 1`,
          [nomorBPB],
        );
        if (cekVoucherBpb.length > 0) {
          throw new Error(
            `BPB PO Celup ini sudah dibayar di Voucher ${cekVoucherBpb[0].voud_vou_nomor}, tidak bisa di edit.`,
          );
        }
      }

      // ====================================================

      // UPDATE
      const updateHdr = `
        UPDATE tpo_hdr SET 
          po_tanggal=?, po_jenis=?, po_keterangan=?, po_sup_kode=?, po_mppb_nomor=?, 
          po_status_ppn=?, po_ppn=?, po_note=?, date_modified=NOW(), user_modified=?
        WHERE po_nomor=?
      `;
      await conn.query(updateHdr, [
        header.po_tanggal,
        jenisTersimpan,
        header.po_keterangan,
        supHeader,
        mppbHeader,
        statusPpnHeader,
        ppnHeader,
        header.po_note || "",
        userKode,
        nomorPO,
      ]);

      // UPDATE TANGGAL BPB JIKA CELUP
      if (jpo === 2 && nomorBPB) {
        await conn.query(
          `UPDATE tbpb_hdr SET bpb_tanggal=?, date_modified=NOW(), user_modified=? WHERE bpb_nomor=?`,
          [header.po_tanggal, userKode, nomorBPB],
        );
      }

      // Bersihkan Detail Lama
      await conn.query(`DELETE FROM tpo_dtl WHERE pod_po_nomor=?`, [nomorPO]);
      await conn.query(`DELETE FROM tpo_dtl2 WHERE pod2_nomor=?`, [nomorPO]);
      await conn.query(`DELETE FROM tpo_dtl3 WHERE pod3_nomor=?`, [nomorPO]);
      if (jpo === 2 && nomorBPB) {
        await conn.query(`DELETE FROM tbpb_dtl WHERE bpbd_bpb_nomor=?`, [
          nomorBPB,
        ]);
      }
    }

    // C. INSERT DETAIL 1 (Item PO) & AUTO BPB DETAIL
    const validItemsToInsert = (items || []).filter(
      (item) => item.kode && String(item.kode).trim() !== "",
    );
    if (validItemsToInsert.length > 0) {
      let nourut = 1;
      for (const item of validItemsToInsert) {
        if (isSpanduk) {
          const bhn = bhnMap.get(String(item.kode).trim().toUpperCase());
          await conn.query(
            `
              INSERT INTO tpo_dtl (
                pod_po_nomor, pod_nourut, pod_bhn_kode, pod_namaext, pod_bhn_satuan,
                pod_gramasia, pod_gramasia_awal, pod_setting, pod_roll, pod_jumlah,
                pod_disc, pod_hargabeli, pod_spk_nomor, pod_mkb_nomor, pod_sup_kode,
                pod_ppn, pod_keterangan, pod_mppb_nomor
              ) VALUES (?, ?, ?, ?, ?, '', '', '', 0, ?, ?, ?, ?, '', NULL, 0, ?, ?)
            `,
            [
              nomorPO,
              nourut,
              bhn.bhn_kode,
              String(item.namaext || "").trim() || bhn.bhn_name,
              bhn.bhn_satuan,
              Number(item.jumlah),
              Number(item.diskon) || 0,
              Number(item.harga) || 0,
              String(item.spk || "").trim(),
              String(item.keterangan || "").trim(),
              mppbBaris(item),
            ],
          );
          nourut++;
          continue;
        }

        const namaExt = item.namaext ? item.namaext : item.nama;

        // Gramasi Akhir — tetap seperti sebelumnya
        const gramasiaToSave = item.gramasi || "";
        const gramasiAwalToSave = item.gramasiAwal || "";

        await conn.query(
          `
            INSERT INTO tpo_dtl (
              pod_po_nomor, pod_nourut, pod_bhn_kode, pod_namaext, pod_bhn_satuan, 
              pod_gramasia, pod_gramasia_awal, pod_setting, pod_roll, pod_jumlah, pod_disc, pod_hargabeli, pod_spk_nomor, pod_mkb_nomor, pod_sup_kode, pod_ppn,
              pod_mppb_nomor
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
          [
            nomorPO,
            nourut,
            item.kode,
            namaExt,
            item.satuan,
            gramasiaToSave,
            gramasiAwalToSave,
            item.setting || "",
            item.roll || 0,
            item.jumlah || 0,
            item.diskon || 0,
            item.harga || 0,
            String(item.spk || "").trim(),
            item.mkb || "",
            isLainLain ? item.supKode : null,
            isLainLain ? Number(item.ppn) || 0 : 0,
            mppbBaris(item),
          ],
        );

        // Auto Insert ke tabel BPB DTL jika ini PO Celup
        if (jpo === 2 && nomorBPB) {
          await conn.query(
            `
            INSERT INTO tbpb_dtl (
              bpbd_bpb_nomor, bpbd_bhn_kode, bpbd_bhn_satuan, bpbd_gramasi, bpbd_jumlah, 
              bpbd_roll, bpbd_harga, bpbd_spk_nomor, bpbd_nourut
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
            [
              nomorBPB,
              item.kode,
              item.satuan,
              item.gramasi || "",
              item.jumlah || 0,
              item.roll || 0,
              item.harga || 0,
              item.spk || "",
              nourut,
            ],
          );
        }
        nourut++;
      }
    }

    // D. INSERT DETAIL 2 (Delivery Commitment - semua selain Greige & Celup)
    if ([0, 3, 4].includes(jpo) && delivery && delivery.length > 0) {
      for (const d of delivery) {
        await conn.query(
          `
          INSERT INTO tpo_dtl2 (pod2_nomor, pod2_tanggal, pod2_jumlah, pod2_bhn_kode, pod2_sup_kode)
          VALUES (?, ?, ?, ?, ?)
        `,
          [
            nomorPO,
            d.tanggal,
            d.jumlah || 0,
            d.kode,
            isLainLain ? String(d.supKode).trim() : null,
          ],
        );
      }
    }

    // E. INSERT DETAIL 3 (Roll - Hanya Celup)
    if (jpo === 2 && rolls && rolls.length > 0) {
      for (const r of rolls) {
        await conn.query(
          `
          INSERT INTO tpo_dtl3 (pod3_nomor, pod3_bhn_kode, pod3_jumlah, pod3_no)
          VALUES (?, ?, ?, ?)
        `,
          [nomorPO, r.kode, r.jumlah || 0, r.no],
        );
      }
    }

    // F. MATIKAN PIN 5 JIKA EDIT HASIL ACC
    if (statusNgedit === "ACC" && urutPin > 0) {
      await conn.query(
        `UPDATE tspk_pin5 SET pin_dipakai="Y" WHERE pin_trs="PO BAHAN" AND pin_nomor=? AND pin_urut=?`,
        [nomorPO, urutPin],
      );
    }

    await conn.commit();

    // G. SINKRONISASI STATUS PO GREIGE — setelah commit agar data baru terbaca
    if (jpo === 2 && header.po_greige) {
      try {
        const [greigePo] = await db.query(
          `SELECT IFNULL(SUM(pod_Jumlah), 0) AS po FROM tpo_dtl WHERE pod_po_nomor = ?`,
          [header.po_greige],
        );
        const npo = Number(greigePo[0]?.po) || 0;

        const [greigeSj] = await db.query(
          `SELECT IFNULL(SUM(d.pod_Jumlah), 0) AS sj 
       FROM tpo_dtl d 
       INNER JOIN tpo_hdr h ON h.po_nomor = d.pod_po_nomor
       WHERE h.po_greige = ?`,
          [header.po_greige],
        );
        const nsj = Number(greigeSj[0]?.sj) || 0;

        let newStatus = 2; // ONPROSES
        if (nsj >= npo)
          newStatus = 1; // CLOSE
        else if (nsj === 0) newStatus = 0; // OPEN

        await db.query(`UPDATE tpo_hdr SET po_close = ? WHERE po_nomor = ?`, [
          newStatus,
          header.po_greige,
        ]);
      } catch (syncErr) {
        console.error("Gagal sinkronisasi status PO Greige:", syncErr);
        // Tidak throw — data PO Celup sudah tersimpan
      }
    }

    return { nomor: nomorPO, nomorBPB };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
};

// --- 4. LOAD DETAIL MKB & CEK WARNING (Migrasi loadDetailMkb Delphi) ---
const getDetailMkbForPo = async (mkbNomor) => {
  let warnings = [];

  // Pengecekan 1: Apakah MKB sudah di-link di tabel tmkb_dtl2?
  const [cekMkb2] = await db.query(
    `SELECT mkbd2_po_nomor FROM tmkb_dtl2 WHERE mkbd2_mkb_nomor = ? LIMIT 1`,
    [mkbNomor],
  );
  if (cekMkb2.length > 0) {
    warnings.push(
      `MKB tsb sudah di link di MKB dengan No.PO: ${cekMkb2[0].mkbd2_po_nomor}\nYakin akan dilanjutkan?`,
    );
  }

  // Pengecekan 2: Apakah MKB sudah ada di PO lain?
  const [cekPo] = await db.query(
    `SELECT pod_po_nomor FROM tpo_dtl WHERE pod_mkb_nomor = ? LIMIT 1`,
    [mkbNomor],
  );
  if (cekPo.length > 0) {
    warnings.push(
      `MKB tsb sudah tambah No.PO: ${cekPo[0].pod_po_nomor}\nYakin akan dilanjutkan?`,
    );
  }

  // Tarik Data Bahan MKB
  const [items] = await db.query(
    `SELECT d.mkbd_bhn_kode as kode, b.bhn_name as nama, b.bhn_name as namaext,
            d.mkbd_bhn_satuan as satuan, IFNULL(j.bj_nama,"") as jenis, b.bhn_hargabeli as harga,
            IFNULL(g.bg_nama,"") as gramasi, IFNULL(s.bs_nama,"") as setting,
            SUM(d.mkbd_jumlah_po) as jumlah, h.mkb_spk_nomor as spk
     FROM tmkb_dtl d
     INNER JOIN tmkb_hdr h ON h.mkb_nomor = d.mkbd_mkb_nomor
     LEFT JOIN tbahan b ON b.bhn_kode = d.mkbd_bhn_kode
     LEFT JOIN tbahan_jenis j ON j.bj_kode = LEFT(d.mkbd_bhn_kode, 2)
     LEFT JOIN tbahan_gramasi g ON g.bg_kode = MID(d.mkbd_bhn_kode, 6, 2) AND LEFT(d.mkbd_bhn_kode, 2) <> 'SB'
     LEFT JOIN tbahan_setting s ON s.bs_kode = RIGHT(d.mkbd_bhn_kode, 2) AND LEFT(d.mkbd_bhn_kode, 2) <> 'SB'
     WHERE mkb_nomor = ?
     GROUP BY d.mkbd_bhn_kode`,
    [mkbNomor],
  );

  return { warnings, items };
};

const getSupplierByKode = async (kode) => {
  const [rows] = await db.query(
    `SELECT sup_kode AS Kode, sup_nama AS Nama, 
            sup_alamat AS Alamat, sup_kota AS Kota
     FROM tsupplier WHERE sup_kode = ? LIMIT 1`,
    [kode],
  );
  if (rows.length === 0) throw new Error("Supplier tidak ditemukan.");
  return rows[0];
};

// --- 5. LOOKUP: baris Permintaan Pembelian Bahan yang masih punya sisa ---
// exclude = nomor PO yang sedang diedit (pesanan miliknya tidak mengurangi sisa)
const getMbbOutstanding = async (jenis, exclude = "") => {
  const jpo = Number(jenis);
  if (![0, 1, 2, 3, 4, JENIS_SPANDUK].includes(jpo))
    throw new Error("Jenis PO tidak valid.");

  // Aturan yang sama dengan saveData: PO Spanduk hanya SB, jenis lain tanpa SB
  const filterJenis =
    jpo === JENIS_SPANDUK
      ? `AND LEFT(d.mbbd_bhn_kode, 2) = 'SB'`
      : `AND LEFT(d.mbbd_bhn_kode, 2) <> 'SB'`;

  const [rows] = await db.query(
    `SELECT
       d.mbbd_nomor AS nomor,
       DATE_FORMAT(h.mbb_tanggal, "%Y-%m-%d") AS tanggal,
       h.mbb_cab AS cab,
       h.mbb_ket AS ket,
       d.mbbd_bhn_kode AS kode,
       IFNULL(b.bhn_name, "") AS nama,
       d.mbbd_satuan AS satuan,
       IF(LEFT(d.mbbd_bhn_kode, 2) = "SB", "", IFNULL(s.bs_nama, "")) AS setting,
       IFNULL(j.bj_nama, "") AS jenis,
       IFNULL(g.bg_nama, "") AS gramasi,
       IFNULL(b.bhn_hargabeli, 0) AS harga,
       d.mbbd_jumlah AS jumlah,
       IFNULL(p.dipesan, 0) AS dipesan,
       ROUND(d.mbbd_jumlah - IFNULL(p.dipesan, 0), 2) AS sisa,
       d.mbbd_ket AS keterangan
     FROM tmintabelibahan_dtl d
     JOIN tmintabelibahan_hdr h ON h.mbb_nomor = d.mbbd_nomor
     LEFT JOIN tbahan b ON b.bhn_kode = d.mbbd_bhn_kode
     LEFT JOIN tbahan_jenis j ON j.bj_kode = LEFT(d.mbbd_bhn_kode, 2)
     LEFT JOIN tbahan_gramasi g ON g.bg_kode = MID(d.mbbd_bhn_kode, 6, 2)
                               AND LEFT(d.mbbd_bhn_kode, 2) <> 'SB'
     LEFT JOIN tbahan_setting s ON s.bs_kode = RIGHT(d.mbbd_bhn_kode, 2)
                               AND LEFT(d.mbbd_bhn_kode, 2) <> 'SB'
     LEFT JOIN (
       SELECT ph.po_mbb_nomor, pd.pod_bhn_kode, SUM(pd.pod_jumlah) AS dipesan
         FROM tpo_hdr ph
         JOIN tpo_dtl pd ON pd.pod_po_nomor = ph.po_nomor
        WHERE ph.po_mbb_nomor <> '' AND ph.po_nomor <> ?
        GROUP BY ph.po_mbb_nomor, pd.pod_bhn_kode
     ) p ON p.po_mbb_nomor = d.mbbd_nomor AND p.pod_bhn_kode = d.mbbd_bhn_kode
     WHERE h.mbb_status = ''
       ${filterJenis}
       AND ROUND(d.mbbd_jumlah - IFNULL(p.dipesan, 0), 2) > 0
     ORDER BY h.mbb_tanggal, d.mbbd_nomor, d.mbbd_nourut`,
    [exclude || ""],
  );
  return rows;
};

module.exports = {
  validateField,
  getDetail,
  saveData,
  getDetailMkbForPo,
  getSupplierByKode,
  getMbbOutstanding,
};
