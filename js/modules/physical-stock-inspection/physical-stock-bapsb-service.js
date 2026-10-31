/**
 * js/modules/physical-stock-inspection/physical-stock-bapsb-service.js
 * Service Manajemen Berita Acara Rekonsiliasi Stok Fisik (BAPSB)
 * 
 * Prinsip:
 * 1. Zero Data Loss: Seluruh putaran penghitungan (Audit Trail) disimpan utuh di dokumen BA.
 * 2. Persetujuan Berjenjang 3 Tingkat: Asisten Bibitan (ASB) -> Asisten Kepala (Askep) -> Pengurus Kebun (FINAL).
 * 3. Mutasi stok hanya boleh dilakukan setelah BA final melalui Central Hub.
 */

import { storage } from '../../core/storage.js';
import { normalizeRole, ROLES } from '../../core/user-context.js';
import {
  PHYSICAL_STOCK_STORAGE_KEY,
  PHYSICAL_STOCK_STATUS,
  getPhysicalStockLedgerFingerprint
} from './physical-stock-inspection-manager.js';
import { getAllBatches } from '../../data/batch-master.js';

export const PHYSICAL_STOCK_BAPSB_KEY = 'physical_stock_bapsb';

export const BAPSB_STATUS = Object.freeze({
  DRAFT_ASB: 'DRAFT_ASB',
  MENUNGGU_PERSETUJUAN_ASKEP: 'MENUNGGU_PERSETUJUAN_ASKEP',
  MENUNGGU_PENGURUS: 'MENUNGGU_PENGURUS',
  FINAL: 'FINAL',
  FINAL_PENDING_APPLICATION: 'FINAL_PENDING_APPLICATION',
  APPLICATION_PROCESSING: 'APPLICATION_PROCESSING',
  APPLIED: 'APPLIED',
  APPLICATION_BLOCKED: 'APPLICATION_BLOCKED',
  RETURNED_TO_ASB: 'RETURNED_TO_ASB'
});

export const BAPSB_STATUS_LABELS = Object.freeze({
  [BAPSB_STATUS.DRAFT_ASB]: 'Draf BA',
  [BAPSB_STATUS.MENUNGGU_PERSETUJUAN_ASKEP]: 'MENUNGGU ASKEP',
  [BAPSB_STATUS.MENUNGGU_PENGURUS]: 'MENUNGGU PENGURUS',
  [BAPSB_STATUS.FINAL]: 'Disetujui',
  [BAPSB_STATUS.FINAL_PENDING_APPLICATION]: 'MENUNGGU PENERAPAN',
  [BAPSB_STATUS.APPLICATION_PROCESSING]: 'SEDANG DITERAPKAN',
  [BAPSB_STATUS.APPLIED]: 'REKONSILIASI DITERAPKAN',
  [BAPSB_STATUS.APPLICATION_BLOCKED]: 'PENERAPAN DIBLOKIR',
  [BAPSB_STATUS.RETURNED_TO_ASB]: 'DIKEMBALIKAN KE ASB'
});

/**
 * Generate nomor dokumen resmi Berita Acara Pemeriksaan Stok Fisik
 * Format: BAPSB/{ESTATE}/{DIVISI}/{TAHUN}/{BULAN}/{SEQ}
 */
export function generateBapsbDocNo(estateCode = 'TB', divisionCode = 'DIV-I') {
  const allBapsb = storage.get(PHYSICAL_STOCK_BAPSB_KEY, []);
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const cleanEstate = String(estateCode || 'TB').replace(/^EST-/, '').toUpperCase();
  const cleanDiv = String(divisionCode || 'DIV-I').replace(/^DIV-0*/, 'DIV-').toUpperCase();
  
  const count = allBapsb.length + 1;
  const seq = String(count).padStart(3, '0');
  return `BAPSB/${cleanEstate}/${cleanDiv}/${year}/${month}/${seq}`;
}

/**
 * Mengumpulkan seluruh riwayat penghitungan (putaran sensus) untuk pemeriksaan tertentu
 * Menjamin tidak ada satu pun hasil hitung yang hilang dari rekam jejak.
 */
