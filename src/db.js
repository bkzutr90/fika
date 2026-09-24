const mongoose = require('mongoose');
const { Schema } = mongoose;
const M = (name, def) => mongoose.model(name, new Schema(def, { timestamps: true }));

const User = M('User', {
  tgId: { type: Number, unique: true }, uid: { type: String, unique: true },
  username: String, name: String,
  balance: { type: Number, default: 0 }, banned: { type: Boolean, default: false }, groupChatId: Number,
  state: { type: Schema.Types.Mixed, default: null },
});
const Game = M('Game', {
  key: { type: String, unique: true }, name: String, emoji: { type: String, default: '🎮' },
  idLabel: { type: String, default: 'User ID' },
  zone: { type: String, enum: ['none', 'optional', 'required'], default: 'none' },
  zoneLabel: { type: String, default: 'Zone ID' },
  active: { type: Boolean, default: true }, sort: { type: Number, default: 0 },
});
const Product = M('Product', {
  gameKey: { type: String, index: true }, code: String, name: String,
  providerPrice: Number, userPrice: Number,
  active: { type: Boolean, default: true }, sort: { type: Number, default: 0 },
});
const Order = M('Order', {
  trxId: { type: String, unique: true }, tgId: { type: Number, index: true },
  gameKey: String, gameName: String, productId: String, productName: String, sku: String,
  target: String, zone: { type: String, default: '' },
  price: Number, providerPrice: Number,
  status: { type: String, default: 'awaiting_confirm', index: true },
  refunded: { type: Boolean, default: false }, providerRef: String, note: String,
  chatId: Number, msgId: Number, processingAt: Date, finishedAt: Date, claimedBy: Number, proofFileId: String,
});
const Deposit = M('Deposit', {
  depId: { type: String, unique: true }, tgId: { type: Number, index: true },
  amount: Number, payTotal: Number, bonus: { type: Number, default: 0 },
  status: { type: String, default: 'pending', index: true }, // pending|waiting_review|paid|rejected|canceled
  proofFileId: String, reviewedBy: Number,
});
const Ledger = M('Ledger', { tgId: { type: Number, index: true }, type: String, amount: Number, balanceAfter: Number, ref: String, note: String });
const Ticket = M('Ticket', { tid: { type: String, unique: true }, tgId: Number, trxId: String, message: String, status: { type: String, default: 'open' } });
const Refund = M('Refund', { refundId: { type: String, unique: true }, trxId: { type: String, index: true }, tgId: Number, reason: String, status: { type: String, default: 'pending', index: true }, adminNote: String, reviewedBy: Number });
const Setting = M('Setting', { key: { type: String, unique: true }, value: Schema.Types.Mixed });
const Promo = M('Promo', {
  code: { type: String, unique: true }, bonus: Number, maxUse: Number,
  used: { type: Number, default: 0 }, usedBy: [Number], active: { type: Boolean, default: true }, note: String,
});
// Pemilik pesan menu di grup (tombol hanya bisa ditekan pemiliknya). Otomatis dihapus setelah 7 hari.
const MsgOwner = mongoose.model('MsgOwner', new Schema({
  chatId: Number, msgId: Number, userId: Number, createdAt: { type: Date, default: Date.now, expires: 60 * 60 * 24 * 7 },
}).index({ chatId: 1, msgId: 1 }, { unique: true }));
const Counter = mongoose.model('Counter', new Schema({ _id: String, seq: { type: Number, default: 0 } }));

const nextSeq = async (name) => (await Counter.findOneAndUpdate({ _id: name }, { $inc: { seq: 1 } }, { new: true, upsert: true })).seq;
const newId = async (prefix, name) => prefix + (10000 + (await nextSeq(name)));

module.exports = { User, Game, Product, Order, Deposit, Ledger, Ticket, Refund, Promo, Setting, MsgOwner, newId };
