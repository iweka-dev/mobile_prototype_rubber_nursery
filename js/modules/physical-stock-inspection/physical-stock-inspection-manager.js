import { storage } from '../../core/storage.js';
import { getAllBatches } from '../../data/batch-master.js';
import {
  getAvailableQty,
  STORAGE_KEY_INVENTORY_JOURNAL
} from '../../core/batch-inventory-service.js';
import { normalizeRole, ROLES } from '../../core/user-context.js';
import { photoRepository } from '../../db/repositories.js';
import { formatCullDocNo } from '../../core/utils.js';

export const PHYSICAL_STOCK_STORAGE_KEY = 'physical_stock_inspections';
export const PHYSICAL_STOCK_CULL_KEY = 'physical_stock_cull_verifications';

export const PHYSICAL_STOCK_STATUS = Object.freeze({
  COUNTING: 'COUNTING',
  RECOUNT_REQUIRED: 'RECOUNT_REQUIRED',
  MATCHED: 'MATCHED',
  SURPLUS: 'SURPLUS',
  SHORTAGE_OPEN: 'SHORTAGE_OPEN',
  SHORTAGE_PENDING_VERIFICATION: 'SHORTAGE_PENDING_VERIFICATION',
  SHORTAGE_VERIFIED: 'SHORTAGE_VERIFIED',
  CORRECTED: 'CORRECTED',
  STOCK_CHANGED: 'STOCK_CHANGED'
});

function isPhysicalStockViewer(user) {
  if (!user) return false;
  const role = normalizeRole(user.role || user.rawRole);
  return role === ROLES.ASISTEN_BIBITAN || role === ROLES.ASKEP || role === 'ASISTEN_KEPALA' || role === ROLES.PENGURUS;
}

function assertAssistant(user) {
  if (!isPhysicalStockViewer(user)) {
    throw new Error('Hanya Asisten Bibitan yang dapat melakukan pemeriksaan stok fisik.');
  }
}

function assertAssistantOnly(user) {
  if (!user || normalizeRole(user.role || user.rawRole) !== ROLES.ASISTEN_BIBITAN) {
    throw new Error('Hanya Asisten Bibitan yang dapat melakukan pemeriksaan stok fisik.');
  }
}

function identities(batch) {
  return new Set([batch?.id, batch?.batchId, batch?.batchCode, batch?.batchNo, batch?.kode]
    .filter(Boolean).map(value => String(value).trim()));
}

function transactionMatchesBatch(tx, ids) {
  const root = [tx.batchId, tx.batchCode, tx.batchNo, tx.batch_code]
    .filter(Boolean).some(value => ids.has(String(value).trim()));
  const row = Array.isArray(tx.rows) && tx.rows.some(item =>
    [item.batchId, item.batchCode, item.batchNo].filter(Boolean)
      .some(value => ids.has(String(value).trim()))
  );
  return root || row;
}

function isApprovedSeeding(tx) {
  const status = String(tx.status || '').toUpperCase();
  const verification = String(tx.verificationStatus || '').toUpperCase();
  return tx.isFinal === true || status === 'DISETUJUI' || status === 'TERVERIFIKASI' ||
    verification === 'DISETUJUI' || verification === 'TERVERIFIKASI';
}

function inUserScope(batch, user) {
  const estateOk = !user?.estateId || !batch?.estateId || String(user.estateId).toUpperCase() === String(batch.estateId).toUpperCase();
  const role = normalizeRole(user?.role || user?.rawRole);
  const isManagerial = role === ROLES.ASKEP || role === 'ASISTEN_KEPALA' || role === ROLES.PENGURUS;
  const divisionOk = isManagerial || !user?.divisionId || !batch?.divisionId || String(user.divisionId).toUpperCase() === String(batch.divisionId).toUpperCase();
  return estateOk && divisionOk;
}

export function hasApprovedPindahSemai(batch) {
  const ids = identities(batch);
  return storage.get('seeding_transactions', []).some(tx =>
    !tx.isDeleted && !tx.deleted && String(tx.status || '').toUpperCase() !== 'DELETED' &&
    isApprovedSeeding(tx) && transactionMatchesBatch(tx, ids)
  );
}

function ledgerFingerprint(batch) {
  const ids = identities(batch);
  const entries = storage.get(STORAGE_KEY_INVENTORY_JOURNAL, [])
    .filter(item => ids.has(String(item.batchId || '').trim()) || ids.has(String(item.batchCode || '').trim()))
    .map(item => `${item.id || ''}:${item.batchSeq ?? ''}:${item.qtyIn || 0}:${item.qtyOut || 0}`);
  return `${getAvailableQty(batch.id || batch.batchId || batch.batchCode)}|${entries.join('|')}`;
}

