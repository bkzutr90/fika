const config = require('./config');
const { User, MsgOwner, newId } = require('./db');
const { withHint } = require('./ui');
const settings = require('./services/settings');

const buckets = new Map();
setInterval(() => { const now = Date.now(); for (const [k, v] of buckets) if (!v.some((t) => now - t < 10000)) buckets.delete(k); }, 60000).unref();

// Flood protection: maks 15 aksi / 10 detik per user
const rateLimit = () => async (ctx, next) => {
  const id = ctx.from?.id; if (!id) return next();
  const now = Date.now(); const arr = (buckets.get(id) || []).filter((t) => now - t < 10000); arr.push(now); buckets.set(id, arr);
  if (arr.length > 15) {
    if (ctx.callbackQuery) return ctx.answerCbQuery('🚦 Terlalu cepat, pelan-pelan ya').catch(() => {});
    if (arr.length === 16) return ctx.reply('🚦 Terlalu banyak permintaan, tunggu beberapa detik.');
    return;
  }
  return next();
};

const loadUser = () => async (ctx, next) => {
  const type = ctx.chat?.type;
  if (!ctx.from || ctx.from.is_bot || !['private', 'group', 'supergroup'].includes(type)) return;
  const f = ctx.from;
  const name = [f.first_name, f.last_name].filter(Boolean).join(' ') || 'User';
  const groupChatId = type === 'private' ? undefined : ctx.chat.id;
  let user = await User.findOne({ tgId: f.id });
  if (!user) {
    try { user = await User.create({ tgId: f.id, uid: await newId(config.idPrefix, 'user'), username: f.username, name, groupChatId }); }
    catch (e) { if (e.code === 11000) user = await User.findOne({ tgId: f.id }); else throw e; }
  } else if (user.name !== name || user.username !== f.username || (groupChatId && user.groupChatId !== groupChatId)) {
    user.name = name; user.username = f.username; if (groupChatId) user.groupChatId = groupChatId;
    await user.save();
  }
  ctx.state.user = user;
  ctx.state.isOwner = config.ownerIds.includes(f.id);
  ctx.state.isAdmin = ctx.state.isOwner || config.adminIds.includes(f.id); // owner otomatis punya akses admin
  ctx.state.isDev = config.devIds.includes(f.id);
  ctx.state.isStaff = ctx.state.isAdmin || ctx.state.isDev;
  if (user.banned) {
    if (ctx.callbackQuery) return ctx.answerCbQuery('🚫 Akun kamu diblokir', { show_alert: true }).catch(() => {});
    return ctx.reply('🚫 Akun kamu diblokir. Hubungi owner.');
  }
  if (settings.get('maintenance') && !ctx.state.isStaff) {
    if (ctx.callbackQuery) return ctx.answerCbQuery('🚧 Bot sedang maintenance, coba lagi nanti', { show_alert: true }).catch(() => {});
    return ctx.reply('🚧 Bot sedang maintenance. Coba lagi beberapa saat lagi.');
  }
  return next();
};

// Mode grup:
//  - pesan bot membalas (reply) pesan pengguna & dicatat pemiliknya
//  - tombol hanya bisa ditekan oleh pemilik menu (orang lain tidak bisa mengacak menu/saldo orang)
const groupSupport = () => async (ctx, next) => {
  if (ctx.chat.type === 'private') return next();
  const chatId = ctx.chat.id, uid = ctx.from.id;
  const own = (m) => m && MsgOwner.updateOne({ chatId, msgId: m.message_id }, { $set: { userId: uid } }, { upsert: true }).catch(() => {});
  if (ctx.callbackQuery) {
    const mid = ctx.callbackQuery.message?.message_id;
    const o = mid ? await MsgOwner.findOne({ chatId, msgId: mid }).lean() : null;
    if (!o || o.userId !== uid) return ctx.answerCbQuery('🔒 Menu ini milik pengguna lain. Ketik /menu untuk membuka menu kamu.', { show_alert: true }).catch(() => {});
  }
  const replyTo = ctx.message?.message_id;
  const withReply = (extra = {}) => (replyTo && !extra.reply_parameters ? { ...extra, reply_parameters: { message_id: replyTo, allow_sending_without_reply: true } } : extra);
  const reply = ctx.reply.bind(ctx), photo = ctx.replyWithPhoto.bind(ctx);
  ctx.reply = async (text, extra = {}) => { const m = await reply(typeof text === 'string' ? withHint(ctx, text, extra.parse_mode === 'HTML') : text, withReply(extra)); await own(m); return m; };
  ctx.replyWithPhoto = async (p, extra = {}) => { const m = await photo(p, withReply(extra)); await own(m); return m; };
  // Panel Owner/Admin/Developer hanya di chat pribadi (berisi data keuangan & user)
  if (/^\/(admin|owner|dev)(?:@\w+)?(?:\s|$)/i.test(ctx.message?.text || '')) {
    if (ctx.state.isStaff) await ctx.reply('🔒 Panel staf hanya bisa dibuka di chat pribadi.', { reply_markup: { inline_keyboard: [[{ text: '💬 Buka di Chat Pribadi', url: `https://t.me/${ctx.botInfo.username}?start=panel` }]] } });
    return;
  }
  return next();
};

// Satu callback per user diproses berurutan -> tap BAYAR 3x dalam 0.2 detik tidak jadi 3 transaksi
const busy = new Set();
const lock = () => async (ctx, next) => {
  if (!ctx.callbackQuery) return next();
  const id = ctx.from.id;
  if (busy.has(id)) return ctx.answerCbQuery('⏳ Mohon tunggu...').catch(() => {});
  busy.add(id);
  let answered = false; const orig = ctx.answerCbQuery.bind(ctx);
  ctx.answerCbQuery = (...a) => { answered = true; return orig(...a); };
  try { await next(); } finally { busy.delete(id); if (!answered) orig().catch(() => {}); }
};

// Tombol baru membatalkan mode input, kecuali tombol lanjutan berikut
const KEEP = ['skipzone', 'p:', 'abc_go'];
const clearState = () => async (ctx, next) => {
  const d = ctx.callbackQuery?.data;
  if (d && ctx.state.user.state && !KEEP.some((k) => d.startsWith(k))) {
    await User.updateOne({ tgId: ctx.from.id }, { $set: { state: null } });
    ctx.state.user.state = null;
  }
  return next();
};
module.exports = { rateLimit, loadUser, groupSupport, lock, clearState };
