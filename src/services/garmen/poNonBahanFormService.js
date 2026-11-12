const db = require("../../config/database");
const tutupBukuService = require("../tutupBukuService");

const KECAB_PO_DEFAULT = { P02: "P04" };
// Aset selalu masuk gudang P04, apa pun cabang peminta
const KECAB_ASET = "P04";
const resolveKecab = (cabMinta, jenis) =>
  jenis === "ASET" ? KECAB_ASET : KECAB_PO_DEFAULT[cabMinta] || cabMinta || "";

const JENIS_PO = ["ACCESORIES", "OBAT", "SPAREPART", "ATK/RTK", "ASET"];
const PREFIX_PO = {
  ACCESORIES: "POA",
  OBAT: "POO",
  SPAREPART: "POS",
  "ATK/RTK": "POK",
  ASET: "POI",
};
// Boleh melihat PO Aset (browse)
const BAGIAN_PO_ASET_LIHAT = [
  "GA",
  "EDP",
  "FINANCE",
  "AUDIT",
  "DIREKSI",
  "PEMBELIAN",
  "PURCHASING",
];
// Boleh membuat/mengubah PO Aset. [KONFIRMASI] EDP belum kamu sebut, jadi tidak saya masukkan
const BAGIAN_PO_ASET_PROSES = ["PEMBELIAN", "PURCHASING", "GA"];

// --- HELPER UNTUK MENGHITUNG QTY BPB & QTY SUDAH PO (1:1 Logic Delphi) ---
const getQtyBpb = async (poNomor, brgKode, conn) => {
  const [rows] = await conn.query(
    `SELECT IFNULL(SUM(d.bpbd_jumlah), 0) AS jml FROM tgarmenbpb_hdr h 
     INNER JOIN tgarmenbpb_dtl d ON d.bpbd_nomor = h.bpb_nomor 
     WHERE h.bpb_po_nomor = ? AND d.bpbd_brg_kode = ?`,
    [poNomor, brgKode],
  );
  return Number(rows[0]?.jml || 0);
};

// Bagi total (mis. qty BPB) ke baris-baris menurut urutan; baris terakhir menampung
// sisa/kelebihan, jadi PO satu baris hasilnya sama dengan perhitungan lama.
const alokasiFifo = (jumlahList, total) => {
  let sisa = Number(total) || 0;
  return jumlahList.map((jml, i) => {
    const last = i === jumlahList.length - 1;
    const a = last ? sisa : Math.min(Number(jml) || 0, sisa);
    sisa -= a;
    return a;
  });
};

const getQtySudah = async (poNomor, mbNomor, brgKode, conn) => {
  // PO belum CLOSE: qty yang di-PO-kan
  const [r1] = await conn.query(
    `SELECT IFNULL(SUM(d.pod_jumlah), 0) AS jml
     FROM tgarmenpo_hdr h
     INNER JOIN tgarmenpo_dtl d ON d.pod_nomor = h.po_nomor
     WHERE h.po_status NOT LIKE "%CLOSE%" AND h.po_nomor <> ?
       AND d.pod_brg_kode = ? AND d.pod_mb_nomor = ?`,
    [poNomor, brgKode, mbNomor],
  );

  // PO CLOSE: yang dihitung qty BPB-nya, dialokasikan FIFO ke baris-baris
  // kode yang sama di PO itu (BPB hanya tercatat per PO + kode)
  const [lines] = await conn.query(
    `SELECT d.pod_nomor, d.pod_mb_nomor, d.pod_jumlah
     FROM tgarmenpo_hdr h
     INNER JOIN tgarmenpo_dtl d ON d.pod_nomor = h.po_nomor
     WHERE h.po_status LIKE "%CLOSE%" AND h.po_nomor <> ?
       AND d.pod_brg_kode = ?
       AND h.po_nomor IN (
         SELECT x.pod_nomor FROM tgarmenpo_dtl x
         WHERE x.pod_mb_nomor = ? AND x.pod_brg_kode = ?
       )
     ORDER BY d.pod_nomor, d.pod_nourut`,
    [poNomor, brgKode, mbNomor, brgKode],
  );

  let closed = 0;
  if (lines.length) {
    const poList = [...new Set(lines.map((l) => l.pod_nomor))];
    const [bpb] = await conn.query(
      `SELECT j.bpb_po_nomor AS po, SUM(i.bpbd_jumlah) AS jml
       FROM tgarmenbpb_hdr j
       INNER JOIN tgarmenbpb_dtl i ON i.bpbd_nomor = j.bpb_nomor
       WHERE i.bpbd_brg_kode = ? AND j.bpb_po_nomor IN (?)
       GROUP BY j.bpb_po_nomor`,
      [brgKode, poList],
    );
    const diterima = new Map(bpb.map((b) => [b.po, Number(b.jml) || 0]));
    for (const po of poList) {
      const baris = lines.filter((l) => l.pod_nomor === po);
      const alok = alokasiFifo(
        baris.map((l) => l.pod_jumlah),
        diterima.get(po) || 0,
      );
      baris.forEach((l, i) => {
        if (l.pod_mb_nomor === mbNomor) closed += alok[i];
      });
    }
  }
  return Number(r1[0]?.jml || 0) + closed;
};

