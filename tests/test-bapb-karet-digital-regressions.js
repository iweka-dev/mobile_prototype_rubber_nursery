/**
 * tests/test-bapb-karet-digital-regressions.js
 * 
 * REGRESSION TEST SUITE REG-01 s/d REG-12
 * IMPLEMENTASI TERBATAS BAPB KARET DIGITAL — GAWAI RUBBER NURSERY
 * 
 * Cakupan Pengujian Wajib:
 * - REG-01: Urutan nomor dan reset bulanan ([KODE_KEBUN]/[KODE_DIVISI]/[BULAN]/[TAHUN]/[NOMOR_URUT]).
 * - REG-02: Validasi kuantitas ketat kanonikal (tolak kosong, nol, negatif, pecahan, '12abc', NaN, dsb).
 * - REG-03: Konflik pemakaian dokumen sumber (penolakan pemakaian ulang dokumen seleksi yang sedang/sudah diproses).
 * - REG-04: Penanganan kegagalan penyimpanan (QuotaExceededError ditangani aman tanpa klaim sukses palsu).
 * - REG-05: Invarian nol mutasi stok (bapbInventoryEffect: ZERO_MUTATION_ALREADY_DEDUCTED_AT_SELECTION).
 * - REG-06: Kompatibilitas CUL (record historis CUL tetap terbaca normal di storage dan adapter review-workspace).
 * - REG-07: Preservasi seluruh record non-target (in-place update, draf lain dan record CUL tidak terhapus).
 * - REG-08: Penolakan status finalisasi yang tidak sah (hanya status DRAFT_AWAITING_PENGURUS yang diizinkan).
 * - REG-09: Penolakan storage yang tidak valid (fail-closed, tolak non-array tanpa menimpa data).
 * - REG-10: Konsistensi zona waktu WIB pada batas pergantian bulan (UTC vs Asia/Jakarta UTC+7).
 * - REG-11: Preservasi data ketika proses finalisasi gagal (rollback/tidak ada mutasi korup).
 * - REG-12: Validasi kelengkapan bukti fisik (1-2 foto) & tanda tangan visual 3 pejabat (ASB, Askep, Pengurus, tanpa KTU).
 */

import assert from 'assert';

// Mock in-memory storage environment
const store = new Map();
global.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear()
};

import { storage } from '../js/core/storage.js';
import {
  getOfficialBusinessTimeWIB,
  resolveBapbEstateDisplayCode,
  resolveBapbDivisionDisplayCode,
  formatBapbOfficialDocNo,
  parseStrictCanonicalQuantity
} from '../js/core/utils.js';
import {
  BAPB_STATUS,
  DESTRUCTION_STATUS,
  DESTRUCTION_STORAGE_KEY,
  getVerifiedDestructionCollection,
  allocateNextBapbDocNo,
  getEligibleSelectionDocsForBapb,
  createBapbDraft,
  signBapbAskep,
  returnBapbByAskep,
  finalizeBapbDocument,
  checkImmutableFinalBapb
} from '../js/modules/destruction/destruction-manager.js';
import { renderBapbPrintHtml } from '../js/modules/destruction/bapb-print-template.js';

console.log('================================================================================');
console.log('REGRESSION TEST SUITE REG-01 s/d REG-12: BAPB KARET DIGITAL');
console.log('================================================================================\n');

let passCount = 0;
let failCount = 0;
const results = [];

function runRegTest(testId, name, fn) {
  try {
    console.log(`>>> Menjalankan ${testId}: ${name}`);
    fn();
    console.log(`    [STATUS: PASS] ${testId} berhasil terpenuhi.\n`);
    passCount++;
    results.push({ id: testId, name, status: 'PASS', error: null });
  } catch (err) {
    console.error(`    [STATUS: FAIL] ${testId} GAGAL: ${err.message}\n`);
    failCount++;
    results.push({ id: testId, name, status: 'FAIL', error: err.message });
  }
}

