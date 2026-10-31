/**
 * js/core/batch-inventory-service.js
 * INVENTORY LEDGER SERVICE TERPISAH DARI MASTER BATCH (TASK-REFACTOR-BATCH-INVENTORY-LEDGER-01)
 * 
 * Prinsip:
 * - SINGLE SOURCE OF TRUTH UNTUK SALDO & MUTASI STOK BATCH
 * - Memisahkan seluruh state stok/transaksi dari Master Batch
 * - Master Batch hanya menjadi identity / reference data
 * - Mencatat seluruh mutasi stok ke dalam Inventory Journal
 * - Menyediakan Compatibility Layer untuk consumer lama
 */

import { storage } from './storage.js';

export const STORAGE_KEY_INVENTORY_STATES = 'batch_inventory_states';
export const STORAGE_KEY_INVENTORY_JOURNAL = 'batch_inventory_journal';

export const INVENTORY_TX_TYPE = Object.freeze({
  RECEIPT: 'RECEIPT',
  DISPATCH: 'DISPATCH',
  SELECTION: 'SELECTION',
  DESTRUCTION: 'DESTRUCTION',
  PHYSICAL_STOCK_CULL: 'PHYSICAL_STOCK_CULL',
  PHYSICAL_STOCK_RECONCILIATION_SURPLUS: 'PHYSICAL_STOCK_RECONCILIATION_SURPLUS',
  PHYSICAL_STOCK_RECONCILIATION_SHORTAGE: 'PHYSICAL_STOCK_RECONCILIATION_SHORTAGE',
  ADJUSTMENT: 'ADJUSTMENT',
  INITIAL: 'INITIAL'
});

export const INVENTORY_STATUS = Object.freeze({
  CREATED: 'CREATED',
  AVAILABLE: 'AVAILABLE',
  EMPTY: 'EMPTY',
  INACTIVE: 'INACTIVE'
});

/**
 * Memuat seluruh state inventory dari storage
 */
function _loadInventoryStates() {
  const list = storage.get(STORAGE_KEY_INVENTORY_STATES, null);
  if (list === null || !Array.isArray(list)) {
    return [];
  }
  return list;
}

/**
 * Menyimpan seluruh state inventory ke storage
 */
function _saveInventoryStates(states) {
  storage.set(STORAGE_KEY_INVENTORY_STATES, states);
}

/**
 * Memuat seluruh jurnal inventory dari storage
 */
function _loadInventoryJournal() {
  const journal = storage.get(STORAGE_KEY_INVENTORY_JOURNAL, null);
  if (journal === null || !Array.isArray(journal)) {
    return [];
  }
  return journal;
}

/**
 * Menyimpan jurnal inventory ke storage
 */
function _saveInventoryJournal(journal) {
  storage.set(STORAGE_KEY_INVENTORY_JOURNAL, journal);
}

/**
 * Helper: Resolve batch identity dari storage nursery_batches jika diperlukan
 */
function _findBatchInMaster(batchIdOrCode) {
  if (!batchIdOrCode) return null;
  const batches = storage.get('nursery_batches', []);
  return batches.find(b => 
    b.id === batchIdOrCode || 
    b.batchId === batchIdOrCode || 
    b.batchCode === batchIdOrCode || 
    b.batchNo === batchIdOrCode ||
    b.kode === batchIdOrCode
  ) || null;
}

/**
 * Helper: Resolve semua kode identitas batch yang mungkin
 */
function _resolvePossibleCodes(batchIdOrCode) {
  if (!batchIdOrCode) return new Set();
  const targetCode = String(batchIdOrCode).trim();
  const possibleCodes = new Set([targetCode]);
  const masterBatch = _findBatchInMaster(targetCode);
  if (masterBatch) {
    if (masterBatch.id) possibleCodes.add(String(masterBatch.id).trim());
    if (masterBatch.batchId) possibleCodes.add(String(masterBatch.batchId).trim());
    if (masterBatch.batchCode) possibleCodes.add(String(masterBatch.batchCode).trim());
    if (masterBatch.batchNo) possibleCodes.add(String(masterBatch.batchNo).trim());
    if (masterBatch.kode) possibleCodes.add(String(masterBatch.kode).trim());
  }
  return possibleCodes;
}

/**
 * Helper: Sinkronisasi backward-compatibility ke nursery_batches jika ada
 */
function _syncLegacyBatchStorage(batchIdOrCode, availableQty, receivedQty = null, status = null) {
  try {
    const batches = storage.get('nursery_batches', []);
    if (!Array.isArray(batches) || batches.length === 0) return;

    let modified = false;
    const updated = batches.map(b => {
      if (b.id === batchIdOrCode || b.batchId === batchIdOrCode || b.batchCode === batchIdOrCode || b.batchNo === batchIdOrCode || b.kode === batchIdOrCode) {
        modified = true;
        return {
          ...b,
          availableQty: availableQty,
          currentQty: availableQty,
          ...(receivedQty !== null ? { receivedQty: receivedQty } : {}),
          ...(status !== null ? { status: status } : (availableQty === 0 ? { status: 'EMPTY' } : {}))
        };
      }
      return b;
    });

    if (modified) {
      storage.set('nursery_batches', updated);
    }
  } catch (err) {
    console.warn('[BatchInventoryService] Failed to sync legacy storage:', err);
  }
}

/**
 * Sinkronisasi populasi Batch Pokok dari transaksi Pindah Semai (seeding_transactions)
 * Menghitung SUM(totalDisemai) dari seluruh transaksi SOW yang valid untuk batch tersebut.
 * Idempoten: Tidak akan melakukan double counting saat dipanggil berulang kali.
 * @param {string} batchIdOrCode
 * @returns {Object|null} State inventory yang telah disinkronkan
 */
