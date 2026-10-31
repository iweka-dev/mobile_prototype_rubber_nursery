const memStore = new Map();
globalThis.localStorage = {
  get length() { return memStore.size; },
  key(index) { return [...memStore.keys()][index] || null; },
  getItem(key) { return memStore.has(key) ? memStore.get(key) : null; },
  setItem(key, value) { memStore.set(key, String(value)); },
  removeItem(key) { memStore.delete(key); },
  clear() { memStore.clear(); }
};
if (!globalThis.window) globalThis.window = globalThis;
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: {
    locks: {
      async request(_name, _options, callback) { return callback(); }
    }
  }
});

const { storage } = await import('../js/core/storage.js');
const { getAvailableQty } = await import('../js/core/batch-inventory-service.js');
const {
  getPhysicalStockLedgerFingerprint
} = await import('../js/modules/physical-stock-inspection/physical-stock-inspection-manager.js');
const {
  BAPSB_STATUS,
  createBapsbDraft,
  signBapsbAskep,
  finalizeBapsbPengurus
} = await import('../js/modules/physical-stock-inspection/physical-stock-bapsb-service.js');
const {
  applyApprovedPhysicalStockReconciliation
} = await import('../js/modules/physical-stock-inspection/physical-stock-reconciliation-service.js');
const {
  approveVerification,
  getActionableRecordsForAsb
} = await import('../js/modules/verification/verification-manager.js');
const {
  getEligibleSelectionDocsForBapb
} = await import('../js/modules/destruction/destruction-manager.js');

let passed = 0;
let failed = 0;
function check(condition, message) {
  if (condition) {
    console.log(`✓ ${message}`);
    passed += 1;
  } else {
    console.error(`✗ ${message}`);
    failed += 1;
  }
}

const batch = {
  id: 'B-PSR-01',
  batchId: 'B-PSR-01',
  batchCode: 'BTCH-PSR-01',
  estateId: 'EST-01',
  divisionId: 'DIV-01',
  status: 'AVAILABLE',
  availableQty: 1000,
  currentQty: 1000
};
storage.set('nursery_batches', [batch]);
storage.set('batch_inventory_states', [{
  batchId: batch.id,
  batchCode: batch.batchCode,
  initialQty: 1000,
  receivedQty: 1000,
  availableQty: 1000,
  status: 'AVAILABLE'
}]);
storage.set('batch_inventory_journal', [{
  id: 'JRN-B-PSR-01-1',
  batchId: batch.id,
  batchCode: batch.batchCode,
  batchSeq: 1,
  idempotencyKey: 'INIT-B-PSR-01',
  txType: 'INITIAL',
  qtyIn: 1000,
  qtyOut: 0,
  balance: 1000,
  createdAt: '2026-10-31T00:00:00.000Z'
}]);
storage.set('selection_anomaly_cases', []);
storage.set('selection_transactions', []);
storage.set('verification_transactions', []);
storage.set('physical_stock_reconciliation_intents', []);
storage.set('destruction_transactions', []);

const fingerprint = getPhysicalStockLedgerFingerprint(batch.id);
const inspection = {
  id: 'PSI-PSR-01',
  docNo: 'PSF/2026/00001',
  batchId: batch.id,
  batchCode: batch.batchCode,
  estateId: batch.estateId,
  divisionId: batch.divisionId,
  status: 'MIXED',
  differenceProfile: 'MIXED',
  systemQtySnapshot: 1000,
  physicalQty: 1100,
  difference: 100,
  ledgerFingerprint: fingerprint,
  reconciliationSnapshot: {
    reconciliationStatus: 'EXACT_MATCH',
    officialBatchBalance: 1000,
    attributedBedenganReferenceTotal: 1000,
    unallocatedBatchBalance: 0
  },
  counts: [
    { bedenganId: 'BED-01', bedenganCode: 'BED-001', referenceStatus: 'VALID', referenceQty: 500, physicalQty: 800, difference: 300, reason: 'Temuan bibit belum tercatat' },
    { bedenganId: 'BED-02', bedenganCode: 'BED-002', referenceStatus: 'VALID', referenceQty: 500, physicalQty: 300, difference: -200, reason: 'Bibit mati di lapangan' }
  ]
};
storage.set('physical_stock_inspections', [inspection]);

