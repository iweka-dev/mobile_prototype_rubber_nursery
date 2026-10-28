/**
 * js/modules/verification/verification-manager.js
 * Engine Verifikasi Data Transaksi Pembibitan untuk ASISTEN_BIBITAN (TASK ASB Redesign)
 * 
 * Prinsip:
 * - Layer pemeriksaan audit final atas transaksi yang dikirim oleh Mantri via Central Hub
 * - ZERO STOCK MUTATION: Tidak mengubah availableQty, currentQty, atau status batch
 * - Consistency Gate: Pengecekan konsistensi data sebelum approval
 * - Scope Isolation: ROLE AKTIF (ASISTEN_BIBITAN) + ESTATE AKTIF + DIVISI AKTIF
 * - 10 Modul Operasional: Presensi, Penerimaan, Penyemaian, Okulasi, Pemeriksaan, Penyeleksian, Kebun Entres, Material, Rekam Pemeliharaan, Pengeluaran
 * - Source Utama Verifikasi: verification_transactions
 */

import { storage } from '../../core/storage.js';
import { session } from '../../core/session.js';
import { normalizeRole, ROLES, getCurrentUserContext, resolveUserContext } from '../../core/user-context.js';
import { getConsolidatedData, runConsistencyCheck, buildTraceabilityChain } from '../consolidation/consolidation-manager.js';
import { getAllBatches } from '../../data/batch-master.js';
import { getAllBedengan } from '../../data/bedengan-master.js';
import { getProgramById } from '../../data/program-master.js';
import { getEstateById } from '../../data/estate-master.js';
import { getWorkersForUserContext } from '../../data/worker-master.js';
import { getWorkAllocationByCode } from '../../data/work-allocation-master.js';
import { getStandardWorkHoursForDate } from '../../data/standard-work-hour-master.js';
import {
  getSelectionStageLabel,
  getSelectionCategoryLabel,
  createSelection2DocumentFromSelection1,
  createSelection3DocumentFromSelection2,
  canCreateSelection2Document,
  canCreateSelection3Document,
  validateSelectionTransactionAgainstSource,
  getActionableSelectionCount,
  syncAllSeedingsToPreGraftingSelectionDocuments,
  isPreGraftingSelection,
  syncAllApprovedPreGraftingSelectionDocuments,
  isPrePlantingCullStockExempt
} from '../selection/selection-manager.js';
import { getInspectionChronologicalMaxAllowed, syncAllDederanRejectionsToSelectionPool, getBedenganInspectionSummary } from '../seeding/dederan-manager.js';
import {
  deductBatchStock as deductInventoryStock,
  getAvailableQty as getInventoryAvailableQty,
  syncBatchPopulationFromSeeding,
  executeStockMutationWithLock,
  INVENTORY_TX_TYPE
} from '../../core/batch-inventory-service.js';
import { assertBatchNotLocked, assertBedenganNotLocked } from '../../core/dependency-guard.js';
import { syncApprovedInspectionOutputs } from '../../core/budding-workflow-service.js';
import {
  validatePhysicalStockCullSelection,
  completePhysicalStockCullVerification,
  returnPhysicalStockCullVerification
} from '../physical-stock-inspection/physical-stock-inspection-manager.js';

export const VERIFICATION_STORAGE_KEY = 'verification_transactions';

export const VERIFICATION_STATUS = Object.freeze({
  TERVERIFIKASI: 'TERVERIFIKASI',
  DATA_TERKONFIRMASI: 'DATA TERKONFIRMASI',
  DIKEMBALIKAN: 'DIKEMBALIKAN',
  MENUNGGU_VERIFIKASI: 'MENUNGGU_VERIFIKASI'
});

export const REFERENCE_TYPES = Object.freeze({
  REQUEST: 'REQUEST',
  DISPATCH: 'DISPATCH',
  RECEIPT: 'RECEIPT',
  SELECTION: 'SELECTION',
  DESTRUCTION: 'DESTRUCTION',
  TIDAK_HADIR: 'TIDAK_HADIR',
  PENYEMAIAN: 'PENYEMAIAN',
  DEDERAN: 'DEDERAN',
  MENUNAS: 'MENUNAS',
  TOPPING: 'TOPPING',
  OKULASI: 'OKULASI',
  PEMERIKSAAN: 'PEMERIKSAAN',
  PEMERIKSAAN_DEDERAN: 'PEMERIKSAAN_DEDERAN',
  SELEKSI_PRA_OKULASI: 'SELEKSI_PRA_OKULASI',
  PENYELEKSIAN: 'PENYELEKSIAN',
  PEMELIHARAAN: 'PEMELIHARAAN',
  PENGELUARAN: 'PENGELUARAN',
  MATERIAL: 'MATERIAL',
  SIMULASI_GUDANG: 'SIMULASI_GUDANG'
});

/**
 * Permintaan (REQUEST) TIDAK masuk Verifikasi Data.
 * Penerimaan dan Pengeluaran MASUK ke Verifikasi setelah disubmit melalui Central Hub.
 */
export const LOGISTICS_TYPES = Object.freeze([
  'REQUEST'
]);

/**
 * 10 Canonical Modules untuk Workspace Verifikasi
 */
export const VERIFICATION_10_MODULES = Object.freeze([
  {
    id: 'TIDAK_HADIR',
    label: 'Tidak Hadir',
    types: ['TIDAK_HADIR', 'PRESENSI'],
    iconName: 'team',
    order: 1
  },
  {
    id: 'PENERIMAAN',
    label: 'Penerimaan',
    types: ['PENERIMAAN', 'RECEIPT'],
    iconName: 'documentPlus',
    order: 2
  },
  {
    id: 'PENYEMAIAN',
    label: 'Penyemaian',
    types: ['PENYEMAIAN', 'DEDERAN', 'SEEDING'],
    iconName: 'sprout',
    order: 3
  },
  {
    id: 'OKULASI',
    label: 'Okulasi',
    types: ['OKULASI', 'BUDDING'],
    iconName: 'scissors',
    order: 4
  },
  {
    id: 'PEMERIKSAAN',
    label: 'Pemeriksaan',
    types: ['PEMERIKSAAN', 'PEMERIKSAAN_DEDERAN', 'INSPECTION'],
    iconName: 'documentSearch',
    order: 5
  },
  {
    id: 'PENYELEKSIAN',
    label: 'Penyeleksian',
    types: ['PENYELEKSIAN', 'SELEKSI_PRA_OKULASI', 'SELECTION'],
    iconName: 'leafCheck',
    order: 6
  },
  {
    id: 'KEBUN_ENTRES',
    label: 'Kebun Entres',
    types: ['KEBUN_ENTRES', 'ENTRES', 'MENUNAS', 'TOPPING'],
    iconName: 'tree',
    order: 7
  },
  {
    id: 'MATERIAL',
    label: 'Material',
    types: ['MATERIAL', 'SIMULASI_GUDANG'],
    iconName: 'material',
    order: 8
  },
  {
    id: 'REKAM_PEMELIHARAAN',
    label: 'Rekam Pemeliharaan',
    types: ['REKAM_PEMELIHARAAN', 'PEMELIHARAAN', 'NURSERY_ACTIVITY'],
    iconName: 'plantCare',
    order: 9
  },
  {
    id: 'PENGELUARAN',
    label: 'Pengeluaran',
    types: ['PENGELUARAN', 'DISPATCH'],
    iconName: 'dispatch',
    order: 10
  }
]);

/**
 * Label display untuk setiap referenceType
 */
export const REFERENCE_TYPE_LABELS = Object.freeze({
  TIDAK_HADIR: 'Tidak Hadir',
  PRESENSI: 'Presensi',
  PENYEMAIAN: 'Penyemaian',
  DEDERAN: 'Dederan (Germinasi)',
  MENUNAS: 'Menunas',
  TOPPING: 'Topping',
  OKULASI: 'Okulasi',
  PEMERIKSAAN: 'Pemeriksaan Okulasi',
  PEMERIKSAAN_DEDERAN: 'Pemeriksaan Dederan',
  SELEKSI_PRA_OKULASI: 'Pemeriksaan Pra-Okulasi',
  PENYELEKSIAN: 'Penyeleksian Bibit',
  PEMELIHARAAN: 'Rekam Pemeliharaan',
  MATERIAL: 'Material & Bahan',
  SIMULASI_GUDANG: 'Simulasi Issue Gudang',
  REQUEST: 'Permintaan (SPB)',
  DISPATCH: 'Pengeluaran (Dispatch)',
  RECEIPT: 'Penerimaan KSP',
  SELECTION: 'Hasil Seleksi',
  DESTRUCTION: 'Pemusnahan Bibit',
  PENGELUARAN: 'Pengeluaran Bibit',
  PENERIMAAN: 'Penerimaan Bibit',
  KEBUN_ENTRES: 'Kebun Entres',
  REKAM_PEMELIHARAAN: 'Rekam Pemeliharaan'
});

/**
 * Canonical Storage Map per Reference Type
 */
export const CANONICAL_STORAGE_MAP = Object.freeze({
  TIDAK_HADIR: ['virtual_tidak_hadir'],
  PRESENSI: ['attendance_transactions'],
  PENERIMAAN: ['receipt_ksp_transactions', 'penerimaan_biji_records', 'receipt_transactions'],
  RECEIPT: ['receipt_ksp_transactions', 'penerimaan_biji_records', 'receipt_transactions'],
  PENYEMAIAN: ['seeding_transactions'],
  SEEDING: ['seeding_transactions'],
  DEDERAN: ['dederan_transactions'],
  OKULASI: ['budding_transactions'],
  BUDDING: ['budding_transactions'],
  PEMERIKSAAN: ['inspection_transactions'],
  INSPECTION: ['inspection_transactions'],
  PEMERIKSAAN_DEDERAN: ['dederan_inspections'],
  PENYELEKSIAN: ['selection_transactions'],
  SELECTION: ['selection_transactions'],
  SELEKSI_PRA_OKULASI: ['pre_grafting_selection_documents', 'selection_transactions'],
  KEBUN_ENTRES: ['entres_topping_transactions', 'entres_menunas_transactions', 'entres_transactions'],
  ENTRES: ['entres_topping_transactions', 'entres_menunas_transactions', 'entres_transactions'],
  MENUNAS: ['entres_menunas_transactions', 'entres_transactions'],
  TOPPING: ['entres_topping_transactions', 'entres_transactions'],
  MATERIAL: ['seeding_transactions', 'material_usage_transactions'],
  SIMULASI_GUDANG: ['warehouse_issue_simulations'],
  REKAM_PEMELIHARAAN: ['nursery_activity_transactions', 'nursery_activity_records'],
  PEMELIHARAAN: ['nursery_activity_transactions', 'nursery_activity_records'],
  NURSERY_ACTIVITY: ['nursery_activity_transactions', 'nursery_activity_records'],
  PENGELUARAN: ['dispatch_transactions'],
  DISPATCH: ['dispatch_transactions'],
  DESTRUCTION: ['destruction_transactions'],
  REQUEST: ['requests_transactions']
});

/**
 * Helper: Safe number formatting yang aman terhadap null, undefined, numeric string, '-' (hyphen)
 */
export function formatSafeNumber(val, defaultFallback = '-') {
  if (val === undefined || val === null || val === '') return defaultFallback;
  if (val === '-') return '-';
  const n = Number(val);
  if (Number.isNaN(n)) return String(val);
  return n.toLocaleString('id-ID');
}

/**
 * Mengambil semua riwayat verifikasi audit dari storage
 */
export function getAllVerifications() {
  return storage.get(VERIFICATION_STORAGE_KEY, []);
}

/**
 * Mencari catatan verifikasi berdasarkan referenceType dan referenceId
 */
export function getVerificationByReference(referenceType, referenceId) {
  if (!referenceType || !referenceId) return null;
  const list = getAllVerifications();
  return list
    .filter(v => v.referenceType === referenceType && String(v.referenceId) === String(referenceId))
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))[0] || null;
}

/**
 * Deterministic Reconstruction untuk TIDAK_HADIR berdasarkan attendance_transactions
 */
export function resolveTidakHadirDeterministic(referenceId, userCtx = null) {
  if (!referenceId) return null;
  const targetId = String(referenceId);

  // Extract date from referenceId (e.g. ABSEN-02102026 -> 02/10/2026 or ABSEN-20261002)
  let dateStr = '';
  const m1 = targetId.match(/ABSEN-(\d{2})(\d{2})(\d{4})/i);
  if (m1) {
    dateStr = `${m1[1]}/${m1[2]}/${m1[3]}`;
  } else {
    const m2 = targetId.match(/ABSEN-(\d{4})(\d{2})(\d{2})/i);
    if (m2) {
      dateStr = `${m2[3]}/${m2[2]}/${m2[1]}`;
    }
  }

  const user = userCtx || getCurrentUserContext() || resolveUserContext();
  const storedAtts = storage.get('attendance_transactions', []);

  // Find attendance records matching the date and scope
  const matchingAtts = storedAtts.filter(a => {
    if (a.type !== 'WORKER' && a.attendanceType !== 'DATANG') return false;
    if (a.attendanceType && a.attendanceType !== 'DATANG') return false;

    if (dateStr) {
      const aDate = a.date || a.tanggal || a.attendanceDate || '';
      const normADate = aDate.includes('-') ? aDate.split('-').reverse().join('/') : aDate;
      if (normADate && !normADate.includes(dateStr) && !dateStr.includes(normADate)) return false;
    }

    if (user?.estateId && a.estateId && a.estateId !== user.estateId) return false;
    if (user?.divisionId && a.divisionId && a.divisionId !== user.divisionId) return false;
    return true;
  });

  if (matchingAtts.length > 0) {
    let scopedAll = [];
    try {
      scopedAll = getWorkersForUserContext(user, { activeOnly: false }) || [];
    } catch (_) {
      scopedAll = [];
    }

    const presentWorkerKeys = new Set();
    matchingAtts.forEach(a => {
      if (a.workerId) presentWorkerKeys.add(String(a.workerId));
      if (a.code) presentWorkerKeys.add(String(a.code));
      if (a.workerCode) presentWorkerKeys.add(String(a.workerCode));
    });

    const scopedAbsent = scopedAll.filter(
      w => w.status !== 'ACTIVE' || w.active === false || !!w.absentType
    );

    const activeUnchecked = scopedAll.filter(
      w =>
        (w.status === 'ACTIVE' && w.active !== false && !w.absentType) &&
        !presentWorkerKeys.has(String(w.id)) &&
        !presentWorkerKeys.has(String(w.code))
    );

    const absentWorkers = [...scopedAbsent, ...activeUnchecked];

    return {
      id: targetId,
      docNo: targetId,
      date: dateStr || matchingAtts[0]?.date || matchingAtts[0]?.tanggal || '-',
      type: 'TIDAK_HADIR',
      status: 'SUBMITTED',
      submittedByUserId: matchingAtts[0]?.createdByUserId || user?.id || user?.userId,
      submittedByName: matchingAtts[0]?.createdByName || user?.name || 'Mantri Bibitan',
      estateId: matchingAtts[0]?.estateId || user?.estateId,
      divisionId: matchingAtts[0]?.divisionId || user?.divisionId,
      totalAbsent: absentWorkers.length,
      detailPekerja: absentWorkers.map(w => ({
        workerId: w.id,
        name: w.name,
        code: w.code,
        absentType: w.absentType || 'C'
      })),
      _isDeterministic: true
    };
  }

  // Fallback: legacy read-only virtual_tidak_hadir
  const virtualList = storage.get('virtual_tidak_hadir', []);
  const vMatch = virtualList.find(item =>
    String(item.id || item.docNo || '') === targetId
  );
  if (vMatch) {
    return { ...vMatch, _storeKey: 'virtual_tidak_hadir' };
  }

  // Fallback default structure with "-" (guardrail: do not invent fake data)
  return {
    id: targetId,
    docNo: targetId,
    date: dateStr || '-',
    type: 'TIDAK_HADIR',
    status: 'SUBMITTED',
    submittedByName: 'Mantri Bibitan',
    estateId: user?.estateId || '-',
    divisionId: user?.divisionId || '-',
    totalAbsent: '-',
    detailPekerja: [],
    _isFallback: true
  };
}

/**
 * Helper mencari source transaction record dan storage key-nya dengan EXACT MATCH referenceType scope
 */
export function findSourceRecord(referenceType, referenceId, userCtx = null) {
  if (!referenceType || !referenceId) return null;
  const targetId = String(referenceId);

  // 1. TIDAK_HADIR special deterministic resolution
  if (referenceType === 'TIDAK_HADIR') {
    return resolveTidakHadirDeterministic(targetId, userCtx);
  }

  const storeKeys = CANONICAL_STORAGE_MAP[referenceType] || [];
  if (storeKeys.length === 0) return null;

  for (const storeKey of storeKeys) {
    const items = storage.get(storeKey, []);
    if (!Array.isArray(items) || items.length === 0) continue;

    // Filter by type if in mixed table like entres_transactions
    let filteredItems = items;
    if (storeKey === 'entres_transactions') {
      if (referenceType === 'MENUNAS') {
        filteredItems = items.filter(t => (t.activityType || t.type || '').toUpperCase() === 'MENUNAS');
      } else if (referenceType === 'TOPPING') {
        filteredItems = items.filter(t => (t.activityType || t.type || '').toUpperCase() === 'TOPPING');
      }
    }

    // 1. Exact match by primary IDs
    let match = filteredItems.find(item =>
      String(item.id || item.requestId || item.dispatchId || item.receiptId || item.selectionId || item.destructionId || '') === targetId
    );
    if (match) return resolveRecordContext(match, storeKey, referenceType);

    // 2. Match by docNo / nomorDokumen / selectionDocNo / issueDocNo
    match = filteredItems.find(item =>
      String(item.docNo || item.nomorDokumen || item.selectionDocNo || item.issueDocNo || '') === targetId
    );
    if (match) return resolveRecordContext(match, storeKey, referenceType);

    // 3. Match by nir
    match = filteredItems.find(item => String(item.nir || '') === targetId);
    if (match) return resolveRecordContext(match, storeKey, referenceType);

    // 4. Match by referenceDocNo / selectionNo / dispatchNo / receiptDocNo / destructionNo
    match = filteredItems.find(item =>
      String(item.referenceDocNo || item.selectionNo || item.dispatchNo || item.receiptDocNo || item.destructionNo || '') === targetId
    );
    if (match) return resolveRecordContext(match, storeKey, referenceType);
  }

  return null;
}

