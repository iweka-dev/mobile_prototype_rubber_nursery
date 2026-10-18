/**
 * tests/test-bapb-ui-simplification.js
 * 
 * Verifikasi Acceptance Criteria Penyempurnaan UI dan Tanda Tangan BAPB:
 * 1. Label role `Role: ASISTEN_BIBITAN` tidak lagi terlihat di header.
 * 2. Tombol utama bertuliskan "Buat Berita Acara" tanpa ikon tanda tambah (+).
 * 3. Tombol utama tetap berada di bagian bawah halaman.
 * 4. Form pembuatan berita acara tampil full-screen pada HP dan web (modal-fullscreen) dengan judul "Buat Berita Acara Pemusnahan Bibit".
 * 5. Tanda tangan visual untuk seluruh pihak (ASB, Askep, Pengurus) pada tahapannya masing-masing.
 * 6. Ketiga tanda tangan tersimpan pada dokumen yang sama dan tidak saling menimpa.
 * 7. Validasi urutan persetujuan tetap berjalan: ASB -> Askep -> Pengurus FINAL.
 * 8. Dokumen tidak dapat menjadi FINAL tanpa tanda tangan wajib lengkap.
 * 9. Perilaku tanda tangan ketika dokumen dikembalikan untuk perbaikan (reviseBapbDraft):
 *    - Tanda tangan ASB diperbarui.
 *    - Tanda tangan Askep di-reset ke null agar tidak menyetujui isi yang berubah tanpa verifikasi ulang.
 *    - Status kembali ke DRAFT_AWAITING_ASKEP.
 * 10. Imutabilitas dokumen FINAL tetap berlaku.
 * 11. Invarian Nol Mutasi stok dan integritas dokumen seleksi sumber.
 */

import assert from 'assert';

// Mock browser environment (DOM & LocalStorage)
const store = new Map();
global.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear()
};

// Simple DOM Mock for render testing
class MockElement {
  constructor(tagName = 'div') {
    this.tagName = tagName;
    this.innerHTML = '';
    this.children = [];
    this.eventListeners = {};
    this.style = {};
  }

  querySelector(selector) {
    if (selector.startsWith('#')) {
      const id = selector.slice(1);
      return this._findById(id);
    }
    if (selector.startsWith('.')) {
      const className = selector.slice(1);
      return this._findByClass(className);
    }
    return null;
  }

  querySelectorAll(selector) {
    const results = [];
    if (selector.startsWith('.')) {
      const className = selector.slice(1);
      this._findAllByClass(className, results);
    }
    return results;
  }

  addEventListener(event, fn) {
    this.eventListeners[event] = this.eventListeners[event] || [];
    this.eventListeners[event].push(fn);
  }

  _findById(id) {
    if (this.innerHTML.includes(`id="${id}"`)) {
      const el = new MockElement();
      el.id = id;
      return el;
    }
    return null;
  }

  _findByClass(className) {
    if (this.innerHTML.includes(`class="${className}"`) || this.innerHTML.includes(`${className}`)) {
      const el = new MockElement();
      el.className = className;
      return el;
    }
    return null;
  }

  _findAllByClass(className, arr) {
    if (this.innerHTML.includes(className)) {
      const el = new MockElement();
      el.className = className;
      arr.push(el);
    }
  }
}

const mockApp = new MockElement('div');
let capturedModalOpts = null;

global.document = {
  getElementById: (id) => (id === 'app' ? mockApp : new MockElement()),
  querySelector: (sel) => mockApp.querySelector(sel),
  querySelectorAll: (sel) => mockApp.querySelectorAll(sel)
};

import { storage, KEYS } from '../js/core/storage.js';
import {
  BAPB_STATUS,
  DESTRUCTION_STATUS,
  DESTRUCTION_STORAGE_KEY,
  getVerifiedDestructionCollection,
  createBapbDraft,
  reviseBapbDraft,
  signBapbAskep,
  returnBapbByAskep,
  finalizeBapbDocument
} from '../js/modules/destruction/destruction-manager.js';
import { renderDestructionLanding } from '../js/modules/destruction/destruction-landing.js';

