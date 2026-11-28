const db = require("../../../config/database");
const { kategoriDari } = require("../../piutang/rekapKategori");
const {
  ambilPettyCashBanyak,
  TIPE_PCK,
} = require("../../piutang/rekapPembayaranFormService");

const TAHAP = {
  BELUM_VOUCHER: "Belum Voucher",
  BELUM_DIAJUKAN: "Belum Diajukan",
  BELUM_REALISASI: "Belum Realisasi",
};

const galat = (pesan) => Object.assign(new Error(pesan), { status: 400 });

const isTanggal = (t) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(t || ""))) {
    return false;
  }
  const d = new Date(`${t}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === t;
};

const hariIni = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

// PJT aktif (tidak batal) per kunci. Satu kunci bisa punya beberapa baris
// (carry-over): sudah realisasi bila salah satunya terisi, dianggap diajukan
// bila salah satunya diceklis. kolom hanya konstanta internal.
const ambilPjtAktif = async (kolom, daftar) => {
  if (!daftar.length) return new Map();
  const [rows] = await db.query(
    `SELECT ${kolom} AS kunci,
            MAX(ptd_nomor) AS pjt,
            MAX(ptd_realisasi) AS realisasi,
            MAX(ptd_diajukan) AS diajukan
     FROM finance.tpengajuan_transfer_dtl
     WHERE ${kolom} IN (?) AND ptd_batal = ''
     GROUP BY ${kolom}`,
    [daftar],
  );
  return new Map(
    rows.map((r) => [
      r.kunci,
      {
        pjt: r.pjt,
        realisasi: r.realisasi,
        diajukan: Number(r.diajukan) === 1,
      },
    ]),
  );
};

// null = sudah beres (tidak masuk laporan)
const tentukanTahap = (r, voucherDibayar, pjtVoucher, pjtPck) => {
  const adalahPck = r.tipe === TIPE_PCK;
  if (!adalahPck && !r.voucher) {
    return { kode: "BELUM_VOUCHER", pjt: "" };
  }
  const pjt = adalahPck ? pjtPck.get(r.nota) : pjtVoucher.get(r.voucher);
  if (pjt) {
    if (pjt.realisasi) return null;
    return {
      kode: pjt.diajukan ? "BELUM_REALISASI" : "BELUM_DIAJUKAN",
      pjt: pjt.pjt,
    };
  }
  // Tanpa PJT aktif: voucher yang sudah tercatat dibayar (BBK/BKK/realisasi
  // langsung) dianggap selesai
  if (!adalahPck && voucherDibayar.has(r.voucher)) return null;
  return { kode: "BELUM_DIAJUKAN", pjt: "" };
};

const getRekapBelumRealisasi = async ({ startDate, endDate, tahap }) => {
  if (startDate && !isTanggal(startDate)) {
    throw galat("Tanggal awal tidak valid.");
  }
  if (endDate && !isTanggal(endDate)) {
    throw galat("Tanggal akhir tidak valid.");
  }
  if (startDate && endDate && startDate > endDate) {
    throw galat("Tanggal awal tidak boleh melebihi tanggal akhir.");
  }
  const tahapPilih = String(tahap || "ALL").toUpperCase();
  if (tahapPilih !== "ALL" && !TAHAP[tahapPilih]) {
    throw galat("Tahap tidak dikenali.");
  }

  const where = ["h.rkb_status = 'AKTIF'"];
  const params = [];
  if (startDate) {
    where.push("h.rkb_tanggal >= ?");
    params.push(startDate);
  }
  if (endDate) {
    where.push("h.rkb_tanggal <= ?");
    params.push(endDate);
  }

  const [rows] = await db.query(
    `SELECT h.rkb_nomor AS rekap,
            DATE_FORMAT(h.rkb_tanggal, '%Y-%m-%d') AS tglRekap,
            d.rkbd_nourut AS noUrut,
            d.rkbd_sup_kode AS kodeSupplier,
            IFNULL(s.sup_nama, '') AS supplier,
            d.rkbd_tipe AS tipe,
            d.rkbd_nota AS nota,
            DATE_FORMAT(d.rkbd_tgl_nota, '%Y-%m-%d') AS tglNota,
            d.rkbd_bulan_tagihan AS bulanTagihan,
            d.rkbd_nominal AS nominal,
            DATE_FORMAT(d.rkbd_tgl_rencana, '%Y-%m-%d') AS tglRencana,
            IFNULL(d.rkbd_keterangan, '') AS keterangan,
            IFNULL(d.rkbd_vou_nomor, '') AS voucher
     FROM trekap_bayar_hdr h
     INNER JOIN trekap_bayar_dtl d ON d.rkbd_nomor = h.rkb_nomor
     LEFT JOIN tsupplier s ON s.sup_kode = d.rkbd_sup_kode
     WHERE ${where.join(" AND ")}
     ORDER BY h.rkb_tanggal, h.rkb_nomor, d.rkbd_nourut`,
    params,
  );
  if (!rows.length) return [];

  const daftarVou = [...new Set(rows.map((r) => r.voucher).filter(Boolean))];
  const daftarPck = [
    ...new Set(rows.filter((r) => r.tipe === TIPE_PCK).map((r) => r.nota)),
  ];

  const [bayarRows, pjtVoucher, pjtPck, petaPck] = await Promise.all([
    daftarVou.length
      ? db
          .query(
            `SELECT DISTINCT vou_nomor FROM bayar_debet_detail
             WHERE vou_nomor IN (?)`,
            [daftarVou],
          )
          .then(([r]) => r)
      : [],
    ambilPjtAktif("ptd_voucher", daftarVou),
    ambilPjtAktif("ptd_trs", daftarPck),
    ambilPettyCashBanyak(daftarPck),
  ]);
  const voucherDibayar = new Set(bayarRows.map((b) => b.vou_nomor));

  const hari = hariIni();
  const hasil = [];
  for (const r of rows) {
    const t = tentukanTahap(r, voucherDibayar, pjtVoucher, pjtPck);
    if (!t || (tahapPilih !== "ALL" && t.kode !== tahapPilih)) continue;
    const pck =
      r.tipe === TIPE_PCK ? petaPck.get(String(r.nota).toUpperCase()) : null;
    hasil.push({
      id: `${r.rekap}-${r.noUrut}`,
      NomorRekap: r.rekap,
      TglRekap: r.tglRekap,
      NoUrut: r.noUrut,
      TahapKode: t.kode,
      Tahap: TAHAP[t.kode],
      KodeSupplier: r.kodeSupplier,
      Supplier: pck ? pck.namaStore || pck.store : r.supplier,
      Kategori: kategoriDari(r.tipe),
      Tipe: r.tipe,
      Nota: r.nota,
      TglNota: r.tglNota,
      BulanTagihan: r.bulanTagihan,
      Nominal: Number(r.nominal),
      TglRencana: r.tglRencana,
      Telat: r.tglRencana ? r.tglRencana < hari : false,
      Voucher: r.voucher,
      Pjt: t.pjt,
      Keterangan: r.keterangan,
    });
  }
  return hasil;
};

module.exports = { getRekapBelumRealisasi };
