/**
 * tests/test-central-hub-material-verification-suite.js
 *
 * Dedicated Test Suite covering the 12 Mandatory Scenarios for:
 * Task: Perbaikan Alur Central Hub dan Verifikasi Material
 */

// In-memory localStorage mock for isolated node execution
const store = new Map();
global.localStorage = {
  getItem: (k) => store.get(k) || null,
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear()
};

import { storage } from '../js/core/storage.js';
import { todayDDMMYYYY } from '../js/core/utils.js';
import {
  getMantriTodayTransactions,
  submitModuleTransactions,
  submitMantriTransactions,
  MODULE_TYPES
} from '../js/modules/verification/mantri-confirmation-service.js';
import {
  getActionableRecordsForAsb,
  getVerificationRecordsByScope,
  approveVerification,
  returnVerification,
  getAllVerifications,
  VERIFICATION_STATUS
} from '../js/modules/verification/verification-manager.js';
import { createManualMaterialRecord } from '../js/data/material-master.js';
import { resolveUserContext, ROLES } from '../js/core/user-context.js';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) {
    console.error(`  [FAIL] ${message}`);
    failed++;
    throw new Error(message);
  } else {
    console.log(`  [PASS] ${message}`);
    passed++;
  }
}

function resetStorage() {
  global.localStorage.clear();
  const dateStr = new Date().toISOString().slice(0, 10);
  storage.set('attendance_transactions', [
    {
      id: 'ATT-SUP-001',
      date: dateStr,
      type: 'SUPERVISOR',
      role: ROLES.MANTRI_TANAMAN,
      attendanceType: 'DATANG',
      status: 'PRESENT',
      estateId: 'EST-TBS',
      divisionId: 'DIV-001'
    },
    {
      id: 'ATT-WRK-001',
      workerId: 'WRK-001',
      date: dateStr,
      type: 'WORKER',
      attendanceType: 'DATANG',
      status: 'PRESENT',
      estateId: 'EST-TBS',
      divisionId: 'DIV-001'
    }
  ]);
}

const mantriTBS = {
  id: 'TBS-MNT-001',
  userId: 'MNT001',
  name: 'Wagiman',
  role: ROLES.MANTRI_TANAMAN,
  estateId: 'EST-TBS',
  divisionId: 'DIV-001'
};

const asbTBS = {
  id: 'TBS-ASB-001',
  userId: 'ASB001',
  name: 'Budi Santoso',
  role: ROLES.ASISTEN_BIBITAN,
  estateId: 'EST-TBS',
  divisionId: 'DIV-001'
};

const asbOtherEstate = {
  id: 'APM-ASB-001',
  userId: 'ASB002',
  name: 'Hasan Basri',
  role: ROLES.ASISTEN_BIBITAN,
  estateId: 'EST-APM',
  divisionId: 'DIV-002'
};

console.log('================================================================================');
console.log('RUNNING 12 MANDATORY SCENARIOS: CENTRAL HUB & MATERIAL VERIFICATION');
console.log('================================================================================\n');