export function isPhysicalStockInspectionStale(inspection) {
  if (!inspection || ![
    PHYSICAL_STOCK_STATUS.MATCHED,
    PHYSICAL_STOCK_STATUS.SURPLUS,
    PHYSICAL_STOCK_STATUS.SHORTAGE_OPEN
  ].includes(inspection.status) || inspection.stockMutationStatus === 'APPLIED') return false;
  const batch = getAllBatches().find(item => identities(item).has(String(inspection.batchId)));
  return !batch || ledgerFingerprint(batch) !== inspection.ledgerFingerprint;
}

function persistInspectionResults(records, targetId) {
  storage.set(PHYSICAL_STOCK_STORAGE_KEY, records);
  const persisted = storage.get(PHYSICAL_STOCK_STORAGE_KEY, null);
  const expected = records.find(item => item.id === targetId);
  const saved = Array.isArray(persisted) ? persisted.find(item => item.id === targetId) : null;
  const expectedSource = expected?.correctionOf
    ? records.find(item => item.id === expected.correctionOf)
    : null;
  const savedSource = expectedSource && Array.isArray(persisted)
    ? persisted.find(item => item.id === expectedSource.id)
    : null;
  const countsMatch = JSON.stringify(saved?.counts || null) === JSON.stringify(expected?.counts || null);
  const photoMatches = saved?.photoEvidence?.capturedAt === expected?.photoEvidence?.capturedAt &&
    saved?.photoEvidenceRef === expected?.photoEvidenceRef &&
    saved?.photoEvidence?.image === expected?.photoEvidence?.image;
  const resultMatches = saved && expected && saved.status === expected.status &&
    saved.physicalQty === expected.physicalQty && saved.difference === expected.difference &&
    saved.completedAt === expected.completedAt && countsMatch && photoMatches &&
    (!expectedSource || (savedSource?.status === PHYSICAL_STOCK_STATUS.CORRECTED &&
      savedSource?.supersededBy === expected.id));

  if (!resultMatches) {
    throw new Error('Hasil pemeriksaan belum tersimpan. Periksa ruang penyimpanan perangkat, lalu coba kunci kembali.');
  }
}

async function persistPhotoEvidenceReferences(inspectionId, photoEvidence) {
  const persistPhoto = async (id, evidence) => {
    const photoId = `PHYSICAL-STOCK:${id}`;
    await photoRepository.create({
      id: photoId,
      type: 'PHYSICAL_STOCK_INSPECTION',
      inspectionId: id,
      image: evidence.image,
      capturedAt: evidence.capturedAt,
      latitude: evidence.latitude ?? null,
      longitude: evidence.longitude ?? null
    });
    const saved = await photoRepository.getById(photoId);
    if (!saved || saved.image !== evidence.image) {
      throw new Error('Foto bukti belum tersimpan dengan aman. Periksa penyimpanan perangkat, lalu coba lagi.');
    }
    return photoId;
  };

  // Foto bukti disimpan di IndexedDB agar riwayat hitung/koreksi tidak memenuhi
  // batas kapasitas localStorage yang dipakai metadata pemeriksaan.
  const all = storage.get(PHYSICAL_STOCK_STORAGE_KEY, []);
  let changed = false;
  for (const record of all) {
    const image = record.photoEvidence?.image;
    if (typeof image !== 'string' || !image.startsWith('data:image/')) continue;
    const ref = await persistPhoto(record.id, record.photoEvidence);
    const { image: _image, ...metadata } = record.photoEvidence;
    record.photoEvidence = metadata;
    record.photoEvidenceRef = ref;
    changed = true;
  }

  const currentRef = await persistPhoto(inspectionId, photoEvidence);
  if (changed) {
    storage.set(PHYSICAL_STOCK_STORAGE_KEY, all);
    const savedRecords = storage.get(PHYSICAL_STOCK_STORAGE_KEY, []);
    if (!Array.isArray(savedRecords) || savedRecords.some(record =>
      record.photoEvidence?.image?.startsWith?.('data:image/') && !record.photoEvidenceRef
    )) {
      throw new Error('Riwayat foto belum dapat diringankan. Hasil belum dikunci; coba kembali.');
    }
  }
  return currentRef;
}

function latestForBatch(batchId) {
  return storage.get(PHYSICAL_STOCK_STORAGE_KEY, [])
    .filter(item => item.batchId === batchId)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0] || null;
}

export function getEligiblePhysicalStockBatches(user) {
  assertAssistant(user);
  return getAllBatches().filter(batch => {
    const key = batch.id || batch.batchId || batch.batchCode;
    return inUserScope(batch, user) && hasApprovedPindahSemai(batch) && getAvailableQty(key) > 0;
  }).map(batch => ({
    ...batch,
    physicalStockStatus: latestForBatch(batch.id || batch.batchId || batch.batchCode)?.status || 'BELUM_DIPERIKSA'
  }));
}

export function getPhysicalStockInspections(user) {
  assertAssistant(user);
  return storage.get(PHYSICAL_STOCK_STORAGE_KEY, []).filter(item => inUserScope(item, user));
}

