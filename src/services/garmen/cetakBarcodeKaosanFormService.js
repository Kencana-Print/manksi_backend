const db = require("../../config/database");

// ============================================================
// CETAK BARCODE KAOSAN — FORM SERVICE
// Replikasi ufrmBcd.pas. Header: tbarcode_hdr, Detail: tbarcode_dtl.
// Field CDS Delphi: kode (SPK nomor ATAU kode kaosan dasar — dua-duanya
// dipakai sebagai bcd_spk_nomor), kodek (kode item/variant — bcd_kode),
// tglspk, barcode, nama, ukuran, order (qty referensi, tidak disimpan),
// awal, akhir, jumlah, harga (referensi print, tidak disimpan), cetak,
// packing, kodex (duplikat kode, tidak dipakai backend).
// ============================================================

// ─────────────────────────────────────────────
// GENERATE NOMOR — format BCD.{yymm}{00001}, replikasi getmaxnomor()
// ─────────────────────────────────────────────
const getMaxNomor = async (conn, tanggal) => {
  const d = new Date(tanggal);
  const yy = String(d.getFullYear()).slice(-2);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const prefix = `BCD.${yy}${mm}`; // 8 karakter: "BCD." + yymm

  const [rows] = await conn.query(
    `SELECT IFNULL(MAX(RIGHT(bch_nomor, 5)), 0) AS jumlah
     FROM tbarcode_hdr
     WHERE LEFT(bch_nomor, 8) = ?
     FOR UPDATE`,
    [prefix],
  );
  const next = Number(rows[0].jumlah) + 1;
  return `${prefix}${String(next).padStart(5, "0")}`;
};

// ─────────────────────────────────────────────
// GET DETAIL — mode Ubah, replikasi loaddataall()
// ⚠️ Field 'nama' berbeda sumber tergantung divisi SPK: divisi 4
// (Garmen) pakai spk_nama, selain itu (divisi 3/Kaosan) pakai nama
// hasil CONCAT dari retail.tbarangdc — replikasi persis kondisi
// `if spk_divisi=4 then spk_nama else nama` di Delphi.
// ─────────────────────────────────────────────
const getDetail = async (nomor) => {
  const [headerRows] = await db.query(
    `SELECT bch_nomor AS nomor,
            DATE_FORMAT(bch_tanggal, '%Y-%m-%d') AS tanggal,
            bch_cab AS cab,
            bch_bs AS bs
     FROM tbarcode_hdr
     WHERE bch_nomor = ?`,
    [nomor],
  );
  if (headerRows.length === 0) return null;

  const [rows] = await db.query(
    `SELECT
       d.bcd_nourut,
       d.bcd_spk_nomor AS kode,
       d.bcd_kode AS kodek,
       d.bcd_ukuran AS ukuran,
       d.bcd_awal AS awal,
       d.bcd_akhir AS akhir,
       d.bcd_jumlah AS jumlah,
       d.bcd_packing AS packing,
       s.spk_nama AS spkNama,
       s.spk_divisi AS spkDivisi,
       DATE_FORMAT(s.spk_tanggal, '%Y-%m-%d') AS tglspk,
       CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna) AS namaKaosan,
       IF(b.brgd_barcode IS NULL, z.spks_barcode, b.brgd_barcode) AS barcode,
       IFNULL(b.brgd_harga, 0) AS harga,
       IF(c.spkd_qtyorder IS NULL, z.spks_qty, c.spkd_qtyorder) AS qtyorder,
       (SELECT COUNT(*) FROM retail.tbarangdc_unit u
          WHERE u.unit_bcd_nomor = d.bcd_nomor AND u.unit_bcd_nourut = d.bcd_nourut) AS sudahCetak
     FROM tbarcode_dtl d
     LEFT JOIN retail.tbarangdc a ON a.brg_kode = d.bcd_kode
     LEFT JOIN retail.tbarangdc_dtl b ON b.brgd_kode = d.bcd_kode AND b.brgd_ukuran = d.bcd_ukuran
     LEFT JOIN tspk_dc c ON c.spkd_nomor = d.bcd_spk_nomor AND c.spkd_ukuran = d.bcd_ukuran
     LEFT JOIN tspk_size z ON z.spks_nomor = d.bcd_spk_nomor AND z.spks_size = d.bcd_ukuran
     LEFT JOIN tspk s ON s.spk_nomor = d.bcd_spk_nomor
     WHERE d.bcd_nomor = ?
     ORDER BY d.bcd_nourut`,
    [nomor],
  );

  const [bsRows] = await db.query(
    `SELECT bcb_nourut, bcb_grade, bcb_jumlah FROM tbarcode_dtl_bs WHERE bcb_nomor = ?`,
    [nomor],
  );
  const bsMap = new Map(
    bsRows.map((r) => [`${r.bcb_nourut}|${r.bcb_grade}`, Number(r.bcb_jumlah)]),
  );
  const isBs = Number(headerRows[0].bs) === 1;

  const detail = rows.map((r) => {
    const barcode = r.barcode || "";
    const jumlah = Number(r.jumlah) || 0;
    const bsA = bsMap.get(`${r.bcd_nourut}|A`) || 0;
    const bsB = bsMap.get(`${r.bcd_nourut}|B`) || 0;
    const bsC = bsMap.get(`${r.bcd_nourut}|C`) || 0;
    return {
      kode: r.kode || "",
      kodek: r.kodek || "",
      tglspk: r.tglspk || "",
      barcode,
      nama: Number(r.spkDivisi) === 4 ? r.spkNama || "" : r.namaKaosan || "",
      ukuran: r.ukuran || "",
      order: Number(r.qtyorder) || 0,
      awal: Number(r.awal) || 0,
      akhir: Number(r.akhir) || 0,
      jumlah,
      good: isBs ? jumlah - bsA - bsB - bsC : jumlah,
      bsA,
      bsB,
      bsC,
      harga: Number(r.harga) || 0,
      cetak: barcode !== "",
      packing: r.packing || "",
      // baris yang sudah tersimpan dianggap sudah tercetak (kunci Awal /
      // batas bawah Akhir), tidak lagi bergantung pada tabel unit
      sudahCetak: Math.max(
        Number(r.sudahCetak) || 0,
        Number(r.awal) > 0 ? jumlah : 0,
      ),
    };
  });

  return { header: { ...headerRows[0], bs: isBs }, detail };
};