function resolveRecordContext(match, storeKey, referenceType) {
  if (referenceType === 'SELEKSI_PRA_OKULASI' && storeKey === 'selection_transactions') {
    const parentDocs = storage.get('pre_grafting_selection_documents', []);
    const parentDoc = parentDocs.find(p =>
      (match.parentSelectionDocumentId && p.id === match.parentSelectionDocumentId) ||
      (match.selectionDocumentId && p.id === match.selectionDocumentId) ||
      (match.parentSelectionDocNo && p.docNo === match.parentSelectionDocNo) ||
      (match.selectionDocNo && p.docNo === match.selectionDocNo) ||
      (match.docNo && p.docNo === match.docNo) ||
      (match.batchCode && (p.batchCode === match.batchCode || p.batchNo === match.batchCode))
    );
    if (parentDoc) {
      return {
        ...parentDoc,
        ...match,
        _storeKey: storeKey,
        _parentDoc: parentDoc,
        _parentDocId: parentDoc.id,
        totalLayak: parentDoc.totalLayak !== undefined && parentDoc.totalLayak !== null ? parentDoc.totalLayak : (match.totalLayak !== undefined ? match.totalLayak : match.actualBibitRetainedQty),
        totalAfkir: parentDoc.totalAfkir !== undefined && parentDoc.totalAfkir !== null ? parentDoc.totalAfkir : (match.totalAfkir !== undefined ? match.totalAfkir : match.actualBibitSelectedQty),
        totalDiperiksa: parentDoc.totalDiperiksa !== undefined && parentDoc.totalDiperiksa !== null ? parentDoc.totalDiperiksa : (match.totalDiperiksa !== undefined ? match.totalDiperiksa : match.actualPolybagInspectedQty),
        bedengan: match.bedengan || match.bedenganCode || parentDoc.bedengan,
        batchCode: match.batchCode || parentDoc.batchCode
      };
    }
  }
  return { ...match, _storeKey: storeKey };
}

/**
 * Normalisasi data detail transaksi untuk List dan Detail view secara terpusat (Single Source of Truth)
 * Menghilangkan seluruh hardcoded fallback angka (500, 120, 300, 250, 1).
 */
export function getVerificationDetailData(sourceRecord, userCtx = null, referenceType = null) {
  const raw = sourceRecord || {};
  const refType = referenceType || raw.referenceType || raw.type || raw.moduleType || 'PENERIMAAN';
  const res = _computeVerificationDetailData(raw, userCtx, refType);
  if (res && typeof res === 'object') {
    res.returnReason = raw.returnReason || null;
    res.status = raw.status || raw.verificationStatus || null;
  }
  return res;
}