try {
  // --------------------------------------------------------------------------
  // Skenario 1, 2, 3: SOW dengan Penyemaian dan Material (nomor dokumen sama)
  // --------------------------------------------------------------------------
  console.log('--- Skenario 1, 2, 3: Pengiriman Terisolasi & Id Terpisah (Dokumen SOW Bersama) ---');
  resetStorage();

  const today = todayDDMMYYYY();
  const sowShared = {
    id: 'SOW-SHARED-001',
    docNo: '2026/SOW/999',
    batchNo: 'B-2026-01',
    bedengan: 'BDG-01',
    totalBibit: 1000,
    totalPolybag: 1000,
    totalDisemai: 1000,
    itemCode: '7056599',
    itemName: 'Baby Polybag 15x20',
    uom: 'BH',
    issueDocNo: 'ISSUE-999',
    mantri: 'Wagiman',
    mantriId: 'MNT001',
    createdByUserId: 'TBS-MNT-001',
    createdByName: 'Wagiman',
    tanggal: today,
    date: today,
    estateId: 'EST-TBS',
    divisionId: 'DIV-001',
    status: 'DRAFT',
    materialSubmissionStatus: 'DRAFT',
    createdAt: new Date().toISOString()
  };
  storage.set('seeding_transactions', [sowShared]);

  // Mantri buka Central Hub: harus ada 1 item di Penyemaian dan 1 item di Material
  const allToday = getMantriTodayTransactions(mantriTBS);
  let todayPenyemaian = allToday.filter(it => it.moduleType === MODULE_TYPES.PENYEMAIAN);
  let todayMaterial = allToday.filter(it => it.moduleType === MODULE_TYPES.MATERIAL);

  assert(todayPenyemaian.length === 1 && todayPenyemaian[0].docNo === '2026/SOW/999', 'Skenario 2 Prep: Transaksi Penyemaian terdeteksi di tab Penyemaian');
  assert(todayMaterial.length === 1 && todayMaterial[0].docNo === '2026/SOW/999', 'Skenario 1 Prep: Transaksi Material terdeteksi di tab Material');

  // Submit Penyemaian terlebih dahulu
  const resPen = submitModuleTransactions(MODULE_TYPES.PENYEMAIAN, mantriTBS);
  assert(resPen.submittedCount === 1, 'Skenario 2: Mantri berhasil mengirim transaksi Penyemaian');

  // Cek antrean ASB setelah Penyemaian dikirim
  let asbQueue = getActionableRecordsForAsb(asbTBS);
  assert(asbQueue.some(r => r.referenceDocNo === '2026/SOW/999' && (r.referenceType === 'PENYEMAIAN' || r.referenceType === 'SEEDING')), 'Skenario 2: Penyemaian masuk ke antrean ASB');
  assert(!asbQueue.some(r => r.referenceDocNo === '2026/SOW/999' && r.referenceType === 'MATERIAL'), 'Skenario 1 Check: Material BELUM masuk verifikasi karena belum dikirim');

  // Submit Material
  const resMat = submitModuleTransactions(MODULE_TYPES.MATERIAL, mantriTBS);
  assert(resMat.submittedCount === 1, 'Skenario 1: Mantri berhasil mengirim transaksi Material dari SOW yang sama');

  // Cek antrean ASB setelah Material dikirim
  asbQueue = getActionableRecordsForAsb(asbTBS);
  const penVerif = asbQueue.find(r => r.referenceDocNo === '2026/SOW/999' && (r.referenceType === 'PENYEMAIAN' || r.referenceType === 'SEEDING'));
  const matVerif = asbQueue.find(r => r.referenceDocNo === '2026/SOW/999' && r.referenceType === 'MATERIAL');

  assert(penVerif !== undefined, 'Skenario 1: Penyemaian TIDAK tertimpa saat Material dikirim');
  assert(matVerif !== undefined, 'Skenario 1: Material muncul pada antrean Verifikasi Material ASB');
  assert(penVerif.referenceType !== matVerif.referenceType, 'Skenario 3: Kedua transaksi mempertahankan referenceType masing-masing');

  // Cek di storage verification_transactions
  const allVerifs = getAllVerifications();
  const vPen = allVerifs.find(v => v.referenceDocNo === '2026/SOW/999' && (v.referenceType === 'PENYEMAIAN' || v.referenceType === 'SEEDING'));
  const vMat = allVerifs.find(v => v.referenceDocNo === '2026/SOW/999' && v.referenceType === 'MATERIAL');
  assert(vPen && vMat && vPen.verificationId !== vMat.verificationId, 'Skenario 3: Nomor dokumen sama menghasilkan 2 verifikasi record mandiri');

  // --------------------------------------------------------------------------
  // Skenario 4: Transaksi Material manual dikirim dengan scope yang benar
  // --------------------------------------------------------------------------
  console.log('\n--- Skenario 4: Pencatatan & Verifikasi Material Manual ---');
  const manualMat = createManualMaterialRecord({
    itemCode: '7056599',
    itemName: 'Baby Polybag 15x20',
    quantity: 250,
    uom: 'BH',
    issueDocNo: 'ISSUE-999',
    notes: 'Pemakaian manual polybag'
  }, mantriTBS);

  assert(manualMat.estateId === 'EST-TBS' && manualMat.divisionId === 'DIV-001', 'Skenario 4: Material manual otomatis mewarisi scope estate/divisi kanonikal mantri');

  // Mantri submit material manual
  const resManualMat = submitModuleTransactions(MODULE_TYPES.MATERIAL, mantriTBS);
  assert(resManualMat.submittedCount === 1, 'Skenario 4: Material manual berhasil disubmit lewat Central Hub');

  const asbQueueManual = getActionableRecordsForAsb(asbTBS);
  const manualVerif = asbQueueManual.find(r => r.referenceId === manualMat.id || r.referenceDocNo === manualMat.docNo);
  assert(manualVerif !== undefined, 'Skenario 4: Material manual muncul pada antrean ASB');
  assert(manualVerif.estateId === 'EST-TBS' && manualVerif.divisionId === 'DIV-001', 'Skenario 4: Verifikasi material manual berada dalam scope ASB yang sesuai');

  // --------------------------------------------------------------------------
  // Skenario 5: Pengiriman ulang transaksi Material yang sama (Idempotent)
  // --------------------------------------------------------------------------
  console.log('\n--- Skenario 5: Idempotensi Pengiriman Ulang ---');
  const countBefore = getAllVerifications().length;
  const resRetry = submitModuleTransactions(MODULE_TYPES.MATERIAL, mantriTBS);
  assert(resRetry.submittedCount === 0, 'Skenario 5: Pengiriman ulang tidak men-submit transaksi yang sudah berstatus submitted');
  const countAfter = getAllVerifications().length;
  assert(countBefore === countAfter, 'Skenario 5: Tidak ada pembuatan verification_transactions ganda');

  // --------------------------------------------------------------------------
  // Skenario 6: Asisten menyetujui Penyemaian -> Status Material TIDAK berubah
  // --------------------------------------------------------------------------
  console.log('\n--- Skenario 6: Independensi Persetujuan Penyemaian ---');
  approveVerification({
    referenceType: 'PENYEMAIAN',
    referenceId: sowShared.id,
    currentUser: asbTBS
  });

  const rawSeedAfterPenApprove = storage.get('seeding_transactions', []).find(s => s.id === sowShared.id);
  assert(rawSeedAfterPenApprove.status === 'DISETUJUI', 'Skenario 6: Status Penyemaian menjadi DISETUJUI');
  assert(rawSeedAfterPenApprove.materialSubmissionStatus === 'SUBMITTED_TO_ASB', 'Skenario 6: Status Material TETAP SUBMITTED_TO_ASB (tidak ikut disetujui)');

  // --------------------------------------------------------------------------
  // Skenario 9: Penyemaian sudah final, Material tetap tersedia untuk diverifikasi
  // --------------------------------------------------------------------------
  console.log('\n--- Skenario 9: Material Tetap Actionable Meski Penyemaian Sudah Final ---');
  assert(rawSeedAfterPenApprove.isFinal === true, 'Skenario 9 Prep: Penyemaian sudah berstatus final');
  const asbQueueAfterPenApprove = getActionableRecordsForAsb(asbTBS);
  const matStillActionable = asbQueueAfterPenApprove.find(r => r.referenceDocNo === '2026/SOW/999' && r.referenceType === 'MATERIAL');
  assert(matStillActionable !== undefined, 'Skenario 9: Transaksi Material tetap muncul di antrean ASB walaupun Penyemaian sudah final');

  // --------------------------------------------------------------------------
  // Skenario 8: Asisten mengembalikan Material untuk revisi
  // --------------------------------------------------------------------------
  console.log('\n--- Skenario 8: Asisten Mengembalikan Material untuk Revisi ---');
  returnVerification({
    referenceType: 'MATERIAL',
    referenceId: sowShared.id,
    returnReason: 'Jumlah polybag tidak sesuai fisik lapangan',
    currentUser: asbTBS
  });

  const rawSeedAfterMatReturn = storage.get('seeding_transactions', []).find(s => s.id === sowShared.id);
  assert(rawSeedAfterMatReturn.materialSubmissionStatus === 'DIKEMBALIKAN', 'Skenario 8: Status Material menjadi DIKEMBALIKAN');
  assert(rawSeedAfterMatReturn.status === 'DISETUJUI', 'Skenario 8: Status Penyemaian TETAP DISETUJUI (tidak ikut dikembalikan)');

  // Cek Central Hub Mantri: Material muncul sebagai REVISION
  const hubAfterReturn = getMantriTodayTransactions(mantriTBS);
  const matHubItem = hubAfterReturn.find(i => i.moduleType === MODULE_TYPES.MATERIAL && i.docNo === '2026/SOW/999');
  assert(matHubItem && matHubItem.status === 'REVISION', 'Skenario 8: Central Hub Mantri menampilkan status REVISION untuk Material');

  // Mantri kirim ulang setelah perbaikan
  const resResubmit = submitModuleTransactions(MODULE_TYPES.MATERIAL, mantriTBS);
  assert(resResubmit.submittedCount === 1, 'Skenario 8: Mantri berhasil submit ulang revisi Material');

  // --------------------------------------------------------------------------
  // Skenario 7: Asisten menyetujui Material -> Status Penyemaian tidak berubah
  // --------------------------------------------------------------------------
  console.log('\n--- Skenario 7: Asisten Menyetujui Material ---');
  approveVerification({
    referenceType: 'MATERIAL',
    referenceId: sowShared.id,
    currentUser: asbTBS
  });

  const rawSeedAfterMatApprove = storage.get('seeding_transactions', []).find(s => s.id === sowShared.id);
  assert(rawSeedAfterMatApprove.materialSubmissionStatus === 'DISETUJUI', 'Skenario 7: Status Material menjadi DISETUJUI');
  assert(rawSeedAfterMatApprove.status === 'DISETUJUI', 'Skenario 7: Status Penyemaian tetap konsisten');

  // Cek antrean ASB: sekarang keduanya sudah disetujui, tidak ada yang pending
  const asbQueueFinal = getActionableRecordsForAsb(asbTBS);
  const sowFinalInQueue = asbQueueFinal.find(r => r.referenceDocNo === '2026/SOW/999');
  assert(sowFinalInQueue === undefined, 'Skenario 7: SOW (Penyemaian & Material) yang sudah disetujui selesai dari antrean pending');

  // --------------------------------------------------------------------------
  // Skenario 10: Isolasi Estate dan Divisi (Tidak terjadi kebocoran lintas scope)
  // --------------------------------------------------------------------------
  console.log('\n--- Skenario 10: Isolasi Scope Estate dan Divisi ---');
  // Buat transaksi material manual di TBS
  const tbsMat = createManualMaterialRecord({
    itemCode: '7056599',
    itemName: 'Baby Polybag 15x20',
    quantity: 100,
    uom: 'BH',
    issueDocNo: 'ISSUE-999'
  }, mantriTBS);
  submitModuleTransactions(MODULE_TYPES.MATERIAL, mantriTBS);

  // ASB TBS dapat melihatnya
  const tbsQueue = getActionableRecordsForAsb(asbTBS);
  assert(tbsQueue.some(r => r.referenceId === tbsMat.id || r.referenceDocNo === tbsMat.docNo), 'Skenario 10: ASB TBS dapat melihat transaksi estate TBS');

  // ASB APM (kebun berbeda) TIDAK dapat melihatnya
  const apmQueue = getActionableRecordsForAsb(asbOtherEstate);
  assert(!apmQueue.some(r => r.referenceId === tbsMat.id || r.referenceDocNo === tbsMat.docNo), 'Skenario 10: ASB APM TIDAK dapat melihat transaksi estate TBS (Terisolasi)');

  // --------------------------------------------------------------------------
  // Skenario 11: Modul lain menggunakan Central Hub dan Verifikasi
  // --------------------------------------------------------------------------
  console.log('\n--- Skenario 11: Modul Lain Tetap Berfungsi Normal ---');
  const ddrTx = {
    id: 'DDR-001',
    docNo: '2026/DDR/001',
    batchNo: 'B-001',
    bedengan: 'BDG-01',
    totalKecambah: 500,
    jumlahDeder: 500,
    mantri: 'Wagiman',
    mantriId: 'MNT001',
    createdByUserId: 'TBS-MNT-001',
    createdByName: 'Wagiman',
    tanggal: today,
    date: today,
    estateId: 'EST-TBS',
    divisionId: 'DIV-001',
    status: 'DRAFT',
    createdAt: new Date().toISOString()
  };
  storage.set('dederan_transactions', [ddrTx]);

  const allHubDdr = getMantriTodayTransactions(mantriTBS);
  const hubDdr = allHubDdr.filter(it => it.moduleType === MODULE_TYPES.DEDERAN);
  assert(hubDdr.length === 1 && hubDdr[0].docNo === '2026/DDR/001', 'Skenario 11: Modul Dederan tetap terbaca di Central Hub');

  const resDdr = submitModuleTransactions(MODULE_TYPES.DEDERAN, mantriTBS);
  assert(resDdr.submittedCount === 1, 'Skenario 11: Modul Dederan berhasil disubmit via Central Hub');

  const asbQueueDdr = getActionableRecordsForAsb(asbTBS);
  assert(asbQueueDdr.some(r => r.referenceDocNo === '2026/DDR/001'), 'Skenario 11: Modul Dederan masuk ke antrean verifikasi ASB');

  // --------------------------------------------------------------------------
  // Skenario 12: Refresh data & konsistensi verifikasi per modul
  // --------------------------------------------------------------------------
  console.log('\n--- Skenario 12: Konsistensi Antar Modul dan Resolusi Status ---');
  const verifsAfterAll = getVerificationRecordsByScope(asbTBS);
  const matScopeVerif = verifsAfterAll.find(v => v.referenceDocNo === '2026/SOW/999' && v.referenceType === 'MATERIAL');
  const penScopeVerif = verifsAfterAll.find(v => v.referenceDocNo === '2026/SOW/999' && (v.referenceType === 'PENYEMAIAN' || v.referenceType === 'SEEDING'));

  assert(matScopeVerif && matScopeVerif.verificationStatus === VERIFICATION_STATUS.TERVERIFIKASI, 'Skenario 12: Verifikasi Material tersimpan stabil sebagai TERVERIFIKASI');
  assert(penScopeVerif && penScopeVerif.verificationStatus === VERIFICATION_STATUS.TERVERIFIKASI, 'Skenario 12: Verifikasi Penyemaian tersimpan stabil sebagai TERVERIFIKASI');

  console.log('\n================================================================================');
  console.log(`ALL SCENARIOS COMPLETED: PASSED = ${passed} | FAILED = ${failed}`);
  console.log('================================================================================');

} catch (err) {
  console.error('\n[FATAL TEST RUNNER ERROR]:', err);
  process.exit(1);
}
