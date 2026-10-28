/**
 * js/core/storage-registry.js
 * Registry Terpusat Penyimpanan Data & Engine Pembersihan Transaksi (TASK CLEAN-02)
 * 
 * Mengklasifikasikan seluruh key penyimpanan lokal & database:
 * - TRANSACTION: Data transaksi operasional / testing yang direset ke []
 * - POOL: Pool data transaksional (seleksi afkir, okulasi janda) yang direset ke []
 * - SYNC: Antrean sinkronisasi offline yang direset ke []
 * - TEMPORARY: Form drafts, cache verifikasi, temporary pointers yang dihapus / direset
 * - HYBRID: Penyimpanan campuran (misal nursery_batches) dengan strategi restorasi canonical baseline
 * - MASTER: Master data statis / referensi yang TIDAK BOLEH disentuh oleh Clean All
 * - SESSION: Data otentikasi & sesi login pengguna yang WAJIB dipertahankan
 */

import { storage } from './storage.js';
import { DEFAULT_NURSERY_BATCHES } from '../modules/dispatch/dispatch-landing.js';

export const STORAGE_CATEGORIES = {
  TRANSACTION: 'TRANSACTION',
  POOL: 'POOL',
  SYNC: 'SYNC',
  TEMPORARY: 'TEMPORARY',
  HYBRID: 'HYBRID',
  MASTER: 'MASTER',
  SESSION: 'SESSION'
};

export const HYBRID_STRATEGIES = {
  RESTORE_DEFAULT_NURSERY_BATCHES: 'RESTORE_DEFAULT_NURSERY_BATCHES',
  RESTORE_DEFAULT_BEDENGAN_MASTER: 'RESTORE_DEFAULT_BEDENGAN_MASTER'
};

export const DATA_STORAGE_REGISTRY = {
  TRANSACTION: [
    'requests_transactions',
    'requests',
    'dispatch_transactions',
    'receipt_ksp_transactions',
    'receipt_transactions',
    'nursery_activity_records',
    'nursery_mandoran_consolidations',
    'entres_transactions',
    'entres_menunas_transactions',
    'entres_topping_transactions',
    'materials_transactions',
    'material_usage_transactions',
    'seeding_transactions',
    'dederan_induk_documents',
    'dederan_transactions',
    'dederan_inspections',
    'budding_transactions',
    'inspection_transactions',
    'attendance_transactions',
    'selection_transactions',
    'pre_grafting_selection_documents',
    'selection_photos',
    'destruction_transactions',
    'verification_transactions',
    'batch_inventory_states',
    'batch_inventory_journal',
    'physical_stock_inspections',
    'physical_stock_cull_verifications',
    'physical_stock_bapsb',
    'selection_approval_decisions',
    'selection_mutation_intents',
    'selection_stock_audits',
    'selection_anomaly_cases',
    'cull_document_sequences',
    'bedengan_context_relations',
    'batch_context_relations'
  ],
  POOL: [
    'selection_pool',
    'regrafting_pool'
  ],
  SYNC: [
    'sync_queue'
  ],
  TEMPORARY: [
    'receipt_photos',
    'benih_table_rows',
    'scanned_bedengan',
    'scanned_dederan_bedengan_id',
    'scanned_dederan_bedengan_code',
    'scanned_dederan_bedengan_name',
    'bedengan_verified_method',
    'bedengan_verified_at',
    'summary_back_url',
    'editing_transaction_index',
    'viewing_transaction_index',
    'seeding_source_index',
    'editing_seeding_index',
    'selected_sir',
    'selected_klon',
    'benih_jenis',
    'benih_tahapan',
    'benih_program_id',
    'benih_program_code',
    'benih_source_id',
    'benih_source_name',
    'benih_batch_code',
    'transaction_originType'
  ],
  HYBRID: [
    {
      key: 'nursery_batches',
      strategy: HYBRID_STRATEGIES.RESTORE_DEFAULT_NURSERY_BATCHES,
      restoreFn: () => []
    },
    {
      key: 'bedengan_master',
      strategy: HYBRID_STRATEGIES.RESTORE_DEFAULT_BEDENGAN_MASTER,
      restoreFn: () => []
    }
  ],
  MASTER: [
    'estate_master',
    'block_master',
    'klon_master',
    'worker_master',
    'cfna_master',
    'program_master',
    'role_registry',
    'permissions',
    'menu_registry',
    'personas',
    'master_materials'
  ],
  SESSION: [
    'sigma_session',
    'user_context'
  ]
};

