// Ring buffer error terakhir (di memori, reset saat restart) untuk Developer Panel
const buf = [];
module.exports = {
  record(err, where = '') {
    buf.unshift({ at: new Date(), where, msg: String(err?.message || err).slice(0, 300) });
    if (buf.length > 20) buf.pop();
  },
  list: () => buf,
  clear: () => { buf.length = 0; },
};
