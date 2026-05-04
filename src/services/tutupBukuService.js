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
 * @description Untuk cek custom per modul (zClose dari getDateClose)
 * @param {string} modulNama
 */
const getManualTutupBuku = async (modulNama) => {
  // Jika nanti Anda menemukan tabel untuk zclose manual (getDateClose),
  // Anda bisa menambahkannya di sini. Untuk sementara kita fokus ke ztglclose.
  return null;
};

module.exports = { getTanggalTutupBuku, getManualTutupBuku };