// User personas
const userASB = {
  id: 'USR-ASB-01',
  userId: 'USR-ASB-01',
  name: 'Ikhsan Frasetia',
  role: 'ASISTEN_BIBITAN',
  estateId: 'EST-TBS',
  estateName: 'Tanah Besih',
  divisionId: 'DIV-001',
  divisionName: 'Divisi I'
};

const userAskep = {
  id: 'USR-ASKEP-01',
  userId: 'USR-ASKEP-01',
  name: 'Budi Santoso',
  role: 'ASISTEN_KEPALA',
  estateId: 'EST-TBS',
  divisionId: 'DIV-001'
};

const userPengurus = {
  id: 'USR-PGR-01',
  userId: 'USR-PGR-01',
  name: 'Ir. H. Gunawan',
  role: 'PENGURUS',
  estateId: 'EST-TBS'
};

// Dummy valid signature (> 500 chars)
const validSigASB = 'data:image/png;base64,' + 'A'.repeat(800);
const validSigAskep = 'data:image/png;base64,' + 'B'.repeat(800);
const validSigPengurus = 'data:image/png;base64,' + 'C'.repeat(800);
const validPhoto1 = 'data:image/jpeg;base64,' + 'P1'.repeat(200);
const validPhoto2 = 'data:image/jpeg;base64,' + 'P2'.repeat(200);

// Helper setup dummy selection transactions
function seedSelectionTransactions() {
  const selections = [
    {
      id: 'SEL-2026-001',
      docNo: 'TBS/DIV-I/CULL/SEL-I/10/2026/01',
      selectionNo: 'TBS/DIV-I/CULL/SEL-I/10/2026/01',
      estateId: 'EST-TBS',
      divisionId: 'DIV-001',
      batchId: 'B-001',
      batchCode: 'BATCH-TBS-01',
      bedenganCode: 'BED-01',
      klon: 'GT 1',
      selectionStage: 'Seleksi I',
      status: 'DISETUJUI',
      isApproved: true,
      jumlahAfkirTotal: 120,
      quantity: 120
    },
    {
      id: 'SEL-2026-002',
      docNo: 'TBS/DIV-I/CULL/SEL-I/10/2026/02',
      selectionNo: 'TBS/DIV-I/CULL/SEL-I/10/2026/02',
      estateId: 'EST-TBS',
      divisionId: 'DIV-001',
      batchId: 'B-002',
      batchCode: 'BATCH-TBS-02',
      bedenganCode: 'BED-02',
      klon: 'PB 260',
      selectionStage: 'Seleksi I',
      status: 'DISETUJUI',
      isApproved: true,
      jumlahAfkirTotal: 85,
      quantity: 85
    }
  ];
  storage.set('selection_transactions', selections);
}

// =============================================================================
// REG-01: URUTAN NOMOR DAN RESET BULANAN
// =============================================================================
runRegTest('REG-01', 'Urutan nomor resmi dan reset bulanan per kebun/divisi', () => {
  // 1. Uji alokasi nomor berurutan
  const recordsMonth10 = [
    { officialDocNo: 'TB/DIV-I/10/2026/01', bapbStatus: 'FINAL' },
    { officialDocNo: 'TB/DIV-I/10/2026/02', bapbStatus: 'FINAL' }
  ];
  const nextNo = allocateNextBapbDocNo('TB', 'DIV-I', 10, 2026, recordsMonth10);
  assert.strictEqual(nextNo, 'TB/DIV-I/10/2026/03', 'Nomor urut harus berlanjut ke 03');

  // 2. Uji reset bulanan (bulan 11 harus mulai dari 01)
  const nextMonthNo = allocateNextBapbDocNo('TB', 'DIV-I', 11, 2026, recordsMonth10);
  assert.strictEqual(nextMonthNo, 'TB/DIV-I/11/2026/01', 'Nomor urut bulan 11 harus reset ke 01');

  // 3. Uji partisi divisi berbeda (DIV-II harus mulai dari 01)
  const div2No = allocateNextBapbDocNo('TB', 'DIV-II', 10, 2026, recordsMonth10);
  assert.strictEqual(div2No, 'TB/DIV-II/10/2026/01', 'Divisi berbeda harus mulai dari 01');

  // 4. Uji partisi kebun berbeda (AP harus mulai dari 01)
  const apNo = allocateNextBapbDocNo('AP', 'DIV-I', 10, 2026, recordsMonth10);
  assert.strictEqual(apNo, 'AP/DIV-I/10/2026/01', 'Kebun AP harus mulai dari 01');
});

