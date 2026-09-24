const { User, Ledger } = require('../db');
// Atomic: saldo tidak pernah minus, tidak ada race condition
async function adjust(tgId, delta, { type, ref = '', note = '' }) {
  const filter = delta < 0 ? { tgId, balance: { $gte: -delta } } : { tgId };
  const u = await User.findOneAndUpdate(filter, { $inc: { balance: delta } }, { new: true });
  if (!u) return null;
  if (delta !== 0) await Ledger.create({ tgId, type, amount: delta, balanceAfter: u.balance, ref, note });
  return u;
}
module.exports = { adjust };
