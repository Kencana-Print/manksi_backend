const db = require("../../config/database");
const tutupBukuService = require("../tutupBukuService");

// ─────────────────────────────────────────────────────────
// GENERATE NOMOR
// Format: BJG/NNNNN/YYYY — global (no cab filter)
// Sesuai Delphi getmaxnomor
// ─────────────────────────────────────────────────────────
const generateNomor = async (tanggal, conn) => {
  const tahun = new Date(tanggal).getFullYear();
  const [[row]] = await conn.query(
    `SELECT IFNULL(MAX(CAST(MID(bpj_nomor, 5, 5) AS UNSIGNED)), 0) AS max_val
     FROM tbpj_hdr
     WHERE RIGHT(bpj_nomor, 4) = ?
     FOR UPDATE`,
    [String(tahun)],
  );
  const next = parseInt(row.max_val, 10) + 1;
  return `BJG/${String(next).padStart(5, "0")}/${tahun}`;
};

// ─────────────────────────────────────────────────────────
// GET DATA PO JASA (untuk auto-fill form setelah pilih PO)
// Sesuai Delphi loaddatapo — query tpojasa_hdr + detail
// filter pojd_statuspotong <> 1
// ─────────────────────────────────────────────────────────
const getDataPO = async (poNomor) => {
  const [[hdr]] = await db.query(
    `SELECT
       h.pojh_nomor, h.pojh_cab,
       DATE_FORMAT(h.pojh_tanggal, '%Y-%m-%d') AS pojh_tanggal,
       h.pojh_keterangan, h.pojh_gdgp_kode,
       h.pojh_sup_kode, h.pojh_jasa_kode,
       h.pojh_spk_nomor, h.pojh_jumlah, h.pojh_tarif,
       h.pojh_status_ppn,
       j.jasa_nama,
       s.sup_nama, s.sup_alamat, s.sup_kota, s.sup_top,
       IFNULL(sk.spk_nama,  ms.mspk_nama)   AS spk_nama,
       IFNULL(sk.spk_jumlah, ms.mspk_jumlah) AS spk_jumlah,
       DATE_FORMAT(IFNULL(sk.spk_tanggal, ms.mspk_tanggal), '%Y-%m-%d') AS tgl_spk,
       IFNULL(sk.spk_sablon,  '-') AS xsablon,
       IFNULL(sk.spk_bordir,  '-') AS xbordir,
       o.jo_nama,
       g.gdgp_nama,
       sk.spk_ukuran,
       IFNULL((SELECT SUM(hh.bpj_jumlah)
               FROM tbpj_hdr hh
               WHERE hh.bpj_po_nomor = h.pojh_nomor), 0) AS sudah_terima
     FROM tpojasa_hdr h
     INNER JOIN tjasa      j  ON j.jasa_kode   = h.pojh_jasa_kode
     INNER JOIN tsupplier  s  ON s.sup_kode    = h.pojh_sup_kode
     LEFT  JOIN tspk       sk ON sk.spk_nomor  = h.pojh_spk_nomor
     LEFT  JOIN tmemospk   ms ON ms.mspk_nomor = h.pojh_spk_nomor
     LEFT  JOIN tjenisorder o ON o.jo_kode     = sk.spk_jo_kode
     LEFT  JOIN tgudangproduksi g ON g.gdgp_kode = h.pojh_gdgp_kode
     WHERE h.pojh_nomor = ?`,
    [poNomor],
  );
  if (!hdr) throw new Error("Nomor PO tidak ditemukan.");

  // Detail bahan (filter statuspotong <> 1, sesuai Delphi)
  const [dtl] = await db.query(
    `SELECT
       d.pojd_bhn_kode AS kode,
       b.bhn_name      AS nama,
       d.pojd_bhn_satuan AS satuan,
       d.pojd_jumlah   AS jumlah,
       IFNULL((
         SELECT SUM(bd.bpjd_jumlah)
         FROM tbpj_hdr bh
         INNER JOIN tbpj_dtl bd ON bd.bpjd_bpj_nomor = bh.bpj_nomor
         WHERE bh.bpj_po_nomor = d.pojd_pojh_nomor
           AND bd.bpjd_bhn_kode = d.pojd_bhn_kode
       ), 0) AS sudah,
       d.pojd_jumlah - IFNULL((
         SELECT SUM(bd.bpjd_jumlah)
         FROM tbpj_hdr bh
         INNER JOIN tbpj_dtl bd ON bd.bpjd_bpj_nomor = bh.bpj_nomor
         WHERE bh.bpj_po_nomor = d.pojd_pojh_nomor
           AND bd.bpjd_bhn_kode = d.pojd_bhn_kode
       ), 0) AS kurang
     FROM tpojasa_dtl d
     LEFT JOIN tbahan b ON b.bhn_kode = d.pojd_bhn_kode
     WHERE d.pojd_pojh_nomor = ?
       AND (d.pojd_statuspotong IS NULL OR d.pojd_statuspotong <> 1)
     ORDER BY d.pojd_bhn_kode`,
    [poNomor],
  );

  return { header: hdr, detail: dtl };
};