export function collectAuditTrailForInspection(inspectionId) {
  const allInspections = storage.get(PHYSICAL_STOCK_STORAGE_KEY, []);
  const target = allInspections.find(item => item.id === inspectionId);
  if (!target) return [];

  // Temukan seluruh rantai revisi yang terkait dengan batch ini
  const related = allInspections.filter(item => 
    item.batchId === target.batchId || 
    item.id === target.id || 
    item.correctionOf === target.id ||
    target.correctionOf === item.id
  );

  // Filter hanya pemeriksaan yang telah memiliki hasil hitung
  const completedAttempts = related.filter(item => 
    item.physicalQty !== null && 
    item.physicalQty !== undefined &&
    item.counts && 
    item.counts.length > 0
  );

  // Urutkan berdasarkan waktu pembuatan / penyelesaian
  completedAttempts.sort((a, b) => {
    const aDate = a.completedAt || a.createdAt || '';
    const bDate = b.completedAt || b.createdAt || '';
    return String(aDate).localeCompare(String(bDate));
  });

  return completedAttempts.map((item, index) => ({
    round: index + 1,
    inspectionId: item.id,
    docNo: item.docNo || `PSI-ROUND-${index + 1}`,
    physicalQty: Number(item.physicalQty || 0),
    systemQtySnapshot: Number(item.systemQtySnapshot || 0),
    difference: Number(item.difference || 0),
    completedAt: item.completedAt || item.createdAt || new Date().toISOString(),
    completedBy: item.completedBy || item.createdBy || 'Petugas',
    completedByName: item.createdByName || 'Asisten Bibitan',
    photoEvidenceRef: item.photoEvidenceRef || null,
    photoEvidence: item.photoEvidence || null,
    bedenganDetails: Array.isArray(item.counts) ? item.counts.map(row => ({
      bedenganId: row.bedenganId || null,
      bedenganCode: row.bedenganCode || row.bedenganId || 'TOTAL_BATCH',
      referenceQty: row.referenceQty ?? null,
      physicalQty: Number(row.physicalQty || 0),
      difference: row.difference ?? null,
      reason: row.reason || '',
      referenceStatus: row.referenceStatus || 'LEGACY'
    })) : [],
    notes: (item.notes && item.notes !== 'Pemeriksaan sensus fisik confirmed' ? item.notes : null) || null
  }));
}

/**
 * Level 1: Asisten Bibitan menerbitkan Draf BA Rekonsiliasi Stok Fisik
 */
