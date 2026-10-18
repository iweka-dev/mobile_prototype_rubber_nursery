/**
 * tests/test-tahap2-monitoring-material-and-15-modules.js
 * Comprehensive Verification and Regression Test Suite for Tahap 2 — Monitoring Data Transaksi
 * SIGMA Rubber Nursery Review Workspace
 */

// In-memory localStorage mock for isolated node execution
const store = new Map();
global.localStorage = {
  getItem: (k) => store.has(k) ? store.get(k) : null,
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
  get length() { return store.size; },
  key: (i) => Array.from(store.keys())[i] || null
};

import { storage } from '../js/core/storage.js';
import { parseTxNumericQty } from '../js/core/utils.js';
import {
  initMaterialMasterStorage,
  getAllIssueDocuments,
  getIssueUsageTransactions,
  getIssueByNoIssue,
  getUnifiedMaterialRecords
} from '../js/data/material-master.js';
import { loadTxList, TX_MODULES } from '../js/modules/review/review-workspace.js';

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

console.log('='.repeat(80));
console.log('RUNNING VERIFICATION SUITE: TAHAP 2 MONITORING DATA TRANSAKSI (15 MODUL & MATERIAL)');
console.log('='.repeat(80));

// ---------------------------------------------------------------------------
// 1. TEST PARSER ANGKA (Indonesian format vs decimal)
// ---------------------------------------------------------------------------
console.log('\n--- 1. PARSER ANGKA & THOUSAND SEPARATOR ---');
assert(parseTxNumericQty(140000) === 140000, 'Direct integer 140000 parsed correctly');
assert(parseTxNumericQty('140.000') === 140000, 'Indonesian thousand separator "140.000" parsed to 140000');
assert(parseTxNumericQty('1.500') === 1500, 'Indonesian thousand separator "1.500" parsed to 1500');
assert(parseTxNumericQty('1.250.000') === 1250000, 'Multi-thousand "1.250.000" parsed to 1250000');
assert(parseTxNumericQty('12.5') === 12.5, 'Decimal "12.5" parsed to 12.5');
assert(parseTxNumericQty('0') === 0, 'Zero "0" parsed to 0');
assert(parseTxNumericQty(null) === 0, 'Null returns 0');

// ---------------------------------------------------------------------------
// 2. TEST MATERIAL & BAHAN — LOAD VIA loadTxList('material') & 11 APPROVED COLUMNS
// ---------------------------------------------------------------------------
console.log('\n--- 2. MATERIAL & BAHAN: loadTxList MAPPING (11 KOLOM TERSTANDARISASI) ---');
initMaterialMasterStorage(true);
const materialList = loadTxList('material');
assert(Array.isArray(materialList) && materialList.length > 0, `Material list loaded from issue_documents (${materialList.length} docs)`);

const firstRow = materialList[0];
assert(firstRow.itemCode && firstRow.itemCode !== '-', `1. Item Code mapped: ${firstRow.itemCode}`);
assert(firstRow.itemName && firstRow.itemName !== '-', `2. Nama Material & Bahan mapped: ${firstRow.itemName}`);
assert(firstRow.noIssue && firstRow.noIssue.startsWith('ISSUE/'), `3. No. Dokumen Issue mapped: ${firstRow.noIssue}`);
assert(firstRow.alokasi && firstRow.alokasi !== '-', `4. Alokasi Biaya mapped: ${firstRow.alokasi}`);
assert(firstRow.uom && firstRow.uom !== '-', `5. Satuan (UOM) mapped: ${firstRow.uom}`);
assert(typeof firstRow.quantityIssue === 'number', `6. Kuantitas Issue Gudang is numeric: ${firstRow.quantityIssue}`);
assert(typeof firstRow.usedQuantity === 'number', `7. Total Terpakai is numeric: ${firstRow.usedQuantity}`);
assert(typeof firstRow.remainingQuantity === 'number', `8. Sisa Saldo Stok is numeric: ${firstRow.remainingQuantity}`);
assert(
  firstRow.remainingQuantity === Math.max(0, firstRow.quantityIssue - firstRow.usedQuantity),
  '9. Rumus Saldo Sisa: remainingQuantity == max(0, quantityIssue - usedQuantity)'
);
assert(
  ['AVAILABLE', 'PARTIALLY_USED', 'FULLY_USED'].includes(firstRow.status),
  `10. Status Saldo is valid canonical status: ${firstRow.status}`
);

