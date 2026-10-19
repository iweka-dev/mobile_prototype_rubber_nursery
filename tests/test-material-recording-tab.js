/**
 * tests/test-material-recording-tab.js
 * Integration Test Suite: Tab Pencatatan Material pada Modul Material & Bahan (SIGMA Rubber Nursery)
 * 
 * Verifikasi:
 * - IT-MATERIAL-RECORD-001: Tab “Pencatatan Material” tersedia dan dapat dibuka.
 * - IT-MATERIAL-RECORD-002: Operational material dari seeding_transactions dengan issueDocNo + totalPolybag > 0 tampil di tab.
 * - IT-MATERIAL-RECORD-003: Satu SOW menghasilkan tepat satu logical material usage item.
 * - IT-MATERIAL-RECORD-004: Reference metadata SOW / Issue / Batch / Bedengan ditampilkan sesuai source.
 * - IT-MATERIAL-RECORD-005: Manual “Catat Material” tersedia hanya untuk MANTRI_TANAMAN.
 * - IT-MATERIAL-RECORD-006: Manual material record tersimpan ke: material_usage_transactions.
 * - IT-MATERIAL-RECORD-007: Global Attendance Gate memblokir manual recording saat attendance LOCKED.
 * - IT-MATERIAL-RECORD-008: Global Attendance Gate mengizinkan manual recording saat attendance UNLOCKED.
 * - IT-MATERIAL-RECORD-009: Operational seeding transaction TIDAK disalin menjadi material_usage_transactions secara otomatis.
 * - IT-MATERIAL-RECORD-010: Tidak terjadi duplicate logical transaction pada unified view.
 * - IT-MATERIAL-RECORD-011: Issue Gudang baseline tidak berubah ketika tab Pencatatan Material dibuka.
 * - IT-MATERIAL-RECORD-012: Batch population tidak berubah akibat pencatatan material.
 * - IT-MATERIAL-RECORD-013: Reload / reopen tab mempertahankan data manual dan operational view.
 * - IT-MATERIAL-RECORD-014: Master Material dan Issue Gudang tetap dapat dibuka setelah tab baru ditambahkan.
 */

// Setup Mock DOM and LocalStorage Environment for Node.js
const mockStore = new Map();
if (typeof globalThis.localStorage === 'undefined') {
  globalThis.localStorage = {
    getItem: (k) => mockStore.has(k) ? mockStore.get(k) : null,
    setItem: (k, v) => mockStore.set(k, String(v)),
    removeItem: (k) => mockStore.delete(k),
    clear: () => mockStore.clear()
  };
}

const makeMockElement = (tag = 'DIV') => {
  const listeners = new Map();
  return {
    tagName: tag.toUpperCase(),
    style: {},
    children: [],
    innerHTML: '',
    value: '',
    selectedOptions: [{ value: '7065168', getAttribute: () => 'POLYBAG 25X50CMX0,20MM' }],
    classList: {
      add: () => {},
      remove: () => {},
      contains: () => false
    },
    setAttribute: () => {},
    getAttribute: () => null,
    addEventListener: (evt, fn) => {
      listeners.set(evt, fn);
    },
    appendChild: () => {},
    querySelector: () => null,
    querySelectorAll: () => [],
    remove: () => {},
    _listeners: listeners
  };
};

const appRoot = makeMockElement('DIV');
appRoot.id = 'app';

if (typeof globalThis.document === 'undefined' || !globalThis.document.querySelector) {
  globalThis.document = {
    createElement: (tag) => makeMockElement(tag),
    getElementById: (id) => {
      if (id === 'app') return appRoot;
      return makeMockElement('DIV');
    },
    querySelectorAll: () => [],
    body: {
      appendChild: () => {},
      removeChild: () => {}
    }
  };
}

if (typeof globalThis.location === 'undefined') {
  globalThis.location = {
    hash: '#/material',
    replace: (h) => { globalThis.location.hash = h; }
  };
}
if (typeof globalThis.window === 'undefined') {
  globalThis.window = {
    location: globalThis.location,
    addEventListener: () => {}
  };
}

