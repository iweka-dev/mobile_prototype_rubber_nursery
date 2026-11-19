import assert from 'node:assert/strict';
import { storage } from '../js/core/storage.js';
import {
  groupPreGraftingDocsByProgram,
  renderProgramBatchCompactView
} from '../js/modules/selection/selection-landing.js';
import {
  countPendingPreGraftingDocuments,
  hasActionablePreGraftingInspection
} from '../js/modules/inspection/inspection-landing.js';

if (typeof globalThis.localStorage === 'undefined') {
  const values = new Map();
  globalThis.localStorage = {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
    clear: () => values.clear()
  };
}

const programCode = '2026/TB/RNUR/001';
const batchCode = 'BTCH-002';
const bedenganCode = 'BED-002';
const approvedParent = {
  id: 'SEL2-PARENT-APPROVED',
  docNo: '2026/SEL-II/004',
  selectionStage: 'SELEKSI_II',
  programCode,
  batchCode,
  batchNo: batchCode,
  bedenganCode,
  sourceSelectionDocumentId: 'SEL1-PARENT-APPROVED',
  sourceBibitQty: 200,
  sourcePolybagQty: 100,
  status: 'DISETUJUI',
  verificationStatus: 'TERVERIFIKASI',
  isFinal: true,
  executionCount: 1,
  executionTransactionIds: ['SEL2-TX-APPROVED']
};
const staleDraftParent = {
  id: 'SEL2-PARENT-STALE-DRAFT',
  docNo: '2026/SEL-II/007',
  selectionStage: 'SELEKSI_II',
  programCode,
  batchCode,
  batchNo: batchCode,
  bedenganCode,
  sourceSelectionDocumentId: 'SEL1-PARENT-APPROVED',
  sourceBibitQty: 200,
  sourcePolybagQty: 100,
  status: 'DRAFT',
  isFinal: false,
  executionCount: 0,
  executionTransactionIds: []
};
const sourceSeleksi1 = {
  id: 'SEL1-PARENT-APPROVED',
  docNo: '2026/SEL/402',
  selectionStage: 'SELEKSI_I',
  programCode,
  batchCode,
  batchNo: batchCode,
  bedenganCode,
  sourceBibitQty: 200,
  sourcePolybagQty: 100,
  activePolybagQty: 100,
  totalLayak: 200,
  status: 'DISETUJUI',
  isFinal: true
};
const approvedExecution = {
  id: 'SEL2-TX-APPROVED',
  docNo: '2026/SEL-II/016',
  transactionType: 'PELAKSANAAN_SELEKSI_II',
  selectionStage: 'SELEKSI_II',
  selectionDocumentId: approvedParent.id,
  parentSelectionDocumentId: approvedParent.id,
  batchCode,
  batchNo: batchCode,
  bedenganCode,
  actualPolybagInspectedQty: 100,
  polybagScope: 100,
  actualBibitSelectedQty: 10,
  status: 'DISETUJUI',
  verificationStatus: 'TERVERIFIKASI',
  isFinal: true,
  verifiedAt: '2026-11-19T15:20:48.381Z'
};
const mantriUser = {
  id: 'MNT001',
  userId: 'MNT001',
  code: 'MNT001',
  role: 'MANTRI_TANAMAN',
  estateId: 'EST-TBS',
  divisionId: 'DIV-001'
};

storage.set('pre_grafting_selection_documents', [sourceSeleksi1, approvedParent, staleDraftParent]);
storage.set('selection_transactions', [approvedExecution]);

const batchGroup = groupPreGraftingDocsByProgram([approvedParent, staleDraftParent])[0].batches[0];
const cardHtml = renderProgramBatchCompactView({
  programGroups: [{ programCode, programName: programCode, batches: [batchGroup] }],
  stage: 'SELEKSI_2'
});

assert.match(cardHtml, /Selesai Diseleksi/, 'Card harus menggunakan persetujuan transaksi pelaksanaan aktual.');
assert.match(cardHtml, /data-is-locked="true"/, 'Batch selesai dan disetujui tidak boleh membuka transaksi ulang.');
assert.equal(
  countPendingPreGraftingDocuments([approvedParent, staleDraftParent]),
  0,
  'Draft induk tanpa transaksi tidak boleh menyalakan badge untuk Batch yang sudah 100% dan disetujui.'
);
assert.equal(
  hasActionablePreGraftingInspection(mantriUser),
  false,
  'Red dot menu Pemeriksaan tidak aktif jika hanya ada draft induk tanpa transaksi pada Batch yang sudah selesai.'
);

storage.set('selection_transactions', [{
  ...approvedExecution,
  status: 'MENUNGGU_VERIFIKASI',
  verificationStatus: 'MENUNGGU_VERIFIKASI',
  isFinal: false,
  verifiedAt: null
}]);
const waitingHtml = renderProgramBatchCompactView({
  programGroups: [{ programCode, programName: programCode, batches: [batchGroup] }],
  stage: 'SELEKSI_2'
});

assert.doesNotMatch(waitingHtml, /data-is-locked="true"/, 'Transaksi yang menunggu verifikasi tidak boleh ditandai selesai terkunci.');
assert.equal(
  countPendingPreGraftingDocuments([approvedParent, staleDraftParent]),
  1,
  'Transaksi yang belum disetujui tetap memerlukan tindakan dan dihitung satu kali per Batch.'
);
assert.equal(
  hasActionablePreGraftingInspection(mantriUser),
  true,
  'Red dot tetap aktif selama transaksi pelaksanaan masih menunggu verifikasi.'
);

storage.set('selection_transactions', [{
  ...approvedExecution,
  lastReturnReason: 'Catatan koreksi terdahulu',
  isCorrected: true
}]);
assert.equal(
  hasActionablePreGraftingInspection(mantriUser),
  false,
  'Catatan pengembalian historis yang sudah dikoreksi tidak boleh mengaktifkan red dot.'
);

storage.remove('pre_grafting_selection_documents');
storage.remove('selection_transactions');
console.log('PASS: status kartu dan badge Seleksi II mengikuti transaksi pelaksanaan dan persetujuan.');
