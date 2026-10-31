/**
 * Penerapan BA Rekonsiliasi Stok Fisik ke Inventory Ledger.
 * Approval bisnis selesai di Pengurus; service ini hanya menjalankan transaksi
 * yang sudah disahkan melalui Central Hub secara idempoten dan fail-closed.
 */

import { storage } from '../../core/storage.js';
import { normalizeRole, ROLES } from '../../core/user-context.js';
import {
  applyPhysicalStockReconciliation as applyInventoryReconciliation,
  executeStockMutationWithLock
} from '../../core/batch-inventory-service.js';
import { assertBatchNotLocked, assertBedenganNotLocked } from '../../core/dependency-guard.js';
import {
  BAPSB_STATUS,
  PHYSICAL_STOCK_BAPSB_KEY
} from './physical-stock-bapsb-service.js';
import {
  PHYSICAL_STOCK_STORAGE_KEY,
  createApprovedPhysicalStockCullFromReconciliation,
  getPhysicalStockLedgerFingerprint
} from './physical-stock-inspection-manager.js';

export const PHYSICAL_STOCK_RECONCILIATION_REFERENCE_TYPE = 'PHYSICAL_STOCK_RECONCILIATION';
export const PHYSICAL_STOCK_RECONCILIATION_INTENT_KEY = 'physical_stock_reconciliation_intents';

function assertAsb(user) {
  if (!user || normalizeRole(user.role || user.rawRole) !== ROLES.ASISTEN_BIBITAN) {
    throw new Error('Hanya Asisten Bibitan yang dapat menerapkan rekonsiliasi melalui Central Hub.');
  }
}

function loadDocument(documentId) {
  const documents = storage.get(PHYSICAL_STOCK_BAPSB_KEY, []);
  const index = documents.findIndex(item => item.id === documentId || item.docNo === documentId);
  return { documents, index, document: index >= 0 ? documents[index] : null };
}

export function validatePhysicalStockReconciliation(documentId) {
  const { document } = loadDocument(documentId);
  const errors = [];
  if (!document) return { canApply: false, errors: ['BA Rekonsiliasi tidak ditemukan.'], document: null };
  if (document.documentType !== PHYSICAL_STOCK_RECONCILIATION_REFERENCE_TYPE) {
    errors.push('Dokumen bukan BA Rekonsiliasi Stok Fisik.');
  }
  if (![BAPSB_STATUS.FINAL_PENDING_APPLICATION, BAPSB_STATUS.APPLICATION_PROCESSING, BAPSB_STATUS.APPLICATION_BLOCKED, BAPSB_STATUS.APPLIED].includes(document.status)) {
    errors.push('BA belum disahkan secara lengkap oleh Askep dan Pengurus.');
  }
  if (!document.signatures?.asb?.signed || !document.signatures?.askep?.signed || !document.signatures?.pengurus?.signed) {
    errors.push('Tanda tangan ASB, Askep, dan Pengurus belum lengkap.');
  }
  const lines = Array.isArray(document.reconciliationLines) ? document.reconciliationLines : [];
  if (!lines.length) errors.push('Rincian rekonsiliasi per Bedengan tidak tersedia.');
  if (lines.some(line => !['SURPLUS', 'SHORTAGE'].includes(String(line.direction || '').toUpperCase()))) {
    errors.push('Arah rekonsiliasi per Bedengan tidak valid.');
  }
  if (lines.some(line => !Number.isInteger(Number(line.quantity || 0)) || Number(line.quantity || 0) <= 0)) {
    errors.push('Kuantitas rekonsiliasi per Bedengan tidak valid.');
  }
  if (lines.some(line => !String(line.reason || '').trim())) {
    errors.push('Alasan selisih wajib lengkap untuk setiap Bedengan.');
  }
  if (lines.some(line => line.referenceStatus && line.referenceStatus !== 'VALID')) {
    errors.push('Terdapat Bedengan dengan referensi yang belum valid.');
  }
  const inspections = storage.get(PHYSICAL_STOCK_STORAGE_KEY, []);
  const inspection = inspections.find(item => item.id === document.inspectionId);
  if (!inspection) {
    errors.push('Pemeriksaan stok fisik sumber tidak ditemukan.');
  } else {
    if (inspection.differenceProfile === 'UNRESOLVED') errors.push('Hasil pemeriksaan masih berstatus unresolved.');
    if (inspection.reconciliationSnapshot?.reconciliationStatus !== 'EXACT_MATCH') {
      errors.push('Rekonsiliasi saldo Batch dan referensi Bedengan belum exact match.');
    }
    const currentFingerprint = getPhysicalStockLedgerFingerprint(inspection.batchId);
    const journal = storage.get('batch_inventory_journal', []);
    const allLinesAlreadyJournaled = lines.length > 0 && lines.every(line => {
      const expectedKey = `MUT-${inspection.batchId}-PSR-${document.id}-${line.lineId}`;
      return journal.some(entry => entry.idempotencyKey === expectedKey);
    });
    if (!currentFingerprint || (currentFingerprint !== document.ledgerFingerprintAtInspection && !allLinesAlreadyJournaled)) {
      errors.push('Saldo atau jurnal Batch berubah setelah pemeriksaan. Pemeriksaan ulang diperlukan.');
    }
  }
  return { canApply: errors.length === 0, errors, document, inspection };
}

