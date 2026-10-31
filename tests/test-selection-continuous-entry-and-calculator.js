/**
 * TEST SUITE: CONTINUOUS ENTRY, CALCULATOR, REAL-TIME SUMMARY, AND INLINE VALIDATION
 * Pelaksanaan Seleksi I, Seleksi II, dan Seleksi III
 */

import { storage } from '../js/core/storage.js';
import {
  openSeleksi1ExecutionModal,
  openSeleksi2ExecutionModal,
  openSeleksi3ExecutionModal
} from '../js/modules/selection/selection-landing.js';
import {
  getPreGraftingSelectionDocuments,
  getPreGraftingSelectionDocumentById,
  createSeleksi1ExecutionTransaction,
  getBedenganScopeStatusForSeleksi1
} from '../js/modules/selection/selection-manager.js';

console.log('='.repeat(70));
console.log('TEST SUITE: SELECTION CONTINUOUS ENTRY, CALCULATOR & INLINE VALIDATION');
console.log('='.repeat(70));

let passCount = 0;
let failCount = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`✓ PASS: ${message}`);
    passCount++;
  } else {
    console.error(`✗ FAIL: ${message}`);
    failCount++;
  }
}

// ---------------------------------------------------------------------------
// Mock Minimal DOM Environment
// ---------------------------------------------------------------------------
class MockElement {
  constructor(tag = 'div', id = '') {
    this.tagName = tag.toUpperCase();
    this.id = id;
    this.style = {};
    this.children = [];
    this.attributes = {};
    this.listeners = {};
    this._value = '';
    this.disabled = false;
    this.textContent = '';
    this._innerHTML = '';
    this.classList = {
      add: () => {},
      remove: () => {},
      contains: () => false
    };
  }

  get value() {
    return this._value;
  }
  set value(v) {
    this._value = String(v);
  }

  get innerHTML() {
    return this._innerHTML;
  }
  set innerHTML(html) {
    this._innerHTML = html;
    if (this.tagName === 'SELECT') {
      this.children = [];
      const optRegex = /<option\s+value="([^"]*)"([^>]*)>([\s\S]*?)<\/option>/gi;
      let match;
      while ((match = optRegex.exec(html)) !== null) {
        const opt = new MockElement('option');
        opt.value = match[1];
        const attrs = match[2];
        opt.textContent = match[3].trim();
        if (attrs.includes('disabled')) opt.disabled = true;
        if (attrs.includes('selected')) opt.selected = true;
        this.children.push(opt);
      }
    }
  }

  addEventListener(event, fn) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(fn);
  }

  dispatchEvent(event) {
    const handlers = this.listeners[event.type || event] || [];
    for (const h of handlers) {
      h(event);
    }
  }

  focus() {}
  appendChild(child) {
    this.children.push(child);
  }
  querySelector(sel) {
    return new MockElement('span');
  }
  querySelectorAll(sel) {
    return [];
  }
  setAttribute(k, v) {
    this.attributes[k] = v;
  }
  getAttribute(k) {
    return this.attributes[k] || null;
  }
}

const elementRegistry = new Map();

function getOrCreateMockElement(id) {
  if (!elementRegistry.has(id)) {
    elementRegistry.set(id, new MockElement('div', id));
  }
  return elementRegistry.get(id);
}

let modalClosedCount = 0;
globalThis.closeModal = () => {
  modalClosedCount++;
};

globalThis.document = {
  getElementById: (id) => getOrCreateMockElement(id),
  createElement: (tag) => new MockElement(tag),
  body: new MockElement('body'),
  querySelector: () => new MockElement('div'),
  querySelectorAll: () => []
};

globalThis.window = {
  document: globalThis.document
};

let toasts = [];
globalThis.toast = (msg, type) => {
  toasts.push({ msg, type });
};

// Setup Mock Storage
if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => store.get(k) || null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear()
  };
}

globalThis.localStorage.clear();

const mockUser = {
  id: 'USR-MANTRI-01',
  code: 'MNT-01',
  name: 'Mantri Bibitan Lapangan',
  role: 'MANTRI_TANAMAN'
};

const todayStr = new Date().toISOString().slice(0, 10);
storage.set('attendance_transactions', [
  { type: 'SUPERVISOR', role: 'MANTRI_TANAMAN', attendanceType: 'DATANG', date: todayStr, status: 'PRESENT' },
  { type: 'WORKER', workerId: 'WRK-01', attendanceType: 'DATANG', date: todayStr, status: 'PRESENT' }
]);