export function syncBatchPopulationFromSeeding(batchIdOrCode) {
  if (!batchIdOrCode) return null;

  const targetCode = String(batchIdOrCode).trim();
  const masterBatch = _findBatchInMaster(targetCode);
  const possibleCodes = new Set([targetCode]);
  if (masterBatch) {
    if (masterBatch.id) possibleCodes.add(String(masterBatch.id).trim());
    if (masterBatch.batchId) possibleCodes.add(String(masterBatch.batchId).trim());
    if (masterBatch.batchCode) possibleCodes.add(String(masterBatch.batchCode).trim());
    if (masterBatch.batchNo) possibleCodes.add(String(masterBatch.batchNo).trim());
    if (masterBatch.kode) possibleCodes.add(String(masterBatch.kode).trim());
  }

  const seedings = storage.get('seeding_transactions', []);
  if (!Array.isArray(seedings) || seedings.length === 0) return null;

  // 1. Filter transaksi SOW (Pindah Semai) yang menunjuk ke batch ini
  const matchingSeedings = seedings.filter(tx => {
    if (tx.isDeleted || tx.deleted || tx.status === 'DELETED') return false;
    
    const rootIdMatch = tx.batchId && possibleCodes.has(String(tx.batchId).trim());
    const rootCodeMatch = (tx.batchCode && possibleCodes.has(String(tx.batchCode).trim())) || 
                          (tx.batchNo && possibleCodes.has(String(tx.batchNo).trim())) ||
                          (tx.batch_code && possibleCodes.has(String(tx.batch_code).trim()));
    
    let rowMatch = false;
    if (Array.isArray(tx.rows)) {
      rowMatch = tx.rows.some(r => 
        (r.batchId && possibleCodes.has(String(r.batchId).trim())) ||
        (r.batchNo && possibleCodes.has(String(r.batchNo).trim())) ||
        (r.batchCode && possibleCodes.has(String(r.batchCode).trim()))
      );
    }

    return rootIdMatch || rootCodeMatch || rowMatch;
  });

  if (matchingSeedings.length === 0) {
    return null;
  }

  // 2. Hitung total populasi pokok yang berhasil disemai (SUM totalDisemai)
  let totalDisemaiSum = 0;
  matchingSeedings.forEach(tx => {
    const qty = Number(
      tx.totalDisemai !== undefined ? tx.totalDisemai :
      (tx.disemai !== undefined ? tx.disemai :
      (tx.rows && tx.rows.length > 0 ? tx.rows.reduce((acc, r) => acc + Number(r.disemai || 0), 0) : 0))
    );
    if (!isNaN(qty) && qty > 0) {
      totalDisemaiSum += qty;
    }
  });

  // 3. Hitung mutasi dari jurnal persediaan pasca-cutover (Single Source of Truth)
  const journal = _loadInventoryJournal();
  let journalQtyIn = 0;
  let journalQtyOut = 0;
  let hasValidBaseline = false;

  if (Array.isArray(journal)) {
    // Cari baseline khusus batch ini jika ada
    const baselineEntry = journal.find(j => 
      (possibleCodes.has(j.batchId) || possibleCodes.has(j.batchCode)) &&
      (j.txType === INVENTORY_TX_TYPE.INITIAL || j.txType === 'INITIAL_SOW' || j.txType === 'MIGRATION_BASELINE')
    );
    if (baselineEntry) {
      hasValidBaseline = true;
    }

    journal.forEach(j => {
      if (possibleCodes.has(j.batchId) || possibleCodes.has(j.batchCode)) {
        if (j.txType !== INVENTORY_TX_TYPE.INITIAL && j.txType !== 'INITIAL_SOW' && j.txType !== 'MIGRATION_BASELINE') {
          journalQtyIn += Number(j.qtyIn || 0);
          journalQtyOut += Number(j.qtyOut || 0);
        }
      }
    });
  }

  // Jika belum ada jurnal baseline, gunakan totalDisemaiSum sebagai baseline SOW
  const baseInitial = totalDisemaiSum;
  const newAvailable = baseInitial + journalQtyIn - journalQtyOut;
  if (newAvailable < 0) {
    throw new Error(`StockIntegrityBreachError: Saldo batch ${targetCode} negatif (${newAvailable} Pkk). Ledger terkunci.`);
  }

  const now = new Date().toISOString();

  // 4. Update / init inventory state
  const states = _loadInventoryStates();
  let state = states.find(s => possibleCodes.has(s.batchId) || possibleCodes.has(s.batchCode));
  
  let bId = targetCode;
  let bCode = targetCode;
  if (masterBatch) {
    bId = masterBatch.id || masterBatch.batchId || targetCode;
    bCode = masterBatch.batchCode || masterBatch.batchNo || masterBatch.kode || bId;
  }

  if (!state) {
    state = {
      batchId: bId,
      batchCode: bCode,
      initialQty: totalDisemaiSum,
      receivedQty: totalDisemaiSum,
      availableQty: newAvailable,
      status: newAvailable > 0 ? INVENTORY_STATUS.AVAILABLE : INVENTORY_STATUS.EMPTY,
      createdAt: masterBatch?.createdAt || now,
      updatedAt: now
    };
    states.push(state);
  } else {
    state.initialQty = totalDisemaiSum;
    state.availableQty = newAvailable;
    state.status = newAvailable > 0 ? INVENTORY_STATUS.AVAILABLE : INVENTORY_STATUS.EMPTY;
    state.updatedAt = now;
  }

  _saveInventoryStates(states);
  _syncLegacyBatchStorage(state.batchId, newAvailable, totalDisemaiSum, state.status);

  return { ...state };
}

/**
 * Sinkronisasi seluruh batch populasi dari seeding_transactions
 * @returns {Array<Object>}
 */
export function syncAllBatchPopulationsFromSeeding() {
  const seedings = storage.get('seeding_transactions', []);
  if (!Array.isArray(seedings) || seedings.length === 0) return [];

  const batchCodes = new Set();
  seedings.forEach(tx => {
    if (tx.isDeleted || tx.deleted || tx.status === 'DELETED') return;
    if (tx.batchId) batchCodes.add(String(tx.batchId).trim());
    if (tx.batchCode) batchCodes.add(String(tx.batchCode).trim());
    if (tx.batchNo) batchCodes.add(String(tx.batchNo).trim());
    if (Array.isArray(tx.rows)) {
      tx.rows.forEach(r => {
        if (r.batchId) batchCodes.add(String(r.batchId).trim());
        if (r.batchNo) batchCodes.add(String(r.batchNo).trim());
        if (r.batchCode) batchCodes.add(String(r.batchCode).trim());
      });
    }
  });

  const results = [];
  batchCodes.forEach(code => {
    if (code) {
      const res = syncBatchPopulationFromSeeding(code);
      if (res) results.push(res);
    }
  });
  return results;
}

/**
 * Mengambil state inventory dari sebuah batch
 * @param {string} batchIdOrCode - ID atau Kode Batch
 * @returns {Object|null}
 */