function _computeVerificationDetailData(raw, userCtx = null, refType = 'PENERIMAAN') {
  switch (refType) {
    case 'TIDAK_HADIR': {
      const totalAbsent = raw.totalAbsent !== undefined
        ? raw.totalAbsent
        : (raw.detailPekerja?.length !== undefined ? raw.detailPekerja.length : (raw.absentWorkers?.length !== undefined ? raw.absentWorkers.length : '-'));
      const workers = raw.detailPekerja || raw.absentWorkers || [];
      const info = workers.length > 0 ? workers.map(w => w.name || w.code).join(', ') : (raw.info || '-');
      const summary = totalAbsent !== '-' ? `${totalAbsent} Pekerja Tidak Hadir` : 'Tidak Hadir';

      return {
        title: 'Tidak Hadir',
        info: info || '-',
        mainQty: totalAbsent !== '-' ? `${totalAbsent} Pekerja Tidak Hadir` : '-',
        unit: 'Orang',
        summary,
        fields: [
          { label: 'Total Tidak Hadir', value: totalAbsent !== '-' ? `${totalAbsent} Orang` : '-', highlight: true },
          { label: 'Rincian Pekerja', value: workers.length > 0 ? workers.map(w => `${w.name || '-'} (${w.code || '-'}) · Izin: ${w.absentType || 'C'}`).join('<br>') : (raw.keterangan || '-') }
        ]
      };
    }

    case 'PRESENSI': {
      const totalWorkers = raw.totalWorkers !== undefined ? raw.totalWorkers : (raw.workerCount !== undefined ? raw.workerCount : (raw.totalAbsent !== undefined ? raw.totalAbsent : '-'));
      const formattedWorkers = formatSafeNumber(totalWorkers);
      const presensiStatus = raw.status || raw.type || 'HADIR';
      return {
        title: 'Presensi Pekerja',
        info: `Status: ${presensiStatus}`,
        mainQty: totalWorkers !== '-' ? `${formattedWorkers} Orang` : '-',
        unit: 'Orang',
        summary: `Presensi: ${formattedWorkers} Orang (${presensiStatus})`,
        fields: [
          { label: 'Jumlah Pekerja', value: totalWorkers !== '-' ? `${formattedWorkers} Orang` : '-', highlight: true },
          { label: 'Status Presensi', value: presensiStatus },
          { label: 'Keterangan', value: raw.keterangan || raw.notes || '-' }
        ]
      };
    }

    case 'PENERIMAAN':
    case 'RECEIPT': {
      const rawQty = raw.qty !== undefined
        ? raw.qty
        : (raw.quantity !== undefined ? raw.quantity : (raw.receivedQty !== undefined ? raw.receivedQty : (raw.acceptedQty !== undefined ? raw.acceptedQty : '-')));
      const unit = raw.satuan || raw.unit || 'Butir';
      const hasUnitInRaw = typeof rawQty === 'string' && /[a-zA-Z]/.test(rawQty.trim());
      const safeQtyFormatted = formatSafeNumber(rawQty);
      const formattedDisplayQty = rawQty === '-' ? '-' : (hasUnitInRaw ? rawQty.trim() : `${safeQtyFormatted} ${unit}`);
      const klon = raw.klon || raw.clone || '-';
      const tipeAsal = raw.tipeAsal || raw.asal || raw.sumber || raw.sourceType || 'Kebun Induk';
      const summary = `${formattedDisplayQty} (Klon: ${klon})`;

      return {
        title: 'Penerimaan Benih',
        info: `Klon ${klon} · ${tipeAsal}`,
        mainQty: formattedDisplayQty,
        unit,
        summary,
        fields: [
          { label: 'Klon', value: klon },
          { label: 'Tipe Asal', value: tipeAsal },
          { label: 'Sumber', value: raw.sumber || '-' },
          { label: 'No. SIR', value: raw.sir || '-' },
          { label: 'Jumlah Diterima', value: formattedDisplayQty, highlight: true },
          { label: 'Keterangan', value: raw.keterangan || raw.notes || '-' }
        ]
      };
    }

    case 'PENYEMAIAN':
    case 'SEEDING': {
      const qty = raw.totalDisemai !== undefined ? raw.totalDisemai : (raw.qty !== undefined ? raw.qty : '-');
      const formattedQty = formatSafeNumber(qty);
      const bedengan = raw.bedengan || raw.bedenganCode || '-';
      const batch = raw.batchNo || raw.batchCode || '-';
      const klon = raw.klonAwal || raw.klon || '-';
      const summary = `${formattedQty} Butir di Bedengan ${bedengan} (Batch: ${batch})`;

      const ditolakQty = parseInt(raw.ditolak !== undefined ? raw.ditolak : (raw.jumlahDitolak || 0), 10) || 0;
      const alasanDitolak = raw.alasanDitolak || raw.alasan || '';
      const ditolakDisplay = ditolakQty > 0
        ? `${formatSafeNumber(ditolakQty)} Bibit${alasanDitolak && alasanDitolak !== 'Tidak Ada' ? ` (${alasanDitolak})` : ''}`
        : '0 Bibit';

      return {
        title: 'Penyemaian Benih',
        info: `Batch ${batch} · Bedengan ${bedengan}`,
        mainQty: qty !== '-' ? `${formattedQty} Bibit` : '-',
        unit: 'Bibit',
        summary,
        fields: [
          { label: 'Program', value: raw.program || '-' },
          { label: 'Batch', value: batch },
          { label: 'Bedengan', value: bedengan },
          { label: 'Klon', value: klon },
          { label: 'Total Disemai', value: qty !== '-' ? `${formattedQty} Bibit` : '-', highlight: true },
          { label: 'Total Polybag', value: raw.totalPolybag !== undefined ? `${formatSafeNumber(raw.totalPolybag)} Pkk` : '-' },
          { label: 'Bibit Ditolak', value: ditolakDisplay },
          { label: 'Keterangan', value: raw.keterangan || raw.notes || '-' }
        ]
      };
    }

    case 'DEDERAN': {
      const qty = raw.jumlahDeder !== undefined
        ? raw.jumlahDeder
        : (raw.totalDeder !== undefined ? raw.totalDeder : (raw.qty !== undefined ? raw.qty : '-'));
      const formattedQty = formatSafeNumber(qty);
      const bedengan = raw.bedenganCode || raw.bedengan || '-';
      const klon = raw.klon || raw.varietas || '-';
      const summary = `${formattedQty} Butir Germinasi di Bedengan ${bedengan}`;

      return {
        title: 'Germinasi / Dederan',
        info: `Bedengan ${bedengan} · Klon ${klon}`,
        mainQty: qty !== '-' ? `${formattedQty} Butir Deder` : '-',
        unit: 'Butir',
        summary,
        fields: [
          { label: 'Bedengan', value: bedengan },
          { label: 'Klon', value: klon },
          { label: 'Jumlah Deder', value: qty !== '-' ? `${formattedQty} Butir` : '-', highlight: true },
          { label: 'Keterangan', value: raw.keterangan || raw.notes || '-' }
        ]
      };
    }

    case 'OKULASI':
    case 'BUDDING': {
      const qty = raw.jumlah !== undefined
        ? raw.jumlah
        : (raw.jumlahMataOkulasi !== undefined ? raw.jumlahMataOkulasi : (raw.qty !== undefined ? raw.qty : '-'));
      const formattedQty = formatSafeNumber(qty);
      const typeLabel = raw.type === 'REGRAFTING' ? 'Regrafting' : 'Grafting';
      const bedengan = raw.bedengan || '-';
      const klon = raw.klonEntres || raw.klon || '-';
      const summary = `${formattedQty} Pkk (${typeLabel}) di Bedengan ${bedengan} (Klon: ${klon})`;

      return {
        title: 'Okulasi Bibitan',
        info: `${typeLabel} · Bedengan ${bedengan}`,
        mainQty: qty !== '-' ? `${formattedQty} Pkk` : '-',
        unit: 'Pkk',
        summary,
        fields: [
          { label: 'Tipe Okulasi', value: typeLabel },
          { label: 'Bedengan', value: bedengan },
          { label: 'Klon Entres', value: klon },
          { label: 'Klon Batang Bawah', value: raw.klonRootstock || '-' },
          { label: 'Total Okulasi', value: qty !== '-' ? `${formattedQty} Pkk` : '-', highlight: true },
          { label: 'Mata Entres Digunakan', value: `${formatSafeNumber(raw.jumlahMataEntres ?? raw.jumlah)} Perisai`, highlight: true },
          { label: 'Keterangan', value: raw.keterangan || raw.notes || '-' }
        ]
      };
    }

    case 'PEMERIKSAAN':
    case 'INSPECTION': {
      const checked = raw.totalDiperiksa !== undefined ? raw.totalDiperiksa : (raw.qty !== undefined ? raw.qty : '-');
      const jadi = raw.jumlahJadi !== undefined ? raw.jumlahJadi : '-';
      const gagal = raw.jumlahGagal !== undefined ? raw.jumlahGagal : (checked !== '-' && jadi !== '-' ? Number(checked) - Number(jadi) : '-');
      const pct = raw.persenJadi !== undefined ? raw.persenJadi : (checked !== '-' && jadi !== '-' && Number(checked) > 0 ? Math.round((Number(jadi) / Number(checked)) * 100) : '-');
      const formattedChecked = formatSafeNumber(checked);
      const formattedJadi = formatSafeNumber(jadi);
      const formattedGagal = formatSafeNumber(gagal);
      const bedengan = raw.bedengan || '-';
      const klon = raw.klonEntres || '-';
      const summary = `Periksa: ${formattedChecked} Pkk, Jadi: ${formattedJadi} Pkk (${pct !== '-' ? `${pct}%` : '-'})`;

      return {
        title: 'Pemeriksaan Okulasi',
        info: `Bedengan ${bedengan} · Klon ${klon}`,
        mainQty: checked !== '-' ? `${formattedChecked} Diperiksa` : '-',
        breakdown: `${formattedJadi} Berhasil, ${formattedGagal} Tidak Berhasil`,
        unit: 'Pkk',
        summary,
        fields: [
          { label: 'Bedengan', value: bedengan },
          { label: 'Klon', value: klon },
          { label: 'Total Diperiksa', value: checked !== '-' ? `${formattedChecked} Pkk` : '-' },
          { label: 'Jumlah Berhasil', value: jadi !== '-' ? `${formattedJadi} Pkk` : '-', highlight: true },
          { label: 'Jumlah Tidak Berhasil', value: gagal !== '-' ? `${formattedGagal} Pkk` : '-' },
          { label: 'Persentase Jadi', value: pct !== '-' ? `${pct}%` : '-', highlight: true },
          { label: 'Keterangan', value: raw.keterangan || raw.notes || '-' }
        ]
      };
    }

    case 'PEMERIKSAAN_DEDERAN': {
      const diperiksa = raw.jumlahDiperiksa !== undefined
        ? raw.jumlahDiperiksa
        : (raw.totalDiperiksa !== undefined ? raw.totalDiperiksa : (raw.jumlahDeder !== undefined ? raw.jumlahDeder : '-'));
      const berhasil = raw.jumlahBerhasil !== undefined
        ? raw.jumlahBerhasil
        : (raw.totalLayak !== undefined ? raw.totalLayak : (raw.sproutNormal !== undefined ? raw.sproutNormal : (raw.jumlahLayak !== undefined ? raw.jumlahLayak : '-')));
      const tidakBerhasil = raw.jumlahTidakBerhasil !== undefined
        ? raw.jumlahTidakBerhasil
        : (raw.totalAfkir !== undefined ? raw.totalAfkir : (raw.sproutAfkir !== undefined ? raw.sproutAfkir : (raw.jumlahAfkir !== undefined ? raw.jumlahAfkir : '-')));
      const formattedDiperiksa = formatSafeNumber(diperiksa);
      const formattedBerhasil = formatSafeNumber(berhasil);
      const formattedTidakBerhasil = formatSafeNumber(tidakBerhasil);
      const bedengan = raw.bedenganCode || raw.bedengan || '-';
      const klon = raw.klon || '-';

      // Resolusi Total Di Deder (Populasi Awal Biji di Bedengan)
      let totalDiDeder = raw.jumlahDeder !== undefined && raw.jumlahDeder !== null ? raw.jumlahDeder : null;
      if (!totalDiDeder) {
        try {
          const dederTxs = storage.get('dederan_transactions', []);
          const matchedTx = dederTxs.find(t => 
            (raw.dederanTxDocNo && t.docNo === raw.dederanTxDocNo) ||
            (raw.dederanTxId && t.id === raw.dederanTxId) ||
            (raw.bedenganId && t.bedenganId === raw.bedenganId) ||
            (raw.bedenganCode && t.bedenganCode === raw.bedenganCode)
          );
          if (matchedTx && matchedTx.jumlahDeder) {
            totalDiDeder = matchedTx.jumlahDeder;
          }
        } catch {
          // ignore lookup error
        }
      }
      const formattedTotalDeder = totalDiDeder ? `${formatSafeNumber(totalDiDeder)} Butir` : (diperiksa !== '-' ? `${formattedDiperiksa} Butir` : '-');

      // Perhitungan Persentase Germinasi (% Keberhasilan Berkecambah)
      const numDiperiksa = typeof diperiksa === 'number' ? diperiksa : (parseInt(String(diperiksa).replace(/[^0-9]/g, ''), 10) || 0);
      const numBerhasil = typeof berhasil === 'number' ? berhasil : (parseInt(String(berhasil).replace(/[^0-9]/g, ''), 10) || 0);
      const pctGerminasi = numDiperiksa > 0
        ? `${((numBerhasil / numDiperiksa) * 100).toFixed(2).replace('.', ',')}%`
        : '-';

      const summary = `Bedengan ${bedengan}: ${formattedDiperiksa} Diperiksa, ${formattedBerhasil} Berhasil, ${formattedTidakBerhasil} Tidak Berhasil`;

      return {
        title: 'Pemeriksaan Dederan',
        info: `Bedengan ${bedengan} · Klon ${klon}`,
        mainQty: diperiksa !== '-' ? `${formattedDiperiksa} Diperiksa` : '-',
        breakdown: `${formattedBerhasil} Berhasil, ${formattedTidakBerhasil} Tidak Berhasil`,
        unit: 'Butir',
        summary,
        fields: [
          { label: 'Bedengan', value: bedengan },
          { label: 'Klon', value: klon },
          { label: 'Total Di Deder', value: formattedTotalDeder },
          { label: 'Total Diperiksa', value: diperiksa !== '-' ? `${formattedDiperiksa} Butir` : '-' },
          { label: 'Jumlah Berhasil', value: berhasil !== '-' ? `${formattedBerhasil} Butir` : '-', highlight: true },
          { label: 'Jumlah Tidak Berhasil', value: tidakBerhasil !== '-' ? `${formattedTidakBerhasil} Butir` : '-' },
          { label: 'Persentase Berhasil', value: pctGerminasi, highlight: true },
          { label: 'Keterangan', value: raw.keterangan || raw.notes || '-' }
        ]
      };
    }

    case 'SELEKSI_PRA_OKULASI': {
      const rawStage = String(raw.selectionStage || raw.stage || 'Seleksi I');
      let stage = 'Seleksi I';
      if (rawStage.includes('3') || rawStage.includes('III')) stage = 'Seleksi III';
      else if (rawStage.includes('2') || rawStage.includes('II')) stage = 'Seleksi II';
      else if (rawStage.includes('1') || rawStage.includes('I')) stage = 'Seleksi I';
      else stage = rawStage;
      const layak = raw.totalLayak !== undefined && raw.totalLayak !== null ? raw.totalLayak : (
        raw.finalBibitQty !== undefined && raw.finalBibitQty !== null ? raw.finalBibitQty : (
          raw.actualBibitRetainedQty !== undefined && raw.actualBibitRetainedQty !== null ? raw.actualBibitRetainedQty : (
            raw.bibitDipertahankan !== undefined && raw.bibitDipertahankan !== null ? raw.bibitDipertahankan : (
              raw.jumlahLayak !== undefined && raw.jumlahLayak !== null ? raw.jumlahLayak : '-'
            )
          )
        )
      );
      const afkir = raw.totalAfkir !== undefined && raw.totalAfkir !== null ? raw.totalAfkir : (
        raw.rejectedBibitQty !== undefined && raw.rejectedBibitQty !== null ? raw.rejectedBibitQty : (
          raw.actualBibitSelectedQty !== undefined && raw.actualBibitSelectedQty !== null ? raw.actualBibitSelectedQty : (
            raw.bibitReject !== undefined && raw.bibitReject !== null ? raw.bibitReject : (
              raw.jumlahAfkir !== undefined && raw.jumlahAfkir !== null ? raw.jumlahAfkir : '-'
            )
          )
        )
      );
      const diperiksa = raw.totalDiperiksa !== undefined && raw.totalDiperiksa !== null ? raw.totalDiperiksa : (
        raw.actualPolybagInspectedQty !== undefined && raw.actualPolybagInspectedQty !== null ? raw.actualPolybagInspectedQty : (
          raw.jumlahDiperiksa !== undefined && raw.jumlahDiperiksa !== null ? raw.jumlahDiperiksa : (
            raw.polybagScope !== undefined && raw.polybagScope !== null ? raw.polybagScope : (
              layak !== '-' && afkir !== '-' ? Number(layak) + Number(afkir) : '-'
            )
          )
        )
      );
      const formattedLayak = formatSafeNumber(layak);
      const formattedAfkir = formatSafeNumber(afkir);
      const formattedDiperiksa = formatSafeNumber(diperiksa);
      const numDiperiksa = diperiksa !== '-' ? Number(diperiksa) : 0;
      const numLayak = layak !== '-' ? Number(layak) : 0;
      const pctLayak = (numDiperiksa > 0 && layak !== '-') ? `${Math.round((numLayak / numDiperiksa) * 100)}%` : '-';
      const batch = raw.batchCode || raw.batchNo || '-';
      const bedengan = raw.bedengan || raw.bedenganCode || '-';
      const summary = `${stage}: ${formattedLayak} Layak, ${formattedAfkir} Afkir (Batch: ${batch})`;

      return {
        title: `Seleksi Pra-Okulasi (${stage})`,
        info: `Batch ${batch} · Bedengan ${bedengan}`,
        mainQty: layak !== '-' ? `${formattedLayak} Layak` : '-',
        unit: 'Pkk',
        summary,
        fields: [
          { label: 'Tahap Seleksi', value: stage },
          { label: 'Batch', value: batch },
          { label: 'Bedengan', value: bedengan },
          { label: 'Populasi Diperiksa', value: diperiksa !== '-' ? `${formattedDiperiksa} Pkk` : '-' },
          { label: 'Bibit Layak', value: layak !== '-' ? `${formattedLayak} Pkk` : '-', highlight: true },
          { label: 'Persentase Layak', value: pctLayak, highlight: true },
          { label: 'Bibit Afkir', value: afkir !== '-' ? `${formattedAfkir} Pkk` : '-' },
          { label: 'Keterangan', value: raw.keterangan || raw.notes || raw.catatan || raw.alasan || '-' }
        ]
      };
    }

    case 'PENYELEKSIAN':
    case 'SELECTION': {
      const stage = getSelectionStageLabel(raw);
      let layak = raw.actualBibitRetainedQty !== undefined
        ? raw.actualBibitRetainedQty
        : (raw.bibitDipertahankan !== undefined ? raw.bibitDipertahankan : (raw.jumlahLayak !== undefined ? raw.jumlahLayak : '-'));
      const afkir = raw.actualBibitSelectedQty !== undefined
        ? raw.actualBibitSelectedQty
        : (raw.bibitReject !== undefined ? raw.bibitReject : (raw.jumlahAfkir !== undefined ? raw.jumlahAfkir : '-'));

      const docNoStr = String(raw.docNo || raw.selectionNo || '').toUpperCase();
      const isPreGrafting = isPreGraftingSelection(raw) ||
        docNoStr.includes('/CULL/SEL-I/') || docNoStr.includes('/CULL/SEL-II/') || docNoStr.includes('/CULL/SEL-III/') ||
        docNoStr.includes('/SEL-I') || docNoStr.includes('/SEL-II') || docNoStr.includes('/SEL-III');

      if (isPreGrafting) {
        const allPreDocs = storage.get('pre_grafting_selection_documents', []);
        const parentDoc = allPreDocs.find(d =>
          (raw.parentSelectionDocumentId && d.id === raw.parentSelectionDocumentId) ||
          (raw.selectionDocumentId && d.id === raw.selectionDocumentId) ||
          (raw.parentSelectionDocNo && d.docNo === raw.parentSelectionDocNo) ||
          (raw.selectionDocNo && d.docNo === raw.selectionDocNo) ||
          (raw.sourceDocNo && d.docNo === raw.sourceDocNo) ||
          (raw.batchCode && (d.batchCode === raw.batchCode || d.batchNo === raw.batchCode))
        );
        if (parentDoc) {
          if (parentDoc.totalBibitRetainedQty !== undefined && parentDoc.totalBibitRetainedQty !== null && !isNaN(parentDoc.totalBibitRetainedQty)) {
            layak = parentDoc.totalBibitRetainedQty;
          } else if (parentDoc.sourceBibitQty !== undefined && parentDoc.sourceBibitQty !== null && !isNaN(parentDoc.sourceBibitQty)) {
            const afkirNum = typeof afkir === 'number' ? afkir : parseInt(afkir, 10);
            if (!isNaN(afkirNum)) {
              layak = Math.max(0, parseInt(parentDoc.sourceBibitQty, 10) - afkirNum);
            }
          }
        }
      }

      const isDederan = raw.originType === 'REJECT_DEDERAN' || raw.sourceModule === 'DEDERAN' || docNoStr.includes('/CULL/DDR/') || stage.includes('Dederan');
      if (isDederan && (layak === '-' || Number(layak) === 0)) {
        const allDederIns = storage.get('dederan_inspections', []);
        const matchingIns = allDederIns.find(i =>
          (raw.sourceTransactionId && (i.id === raw.sourceTransactionId || i.docNo === raw.sourceTransactionId)) ||
          (raw.sourceDocNo && (i.docNo === raw.sourceDocNo || i.dederanTxDocNo === raw.sourceDocNo)) ||
          (raw.dederanDocNo && (i.docNo === raw.dederanDocNo || i.dederanTxDocNo === raw.dederanDocNo)) ||
          (raw.bedenganCode && (i.bedenganCode === raw.bedenganCode || i.bedenganId === raw.bedenganCode)) ||
          (raw.bedengan && (i.bedenganCode === raw.bedengan || i.bedenganId === raw.bedengan))
        );
        if (matchingIns) {
          const allDederTxs = storage.get('dederan_transactions', []);
          const dederTx = allDederTxs.find(t => t.docNo === (matchingIns.dederanTxDocNo || matchingIns.docNo) || t.id === matchingIns.dederanTxId);
          if (dederTx) {
            const summary = getBedenganInspectionSummary(dederTx);
            if (summary && summary.totalBerhasil > 0) {
              layak = summary.totalBerhasil;
            } else if (matchingIns.jumlahBerhasil !== undefined && Number(matchingIns.jumlahBerhasil) > 0) {
              layak = matchingIns.jumlahBerhasil;
            }
          } else if (matchingIns.jumlahBerhasil !== undefined && Number(matchingIns.jumlahBerhasil) > 0) {
            layak = matchingIns.jumlahBerhasil;
          }
        } else {
          const allDederTxs = storage.get('dederan_transactions', []);
          const dederTx = allDederTxs.find(t =>
            (raw.bedenganCode && (t.bedenganCode === raw.bedenganCode || t.bedenganId === raw.bedenganCode)) ||
            (raw.bedengan && (t.bedenganCode === raw.bedengan || t.bedenganId === raw.bedengan))
          );
          if (dederTx) {
            const summary = getBedenganInspectionSummary(dederTx);
            if (summary && summary.totalBerhasil > 0) {
              layak = summary.totalBerhasil;
            }
          }
        }
      }

      const formattedLayak = formatSafeNumber(layak);
      const formattedAfkir = formatSafeNumber(afkir);
      const reasonCandidates = [
        raw.alasanDitolakCategory,
        raw.alasanAfkir,
        raw.kategoriAfkir,
        raw.category,
        raw.alasanDetail,
        raw.alasan,
        raw.rejectSourceReference?.reason,
        raw.reason
      ];
      const stageLower = String(stage || '').trim().toLowerCase();
      const isStageLabel = (val) => {
        if (!val) return false;
        const s = String(val).trim().toLowerCase();
        return s === stageLower ||
          s.includes('seleksi pra-semai') ||
          s.includes('seleksi pra-okulasi') ||
          s.includes('seleksi pasca-okulasi') ||
          ['seleksi_pra_semai', 'seleksi_1', 'seleksi_i', 'seleksi_2', 'seleksi_ii', 'seleksi_3', 'seleksi_iii', 'seleksi_pasca_okulasi'].includes(s);
      };

      let reason = '-';
      let foundCandidate = null;
      for (const cand of reasonCandidates) {
        if (!cand) continue;
        const s = String(cand).trim();
        if (s && s !== '-' && s.toLowerCase() !== 'tidak ada' && !isStageLabel(s)) {
          foundCandidate = s;
          break;
        }
      }

      if (foundCandidate) {
        reason = getSelectionCategoryLabel({ ...raw, category: foundCandidate, alasan: foundCandidate }) || foundCandidate;
      } else {
        const catLabel = getSelectionCategoryLabel(raw);
        if (catLabel && catLabel !== 'Afkir' && !isStageLabel(catLabel)) {
          reason = catLabel;
        } else if (afkir !== '-' && Number(afkir) > 0) {
          reason = 'Afkir';
        } else {
          reason = '-';
        }
      }
      const bedengan = raw.bedengan || raw.lokasi || '-';
      const summary = `${stage}: ${formattedLayak} Layak, ${formattedAfkir} Afkir`;

      const rawNotes = raw.keterangan || raw.catatan || raw.notes;
      const isLegacyFallback = Boolean(rawNotes && raw.alasan && String(rawNotes).trim() === String(raw.alasan).trim());
      const displayNotes = (!isLegacyFallback && rawNotes !== undefined && rawNotes !== null && String(rawNotes).trim() !== '' && String(rawNotes).trim() !== '-') ? String(rawNotes).trim() : '-';

      return {
        title: 'Penyeleksian Bibit',
        info: `Kategori ${reason} · Bedengan ${bedengan}`,
        mainQty: afkir !== '-' ? `${formattedAfkir} Bibit Afkir` : '-',
        unit: 'Pkk',
        summary,
        fields: [
          { label: 'Tahap Seleksi', value: stage },
          { label: 'Kategori / Alasan Afkir', value: reason },
          { label: 'Bedengan / Lokasi', value: bedengan },
          { label: 'Bibit Afkir (Selected)', value: afkir !== '-' ? `${formattedAfkir} Pkk` : '-', highlight: true },
          { label: 'Bibit Dipertahankan', value: layak !== '-' ? `${formattedLayak} Pkk` : '-' },
          { label: 'Keterangan', value: displayNotes }
        ]
      };
    }

    case 'TOPPING': {
      const stik = raw.jumlahKayu !== undefined
        ? raw.jumlahKayu
        : (raw.jumlahStik !== undefined ? raw.jumlahStik : (raw.jumlahStikHijau !== undefined ? raw.jumlahStikHijau : (raw.jumlahPokok !== undefined ? raw.jumlahPokok : '-')));
      const perisai = raw.jumlahPerisai !== undefined
        ? raw.jumlahPerisai
        : (raw.jumlahMata !== undefined ? raw.jumlahMata : (raw.jumlahTopping !== undefined ? raw.jumlahTopping : '-'));
      const formattedStik = formatSafeNumber(stik);
      const formattedPerisai = formatSafeNumber(perisai);
      const plot = raw.kodePlot || raw.plotId || raw.plotNo || '-';
      const klon = raw.namaKlon || raw.klon || '-';
      const summary = `${formattedStik} Btg · ${formattedPerisai} Perisai di Plot ${plot} (Klon: ${klon})`;

      return {
        title: 'Entres Topping',
        info: `Plot ${plot} · Klon ${klon}`,
        mainQty: `${stik !== '-' ? `${formattedStik} Btg` : '-'} · ${perisai !== '-' ? `${formattedPerisai} Perisai` : '-'}`,
        unit: 'Btg/Perisai',
        summary,
        fields: [
          { label: 'Plot', value: plot },
          { label: 'Klon', value: klon },
          { label: 'Kebun Entres', value: raw.budwoodCode || '-' },
          { label: 'Jumlah Kayu', value: stik !== '-' ? `${formattedStik} Btg` : '-', highlight: true },
          { label: 'Panen Perisai (Mata Entres)', value: perisai !== '-' ? `${formattedPerisai} Perisai` : '-', highlight: true },
          { label: 'Keterangan', value: raw.keterangan || raw.notes || '-' }
        ]
      };
    }

    case 'MENUNAS': {
      const qty = raw.jumlahPohonDitunas !== undefined
        ? raw.jumlahPohonDitunas
        : (raw.jumlahPokok !== undefined ? raw.jumlahPokok : (raw.jumlahTunas !== undefined ? raw.jumlahTunas : (raw.qty !== undefined ? raw.qty : '-')));
      const formattedQty = formatSafeNumber(qty);
      const plot = raw.kodePlot || raw.plotId || raw.plotNo || '-';
      const klon = raw.namaKlon || raw.klon || '-';
      const summary = `${formattedQty} Pokok Ditunas di Plot ${plot} (Klon: ${klon})`;

      return {
        title: 'Entres Menunas',
        info: `Plot ${plot} · Klon ${klon}`,
        mainQty: qty !== '-' ? `${formattedQty} Pokok Ditunas` : '-',
        unit: 'Pkk',
        summary,
        fields: [
          { label: 'Plot', value: plot },
          { label: 'Klon', value: klon },
          { label: 'Kebun Entres', value: raw.budwoodCode || '-' },
          { label: 'Realisasi Ditunas', value: qty !== '-' ? `${formattedQty} Pkk` : '-', highlight: true },
          { label: 'Keterangan', value: raw.keterangan || raw.notes || '-' }
        ]
      };
    }

    case 'KEBUN_ENTRES':
    case 'ENTRES': {
      if ((raw.activityType || raw.type || '').toUpperCase() === 'MENUNAS' || raw.jumlahPohonDitunas !== undefined) {
        return getVerificationDetailData(raw, userCtx, 'MENUNAS');
      }
      return getVerificationDetailData(raw, userCtx, 'TOPPING');
    }

    case 'MATERIAL': {
      const isSowMaterial = Boolean(raw.issueDocNo || raw.totalPolybag !== undefined || raw.sourceTransactionType === 'PINDAH_SEMAI_MATERIAL' || raw.dederanTxDocNo || raw.sourceDederDocNo);
      const qty = raw.totalPolybag !== undefined
        ? raw.totalPolybag
        : (raw.quantityUsed !== undefined
            ? raw.quantityUsed
            : (raw.qty !== undefined
                ? raw.qty
                : (raw.quantity !== undefined ? raw.quantity : (raw.qtyOut !== undefined ? raw.qtyOut : (raw.currentStock !== undefined ? raw.currentStock : '-')))));
      const formattedQty = formatSafeNumber(qty);
      const unit = raw.uom || raw.unit || raw.satuan || 'LBR';
      const matName = raw.itemName || raw.materialName || raw.name || 'Biaya Polybag';
      const issueDoc = raw.issueDocNo || raw.noIssue || '-';
      const sowDoc = raw.docNo || raw.referenceDocNo || '-';
      const batch = raw.batchCode || raw.batchNo || '-';
      const bedengan = raw.bedenganCode || raw.bedengan || '-';
      const category = raw.category || raw.kategori || (isSowMaterial ? 'Pindah Semai (SOW)' : 'Umum');
      const summary = `${matName}: ${formattedQty} ${unit} (${sowDoc})`;

      const fields = [
        { label: 'Nama Material', value: matName },
        { label: 'No. Dokumen Issue', value: issueDoc },
        { label: 'Dokumen SOW', value: sowDoc },
        { label: 'Batch', value: batch },
        { label: 'Bedengan', value: bedengan },
        { label: 'Jumlah Digunakan', value: qty !== '-' ? `${formattedQty} ${unit}` : '-', highlight: true },
        { label: 'Kategori / Keterangan', value: raw.keterangan || raw.notes || (isSowMaterial ? 'Material Pindah Semai (SOW)' : '-') }
      ];

      return {
        title: 'Material & Bahan',
        info: `${matName} · ${category}`,
        mainQty: qty !== '-' ? `${formattedQty} ${unit}` : '-',
        unit,
        summary,
        fields
      };
    }

    case 'SIMULASI_GUDANG': {
      const qty = raw.qty !== undefined ? raw.qty : (raw.quantity !== undefined ? raw.quantity : '-');
      const formattedQty = formatSafeNumber(qty);
      const unit = raw.unit || 'Unit';
      const itemName = raw.itemName || raw.materialName || '-';
      const issueDoc = raw.issueDocNo || raw.docNo || '-';
      const summary = `Issue ${itemName}: ${formattedQty} ${unit}`;

      return {
        title: 'Simulasi Issue Gudang',
        info: `No ${issueDoc} · ${itemName}`,
        mainQty: qty !== '-' ? `${formattedQty} ${unit}` : '-',
        unit,
        summary,
        fields: [
          { label: 'No. Issue Gudang', value: issueDoc },
          { label: 'Nama Item / Barang', value: itemName },
          { label: 'Jumlah Issue', value: qty !== '-' ? `${formattedQty} ${unit}` : '-', highlight: true },
          { label: 'Keterangan', value: raw.keterangan || raw.notes || '-' }
        ]
      };
    }

    case 'PEMELIHARAAN':
    case 'REKAM_PEMELIHARAAN':
    case 'NURSERY_ACTIVITY': {
      const actName = raw.aktivitas?.nama || raw.activityType || 'Pemeliharaan';
      const workers = Array.isArray(raw.pekerja) ? raw.pekerja : [];
      const workerResultTotal = workers.reduce((total, worker) =>
        total + (Number(worker.inputHasil ?? worker.result ?? worker.quantity) || 0), 0);
      const hasWorkerResults = workers.some((worker) =>
        worker.inputHasil !== undefined || worker.result !== undefined || worker.quantity !== undefined);
      const vol = hasWorkerResults
        ? workerResultTotal
        : (raw.volumePkk !== undefined
          ? raw.volumePkk
          : (raw.aktivitas?.volume !== undefined ? raw.aktivitas?.volume : (raw.volume !== undefined ? raw.volume : (raw.qty !== undefined ? raw.qty : '-'))));
      const formattedVol = formatSafeNumber(vol);
      const loc = raw.bedengan || raw.location || raw.lokasiBlok || raw.blok || '-';
      const uom = raw.uomCode || raw.uom || raw.aktivitas?.uom || 'Pkk';
      const roleCode = raw.workGroupRoleCode || raw.workGroup?.roleCode || raw.workGroup?.workGroupRoleCode || '-';
      const allocation = raw.allocationName || raw.workGroupRoleName || raw.aktivitas?.nama || actName;
      const summary = `${allocation} - ${roleCode} (${formattedVol} ${uom})`;

      return {
        title: 'Rekam Pemeliharaan',
        info: `${allocation} · ${roleCode}`,
        mainQty: vol !== '-' ? `${formattedVol} ${uom}` : '-',
        unit: uom,
        summary,
        fields: [
          { label: 'Work Group Role Code', value: roleCode },
          { label: 'Alokasi Kerja', value: allocation },
          { label: 'Lokasi / Bedengan', value: loc },
          { label: 'Volume Realisasi', value: vol !== '-' ? `${formattedVol} ${uom}` : '-', highlight: true },
          { label: 'Keterangan', value: raw.keterangan || raw.notes || '-' }
        ]
      };
    }

    case 'PENGELUARAN':
    case 'DISPATCH': {
      const qty = raw.issuedQty !== undefined
        ? raw.issuedQty
        : (raw.qtyDispatched !== undefined ? raw.qtyDispatched : (raw.quantity !== undefined ? raw.quantity : (raw.qty !== undefined ? raw.qty : (raw.totalBatang !== undefined ? raw.totalBatang : '-'))));
      const formattedQty = formatSafeNumber(qty);
      const clone = raw.clone || raw.klon || '-';
      const destination = raw.targetDivisionName || raw.targetEstateId || raw.destination || raw.targetDivision || raw.targetEstate || '-';
      const plate = raw.vehiclePlate || '-';
      const summary = `Dispatch: ${formattedQty} Pkk ke ${destination} (Klon: ${clone})`;

      return {
        title: 'Pengeluaran Bibit',
        info: `Tujuan ${destination} · Klon ${clone}`,
        mainQty: qty !== '-' ? `${formattedQty} Pkk` : '-',
        unit: 'Pkk',
        summary,
        fields: [
          { label: 'Klon', value: clone },
          { label: 'Tujuan Pengiriman', value: destination },
          { label: 'Jumlah Pengeluaran', value: qty !== '-' ? `${formattedQty} Pkk` : '-', highlight: true },
          { label: 'Kendaraan / Plat', value: plate },
          { label: 'Keterangan', value: raw.keterangan || raw.notes || '-' }
        ]
      };
    }

    case 'DESTRUCTION': {
      const qty = raw.qty !== undefined ? raw.qty : (raw.destructionQty !== undefined ? raw.destructionQty : (raw.jumlah !== undefined ? raw.jumlah : '-'));
      const formattedQty = formatSafeNumber(qty);
      const batch = raw.batchId || raw.batchCode || '-';
      const reason = raw.reason || raw.alasan || '-';
      const summary = `Pemusnahan: ${formattedQty} Pkk (Batch: ${batch})`;

      return {
        title: 'Pemusnahan Bibit',
        info: `Batch ${batch} · Alasan ${reason}`,
        mainQty: qty !== '-' ? `${formattedQty} Pkk` : '-',
        unit: 'Pkk',
        summary,
        fields: [
          { label: 'Batch', value: batch },
          { label: 'Alasan Pemusnahan', value: reason },
          { label: 'Jumlah Dimusnahkan', value: qty !== '-' ? `${formattedQty} Pkk` : '-', highlight: true },
          { label: 'Keterangan', value: raw.keterangan || raw.notes || '-' }
        ]
      };
    }

    default: {
      const qty = raw.qty !== undefined ? raw.qty : (raw.quantity !== undefined ? raw.quantity : '-');
      const formattedQty = formatSafeNumber(qty);
      const unit = raw.unit || raw.satuan || 'Pkk';
      const title = REFERENCE_TYPE_LABELS[refType] || refType || 'Transaksi';
      const summary = qty !== '-' ? `${formattedQty} ${unit}` : title;

      return {
        title,
        info: raw.docNo || raw.id || '-',
        mainQty: qty !== '-' ? `${formattedQty} ${unit}` : '-',
        unit,
        summary,
        fields: [
          { label: 'Nomor Referensi', value: raw.docNo || raw.id || '-' },
          { label: 'Kuantitas', value: qty !== '-' ? `${formattedQty} ${unit}` : '-', highlight: true },
          { label: 'Keterangan', value: raw.keterangan || raw.notes || '-' }
        ]
      };
    }
  }
}