export function startPhysicalStockInspection(batchId, user) {
  assertAssistantOnly(user);
  const batch = getAllBatches().find(item => identities(item).has(String(batchId).trim()));
  if (!batch || !inUserScope(batch, user)) throw new Error('Batch tidak ditemukan atau berada di luar lingkup Anda.');
  if (!hasApprovedPindahSemai(batch)) throw new Error('Batch belum memiliki Pindah Semai yang disetujui.');

  const all = storage.get(PHYSICAL_STOCK_STORAGE_KEY, []);
  const key = batch.id || batch.batchId || batch.batchCode;
  const active = all.find(item => item.batchId === key && [PHYSICAL_STOCK_STATUS.COUNTING, PHYSICAL_STOCK_STATUS.RECOUNT_REQUIRED].includes(item.status));
  if (active) return { ...active };

  const now = new Date().toISOString();
  const record = {
    id: `PSI-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
    docNo: `PSF/${new Date().getFullYear()}/${String(all.length + 1).padStart(5, '0')}`,
    batchId: key,
    batchCode: batch.batchCode || batch.batchNo || batch.kode || key,
    programId: batch.programId || null,
    estateId: batch.estateId || user.estateId || null,
    divisionId: batch.divisionId || user.divisionId || null,
    bedenganIds: Array.isArray(batch.bedenganIds) ? [...batch.bedenganIds] : [],
    status: PHYSICAL_STOCK_STATUS.COUNTING,
    systemQtySnapshot: getAvailableQty(key),
    ledgerFingerprint: ledgerFingerprint(batch),
    attempt: (latestForBatch(key)?.attempt || 0) + 1,
    createdAt: now,
    createdBy: user.userId || user.code || user.id,
    createdByName: user.name || null
  };
  all.push(record);
  storage.set(PHYSICAL_STOCK_STORAGE_KEY, all);
  return { ...record };
}

export function finalizePhysicalStockInspection(inspectionId, counts, user, photoEvidence = null, photoEvidenceRef = null) {
  assertAssistant(user);
  const all = storage.get(PHYSICAL_STOCK_STORAGE_KEY, []);
  const index = all.findIndex(item => item.id === inspectionId);
  if (index < 0) throw new Error('Pemeriksaan tidak ditemukan.');
  const target = all[index];
  if (![PHYSICAL_STOCK_STATUS.COUNTING, PHYSICAL_STOCK_STATUS.RECOUNT_REQUIRED].includes(target.status)) {
    return { ...target };
  }

  const rows = Array.isArray(counts) ? counts.map(row => ({
    bedenganId: row.bedenganId || null,
    physicalQty: Number(row.physicalQty)
  })) : [{ bedenganId: null, physicalQty: Number(counts) }];
  if (!rows.length || rows.some(row => !Number.isInteger(row.physicalQty) || row.physicalQty < 0)) {
    throw new Error('Jumlah fisik wajib berupa bilangan bulat nol atau lebih.');
  }
  if (!photoEvidence || typeof photoEvidence !== 'object' ||
      (!photoEvidenceRef && (typeof photoEvidence.image !== 'string' || !photoEvidence.image.startsWith('data:image/'))) ||
      !photoEvidence.capturedAt) {
    throw new Error('Foto bukti pemeriksaan dengan timestamp wajib dilampirkan.');
  }

  const batch = getAllBatches().find(item => identities(item).has(String(target.batchId)));
  if (!batch || ledgerFingerprint(batch) !== target.ledgerFingerprint) {
    target.status = PHYSICAL_STOCK_STATUS.RECOUNT_REQUIRED;
    target.invalidatedAt = new Date().toISOString();
    target.invalidatedReason = 'Saldo sistem berubah selama proses penghitungan.';
    storage.set(PHYSICAL_STOCK_STORAGE_KEY, all);
    throw new Error('Saldo sistem berubah saat penghitungan. Pemeriksaan harus dihitung ulang.');
  }

  const physicalQty = rows.reduce((sum, row) => sum + row.physicalQty, 0);
  const difference = physicalQty - target.systemQtySnapshot;
  target.counts = rows;
  target.photoEvidence = { ...photoEvidence };
  if (photoEvidenceRef) {
    delete target.photoEvidence.image;
    target.photoEvidenceRef = photoEvidenceRef;
  }
  target.physicalQty = physicalQty;
  target.difference = difference;
  target.status = difference === 0 ? PHYSICAL_STOCK_STATUS.MATCHED : (difference > 0 ? PHYSICAL_STOCK_STATUS.SURPLUS : PHYSICAL_STOCK_STATUS.SHORTAGE_OPEN);
  target.completedAt = new Date().toISOString();
  target.completedBy = user.userId || user.code || user.id;
  if (target.correctionOf) {
    const source = all.find(item => item.id === target.correctionOf);
    if (source) {
      source.status = PHYSICAL_STOCK_STATUS.CORRECTED;
      source.correctionStatus = 'COMPLETED';
      source.supersededBy = target.id;
      source.supersededAt = target.completedAt;
    }
  }
  persistInspectionResults(all, target.id);
  return { ...target };
}

export async function finalizePhysicalStockInspectionWithEvidence(inspectionId, counts, user, photoEvidence = null) {
  if (!photoEvidence || typeof photoEvidence.image !== 'string' || !photoEvidence.image.startsWith('data:image/')) {
    throw new Error('Foto bukti pemeriksaan dengan timestamp wajib dilampirkan.');
  }
  const photoEvidenceRef = await persistPhotoEvidenceReferences(inspectionId, photoEvidence);
  const { image: _image, ...metadata } = photoEvidence;
  return finalizePhysicalStockInspection(inspectionId, counts, user, metadata, photoEvidenceRef);
}

export function restartPhysicalStockInspection(inspectionId, user) {
  assertAssistantOnly(user);
  const all = storage.get(PHYSICAL_STOCK_STORAGE_KEY, []);
  const target = all.find(item => item.id === inspectionId);
  if (!target || target.status !== PHYSICAL_STOCK_STATUS.RECOUNT_REQUIRED) throw new Error('Pemeriksaan tidak memerlukan hitung ulang.');
  const batch = getAllBatches().find(item => identities(item).has(String(target.batchId)));
  target.systemQtySnapshot = getAvailableQty(target.batchId);
  target.ledgerFingerprint = ledgerFingerprint(batch);
  target.status = PHYSICAL_STOCK_STATUS.COUNTING;
  target.counts = null;
  target.physicalQty = null;
  target.difference = null;
  target.restartedAt = new Date().toISOString();
  storage.set(PHYSICAL_STOCK_STORAGE_KEY, all);
  return { ...target };
}

export function startPhysicalStockCorrection(inspectionId, user) {
  assertAssistantOnly(user);
  const all = storage.get(PHYSICAL_STOCK_STORAGE_KEY, []);
  const source = all.find(item => item.id === inspectionId);
  if (!source) throw new Error('Pemeriksaan yang akan dikoreksi tidak ditemukan.');
  if (source.status === PHYSICAL_STOCK_STATUS.SHORTAGE_VERIFIED || source.stockMutationStatus === 'APPLIED') {
    throw new Error('Hasil ini sudah memutasi stok. Koreksi wajib melalui pembatalan jurnal afkir.');
  }
  if (![PHYSICAL_STOCK_STATUS.MATCHED, PHYSICAL_STOCK_STATUS.SURPLUS, PHYSICAL_STOCK_STATUS.SHORTAGE_OPEN].includes(source.status)) {
    throw new Error('Hanya hasil pemeriksaan yang sudah dikunci dan belum memutasi stok yang dapat dikoreksi.');
  }
  const existing = all.find(item => item.correctionOf === source.id && [PHYSICAL_STOCK_STATUS.COUNTING, PHYSICAL_STOCK_STATUS.RECOUNT_REQUIRED].includes(item.status));
  if (existing) return { ...existing };

  const batch = getAllBatches().find(item => identities(item).has(String(source.batchId)));
  if (!batch) throw new Error('Batch pemeriksaan tidak ditemukan.');
  const now = new Date().toISOString();
  const correction = {
    id: `PSI-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
    docNo: `${source.docNo}-R${Number(source.revisionCount || 0) + 1}`,
    batchId: source.batchId,
    batchCode: source.batchCode,
    programId: source.programId || null,
    estateId: source.estateId || user.estateId || null,
    divisionId: source.divisionId || user.divisionId || null,
    bedenganIds: Array.isArray(source.bedenganIds) ? [...source.bedenganIds] : [],
    status: PHYSICAL_STOCK_STATUS.COUNTING,
    systemQtySnapshot: getAvailableQty(source.batchId),
    ledgerFingerprint: ledgerFingerprint(batch),
    attempt: Number(source.attempt || 1) + 1,
    correctionOf: source.id,
    correctionReason: null,
    createdAt: now,
    createdBy: user.userId || user.code || user.id,
    createdByName: user.name || null
  };
  source.correctionStatus = 'IN_PROGRESS';
  source.revisionCount = Number(source.revisionCount || 0) + 1;
  all.push(correction);
  storage.set(PHYSICAL_STOCK_STORAGE_KEY, all);
  return { ...correction };
}