// IndexedDB Transaction Stores to clear
export const INDEXEDDB_TX_STORES = [
  'attendance', 'receptions', 'seedings', 'transplantations',
  'buddings', 'inspections', 'regraftings', 'selections',
  'batchTransfers', 'stageTransfers', 'entresActivities',
  'nurseryActivities', 'requests', 'syncQueue', 'auditLogs', 'photos',
  'approvals', 'batches'
];

/**
 * Validasi integritas struktur Registry Penyimpanan
 * Memastikan tidak ada duplikasi, tabrakan kategori MASTER/SESSION vs TRANSACTION, dan strategi hybrid valid.
 */
export function validateStorageRegistry(registry = DATA_STORAGE_REGISTRY) {
  const seenKeys = new Map();

  // Helper untuk registrasi key & cek duplikasi
  const registerKey = (key, category) => {
    if (!key || typeof key !== 'string') {
      throw new Error(`[StorageRegistry] Invalid key '${key}' in category '${category}'`);
    }
    if (seenKeys.has(key)) {
      const prevCat = seenKeys.get(key);
      throw new Error(`[StorageRegistry] Key collision / duplicate '${key}' found in both '${prevCat}' and '${category}'`);
    }
    seenKeys.set(key, category);
  };

  // 1. Validasi Master & Session
  (registry.MASTER || []).forEach(k => registerKey(k, STORAGE_CATEGORIES.MASTER));
  (registry.SESSION || []).forEach(k => registerKey(k, STORAGE_CATEGORIES.SESSION));

  // 2. Validasi Transaction, Pool, Sync, Temporary
  (registry.TRANSACTION || []).forEach(k => registerKey(k, STORAGE_CATEGORIES.TRANSACTION));
  (registry.POOL || []).forEach(k => registerKey(k, STORAGE_CATEGORIES.POOL));
  (registry.SYNC || []).forEach(k => registerKey(k, STORAGE_CATEGORIES.SYNC));
  (registry.TEMPORARY || []).forEach(k => registerKey(k, STORAGE_CATEGORIES.TEMPORARY));

  // 3. Validasi Hybrid
  (registry.HYBRID || []).forEach(item => {
    if (!item || typeof item !== 'object' || !item.key || !item.strategy || typeof item.restoreFn !== 'function') {
      throw new Error(`[StorageRegistry] Invalid hybrid item definition: ${JSON.stringify(item)}`);
    }
    registerKey(item.key, STORAGE_CATEGORIES.HYBRID);
  });

  return true;
}

/**
 * Mendaftarkan storage key baru secara dinamis ke registry (Future-Proof Module Integration)
 */
export function registerStorageKey(category, keyDefinition) {
  if (!DATA_STORAGE_REGISTRY[category]) {
    throw new Error(`[StorageRegistry] Unknown category '${category}'`);
  }
  
  if (category === STORAGE_CATEGORIES.HYBRID) {
    DATA_STORAGE_REGISTRY.HYBRID.push(keyDefinition);
  } else {
    DATA_STORAGE_REGISTRY[category].push(keyDefinition);
  }
  
  // Validasi ulang
  validateStorageRegistry(DATA_STORAGE_REGISTRY);
}

/**
 * Menghapus storage key dari registry (untuk test cleanup)
 */
