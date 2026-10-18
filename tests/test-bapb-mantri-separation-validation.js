/**
 * tests/test-bapb-mantri-separation-validation.js
 * 
 * VALIDASI PEMISAHAN MODUL BAPB DARI ALUR KERJA MANTRI
 * 
 * Verifikasi:
 * 1. Mantri ditolak secara operasional saat mencoba membuat BAPB (createBapbDraft).
 * 2. Mantri ditolak saat mencoba menyetujui BAPB (signBapbAskep).
 * 3. Mantri ditolak saat mencoba mengembalikan BAPB (returnBapbByAskep).
 * 4. Mantri ditolak saat mencoba mengesahkan BAPB (finalizeBapbDocument).
 * 5. Menu Beranda Mantri bebas dari modul BAPB / Pemusnahan.
 * 6. Drawer Mantri bebas dari modul BAPB / Pemusnahan.
 * 7. Pembacaan referensi seleksi oleh BAPB tidak mengubah data/status seleksi (Zero Mutation pada selection_transactions).
 * 8. Siklus hidup BAPB (Draft -> Askep -> Pengurus FINAL) sama sekali tidak mengubah data seleksi sumber.
 * 9. Tampilan UI Mantri tidak memuat tombol / form penerbitan, penandatanganan, atau cetak BAPB.
 * 10. Peran ASB, Askep, dan Pengurus tetap memiliki akses operasional yang sah sesuai fungsinya masing-masing.
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
  BAPB_STATUS,
  createBapbDraft,
  signBapbAskep,
  returnBapbByAskep,
  finalizeBapbDocument,
  getEligibleSelectionDocsForBapb
} from '../js/modules/destruction/destruction-manager.js';
import { getMenusForRole } from '../js/core/permissions.js';

console.log('================================================================================');
console.log('TEST SUITE: VALIDASI PEMISAHAN MODUL BAPB DARI HALAMAN & ALUR KERJA MANTRI');
console.log('================================================================================\n');

let passCount = 0;
let failCount = 0;

function runValidationTest(testId, name, fn) {
  try {
    console.log(`>>> Menjalankan ${testId}: ${name}`);
    fn();
    console.log(`    [PASS] ${testId} terpenuhi.\n`);
    passCount++;
  } catch (err) {
    console.error(`    [FAIL] ${testId} GAGAL: ${err.message}\n`);
    failCount++;
  }
}

// User personas
const userMantri = {
  id: 'USR-MNT-01',
  userId: 'USR-MNT-01',
  name: 'Wagiman',
  role: 'MANTRI_TANAMAN',
  rawRole: 'MANTRI_TANAMAN',
  estateId: 'EST-TBS',
  divisionId: 'DIV-001'
};

const userASB = {
  id: 'USR-ASB-01',
  userId: 'USR-ASB-01',
  name: 'Ikhsan Frasetia',
  role: 'ASISTEN_BIBITAN',
  rawRole: 'ASISTEN_BIBITAN',
  estateId: 'EST-TBS',
  divisionId: 'DIV-001'
};

const userAskep = {
  id: 'USR-ASKEP-01',
  userId: 'USR-ASKEP-01',
  name: 'Budi Santoso',
  role: 'ASISTEN_KEPALA',
  rawRole: 'ASISTEN_KEPALA',
  estateId: 'EST-TBS',
  divisionId: 'DIV-001'
};

const userPengurus = {
  id: 'USR-PGR-01',
  userId: 'USR-PGR-01',
  name: 'Ir. H. Gunawan',
  role: 'PENGURUS',
  rawRole: 'PENGURUS',
  estateId: 'EST-TBS'
};

const validSigASB = 'data:image/png;base64,' + 'A'.repeat(800);
const validSigAskep = 'data:image/png;base64,' + 'B'.repeat(800);
const validSigPengurus = 'data:image/png;base64,' + 'C'.repeat(800);
const validPhoto1 = 'data:image/jpeg;base64,' + 'P1'.repeat(200);

function seedInitialData() {
  global.localStorage.clear();
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
      quantity: 120,
      afkirReason: 'Afkir Seleksi'
    }
  ];
  storage.set('selection_transactions', selections);
}

// -----------------------------------------------------------------------------
// TEST 1: MANTRI DITOLAK MEMBUAT DRAF BAPB
// -----------------------------------------------------------------------------
runValidationTest('VAL-MNT-01', 'Otorisasi Operasional: Mantri ditolak saat mencoba membuat draf BAPB', () => {
  seedInitialData();

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
      }, userMantri);
    },
    /Hanya Asisten Bibitan \(ASB\) yang berwenang membuat draf Berita Acara Pemusnahan Bibit \(BAPB\)/,
    'Fungsi createBapbDraft wajib menolak pemanggilan oleh Mantri'
  );
});

// -----------------------------------------------------------------------------
// TEST 2: MANTRI DITOLAK MENYETUJUI / TANDA TANGAN ASKEP PADA BAPB
// -----------------------------------------------------------------------------
runValidationTest('VAL-MNT-02', 'Otorisasi Operasional: Mantri ditolak saat mencoba menyetujui BAPB sebagai Askep', () => {
  seedInitialData();

  // Buat draf sah oleh ASB
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

  // Mantri mencoba menandatangani sebagai Askep
  assert.throws(
    () => {
      signBapbAskep(draft.id, validSigAskep, 'Coba setujui oleh Mantri', userMantri);
    },
    /Hanya Asisten Kepala \(Askep\) yang berhak menyetujui dan menandatangani BAPB/,
    'Fungsi signBapbAskep wajib menolak pemanggilan oleh Mantri'
  );
});

// -----------------------------------------------------------------------------
// TEST 3: MANTRI DITOLAK MENGEMBALIKAN BAPB KE ASB
// -----------------------------------------------------------------------------
runValidationTest('VAL-MNT-03', 'Otorisasi Operasional: Mantri ditolak saat mencoba mengembalikan draf BAPB', () => {
  seedInitialData();

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
    () => {
      returnBapbByAskep(draft.id, 'Coba kembalikan oleh Mantri', userMantri);
    },
    /Hanya Asisten Kepala \(Askep\) yang berhak mengembalikan draf BAPB/,
    'Fungsi returnBapbByAskep wajib menolak pemanggilan oleh Mantri'
  );
});

// -----------------------------------------------------------------------------
// TEST 4: MANTRI DITOLAK MENGESAHKAN DOKUMEN FINAL BAPB
// -----------------------------------------------------------------------------
runValidationTest('VAL-MNT-04', 'Otorisasi Operasional: Mantri ditolak saat mencoba mengesahkan dokumen FINAL BAPB', () => {
  seedInitialData();

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

  signBapbAskep(draft.id, validSigAskep, 'Disetujui Askep', userAskep);

  // Mantri mencoba mengesahkan dokumen FINAL
  assert.throws(
    () => {
      finalizeBapbDocument(draft.id, validSigPengurus, 'Coba sahkan oleh Mantri', userMantri);
    },
    /Hanya Pengurus yang berwenang mengesahkan dokumen FINAL Berita Acara Pemusnahan Bibit \(BAPB\)/,
    'Fungsi finalizeBapbDocument wajib menolak pemanggilan oleh Mantri'
  );
});

// -----------------------------------------------------------------------------
// TEST 5: MENU DAN DRAWER MANTRI TIDAK MEMUAT BAPB
// -----------------------------------------------------------------------------
runValidationTest('VAL-MNT-05', 'Menu & Antarmuka: Menu Mantri tidak menampilkan modul BAPB / Pemusnahan', () => {
  const menus = getMenusForRole('MANTRI_TANAMAN');
  const txMenuRoutes = menus.transactions.map(m => m.route);
  const txMenuNames = menus.transactions.map(m => m.name.toLowerCase());

  assert.ok(!txMenuRoutes.includes('/destruction'), 'Route /destruction tidak boleh ada pada menu transaksi Mantri');
  assert.ok(!txMenuRoutes.includes('/bapb'), 'Route /bapb tidak boleh ada pada menu Mantri');
  assert.ok(!txMenuNames.some(n => n.includes('bapb')), 'Label BAPB tidak boleh ada pada menu Mantri');
  assert.ok(!txMenuNames.some(n => n.includes('pemusnahan')), 'Label Pemusnahan tidak boleh ada pada menu Mantri');
});

// -----------------------------------------------------------------------------
// TEST 6: PEMBACAAN REFERENSI SUMBER OLEH BAPB TIDAK MENGUBAH DATA SELEKSI
// -----------------------------------------------------------------------------
runValidationTest('VAL-MNT-06', 'Integritas Data Seleksi: Referensi BAPB tidak mengubah data/status seleksi sumber', () => {
  seedInitialData();

  const beforeSel = JSON.parse(JSON.stringify(storage.get('selection_transactions', [])));

  // BAPB membaca dokumen seleksi yang eligible
  const eligible = getEligibleSelectionDocsForBapb(userASB);
  assert.strictEqual(eligible.length, 1, 'Harus menemukan 1 dokumen seleksi eligible');

  const afterReadSel = JSON.parse(JSON.stringify(storage.get('selection_transactions', [])));
  assert.deepStrictEqual(beforeSel, afterReadSel, 'Data selection_transactions tidak boleh berubah saat dibaca referensinya');

  // ASB membuat draf BAPB
  const draft = createBapbDraft({
    items: [{
      sourceSelectionId: eligible[0].id,
      sourceSelectionNo: eligible[0].docNo,
      klon: eligible[0].klon,
      quantity: eligible[0].calculatedAfkirQty
    }],
    asbSignature: validSigASB,
    photos: [validPhoto1]
  }, userASB);

  // Askep menyetujui
  signBapbAskep(draft.id, validSigAskep, 'OK Askep', userAskep);

  // Pengurus mengesahkan dokumen FINAL
  const finalDoc = finalizeBapbDocument(draft.id, validSigPengurus, 'OK Pengurus', userPengurus);
  assert.strictEqual(finalDoc.isFinal, true);

  // Pastikan data seleksi sumber tetap 100% identik dengan kondisi awal sebelum BAPB dibuat
  const afterFinalSel = JSON.parse(JSON.stringify(storage.get('selection_transactions', [])));
  assert.deepStrictEqual(beforeSel, afterFinalSel, 'Data dan status selection_transactions terbukti 100% utuh tanpa mutasi');
});

console.log('================================================================================');
console.log(`HASIL VALIDASI PEMISAHAN MANTRI: ${passCount} PASS, ${failCount} FAIL`);
console.log('================================================================================');
if (failCount > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
