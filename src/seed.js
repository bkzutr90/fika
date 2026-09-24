const { Game, Product } = require('./db');
const config = require('./config');
const c100 = (x) => Math.ceil(x / 100) * 100;
const GAMES = [
  { key: 'mlbb', name: 'Mobile Legends', emoji: '⚔️', idLabel: 'User ID', zone: 'required' },
  { key: 'ff', name: 'Free Fire', emoji: '🔥', idLabel: 'Player ID' },
  { key: 'pubgm', name: 'PUBG Mobile', emoji: '🔫', idLabel: 'Player ID' },
  { key: 'hok', name: 'Honor of Kings', emoji: '👑', idLabel: 'User ID' },
  { key: 'roblox', name: 'Roblox', emoji: '🧱', idLabel: 'Username', zone: 'optional' },
  { key: 'genshin', name: 'Genshin Impact', emoji: '🌸', idLabel: 'UID', zone: 'required', zoneLabel: 'Server' },
  { key: 'valorant', name: 'Valorant', emoji: '🎯', idLabel: 'Riot ID (Nama#Tag)' },
  { key: 'lol', name: 'League of Legends', emoji: '🏆', idLabel: 'Riot ID (Nama#Tag)' },
];
// [gameKey, nama, sku, harga provider] -> DATA CONTOH, ganti lewat Admin Panel
const PRODUCTS = [
  ['mlbb', '86 Diamonds', 'ML86', 19500], ['mlbb', '172 Diamonds', 'ML172', 39000], ['mlbb', '257 Diamonds', 'ML257', 58000],
  ['ff', '70 Diamonds', 'FF70', 9800], ['ff', '140 Diamonds', 'FF140', 19500],
  ['pubgm', '60 UC', 'PUBG60', 14500], ['pubgm', '325 UC', 'PUBG325', 74000],
  ['hok', '80 Tokens', 'HOK80', 15000], ['hok', '240 Tokens', 'HOK240', 45000],
  ['roblox', '100 Robux', 'RBX100', 150000, 155000], ['roblox', '400 Robux', 'RBX400', 590000],
  ['genshin', '60 Genesis Crystals', 'GI60', 14500], ['genshin', '330 Genesis Crystals', 'GI330', 74000],
  ['valorant', '475 VP', 'VAL475', 51000], ['valorant', '1000 VP', 'VAL1000', 105000],
  ['lol', '575 RP', 'LOL575', 60000], ['lol', '1380 RP', 'LOL1380', 140000],
];
async function seedIfEmpty() {
  if (await Game.countDocuments()) return false;
  await Game.insertMany(GAMES.map((g, i) => ({ ...g, sort: i })));
  await Product.insertMany(PRODUCTS.map(([gameKey, name, code, p, u], i) => ({
    gameKey, name, code, providerPrice: p, sort: i,
    userPrice: u || c100(p * (1 + config.markup.user / 100)),
  })));
  console.log('🌱 Seed data contoh dibuat');
  return true;
}
module.exports = { seedIfEmpty };
if (require.main === module) {
  require('mongoose').connect(config.mongoUri).then(seedIfEmpty).then(() => process.exit(0));
}
