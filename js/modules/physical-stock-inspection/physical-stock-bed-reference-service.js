/**
 * Resolver read-only Batch -> Bedengan untuk Pemeriksaan Stok Fisik.
 *
 * Service ini sengaja tidak memanggil helper inventory yang melakukan sinkronisasi
 * atau persistensi. Ia hanya membaca snapshot yang sudah ada, sehingga aman dipakai
 * saat membentuk form dan saat melakukan rekonsiliasi.
 */
import { storage } from '../../core/storage.js';

export const RECONCILIATION_STATUS = Object.freeze({
  EXACT_MATCH: 'EXACT_MATCH',
  HAS_UNALLOCATED_BALANCE: 'HAS_UNALLOCATED_BALANCE',
  LEDGER_RECONCILIATION_ANOMALY: 'LEDGER_RECONCILIATION_ANOMALY',
  NO_TRANSACTION_HISTORY: 'NO_TRANSACTION_HISTORY'
});

export const REFERENCE_STATUS = Object.freeze({
  VALID: 'VALID',
  UNSPECIFIED: 'UNSPECIFIED',
  RAW_ID: 'RAW_ID'
});

const APPROVED = new Set(['DISETUJUI', 'TERVERIFIKASI', 'VERIFIED', 'APPROVED']);
const INVALID = new Set(['DRAFT', 'DITOLAK', 'REJECTED', 'DIBATALKAN', 'BATAL', 'CANCELLED', 'VOID', 'DITARIK', 'WITHDRAWN', 'DIKEMBALIKAN', 'REVISION']);

function clean(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}

function upper(value) {
  return clean(value).toUpperCase();
}

function positiveInt(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : 0;
}

function batchIdentities(batch) {
  return new Set([batch?.id, batch?.batchId, batch?.batchCode, batch?.batchNo, batch?.kode].filter(Boolean).map(clean));
}

function matchesBatch(record, ids) {
  if (!record) return false;
  const root = [record.batchId, record.batchCode, record.batchNo, record.batch_code]
    .filter(Boolean).some(value => ids.has(clean(value)));
  const rows = Array.isArray(record.rows) && record.rows.some(row =>
    [row?.batchId, row?.batchCode, row?.batchNo, row?.batch_code]
      .filter(Boolean).some(value => ids.has(clean(value)))
  );
  return root || rows;
}

function isInvalid(record) {
  if (!record || record.isDeleted || record.deleted) return true;
  const statuses = [record.status, record.verificationStatus, record.approvalStatus, record.submissionStatus]
    .map(upper).filter(Boolean);
  return statuses.some(status => INVALID.has(status));
}

function isApproved(record) {
  if (isInvalid(record)) return false;
  return record.isFinal === true || [record.status, record.verificationStatus, record.approvalStatus]
    .map(upper).some(status => APPROVED.has(status));
}

function seedingQty(record) {
  return positiveInt(record?.totalDisemai ?? record?.disemai ?? record?.totalPolybag ?? record?.qty);
}

function bedIdentity(record) {
  if (!record) return null;
  const id = clean(record.bedenganId || record.bedenganCode || record.bedengan || record.lokasi);
  return id || null;
}

function bedCode(record) {
  return clean(record?.bedenganCode || record?.bedengan || record?.bedenganId || record?.lokasi) || null;
}

function getBedMaster(idOrCode) {
  if (!idOrCode) return null;
  const list = storage.get('bedengan_master', []);
  if (!Array.isArray(list)) return null;
  return list.find(item => upper(item.bedenganId) === upper(idOrCode) || upper(item.bedenganCode) === upper(idOrCode)) || null;
}

function normalizeBed(idOrCode, source = null) {
  const raw = clean(idOrCode);
  const master = getBedMaster(raw);
  return {
    bedenganId: master?.bedenganId || raw || null,
    bedenganCode: master?.bedenganCode || bedCode(source) || raw || null,
    bedenganName: master?.name || master?.bedenganName || source?.bedengan || null,
    masterFound: Boolean(master),
    referenceStatus: master ? REFERENCE_STATUS.VALID : (raw ? REFERENCE_STATUS.RAW_ID : REFERENCE_STATUS.UNSPECIFIED)
  };
}

