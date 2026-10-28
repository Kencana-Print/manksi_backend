// services/ppic/statusBahanMkbHelper.js
// Status Bahan + Estimasi Kedatangan untuk tab Cutting Planning SPK.
// Sumber: MKB atas SO dari SPK tsb. Hanya dibaca, tidak disimpan.
const db = require("../../config/database");

const STATUS_BELUM_MKB = "MKB belum dibuat";

// Dua nilai: Ready / PO. Kondisi lain ditampilkan apa adanya.
const ringkasStatus = (ket) => {
  if (ket === "Stok ready") return "Ready";
  if (/sudah po|kedatangan partial/i.test(ket || "")) return "PO";
  return ket || "";
};

// Kunci pencarian MKB (mkb_spk_nomor) per SPK:
// SPK turunan SO -> hanya SO-nya (tanpa fallback memo / MAP).
// SPK tanpa so_ref -> nomor SPK sendiri, lalu memo.
const buatKunci = (spk, row) => {
  if (row && row.spk_so_ref) return [row.spk_so_ref];
  return [spk, row && row.spk_memo].filter(Boolean);
};

// Logika status disalin dari getBrowseMkb (subquery z), dibatasi per nomor MKB.
// Subquery berkorelasi diganti tabel turunan yang di-agregasi sekali
// dan difilter IN (?) per join supaya index tpo_dtl / tbpb_dtl / tmkb_dtl2 terpakai.
const getKeteranganMkb = async (mkbList) => {
  if (!mkbList.length) return {};
  const P = mkbList;
  const [rows] = await db.query(
    `SELECT z.nomor AS nomor,
       IF((z.readyterima) >= z.butuh, 'Stok ready',
         IF(z.crs = z.item AND z.ready >= z.butuh, 'Stok ready',
           IF(z.crs0 = z.item AND (z.po1 + z.po2) = 0 AND z.terima = 0, 'Belum ready',
             IF(z.crs0 = z.item AND (z.po1 + z.po2) <> 0 AND z.terima = 0, 'Belum ready dan sudah po',
               IF(z.ready < z.butuh AND z.ready <> 0 AND (z.po1 + z.po2) = 0 AND z.terima = 0, 'Ready sebagian dan belum po',
                 IF(z.ready < z.butuh AND z.ready <> 0 AND (z.po1 + z.po2) <> 0 AND z.terima = 0, 'Ready sebagian dan sudah po',
                   IF(z.terima > 0 AND z.readyterima < z.butuh AND z.terima <> 0, 'Belum ready dan kedatangan partial',
                   '')
                 )
               )
             )
           )
         )
       ) AS ket
     FROM (
       SELECT a.nomor, a.butuh, a.ready, a.terima, a.readyterima,
              IFNULL(c.crs0, 0) AS crs0, IFNULL(c.crs, 0) AS crs, IFNULL(c.item, 0) AS item,
              IFNULL(p1.n, 0) AS po1, IFNULL(p2.n, 0) AS po2
       FROM (
         SELECT d.mkbd_mkb_nomor AS nomor,
                SUM(d.mkbd_jumlah) AS butuh,
                SUM(d.mkbd_jumlah_rs) AS ready,
                SUM(IF((IFNULL(tp.qty,0) + IFNULL(nn.qty,0) + IFNULL(lk.qty,0)) > d.mkbd_jumlah,
                       d.mkbd_jumlah,
                       (IFNULL(tp.qty,0) + IFNULL(nn.qty,0) + IFNULL(lk.qty,0)))) AS terima,
                SUM(IF((IFNULL(tp.qty,0) + IFNULL(nn.qty,0) + IFNULL(lk.qty,0) + d.mkbd_jumlah_rs) > d.mkbd_jumlah,
                       d.mkbd_jumlah,
                       (IFNULL(tp.qty,0) + IFNULL(nn.qty,0) + IFNULL(lk.qty,0) + d.mkbd_jumlah_rs))) AS readyterima
         FROM tmkb_dtl d
         LEFT JOIN (
           SELECT p.pod_mkb_nomor AS mkb, p.pod_bhn_kode AS bhn, SUM(i.bpbd2_jumlah) AS qty
           FROM tpo_dtl p
           LEFT JOIN tbpb_dtl2 i ON i.bpbd2_po_nomor = p.pod_po_nomor AND i.bpbd2_nourut = p.pod_nourut
           WHERE p.pod_mkb_nomor IN (?)
           GROUP BY p.pod_mkb_nomor, p.pod_bhn_kode
         ) tp ON tp.mkb = d.mkbd_mkb_nomor AND tp.bhn = d.mkbd_bhn_kode
         LEFT JOIN (
           SELECT bpbd_mkb AS mkb, bpbd_bhn_kode AS bhn, bpbd_nourut AS urut, SUM(bpbd_jumlah) AS qty
           FROM tbpb_dtl
           WHERE bpbd_mkb IN (?)
           GROUP BY bpbd_mkb, bpbd_bhn_kode, bpbd_nourut
         ) nn ON nn.mkb = d.mkbd_mkb_nomor AND nn.bhn = d.mkbd_bhn_kode AND nn.urut = d.mkbd_nourut
         LEFT JOIN (
           SELECT k.mkbd2_mkb_nomor AS mkb, k.mkbd2_nourut AS urut,
                  IF(MIN(k.mkbd2_qty) <= SUM(p.bpbd2_jumlah), MIN(k.mkbd2_qty), SUM(p.bpbd2_jumlah)) AS qty
           FROM tbpb_dtl2 p
           INNER JOIN tmkb_dtl2 k ON k.mkbd2_po_nomor = p.bpbd2_po_nomor AND k.mkbd2_pourut = p.bpbd2_nourut
           WHERE k.mkbd2_mkb_nomor IN (?)
           GROUP BY k.mkbd2_mkb_nomor, k.mkbd2_nourut
         ) lk ON lk.mkb = d.mkbd_mkb_nomor AND lk.urut = d.mkbd_nourut
         WHERE d.mkbd_mkb_nomor IN (?)
         GROUP BY d.mkbd_mkb_nomor
       ) a
       LEFT JOIN (
         SELECT mkbd_mkb_nomor AS nomor,
                COUNT(CASE WHEN mkbd_jumlah_rs = 0 THEN mkbd_jumlah END) AS crs0,
                COUNT(CASE WHEN mkbd_jumlah_rs <> 0 THEN mkbd_jumlah END) AS crs,
                COUNT(mkbd_jumlah) AS item
         FROM tmkb_dtl
         WHERE mkbd_mkb_nomor IN (?)
         GROUP BY mkbd_mkb_nomor
       ) c ON c.nomor = a.nomor
       LEFT JOIN (
         SELECT pod_mkb_nomor AS nomor, COUNT(DISTINCT pod_po_nomor) AS n
         FROM tpo_dtl WHERE pod_mkb_nomor IN (?)
         GROUP BY pod_mkb_nomor
       ) p1 ON p1.nomor = a.nomor
       LEFT JOIN (
         SELECT mkbd2_mkb_nomor AS nomor, COUNT(DISTINCT mkbd2_po_nomor) AS n
         FROM tmkb_dtl2 WHERE mkbd2_mkb_nomor IN (?)
         GROUP BY mkbd2_mkb_nomor
       ) p2 ON p2.nomor = a.nomor
     ) z`,
    [P, P, P, P, P, P, P],
  );
  const map = {};
  for (const r of rows) map[r.nomor] = r.ket || "";
  return map;
};

