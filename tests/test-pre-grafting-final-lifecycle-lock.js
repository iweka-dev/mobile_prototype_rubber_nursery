import assert from 'node:assert/strict';
import { storage } from '../js/core/storage.js';
import {
  PRE_GRAFTING_SELECTION_DOC_STORAGE_KEY,
  SELECTION_STORAGE_KEY,
  SELECTION_STAGES,
  assertSelectionStageMutable,
  createSelection2DocumentFromSelection1,
  createSelection3DocumentFromSelection2,
  createSeleksi1ExecutionTransaction,
  createSeleksi2ExecutionTransaction,
  createSeleksi3ExecutionTransaction,
  getPreGraftingSelectionDocuments,
  getSeleksi1ExecutionsByDocument,
  isSelectionDocumentFinal,
  migrateLegacyAggregateSelection1Documents,
  reconcilePreGraftingSelectionLifecycle,
  selectionDocumentRequiresCorrection,
  syncAllSeedingsToPreGraftingSelectionDocuments
} from '../js/modules/selection/selection-manager.js';
import { renderGlobalChildTransactionsSection } from '../js/modules/selection/selection-landing.js';

if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map();
  globalThis.localStorage = {
    getItem: key => store.get(key) || null,
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: key => store.delete(key),
    clear: () => store.clear()
  };
}

const approvedSow = (id, docNo, qty = 200, polybag = 100) => ({
  id,
  docNo,
  batchId: 'BATCH-BTCH-LOCK',
  batchCode: 'BTCH-LOCK',
  bedenganId: 'BED-001',
  bedenganCode: 'BED-001',
  totalDisemai: qty,
  totalPolybag: polybag,
  status: 'DISETUJUI',
  verificationStatus: 'TERVERIFIKASI',
  rows: [{ batchId: 'BATCH-BTCH-LOCK', batchCode: 'BTCH-LOCK', bedenganId: 'BED-001', bedenganCode: 'BED-001', disemai: qty, polybag }]
});

const finalDoc = {
  id: 'SEL1-FINAL-001',
  docNo: '2026/SEL/901',
  selectionStage: SELECTION_STAGES.SELEKSI_1,
  selectionType: 'PRA_OKULASI',
  batchId: 'BATCH-BTCH-LOCK',
  batchCode: 'BTCH-LOCK',
  bedenganId: 'BED-001',
  bedenganCode: 'BED-001',
  bedenganIds: ['BED-001'],
  sourceDocNo: '2026/SOW/901',
  sourceSeedingDocNos: ['2026/SOW/901', '2026/SOW/902'],
  sourceBibitQty: 400,
  sourcePolybagQty: 200,
  currentBibitQty: 390,
  currentPolybagQty: 200,
  totalLayak: 390,
  totalAfkir: 10,
  totalDiperiksa: 200,
  progress: 100,
  status: 'DISETUJUI',
  verificationStatus: 'TERVERIFIKASI',
  isCompleted: true,
  isFinal: true,
  verifiedAt: '2026-10-31T10:00:00.000Z',
  rows: [{ bedenganId: 'BED-001', bedenganCode: 'BED-001', polybag: 200, disemai: 400, sourceBibitQty: 400 }]
};

const approvedExecution = {
  id: 'SEL1-EXEC-901',
  docNo: '2026/SEL-I/901',
  selectionStage: SELECTION_STAGES.SELEKSI_1,
  transactionType: 'PELAKSANAAN_SELEKSI_I',
  parentSelectionDocumentId: finalDoc.id,
  parentSelectionDocNo: finalDoc.docNo,
  selectionDocumentId: finalDoc.id,
  selectionDocNo: finalDoc.docNo,
  batchCode: 'BTCH-LOCK',
  bedenganId: 'BED-001',
  bedenganCode: 'BED-001',
  actualPolybagInspectedQty: 200,
  actualBibitSelectedQty: 10,
  actualBibitRetainedQty: 390,
  actualPolybagActiveQty: 200,
  status: 'DISETUJUI',
  verificationStatus: 'TERVERIFIKASI',
  isFinal: true
};

