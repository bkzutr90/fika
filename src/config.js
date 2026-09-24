require('dotenv').config();
const need = (k) => { const v = process.env[k]; if (!v) throw new Error(`Env ${k} belum diisi`); return v; };
const num = (k, d) => (process.env[k] ? Number(process.env[k]) : d);
const ids = (k) => (process.env[k] || '').split(',').map((s) => Number(s.trim())).filter(Boolean);
const adminIds = ids('ADMIN_IDS');
const devIds = ids('DEV_IDS');
let ownerIds = ids('OWNER_IDS');
if (!ownerIds.length) { ownerIds = adminIds; console.warn('⚠️ OWNER_IDS kosong → ADMIN_IDS dipakai sebagai owner. Sebaiknya isi OWNER_IDS.'); }

module.exports = {
  botToken: need('BOT_TOKEN'),
  mongoUri: need('MONGODB_URI'),
  ownerIds, adminIds, devIds,
  storeName: process.env.STORE_NAME || 'JF STORE',
  idPrefix: process.env.ID_PREFIX || 'JF',
  adminUsername: (process.env.ADMIN_USERNAME || '').replace('@', ''),
  ownerUsername: (process.env.OWNER_USERNAME || process.env.ADMIN_USERNAME || '').replace('@', ''),
  devUsername: (process.env.DEV_USERNAME || '').replace('@', ''),
  provider: process.env.PROVIDER || 'manual',
  digiflazz: { username: process.env.DIGIFLAZZ_USERNAME, key: process.env.DIGIFLAZZ_KEY },
  deposit: {
    min: num('DEPOSIT_MIN', 10000),
    max: num('DEPOSIT_MAX', 5000000),
    uniqueCode: process.env.DEPOSIT_UNIQUE_CODE !== 'false',
    qrisImage: process.env.QRIS_IMAGE_URL || '',
    note: process.env.QRIS_NOTE || 'Scan QRIS di atas, bayar TEPAT sesuai total.',
  },
  markup: { user: num('MARKUP_USER_PCT', 5) },
};
