/**
 * js/modules/physical-stock-inspection/batch-transaction-history-service.js
 * SERVICE AGREGASI RIWAYAT TRANSAKSI DAN MUTASI PER BATCH
 * 
 * Prinsip:
 * - REAL DATA AUDIT: Seluruh data diekstrak dari transaksi dan master data sebenarnya (tanpa hardcoded dummy).
 * - CHRONOLOGICAL ASCENDING: Diurutkan dari tanggal transaksi paling lama ke paling baru (aliran hidup batch).
 * - INFORMATIVE NARRATIVE: Menyediakan narasi deskriptif untuk setiap transaksi.
 */

import { storage } from '../../core/storage.js';
import { getAllBatches } from '../../data/batch-master.js';
import { getBatchInventory, getBatchStockHistory } from '../../core/batch-inventory-service.js';
import { formatDateTime, formatDate, esc, isCullDocNo } from '../../core/utils.js';
import { getSeedlingAgeFromGermination } from './physical-stock-inspection-manager.js';

/**
 * Ekstraksi kuantitas bibit disemai secara aman dari berbagai variasi skema modul SIGMA Nursery
 */
function extractSeedingQty(tx) {
  if (!tx) return 0;
  const candidates = [
    tx.totalDisemai,
    tx.disemai,
    tx.jumlahBibitDipindahkan,
    tx.quantity,
    tx.totalPlanted,
    tx.jumlah,
    tx.qty,
    tx.bibitDitanam,
    tx.totalPenerimaan
  ];
  for (const c of candidates) {
    if (c !== undefined && c !== null && !isNaN(Number(c)) && Number(c) > 0) {
      return Number(c);
    }
  }
  if (Array.isArray(tx.rows) && tx.rows.length > 0) {
    const sum = tx.rows.reduce((acc, r) => {
      const q = Number(r.disemai ?? r.seedsQuantity ?? r.totalDisemai ?? (r.polybag ? r.polybag * 2 : 0) ?? 0);
      return acc + (isNaN(q) ? 0 : q);
    }, 0);
    if (sum > 0) return sum;
  }
  if (tx.totalPolybag !== undefined && tx.totalPolybag !== null && !isNaN(Number(tx.totalPolybag)) && Number(tx.totalPolybag) > 0) {
    return Number(tx.totalPolybag) * 2;
  }
  return 0;
}

/**
 * Ekstraksi kuantitas bibit afkir (cull) secara aman dari modul Seleksi SIGMA Nursery
 */
function extractSelectionCullQty(tx) {
  if (!tx) return 0;
  const candidates = [
    tx.actualBibitSelectedQty,
    tx.bibitReject,
    tx.jumlahAfkir,
    tx.totalAfkir,
    tx.jumlahAfkirTotal,
    tx.cullQty,
    tx.afkirQty,
    tx.afkirCount,
    tx.selectedBibitScopeQty,
    tx.rejectCount,
    tx.rejectSourceReference?.rejectCount,
    tx.quantity,
    tx.qty
  ];
  for (const c of candidates) {
    if (c !== undefined && c !== null && !isNaN(Number(c)) && Number(c) > 0) {
      return Number(c);
    }
  }
  return 0;
}

/**
 * Ekstraksi kuantitas bibit layak (terpelihara) dari modul Seleksi SIGMA Nursery
 */
function extractSelectionNormalQty(tx, cullQty = 0) {
  if (!tx) return 0;
  const candidates = [
    tx.actualBibitRetainedQty,
    tx.totalLayak,
    tx.jumlahLayak,
    tx.bibitDipertahankan,
    tx.sessionBibitRetained,
    tx.normalQty,
    tx.normalCount,
    tx.passedQty
  ];
  for (const c of candidates) {
    if (c !== undefined && c !== null && !isNaN(Number(c)) && Number(c) > 0) {
      return Number(c);
    }
  }
  // Fallback dari total diperiksa dikurangi cullQty
  const inspected = Number(
    tx.actualPolybagInspectedQty ? tx.actualPolybagInspectedQty * 2 :
    (tx.jumlahDiperiksa ?? tx.totalDiperiksa ?? tx.bibitAwal ?? 0)
  );
  if (inspected > cullQty) {
    return inspected - cullQty;
  }
  return 0;
}

/**
 * Ekstraksi nama tahap seleksi (Tahap 1, Tahap 2, Tahap 3)
 * Penting: Cek Tahap 3 dan 2 terlebih dahulu sebelum Tahap 1 karena string 'SEL-II' mengandung 'SEL-I'
 */