function reset() {
  globalThis.localStorage.clear();
  storage.set('seeding_transactions', [approvedSow('SOW-901', '2026/SOW/901'), approvedSow('SOW-902', '2026/SOW/902')]);
  storage.set(PRE_GRAFTING_SELECTION_DOC_STORAGE_KEY, [structuredClone(finalDoc)]);
  storage.set(SELECTION_STORAGE_KEY, [structuredClone(approvedExecution)]);
}

console.log('='.repeat(78));
console.log('TEST: FINAL LIFECYCLE LOCK & MULTI-SOW SAME-BED STABILITY');
console.log('='.repeat(78));

reset();
const migration = migrateLegacyAggregateSelection1Documents();
assert.equal(migration.migratedCount, 0, 'Multi-SOW pada satu Bedengan tidak boleh dimigrasikan sebagai multi-Bedengan');
assert.equal(storage.get(PRE_GRAFTING_SELECTION_DOC_STORAGE_KEY, []).length, 1);

for (let index = 0; index < 10; index += 1) {
  syncAllSeedingsToPreGraftingSelectionDocuments({ id: 'ASB-01', name: 'Asisten Bibitan' });
}
const stableDoc = getPreGraftingSelectionDocuments({}, null)[0];
assert.equal(stableDoc.id, finalDoc.id, 'Parent ID final tidak berubah setelah sinkronisasi berulang');
assert.equal(stableDoc.progress, 100, 'Progress final tetap 100%');
assert.equal(stableDoc.status, 'DISETUJUI', 'Status final tetap DISETUJUI');
assert.equal(stableDoc.sourcePolybagQty, 200, 'Snapshot polybag final tidak berubah');
assert.equal(isSelectionDocumentFinal(stableDoc), true);

const stage2 = createSelection2DocumentFromSelection1(stableDoc, { id: 'ASB-01', name: 'Asisten Bibitan' });
assert.equal(stage2.sourceSelectionDocumentId, stableDoc.id);
assert.equal(stage2.sourceFinalBibitQty, 390, 'Seleksi II membawa snapshot bibit final Seleksi I');
assert.equal(stage2.sourceFinalPolybagQty, 200, 'Seleksi II membawa snapshot polybag final Seleksi I');
assert.equal(stage2.promotionKey, `${stableDoc.id}::${SELECTION_STAGES.SELEKSI_2}`);

const stage2Execution = {
  id: 'SEL2-EXEC-901',
  docNo: '2026/SEL-II-TX/901',
  selectionStage: SELECTION_STAGES.SELEKSI_2,
  transactionType: 'PELAKSANAAN_SELEKSI_II',
  parentSelectionDocumentId: stage2.id,
  parentSelectionDocNo: stage2.docNo,
  selectionDocumentId: stage2.id,
  selectionDocNo: stage2.docNo,
  batchCode: 'BTCH-LOCK',
  bedenganCode: 'BED-001',
  actualPolybagInspectedQty: 200,
  actualPolybagActiveQty: 200,
  actualBibitSelectedQty: 5,
  actualBibitRetainedQty: 385,
  status: 'DISETUJUI',
  verificationStatus: 'TERVERIFIKASI',
  isFinal: true
};
const docsForStage3 = storage.get(PRE_GRAFTING_SELECTION_DOC_STORAGE_KEY, []);
const storedStage2 = docsForStage3.find(doc => doc.id === stage2.id);
storedStage2.status = 'DISETUJUI';
storedStage2.verificationStatus = 'TERVERIFIKASI';
storedStage2.isFinal = true;
storedStage2.isCompleted = true;
storedStage2.verifiedAt = '2026-10-31T11:00:00.000Z';
storedStage2.totalLayak = 385;
storage.set(PRE_GRAFTING_SELECTION_DOC_STORAGE_KEY, docsForStage3);
storage.set(SELECTION_STORAGE_KEY, [structuredClone(approvedExecution), stage2Execution]);