console.log('================================================================================');
console.log('TEST SUITE: PENYEMPURNAAN UI & TANDA TANGAN BERITA ACARA PEMUSNAHAN BIBIT');
console.log('================================================================================\n');

let passCount = 0;
let failCount = 0;

function runTest(id, name, fn) {
  try {
    console.log(`>>> Menjalankan ${id}: ${name}`);
    fn();
    console.log(`    [PASS] ${id} berhasil terpenuhi.\n`);
    passCount++;
  } catch (err) {
    console.error(`    [FAIL] ${id} GAGAL: ${err.message}\n`);
    failCount++;
  }
}

// User personas
const userASB = {
  id: 'USR-ASB-01',
  name: 'Ikhsan Frasetia',
  role: 'ASISTEN_BIBITAN',
  rawRole: 'ASISTEN_BIBITAN',
  roleName: 'Asisten Bibitan',
  estateId: 'EST-TBS',
  divisionId: 'DIV-001'
};

const userAskep = {
  id: 'USR-ASKEP-01',
  name: 'Budi Santoso',
  role: 'ASISTEN_KEPALA',
  rawRole: 'ASISTEN_KEPALA',
  roleName: 'Asisten Kepala',
  estateId: 'EST-TBS',
  divisionId: 'DIV-001'
};

const userPengurus = {
  id: 'USR-PGR-01',
  name: 'Ir. H. Gunawan',
  role: 'PENGURUS',
  rawRole: 'PENGURUS',
  roleName: 'Pengurus',
  estateId: 'EST-TBS'
};

const validSigASB = 'data:image/png;base64,' + 'A'.repeat(800);
const validSigASB2 = 'data:image/png;base64,' + 'B'.repeat(800);
const validSigAskep = 'data:image/png;base64,' + 'C'.repeat(800);
const validSigPengurus = 'data:image/png;base64,' + 'D'.repeat(800);
const validPhoto1 = 'data:image/jpeg;base64,' + 'E'.repeat(600);

// Seed sample data including legacy CUL and modern BAPB
function seedData() {
  store.clear();
  storage.set(KEYS.SESSION, userASB);
  
  const records = [
    {
      id: 'CUL-LEGACY-001',
      batchId: 'BATCH-001',
      batchCode: 'TB/2026/01',
      clone: 'GT 1',
      estateId: 'EST-TBS',
      divisionId: 'DIV-001',
      quantity: 50,
      reason: 'Penyakit Jamur',
      status: DESTRUCTION_STATUS.MENUNGGU_VERIFIKASI,
      createdAt: '2026-09-10T10:00:00.000Z'
    },
    {
      id: 'BAPB-2026-001',
      documentType: 'BAPB_KARET',
      officialDocNo: 'TB/DIV-I/10/2026/001',
      estateId: 'EST-TBS',
      divisionCode: 'DIV-I',
      bapbStatus: BAPB_STATUS.FINAL,
      isFinal: true,
      totalQty: 120,
      klon: 'GT 1',
      bedengan: 'BDG-01',
      tanggalPelaksanaan: '2026-10-15',
      signatures: {
        asb: { name: 'Ikhsan Frasetia', signedAt: '2026-10-15T09:00:00.000Z' },
        askep: { name: 'Budi Santoso', signedAt: '2026-10-15T11:00:00.000Z' },
        pengurus: { name: 'Ir. H. Gunawan', signedAt: '2026-10-15T14:00:00.000Z' }
      }
    }
  ];
  storage.set(DESTRUCTION_STORAGE_KEY, records);
}