// --- STATUS PENERIMAAN (BPB) UNTUK PO MULTI-PERMINTAAN ---
// Alokasi qty BPB sebuah PO ke tiap barisnya (FIFO per kode, baris terakhir
// menampung kelebihan). excludeBpb = BPB yang sedang diedit (diabaikan).
const getAlokasiBpbPo = async (poNomor, conn, excludeBpb = "") => {
  const [lines] = await conn.query(
    `SELECT pod_mb_nomor AS mbNomor, pod_brg_kode AS kode, pod_jumlah AS jumlah
     FROM tgarmenpo_dtl WHERE pod_nomor = ? ORDER BY pod_nourut`,
    [poNomor],
  );
  const [bpb] = await conn.query(
    `SELECT i.bpbd_brg_kode AS kode, SUM(i.bpbd_jumlah) AS jml
     FROM tgarmenbpb_hdr j
     INNER JOIN tgarmenbpb_dtl i ON i.bpbd_nomor = j.bpb_nomor
     WHERE j.bpb_po_nomor = ? AND j.bpb_nomor <> ?
     GROUP BY i.bpbd_brg_kode`,
    [poNomor, excludeBpb],
  );
  const diterima = new Map(bpb.map((b) => [b.kode, Number(b.jml) || 0]));

  const hasil = [];
  for (const kode of [...new Set(lines.map((l) => l.kode))]) {
    const baris = lines.filter((l) => l.kode === kode);
    const alok = alokasiFifo(
      baris.map((l) => l.jumlah),
      diterima.get(kode) || 0,
    );
    baris.forEach((l, i) =>
      hasil.push({
        mbNomor: l.mbNomor,
        kode,
        jumlah: Number(l.jumlah) || 0,
        terima: alok[i],
      }),
    );
  }
  return hasil;
};

// Status PO dihitung per KODE (bukan per baris), supaya kode kembar dari
// permintaan berbeda tidak dihitung ganda.
const hitungStatusPo = async (poNomor, conn) => {
  const [[st]] = await conn.query(
    `SELECT IFNULL(SUM(x.minta), 0) AS minta,
            IFNULL(SUM(LEAST(x.minta, x.bpb)), 0) AS terima
     FROM (
       SELECT SUM(d.pod_jumlah) AS minta,
              IFNULL((
                SELECT SUM(i.bpbd_jumlah)
                FROM tgarmenbpb_dtl i
                INNER JOIN tgarmenbpb_hdr j ON j.bpb_nomor = i.bpbd_nomor
                WHERE j.bpb_po_nomor = d.pod_nomor
                  AND i.bpbd_brg_kode = d.pod_brg_kode
              ), 0) AS bpb
       FROM tgarmenpo_dtl d
       WHERE d.pod_nomor = ?
       GROUP BY d.pod_nomor, d.pod_brg_kode
     ) x`,
    [poNomor],
  );
  const minta = Number(st.minta || 0);
  const terima = Number(st.terima || 0);
  let status = "PROSES";
  if (terima >= minta) status = "CLOSE";
  else if (terima === 0) status = "";
  return { minta, terima, status };
};