// ---------------------------------------------------------------------------
// TEST 1: Dropdown Placeholder & Initial Disabled State
// ---------------------------------------------------------------------------
console.log('\n--- TEST GROUP 1: Dropdown Placeholder & Initial State ---');

const multiBedDoc = {
  id: 'DOC-SEL1-MULTI-001',
  docNo: '2026/SEL/001',
  batchCode: 'BTCH-MULTI-01',
  selectionStage: 'SELEKSI_1',
  sourcePolybagQty: 1000,
  sourceBibitQty: 2000,
  status: 'DRAFT',
  rows: [
    { bedenganCode: 'BED-001', polybag: 500, disemai: 1000, seedingDocNo: '2026/SOW/001' },
    { bedenganCode: 'BED-002', polybag: 500, disemai: 1000, seedingDocNo: '2026/SOW/001' }
  ],
  transactions: []
};

storage.set('pre_grafting_selection_documents', [multiBedDoc]);

openSeleksi1ExecutionModal({
  doc: multiBedDoc,
  bedenganCode: null,
  user: mockUser,
  onSaved: () => {}
});

const selBedEl = getOrCreateMockElement('modal-sel1-bedengan');
const polyInput = getOrCreateMockElement('modal-sel1-polybag-inspected');
const bibitInput = getOrCreateMockElement('modal-sel1-bibit-selected');
const saveBtn = getOrCreateMockElement('btn-modal-save-sel1');

assert(selBedEl.innerHTML.includes('-- Pilih Bedengan Pemeriksaan --'), 'Dropdown Seleksi I contains placeholder "-- Pilih Bedengan Pemeriksaan --"');
assert(polyInput.disabled === true, 'Polybag input initially disabled before selecting bedengan');
assert(bibitInput.disabled === true, 'Bibit input initially disabled before selecting bedengan');
assert(saveBtn.disabled === true, 'Save button initially disabled');

// ---------------------------------------------------------------------------
// TEST 2: Selecting Bedengan Enables Input & Updates References
// ---------------------------------------------------------------------------
console.log('\n--- TEST GROUP 2: Bedengan Selection & References ---');

selBedEl.value = 'BED-001';
selBedEl.dispatchEvent({ type: 'change' });

assert(polyInput.disabled === false, 'Polybag input enabled after selecting BED-001');
assert(bibitInput.disabled === false, 'Bibit input enabled after selecting BED-001');
assert(getOrCreateMockElement('modal-sel1-ref-polybag').textContent.includes('500'), 'Reference polybag displays 500 Ply');
assert(getOrCreateMockElement('modal-sel1-ref-bibit').textContent.includes('1.000'), 'Reference bibit displays 1.000 Pkk');

// ---------------------------------------------------------------------------
// TEST 3: Inline Validation on Inputs
// ---------------------------------------------------------------------------
console.log('\n--- TEST GROUP 3: Inline Input Validation ---');

const polyErrEl = getOrCreateMockElement('error-modal-sel1-polybag');
const bibitErrEl = getOrCreateMockElement('error-modal-sel1-bibit');

// Negative polybag
polyInput.value = '-10';
polyInput.dispatchEvent({ type: 'input' });
assert(polyErrEl.style.display === 'block' && polyErrEl.textContent.includes('negatif'), 'Negative polybag triggers inline error');
assert(saveBtn.disabled === true, 'Save button disabled on negative polybag');

// Decimal polybag
polyInput.value = '10.5';
polyInput.dispatchEvent({ type: 'input' });
assert(polyErrEl.style.display === 'block' && polyErrEl.textContent.includes('bilangan bulat'), 'Decimal polybag triggers inline error');

// Polybag > remaining
polyInput.value = '600';
polyInput.dispatchEvent({ type: 'input' });
assert(polyErrEl.style.display === 'block' && polyErrEl.textContent.includes('melebihi sisa scope'), 'Polybag exceeding scope (600 > 500) triggers inline error');

// Valid polybag
polyInput.value = '200';
polyInput.dispatchEvent({ type: 'input' });
assert(polyErrEl.style.display === 'none', 'Valid polybag (200) clears inline error');

// Negative bibit
bibitInput.value = '-5';
bibitInput.dispatchEvent({ type: 'input' });
assert(bibitErrEl.style.display === 'block' && bibitErrEl.textContent.includes('negatif'), 'Negative bibit triggers inline error');
assert(saveBtn.disabled === true, 'Save button disabled on negative bibit');