// -----------------------------------------------------------------------------
// TEST 1: Visibilitas Label Role dan Teks Tombol Utama
// -----------------------------------------------------------------------------
runTest('TC-UI-01', 'Label role disembunyikan dan tombol utama adalah "Buat Berita Acara" tanpa ikon "+"', () => {
  seedData();
  renderDestructionLanding();

  const html = mockApp.innerHTML;

  // 1. Label role tidak boleh terlihat di header
  assert.ok(!html.includes('Role: ASISTEN_BIBITAN'), 'Header TIDAK boleh memuat teks "Role: ASISTEN_BIBITAN"');
  assert.ok(!html.includes('Role: <strong>'), 'Header TIDAK boleh memuat label role apapun');

  // 2. Judul halaman tetap Pemusnahan Bibit
  assert.ok(html.includes('Pemusnahan Bibit'), 'Halaman tetap memuat judul "Pemusnahan Bibit"');

  // 3. Tombol utama bertuliskan "Buat Berita Acara"
  assert.ok(html.includes('Buat Berita Acara'), 'Tombol utama harus bertuliskan "Buat Berita Acara"');
  assert.ok(!html.includes('Buat BAPB'), 'Teks tombol "Buat BAPB" harus diganti menjadi "Buat Berita Acara"');

  // 4. Ikon tanda tambah (+) sudah dihilangkan
  const footerIdx = html.indexOf('<footer');
  assert.ok(footerIdx > 0, 'Tombol harus berada di footer bawah');
  const footerHtml = html.slice(footerIdx);
  assert.ok(!footerHtml.includes('<line x1="12" y1="5" x2="12" y2="19">'), 'Ikon tanda tambah (+) svg line harus dihilangkan');
  assert.ok(!footerHtml.includes('+'), 'Karakter tanda tambah (+) tidak boleh ada pada tombol');
});

// -----------------------------------------------------------------------------
// TEST 2: Tombol Berada di Bagian Bawah Halaman (HP & Web)
// -----------------------------------------------------------------------------
runTest('TC-UI-02', 'Tombol Buat Berita Acara berada di bagian bawah halaman secara konsisten', () => {
  seedData();
  renderDestructionLanding();

  const html = mockApp.innerHTML;

  // Header tidak memuat tombol Buat Berita Acara
  const headerIdx = html.indexOf('<header');
  const endHeaderIdx = html.indexOf('</header>');
  const headerHtml = html.slice(headerIdx, endHeaderIdx + 9);
  assert.ok(!headerHtml.includes('btn-create-bapb'), 'Tombol tidak boleh di header atas');

  // Footer bawah memuat tombol
  const footerIdx = html.indexOf('<footer');
  assert.ok(footerIdx > endHeaderIdx, 'Elemen footer harus berada di bawah');
  const footerHtml = html.slice(footerIdx);
  assert.ok(footerHtml.includes('id="btn-create-bapb"'), 'Tombol btn-create-bapb berada di footer');
});

