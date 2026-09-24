const { Telegraf } = require('telegraf');
const mongoose = require('mongoose');
const config = require('./config');
const mw = require('./middleware');
const notify = require('./services/notify');
const orderSvc = require('./services/order');
const { seedIfEmpty } = require('./seed');
const { setState } = require('./services/state');
const settings = require('./services/settings');
const errors = require('./services/errors');

const modules = [require('./handlers/user'), require('./handlers/topup'), require('./handlers/deposit'), require('./handlers/support'), require('./handlers/refund'), require('./handlers/admin'), require('./handlers/dev')];
const collect = (k) => Object.assign({}, ...modules.map((m) => m[k] || {}));
const STATE_TTL = 15 * 60 * 1000;

const isPrivate = (ctx) => ctx.chat.type === 'private';
const repliedToBot = (ctx) => ctx.message.reply_to_message?.from?.id === ctx.botInfo?.id;
async function activeState(ctx) {
  const st = ctx.state.user.state;
  if (st && Date.now() - (st.at || 0) > STATE_TTL) { await setState(ctx, null); return null; }
  return st;
}

async function main() {
  await mongoose.connect(config.mongoUri);
  console.log('✅ MongoDB connected');
  await seedIfEmpty();
  await settings.load();

  const bot = new Telegraf(config.botToken);
  notify.init(bot.telegram);

  bot.use(mw.rateLimit(), mw.loadUser(), mw.groupSupport(), mw.lock(), mw.clearState());
  modules.forEach((m) => m.register(bot));
  const inputs = collect('inputs'); const photos = collect('photos');

  // Input teks sesuai state. Di grup hanya diterima jika berupa REPLY ke pesan bot (aman untuk privacy mode ON maupun OFF)
  bot.on('text', async (ctx) => {
    const st = await activeState(ctx);
    if (!isPrivate(ctx)) { if (!st || !repliedToBot(ctx)) return; }
    else if (!st) return modules[0].sendMenu(ctx);
    if (st.action.startsWith('adm_') && !ctx.state.isStaff) { await setState(ctx, null); return; }
    const fn = inputs[st.action];
    if (!fn) { await setState(ctx, null); return isPrivate(ctx) ? modules[0].sendMenu(ctx) : undefined; }
    return fn(ctx, st, ctx.message.text.trim());
  });

  // Input foto (bukti deposit, bukti pesanan selesai dari owner)
  bot.on('photo', async (ctx) => {
    const st = await activeState(ctx);
    if (!isPrivate(ctx) && (!st || !repliedToBot(ctx))) return;
    const fn = st && photos[st.action];
    if (!fn) return isPrivate(ctx) ? ctx.reply('Untuk deposit, buka menu 💳 Deposit dulu.', { reply_markup: { inline_keyboard: [[{ text: '💳 Deposit', callback_data: 'dep' }]] } }) : undefined;
    return fn(ctx, st);
  });

  bot.on('callback_query', (ctx) => ctx.answerCbQuery('Tombol kedaluwarsa, buka /menu', { show_alert: true }));
  bot.catch((err, ctx) => {
    console.error('Bot error:', err);
    errors.record(err, `update ${ctx.updateType}`);
    notify.devs(`⚠️ <b>Bot error</b>\n<code>${String(err.message).slice(0, 300).replace(/</g, '&lt;')}</code>\nUpdate: ${ctx.updateType}`).catch(() => {});
    try { ctx.reply?.('⚠️ Terjadi kesalahan, coba lagi atau /menu'); } catch {}
  });

  await bot.telegram.setMyCommands([{ command: 'start', description: 'Menu utama' }, { command: 'menu', description: 'Menu utama' }, { command: 'cancel', description: 'Batalkan proses' }]);
  orderSvc.startPoller();
  const me = await bot.telegram.getMe();
  bot.botInfo = me;
  bot.launch({ dropPendingUpdates: true }).catch((e) => { console.error(e); process.exit(1); });
  console.log(`🤖 @${me.username} berjalan | provider: ${config.provider} | owner: ${config.ownerIds.length} | admin: ${config.adminIds.length} | developer: ${config.devIds.length}`);

  const stop = (s) => { bot.stop(s); mongoose.disconnect(); };
  process.once('SIGINT', () => stop('SIGINT'));
  process.once('SIGTERM', () => stop('SIGTERM'));
}
main().catch((e) => { console.error(e); process.exit(1); });