export function cancelPhysicalStockDraft(inspectionId, user) {
  assertAssistantOnly(user);
  const all = storage.get(PHYSICAL_STOCK_STORAGE_KEY, []);
  const index = all.findIndex(item => item.id === inspectionId);
  if (index < 0) return false;
  const draft = all[index];
  if (draft.status !== PHYSICAL_STOCK_STATUS.COUNTING || (Array.isArray(draft.counts) && draft.counts.length > 0)) {
    throw new Error('Hanya draft pemeriksaan yang belum dikunci yang dapat dibatalkan.');
  }
  if (draft.correctionOf) {
    const source = all.find(item => item.id === draft.correctionOf);
    if (source && source.correctionStatus === 'IN_PROGRESS') {
      source.correctionStatus = null;
      source.correctionCancelledAt = new Date().toISOString();
      source.correctionCancelledBy = user.userId || user.code || user.id;
    }
  }
  all.splice(index, 1);
  storage.set(PHYSICAL_STOCK_STORAGE_KEY, all);
  return true;
}

export async function submitPhysicalStockShortageForVerification(inspectionId, user, notes = '') {
  assertAssistantOnly(user);
  const all = storage.get(PHYSICAL_STOCK_STORAGE_KEY, []);
  const index = all.findIndex(item => item.id === inspectionId);
  if (index < 0) throw new Error('Pemeriksaan tidak ditemukan.');
  const target = all[index];
  if (target.status === PHYSICAL_STOCK_STATUS.SHORTAGE_VERIFIED) return { ...target, idempotentSkipped: true };
  if (![PHYSICAL_STOCK_STATUS.SHORTAGE_OPEN, PHYSICAL_STOCK_STATUS.SHORTAGE_PENDING_VERIFICATION].includes(target.status)) {
    throw new Error('Pemeriksaan ini tidak memiliki selisih kurang yang dapat diajukan.');
  }

  const batch = getAllBatches().find(item => identities(item).has(String(target.batchId)));
  if (!batch || ledgerFingerprint(batch) !== target.ledgerFingerprint) {
    target.status = PHYSICAL_STOCK_STATUS.RECOUNT_REQUIRED;
    target.invalidatedAt = new Date().toISOString();
    target.invalidatedReason = 'Saldo sistem berubah sebelum pengajuan afkir.';
    storage.set(PHYSICAL_STOCK_STORAGE_KEY, all);
    throw new Error('Saldo sistem sudah berubah sejak pemeriksaan. Hitung ulang sebelum mengajukan afkir.');
  }

  const shortage = Math.abs(Number(target.difference));
  if (!Number.isInteger(shortage) || shortage <= 0) throw new Error('Jumlah selisih kurang tidak valid.');
  const now = new Date().toISOString();
  const year = new Date().getFullYear();
  const actorId = user.userId || user.code || user.id;
  const selections = storage.get('selection_transactions', []);
  let selection = selections.find(item => item.physicalStockInspectionId === target.id);

  if (!selection) {
    const sequenceMap = storage.get('cull_document_sequences', {}) || {};
    const sequenceKey = `${year}/PSF`;
    const existingMax = selections.reduce((max, item) => {
      const match = String(item.docNo || '').match(new RegExp(`^${year}/CULL/PSF/(\\d+)$`, 'i'));
      return match ? Math.max(max, Number(match[1])) : max;
    }, 0);
    const sequence = Math.max(Number(sequenceMap[sequenceKey] || 0), existingMax) + 1;
    sequenceMap[sequenceKey] = sequence;
    storage.set('cull_document_sequences', sequenceMap);
    const selectionId = `SEL-PSF-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    const selectionDocNo = formatCullDocNo(year, 'PSF', sequence);
    const bedenganIds = Array.isArray(target.bedenganIds) ? target.bedenganIds : [];
    selection = {
      id: selectionId,
      selectionId,
      docNo: selectionDocNo,
      selectionNo: selectionDocNo,
      selectionPoolDocNo: selectionDocNo,
      transactionType: 'PEMERIKSAAN_HASIL_SELEKSI',
      sourceModule: 'PHYSICAL_STOCK_INSPECTION',
      sourceTransactionType: 'PHYSICAL_STOCK_INSPECTION',
      sourceTransactionId: target.id,
      sourceDocNo: target.docNo,
      physicalStockInspectionId: target.id,
      physicalStockInspectionDocNo: target.docNo,
      originType: 'PHYSICAL_STOCK_SHORTAGE',
      estateId: target.estateId || user.estateId || null,
      divisionId: target.divisionId || user.divisionId || null,
      programId: target.programId || batch.programId || null,
      programCode: batch.programCode || null,
      programName: batch.programName || null,
      batchId: target.batchId,
      batchCode: target.batchCode || batch.batchCode || batch.batchNo || target.batchId,
      batchNo: target.batchCode || batch.batchCode || batch.batchNo || target.batchId,
      bedenganIds,
      bedenganId: bedenganIds[0] || null,
      bedenganCode: bedenganIds[0] || null,
      bedengan: bedenganIds.length ? bedenganIds.join(', ') : '-',
      clone: batch.clone || batch.klon || null,
      klon: batch.klon || batch.clone || null,
      category: 'SELISIH_STOK_FISIK',
      alasanDitolakCategory: 'Selisih kurang pemeriksaan stok fisik',
      alasan: 'Selisih kurang pemeriksaan stok fisik',
      alasanDetail: notes || `Afkir berdasarkan pemeriksaan stok fisik ${target.docNo}`,
      reason: 'Selisih kurang pemeriksaan stok fisik',
      catatan: notes || `Diajukan dari pemeriksaan stok fisik ${target.docNo}`,
      jumlahDiperiksa: Number(target.systemQtySnapshot),
      jumlahLayak: Number(target.physicalQty),
      jumlahAfkir: shortage,
      quantity: shortage,
      selectionStage: 'SELEKSI_PASCA_OKULASI',
      selectionType: 'PASCA_OKULASI',
      systemQtySnapshot: Number(target.systemQtySnapshot),
      physicalQty: Number(target.physicalQty),
      difference: Number(target.difference),
      tanggal: now.slice(0, 10),
      tanggalSeleksi: now.slice(0, 10),
      photoId: target.photoEvidenceRef || null,
      photoEvidenceRef: target.photoEvidenceRef || null,
      photoCapturedAt: target.photoEvidence?.capturedAt || null,
      latitude: target.photoEvidence?.latitude ?? null,
      longitude: target.photoEvidence?.longitude ?? null,
      status: 'MENUNGGU_VERIFIKASI_ASISTEN_BIBITAN',
      verificationStatus: 'MENUNGGU_VERIFIKASI',
      submissionStatus: 'SUBMITTED_TO_ASB',
      stockMutationStatus: 'PENDING',
      isFinal: false,
      submittedAt: now,
      submittedByUserId: actorId,
      submittedByName: user.name || 'Asisten Bibitan',
      submittedByRole: ROLES.ASISTEN_BIBITAN,
      createdAt: now,
      updatedAt: now,
      createdByUserId: actorId,
      createdByName: user.name || 'Asisten Bibitan',
      createdByRole: ROLES.ASISTEN_BIBITAN,
      createdByUserRole: ROLES.ASISTEN_BIBITAN,
      position: 'Asisten Bibitan'
    };
    selections.push(selection);
  } else if (selection.status !== 'DISETUJUI') {
    selection.status = 'MENUNGGU_VERIFIKASI_ASISTEN_BIBITAN';
    selection.verificationStatus = 'MENUNGGU_VERIFIKASI';
    selection.submissionStatus = 'SUBMITTED_TO_ASB';
    selection.returnReason = null;
    selection.submittedAt = now;
    selection.updatedAt = now;
  }
  storage.set('selection_transactions', selections);
  const savedSelection = storage.get('selection_transactions', []).find(item => item.id === selection.id);
  if (!savedSelection) throw new Error('Dokumen seleksi afkir belum berhasil disimpan. Coba kembali.');

  const verifications = storage.get('verification_transactions', []);
  const verificationIndex = verifications.findIndex(item =>
    String(item.referenceId) === String(selection.id) || String(item.referenceDocNo) === String(selection.docNo)
  );
  const verificationRecord = {
    verificationId: verificationIndex >= 0 ? verifications[verificationIndex].verificationId : `VRF-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    verificationNo: verificationIndex >= 0 ? verifications[verificationIndex].verificationNo : `VRF-${year}${String(new Date().getMonth() + 1).padStart(2, '0')}${String(new Date().getDate()).padStart(2, '0')}-${Math.floor(1000 + Math.random() * 9000)}`,
    referenceType: 'PENYELEKSIAN',
    referenceId: selection.id,
    referenceDocNo: selection.docNo,
    moduleType: 'PENYELEKSIAN',
    sourceModule: 'PHYSICAL_STOCK_INSPECTION',
    estateId: selection.estateId,
    divisionId: selection.divisionId,
    verificationStatus: 'MENUNGGU_VERIFIKASI',
    returnReason: null,
    findings: [],
    submittedAt: now,
    submittedByUserId: actorId,
    submittedByName: user.name || 'Asisten Bibitan',
    createdAt: verificationIndex >= 0 ? verifications[verificationIndex].createdAt : now,
    updatedAt: now
  };
  if (verificationIndex >= 0) verifications[verificationIndex] = { ...verifications[verificationIndex], ...verificationRecord };
  else verifications.push(verificationRecord);
  storage.set('verification_transactions', verifications);
  const savedVerification = storage.get('verification_transactions', []).find(item => item.referenceId === selection.id);
  if (!savedVerification) throw new Error('Pengajuan belum masuk ke halaman Verifikasi. Coba kembali.');

  target.status = PHYSICAL_STOCK_STATUS.SHORTAGE_PENDING_VERIFICATION;
  target.cullSubmissionStatus = 'SUBMITTED_TO_ASB';
  target.selectionTransactionId = selection.id;
  target.selectionDocNo = selection.docNo;
  target.cullSubmittedAt = now;
  target.cullSubmittedBy = actorId;
  all[index] = target;
  storage.set(PHYSICAL_STOCK_STORAGE_KEY, all);
  return { ...target, selectionTransaction: { ...selection } };
}

