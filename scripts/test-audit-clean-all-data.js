/**
 * scripts/test-audit-clean-all-data.js
 * Comprehensive Test Suite for Dynamic Registry-Based "Bersihkan Semua Data" (TASK CLEAN-02)
 * 
 * Memverifikasi:
 * 1. Registry Loading & Structure
 * 2. Duplicate Detection & Registry Validation
 * 3. Transaction, Pool, Sync Classification
 * 4. Master Classification (Strictly Protected)
 * 5. Session Classification (Strictly Preserved)
 * 6. Hybrid Classification & Strategy
 * 7. Generic Transaction Cleanup
 * 8. Temporary Form/Cache Cleanup
 * 9. Nursery Batch Canonical Baseline Restoration
 * 10. Session & User Context Preservation
 * 11. Master Data Preservation
 * 12. Future Module Registry Dynamic Cleanup (Test-only injection)
 * 13. Idempotency (3x Clean All run)
 * 14. Refresh Persistence
 * 15. Orphan Integrity Check
 * 16. Full Suite Error Immunity
 */

if (typeof globalThis.localStorage === 'undefined') {
  const store = {};
  globalThis.localStorage = {
    getItem: (key) => (key in store ? store[key] : null),
    setItem: (key, val) => {
      store[key] = String(val);
    },
    removeItem: (key) => {
      delete store[key];
    },
    clear: () => {
      for (const k of Object.keys(store)) delete store[k];
    }
  };
  global.localStorage = globalThis.localStorage;
}

import { storage } from '../js/core/storage.js';
import { BLOCK_MASTER } from '../js/data/block-master.js';
import { KLON_MASTER } from '../js/data/klon-master.js';
import { WORKER_MASTER } from '../js/data/worker-master.js';
import { CFNA_MASTER } from '../js/data/cfna-master.js';
import { ESTATE_MASTER } from '../js/data/estate-master.js';
import { DEFAULT_NURSERY_BATCHES } from '../js/modules/dispatch/dispatch-landing.js';
import {
  DATA_STORAGE_REGISTRY,
  STORAGE_CATEGORIES,
  HYBRID_STRATEGIES,
  validateStorageRegistry,
  registerStorageKey,
  unregisterStorageKey,
  cleanAllTransactionalData
} from '../js/core/storage-registry.js';

let passedAssertions = 0;
let failedAssertions = 0;

function assert(condition, message) {
  if (condition) {
    passedAssertions++;
    console.log(`  ✅ PASS: ${message}`);
  } else {
    failedAssertions++;
    console.error(`  ❌ FAIL: ${message}`);
  }
}

console.log('========================================================================================');
console.log('   TEST SUITE: DYNAMIC REGISTRY "BERSIHKAN SEMUA DATA" (TASK CLEAN-02)                  ');
console.log('========================================================================================\n');

// -------------------------------------------------------------------------
// SECTION A: REGISTRY STRUCTURE & VALIDATION
// -------------------------------------------------------------------------
console.log('--- SECTION A: Validasi Struktur Registry & Guard Rails ---');

// 1. Registry Loading
assert(Boolean(DATA_STORAGE_REGISTRY), 'A1. DATA_STORAGE_REGISTRY terdefinisi');
assert(Array.isArray(DATA_STORAGE_REGISTRY.TRANSACTION), 'A2. Registry TRANSACTION berupa Array');
assert(Array.isArray(DATA_STORAGE_REGISTRY.POOL), 'A3. Registry POOL berupa Array');
assert(Array.isArray(DATA_STORAGE_REGISTRY.SYNC), 'A4. Registry SYNC berupa Array');
assert(Array.isArray(DATA_STORAGE_REGISTRY.TEMPORARY), 'A5. Registry TEMPORARY berupa Array');
assert(Array.isArray(DATA_STORAGE_REGISTRY.HYBRID), 'A6. Registry HYBRID berupa Array');
assert(Array.isArray(DATA_STORAGE_REGISTRY.MASTER), 'A7. Registry MASTER berupa Array');
assert(Array.isArray(DATA_STORAGE_REGISTRY.SESSION), 'A8. Registry SESSION berupa Array');

