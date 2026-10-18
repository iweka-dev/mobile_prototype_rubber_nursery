/**
 * js/data/material-master.js
 * Master Material & Issue Gudang Data Access Layer (Task: Master Material & Simulasi Issue Gudang).
 *
 * Prinsip:
 * - SOURCE OF TRUTH: Material Issue.xlsx (via js/data/material-issue-data.js)
 * - 1 Item Code = 1 Master Material
 * - 1 Item Code = 1 UOM Master (Normalized, e.g. 7056599 -> BH)
 * - 1 No Issue = 1 Dokumen Issue Gudang (61 dokumen)
 * - Dynamic Usage & Remaining derived from operational transactions (seeding_transactions)
 * - DO NOT mutate original imported baseline quantityIssue
 */

import { storage } from '../core/storage.js';
import { formatDate } from '../core/utils.js';
import {
  INITIAL_MASTER_MATERIALS,
  INITIAL_ISSUE_DOCUMENTS,
  RAW_MATERIAL_ISSUE_RECORDS,
  UOM_NORMALIZATION_LOG
} from './material-issue-data.js';

const STORAGE_KEYS = {
  MASTER_MATERIALS: 'master_materials',
  ISSUE_DOCUMENTS: 'issue_documents',
  DATA_VERSION: 'material_data_version_v3_1'
};

/**
 * Inisialisasi storage baseline jika belum ada atau versi data berubah.
 */
export function initMaterialMasterStorage(force = false) {
  const versionMatches = storage.get(STORAGE_KEYS.DATA_VERSION) === '3.1.3';
  if (force || !versionMatches || !storage.has(STORAGE_KEYS.MASTER_MATERIALS)) {
    storage.set(STORAGE_KEYS.MASTER_MATERIALS, INITIAL_MASTER_MATERIALS);
    storage.set(STORAGE_KEYS.ISSUE_DOCUMENTS, INITIAL_ISSUE_DOCUMENTS);
    storage.set(STORAGE_KEYS.DATA_VERSION, '3.1.3');
  }
}

/**
 * Helper to match an operational transaction to a specific Issue document and Issue item.
 * @param {Object} tx - Transaction object (e.g. from seeding_transactions)
 * @param {Object} doc - Issue document object (has id, noIssue)
 * @param {Object} item - Issue item detail object (has id, itemCode)
 * @param {number} docItemCount - Number of items in the issue document
 * @returns {boolean}
 */
export function isTransactionMatchingIssueItem(tx, doc, item, docItemCount = 1) {
  if (!tx || !doc || !item) return false;

  const txIssue = String(
    tx.issueDocNo || 
    tx.noIssue || 
    tx.sir || 
    tx.rawState?.selectedSir?.issueNo || 
    tx.rawState?.selectedSir?.noIssue || 
    tx.rawState?.selectedSir?.id || 
    ''
  ).trim().toUpperCase();
  const docId = String(doc.id || '').trim().toUpperCase();
  const docNo = String(doc.noIssue || '').trim().toUpperCase();

  const matchesDoc = txIssue && txIssue !== '-' && (txIssue === docId || txIssue === docNo);
  if (!matchesDoc) return false;

  // 1. Exact match via issueItemId if present in transaction
  const txItemId = String(tx.issueItemId || tx.rawState?.selectedSir?.issueItemId || '').trim().toUpperCase();
  if (txItemId && item.id) {
    return txItemId === String(item.id).trim().toUpperCase();
  }

  // 2. Fallback via itemCode if present
  const txItemCode = String(tx.itemCode || tx.rawState?.selectedSir?.itemCode || '').trim().toUpperCase();
  if (txItemCode && item.itemCode) {
    return txItemCode === String(item.itemCode).trim().toUpperCase();
  }

  // 3. Fallback for single-item documents
  if (docItemCount === 1) {
    return true;
  }

  return false;
}

/**
 * Calculates total consumption (used quantity) for a specific Issue Item across transactions.
 * @param {Object} doc - Issue document
 * @param {Object} item - Issue item detail
 * @param {number} docItemCount - Total items in doc
 * @param {string|null} excludeTxDocNo - Optional tx docNo to exclude (for edit mode)
 * @returns {number} Total used quantity
 */