// Alias dipertahankan agar pemanggil lama tetap kompatibel. Perilakunya sekarang
// hanya mengajukan dokumen; mutasi stok dilakukan oleh persetujuan Verifikasi.
export const verifyPhysicalStockShortage = submitPhysicalStockShortageForVerification;

export function validatePhysicalStockCullSelection(selectionRecord) {
  if (!selectionRecord?.physicalStockInspectionId) return { isValid: true };
  const inspection = storage.get(PHYSICAL_STOCK_STORAGE_KEY, [])
    .find(item => item.id === selectionRecord.physicalStockInspectionId);
  if (!inspection) return { isValid: false, reason: 'Pemeriksaan stok fisik sumber tidak ditemukan.' };
  if (inspection.status === PHYSICAL_STOCK_STATUS.SHORTAGE_VERIFIED && selectionRecord.status === 'DISETUJUI') {
    return { isValid: true, inspection };
  }
  if (inspection.selectionTransactionId && inspection.selectionTransactionId !== selectionRecord.id) {
    return { isValid: false, reason: 'Dokumen seleksi tidak sesuai dengan pengajuan pemeriksaan stok.' };
  }
  const shortage = Math.abs(Number(inspection.difference));
  if (shortage !== Number(selectionRecord.jumlahAfkir || selectionRecord.quantity || 0)) {
    return { isValid: false, reason: 'Jumlah afkir tidak sesuai dengan selisih pemeriksaan stok fisik.' };
  }
  const batch = getAllBatches().find(item => identities(item).has(String(inspection.batchId)));
  if (!batch || ledgerFingerprint(batch) !== inspection.ledgerFingerprint) {
    return { isValid: false, reason: 'Saldo batch berubah setelah pemeriksaan stok. Lakukan hitung ulang sebelum persetujuan.' };
  }
  return { isValid: true, inspection };
}