export function unregisterStorageKey(category, key) {
  if (!DATA_STORAGE_REGISTRY[category]) return;
  if (category === STORAGE_CATEGORIES.HYBRID) {
    DATA_STORAGE_REGISTRY.HYBRID = DATA_STORAGE_REGISTRY.HYBRID.filter(item => item.key !== key);
  } else {
    DATA_STORAGE_REGISTRY[category] = DATA_STORAGE_REGISTRY[category].filter(k => k !== key);
  }
}

/**
 * Engine Pembersihan Seluruh Data Transaksi Berbasis Registry Terpusat
 * 
 * Perilaku:
 * 1. TRANSACTION, POOL, SYNC -> storage.set(key, [])
 * 2. TEMPORARY -> storage.remove(key) (atau [] jika sebelumnya array cache)
 * 3. HYBRID -> execute restoreFn() (misal nursery_batches -> DEFAULT_NURSERY_BATCHES deep clone)
 * 4. MASTER & SESSION -> Terlindungi 100%, TIDAK disentuh.
 * 5. IndexedDB Transaction Stores -> dikosongkan & seedDatabase() dipanggil ulang.
 */
export async function cleanAllTransactionalData({
  registry = DATA_STORAGE_REGISTRY,
  skipIndexedDB = false
} = {}) {
  // 1. Validasi Registry
  validateStorageRegistry(registry);

  let cleanedKeysCount = 0;

  // 2. Kosongkan TRANSACTION, POOL, SYNC
  const arrayCollections = [
    ...(registry.TRANSACTION || []),
    ...(registry.POOL || []),
    ...(registry.SYNC || [])
  ];

  for (const key of arrayCollections) {
    storage.set(key, []);
    cleanedKeysCount++;
  }

  // 3. Kosongkan TEMPORARY Keys
  for (const key of (registry.TEMPORARY || [])) {
    if (key === 'receipt_photos' || key === 'benih_table_rows') {
      storage.set(key, []);
    } else {
      storage.remove(key);
    }
    cleanedKeysCount++;
  }

  // 4. Eksekusi Strategi HYBRID (misal nursery_batches & bedengan_master reset baseline)
  let hybridRestored = 0;
  for (const item of (registry.HYBRID || [])) {
    if (typeof item.restoreFn === 'function') {
      const baselineData = item.restoreFn();
      storage.set(item.key, baselineData);
      hybridRestored++;
    }
  }

  // 5. Bersihkan IndexedDB Transaction Stores
  let indexedDBCleared = false;
  let indexedDBError = null;
  if (!skipIndexedDB && typeof window !== 'undefined') {
    try {
      const { getDB } = await import('../db/indexeddb.js');
      const db = await getDB();
      
      // Tunggu hingga transaksi clear IndexedDB benar-benar selesai di-commit
      await new Promise((resolve, reject) => {
        try {
          const availableStores = INDEXEDDB_TX_STORES.filter(s => db.objectStoreNames.contains(s));
          if (availableStores.length === 0) {
            return resolve();
          }
          const tx = db.transaction(availableStores, 'readwrite');
          tx.oncomplete = () => resolve();
          tx.onerror = (e) => reject(e?.target?.error || new Error('IndexedDB clear tx failed'));
          tx.onabort = (e) => reject(e?.target?.error || new Error('IndexedDB clear tx aborted'));
          for (const s of availableStores) {
            tx.objectStore(s).clear();
          }
        } catch (txErr) {
          reject(txErr);
        }
      });
      indexedDBCleared = true;
    } catch (err) {
      indexedDBError = err;
      console.warn('[StorageCleaner] clear IndexedDB tx stores error:', err);
    }

    // Pastikan master data & akun role login selalu lengkap tersedia di IndexedDB
    try {
      const { seedDatabase } = await import('../db/seed.js');
      await seedDatabase();
    } catch (err) {
      console.warn('[StorageCleaner] seedDatabase error:', err);
    }
  }

  return {
    success: indexedDBError === null,
    cleanedKeysCount,
    hybridRestored,
    indexedDBCleared,
    indexedDBError: indexedDBError ? String(indexedDBError.message || indexedDBError) : null,
    timestamp: Date.now()
  };
}