// =============================================================================
// REG-02: VALIDASI KUANTITAS KETAT (CANONICAL QUANTITY)
// =============================================================================
runRegTest('REG-02', 'Validasi kuantitas ketat kanonikal (menolak input tidak valid tanpa fallback truthiness)', () => {
  // Input sah
  assert.strictEqual(parseStrictCanonicalQuantity(150), 150);
  assert.strictEqual(parseStrictCanonicalQuantity('250'), 250);
  assert.strictEqual(parseStrictCanonicalQuantity(1), 1);

  // Input tidak sah: harus melempar error eksplisit
  const invalidInputs = [
    null,
    undefined,
    '',
    '   ',
    0,
    '0',
    -5,
    '-5',
    10.5,
    '10.5',
    '10,5',
    '12abc',
    'abc12',
    NaN,
    Infinity,
    -Infinity,
    Number.MAX_SAFE_INTEGER + 10,
    {}
  ];

  for (const inv of invalidInputs) {
    assert.throws(
      () => parseStrictCanonicalQuantity(inv, 'Kuantitas Tes'),
      /tidak boleh kosong|harus berupa|tidak valid|berada di luar batas|bilangan bulat positif/,
      `Input ${JSON.stringify(inv)} harus ditolak secara ketat`
    );
  }
});

// =============================================================================
// REG-03: KONFLIK PEMAKAIAN DOKUMEN SUMBER
// =============================================================================
runRegTest('REG-03', 'Pencegahan konflik pemakaian dokumen seleksi sumber pada 2 draf aktif/FINAL', () => {
  global.localStorage.clear();
  seedSelectionTransactions();

  // Draf 1 berhasil dibuat dengan SEL-2026-001
  const draft1 = createBapbDraft({
    items: [{
      sourceSelectionId: 'SEL-2026-001',
      sourceSelectionNo: 'TBS/DIV-I/CULL/SEL-I/10/2026/01',
      klon: 'GT 1',
      quantity: 120
    }],
    asbSignature: validSigASB,
    photos: [validPhoto1]
  }, userASB);

  assert.ok(draft1.id, 'Draf 1 harus terbentuk');

  // Draf 2 mencoba menggunakan SEL-2026-001 yang sama -> Harus ditolak
  assert.throws(
    () => {
      createBapbDraft({
        items: [{
          sourceSelectionId: 'SEL-2026-001',
          sourceSelectionNo: 'TBS/DIV-I/CULL/SEL-I/10/2026/01',
          klon: 'GT 1',
          quantity: 120
        }],
        asbSignature: validSigASB,
        photos: [validPhoto1]
      }, userASB);
    },
    /sudah digunakan pada dokumen BAPB/,
    'Penggunaan kembali dokumen sumber yang sedang diproses wajib ditolak'
  );
});