export async function applyApprovedPhysicalStockReconciliation(documentId, currentUser) {
  assertAsb(currentUser);
  let loaded = loadDocument(documentId);
  if (!loaded.document) throw new Error('BA Rekonsiliasi tidak ditemukan.');
  if (currentUser.estateId && loaded.document.estateId && String(currentUser.estateId) !== String(loaded.document.estateId)) {
    throw new Error('BA Rekonsiliasi berada di luar lingkup estate pengguna.');
  }
  if (currentUser.divisionId && loaded.document.divisionId && String(currentUser.divisionId) !== String(loaded.document.divisionId)) {
    throw new Error('BA Rekonsiliasi berada di luar lingkup divisi pengguna.');
  }
  if (loaded.document.status === BAPSB_STATUS.APPLIED && loaded.document.applicationStatus === 'APPLIED') {
    return { document: { ...loaded.document }, idempotentSkipped: true };
  }

  const validation = validatePhysicalStockReconciliation(documentId);
  if (!validation.canApply) throw new Error(validation.errors.join(' '));
  const document = loaded.document;
  const inspection = validation.inspection;
  const now = new Date().toISOString();
  const actorId = currentUser.userId || currentUser.code || currentUser.id;
  const intents = storage.get(PHYSICAL_STOCK_RECONCILIATION_INTENT_KEY, []);
  let intent = intents.find(item => item.reconciliationId === document.id);
  if (!intent) {
    intent = {
      id: `PSR-INTENT-${document.id}`,
      reconciliationId: document.id,
      reconciliationDocNo: document.docNo,
      inspectionId: inspection.id,
      batchId: inspection.batchId,
      status: 'IN_FLIGHT',
      createdAt: now,
      updatedAt: now,
      createdBy: actorId
    };
    intents.push(intent);
  } else {
    intent.status = 'IN_FLIGHT';
    intent.errorReason = null;
    intent.updatedAt = now;
  }
  storage.set(PHYSICAL_STOCK_RECONCILIATION_INTENT_KEY, intents);

  document.status = BAPSB_STATUS.APPLICATION_PROCESSING;
  document.applicationStatus = 'PROCESSING';
  document.applicationIntentId = intent.id;
  document.applicationError = null;
  document.updatedAt = now;
  loaded.documents[loaded.index] = document;
  storage.set(PHYSICAL_STOCK_BAPSB_KEY, loaded.documents);

  try {
    const result = await executeStockMutationWithLock(inspection.batchId, async () => {
      assertBatchNotLocked(inspection.batchId);
      for (const line of document.reconciliationLines) {
        if (line.bedenganId) assertBedenganNotLocked(inspection.batchId, line.bedenganId);
      }
      return applyInventoryReconciliation(
        inspection.batchId,
        document.reconciliationLines,
        {
          id: document.id,
          reconciliationId: document.id,
          docNo: document.docNo,
          inspectionId: inspection.id
        },
        currentUser
      );
    });

    const journalEntries = Array.isArray(result?.journalEntries) ? result.journalEntries : [];
    document.reconciliationLines = document.reconciliationLines.map(line => {
      const journal = journalEntries.find(entry => entry.lineId === line.lineId);
      return { ...line, inventoryJournalId: journal?.id || line.inventoryJournalId || null };
    });
    document.inventoryJournalIds = [...new Set(journalEntries.map(entry => entry.id).filter(Boolean))];
    document.applicationStatus = 'APPLIED';
    document.appliedAt = new Date().toISOString();
    document.appliedBy = actorId;
    document.appliedByName = currentUser.name || 'Asisten Bibitan';
    document.applicationError = null;

    const selection = createApprovedPhysicalStockCullFromReconciliation(
      inspection.id,
      document,
      currentUser,
      journalEntries
    );
    document.selectionTransactionId = selection?.id || null;
    document.selectionDocNo = selection?.docNo || null;
    document.status = BAPSB_STATUS.APPLIED;
    document.updatedAt = new Date().toISOString();

    loaded = loadDocument(document.id);
    loaded.documents[loaded.index] = document;
    storage.set(PHYSICAL_STOCK_BAPSB_KEY, loaded.documents);

    const inspections = storage.get(PHYSICAL_STOCK_STORAGE_KEY, []);
    const inspectionIndex = inspections.findIndex(item => item.id === inspection.id);
    if (inspectionIndex >= 0) {
      inspections[inspectionIndex].bapsbStatus = BAPSB_STATUS.APPLIED;
      inspections[inspectionIndex].reconciliationApplicationStatus = 'APPLIED';
      inspections[inspectionIndex].inventoryJournalIds = document.inventoryJournalIds;
      inspections[inspectionIndex].stockMutationStatus = 'APPLIED';
      inspections[inspectionIndex].isCompleted = true;
      inspections[inspectionIndex].completedReconciliationAt = document.appliedAt;
      storage.set(PHYSICAL_STOCK_STORAGE_KEY, inspections);
    }

    intent.status = 'COMPLETED';
    intent.inventoryJournalIds = document.inventoryJournalIds;
    intent.selectionTransactionId = selection?.id || null;
    intent.updatedAt = new Date().toISOString();
    storage.set(PHYSICAL_STOCK_RECONCILIATION_INTENT_KEY, intents);

    const verifications = storage.get('verification_transactions', []);
    const verification = verifications.find(item =>
      item.referenceType === PHYSICAL_STOCK_RECONCILIATION_REFERENCE_TYPE && item.referenceId === document.id
    );
    if (verification) {
      verification.verificationStatus = 'TERVERIFIKASI';
      verification.verifiedByUserId = actorId;
      verification.verifiedByName = currentUser.name || 'Asisten Bibitan';
      verification.verifiedByRole = currentUser.role || ROLES.ASISTEN_BIBITAN;
      verification.verifiedAt = document.appliedAt;
      verification.notes = 'Rekonsiliasi telah diterapkan ke Inventory Ledger.';
      verification.updatedAt = document.appliedAt;
      storage.set('verification_transactions', verifications);
    }
    return { document: { ...document }, selectionTransaction: selection, inventoryResult: result };
  } catch (error) {
    const failed = loadDocument(document.id);
    if (failed.document) {
      failed.document.status = BAPSB_STATUS.APPLICATION_BLOCKED;
      failed.document.applicationStatus = 'BLOCKED';
      failed.document.applicationError = error.message || 'Penerapan rekonsiliasi gagal.';
      failed.document.updatedAt = new Date().toISOString();
      failed.documents[failed.index] = failed.document;
      storage.set(PHYSICAL_STOCK_BAPSB_KEY, failed.documents);
    }
    intent.status = 'HALTED_RETRY_REQUIRED';
    intent.errorReason = error.message || 'Penerapan rekonsiliasi gagal.';
    intent.updatedAt = new Date().toISOString();
    storage.set(PHYSICAL_STOCK_RECONCILIATION_INTENT_KEY, intents);
    throw error;
  }
}