export function completePhysicalStockCullVerification(selectionRecord, currentUser, inventoryJournalId = null) {
  if (!selectionRecord?.physicalStockInspectionId) return null;
  const all = storage.get(PHYSICAL_STOCK_STORAGE_KEY, []);
  const index = all.findIndex(item => item.id === selectionRecord.physicalStockInspectionId);
  if (index < 0) return null;
  const target = all[index];
  const now = new Date().toISOString();
  target.status = PHYSICAL_STOCK_STATUS.SHORTAGE_VERIFIED;
  target.cullSubmissionStatus = 'APPROVED';
  target.shortageVerifiedAt = now;
  target.shortageVerifiedBy = currentUser?.userId || currentUser?.code || currentUser?.id;
  target.shortageVerifiedByName = currentUser?.name || null;
  target.selectionTransactionId = selectionRecord.id;
  target.selectionDocNo = selectionRecord.docNo;
  target.inventoryJournalId = inventoryJournalId || selectionRecord.inventoryJournalId || target.inventoryJournalId || null;
  target.stockMutationStatus = 'APPLIED';
  all[index] = target;
  storage.set(PHYSICAL_STOCK_STORAGE_KEY, all);

  const verifications = storage.get(PHYSICAL_STOCK_CULL_KEY, []);
  const existing = verifications.find(item => item.inspectionId === target.id);
  const record = {
    id: existing?.id || `PSCV-${target.id}`,
    inspectionId: target.id,
    docNo: target.docNo,
    selectionTransactionId: selectionRecord.id,
    selectionDocNo: selectionRecord.docNo,
    batchId: target.batchId,
    batchCode: target.batchCode,
    quantity: Math.abs(Number(target.difference)),
    status: 'DISETUJUI',
    stockMutationStatus: 'APPLIED',
    inventoryJournalId: target.inventoryJournalId,
    verifiedAt: now,
    verifiedBy: target.shortageVerifiedBy,
    verifiedByName: target.shortageVerifiedByName
  };
  if (existing) Object.assign(existing, record); else verifications.push(record);
  storage.set(PHYSICAL_STOCK_CULL_KEY, verifications);
  return { ...target };
}