// =============================================================================
// REG-04: PENANGANAN KEGAGALAN PENYIMPANAN (QUOTA EXCEEDED)
// =============================================================================
runRegTest('REG-04', 'Penanganan QuotaExceededError tanpa menampilkan sukses palsu', () => {
  global.localStorage.clear();
  seedSelectionTransactions();

  const draft = createBapbDraft({
    items: [{
      sourceSelectionId: 'SEL-2026-002',
      sourceSelectionNo: 'TBS/DIV-I/CULL/SEL-I/10/2026/02',
      klon: 'PB 260',
      quantity: 85
    }],
    asbSignature: validSigASB,
    photos: [validPhoto1]
  }, userASB);

  // Askep sign
  signBapbAskep(draft.id, validSigAskep, 'OK Askep', userAskep);

  // Simulasikan QuotaExceededError pada storage.set
  const originalSet = storage.set;
  storage.set = (key, val) => {
    const err = new Error('QuotaExceededError: DOM Exception 22');
    err.name = 'QuotaExceededError';
    throw err;
  };

  try {
    assert.throws(
      () => finalizeBapbDocument(draft.id, validSigPengurus, 'Sahkan', userPengurus),
      /QuotaExceededError|Gagal menyimpan dokumen FINAL BAPB/,
      'Kegagalan penyimpanan harus melempar error dan menolak finalisasi'
    );
  } finally {
    // Restore
    storage.set = originalSet;
  }

  // Periksa draf di storage tetap utuh pada status DRAFT_AWAITING_PENGURUS (bukan FINAL palsu)
  const records = storage.get(DESTRUCTION_STORAGE_KEY, []);
  const preservedDraft = records.find(r => r.id === draft.id);
  assert.strictEqual(preservedDraft.bapbStatus, BAPB_STATUS.DRAFT_AWAITING_PENGURUS, 'Status tidak boleh menjadi FINAL jika penulisan gagal');
  assert.strictEqual(preservedDraft.officialDocNo, null, 'Nomor resmi tidak boleh teralokasi jika gagal');
});

// =============================================================================
// REG-05: INVARIAN NOL MUTASI STOK
// =============================================================================
runRegTest('REG-05', 'Invarian zero mutation pada penerbitan BAPB (stok tidak dipotong lagi)', () => {
  global.localStorage.clear();
  seedSelectionTransactions();

  // Create draf
  const draft = createBapbDraft({
    items: [{
      sourceSelectionId: 'SEL-2026-001',
      sourceSelectionNo: 'TBS/DIV-I/CULL/SEL-I/10/2026/01',
      klon: 'GT 1',
      quantity: 120
    }],
    asbSignature: validSigASB,
    photos: [validPhoto1]
  }, userASB);

  assert.strictEqual(draft.bapbInventoryEffect, 'ZERO_MUTATION_ALREADY_DEDUCTED_AT_SELECTION');

  // Sign Askep
  const afterAskep = signBapbAskep(draft.id, validSigAskep, '', userAskep);
  assert.strictEqual(afterAskep.bapbInventoryEffect, 'ZERO_MUTATION_ALREADY_DEDUCTED_AT_SELECTION');

  // Finalize Pengurus
  const finalized = finalizeBapbDocument(draft.id, validSigPengurus, '', userPengurus);
  assert.strictEqual(finalized.bapbInventoryEffect, 'ZERO_MUTATION_ALREADY_DEDUCTED_AT_SELECTION');
  assert.strictEqual(finalized.isFinal, true);
});

// =============================================================================
// REG-06: KOMPATIBILITAS CUL HISTORIS
// =============================================================================
runRegTest('REG-06', 'Kompatibilitas record historis CUL tetap terpelihara dan terbaca', () => {
  global.localStorage.clear();

  // Seed 2 transaksi CUL lama (format ASB-10)
  const legacyCulList = [
    {
      id: 'DST-LEGACY-001',
      destructionId: 'DST-LEGACY-001',
      docNo: 'DST/2026/001',
      batchCode: 'BATCH-OLD-01',
      bedengan: 'BED-01',
      clone: 'GT 1',
      quantity: 50,
      reason: 'Bibit mati',
      status: 'DISETUJUI',
      createdAt: '2026-09-01T10:00:00Z'
    },
    {
      id: 'DST-LEGACY-002',
      destructionId: 'DST-LEGACY-002',
      docNo: 'DST/2026/002',
      batchCode: 'BATCH-OLD-02',
      bedengan: 'BED-02',
      clone: 'PB 260',
      quantity: 30,
      reason: 'Afkir Abnormal',
      status: 'MENUNGGU_VERIFIKASI_ASISTEN_BIBITAN',
      createdAt: '2026-09-02T10:00:00Z'
    }
  ];
  storage.set(DESTRUCTION_STORAGE_KEY, legacyCulList);

  // Buat 1 BAPB baru berdampingan dengan CUL lama
  seedSelectionTransactions();
  const bapb = createBapbDraft({
    items: [{
      sourceSelectionId: 'SEL-2026-001',
      sourceSelectionNo: 'TBS/DIV-I/CULL/SEL-I/10/2026/01',
      klon: 'GT 1',
      quantity: 120
    }],
    asbSignature: validSigASB,
    photos: [validPhoto1]
  }, userASB);

  const allInStore = getVerifiedDestructionCollection();
  assert.strictEqual(allInStore.length, 3, 'Total record harus 3 (2 CUL lama + 1 BAPB baru)');

  const cul1 = allInStore.find(r => r.id === 'DST-LEGACY-001');
  const cul2 = allInStore.find(r => r.id === 'DST-LEGACY-002');
  assert.ok(cul1 && cul2, 'Kedua record CUL lama harus tetap ada');
  assert.strictEqual(cul1.quantity, 50, 'Data record CUL 1 tidak termutasi');
  assert.strictEqual(cul2.status, 'MENUNGGU_VERIFIKASI_ASISTEN_BIBITAN', 'Status CUL 2 tidak berubah');
});

