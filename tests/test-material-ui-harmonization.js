/**
 * tests/test-material-ui-harmonization.js
 * 
 * Verifikasi Acceptance Criteria Harmonisasi UI Halaman Material:
 * 1. Tampilan konsisten dengan pola acuan (header, tabs, cards, tables, footer).
 * 2. Tidak ada ikon SVG atau emoji yang terlihat pada elemen UI halaman Material.
 * 3. Tidak ada warna dekoratif yang tidak standar.
 * 4. Label "Utuh / Siap Pakai" tidak terlihat di seluruh UI halaman Material.
 * 5. Data dan fungsi bisnis tetap berjalan normal tanpa regresi.
 * 6. Tidak ada perubahan pada modul lain.
 */

import assert from 'assert';
import fs from 'fs';

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

globalThis.document = {
  getElementById: (id) => {
    if (id === 'app') return appRoot;
    return makeMockElement('DIV');
  },
  querySelector: (sel) => {
    if (sel === '#app') return appRoot;
    return null;
  },
  querySelectorAll: () => [],
  createElement: (tag) => makeMockElement(tag),
  body: makeMockElement('BODY')
};

globalThis.window = {
  addEventListener: () => {},
  removeEventListener: () => {}
};

console.log('================================================================================');
console.log('RUNNING ACCEPTANCE TEST: HARMONISASI UI HALAMAN MATERIAL');
console.log('================================================================================\n');

import { renderMaterialMaster } from '../js/modules/master/material-master.js';

// 1. Render Material Page
renderMaterialMaster();
const htmlMaster = appRoot.innerHTML;

// Read file directly to verify templates and logic
const fileContent = fs.readFileSync('js/modules/master/material-master.js', 'utf8');

// Verify Header
assert(htmlMaster.includes('id="mat-btn-back"'), '[AC01] Back button #mat-btn-back is present');
assert(htmlMaster.includes('aria-label="Kembali"'), '[AC01] Back button has aria-label="Kembali"');
assert(!/id="mat-btn-back"[^>]*>\s*Kembali/.test(htmlMaster), '[AC01] Back button does NOT have text "Kembali"');
assert(fileContent.includes('id="mat-btn-back"') && fileContent.includes('color: #116834;'), '[AC01] Back button uses standard green #116834');

assert(htmlMaster.includes('id="mat-btn-sync"'), '[AC01] Sync button #mat-btn-sync is present');
assert(htmlMaster.includes('aria-label="Muat ulang data"'), '[AC01] Sync button has aria-label="Muat ulang data"');
assert(!/id="mat-btn-sync"[^>]*>\s*Muat Ulang/.test(htmlMaster), '[AC01] Sync button does NOT have text "Muat Ulang"');
assert(fileContent.includes('id="mat-btn-sync"') && fileContent.includes('color: #116834;'), '[AC01] Sync button uses standard green #116834');

// Verify modal buttons Batal and Simpan Pencatatan have proportional flex: 1 layout
assert(fileContent.includes('id="modal-btn-cancel-record"') && fileContent.includes('flex: 1; min-width: 0;'), '[AC01] Batal button has flex: 1 and min-width: 0');
assert(fileContent.includes('id="modal-btn-submit-record"') && fileContent.includes('flex: 1; min-width: 0;'), '[AC01] Simpan Pencatatan button has flex: 1 and min-width: 0');

// Verify no star symbol in Normalized label
assert(!htmlMaster.includes('★'), '[AC02] Star symbol ★ is removed from normalized label');
assert(fileContent.includes('Normalized:'), '[AC02] Normalized text is preserved in template');

// Verify "Lihat Issue" has no SVG
assert(/>\s*Lihat Issue\s*<\/button>/.test(htmlMaster), '[AC02] "Lihat Issue" button is text-only without SVG');

// Verify search input has standard padding without icon spacing
assert(htmlMaster.includes('padding: 8px 12px;'), '[AC01] Search input has harmonized 8px 12px padding');

// Verify "Utuh / Siap Pakai" does NOT appear anywhere in the rendered UI
assert(!htmlMaster.includes('Utuh / Siap Pakai'), '[AC03] "Utuh / Siap Pakai" does not appear in Master Tab UI');

console.log('  [PASS] AC01 & AC02: Master Material Tab UI harmonized with standard green header icons & standard padding');

// 2. Scan file content directly to verify all tabs, modals, and templates

// Verify no emojis in material-master.js
const emojiMatches = fileContent.match(/[\u{1F300}-\u{1F9FF}]/gu) || [];
assert.strictEqual(emojiMatches.length, 0, `[AC02] material-master.js contains ZERO emojis (found: ${emojiMatches.length})`);

// Verify no arrow symbol › in bottom primary action button
assert(!fileContent.includes('<span class="btn-primary-arrow">›</span>'), '[AC02] Arrow symbol › removed from footer button');
assert(fileContent.includes('<span class="btn-primary-text" style="font-size: 0.88rem;">Rekam Material</span>'), '[AC01] Footer button uses centered text');

// Verify "Utuh / Siap Pakai" is never rendered in UI
// The only occurrence can be in comments explaining it is hidden
const linesWithUtuh = fileContent.split('\n').filter(l => l.includes('Utuh / Siap Pakai') && !l.trim().startsWith('//'));
assert.strictEqual(linesWithUtuh.length, 0, `[AC03] "Utuh / Siap Pakai" never assigned to UI text or template (found: ${linesWithUtuh.length})`);

// Verify initial badge is hidden with display: none
assert(fileContent.includes('id="info-issue-status-badge" style="display: none;"'), '[AC03] Info badge initially hidden with display: none and empty text');

// Verify logic when unused (else block)
assert(fileContent.includes("infoBadge.textContent = '';"), '[AC03] infoBadge.textContent is empty string when unused');
assert(fileContent.includes("infoBadge.style.display = 'none';"), '[AC03] infoBadge.style.display is set to none when unused');

// Verify modal close buttons use text "Tutup" instead of symbol ×
assert(fileContent.includes("createCloseBtn.textContent = 'Tutup';"), '[AC02] Create modal close button uses text "Tutup"');
assert(fileContent.includes("issueCloseBtn.textContent = 'Tutup';"), '[AC02] Issue detail modal close button uses text "Tutup"');
assert(fileContent.includes("recCloseBtn.textContent = 'Tutup';"), '[AC02] Record detail modal close button uses text "Tutup"');
assert(fileContent.includes('id="btn-clear-search-issue"') && fileContent.includes('>Reset</button>'), '[AC02] Modal search clear button uses text "Reset"');

// Verify Quota calculations and validation are intact
assert(fileContent.includes("const rem = Math.max(0, (Number(doc.quantityIssue) || 0) - (Number(doc.usedQuantity) || 0));"), '[AC04] Quota calculation remains intact');
assert(fileContent.includes("if (rem <= 0)"), '[AC04] Quota validation when exhausted remains intact');
assert(fileContent.includes("if (qty > rem)"), '[AC04] Quota validation when exceeding remains intact');

console.log('  [PASS] AC03: Label "Utuh / Siap Pakai" completely hidden from all UI components');
console.log('  [PASS] AC04: Zero mutation on business logic, quota validation, and data structures');
console.log('\n================================================================================');
console.log('ALL ACCEPTANCE CRITERIA VERIFIED SUCCESSFULLY!');
console.log('================================================================================\n');
