const db = require("../../config/database");
const tutupBukuService = require("../tutupBukuService");

const MODUL_TUTUP_BUKU = "RB GARMEN";
const PREFIX_MAP = {
  ACCESORIES: "RBA",
  OBAT: "RBO",
  SPAREPART: "RBS",
  "ATK/RTK": "RBK",
};

// ── generateNomor: RBA+tahun+5digit, TANPA separator (sama pola Koreksi Stok) ──
const generateNomor = async (conn, jenis, tahun) => {
  const prefix = PREFIX_MAP[jenis];
  const [rows] = await conn.query(
    `SELECT IFNULL(MAX(RIGHT(rb_nomor, 5)), 0) AS jumlah FROM tgarmenrb_hdr
     WHERE LEFT(rb_nomor, 7) = ? FOR UPDATE`,
    [prefix + tahun],
  );
  const next = 100001 + Number(rows[0].jumlah);
  return `${prefix}${tahun}${String(next).slice(-5)}`;
};

// ── Status PIN5 & validasi tutup-buku — pola identik Retur Barang/Koreksi Stok ──
const computeStatus = async (nomor) => {
  const [rows] = await db.query(
    `SELECT pin_urut, pin_acc, pin_dipakai FROM tspk_pin5
     WHERE pin_trs = "RB GARMEN" AND pin_nomor = ?
     ORDER BY pin_urut DESC LIMIT 1`,
    [nomor],
  );
  if (rows.length === 0) return { status: "MINTA", urut: 0 };
  const { pin_urut, pin_acc, pin_dipakai } = rows[0];
  if (pin_acc === "" && pin_dipakai === "")
    return { status: "WAIT", urut: pin_urut };
  if (pin_acc === "Y" && pin_dipakai === "")
    return { status: "ACC", urut: pin_urut };
  if (pin_acc === "N") return { status: "TOLAK", urut: pin_urut };
  return { status: "MINTA", urut: pin_urut };
};

const resolveEditStatus = async (nomor, tanggal) => {
  const boundary =
    await tutupBukuService.getTanggalTutupBukuUntukTanggal(tanggal);
  const zClose = await tutupBukuService.getManualTutupBuku(MODUL_TUTUP_BUKU);
  const today = new Date();
  const tglTrs = new Date(tanggal);

  const perluCek = zClose === null ? boundary < today : tglTrs < zClose;
  if (!perluCek) return { status: "", urut: 0 };

  if (zClose === null) return computeStatus(nomor);
  if (tglTrs >= zClose) return { status: "", urut: 0 };
  return computeStatus(nomor);
};

// Replikasi FormKeyDown VK_F10 Delphi — boundary dihitung dari HARI INI
// (bukan tanggal transaksi), persis pola Retur Barang/Koreksi Stok
const checkCanSave = async (tanggal, statusPin5) => {
  if (["MINTA", "WAIT", "TOLAK"].includes(statusPin5)) {
    throw new Error(
      "Transaksi tsb sudah diclose. Silahkan minta approve untuk bisa menyimpan perubahan data.",
    );
  }

  const zdtClose = await tutupBukuService.getTanggalTutupBuku();
  const awalPeriode = new Date(zdtClose.getFullYear(), zdtClose.getMonth(), 1);
  const zClose = await tutupBukuService.getManualTutupBuku(MODUL_TUTUP_BUKU);
  const tglTrs = new Date(tanggal);

  const dalamPeriodeTerbuka = tglTrs <= zdtClose && tglTrs >= awalPeriode;
  const setelahBoundary = tglTrs >= zdtClose;

  const boleh =
    zClose === null
      ? dalamPeriodeTerbuka || setelahBoundary || statusPin5 === "ACC"
      : tglTrs >= zClose ||
        dalamPeriodeTerbuka ||
        setelahBoundary ||
        statusPin5 === "ACC";

  if (!boleh) {
    throw new Error(
      "Anda tidak boleh input di tanggal periode yg sudah diclose.",
    );
  }
};