// =============================================================================
// REG-07: PRESERVASI SELURUH RECORD NON-TARGET
// =============================================================================
runRegTest('REG-07', 'Preservasi seluruh record non-target saat finalisasi BAPB tertentu', () => {
  global.localStorage.clear();
  seedSelectionTransactions();

  // Buat BAPB A
  const draftA = createBapbDraft({
    items: [{
      sourceSelectionId: 'SEL-2026-001',
      sourceSelectionNo: 'TBS/DIV-I/CULL/SEL-I/10/2026/01',
      klon: 'GT 1',
      quantity: 120
    }],
    asbSignature: validSigASB,
    photos: [validPhoto1]
  }, userASB);

  // Buat BAPB B
  const draftB = createBapbDraft({
    items: [{
      sourceSelectionId: 'SEL-2026-002',
      sourceSelectionNo: 'TBS/DIV-I/CULL/SEL-I/10/2026/02',
      klon: 'PB 260',
      quantity: 85
    }],
    asbSignature: validSigASB,
    photos: [validPhoto1]
  }, userASB);

  // Proses BAPB A sampai FINAL
  signBapbAskep(draftA.id, validSigAskep, 'Askep A', userAskep);
  const finalA = finalizeBapbDocument(draftA.id, validSigPengurus, 'Pengurus A', userPengurus);

  // Periksa apakah BAPB B tetap ada di storage dan statusnya tetap DRAFT_AWAITING_ASKEP
  const current = getVerifiedDestructionCollection();
  assert.strictEqual(current.length, 2, 'Koleksi harus tetap memuat 2 dokumen');
  const recordB = current.find(r => r.id === draftB.id);
  assert.ok(recordB, 'Draf BAPB B harus tetap ada');
  assert.strictEqual(recordB.bapbStatus, BAPB_STATUS.DRAFT_AWAITING_ASKEP, 'Draf BAPB B tidak boleh terpengaruh finalisasi BAPB A');
  assert.strictEqual(recordB.isFinal, false, 'Draf BAPB B tidak boleh ikut menjadi FINAL');
});

