const config = require('../config');
const { User, Game, Product, Order, Deposit, Ledger, Promo, Ticket, Refund } = require('../db');
const wallet = require('../services/wallet');
const orderSvc = require('../services/order');
const notify = require('../services/notify');
const { setState } = require('../services/state');
const { b, grid, pager, show } = require('../ui');
const { rp, esc, fmtDate, STATUS, startOfDayWIB, escRe, sleep } = require('../utils');

const sumOf = async (Model, match, expr) => (await Model.aggregate([{ $match: match }, { $group: { _id: null, t: { $sum: expr } } }]))[0]?.t || 0;
const back = (to = 'adm', label = '⬅️ Kembali') => [b(label, to)];
const N = 8;

async function adminHome(ctx) {
  const own = ctx.state.isOwner;
  const [dep, proc, tk, rf] = await Promise.all([Deposit.countDocuments({ status: 'waiting_review' }), Order.countDocuments({ status: 'processing' }), Ticket.countDocuments({ status: 'open' }), own ? Refund.countDocuments({ status: 'pending' }) : 0]);
  const text = `${own ? '👑 <b>OWNER PANEL</b>' : '🛠 <b>ADMIN PANEL</b>'}\n\n💳 Deposit menunggu: <b>${dep}</b>\n📦 Order processing: <b>${proc}</b>\n🎫 Tiket terbuka: <b>${tk}</b>` + (own ? `\n💸 Refund menunggu: <b>${rf}</b>` : '');
  const kb = own ? [
    [b('👥 User', 'au'), b('💰 Keuangan', 'af')],
    [b('🎮 Produk', 'ap'), b('📦 Transaksi', 'ao')],
    [b('📊 Statistik', 'as'), b('🎟 Promo', 'apr')],
    [b('💳 Deposit Pending', 'adep'), b('🎫 Tiket', 'atk')],
    [b('💸 Refund', 'arf'), b('📢 Broadcast', 'abc')],
    [b('🏠 Menu', 'menu')],
  ] : [
    [b('👥 User', 'au'), b('📦 Transaksi', 'ao')],
    [b('📊 Statistik', 'as')],
    [b('💳 Deposit Pending', 'adep'), b('🎫 Tiket', 'atk')],
    [b('🏠 Menu', 'menu')],
  ];
  return show(ctx, text, kb);
}

function userView(u, own) {
  const text = `👤 <b>USER</b>\n\nNama     : ${esc(u.name)}\nUsername : ${u.username ? '@' + esc(u.username) : '-'}\nTG ID    : <code>${u.tgId}</code>\nID       : <code>${u.uid}</code>\nSaldo    : <b>${rp(u.balance)}</b>\nStatus   : ${u.banned ? '🚫 BANNED' : '✅ Aktif'}\nDaftar   : ${fmtDate(u.createdAt)}`;
  return { text, kb: [
    [b(u.banned ? '✅ Unban' : '🚫 Ban', `aub:${u.tgId}`), ...(own ? [b('💰 Edit Saldo', `abal:${u.tgId}`)] : [])],
    [b('📦 Transaksi', `auo:${u.tgId}`)],
    back('au'),
  ] };
}

function orderView(o, own, me) {
  const text = `📦 <b>${o.trxId}</b>\n\n<pre>${esc(`Game   : ${o.gameName}\nProduk : ${o.productName}\nUser   : ${o.target}\nZone   : ${o.zone || '-'}\nHarga  : ${rp(o.price)}\nModal  : ${rp(o.providerPrice)}\nProfit : ${rp(o.price - o.providerPrice)}\nStatus : ${STATUS[o.status]}\nTG ID  : ${o.tgId}\nRef    : ${o.providerRef || '-'}${o.claimedBy ? `\nOwner  : ${o.claimedBy}` : ''}\nWaktu  : ${fmtDate(o.createdAt)}`)}</pre>`;
  const kb = [];
  if (o.status === 'processing') {
    if (own && !o.claimedBy) kb.push([b('✅ Setuju', `a_ok:${o.trxId}`), b('❌ Tolak', `a_no:${o.trxId}`)]);
    else if (own && o.claimedBy === me) kb.push([b('📸 Kirim Bukti Selesai', `a_pf:${o.trxId}`), b('❌ Tolak', `a_no:${o.trxId}`)]);
    kb.push([b('🔁 Kirim Ulang ke Provider', `a_rt:${o.trxId}`)]);
  }
  if (o.proofFileId) kb.push([b('🖼 Lihat Bukti', `apf:${o.trxId}`)]);
  if (o.status === 'failed') kb.push([b('🔁 Retry', `a_rt:${o.trxId}`)]);
  kb.push([b('👤 User', `auv:${o.tgId}`), b('⬅️ Transaksi', 'ao')]);
  return { text, kb };
}

