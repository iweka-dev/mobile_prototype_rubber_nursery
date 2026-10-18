/**
 * js/modules/destruction/destruction-manager.js
 * Manager, Business Logic, & Resolver for Pemusnahan Bibit (TASK ASB-10)
 * 
 * Prinsip:
 * - Dikelola oleh Role ASISTEN_BIBITAN (Pemeriksaan, Setujui, Kembalikan)
 * - Diajukan oleh MANTRI_TANAMAN (Pengajuan Pemusnahan)
 * - SANGAT PENTING: ZERO STOCK MUTATION pada ASB-10 (Mutasi stok ditunda ke ASB-14)
 * - Single Source of Truth: storage key 'destruction_transactions'
 * - Traceability: Pemusnahan -> Batch -> Bedengan -> Program -> Estate -> Divisi
 */

import { storage } from '../../core/storage.js';
import { normalizeRole, ROLES } from '../../core/user-context.js';
import { getBatchById, getBatchByCode } from '../../data/batch-master.js';
import { getBedenganById } from '../../data/bedengan-master.js';
import { getProgramById } from '../../data/program-master.js';
import { getEstateById, resolveNurseryDivision } from '../../data/estate-master.js';
import { 
  formatStandardDocNo, 
  formatDate,
  getOfficialBusinessTimeWIB,
  resolveBapbEstateDisplayCode,
  resolveBapbDivisionDisplayCode,
  formatBapbOfficialDocNo,
  parseStrictCanonicalQuantity
} from '../../core/utils.js';
import { applyTransactionActor, canUserAccessTransaction, AUDIT_EVENT_TYPES } from '../../core/transaction-actor.js';
import { 
  deductBatchStock as deductInventoryStock, 
  getAvailableQty as getInventoryAvailableQty, 
  executeStockMutationWithLock,
  INVENTORY_TX_TYPE 
} from '../../core/batch-inventory-service.js';
import { getBatchContext } from '../../core/master-context-service.js';

export const APPROVAL_MODE = Object.freeze({
  SEQUENTIAL: 'SEQUENTIAL',
  DIRECT_ON_SITE: 'DIRECT_ON_SITE'
});

export const BAPB_STATUS = Object.freeze({
  DRAFT_AWAITING_ASKEP: 'DRAFT_AWAITING_ASKEP',
  DRAFT_AWAITING_PENGURUS: 'DRAFT_AWAITING_PENGURUS',
  FINAL: 'FINAL',
  DIKEMBALIKAN_KE_ASB: 'DIKEMBALIKAN_KE_ASB',
  DIBATALKAN: 'DIBATALKAN'
});

export const DESTRUCTION_STATUS = Object.freeze({
  MENUNGGU_VERIFIKASI: 'MENUNGGU_VERIFIKASI_ASISTEN_BIBITAN',
  DISETUJUI: 'DISETUJUI',
  DIKEMBALIKAN: 'DIKEMBALIKAN'
});

export const STOCK_MUTATION_STATUS = Object.freeze({
  PENDING: 'PENDING',
  APPLIED: 'APPLIED',
  FAILED: 'FAILED',
  ALREADY_APPLIED: 'ALREADY_APPLIED'
});

export const DESTRUCTION_REASONS = Object.freeze([
  'Bibit mati',
  'Bibit sakit / Hama & Penyakit',
  'Kerusakan fisik / Abnormal',
  'Tidak memenuhi standar mutu',
  'Lainnya'
]);

export const DESTRUCTION_STORAGE_KEY = 'destruction_transactions';

/**
 * Validasi otorisasi Asisten Bibitan untuk memeriksa pengajuan pemusnahan
 */
export function canPerformAsistenDestructionAction(item, currentUser) {
  if (!item || !currentUser) return false;
  const role = normalizeRole(currentUser.role || currentUser.rawRole);
  if (role !== ROLES.ASISTEN_BIBITAN) return false;

  // Scope: Estate match
  if (currentUser.estateId && item.estateId && currentUser.estateId !== item.estateId) {
    return false;
  }

  // Scope: Division match if present on user
  if (currentUser.divisionId && item.divisionId && currentUser.divisionId !== item.divisionId) {
    return false;
  }

  const s = (item.status || '').toUpperCase();
  return (
    s === DESTRUCTION_STATUS.MENUNGGU_VERIFIKASI ||
    s === 'DIAJUKAN' ||
    s === 'PENDING'
  );
}

/**
 * Filter daftar pemusnahan sesuai scope pengguna
 */
export function filterDestructionByScope(records, currentUser) {
  if (!Array.isArray(records) || !currentUser) return [];
  return records.filter(item => {
    return canUserAccessTransaction(item, currentUser, 'READ');
  });
}

/**
 * Hitung jumlah transaksi pemusnahan yang memerlukan tindakan (ASB, Askep, Pengurus)
 */
export function getActionableDestructionCount(records = null, currentUser) {
  if (!currentUser) return 0;
  const list = records !== null ? records : storage.get(DESTRUCTION_STORAGE_KEY, []);
  if (!Array.isArray(list)) return 0;

  const role = normalizeRole(currentUser.role || currentUser.rawRole);

  if (role === ROLES.ASISTEN_KEPALA || role === 'ASKEP') {
    return list.filter(item => {
      if (currentUser.estateId && item.estateId && currentUser.estateId !== item.estateId) return false;
      const s = (item.bapbStatus || item.status || '').toUpperCase();
      return s === BAPB_STATUS.DRAFT_AWAITING_ASKEP;
    }).length;
  }

  if (role === ROLES.PENGURUS) {
    return list.filter(item => {
      if (currentUser.estateId && item.estateId && currentUser.estateId !== item.estateId) return false;
      const s = (item.bapbStatus || item.status || '').toUpperCase();
      return s === BAPB_STATUS.DRAFT_AWAITING_PENGURUS;
    }).length;
  }

  return list.filter(item => {
    if (canPerformAsistenDestructionAction(item, currentUser)) return true;
    if (role === ROLES.ASISTEN_BIBITAN) {
      if (currentUser.estateId && item.estateId && currentUser.estateId !== item.estateId) return false;
      const s = (item.bapbStatus || item.status || '').toUpperCase();
      return s === BAPB_STATUS.DIKEMBALIKAN_KE_ASB;
    }
    return false;
  }).length;
}

/**
 * Validasi form pengajuan pemusnahan bibit
 */