const stage3 = createSelection3DocumentFromSelection2(storedStage2, { id: 'ASB-01', name: 'Asisten Bibitan' });
assert.equal(stage3.sourceSelectionDocumentId, storedStage2.id);
assert.equal(stage3.sourceFinalBibitQty, 385, 'Seleksi III membawa snapshot bibit final Seleksi II');
assert.equal(stage3.sourceFinalPolybagQty, 200, 'Seleksi III membawa snapshot polybag final Seleksi II');
assert.equal(stage3.promotionKey, `${storedStage2.id}::${SELECTION_STAGES.SELEKSI_3}`);

assert.throws(() => createSeleksi1ExecutionTransaction({
  selectionDocumentId: stableDoc.id,
  bedenganCode: 'BED-001',
  actualPolybagInspectedQty: 1,
  actualBibitSelectedQty: 0
}, { id: 'MNT-01', name: 'Mantri' }), /final dan terkunci/i, 'Seleksi I final wajib menolak transaksi baru');

// Reproduksi data lama: parent final terpisah dari parent yang memegang transaksi approved.
reset();
const duplicate = {
  ...structuredClone(finalDoc),
  id: 'SEL1-DUP-001',
  docNo: '2026/SEL/902',
  status: 'COMPLETED',
  verificationStatus: null,
  isFinal: false,
  verifiedAt: null,
  progress: 100
};
const txOnDuplicate = {
  ...structuredClone(approvedExecution),
  parentSelectionDocumentId: duplicate.id,
  selectionDocumentId: duplicate.id,
  parentSelectionDocNo: duplicate.docNo,
  selectionDocNo: duplicate.docNo
};
storage.set(PRE_GRAFTING_SELECTION_DOC_STORAGE_KEY, [structuredClone(finalDoc), duplicate]);
storage.set(SELECTION_STORAGE_KEY, [txOnDuplicate]);

const reconciliation = reconcilePreGraftingSelectionLifecycle({ apply: true });
assert.equal(reconciliation.reconciledGroups, 1, 'Satu grup parent ganda harus direkonsiliasi');
const activeDocs = getPreGraftingSelectionDocuments({}, null);
assert.equal(activeDocs.length, 1, 'Hanya satu parent canonical yang boleh aktif');
assert.equal(isSelectionDocumentFinal(activeDocs[0]), true, 'Parent canonical tetap final');
assert.equal(activeDocs[0].progress, 100, 'Parent canonical mempertahankan progress 100%');
const reconciledTx = storage.get(SELECTION_STORAGE_KEY, []).find(tx => tx.id === approvedExecution.id);
assert.equal(reconciledTx.parentSelectionDocumentId, activeDocs[0].id, 'Transaksi approved direlasikan ke parent canonical');