const searchKaosanMaster = async (keyword = "", limit = 50) => {
  const like = `%${keyword}%`;
  const [rows] = await db.query(
    `SELECT a.brg_kode AS Kode,
            TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)) AS Nama
     FROM retail.tbarangdc a
     WHERE a.brg_aktif = 0 AND a.brg_logstok = 'Y'
       AND (a.brg_kode LIKE ? OR TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)) LIKE ?)
     ORDER BY Nama
     LIMIT ?`,
    [like, like, Number(limit)],
  );
  return rows;
};

// ─────────────────────────────────────────────
// LOOKUP SPK (F1) — replikasi loadbrg(). Cabang query beda tergantung
// spk_divisi: 3 (Kaosan) pakai tspk_dc, selain itu (4/6, Garmen) pakai
// tspk_size. Dedup (kode+kodek+ukuran sudah ada di grid) TIDAK di sini
// — itu tanggung jawab frontend karena tergantung state grid saat ini.
// ─────────────────────────────────────────────
const lookupSpk = async (nomor) => {
  const [spkRows] = await db.query(
    `SELECT spk_nomor, spk_divisi, DATE_FORMAT(spk_tanggal, '%Y-%m-%d') AS spk_tanggal
     FROM tspk
     WHERE spk_aktif = 'Y' AND spk_divisi IN (3, 4, 6) AND spk_nomor = ?`,
    [nomor],
  );
  if (spkRows.length === 0) {
    return { exists: false, error: "Spk tsb tidak ada." };
  }
  const spk = spkRows[0];
  const isDivisi3 = Number(spk.spk_divisi) === 3;

  let rows;
  if (isDivisi3) {
    [rows] = await db.query(
      `SELECT i.spkd_nomor AS kode, i.spkd_kode AS kodek,
              i.spkd_ukuran AS ukuran, i.spkd_qtyorder AS qtyorder,
              CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna) AS nama,
              b.brgd_barcode AS barcode, b.brgd_harga AS harga
       FROM tspk_dc i
       LEFT JOIN retail.tbarangdc a ON a.brg_kode = i.spkd_kode
       LEFT JOIN retail.tbarangdc_dtl b ON b.brgd_kode = i.spkd_kode AND b.brgd_ukuran = i.spkd_ukuran
       LEFT JOIN retail.tukuran u ON u.ukuran = i.spkd_ukuran AND u.kategori = ""
       WHERE i.spkd_nomor = ?
       ORDER BY u.kode`,
      [nomor],
    );
  } else {
    [rows] = await db.query(
      `SELECT s.spk_nomor AS kode, '' AS kodek, s.spk_nama AS nama,
              IFNULL(z.spks_size, '') AS ukuran,
              IFNULL(z.spks_barcode, '') AS barcode,
              IFNULL(z.spks_qty, 0) AS qtyorder,
              0 AS harga
       FROM tspk s
       LEFT JOIN tspk_size z ON z.spks_nomor = s.spk_nomor
       LEFT JOIN retail.tukuran u ON u.ukuran = z.spks_size AND u.kategori = ""
       WHERE s.spk_nomor = ?
       ORDER BY u.kode`,
      [nomor],
    );
  }

  // BARU: ambil nomor urut terakhir yang sudah tercetak per
  // kode+ukuran untuk SPK ini, buat saran otomatis 'Awal'
  const [nextAwalRows] = await db.query(
    `SELECT bcd_kode AS unit_kode, bcd_ukuran AS unit_ukuran,
            MAX(bcd_akhir) AS lastUrut
     FROM tbarcode_dtl
     WHERE bcd_spk_nomor = ?
     GROUP BY bcd_kode, bcd_ukuran`,
    [nomor],
  );
  const nextAwalMap = new Map(
    nextAwalRows.map((r) => [
      `${r.unit_kode}|${r.unit_ukuran}`,
      Number(r.lastUrut) + 1,
    ]),
  );

  const items = rows.map((r) => ({
    kode: r.kode,
    kodek: r.kodek || "",
    tglspk: spk.spk_tanggal || "",
    barcode: r.barcode || "",
    nama: r.nama || "",
    ukuran: r.ukuran || "",
    order: Number(r.qtyorder) || 0,
    harga: Number(r.harga) || 0,
    cetak: (r.barcode || "") !== "",
    nextAwal: nextAwalMap.get(`${r.kodek || ""}|${r.ukuran || ""}`) || 1,
  }));

  return { exists: true, spkNomor: nomor, spkDivisi: spk.spk_divisi, items };
};