// ── SEARCH BPB (F1 di edtbpb) — versi WORKING, bukan replikasi bug Delphi.
// User konfirmasi F1-di-BPB di Delphi ERROR (bukan business rule, murni
// bug produksi) — jadi di web ini dibuat benar-benar berfungsi, difilter
// per jenis sesuai maksud query aslinya (bpb_jenis=jenis).
const searchBpb = async (jenis, keyword, page = 1, limit = 50) => {
  const where = ["h.bpb_jenis = ?"];
  const params = [jenis];
  if (keyword) {
    where.push("(h.bpb_nomor LIKE ? OR s.sup_nama LIKE ?)");
    params.push(`%${keyword}%`, `%${keyword}%`);
  }
  const whereSql = where.join(" AND ");

  const [countRows] = await db.query(
    `SELECT COUNT(*) AS total FROM tgarmenbpb_hdr h
     LEFT JOIN tsupplier s ON s.sup_kode = h.bpb_sup_kode
     WHERE ${whereSql}`,
    params,
  );
  const total = Number(countRows[0].total);

  const offset = (page - 1) * limit;
  const [rows] = await db.query(
    `SELECT h.bpb_nomor AS Nomor, DATE_FORMAT(h.bpb_tanggal, '%d/%m/%Y') AS Tanggal,
      s.sup_nama AS Supplier
     FROM tgarmenbpb_hdr h
     LEFT JOIN tsupplier s ON s.sup_kode = h.bpb_sup_kode
     WHERE ${whereSql}
     ORDER BY h.bpb_nomor DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );
  return { items: rows, total };
};

// ── RESOLVE BPB (edtbpbExit) — validasi + auto-fill supplier + detail barang ──
const resolveBpb = async (bpbNomor, jenis) => {
  const [[header]] = await db.query(
    `SELECT h.bpb_nomor, h.bpb_tanggal, h.bpb_sup_kode,
       s.sup_nama, s.sup_alamat, s.sup_kota
     FROM tgarmenbpb_hdr h
     LEFT JOIN tsupplier s ON s.sup_kode = h.bpb_sup_kode
     WHERE h.bpb_nomor = ? AND h.bpb_jenis = ?`,
    [bpbNomor, jenis],
  );
  if (!header) throw new Error("BPB tsb belum ada.");

  const [detail] = await db.query(
    `SELECT d.bpbd_brg_kode AS Kode,
       IF(b.brg_note = "", b.brg_nama, CONCAT(b.brg_nama, " - ", b.brg_note)) AS Nama,
       b.brg_satuan AS Satuan, d.bpbd_jumlah AS QtyBpb
     FROM tgarmenbpb_dtl d
     LEFT JOIN tgarmen_brg b ON b.brg_kode = d.bpbd_brg_kode
     WHERE d.bpbd_nomor = ?
     ORDER BY d.bpbd_nourut`,
    [bpbNomor],
  );

  return {
    bpbNomor: header.bpb_nomor,
    bpbTanggal: header.bpb_tanggal,
    supplier: {
      kode: header.bpb_sup_kode,
      nama: header.sup_nama,
      alamat: header.sup_alamat,
      kota: header.sup_kota,
    },
    details: detail.map((r) => ({
      kode: r.Kode,
      nama: r.Nama,
      satuan: r.Satuan,
      qtyBpb: Number(r.QtyBpb),
      jumlah: 0,
    })),
  };
};

// ── Load data untuk form edit (loaddataall) ──
// ⚠️ Grid detail = base rows dari BPB TERKAIT (bukan dari tgarmenrb_dtl
// langsung), lalu di-overlay dengan rbd_jumlah yang sudah tersimpan per
// kode — replikasi persis pola 2-tahap Delphi (load dari BPB dulu, baru
// timpa kolom jumlah dari data retur yang sudah ada).
const getFormData = async (nomor) => {
  const [[header]] = await db.query(
    `SELECT h.rb_nomor, h.rb_jenis, h.rb_tanggal, h.rb_keterangan, h.rb_bpb_nomor,
       h.rb_sup_kode, s.sup_nama, s.sup_alamat, s.sup_kota, p.bpb_tanggal
     FROM tgarmenrb_hdr h
     LEFT JOIN tsupplier s ON s.sup_kode = h.rb_sup_kode
     LEFT JOIN tgarmenbpb_hdr p ON p.bpb_nomor = h.rb_bpb_nomor
     WHERE h.rb_nomor = ?`,
    [nomor],
  );
  if (!header) throw new Error("Nomor tersebut belum ada.");

  const [bpbDetail] = await db.query(
    `SELECT d.bpbd_brg_kode AS Kode,
       IF(b.brg_note = "", b.brg_nama, CONCAT(b.brg_nama, " - ", b.brg_note)) AS Nama,
       b.brg_satuan AS Satuan, d.bpbd_jumlah AS QtyBpb
     FROM tgarmenbpb_dtl d
     LEFT JOIN tgarmen_brg b ON b.brg_kode = d.bpbd_brg_kode
     WHERE d.bpbd_nomor = ?
     ORDER BY d.bpbd_nourut`,
    [header.rb_bpb_nomor],
  );

  const [rbDetail] = await db.query(
    `SELECT rbd_brg_kode AS Kode, rbd_jumlah AS Jumlah FROM tgarmenrb_dtl WHERE rbd_nomor = ?`,
    [nomor],
  );
  const jumlahMap = new Map(rbDetail.map((r) => [r.Kode, Number(r.Jumlah)]));

  const details = bpbDetail.map((r) => ({
    kode: r.Kode,
    nama: r.Nama,
    satuan: r.Satuan,
    qtyBpb: Number(r.QtyBpb),
    jumlah: jumlahMap.get(r.Kode) || 0,
  }));

  const { status } = await resolveEditStatus(nomor, header.rb_tanggal);

  return {
    nomor: header.rb_nomor,
    jenis: header.rb_jenis,
    tanggal: header.rb_tanggal,
    keterangan: header.rb_keterangan,
    bpbNomor: header.rb_bpb_nomor,
    bpbTanggal: header.bpb_tanggal,
    supplier: {
      kode: header.rb_sup_kode,
      nama: header.sup_nama,
      alamat: header.sup_alamat,
      kota: header.sup_kota,
    },
    statusPin5: status,
    details,
  };
};

/**
 * Simpan data (create baru atau update existing)
 */
const saveData = async (payload, user, existingNomor = null) => {
  const { jenis, tanggal, keterangan, bpbNomor, supKode, details } = payload;

  if (!PREFIX_MAP[jenis]) throw new Error("Jenis tidak valid.");

  // ⚠️ Baris jumlah=0 di-DROP diam-diam dari insert (bukan error per-baris),
  // tapi TOTAL qty keseluruhan wajib >0. Persis replikasi Delphi.
  const filled = (details || []).filter(
    (d) => d.kode && d.kode.trim() !== "" && Number(d.jumlah) !== 0,
  );
  const totalQty = filled.reduce((s, d) => s + Number(d.jumlah || 0), 0);
  if (totalQty === 0) {
    throw new Error("Qty Retur 0 semua , tidak bisa di simpan.");
  }

  const isEdit = !!existingNomor;

  let statusPin5 = "";
  let urutPin5 = 0;
  if (isEdit) {
    const resolved = await resolveEditStatus(existingNomor, tanggal);
    statusPin5 = resolved.status;
    urutPin5 = resolved.urut;
  }

  await checkCanSave(tanggal, statusPin5);

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    let nomor = existingNomor;

    if (isEdit) {
      // ⚠️ HANYA rb_tanggal & rb_keterangan yang bisa diubah — rb_bpb_nomor,
      // rb_cab, rb_sup_kode immutable setelah create (sesuai simpandata Delphi)
      await conn.query(
        `UPDATE tgarmenrb_hdr SET
           rb_tanggal = ?, rb_keterangan = ?,
           date_modified = NOW(), user_modified = ?
         WHERE rb_nomor = ?`,
        [tanggal, keterangan || "", user.kode, nomor],
      );
    } else {
      if (!bpbNomor) throw new Error("Nomor BPB wajib diisi.");

      const tahun = new Date(tanggal).getFullYear().toString();
      nomor = await generateNomor(conn, jenis, tahun);

      await conn.query(
        `INSERT INTO tgarmenrb_hdr
           (rb_jenis, rb_nomor, rb_tanggal, rb_bpb_nomor, rb_keterangan, rb_cab, rb_bagian, rb_sup_kode, date_create, user_create)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?)`,
        [
          jenis,
          nomor,
          tanggal,
          bpbNomor,
          keterangan || "",
          user.cabang,
          user.bagian,
          supKode || "",
          user.kode,
        ],
      );
    }

    await conn.query(`DELETE FROM tgarmenrb_dtl WHERE rbd_nomor = ?`, [nomor]);

    let urut = 0;
    for (const d of filled) {
      urut += 1;
      await conn.query(
        `INSERT INTO tgarmenrb_dtl (rbd_nomor, rbd_brg_kode, rbd_jumlah, rbd_nourut)
         VALUES (?, ?, ?, ?)`,
        [nomor, d.kode, Number(d.jumlah), urut],
      );
    }

    if (isEdit && statusPin5 === "ACC") {
      await conn.query(
        `UPDATE tspk_pin5 SET pin_dipakai = "Y"
         WHERE pin_trs = "RB GARMEN" AND pin_nomor = ? AND pin_urut = ?`,
        [nomor, urutPin5],
      );
    }

    await conn.commit();
    return nomor;
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
};

// ── Data untuk halaman cetak ──
const getDataCetak = async (nomor) => {
  const [[header]] = await db.query(
    `SELECT h.rb_nomor, h.rb_jenis, h.rb_tanggal, h.rb_keterangan,
       h.rb_sup_kode, s.sup_nama, s.sup_alamat, s.sup_kota,
       p.perush_nama, p.perush_alamat, p.perush_telp
     FROM tgarmenrb_hdr h
     LEFT JOIN tsupplier s ON s.sup_kode = h.rb_sup_kode
     LEFT JOIN tperusahaan p ON p.perush_kode = "KP"
     WHERE h.rb_nomor = ?`,
    [nomor],
  );
  if (!header) throw new Error("Data tidak ditemukan.");

  const [detail] = await db.query(
    `SELECT d.rbd_brg_kode AS Kode,
       IF(b.brg_note = "", b.brg_nama, CONCAT(b.brg_nama, " - ", b.brg_note)) AS Nama,
       b.brg_satuan AS Satuan, d.rbd_jumlah AS Jumlah
     FROM tgarmenrb_dtl d
     LEFT JOIN tgarmen_brg b ON b.brg_kode = d.rbd_brg_kode
     WHERE d.rbd_nomor = ?
     ORDER BY d.rbd_nourut`,
    [nomor],
  );

  return { header, detail };
};

module.exports = {
  getFormData,
  saveData,
  searchBpb,
  resolveBpb,
  getDataCetak,
};