const showUser = async (ctx, tgId) => { const u = await User.findOne({ tgId }); if (!u) return ctx.reply('User tidak ditemukan.'); const v = userView(u, ctx.state.isOwner); return show(ctx, v.text, v.kb); };
const showOrder = async (ctx, trxId) => { const o = await Order.findOne({ trxId }); if (!o) return ctx.reply('Order tidak ditemukan.'); const v = orderView(o, ctx.state.isOwner, ctx.from.id); return show(ctx, v.text, v.kb); };

function register(bot) {
  const O = (pattern, fn) => bot.action(pattern, async (ctx) => (ctx.state.isOwner ? fn(ctx) : ctx.answerCbQuery('⛔ Khusus owner', { show_alert: true })));
  const A = (pattern, fn) => bot.action(pattern, async (ctx) => (ctx.state.isAdmin ? fn(ctx) : ctx.answerCbQuery('⛔ Khusus admin', { show_alert: true })));
  bot.command('admin', (ctx) => ctx.state.isAdmin && adminHome(ctx));
  bot.command('owner', (ctx) => ctx.state.isOwner && adminHome(ctx));
  A('adm', adminHome);

  // ===== USER =====
  A('au', (ctx) => show(ctx, '👥 <b>USER</b>', [[b('🔍 Cari User', 'aus'), b('📋 Daftar', 'aul:0')], back()]));
  A('aus', async (ctx) => { await setState(ctx, { action: 'adm_search' }); return show(ctx, '🔍 Kirim <b>ID (JF10001)</b>, <b>Telegram ID</b>, atau <b>@username</b>:', [back('au', '❌ Batal')]); });
  A(/^aul:(\d+)$/, async (ctx) => {
    const p = +ctx.match[1]; const total = await User.countDocuments();
    const list = await User.find().sort({ createdAt: -1 }).skip(p * N).limit(N);
    return show(ctx, `📋 <b>DAFTAR USER</b> (${total})`, [...list.map((u) => [b(`${u.banned ? '🚫 ' : ''}${u.uid} • ${u.name}`.slice(0, 60), `auv:${u.tgId}`)]), pager('aul:', p, total, N), back('au')]);
  });
  A(/^auv:(\d+)$/, (ctx) => showUser(ctx, +ctx.match[1]));
  A(/^aub:(\d+)$/, async (ctx) => {
    const u = await User.findOne({ tgId: +ctx.match[1] }); if (!u) return;
    await User.updateOne({ tgId: u.tgId }, { $set: { banned: !u.banned } });
    return showUser(ctx, u.tgId);
  });
  O(/^abal:(\d+)$/, async (ctx) => {
    await setState(ctx, { action: 'adm_bal', tgId: +ctx.match[1] });
    return ctx.reply('💰 Kirim perubahan saldo:\n<code>+50000</code> tambah\n<code>-20000</code> kurangi\n<code>=100000</code> set saldo', { parse_mode: 'HTML' });
  });
  A(/^auo:(\d+)$/, async (ctx) => {
    const list = await Order.find({ tgId: +ctx.match[1], status: { $ne: 'awaiting_confirm' } }).sort({ createdAt: -1 }).limit(10);
    return show(ctx, `📦 <b>Transaksi user</b> (${list.length} terakhir)`, [...list.map((o) => [b(`${o.trxId} • ${o.productName} • ${rp(o.price)}`.slice(0, 60), `aot:${o.trxId}`)]), back(`auv:${ctx.match[1]}`)]);
  });

  // ===== KEUANGAN =====
  O('af', async (ctx) => {
    const [dep, sales, cost, refund, liab, mut] = await Promise.all([
      sumOf(Deposit, { status: 'paid' }, '$amount'), sumOf(Order, { status: 'success' }, '$price'), sumOf(Order, { status: 'success' }, '$providerPrice'),
      sumOf(Ledger, { type: 'refund' }, '$amount'), sumOf(User, {}, '$balance'), Ledger.find().sort({ createdAt: -1 }).limit(8)]);
    const m = mut.map((r) => `${r.amount > 0 ? '+' : '-'}${rp(Math.abs(r.amount))} • ${esc(r.type)} • ${esc(r.ref || '-')}`).join('\n') || '-';
    return show(ctx, `💰 <b>KEUANGAN</b>\n\nTotal deposit  : ${rp(dep)}\nTotal penjualan: ${rp(sales)}\nProfit         : <b>${rp(sales - cost)}</b>\nTotal refund   : ${rp(refund)}\nSaldo user (kewajiban): ${rp(liab)}\n\n<b>Mutasi terakhir:</b>\n${m}`, [back()]);
  });

  // ===== PRODUK =====
  O('ap', async (ctx) => {
    const games = await Game.find().sort({ sort: 1, name: 1 });
    return show(ctx, '🎮 <b>PRODUK</b>\n\nPilih game untuk kelola produk:', [...grid(games.map((g) => b(`${g.active ? '' : '⏸ '}${g.emoji} ${g.name}`, `apg:${g.key}`)), 2), [b('➕ Tambah Game', 'apag'), b('➕ Tambah Produk', 'apap')], back()]);
  });
  O(/^apg:(.+)$/, async (ctx) => {
    const g = await Game.findOne({ key: ctx.match[1] }); if (!g) return;
    const ps = await Product.find({ gameKey: g.key }).sort({ sort: 1, userPrice: 1 });
    return show(ctx, `${g.emoji} <b>${esc(g.name)}</b> (${g.active ? 'aktif' : 'nonaktif'})\nZone: ${g.zone}`, [[b(g.active ? '⏸ Nonaktifkan Game' : '▶️ Aktifkan Game', `apgt:${g.key}`)], ...ps.map((p) => [b(`${p.active ? '✅' : '⏸'} ${p.name} — ${rp(p.userPrice)}`.slice(0, 60), `apv:${p._id}`)]), back('ap')]);
  });
  O(/^apgt:(.+)$/, async (ctx) => { const g = await Game.findOne({ key: ctx.match[1] }); if (g) await Game.updateOne({ key: g.key }, { $set: { active: !g.active } }); ctx.match[1] = g.key; return show(ctx, 'Status game diubah.', [back(`apg:${g.key}`)]); });
  const prodView = async (ctx, id) => {
    const p = await Product.findById(id); if (!p) return;
    return show(ctx, `💎 <b>${esc(p.name)}</b>\n\nKode SKU : <code>${esc(p.code)}</code>\nHarga provider : ${rp(p.providerPrice)}\nHarga user     : ${rp(p.userPrice)}\nMarkup user    : ${p.providerPrice ? Math.round(((p.userPrice - p.providerPrice) / p.providerPrice) * 1000) / 10 : 0}%\nStatus : ${p.active ? '✅ aktif' : '⏸ nonaktif'}`,
      [[b(p.active ? '⏸ Nonaktifkan' : '▶️ Aktifkan', `apt:${p._id}`), b('✏️ Edit Harga', `ape:${p._id}`)], [b('🗑 Hapus', `apd:${p._id}`)], back(`apg:${p.gameKey}`)]);
  };
  O(/^apv:(.+)$/, (ctx) => prodView(ctx, ctx.match[1]));
  O(/^apt:(.+)$/, async (ctx) => { const p = await Product.findById(ctx.match[1]); await Product.updateOne({ _id: p._id }, { $set: { active: !p.active } }); return prodView(ctx, p._id); });
  O(/^ape:(.+)$/, async (ctx) => { await setState(ctx, { action: 'adm_price', id: ctx.match[1] }); return ctx.reply('✏️ Kirim harga: <code>provider|user</code>\nContoh: <code>15000|15750</code>', { parse_mode: 'HTML' }); });
  O(/^apd:(.+)$/, async (ctx) => { const p = await Product.findByIdAndDelete(ctx.match[1]); return show(ctx, '🗑 Produk dihapus.', [back(`apg:${p?.gameKey || ''}`.replace(/:$/, ''), '⬅️ Kembali')]); });
  O('apag', async (ctx) => { await setState(ctx, { action: 'adm_addgame' }); return ctx.reply('➕ Format:\n<code>key|Nama|emoji|zone|Label ID|Label Zone</code>\nzone = none / optional / required\n\nContoh:\n<code>roblox|Roblox|🧱|optional|Username|Zone ID</code>', { parse_mode: 'HTML' }); });
  O('apap', async (ctx) => {
    await setState(ctx, { action: 'adm_addprod' });
    return ctx.reply(`➕ Format (bisa banyak baris):\n<code>gameKey|Nama|KodeSKU|HargaProvider|HargaUser</code>\nHargaUser boleh dikosongkan → otomatis markup ${config.markup.user}%.\n\nContoh:\n<code>mlbb|86 Diamonds|ML86|19500</code>`, { parse_mode: 'HTML' });
  });

  // ===== TRANSAKSI =====
  A('ao', (ctx) => show(ctx, '📦 <b>TRANSAKSI</b>\n\nFilter status:', [
    [b('🕒 Processing', 'aol:processing:0'), b('✅ Success', 'aol:success:0')],
    [b('❌ Failed', 'aol:failed:0'), b('⚠️ Refunded', 'aol:refunded:0')],
    [b('🚫 Canceled', 'aol:canceled:0')], back()]));
  A(/^aol:(\w+):(\d+)$/, async (ctx) => {
    const s = ctx.match[1]; const p = +ctx.match[2]; const q = { status: s };
    const [total, list] = await Promise.all([Order.countDocuments(q), Order.find(q).sort({ createdAt: -1 }).skip(p * N).limit(N)]);
    return show(ctx, `📦 <b>${STATUS[s]}</b> (${total})`, [...list.map((o) => [b(`${o.trxId} • ${o.productName} • ${rp(o.price)}`.slice(0, 60), `aot:${o.trxId}`)]), pager(`aol:${s}:`, p, total, N), back('ao')]);
  });
  A(/^aot:(.+)$/, (ctx) => showOrder(ctx, ctx.match[1]));
  // Setuju -> owner mengklaim order lalu diminta mengirim FOTO bukti; order baru 'success' setelah foto diterima
  const promptProof = (ctx, trxId) => ctx.reply(`📸 Kirim <b>foto bukti</b> pesanan <code>${trxId}</code> yang sudah selesai.\nCaption foto (opsional) diteruskan ke user sebagai catatan.\n\n/cancel untuk batal.`, { parse_mode: 'HTML' });
  O(/^a_ok:(.+)$/, async (ctx) => {
    const trxId = ctx.match[1];
    const prev = await Order.findOneAndUpdate({ trxId, status: 'processing', claimedBy: { $in: [null, ctx.from.id] } }, { $set: { claimedBy: ctx.from.id } });
    if (!prev) return ctx.answerCbQuery('Sudah diproses owner lain / status berubah', { show_alert: true });
    await setState(ctx, { action: 'adm_proof', trx: trxId });
    await showOrder(ctx, trxId);
    await promptProof(ctx, trxId);
    if (!prev.claimedBy) await notify.user(prev.tgId, `👍 Pesanan <b>${trxId}</b> disetujui owner dan sedang dikerjakan.`);
  });
  O(/^a_pf:(.+)$/, async (ctx) => {
    const o = await Order.findOne({ trxId: ctx.match[1], status: 'processing', claimedBy: ctx.from.id });
    if (!o) return ctx.answerCbQuery('Order tidak bisa diproses', { show_alert: true });
    await setState(ctx, { action: 'adm_proof', trx: o.trxId });
    return promptProof(ctx, o.trxId);
  });
  O(/^a_no:(.+)$/, async (ctx) => {
    const o = await Order.findOne({ trxId: ctx.match[1], status: 'processing', claimedBy: { $in: [null, ctx.from.id] } });
    if (!o) return ctx.answerCbQuery('Sudah diproses owner lain / status berubah', { show_alert: true });
    await setState(ctx, { action: 'adm_reject', trx: o.trxId });
    return ctx.reply(`❌ Ketik <b>alasan penolakan</b> untuk <code>${o.trxId}</code> (akan dikirim ke user):`, { parse_mode: 'HTML' });
  });
  A(/^apf:(.+)$/, async (ctx) => {
    const o = await Order.findOne({ trxId: ctx.match[1] });
    if (!o?.proofFileId) return ctx.answerCbQuery('Belum ada bukti', { show_alert: true });
    return ctx.replyWithPhoto(o.proofFileId, { caption: `🖼 Bukti <b>${o.trxId}</b>`, parse_mode: 'HTML' });
  });
  A(/^a_rt:(.+)$/, async (ctx) => { const r = await orderSvc.retry(ctx.match[1]); if (!r.ok) return ctx.answerCbQuery(r.msg, { show_alert: true }); return showOrder(ctx, ctx.match[1]); });

  // ===== STATISTIK =====
  A('as', async (ctx) => {
    const t0 = startOfDayWIB(); const q = { createdAt: { $gte: t0 }, status: { $ne: 'awaiting_confirm' } };
    const agg = await Order.aggregate([{ $match: q }, { $group: { _id: '$status', n: { $sum: 1 } } }]);
    const c = (s) => agg.find((x) => x._id === s)?.n || 0;
    const ok = { ...q, status: 'success' };
    const [rev, cost, users, newU, dep] = await Promise.all([sumOf(Order, ok, '$price'), sumOf(Order, ok, '$providerPrice'), User.countDocuments(), User.countDocuments({ createdAt: { $gte: t0 } }), sumOf(Deposit, { status: 'paid', updatedAt: { $gte: t0 } }, '$amount')]);
    const total = agg.reduce((a, x) => a + x.n, 0);
    return show(ctx, `📊 <b>TODAY</b>\n\nOrders       : ${total}\nSuccess      : ${c('success')}\nFailed       : ${c('failed')}\nProcessing   : ${c('processing')}\nRefunded     : ${c('refunded')}${ctx.state.isOwner ? `\n\nRevenue      : ${rp(rev)}\nProfit       : ${rp(rev - cost)}\nDeposit      : ${rp(dep)}` : ''}\n\nUsers        : ${users.toLocaleString('id-ID')} (+${newU} hari ini)`, [[b('🔄 Refresh', 'as')], back()]);
  });

  // ===== DEPOSIT PENDING =====
  A('adep', async (ctx) => {
    const list = await Deposit.find({ status: 'waiting_review' }).sort({ createdAt: 1 }).limit(10);
    if (!list.length) return show(ctx, '💳 Tidak ada deposit menunggu.', [back()]);
    for (const d of list) {
      const u = await User.findOne({ tgId: d.tgId });
      await ctx.telegram.sendPhoto(ctx.chat.id, d.proofFileId, { caption: `💰 <b>DEPOSIT</b> <code>${d.depId}</code>\nUser: ${esc(u.name)} — <code>${u.uid}</code>\nNominal: ${rp(d.amount)}\nTotal transfer: ${rp(d.payTotal)}`, parse_mode: 'HTML', reply_markup: { inline_keyboard: [[b('✅ Approve', `dep_ok:${d.depId}`), b('❌ Tolak', `dep_no:${d.depId}`)]] } }).catch(() => {});
    }
    return ctx.reply(`↑ ${list.length} deposit menunggu.`, { reply_markup: { inline_keyboard: [back()] } });
  });

  // ===== PROMO =====
  O('apr', async (ctx) => {
    const list = await Promo.find().sort({ createdAt: -1 }).limit(15);
    return show(ctx, `🎟 <b>PROMO</b>\n\nTap promo untuk aktif/nonaktif.`, [...list.map((p) => [b(`${p.active ? '✅' : '⏸'} ${p.code} • ${rp(p.bonus)} • ${p.used}/${p.maxUse}`, `aprt:${p.code}`)]), [b('➕ Tambah Promo', 'apra')], back()]);
  });
  O(/^aprt:(.+)$/, async (ctx) => { const p = await Promo.findOne({ code: ctx.match[1] }); if (p) await Promo.updateOne({ code: p.code }, { $set: { active: !p.active } }); return show(ctx, 'Status promo diubah.', [back('apr')]); });
  O('apra', async (ctx) => { await setState(ctx, { action: 'adm_addpromo' }); return ctx.reply('➕ Format: <code>KODE|BonusSaldo|MaxPemakaian|Deskripsi</code>\nContoh: <code>MERDEKA|5000|100|Bonus kemerdekaan</code>', { parse_mode: 'HTML' }); });

  // ===== BROADCAST =====
  O('abc', async (ctx) => { await setState(ctx, { action: 'adm_bc' }); return show(ctx, '📢 Kirim pesan broadcast (teks / HTML sederhana):', [back('adm', '❌ Batal')]); });
  O('abc_go', async (ctx) => {
    const st = ctx.state.user.state;
    if (st?.action !== 'adm_bc_ok') return ctx.answerCbQuery('Sesi habis', { show_alert: true });
    await setState(ctx, null);
    await show(ctx, '📢 Broadcast dikirim di background, laporan menyusul.', [back()]);
    (async () => {
      let ok = 0, fail = 0;
      for await (const u of User.find({ banned: false }).select('tgId').lean().cursor()) {
        try { await notify.tg.sendMessage(u.tgId, st.text, { parse_mode: 'HTML' }); ok++; } catch { fail++; }
        await sleep(50);
      }
      await notify.user(ctx.from.id, `📢 Broadcast selesai.\nTerkirim: ${ok}\nGagal: ${fail}`);
    })().catch((e) => console.error('broadcast', e));
  });
}