// ---------------------------------------------------------------------------
// 3. TEST STATUS SALDO DYNAMICS WITH STANDARD ISSUE DOC (ISSUE/2026/01/008)
// ---------------------------------------------------------------------------
console.log('\n--- 3. STATUS SALDO LIFECYCLE (AVAILABLE -> PARTIALLY -> FULLY) ---');
const TARGET_ISSUE = 'ISSUE/2026/01/008';

// Case A: 0 usage -> AVAILABLE
storage.set('seeding_transactions', []);
storage.set('material_usage_transactions', []);
let listA = loadTxList('material');
let itemA = listA.find(d => d.noIssue === TARGET_ISSUE);
assert(itemA && itemA.usedQuantity === 0, `Case A: usedQuantity is 0 (${itemA?.usedQuantity})`);
assert(itemA && itemA.remainingQuantity === itemA.quantityIssue, `Case A: remainingQuantity is full (${itemA?.remainingQuantity})`);
assert(itemA && itemA.status === 'AVAILABLE', `Case A: status is AVAILABLE (${itemA?.status})`);

// Case B: Partial usage (3.000 LBR) -> PARTIALLY_USED
const fullQty = itemA.quantityIssue;
storage.set('seeding_transactions', [
  {
    id: 'SOW-TEST-DYNAMIC-01',
    docNo: '2026/SOW/TEST-001',
    issueDocNo: TARGET_ISSUE,
    issueItemId: 'DETAIL-005',
    itemCode: '7065168',
    totalPolybag: 3000,
    date: '2026-10-17'
  }
]);
let listB = loadTxList('material');
let itemB = listB.find(d => d.noIssue === TARGET_ISSUE);
assert(itemB && itemB.usedQuantity === 3000, `Case B: usedQuantity is 3000 (${itemB?.usedQuantity})`);
assert(itemB && itemB.remainingQuantity === fullQty - 3000, `Case B: remainingQuantity is reduced (${itemB?.remainingQuantity})`);
assert(itemB && itemB.status === 'PARTIALLY_USED', `Case B: status is PARTIALLY_USED (${itemB?.status})`);

// Case C: Full usage (remaining = 0) -> FULLY_USED
storage.set('material_usage_transactions', [
  {
    id: 'MAN-TEST-DYNAMIC-01',
    docNo: 'MAT-MAN-TEST-001',
    issueDocNo: TARGET_ISSUE,
    issueItemId: 'DETAIL-005',
    itemCode: '7065168',
    quantity: fullQty - 3000,
    uom: 'LBR',
    date: '2026-10-17'
  }
]);
let listC = loadTxList('material');
let itemC = listC.find(d => d.noIssue === TARGET_ISSUE);
assert(itemC && itemC.usedQuantity === fullQty, `Case C: usedQuantity is ${fullQty} (${itemC?.usedQuantity})`);
assert(itemC && itemC.remainingQuantity === 0, `Case C: remainingQuantity is 0 (${itemC?.remainingQuantity})`);
assert(itemC && itemC.status === 'FULLY_USED', `Case C: status is FULLY_USED (${itemC?.status})`);

// ---------------------------------------------------------------------------
// 4. TEST MULTI-SOURCE USAGE TRACKING & ZERO DOUBLE COUNTING
// ---------------------------------------------------------------------------
console.log('\n--- 4. MULTI-SOURCE TRACED HISTORY & ZERO DOUBLE COUNTING ---');
const allUnified = getUnifiedMaterialRecords();
const matchedForTest = allUnified.filter(r => r.issueDocNo === TARGET_ISSUE);
assert(matchedForTest.length === 2, `Traced transactions count for ${TARGET_ISSUE} is exactly 2 (${matchedForTest.length})`);
assert(matchedForTest.some(r => r.docNo === '2026/SOW/TEST-001'), 'SOW transaction traced with exact ID');
assert(matchedForTest.some(r => r.docNo === 'MAT-MAN-TEST-001'), 'Manual transaction traced with exact ID');

