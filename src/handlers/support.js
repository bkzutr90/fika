const config = require('../config');
const { User, Order, Ticket, newId } = require('../db');
const notify = require('../services/notify');
const { setState } = require('../services/state');
const { b, url, show } = require('../ui');
const { esc, rp, STATUS } = require('../utils');

const INFO = {
  faq: `📜 <b>FAQ</b>\n\n<b>Berapa lama proses topup?</b>\nUmumnya 1-10 menit, tergantung game.\n\n<b>Saldo terpotong tapi gagal?</b>\nJika gagal, saldo otomatis dikembalikan.\n\n<b>Salah ID?</b>\nKesalahan ID/Zone ID menjadi tanggung jawab pengguna.\n\n<b>Kapan deposit masuk?</b>\nSetelah bukti dikirim & diverifikasi admin.`,
  howto: `❓ <b>CARA TOPUP</b>\n\n1️⃣ Deposit saldo lewat menu 💳 Deposit\n2️⃣ Buka 🎮 Topup Game, pilih game\n3️⃣ Masukkan ID (& Zone ID bila ada)\n4️⃣ Pilih nominal\n5️⃣ Cek konfirmasi, tekan ✅ BAYAR → ✅ LANJUTKAN\n6️⃣ Tunggu status berubah menjadi ✅ Sukses`,
  depissue: `💰 <b>MASALAH DEPOSIT</b>\n\n• Pastikan transfer sesuai <b>total bayar</b> (termasuk kode unik)\n• Pastikan sudah menekan <b>Kirim Bukti</b> dan mengirim screenshot\n• Verifikasi dilakukan admin secara manual\n\nMasih bermasalah? Buat tiket ke admin.`,
  trxissue: `🎮 <b>MASALAH TOPUP</b>\n\nBuka <b>📜 Riwayat</b> → pilih transaksi → <b>🚨 LAPORKAN MASALAH</b>. Admin akan menerima tiket lengkap dengan data transaksi.`,
};

function ticketView(t, u, o) {
  const text = `🎫 <b>TIKET</b> <code>${t.tid}</code> (${t.status})\n\nUser: ${esc(u.name)}${u.username ? ' (@' + esc(u.username) + ')' : ''} — <code>${u.uid}</code>\nTG ID: <code>${u.tgId}</code>` +
    (o ? `\n\n<pre>${esc(`TRX    : ${o.trxId}\nGame   : ${o.gameName}\nProduk : ${o.productName}\nUser   : ${o.target}\nZone   : ${o.zone || '-'}\nHarga  : ${rp(o.price)}\nStatus : ${STATUS[o.status]}`)}</pre>` : '') +
    `\n\n<b>Pesan:</b>\n${esc(t.message)}`;
  const kb = [[b('💬 Balas', `tk_r:${t.tid}`), b('✅ Tutup', `tk_c:${t.tid}`)]];
  if (o) kb.push([b('📦 Detail Order', `aot:${o.trxId}`)]);
  return { text, kb };
}