// Reproduksi kasus browser: hanya ada satu parent aktif hasil sinkronisasi,
// sedangkan transaksi historis masih menunjuk parent lama yang sudah hilang.
const resetActiveDoc = {
  ...structuredClone(finalDoc),
  id: 'SEL1-ACTIVE-RESET',
  docNo: '2026/SEL/ACTIVE-RESET',
  status: 'DRAFT',
  verificationStatus: null,
  isFinal: false,
  isCompleted: false,
  verifiedAt: null,
  progress: 0,
  totalDiperiksa: 0,
  totalPolybagDiperiksa: 0
};
const orphanApprovedTx = {
  ...structuredClone(approvedExecution),
  id: 'SEL1-ORPHAN-APPROVED',
  docNo: '2026/SEL-I/ORPHAN-APPROVED',
  parentSelectionDocumentId: 'SEL1-PARENT-LAMA-HILANG',
  selectionDocumentId: 'SEL1-PARENT-LAMA-HILANG',
  parentSelectionDocNo: '2026/SEL/PARENT-LAMA',
  selectionDocNo: '2026/SEL/PARENT-LAMA',
  status: 'RECORDED',
  verificationStatus: null,
  isFinal: false,
  createdAt: '2026-10-31T08:00:00.000Z'
};
const postFinalDuplicateTx = {
  ...structuredClone(orphanApprovedTx),
  id: 'SEL1-POST-FINAL-DUPLICATE',
  docNo: '2026/SEL-I/POST-FINAL-DUPLICATE',
  actualPolybagInspectedQty: 50,
  createdAt: '2026-10-31T09:00:00.000Z'
};
storage.set(PRE_GRAFTING_SELECTION_DOC_STORAGE_KEY, [resetActiveDoc]);
storage.set(SELECTION_STORAGE_KEY, [orphanApprovedTx, postFinalDuplicateTx]);
storage.set('verification_transactions', [{
  id: 'VER-ORPHAN-APPROVED',
  referenceId: orphanApprovedTx.id,
  referenceDocNo: orphanApprovedTx.docNo,
  status: 'TERVERIFIKASI',
  verificationStatus: 'TERVERIFIKASI'
}]);

const orphanReconciliation = reconcilePreGraftingSelectionLifecycle({ apply: true });
assert.equal(orphanReconciliation.reconciledGroups, 1, 'Parent tunggal yang reset tetap harus direkonsiliasi dari bukti approval transaksi');
const healedActiveDoc = getPreGraftingSelectionDocuments({}, null)[0];
assert.equal(healedActiveDoc.id, resetActiveDoc.id, 'Parent aktif dipertahankan sebagai canonical');
assert.equal(isSelectionDocumentFinal(healedActiveDoc), true, 'Parent reset dipulihkan menjadi final');
assert.equal(healedActiveDoc.progress, 100, 'Progress parent reset dipulihkan menjadi 100%');
const healedExecutions = getSeleksi1ExecutionsByDocument(healedActiveDoc.id);
assert.equal(healedExecutions.length, 1, 'Hanya transaksi lifecycle yang disetujui yang tetap aktif');
assert.equal(healedExecutions[0].id, orphanApprovedTx.id, 'Transaksi approved lama direlasikan ke parent aktif');
assert.equal(healedExecutions[0].status, 'DISETUJUI', 'Bukti approval menyelaraskan status transaksi');
const healedSummaryHtml = renderGlobalChildTransactionsSection(
  healedExecutions,
  [healedActiveDoc],
  SELECTION_STAGES.SELEKSI_1,
  null,
  '31/10/2026'
);
assert.match(healedSummaryHtml, />\s*Disetujui\s*</, 'Badge child menggunakan status transaksi yang konsisten');
assert.doesNotMatch(healedSummaryHtml, /Disetujui Final|Tercatat Parsial|>\s*Tercatat\s*</, 'Badge child hanya memakai tiga status resmi');

const triStatusHtml = renderGlobalChildTransactionsSection([
  { ...structuredClone(orphanApprovedTx), id: 'WAITING-001', docNo: '2026/SEL-I/WAITING', status: 'RECORDED', verificationStatus: null, isFinal: false },
  { ...structuredClone(orphanApprovedTx), id: 'RETURNED-001', docNo: '2026/SEL-I/RETURNED', status: 'DIKEMBALIKAN', verificationStatus: 'DIKEMBALIKAN', isFinal: false, returnReason: 'Perbaiki nilai.' }
], [resetActiveDoc], SELECTION_STAGES.SELEKSI_1, null, '31/10/2026');
assert.match(triStatusHtml, />\s*Menunggu Verifikasi\s*</);
assert.match(triStatusHtml, />\s*Perlu Koreksi\s*</);
assert.doesNotMatch(triStatusHtml, />\s*Tercatat\s*</);