export function calculateIssueItemUsedQuantity(doc, item, docItemCount = 1, excludeTxDocNo = null) {
  let usedQty = 0;

  // 1. Konsumsi dari seeding_transactions (penaburan / pindah semai polybag)
  const seedingTxs = storage.get('seeding_transactions', []) || [];
  seedingTxs.forEach(tx => {
    if (excludeTxDocNo && (tx.docNo === excludeTxDocNo || tx.id === excludeTxDocNo || tx.nomorDokumen === excludeTxDocNo)) return;
    if (isTransactionMatchingIssueItem(tx, doc, item, docItemCount)) {
      usedQty += parseInt(tx.totalPolybag || tx.rows?.[0]?.polybag || 0, 10);
    }
  });

  // 2. Konsumsi dari receipt_transactions (Penerimaan Benih / Biji Kelatak langsung memotong kuota issue)
  const receiptTxs = storage.get('receipt_transactions', []) || [];
  receiptTxs.forEach(tx => {
    if (excludeTxDocNo && (tx.docNo === excludeTxDocNo || tx.id === excludeTxDocNo || tx.nomorDokumen === excludeTxDocNo)) return;
    if (isTransactionMatchingIssueItem(tx, doc, item, docItemCount)) {
      const raw = tx.rawState?.selectedSir?.rawQty ?? 
                  tx.rawState?.selectedSir?.remainingQuantity ?? 
                  tx.rawState?.selectedSir?.quantityIssue ?? 
                  tx.jumlahBenih ?? 
                  tx.totalKecambah ?? 
                  tx.qty;
      const num = typeof raw === 'number' ? raw : parseInt(String(raw || '0').replace(/[^0-9]/g, ''), 10);
      if (!isNaN(num) && num > 0) {
        usedQty += num;
      }
    }
  });

  // 3. Konsumsi dari material_usage_transactions (pencatatan material mandor / manual)
  const manualTxs = storage.get('material_usage_transactions', []) || [];
  manualTxs.forEach(tx => {
    if (excludeTxDocNo && (tx.docNo === excludeTxDocNo || tx.id === excludeTxDocNo)) return;
    if (isTransactionMatchingIssueItem(tx, doc, item, docItemCount)) {
      const q = Number(tx.quantity !== undefined ? tx.quantity : (tx.qty !== undefined ? tx.qty : 0));
      if (!isNaN(q) && q > 0) {
        usedQty += q;
      }
    }
  });

  return usedQty;
}

/**
 * Calculates derived balance for a specific Issue Item.
 * @param {string} noIssue - Issue Document number or ID
 * @param {string} issueItemId - Specific item ID within Issue document
 * @param {string|null} itemCode - Optional itemCode fallback
 * @param {string|null} excludeDocNo - Optional seeding transaction docNo to exclude (edit mode)
 * @returns {{ quantityIssue: number, usedQuantity: number, remainingQuantity: number, status: string }}
 */
export function calculateRemainingIssueBalance(noIssue, issueItemId, itemCode = null, excludeDocNo = null) {
  initMaterialMasterStorage();
  const rawDocs = storage.get(STORAGE_KEYS.ISSUE_DOCUMENTS) || INITIAL_ISSUE_DOCUMENTS;
  const doc = rawDocs.find(d => 
    String(d.noIssue || '').trim().toUpperCase() === String(noIssue || '').trim().toUpperCase() || 
    String(d.id || '').trim().toUpperCase() === String(noIssue || '').trim().toUpperCase()
  );

  if (!doc) return { quantityIssue: 0, usedQuantity: 0, remainingQuantity: 0, status: 'NOT_FOUND' };

  const items = doc.items || [];
  const targetItem = items.find(it => String(it.id).trim() === String(issueItemId).trim()) ||
    (itemCode ? items.find(it => String(it.itemCode).trim() === String(itemCode).trim()) : null) ||
    items[0];

  if (!targetItem) return { quantityIssue: 0, usedQuantity: 0, remainingQuantity: 0, status: 'NOT_FOUND' };

  const quantityIssue = Number(targetItem.quantityIssue) || 0;
  const usedQty = calculateIssueItemUsedQuantity(doc, targetItem, items.length, excludeDocNo);
  const remainingQuantity = Math.max(0, quantityIssue - usedQty);

  let status = 'AVAILABLE';
  if (remainingQuantity === 0) status = 'FULLY_USED';
  else if (usedQty > 0) status = 'PARTIALLY_USED';

  return {
    quantityIssue,
    usedQuantity: usedQty,
    remainingQuantity,
    status
  };
}

/**
 * Mengambil seluruh data Master Material (13 records).
 */