// Qty yang sudah diterima untuk satu permintaan, per kode:
// BPB langsung dari permintaan + BPB lewat PO (dialokasikan ke baris ber-pod_mb_nomor itu).
const getQtyBpbPerMinta = async (mbNomor, conn, excludeBpb = "") => {
  const peta = new Map();
  const tambah = (kode, jml) =>
    peta.set(kode, (peta.get(kode) || 0) + (Number(jml) || 0));

  const [langsung] = await conn.query(
    `SELECT d.bpbd_brg_kode AS kode, SUM(d.bpbd_jumlah) AS jml
     FROM tgarmenbpb_hdr h
     INNER JOIN tgarmenbpb_dtl d ON d.bpbd_nomor = h.bpb_nomor
     WHERE h.bpb_mb_nomor = ? AND IFNULL(h.bpb_po_nomor, '') = ''
       AND h.bpb_nomor <> ?
     GROUP BY d.bpbd_brg_kode`,
    [mbNomor, excludeBpb],
  );
  langsung.forEach((r) => tambah(r.kode, r.jml));

  const [pos] = await conn.query(
    `SELECT DISTINCT pod_nomor FROM tgarmenpo_dtl WHERE pod_mb_nomor = ?`,
    [mbNomor],
  );
  for (const p of pos) {
    const alok = await getAlokasiBpbPo(p.pod_nomor, conn, excludeBpb);
    alok
      .filter((a) => a.mbNomor === mbNomor)
      .forEach((a) => tambah(a.kode, a.terima));
  }
  return peta;
};

// Total minta vs terima sebuah permintaan (rumus lama: BPB + MSO, masing-masing dibatasi qty minta)
const hitungTerimaMinta = async (mbNomor, conn) => {
  const peta = await getQtyBpbPerMinta(mbNomor, conn);
  const [rows] = await conn.query(
    `SELECT d.mbd_brg_kode AS kode, d.mbd_jumlah AS po,
            IFNULL((
              SELECT SUM(i.msod_jumlah)
              FROM tgarmenmso_dtl i
              INNER JOIN tgarmenmso_hdr j
                ON j.mso_nomor = i.msod_nomor AND j.mso_msi_nomor <> ""
              WHERE i.msod_mb_nomor = d.mbd_nomor AND i.msod_brg_kode = d.mbd_brg_kode
            ), 0) AS mso
     FROM tgarmenmintabeli_dtl d
     WHERE d.mbd_nomor = ?`,
    [mbNomor],
  );
  let po = 0;
  let terima = 0;
  for (const r of rows) {
    const qPo = Number(r.po) || 0;
    po += qPo;
    terima +=
      Math.min(Number(peta.get(r.kode)) || 0, qPo) +
      Math.min(Number(r.mso) || 0, qPo);
  }
  return { po, terima };
};