export function returnPhysicalStockCullVerification(selectionRecord, currentUser, reason = '') {
  if (!selectionRecord?.physicalStockInspectionId) return null;
  const all = storage.get(PHYSICAL_STOCK_STORAGE_KEY, []);
  const target = all.find(item => item.id === selectionRecord.physicalStockInspectionId);
  if (!target || target.status === PHYSICAL_STOCK_STATUS.SHORTAGE_VERIFIED) return null;
  target.status = PHYSICAL_STOCK_STATUS.SHORTAGE_OPEN;
  target.cullSubmissionStatus = 'RETURNED';
  target.cullReturnReason = reason || '';
  target.cullReturnedAt = new Date().toISOString();
  target.cullReturnedBy = currentUser?.userId || currentUser?.code || currentUser?.id;
  storage.set(PHYSICAL_STOCK_STORAGE_KEY, all);
  return { ...target };
}

export function getPhysicalStockActionableCount(user) {
  try {
    return getEligiblePhysicalStockBatches(user).filter(batch => {
      const latest = latestForBatch(batch.id || batch.batchId || batch.batchCode);
      return !latest || [PHYSICAL_STOCK_STATUS.SHORTAGE_OPEN, PHYSICAL_STOCK_STATUS.RECOUNT_REQUIRED].includes(latest.status);
    }).length;
  } catch (_) {
    return 0;
  }
}