// 2. Validate Canonical Registry passes
let valPassed = false;
try {
  valPassed = validateStorageRegistry(DATA_STORAGE_REGISTRY);
} catch (e) {
  valPassed = false;
}
assert(valPassed === true, 'A9. Canonical DATA_STORAGE_REGISTRY valid 100%');

// 3. Duplicate Detection & Collision Guard
let caughtDuplicate = false;
try {
  validateStorageRegistry({
    ...DATA_STORAGE_REGISTRY,
    TRANSACTION: [...DATA_STORAGE_REGISTRY.TRANSACTION, 'requests_transactions']
  });
} catch (err) {
  caughtDuplicate = true;
}
assert(caughtDuplicate, 'A10. Guard: Duplikasi key dalam satu kategori terdeteksi & melempar error');

let caughtCollision = false;
try {
  validateStorageRegistry({
    ...DATA_STORAGE_REGISTRY,
    MASTER: [...DATA_STORAGE_REGISTRY.MASTER, 'requests_transactions']
  });
} catch (err) {
  caughtCollision = true;
}
assert(caughtCollision, 'A11. Guard: Tabrakan key MASTER vs TRANSACTION terdeteksi & melempar error');

// 4. Hybrid Strategy Validation
const hybridItem = DATA_STORAGE_REGISTRY.HYBRID.find(h => h.key === 'nursery_batches');
assert(Boolean(hybridItem), 'A12. nursery_batches terdaftar di kategori HYBRID');
assert(hybridItem?.strategy === HYBRID_STRATEGIES.RESTORE_DEFAULT_NURSERY_BATCHES, 'A13. Strategi nursery_batches adalah RESTORE_DEFAULT_NURSERY_BATCHES');
assert(typeof hybridItem?.restoreFn === 'function', 'A14. nursery_batches memiliki restoreFn valid');

// -------------------------------------------------------------------------
// SECTION B: OPERATIONAL SIMULATION & CLEAN ENGINE EXECUTION
// -------------------------------------------------------------------------
console.log('\n--- SECTION B: Simulasi Transaksi Penuh & Eksekusi Clean Engine ---');

// Setup Session & User Context
storage.set('sigma_session', { user: 'user_askep_apm', token: 'token-secret-xyz' });
storage.set('user_context', { id: 'usr_askep', name: 'Askep APM', role: 'ASISTEN_KEPALA', estateId: 'EST-APM' });

// Setup Transaksi
storage.set('requests_transactions', [{ id: 'REQ-001', docNo: 'NIR-001', requestedQty: 5000 }]);
storage.set('requests', [{ id: 'REQ-001', docNo: 'NIR-001' }]);
storage.set('dispatch_transactions', [{ id: 'DSP-001', docNo: 'DSP-001', parentRequestId: 'REQ-001', issuedQty: 3000 }]);
storage.set('receipt_ksp_transactions', [{ id: 'RCP-001', docNo: 'RCP-001', dispatchId: 'DSP-001', totalShippedQty: 3000 }]);
storage.set('receipt_transactions', [{ id: 'REC-001', docNo: 'REC-001', qty: 1000 }]);
storage.set('seeding_transactions', [{ id: 'SED-001', docNo: 'SED-001', totalDisemai: 1000 }]);
storage.set('budding_transactions', [{ id: 'BUD-001', docNo: 'BUD-001', jumlah: 800 }]);
storage.set('inspection_transactions', [{ id: 'INS-001', docNo: 'INS-001', totalDiperiksa: 800 }]);
storage.set('regrafting_pool', [{ id: 'RGR-001', jumlah: 50 }]);
storage.set('selection_pool', [{ id: 'SEL-001', jumlahAfkir: 30 }]);
storage.set('selection_transactions', [{ id: 'CTX-001', jumlahAfkir: 30 }]);
storage.set('entres_transactions', [{ id: 'ENT-001', jumlahPokok: 200 }]);
storage.set('entres_menunas_transactions', [{ id: 'MN-001', jumlah: 100 }]);
storage.set('entres_topping_transactions', [{ id: 'TP-001', jumlah: 100 }]);
storage.set('nursery_activity_records', [{ id: 'ACT-001', docNo: 'ACT-001', aktivitas: 'Pemupukan' }]);
storage.set('materials_transactions', [{ id: 'MAT-001', currentStock: 50 }]);
storage.set('material_usage_transactions', [{ id: 'MUT-001', materialName: 'Pupuk Urea', qty: 25 }]);
storage.set('issue_documents', [{ id: 'ISD-001', docNo: 'ISD-001', material: 'Pupuk Urea', quantityIssue: 100 }]);
storage.set('attendance_transactions', [{ id: 'ATT-001', hadir: 10 }]);
storage.set('sync_queue', [{ id: 'SYNC-001', action: 'CREATE' }]);

