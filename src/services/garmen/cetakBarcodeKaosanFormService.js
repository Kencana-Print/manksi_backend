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
            bch_cab AS cab
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

  const detail = rows.map((r) => {
    const barcode = r.barcode || "";
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
      jumlah: Number(r.jumlah) || 0,
      harga: Number(r.harga) || 0,
      cetak: barcode !== "",
      packing: r.packing || "",
      sudahCetak: Number(r.sudahCetak) || 0, // BARU
    };
  });

  return { header: headerRows[0], detail };
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
    `SELECT unit_kode, unit_ukuran,
            MAX(CAST(SUBSTRING_INDEX(unit_serial, '.', -1) AS UNSIGNED)) AS lastUrut
     FROM retail.tbarangdc_unit
     WHERE unit_spk_nomor = ?
     GROUP BY unit_kode, unit_ukuran`,
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
    `SELECT unit_ukuran,
            MAX(CAST(SUBSTRING_INDEX(unit_serial, '.', -1) AS UNSIGNED)) AS lastUrut
     FROM retail.tbarangdc_unit
     WHERE unit_kode = ? AND unit_spk_nomor = ?
     GROUP BY unit_ukuran`,
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

// ─────────────────────────────────────────────
// SAVE DATA — direvisi: generate unit fisik untuk baris cetak=true
// ⚠️ tbarangdc_unit ada di DB retail, WAJIB prefix "retail." di
// setiap query (konteks koneksi default file ini = MANKSI/kencanaprint)
// ─────────────────────────────────────────────
const saveData = async (payload, user) => {
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
const previewUnits = async (payload) => {
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

module.exports = {
  getDetail,
  lookupSpk,
  searchKaosanMaster,
  lookupKodeKaosan,
  lookupByBarcode,
  previewUnits,
  saveData,
};