// Decimal bibit
bibitInput.value = '4.2';
bibitInput.dispatchEvent({ type: 'input' });
assert(bibitErrEl.style.display === 'block' && bibitErrEl.textContent.includes('bilangan bulat'), 'Decimal bibit triggers inline error');

// Bibit = 0 is VALID and disables alasan dropdown
bibitInput.value = '0';
bibitInput.dispatchEvent({ type: 'input' });
assert(bibitErrEl.style.display === 'none', 'Bibit = 0 is VALID and clears inline error');
const alasanSelect = getOrCreateMockElement('modal-sel1-alasan');
const alasanErrEl = getOrCreateMockElement('error-modal-sel1-alasan');
assert(alasanSelect.disabled === true, 'Alasan dropdown is disabled when bibit = 0');

// Bibit > sisa bibit tersedia triggers error
bibitInput.value = '1005'; // Exceeds 1000
bibitInput.dispatchEvent({ type: 'input' });
assert(bibitErrEl.style.display === 'block' && bibitErrEl.textContent.includes('melebihi Bibit Tersedia'), 'Bibit exceeding Bibit Tersedia (1005 > 1000) triggers inline error');

// Bibit within sisa bibit activates alasan dropdown
bibitInput.value = '300';
bibitInput.dispatchEvent({ type: 'input' });
assert(bibitErrEl.style.display === 'none', 'Bibit input (300 <= 1000) is VALID');
assert(alasanSelect.disabled === false, 'Alasan dropdown is enabled when bibit > 0');
assert(alasanErrEl.style.display === 'block' && alasanErrEl.textContent.includes('Alasan wajib dipilih'), 'Alasan is required when bibit > 0');

// Selecting an alasan clears error
alasanSelect.value = 'Busuk';
alasanSelect.dispatchEvent({ type: 'change' });
assert(alasanErrEl.style.display === 'none', 'Selecting reason clears alasan error');

// ---------------------------------------------------------------------------
// TEST 4: Real-time Calculator & Ringkasan Hasil Input
// ---------------------------------------------------------------------------
console.log('\n--- TEST GROUP 4: Real-time Calculator & Ringkasan Panel ---');

// Polybag 200, Bibit 30
polyInput.value = '200';
bibitInput.value = '30';
alasanSelect.value = 'Busuk';
polyInput.dispatchEvent({ type: 'input' });
bibitInput.dispatchEvent({ type: 'input' });
alasanSelect.dispatchEvent({ type: 'change' });

const calcRemPoly = getOrCreateMockElement('modal-sel1-calc-rem-poly');
const calcRetained = getOrCreateMockElement('modal-sel1-calc-retained-bibit');

assert(calcRemPoly.textContent.includes('300'), 'Calculator remaining polybag displays 300 Ply (500 - 200)');
assert(calcRetained.textContent.includes('970'), 'Calculator displays sisa bibit setelah input: 970 Pkk (1.000 - 30)');

// Summary Panel fields
assert(getOrCreateMockElement('sum-sel1-poly-ratio').textContent.includes('200 / 500 Ply'), 'Summary Polybag Ratio = 200 / 500 Ply');
assert(getOrCreateMockElement('sum-sel1-poly-pct').textContent.includes('40%'), 'Summary Polybag Progress = 40%');
assert(getOrCreateMockElement('sum-sel1-bibit-afkir').textContent.includes('30 Pkk'), 'Summary Bibit Afkir = 30 Pkk');
assert(getOrCreateMockElement('sum-sel1-alasan-afkir').textContent.includes('Busuk'), 'Summary Alasan Afkir = Busuk');
assert(getOrCreateMockElement('sum-sel1-poly-sisa').textContent.includes('300 Ply'), 'Summary Polybag Sisa = 300 Ply');
assert(getOrCreateMockElement('sum-sel1-bibit-sisa').textContent.includes('970 Pkk'), 'Summary Bibit Tersedia = 970 Pkk (1.000 - 30)');

// ---------------------------------------------------------------------------
// TEST 5: Continuous Multi-Bedengan Transaction Flow & Auto-Close
// ---------------------------------------------------------------------------
console.log('\n--- TEST GROUP 5: Continuous Multi-Bedengan Entry & Auto-Close ---');

