const config = require('../config');
const { User, Order, Ledger, Promo, Refund } = require('../db');
const wallet = require('../services/wallet');
const { invoiceText } = require('../services/order');
const { setState } = require('../services/state');
const { b, pager, show } = require('../ui');
const { rp, esc, fmtDate, STATUS } = require('../utils');

async function sendMenu(ctx) {
  const u = await User.findOne({ tgId: ctx.from.id });
  const text = `🎮 <b>TOPUP GAME</b>\n<i>${esc(config.storeName)}</i>\n\nHalo, <b>${esc(u.name)}</b>! Pilih menu 👇\n\n━━━━━━━━━━━━━━\n💰 Saldo: <b>${rp(u.balance)}</b>\n🆔 ID: <code>${u.uid}</code>`;
  const kb = [
    [b('👤 Akun Saya', 'acc'), b('💰 Saldo', 'bal')],
    [b('🎮 Topup Game', 'games')],
    [b('📜 Riwayat Transaksi', 'hist:0'), b('💳 Deposit', 'dep')],
    [b('🎁 Promo', 'promo'), b('📞 Bantuan', 'help')],
    [b('📊 Statistik', 'stat')],
  ];
  const priv = ctx.chat.type === 'private'; // panel staf tidak ditampilkan di grup
  if (priv && ctx.state.isOwner) kb.push([b('👑 Owner Panel', 'adm')]);
  else if (priv && ctx.state.isAdmin) kb.push([b('🛠 Admin Panel', 'adm')]);
  if (priv && ctx.state.isDev) kb.push([b('💻 Developer Panel', 'dv')]);
  return show(ctx, text, kb);
}

const LEDGER = { deposit: '💳 Deposit', purchase: '🛒 Pembelian', refund: '↩️ Refund', bonus: '🎁 Bonus', promo: '🎟 Promo', admin: '🛠 Admin' };
const HP = 5;

