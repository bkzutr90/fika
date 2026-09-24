const { esc, rp } = require('../utils');
// Mode manual: order masuk ke Owner: Setuju -> kirim foto bukti -> selesai; atau Tolak + alasan
module.exports = {
  async submit(o, { admins }) {
    await admins(
      `🆕 <b>ORDER MASUK</b>\n\n<pre>${esc(`TRX    : ${o.trxId}\nGame   : ${o.gameName}\nProduk : ${o.productName}\nUser   : ${o.target}\nZone   : ${o.zone || '-'}\nHarga  : ${rp(o.price)}`)}</pre>\nTekan <b>Setuju</b> untuk mengerjakan, lalu kirim <b>foto bukti</b> setelah selesai. Atau <b>Tolak</b> dengan alasan.`,
      [[{ text: '✅ Setuju', callback_data: `a_ok:${o.trxId}` }, { text: '❌ Tolak', callback_data: `a_no:${o.trxId}` }]]
    );
    return { status: 'pending' };
  },
};