export function validateDestructionData(payload) {
  const errors = [];
  if (!payload) {
    return { isValid: false, errors: ['Data pengajuan pemusnahan tidak boleh kosong.'] };
  }

  const qty = parseInt(payload.quantity || payload.destructionQty || 0, 10);
  if (isNaN(qty) || qty <= 0) {
    errors.push('Jumlah bibit yang dimusnahkan harus lebih besar dari 0.');
  }

  // Reason validation
  const reason = (payload.reason || payload.alasan || '').trim();
  if (!reason) {
    errors.push('Alasan pemusnahan wajib dipilih.');
  }

  const description = (payload.description || payload.catatan || '').trim();
  if (reason.toLowerCase() === 'lainnya' && !description) {
    errors.push('Catatan/keterangan rinci wajib diisi jika memilih alasan Lainnya.');
  }

  // Batch validation
  const batchCodeOrId = payload.batchId || payload.batchCode || payload.batchNo;
  if (!batchCodeOrId) {
    errors.push('Batch sumber bibit wajib dipilih.');
  }

  const bObj = payload.batchId ? getBatchById(payload.batchId) : getBatchByCode(batchCodeOrId);
  if (bObj) {
    if (bObj.status === 'INACTIVE') {
      errors.push(`Batch ${bObj.batchCode || bObj.batchNo} dalam status INACTIVE (nonaktif) dan tidak dapat dimusnahkan.`);
    }
    if ((bObj.availableQty || 0) === 0 || bObj.status === 'EMPTY') {
      errors.push(`Stok batch ${bObj.batchCode || bObj.batchNo} sudah habis (0 Pkk).`);
    } else if (qty > (bObj.availableQty || 0)) {
      errors.push(`Jumlah pemusnahan (${qty.toLocaleString('id-ID')} Pkk) melebihi stok tersedia pada batch (${(bObj.availableQty || 0).toLocaleString('id-ID')} Pkk).`);
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    quantity: qty,
    reason,
    description,
    batchObj: bObj || null
  };
}

/**
 * Membuat transaksi pengajuan pemusnahan baru (oleh Mantri Bibitan)
 */
export function createDestructionRecord(payload, currentUser) {
  const val = validateDestructionData(payload);
  if (!val.isValid) {
    throw new Error(val.errors.join(' '));
  }

  const allRecords = getVerifiedDestructionCollection();
  const docNo = payload.docNo || payload.destructionNo || formatStandardDocNo(2026, 'DST', allRecords.length + 1);

  const bObj = val.batchObj || (payload.batchId ? getBatchById(payload.batchId) : getBatchByCode(payload.batchCode || payload.batchNo));
  const batchId = bObj ? bObj.id : (payload.batchId || `BATCH-${Date.now()}`);
  const batchCode = bObj ? (bObj.batchCode || bObj.batchNo) : (payload.batchCode || payload.batchNo || 'B-001');

  const bedenganIds = payload.bedenganIds || (payload.bedenganId ? [payload.bedenganId] : (bObj?.bedenganIds || []));

  const destructionId = `DST-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const newRecord = applyTransactionActor(
    {
      id: destructionId,
      destructionId: destructionId,
      docNo: docNo,
      destructionNo: docNo,
      transactionType: 'PEMUSNAHAN_BIBIT',
      
      batchId: batchId,
      batchCode: batchCode,
      
      estateId: payload.estateId || bObj?.estateId || currentUser.estateId,
      estateName: payload.estateName || bObj?.estateName || currentUser.estateName || '-',
      divisionId: payload.divisionId || bObj?.divisionId || currentUser.divisionId,
      divisionName: payload.divisionName || bObj?.divisionName || currentUser.divisionName || '-',
      
      programId: payload.programId || bObj?.programId || 'PRG-2026-001',
      programName: payload.programName || bObj?.programName || '-',
      
      cloneId: payload.cloneId || payload.clone || payload.klon || bObj?.clone || 'IRCA 19',
      clone: payload.clone || payload.klon || bObj?.clone || 'IRCA 19',
      klon: payload.clone || payload.klon || bObj?.clone || 'IRCA 19',
      growthStage: payload.growthStage || payload.stage || bObj?.growthStage || 'Rubber Advance Planting Material',
      category: payload.category || bObj?.category || 'Polibag Besar',
      
      bedenganIds: bedenganIds,
      bedenganId: bedenganIds.length > 0 ? bedenganIds[0] : (payload.bedenganId || null),
      bedengan: payload.bedengan || (bedenganIds.length > 0 ? bedenganIds.join(', ') : '-'),
      
      quantity: val.quantity,
      destructionQty: val.quantity,
      reason: val.reason,
      alasan: val.reason,
      description: val.description || '-',
      catatan: val.description || '-',
      
      sourceSelectionId: payload.sourceSelectionId || null,
      sourceSelectionNo: payload.sourceSelectionNo || null,
      photoEvidence: payload.photoEvidence || null,
      
      tanggalPemusnahan: payload.tanggalPemusnahan || payload.destructionDate || payload.date || formatDate(new Date().toISOString()),
      date: payload.tanggalPemusnahan || payload.destructionDate || payload.date || formatDate(new Date().toISOString()),
      
      status: DESTRUCTION_STATUS.MENUNGGU_VERIFIKASI,
      
      createdByUserId: currentUser.userId || currentUser.code || currentUser.id,
      createdByName: currentUser.name || 'Mantri Bibitan',
      createdByRole: currentUser.role || 'MANTRI_TANAMAN',
      createdAt: new Date().toISOString()
    },
    AUDIT_EVENT_TYPES.CREATE,
    currentUser,
    `Pengajuan pemusnahan ${val.quantity.toLocaleString('id-ID')} Pkk batch ${batchCode} (Alasan: ${val.reason})`
  );

  allRecords.push(newRecord);
  storage.set(DESTRUCTION_STORAGE_KEY, allRecords);
  return newRecord;
}

/**
 * Approve Pemusnahan Bibit oleh Asisten Bibitan
 */
export async function approveDestructionRecord(recordIdOrDocNo, notes = '', currentUser, autoMutateStock = false) {
  if (!currentUser) throw new Error('Pengguna aktif tidak valid.');
  const role = normalizeRole(currentUser.role || currentUser.rawRole);
  if (role !== ROLES.ASISTEN_BIBITAN) {
    throw new Error('Hanya Asisten Bibitan yang berhak menyetujui pengajuan pemusnahan bibit.');
  }

  const allRecords = getVerifiedDestructionCollection();
  const idx = allRecords.findIndex(r => r.id === recordIdOrDocNo || r.destructionId === recordIdOrDocNo || r.docNo === recordIdOrDocNo || r.destructionNo === recordIdOrDocNo);
  if (idx === -1) {
    throw new Error(`Dokumen pemusnahan dengan identitas ${recordIdOrDocNo} tidak ditemukan.`);
  }

  const target = allRecords[idx];
  checkImmutableFinalBapb(target);
  if (!canPerformAsistenDestructionAction(target, currentUser)) {
    throw new Error('Anda tidak memiliki otorisasi untuk menyetujui dokumen pemusnahan ini.');
  }

  const updatedRecord = applyTransactionActor(
    {
      ...target,
      status: DESTRUCTION_STATUS.DISETUJUI,
      approvalNotes: notes || 'Disetujui oleh Asisten Bibitan',
      catatanPersetujuan: notes || 'Disetujui oleh Asisten Bibitan',
      approvedByUserId: currentUser.userId || currentUser.code || currentUser.id,
      approvedByName: currentUser.name || 'Asisten Bibitan',
      approvedByRole: ROLES.ASISTEN_BIBITAN,
      approvedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    },
    AUDIT_EVENT_TYPES.APPROVE,
    currentUser,
    `Persetujuan pemusnahan ${target.quantity || target.destructionQty} Pkk bibit batch ${target.batchCode}`
  );

  allRecords[idx] = updatedRecord;
  storage.set(DESTRUCTION_STORAGE_KEY, allRecords);

  if (autoMutateStock) {
    const mutationResult = await mutateStockFromDestruction(updatedRecord.id, currentUser);
    return mutationResult.destruction;
  }

  return updatedRecord;
}

/**
 * MUTASI STOK PEMUSNAHAN BIBIT (TASK ASB-14)
 * Mengurangi availableQty & currentQty pada nursery_batches berdasarkan destructionQty yang DISETUJUI.
 * Dilindungi Web Locks API (Fail-Closed).
 */
export async function mutateStockFromDestruction(recordIdOrDocNo, currentUser) {
  if (!currentUser) {
    throw new Error('Otorisasi gagal: Pengguna aktif tidak ditemukan.');
  }

  const allRecords = storage.get(DESTRUCTION_STORAGE_KEY, []);
  const idx = allRecords.findIndex(r => r.id === recordIdOrDocNo || r.destructionId === recordIdOrDocNo || r.docNo === recordIdOrDocNo || r.destructionNo === recordIdOrDocNo);
  if (idx === -1) {
    throw new Error(`Dokumen pemusnahan dengan identitas ${recordIdOrDocNo} tidak ditemukan.`);
  }

  const initialTarget = allRecords[idx];

  // 1. Validasi Status Pemusnahan: Hanya DISETUJUI yang boleh memutasi stok
  const statusUpper = (initialTarget.status || '').toUpperCase();
  if (statusUpper !== DESTRUCTION_STATUS.DISETUJUI) {
    throw new Error(`Hanya pengajuan pemusnahan dengan status DISETUJUI yang dapat melakukan mutasi stok (status saat ini: ${initialTarget.status}).`);
  }

  // 2. Scope Validation
  if (currentUser.estateId && initialTarget.estateId && currentUser.estateId !== initialTarget.estateId) {
    throw new Error(`Akses ditolak: Dokumen berada di luar lingkup estate user (${initialTarget.estateId} vs ${currentUser.estateId}).`);
  }
  if (currentUser.divisionId && initialTarget.divisionId && currentUser.divisionId !== initialTarget.divisionId) {
    throw new Error(`Akses ditolak: Dokumen berada di luar lingkup divisi user (${initialTarget.divisionId} vs ${currentUser.divisionId}).`);
  }

  const batchKey = initialTarget.batchId || initialTarget.batchCode;

  return await executeStockMutationWithLock(batchKey, async () => {
    // Re-fetch under lock to prevent race conditions
    const currentRecords = storage.get(DESTRUCTION_STORAGE_KEY, []);
    const currIdx = currentRecords.findIndex(r => r.id === initialTarget.id || r.destructionId === initialTarget.id || r.docNo === initialTarget.docNo);
    const target = currIdx !== -1 ? currentRecords[currIdx] : initialTarget;

    // 3. Idempotency Check: Jika sudah dimutasi, jangan deduct lagi
    if (target.stockMutationStatus === STOCK_MUTATION_STATUS.APPLIED) {
      return {
        status: STOCK_MUTATION_STATUS.ALREADY_APPLIED,
        success: true,
        message: 'Mutasi stok pemusnahan sudah pernah diterapkan sebelumnya.',
        destruction: target,
        batch: null
      };
    }

    // 4. Formula Quantity: stockMutationQty = destructionQty (wajib > 0)
    const mutationQty = parseInt(target.destructionQty !== undefined ? target.destructionQty : (target.quantity || 0), 10);
    if (isNaN(mutationQty) || mutationQty <= 0) {
      const failedRecord = {
        ...target,
        stockMutationStatus: STOCK_MUTATION_STATUS.FAILED,
        stockMutationError: `Jumlah pemusnahan tidak valid (${mutationQty}).`,
        updatedAt: new Date().toISOString()
      };
      currentRecords[currIdx] = failedRecord;
      storage.set(DESTRUCTION_STORAGE_KEY, currentRecords);
      throw new Error(`Jumlah pemusnahan tidak valid (${mutationQty}).`);
    }

    // 5. Muat nursery_batches & Validasi Batch
    const allBatches = storage.get('nursery_batches', []);
    const bIdx = allBatches.findIndex(b => b.id === target.batchId || b.batchCode === target.batchCode || b.batchNo === target.batchCode);
    
    if (bIdx === -1) {
      const failedRecord = {
        ...target,
        stockMutationStatus: STOCK_MUTATION_STATUS.FAILED,
        stockMutationError: `Batch ${target.batchCode || target.batchId} tidak ditemukan di nursery_batches.`,
        updatedAt: new Date().toISOString()
      };
      currentRecords[currIdx] = failedRecord;
      storage.set(DESTRUCTION_STORAGE_KEY, currentRecords);
      throw new Error(`Batch ${target.batchCode || target.batchId} tidak ditemukan di nursery_batches.`);
    }

    const batchObj = allBatches[bIdx];
    const batchCtx = getBatchContext(batchObj.id || batchObj.batchId || target.batchId || target.batchCode) || batchObj;

    // 6. Validasi Program / Estate / Division Alignment via Context Relation Layer
    if (target.estateId && batchCtx.estateId && target.estateId.toUpperCase() !== batchCtx.estateId.toUpperCase()) {
      const failedRecord = {
        ...target,
        stockMutationStatus: STOCK_MUTATION_STATUS.FAILED,
        stockMutationError: `Inkonsistensi estate: Pemusnahan (${target.estateId}) vs Batch (${batchCtx.estateId})`,
        updatedAt: new Date().toISOString()
      };
      currentRecords[currIdx] = failedRecord;
      storage.set(DESTRUCTION_STORAGE_KEY, currentRecords);
      throw new Error(`Inkonsistensi estate: Pemusnahan (${target.estateId}) vs Batch (${batchCtx.estateId}).`);
    }

    if (target.divisionId && batchCtx.divisionId && target.divisionId.toUpperCase() !== batchCtx.divisionId.toUpperCase()) {
      const failedRecord = {
        ...target,
        stockMutationStatus: STOCK_MUTATION_STATUS.FAILED,
        stockMutationError: `Inkonsistensi divisi: Pemusnahan (${target.divisionId}) vs Batch (${batchCtx.divisionId})`,
        updatedAt: new Date().toISOString()
      };
      currentRecords[currIdx] = failedRecord;
      storage.set(DESTRUCTION_STORAGE_KEY, currentRecords);
      throw new Error(`Inkonsistensi divisi: Pemusnahan (${target.divisionId}) vs Batch (${batchCtx.divisionId}).`);
    }

    // 7. Validasi Kecukupan Stok via Inventory Service (inside lock)
    const currentAvailable = getInventoryAvailableQty(batchObj.id || batchObj.batchCode || batchObj.batchNo);
    if (currentAvailable < mutationQty) {
      const failedRecord = {
        ...target,
        stockMutationStatus: STOCK_MUTATION_STATUS.FAILED,
        stockMutationError: `Stok batch tidak mencukupi: Tersedia ${currentAvailable}, Pemusnahan ${mutationQty}`,
        updatedAt: new Date().toISOString()
      };
      currentRecords[currIdx] = failedRecord;
      storage.set(DESTRUCTION_STORAGE_KEY, currentRecords);
      throw new Error(`Stok batch ${batchObj.batchCode || batchObj.batchNo} tidak mencukupi (Tersedia: ${currentAvailable} < Pemusnahan: ${mutationQty}).`);
    }

    // 8. Atomic Stock Mutation Commit via Inventory Service
    const destIdempotencyKey = `destr:${target.id || target.docNo}`;
    const updatedInvState = deductInventoryStock(
      batchObj.id || batchObj.batchCode || batchObj.batchNo,
      mutationQty,
      INVENTORY_TX_TYPE.DESTRUCTION,
      target.docNo || target.id,
      currentUser,
      `Pengurangan stok pemusnahan ${target.docNo || target.id}`,
      null,
      destIdempotencyKey
    );

    const updatedBatch = {
      ...batchObj,
      availableQty: updatedInvState.availableQty,
      currentQty: updatedInvState.availableQty,
      status: updatedInvState.status,
      updatedAt: updatedInvState.updatedAt
    };

    // 9. Update Transaction Metadata
    const updatedDestruction = {
      ...target,
      stockMutationStatus: STOCK_MUTATION_STATUS.APPLIED,
      stockMutationQty: mutationQty,
      stockMutationAt: new Date().toISOString(),
      stockMutationByUserId: currentUser?.userId || currentUser?.id || 'SYSTEM',
      stockMutationByName: currentUser?.name || currentUser?.fullName || 'Asisten Bibitan',
      stockMutationByRole: currentUser?.role || ROLES.ASISTEN_BIBITAN,
      stockMutationError: null,
      updatedAt: new Date().toISOString()
    };

    currentRecords[currIdx] = updatedDestruction;
    storage.set(DESTRUCTION_STORAGE_KEY, currentRecords);

    return {
      status: STOCK_MUTATION_STATUS.APPLIED,
      success: true,
      batch: updatedBatch,
      destruction: updatedDestruction
    };
  });
}

/**
 * Kembalikan (Return) Pemusnahan Bibit oleh Asisten Bibitan
 * CATATAN PENTING: ZERO STOCK MUTATION
 */
export function returnDestructionRecord(recordIdOrDocNo, reason, currentUser) {
  if (!currentUser) throw new Error('Pengguna aktif tidak valid.');
  const role = normalizeRole(currentUser.role || currentUser.rawRole);
  if (role !== ROLES.ASISTEN_BIBITAN) {
    throw new Error('Hanya Asisten Bibitan yang berhak mengembalikan pengajuan pemusnahan.');
  }

  if (!reason || !reason.trim()) {
    throw new Error('Alasan pengembalian pengajuan pemusnahan wajib diisi.');
  }

  const allRecords = getVerifiedDestructionCollection();
  const idx = allRecords.findIndex(r => r.id === recordIdOrDocNo || r.destructionId === recordIdOrDocNo || r.docNo === recordIdOrDocNo || r.destructionNo === recordIdOrDocNo);
  if (idx === -1) {
    throw new Error(`Dokumen pemusnahan dengan identitas ${recordIdOrDocNo} tidak ditemukan.`);
  }

  const target = allRecords[idx];
  checkImmutableFinalBapb(target);
  if (!canPerformAsistenDestructionAction(target, currentUser)) {
    throw new Error('Anda tidak memiliki otorisasi untuk mengembalikan dokumen pemusnahan ini.');
  }

  const updatedRecord = applyTransactionActor(
    {
      ...target,
      status: DESTRUCTION_STATUS.DIKEMBALIKAN,
      returnReason: reason.trim(),
      alasanPengembalian: reason.trim(),
      returnedByUserId: currentUser.userId || currentUser.code || currentUser.id,
      returnedByName: currentUser.name || 'Asisten Bibitan',
      returnedByRole: ROLES.ASISTEN_BIBITAN,
      returnedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    },
    AUDIT_EVENT_TYPES.REJECT,
    currentUser,
    `Pengembalian pengajuan pemusnahan batch ${target.batchCode}: ${reason.trim()}`
  );

  allRecords[idx] = updatedRecord;
  storage.set(DESTRUCTION_STORAGE_KEY, allRecords);

  return updatedRecord;
}

/**
 * Akses koleksi destruction_transactions dengan proteksi fail-closed.
 * Menolak storage tidak valid (jika bukan array dan bukan null/empty) demi mencegah korupsi atau reset storage.
 */
export function getVerifiedDestructionCollection() {
  const raw = storage.get(DESTRUCTION_STORAGE_KEY, null);
  if (raw !== null && !Array.isArray(raw)) {
    throw new Error('CRITICAL_STORAGE_INTEGRITY_ERROR: Koleksi destruction_transactions bukan array valid. Operasi dihentikan demi keamanan data.');
  }
  return Array.isArray(raw) ? raw : [];
}

/**
 * Validasi kekekalan dokumen BAPB FINAL
 */
export function checkImmutableFinalBapb(record) {
  if (!record) return;
  const s = String(record.bapbStatus || record.status || '').toUpperCase();
  if (s === BAPB_STATUS.FINAL || record.isFinal === true) {
    throw new Error('Dokumen BAPB yang sudah berstatus FINAL bersifat kekal (immutable) dan tidak boleh diedit, dihapus, dibatalkan, atau difinalisasi ulang.');
  }
}

/**
 * Alokasi nomor resmi BAPB: [KODE_KEBUN]/[KODE_DIVISI]/[BULAN]/[TAHUN]/[NOMOR_URUT]
 * Reset nomor urut bulanan berdasarkan kebun, divisi, bulan, dan tahun (WIB).
 * Hanya dialokasikan pada proses pengesahan FINAL.
 */
export function allocateNextBapbDocNo(estateDisplayCode, divisionDisplayCode, month, year, existingRecords = []) {
  const monthStr = String(month).padStart(2, '0');
  const prefix = `${estateDisplayCode}/${divisionDisplayCode}/${monthStr}/${year}/`;
  let maxSeq = 0;

  if (Array.isArray(existingRecords)) {
    for (const rec of existingRecords) {
      if (!rec) continue;
      const docNo = String(rec.officialDocNo || rec.docNo || rec.bapbNo || '').trim();
      if (docNo.startsWith(prefix)) {
        const seqPart = docNo.slice(prefix.length).trim();
        const parsedSeq = parseInt(seqPart, 10);
        if (!isNaN(parsedSeq) && parsedSeq > maxSeq) {
          maxSeq = parsedSeq;
        }
      }
    }
  }

  const nextSeq = maxSeq + 1;
  return formatBapbOfficialDocNo(estateDisplayCode, divisionDisplayCode, monthStr, year, nextSeq);
}

/**
 * Mengambil daftar dokumen seleksi yang telah disetujui ASB dan eligible untuk diterbitkan BAPB.
 */
export function getEligibleSelectionDocsForBapb(currentUser = null) {
  const selTxs = storage.get('selection_transactions', []);
  const destructionList = getVerifiedDestructionCollection();

  // Kumpulkan dokumen seleksi yang sedang diproses di BAPB aktif atau sudah FINAL
  const activeBapbSourceIds = new Set();
  for (const d of destructionList) {
    if (!d) continue;
    const st = String(d.bapbStatus || d.status || '').toUpperCase();
    if (st === BAPB_STATUS.DRAFT_AWAITING_ASKEP || st === BAPB_STATUS.DRAFT_AWAITING_PENGURUS || st === BAPB_STATUS.FINAL || d.isFinal === true) {
      if (d.sourceSelectionId) activeBapbSourceIds.add(String(d.sourceSelectionId));
      if (d.sourceSelectionNo) activeBapbSourceIds.add(String(d.sourceSelectionNo));
      if (Array.isArray(d.items)) {
        d.items.forEach(it => {
          if (it.sourceSelectionId) activeBapbSourceIds.add(String(it.sourceSelectionId));
          if (it.sourceSelectionNo) activeBapbSourceIds.add(String(it.sourceSelectionNo));
        });
      }
    }
  }

  const eligible = [];
  if (Array.isArray(selTxs)) {
    for (const tx of selTxs) {
      if (!tx) continue;
      const st = String(tx.status || '').toUpperCase();
      const isApproved = st === 'DISETUJUI' || st === 'APPROVED' || st === 'VERIFIED' || st === 'TERVERIFIKASI' || tx.isApproved === true || tx.isFinal === true;
      if (!isApproved) continue;

      let qty = 0;
      try {
        qty = parseStrictCanonicalQuantity(
          tx.jumlahAfkirTotal !== undefined ? tx.jumlahAfkirTotal : (tx.jumlahAfkir !== undefined ? tx.jumlahAfkir : (tx.quantity !== undefined ? tx.quantity : tx.qty)),
          'Kuantitas Afkir Seleksi'
        );
      } catch (e) {
        continue;
      }
      if (qty <= 0) continue;

      const txId = String(tx.id || tx.txId || tx.docNo || '');
      const txNo = String(tx.docNo || tx.selectionNo || '');
      if (activeBapbSourceIds.has(txId) || activeBapbSourceIds.has(txNo)) continue;

      if (currentUser && currentUser.estateId && tx.estateId && currentUser.estateId !== tx.estateId) {
        continue;
      }

      eligible.push({
        ...tx,
        calculatedAfkirQty: qty
      });
    }
  }
  return eligible;
}

/**
 * Validasi goresan tanda tangan visual pada kanvas HP
 */
export function validateVisualSignature(dataUrl, roleTitle = 'Pejabat') {
  if (!dataUrl || typeof dataUrl !== 'string') {
    throw new Error(`Tanda tangan ${roleTitle} wajib dibubuhkan.`);
  }
  if (!dataUrl.startsWith('data:image/')) {
    throw new Error(`Format tanda tangan ${roleTitle} tidak valid.`);
  }
  if (dataUrl.length < 500) {
    throw new Error(`Goresan tanda tangan ${roleTitle} terlalu sedikit atau kosong. Harap tanda tangani layar dengan jelas.`);
  }
  return true;
}

/**
 * Validasi bukti foto pemusnahan (minimal 1, maksimal 2)
 */
export function validatePhotoEvidences(photos) {
  if (!Array.isArray(photos) || photos.length < 1) {
    throw new Error('Bukti foto pemusnahan wajib dilampirkan minimal 1 foto.');
  }
  if (photos.length > 2) {
    throw new Error('Bukti foto pemusnahan maksimal 2 foto.');
  }
  for (let i = 0; i < photos.length; i++) {
    const p = photos[i];
    if (!p || typeof p !== 'string' || !p.startsWith('data:image/')) {
      throw new Error(`Foto bukti ke-${i + 1} tidak valid.`);
    }
  }
  return true;
}

/**
 * Pembuatan Draf BAPB oleh Asisten Bibitan (ASB)
 * Invarian: ZERO MUTATION (stok sudah dipotong saat seleksi)
 */
export function createBapbDraft(payload, currentUser) {
  if (!currentUser) throw new Error('Pengguna aktif tidak valid.');
  const role = normalizeRole(currentUser.role || currentUser.rawRole);
  if (role !== ROLES.ASISTEN_BIBITAN) {
    throw new Error('Hanya Asisten Bibitan (ASB) yang berwenang membuat draf Berita Acara Pemusnahan Bibit (BAPB).');
  }

  // 1. Fail-closed storage integrity
  const allRecords = getVerifiedDestructionCollection();

  // 2. Validasi seleksi sumber & kuantitas kanonikal ketat
  const items = Array.isArray(payload.items) ? payload.items : [];
  if (items.length === 0 && !payload.sourceSelectionId && !payload.sourceSelectionNo) {
    throw new Error('Minimal satu dokumen seleksi sumber harus dipilih untuk BAPB.');
  }

  let totalCalculatedQty = 0;
  const canonicalItems = [];

  if (items.length > 0) {
    for (const it of items) {
      const q = parseStrictCanonicalQuantity(
        it.quantity !== undefined ? it.quantity : (it.qty !== undefined ? it.qty : it.jumlahAfkir),
        `Kuantitas bibit item (${it.klon || it.clone || 'Bibit'})`
      );
      canonicalItems.push({
        sourceSelectionId: it.sourceSelectionId || it.id || null,
        sourceSelectionNo: it.sourceSelectionNo || it.docNo || null,
        batchId: it.batchId || null,
        batchCode: it.batchCode || '-',
        bedengan: it.bedengan || it.bedenganCode || '-',
        klon: it.klon || it.clone || '-',
        stage: it.stage || it.selectionStage || 'Afkir Seleksi',
        reason: it.reason || it.alasan || payload.reason || 'Afkir Seleksi',
        quantity: q
      });
      totalCalculatedQty += q;
    }
  } else {
    const q = parseStrictCanonicalQuantity(
      payload.quantity !== undefined ? payload.quantity : payload.destructionQty,
      'Kuantitas total pemusnahan'
    );
    totalCalculatedQty = q;
    canonicalItems.push({
      sourceSelectionId: payload.sourceSelectionId || null,
      sourceSelectionNo: payload.sourceSelectionNo || null,
      batchId: payload.batchId || null,
      batchCode: payload.batchCode || '-',
      bedengan: payload.bedengan || '-',
      klon: payload.klon || payload.clone || '-',
      stage: payload.stage || 'Afkir Seleksi',
      reason: payload.reason || 'Afkir Seleksi',
      quantity: q
    });
  }

  // 3. Cek konflik pemakaian dokumen sumber
  const sourceIdsToCheck = canonicalItems.map(x => x.sourceSelectionId || x.sourceSelectionNo).filter(Boolean);
  for (const rec of allRecords) {
    if (!rec) continue;
    const st = String(rec.bapbStatus || rec.status || '').toUpperCase();
    if (st === BAPB_STATUS.DRAFT_AWAITING_ASKEP || st === BAPB_STATUS.DRAFT_AWAITING_PENGURUS || st === BAPB_STATUS.FINAL || rec.isFinal === true) {
      const existingItems = Array.isArray(rec.items) ? rec.items : [rec];
      for (const eIt of existingItems) {
        const eId = eIt.sourceSelectionId || eIt.sourceSelectionNo;
        if (eId && sourceIdsToCheck.includes(eId)) {
          throw new Error(`Dokumen seleksi sumber ${eId} sudah digunakan pada dokumen BAPB ${rec.docNo || rec.id}. Operasi dibatalkan demi integritas data.`);
        }
      }
    }
  }

  // 4. Validasi tanda tangan ASB
  validateVisualSignature(payload.asbSignature, 'Asisten Divisi Bibitan — Pelaksana');

  // 5. Validasi bukti foto (1-2 foto)
  const photos = payload.photos || payload.photoEvidences || [];
  validatePhotoEvidences(photos);

  const estateId = payload.estateId || currentUser.estateId || 'EST-TBS';
  const divisionId = payload.divisionId || currentUser.divisionId || 'DIV-001';
  const estateCode = resolveBapbEstateDisplayCode(estateId);
  const divisionCode = resolveBapbDivisionDisplayCode(divisionId, estateId);

  const wibTime = getOfficialBusinessTimeWIB();
  const draftId = `BAPB-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const draftDocNo = `DRAFT-BAPB/${estateCode}/${divisionCode}/${wibTime.monthStr}/${wibTime.year}/${Date.now().toString().slice(-4)}`;

  const newDraft = {
    id: draftId,
    bapbId: draftId,
    docNo: draftDocNo,
    draftDocNo: draftDocNo,
    officialDocNo: null,
    publishedAt: null,
    isFinal: false,
    documentType: 'BAPB_KARET',
    transactionType: 'PEMUSNAHAN_BIBIT',
    approvalMode: payload.approvalMode || APPROVAL_MODE.SEQUENTIAL,

    estateId: estateId,
    estateCode: estateCode,
    estateName: payload.estateName || currentUser.estateName || 'Tanah Besih',
    divisionId: divisionId,
    divisionCode: divisionCode,
    divisionName: payload.divisionName || currentUser.divisionName || 'Divisi I',

    items: canonicalItems,
    totalQty: totalCalculatedQty,
    quantity: totalCalculatedQty,
    destructionQty: totalCalculatedQty,

    klon: canonicalItems.map(it => it.klon).filter((v, i, a) => a.indexOf(v) === i).join(', ') || 'GT 1',
    bedengan: canonicalItems.map(it => it.bedengan).filter((v, i, a) => a.indexOf(v) === i).join(', ') || '-',
    batchCode: canonicalItems.map(it => it.batchCode).filter((v, i, a) => a.indexOf(v) === i).join(', ') || '-',
    sourceSelectionNo: canonicalItems.map(it => it.sourceSelectionNo).filter(Boolean).join(', ') || '-',
    sourceSelectionId: canonicalItems[0]?.sourceSelectionId || null,

    tanggalPelaksanaan: payload.tanggalPelaksanaan || payload.executionDate || wibTime.isoDate,
    date: payload.tanggalPelaksanaan || payload.executionDate || wibTime.isoDate,
    tanggalPemusnahan: payload.tanggalPelaksanaan || payload.executionDate || wibTime.isoDate,
    destructionMethod: payload.destructionMethod || 'PEMBAKARAN_DAN_PENCINCANGAN',
    metodePemusnahan: payload.metodePemusnahan || 'Pencincangan dan Pemendaman',
    reason: payload.reason || 'Afkir Seleksi / Rusak / Tidak Layak Tanam',
    alasan: payload.reason || 'Afkir Seleksi / Rusak / Tidak Layak Tanam',
    notes: payload.notes || '-',
    catatan: payload.notes || '-',

    photos: photos,
    photoEvidence: photos[0] || null,

    signatures: {
      asb: {
        roleTitle: 'Asisten Divisi Bibitan — Pelaksana',
        name: currentUser.name || currentUser.fullName || 'Asisten Bibitan',
        userId: currentUser.userId || currentUser.id,
        signatureDataUrl: payload.asbSignature,
        signedAt: wibTime.isoDateTimeWIB
      },
      askep: null,
      pengurus: null
    },

    // Strict zero inventory mutation invariant
    bapbInventoryEffect: 'ZERO_MUTATION_ALREADY_DEDUCTED_AT_SELECTION',

    bapbStatus: BAPB_STATUS.DRAFT_AWAITING_ASKEP,
    status: BAPB_STATUS.DRAFT_AWAITING_ASKEP,

    createdByUserId: currentUser.userId || currentUser.id,
    createdByName: currentUser.name || currentUser.fullName || 'Asisten Bibitan',
    createdByRole: ROLES.ASISTEN_BIBITAN,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  allRecords.push(newDraft);

  try {
    storage.set(DESTRUCTION_STORAGE_KEY, allRecords);
  } catch (err) {
    throw new Error(`Gagal menyimpan draf BAPB: ${err.message || 'Penyimpanan penuh (QuotaExceededError)'}`);
  }

  return newDraft;
}

/**
 * Persetujuan & Penandatanganan BAPB oleh Asisten Kepala (Askep)
 */
export function signBapbAskep(draftIdOrDocNo, signatureDataUrl, notes = '', currentUser) {
  if (!currentUser) throw new Error('Pengguna aktif tidak valid.');
  const role = normalizeRole(currentUser.role || currentUser.rawRole);
  if (role !== ROLES.ASISTEN_KEPALA && role !== 'ASKEP') {
    throw new Error('Hanya Asisten Kepala (Askep) yang berhak menyetujui dan menandatangani BAPB pada tahap ini.');
  }

  validateVisualSignature(signatureDataUrl, 'Asisten Kepala — Pelaksana');

  const allRecords = getVerifiedDestructionCollection();
  const idx = allRecords.findIndex(r => r.id === draftIdOrDocNo || r.docNo === draftIdOrDocNo || r.draftDocNo === draftIdOrDocNo);
  if (idx === -1) {
    throw new Error(`Draf BAPB dengan identitas ${draftIdOrDocNo} tidak ditemukan.`);
  }

  const draft = allRecords[idx];
  checkImmutableFinalBapb(draft);

  const currentStatus = draft.bapbStatus || draft.status;
  if (currentStatus !== BAPB_STATUS.DRAFT_AWAITING_ASKEP) {
    throw new Error(`Draf BAPB tidak dapat diproses oleh Askep karena berstatus ${currentStatus} (harus DRAFT_AWAITING_ASKEP).`);
  }

  if (!draft.signatures?.asb?.signatureDataUrl) {
    throw new Error('Tanda tangan Asisten Bibitan tidak ditemukan pada draf ini.');
  }

  const wibTime = getOfficialBusinessTimeWIB();
  const updated = {
    ...draft,
    signatures: {
      ...draft.signatures,
      askep: {
        roleTitle: 'Asisten Kepala — Pelaksana',
        name: currentUser.name || currentUser.fullName || 'Asisten Kepala',
        userId: currentUser.userId || currentUser.id,
        signatureDataUrl: signatureDataUrl,
        notes: notes || '',
        signedAt: wibTime.isoDateTimeWIB
      }
    },
    askepNotes: notes || '',
    bapbStatus: BAPB_STATUS.DRAFT_AWAITING_PENGURUS,
    status: BAPB_STATUS.DRAFT_AWAITING_PENGURUS,
    updatedAt: new Date().toISOString()
  };

  allRecords[idx] = updated;

  try {
    storage.set(DESTRUCTION_STORAGE_KEY, allRecords);
  } catch (err) {
    throw new Error(`Gagal menyimpan persetujuan Askep: ${err.message}`);
  }

  return updated;
}

/**
 * Pengembalian (Return) BAPB ke ASB oleh Asisten Kepala (Askep)
 */
export function returnBapbByAskep(draftIdOrDocNo, returnReason, currentUser) {
  if (!currentUser) throw new Error('Pengguna aktif tidak valid.');
  const role = normalizeRole(currentUser.role || currentUser.rawRole);
  if (role !== ROLES.ASISTEN_KEPALA && role !== 'ASKEP') {
    throw new Error('Hanya Asisten Kepala (Askep) yang berhak mengembalikan draf BAPB.');
  }

  if (!returnReason || !returnReason.trim()) {
    throw new Error('Alasan pengembalian draf BAPB wajib diisi.');
  }

  const allRecords = getVerifiedDestructionCollection();
  const idx = allRecords.findIndex(r => r.id === draftIdOrDocNo || r.docNo === draftIdOrDocNo || r.draftDocNo === draftIdOrDocNo);
  if (idx === -1) {
    throw new Error(`Draf BAPB dengan identitas ${draftIdOrDocNo} tidak ditemukan.`);
  }

  const draft = allRecords[idx];
  checkImmutableFinalBapb(draft);

  const currentStatus = draft.bapbStatus || draft.status;
  if (currentStatus !== BAPB_STATUS.DRAFT_AWAITING_ASKEP) {
    throw new Error(`Draf BAPB berstatus ${currentStatus} dan tidak dapat dikembalikan.`);
  }

  const updated = {
    ...draft,
    bapbStatus: BAPB_STATUS.DIKEMBALIKAN_KE_ASB,
    status: BAPB_STATUS.DIKEMBALIKAN_KE_ASB,
    returnReason: returnReason.trim(),
    returnedByUserId: currentUser.userId || currentUser.id,
    returnedByName: currentUser.name || currentUser.fullName,
    returnedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  allRecords[idx] = updated;

  try {
    storage.set(DESTRUCTION_STORAGE_KEY, allRecords);
  } catch (err) {
    throw new Error(`Gagal mengembalikan draf BAPB: ${err.message}`);
  }

  return updated;
}

/**
 * Perbaikan Draf BAPB oleh Asisten Bibitan (setelah dikembalikan oleh Askep)
 * - Hanya dapat dilakukan oleh ASB pemilik dokumen
 * - Dokumen harus berstatus DIKEMBALIKAN_KE_ASB
 * - Mengharuskan tanda tangan visual ASB baru
 * - Mengosongkan tanda tangan Askep & Pengurus agar tidak menyetujui isi yang berubah
 * - Mengembalikan status ke DRAFT_AWAITING_ASKEP
 */
export function reviseBapbDraft(draftIdOrDocNo, payload, currentUser) {
  if (!currentUser) throw new Error('Pengguna aktif tidak valid.');
  const role = normalizeRole(currentUser.role || currentUser.rawRole);
  if (role !== ROLES.ASISTEN_BIBITAN) {
    throw new Error('Hanya Asisten Bibitan (ASB) yang berwenang memperbaiki draf BAPB.');
  }

  const allRecords = getVerifiedDestructionCollection();
  const idx = allRecords.findIndex(r => r.id === draftIdOrDocNo || r.docNo === draftIdOrDocNo || r.draftDocNo === draftIdOrDocNo);
  if (idx === -1) {
    throw new Error(`Draf BAPB dengan identitas ${draftIdOrDocNo} tidak ditemukan.`);
  }

  const draft = allRecords[idx];
  checkImmutableFinalBapb(draft);

  const currentStatus = draft.bapbStatus || draft.status;
  if (currentStatus !== BAPB_STATUS.DIKEMBALIKAN_KE_ASB) {
    throw new Error(`Draf BAPB berstatus ${currentStatus} dan tidak dalam status DIKEMBALIKAN_KE_ASB untuk diperbaiki.`);
  }

  // Validasi tanda tangan visual ASB baru
  validateVisualSignature(payload.asbSignature, 'Asisten Divisi Bibitan — Pelaksana');

  // Validasi foto (1-2 foto)
  const photos = payload.photos || payload.photoEvidences || draft.photos || [];
  validatePhotoEvidences(photos);

  const wibTime = getOfficialBusinessTimeWIB();

  const updatedDraft = {
    ...draft,
    tanggalPelaksanaan: payload.tanggalPelaksanaan || payload.executionDate || draft.tanggalPelaksanaan,
    destructionMethod: payload.destructionMethod || draft.destructionMethod,
    metodePemusnahan: payload.metodePemusnahan || draft.metodePemusnahan,
    notes: payload.notes || draft.notes,
    catatan: payload.notes || draft.catatan,
    photos: photos,
    photoEvidence: photos[0] || null,
    
    // Perbarui tanda tangan ASB, dan KOSONGKAN tanda tangan Askep & Pengurus
    signatures: {
      asb: {
        roleTitle: 'Asisten Divisi Bibitan — Pelaksana',
        name: currentUser.name || currentUser.fullName || 'Asisten Bibitan',
        userId: currentUser.userId || currentUser.id,
        signatureDataUrl: payload.asbSignature,
        signedAt: wibTime.isoDateTimeWIB,
        revisedAt: wibTime.isoDateTimeWIB
      },
      askep: null,
      pengurus: null
    },

    // Kembalikan ke antrean pemeriksaan Askep
    bapbStatus: BAPB_STATUS.DRAFT_AWAITING_ASKEP,
    status: BAPB_STATUS.DRAFT_AWAITING_ASKEP,
    revisedAt: new Date().toISOString(),
    revisedByUserId: currentUser.userId || currentUser.id,
    updatedAt: new Date().toISOString()
  };

  allRecords[idx] = updatedDraft;

  try {
    storage.set(DESTRUCTION_STORAGE_KEY, allRecords);
  } catch (err) {
    throw new Error(`Gagal menyimpan perbaikan draf BAPB: ${err.message}`);
  }

  return updatedDraft;
}

/**
 * Pengesahan Dokumen FINAL BAPB oleh Pengurus
 * - Status draf harus persis DRAFT_AWAITING_PENGURUS
 * - Dialokasikan nomor urut resmi BAPB baru: [KEBUN]/[DIVISI]/[BULAN]/[TAHUN]/[SEQ]
 * - Waktu penerbitan (publishedAt) ditentukan secara strictly WIB (Asia/Jakarta)
 * - In-place update record target tanpa mereset atau menghapus record lain
 * - Menangani kegagalan QuotaExceededError tanpa menampilkan sukses palsu
 */
export function finalizeBapbDocument(draftIdOrDocNo, signatureDataUrl, notes = '', currentUser) {
  if (!currentUser) throw new Error('Pengguna aktif tidak valid.');
  const role = normalizeRole(currentUser.role || currentUser.rawRole);
  if (role !== ROLES.PENGURUS && role !== 'PENGURUS') {
    throw new Error('Hanya Pengurus yang berwenang mengesahkan dokumen FINAL Berita Acara Pemusnahan Bibit (BAPB).');
  }

  validateVisualSignature(signatureDataUrl, 'Pengurus — Diketahui');

  // 1. Fail-closed storage collection retrieval
  const allRecords = getVerifiedDestructionCollection();
  const idx = allRecords.findIndex(r => r.id === draftIdOrDocNo || r.docNo === draftIdOrDocNo || r.draftDocNo === draftIdOrDocNo);
  if (idx === -1) {
    throw new Error(`Draf BAPB dengan identitas ${draftIdOrDocNo} tidak ditemukan.`);
  }

  const draft = allRecords[idx];
  checkImmutableFinalBapb(draft);

  const currentStatus = draft.bapbStatus || draft.status;

  // STRICT STATE CHECK: ONLY DRAFT_AWAITING_PENGURUS IS ALLOWED
  if (currentStatus !== BAPB_STATUS.DRAFT_AWAITING_PENGURUS) {
    throw new Error(`Finalisasi ditolak: Status dokumen saat ini adalah ${currentStatus}. Dokumen hanya dapat disahkan oleh Pengurus jika berstatus DRAFT_AWAITING_PENGURUS.`);
  }

  // Validasi kelengkapan tanda tangan sebelumnya
  if (!draft.signatures?.asb?.signatureDataUrl) {
    throw new Error('Finalisasi ditolak: Tanda tangan Asisten Bibitan belum lengkap.');
  }
  if (!draft.signatures?.askep?.signatureDataUrl) {
    throw new Error('Finalisasi ditolak: Tanda tangan Asisten Kepala belum lengkap.');
  }

  // 2. Alokasi Nomor Resmi BAPB strictly pada waktu finalisasi dalam zona waktu WIB
  const wibTime = getOfficialBusinessTimeWIB();
  const estateCode = resolveBapbEstateDisplayCode(draft.estateId || currentUser.estateId);
  const divisionCode = resolveBapbDivisionDisplayCode(draft.divisionId || currentUser.divisionId, draft.estateId);

  const officialDocNo = allocateNextBapbDocNo(
    estateCode,
    divisionCode,
    wibTime.month,
    wibTime.year,
    allRecords
  );

  const finalRecord = {
    ...draft,
    officialDocNo: officialDocNo,
    docNo: officialDocNo,
    destructionNo: officialDocNo,
    bapbNo: officialDocNo,
    isFinal: true,
    publishedAt: wibTime.isoDateTimeWIB,
    finalizedAt: wibTime.isoDateTimeWIB,
    bapbInventoryEffect: 'ZERO_MUTATION_ALREADY_DEDUCTED_AT_SELECTION',

    signatures: {
      ...draft.signatures,
      pengurus: {
        roleTitle: 'Pengurus — Diketahui',
        name: currentUser.name || currentUser.fullName || 'Pengurus',
        userId: currentUser.userId || currentUser.id,
        signatureDataUrl: signatureDataUrl,
        notes: notes || '',
        signedAt: wibTime.isoDateTimeWIB
      }
    },
    pengurusNotes: notes || '',
    bapbStatus: BAPB_STATUS.FINAL,
    status: BAPB_STATUS.FINAL,
    updatedAt: new Date().toISOString()
  };

  // In-place update preserving all non-target records (historical CUL, other drafts)
  allRecords[idx] = finalRecord;

  try {
    storage.set(DESTRUCTION_STORAGE_KEY, allRecords);
  } catch (err) {
    // Abort safely, do not alter storage or state
    throw new Error(`Gagal menyimpan dokumen FINAL BAPB (${err.name || 'StorageError'}: ${err.message}). Nomor resmi tidak digunakan dan dokumen tetap pada status draf.`);
  }

  return finalRecord;
}

/**
 * Resolusi identitas penandatangan (Askep & Pengurus) berdasarkan estate
 * Digunakan untuk merekam identitas role yang tersedia di prototype
 */
export function resolveBapbSignersForEstate(estateId = 'EST-TBS') {
  const isApm = String(estateId || '').toUpperCase().includes('APM');
  return {
    asb: {
      userId: isApm ? 'ASB002' : 'ASB001',
      name: isApm ? 'Abdul Gofur' : 'Annisa',
      roleTitle: 'Asisten Divisi Bibitan — Pelaksana'
    },
    askep: {
      userId: isApm ? 'ASK002' : 'ASK001',
      name: isApm ? 'Dadin' : 'Beny Sihotang',
      roleTitle: 'Asisten Kepala — Pemeriksa'
    },
    pengurus: {
      userId: isApm ? 'PGS002' : 'PGS001',
      name: isApm ? 'Junaidi' : 'Junaidi',
      roleTitle: 'Pengurus — Pengesah'
    }
  };
}

/**
 * Pembuatan dan Pengesahan Langsung Dokumen FINAL BAPB di Lokasi Pemusnahan (Mode B)
 * Ketentuan:
 * - Dilakukan oleh ASB saat ketiga pihak (ASB, Askep, Pengurus) hadir bersama di lokasi
 * - Wajib 3 tanda tangan visual mandiri (tidak boleh kosong atau disalin/identik)
 * - Wajib 1-2 bukti foto nyata dari kamera
 * - Wajib seleksi sumber valid & kanonikal
 * - Alokasi nomor resmi [KEBUN]/[DIVISI]/[BULAN]/[TAHUN]/[NOMOR_URUT]
 * - Status langsung FINAL dan dokumen terkunci
 * - Zero inventory stock mutation (dipotong saat seleksi)
 */
export function createAndFinalizeDirectOnSiteBapb(payload, currentUser) {
  if (!currentUser) throw new Error('Pengguna aktif tidak valid.');
  const role = normalizeRole(currentUser.role || currentUser.rawRole);
  if (role !== ROLES.ASISTEN_BIBITAN) {
    throw new Error('Hanya Asisten Bibitan (ASB) yang berwenang mengajukan pengesahan BAPB langsung di lokasi.');
  }

  if (!payload) {
    throw new Error('Data Berita Acara tidak boleh kosong.');
  }

  // 1. Fail-closed storage integrity
  const allRecords = getVerifiedDestructionCollection();

  // 2. Validasi seleksi sumber & kuantitas kanonikal ketat
  const items = Array.isArray(payload.items) ? payload.items : [];
  if (items.length === 0 && !payload.sourceSelectionId && !payload.sourceSelectionNo) {
    throw new Error('Minimal satu dokumen seleksi sumber harus dipilih untuk BAPB.');
  }

  let totalCalculatedQty = 0;
  const canonicalItems = [];

  if (items.length > 0) {
    for (const it of items) {
      const q = parseStrictCanonicalQuantity(
        it.quantity !== undefined ? it.quantity : (it.qty !== undefined ? it.qty : it.jumlahAfkir),
        `Kuantitas bibit item (${it.klon || it.clone || 'Bibit'})`
      );
      canonicalItems.push({
        sourceSelectionId: it.sourceSelectionId || it.id || null,
        sourceSelectionNo: it.sourceSelectionNo || it.docNo || null,
        batchId: it.batchId || null,
        batchCode: it.batchCode || '-',
        bedengan: it.bedengan || it.bedenganCode || '-',
        klon: it.klon || it.clone || '-',
        stage: it.stage || it.selectionStage || 'Afkir Seleksi',
        reason: it.reason || it.alasan || payload.reason || 'Afkir Seleksi',
        quantity: q
      });
      totalCalculatedQty += q;
    }
  } else {
    const q = parseStrictCanonicalQuantity(
      payload.quantity !== undefined ? payload.quantity : payload.destructionQty,
      'Kuantitas total pemusnahan'
    );
    totalCalculatedQty = q;
    canonicalItems.push({
      sourceSelectionId: payload.sourceSelectionId || null,
      sourceSelectionNo: payload.sourceSelectionNo || null,
      batchId: payload.batchId || null,
      batchCode: payload.batchCode || '-',
      bedengan: payload.bedengan || '-',
      klon: payload.klon || payload.clone || '-',
      stage: payload.stage || 'Afkir Seleksi',
      reason: payload.reason || 'Afkir Seleksi',
      quantity: q
    });
  }

  // 3. Cek konflik pemakaian dokumen sumber
  const sourceIdsToCheck = canonicalItems.map(x => x.sourceSelectionId || x.sourceSelectionNo).filter(Boolean);
  for (const rec of allRecords) {
    if (!rec) continue;
    const st = String(rec.bapbStatus || rec.status || '').toUpperCase();
    if (st === BAPB_STATUS.DRAFT_AWAITING_ASKEP || st === BAPB_STATUS.DRAFT_AWAITING_PENGURUS || st === BAPB_STATUS.FINAL || rec.isFinal === true) {
      const existingItems = Array.isArray(rec.items) ? rec.items : [rec];
      for (const eIt of existingItems) {
        const eId = eIt.sourceSelectionId || eIt.sourceSelectionNo;
        if (eId && sourceIdsToCheck.includes(eId)) {
          throw new Error(`Dokumen seleksi sumber ${eId} sudah digunakan pada dokumen BAPB ${rec.docNo || rec.id}. Operasi dibatalkan demi integritas data.`);
        }
      }
    }
  }

  // 4. Validasi Bukti Foto (1-2 foto)
  const photos = payload.photos || payload.photoEvidences || [];
  validatePhotoEvidences(photos);

  // 5. Validasi Tiga Tanda Tangan Visual Secara Mandiri
  validateVisualSignature(payload.asbSignature, 'Asisten Divisi Bibitan — Pelaksana');
  validateVisualSignature(payload.askepSignature, 'Asisten Kepala — Pemeriksa');
  validateVisualSignature(payload.pengurusSignature, 'Pengurus — Pengesah');

  // Strict anti-copy / anti-autofill check: tanda tangan tidak boleh identik
  if (
    payload.asbSignature === payload.askepSignature ||
    payload.asbSignature === payload.pengurusSignature ||
    payload.askepSignature === payload.pengurusSignature
  ) {
    throw new Error('Setiap pihak (ASB, Askep, Pengurus) wajib membubuhkan tanda tangan masing-masing. Tanda tangan tidak boleh disalin atau identik.');
  }

  const estateId = payload.estateId || currentUser.estateId || 'EST-TBS';
  const divisionId = payload.divisionId || currentUser.divisionId || 'DIV-001';
  const estateCode = resolveBapbEstateDisplayCode(estateId);
  const divisionCode = resolveBapbDivisionDisplayCode(divisionId, estateId);

  // 6. Alokasi Nomor Resmi BAPB strictly pada waktu finalisasi dalam zona waktu WIB
  const wibTime = getOfficialBusinessTimeWIB();
  const officialDocNo = allocateNextBapbDocNo(
    estateCode,
    divisionCode,
    wibTime.month,
    wibTime.year,
    allRecords
  );

  const signers = resolveBapbSignersForEstate(estateId);
  const asbName = currentUser.name || currentUser.fullName || signers.asb.name;
  const asbUserId = currentUser.userId || currentUser.id || signers.asb.userId;
  const askepName = payload.askepName || signers.askep.name;
  const askepUserId = payload.askepUserId || signers.askep.userId;
  const pengurusName = payload.pengurusName || signers.pengurus.name;
  const pengurusUserId = payload.pengurusUserId || signers.pengurus.userId;

  const bapbId = `BAPB-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  const finalRecord = {
    id: bapbId,
    bapbId: bapbId,
    docNo: officialDocNo,
    officialDocNo: officialDocNo,
    draftDocNo: null,
    destructionNo: officialDocNo,
    bapbNo: officialDocNo,
    isFinal: true,
    documentType: 'BAPB_KARET',
    transactionType: 'PEMUSNAHAN_BIBIT',
    approvalMode: APPROVAL_MODE.DIRECT_ON_SITE,

    estateId: estateId,
    estateCode: estateCode,
    estateName: payload.estateName || currentUser.estateName || 'Tanah Besih',
    divisionId: divisionId,
    divisionCode: divisionCode,
    divisionName: payload.divisionName || currentUser.divisionName || 'Divisi I',

    items: canonicalItems,
    totalQty: totalCalculatedQty,
    quantity: totalCalculatedQty,
    destructionQty: totalCalculatedQty,

    klon: canonicalItems.map(it => it.klon).filter((v, i, a) => a.indexOf(v) === i).join(', ') || 'GT 1',
    bedengan: canonicalItems.map(it => it.bedengan).filter((v, i, a) => a.indexOf(v) === i).join(', ') || '-',
    batchCode: canonicalItems.map(it => it.batchCode).filter((v, i, a) => a.indexOf(v) === i).join(', ') || '-',
    sourceSelectionNo: canonicalItems.map(it => it.sourceSelectionNo).filter(Boolean).join(', ') || '-',
    sourceSelectionId: canonicalItems[0]?.sourceSelectionId || null,

    tanggalPelaksanaan: payload.tanggalPelaksanaan || payload.executionDate || wibTime.isoDate,
    date: payload.tanggalPelaksanaan || payload.executionDate || wibTime.isoDate,
    tanggalPemusnahan: payload.tanggalPelaksanaan || payload.executionDate || wibTime.isoDate,
    destructionMethod: payload.destructionMethod || 'PEMBAKARAN_DAN_PENCINCANGAN',
    metodePemusnahan: payload.metodePemusnahan || 'Pencincangan dan Pemendaman',
    reason: payload.reason || 'Afkir Seleksi / Rusak / Tidak Layak Tanam',
    alasan: payload.reason || 'Afkir Seleksi / Rusak / Tidak Layak Tanam',
    notes: payload.notes || '-',
    catatan: payload.notes || '-',

    photos: photos,
    photoEvidence: photos[0] || null,

    signatures: {
      asb: {
        roleTitle: 'Asisten Divisi Bibitan — Pelaksana',
        name: asbName,
        userId: asbUserId,
        signatureDataUrl: payload.asbSignature,
        signedAt: wibTime.isoDateTimeWIB
      },
      askep: {
        roleTitle: 'Asisten Kepala — Pemeriksa',
        name: askepName,
        userId: askepUserId,
        signatureDataUrl: payload.askepSignature,
        signedAt: wibTime.isoDateTimeWIB,
        notes: payload.askepNotes || 'Disetujui langsung di lokasi pemusnahan'
      },
      pengurus: {
        roleTitle: 'Pengurus — Pengesah',
        name: pengurusName,
        userId: pengurusUserId,
        signatureDataUrl: payload.pengurusSignature,
        signedAt: wibTime.isoDateTimeWIB,
        notes: payload.pengurusNotes || 'Disahkan langsung di lokasi pemusnahan'
      }
    },

    askepNotes: payload.askepNotes || 'Disetujui langsung di lokasi pemusnahan',
    pengurusNotes: payload.pengurusNotes || 'Disahkan langsung di lokasi pemusnahan',

    // Strict zero inventory mutation invariant
    bapbInventoryEffect: 'ZERO_MUTATION_ALREADY_DEDUCTED_AT_SELECTION',

    bapbStatus: BAPB_STATUS.FINAL,
    status: BAPB_STATUS.FINAL,
    publishedAt: wibTime.isoDateTimeWIB,
    finalizedAt: wibTime.isoDateTimeWIB,

    createdByUserId: currentUser.userId || currentUser.id,
    createdByName: currentUser.name || currentUser.fullName || 'Asisten Bibitan',
    createdByRole: ROLES.ASISTEN_BIBITAN,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  allRecords.push(finalRecord);

  try {
    storage.set(DESTRUCTION_STORAGE_KEY, allRecords);
  } catch (err) {
    throw new Error(`Gagal menyimpan dokumen FINAL BAPB (${err.name || 'StorageError'}: ${err.message}). Nomor resmi tidak digunakan.`);
  }

  return finalRecord;
}


