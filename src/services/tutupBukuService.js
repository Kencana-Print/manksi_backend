const db = require("../config/database");

/**
 * @description Meniru logika penentuan zdtClose dari main.pas Delphi
 * @returns {Promise<Date>} Tanggal closing dinamis (zdtClose)
 */
const getTanggalTutupBuku = async () => {
  try {
    // 1. Ambil nilai tgl_close dari tabel tversi (Sesuai main.pas)
    // Di asumsikan database "pengaturan" atau schema utama, sesuaikan jika berbeda.
    const query = `SELECT tgl_close FROM tversi WHERE aplikasi = "MANKSI" LIMIT 1`;
    const [rows] = await db.query(query);

    let ztglclose = 0; // Default jika tidak ketemu
    if (rows.length > 0) {
      ztglclose = parseInt(rows[0].tgl_close, 10);
    }

    // 2. Terapkan Logika Penanggalan Delphi (zdtClose)
    const today = new Date();
    let zDay = today.getDate();
    let zMonth = today.getMonth() + 1; // getMonth() mulai dari 0, jadi ditambah 1
    let zYear = today.getFullYear();

    /* Logika Delphi Asli:
       if StrToInt(formatdatetime('dd',cGetCurdate))<=ztglclose then
       begin
         if zMonth=1 then begin if zday<=ztglclose then zMonth:=12; zYear:=zYear-1; end
         else begin if zday<=ztglclose then zMonth:=zMonth-1; end;
       end;
    */
    if (zDay <= ztglclose) {
      if (zMonth === 1) {
        zMonth = 12;
        zYear = zYear - 1;
      } else {
        zMonth = zMonth - 1;
      }
    }

    // 3. Rakit zdtClose
    // JavaScript menerima bulan 0-11, jadi zMonth dikurangi 1
    // Perhatikan: zdtClose di Delphi menggunakan ztglclose sebagai harinya
    const zdtClose = new Date(zYear, zMonth - 1, ztglclose);

    return zdtClose;
  } catch (error) {
    console.error("Gagal menghitung tanggal tutup buku (zdtClose):", error);
    // Jika gagal, kembalikan tanggal yang sangat lama agar tidak mengunci secara tidak sengaja
    return new Date(2000, 0, 1);
  }
};

/**
 * @description Mengambil tanggal tutup buku manual dari database pengaturan
 * @param {string} modulNama Nama modul (cid), contoh: 'MINTA BELI GARMEN'
 * @returns {Promise<Date|null>} Tanggal closing manual atau null jika tidak ditemukan
 */
const getManualTutupBuku = async (modulNama) => {
  try {
    // Query disesuaikan dengan logika Delphi: DB pengaturan, cprogram MANKSI
    const query = `
      SELECT ctgl 
      FROM pengaturan.tclose 
      WHERE cprogram = "MANKSI" AND cid = ? 
      LIMIT 1
    `;
    const [rows] = await db.query(query, [modulNama]);

    if (rows.length > 0 && rows[0].ctgl) {
      return new Date(rows[0].ctgl);
    }

    return null;
  } catch (error) {
    console.error(
      `Gagal mengambil manual tutup buku (pengaturan.tclose) untuk ${modulNama}:`,
      error,
    );
    return null;
  }
};

module.exports = { getTanggalTutupBuku, getManualTutupBuku };
