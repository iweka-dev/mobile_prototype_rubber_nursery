/**
 * js/modules/selection/selection-manager.js
 * Manager, Business Logic, & Resolver for Pemeriksaan Hasil Seleksi (TASK ASB-09)
 * 
 * Prinsip:
 * - Dikelola oleh Role ASISTEN_BIBITAN (Pemeriksaan, Setujui, Kembalikan)
 * - Diinput/diajukan oleh MANTRI_TANAMAN
 * - PENTING: ZERO STOCK MUTATION (Mutasi stok ditunda ke ASB-13)
 * - Single Source of Truth: storage key 'selection_transactions'
 * - Traceability: Selection -> Batch -> Bedengan -> Program -> Estate -> Divisi
 */

import { storage } from '../../core/storage.js';
import { normalizeRole, ROLES } from '../../core/user-context.js';
import { getBatchById, getBatchByCode } from '../../data/batch-master.js';
import { getBedenganById } from '../../data/bedengan-master.js';
import { getProgramById } from '../../data/program-master.js';
import { getEstateById, resolveNurseryDivision } from '../../data/estate-master.js';
import { formatStandardDocNo, formatDate, formatCullDocNo, parseCullDocNo, resolveCullSourceCode, isCullDocNo, CULL_SOURCE_CODES, getEffectiveTodayDDMMYYYY } from '../../core/utils.js';
import { applyTransactionActor, canUserAccessTransaction, AUDIT_EVENT_TYPES } from '../../core/transaction-actor.js';
import { 
  deductBatchStock as deductInventoryStock, 
  getAvailableQty as getInventoryAvailableQty, 
  getBatchInventory,
  syncBatchPopulationFromSeeding,
  executeStockMutationWithLock,
  INVENTORY_TX_TYPE 
} from '../../core/batch-inventory-service.js';
import { getBatchContext } from '../../core/master-context-service.js';
import { assertAttendanceGateOrThrow } from '../../core/attendance-gate-service.js';
import { assertBedenganNotLocked, assertBatchNotLocked } from '../../core/dependency-guard.js';
import { isBuddingWorkflowInspectionApproved } from '../../core/budding-workflow-service.js';

export const SELECTION_STATUS = Object.freeze({
  READY_TO_CONFIRM: 'READY_TO_CONFIRM',
  MENUNGGU_VERIFIKASI: 'MENUNGGU_VERIFIKASI_ASISTEN_BIBITAN',
  DIAJUKAN: 'DIAJUKAN_PEMERIKSAAN',
  DISETUJUI: 'DISETUJUI',
  DIKEMBALIKAN: 'DIKEMBALIKAN'
});

export const SELECTION_STAGES = Object.freeze({
  PRA_SEMAI: 'SELEKSI_PRA_SEMAI',
  PINDAH_SEMAI: 'SELEKSI_PINDAH_SEMAI',
  SELEKSI_1: 'SELEKSI_I',
  SELEKSI_2: 'SELEKSI_II',
  SELEKSI_3: 'SELEKSI_III',
  PASCA_OKULASI: 'SELEKSI_PASCA_OKULASI'
});

export const SELECTION_TYPES = Object.freeze({
  PRA_SEMAI: 'PRA_SEMAI',
  PINDAH_SEMAI: 'PINDAH_SEMAI',
  PRA_OKULASI: 'PRA_OKULASI',
  PASCA_OKULASI: 'PASCA_OKULASI'
});

export const STOCK_MUTATION_STATUS = Object.freeze({
  PENDING: 'PENDING',
  APPLIED: 'APPLIED',
  NOT_REQUIRED: 'NOT_REQUIRED',
  FAILED: 'FAILED',
  ALREADY_APPLIED: 'ALREADY_APPLIED'
});

export const SELECTION_STORAGE_KEY = 'selection_transactions';
export const PRE_GRAFTING_SELECTION_DOC_STORAGE_KEY = 'pre_grafting_selection_documents';

/**
 * Memvalidasi konsistensi transaksi seleksi terhadap data sumber terbaru secara dinamis.
 * Mencegah persetujuan atau eksekusi transaksi jika kuantitas afkir melebihi batas afkir pada dokumen sumber yang telah dikoreksi.
 *
 * @param {object} tx - Transaksi seleksi yang akan divalidasi
 * @returns {{ isValid: boolean, reason?: string, declaredQuantity?: number, latestSourceQuantity?: number }}
 */
export function validateSelectionTransactionAgainstSource(tx) {
  if (!tx || typeof tx !== 'object') return { isValid: true };

  const docNoStr = String(tx.docNo || tx.selectionNo || tx.selectionPoolDocNo || tx.selectionDocNo || '').toUpperCase();
  const stage = String(tx.selectionStage || tx.stage || tx.selectionType || tx.type || '').toUpperCase();
  const originType = String(tx.originType || tx.sourceModule || '').toUpperCase();

  const isPreGrafting = isPreGraftingSelection(tx) ||
    docNoStr.includes('/CULL/SEL-I/') || docNoStr.includes('/CULL/SEL-II/') || docNoStr.includes('/CULL/SEL-III/') ||
    docNoStr.includes('/SEL-I') || docNoStr.includes('/SEL-II') || docNoStr.includes('/SEL-III') ||
    stage === 'SELEKSI_1' || stage === 'SELEKSI_I' || stage === 'SELEKSI_2' || stage === 'SELEKSI_II' || stage === 'SELEKSI_3' || stage === 'SELEKSI_III' ||
    stage === 'PRA_OKULASI';

  const isDederan = !isPreGrafting && (
    stage === 'SELEKSI_PRA_SEMAI' || stage === 'PRA_SEMAI' ||
    originType === 'REJECT_DEDERAN' || originType === 'DEDERAN' ||
    tx.sourceTransactionType === 'DEDER_INSPECTION' ||
    docNoStr.includes('/CULL/DDR/')
  );

  const isSowingReject = !isPreGrafting && !isDederan && (
    stage === 'SELEKSI_PINDAH_SEMAI' || stage === 'PINDAH_SEMAI' ||
    originType === 'REJECT_PENYEMAIAN' || originType === 'PENYEMAIAN' ||
    docNoStr.includes('/CULL/PS/')
  );

  const txAfkir = parseInt(
    tx.jumlahAfkirTotal !== undefined
      ? tx.jumlahAfkirTotal
      : (tx.jumlahAfkir !== undefined ? tx.jumlahAfkir : (tx.quantity !== undefined ? tx.quantity : 0)),
    10
  );

  if (isNaN(txAfkir) || txAfkir <= 0) return { isValid: true };

  // 1. Validasi Seleksi Pra-Okulasi (Seleksi I/II/III)
  if (isPreGrafting) {
    const parentDocNo = tx.parentSelectionDocNo || tx.selectionDocNo || tx.sourceDocNo || tx.sourceTransactionId;
    const parentDocId = tx.parentSelectionDocumentId || tx.selectionDocumentId;
    const allPreDocs = storage.get(PRE_GRAFTING_SELECTION_DOC_STORAGE_KEY, []);

    let parentDoc = null;
    if (parentDocId) {
      parentDoc = allPreDocs.find(d => d.id === parentDocId);
    }
    if (!parentDoc && parentDocNo) {
      parentDoc = allPreDocs.find(d => (d.docNo && d.docNo === parentDocNo) || d.id === parentDocNo);
    }
    if (!parentDoc && tx.batchCode) {
      parentDoc = allPreDocs.find(d => 
        (d.batchCode === tx.batchCode || d.batchNo === tx.batchCode || d.batchId === tx.batchId) &&
        (stage.includes('3') || stage.includes('III') ? (d.selectionStage === 'SELEKSI_3' || d.selectionStage === 'SELEKSI_III') :
         stage.includes('2') || stage.includes('II') ? (d.selectionStage === 'SELEKSI_2' || d.selectionStage === 'SELEKSI_II') :
         (d.selectionStage === 'SELEKSI_1' || d.selectionStage === 'SELEKSI_I' || !d.selectionStage))
      );
    }

    const allTxs = storage.get(SELECTION_STORAGE_KEY, []);
    const executionTxs = allTxs.filter(t => {
      if (t.id === tx.id || t.docNo === tx.docNo) return false;
      return (
        t.transactionType === 'PELAKSANAAN_SELEKSI_I' ||
        t.transactionType === 'PELAKSANAAN_SELEKSI_II' ||
        t.transactionType === 'PELAKSANAAN_SELEKSI_III' ||
        (parentDocId && (t.selectionDocumentId === parentDocId || t.parentSelectionDocumentId === parentDocId)) ||
        (parentDoc && (t.selectionDocumentId === parentDoc.id || t.parentSelectionDocumentId === parentDoc.id))
      );
    });

    let maxAllowedAfkir = 0;
    let foundSource = false;

    if (parentDoc) {
      foundSource = true;
      const docAfkir = parseInt(parentDoc.totalAfkir !== undefined ? parentDoc.totalAfkir : (parentDoc.actualBibitSelectedQty || 0), 10);
      const docSourceQty = parseInt(parentDoc.sourceBibitQty !== undefined ? parentDoc.sourceBibitQty : (parentDoc.totalBibitRetainedQty || 0), 10);
      maxAllowedAfkir = docAfkir > 0 ? docAfkir : docSourceQty;
    }

    if (executionTxs.length > 0) {
      foundSource = true;
      const execAfkirTotal = executionTxs.reduce((sum, et) => {
        const af = parseInt(et.actualBibitSelectedQty !== undefined ? et.actualBibitSelectedQty : (et.jumlahAfkir || et.bibitReject || 0), 10);
        return sum + (isNaN(af) ? 0 : af);
      }, 0);
      if (execAfkirTotal > 0) {
        maxAllowedAfkir = Math.max(maxAllowedAfkir, execAfkirTotal);
      }
    }

    if (foundSource && maxAllowedAfkir > 0 && txAfkir > maxAllowedAfkir) {
      return {
        isValid: false,
        reason: `Jumlah afkir seleksi (${txAfkir.toLocaleString('id-ID')}) melebihi total hasil seleksi pra-okulasi aktual (${maxAllowedAfkir.toLocaleString('id-ID')}).`,
        declaredQuantity: txAfkir,
        latestSourceQuantity: maxAllowedAfkir
      };
    }
  }

  // 2. Validasi Seleksi Pra-Semai (Dederan)
  if (isDederan) {
    const inspDocNo = tx.sourceDocNo || tx.inspectionDocNo || tx.sourceTransactionId;
    const dederDocNo = tx.dederanTxDocNo || tx.sourceDederanDocNo;
    const allInspections = storage.get('dederan_inspections', []);
    
    // Cari dokumen pemeriksaan yang relevan
    let matchingInspections = [];
    if (inspDocNo) {
      const specificInsp = allInspections.filter(i => (i.docNo && i.docNo === inspDocNo) || i.id === inspDocNo);
      if (specificInsp.length > 0) {
        matchingInspections = specificInsp;
      }
    }
    
    // Jika tidak spesifik per dokumen pemeriksaan, cari seluruh pemeriksaan untuk dederanTxDocNo tersebut
    if (matchingInspections.length === 0 && (dederDocNo || inspDocNo)) {
      const targetDederNo = dederDocNo || inspDocNo;
      matchingInspections = allInspections.filter(i => 
        (i.dederanTxDocNo && i.dederanTxDocNo === targetDederNo) || 
        i.dederanTxId === targetDederNo ||
        (i.docNo && i.docNo === targetDederNo) ||
        i.id === targetDederNo
      );
    }

    if (matchingInspections.length > 0) {
      const totalTidakBerhasil = matchingInspections.reduce((sum, i) => {
        return sum + parseInt(i.jumlahTidakBerhasil !== undefined ? i.jumlahTidakBerhasil : 0, 10);
      }, 0);

      if (txAfkir > totalTidakBerhasil) {
        return {
          isValid: false,
          reason: `Jumlah afkir seleksi (${txAfkir.toLocaleString('id-ID')}) melebihi total hasil pemeriksaan dederan (${totalTidakBerhasil.toLocaleString('id-ID')}).`,
          declaredQuantity: txAfkir,
          latestSourceQuantity: totalTidakBerhasil
        };
      }
    }
  }

  // 3. Validasi Seleksi Pindah Semai (Reject Sowing)
  if (isSowingReject) {
    const seedingDocNo = tx.sourceDocNo || tx.seedingDocNo || tx.sourceTransactionId;
    if (seedingDocNo) {
      const allSeeding = storage.get('seeding_transactions', []);
      const matchingSeedings = allSeeding.filter(s => 
        (s.docNo && s.docNo === seedingDocNo) || 
        s.id === seedingDocNo || 
        s.seedingDocNo === seedingDocNo
      );
      if (matchingSeedings.length > 0) {
        const totalDitolak = matchingSeedings.reduce((sum, s) => {
          const sowDitolak = s.jumlahDitolakPindahSemai !== undefined 
            ? s.jumlahDitolakPindahSemai 
            : (s.ditolak !== undefined 
                ? s.ditolak 
                : (s.jumlahDitolak !== undefined 
                    ? s.jumlahDitolak 
                    : (s.afkir || 0)));
          return sum + parseInt(sowDitolak, 10);
        }, 0);

        if (txAfkir > totalDitolak) {
          return {
            isValid: false,
            reason: `Jumlah afkir seleksi (${txAfkir.toLocaleString('id-ID')}) melebihi total jumlah ditolak pindah semai (${totalDitolak.toLocaleString('id-ID')}).`,
            declaredQuantity: txAfkir,
            latestSourceQuantity: totalDitolak
          };
        }
      }
    }
  }

  return { isValid: true };
}

/**
 * Memeriksa apakah dokumen CULL / Afkir merupakan pengecualian mutasi stok pra-tanam (NOT_REQUIRED).
 * 
 * Aturan Agronomi & Lifecycle:
 * 1. Dederan (Germination):
 *    Bibit masih di bedengan dederan dan belum pernah masuk ke stok polybag Main Nursery.
 *    (originType === 'REJECT_DEDERAN' || sourceModule === 'DEDERAN' || sourceTransactionType === 'DEDER_INSPECTION')
 * 
 * 2. Pindah Semai (Sowing / Seeding Transfer):
 *    Bibit kecambah diseleksi sebelum ditanam ke polybag.
 *    Kecambah yang diafkir pra-tanam tidak pernah dimasukkan ke populasi stok polybag
 *    karena baseline stok polybag disinkronkan hanya dari netto 'totalDisemai'.
 *    
 *    Pengecualian pra-tanam ini WAJIB diverifikasi melalui bukti transaksi sumber yang valid:
 *    - Memeriksa dokumen transaksi SOW (seeding_transactions) atau selection_pool terkait.
 *    - Memastikan bukti transaksi sumber mencatat penolakan bibit pra-tanam (ditolak > 0, jumlahDitolak > 0, dsb.)
 *      atau bahwa stok polybag dihitung bersih tanpa mengikutsertakan kuantitas afkir tersebut.
 *    - Tidak menggunakan originType, sourceModule, atau substring nomor dokumen secara terpisah sebagai satu-satunya dasar.
 * 
 * 3. Seleksi Pasca-Tanam (Seleksi Pra-Okulasi I/II/III, Pasca Okulasi, Regrafting):
 *    Bibit sudah tertanam di polybag dan tercatat di ledger stok nursery_batches.
 *    CULL ini BUKAN pra-tanam dan HARUS tetap memotong stok batch polybag (APPLIED).
 * 
 * @param {Object} record - Dokumen transaksi seleksi / CULL
 * @returns {boolean} true jika merupakan CULL pra-tanam sah yang dibebaskan dari mutasi stok (NOT_REQUIRED)
 */
export function isPrePlantingCullStockExempt(record) {
  if (!record || typeof record !== 'object') return false;

  // 1. Dederan: Selalu pra-tanam (fase perkecambahan sebelum penanaman ke polybag)
  const isDederan = (
    record.originType === 'REJECT_DEDERAN' ||
    record.sourceModule === 'DEDERAN' ||
    record.sourceTransactionType === 'DEDER_INSPECTION' ||
    (record.docNo && String(record.docNo).includes('/CULL/DDR/')) ||
    (record.selectionNo && String(record.selectionNo).includes('/CULL/DDR/'))
  );
  if (isDederan) return true;

  // 2. Filter Ketat: Pastikan BUKAN seleksi pasca-tanam (in-polybag)
  const isPostPlantingStage = (
    record.originType === 'REJECT_SELEKSI_1' ||
    record.originType === 'REJECT_SELEKSI_2' ||
    record.originType === 'REJECT_SELEKSI_3' ||
    record.originType === 'REJECT_OKULASI' ||
    record.originType === 'REJECT_REGRAFTING' ||
    record.sourceModule === 'SELEKSI_1' ||
    record.sourceModule === 'SELEKSI_2' ||
    record.sourceModule === 'SELEKSI_3' ||
    record.sourceModule === 'BUDDING' ||
    record.sourceModule === 'OKULASI' ||
    record.sourceModule === 'REGRAFTING' ||
    Boolean(record.parentSelectionDocumentId) ||
    Boolean(record.selectionDocumentId) ||
    Boolean(record.parentSelectionDocNo) ||
    (record.selectionDocNo && String(record.selectionDocNo).includes('/SEL/')) ||
    (record.transactionType && String(record.transactionType).startsWith('PELAKSANAAN_SELEKSI'))
  );
  if (isPostPlantingStage) return false;

  // 3. Verifikasi Pindah Semai / Penyemaian dengan BUKTI TRANSAKSI SUMBER
  const isPindahSemaiCandidate = (
    record.originType === 'REJECT_PENYEMAIAN' ||
    record.sourceModule === 'PENYEMAIAN' ||
    record.sourceTransactionType === 'SEEDING' ||
    record.stage === 'PINDAH_SEMAI' ||
    record.selectionType === 'PINDAH_SEMAI' ||
    (record.docNo && String(record.docNo).includes('/CULL/PS/')) ||
    (record.selectionNo && String(record.selectionNo).includes('/CULL/PS/'))
  );

  if (!isPindahSemaiCandidate) return false;

  // Ambil bukti transaksi sumber dari seeding_transactions
  const seedingTxs = storage.get('seeding_transactions', []);
  const batchKey = record.batchId || record.batchCode || record.batchNo;
  const bedenganKey = record.bedenganId || record.bedenganCode || record.bedengan;
  const sourceDocNo = record.sourceDocNo || record.seedingDocNo || record.sourceTransactionId;

  let matchedSow = null;
  if (Array.isArray(seedingTxs) && seedingTxs.length > 0) {
    if (sourceDocNo) {
      matchedSow = seedingTxs.find(s =>
        String(s.docNo || '') === String(sourceDocNo) ||
        String(s.id || '') === String(sourceDocNo)
      );
    }
    if (!matchedSow && (batchKey || bedenganKey)) {
      matchedSow = seedingTxs.find(s => {
        const bMatch = !batchKey || (s.batchCode === batchKey || s.batchId === batchKey || s.batchNo === batchKey);
        const bedMatch = !bedenganKey || (s.bedenganCode === bedenganKey || s.bedengan === bedenganKey || s.bedenganId === bedenganKey);
        return bMatch && bedMatch;
      });
    }
  }

  if (matchedSow) {
    const ditolakSow = Number(
      matchedSow.jumlahDitolakPindahSemai ??
      matchedSow.ditolak ??
      matchedSow.jumlahDitolak ??
      ((matchedSow.rusakQty || 0) + (matchedSow.matiQty || 0) + (matchedSow.lainnyaQty || 0)) ??
      0
    );
    const plantedQty = Number(matchedSow.totalDisemai || matchedSow.disemai || matchedSow.totalPolybag || 0);
    const initialSeedQty = Number(matchedSow.totalBibit || matchedSow.diterima || matchedSow.stokAwal || matchedSow.populasiAwal || 0);
    const mutationQty = parseInt(record.jumlahAfkir || record.quantity || 0, 10);

    // Bukti 1: Kuantitas afkir ini merupakan (atau bagian dari) bibit ditolak pra-tanam pada SOW sumber
    if (ditolakSow > 0 && mutationQty > 0 && mutationQty <= ditolakSow) {
      return true;
    }

    // Bukti 2: Stok awal Dederan / bibit diterima mencatat selisih pra-tanam yang tidak masuk polybag
    // dan kuantitas afkir melebihi bibit tertanam (contoh: 18.000 afkir > 12.000 tertanam dari 30.000 awal)
    if (initialSeedQty > plantedQty && mutationQty > 0 && (mutationQty > plantedQty || mutationQty === (initialSeedQty - plantedQty))) {
      return true;
    }
  }

  // Bukti sekunder pada selection_pool jika SOW belum ditemukan di table seeding_transactions
  const pool = storage.get('selection_pool', []);
  if (Array.isArray(pool) && pool.length > 0) {
    const matchedPool = pool.find(p =>
      (record.id && (p.selectionTransactionId === record.id || p.id === record.selectionTransactionId)) ||
      (record.docNo && (p.docNo === record.docNo || p.selectionDocNo === record.docNo)) ||
      (sourceDocNo && (p.sourceDocNo === sourceDocNo || p.seedingDocNo === sourceDocNo))
    );

    if (matchedPool) {
      const isPoolPrePlanting = (
        matchedPool.originType === 'REJECT_PENYEMAIAN' ||
        matchedPool.sourceModule === 'PENYEMAIAN' ||
        matchedPool.sourceTransactionType === 'SEEDING'
      );
      const poolHasDitolakProof = Boolean(
        matchedPool.alasanDitolakCategory ||
        matchedPool.category === 'PENDING_DECLARATION' ||
        (matchedPool.alasan && /ditolak/i.test(matchedPool.alasan)) ||
        (matchedPool.alasan && /penyemaian/i.test(matchedPool.alasan))
      );

      if (isPoolPrePlanting && poolHasDitolakProof) {
        return true;
      }
    }
  }

  return false;
}


/**
 * Memeriksa apakah suatu item seleksi merupakan Seleksi Pra-Okulasi (Seleksi I/II/III)
 */
export function isPreGraftingSelection(item) {
  if (!item) return false;
  const stage = String(item.selectionStage || item.stage || '').toUpperCase();
  const type = String(item.selectionType || '').toUpperCase();
  return (
    type === SELECTION_TYPES.PRA_OKULASI ||
    stage === SELECTION_STAGES.SELEKSI_1 ||
    stage === SELECTION_STAGES.SELEKSI_2 ||
    stage === SELECTION_STAGES.SELEKSI_3 ||
    stage === 'SELEKSI_1' || stage === 'SELEKSI_2' || stage === 'SELEKSI_3' ||
    stage === 'SELEKSI_I' || stage === 'SELEKSI_II' || stage === 'SELEKSI_III'
  );
}

/**
 * Memeriksa apakah suatu item seleksi merupakan Seleksi Pasca-Okulasi (Afkir / Culling)
 */
export function isPostGraftingSelection(item) {
  return !isPreGraftingSelection(item);
}

/**
 * Format label tahap seleksi / origin CULL (Canonical Resolver)
 */
export function getSelectionStageLabel(item) {
  if (!item) return 'Seleksi';

  const stage = String(item.selectionStage || item.stage || '').toUpperCase();
  const origType = String(item.originType || '').toUpperCase();
  const srcMod = String(item.sourceModule || '').toUpperCase();
  const srcTxType = String(item.sourceTransactionType || '').toUpperCase();

  if (
    origType === 'PHYSICAL_STOCK_SHORTAGE' ||
    srcMod === 'PHYSICAL_STOCK_INSPECTION' ||
    srcTxType === 'PHYSICAL_STOCK_INSPECTION'
  ) {
    return 'Afkir Pemeriksaan Stok Fisik';
  }

  // 1. Pra-Semai (Dederan)
  if (
    stage === SELECTION_STAGES.PRA_SEMAI ||
    stage === 'SELEKSI_PRA_SEMAI' ||
    stage === 'PRA_SEMAI' ||
    origType === 'REJECT_DEDERAN' ||
    srcMod === 'DEDERAN' ||
    srcTxType === 'DEDER_INSPECTION'
  ) {
    return 'Seleksi Pra-Semai (Dederan)';
  }

  // 2. Pindah Semai
  if (
    stage === SELECTION_STAGES.PINDAH_SEMAI ||
    stage === 'SELEKSI_PINDAH_SEMAI' ||
    stage === 'PINDAH_SEMAI' ||
    origType === 'REJECT_PENYEMAIAN' ||
    srcMod === 'PENYEMAIAN' ||
    srcTxType === 'SEEDING'
  ) {
    return 'Seleksi Pindah Semai';
  }

  // 3. Pra-Okulasi I-III Document / Execution Stage
  if (stage === SELECTION_STAGES.SELEKSI_1 || stage === 'SELEKSI_1' || stage === 'SELEKSI_I') {
    return 'Seleksi I (Pra-Okulasi)';
  }
  if (stage === SELECTION_STAGES.SELEKSI_2 || stage === 'SELEKSI_2' || stage === 'SELEKSI_II') {
    return 'Seleksi II (Pra-Okulasi)';
  }
  if (stage === SELECTION_STAGES.SELEKSI_3 || stage === 'SELEKSI_3' || stage === 'SELEKSI_III') {
    return 'Seleksi III (Pra-Okulasi)';
  }

  // 4. Pasca-Okulasi
  if (
    stage === SELECTION_STAGES.PASCA_OKULASI ||
    stage === 'SELEKSI_PASCA_OKULASI' ||
    stage === 'PASCA_OKULASI' ||
    origType === 'REJECT_OKULASI' ||
    origType === 'REJECT_REGRAFTING' ||
    origType === 'REJECT_PEMERIKSAAN' ||
    srcMod === 'BUDDING' ||
    srcMod === 'OKULASI' ||
    srcTxType === 'GRAFTING' ||
    srcTxType === 'REGRAFTING' ||
    item.selectionType === SELECTION_TYPES.PASCA_OKULASI ||
    item.selectionType === 'PASCA-OKULASI' ||
    item.selectionType === 'PASCA_OKULASI'
  ) {
    return 'Seleksi Pasca-Okulasi';
  }

  return getSelectionSourceLabel(item);
}

/**
 * Alokasi Nomor Dokumen CULL Global secara monotonik dan non-reuse
 * Format: YYYY/CULL/XXX/NNN
 * Dikelola terpisah berdasarkan tahun dan kode sumber
 */
export function allocateCullDocNo(subCode, targetYear = 2026, existingRecords = []) {
  const normSubCode = resolveCullSourceCode(subCode);
  const year = targetYear || 2026;
  const seqKey = `${year}/${normSubCode}`;

  // Read stored sequences map
  const seqMap = storage.get('cull_document_sequences', {}) || {};
  let currentStored = parseInt(seqMap[seqKey] || 0, 10);
  if (isNaN(currentStored) || currentStored < 0) currentStored = 0;

  // Scan all existing records in system to find high-water mark sequence
  let maxScan = 0;
  const scanSources = [
    ...(Array.isArray(existingRecords) ? existingRecords : []),
    ...(storage.get(SELECTION_STORAGE_KEY, []) || []),
    ...(storage.get('selection_pool', []) || [])
  ];

  scanSources.forEach(item => {
    if (!item) return;
    const docCandidates = [
      typeof item === 'string' ? item : null,
      item.docNo,
      item.selectionNo,
      item.selectionDocNo,
      item.selectionPoolDocNo
    ].filter(Boolean);

    docCandidates.forEach(docStr => {
      const parsed = parseCullDocNo(docStr);
      if (parsed && parsed.year === year && parsed.subCode === normSubCode) {
        if (parsed.sequence > maxScan) maxScan = parsed.sequence;
      }
    });
  });

  const nextSeq = Math.max(currentStored, maxScan) + 1;

  // Monotonic, non-reuse allocation: immediately persist the updated counter
  seqMap[seqKey] = nextSeq;
  storage.set('cull_document_sequences', seqMap);

  return formatCullDocNo(year, normSubCode, nextSeq);
}

/**
 * Reconcile status selection_pool dengan selection_transactions
 * Menangani recovery saat browser terhenti setelah transaksi tersimpan tetapi sebelum pool terupdate
 */
export function reconcileSelectionPoolWithTransactions() {
  let allTxs = storage.get(SELECTION_STORAGE_KEY, []);
  let pool = storage.get('selection_pool', []);
  let poolChanged = false;

  // Helper untuk membedakan transaksi eksekusi Seleksi I/II/III dari transaksi CULL deklarasi
  const isExecutionRecord = (tx) => {
    if (!tx) return false;
    if (isCullDocNo(tx.docNo) || isCullDocNo(tx.selectionNo) || isCullDocNo(tx.selectionPoolDocNo)) return false;
    return Boolean(
      tx.parentSelectionDocumentId ||
      tx.selectionDocumentId ||
      tx.parentSelectionDocNo ||
      Boolean(tx.selectionDocNo && String(tx.selectionDocNo).includes('/SEL/')) ||
      Boolean(tx.docNo && (String(tx.docNo).includes('/SEL/') || String(tx.docNo).includes('/SEL-I/') || String(tx.docNo).includes('/SEL-II/') || String(tx.docNo).includes('/SEL-III/'))) ||
      tx.selectionType === SELECTION_TYPES.PRA_OKULASI ||
      (tx.transactionType && String(tx.transactionType).startsWith('PELAKSANAAN_SELEKSI'))
    );
  };

  const isPreGraftingExecution = (tx) => Boolean(tx && (
    tx.selectionType === SELECTION_TYPES.PRA_OKULASI ||
    (tx.transactionType && String(tx.transactionType).startsWith('PELAKSANAAN_SELEKSI')) ||
    ['SELEKSI_I', 'SELEKSI_1', 'SELEKSI_II', 'SELEKSI_2', 'SELEKSI_III', 'SELEKSI_3'].includes(String(tx.selectionStage || tx.stage || '').toUpperCase())
  ));
  const isPreGraftingCullDeclaration = (tx) => Boolean(tx &&
    isCullDocNo(tx.docNo || tx.selectionNo || tx.selectionPoolDocNo) && (
      tx.sourceModule === 'SELEKSI_PRA_OKULASI' ||
      tx.originType === 'REJECT_PRE_GRAFTING' ||
      String(tx.sourceTransactionType || '').toUpperCase().startsWith('PELAKSANAAN_SELEKSI') ||
      tx.selectionType === SELECTION_TYPES.PRA_OKULASI
    ));

  // CULL Pra-Okulasi adalah turunan dari sesi pemeriksaan. Jika sesi sumber
  // pernah terhapus oleh versi lama, tarik CULL yang belum final dari antrean.
  const cancelledPreGraftingCullIds = new Set();
  const cancelledPreGraftingCullRefs = [];
  let transactionsChanged = false;
  allTxs.forEach(tx => {
    if (!isPreGraftingCullDeclaration(tx)) return;
    const sourceId = String(tx.sourceTransactionId || '').trim();
    const sourceDocNo = String(tx.sourceDocNo || '').trim();
    const sourceExists = allTxs.some(source => source !== tx && isPreGraftingExecution(source) && (
      (sourceId && (String(source.id || '') === sourceId || String(source.docNo || source.selectionNo || '') === sourceId)) ||
      (sourceDocNo && String(source.docNo || source.selectionNo || '').trim() === sourceDocNo)
    ));
    if (sourceExists) return;

    const verificationStatus = String(tx.verificationStatus || '').toUpperCase();
    const status = String(tx.status || '').toUpperCase();
    const isFinal = tx.isFinal === true ||
      tx.stockMutationStatus === 'COMPLETED' ||
      ['TERVERIFIKASI', 'DATA_TERKONFIRMASI', 'DISETUJUI', 'APPROVED', 'VERIFIED'].includes(verificationStatus) ||
      ['DISETUJUI', 'APPROVED', 'VERIFIED'].includes(status);
    if (isFinal) return;

    tx.status = 'DIBATALKAN';
    tx.verificationStatus = 'DIBATALKAN';
    tx.submissionStatus = 'DIBATALKAN';
    tx.withdrawalReason = 'Sesi pemeriksaan Pra-Okulasi sumber sudah tidak tersedia.';
    tx.withdrawnAt = new Date().toISOString();
    tx.updatedAt = tx.withdrawnAt;
    cancelledPreGraftingCullIds.add(String(tx.id || tx.selectionId || ''));
    cancelledPreGraftingCullRefs.push({
      id: String(tx.id || tx.selectionId || ''),
      docNo: String(tx.docNo || tx.selectionNo || tx.selectionPoolDocNo || ''),
      sourceId,
      sourceDocNo
    });
    transactionsChanged = true;
  });
  if (transactionsChanged) {
    storage.set(SELECTION_STORAGE_KEY, allTxs);
    const verifications = storage.get('verification_transactions', []);
    let verificationsChanged = false;
    verifications.forEach(record => {
      const matchesCull = cancelledPreGraftingCullRefs.some(ref =>
        (ref.id && String(record.referenceId || '') === ref.id) ||
        (ref.docNo && String(record.referenceDocNo || '') === ref.docNo)
      );
      if (!matchesCull) return;
      const status = String(record.verificationStatus || '').toUpperCase();
      if (['TERVERIFIKASI', 'DATA_TERKONFIRMASI', 'DISETUJUI', 'APPROVED', 'VERIFIED'].includes(status)) return;
      record.verificationStatus = 'DIBATALKAN';
      record.withdrawalReason = 'Sesi pemeriksaan Pra-Okulasi sumber sudah tidak tersedia.';
      record.withdrawnAt = new Date().toISOString();
      record.updatedAt = record.withdrawnAt;
      verificationsChanged = true;
    });
    if (verificationsChanged) storage.set('verification_transactions', verifications);
  }
  const isPreGraftingPoolCandidate = (item) => Boolean(item && (
    item.id?.startsWith?.('SEL-POOL-PRE-') ||
    item.sourceModule === 'SELEKSI_PRA_OKULASI' ||
    item.originType === 'REJECT_PRE_GRAFTING' ||
    item.selectionType === SELECTION_TYPES.PRA_OKULASI ||
    ['PRA_OKULASI', 'SELEKSI_PRA_OKULASI'].includes(String(item.selectionType || '').toUpperCase()) ||
    ['SELEKSI_1', 'SELEKSI_I', 'SELEKSI_2', 'SELEKSI_II', 'SELEKSI_3', 'SELEKSI_III'].includes(String(item.selectionStage || item.stage || '').toUpperCase()) ||
    Boolean(item.parentSelectionDocumentId || item.parentSelectionDocNo)
  ));
  const isPendingPoolCandidate = (item) => {
    const status = String(item?.status || 'PENDING_DECLARATION').toUpperCase();
    return ['PENDING_DECLARATION', 'PENDING', 'DRAFT'].includes(status) &&
      !isCullDocNo(item?.docNo || item?.selectionDocNo || item?.selectionPoolDocNo);
  };
  const sourceExecutionIdForCandidate = (item) => {
    if (item?.sourceTransactionId) return String(item.sourceTransactionId);
    const itemId = String(item?.id || '');
    return itemId.startsWith('SEL-POOL-PRE-') ? itemId.slice('SEL-POOL-PRE-'.length) : '';
  };

  // Buang kandidat pending Pra-Okulasi yang sumbernya sudah dihapus. Kandidat
  // dengan relasi deklarasi Cull atau status selain pending tetap dipertahankan.
  pool = pool.filter(item => {
    if (!isPreGraftingPoolCandidate(item) || !isPendingPoolCandidate(item)) return true;
    const sourceId = sourceExecutionIdForCandidate(item);
    const candidateSourceDocNo = String(item.sourceDocNo || '').trim();
    const sourceExecutionById = sourceId
      ? allTxs.find(tx => String(tx.id || '') === sourceId && isPreGraftingExecution(tx))
      : null;
    const sourceExecutionByDocNo = candidateSourceDocNo
      ? allTxs.find(tx =>
          isPreGraftingExecution(tx) &&
          String(tx.docNo || tx.selectionNo || '').trim() === candidateSourceDocNo
        )
      : null;
    const sourceExecution = sourceExecutionByDocNo || sourceExecutionById;
    // A recreated execution can leave an old pool candidate whose source ID was
    // reused while its source document number still points to the deleted session.
    // Use source document number as a fallback for legacy candidates without IDs.
    const sourceExists = Boolean(sourceExecution && (
      !candidateSourceDocNo ||
      String(sourceExecution.docNo || sourceExecution.selectionNo || '').trim() === candidateSourceDocNo
    ));
    if (sourceExists) return true;
    // If neither stable source reference exists, retain the row for manual review.
    if (!sourceId && !candidateSourceDocNo) return true;
    const cullExists = allTxs.some(tx => {
      if (!isCullDocNo(tx.docNo || tx.selectionNo || tx.selectionPoolDocNo)) return false;
      return (sourceId && String(tx.sourceTransactionId || '') === sourceId) ||
        (candidateSourceDocNo && String(tx.sourceTransactionId || '') === candidateSourceDocNo) ||
        String(tx.id || tx.selectionId || '') === String(item.selectionTransactionId || '');
    });
    if (cullExists) return true;
    poolChanged = true;
    return false;
  });

  if (cancelledPreGraftingCullRefs.length) {
    const beforeCullCleanup = pool.length;
    pool = pool.filter(item => {
      if (!isPreGraftingPoolCandidate(item)) return true;
      return !cancelledPreGraftingCullRefs.some(ref =>
        (ref.id && String(item.selectionTransactionId || '') === ref.id) ||
        (ref.docNo && String(item.docNo || item.selectionDocNo || item.selectionPoolDocNo || '') === ref.docNo) ||
        (ref.sourceId && String(item.sourceTransactionId || '') === ref.sourceId) ||
        (ref.sourceDocNo && String(item.sourceDocNo || '').trim() === ref.sourceDocNo)
      );
    });
    if (pool.length !== beforeCullCleanup) poolChanged = true;
  }

  pool = pool.map(p => {
    if (!p) return p;

    // AUTO-HEAL: Jika pool item memiliki docNo/selectionDocNo yang mengarah ke dokumen eksekusi seleksi (bukan CULL),
    // atau jika selectionTransactionId mengarah ke transaksi eksekusi Seleksi, bersihkan linking tersebut!
    const pointsToExecutionDoc = (p.docNo && !isCullDocNo(p.docNo) && (String(p.docNo).includes('/SEL/') || String(p.docNo).includes('/SEL-I/') || String(p.docNo).includes('/SEL-II/') || String(p.docNo).includes('/SEL-III/'))) ||
      (p.selectionDocNo && !isCullDocNo(p.selectionDocNo) && (String(p.selectionDocNo).includes('/SEL/') || String(p.selectionDocNo).includes('/SEL-I/') || String(p.selectionDocNo).includes('/SEL-II/') || String(p.selectionDocNo).includes('/SEL-III/')));
    const pointsToExecutionTx = Boolean(p.selectionTransactionId && allTxs.some(tx => (tx.id === p.selectionTransactionId || tx.selectionId === p.selectionTransactionId) && isExecutionRecord(tx)));

    if (pointsToExecutionDoc || pointsToExecutionTx) {
      poolChanged = true;
      p = {
        ...p,
        docNo: null,
        selectionDocNo: null,
        selectionTransactionId: null,
        status: 'PENDING_DECLARATION',
        verificationStatus: null,
        submissionStatus: null
      };
    }

    const matchedTx = allTxs.find(tx => {
      // PENTING: Jangan cocokkan pool item bibit afkir (CULL) dengan transaksi eksekusi Seleksi Pra-Okulasi!
      if (isExecutionRecord(tx)) return false;
      return (
        (p.selectionTransactionId && (tx.id === p.selectionTransactionId || tx.selectionId === p.selectionTransactionId)) ||
        (p.id && (tx.id === p.id || tx.selectionId === p.id)) ||
        (p.docNo && tx.docNo && p.docNo === tx.docNo) ||
        (p.sourceDocNo && tx.sourceDocNo && p.sourceDocNo === tx.sourceDocNo && (p.sourceModule === tx.sourceModule || p.originType === tx.originType) && (p.category === tx.category || !p.category || !tx.category)) ||
        (p.dederanDocNo && tx.dederanDocNo && p.dederanDocNo === tx.dederanDocNo)
      );
    });

    if (matchedTx) {
      const needsUpdate = (
        p.status !== matchedTx.status ||
        p.docNo !== matchedTx.docNo ||
        p.selectionTransactionId !== matchedTx.id
      );
      if (needsUpdate) {
        poolChanged = true;
        return {
          ...p,
          status: matchedTx.status,
          verificationStatus: matchedTx.verificationStatus || null,
          submissionStatus: matchedTx.submissionStatus || null,
          docNo: matchedTx.docNo,
          selectionTransactionId: matchedTx.id,
          selectionDocNo: matchedTx.docNo
        };
      }
    } else {
      // AUTO-HEAL ORPHAN STATUS: Jika pool item memiliki status terkirim/menunggu verifikasi tetapi tidak ada transaksi CULL di storage
      const isAfkirPool = (p.originType === 'REJECT_PENYEMAIAN' || p.sourceModule === 'PENYEMAIAN' || p.originType === 'REJECT_DEDERAN' || p.sourceModule === 'DEDERAN' || parseInt(p.jumlahAfkir || p.quantity || 0, 10) > 0);
      const isOrphanStatus = p.status === 'MENUNGGU_VERIFIKASI' || p.status === 'SUBMITTED_TO_ASB' || p.status === 'DECLARED_CULLED' || p.status === 'READY_TO_CONFIRM';
      if (isAfkirPool && isOrphanStatus && (!p.docNo || !isCullDocNo(p.docNo))) {
        poolChanged = true;
        return {
          ...p,
          docNo: null,
          selectionDocNo: null,
          selectionTransactionId: null,
          status: 'PENDING_DECLARATION',
          verificationStatus: null,
          submissionStatus: null
        };
      }
    }
    return p;
  });

  if (poolChanged) {
    storage.set('selection_pool', pool);
  }

  // Recover candidates when execution storage succeeded but pool storage did not.
  // The sync helper is idempotent and preserves already-declared candidates.
  for (const tx of allTxs) {
    if (!isExecutionRecord(tx)) continue;
    if (!isPreGraftingExecution(tx)) continue;

    const afkirQty = parseInt(
      tx.actualBibitSelectedQty !== undefined
        ? tx.actualBibitSelectedQty
        : (tx.jumlahAfkir !== undefined ? tx.jumlahAfkir : (tx.bibitReject || 0)),
      10
    );
    if (Number.isNaN(afkirQty) || afkirQty <= 0) continue;

    const hasCandidate = pool.some(item => item && (
      item.id === `SEL-POOL-PRE-${tx.id}` ||
      (String(item.sourceTransactionId || '') === String(tx.id || '') && (item.sourceModule === 'SELEKSI_PRA_OKULASI' || item.originType === 'REJECT_PRE_GRAFTING'))
    ));
    if (hasCandidate) continue;

    const docs = storage.get(PRE_GRAFTING_SELECTION_DOC_STORAGE_KEY, []);
    const parentDoc = docs.find(doc => doc && (
      doc.id === tx.parentSelectionDocumentId || doc.id === tx.selectionDocumentId ||
      doc.docNo === tx.parentSelectionDocNo || doc.docNo === tx.selectionDocNo
    )) || null;
    let candidate = syncPreGraftingExecutionToSelectionPool(tx, parentDoc);
    if (candidate) {
      // The pool row may be the only link from a source execution to its CULL
      // declaration. If that row was lost, restore the declaration linkage too.
      const cullTx = allTxs.find(other => other && other.id !== tx.id &&
        (isCullDocNo(other.docNo) || isCullDocNo(other.selectionNo) || isCullDocNo(other.selectionPoolDocNo)) &&
        other.sourceTransactionId === tx.id
      );
      if (cullTx) {
        candidate = {
          ...candidate,
          docNo: cullTx.docNo || cullTx.selectionNo || cullTx.selectionPoolDocNo,
          selectionDocNo: cullTx.docNo || cullTx.selectionNo || cullTx.selectionPoolDocNo,
          selectionTransactionId: cullTx.id,
          category: cullTx.category || cullTx.alasanDitolakCategory || 'AFKIR',
          alasanDitolakCategory: cullTx.alasanDitolakCategory || cullTx.category || 'AFKIR',
          jumlahAfkir: cullTx.jumlahAfkir || cullTx.quantity || candidate.jumlahAfkir,
          quantity: cullTx.quantity || cullTx.jumlahAfkir || candidate.quantity,
          status: cullTx.status || 'PENDING_DECLARATION',
          verificationStatus: cullTx.verificationStatus || null,
          submissionStatus: cullTx.submissionStatus || null,
          stockMutationStatus: cullTx.stockMutationStatus || candidate.stockMutationStatus
        };
        const restoredPool = storage.get('selection_pool', []);
        const candidateIdx = restoredPool.findIndex(item => item && item.id === candidate.id);
        if (candidateIdx !== -1) restoredPool[candidateIdx] = candidate;
        storage.set('selection_pool', restoredPool);
      }
      pool.push(candidate);
    }
  }
}

/**
 * Validasi otorisasi Asisten Bibitan untuk memeriksa seleksi
 */
export function canPerformAsistenSelectionAction(item, currentUser) {
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
  const subStatus = (item.submissionStatus || '').toUpperCase();

  // Pre-grafting selection documents (Seleksi I/II/III)
  const isPreGraftingDoc = Boolean(
    !item.originType &&
    (item.batchCode || item.batchId || item.programCode || item.programId || item.rows || item.bedenganIds) &&
    (item.selectionStage === 'SELEKSI_I' || item.selectionStage === 'SELEKSI_II' || item.selectionStage === 'SELEKSI_III' ||
     item.selectionStage === 'SELEKSI_1' || item.selectionStage === 'SELEKSI_2' || item.selectionStage === 'SELEKSI_3')
  );

  if (isPreGraftingDoc) {
    return (
      s === SELECTION_STATUS.MENUNGGU_VERIFIKASI ||
      s === 'MENUNGGU_VERIFIKASI' ||
      s === SELECTION_STATUS.DIAJUKAN ||
      s === 'DIAJUKAN' ||
      s === 'MENUNGGU_ASISTEN' ||
      subStatus === 'SUBMITTED_TO_ASB'
    );
  }

  // For standalone selection individual items:
  // MUST NOT be actionable if only in local READY_TO_CONFIRM state without submission
  if (s === 'READY_TO_CONFIRM' && subStatus !== 'SUBMITTED_TO_ASB') {
    return false;
  }

  // Must be submitted to ASB via submissionStatus or already in actionable verification state
  if (subStatus === 'SUBMITTED_TO_ASB' || s === SELECTION_STATUS.MENUNGGU_VERIFIKASI || s === 'MENUNGGU_VERIFIKASI' || s === SELECTION_STATUS.DIAJUKAN || s === 'DIAJUKAN') {
    return (
      s === SELECTION_STATUS.MENUNGGU_VERIFIKASI ||
      s === 'MENUNGGU_VERIFIKASI' ||
      s === SELECTION_STATUS.DIAJUKAN ||
      s === 'DIAJUKAN' ||
      s === 'SUBMITTED_TO_ASB' ||
      s === 'READY_TO_CONFIRM'
    );
  }

  // Check active verification_transactions storage
  try {
    const allVerifs = storage.get('verification_transactions', []);
    const hasVerif = allVerifs.some(v =>
      (String(v.referenceId) === String(item.id) || String(v.referenceDocNo) === String(item.docNo)) &&
      (v.verificationStatus === 'MENUNGGU_VERIFIKASI' || v.verificationStatus === 'PENDING_ASB')
    );
    if (hasVerif) return true;
  } catch (_) {}

  return false;
}

/**
 * Filter daftar hasil seleksi sesuai scope pengguna
 */
export function filterSelectionByScope(records, currentUser) {
  if (!Array.isArray(records) || !currentUser) return [];
  return records.filter(item => {
    return canUserAccessTransaction(item, currentUser, 'READ');
  });
}

/**
 * Hitung jumlah transaksi/dokumen seleksi yang memerlukan tindakan Asisten Bibitan
 */
export function getActionableSelectionCount(records = null, currentUser) {
  if (!currentUser) return 0;
  if (records !== null && Array.isArray(records)) {
    return records.filter(item => canPerformAsistenSelectionAction(item, currentUser)).length;
  }
  const preDocs = getPreGraftingSelectionDocuments({}, currentUser);
  const preCount = preDocs.filter(item => canPerformAsistenSelectionAction(item, currentUser)).length;

  const allRecords = storage.get(SELECTION_STORAGE_KEY, []);
  const postGraftingRecords = allRecords.filter(r => {
    if (r.selectionDocumentId || r.parentSelectionDocumentId) return false;
    if (r.selectionType === SELECTION_TYPES.PRA_OKULASI) return false;
    if (r.transactionType && String(r.transactionType).startsWith('PELAKSANAAN_SELEKSI')) return false;
    const st = String(r.selectionStage || '').toUpperCase();
    if (st === SELECTION_STAGES.SELEKSI_1 || st === 'SELEKSI_I' || st === SELECTION_STAGES.SELEKSI_2 || st === 'SELEKSI_II' || st === SELECTION_STAGES.SELEKSI_3 || st === 'SELEKSI_III') return false;
    return true;
  });
  const scopedPost = filterSelectionByScope(postGraftingRecords, currentUser);
  const txCount = scopedPost.filter(item => canPerformAsistenSelectionAction(item, currentUser)).length;

  return preCount + txCount;
}

/**
 * Memeriksa apakah terdapat transaksi/dokumen penyeleksian yang memerlukan aksi user sesuai peran & scope
 */
export function hasActionableSelection(currentUser) {
  if (!currentUser) return false;
  const role = normalizeRole(currentUser.role || currentUser.rawRole);

  if (role === ROLES.ASISTEN_BIBITAN || role === ROLES.ASISTEN) {
    return getActionableSelectionCount(null, currentUser) > 0;
  }

  // Untuk Mantri Tanaman / Mantri Bibitan
  if (role === ROLES.MANTRI_TANAMAN || role === 'MANTRI' || role === 'MANTRI_BIBITAN' || isMantriRole(currentUser)) {
    // Buat kandidat pasca-okulasi dari hasil pemeriksaan sebelum Beranda
    // menghitung badge. Sebelumnya bridge ini hanya berjalan saat halaman
    // Penyeleksian dirender, sehingga red dot baru muncul setelah halaman itu dibuka.
    try {
      syncInspectionRejectionsToSelectionPool();
    } catch (_) {}

    // Sinkronkan status selection_pool dengan transaksi CULL
    try {
      reconcileSelectionPoolWithTransactions();
    } catch (_) {}

    const rawPool = storage.get('selection_pool', []);
    const scopedPool = filterSelectionByScope(rawPool, currentUser);

    // The Mantri dashboard dot should follow the same source of truth as the
    // declaration cards: an active pool item awaiting declaration is actionable
    // even when a legacy transaction happens to match its source document.
    for (const item of scopedPool) {
      const qty = parseInt(item.jumlahAfkir !== undefined ? item.jumlahAfkir : (item.quantity || 0), 10);
      const status = String(item.status || 'PENDING_DECLARATION').toUpperCase().trim();
      if (qty > 0 && ['PENDING_DECLARATION', 'PENDING', 'DRAFT', 'DIKEMBALIKAN', 'REVISION'].includes(status)) {
        return true;
      }
    }

    for (const item of scopedPool) {
      const qty = parseInt(item.jumlahAfkir !== undefined ? item.jumlahAfkir : (item.quantity || 0), 10);
      if (isNaN(qty) || qty <= 0) continue;

      const existing = findExistingSelectionTransaction(item);
      if (!existing) {
        const s = String(item.status || '').toUpperCase().trim();
        const isAlreadyHandled = (
          s === 'DECLARED_CULLED' ||
          s === 'READY_TO_CONFIRM' ||
          s === SELECTION_STATUS.READY_TO_CONFIRM ||
          s === 'SUBMITTED_TO_ASB' ||
          s === 'MENUNGGU_VERIFIKASI' ||
          s === SELECTION_STATUS.MENUNGGU_VERIFIKASI ||
          s === 'DISETUJUI' ||
          s === SELECTION_STATUS.DISETUJUI ||
          s === 'VERIFIED'
        );
        if (!isAlreadyHandled) {
          return true;
        }
      } else {
        const existStatus = String(existing.status || '').toUpperCase().trim();
        const itemStatus = String(item.status || '').toUpperCase().trim();
        if (
          existStatus === SELECTION_STATUS.DIKEMBALIKAN ||
          existStatus === 'REVISION' ||
          itemStatus === SELECTION_STATUS.DIKEMBALIKAN ||
          itemStatus === 'REVISION'
        ) {
          return true;
        }
      }
    }
  }

  return false;
}

/**
 * Bridge hasil Mati/Gagal pemeriksaan Okulasi ke kandidat deklarasi afkir.
 * Idempoten agar aman dipanggil dari Beranda maupun halaman Penyeleksian.
 */
export function syncInspectionRejectionsToSelectionPool() {
  let pool = storage.get('selection_pool', []);
  if (!Array.isArray(pool)) pool = [];
  const inspections = storage.get('inspection_transactions', []);
  const buddingTxs = storage.get('budding_transactions', []);
  if (!Array.isArray(inspections) || inspections.length === 0) return false;

  let changed = false;
  inspections.forEach(insp => {
    if (!insp || ['BATAL', 'CANCELLED', 'VOID'].includes(String(insp.status || '').toUpperCase())) return;
    const inspectionDocNo = String(insp.docNo || '').replace('/PRK/', '/INS/').replace('/INSP/', '/INS/');
    if (!isBuddingWorkflowInspectionApproved(insp)) {
      const pendingIndex = pool.findIndex(item => item.originType === 'REJECT_PEMERIKSAAN' &&
        String(item.inspectionDocNo || '').replace('/PRK/', '/INS/').replace('/INSP/', '/INS/') === inspectionDocNo);
      if (pendingIndex >= 0 && ['PENDING_DECLARATION', 'PENDING', 'DRAFT', 'DIKEMBALIKAN', 'REVISION'].includes(String(pool[pendingIndex].status || '').toUpperCase())) {
        pool.splice(pendingIndex, 1);
        changed = true;
      }
      return;
    }
    const isRegrafting = String(insp.buddingType || '').toUpperCase() === 'REGRAFTING';
    const workerFailures = (Array.isArray(insp.workers) ? insp.workers : []).reduce((sum, worker) => {
      const gagal = Number(worker.jlhTidakBerhasil || 0);
      return sum + (worker.perluRegrafting === false ? gagal : 0);
    }, 0);
    const jumlahAfkir = insp.totalToSelection !== undefined
      ? Number(insp.totalToSelection || 0)
      : (isRegrafting
        ? Number(insp.jumlahGagal || 0)
        : workerFailures);
    const existingIndex = pool.findIndex(item =>
      item.originType === 'REJECT_PEMERIKSAAN' &&
      String(item.inspectionDocNo || '').replace('/PRK/', '/INS/').replace('/INSP/', '/INS/') === inspectionDocNo
    );
    const existing = existingIndex >= 0 ? pool[existingIndex] : null;
    const existingStatus = String(existing?.status || 'PENDING_DECLARATION').toUpperCase();
    if (existing && !['PENDING_DECLARATION', 'PENDING', 'DRAFT', 'DIKEMBALIKAN', 'REVISION'].includes(existingStatus)) return;
    const sourceBudding = (Array.isArray(buddingTxs) ? buddingTxs : []).find(tx => tx.docNo === insp.buddingDocNo) || {};

    if (jumlahAfkir <= 0) {
      if (existing && ['PENDING_DECLARATION', 'PENDING', 'DRAFT'].includes(String(existing.status || '').toUpperCase())) {
        pool.splice(existingIndex, 1);
        changed = true;
      }
      return;
    }

    const candidate = {
      ...(existing || {}),
      id: existing?.id || `SEL-POOL-INS-${inspectionDocNo}`,
      docNo: existing?.docNo || null,
      originType: 'REJECT_PEMERIKSAAN',
      sourceModule: 'INSPECTION',
      sourceTransactionType: isRegrafting ? 'REGRAFTING' : 'GRAFTING',
      selectionType: 'PASCA_OKULASI',
      selectionStage: 'SELEKSI_PASCA_OKULASI',
      inspectionDocNo,
      sourceBuddingDocNo: insp.buddingDocNo || sourceBudding.docNo || null,
      sourceDocNo: insp.sourceDocNo || sourceBudding.sourceDocNo || insp.buddingDocNo || null,
      batchNo: insp.batchNo || sourceBudding.batchNo || 'Batch',
      batchCode: insp.batchCode || sourceBudding.batchCode || sourceBudding.batchNo || insp.batchNo || 'Batch',
      programCode: insp.programCode || sourceBudding.programCode || sourceBudding.programId || sourceBudding.programName || '',
      programId: insp.programId || sourceBudding.programId || sourceBudding.programCode || '',
      tanggal: insp.tanggal || insp.date || getEffectiveTodayDDMMYYYY(),
      bedengan: insp.bedengan || sourceBudding.bedengan || '',
      bedenganCode: insp.bedenganCode || sourceBudding.bedenganCode || insp.bedengan || sourceBudding.bedengan || '',
      klon: insp.klonEntres || sourceBudding.klonEntres || '',
      klonRootstock: insp.klonRootstock || sourceBudding.klonRootstock || '',
      jumlahAfkir,
      alasan: isRegrafting ? 'Mati / Gagal setelah Okulasi Janda (Regrafting)' : 'Mati / Gagal Pemeriksaan Okulasi (tidak dialokasikan ke Okulasi Janda)',
      status: existing?.status || 'PENDING_DECLARATION',
      estateId: insp.estateId || sourceBudding.estateId,
      divisionId: insp.divisionId || sourceBudding.divisionId,
      actorName: insp.actorName || insp.mantri || insp.createdByName,
      actorCode: insp.actorCode || insp.createdByLoginCode,
      userId: insp.userId || insp.createdByUserId,
      createdBy: insp.createdBy || insp.createdByUserId || insp.userId,
      createdByName: insp.createdByName || insp.actorName || insp.mantri,
      createdByUserId: insp.createdByUserId || insp.userId,
      createdByEstateId: insp.createdByEstateId || insp.estateId || sourceBudding.estateId,
      createdByDivisionId: insp.createdByDivisionId || insp.divisionId || sourceBudding.divisionId
    };

    if (existingIndex >= 0) {
      if (JSON.stringify(pool[existingIndex]) !== JSON.stringify(candidate)) {
        pool[existingIndex] = candidate;
        changed = true;
      }
    } else {
      pool.push(candidate);
      changed = true;
    }
  });

  if (changed) storage.set('selection_pool', pool);
  return changed;
}

/**
 * Format label sumber transaksi asal seleksi
 */
export function getSelectionSourceLabel(item) {
  if (!item) return 'Transaksi Seleksi';
  if (item.originType === 'REJECT_DEDERAN' || item.sourceModule === 'DEDERAN') {
    return 'Pemeriksaan Dederan';
  }
  if (item.sourceModule === 'PENYEMAIAN' || item.originType === 'REJECT_PENYEMAIAN') {
    return 'Transaksi Penyemaian';
  }
  if (item.originType === 'REJECT_OKULASI') {
    return 'Okulasi (Grafting)';
  }
  if (item.originType === 'REJECT_REGRAFTING') {
    return 'Okulasi Janda (Regrafting)';
  }
  if (item.originType === 'REJECT_PEMERIKSAAN' || item.inspectionDocNo) {
    return 'Pemeriksaan Okulasi';
  }
  if (item.originType === 'REJECT_PENERIMAAN') {
    return 'Penerimaan Bibit';
  }
  return item.sourceModule || item.sumberAsal || 'Transaksi Seleksi';
}

/**
 * Format label kategori penyeleksian (7 Alasan Standar & Kategori Historis)
 */
export function getSelectionCategoryLabel(item) {
  if (!item) return 'Afkir';

  const standardMap = {
    'BUSUK': 'Busuk',
    'FOMES': 'Fomes',
    'JAMUR LAINNYA': 'Jamur Lainnya',
    'JAMUR_LAINNYA': 'Jamur Lainnya',
    'KERDIL': 'Kerdil',
    'MATI': 'Mati',
    'PATAH': 'Patah',
    'RUSAK': 'Rusak',
    'REJECT': 'Reject',
    'LAINNYA': 'Lainnya',
    'AFKIR': 'Afkir'
  };

  const rawCat = String(item.category || item.alasanDitolakCategory || item.alasanAfkir || '').trim().toUpperCase();
  if (standardMap[rawCat]) {
    return standardMap[rawCat];
  }

  const rawAlasan = String(item.alasanDetail || item.alasan || '').trim();
  const rawAlasanUpper = rawAlasan.toUpperCase();
  if (standardMap[rawAlasanUpper]) {
    return standardMap[rawAlasanUpper];
  }

  if (rawAlasan && rawAlasan !== '-' && !rawAlasan.startsWith('Bibit ') && !rawAlasan.startsWith('Hasil ')) {
    return rawAlasan;
  }

  return 'Afkir';
}

function formatSingleBedenganCode(val) {
  if (!val) return '';
  const s = String(val).trim();
  if (/^BED-\d+/i.test(s)) return s.toUpperCase();
  const match = s.match(/Bedengan[- ]*(\d+)/i);
  if (match) {
    return `BED-${String(match[1]).padStart(3, '0')}`;
  }
  const digits = s.match(/^(\d+)$/);
  if (digits) {
    return `BED-${String(digits[1]).padStart(3, '0')}`;
  }
  return s;
}

/**
 * Format Bedengan agar hanya menampilkan Kode Bisnis Bedengan saja (BED-001, BED-002)
 */
export function formatBedenganDisplayCode(item) {
  if (!item) return '-';
  
  if (typeof item === 'string') {
    const parts = item.split(',').map(p => formatSingleBedenganCode(p.trim())).filter(Boolean);
    return parts.length > 0 ? Array.from(new Set(parts)).join(', ') : '-';
  }

  // If item.rows exists (e.g. from Seeding or Selection Parent Doc)
  if (Array.isArray(item.rows) && item.rows.length > 0) {
    const parts = item.rows.map(r => formatSingleBedenganCode(r.bedenganCode || r.bedenganId || r.bedengan)).filter(Boolean);
    if (parts.length > 0) return Array.from(new Set(parts)).join(', ');
  }

  // If bedenganCode exists
  if (item.bedenganCode && typeof item.bedenganCode === 'string') {
    const parts = item.bedenganCode.split(',').map(s => formatSingleBedenganCode(s.trim())).filter(Boolean);
    if (parts.length > 0) return Array.from(new Set(parts)).join(', ');
  }

  // If bedenganIds exists (array of IDs or codes)
  if (Array.isArray(item.bedenganIds) && item.bedenganIds.length > 0) {
    const resolved = item.bedenganIds.map(idOrCode => {
      const bObj = getBedenganById(idOrCode);
      if (bObj && bObj.bedenganCode) return formatSingleBedenganCode(bObj.bedenganCode);
      return formatSingleBedenganCode(idOrCode);
    }).filter(Boolean);
    if (resolved.length > 0) return Array.from(new Set(resolved)).join(', ');
  }

  if (item.bedenganId) {
    const bObj = getBedenganById(item.bedenganId);
    if (bObj && bObj.bedenganCode) return formatSingleBedenganCode(bObj.bedenganCode);
  }

  if (item.bedengan) {
    const str = String(item.bedengan).trim();
    if (str === '-' || !str) return '-';
    const parts = str.split(',').map(p => formatSingleBedenganCode(p.trim())).filter(Boolean);
    if (parts.length > 0) return Array.from(new Set(parts)).join(', ');
  }

  return '-';
}


/**
 * Validasi form pengajuan / input hasil seleksi
 */
export function validateSelectionData(payload) {
  const errors = [];
  if (!payload) {
    return { isValid: false, errors: ['Data seleksi tidak boleh kosong.'] };
  }

  const checked = parseInt(payload.jumlahDiperiksa || payload.totalChecked || 0, 10);
  const pass = parseInt(payload.jumlahLayak || payload.layakQty || 0, 10);
  const cull = parseInt(payload.jumlahAfkir || payload.afkirQty || 0, 10);

  if (isNaN(checked) || checked <= 0) {
    errors.push('Jumlah bibit yang diperiksa harus lebih besar dari 0.');
  }
  if (isNaN(pass) || pass < 0) {
    errors.push('Jumlah bibit layak tidak boleh negatif.');
  }
  if (isNaN(cull) || cull < 0) {
    errors.push('Jumlah bibit afkir tidak boleh negatif.');
  }
  if (pass + cull !== checked) {
    errors.push(`Kombinasi Layak (${pass.toLocaleString('id-ID')}) + Afkir (${cull.toLocaleString('id-ID')}) harus sama dengan Total Diperiksa (${checked.toLocaleString('id-ID')}).`);
  }

  if (!payload.batchId && !payload.batchCode && !payload.batchNo) {
    errors.push('Batch sumber bibit wajib dipilih.');
  }

  return {
    isValid: errors.length === 0,
    errors,
    checked,
    pass,
    cull
  };
}

/**
 * Cari existing selection transaction berdasarkan identitas source selection
 */
export function findExistingSelectionTransaction(item) {
  if (!item) return null;
  const allTxs = storage.get(SELECTION_STORAGE_KEY, []);
  
  const normCat = (c) => String(c || '').trim().toUpperCase();
  const itemCat = normCat(item.category || item.alasanDitolakCategory || 'AFKIR');
  const itemSourceDoc = String(item.sourceDocNo || item.seedingDocNo || item.buddingDocNo || item.inspectionDocNo || '').trim();
  const itemSourceTxId = String(item.sourceTransactionId || itemSourceDoc || item.id || '').trim();
  const itemDocNo = String(item.docNo || item.selectionNo || item.selectionPoolDocNo || '').trim();
  const itemBed = String(item.bedenganCode || item.bedengan || '').trim();
  const itemBatch = String(item.batchCode || item.batchNo || '').trim();
  const itemStage = String(item.selectionStage || item.stage || '').trim().toUpperCase();

  return allTxs.find(tx => {
    // 1. Dokumen CULL resmi (baik format standar 4 segmen maupun format 3 segmen legacy)
    // TIDAK PERNAH dianggap sebagai transaksi eksekusi pelaksanaan.
    const isCull = Boolean(isCullDocNo(tx.docNo) || isCullDocNo(tx.selectionNo) || isCullDocNo(tx.selectionPoolDocNo));

    // Transaksi eksekusi pelaksanaan Seleksi I, II, III (misal 2026/SEL-I/001, PELAKSANAAN_SELEKSI_I)
    // bukanlah deklarasi CULL dan tidak boleh menyembunyikan deklarasi afkir.
    const isExecutionTx = !isCull && (
      Boolean(tx.parentSelectionDocumentId) ||
      Boolean(tx.selectionDocumentId) ||
      Boolean(tx.parentSelectionDocNo) ||
      Boolean(tx.selectionDocNo && String(tx.selectionDocNo).includes('/SEL/')) ||
      Boolean(tx.docNo && (String(tx.docNo).includes('/SEL/') || String(tx.docNo).includes('/SEL-I/') || String(tx.docNo).includes('/SEL-II/') || String(tx.docNo).includes('/SEL-III/'))) ||
      tx.selectionType === SELECTION_TYPES.PRA_OKULASI ||
      Boolean(tx.transactionType && String(tx.transactionType).startsWith('PELAKSANAAN_SELEKSI'))
    );
    if (isExecutionTx) {
      return false;
    }

    // 2. Direct match by transaction ID or Selection ID
    if (item.selectionTransactionId && (tx.id === item.selectionTransactionId || tx.selectionId === item.selectionTransactionId)) {
      return true;
    }
    if (item.id && (tx.id === item.id || tx.selectionId === item.id)) {
      return true;
    }

    // 3. Direct match by selectionPoolDocNo or docNo
    if (itemDocNo && (tx.selectionPoolDocNo === itemDocNo || tx.docNo === itemDocNo)) {
      const txBed = String(tx.bedenganCode || tx.bedengan || '').trim();
      if (itemBed && txBed && itemBed !== txBed) return false;

      if ((item.originType === 'REJECT_PENYEMAIAN' || item.sourceModule === 'PENYEMAIAN') && (tx.originType === 'REJECT_PENYEMAIAN' || tx.sourceModule === 'PENYEMAIAN')) return true;
      if (item.category && tx.category && normCat(tx.category) !== normCat(item.category) && itemCat !== 'PENDING_DECLARATION' && normCat(tx.category) !== 'PENDING_DECLARATION') return false;
      return true;
    }

    // 4. Match by source selection identity (sourceDocNo / sourceTransactionId + bedengan + batch + category + module)
    const txSourceDoc = String(tx.sourceDocNo || '').trim();
    const txSourceTxId = String(tx.sourceTransactionId || '').trim();
    const txCat = normCat(tx.category || tx.alasanDitolakCategory || 'AFKIR');
    const txBed = String(tx.bedenganCode || tx.bedengan || '').trim();
    const txBatch = String(tx.batchCode || tx.batchNo || '').trim();
    const txStage = String(tx.selectionStage || tx.stage || '').trim().toUpperCase();

    // Bedengan / Batch / Stage guard: Jangan menghubungkan CULL ke item pool yang berbeda
    // hanya karena memiliki sourceDocNo, batch, atau tahap seleksi yang sama.
    if (itemBed && txBed && itemBed !== txBed) return false;
    if (itemBatch && txBatch && itemBatch !== txBatch) return false;
    if (itemStage && txStage && itemStage !== txStage) return false;

    const validItemDoc = itemSourceDoc && itemSourceDoc !== '-';
    const validTxDoc = txSourceDoc && txSourceDoc !== '-';
    const validItemTxId = itemSourceTxId && itemSourceTxId !== '-';
    const validTxTxId = txSourceTxId && txSourceTxId !== '-';

    const sourceMatches = (
      (validItemDoc && validTxDoc && itemSourceDoc === txSourceDoc) ||
      (validItemTxId && validTxTxId && itemSourceTxId === txSourceTxId) ||
      (validItemDoc && validTxTxId && itemSourceDoc === txSourceTxId) ||
      (validItemTxId && validTxDoc && itemSourceTxId === txSourceDoc)
    );

    if (sourceMatches) {
      if (itemCat === txCat) return true;
      if (item.originType === tx.originType && (item.originType === 'REJECT_DEDERAN' || item.sourceModule === 'DEDERAN')) return true;
      if ((item.originType === 'REJECT_PENYEMAIAN' || item.sourceModule === 'PENYEMAIAN') && (tx.originType === 'REJECT_PENYEMAIAN' || tx.sourceModule === 'PENYEMAIAN')) return true;
      if ((item.originType === 'REJECT_PRE_GRAFTING' || item.sourceModule === 'SELEKSI_PRA_OKULASI') && (tx.originType === 'REJECT_PRE_GRAFTING' || tx.sourceModule === 'SELEKSI_PRA_OKULASI')) return true;
    }

    return false;
  }) || null;
}

/**
 * Membuat transaksi hasil seleksi baru (oleh Mantri Bibitan)
 */
export function createSelectionRecord(payload, currentUser) {
  const val = validateSelectionData(payload);
  if (!val.isValid) {
    throw new Error(val.errors.join(' '));
  }

  // Idempotency: Cari transaksi yang sudah ada untuk source yang sama
  const existingRecord = findExistingSelectionTransaction(payload);
  if (existingRecord) {
    return existingRecord;
  }

  const allRecords = storage.get(SELECTION_STORAGE_KEY, []);
  
  let docNo = payload.docNo || payload.selectionNo;
  if (!docNo) {
    const subCode = resolveCullSourceCode(payload);
    docNo = allocateCullDocNo(subCode, 2026, allRecords);
  }

  // Resolve batch metadata
  const bObj = payload.batchId ? getBatchById(payload.batchId) : getBatchByCode(payload.batchCode || payload.batchNo);
  const batchId = bObj ? bObj.id : (payload.batchId || `BATCH-${Date.now()}`);
  const batchCode = bObj ? (bObj.batchCode || bObj.batchNo) : (payload.batchCode || payload.batchNo || 'B-001');

  // Resolve bedengan
  const bedenganIds = payload.bedenganIds || (payload.bedenganId ? [payload.bedenganId] : (bObj?.bedenganIds || []));

  // Resolve stage and type semantically based on originType and sourceModule
  let determinedStage = payload.selectionStage;
  let determinedType = payload.selectionType;

  if (!determinedStage || determinedStage === SELECTION_STAGES.PASCA_OKULASI) {
    if (payload.originType === 'REJECT_DEDERAN' || payload.sourceModule === 'DEDERAN') {
      determinedStage = SELECTION_STAGES.PRA_SEMAI;
      determinedType = SELECTION_TYPES.PRA_SEMAI;
    } else if (payload.originType === 'REJECT_PENYEMAIAN' || payload.sourceModule === 'PENYEMAIAN') {
      determinedStage = SELECTION_STAGES.PINDAH_SEMAI;
      determinedType = SELECTION_TYPES.PINDAH_SEMAI;
    } else if (payload.isPreGrafting) {
      determinedStage = SELECTION_STAGES.SELEKSI_1;
      determinedType = SELECTION_TYPES.PRA_OKULASI;
    } else {
      determinedStage = SELECTION_STAGES.PASCA_OKULASI;
      determinedType = SELECTION_TYPES.PASCA_OKULASI;
    }
  }

  const newRecord = applyTransactionActor(
    {
      id: payload.id || `SEL-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      selectionId: payload.selectionId || `SEL-${Date.now()}`,
      docNo: docNo,
      selectionNo: docNo,
      selectionPoolDocNo: payload.selectionPoolDocNo || docNo,
      parentSelectionDocNo: payload.parentSelectionDocNo || payload.selectionDocNo || null,
      parentSelectionDocumentId: payload.parentSelectionDocumentId || payload.selectionDocumentId || null,
      selectionDocumentId: payload.selectionDocumentId || payload.parentSelectionDocumentId || null,
      sourceModule: payload.sourceModule || 'PENYEMAIAN',
      sourceTransactionType: payload.sourceTransactionType || 'SEEDING',
      sourceTransactionId: payload.sourceTransactionId || payload.sourceDocNo || docNo,
      sourceDocNo: payload.sourceDocNo || '-',
      transactionType: 'PEMERIKSAAN_HASIL_SELEKSI',
      
      batchId: batchId,
      batchCode: batchCode,
      
      estateId: payload.estateId || bObj?.estateId || currentUser.estateId,
      estateName: payload.estateName || bObj?.estateName || currentUser.estateName || '-',
      divisionId: payload.divisionId || bObj?.divisionId || currentUser.divisionId,
      divisionName: payload.divisionName || bObj?.divisionName || currentUser.divisionName || '-',
      
      programId: payload.programId || bObj?.programId || 'PRG-2026-001',
      programName: payload.programName || bObj?.programName || '-',
      
      clone: payload.clone || payload.klon || bObj?.clone || 'IRCA 19',
      klon: payload.clone || payload.klon || bObj?.clone || 'IRCA 19',
      growthStage: payload.growthStage || payload.stage || bObj?.growthStage || 'Rubber Advance Planting Material',
      category: payload.category || bObj?.category || 'Polibag Besar',
      
      bedenganIds: bedenganIds,
      bedenganId: bedenganIds.length > 0 ? bedenganIds[0] : (payload.bedenganId || null),
      bedengan: payload.bedengan || (bedenganIds.length > 0 ? bedenganIds.join(', ') : '-'),
      
      jumlahDiperiksa: val.checked,
      jumlahLayak: val.pass,
      jumlahAfkir: val.cull,
      
      selectionStage: determinedStage,
      selectionType: determinedType,
      isCompleted: payload.isCompleted !== undefined ? Boolean(payload.isCompleted) : false,
      polybagCount: payload.polybagCount !== undefined ? parseInt(payload.polybagCount, 10) : Math.ceil(val.checked / 2),
      
      tanggalSeleksi: payload.tanggalSeleksi || payload.selectionDate || getEffectiveTodayDDMMYYYY(),
      catatan: (typeof payload.catatan === 'string' && payload.catatan.trim() !== '')
        ? payload.catatan.trim()
        : ((typeof payload.remarks === 'string' && payload.remarks.trim() !== '') ? payload.remarks.trim() : null),
      
      status: payload.status || 'READY_TO_CONFIRM',
      submissionStatus: payload.submissionStatus || null,
      submittedAt: payload.submittedAt || null,
      stockMutationStatus: STOCK_MUTATION_STATUS.PENDING,
      
      createdByUserId: currentUser.userId || currentUser.code || currentUser.id,
      createdByName: currentUser.name || 'Mantri Bibitan',
      createdByRole: currentUser.role || 'MANTRI_TANAMAN',
      createdAt: new Date().toISOString()
    },
    AUDIT_EVENT_TYPES.CREATE,
    currentUser,
    `Pengajuan hasil seleksi batch ${batchCode} (Diperiksa: ${val.checked}, Layak: ${val.pass}, Afkir: ${val.cull})`
  );

  allRecords.push(newRecord);
  storage.set(SELECTION_STORAGE_KEY, allRecords);
  return newRecord;
}

/**
 * Approve Pemeriksaan Hasil Seleksi oleh Asisten Bibitan
 */
export function approveSelectionRecord(recordIdOrDocNo, notes = '', currentUser, autoMutateStock = false) {
  if (!currentUser) throw new Error('Pengguna aktif tidak valid.');
  const role = normalizeRole(currentUser.role || currentUser.rawRole);
  if (role !== ROLES.ASISTEN_BIBITAN) {
    throw new Error('Hanya Asisten Bibitan yang berhak menyetujui hasil seleksi.');
  }

  const allRecords = storage.get(SELECTION_STORAGE_KEY, []);
  const idx = allRecords.findIndex(r => r.id === recordIdOrDocNo || r.selectionId === recordIdOrDocNo || r.docNo === recordIdOrDocNo);
  if (idx === -1) {
    throw new Error(`Data seleksi dengan identitas ${recordIdOrDocNo} tidak ditemukan.`);
  }

  const target = allRecords[idx];
  if (!canPerformAsistenSelectionAction(target, currentUser)) {
    throw new Error('Anda tidak memiliki otorisasi untuk menyetujui dokumen ini.');
  }

  const isExemptPrePlanting = isPrePlantingCullStockExempt(target);
  const mutationQty = parseInt(target.jumlahAfkir || target.quantity || 0, 10);
  const nowIso = new Date().toISOString();

  // 0. Kernel Level Locks Assertion
  const batchKey = target.batchId || target.batchCode || target.batchNo;
  const bedenganKey = target.bedenganId || target.bedenganCode || target.bedengan;
  if (batchKey) assertBatchNotLocked(batchKey);
  if (bedenganKey) assertBedenganNotLocked(batchKey, bedenganKey);

  // 1. Catat Approval Decision Record Asisten (PERSISTENT & IMMUTABLE)
  const decisions = storage.get('selection_approval_decisions', []);
  const decisionId = `DEC-${target.id || target.docNo}-${Date.now()}`;
  const decisionRecord = {
    id: decisionId,
    txId: target.id || target.docNo,
    docNo: target.docNo || target.id,
    batchId: batchKey || null,
    bedenganId: bedenganKey || null,
    approvedQty: mutationQty,
    actorId: currentUser?.userId || currentUser?.id || 'ASISTEN',
    actorRole: ROLES.ASISTEN_BIBITAN,
    signatureNote: notes || (isExemptPrePlanting ? 'Persetujuan hasil seleksi pra-tanam' : 'Disetujui oleh Asisten Bibitan'),
    createdAt: nowIso
  };
  decisions.push(decisionRecord);
  storage.set('selection_approval_decisions', decisions);

  let stockMutationStatusResult = STOCK_MUTATION_STATUS.NOT_REQUIRED;

  const performMutation = () => {
    // 2. Catat Mutation Intent (IN_FLIGHT)
    const intents = storage.get('selection_mutation_intents', []);
    const idempotencyKey = `MUT-${batchKey}-SEL-${target.id || target.docNo}`;
    const intentRecord = {
      id: `INTENT-${target.id || target.docNo}`,
      txId: target.id || target.docNo,
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

    // 3. Sync / resolve available inventory
    syncBatchPopulationFromSeeding(batchKey);
    const currentAvailable = getInventoryAvailableQty(batchKey);

    // 4. Validate stock adequacy
    if (currentAvailable < mutationQty) {
      intentRecord.status = 'HALTED_RETRY_REQUIRED';
      intentRecord.errorReason = `Stok batch ${batchKey} tidak mencukupi (Tersedia: ${currentAvailable.toLocaleString('id-ID')} Pkk < Afkir: ${mutationQty.toLocaleString('id-ID')} Pkk).`;
      intentRecord.updatedAt = new Date().toISOString();
      storage.set('selection_mutation_intents', intents);
      throw new Error(intentRecord.errorReason);
    }

    // 5. Perform stock deduction in inventory ledger under idempotency key
    try {
      deductInventoryStock(
        batchKey,
        mutationQty,
        INVENTORY_TX_TYPE.SELECTION,
        { id: target.docNo || target.id, idempotencyKey },
        currentUser,
        `Pengurangan stok seleksi afkir ${target.docNo || target.id}`
      );
      stockMutationStatusResult = STOCK_MUTATION_STATUS.APPLIED;

      // Update intent status to COMPLETED
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
  };

  const finalizeRecord = () => {
    // 5. COMMIT STATUS & AUDIT TRAIL HANYA SETELAH STOCK MUTATION BERHASIL (ATAU NOT_REQUIRED)
    const updatedRecord = applyTransactionActor(
      {
        ...target,
        status: SELECTION_STATUS.DISETUJUI,
        approvalNotes: notes || 'Disetujui oleh Asisten Bibitan',
        stockMutationStatus: stockMutationStatusResult,
        stockMutationAt: stockMutationStatusResult === STOCK_MUTATION_STATUS.APPLIED ? nowIso : (target.stockMutationAt || null),
        stockMutationBy: stockMutationStatusResult === STOCK_MUTATION_STATUS.APPLIED ? (currentUser.userId || currentUser.code || currentUser.id || 'ASISTEN') : (target.stockMutationBy || null),
        stockMutationQty: stockMutationStatusResult === STOCK_MUTATION_STATUS.APPLIED ? mutationQty : (target.stockMutationQty || 0),
        stockMutationError: null,
        verifiedByUserId: currentUser.userId || currentUser.code || currentUser.id,
        verifiedByName: currentUser.name || 'Asisten Bibitan',
        verifiedByRole: ROLES.ASISTEN_BIBITAN,
        verifiedAt: nowIso,
        updatedAt: nowIso
      },
      AUDIT_EVENT_TYPES.APPROVE,
      currentUser,
      isExemptPrePlanting
        ? `Persetujuan hasil seleksi pra-tanam ${target.docNo} (${target.bedengan || target.bedenganCode || '-'}, ${target.jumlahAfkir} Afkir)`
        : `Persetujuan hasil seleksi untuk batch ${target.batchCode || target.batchNo || '-'} (${target.jumlahLayak || 0} Layak, ${target.jumlahAfkir || target.quantity || 0} Afkir)`
    );

    allRecords[idx] = updatedRecord;
    storage.set(SELECTION_STORAGE_KEY, allRecords);

    // 6. Sync corresponding entry in selection_pool
    let fullPool = storage.get('selection_pool', []);
    const poolIdx = fullPool.findIndex(p => 
      p.selectionTransactionId === target.id ||
      p.id === target.selectionTransactionId ||
      p.docNo === target.docNo ||
      p.selectionDocNo === target.docNo ||
      (p.dederanDocNo && p.dederanDocNo === target.sourceDocNo) ||
      (p.sourceDocNo && p.sourceDocNo === target.sourceDocNo)
    );
    if (poolIdx !== -1) {
      fullPool[poolIdx].status = 'DECLARED_CULLED';
      fullPool[poolIdx].verifiedAt = nowIso;
      fullPool[poolIdx].verifiedByName = currentUser.name || 'Asisten Bibitan';
      storage.set('selection_pool', fullPool);
    }

    return updatedRecord;
  };

  // TWO-PHASE COMMIT MUTATION INTENT & DEDUCTION
  if (!isExemptPrePlanting && mutationQty > 0 && autoMutateStock) {
    if (target.stockMutationStatus !== STOCK_MUTATION_STATUS.APPLIED) {
      if (!batchKey) {
        throw new Error(`Dokumen seleksi ${target.docNo || target.id} tidak memiliki referensi batch.`);
      }

      performMutation();
      if (typeof navigator !== 'undefined' && navigator.locks && navigator.locks.request) {
        executeStockMutationWithLock(batchKey, async () => {}).catch(() => {});
      }
      return finalizeRecord();
    } else {
      stockMutationStatusResult = STOCK_MUTATION_STATUS.APPLIED;
      return finalizeRecord();
    }
  }

  return finalizeRecord();
}

/**
 * MUTASI STOK HASIL SELEKSI (TASK ASB-13)
 * Mengurangi availableQty & currentQty pada nursery_batches berdasarkan jumlahAfkir hasil seleksi yang DISETUJUI.
 */
export function mutateStockFromSelection(recordIdOrDocNo, currentUser) {
  const allRecords = storage.get(SELECTION_STORAGE_KEY, []);
  const idx = allRecords.findIndex(r => r.id === recordIdOrDocNo || r.selectionId === recordIdOrDocNo || r.docNo === recordIdOrDocNo);
  if (idx === -1) {
    throw new Error(`Data seleksi dengan identitas ${recordIdOrDocNo} tidak ditemukan.`);
  }

  const target = allRecords[idx];

  // 1. Validasi Status Seleksi: Hanya DISETUJUI yang boleh memutasi stok
  const statusUpper = (target.status || '').toUpperCase();
  if (statusUpper !== SELECTION_STATUS.DISETUJUI) {
    throw new Error(`Hanya hasil seleksi dengan status DISETUJUI yang dapat melakukan mutasi stok (status saat ini: ${target.status}).`);
  }

  // 2. IDEMPOTENCY CHECK: Jika sudah dimutasi atau tidak diperlukan mutasi, jangan mutasi lagi
  if (target.stockMutationStatus === STOCK_MUTATION_STATUS.APPLIED || target.stockMutationStatus === STOCK_MUTATION_STATUS.NOT_REQUIRED) {
    return {
      status: target.stockMutationStatus === STOCK_MUTATION_STATUS.NOT_REQUIRED ? STOCK_MUTATION_STATUS.NOT_REQUIRED : STOCK_MUTATION_STATUS.ALREADY_APPLIED,
      success: true,
      message: target.stockMutationStatus === STOCK_MUTATION_STATUS.NOT_REQUIRED ? 'Mutasi stok tidak diperlukan untuk transaksi ini.' : 'Mutasi stok sudah pernah diterapkan sebelumnya.',
      selection: target,
      batch: null
    };
  }

  // 3. Formula: stockMutationQty = jumlahAfkir
  const mutationQty = parseInt(target.jumlahAfkir || target.quantity || 0, 10);

  // 4. Zero-Afkir Handling: Jika afkir = 0, stok tidak berubah
  if (mutationQty === 0) {
    const updatedRecord = {
      ...target,
      stockMutationStatus: STOCK_MUTATION_STATUS.NOT_REQUIRED,
      stockMutationAt: new Date().toISOString(),
      stockMutationBy: currentUser?.userId || currentUser?.id || 'SYSTEM',
      stockMutationQty: 0,
      stockMutationError: null,
      updatedAt: new Date().toISOString()
    };
    allRecords[idx] = updatedRecord;
    storage.set(SELECTION_STORAGE_KEY, allRecords);

    return {
      status: STOCK_MUTATION_STATUS.NOT_REQUIRED,
      success: true,
      message: 'Jumlah afkir 0, mutasi stok tidak diperlukan.',
      selection: updatedRecord,
      batch: null
    };
  }

  // 5. Pengecualian mutasi stok pra-tanam (Dederan & CULL Pindah Semai pra-tanam yang sah)
  if (isPrePlantingCullStockExempt(target)) {
    const updatedRecord = {
      ...target,
      stockMutationStatus: STOCK_MUTATION_STATUS.NOT_REQUIRED,
      stockMutationAt: new Date().toISOString(),
      stockMutationBy: currentUser?.userId || currentUser?.id || 'SYSTEM',
      stockMutationQty: mutationQty,
      stockMutationError: null,
      updatedAt: new Date().toISOString()
    };
    allRecords[idx] = updatedRecord;
    storage.set(SELECTION_STORAGE_KEY, allRecords);

    return {
      status: STOCK_MUTATION_STATUS.NOT_REQUIRED,
      success: true,
      message: 'Hasil seleksi pra-tanam berhasil disetujui (tidak memutasi stok polybag).',
      selection: updatedRecord,
      batch: null
    };
  }

  // 6. Muat / Sync Batch untuk Pasca-Okulasi / Main Nursery
  const batchKey = target.batchId || target.batchCode || target.batchNo;
  const bedenganKey = target.bedenganId || target.bedenganCode || target.bedengan;
  if (!batchKey) {
    throw new Error(`Batch ${target.batchCode || target.batchId} tidak ditemukan.`);
  }

  assertBatchNotLocked(batchKey);
  if (bedenganKey) assertBedenganNotLocked(batchKey, bedenganKey);

  syncBatchPopulationFromSeeding(batchKey);

  // 7. Validasi Kecukupan Stok via Inventory Service
  const currentAvailable = getInventoryAvailableQty(batchKey);
  if (currentAvailable < mutationQty) {
    const failedRecord = {
      ...target,
      stockMutationStatus: STOCK_MUTATION_STATUS.FAILED,
      stockMutationError: `Stok tidak mencukupi: Tersedia ${currentAvailable}, Afkir ${mutationQty}`,
      updatedAt: new Date().toISOString()
    };
    allRecords[idx] = failedRecord;
    storage.set(SELECTION_STORAGE_KEY, allRecords);
    throw new Error(`Stok batch ${batchKey} tidak mencukupi (Tersedia: ${currentAvailable.toLocaleString('id-ID')} Pkk < Afkir: ${mutationQty.toLocaleString('id-ID')} Pkk).`);
  }

  // 8. Atomic Stock Mutation Commit via Inventory Service dengan Idempotency Key
  const idempotencyKey = `MUT-${batchKey}-SEL-${target.id || target.docNo}`;
  const updatedInvState = deductInventoryStock(
    batchKey,
    mutationQty,
    INVENTORY_TX_TYPE.SELECTION,
    { id: target.docNo || target.id, idempotencyKey },
    currentUser,
    `Pengurangan stok seleksi afkir ${target.docNo || target.id}`
  );

  // 9. Update Transaction Metadata
  const updatedSelection = {
    ...target,
    stockMutationStatus: STOCK_MUTATION_STATUS.APPLIED,
    stockMutationAt: new Date().toISOString(),
    stockMutationBy: currentUser?.userId || currentUser?.id || 'SYSTEM',
    stockMutationQty: mutationQty,
    stockMutationError: null,
    updatedAt: new Date().toISOString()
  };

  allRecords[idx] = updatedSelection;
  storage.set(SELECTION_STORAGE_KEY, allRecords);

  return {
    status: STOCK_MUTATION_STATUS.APPLIED,
    success: true,
    batch: updatedInvState,
    selection: updatedSelection
  };
}

/**
 * Kembalikan (Return) Pemeriksaan Hasil Seleksi oleh Asisten Bibitan
 * CATATAN PENTING: TIDAK BOLEH MEMUTASI STOCK BATCH
 */
export function returnSelectionRecord(recordIdOrDocNo, reason, currentUser) {
  if (!currentUser) throw new Error('Pengguna aktif tidak valid.');
  const role = normalizeRole(currentUser.role || currentUser.rawRole);
  if (role !== ROLES.ASISTEN_BIBITAN) {
    throw new Error('Hanya Asisten Bibitan yang berhak mengembalikan hasil seleksi.');
  }

  if (!reason || !reason.trim()) {
    throw new Error('Alasan pengembalian wajib diisi.');
  }

  const allRecords = storage.get(SELECTION_STORAGE_KEY, []);
  const idx = allRecords.findIndex(r => r.id === recordIdOrDocNo || r.selectionId === recordIdOrDocNo || r.docNo === recordIdOrDocNo);
  if (idx === -1) {
    throw new Error(`Data seleksi dengan identitas ${recordIdOrDocNo} tidak ditemukan.`);
  }

  const target = allRecords[idx];
  if (!canPerformAsistenSelectionAction(target, currentUser)) {
    throw new Error('Anda tidak memiliki otorisasi untuk mengembalikan dokumen ini.');
  }

  const isDederan = target.originType === 'REJECT_DEDERAN' || target.sourceModule === 'DEDERAN';
  const nowIso = new Date().toISOString();

  const updatedRecord = applyTransactionActor(
    {
      ...target,
      status: SELECTION_STATUS.DIKEMBALIKAN,
      returnReason: reason.trim(),
      returnedByUserId: currentUser.userId || currentUser.code || currentUser.id,
      returnedByName: currentUser.name || 'Asisten Bibitan',
      returnedByRole: ROLES.ASISTEN_BIBITAN,
      returnedAt: nowIso,
      updatedAt: nowIso
    },
    AUDIT_EVENT_TYPES.REJECT,
    currentUser,
    isDederan
      ? `Pengembalian hasil seleksi Dederan ${target.docNo}: ${reason.trim()}`
      : `Pengembalian hasil seleksi untuk batch ${target.batchCode}: ${reason.trim()}`
  );

  allRecords[idx] = updatedRecord;
  storage.set(SELECTION_STORAGE_KEY, allRecords);

  // Sync corresponding entry in selection_pool to allow re-declaration
  let fullPool = storage.get('selection_pool', []);
  const poolIdx = fullPool.findIndex(p => 
    p.selectionTransactionId === target.id ||
    p.id === target.selectionTransactionId ||
    p.docNo === target.docNo ||
    p.selectionDocNo === target.docNo ||
    (p.dederanDocNo && p.dederanDocNo === target.sourceDocNo)
  );
  if (poolIdx !== -1) {
    fullPool[poolIdx].status = SELECTION_STATUS.DIKEMBALIKAN;
    fullPool[poolIdx].returnReason = reason.trim();
    fullPool[poolIdx].returnedAt = nowIso;
    fullPool[poolIdx].returnedByName = currentUser.name || 'Asisten Bibitan';
    storage.set('selection_pool', fullPool);
  }

  return updatedRecord;
}

/**
 * Menyelesaikan Transaksi APPROVAL_INTERRUPTED Sesuai Keputusan Opsi A PM
 * @param {string} recordIdOrDocNo 
 * @param {Object} currentUser 
 */
export async function resolveApprovalInterrupted(recordIdOrDocNo, currentUser) {
  if (!currentUser) throw new Error('Pengguna aktif tidak valid.');

  const allRecords = storage.get(SELECTION_STORAGE_KEY, []);
  const idx = allRecords.findIndex(r => r.id === recordIdOrDocNo || r.selectionId === recordIdOrDocNo || r.docNo === recordIdOrDocNo);
  if (idx === -1) {
    throw new Error(`Data seleksi ${recordIdOrDocNo} tidak ditemukan.`);
  }

  const target = allRecords[idx];
  const decisions = storage.get('selection_approval_decisions', []);
  const decision = decisions.find(d => d.txId === target.id || d.docNo === target.docNo);
  if (!decision) {
    throw new Error(`ApprovalIntegrityError: Tidak ditemukan Decision Record yang sah untuk transaksi ${target.docNo}.`);
  }

  const batchKey = target.batchId || target.batchCode || target.batchNo;
  const bedenganKey = target.bedenganId || target.bedenganCode || target.bedengan;

  assertBatchNotLocked(batchKey);
  if (bedenganKey) assertBedenganNotLocked(batchKey, bedenganKey);

  return await executeStockMutationWithLock(batchKey, async () => {
    const mutationQty = Number(decision.approvedQty || target.jumlahAfkir || 0);
    const currentAvailable = getInventoryAvailableQty(batchKey);

    // EVALUASI SALDO TERKINI DI BAWAH LOCK (OPSI A)
    if (currentAvailable < mutationQty) {
      // KUOTA TIDAK CUKUP: AUTO-RETURN KE MANTRI DENGAN AUDIT TRAIL
      const updatedRecord = applyTransactionActor(
        {
          ...target,
          status: SELECTION_STATUS.DIKEMBALIKAN,
          returnReason: `Otomatis dikembalikan sistem: Kuota stok terkini tidak mencukupi pasca rekonsiliasi (Tersedia: ${currentAvailable} Pkk < Dibutuhkan: ${mutationQty} Pkk).`,
          stockMutationStatus: STOCK_MUTATION_STATUS.FAILED,
          stockMutationError: 'Kuota stok tidak mencukupi saat penyelesaian.',
          updatedAt: new Date().toISOString()
        },
        AUDIT_EVENT_TYPES.REJECT,
        { userId: 'SYSTEM', name: 'SYSTEM RECONCILER', role: 'SYSTEM' },
        'Otomatis dikembalikan oleh sistem karena stok tidak mencukupi (Opsi A)'
      );
      allRecords[idx] = updatedRecord;
      storage.set(SELECTION_STORAGE_KEY, allRecords);

      return {
        status: 'AUTO_RETURNED',
        success: true,
        message: 'Transaksi otomatis dikembalikan ke Mantri karena stok terkini tidak mencukupi.',
        record: updatedRecord
      };
    }

    // KUOTA CUKUP: SELESAIKAN MUTASI SECARA IDEMPOTEN DI BAWAH LOCK
    const idempotencyKey = `MUT-${batchKey}-SEL-${target.id || target.docNo}`;
    deductInventoryStock(
      batchKey,
      mutationQty,
      INVENTORY_TX_TYPE.SELECTION,
      { id: target.docNo || target.id, idempotencyKey },
      currentUser,
      `Penyelesaian mutasi approval tertunda ${target.docNo || target.id}`
    );

    const updatedRecord = applyTransactionActor(
      {
        ...target,
        status: SELECTION_STATUS.DISETUJUI,
        stockMutationStatus: STOCK_MUTATION_STATUS.APPLIED,
        stockMutationAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      AUDIT_EVENT_TYPES.APPROVE,
      currentUser,
      'Mutasi approval tertunda berhasil diselesaikan'
    );

    allRecords[idx] = updatedRecord;
    storage.set(SELECTION_STORAGE_KEY, allRecords);

    return {
      status: 'RESOLVED',
      success: true,
      message: 'Mutasi tertunda berhasil diselesaikan dan disetujui.',
      record: updatedRecord
    };
  });
}

/**
 * Integrasi Hasil Seleksi (Rusak, Mati, Lainnya) dari Transaksi Penyemaian ke Selection Pool
 * 
 * Aturan Bisnis:
 * 1. Hanya hasil Rusak, Mati, dan Lainnya dari Transaksi Penyemaian yang masuk ke Seleksi.
 * 2. Hasil Bibit Disemai TIDAK masuk ke Seleksi.
 * 3. Kategori dibedakan: RUSAK, MATI, LAINNYA.
 * 4. Sumber integrasi ditandai: sourceModule: 'PENYEMAIAN', sourceTransactionType: 'SEEDING'.
 * 5. Membawa referensi transaksi asal, program, estate, division, batch, bedengan.
 * 6. Idempoten: mencegah duplikasi jika transaksi asal + kategori sudah ada di selection_pool.
 * 7. Tidak memutasi stok pada saat masuk pool (mutasi hanya saat ASB approve).
 * 8. Validasi: angka negatif/bukan angka melempar error; total 0 tidak membuat entry.
 */
export function integrateSeedingToSelectionPool(seedingTx, options = {}) {
  if (!seedingTx) {
    throw new Error('Data transaksi penyemaian tidak valid.');
  }

  const { isEditing = false, currentUser = null } = (typeof options === 'boolean' ? { isEditing: options } : (options || {}));
  const sourceDocNo = seedingTx.docNo || seedingTx.seedingDocNo || seedingTx.id;
  if (!sourceDocNo) {
    throw new Error('Nomor dokumen atau ID transaksi penyemaian wajib ada.');
  }

  // 1. Ekstraksi dan Validasi Kategori Rejection (Rusak, Mati, Lainnya)
  const categories = [];

  function parseAndValidateQty(rawVal, label) {
    if (rawVal === undefined || rawVal === null || rawVal === '') return 0;
    const n = Number(rawVal);
    if (isNaN(n) || !Number.isFinite(n)) {
      throw new Error(`Nilai jumlah ${label} tidak valid: "${rawVal}". Harus berupa bilangan bulat.`);
    }
    if (n < 0) {
      throw new Error(`Nilai jumlah ${label} tidak boleh negatif: ${n}.`);
    }
    return Math.floor(n);
  }

  // Check explicit category fields if present (for legacy data compatibility)
  let rusakQty = parseAndValidateQty(seedingTx.rusakQty ?? seedingTx.rusak, 'Rusak');
  let matiQty = parseAndValidateQty(seedingTx.matiQty ?? seedingTx.mati, 'Mati');
  let lainnyaQty = parseAndValidateQty(seedingTx.lainnyaQty ?? seedingTx.lainnya, 'Lainnya');

  // If explicit breakdown is present, retain it for legacy compatibility
  if (rusakQty > 0 || matiQty > 0 || lainnyaQty > 0) {
    if (rusakQty > 0) categories.push({ category: 'RUSAK', qty: rusakQty, label: 'Rusak' });
    if (matiQty > 0) categories.push({ category: 'MATI', qty: matiQty, label: 'Mati' });
    if (lainnyaQty > 0) categories.push({ category: 'LAINNYA', qty: lainnyaQty, label: 'Lainnya' });
  } else {
    // Single consolidated rejection quantity from seeding without pre-splitting
    const ditolakQty = parseAndValidateQty(seedingTx.ditolak ?? seedingTx.jumlahDitolak, 'Ditolak');
    if (ditolakQty > 0) {
      categories.push({ category: 'PENDING_DECLARATION', qty: ditolakQty, label: 'Ditolak' });
    }
  }

  // If all categories are 0 (e.g. no rejected seeds), do not create any pool entries
  if (categories.length === 0) {
    return {
      success: true,
      createdCount: 0,
      entries: [],
      message: 'Tidak ada bibit ditolak (Rusak/Mati/Lainnya) pada transaksi penyemaian ini.'
    };
  }

  let selectionPool = storage.get('selection_pool', []);

  // If editing/re-syncing, purge existing entries for this seeding transaction to prevent duplicates
  if (isEditing) {
    selectionPool = selectionPool.filter(s => !(
      (s.sourceDocNo === sourceDocNo || s.seedingDocNo === sourceDocNo || s.sourceTransactionId === (seedingTx.id || sourceDocNo)) &&
      s.sourceModule === 'PENYEMAIAN'
    ));
  }

  const existingTxs = storage.get(SELECTION_STORAGE_KEY, []);
  const newEntries = [];

  categories.forEach(({ category, qty, label }) => {
    // Helper untuk mengecualikan transaksi pelaksanaan Seleksi I, II, III
    const isExecutionRecord = (tx) => {
      if (isCullDocNo(tx.docNo) || isCullDocNo(tx.selectionNo) || isCullDocNo(tx.selectionPoolDocNo)) return false;
      return Boolean(
        tx.parentSelectionDocumentId ||
        tx.selectionDocumentId ||
        tx.parentSelectionDocNo ||
        Boolean(tx.selectionDocNo && String(tx.selectionDocNo).includes('/SEL/')) ||
        (tx.transactionType && String(tx.transactionType).startsWith('PELAKSANAAN_SELEKSI'))
      );
    };

    // Jika dokumen sumber sedang dikoreksi (isEditing), sinkronisasikan kuantitas pada transaksi seleksi hilir yang belum disetujui
    if (isEditing) {
      let txsChanged = false;
      existingTxs.forEach(tx => {
        if (isExecutionRecord(tx)) return;
        const isMatch = (tx.sourceDocNo === sourceDocNo || tx.seedingDocNo === sourceDocNo || tx.sourceTransactionId === (seedingTx.id || sourceDocNo)) &&
          (tx.sourceModule === 'PENYEMAIAN' || tx.originType === 'REJECT_PENYEMAIAN');
        const isNotFinal = tx.status !== SELECTION_STATUS.DISETUJUI && tx.status !== 'TERVERIFIKASI' && tx.status !== 'VERIFIED';
        if (isMatch && isNotFinal) {
          tx.jumlahAfkir = qty;
          tx.quantity = qty;
          tx.jumlahDiperiksa = qty;
          tx.updatedAt = new Date().toISOString();
          txsChanged = true;
        }
      });
      if (txsChanged) {
        storage.set(SELECTION_STORAGE_KEY, existingTxs);
      }
    }

    // Idempotency check: Jangan buat duplikasi jika sudah ada di pool atau sudah ada selection_transactions (CULL) untuk source SOW ini
    const alreadyInSelectionTxs = existingTxs.some(tx => {
      if (isExecutionRecord(tx)) return false;
      return (
        (tx.sourceDocNo === sourceDocNo || tx.seedingDocNo === sourceDocNo || tx.sourceTransactionId === (seedingTx.id || sourceDocNo)) &&
        (tx.sourceModule === 'PENYEMAIAN' || tx.originType === 'REJECT_PENYEMAIAN')
      );
    });

    const poolItemId = category === 'PENDING_DECLARATION'
      ? `SEL-POOL-SEED-${seedingTx.id || sourceDocNo}`
      : `SEL-POOL-SEED-${seedingTx.id || sourceDocNo}-${category}`;

    const alreadyInPool = selectionPool.some(s => 
      s.id === poolItemId ||
      s.id === `SEL-POOL-SEED-${seedingTx.id || sourceDocNo}` ||
      s.id === `SEL-POOL-SEED-${seedingTx.id || sourceDocNo}-${category}` ||
      ((s.sourceDocNo === sourceDocNo || s.seedingDocNo === sourceDocNo || s.sourceTransactionId === (seedingTx.id || sourceDocNo)) &&
       (s.sourceModule === 'PENYEMAIAN' || s.originType === 'REJECT_PENYEMAIAN') &&
       (s.id === poolItemId || s.category === category || s.alasanDitolakCategory === category || (!seedingTx.rusakQty && !seedingTx.matiQty && !seedingTx.lainnyaQty)))
    );

    if (!alreadyInSelectionTxs && !alreadyInPool) {
      const entry = {
        id: poolItemId,
        docNo: null,
        originType: 'REJECT_PENYEMAIAN',
        sourceModule: 'PENYEMAIAN',
        sourceTransactionType: 'SEEDING',
        sourceTransactionId: seedingTx.id || sourceDocNo,
        sourceDocNo: sourceDocNo,
        seedingDocNo: sourceDocNo,
        sourceIndex: seedingTx.sourceIndex !== undefined ? seedingTx.sourceIndex : null,
        
        category: category,
        alasanDitolakCategory: category,
        jumlahAfkir: qty,
        quantity: qty,
        alasan: category === 'PENDING_DECLARATION' ? `Bibit ditolak saat Penyemaian (${sourceDocNo})` : `Bibit ${label} saat Penyemaian (${sourceDocNo})`,
        
        // Actor & Scope references
        actorId: seedingTx.actorId || seedingTx.userId || seedingTx.createdBy || seedingTx.createdByUserId || (currentUser && (currentUser.userId || currentUser.id)) || 'TBS-MNT-001',
        actorCode: seedingTx.actorCode || seedingTx.userCode || seedingTx.createdByLoginCode || (currentUser && currentUser.code) || 'MNT001',
        actorName: seedingTx.actorName || seedingTx.mantri || seedingTx.createdByName || seedingTx.workerName || (currentUser && currentUser.name) || 'Wagiman',
        mantri: seedingTx.mantri || seedingTx.actorName || (currentUser && currentUser.name) || 'Wagiman',
        userId: seedingTx.userId || seedingTx.actorId || (currentUser && (currentUser.userId || currentUser.id)) || 'TBS-MNT-001',
        createdByName: seedingTx.createdByName || seedingTx.mantri || (currentUser && currentUser.name) || 'Wagiman',
        createdBy: seedingTx.createdBy || seedingTx.userId || (currentUser && (currentUser.userId || currentUser.id)) || 'TBS-MNT-001',

        // Scope & Master references
        estateId: seedingTx.estateId || (currentUser && currentUser.estateId) || 'EST-TBS',
        divisionId: seedingTx.divisionId || (currentUser && currentUser.divisionId) || 'DIV-001',
        programId: seedingTx.programId || null,
        programCode: seedingTx.programCode || seedingTx.program || null,
        program: seedingTx.program || seedingTx.programCode || null,
        programName: seedingTx.programName || null,
        batchId: seedingTx.batchId || null,
        batchCode: seedingTx.batchCode || seedingTx.batchNo || null,
        batchNo: seedingTx.batchNo || seedingTx.batchCode || null,
        bedenganId: seedingTx.bedenganId || null,
        bedenganCode: seedingTx.bedenganCode || null,
        bedenganIds: seedingTx.rows ? seedingTx.rows.map(r => r.bedenganId).filter(Boolean) : (seedingTx.bedenganId ? [seedingTx.bedenganId] : []),
        bedengan: seedingTx.bedengan || null,
        blockId: seedingTx.blockId || null,
        blockCode: seedingTx.blockCode || null,
        
        // Clones & stage snapshot
        klon: seedingTx.klonAwal || seedingTx.klon || 'GT 1',
        clone: seedingTx.klonAwal || seedingTx.klon || 'GT 1',
        tahapan: seedingTx.tahapan || 'Rubber Main Nursery',
        tanggal: seedingTx.date || getEffectiveTodayDDMMYYYY(),
        
        status: 'PENDING_DECLARATION',
        stockMutationStatus: 'PENDING',
        createdAt: new Date().toISOString()
      };

      selectionPool.push(entry);
      newEntries.push(entry);
    }
  });

  storage.set('selection_pool', selectionPool);

  return {
    success: true,
    createdCount: newEntries.length,
    entries: newEntries,
    message: `Berhasil mengintegrasikan ${newEntries.length} entri hasil penyemaian ke Selection Pool.`
  };
}

/**
 * Sinkronisasi seluruh transaksi penyemaian ke Selection Pool secara idempoten
 */
export function syncAllSeedingsToSelectionPool(currentUser = null) {
  const seedingTxs = storage.get('seeding_transactions', []);
  let totalCreated = 0;
  seedingTxs.forEach(tx => {
    try {
      const res = integrateSeedingToSelectionPool(tx, { isEditing: false, currentUser });
      totalCreated += res.createdCount;
    } catch (err) {
      console.warn(`[syncAllSeedingsToSelectionPool] Skip invalid tx ${tx.docNo}:`, err.message);
    }
  });
  return totalCreated;
}

/**
 * Memeriksa apakah transaksi Pindah Semai (SOW) sudah pernah dideklarasikan sebagai bibit afkir (CULL)
 * Digunakan untuk mengunci transaksi sumber Pindah Semai dari aksi Edit dan Hapus.
 * @param {object|string} seedingTx - Record transaksi penyemaian atau docNo / id
 * @returns {boolean} true jika transaksi SOW sudah memiliki deklarasi CULL
 */
export function hasExistingCullDeclarationForSeeding(seedingTx) {
  if (!seedingTx) return false;
  const docNo = String(typeof seedingTx === 'string' ? seedingTx : (seedingTx.docNo || seedingTx.seedingDocNo || seedingTx.id || '')).trim();
  const txId = String(typeof seedingTx === 'object' && seedingTx ? (seedingTx.id || docNo) : docNo).trim();
  if (!docNo && !txId) return false;

  // 1. Check in selection_transactions (CULL records)
  const selTxs = storage.get(SELECTION_STORAGE_KEY, []);
  const hasInSelTxs = selTxs.some(tx => {
    const isPenyemaian = tx.sourceModule === 'PENYEMAIAN' || tx.originType === 'REJECT_PENYEMAIAN';
    if (!isPenyemaian) return false;
    const matchDoc = docNo && (tx.sourceDocNo === docNo || tx.seedingDocNo === docNo || tx.sourceTransactionId === docNo);
    const matchId = txId && (tx.sourceTransactionId === txId || tx.sourceDocNo === txId);
    return Boolean(matchDoc || matchId);
  });
  if (hasInSelTxs) return true;

  // 2. Check in selection_pool with active/declared status
  const pool = storage.get('selection_pool', []);
  const hasInPool = pool.some(p => {
    const isPenyemaian = p.sourceModule === 'PENYEMAIAN' || p.originType === 'REJECT_PENYEMAIAN';
    if (!isPenyemaian) return false;
    const matchDoc = docNo && (p.sourceDocNo === docNo || p.seedingDocNo === docNo || p.sourceTransactionId === docNo);
    const matchId = txId && (p.sourceTransactionId === txId || p.sourceDocNo === txId);
    if (!matchDoc && !matchId) return false;
    const stat = String(p.status || '').toUpperCase().trim();
    return stat === 'MENUNGGU_VERIFIKASI' || stat === 'DECLARED_CULLED' || stat === 'DISETUJUI' || stat === 'DIKEMBALIKAN' || stat === 'SUBMITTED_TO_ASB' || stat === 'REVISION';
  });

  return Boolean(hasInPool);
}

export const SELECTION_PHOTO_STORAGE_KEY = 'selection_photos';

/**
 * Menyimpan data record foto dokumentasi seleksi bibit secara idempoten
 */
export function saveSelectionDocumentationPhoto(photoRecord) {
  if (!photoRecord || !photoRecord.photoData) {
    throw new Error('Data foto dokumentasi tidak valid');
  }
  const allPhotos = storage.get(SELECTION_PHOTO_STORAGE_KEY, []);
  
  // Mencegah duplikasi foto untuk transaksi / dokumen seleksi yang sama
  const existingIdx = allPhotos.findIndex(p => (
    (photoRecord.id && p.id === photoRecord.id) ||
    (photoRecord.selectionTransactionId && p.selectionTransactionId === photoRecord.selectionTransactionId) ||
    (photoRecord.selectionDocNo && p.selectionDocNo === photoRecord.selectionDocNo && p.category === photoRecord.category) ||
    (photoRecord.sourceDocNo && p.sourceDocNo === photoRecord.sourceDocNo && p.category === photoRecord.category && p.selectionDocNo === photoRecord.selectionDocNo)
  ));

  if (existingIdx !== -1) {
    allPhotos[existingIdx] = {
      ...allPhotos[existingIdx],
      ...photoRecord,
      id: allPhotos[existingIdx].id // Pertahankan ID asli
    };
  } else {
    allPhotos.push(photoRecord);
  }
  storage.set(SELECTION_PHOTO_STORAGE_KEY, allPhotos);
  return photoRecord;
}

/**
 * Mengambil daftar seluruh foto dokumentasi seleksi
 */
export function getSelectionPhotos() {
  return storage.get(SELECTION_PHOTO_STORAGE_KEY, []);
}

/**
 * Mengambil foto dokumentasi berdasarkan nomor dokumen seleksi
 */
export function getSelectionPhotosByDocNo(selectionDocNo) {
  if (!selectionDocNo) return [];
  const all = getSelectionPhotos();
  return all.filter(p => p.selectionDocNo === selectionDocNo || p.selectionPoolDocNo === selectionDocNo);
}

/**
 * Deklarasi hasil seleksi oleh Mantri Bibitan secara idempoten
 * Mencegah duplikasi transaksi dan duplikasi Dok. Seleksi
 */
export function declareSelectionItem(targetPoolItem, photoResult, user, customOptions = {}) {
  // GLOBAL ATTENDANCE GATE
  assertAttendanceGateOrThrow(user);

  if (!targetPoolItem) {
    throw new Error('Data bibit afkir tidak valid.');
  }

  const today = getEffectiveTodayDDMMYYYY();
  const selectedCat = customOptions.category || customOptions.reason || targetPoolItem.category || targetPoolItem.alasanDitolakCategory || 'AFKIR';
  const customNotes = (typeof customOptions.notes === 'string' && customOptions.notes.trim() !== '') ? customOptions.notes.trim() : null;

  const standardReasons = ['Busuk', 'Fomes', 'Jamur Lainnya', 'Kerdil', 'Mati', 'Patah', 'Rusak'];
  const hasExplicitStandardReason = Boolean(
    customOptions.reason || 
    (customOptions.category && standardReasons.some(r => r.toUpperCase() === String(customOptions.category).trim().toUpperCase()))
  );
  const chosenReason = hasExplicitStandardReason 
    ? (customOptions.reason || customOptions.category) 
    : (targetPoolItem.alasan && targetPoolItem.alasan !== '-' ? targetPoolItem.alasan : selectedCat);

  // 1. Cari existing transaction berdasarkan identitas source selection
  const existingTx = findExistingSelectionTransaction(targetPoolItem);
  const allTxs = storage.get(SELECTION_STORAGE_KEY, []);

  let finalTx = null;
  let isNewTx = false;

  // Pastikan Dok. Seleksi stabil
  let poolDocNo = existingTx?.docNo || targetPoolItem.docNo;
  const parsedExisting = parseCullDocNo(poolDocNo);
  if (!poolDocNo || !parsedExisting) {
    const subCode = customOptions.cullCode || resolveCullSourceCode(targetPoolItem);
    poolDocNo = allocateCullDocNo(subCode, 2026, allTxs);
    targetPoolItem.docNo = poolDocNo;
  }

  if (existingTx) {
    finalTx = existingTx;
    finalTx.category = selectedCat;
    finalTx.alasanDitolakCategory = selectedCat;
    finalTx.alasan = chosenReason;
    finalTx.alasanDetail = hasExplicitStandardReason ? chosenReason : (targetPoolItem.alasanDetail || chosenReason);

    // Sinkronisasi kuantitas afkir dari targetPoolItem atau dokumen sumber terbaru
    const declaredQty = parseInt(targetPoolItem.jumlahAfkir !== undefined ? targetPoolItem.jumlahAfkir : (targetPoolItem.quantity || 0), 10);
    if (!isNaN(declaredQty) && declaredQty > 0) {
      finalTx.jumlahAfkir = declaredQty;
      finalTx.quantity = declaredQty;
      finalTx.jumlahDiperiksa = declaredQty;
    }
    const retainedQty = targetPoolItem.actualBibitRetainedQty !== undefined
      ? targetPoolItem.actualBibitRetainedQty
      : (targetPoolItem.jumlahLayak !== undefined
        ? targetPoolItem.jumlahLayak
        : (targetPoolItem.jumlahBerhasil !== undefined ? targetPoolItem.jumlahBerhasil : null));
    if (retainedQty !== null && !isNaN(parseInt(retainedQty, 10))) {
      finalTx.jumlahLayak = parseInt(retainedQty, 10);
      finalTx.actualBibitRetainedQty = parseInt(retainedQty, 10);
      finalTx.bibitDipertahankan = parseInt(retainedQty, 10);
    }
    if (targetPoolItem.bedenganId) finalTx.bedenganId = targetPoolItem.bedenganId;
    if (targetPoolItem.bedenganCode) finalTx.bedenganCode = targetPoolItem.bedenganCode;
    if (targetPoolItem.batchId) finalTx.batchId = targetPoolItem.batchId;
    if (targetPoolItem.batchCode) finalTx.batchCode = targetPoolItem.batchCode;
    if (targetPoolItem.parentSelectionDocumentId) finalTx.parentSelectionDocumentId = targetPoolItem.parentSelectionDocumentId;
    if (targetPoolItem.parentSelectionDocNo) finalTx.parentSelectionDocNo = targetPoolItem.parentSelectionDocNo;

    finalTx.status = SELECTION_STATUS.READY_TO_CONFIRM;
    finalTx.verificationStatus = null;
    finalTx.submissionStatus = null;
    finalTx.submittedAt = null;
    finalTx.lastReturnReason = finalTx.returnReason || finalTx.lastReturnReason || null;
    finalTx.returnReason = null;
    finalTx.stockMutationStatus = STOCK_MUTATION_STATUS.PENDING;
    finalTx.updatedAt = new Date().toISOString();
    finalTx.declaredAt = new Date().toISOString();
    finalTx.tanggalDeklarasi = today;
    if (!finalTx.tanggalSeleksi && (targetPoolItem.tanggalSeleksi || targetPoolItem.tanggal)) {
      finalTx.tanggalSeleksi = targetPoolItem.tanggalSeleksi || targetPoolItem.tanggal;
    }
    if (!finalTx.tanggal && (targetPoolItem.tanggalSeleksi || targetPoolItem.tanggal)) {
      finalTx.tanggal = targetPoolItem.tanggalSeleksi || targetPoolItem.tanggal;
    }
    if (user && user.name) {
      finalTx.mantri = user.name;
      finalTx.createdByName = user.name;
      finalTx.createdByUserId = user.userId || user.code || user.id;
    }
    finalTx.catatan = customNotes;
    // Update photo reference if photoResult provided
    if (photoResult && photoResult.dataUrl) {
      finalTx.photoId = photoResult.id || `PHOTO-SEL-${Date.now()}`;
      finalTx.photoData = photoResult.dataUrl;
      finalTx.photoCapturedAt = photoResult.capturedAt || new Date().toISOString();
      finalTx.photoCapturedAtLabel = photoResult.capturedAtLabel || today;
      finalTx.latitude = photoResult.latitude !== undefined ? photoResult.latitude : null;
      finalTx.longitude = photoResult.longitude !== undefined ? photoResult.longitude : null;
    }
    const txIdx = allTxs.findIndex(t => t.id === existingTx.id);
    if (txIdx !== -1) {
      allTxs[txIdx] = finalTx;
      storage.set(SELECTION_STORAGE_KEY, allTxs);
    }
  } else {
    isNewTx = true;
    const newTxId = `SEL-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const isDederan = targetPoolItem.originType === 'REJECT_DEDERAN' || targetPoolItem.sourceModule === 'DEDERAN';
    const validPhotoId = photoResult?.id || `PHOTO-SEL-${Date.now()}`;

    let determinedStage = targetPoolItem.selectionStage;
    let determinedType = targetPoolItem.selectionType;

    if (!determinedStage || determinedStage === SELECTION_STAGES.PASCA_OKULASI) {
      if (targetPoolItem.originType === 'REJECT_DEDERAN' || targetPoolItem.sourceModule === 'DEDERAN' || targetPoolItem.sourceTransactionType === 'DEDER_INSPECTION') {
        determinedStage = SELECTION_STAGES.PRA_SEMAI;
        determinedType = SELECTION_TYPES.PRA_SEMAI;
      } else if (targetPoolItem.originType === 'REJECT_PENYEMAIAN' || targetPoolItem.sourceModule === 'PENYEMAIAN') {
        determinedStage = SELECTION_STAGES.PINDAH_SEMAI;
        determinedType = SELECTION_TYPES.PINDAH_SEMAI;
      } else {
        determinedStage = targetPoolItem.selectionStage || SELECTION_STAGES.PASCA_OKULASI;
        determinedType = targetPoolItem.selectionType || SELECTION_TYPES.PASCA_OKULASI;
      }
    }

    const retainedQty = targetPoolItem.actualBibitRetainedQty !== undefined
      ? targetPoolItem.actualBibitRetainedQty
      : (targetPoolItem.jumlahLayak !== undefined
        ? targetPoolItem.jumlahLayak
        : (targetPoolItem.jumlahBerhasil !== undefined ? targetPoolItem.jumlahBerhasil : 0));

    finalTx = {
      id: newTxId,
      selectionId: newTxId,
      docNo: poolDocNo,
      selectionNo: poolDocNo,
      selectionPoolDocNo: poolDocNo,
      parentSelectionDocumentId: targetPoolItem.parentSelectionDocumentId || null,
      parentSelectionDocNo: targetPoolItem.parentSelectionDocNo || null,
      sourceModule: targetPoolItem.sourceModule || (targetPoolItem.originType === 'REJECT_PENYEMAIAN' ? 'PENYEMAIAN' : (['REJECT_OKULASI', 'REJECT_REGRAFTING'].includes(targetPoolItem.originType) ? 'BUDDING' : 'DEDERAN')),
      sourceTransactionType: targetPoolItem.sourceTransactionType || (targetPoolItem.originType === 'REJECT_PENYEMAIAN' ? 'SEEDING' : (targetPoolItem.originType === 'REJECT_DEDERAN' ? 'DEDER_INSPECTION' : (targetPoolItem.originType === 'REJECT_REGRAFTING' ? 'REGRAFTING' : 'GRAFTING'))),
      sourceTransactionId: targetPoolItem.sourceTransactionId || targetPoolItem.sourceDocNo || targetPoolItem.docNo,
      sourceDocNo: targetPoolItem.sourceDocNo || targetPoolItem.seedingDocNo || targetPoolItem.buddingDocNo || targetPoolItem.inspectionDocNo || targetPoolItem.dederanDocNo || '-',
      buddingDocNo: targetPoolItem.buddingDocNo || targetPoolItem.sourceBuddingDocNo || null,
      sourceBuddingDocNo: targetPoolItem.sourceBuddingDocNo || targetPoolItem.buddingDocNo || null,
      inspectionDocNo: targetPoolItem.inspectionDocNo || null,
      sourceInspectionDocNo: targetPoolItem.sourceInspectionDocNo || targetPoolItem.inspectionDocNo || null,
      category: selectedCat,
      alasanDitolakCategory: selectedCat,
      originType: targetPoolItem.originType || (targetPoolItem.sourceModule === 'DEDERAN' ? 'REJECT_DEDERAN' : 'REJECT_PENYEMAIAN'),
      
      estateId: targetPoolItem.estateId || user.estateId || null,
      divisionId: targetPoolItem.divisionId || user.divisionId || null,
      programId: targetPoolItem.programId || null,
      programCode: targetPoolItem.programCode || targetPoolItem.program || null,
      program: targetPoolItem.program || targetPoolItem.programCode || null,
      programName: targetPoolItem.programName || null,
      
      bedenganId: targetPoolItem.bedenganId || null,
      bedenganCode: targetPoolItem.bedenganCode || null,
      bedenganIds: targetPoolItem.bedenganIds || (targetPoolItem.bedenganId ? [targetPoolItem.bedenganId] : []),
      bedengan: targetPoolItem.bedengan || targetPoolItem.bedenganCode || '-',
      
      klon: targetPoolItem.klon || 'GT 1',
      clone: targetPoolItem.clone || targetPoolItem.klon || 'GT 1',
      tahapan: targetPoolItem.tahapan || 'Rubber Main Nursery',
      jumlahDiperiksa: targetPoolItem.jumlahDiperiksa || targetPoolItem.jumlahAfkir || targetPoolItem.quantity || 0,
      jumlahLayak: retainedQty,
      actualBibitRetainedQty: retainedQty,
      bibitDipertahankan: retainedQty,
      jumlahAfkir: targetPoolItem.jumlahAfkir || targetPoolItem.quantity || 0,
      quantity: targetPoolItem.jumlahAfkir || targetPoolItem.quantity || 0,
      
      selectionStage: determinedStage,
      selectionType: determinedType,
      isCompleted: targetPoolItem.isCompleted !== undefined ? Boolean(targetPoolItem.isCompleted) : false,
      polybagCount: targetPoolItem.polybagCount !== undefined ? parseInt(targetPoolItem.polybagCount, 10) : (
        (targetPoolItem.originType === 'REJECT_PENYEMAIAN' || targetPoolItem.sourceModule === 'PENYEMAIAN')
          ? Math.ceil((targetPoolItem.jumlahAfkir || targetPoolItem.quantity || 0) / 2)
          : (targetPoolItem.jumlahAfkir || targetPoolItem.quantity || 0)
      ),
      
      sumberAsal: getSelectionSourceLabel(targetPoolItem),
      alasan: chosenReason,
      alasanDetail: hasExplicitStandardReason ? chosenReason : (targetPoolItem.alasanDetail || chosenReason),
      catatan: customNotes,
      tanggal: targetPoolItem.tanggalSeleksi || targetPoolItem.tanggal || today,
      tanggalSeleksi: targetPoolItem.tanggalSeleksi || targetPoolItem.tanggal || today,
      tanggalDeklarasi: today,
      declaredAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      mantri: user.name,
      createdByName: user.name,
      createdByUserId: user.userId || user.code || user.id,
      status: SELECTION_STATUS.READY_TO_CONFIRM,
      verificationStatus: null,
      submissionStatus: null,
      submittedAt: null,
      stockMutationStatus: STOCK_MUTATION_STATUS.PENDING,
      
      // Photo reference
      photoId: photoResult?.dataUrl ? validPhotoId : null,
      photoData: photoResult?.dataUrl || null,
      photoCapturedAt: photoResult?.capturedAt || null,
      photoCapturedAtLabel: photoResult?.capturedAtLabel || null,
      latitude: photoResult?.latitude !== undefined ? photoResult.latitude : null,
      longitude: photoResult?.longitude !== undefined ? photoResult.longitude : null
    };

    if (!isDederan) {
      finalTx.batchId = targetPoolItem.batchId || null;
      finalTx.batchCode = targetPoolItem.batchCode || targetPoolItem.batchNo || null;
      finalTx.batchNo = targetPoolItem.batchNo || targetPoolItem.batchCode || null;
    }

    allTxs.push(finalTx);
    storage.set(SELECTION_STORAGE_KEY, allTxs);
  }

  // 2. Simpan record foto dokumentasi jika ada
  let photoRecord = null;
  if (photoResult && photoResult.dataUrl) {
    photoRecord = {
      id: photoResult.id || finalTx.photoId || `PHOTO-SEL-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      transactionType: 'SELECTION',
      selectionTransactionId: finalTx.id,
      selectionDocNo: finalTx.docNo,
      selectionPoolDocNo: finalTx.docNo,
      sourceTransactionId: finalTx.sourceTransactionId,
      sourceDocNo: finalTx.sourceDocNo,
      category: finalTx.category,
      quantity: finalTx.jumlahAfkir,
      photoData: photoResult.dataUrl,
      capturedAt: photoResult.capturedAt || new Date().toISOString(),
      capturedAtLabel: photoResult.capturedAtLabel || today,
      latitude: photoResult.latitude !== undefined ? photoResult.latitude : null,
      longitude: photoResult.longitude !== undefined ? photoResult.longitude : null,
      source: photoResult.source || 'CAMERA',
      createdAt: new Date().toISOString(),
      createdBy: user.name
    };
    if (finalTx.batchId) photoRecord.batchId = finalTx.batchId;
    if (finalTx.batchCode) photoRecord.batchCode = finalTx.batchCode;
    saveSelectionDocumentationPhoto(photoRecord);
  }

  // 3. Update status di selection_pool secara idempoten
  let fullPool = storage.get('selection_pool', []);
  const poolMatchIdx = fullPool.findIndex(p => (
    (p.id && targetPoolItem.id && p.id === targetPoolItem.id) ||
    (p.docNo && targetPoolItem.docNo && p.docNo === targetPoolItem.docNo) ||
    (p.sourceDocNo === targetPoolItem.sourceDocNo && p.sourceModule === targetPoolItem.sourceModule) ||
    (p.dederanDocNo && targetPoolItem.dederanDocNo && p.dederanDocNo === targetPoolItem.dederanDocNo)
  ));
  if (poolMatchIdx !== -1) {
    fullPool[poolMatchIdx] = {
      ...fullPool[poolMatchIdx],
      status: SELECTION_STATUS.READY_TO_CONFIRM,
      verificationStatus: null,
      submissionStatus: null,
      submittedAt: null,
      category: selectedCat,
      alasanDitolakCategory: selectedCat,
      alasan: chosenReason,
      alasanDetail: hasExplicitStandardReason ? chosenReason : (fullPool[poolMatchIdx].alasanDetail || chosenReason),
      docNo: finalTx.docNo,
      selectionTransactionId: finalTx.id,
      selectionDocNo: finalTx.docNo,
      declaredAt: new Date().toISOString(),
      tanggalDeklarasi: today,
      declaredBy: user.name,
      lastReturnReason: fullPool[poolMatchIdx].returnReason || fullPool[poolMatchIdx].lastReturnReason || null,
      returnReason: null
    };
  }
  storage.set('selection_pool', fullPool);

  return {
    success: true,
    isNew: isNewTx,
    transaction: finalTx,
    photoRecord
  };
}

/**
 * =============================================================================
 * DOKUMEN SELEKSI PRA-OKULASI (SELEKSI I, II, III CONTAINER)
 * =============================================================================
 */

/**
 * Membuat Dokumen Seleksi Pra-Okulasi dari Dokumen Penyemaian
 * Berperan sebagai kontainer induk (parent document) untuk rangkaian pelaksanaan Seleksi I, II, III
 */
export function createPreGraftingSelectionDocument(seedingTx, currentUser = null, options = {}) {
  let user = currentUser;
  let opts = options;
  if (currentUser && typeof currentUser === 'object' && (currentUser.skipGateCheck !== undefined || (!currentUser.role && !currentUser.id && !currentUser.userId))) {
    opts = { ...currentUser, ...options };
    user = null;
  }
  options = opts;
  if (!seedingTx) {
    throw new Error('Data transaksi penyemaian tidak valid.');
  }

  // Identifikasi nomor transaksi penyemaian sumber secara spesifik (cth: '2026/SOW/001')
  const seedingDocNo = String(
    (seedingTx.docNo && !options.docNo && !seedingTx.docNo.includes('SEL') && !seedingTx.docNo.includes('CULL') ? seedingTx.docNo : '') ||
    seedingTx.seedingDocNo ||
    seedingTx.sourceSeedingDocNo ||
    seedingTx.docNo ||
    seedingTx.id ||
    ''
  ).trim();

  if (!seedingDocNo) {
    throw new Error('Nomor transaksi penyemaian sumber wajib ada.');
  }

  const receiptDocNo = String(seedingTx.sourceDocNo || seedingTx.receiptDocNo || seedingTx.nomorPenerimaan || '').trim();
  const seedingTxId = String(seedingTx.id || seedingDocNo).trim();

  // Master contexts / Batch identification
  const bObj = seedingTx.batchId ? getBatchById(seedingTx.batchId) : getBatchByCode(seedingTx.batchCode || seedingTx.batchNo);
  const batchId = bObj ? bObj.id : (seedingTx.batchId || (seedingTx.batchCode ? `BATCH-${seedingTx.batchCode}` : `BATCH-${Date.now()}`));
  const batchCode = bObj ? (bObj.batchCode || bObj.batchNo) : (seedingTx.batchCode || seedingTx.batchNo || 'Batch-01');
  const allDocs = storage.get(PRE_GRAFTING_SELECTION_DOC_STORAGE_KEY, []);

  // Gate Check: Validasi apakah SOW memenuhi syarat CULL Approval Gate
  const gateCheck = canCreatePreGraftingSelection1Document(seedingTx);
  if (!gateCheck.canCreate && !options.skipGateCheck) {
    // Jika dokumen untuk kombinasi (Batch, Bedengan) ini sudah ada di sistem,
    // izinkan akumulasi update kuantitas bibit disemai agar populasi fisik tidak hilang
    const normBatch = String(batchCode || batchId || '').trim().toUpperCase();
    const hasExistingDocForBatch = allDocs.some(d => {
      const isStage1 = (d.selectionStage === 'SELEKSI_I' || d.selectionStage === 'SELEKSI_1' || !d.selectionStage);
      if (!isStage1 || d.isSplit || d.isLegacyAggregateSplit) return false;
      const dBatch = String(d.batchCode || d.batchNo || d.batchId || '').trim().toUpperCase();
      return dBatch === normBatch;
    });
    if (!hasExistingDocForBatch) {
      throw new Error(`Gagal membuat Dokumen Seleksi I: ${gateCheck.reason}`);
    }
  }

  // Canonical Batch Population from batch-inventory-service
  const inv = syncBatchPopulationFromSeeding(batchId) || syncBatchPopulationFromSeeding(batchCode);
  let canonicalBatchBibit = inv ? Number(inv.availableQty || 0) : 0;
  if (canonicalBatchBibit === 0) {
    canonicalBatchBibit = parseInt(seedingTx.sourceBibitQty !== undefined ? seedingTx.sourceBibitQty : (seedingTx.totalDisemai || seedingTx.disemai || 0), 10);
  }

  // Resolve Bedengan list from seedingTx
  let rawBedRows = seedingTx.rows 
    ? JSON.parse(JSON.stringify(seedingTx.rows)) 
    : (seedingTx.bedenganBreakdown 
        ? seedingTx.bedenganBreakdown.map(b => ({ bedenganId: b.bedenganCode || b.bedenganId, bedenganCode: b.bedenganCode || b.bedenganId, polybag: b.polybagQuantity || b.polybag || 0, disemai: b.seedsQuantity || b.disemai || 0 }))
        : (seedingTx.bedenganId ? [{ bedenganId: seedingTx.bedenganId, bedenganCode: formatBedenganDisplayCode(seedingTx.bedenganCode || seedingTx.bedenganId), polybag: seedingTx.totalPolybag || 0, disemai: seedingTx.totalDisemai || 0 }] : []));

  if (rawBedRows.length === 0) {
    rawBedRows = [{
      bedenganId: seedingTx.bedenganId || 'BED-001',
      bedenganCode: formatBedenganDisplayCode(seedingTx.bedenganCode || seedingTx.bedenganId || 'BED-001'),
      polybag: seedingTx.totalPolybag || (seedingTx.totalDisemai ? Math.ceil(seedingTx.totalDisemai / 2) : 0),
      disemai: seedingTx.totalDisemai || 0
    }];
  }

  if (options.bedenganCode) {
    const targetNorm = formatBedenganDisplayCode(options.bedenganCode).toUpperCase();
    rawBedRows = rawBedRows.filter(r => formatBedenganDisplayCode(r.bedenganCode || r.bedenganId).toUpperCase() === targetNorm);
    if (rawBedRows.length === 0) {
      rawBedRows = [{
        bedenganId: options.bedenganId || options.bedenganCode,
        bedenganCode: formatBedenganDisplayCode(options.bedenganCode),
        polybag: seedingTx.totalPolybag || 0,
        disemai: seedingTx.totalDisemai || 0
      }];
    }
  }

  let maxSeq = 0;
  allDocs.forEach(d => {
    const docStr = String(d.docNo || d.selectionDocNo || '');
    const match = docStr.match(/SEL(?:-DOC)?\/(\d+)/i) || docStr.match(/^(\d+)$/);
    if (match) {
      const n = parseInt(match[1], 10);
      if (!isNaN(n) && n > maxSeq) maxSeq = n;
    }
  });

  const createdDocs = [];

  rawBedRows.forEach(row => {
    const bedCode = formatBedenganDisplayCode(row.bedenganCode || row.bedenganId || row.bedengan || 'BED-001');
    const bedId = row.bedenganId || row.bedenganCode || bedCode;
    let bedPoly = parseInt(row.polybag !== undefined ? row.polybag : (row.polybagQuantity !== undefined ? row.polybagQuantity : (seedingTx.totalPolybag || 0)), 10);
    if (isNaN(bedPoly) || bedPoly <= 0) {
      bedPoly = Math.ceil(parseInt(row.disemai || seedingTx.totalDisemai || 0, 10) / 2);
    }
    const bedDisemai = parseInt(row.disemai !== undefined ? row.disemai : (row.seedsQuantity !== undefined ? row.seedsQuantity : (seedingTx.totalDisemai || 0)), 10);

    const normBed = bedCode.toUpperCase();
    const normBatchId = String(batchId).trim().toUpperCase();
    const normBatchCode = String(batchCode).trim().toUpperCase();
    // Akumulasikan seluruh transaksi Pindah Semai (SOW) yang sah dan disetujui ASB untuk (Batch, Bedengan) ini
    const bedTotals = calculateEligibleSeedingTotalsForBedengan(batchCode, bedCode, options);
    const bedBibit = bedTotals.totalDisemai > 0 
      ? bedTotals.totalDisemai 
      : ((bedDisemai > 0 && row.disemai !== undefined) ? bedDisemai : (bedDisemai > 0 && rawBedRows.length === 1 ? bedDisemai : bedPoly * 2));
    const effectiveBedPoly = bedTotals.totalPolybag > 0 ? bedTotals.totalPolybag : bedPoly;
    const allSowDocNos = bedTotals.eligibleSowDocs.length > 0 ? bedTotals.eligibleSowDocs : [seedingDocNo];

    // IDEMPOTENCY KEY: Batch + Bedengan
    const existing = allDocs.find(d => {
      const isStage1 = (d.selectionStage === 'SELEKSI_I' || d.selectionStage === 'SELEKSI_1' || !d.selectionStage);
      if (!isStage1) return false;
      if (d.isSplit || d.isLegacyAggregateSplit) return false;

      const dBatchId = String(d.batchId || '').trim().toUpperCase();
      const dBatchCode = String(d.batchCode || d.batchNo || '').trim().toUpperCase();
      const batchMatches = (
        (normBatchId && (dBatchId === normBatchId || dBatchCode === normBatchId)) ||
        (normBatchCode && (dBatchId === normBatchCode || dBatchCode === normBatchCode))
      );
      if (!batchMatches) return false;

      const dBed = formatBedenganDisplayCode(d.bedenganCode || d.bedenganId || d.bedengan || (d.rows && d.rows[0] ? (d.rows[0].bedenganCode || d.rows[0].bedenganId) : '')).toUpperCase();
      return dBed === normBed;
    });

    if (existing) {
      let modified = false;
      // Perbarui kuantitas bedengan secara kumulatif dari transaksi yang disetujui ASB
      if (effectiveBedPoly > 0 && existing.sourcePolybagQty !== effectiveBedPoly) {
        existing.sourcePolybagQty = effectiveBedPoly;
        existing.currentPolybagQty = effectiveBedPoly;
        modified = true;
      }
      if (bedBibit > 0 && existing.sourceBibitQty !== bedBibit) {
        existing.sourceBibitQty = bedBibit;
        existing.currentBibitQty = Math.max(0, bedBibit - (existing.totalAfkir || 0));
        modified = true;
      }
      if (canonicalBatchBibit > 0 && existing.batchTotalBibit !== canonicalBatchBibit) {
        existing.batchTotalBibit = canonicalBatchBibit;
        modified = true;
      }
      if (Array.isArray(existing.rows) && existing.rows.length > 0) {
        const rowToUpdate = existing.rows.find(r => formatBedenganDisplayCode(r.bedenganCode || r.bedenganId || r.bedengan).toUpperCase() === normBed);
        if (rowToUpdate) {
          if (effectiveBedPoly > 0 && rowToUpdate.polybag !== effectiveBedPoly) {
            rowToUpdate.polybag = effectiveBedPoly;
            modified = true;
          }
          if (bedBibit > 0 && (rowToUpdate.disemai !== bedBibit || rowToUpdate.sourceBibitQty !== bedBibit)) {
            rowToUpdate.disemai = bedBibit;
            rowToUpdate.sourceBibitQty = bedBibit;
            modified = true;
          }
        }
      }
      const mergedSows = Array.from(new Set([...(existing.sourceSeedingDocNos || [existing.sourceDocNo || existing.seedingDocNo].filter(Boolean)), ...allSowDocNos]));
      if (JSON.stringify(mergedSows) !== JSON.stringify(existing.sourceSeedingDocNos)) {
        existing.sourceSeedingDocNos = mergedSows;
        modified = true;
      }
      if (modified) {
        storage.set(PRE_GRAFTING_SELECTION_DOC_STORAGE_KEY, allDocs);
      }
      createdDocs.push(existing);
      return;
    }

    // Create New Selection I Document for this Batch + Bedengan Scope
    maxSeq++;
    const docNo = (options.docNo && rawBedRows.length === 1) ? options.docNo : `2026/SEL/${String(maxSeq).padStart(3, '0')}`;

    const singleRow = [{
      bedenganId: bedId,
      bedenganCode: bedCode,
      polybag: bedPoly,
      disemai: bedDisemai,
      sourceSeedingDocNo: seedingDocNo,
      sourceTransactionId: seedingTxId,
      batchId: batchId,
      batchCode: batchCode
    }];

    const baseDoc = {
      id: `SEL-DOC-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      docNo: docNo,
      selectionDocNo: docNo,
      selectionType: SELECTION_TYPES.PRA_OKULASI,
      selectionStage: options.selectionStage || SELECTION_STAGES.SELEKSI_1,
      
      // Source Document Provenance (Single specific SOW)
      sourceModule: 'PENYEMAIAN',
      sourceTransactionType: 'SEEDING',
      sourceTransactionId: seedingTxId,
      sourceDocNo: seedingDocNo,
      seedingDocNo: seedingDocNo,
      sourceSeedingDocNo: seedingDocNo,
      sourceSeedingDocNos: allSowDocNos,
      receiptDocNo: receiptDocNo,
      sourceReceiptDocNo: receiptDocNo,
      rows: singleRow,
      
      // Scope & Master references
      programId: seedingTx.programId || bObj?.programId || 'PRG-2026-001',
      programCode: seedingTx.programCode || seedingTx.program || bObj?.programCode || 'PRG/NUR/01/2026',
      programName: seedingTx.programName || bObj?.programName || '-',
      batchId: batchId,
      batchCode: batchCode,
      batchNo: batchCode,
      batchTotalBibit: canonicalBatchBibit,
      
      // Fixed Operational Scope: Single Bedengan
      bedenganId: bedId,
      bedenganCode: bedCode,
      bedengan: bedCode,
      bedenganIds: [bedId],
      
      estateId: seedingTx.estateId || bObj?.estateId || currentUser?.estateId || null,
      estateName: seedingTx.estateName || bObj?.estateName || currentUser?.estateName || '-',
      divisionId: seedingTx.divisionId || bObj?.divisionId || currentUser?.divisionId || null,
      divisionName: seedingTx.divisionName || bObj?.divisionName || currentUser?.divisionName || '-',
      
      klon: seedingTx.klonAwal || seedingTx.klon || 'GT 1',
      clone: seedingTx.klonAwal || seedingTx.klon || 'GT 1',
      tahapan: seedingTx.tahapan || 'Rubber Main Nursery',
      growthStage: seedingTx.growthStage || seedingTx.tahapan || 'Rubber Main Nursery',
      
      // Population Quantities: Isolated Bedengan Scope
      sourceBibitQty: bedBibit,
      sourcePolybagQty: bedPoly,
      currentBibitQty: bedBibit,
      currentPolybagQty: bedPoly,
      activePolybagQty: 0,
      emptyPolybagQty: 0,
      
      // Execution Progress & Child Transaction Tracking
      executionTransactionIds: [],
      executionCount: 0,
      totalDiperiksa: 0,
      totalLayak: 0,
      totalAfkir: 0,
      
      // Completion State
      isCompleted: false,
      isFinal: false,
      completedAt: null,
      completedByUserId: null,
      completedByName: null,
      
      // Lifecycle Status
      status: 'DRAFT',
      createdAt: new Date().toISOString(),
      isNewlyCreated: true
    };

    const newDoc = currentUser 
      ? applyTransactionActor(baseDoc, AUDIT_EVENT_TYPES.CREATE, currentUser, `Pembuatan Dokumen Seleksi Pra-Okulasi ${docNo} untuk batch ${batchCode} bedengan ${bedCode}`)
      : baseDoc;

    allDocs.push(newDoc);
    createdDocs.push(newDoc);
  });

  storage.set(PRE_GRAFTING_SELECTION_DOC_STORAGE_KEY, allDocs);
  const primaryDoc = createdDocs[0] || null;
  if (primaryDoc) {
    primaryDoc.allCreatedDocuments = createdDocs;
  }
  return primaryDoc;
}

/**
 * Mengambil daftar Dokumen Seleksi Pra-Okulasi
 */
export function getPreGraftingSelectionDocuments(filter = {}, currentUser = null) {
  const allDocs = storage.get(PRE_GRAFTING_SELECTION_DOC_STORAGE_KEY, []);
  let scoped = currentUser ? filterSelectionByScope(allDocs, currentUser) : allDocs;

  if (filter.selectionStage) {
    const targetStage = String(filter.selectionStage).toUpperCase();
    scoped = scoped.filter(d => {
      const dStage = String(d.selectionStage || 'SELEKSI_I').toUpperCase();
      if (targetStage === 'SELEKSI_1' || targetStage === 'SELEKSI_I') {
        return dStage === 'SELEKSI_1' || dStage === 'SELEKSI_I';
      }
      if (targetStage === 'SELEKSI_2' || targetStage === 'SELEKSI_II') {
        return dStage === 'SELEKSI_2' || dStage === 'SELEKSI_II';
      }
      if (targetStage === 'SELEKSI_3' || targetStage === 'SELEKSI_III') {
        return dStage === 'SELEKSI_3' || dStage === 'SELEKSI_III';
      }
      return dStage === targetStage;
    });
  }
  if (filter.batchId) {
    scoped = scoped.filter(d => d.batchId === filter.batchId);
  }
  if (filter.isCompleted !== undefined) {
    scoped = scoped.filter(d => Boolean(d.isCompleted) === Boolean(filter.isCompleted));
  }
  if (filter.sourceDocNo) {
    scoped = scoped.filter(d => d.sourceDocNo === filter.sourceDocNo);
  }
  return scoped;
}

/**
 * Mengambil daftar seluruh transaksi CULL yang terkait dengan Dokumen Penyemaian (SOW) tertentu
 */
export function getRelatedCullRecordsForSeeding(seedingTxOrDocNo) {
  if (!seedingTxOrDocNo) return [];
  const seedingDocNo = typeof seedingTxOrDocNo === 'object'
    ? String(seedingTxOrDocNo.docNo || seedingTxOrDocNo.seedingDocNo || seedingTxOrDocNo.sourceDocNo || seedingTxOrDocNo.id || '').trim()
    : String(seedingTxOrDocNo).trim();
  const seedingTxId = typeof seedingTxOrDocNo === 'object'
    ? String(seedingTxOrDocNo.id || seedingDocNo).trim()
    : seedingDocNo;

  const allTxs = storage.get(SELECTION_STORAGE_KEY, []);
  return allTxs.filter(tx => {
    const isCull = Boolean(
      isCullDocNo(tx.docNo) ||
      isCullDocNo(tx.selectionNo) ||
      isCullDocNo(tx.selectionPoolDocNo) ||
      tx.transactionType === 'SELEKSI_DITOLAK_PINDAH_SEMAI' ||
      tx.transactionType === 'CULL_DECLARATION' ||
      tx.originType === 'REJECT_PENYEMAIAN'
    );

    // Exclude execution transactions of Pra-Okulasi (only non-culls)
    if (!isCull) {
      if (
        tx.selectionType === SELECTION_TYPES.PRA_OKULASI ||
        tx.selectionDocumentId ||
        tx.parentSelectionDocumentId ||
        (tx.transactionType && String(tx.transactionType).startsWith('PELAKSANAAN_SELEKSI'))
      ) {
        return false;
      }
    }

    const isPindahSemaiCull = (
      tx.originType === 'REJECT_PENYEMAIAN' ||
      tx.sourceModule === 'PENYEMAIAN' ||
      tx.sourceTransactionType === 'SEEDING' ||
      (tx.docNo && String(tx.docNo).includes('/CULL/PS/')) ||
      (tx.selectionNo && String(tx.selectionNo).includes('/CULL/PS/')) ||
      (tx.docNo && String(tx.docNo).includes('/CULL/SEL-I/')) ||
      (tx.selectionNo && String(tx.selectionNo).includes('/CULL/SEL-I/'))
    );
    if (!isPindahSemaiCull) return false;

    const txSourceDoc = String(tx.sourceDocNo || tx.seedingDocNo || '').trim();
    const txSourceTxId = String(tx.sourceTransactionId || '').trim();

    return (
      (seedingDocNo && (txSourceDoc === seedingDocNo || txSourceTxId === seedingDocNo)) ||
      (seedingTxId && (txSourceDoc === seedingTxId || txSourceTxId === seedingTxId))
    );
  });
}

/**
 * Mengambil daftar seluruh entri pool CULL yang terkait dengan Dokumen Penyemaian (SOW) tertentu
 */
export function getRelatedCullPoolEntriesForSeeding(seedingTxOrDocNo) {
  if (!seedingTxOrDocNo) return [];
  const seedingDocNo = typeof seedingTxOrDocNo === 'object'
    ? String(seedingTxOrDocNo.docNo || seedingTxOrDocNo.seedingDocNo || seedingTxOrDocNo.sourceDocNo || seedingTxOrDocNo.id || '').trim()
    : String(seedingTxOrDocNo).trim();
  const seedingTxId = typeof seedingTxOrDocNo === 'object'
    ? String(seedingTxOrDocNo.id || seedingDocNo).trim()
    : seedingDocNo;

  const pool = storage.get('selection_pool', []);
  return pool.filter(item => {
    // Abaikan jika entri tidak memiliki kuantitas afkir positif
    const qty = parseInt(item.jumlahAfkir || item.quantity || 0, 10);
    if (qty <= 0) return false;

    // Abaikan jika docNo mengarah ke dokumen eksekusi seleksi, bukan dokumen CULL resmi
    if (item.docNo && !isCullDocNo(item.docNo) && (String(item.docNo).includes('/SEL/') || String(item.docNo).includes('/SEL-I/'))) {
      return false;
    }

    const isPindahSemaiCull = (
      item.originType === 'REJECT_PENYEMAIAN' ||
      item.sourceModule === 'PENYEMAIAN' ||
      item.sourceTransactionType === 'SEEDING'
    );
    if (!isPindahSemaiCull) return false;

    const itemSourceDoc = String(item.sourceDocNo || item.seedingDocNo || '').trim();
    const itemSourceTxId = String(item.sourceTransactionId || '').trim();

    return (
      (seedingDocNo && (itemSourceDoc === seedingDocNo || itemSourceTxId === seedingDocNo)) ||
      (seedingTxId && (itemSourceDoc === seedingTxId || itemSourceTxId === seedingTxId))
    );
  });
}

/**
 * Memeriksa apakah Dokumen Pindah Semai (SOW) telah diverifikasi dan disetujui ASB
 */
export function isSeedingApprovedByAsb(seedingTxOrDocNo) {
  if (!seedingTxOrDocNo) return false;
  let sow = typeof seedingTxOrDocNo === 'object' ? seedingTxOrDocNo : null;
  const docNo = String(typeof seedingTxOrDocNo === 'object' ? (seedingTxOrDocNo.docNo || seedingTxOrDocNo.id || seedingTxOrDocNo.seedingDocNo || '') : seedingTxOrDocNo).trim();
  
  if (!sow || (!sow.status && !sow.verificationStatus)) {
    const allSeedings = storage.get('seeding_transactions', []);
    const found = allSeedings.find(s => s.docNo === docNo || s.id === docNo || s.seedingDocNo === docNo);
    if (found) sow = found;
  }

  if (sow) {
    const st = String(sow.status || '').toUpperCase().trim();
    const vst = String(sow.verificationStatus || '').toUpperCase().trim();
    if (st === 'DISETUJUI' || st === 'VERIFIED' || st === 'TERVERIFIKASI' || vst === 'TERVERIFIKASI' || vst === 'DISETUJUI') {
      return true;
    }
  }

  // Check verification_transactions
  if (docNo) {
    const verifs = storage.get('verification_transactions', []);
    const hasVerif = verifs.some(v => 
      ((v.referenceType || '').toUpperCase() === 'PENYEMAIAN' || (v.referenceType || '').toUpperCase() === 'SEEDING') &&
      (v.referenceDocNo === docNo || v.referenceId === docNo || v.referenceId === sow?.id) &&
      (v.verificationStatus === 'TERVERIFIKASI' || v.verificationStatus === 'DISETUJUI')
    );
    if (hasVerif) return true;
  }

  return false;
}

/**
 * Menentukan status siklus hidup Dokumen Pindah Semai (SOW)
 * Status:
 * - 'APPROVED': SOW sudah diverifikasi dan disetujui ASB
 * - 'SUBMITTED_TO_ASB': SOW sudah dikonfirmasi Mantri dan sedang menunggu persetujuan ASB
 * - 'READY_TO_CONFIRM': SOW belum dikonfirmasi oleh Mantri (menunggu konfirmasi Mantri)
 *
 * @param {string|Object} seedingTxOrDocNo
 * @returns {'APPROVED'|'SUBMITTED_TO_ASB'|'READY_TO_CONFIRM'}
 */
export function getSowLifecycleStatus(seedingTxOrDocNo) {
  if (!seedingTxOrDocNo) return 'READY_TO_CONFIRM';
  let sow = typeof seedingTxOrDocNo === 'object' ? seedingTxOrDocNo : null;
  const docNo = String(typeof seedingTxOrDocNo === 'object' ? (seedingTxOrDocNo.docNo || seedingTxOrDocNo.id || seedingTxOrDocNo.seedingDocNo || '') : seedingTxOrDocNo).trim();

  if (!sow || (!sow.status && !sow.verificationStatus)) {
    const allSeedings = storage.get('seeding_transactions', []);
    const found = allSeedings.find(s => s.docNo === docNo || s.id === docNo || s.seedingDocNo === docNo);
    if (found) sow = found;
  }

  // 1. Cek approval ASB
  if (isSeedingApprovedByAsb(sow || docNo)) {
    return 'APPROVED';
  }

  // 2. Cek verifikasi transaksi yang menunggu approval ASB
  if (docNo) {
    const verifs = storage.get('verification_transactions', []);
    const hasPendingVerif = verifs.some(v =>
      ((v.referenceType || '').toUpperCase() === 'PENYEMAIAN' || (v.referenceType || '').toUpperCase() === 'SEEDING') &&
      (v.referenceDocNo === docNo || v.referenceId === docNo || (sow && v.referenceId === sow.id)) &&
      (v.verificationStatus === 'MENUNGGU_VERIFIKASI' || v.verificationStatus === 'SUBMITTED_TO_ASB' || v.verificationStatus === 'PENDING_ASB')
    );
    if (hasPendingVerif) return 'SUBMITTED_TO_ASB';
  }

  // 3. Cek status pada record SOW
  if (sow) {
    const st = String(sow.status || '').toUpperCase().trim();
    const vst = String(sow.verificationStatus || '').toUpperCase().trim();
    const subSt = String(sow.submissionStatus || '').toUpperCase().trim();
    const hasSubmittedAt = Boolean(sow.submittedAt && String(sow.submittedAt).trim() !== '' && String(sow.submittedAt).trim() !== '-');

    if (
      st === 'MENUNGGU_VERIFIKASI' ||
      st === 'SUBMITTED_TO_ASB' ||
      st === 'PENDING_ASB' ||
      st === 'DIAJUKAN' ||
      vst === 'MENUNGGU_VERIFIKASI' ||
      vst === 'SUBMITTED_TO_ASB' ||
      vst === 'PENDING_ASB' ||
      subSt === 'SUBMITTED_TO_ASB' ||
      hasSubmittedAt
    ) {
      return 'SUBMITTED_TO_ASB';
    }
  }

  // 4. Default: Belum dikonfirmasi Mantri
  return 'READY_TO_CONFIRM';
}

/**
 * Menghitung akumulasi kuantitas bibit & polybag yang eligible dari seluruh transaksi Pindah Semai
 * yang telah disetujui ASB (dan CULL terkait telah disetujui ASB) untuk pasangan (Batch, Bedengan)
 */
export function calculateEligibleSeedingTotalsForBedengan(batchKey, bedenganKey, options = {}) {
  const normBatch = String(batchKey || '').trim().toUpperCase();
  const normBed = formatBedenganDisplayCode(bedenganKey).toUpperCase();
  const allSeedings = storage.get('seeding_transactions', []);
  
  let totalDisemai = 0;
  let totalPolybag = 0;
  const eligibleSowDocs = [];

  allSeedings.forEach(tx => {
    if (tx.isDeleted || tx.deleted || tx.status === 'DELETED') return;
    
    // Check batch match
    const txBatchId = String(tx.batchId || '').trim().toUpperCase();
    const txBatchCode = String(tx.batchCode || tx.batchNo || '').trim().toUpperCase();
    let batchMatch = (normBatch && (txBatchId === normBatch || txBatchCode === normBatch));
    if (!batchMatch && tx.rows && Array.isArray(tx.rows)) {
      batchMatch = tx.rows.some(r => {
        const rBId = String(r.batchId || '').trim().toUpperCase();
        const rBCode = String(r.batchCode || r.batchNo || '').trim().toUpperCase();
        return normBatch && (rBId === normBatch || rBCode === normBatch);
      });
    }
    if (!batchMatch) return;

    // Check bedengan match
    const rawTxBed = tx.bedenganCode || tx.bedenganId || tx.bedengan || (tx.rows && tx.rows[0] ? (tx.rows[0].bedenganCode || tx.rows[0].bedenganId || tx.rows[0].bedengan) : '') || 'BED-001';
    const txBed = formatBedenganDisplayCode(rawTxBed).toUpperCase();
    let bedMatch = (txBed === normBed);
    if (!bedMatch && tx.rows && Array.isArray(tx.rows)) {
      bedMatch = tx.rows.some(r => formatBedenganDisplayCode(r.bedenganCode || r.bedenganId || r.bedengan || 'BED-001').toUpperCase() === normBed);
    }
    if (!bedMatch) return;

    // Kecualikan transaksi yang telah dihapus atau dikembalikan oleh ASB
    if (tx.status === 'DIKEMBALIKAN' || tx.verificationStatus === 'DIKEMBALIKAN') {
      return;
    }

    // Jika opsi strictGateCheck aktif, periksa gate approval ASB
    if (options && options.strictGateCheck) {
      const gate = canCreatePreGraftingSelection1Document(tx, options);
      if (!gate.canCreate) return;
    }

    let qtyDisemai = 0;
    let qtyPolybag = 0;
    if (tx.rows && Array.isArray(tx.rows) && tx.rows.length > 0) {
      const matchRow = tx.rows.find(r => formatBedenganDisplayCode(r.bedenganCode || r.bedenganId || r.bedengan).toUpperCase() === normBed);
      if (matchRow) {
        qtyDisemai = parseInt(matchRow.disemai || matchRow.seedsQuantity || 0, 10);
        qtyPolybag = parseInt(matchRow.polybag || matchRow.polybagQuantity || Math.ceil(qtyDisemai / 2), 10);
      }
    }
    if (qtyDisemai === 0) {
      qtyDisemai = parseInt(tx.totalDisemai !== undefined ? tx.totalDisemai : (tx.disemai || 0), 10);
      qtyPolybag = parseInt(tx.totalPolybag !== undefined ? tx.totalPolybag : (tx.polybag || Math.ceil(qtyDisemai / 2)), 10);
    }

    totalDisemai += qtyDisemai;
    totalPolybag += qtyPolybag;
    eligibleSowDocs.push(tx.docNo || tx.id);
  });

  return { totalDisemai, totalPolybag, eligibleSowDocs };
}

/**
 * Memeriksa apakah Dokumen Seleksi Pra-Okulasi I dapat dibuat/dieksekusi dari Dokumen Penyemaian (SOW)
 * Gate Baseline: 
 * - SOW wajib telah diverifikasi dan disetujui oleh Asisten Bibitan (ASB)
 * - Jika SOW memiliki afkir: SELURUH CULL terkait WAJIB berstatus final approved ('DISETUJUI' atau 'VERIFIED')
 */
export function canCreatePreGraftingSelection1Document(seedingTxOrDocNo, options = {}) {
  if (!seedingTxOrDocNo) {
    return { canCreate: false, reason: 'Data transaksi penyemaian tidak valid.', seedingTx: null, relatedCulls: [] };
  }

  // 1. Resolve SOW & Multi-SOW Batch Support
  if (typeof seedingTxOrDocNo === 'object' && seedingTxOrDocNo !== null && Array.isArray(seedingTxOrDocNo.sourceSeedingDocNos) && seedingTxOrDocNo.sourceSeedingDocNos.length > 1) {
    for (const sowNo of seedingTxOrDocNo.sourceSeedingDocNos) {
      const subCheck = canCreatePreGraftingSelection1Document(sowNo, options);
      if (!subCheck.canCreate) {
        return subCheck;
      }
    }
    return {
      canCreate: true,
      reason: 'Seluruh Dokumen CULL terkait pada Batch telah disetujui Asisten Bibitan.',
      seedingTx: seedingTxOrDocNo,
      relatedCulls: []
    };
  }

  let seedingTx = typeof seedingTxOrDocNo === 'object' && seedingTxOrDocNo !== null
    ? seedingTxOrDocNo
    : null;

  const searchKey = String(
    (typeof seedingTxOrDocNo === 'object' && seedingTxOrDocNo !== null)
      ? (seedingTxOrDocNo.docNo || seedingTxOrDocNo.seedingDocNo || seedingTxOrDocNo.sourceDocNo || seedingTxOrDocNo.id || '')
      : seedingTxOrDocNo
  ).trim();

  const allSeedings = storage.get('seeding_transactions', []);
  if (!seedingTx || (!seedingTx.totalDisemai && !seedingTx.seedsQuantity && !seedingTx.disemai && seedingTx.rusak === undefined && seedingTx.rusakQty === undefined && seedingTx.ditolak === undefined)) {
    const found = allSeedings.find(s => 
      s.docNo === searchKey || 
      s.id === searchKey || 
      s.seedingDocNo === searchKey
    );
    if (found) {
      seedingTx = found;
    } else {
      // Cek apakah searchKey adalah ID Dokumen Seleksi I
      const preDoc = getPreGraftingSelectionDocumentById(searchKey);
      if (preDoc) {
        if (Array.isArray(preDoc.sourceSeedingDocNos) && preDoc.sourceSeedingDocNos.length > 1) {
          for (const sowNo of preDoc.sourceSeedingDocNos) {
            const subCheck = canCreatePreGraftingSelection1Document(sowNo, options);
            if (!subCheck.canCreate) {
              return subCheck;
            }
          }
          return {
            canCreate: true,
            reason: 'Seluruh Dokumen CULL terkait pada Batch telah disetujui Asisten Bibitan.',
            seedingTx: preDoc,
            relatedCulls: []
          };
        }
        const sowRef = preDoc.sourceDocNo || preDoc.seedingDocNo || preDoc.sourceTransactionId;
        const foundSow = allSeedings.find(s => s.docNo === sowRef || s.id === sowRef || s.seedingDocNo === sowRef);
        if (foundSow) seedingTx = foundSow;
      }
    }
  }

  // 1b. Cek Verifikasi Dokumen Pindah Semai (SOW) oleh ASB
  if (options && !options.skipSowVerificationCheck) {
    const isSowApproved = isSeedingApprovedByAsb(seedingTx || searchKey);
    if (!isSowApproved) {
      const sowLife = getSowLifecycleStatus(seedingTx || searchKey);
      const reason = sowLife === 'SUBMITTED_TO_ASB'
        ? `Dokumen Pindah Semai (${seedingTx?.docNo || searchKey}) sudah dikirim namun belum diverifikasi dan disetujui Asisten Bibitan (ASB).`
        : `Dokumen Pindah Semai (${seedingTx?.docNo || searchKey}) belum dikonfirmasi untuk verifikasi oleh mantri dan belum diverifikasi dan disetujui Asisten Bibitan (ASB).`;
      return {
        canCreate: false,
        reason,
        seedingTx,
        relatedCulls: [],
        lifecycleStatus: sowLife === 'SUBMITTED_TO_ASB' ? 'MENUNGGU_APPROVAL_SOW' : 'MENUNGGU_KONFIRMASI_MANTRI'
      };
    }
  }

  // 2. Cek apakah SOW memiliki bibit afkir / ditolak
  const rusakQty = Number(seedingTx?.rusakQty ?? seedingTx?.rusak ?? 0);
  const matiQty = Number(seedingTx?.matiQty ?? seedingTx?.mati ?? 0);
  const lainnyaQty = Number(seedingTx?.lainnyaQty ?? seedingTx?.lainnya ?? 0);
  const ditolakQty = Number(seedingTx?.ditolak ?? seedingTx?.jumlahDitolak ?? 0);
  const hasAfkirInSow = (rusakQty > 0 || matiQty > 0 || lainnyaQty > 0 || ditolakQty > 0);

  const poolEntries = getRelatedCullPoolEntriesForSeeding(seedingTx || searchKey);
  const cullTxs = getRelatedCullRecordsForSeeding(seedingTx || searchKey);

  // CASE A: SOW TIDAK memiliki afkir dan tidak ada entri CULL di pool maupun transaksi CULL
  if (!hasAfkirInSow && poolEntries.length === 0 && cullTxs.length === 0) {
    const isSowApproved = isSeedingApprovedByAsb(seedingTx || searchKey);
    if (!isSowApproved && (!options || !options.skipSowVerificationCheck)) {
      const sowLife = getSowLifecycleStatus(seedingTx || searchKey);
      const reason = sowLife === 'SUBMITTED_TO_ASB'
        ? `Dokumen Pindah Semai (${seedingTx?.docNo || searchKey}) sudah dikirim namun belum diverifikasi dan disetujui Asisten Bibitan (ASB).`
        : `Dokumen Pindah Semai (${seedingTx?.docNo || searchKey}) belum dikonfirmasi untuk verifikasi oleh mantri dan belum diverifikasi dan disetujui Asisten Bibitan (ASB).`;
      return {
        canCreate: false,
        reason,
        seedingTx,
        relatedCulls: [],
        lifecycleStatus: sowLife === 'SUBMITTED_TO_ASB' ? 'MENUNGGU_APPROVAL_SOW' : 'MENUNGGU_KONFIRMASI_MANTRI'
      };
    }
    return {
      canCreate: true,
      reason: 'Dokumen Pindah Semai tidak memiliki bibit afkir (Eligible).',
      seedingTx,
      relatedCulls: [],
      lifecycleStatus: 'SIAP_SELEKSI'
    };
  }

  // CASE B: SOW memiliki afkir
  // 1. Jika belum ada deklarasi CULL sama sekali
  if (cullTxs.length === 0) {
    return {
      canCreate: false,
      reason: 'Dokumen Pindah Semai memiliki bibit afkir yang belum dideklarasikan ke CULL.',
      seedingTx,
      relatedCulls: [],
      lifecycleStatus: 'MENUNGGU_PERSETUJUAN_CULL'
    };
  }

  // Helper status final approved
  const isApprovedStatus = (st) => {
    const s = String(st || '').toUpperCase().trim();
    return s === 'DISETUJUI' || s === 'VERIFIED' || s === 'TERVERIFIKASI' || s === SELECTION_STATUS.DISETUJUI;
  };

  // 2. Cek apakah masih ada entri pool yang belum dideklarasikan (partial declaration)
  const pendingPool = poolEntries.filter(p => p.status === 'PENDING_DECLARATION' || p.status === 'DIKEMBALIKAN');
  if (pendingPool.length > 0) {
    const unsubmittedPool = pendingPool.filter(p => !cullTxs.some(c => 
      c.selectionPoolDocNo === p.docNo || 
      c.id === p.selectionTransactionId || 
      c.selectionId === p.selectionTransactionId ||
      c.docNo === p.docNo ||
      (c.sourceDocNo && p.sourceDocNo && c.sourceDocNo === p.sourceDocNo && (c.category === p.category || c.alasanDitolakCategory === p.category))
    ));
    if (unsubmittedPool.length > 0) {
      return {
        canCreate: false,
        reason: 'Masih terdapat bibit afkir Pindah Semai yang belum dideklarasikan ke CULL.',
        seedingTx,
        relatedCulls: cullTxs,
        lifecycleStatus: 'MENUNGGU_PERSETUJUAN_CULL'
      };
    }
  }

  // 3. Cek seluruh dokumen CULL: WAJIB ALL APPROVED
  const unapprovedCulls = cullTxs.filter(c => !isApprovedStatus(c.status));
  if (unapprovedCulls.length > 0) {
    const unapprovedNames = unapprovedCulls.map(c => c.docNo || c.selectionNo || c.id).join(', ');
    const hasRevision = unapprovedCulls.some(c => {
      const st = String(c.status || '').toUpperCase();
      return st.includes('KEMBALI') || st.includes('REVISI');
    });
    const reasonText = hasRevision
      ? `Dokumen CULL (${unapprovedNames}) dikembalikan/revisi dan belum disetujui Asisten Bibitan.`
      : `Dokumen CULL (${unapprovedNames}) masih menunggu persetujuan Asisten Bibitan.`;

    return {
      canCreate: false,
      reason: reasonText,
      seedingTx,
      relatedCulls: cullTxs,
      unapprovedCulls,
      lifecycleStatus: 'MENUNGGU_PERSETUJUAN_CULL'
    };
  }

  // Seluruh CULL telah disetujui!
  return {
    canCreate: true,
    reason: 'Seluruh Dokumen CULL terkait telah disetujui Asisten Bibitan.',
    seedingTx,
    relatedCulls: cullTxs,
    lifecycleStatus: 'SIAP_SELEKSI'
  };
}

/**
 * Memeriksa apakah transaksi Seleksi Pra-Okulasi I dapat dilakukan untuk Dokumen Seleksi / Batch / Bedengan.
 * Prasyarat:
 * 1. Seluruh Dokumen Pindah Semai (SOW) sumber telah dikonfirmasi verifikasinya & disetujui ASB.
 * 2. Jika SOW memiliki bibit afkir:
 *    - Seluruh bibit afkir telah dideklarasikan ke CULL (tidak ada pending declaration).
 *    - Seluruh Dokumen CULL terkait telah disetujui ASB (status 'DISETUJUI' / 'VERIFIED').
 *
 * @param {string|Object} targetDocOrBatchKey - Objek Dokumen Seleksi I, ID/docNo Dokumen Seleksi I, atau Kode Batch
 * @param {string|null} bedenganCode - Opsional kode bedengan untuk filter spesifik
 * @param {Object} options - Opsi tambahan
 * @returns {Object} { canPerform: boolean, reason: string, unapprovedSows: Array, unapprovedCulls: Array, pendingCullPool: Array }
 */
export function canPerformPreGraftingSelection1(targetDocOrBatchKey, bedenganCode = null, options = {}) {
  if (!targetDocOrBatchKey) {
    return {
      canPerform: false,
      reason: 'Parameter target batch atau dokumen tidak valid.',
      unapprovedSows: [],
      unapprovedCulls: [],
      pendingCullPool: []
    };
  }

  const allSeedings = storage.get('seeding_transactions', []);
  const allPreDocs = storage.get(PRE_GRAFTING_SELECTION_DOC_STORAGE_KEY, []);
  const sowDocNos = new Set();
  const sowObjects = [];

  let targetDoc = null;
  let batchKey = null;

  if (typeof targetDocOrBatchKey === 'object' && targetDocOrBatchKey !== null) {
    // Jika objek adalah seeding transaction (SOW):
    if (targetDocOrBatchKey.totalDisemai !== undefined || targetDocOrBatchKey.seedsQuantity !== undefined || (targetDocOrBatchKey.docNo && String(targetDocOrBatchKey.docNo).includes('/SOW/'))) {
      sowObjects.push(targetDocOrBatchKey);
      if (targetDocOrBatchKey.docNo) sowDocNos.add(targetDocOrBatchKey.docNo);
      batchKey = targetDocOrBatchKey.batchCode || targetDocOrBatchKey.batchNo || targetDocOrBatchKey.batchId;
    } else {
      // Objek Dokumen Seleksi
      targetDoc = targetDocOrBatchKey;
      batchKey = targetDoc.batchCode || targetDoc.batchNo || targetDoc.batchId;
    }
  } else {
    const keyStr = String(targetDocOrBatchKey).trim();
    // Cek apakah keyStr mencocokkan dokumen seleksi
    const foundDoc = allPreDocs.find(d => 
      d.id === keyStr || 
      d.docNo === keyStr || 
      d.selectionDocNo === keyStr
    );
    if (foundDoc) {
      targetDoc = foundDoc;
      batchKey = targetDoc.batchCode || targetDoc.batchNo || targetDoc.batchId;
    } else {
      // Cek apakah keyStr mencocokkan dokumen SOW
      const foundSow = allSeedings.find(s => s.docNo === keyStr || s.id === keyStr || s.seedingDocNo === keyStr);
      if (foundSow) {
        sowObjects.push(foundSow);
        sowDocNos.add(foundSow.docNo || foundSow.id);
        batchKey = foundSow.batchCode || foundSow.batchNo || foundSow.batchId;
      } else {
        // Anggap sebagai kode batch
        batchKey = keyStr;
      }
    }
  }

  const normBed = bedenganCode ? formatBedenganDisplayCode(bedenganCode).toUpperCase() : null;

  // Jika targetDoc diketahui, kumpulkan referensi SOW-nya
  if (targetDoc) {
    if (Array.isArray(targetDoc.sourceSeedingDocNos) && targetDoc.sourceSeedingDocNos.length > 0) {
      targetDoc.sourceSeedingDocNos.forEach(no => sowDocNos.add(String(no).trim()));
    }
    const singleRef = targetDoc.sourceDocNo || targetDoc.seedingDocNo || targetDoc.sourceTransactionId;
    if (singleRef) {
      sowDocNos.add(String(singleRef).trim());
    }
  }

  // Jika batchKey diketahui, kumpulkan seluruh SOW dari allPreDocs yang cocok
  if (batchKey) {
    const normBatch = String(batchKey).trim().toUpperCase();
    allPreDocs.forEach(d => {
      const isStage1Doc = (d.selectionStage === 'SELEKSI_I' || d.selectionStage === 'SELEKSI_1' || !d.selectionStage);
      if (!isStage1Doc) return;
      const dBatch = String(d.batchCode || d.batchNo || d.batchId || '').trim().toUpperCase();
      if (dBatch === normBatch) {
        if (normBed) {
          const rawBed = d.bedenganCode || d.bedenganId || d.bedengan || (d.rows && d.rows[0] ? (d.rows[0].bedenganCode || d.rows[0].bedenganId || d.rows[0].bedengan) : '') || 'BED-001';
          if (formatBedenganDisplayCode(rawBed).toUpperCase() !== normBed) return;
        }
        if (Array.isArray(d.sourceSeedingDocNos) && d.sourceSeedingDocNos.length > 0) {
          d.sourceSeedingDocNos.forEach(no => sowDocNos.add(String(no).trim()));
        }
        const singleRef = d.sourceDocNo || d.seedingDocNo || d.sourceTransactionId;
        if (singleRef) {
          sowDocNos.add(String(singleRef).trim());
        }
      }
    });

    // Kumpulkan seluruh SOW dari seeding_transactions yang cocok
    allSeedings.forEach(s => {
      const sBatchId = String(s.batchId || '').trim().toUpperCase();
      const sBatchCode = String(s.batchCode || s.batchNo || '').trim().toUpperCase();
      let isBatchMatch = (sBatchId === normBatch || sBatchCode === normBatch);
      if (!isBatchMatch && s.rows && Array.isArray(s.rows)) {
        isBatchMatch = s.rows.some(r => {
          const rBId = String(r.batchId || '').trim().toUpperCase();
          const rBCode = String(r.batchCode || r.batchNo || '').trim().toUpperCase();
          return rBId === normBatch || rBCode === normBatch;
        });
      }
      if (!isBatchMatch) return;

      // Filter bedengan jika normBed ditentukan
      if (normBed) {
        const rawBed = s.bedenganCode || s.bedenganId || s.bedengan || (s.rows && s.rows[0] ? (s.rows[0].bedenganCode || s.rows[0].bedenganId || s.rows[0].bedengan) : '') || 'BED-001';
        let isBedMatch = (formatBedenganDisplayCode(rawBed).toUpperCase() === normBed);
        if (!isBedMatch && s.rows && Array.isArray(s.rows)) {
          isBedMatch = s.rows.some(r => formatBedenganDisplayCode(r.bedenganCode || r.bedenganId || r.bedengan || 'BED-001').toUpperCase() === normBed);
        }
        if (!isBedMatch) return;
      }

      if (s.docNo) sowDocNos.add(String(s.docNo).trim());
      else if (s.id) sowDocNos.add(String(s.id).trim());
      sowObjects.push(s);
    });
  }

  // Jika tidak ditemukan SOW:
  if (sowDocNos.size === 0 && sowObjects.length === 0) {
    if (targetDoc) {
      const sowRef = targetDoc.sourceDocNo || targetDoc.seedingDocNo || targetDoc.sourceTransactionId;
      const isTargetSowAppr = sowRef ? isSeedingApprovedByAsb(sowRef) : false;
      if (!isTargetSowAppr && (!options || !options.skipSowVerificationCheck)) {
        const docLabel = sowRef || targetDoc.docNo || 'SOW-UNKNOWN';
        const sowLife = getSowLifecycleStatus(sowRef);
        const reasonText = sowLife === 'SUBMITTED_TO_ASB'
          ? `Dokumen Pindah Semai (${docLabel}) sudah dikirim namun belum diverifikasi dan disetujui Asisten Bibitan (ASB).`
          : `Dokumen Pindah Semai (${docLabel}) belum dikonfirmasi untuk verifikasi oleh mantri dan belum diverifikasi dan disetujui Asisten Bibitan (ASB).`;
        return {
          canPerform: false,
          reason: reasonText,
          lifecycleStatus: sowLife === 'SUBMITTED_TO_ASB' ? 'MENUNGGU_APPROVAL_SOW' : 'MENUNGGU_KONFIRMASI_MANTRI',
          unapprovedSows: [{
            docNo: docLabel,
            lifecycle: sowLife,
            status: sowLife === 'SUBMITTED_TO_ASB' ? 'MENUNGGU_VERIFIKASI' : 'MENUNGGU_KONFIRMASI_VERIFIKASI',
            reason: reasonText
          }],
          unapprovedCulls: [],
          pendingCullPool: []
        };
      }
      const fallback = canCreatePreGraftingSelection1Document(targetDoc, options);
      return {
        canPerform: fallback.canCreate,
        reason: fallback.reason,
        lifecycleStatus: fallback.lifecycleStatus || (fallback.canCreate ? 'SIAP_SELEKSI' : 'MENUNGGU_APPROVAL_SOW'),
        unapprovedSows: fallback.canCreate ? [] : [{ docNo: targetDoc.sourceDocNo || targetDoc.id, reason: fallback.reason }],
        unapprovedCulls: fallback.relatedCulls || [],
        pendingCullPool: []
      };
    }
    return {
      canPerform: false,
      reason: 'Tidak ditemukan transaksi Pindah Semai (SOW) yang telah disetujui untuk batch/bedengan ini.',
      lifecycleStatus: 'MENUNGGU_KONFIRMASI_MANTRI',
      unapprovedSows: [],
      unapprovedCulls: [],
      pendingCullPool: []
    };
  }

  // 2. Evaluasi setiap SOW yang ditemukan
  const unapprovedSows = [];
  const unapprovedCulls = [];
  const pendingCullPool = [];

  const itemsToCheck = sowDocNos.size > 0 ? Array.from(sowDocNos) : sowObjects;

  for (const item of itemsToCheck) {
    const sowRecord = typeof item === 'object' ? item : (allSeedings.find(s => s.docNo === item || s.id === item || s.seedingDocNo === item));
    const docLabel = (typeof item === 'object' ? (item.docNo || item.id) : item) || 'SOW-UNKNOWN';
    const isSowAppr = isSeedingApprovedByAsb(sowRecord || item);
    const sowLife = getSowLifecycleStatus(sowRecord || item);

    // Cek persetujuan ASB untuk Dokumen Pindah Semai (SOW)
    if (!isSowAppr && (!options || !options.skipSowVerificationCheck)) {
      const reasonText = sowLife === 'SUBMITTED_TO_ASB'
        ? `Dokumen Pindah Semai (${docLabel}) sudah dikirim namun belum diverifikasi dan disetujui Asisten Bibitan (ASB).`
        : `Dokumen Pindah Semai (${docLabel}) belum dikonfirmasi untuk verifikasi oleh mantri dan belum diverifikasi dan disetujui Asisten Bibitan (ASB).`;
      unapprovedSows.push({
        docNo: docLabel,
        lifecycle: sowLife,
        status: sowLife === 'SUBMITTED_TO_ASB' ? 'MENUNGGU_VERIFIKASI' : (sowRecord?.verificationStatus || sowRecord?.status || 'MENUNGGU_KONFIRMASI_VERIFIKASI'),
        reason: reasonText
      });
    }

    // Cek gate deklarasi & persetujuan CULL jika SOW memiliki afkir
    const subCheck = canCreatePreGraftingSelection1Document(item, { ...options, skipSowVerificationCheck: true });
    if (!subCheck.canCreate) {
      if (subCheck.relatedCulls && subCheck.relatedCulls.length > 0) {
        subCheck.relatedCulls.forEach(c => {
          const st = String(c.status || '').toUpperCase().trim();
          if (st !== 'DISETUJUI' && st !== 'VERIFIED' && st !== 'TERVERIFIKASI') {
            if (!unapprovedCulls.some(existing => (existing.id && existing.id === c.id) || (existing.docNo && existing.docNo === c.docNo))) {
              unapprovedCulls.push(c);
            }
          }
        });
      }

      if (subCheck.reason && (subCheck.reason.includes('belum dideklarasikan') || subCheck.reason.includes('bibit afkir'))) {
        pendingCullPool.push({
          sowNo: docLabel,
          reason: subCheck.reason
        });
      }

      if (!unapprovedSows.some(s => s.docNo === docLabel) && !unapprovedCulls.length && !pendingCullPool.length) {
        unapprovedSows.push({
          docNo: docLabel,
          lifecycle: sowLife,
          status: sowRecord?.verificationStatus || sowRecord?.status || 'MENUNGGU_KONFIRMASI_VERIFIKASI',
          reason: subCheck.reason
        });
      }
    }
  }

  if (unapprovedSows.length > 0 || unapprovedCulls.length > 0 || pendingCullPool.length > 0) {
    const reasons = [];
    let lifecycleStatus = 'MENUNGGU_KONFIRMASI_MANTRI';

    if (unapprovedSows.length > 0) {
      const sowNames = unapprovedSows.map(s => s.docNo).join(', ');
      const hasUnconfirmedByMantri = unapprovedSows.some(s => s.lifecycle === 'READY_TO_CONFIRM');
      if (hasUnconfirmedByMantri) {
        lifecycleStatus = 'MENUNGGU_KONFIRMASI_MANTRI';
        reasons.push(`Dokumen Pindah Semai (${sowNames}) belum diverifikasi dan disetujui Asisten Bibitan (ASB).`);
      } else {
        lifecycleStatus = 'MENUNGGU_APPROVAL_SOW';
        reasons.push(`Dokumen Pindah Semai (${sowNames}) sudah dikirim namun belum diverifikasi dan disetujui Asisten Bibitan (ASB).`);
      }
    } else if (unapprovedCulls.length > 0 || pendingCullPool.length > 0) {
      lifecycleStatus = 'MENUNGGU_PERSETUJUAN_CULL';
      if (pendingCullPool.length > 0) {
        reasons.push(`Bibit afkir Pindah Semai belum selesai dideklarasikan ke Seleksi Ditolak Pindah Semai (CULL).`);
      }
      if (unapprovedCulls.length > 0) {
        const cullNames = unapprovedCulls.map(c => c.docNo || c.selectionNo || c.id).join(', ');
        reasons.push(`Dokumen Seleksi Ditolak Pindah Semai (${cullNames}) belum disetujui Asisten Bibitan (ASB).`);
      }
    }

    return {
      canPerform: false,
      reason: reasons.join(' '),
      lifecycleStatus,
      unapprovedSows,
      unapprovedCulls,
      pendingCullPool
    };
  }

  return {
    canPerform: true,
    reason: 'Dokumen Pindah Semai dan Seleksi Ditolak telah disetujui Asisten Bibitan (Eligible).',
    lifecycleStatus: 'SIAP_SELEKSI',
    unapprovedSows: [],
    unapprovedCulls: [],
    pendingCullPool: []
  };
}

/**
 * Memeriksa apakah Dokumen Seleksi II dapat dibuat dari Dokumen Seleksi I
 * Gate Baseline: Seleksi I harus berstatus DISETUJUI dan isFinal = true
 */
export function canCreateSelection2Document(sourceSelection1IdOrDoc) {
  const sourceDoc = typeof sourceSelection1IdOrDoc === 'object' && sourceSelection1IdOrDoc !== null
    ? sourceSelection1IdOrDoc
    : getPreGraftingSelectionDocumentById(sourceSelection1IdOrDoc);

  if (!sourceDoc) {
    return { canCreate: false, reason: 'Dokumen Seleksi I tidak ditemukan.', sourceDoc: null };
  }

  const stage = String(sourceDoc.selectionStage || '').toUpperCase();
  if (stage !== 'SELEKSI_I' && stage !== 'SELEKSI_1') {
    return { canCreate: false, reason: 'Source dokumen bukan merupakan Dokumen Seleksi I.', sourceDoc };
  }

  // 1. Validasi Populasi Awal Polybag & Bibit (harus valid dan > 0)
  let initialBibit = parseInt(sourceDoc.sourceBibitQty !== undefined ? sourceDoc.sourceBibitQty : (sourceDoc.initialBibitQty || 0), 10);
  if ((isNaN(initialBibit) || initialBibit <= 0) && Array.isArray(sourceDoc.rows) && sourceDoc.rows.length > 0) {
    initialBibit = sourceDoc.rows.reduce((sum, r) => sum + parseInt(r.sourceBibitQty !== undefined ? r.sourceBibitQty : (r.disemai !== undefined ? r.disemai : (r.initialBibit || 0)), 10), 0);
  }

  let initialPolybag = parseInt(
    sourceDoc.sourcePolybagQty !== undefined ? sourceDoc.sourcePolybagQty : 
    (sourceDoc.activePolybagQty !== undefined ? sourceDoc.activePolybagQty : 
    (sourceDoc.initialPolybagQty !== undefined ? sourceDoc.initialPolybagQty : 
    (sourceDoc.totalPolybag !== undefined ? sourceDoc.totalPolybag : 
    (sourceDoc.polybag !== undefined ? sourceDoc.polybag : 0)))), 10
  );
  if ((isNaN(initialPolybag) || initialPolybag <= 0) && Array.isArray(sourceDoc.rows) && sourceDoc.rows.length > 0) {
    initialPolybag = sourceDoc.rows.reduce((sum, r) => sum + parseInt(r.polybag !== undefined ? r.polybag : (r.initialPolybag || r.polybagCount || 0), 10), 0);
  }
  if ((isNaN(initialPolybag) || initialPolybag <= 0) && initialBibit > 0) {
    initialPolybag = Math.ceil(initialBibit / 2);
  }

  if (isNaN(initialPolybag) || initialPolybag <= 0 || isNaN(initialBibit) || initialBibit <= 0) {
    return {
      canCreate: false,
      reason: `Populasi awal Dokumen Seleksi I (${sourceDoc.docNo}) tidak valid atau bernilai nol (Polybag: ${isNaN(initialPolybag) ? 0 : initialPolybag}, Bibit: ${isNaN(initialBibit) ? 0 : initialBibit}).`,
      sourceDoc
    };
  }

  // 2. Approval final ASB telah sah dan tersimpan
  const statusUpper = String(sourceDoc.status || '').toUpperCase();
  const verUpper = String(sourceDoc.verificationStatus || '').toUpperCase();
  const isApproved = (
    statusUpper === SELECTION_STATUS.DISETUJUI ||
    statusUpper === 'DISETUJUI' ||
    statusUpper === 'TERVERIFIKASI' ||
    verUpper === 'TERVERIFIKASI'
  );
  const isFinal = Boolean(sourceDoc.isFinal) || (isApproved && Boolean(sourceDoc.verifiedAt));

  if (!isApproved || !isFinal) {
    return {
      canCreate: false,
      reason: `Dokumen Seleksi I (${sourceDoc.docNo}) belum berstatus FINAL disetujui Asisten Bibitan (status: ${sourceDoc.status || 'DRAFT'}).`,
      sourceDoc
    };
  }

  // 3. Terdapat transaksi pemeriksaan fisik valid atau ringkasan langsung sah
  const executions = getSeleksi1ExecutionsByDocument(sourceDoc.id || sourceDoc.docNo);
  const hasDirectSummary = (sourceDoc.totalLayak !== undefined || sourceDoc.finalBibitQty !== undefined) && (sourceDoc.activePolybagQty !== undefined || sourceDoc.sourcePolybagQty !== undefined || sourceDoc.sourceBibitQty !== undefined);
  if ((!executions || executions.length === 0) && !hasDirectSummary) {
    return {
      canCreate: false,
      reason: `Dokumen Seleksi I (${sourceDoc.docNo}) belum memiliki transaksi pelaksanaan fisik lapangan.`,
      sourceDoc
    };
  }

  // 4. Validasi pemeriksaan fisik aktual dan approval seluruh child transactions
  if (executions && executions.length > 0) {
    // Seluruh child transactions harus sudah disetujui ASB
    const unapprovedTxs = executions.filter(tx => {
      const s = String(tx.status || '').toUpperCase();
      const v = String(tx.verificationStatus || '').toUpperCase();
      return s !== SELECTION_STATUS.DISETUJUI && s !== 'DISETUJUI' && s !== 'TERVERIFIKASI' && v !== 'TERVERIFIKASI' && !tx.isFinal;
    });
    if (unapprovedTxs.length > 0) {
      return {
        canCreate: false,
        reason: `Pemeriksaan Seleksi I (${sourceDoc.docNo}) memiliki transaksi yang belum disetujui final oleh ASB.`,
        sourceDoc
      };
    }

    // Ketuntasan pemeriksaan fisik 100% (sisa polybag harus nol di seluruh bedengan)
    const bedScopeList = getBedenganScopeStatusForSeleksi1(sourceDoc, executions);
    const uninspectedBeds = bedScopeList.filter(b => b.remainingPolybag > 0);
    if (uninspectedBeds.length > 0) {
      const uninspectedCodes = uninspectedBeds.map(b => b.bedenganCode || b.bedenganId).join(', ');
      return {
        canCreate: false,
        reason: `Pemeriksaan Seleksi I (${sourceDoc.docNo}) belum tuntas. Masih ada sisa polybag pada bedengan: ${uninspectedCodes}.`,
        sourceDoc
      };
    }

    // Akumulasi polybag diperiksa mencapai 100% dari populasi scope
    const totalInspectedPolybag = bedScopeList.reduce((sum, b) => sum + (b.inspectedPolybag || 0), 0);
    const totalInitialPolybag = bedScopeList.reduce((sum, b) => sum + (b.initialPolybag || 0), 0);
    if (totalInitialPolybag > 0 && totalInspectedPolybag < totalInitialPolybag) {
      return {
        canCreate: false,
        reason: `Akumulasi polybag diperiksa (${totalInspectedPolybag}) belum mencapai 100% dari populasi awal (${totalInitialPolybag}).`,
        sourceDoc
      };
    }

    // 5. Kuantitas pemeriksaan seimbang dan valid (afkir nol tetap sah)
    const totalAfkir = executions.reduce((sum, tx) => sum + getRecordedBibitSelectedQty(tx), 0);
    if (totalAfkir < 0 || totalAfkir > initialBibit) {
      return {
        canCreate: false,
        reason: `Kuantitas bibit afkir (${totalAfkir}) tidak valid atau melebihi populasi awal (${initialBibit}).`,
        sourceDoc
      };
    }
  }

  // 6. Populasi akhir bibit dan polybag dapat ditentukan secara valid
  let finalBibit = initialBibit;
  if (executions && executions.length > 0) {
    const totalAfkir = executions.reduce((sum, tx) => sum + getRecordedBibitSelectedQty(tx), 0);
    finalBibit = initialBibit - totalAfkir;
  } else if (sourceDoc.totalLayak !== undefined) {
    finalBibit = parseInt(sourceDoc.totalLayak, 10);
  } else if (sourceDoc.finalBibitQty !== undefined) {
    finalBibit = parseInt(sourceDoc.finalBibitQty, 10);
  }

  if (isNaN(finalBibit) || finalBibit < 0) {
    return {
      canCreate: false,
      reason: `Populasi bibit akhir Seleksi I tidak valid (${finalBibit}).`,
      sourceDoc
    };
  }

  return { canCreate: true, sourceDoc };
}

/**
 * Membuat Dokumen Seleksi II dari Dokumen Seleksi I yang sudah FINAL
 * Mengimplementasikan Gate, Source Traceability, dan Kuantitas Hasil Final Seleksi I
 */
export function createSelection2DocumentFromSelection1(sourceSelection1IdOrDocNo, currentUser = null, options = {}) {
  const gateCheck = canCreateSelection2Document(sourceSelection1IdOrDocNo);
  if (!gateCheck.canCreate) {
    throw new Error(`Gagal membuat Dokumen Seleksi II: ${gateCheck.reason}`);
  }

  const sourceDoc = gateCheck.sourceDoc;
  const allDocs = storage.get(PRE_GRAFTING_SELECTION_DOC_STORAGE_KEY, []);

  // Generate Dokumen Seleksi II No (Format: 2026/SEL-II/001)
  let maxSeq = 0;
  allDocs.forEach(d => {
    if (d.selectionStage === SELECTION_STAGES.SELEKSI_2 || d.selectionStage === 'SELEKSI_II' || d.selectionStage === 'SELEKSI_2') {
      const docStr = String(d.docNo || d.selectionDocNo || '');
      const match = docStr.match(/SEL-II\/(\d+)/i) || docStr.match(/(\d+)$/);
      if (match) {
        const n = parseInt(match[1], 10);
        if (!isNaN(n) && n > maxSeq) maxSeq = n;
      }
    }
  });

  const nextSeq = maxSeq + 1;
  const docNo = options.docNo || formatStandardDocNo(2026, 'SEL-II', nextSeq);

  const executions = getSeleksi1ExecutionsByDocument(sourceDoc.id || sourceDoc.docNo);

  // Kuantitas awal Seleksi II diambil dari saldo akhir sah Seleksi I
  // Formula Wajib: Populasi Tahap Berikutnya = Populasi Awal Tahap Sebelumnya - Total Afkir Valid Tahap Sebelumnya
  // Dilarang keras menjumlahkan snapshot saldo transaksi (seperti sum(actualBibitRetainedQty))
  let initialBibit = parseInt(sourceDoc.sourceBibitQty !== undefined ? sourceDoc.sourceBibitQty : (sourceDoc.initialBibitQty || 0), 10);
  if ((isNaN(initialBibit) || initialBibit <= 0) && Array.isArray(sourceDoc.rows) && sourceDoc.rows.length > 0) {
    initialBibit = sourceDoc.rows.reduce((sum, r) => sum + parseInt(r.sourceBibitQty !== undefined ? r.sourceBibitQty : (r.disemai !== undefined ? r.disemai : (r.initialBibit || 0)), 10), 0);
  }

  let sourceBibitQty = 0;
  if (executions && executions.length > 0) {
    const totalAfkir = executions.reduce((sum, tx) => sum + getRecordedBibitSelectedQty(tx), 0);
    sourceBibitQty = Math.max(0, initialBibit - totalAfkir);
  } else if (sourceDoc.totalLayak !== undefined) {
    sourceBibitQty = parseInt(sourceDoc.totalLayak, 10);
  } else if (sourceDoc.finalBibitQty !== undefined) {
    sourceBibitQty = parseInt(sourceDoc.finalBibitQty, 10);
  } else if (sourceDoc.currentBibitQty !== undefined) {
    sourceBibitQty = parseInt(sourceDoc.currentBibitQty, 10);
  } else {
    sourceBibitQty = initialBibit;
  }

  // Polybag source Seleksi II = Polybag AKTIF dari HASIL FINAL Seleksi I
  let sourcePolybagQty = 0;
  if (sourceDoc.activePolybagQty !== undefined && sourceDoc.activePolybagQty !== null && !isNaN(sourceDoc.activePolybagQty) && parseInt(sourceDoc.activePolybagQty, 10) > 0) {
    sourcePolybagQty = parseInt(sourceDoc.activePolybagQty, 10);
  } else if (executions && executions.length > 0) {
    const bedScopeList = getBedenganScopeStatusForSeleksi1(sourceDoc, executions);
    const totalInitPoly = bedScopeList.reduce((sum, b) => sum + (b.initialPolybag || 0), 0);
    const totalActiveFromTxs = executions.reduce((sum, tx) => {
      if (tx.actualPolybagActiveQty !== undefined && !isNaN(parseInt(tx.actualPolybagActiveQty, 10))) {
        return sum + parseInt(tx.actualPolybagActiveQty, 10);
      }
      if (tx.activePolybagQty !== undefined && !isNaN(parseInt(tx.activePolybagQty, 10))) {
        return sum + parseInt(tx.activePolybagQty, 10);
      }
      return sum;
    }, 0);
    if (totalActiveFromTxs > 0 && totalActiveFromTxs <= totalInitPoly) {
      sourcePolybagQty = totalActiveFromTxs;
    } else if (totalInitPoly > 0) {
      sourcePolybagQty = totalInitPoly;
    }
  }
  if (sourcePolybagQty === 0) {
    sourcePolybagQty = parseInt(sourceDoc.currentPolybagQty !== undefined ? sourceDoc.currentPolybagQty : (sourceDoc.sourcePolybagQty || 0), 10);
  }
  if (sourcePolybagQty === 0 && Array.isArray(sourceDoc.rows) && sourceDoc.rows.length > 0) {
    sourcePolybagQty = sourceDoc.rows.reduce((sum, r) => sum + parseInt(r.polybag !== undefined ? r.polybag : (r.initialPolybag || r.polybagCount || 0), 10), 0);
  }

  // Build rows / bedengan breakdown dari Seleksi I secara proporsional dan akurat
  let rows = [];
  if (Array.isArray(sourceDoc.rows) && sourceDoc.rows.length > 0) {
    const sourceBedScope = getBedenganScopeStatusForSeleksi1(sourceDoc, executions);
    rows = sourceDoc.rows.map(r => {
      const bCode = formatBedenganDisplayCode(r.bedenganCode || r.bedengan || r.bedenganId);
      const bTxs = executions.filter(tx => formatBedenganDisplayCode(tx.bedenganCode || tx.bedengan).toUpperCase() === bCode.toUpperCase());
      // Selaraskan prioritas dengan scope Seleksi I: `disemai` adalah populasi
      // awal bedengan, sedangkan sourceBibitQty pada data lama bisa tersimpan 0.
      const scopedBed = sourceBedScope.find(b => formatBedenganDisplayCode(b.bedenganCode || b.bedenganId).toUpperCase() === bCode.toUpperCase());
      const bInitialBibit = Number(scopedBed?.initialBibit || resolveSelectionRowBibitQty(r, sourceDoc.rows.length === 1 ? initialBibit : 0));
      const bInitialPoly = parseInt(r.polybag !== undefined ? r.polybag : (r.initialPolybag !== undefined ? r.initialPolybag : (r.polybagCount !== undefined ? r.polybagCount : (sourceDoc.rows.length === 1 ? sourcePolybagQty : 0))), 10);

      // Hitung afkir sah pada bedengan ini (BUKAN sum snapshot retained!)
      const bAfkir = bTxs.reduce((sum, tx) => sum + getRecordedBibitSelectedQty(tx), 0);
      let allocatedBibit = bTxs.length > 0 ? Math.max(0, bInitialBibit - bAfkir) : bInitialBibit;
      if (allocatedBibit === 0 && sourceDoc.rows.length === 1 && sourceBibitQty > 0) {
        allocatedBibit = sourceBibitQty;
      }

      // Hitung polybag aktif bedengan
      let allocatedPoly = bInitialPoly;
      if (bTxs.length > 0) {
        const bActivePolySum = bTxs.reduce((sum, tx) => {
          if (tx.actualPolybagActiveQty !== undefined && !isNaN(parseInt(tx.actualPolybagActiveQty, 10))) {
            return sum + parseInt(tx.actualPolybagActiveQty, 10);
          }
          if (tx.activePolybagQty !== undefined && !isNaN(parseInt(tx.activePolybagQty, 10))) {
            return sum + parseInt(tx.activePolybagQty, 10);
          }
          return sum;
        }, 0);
        if (bActivePolySum > 0 && bActivePolySum <= bInitialPoly) {
          allocatedPoly = bActivePolySum;
        }
      }
      if (allocatedPoly === 0 && sourceDoc.rows.length === 1 && sourcePolybagQty > 0) {
        allocatedPoly = sourcePolybagQty;
      }

      return {
        bedenganId: r.bedenganId || r.bedenganCode || bCode,
        bedenganCode: bCode,
        polybag: allocatedPoly,
        disemai: allocatedBibit,
        sourceBibitQty: allocatedBibit
      };
    });
  } else {
    rows = [{
      bedenganId: sourceDoc.bedenganId || 'BED-001',
      bedenganCode: formatBedenganDisplayCode(sourceDoc.bedenganCode || sourceDoc.bedengan || 'BED-001'),
      polybag: sourcePolybagQty,
      disemai: sourceBibitQty,
      sourceBibitQty: sourceBibitQty
    }];
  }

  // Sinkronkan dokumen downstream yang sudah ada dengan saldo final Seleksi I.
  // Dokumen yang masih draft tanpa pemeriksaan aman diperbarui; dokumen yang sudah
  // memiliki pemeriksaan tidak ditimpa dan diberi tanda agar direkonsiliasi manual.
  const existingIdx = allDocs.findIndex(d =>
    (d.selectionStage === SELECTION_STAGES.SELEKSI_2 || d.selectionStage === 'SELEKSI_II' || d.selectionStage === 'SELEKSI_2') &&
    (d.sourceSelectionDocumentId === sourceDoc.id || d.sourceSelectionDocNo === sourceDoc.docNo || d.sourceDocNo === sourceDoc.docNo)
  );
  if (existingIdx !== -1) {
    const existing = allDocs[existingIdx];
    const existingExecutions = getSeleksi2ExecutionsByDocument(existing.id || existing.docNo);
    const normalizeRows = value => (Array.isArray(value) ? value : []).map(row => ({
      bedenganCode: formatBedenganDisplayCode(row.bedenganCode || row.bedengan || row.bedenganId).toUpperCase(),
      polybag: parseInt(row.polybag !== undefined ? row.polybag : (row.initialPolybag || 0), 10) || 0,
      bibit: parseInt(row.sourceBibitQty !== undefined ? row.sourceBibitQty : (row.disemai || 0), 10) || 0
    })).sort((a, b) => a.bedenganCode.localeCompare(b.bedenganCode));
    const sourceChanged =
      parseInt(existing.sourceBibitQty || 0, 10) !== sourceBibitQty ||
      parseInt(existing.sourcePolybagQty || 0, 10) !== sourcePolybagQty ||
      JSON.stringify(normalizeRows(existing.rows)) !== JSON.stringify(normalizeRows(rows));

    const existingStatus = String(existing.status || '').toUpperCase();
    const existingVerificationStatus = String(existing.verificationStatus || '').toUpperCase();
    const existingIsFinal = existing.isFinal || existingStatus === 'DISETUJUI' || existingStatus === 'TERVERIFIKASI' ||
      existingVerificationStatus === 'DISETUJUI' || existingVerificationStatus === 'TERVERIFIKASI';

    if (sourceChanged && existingExecutions.length === 0 && !existing.isCompleted && !existingIsFinal) {
      const synced = {
        ...existing,
        rows,
        sourceBibitQty,
        sourcePolybagQty,
        currentBibitQty: sourceBibitQty,
        currentPolybagQty: sourcePolybagQty,
        sourceFinalStatus: SELECTION_STATUS.DISETUJUI,
        sourceFinalId: sourceDoc.id,
        sourcePopulationSyncedAt: new Date().toISOString(),
        sourceChangePending: false,
        sourceChangeDetails: null,
        updatedAt: new Date().toISOString()
      };
      allDocs[existingIdx] = synced;
      storage.set(PRE_GRAFTING_SELECTION_DOC_STORAGE_KEY, allDocs);
      return { ...synced, isNewlyCreated: false, sourceReconciled: true };
    }

    if (sourceChanged) {
      const flagged = {
        ...existing,
        sourceChangePending: true,
        sourceChangeDetails: {
          previousBibitQty: parseInt(existing.sourceBibitQty || 0, 10),
          currentBibitQty: sourceBibitQty,
          previousPolybagQty: parseInt(existing.sourcePolybagQty || 0, 10),
          currentPolybagQty: sourcePolybagQty,
          detectedAt: new Date().toISOString(),
          sourceSelectionDocNo: sourceDoc.docNo
        },
        updatedAt: new Date().toISOString()
      };
      allDocs[existingIdx] = flagged;
      storage.set(PRE_GRAFTING_SELECTION_DOC_STORAGE_KEY, allDocs);
      return { ...flagged, isNewlyCreated: false, sourceReconciled: false };
    }

    if (existing.sourceChangePending && existingExecutions.length === 0 && !existing.isCompleted && !existingIsFinal) {
      const reconciled = {
        ...existing,
        sourceChangePending: false,
        sourceChangeDetails: null,
        updatedAt: new Date().toISOString()
      };
      allDocs[existingIdx] = reconciled;
      storage.set(PRE_GRAFTING_SELECTION_DOC_STORAGE_KEY, allDocs);
      return { ...reconciled, isNewlyCreated: false, sourceReconciled: true };
    }

    return { ...existing, isNewlyCreated: false, sourceReconciled: !sourceChanged };
  }

  const baseDoc = {
    id: `SEL2-DOC-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    docNo: docNo,
    selectionDocNo: docNo,
    selectionType: SELECTION_TYPES.PRA_OKULASI,
    selectionStage: SELECTION_STAGES.SELEKSI_2,

    // Source Document Traceability ke Seleksi I FINAL
    sourceModule: 'SELEKSI',
    sourceTransactionType: 'SELEKSI_I',
    sourceSelectionStage: SELECTION_STAGES.SELEKSI_1,
    sourceSelectionType: SELECTION_TYPES.PRA_OKULASI,
    sourceSelectionDocumentId: sourceDoc.id,
    sourceSelectionDocNo: sourceDoc.docNo,
    sourceFinalStatus: SELECTION_STATUS.DISETUJUI,
    sourceFinalId: sourceDoc.id,
    sourceDocNo: sourceDoc.docNo,
    sourceSeedingDocNo: sourceDoc.sourceDocNo || sourceDoc.seedingDocNo || '-',

    // Master contexts & scope
    programId: sourceDoc.programId || sourceDoc.programCode || sourceDoc.program || 'PRG-2026-001',
    programCode: sourceDoc.programCode || sourceDoc.program || sourceDoc.programName || sourceDoc.programId || '2026/TB/RNUR/001',
    programName: sourceDoc.programName || sourceDoc.programCode || sourceDoc.program || '-',
    batchId: sourceDoc.batchId,
    batchCode: sourceDoc.batchCode || sourceDoc.batchNo,
    batchNo: sourceDoc.batchCode || sourceDoc.batchNo,
    bedenganId: sourceDoc.bedenganId || (sourceDoc.bedenganIds && sourceDoc.bedenganIds[0]) || null,
    bedenganCode: sourceDoc.bedenganCode || null,
    bedenganIds: sourceDoc.bedenganIds || [],
    bedengan: sourceDoc.bedengan || '-',
    estateId: sourceDoc.estateId || currentUser?.estateId || 'EST-TBS',
    estateName: sourceDoc.estateName || currentUser?.estateName || 'Tanah Besih',
    divisionId: sourceDoc.divisionId || currentUser?.divisionId || 'DIV-001',
    divisionName: sourceDoc.divisionName || currentUser?.divisionName || 'Tanah Besih - Divisi I',

    // Operational Actor Identity: Mewarisi identitas Mantri pelaksana dari Dokumen Seleksi I
    actorId: sourceDoc.actorId || sourceDoc.createdByUserId || sourceDoc.userId || 'TBS-MNT-001',
    actorCode: sourceDoc.actorCode || sourceDoc.createdByLoginCode || 'MNT001',
    actorName: sourceDoc.actorName || sourceDoc.createdByName || sourceDoc.mantri || 'Wagiman',
    mantri: sourceDoc.mantri || sourceDoc.actorName || sourceDoc.createdByName || 'Wagiman',
    userId: sourceDoc.userId || sourceDoc.createdByUserId || 'TBS-MNT-001',
    createdByUserId: sourceDoc.createdByUserId || sourceDoc.userId || 'TBS-MNT-001',
    createdByName: sourceDoc.createdByName || sourceDoc.mantri || sourceDoc.actorName || 'Wagiman',
    createdByRole: sourceDoc.createdByRole || ROLES.MANTRI_TANAMAN,

    // Audit Info Promosi oleh ASB
    generatedByUserId: currentUser?.userId || currentUser?.id || null,
    generatedByName: currentUser?.name || null,
    generatedByRole: currentUser?.role || null,

    klon: sourceDoc.klon || sourceDoc.clone || 'GT 1',
    clone: sourceDoc.clone || sourceDoc.klon || 'GT 1',
    tahapan: 'Rubber Main Nursery (Seleksi II)',
    growthStage: sourceDoc.growthStage || 'Rubber Main Nursery',

    rows: rows,

    // Population Quantities dari HASIL FINAL Seleksi I
    sourceBibitQty: sourceBibitQty,
    sourcePolybagQty: sourcePolybagQty,
    currentBibitQty: sourceBibitQty,
    currentPolybagQty: sourcePolybagQty,
    activePolybagQty: 0,
    emptyPolybagQty: 0,

    // Multi-session execution container
    executionTransactionIds: [],
    executionCount: 0,
    totalDiperiksa: 0,
    totalLayak: 0,
    totalAfkir: 0,

    // Lifecycle Completion & Finality
    isCompleted: false,
    isFinal: false,
    completedAt: null,
    completedByUserId: null,
    completedByName: null,

    status: 'DRAFT',
    createdAt: new Date().toISOString()
  };

  const newDoc = currentUser
    ? applyTransactionActor(baseDoc, AUDIT_EVENT_TYPES.CREATE, currentUser, `Pembuatan Dokumen Seleksi II ${docNo} dari hasil final Seleksi I ${sourceDoc.docNo}`)
    : baseDoc;

  allDocs.push(newDoc);
  storage.set(PRE_GRAFTING_SELECTION_DOC_STORAGE_KEY, allDocs);
  newDoc.isNewlyCreated = true;
  return newDoc;
}

/**
 * Memeriksa apakah Dokumen Seleksi III dapat dibuat dari Dokumen Seleksi II
 * Gate Baseline: Seleksi II harus berstatus DISETUJUI dan isFinal = true
 */
export function canCreateSelection3Document(sourceSelection2IdOrDoc) {
  const sourceDoc = typeof sourceSelection2IdOrDoc === 'object' && sourceSelection2IdOrDoc !== null
    ? sourceSelection2IdOrDoc
    : getPreGraftingSelectionDocumentById(sourceSelection2IdOrDoc);

  if (!sourceDoc) {
    return { canCreate: false, reason: 'Dokumen Seleksi II tidak ditemukan.', sourceDoc: null };
  }

  if (sourceDoc.sourceChangePending) {
    return { canCreate: false, reason: `Dokumen Seleksi II (${sourceDoc.docNo}) perlu direkonsiliasi karena saldo sumber Seleksi I berubah.`, sourceDoc };
  }

  const stage = String(sourceDoc.selectionStage || '').toUpperCase();
  if (stage !== 'SELEKSI_II' && stage !== 'SELEKSI_2') {
    return { canCreate: false, reason: 'Source dokumen bukan merupakan Dokumen Seleksi II.', sourceDoc };
  }

  // 1. Validasi Populasi Awal Polybag & Bibit (harus valid dan > 0)
  let initialBibit = parseInt(sourceDoc.sourceBibitQty !== undefined ? sourceDoc.sourceBibitQty : (sourceDoc.initialBibitQty || 0), 10);
  if ((isNaN(initialBibit) || initialBibit <= 0) && Array.isArray(sourceDoc.rows) && sourceDoc.rows.length > 0) {
    initialBibit = sourceDoc.rows.reduce((sum, r) => sum + parseInt(r.sourceBibitQty !== undefined ? r.sourceBibitQty : (r.disemai !== undefined ? r.disemai : (r.initialBibit || 0)), 10), 0);
  }

  let initialPolybag = parseInt(
    sourceDoc.sourcePolybagQty !== undefined ? sourceDoc.sourcePolybagQty : 
    (sourceDoc.activePolybagQty !== undefined ? sourceDoc.activePolybagQty : 
    (sourceDoc.initialPolybagQty !== undefined ? sourceDoc.initialPolybagQty : 
    (sourceDoc.totalPolybag !== undefined ? sourceDoc.totalPolybag : 
    (sourceDoc.polybag !== undefined ? sourceDoc.polybag : 0)))), 10
  );
  if ((isNaN(initialPolybag) || initialPolybag <= 0) && Array.isArray(sourceDoc.rows) && sourceDoc.rows.length > 0) {
    initialPolybag = sourceDoc.rows.reduce((sum, r) => sum + parseInt(r.polybag !== undefined ? r.polybag : (r.initialPolybag || r.polybagCount || 0), 10), 0);
  }
  if ((isNaN(initialPolybag) || initialPolybag <= 0) && initialBibit > 0) {
    initialPolybag = Math.ceil(initialBibit / 2);
  }

  if (isNaN(initialPolybag) || initialPolybag <= 0 || isNaN(initialBibit) || initialBibit <= 0) {
    return {
      canCreate: false,
      reason: `Populasi awal Dokumen Seleksi II (${sourceDoc.docNo}) tidak valid atau bernilai nol (Polybag: ${isNaN(initialPolybag) ? 0 : initialPolybag}, Bibit: ${isNaN(initialBibit) ? 0 : initialBibit}).`,
      sourceDoc
    };
  }

  // 2. Approval final ASB telah sah dan tersimpan
  const statusUpper = String(sourceDoc.status || '').toUpperCase();
  const verUpper = String(sourceDoc.verificationStatus || '').toUpperCase();
  const isApproved = (
    statusUpper === SELECTION_STATUS.DISETUJUI ||
    statusUpper === 'DISETUJUI' ||
    statusUpper === 'TERVERIFIKASI' ||
    verUpper === 'TERVERIFIKASI'
  );
  const isFinal = Boolean(sourceDoc.isFinal) || (isApproved && Boolean(sourceDoc.verifiedAt));

  if (!isApproved || !isFinal) {
    return {
      canCreate: false,
      reason: `Dokumen Seleksi II (${sourceDoc.docNo}) belum berstatus FINAL disetujui Asisten Bibitan (status: ${sourceDoc.status || 'DRAFT'}).`,
      sourceDoc
    };
  }

  // 3. Terdapat transaksi pemeriksaan fisik valid atau ringkasan langsung sah
  const executions = getSeleksi2ExecutionsByDocument(sourceDoc.id || sourceDoc.docNo);
  const hasDirectSummary = (sourceDoc.totalLayak !== undefined || sourceDoc.finalBibitQty !== undefined) && (sourceDoc.activePolybagQty !== undefined || sourceDoc.sourcePolybagQty !== undefined || sourceDoc.sourceBibitQty !== undefined);
  if ((!executions || executions.length === 0) && !hasDirectSummary) {
    return {
      canCreate: false,
      reason: `Dokumen Seleksi II (${sourceDoc.docNo}) belum memiliki transaksi pelaksanaan fisik lapangan.`,
      sourceDoc
    };
  }

  // 4. Validasi pemeriksaan fisik aktual dan approval seluruh child transactions
  if (executions && executions.length > 0) {
    // Seluruh child transactions harus sudah disetujui ASB
    const unapprovedTxs = executions.filter(tx => {
      const s = String(tx.status || '').toUpperCase();
      const v = String(tx.verificationStatus || '').toUpperCase();
      return s !== SELECTION_STATUS.DISETUJUI && s !== 'DISETUJUI' && s !== 'TERVERIFIKASI' && v !== 'TERVERIFIKASI' && !tx.isFinal;
    });
    if (unapprovedTxs.length > 0) {
      return {
        canCreate: false,
        reason: `Pemeriksaan Seleksi II (${sourceDoc.docNo}) memiliki transaksi yang belum disetujui final oleh ASB.`,
        sourceDoc
      };
    }

    // Ketuntasan pemeriksaan fisik 100% (sisa polybag harus nol di seluruh bedengan)
    const bedScopeList = getBedenganScopeStatusForSeleksi2(sourceDoc, executions);
    const uninspectedBeds = bedScopeList.filter(b => b.remainingPolybag > 0);
    if (uninspectedBeds.length > 0) {
      const uninspectedCodes = uninspectedBeds.map(b => b.bedenganCode || b.bedenganId).join(', ');
      return {
        canCreate: false,
        reason: `Pemeriksaan Seleksi II (${sourceDoc.docNo}) belum tuntas. Masih ada sisa polybag pada bedengan: ${uninspectedCodes}.`,
        sourceDoc
      };
    }

    // Akumulasi polybag diperiksa mencapai 100% dari populasi scope
    const totalInspectedPolybag = bedScopeList.reduce((sum, b) => sum + (b.inspectedPolybag || 0), 0);
    const totalInitialPolybag = bedScopeList.reduce((sum, b) => sum + (b.initialPolybag || 0), 0);
    if (totalInitialPolybag > 0 && totalInspectedPolybag < totalInitialPolybag) {
      return {
        canCreate: false,
        reason: `Akumulasi polybag diperiksa (${totalInspectedPolybag}) belum mencapai 100% dari populasi awal (${totalInitialPolybag}).`,
        sourceDoc
      };
    }

    // 5. Kuantitas pemeriksaan seimbang dan valid (afkir nol tetap sah)
    const totalAfkir = executions.reduce((sum, tx) => sum + getRecordedBibitSelectedQty(tx), 0);
    if (totalAfkir < 0 || totalAfkir > initialBibit) {
      return {
        canCreate: false,
        reason: `Kuantitas bibit afkir (${totalAfkir}) tidak valid atau melebihi populasi awal (${initialBibit}).`,
        sourceDoc
      };
    }
  }

  // 6. Populasi akhir bibit dan polybag dapat ditentukan secara valid
  let finalBibit = initialBibit;
  if (executions && executions.length > 0) {
    const totalAfkir = executions.reduce((sum, tx) => sum + getRecordedBibitSelectedQty(tx), 0);
    finalBibit = initialBibit - totalAfkir;
  } else if (sourceDoc.totalLayak !== undefined) {
    finalBibit = parseInt(sourceDoc.totalLayak, 10);
  } else if (sourceDoc.finalBibitQty !== undefined) {
    finalBibit = parseInt(sourceDoc.finalBibitQty, 10);
  }

  if (isNaN(finalBibit) || finalBibit < 0) {
    return {
      canCreate: false,
      reason: `Populasi bibit akhir Seleksi II tidak valid (${finalBibit}).`,
      sourceDoc
    };
  }

  return { canCreate: true, sourceDoc };
}

/**
 * Membuat Dokumen Seleksi III dari Dokumen Seleksi II yang sudah FINAL
 * Mengimplementasikan Gate, Source Traceability, dan Kuantitas Hasil Final Seleksi II
 */
export function createSelection3DocumentFromSelection2(sourceSelection2IdOrDocNo, currentUser = null, options = {}) {
  const gateCheck = canCreateSelection3Document(sourceSelection2IdOrDocNo);
  if (!gateCheck.canCreate) {
    throw new Error(`Gagal membuat Dokumen Seleksi III: ${gateCheck.reason}`);
  }

  const sourceDoc = gateCheck.sourceDoc;
  const allDocs = storage.get(PRE_GRAFTING_SELECTION_DOC_STORAGE_KEY, []);

  // Cari dokumen turunan yang sudah pernah dibuat. Snapshot draft tanpa
  // transaksi pemeriksaan akan direkonsiliasi di bawah dari sumber Seleksi II
  // terbaru; dokumen yang sudah berjalan/final tetap dilindungi.
  const existingIdx = allDocs.findIndex(d =>
    (d.selectionStage === SELECTION_STAGES.SELEKSI_3 || d.selectionStage === 'SELEKSI_III' || d.selectionStage === 'SELEKSI_3') &&
    (d.sourceSelectionDocumentId === sourceDoc.id || d.sourceSelectionDocNo === sourceDoc.docNo || d.sourceDocNo === sourceDoc.docNo)
  );
  const existing = existingIdx >= 0 ? allDocs[existingIdx] : null;

  // Generate Dokumen Seleksi III No (Format: 2026/SEL-III/001)
  let maxSeq = 0;
  allDocs.forEach(d => {
    if (d.selectionStage === SELECTION_STAGES.SELEKSI_3 || d.selectionStage === 'SELEKSI_III' || d.selectionStage === 'SELEKSI_3') {
      const docStr = String(d.docNo || d.selectionDocNo || '');
      const match = docStr.match(/SEL-III\/(\d+)/i) || docStr.match(/(\d+)$/);
      if (match) {
        const n = parseInt(match[1], 10);
        if (!isNaN(n) && n > maxSeq) maxSeq = n;
      }
    }
  });

  const nextSeq = maxSeq + 1;
  const docNo = options.docNo || formatStandardDocNo(2026, 'SEL-III', nextSeq);

  const executions = getSeleksi2ExecutionsByDocument(sourceDoc.id || sourceDoc.docNo);

  // Kuantitas awal Seleksi III diambil dari saldo akhir sah Seleksi II
  // Formula Wajib: Populasi Tahap Berikutnya = Populasi Awal Tahap Sebelumnya - Total Afkir Valid Tahap Sebelumnya
  // Dilarang keras menjumlahkan snapshot saldo transaksi (seperti sum(actualBibitRetainedQty))
  let initialBibit = parseInt(sourceDoc.sourceBibitQty !== undefined ? sourceDoc.sourceBibitQty : (sourceDoc.initialBibitQty || 0), 10);
  if ((isNaN(initialBibit) || initialBibit <= 0) && Array.isArray(sourceDoc.rows) && sourceDoc.rows.length > 0) {
    initialBibit = sourceDoc.rows.reduce((sum, r) => sum + parseInt(r.sourceBibitQty !== undefined ? r.sourceBibitQty : (r.disemai !== undefined ? r.disemai : (r.initialBibit || 0)), 10), 0);
  }

  let sourceBibitQty = 0;
  if (executions && executions.length > 0) {
    const totalAfkir = executions.reduce((sum, tx) => sum + getRecordedBibitSelectedQty(tx), 0);
    sourceBibitQty = Math.max(0, initialBibit - totalAfkir);
  } else if (sourceDoc.totalLayak !== undefined) {
    sourceBibitQty = parseInt(sourceDoc.totalLayak, 10);
  } else if (sourceDoc.finalBibitQty !== undefined) {
    sourceBibitQty = parseInt(sourceDoc.finalBibitQty, 10);
  } else if (sourceDoc.currentBibitQty !== undefined) {
    sourceBibitQty = parseInt(sourceDoc.currentBibitQty, 10);
  } else {
    sourceBibitQty = initialBibit;
  }

  // Polybag source Seleksi III = Polybag AKTIF dari HASIL FINAL Seleksi II
  let sourcePolybagQty = 0;
  if (sourceDoc.activePolybagQty !== undefined && sourceDoc.activePolybagQty !== null && !isNaN(sourceDoc.activePolybagQty) && parseInt(sourceDoc.activePolybagQty, 10) > 0) {
    sourcePolybagQty = parseInt(sourceDoc.activePolybagQty, 10);
  } else if (executions && executions.length > 0) {
    const bedScopeList = getBedenganScopeStatusForSeleksi2(sourceDoc, executions);
    const totalInitPoly = bedScopeList.reduce((sum, b) => sum + (b.initialPolybag || 0), 0);
    const totalActiveFromTxs = executions.reduce((sum, tx) => {
      if (tx.actualPolybagActiveQty !== undefined && !isNaN(parseInt(tx.actualPolybagActiveQty, 10))) {
        return sum + parseInt(tx.actualPolybagActiveQty, 10);
      }
      if (tx.activePolybagQty !== undefined && !isNaN(parseInt(tx.activePolybagQty, 10))) {
        return sum + parseInt(tx.activePolybagQty, 10);
      }
      return sum;
    }, 0);
    if (totalActiveFromTxs > 0 && totalActiveFromTxs <= totalInitPoly) {
      sourcePolybagQty = totalActiveFromTxs;
    } else if (totalInitPoly > 0) {
      sourcePolybagQty = totalInitPoly;
    }
  }
  if (sourcePolybagQty === 0) {
    sourcePolybagQty = parseInt(sourceDoc.currentPolybagQty !== undefined ? sourceDoc.currentPolybagQty : (sourceDoc.sourcePolybagQty || 0), 10);
  }
  if (sourcePolybagQty === 0 && Array.isArray(sourceDoc.rows) && sourceDoc.rows.length > 0) {
    sourcePolybagQty = sourceDoc.rows.reduce((sum, r) => sum + parseInt(r.polybag !== undefined ? r.polybag : (r.initialPolybag || r.polybagCount || 0), 10), 0);
  }

  // Build rows / bedengan breakdown dari Seleksi II secara proporsional dan akurat
  let rows = [];
  const finalBedScope = getBedenganScopeStatusForSeleksi2(sourceDoc, executions);
  if (finalBedScope.length > 0) {
    rows = finalBedScope.map(bed => {
      const bedBibit = Math.max(0, Number(bed.maintainedBibit || 0));
      const bedPolybag = Math.max(0, Number(bed.inspectedPolybag || bed.initialPolybag || 0));
      return {
        bedenganId: bed.bedenganId || bed.bedenganCode,
        bedenganCode: formatBedenganDisplayCode(bed.bedenganCode || bed.bedenganId),
        polybag: bedPolybag,
        disemai: bedBibit,
        sourceBibitQty: bedBibit
      };
    });
  } else if (Array.isArray(sourceDoc.rows) && sourceDoc.rows.length > 0) {
    const sourceBedScope = getBedenganScopeStatusForSeleksi2(sourceDoc, executions);
    rows = sourceDoc.rows.map(r => {
      const bCode = formatBedenganDisplayCode(r.bedenganCode || r.bedengan || r.bedenganId);
      const bTxs = executions.filter(tx => formatBedenganDisplayCode(tx.bedenganCode || tx.bedengan).toUpperCase() === bCode.toUpperCase());
      const scopedBed = sourceBedScope.find(b => formatBedenganDisplayCode(b.bedenganCode || b.bedenganId).toUpperCase() === bCode.toUpperCase());
      const bInitialBibit = Number(scopedBed?.initialBibit || resolveSelectionRowBibitQty(r, sourceDoc.rows.length === 1 ? initialBibit : 0));
      const bInitialPoly = parseInt(r.polybag !== undefined ? r.polybag : (r.initialPolybag !== undefined ? r.initialPolybag : (r.polybagCount !== undefined ? r.polybagCount : (sourceDoc.rows.length === 1 ? sourcePolybagQty : 0))), 10);

      // Hitung afkir sah pada bedengan ini (BUKAN sum snapshot retained!)
      const bAfkir = bTxs.reduce((sum, tx) => sum + getRecordedBibitSelectedQty(tx), 0);
      let allocatedBibit = bTxs.length > 0 ? Math.max(0, bInitialBibit - bAfkir) : bInitialBibit;
      if (allocatedBibit === 0 && sourceDoc.rows.length === 1 && sourceBibitQty > 0) {
        allocatedBibit = sourceBibitQty;
      }

      // Hitung polybag aktif bedengan
      let allocatedPoly = bInitialPoly;
      if (bTxs.length > 0) {
        const bActivePolySum = bTxs.reduce((sum, tx) => {
          if (tx.actualPolybagActiveQty !== undefined && !isNaN(parseInt(tx.actualPolybagActiveQty, 10))) {
            return sum + parseInt(tx.actualPolybagActiveQty, 10);
          }
          if (tx.activePolybagQty !== undefined && !isNaN(parseInt(tx.activePolybagQty, 10))) {
            return sum + parseInt(tx.activePolybagQty, 10);
          }
          return sum;
        }, 0);
        if (bActivePolySum > 0 && bActivePolySum <= bInitialPoly) {
          allocatedPoly = bActivePolySum;
        }
      }
      if (allocatedPoly === 0 && sourceDoc.rows.length === 1 && sourcePolybagQty > 0) {
        allocatedPoly = sourcePolybagQty;
      }

      return {
        bedenganId: r.bedenganId || r.bedenganCode || bCode,
        bedenganCode: bCode,
        polybag: allocatedPoly,
        disemai: allocatedBibit,
        sourceBibitQty: allocatedBibit
      };
    });
  } else {
    rows = [{
      bedenganId: sourceDoc.bedenganId || 'BED-001',
      bedenganCode: formatBedenganDisplayCode(sourceDoc.bedenganCode || sourceDoc.bedengan || 'BED-001'),
      polybag: sourcePolybagQty,
      disemai: sourceBibitQty,
      sourceBibitQty: sourceBibitQty
    }];
  }

  const baseDoc = {
    id: `SEL3-DOC-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    docNo: docNo,
    selectionDocNo: docNo,
    selectionType: SELECTION_TYPES.PRA_OKULASI,
    selectionStage: SELECTION_STAGES.SELEKSI_3,

    // Source Document Traceability ke Seleksi II FINAL & Hulu
    sourceModule: 'SELEKSI',
    sourceTransactionType: 'SELEKSI_II',
    sourceSelectionStage: SELECTION_STAGES.SELEKSI_2,
    sourceSelectionType: SELECTION_TYPES.PRA_OKULASI,
    sourceSelectionDocumentId: sourceDoc.id,
    sourceSelectionDocNo: sourceDoc.docNo,
    sourceFinalStatus: SELECTION_STATUS.DISETUJUI,
    sourceFinalId: sourceDoc.id,
    sourceDocNo: sourceDoc.docNo,
    sourceSelection1DocNo: sourceDoc.sourceSelectionDocNo || sourceDoc.sourceDocNo || '-',
    sourceSeedingDocNo: sourceDoc.sourceSeedingDocNo || sourceDoc.seedingDocNo || '-',

    // Master contexts & scope
    programId: sourceDoc.programId || sourceDoc.programCode || sourceDoc.program || 'PRG-2026-001',
    programCode: sourceDoc.programCode || sourceDoc.program || sourceDoc.programName || sourceDoc.programId || '2026/TB/RNUR/001',
    programName: sourceDoc.programName || sourceDoc.programCode || sourceDoc.program || '-',
    batchId: sourceDoc.batchId,
    batchCode: sourceDoc.batchCode || sourceDoc.batchNo,
    batchNo: sourceDoc.batchCode || sourceDoc.batchNo,
    bedenganId: sourceDoc.bedenganId || (sourceDoc.bedenganIds && sourceDoc.bedenganIds[0]) || null,
    bedenganCode: sourceDoc.bedenganCode || null,
    bedenganIds: sourceDoc.bedenganIds || [],
    bedengan: sourceDoc.bedengan || '-',
    estateId: sourceDoc.estateId || currentUser?.estateId || 'EST-TBS',
    estateName: sourceDoc.estateName || currentUser?.estateName || 'Tanah Besih',
    divisionId: sourceDoc.divisionId || currentUser?.divisionId || 'DIV-001',
    divisionName: sourceDoc.divisionName || currentUser?.divisionName || 'Tanah Besih - Divisi I',

    // Operational Actor Identity: Mewarisi identitas Mantri pelaksana dari Dokumen Seleksi II
    actorId: sourceDoc.actorId || sourceDoc.createdByUserId || sourceDoc.userId || 'TBS-MNT-001',
    actorCode: sourceDoc.actorCode || sourceDoc.createdByLoginCode || 'MNT001',
    actorName: sourceDoc.actorName || sourceDoc.createdByName || sourceDoc.mantri || 'Wagiman',
    mantri: sourceDoc.mantri || sourceDoc.actorName || sourceDoc.createdByName || 'Wagiman',
    userId: sourceDoc.userId || sourceDoc.createdByUserId || 'TBS-MNT-001',
    createdByUserId: sourceDoc.createdByUserId || sourceDoc.userId || 'TBS-MNT-001',
    createdByName: sourceDoc.createdByName || sourceDoc.mantri || sourceDoc.actorName || 'Wagiman',
    createdByRole: sourceDoc.createdByRole || ROLES.MANTRI_TANAMAN,

    // Audit Info Promosi oleh ASB
    generatedByUserId: currentUser?.userId || currentUser?.id || null,
    generatedByName: currentUser?.name || null,
    generatedByRole: currentUser?.role || null,

    klon: sourceDoc.klon || sourceDoc.clone || 'GT 1',
    clone: sourceDoc.clone || sourceDoc.klon || 'GT 1',
    tahapan: 'Rubber Main Nursery',
    growthStage: sourceDoc.growthStage || 'Rubber Main Nursery',

    rows: rows,

    // Population Quantities dari HASIL FINAL Seleksi II
    sourceBibitQty: sourceBibitQty,
    sourcePolybagQty: sourcePolybagQty,
    currentBibitQty: sourceBibitQty,
    currentPolybagQty: sourcePolybagQty,
    activePolybagQty: 0,
    emptyPolybagQty: 0,

    // Multi-session execution container (ready for future task)
    executionTransactionIds: [],
    executionCount: 0,
    totalDiperiksa: 0,
    totalLayak: 0,
    totalAfkir: 0,

    // Lifecycle Completion & Finality
    isCompleted: false,
    isFinal: false,
    completedAt: null,
    completedByUserId: null,
    completedByName: null,

    status: 'DRAFT',
    createdAt: new Date().toISOString()
  };

  if (existing) {
    const existingExecutions = getSeleksi3ExecutionsByDocument(existing.id || existing.docNo);
    const existingStatus = String(existing.status || '').toUpperCase();
    const hasPendingVerification = ['MENUNGGU_VERIFIKASI', 'DIAJUKAN', 'PENDING_ASB', 'READY_TO_CONFIRM'].includes(existingStatus) ||
      ['MENUNGGU_VERIFIKASI', 'PENDING', 'PENDING_ASB', 'READY_TO_CONFIRM'].includes(String(existing.verificationStatus || '').toUpperCase());
    const canRefreshDraftSnapshot = existingExecutions.length === 0 &&
      !existing.isFinal && !existing.verifiedAt && !hasPendingVerification &&
      ['DRAFT', 'IN_PROGRESS'].includes(existingStatus);

    if (!canRefreshDraftSnapshot) {
      return { ...existing, isNewlyCreated: false };
    }

    const refreshedDoc = {
      ...existing,
      ...baseDoc,
      id: existing.id,
      docNo: existing.docNo,
      selectionDocNo: existing.selectionDocNo || existing.docNo,
      createdAt: existing.createdAt || baseDoc.createdAt,
      status: existing.status || 'DRAFT',
      updatedAt: new Date().toISOString()
    };
    allDocs[existingIdx] = currentUser
      ? applyTransactionActor(refreshedDoc, AUDIT_EVENT_TYPES.UPDATE, currentUser, `Sinkronisasi saldo dan bedengan Seleksi III dari hasil final Seleksi II ${sourceDoc.docNo}`)
      : refreshedDoc;
    storage.set(PRE_GRAFTING_SELECTION_DOC_STORAGE_KEY, allDocs);
    return { ...allDocs[existingIdx], isNewlyCreated: false, sourceRefreshed: true };
  }

  const newDoc = currentUser
    ? applyTransactionActor(baseDoc, AUDIT_EVENT_TYPES.CREATE, currentUser, `Pembuatan Dokumen Seleksi III ${docNo} dari hasil final Seleksi II ${sourceDoc.docNo}`)
    : baseDoc;

  allDocs.push(newDoc);
  storage.set(PRE_GRAFTING_SELECTION_DOC_STORAGE_KEY, allDocs);
  newDoc.isNewlyCreated = true;
  return newDoc;
}

/**
 * Mencari Dokumen Seleksi Pra-Okulasi berdasarkan ID, Dokumen No, atau Source Doc No
 */
export function getPreGraftingSelectionDocumentById(idOrDocNo) {
  if (!idOrDocNo) return null;
  const allDocs = storage.get(PRE_GRAFTING_SELECTION_DOC_STORAGE_KEY, []);
  const searchStr = String(idOrDocNo).trim();
  const exact = allDocs.find(d => 
    d.id === searchStr || 
    d.docNo === searchStr || 
    d.selectionDocNo === searchStr
  );
  if (exact) return exact;
  return allDocs.find(d => 
    (d.batchId && (String(d.batchId).trim() === searchStr || String(d.batchCode).trim() === searchStr)) ||
    (d.batchCode && (String(d.batchCode).trim() === searchStr || String(d.batchNo).trim() === searchStr)) ||
    (Array.isArray(d.sourceSeedingDocNos) && d.sourceSeedingDocNos.includes(searchStr)) ||
    d.sourceSeedingDocNo === searchStr ||
    d.seedingDocNo === searchStr ||
    d.sourceDocNo === searchStr || 
    d.sourceSelectionDocNo === searchStr ||
    d.sourceTransactionId === searchStr
  ) || null;
}

/**
 * Memeriksa apakah pengguna memiliki role Mantri
 */
export function isMantriRole(currentUser) {
  if (!currentUser) return false;
  const role = normalizeRole(currentUser.role || currentUser.rawRole);
  return (
    role === ROLES.MANTRI_TANAMAN ||
    role === 'MANTRI_TANAMAN' ||
    role === 'MANTRI' ||
    role === 'MANTRI_BIBITAN' ||
    (currentUser.position && String(currentUser.position).toLowerCase().includes('mantri'))
  );
}

/**
 * Menghitung metrik agregat, balance, progress, dan status Dokumen Seleksi III
 */
export function getSeleksi3Metrics(doc, customExecutions = null) {
  if (!doc) {
    return {
      totalPopulasi: 0,
      totalPolybagDiperiksa: 0,
      totalBibitDiperiksa: 0,
      totalBibitDiseleksi: 0,
      totalBibitLayak: 0,
      totalBibitReject: 0,
      totalActivePolybag: 0,
      isOneToOne: true,
      belumDiklasifikasikan: 0,
      balanceValid: true,
      sisaPemeriksaan: 0,
      sisaPolybag: 0,
      pemeriksaanSelesai: false,
      seleksiValidUntukSelesai: false,
      progress: 0,
      status: 'Belum Dimulai'
    };
  }

  const executions = customExecutions || getSeleksi3ExecutionsByDocument(doc.id || doc.docNo);
  const totalPopulasi = parseInt(doc.sourcePolybagQty !== undefined ? doc.sourcePolybagQty : (doc.sourceBibitQty || 0), 10);
  const sourceBibit = parseInt(doc.sourceBibitQty !== undefined ? doc.sourceBibitQty : totalPopulasi, 10);

  const totalPolybagDiperiksa = executions.reduce((sum, tx) => sum + parseInt(tx.actualPolybagInspectedQty !== undefined ? tx.actualPolybagInspectedQty : (tx.polybagScope !== undefined ? tx.polybagScope : (tx.actualPolybagActiveQty !== undefined ? tx.actualPolybagActiveQty : (tx.initialPolybagCount || 0))), 10), 0);
  const totalBibitDiseleksi = executions.reduce((sum, tx) => sum + getRecordedBibitSelectedQty(tx), 0);
  const totalBibitDiperiksa = totalBibitDiseleksi;
  const totalBibitReject = totalBibitDiseleksi;
  const totalBibitLayak = Math.max(0, sourceBibit - totalBibitDiseleksi);
  const totalActivePolybag = totalPolybagDiperiksa;

  const sisaPemeriksaan = Math.max(0, totalPopulasi - totalPolybagDiperiksa);
  const pemeriksaanSelesai = totalPopulasi > 0 && totalPolybagDiperiksa === totalPopulasi;
  const balanceValid = true;
  const belumDiklasifikasikan = 0;
  const isOneToOne = true;
  const seleksiValidUntukSelesai = pemeriksaanSelesai && sisaPemeriksaan === 0;
  const progress = totalPopulasi > 0 ? Math.min(100, Math.max(0, Math.round((totalPolybagDiperiksa / totalPopulasi) * 100))) : 0;

  let status = 'Belum Dimulai';
  if (doc.status === SELECTION_STATUS.DISETUJUI && doc.isFinal) {
    status = 'Disetujui';
  } else if (doc.status === SELECTION_STATUS.DIKEMBALIKAN) {
    status = 'Dikembalikan';
  } else if (doc.status === SELECTION_STATUS.MENUNGGU_VERIFIKASI || doc.status === 'DIAJUKAN') {
    status = 'Menunggu Verifikasi';
  } else if (executions.length === 0) {
    status = 'Belum Dimulai';
  } else if (totalPolybagDiperiksa < totalPopulasi) {
    status = 'Sedang Diperiksa';
  } else if (seleksiValidUntukSelesai) {
    status = 'COMPLETED';
  }

  return {
    totalPopulasi,
    totalPolybagDiperiksa,
    totalBibitDiperiksa,
    totalBibitDiseleksi,
    totalBibitLayak,
    totalBibitReject,
    totalBibitDipertahankan: totalBibitLayak,
    totalDiperiksa: totalPolybagDiperiksa,
    totalLayak: totalBibitLayak,
    totalAfkir: totalBibitReject,
    remainingPolybag: sisaPemeriksaan,
    sisaPolybag: sisaPemeriksaan,
    sisaBibit: Math.max(0, sourceBibit - totalBibitDiseleksi),
    totalActivePolybag,
    isOneToOne,
    belumDiklasifikasikan,
    balanceValid,
    sisaPemeriksaan,
    pemeriksaanSelesai,
    seleksiValidUntukSelesai,
    progress,
    status
  };
}

/**
 * Validasi kelayakan completion Dokumen Seleksi Pra-Okulasi sebelum dinyatakan selesai / diajukan ke Asisten
 */
export function validatePreGraftingSelectionCompletion(idOrDocNo) {
  const doc = getPreGraftingSelectionDocumentById(idOrDocNo);
  const errors = [];
  if (!doc) {
    return { isValid: false, errors: ['Dokumen Seleksi Pra-Okulasi tidak ditemukan.'], doc: null, childTransactions: [] };
  }
  if (doc.sourceChangePending) {
    return { isValid: false, errors: [`Dokumen ${doc.docNo} belum dapat diselesaikan karena saldo sumber Seleksi I berubah dan perlu direkonsiliasi.`], doc, childTransactions: [] };
  }

  const isStage3 = (
    doc.selectionStage === SELECTION_STAGES.SELEKSI_3 ||
    doc.selectionStage === 'SELEKSI_III' ||
    doc.selectionStage === 'SELEKSI_3'
  );

  const isStage2 = (
    doc.selectionStage === SELECTION_STAGES.SELEKSI_2 ||
    doc.selectionStage === 'SELEKSI_II' ||
    doc.selectionStage === 'SELEKSI_2'
  );

  const childTxs = isStage3
    ? getSeleksi3ExecutionsByDocument(doc.id || doc.docNo)
    : (isStage2 
        ? getSeleksi2ExecutionsByDocument(doc.id || doc.docNo)
        : getSeleksi1ExecutionsByDocument(doc.id || doc.docNo));

  const stageLabel = isStage3 ? 'Seleksi III' : (isStage2 ? 'Seleksi II' : 'Seleksi I');

  if (childTxs.length === 0) {
    errors.push(`Dokumen ${doc.docNo} belum memiliki transaksi pelaksanaan ${stageLabel}. Minimal harus ada 1 transaksi sebelum dinyatakan selesai.`);
  }

  const sourcePolybag = parseInt(doc.sourcePolybagQty !== undefined ? doc.sourcePolybagQty : 0, 10);
  const totalPolyDiperiksa = childTxs.reduce((sum, tx) => sum + parseInt(tx.actualPolybagInspectedQty !== undefined ? tx.actualPolybagInspectedQty : (tx.polybagScope !== undefined ? tx.polybagScope : (tx.actualPolybagActiveQty !== undefined ? tx.actualPolybagActiveQty : (tx.initialPolybagCount || 0))), 10), 0);
  const sisaPolybag = Math.max(0, sourcePolybag - totalPolyDiperiksa);

  if (sourcePolybag > 0 && (sisaPolybag > 0 || totalPolyDiperiksa < sourcePolybag)) {
    errors.push(`Dokumen ${doc.docNo} belum selesai diperiksa. Masih terdapat ${sisaPolybag.toLocaleString('id-ID')} polybag yang belum diperiksa (${totalPolyDiperiksa.toLocaleString('id-ID')} dari ${sourcePolybag.toLocaleString('id-ID')} polybag).`);
  }

  childTxs.forEach(tx => {
    const pInspected = parseInt(tx.actualPolybagInspectedQty !== undefined ? tx.actualPolybagInspectedQty : (tx.polybagScope !== undefined ? tx.polybagScope : (tx.actualPolybagActiveQty !== undefined ? tx.actualPolybagActiveQty : (tx.initialPolybagCount || 0))), 10);
    if (isNaN(pInspected) || pInspected <= 0) {
      errors.push(`Transaksi ${tx.docNo} memiliki jumlah polybag tidak valid.`);
    }
  });

  return {
    isValid: errors.length === 0,
    valid: errors.length === 0,
    errors,
    message: errors.join(' '),
    doc,
    childTransactions: childTxs
  };
}

/**
 * Mengatur status completion Dokumen Seleksi Pra-Okulasi secara manual oleh Mantri
 */
export function setPreGraftingSelectionDocumentCompletion(idOrDocNo, isCompleted, currentUser = null) {
  if (currentUser) {
    const role = normalizeRole(currentUser.role || currentUser.rawRole);
    if (role !== ROLES.MANTRI_TANAMAN && !isMantriRole(currentUser)) {
      throw new Error('Hanya Mantri Bibitan yang berwenang menyatakan penyelesaian Dokumen Seleksi.');
    }
  }

  const allDocs = storage.get(PRE_GRAFTING_SELECTION_DOC_STORAGE_KEY, []);
  const searchStr = String(idOrDocNo).trim();
  const idx = allDocs.findIndex(d => 
    d.id === searchStr || 
    d.docNo === searchStr || 
    d.selectionDocNo === searchStr ||
    d.sourceDocNo === searchStr ||
    d.sourceTransactionId === searchStr
  );

  if (idx === -1) {
    throw new Error(`Dokumen seleksi pra-okulasi dengan identitas ${idOrDocNo} tidak ditemukan.`);
  }

  const target = allDocs[idx];
  const flag = Boolean(isCompleted);

  if (flag) {
    const val = validatePreGraftingSelectionCompletion(target.id);
    if (!val.isValid) {
      throw new Error(val.errors.join(' '));
    }
  }

  const isStage3 = (
    target.selectionStage === SELECTION_STAGES.SELEKSI_3 ||
    target.selectionStage === 'SELEKSI_III' ||
    target.selectionStage === 'SELEKSI_3'
  );

  const isStage2 = (
    target.selectionStage === SELECTION_STAGES.SELEKSI_2 ||
    target.selectionStage === 'SELEKSI_II' ||
    target.selectionStage === 'SELEKSI_2'
  );
  const childExecCount = isStage3
    ? getSeleksi3ExecutionsByDocument(target.id).length
    : (isStage2 
        ? getSeleksi2ExecutionsByDocument(target.id).length 
        : getSeleksi1ExecutionsByDocument(target.id).length);

  const updated = {
    ...target,
    isCompleted: flag,
    completedAt: flag ? new Date().toISOString() : null,
    completedByUserId: flag ? (currentUser?.userId || currentUser?.code || currentUser?.id || 'MANTRI') : null,
    completedByName: flag ? (currentUser?.name || 'Mantri Bibitan') : null,
    status: flag 
      ? (target.status === SELECTION_STATUS.MENUNGGU_VERIFIKASI || target.status === SELECTION_STATUS.DISETUJUI ? target.status : 'COMPLETED') 
      : ((target.executionCount > 0 || childExecCount > 0) ? 'IN_PROGRESS' : 'DRAFT'),
    updatedAt: new Date().toISOString()
  };

  allDocs[idx] = currentUser 
    ? applyTransactionActor(updated, AUDIT_EVENT_TYPES.UPDATE, currentUser, `Pembaruan status selesai dokumen seleksi ${target.docNo}: ${flag ? 'SELESAI' : 'BELUM SELESAI'}`)
    : updated;

  storage.set(PRE_GRAFTING_SELECTION_DOC_STORAGE_KEY, allDocs);
  return allDocs[idx];
}

/**
 * Pengiriman Dokumen Seleksi Pra-Okulasi dari Verifikasi Data Mantri ke Asisten Bibitan
 */
export function submitPreGraftingSelectionDocumentToAsisten(idOrDocNo, currentUser) {
  if (currentUser) {
    const role = normalizeRole(currentUser.role || currentUser.rawRole);
    if (role !== ROLES.MANTRI_TANAMAN && !isMantriRole(currentUser)) {
      throw new Error('Hanya Mantri Bibitan yang berhak mengirim Dokumen Seleksi ke Asisten Bibitan.');
    }
  }

  const val = validatePreGraftingSelectionCompletion(idOrDocNo);
  if (!val.isValid) {
    throw new Error(val.errors.join(' '));
  }

  const targetDoc = val.doc;
  const allDocs = storage.get(PRE_GRAFTING_SELECTION_DOC_STORAGE_KEY, []);
  const docIdx = allDocs.findIndex(d => d.id === targetDoc.id);
  if (docIdx === -1) {
    throw new Error(`Dokumen ${idOrDocNo} tidak ditemukan.`);
  }

  const isStage3 = (
    targetDoc.selectionStage === SELECTION_STAGES.SELEKSI_3 ||
    targetDoc.selectionStage === 'SELEKSI_III' ||
    targetDoc.selectionStage === 'SELEKSI_3'
  );

  const isStage2 = (
    targetDoc.selectionStage === SELECTION_STAGES.SELEKSI_2 ||
    targetDoc.selectionStage === 'SELEKSI_II' ||
    targetDoc.selectionStage === 'SELEKSI_2'
  );
  const stageLabel = isStage3 ? 'Seleksi III' : (isStage2 ? 'Seleksi II' : 'Seleksi I');

  const nowIso = new Date().toISOString();
  const updatedDoc = applyTransactionActor(
    {
      ...targetDoc,
      status: SELECTION_STATUS.MENUNGGU_VERIFIKASI,
      submittedAt: nowIso,
      submittedByUserId: currentUser?.userId || currentUser?.code || currentUser?.id || 'MANTRI',
      submittedByName: currentUser?.name || 'Mantri Bibitan',
      submittedByRole: 'MANTRI_TANAMAN',
      updatedAt: nowIso
    },
    AUDIT_EVENT_TYPES.SUBMIT,
    currentUser,
    `Pengajuan Dokumen ${stageLabel} ${targetDoc.docNo} ke Asisten Bibitan`
  );

  allDocs[docIdx] = updatedDoc;
  storage.set(PRE_GRAFTING_SELECTION_DOC_STORAGE_KEY, allDocs);

  // Update seluruh child transactions menjadi MENUNGGU_VERIFIKASI
  const allTxs = storage.get(SELECTION_STORAGE_KEY, []);
  let txsModified = false;
  allTxs.forEach(tx => {
    if (
      tx.selectionDocumentId === targetDoc.id ||
      tx.parentSelectionDocumentId === targetDoc.id ||
      tx.selectionDocNo === targetDoc.docNo ||
      tx.parentSelectionDocNo === targetDoc.docNo
    ) {
      tx.status = SELECTION_STATUS.MENUNGGU_VERIFIKASI;
      tx.updatedAt = nowIso;
      txsModified = true;
    }
  });

  if (txsModified) {
    storage.set(SELECTION_STORAGE_KEY, allTxs);
  }

  // Sinkronkan ke verification_transactions agar ASB langsung melihat status MENUNGGU_VERIFIKASI
  const allVerifs = storage.get('verification_transactions', []);
  const vIdx = allVerifs.findIndex(v =>
    (String(v.referenceId) === String(targetDoc.id) || String(v.referenceDocNo) === String(targetDoc.docNo)) &&
    (v.referenceType === 'SELEKSI_PRA_OKULASI' || v.referenceType === 'SELECTION')
  );
  if (vIdx !== -1) {
    allVerifs[vIdx].referenceType = 'SELEKSI_PRA_OKULASI';
    allVerifs[vIdx].verificationStatus = 'MENUNGGU_VERIFIKASI';
    allVerifs[vIdx].returnReason = null;
    allVerifs[vIdx].submittedAt = nowIso;
    allVerifs[vIdx].submittedByUserId = currentUser?.userId || currentUser?.code || currentUser?.id || 'MANTRI';
    allVerifs[vIdx].submittedByName = currentUser?.name || 'Mantri Bibitan';
    allVerifs[vIdx].updatedAt = nowIso;
  } else {
    allVerifs.push({
      verificationId: `VRF-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      verificationNo: `VRF-2026-${Date.now().toString().slice(-4)}`,
      referenceType: 'SELEKSI_PRA_OKULASI',
      referenceId: targetDoc.id,
      referenceDocNo: targetDoc.docNo,
      estateId: targetDoc.estateId || currentUser?.estateId,
      divisionId: targetDoc.divisionId || currentUser?.divisionId,
      verificationStatus: 'MENUNGGU_VERIFIKASI',
      returnReason: null,
      submittedAt: nowIso,
      submittedByUserId: currentUser?.userId || currentUser?.code || currentUser?.id || 'MANTRI',
      submittedByName: currentUser?.name || 'Mantri Bibitan',
      createdAt: nowIso,
      updatedAt: nowIso
    });
  }
  storage.set('verification_transactions', allVerifs);

  return updatedDoc;
}

/**
 * Persetujuan (Approve) Dokumen Seleksi Pra-Okulasi oleh Asisten Bibitan
 * Menjadikan hasil Dokumen Seleksi (I, II, atau III) bersifat FINAL
 */
export function approvePreGraftingSelectionDocument(idOrDocNo, notes = '', currentUser) {
  if (!currentUser) throw new Error('Pengguna aktif tidak valid.');
  const role = normalizeRole(currentUser.role || currentUser.rawRole);
  if (role !== ROLES.ASISTEN_BIBITAN) {
    throw new Error('Hanya Asisten Bibitan yang berhak menyetujui Dokumen Seleksi.');
  }

  const allDocs = storage.get(PRE_GRAFTING_SELECTION_DOC_STORAGE_KEY, []);
  const searchStr = String(idOrDocNo).trim();
  const idx = allDocs.findIndex(d => 
    d.id === searchStr || 
    d.docNo === searchStr || 
    d.selectionDocNo === searchStr ||
    d.sourceDocNo === searchStr
  );

  if (idx === -1) {
    throw new Error(`Dokumen Seleksi Pra-Okulasi ${idOrDocNo} tidak ditemukan.`);
  }

  const target = allDocs[idx];
  if (!canPerformAsistenSelectionAction(target, currentUser)) {
    throw new Error('Anda tidak memiliki otorisasi untuk menyetujui dokumen ini.');
  }
  if (target.sourceChangePending) {
    throw new Error(`Dokumen ${target.docNo} belum dapat disetujui karena saldo sumber Seleksi I berubah dan perlu direkonsiliasi.`);
  }

  const isStage3 = (
    target.selectionStage === SELECTION_STAGES.SELEKSI_3 ||
    target.selectionStage === 'SELEKSI_III' ||
    target.selectionStage === 'SELEKSI_3'
  );

  const isStage2 = (
    target.selectionStage === SELECTION_STAGES.SELEKSI_2 ||
    target.selectionStage === 'SELEKSI_II' ||
    target.selectionStage === 'SELEKSI_2'
  );
  const stageLabel = isStage3 ? 'Seleksi III' : (isStage2 ? 'Seleksi II' : 'Seleksi I');

  // Validasi ketuntasan pemeriksaan sebelum persetujuan ASB
  const executions = (isStage3 ? getSeleksi3ExecutionsByDocument(target.id || target.docNo) : (isStage2 ? getSeleksi2ExecutionsByDocument(target.id || target.docNo) : getSeleksi1ExecutionsByDocument(target.id || target.docNo))) || [];
  const sourcePoly = parseInt(target.sourcePolybagQty || 0, 10);
  const hasDirectSummary = (target.totalLayak !== undefined || target.finalBibitQty !== undefined) && (target.activePolybagQty !== undefined || target.sourcePolybagQty !== undefined || target.sourceBibitQty !== undefined);

  if (executions.length === 0 && sourcePoly > 0 && !hasDirectSummary) {
    throw new Error(`Dokumen ${stageLabel} (${target.docNo}) tidak dapat disetujui karena belum memiliki transaksi pemeriksaan fisik lapangan.`);
  }

  if (executions.length > 0 && sourcePoly > 0) {
    const stageNorm = String(target.selectionStage || '').toUpperCase();
    const bedScopeList = (stageNorm === 'SELEKSI_II' || stageNorm === 'SELEKSI_2')
      ? getBedenganScopeStatusForSeleksi2(target, executions)
      : (stageNorm === 'SELEKSI_III' || stageNorm === 'SELEKSI_3')
        ? getBedenganScopeStatusForSeleksi3(target, executions)
        : getBedenganScopeStatusForSeleksi1(target, executions);

    const uninspectedBeds = bedScopeList.filter(b => b.remainingPolybag > 0);
    if (uninspectedBeds.length > 0) {
      const uninspectedCodes = uninspectedBeds.map(b => b.bedenganCode || b.bedenganId).join(', ');
      throw new Error(`Dokumen ${stageLabel} (${target.docNo}) belum tuntas diperiksa. Masih ada sisa polybag pada bedengan: ${uninspectedCodes}.`);
    }

    const totalPolyDiperiksa = executions.reduce((sum, tx) => sum + parseInt(tx.actualPolybagInspectedQty !== undefined ? tx.actualPolybagInspectedQty : (tx.polybagScope || 0), 10), 0);
    if (totalPolyDiperiksa < sourcePoly) {
      throw new Error(`Dokumen ${stageLabel} (${target.docNo}) belum tuntas diperiksa (${totalPolyDiperiksa.toLocaleString('id-ID')} dari ${sourcePoly.toLocaleString('id-ID')} polybag).`);
    }
  }

  const nowIso = new Date().toISOString();
  const updatedDoc = applyTransactionActor(
    {
      ...target,
      status: SELECTION_STATUS.DISETUJUI,
      isFinal: true,
      verificationStatus: 'TERVERIFIKASI',
      finalBibitQty: target.totalLayak !== undefined ? target.totalLayak : target.currentBibitQty,
      finalPolybagQty: target.activePolybagQty !== undefined ? target.activePolybagQty : target.sourcePolybagQty,
      activePolybagQty: target.activePolybagQty !== undefined ? target.activePolybagQty : (target.currentPolybagQty || 0),
      emptyPolybagQty: target.emptyPolybagQty !== undefined ? target.emptyPolybagQty : 0,
      verifiedByUserId: currentUser.userId || currentUser.code || currentUser.id,
      verifiedByName: currentUser.name || 'Asisten Bibitan',
      verifiedByRole: ROLES.ASISTEN_BIBITAN,
      verifiedAt: nowIso,
      approvalNotes: notes || 'Disetujui oleh Asisten Bibitan',
      updatedAt: nowIso
    },
    AUDIT_EVENT_TYPES.APPROVE,
    currentUser,
    `Persetujuan final Dokumen ${stageLabel} ${target.docNo} oleh Asisten Bibitan`
  );

  allDocs[idx] = updatedDoc;
  storage.set(PRE_GRAFTING_SELECTION_DOC_STORAGE_KEY, allDocs);

  // Update child transactions status
  const allTxs = storage.get(SELECTION_STORAGE_KEY, []);
  let txsModified = false;
  allTxs.forEach(tx => {
    if (
      tx.selectionDocumentId === target.id ||
      tx.parentSelectionDocumentId === target.id ||
      tx.selectionDocNo === target.docNo ||
      tx.parentSelectionDocNo === target.docNo ||
      tx.sourceDocNo === target.docNo ||
      tx.sourceTransactionId === target.id
    ) {
      tx.status = SELECTION_STATUS.DISETUJUI;
      tx.isFinal = true;
      tx.verificationStatus = 'TERVERIFIKASI';
      tx.verifiedByUserId = currentUser.userId || currentUser.code || currentUser.id;
      tx.verifiedByName = currentUser.name || 'Asisten Bibitan';
      tx.verifiedAt = nowIso;
      tx.approvalNotes = notes || 'Disetujui oleh Asisten Bibitan';
      tx.updatedAt = nowIso;
      txsModified = true;
    }
  });

  if (txsModified) {
    storage.set(SELECTION_STORAGE_KEY, allTxs);
  }

  // Record audit trail di verification_transactions (ZERO STOCK MUTATION)
  const allVerifs = storage.get('verification_transactions', []);
  const matchingIndices = [];
  allVerifs.forEach((v, idx) => {
    const isDocMatch = (
      String(v.referenceId) === String(target.id) ||
      String(v.referenceDocNo) === String(target.docNo) ||
      (v.parentSelectionDocNo && v.parentSelectionDocNo === target.docNo) ||
      allTxs.some(tx => (
        (tx.parentSelectionDocNo === target.docNo || tx.sourceDocNo === target.docNo || tx.selectionDocNo === target.docNo) &&
        (String(v.referenceId) === String(tx.id) || String(v.referenceDocNo) === String(tx.docNo))
      ))
    );
    const isTypeMatch = (
      v.referenceType === 'SELEKSI_PRA_OKULASI' ||
      v.referenceType === 'SELECTION' ||
      v.referenceType === 'PENYELEKSIAN'
    );
    if (isDocMatch && isTypeMatch) {
      matchingIndices.push(idx);
    }
  });

  if (matchingIndices.length > 0) {
    matchingIndices.forEach(idx => {
      allVerifs[idx].referenceType = 'SELEKSI_PRA_OKULASI';
      allVerifs[idx].verificationStatus = 'TERVERIFIKASI';
      allVerifs[idx].notes = (notes || '').trim();
      allVerifs[idx].returnReason = null;
      allVerifs[idx].verifiedByUserId = currentUser.userId || currentUser.code || currentUser.id;
      allVerifs[idx].verifiedByName = currentUser.name || 'Asisten Bibitan';
      allVerifs[idx].verifiedByRole = ROLES.ASISTEN_BIBITAN;
      allVerifs[idx].verifiedAt = nowIso;
      allVerifs[idx].updatedAt = nowIso;
    });
  } else {
    allVerifs.push({
      verificationId: `VRF-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      verificationNo: `VRF-2026-${Date.now().toString().slice(-4)}`,
      referenceType: 'SELEKSI_PRA_OKULASI',
      referenceId: target.id,
      referenceDocNo: target.docNo,
      estateId: target.estateId || currentUser.estateId,
      divisionId: target.divisionId || currentUser.divisionId,
      verificationStatus: 'TERVERIFIKASI',
      notes: (notes || '').trim(),
      returnReason: null,
      verifiedByUserId: currentUser.userId || currentUser.code || currentUser.id,
      verifiedByName: currentUser.name || 'Asisten Bibitan',
      verifiedByRole: ROLES.ASISTEN_BIBITAN,
      verifiedAt: nowIso,
      createdAt: nowIso,
      updatedAt: nowIso
    });
  }
  storage.set('verification_transactions', allVerifs);

  // Trigger otomatis downstream document generation saat final approval
  try {
    const stageNorm = String(updatedDoc.selectionStage || '').toUpperCase();
    if (stageNorm === 'SELEKSI_I' || stageNorm === 'SELEKSI_1' || stageNorm === SELECTION_STAGES.SELEKSI_1) {
      createSelection2DocumentFromSelection1(updatedDoc, currentUser);
    } else if (stageNorm === 'SELEKSI_II' || stageNorm === 'SELEKSI_2' || stageNorm === SELECTION_STAGES.SELEKSI_2) {
      createSelection3DocumentFromSelection2(updatedDoc, currentUser);
    }
  } catch (genErr) {
    console.warn('[approvePreGraftingSelectionDocument] Downstream generation notice:', genErr.message);
  }

  return updatedDoc;
}

/**
 * Pengembalian (Return) Dokumen Seleksi Pra-Okulasi oleh Asisten Bibitan ke Mantri
 */
export function returnPreGraftingSelectionDocument(idOrDocNo, returnReason, currentUser) {
  if (!currentUser) throw new Error('Pengguna aktif tidak valid.');
  const role = normalizeRole(currentUser.role || currentUser.rawRole);
  if (role !== ROLES.ASISTEN_BIBITAN) {
    throw new Error('Hanya Asisten Bibitan yang berhak mengembalikan Dokumen Seleksi.');
  }

  if (!returnReason || !returnReason.trim()) {
    throw new Error('Alasan pengembalian wajib diisi.');
  }

  const allDocs = storage.get(PRE_GRAFTING_SELECTION_DOC_STORAGE_KEY, []);
  const searchStr = String(idOrDocNo).trim();
  const idx = allDocs.findIndex(d => 
    d.id === searchStr || 
    d.docNo === searchStr || 
    d.selectionDocNo === searchStr ||
    d.sourceDocNo === searchStr
  );

  if (idx === -1) {
    throw new Error(`Dokumen Seleksi Pra-Okulasi ${idOrDocNo} tidak ditemukan.`);
  }

  const target = allDocs[idx];
  if (!canPerformAsistenSelectionAction(target, currentUser)) {
    throw new Error('Anda tidak memiliki otorisasi untuk mengembalikan dokumen ini.');
  }

  const isStage3 = (
    target.selectionStage === SELECTION_STAGES.SELEKSI_3 ||
    target.selectionStage === 'SELEKSI_III' ||
    target.selectionStage === 'SELEKSI_3'
  );

  const isStage2 = (
    target.selectionStage === SELECTION_STAGES.SELEKSI_2 ||
    target.selectionStage === 'SELEKSI_II' ||
    target.selectionStage === 'SELEKSI_2'
  );
  const stageLabel = isStage3 ? 'Seleksi III' : (isStage2 ? 'Seleksi II' : 'Seleksi I');

  const nowIso = new Date().toISOString();
  const updatedDoc = applyTransactionActor(
    {
      ...target,
      status: SELECTION_STATUS.DIKEMBALIKAN,
      isFinal: false,
      isCompleted: false, // Dikembalikan ke Mantri untuk perbaikan / penambahan sesi
      verificationStatus: 'DIKEMBALIKAN',
      returnReason: returnReason.trim(),
      returnedByUserId: currentUser.userId || currentUser.code || currentUser.id,
      returnedByName: currentUser.name || 'Asisten Bibitan',
      returnedByRole: ROLES.ASISTEN_BIBITAN,
      returnedAt: nowIso,
      updatedAt: nowIso
    },
    AUDIT_EVENT_TYPES.REJECT,
    currentUser,
    `Pengembalian Dokumen ${stageLabel} ${target.docNo} ke Mantri: ${returnReason.trim()}`
  );

  allDocs[idx] = updatedDoc;
  storage.set(PRE_GRAFTING_SELECTION_DOC_STORAGE_KEY, allDocs);

  // Update child transactions status
  const allTxs = storage.get(SELECTION_STORAGE_KEY, []);
  let txsModified = false;
  allTxs.forEach(tx => {
    if (
      tx.selectionDocumentId === target.id ||
      tx.parentSelectionDocumentId === target.id ||
      tx.selectionDocNo === target.docNo ||
      tx.parentSelectionDocNo === target.docNo
    ) {
      tx.status = SELECTION_STATUS.DIKEMBALIKAN;
      tx.returnReason = returnReason.trim();
      tx.returnedByUserId = currentUser.userId || currentUser.code || currentUser.id;
      tx.returnedByName = currentUser.name;
      tx.returnedAt = nowIso;
      tx.updatedAt = nowIso;
      txsModified = true;
    }
  });

  if (txsModified) {
    storage.set(SELECTION_STORAGE_KEY, allTxs);
  }

  // Record audit trail di verification_transactions
  const allVerifs = storage.get('verification_transactions', []);
  const existVerifIdx = allVerifs.findIndex(v =>
    (String(v.referenceId) === String(target.id) || String(v.referenceDocNo) === String(target.docNo)) &&
    (v.referenceType === 'SELEKSI_PRA_OKULASI' || v.referenceType === 'SELECTION')
  );
  if (existVerifIdx !== -1) {
    allVerifs[existVerifIdx].referenceType = 'SELEKSI_PRA_OKULASI';
    allVerifs[existVerifIdx].verificationStatus = 'DIKEMBALIKAN';
    allVerifs[existVerifIdx].returnReason = returnReason.trim();
    allVerifs[existVerifIdx].verifiedByUserId = currentUser.userId || currentUser.code || currentUser.id;
    allVerifs[existVerifIdx].verifiedByName = currentUser.name || 'Asisten Bibitan';
    allVerifs[existVerifIdx].verifiedByRole = ROLES.ASISTEN_BIBITAN;
    allVerifs[existVerifIdx].verifiedAt = nowIso;
    allVerifs[existVerifIdx].updatedAt = nowIso;
  } else {
    allVerifs.push({
      verificationId: `VRF-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      verificationNo: `VRF-2026-${Date.now().toString().slice(-4)}`,
      referenceType: 'SELEKSI_PRA_OKULASI',
      referenceId: target.id,
      referenceDocNo: target.docNo,
      estateId: target.estateId || currentUser.estateId,
      divisionId: target.divisionId || currentUser.divisionId,
      verificationStatus: 'DIKEMBALIKAN',
      returnReason: returnReason.trim(),
      verifiedByUserId: currentUser.userId || currentUser.code || currentUser.id,
      verifiedByName: currentUser.name || 'Asisten Bibitan',
      verifiedByRole: ROLES.ASISTEN_BIBITAN,
      verifiedAt: nowIso,
      createdAt: nowIso,
      updatedAt: nowIso
    });
  }
  storage.set('verification_transactions', allVerifs);

  return updatedDoc;
}

/**
 * Return only one physical Seleksi I/II/III execution for correction.
 * The rejected row is kept on the parent audit trail and removed from the
 * active execution set so only its inspected scope becomes available again.
 */
export function returnPreGraftingSelectionExecution(parentIdOrDocNo, executionIdOrDocNo, returnReason, currentUser) {
  if (!currentUser) throw new Error('Pengguna aktif tidak valid.');
  if (normalizeRole(currentUser.role || currentUser.rawRole) !== ROLES.ASISTEN_BIBITAN) {
    throw new Error('Hanya Asisten Bibitan yang berhak mengembalikan sesi pemeriksaan.');
  }
  if (!returnReason || !returnReason.trim()) throw new Error('Alasan pengembalian wajib diisi.');

  const docs = storage.get(PRE_GRAFTING_SELECTION_DOC_STORAGE_KEY, []);
  const docIdx = docs.findIndex(doc => doc && (
    doc.id === String(parentIdOrDocNo) || doc.docNo === String(parentIdOrDocNo)
  ));
  if (docIdx < 0) throw new Error(`Dokumen Seleksi Pra-Okulasi ${parentIdOrDocNo} tidak ditemukan.`);

  const parent = docs[docIdx];
  if (!canPerformAsistenSelectionAction(parent, currentUser)) {
    throw new Error('Dokumen ini tidak sedang menunggu tindakan Asisten Bibitan.');
  }

  const stage = String(parent.selectionStage || parent.stage || '').toUpperCase();
  const isStage3 = stage === 'SELEKSI_III' || stage === 'SELEKSI_3';
  const isStage2 = stage === 'SELEKSI_II' || stage === 'SELEKSI_2';
  const stageLabel = isStage3 ? 'Seleksi III' : (isStage2 ? 'Seleksi II' : 'Seleksi I');
  const getExecutions = isStage3 ? getSeleksi3ExecutionsByDocument : (isStage2 ? getSeleksi2ExecutionsByDocument : getSeleksi1ExecutionsByDocument);
  const activeExecutions = getExecutions(parent.id || parent.docNo);
  const execution = activeExecutions.find(tx => tx.id === String(executionIdOrDocNo) || tx.docNo === String(executionIdOrDocNo));
  if (!execution) throw new Error(`Sesi pemeriksaan ${executionIdOrDocNo} tidak ditemukan pada dokumen ${parent.docNo}.`);
  if (execution.isFinal || String(execution.status || '').toUpperCase() === 'DISETUJUI' || String(execution.verificationStatus || '').toUpperCase() === 'TERVERIFIKASI') {
    throw new Error('Sesi yang sudah disetujui final tidak dapat dikembalikan.');
  }

  const reason = returnReason.trim();
  const nowIso = new Date().toISOString();
  const { photoData, photoEvidence, photos, ...executionAuditFields } = execution;
  const auditEntry = {
    ...executionAuditFields,
    status: SELECTION_STATUS.DIKEMBALIKAN,
    verificationStatus: 'DIKEMBALIKAN',
    returnReason: reason,
    returnedByUserId: currentUser.userId || currentUser.code || currentUser.id,
    returnedByName: currentUser.name || 'Asisten Bibitan',
    returnedAt: nowIso,
    correctionStatus: 'OPEN'
  };

  const allTxs = storage.get(SELECTION_STORAGE_KEY, []);
  const txIdx = allTxs.findIndex(tx => tx.id === execution.id);
  if (txIdx < 0) throw new Error(`Sesi pemeriksaan ${execution.docNo || execution.id} tidak ditemukan.`);
  allTxs.splice(txIdx, 1);
  storage.set(SELECTION_STORAGE_KEY, allTxs);
  cleanupPreGraftingExecutionFromSelectionPool(execution.id, execution.docNo);

  const remainingExecutions = getExecutions(parent.id || parent.docNo);
  const sourcePolybag = parseInt(parent.sourcePolybagQty || 0, 10);
  const sourceBibit = parseInt(parent.sourceBibitQty !== undefined ? parent.sourceBibitQty : (parent.batchTotalBibit || parent.initialBibit || sourcePolybag), 10);
  const totalPolybag = remainingExecutions.reduce((sum, tx) => sum + parseInt(tx.actualPolybagInspectedQty !== undefined ? tx.actualPolybagInspectedQty : (tx.polybagScope || tx.initialPolybagCount || 0), 10), 0);
  const totalAfkir = remainingExecutions.reduce((sum, tx) => sum + getRecordedBibitSelectedQty(tx), 0);
  const correctionLabel = `Sesi ${execution.docNo || execution.id} (${execution.bedenganCode || execution.bedengan || '-'}) dikembalikan: ${reason}`;
  const updatedParent = applyTransactionActor({
    ...parent,
    status: SELECTION_STATUS.DIKEMBALIKAN,
    isFinal: false,
    isCompleted: false,
    verificationStatus: 'DIKEMBALIKAN',
    returnReason: correctionLabel,
    correctionExecutionId: execution.id,
    correctionBedenganCode: execution.bedenganCode || execution.bedengan || null,
    returnedExecutionHistory: [...(Array.isArray(parent.returnedExecutionHistory) ? parent.returnedExecutionHistory : []), auditEntry],
    executionTransactionIds: remainingExecutions.map(tx => tx.id),
    executionCount: remainingExecutions.length,
    totalDiperiksa: totalPolybag,
    totalPolybagDiperiksa: totalPolybag,
    totalBibitDiseleksi: totalAfkir,
    totalBibitSelectedQty: totalAfkir,
    totalBibitRetainedQty: Math.max(0, sourceBibit - totalAfkir),
    totalLayak: Math.max(0, sourceBibit - totalAfkir),
    totalAfkir,
    totalReject: totalAfkir,
    activePolybagQty: totalPolybag,
    currentBibitQty: Math.max(0, sourceBibit - totalAfkir),
    currentPolybagQty: totalPolybag,
    remainingPolybag: Math.max(0, sourcePolybag - totalPolybag),
    sisaPolybag: Math.max(0, sourcePolybag - totalPolybag),
    sisaBibit: Math.max(0, sourceBibit - totalAfkir),
    progress: sourcePolybag > 0 ? Math.min(100, Math.round((totalPolybag / sourcePolybag) * 100)) : 0,
    returnedByUserId: currentUser.userId || currentUser.code || currentUser.id,
    returnedByName: currentUser.name || 'Asisten Bibitan',
    returnedAt: nowIso,
    updatedAt: nowIso
  }, AUDIT_EVENT_TYPES.REJECT, currentUser, `Pengembalian sesi ${execution.docNo || execution.id} pada ${stageLabel} ${parent.docNo}: ${reason}`);
  docs[docIdx] = updatedParent;
  storage.set(PRE_GRAFTING_SELECTION_DOC_STORAGE_KEY, docs);

  // Keep any existing CULL declaration linked to the returned session visibly
  // in revision too; the parent verification row drives the Mantri red dot.
  const cullIds = new Set();
  allTxs.forEach(tx => {
    if (tx.sourceTransactionId !== execution.id || !isCullDocNo(tx.docNo || tx.selectionNo || tx.selectionPoolDocNo)) return;
    tx.status = SELECTION_STATUS.DIKEMBALIKAN;
    tx.verificationStatus = 'DIKEMBALIKAN';
    tx.returnReason = correctionLabel;
    tx.updatedAt = nowIso;
    cullIds.add(String(tx.id));
  });
  if (cullIds.size) storage.set(SELECTION_STORAGE_KEY, allTxs);

  const verifs = storage.get('verification_transactions', []);
  const parentVerif = verifs.find(v =>
    String(v.referenceId) === String(parent.id) || String(v.referenceDocNo) === String(parent.docNo)
  );
  if (parentVerif) {
    parentVerif.referenceType = 'SELEKSI_PRA_OKULASI';
    parentVerif.verificationStatus = 'DIKEMBALIKAN';
    parentVerif.returnReason = correctionLabel;
    parentVerif.verifiedByUserId = currentUser.userId || currentUser.code || currentUser.id;
    parentVerif.verifiedByName = currentUser.name || 'Asisten Bibitan';
    parentVerif.verifiedAt = nowIso;
    parentVerif.updatedAt = nowIso;
  } else {
    verifs.push({
      verificationId: `VRF-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      verificationNo: `VRF-2026-${Date.now().toString().slice(-4)}`,
      referenceType: 'SELEKSI_PRA_OKULASI',
      referenceId: parent.id,
      referenceDocNo: parent.docNo,
      estateId: parent.estateId || currentUser.estateId,
      divisionId: parent.divisionId || currentUser.divisionId,
      verificationStatus: 'DIKEMBALIKAN',
      returnReason: correctionLabel,
      verifiedByUserId: currentUser.userId || currentUser.code || currentUser.id,
      verifiedByName: currentUser.name || 'Asisten Bibitan',
      verifiedByRole: ROLES.ASISTEN_BIBITAN,
      verifiedAt: nowIso,
      createdAt: nowIso,
      updatedAt: nowIso
    });
  }
  cullIds.forEach(id => {
    const cull = allTxs.find(tx => String(tx.id) === id);
    const row = verifs.find(v => String(v.referenceId) === id || String(v.referenceDocNo) === String(cull?.docNo));
    if (row) {
      row.verificationStatus = 'DIKEMBALIKAN';
      row.returnReason = correctionLabel;
      row.updatedAt = nowIso;
    }
  });
  storage.set('verification_transactions', verifs);

  return updatedParent;
}

/**
 * Migrasi Dokumen Seleksi I Legacy Agregat menjadi Batch + Bedengan Scope
 * Memecah dokumen agregat tanpa menghapus history dan me-reassign child transactions
 */
export function migrateLegacyAggregateSelection1Documents() {
  const allDocs = storage.get(PRE_GRAFTING_SELECTION_DOC_STORAGE_KEY, []);
  const allTxs = storage.get(SELECTION_STORAGE_KEY, []);
  let migratedCount = 0;

  // Temukan dokumen Seleksi I agregat (memiliki multi-bedengan atau multi-SOW)
  const legacyDocs = allDocs.filter(d => {
    const isStage1 = (d.selectionStage === 'SELEKSI_I' || d.selectionStage === 'SELEKSI_1' || !d.selectionStage);
    if (!isStage1) return false;
    if (d.isSplit || d.isLegacyAggregateSplit) return false;

    const hasMultiBedRows = Array.isArray(d.rows) && d.rows.length > 1;
    const hasMultiBedIds = Array.isArray(d.bedenganIds) && d.bedenganIds.length > 1;
    const hasCommaBed = typeof d.bedengan === 'string' && d.bedengan.includes(',');
    const hasMultiSow = Array.isArray(d.sourceSeedingDocNos) && d.sourceSeedingDocNos.length > 1;

    return hasMultiBedRows || hasMultiBedIds || hasCommaBed || hasMultiSow;
  });

  if (legacyDocs.length === 0) {
    return { migratedCount: 0, legacyDocsCount: 0 };
  }

  // Hitung nomor urut tertinggi untuk dokumen baru (Format: 2026/SEL/xxx)
  let maxSeq = 0;
  allDocs.forEach(d => {
    const docStr = String(d.docNo || d.selectionDocNo || '');
    const match = docStr.match(/SEL(?:-DOC)?\/(\d+)/i) || docStr.match(/^(\d+)$/);
    if (match) {
      const n = parseInt(match[1], 10);
      if (!isNaN(n) && n > maxSeq) maxSeq = n;
    }
  });

  legacyDocs.forEach(legDoc => {
    let bedengans = [];
    if (Array.isArray(legDoc.rows) && legDoc.rows.length > 0) {
      bedengans = legDoc.rows.map(r => ({
        bedenganId: r.bedenganId || r.bedenganCode || r.bedengan,
        bedenganCode: formatBedenganDisplayCode(r.bedenganCode || r.bedengan || r.bedenganId),
        polybag: parseInt(r.polybag !== undefined ? r.polybag : Math.ceil((r.disemai || 0) / 2), 10),
        disemai: parseInt(r.disemai || 0, 10),
        sourceSeedingDocNo: r.seedingDocNo || r.sourceSeedingDocNo || r.sourceDocNo || legDoc.sourceSeedingDocNo || legDoc.sourceDocNo,
        sourceTransactionId: r.sourceTransactionId || legDoc.sourceTransactionId
      }));
    } else if (Array.isArray(legDoc.bedenganIds) && legDoc.bedenganIds.length > 0) {
      const polyPerBed = Math.floor((legDoc.sourcePolybagQty || 0) / legDoc.bedenganIds.length);
      bedengans = legDoc.bedenganIds.map((bId, idx) => ({
        bedenganId: bId,
        bedenganCode: formatBedenganDisplayCode(bId),
        polybag: polyPerBed,
        disemai: polyPerBed * 2,
        sourceSeedingDocNo: (Array.isArray(legDoc.sourceSeedingDocNos) && legDoc.sourceSeedingDocNos[idx]) || legDoc.sourceSeedingDocNo || legDoc.sourceDocNo,
        sourceTransactionId: legDoc.sourceTransactionId
      }));
    }

    const createdTargetIds = [];

    bedengans.forEach(bed => {
      maxSeq++;
      const newDocNo = `2026/SEL/${String(maxSeq).padStart(3, '0')}`;
      const splitDocId = `SEL-DOC-SPLIT-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

      const splitDoc = {
        ...legDoc,
        id: splitDocId,
        docNo: newDocNo,
        selectionDocNo: newDocNo,
        selectionStage: SELECTION_STAGES.SELEKSI_1,
        legacyParentDocNo: legDoc.docNo,
        legacyParentDocId: legDoc.id,
        bedenganId: bed.bedenganId,
        bedenganCode: bed.bedenganCode,
        bedengan: bed.bedenganCode,
        bedenganIds: [bed.bedenganId],
        sourceSeedingDocNo: bed.sourceSeedingDocNo || legDoc.sourceDocNo,
        sourceDocNo: bed.sourceSeedingDocNo || legDoc.sourceDocNo,
        seedingDocNo: bed.sourceSeedingDocNo || legDoc.sourceDocNo,
        sourceSeedingDocNos: [bed.sourceSeedingDocNo || legDoc.sourceDocNo],
        sourceTransactionId: bed.sourceTransactionId || legDoc.sourceTransactionId,
        rows: [{
          bedenganId: bed.bedenganId,
          bedenganCode: bed.bedenganCode,
          polybag: bed.polybag,
          disemai: bed.disemai,
          sourceSeedingDocNo: bed.sourceSeedingDocNo || legDoc.sourceDocNo,
          sourceTransactionId: bed.sourceTransactionId || legDoc.sourceTransactionId,
          batchId: legDoc.batchId,
          batchCode: legDoc.batchCode
        }],
        sourcePolybagQty: bed.polybag,
        currentPolybagQty: bed.polybag,
        sourceBibitQty: bed.disemai || (bed.polybag * 2),
        currentBibitQty: bed.disemai || (bed.polybag * 2),
        batchTotalBibit: legDoc.sourceBibitQty || legDoc.batchTotalBibit,
        executionTransactionIds: [],
        executionCount: 0,
        totalDiperiksa: 0,
        totalLayak: 0,
        totalAfkir: 0,
        isCompleted: false,
        status: 'DRAFT',
        createdAt: legDoc.createdAt || new Date().toISOString()
      };

      // Re-assign child execution transactions matching this bedengan
      const normBedCode = formatBedenganDisplayCode(bed.bedenganCode).toUpperCase();
      const matchingTxs = allTxs.filter(tx => {
        const isChildOfLegacy = (
          tx.parentSelectionDocumentId === legDoc.id ||
          tx.selectionDocumentId === legDoc.id ||
          tx.parentSelectionDocNo === legDoc.docNo ||
          tx.selectionDocNo === legDoc.docNo
        );
        if (!isChildOfLegacy) return false;
        const txBed = formatBedenganDisplayCode(tx.bedenganCode || tx.bedengan || tx.bedenganId || '').toUpperCase();
        return txBed === normBedCode;
      });

      matchingTxs.forEach(tx => {
        tx.parentSelectionDocumentId = splitDoc.id;
        tx.parentSelectionDocNo = splitDoc.docNo;
        tx.selectionDocumentId = splitDoc.id;
        tx.selectionDocNo = splitDoc.docNo;
        tx.bedenganId = bed.bedenganId;
        tx.bedenganCode = bed.bedenganCode;
        tx.sourceSeedingDocNo = bed.sourceSeedingDocNo || tx.sourceSeedingDocNo || legDoc.sourceDocNo;
      });

      // Recalculate metrics from re-assigned executions
      if (matchingTxs.length > 0) {
        const polyDone = matchingTxs.reduce((sum, tx) => sum + parseInt(tx.actualPolybagInspectedQty !== undefined ? tx.actualPolybagInspectedQty : (tx.polybagScope || 0), 10), 0);
        const bibitAfkir = matchingTxs.reduce((sum, tx) => sum + getRecordedBibitSelectedQty(tx), 0);
        splitDoc.executionTransactionIds = matchingTxs.map(t => t.id);
        splitDoc.executionCount = matchingTxs.length;
        splitDoc.totalDiperiksa = polyDone;
        splitDoc.totalAfkir = bibitAfkir;
        splitDoc.totalLayak = Math.max(0, splitDoc.sourceBibitQty - bibitAfkir);
        splitDoc.remainingPolybag = Math.max(0, splitDoc.sourcePolybagQty - polyDone);
        splitDoc.isCompleted = splitDoc.sourcePolybagQty > 0 && polyDone >= splitDoc.sourcePolybagQty;
        splitDoc.status = splitDoc.isCompleted ? 'COMPLETED' : 'IN_PROGRESS';
      }

      // Re-link downstream Selection II documents if matching
      allDocs.forEach(d2 => {
        if (d2.selectionStage === 'SELEKSI_II' || d2.selectionStage === 'SELEKSI_2') {
          if (d2.sourceSelectionDocumentId === legDoc.id || d2.sourceSelectionDocNo === legDoc.docNo) {
            const d2Bed = formatBedenganDisplayCode(d2.bedenganCode || d2.bedengan || '').toUpperCase();
            if (d2Bed === normBedCode) {
              d2.sourceSelectionDocumentId = splitDoc.id;
              d2.sourceSelectionDocNo = splitDoc.docNo;
            }
          }
        }
      });

      allDocs.push(splitDoc);
      createdTargetIds.push(splitDoc.id);
      migratedCount++;
    });

    // Mark legacy document as split / migrated without deleting history
    legDoc.isLegacyAggregate = true;
    legDoc.isSplit = true;
    legDoc.isLegacyAggregateSplit = true;
    legDoc.splitTargetDocIds = createdTargetIds;
    legDoc.migratedAt = new Date().toISOString();
  });

  storage.set(PRE_GRAFTING_SELECTION_DOC_STORAGE_KEY, allDocs);
  storage.set(SELECTION_STORAGE_KEY, allTxs);

  return { migratedCount, legacyDocsCount: legacyDocs.length };
}

/**
 * Sinkronisasi seluruh transaksi penyemaian ke Dokumen Seleksi Pra-Okulasi secara idempoten
 */
export function syncAllSeedingsToPreGraftingSelectionDocuments(currentUser = null) {
  // Lakukan auto-migrasi dokumen legacy agregat jika ada
  try {
    migrateLegacyAggregateSelection1Documents();
  } catch (mErr) {
    console.warn('[syncAllSeedingsToPreGraftingSelectionDocuments] Migrasi legacy note:', mErr.message);
  }

  const seedingTxs = storage.get('seeding_transactions', []);
  let createdCount = 0;

  seedingTxs.forEach(tx => {
    try {
      if (tx.isDeleted || tx.deleted || tx.status === 'DELETED') return;

      // Sync dokumen kontainer Seleksi I untuk seluruh transaksi Pindah Semai yang valid.
      // Dokumen dibuat dalam status DRAFT untuk visibilitas operasional batch,
      // tanpa membuat transaksi pemeriksaan palsu. Eksekusi fisik tetap terkunci
      // oleh canPerformPreGraftingSelection1 sampai SOW & CULL disetujui ASB.
      const res = createPreGraftingSelectionDocument(tx, currentUser, { skipGateCheck: true });
      if (res && res.isNewlyCreated) {
        createdCount++;
      }
    } catch (err) {
      console.warn(`[syncAllSeedingsToPreGraftingSelectionDocuments] Skip ${tx.docNo}:`, err.message);
    }
  });

  return createdCount;
}

/**
 * Sinkronisasi seluruh Dokumen Seleksi Pra-Okulasi yang sudah FINAL disetujui
 * ke Dokumen Seleksi downstream (Seleksi I -> Seleksi II, Seleksi II -> Seleksi III) secara idempoten
 */
export function syncAllApprovedPreGraftingSelectionDocuments(currentUser = null) {
  let allDocs = storage.get(PRE_GRAFTING_SELECTION_DOC_STORAGE_KEY, []);
  let syncedCount = 0;
  let docsModified = false;

  // Auto-heal existing Seleksi II / Seleksi III documents agar selalu mewarisi identitas Mantri pelaksana dari parent doc
  allDocs.forEach((doc, idx) => {
    const stageNorm = String(doc.selectionStage || '').toUpperCase();
    if (stageNorm === 'SELEKSI_II' || stageNorm === 'SELEKSI_2' || stageNorm === 'SELEKSI_III' || stageNorm === 'SELEKSI_3') {
      const sourceDocId = doc.sourceSelectionDocumentId || doc.sourceFinalId;
      const sourceDoc = sourceDocId ? allDocs.find(d => d.id === sourceDocId || d.docNo === doc.sourceSelectionDocNo || d.docNo === doc.sourceDocNo) : null;
      if (sourceDoc) {
        const needsActorHeal = !doc.actorName || !doc.mantri || (doc.createdByRole && doc.createdByRole === 'ASISTEN_BIBITAN' && sourceDoc.createdByName);
        if (needsActorHeal) {
          doc.actorId = sourceDoc.actorId || sourceDoc.createdByUserId || 'TBS-MNT-001';
          doc.actorCode = sourceDoc.actorCode || sourceDoc.createdByLoginCode || 'MNT001';
          doc.actorName = sourceDoc.actorName || sourceDoc.createdByName || sourceDoc.mantri || 'Wagiman';
          doc.mantri = sourceDoc.mantri || sourceDoc.actorName || sourceDoc.createdByName || 'Wagiman';
          doc.userId = sourceDoc.userId || sourceDoc.createdByUserId || 'TBS-MNT-001';
          doc.createdByUserId = sourceDoc.createdByUserId || 'TBS-MNT-001';
          doc.createdByName = sourceDoc.createdByName || sourceDoc.mantri || 'Wagiman';
          doc.createdByRole = sourceDoc.createdByRole || ROLES.MANTRI_TANAMAN;
          allDocs[idx] = doc;
          docsModified = true;
        }
      }
    }
  });

  // 1. Rekonsiliasi Seleksi I FINAL -> Promosi status parent doc
  allDocs.forEach((doc, idx) => {
    const stageNorm = String(doc.selectionStage || '').toUpperCase();
    const isStage1 = (stageNorm === 'SELEKSI_I' || stageNorm === 'SELEKSI_1' || stageNorm === SELECTION_STAGES.SELEKSI_1);
    if (!isStage1 || doc.isSplit || doc.isLegacyAggregateSplit) return;

    let isApproved = String(doc.status || '').toUpperCase() === SELECTION_STATUS.DISETUJUI ||
                     String(doc.verificationStatus || '').toUpperCase() === 'TERVERIFIKASI' ||
                     String(doc.status || '').toUpperCase() === 'TERVERIFIKASI';
    let isFinal = Boolean(doc.isFinal) || (isApproved && Boolean(doc.verifiedAt));

    // Auto-promote jika seluruh child transactions pelaksanaan sudah disetujui final oleh ASB dan pemeriksaan fisik 100% tuntas
    if (!isApproved || !isFinal) {
      const executions = getSeleksi1ExecutionsByDocument(doc.id || doc.docNo);
      if (executions.length > 0 && executions.every(t => String(t.status || '').toUpperCase() === SELECTION_STATUS.DISETUJUI || String(t.verificationStatus || '').toUpperCase() === 'TERVERIFIKASI' || t.isFinal === true)) {
        const bedScopeList = getBedenganScopeStatusForSeleksi1(doc, executions);
        const hasUninspected = bedScopeList.some(b => b.remainingPolybag > 0);
        if (!hasUninspected && bedScopeList.length > 0) {
          doc.status = SELECTION_STATUS.DISETUJUI;
          doc.isFinal = true;
          allDocs[idx] = doc;
          docsModified = true;
        }
      }
    }
  });

  if (docsModified) {
    storage.set(PRE_GRAFTING_SELECTION_DOC_STORAGE_KEY, allDocs);
  }

  // 1b. Buat Dokumen Seleksi II untuk setiap Dokumen Seleksi I yang sudah FINAL
  allDocs.forEach((doc) => {
    const stageNorm = String(doc.selectionStage || '').toUpperCase();
    const isStage1 = (stageNorm === 'SELEKSI_I' || stageNorm === 'SELEKSI_1' || stageNorm === SELECTION_STAGES.SELEKSI_1);
    if (!isStage1 || doc.isSplit || doc.isLegacyAggregateSplit) return;

    const isApproved = String(doc.status || '').toUpperCase() === SELECTION_STATUS.DISETUJUI ||
                       String(doc.verificationStatus || '').toUpperCase() === 'TERVERIFIKASI' ||
                       String(doc.status || '').toUpperCase() === 'TERVERIFIKASI';
    const isFinal = Boolean(doc.isFinal) || isApproved;

    if (isApproved && isFinal) {
      try {
        const res = createSelection2DocumentFromSelection1(doc, currentUser);
        if (res && res.isNewlyCreated) syncedCount++;
      } catch (err) {
        // Keep sync non-blocking while recording why an eligible parent could
        // not produce its downstream document.
        console.warn(`[syncAllApprovedPreGraftingSelectionDocuments] Seleksi III belum tersinkron dari ${doc.docNo}:`, err.message);
      }
    }
  });

  // 2. Rekonsiliasi Seleksi II FINAL -> Promosi status parent doc
  let refreshedDocs = storage.get(PRE_GRAFTING_SELECTION_DOC_STORAGE_KEY, []);
  let docs2Modified = false;
  refreshedDocs.forEach((doc, idx) => {
    const stageNorm = String(doc.selectionStage || '').toUpperCase();
    const isStage2 = (stageNorm === 'SELEKSI_II' || stageNorm === 'SELEKSI_2' || stageNorm === SELECTION_STAGES.SELEKSI_2);
    if (!isStage2 || doc.isSplit || doc.isLegacyAggregateSplit) return;

    let isApproved = String(doc.status || '').toUpperCase() === SELECTION_STATUS.DISETUJUI ||
                     String(doc.verificationStatus || '').toUpperCase() === 'TERVERIFIKASI' ||
                     String(doc.status || '').toUpperCase() === 'TERVERIFIKASI';
    let isFinal = Boolean(doc.isFinal) || (isApproved && Boolean(doc.verifiedAt));

    // Auto-promote jika seluruh child transactions pelaksanaan Seleksi II sudah disetujui final oleh ASB dan pemeriksaan fisik 100% tuntas
    if (!isApproved || !isFinal) {
      const executions = getSeleksi2ExecutionsByDocument(doc.id || doc.docNo);
      if (executions.length > 0 && executions.every(t => String(t.status || '').toUpperCase() === SELECTION_STATUS.DISETUJUI || String(t.verificationStatus || '').toUpperCase() === 'TERVERIFIKASI' || t.isFinal === true)) {
        const bedScopeList = getBedenganScopeStatusForSeleksi2(doc, executions);
        const hasUninspected = bedScopeList.some(b => b.remainingPolybag > 0);
        if (!hasUninspected && bedScopeList.length > 0) {
          doc.status = SELECTION_STATUS.DISETUJUI;
          doc.isFinal = true;
          refreshedDocs[idx] = doc;
          docs2Modified = true;
        }
      }
    }
  });

  if (docs2Modified) {
    storage.set(PRE_GRAFTING_SELECTION_DOC_STORAGE_KEY, refreshedDocs);
  }

  // 2b. Buat Dokumen Seleksi III untuk setiap Dokumen Seleksi II yang sudah FINAL
  refreshedDocs.forEach((doc) => {
    const stageNorm = String(doc.selectionStage || '').toUpperCase();
    const isStage2 = (stageNorm === 'SELEKSI_II' || stageNorm === 'SELEKSI_2' || stageNorm === SELECTION_STAGES.SELEKSI_2);
    if (!isStage2 || doc.isSplit || doc.isLegacyAggregateSplit) return;

    const isApproved = String(doc.status || '').toUpperCase() === SELECTION_STATUS.DISETUJUI ||
                       String(doc.verificationStatus || '').toUpperCase() === 'TERVERIFIKASI' ||
                       String(doc.status || '').toUpperCase() === 'TERVERIFIKASI';
    const isFinal = Boolean(doc.isFinal) || isApproved;

    if (isApproved && isFinal) {
      try {
        const res = createSelection3DocumentFromSelection2(doc, currentUser);
        if (res && res.isNewlyCreated) syncedCount++;
      } catch (err) {
        // Idempotency or already exists
      }
    }
  });

  return syncedCount;
}

/**
 * =============================================================================
 * TRANSAKSI PELAKSANAAN SELEKSI I (TASK-03)
 * =============================================================================
 */

/**
 * Mengambil daftar transaksi pelaksanaan Seleksi I untuk suatu parent Dokumen Seleksi
 */
export function getSeleksi1ExecutionsByDocument(idOrDocNo) {
  if (!idOrDocNo) return [];
  const searchStr = String(idOrDocNo).trim();
  const allTxs = storage.get(SELECTION_STORAGE_KEY, []);
  
  return allTxs.filter(tx => {
    // STRATEGI 5-A: Pemisahan deklarasi CULL dari pemeriksaan fisik biasa
    if (isCullDocNo(tx.docNo) || isCullDocNo(tx.selectionNo) || isCullDocNo(tx.selectionPoolDocNo)) return false;
    if (tx.originType === 'CULL_DECLARATION' || tx.isCullDeclaration || tx.transactionType === 'PENYELEKSIAN_BIBIT_AFKIR') return false;

    const isStage1 = (
      tx.selectionStage === SELECTION_STAGES.SELEKSI_1 ||
      tx.stage === 'SELEKSI_I' ||
      tx.transactionType === 'PELAKSANAAN_SELEKSI_I'
    );
    if (!isStage1) return false;

    return (
      tx.parentSelectionDocumentId === searchStr ||
      tx.selectionDocumentId === searchStr ||
      tx.parentSelectionDocNo === searchStr ||
      tx.selectionDocNo === searchStr ||
      tx.sourceDocNo === searchStr
    );
  });
}

function getRecordedBibitSelectedQty(tx) {
  const candidates = [
    tx?.actualBibitSelectedQty,
    tx?.selectedBibitScopeQty,
    tx?.bibitReject,
    tx?.jumlahAfkir
  ];
  for (const value of candidates) {
    if (value === undefined || value === null || String(value).trim() === '') continue;
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return 0;
}

/**
 * Menghitung status alokasi dan sisa scope bedengan untuk Dokumen Seleksi I
 */
export function getBedenganScopeStatusForSeleksi1(parentDoc, txsOverride = null) {
  if (!parentDoc) return [];
  
  const executions = Array.isArray(txsOverride) ? txsOverride : getSeleksi1ExecutionsByDocument(parentDoc.id || parentDoc.docNo);
  
  // Resolve bedengan list from rows or bedenganIds
  let bedenganList = [];
  if (Array.isArray(parentDoc.rows) && parentDoc.rows.length > 0) {
    bedenganList = parentDoc.rows.map(r => {
      const bCode = formatBedenganDisplayCode(r.bedenganCode || r.bedengan || r.bedenganId);
      const batchCode = parentDoc.batchCode || parentDoc.batchNo;
      let liveTotals = null;
      try {
        liveTotals = calculateEligibleSeedingTotalsForBedengan(batchCode, bCode);
      } catch (e) {}

      let initDisemai = (liveTotals && liveTotals.totalDisemai > 0)
        ? liveTotals.totalDisemai
        : parseInt(r.disemai !== undefined ? r.disemai : (r.sourceBibitQty !== undefined ? r.sourceBibitQty : (r.initialBibit !== undefined ? r.initialBibit : ((r.polybag || r.polybagCount || 0) * 2))), 10);
      let initPolybag = (liveTotals && liveTotals.totalPolybag > 0)
        ? liveTotals.totalPolybag
        : parseInt(r.polybag !== undefined ? r.polybag : (r.polybagCount !== undefined ? r.polybagCount : (r.initialPolybag !== undefined ? r.initialPolybag : Math.ceil((r.disemai || 0) / 2))), 10);

      // Reconcile with parentDoc source quantities if single bedengan or if parentDoc has higher cumulative totals
      if (parentDoc.rows.length === 1) {
        if (parentDoc.sourceBibitQty && parentDoc.sourceBibitQty > initDisemai) {
          initDisemai = parentDoc.sourceBibitQty;
        }
        if (parentDoc.sourcePolybagQty && parentDoc.sourcePolybagQty > initPolybag) {
          initPolybag = parentDoc.sourcePolybagQty;
        }
      }

      return {
        bedenganId: r.bedenganId || r.bedenganCode || r.bedengan,
        bedenganCode: bCode,
        initialPolybag: initPolybag,
        initialBibit: initDisemai
      };
    });
  } else if (Array.isArray(parentDoc.bedenganIds) && parentDoc.bedenganIds.length > 0) {
    const polyPerBed = Math.floor(parentDoc.sourcePolybagQty / parentDoc.bedenganIds.length);
    const remPoly = parentDoc.sourcePolybagQty % parentDoc.bedenganIds.length;
    const totalSourceBibit = parseInt(parentDoc.sourceBibitQty !== undefined ? parentDoc.sourceBibitQty : (parentDoc.batchTotalBibit || parentDoc.sourcePolybagQty || 0), 10);
    const bibitPerBed = Math.floor(totalSourceBibit / parentDoc.bedenganIds.length);
    const remBibit = totalSourceBibit % parentDoc.bedenganIds.length;
    bedenganList = parentDoc.bedenganIds.map((bId, idx) => ({
      bedenganId: bId,
      bedenganCode: formatBedenganDisplayCode(bId),
      initialPolybag: polyPerBed + (idx === 0 ? remPoly : 0),
      initialBibit: bibitPerBed + (idx === 0 ? remBibit : 0)
    }));
  } else {
    const bCode = formatBedenganDisplayCode(parentDoc.bedenganCode || parentDoc.bedengan || 'BED-001');
    const batchCode = parentDoc.batchCode || parentDoc.batchNo;
    let liveTotals = null;
    try {
      liveTotals = calculateEligibleSeedingTotalsForBedengan(batchCode, bCode);
    } catch (e) {}

    let initDisemai = (liveTotals && liveTotals.totalDisemai > 0)
      ? liveTotals.totalDisemai
      : (parentDoc.sourceBibitQty || 0);
    let initPolybag = (liveTotals && liveTotals.totalPolybag > 0)
      ? liveTotals.totalPolybag
      : (parentDoc.sourcePolybagQty || 0);

    bedenganList = [{
      bedenganId: parentDoc.bedenganId || 'BED-001',
      bedenganCode: bCode,
      initialPolybag: initPolybag,
      initialBibit: initDisemai
    }];
  }

  // Calculate inspected polybag per bedengan from executions
  return bedenganList.map(bed => {
    const parentBatch = String(parentDoc.batchCode || parentDoc.batchNo || '').trim().toUpperCase();
    const bedNorm = String(bed.bedenganCode || bed.bedenganId).trim().toUpperCase();
    const bedTxs = executions.filter(tx => {
      const txBatch = String(tx.batchCode || tx.batchNo || tx.sourceBatchCode || '').trim().toUpperCase();
      if (parentBatch && txBatch && txBatch !== parentBatch) return false;
      const txBed = String(tx.bedenganCode || tx.bedengan || tx.bedenganId || '').trim().toUpperCase();
      if (!txBed && bedenganList.length === 1) return true;
      return txBed === bedNorm || txBed === String(bed.bedenganId).toUpperCase();
    });

    const inspectedPolybag = bedTxs.reduce((sum, tx) => sum + parseInt(tx.actualPolybagInspectedQty !== undefined ? tx.actualPolybagInspectedQty : (tx.polybagScope !== undefined ? tx.polybagScope : (tx.actualPolybagActiveQty !== undefined ? tx.actualPolybagActiveQty : (tx.initialPolybagCount || 0))), 10), 0);
    const rejectedBibit = bedTxs.reduce((sum, tx) => sum + getRecordedBibitSelectedQty(tx), 0);
    const maintainedBibit = bed.initialBibit > 0 ? Math.max(0, bed.initialBibit - rejectedBibit) : 0;
    const inspectedBibit = bed.initialPolybag > 0
      ? Math.min(bed.initialBibit, Math.round((inspectedPolybag / bed.initialPolybag) * bed.initialBibit))
      : (inspectedPolybag > 0 ? inspectedPolybag : 0);
    const remainingPolybag = bed.initialPolybag > 0 ? Math.max(0, bed.initialPolybag - inspectedPolybag) : 0;
    const remainingBibit = maintainedBibit;

    return {
      ...bed,
      inspectedPolybag,
      inspectedBibit,
      maintainedBibit,
      availableBibit: maintainedBibit,
      rejectedBibit,
      remainingPolybag,
      remainingBibit,
      isFullyInspected: bed.initialPolybag > 0 && remainingPolybag === 0 && bedTxs.length > 0
    };
  });
}

/**
 * Validasi payload transaksi pelaksanaan Seleksi I
 * Mendukung model kuantitas baru (actualPolybagInspectedQty, actualBibitSelectedQty) dan Legacy
 */
export function validateSeleksi1Execution(payload, parentDoc, existingTxs = null, options = {}) {
  const errors = [];
  if (!payload) {
    return { isValid: false, errors: ['Data transaksi Seleksi I tidak boleh kosong.'] };
  }
  if (!parentDoc) {
    return { isValid: false, errors: ['Dokumen Seleksi Pra-Okulasi (parent) tidak ditemukan.'] };
  }

  // 1. Bedengan validation / operational metadata resolution
  const bedScopeList = getBedenganScopeStatusForSeleksi1(parentDoc, existingTxs);

  const bedenganCode = String(payload.bedenganCode || payload.bedengan || payload.bedenganId || '').trim();
  let matchedBed = null;
  if (bedenganCode) {
    const bedNorm = formatBedenganDisplayCode(bedenganCode).toUpperCase();
    matchedBed = bedScopeList.find(b => 
      formatBedenganDisplayCode(b.bedenganCode).toUpperCase() === bedNorm ||
      String(b.bedenganId).toUpperCase() === String(payload.bedenganId || '').toUpperCase() ||
      String(b.bedenganCode).toUpperCase() === bedNorm
    );
  }
  if (!matchedBed && bedScopeList.length > 0) {
    matchedBed = bedScopeList[0];
  }

  const resolvedBedId = matchedBed ? matchedBed.bedenganId : (payload.bedenganId || parentDoc.bedenganId || 'BED-001');
  const resolvedBedCode = matchedBed ? matchedBed.bedenganCode : (payload.bedenganCode || parentDoc.bedenganCode || 'BED-001');

  // SCOPE-ISOLATED: Use per-bedengan remainingPolybag, NOT aggregate total
  const maxPolybagScope = matchedBed
    ? (matchedBed.remainingPolybag > 0 ? matchedBed.remainingPolybag : 0)
    : (bedScopeList.length > 0
        ? bedScopeList.reduce((sum, b) => sum + (b.remainingPolybag || 0), 0)
        : parseInt(parentDoc.sourcePolybagQty || 0, 10));

  const sourceBibit = parseInt(parentDoc.sourceBibitQty !== undefined ? parentDoc.sourceBibitQty : (parentDoc.batchTotalBibit || parentDoc.initialBibit || parentDoc.sourcePolybagQty || 0), 10);
  // Parse 2 canonical inputs: Jlh Polybag Diperiksa & Jlh Bibit Diseleksi (Minimum 0)
  const rawPoly = payload.actualPolybagInspectedQty !== undefined
    ? payload.actualPolybagInspectedQty
    : (payload.polybagScope !== undefined
        ? payload.polybagScope
        : (payload.actualPolybagActiveQty !== undefined ? payload.actualPolybagActiveQty : payload.polybagAktif));

  const rawBibit = payload.actualBibitSelectedQty !== undefined
    ? payload.actualBibitSelectedQty
    : (payload.selectedBibitScopeQty !== undefined
        ? payload.selectedBibitScopeQty
        : (payload.jumlahDiperiksa !== undefined ? payload.jumlahDiperiksa : undefined));

  let actualPolyInspected = 0;
  if (rawPoly === undefined || rawPoly === null || String(rawPoly).trim() === '') {
    errors.push('Jumlah polybag diperiksa wajib diisi.');
  } else {
    actualPolyInspected = Number(rawPoly);
    if (isNaN(actualPolyInspected)) {
      errors.push('Jumlah polybag diperiksa harus berupa angka yang valid.');
    } else if (actualPolyInspected < 0) {
      errors.push('Jumlah polybag diperiksa tidak boleh negatif (minimum 0).');
    } else if (matchedBed && matchedBed.isFullyInspected && actualPolyInspected > 0) {
      errors.push(`Bedengan ${resolvedBedCode} telah selesai diperiksa seluruhnya.`);
    } else if (actualPolyInspected > maxPolybagScope) {
      errors.push(`Jumlah polybag diperiksa (${actualPolyInspected}) melebihi sisa scope polybag bedengan ${resolvedBedCode} (${maxPolybagScope}).`);
    }
  }

  const maxBibitBedengan = matchedBed 
    ? (matchedBed.initialBibit !== undefined ? matchedBed.initialBibit : (matchedBed.disemai !== undefined ? matchedBed.disemai : (matchedBed.initialPolybag || sourceBibit))) 
    : sourceBibit;
  const existingBibitOnBed = matchedBed ? (matchedBed.rejectedBibit || 0) : 0;
  const availableBibit = Math.max(0, maxBibitBedengan - existingBibitOnBed);

  let actualBibitSelected = 0;
  if (rawBibit === undefined || rawBibit === null || String(rawBibit).trim() === '') {
    errors.push('Jumlah bibit diseleksi wajib diisi.');
  } else {
    actualBibitSelected = Number(rawBibit);
    if (isNaN(actualBibitSelected)) {
      errors.push('Jumlah bibit diseleksi harus berupa angka yang valid.');
    } else if (actualBibitSelected < 0) {
      errors.push('Jumlah bibit diseleksi tidak boleh negatif (minimum 0).');
    } else if (actualBibitSelected > availableBibit) {
      errors.push(`Jumlah bibit diseleksi (${actualBibitSelected}) melebihi Bibit Tersedia (${availableBibit}).`);
    }
  }

  const selectedReason = String(payload.alasan || payload.category || payload.alasanAfkir || payload.alasanDitolakCategory || '').trim();
  const isReasonRequired = options && options.requireAlasan !== undefined 
    ? Boolean(options.requireAlasan) 
    : Boolean(payload.requireAlasan);
  if (isReasonRequired && actualBibitSelected > 0 && !selectedReason) {
    errors.push('Alasan wajib dipilih jika ada bibit afkir.');
  }

  // Basis Populasi Awal Dokumen Induk / Bedengan (Tidak menggunakan polybag × 2)
  const initialPopulationBasis = Math.max(
    maxBibitBedengan || 0,
    parseInt(parentDoc.sourceBibitQty || 0, 10),
    parseInt(parentDoc.batchTotalBibit || 0, 10),
    parseInt(parentDoc.initialBibit || 0, 10)
  );

  // Hitung akumulasi afkir terdahulu pada dokumen / bedengan
  const existingBibitSelectedSum = Array.isArray(existingTxs)
    ? existingTxs.reduce((sum, tx) => {
        const bAfkir = getRecordedBibitSelectedQty(tx);
        return sum + (isNaN(bAfkir) ? 0 : bAfkir);
      }, 0)
    : existingBibitOnBed;

  const totalBibitDiseleksiAfter = existingBibitSelectedSum + (isNaN(actualBibitSelected) ? 0 : actualBibitSelected);

  // Target Logic Bisnis: Populasi Tersedia Dokumen Induk = Populasi Awal Dokumen Induk - Afkir Kumulatif
  // Contoh: 12.075 Pkk - 242 Pkk = 11.833 Pkk
  let cumulativeBibitRetained = 0;
  if (payload.actualBibitRetainedQty !== undefined && payload.actualBibitRetainedQty !== null && !isNaN(Number(payload.actualBibitRetainedQty))) {
    cumulativeBibitRetained = Number(payload.actualBibitRetainedQty);
  } else if (initialPopulationBasis > 0) {
    cumulativeBibitRetained = Math.max(0, initialPopulationBasis - totalBibitDiseleksiAfter);
  } else {
    cumulativeBibitRetained = Math.max(0, maxBibitBedengan - totalBibitDiseleksiAfter);
  }

  const sessionBibitRetained = cumulativeBibitRetained;
  const polyScope = actualPolyInspected;
  const inactivePolybagQty = 0;
  const selectedBibitScopeQty = actualBibitSelected;
  const bibitReject = actualBibitSelected;
  const jumlahAfkir = actualBibitSelected;
  const bibitAwal = initialPopulationBasis || maxBibitBedengan || sourceBibit;
  const jumlahDiperiksa = initialPopulationBasis || maxBibitBedengan || sourceBibit;

  // Resolve source SOW doc number for bedengan-level traceability
  let resolvedSowDocNo = payload.sourceSeedingDocNo || '';
  if (!resolvedSowDocNo && matchedBed && Array.isArray(parentDoc.rows)) {
    const matchRow = parentDoc.rows.find(r => {
      const rBedCode = formatBedenganDisplayCode(r.bedenganCode || r.bedengan || r.bedenganId);
      return rBedCode.toUpperCase() === resolvedBedCode.toUpperCase();
    });
    if (matchRow) {
      resolvedSowDocNo = matchRow.seedingDocNo || matchRow.sourceSeedingDocNo || matchRow.sourceDocNo || '';
    }
  }
  if (!resolvedSowDocNo) {
    resolvedSowDocNo = parentDoc.sourceDocNo || '';
  }

  // 4. Photo Evidence Validation (Wajib minimal 1 foto dengan watermark GPS)
  const isPhotoRequired = options && options.requirePhoto !== undefined 
    ? Boolean(options.requirePhoto) 
    : Boolean(payload.requirePhoto || payload.fromUI);
  if (isPhotoRequired) {
    const photo = payload.photo || payload.photoEvidence || (Array.isArray(payload.photos) && payload.photos[0]);
    const photoDataUrl = (typeof photo === 'object' && photo !== null) ? (photo.dataUrl || photo.src || photo.url) : (typeof photo === 'string' ? photo : null);
    if (!photoDataUrl || typeof photoDataUrl !== 'string' || !photoDataUrl.startsWith('data:image/')) {
      errors.push('Foto bukti pemeriksaan seleksi wajib dilampirkan (minimal 1 foto dengan koordinat GPS aktual).');
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    parsed: {
      bedenganId: matchedBed ? matchedBed.bedenganId : (payload.bedenganId || bedenganCode),
      bedenganCode: matchedBed ? matchedBed.bedenganCode : bedenganCode,
      sourceSeedingDocNo: resolvedSowDocNo,
      polybagScope: polyScope,
      actualPolybagInspectedQty: actualPolyInspected,
      actualPolybagActiveQty: actualPolyInspected,
      actualBibitSelectedQty: actualBibitSelected,
      actualBibitRetainedQty: cumulativeBibitRetained,
      sessionBibitRetained,
      initialPopulationBasis,
      inactivePolybagQty,
      selectedBibitScopeQty,
      activePolybagQty: actualPolyInspected,
      totalLayak: cumulativeBibitRetained,
      bibitAwal,
      jumlahDiperiksa,
      bibitDipertahankan: cumulativeBibitRetained,
      bibitReject,
      jumlahAfkir,
      jumlahLayak: cumulativeBibitRetained,
      alasan: actualBibitSelected > 0 ? selectedReason : '',
      category: actualBibitSelected > 0 ? (payload.category || selectedReason) : '',
      alasanAfkir: actualBibitSelected > 0 ? selectedReason : '',
      alasanDitolakCategory: actualBibitSelected > 0 ? selectedReason : '',
      photo: payload.photo || null,
      photoEvidence: payload.photo?.dataUrl || payload.photoEvidence || (Array.isArray(payload.photos) && payload.photos[0]) || null,
      photos: payload.photo?.dataUrl ? [payload.photo.dataUrl] : (Array.isArray(payload.photos) ? payload.photos : [])
    }
  };
}

/**
 * Menghubungkan hasil afkir dari pelaksanaan Seleksi I, II, dan III ke selection_pool
 * sebagai kandidat deklarasi CULL (PENDING_DECLARATION).
 * Idempoten, stabil, tanpa alokasi nomor CULL resmi prematur, dan tanpa memutasi stok.
 */
export function syncPreGraftingExecutionToSelectionPool(execTx, parentDoc = null) {
  if (!execTx) return null;
  const afkirQty = parseInt(
    execTx.actualBibitSelectedQty !== undefined 
      ? execTx.actualBibitSelectedQty 
      : (execTx.jumlahAfkir !== undefined ? execTx.jumlahAfkir : (execTx.bibitReject || 0)), 
    10
  );

  const poolId = `SEL-POOL-PRE-${execTx.id}`;
  let pool = storage.get('selection_pool', []);

  const existingIdx = pool.findIndex(s =>
    s.id === poolId ||
    (String(s.sourceTransactionId || '') === String(execTx.id || '') && (s.sourceModule === 'SELEKSI_PRA_OKULASI' || s.originType === 'REJECT_PRE_GRAFTING'))
  );

  // Jika afkir 0: jangan buat kandidat kosong, dan bersihkan draft candidate jika ada
  if (isNaN(afkirQty) || afkirQty <= 0) {
    if (existingIdx !== -1) {
      const existingItem = pool[existingIdx];
      if (existingItem.status === 'PENDING_DECLARATION' && !existingItem.selectionTransactionId && !existingItem.docNo) {
        pool.splice(existingIdx, 1);
        storage.set('selection_pool', pool);
      }
    }
    return null;
  }

  const existing = existingIdx >= 0 ? pool[existingIdx] : null;

  // Jangan merusak status jika sudah dideklarasikan / dikonfirmasi
  const isAlreadyDeclared = existing && (
    existing.status === SELECTION_STATUS.READY_TO_CONFIRM ||
    existing.status === 'READY_TO_CONFIRM' ||
    existing.status === SELECTION_STATUS.MENUNGGU_VERIFIKASI ||
    existing.status === 'SUBMITTED_TO_ASB' ||
    existing.status === SELECTION_STATUS.DISETUJUI ||
    existing.status === 'DECLARED_CULLED' ||
    Boolean(existing.selectionTransactionId) ||
    Boolean(existing.docNo && isCullDocNo(existing.docNo))
  );

  const stage = execTx.selectionStage || (
    execTx.transactionType === 'PELAKSANAAN_SELEKSI_I' ? SELECTION_STAGES.SELEKSI_1 :
    execTx.transactionType === 'PELAKSANAAN_SELEKSI_II' ? SELECTION_STAGES.SELEKSI_2 :
    execTx.transactionType === 'PELAKSANAAN_SELEKSI_III' ? SELECTION_STAGES.SELEKSI_3 :
    SELECTION_STAGES.SELEKSI_1
  );

  const stageLabel = (stage === SELECTION_STAGES.SELEKSI_2 || stage === 'SELEKSI_2' || stage === 'SELEKSI_II') ? 'Seleksi II' :
    (stage === SELECTION_STAGES.SELEKSI_3 || stage === 'SELEKSI_3' || stage === 'SELEKSI_III') ? 'Seleksi III' : 'Seleksi I';

  const poolEntry = {
    id: existing?.id || poolId,
    // PENTING: docNo harus null pada kandidat pool. Nomor CULL resmi hanya diterbitkan saat deklarasi resmi!
    docNo: isAlreadyDeclared ? (existing.docNo || null) : null,
    selectionDocNo: isAlreadyDeclared ? (existing.selectionDocNo || null) : null,
    selectionTransactionId: isAlreadyDeclared ? (existing.selectionTransactionId || null) : null,
    originType: 'REJECT_PRE_GRAFTING',
    sourceModule: 'SELEKSI_PRA_OKULASI',
    sourceTransactionType: execTx.transactionType || `PELAKSANAAN_${stage}`,
    sourceTransactionId: execTx.id,
    sourceDocNo: execTx.docNo || execTx.selectionNo || '-',
    parentSelectionDocumentId: parentDoc?.id || execTx.parentSelectionDocumentId || execTx.selectionDocumentId || null,
    parentSelectionDocNo: parentDoc?.docNo || execTx.parentSelectionDocNo || execTx.selectionDocNo || null,
    selectionStage: stage,
    stage: stage,
    selectionType: SELECTION_TYPES.PRA_OKULASI,
    category: isAlreadyDeclared ? (existing.category || 'AFKIR') : (execTx.category || 'PENDING_DECLARATION'),
    alasanDitolakCategory: isAlreadyDeclared ? (existing.alasanDitolakCategory || existing.category || 'AFKIR') : (execTx.alasanDitolakCategory || execTx.category || 'PENDING_DECLARATION'),
    jumlahAfkir: isAlreadyDeclared ? (existing.jumlahAfkir || afkirQty) : afkirQty,
    quantity: isAlreadyDeclared ? (existing.quantity || afkirQty) : afkirQty,
    alasan: isAlreadyDeclared ? (existing.alasan || `Bibit afkir ${stageLabel} (${execTx.bedenganCode || '-'})`) : (execTx.alasan || (execTx.rejectSourceReference && execTx.rejectSourceReference.reason) || `Bibit afkir ${stageLabel} (${execTx.bedenganCode || '-'})`),
    alasanDetail: isAlreadyDeclared ? (existing.alasanDetail || existing.alasan || null) : (execTx.alasanDetail || null),
    
    // Polybag count: 1 polybag = 1 bibit afkir pada Seleksi Pra-Okulasi (bukan dibagi 2)
    polybagCount: afkirQty,

    // Master & Scope contexts
    estateId: execTx.estateId || parentDoc?.estateId || null,
    divisionId: execTx.divisionId || parentDoc?.divisionId || null,
    programId: execTx.programId || parentDoc?.programId || null,
    programCode: execTx.programCode || parentDoc?.programCode || null,
    program: execTx.programName || execTx.programCode || parentDoc?.programName || null,
    programName: execTx.programName || parentDoc?.programName || null,
    batchId: execTx.batchId || parentDoc?.batchId || null,
    batchCode: execTx.batchCode || parentDoc?.batchCode || null,
    batchNo: execTx.batchNo || parentDoc?.batchNo || null,
    bedenganId: execTx.bedenganId || null,
    bedenganCode: execTx.bedenganCode || null,
    bedengan: execTx.bedenganCode || null,
    klon: execTx.klon || execTx.clone || parentDoc?.klon || 'GT 1',
    clone: execTx.clone || execTx.klon || parentDoc?.clone || 'GT 1',
    tahapan: 'Rubber Main Nursery',
    tanggal: execTx.tanggalSeleksi || execTx.tanggal || getEffectiveTodayDDMMYYYY(),

    // Actor
    actorId: execTx.createdByUserId || 'MANTRI',
    actorCode: execTx.createdByRole || 'MNT',
    actorName: execTx.createdByName || 'Mantri Bibitan',
    mantri: execTx.createdByName || 'Mantri Bibitan',
    userId: execTx.createdByUserId || 'MANTRI',
    createdByName: execTx.createdByName || 'Mantri Bibitan',
    createdBy: execTx.createdByUserId || 'MANTRI',

    status: isAlreadyDeclared ? existing.status : 'PENDING_DECLARATION',
    verificationStatus: isAlreadyDeclared ? (existing.verificationStatus || null) : null,
    submissionStatus: isAlreadyDeclared ? (existing.submissionStatus || null) : null,
    stockMutationStatus: isAlreadyDeclared ? (existing.stockMutationStatus || 'PENDING') : 'PENDING',
    createdAt: existing?.createdAt || execTx.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  if (existingIdx >= 0) {
    pool[existingIdx] = { ...pool[existingIdx], ...poolEntry };
  } else {
    pool.push(poolEntry);
  }
  storage.set('selection_pool', pool);
  return poolEntry;
}

/**
 * Membersihkan kandidat deklarasi CULL dari selection_pool ketika transaksi pelaksanaan dihapus
 */
export function cleanupPreGraftingExecutionFromSelectionPool(txId, docNo = null) {
  if (!txId && !docNo) return;
  const pool = storage.get('selection_pool', []);
  const txIdStr = String(txId || '');
  const docNoStr = String(docNo || '');
  const nextPool = pool.filter(item => {
    if (!item) return true;
    const itemStage = String(item.selectionStage || item.stage || '').toUpperCase();
    const isPreGraftingCandidate =
      item.id?.startsWith?.('SEL-POOL-PRE-') ||
      item.sourceModule === 'SELEKSI_PRA_OKULASI' ||
      item.originType === 'REJECT_PRE_GRAFTING' ||
      item.selectionType === SELECTION_TYPES.PRA_OKULASI ||
      ['PRA_OKULASI', 'SELEKSI_PRA_OKULASI'].includes(String(item.selectionType || '').toUpperCase()) ||
      ['SELEKSI_1', 'SELEKSI_I', 'SELEKSI_2', 'SELEKSI_II', 'SELEKSI_3', 'SELEKSI_III'].includes(itemStage) ||
      Boolean(item.parentSelectionDocumentId || item.parentSelectionDocNo);
    if (!isPreGraftingCandidate) return true;
    const matchesExecution =
      (txIdStr && String(item.sourceTransactionId || '') === txIdStr) ||
      (txIdStr && String(item.id || '') === `SEL-POOL-PRE-${txIdStr}`) ||
      (docNoStr && String(item.sourceDocNo || item.sourceSelectionDocNo || item.selectionSourceDocNo || '').trim() === docNoStr);
    if (!matchesExecution) return true;
    const status = String(item.status || 'PENDING_DECLARATION').toUpperCase();
    const isPending = ['PENDING_DECLARATION', 'PENDING', 'DRAFT'].includes(status);
    const hasCullReference = Boolean(item.selectionTransactionId) ||
      isCullDocNo(item.docNo || item.selectionDocNo || item.selectionPoolDocNo);
    return !(isPending && !hasCullReference);
  });
  if (nextPool.length !== pool.length) storage.set('selection_pool', nextPool);
}

/** Menarik pengajuan verifikasi dokumen induk bila sesi pemeriksaannya diubah/dihapus. */
function withdrawPendingPreGraftingVerification(parentDoc, currentUser, reason) {
  if (!parentDoc) return;
  const docId = String(parentDoc.id || '').trim();
  const docNo = String(parentDoc.docNo || parentDoc.selectionDocNo || '').trim();
  const verifications = storage.get('verification_transactions', []);
  const now = new Date().toISOString();
  let changed = false;

  verifications.forEach(record => {
    if (!record) return;
    const refType = String(record.referenceType || record.moduleType || '').toUpperCase();
    if (!['SELEKSI_PRA_OKULASI', 'SELECTION'].includes(refType)) return;
    const matchesParent =
      (docId && String(record.referenceId || '') === docId) ||
      (docNo && String(record.referenceDocNo || '') === docNo);
    if (!matchesParent) return;
    const status = String(record.verificationStatus || '').toUpperCase();
    if (['TERVERIFIKASI', 'DATA_TERKONFIRMASI', 'DISETUJUI', 'VERIFIED', 'APPROVED'].includes(status)) return;

    record.verificationStatus = 'DIBATALKAN';
    record.withdrawnAt = now;
    record.withdrawnByUserId = currentUser?.userId || currentUser?.id || null;
    record.withdrawnByName = currentUser?.name || null;
    record.withdrawalReason = reason;
    record.updatedAt = now;
    changed = true;
  });

  if (changed) storage.set('verification_transactions', verifications);
}

/** Mencegah sumber eksekusi dihapus jika kandidatnya sudah masuk proses Cull. */
function assertPreGraftingExecutionCanBeDeleted(execution, allTxs) {
  if (!execution) return;
  const sourceId = String(execution.id || '');
  const sourceDocNo = String(execution.docNo || execution.selectionNo || '');
  const pool = storage.get('selection_pool', []);
  const relatedCandidates = pool.filter(item => {
    if (!item) return false;
    const itemStage = String(item.selectionStage || item.stage || '').toUpperCase();
    const isPreGraftingCandidate =
      item.id?.startsWith?.('SEL-POOL-PRE-') ||
      item.sourceModule === 'SELEKSI_PRA_OKULASI' ||
      item.originType === 'REJECT_PRE_GRAFTING' ||
      item.selectionType === SELECTION_TYPES.PRA_OKULASI ||
      ['PRA_OKULASI', 'SELEKSI_PRA_OKULASI'].includes(String(item.selectionType || '').toUpperCase()) ||
      ['SELEKSI_1', 'SELEKSI_I', 'SELEKSI_2', 'SELEKSI_II', 'SELEKSI_3', 'SELEKSI_III'].includes(itemStage) ||
      Boolean(item.parentSelectionDocumentId || item.parentSelectionDocNo);
    if (!isPreGraftingCandidate) return false;
    return String(item.sourceTransactionId || '') === sourceId ||
      String(item.id || '') === `SEL-POOL-PRE-${sourceId}` ||
      (sourceDocNo && String(item.sourceDocNo || item.sourceSelectionDocNo || item.selectionSourceDocNo || '').trim() === sourceDocNo);
  });
  const relatedCullTx = allTxs.find(tx => tx && tx !== execution &&
    isCullDocNo(tx.docNo || tx.selectionNo || tx.selectionPoolDocNo) &&
    (String(tx.sourceTransactionId || '') === sourceId ||
      (sourceDocNo && String(tx.sourceTransactionId || '') === sourceDocNo) ||
      relatedCandidates.some(item => String(item.selectionTransactionId || '') === String(tx.id || tx.selectionId || '')))
  );
  const candidateAlreadyDeclared = relatedCandidates.some(item =>
    Boolean(item.selectionTransactionId) ||
    isCullDocNo(item.docNo || item.selectionDocNo || item.selectionPoolDocNo) ||
    !['PENDING_DECLARATION', 'PENDING', 'DRAFT'].includes(String(item.status || 'PENDING_DECLARATION').toUpperCase())
  );
  if (relatedCullTx || candidateAlreadyDeclared) {
    throw new Error(`Transaksi ${sourceDocNo || sourceId} sudah terhubung ke deklarasi Cull. Batalkan atau selesaikan deklarasi Cull terlebih dahulu sebelum menghapus transaksi sumber.`);
  }
}

/**
 * Membuat transaksi pelaksanaan Seleksi I baru oleh Mantri Bibitan
 */
export function createSeleksi1ExecutionTransaction(payload, currentUser, options = {}) {
  const allTxs = storage.get(SELECTION_STORAGE_KEY, []);

  // PENGAMANAN IDEMPOTENSI: Periksa payload.id dan payload.clientRequestId sebelum validasi/eksekusi
  const reqId = payload.id ? String(payload.id).trim() : null;
  const clientReqId = payload.clientRequestId ? String(payload.clientRequestId).trim() : null;
  if (reqId || clientReqId) {
    const existingTx = allTxs.find(tx => 
      (reqId && String(tx.id) === reqId) ||
      (clientReqId && tx.clientRequestId && String(tx.clientRequestId) === clientReqId)
    );
    if (existingTx) {
      const allDocs = storage.get(PRE_GRAFTING_SELECTION_DOC_STORAGE_KEY, []);
      const parentDocId = payload.selectionDocumentId || payload.selectionDocNo || payload.docNo || existingTx.parentSelectionDocumentId || existingTx.selectionDocumentId;
      const parentDoc = allDocs.find(d => d.id === parentDocId || d.docNo === parentDocId) || null;
      return {
        success: true,
        transaction: existingTx,
        parentDocument: parentDoc,
        isDuplicate: true
      };
    }
  }

  const parentDocId = payload.selectionDocumentId || payload.selectionDocNo || payload.docNo;
  const parentDoc = getPreGraftingSelectionDocumentById(parentDocId);
  if (!parentDoc) {
    throw new Error(`Dokumen Seleksi Pra-Okulasi dengan identitas "${parentDocId}" tidak ditemukan.`);
  }

  // DEFENSE GATE: Validasi apakah SOW sumber Dokumen Seleksi I ini eligible (CULL approved dan ASB approved)
  const gateCheck = canPerformPreGraftingSelection1(parentDoc, payload.bedenganCode || payload.bedenganId || payload.bedengan);
  if (!gateCheck.canPerform) {
    throw new Error(`Pelaksanaan Seleksi I tidak dapat dilakukan: ${gateCheck.reason}`);
  }

  // GLOBAL ATTENDANCE GATE (setelah defense gate dokumen)
  assertAttendanceGateOrThrow(currentUser);

  const existingExecutions = getSeleksi1ExecutionsByDocument(parentDoc.id);
  const val = validateSeleksi1Execution(payload, parentDoc, existingExecutions, options);
  if (!val.isValid) {
    throw new Error(val.errors.join(' '));
  }
  
  // Generate Transaction Document Number
  let maxSeq = 0;
  allTxs.forEach(tx => {
    const d = String(tx.docNo || tx.selectionNo || '');
    const match = d.match(/SEL(?:-I|-TX)?\/(\d+)/i) || d.match(/(\d+)$/);
    if (match) {
      const num = parseInt(match[1], 10);
      if (!isNaN(num) && num > maxSeq) maxSeq = num;
    }
  });

  const txSeq = maxSeq + 1;
  const txDocNo = payload.docNo || formatStandardDocNo(2026, 'SEL-I', txSeq);
  const today = payload.tanggalSeleksi || payload.date || getEffectiveTodayDDMMYYYY();

  const txRecord = {
    id: payload.id || `SEL-TX-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    clientRequestId: clientReqId || null,
    docNo: txDocNo,
    selectionNo: txDocNo,
    transactionType: 'PELAKSANAAN_SELEKSI_I',
    selectionType: SELECTION_TYPES.PRA_OKULASI,
    selectionStage: SELECTION_STAGES.SELEKSI_1,
    
    // Parent Document relation
    selectionDocumentId: parentDoc.id,
    selectionDocNo: parentDoc.docNo,
    parentSelectionDocumentId: parentDoc.id,
    parentSelectionDocNo: parentDoc.docNo,
    
    // Source Penyemaian relation
    sourceModule: 'PENYEMAIAN',
    sourceTransactionType: 'SEEDING',
    sourceTransactionId: parentDoc.sourceTransactionId,
    sourceDocNo: parentDoc.sourceDocNo,
    seedingDocNo: parentDoc.sourceDocNo,
    
    // Master & Scope Contexts
    batchId: parentDoc.batchId,
    batchCode: parentDoc.batchCode,
    batchNo: parentDoc.batchCode,
    programId: parentDoc.programId,
    programCode: parentDoc.programCode,
    programName: parentDoc.programName,
    estateId: parentDoc.estateId || currentUser?.estateId,
    estateName: parentDoc.estateName || currentUser?.estateName,
    divisionId: parentDoc.divisionId || currentUser?.divisionId,
    divisionName: parentDoc.divisionName || currentUser?.divisionName,
    clone: parentDoc.clone,
    klon: parentDoc.klon,
    growthStage: parentDoc.growthStage || 'Rubber Main Nursery',
    
    bedenganId: val.parsed.bedenganId,
    bedenganCode: val.parsed.bedenganCode,
    bedengan: val.parsed.bedenganCode,
    sourceSeedingDocNo: val.parsed.sourceSeedingDocNo || parentDoc.sourceDocNo,
    
    // Population Breakdown & Quantities
    polybagScope: val.parsed.actualPolybagInspectedQty,
    initialPolybagCount: val.parsed.actualPolybagInspectedQty,
    sourcePolybagQty: parentDoc.sourcePolybagQty,
    sourceBibitQty: parentDoc.sourceBibitQty,
    bibitAwal: val.parsed.bibitAwal,
    jumlahDiperiksa: val.parsed.jumlahDiperiksa,
    sessionBibitRetained: val.parsed.sessionBibitRetained,
    initialPopulationBasis: val.parsed.initialPopulationBasis,
    
    // Canonical Quantities
    actualPolybagInspectedQty: val.parsed.actualPolybagInspectedQty,
    actualBibitSelectedQty: val.parsed.actualBibitSelectedQty,
    actualBibitRetainedQty: val.parsed.actualBibitRetainedQty,
    actualPolybagActiveQty: val.parsed.actualPolybagInspectedQty,
    activePolybagQty: val.parsed.actualPolybagInspectedQty,
    selectedBibitScopeQty: val.parsed.actualBibitSelectedQty,
    totalLayak: val.parsed.actualBibitRetainedQty,
    bibitDipertahankan: val.parsed.actualBibitRetainedQty,
    jumlahLayak: val.parsed.actualBibitRetainedQty,
    bibitReject: val.parsed.actualBibitSelectedQty,
    jumlahAfkir: val.parsed.actualBibitSelectedQty,
    
    // Reject Source Reference
    rejectSourceReference: {
      stage: SELECTION_STAGES.SELEKSI_1,
      parentDocNo: parentDoc.docNo,
      sourceDocNo: parentDoc.sourceDocNo,
      bedenganCode: val.parsed.bedenganCode,
      rejectCount: val.parsed.actualBibitSelectedQty,
      reason: val.parsed.alasan || 'Bibit afkir Seleksi I'
    },
    alasan: val.parsed.alasan || '',
    category: val.parsed.category || '',
    alasanAfkir: val.parsed.alasanAfkir || '',
    alasanDitolakCategory: val.parsed.alasanDitolakCategory || '',
    
    tanggalSeleksi: today,
    tanggal: today,
    catatan: payload.catatan || payload.remarks || '-',
    
    // Photo Evidence Documentation
    photo: payload.photo ? {
      id: payload.photo.id || `PHOTO-SEL1-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      dataUrl: payload.photo.dataUrl,
      capturedAt: payload.photo.capturedAt,
      capturedAtLabel: payload.photo.capturedAtLabel,
      latitude: payload.photo.latitude,
      longitude: payload.photo.longitude,
      batchCode: val.parsed.batchCode || parentDoc.batchCode,
      bedenganCode: val.parsed.bedenganCode,
      source: 'CAMERA'
    } : null,
    photoEvidence: payload.photo?.dataUrl || payload.photoEvidence || (Array.isArray(payload.photos) && payload.photos[0]) || null,
    photos: payload.photo?.dataUrl ? [payload.photo.dataUrl] : (Array.isArray(payload.photos) ? payload.photos : []),
    hasPhotoEvidence: Boolean(payload.photo?.dataUrl || payload.photoEvidence || (Array.isArray(payload.photos) && payload.photos.length > 0)),

    status: 'RECORDED',
    stockMutationStatus: 'NOT_REQUIRED',
    
    createdByUserId: currentUser?.userId || currentUser?.code || currentUser?.id || 'MANTRI',
    createdByName: currentUser?.name || 'Mantri Bibitan',
    createdByRole: currentUser?.role || 'MANTRI_TANAMAN',
    createdAt: new Date().toISOString()
  };

  const newTx = currentUser 
    ? applyTransactionActor(txRecord, AUDIT_EVENT_TYPES.CREATE, currentUser, `Pelaksanaan Seleksi I pada ${val.parsed.bedenganCode} (${val.parsed.actualPolybagInspectedQty} Polybag, ${val.parsed.actualBibitSelectedQty} Bibit Diseleksi)`)
    : txRecord;

  // 1. Save execution transaction to selection_transactions
  allTxs.push(newTx);
  storage.set(SELECTION_STORAGE_KEY, allTxs);

  // 2. Update Parent Pre-Grafting Selection Document
  const allDocs = storage.get(PRE_GRAFTING_SELECTION_DOC_STORAGE_KEY, []);
  const parentIdx = allDocs.findIndex(d => d.id === parentDoc.id || d.docNo === parentDoc.docNo);
  
  if (parentIdx !== -1) {
    const currentParent = allDocs[parentIdx];
    
    const parentExecutions = allTxs.filter(tx => {
      const isStage1 = (
        tx.selectionStage === SELECTION_STAGES.SELEKSI_1 ||
        tx.stage === 'SELEKSI_I' ||
        tx.stage === 'SELEKSI_1' ||
        tx.transactionType === 'PELAKSANAAN_SELEKSI_I'
      );
      if (!isStage1) return false;
      return (
        tx.parentSelectionDocumentId === currentParent.id ||
        tx.selectionDocumentId === currentParent.id ||
        tx.parentSelectionDocNo === currentParent.docNo ||
        tx.selectionDocNo === currentParent.docNo
      );
    });

    const sourcePoly = parseInt(currentParent.sourcePolybagQty || 0, 10);
    const sourceBibit = parseInt(currentParent.sourceBibitQty !== undefined ? currentParent.sourceBibitQty : (currentParent.batchTotalBibit || currentParent.initialBibit || sourcePoly), 10);

    const updatedTotalPolyDiperiksa = parentExecutions.reduce((sum, tx) => 
      sum + parseInt(tx.actualPolybagInspectedQty !== undefined ? tx.actualPolybagInspectedQty : (tx.polybagScope !== undefined ? tx.polybagScope : (tx.actualPolybagActiveQty !== undefined ? tx.actualPolybagActiveQty : (tx.initialPolybagCount || 0))), 10), 
      0
    );
    const updatedTotalBibitDiseleksi = parentExecutions.reduce((sum, tx) => 
      sum + getRecordedBibitSelectedQty(tx),
      0
    );
    const updatedTotalLayak = Math.max(0, sourceBibit - updatedTotalBibitDiseleksi);
    const updatedTotalAfkir = updatedTotalBibitDiseleksi;
    const sisaPolybag = Math.max(0, sourcePoly - updatedTotalPolyDiperiksa);
    const isAllPolybagChecked = sourcePoly > 0 && updatedTotalPolyDiperiksa === sourcePoly && sisaPolybag === 0;

    allDocs[parentIdx] = {
      ...currentParent,
      executionTransactionIds: parentExecutions.map(tx => tx.id),
      executionCount: parentExecutions.length,
      totalDiperiksa: updatedTotalPolyDiperiksa,
      totalPolybagDiperiksa: updatedTotalPolyDiperiksa,
      totalBibitDiseleksi: updatedTotalBibitDiseleksi,
      totalBibitSelectedQty: updatedTotalBibitDiseleksi,
      totalBibitRetainedQty: updatedTotalLayak,
      totalLayak: updatedTotalLayak,
      totalAfkir: updatedTotalAfkir,
      totalReject: updatedTotalAfkir,
      activePolybagQty: updatedTotalPolyDiperiksa,
      currentBibitQty: updatedTotalLayak,
      currentPolybagQty: updatedTotalPolyDiperiksa,
      remainingPolybag: sisaPolybag,
      sisaPolybag: sisaPolybag,
      sisaBibit: Math.max(0, sourceBibit - updatedTotalBibitDiseleksi),
      progress: sourcePoly > 0 ? Math.min(100, Math.max(0, Math.round((updatedTotalPolyDiperiksa / sourcePoly) * 100))) : 0,
      isCompleted: isAllPolybagChecked,
      status: isAllPolybagChecked 
        ? 'COMPLETED'
        : (parentExecutions.length > 0 ? 'IN_PROGRESS' : 'DRAFT'),
      verificationStatus: isAllPolybagChecked ? null : currentParent.verificationStatus,
      returnReason: isAllPolybagChecked ? null : currentParent.returnReason,
      isCorrected: isAllPolybagChecked ? true : Boolean(currentParent.isCorrected),
      updatedAt: new Date().toISOString()
    };

    storage.set(PRE_GRAFTING_SELECTION_DOC_STORAGE_KEY, allDocs);
  }

  // Bridge afkir pelaksanaan Seleksi I ke selection_pool sebagai kandidat CULL (PENDING_DECLARATION)
  syncPreGraftingExecutionToSelectionPool(newTx, parentIdx !== -1 ? allDocs[parentIdx] : parentDoc);

  return {
    success: true,
    transaction: newTx,
    parentDocument: parentIdx !== -1 ? allDocs[parentIdx] : parentDoc
  };
}

/**
 * Menghapus transaksi pelaksanaan Seleksi I dan mengkalkulasi ulang Dokumen Induk
 */
export function deleteSeleksi1ExecutionTransaction(txIdOrDocNo, currentUser = null) {
  if (!txIdOrDocNo) {
    throw new Error('ID atau Nomor Transaksi yang akan dihapus tidak valid.');
  }

  const allTxs = storage.get(SELECTION_STORAGE_KEY, []);
  const txIdx = allTxs.findIndex(tx => tx.id === txIdOrDocNo || tx.docNo === txIdOrDocNo || tx.selectionNo === txIdOrDocNo);
  
  if (txIdx === -1) {
    throw new Error(`Transaksi Seleksi I "${txIdOrDocNo}" tidak ditemukan.`);
  }

  const targetTx = allTxs[txIdx];
  const txStatus = String(targetTx.status || '').toUpperCase();
  const txVerifStatus = String(targetTx.verificationStatus || '').toUpperCase();

  // STRATEGI 5-B: Proteksi penghapusan transaksi approved / final
  if (
    txStatus === 'DISETUJUI' ||
    txStatus === 'APPROVED' ||
    txVerifStatus === 'TERVERIFIKASI' ||
    txVerifStatus === 'DISETUJUI' ||
    targetTx.isFinal === true
  ) {
    throw new Error(`Transaksi Seleksi I "${targetTx.docNo || txIdOrDocNo}" telah berstatus DISETUJUI/Final dan tidak dapat dihapus.`);
  }

  assertPreGraftingExecutionCanBeDeleted(targetTx, allTxs);

  const parentDocId = targetTx.parentSelectionDocumentId || targetTx.selectionDocumentId;
  const parentDocNo = targetTx.parentSelectionDocNo || targetTx.selectionDocNo;

  // Remove transaction
  allTxs.splice(txIdx, 1);
  storage.set(SELECTION_STORAGE_KEY, allTxs);

  // Bersihkan kandidat deklarasi di selection_pool jika masih pending
  cleanupPreGraftingExecutionFromSelectionPool(targetTx.id, targetTx.docNo);

  // Recalculate Parent Pre-Grafting Selection Document
  const allDocs = storage.get(PRE_GRAFTING_SELECTION_DOC_STORAGE_KEY, []);
  const parentIdx = allDocs.findIndex(d => d.id === parentDocId || d.docNo === parentDocNo);

  if (parentIdx !== -1) {
    const currentParent = allDocs[parentIdx];
    const parentExecutions = allTxs.filter(tx => {
      const isStage1 = (
        tx.selectionStage === SELECTION_STAGES.SELEKSI_1 ||
        tx.stage === 'SELEKSI_I' ||
        tx.stage === 'SELEKSI_1' ||
        tx.transactionType === 'PELAKSANAAN_SELEKSI_I'
      );
      if (!isStage1) return false;
      return (
        tx.parentSelectionDocumentId === currentParent.id ||
        tx.selectionDocumentId === currentParent.id ||
        tx.parentSelectionDocNo === currentParent.docNo ||
        tx.selectionDocNo === currentParent.docNo
      );
    });

    const sourcePoly = parseInt(currentParent.sourcePolybagQty || 0, 10);
    const sourceBibit = parseInt(currentParent.sourceBibitQty !== undefined ? currentParent.sourceBibitQty : (currentParent.batchTotalBibit || currentParent.initialBibit || sourcePoly), 10);

    const updatedTotalPolyDiperiksa = parentExecutions.reduce((sum, tx) => 
      sum + parseInt(tx.actualPolybagInspectedQty !== undefined ? tx.actualPolybagInspectedQty : (tx.polybagScope !== undefined ? tx.polybagScope : (tx.actualPolybagActiveQty !== undefined ? tx.actualPolybagActiveQty : (tx.initialPolybagCount || 0))), 10), 
      0
    );
    const updatedTotalBibitDiseleksi = parentExecutions.reduce((sum, tx) => 
      sum + getRecordedBibitSelectedQty(tx),
      0
    );
    const updatedTotalLayak = Math.max(0, sourceBibit - updatedTotalBibitDiseleksi);
    const updatedTotalAfkir = updatedTotalBibitDiseleksi;
    const sisaPolybag = Math.max(0, sourcePoly - updatedTotalPolyDiperiksa);
    const isAllPolybagChecked = sourcePoly > 0 && updatedTotalPolyDiperiksa === sourcePoly && sisaPolybag === 0;

    // Preservasi Status Approval Dokumen Induk:
    // Approval dokumen induk yang sah (DISETUJUI / isFinal: true / TERVERIFIKASI) TIDAK BOLEH ditimpa menjadi DRAFT
    const wasAlreadyApproved = (
      currentParent.status === SELECTION_STATUS.DISETUJUI ||
      currentParent.isFinal === true ||
      currentParent.verificationStatus === 'TERVERIFIKASI' ||
      Boolean(currentParent.verifiedAt) ||
      Boolean(currentParent.verifiedByUserId)
    );

    const wasSubmitted = (
      currentParent.status === SELECTION_STATUS.MENUNGGU_VERIFIKASI ||
      currentParent.status === 'DIAJUKAN' ||
      Boolean(currentParent.submittedAt)
    );

    let recalculatedStatus = currentParent.status;
    if (wasAlreadyApproved) {
      recalculatedStatus = SELECTION_STATUS.DISETUJUI;
    } else if (wasSubmitted) {
      recalculatedStatus = isAllPolybagChecked
        ? 'COMPLETED'
        : (parentExecutions.length > 0 ? 'IN_PROGRESS' : 'DRAFT');
    } else {
      recalculatedStatus = isAllPolybagChecked 
        ? 'COMPLETED' 
        : (parentExecutions.length > 0 ? 'IN_PROGRESS' : 'DRAFT');
    }

    const baseUpdatedParent = {
      ...currentParent,
      executionTransactionIds: parentExecutions.map(tx => tx.id),
      executionCount: parentExecutions.length,
      totalDiperiksa: updatedTotalPolyDiperiksa,
      totalPolybagDiperiksa: updatedTotalPolyDiperiksa,
      totalBibitDiseleksi: updatedTotalBibitDiseleksi,
      totalBibitSelectedQty: updatedTotalBibitDiseleksi,
      totalBibitRetainedQty: updatedTotalLayak,
      totalLayak: updatedTotalLayak,
      totalAfkir: updatedTotalAfkir,
      totalReject: updatedTotalAfkir,
      activePolybagQty: updatedTotalPolyDiperiksa,
      currentBibitQty: updatedTotalLayak,
      currentPolybagQty: updatedTotalPolyDiperiksa,
      remainingPolybag: sisaPolybag,
      sisaPolybag: sisaPolybag,
      sisaBibit: Math.max(0, sourceBibit - updatedTotalBibitDiseleksi),
      progress: sourcePoly > 0 ? Math.min(100, Math.max(0, Math.round((updatedTotalPolyDiperiksa / sourcePoly) * 100))) : 0,
      isCompleted: isAllPolybagChecked,
      status: recalculatedStatus,
      verificationStatus: wasSubmitted && !wasAlreadyApproved ? null : currentParent.verificationStatus,
      submissionStatus: wasSubmitted && !wasAlreadyApproved ? null : currentParent.submissionStatus,
      submittedAt: wasSubmitted && !wasAlreadyApproved ? null : currentParent.submittedAt,
      submittedByUserId: wasSubmitted && !wasAlreadyApproved ? null : currentParent.submittedByUserId,
      submittedByName: wasSubmitted && !wasAlreadyApproved ? null : currentParent.submittedByName,
      isFinal: wasAlreadyApproved ? true : Boolean(currentParent.isFinal),
      updatedAt: new Date().toISOString()
    };

    const finalUpdatedParent = currentUser
      ? applyTransactionActor(
          baseUpdatedParent,
          AUDIT_EVENT_TYPES.DELETE,
          currentUser,
          `Penghapusan transaksi pelaksanaan ${targetTx.docNo || targetTx.id} pada bedengan ${targetTx.bedenganCode || '-'}. Sisa eksekusi: ${parentExecutions.length}`
        )
      : baseUpdatedParent;

    allDocs[parentIdx] = finalUpdatedParent;
    storage.set(PRE_GRAFTING_SELECTION_DOC_STORAGE_KEY, allDocs);
    if (wasSubmitted && !wasAlreadyApproved) {
      withdrawPendingPreGraftingVerification(
        currentParent,
        currentUser,
        `Pengajuan ditarik karena sesi ${targetTx.docNo || targetTx.id} dihapus.`
      );
    }
  }

  return { 
    success: true,
    deletedId: targetTx.id,
    parentDocument: parentIdx !== -1 ? allDocs[parentIdx] : null
  };
}

/**
 * =============================================================================
 * TRANSAKSI PELAKSANAAN SELEKSI II (PRA-OKULASI)
 * =============================================================================
 */

/**
 * Mengambil daftar transaksi pelaksanaan Seleksi II yang berelasi dengan Dokumen Seleksi II
 */
export function getSeleksi2ExecutionsByDocument(idOrDocNo) {
  if (!idOrDocNo) return [];
  const searchStr = String(idOrDocNo).trim();
  const allTxs = storage.get(SELECTION_STORAGE_KEY, []);
  
  return allTxs.filter(tx => {
    // STRATEGI 5-A: Pemisahan deklarasi CULL dari pemeriksaan fisik biasa
    if (isCullDocNo(tx.docNo) || isCullDocNo(tx.selectionNo) || isCullDocNo(tx.selectionPoolDocNo)) return false;
    if (tx.originType === 'CULL_DECLARATION' || tx.isCullDeclaration || tx.transactionType === 'PENYELEKSIAN_BIBIT_AFKIR') return false;

    const isStage2 = (
      tx.selectionStage === SELECTION_STAGES.SELEKSI_2 ||
      tx.stage === 'SELEKSI_II' ||
      tx.stage === 'SELEKSI_2' ||
      tx.transactionType === 'PELAKSANAAN_SELEKSI_II'
    );
    if (!isStage2) return false;

    const parentRefs = [tx.parentSelectionDocumentId, tx.selectionDocumentId, tx.parentSelectionDocNo, tx.selectionDocNo, tx.sourceDocNo, tx.sourceSelectionDocNo]
      .filter(Boolean).map(value => String(value).trim());

    return (
      tx.parentSelectionDocumentId === searchStr ||
      tx.selectionDocumentId === searchStr ||
      tx.parentSelectionDocNo === searchStr ||
      tx.selectionDocNo === searchStr ||
      tx.sourceDocNo === searchStr ||
      tx.sourceSelectionDocNo === searchStr ||
      parentRefs.includes(searchStr)
    );
  });
}

/**
 * Menghitung status alokasi dan sisa scope bedengan untuk Dokumen Seleksi II
 */
export function getBedenganScopeStatusForSeleksi2(parentDoc, txsOverride = null) {
  if (!parentDoc) return [];
  
  const executions = Array.isArray(txsOverride) ? txsOverride : getSeleksi2ExecutionsByDocument(parentDoc.id || parentDoc.docNo);
  
  let bedenganList = [];
  if (Array.isArray(parentDoc.rows) && parentDoc.rows.length > 0) {
    bedenganList = parentDoc.rows.map(r => {
      let initPoly = parseInt(r.polybag !== undefined ? r.polybag : (r.polybagCount !== undefined ? r.polybagCount : (r.initialPolybag !== undefined ? r.initialPolybag : 0)), 10);
      let initBibit = resolveSelectionRowBibitQty(r);
      if (parentDoc.rows.length === 1) {
        if (initPoly === 0 && parentDoc.sourcePolybagQty > 0) initPoly = parentDoc.sourcePolybagQty;
        if (initBibit === 0 && parentDoc.sourceBibitQty > 0) initBibit = parentDoc.sourceBibitQty;
        if (initPoly === 0 && initBibit > 0) initPoly = initBibit;
      }
      return {
        bedenganId: r.bedenganId || r.bedenganCode || r.bedengan,
        bedenganCode: formatBedenganDisplayCode(r.bedenganCode || r.bedengan || r.bedenganId),
        initialPolybag: initPoly,
        initialBibit: initBibit
      };
    });
  } else if (Array.isArray(parentDoc.bedenganIds) && parentDoc.bedenganIds.length > 0) {
    const polyPerBed = Math.floor(parentDoc.sourcePolybagQty / parentDoc.bedenganIds.length);
    const remPoly = parentDoc.sourcePolybagQty % parentDoc.bedenganIds.length;
    const bibitPerBed = Math.floor(parentDoc.sourceBibitQty / parentDoc.bedenganIds.length);
    const remBibit = parentDoc.sourceBibitQty % parentDoc.bedenganIds.length;
    bedenganList = parentDoc.bedenganIds.map((bId, idx) => ({
      bedenganId: bId,
      bedenganCode: formatBedenganDisplayCode(bId),
      initialPolybag: polyPerBed + (idx === 0 ? remPoly : 0),
      initialBibit: bibitPerBed + (idx === 0 ? remBibit : 0)
    }));
  } else {
    bedenganList = [{
      bedenganId: parentDoc.bedenganId || 'BED-001',
      bedenganCode: formatBedenganDisplayCode(parentDoc.bedenganCode || parentDoc.bedengan || 'BED-001'),
      initialPolybag: parentDoc.sourcePolybagQty || parentDoc.sourceBibitQty || 0,
      initialBibit: parentDoc.sourceBibitQty || 0
    }];
  }

  // Gunakan populasi final yang tersimpan pada dokumen tahap ini jika tersedia.
  // Saldo tahap sumber hanya memulihkan snapshot bibit yang kosong; jangan
  // menimpa populasi downstream yang valid dengan saldo sumber yang salah terbaca 0.
  const sourceBedScope = getLinkedFinalBedScope(parentDoc, 'SELEKSI_1');
  bedenganList = bedenganList.map(bed => {
    const bedCode = formatBedenganDisplayCode(bed.bedenganCode || bed.bedenganId).toUpperCase();
    const sourceBed = sourceBedScope.find(item =>
      formatBedenganDisplayCode(item.bedenganCode || item.bedenganId).toUpperCase() === bedCode
    );
    if (!sourceBed) return bed;
    const sourceAvailableBibit = Number(sourceBed.maintainedBibit);
    if ((!Number.isFinite(Number(bed.initialBibit)) || Number(bed.initialBibit) <= 0) &&
        Number.isFinite(sourceAvailableBibit) && sourceAvailableBibit > 0) {
      return { ...bed, initialBibit: sourceAvailableBibit };
    }
    return bed;
  });

  const knownBedCodes = new Set(bedenganList.map(bed =>
    formatBedenganDisplayCode(bed.bedenganCode || bed.bedenganId).toUpperCase()
  ));
  sourceBedScope.forEach(sourceBed => {
    const code = formatBedenganDisplayCode(sourceBed.bedenganCode || sourceBed.bedenganId);
    const key = code.toUpperCase();
    if (!code || knownBedCodes.has(key)) return;
    bedenganList.push({
      bedenganId: sourceBed.bedenganId || code,
      bedenganCode: code,
      initialPolybag: Number(sourceBed.inspectedPolybag || sourceBed.initialPolybag || 0),
      initialBibit: Number(sourceBed.maintainedBibit || sourceBed.initialBibit || 0)
    });
    knownBedCodes.add(key);
  });

  // Selaraskan dengan pemilih bedengan: jika data bibit per-bedengan pada
  // dokumen Seleksi II lama kosong, satu polybag menjadi fallback satu bibit.
  // Fallback ini hanya mengisi snapshot kosong dan tidak memakai rasio 1:2.
  bedenganList = bedenganList.map(bed => {
    const initialBibit = Number(bed.initialBibit);
    const initialPolybag = Number(bed.initialPolybag);
    if ((!Number.isFinite(initialBibit) || initialBibit <= 0) &&
        Number.isFinite(initialPolybag) && initialPolybag > 0) {
      return { ...bed, initialBibit: initialPolybag };
    }
    return bed;
  });

  return bedenganList.map(bed => {
    const parentBatch = String(parentDoc.batchCode || parentDoc.batchNo || '').trim().toUpperCase();
    const bedNorm = String(bed.bedenganCode || bed.bedenganId).trim().toUpperCase();
    const bedTxs = executions.filter(tx => {
      const txBatch = String(tx.batchCode || tx.batchNo || tx.sourceBatchCode || '').trim().toUpperCase();
      if (parentBatch && txBatch && txBatch !== parentBatch) return false;
      const txBed = String(tx.bedenganCode || tx.bedengan || tx.bedenganId || '').trim().toUpperCase();
      if (!txBed && bedenganList.length === 1) return true;
      return txBed === bedNorm || txBed === String(bed.bedenganId).toUpperCase();
    });

    const inspectedPolybag = bedTxs.reduce((sum, tx) => sum + parseInt(tx.actualPolybagInspectedQty !== undefined ? tx.actualPolybagInspectedQty : (tx.polybagScope !== undefined ? tx.polybagScope : (tx.actualPolybagActiveQty !== undefined ? tx.actualPolybagActiveQty : (tx.initialPolybagCount || 0))), 10), 0);
    const rejectedBibit = bedTxs.reduce((sum, tx) => sum + getRecordedBibitSelectedQty(tx), 0);
    const maintainedBibit = bed.initialBibit > 0 ? Math.max(0, bed.initialBibit - rejectedBibit) : 0;
    const inspectedBibit = bed.initialPolybag > 0
      ? Math.min(bed.initialBibit, Math.round((inspectedPolybag / bed.initialPolybag) * bed.initialBibit))
      : (inspectedPolybag > 0 ? inspectedPolybag : 0);
    const remainingPolybag = bed.initialPolybag > 0 ? Math.max(0, bed.initialPolybag - inspectedPolybag) : 0;
    const remainingBibit = maintainedBibit;

    return {
      ...bed,
      inspectedPolybag,
      inspectedBibit,
      maintainedBibit,
      availableBibit: maintainedBibit,
      rejectedBibit,
      remainingPolybag,
      remainingBibit,
      isFullyInspected: bed.initialPolybag > 0 && remainingPolybag === 0 && bedTxs.length > 0
    };
  });
}

/**
 * Membaca populasi bibit bedengan dengan kompatibilitas untuk data lama yang
 * memiliki sourceBibitQty = 0 tetapi masih menyimpan jumlah benar pada disemai.
 */
function resolveSelectionRowBibitQty(row, fallback = 0) {
  if (!row) return Math.max(0, parseInt(fallback, 10) || 0);
  const candidates = [row.disemai, row.sourceBibitQty, row.initialBibit];
  for (const value of candidates) {
    if (value === undefined || value === null || String(value).trim() === '') continue;
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  for (const value of candidates) {
    if (value === undefined || value === null || String(value).trim() === '') continue;
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed === 0) return 0;
  }
  return Math.max(0, parseInt(fallback, 10) || 0);
}

function getLinkedFinalBedScope(parentDoc, expectedStage) {
  if (!parentDoc) return [];
  const allDocs = storage.get(PRE_GRAFTING_SELECTION_DOC_STORAGE_KEY, []);
  const linkedRefs = [
    parentDoc.sourceSelectionDocumentId,
    parentDoc.sourceFinalId,
    parentDoc.sourceSelectionDocNo,
    parentDoc.sourceDocNo
  ].filter(Boolean).map(String);
  const normalizedExpectedStage = String(expectedStage || '').toUpperCase();
  const sourceDoc = allDocs.find(doc => {
    const stage = String(doc.selectionStage || '').toUpperCase();
    const stageMatches = normalizedExpectedStage === 'SELEKSI_1'
      ? ['SELEKSI_1', 'SELEKSI_I'].includes(stage)
      : ['SELEKSI_2', 'SELEKSI_II'].includes(stage);
    if (!stageMatches) return false;
    return linkedRefs.includes(String(doc.id)) || linkedRefs.includes(String(doc.docNo));
  });
  if (!sourceDoc) return [];

  if (normalizedExpectedStage === 'SELEKSI_1') {
    const executions = getSeleksi1ExecutionsByDocument(sourceDoc.id || sourceDoc.docNo);
    return getBedenganScopeStatusForSeleksi1(sourceDoc, executions);
  }
  const executions = getSeleksi2ExecutionsByDocument(sourceDoc.id || sourceDoc.docNo);
  return getBedenganScopeStatusForSeleksi2(sourceDoc, executions);
}

/**
 * Validasi payload transaksi pelaksanaan Seleksi II
 * Mendukung model kuantitas baru (actualPolybagInspectedQty, actualBibitSelectedQty) dan Legacy
 */
export function validateSeleksi2Execution(payload, parentDoc, existingTxs = [], options = {}) {
  const errors = [];
  if (!payload) {
    return { isValid: false, errors: ['Data transaksi Seleksi II tidak boleh kosong.'] };
  }
  if (!parentDoc) {
    return { isValid: false, errors: ['Dokumen Seleksi II (parent) tidak ditemukan.'] };
  }

  const stage = String(parentDoc.selectionStage || '').toUpperCase();
  if (stage !== 'SELEKSI_II' && stage !== 'SELEKSI_2') {
    errors.push(`Parent document bukan merupakan Dokumen Seleksi II (stage: ${parentDoc.selectionStage}).`);
  }

  // 1. Bedengan validation
  const bedenganCode = String(payload.bedenganCode || payload.bedengan || payload.bedenganId || '').trim();
  if (!bedenganCode) {
    errors.push('Bedengan yang diperiksa wajib dipilih.');
  }

  const bedScopeList = getBedenganScopeStatusForSeleksi2(parentDoc, existingTxs);
  const bedNorm = formatBedenganDisplayCode(bedenganCode).toUpperCase();
  const matchedBed = bedScopeList.find(b => 
    formatBedenganDisplayCode(b.bedenganCode).toUpperCase() === bedNorm ||
    String(b.bedenganId).toUpperCase() === String(payload.bedenganId || '').toUpperCase() ||
    String(b.bedenganCode).toUpperCase() === bedNorm
  );

  if (!matchedBed) {
    errors.push(`Bedengan ${bedenganCode} tidak termasuk dalam scope Dokumen Seleksi II ${parentDoc.docNo}.`);
  }

  const maxPolybagScope = matchedBed ? matchedBed.remainingPolybag : parseInt(parentDoc.sourcePolybagQty || 0, 10);
  const sourceBibit = parseInt(parentDoc.sourceBibitQty !== undefined ? parentDoc.sourceBibitQty : (parentDoc.sourcePolybagQty || 0), 10);

  // Parse 2 canonical inputs: Jlh Polybag Diperiksa & Jlh Bibit Diseleksi (Minimum 0)
  const rawPoly2 = payload.actualPolybagInspectedQty !== undefined
    ? payload.actualPolybagInspectedQty
    : (payload.polybagScope !== undefined
        ? payload.polybagScope
        : (payload.actualPolybagActiveQty !== undefined ? payload.actualPolybagActiveQty : payload.polybagAktif));

  const rawBibit2 = payload.actualBibitSelectedQty !== undefined
    ? payload.actualBibitSelectedQty
    : (payload.selectedBibitScopeQty !== undefined
        ? payload.selectedBibitScopeQty
        : (payload.jumlahDiperiksa !== undefined ? payload.jumlahDiperiksa : undefined));

  let actualPolyInspected = 0;
  if (rawPoly2 === undefined || rawPoly2 === null || String(rawPoly2).trim() === '') {
    errors.push('Jumlah polybag diperiksa wajib diisi.');
  } else {
    actualPolyInspected = Number(rawPoly2);
    if (isNaN(actualPolyInspected)) {
      errors.push('Jumlah polybag diperiksa harus berupa angka yang valid.');
    } else if (actualPolyInspected < 0) {
      errors.push('Jumlah polybag diperiksa tidak boleh negatif (minimum 0).');
    } else if (actualPolyInspected > maxPolybagScope) {
      errors.push(`Jumlah polybag diperiksa (${actualPolyInspected}) melebihi sisa scope polybag yang tersedia (${maxPolybagScope}).`);
    }
  }

  // Hitung otomatis Bibit Dipertahankan secara kumulatif terlebih dahulu agar aman dari TDZ
  const existingBibitSelectedSum = existingTxs.reduce((sum, tx) => sum + getRecordedBibitSelectedQty(tx), 0);

  const maxBibitBedengan2 = matchedBed 
    ? (matchedBed.initialBibit !== undefined ? matchedBed.initialBibit : (matchedBed.initialPolybag || 0)) 
    : sourceBibit;
  const existingBibitOnBed2 = matchedBed ? (matchedBed.rejectedBibit || 0) : existingBibitSelectedSum;
  const availableBibit2 = Math.max(0, maxBibitBedengan2 - existingBibitOnBed2);

  let actualBibitSelected = 0;
  if (rawBibit2 === undefined || rawBibit2 === null || String(rawBibit2).trim() === '') {
    errors.push('Jumlah bibit diseleksi wajib diisi.');
  } else {
    actualBibitSelected = Number(rawBibit2);
    if (isNaN(actualBibitSelected)) {
      errors.push('Jumlah bibit diseleksi harus berupa angka yang valid.');
    } else if (actualBibitSelected < 0) {
      errors.push('Jumlah bibit diseleksi tidak boleh negatif (minimum 0).');
    } else if (actualBibitSelected > availableBibit2) {
      errors.push(`Jumlah bibit diseleksi (${actualBibitSelected}) melebihi Bibit Tersedia (${availableBibit2}).`);
    }
  }

  const selectedReason2 = String(payload.alasan || payload.category || payload.alasanAfkir || payload.alasanDitolakCategory || '').trim();
  const isReasonRequired2 = options && options.requireAlasan !== undefined 
    ? Boolean(options.requireAlasan) 
    : Boolean(payload.requireAlasan);
  if (isReasonRequired2 && actualBibitSelected > 0 && !selectedReason2) {
    errors.push('Alasan wajib dipilih jika ada bibit afkir.');
  }

  // Saldo transaksi adalah saldo per bedengan, bukan saldo seluruh dokumen.
  // Pemeriksaan polybag tidak mengurangi bibit; hanya bibit yang diseleksi
  // pada bedengan tersebut yang mengurangi saldo tersedia.
  const selectedOnBedAfter = (matchedBed?.rejectedBibit || 0) + (isNaN(actualBibitSelected) ? 0 : actualBibitSelected);
  const retainedBasis = matchedBed && Number.isFinite(Number(matchedBed.initialBibit))
    ? Number(matchedBed.initialBibit)
    : sourceBibit;
  const cumulativeBibitRetained = Math.max(0, retainedBasis - (matchedBed ? selectedOnBedAfter : existingBibitSelectedSum + (isNaN(actualBibitSelected) ? 0 : actualBibitSelected)));

  const polyScope = actualPolyInspected;
  const inactivePolybagQty = 0;
  const selectedBibitScopeQty = actualBibitSelected;
  const bibitReject = actualBibitSelected;
  const bibitAwal = maxBibitBedengan2 || sourceBibit;

  // 4. Photo Evidence Validation (Wajib minimal 1 foto dengan watermark GPS)
  const isPhotoRequired = options && options.requirePhoto !== undefined 
    ? Boolean(options.requirePhoto) 
    : Boolean(payload.requirePhoto || payload.fromUI);
  if (isPhotoRequired) {
    const photo = payload.photo || payload.photoEvidence || (Array.isArray(payload.photos) && payload.photos[0]);
    const photoDataUrl = (typeof photo === 'object' && photo !== null) ? (photo.dataUrl || photo.src || photo.url) : (typeof photo === 'string' ? photo : null);
    if (!photoDataUrl || typeof photoDataUrl !== 'string' || !photoDataUrl.startsWith('data:image/')) {
      errors.push('Foto bukti pemeriksaan seleksi wajib dilampirkan (minimal 1 foto dengan koordinat GPS aktual).');
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    parsed: {
      bedenganId: matchedBed ? matchedBed.bedenganId : (payload.bedenganId || bedenganCode),
      bedenganCode: matchedBed ? matchedBed.bedenganCode : bedenganCode,
      polybagScope: polyScope,
      actualPolybagInspectedQty: actualPolyInspected,
      actualPolybagActiveQty: actualPolyInspected,
      actualBibitSelectedQty: actualBibitSelected,
      actualBibitRetainedQty: cumulativeBibitRetained,
      inactivePolybagQty,
      selectedBibitScopeQty,
      activePolybagQty: actualPolyInspected,
      totalLayak: cumulativeBibitRetained,
      bibitAwal,
      jumlahDiperiksa: bibitAwal,
      bibitDipertahankan: cumulativeBibitRetained,
      bibitReject,
      photo: payload.photo || null,
      photoEvidence: payload.photo?.dataUrl || payload.photoEvidence || (Array.isArray(payload.photos) && payload.photos[0]) || null,
      photos: payload.photo?.dataUrl ? [payload.photo.dataUrl] : (Array.isArray(payload.photos) ? payload.photos : [])
    }
  };
}

/**
 * Membuat transaksi pelaksanaan Seleksi II baru oleh Mantri Bibitan
 */
export function createSeleksi2ExecutionTransaction(payload, currentUser, options = {}) {
  const allTxs = storage.get(SELECTION_STORAGE_KEY, []);

  // PENGAMANAN IDEMPOTENSI: Periksa payload.id dan payload.clientRequestId sebelum validasi/eksekusi
  const reqId = payload.id ? String(payload.id).trim() : null;
  const clientReqId = payload.clientRequestId ? String(payload.clientRequestId).trim() : null;
  if (reqId || clientReqId) {
    const existingTx = allTxs.find(tx => 
      (reqId && String(tx.id) === reqId) ||
      (clientReqId && tx.clientRequestId && String(tx.clientRequestId) === clientReqId)
    );
    if (existingTx) {
      const allDocs = storage.get(PRE_GRAFTING_SELECTION_DOC_STORAGE_KEY, []);
      const parentDocId = payload.selectionDocumentId || payload.selectionDocNo || payload.docNo || existingTx.parentSelectionDocumentId || existingTx.selectionDocumentId;
      const parentDoc = allDocs.find(d => d.id === parentDocId || d.docNo === parentDocId) || null;
      return {
        success: true,
        transaction: existingTx,
        parentDocument: parentDoc,
        isDuplicate: true
      };
    }
  }

  // GLOBAL ATTENDANCE GATE
  assertAttendanceGateOrThrow(currentUser);

  const parentDocId = payload.selectionDocumentId || payload.selectionDocNo || payload.docNo;
  const parentDoc = getPreGraftingSelectionDocumentById(parentDocId);
  if (!parentDoc) {
    throw new Error(`Dokumen Seleksi II dengan identitas "${parentDocId}" tidak ditemukan.`);
  }

  const existingExecutions = getSeleksi2ExecutionsByDocument(parentDoc.id);
  const val = validateSeleksi2Execution(payload, parentDoc, existingExecutions, options);
  if (!val.isValid) {
    throw new Error(val.errors.join(' '));
  }
  
  // Generate Transaction Document Number
  let maxSeq = 0;
  allTxs.forEach(tx => {
    const d = String(tx.docNo || tx.selectionNo || '');
    const match = d.match(/SEL-II(?:-TX)?\/(\d+)/i) || d.match(/(\d+)$/);
    if (match) {
      const num = parseInt(match[1], 10);
      if (!isNaN(num) && num > maxSeq) maxSeq = num;
    }
  });

  const txSeq = maxSeq + 1;
  const txDocNo = payload.docNo || formatStandardDocNo(2026, 'SEL-II', txSeq);
  const today = payload.tanggalSeleksi || payload.date || getEffectiveTodayDDMMYYYY();

  const txRecord = {
    id: payload.id || `SEL2-TX-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    clientRequestId: clientReqId || null,
    docNo: txDocNo,
    selectionNo: txDocNo,
    transactionType: 'PELAKSANAAN_SELEKSI_II',
    selectionType: SELECTION_TYPES.PRA_OKULASI,
    selectionStage: SELECTION_STAGES.SELEKSI_2,
    
    // Parent Document relation
    selectionDocumentId: parentDoc.id,
    selectionDocNo: parentDoc.docNo,
    parentSelectionDocumentId: parentDoc.id,
    parentSelectionDocNo: parentDoc.docNo,
    
    // Traceability to Seleksi I FINAL and Seeding
    sourceModule: 'SELEKSI',
    sourceSelectionStage: SELECTION_STAGES.SELEKSI_1,
    sourceSelectionType: SELECTION_TYPES.PRA_OKULASI,
    sourceSelectionDocumentId: parentDoc.sourceSelectionDocumentId,
    sourceSelectionDocNo: parentDoc.sourceSelectionDocNo,
    sourceFinalId: parentDoc.sourceFinalId || parentDoc.sourceSelectionDocumentId,
    sourceFinalStatus: SELECTION_STATUS.DISETUJUI,
    sourceDocNo: parentDoc.docNo,
    sourceSeedingDocNo: parentDoc.sourceSeedingDocNo || '-',
    
    // Master & Scope Contexts
    batchId: parentDoc.batchId,
    batchCode: parentDoc.batchCode,
    batchNo: parentDoc.batchCode,
    programId: parentDoc.programId,
    programCode: parentDoc.programCode,
    programName: parentDoc.programName,
    estateId: parentDoc.estateId || currentUser?.estateId,
    estateName: parentDoc.estateName || currentUser?.estateName,
    divisionId: parentDoc.divisionId || currentUser?.divisionId,
    divisionName: parentDoc.divisionName || currentUser?.divisionName,
    clone: parentDoc.clone,
    klon: parentDoc.klon,
    growthStage: 'Rubber Main Nursery (Seleksi II)',
    
    bedenganId: val.parsed.bedenganId,
    bedenganCode: val.parsed.bedenganCode,
    bedengan: val.parsed.bedenganCode,
    
    // Population Breakdown & Quantities
    polybagScope: val.parsed.actualPolybagInspectedQty,
    initialPolybagCount: val.parsed.actualPolybagInspectedQty,
    sourcePolybagQty: parentDoc.sourcePolybagQty,
    sourceBibitQty: parentDoc.sourceBibitQty,
    bibitAwal: val.parsed.bibitAwal,
    jumlahDiperiksa: val.parsed.jumlahDiperiksa,
    
    // Canonical Quantities
    actualPolybagInspectedQty: val.parsed.actualPolybagInspectedQty,
    actualBibitSelectedQty: val.parsed.actualBibitSelectedQty,
    actualBibitRetainedQty: val.parsed.actualBibitRetainedQty,
    actualPolybagActiveQty: val.parsed.actualPolybagInspectedQty,
    activePolybagQty: val.parsed.actualPolybagInspectedQty,
    selectedBibitScopeQty: val.parsed.actualBibitSelectedQty,
    totalLayak: val.parsed.actualBibitRetainedQty,
    bibitDipertahankan: val.parsed.actualBibitRetainedQty,
    jumlahLayak: val.parsed.actualBibitRetainedQty,
    bibitReject: val.parsed.actualBibitSelectedQty,
    jumlahAfkir: val.parsed.actualBibitSelectedQty,
    
    // Reject Source Reference
    rejectSourceReference: {
      stage: SELECTION_STAGES.SELEKSI_2,
      parentDocNo: parentDoc.docNo,
      sourceSelectionDocNo: parentDoc.sourceSelectionDocNo,
      sourceSeedingDocNo: parentDoc.sourceSeedingDocNo,
      bedenganCode: val.parsed.bedenganCode,
      rejectCount: val.parsed.actualBibitSelectedQty,
      reason: val.parsed.alasan || 'Bibit kecil/terhambat saat Seleksi II'
    },
    alasan: val.parsed.alasan || '',
    category: val.parsed.category || '',
    alasanAfkir: val.parsed.alasanAfkir || '',
    alasanDitolakCategory: val.parsed.alasanDitolakCategory || '',
    
    tanggalSeleksi: today,
    tanggal: today,
    catatan: payload.catatan || payload.remarks || '-',
    
    // Photo Evidence Documentation
    photo: payload.photo ? {
      id: payload.photo.id || `PHOTO-SEL2-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      dataUrl: payload.photo.dataUrl,
      capturedAt: payload.photo.capturedAt,
      capturedAtLabel: payload.photo.capturedAtLabel,
      latitude: payload.photo.latitude,
      longitude: payload.photo.longitude,
      batchCode: val.parsed.batchCode || parentDoc.batchCode,
      bedenganCode: val.parsed.bedenganCode,
      source: 'CAMERA'
    } : null,
    photoEvidence: payload.photo?.dataUrl || payload.photoEvidence || (Array.isArray(payload.photos) && payload.photos[0]) || null,
    photos: payload.photo?.dataUrl ? [payload.photo.dataUrl] : (Array.isArray(payload.photos) ? payload.photos : []),
    hasPhotoEvidence: Boolean(payload.photo?.dataUrl || payload.photoEvidence || (Array.isArray(payload.photos) && payload.photos.length > 0)),

    status: 'RECORDED',
    stockMutationStatus: 'NOT_REQUIRED',
    
    createdByUserId: currentUser?.userId || currentUser?.code || currentUser?.id || 'MANTRI',
    createdByName: currentUser?.name || 'Mantri Bibitan',
    createdByRole: currentUser?.role || 'MANTRI_TANAMAN',
    createdAt: new Date().toISOString()
  };

  const newTx = currentUser 
    ? applyTransactionActor(txRecord, AUDIT_EVENT_TYPES.CREATE, currentUser, `Pelaksanaan Seleksi II pada ${val.parsed.bedenganCode} (${val.parsed.actualPolybagInspectedQty} Polybag, ${val.parsed.actualBibitSelectedQty} Bibit Diseleksi)`)
    : txRecord;

  // 1. Save execution transaction to selection_transactions
  allTxs.push(newTx);
  storage.set(SELECTION_STORAGE_KEY, allTxs);

  // 2. Update Parent Dokumen Seleksi II
  const allDocs = storage.get(PRE_GRAFTING_SELECTION_DOC_STORAGE_KEY, []);
  const parentIdx = allDocs.findIndex(d => d.id === parentDoc.id || d.docNo === parentDoc.docNo);
  
  if (parentIdx !== -1) {
    const currentParent = allDocs[parentIdx];
    const parentExecutions = allTxs.filter(tx => {
      const isStage2 = (
        tx.selectionStage === SELECTION_STAGES.SELEKSI_2 ||
        tx.stage === 'SELEKSI_II' ||
        tx.stage === 'SELEKSI_2' ||
        tx.transactionType === 'PELAKSANAAN_SELEKSI_II'
      );
      if (!isStage2) return false;
      return (
        tx.parentSelectionDocumentId === currentParent.id ||
        tx.selectionDocumentId === currentParent.id ||
        tx.parentSelectionDocNo === currentParent.docNo ||
        tx.selectionDocNo === currentParent.docNo
      );
    });

    const sourcePoly = parseInt(currentParent.sourcePolybagQty || 0, 10);
    const sourceBibit = parseInt(currentParent.sourceBibitQty !== undefined ? currentParent.sourceBibitQty : sourcePoly, 10);

    const updatedTotalPolyDiperiksa = parentExecutions.reduce((sum, tx) => 
      sum + parseInt(tx.actualPolybagInspectedQty !== undefined ? tx.actualPolybagInspectedQty : (tx.polybagScope !== undefined ? tx.polybagScope : (tx.actualPolybagActiveQty !== undefined ? tx.actualPolybagActiveQty : (tx.initialPolybagCount || 0))), 10), 
      0
    );
    const updatedTotalBibitDiseleksi = parentExecutions.reduce((sum, tx) => 
      sum + getRecordedBibitSelectedQty(tx),
      0
    );
    const updatedTotalLayak = Math.max(0, sourceBibit - updatedTotalBibitDiseleksi);
    const updatedTotalAfkir = updatedTotalBibitDiseleksi;
    const sisaPolybag = Math.max(0, sourcePoly - updatedTotalPolyDiperiksa);
    const isAllPolybagChecked = sourcePoly > 0 && updatedTotalPolyDiperiksa === sourcePoly && sisaPolybag === 0;

    allDocs[parentIdx] = {
      ...currentParent,
      executionTransactionIds: parentExecutions.map(tx => tx.id),
      executionCount: parentExecutions.length,
      totalDiperiksa: updatedTotalPolyDiperiksa,
      totalPolybagDiperiksa: updatedTotalPolyDiperiksa,
      totalBibitDiseleksi: updatedTotalBibitDiseleksi,
      totalBibitSelectedQty: updatedTotalBibitDiseleksi,
      totalBibitRetainedQty: updatedTotalLayak,
      totalLayak: updatedTotalLayak,
      totalAfkir: updatedTotalAfkir,
      totalReject: updatedTotalAfkir,
      activePolybagQty: updatedTotalPolyDiperiksa,
      currentBibitQty: updatedTotalLayak,
      currentPolybagQty: updatedTotalPolyDiperiksa,
      remainingPolybag: sisaPolybag,
      sisaPolybag: sisaPolybag,
      sisaBibit: Math.max(0, sourceBibit - updatedTotalBibitDiseleksi),
      progress: sourcePoly > 0 ? Math.min(100, Math.max(0, Math.round((updatedTotalPolyDiperiksa / sourcePoly) * 100))) : 0,
      isCompleted: isAllPolybagChecked,
      status: isAllPolybagChecked 
        ? 'COMPLETED'
        : (parentExecutions.length > 0 ? 'IN_PROGRESS' : 'DRAFT'),
      verificationStatus: isAllPolybagChecked ? null : currentParent.verificationStatus,
      returnReason: isAllPolybagChecked ? null : currentParent.returnReason,
      isCorrected: isAllPolybagChecked ? true : Boolean(currentParent.isCorrected),
      updatedAt: new Date().toISOString()
    };

    storage.set(PRE_GRAFTING_SELECTION_DOC_STORAGE_KEY, allDocs);
  }

  // Bridge afkir pelaksanaan Seleksi II ke selection_pool sebagai kandidat CULL (PENDING_DECLARATION)
  syncPreGraftingExecutionToSelectionPool(newTx, parentIdx !== -1 ? allDocs[parentIdx] : parentDoc);

  return {
    success: true,
    transaction: newTx,
    parentDocument: parentIdx !== -1 ? allDocs[parentIdx] : parentDoc
  };
}

/**
 * Menghapus transaksi pelaksanaan Seleksi II dan mengkalkulasi ulang Dokumen Induk
 */
export function deleteSeleksi2ExecutionTransaction(transactionId, currentUser = null) {
  const allTxs = storage.get(SELECTION_STORAGE_KEY, []);
  const targetIdx = allTxs.findIndex(tx => tx.id === transactionId || tx.docNo === transactionId || tx.selectionNo === transactionId);
  if (targetIdx === -1) {
    throw new Error('Transaksi Seleksi II tidak ditemukan.');
  }

  const targetTx = allTxs[targetIdx];
  const txStatus = String(targetTx.status || '').toUpperCase();
  const txVerifStatus = String(targetTx.verificationStatus || '').toUpperCase();

  // STRATEGI 5-B: Proteksi penghapusan transaksi approved / final
  if (
    txStatus === 'DISETUJUI' ||
    txStatus === 'APPROVED' ||
    txVerifStatus === 'TERVERIFIKASI' ||
    txVerifStatus === 'DISETUJUI' ||
    targetTx.isFinal === true
  ) {
    throw new Error(`Transaksi Seleksi II "${targetTx.docNo || transactionId}" telah berstatus DISETUJUI/Final dan tidak dapat dihapus.`);
  }

  assertPreGraftingExecutionCanBeDeleted(targetTx, allTxs);

  allTxs.splice(targetIdx, 1);
  storage.set(SELECTION_STORAGE_KEY, allTxs);

  // Bersihkan kandidat deklarasi di selection_pool jika masih pending
  cleanupPreGraftingExecutionFromSelectionPool(targetTx.id, targetTx.docNo);

  // Re-aggregate Parent Dokumen Seleksi II
  const allDocs = storage.get(PRE_GRAFTING_SELECTION_DOC_STORAGE_KEY, []);
  const parentIdx = allDocs.findIndex(d => 
    d.id === targetTx.selectionDocumentId || 
    d.id === targetTx.parentSelectionDocumentId || 
    d.docNo === targetTx.selectionDocNo ||
    d.docNo === targetTx.parentSelectionDocNo
  );

  if (parentIdx !== -1) {
    const currentParent = allDocs[parentIdx];
    const parentExecutions = allTxs.filter(tx => {
      const isStage2 = (
        tx.selectionStage === SELECTION_STAGES.SELEKSI_2 ||
        tx.selectionStage === 'SELEKSI_II' ||
        tx.selectionStage === 'SELEKSI_2' ||
        tx.stage === 'SELEKSI_II' ||
        tx.stage === 'SELEKSI_2' ||
        tx.transactionType === 'PELAKSANAAN_SELEKSI_II'
      );
      if (!isStage2) return false;
      return (
        tx.parentSelectionDocumentId === currentParent.id ||
        tx.selectionDocumentId === currentParent.id ||
        tx.parentSelectionDocNo === currentParent.docNo ||
        tx.selectionDocNo === currentParent.docNo
      );
    });

    const sourcePoly = parseInt(currentParent.sourcePolybagQty || 0, 10);
    const sourceBibit = parseInt(currentParent.sourceBibitQty !== undefined ? currentParent.sourceBibitQty : sourcePoly, 10);

    const updatedTotalPolyDiperiksa = parentExecutions.reduce((sum, tx) => 
      sum + parseInt(tx.actualPolybagInspectedQty !== undefined ? tx.actualPolybagInspectedQty : (tx.polybagScope !== undefined ? tx.polybagScope : (tx.actualPolybagActiveQty !== undefined ? tx.actualPolybagActiveQty : (tx.initialPolybagCount || 0))), 10), 
      0
    );
    const updatedTotalBibitDiseleksi = parentExecutions.reduce((sum, tx) => 
      sum + getRecordedBibitSelectedQty(tx),
      0
    );
    const updatedTotalLayak = Math.max(0, sourceBibit - updatedTotalBibitDiseleksi);
    const updatedTotalAfkir = updatedTotalBibitDiseleksi;
    const sisaPolybag = Math.max(0, sourcePoly - updatedTotalPolyDiperiksa);
    const isAllPolybagChecked = sourcePoly > 0 && updatedTotalPolyDiperiksa === sourcePoly && sisaPolybag === 0;

    // Preservasi Status Approval Dokumen Induk:
    const wasAlreadyApproved = (
      currentParent.status === SELECTION_STATUS.DISETUJUI ||
      currentParent.isFinal === true ||
      currentParent.verificationStatus === 'TERVERIFIKASI' ||
      Boolean(currentParent.verifiedAt) ||
      Boolean(currentParent.verifiedByUserId)
    );

    const wasSubmitted = (
      currentParent.status === SELECTION_STATUS.MENUNGGU_VERIFIKASI ||
      currentParent.status === 'DIAJUKAN' ||
      Boolean(currentParent.submittedAt)
    );

    let recalculatedStatus = currentParent.status;
    if (wasAlreadyApproved) {
      recalculatedStatus = SELECTION_STATUS.DISETUJUI;
    } else if (wasSubmitted) {
      recalculatedStatus = isAllPolybagChecked
        ? 'COMPLETED'
        : (parentExecutions.length > 0 ? 'IN_PROGRESS' : 'DRAFT');
    } else {
      recalculatedStatus = isAllPolybagChecked 
        ? 'COMPLETED' 
        : (parentExecutions.length > 0 ? 'IN_PROGRESS' : 'DRAFT');
    }

    const baseUpdatedParent = {
      ...currentParent,
      executionTransactionIds: parentExecutions.map(tx => tx.id),
      executionCount: parentExecutions.length,
      totalDiperiksa: updatedTotalPolyDiperiksa,
      totalPolybagDiperiksa: updatedTotalPolyDiperiksa,
      totalBibitDiseleksi: updatedTotalBibitDiseleksi,
      totalBibitSelectedQty: updatedTotalBibitDiseleksi,
      totalBibitRetainedQty: updatedTotalLayak,
      totalLayak: updatedTotalLayak,
      totalAfkir: updatedTotalAfkir,
      totalReject: updatedTotalAfkir,
      activePolybagQty: updatedTotalPolyDiperiksa,
      currentBibitQty: updatedTotalLayak,
      currentPolybagQty: updatedTotalPolyDiperiksa,
      remainingPolybag: sisaPolybag,
      sisaPolybag: sisaPolybag,
      sisaBibit: Math.max(0, sourceBibit - updatedTotalBibitDiseleksi),
      progress: sourcePoly > 0 ? Math.min(100, Math.max(0, Math.round((updatedTotalPolyDiperiksa / sourcePoly) * 100))) : 0,
      isCompleted: isAllPolybagChecked,
      status: recalculatedStatus,
      verificationStatus: wasSubmitted && !wasAlreadyApproved ? null : currentParent.verificationStatus,
      submissionStatus: wasSubmitted && !wasAlreadyApproved ? null : currentParent.submissionStatus,
      submittedAt: wasSubmitted && !wasAlreadyApproved ? null : currentParent.submittedAt,
      submittedByUserId: wasSubmitted && !wasAlreadyApproved ? null : currentParent.submittedByUserId,
      submittedByName: wasSubmitted && !wasAlreadyApproved ? null : currentParent.submittedByName,
      isFinal: wasAlreadyApproved ? true : Boolean(currentParent.isFinal),
      updatedAt: new Date().toISOString()
    };

    const finalUpdatedParent = currentUser
      ? applyTransactionActor(
          baseUpdatedParent,
          AUDIT_EVENT_TYPES.DELETE,
          currentUser,
          `Penghapusan transaksi pelaksanaan Seleksi II ${targetTx.docNo || targetTx.id} pada bedengan ${targetTx.bedenganCode || '-'}. Sisa eksekusi: ${parentExecutions.length}`
        )
      : baseUpdatedParent;

    allDocs[parentIdx] = finalUpdatedParent;
    storage.set(PRE_GRAFTING_SELECTION_DOC_STORAGE_KEY, allDocs);
    if (wasSubmitted && !wasAlreadyApproved) {
      withdrawPendingPreGraftingVerification(
        currentParent,
        currentUser,
        `Pengajuan ditarik karena sesi ${targetTx.docNo || targetTx.id} dihapus.`
      );
    }
  }

  return { 
    success: true,
    deletedId: targetTx.id,
    parentDocument: parentIdx !== -1 ? allDocs[parentIdx] : null
  };
}

/**
 * Mengambil seluruh transaksi pelaksanaan untuk sebuah Dokumen Seleksi III
 */
export function getSeleksi3ExecutionsByDocument(idOrDocNo) {
  if (!idOrDocNo) return [];
  const allTxs = storage.get(SELECTION_STORAGE_KEY, []);
  const searchStr = String(idOrDocNo).trim();
  
  return allTxs.filter(tx => {
    // STRATEGI 5-A: Pemisahan deklarasi CULL dari pemeriksaan fisik biasa
    if (isCullDocNo(tx.docNo) || isCullDocNo(tx.selectionNo) || isCullDocNo(tx.selectionPoolDocNo)) return false;
    if (tx.originType === 'CULL_DECLARATION' || tx.isCullDeclaration || tx.transactionType === 'PENYELEKSIAN_BIBIT_AFKIR') return false;

    const isStage3 = (
      tx.transactionType === 'PELAKSANAAN_SELEKSI_III' ||
      tx.selectionStage === SELECTION_STAGES.SELEKSI_3 ||
      tx.selectionStage === 'SELEKSI_3' ||
      tx.selectionStage === 'SELEKSI_III' ||
      tx.stage === 'SELEKSI_III' ||
      tx.stage === 'SELEKSI_3' ||
      tx.parentDocId === searchStr
    );
    if (!isStage3) return false;
    
    return (
      tx.selectionDocumentId === searchStr ||
      tx.parentSelectionDocumentId === searchStr ||
      tx.parentDocId === searchStr ||
      tx.parentSelectionDocNo === searchStr ||
      tx.selectionDocNo === searchStr ||
      tx.sourceDocNo === searchStr ||
      tx.sourceSelectionDocNo === searchStr
    );
  });
}

/**
 * Menghitung status alokasi dan sisa scope bedengan untuk Dokumen Seleksi III
 */
export function getBedenganScopeStatusForSeleksi3(parentDoc, txsOverride = null) {
  if (!parentDoc) return [];
  
  const executions = Array.isArray(txsOverride) ? txsOverride : getSeleksi3ExecutionsByDocument(parentDoc.id || parentDoc.docNo);
  
  let bedenganList = [];
  if (Array.isArray(parentDoc.rows) && parentDoc.rows.length > 0) {
    bedenganList = parentDoc.rows.map(r => {
      let initPoly = parseInt(r.polybag !== undefined ? r.polybag : (r.polybagCount !== undefined ? r.polybagCount : (r.initialPolybag !== undefined ? r.initialPolybag : 0)), 10);
      let initBibit = resolveSelectionRowBibitQty(r);
      if (parentDoc.rows.length === 1) {
        if (initPoly === 0 && parentDoc.sourcePolybagQty > 0) initPoly = parentDoc.sourcePolybagQty;
        if (initBibit === 0 && parentDoc.sourceBibitQty > 0) initBibit = parentDoc.sourceBibitQty;
        if (initPoly === 0 && initBibit > 0) initPoly = initBibit;
      }
      return {
        bedenganId: r.bedenganId || r.bedenganCode || r.bedengan,
        bedenganCode: formatBedenganDisplayCode(r.bedenganCode || r.bedengan || r.bedenganId),
        initialPolybag: initPoly,
        initialBibit: initBibit
      };
    });
  } else if (Array.isArray(parentDoc.bedenganIds) && parentDoc.bedenganIds.length > 0) {
    const polyPerBed = Math.floor(parentDoc.sourcePolybagQty / parentDoc.bedenganIds.length);
    const remPoly = parentDoc.sourcePolybagQty % parentDoc.bedenganIds.length;
    const bibitPerBed = Math.floor(parentDoc.sourceBibitQty / parentDoc.bedenganIds.length);
    const remBibit = parentDoc.sourceBibitQty % parentDoc.bedenganIds.length;
    bedenganList = parentDoc.bedenganIds.map((bId, idx) => ({
      bedenganId: bId,
      bedenganCode: formatBedenganDisplayCode(bId),
      initialPolybag: polyPerBed + (idx === 0 ? remPoly : 0),
      initialBibit: bibitPerBed + (idx === 0 ? remBibit : 0)
    }));
  } else {
    bedenganList = [{
      bedenganId: parentDoc.bedenganId || 'BED-001',
      bedenganCode: formatBedenganDisplayCode(parentDoc.bedenganCode || parentDoc.bedengan || 'BED-001'),
      initialPolybag: parentDoc.sourcePolybagQty || parentDoc.sourceBibitQty || 0,
      initialBibit: parentDoc.sourceBibitQty || 0
    }];
  }

  // Gunakan snapshot populasi final Seleksi III bila tersedia. Saldo Seleksi II
  // menjadi fallback hanya untuk snapshot bibit Seleksi III yang kosong.
  const sourceBedScope = getLinkedFinalBedScope(parentDoc, 'SELEKSI_2');
  bedenganList = bedenganList.map(bed => {
    const bedCode = formatBedenganDisplayCode(bed.bedenganCode || bed.bedenganId).toUpperCase();
    const sourceBed = sourceBedScope.find(item =>
      formatBedenganDisplayCode(item.bedenganCode || item.bedenganId).toUpperCase() === bedCode
    );
    if (!sourceBed) return bed;
    const sourceAvailableBibit = Number(sourceBed.maintainedBibit);
    if ((!Number.isFinite(Number(bed.initialBibit)) || Number(bed.initialBibit) <= 0) &&
        Number.isFinite(sourceAvailableBibit) && sourceAvailableBibit > 0) {
      return { ...bed, initialBibit: sourceAvailableBibit };
    }
    return bed;
  });

  // Seleksi III memakai fallback satu bibit per polybag yang sama dengan
  // pemilih bedengan saat snapshot populasi bibit per-bedengan kosong.
  bedenganList = bedenganList.map(bed => {
    const initialBibit = Number(bed.initialBibit);
    const initialPolybag = Number(bed.initialPolybag);
    if ((!Number.isFinite(initialBibit) || initialBibit <= 0) &&
        Number.isFinite(initialPolybag) && initialPolybag > 0) {
      return { ...bed, initialBibit: initialPolybag };
    }
    return bed;
  });

  return bedenganList.map(bed => {
    const parentBatch = String(parentDoc.batchCode || parentDoc.batchNo || '').trim().toUpperCase();
    const bedNorm = String(bed.bedenganCode || bed.bedenganId).trim().toUpperCase();
    const bedTxs = executions.filter(tx => {
      const txBatch = String(tx.batchCode || tx.batchNo || tx.sourceBatchCode || '').trim().toUpperCase();
      if (parentBatch && txBatch && txBatch !== parentBatch) return false;
      const txBed = String(tx.bedenganCode || tx.bedengan || tx.bedenganId || '').trim().toUpperCase();
      if (!txBed && bedenganList.length === 1) return true;
      return txBed === bedNorm || txBed === String(bed.bedenganId).toUpperCase();
    });

    const inspectedPolybag = bedTxs.reduce((sum, tx) => sum + parseInt(tx.actualPolybagInspectedQty !== undefined ? tx.actualPolybagInspectedQty : (tx.polybagScope !== undefined ? tx.polybagScope : (tx.actualPolybagActiveQty !== undefined ? tx.actualPolybagActiveQty : (tx.initialPolybagCount || 0))), 10), 0);
    const rejectedBibit = bedTxs.reduce((sum, tx) => sum + getRecordedBibitSelectedQty(tx), 0);
    const maintainedBibit = bed.initialBibit > 0 ? Math.max(0, bed.initialBibit - rejectedBibit) : 0;
    const inspectedBibit = bed.initialPolybag > 0
      ? Math.min(bed.initialBibit, Math.round((inspectedPolybag / bed.initialPolybag) * bed.initialBibit))
      : (inspectedPolybag > 0 ? inspectedPolybag : 0);
    const remainingPolybag = bed.initialPolybag > 0 ? Math.max(0, bed.initialPolybag - inspectedPolybag) : 0;
    const remainingBibit = maintainedBibit;

    return {
      ...bed,
      inspectedPolybag,
      inspectedBibit,
      maintainedBibit,
      availableBibit: maintainedBibit,
      rejectedBibit,
      remainingPolybag,
      remainingBibit,
      isFullyInspected: bed.initialPolybag > 0 && remainingPolybag === 0 && bedTxs.length > 0
    };
  });
}

/**
 * Validasi payload transaksi pelaksanaan Seleksi III
 * Mendukung model kuantitas baru (actualPolybagInspectedQty, actualBibitSelectedQty) dan Legacy
 */
export function validateSeleksi3Execution(payload, parentDoc, existingTxs = [], options = {}) {
  const errors = [];
  if (!payload) {
    return { isValid: false, errors: ['Data transaksi Seleksi III tidak boleh kosong.'] };
  }
  if (!parentDoc) {
    return { isValid: false, errors: ['Dokumen Seleksi III (parent) tidak ditemukan.'] };
  }

  const stage = String(parentDoc.selectionStage || '').toUpperCase();
  if (stage !== 'SELEKSI_III' && stage !== 'SELEKSI_3') {
    errors.push(`Parent document bukan merupakan Dokumen Seleksi III (stage: ${parentDoc.selectionStage}).`);
  }

  // 1. Bedengan validation
  const bedenganCode = String(payload.bedenganCode || payload.bedengan || payload.bedenganId || '').trim();
  if (!bedenganCode) {
    errors.push('Bedengan yang diperiksa wajib dipilih.');
  }

  const bedScopeList = getBedenganScopeStatusForSeleksi3(parentDoc, existingTxs);
  const bedNorm = formatBedenganDisplayCode(bedenganCode).toUpperCase();
  let matchedBed = bedScopeList.find(b => 
    formatBedenganDisplayCode(b.bedenganCode).toUpperCase() === bedNorm ||
    String(b.bedenganId).toUpperCase() === String(payload.bedenganId || '').toUpperCase() ||
    String(b.bedenganCode).toUpperCase() === bedNorm
  );

  if (!matchedBed && bedScopeList.length === 1 && (bedScopeList[0].bedenganCode === 'BED-001' || bedScopeList[0].bedenganId === 'BED-001')) {
    matchedBed = bedScopeList[0];
  }

  if (!matchedBed && bedScopeList.length > 0 && bedScopeList[0].bedenganCode !== 'BED-001') {
    errors.push(`Bedengan ${bedenganCode} tidak termasuk dalam scope Dokumen Seleksi III ${parentDoc.docNo}.`);
  }

  const maxPolybagScope = matchedBed ? matchedBed.remainingPolybag : parseInt(parentDoc.sourcePolybagQty || 0, 10);
  const sourceBibit = parseInt(parentDoc.sourceBibitQty !== undefined ? parentDoc.sourceBibitQty : (parentDoc.sourcePolybagQty || 0), 10);

  // Parse 2 canonical inputs: Jlh Polybag Diperiksa & Jlh Bibit Diseleksi (Minimum 0)
  const rawPoly3 = payload.actualPolybagInspectedQty !== undefined
    ? payload.actualPolybagInspectedQty
    : (payload.polybagScope !== undefined
        ? payload.polybagScope
        : (payload.actualPolybagActiveQty !== undefined ? payload.actualPolybagActiveQty : payload.polybagAktif));

  const rawBibit3 = payload.actualBibitSelectedQty !== undefined
    ? payload.actualBibitSelectedQty
    : (payload.selectedBibitScopeQty !== undefined
        ? payload.selectedBibitScopeQty
        : (payload.jumlahDiperiksa !== undefined ? payload.jumlahDiperiksa : undefined));

  let actualPolyInspected = 0;
  if (rawPoly3 === undefined || rawPoly3 === null || String(rawPoly3).trim() === '') {
    errors.push('Jumlah polybag diperiksa wajib diisi.');
  } else {
    actualPolyInspected = Number(rawPoly3);
    if (isNaN(actualPolyInspected)) {
      errors.push('Jumlah polybag diperiksa harus berupa angka yang valid.');
    } else if (actualPolyInspected < 0) {
      errors.push('Jumlah polybag diperiksa tidak boleh negatif (minimum 0).');
    } else if (actualPolyInspected > maxPolybagScope) {
      errors.push(`Jumlah polybag diperiksa (${actualPolyInspected}) melebihi sisa scope polybag yang tersedia (${maxPolybagScope}).`);
    }
  }

  // Hitung otomatis Bibit Dipertahankan secara kumulatif terlebih dahulu agar aman dari TDZ
  const existingBibitSelectedSum = existingTxs.reduce((sum, tx) => sum + getRecordedBibitSelectedQty(tx), 0);

  const maxBibitBedengan3 = matchedBed 
    ? (matchedBed.initialBibit !== undefined ? matchedBed.initialBibit : (matchedBed.initialPolybag || 0)) 
    : sourceBibit;
  const existingBibitOnBed3 = matchedBed ? (matchedBed.rejectedBibit || 0) : existingBibitSelectedSum;
  const availableBibit3 = Math.max(0, maxBibitBedengan3 - existingBibitOnBed3);

  let actualBibitSelected = 0;
  if (rawBibit3 === undefined || rawBibit3 === null || String(rawBibit3).trim() === '') {
    errors.push('Jumlah bibit diseleksi wajib diisi.');
  } else {
    actualBibitSelected = Number(rawBibit3);
    if (isNaN(actualBibitSelected)) {
      errors.push('Jumlah bibit diseleksi harus berupa angka yang valid.');
    } else if (actualBibitSelected < 0) {
      errors.push('Jumlah bibit diseleksi tidak boleh negatif (minimum 0).');
    } else if (actualBibitSelected > availableBibit3) {
      errors.push(`Jumlah bibit diseleksi (${actualBibitSelected}) melebihi Bibit Tersedia (${availableBibit3}).`);
    }
  }

  const selectedReason3 = String(payload.alasan || payload.category || payload.alasanAfkir || payload.alasanDitolakCategory || '').trim();
  const isReasonRequired3 = options && options.requireAlasan !== undefined 
    ? Boolean(options.requireAlasan) 
    : Boolean(payload.requireAlasan);
  if (isReasonRequired3 && actualBibitSelected > 0 && !selectedReason3) {
    errors.push('Alasan wajib dipilih jika ada bibit afkir.');
  }

  const totalBibitDiseleksiAfter = existingBibitSelectedSum + (isNaN(actualBibitSelected) ? 0 : actualBibitSelected);
  const cumulativeBibitRetained = Math.max(0, sourceBibit - totalBibitDiseleksiAfter);

  const polyScope = actualPolyInspected;
  const inactivePolybagQty = 0;
  const selectedBibitScopeQty = actualBibitSelected;
  const bibitReject = actualBibitSelected;
  const bibitAwal = maxBibitBedengan3 || sourceBibit;

  // 4. Photo Evidence Validation (Wajib minimal 1 foto dengan watermark GPS)
  const isPhotoRequired = options && options.requirePhoto !== undefined 
    ? Boolean(options.requirePhoto) 
    : Boolean(payload.requirePhoto || payload.fromUI);
  if (isPhotoRequired) {
    const photo = payload.photo || payload.photoEvidence || (Array.isArray(payload.photos) && payload.photos[0]);
    const photoDataUrl = (typeof photo === 'object' && photo !== null) ? (photo.dataUrl || photo.src || photo.url) : (typeof photo === 'string' ? photo : null);
    if (!photoDataUrl || typeof photoDataUrl !== 'string' || !photoDataUrl.startsWith('data:image/')) {
      errors.push('Foto bukti pemeriksaan seleksi wajib dilampirkan (minimal 1 foto dengan koordinat GPS aktual).');
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    parsed: {
      bedenganId: matchedBed ? matchedBed.bedenganId : (payload.bedenganId || bedenganCode),
      bedenganCode: matchedBed ? matchedBed.bedenganCode : bedenganCode,
      polybagScope: polyScope,
      actualPolybagInspectedQty: actualPolyInspected,
      actualPolybagActiveQty: actualPolyInspected,
      actualBibitSelectedQty: actualBibitSelected,
      actualBibitRetainedQty: cumulativeBibitRetained,
      inactivePolybagQty,
      selectedBibitScopeQty,
      activePolybagQty: actualPolyInspected,
      totalLayak: cumulativeBibitRetained,
      bibitAwal,
      jumlahDiperiksa: bibitAwal,
      bibitDipertahankan: cumulativeBibitRetained,
      bibitReject,
      photo: payload.photo || null,
      photoEvidence: payload.photo?.dataUrl || payload.photoEvidence || (Array.isArray(payload.photos) && payload.photos[0]) || null,
      photos: payload.photo?.dataUrl ? [payload.photo.dataUrl] : (Array.isArray(payload.photos) ? payload.photos : [])
    }
  };
}

/**
 * Membuat transaksi pelaksanaan Seleksi III baru oleh Mantri Bibitan
 */
export function createSeleksi3ExecutionTransaction(payload, currentUser, options = {}) {
  const allTxs = storage.get(SELECTION_STORAGE_KEY, []);

  // PENGAMANAN IDEMPOTENSI: Periksa payload.id dan payload.clientRequestId sebelum validasi/eksekusi
  const reqId = payload.id ? String(payload.id).trim() : null;
  const clientReqId = payload.clientRequestId ? String(payload.clientRequestId).trim() : null;
  if (reqId || clientReqId) {
    const existingTx = allTxs.find(tx => 
      (reqId && String(tx.id) === reqId) ||
      (clientReqId && tx.clientRequestId && String(tx.clientRequestId) === clientReqId)
    );
    if (existingTx) {
      const allDocs = storage.get(PRE_GRAFTING_SELECTION_DOC_STORAGE_KEY, []);
      const parentDocId = payload.parentDocId || payload.selectionDocumentId || payload.selectionDocNo || payload.parentSelectionDocumentId || payload.docNo || existingTx.parentSelectionDocumentId || existingTx.selectionDocumentId;
      const parentDoc = allDocs.find(d => d.id === parentDocId || d.docNo === parentDocId) || null;
      return {
        success: true,
        transaction: existingTx,
        parentDocument: parentDoc,
        isDuplicate: true
      };
    }
  }

  // GLOBAL ATTENDANCE GATE
  assertAttendanceGateOrThrow(currentUser);

  const parentDocId = payload.parentDocId || payload.selectionDocumentId || payload.selectionDocNo || payload.parentSelectionDocumentId || payload.docNo;
  const parentDoc = getPreGraftingSelectionDocumentById(parentDocId);
  if (!parentDoc) {
    throw new Error(`Dokumen Seleksi III dengan identitas "${parentDocId}" tidak ditemukan.`);
  }

  const existingExecutions = getSeleksi3ExecutionsByDocument(parentDoc.id);
  const val = validateSeleksi3Execution(payload, parentDoc, existingExecutions, options);
  if (!val.isValid) {
    throw new Error(val.errors.join(' '));
  }
  
  // Generate Transaction Document Number (Format: 2026/SEL-III/001_01 or 2026/SEL-III-TX/001)
  let maxSeq = 0;
  allTxs.forEach(tx => {
    const d = String(tx.docNo || tx.selectionNo || '');
    const match = d.match(/SEL-III(?:-TX)?\/(\d+)/i) || d.match(/(\d+)$/);
    if (match) {
      const num = parseInt(match[1], 10);
      if (!isNaN(num) && num > maxSeq) maxSeq = num;
    }
  });

  const txSeq = maxSeq + 1;
  const txDocNo = payload.docNo || formatStandardDocNo(2026, 'SEL-III', txSeq);
  const today = payload.tanggalSeleksi || payload.date || getEffectiveTodayDDMMYYYY();

  const txRecord = {
    id: payload.id || `SEL3-TX-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    clientRequestId: clientReqId || null,
    docNo: txDocNo,
    selectionNo: txDocNo,
    transactionType: 'PELAKSANAAN_SELEKSI_III',
    selectionType: SELECTION_TYPES.PRA_OKULASI,
    selectionStage: SELECTION_STAGES.SELEKSI_3,
    
    // Parent Document relation
    selectionDocumentId: parentDoc.id,
    selectionDocNo: parentDoc.docNo,
    parentSelectionDocumentId: parentDoc.id,
    parentSelectionDocNo: parentDoc.docNo,
    
    // Traceability to Seleksi II FINAL and Seeding
    sourceModule: 'SELEKSI',
    sourceSelectionStage: SELECTION_STAGES.SELEKSI_2,
    sourceSelectionType: SELECTION_TYPES.PRA_OKULASI,
    sourceSelectionDocumentId: parentDoc.sourceSelectionDocumentId,
    sourceSelectionDocNo: parentDoc.sourceSelectionDocNo,
    sourceFinalId: parentDoc.sourceFinalId || parentDoc.sourceSelectionDocumentId,
    sourceFinalStatus: SELECTION_STATUS.DISETUJUI,
    sourceDocNo: parentDoc.docNo,
    sourceSeedingDocNo: parentDoc.sourceSeedingDocNo || '-',
    
    // Master & Scope Contexts
    batchId: parentDoc.batchId,
    batchCode: parentDoc.batchCode,
    batchNo: parentDoc.batchCode,
    programId: parentDoc.programId,
    programCode: parentDoc.programCode,
    programName: parentDoc.programName,
    estateId: parentDoc.estateId || currentUser?.estateId,
    estateName: parentDoc.estateName || currentUser?.estateName,
    divisionId: parentDoc.divisionId || currentUser?.divisionId,
    divisionName: parentDoc.divisionName || currentUser?.divisionName,
    clone: parentDoc.clone,
    klon: parentDoc.klon,
    growthStage: 'Bibit Siap Okulasi', // Based on Seleksi III outcome
    
    bedenganId: val.parsed.bedenganId,
    bedenganCode: val.parsed.bedenganCode,
    bedengan: val.parsed.bedenganCode,
    
    // Population Breakdown & Quantities
    polybagScope: val.parsed.actualPolybagInspectedQty,
    initialPolybagCount: val.parsed.actualPolybagInspectedQty,
    sourcePolybagQty: parentDoc.sourcePolybagQty,
    sourceBibitQty: parentDoc.sourceBibitQty,
    bibitAwal: val.parsed.bibitAwal,
    jumlahDiperiksa: val.parsed.jumlahDiperiksa,
    
    // Canonical Quantities
    actualPolybagInspectedQty: val.parsed.actualPolybagInspectedQty,
    actualBibitSelectedQty: val.parsed.actualBibitSelectedQty,
    actualBibitRetainedQty: val.parsed.actualBibitRetainedQty,
    actualPolybagActiveQty: val.parsed.actualPolybagInspectedQty,
    activePolybagQty: val.parsed.actualPolybagInspectedQty,
    selectedBibitScopeQty: val.parsed.actualBibitSelectedQty,
    totalLayak: val.parsed.actualBibitRetainedQty,
    bibitDipertahankan: val.parsed.actualBibitRetainedQty,
    jumlahLayak: val.parsed.actualBibitRetainedQty,
    bibitReject: val.parsed.actualBibitSelectedQty,
    jumlahAfkir: val.parsed.actualBibitSelectedQty,
    
    // Reject Source Reference
    rejectSourceReference: {
      stage: SELECTION_STAGES.SELEKSI_3,
      parentDocNo: parentDoc.docNo,
      sourceSelectionDocNo: parentDoc.sourceSelectionDocNo,
      sourceSeedingDocNo: parentDoc.sourceSeedingDocNo,
      bedenganCode: val.parsed.bedenganCode,
      rejectCount: val.parsed.actualBibitSelectedQty,
      reason: val.parsed.alasan || 'Bibit abnormal/sakit saat Seleksi III'
    },
    alasan: val.parsed.alasan || '',
    category: val.parsed.category || '',
    alasanAfkir: val.parsed.alasanAfkir || '',
    alasanDitolakCategory: val.parsed.alasanDitolakCategory || '',
    
    tanggalSeleksi: today,
    tanggal: today,
    catatan: payload.catatan || payload.remarks || '-',
    
    // Photo Evidence Documentation
    photo: payload.photo ? {
      id: payload.photo.id || `PHOTO-SEL3-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      dataUrl: payload.photo.dataUrl,
      capturedAt: payload.photo.capturedAt,
      capturedAtLabel: payload.photo.capturedAtLabel,
      latitude: payload.photo.latitude,
      longitude: payload.photo.longitude,
      batchCode: val.parsed.batchCode || parentDoc.batchCode,
      bedenganCode: val.parsed.bedenganCode,
      source: 'CAMERA'
    } : null,
    photoEvidence: payload.photo?.dataUrl || payload.photoEvidence || (Array.isArray(payload.photos) && payload.photos[0]) || null,
    photos: payload.photo?.dataUrl ? [payload.photo.dataUrl] : (Array.isArray(payload.photos) ? payload.photos : []),
    hasPhotoEvidence: Boolean(payload.photo?.dataUrl || payload.photoEvidence || (Array.isArray(payload.photos) && payload.photos.length > 0)),

    status: 'RECORDED',
    stockMutationStatus: 'NOT_REQUIRED',
    
    createdByUserId: currentUser?.userId || currentUser?.code || currentUser?.id || 'MANTRI',
    createdByName: currentUser?.name || 'Mantri Bibitan',
    createdByRole: currentUser?.role || 'MANTRI_TANAMAN',
    createdAt: new Date().toISOString()
  };

  const newTx = currentUser 
    ? applyTransactionActor(txRecord, AUDIT_EVENT_TYPES.CREATE, currentUser, `Pelaksanaan Seleksi III pada ${val.parsed.bedenganCode} (${val.parsed.actualPolybagInspectedQty} Polybag, ${val.parsed.actualBibitSelectedQty} Bibit Diseleksi)`)
    : txRecord;

  // 1. Save execution transaction to selection_transactions
  allTxs.push(newTx);
  storage.set(SELECTION_STORAGE_KEY, allTxs);

  // 2. Update Parent Dokumen Seleksi III
  const allDocs = storage.get(PRE_GRAFTING_SELECTION_DOC_STORAGE_KEY, []);
  const parentIdx = allDocs.findIndex(d => d.id === parentDoc.id || d.docNo === parentDoc.docNo);
  
  if (parentIdx !== -1) {
    const currentParent = allDocs[parentIdx];
    const parentExecutions = allTxs.filter(tx => {
      const isStage3 = (
        tx.selectionStage === SELECTION_STAGES.SELEKSI_3 ||
        tx.stage === 'SELEKSI_III' ||
        tx.stage === 'SELEKSI_3' ||
        tx.transactionType === 'PELAKSANAAN_SELEKSI_III'
      );
      if (!isStage3) return false;
      return (
        tx.parentSelectionDocumentId === currentParent.id ||
        tx.selectionDocumentId === currentParent.id ||
        tx.parentSelectionDocNo === currentParent.docNo ||
        tx.selectionDocNo === currentParent.docNo
      );
    });

    const sourcePoly = parseInt(currentParent.sourcePolybagQty !== undefined ? currentParent.sourcePolybagQty : (currentParent.sourceBibitQty || 0), 10);
    const sourceBibit = parseInt(currentParent.sourceBibitQty !== undefined ? currentParent.sourceBibitQty : sourcePoly, 10);

    const updatedTotalPolyDiperiksa = parentExecutions.reduce((sum, tx) => 
      sum + parseInt(tx.actualPolybagInspectedQty !== undefined ? tx.actualPolybagInspectedQty : (tx.polybagScope !== undefined ? tx.polybagScope : (tx.actualPolybagActiveQty !== undefined ? tx.actualPolybagActiveQty : (tx.initialPolybagCount || 0))), 10), 
      0
    );
    const updatedTotalBibitDiseleksi = parentExecutions.reduce((sum, tx) => 
      sum + getRecordedBibitSelectedQty(tx),
      0
    );
    const updatedTotalLayak = Math.max(0, sourceBibit - updatedTotalBibitDiseleksi);
    const updatedTotalAfkir = updatedTotalBibitDiseleksi;
    const sisaPolybag = Math.max(0, sourcePoly - updatedTotalPolyDiperiksa);
    const isAllPolybagChecked = sourcePoly > 0 && updatedTotalPolyDiperiksa === sourcePoly && sisaPolybag === 0;

    allDocs[parentIdx] = {
      ...currentParent,
      executionTransactionIds: parentExecutions.map(tx => tx.id),
      executionCount: parentExecutions.length,
      executedPolybagQty: updatedTotalPolyDiperiksa,
      totalDiperiksa: updatedTotalPolyDiperiksa,
      totalPolybagDiperiksa: updatedTotalPolyDiperiksa,
      totalBibitDiseleksi: updatedTotalBibitDiseleksi,
      totalBibitSelectedQty: updatedTotalBibitDiseleksi,
      totalBibitRetainedQty: updatedTotalLayak,
      totalLayak: updatedTotalLayak,
      totalAfkir: updatedTotalAfkir,
      totalReject: updatedTotalAfkir,
      activePolybagQty: updatedTotalPolyDiperiksa,
      currentBibitQty: updatedTotalLayak,
      currentPolybagQty: updatedTotalPolyDiperiksa,
      remainingPolybag: sisaPolybag,
      sisaPolybag: sisaPolybag,
      sisaBibit: Math.max(0, sourceBibit - updatedTotalBibitDiseleksi),
      progress: sourcePoly > 0 ? Math.min(100, Math.max(0, Math.round((updatedTotalPolyDiperiksa / sourcePoly) * 100))) : 0,
      isCompleted: isAllPolybagChecked,
      status: isAllPolybagChecked 
        ? 'COMPLETED'
        : (parentExecutions.length > 0 ? 'IN_PROGRESS' : 'DRAFT'),
      verificationStatus: isAllPolybagChecked ? null : currentParent.verificationStatus,
      returnReason: isAllPolybagChecked ? null : currentParent.returnReason,
      isCorrected: isAllPolybagChecked ? true : Boolean(currentParent.isCorrected),
      updatedAt: new Date().toISOString()
    };

    storage.set(PRE_GRAFTING_SELECTION_DOC_STORAGE_KEY, allDocs);
  }

  // Bridge afkir pelaksanaan Seleksi III ke selection_pool sebagai kandidat CULL (PENDING_DECLARATION)
  syncPreGraftingExecutionToSelectionPool(newTx, parentIdx !== -1 ? allDocs[parentIdx] : parentDoc);

  return {
    success: true,
    transaction: newTx,
    parentDocument: parentIdx !== -1 ? allDocs[parentIdx] : parentDoc
  };
}

/**
 * Mengubah data transaksi pelaksanaan Seleksi III yang sudah ada dan mengkalkulasi ulang Dokumen Induk
 */
export function updateSeleksi3ExecutionTransaction(txIdOrDocNo, payload, currentUser = null) {
  if (!txIdOrDocNo) {
    throw new Error('ID atau Nomor Transaksi yang akan diubah tidak valid.');
  }

  const allTxs = storage.get(SELECTION_STORAGE_KEY, []);
  const txIdx = allTxs.findIndex(tx => tx.id === txIdOrDocNo || tx.docNo === txIdOrDocNo || tx.selectionNo === txIdOrDocNo);
  
  if (txIdx === -1) {
    throw new Error(`Transaksi Seleksi III "${txIdOrDocNo}" tidak ditemukan.`);
  }

  const existingTx = allTxs[txIdx];
  const parentDocId = existingTx.parentSelectionDocumentId || existingTx.selectionDocumentId;
  const parentDoc = getPreGraftingSelectionDocumentById(parentDocId);

  if (!parentDoc) {
    throw new Error(`Dokumen Induk Seleksi III untuk transaksi "${txIdOrDocNo}" tidak ditemukan.`);
  }

  const otherTxs = allTxs.filter((tx, idx) => idx !== txIdx && (tx.parentSelectionDocumentId === parentDoc.id || tx.selectionDocumentId === parentDoc.id));
  const val = validateSeleksi3Execution({
    ...existingTx,
    ...payload
  }, parentDoc, otherTxs);

  if (!val.isValid) {
    throw new Error(val.errors.join(' '));
  }

  const updatedTx = {
    ...existingTx,
    ...payload,
    bedenganId: val.parsed.bedenganId,
    bedenganCode: val.parsed.bedenganCode,
    polybagScope: val.parsed.actualPolybagInspectedQty,
    initialPolybagCount: val.parsed.actualPolybagInspectedQty,
    totalPolybagInspected: val.parsed.actualPolybagInspectedQty,
    bibitAwal: val.parsed.actualBibitSelectedQty,
    jumlahDiperiksa: val.parsed.actualBibitSelectedQty,
    actualPolybagInspectedQty: val.parsed.actualPolybagInspectedQty,
    actualPolybagActiveQty: val.parsed.actualPolybagInspectedQty,
    actualBibitSelectedQty: val.parsed.actualBibitSelectedQty,
    actualBibitRetainedQty: val.parsed.actualBibitRetainedQty,
    selectedBibitScopeQty: val.parsed.actualBibitSelectedQty,
    activePolybagQty: val.parsed.actualPolybagInspectedQty,
    bibitDipertahankan: val.parsed.actualBibitRetainedQty,
    jumlahLayak: val.parsed.actualBibitRetainedQty,
    bibitReject: val.parsed.actualBibitSelectedQty,
    jumlahAfkir: val.parsed.actualBibitSelectedQty,
    polybagDipertahankan: val.parsed.actualPolybagInspectedQty,
    afkirCategoryCounts: payload.afkirCategoryCounts || existingTx.afkirCategoryCounts || {},
    updatedAt: new Date().toISOString()
  };

  const finalTx = currentUser
    ? applyTransactionActor(updatedTx, AUDIT_EVENT_TYPES.UPDATE, currentUser, `Update Transaksi Seleksi III ${existingTx.docNo}`)
    : updatedTx;

  allTxs[txIdx] = finalTx;
  storage.set(SELECTION_STORAGE_KEY, allTxs);

  // Recalculate Parent Dokumen Seleksi III
  const allDocs = storage.get(PRE_GRAFTING_SELECTION_DOC_STORAGE_KEY, []);
  const parentIdx = allDocs.findIndex(d => d.id === parentDoc.id || d.docNo === parentDoc.docNo);

  if (parentIdx !== -1) {
    const currentParent = allDocs[parentIdx];
    const parentExecutions = allTxs.filter(tx => {
      const isStage3 = (
        tx.selectionStage === SELECTION_STAGES.SELEKSI_3 ||
        tx.stage === 'SELEKSI_III' ||
        tx.stage === 'SELEKSI_3' ||
        tx.transactionType === 'PELAKSANAAN_SELEKSI_III'
      );
      if (!isStage3) return false;
      return (
        tx.parentSelectionDocumentId === currentParent.id ||
        tx.selectionDocumentId === currentParent.id ||
        tx.parentSelectionDocNo === currentParent.docNo ||
        tx.selectionDocNo === currentParent.docNo
      );
    });

    const sourcePoly = parseInt(currentParent.sourcePolybagQty !== undefined ? currentParent.sourcePolybagQty : (currentParent.sourceBibitQty || 0), 10);
    const sourceBibit = parseInt(currentParent.sourceBibitQty !== undefined ? currentParent.sourceBibitQty : sourcePoly, 10);

    const updatedTotalPolyDiperiksa = parentExecutions.reduce((sum, tx) => 
      sum + parseInt(tx.actualPolybagInspectedQty !== undefined ? tx.actualPolybagInspectedQty : (tx.polybagScope !== undefined ? tx.polybagScope : (tx.actualPolybagActiveQty !== undefined ? tx.actualPolybagActiveQty : (tx.initialPolybagCount || 0))), 10), 
      0
    );
    const updatedTotalBibitDiseleksi = parentExecutions.reduce((sum, tx) => 
      sum + getRecordedBibitSelectedQty(tx),
      0
    );
    const updatedTotalLayak = Math.max(0, sourceBibit - updatedTotalBibitDiseleksi);
    const updatedTotalAfkir = updatedTotalBibitDiseleksi;
    const sisaPolybag = Math.max(0, sourcePoly - updatedTotalPolyDiperiksa);
    const isAllPolybagChecked = sourcePoly > 0 && updatedTotalPolyDiperiksa === sourcePoly && sisaPolybag === 0;

    allDocs[parentIdx] = {
      ...currentParent,
      executionTransactionIds: parentExecutions.map(tx => tx.id),
      executionCount: parentExecutions.length,
      executedPolybagQty: updatedTotalPolyDiperiksa,
      totalDiperiksa: updatedTotalPolyDiperiksa,
      totalPolybagDiperiksa: updatedTotalPolyDiperiksa,
      totalBibitDiseleksi: updatedTotalBibitDiseleksi,
      totalBibitSelectedQty: updatedTotalBibitDiseleksi,
      totalBibitRetainedQty: updatedTotalLayak,
      totalLayak: updatedTotalLayak,
      totalAfkir: updatedTotalAfkir,
      totalReject: updatedTotalAfkir,
      activePolybagQty: updatedTotalPolyDiperiksa,
      currentBibitQty: updatedTotalLayak,
      currentPolybagQty: updatedTotalPolyDiperiksa,
      remainingPolybag: sisaPolybag,
      sisaPolybag: sisaPolybag,
      sisaBibit: Math.max(0, sourceBibit - updatedTotalBibitDiseleksi),
      progress: sourcePoly > 0 ? Math.min(100, Math.max(0, Math.round((updatedTotalPolyDiperiksa / sourcePoly) * 100))) : 0,
      isCompleted: isAllPolybagChecked,
      status: isAllPolybagChecked 
        ? 'COMPLETED'
        : (parentExecutions.length > 0 ? 'IN_PROGRESS' : 'DRAFT'),
      updatedAt: new Date().toISOString()
    };

    storage.set(PRE_GRAFTING_SELECTION_DOC_STORAGE_KEY, allDocs);
  }

  // Sync pembaruan afkir pelaksanaan Seleksi III ke selection_pool
  syncPreGraftingExecutionToSelectionPool(allTxs[txIdx], parentIdx !== -1 ? allDocs[parentIdx] : parentDoc);

  return {
    success: true,
    transaction: allTxs[txIdx],
    parentDocument: parentIdx !== -1 ? allDocs[parentIdx] : parentDoc
  };
}

/**
 * Menghapus transaksi pelaksanaan Seleksi III dan mengkalkulasi ulang Dokumen Induk
 */
export function deleteSeleksi3ExecutionTransaction(txIdOrDocNo, currentUser = null) {
  if (!txIdOrDocNo) {
    throw new Error('ID atau Nomor Transaksi yang akan dihapus tidak valid.');
  }

  const allTxs = storage.get(SELECTION_STORAGE_KEY, []);
  const txIdx = allTxs.findIndex(tx => tx.id === txIdOrDocNo || tx.docNo === txIdOrDocNo || tx.selectionNo === txIdOrDocNo);
  
  if (txIdx === -1) {
    throw new Error(`Transaksi Seleksi III "${txIdOrDocNo}" tidak ditemukan.`);
  }

  const targetTx = allTxs[txIdx];
  const txStatus = String(targetTx.status || '').toUpperCase();
  const txVerifStatus = String(targetTx.verificationStatus || '').toUpperCase();

  // STRATEGI 5-B: Proteksi penghapusan transaksi approved / final
  if (
    txStatus === 'DISETUJUI' ||
    txStatus === 'APPROVED' ||
    txVerifStatus === 'TERVERIFIKASI' ||
    txVerifStatus === 'DISETUJUI' ||
    targetTx.isFinal === true
  ) {
    throw new Error(`Transaksi Seleksi III "${targetTx.docNo || txIdOrDocNo}" telah berstatus DISETUJUI/Final dan tidak dapat dihapus.`);
  }

  assertPreGraftingExecutionCanBeDeleted(targetTx, allTxs);

  const parentDocId = targetTx.parentSelectionDocumentId || targetTx.selectionDocumentId;
  const parentDocNo = targetTx.parentSelectionDocNo || targetTx.selectionDocNo;

  // Remove transaction
  allTxs.splice(txIdx, 1);
  storage.set(SELECTION_STORAGE_KEY, allTxs);

  // Bersihkan kandidat deklarasi di selection_pool jika masih pending
  cleanupPreGraftingExecutionFromSelectionPool(targetTx.id, targetTx.docNo);

  // Recalculate Parent Dokumen Seleksi III
  const allDocs = storage.get(PRE_GRAFTING_SELECTION_DOC_STORAGE_KEY, []);
  const parentIdx = allDocs.findIndex(d => d.id === parentDocId || d.docNo === parentDocNo);

  if (parentIdx !== -1) {
    const currentParent = allDocs[parentIdx];
    const parentExecutions = allTxs.filter(tx => {
      const isStage3 = (
        tx.selectionStage === SELECTION_STAGES.SELEKSI_3 ||
        tx.stage === 'SELEKSI_III' ||
        tx.stage === 'SELEKSI_3' ||
        tx.transactionType === 'PELAKSANAAN_SELEKSI_III'
      );
      if (!isStage3) return false;
      return (
        tx.parentSelectionDocumentId === currentParent.id ||
        tx.selectionDocumentId === currentParent.id ||
        tx.parentSelectionDocNo === currentParent.docNo ||
        tx.selectionDocNo === currentParent.docNo
      );
    });

    const sourcePoly = parseInt(currentParent.sourcePolybagQty !== undefined ? currentParent.sourcePolybagQty : (currentParent.sourceBibitQty || 0), 10);
    const sourceBibit = parseInt(currentParent.sourceBibitQty !== undefined ? currentParent.sourceBibitQty : sourcePoly, 10);

    const updatedTotalPolyDiperiksa = parentExecutions.reduce((sum, tx) => 
      sum + parseInt(tx.actualPolybagInspectedQty !== undefined ? tx.actualPolybagInspectedQty : (tx.polybagScope !== undefined ? tx.polybagScope : (tx.actualPolybagActiveQty !== undefined ? tx.actualPolybagActiveQty : (tx.initialPolybagCount || 0))), 10), 
      0
    );
    const updatedTotalBibitDiseleksi = parentExecutions.reduce((sum, tx) => 
      sum + getRecordedBibitSelectedQty(tx),
      0
    );
    const updatedTotalLayak = Math.max(0, sourceBibit - updatedTotalBibitDiseleksi);
    const updatedTotalAfkir = updatedTotalBibitDiseleksi;
    const sisaPolybag = Math.max(0, sourcePoly - updatedTotalPolyDiperiksa);
    const isAllPolybagChecked = sourcePoly > 0 && updatedTotalPolyDiperiksa === sourcePoly && sisaPolybag === 0;

    // Preservasi Status Approval Dokumen Induk:
    const wasAlreadyApproved = (
      currentParent.status === SELECTION_STATUS.DISETUJUI ||
      currentParent.isFinal === true ||
      currentParent.verificationStatus === 'TERVERIFIKASI' ||
      Boolean(currentParent.verifiedAt) ||
      Boolean(currentParent.verifiedByUserId)
    );

    const wasSubmitted = (
      currentParent.status === SELECTION_STATUS.MENUNGGU_VERIFIKASI ||
      currentParent.status === 'DIAJUKAN' ||
      Boolean(currentParent.submittedAt)
    );

    let recalculatedStatus = currentParent.status;
    if (wasAlreadyApproved) {
      recalculatedStatus = SELECTION_STATUS.DISETUJUI;
    } else if (wasSubmitted) {
      recalculatedStatus = isAllPolybagChecked
        ? 'COMPLETED'
        : (parentExecutions.length > 0 ? 'IN_PROGRESS' : 'DRAFT');
    } else {
      recalculatedStatus = isAllPolybagChecked 
        ? 'COMPLETED' 
        : (parentExecutions.length > 0 ? 'IN_PROGRESS' : 'DRAFT');
    }

    const baseUpdatedParent = {
      ...currentParent,
      executionTransactionIds: parentExecutions.map(tx => tx.id),
      executionCount: parentExecutions.length,
      executedPolybagQty: updatedTotalPolyDiperiksa,
      totalDiperiksa: updatedTotalPolyDiperiksa,
      totalPolybagDiperiksa: updatedTotalPolyDiperiksa,
      totalBibitDiseleksi: updatedTotalBibitDiseleksi,
      totalBibitSelectedQty: updatedTotalBibitDiseleksi,
      totalBibitRetainedQty: updatedTotalLayak,
      totalLayak: updatedTotalLayak,
      totalAfkir: updatedTotalAfkir,
      totalReject: updatedTotalAfkir,
      activePolybagQty: updatedTotalPolyDiperiksa,
      currentBibitQty: updatedTotalLayak,
      currentPolybagQty: updatedTotalPolyDiperiksa,
      remainingPolybag: sisaPolybag,
      sisaPolybag: sisaPolybag,
      sisaBibit: Math.max(0, sourceBibit - updatedTotalBibitDiseleksi),
      progress: sourcePoly > 0 ? Math.min(100, Math.max(0, Math.round((updatedTotalPolyDiperiksa / sourcePoly) * 100))) : 0,
      isCompleted: isAllPolybagChecked,
      status: recalculatedStatus,
      verificationStatus: wasSubmitted && !wasAlreadyApproved ? null : currentParent.verificationStatus,
      submissionStatus: wasSubmitted && !wasAlreadyApproved ? null : currentParent.submissionStatus,
      submittedAt: wasSubmitted && !wasAlreadyApproved ? null : currentParent.submittedAt,
      submittedByUserId: wasSubmitted && !wasAlreadyApproved ? null : currentParent.submittedByUserId,
      submittedByName: wasSubmitted && !wasAlreadyApproved ? null : currentParent.submittedByName,
      isFinal: wasAlreadyApproved ? true : Boolean(currentParent.isFinal),
      updatedAt: new Date().toISOString()
    };

    const finalUpdatedParent = currentUser
      ? applyTransactionActor(
          baseUpdatedParent,
          AUDIT_EVENT_TYPES.DELETE,
          currentUser,
          `Penghapusan transaksi pelaksanaan Seleksi III ${targetTx.docNo || targetTx.id} pada bedengan ${targetTx.bedenganCode || '-'}. Sisa eksekusi: ${parentExecutions.length}`
        )
      : baseUpdatedParent;

    allDocs[parentIdx] = finalUpdatedParent;
    storage.set(PRE_GRAFTING_SELECTION_DOC_STORAGE_KEY, allDocs);
    if (wasSubmitted && !wasAlreadyApproved) {
      withdrawPendingPreGraftingVerification(
        currentParent,
        currentUser,
        `Pengajuan ditarik karena sesi ${targetTx.docNo || targetTx.id} dihapus.`
      );
    }
  }

  return { 
    success: true,
    deletedId: targetTx.id,
    parentDocument: parentIdx !== -1 ? allDocs[parentIdx] : null
  };
}