export function getAllMaterials() {
  initMaterialMasterStorage();
  const stored = storage.get(STORAGE_KEYS.MASTER_MATERIALS);
  return (Array.isArray(stored) && stored.length > 0) ? stored : INITIAL_MASTER_MATERIALS;
}

/**
 * Mengambil Master Material berdasarkan Item Code.
 */
export function getMaterialByItemCode(itemCode) {
  if (!itemCode) return null;
  const materials = getAllMaterials();
  const codeStr = String(itemCode).trim();
  return materials.find(m => String(m.itemCode).trim() === codeStr) || null;
}

/**
 * Mengambil seluruh Dokumen Issue Gudang (61 documents) dengan derived usage & remaining real-time.
 * JANGAN memutasi original storage/imported record quantityIssue.
 */
export function getAllIssueDocuments() {
  initMaterialMasterStorage();
  const stored = storage.get(STORAGE_KEYS.ISSUE_DOCUMENTS);
  const rawDocs = (Array.isArray(stored) && stored.length > 0) ? stored : INITIAL_ISSUE_DOCUMENTS;

  // Return dynamically derived documents without mutating persistent baseline storage
  return rawDocs.map(doc => {
    const items = (doc.items || []).map(item => {
      const quantityIssue = Number(item.quantityIssue) || 0;
      const usedQuantity = calculateIssueItemUsedQuantity(doc, item, doc.items?.length || 1);
      const remainingQuantity = Math.max(0, quantityIssue - usedQuantity);

      let itemStatus = 'AVAILABLE';
      if (remainingQuantity === 0) {
        itemStatus = 'FULLY_USED';
      } else if (usedQuantity > 0) {
        itemStatus = 'PARTIALLY_USED';
      }

      return {
        ...item,
        quantityIssue,
        usedQuantity,
        remainingQuantity,
        status: doc.status === 'INACTIVE' ? 'INACTIVE' : itemStatus
      };
    });

    const totalQuantity = items.reduce((sum, it) => sum + (Number(it.quantityIssue) || 0), 0);
    const totalUsed = items.reduce((sum, it) => sum + (Number(it.usedQuantity) || 0), 0);
    const totalRemaining = items.reduce((sum, it) => sum + (Number(it.remainingQuantity) || 0), 0);

    let docStatus = 'AVAILABLE';
    if (doc.status === 'INACTIVE') {
      docStatus = 'INACTIVE';
    } else if (totalRemaining === 0 || totalUsed >= totalQuantity) {
      docStatus = 'FULLY_USED';
    } else if (totalUsed > 0) {
      docStatus = 'PARTIALLY_USED';
    }

    return {
      ...doc,
      items,
      quantityIssue: totalQuantity,
      usedQuantity: totalUsed,
      remainingQuantity: totalRemaining,
      status: docStatus
    };
  });
}

/**
 * Mengambil Dokumen Issue berdasarkan No Issue atau ID.
 */
export function getIssueByNoIssue(noIssueOrId) {
  if (!noIssueOrId) return null;
  const docs = getAllIssueDocuments();
  const query = String(noIssueOrId).trim().toUpperCase();
  return docs.find(d => 
    String(d.noIssue).trim().toUpperCase() === query || 
    String(d.id).trim().toUpperCase() === query
  ) || null;
}

/**
 * Mengambil list detail item dari Dokumen Issue.
 */
export function getIssueDetails(issueIdOrNo) {
  const doc = getIssueByNoIssue(issueIdOrNo);
  return doc?.items || [];
}

/**
 * Mengambil total kuantiti yang sudah digunakan pada Issue (real-time derived).
 */
export function getIssueUsedQuantity(issueIdOrNo) {
  const details = getIssueDetails(issueIdOrNo);
  return details.reduce((sum, item) => sum + (Number(item.usedQuantity) || 0), 0);
}

/**
 * Mengambil sisa kuantiti Issue (real-time derived).
 */
export function getIssueRemainingQuantity(issueIdOrNo) {
  const details = getIssueDetails(issueIdOrNo);
  return details.reduce((sum, item) => sum + (Number(item.remainingQuantity) || 0), 0);
}

/**
 * Mengambil status Dokumen Issue (AVAILABLE / PARTIALLY_USED / FULLY_USED).
 */
export function getIssueStatus(issueIdOrNo) {
  const doc = getIssueByNoIssue(issueIdOrNo);
  if (!doc) return 'NOT_FOUND';
  return doc.status || 'AVAILABLE';
}

/**
 * Mengambil seluruh data mentah source Excel (61 records).
 */
