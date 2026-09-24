const config = require('../config');
const { User, MsgOwner } = require('../db');
const { esc } = require('../utils');
let tg;
const kbOf = (kb) => (kb ? { inline_keyboard: kb } : undefined);
const uniq = (a) => [...new Set(a)];
const ownerIds = () => config.ownerIds;
const staffIds = () => uniq([...config.ownerIds, ...config.adminIds]);
const devIds = () => (config.devIds.length ? config.devIds : config.ownerIds); // belum ada developer -> jatuh ke owner

// Staf (owner/admin/developer): kirim langsung ke chat pribadi, TIDAK pernah fallback ke grup
async function direct(id, text, kb) {
  try { return await tg.sendMessage(id, text, { parse_mode: 'HTML', reply_markup: kbOf(kb) }); }
  catch (e) { console.error(`notify ${id}: ${e.message} (pastikan sudah /start bot di chat pribadi)`); }
}
// User: coba chat pribadi; jika gagal (belum pernah /start di private), kirim ke grup terakhir dengan mention
async function deliver(id, send) {
  try { return await send(id, ''); } catch (e) {
    const u = await User.findOne({ tgId: id }).select('groupChatId name').lean();
    if (!u?.groupChatId) return console.error(`notify user ${id}: ${e.message}`);
    try {
      const m = await send(u.groupChatId, `<a href="tg://user?id=${id}">${esc(u.name)}</a>\n\n`);
      if (m) await MsgOwner.updateOne({ chatId: u.groupChatId, msgId: m.message_id }, { $set: { userId: id } }, { upsert: true });
      return m;
    } catch (e2) { console.error(`notify group ${u.groupChatId}: ${e2.message}`); }
  }
}
const n = {
  init: (t) => { tg = t; },
  get tg() { return tg; },
  user: (id, text, kb) => deliver(id, (chat, pre) => tg.sendMessage(chat, pre + text, { parse_mode: 'HTML', reply_markup: kbOf(kb) })),
  photo: (id, fileId, caption, kb) => deliver(id, (chat, pre) => tg.sendPhoto(chat, fileId, { caption: pre + caption, parse_mode: 'HTML', reply_markup: kbOf(kb) })),
  async owners(text, kb) { for (const id of ownerIds()) await direct(id, text, kb); },
  async admins(text, kb) { for (const id of staffIds()) await direct(id, text, kb); },
  async devs(text, kb) { for (const id of devIds()) await direct(id, text, kb); },
  async adminPhoto(fileId, caption, kb) {
    for (const id of staffIds()) {
      try { await tg.sendPhoto(id, fileId, { caption, parse_mode: 'HTML', reply_markup: kbOf(kb) }); }
      catch (e) { console.error(`notify adminPhoto ${id}: ${e.message}`); }
    }
  },
};
module.exports = n;