function readOfficialBatchBalance(batch) {
  const ids = batchIdentities(batch);
  const states = storage.get('batch_inventory_states', []);
  const state = Array.isArray(states) ? states.find(item =>
    ids.has(clean(item?.batchId)) || ids.has(clean(item?.batchCode))
  ) : null;
  if (state) return Number(state.availableQty || 0);
  return Number(batch?.availableQty ?? batch?.currentQty ?? batch?.receivedQty ?? 0);
}

function readApprovedSeedings(batch) {
  const ids = batchIdentities(batch);
  const all = storage.get('seeding_transactions', []);
  const records = Array.isArray(all) ? all.filter(tx => matchesBatch(tx, ids) && isApproved(tx)) : [];
  const byBed = new Map();
  const unspecified = [];

  records.forEach(tx => {
    const total = seedingQty(tx);
    if (!total) return;

    const rootBed = bedIdentity(tx);
    if (rootBed) {
      const normalized = normalizeBed(rootBed, tx);
      byBed.set(normalized.bedenganId, {
        ...normalized,
        qty: (byBed.get(normalized.bedenganId)?.qty || 0) + total,
        provenance: [...(byBed.get(normalized.bedenganId)?.provenance || []), tx.docNo || tx.id || 'SEEDING']
      });
      return;
    }

    const rows = Array.isArray(tx.rows) ? tx.rows : [];
    const rowBeds = rows.map(row => ({ row, id: bedIdentity(row) })).filter(item => item.id);
    const distinctBeds = [...new Set(rowBeds.map(item => item.id))];
    const rowQuantities = rowBeds.map(item => positiveInt(item.row.disemai ?? item.row.totalDisemai ?? item.row.qty));
    const rowSum = rowQuantities.reduce((sum, qty) => sum + qty, 0);
    const rowAttributionIsProven = distinctBeds.length > 0 && rowQuantities.every(Boolean) && rowSum === total;

    if (rowAttributionIsProven) {
      rowBeds.forEach(({ row, id }) => {
        const normalized = normalizeBed(id, row);
        const previous = byBed.get(normalized.bedenganId) || { ...normalized, qty: 0, provenance: [] };
        previous.qty += positiveInt(row.disemai ?? row.totalDisemai ?? row.qty);
        previous.provenance.push(tx.docNo || tx.id || 'SEEDING');
        byBed.set(normalized.bedenganId, previous);
      });
    } else {
      unspecified.push({
        qty: total,
        provenance: [tx.docNo || tx.id || 'SEEDING'],
        bedenganIds: distinctBeds
      });
    }
  });

  return { records, byBed, unspecified };
}

function readAppliedSelections(batch) {
  const ids = batchIdentities(batch);
  const all = storage.get('selection_transactions', []);
  const records = Array.isArray(all) ? all.filter(tx =>
    matchesBatch(tx, ids) && isApproved(tx) && upper(tx.stockMutationStatus) === 'APPLIED' && upper(tx.stockMutationStatus) !== 'NOT_REQUIRED'
  ) : [];
  const byBed = new Map();
  let unallocated = 0;

  records.forEach(tx => {
    const lines = Array.isArray(tx.physicalStockLines) ? tx.physicalStockLines : null;
    if (lines) {
      lines.forEach(line => {
        const qty = positiveInt(line.shortage ?? line.jumlahAfkir ?? line.quantity);
        const id = bedIdentity(line);
        if (!id) { unallocated += qty; return; }
        const normalized = normalizeBed(id, line);
        const previous = byBed.get(normalized.bedenganId) || { ...normalized, qty: 0, provenance: [] };
        previous.qty += qty;
        previous.provenance.push(tx.docNo || tx.id || 'SELECTION');
        byBed.set(normalized.bedenganId, previous);
      });
      return;
    }

    const qty = positiveInt(tx.jumlahAfkir ?? tx.quantity ?? tx.bibitReject ?? tx.actualBibitSelectedQty);
    const id = bedIdentity(tx);
    if (!id) { unallocated += qty; return; }
    const normalized = normalizeBed(id, tx);
    const previous = byBed.get(normalized.bedenganId) || { ...normalized, qty: 0, provenance: [] };
    previous.qty += qty;
    previous.provenance.push(tx.docNo || tx.id || 'SELECTION');
    byBed.set(normalized.bedenganId, previous);
  });

  return { records, byBed, unallocated };
}