export function getRawSourceRecords() {
  return RAW_MATERIAL_ISSUE_RECORDS;
}

/**
 * Mengambil log normalisasi UOM.
 */
export function getUomNormalizationLog() {
  return UOM_NORMALIZATION_LOG;
}

/**
 * Summary statistik untuk header & dashboard.
 */
export function getMaterialSummaryStats() {
  const materials = getAllMaterials();
  const issues = getAllIssueDocuments();
  const unifiedRecords = getUnifiedMaterialRecords();
  
  let totalAvailableIssues = 0;
  let totalItemsCount = 0;

  issues.forEach(doc => {
    if (doc.status === 'AVAILABLE') totalAvailableIssues++;
    totalItemsCount += (doc.items || []).length;
  });

  return {
    totalMasterMaterials: materials.length,
    totalIssueDocuments: issues.length,
    totalIssueDetails: totalItemsCount,
    totalAvailableIssues,
    totalMaterialRecords: unifiedRecords.length,
    sourceRecordsCount: RAW_MATERIAL_ISSUE_RECORDS.length
  };
}

/**
 * Mengambil daftar dokumen transaksi yang menggunakan Issue Document tertentu.
 * Hanya mengembalikan ringkasan dokumen: [{ docNo, tanggal }].
 * @param {string} noIssueOrId - Nomor Issue atau ID Dokumen Issue
 * @returns {Array<{ docNo: string, tanggal: string }>}
 */
export function getIssueUsageTransactions(noIssueOrId) {
  if (!noIssueOrId) return [];
  const doc = getIssueByNoIssue(noIssueOrId);
  if (!doc) return [];

  const seedingTxs = storage.get('seeding_transactions', []);
  const matchingTxs = [];
  const items = doc.items || [];

  seedingTxs.forEach(tx => {
    const isMatch = items.some(item => isTransactionMatchingIssueItem(tx, doc, item, items.length));
    if (isMatch) {
      const docNo = tx.docNo || tx.nomorDokumen || tx.id || '-';
      const rawDate = tx.date || tx.tanggal || '-';
      const tanggal = (rawDate && rawDate !== '-') ? formatDate(rawDate) : '-';
      if (!matchingTxs.some(t => t.docNo === docNo)) {
        matchingTxs.push({ docNo, tanggal });
      }
    }
  });

  const receiptTxs = storage.get('receipt_transactions', []);
  receiptTxs.forEach(tx => {
    const isMatch = items.some(item => isTransactionMatchingIssueItem(tx, doc, item, items.length));
    if (isMatch) {
      const docNo = tx.docNo || tx.nomorDokumen || tx.id || '-';
      const rawDate = tx.date || tx.tanggal || tx.createdAt || '-';
      const tanggal = (rawDate && rawDate !== '-') ? formatDate(rawDate) : '-';
      if (!matchingTxs.some(t => t.docNo === docNo)) {
        matchingTxs.push({ docNo, tanggal });
      }
    }
  });

  return matchingTxs;
}

/**
 * Mengambil transaksi penggunaan material dari transaksi operasional (seeding_transactions / SOW).
 * 1 SOW Material Usage = 1 logical usage record.
 * @returns {Array<Object>}
 */