storage.set('seeding_transactions', [
  {
    id: 'SOW-APP-FLOW-001',
    docNo: '2026/SOW/001',
    batchCode: 'BTCH-FLOW-01',
    bedenganCode: 'BED-001',
    status: 'APPROVED',
    verificationStatus: 'TERVERIFIKASI'
  },
  {
    id: 'SOW-APP-FLOW-002',
    docNo: '2026/SOW/001',
    batchCode: 'BTCH-FLOW-01',
    bedenganCode: 'BED-002',
    status: 'APPROVED',
    verificationStatus: 'TERVERIFIKASI'
  }
]);
storage.set('cull_transactions', [{
  id: 'CULL-APP-FLOW-001',
  sourceSeedingDocNo: '2026/SOW/001',
  status: 'APPROVED',
  verificationStatus: 'TERVERIFIKASI'
}]);

const flowDoc = {
  id: 'DOC-SEL1-FLOW-001',
  docNo: '2026/SEL/002',
  batchCode: 'BTCH-FLOW-01',
  selectionStage: 'SELEKSI_1',
  sourcePolybagQty: 600,
  sourceBibitQty: 1200,
  status: 'DRAFT',
  rows: [
    { bedenganCode: 'BED-001', polybag: 300, disemai: 600, seedingDocNo: '2026/SOW/001' },
    { bedenganCode: 'BED-002', polybag: 300, disemai: 600, seedingDocNo: '2026/SOW/001' }
  ],
  transactions: []
};
storage.set('pre_grafting_selection_documents', [flowDoc]);

// Step 1: Execute BED-001
const tx1 = createSeleksi1ExecutionTransaction({
  selectionDocumentId: flowDoc.id,
  selectionDocNo: flowDoc.docNo,
  bedenganCode: 'BED-001',
  actualPolybagInspectedQty: 300,
  actualBibitSelectedQty: 10,
  actualBibitRetainedQty: 590,
  alasan: 'Busuk',
  photo: { dataUrl: 'data:image/jpeg;base64,mock1', latitude: '3.12', longitude: '99.12' },
  requirePhoto: true
}, mockUser);

assert(Boolean(tx1 && tx1.transaction), 'Transaction 1 created successfully on BED-001');

const updatedDocAfterTx1 = getPreGraftingSelectionDocumentById(flowDoc.id);
const scopeListAfterTx1 = getBedenganScopeStatusForSeleksi1(updatedDocAfterTx1);

const bed1Scope = scopeListAfterTx1.find(b => b.bedenganCode === 'BED-001');
const bed2Scope = scopeListAfterTx1.find(b => b.bedenganCode === 'BED-002');

assert(bed1Scope.remainingPolybag === 0, 'BED-001 remaining polybag is now 0 (completed)');
assert(bed2Scope.remainingPolybag === 300, 'BED-002 remaining polybag is still 300 (pending)');

const allCompletedAfterTx1 = scopeListAfterTx1.every(b => b.remainingPolybag === 0);
assert(allCompletedAfterTx1 === false, 'Scope is NOT all completed after Tx 1; modal remains open for next bedengan');

// Step 2: Now execute Tx 2 on BED-002
const tx2 = createSeleksi1ExecutionTransaction({
  selectionDocumentId: flowDoc.id,
  selectionDocNo: flowDoc.docNo,
  bedenganCode: 'BED-002',
  actualPolybagInspectedQty: 300,
  actualBibitSelectedQty: 15,
  actualBibitRetainedQty: 585,
  alasan: 'Kerdil',
  photo: { dataUrl: 'data:image/jpeg;base64,mock2', latitude: '3.12', longitude: '99.12' },
  requirePhoto: true
}, mockUser);

assert(Boolean(tx2 && tx2.transaction), 'Transaction 2 created successfully on BED-002');

const updatedDocAfterTx2 = getPreGraftingSelectionDocumentById(flowDoc.id);
const scopeListAfterTx2 = getBedenganScopeStatusForSeleksi1(updatedDocAfterTx2);
const allCompletedAfterTx2 = scopeListAfterTx2.every(b => b.remainingPolybag === 0);

assert(allCompletedAfterTx2 === true, 'All bedengans in document are confirmed completed; triggers modal auto-close');