const asb = {
  id: 'ASB-01',
  userId: 'ASB-01',
  name: 'ASB Test',
  role: 'ASISTEN_BIBITAN',
  estateId: batch.estateId,
  divisionId: batch.divisionId
};
const askep = { id: 'ASKEP-01', userId: 'ASKEP-01', name: 'Askep Test', role: 'ASKEP', estateId: batch.estateId };
const pengurus = { id: 'PENGURUS-01', userId: 'PENGURUS-01', name: 'Pengurus Test', role: 'PENGURUS', estateId: batch.estateId };

console.log('=== PHYSICAL STOCK RECONCILIATION WORKFLOW ===');
const draft = createBapsbDraft(inspection.id, asb, { signatureDataUrl: 'data:image/png;base64,asb', justifikasi: 'Rekonsiliasi test' });
check(draft.status === BAPSB_STATUS.MENUNGGU_PERSETUJUAN_ASKEP, 'ASB membentuk satu BA Rekonsiliasi untuk hasil campuran');
check(draft.totalSurplusQty === 300 && draft.totalShortageQty === 200, 'BA menyimpan total lebih dan kurang secara terpisah');
signBapsbAskep(draft.id, askep, { signatureDataUrl: 'data:image/png;base64,askep' });
const reconciliation = finalizeBapsbPengurus(draft.id, pengurus, { signatureDataUrl: 'data:image/png;base64,pengurus' });
check(reconciliation.status === BAPSB_STATUS.FINAL_PENDING_APPLICATION, 'Pengesahan Pengurus tidak langsung memutasi stok');
check(storage.get('verification_transactions', []).some(item => item.referenceId === reconciliation.id && item.verificationStatus === 'MENUNGGU_VERIFIKASI'), 'BA final masuk antrean Central Hub Pemeriksaan');
check(getActionableRecordsForAsb(asb).some(item => item.referenceType === 'PHYSICAL_STOCK_RECONCILIATION' && item.referenceId === reconciliation.id), 'BA final tampil sebagai aksi Terapkan Rekonsiliasi di Central Hub');
const first = await approveVerification({
  referenceType: 'PHYSICAL_STOCK_RECONCILIATION',
  referenceId: reconciliation.id,
  currentUser: asb
});
check(first.document.status === BAPSB_STATUS.APPLIED, 'BA berubah menjadi DITERAPKAN');
check(getAvailableQty(batch.id) === 1100, 'Saldo akhir = 1000 + 300 - 200 = 1100');

const journals = storage.get('batch_inventory_journal', []).filter(item => item.reconciliationId === reconciliation.id);
check(journals.length === 2, 'Surplus dan shortage menghasilkan dua jurnal terpisah');
check(journals.some(item => item.txType === 'PHYSICAL_STOCK_RECONCILIATION_SURPLUS' && item.qtyIn === 300), 'Jurnal surplus +300 tercatat');
check(journals.some(item => item.txType === 'PHYSICAL_STOCK_RECONCILIATION_SHORTAGE' && item.qtyOut === 200), 'Jurnal shortage -200 tercatat');

const selections = storage.get('selection_transactions', []);
check(selections.length === 1 && selections[0].jumlahAfkir === 200, 'Dokumen afkir 200 Pkk terbentuk satu kali');
check(selections[0].status === 'DISETUJUI' && selections[0].stockMutationStatus === 'APPLIED', 'Dokumen afkir disahkan melalui BA tanpa approval ASB ulang');
check(getEligibleSelectionDocsForBapb(asb).some(item => item.id === selections[0].id), 'Dokumen afkir siap menjadi sumber Pemusnahan');

await applyApprovedPhysicalStockReconciliation(reconciliation.id, asb);
const journalsAfterRetry = storage.get('batch_inventory_journal', []).filter(item => item.reconciliationId === reconciliation.id);
check(journalsAfterRetry.length === 2 && getAvailableQty(batch.id) === 1100, 'Retry idempoten tidak menggandakan jurnal atau saldo');
check(storage.get('selection_transactions', []).length === 1, 'Retry tidak menggandakan dokumen afkir');

console.log(`SUMMARY: ${passed} PASSED, ${failed} FAILED`);
if (failed) process.exitCode = 1;