export function getOperationalMaterialRecords() {
  const seedingTxs = storage.get('seeding_transactions', []) || [];
  const results = [];
  const seenIds = new Set();

  seedingTxs.forEach(tx => {
    if (!tx || typeof tx !== 'object') return;
    const hasIssueDoc = Boolean(String(tx.issueDocNo || tx.noIssue || '').trim());
    const polyQty = Number(tx.totalPolybag !== undefined ? tx.totalPolybag : (tx.rows?.[0]?.polybag || 0));
    if (!hasIssueDoc || polyQty <= 0) return;

    const uniqueId = String(tx.id || tx.docNo || tx.nomorDokumen || '').trim();
    if (!uniqueId || seenIds.has(uniqueId)) return;
    seenIds.add(uniqueId);

    const docNo = tx.docNo || tx.nomorDokumen || tx.id || '-';
    const rawDate = tx.date || tx.tanggal || '-';
    const tanggalFormatted = (rawDate && rawDate !== '-') ? formatDate(rawDate) : '-';

    results.push({
      id: uniqueId,
      docNo,
      sourceType: 'OPERASIONAL',
      sourceLabel: 'Operasional · Penyemaian',
      sourceModule: 'PENYEMAIAN',
      itemCode: tx.itemCode || tx.kodeItem || '7065168',
      itemName: tx.itemName || tx.materialName || 'POLYBAG 25X50CMX0,20MM',
      quantity: polyQty,
      uom: tx.uom || tx.satuan || 'LBR',
      tanggal: tanggalFormatted,
      date: rawDate,
      issueDocNo: tx.issueDocNo || tx.noIssue || '-',
      issueItemId: tx.issueItemId || null,
      batchId: tx.batchId || null,
      batchCode: tx.batchCode || tx.batchNo || tx.batch_code || '-',
      bedenganId: tx.bedenganId || null,
      bedenganCode: tx.bedenganCode || tx.bedengan || '-',
      actor: tx.mantri || tx.actorName || tx.createdByName || 'Mantri Bibitan',
      notes: tx.keterangan || tx.notes || `Penyemaian SOW ${docNo}`,
      rawRecord: tx
    });
  });

  // 2. Operational Records dari Penerimaan Benih (APR - Penggunaan Benih/Biji Kelatak dari Dokumen Issue)
  const receiptTxs = storage.get('receipt_transactions', []) || [];
  receiptTxs.forEach(tx => {
    if (!tx || typeof tx !== 'object') return;
    const rawIssueDocNo = String(tx.issueDocNo || tx.sir || '').trim();
    const hasIssueDoc = Boolean(rawIssueDocNo) && rawIssueDocNo !== '-';

    const rawBenihQty = tx.jumlahBenih ?? 
                        tx.rawState?.selectedSir?.rawQty ?? 
                        tx.rawState?.selectedSir?.quantityIssue ?? 
                        tx.qty ?? 
                        0;
    const benihQty = typeof rawBenihQty === 'number'
      ? rawBenihQty
      : (parseInt(String(rawBenihQty).replace(/[^0-9]/g, ''), 10) || 0);

    if (!hasIssueDoc || benihQty <= 0) return;

    const uniqueId = String(tx.id || tx.docNo || tx.nomorDokumen || '').trim();
    if (!uniqueId || seenIds.has(uniqueId)) return;
    seenIds.add(uniqueId);

    const docNo = tx.docNo || tx.nomorDokumen || tx.id || '-';
    const rawDate = tx.date || tx.tanggal || tx.createdAt || '-';
    const tanggalFormatted = (rawDate && rawDate !== '-') ? formatDate(rawDate) : '-';

    const itemCode = tx.itemCode || tx.rawState?.selectedSir?.itemCode || '7030016';
    const itemName = tx.itemName || tx.rawState?.selectedSir?.itemName || tx.rawState?.selectedSir?.item || 'KLATAK (BIJI KARET)';
    const uom = tx.uom || tx.rawState?.selectedSir?.uom || 'BUTIR';
    const issueDocNo = tx.issueDocNo || (tx.sir !== '-' ? tx.sir : null) || '-';

    results.push({
      id: uniqueId,
      docNo,
      sourceType: 'OPERASIONAL',
      sourceLabel: 'Operasional · Penerimaan Benih',
      sourceModule: 'PENERIMAAN',
      itemCode,
      itemName,
      quantity: benihQty,
      uom,
      tanggal: tanggalFormatted,
      date: rawDate,
      issueDocNo,
      issueItemId: tx.issueItemId || tx.rawState?.selectedSir?.issueItemId || null,
      batchId: tx.batchId || tx.rawState?.batchId || null,
      batchCode: tx.batchNo || tx.batchCode || tx.rawState?.batchCode || '-',
      bedenganId: tx.bedenganId || null,
      bedenganCode: tx.bedengan || tx.bedenganCode || '-',
      actor: tx.mantri || tx.penerima || tx.actorName || tx.createdByName || 'Mantri Bibitan',
      notes: tx.keterangan || tx.notes || `Penerimaan Benih ${docNo}`,
      rawRecord: tx
    });
  });

  return results;
}

/**
 * Mengambil transaksi pencatatan material manual dari material_usage_transactions.
 * @returns {Array<Object>}
 */