// ─────────────────────────────────────────────────────────
// GET DATA REALISASI MINTA (No.Material)
// Sesuai Delphi edtNoMaterialExit + F1 modal
// ─────────────────────────────────────────────────────────
const getDataRealisasiMinta = async (noMaterial, bhnKode) => {
  const [[row]] = await db.query(
    `SELECT
       c.promin_nomor,
       DATE_FORMAT(c.promin_tanggal, '%Y-%m-%d') AS promin_tanggal,
       e.promind_bhn_kode AS bhn_kode,
       b.bhn_name         AS nama_kain,
       b.bhn_satuan       AS sat_kain,
       e.promind_jumlah   AS jml_kain,
       e.promind_sup_kode AS sup_kode_kain
     FROM tproduksiminta_hdr c
     INNER JOIN tproduksiminta_dtl e
       ON e.promind_promin_nomor = c.promin_nomor
       AND e.promind_bhn_kode = ?
     LEFT JOIN tbahan b ON b.bhn_kode = e.promind_bhn_kode
     WHERE c.promin_nomor = ?`,
    [bhnKode, noMaterial],
  );
  if (!row) throw new Error("No permintaan dengan kode kain tsb tidak ada.");

  // Hitung LHK (sudah terpakai dari mutasi + BPJ lain)
  // Sesuai Delphi edtNoMaterialExit
  const [[lhkRow]] = await db.query(
    `SELECT SUM(jml) AS sudah FROM (
       SELECT IFNULL(SUM(mph_qty_berat), 0) AS jml
       FROM tmutasiproduksi_hdr
       WHERE mph_nomaterial = ? AND mph_bhn_kode = ?
       UNION ALL
       SELECT IFNULL(SUM(h.bpj_qty_berat), 0) AS jml
       FROM tbpj_hdr h
       WHERE h.bpj_nomaterial = ? AND h.bpj_bhn_kode = ?
     ) x`,
    [noMaterial, bhnKode, noMaterial, bhnKode],
  );

  return {
    ...row,
    lhk: lhkRow?.sudah ?? 0,
    kurang: (row.jml_kain ?? 0) - (lhkRow?.sudah ?? 0),
  };
};

// ─────────────────────────────────────────────────────────
// GET KOMPONEN LIST untuk dropdown
// Sesuai Delphi edtNomorSPKChange:
// Jika ada di tspk_babaran → pakai itu
// Jika tidak → fallback ke tkomponen
// ─────────────────────────────────────────────────────────
const getKomponenList = async (spkNomor) => {
  const [rows] = await db.query(
    `SELECT spkb_komponen AS komponen, spkb_babaran AS babaran_std
     FROM tspk_babaran WHERE spkb_nomor = ?`,
    [spkNomor],
  );
  if (rows.length > 0) return rows;

  // Fallback ke tkomponen
  const [fallback] = await db.query(
    `SELECT komponen, 0 AS babaran_std FROM tkomponen`,
  );
  return fallback;
};

// ─────────────────────────────────────────────────────────
// GET BABARAN STD per komponen
// Sesuai Delphi cbkomponenChange
// ─────────────────────────────────────────────────────────
const getBabaranStd = async (spkNomor, komponen) => {
  const [[row]] = await db.query(
    `SELECT spkb_babaran AS babaran_std
     FROM tspk_babaran
     WHERE spkb_nomor = ? AND spkb_komponen = ?`,
    [spkNomor, komponen],
  );
  return row?.babaran_std ?? 0;
};