/**
 * Evaluasi konsistensi khusus untuk 1 record spesifik
 */
export function evaluateRecordConsistency(referenceType, record, fullDataset = null) {
  const errors = [];
  const warnings = [];

  if (!record) {
    errors.push({ type: 'INVALID_RECORD', severity: 'ERROR', message: 'Record referensi tidak valid / tidak ditemukan.' });
    return { isValid: false, canApprove: false, errors, warnings };
  }

  const docNo = record.docNo || record.nir || record.dispatchNo || record.receiptDocNo || record.selectionNo || record.destructionNo || record.id;

  // Validasi spesifik per tipe referensi
  if (referenceType === REFERENCE_TYPES.DISPATCH || referenceType === 'PENGELUARAN') {
    const dataset = fullDataset || getConsolidatedData(null);
    if (record.parentRequestId && !dataset.requests.some(r => r.id === record.parentRequestId || r.docNo === record.parentRequestId)) {
      errors.push({ type: 'ORPHAN_DISPATCH', severity: 'ERROR', message: `Parent Request (${record.parentRequestId}) tidak ditemukan.` });
    }
  } else if (referenceType === REFERENCE_TYPES.RECEIPT || referenceType === 'PENERIMAAN') {
    const dataset = fullDataset || getConsolidatedData(null);
    if (record.dispatchId && !dataset.dispatches.some(d => d.id === record.dispatchId || d.docNo === record.dispatchId || d.dispatchNo === record.dispatchId)) {
      errors.push({ type: 'ORPHAN_RECEIPT', severity: 'ERROR', message: `Dispatch referensi (${record.dispatchId}) tidak ditemukan.` });
    }
  } else if (referenceType === REFERENCE_TYPES.SELECTION || referenceType === REFERENCE_TYPES.DESTRUCTION || referenceType === 'PENYELEKSIAN' || referenceType === 'SELECTION') {
    try { syncAllDederanRejectionsToSelectionPool(); } catch (_) {}
    const dataset = fullDataset || getConsolidatedData(null);
    const bId = record.batchId || record.batchCode || record.batchNo;
    const batchExists = dataset.batches.some(b => b.id === bId || b.batchCode === bId || b.batchNo === bId);
    if (bId && !batchExists) {
      errors.push({ type: 'INVALID_BATCH_REFERENCE', severity: 'ERROR', message: `Batch ${bId} tidak terdaftar di nursery_batches.` });
    }

    const physicalStockValidation = validatePhysicalStockCullSelection(record);
    if (!physicalStockValidation.isValid) {
      errors.push({
        type: 'STALE_PHYSICAL_STOCK_INSPECTION',
        severity: 'ERROR',
        message: physicalStockValidation.reason || 'Pemeriksaan stok fisik sumber sudah tidak valid.'
      });
    }

    // Validasi konsistensi dinamis terhadap dokumen sumber terbaru
    const selValidation = validateSelectionTransactionAgainstSource(record);
    if (!selValidation.isValid) {
      errors.push({
        type: 'STALE_SOURCE_QUANTITY',
        severity: 'ERROR',
        message: selValidation.reason || 'Dokumen sumber telah mengalami koreksi kuantitas setelah transaksi ini diajukan.'
      });
    }
  } else if (referenceType === REFERENCE_TYPES.PEMERIKSAAN_DEDERAN || referenceType === 'PEMERIKSAAN_DEDERAN') {
    const dederTxDocNo = record.dederanTxDocNo || record.dederanTxId;
    if (dederTxDocNo) {
      const dederTxs = storage.get('dederan_transactions', []);
      const parentDeder = dederTxs.find(t => (t.docNo && t.docNo === dederTxDocNo) || t.id === dederTxDocNo);
      if (parentDeder) {
        const diperiksa = parseInt(record.jumlahDiperiksa || 0, 10);
        const maxAllowed = getInspectionChronologicalMaxAllowed(parentDeder, record);
        if (maxAllowed >= 0 && diperiksa > maxAllowed) {
          errors.push({
            type: 'STALE_SOURCE_QUANTITY',
            severity: 'ERROR',
            message: `Jumlah diperiksa (${diperiksa.toLocaleString('id-ID')}) melebihi kuota kronologis terbaru (${maxAllowed.toLocaleString('id-ID')}).`
          });
        }
      }
    }
  } else if (referenceType === REFERENCE_TYPES.PENYEMAIAN || referenceType === 'PENYEMAIAN' || referenceType === 'SEEDING') {
    const dederDocNo = record.dederanTxDocNo || record.sourceDocNo || record.sourceReceiptDocNo;
    if (dederDocNo) {
      const dederTxs = storage.get('dederan_transactions', []);
      const parentDeder = dederTxs.find(t => (t.docNo && t.docNo === dederDocNo) || t.id === dederDocNo);
      if (parentDeder) {
        const parentQty = parseInt(parentDeder.jumlahDeder || parentDeder.jumlahKecambahDitanam || 0, 10);
        const seedingTxs = storage.get('seeding_transactions', []);
        let otherApprovedQty = 0;
        seedingTxs.forEach(s => {
          if (!s || s.id === record.id || s.docNo === record.docNo) return;
          const isRef = (s.dederanTxDocNo && s.dederanTxDocNo === dederDocNo) || (s.sourceDocNo && s.sourceDocNo === dederDocNo);
          const isApproved = String(s.status || '').toUpperCase() === 'DISETUJUI' || String(s.status || '').toUpperCase() === 'TERVERIFIKASI';
          if (isRef && isApproved) {
            otherApprovedQty += parseInt(s.jumlahBibitDipindahkan || s.totalDisemai || s.qty || 0, 10);
          }
        });
        const maxAvailable = Math.max(0, parentQty - otherApprovedQty);
        const thisQty = parseInt(record.jumlahBibitDipindahkan || record.totalDisemai || record.qty || 0, 10);
        if (thisQty > maxAvailable) {
          errors.push({
            type: 'STALE_SOURCE_QUANTITY',
            severity: 'ERROR',
            message: `Jumlah bibit dipindahkan (${thisQty.toLocaleString('id-ID')}) melebihi sisa kuota Dederan sumber terbaru (${maxAvailable.toLocaleString('id-ID')}).`
          });
        }
      }
    }
  } else if (referenceType === REFERENCE_TYPES.BUDDING || referenceType === 'BUDDING' || referenceType === 'OKULASI') {
    const isRegrafting = record.isRegrafting || record.type === 'REGRAFTING' || record.jenisOkulasi === 'OKULASI_JANDA' || record.jenisOkulasi === 'Regrafting' || (record.docNo && String(record.docNo).includes('RGRF'));
    if (isRegrafting) {
      const poolList = storage.get('regrafting_pool', []);
      const refPool = poolList.find(p => 
        (record.sourceInspectionDocNo && (p.inspectionDocNo === record.sourceInspectionDocNo || p.docNo === record.sourceInspectionDocNo)) ||
        (record.poolId && p.id === record.poolId) ||
        (record.batchId && (p.batchId === record.batchId || p.batchNo === record.batchNo)) ||
        (record.bedenganCode && (p.bedenganCode === record.bedenganCode || p.bedenganName === record.bedenganCode))
      );
      if (refPool) {
        const availablePoolQty = parseInt(refPool.quantity !== undefined ? refPool.quantity : (refPool.availableQty !== undefined ? refPool.availableQty : refPool.sisa || 0), 10);
        const reqQty = parseInt(record.jumlahOkulasi !== undefined ? record.jumlahOkulasi : (record.totalOkulasi !== undefined ? record.totalOkulasi : record.jumlahBatangOkulasi || 0), 10);
        if (reqQty > availablePoolQty && availablePoolQty >= 0) {
          errors.push({
            type: 'STALE_POOL_QUANTITY',
            severity: 'ERROR',
            message: `Kuantitas Okulasi Janda (${reqQty.toLocaleString('id-ID')}) melebihi saldo Regrafting Pool yang tersedia (${availablePoolQty.toLocaleString('id-ID')}).`
          });
        }
      }
    }
  }

  const canApprove = errors.length === 0;

  return {
    isValid: errors.length === 0,
    canApprove,
    errors,
    warnings,
    docNo
  };
}

/**
 * Resolves parent Seleksi Pra-Okulasi docNo for deduplicating verification cards
 */
function resolvePraOkulasiParentDocNo(v, userCtx = null) {
  if (!v) return null;
  const refDocNo = String(v.referenceDocNo || '').trim();
  if (refDocNo.match(/^2026\/SEL\/\d+$/i)) {
    return refDocNo;
  }
  if (v.parentSelectionDocNo && String(v.parentSelectionDocNo).match(/^2026\/SEL\/\d+$/i)) {
    return v.parentSelectionDocNo;
  }
  const isCullOrChild = (
    refDocNo.includes('/CULL/SEL') ||
    refDocNo.match(/^2026\/SEL-[I|II|III]/i) ||
    v.referenceType === 'SELEKSI_PRA_OKULASI'
  );
  if (isCullOrChild) {
    const src = findSourceRecord(v.referenceType, v.referenceId, userCtx) || findSourceRecord('SELEKSI_PRA_OKULASI', refDocNo, userCtx);
    if (src) {
      if (src.parentSelectionDocNo && String(src.parentSelectionDocNo).match(/^2026\/SEL\/\d+$/i)) {
        return src.parentSelectionDocNo;
      }
      if (src.selectionDocNo && String(src.selectionDocNo).match(/^2026\/SEL\/\d+$/i)) {
        return src.selectionDocNo;
      }
      if (src.sourceDocNo && String(src.sourceDocNo).match(/^2026\/SEL\/\d+$/i)) {
        return src.sourceDocNo;
      }
      if (src.docNo && String(src.docNo).match(/^2026\/SEL\/\d+$/i)) {
        return src.docNo;
      }
    }
  }
  return null;
}

/**
 * Mengambil daftar record yang actionable (menunggu verifikasi) dalam scope ASB.
 * 
 * SOURCE: verification_transactions
 * FILTER: ROLE AKTIF (ASISTEN_BIBITAN) + ESTATE AKTIF + DIVISI AKTIF
 * EXCLUDE: REQUEST
 */
export function getActionableRecordsForAsb(currentUser, filters = {}) {
  const allVerifRecords = getAllVerifications();

  // Deduplicate: ambil verifikasi terbaru per (referenceType:referenceId)
  // Untuk dokumen seleksi (2026/SEL/xxx, child CULL, child execution), satukan key ke 'SELEKSI_PRA_OKULASI:<parentDocNo>'
  // agar Dokumen Induk dan Transaksi Seleksi lama/anak tidak menduplikasi kartu di ASB
  const latestMap = new Map();
  allVerifRecords.forEach(v => {
    const parentDocNo = resolvePraOkulasiParentDocNo(v, currentUser);
    const key = parentDocNo ? `SELEKSI_PRA_OKULASI:${parentDocNo}` : `${v.referenceType}:${v.referenceId}`;
    if (!latestMap.has(key)) {
      latestMap.set(key, v);
    } else {
      const existing = latestMap.get(key);
      const isVParent = String(v.referenceDocNo || '') === parentDocNo || v.referenceType === 'SELEKSI_PRA_OKULASI';
      const isExistParent = String(existing.referenceDocNo || '') === parentDocNo || existing.referenceType === 'SELEKSI_PRA_OKULASI';
      if (isVParent && !isExistParent) {
        latestMap.set(key, v);
      } else if (isVParent === isExistParent) {
        const vTime = new Date(v.updatedAt || v.submittedAt || v.createdAt || 0).getTime();
        const existTime = new Date(existing.updatedAt || existing.submittedAt || existing.createdAt || 0).getTime();
        if (vTime >= existTime) {
          latestMap.set(key, v);
        }
      }
    }
  });

  const actionableList = [];

  latestMap.forEach((verifRecord) => {
    if (['DIBATALKAN', 'DITARIK', 'WITHDRAWN'].includes(String(verifRecord.verificationStatus || '').toUpperCase())) return;
    let refType = verifRecord.referenceType;
    let refId = verifRecord.referenceId;
    const docNo = verifRecord.referenceDocNo || refId;
    const parentDocNo = resolvePraOkulasiParentDocNo(verifRecord, currentUser);
    const isSelDoc = Boolean(
      parentDocNo ||
      String(docNo || '').match(/^2026\/SEL(-[I|V|X]+)?\/\d+$/i) ||
      verifRecord.referenceType === 'SELEKSI_PRA_OKULASI'
    );
    if (isSelDoc) {
      refType = 'SELEKSI_PRA_OKULASI';
    }

    // 1. Exclude logistics types (REQUEST)
    if (LOGISTICS_TYPES.includes(refType)) return;

    // 2. Jika sudah TERVERIFIKASI final atau DIKEMBALIKAN, tidak actionable lagi untuk pending queue Asisten
    if (
      verifRecord.verificationStatus === VERIFICATION_STATUS.TERVERIFIKASI ||
      verifRecord.verificationStatus === VERIFICATION_STATUS.DATA_TERKONFIRMASI ||
      verifRecord.verificationStatus === VERIFICATION_STATUS.DIKEMBALIKAN ||
      verifRecord.verificationStatus === 'REVISION' ||
      verifRecord.verificationStatus === 'DIKEMBALIKAN'
    ) return;

    // 3. Resolve source record untuk enrichment & scope check
    let sourceRecord = findSourceRecord(refType, refId, currentUser);
    if (!sourceRecord && isSelDoc) {
      sourceRecord = findSourceRecord('SELEKSI_PRA_OKULASI', parentDocNo || docNo, currentUser);
    }
    const rawRecord = sourceRecord || verifRecord;

    // Filter out pure child execution transactions & child cull records (e.g. PELAKSANAAN_SELEKSI_I, 2026/SEL-I/xxx, 2026/CULL/SEL-xxx)
    // Transaksi eksekusi pelaksanaan / afkir anak bukanlah kartu audit mandiri terpisah, melainkan bagian dari Dokumen Induk
    if (rawRecord.transactionType && String(rawRecord.transactionType).startsWith('PELAKSANAAN_SELEKSI')) {
      return;
    }
    if ((rawRecord.parentSelectionDocNo || rawRecord.parentSelectionDocumentId) && docNo !== rawRecord.parentSelectionDocNo) {
      return;
    }
    if (String(docNo || '').includes('/CULL/SEL') && (rawRecord.parentSelectionDocNo || rawRecord.sourceDocNo || rawRecord.selectionDocNo)) {
      return;
    }

    // Jika source record berstatus DIKEMBALIKAN / REVISION, tidak actionable untuk pending queue Asisten
    const rawStatusNorm = String(rawRecord.status || '').toUpperCase();

    if (refType === 'MATERIAL') {
      if (rawRecord.materialSubmissionStatus === 'DIKEMBALIKAN') return;
      if (!rawRecord.materialSubmissionStatus && (rawRecord.status === 'DIKEMBALIKAN' || rawRecord.status === 'REVISION')) return;

      // Pengamanan ASB Approval untuk Material:
      if (rawRecord.materialSubmissionStatus === 'DISETUJUI') return;
      if (!rawRecord.materialSubmissionStatus && (rawStatusNorm === 'DISETUJUI' && rawRecord.isFinal)) return;
      if (rawRecord.materialVerificationStatus === VERIFICATION_STATUS.TERVERIFIKASI || rawRecord.materialVerificationStatus === 'DATA_TERKONFIRMASI') return;
    } else {
      if (rawRecord.status === 'DIKEMBALIKAN' || rawRecord.status === 'REVISION') return;

      // 4. PENGAMANAN ASB APPROVAL: Jika dokumen sumber sudah disetujui sah & final, jangan hitung sebagai pending!
      if (rawStatusNorm === 'DISETUJUI' && rawRecord.isFinal) return;
      if (rawRecord.verificationStatus === VERIFICATION_STATUS.TERVERIFIKASI || rawRecord.verificationStatus === 'DATA_TERKONFIRMASI') return;
    }

    const estateId = verifRecord.estateId || rawRecord.targetEstateId || rawRecord.estateId || rawRecord.sourceEstateId;
    const divisionId = verifRecord.divisionId || rawRecord.targetDivisionId || rawRecord.divisionId || rawRecord.sourceDivisionId;

    // 5. ROLE + ESTATE + DIVISION ISOLATION
    if (currentUser?.role && normalizeRole(currentUser.role) === ROLES.ASISTEN_BIBITAN) {
      if (currentUser.estateId && estateId && estateId !== currentUser.estateId) return;
      if (currentUser.divisionId && divisionId && divisionId !== currentUser.divisionId) return;
    } else if (currentUser?.estateId && estateId && estateId !== currentUser.estateId) {
      return;
    }

    // 6. Evaluate consistency
    let evalResult = { canApprove: true, errors: [], warnings: [] };
    if (sourceRecord) {
      try {
        evalResult = evaluateRecordConsistency(refType, sourceRecord);
      } catch (_) {
        // Operational types default to clean
      }
    }

    // 6. Extract date
    const dateValue = rawRecord.date || rawRecord.tanggal || rawRecord.tanggalSeleksi || rawRecord.tanggalDeder ||
      rawRecord.tanggalOkulasi || rawRecord.tanggalPemeriksaan || rawRecord.tanggalTopping || rawRecord.tanggalTunas ||
      rawRecord.activityDate || rawRecord.attendanceDate || rawRecord.dispatchDate || rawRecord.receiptDate ||
      verifRecord.submittedAt || verifRecord.createdAt;

    // 7. Find canonical module category
    const matchedModule = VERIFICATION_10_MODULES.find(m => m.types.includes(refType) || m.id === refType);
    const moduleCategory = matchedModule ? matchedModule.id : refType;

    // 8. Single canonical normalization
    const normalizedData = getVerificationDetailData(sourceRecord || rawRecord, currentUser, refType);

    actionableList.push({
      referenceType: refType,
      referenceId: refId,
      referenceDocNo: docNo,
      moduleCategory,
      rawRecord: sourceRecord || rawRecord,
      normalizedData,
      summary: normalizedData.summary,
      estateId,
      divisionId,
      currentStatus: rawRecord.status || verifRecord.verificationStatus || 'SUBMITTED',
      verificationStatus: verifRecord.verificationStatus || VERIFICATION_STATUS.MENUNGGU_VERIFIKASI,
      latestVerification: verifRecord,
      canApprove: evalResult.canApprove,
      errors: evalResult.errors,
      warnings: evalResult.warnings,
      date: dateValue,
      submittedByName: verifRecord.submittedByName || rawRecord.mantri || rawRecord.submittedByName || 'Mantri Bibitan',
      submittedAt: verifRecord.submittedAt || verifRecord.createdAt
    });
  });

  // Filter tambahan jika ada
  return actionableList.filter(item => {
    if (filters.estateId && item.estateId !== filters.estateId) return false;
    if (filters.divisionId && item.divisionId !== filters.divisionId) return false;
    if (filters.moduleCategory && filters.moduleCategory !== 'ALL' && item.moduleCategory !== filters.moduleCategory) return false;
    if (filters.referenceType && filters.referenceType !== 'ALL' && item.referenceType !== filters.referenceType) return false;
    if (filters.status && filters.status !== 'ALL' && item.verificationStatus !== filters.status) return false;
    if (filters.date) {
      const itemDateStr = String(item.date || '').substring(0, 10);
      const filterDateStr = String(filters.date).substring(0, 10);
      if (itemDateStr && filterDateStr && !itemDateStr.includes(filterDateStr) && !filterDateStr.includes(itemDateStr)) return false;
    }
    return true;
  });
}