// ─────────────────────────────────────────────
// LOOKUP KODE KAOSAN (F2) — replikasi loadkaos(). Semua item hasil
// query di-set kode=kodek=kodex=parameter `kode` (base code) — replika
// persis Delphi (bukan brgd_kode per baris, tapi anomor itu sendiri).
// ─────────────────────────────────────────────
const lookupKodeKaosan = async (kode) => {
  const [rows] = await db.query(
    `SELECT b.brgd_barcode AS barcode,
            TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)) AS nama,
            b.brgd_ukuran AS ukuran, b.brgd_harga AS harga
     FROM retail.tbarangdc_dtl b
     INNER JOIN retail.tbarangdc a ON a.brg_kode = b.brgd_kode
     LEFT JOIN retail.tukuran u ON u.ukuran = b.brgd_ukuran AND u.kategori = ""
     WHERE b.brgd_kode = ?
     ORDER BY u.kode`,
    [kode],
  );

  // BARU: nomor urut terakhir per ukuran untuk kode ini (di jalur F2,
  // kode dipakai sebagai unit_kode DAN unit_spk_nomor sekaligus)
  const [nextAwalRows] = await db.query(
    `SELECT bcd_ukuran AS unit_ukuran, MAX(bcd_akhir) AS lastUrut
     FROM tbarcode_dtl
     WHERE bcd_spk_nomor = ? AND bcd_kode = ?
     GROUP BY bcd_ukuran`,
    [kode, kode],
  );
  const nextAwalMap = new Map(
    nextAwalRows.map((r) => [r.unit_ukuran, Number(r.lastUrut) + 1]),
  );

  const items = rows.map((r) => ({
    kode,
    kodek: kode,
    tglspk: "",
    barcode: r.barcode || "",
    nama: r.nama || "",
    ukuran: r.ukuran || "",
    order: 0,
    harga: Number(r.harga) || 0,
    cetak: (r.barcode || "") !== "",
    nextAwal: nextAwalMap.get(r.ukuran) || 1,
  }));

  return { items };
};

// ─────────────────────────────────────────────
// LOOKUP BY BARCODE (scan) — replikasi edtBarcodeKeyPress(). Bisa
// return >1 kode dasar kalau barcode itu match ke beberapa brg_kode
// (jarang terjadi, tapi direplikasi apa adanya). Frontend nampilin
// pilihan (kalau >1 distinct Kode), user pilih satu, lalu panggil
// lookupKodeKaosan(kode) — sama seperti alur Delphi (loadkaos setelah
// user pilih dari modal bantu).
// ─────────────────────────────────────────────
const lookupByBarcode = async (barcode) => {
  const [rows] = await db.query(
    `SELECT a.brg_kode AS Kode, b.brgd_barcode AS Barcode,
            TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)) AS Nama,
            b.brgd_ukuran AS Size, b.brgd_harga AS HargaJual
     FROM retail.tbarangdc a
     LEFT JOIN retail.tbarangdc_dtl b ON b.brgd_kode = a.brg_kode
     LEFT JOIN retail.tukuran u ON u.ukuran = b.brgd_ukuran AND u.kategori = ""
     WHERE a.brg_kode IN (
       SELECT i.brgd_kode FROM retail.tbarangdc_dtl i WHERE i.brgd_barcode = ?
     )
     ORDER BY u.kode`,
    [barcode],
  );
  return rows;
};

// ─────────────────────────────────────────────
// BARU: builder format serial unit — {barcode lama SKU-level}.{SPK}.{urut}
// barcode lama (brgd_barcode) sudah merepresentasikan kode+ukuran
// secara unik, jadi tidak perlu ditulis ulang terpisah
// ─────────────────────────────────────────────
const buildUnitSerial = (barcodeLama, spkNomor, urut) => {
  const clean = (s) =>
    String(s || "")
      .trim()
      .toUpperCase()
      .replace(/\s+/g, "");
  return `${clean(barcodeLama)}.${clean(spkNomor)}.${urut}`;
};

// Ambil lock + nomor urut kode BS berikutnya (dipakai Simpan dan Preview)
const buatSiapkan = (conn, seq, tandaiLock) => async () => {
  if (seq.siap) return;
  const [[l]] = await conn.query("SELECT GET_LOCK(?, 15) AS ok", [BS_LOCK]);
  if (Number(l.ok) !== 1) {
    throw new Error(
      "Pembuatan kode BS sedang dipakai proses lain. Coba lagi sebentar.",
    );
  }
  tandaiLock();
  seq.yy = String(new Date().getFullYear()).slice(-2);
  // dibaca lewat koneksi lain (data yang sudah commit); urutan berikutnya
  // dihitung di memori selama lock dipegang sampai commit
  const [[mx]] = await db.query(
    `SELECT IFNULL(MAX(CAST(LEFT(brg_kode, 6) AS UNSIGNED)), 0) AS last
     FROM retail.tbarangdc
     WHERE brg_kelompok = 'C' AND LENGTH(brg_kode) = 8 AND RIGHT(brg_kode, 2) = ?`,
    [seq.yy],
  );
  seq.next = Number(mx.last) + 1;
  seq.siap = true;
};