// ─────────────────────────────────────────────────────────
// GET KELOMPOK TUJUAN (muncul jika gudang = GP003)
// Sesuai Delphi edtNamaGudangProdChange
// ─────────────────────────────────────────────────────────
const getKelompokTujuan = async (cab) => {
  const [rows] = await db.query(
    `SELECT Kelompok AS kelompok
     FROM tkelompok WHERE lini = 'JAHIT' AND cab = ?`,
    [cab],
  );
  return rows;
};

// ─────────────────────────────────────────────────────────
// VALIDASI CEK KOMPONEN (untuk J07 cutting/cetak/bordir)
// Sesuai Delphi cekkomponen() — diupdate sesuai struktur terbaru:
// POTONG → tspk_komponen_potong
// CETAK/BORDIR → tspk_komponen_cetak_bordir WHERE kcb_proses = lini
// ─────────────────────────────────────────────────────────
const cekKomponen = async (spkNomor, lini) => {
  if (!spkNomor || !lini) return false;

  if (lini === "POTONG") {
    const [[row]] = await db.query(
      `SELECT COUNT(sk_nomor) AS jml
       FROM tspk_komponen_potong
       WHERE sk_nomor = ?`,
      [spkNomor],
    );
    return (row?.jml ?? 0) > 0;
  }

  // CETAK atau BORDIR → tspk_komponen_cetak_bordir
  if (lini === "CETAK" || lini === "BORDIR") {
    const [[row]] = await db.query(
      `SELECT COUNT(kcb_nomor) AS jml
       FROM tspk_komponen_cetak_bordir
       WHERE kcb_nomor = ? AND kcb_proses = ?`,
      [spkNomor, lini],
    );
    return (row?.jml ?? 0) > 0;
  }

  return false;
};

// ─────────────────────────────────────────────────────────
// CEK STATUS INV (sudah ada voucher pembayaran?)
// Sesuai Delphi cekstatusinv
// ─────────────────────────────────────────────────────────
const cekStatusInv = async (nomor) => {
  const [[row]] = await db.query(
    `SELECT bpj_status_inv FROM tbpj_hdr WHERE bpj_nomor = ?`,
    [nomor],
  );
  return row?.bpj_status_inv !== 0 && row?.bpj_status_inv !== "0";
};