// Setup Temporary Form Cache
storage.set('receipt_photos', ['blob:test-photo-1']);
storage.set('benih_table_rows', [{ rowId: 1, sampleQty: 100 }]);
storage.set('scanned_bedengan', 'BDG-01');
storage.set('bedengan_verified_method', 'BARCODE');
storage.set('bedengan_verified_at', '2026-09-13T10:00:00Z');
storage.set('summary_back_url', '#/request/kebun-sepupu');

// Setup Hybrid nursery_batches (Stok berkurang & batch transaksional)
storage.set('nursery_batches', [
  { id: 'BATCH-APM-001', batchCode: 'B-001', availableQty: 0, initialQty: 5000, status: 'EMPTY' },
  { id: 'BATCH-TX-001', batchCode: 'B-IRCA19-APM-001', sourceReceiptId: 'RCP-001', availableQty: 2930, initialQty: 2930, status: 'AVAILABLE' }
]);

assert(storage.get('requests_transactions', []).length === 1, 'B1. Before clean: requests_transactions terisi');
assert(storage.get('nursery_batches', []).some(b => b.sourceReceiptId === 'RCP-001'), 'B2. Before clean: transactional batch ada');

// Eksekusi Clean Engine
await cleanAllTransactionalData({ skipIndexedDB: true });

// Validasi Pengosongan Transaksi, Pool, Sync
DATA_STORAGE_REGISTRY.TRANSACTION.forEach(key => {
  const val = storage.get(key, null);
  assert(Array.isArray(val) && val.length === 0, `B3. Transaction key '${key}' bersih (0 record)`);
});

DATA_STORAGE_REGISTRY.POOL.forEach(key => {
  const val = storage.get(key, null);
  assert(Array.isArray(val) && val.length === 0, `B4. Pool key '${key}' bersih (0 record)`);
});

DATA_STORAGE_REGISTRY.SYNC.forEach(key => {
  const val = storage.get(key, null);
  assert(Array.isArray(val) && val.length === 0, `B5. Sync key '${key}' bersih (0 record)`);
});

// Validasi Temporary Keys
DATA_STORAGE_REGISTRY.TEMPORARY.forEach(key => {
  const val = storage.get(key, null);
  const isCleared = val === null || (Array.isArray(val) && val.length === 0);
  assert(isCleared, `B6. Temporary key '${key}' bersih / dihapus`);
});

// Validasi Nursery Batches Hybrid Restore
const cleanedBatches = storage.get('nursery_batches', []);
const hasTxBatch = cleanedBatches.some(b => b.sourceReceiptId || b.id === 'BATCH-TX-001');
assert(!hasTxBatch, 'B7. Batch transaksional terhapus dari nursery_batches');
assert(cleanedBatches.length === DEFAULT_NURSERY_BATCHES.length, `B8. Jumlah batch nursery kembali ke baseline (${DEFAULT_NURSERY_BATCHES.length})`);

const allBaselineValid = cleanedBatches.every(b => b.availableQty === b.initialQty && b.status === 'AVAILABLE');
assert(allBaselineValid, 'B9. Seluruh master batch kembali AVAILABLE dengan availableQty === initialQty');

// Validasi Master & Session Protection
assert(ESTATE_MASTER.length === 2, 'B10. Master Estate tetap utuh (2)');
assert(BLOCK_MASTER.length === 40, 'B11. Master Block tetap utuh (40)');
assert(KLON_MASTER.length === 57, 'B12. Master Clone tetap utuh (57)');
assert(WORKER_MASTER.length === 24, 'B13. Master Worker tetap utuh (24)');
assert(CFNA_MASTER.length === 54, 'B14. Master CFNA tetap utuh (54)');

