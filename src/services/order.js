const config = require('../config');
const { Order, Refund } = require('../db');
const wallet = require('./wallet');
const notify = require('./notify');
const errors = require('./errors');
const { rp, esc, fmtDate } = require('../utils');

const providers = { manual: require('../providers/manual'), mock: require('../providers/mock'), digiflazz: require('../providers/digiflazz') };
const provider = () => providers[config.provider] || providers.manual;

const head = (o) => `<b>${o.trxId}</b>\n${esc(o.gameName)}\n${esc(o.productName)}`;
const processingText = (o) => `🕒 <b>Pesanan sedang diproses...</b>\n\n${head(o)}\n\nMohon tunggu...`;

function invoiceText(o) {
  const t = `━━━━━━━━━━━━━━━━\n       INVOICE\n━━━━━━━━━━━━━━━━\n\n${config.storeName}\n\nTRX ID : ${o.trxId}\nGame   : ${o.gameName}\nProduk : ${o.productName}\n\nUser : ${o.target}\nZone : ${o.zone || ''}\n\nTotal : ${rp(o.price)}\nWaktu : ${fmtDate(o.finishedAt || o.createdAt)}\n\nStatus : SUCCESS\n━━━━━━━━━━━━━━━━`;
  return `<pre>${esc(t)}</pre>`;
}

async function editUser(o, text, kb) {
  const extra = { parse_mode: 'HTML', reply_markup: { inline_keyboard: kb || [] } };
  if (o.chatId && o.msgId) {
    try { await notify.tg.editMessageText(o.chatId, o.msgId, undefined, text, extra); return; } catch {}
  }
  await notify.user(o.tgId, text, kb);
}

// Hanya bisa dipanggil sekali per order (transisi status atomic processing -> success/failed)
// Order gagal TIDAK otomatis direfund: user harus mengajukan refund + alasan, admin yang menyetujui.
async function finalize(trxId, { status, ref = '', message = '', proofFileId = '' }) {
  const to = status === 'success' ? 'success' : 'failed';
  const o = await Order.findOneAndUpdate(
    { trxId, status: 'processing' },
    { $set: { status: to, providerRef: ref, note: message, finishedAt: new Date(), ...(proofFileId ? { proofFileId } : {}) } }, { new: true });
  if (!o) return null;
  const nav = [{ text: '🎮 Topup Lagi', callback_data: 'games' }, { text: '🏠 Menu', callback_data: 'menu' }];
  if (to === 'success') {
    await editUser(o, `✅ <b>TRANSAKSI BERHASIL</b>\n\n${head(o)}\n\nUser : ${esc(o.target)}`, [[{ text: '🧾 Invoice', callback_data: `inv:${o.trxId}` }], nav]);
    await notify.user(o.tgId, `🔔 <b>NOTIFIKASI</b>\n\n✅ Topup berhasil\n\n${esc(o.gameName)}\n${esc(o.productName)}\n\n${o.trxId}`);
    if (o.proofFileId) await notify.photo(o.tgId, o.proofFileId, `🖼 <b>BUKTI PESANAN SELESAI</b>\n\n${head(o)}${message ? `\n\n<b>Catatan owner:</b> ${esc(message)}` : ''}`);
  } else {
    await editUser(o, `❌ <b>TRANSAKSI GAGAL</b>\n\n${head(o)}${message ? `\n\n<b>Alasan:</b> ${esc(message)}` : ''}\n\nSaldo ${rp(o.price)} belum dikembalikan. Untuk refund, ajukan permintaan beserta alasannya — saldo kembali setelah disetujui admin.`,
      [[{ text: '💸 Ajukan Refund', callback_data: `rf:${o.trxId}` }], nav]);
    await notify.user(o.tgId, `🔔 <b>NOTIFIKASI</b>\n\n❌ Topup gagal.\n${o.trxId}\n\nAjukan refund lewat Riwayat → transaksi → 💸 AJUKAN REFUND.`);
  }
  return o;
}