/**
 * Menghitung jumlah record pending verifikasi untuk notifikasi
 */
export function getPendingVerificationCount(currentUser) {
  if (!currentUser) return 0;
  const list = getActionableRecordsForAsb(currentUser);
  return list.length;
}

/**
 * Mengambil seluruh catatan verifikasi dalam scope ASB (Pending, Dikembalikan, Terverifikasi)
 * Digunakan untuk Transaction List View pada layar per modul.
 */
export function getVerificationRecordsByScope(currentUser, filters = {}) {
  const allVerifRecords = getAllVerifications();

  // Deduplicate: ambil verifikasi terbaru per (referenceType:referenceId)
  // Untuk dokumen seleksi (2026/SEL/xxx, child CULL, child execution), satukan key ke 'SELEKSI_PRA_OKULASI:<parentDocNo>'
  // agar Dokumen Induk dan Transaksi Seleksi lama/anak tidak menduplikasi kartu di ASB
  const latestMap = new Map();
  allVerifRecords.forEach(v => {
    const parentDocNo = resolvePraOkulasiParentDocNo(v, currentUser);
    const key = parentDocNo ? `SELEKSI_PRA_OKULASI:${parentDocNo}` : `${v.referenceType}:${v.referenceId}`;
    if (!latestMap.has(key)) {
      latestMap.set(key, v);
    } else {
      const existing = latestMap.get(key);
      const isVParent = String(v.referenceDocNo || '') === parentDocNo || v.referenceType === 'SELEKSI_PRA_OKULASI';
      const isExistParent = String(existing.referenceDocNo || '') === parentDocNo || existing.referenceType === 'SELEKSI_PRA_OKULASI';
      if (isVParent && !isExistParent) {
        latestMap.set(key, v);
      } else if (isVParent === isExistParent) {
        const vTime = new Date(v.updatedAt || v.submittedAt || v.createdAt || 0).getTime();
        const existTime = new Date(existing.updatedAt || existing.submittedAt || existing.createdAt || 0).getTime();
        if (vTime >= existTime) {
          latestMap.set(key, v);
        }
      }
    }
  });

  const list = [];

  latestMap.forEach((verifRecord) => {
    if (['DIBATALKAN', 'DITARIK', 'WITHDRAWN'].includes(String(verifRecord.verificationStatus || '').toUpperCase())) return;
    let refType = verifRecord.referenceType;
    let refId = verifRecord.referenceId;
    const docNo = verifRecord.referenceDocNo || refId;
    const parentDocNo = resolvePraOkulasiParentDocNo(verifRecord, currentUser);
    const isSelDoc = Boolean(
      parentDocNo ||
      String(docNo || '').match(/^2026\/SEL(-[I|V|X]+)?\/\d+$/i) ||
      verifRecord.referenceType === 'SELEKSI_PRA_OKULASI'
    );
    if (isSelDoc) {
      refType = 'SELEKSI_PRA_OKULASI';
    }

    // Exclude logistics types (REQUEST)
    if (LOGISTICS_TYPES.includes(refType)) return;

    let sourceRecord = findSourceRecord(refType, refId, currentUser);
    if (!sourceRecord && isSelDoc) {
      sourceRecord = findSourceRecord('SELEKSI_PRA_OKULASI', parentDocNo || docNo, currentUser);
    }
    const rawRecord = sourceRecord || verifRecord;

    // Filter out pure child execution transactions & child cull records (e.g. PELAKSANAAN_SELEKSI_I, 2026/SEL-I/xxx, 2026/CULL/SEL-xxx)
    // Transaksi eksekusi pelaksanaan / afkir anak bukanlah kartu audit mandiri terpisah, melainkan bagian dari Dokumen Induk
    if (rawRecord.transactionType && String(rawRecord.transactionType).startsWith('PELAKSANAAN_SELEKSI')) {
      return;
    }
    if ((rawRecord.parentSelectionDocNo || rawRecord.parentSelectionDocumentId) && docNo !== rawRecord.parentSelectionDocNo) {
      return;
    }
    if (String(docNo || '').includes('/CULL/SEL') && (rawRecord.parentSelectionDocNo || rawRecord.sourceDocNo || rawRecord.selectionDocNo)) {
      return;
    }

    const estateId = verifRecord.estateId || rawRecord.targetEstateId || rawRecord.estateId || rawRecord.sourceEstateId;
    const divisionId = verifRecord.divisionId || rawRecord.targetDivisionId || rawRecord.divisionId || rawRecord.sourceDivisionId;

    // ROLE + ESTATE + DIVISION ISOLATION
    if (currentUser?.role && normalizeRole(currentUser.role) === ROLES.ASISTEN_BIBITAN) {
      if (currentUser.estateId && estateId && estateId !== currentUser.estateId) return;
      if (currentUser.divisionId && divisionId && divisionId !== currentUser.divisionId) return;
    } else if (currentUser?.estateId && estateId && estateId !== currentUser.estateId) {
      return;
    }

    let evalResult = { canApprove: true, errors: [], warnings: [] };
    if (sourceRecord) {
      try {
        evalResult = evaluateRecordConsistency(refType, sourceRecord);
      } catch (_) {
        // Operational types default to clean
      }
    }

    const dateValue = rawRecord.date || rawRecord.tanggal || rawRecord.tanggalSeleksi || rawRecord.tanggalDeder ||
      rawRecord.tanggalOkulasi || rawRecord.tanggalPemeriksaan || rawRecord.tanggalTopping || rawRecord.tanggalTunas ||
      rawRecord.activityDate || rawRecord.attendanceDate || rawRecord.dispatchDate || rawRecord.receiptDate ||
      verifRecord.submittedAt || verifRecord.createdAt;

    const matchedModule = VERIFICATION_10_MODULES.find(m => m.types.includes(refType) || m.id === refType);
    const moduleCategory = matchedModule ? matchedModule.id : refType;

    const normalizedData = getVerificationDetailData(sourceRecord || rawRecord, currentUser, refType);

    let effectiveVerifStatus = verifRecord.verificationStatus || VERIFICATION_STATUS.MENUNGGU_VERIFIKASI;

    if (refType === 'MATERIAL') {
      const matStatusNorm = String(rawRecord.materialSubmissionStatus || rawRecord.status || '').toUpperCase();
      if (matStatusNorm === 'DISETUJUI') {
        effectiveVerifStatus = VERIFICATION_STATUS.TERVERIFIKASI;
      } else if (
        (matStatusNorm === 'MENUNGGU_VERIFIKASI' || matStatusNorm === 'MENUNGGU_VERIFIKASI_ASISTEN_BIBITAN' || matStatusNorm === 'SUBMITTED' || rawRecord.materialSubmissionStatus === 'SUBMITTED_TO_ASB') &&
        effectiveVerifStatus === VERIFICATION_STATUS.DIKEMBALIKAN
      ) {
        effectiveVerifStatus = VERIFICATION_STATUS.MENUNGGU_VERIFIKASI;
      }
    } else {
      const rawStatusNorm = String(rawRecord.status || '').toUpperCase();
      // Sinkronisasi status bila dokumen sudah disetujui final
      if (rawStatusNorm === 'DISETUJUI' && rawRecord.isFinal) {
        effectiveVerifStatus = VERIFICATION_STATUS.TERVERIFIKASI;
      } else if (
        (rawStatusNorm === 'MENUNGGU_VERIFIKASI' || rawStatusNorm === 'MENUNGGU_VERIFIKASI_ASISTEN_BIBITAN' || rawRecord.submissionStatus === 'SUBMITTED_TO_ASB') &&
        effectiveVerifStatus === VERIFICATION_STATUS.DIKEMBALIKAN
      ) {
        // Jika dokumen yang pernah dikembalikan sudah disubmit ulang oleh Mantri, statusnya di ASB kembali menjadi MENUNGGU_VERIFIKASI
        effectiveVerifStatus = VERIFICATION_STATUS.MENUNGGU_VERIFIKASI;
      }
    }

    list.push({
      referenceType: refType,
      referenceId: refId,
      referenceDocNo: docNo,
      moduleCategory,
      rawRecord: sourceRecord || rawRecord,
      normalizedData,
      summary: normalizedData.summary,
      estateId,
      divisionId,
      currentStatus: (refType === 'MATERIAL' && rawRecord.materialSubmissionStatus) ? rawRecord.materialSubmissionStatus : (rawRecord.status || effectiveVerifStatus || 'SUBMITTED'),
      verificationStatus: effectiveVerifStatus,
      returnReason: (effectiveVerifStatus === VERIFICATION_STATUS.DIKEMBALIKAN ? ((refType === 'MATERIAL' && rawRecord.materialReturnReason) ? rawRecord.materialReturnReason : (rawRecord.returnReason || verifRecord.returnReason || null)) : null),
      latestVerification: verifRecord,
      canApprove: evalResult.canApprove,
      errors: evalResult.errors,
      warnings: evalResult.warnings,
      date: dateValue,
      submittedByName: verifRecord.submittedByName || rawRecord.mantri || rawRecord.submittedByName || 'Mantri Bibitan',
      submittedAt: verifRecord.submittedAt || verifRecord.createdAt
    });
  });

  const filtered = list.filter(item => {
    if (filters.estateId && item.estateId !== filters.estateId) return false;
    if (filters.divisionId && item.divisionId !== filters.divisionId) return false;
    if (filters.moduleCategory && filters.moduleCategory !== 'ALL' && item.moduleCategory !== filters.moduleCategory) return false;
    if (filters.referenceType && filters.referenceType !== 'ALL' && item.referenceType !== filters.referenceType) return false;
    if (filters.status && filters.status !== 'ALL' && item.verificationStatus !== filters.status) return false;
    if (filters.date) {
      const itemDateStr = String(item.date || '').substring(0, 10);
      const filterDateStr = String(filters.date).substring(0, 10);
      if (itemDateStr && filterDateStr && !itemDateStr.includes(filterDateStr) && !filterDateStr.includes(itemDateStr)) return false;
    }
    return true;
  });

  // Prioritas sorting: 'Menunggu' (1) di paling atas, 'Dikembalikan' (2) di tengah, 'Terverifikasi' (3) di bawah
  // Untuk status sama, urutkan waktu terbaru (submittedAt / date / createdAt descending)
  return filtered.sort((a, b) => {
    const isVerifiedA = a.verificationStatus === VERIFICATION_STATUS.TERVERIFIKASI || a.verificationStatus === VERIFICATION_STATUS.DATA_TERKONFIRMASI;
    const isReturnedA = a.verificationStatus === VERIFICATION_STATUS.DIKEMBALIKAN || a.currentStatus === 'DIKEMBALIKAN' || a.currentStatus === 'REVISION' || a.rawRecord?.status === 'DIKEMBALIKAN';
    const prioA = (!isVerifiedA && !isReturnedA) ? 1 : (isReturnedA ? 2 : 3);

    const isVerifiedB = b.verificationStatus === VERIFICATION_STATUS.TERVERIFIKASI || b.verificationStatus === VERIFICATION_STATUS.DATA_TERKONFIRMASI;
    const isReturnedB = b.verificationStatus === VERIFICATION_STATUS.DIKEMBALIKAN || b.currentStatus === 'DIKEMBALIKAN' || b.currentStatus === 'REVISION' || b.rawRecord?.status === 'DIKEMBALIKAN';
    const prioB = (!isVerifiedB && !isReturnedB) ? 1 : (isReturnedB ? 2 : 3);

    if (prioA !== prioB) return prioA - prioB;

    const timeA = new Date(a.submittedAt || a.date || a.createdAt || 0).getTime();
    const timeB = new Date(b.submittedAt || b.date || b.createdAt || 0).getTime();
    if (timeB !== timeA) return timeB - timeA;

    return String(b.referenceDocNo || b.docNo || b.id || '').localeCompare(String(a.referenceDocNo || a.docNo || a.id || ''));
  });
}

/**
 * Mengambil transaksi yang sudah terverifikasi dalam scope ASB
 */
export function getVerifiedTransactionsByScope(currentUser, filters = {}) {
  const allVerifRecords = getAllVerifications();

  const userEstateId = currentUser?.estateId;
  const userDivisionId = currentUser?.divisionId;

  return allVerifRecords.filter(v => {
    // Exclude REQUEST
    if (LOGISTICS_TYPES.includes(v.referenceType)) return false;

    // Only TERVERIFIKASI or DATA TERKONFIRMASI
    if (v.verificationStatus !== VERIFICATION_STATUS.TERVERIFIKASI && v.verificationStatus !== VERIFICATION_STATUS.DATA_TERKONFIRMASI) return false;

    // Scope check
    if (userEstateId && v.estateId && v.estateId !== userEstateId) return false;
    if (userDivisionId && v.divisionId && v.divisionId !== userDivisionId) return false;

    // Period check if specified
    if (filters.periodDate) {
      const vDate = v.verifiedAt || v.createdAt || '';
      if (!vDate.includes(filters.periodDate)) return false;
    }

    return true;
  }).map(v => {
    const sourceRecord = findSourceRecord(v.referenceType, v.referenceId, currentUser);
    const matchedModule = VERIFICATION_10_MODULES.find(m => m.types.includes(v.referenceType) || m.id === v.referenceType);
    const rawRecord = sourceRecord || v;
    const normalizedData = getVerificationDetailData(rawRecord, currentUser, v.referenceType);

    return {
      ...v,
      moduleCategory: matchedModule ? matchedModule.id : v.referenceType,
      rawRecord,
      normalizedData,
      summary: normalizedData.summary
    };
  });
}

/**
 * Ringkasan 10 Modul untuk Tinjau Data Hari Ini
 */
export function get10ModulesSummary(currentUser, periodDate = null) {
  const verifiedList = getVerifiedTransactionsByScope(currentUser, { periodDate });
  const pendingList = getActionableRecordsForAsb(currentUser, { date: periodDate });

  return VERIFICATION_10_MODULES.map(mod => {
    const modVerified = verifiedList.filter(v => mod.types.includes(v.referenceType) || v.moduleCategory === mod.id);
    const modPending = pendingList.filter(p => mod.types.includes(p.referenceType) || p.moduleCategory === mod.id);

    return {
      id: mod.id,
      label: mod.label,
      verifiedCount: modVerified.length,
      pendingCount: modPending.length,
      verifiedItems: modVerified,
      pendingItems: modPending,
      isComplete: modPending.length === 0
    };
  });
}