// ─────────────────────────────────────────────────────────
// GET BY NOMOR (untuk form edit)
// Sesuai Delphi loaddataall
// ─────────────────────────────────────────────────────────
const getById = async (nomor) => {
  const [[hdr]] = await db.query(
    `SELECT
       h.bpj_nomor,
       DATE_FORMAT(h.bpj_tanggal,    '%Y-%m-%d') AS bpj_tanggal,
       h.bpj_po_nomor, h.bpj_sup_kode,
       DATE_FORMAT(h.bpj_jatuhtempo, '%Y-%m-%d') AS bpj_jatuhtempo,
       h.bpj_jumlah, h.bpj_gdgp_kode, h.bpj_cab,
       h.bpj_supplier, h.bpj_nomaterial, h.bpj_bhn_kode,
       h.bpj_qty_berat, h.bpj_sat_berat,
       h.bpj_komponen, h.bpj_kelompok_tujuan, h.bpj_alasan,
       h.bpj_status_inv, h.bpj_bayar_realisasi,
       h.user_create, h.user_modified,
       DATE_FORMAT(h.date_create, '%Y-%m-%d %H:%i') AS date_create,
       -- dari PO
       ph.pojh_cab, ph.pojh_gdgp_kode AS gdgp_asal_kode,
       ph.pojh_keterangan, ph.pojh_jasa_kode, ph.pojh_spk_nomor,
       ph.pojh_jumlah AS pojh_jumlah, ph.pojh_tarif,
       ph.pojh_status_ppn, ph.pojh_status,
       j.jasa_nama,
       s.sup_nama, s.sup_alamat, s.sup_kota, s.sup_top,
       IFNULL(sk.spk_nama,  ms.mspk_nama)   AS spk_nama,
       IFNULL(sk.spk_jumlah, ms.mspk_jumlah) AS spk_jumlah,
       DATE_FORMAT(IFNULL(sk.spk_tanggal, ms.mspk_tanggal), '%Y-%m-%d') AS tgl_spk,
       IFNULL(sk.spk_sablon, '-') AS xsablon,
       IFNULL(sk.spk_bordir, '-') AS xbordir,
       o.jo_nama,
       ga.gdgp_nama AS gdgp_asal_nama,
       gt.gdgp_nama AS gdgp_tujuan_nama,
       IFNULL((SELECT SUM(hh.bpj_jumlah)
               FROM tbpj_hdr hh
               WHERE hh.bpj_po_nomor = ph.pojh_nomor), 0)
         - h.bpj_jumlah AS sudah_terima
     FROM tbpj_hdr h
     INNER JOIN tpojasa_hdr  ph ON ph.pojh_nomor  = h.bpj_po_nomor
     INNER JOIN tjasa         j  ON j.jasa_kode    = ph.pojh_jasa_kode
     INNER JOIN tsupplier     s  ON s.sup_kode     = ph.pojh_sup_kode
     LEFT  JOIN tspk          sk ON sk.spk_nomor   = ph.pojh_spk_nomor
     LEFT  JOIN tmemospk      ms ON ms.mspk_nomor  = ph.pojh_spk_nomor
     LEFT  JOIN tjenisorder   o  ON o.jo_kode      = sk.spk_jo_kode
     LEFT  JOIN tgudangproduksi ga ON ga.gdgp_kode = ph.pojh_gdgp_kode
     LEFT  JOIN tgudangproduksi gt ON gt.gdgp_kode = h.bpj_gdgp_kode
     WHERE h.bpj_nomor = ?`,
    [nomor],
  );
  if (!hdr) return null;

  // Detail bahan
  const [dtl] = await db.query(
    `SELECT
       pd.pojd_bhn_kode AS kode,
       n.bhn_name       AS nama,
       pd.pojd_bhn_satuan AS satuan,
       pd.pojd_jumlah   AS pojd_jumlah,
       d.bpjd_jumlah    AS jumlah,
       d.bpjd_status,
       d.bpjd_bs_mitra, d.bpjd_bs, d.bpjd_bs_kain, d.bpjd_size,
       IFNULL((
         SELECT SUM(d1.bpjd_jumlah)
         FROM tbpj_hdr h1
         INNER JOIN tbpj_dtl d1 ON d1.bpjd_bpj_nomor = h1.bpj_nomor
         WHERE h1.bpj_po_nomor = pd.pojd_pojh_nomor
           AND d1.bpjd_bhn_kode = pd.pojd_bhn_kode
       ), 0) - IFNULL(d.bpjd_jumlah, 0) AS sudah,
       pd.pojd_jumlah - (
         IFNULL((
           SELECT SUM(d1.bpjd_jumlah)
           FROM tbpj_hdr h1
           INNER JOIN tbpj_dtl d1 ON d1.bpjd_bpj_nomor = h1.bpj_nomor
           WHERE h1.bpj_po_nomor = pd.pojd_pojh_nomor
             AND d1.bpjd_bhn_kode = pd.pojd_bhn_kode
         ), 0)
       ) + IFNULL(d.bpjd_jumlah, 0) AS kurang
     FROM tpojasa_dtl pd
     LEFT JOIN tbpj_dtl d
       ON d.bpjd_bpj_nomor = ? AND d.bpjd_bhn_kode = pd.pojd_bhn_kode
     LEFT JOIN tbahan n ON n.bhn_kode = pd.pojd_bhn_kode
     WHERE pd.pojd_pojh_nomor = ?
       AND (pd.pojd_statuspotong IS NULL OR pd.pojd_statuspotong <> 1)
     ORDER BY pd.pojd_bhn_kode`,
    [nomor, hdr.bpj_po_nomor],
  );

  // Cek tutup buku & PIN5 — sesuai Delphi loaddataall cekClose
  const zdtClose = await tutupBukuService.getTanggalTutupBuku();
  const zClose = await tutupBukuService.getManualTutupBuku("BPB JASA");
  const tglTrx = new Date(hdr.bpj_tanggal);
  const isClose = zClose ? tglTrx < zClose : tglTrx < zdtClose;

  let pin5Status = "";
  let pin5Urut = 0;
  if (isClose) {
    const [pinRows] = await db.query(
      `SELECT pin_acc, pin_dipakai, pin_urut
       FROM tspk_pin5
       WHERE pin_trs = 'BPB JASA' AND pin_nomor = ?
       ORDER BY pin_urut DESC LIMIT 1`,
      [nomor],
    );
    if (!pinRows.length) {
      pin5Status = "MINTA";
    } else {
      const p = pinRows[0];
      pin5Urut = p.pin_urut;
      if (p.pin_acc === "" && p.pin_dipakai === "") pin5Status = "WAIT";
      else if (p.pin_acc === "Y" && p.pin_dipakai === "") pin5Status = "ACC";
      else if (p.pin_acc === "N") pin5Status = "TOLAK";
      else pin5Status = "MINTA";
    }
  }

  // Info babaran std untuk komponen aktif
  let babaranStd = 0;
  if (hdr.bpj_komponen && hdr.pojh_spk_nomor) {
    babaranStd = await getBabaranStd(hdr.pojh_spk_nomor, hdr.bpj_komponen);
  }

  return {
    header: hdr,
    detail: dtl,
    pin5Status,
    pin5Urut,
    isClose,
    babaranStd,
  };
};