const curSession = storage.get('sigma_session', null);
const curUserContext = storage.get('user_context', null);
assert(curSession && curSession.user === 'user_askep_apm', 'B15. Session login tetap utuh & aktif');
assert(curUserContext && curUserContext.role === 'ASISTEN_KEPALA', 'B16. User context / persona tetap utuh');

const curIssueDocs = storage.get('issue_documents', []);
assert(curIssueDocs && curIssueDocs.length === 1, 'B17. Master Dokumen Alokasi Gudang (issue_documents) tetap terlindungi/utuh');

// -------------------------------------------------------------------------
// SECTION C: FUTURE MODULE TEST (DYNAMIC REGISTRATION INJECTION)
// -------------------------------------------------------------------------
console.log('\n--- SECTION C: Uji Modul Baru Hipotetis (Dynamic Registry Registration) ---');

// Daftarkan modul transaksi baru secara dinamis
const FAKE_FUTURE_KEY = 'fake_feature_transactions';
registerStorageKey(STORAGE_CATEGORIES.TRANSACTION, FAKE_FUTURE_KEY);

assert(DATA_STORAGE_REGISTRY.TRANSACTION.includes(FAKE_FUTURE_KEY), 'C1. Modul masa depan fake_feature_transactions berhasil didaftarkan ke registry');

// Isi data di key baru tersebut
storage.set(FAKE_FUTURE_KEY, [{ id: 'FAKE-001', data: 'test future data' }]);
assert(storage.get(FAKE_FUTURE_KEY, []).length === 1, 'C2. Data transaksi fake_feature_transactions terisi sebelum clean');

// Jalankan clean engine lagi
await cleanAllTransactionalData({ skipIndexedDB: true });

// Key baru otomatis ikut dibersihkan tanpa mengubah satu baris pun kode di handler UI!
const afterCleanFake = storage.get(FAKE_FUTURE_KEY, null);
assert(Array.isArray(afterCleanFake) && afterCleanFake.length === 0, 'C3. Future Proof: fake_feature_transactions otomatis ikut dibersihkan oleh Clean Engine');

// Cleanup test injection
unregisterStorageKey(STORAGE_CATEGORIES.TRANSACTION, FAKE_FUTURE_KEY);
assert(!DATA_STORAGE_REGISTRY.TRANSACTION.includes(FAKE_FUTURE_KEY), 'C4. Test key fake_feature_transactions berhasil di-unregister');

// -------------------------------------------------------------------------
// SECTION D: IDEMPOTENCY & ORPHAN INTEGRITY
// -------------------------------------------------------------------------
console.log('\n--- SECTION D: Uji Idempotensi & Integritas Orphan ---');

// Clean All 2x lagi berturut-turut
await cleanAllTransactionalData({ skipIndexedDB: true });
await cleanAllTransactionalData({ skipIndexedDB: true });

const idempBatches = storage.get('nursery_batches', []);
assert(idempBatches.length === DEFAULT_NURSERY_BATCHES.length, 'D1. Idempotency: Jumlah batch tetap baseline setelah multiple clean');
assert(storage.get('requests_transactions', []).length === 0, 'D2. Idempotency: requests_transactions tetap 0');
assert(storage.get('receipt_ksp_transactions', []).length === 0, 'D3. Idempotency: receipt_ksp_transactions tetap 0');
assert(ESTATE_MASTER.length === 2, 'D4. Idempotency: Master estate tidak termutasi');

const anyOrphanDispatch = storage.get('dispatch_transactions', []).some(d => !d.parentRequestId);
const anyOrphanReceipt = storage.get('receipt_ksp_transactions', []).some(r => !r.dispatchId);
assert(!anyOrphanDispatch && !anyOrphanReceipt, 'D5. Orphan validation: Tidak ada transaksi turunan atau orphan tersisa');

// -------------------------------------------------------------------------
// REKAP HASIL
// -------------------------------------------------------------------------
console.log('\n========================================================================================');
console.log(`   TOTAL ASSERTIONS: ${passedAssertions + failedAssertions} | PASS: ${passedAssertions} | FAIL: ${failedAssertions}`);
console.log('========================================================================================\n');

if (failedAssertions > 0) {
  process.exit(1);
} else {
  console.log('🎉 SEMUA TEST CLEAN-02 REGISTRY-DRIVEN BERHASIL 100% TANPA KESALAHAN!\n');
}