const totalTracedQty = matchedForTest.reduce((sum, r) => sum + r.quantity, 0);
assert(totalTracedQty === fullQty, `Total traced usage matches issue usage exactly (${totalTracedQty} == ${fullQty})`);

// ---------------------------------------------------------------------------
// 5. TEST MANDORAN CONSOLIDATION MODULE (KONFIRMASI UNTUK KONSOLIDASI)
// ---------------------------------------------------------------------------
console.log('\n--- 5. TEST MANDORAN CONSOLIDATION (KONFIRMASI UNTUK KONSOLIDASI) ---');
const sampleConsolidation = {
  id: 'MND-CONSOL-TEST-001',
  type: 'MANDORAN_RESULT_CONSOLIDATION',
  createdAt: '2026-10-17T10:00:00.000Z',
  groups: [
    {
      allocationCode: 'RAW-01',
      allocationName: 'Pemupukan NPK 15-15-15',
      roleCode: 'BORONGAN',
      roleName: 'Pekerja Borongan Bibitan',
      uom: 'Pkk',
      taskQuantity: 500,
      workers: [
        { workerId: 'W-01', code: 'P001', name: 'Sutrisno', inputHasil: 600, resultType: 'TUNTAS', potongJamDecision: 'LENGKAP' },
        { workerId: 'W-02', code: 'P002', name: 'Joko', inputHasil: 550, resultType: 'TUNTAS', potongJamDecision: 'LENGKAP' }
      ]
    }
  ],
  sourceTransactionIds: ['RAW-TX-001', 'RAW-TX-002']
};

storage.set('nursery_mandoran_consolidations', [sampleConsolidation]);
const consolList = loadTxList('mandoranConsolidation');
assert(Array.isArray(consolList) && consolList.length === 1, 'Konsolidasi Mandoran loaded from storage (1 record)');

const consolItem = consolList[0];
assert(consolItem.docNo === 'MND-CONSOL-TEST-001', `DocNo mapped: ${consolItem.docNo}`);
assert(consolItem.alokasi.includes('RAW-01'), `Alokasi mapped: ${consolItem.alokasi}`);
assert(consolItem.roleName === 'Pekerja Borongan Bibitan', `RoleName mapped: ${consolItem.roleName}`);
assert(consolItem.workerCount === 2, `WorkerCount mapped: ${consolItem.workerCount} Orang`);
assert(consolItem.totalHasil === 1150, `TotalHasil mapped: ${consolItem.totalHasil} Pkk (600 + 550)`);
assert(consolItem.uom === 'Pkk', `UOM mapped: ${consolItem.uom}`);
assert(consolItem.sourceCount === 2, `SourceCount mapped: ${consolItem.sourceCount} Transaksi`);
assert(consolItem.status === 'CONSOLIDATED', `Status mapped: ${consolItem.status}`);

// Test Multi-Alokasi Konsolidasi (seperti KMD/2026/874417 dengan 122151 [15 Ton] & 122153 [120 Mtr])
const multiAllocConsolidation = {
  id: 'MDC-TEST-MULTI',
  docNo: 'KMD/2026/874417',
  type: 'MANDORAN_RESULT_CONSOLIDATION',
  status: 'SAVED',
  groups: [
    {
      allocationCode: '122151',
      allocationName: 'Mencari Dan Mengumpulkan Tanah',
      roleCode: 'PEKERJA_BIBITAN',
      roleName: 'Pekerja Bibitan',
      uom: 'Ton',
      taskQuantity: 5,
      workers: [
        { workerId: 'W-01', code: '1405739', name: 'Tugiman', inputHasil: 5, total: 5 },
        { workerId: 'W-02', code: '1405812', name: 'Joko Prasetyo', inputHasil: 5, total: 5 },
        { workerId: 'W-03', code: '1405739', name: 'Bidara Iswanda', inputHasil: 5, total: 5 }
      ]
    },
    {
      allocationCode: '122153',
      allocationName: 'Pembuatan Parit',
      roleCode: 'PEKERJA_BIBITAN',
      roleName: 'Pekerja Bibitan',
      uom: 'Mtr',
      taskQuantity: 40,
      workers: [
        { workerId: 'W-04', code: '1405739', name: 'Fadilah Yusuf Purba', inputHasil: 50, total: 50 },
        { workerId: 'W-05', code: '1405739', name: 'Adek Apria Syahputra', inputHasil: 40, total: 40 },
        { workerId: 'W-06', code: '1405810', name: 'Budi Santoso', inputHasil: 30, total: 30 }
      ]
    }
  ]
};