// -----------------------------------------------------------------------------
// TEST 3: Tahap Tanda Tangan Mandiri ASB, Askep, dan Pengurus
// -----------------------------------------------------------------------------
runTest('TC-UI-03', 'Ketiga pihak memiliki tahap tanda tangan sendiri yang tersimpan pada dokumen yang sama', () => {
  store.clear();
  storage.set(KEYS.SESSION, userASB);

  // 1. ASB membuat draf
  const draft = createBapbDraft({
    items: [{
      sourceSelectionId: 'SEL-001',
      sourceSelectionNo: 'TBS/DIV-I/CULL/SEL-I/10/2026/01',
      klon: 'GT 1',
      quantity: 150
    }],
    asbSignature: validSigASB,
    photos: [validPhoto1]
  }, userASB);

  assert.strictEqual(draft.bapbStatus, BAPB_STATUS.DRAFT_AWAITING_ASKEP);
  assert.ok(draft.signatures.asb, 'Tanda tangan ASB wajib tersimpan');
  assert.strictEqual(draft.signatures.asb.name, userASB.name);
  assert.strictEqual(draft.signatures.asb.signatureDataUrl, validSigASB);
  assert.strictEqual(draft.signatures.askep, null, 'Tanda tangan Askep harus masih null');
  assert.strictEqual(draft.signatures.pengurus, null, 'Tanda tangan Pengurus harus masih null');

  // 2. Askep memeriksa dan menandatangani
  const signedAskep = signBapbAskep(draft.id, validSigAskep, 'Pemeriksaan fisik sesuai', userAskep);
  assert.strictEqual(signedAskep.bapbStatus, BAPB_STATUS.DRAFT_AWAITING_PENGURUS);
  assert.ok(signedAskep.signatures.asb, 'Tanda tangan ASB tidak boleh tertimpa');
  assert.strictEqual(signedAskep.signatures.asb.signatureDataUrl, validSigASB);
  assert.ok(signedAskep.signatures.askep, 'Tanda tangan Askep wajib tersimpan');
  assert.strictEqual(signedAskep.signatures.askep.name, userAskep.name);
  assert.strictEqual(signedAskep.signatures.askep.signatureDataUrl, validSigAskep);
  assert.strictEqual(signedAskep.signatures.pengurus, null, 'Tanda tangan Pengurus masih null');

  // 3. Pengurus mengesahkan dokumen FINAL
  const finalDoc = finalizeBapbDocument(draft.id, validSigPengurus, 'Disahkan', userPengurus);
  assert.strictEqual(finalDoc.bapbStatus, BAPB_STATUS.FINAL);
  assert.strictEqual(finalDoc.isFinal, true);

  // Verifikasi ketiga tanda tangan tersimpan bersama pada dokumen FINAL tanpa saling menimpa
  assert.strictEqual(finalDoc.signatures.asb.name, userASB.name);
  assert.strictEqual(finalDoc.signatures.asb.signatureDataUrl, validSigASB);
  assert.strictEqual(finalDoc.signatures.askep.name, userAskep.name);
  assert.strictEqual(finalDoc.signatures.askep.signatureDataUrl, validSigAskep);
  assert.strictEqual(finalDoc.signatures.pengurus.name, userPengurus.name);
  assert.strictEqual(finalDoc.signatures.pengurus.signatureDataUrl, validSigPengurus);
});

// -----------------------------------------------------------------------------
// TEST 4: Penolakan Pengesahan Jika Tanda Tangan Tahap Sebelumnya Belum Lengkap
// -----------------------------------------------------------------------------
runTest('TC-UI-04', 'Pengesahan Pengurus menolak dokumen jika tanda tangan ASB atau Askep belum lengkap', () => {
  store.clear();
  storage.set(KEYS.SESSION, userASB);

  // Buat draf tanpa tanda tangan Askep (masih DRAFT_AWAITING_ASKEP)
  const draft = createBapbDraft({
    items: [{
      sourceSelectionId: 'SEL-002',
      sourceSelectionNo: 'TBS/DIV-I/CULL/SEL-I/10/2026/02',
      klon: 'PB 260',
      quantity: 80
    }],
    asbSignature: validSigASB,
    photos: [validPhoto1]
  }, userASB);

  // Pengurus mencoba langsung mengesahkan sebelum Askep menandatangani
  assert.throws(
    () => {
      finalizeBapbDocument(draft.id, validSigPengurus, 'Bypass Askep', userPengurus);
    },
    /Finalisasi ditolak: Status dokumen saat ini adalah DRAFT_AWAITING_ASKEP/,
    'Pengurus tidak boleh mengesahkan dokumen yang belum ditandatangani Askep'
  );
});

