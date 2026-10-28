/**
 * modules/seeding/dederan-manager.js
 * Manager, Business Logic, and Storage Access for Baseline Dederan & Pemeriksaan Dederan (Prototype).
 *
 * Rules:
 * - 1 receipt_transactions (Benih/Biji Kelatak) = 1 dederan_induk_documents (1:1)
 * - 1 dederan_induk_documents = N dederan_transactions (1:N)
 * - Unique Bedengan per Dokumen Induk: 1 bedengan can only be used once per Dokumen Induk.
 * - Aggregate Quota Balance: Over-deder is blocked. Sisa = Total - Sum(Child Deder).
 * - Prototype Bypass 15 Days: Once parent is fully dedered, bedengans are eligible for inspection immediately.
 *   (TODO: Minimum age ±15 days rule to be enforced in production development).
 * - Partial Inspection Rule: Successful quantity only becomes eligible for Pindah Semai when bedengan is 100% inspected.
 * - Rejection Output: Inspection only outputs raw failure quantity. Sent to selection_pool as PENDING_DECLARATION (not MATI).
 */

import { storage } from '../../core/storage.js';
import { formatStandardDocNo, formatDate, generateUniqueDocNo, todayISO, getEffectiveTodayDDMMYYYY } from '../../core/utils.js';
import { isTransactionLockedForMantri } from '../verification/mantri-confirmation-service.js';
import { assertAttendanceGateOrThrow } from '../../core/attendance-gate-service.js';
import { getCurrentUserContext } from '../../core/user-context.js';
import { applyTransactionActor, canUserAccessTransaction } from '../../core/transaction-actor.js';
import { validateSourceEditability } from '../../core/dependency-guard.js';

export const DEDERAN_STORAGE_KEYS = Object.freeze({
  INDUK: 'dederan_induk_documents',
  TRANSACTIONS: 'dederan_transactions',
  INSPECTIONS: 'dederan_inspections'
});

export const DEDERAN_INDUK_STATUS = Object.freeze({
  NOT_STARTED: 'Belum Dideder',
  IN_PROGRESS: 'Deder Belum Selesai',
  COMPLETED: 'Selesai Dideder'
});

/**
 * Normalizes and syncs Dokumen Induk Deder for all Benih receipts in receipt_transactions (1:1)
 */