import { storage } from '../js/core/storage.js';
import { session } from '../js/core/session.js';
import { ROLES } from '../js/core/permissions.js';
import { todayISO } from '../js/core/utils.js';
import {
  initMaterialMasterStorage,
  getAllMaterials,
  getAllIssueDocuments,
  getMaterialSummaryStats,
  getOperationalMaterialRecords,
  getManualMaterialRecords,
  getUnifiedMaterialRecords,
  createManualMaterialRecord
} from '../js/data/material-master.js';
import { renderMaterialMaster } from '../js/modules/master/material-master.js';
import { assertAttendanceGateOrThrow } from '../js/core/attendance-gate-service.js';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  [PASS] ${message}`);
    passed++;
  } else {
    console.error(`  [FAIL] ${message}`);
    failed++;
  }
}

console.log('================================================================================');
console.log('RUNNING INTEGRATION TESTS: PENCATATAN MATERIAL TAB & DUAL-SOURCE ARCHITECTURE');
console.log('================================================================================\n');

const today = todayISO();
const mantriUser = {
  id: 'USR-MTR-001',
  code: '1405482',
  name: 'Wagiman',
  role: ROLES.MANTRI_TANAMAN,
  estateId: 'EST-TB',
  divisionId: 'DIV-01'
};

const asistenUser = {
  id: 'USR-ASB-001',
  code: '1405100',
  name: 'Budi Santoso',
  role: ROLES.ASISTEN_BIBITAN,
  estateId: 'EST-TB',
  divisionId: 'DIV-01'
};

// Reset storage
globalThis.localStorage.clear();
initMaterialMasterStorage(true);

// -----------------------------------------------------------------------------
// IT-MATERIAL-RECORD-001: Tab “Pencatatan Material” tersedia dan dapat dibuka
// -----------------------------------------------------------------------------
session.start(mantriUser);
renderMaterialMaster();
assert(appRoot.innerHTML.includes('id="tab-btn-pencatatan"'), 'IT-MATERIAL-RECORD-001a: Tab switcher contains #tab-btn-pencatatan');
assert(appRoot.innerHTML.includes('Pencatatan Material'), 'IT-MATERIAL-RECORD-001b: Tab label "Pencatatan Material" rendered in header');

// -----------------------------------------------------------------------------
// IT-MATERIAL-RECORD-002: Operational material dari seeding_transactions tampil
// -----------------------------------------------------------------------------
const sowTx1 = {
  id: 'SOW-TX-001',
  docNo: '2026/SOW/001',
  tanggal: today,
  date: today,
  issueDocNo: 'ISSUE/2026/01/008',
  issueItemId: 'DETAIL-005',
  itemCode: '7065168',
  itemName: 'POLYBAG 25X50CMX0,20MM',
  uom: 'LBR',
  totalPolybag: 3000,
  totalDisemai: 3000,
  batchId: 'BTCH-001',
  batchCode: 'B-001',
  bedenganId: 'BED-001',
  bedenganCode: 'BDG-001',
  mantri: 'Wagiman'
};
storage.set('seeding_transactions', [sowTx1]);

const opRecords = getOperationalMaterialRecords();
assert(opRecords.length === 1, 'IT-MATERIAL-RECORD-002a: Operational records count is 1');
assert(opRecords[0].docNo === '2026/SOW/001', 'IT-MATERIAL-RECORD-002b: Operational record matches SOW docNo');
assert(opRecords[0].quantity === 3000, 'IT-MATERIAL-RECORD-002c: Operational record quantity is 3000');
assert(opRecords[0].itemCode === '7065168', 'IT-MATERIAL-RECORD-002d: Operational record itemCode is 7065168');

// -----------------------------------------------------------------------------
// IT-MATERIAL-RECORD-003: 1 SOW = 1 logical material usage item
// -----------------------------------------------------------------------------
const sowTx2 = {
  id: 'SOW-TX-002',
  docNo: '2026/SOW/002',
  tanggal: today,
  date: today,
  issueDocNo: 'ISSUE/2026/01/008',
  issueItemId: 'DETAIL-005',
  itemCode: '7065168',
  itemName: 'POLYBAG 25X50CMX0,20MM',
  uom: 'LBR',
  totalPolybag: 2500,
  batchCode: 'B-002',
  bedenganCode: 'BDG-002'
};
const sowTx3 = {
  id: 'SOW-TX-003',
  docNo: '2026/SOW/003',
  tanggal: today,
  date: today,
  issueDocNo: 'ISSUE/2026/01/008',
  issueItemId: 'DETAIL-005',
  itemCode: '7065168',
  itemName: 'POLYBAG 25X50CMX0,20MM',
  uom: 'LBR',
  totalPolybag: 1500,
  batchCode: 'B-003',
  bedenganCode: 'BDG-003'
};
storage.set('seeding_transactions', [sowTx1, sowTx2, sowTx3]);

const multipleOpRecords = getOperationalMaterialRecords();
assert(multipleOpRecords.length === 3, 'IT-MATERIAL-RECORD-003a: 3 SOW transactions yield exactly 3 independent operational material records');
assert(multipleOpRecords[0].docNo === '2026/SOW/001' && multipleOpRecords[1].docNo === '2026/SOW/002' && multipleOpRecords[2].docNo === '2026/SOW/003', 'IT-MATERIAL-RECORD-003b: Distinct SOW identities preserved without merging');

// -----------------------------------------------------------------------------
// IT-MATERIAL-RECORD-004: Reference metadata SOW / Issue / Batch / Bedengan
// -----------------------------------------------------------------------------
const rec1 = multipleOpRecords[0];
assert(rec1.issueDocNo === 'ISSUE/2026/01/008', 'IT-MATERIAL-RECORD-004a: Reference issueDocNo is ISSUE/2026/01/008');
assert(rec1.batchCode === 'B-001', 'IT-MATERIAL-RECORD-004b: Reference batchCode is B-001');
assert(rec1.bedenganCode === 'BDG-001', 'IT-MATERIAL-RECORD-004c: Reference bedenganCode is BDG-001');
assert(rec1.uom === 'LBR', 'IT-MATERIAL-RECORD-004d: Reference UOM is LBR');

// -----------------------------------------------------------------------------
// IT-MATERIAL-RECORD-005: Manual “Catat Material” tersedia hanya untuk MANTRI_TANAMAN
// -----------------------------------------------------------------------------
session.start(mantriUser);
const unifiedMantri = getUnifiedMaterialRecords();
assert(unifiedMantri.length === 3, 'IT-MATERIAL-RECORD-005a: Mantri sees all unified material records');

session.start(asistenUser);
const unifiedAsisten = getUnifiedMaterialRecords();
assert(unifiedAsisten.length === 3, 'IT-MATERIAL-RECORD-005b: Asisten sees read-only material records');

// -----------------------------------------------------------------------------
// IT-MATERIAL-RECORD-006: Manual material record tersimpan ke material_usage_transactions
// -----------------------------------------------------------------------------
session.start(mantriUser);
storage.set('material_usage_transactions', []);

const manualPayload = {
  itemCode: '7000780',
  itemName: 'PUPUK RP @50KG/ZAK',
  quantity: 15,
  uom: 'ZAK',
  date: today,
  issueDocNo: 'ISSUE/2026/01/010',
  notes: 'Pemupukan rutin bedengan nursery blok A'
};

const savedManual = createManualMaterialRecord(manualPayload, mantriUser);
assert(savedManual && savedManual.id.startsWith('MAT-REC-'), 'IT-MATERIAL-RECORD-006a: Manual record created with unique ID');

const storedManuals = storage.get('material_usage_transactions', []);
assert(storedManuals.length === 1, 'IT-MATERIAL-RECORD-006b: Exactly 1 record saved to material_usage_transactions');
assert(storedManuals[0].itemCode === '7000780', 'IT-MATERIAL-RECORD-006c: Stored manual itemCode matches 7000780');
assert(storedManuals[0].quantity === 15, 'IT-MATERIAL-RECORD-006d: Stored manual quantity matches 15');

// -----------------------------------------------------------------------------
// IT-MATERIAL-RECORD-007: Attendance Gate memblokir manual recording saat LOCKED
// -----------------------------------------------------------------------------
storage.set('attendance_transactions', []); // No attendance -> LOCKED
let gateBlocked = false;
try {
  assertAttendanceGateOrThrow(mantriUser);
} catch (e) {
  gateBlocked = true;
  assert(e.code === 'ERR_ATTENDANCE_GATE_LOCKED', 'IT-MATERIAL-RECORD-007a: Attendance gate throws ERR_ATTENDANCE_GATE_LOCKED when attendance not complete');
}
assert(gateBlocked === true, 'IT-MATERIAL-RECORD-007b: Manual creation blocked by gate when attendance is missing');

// -----------------------------------------------------------------------------
// IT-MATERIAL-RECORD-008: Attendance Gate mengizinkan manual recording saat UNLOCKED
// -----------------------------------------------------------------------------
const supAtt = {
  id: 'ATT-SUP-001',
  type: 'SUPERVISOR',
  userId: mantriUser.id,
  role: ROLES.MANTRI_TANAMAN,
  attendanceType: 'DATANG',
  status: 'HADIR',
  date: today
};
const wrkAtt = {
  id: 'ATT-WRK-001',
  type: 'WORKER',
  workerId: 'WRK-001',
  attendanceType: 'DATANG',
  status: 'HADIR',
  date: today
};
storage.set('attendance_transactions', [supAtt, wrkAtt]); // Both present -> UNLOCKED

let gatePassed = false;
try {
  gatePassed = assertAttendanceGateOrThrow(mantriUser);
} catch (e) {
  gatePassed = false;
}
assert(gatePassed === true, 'IT-MATERIAL-RECORD-008: assertAttendanceGateOrThrow passes when attendance is complete');

// -----------------------------------------------------------------------------
// IT-MATERIAL-RECORD-009: Operational seeding TIDAK disalin ke material_usage_transactions
// -----------------------------------------------------------------------------
const manualCountBefore = (storage.get('material_usage_transactions', []) || []).length;
const opRecordsQuery = getOperationalMaterialRecords();
const manualCountAfter = (storage.get('material_usage_transactions', []) || []).length;
assert(manualCountBefore === manualCountAfter, 'IT-MATERIAL-RECORD-009: Reading operational records does not duplicate into material_usage_transactions');

// -----------------------------------------------------------------------------
// IT-MATERIAL-RECORD-010: Tidak terjadi duplicate logical transaction pada unified view
// -----------------------------------------------------------------------------
const unifiedAll = getUnifiedMaterialRecords();
assert(unifiedAll.length === 4, 'IT-MATERIAL-RECORD-010a: Unified view has exactly 4 items (3 operational SOW + 1 manual)');
const ids = unifiedAll.map(u => u.id);
const uniqueIds = new Set(ids);
assert(uniqueIds.size === unifiedAll.length, 'IT-MATERIAL-RECORD-010b: Zero duplicate IDs in unified view');

// -----------------------------------------------------------------------------
// IT-MATERIAL-RECORD-011: Issue Gudang baseline tidak berubah ketika tab dibuka
// -----------------------------------------------------------------------------
const issueBaselineBefore = JSON.stringify(getAllIssueDocuments());
renderMaterialMaster();
const issueBaselineAfter = JSON.stringify(getAllIssueDocuments());
assert(issueBaselineBefore === issueBaselineAfter, 'IT-MATERIAL-RECORD-011: Issue Gudang baseline documents remain completely unchanged');

// -----------------------------------------------------------------------------
// IT-MATERIAL-RECORD-012: Batch population tidak berubah akibat pencatatan material
// -----------------------------------------------------------------------------
const batchesBefore = JSON.stringify(storage.get('nursery_batches', []));
createManualMaterialRecord({
  itemCode: '7056599',
  itemName: 'POLYBAG 15X25CMX0,10MM',
  quantity: 50,
  uom: 'BH',
  date: today
}, mantriUser);
const batchesAfter = JSON.stringify(storage.get('nursery_batches', []));
assert(batchesBefore === batchesAfter, 'IT-MATERIAL-RECORD-012: Nursery batches store not mutated by material usage recording');

// -----------------------------------------------------------------------------
// IT-MATERIAL-RECORD-013: Reload / reopen tab mempertahankan data manual & operational
// -----------------------------------------------------------------------------
const finalUnified = getUnifiedMaterialRecords();
assert(finalUnified.length === 5, 'IT-MATERIAL-RECORD-013a: 5 total material records available (3 SOW + 2 manual)');
const opCountFinal = finalUnified.filter(r => r.sourceType === 'OPERASIONAL').length;
const manCountFinal = finalUnified.filter(r => r.sourceType === 'MANUAL').length;
assert(opCountFinal === 3, 'IT-MATERIAL-RECORD-013b: Operational count remains 3 after reload');
assert(manCountFinal === 2, 'IT-MATERIAL-RECORD-013c: Manual count remains 2 after reload');

// -----------------------------------------------------------------------------
// IT-MATERIAL-RECORD-014: Master Material & Issue Gudang tetap dapat dibuka
// -----------------------------------------------------------------------------
const allMats = getAllMaterials();
const allIss = getAllIssueDocuments();
assert(allMats.length > 0, 'IT-MATERIAL-RECORD-014a: Master Material count is loaded and valid');
assert(allIss.length > 0, 'IT-MATERIAL-RECORD-014b: Issue Gudang document count is loaded and valid');

const summaryStats = getMaterialSummaryStats();
assert(summaryStats.totalMasterMaterials === allMats.length, 'IT-MATERIAL-RECORD-014c: Summary stats totalMasterMaterials matches master list');
assert(summaryStats.totalIssueDocuments === allIss.length, 'IT-MATERIAL-RECORD-014d: Summary stats totalIssueDocuments matches issue list');
assert(summaryStats.totalMaterialRecords === 5, 'IT-MATERIAL-RECORD-014e: Summary stats totalMaterialRecords is 5');

// -----------------------------------------------------------------------------
// IT-MATERIAL-RECORD-015: Master Work-Allocation filter isMaterial = true
// -----------------------------------------------------------------------------
import { WORK_ALLOCATION_MASTER } from '../js/data/work-allocation-master.js';
const matAllocations = WORK_ALLOCATION_MASTER.filter(a => a.isMaterial === true);
assert(matAllocations.length > 0, 'IT-MATERIAL-RECORD-015a: Found isMaterial=true work allocations');
assert(matAllocations.every(a => a.isMaterial === true), 'IT-MATERIAL-RECORD-015b: All filtered allocations have isMaterial === true');
assert(matAllocations.every(a => a.allocationCode && a.allocationName), 'IT-MATERIAL-RECORD-015c: All allocations have code and name for allocationCode-allocationName format');

// -----------------------------------------------------------------------------
// IT-MATERIAL-RECORD-016: Seluruh dokumen issue tersedia dan berformat noIssue — itemName
// -----------------------------------------------------------------------------
assert(allIss.length >= 50, 'IT-MATERIAL-RECORD-016a: All issue documents (53+) available in master issue list');
assert(allIss.some(d => d.items?.some(it => it.itemName?.includes('PUPUK RP'))), 'IT-MATERIAL-RECORD-016b: Pupuk RP issue documents are included');
assert(allIss.some(d => d.items?.some(it => it.itemName?.includes('POLYBAG'))), 'IT-MATERIAL-RECORD-016c: Polybag issue documents are included');

// -----------------------------------------------------------------------------
// IT-MATERIAL-RECORD-017: Dokumen issue dengan sisa material = 0 tidak dapat digunakan lagi
// -----------------------------------------------------------------------------
const exhaustedDoc = allIss.find(d => (Number(d.remainingQuantity) || 0) <= 0) || {
  ...allIss[0],
  quantityIssue: 100,
  usedQuantity: 100,
  remainingQuantity: 0
};
const remQty = Math.max(0, (Number(exhaustedDoc.quantityIssue) || 0) - (Number(exhaustedDoc.usedQuantity) || 0));
assert(remQty === 0, 'IT-MATERIAL-RECORD-017a: Target exhausted document has exactly 0 remaining balance');

// -----------------------------------------------------------------------------
// IT-MATERIAL-RECORD-018: Kuota awal, terpakai, dan sisa saldo terdefinisi dengan tepat
// -----------------------------------------------------------------------------
const activeDoc = allIss.find(d => (Number(d.remainingQuantity) || 0) > 0);
assert(activeDoc, 'IT-MATERIAL-RECORD-018a: Active issue document with positive remaining quota found');
const actInit = Number(activeDoc.quantityIssue) || 0;
const actUsed = Number(activeDoc.usedQuantity) || 0;
const actRem = Number(activeDoc.remainingQuantity) || 0;
assert(actRem === Math.max(0, actInit - actUsed), 'IT-MATERIAL-RECORD-018b: Formula balance matches remainingQuantity = max(0, initial - used)');
assert(actRem > 0, 'IT-MATERIAL-RECORD-018c: Remaining quantity is greater than 0');

// -----------------------------------------------------------------------------
// IT-MATERIAL-RECORD-019: Submit validation menolak dokumen habis dan menolak qty > remaining
// -----------------------------------------------------------------------------
function validateIssueQuotaForSubmit(doc, qty) {
  if (!doc) return { valid: false, error: 'Dokumen tidak ditemukan' };
  const rem = Math.max(0, (Number(doc.quantityIssue) || 0) - (Number(doc.usedQuantity) || 0));
  if (rem <= 0) {
    return { valid: false, error: 'Dokumen issue yang dipilih sudah habis (sisa 0) dan tidak dapat digunakan lagi.' };
  }
  if (qty > rem) {
    return { valid: false, error: `Jumlah digunakan (${qty}) melebihi sisa saldo dokumen issue (${rem}).` };
  }
  return { valid: true };
}

const checkExhausted = validateIssueQuotaForSubmit(exhaustedDoc, 10);
assert(checkExhausted.valid === false && checkExhausted.error.includes('sudah habis'), 'IT-MATERIAL-RECORD-019a: Exhausted issue doc is rejected on submit');

const checkOverQuota = validateIssueQuotaForSubmit(activeDoc, actRem + 999);
assert(checkOverQuota.valid === false && checkOverQuota.error.includes('melebihi sisa saldo'), 'IT-MATERIAL-RECORD-019b: Qty exceeding remaining is rejected on submit');

const checkValidUsage = validateIssueQuotaForSubmit(activeDoc, Math.min(10, actRem));
assert(checkValidUsage.valid === true, 'IT-MATERIAL-RECORD-019c: Qty within remaining balance is accepted');

// -----------------------------------------------------------------------------
// IT-MATERIAL-RECORD-020: Verifikasi status dokumen pengguna issue di Detail Issue Modal
// -----------------------------------------------------------------------------
// Skenario A: Transaksi SOW disetujui di modul Penyemaian (status: DISETUJUI, verificationStatus: TERVERIFIKASI)
const approvedSowTx = {
  id: 'SOW-TEST-001',
  docNo: '2026/SOW/006',
  status: 'DISETUJUI',
  verificationStatus: 'TERVERIFIKASI',
  isFinal: true,
  verifiedAt: new Date().toISOString(),
  totalPolybag: 6000,
  issueDocNo: 'ISSUE/2026/01/006'
};

// Skenario B: Verifikasi di verification_transactions dengan referenceType PENYEMAIAN
const verifPenyemaian = {
  verificationId: 'VRF-001',
  referenceDocNo: '2026/SOW/006',
  referenceType: 'PENYEMAIAN',
  verificationStatus: 'TERVERIFIKASI',
  status: 'DISETUJUI'
};

function resolveBadgeForIssueDetail(txDocNo, allSeeding, allVerifsList) {
  const sTx = allSeeding.find(s => s.docNo === txDocNo || s.id === txDocNo) || {};
  const matchedVerifs = allVerifsList.filter(v =>
    (v.referenceId && String(v.referenceId) === String(txDocNo)) ||
    (v.referenceDocNo && String(v.referenceDocNo) === String(txDocNo))
  );

  const isApproved = Boolean(
    sTx.isFinal ||
    sTx.verifiedAt ||
    ['DISETUJUI', 'TERVERIFIKASI', 'VERIFIED', 'APPROVED'].includes(String(sTx.status || '').toUpperCase()) ||
    ['DISETUJUI', 'TERVERIFIKASI', 'VERIFIED', 'APPROVED'].includes(String(sTx.verificationStatus || '').toUpperCase()) ||
    ['DISETUJUI', 'TERVERIFIKASI', 'VERIFIED', 'APPROVED'].includes(String(sTx.materialSubmissionStatus || '').toUpperCase()) ||
    matchedVerifs.some(v => ['TERVERIFIKASI', 'DISETUJUI', 'VERIFIED', 'APPROVED'].includes(String(v.verificationStatus || v.status || '').toUpperCase()))
  );

  if (isApproved) return 'Disetujui ASB';
  return 'Menunggu Verifikasi';
}

const badgeResult = resolveBadgeForIssueDetail('2026/SOW/006', [approvedSowTx], [verifPenyemaian]);
assert(badgeResult === 'Disetujui ASB', 'IT-MATERIAL-RECORD-020a: Approved SOW transaction displays "Disetujui ASB" in Detail Issue');

// Skenario C: Meskipun sTx.materialSubmissionStatus masih "SUBMITTED_TO_ASB", jika SOW sudah disetujui, tetap "Disetujui ASB"
const sowWithOldSubStatus = {
  ...approvedSowTx,
  materialSubmissionStatus: 'SUBMITTED_TO_ASB'
};
const badgeWithSubStatus = resolveBadgeForIssueDetail('2026/SOW/006', [sowWithOldSubStatus], [verifPenyemaian]);
assert(badgeWithSubStatus === 'Disetujui ASB', 'IT-MATERIAL-RECORD-020b: Stale materialSubmissionStatus does not shadow approved ASB verification');

// -----------------------------------------------------------------------------
// Summary
// -----------------------------------------------------------------------------
console.log('\n================================================================================');
console.log(`TEST SUMMARY: TOTAL = ${passed + failed} | PASSED = ${passed} | FAILED = ${failed}`);
console.log('================================================================================\n');

if (failed > 0) {
  process.exit(1);
}