// ─────────────────────────────────────────────────────────
// SAVE (INSERT / UPDATE)
// Sesuai Delphi simpandata + FormKeyDown F10
// ─────────────────────────────────────────────────────────
const save = async (data, userKode, isNew) => {
  const {
    Tanggal,
    Cab,
    PoNomor,
    SupKode,
    Jatuhtempo,
    JumlahTerima,
    GdgpKode,
    GdgpAsalKode,
    Supplier = "",
    NoMaterial = "",
    BhnKode = "",
    QtyBerat = 0,
    SatBerat = "",
    Komponen = "",
    KelompokTujuan = "",
    Alasan = "",
    StatusPpn = 0,
    Detail = [],
    pin5Status = "",
    pin5Urut = null,
    // Flags validasi dari Delphi
    isCetak = false,
    isBordir = false,
  } = data;

  // ── Validasi sebelum transaksi ────────────────────────
  if (!PoNomor) throw new Error("Nomor PO tidak boleh kosong.");
  if (!SupKode) throw new Error("PO tidak valid.");
  if (!JumlahTerima || Number(JumlahTerima) <= 0)
    throw new Error("Jumlah Terima masih kosong.");
  if (!GdgpKode) throw new Error("Nama Gudang produksi harus diisi.");

  // Validasi cek status inv jika edit
  if (!isNew && data.Nomor) {
    const sudahInv = await cekStatusInv(data.Nomor);
    if (sudahInv)
      throw new Error(
        "Transaksi ini sudah dibuat Voucher Pembayaran, tidak bisa di edit.",
      );
  }

  // Validasi komponen (sesuai Delphi, pakai tgl cutoff 01-12-2024)
  const CUTOFF_DATE = new Date("2024-12-01");
  const tglSpk = data.TglSpk ? new Date(data.TglSpk) : null;
  const spkNomor = data.SpkNomor || "";

  if (tglSpk && tglSpk >= CUTOFF_DATE) {
    if (GdgpAsalKode === "GP001") {
      const ok = await cekKomponen(spkNomor, "POTONG");
      if (!ok)
        throw new Error("Komponen cutting belum di identifikasi pada SPK tsb.");
    }
    if (isCetak && GdgpAsalKode === "GP002") {
      const ok = await cekKomponen(spkNomor, "CETAK");
      if (!ok)
        throw new Error("Komponen cetak belum di identifikasi pada SPK tsb.");
    }
    if (isBordir && GdgpAsalKode === "GP014") {
      const ok = await cekKomponen(spkNomor, "BORDIR");
      if (!ok)
        throw new Error("Komponen bordir belum di identifikasi pada SPK tsb.");
    }
  }

  // Validasi J07 (CUTTING)
  const jasaKode = data.JasaKode || "";
  if (jasaKode === "J07") {
    if (!QtyBerat || Number(QtyBerat) === 0)
      throw new Error("Babaran tidak boleh kosong. Cek jumlah dan berat kain!");
    if (!Komponen) throw new Error("Komponen belum dipilih.");
    // Hitung selisih babaran
    const berat = Number(QtyBerat);
    const jml = Number(JumlahTerima);
    const std = Number(data.BabaranStd || 0);
    let babaran = 0;
    if (berat > 0 && jml > 0) {
      babaran = SatBerat === "KG" ? jml / berat : berat / jml;
    }
    const selisih = SatBerat === "KG" ? babaran - std : std - babaran;
    if (selisih < 0 && !Alasan?.trim())
      throw new Error("Babaran < Babaran standar. Alasan harus diisi.");
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    let nomor = isNew ? await generateNomor(Tanggal, conn) : data.Nomor;

    if (isNew) {
      await conn.query(
        `INSERT INTO tbpj_hdr
           (bpj_nomor, bpj_tanggal, bpj_po_nomor, bpj_sup_kode,
            bpj_jatuhtempo, bpj_jumlah, bpj_gdgp_kode, bpj_cab,
            bpj_supplier, bpj_nomaterial, bpj_bhn_kode,
            bpj_qty_berat, bpj_sat_berat,
            bpj_komponen, bpj_kelompok_tujuan, bpj_alasan,
            date_create, user_create)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?)`,
        [
          nomor,
          Tanggal,
          PoNomor,
          SupKode,
          Jatuhtempo,
          Number(JumlahTerima),
          GdgpKode,
          Cab,
          Supplier,
          NoMaterial,
          BhnKode,
          Number(QtyBerat),
          SatBerat,
          Komponen,
          KelompokTujuan,
          Alasan,
          userKode,
        ],
      );
    } else {
      await conn.query(
        `UPDATE tbpj_hdr SET
           bpj_tanggal    = ?, bpj_po_nomor   = ?, bpj_sup_kode   = ?,
           bpj_jatuhtempo = ?, bpj_jumlah     = ?, bpj_gdgp_kode  = ?,
           bpj_supplier   = ?, bpj_nomaterial  = ?, bpj_bhn_kode   = ?,
           bpj_qty_berat  = ?, bpj_sat_berat   = ?,
           bpj_komponen   = ?, bpj_kelompok_tujuan = ?, bpj_alasan = ?,
           date_modified  = NOW(), user_modified = ?
         WHERE bpj_nomor = ?`,
        [
          Tanggal,
          PoNomor,
          SupKode,
          Jatuhtempo,
          Number(JumlahTerima),
          GdgpKode,
          Supplier,
          NoMaterial,
          BhnKode,
          Number(QtyBerat),
          SatBerat,
          Komponen,
          KelompokTujuan,
          Alasan,
          userKode,
          nomor,
        ],
      );
    }

    // Delete + insert detail
    await conn.query(`DELETE FROM tbpj_dtl WHERE bpjd_bpj_nomor = ?`, [nomor]);

    for (const row of Detail) {
      if (!row.kode || Number(row.jumlah) <= 0) continue;
      // Status: Delay=0, True=1, Cancel=2
      const status =
        row.status === "True" ? 1 : row.status === "Cancel" ? 2 : 0;
      await conn.query(
        `INSERT INTO tbpj_dtl
           (bpjd_bpj_nomor, bpjd_bhn_kode, bpjd_jumlah, bpjd_bhn_satuan,
            bpjd_status, bpjd_bs_mitra, bpjd_bs, bpjd_bs_kain,
            bpjd_size, bpjd_spk, bpjd_gdgp_asal)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          nomor,
          row.kode,
          Number(row.jumlah),
          row.satuan || "",
          status,
          Number(row.bs_mitra) || 0,
          Number(row.bs) || 0,
          Number(row.bs_kain) || 0,
          row.size || "",
          spkNomor,
          GdgpAsalKode || "",
        ],
      );
    }

    // Update status PO jika chkStatus
    // Sesuai Delphi: simpandata update pojh_status
    if (data.StatusPo !== undefined) {
      await conn.query(
        `UPDATE tpojasa_hdr SET pojh_status = ? WHERE pojh_nomor = ?`,
        [data.StatusPo ? 1 : 0, PoNomor],
      );
    }

    // Tandai PIN5 ACC sudah dipakai
    if (pin5Status === "ACC" && pin5Urut) {
      await conn.query(
        `UPDATE tspk_pin5 SET pin_dipakai = 'Y'
         WHERE pin_trs = 'BPB JASA' AND pin_nomor = ? AND pin_urut = ?`,
        [nomor, pin5Urut],
      );
    }

    await conn.commit();
    return nomor;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
};

module.exports = {
  generateNomor,
  getDataPO,
  getDataRealisasiMinta,
  getKomponenList,
  getBabaranStd,
  getKelompokTujuan,
  cekKomponen,
  cekStatusInv,
  getById,
  save,
};