async function process(o) {
  let res;
  try { res = await provider().submit(o, { admins: notify.owners }); } catch (e) {
    console.error('provider error', o.trxId, e); errors.record(e, `provider ${o.trxId}`);
    await notify.devs(`⚠️ <b>Provider error</b> ${o.trxId}\n<code>${esc(e.message)}</code>\nStatus tetap PROCESSING.`,
      [[{ text: '🔎 Detail', callback_data: `dvv:${o.trxId}` }]]);
    return;
  }
  if (res.status === 'success' || res.status === 'failed') return finalize(o.trxId, res);
  if (res.ref) await Order.updateOne({ trxId: o.trxId }, { $set: { providerRef: res.ref } });
}

// Admin menyetujui pengajuan refund -> baru saldo dikembalikan
async function approveRefund(refundId, adminId) {
  const r = await Refund.findOneAndUpdate({ refundId, status: 'pending' }, { $set: { status: 'approved', reviewedBy: adminId } }, { new: true });
  if (!r) return { ok: false, msg: 'Pengajuan sudah diproses' };
  const o = await Order.findOneAndUpdate({ trxId: r.trxId, status: { $in: ['failed', 'success'] } },
    { $set: { status: 'refunded', refunded: true, finishedAt: new Date() } }, { new: true });
  if (!o) {
    await Refund.updateOne({ refundId }, { $set: { status: 'pending', reviewedBy: null } });
    return { ok: false, msg: 'Status order tidak memenuhi syarat refund' };
  }
  const u = await wallet.adjust(o.tgId, o.price, { type: 'refund', ref: o.trxId, note: `Refund ${refundId}` });
  await notify.user(o.tgId, `✅ <b>REFUND DISETUJUI</b>\n\n${o.trxId} • ${esc(o.productName)}\n💰 Saldo +${rp(o.price)}\nSaldo sekarang: <b>${rp(u.balance)}</b>`, [[{ text: '🏠 Menu', callback_data: 'menu' }]]);
  return { ok: true };
}

async function rejectRefund(refundId, adminId, note) {
  const r = await Refund.findOneAndUpdate({ refundId, status: 'pending' }, { $set: { status: 'rejected', reviewedBy: adminId, adminNote: note } }, { new: true });
  if (!r) return { ok: false, msg: 'Pengajuan sudah diproses' };
  await notify.user(r.tgId, `❌ <b>REFUND DITOLAK</b>\n\n${r.trxId}\n\n<b>Alasan admin:</b>\n${esc(note)}`, [[{ text: '📞 Bantuan', callback_data: 'help' }]]);
  return { ok: true };
}

// Retry order gagal / stuck: saldo user sudah terpotong, jadi tidak ada debit lagi
async function retry(trxId) {
  const o = (await Order.findOneAndUpdate({ trxId, status: 'failed' }, { $set: { status: 'processing', processingAt: new Date(), refunded: false } }, { new: true }))
    || (await Order.findOne({ trxId, status: 'processing' }));
  if (!o) return { ok: false, msg: 'Order tidak bisa di-retry' };
  await process(o);
  return { ok: true };
}

// Untuk provider API yang punya check(): cek order processing secara berkala
function startPoller() {
  const p = provider();
  if (!p.check) return;
  setInterval(async () => {
    try {
      const list = await Order.find({ status: 'processing', processingAt: { $lt: new Date(Date.now() - 20000) } }).limit(20);
      for (const o of list) {
        try { const r = await p.check(o); if (r.status !== 'pending') await finalize(o.trxId, r); } catch (e) { console.error('poll', o.trxId, e.message); errors.record(e, `poll ${o.trxId}`); }
      }
    } catch (e) { console.error('poller', e.message); }
  }, 30000).unref();
}

module.exports = { processingText, invoiceText, process, finalize, approveRefund, rejectRefund, retry, startPoller };