// Dipanggil setelah BPB disimpan/dihapus: perbarui status PO dan SEMUA permintaan di PO itu.
// bolehKosong=true (saat hapus BPB): permintaan yang terima 0 boleh kembali ke "" bila
// tidak ada PO yang memakainya; kalau masih ada di PO statusnya PROSES.
// Permintaan berstatus DICLOSE tidak ditimpa.
const refreshStatusBpb = async (
  conn,
  { poNomor = "", mbNomor = "", bolehKosong = false },
) => {
  const mbSet = new Set();
  if (mbNomor) mbSet.add(mbNomor);

  if (poNomor) {
    const { status } = await hitungStatusPo(poNomor, conn);
    await conn.query(`UPDATE tgarmenpo_hdr SET po_status=? WHERE po_nomor=?`, [
      status,
      poNomor,
    ]);
    const [mbs] = await conn.query(
      `SELECT DISTINCT pod_mb_nomor FROM tgarmenpo_dtl
       WHERE pod_nomor = ? AND pod_mb_nomor <> ''`,
      [poNomor],
    );
    mbs.forEach((r) => mbSet.add(r.pod_mb_nomor));
  }

  for (const mb of mbSet) {
    const { po, terima } = await hitungTerimaMinta(mb, conn);
    let st = "PROSES";
    if (terima >= po) st = "CLOSE";
    else if (terima === 0 && bolehKosong) {
      const [[ada]] = await conn.query(
        `SELECT EXISTS(SELECT 1 FROM tgarmenpo_dtl WHERE pod_mb_nomor = ?) AS ada`,
        [mb],
      );
      st = Number(ada.ada) ? "PROSES" : "";
    }
    await conn.query(
      `UPDATE tgarmenmintabeli_hdr SET mb_status=?
       WHERE mb_nomor=? AND mb_status <> 'DICLOSE'`,
      [st, mb],
    );
  }
};

// --- AMBIL DETAIL FORM UNTUK EDIT ---
const getDetailForm = async (nomor, user) => {
  const conn = await db.getConnection();
  try {
    const qHdr = `
      SELECT h.*, DATE_FORMAT(h.po_tanggal, '%Y-%m-%d') AS po_tanggal,
             s.sup_nama, s.sup_alamat, s.sup_kota
      FROM tgarmenpo_hdr h
      LEFT JOIN tsupplier s ON s.sup_kode = h.po_sup_kode
      WHERE h.po_nomor = ?
    `;
    const [hdrRows] = await conn.query(qHdr, [nomor]);
    if (hdrRows.length === 0) throw new Error("Nomor tersebut belum ada.");
    const header = hdrRows[0];
    header.po_ppn = Number(header.po_ppn) || 0;

    // Cek Status Kunci Periode & PIN (cekClose Delphi)
    const zdtClose = await tutupBukuService.getTanggalTutupBuku();
    const tglPO = new Date(header.po_tanggal);
    header.isTutupBuku = false;

    const [pinRows] = await conn.query(
      `SELECT pin_urut, pin_acc, pin_dipakai FROM tspk_pin5 WHERE pin_trs="PO GARMEN" AND pin_nomor=? ORDER BY pin_urut DESC LIMIT 1`,
      [nomor],
    );
    let pinStatus = "";
    let pinUrut = 0;
    if (pinRows.length > 0) {
      pinUrut = pinRows[0].pin_urut;
      pinStatus =
        pinRows[0].pin_acc === "" && pinRows[0].pin_dipakai === ""
          ? "WAIT"
          : pinRows[0].pin_acc === "Y" && pinRows[0].pin_dipakai === ""
            ? "ACC"
            : pinRows[0].pin_acc === "N"
              ? "TOLAK"
              : "MINTA";
    } else if (zdtClose && tglPO < zdtClose) {
      pinStatus = "MINTA";
    }

    if (zdtClose && tglPO < zdtClose && pinStatus !== "ACC") {
      header.isTutupBuku = true;
    }
    header.pin_status = pinStatus;
    header.pin_urut = pinUrut;

    // Baris detail = baris yang ada di PO ini (tiap baris membawa nomor permintaannya)
    // d.harga TETAP mentah/ungated: dipakai ulang saat SAVE; gating ada di kolom grid frontend.
    const qDtl = `
      SELECT
        d.pod_mb_nomor AS mbNomor,
        d.pod_brg_kode AS Kode,
        IF(b.brg_note="", b.brg_nama, CONCAT(b.brg_nama, " - ", b.brg_note)) AS Nama,
        b.brg_satuan AS Satuan,
        d.pod_ket AS ket,
        d.pod_kegunaan AS kegunaan,
        IFNULL(m.mbd_jumlah, 0) AS minta,
        d.pod_jumlah AS jumlah,
        d.pod_harga AS harga
      FROM tgarmenpo_dtl d
      LEFT JOIN tgarmenmintabeli_dtl m
        ON m.mbd_nomor = d.pod_mb_nomor AND m.mbd_brg_kode = d.pod_brg_kode
      LEFT JOIN tgarmen_brg b ON b.brg_kode = d.pod_brg_kode
      WHERE d.pod_nomor = ?
      ORDER BY d.pod_nourut ASC
    `;
    const [dtlRows] = await conn.query(qDtl, [nomor]);

    for (const d of dtlRows) {
      d.sudah = await getQtySudah(nomor, d.mbNomor, d.Kode, conn);
      d.belum = Number(d.minta || 0) - d.sudah;
    }

    // BPB tercatat per PO + kode: bagi FIFO ke baris-baris kode yang sama
    header.hasBpb = false;
    for (const kode of [...new Set(dtlRows.map((d) => d.Kode))]) {
      const baris = dtlRows.filter((d) => d.Kode === kode);
      const alok = alokasiFifo(
        baris.map((d) => d.jumlah),
        await getQtyBpb(nomor, kode, conn),
      );
      baris.forEach((d, i) => {
        d.bpb = alok[i];
        if (d.bpb > 0) header.hasBpb = true; // Kunci input supplier jika ada BPB
      });
    }

    return { header, detail: dtlRows };
  } finally {
    conn.release();
  }
};