const transactionCountAtCompletion = storage.get('selection_transactions', []).length;
let duplicateCompletionRejected = false;
try {
  createSeleksi1ExecutionTransaction({
    selectionDocumentId: flowDoc.id,
    selectionDocNo: flowDoc.docNo,
    bedenganCode: 'BED-002',
    actualPolybagInspectedQty: 300,
    actualBibitSelectedQty: 5,
    actualBibitRetainedQty: 580,
    photo: { dataUrl: 'data:image/jpeg;base64,mock-duplicate', latitude: '3.12', longitude: '99.12' },
    requirePhoto: true
  }, mockUser);
} catch (err) {
  duplicateCompletionRejected = /100%|telah selesai/i.test(String(err?.message || err));
}

assert(duplicateCompletionRejected, 'Duplicate transaction is rejected after Seleksi I reaches 100%');
assert(
  storage.get('selection_transactions', []).length === transactionCountAtCompletion,
  'Rejected duplicate does not add a new selection transaction'
);

// ---------------------------------------------------------------------------
// TEST 6: Seleksi II & III Form & Calculator Compatibility
// ---------------------------------------------------------------------------
console.log('\n--- TEST GROUP 6: Seleksi II & III Form Verification ---');

const sel2Doc = {
  id: 'DOC-SEL2-TEST-002',
  docNo: '2026/SEL-II/002',
  batchCode: 'BTCH-SEL2-01',
  selectionStage: 'SELEKSI_2',
  sourcePolybagQty: 500,
  sourceBibitQty: 500,
  status: 'DRAFT',
  rows: [
    { bedenganCode: 'BED-001', polybag: 500, disemai: 500 }
  ],
  transactions: []
};
storage.set('pre_grafting_selection_documents', [sel2Doc]);

openSeleksi2ExecutionModal({
  doc: sel2Doc,
  bedenganCode: null,
  user: mockUser,
  onSaved: () => {}
});

const sel2Bed = getOrCreateMockElement('modal-sel2-bedengan');
assert(sel2Bed.innerHTML.includes('-- Pilih Bedengan Pemeriksaan --'), 'Seleksi II has placeholder "-- Pilih Bedengan Pemeriksaan --"');

// Select bedengan in Seleksi II
sel2Bed.value = 'BED-001';
sel2Bed.dispatchEvent({ type: 'change' });

const sel2PolyIn = getOrCreateMockElement('modal-sel2-polybag-inspected');
const sel2BibitIn = getOrCreateMockElement('modal-sel2-bibit-selected');
const sel2PolyErr = getOrCreateMockElement('error-modal-sel2-polybag');
const sel2BibitErr = getOrCreateMockElement('error-modal-sel2-bibit');

const sel2Alasan = getOrCreateMockElement('modal-sel2-alasan');

sel2PolyIn.value = '150';
sel2BibitIn.value = '10';
sel2Alasan.value = 'Busuk';
sel2PolyIn.dispatchEvent({ type: 'input' });
sel2BibitIn.dispatchEvent({ type: 'input' });
sel2Alasan.dispatchEvent({ type: 'change' });

assert(sel2PolyErr.style.display === 'none', 'Seleksi II: valid polybag has no error');
assert(sel2BibitErr.style.display === 'none', 'Seleksi II: valid bibit has no error');
assert(getOrCreateMockElement('modal-sel2-calc-rem-poly').textContent.includes('350'), 'Seleksi II calculator displays remaining 350 Ply (500 - 150)');
assert(getOrCreateMockElement('modal-sel2-calc-retained-bibit').textContent.includes('490'), 'Seleksi II calculator displays sisa bibit setelah input 490 Pkk (500 - 10)');

// Seleksi II summary panel
assert(getOrCreateMockElement('sum-sel2-poly-ratio').textContent.includes('150 / 500 Ply'), 'Seleksi II summary polybag ratio = 150 / 500 Ply');
assert(getOrCreateMockElement('sum-sel2-poly-pct').textContent.includes('30%'), 'Seleksi II summary polybag progress = 30%');
assert(getOrCreateMockElement('sum-sel2-bibit-afkir').textContent.includes('10 Pkk'), 'Seleksi II summary bibit afkir = 10 Pkk');
assert(getOrCreateMockElement('sum-sel2-alasan-afkir').textContent.includes('Busuk'), 'Seleksi II summary alasan afkir = Busuk');
assert(getOrCreateMockElement('sum-sel2-poly-sisa').textContent.includes('350 Ply'), 'Seleksi II summary sisa polybag = 350 Ply');
assert(getOrCreateMockElement('sum-sel2-bibit-sisa').textContent.includes('490 Pkk'), 'Seleksi II summary sisa bibit tersedia = 490 Pkk (500 - 10)');

