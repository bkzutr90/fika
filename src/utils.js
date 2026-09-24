const rp = (n) => 'Rp ' + Math.round(Number(n) || 0).toLocaleString('id-ID');
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const fmtDate = (d) =>
  new Date(d).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const startOfDayWIB = () => { const off = 7 * 3600e3; return new Date(Math.floor((Date.now() + off) / 86400e3) * 86400e3 - off); };
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const STATUS = {
  awaiting_confirm: '⏳ MENUNGGU KONFIRMASI',
  processing: '🕒 PROCESSING',
  success: '✅ SUCCESS',
  failed: '❌ FAILED',
  refunded: '⚠️ REFUNDED',
  canceled: '🚫 CANCELED',
};
module.exports = { rp, esc, fmtDate, sleep, startOfDayWIB, escRe, STATUS };
