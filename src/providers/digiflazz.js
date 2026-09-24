const crypto = require('crypto');
const config = require('../config');
// TEMPLATE provider API (Digiflazz). Cek dokumentasi resmi & uji dengan akun development sebelum production.
const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');
async function call(o) {
  const { username, key } = config.digiflazz;
  const res = await fetch('https://api.digiflazz.com/v1/transaction', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username, buyer_sku_code: o.sku, customer_no: `${o.target}${o.zone || ''}`,
      ref_id: o.trxId, sign: md5(username + key + o.trxId),
    }),
  });
  const { data } = await res.json();
  const s = String(data?.status || '').toLowerCase();
  if (s === 'sukses') return { status: 'success', ref: data.sn || '' };
  if (s === 'gagal') return { status: 'failed', message: data.message };
  return { status: 'pending', message: data?.message };
}
// ref_id yang sama = idempotent, jadi check() aman dipanggil berulang
module.exports = { submit: call, check: call };
