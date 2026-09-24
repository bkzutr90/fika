const mongoose = require('mongoose');
const config = require('../config');
const { User, Order, Deposit } = require('../db');
const orderSvc = require('../services/order');
const settings = require('../services/settings');
const errors = require('../services/errors');
const { b, show } = require('../ui');
const { esc, fmtDate, STATUS } = require('../utils');

const STUCK_MS = 10 * 60 * 1000;
const up = (s) => `${Math.floor(s / 86400)}h ${Math.floor((s % 86400) / 3600)}j ${Math.floor((s % 3600) / 60)}m`;

async function devHome(ctx) {
  const m = settings.get('maintenance');
  const stuck = await Order.countDocuments({ status: 'processing', processingAt: { $lt: new Date(Date.now() - STUCK_MS) } });
  return show(ctx, `💻 <b>DEVELOPER PANEL</b>\n\n🚧 Maintenance: <b>${m ? 'ON' : 'OFF'}</b>\n⏱ Order stuck (&gt;10 menit): <b>${stuck}</b>\n🐞 Error tercatat: <b>${errors.list().length}</b>`, [
    [b('📡 Status Sistem', 'dvs'), b(m ? '✅ Matikan Maintenance' : '🚧 Aktifkan Maintenance', 'dvm')],
    [b('🐞 Error Log', 'dve'), b('⏱ Order Stuck', 'dvo')],
    [b('🏠 Menu', 'menu')],
  ]);
}

async function orderView(ctx, trxId) {
  const o = await Order.findOne({ trxId }); if (!o) return ctx.answerCbQuery('Order tidak ditemukan', { show_alert: true });
  const text = `🔎 <b>${o.trxId}</b> (teknis)\n\n<pre>${esc(`Status   : ${STATUS[o.status]}\nGame     : ${o.gameName}\nProduk   : ${o.productName}\nSKU      : ${o.sku}\nTarget   : ${o.target}${o.zone ? ' / ' + o.zone : ''}\nProv.Ref : ${o.providerRef || '-'}\nCatatan  : ${o.note || '-'}\nDibuat   : ${fmtDate(o.createdAt)}\nProses   : ${o.processingAt ? fmtDate(o.processingAt) : '-'}`)}</pre>`;
  const kb = [];
  if (['processing', 'failed'].includes(o.status)) kb.push([b('🔁 Retry ke Provider', `dvr:${o.trxId}`)]);
  kb.push([b('⬅️ Order Stuck', 'dvo'), b('💻 Panel', 'dv')]);
  return show(ctx, text, kb);
}

function register(bot) {
  const D = (pattern, fn) => bot.action(pattern, async (ctx) => (ctx.state.isDev ? fn(ctx) : ctx.answerCbQuery('⛔ Khusus developer', { show_alert: true })));
  bot.command('dev', (ctx) => ctx.state.isDev && devHome(ctx));
  D('dv', devHome);

  D('dvs', async (ctx) => {
    const t0 = Date.now(); let db = '✅'; try { await mongoose.connection.db.admin().ping(); } catch { db = '❌'; }
    const ping = Date.now() - t0;
    const [users, proc, dep] = await Promise.all([User.countDocuments(), Order.countDocuments({ status: 'processing' }), Deposit.countDocuments({ status: 'waiting_review' })]);
    const mem = Math.round(process.memoryUsage().rss / 1048576);
    const rows = `Uptime   : ${up(process.uptime())}\nNode     : ${process.version}\nMemori   : ${mem} MB\nMongoDB  : ${db} ${ping} ms\nMode     : long polling\nProvider : ${config.provider}${config.provider === 'digiflazz' ? ` (kredensial ${config.digiflazz.username && config.digiflazz.key ? '✅' : '❌ belum diisi'})` : ''}\nQRIS img : ${config.deposit.qrisImage ? '✅' : '—'}\nMaintenance : ${settings.get('maintenance') ? 'ON' : 'OFF'}\n\nUser     : ${users}\nProcessing : ${proc}\nDeposit pending : ${dep}\nOwner/Dev/Admin : ${config.ownerIds.length}/${config.devIds.length}/${config.adminIds.length}`;
    return show(ctx, `📡 <b>STATUS SISTEM</b>\n\n<pre>${esc(rows)}</pre>`, [[b('🔄 Refresh', 'dvs'), b('⬅️ Panel', 'dv')]]);
  });

  D('dvm', async (ctx) => { await settings.set('maintenance', !settings.get('maintenance')); return devHome(ctx); });

  D('dve', async (ctx) => {
    const rows = errors.list().slice(0, 8).map((e) => `🕒 ${fmtDate(e.at)}\n<b>${esc(e.where)}</b>\n<code>${esc(e.msg)}</code>`).join('\n\n') || 'Belum ada error 🎉';
    return show(ctx, `🐞 <b>ERROR LOG</b> (di memori, reset saat restart)\n\n${rows}`, [[b('🗑 Bersihkan', 'dvc'), b('⬅️ Panel', 'dv')]]);
  });
  D('dvc', async (ctx) => { errors.clear(); return devHome(ctx); });

  D('dvo', async (ctx) => {
    const list = await Order.find({ status: 'processing', processingAt: { $lt: new Date(Date.now() - STUCK_MS) } }).sort({ processingAt: 1 }).limit(10);
    return show(ctx, `⏱ <b>ORDER STUCK</b> (processing &gt; 10 menit): ${list.length}`, [...list.map((o) => [b(`${o.trxId} • ${o.productName}`.slice(0, 60), `dvv:${o.trxId}`)]), [b('⬅️ Panel', 'dv')]]);
  });
  D(/^dvv:(.+)$/, (ctx) => orderView(ctx, ctx.match[1]));
  D(/^dvr:(.+)$/, async (ctx) => {
    const r = await orderSvc.retry(ctx.match[1]);
    if (!r.ok) return ctx.answerCbQuery(r.msg, { show_alert: true });
    return orderView(ctx, ctx.match[1]);
  });
}
module.exports = { register, inputs: {} };
