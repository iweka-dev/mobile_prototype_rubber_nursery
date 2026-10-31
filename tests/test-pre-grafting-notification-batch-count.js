import assert from 'node:assert/strict';
import { countPendingPreGraftingDocuments } from '../js/modules/inspection/inspection-landing.js';

const pending = (id, batchCode, stage = 'SELEKSI_II') => ({
  id,
  docNo: `2026/SEL/${id}`,
  selectionStage: stage,
  programCode: '2026/TB/RNUR/001',
  batchCode,
  status: 'DRAFT',
  isFinal: false
});

const fiveParentsFourBatchCards = [
  pending('PARENT-001', 'BTCH-001'),
  pending('PARENT-002-A', 'BTCH-002', 'SELEKSI_II'),
  pending('PARENT-002-B', 'BTCH-002', 'SELEKSI_2'),
  pending('PARENT-003', 'BTCH-003'),
  pending('PARENT-004', 'BTCH-004')
];

assert.equal(
  countPendingPreGraftingDocuments(fiveParentsFourBatchCards),
  4,
  'Lima parent pada empat Batch harus menghasilkan empat notifikasi kartu'
);

assert.equal(
  countPendingPreGraftingDocuments([
    ...fiveParentsFourBatchCards,
    { ...pending('FINAL-005', 'BTCH-005'), status: 'DISETUJUI', verificationStatus: 'TERVERIFIKASI', isFinal: true }
  ]),
  4,
  'Batch final tidak boleh menambah notifikasi perlu tindakan'
);

assert.equal(
  countPendingPreGraftingDocuments([
    ...fiveParentsFourBatchCards,
    { ...pending('RETURNED-005', 'BTCH-005'), status: 'DIKEMBALIKAN', verificationStatus: 'DIKEMBALIKAN' }
  ]),
  5,
  'Batch Perlu Koreksi tetap dihitung sebagai satu tindakan'
);

console.log('PASS: notifikasi Pra-Okulasi konsisten dengan jumlah kartu Batch unik.');
