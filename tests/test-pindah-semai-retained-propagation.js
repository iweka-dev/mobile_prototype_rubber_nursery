import assert from 'node:assert/strict';

const memory = new Map();
globalThis.localStorage = {
  getItem: key => memory.has(key) ? memory.get(key) : null,
  setItem: (key, value) => memory.set(key, String(value)),
  removeItem: key => memory.delete(key),
  clear: () => memory.clear()
};
globalThis.window = globalThis;
globalThis.CustomEvent = class { constructor(type, options) { this.type = type; this.detail = options?.detail; } };
globalThis.dispatchEvent = () => {};

const { storage } = await import('../js/core/storage.js');
const { integrateSeedingToSelectionPool } = await import('../js/modules/selection/selection-manager.js');
const { getVerificationDetailData } = await import('../js/modules/verification/verification-manager.js');

const source = {
  id: 'SOW-UAT-004',
  docNo: '2026/SOW/004',
  sourceModule: 'PENYEMAIAN',
  batchId: 'BTCH-UAT-004',
  batchCode: 'BTCH-UAT-004',
  bedenganId: 'BED-UAT-004',
  bedenganCode: 'BED-004',
  totalDisemai: 28000,
  ditolak: 400,
  status: 'DISETUJUI'
};

storage.set('seeding_transactions', [source]);
storage.set('selection_pool', []);
storage.set('selection_transactions', []);

integrateSeedingToSelectionPool(source);
let pool = storage.get('selection_pool', []);
assert.equal(pool.length, 1, 'Satu kandidat afkir Pindah Semai dibentuk');
assert.equal(pool[0].jumlahAfkir, 400, 'Jumlah afkir mengikuti ditolak');
assert.equal(pool[0].jumlahLayak, 28000, 'Bibit dipertahankan mengikuti totalDisemai');
assert.equal(pool[0].actualBibitRetainedQty, 28000);
assert.equal(pool[0].bibitDipertahankan, 28000);

storage.set('selection_transactions', [{
  id: 'CULL-PS-007',
  docNo: '2026/CULL/PS/007',
  sourceModule: 'PENYEMAIAN',
  sourceTransactionType: 'SEEDING',
  originType: 'REJECT_PENYEMAIAN',
  sourceTransactionId: source.id,
  sourceDocNo: source.docNo,
  jumlahAfkir: 400,
  jumlahLayak: 0,
  bibitDipertahankan: 0,
  status: 'MENUNGGU_VERIFIKASI_ASISTEN_BIBITAN'
}]);

integrateSeedingToSelectionPool(source);
let pending = storage.get('selection_transactions', [])[0];
assert.equal(pending.jumlahLayak, 28000, 'Dokumen pending lama dipulihkan dari transaksi sumber');
assert.equal(pending.actualBibitRetainedQty, 28000);
assert.equal(pending.bibitDipertahankan, 28000);

const historical = {
  ...pending,
  jumlahLayak: 0,
  actualBibitRetainedQty: 0,
  bibitDipertahankan: 0,
  status: 'DISETUJUI',
  verificationStatus: 'TERVERIFIKASI',
  isFinal: true,
  selectionStage: 'SELEKSI_PINDAH_SEMAI',
  bedengan: 'BED-004',
  alasanDitolakCategory: 'Patah'
};
const detail = getVerificationDetailData(historical, null, 'PENYELEKSIAN');
const retainedField = detail.fields.find(field => field.label === 'Bibit Dipertahankan');
assert.equal(retainedField?.value, '28.000 Pkk', 'Detail Verifikasi dokumen historis memakai fallback sumber Pindah Semai');

console.log('PASS: Propagasi Bibit Dipertahankan Pindah Semai dan fallback dokumen historis valid.');