// { [spk]: { StatusBahan, MkbNomor, EstimasiKedatangan } }
const getStatusBahanBySpk = async (spkList) => {
  const list = [...new Set((spkList || []).filter(Boolean))];
  if (!list.length) return {};

  const [spkRows] = await db.query(
    `SELECT spk_nomor, spk_so_ref, spk_memo FROM tspk WHERE spk_nomor IN (?)`,
    [list],
  );
  const spkMap = {};
  for (const r of spkRows) spkMap[r.spk_nomor] = r;

  const kunciBySpk = {};
  const semuaKunci = new Set();
  for (const spk of list) {
    const k = buatKunci(spk, spkMap[spk]);
    kunciBySpk[spk] = k;
    k.forEach((x) => semuaKunci.add(x));
  }

  // MKB per kunci — kalau ada lebih dari satu, ambil yang terbaru.
  // Dijalankan paralel dengan tplanningspk (tidak saling bergantung).
  const planPromise = db.query(
    `SELECT plan_spk AS kunci, DATE_FORMAT(MAX(plan_tanggal), '%Y-%m-%d') AS tgl
     FROM tplanningspk
     WHERE plan_spk IN (?) AND plan_datang <> 0
     GROUP BY plan_spk`,
    [[...semuaKunci]],
  );
  const [mkbRows] = await db.query(
    `SELECT mkb_spk_nomor AS kunci, mkb_nomor AS nomor
     FROM tmkb_hdr
     WHERE mkb_spk_nomor IN (?)
     ORDER BY mkb_tanggal, date_create, mkb_nomor`,
    [[...semuaKunci]],
  );
  const mkbByKunci = {};
  for (const r of mkbRows) mkbByKunci[r.kunci] = r.nomor; // yang terakhir menimpa

  const ketMap = await getKeteranganMkb([
    ...new Set(Object.values(mkbByKunci)),
  ]);

  // Estimasi kedatangan = tanggal terjauh di tplanningspk (plan_datang <> 0),
  // sama dengan yang diinput di form MKB (plan_spk = nomor SO / SPK di MKB)
  const [planRows] = await planPromise;
  const planByKunci = {};
  for (const r of planRows) planByKunci[r.kunci] = r.tgl;

  const result = {};
  for (const spk of list) {
    const kunci = kunciBySpk[spk].find((k) => mkbByKunci[k]);
    if (!kunci) {
      result[spk] = {
        StatusBahan: STATUS_BELUM_MKB,
        MkbNomor: "",
        EstimasiKedatangan: "",
      };
      continue;
    }
    const mkb = mkbByKunci[kunci];
    const status = ringkasStatus(ketMap[mkb]);
    result[spk] = {
      StatusBahan: status,
      MkbNomor: mkb,
      EstimasiKedatangan: planByKunci[kunci] || "",
    };
  }
  return result;
};

// Sama pola dengan withWipBahan: tempel ke baris yang punya NomorSPK
const withStatusBahan = async (rows) => {
  const map = await getStatusBahanBySpk(rows.map((r) => r.NomorSPK));
  return rows.map((r) => ({
    ...r,
    StatusBahan: map[r.NomorSPK]?.StatusBahan || "",
    MkbNomor: map[r.NomorSPK]?.MkbNomor || "",
    EstimasiKedatangan: map[r.NomorSPK]?.EstimasiKedatangan || "",
  }));
};

module.exports = { getStatusBahanBySpk, withStatusBahan };
