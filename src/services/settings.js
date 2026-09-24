const { Setting } = require('../db');
const cache = {};
module.exports = {
  cache,
  async load() { for (const s of await Setting.find()) cache[s.key] = s.value; },
  get: (k) => cache[k],
  async set(k, v) { cache[k] = v; await Setting.updateOne({ key: k }, { $set: { value: v } }, { upsert: true }); },
};
