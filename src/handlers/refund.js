const { User, Order, Refund, newId } = require('../db');
const orderSvc = require('../services/order');
const notify = require('../services/notify');
const { setState } = require('../services/state');
const { b, pager, show } = require('../ui');
const { rp, esc, STATUS } = require('../utils');

const RS = { pending: '🟡 MENUNGGU', approved: '✅ DISETUJUI', rejected: '❌ DITOLAK' };
const ELIGIBLE = ['success', 'failed'];

function refundView(r, u, o) {
  const text = `💸 <b>PENGAJUAN REFUND</b> <code>${r.refundId}</code>\nStatus: ${RS[r.status]}\n\nUser: ${esc(u.name)}${u.username ? ' (@' + esc(u.username) + ')' : ''} — <code>${u.uid}</code>\n<pre>${esc(`TRX    : ${o.trxId}\nGame   : ${o.gameName}\nProduk : ${o.productName}\nUser   : ${o.target}\nZone   : ${o.zone || '-'}\nHarga  : ${rp(o.price)}\nStatus : ${STATUS[o.status]}`)}</pre>\n<b>Alasan user:</b>\n${esc(r.reason)}` +
    (r.adminNote ? `\n\n<b>Catatan admin:</b>\n${esc(r.adminNote)}` : '');
  const kb = r.status === 'pending' ? [[b('✅ Setujui', `rfa:${r.refundId}`), b('❌ Tolak', `rfr:${r.refundId}`)]] : [];
  kb.push([b('📦 Detail Order', `aot:${o.trxId}`)]);
  return { text, kb };
}
async function showRefund(ctx, id) {
  const r = await Refund.findOne({ refundId: id }); if (!r) return;
  const [u, o] = await Promise.all([User.findOne({ tgId: r.tgId }), Order.findOne({ trxId: r.trxId })]);
  const v = refundView(r, u, o);
  return show(ctx, v.text, [...v.kb, [b('⬅️ Daftar Refund', 'arf')]]);
}

function register(bot) {
  // ---- User: ajukan refund + alasan ----
  bot.action(/^rf:(.+)$/, async (ctx) => {
    const o = await Order.findOne({ trxId: ctx.match[1], tgId: ctx.from.id });
    if (!o || !ELIGIBLE.includes(o.status)) return ctx.answerCbQuery('Transaksi ini tidak bisa diajukan refund', { show_alert: true });
    if (await Refund.exists({ trxId: o.trxId, status: 'pending' })) return ctx.answerCbQuery('Pengajuan refund masih ditinjau admin', { show_alert: true });
    await setState(ctx, { action: 'refund_reason', trx: o.trxId });
    return show(ctx, `💸 <b>AJUKAN REFUND</b>\n\n<b>${o.trxId}</b> • ${esc(o.productName)} • ${rp(o.price)}\n\nTulis <b>alasan refund</b> kamu (min. 10 karakter). Pengajuan akan ditinjau admin, saldo dikembalikan hanya jika disetujui.`, [[b('❌ Batal', `trx:${o.trxId}`)]]);
  });

  // ---- Admin ----
  const adm = (fn) => async (ctx) => (ctx.state.isOwner ? fn(ctx) : ctx.answerCbQuery('⛔ Khusus owner', { show_alert: true }));
  bot.action('arf', adm(async (ctx) => {
    const q = { status: 'pending' }; const total = await Refund.countDocuments(q);
    const list = await Refund.find(q).sort({ createdAt: 1 }).limit(10);
    return show(ctx, `💸 <b>PENGAJUAN REFUND</b> (${total} menunggu)`, [...list.map((r) => [b(`${r.refundId} • ${r.trxId}`, `rfv:${r.refundId}`)]), [b('⬅️ Admin', 'adm')]]);
  }));
  bot.action(/^rfv:(.+)$/, adm((ctx) => showRefund(ctx, ctx.match[1])));
  bot.action(/^rfa:(.+)$/, adm(async (ctx) => {
    const res = await orderSvc.approveRefund(ctx.match[1], ctx.from.id);
    if (!res.ok) return ctx.answerCbQuery(res.msg, { show_alert: true });
    return showRefund(ctx, ctx.match[1]);
  }));
  bot.action(/^rfr:(.+)$/, adm(async (ctx) => {
    const r = await Refund.findOne({ refundId: ctx.match[1], status: 'pending' });
    if (!r) return ctx.answerCbQuery('Sudah diproses', { show_alert: true });
    await setState(ctx, { action: 'adm_rf_no', id: r.refundId });
    return ctx.reply(`❌ Ketik <b>alasan penolakan</b> untuk <code>${r.refundId}</code> (akan dikirim ke user):`, { parse_mode: 'HTML' });
  }));
}

const inputs = {
  async refund_reason(ctx, st, text) {
    if (text.length < 10) return ctx.reply('❌ Alasan terlalu singkat (min. 10 karakter). Jelaskan lebih detail.');
    if (text.length > 500) return ctx.reply('❌ Maksimal 500 karakter.');
    const o = await Order.findOne({ trxId: st.trx, tgId: ctx.from.id });
    if (!o || !ELIGIBLE.includes(o.status) || (await Refund.exists({ trxId: o.trxId, status: 'pending' }))) {
      await setState(ctx, null);
      return ctx.reply('Transaksi ini tidak bisa diajukan refund.', { reply_markup: { inline_keyboard: [[b('🏠 Menu', 'menu')]] } });
    }
    const r = await Refund.create({ refundId: await newId('RFD', 'rfd'), trxId: o.trxId, tgId: ctx.from.id, reason: text });
    await setState(ctx, null);
    const v = refundView(r, ctx.state.user, o);
    await notify.owners(v.text, v.kb);
    return ctx.reply(`✅ Pengajuan refund <b>${r.refundId}</b> terkirim. Admin akan meninjau; kamu akan dikabari.`, { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[b('📜 Riwayat', 'hist:0'), b('🏠 Menu', 'menu')]] } });
  },
  async adm_rf_no(ctx, st, text) {
    const res = await orderSvc.rejectRefund(st.id, ctx.from.id, text.slice(0, 300));
    await setState(ctx, null);
    return ctx.reply(res.ok ? `✅ Pengajuan ${st.id} ditolak, user diberi tahu.` : `❌ ${res.msg}`, { reply_markup: { inline_keyboard: [[b('💸 Refund', 'arf')]] } });
  },
};
module.exports = { register, inputs };