/**
 * Memeriksa apakah ASB terhalang (gated) dari melakukan Verifikasi
 * karena masih terdapat dokumen Pemeriksaan Hasil Seleksi yang belum selesai.
 * @param {Object} [user]
 * @returns {{ isGated: boolean, pendingSelectionCount: number }}
 */
export function checkAsbSelectionGate(user = null) {
  const currentUser = user || (session.getUser ? session.getUser() : (session.get ? session.get() : null));
  const userCtx = user ? resolveUserContext(user) : (getCurrentUserContext() || resolveUserContext(currentUser));
  if (!userCtx) {
    return { isGated: false, pendingSelectionCount: 0 };
  }

  const role = normalizeRole(userCtx.role || userCtx.rawRole);
  if (role !== ROLES.ASISTEN_BIBITAN && role !== ROLES.ASISTEN && role !== 'ASISTEN_BIBITAN' && role !== 'ASISTEN') {
    return { isGated: false, pendingSelectionCount: 0 };
  }

  const pendingSelectionCount = getActionableSelectionCount(null, userCtx);
  return {
    isGated: pendingSelectionCount > 0,
    pendingSelectionCount
  };
}

/**
 * Cek apakah Tinjau Data Hari Ini sudah siap dikirim ke server
 */
export function canSubmitFinalVerificationToServer(currentUser, periodDate = null) {
  const gate = checkAsbSelectionGate(currentUser);
  if (gate.isGated) return false;

  const pendingList = getActionableRecordsForAsb(currentUser, { date: periodDate });
  const verifiedList = getVerifiedTransactionsByScope(currentUser, { periodDate });

  // Harus ada transaksi terverifikasi dan TIDAK ada transaksi yang masih pending/revision
  return verifiedList.length > 0 && pendingList.length === 0;
}

/**
 * Kirim Data ke Server (Final submit pada Tinjau Data Hari Ini)
 */
export function submitFinalVerificationToServer(currentUser, periodDate = null) {
  const gate = checkAsbSelectionGate(currentUser);
  if (gate.isGated) {
    throw new Error(`Pengiriman ke server diblokir: Harap selesaikan ${gate.pendingSelectionCount} dokumen Pemeriksaan Hasil Seleksi terlebih dahulu.`);
  }

  if (!canSubmitFinalVerificationToServer(currentUser, periodDate)) {
    throw new Error('Pengiriman ke server belum dapat dilakukan: Masih ada transaksi yang belum selesai diverifikasi.');
  }

  const allVerifs = getAllVerifications();
  const nowIso = new Date().toISOString();
  let updatedCount = 0;
  const syncedItems = [];

  allVerifs.forEach(v => {
    if (v.verificationStatus === VERIFICATION_STATUS.TERVERIFIKASI || v.verificationStatus === VERIFICATION_STATUS.DATA_TERKONFIRMASI) {
      if (currentUser?.estateId && v.estateId && v.estateId !== currentUser.estateId) return;
      if (currentUser?.divisionId && v.divisionId && v.divisionId !== currentUser.divisionId) return;

      v.serverSyncStatus = 'SYNCED';
      v.syncedAt = nowIso;
      v.syncedByUserId = currentUser?.userId || currentUser?.id;
      v.syncedByName = currentUser?.name || 'Asisten Bibitan';
      updatedCount++;
      syncedItems.push({
        ...v,
        syncedAt: nowIso
      });
    }
  });

  storage.set(VERIFICATION_STORAGE_KEY, allVerifs);

  return {
    success: true,
    syncedCount: updatedCount,
    syncedAt: nowIso,
    syncedItems,
    message: `Sebanyak ${updatedCount} transaksi terverifikasi berhasil dikirim ke server.`
  };
}

/**
 * Mengambil riwayat verifikasi audit terfilter scope ASB
 */
export function getVerificationHistory(currentUser, filters = {}) {
  let list = getAllVerifications();

  if (currentUser) {
    const userEstateId = currentUser.estateId;
    const userDivisionId = currentUser.divisionId;

    list = list.filter(v => {
      if (userEstateId && v.estateId && v.estateId !== userEstateId) return false;
      if (userDivisionId && v.divisionId && v.divisionId !== userDivisionId) return false;
      return true;
    });
  }

  if (filters.referenceType && filters.referenceType !== 'ALL') {
    list = list.filter(v => v.referenceType === filters.referenceType);
  }
  if (filters.verificationStatus && filters.verificationStatus !== 'ALL') {
    list = list.filter(v => v.verificationStatus === filters.verificationStatus);
  }
  if (filters.dateFrom) {
    list = list.filter(v => (v.verifiedAt || v.createdAt) >= filters.dateFrom);
  }
  if (filters.dateTo) {
    list = list.filter(v => (v.verifiedAt || v.createdAt) <= `${filters.dateTo}T23:59:59.999Z`);
  }
  if (filters.keyword) {
    const kw = filters.keyword.toLowerCase();
    list = list.filter(v => 
      (v.verificationNo && v.verificationNo.toLowerCase().includes(kw)) ||
      (v.referenceDocNo && v.referenceDocNo.toLowerCase().includes(kw)) ||
      (v.notes && v.notes.toLowerCase().includes(kw)) ||
      (v.returnReason && v.returnReason.toLowerCase().includes(kw))
    );
  }

  return list.sort((a, b) => new Date(b.verifiedAt || b.createdAt || 0) - new Date(a.verifiedAt || a.createdAt || 0));
}

/**
 * Helper generate nomor verifikasi canonical
 */
function generateVerificationNo() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `VRF-${y}${m}${d}-${rand}`;
}

/**
 * APPROVAL VERIFIKASI (approveVerification)
 * Single Entry Point persetujuan final ASB
 */
function getMaintenanceWorkerIdentity(worker) {
  return String(worker?.id || worker?.workerId || `${worker?.code || worker?.workerCode || ''}-${worker?.name || worker?.workerName || ''}`);
}

function recordMaintenanceWorkerDecision({ referenceId, workerId, decision, returnReason = '', asistenPotongJamDecision = '', currentUser }) {
  if (!referenceId || !workerId) throw new Error('Dokumen dan pekerja wajib dipilih.');
  if (!currentUser) throw new Error('Otorisasi gagal: User aktif tidak ditemukan.');
  const role = normalizeRole(currentUser.role || currentUser.rawRole);
  if (![ROLES.ASISTEN_BIBITAN, ROLES.ASISTEN].includes(role)) {
    throw new Error('Hanya Asisten Bibitan yang dapat memutuskan hasil pekerja.');
  }
  if (decision === 'DIKEMBALIKAN' && !String(returnReason).trim()) {
    throw new Error('Alasan pengembalian pekerja wajib diisi.');
  }

  const source = findSourceRecord('PEMELIHARAAN', referenceId, currentUser);
  if (!source || !Array.isArray(source.pekerja) || !source.pekerja.length) {
    throw new Error('Rincian pekerja pada dokumen pemeliharaan tidak ditemukan.');
  }
  if (source.activityEntryMode !== 'MANDORAN' && !source.workGroupRoleCode) {
    throw new Error('Persetujuan per pekerja hanya berlaku untuk transaksi dengan Work Group Role Code.');
  }
  const estateId = source.targetEstateId || source.estateId || source.sourceEstateId;
  const divisionId = source.targetDivisionId || source.divisionId || source.sourceDivisionId;
  if (currentUser.estateId && estateId && currentUser.estateId !== estateId) throw new Error('Akses ditolak: dokumen berada di luar lingkup kebun Asisten.');
  if (currentUser.divisionId && divisionId && currentUser.divisionId !== divisionId) throw new Error('Akses ditolak: dokumen berada di luar lingkup divisi Asisten.');

  const records = storage.get(source._storeKey, []);
  const sourceIndex = records.findIndex((item) => String(item.id || item.docNo || '') === String(referenceId) || String(item.docNo || '') === String(source.docNo || ''));
  if (sourceIndex < 0) throw new Error('Dokumen sumber tidak dapat diperbarui.');
  const sourceRecord = records[sourceIndex];
  const targetWorkerIndex = sourceRecord.pekerja.findIndex((worker) => getMaintenanceWorkerIdentity(worker) === String(workerId));
  if (targetWorkerIndex < 0) throw new Error('Pekerja tidak ditemukan pada dokumen ini.');

  const verifications = storage.get(VERIFICATION_STORAGE_KEY, []);
  const verificationIndex = verifications
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.referenceType === 'PEMELIHARAAN' && String(item.referenceId) === String(referenceId))
    .sort((a, b) => new Date(b.item.createdAt || 0) - new Date(a.item.createdAt || 0))[0]?.index;
  if (verificationIndex === undefined) throw new Error('Catatan pengiriman ke Central Hub tidak ditemukan.');

  const verification = verifications[verificationIndex];
  if (verification.verificationStatus !== VERIFICATION_STATUS.MENUNGGU_VERIFIKASI) {
    throw new Error('Dokumen ini tidak lagi menunggu keputusan Asisten.');
  }
  const worker = sourceRecord.pekerja[targetWorkerIndex];
  const rawWorkDate = sourceRecord.activityDate || sourceRecord.tanggal || sourceRecord.date || sourceRecord.createdAt;
  const workDate = new Date(rawWorkDate || '');
  const workDay = Number.isNaN(workDate.getTime()) ? null : getStandardWorkHoursForDate(workDate);
  const baseTaskQuantity = Number(sourceRecord.taskQuantity) ||
    Number(getWorkAllocationByCode(sourceRecord.allocationCode)?.taskQuantity) ||
    Number(worker.taskQuantity) || 0;
  const workerTaskQuantity = workDay?.dayName === 'Jumat' && baseTaskQuantity > 0
    ? Math.round(baseTaskQuantity * 5 / 7)
    : baseTaskQuantity;
  const workerResult = Number(worker.inputHasil ?? worker.result ?? worker.quantity ?? 0);
  const requiresCutDecision = workerTaskQuantity > 0 && workerResult < workerTaskQuantity;
  if (decision === 'DISETUJUI' && asistenPotongJamDecision && !['SETUJU', 'TIDAK_SETUJU'].includes(asistenPotongJamDecision)) {
    throw new Error('Keputusan Potong Jam Asisten tidak valid.');
  }
  if (decision === 'DISETUJUI' && requiresCutDecision && !['SETUJU', 'TIDAK_SETUJU'].includes(asistenPotongJamDecision)) {
    throw new Error('Keputusan final Potong Jam wajib ditentukan sebelum pekerja disetujui.');
  }
  const workerKey = getMaintenanceWorkerIdentity(worker);
  const currentWorkerDecisions = { ...(verification.workerDecisions || {}) };
  const existingDecision = currentWorkerDecisions[workerKey];
  if (['DISETUJUI', 'DIKEMBALIKAN'].includes(existingDecision?.status || worker.asistenVerificationStatus)) {
    throw new Error('Pekerja ini sudah memiliki keputusan Asisten.');
  }

  const now = new Date().toISOString();
  const decisionRecord = {
    workerId: workerKey,
    workerCode: worker.code || worker.workerCode || '',
    workerName: worker.name || worker.workerName || 'Pekerja',
    status: decision,
    mantriPotongJamDecision: worker.potongJamDecision || '',
    mantriPotongJamReason: worker.potongJamReason || '',
    asistenPotongJamDecision: decision === 'DISETUJUI' ? (asistenPotongJamDecision || worker.asistenPotongJamDecision || '') : '',
    returnReason: decision === 'DIKEMBALIKAN' ? String(returnReason).trim() : '',
    decidedByUserId: currentUser.userId || currentUser.id || 'ASISTEN',
    decidedByName: currentUser.name || currentUser.fullName || 'Asisten Bibitan',
    decidedAt: now
  };
  currentWorkerDecisions[workerKey] = decisionRecord;

  const updatedWorkers = sourceRecord.pekerja.map((item) => {
    const key = getMaintenanceWorkerIdentity(item);
    const itemDecision = currentWorkerDecisions[key];
    if (!itemDecision) return item;
    return {
      ...item,
      asistenVerificationStatus: itemDecision.status,
      asistenReturnReason: itemDecision.returnReason || '',
      asistenPotongJamDecision: itemDecision.asistenPotongJamDecision || item.asistenPotongJamDecision || '',
      asistenVerifiedByUserId: itemDecision.decidedByUserId,
      asistenVerifiedByName: itemDecision.decidedByName,
      asistenVerifiedAt: itemDecision.decidedAt
    };
  });
  const allWorkersDecided = updatedWorkers.every((item) => ['DISETUJUI', 'DIKEMBALIKAN'].includes(item.asistenVerificationStatus));
  const allWorkersApproved = allWorkersDecided && updatedWorkers.every((item) => item.asistenVerificationStatus === 'DISETUJUI');
  const aggregateStatus = allWorkersApproved
    ? VERIFICATION_STATUS.TERVERIFIKASI
    : allWorkersDecided
      ? VERIFICATION_STATUS.DIKEMBALIKAN
      : VERIFICATION_STATUS.MENUNGGU_VERIFIKASI;

  sourceRecord.pekerja = updatedWorkers;
  sourceRecord.status = allWorkersApproved ? 'DISETUJUI' : allWorkersDecided ? 'DIKEMBALIKAN' : 'MENUNGGU_VERIFIKASI';
  sourceRecord.verificationStatus = aggregateStatus;
  sourceRecord.isFinal = allWorkersApproved;
  sourceRecord.asistenWorkerReviewUpdatedAt = now;
  sourceRecord.updatedAt = now;
  records[sourceIndex] = sourceRecord;
  storage.set(source._storeKey, records);

  const history = [...(verification.workerReviewHistory || []), decisionRecord];
  verifications[verificationIndex] = {
    ...verification,
    workerDecisions: currentWorkerDecisions,
    workerReviewHistory: history,
    verificationStatus: aggregateStatus,
    verifiedAt: allWorkersApproved ? now : null,
    returnedAt: allWorkersDecided && !allWorkersApproved ? now : verification.returnedAt || null,
    verifiedByUserId: allWorkersApproved ? currentUser.userId || currentUser.id || 'ASISTEN' : null,
    verifiedByName: allWorkersApproved ? currentUser.name || currentUser.fullName || 'Asisten Bibitan' : null,
    verifiedByRole: currentUser.role || ROLES.ASISTEN_BIBITAN,
    returnReason: aggregateStatus === VERIFICATION_STATUS.DIKEMBALIKAN
      ? updatedWorkers.filter((item) => item.asistenVerificationStatus === 'DIKEMBALIKAN').map((item) => `${item.name || item.workerName}: ${item.asistenReturnReason}`).join('\n')
      : null,
    updatedAt: now
  };
  storage.set(VERIFICATION_STORAGE_KEY, verifications);

  return { decision: decisionRecord, verificationStatus: aggregateStatus, allWorkersDecided, allWorkersApproved };
}

export function approveMaintenanceWorker({ referenceId, workerId, asistenPotongJamDecision = '', currentUser }) {
  return recordMaintenanceWorkerDecision({ referenceId, workerId, decision: 'DISETUJUI', asistenPotongJamDecision, currentUser });
}

export function returnMaintenanceWorker({ referenceId, workerId, returnReason, currentUser }) {
  return recordMaintenanceWorkerDecision({ referenceId, workerId, decision: 'DIKEMBALIKAN', returnReason, currentUser });
}

