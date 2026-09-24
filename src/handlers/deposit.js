const config = require('../config');
const { User, Deposit, newId } = require('../db');
const wallet = require('../services/wallet');
const notify = require('../services/notify');
const { setState } = require('../services/state');
const { b, grid, show } = require('../ui');
const { rp, esc } = require('../utils');

const D = config.deposit;
const photos = {};
const QUICK = [10000, 25000, 50000, 100000, 200000, 500000];

async function createDeposit(ctx, amount) {
  if (!Number.isFinite(amount) || amount < D.min || amount > D.max)
    return ctx.reply(`❌ Nominal harus antara ${rp(D.min)} - ${rp(D.max)}.`);
  await Deposit.updateMany({ tgId: ctx.from.id, status: 'pending' }, { $set: { status: 'canceled' } });
  const unique = D.uniqueCode ? 1 + Math.floor(Math.random() * 99) : 0;
  const dep = await Deposit.create({ depId: await newId('DEP', 'dep'), tgId: ctx.from.id, amount, payTotal: amount + unique });
  await setState(ctx, null);
  const text = `💳 <b>INVOICE DEPOSIT</b>\n<code>${dep.depId}</code>\n\nNominal    : ${rp(amount)}\n${unique ? `Kode unik   : ${unique}\n` : ''}<b>Total bayar : ${rp(dep.payTotal)}</b>\nMetode     : QRIS\n\n${esc(D.note)}\nSetelah bayar, tekan <b>Kirim Bukti</b> lalu kirim screenshot pembayaran.`;
  const kb = [[b('📤 Kirim Bukti', `dproof:${dep.depId}`)], [b('❌ Batal', `dcx:${dep.depId}`)]];
  if (D.qrisImage) {
    if (ctx.callbackQuery) await ctx.deleteMessage().catch(() => {});
    return ctx.replyWithPhoto(D.qrisImage, { caption: text, parse_mode: 'HTML', reply_markup: { inline_keyboard: kb } });
  }
  return show(ctx, text + '\n\n<i>(Admin belum mengatur gambar QRIS, minta detail pembayaran ke admin)</i>', kb);
}

function register(bot) {
  bot.action('dep', async (ctx) => {
    await setState(ctx, { action: 'd_amount' });
    return show(ctx, `💳 <b>DEPOSIT</b>\n\nMasukkan nominal (min ${rp(D.min)}, maks ${rp(D.max)})\natau pilih cepat:`,
      [...grid(QUICK.map((n) => b(rp(n), `da:${n}`)), 3), [b('❌ Batal', 'menu')]]);
  });
  bot.action(/^da:(\d+)$/, (ctx) => createDeposit(ctx, +ctx.match[1]));

  bot.action(/^dcx:(.+)$/, async (ctx) => {
    await Deposit.updateOne({ depId: ctx.match[1], tgId: ctx.from.id, status: 'pending' }, { $set: { status: 'canceled' } });
    if (ctx.callbackQuery.message.photo) await ctx.deleteMessage().catch(() => {});
    return ctx.reply('🚫 Deposit dibatalkan.', { reply_markup: { inline_keyboard: [[b('🏠 Menu', 'menu')]] } });
  });

  bot.action(/^dproof:(.+)$/, async (ctx) => {
    const dep = await Deposit.findOne({ depId: ctx.match[1], tgId: ctx.from.id, status: 'pending' });
    if (!dep) return ctx.answerCbQuery('Invoice sudah tidak aktif', { show_alert: true });
    await setState(ctx, { action: 'd_proof', depId: dep.depId });
    return ctx.reply(`📤 Kirim <b>foto bukti pembayaran</b> ${rp(dep.payTotal)} sekarang.`, { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[b('❌ Batal', 'menu')]] } });
  });

  photos.d_proof = async (ctx, st) => {
    const fileId = ctx.message.photo.at(-1).file_id;
    const dep = await Deposit.findOneAndUpdate({ depId: st.depId, tgId: ctx.from.id, status: 'pending' }, { $set: { status: 'waiting_review', proofFileId: fileId } }, { new: true });
    await setState(ctx, null);
    if (!dep) return ctx.reply('Invoice sudah tidak aktif.');
    await ctx.reply(`✅ Bukti diterima. Deposit <b>${dep.depId}</b> sedang diverifikasi admin.`, { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[b('🏠 Menu', 'menu')]] } });
    const u = ctx.state.user;
    await notify.adminPhoto(fileId, depCaption(dep, u, '🟡 MENUNGGU'), [[b('✅ Approve', `dep_ok:${dep.depId}`), b('❌ Tolak', `dep_no:${dep.depId}`)]]);
  };

  const adminOnly = (fn) => async (ctx) => (ctx.state.isAdmin ? fn(ctx) : ctx.answerCbQuery('⛔ Khusus admin', { show_alert: true }));
  const setCaption = (ctx, text) => ctx.editMessageCaption(text, { parse_mode: 'HTML' }).catch(() => {});

  bot.action(/^dep_ok:(.+)$/, adminOnly(async (ctx) => {
    const dep = await Deposit.findOneAndUpdate({ depId: ctx.match[1], status: 'waiting_review' }, { $set: { status: 'paid', reviewedBy: ctx.from.id } }, { new: true });
    if (!dep) return ctx.answerCbQuery('Sudah diproses admin lain', { show_alert: true });
    const user = await User.findOne({ tgId: dep.tgId });
    await wallet.adjust(dep.tgId, dep.amount, { type: 'deposit', ref: dep.depId, note: 'Deposit QRIS' });
    const fresh = await User.findOne({ tgId: dep.tgId });
    await setCaption(ctx, depCaption(dep, user, '✅ PAID'));
    await notify.user(dep.tgId, `✅ <b>DEPOSIT BERHASIL</b>\n\nNominal : ${rp(dep.amount)}\n💰 Saldo : <b>${rp(fresh.balance)}</b>`, [[b('🎮 Topup Sekarang', 'games')]]);
  }));

  bot.action(/^dep_no:(.+)$/, adminOnly(async (ctx) => {
    const dep = await Deposit.findOneAndUpdate({ depId: ctx.match[1], status: 'waiting_review' }, { $set: { status: 'rejected', reviewedBy: ctx.from.id } }, { new: true });
    if (!dep) return ctx.answerCbQuery('Sudah diproses admin lain', { show_alert: true });
    const user = await User.findOne({ tgId: dep.tgId });
    await setCaption(ctx, depCaption(dep, user, '❌ DITOLAK'));
    await notify.user(dep.tgId, `❌ <b>DEPOSIT DITOLAK</b>\n\n${dep.depId} • ${rp(dep.amount)}\nBukti tidak valid. Hubungi admin bila ada kesalahan.`, [[b('📞 Bantuan', 'help')]]);
  }));
}

function depCaption(dep, u, status) {
  return `💰 <b>DEPOSIT BARU</b>\n\nUser: ${esc(u.name)}${u.username ? ' (@' + esc(u.username) + ')' : ''} — <code>${u.uid}</code>\nDeposit: <code>${dep.depId}</code>\nNominal: ${rp(dep.amount)}\nTotal transfer: ${rp(dep.payTotal)}\n\nPayment: QRIS\nStatus: ${status}\nBukti: (gambar di atas)`;
}

const inputs = {
  async d_amount(ctx, st, text) { return createDeposit(ctx, parseInt(text.replace(/[^\d]/g, ''), 10)); },
};
module.exports = { register, inputs, photos };
