const { version } = require("../../../package.json");
const changelog = require("../../data/changelog");

// Versi aktif backend (dari package.json) + seluruh riwayat changelog.
// ⚠️ Asumsi: package.json backend adalah source of truth versi aplikasi
// (frontend & backend deploy bersamaan). Kalau nanti frontend/backend
// di-deploy terpisah dengan versi masing-masing, pemisahan ini perlu
// direvisit.
const getVersionInfo = () => {
  return {
    version,
    changelog,
  };
};

module.exports = { getVersionInfo };