// --- LOAD DATA BERDASARKAN NO PERMINTAAN (Delphi: edtMintaExit) ---
// Hanya mengembalikan item yang masih punya sisa belum-PO.
const getPermintaanDetail = async (mbNomor, poNomor = "") => {
  const qDtl = `
    SELECT d.mbd_nomor AS mbNomor, d.mbd_brg_kode AS Kode,
           IF(b.brg_note="", b.brg_nama, CONCAT(b.brg_nama, " - ", b.brg_note)) AS Nama,
           b.brg_satuan AS Satuan, d.mbd_ket AS ket, d.mbd_kegunaan AS kegunaan, d.mbd_jumlah AS minta,
           h.mb_cab AS cab, h.mb_jenis AS jenis, h.mb_status AS status,
           DATE_FORMAT(h.mb_tanggal, '%Y-%m-%d') AS tglminta
    FROM tgarmenmintabeli_dtl d
    INNER JOIN tgarmenmintabeli_hdr h ON h.mb_nomor = d.mbd_nomor
    LEFT JOIN tgarmen_brg b ON b.brg_kode = d.mbd_brg_kode
    WHERE d.mbd_nomor = ? ORDER BY d.mbd_nourut
  `;
  const [rows] = await db.query(qDtl, [mbNomor]);
  if (rows.length === 0) throw new Error("No. Permintaan tersebut tidak ada.");
  if (["CLOSE", "DICLOSE"].includes(String(rows[0].status || "").trim())) {
    throw new Error("No. Permintaan tsb sudah di-close.");
  }

  const hasil = [];
  for (const r of rows) {
    const sudah = await getQtySudah(poNomor, mbNomor, r.Kode, db);
    const belum = Number(r.minta || 0) - sudah;
    if (belum <= 0) continue;
    hasil.push({
      ...r,
      sudah,
      belum,
      jumlah: belum, // Default jumlah PO = sisa yang belum di-PO
      harga: 0,
      total: 0,
      bpb: 0,
      kecab: resolveKecab(r.cab, r.jenis),
    });
  }
  if (hasil.length === 0) {
    throw new Error("Semua item permintaan tsb sudah di-PO-kan.");
  }
  return hasil;
};