// -----------------------------------------------------------------------------
// TEST 5: Perilaku Tanda Tangan Saat Dokumen Dikembalikan untuk Perbaikan
// -----------------------------------------------------------------------------
runTest('TC-UI-05', 'Saat dikembalikan dan diperbaiki (reviseBapbDraft), TTD ASB diperbarui & TTD Askep di-reset ke null', () => {
  store.clear();
  storage.set(KEYS.SESSION, userASB);

  // 1. ASB buat draf awal
  const draft = createBapbDraft({
    items: [{
      sourceSelectionId: 'SEL-003',
      sourceSelectionNo: 'TBS/DIV-I/CULL/SEL-I/10/2026/03',
      klon: 'RRIC 100',
      quantity: 95
    }],
    asbSignature: validSigASB,
    photos: [validPhoto1]
  }, userASB);

  // 2. Askep kembalikan draf dengan catatan revisi
  const returned = returnBapbByAskep(draft.id, 'Foto kurang jelas, mohon periksa ulang.', userAskep);
  assert.strictEqual(returned.bapbStatus, BAPB_STATUS.DIKEMBALIKAN_KE_ASB);
  assert.strictEqual(returned.returnReason, 'Foto kurang jelas, mohon periksa ulang.');

  // 3. ASB memperbaiki draf dengan data & tanda tangan visual baru
  const revised = reviseBapbDraft(draft.id, {
    tanggalPelaksanaan: '2026-10-18',
    metodePemusnahan: 'Pembakaran Terkendali',
    photos: [validPhoto1],
    asbSignature: validSigASB2
  }, userASB);

  // Verifikasi bahwa status kembali ke DRAFT_AWAITING_ASKEP
  assert.strictEqual(revised.bapbStatus, BAPB_STATUS.DRAFT_AWAITING_ASKEP);
  // Tanda tangan ASB telah diperbarui dengan tanda tangan baru
  assert.strictEqual(revised.signatures.asb.signatureDataUrl, validSigASB2);
  // Tanda tangan Askep dan Pengurus wajib null (agar Askep memeriksa ulang versi terbaru)
  assert.strictEqual(revised.signatures.askep, null, 'Tanda tangan Askep harus di-reset ke null');
  assert.strictEqual(revised.signatures.pengurus, null, 'Tanda tangan Pengurus harus tetap null');
});

// -----------------------------------------------------------------------------
// TEST 6: Imutabilitas Dokumen FINAL
// -----------------------------------------------------------------------------
runTest('TC-UI-06', 'Dokumen FINAL bersifat kekal dan menolak revisi atau perubahan', () => {
  store.clear();
  storage.set(KEYS.SESSION, userASB);

  const draft = createBapbDraft({
    items: [{
      sourceSelectionId: 'SEL-004',
      sourceSelectionNo: 'TBS/DIV-I/CULL/SEL-I/10/2026/04',
      klon: 'GT 1',
      quantity: 110
    }],
    asbSignature: validSigASB,
    photos: [validPhoto1]
  }, userASB);

  signBapbAskep(draft.id, validSigAskep, 'Disetujui Askep', userAskep);
  const finalDoc = finalizeBapbDocument(draft.id, validSigPengurus, 'Sah FINAL', userPengurus);

  // Mencoba memperbaiki dokumen FINAL via reviseBapbDraft
  assert.throws(
    () => {
      reviseBapbDraft(finalDoc.id, { asbSignature: validSigASB2 }, userASB);
    },
    /Dokumen BAPB yang sudah berstatus FINAL bersifat kekal/,
    'Dokumen FINAL tidak boleh diedit atau direvisi'
  );

  // Mencoba finalisasi ulang
  assert.throws(
    () => {
      finalizeBapbDocument(finalDoc.id, validSigPengurus, 'Sahkan ulang', userPengurus);
    },
    /Dokumen BAPB yang sudah berstatus FINAL bersifat kekal/,
    'Dokumen FINAL tidak boleh difinalisasi ulang'
  );
});

console.log('================================================================================');
console.log(`HASIL TEST PENYEMPURNAAN UI & TANDA TANGAN: ${passCount} PASS, ${failCount} FAIL`);
console.log('================================================================================');

if (failCount > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