export function createBapsbDraft(inspectionId, user, payload = {}) {
  const role = normalizeRole(user?.role || user?.rawRole);
  if (role !== ROLES.ASISTEN_BIBITAN) {
    throw new Error('Hanya Asisten Bibitan yang berwenang menerbitkan draf Berita Acara Pemeriksaan Stok Fisik.');
  }

  const allInspections = storage.get(PHYSICAL_STOCK_STORAGE_KEY, []);
  const inspection = allInspections.find(item => item.id === inspectionId);
  if (!inspection) {
    throw new Error('Data pemeriksaan stok fisik sumber tidak ditemukan.');
  }

  if (inspection.differenceProfile === 'UNRESOLVED' || (inspection.reconciliationSnapshot && inspection.reconciliationSnapshot.reconciliationStatus !== 'EXACT_MATCH')) {
    throw new Error('Referensi Bedengan belum dapat direkonsiliasi. Berita Acara belum dapat diterbitkan.');
  }

  const reconciliationLines = Array.isArray(inspection.counts)
    ? inspection.counts.filter(row => row.referenceStatus === 'VALID' && Number(row.difference) !== 0).map((row, index) => {
      const difference = Number(row.difference || 0);
      return {
        lineId: `${inspection.id}-L${index + 1}`,
        bedenganId: row.bedenganId || null,
        bedenganCode: row.bedenganCode || row.bedenganId || 'TOTAL_BATCH',
        referenceQty: Number(row.referenceQty || 0),
        physicalQty: Number(row.physicalQty || 0),
        difference,
        direction: difference > 0 ? 'SURPLUS' : 'SHORTAGE',
        quantity: Math.abs(difference),
        reason: String(row.reason || '').trim(),
        referenceStatus: row.referenceStatus,
        provenance: row.provenance || { seeding: [], selection: [] },
        inventoryJournalId: null
      };
    }) : [];
  if (!reconciliationLines.length) {
    throw new Error('BA Rekonsiliasi hanya dapat diterbitkan untuk pemeriksaan yang memiliki selisih valid.');
  }
  if (reconciliationLines.some(line => !line.reason)) {
    throw new Error('Alasan selisih wajib lengkap untuk setiap Bedengan.');
  }
  const totalSurplusQty = reconciliationLines.filter(line => line.direction === 'SURPLUS').reduce((sum, line) => sum + line.quantity, 0);
  const totalShortageQty = reconciliationLines.filter(line => line.direction === 'SHORTAGE').reduce((sum, line) => sum + line.quantity, 0);
  const diff = Number(inspection.difference || (totalSurplusQty - totalShortageQty));

  const allBapsb = storage.get(PHYSICAL_STOCK_BAPSB_KEY, []);
  const existing = allBapsb.find(b => b.inspectionId === inspectionId);
  if (existing && existing.status !== BAPSB_STATUS.RETURNED_TO_ASB) {
    return existing;
  }

  const allBatches = getAllBatches();
  const batch = allBatches.find(b => 
    String(b.id) === String(inspection.batchId) || 
    String(b.batchId) === String(inspection.batchId) || 
    String(b.batchCode) === String(inspection.batchCode)
  );

  const now = new Date().toISOString();
  const auditTrail = collectAuditTrailForInspection(inspectionId);
  const docNo = existing?.docNo || generateBapsbDocNo(batch?.estateCode || user.estateCode || 'TB', batch?.divisionCode || user.divisionCode || 'DIV-I');

  // Bukti Foto Fisik Sensus (Maksimal 2 foto)
  const collectedPhotos = [];
  if (Array.isArray(payload.photos) && payload.photos.length > 0) {
    collectedPhotos.push(...payload.photos);
  } else if (payload.photoEvidence) {
    collectedPhotos.push(payload.photoEvidence);
  } else if (Array.isArray(inspection.photos) && inspection.photos.length > 0) {
    collectedPhotos.push(...inspection.photos);
  } else if (inspection.photoEvidence) {
    collectedPhotos.push(inspection.photoEvidence);
  }

  if (collectedPhotos.length === 0 && Array.isArray(auditTrail)) {
    auditTrail.forEach(item => {
      if (item.photoEvidence) {
        collectedPhotos.push(typeof item.photoEvidence === 'object' ? { ...item.photoEvidence, round: item.round } : item.photoEvidence);
      } else if (Array.isArray(item.photos)) {
        collectedPhotos.push(...item.photos);
      }
    });
  }

  const bapsbDoc = {
    id: existing?.id || `BAPSB-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
    docNo,
    documentType: 'PHYSICAL_STOCK_RECONCILIATION',
    inspectionId: inspection.id,
    inspectionDocNo: inspection.docNo,
    batchId: inspection.batchId,
    batchCode: inspection.batchCode,
    programId: inspection.programId || batch?.programId || null,
    programCode: batch?.programCode || 'Program Bibitan',
    programName: batch?.programName || 'Bibitan Karet',
    estateId: inspection.estateId || batch?.estateId || user.estateId || 'EST-TBS',
    estateCode: batch?.estateCode || 'TB',
    estateName: batch?.estateName || 'Tanah Besih',
    divisionId: inspection.divisionId || batch?.divisionId || user.divisionId || 'DIV-001',
    divisionCode: batch?.divisionCode || 'DIV-I',
    divisionName: batch?.divisionName || 'Divisi I',
    bedenganIds: Array.isArray(inspection.bedenganIds) ? [...inspection.bedenganIds] : [],
    bedenganDetails: reconciliationLines,
    reconciliationLines,
    differenceProfile: inspection.differenceProfile || (totalSurplusQty > 0 && totalShortageQty > 0 ? 'MIXED' : totalSurplusQty > 0 ? 'SURPLUS' : 'SHORTAGE'),
    
    // Rincian Stok
    systemQty: Number(inspection.systemQtySnapshot || (Number(inspection.physicalQty || 0) - diff) || 0),
    systemQtySnapshot: Number(inspection.systemQtySnapshot || (Number(inspection.physicalQty || 0) - diff) || 0),
    physicalQty: Number(inspection.physicalQty || 0),
    surplusQty: totalSurplusQty,
    shortageQty: totalShortageQty,
    totalSurplusQty,
    totalShortageQty,
    netDifference: totalSurplusQty - totalShortageQty,
    ledgerFingerprintAtInspection: inspection.ledgerFingerprint || null,
    
    // Rekam Jejak Pemeriksaan Berulang (Audit Trail)
    auditTrail: auditTrail.length > 0 ? auditTrail : [{
      round: 1,
      inspectionId: inspection.id,
      docNo: inspection.docNo,
      physicalQty: Number(inspection.physicalQty || 0),
      systemQtySnapshot: Number(inspection.systemQtySnapshot || 0),
      difference: diff,
      completedAt: inspection.completedAt || now,
      completedByName: user.name || 'Asisten Bibitan',
      notes: null
    }],

    // Bukti Foto Fisik Pemeriksaan di Lapangan
    photos: (existing?.photos && existing.photos.length > 0) ? existing.photos : collectedPhotos.slice(0, 2),
    photoEvidence: existing?.photoEvidence || collectedPhotos[0] || null,

    // Justifikasi Lapangan
    justifikasi: payload.justifikasi || 'Hasil pemeriksaan stok fisik dikunci dan diajukan untuk persetujuan berjenjang sebelum diterapkan ke Inventory Ledger.',
    
    // Status Alur
    status: BAPSB_STATUS.MENUNGGU_PERSETUJUAN_ASKEP,
    approvalStatus: BAPSB_STATUS.MENUNGGU_PERSETUJUAN_ASKEP,
    applicationStatus: 'NOT_READY',
    applicationIntentId: null,
    inventoryJournalIds: [],
    selectionTransactionId: null,
    appliedAt: null,
    appliedBy: null,
    applicationError: null,
    isFinal: false,
    
    // Tanda Tangan 3 Tingkat Berjenjang
    signatures: {
      asb: {
        signed: true,
        name: user.name || 'Budi Santoso',
        code: user.code || user.userId || user.id,
        roleTitle: 'Asisten Divisi Bibitan',
        signedAt: now,
        signatureDataUrl: payload.signatureDataUrl || null
      },
      askep: {
        signed: false,
        name: null,
        code: null,
        roleTitle: 'Asisten Kepala',
        signedAt: null,
        signatureDataUrl: null,
        notes: null
      },
      pengurus: {
        signed: false,
        name: null,
        code: null,
        roleTitle: 'Pengurus Kebun',
        signedAt: null,
        signatureDataUrl: null,
        notes: null
      }
    },

    createdAt: existing?.createdAt || now,
    createdBy: user.userId || user.code || user.id,
    createdByName: user.name || 'Asisten Bibitan',
    updatedAt: now
  };

  if (existing) {
    const idx = allBapsb.findIndex(b => b.id === existing.id);
    allBapsb[idx] = bapsbDoc;
  } else {
    allBapsb.push(bapsbDoc);
  }
  storage.set(PHYSICAL_STOCK_BAPSB_KEY, allBapsb);

  // Update pointer pada pemeriksaan stok fisik
  const inspIdx = allInspections.findIndex(item => item.id === inspectionId);
  if (inspIdx >= 0) {
    allInspections[inspIdx].bapsbId = bapsbDoc.id;
    allInspections[inspIdx].bapsbDocNo = bapsbDoc.docNo;
    allInspections[inspIdx].bapsbStatus = bapsbDoc.status;
    storage.set(PHYSICAL_STOCK_STORAGE_KEY, allInspections);
  }

  return bapsbDoc;
}

/**
 * Level 2: Asisten Kepala memverifikasi dan menandatangani Berita Acara
 */
export function signBapsbAskep(bapsbId, user, payload = {}) {
  const role = normalizeRole(user?.role || user?.rawRole);
  const isAskep = role === ROLES.ASKEP || role === 'ASISTEN_KEPALA';
  if (!isAskep) {
    throw new Error('Hanya Asisten Kepala (Askep) yang berwenang memverifikasi Berita Acara ini.');
  }

  const allBapsb = storage.get(PHYSICAL_STOCK_BAPSB_KEY, []);
  const bapsb = allBapsb.find(b => b.id === bapsbId);
  if (!bapsb) throw new Error('Dokumen Berita Acara tidak ditemukan.');
  if (bapsb.status !== BAPSB_STATUS.MENUNGGU_PERSETUJUAN_ASKEP) {
    throw new Error(`Dokumen tidak dalam status menunggu persetujuan Askep (Status saat ini: ${bapsb.status}).`);
  }

  const now = new Date().toISOString();
  bapsb.signatures.askep = {
    signed: true,
    name: user.name || 'Beny Sihotang',
    code: user.code || user.userId || user.id,
    roleTitle: 'Asisten Kepala',
    signedAt: now,
    signatureDataUrl: payload.signatureDataUrl || null,
    notes: payload.notes || 'Hasil sensus fisik dan rekam jejak telah diverifikasi.'
  };
  bapsb.status = BAPSB_STATUS.MENUNGGU_PENGURUS;
  bapsb.approvalStatus = BAPSB_STATUS.MENUNGGU_PENGURUS;
  bapsb.updatedAt = now;

  storage.set(PHYSICAL_STOCK_BAPSB_KEY, allBapsb);

  // Update status pada inspeksi
  const allInspections = storage.get(PHYSICAL_STOCK_STORAGE_KEY, []);
  const insp = allInspections.find(item => item.id === bapsb.inspectionId);
  if (insp) {
    insp.bapsbStatus = bapsb.status;
    storage.set(PHYSICAL_STOCK_STORAGE_KEY, allInspections);
  }

  return bapsb;
}

/**
 * Level 2 Alternatif: Askep mengembalikan Berita Acara ke ASB untuk sensus ulang
 */
export function returnBapsbAskep(bapsbId, user, reason = '') {
  const role = normalizeRole(user?.role || user?.rawRole);
  const isAskep = role === ROLES.ASKEP || role === 'ASISTEN_KEPALA';
  if (!isAskep) {
    throw new Error('Hanya Asisten Kepala (Askep) yang berwenang mengembalikan Berita Acara ini.');
  }

  const allBapsb = storage.get(PHYSICAL_STOCK_BAPSB_KEY, []);
  const bapsb = allBapsb.find(b => b.id === bapsbId);
  if (!bapsb) throw new Error('Dokumen Berita Acara tidak ditemukan.');
  if (bapsb.status !== BAPSB_STATUS.MENUNGGU_PERSETUJUAN_ASKEP) {
    throw new Error('Dokumen tidak sedang menunggu keputusan Asisten Kepala.');
  }
  if (!String(reason || '').trim()) throw new Error('Alasan pengembalian wajib diisi.');

  const now = new Date().toISOString();
  bapsb.status = BAPSB_STATUS.RETURNED_TO_ASB;
  bapsb.approvalStatus = BAPSB_STATUS.RETURNED_TO_ASB;
  bapsb.applicationStatus = 'NOT_READY';
  bapsb.returnReason = String(reason).trim();
  bapsb.returnedAt = now;
  bapsb.returnedBy = user.userId || user.code || user.id;
  bapsb.signatures.askep.signed = false;
  bapsb.signatures.askep.signatureDataUrl = null;
  bapsb.updatedAt = now;

  storage.set(PHYSICAL_STOCK_BAPSB_KEY, allBapsb);

  const allInspections = storage.get(PHYSICAL_STOCK_STORAGE_KEY, []);
  const insp = allInspections.find(item => item.id === bapsb.inspectionId);
  if (insp) {
    insp.bapsbStatus = bapsb.status;
    storage.set(PHYSICAL_STOCK_STORAGE_KEY, allInspections);
  }

  return bapsb;
}

export function returnBapsbPengurus(bapsbId, user, reason = '') {
  const role = normalizeRole(user?.role || user?.rawRole);
  if (role !== ROLES.PENGURUS) {
    throw new Error('Hanya Pengurus yang berwenang mengembalikan Berita Acara pada tahap ini.');
  }
  if (!String(reason || '').trim()) throw new Error('Alasan pengembalian wajib diisi.');
  const allBapsb = storage.get(PHYSICAL_STOCK_BAPSB_KEY, []);
  const bapsb = allBapsb.find(item => item.id === bapsbId);
  if (!bapsb) throw new Error('Dokumen Berita Acara tidak ditemukan.');
  if (bapsb.status !== BAPSB_STATUS.MENUNGGU_PENGURUS) {
    throw new Error('Dokumen tidak sedang menunggu pengesahan Pengurus.');
  }
  const now = new Date().toISOString();
  bapsb.status = BAPSB_STATUS.RETURNED_TO_ASB;
  bapsb.approvalStatus = BAPSB_STATUS.RETURNED_TO_ASB;
  bapsb.applicationStatus = 'NOT_READY';
  bapsb.returnReason = String(reason).trim();
  bapsb.returnedAt = now;
  bapsb.returnedBy = user.userId || user.code || user.id;
  bapsb.returnedByName = user.name || 'Pengurus';
  bapsb.updatedAt = now;
  storage.set(PHYSICAL_STOCK_BAPSB_KEY, allBapsb);

  const inspections = storage.get(PHYSICAL_STOCK_STORAGE_KEY, []);
  const inspection = inspections.find(item => item.id === bapsb.inspectionId);
  if (inspection) {
    inspection.bapsbStatus = bapsb.status;
    storage.set(PHYSICAL_STOCK_STORAGE_KEY, inspections);
  }
  return bapsb;
}

/**
 * Level 3: Pengurus Kebun (Estate Manager) mengesahkan dokumen Berita Acara secara FINAL
 */
export function finalizeBapsbPengurus(bapsbId, user, payload = {}) {
  const role = normalizeRole(user?.role || user?.rawRole);
  if (role !== ROLES.PENGURUS) {
    throw new Error('Hanya Pengurus Kebun (Estate Manager) yang berwenang mengesahkan Berita Acara ini sebagai dokumen FINAL.');
  }

  const allBapsb = storage.get(PHYSICAL_STOCK_BAPSB_KEY, []);
  const bapsb = allBapsb.find(b => b.id === bapsbId);
  if (!bapsb) throw new Error('Dokumen Berita Acara tidak ditemukan.');
  if (bapsb.status !== BAPSB_STATUS.MENUNGGU_PENGURUS) {
    throw new Error(`Dokumen tidak dalam status menunggu pengesahan Pengurus (Status saat ini: ${bapsb.status}).`);
  }

  const now = new Date().toISOString();
  bapsb.signatures.pengurus = {
    signed: true,
    name: user.name || 'Junaidi',
    code: user.code || user.userId || user.id,
    roleTitle: 'Pengurus Kebun',
    signedAt: now,
    signatureDataUrl: payload.signatureDataUrl || null,
    notes: payload.notes || 'Disahkan sebagai dokumen pertanggungjawaban fisik pembibitan.'
  };
  bapsb.status = bapsb.documentType === 'PHYSICAL_STOCK_RECONCILIATION'
    ? BAPSB_STATUS.FINAL_PENDING_APPLICATION
    : BAPSB_STATUS.FINAL;
  bapsb.approvalStatus = BAPSB_STATUS.FINAL;
  bapsb.applicationStatus = bapsb.documentType === 'PHYSICAL_STOCK_RECONCILIATION' ? 'PENDING' : 'NOT_REQUIRED';
  bapsb.isFinal = true;
  bapsb.finalizedAt = now;
  bapsb.finalizedBy = user.userId || user.code || user.id;
  bapsb.ledgerFingerprintAtApproval = getPhysicalStockLedgerFingerprint(bapsb.batchId);
  bapsb.updatedAt = now;

  storage.set(PHYSICAL_STOCK_BAPSB_KEY, allBapsb);

  if (bapsb.documentType === 'PHYSICAL_STOCK_RECONCILIATION') {
    const verifications = storage.get('verification_transactions', []);
    const existingVerification = verifications.find(item =>
      item.referenceType === 'PHYSICAL_STOCK_RECONCILIATION' && item.referenceId === bapsb.id
    );
    const verification = {
      verificationId: existingVerification?.verificationId || `VRF-PSR-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      verificationNo: existingVerification?.verificationNo || `VRF/PSR/${new Date().getFullYear()}/${String(verifications.length + 1).padStart(5, '0')}`,
      referenceType: 'PHYSICAL_STOCK_RECONCILIATION',
      referenceId: bapsb.id,
      referenceDocNo: bapsb.docNo,
      moduleType: 'PEMERIKSAAN',
      sourceModule: 'PHYSICAL_STOCK_INSPECTION',
      estateId: bapsb.estateId,
      divisionId: bapsb.divisionId,
      verificationStatus: 'MENUNGGU_VERIFIKASI',
      findings: [],
      notes: 'BA telah disahkan Pengurus dan siap diterapkan ke Inventory Ledger.',
      submittedAt: now,
      submittedByUserId: bapsb.finalizedBy,
      submittedByName: bapsb.signatures?.pengurus?.name || user.name || 'Pengurus',
      createdAt: existingVerification?.createdAt || now,
      updatedAt: now
    };
    if (existingVerification) Object.assign(existingVerification, verification);
    else verifications.push(verification);
    storage.set('verification_transactions', verifications);
  }

  // Update status pada inspeksi
  const allInspections = storage.get(PHYSICAL_STOCK_STORAGE_KEY, []);
  const insp = allInspections.find(item => item.id === bapsb.inspectionId);
  if (insp) {
    insp.bapsbStatus = bapsb.status;
    insp.surplusStockLocked = bapsb.surplusQty;
    insp.shortageStockLocked = bapsb.shortageQty;
    insp.isCompleted = bapsb.documentType !== 'PHYSICAL_STOCK_RECONCILIATION';
    storage.set(PHYSICAL_STOCK_STORAGE_KEY, allInspections);
  }

  return bapsb;
}

