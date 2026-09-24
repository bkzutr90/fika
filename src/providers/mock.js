const { sleep } = require('../utils');
// Untuk testing: selalu sukses setelah 1,5 detik
module.exports = { async submit() { await sleep(1500); return { status: 'success', ref: 'MOCK-' + Date.now() }; } };