export function getManualMaterialRecords() {
  const manualTxs = storage.get('material_usage_transactions', []) || [];
  const results = [];
  const seenIds = new Set();

  manualTxs.forEach(tx => {
    if (!tx || typeof tx !== 'object') return;
    const uniqueId = String(tx.id || tx.docNo || '').trim();
    if (!uniqueId || seenIds.has(uniqueId)) return;
    seenIds.add(uniqueId);

    const docNo = tx.docNo || tx.id || '-';
    const rawDate = tx.date || tx.tanggal || '-';
    const tanggalFormatted = (rawDate && rawDate !== '-') ? formatDate(rawDate) : '-';
    const qty = Number(tx.quantity !== undefined ? tx.quantity : (tx.qty !== undefined ? tx.qty : 0));

    results.push({
      id: uniqueId,
      docNo,
      sourceType: 'MANUAL',
      sourceLabel: 'Manual',
      sourceModule: 'MATERIAL_MANUAL',
      itemCode: tx.itemCode || tx.kodeItem || '',
      itemName: tx.itemName || tx.materialName || tx.name || 'Material',
      quantity: qty,
      uom: tx.uom || tx.satuan || tx.unit || 'Unit',
      tanggal: tanggalFormatted,
      date: rawDate,
      issueDocNo: tx.issueDocNo || tx.noIssue || '-',
      issueItemId: tx.issueItemId || null,
      batchId: tx.batchId || null,
      batchCode: tx.batchCode || tx.batchNo || '-',
      bedenganId: tx.bedenganId || null,
      bedenganCode: tx.bedenganCode || tx.bedengan || '-',
      actor: tx.mantri || tx.actorName || tx.createdByName || 'Mantri Bibitan',
      notes: tx.notes || tx.keterangan || tx.keteranganAlokasi || '-',
      rawRecord: tx
    });
  });

  return results;
}

/**
 * Mengambil seluruh rekam pencatatan material (Unified View: Operasional SOW + Manual).
 * Zero duplicate projection.
 * @returns {Array<Object>}
 */
export function getUnifiedMaterialRecords() {
  const opRecords = getOperationalMaterialRecords();
  const manRecords = getManualMaterialRecords();
  return [...opRecords, ...manRecords];
}

/**
 * Menyimpan pencatatan material manual baru ke storage canonical `material_usage_transactions`.
 * Tunduk pada validasi integritas schema.
 * @param {Object} payload
 * @param {Object} [userContext]
 * @returns {Object} Record yang berhasil disimpan
 */
export function createManualMaterialRecord(payload = {}, userContext = null) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Payload pencatatan material tidak valid.');
  }

  const itemCode = String(payload.itemCode || '').trim();
  const itemName = String(payload.itemName || '').trim();
  const qty = Number(payload.quantity !== undefined ? payload.quantity : payload.qty);
  const uom = String(payload.uom || payload.satuan || 'Unit').trim();
  const date = String(payload.date || payload.tanggal || '').trim();
  const notes = String(payload.notes || payload.keterangan || '').trim();

  if (!itemCode && !itemName) {
    throw new Error('Material wajib dipilih dari Master Material.');
  }
  if (isNaN(qty) || qty <= 0) {
    throw new Error('Jumlah kuantiti penggunaan material harus lebih besar dari 0.');
  }

  const existingList = storage.get('material_usage_transactions', []) || [];
  
  // Format docNo standar MAT/YYYY/XXX
  let docNo = payload.docNo;
  if (!docNo) {
    const year = date ? parseInt(date.slice(0, 4), 10) || 2026 : 2026;
    const count = existingList.length + 1;
    docNo = `MAT/${year}/${String(count).padStart(3, '0')}`;
  }

  const id = payload.id || `MAT-REC-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;

  const actorName = payload.createdByName || userContext?.name || 'Mantri Bibitan';
  const actorId = payload.createdByUserId || userContext?.id || userContext?.userId || 'USR-MTR-001';

  const newRecord = {
    id,
    docNo,
    sourceType: 'MANUAL',
    itemCode,
    itemName,
    quantity: qty,
    qty,
    uom,
    date: date || new Date().toISOString().slice(0, 10),
    tanggal: date || new Date().toISOString().slice(0, 10),
    issueDocNo: payload.issueDocNo || '-',
    notes: notes || '-',
    keterangan: notes || '-',
    batchId: payload.batchId || null,
    batchCode: payload.batchCode || '-',
    bedenganId: payload.bedenganId || null,
    bedenganCode: payload.bedenganCode || '-',
    estateId: payload.estateId || userContext?.estateId || 'EST-TB',
    divisionId: payload.divisionId || userContext?.divisionId || 'DIV-01',
    createdByUserId: actorId,
    createdByName: actorName,
    createdAt: new Date().toISOString()
  };

  existingList.push(newRecord);
  storage.set('material_usage_transactions', existingList);

  return newRecord;
}