function register(bot) {
  bot.action('help', (ctx) => show(ctx, `📞 <b>BANTUAN</b>\n\n👑 Owner: ${config.ownerUsername ? '@' + esc(config.ownerUsername) : '-'}\n💻 Developer: ${config.devUsername ? '@' + esc(config.devUsername) : '-'}\n\nOwner mengurus pesanan, deposit & refund. Developer mengurus bug/error sistem.\n\nAda kendala? Pilih di bawah:`, [
    [config.ownerUsername ? url('👑 Chat Owner', `https://t.me/${config.ownerUsername}`) : b('👑 Hubungi Owner', 'rep:-'), ...(config.devUsername ? [url('💻 Developer', `https://t.me/${config.devUsername}`)] : [])],
    [b('📜 FAQ', 'info:faq'), b('❓ Cara Topup', 'info:howto')],
    [b('💰 Masalah Deposit', 'info:depissue'), b('🎮 Masalah Topup', 'info:trxissue')],
    [b('🎫 Buat Tiket', 'rep:-')],
    [b('🏠 Menu', 'menu')],
  ]));
  bot.action(/^info:(faq|howto|depissue|trxissue)$/, (ctx) => show(ctx, INFO[ctx.match[1]], [[b('⬅️ Bantuan', 'help')]]));

  bot.action(/^rep:(.+)$/, async (ctx) => {
    const trx = ctx.match[1] === '-' ? '' : ctx.match[1];
    await setState(ctx, { action: 'report', trx });
    return show(ctx, `🚨 <b>LAPORKAN MASALAH</b>${trx ? `\nTransaksi: <code>${esc(trx)}</code>` : ''}\n\nJelaskan masalah kamu dalam 1 pesan:`, [[b('❌ Batal', 'help')]]);
  });

  const adm = (fn) => async (ctx) => (ctx.state.isAdmin ? fn(ctx) : ctx.answerCbQuery('⛔ Khusus admin', { show_alert: true }));
  bot.action(/^tk_r:(.+)$/, adm(async (ctx) => {
    await setState(ctx, { action: 'adm_reply', tid: ctx.match[1] });
    return ctx.reply(`💬 Ketik balasan untuk tiket <code>${ctx.match[1]}</code>:`, { parse_mode: 'HTML' });
  }));
  bot.action(/^tk_c:(.+)$/, adm(async (ctx) => {
    await Ticket.updateOne({ tid: ctx.match[1] }, { $set: { status: 'closed' } });
    return ctx.reply(`✅ Tiket ${ctx.match[1]} ditutup.`);
  }));
  bot.action(/^tk_v:(.+)$/, adm(async (ctx) => {
    const t = await Ticket.findOne({ tid: ctx.match[1] }); if (!t) return;
    const [u, o] = await Promise.all([User.findOne({ tgId: t.tgId }), t.trxId ? Order.findOne({ trxId: t.trxId }) : null]);
    const v = ticketView(t, u, o);
    return show(ctx, v.text, [...v.kb, [b('⬅️ Tiket', 'atk')]]);
  }));
  bot.action('atk', adm(async (ctx) => {
    const list = await Ticket.find({ status: 'open' }).sort({ createdAt: -1 }).limit(15);
    return show(ctx, `🎫 <b>TIKET TERBUKA</b> (${list.length})`, [...list.map((t) => [b(`${t.tid}${t.trxId ? ' • ' + t.trxId : ''}`, `tk_v:${t.tid}`)]), [b('⬅️ Admin', 'adm')]]);
  }));
}

const inputs = {
  async report(ctx, st, text) {
    const u = ctx.state.user;
    const t = await Ticket.create({ tid: await newId('TKT', 'tkt'), tgId: u.tgId, trxId: st.trx || '', message: text.slice(0, 1000) });
    await setState(ctx, null);
    const o = st.trx ? await Order.findOne({ trxId: st.trx, tgId: u.tgId }) : null;
    const v = ticketView(t, u, o);
    await notify.admins(v.text, v.kb);
    return ctx.reply(`✅ Tiket <b>${t.tid}</b> terkirim. Admin akan segera membalas.`, { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[b('🏠 Menu', 'menu')]] } });
  },
  async adm_reply(ctx, st, text) {
    const t = await Ticket.findOneAndUpdate({ tid: st.tid }, { $set: { status: 'closed' } }, { new: true });
    await setState(ctx, null);
    if (!t) return ctx.reply('Tiket tidak ditemukan.');
    await notify.user(t.tgId, `💬 <b>Balasan admin</b> untuk tiket <code>${t.tid}</code>:\n\n${esc(text)}`, [[b('📞 Bantuan', 'help')]]);
    return ctx.reply('✅ Balasan terkirim, tiket ditutup.');
  },
};
module.exports = { register, inputs };