// ─────────────────────────────────────────────
// SAVE DATA — direvisi: generate unit fisik untuk baris cetak=true
// ⚠️ tbarangdc_unit ada di DB retail, WAJIB prefix "retail." di
// setiap query (konteks koneksi default file ini = MANKSI/kencanaprint)
// ─────────────────────────────────────────────
const saveDataUnik = async (payload, user) => {
  const { isEdit, nomor: nomorPayload, tanggal, cab, detail = [] } = payload;

  const validRows = detail.filter((d) => (d.nama || "").trim() !== "");
  if (validRows.length === 0) {
    throw new Error("Detail harus diisi.");
  }
  for (const d of validRows) {
    if (d.cetak) {
      if (Number(d.awal) === 0 || Number(d.akhir) === 0) {
        throw new Error("Awal atau Akhir harus diisi.");
      }
      if (Number(d.awal) > Number(d.akhir)) {
        throw new Error("Awal tidak boleh > Akhir.");
      }
    }
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    let nomor;
    if (isEdit) {
      nomor = nomorPayload;
      const [exist] = await conn.query(
        `SELECT bch_nomor FROM tbarcode_hdr WHERE bch_nomor = ? FOR UPDATE`,
        [nomor],
      );
      if (exist.length === 0) throw new Error("Data tidak ditemukan.");

      await conn.query(
        `UPDATE tbarcode_hdr
         SET bch_tanggal = ?, user_modified = ?, date_modified = NOW()
         WHERE bch_nomor = ?`,
        [tanggal, user.kode, nomor],
      );
    } else {
      nomor = await getMaxNomor(conn, tanggal);
      await conn.query(
        `INSERT INTO tbarcode_hdr (bch_nomor, bch_tanggal, bch_cab, user_create, date_create)
         VALUES (?, ?, ?, ?, NOW())`,
        [nomor, tanggal, cab, user.kode],
      );
    }

    // BARU: validasi baris yang sudah punya unit tercetak — Awal
    // tidak boleh digeser, Akhir tidak boleh dikurangi di bawah
    // jumlah yang sudah ada (mencegah serial lama jadi salah makna)
    const [existingUnitsAll] = await conn.query(
      `SELECT unit_bcd_nourut, unit_bcd_posisi, unit_serial
         FROM retail.tbarangdc_unit
         WHERE unit_bcd_nomor = ?`,
      [nomor],
    );
    const perNourut = new Map();
    for (const u of existingUnitsAll) {
      const entry = perNourut.get(u.unit_bcd_nourut) || {
        count: 0,
        awalPosisi1: null,
      };
      entry.count++;
      if (u.unit_bcd_posisi === 1) {
        const parts = String(u.unit_serial).split(".");
        const urut = parseInt(parts[parts.length - 1], 10);
        if (!isNaN(urut)) entry.awalPosisi1 = urut;
      }
      perNourut.set(u.unit_bcd_nourut, entry);
    }

    for (let i = 0; i < detail.length; i++) {
      const d = detail[i];
      if ((d.nama || "").trim() === "") continue;
      const bcdNourut = i + 1;
      const existing = perNourut.get(bcdNourut);
      if (!existing || existing.count === 0) continue;

      const newAwal = Number(d.awal) || 0;
      const newAkhir = Number(d.akhir) || 0;
      const newJumlah = newAkhir - newAwal + 1;

      if (existing.awalPosisi1 !== null && newAwal !== existing.awalPosisi1) {
        throw new Error(
          `Baris "${d.nama}" (${d.ukuran}) sudah punya ${existing.count} unit tercetak mulai dari No Urut ${existing.awalPosisi1} — nilai Awal tidak boleh diubah.`,
        );
      }
      if (newJumlah < existing.count) {
        throw new Error(
          `Baris "${d.nama}" (${d.ukuran}) sudah punya ${existing.count} unit tercetak — Akhir tidak boleh dikurangi sampai jumlahnya di bawah itu.`,
        );
      }
    }

    await conn.query(`DELETE FROM tbarcode_dtl WHERE bcd_nomor = ?`, [nomor]);

    const generatedUnits = [];

    for (let i = 0; i < detail.length; i++) {
      const d = detail[i];
      if ((d.nama || "").trim() === "") continue;
      const bcdNourut = i + 1;

      await conn.query(
        `INSERT INTO tbarcode_dtl
           (bcd_nomor, bcd_spk_nomor, bcd_kode, bcd_ukuran, bcd_awal, bcd_akhir, bcd_jumlah, bcd_packing, bcd_nourut)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          nomor,
          d.kode || "",
          d.kodek || "",
          d.ukuran || "",
          Number(d.awal) || 0,
          Number(d.akhir) || 0,
          Number(d.jumlah) || 0,
          d.packing || "",
          bcdNourut,
        ],
      );

      if (!d.cetak) continue;
      const awal = Number(d.awal) || 0;
      const akhir = Number(d.akhir) || 0;
      if (awal === 0 || akhir === 0) continue;

      const [existingUnits] = await conn.query(
        `SELECT unit_serial, unit_bcd_posisi FROM retail.tbarangdc_unit
         WHERE unit_bcd_nomor = ? AND unit_bcd_nourut = ?`,
        [nomor, bcdNourut],
      );
      const existingByPosisi = new Map(
        existingUnits.map((u) => [u.unit_bcd_posisi, u.unit_serial]),
      );

      const posisiList = [];
      for (let p = 1; p <= akhir - awal + 1; p++) posisiList.push(p);

      const toInsert = [];
      for (const posisi of posisiList) {
        if (existingByPosisi.has(posisi)) {
          generatedUnits.push({
            bcdNourut,
            kode: d.kode,
            kodek: d.kodek,
            ukuran: d.ukuran,
            nama: d.nama,
            harga: d.harga,
            tglspk: d.tglspk,
            unit_serial: existingByPosisi.get(posisi),
            posisi,
          });
          continue;
        }
        const urutLabel = awal + posisi - 1; // nilai "No Urut" yang dicetak di label
        const serial = buildUnitSerial(d.barcode, d.kode, urutLabel);
        toInsert.push({ posisi, serial, urutLabel });
      }

      if (toInsert.length === 0) continue;

      const serials = toInsert.map((t) => t.serial);
      const [clash] = await conn.query(
        `SELECT unit_serial FROM retail.tbarangdc_unit WHERE unit_serial IN (?)`,
        [serials],
      );
      if (clash.length > 0) {
        throw new Error(
          `Nomor urut sudah pernah dicetak sebelumnya untuk ${d.kodek} / ${d.kode} / ${d.ukuran}: ` +
            clash.map((c) => c.unit_serial).join(", ") +
            `. Cek nomor urut terakhir yang sudah dicetak untuk kombinasi ini.`,
        );
      }

      for (const t of toInsert) {
        await conn.query(
          `INSERT INTO retail.tbarangdc_unit
             (unit_serial, unit_kode, unit_ukuran, unit_bcd_nomor, unit_bcd_nourut, unit_bcd_posisi,
              unit_spk_nomor, unit_status, user_create, date_create)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'DICETAK', ?, NOW())`,
          [
            t.serial,
            d.kodek,
            d.ukuran,
            nomor,
            bcdNourut,
            t.posisi,
            d.kode,
            user.kode,
          ],
        );
        generatedUnits.push({
          bcdNourut,
          kode: d.kode,
          kodek: d.kodek,
          ukuran: d.ukuran,
          nama: d.nama,
          harga: d.harga,
          tglspk: d.tglspk,
          unit_serial: t.serial,
          posisi: t.posisi,
        });
      }
    }

    await conn.commit();
    return { nomor, units: generatedUnits };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
};

// ─────────────────────────────────────────────
// PREVIEW UNITS (read-only) — ⚠️ sama, wajib prefix "retail."
// ─────────────────────────────────────────────
const previewUnitsUnik = async (payload) => {
  const { nomor: nomorPayload, detail = [] } = payload;
  const result = [];

  for (let i = 0; i < detail.length; i++) {
    const d = detail[i];
    if ((d.nama || "").trim() === "" || !d.cetak) continue;
    const awal = Number(d.awal) || 0;
    const akhir = Number(d.akhir) || 0;
    if (awal === 0 || akhir === 0 || awal > akhir) continue;
    const bcdNourut = i + 1;

    let existingByPosisi = new Map();
    if (nomorPayload) {
      const [existingUnits] = await db.query(
        `SELECT unit_serial, unit_bcd_posisi FROM retail.tbarangdc_unit
         WHERE unit_bcd_nomor = ? AND unit_bcd_nourut = ?`,
        [nomorPayload, bcdNourut],
      );
      existingByPosisi = new Map(
        existingUnits.map((u) => [u.unit_bcd_posisi, u.unit_serial]),
      );
    }

    for (let posisi = 1; posisi <= akhir - awal + 1; posisi++) {
      if (existingByPosisi.has(posisi)) {
        result.push({
          bcdNourut,
          kode: d.kode,
          kodek: d.kodek,
          ukuran: d.ukuran,
          nama: d.nama,
          harga: d.harga,
          tglspk: d.tglspk,
          unit_serial: existingByPosisi.get(posisi),
          posisi,
          isConflict: false,
        });
        continue;
      }
      const urutLabel = awal + posisi - 1;
      const serial = buildUnitSerial(d.barcode, d.kode, urutLabel);

      const [clash] = await db.query(
        `SELECT 1 FROM retail.tbarangdc_unit WHERE unit_serial = ? LIMIT 1`,
        [serial],
      );

      result.push({
        bcdNourut,
        kode: d.kode,
        kodek: d.kodek,
        ukuran: d.ukuran,
        nama: d.nama,
        harga: d.harga,
        tglspk: d.tglspk,
        unit_serial: serial,
        posisi,
        isConflict: clash.length > 0,
      });
    }
  }

  return result;
};

// ─────────────────────────────────────────────
// BARANG BS — QR sementara = barcode biasa (belum unik)
// ─────────────────────────────────────────────
const UNIK_AKTIF = false; // true = serial unik + retail.tbarangdc_unit (kode lama)
const GRADE_LIST = ["A", "B", "C"];
const BS_KTGP = "REJECT";
const BS_LOCK = "manksi_kode_bs";

// Hitung jumlah & rentang nomor urut satu baris. Mode BS: server yang
// menghitung Akhir = Awal + (Good + A + B + C) - 1; urutan Good → A → B → C.
const hitungBaris = (d, isBs) => {
  const awal = Number(d.awal) || 0;
  if (!isBs) {
    const akhir = Number(d.akhir) || 0;
    const total = akhir - awal + 1;
    return { good: total, bs: { A: 0, B: 0, C: 0 }, total, awal, akhir };
  }
  const angka = (v, label) => {
    const n = Number(v || 0);
    if (!Number.isInteger(n) || n < 0) {
      throw new Error(
        `Jumlah ${label} harus bilangan bulat >= 0 ("${d.nama}" ${d.ukuran}).`,
      );
    }
    return n;
  };
  const good = angka(d.good, "Good");
  const bs = {
    A: angka(d.bsA, "RJ A"),
    B: angka(d.bsB, "RJ B"),
    C: angka(d.bsC, "RJ C"),
  };
  const total = good + bs.A + bs.B + bs.C;
  return { good, bs, total, awal, akhir: awal + total - 1 };
};

// Nomor dokumen lain yang rentang nomor urutnya bertabrakan (SPK + kode + ukuran sama)
const cariTumpangTindih = async (q, nomor, d, awal, akhir) => {
  const [rows] = await q.query(
    `SELECT bcd_nomor FROM tbarcode_dtl
     WHERE bcd_spk_nomor = ? AND bcd_kode = ? AND bcd_ukuran = ?
       AND bcd_nomor <> ? AND bcd_awal > 0
       AND bcd_awal <= ? AND bcd_akhir >= ?
     LIMIT 1`,
    [d.kode || "", d.kodek || "", d.ukuran || "", nomor || "", akhir, awal],
  );
  return rows.length ? rows[0].bcd_nomor : null;
};

// Susun unit cetak satu baris: Good dulu, lalu A, B, C.
// unit_serial = isi QR (sementara = kode barang), urut = nomor urut di label.
const susunUnit = (d, bcdNourut, hit, kodeBs) => {
  const hasil = [];
  let urut = hit.awal;
  let posisi = 0;
  const tambah = (jumlah, grade, kodeBarang) => {
    for (let i = 0; i < jumlah; i++) {
      posisi++;
      hasil.push({
        bcdNourut,
        kode: d.kode,
        kodek: d.kodek,
        ukuran: d.ukuran,
        nama: d.nama,
        harga: d.harga,
        tglspk: d.tglspk,
        grade,
        kodeBarang,
        unit_serial: kodeBarang,
        urut,
        posisi,
      });
      urut++;
    }
  };
  tambah(hit.good, "", d.barcode || "");
  for (const g of GRADE_LIST) tambah(hit.bs[g], g, kodeBs[g] || "");
  return hasil;
};

// Kode BS: dipakai ulang bila SPK + kode + ukuran + grade sudah punya kode;
// kalau belum, buat kode retail baru (6 digit urut + 2 digit tahun, kelompok C)
const pastikanKodeBs = async (
  conn,
  seq,
  siapkan,
  d,
  grade,
  tanggalDok,
  user,
) => {
  const kunci = [d.kode || "", d.kodek || "", d.ukuran || "", grade];
  const [ada] = await conn.query(
    `SELECT bsk_kode_bs FROM tbarcode_bs_kode
     WHERE bsk_spk_nomor = ? AND bsk_kode = ? AND bsk_ukuran = ? AND bsk_grade = ?
     FOR UPDATE`,
    kunci,
  );
  if (ada.length) return ada[0].bsk_kode_bs;

  await siapkan();

  const [dasar] = await conn.query(
    `SELECT b.brgd_hpp
     FROM retail.tbarangdc a
     INNER JOIN retail.tbarangdc_dtl b
       ON b.brgd_kode = a.brg_kode AND b.brgd_ukuran = ?
     WHERE a.brg_kode = ?`,
    [d.ukuran || "", d.kodek || ""],
  );
  if (!dasar.length) {
    throw new Error(
      `Master barang ${d.kodek} ukuran ${d.ukuran} tidak ada di retail — kode BS tidak bisa dibuat.`,
    );
  }

  const kodeBs = `${String(seq.next).padStart(6, "0")}${seq.yy}`;
  seq.next++;

  await conn.query(
    `INSERT INTO retail.tbarangdc
       (brg_kode, brg_ktgp, brg_ktg, brg_bahan, brg_jeniskaos, brg_tipe,
        brg_lengan, brg_jeniskain, brg_warna, brg_aktif, brg_katalog,
        brg_logstok, brg_kelompok, user_create, date_create)
     SELECT ?, ?, brg_ktg, brg_bahan, brg_jeniskaos, brg_tipe,
            brg_lengan, brg_jeniskain, brg_warna, 0, 0, 'Y', 'C', ?, NOW()
     FROM retail.tbarangdc WHERE brg_kode = ?`,
    [kodeBs, BS_KTGP, user.kode, d.kodek],
  );
  await conn.query(
    `INSERT INTO retail.tbarangdc_dtl
       (brgd_kode, brgd_ukuran, brgd_hpp, brgd_harga, brgd_barcode,
        brgd_spk_tanggal, brgd_produksi)
     VALUES (?, ?, ?, 0, ?, ?, ?)`,
    [
      kodeBs,
      d.ukuran || "",
      Number(dasar[0].brgd_hpp) || 0,
      kodeBs,
      d.tglspk || null,
      tanggalDok,
    ],
  );
  await conn.query(
    `INSERT INTO tbarcode_bs_kode
       (bsk_spk_nomor, bsk_kode, bsk_ukuran, bsk_grade, bsk_kode_bs, user_create, date_create)
     VALUES (?, ?, ?, ?, ?, ?, NOW())`,
    [...kunci, kodeBs, user.kode],
  );
  return kodeBs;
};

// ─────────────────────────────────────────────
// SAVE DATA (versi QR biasa + barang BS)
// ─────────────────────────────────────────────
const saveData = async (payload, user) => {
  if (UNIK_AKTIF) return saveDataUnik(payload, user);

  const {
    isEdit,
    nomor: nomorPayload,
    tanggal,
    cab,
    bs = false,
    detail = [],
  } = payload;

  const baris = detail
    .map((d, i) => ({ d, bcdNourut: i + 1 }))
    .filter(({ d }) => (d.nama || "").trim() !== "");
  if (baris.length === 0) throw new Error("Detail harus diisi.");

  const conn = await db.getConnection();
  let lockBs = false;
  try {
    await conn.beginTransaction();

    let nomor;
    let isBs = Boolean(bs);
    if (isEdit) {
      nomor = nomorPayload;
      const [exist] = await conn.query(
        `SELECT bch_bs FROM tbarcode_hdr WHERE bch_nomor = ? FOR UPDATE`,
        [nomor],
      );
      if (exist.length === 0) throw new Error("Data tidak ditemukan.");
      isBs = Number(exist[0].bch_bs) === 1; // jenis dokumen tidak bisa diganti
      await conn.query(
        `UPDATE tbarcode_hdr
         SET bch_tanggal = ?, user_modified = ?, date_modified = NOW()
         WHERE bch_nomor = ?`,
        [tanggal, user.kode, nomor],
      );
    } else {
      nomor = await getMaxNomor(conn, tanggal);
      await conn.query(
        `INSERT INTO tbarcode_hdr (bch_nomor, bch_tanggal, bch_cab, bch_bs, user_create, date_create)
         VALUES (?, ?, ?, ?, ?, NOW())`,
        [nomor, tanggal, cab, isBs ? 1 : 0, user.kode],
      );
    }

    // 1) hitung + validasi tiap baris yang dicetak
    const hitung = new Map();
    for (const { d, bcdNourut } of baris) {
      if (!d.cetak) continue;
      const hit = hitungBaris(d, isBs);
      const label = `"${d.nama}" (${d.ukuran})`;
      if (isBs) {
        if (!hit.awal) throw new Error(`Awal harus diisi untuk ${label}.`);
      } else {
        if (!hit.awal || !hit.akhir) {
          throw new Error("Awal atau Akhir harus diisi.");
        }
        if (hit.awal > hit.akhir) throw new Error("Awal tidak boleh > Akhir.");
      }
      if (hit.total <= 0) throw new Error(`Jumlah belum diisi untuk ${label}.`);
      if (!d.barcode) throw new Error(`Barcode kosong untuk ${label}.`);

      const bentrok = await cariTumpangTindih(
        conn,
        nomor,
        d,
        hit.awal,
        hit.akhir,
      );
      if (bentrok) {
        throw new Error(
          `Nomor urut ${hit.awal}-${hit.akhir} untuk ${d.kodek} / ${d.kode} / ${d.ukuran} sudah dipakai di dokumen ${bentrok}.`,
        );
      }
      hitung.set(bcdNourut, hit);
    }

    // 2) BS hanya untuk SPK Kaosan (divisi 3)
    if (isBs) {
      const spkList = [
        ...new Set(
          baris.filter(({ d }) => d.cetak).map(({ d }) => d.kode || ""),
        ),
      ];
      if (spkList.length) {
        const [ok] = await conn.query(
          `SELECT spk_nomor FROM tspk
           WHERE spk_aktif = 'Y' AND spk_divisi = 3 AND spk_nomor IN (?)`,
          [spkList],
        );
        const okSet = new Set(ok.map((r) => r.spk_nomor));
        const salah = spkList.filter((s) => !okSet.has(s));
        if (salah.length) {
          throw new Error(
            `Barang BS hanya untuk SPK Kaosan (divisi 3). Tidak memenuhi: ${salah.join(", ")}`,
          );
        }
      }
    }

    // 3) baris yang sudah tersimpan: Awal terkunci; dokumen biasa tidak boleh
    //    dikurangi; dokumen BS jumlah Good/A/B/C terkunci (tambahan = dokumen baru)
    const [lama] = await conn.query(
      `SELECT bcd_nourut, bcd_spk_nomor, bcd_kode, bcd_ukuran, bcd_awal, bcd_jumlah
       FROM tbarcode_dtl WHERE bcd_nomor = ? AND bcd_awal > 0`,
      [nomor],
    );
    const bsLama = new Map();
    if (isBs) {
      const [b] = await conn.query(
        `SELECT bcb_nourut, bcb_grade, bcb_jumlah FROM tbarcode_dtl_bs WHERE bcb_nomor = ?`,
        [nomor],
      );
      for (const r of b) {
        bsLama.set(`${r.bcb_nourut}|${r.bcb_grade}`, Number(r.bcb_jumlah));
      }
    }
    for (const lm of lama) {
      const hit = hitung.get(Number(lm.bcd_nourut));
      const baru = baris.find(
        ({ bcdNourut }) => bcdNourut === Number(lm.bcd_nourut),
      );
      if (!hit || !baru) continue;
      const { d } = baru;
      const barisSama =
        (d.kode || "") === lm.bcd_spk_nomor &&
        (d.kodek || "") === lm.bcd_kode &&
        (d.ukuran || "") === lm.bcd_ukuran;
      if (!barisSama) continue;

      const label = `Baris "${d.nama}" (${d.ukuran})`;
      if (hit.awal !== Number(lm.bcd_awal)) {
        throw new Error(
          `${label} sudah tersimpan mulai dari No Urut ${lm.bcd_awal} — nilai Awal tidak boleh diubah.`,
        );
      }
      if (isBs) {
        const lamaGrade = (g) => bsLama.get(`${lm.bcd_nourut}|${g}`) || 0;
        const goodLama =
          Number(lm.bcd_jumlah) -
          GRADE_LIST.reduce((s, g) => s + lamaGrade(g), 0);
        const berubah =
          hit.good !== goodLama ||
          GRADE_LIST.some((g) => hit.bs[g] !== lamaGrade(g));
        if (berubah) {
          throw new Error(
            `${label} sudah tersimpan — jumlah Good/BS tidak boleh diubah. Buat dokumen baru untuk tambahan.`,
          );
        }
      } else if (hit.total < Number(lm.bcd_jumlah)) {
        throw new Error(
          `${label} sudah tersimpan ${lm.bcd_jumlah} unit — Akhir tidak boleh dikurangi.`,
        );
      }
    }

    // 4) tulis ulang detail (+ detail BS) dan buat kode BS bila perlu
    await conn.query(`DELETE FROM tbarcode_dtl WHERE bcd_nomor = ?`, [nomor]);
    await conn.query(`DELETE FROM tbarcode_dtl_bs WHERE bcb_nomor = ?`, [
      nomor,
    ]);

    const seq = { siap: false, next: 0, yy: "" };
    const siapkan = buatSiapkan(conn, seq, () => {
      lockBs = true;
    });

    const units = [];
    for (const { d, bcdNourut } of baris) {
      const hit = hitung.get(bcdNourut);
      await conn.query(
        `INSERT INTO tbarcode_dtl
           (bcd_nomor, bcd_spk_nomor, bcd_kode, bcd_ukuran, bcd_awal, bcd_akhir, bcd_jumlah, bcd_packing, bcd_nourut)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          nomor,
          d.kode || "",
          d.kodek || "",
          d.ukuran || "",
          hit ? hit.awal : Number(d.awal) || 0,
          hit ? hit.akhir : Number(d.akhir) || 0,
          hit ? hit.total : Number(d.jumlah) || 0,
          d.packing || "",
          bcdNourut,
        ],
      );
      if (!hit) continue;

      const kodeBs = {};
      if (isBs) {
        for (const g of GRADE_LIST) {
          if (!hit.bs[g]) continue;
          kodeBs[g] = await pastikanKodeBs(
            conn,
            seq,
            siapkan,
            d,
            g,
            tanggal,
            user,
          );
          await conn.query(
            `INSERT INTO tbarcode_dtl_bs (bcb_nomor, bcb_nourut, bcb_grade, bcb_jumlah)
             VALUES (?, ?, ?, ?)`,
            [nomor, bcdNourut, g, hit.bs[g]],
          );
        }
      }
      units.push(...susunUnit(d, bcdNourut, hit, kodeBs));
    }

    await conn.commit();
    return { nomor, units };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    if (lockBs) {
      await conn.query("SELECT RELEASE_LOCK(?)", [BS_LOCK]).catch(() => {});
    }
    conn.release();
  }
};