// =============================================================================
// REG-08: PENOLAKAN STATUS FINALISASI YANG TIDAK SAH
// =============================================================================
runRegTest('REG-08', 'Pengurus menolak finalisasi jika status bukan persis DRAFT_AWAITING_PENGURUS', () => {
  global.localStorage.clear();
  seedSelectionTransactions();

  // 1. Coba finalisasi draf yang baru dibuat ASB (belum disetujui Askep)
  const draft = createBapbDraft({
    items: [{
      sourceSelectionId: 'SEL-2026-001',
      sourceSelectionNo: 'TBS/DIV-I/CULL/SEL-I/10/2026/01',
      klon: 'GT 1',
      quantity: 120
    }],
    asbSignature: validSigASB,
    photos: [validPhoto1]
  }, userASB);

  assert.throws(
    () => finalizeBapbDocument(draft.id, validSigPengurus, 'Coba finalisasi langsung', userPengurus),
    /Finalisasi ditolak: Status dokumen saat ini adalah DRAFT_AWAITING_ASKEP/,
    'Pengurus wajib menolak draf yang belum disetujui Askep'
  );

  // 2. Askep mengembalikan draf ke ASB
  returnBapbByAskep(draft.id, 'Data foto kurang jelas', userAskep);

  assert.throws(
    () => finalizeBapbDocument(draft.id, validSigPengurus, 'Coba finalisasi draf dikembalikan', userPengurus),
    /Finalisasi ditolak: Status dokumen saat ini adalah DIKEMBALIKAN_KE_ASB/,
    'Pengurus wajib menolak draf yang berstatus DIKEMBALIKAN_KE_ASB'
  );
});

// =============================================================================
// REG-09: PENOLAKAN STORAGE TIDAK VALID (FAIL-CLOSED)
// =============================================================================
runRegTest('REG-09', 'Penolakan fail-closed terhadap storage destruction_transactions tidak valid', () => {
  // Simulasikan storage rusak (berisi object korup, bukan array)
  store.set('sigma:' + DESTRUCTION_STORAGE_KEY, JSON.stringify({ corrupt: true, message: 'not an array' }));

  assert.throws(
    () => getVerifiedDestructionCollection(),
    /CRITICAL_STORAGE_INTEGRITY_ERROR/,
    'getVerifiedDestructionCollection wajib melempar error kritis jika storage bukan array'
  );

  // Pastikan storage TIDAK ditimpa dengan array kosong []
  const rawAfter = store.get('sigma:' + DESTRUCTION_STORAGE_KEY);
  assert.ok(rawAfter.includes('not an array'), 'Storage korup tidak boleh di-reset diam-diam');
});

// =============================================================================
// REG-10: KONSISTENSI ZONA WAKTU WIB PADA PERGANTIAN BULAN
// =============================================================================
runRegTest('REG-10', 'Konsistensi zona waktu WIB (Asia/Jakarta) pada batas pergantian bulan', () => {
  // Misalkan waktu UTC adalah 2026-10-31 23:45:00 UTC
  // Dalam WIB (UTC+7), ini sudah tanggal 2026-11-01 06:45:00 WIB
  const utcDate = new Date('2026-10-31T23:45:00Z');
  const wibResult = getOfficialBusinessTimeWIB(utcDate);

  assert.strictEqual(wibResult.year, 2026, 'Tahun harus 2026');
  assert.strictEqual(wibResult.month, 11, 'Bulan dalam WIB harus 11 (November), bukan 10 (Oktober)');
  assert.strictEqual(wibResult.day, 1, 'Tanggal dalam WIB harus 1');
  assert.strictEqual(wibResult.monthStr, '11', 'String bulan 11');
  assert.strictEqual(wibResult.formattedDate, '01/11/2026', 'Format DD/MM/YYYY');
  assert.strictEqual(wibResult.isoDate, '2026-11-01', 'ISO date YYYY-MM-DD');

  // Nomor resmi yang dialokasikan harus menggunakan bulan 11
  const docNo = formatBapbOfficialDocNo('TB', 'DIV-I', wibResult.month, wibResult.year, 1);
  assert.strictEqual(docNo, 'TB/DIV-I/11/2026/01', 'Nomor resmi harus menggunakan bulan WIB');
});