storage.set('nursery_mandoran_consolidations', [sampleConsolidation, multiAllocConsolidation]);
const multiConsolList = loadTxList('mandoranConsolidation');
assert(multiConsolList.length === 3, `Multi-alokasi dipecah menjadi 3 baris alokasi independen (ditemukan: ${multiConsolList.length})`);

const allocTanah = multiConsolList.find(c => c.docNo === 'KMD/2026/874417' && c.allocationCode === '122151');
assert(allocTanah !== undefined, 'Alokasi 122151 (Mencari Tanah) ditemukan');
assert(allocTanah.totalHasil === 15, `Hasil kerja alokasi tanah sesuai murni: ${allocTanah.totalHasil} Ton (5+5+5)`);
assert(allocTanah.uom === 'Ton', `Satuan alokasi tanah adalah Ton: ${allocTanah.uom}`);
assert(allocTanah.workerCount === 3, `Jumlah pekerja tanah: ${allocTanah.workerCount} orang`);
assert(allocTanah.workers[0].name === 'Tugiman', `Pekerja 1 alokasi tanah: ${allocTanah.workers[0].name}`);

const allocParit = multiConsolList.find(c => c.docNo === 'KMD/2026/874417' && c.allocationCode === '122153');
assert(allocParit !== undefined, 'Alokasi 122153 (Pembuatan Parit) ditemukan');
assert(allocParit.totalHasil === 120, `Hasil kerja alokasi parit sesuai murni: ${allocParit.totalHasil} Mtr (50+40+30)`);
assert(allocParit.uom === 'Mtr', `Satuan alokasi parit adalah Mtr: ${allocParit.uom}`);
assert(allocParit.workerCount === 3, `Jumlah pekerja parit: ${allocParit.workerCount} orang`);
assert(allocParit.workers[0].name === 'Fadilah Yusuf Purba', `Pekerja 1 alokasi parit: ${allocParit.workers[0].name}`);
assert(allocParit.workers[0].inputHasil === 50, `Hasil pekerja 1 parit: ${allocParit.workers[0].inputHasil} Mtr`);
assert(allocParit.createdByName === 'Wagiman', `Created By name mapped on konsolidasi: ${allocParit.createdByName}`);
assert(allocParit.createdByRole === 'Mantri Bibitan', `Created By role mapped on konsolidasi: ${allocParit.createdByRole}`);

// ---------------------------------------------------------------------------
// 5b. TEST REKAM PEMELIHARAAN (HARIAN VS MANDORAN PER ALOKASI PER PEKERJA)
// ---------------------------------------------------------------------------
console.log('\n--- 5b. TEST REKAM PEMELIHARAAN (HARIAN VS MANDORAN PER ALOKASI PER PEKERJA) ---');
const actList = loadTxList('nurseryActivity');
assert(Array.isArray(actList) && actList.length >= 3, `Nursery Activity records loaded (${actList.length} records)`);