export function parseDateToTime(val) {
  if (!val) return null;
  if (typeof val === 'number') return isNaN(val) || val <= 0 ? null : val;
  if (val instanceof Date) return isNaN(val.getTime()) ? null : val.getTime();
  const str = String(val).trim();
  if (!str || str === '-') return null;
  const dmy = str.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (dmy) {
    const [, d, m, y] = dmy;
    const date = new Date(Number(y), Number(m) - 1, Number(d));
    return isNaN(date.getTime()) ? null : date.getTime();
  }
  const parsed = new Date(str).getTime();
  return isNaN(parsed) ? null : parsed;
}

/**
 * Menghitung umur bibit dihitung sejak awal di germinasi / dederan
 * Mendukung dederan_transactions, seeding_transactions (Pindah Semai), dan atribut master batch.
 */
export function getSeedlingAgeFromGermination(batch) {
  if (!batch) {
    return { days: 0, weeks: 0, months: 0, text: '-', formatted: '-' };
  }

  const ids = identities(batch);
  const candidateDates = [];

  // 1. Atribut tanggal langsung pada batch
  const directKeys = [
    'tanggalDeder', 'tanggalGerminasi', 'germinationDate', 
    'tanggalSemai', 'seedingDate', 'plantedAt', 'tanggal'
  ];
  for (const k of directKeys) {
    if (batch[k]) {
      const t = parseDateToTime(batch[k]);
      if (t) candidateDates.push(t);
    }
  }

  // Bedengan batch untuk relasi dederan
  const batchBeds = new Set([
    batch.bedengan,
    batch.bedenganCode,
    ...(Array.isArray(batch.bedenganIds) ? batch.bedenganIds : [])
  ].filter(Boolean).map(v => String(v).trim().toUpperCase()));

  // 2. Dederan transactions (fase dederan/germinasi awal)
  const dederanTxs = storage.get('dederan_transactions', []);
  const matchingDederans = dederanTxs.filter(d => {
    if (d.isDeleted || d.deleted || String(d.status || '').toUpperCase() === 'DELETED') return false;
    const dIds = [d.batchId, d.batchCode, d.batchNo, d.id, d.docNo].filter(Boolean).map(v => String(v).trim());
    if (dIds.some(id => ids.has(id))) return true;
    const dBeds = [d.bedengan, d.bedenganCode, d.bedenganId].filter(Boolean).map(v => String(v).trim().toUpperCase());
    if (dBeds.some(b => batchBeds.has(b))) return true;
    return false;
  });

  matchingDederans.forEach(d => {
    const t = parseDateToTime(d.tanggalDeder || d.tanggalPemeriksaan || d.tanggal || d.date || d.createdAt);
    if (t) candidateDates.push(t);
  });

  // 3. Seeding transactions (Pindah Semai)
  const seedingTxs = storage.get('seeding_transactions', []);
  const matchingSeedings = seedingTxs.filter(s => {
    if (s.isDeleted || s.deleted || String(s.status || '').toUpperCase() === 'DELETED') return false;
    return transactionMatchesBatch(s, ids);
  });

  matchingSeedings.forEach(s => {
    if (s.tanggalDeder) {
      const t = parseDateToTime(s.tanggalDeder);
      if (t) candidateDates.push(t);
    }
    const targetDoc = s.sourceDederDocNo || s.sourceDederTxId || s.sourceDocNo || s.dederanTxDocNo || s.dederanDocNo;
    if (targetDoc) {
      const linkedDeder = dederanTxs.find(d => d.docNo === targetDoc || d.id === targetDoc);
      if (linkedDeder) {
        const t = parseDateToTime(linkedDeder.tanggalDeder || linkedDeder.tanggalPemeriksaan || linkedDeder.tanggal || linkedDeder.createdAt);
        if (t) candidateDates.push(t);
      }
    }
    const seedTime = parseDateToTime(s.plantedAt || s.seedingDate || s.tanggalSemai || s.tanggal || s.date);
    if (seedTime) {
      candidateDates.push(seedTime);
    }
  });

  // 4. Fallback ke batch.createdAt
  if (batch.createdAt) {
    const t = parseDateToTime(batch.createdAt);
    if (t) candidateDates.push(t);
  }

  if (candidateDates.length === 0) {
    return { days: 0, weeks: 0, months: 0, text: '-', formatted: '-' };
  }

  candidateDates.sort((a, b) => a - b);
  const earliestTime = candidateDates[0];

  const now = Date.now();
  const diffMs = Math.max(0, now - earliestTime);
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const weeks = Math.floor(days / 7);
  const months = Math.floor(days / 30);

  let formatted = '';
  if (weeks > 0) {
    formatted = `${weeks} Minggu (${days} Hari)`;
  } else {
    formatted = `${days} Hari`;
  }

  return {
    days,
    weeks,
    months,
    startDate: new Date(earliestTime).toISOString(),
    formatted,
    text: weeks > 0 ? `${weeks} Minggu` : `${days} Hari`
  };
}