// =============================================================================
// REG-11: PRESERVASI DATA KETIKA FINALISASI GAGAL
// =============================================================================
runRegTest('REG-11', 'Preservasi data saat finalisasi gagal karena tanda tangan tidak lengkap', () => {
  global.localStorage.clear();
  seedSelectionTransactions();

  // Create draf
  const draft = createBapbDraft({
    items: [{
      sourceSelectionId: 'SEL-2026-001',
      sourceSelectionNo: 'TBS/DIV-I/CULL/SEL-I/10/2026/01',
      klon: 'GT 1',
      quantity: 120
    }],
    asbSignature: validSigASB,
    photos: [validPhoto1]
  }, userASB);

  // Goresan tanda tangan pengurus kosong/terlalu pendek
  signBapbAskep(draft.id, validSigAskep, 'Askep Ok', userAskep);

  assert.throws(
    () => finalizeBapbDocument(draft.id, 'data:image/png;base64,Pendek', 'Pengurus', userPengurus),
    /terlalu sedikit atau kosong/,
    'Tanda tangan terlalu pendek wajib ditolak'
  );

  // Status draf harus tetap DRAFT_AWAITING_PENGURUS
  const records = getVerifiedDestructionCollection();
  const currentDraft = records.find(r => r.id === draft.id);
  assert.strictEqual(currentDraft.bapbStatus, BAPB_STATUS.DRAFT_AWAITING_PENGURUS);
  assert.strictEqual(currentDraft.isFinal, false);
});

// =============================================================================
// REG-12: BUKTI FISIK & TANDA TANGAN VISUAL 3 PEJABAT (TANPA KTU)
// =============================================================================
runRegTest('REG-12', 'Validasi bukti fisik (1-2 foto) dan 3 tanda tangan visual tanpa KTU', () => {
  global.localStorage.clear();
  seedSelectionTransactions();

  // 1. Tolak jika foto 0
  assert.throws(
    () => createBapbDraft({
      items: [{ sourceSelectionId: 'SEL-2026-001', klon: 'GT 1', quantity: 120 }],
      asbSignature: validSigASB,
      photos: []
    }, userASB),
    /minimal 1 foto/,
    'Wajib minimal 1 foto'
  );

  // 2. Tolak jika foto > 2
  assert.throws(
    () => createBapbDraft({
      items: [{ sourceSelectionId: 'SEL-2026-001', klon: 'GT 1', quantity: 120 }],
      asbSignature: validSigASB,
      photos: [validPhoto1, validPhoto2, 'data:image/jpeg;base64,Foto3']
    }, userASB),
    /maksimal 2 foto/,
    'Maksimal 2 foto'
  );

  // 3. Alur lengkap 3 pejabat
  const draft = createBapbDraft({
    items: [{ sourceSelectionId: 'SEL-2026-001', klon: 'GT 1', quantity: 120 }],
    asbSignature: validSigASB,
    photos: [validPhoto1, validPhoto2]
  }, userASB);

  signBapbAskep(draft.id, validSigAskep, 'Disetujui Askep', userAskep);
  const finalDoc = finalizeBapbDocument(draft.id, validSigPengurus, 'Disahkan Pengurus', userPengurus);

  assert.ok(finalDoc.signatures.asb.signatureDataUrl, 'TTD ASB lengkap');
  assert.ok(finalDoc.signatures.askep.signatureDataUrl, 'TTD Askep lengkap');
  assert.ok(finalDoc.signatures.pengurus.signatureDataUrl, 'TTD Pengurus lengkap');
  assert.strictEqual(finalDoc.signatures.ktu, undefined, 'KTU tidak boleh ada');

  // 4. Render HTML cetak A4 dan periksa KTU tidak muncul sama sekali
  const printHtml = renderBapbPrintHtml(finalDoc);
  assert.ok(printHtml.includes('Asisten Divisi Bibitan'), 'Memuat label ASB');
  assert.ok(printHtml.includes('Asisten Kepala'), 'Memuat label Askep');
  assert.ok(printHtml.includes('Pengurus'), 'Memuat label Pengurus');
  assert.ok(!printHtml.includes('Kepala Tata Usaha') && !printHtml.includes('KTU'), 'KTU sama sekali tidak boleh muncul pada dokumen cetak');
});

console.log('================================================================================');
console.log(`HASIL REGRESSION TESTING: ${passCount} PASS, ${failCount} FAIL`);
console.log('================================================================================');
if (failCount > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