function extractSelectionStage(tx) {
  if (!tx) return 'Tahap 1';
  if (tx.stageName) return tx.stageName;
  if (tx.stage) {
    if (String(tx.stage).includes('3') || String(tx.stage).includes('III')) return 'Tahap 3';
    if (String(tx.stage).includes('2') || String(tx.stage).includes('II')) return 'Tahap 2';
    if (String(tx.stage).includes('1') || String(tx.stage).includes('I')) return 'Tahap 1';
    return String(tx.stage);
  }
  const docNo = String(tx.docNo || tx.selectionDocNo || tx.parentSelectionDocNo || tx.selectionNo || '');
  if (docNo.includes('SEL-III') || docNo.includes('SEL_3') || docNo.includes('SELEKSI_3') || docNo.includes('SELEKSI_III')) return 'Tahap 3';
  if (docNo.includes('SEL-II') || docNo.includes('SEL_2') || docNo.includes('SELEKSI_2') || docNo.includes('SELEKSI_II')) return 'Tahap 2';
  if (docNo.includes('SEL-I') || docNo.includes('SEL_1') || docNo.includes('SELEKSI_1') || docNo.includes('SELEKSI_I')) return 'Tahap 1';
  
  const txType = String(tx.transactionType || tx.selectionStage || tx.selectionType || '');
  if (txType.includes('III') || txType.includes('3')) return 'Tahap 3';
  if (txType.includes('II') || txType.includes('2')) return 'Tahap 2';
  if (txType.includes('I') || txType.includes('1')) return 'Tahap 1';
  return `Tahap ${tx.selectionRound || 1}`;
}

/**
 * Ekstraksi kuantitas pemusnahan bibit afkir (BAPB)
 */
function extractDestructionQty(tx, matchingItems = []) {
  if (matchingItems.length > 0) {
    const sum = matchingItems.reduce((acc, it) => {
      const q = Number(
        it.quantity ?? it.totalQty ?? it.qty ?? it.jumlahAfkir ?? 
        it.actualBibitSelectedQty ?? it.cullQty ?? it.bibitAfkir ?? it.jumlah ?? 0
      );
      return acc + (isNaN(q) ? 0 : q);
    }, 0);
    if (sum > 0) return sum;
  }
  const candidates = [
    tx.totalQty,
    tx.quantity,
    tx.totalPemusnahan,
    tx.jumlahAfkir,
    tx.jumlah,
    tx.qty
  ];
  for (const c of candidates) {
    if (c !== undefined && c !== null && !isNaN(Number(c)) && Number(c) > 0) {
      return Number(c);
    }
  }
  return 0;
}

/**
 * Ekstraksi kuantitas penyaluran bibit siap tanam (Dispatch)
 */
function extractDispatchQty(tx, matchingItems = []) {
  if (matchingItems.length > 0) {
    const sum = matchingItems.reduce((acc, it) => {
      const q = Number(it.quantity ?? it.qty ?? it.jumlahBibit ?? it.totalQty ?? it.jumlah ?? 0);
      return acc + (isNaN(q) ? 0 : q);
    }, 0);
    if (sum > 0) return sum;
  }
  const candidates = [
    tx.totalQty,
    tx.quantity,
    tx.totalPenyaluran,
    tx.jumlahBibit,
    tx.qty,
    tx.jumlah
  ];
  for (const c of candidates) {
    if (c !== undefined && c !== null && !isNaN(Number(c)) && Number(c) > 0) {
      return Number(c);
    }
  }
  return 0;
}

/**
 * Mengambil seluruh daftar batch yang tersedia beserta status saldo terkini
 */
export function getAllBatchesForHistory() {
  let masterBatches = [];
  try {
    masterBatches = getAllBatches();
  } catch {
    masterBatches = storage.get('nursery_batches', []);
  }
  if (!Array.isArray(masterBatches) || masterBatches.length === 0) {
    masterBatches = storage.get('nursery_batches', []);
  }
  const seedingTxs = storage.get('seeding_transactions', []);

  const batchMap = new Map();

  masterBatches.forEach(b => {
    const key = b.id || b.batchId || b.batchCode;
    if (key) {
      let bedenganStr = '-';
      if (b.bedengan && typeof b.bedengan === 'string') bedenganStr = b.bedengan;
      else if (Array.isArray(b.bedenganIds) && b.bedenganIds.length > 0) bedenganStr = b.bedenganIds.join(', ');
      else if (b.bedenganId) bedenganStr = b.bedenganId;

      batchMap.set(String(key), {
        id: b.id || key,
        batchId: b.batchId || b.id || key,
        batchCode: b.batchCode || b.batchNo || b.kode || key,
        clone: b.clone || b.klon || '-',
        programName: b.programName || b.programCode || '-',
        programCode: b.programCode || '',
        estateCode: b.estateCode || '',
        divisionCode: b.divisionCode || '',
        bedengan: bedenganStr,
        initialQty: Number(b.initialQty || b.quantity || b.totalPlanted || b.totalDisemai || 0)
      });
    }
  });

  // Sinkronkan atau tambahkan batch dari seeding_transactions jika ada data tambahan
  seedingTxs.forEach(s => {
    const key = s.batchId || s.batchCode || s.batchNo;
    if (key) {
      const sBedengan = s.bedengan || s.bedenganCode || s.bedenganId || (Array.isArray(s.bedenganIds) ? s.bedenganIds.join(', ') : null);
      const sClone = s.klonAwal || s.clone || s.klon || s.cloneName;
      const sQty = extractSeedingQty(s);
      const existing = batchMap.get(String(key));
      if (existing) {
        if ((!existing.bedengan || existing.bedengan === '-') && sBedengan) {
          existing.bedengan = sBedengan;
        }
        if ((!existing.clone || existing.clone === '-') && sClone) {
          existing.clone = sClone;
        }
        if ((!existing.initialQty || existing.initialQty === 0) && sQty > 0) {
          existing.initialQty = sQty;
        }
      } else {
        batchMap.set(String(key), {
          id: s.batchId || key,
          batchId: s.batchId || key,
          batchCode: s.batchCode || s.batchNo || key,
          clone: sClone || '-',
          programName: s.programName || s.program || s.programCode || '-',
          programCode: s.programCode || '',
          estateCode: s.estateCode || '',
          divisionCode: s.divisionCode || '',
          bedengan: sBedengan || '-',
          initialQty: sQty
        });
      }
    }
  });

  const list = Array.from(batchMap.values());

  // Sisipkan ringkasan saldo buku sistem terkini ke setiap batch
  return list.map(b => {
    const inv = getBatchInventory(b.batchId || b.batchCode || b.id);
    return {
      ...b,
      currentQty: Number(inv?.availableQty ?? 0)
    };
  });
}