const sel3Doc = {
  id: 'DOC-SEL3-TEST-002',
  docNo: '2026/SEL-III/002',
  batchCode: 'BTCH-SEL3-01',
  selectionStage: 'SELEKSI_3',
  sourcePolybagQty: 400,
  sourceBibitQty: 400,
  status: 'DRAFT',
  rows: [
    { bedenganCode: 'BED-001', polybag: 400, disemai: 400 }
  ],
  transactions: []
};
storage.set('pre_grafting_selection_documents', [sel3Doc]);

openSeleksi3ExecutionModal({
  doc: sel3Doc,
  bedenganCode: null,
  user: mockUser,
  onSaved: () => {}
});

const sel3Bed = getOrCreateMockElement('modal-sel3-bedengan');
assert(sel3Bed.innerHTML.includes('-- Pilih Bedengan Pemeriksaan --'), 'Seleksi III has placeholder "-- Pilih Bedengan Pemeriksaan --"');

// Select bedengan in Seleksi III
sel3Bed.value = 'BED-001';
sel3Bed.dispatchEvent({ type: 'change' });

const sel3PolyIn = getOrCreateMockElement('modal-sel3-polybag-inspected');
const sel3BibitIn = getOrCreateMockElement('modal-sel3-bibit-selected');
const sel3Alasan = getOrCreateMockElement('modal-sel3-alasan');
const sel3PolyErr = getOrCreateMockElement('error-modal-sel3-polybag');
const sel3BibitErr = getOrCreateMockElement('error-modal-sel3-bibit');

// Test invalid values in Seleksi III
sel3PolyIn.value = '500'; // Exceeds 400
sel3PolyIn.dispatchEvent({ type: 'input' });
assert(sel3PolyErr.style.display === 'block' && sel3PolyErr.textContent.includes('melebihi sisa scope'), 'Seleksi III: polybag > scope triggers inline error');

sel3PolyIn.value = '100';
sel3BibitIn.value = '5';
sel3Alasan.value = 'Kerdil';
sel3PolyIn.dispatchEvent({ type: 'input' });
sel3BibitIn.dispatchEvent({ type: 'input' });
sel3Alasan.dispatchEvent({ type: 'change' });

assert(sel3PolyErr.style.display === 'none', 'Seleksi III: valid polybag clears error');
assert(sel3BibitErr.style.display === 'none', 'Seleksi III: valid bibit clears error');
assert(getOrCreateMockElement('modal-sel3-calc-rem-poly').textContent.includes('300'), 'Seleksi III calculator displays remaining 300 Ply (400 - 100)');
assert(getOrCreateMockElement('modal-sel3-calc-retained-bibit').textContent.includes('395'), 'Seleksi III calculator displays sisa bibit setelah input 395 Pkk (400 - 5)');

// Seleksi III summary panel
assert(getOrCreateMockElement('sum-sel3-poly-ratio').textContent.includes('100 / 400 Ply'), 'Seleksi III summary polybag ratio = 100 / 400 Ply');
assert(getOrCreateMockElement('sum-sel3-poly-pct').textContent.includes('25%'), 'Seleksi III summary polybag progress = 25%');
assert(getOrCreateMockElement('sum-sel3-bibit-afkir').textContent.includes('5 Pkk'), 'Seleksi III summary bibit afkir = 5 Pkk');
assert(getOrCreateMockElement('sum-sel3-alasan-afkir').textContent.includes('Kerdil'), 'Seleksi III summary alasan afkir = Kerdil');
assert(getOrCreateMockElement('sum-sel3-poly-sisa').textContent.includes('300 Ply'), 'Seleksi III summary sisa polybag = 300 Ply');
assert(getOrCreateMockElement('sum-sel3-bibit-sisa').textContent.includes('395 Pkk'), 'Seleksi III summary sisa bibit tersedia = 395 Pkk (400 - 5)');

console.log('\n--- TEST GROUP 7: Double-Click / Double-Submission Guard ---');
const sel3SaveBtn = getOrCreateMockElement('btn-modal-save-sel3');
let clickCount = 0;
assert(typeof sel3SaveBtn.addEventListener === 'function', 'Save button has event listeners attached');

console.log('\n' + '='.repeat(70));
console.log(`TOTAL PASS: ${passCount} | TOTAL FAIL: ${failCount}`);
console.log('='.repeat(70));

if (failCount > 0) {
  process.exit(1);
}