const returnedFinalDoc = {
  ...structuredClone(finalDoc),
  status: 'DIKEMBALIKAN',
  verificationStatus: 'DIKEMBALIKAN',
  returnReason: 'Perbaiki transaksi pemeriksaan.',
  correctionStatus: 'OPEN'
};
assert.equal(selectionDocumentRequiresCorrection(returnedFinalDoc), true);
assert.doesNotThrow(() => assertSelectionStageMutable(returnedFinalDoc), 'Hanya dokumen Perlu Koreksi yang boleh dibuka kembali');
const correctedDoc = {
  ...returnedFinalDoc,
  status: 'COMPLETED',
  verificationStatus: null,
  returnReason: null,
  isCorrected: true,
  correctionStatus: 'CLOSED',
  returnedExecutionHistory: [{ status: 'DIKEMBALIKAN', correctionStatus: 'CLOSED', correctedAt: '2026-10-31T12:00:00.000Z' }]
};
assert.equal(selectionDocumentRequiresCorrection(correctedDoc), false, 'Setelah koreksi tersimpan, pengecualian Perlu Koreksi harus ditutup');
const ignoredDuplicate = storage.get(SELECTION_STORAGE_KEY, []).find(tx => tx.id === postFinalDuplicateTx.id);
assert.equal(ignoredDuplicate.isSuperseded, true, 'Transaksi yang dibuat setelah lifecycle final tidak dihitung ulang');

// Downstream Seleksi II juga merupakan bukti bahwa Seleksi I pernah final,
// walaupun status parent/child legacy sudah ter-reset dan verification record hilang.
const downstreamEvidenceDoc = {
  id: 'SEL2-EVIDENCE-001',
  docNo: '2026/SEL-II/EVIDENCE-001',
  selectionStage: SELECTION_STAGES.SELEKSI_2,
  batchCode: resetActiveDoc.batchCode,
  bedenganCode: resetActiveDoc.bedenganCode,
  sourceSelectionDocumentId: 'SEL1-PARENT-LAMA-HILANG',
  sourceSelectionDocNo: '2026/SEL/PARENT-LAMA',
  sourcePolybagQty: 200,
  sourceBibitQty: 390,
  status: 'DRAFT'
};
storage.set(PRE_GRAFTING_SELECTION_DOC_STORAGE_KEY, [structuredClone(resetActiveDoc), downstreamEvidenceDoc]);
storage.set(SELECTION_STORAGE_KEY, [structuredClone(orphanApprovedTx)]);
storage.set('verification_transactions', []);
reconcilePreGraftingSelectionLifecycle({ apply: true });
const healedFromDownstream = getPreGraftingSelectionDocuments({}, null)
  .find(doc => doc.selectionStage === SELECTION_STAGES.SELEKSI_1);
assert.equal(isSelectionDocumentFinal(healedFromDownstream), true, 'Keberadaan Seleksi II memulihkan final Seleksi I yang ter-reset');
assert.equal(healedFromDownstream.progress, 100);

const finalStage2 = { ...structuredClone(finalDoc), id: 'SEL2-FINAL-001', docNo: '2026/SEL-II/901', selectionStage: SELECTION_STAGES.SELEKSI_2 };
const finalStage3 = { ...structuredClone(finalDoc), id: 'SEL3-FINAL-001', docNo: '2026/SEL-III/901', selectionStage: SELECTION_STAGES.SELEKSI_3 };
storage.set(PRE_GRAFTING_SELECTION_DOC_STORAGE_KEY, [finalStage2, finalStage3]);
storage.set(SELECTION_STORAGE_KEY, []);

assert.throws(() => createSeleksi2ExecutionTransaction({ selectionDocumentId: finalStage2.id }, { id: 'MNT-01' }), /final dan terkunci/i);
assert.throws(() => createSeleksi3ExecutionTransaction({ selectionDocumentId: finalStage3.id }, { id: 'MNT-01' }), /final dan terkunci/i);

console.log('PASS: final-lock Seleksi I/II/III, stabilitas Multi-SOW, dan rekonsiliasi parent ganda valid.');