/**
 * Mengumpulkan seluruh transaksi yang berkaitan dengan suatu Batch dan menyusunnya dalam satu Timeline terurut (ASCENDING)
 * @param {string} batchIdOrCode 
 * @returns {Object} { batch, summary, timeline: Array }
 */
export function getBatchTransactionHistory(batchIdOrCode) {
  if (!batchIdOrCode) return { batch: null, summary: null, timeline: [] };

  const targetCode = String(batchIdOrCode).trim();
  const allBatches = getAllBatchesForHistory();
  const batch = allBatches.find(b => 
    String(b.id) === targetCode || 
    String(b.batchId) === targetCode || 
    String(b.batchCode) === targetCode ||
    String(b.batchCode).toUpperCase() === targetCode.toUpperCase()
  ) || {
    id: targetCode,
    batchId: targetCode,
    batchCode: targetCode,
    clone: '-',
    programName: '-',
    estateCode: '',
    divisionCode: '',
    bedengan: '-',
    initialQty: 0
  };

  const possibleKeys = new Set();
  if (batch.id) possibleKeys.add(String(batch.id).trim().toUpperCase());
  if (batch.batchId) possibleKeys.add(String(batch.batchId).trim().toUpperCase());
  if (batch.batchCode) possibleKeys.add(String(batch.batchCode).trim().toUpperCase());
  if (batch.batchNo) possibleKeys.add(String(batch.batchNo).trim().toUpperCase());
  if (targetCode) possibleKeys.add(String(targetCode).trim().toUpperCase());

  const matchBatch = (item) => {
    if (!item) return false;
    const itemBatchId = item.batchId ? String(item.batchId).trim().toUpperCase() : null;
    const itemBatchCode = item.batchCode ? String(item.batchCode).trim().toUpperCase() : null;
    const itemBatchNo = item.batchNo ? String(item.batchNo).trim().toUpperCase() : null;
    const targetBatchId = item.targetBatchId ? String(item.targetBatchId).trim().toUpperCase() : null;
    const targetBatchCode = item.targetBatchCode ? String(item.targetBatchCode).trim().toUpperCase() : null;
    const targetBatchNo = item.targetBatchNo ? String(item.targetBatchNo).trim().toUpperCase() : null;

    if (itemBatchId && possibleKeys.has(itemBatchId)) return true;
    if (itemBatchCode && possibleKeys.has(itemBatchCode)) return true;
    if (itemBatchNo && possibleKeys.has(itemBatchNo)) return true;
    if (targetBatchId && possibleKeys.has(targetBatchId)) return true;
    if (targetBatchCode && possibleKeys.has(targetBatchCode)) return true;
    if (targetBatchNo && possibleKeys.has(targetBatchNo)) return true;

    if (Array.isArray(item.rows) && item.rows.length > 0) {
      if (item.rows.some(r => r && (
        (r.batchId && possibleKeys.has(String(r.batchId).trim().toUpperCase())) ||
        (r.batchCode && possibleKeys.has(String(r.batchCode).trim().toUpperCase())) ||
        (r.batchNo && possibleKeys.has(String(r.batchNo).trim().toUpperCase()))
      ))) {
        return true;
      }
    }
    if (Array.isArray(item.items) && item.items.length > 0) {
      if (item.items.some(it => it && (
        (it.batchId && possibleKeys.has(String(it.batchId).trim().toUpperCase())) ||
        (it.batchCode && possibleKeys.has(String(it.batchCode).trim().toUpperCase())) ||
        (it.batchNo && possibleKeys.has(String(it.batchNo).trim().toUpperCase()))
      ))) {
        return true;
      }
    }
    return false;
  };

  const rawTimeline = [];

  // 1. PENYEMAIAN / PINDAH SEMAI (seeding_transactions)
  const seedingTxs = storage.get('seeding_transactions', []);
  const batchSeedingDocNos = new Set();

  seedingTxs.filter(matchBatch).forEach(tx => {
    if (tx.docNo) batchSeedingDocNos.add(String(tx.docNo));
    if (tx.nomorDokumen) batchSeedingDocNos.add(String(tx.nomorDokumen));

    const qty = extractSeedingQty(tx);
    const bedengan = tx.bedengan || tx.bedenganCode || tx.bedenganId || tx.rows?.[0]?.bedengan || tx.rows?.[0]?.bedenganCode || batch.bedengan || '-';
    const cloneName = tx.klonAwal || tx.clone || tx.klon || tx.cloneName || tx.seedClone || batch.clone || '-';
    const actor = tx.mantri || tx.plantedByName || tx.createdByName || tx.actorName || tx.createdBy || 'Petugas Semai';
    const timestamp = tx.date || tx.tanggal || tx.plantedAt || tx.transferredAt || tx.createdAt || new Date().toISOString();

    rawTimeline.push({
      id: `seeding-${tx.id || tx.docNo}`,
      category: 'SEEDING',
      typeLabel: 'Pindah Semai (SOW)',
      badgeColor: '#059669',
      badgeBg: '#ECFDF5',
      badgeBorder: '#A7F3D0',
      icon: 'plant',
      docNo: tx.docNo || tx.nomorDokumen || tx.sourceSeedingDocNo || `SOW-${tx.id || 'N/A'}`,
      timestamp,
      qtyChange: qty > 0 ? +qty : 0,
      qtyUnit: 'Pkk',
      actor,
      narrative: `Bibit berhasil dipindahkan dan ditanam ke bedengan ${bedengan} sebanyak ${qty.toLocaleString('id-ID')} Pkk sebagai saldo awal batch. Klon: ${cloneName}.`,
      status: tx.verificationStatus || tx.status || 'TERVERIFIKASI',
      isPositive: true
    });
  });

  // 2. SELEKSI BIBIT (selection_transactions & pre_grafting_selection_documents)
  // Menghindari duplikasi: Jangan sertakan selection_pool (staging) dan jangan dobel hitung parent doc jika child execution ada
  const allSelectionTxs = storage.get('selection_transactions', []);
  const preGraftingDocs = storage.get('pre_grafting_selection_documents', []);

  const existingSelectionDocNos = new Set(allSelectionTxs.map(t => t.docNo || t.selectionDocNo).filter(Boolean));
  const candidateSelectionList = [...allSelectionTxs];

  preGraftingDocs.forEach(p => {
    if (!p) return;
    const docNo = p.docNo || p.id;
    const hasChildren = allSelectionTxs.some(t => 
      t.parentSelectionDocumentId === p.id || 
      t.selectionDocumentId === p.id || 
      t.parentSelectionDocNo === docNo || 
      t.selectionDocNo === docNo
    );
    if (!hasChildren && !existingSelectionDocNos.has(docNo)) {
      existingSelectionDocNos.add(docNo);
      candidateSelectionList.push(p);
    }
  });

  const matchSelectionBatch = (item) => {
    if (!item) return false;
    const itemBatch = (item.batchCode || item.batchId || item.batchNo || '').trim().toUpperCase();
    // Jika item secara eksplisit milik batch lain, jangan dicocokkan ke batch ini!
    if (itemBatch && !possibleKeys.has(itemBatch)) {
      return false;
    }
    // Jika match langsung dengan batch ini
    if (matchBatch(item)) return true;

    // Jika item tidak memiliki batchCode langsung, periksa referensi dokumen semai batch ini
    if (!itemBatch) {
      if (item.sourceSeedingDocNo && batchSeedingDocNos.has(String(item.sourceSeedingDocNo))) return true;
      if (item.seedingDocNo && batchSeedingDocNos.has(String(item.seedingDocNo))) return true;
      if (Array.isArray(item.sourceSeedingDocNos) && item.sourceSeedingDocNos.some(d => batchSeedingDocNos.has(String(d)))) return true;
    }
    return false;
  };

  const matchedSelectionItems = candidateSelectionList
    .filter(matchSelectionBatch)
    .filter(item => {
      const st = String(item.status || item.verificationStatus || '').toUpperCase();
      if (!st) return true; // legacy item without status field
      return !['DRAFT', 'BATAL', 'PENDING_DECLARATION', 'DITARIK', 'DIBATALKAN', 'REJECTED'].includes(st);
    });

  // Pisahkan execution records dan cull declaration records untuk mencegah double counting (2x hitung)
  const executionItems = [];
  const cullDeclarationItems = [];

  matchedSelectionItems.forEach(item => {
    const doc = String(item.docNo || item.selectionDocNo || item.selectionNo || '');
    if (doc.includes('/CULL/') || doc.startsWith('DEC-CUL') || (typeof isCullDocNo === 'function' && isCullDocNo(doc))) {
      cullDeclarationItems.push(item);
    } else {
      executionItems.push(item);
    }
  });

  // Jika sebuah dokumen CULL merujuk ke transaksi pelaksanaan (Execution) yang sudah ada di executionItems,
  // gabungkan data informasinya dan JANGAN hitung 2 kali!
  const finalSelectionList = [...executionItems];

  cullDeclarationItems.forEach(cull => {
    const cullDoc = String(cull.docNo || cull.selectionDocNo || cull.selectionNo || '');
    const cullQty = extractSelectionCullQty(cull);

    // Cari apakah sudah ada transaksi pelaksanaan yang mewakili kejadian seleksi ini
    const relatedExec = executionItems.find(ex => {
      const exDoc = String(ex.docNo || ex.selectionDocNo || '');
      const directRef = (
        (ex.id && (ex.id === cull.sourceTransactionId || ex.id === cull.selectionTransactionId || ex.id === cull.sourceId)) ||
        (exDoc && (exDoc === cull.sourceDocNo || exDoc === cull.selectionNo || exDoc === cull.selectionDocNo || exDoc === cull.parentSelectionDocNo || exDoc === cull.refDocNo))
      );
      if (directRef) return true;

      // Fallback kesamaan bedengan, tahapan seleksi, dan kuantitas afkir yang sama persis
      const sameBed = (ex.bedenganCode || ex.bedengan || '') === (cull.bedenganCode || cull.bedengan || '');
      const sameStage = extractSelectionStage(ex) === extractSelectionStage(cull);
      const sameQty = extractSelectionCullQty(ex) === cullQty && cullQty > 0;
      return sameBed && sameStage && sameQty;
    });

    if (relatedExec) {
      // Tandai nomor dokumen deklarasi CULL pada record pelaksanaan yang ada (agar user mengetahui keduanya terhubung)
      relatedExec.cullDocNo = cullDoc;
      if (!relatedExec.reason && (cull.alasan || cull.reason || cull.afkirReason)) {
        relatedExec.reason = cull.alasan || cull.reason || cull.afkirReason;
      }
    } else {
      // Jika CULL berdiri sendiri (misal tanpa execution record anak), masukkan ke daftar
      finalSelectionList.push(cull);
    }
  });

  // Deduplikasi finalSelectionList agar transaksi dengan docNo / id yang sama tidak terulang
  const seenSelectionDocs = new Set();
  const dedupedSelectionList = [];
  finalSelectionList.forEach(tx => {
    const docKey = String(tx.docNo || tx.selectionDocNo || tx.id || '');
    if (docKey && seenSelectionDocs.has(docKey)) return;
    if (docKey) seenSelectionDocs.add(docKey);
    dedupedSelectionList.push(tx);
  });

  dedupedSelectionList.forEach(tx => {
    let cullQty = extractSelectionCullQty(tx);
    let normalQty = extractSelectionNormalQty(tx, cullQty);

    // Jika cullQty belum ditemukan pada child execution, cek induk dokumennya
    if (cullQty === 0 && (tx.parentSelectionDocNo || tx.parentSelectionDocumentId)) {
      const parent = preGraftingDocs.find(p => p.docNo === tx.parentSelectionDocNo || p.id === tx.parentSelectionDocumentId);
      if (parent) {
        cullQty = extractSelectionCullQty(parent);
        if (normalQty === 0) normalQty = extractSelectionNormalQty(parent, cullQty);
      }
    }

    const stage = extractSelectionStage(tx);
    const actor = tx.mantri || tx.selectorName || tx.createdByName || tx.actorName || tx.createdBy || 'Petugas Seleksi';
    const reasonText = tx.reason || tx.alasanAfkir || tx.alasan || tx.afkirReason || tx.alasanDitolakCategory || tx.keterangan || tx.rejectSourceReference?.reason || '';
    const timestamp = tx.tanggalSeleksi || tx.selectionDate || tx.tanggal || tx.date || tx.completedAt || tx.createdAt || new Date().toISOString();
    const bedenganCode = tx.bedenganCode || tx.bedengan || tx.rejectSourceReference?.bedenganCode || batch.bedengan || '-';
    const cullRefInfo = tx.cullDocNo ? ` [Ref: ${tx.cullDocNo}]` : '';

    rawTimeline.push({
      id: `selection-${tx.id || tx.docNo}`,
      category: 'SELECTION',
      typeLabel: `Seleksi Bibit (${stage})`,
      badgeColor: '#D97706',
      badgeBg: '#FFFBEB',
      badgeBorder: '#FDE68A',
      icon: 'scissors',
      docNo: tx.docNo || tx.selectionDocNo || `SEL-${tx.id || 'N/A'}`,
      timestamp,
      qtyChange: cullQty > 0 ? -cullQty : 0,
      qtyUnit: 'Pkk Afkir',
      actor,
      narrative: `Pemeriksaan seleksi bibit ${stage} telah selesai pada bedengan ${bedenganCode}${cullRefInfo}. Sebanyak ${normalQty > 0 ? normalQty.toLocaleString('id-ID') + ' Pkk' : 'seluruh bibit sisa'} memenuhi kriteria terpelihara, dan ${cullQty.toLocaleString('id-ID')} Pkk dinyatakan afkir${reasonText ? ` karena "${reasonText}"` : ''}. Saldo buku sistem terpotong sebesar ${cullQty.toLocaleString('id-ID')} Pkk.`,
      status: tx.status || tx.verificationStatus || 'TERVERIFIKASI',
      isPositive: false
    });
  });

  // 3. PEMUSNAHAN BIBIT (destruction_transactions / BAPB)
  const destructionTxs = storage.get('destruction_transactions', []);
  destructionTxs.forEach(tx => {
    const isDirectMatch = matchBatch(tx);
    const matchingItems = Array.isArray(tx.items) 
      ? tx.items.filter(it => matchBatch(it) || possibleKeys.has(String(it.batchCode || '')) || possibleKeys.has(String(it.batchId || '')))
      : [];

    if (isDirectMatch || matchingItems.length > 0) {
      const destroyedQty = extractDestructionQty(tx, matchingItems);
      const actor = tx.createdByName || tx.actorName || tx.createdBy || tx.pelaksana || tx.pic || 'Petugas Pemusnahan';
      const metode = tx.metodePemusnahan || tx.method || 'Pencincangan dan Pemendaman';
      const isFinal = Boolean(tx.isFinal || tx.status === 'FINAL');
      const timestamp = tx.tanggalPelaksanaan || tx.destructionDate || tx.tanggal || tx.date || tx.createdAt || new Date().toISOString();

      rawTimeline.push({
        id: `destruction-${tx.id || tx.docNo}`,
        category: 'DESTRUCTION',
        typeLabel: 'Pemusnahan Bibit (BAPB)',
        badgeColor: '#DC2626',
        badgeBg: '#FEF2F2',
        badgeBorder: '#FECACA',
        icon: 'trash',
        docNo: tx.officialDocNo || tx.docNo || `BAPB-${tx.id || 'N/A'}`,
        timestamp,
        qtyChange: -destroyedQty,
        qtyUnit: 'Pkk Dimusnahkan',
        actor,
        narrative: `Pemusnahan fisik terhadap ${destroyedQty.toLocaleString('id-ID')} Pkk bibit afkir telah dilaksanakan di lapangan dengan metode ${metode} (${isFinal ? 'Telah disetujui Pengurus' : 'Menunggu persetujuan'}). Kuantitas nol mutasi buku karena telah dipotong saat seleksi.`,
        status: isFinal ? 'FINAL (Disetujui)' : (tx.status || 'DRAF'),
        isPositive: false
      });
    }
  });

  // 4. PENGELUARAN BIBIT (dispatch_transactions)
  const dispatchTxs = storage.get('dispatch_transactions', []);
  dispatchTxs.forEach(tx => {
    const isDirectMatch = matchBatch(tx);
    const matchingItems = Array.isArray(tx.items)
      ? tx.items.filter(it => matchBatch(it) || possibleKeys.has(String(it.batchCode || '')) || possibleKeys.has(String(it.batchId || '')))
      : [];

    if (isDirectMatch || matchingItems.length > 0) {
      const dispatchedQty = extractDispatchQty(tx, matchingItems);
      const actor = tx.createdByName || tx.dispatcherName || tx.actorName || tx.createdBy || tx.supir || 'Petugas Pengeluaran';
      const dest = tx.destination || tx.estateName || tx.kebunTujuan || tx.tujuan || 'Lokasi Tujuan';
      const blockInfo = tx.block ? ` Blok ${tx.block}` : '';
      const timestamp = tx.dispatchDate || tx.tanggalPenyaluran || tx.tanggal || tx.date || tx.createdAt || new Date().toISOString();

      rawTimeline.push({
        id: `dispatch-${tx.id || tx.docNo}`,
        category: 'DISPATCH',
        typeLabel: 'Pengeluaran Bibit (Dispatch)',
        badgeColor: '#475569',
        badgeBg: '#F1F5F9',
        badgeBorder: '#CBD5E1',
        icon: 'truck',
        docNo: tx.docNo || tx.spkNo || tx.doNo || `DSP-${tx.id || 'N/A'}`,
        timestamp,
        qtyChange: -dispatchedQty,
        qtyUnit: 'Pkk Keluar',
        actor,
        narrative: `Pengeluaran dan pengiriman bibit siap tanam sebanyak ${dispatchedQty.toLocaleString('id-ID')} Pkk diberangkatkan menuju ${dest}${blockInfo} sesuai dokumen pengeluaran resmi.`,
        status: tx.status || 'TERKIRIM',
        isPositive: false
      });
    }
  });

  // 5. PEMERIKSAAN STOK FISIK (physical_stock_inspections)
  const inspections = storage.get('physical_stock_inspections', []);
  inspections.filter(matchBatch).forEach(insp => {
    const physicalQty = Number(insp.physicalQty ?? insp.physicalStock ?? insp.stokFisik ?? 0);
    const systemQty = Number(insp.systemQtySnapshot ?? insp.systemQty ?? insp.systemStock ?? insp.stokSistem ?? 0);
    const diff = insp.difference !== undefined && insp.difference !== null && !isNaN(Number(insp.difference))
      ? Number(insp.difference)
      : (physicalQty - systemQty);

    const diffSign = diff > 0 ? `+${diff.toLocaleString('id-ID')}` : diff.toLocaleString('id-ID');
    const statusText = diff === 0 ? 'Sesuai' : (diff > 0 ? 'Selisih Lebih' : 'Selisih Kurang');
    const actor = insp.inspectorName || insp.createdByName || insp.completedByName || insp.actorName || insp.createdBy || 'Asisten Bibitan';
    const timestamp = insp.completedAt || insp.inspectionDate || insp.tanggalPemeriksaan || insp.createdAt || new Date().toISOString();
    const bedenganDetails = Array.isArray(insp.counts) ? insp.counts.map(row => ({
      bedenganId: row.bedenganId || null,
      bedenganCode: row.bedenganCode || row.bedenganId || 'TOTAL_BATCH',
      referenceQty: row.referenceQty ?? null,
      physicalQty: Number(row.physicalQty || 0),
      difference: row.difference ?? null,
      reason: row.reason || '',
      referenceStatus: row.referenceStatus || 'LEGACY',
      provenance: row.provenance || null
    })) : [];
    const detailNarrative = bedenganDetails.length
      ? ` Rincian: ${bedenganDetails.map(row => `${row.bedenganCode} fisik ${row.physicalQty.toLocaleString('id-ID')} Pkk${row.difference !== null ? `, selisih ${Number(row.difference).toLocaleString('id-ID')} Pkk` : ''}${row.reason ? `, alasan ${row.reason}` : ''}`).join('; ')}.`
      : '';

    rawTimeline.push({
      id: `psi-${insp.id}`,
      category: 'INSPECTION',
      typeLabel: 'Pemeriksaan Stok Fisik (Sensus)',
      badgeColor: diff === 0 ? '#059669' : (diff > 0 ? '#B45309' : '#DC2626'),
      badgeBg: diff === 0 ? '#ECFDF5' : (diff > 0 ? '#FEF3C7' : '#FEF2F2'),
      badgeBorder: diff === 0 ? '#A7F3D0' : (diff > 0 ? '#FDE68A' : '#FECACA'),
      icon: 'check-circle',
      docNo: insp.docNo || `PSI-${String(insp.id).slice(-6)}`,
      timestamp,
      qtyChange: diff,
      qtyUnit: `Pkk (${statusText})`,
      actor,
      narrative: `Sensus fisik lapangan menghitung ${physicalQty.toLocaleString('id-ID')} Pkk fisik berbanding saldo buku sistem ${systemQty.toLocaleString('id-ID')} Pkk, menghasilkan status ${statusText} sebesar ${diffSign} Pkk.${detailNarrative}`,
      bedenganDetails,
      reconciliationStatus: insp.reconciliationSnapshot?.reconciliationStatus || null,
      unallocatedBatchBalance: insp.reconciliationSnapshot?.unallocatedBatchBalance ?? null,
      status: insp.status || 'COMPLETED',
      isPositive: diff >= 0
    });
  });

  // 6. BERITA ACARA REKONSILIASI STOK FISIK (physical_stock_bapsb)
  const bapsbList = storage.get('physical_stock_bapsb', []);
  bapsbList.filter(matchBatch).forEach(b => {
    const surplus = Number(b.totalSurplusQty ?? b.surplusQty ?? b.difference ?? b.selisihLebih ?? b.qty ?? 0);
    const shortage = Number(b.totalShortageQty ?? b.shortageQty ?? 0);
    const actor = b.createdByName || b.actorName || b.createdBy || 'Asisten Bibitan';
    const isFinal = Boolean(b.isFinal || ['FINAL', 'FINAL_PENDING_APPLICATION', 'APPLIED'].includes(b.status));
    const timestamp = b.updatedAt || b.bapsbDate || b.tanggal || b.createdAt || new Date().toISOString();

    rawTimeline.push({
      id: `bapsb-${b.id}`,
      category: 'BAPSB',
      typeLabel: b.documentType === 'PHYSICAL_STOCK_RECONCILIATION' ? 'BA Rekonsiliasi Stok Fisik' : 'Berita Acara Selisih Lebih (BAPSB)',
      badgeColor: '#B45309',
      badgeBg: '#FFFBEB',
      badgeBorder: '#FCD34D',
      icon: 'file-text',
      docNo: b.officialDocNo || b.docNo || `BAPSB-${String(b.id).slice(-6)}`,
      timestamp,
      qtyChange: surplus - shortage,
      qtyUnit: 'Pkk Rekonsiliasi',
      actor,
      narrative: b.documentType === 'PHYSICAL_STOCK_RECONCILIATION'
        ? `BA Rekonsiliasi mencatat selisih lebih +${surplus.toLocaleString('id-ID')} Pkk dan selisih kurang -${shortage.toLocaleString('id-ID')} Pkk. Mutasi saldo hanya berlaku setelah status DITERAPKAN melalui Central Hub.`
        : `Penerbitan Berita Acara resmi mengesahkan selisih lebih fisik sebesar +${surplus.toLocaleString('id-ID')} Pkk.`,
      status: b.status === 'APPLIED' ? 'DITERAPKAN' : (isFinal ? 'FINAL (Disahkan Pengurus)' : (b.status || 'DALAM PERSETUJUAN')),
      isPositive: surplus >= shortage,
      isBapsb: true,
      bapsbDoc: b
    });
  });

  // 7. JURNAL INVENTORY TAMBAHAN (batch_inventory_journal)
  const journals = getBatchStockHistory(batch.batchId || batch.batchCode || batch.id);
  journals.forEach(j => {
    if (['ADJUSTMENT', 'PHYSICAL_STOCK_CULL', 'PHYSICAL_STOCK_RECONCILIATION_SURPLUS', 'PHYSICAL_STOCK_RECONCILIATION_SHORTAGE'].includes(j.txType)) {
      const actor = j.createdByName || j.actorName || j.createdBy || 'Sistem Inventory';
      const qty = Number(j.qtyIn || 0) - Number(j.qtyOut || 0);
      const before = Number(j.balanceBefore ?? j.saldoSebelum ?? 0);
      const after = Number(j.balance ?? j.balanceAfter ?? j.saldoSesudah ?? 0);

      rawTimeline.push({
        id: `journal-${j.id || Math.random()}`,
        category: 'JOURNAL',
        typeLabel: `Penyesuaian Jurnal (${j.txType})`,
        badgeColor: '#64748B',
        badgeBg: '#F1F5F9',
        badgeBorder: '#CBD5E1',
        icon: 'book',
        docNo: j.refDocNo || `JRN-${j.id || 'N/A'}`,
        timestamp: j.createdAt || new Date().toISOString(),
        qtyChange: qty,
        qtyUnit: 'Pkk',
        actor,
        narrative: `${j.txType === 'PHYSICAL_STOCK_RECONCILIATION_SURPLUS' ? 'Penambahan' : j.txType === 'PHYSICAL_STOCK_RECONCILIATION_SHORTAGE' ? 'Pengurangan' : 'Penyesuaian'} saldo melalui jurnal rekonsiliasi sebesar ${qty > 0 ? '+' : ''}${qty.toLocaleString('id-ID')} Pkk${j.bedenganCode ? ` pada ${j.bedenganCode}` : ''}. Saldo sesudah: ${after.toLocaleString('id-ID')} Pkk.`,
        status: 'TERCATAT',
        isPositive: qty >= 0
      });
    }
  });

  // PERMINTAAN USER: Urutkan timeline secara ASCENDING (Tanggal paling lama ke paling baru)
  rawTimeline.sort((a, b) => {
    const aTime = new Date(a.timestamp).getTime() || 0;
    const bTime = new Date(b.timestamp).getTime() || 0;
    return aTime - bTime;
  });

  // PERHITUNGAN REAL RINGKASAN METRIK BATCH BERDASARKAN TRANSAKSI AKTUAL
  const seedingQtyTotal = rawTimeline
    .filter(t => t.category === 'SEEDING')
    .reduce((sum, t) => sum + Math.max(0, Number(t.qtyChange || 0)), 0);

  const cullQtyTotal = rawTimeline
    .filter(t => t.category === 'SELECTION')
    .reduce((sum, t) => sum + Math.abs(Number(t.qtyChange || 0)), 0);

  const dispatchedQtyTotal = rawTimeline
    .filter(t => t.category === 'DISPATCH')
    .reduce((sum, t) => sum + Math.abs(Number(t.qtyChange || 0)), 0);

  const inv = getBatchInventory(batch.batchId || batch.batchCode || batch.id);
  const currentAvailable = Number(inv?.availableQty ?? (batch.currentQty ?? 0));

  // Saldo awal dihitung dari real transaksi penyemaian, atau initialQty master, atau rekonsiliasi matematis
  const totalInitial = seedingQtyTotal > 0 
    ? seedingQtyTotal 
    : (Number(batch.initialQty || 0) > 0 ? Number(batch.initialQty) : (currentAvailable + cullQtyTotal + dispatchedQtyTotal));

  // Rekonsiliasi batas logis ledger stok: total afkir kumulatif tidak boleh melebihi (saldo awal - saldo saat ini - total terkirim)
  const maxPossibleCull = (totalInitial > currentAvailable) 
    ? Math.max(0, totalInitial - currentAvailable - dispatchedQtyTotal)
    : cullQtyTotal;
  const verifiedCullTotal = (totalInitial > 0 && totalInitial > currentAvailable)
    ? Math.min(cullQtyTotal, maxPossibleCull)
    : cullQtyTotal;

  const activeBapsb = bapsbList.find(b => matchBatch(b) && b.isFinal);
  const pendingBapsb = bapsbList.find(b => matchBatch(b) && !b.isFinal);

  const seedlingAge = getSeedlingAgeFromGermination(batch);

  const summary = {
    batchId: batch.batchId,
    batchCode: batch.batchCode,
    clone: batch.clone,
    bedengan: batch.bedengan,
    programName: batch.programName,
    seedlingAge,
    currentSystemQty: currentAvailable,
    totalInitialQty: totalInitial,
    totalCullQty: verifiedCullTotal,
    totalDispatchedQty: dispatchedQtyTotal,
    surplusBufferQty: Number(activeBapsb?.surplusQty || pendingBapsb?.surplusQty || 0),
    surplusBapsbStatus: activeBapsb ? 'FINAL' : (pendingBapsb ? 'PENDING' : null),
    totalTransactionsCount: rawTimeline.length
  };

  return {
    batch,
    summary,
    timeline: rawTimeline
  };
}

export { getSeedlingAgeFromGermination };