export function resolvePhysicalStockBedReference(batchOrId) {
  const batches = storage.get('nursery_batches', []);
  const batch = typeof batchOrId === 'object' ? batchOrId : (Array.isArray(batches) ? batches.find(item => batchIdentities(item).has(clean(batchOrId))) : null);
  if (!batch) return null;

  const seedings = readApprovedSeedings(batch);
  const selections = readAppliedSelections(batch);
  const officialBatchBalance = readOfficialBatchBalance(batch);
  const rows = new Map();

  const ensure = (idOrCode, source = null, status = null) => {
    const rawIdentity = clean(idOrCode);
    if (!rawIdentity) return null;
    if (upper(rawIdentity) === 'TOTAL_BATCH') {
      if (!rows.has('TOTAL_BATCH')) rows.set('TOTAL_BATCH', {
        bedenganId: null,
        bedenganCode: 'TOTAL_BATCH',
        bedenganName: null,
        masterFound: false,
        referenceStatus: status || REFERENCE_STATUS.UNSPECIFIED,
        approvedSeedingQty: 0,
        approvedAppliedSelectionQty: 0,
        provenance: { seeding: [], selection: [] }
      });
      return rows.get('TOTAL_BATCH');
    }
    const normalized = normalizeBed(rawIdentity, source);
    const key = normalized.bedenganId || 'UNSPECIFIED';
    if (!rows.has(key)) rows.set(key, {
      ...normalized,
      bedenganCode: normalized.bedenganCode || (key === 'UNSPECIFIED' ? 'UNSPECIFIED' : null),
      referenceStatus: status || normalized.referenceStatus,
      approvedSeedingQty: 0,
      approvedAppliedSelectionQty: 0,
      provenance: { seeding: [], selection: [] }
    });
    return rows.get(key);
  };

  seedings.byBed.forEach(item => {
    const row = ensure(item.bedenganId, item, item.referenceStatus);
    row.approvedSeedingQty += item.qty;
    row.provenance.seeding.push(...item.provenance);
  });

  selections.byBed.forEach(item => {
    const row = ensure(item.bedenganId, item, item.referenceStatus);
    row.approvedAppliedSelectionQty += item.qty;
    row.provenance.selection.push(...item.provenance);
  });

  const batchBedIds = Array.isArray(batch.bedenganIds) ? batch.bedenganIds.map(clean).filter(Boolean) : [];
  batchBedIds.forEach(id => {
    const normalized = normalizeBed(id);
    ensure(id, null, normalized.masterFound ? REFERENCE_STATUS.UNSPECIFIED : REFERENCE_STATUS.RAW_ID);
  });
  seedings.unspecified.forEach(item => {
    const identifiedBeds = item.bedenganIds.map(clean).filter(Boolean);
    if (identifiedBeds.length) {
      identifiedBeds.forEach(id => {
        const normalized = normalizeBed(id);
        const row = ensure(id, null, normalized.masterFound ? REFERENCE_STATUS.UNSPECIFIED : REFERENCE_STATUS.RAW_ID);
        row.provenance.seeding.push(...item.provenance);
      });
      return;
    }

    const row = ensure('TOTAL_BATCH', null, REFERENCE_STATUS.UNSPECIFIED);
    row.approvedSeedingQty += item.qty;
    row.provenance.seeding.push(...item.provenance);
  });

  if (rows.size === 0) rows.set('TOTAL_BATCH', {
    bedenganId: null,
    bedenganCode: 'TOTAL_BATCH',
    bedenganName: null,
    masterFound: false,
    referenceStatus: REFERENCE_STATUS.UNSPECIFIED,
    approvedSeedingQty: 0,
    approvedAppliedSelectionQty: selections.unallocated,
    provenance: { seeding: [], selection: selections.records.map(item => item.docNo || item.id || 'SELECTION') }
  });

  const normalizedRows = [...rows.values()].map(row => {
    const referenceQty = Math.max(0, row.approvedSeedingQty - row.approvedAppliedSelectionQty);
    const valid = row.referenceStatus === REFERENCE_STATUS.VALID && row.approvedSeedingQty > 0;
    return {
      ...row,
      referenceStatus: valid ? REFERENCE_STATUS.VALID : (row.referenceStatus || REFERENCE_STATUS.UNSPECIFIED),
      referenceQty: valid ? referenceQty : null
    };
  });

  const unresolvedBedenganDiagnostics = normalizedRows
    .filter(row => row.referenceStatus === REFERENCE_STATUS.RAW_ID)
    .map(row => ({
      rawBedenganId: row.bedenganId || row.bedenganCode,
      reason: 'MASTER_BEDENGAN_NOT_FOUND',
      approvedSeedingQty: Number(row.approvedSeedingQty || 0),
      approvedAppliedSelectionQty: Number(row.approvedAppliedSelectionQty || 0),
      provenance: row.provenance || { seeding: [], selection: [] }
    }));

  let referenceRows = normalizedRows.filter(row => row.referenceStatus !== REFERENCE_STATUS.RAW_ID);
  if (referenceRows.length === 0) referenceRows = [{
    bedenganId: null,
    bedenganCode: 'TOTAL_BATCH',
    bedenganName: null,
    masterFound: false,
    referenceStatus: REFERENCE_STATUS.UNSPECIFIED,
    approvedSeedingQty: 0,
    approvedAppliedSelectionQty: 0,
    provenance: { seeding: [], selection: [] },
    referenceQty: null
  }];

  const attributedBedenganReferenceTotal = referenceRows
    .filter(row => row.referenceStatus === REFERENCE_STATUS.VALID)
    .reduce((sum, row) => sum + Number(row.referenceQty || 0), 0);
  const unallocatedBatchBalance = officialBatchBalance - attributedBedenganReferenceTotal;
  const hasHistory = seedings.records.length > 0 || selections.records.length > 0;
  const hasNegativeReference = referenceRows.some(row => row.approvedAppliedSelectionQty > row.approvedSeedingQty && row.referenceStatus === REFERENCE_STATUS.VALID);
  let reconciliationStatus = RECONCILIATION_STATUS.EXACT_MATCH;
  if (unresolvedBedenganDiagnostics.length) reconciliationStatus = RECONCILIATION_STATUS.LEDGER_RECONCILIATION_ANOMALY;
  else if (!hasHistory) reconciliationStatus = RECONCILIATION_STATUS.NO_TRANSACTION_HISTORY;
  else if (officialBatchBalance < 0 || hasNegativeReference) reconciliationStatus = RECONCILIATION_STATUS.LEDGER_RECONCILIATION_ANOMALY;
  else if (unallocatedBatchBalance !== 0) reconciliationStatus = RECONCILIATION_STATUS.HAS_UNALLOCATED_BALANCE;

  return {
    batchId: batch.id || batch.batchId || batch.batchCode,
    batchCode: batch.batchCode || batch.batchNo || batch.id || batch.batchId,
    officialBatchBalance,
    attributedBedenganReferenceTotal,
    unallocatedBatchBalance,
    reconciliationStatus,
    referenceRows,
    unresolvedBedenganDiagnostics,
    sourceCounts: { seeding: seedings.records.length, selection: selections.records.length },
    selectionUnallocatedQty: selections.unallocated
  };
}

export function isApprovalEligibleReference(reference) {
  if (!reference) return false;
  return reference.reconciliationStatus === RECONCILIATION_STATUS.EXACT_MATCH &&
    (!Array.isArray(reference.unresolvedBedenganDiagnostics) || reference.unresolvedBedenganDiagnostics.length === 0) &&
    reference.referenceRows.every(row => row.referenceStatus === REFERENCE_STATUS.VALID || row.referenceStatus === REFERENCE_STATUS.UNSPECIFIED);
}