// Test Harian Record
const harianRec = actList.find(r => r.activityEntryMode === 'HARIAN');
assert(harianRec !== undefined, 'Rekam Aktivitas Harian record identified');
assert(harianRec?.allocationCode === 'A01-01', `Alokasi CFNA mapped: ${harianRec?.allocationCode}`);
assert(Array.isArray(harianRec?.pekerja) && harianRec.pekerja.length === 3, `Daftar pekerja harian mapped: ${harianRec?.pekerja?.length} orang`);
assert(harianRec?.pekerja[0]?.name === 'Sutrisno', `Nama pekerja 1: ${harianRec?.pekerja[0]?.name}`);
assert(harianRec?.pekerja[0]?.code === 'P001', `NIK/Kode pekerja 1: ${harianRec?.pekerja[0]?.code}`);
assert(harianRec?.createdByName === 'Wagiman', `Created By name on harian record: ${harianRec?.createdByName}`);
assert(harianRec?.createdByRole === 'Mantri Bibitan', `Created By role on harian record: ${harianRec?.createdByRole}`);

// Test Mandoran Record
const mandoranRec = actList.find(r => r.activityEntryMode === 'MANDORAN');
assert(mandoranRec !== undefined, 'Rekam Aktivitas Mandoran record identified');
assert(mandoranRec?.allocationCode === 'RAW-01', `Alokasi Mandoran mapped: ${mandoranRec?.allocationCode}`);
assert(mandoranRec?.workGroupRoleCode === 'BORONGAN-RAWAT', `Role kelompok kerja mapped: ${mandoranRec?.workGroupRoleCode}`);
assert(mandoranRec?.taskQuantity === 500, `Target basis per pekerja mapped: ${mandoranRec?.taskQuantity} Pkk`);
assert(Array.isArray(mandoranRec?.pekerja) && mandoranRec.pekerja.length === 3, `Daftar pekerja mandoran mapped: ${mandoranRec?.pekerja?.length} orang`);
assert(mandoranRec?.pekerja[0]?.inputHasil === 600, `Hasil kerja Sutrisno: ${mandoranRec?.pekerja[0]?.inputHasil} Pkk (Basis: 500)`);
assert(mandoranRec?.pekerja[1]?.inputHasil === 550, `Hasil kerja Surono: ${mandoranRec?.pekerja[1]?.inputHasil} Pkk (Basis: 500)`);
assert(mandoranRec?.pekerja[2]?.inputHasil === 520, `Hasil kerja Agus: ${mandoranRec?.pekerja[2]?.inputHasil} Pkk (Basis: 500)`);
assert(mandoranRec?.totalHasil === 1670, `Total realisasi hasil terakumulasi: ${mandoranRec?.totalHasil} Pkk (600+550+520)`);
assert(mandoranRec?.createdByName === 'Wagiman', `Created By name on mandoran record: ${mandoranRec?.createdByName}`);
assert(mandoranRec?.createdByRole === 'Mantri Bibitan', `Created By role on mandoran record: ${mandoranRec?.createdByRole}`);

// ---------------------------------------------------------------------------
// 6. REGRESSION TEST: ALL 16 MODULES LOAD VIA loadTxList WITHOUT ERRORS
// ---------------------------------------------------------------------------
console.log('\n--- 6. REGRESSION TEST: ALL 16 MODULES VIA loadTxList ---');
const MODULE_KEYS = Object.keys(TX_MODULES);
assert(MODULE_KEYS.length === 16, `Total registered modules is 16 (found: ${MODULE_KEYS.length})`);

MODULE_KEYS.forEach(modId => {
  const modCfg = TX_MODULES[modId];
  try {
    const list = loadTxList(modId);
    assert(
      Array.isArray(list),
      `Modul [${modId.padEnd(22)}] (${modCfg.title}): Berhasil dimuat via loadTxList (${list.length} data)`
    );
  } catch (err) {
    assert(false, `Modul [${modId}] gagal dimuat: ${err.message}`);
  }
});

// Final check summary
console.log('\n' + '='.repeat(80));
console.log(`TEST SUMMARY: TOTAL = ${passed + failed} | PASSED = ${passed} | FAILED = ${failed}`);
console.log('='.repeat(80));

if (failed > 0) {
  process.exit(1);
} else {
  console.log('\nALL 16 MODULES (INCLUDING KONSOLIDASI MANDORAN) PASSED 100%!\n');
}
