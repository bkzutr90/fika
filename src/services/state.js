const { User } = require('../db');
// st berisi { action, ... }; 'at' dipakai untuk kedaluwarsa otomatis (15 menit)
async function setState(ctx, st) {
  const v = st ? { ...st, at: Date.now() } : null;
  await User.updateOne({ tgId: ctx.from.id }, { $set: { state: v } });
  ctx.state.user.state = v;
}
module.exports = { setState };