// --- SIMPAN / UPDATE PO DATA ---
const saveData = async (payload, user) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    let {
      isEdit,
      po_nomor,
      po_tanggal,
      po_ket,
      po_sup_kode,
      po_jenis,
      po_ppn,
      detail,
    } = payload;
    detail = Array.isArray(detail) ? detail : [];
    const tglPO = new Date(po_tanggal);

    if (!isEdit && !JENIS_PO.includes(po_jenis)) {
      throw new Error("Jenis PO tidak dikenal.");
    }

    // 1. Validasi Awal & Tutup Buku
    if (!po_sup_kode || po_sup_kode.trim() === "")
      throw new Error("Supplier harus di isi. Tidak bisa disimpan.");

    const ppnHeader = Number(po_ppn || 0);
    if (!(ppnHeader >= 0 && ppnHeader <= 100))
      throw new Error("PPN harus antara 0 sampai 100.");

    const zdtClose = await tutupBukuService.getTanggalTutupBuku();
    let pinStatus = "";
    let pinUrut = 0;

    if (isEdit) {
      const [pinRows] = await conn.query(
        `SELECT pin_urut, pin_acc, pin_dipakai FROM tspk_pin5 WHERE pin_trs="PO GARMEN" AND pin_nomor=? ORDER BY pin_urut DESC LIMIT 1`,
        [po_nomor],
      );
      if (pinRows.length > 0) {
        pinUrut = pinRows[0].pin_urut;
        pinStatus =
          pinRows[0].pin_acc === "" && pinRows[0].pin_dipakai === ""
            ? "WAIT"
            : pinRows[0].pin_acc === "Y" && pinRows[0].pin_dipakai === ""
              ? "ACC"
              : "MINTA";
      }
      if (["MINTA", "WAIT", "TOLAK"].includes(pinStatus)) {
        throw new Error(
          "Transaksi tsb sudah diclose. Silahkan minta approve untuk bisa menyimpan perubahan data.",
        );
      }
    }

    if (
      po_jenis === "ASET" &&
      !BAGIAN_PO_ASET_PROSES.includes(String(user.bagian || "").toUpperCase())
    ) {
      throw new Error("PO Aset hanya untuk bagian Pembelian atau GA.");
    }

    if (zdtClose && tglPO < zdtClose && pinStatus !== "ACC") {
      throw new Error(
        "Anda tidak boleh input di tanggal periode yg sudah diclose.",
      );
    }

    if (isEdit) {
      const [cekBpbExist] = await conn.query(
        `SELECT COUNT(*) AS total FROM tgarmenbpb_hdr WHERE bpb_po_nomor = ?`,
        [po_nomor],
      );
      if (cekBpbExist[0].total > 0) {
        throw new Error(
          "PO tsb sudah ada penerimaan BPB. Tidak bisa disimpan.",
        );
      }
    }

    let mbLama = new Set(); // permintaan yang sudah ada di PO ini (mode edit)
    if (isEdit) {
      const [[cur]] = await conn.query(
        `SELECT po_status, po_jenis, po_tanggal
         FROM tgarmenpo_hdr WHERE po_nomor = ? FOR UPDATE`,
        [po_nomor],
      );
      if (!cur) throw new Error("Nomor tersebut belum ada.");
      if (String(cur.po_status || "").trim() !== "") {
        throw new Error(`Sudah ${cur.po_status}, tidak dapat diubah.`);
      }
      if (
        zdtClose &&
        new Date(cur.po_tanggal) < zdtClose &&
        pinStatus !== "ACC"
      ) {
        throw new Error(
          "Transaksi tsb sudah diclose. Silahkan minta approve untuk bisa menyimpan perubahan data.",
        );
      }
      po_jenis = cur.po_jenis;

      const [lama] = await conn.query(
        `SELECT DISTINCT pod_mb_nomor FROM tgarmenpo_dtl WHERE pod_nomor = ?`,
        [po_nomor],
      );
      mbLama = new Set(lama.map((r) => r.pod_mb_nomor).filter(Boolean));
    }

    // 2. Tarik / Ganti Nomor Baru Jika Mode Create
    if (!isEdit) {
      const year = tglPO.getFullYear().toString();
      const cjenis = PREFIX_PO[po_jenis];
      const searchPrefix = cjenis + year;
      const [[maxRow]] = await conn.query(
        `SELECT IFNULL(MAX(CAST(RIGHT(po_nomor, 5) AS UNSIGNED)), 0) AS max_val FROM tgarmenpo_hdr WHERE LEFT(po_nomor, 7) = ? FOR UPDATE`,
        [searchPrefix],
      );
      po_nomor =
        searchPrefix +
        String(parseInt(maxRow.max_val, 10) + 1).padStart(5, "0");
    }

    // 3. Validasi detail grid (tiap baris membawa nomor permintaannya)
    const baris = detail.filter((d) => d.Nama && Number(d.jumlah || 0) !== 0);
    const totalQty = baris.reduce((s, d) => s + Number(d.jumlah || 0), 0);
    if (!baris.length || totalQty === 0)
      throw new Error("Jumlah kosong semua, belum bisa disimpan.");

    const kunci = new Set();
    const perMb = new Map(); // nomor permintaan -> daftar kode
    const hargaPerKode = new Map(); // kode sama dalam satu PO harus satu harga
    for (const d of baris) {
      if (!d.mbNomor)
        throw new Error(
          `Barang ${d.Kode} tidak punya No. Permintaan. Panggil ulang permintaannya.`,
        );
      if (Number(d.harga || 0) === 0) throw new Error("harga harus di isi.");
      const harga = Number(d.harga);
      if (
        hargaPerKode.has(d.Kode) &&
        Math.abs(hargaPerKode.get(d.Kode) - harga) > 0.0001
      ) {
        throw new Error(
          `Barang ${d.Kode} punya harga berbeda di PO yang sama. Samakan harga untuk kode yang sama.`,
        );
      }
      hargaPerKode.set(d.Kode, harga);
      const k = `${d.mbNomor}|${d.Kode}`;
      if (kunci.has(k))
        throw new Error(
          `Barang ${d.Kode} ganda untuk permintaan ${d.mbNomor}.`,
        );
      kunci.add(k);
      if (!perMb.has(d.mbNomor)) perMb.set(d.mbNomor, []);
      perMb.get(d.mbNomor).push(d.Kode);
    }

    // 3b. Tiap permintaan: ada, sejenis dengan PO, barang berasal dari permintaan itu,
    // belum di-close (kecuali yang memang sudah ada di PO ini), dan satu cabang tujuan
    let po_kecab = "";
    for (const [mbNomor, kodes] of perMb) {
      const [[mb]] = await conn.query(
        `SELECT mb_cab, mb_jenis, mb_status FROM tgarmenmintabeli_hdr WHERE mb_nomor = ?`,
        [mbNomor],
      );
      if (!mb) throw new Error(`No. Permintaan ${mbNomor} tidak ada.`);
      if ((po_jenis === "ASET") !== (mb.mb_jenis === "ASET")) {
        throw new Error(
          "Jenis PO tidak sama dengan jenis Permintaan Pembelian.",
        );
      }
      if (
        !mbLama.has(mbNomor) &&
        ["CLOSE", "DICLOSE"].includes(String(mb.mb_status || "").trim())
      ) {
        throw new Error(`No. Permintaan ${mbNomor} sudah di-close.`);
      }

      const [src] = await conn.query(
        `SELECT DISTINCT d.mbd_brg_kode
         FROM tgarmenmintabeli_dtl d
         INNER JOIN tgarmen_brg b ON b.brg_kode = d.mbd_brg_kode
         WHERE d.mbd_nomor = ? AND d.mbd_brg_kode IN (?) AND b.brg_jenis = ?`,
        [mbNomor, kodes, po_jenis],
      );
      if (src.length !== kodes.length) {
        throw new Error(
          `Ada barang yang bukan dari permintaan ${mbNomor} atau beda jenis dengan PO.`,
        );
      }

      // Cabang tujuan ditentukan server dari cabang peminta, bukan dari payload
      const kecab = resolveKecab(mb.mb_cab, po_jenis);
      if (po_kecab && kecab !== po_kecab) {
        throw new Error(
          "Permintaan dengan cabang tujuan berbeda tidak bisa digabung dalam satu PO.",
        );
      }
      po_kecab = kecab;
    }
    const mbList = [...perMb.keys()];
    const po_mb_nomor = mbList[0]; // header menyimpan permintaan pertama (kompatibilitas)

    // 4. Eksekusi Header Upsert
    if (isEdit) {
      await conn.query(
        `UPDATE tgarmenpo_hdr SET po_tanggal=?, po_mb_nomor=?, po_kecab=?, po_ppn=?, po_ket=?, po_sup_kode=?, date_modified=NOW(), user_modified=? WHERE po_nomor=?`,
        [
          po_tanggal,
          po_mb_nomor,
          po_kecab,
          ppnHeader,
          po_ket || "",
          po_sup_kode,
          user.kode,
          po_nomor,
        ],
      );
    } else {
      await conn.query(
        `INSERT INTO tgarmenpo_hdr (po_jenis, po_nomor, po_tanggal, po_mb_nomor, po_cab, po_kecab, po_ppn, po_sup_kode, po_bagian, po_ket, date_create, user_create) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?)`,
        [
          po_jenis,
          po_nomor,
          po_tanggal,
          po_mb_nomor,
          user.cabang || "HO-",
          po_kecab,
          ppnHeader,
          po_sup_kode,
          user.bagian || "",
          po_ket || "",
          user.kode,
        ],
      );
    }

    // 5. Eksekusi Detail Grid (pod_ppn diisi sama dengan PPN header agar
    // cetak/voucher/uang muka yang membaca per baris tidak berubah)
    await conn.query("DELETE FROM tgarmenpo_dtl WHERE pod_nomor = ?", [
      po_nomor,
    ]);
    let nourut = 0;
    for (const d of baris) {
      nourut++;
      await conn.query(
        `INSERT INTO tgarmenpo_dtl (pod_nomor, pod_mb_nomor, pod_brg_kode, pod_jumlah, pod_harga, pod_ppn, pod_ket, pod_kegunaan, pod_nourut) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          po_nomor,
          d.mbNomor,
          d.Kode,
          Number(d.jumlah),
          Number(d.harga),
          ppnHeader,
          d.ket || "",
          d.kegunaan || "",
          nourut,
        ],
      );
    }

    // Update Status Permintaan & PIN
    await conn.query(
      `UPDATE tgarmenmintabeli_hdr SET mb_status=IF(mb_status="","PROSES",mb_status) WHERE mb_nomor IN (?)`,
      [mbList],
    );
    // Permintaan yang dilepas dari PO ini dan tidak dipakai PO lain: kembalikan status
    for (const mbNomor of mbLama) {
      if (perMb.has(mbNomor)) continue;
      await conn.query(
        `UPDATE tgarmenmintabeli_hdr SET mb_status=""
         WHERE mb_nomor=? AND mb_status="PROSES"
           AND NOT EXISTS (SELECT 1 FROM tgarmenpo_dtl WHERE pod_mb_nomor = ?)`,
        [mbNomor, mbNomor],
      );
    }
    if (isEdit && pinStatus === "ACC") {
      await conn.query(
        `UPDATE tspk_pin5 SET pin_dipakai="Y" WHERE pin_trs="PO GARMEN" AND pin_nomor=? AND pin_urut=?`,
        [po_nomor, pinUrut],
      );
    }

    await conn.commit();
    return { po_nomor };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
};

const getSupplierByKode = async (kode) => {
  const [rows] = await db.query(
    `SELECT sup_kode AS Kode, sup_nama AS Nama, sup_alamat AS Alamat, sup_kota AS Kota
     FROM tsupplier WHERE sup_kode = ? LIMIT 1`,
    [kode],
  );
  if (rows.length === 0) throw new Error("Supplier tidak ditemukan.");
  return rows[0];
};

module.exports = {
  getDetailForm,
  getPermintaanDetail,
  saveData,
  getSupplierByKode,
  refreshStatusBpb,
  getQtyBpbPerMinta,
  BAGIAN_PO_ASET_LIHAT,
  KECAB_ASET,
};