export function getBatchInventory(batchIdOrCode) {
  if (!batchIdOrCode) return null;

  // 1. Sync dari seeding transactions jika batch memiliki record SOW
  const syncedFromSeeding = syncBatchPopulationFromSeeding(batchIdOrCode);
  if (syncedFromSeeding) {
    return syncedFromSeeding;
  }

  const states = _loadInventoryStates();
  let state = states.find(s => s.batchId === batchIdOrCode || s.batchCode === batchIdOrCode);

  if (state) {
    return { ...state };
  }

  // Fallback bootstrap dari master batch jika belum ada di state ledger
  const masterBatch = _findBatchInMaster(batchIdOrCode);
  if (masterBatch) {
    const bId = masterBatch.id || masterBatch.batchId || masterBatch.batchCode;
    const bCode = masterBatch.batchCode || masterBatch.batchNo || masterBatch.kode || bId;
    const initialQty = Number(masterBatch.initialQty ?? masterBatch.receivedQty ?? 0);
    const receivedQty = Number(masterBatch.receivedQty ?? initialQty);
    const availableQty = Number(masterBatch.availableQty ?? masterBatch.currentQty ?? initialQty);
    const status = masterBatch.status || (availableQty > 0 ? INVENTORY_STATUS.AVAILABLE : INVENTORY_STATUS.EMPTY);

    const newState = {
      batchId: bId,
      batchCode: bCode,
      initialQty: initialQty,
      receivedQty: receivedQty,
      availableQty: availableQty,
      status: status,
      createdAt: masterBatch.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    states.push(newState);
    _saveInventoryStates(states);
    return { ...newState };
  }

  return null;
}

/**
 * Mengambil jumlah saldo/stok tersedia dari sebuah batch
 * @param {string} batchIdOrCode 
 * @returns {number}
 */
export function getAvailableQty(batchIdOrCode) {
  const inv = getBatchInventory(batchIdOrCode);
  if (!inv) return 0;
  if (inv.status === INVENTORY_STATUS.INACTIVE) return 0;
  return Number(inv.availableQty || 0);
}

/**
 * Inisialisasi saldo inventory untuk Batch Baru
 * @param {string} batchId 
 * @param {string} batchCode 
 * @param {number} initialQty 
 * @param {Object} options 
 */
export function initBatchInventory(batchId, batchCode, initialQty = 0, options = {}) {
  const initQty = Number(initialQty || 0);
  const states = _loadInventoryStates();
  const existingIdx = states.findIndex(s => s.batchId === batchId || s.batchCode === batchCode);

  const now = new Date().toISOString();
  const stateObj = {
    batchId: batchId,
    batchCode: batchCode || batchId,
    initialQty: initQty,
    receivedQty: initQty,
    availableQty: initQty,
    status: initQty > 0 ? INVENTORY_STATUS.AVAILABLE : INVENTORY_STATUS.CREATED,
    createdAt: now,
    updatedAt: now
  };

  if (existingIdx !== -1) {
    states[existingIdx] = {
      ...states[existingIdx],
      ...stateObj,
      updatedAt: now
    };
  } else {
    states.push(stateObj);
  }

  _saveInventoryStates(states);

  // Jika initialQty > 0, catat jurnal awal
  if (initQty > 0) {
    const journal = _loadInventoryJournal();
    const existingBatchEntries = journal.filter(j => j.batchId === batchId || j.batchCode === batchCode);
    const nextSeq = existingBatchEntries.length + 1;
    const idempotencyKey = options.idempotencyKey || `MUT-${batchId}-INITIAL-${options.refId || 'BASELINE'}`;
    const duplicateEntry = journal.find(j => (j.batchId === batchId || j.batchCode === batchCode) && j.idempotencyKey === idempotencyKey);

    if (!duplicateEntry) {
      const journalId = `JRN-${batchId}-${nextSeq}`;
      journal.push({
        id: journalId,
        batchId: batchId,
        batchCode: batchCode || batchId,
        batchSeq: nextSeq,
        idempotencyKey: idempotencyKey,
        txType: options.txType || INVENTORY_TX_TYPE.INITIAL,
        qtyIn: initQty,
        qtyOut: 0,
        balance: initQty,
        refId: options.refId || null,
        notes: options.notes || 'Inisialisasi stok awal batch',
        createdAt: now,
        createdBy: options.createdBy || 'SYSTEM'
      });
      _saveInventoryJournal(journal);
    }
  }

  _syncLegacyBatchStorage(batchId, initQty, initQty, stateObj.status);
  return stateObj;
}

/**
 * Menambah stok Batch dari transaksi Penerimaan (Receipt / KSP)
 * @param {string} batchIdOrCode 
 * @param {number} qty 
 * @param {Object|string} receiptMetaOrId 
 * @param {Object|string} user 
 * @param {string} notes 
 */
export function addBatchStockFromReceipt(batchIdOrCode, qty, receiptMetaOrId = null, user = null, notes = '') {
  const addQty = Number(qty);
  if (isNaN(addQty) || addQty <= 0) {
    throw new Error('Kuantitas penambahan stok harus berupa angka lebih dari 0');
  }

  const states = _loadInventoryStates();
  let state = states.find(s => s.batchId === batchIdOrCode || s.batchCode === batchIdOrCode);

  let bId = batchIdOrCode;
  let bCode = batchIdOrCode;

  if (!state) {
    const masterBatch = _findBatchInMaster(batchIdOrCode);
    if (masterBatch) {
      bId = masterBatch.id || masterBatch.batchId || masterBatch.batchCode;
      bCode = masterBatch.batchCode || masterBatch.batchNo || masterBatch.kode || bId;
      state = {
        batchId: bId,
        batchCode: bCode,
        initialQty: 0,
        receivedQty: 0,
        availableQty: 0,
        status: INVENTORY_STATUS.CREATED,
        createdAt: masterBatch.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      states.push(state);
    } else {
      // Create new state automatically if not exists
      state = {
        batchId: bId,
        batchCode: bCode,
        initialQty: 0,
        receivedQty: 0,
        availableQty: 0,
        status: INVENTORY_STATUS.CREATED,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      states.push(state);
    }
  } else {
    bId = state.batchId;
    bCode = state.batchCode || state.batchId;
  }

  // Catat ke Jurnal Mutasi
  const refId = typeof receiptMetaOrId === 'object' && receiptMetaOrId !== null
    ? (receiptMetaOrId.id || receiptMetaOrId.receiptId || receiptMetaOrId.receiptDocNo || receiptMetaOrId.docNo)
    : receiptMetaOrId;

  const userName = typeof user === 'object' && user !== null
    ? (user.name || user.fullName || user.userId || user.username || 'SYSTEM')
    : (user || 'SYSTEM');

  const journal = _loadInventoryJournal();

  const idempotencyKey = typeof receiptMetaOrId === 'object' && receiptMetaOrId?.idempotencyKey
    ? receiptMetaOrId.idempotencyKey
    : `MUT-${bId}-${INVENTORY_TX_TYPE.RECEIPT}-${refId || Date.now()}`;

  // Cek duplikasi idempotencyKey SEBELUM mutasi state (mencegah double addition)
  const duplicateEntry = journal.find(j => (j.batchId === bId || j.batchCode === bCode) && j.idempotencyKey === idempotencyKey);
  if (duplicateEntry) {
    if (duplicateEntry.qtyIn === addQty && duplicateEntry.txType === INVENTORY_TX_TYPE.RECEIPT) {
      // Idempoten: Payload identik, skip mutasi ganda
      return { ...state, idempotentSkipped: true, journalId: duplicateEntry.id };
    } else {
      // Konflik idempotencyKey dengan payload berbeda
      throw new Error(`StockIntegrityBreachError: IdempotencyKey '${idempotencyKey}' terdeteksi dengan payload berbeda.`);
    }
  }

  const newReceived = Number(state.receivedQty || 0) + addQty;
  const newAvailable = Number(state.availableQty || 0) + addQty;
  const now = new Date().toISOString();

  state.receivedQty = newReceived;
  state.availableQty = newAvailable;
  state.status = INVENTORY_STATUS.AVAILABLE;
  state.updatedAt = now;

  _saveInventoryStates(states);

  const existingBatchEntries = journal.filter(j => j.batchId === bId || j.batchCode === bCode);
  const nextSeq = existingBatchEntries.length + 1;

  const journalId = `JRN-${bId}-${nextSeq}`;

  journal.push({
    id: journalId,
    batchId: bId,
    batchCode: bCode,
    batchSeq: nextSeq,
    idempotencyKey: idempotencyKey,
    txType: INVENTORY_TX_TYPE.RECEIPT,
    qtyIn: addQty,
    qtyOut: 0,
    balance: newAvailable,
    refId: refId || null,
    notes: notes || `Penerimaan stok dari transaksi ${refId || ''}`.trim(),
    createdAt: now,
    createdBy: userName
  });

  _saveInventoryJournal(journal);

  // Sync backward compatibility
  _syncLegacyBatchStorage(bId, newAvailable, newReceived, INVENTORY_STATUS.AVAILABLE);

  return { ...state, journalId };
}

/**
 * Menerapkan rekonsiliasi stok fisik multi-baris pada satu Batch.
 *
 * Seluruh baris divalidasi sebelum penyimpanan. Jurnal surplus dan shortage
 * tetap terpisah (tidak di-netting) tetapi state Batch hanya disimpan sekali.
 * Pemanggil wajib membungkus fungsi ini dengan executeStockMutationWithLock.
 */
export function applyPhysicalStockReconciliation(batchIdOrCode, lines, refMeta = {}, user = null) {
  if (!batchIdOrCode) throw new Error('Batch rekonsiliasi wajib ditentukan.');
  if (!Array.isArray(lines) || lines.length === 0) {
    throw new Error('Minimal satu baris rekonsiliasi wajib tersedia.');
  }

  const normalizedLines = lines.map((line, index) => {
    const direction = String(line?.direction || '').trim().toUpperCase();
    const quantity = Math.abs(Number(line?.quantity ?? line?.difference ?? 0));
    const lineId = String(line?.lineId || `${index + 1}`).trim();
    if (!['SURPLUS', 'SHORTAGE'].includes(direction)) {
      throw new Error(`Arah rekonsiliasi baris ${index + 1} tidak valid.`);
    }
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new Error(`Kuantitas rekonsiliasi baris ${index + 1} harus bilangan bulat lebih dari nol.`);
    }
    if (!lineId) throw new Error(`Identitas rekonsiliasi baris ${index + 1} wajib tersedia.`);
    return {
      ...line,
      direction,
      quantity,
      lineId,
      bedenganId: line.bedenganId || null,
      bedenganCode: line.bedenganCode || line.bedenganId || 'TOTAL_BATCH'
    };
  });

  const duplicateLineIds = normalizedLines.filter((line, index, all) =>
    all.findIndex(candidate => candidate.lineId === line.lineId) !== index
  );
  if (duplicateLineIds.length) throw new Error('Identitas baris rekonsiliasi tidak boleh duplikat.');

  const states = _loadInventoryStates();
  let state = states.find(s => s.batchId === batchIdOrCode || s.batchCode === batchIdOrCode);
  if (!state) {
    const masterBatch = _findBatchInMaster(batchIdOrCode);
    if (!masterBatch) throw new Error(`Batch '${batchIdOrCode}' tidak ditemukan di inventory ledger.`);
    const bId = masterBatch.id || masterBatch.batchId || masterBatch.batchCode;
    const bCode = masterBatch.batchCode || masterBatch.batchNo || masterBatch.kode || bId;
    const availableQty = Number(masterBatch.availableQty ?? masterBatch.currentQty ?? masterBatch.initialQty ?? 0);
    state = {
      batchId: bId,
      batchCode: bCode,
      initialQty: Number(masterBatch.initialQty || 0),
      receivedQty: Number(masterBatch.receivedQty || 0),
      availableQty,
      status: availableQty > 0 ? INVENTORY_STATUS.AVAILABLE : INVENTORY_STATUS.EMPTY,
      createdAt: masterBatch.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    states.push(state);
  }

  if (state.status === INVENTORY_STATUS.INACTIVE) {
    throw new Error(`Batch '${state.batchCode || state.batchId}' berstatus NONAKTIF dan tidak dapat direkonsiliasi.`);
  }
  if (_startupRecoveryError) {
    throw new Error(`StartupRecoveryBlockedError: Recovery startup gagal (${_startupRecoveryError.message}).`);
  }

  const journal = _loadInventoryJournal();
  const refId = refMeta.id || refMeta.docNo || refMeta.reconciliationId;
  if (!refId) throw new Error('Referensi dokumen rekonsiliasi wajib tersedia.');
  const userName = typeof user === 'object' && user !== null
    ? (user.name || user.fullName || user.userId || user.username || 'SYSTEM')
    : (user || 'SYSTEM');
  const batchJournal = journal.filter(entry => entry.batchId === state.batchId || entry.batchCode === state.batchCode);
  let nextSeq = batchJournal.reduce((max, entry) => Math.max(max, Number(entry.batchSeq || 0)), 0) + 1;
  let runningBalance = Number(state.availableQty || 0);
  const createdEntries = [];
  const existingEntries = [];

  // Surplus diproses lebih dahulu agar urutan balance jurnal tidak pernah negatif,
  // sementara setiap baris tetap dicatat sebagai mutasi terpisah.
  const orderedLines = [...normalizedLines].sort((a, b) => {
    if (a.direction === b.direction) return 0;
    return a.direction === 'SURPLUS' ? -1 : 1;
  });

  for (const line of orderedLines) {
    const txType = line.direction === 'SURPLUS'
      ? INVENTORY_TX_TYPE.PHYSICAL_STOCK_RECONCILIATION_SURPLUS
      : INVENTORY_TX_TYPE.PHYSICAL_STOCK_RECONCILIATION_SHORTAGE;
    const idempotencyKey = `MUT-${state.batchId}-PSR-${refId}-${line.lineId}`;
    const duplicate = batchJournal.find(entry => entry.idempotencyKey === idempotencyKey);
    if (duplicate) {
      const expectedIn = line.direction === 'SURPLUS' ? line.quantity : 0;
      const expectedOut = line.direction === 'SHORTAGE' ? line.quantity : 0;
      if (duplicate.txType !== txType || Number(duplicate.qtyIn || 0) !== expectedIn || Number(duplicate.qtyOut || 0) !== expectedOut) {
        throw new Error(`StockIntegrityBreachError: IdempotencyKey '${idempotencyKey}' terdeteksi dengan payload berbeda.`);
      }
      existingEntries.push(duplicate);
      continue;
    }

    runningBalance += line.direction === 'SURPLUS' ? line.quantity : -line.quantity;
    if (runningBalance < 0) {
      throw new Error(`Stok Batch '${state.batchCode || state.batchId}' tidak mencukupi untuk rekonsiliasi shortage.`);
    }
    const now = new Date().toISOString();
    const entry = {
      id: `JRN-${state.batchId}-${nextSeq}`,
      batchId: state.batchId,
      batchCode: state.batchCode || state.batchId,
      batchSeq: nextSeq,
      idempotencyKey,
      txType,
      qtyIn: line.direction === 'SURPLUS' ? line.quantity : 0,
      qtyOut: line.direction === 'SHORTAGE' ? line.quantity : 0,
      balance: runningBalance,
      refId,
      reconciliationId: refMeta.reconciliationId || refId,
      inspectionId: refMeta.inspectionId || null,
      lineId: line.lineId,
      bedenganId: line.bedenganId,
      bedenganCode: line.bedenganCode,
      reason: line.reason || '',
      notes: line.notes || `Rekonsiliasi stok fisik ${refMeta.docNo || refId}`,
      createdAt: now,
      createdBy: userName
    };
    journal.push(entry);
    createdEntries.push(entry);
    nextSeq += 1;
  }

  if (!createdEntries.length) {
    return {
      ...state,
      idempotentSkipped: true,
      journalIds: existingEntries.map(entry => entry.id),
      journalEntries: existingEntries.map(entry => ({ ...entry }))
    };
  }

  const previousState = { ...state };
  state.availableQty = runningBalance;
  state.status = runningBalance > 0 ? INVENTORY_STATUS.AVAILABLE : INVENTORY_STATUS.EMPTY;
  state.updatedAt = new Date().toISOString();

  try {
    _saveInventoryJournal(journal);
    _saveInventoryStates(states);
  } catch (error) {
    try {
      const rollbackJournal = _loadInventoryJournal().filter(entry => !createdEntries.some(created => created.id === entry.id));
      _saveInventoryJournal(rollbackJournal);
      Object.assign(state, previousState);
      _saveInventoryStates(states);
    } catch (_) {
      // Startup recovery akan mendeteksi intent/jurnal parsial secara fail-closed.
    }
    throw error;
  }

  _syncLegacyBatchStorage(state.batchId, runningBalance, state.receivedQty, state.status);
  const allEntries = [...existingEntries, ...createdEntries];
  return {
    ...state,
    idempotentSkipped: createdEntries.length === 0,
    journalIds: allEntries.map(entry => entry.id),
    journalEntries: allEntries.map(entry => ({ ...entry }))
  };
}

/**
 * Mengurangi stok Batch dari transaksi (Dispatch, Selection, Destruction, Adjustment)
 * @param {string} batchIdOrCode 
 * @param {number} qty 
 * @param {string} txType 
 * @param {Object|string} refIdOrMeta 
 * @param {Object|string} user 
 * @param {string} notes 
 */
export function deductBatchStock(batchIdOrCode, qty, txType = INVENTORY_TX_TYPE.DISPATCH, refIdOrMeta = null, user = null, notes = '') {
  const deductQty = Number(qty);
  if (isNaN(deductQty) || deductQty <= 0) {
    throw new Error('Kuantitas pengurangan stok harus berupa angka lebih dari 0');
  }

  const states = _loadInventoryStates();
  let state = states.find(s => s.batchId === batchIdOrCode || s.batchCode === batchIdOrCode);

  if (!state) {
    // Check fallback master batch
    const masterBatch = _findBatchInMaster(batchIdOrCode);
    if (!masterBatch) {
      throw new Error(`Batch '${batchIdOrCode}' tidak ditemukan di inventory ledger`);
    }

    const bId = masterBatch.id || masterBatch.batchId || masterBatch.batchCode;
    const bCode = masterBatch.batchCode || masterBatch.batchNo || masterBatch.kode || bId;
    const initialQty = Number(masterBatch.initialQty ?? masterBatch.receivedQty ?? 0);
    const receivedQty = Number(masterBatch.receivedQty ?? initialQty);
    const availableQty = Number(masterBatch.availableQty ?? masterBatch.currentQty ?? initialQty);
    const status = masterBatch.status || (availableQty > 0 ? INVENTORY_STATUS.AVAILABLE : INVENTORY_STATUS.EMPTY);

    state = {
      batchId: bId,
      batchCode: bCode,
      initialQty: initialQty,
      receivedQty: receivedQty,
      availableQty: availableQty,
      status: status,
      createdAt: masterBatch.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    states.push(state);
  }

  if (state.status === INVENTORY_STATUS.INACTIVE) {
    throw new Error(`Batch '${state.batchCode || state.batchId}' berstatus NONAKTIF dan tidak dapat digunakan untuk mutasi stok.`);
  }

  if (_startupRecoveryError) {
    throw new Error(`StartupRecoveryBlockedError: Recovery startup gagal (${_startupRecoveryError.message}). Operasi mutasi batch '${state.batchCode || state.batchId}' diblokir fail-closed.`);
  }

  const anomalies = storage.get('selection_anomaly_cases', []);
  const activeCase = anomalies.find(a => 
    (a.batchId === state.batchId || a.batchCode === state.batchCode) && 
    (a.status === 'BATCH_LOCKED' || a.scope === 'BATCH_GLOBAL')
  );
  if (activeCase) {
    throw new Error(`BatchLockedError: Batch '${state.batchCode || state.batchId}' dalam status terkunci global (${activeCase.status}) [Kasus: ${activeCase.caseNo || activeCase.id}]. Seluruh mutasi batch ditolak.`);
  }

  const currentAvailable = Number(state.availableQty || 0);

  const refId = typeof refIdOrMeta === 'object' && refIdOrMeta !== null
    ? (refIdOrMeta.id || refIdOrMeta.docNo || refIdOrMeta.dispatchId || refIdOrMeta.selectionId || refIdOrMeta.destructionId)
    : refIdOrMeta;

  const userName = typeof user === 'object' && user !== null
    ? (user.name || user.fullName || user.userId || user.username || 'SYSTEM')
    : (user || 'SYSTEM');

  const journal = _loadInventoryJournal();

  const idempotencyKey = typeof refIdOrMeta === 'object' && refIdOrMeta?.idempotencyKey
    ? refIdOrMeta.idempotencyKey
    : `MUT-${state.batchId}-${txType}-${refId || Date.now()}`;

  // Cek duplikasi idempotencyKey SEBELUM mutasi state (mencegah double deduction)
  const duplicateEntry = journal.find(j => (j.batchId === state.batchId || j.batchCode === state.batchCode) && j.idempotencyKey === idempotencyKey);
  if (duplicateEntry) {
    if (duplicateEntry.qtyOut === deductQty && duplicateEntry.txType === txType) {
      // Idempoten: Payload identik, skip mutasi ganda
      return { ...state, idempotentSkipped: true, journalId: duplicateEntry.id };
    } else {
      // Konflik idempotencyKey dengan payload berbeda
      throw new Error(`StockIntegrityBreachError: IdempotencyKey '${idempotencyKey}' terdeteksi dengan payload berbeda.`);
    }
  }

  if (currentAvailable < deductQty) {
    throw new Error(`Stok batch '${state.batchCode || state.batchId}' tidak mencukupi (Tersedia: ${currentAvailable}, Diminta: ${deductQty})`);
  }

  const newAvailable = currentAvailable - deductQty;
  const now = new Date().toISOString();

  state.availableQty = newAvailable;
  if (newAvailable === 0) {
    state.status = INVENTORY_STATUS.EMPTY;
  }
  state.updatedAt = now;

  _saveInventoryStates(states);

  // Deteksi batch sequence monotonik naik
  const existingBatchEntries = journal.filter(j => j.batchId === state.batchId || j.batchCode === state.batchCode);
  const nextSeq = existingBatchEntries.length + 1;
  const journalId = `JRN-${state.batchId}-${nextSeq}`;

  journal.push({
    id: journalId,
    batchId: state.batchId,
    batchCode: state.batchCode || state.batchId,
    batchSeq: nextSeq,
    idempotencyKey: idempotencyKey,
    txType: txType || INVENTORY_TX_TYPE.DISPATCH,
    qtyIn: 0,
    qtyOut: deductQty,
    balance: newAvailable,
    refId: refId || null,
    notes: notes || `Pengurangan stok (${txType}) dari ref ${refId || ''}`.trim(),
    createdAt: now,
    createdBy: userName
  });

  _saveInventoryJournal(journal);

  // Sync backward compatibility
  _syncLegacyBatchStorage(state.batchId, newAvailable, null, state.status);

  return { ...state, journalId };
}

/**
 * Eksekusi mutasi stok terkoordinasi dengan Web Locks API (Fail-Closed Policy)
 * @param {Array<string>|string} batchIds 
 * @param {Function} mutationCallback 
 */
export async function executeStockMutationWithLock(batchIds, mutationCallback) {
  const ids = Array.isArray(batchIds) ? batchIds : [batchIds];
  const sortedBatchIds = [...new Set(ids.map(id => String(id).trim()))].sort();

  if (typeof navigator === 'undefined' || !navigator.locks || !navigator.locks.request) {
    throw new Error('StockConcurrencyError: Web Locks API tidak tersedia. Operasi mutasi ditolak secara fail-closed.');
  }

  const acquireRecursive = async (index) => {
    if (index >= sortedBatchIds.length) {
      return await mutationCallback();
    }
    const bId = sortedBatchIds[index];
    return await navigator.locks.request(`lock:batch:${bId}`, { mode: 'exclusive' }, async () => {
      return await acquireRecursive(index + 1);
    });
  };

  return await acquireRecursive(0);
}

/**
 * Mengurangi stok multi-batch secara ATOMIK di bawah Web Locks (Fail-Closed & Konsisten)
 * @param {Array<{batchIdOrCode: string, qty: number}>} allocations 
 * @param {string} txType 
 * @param {string} refId 
 * @param {Object|string} user 
 */
export async function deductMultiBatchStock(allocations, txType = INVENTORY_TX_TYPE.DISPATCH, refId = null, user = null) {
  if (!Array.isArray(allocations) || allocations.length === 0) {
    return { success: false, error: 'Daftar alokasi batch tidak boleh kosong.' };
  }

  const batchIds = allocations.map(a => a.batchIdOrCode || a.batchCode || a.batchId).filter(Boolean);

  return await executeStockMutationWithLock(batchIds, async () => {
    // 1. Validasi kecukupan seluruh batch terlebih dahulu di bawah lock (all-or-nothing, no partial allocation)
    for (const alloc of allocations) {
      const bTarget = alloc.batchIdOrCode || alloc.batchCode || alloc.batchId;
      const deductQty = Number(alloc.qty);
      if (isNaN(deductQty) || deductQty <= 0) {
        return { success: false, error: `Kuantitas alokasi (${alloc.qty}) tidak valid.` };
      }

      const available = getAvailableQty(bTarget);
      if (available < deductQty) {
        return {
          success: false,
          error: `Stok batch ${bTarget} (${available.toLocaleString('id-ID')} Pkk) tidak mencukupi untuk alokasi ${deductQty.toLocaleString('id-ID')} Pkk.`
        };
      }
    }

    // 2. Eksekusi mutasi seluruh batch
    const results = [];
    for (const alloc of allocations) {
      const bTarget = alloc.batchIdOrCode || alloc.batchCode || alloc.batchId;
      const deductQty = Number(alloc.qty);
      const updated = deductBatchStock(bTarget, deductQty, txType, refId, user, alloc.notes || '');
      results.push(updated);
    }

    return { success: true, results };
  });
}

/**
 * Mengurangi stok Batch terproteksi Web Locks API
 */
export async function deductBatchStockWithLock(batchIdOrCode, qty, txType = INVENTORY_TX_TYPE.DISPATCH, refIdOrMeta = null, user = null, notes = '') {
  return await executeStockMutationWithLock(batchIdOrCode, async () => {
    return deductBatchStock(batchIdOrCode, qty, txType, refIdOrMeta, user, notes);
  });
}

/**
 * Menambah stok Batch dari Receipt terproteksi Web Locks API
 */
export async function addBatchStockFromReceiptWithLock(batchIdOrCode, qty, receiptMetaOrId = null, user = null, notes = '') {
  return await executeStockMutationWithLock(batchIdOrCode, async () => {
    return addBatchStockFromReceipt(batchIdOrCode, qty, receiptMetaOrId, user, notes);
  });
}

/**
 * Inisialisasi stok Batch terproteksi Web Locks API
 */
export async function initBatchInventoryWithLock(batchId, batchCode, initialQty = 0, options = {}) {
  return await executeStockMutationWithLock(batchId, async () => {
    return initBatchInventory(batchId, batchCode, initialQty, options);
  });
}

/**
 * Helper untuk menandai dan mengunci batch yang terdeteksi anomali integritas
 */
function _lockBatchAnomaly(batchKey, reason) {
  const anomalies = storage.get('selection_anomaly_cases', []);
  const exists = anomalies.find(a => (a.batchId === batchKey || a.batchCode === batchKey) && a.status === 'BATCH_LOCKED');
  if (!exists) {
    anomalies.push({
      id: `ANOMALY-BATCH-${Date.now()}`,
      caseNo: `CASE-BATCH-${Date.now().toString().slice(-4)}`,
      batchId: batchKey,
      batchCode: batchKey,
      status: 'BATCH_LOCKED',
      scope: 'BATCH_GLOBAL',
      reason,
      createdAt: new Date().toISOString()
    });
    storage.set('selection_anomaly_cases', anomalies);
  }
}

/**
 * Prosedur Kanonis Replay Ledger & Rekonsiliasi Saldo Batch (Section 5.3 Plan)
 * @param {string} batchIdOrCode
 * @returns {Object}
 */
export function replayBatchInventoryLedger(batchIdOrCode) {
  const possibleCodes = _resolvePossibleCodes(batchIdOrCode);
  const targetCode = Array.from(possibleCodes)[0] || String(batchIdOrCode).trim();
  const journal = _loadInventoryJournal();

  const batchEntries = journal.filter(j => possibleCodes.has(String(j.batchId).trim()) || possibleCodes.has(String(j.batchCode).trim()));

  // 1. Validasi Baseline
  const baselines = batchEntries.filter(j => 
    j.txType === INVENTORY_TX_TYPE.INITIAL || 
    j.txType === 'INITIAL_SOW' || 
    j.txType === 'MIGRATION_BASELINE'
  );

  if (baselines.length > 1) {
    _lockBatchAnomaly(targetCode, `BASELINE_CONFLICT_ERROR: Ditemukan ${baselines.length} baseline aktif pada batch ${targetCode}.`);
    throw new Error(`BASELINE_CONFLICT_ERROR: Ditemukan lebih dari satu baseline pada batch ${targetCode}. Ledger terkunci.`);
  }

  // 2. Filter entri non-baseline
  const nonBaselines = batchEntries.filter(j => 
    j.txType !== INVENTORY_TX_TYPE.INITIAL && 
    j.txType !== 'INITIAL_SOW' && 
    j.txType !== 'MIGRATION_BASELINE'
  );

  // Periksa apakah ada data historis tanpa batchSeq yang tidak dapat dipastikan urutannya
  const hasUnsequenced = nonBaselines.some(j => j.batchSeq === undefined || j.batchSeq === null);
  if (hasUnsequenced && nonBaselines.length > 1) {
    const allHaveCreatedAt = nonBaselines.every(j => j.createdAt);
    if (!allHaveCreatedAt) {
      _lockBatchAnomaly(targetCode, `AUDIT_REQUIRED: Urutan jurnal historis tidak dapat dipastikan secara deterministik.`);
      throw new Error(`AUDIT_REQUIRED: Urutan jurnal historis batch ${targetCode} tidak dapat dibuktikan.`);
    }
  }

  // Urutkan berdasarkan batchSeq menaik, lalu createdAt / id leksikografis
  nonBaselines.sort((a, b) => {
    if (a.batchSeq !== undefined && b.batchSeq !== undefined && a.batchSeq !== b.batchSeq) {
      return a.batchSeq - b.batchSeq;
    }
    const timeA = new Date(a.createdAt || 0).getTime();
    const timeB = new Date(b.createdAt || 0).getTime();
    if (timeA !== timeB) return timeA - timeB;
    return String(a.id || '').localeCompare(String(b.id || ''));
  });

  // 3. Validasi sequence gap dan nilai negatif
  let expectedSeq = baselines.length === 1 && baselines[0].batchSeq !== undefined ? baselines[0].batchSeq + 1 : 1;
  const seenIdempotencyKeys = new Map();
  let baseInitial = 0;

  if (baselines.length === 1) {
    baseInitial = Number(baselines[0].qtyIn || baselines[0].balance || 0);
  } else {
    const sows = storage.get('seeding_transactions', []);
    const matchingSow = sows.filter(s => possibleCodes.has(String(s.batchId || s.batchCode || s.batchNo || '').trim()));
    baseInitial = matchingSow.reduce((sum, s) => sum + Number(s.totalDisemai || 0), 0);
  }

  let runningBalance = baseInitial;
  let lastAppliedJournalId = baselines.length === 1 ? baselines[0].id : null;

  for (let i = 0; i < nonBaselines.length; i++) {
    const entry = nonBaselines[i];

    // Cek sequence gap jika batchSeq ada
    if (entry.batchSeq !== undefined && entry.batchSeq !== null) {
      if (entry.batchSeq > expectedSeq) {
        _lockBatchAnomaly(targetCode, `StockIntegrityBreachError: Sequence gap terdeteksi pada batch ${targetCode} (ekspektasi ${expectedSeq}, lompat ke ${entry.batchSeq}).`);
        throw new Error(`StockIntegrityBreachError: Sequence gap terdeteksi pada batch ${targetCode}.`);
      }
      expectedSeq = Math.max(expectedSeq, entry.batchSeq + 1);
    }

    // Validasi kuantitas non-negatif
    const qIn = Number(entry.qtyIn || 0);
    const qOut = Number(entry.qtyOut || 0);
    if (qIn < 0 || qOut < 0) {
      _lockBatchAnomaly(targetCode, `StockIntegrityBreachError: Kuantitas jurnal negatif terdeteksi (in: ${qIn}, out: ${qOut}).`);
      throw new Error(`StockIntegrityBreachError: Kuantitas jurnal negatif pada batch ${targetCode}.`);
    }

    // Validasi idempotency key
    if (entry.idempotencyKey) {
      if (seenIdempotencyKeys.has(entry.idempotencyKey)) {
        const prev = seenIdempotencyKeys.get(entry.idempotencyKey);
        if (prev.qtyIn !== qIn || prev.qtyOut !== qOut || prev.txType !== entry.txType) {
          _lockBatchAnomaly(targetCode, `StockIntegrityBreachError: Konflik idempotencyKey '${entry.idempotencyKey}' dengan payload berbeda.`);
          throw new Error(`StockIntegrityBreachError: Konflik idempotencyKey '${entry.idempotencyKey}' dengan payload berbeda.`);
        }
        // Identik: skip mutasi ganda kumulatif
        continue;
      }
      seenIdempotencyKeys.set(entry.idempotencyKey, entry);
    }

    runningBalance = runningBalance + qIn - qOut;
    lastAppliedJournalId = entry.id;

    if (runningBalance < 0) {
      _lockBatchAnomaly(targetCode, `StockIntegrityBreachError: Replay saldo menghasilkan nilai negatif (${runningBalance} Pkk).`);
      throw new Error(`StockIntegrityBreachError: Saldo batch ${targetCode} negatif (${runningBalance} Pkk). Ledger terkunci.`);
    }
  }

  // Update snapshot state
  const states = _loadInventoryStates();
  let state = states.find(s => possibleCodes.has(s.batchId) || possibleCodes.has(s.batchCode));
  const now = new Date().toISOString();

  if (!state) {
    state = {
      batchId: targetCode,
      batchCode: targetCode,
      initialQty: baseInitial,
      receivedQty: baseInitial,
      availableQty: runningBalance,
      status: runningBalance > 0 ? INVENTORY_STATUS.AVAILABLE : INVENTORY_STATUS.EMPTY,
      lastAppliedJournalId,
      createdAt: now,
      updatedAt: now
    };
    states.push(state);
  } else {
    state.availableQty = runningBalance;
    state.status = runningBalance > 0 ? INVENTORY_STATUS.AVAILABLE : INVENTORY_STATUS.EMPTY;
    state.lastAppliedJournalId = lastAppliedJournalId;
    state.updatedAt = now;
  }

  _saveInventoryStates(states);
  _syncLegacyBatchStorage(state.batchId, runningBalance, baseInitial, state.status);

  return { ...state };
}

let _isStartupRecoveryCompleted = false;
let _startupRecoveryError = null;

export function getStartupRecoveryStatus() {
  return {
    completed: _isStartupRecoveryCompleted,
    error: _startupRecoveryError
  };
}

export function resetStartupRecoveryStatusForTest() {
  _isStartupRecoveryCompleted = false;
  _startupRecoveryError = null;
}

/**
 * Startup Reconciler: Memindai & menyelesaikan crash boundaries sesuai Section 7 Plan
 * Terkoordinasi di bawah Web Locks API (Fail-Closed, Idempoten, Anti-Rogue)
 */
export async function reconcileStartupRecovery(options = {}) {
  try {
    const intents = storage.get('selection_mutation_intents', []);
    const decisions = storage.get('selection_approval_decisions', []);
    const journal = _loadInventoryJournal();
    const txs = storage.get('selection_transactions', []);

    const pendingIntents = intents.filter(i => i.status === 'IN_FLIGHT' || i.status === 'HALTED_RETRY_REQUIRED');
    const results = [];

    for (const intent of pendingIntents) {
      const bKey = intent.batchId || intent.batchCode;

      const resolveSingleIntent = async () => {
        // Multi-tab check (Boundary 7): re-read fresh storage inside lock
        const freshIntents = storage.get('selection_mutation_intents', []);
        const currIntent = freshIntents.find(i => i.id === intent.id);
        if (!currIntent || currIntent.status === 'COMPLETED' || currIntent.status === 'ABANDONED_ORPHAN') {
          return { intentId: intent.id, action: 'NO_OP_ALREADY_COMPLETED' };
        }

        const freshDec = decisions.find(d => d.txId === currIntent.txId || d.docNo === currIntent.docNo);
        const freshJournal = _loadInventoryJournal();
        const relatedJournal = freshJournal.find(j => 
          j.txType !== INVENTORY_TX_TYPE.INITIAL && 
          j.txType !== 'INITIAL_SOW' && 
          j.txType !== 'MIGRATION_BASELINE' &&
          ((currIntent.idempotencyKey && j.idempotencyKey === currIntent.idempotencyKey) || 
           (j.refId && (j.refId === currIntent.txId || j.refId === currIntent.docNo)))
        );

        // Boundary 2: Intent ada tanpa Decision Record sah dan tanpa Jurnal
        if (!freshDec && !relatedJournal) {
          currIntent.status = 'ABANDONED_ORPHAN';
          currIntent.updatedAt = new Date().toISOString();
          storage.set('selection_mutation_intents', freshIntents);
          return { intentId: currIntent.id, action: 'ABANDONED_ORPHAN' };
        }

        // Boundary 3: Jurnal ada tanpa Decision Record sah
        if (!freshDec && relatedJournal) {
          currIntent.status = 'CORRUPT_BREACH';
          currIntent.updatedAt = new Date().toISOString();
          _lockBatchAnomaly(currIntent.batchId, 'Jurnal mutasi ditemukan tanpa Decision Record Asisten yang sah.');
          storage.set('selection_mutation_intents', freshIntents);
          return { intentId: currIntent.id, action: 'BATCH_LOCKED' };
        }

        // Boundary 6: Jurnal tersimpan tapi kuantitas tidak cocok dengan Decision
        if (freshDec && relatedJournal) {
          const decQty = Number(freshDec.approvedQty || 0);
          const jrnQty = Number(relatedJournal.qtyOut || 0);
          if (decQty !== jrnQty) {
            currIntent.status = 'BREACH_TAMPERED';
            currIntent.updatedAt = new Date().toISOString();
            _lockBatchAnomaly(currIntent.batchId, `Ketidakcocokan kuantitas Decision (${decQty}) vs Jurnal (${jrnQty}).`);
            storage.set('selection_mutation_intents', freshIntents);
            return { intentId: currIntent.id, action: 'BATCH_LOCKED' };
          }
        }

        // Boundary 5: Decision ada, Jurnal ada, Materialized Balance / Status belum update
        if (freshDec && relatedJournal) {
          replayBatchInventoryLedger(currIntent.batchId);
          currIntent.status = 'COMPLETED';
          currIntent.updatedAt = new Date().toISOString();
          
          const freshTxs = storage.get('selection_transactions', []);
          const tx = freshTxs.find(t => t.id === currIntent.txId || t.docNo === currIntent.docNo);
          if (tx) {
            tx.status = 'DISETUJUI';
            tx.stockMutationStatus = 'APPLIED';
            tx.stockMutationAt = relatedJournal.createdAt;
            storage.set('selection_transactions', freshTxs);
          }

          // Selaraskan status pada record verification_transactions jika ada
          const freshVerifs = storage.get('verification_transactions', []);
          const vIdx = freshVerifs.findIndex(v =>
            (String(v.referenceId) === String(currIntent.txId) || String(v.referenceDocNo) === String(currIntent.docNo)) &&
            (v.referenceType === 'PENYELEKSIAN' || v.referenceType === 'SELECTION')
          );
          if (vIdx !== -1) {
            freshVerifs[vIdx].verificationStatus = 'TERVERIFIKASI';
            freshVerifs[vIdx].verifiedAt = relatedJournal.createdAt || freshVerifs[vIdx].verifiedAt;
            freshVerifs[vIdx].updatedAt = new Date().toISOString();
            storage.set('verification_transactions', freshVerifs);
          }

          storage.set('selection_mutation_intents', freshIntents);
          return { intentId: currIntent.id, action: 'FORWARD_RECOVERED' };
        }

        // Boundary 1 / 4: Decision ada, Jurnal belum ada
        if (freshDec && !relatedJournal) {
          currIntent.status = 'HALTED_RETRY_REQUIRED';
          currIntent.updatedAt = new Date().toISOString();
          const freshTxs = storage.get('selection_transactions', []);
          const tx = freshTxs.find(t => t.id === currIntent.txId || t.docNo === currIntent.docNo);
          if (tx && tx.status !== 'DIKEMBALIKAN') {
            tx.status = 'APPROVAL_INTERRUPTED';
            storage.set('selection_transactions', freshTxs);
          }
          storage.set('selection_mutation_intents', freshIntents);
          return { intentId: currIntent.id, action: 'APPROVAL_INTERRUPTED' };
        }
      };

      if (bKey) {
        const itemRes = await executeStockMutationWithLock(bKey, resolveSingleIntent);
        if (itemRes) results.push(itemRes);
      } else {
        const itemRes = await resolveSingleIntent();
        if (itemRes) results.push(itemRes);
      }
    }

    _isStartupRecoveryCompleted = true;
    _startupRecoveryError = null;
    return results;
  } catch (err) {
    _isStartupRecoveryCompleted = false;
    _startupRecoveryError = err;
    throw err;
  }
}

/**
 * Mengambil histori mutasi / jurnal dari sebuah Batch
 * @param {string} batchIdOrCode 
 * @returns {Array<Object>}
 */
export function getBatchStockHistory(batchIdOrCode) {
  if (!batchIdOrCode) return [];
  const journal = _loadInventoryJournal();
  return journal.filter(j => j.batchId === batchIdOrCode || j.batchCode === batchIdOrCode);
}

/**
 * Mengambil seluruh data saldo inventory
 * @returns {Array<Object>}
 */
export function getAllInventoryStates() {
  return _loadInventoryStates();
}

/**
 * Mengambil seluruh catatan jurnal mutasi
 * @returns {Array<Object>}
 */
export function getAllJournalEntries() {
  return _loadInventoryJournal();
}

/**
 * Reset seluruh data ledger inventory ke baseline kosong
 */
export function resetInventoryToDefault() {
  storage.set(STORAGE_KEY_INVENTORY_STATES, []);
  storage.set(STORAGE_KEY_INVENTORY_JOURNAL, []);
}