// ─────────────────────────────────────────────
// PREVIEW — dokumen biasa murni baca. Dokumen BS MEMBUAT kode BS sungguhan
// (dipakai ulang oleh Simpan karena kunci SPK+kode+ukuran+grade sama),
// jadi harus dipanggil dengan izin tambah/ubah.
// ─────────────────────────────────────────────
const previewUnits = async (payload, user) => {
  if (UNIK_AKTIF) return previewUnitsUnik(payload);

  const {
    nomor: nomorPayload = "",
    tanggal,
    bs = false,
    detail = [],
  } = payload;
  const isBs = Boolean(bs);
  if (isBs && !tanggal) throw new Error("Tanggal dokumen harus diisi.");

  const baris = [];
  for (let i = 0; i < detail.length; i++) {
    const d = detail[i];
    if ((d.nama || "").trim() === "" || !d.cetak) continue;
    const hit = hitungBaris(d, isBs);
    if (!hit.awal || hit.total <= 0) continue;
    const bentrok = await cariTumpangTindih(
      db,
      nomorPayload,
      d,
      hit.awal,
      hit.akhir,
    );
    baris.push({ d, bcdNourut: i + 1, hit, bentrok });
  }

  // jangan membuat kode BS untuk SPK yang bukan Kaosan (divisi 3)
  if (isBs && baris.length) {
    const spkList = [...new Set(baris.map(({ d }) => d.kode || ""))];
    const [ok] = await db.query(
      `SELECT spk_nomor FROM tspk
       WHERE spk_aktif = 'Y' AND spk_divisi = 3 AND spk_nomor IN (?)`,
      [spkList],
    );
    const okSet = new Set(ok.map((r) => r.spk_nomor));
    const salah = spkList.filter((s) => !okSet.has(s));
    if (salah.length) {
      throw new Error(
        `Barang BS hanya untuk SPK Kaosan (divisi 3). Tidak memenuhi: ${salah.join(", ")}`,
      );
    }
  }

  const hasil = [];
  let conn = null;
  let lockBs = false;
  try {
    if (isBs) {
      conn = await db.getConnection();
      await conn.beginTransaction();
    }
    const seq = { siap: false, next: 0, yy: "" };
    const siapkan = conn
      ? buatSiapkan(conn, seq, () => {
          lockBs = true;
        })
      : null;

    for (const { d, bcdNourut, hit, bentrok } of baris) {
      const kodeBs = {};
      if (isBs) {
        for (const g of GRADE_LIST) {
          if (!hit.bs[g]) continue;
          kodeBs[g] = await pastikanKodeBs(
            conn,
            seq,
            siapkan,
            d,
            g,
            tanggal,
            user,
          );
        }
      }
      for (const u of susunUnit(d, bcdNourut, hit, kodeBs)) {
        hasil.push({ ...u, isConflict: Boolean(bentrok) });
      }
    }

    if (conn) await conn.commit();
    return hasil;
  } catch (err) {
    if (conn) await conn.rollback();
    throw err;
  } finally {
    if (conn) {
      if (lockBs) {
        await conn.query("SELECT RELEASE_LOCK(?)", [BS_LOCK]).catch(() => {});
      }
      conn.release();
    }
  }
};

module.exports = {
  getDetail,
  lookupSpk,
  searchKaosanMaster,
  lookupKodeKaosan,
  lookupByBarcode,
  previewUnits,
  saveData,
};