/**
 * Query Helpers
 */
export function getBapsbById(id) {
  if (!id) return null;
  const list = storage.get(PHYSICAL_STOCK_BAPSB_KEY, []);
  return list.find(item => item.id === id || item.docNo === id) || null;
}

export function getBapsbByInspectionId(inspectionId) {
  if (!inspectionId) return null;
  const list = storage.get(PHYSICAL_STOCK_BAPSB_KEY, []);
  return list.find(item => item.inspectionId === inspectionId) || null;
}

export function getBapsbByBatchId(batchId) {
  if (!batchId) return null;
  const list = storage.get(PHYSICAL_STOCK_BAPSB_KEY, []);
  return list.find(item => String(item.batchId) === String(batchId)) || null;
}

export function getBapsbCollection(user = null) {
  const list = storage.get(PHYSICAL_STOCK_BAPSB_KEY, []);
  if (!user) return list;
  const role = normalizeRole(user.role || user.rawRole);
  
  // Estate-wide roles see all within their estate
  if (role === ROLES.PENGURUS || role === ROLES.ASKEP || role === 'ASISTEN_KEPALA') {
    if (!user.estateId) return list;
    return list.filter(item => 
      !item.estateId || 
      String(item.estateId).toUpperCase() === String(user.estateId).toUpperCase()
    );
  }

  // Division-scoped roles
  if (user.divisionId) {
    return list.filter(item => 
      !item.divisionId || 
      String(item.divisionId).toUpperCase() === String(user.divisionId).toUpperCase()
    );
  }

  return list;
}

export function getActionableBapsbCount(user = null) {
  if (!user) return 0;
  const role = normalizeRole(user.role || user.rawRole);
  const allBapsb = getBapsbCollection(user);
  if (role === ROLES.ASKEP || role === 'ASISTEN_KEPALA') {
    return allBapsb.filter(b => b.status === BAPSB_STATUS.MENUNGGU_PERSETUJUAN_ASKEP).length;
  }
  if (role === ROLES.PENGURUS) {
    return allBapsb.filter(b => b.status === BAPSB_STATUS.MENUNGGU_PENGURUS).length;
  }
  if (role === ROLES.ASISTEN_BIBITAN) {
    return allBapsb.filter(b => b.status === BAPSB_STATUS.RETURNED_TO_ASB).length;
  }
  return 0;
}