export function approveVerification({ referenceType, referenceId, notes = '', currentUser }) {
  if (!referenceType || !referenceId) {
    throw new Error('referenceType dan referenceId wajib disertakan.');
  }

  if (!currentUser) {
    throw new Error('Otorisasi gagal: User aktif tidak ditemukan.');
  }

  // [CATATAN OPSI 1 - SELECTION GATE HARMONIZATION]:
  // Approval dokumen satuan (seperti Absensi, Penerimaan, SOW, Perawatan, dll.) dapat diproses
  // secara mandiri agar tidak menimbulkan deadlock operasional harian Asisten Bibitan.
  // Selection Gate (checkAsbSelectionGate) tetap ditegakkan secara ketat pada tahap akhir (Final Sync):
  // canSubmitFinalVerificationToServer & submitFinalVerificationToServer.
  // Jika diperlukan audit notice, catat warning secara non-blocking:
  const isSelectionType = (
    referenceType === 'SELEKSI_PRA_OKULASI' ||
    referenceType === 'PENYELEKSIAN' ||
    referenceType === 'SELECTION'
  );
  if (!isSelectionType) {
    const gateCheck = checkAsbSelectionGate(currentUser);
    if (gateCheck.isGated) {
      console.warn(`[approveVerification] ASB selection gate active (${gateCheck.pendingSelectionCount} pending selection docs). Final sync to server will be blocked until completed.`);
    }
  }

  // 1. Ambil source record
  const sourceRecord = findSourceRecord(referenceType, referenceId, currentUser);
  if (!sourceRecord) {
    throw new Error(`Data transaksi sumber tidak ditemukan (${referenceType}:${referenceId}).`);
  }
  if (['PEMELIHARAAN', 'REKAM_PEMELIHARAAN', 'NURSERY_ACTIVITY'].includes(String(referenceType).toUpperCase()) && (sourceRecord.activityEntryMode === 'MANDORAN' || sourceRecord.workGroupRoleCode) && Array.isArray(sourceRecord.pekerja) && sourceRecord.pekerja.length) {
    throw new Error('Rekam Pemeliharaan harus disetujui per pekerja melalui rincian pekerja.');
  }

  // 2. Scope validation
  const recordEstateId = sourceRecord.targetEstateId || sourceRecord.estateId || sourceRecord.sourceEstateId;
  const recordDivisionId = sourceRecord.targetDivisionId || sourceRecord.divisionId || sourceRecord.sourceDivisionId;
  if (currentUser.estateId && recordEstateId && recordEstateId !== currentUser.estateId) {
    throw new Error(`Akses ditolak: Dokumen berada di luar lingkup estate user (${recordEstateId} vs ${currentUser.estateId}).`);
  }
  if (currentUser.divisionId && recordDivisionId && recordDivisionId !== currentUser.divisionId) {
    throw new Error(`Akses ditolak: Dokumen berada di luar lingkup divisi user (${recordDivisionId} vs ${currentUser.divisionId}).`);
  }

  // 3. Cek apakah sudah terverifikasi final (Idempotency Guard)
  const existingVerif = getVerificationByReference(referenceType, referenceId);
  if (existingVerif && (existingVerif.verificationStatus === VERIFICATION_STATUS.TERVERIFIKASI || existingVerif.verificationStatus === VERIFICATION_STATUS.DATA_TERKONFIRMASI)) {
    throw new Error(`Dokumen ini sudah diverifikasi sebelumnya dengan No: ${existingVerif.verificationNo || existingVerif.verificationId}.`);
  }
  if (referenceType === 'MATERIAL') {
    if (sourceRecord.materialSubmissionStatus === 'DISETUJUI') {
      throw new Error(`Dokumen material ini sudah disetujui sebelumnya (${sourceRecord.docNo || referenceId}).`);
    }
    if (sourceRecord._storeKey !== 'seeding_transactions') {
      if (sourceRecord.isFinal && (sourceRecord.status === 'DISETUJUI' || sourceRecord.status === 'TERKONFIRMASI')) {
        throw new Error(`Dokumen ini sudah disetujui sebelumnya dan berstatus final (${sourceRecord.docNo || referenceId}).`);
      }
    }
  } else {
    if (sourceRecord.isFinal && (sourceRecord.status === 'DISETUJUI' || sourceRecord.status === 'TERKONFIRMASI')) {
      throw new Error(`Dokumen ini sudah disetujui sebelumnya dan berstatus final (${sourceRecord.docNo || referenceId}).`);
    }
  }

  // 4. CONSISTENCY GATE
  const evalResult = evaluateRecordConsistency(referenceType, sourceRecord);
  if (!evalResult.canApprove || evalResult.errors.length > 0) {
    const errorMsg = evalResult.errors.map(e => e.message).join('; ');
    throw new Error(`Verifikasi diblokir oleh Konsistensi Gate (ERROR): ${errorMsg}`);
  }

  // 5. Build Audit Record
  const docNo = sourceRecord.docNo || sourceRecord.nir || sourceRecord.dispatchNo || sourceRecord.receiptDocNo || sourceRecord.selectionNo || sourceRecord.destructionNo || referenceId;
  const verificationId = `VRF-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
  const verificationNo = generateVerificationNo();
  const nowIso = new Date().toISOString();

  const auditRecord = {
    verificationId,
    verificationNo,
    referenceType,
    referenceId,
    referenceDocNo: docNo,
    estateId: recordEstateId || currentUser.estateId,
    divisionId: recordDivisionId || currentUser.divisionId,
    verificationStatus: referenceType === 'TIDAK_HADIR' ? VERIFICATION_STATUS.DATA_TERKONFIRMASI : VERIFICATION_STATUS.TERVERIFIKASI,
    findings: evalResult.warnings.map(w => w.message || w),
    notes: (notes || '').trim(),
    verifiedByUserId: currentUser.userId || currentUser.id || 'ANONYMOUS',
    verifiedByName: currentUser.name || currentUser.fullName || 'Asisten Bibitan',
    verifiedByRole: currentUser.role || ROLES.ASISTEN_BIBITAN,
    verifiedAt: nowIso,
    returnReason: null,
    createdAt: nowIso,
    updatedAt: nowIso
  };

  // 6. Helper: Simpan / perbarui di verification_transactions HANYA setelah mutasi & update sumber sukses
  const persistVerificationRecord = () => {
    const currentVerifs = storage.get(VERIFICATION_STORAGE_KEY, []);
    const targetType = (referenceType || '').toUpperCase();
    let found = false;
    currentVerifs.forEach((v, i) => {
      const vType = (v.referenceType || v.moduleType || '').toUpperCase();
      const isSameType = (vType === targetType);
      const isSameRef = (referenceId && String(v.referenceId) === String(referenceId)) ||
        (docNo && String(v.referenceDocNo) === String(docNo));
      if (isSameRef && isSameType) {
        currentVerifs[i] = {
          ...v,
          ...auditRecord,
          verificationNo: v.verificationNo || verificationNo,
          verificationStatus: auditRecord.verificationStatus
        };
        found = true;
      }
    });

    if (!found) {
      currentVerifs.push(auditRecord);
    }
    storage.set(VERIFICATION_STORAGE_KEY, currentVerifs);
  };

  // 7. Update status pada raw source record jika ada storeKey
  let lockAsyncPromise = null;
  if (sourceRecord._storeKey) {
    const records = storage.get(sourceRecord._storeKey, []);
    const idx = records.findIndex(r => String(r.id || r.docNo || '') === String(referenceId) || String(r.docNo || '') === String(docNo));
    if (idx !== -1) {
      const targetRecord = records[idx];

      // A. PENYELEKSIAN / CULL (selection_transactions)
      if (referenceType === 'PENYELEKSIAN' || referenceType === 'SELECTION' || sourceRecord._storeKey === 'selection_transactions') {
        const isExemptPrePlanting = isPrePlantingCullStockExempt(targetRecord);
        const mutationQty = parseInt(targetRecord.jumlahAfkir || targetRecord.quantity || 0, 10);

        if (isExemptPrePlanting) {
          // --- CULL PRA-TANAM: ZERO STOCK MUTATION (NOT_REQUIRED) ---
          targetRecord.status = 'DISETUJUI';
          targetRecord.isFinal = true;
          targetRecord.verificationStatus = VERIFICATION_STATUS.TERVERIFIKASI;
          targetRecord.stockMutationStatus = 'NOT_REQUIRED';
          targetRecord.stockMutationAt = nowIso;
          targetRecord.stockMutationBy = currentUser.userId || currentUser.code || currentUser.id || 'ASISTEN';
          targetRecord.stockMutationQty = mutationQty;
          targetRecord.stockMutationError = null;
          targetRecord.verifiedByUserId = currentUser.userId || currentUser.id;
          targetRecord.verifiedByName = currentUser.name || 'Asisten Bibitan';
          targetRecord.verifiedByRole = currentUser.role || ROLES.ASISTEN_BIBITAN;
          targetRecord.verifiedAt = nowIso;
          targetRecord.approvalNotes = notes || 'Disetujui oleh Asisten Bibitan via Central Hub Verifikasi';
          targetRecord.updatedAt = nowIso;

          // Catat Approval Decision Record Asisten (PERSISTENT & IMMUTABLE)
          const decisions = storage.get('selection_approval_decisions', []);
          const decisionId = `DEC-${targetRecord.id || targetRecord.docNo}-${Date.now()}`;
          decisions.push({
            id: decisionId,
            txId: targetRecord.id || targetRecord.docNo,
            docNo: targetRecord.docNo || targetRecord.id,
            batchId: targetRecord.batchId || targetRecord.batchCode || null,
            bedenganId: targetRecord.bedenganId || targetRecord.bedenganCode || targetRecord.bedengan || null,
            approvedQty: mutationQty,
            actorId: currentUser?.userId || currentUser?.id || 'ASISTEN',
            actorRole: ROLES.ASISTEN_BIBITAN,
            signatureNote: notes || 'Persetujuan hasil seleksi pra-tanam via Central Hub Verifikasi',
            createdAt: nowIso
          });
          storage.set('selection_approval_decisions', decisions);

          // Update Selection Pool item
          const fullPool = storage.get('selection_pool', []);
          const poolIdx = fullPool.findIndex(p =>
            p.selectionTransactionId === targetRecord.id ||
            p.id === targetRecord.selectionTransactionId ||
            p.docNo === targetRecord.docNo ||
            p.selectionDocNo === targetRecord.docNo ||
            (p.dederanDocNo && p.dederanDocNo === targetRecord.sourceDocNo) ||
            (p.sourceDocNo && p.sourceDocNo === targetRecord.sourceDocNo)
          );
          if (poolIdx !== -1) {
            fullPool[poolIdx].status = 'DECLARED_CULLED';
            fullPool[poolIdx].verifiedAt = nowIso;
            fullPool[poolIdx].verifiedByName = currentUser.name || 'Asisten Bibitan';
            storage.set('selection_pool', fullPool);
          }

          records[idx] = targetRecord;
          storage.set(sourceRecord._storeKey, records);
          persistVerificationRecord();
        } else {
          // --- CULL NON-DEDERAN: ATOMIC STOCK MUTATION UNDER WEB LOCKS & IDEMPOTENCY KEY ---
          const batchKey = targetRecord.batchId || targetRecord.batchCode || targetRecord.batchNo;
          const bedenganKey = targetRecord.bedenganId || targetRecord.bedenganCode || targetRecord.bedengan;

          if (mutationQty > 0) {
            if (!batchKey) {
              throw new Error(`Dokumen seleksi ${targetRecord.docNo || targetRecord.id} tidak memiliki referensi batch.`);
            }

            // Assert Kernel Level Locks
            assertBatchNotLocked(batchKey);
            if (bedenganKey) assertBedenganNotLocked(batchKey, bedenganKey);

            // 1. Catat Approval Decision Record Asisten
            const decisions = storage.get('selection_approval_decisions', []);
            const decisionId = `DEC-${targetRecord.id || targetRecord.docNo}-${Date.now()}`;
            const decisionRecord = {
              id: decisionId,
              txId: targetRecord.id || targetRecord.docNo,
              docNo: targetRecord.docNo || targetRecord.id,
              batchId: batchKey,
              bedenganId: bedenganKey,
              approvedQty: mutationQty,
              actorId: currentUser?.userId || currentUser?.id || 'ASISTEN',
              actorRole: ROLES.ASISTEN_BIBITAN,
              signatureNote: notes || 'Disetujui oleh Asisten Bibitan via Central Hub Verifikasi',
              createdAt: nowIso
            };
            decisions.push(decisionRecord);
            storage.set('selection_approval_decisions', decisions);

            // 2. Catat Mutation Intent (IN_FLIGHT)
            const intents = storage.get('selection_mutation_intents', []);
            const idempotencyKey = `MUT-${batchKey}-SEL-${targetRecord.id || targetRecord.docNo}`;
            const intentRecord = {
              id: `INTENT-${targetRecord.id || targetRecord.docNo}`,
              txId: targetRecord.id || targetRecord.docNo,
              docNo: targetRecord.docNo || targetRecord.id,
              decisionId: decisionId,
              batchId: batchKey,
              bedenganId: bedenganKey,
              mutationQty: mutationQty,
              idempotencyKey: idempotencyKey,
              status: 'IN_FLIGHT',
              createdAt: nowIso,
              updatedAt: nowIso
            };
            intents.push(intentRecord);
            storage.set('selection_mutation_intents', intents);

            const performDeduction = () => {
              // 3. Sync & Validate stock adequacy
              syncBatchPopulationFromSeeding(batchKey);
              const currentAvailable = getInventoryAvailableQty(batchKey);
              if (currentAvailable < mutationQty) {
                intentRecord.status = 'HALTED_RETRY_REQUIRED';
                intentRecord.errorReason = `Stok batch ${batchKey} tidak mencukupi (Tersedia: ${currentAvailable.toLocaleString('id-ID')} Pkk < Afkir: ${mutationQty.toLocaleString('id-ID')} Pkk).`;
                intentRecord.updatedAt = new Date().toISOString();
                storage.set('selection_mutation_intents', intents);
                throw new Error(intentRecord.errorReason);
              }

              // 4. Perform stock deduction in inventory ledger under idempotency key
              try {
                const mutation = deductInventoryStock(
                  batchKey,
                  mutationQty,
                  INVENTORY_TX_TYPE.SELECTION,
                  { id: targetRecord.docNo || targetRecord.id, idempotencyKey },
                  currentUser,
                  `Pengurangan stok seleksi afkir ${targetRecord.docNo || targetRecord.id} (Disetujui via Verifikasi)`
                );
                targetRecord.inventoryJournalId = mutation?.journalId || targetRecord.inventoryJournalId || null;
                intentRecord.status = 'COMPLETED';
                intentRecord.updatedAt = new Date().toISOString();
                storage.set('selection_mutation_intents', intents);
              } catch (err) {
                intentRecord.status = 'HALTED_RETRY_REQUIRED';
                intentRecord.errorReason = err.message;
                intentRecord.updatedAt = new Date().toISOString();
                storage.set('selection_mutation_intents', intents);
                throw new Error(`Gagal melakukan mutasi stok batch: ${err.message}`);
              }

              targetRecord.stockMutationStatus = 'APPLIED';
              targetRecord.stockMutationAt = nowIso;
              targetRecord.stockMutationBy = currentUser.userId || currentUser.code || currentUser.id || 'ASISTEN';
              targetRecord.stockMutationQty = mutationQty;
              targetRecord.stockMutationError = null;
              targetRecord.status = 'DISETUJUI';
              targetRecord.isFinal = true;
              targetRecord.verificationStatus = VERIFICATION_STATUS.TERVERIFIKASI;
              targetRecord.verifiedByUserId = currentUser.userId || currentUser.id;
              targetRecord.verifiedByName = currentUser.name || 'Asisten Bibitan';
              targetRecord.verifiedByRole = currentUser.role || ROLES.ASISTEN_BIBITAN;
              targetRecord.verifiedAt = nowIso;
              targetRecord.approvalNotes = notes || 'Disetujui oleh Asisten Bibitan via Central Hub Verifikasi';
              targetRecord.updatedAt = nowIso;

              // Update Selection Pool item
              const fullPool = storage.get('selection_pool', []);
              const poolIdx = fullPool.findIndex(p =>
                p.selectionTransactionId === targetRecord.id ||
                p.id === targetRecord.selectionTransactionId ||
                p.docNo === targetRecord.docNo ||
                p.selectionDocNo === targetRecord.docNo ||
                (p.dederanDocNo && p.dederanDocNo === targetRecord.sourceDocNo) ||
                (p.sourceDocNo && p.sourceDocNo === targetRecord.sourceDocNo)
              );
              if (poolIdx !== -1) {
                fullPool[poolIdx].status = 'DECLARED_CULLED';
                fullPool[poolIdx].verifiedAt = nowIso;
                fullPool[poolIdx].verifiedByName = currentUser.name || 'Asisten Bibitan';
                storage.set('selection_pool', fullPool);
              }

              records[idx] = targetRecord;
              storage.set(sourceRecord._storeKey, records);
              completePhysicalStockCullVerification(targetRecord, currentUser, targetRecord.inventoryJournalId);
              persistVerificationRecord();
            };

            // Gunakan Web Locks jika tersedia pada runtime
            if (typeof navigator !== 'undefined' && navigator.locks && navigator.locks.request) {
              lockAsyncPromise = executeStockMutationWithLock(batchKey, async () => {
                performDeduction();
              });
            } else {
              performDeduction();
            }
          } else {
            // mutationQty === 0
            targetRecord.stockMutationStatus = 'NOT_REQUIRED';
            targetRecord.stockMutationAt = nowIso;
            targetRecord.stockMutationBy = currentUser.userId || currentUser.code || currentUser.id || 'ASISTEN';
            targetRecord.stockMutationQty = 0;
            targetRecord.stockMutationError = null;
            targetRecord.status = 'DISETUJUI';
            targetRecord.isFinal = true;
            targetRecord.verificationStatus = VERIFICATION_STATUS.TERVERIFIKASI;
            targetRecord.verifiedByUserId = currentUser.userId || currentUser.id;
            targetRecord.verifiedByName = currentUser.name || 'Asisten Bibitan';
            targetRecord.verifiedByRole = currentUser.role || ROLES.ASISTEN_BIBITAN;
            targetRecord.verifiedAt = nowIso;
            targetRecord.approvalNotes = notes || 'Disetujui oleh Asisten Bibitan via Central Hub Verifikasi';
            targetRecord.updatedAt = nowIso;

            // Update Selection Pool item
            const fullPool = storage.get('selection_pool', []);
            const poolIdx = fullPool.findIndex(p =>
              p.selectionTransactionId === targetRecord.id ||
              p.id === targetRecord.selectionTransactionId ||
              p.docNo === targetRecord.docNo ||
              p.selectionDocNo === targetRecord.docNo ||
              (p.dederanDocNo && p.dederanDocNo === targetRecord.sourceDocNo) ||
              (p.sourceDocNo && p.sourceDocNo === targetRecord.sourceDocNo)
            );
            if (poolIdx !== -1) {
              fullPool[poolIdx].status = 'DECLARED_CULLED';
              fullPool[poolIdx].verifiedAt = nowIso;
              fullPool[poolIdx].verifiedByName = currentUser.name || 'Asisten Bibitan';
              storage.set('selection_pool', fullPool);
            }

            records[idx] = targetRecord;
            storage.set(sourceRecord._storeKey, records);
            persistVerificationRecord();
          }
        }
      } else if (referenceType === 'SELEKSI_PRA_OKULASI' || sourceRecord._storeKey === 'pre_grafting_selection_documents') {
        // --- SELEKSI PRA-OKULASI (I, II, III): ZERO STOCK MUTATION & DOWNSTREAM GENERATION ---
        targetRecord.status = 'DISETUJUI';
        targetRecord.isFinal = true;
        targetRecord.verificationStatus = VERIFICATION_STATUS.TERVERIFIKASI;
        targetRecord.finalBibitQty = targetRecord.totalLayak !== undefined ? targetRecord.totalLayak : targetRecord.currentBibitQty;
        targetRecord.finalPolybagQty = targetRecord.activePolybagQty !== undefined ? targetRecord.activePolybagQty : targetRecord.sourcePolybagQty;
        targetRecord.activePolybagQty = targetRecord.activePolybagQty !== undefined ? targetRecord.activePolybagQty : (targetRecord.currentPolybagQty || 0);
        targetRecord.emptyPolybagQty = targetRecord.emptyPolybagQty !== undefined ? targetRecord.emptyPolybagQty : 0;
        targetRecord.verifiedByUserId = currentUser.userId || currentUser.id;
        targetRecord.verifiedByName = currentUser.name || 'Asisten Bibitan';
        targetRecord.verifiedByRole = currentUser.role || ROLES.ASISTEN_BIBITAN;
        targetRecord.verifiedAt = nowIso;
        targetRecord.approvalNotes = notes || 'Disetujui oleh Asisten Bibitan via Central Hub Verifikasi';
        targetRecord.updatedAt = nowIso;

        // Sinkronkan seluruh transaksi pelaksanaan & afkir Seleksi Pra-Okulasi anak
        const allSelTxs = storage.get('selection_transactions', []);
        let childTxsModified = false;
        allSelTxs.forEach(tx => {
          if (
            tx.selectionDocumentId === targetRecord.id ||
            tx.parentSelectionDocumentId === targetRecord.id ||
            tx.selectionDocNo === targetRecord.docNo ||
            tx.parentSelectionDocNo === targetRecord.docNo ||
            tx.sourceDocNo === targetRecord.docNo ||
            tx.sourceTransactionId === targetRecord.id ||
            tx.id === targetRecord.id
          ) {
            tx.status = 'DISETUJUI';
            tx.isFinal = true;
            tx.verificationStatus = VERIFICATION_STATUS.TERVERIFIKASI;
            tx.verifiedByUserId = currentUser.userId || currentUser.id;
            tx.verifiedByName = currentUser.name || 'Asisten Bibitan';
            tx.verifiedAt = nowIso;
            tx.approvalNotes = notes || 'Disetujui oleh Asisten Bibitan via Central Hub Verifikasi';
            tx.updatedAt = nowIso;
            childTxsModified = true;
          }
        });
        if (childTxsModified) {
          storage.set('selection_transactions', allSelTxs);
        }

        // Sinkronkan juga seluruh catatan audit di verification_transactions untuk child transactions
        const allVerifs = storage.get('verification_transactions', []);
        let verifsModified = false;
        allVerifs.forEach(v => {
          const isMatch = (
            v.referenceId === targetRecord.id ||
            v.referenceDocNo === targetRecord.docNo ||
            (v.parentSelectionDocNo && v.parentSelectionDocNo === targetRecord.docNo) ||
            allSelTxs.some(tx => (
              (tx.parentSelectionDocNo === targetRecord.docNo || tx.sourceDocNo === targetRecord.docNo || tx.selectionDocNo === targetRecord.docNo) &&
              (v.referenceId === tx.id || v.referenceDocNo === tx.docNo)
            ))
          );
          if (isMatch && v.verificationStatus !== VERIFICATION_STATUS.TERVERIFIKASI) {
            v.verificationStatus = VERIFICATION_STATUS.TERVERIFIKASI;
            v.verifiedByUserId = currentUser.userId || currentUser.id;
            v.verifiedByName = currentUser.name || 'Asisten Bibitan';
            v.verifiedByRole = currentUser.role || ROLES.ASISTEN_BIBITAN;
            v.verifiedAt = nowIso;
            v.notes = notes || 'Disetujui oleh Asisten Bibitan via Central Hub Verifikasi';
            v.updatedAt = nowIso;
            verifsModified = true;
          }
        });
        if (verifsModified) {
          storage.set('verification_transactions', allVerifs);
        }

        // Sinkronkan juga Dokumen Induk di pre_grafting_selection_documents jika targetRecord adalah child execution
        const parentDocId = targetRecord.parentSelectionDocumentId || targetRecord.selectionDocumentId || targetRecord._parentDocId;
        const parentDocNo = targetRecord.parentSelectionDocNo || targetRecord.selectionDocNo;
        if (parentDocId || parentDocNo) {
          const allPreDocs = storage.get('pre_grafting_selection_documents', []);
          const pIdx = allPreDocs.findIndex(d => (parentDocId && d.id === parentDocId) || (parentDocNo && d.docNo === parentDocNo));
          if (pIdx !== -1) {
            allPreDocs[pIdx].status = 'DISETUJUI';
            allPreDocs[pIdx].isFinal = true;
            allPreDocs[pIdx].verificationStatus = VERIFICATION_STATUS.TERVERIFIKASI;
            allPreDocs[pIdx].verifiedByUserId = currentUser.userId || currentUser.id;
            allPreDocs[pIdx].verifiedByName = currentUser.name || 'Asisten Bibitan';
            allPreDocs[pIdx].verifiedByRole = currentUser.role || ROLES.ASISTEN_BIBITAN;
            allPreDocs[pIdx].verifiedAt = nowIso;
            allPreDocs[pIdx].approvalNotes = notes || 'Disetujui oleh Asisten Bibitan via Central Hub Verifikasi';
            allPreDocs[pIdx].updatedAt = nowIso;
            storage.set('pre_grafting_selection_documents', allPreDocs);
          }
        }

        records[idx] = targetRecord;
        storage.set(sourceRecord._storeKey, records);
        persistVerificationRecord();

        // Downstream Document Generation (Hanya jika persyaratan bisnis & ketuntasan terpenuhi)
        // Dijalankan setelah targetRecord tersimpan agar tidak menimpa dokumen turunan di storage
        const stageNorm = String(targetRecord.selectionStage || '').toUpperCase();
        try {
          if (stageNorm === 'SELEKSI_I' || stageNorm === 'SELEKSI_1') {
            const gate = canCreateSelection2Document(targetRecord);
            if (gate.canCreate) {
              createSelection2DocumentFromSelection1(targetRecord, currentUser);
            } else {
              console.warn('[approveVerification] Seleksi II creation blocked by gate:', gate.reason);
            }
          } else if (stageNorm === 'SELEKSI_II' || stageNorm === 'SELEKSI_2') {
            const gate = canCreateSelection3Document(targetRecord);
            if (gate.canCreate) {
              createSelection3DocumentFromSelection2(targetRecord, currentUser);
            } else {
              console.warn('[approveVerification] Seleksi III creation blocked by gate:', gate.reason);
            }
          }
        } catch (genErr) {
          console.warn('[approveVerification] Downstream generation notice:', genErr.message);
        }
      } else if (referenceType === 'MATERIAL') {
        targetRecord.materialSubmissionStatus = 'DISETUJUI';
        targetRecord.materialVerificationStatus = VERIFICATION_STATUS.TERVERIFIKASI;
        targetRecord.materialVerifiedAt = nowIso;
        targetRecord.materialVerifiedByUserId = currentUser.userId || currentUser.id;
        targetRecord.materialVerifiedByName = currentUser.name || 'Asisten Bibitan';

        // Hanya jika targetRecord BUKAN seeding_transactions (misal material_usage_transactions tersendiri),
        // update status utama record. Untuk seeding_transactions (SOW), jangan sentuh status Penyemaian!
        if (sourceRecord._storeKey !== 'seeding_transactions') {
          targetRecord.status = 'DISETUJUI';
          targetRecord.isFinal = true;
          targetRecord.verificationStatus = VERIFICATION_STATUS.TERVERIFIKASI;
          targetRecord.verifiedAt = nowIso;
          targetRecord.verifiedByUserId = currentUser.userId || currentUser.id;
          targetRecord.verifiedByName = currentUser.name || 'Asisten Bibitan';
        }
        records[idx] = targetRecord;
        storage.set(sourceRecord._storeKey, records);
        persistVerificationRecord();
      } else {
        // Modul Pemeriksaan Lapangan & Lainnya (Presensi, Penerimaan, Dederan/Okulasi Inspection, dll.)
        targetRecord.status = referenceType === 'TIDAK_HADIR' ? 'TERKONFIRMASI' : 'DISETUJUI';
        targetRecord.isFinal = true;
        targetRecord.verificationStatus = referenceType === 'TIDAK_HADIR' ? VERIFICATION_STATUS.DATA_TERKONFIRMASI : VERIFICATION_STATUS.TERVERIFIKASI;
        targetRecord.verifiedAt = nowIso;
        targetRecord.verifiedByUserId = currentUser.userId || currentUser.id;
        targetRecord.verifiedByName = currentUser.name || 'Asisten Bibitan';
        records[idx] = targetRecord;
        storage.set(sourceRecord._storeKey, records);
        persistVerificationRecord();
        if (sourceRecord._storeKey === 'inspection_transactions') {
          try {
            syncApprovedInspectionOutputs(targetRecord, currentUser);
          } catch (syncErr) {
            console.warn('[approveVerification] Budding inspection output sync notice:', syncErr.message);
          }
        }
      }

      // Auto-reconcile Dokumen Seleksi Pra-Okulasi jika Pindah Semai (SEEDING) atau CULL baru disetujui ASB
      if (referenceType !== 'MATERIAL' && (referenceType === 'PENYEMAIAN' || referenceType === 'SEEDING' || referenceType === 'SELEKSI' || referenceType === 'PENYELEKSIAN' || sourceRecord._storeKey === 'selection_transactions')) {
        try {
          syncAllSeedingsToPreGraftingSelectionDocuments(currentUser);
          syncAllApprovedPreGraftingSelectionDocuments(currentUser);
        } catch (syncErr) {
          console.warn('[approveVerification] Auto-reconcile pre-grafting notice:', syncErr.message);
        }
      }
    }
  } else {
    persistVerificationRecord();
  }

  const p = lockAsyncPromise ? lockAsyncPromise.then(() => auditRecord) : Promise.resolve(auditRecord);
  Object.assign(p, auditRecord);
  return p;
}

/**
 * RETURN VERIFIKASI (returnVerification)
 */
export function returnVerification({ referenceType, referenceId, returnReason, notes = '', currentUser }) {
  if (!referenceType || !referenceId) {
    throw new Error('referenceType dan referenceId wajib disertakan.');
  }

  if (!returnReason || !returnReason.trim()) {
    throw new Error('Alasan pengembalian (returnReason) wajib diisi.');
  }

  if (!currentUser) {
    throw new Error('Otorisasi gagal: User aktif tidak ditemukan.');
  }

  // 1. Cegah Return untuk TIDAK_HADIR
  if (referenceType === 'TIDAK_HADIR') {
    throw new Error('Dokumen Tidak Hadir tidak dapat dikembalikan (Return). Hanya dapat diverifikasi.');
  }

  // 2. Ambil source record
  const sourceRecord = findSourceRecord(referenceType, referenceId, currentUser);
  if (!sourceRecord) {
    throw new Error(`Data transaksi sumber tidak ditemukan (${referenceType}:${referenceId}).`);
  }
  if (['PEMELIHARAAN', 'REKAM_PEMELIHARAAN', 'NURSERY_ACTIVITY'].includes(String(referenceType).toUpperCase()) && (sourceRecord.activityEntryMode === 'MANDORAN' || sourceRecord.workGroupRoleCode) && Array.isArray(sourceRecord.pekerja) && sourceRecord.pekerja.length) {
    throw new Error('Rekam Pemeliharaan harus dikembalikan per pekerja melalui rincian pekerja.');
  }

  // 3. Return Guard: Dokumen final atau stok yang sudah termutasi TIDAK DAPAT dikembalikan
  const existingVerif = getVerificationByReference(referenceType, referenceId);
  if (existingVerif && (existingVerif.verificationStatus === VERIFICATION_STATUS.TERVERIFIKASI || existingVerif.verificationStatus === VERIFICATION_STATUS.DATA_TERKONFIRMASI)) {
    throw new Error(`Dokumen yang sudah diverifikasi dan berstatus final tidak dapat dikembalikan (No: ${existingVerif.verificationNo || existingVerif.verificationId}).`);
  }

  if (referenceType === 'MATERIAL') {
    if (sourceRecord.materialSubmissionStatus === 'DISETUJUI') {
      throw new Error(`Dokumen material ini sudah berstatus disetujui (${sourceRecord.docNo || referenceId}) dan tidak dapat dikembalikan.`);
    }
    if (sourceRecord._storeKey !== 'seeding_transactions') {
      if (sourceRecord.isFinal || sourceRecord.status === 'DISETUJUI' || sourceRecord.status === 'TERKONFIRMASI') {
        throw new Error(`Dokumen ini sudah berstatus final (${sourceRecord.docNo || referenceId}) dan tidak dapat dikembalikan.`);
      }
    }
  } else {
    if (sourceRecord.isFinal || sourceRecord.status === 'DISETUJUI' || sourceRecord.status === 'TERKONFIRMASI') {
      throw new Error(`Dokumen ini sudah berstatus final (${sourceRecord.docNo || referenceId}) dan tidak dapat dikembalikan.`);
    }
  }

  if (sourceRecord.stockMutationStatus === 'APPLIED') {
    throw new Error(`Dokumen dengan mutasi stok yang telah diterapkan (APPLIED) tidak dapat dikembalikan.`);
  }

  // 4. Scope validation
  const recordEstateId = sourceRecord.targetEstateId || sourceRecord.estateId || sourceRecord.sourceEstateId;
  const recordDivisionId = sourceRecord.targetDivisionId || sourceRecord.divisionId || sourceRecord.sourceDivisionId;
  if (currentUser.estateId && recordEstateId && recordEstateId !== currentUser.estateId) {
    throw new Error(`Akses ditolak: Dokumen berada di luar lingkup estate user (${recordEstateId} vs ${currentUser.estateId}).`);
  }
  if (currentUser.divisionId && recordDivisionId && recordDivisionId !== currentUser.divisionId) {
    throw new Error(`Akses ditolak: Dokumen berada di luar lingkup divisi user (${recordDivisionId} vs ${currentUser.divisionId}).`);
  }

  // 5. Consistency Findings Snapshot
  const evalResult = evaluateRecordConsistency(referenceType, sourceRecord);
  const allFindings = evalResult.errors.concat(evalResult.warnings).map(f => f.message || f);

  // 6. Build Audit Record
  const docNo = sourceRecord.docNo || sourceRecord.nir || sourceRecord.dispatchNo || sourceRecord.receiptDocNo || sourceRecord.selectionNo || sourceRecord.destructionNo || referenceId;
  const verificationId = `VRF-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
  const verificationNo = generateVerificationNo();
  const nowIso = new Date().toISOString();

  const auditRecord = {
    verificationId,
    verificationNo,
    referenceType,
    referenceId,
    referenceDocNo: docNo,
    estateId: recordEstateId || currentUser.estateId,
    divisionId: recordDivisionId || currentUser.divisionId,
    verificationStatus: VERIFICATION_STATUS.DIKEMBALIKAN,
    findings: allFindings,
    notes: (notes || '').trim(),
    returnReason: returnReason.trim(),
    verifiedByUserId: currentUser.userId || currentUser.id || 'ANONYMOUS',
    verifiedByName: currentUser.name || currentUser.fullName || 'Asisten Bibitan',
    verifiedByRole: currentUser.role || ROLES.ASISTEN_BIBITAN,
    verifiedAt: nowIso,
    createdAt: nowIso,
    updatedAt: nowIso
  };

  // 7. Simpan / perbarui ke verification_transactions
  const currentVerifs = storage.get(VERIFICATION_STORAGE_KEY, []);
  const existIdx = currentVerifs.findIndex(v =>
    ((v.referenceType || v.moduleType || '').toUpperCase() === (referenceType || '').toUpperCase()) &&
    (String(v.referenceId) === String(referenceId) || String(v.referenceDocNo) === String(docNo))
  );

  if (existIdx !== -1) {
    currentVerifs[existIdx] = {
      ...currentVerifs[existIdx],
      ...auditRecord,
      verificationNo: currentVerifs[existIdx].verificationNo || verificationNo
    };
  } else {
    currentVerifs.push(auditRecord);
  }
  storage.set(VERIFICATION_STORAGE_KEY, currentVerifs);

  // 8. Update status raw record menjadi REVISION / DIKEMBALIKAN
  if (sourceRecord._storeKey) {
    const records = storage.get(sourceRecord._storeKey, []);
    const idx = records.findIndex(r => String(r.id || r.docNo || '') === String(referenceId) || String(r.docNo || '') === String(docNo));
    if (idx !== -1) {
      if (referenceType === 'MATERIAL') {
        records[idx].materialSubmissionStatus = 'DIKEMBALIKAN';
        records[idx].materialVerificationStatus = VERIFICATION_STATUS.DIKEMBALIKAN;
        records[idx].materialReturnReason = returnReason.trim();
        records[idx].materialReturnedAt = nowIso;
        if (sourceRecord._storeKey !== 'seeding_transactions') {
          records[idx].status = 'DIKEMBALIKAN';
          records[idx].verificationStatus = VERIFICATION_STATUS.DIKEMBALIKAN;
          records[idx].returnReason = returnReason.trim();
          records[idx].returnedAt = nowIso;
          records[idx].returnedByUserId = currentUser.userId || currentUser.id;
        }
      } else {
        records[idx].status = 'DIKEMBALIKAN';
        records[idx].verificationStatus = VERIFICATION_STATUS.DIKEMBALIKAN;
        if (records[idx].submissionStatus) {
          records[idx].submissionStatus = 'DIKEMBALIKAN';
        }
        records[idx].returnReason = returnReason.trim();
        records[idx].returnedAt = nowIso;
        records[idx].returnedByUserId = currentUser.userId || currentUser.id;
      }

      if (referenceType === 'SELEKSI_PRA_OKULASI' || sourceRecord._storeKey === 'pre_grafting_selection_documents') {
        records[idx].isCompleted = false;
        const returnedDoc = records[idx];
        const allSelTxs = storage.get('selection_transactions', []);
        let childTxsModified = false;
        allSelTxs.forEach(tx => {
          if (
            tx.selectionDocumentId === returnedDoc.id ||
            tx.parentSelectionDocumentId === returnedDoc.id ||
            tx.selectionDocNo === returnedDoc.docNo ||
            tx.parentSelectionDocNo === returnedDoc.docNo ||
            tx.id === returnedDoc.id
          ) {
            tx.status = 'DIKEMBALIKAN';
            tx.returnReason = returnReason.trim();
            tx.returnedAt = nowIso;
            childTxsModified = true;
          }
        });
        if (childTxsModified) {
          storage.set('selection_transactions', allSelTxs);
        }

        const parentDocId = returnedDoc.parentSelectionDocumentId || returnedDoc.selectionDocumentId || returnedDoc._parentDocId;
        const parentDocNo = returnedDoc.parentSelectionDocNo || returnedDoc.selectionDocNo;
        if (parentDocId || parentDocNo) {
          const allPreDocs = storage.get('pre_grafting_selection_documents', []);
          const pIdx = allPreDocs.findIndex(d => (parentDocId && d.id === parentDocId) || (parentDocNo && d.docNo === parentDocNo));
          if (pIdx !== -1) {
            allPreDocs[pIdx].status = 'DIKEMBALIKAN';
            allPreDocs[pIdx].verificationStatus = VERIFICATION_STATUS.DIKEMBALIKAN;
            allPreDocs[pIdx].returnReason = returnReason.trim();
            allPreDocs[pIdx].returnedAt = nowIso;
            allPreDocs[pIdx].returnedByUserId = currentUser.userId || currentUser.id;
            allPreDocs[pIdx].isCompleted = false;
            storage.set('pre_grafting_selection_documents', allPreDocs);
          }
        }
      } else if (referenceType === 'PENYELEKSIAN' || referenceType === 'SELECTION' || sourceRecord._storeKey === 'selection_transactions') {
        // Sinkronkan status selection_pool item agar dapat dikoreksi/dipilih ulang oleh Mantri
        const fullPool = storage.get('selection_pool', []);
        const poolIdx = fullPool.findIndex(p =>
          p.selectionTransactionId === sourceRecord.id ||
          p.id === sourceRecord.selectionTransactionId ||
          p.docNo === sourceRecord.docNo ||
          p.selectionDocNo === sourceRecord.docNo ||
          (p.dederanDocNo && p.dederanDocNo === sourceRecord.sourceDocNo)
        );
        if (poolIdx !== -1) {
          fullPool[poolIdx].status = 'DIKEMBALIKAN';
          fullPool[poolIdx].returnReason = returnReason.trim();
          fullPool[poolIdx].returnedAt = nowIso;
          fullPool[poolIdx].returnedByName = currentUser.name || 'Asisten Bibitan';
          storage.set('selection_pool', fullPool);
        }
      }

      storage.set(sourceRecord._storeKey, records);
      if (sourceRecord._storeKey === 'selection_transactions') {
        returnPhysicalStockCullVerification(records[idx], currentUser, returnReason.trim());
      }
    }
  }

  const p = Promise.resolve(auditRecord);
  Object.assign(p, auditRecord);
  return p;
}
