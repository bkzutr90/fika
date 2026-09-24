const { Game, Product, Order, User, newId } = require('../db');
const { b, grid, show } = require('../ui');
const { setState } = require('../services/state');
const wallet = require('../services/wallet');
const orderSvc = require('../services/order');
const { rp, esc } = require('../utils');

const cancelKb = [[b('❌ Batal', 'games')]];

async function showProducts(ctx, gameKey, target, zone) {
  const game = await Game.findOne({ key: gameKey });
  const products = await Product.find({ gameKey, active: true }).sort({ sort: 1, userPrice: 1 });
  await setState(ctx, { action: 't_pick', gameKey, target, zone });
  if (!products.length) return show(ctx, 'Produk untuk game ini belum tersedia.', [[b('⬅️ Kembali', 'games')]]);
  const kb = products.map((p) => [b(`💎 ${p.name} — ${rp(p.userPrice)}`, `p:${p._id}`)]);
  kb.push([b('❌ Batal', 'games')]);
  return show(ctx, `${game.emoji} <b>${esc(game.name)}</b>\n\n${esc(game.idLabel)} : <code>${esc(target)}</code>\n${esc(game.zoneLabel)} : <code>${esc(zone || '-')}</code>\n\nPilih nominal:`, kb);
}

function register(bot) {
  bot.action('games', async (ctx) => {
    const games = await Game.find({ active: true }).sort({ sort: 1, name: 1 });
    if (!games.length) return show(ctx, 'Belum ada game tersedia.', [[b('🏠 Menu', 'menu')]]);
    return show(ctx, '🎮 <b>TOPUP GAME</b>\n\nPilih game:', [...grid(games.map((g) => b(`${g.emoji} ${g.name}`, `g:${g.key}`)), 2), [b('🏠 Menu', 'menu')]]);
  });

  bot.action(/^g:(.+)$/, async (ctx) => {
    const game = await Game.findOne({ key: ctx.match[1], active: true });
    if (!game) return ctx.answerCbQuery('Game tidak tersedia', { show_alert: true });
    await setState(ctx, { action: 't_id', gameKey: game.key });
    return show(ctx, `${game.emoji} <b>${esc(game.name)}</b>\n\nMasukkan <b>${esc(game.idLabel)}</b>:`, cancelKb);
  });

  bot.action('skipzone', async (ctx) => {
    const st = ctx.state.user.state;
    if (st?.action !== 't_zone') return ctx.answerCbQuery('Sesi habis, ulangi dari menu', { show_alert: true });
    return showProducts(ctx, st.gameKey, st.target, '');
  });

  // Pilih produk -> buat order (belum bayar)
  bot.action(/^p:(.+)$/, async (ctx) => {
    const st = ctx.state.user.state;
    if (st?.action !== 't_pick') return ctx.answerCbQuery('Sesi habis, ulangi dari menu Topup', { show_alert: true });
    const [product, game, user] = await Promise.all([Product.findById(ctx.match[1]), Game.findOne({ key: st.gameKey }), User.findOne({ tgId: ctx.from.id })]);
    if (!product?.active || !game?.active) return ctx.answerCbQuery('Produk tidak tersedia', { show_alert: true });
    const price = product.userPrice;
    await Order.deleteMany({ tgId: user.tgId, status: 'awaiting_confirm' });
    const o = await Order.create({
      trxId: await newId('TRX', 'trx'), tgId: user.tgId, gameKey: game.key, gameName: game.name,
      productId: String(product._id), productName: product.name, sku: product.code,
      target: st.target, zone: st.zone || '', price, providerPrice: product.providerPrice,
    });
    await setState(ctx, null);
    const rows = `Game      : ${game.name}\nUser      : ${o.target}\nZone ID   : ${o.zone}\nProduk    : ${o.productName}\nHarga     : ${rp(price)}`;
    const enough = user.balance >= price;
    const text = `🧾 <b>KONFIRMASI PESANAN</b>\n\n<pre>${esc(rows)}</pre>\n💰 Saldo sekarang: ${rp(user.balance)}\n` +
      (enough ? `💰 Saldo setelah transaksi:\n<b>${rp(user.balance - price)}</b>` : `⚠️ Saldo kurang <b>${rp(price - user.balance)}</b>. Silakan deposit dulu.`);
    return show(ctx, text, enough
      ? [[b('✅ BAYAR', `chk:${o.trxId}`), b('❌ BATAL', `cx:${o.trxId}`)]]
      : [[b('💳 Deposit', 'dep')], [b('❌ BATAL', `cx:${o.trxId}`)]]);
  });

  bot.action(/^cx:(.+)$/, async (ctx) => {
    await Order.updateOne({ trxId: ctx.match[1], tgId: ctx.from.id, status: 'awaiting_confirm' }, { $set: { status: 'canceled' } });
    return show(ctx, '🚫 Pesanan dibatalkan.', [[b('🎮 Topup Game', 'games'), b('🏠 Menu', 'menu')]]);
  });

  // Validasi sebelum saldo dipotong
  bot.action(/^chk:(.+)$/, async (ctx) => {
    const o = await Order.findOne({ trxId: ctx.match[1], tgId: ctx.from.id, status: 'awaiting_confirm' });
    if (!o) return ctx.answerCbQuery('Pesanan sudah diproses atau dibatalkan', { show_alert: true });
    return show(ctx, `⚠️ <b>PERHATIAN</b>\n\nPastikan data berikut benar:\n\nUser : <code>${esc(o.target)}</code>\nZone : <code>${esc(o.zone || '-')}</code>\n\nKesalahan User ID/Zone ID menjadi tanggung jawab pengguna.`,
      [[b('✅ LANJUTKAN', `pay:${o.trxId}`)], [b('❌ BATAL', `cx:${o.trxId}`)]]);
  });

  // BAYAR: idempotent. Transisi status atomic = hanya 1 tap yang lolos
  bot.action(/^pay:(.+)$/, async (ctx) => {
    const trxId = ctx.match[1]; const tgId = ctx.from.id;
    const o = await Order.findOneAndUpdate(
      { trxId, tgId, status: 'awaiting_confirm' },
      { $set: { status: 'processing', processingAt: new Date(), chatId: ctx.chat.id, msgId: ctx.callbackQuery.message.message_id } }, { new: true });
    if (!o) return ctx.answerCbQuery('Pesanan sudah diproses atau dibatalkan', { show_alert: true });
    const u = await wallet.adjust(tgId, -o.price, { type: 'purchase', ref: trxId, note: `${o.gameName} ${o.productName}` });
    if (!u) {
      await Order.updateOne({ trxId }, { $set: { status: 'awaiting_confirm' } });
      return show(ctx, '⚠️ Saldo tidak cukup.', [[b('💳 Deposit', 'dep')], [b('❌ BATAL', `cx:${trxId}`)]]);
    }
    await show(ctx, orderSvc.processingText(o), [[b('📜 Riwayat', 'hist:0'), b('🏠 Menu', 'menu')]]);
    orderSvc.process(o).catch((e) => console.error('process', trxId, e));
  });
}

const inputs = {
  async t_id(ctx, st, text) {
    if (text.length > 60 || /\n/.test(text)) return ctx.reply('❌ Format tidak valid, coba lagi.');
    const game = await Game.findOne({ key: st.gameKey, active: true });
    if (!game) return ctx.reply('Game tidak tersedia.');
    if (game.zone === 'none') return showProducts(ctx, game.key, text, '');
    await setState(ctx, { action: 't_zone', gameKey: game.key, target: text });
    return ctx.reply(`Masukkan <b>${esc(game.zoneLabel)}</b>${game.zone === 'optional' ? ' (Opsional)' : ''}:`, {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [...(game.zone === 'optional' ? [[b('⏭ Lewati', 'skipzone')]] : []), [b('❌ Batal', 'games')]] },
    });
  },
  async t_zone(ctx, st, text) {
    if (text.length > 30 || /\n/.test(text)) return ctx.reply('❌ Format tidak valid, coba lagi.');
    return showProducts(ctx, st.gameKey, st.target, text);
  },
};
module.exports = { register, inputs };