export function syncDederanIndukDocuments() {
  const receiptTxs = storage.get('receipt_transactions', []);
  const benihTxs = receiptTxs
    .map((tx, originalIndex) => ({ ...tx, originalIndex }))
    .filter(tx => tx.jenis === 'Benih / Biji Kelatak');

  let indukDocs = storage.get(DEDERAN_STORAGE_KEYS.INDUK, []);
  let dederTxs = storage.get(DEDERAN_STORAGE_KEYS.TRANSACTIONS, []);
  let hasChange = false;

  // Auto-migrate legacy DED-IND to DDR
  indukDocs.forEach(induk => {
    if (induk.docNo && induk.docNo.includes('/DED-IND/')) {
      const oldDocNo = induk.docNo;
      induk.docNo = oldDocNo.replace('/DED-IND/', '/DDR/');
      if (induk.id && induk.id.startsWith('DED-IND-')) {
        induk.id = induk.id.replace('DED-IND-', 'DDR-');
      }
      hasChange = true;

      // Update child transactions referencing old docNo
      dederTxs.forEach(t => {
        if (t.parentDederIndukDocNo === oldDocNo) {
          t.parentDederIndukDocNo = induk.docNo;
          storage.set(DEDERAN_STORAGE_KEYS.TRANSACTIONS, dederTxs);
        }
      });
    }
  });

  // Auto-clean any legacy batchNo on existing induk documents
  indukDocs.forEach(induk => {
    if ('batchNo' in induk || 'batchCode' in induk || 'batchId' in induk) {
      delete induk.batchNo;
      delete induk.batchCode;
      delete induk.batchId;
      hasChange = true;
    }
  });

  benihTxs.forEach((rtx, idx) => {
    const sourceReceiptDocNo = rtx.docNo || rtx.nomorDokumen || formatStandardDocNo(2026, 'APR', idx + 1);
    let induk = indukDocs.find(d => d.sourceReceiptDocNo === sourceReceiptDocNo || d.sourceReceiptIndex === rtx.originalIndex);

    const rawBenihQty = rtx.jumlahBenih ?? 
                        rtx.rawState?.selectedSir?.rawQty ?? 
                        rtx.totalKecambah ?? 
                        rtx.jumlah ?? 
                        rtx.qty ?? 
                        0;
    const totalNilaiButirPenerimaan = typeof rawBenihQty === 'number' 
      ? rawBenihQty 
      : (parseInt(String(rawBenihQty).replace(/[^0-9]/g, ''), 10) || 0);

    // Calculate aggregated child deder transactions
    const childTxs = dederTxs.filter(t => t.parentDederIndukDocNo === (induk?.docNo) || t.sourceReceiptDocNo === sourceReceiptDocNo);
    let totalDidederSDHI = 0;
    childTxs.forEach(t => {
      totalDidederSDHI += parseInt(t.jumlahDeder || 0);
    });

    const sisaBelumDeder = Math.max(0, totalNilaiButirPenerimaan - totalDidederSDHI);
    let status = DEDERAN_INDUK_STATUS.NOT_STARTED;
    if (totalDidederSDHI > 0 && sisaBelumDeder > 0) {
      status = DEDERAN_INDUK_STATUS.IN_PROGRESS;
    } else if (totalDidederSDHI >= totalNilaiButirPenerimaan && totalNilaiButirPenerimaan > 0) {
      status = DEDERAN_INDUK_STATUS.COMPLETED;
    }

    if (!induk) {
      // Create new Induk Doc with DDR format (tanpa Batch)
      const docNo = generateUniqueDocNo('dederanInduk', indukDocs, 2026);
      induk = {
        id: `DDR-${sourceReceiptDocNo.replace(/\//g, '-')}`,
        docNo,
        sourceReceiptDocNo,
        sourceReceiptIndex: rtx.originalIndex,
        programId: rtx.programId || null,
        programCode: rtx.program || rtx.programCode || 'PRG/NUR/01/2026',
        program: rtx.program || rtx.programCode || 'PRG/NUR/01/2026',
        estateId: rtx.estateId || 'EST-TBS',
        divisionId: rtx.divisionId || 'DIV-001',
        klon: rtx.klon || 'GT 1',
        tahapan: rtx.tahapan || 'Rubber Main Nursery',
        tanggalPenerimaan: rtx.tanggal || getEffectiveTodayDDMMYYYY(),
        totalNilaiButirPenerimaan,
        totalDidederSDHI,
        sisaBelumDeder,
        status,
        firstDederDate: childTxs[0]?.tanggalDeder || null,
        lastDederDate: childTxs[childTxs.length - 1]?.tanggalDeder || null,
        completedAt: status === DEDERAN_INDUK_STATUS.COMPLETED ? (childTxs[childTxs.length - 1]?.createdAt || new Date().toISOString()) : null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      indukDocs.push(induk);
      hasChange = true;
    } else {
      // Update aggregate values
      let changed = false;
      if (induk.totalNilaiButirPenerimaan !== totalNilaiButirPenerimaan) { induk.totalNilaiButirPenerimaan = totalNilaiButirPenerimaan; changed = true; }
      if (induk.totalDidederSDHI !== totalDidederSDHI) { induk.totalDidederSDHI = totalDidederSDHI; changed = true; }
      if (induk.sisaBelumDeder !== sisaBelumDeder) { induk.sisaBelumDeder = sisaBelumDeder; changed = true; }
      if (induk.status !== status) { induk.status = status; changed = true; }
      if (childTxs.length > 0) {
        induk.firstDederDate = childTxs[0].tanggalDeder;
        induk.lastDederDate = childTxs[childTxs.length - 1].tanggalDeder;
      }
      if (status === DEDERAN_INDUK_STATUS.COMPLETED && !induk.completedAt) {
        induk.completedAt = new Date().toISOString();
        changed = true;
      }
      const progCode = rtx.program || rtx.programCode || rtx.programPembibitan || rtx.rawState?.programNurseryCode || 'PRG/NUR/01/2026';
      if (!induk.program || induk.program !== progCode) {
        induk.program = progCode;
        induk.programCode = progCode;
        changed = true;
      }
      if (changed) hasChange = true;
    }
  });

  if (hasChange) {
    storage.set(DEDERAN_STORAGE_KEYS.INDUK, indukDocs);
  }

  // Jalankan pembersihan lineage Batch pada runtime data Dederan
  cleanupDederanBatchLineage();

  return indukDocs;
}

/**
 * Gets all Dokumen Induk Deder
 */
export function getAllDederanIndukDocuments() {
  return syncDederanIndukDocuments();
}

export const getDederanIndukDocuments = getAllDederanIndukDocuments;

/**
 * Gets Dokumen Induk Deder by docNo or ID
 */
export function getDederanIndukById(idOrDocNo) {
  if (!idOrDocNo) return null;
  const list = getAllDederanIndukDocuments();
  return list.find(d => d.id === idOrDocNo || d.docNo === idOrDocNo || d.sourceReceiptDocNo === idOrDocNo) || null;
}

/**
 * Gets all Dederan Transactions
 */
export function getDederanTransactions() {
  return storage.get(DEDERAN_STORAGE_KEYS.TRANSACTIONS, []);
}

/**
 * Gets Dederan Transaction by ID or docNo
 */
export function getDederanTransactionById(idOrDocNo) {
  if (!idOrDocNo) return null;
  const list = getDederanTransactions();
  return list.find(t => t.id === idOrDocNo || t.docNo === idOrDocNo) || null;
}

/**
 * Gets all Child Deder Transactions for a parent Dokumen Induk Deder
 */
export function getDederanTransactionsByParent(parentDocNoOrId) {
  if (!parentDocNoOrId) return [];
  const list = storage.get(DEDERAN_STORAGE_KEYS.TRANSACTIONS, []);
  return list.filter(t => t.parentDederIndukDocNo === parentDocNoOrId || t.parentDederIndukId === parentDocNoOrId || t.sourceReceiptDocNo === parentDocNoOrId);
}

/**
 * Validates a Dederan transaction payload before saving
 */
export function validateDederanTransaction(txPayload) {
  if (!txPayload) return { isValid: false, error: 'Data transaksi dederan tidak valid.' };

  const parentDocNo = txPayload.parentDederIndukDocNo;
  const parent = getDederanIndukById(parentDocNo);
  if (!parent) {
    return { isValid: false, error: `Dokumen Induk Deder '${parentDocNo}' tidak ditemukan.` };
  }

  const existingChildTxs = getDederanTransactionsByParent(parent.docNo);
  const bedId = String(txPayload.bedenganId || txPayload.bedenganCode || '').trim();
  const bedCode = String(txPayload.bedenganCode || txPayload.bedengan || '').trim();

  // UNIQUE BEDENGAN VALIDATION (Checked first)
  const isDuplicateBed = existingChildTxs.some(t =>
    (t.bedenganId && t.bedenganId === bedId) ||
    (t.bedenganCode && t.bedenganCode === bedCode) ||
    (t.bedengan && (t.bedengan === bedCode || t.bedengan === bedId))
  );

  if (isDuplicateBed) {
    return { isValid: false, error: `Bedengan '${bedCode || bedId}' sudah digunakan pada Dokumen Induk Deder ini. Satu bedengan hanya boleh digunakan satu kali.` };
  }

  const jumlahDeder = parseInt(txPayload.jumlahDeder || 0, 10);
  if (isNaN(jumlahDeder) || jumlahDeder <= 0) {
    return { isValid: false, error: 'Jumlah di deder harus berupa bilangan bulat lebih dari 0.' };
  }

  if (jumlahDeder > parent.sisaBelumDeder) {
    return { isValid: false, error: `Jumlah di deder (${jumlahDeder.toLocaleString('id-ID')}) melebihi sisa belum dideder (${parent.sisaBelumDeder.toLocaleString('id-ID')}).` };
  }

  return { isValid: true };
}

/**
 * Saves a new Transaksi Dederan with full validations:
 * - jumlahDeder > 0
 * - Unique Bedengan within same parent Induk Doc
 * - No Over-Deder (jumlahDeder <= sisaBelumDeder)
 */
export function saveDederanTransaction(txPayload) {
  assertAttendanceGateOrThrow();
  if (!txPayload) throw new Error('Data transaksi dederan tidak valid.');

  const parentDocNo = txPayload.parentDederIndukDocNo;
  const parent = getDederanIndukById(parentDocNo);
  if (!parent) {
    throw new Error(`Dokumen Induk Deder '${parentDocNo}' tidak ditemukan.`);
  }

  const existingChildTxs = getDederanTransactionsByParent(parent.docNo);
  const bedId = String(txPayload.bedenganId || txPayload.bedenganCode || '').trim();
  const bedCode = String(txPayload.bedenganCode || txPayload.bedengan || '').trim();

  // UNIQUE BEDENGAN VALIDATION
  const isDuplicateBed = existingChildTxs.some(t =>
    (t.bedenganId && t.bedenganId === bedId) ||
    (t.bedenganCode && t.bedenganCode === bedCode) ||
    (t.bedengan && (t.bedengan === bedCode || t.bedengan === bedId))
  );

  if (isDuplicateBed) {
    throw new Error(`Bedengan '${bedCode || bedId}' sudah digunakan pada Dokumen Induk Deder ini. Satu bedengan hanya boleh digunakan satu kali.`);
  }

  const jumlahDeder = parseInt(txPayload.jumlahDeder || 0, 10);
  if (isNaN(jumlahDeder) || jumlahDeder <= 0) {
    throw new Error('Jumlah di deder harus berupa bilangan bulat lebih dari 0.');
  }

  if (jumlahDeder > parent.sisaBelumDeder) {
    throw new Error(`Jumlah di deder (${jumlahDeder.toLocaleString('id-ID')}) melebihi sisa belum dideder (${parent.sisaBelumDeder.toLocaleString('id-ID')}).`);
  }

  const allDederTxs = storage.get(DEDERAN_STORAGE_KEYS.TRANSACTIONS, []);
  const docNo = generateUniqueDocNo('dederan', allDederTxs, 2026);
  const userCtx = getCurrentUserContext();
  const actorName = txPayload.recordedBy || txPayload.createdBy || userCtx?.name || 'Wagiman';

  const newTx = {
    id: `DED-TX-${docNo.replace(/\//g, '-')}`,
    docNo,
    parentDederIndukId: parent.id,
    parentDederIndukDocNo: parent.docNo,
    sourceReceiptDocNo: parent.sourceReceiptDocNo,
    tanggalDeder: txPayload.tanggalDeder || getEffectiveTodayDDMMYYYY(),
    estateId: parent.estateId,
    divisionId: parent.divisionId,
    programId: parent.programId,
    programCode: parent.programCode,
    klon: parent.klon,
    bedenganId: bedId,
    bedenganCode: bedCode,
    bedengan: bedCode,
    qrCode: txPayload.qrCode || null,
    jumlahDeder,
    photos: txPayload.photos || [],
    recordedBy: actorName,
    actorName: actorName,
    createdBy: userCtx?.userId || userCtx?.id || 'TBS-MNT-001',
    createdByName: actorName,
    createdAt: new Date().toISOString()
  };

  const finalizedTx = applyTransactionActor(newTx, 'CREATE', userCtx);
  allDederTxs.push(finalizedTx);
  storage.set(DEDERAN_STORAGE_KEYS.TRANSACTIONS, allDederTxs);

  // Re-sync induk document aggregate balance and status
  syncDederanIndukDocuments();

  return finalizedTx;
}

/**
 * Deletes a Dederan transaction if no inspections have been recorded
 */
export function deleteDederanTransaction(docNoOrId) {
  if (!docNoOrId) return { success: false, error: 'ID transaksi tidak valid' };

  const inspections = getDederanInspectionsByDederTx(docNoOrId);
  if (inspections.length > 0) {
    return { success: false, error: 'Transaksi tidak dapat dihapus karena sudah memiliki data pemeriksaan.' };
  }

  let txs = storage.get(DEDERAN_STORAGE_KEYS.TRANSACTIONS, []);
  const idx = txs.findIndex(t => t.id === docNoOrId || t.docNo === docNoOrId);
  if (idx < 0) {
    return { success: false, error: 'Transaksi tidak ditemukan.' };
  }

  const deleted = txs.splice(idx, 1)[0];
  storage.set(DEDERAN_STORAGE_KEYS.TRANSACTIONS, txs);

  // Re-sync induk document aggregate balance and status
  syncDederanIndukDocuments();

  return { success: true, deleted };
}

/**
 * Deterministically sorts inspection documents:
 * 1. tanggalPemeriksaan ASC
 * 2. createdAt ASC
 * 3. docNo / id ASC
 */
export function sortInspectionsChronologically(inspections) {
  if (!Array.isArray(inspections)) return [];
  return [...inspections].sort((a, b) => {
    const dateA = a.tanggalPemeriksaan || '';
    const dateB = b.tanggalPemeriksaan || '';
    if (dateA !== dateB) return dateA.localeCompare(dateB);
    const createdA = a.createdAt || '';
    const createdB = b.createdAt || '';
    if (createdA !== createdB) return createdA.localeCompare(createdB);
    const idA = a.docNo || a.id || '';
    const idB = b.docNo || b.id || '';
    return idA.localeCompare(idB);
  });
}

/**
 * Gets all active inspections performed for a specific bedengan dederan transaction
 * Excludes BATAL, CANCELLED, and VOID documents (F-01)
 */
export function getDederanInspectionsByDederTx(dederTxDocNo) {
  if (!dederTxDocNo) return [];
  const list = [
    ...storage.get(DEDERAN_STORAGE_KEYS.INSPECTIONS, []),
    ...storage.get('dederan_inspection_transactions', [])
  ];
  return list.filter(i => {
    const isTarget = i.dederanTxDocNo === dederTxDocNo || i.dederanTxId === dederTxDocNo;
    const isCancelled = ['BATAL', 'CANCELLED', 'VOID'].includes(String(i.status || '').toUpperCase());
    return isTarget && !isCancelled;
  });
}

/**
 * Calculates max allowed inspection quota using Strict Chronological Prefix (AC-01)
 * maxAllowed(k) = max(0, latestSourcePopulation - totalJumlahDiperiksaDokumenAktifSebelumnya)
 */
export function getInspectionChronologicalMaxAllowed(dederTx, targetInspection) {
  if (!dederTx) return 0;
  const totalPopulation = parseInt(dederTx.jumlahDeder || 0, 10);
  const activeInspections = getDederanInspectionsByDederTx(dederTx.docNo);

  // Filter out the target inspection if it's already in the storage list
  const otherInspections = activeInspections.filter(i => {
    if (targetInspection.id && i.id === targetInspection.id) return false;
    if (targetInspection.docNo && i.docNo === targetInspection.docNo) return false;
    return true;
  });

  // Combine other active inspections with target inspection and sort deterministically
  const combined = [...otherInspections, targetInspection];
  const sorted = sortInspectionsChronologically(combined);

  // Find index of target in sorted list
  const targetIdx = sorted.findIndex(i => {
    if (targetInspection.id && i.id === targetInspection.id) return true;
    if (targetInspection.docNo && i.docNo === targetInspection.docNo) return true;
    return i === targetInspection;
  });

  let priorSum = 0;
  for (let i = 0; i < targetIdx; i++) {
    priorSum += parseInt(sorted[i].jumlahDiperiksa || 0, 10);
  }

  return Math.max(0, totalPopulation - priorSum);
}

/**
 * Calculates inspection summary for a specific dederan transaction
 */
export function getBedenganInspectionSummary(dederTx) {
  if (!dederTx) return { totalDeder: 0, totalDiperiksa: 0, totalBerhasil: 0, totalTidakBerhasil: 0, isComplete: false, remainingToInspect: 0 };

  const inspections = getDederanInspectionsByDederTx(dederTx.docNo);
  const totalDeder = parseInt(dederTx.jumlahDeder || 0, 10);
  let totalDiperiksa = 0;
  let totalBerhasil = 0;
  let totalTidakBerhasil = 0;

  inspections.forEach(i => {
    totalDiperiksa += parseInt(i.jumlahDiperiksa || 0, 10);
    totalBerhasil += parseInt(i.jumlahBerhasil || 0, 10);
    totalTidakBerhasil += parseInt(i.jumlahTidakBerhasil || 0, 10);
  });

  const remainingToInspect = Math.max(0, totalDeder - totalDiperiksa);
  const isComplete = totalDiperiksa >= totalDeder && totalDeder > 0;

  return {
    totalDeder,
    totalDiperiksa,
    totalBerhasil,
    totalTidakBerhasil,
    isComplete,
    remainingToInspect,
    sisaBelumDiperiksa: remainingToInspect
  };
}

/**
 * Validates a Pemeriksaan Dederan payload before saving
 */
export function validateDederanInspection(payload) {
  if (!payload) return { isValid: false, error: 'Data pemeriksaan dederan tidak valid.' };

  const dederTxDocNo = payload.dederanTxDocNo || payload.dederanTxId;
  const dederTxs = storage.get(DEDERAN_STORAGE_KEYS.TRANSACTIONS, []);
  const dederTx = dederTxs.find(t => t.docNo === dederTxDocNo || t.id === dederTxDocNo);

  if (!dederTx) {
    return { isValid: false, error: `Transaksi Dederan '${dederTxDocNo}' tidak ditemukan.` };
  }

  const prevSummary = getBedenganInspectionSummary(dederTx);
  const jumlahDiperiksa = parseInt(payload.jumlahDiperiksa || 0, 10);
  const jumlahBerhasil = parseInt(payload.jumlahBerhasil || 0, 10);

  if (isNaN(jumlahDiperiksa) || jumlahDiperiksa <= 0) {
    return { isValid: false, error: 'Jumlah Diperiksa harus lebih dari 0.' };
  }

  const tempInspection = {
    tanggalPemeriksaan: payload.tanggalPemeriksaan || formatDate(new Date().toISOString()),
    createdAt: new Date().toISOString(),
    docNo: 'TEMP-NEW-DOC',
    id: 'TEMP-NEW-ID',
    jumlahDiperiksa
  };
  const maxAllowed = getInspectionChronologicalMaxAllowed(dederTx, tempInspection);

  if (jumlahDiperiksa > maxAllowed) {
    return { isValid: false, error: `Jumlah Diperiksa (${jumlahDiperiksa.toLocaleString('id-ID')}) melebihi sisa yang belum diperiksa (${maxAllowed.toLocaleString('id-ID')}).` };
  }
  if (isNaN(jumlahBerhasil) || jumlahBerhasil < 0) {
    return { isValid: false, error: 'Jumlah Berhasil tidak boleh bernilai negatif.' };
  }
  if (jumlahBerhasil > jumlahDiperiksa) {
    return { isValid: false, error: 'Jumlah Berhasil tidak boleh melebihi Jumlah Diperiksa.' };
  }

  return { isValid: true, dederTx, prevSummary, maxAllowed };
}

/**
 * Creates a new Pemeriksaan Dederan record and updates the selection pool
 */
export function createDederanInspection(payload) {
  assertAttendanceGateOrThrow();
  const validation = validateDederanInspection(payload);
  if (!validation.isValid) {
    throw new Error(validation.error);
  }

  const { dederTx } = validation;
  const allInspections = storage.get(DEDERAN_STORAGE_KEYS.INSPECTIONS, []);
  const docNo = generateUniqueDocNo('dederanInspection', allInspections, 2026);

  const jumlahDeder = parseInt(dederTx.jumlahDeder || 0, 10);
  const jumlahDiperiksa = parseInt(payload.jumlahDiperiksa || 0, 10);
  const jumlahBerhasil = parseInt(payload.jumlahBerhasil || 0, 10);
  const jumlahTidakBerhasil = jumlahDiperiksa - jumlahBerhasil;

  const userCtx = getCurrentUserContext();
  const inspectorName = payload.inspectorName || userCtx?.name || 'Wagiman';

  const newInspection = {
    id: `DED-INS-${docNo.replace(/\//g, '-')}`,
    docNo,
    parentDederIndukId: dederTx.parentDederIndukId,
    parentDederIndukDocNo: dederTx.parentDederIndukDocNo,
    dederanTxId: dederTx.id,
    dederanTxDocNo: dederTx.docNo,
    sourceReceiptDocNo: dederTx.sourceReceiptDocNo,
    tanggalPemeriksaan: payload.tanggalPemeriksaan || getEffectiveTodayDDMMYYYY(),
    estateId: dederTx.estateId,
    divisionId: dederTx.divisionId,
    programId: dederTx.programId,
    programCode: dederTx.programCode,
    bedenganId: dederTx.bedenganId,
    bedenganCode: dederTx.bedenganCode,
    klon: dederTx.klon || 'GT 1',
    jumlahDeder,
    jumlahDiperiksa,
    jumlahBerhasil,
    jumlahTidakBerhasil,
    photos: Array.isArray(payload.photos) ? payload.photos : [],
    inspectorName,
    inspektur: inspectorName,
    actorName: inspectorName,
    inspectorId: userCtx?.userId || userCtx?.id || 'TBS-MNT-001',
    inspectorCode: userCtx?.code || 'MNT001',
    createdByUserId: userCtx?.userId || userCtx?.id || 'TBS-MNT-001',
    createdByName: inspectorName,
    createdAt: new Date().toISOString()
  };

  const finalizedInspection = applyTransactionActor(newInspection, 'CREATE', userCtx);
  allInspections.push(finalizedInspection);
  storage.set(DEDERAN_STORAGE_KEYS.INSPECTIONS, allInspections);

  // Check cumulative status for this bedengan
  const newSummary = getBedenganInspectionSummary(dederTx);

  // Consolidate rejection / inspection result to selection_pool as PENDING_DECLARATION only if reject > 0
  if (newSummary.totalTidakBerhasil > 0) {
    integrateDederanRejectionToSelectionPool({
      ...finalizedInspection,
      jumlahBerhasil: newSummary.totalBerhasil,
      jumlahLayak: newSummary.totalBerhasil,
      jumlahDiperiksa: newSummary.totalDiperiksa
    }, newSummary.totalTidakBerhasil);
  }

  return {
    inspection: finalizedInspection,
    summary: newSummary
  };
}

export const saveDederanInspection = createDederanInspection;

/**
 * Helper untuk memeriksa apakah transaksi CULL Dederan sudah diajukan atau disetujui
 */
function isCullSubmittedOrApproved(tx) {
  if (!tx) return false;
  const s = String(tx.status || '').toUpperCase();
  const sub = String(tx.submissionStatus || '').toUpperCase();
  const ver = String(tx.verificationStatus || '').toUpperCase();
  return (
    s === 'MENUNGGU_VERIFIKASI' ||
    s === 'SUBMITTED_TO_ASB' ||
    s === 'DIAJUKAN' ||
    sub === 'SUBMITTED_TO_ASB' ||
    s === 'DISETUJUI' ||
    s === 'TERVERIFIKASI' ||
    s === 'APPROVED' ||
    ver === 'TERVERIFIKASI' ||
    ver === 'APPROVED'
  );
}

/**
 * Integrates failed dederan inspection quantities to selection_pool as PENDING_DECLARATION
 * NOTE: Category is NOT set to MATI here; it is determined later in Pasca Semai.
 * Batch is NOT propagated for Dederan rejections.
 */
export function integrateDederanRejectionToSelectionPool(inspectionTx, totalTidakBerhasilQty) {
  const qty = parseInt(totalTidakBerhasilQty !== undefined ? totalTidakBerhasilQty : inspectionTx.jumlahTidakBerhasil, 10);
  if (isNaN(qty) || qty < 0) return null;

  let selectionPool = storage.get('selection_pool', []);

  const dederanTxDocNo = inspectionTx.dederanTxDocNo || inspectionTx.docNo;
  const poolId = `SEL-POOL-DED-${dederanTxDocNo}`;
  const inspectionDocNo = inspectionTx.docNo;
  const inspectionId = inspectionTx.id;
  const bedenganCode = inspectionTx.bedenganCode;
  const parentInduk = inspectionTx.parentDederIndukDocNo || inspectionTx.dederanIndukDocNo;

  const existingIdx = selectionPool.findIndex(s => {
    if (s.id === poolId) return true;
    if (s.dederanDocNo && s.dederanDocNo === dederanTxDocNo && (s.originType === 'REJECT_DEDERAN' || s.sourceModule === 'DEDERAN')) return true;
    if (s.sourceDocNo && (s.sourceDocNo === dederanTxDocNo || (inspectionDocNo && s.sourceDocNo === inspectionDocNo)) && (s.originType === 'REJECT_DEDERAN' || s.sourceModule === 'DEDERAN')) return true;
    if (s.sourceTransactionId && (s.sourceTransactionId === dederanTxDocNo || (inspectionId && s.sourceTransactionId === inspectionId) || (inspectionDocNo && s.sourceTransactionId === inspectionDocNo)) && (s.originType === 'REJECT_DEDERAN' || s.sourceModule === 'DEDERAN')) return true;
    if (bedenganCode && s.bedenganCode === bedenganCode && (s.originType === 'REJECT_DEDERAN' || s.sourceModule === 'DEDERAN')) {
      if (s.dederanIndukDocNo && parentInduk && s.dederanIndukDocNo === parentInduk) return true;
      if (!s.dederanDocNo && !s.sourceDocNo) return true;
    }
    return false;
  });

  // PATH B Guard: If qty === 0, do not create or maintain pending candidate
  if (qty === 0) {
    const existingItem = existingIdx >= 0 ? selectionPool[existingIdx] : null;
    if (existingIdx >= 0 && existingItem) {
      // Only clean up draft pending candidate, do NOT delete if already converted to official transaction
      if (!existingItem.selectionTransactionId && existingItem.status === 'PENDING_DECLARATION') {
        selectionPool.splice(existingIdx, 1);
        storage.set('selection_pool', selectionPool);
      } else if (!isCullSubmittedOrApproved(existingItem)) {
        existingItem.jumlahAfkir = 0;
        existingItem.quantity = 0;
        storage.set('selection_pool', selectionPool);
      }
    }

    // Also sync downstream selection_transactions to 0 ONLY if still draft / unsubmitted
    let selTxs = storage.get('selection_transactions', []);
    let selChanged = false;
    selTxs = selTxs.map(tx => {
      const isDeder = tx.originType === 'REJECT_DEDERAN' || tx.sourceModule === 'DEDERAN' || String(tx.stage || tx.selectionStage || '').includes('DEDERAN');
      if (!isDeder) return tx;
      const matchDoc = (existingItem?.selectionDocNo && (tx.docNo === existingItem.selectionDocNo || tx.selectionNo === existingItem.selectionDocNo)) ||
                       (existingItem?.selectionTransactionId && (tx.id === existingItem.selectionTransactionId || tx.selectionId === existingItem.selectionTransactionId)) ||
                       (tx.sourceTransactionId && (tx.sourceTransactionId === inspectionTx.id || tx.sourceTransactionId === inspectionTx.docNo || tx.sourceTransactionId === dederanTxDocNo)) ||
                       (tx.sourceDocNo && (tx.sourceDocNo === inspectionTx.docNo || tx.sourceDocNo === dederanTxDocNo)) ||
                       (tx.dederanDocNo && tx.dederanDocNo === dederanTxDocNo) ||
                       (bedenganCode && (tx.bedenganCode === bedenganCode || tx.bedengan === bedenganCode));
      if (matchDoc) {
        // PROTEKSI: Jangan menimpa transaksi yang sudah diajukan untuk verifikasi atau disetujui
        if (!isCullSubmittedOrApproved(tx)) {
          selChanged = true;
          return {
            ...tx,
            jumlahAfkir: 0,
            quantity: 0,
            actualBibitSelectedQty: 0,
            jumlahAfkirTotal: 0,
            bibitReject: 0,
            polybagCount: 0,
            updatedAt: new Date().toISOString()
          };
        }
      }
      return tx;
    });
    if (selChanged) storage.set('selection_transactions', selTxs);

    return null;
  }

  const existingItem = existingIdx >= 0 ? selectionPool[existingIdx] : null;

  // Cek apakah item ini sudah terkait transaksi CULL resmi yang diajukan atau disetujui
  let selTxs = storage.get('selection_transactions', []);
  const linkedTx = existingItem ? selTxs.find(tx => {
    const isDeder = tx.originType === 'REJECT_DEDERAN' || tx.sourceModule === 'DEDERAN' || String(tx.stage || tx.selectionStage || '').includes('DEDERAN');
    if (!isDeder) return false;
    return (
      (existingItem.selectionDocNo && (tx.docNo === existingItem.selectionDocNo || tx.selectionNo === existingItem.selectionDocNo)) ||
      (existingItem.selectionTransactionId && (tx.id === existingItem.selectionTransactionId || tx.selectionId === existingItem.selectionTransactionId)) ||
      (existingItem.docNo && (tx.docNo === existingItem.docNo || tx.selectionNo === existingItem.docNo)) ||
      (tx.sourceTransactionId && (tx.sourceTransactionId === inspectionTx.id || tx.sourceTransactionId === inspectionTx.docNo || tx.sourceTransactionId === dederanTxDocNo))
    );
  }) : null;

  const isProtected = (linkedTx && isCullSubmittedOrApproved(linkedTx)) || (existingItem && isCullSubmittedOrApproved(existingItem));

  if (isProtected) {
    // PROTEKSI KUANTITAS CULL DEDERAN:
    // Transaksi CULL yang sedang MENUNGGU_VERIFIKASI / SUBMITTED_TO_ASB / DISETUJUI TIDAK BOLEH ditimpa kuantitasnya.
    const declaredQty = parseInt(linkedTx?.jumlahAfkir !== undefined ? linkedTx.jumlahAfkir : (existingItem?.jumlahAfkir || 0), 10);
    const deltaQty = qty - declaredQty;
    const deltaPoolId = `${poolId}-DELTA`;
    const existingDeltaIdx = selectionPool.findIndex(s => s.id === deltaPoolId || s.id === `${poolId}-ADDITIONAL`);

    if (deltaQty > 0) {
      // Tangani kuantitas tambahan hasil pemeriksaan parsial melalui kandidat delta PENDING_DECLARATION
      // Jangan membuat deklarasi atau nomor CULL baru secara otomatis!
      const deltaEntry = {
        id: deltaPoolId,
        docNo: null,
        originType: 'REJECT_DEDERAN',
        sourceModule: 'DEDERAN',
        sourceTransactionType: 'DEDER_INSPECTION',
        sourceTransactionId: inspectionTx.id || inspectionTx.docNo,
        sourceDocNo: inspectionTx.docNo || dederanTxDocNo,
        dederanDocNo: dederanTxDocNo,
        dederanIndukDocNo: inspectionTx.parentDederIndukDocNo || inspectionTx.dederanIndukDocNo || (existingItem?.dederanIndukDocNo || null),
        category: 'PENDING_DECLARATION',
        alasanDitolakCategory: null,
        jumlahDeder: inspectionTx.jumlahDeder || existingItem?.jumlahDeder || null,
        jumlahDiperiksa: inspectionTx.jumlahDiperiksa || inspectionTx.jumlahDeder || existingItem?.jumlahDiperiksa || null,
        jumlahBerhasil: inspectionTx.jumlahBerhasil || existingItem?.jumlahBerhasil || 0,
        jumlahLayak: inspectionTx.jumlahBerhasil || existingItem?.jumlahLayak || 0,
        jumlahAfkir: deltaQty,
        quantity: deltaQty,
        alasan: `Tambahan Hasil Pemeriksaan Dederan Tidak Berhasil (${inspectionTx.bedenganCode || (existingItem?.bedenganCode || '-')})`,
        estateId: inspectionTx.estateId || existingItem?.estateId || null,
        divisionId: inspectionTx.divisionId || existingItem?.divisionId || null,
        programId: inspectionTx.programId || existingItem?.programId || null,
        programCode: inspectionTx.programCode || inspectionTx.program || (existingItem?.programCode || null),
        program: inspectionTx.program || inspectionTx.programCode || (existingItem?.program || null),
        bedenganId: inspectionTx.bedenganId || existingItem?.bedenganId || null,
        bedenganCode: inspectionTx.bedenganCode || existingItem?.bedenganCode || null,
        klon: inspectionTx.klon || existingItem?.klon || 'GT 1',
        tahapan: 'Rubber Main Nursery',
        tanggal: inspectionTx.tanggalPemeriksaan || inspectionTx.tanggal || (existingItem?.tanggal || new Date().toISOString().split('T')[0]),
        status: 'PENDING_DECLARATION',
        returnReason: null,
        returnedAt: null,
        returnedByName: null,
        declaredAt: null,
        declaredBy: null,
        selectionTransactionId: null,
        selectionDocNo: null,
        stockMutationStatus: 'PENDING',
        createdAt: new Date().toISOString()
      };
      if (existingDeltaIdx >= 0) {
        selectionPool[existingDeltaIdx] = { ...selectionPool[existingDeltaIdx], ...deltaEntry, id: deltaPoolId };
      } else {
        selectionPool.push(deltaEntry);
      }
    } else if (existingDeltaIdx >= 0 && selectionPool[existingDeltaIdx].status === 'PENDING_DECLARATION') {
      selectionPool.splice(existingDeltaIdx, 1);
    }

    storage.set('selection_pool', selectionPool);
    return existingItem;
  }

  const poolEntry = {
    id: existingItem?.id || poolId,
    docNo: existingItem?.docNo || null,
    originType: 'REJECT_DEDERAN',
    sourceModule: 'DEDERAN',
    sourceTransactionType: 'DEDER_INSPECTION',
    sourceTransactionId: inspectionTx.id || inspectionTx.docNo,
    sourceDocNo: inspectionTx.docNo || dederanTxDocNo,
    dederanDocNo: dederanTxDocNo,
    dederanIndukDocNo: inspectionTx.parentDederIndukDocNo || inspectionTx.dederanIndukDocNo || (existingItem?.dederanIndukDocNo || null),
    category: existingItem?.category || 'PENDING_DECLARATION', // Preserves declared state
    alasanDitolakCategory: existingItem?.alasanDitolakCategory || null,
    jumlahDeder: inspectionTx.jumlahDeder || existingItem?.jumlahDeder || null,
    jumlahDiperiksa: inspectionTx.jumlahDiperiksa || inspectionTx.jumlahDeder || existingItem?.jumlahDiperiksa || null,
    jumlahBerhasil: inspectionTx.jumlahBerhasil !== undefined ? inspectionTx.jumlahBerhasil : (existingItem?.jumlahBerhasil || 0),
    jumlahLayak: inspectionTx.jumlahLayak !== undefined ? inspectionTx.jumlahLayak : (inspectionTx.jumlahBerhasil !== undefined ? inspectionTx.jumlahBerhasil : (existingItem?.jumlahLayak || existingItem?.jumlahBerhasil || 0)),
    actualBibitRetainedQty: inspectionTx.jumlahLayak !== undefined ? inspectionTx.jumlahLayak : (inspectionTx.jumlahBerhasil !== undefined ? inspectionTx.jumlahBerhasil : (existingItem?.actualBibitRetainedQty || existingItem?.jumlahLayak || existingItem?.jumlahBerhasil || 0)),
    jumlahAfkir: qty,
    quantity: qty,
    alasan: `Hasil Pemeriksaan Dederan Tidak Berhasil (${inspectionTx.bedenganCode || (existingItem?.bedenganCode || '-')})`,
    estateId: inspectionTx.estateId || existingItem?.estateId || null,
    divisionId: inspectionTx.divisionId || existingItem?.divisionId || null,
    programId: inspectionTx.programId || existingItem?.programId || null,
    programCode: inspectionTx.programCode || inspectionTx.program || (existingItem?.programCode || null),
    program: inspectionTx.program || inspectionTx.programCode || (existingItem?.program || null),
    bedenganId: inspectionTx.bedenganId || existingItem?.bedenganId || null,
    bedenganCode: inspectionTx.bedenganCode || existingItem?.bedenganCode || null,
    klon: inspectionTx.klon || existingItem?.klon || 'GT 1',
    tahapan: 'Rubber Main Nursery',
    tanggal: inspectionTx.tanggalPemeriksaan || inspectionTx.tanggal || (existingItem?.tanggal || new Date().toISOString().split('T')[0]),
    status: existingItem?.status || 'PENDING_DECLARATION',
    returnReason: existingItem?.returnReason || null,
    returnedAt: existingItem?.returnedAt || null,
    returnedByName: existingItem?.returnedByName || null,
    declaredAt: existingItem?.declaredAt || null,
    declaredBy: existingItem?.declaredBy || null,
    selectionTransactionId: existingItem?.selectionTransactionId || null,
    selectionDocNo: existingItem?.selectionDocNo || null,
    stockMutationStatus: existingItem?.stockMutationStatus || 'PENDING',
    createdAt: existingItem?.createdAt || new Date().toISOString()
  };

  if (existingIdx >= 0) {
    const merged = { ...selectionPool[existingIdx], ...poolEntry, id: selectionPool[existingIdx].id };
    delete merged.batchId;
    delete merged.batchCode;
    delete merged.batchNo;
    selectionPool[existingIdx] = merged;
  } else {
    selectionPool.push(poolEntry);
  }

  storage.set('selection_pool', selectionPool);

  // Synchronize linked selection_transactions ONLY if unsubmitted (DRAFT / READY_TO_CONFIRM)
  let selChanged = false;
  selTxs = selTxs.map(tx => {
    const isDeder = tx.originType === 'REJECT_DEDERAN' || tx.sourceModule === 'DEDERAN' || String(tx.stage || tx.selectionStage || '').includes('DEDERAN');
    if (!isDeder) return tx;

    const matchDoc = (existingItem?.selectionDocNo && (tx.docNo === existingItem.selectionDocNo || tx.selectionNo === existingItem.selectionDocNo)) ||
                     (existingItem?.selectionTransactionId && (tx.id === existingItem.selectionTransactionId || tx.selectionId === existingItem.selectionTransactionId)) ||
                     (poolEntry.docNo && (tx.docNo === poolEntry.docNo || tx.selectionNo === poolEntry.docNo || tx.selectionPoolDocNo === poolEntry.docNo)) ||
                     (tx.sourceTransactionId && (tx.sourceTransactionId === inspectionTx.id || tx.sourceTransactionId === inspectionTx.docNo || tx.sourceTransactionId === dederanTxDocNo)) ||
                     (tx.sourceDocNo && (tx.sourceDocNo === inspectionTx.docNo || tx.sourceDocNo === dederanTxDocNo)) ||
                     (tx.dederanDocNo && tx.dederanDocNo === dederanTxDocNo) ||
                     (bedenganCode && (tx.bedenganCode === bedenganCode || tx.bedengan === bedenganCode));

    if (matchDoc) {
      if (!isCullSubmittedOrApproved(tx)) {
        selChanged = true;
        return {
          ...tx,
          jumlahAfkir: qty,
          quantity: qty,
          actualBibitSelectedQty: qty,
          jumlahAfkirTotal: qty,
          bibitReject: qty,
          jumlahDiperiksa: inspectionTx.jumlahDiperiksa !== undefined ? inspectionTx.jumlahDiperiksa : (tx.jumlahDiperiksa || qty),
          jumlahBerhasil: inspectionTx.jumlahBerhasil !== undefined ? inspectionTx.jumlahBerhasil : (tx.jumlahBerhasil || 0),
          jumlahLayak: inspectionTx.jumlahLayak !== undefined ? inspectionTx.jumlahLayak : (inspectionTx.jumlahBerhasil !== undefined ? inspectionTx.jumlahBerhasil : (tx.jumlahLayak || tx.jumlahBerhasil || 0)),
          actualBibitRetainedQty: inspectionTx.jumlahLayak !== undefined ? inspectionTx.jumlahLayak : (inspectionTx.jumlahBerhasil !== undefined ? inspectionTx.jumlahBerhasil : (tx.actualBibitRetainedQty || tx.jumlahLayak || tx.jumlahBerhasil || 0)),
          polybagCount: Math.ceil(qty / 2),
          updatedAt: new Date().toISOString()
        };
      }
    }
    return tx;
  });

  if (selChanged) {
    storage.set('selection_transactions', selTxs);
  }

  return poolEntry;
}

/**
 * Membersihkan metadata Batch dari seluruh record runtime proses Dederan
 */
export function cleanupDederanBatchLineage() {
  // 1. Clean dederan_induk_documents
  let indukDocs = storage.get(DEDERAN_STORAGE_KEYS.INDUK, []);
  let indukChanged = false;
  indukDocs.forEach(d => {
    if ('batchNo' in d || 'batchCode' in d || 'batchId' in d) {
      delete d.batchNo;
      delete d.batchCode;
      delete d.batchId;
      indukChanged = true;
    }
  });
  if (indukChanged) storage.set(DEDERAN_STORAGE_KEYS.INDUK, indukDocs);

  // 2. Clean dederan_transactions
  let dederTxs = storage.get(DEDERAN_STORAGE_KEYS.TRANSACTIONS, []);
  let txChanged = false;
  dederTxs.forEach(t => {
    if ('batchNo' in t || 'batchCode' in t || 'batchId' in t) {
      delete t.batchNo;
      delete t.batchCode;
      delete t.batchId;
      txChanged = true;
    }
  });
  if (txChanged) storage.set(DEDERAN_STORAGE_KEYS.TRANSACTIONS, dederTxs);

  // 3. Clean dederan_inspections
  let inspections = storage.get(DEDERAN_STORAGE_KEYS.INSPECTIONS, []);
  let insChanged = false;
  inspections.forEach(i => {
    if ('batchNo' in i || 'batchCode' in i || 'batchId' in i) {
      delete i.batchNo;
      delete i.batchCode;
      delete i.batchId;
      insChanged = true;
    }
  });
  if (insChanged) storage.set(DEDERAN_STORAGE_KEYS.INSPECTIONS, inspections);

  // 4. Clean selection_pool for REJECT_DEDERAN
  let pool = storage.get('selection_pool', []);
  let poolChanged = false;
  pool.forEach(p => {
    if (p.originType === 'REJECT_DEDERAN' || p.sourceModule === 'DEDERAN') {
      if ('batchNo' in p || 'batchCode' in p || 'batchId' in p) {
        delete p.batchNo;
        delete p.batchCode;
        delete p.batchId;
        poolChanged = true;
      }
    }
  });
  if (poolChanged) storage.set('selection_pool', pool);

  // 5. Clean selection_transactions for REJECT_DEDERAN
  let selTxs = storage.get('selection_transactions', []);
  let selChanged = false;
  selTxs.forEach(t => {
    if (t.originType === 'REJECT_DEDERAN' || t.sourceModule === 'DEDERAN') {
      if ('batchNo' in t || 'batchCode' in t || 'batchId' in t) {
        delete t.batchNo;
        delete t.batchCode;
        delete t.batchId;
        selChanged = true;
      }
    }
  });
  if (selChanged) storage.set('selection_transactions', selTxs);
}

/**
 * Sinkronisasi seluruh rejection hasil pemeriksaan dederan ke selection_pool
 */
export function syncAllDederanRejectionsToSelectionPool() {
  cleanupDederanBatchLineage();
  const dederTxs = getDederanTransactions();
  dederTxs.forEach(dtx => {
    const summary = getBedenganInspectionSummary(dtx);
    if (summary.totalTidakBerhasil > 0) {
      integrateDederanRejectionToSelectionPool({
        ...dtx,
        jumlahBerhasil: summary.totalBerhasil,
        jumlahLayak: summary.totalBerhasil,
        jumlahDiperiksa: summary.totalDiperiksa
      }, summary.totalTidakBerhasil);
    } else {
      // Ensure zero-reject bedengan does not leave stale pending selection pool
      integrateDederanRejectionToSelectionPool({
        ...dtx,
        jumlahBerhasil: summary.totalBerhasil,
        jumlahLayak: summary.totalBerhasil,
        jumlahDiperiksa: summary.totalDiperiksa
      }, 0);
    }
  });
}

/**
 * Gets a specific Dederan Inspection by docNo or ID
 */
export function getDederanInspectionById(idOrDocNo) {
  if (!idOrDocNo) return null;
  const list = storage.get(DEDERAN_STORAGE_KEYS.INSPECTIONS, []);
  return list.find(i => i.id === idOrDocNo || i.docNo === idOrDocNo) || null;
}

/**
 * Deletes a Dederan Inspection record and cleans up downstream integration
 */
export function deleteDederanInspection(idOrDocNo) {
  if (!idOrDocNo) return { success: false, error: 'ID pemeriksaan tidak valid' };

  let inspections = storage.get(DEDERAN_STORAGE_KEYS.INSPECTIONS, []);
  const idx = inspections.findIndex(i => i.id === idOrDocNo || i.docNo === idOrDocNo);
  if (idx < 0) {
    return { success: false, error: 'Data pemeriksaan tidak ditemukan.' };
  }

  const existing = inspections[idx];
  if (isTransactionLockedForMantri(existing)) {
    return { success: false, error: 'Data pemeriksaan tidak dapat dihapus karena sedang dalam proses verifikasi Asisten Bibitan atau sudah disetujui.' };
  }

  const deleted = inspections.splice(idx, 1)[0];
  storage.set(DEDERAN_STORAGE_KEYS.INSPECTIONS, inspections);

  // Clean up or recalculate selection pool for this bedengan
  const dederTx = getDederanTransactionById(deleted.dederanTxDocNo);
  if (dederTx) {
    const newSummary = getBedenganInspectionSummary(dederTx);
    let selectionPool = storage.get('selection_pool', []);
    const poolId = `SEL-POOL-DED-${deleted.dederanTxDocNo || deleted.docNo || deleted.id}`;
    
    if (newSummary.totalTidakBerhasil > 0) {
      integrateDederanRejectionToSelectionPool({
        ...deleted,
        jumlahBerhasil: newSummary.totalBerhasil,
        jumlahLayak: newSummary.totalBerhasil,
        jumlahDiperiksa: newSummary.totalDiperiksa
      }, newSummary.totalTidakBerhasil);
    } else {
      selectionPool = selectionPool.filter(s => {
        const isMatch = s.id === poolId || s.dederanDocNo === (deleted.dederanTxDocNo || deleted.docNo);
        if (!isMatch) return true;
        return s.status !== 'PENDING_DECLARATION' || Boolean(s.selectionTransactionId);
      });
      storage.set('selection_pool', selectionPool);
    }
  }

  return { success: true, deleted };
}

/**
 * Updates an existing Dederan Inspection record
 */
export function updateDederanInspection(idOrDocNo, payload) {
  if (!idOrDocNo || !payload) throw new Error('Data update pemeriksaan tidak valid.');

  let inspections = storage.get(DEDERAN_STORAGE_KEYS.INSPECTIONS, []);
  const idx = inspections.findIndex(i => i.id === idOrDocNo || i.docNo === idOrDocNo);
  if (idx < 0) {
    throw new Error('Data pemeriksaan tidak ditemukan untuk diperbarui.');
  }

  const existing = inspections[idx];
  const isReturned = existing.status === 'DIKEMBALIKAN' || existing.verificationStatus === 'DIKEMBALIKAN' || existing.status === 'REVISION';
  if (!isReturned && isTransactionLockedForMantri(existing)) {
    throw new Error('Data pemeriksaan tidak dapat diubah karena sedang dalam proses verifikasi Asisten Bibitan atau sudah disetujui.');
  }

  const dederTx = getDederanTransactionById(existing.dederanTxDocNo);
  if (!dederTx) throw new Error('Transaksi Dederan induk tidak ditemukan.');

  const targetDate = payload.tanggalPemeriksaan || existing.tanggalPemeriksaan || formatDate(new Date().toISOString());
  const jumlahDiperiksa = parseInt(payload.jumlahDiperiksa || 0, 10);
  const jumlahBerhasil = parseInt(payload.jumlahBerhasil || 0, 10);

  const tempInspection = {
    ...existing,
    tanggalPemeriksaan: targetDate,
    jumlahDiperiksa
  };
  const maxAllowed = getInspectionChronologicalMaxAllowed(dederTx, tempInspection);

  if (isNaN(jumlahDiperiksa) || jumlahDiperiksa <= 0) {
    throw new Error('Jumlah Diperiksa harus lebih dari 0.');
  }
  if (jumlahDiperiksa > maxAllowed) {
    throw new Error(`Jumlah Diperiksa (${jumlahDiperiksa.toLocaleString('id-ID')}) melebihi batas maksimal kronologis (${maxAllowed.toLocaleString('id-ID')}).`);
  }
  if (isNaN(jumlahBerhasil) || jumlahBerhasil < 0) {
    throw new Error('Jumlah Berhasil tidak boleh bernilai negatif.');
  }
  if (jumlahBerhasil > jumlahDiperiksa) {
    throw new Error('Jumlah Berhasil tidak boleh melebihi Jumlah Diperiksa.');
  }

  const jumlahTidakBerhasil = jumlahDiperiksa - jumlahBerhasil;

  const updatedInspection = {
    ...existing,
    jumlahDiperiksa,
    jumlahBerhasil,
    jumlahTidakBerhasil,
    status: isReturned ? 'MENUNGGU_VERIFIKASI_MANTRI' : existing.status,
    verificationStatus: isReturned ? 'MENUNGGU_VERIFIKASI_MANTRI' : existing.verificationStatus,
    isCorrected: isReturned ? true : Boolean(existing.isCorrected),
    correctedAt: isReturned ? new Date().toISOString() : (existing.correctedAt || null),
    lastReturnReason: existing.returnReason || existing.lastReturnReason || null,
    returnReason: isReturned ? null : (existing.returnReason || null),
    photos: Array.isArray(payload.photos) ? payload.photos : existing.photos,
    inspectorName: payload.inspectorName || existing.inspectorName || 'Mantri Pembibitan',
    updatedAt: new Date().toISOString()
  };

  inspections[idx] = updatedInspection;
  storage.set(DEDERAN_STORAGE_KEYS.INSPECTIONS, inspections);

  const newSummary = getBedenganInspectionSummary(dederTx);

  // Update selection pool
  if (newSummary.totalTidakBerhasil > 0) {
    integrateDederanRejectionToSelectionPool({
      ...updatedInspection,
      jumlahBerhasil: newSummary.totalBerhasil,
      jumlahLayak: newSummary.totalBerhasil,
      jumlahDiperiksa: newSummary.totalDiperiksa
    }, newSummary.totalTidakBerhasil);
  } else {
    let selectionPool = storage.get('selection_pool', []);
    const poolId = `SEL-POOL-DED-${updatedInspection.dederanTxDocNo || updatedInspection.docNo || updatedInspection.id}`;
    selectionPool = selectionPool.filter(s => {
      const isMatch = s.id === poolId || s.dederanDocNo === (updatedInspection.dederanTxDocNo || updatedInspection.docNo);
      if (!isMatch) return true;
      return s.status !== 'PENDING_DECLARATION' || Boolean(s.selectionTransactionId);
    });
    storage.set('selection_pool', selectionPool);
  }

  return {
    inspection: updatedInspection,
    summary: newSummary
  };
}

/**
 * Updates an existing Dederan transaction (correction / edit)
 */
export function updateDederanTransaction(idOrDocNo, payload) {
  if (!idOrDocNo || !payload) throw new Error('Data transaksi tidak valid.');
  let txs = storage.get(DEDERAN_STORAGE_KEYS.TRANSACTIONS, []);
  const idx = txs.findIndex(t => t.id === idOrDocNo || t.docNo === idOrDocNo);
  if (idx < 0) throw new Error('Transaksi Dederan tidak ditemukan.');

  const existing = txs[idx];
  const userCtx = getCurrentUserContext();

  if (!canUserAccessTransaction(existing, userCtx)) {
    throw new Error('Anda tidak memiliki otorisasi untuk mengubah transaksi Dederan ini.');
  }

  if (isTransactionLockedForMantri(existing)) {
    throw new Error('Transaksi Dederan tidak dapat diubah karena sedang dalam proses verifikasi Asisten Bibitan atau sudah disetujui.');
  }

  const parent = getDederanIndukById(existing.parentDederIndukDocNo);
  if (!parent) throw new Error('Dokumen Induk Deder tidak ditemukan.');

  const inspections = getDederanInspectionsByDederTx(existing.docNo);
  const totalDiperiksa = inspections.reduce((sum, ins) => sum + parseInt(ins.jumlahDiperiksa || 0, 10), 0);

  const maxAllowed = (parent.sisaBelumDeder || 0) + parseInt(existing.jumlahDeder || 0, 10);
  const newJumlah = parseInt(payload.jumlahDeder !== undefined ? payload.jumlahDeder : existing.jumlahDeder, 10);
  if (isNaN(newJumlah) || newJumlah <= 0) {
    throw new Error('Jumlah di deder harus lebih dari 0.');
  }
  if (newJumlah > maxAllowed) {
    throw new Error(`Jumlah di deder (${newJumlah.toLocaleString('id-ID')}) melebihi kuota sisa (${maxAllowed.toLocaleString('id-ID')}).`);
  }

  // AC-03 & AC-04 (Option B): Guard batas keras konsumsi fisik final (Pindah Semai + Seleksi Pra-Semai)
  const sourceGuard = validateSourceEditability('DEDERAN', existing.docNo, payload);
  if (!sourceGuard.allowed) {
    throw new Error(sourceGuard.reason || 'Koreksi kuantitas Dederan melanggar batas konsumsi fisik final yang telah disetujui.');
  }

  let updatedRecord = {
    ...existing,
    jumlahDeder: newJumlah,
    photos: Array.isArray(payload.photos) ? payload.photos : existing.photos,
    status: 'READY_TO_CONFIRM',
    verificationStatus: null,
    submissionStatus: null,
    submittedAt: null,
    lastReturnReason: existing.returnReason || existing.lastReturnReason || null,
    returnReason: null,
    updatedAt: new Date().toISOString()
  };

  updatedRecord = applyTransactionActor(updatedRecord, 'UPDATE', userCtx);

  txs[idx] = updatedRecord;
  storage.set(DEDERAN_STORAGE_KEYS.TRANSACTIONS, txs);
  syncDederanIndukDocuments();
  return updatedRecord;
}

