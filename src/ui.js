const b = (text, data) => ({ text, callback_data: data });
const url = (text, u) => ({ text, url: u });
const grid = (arr, n = 2) => { const o = []; for (let i = 0; i < arr.length; i += n) o.push(arr.slice(i, i + n)); return o; };
const pager = (prefix, p, total, n) => {
  const pages = Math.max(1, Math.ceil(total / n)); const row = [];
  if (p > 0) row.push(b('⬅️', `${prefix}${p - 1}`));
  row.push(b(`${p + 1}/${pages}`, 'noop'));
  if (p + 1 < pages) row.push(b('➡️', `${prefix}${p + 1}`));
  return row;
};

const isGroup = (ctx) => ['group', 'supergroup'].includes(ctx.chat?.type);
const INPUT_STATES = new Set(['t_id', 't_zone', 'd_amount', 'd_proof', 'promo_code', 'report', 'refund_reason']);
// Di grup, input teks/foto harus berupa REPLY ke pesan bot -> beri petunjuk
function withHint(ctx, text, html = true) {
  const st = ctx.state?.user?.state;
  if (!isGroup(ctx) || !st || !INPUT_STATES.has(st.action) || /balas \(reply\)/.test(text)) return text;
  return text + (html ? '\n\n<i>↩️ Di grup: balas (reply) pesan ini untuk mengisi.</i>' : '\n\n↩️ Di grup: balas (reply) pesan ini untuk mengisi.');
}

// Edit pesan bila dari tombol, kirim baru bila dari teks/foto
async function show(ctx, text, kb) {
  text = withHint(ctx, text);
  const extra = { parse_mode: 'HTML', link_preview_options: { is_disabled: true } };
  if (kb) extra.reply_markup = { inline_keyboard: kb };
  if (ctx.callbackQuery) {
    try { return await ctx.editMessageText(text, extra); } catch (e) {
      if (/not modified/i.test(e.description || e.message)) return;
      try { await ctx.deleteMessage(); } catch {}
    }
  }
  return ctx.reply(text, extra);
}
module.exports = { b, url, grid, pager, show, withHint, isGroup };