function register(bot) {
  bot.start(async (ctx) => { await setState(ctx, null); return sendMenu(ctx); });
  bot.command('menu', async (ctx) => { await setState(ctx, null); return sendMenu(ctx); });
  bot.command('cancel', async (ctx) => { await setState(ctx, null); return sendMenu(ctx); });
  bot.action('menu', sendMenu);
  bot.action('noop', (ctx) => ctx.answerCbQuery());

  bot.action('acc', async (ctx) => {
    const u = await User.findOne({ tgId: ctx.from.id });
    const n = await Order.countDocuments({ tgId: u.tgId, status: 'success' });
    return show(ctx, `👤 <b>AKUN SAYA</b>\n\nNama     : ${esc(u.name)}\nUsername : ${u.username ? '@' + esc(u.username) : '-'}\nID       : <code>${u.uid}</code>\nSaldo    : <b>${rp(u.balance)}</b>\nTransaksi sukses : ${n}\nBergabung : ${fmtDate(u.createdAt)}`, [[b('🏠 Menu', 'menu')]]);
  });

  bot.action('bal', async (ctx) => {
    const u = await User.findOne({ tgId: ctx.from.id });
    return show(ctx, `💰 <b>SALDO</b>\n\nSaldo : <b>${rp(u.balance)}</b>`, [[b('💳 Deposit', 'dep')], [b('📜 Mutasi Saldo', 'mut:0')], [b('🏠 Menu', 'menu')]]);
  });

  bot.action(/^mut:(\d+)$/, async (ctx) => {
    const p = +ctx.match[1]; const q = { tgId: ctx.from.id };
    const [total, rows] = await Promise.all([Ledger.countDocuments(q), Ledger.find(q).sort({ createdAt: -1 }).skip(p * 8).limit(8)]);
    const body = rows.length
      ? rows.map((r) => `${LEDGER[r.type] || r.type}  <b>${r.amount > 0 ? '+' : '-'}${rp(Math.abs(r.amount))}</b>\n<i>${esc(r.note || r.ref)}</i> • ${fmtDate(r.createdAt)}\nSaldo: ${rp(r.balanceAfter)}`).join('\n\n')
      : 'Belum ada mutasi.';
    return show(ctx, `📜 <b>MUTASI SALDO</b>\n\n${body}`, [pager('mut:', p, total, 8), [b('⬅️ Kembali', 'bal')]]);
  });

  // ---- Riwayat ----
  bot.action(/^hist:(\d+)$/, async (ctx) => {
    const p = +ctx.match[1]; const q = { tgId: ctx.from.id, status: { $ne: 'awaiting_confirm' } };
    const [total, rows] = await Promise.all([Order.countDocuments(q), Order.find(q).sort({ createdAt: -1 }).skip(p * HP).limit(HP)]);
    if (!total) return show(ctx, '📜 <b>RIWAYAT</b>\n\nBelum ada transaksi.', [[b('🎮 Topup Sekarang', 'games')], [b('🏠 Menu', 'menu')]]);
    const text = '📜 <b>RIWAYAT</b>\n\n' + rows.map((o) => `#${o.trxId}\n🎮 ${esc(o.gameName)}\n💎 ${esc(o.productName)}\n💰 ${rp(o.price)}\n${STATUS[o.status]}`).join('\n\n');
    const kb = []; for (let i = 0; i < rows.length; i += 2) kb.push(rows.slice(i, i + 2).map((o) => b('🔎 ' + o.trxId, `trx:${o.trxId}`)));
    kb.push(pager('hist:', p, total, HP), [b('🏠 Menu', 'menu')]);
    return show(ctx, text, kb);
  });

  bot.action(/^trx:(.+)$/, async (ctx) => {
    const o = await Order.findOne({ trxId: ctx.match[1], tgId: ctx.from.id });
    if (!o) return ctx.answerCbQuery('Transaksi tidak ditemukan', { show_alert: true });
    const rf = await Refund.findOne({ trxId: o.trxId }).sort({ createdAt: -1 });
    const RS = { pending: '⏳ Menunggu persetujuan admin', approved: '✅ Disetujui', rejected: '❌ Ditolak' };
    const text = `🧾 <b>DETAIL TRANSAKSI</b>\n\n<pre>${esc(`TRX ID : ${o.trxId}\nGame   : ${o.gameName}\nProduk : ${o.productName}\nUser   : ${o.target}\nZone   : ${o.zone || '-'}\n\nHarga  : ${rp(o.price)}\nStatus : ${STATUS[o.status]}`)}</pre>\nWaktu:\n${fmtDate(o.createdAt)}` +
      (rf ? `\n\n💸 Refund: ${RS[rf.status]}${rf.status === 'rejected' && rf.adminNote ? `\n<i>${esc(rf.adminNote)}</i>` : ''}` : '');
    const kb = [];
    if (o.status === 'success') kb.push([b('🧾 Invoice', `inv:${o.trxId}`)]);
    if (o.proofFileId) kb.push([b('🖼 Bukti Pesanan', `pf:${o.trxId}`)]);
    if (['success', 'failed'].includes(o.status) && rf?.status !== 'pending') kb.push([b('💸 AJUKAN REFUND', `rf:${o.trxId}`)]);
    if (['success', 'processing', 'failed', 'refunded'].includes(o.status)) kb.push([b('🚨 LAPORKAN MASALAH', `rep:${o.trxId}`)]);
    kb.push([b('⬅️ Riwayat', 'hist:0')]);
    return show(ctx, text, kb);
  });

  bot.action(/^inv:(.+)$/, async (ctx) => {
    const o = await Order.findOne({ trxId: ctx.match[1], tgId: ctx.from.id, status: 'success' });
    if (!o) return ctx.answerCbQuery('Invoice tidak tersedia', { show_alert: true });
    return ctx.reply(invoiceText(o), { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[b('🏠 Menu', 'menu')]] } });
  });

  bot.action(/^pf:(.+)$/, async (ctx) => {
    const o = await Order.findOne({ trxId: ctx.match[1], tgId: ctx.from.id });
    if (!o?.proofFileId) return ctx.answerCbQuery('Bukti tidak tersedia', { show_alert: true });
    return ctx.replyWithPhoto(o.proofFileId, { caption: `🖼 <b>BUKTI PESANAN</b>\n<b>${o.trxId}</b> • ${esc(o.productName)}`, parse_mode: 'HTML', reply_markup: { inline_keyboard: [[b('🏠 Menu', 'menu')]] } });
  });

  // ---- Statistik ----
  bot.action('stat', async (ctx) => {
    const tgId = ctx.from.id;
    const agg = await Order.aggregate([{ $match: { tgId, status: { $ne: 'awaiting_confirm' } } }, { $group: { _id: '$status', n: { $sum: 1 }, sum: { $sum: '$price' } } }]);
    const g = (s) => agg.find((x) => x._id === s) || { n: 0, sum: 0 };
    const total = agg.reduce((a, x) => a + x.n, 0);
    const fav = await Order.aggregate([{ $match: { tgId, status: 'success' } }, { $group: { _id: '$gameName', n: { $sum: 1 } } }, { $sort: { n: -1 } }, { $limit: 3 }]);
    const medal = ['🥇', '🥈', '🥉'];
    const text = `📊 <b>STATISTIK</b>\n\nTotal transaksi : ${total}\nTotal topup     : ${rp(g('success').sum)}\nBerhasil        : ${g('success').n}\nGagal           : ${g('failed').n}\n\n<b>Game favorit:</b>\n${fav.length ? fav.map((f, i) => `${medal[i]} ${esc(f._id)}`).join('\n') : '-'}`;
    return show(ctx, text, [[b('🏠 Menu', 'menu')]]);
  });

  // ---- Promo ----
  bot.action('promo', async (ctx) => {
    const list = await Promo.find({ active: true, $expr: { $lt: ['$used', '$maxUse'] } }).limit(10);
    const promos = list.length ? list.map((p) => `🎟 <code>${esc(p.code)}</code> — bonus ${rp(p.bonus)}${p.note ? `\n<i>${esc(p.note)}</i>` : ''}`).join('\n\n') : 'Belum ada promo aktif.';
      return show(ctx, `🎁 <b>PROMO</b>\n\n${promos}`, [[b('🎟 Klaim Kode Promo', 'promo_in')], [b('🏠 Menu', 'menu')]]);
  });
  bot.action('promo_in', async (ctx) => {
    await setState(ctx, { action: 'promo_code' });
    return show(ctx, '🎟 Kirim <b>kode promo</b> kamu:', [[b('❌ Batal', 'promo')]]);
  });
}

const inputs = {
  async promo_code(ctx, st, text) {
    const code = text.toUpperCase().replace(/\s/g, '');
    const p = await Promo.findOneAndUpdate(
      { code, active: true, usedBy: { $ne: ctx.from.id }, $expr: { $lt: ['$used', '$maxUse'] } },
      { $inc: { used: 1 }, $push: { usedBy: ctx.from.id } }, { new: true });
    await setState(ctx, null);
    if (!p) return ctx.reply('❌ Kode tidak valid, sudah dipakai, atau kuota habis.', { reply_markup: { inline_keyboard: [[b('🎁 Promo', 'promo')]] } });
    const u = await wallet.adjust(ctx.from.id, p.bonus, { type: 'promo', ref: p.code, note: `Promo ${p.code}` });
    return ctx.reply(`🎉 Kode berhasil! Saldo +${rp(p.bonus)}\n💰 Saldo sekarang: <b>${rp(u.balance)}</b>`, { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[b('🏠 Menu', 'menu')]] } });
  },
};
module.exports = { register, inputs, sendMenu };
