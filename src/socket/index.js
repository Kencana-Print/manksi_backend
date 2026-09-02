// socket/index.js
const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");

// ── State presence in-memory ──────────────────────────────────────
// Struktur: { [pjw_nomor]: { [socket.id]: { kode, nama, bagian } } }
// Cukup in-memory karena presence itu sifatnya transient (hilang begitu
// user disconnect) — tidak perlu persist ke DB.
const roomPresence = {};

const getPresenceList = (room) => {
  const members = roomPresence[room] || {};
  return Object.values(members);
};

const initSocket = (httpServer) => {
  const io = new Server(httpServer, {
    cors: {
      origin: (origin, callback) => callback(null, origin || true),
      credentials: true,
    },
  });

  // ── Auth middleware — sama persis logic verifyToken di authMiddleware.js,
  // cuma jalur terima tokennya beda (handshake.auth, bukan header) ──
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) {
      return next(new Error("Akses ditolak. Token tidak ada."));
    }
    jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
      if (err) {
        return next(new Error("Sesi telah berakhir atau token tidak valid."));
      }
      socket.user = decoded; // { kode, nama, bagian, ... } — sesuai payload authService.js
      next();
    });
  });

  io.on("connection", (socket) => {
    let currentRoom = null;

    // ── Join room per nomor Komitmen Kirim ──
    socket.on("pjw:join", (pjwNomor) => {
      if (!pjwNomor) return;

      // Kalau sebelumnya sudah join room lain, keluar dulu (jaga-jaga
      // kalau user pindah form tanpa reload penuh)
      if (currentRoom && currentRoom !== pjwNomor) {
        socket.leave(currentRoom);
        if (roomPresence[currentRoom]) {
          delete roomPresence[currentRoom][socket.id];
          io.to(currentRoom).emit("pjw:presence", getPresenceList(currentRoom));
        }
      }

      currentRoom = pjwNomor;
      socket.join(pjwNomor);

      if (!roomPresence[pjwNomor]) roomPresence[pjwNomor] = {};
      roomPresence[pjwNomor][socket.id] = {
        kode: socket.user.kode,
        nama: socket.user.nama,
        bagian: socket.user.bagian,
      };

      // Broadcast daftar presence terbaru ke SEMUA anggota room (termasuk diri sendiri)
      io.to(pjwNomor).emit("pjw:presence", getPresenceList(pjwNomor));
    });

    // ── Leave eksplisit (user pindah form tanpa close tab) ──
    socket.on("pjw:leave", (pjwNomor) => {
      if (!pjwNomor || !roomPresence[pjwNomor]) return;
      socket.leave(pjwNomor);
      delete roomPresence[pjwNomor][socket.id];
      io.to(pjwNomor).emit("pjw:presence", getPresenceList(pjwNomor));
      if (currentRoom === pjwNomor) currentRoom = null;
    });

    // ── Field focus tracking — broadcast siapa sedang di sel mana ──
    socket.on("pjw:field-focus", ({ pjwNomor, pjwdId, field }) => {
      if (!pjwNomor) return;
      socket.to(pjwNomor).emit("pjw:field-focus", {
        pjwdId,
        field,
        kode: socket.user.kode,
        nama: socket.user.nama,
      });
    });

    socket.on("pjw:field-blur", ({ pjwNomor, pjwdId, field }) => {
      if (!pjwNomor) return;
      socket.to(pjwNomor).emit("pjw:field-blur", {
        pjwdId,
        field,
        kode: socket.user.kode,
      });
    });

    // ── Disconnect (tutup tab, koneksi putus, dll) ──
    socket.on("disconnect", () => {
      if (currentRoom && roomPresence[currentRoom]) {
        delete roomPresence[currentRoom][socket.id];
        io.to(currentRoom).emit("pjw:presence", getPresenceList(currentRoom));
        io.to(currentRoom).emit("pjw:user-disconnected", {
          kode: socket.user.kode,
        });
      }
    });
  });

  return io;
};

module.exports = { initSocket };