const inputs = {
  async adm_reject(ctx, st, text) {
    const o = await orderSvc.finalize(st.trx, { status: 'failed', message: text.slice(0, 300) });
    await setState(ctx, null);
    return ctx.reply(o ? `✅ Order ${st.trx} ditolak, user diberi tahu.` : '❌ Order sudah diproses sebelumnya.', { reply_markup: { inline_keyboard: [[b('📦 Order', `aot:${st.trx}`)]] } });
  },
  async adm_proof(ctx) { return ctx.reply('📸 Kirim berupa FOTO bukti (bukan teks). /cancel untuk batal.'); },
  async adm_search(ctx, st, text) {
    const q = text.trim().replace('@', '');
    const u = await User.findOne({ $or: [{ tgId: /^\d+$/.test(q) ? +q : -1 }, { uid: q.toUpperCase() }, { username: new RegExp('^' + escRe(q) + '$', 'i') }] });
    if (!u) return ctx.reply('❌ User tidak ditemukan. Coba lagi atau /cancel');
    await setState(ctx, null); const v = userView(u, ctx.state.isOwner);
    return ctx.reply(v.text, { parse_mode: 'HTML', reply_markup: { inline_keyboard: v.kb } });
  },
  async adm_bal(ctx, st, text) {
    const m = text.replace(/[.,\s]/g, '').match(/^([+\-=])(\d+)$/);
    if (!m) return ctx.reply('❌ Format salah. Contoh: +50000 / -20000 / =100000');
    const u = await User.findOne({ tgId: st.tgId }); const v = +m[2];
    const delta = m[1] === '+' ? v : m[1] === '-' ? -v : v - u.balance;
    const r = await wallet.adjust(u.tgId, delta, { type: 'admin', ref: String(ctx.from.id), note: 'Edit saldo oleh admin' });
    if (!r) return ctx.reply('❌ Saldo user tidak cukup untuk dikurangi.');
    await setState(ctx, null);
    await notify.user(u.tgId, `💰 Saldo kamu disesuaikan admin: ${delta >= 0 ? '+' : '-'}${rp(Math.abs(delta))}\nSaldo sekarang: <b>${rp(r.balance)}</b>`);
    return ctx.reply(`✅ Saldo ${u.uid}: ${rp(r.balance)}`, { reply_markup: { inline_keyboard: [[b('👤 User', `auv:${u.tgId}`)]] } });
  },
  async adm_price(ctx, st, text) {
    const [a, u] = text.split('|').map((x) => parseInt(x.replace(/\D/g, ''), 10));
    if (![a, u].every(Number.isFinite)) return ctx.reply('❌ Format: provider|user');
    await Product.updateOne({ _id: st.id }, { $set: { providerPrice: a, userPrice: u } });
    await setState(ctx, null);
    return ctx.reply('✅ Harga diperbarui.', { reply_markup: { inline_keyboard: [[b('💎 Lihat produk', `apv:${st.id}`)]] } });
  },
  async adm_addgame(ctx, st, text) {
    const [key, name, emoji, zone, idLabel, zoneLabel] = text.split('|').map((x) => x.trim());
    if (!key || !name) return ctx.reply('❌ Format salah.');
    if (zone && !['none', 'optional', 'required'].includes(zone)) return ctx.reply('❌ zone harus none/optional/required');
    try { await Game.create({ key: key.toLowerCase(), name, emoji: emoji || '🎮', zone: zone || 'none', idLabel: idLabel || 'User ID', zoneLabel: zoneLabel || 'Zone ID' }); }
    catch (e) { return ctx.reply('❌ Gagal: ' + e.message); }
    await setState(ctx, null);
    return ctx.reply(`✅ Game <b>${esc(name)}</b> ditambahkan.`, { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[b('🎮 Produk', 'ap')]] } });
  },
  async adm_addprod(ctx, st, text) {
    const ceil100 = (x) => Math.ceil(x / 100) * 100; let ok = 0; const errs = [];
    for (const line of text.split('\n').map((l) => l.trim()).filter(Boolean)) {
      const [gk, name, code, prov, usr] = line.split('|').map((x) => x.trim());
      const pp = parseInt(prov, 10);
      if (!(await Game.exists({ key: gk })) || !name || !code || !Number.isFinite(pp)) { errs.push(line); continue; }
      const up = parseInt(usr, 10);
      await Product.create({ gameKey: gk, name, code, providerPrice: pp, userPrice: Number.isFinite(up) ? up : ceil100(pp * (1 + config.markup.user / 100)) });
      ok++;
    }
    await setState(ctx, null);
    return ctx.reply(`✅ ${ok} produk ditambahkan.${errs.length ? `\n\n❌ Gagal (cek format/gameKey):\n${errs.map(esc).join('\n')}` : ''}`, { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[b('🎮 Produk', 'ap')]] } });
  },
  async adm_addpromo(ctx, st, text) {
    const [code, bonus, max, note] = text.split('|').map((x) => x.trim());
    const bn = parseInt(bonus, 10), mx = parseInt(max, 10);
    if (!code || !Number.isFinite(bn) || !Number.isFinite(mx)) return ctx.reply('❌ Format: KODE|Bonus|MaxPemakaian|Deskripsi');
    try { await Promo.create({ code: code.toUpperCase(), bonus: bn, maxUse: mx, note }); } catch (e) { return ctx.reply('❌ Gagal: ' + e.message); }
    await setState(ctx, null);
    return ctx.reply('✅ Promo ditambahkan.', { reply_markup: { inline_keyboard: [[b('🎟 Promo', 'apr')]] } });
  },
  async adm_bc(ctx, st, text) {
    await setState(ctx, { action: 'adm_bc_ok', text });
    return ctx.reply(`📢 <b>Preview:</b>\n\n${text}\n\nKirim ke semua user?`, { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[b('✅ Kirim', 'abc_go'), b('❌ Batal', 'adm')]] } })
      .catch(() => ctx.reply('❌ HTML tidak valid, kirim ulang.'));
  },
};
const photos = {
  async adm_proof(ctx, st) {
    if (!ctx.state.isOwner) { await setState(ctx, null); return; }
    const o = await Order.findOne({ trxId: st.trx, status: 'processing' });
    if (!o || o.claimedBy !== ctx.from.id) { await setState(ctx, null); return ctx.reply('Order sudah tidak bisa diproses (status berubah / owner lain).'); }
    const done = await orderSvc.finalize(st.trx, { status: 'success', ref: 'MANUAL', message: (ctx.message.caption || '').slice(0, 300), proofFileId: ctx.message.photo.at(-1).file_id });
    await setState(ctx, null);
    return ctx.reply(done ? `✅ Order ${st.trx} selesai. Bukti dikirim ke user.` : '❌ Order sudah diproses sebelumnya.', { reply_markup: { inline_keyboard: [[b('📦 Order', `aot:${st.trx}`)]] } });
  },
};
module.exports = { register, inputs, photos };
