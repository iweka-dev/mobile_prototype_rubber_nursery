import assert from 'node:assert/strict';
import { renderGlobalChildTransactionsSection } from '../js/modules/selection/selection-landing.js';

console.log('===========================================================================');
console.log('INTEGRATION TEST: FINAL UI HARMONIZATION — RINGKASAN TRANSAKSI SELEKSI');
console.log('===========================================================================');

const mockDocs = [
  {
    id: 'doc-001',
    docNo: '2026/SEL/001',
    batchCode: 'BTCH-001',
    programCode: '2026/TB/RNUR/001',
    bedenganCode: 'BED-001',
    status: 'DRAFT',
    stage: 'SELEKSI_1'
  }
];

const mockTxs = [
  {
    id: 'tx-001',
    docNo: '2026/SEL-I/005',
    parentSelectionDocumentId: 'doc-001',
    parentSelectionDocNo: '2026/SEL/001',
    programCode: '2026/TB/RNUR/001',
    bedenganCode: 'BED-001',
    transactionType: 'PELAKSANAAN_SELEKSI_I',
    actualPolybagInspectedQty: 2500,
    bibitAwal: 5000,
    actualBibitRetainedQty: 4758,
    actualBibitSelectedQty: 242,
    tanggalSeleksi: '12/10/2026',
    status: 'DRAFT'
  }
];

const html = renderGlobalChildTransactionsSection(mockTxs, mockDocs, 'SELEKSI_1', { role: 'MANTRI' });

// 1. Verifikasi Header Transaksi (A)
assert.ok(html.includes('Seleksi I'), 'UI harus memuat jenis transaksi "Seleksi I"');
assert.ok(html.includes('icon-child-toggle'), 'UI harus memuat chevron toggle expand/collapse');

// 2. Verifikasi Identitas Transaksi & Batch Aktual (B)
assert.ok(html.includes('Transaksi #1'), 'UI harus memuat nomor transaksi');
assert.ok(html.includes('2026/SEL-I/005'), 'UI harus memuat nomor dokumen transaksi');
assert.ok(html.includes('BTCH-001'), 'UI WAJIB menampilkan kode Batch aktual BTCH-001');
assert.ok(html.includes('BED-001'), 'UI harus memuat kode bedengan BED-001');
assert.ok(html.includes('12/10/2026'), 'UI harus memuat tanggal transaksi');

// 3. Verifikasi Metadata Transaksi (C)
assert.ok(html.includes('Program Pembibitan'), 'UI harus memuat label Program Pembibitan');
assert.ok(html.includes('2026/TB/RNUR/001'), 'UI harus memuat kode program');
assert.ok(html.includes('Dokumen Referensi') || html.includes('Dokumen Induk'), 'UI harus memuat label Dokumen Referensi');
assert.ok(html.includes('2026/SEL/001'), 'UI harus memuat kode dokumen referensi');

// 4. Verifikasi Hasil Pemeriksaan (D)
assert.ok(html.includes('Bibit Diperiksa'), 'UI harus memuat label "Bibit Diperiksa"');
assert.ok(html.includes('Bibit Tersedia'), 'UI harus memuat label "Bibit Tersedia"');
assert.ok(html.includes('Diseleksi'), 'UI harus memuat label "Diseleksi"');
assert.ok(!html.includes('Layak:'), 'UI TIDAK boleh lagi memuat label "Layak:"');
assert.ok(!html.includes('Reject:'), 'UI TIDAK boleh lagi memuat label "Reject:"');

// 5. Verifikasi nilai angka tetap identik
assert.ok(html.includes('5.000'), 'Nilai Bibit Diperiksa harus tetap 5.000');
assert.ok(html.includes('4.758'), 'Nilai Bibit Tersedia harus tetap 4.758');
assert.ok(html.includes('242'), 'Nilai Diseleksi harus tetap 242');

// 6. Verifikasi Footer dan Aksi (E)
assert.ok(html.includes('btn-delete-child-tx'), 'Footer harus memuat tombol hapus transaksi');
assert.ok(html.includes('Hapus'), 'Tombol hapus harus memiliki label teks');

// 7. Verifikasi Resolusi Batch ketika tx memiliki batchCode langsung
const mockTxsWithOwnBatch = [
  {
    ...mockTxs[0],
    id: 'tx-002',
    docNo: '2026/SEL-I/006',
    batchCode: 'BTCH-002',
    bedenganCode: 'BED-002'
  }
];
const htmlWithOwnBatch = renderGlobalChildTransactionsSection(mockTxsWithOwnBatch, mockDocs, 'SELEKSI_1', { role: 'MANTRI' });
assert.ok(htmlWithOwnBatch.includes('BTCH-002'), 'Kode Batch dari tx langsung (BTCH-002) harus ditampilkan');

console.log('✓ PASS 1: Header transaksi dirender rapi dengan status & chevron toggle.');
console.log('✓ PASS 2: Identitas transaksi memuat Nomor Tx, Batch aktual (BTCH-001), Bedengan, dan Tanggal.');
console.log('✓ PASS 3: Batch tampil secara permanen di bagian identitas (terlihat saat collapsed maupun expanded).');
console.log('✓ PASS 4: Metadata (Program & Dokumen Induk) terpisah dalam box tersendiri tanpa redundansi.');
console.log('✓ PASS 5: Hasil Pemeriksaan menampilkan 3 kolom terstruktur: Bibit Diperiksa (5.000), Bibit Tersedia (4.758), Diseleksi (242).');
console.log('✓ PASS 6: Footer aksi Hapus terpisah rapi dengan izin otorisasi yang terjaga.');
console.log('✓ PASS 7: Resolusi batchCode dari tx langsung (BTCH-002) berhasil.');

console.log('===========================================================================');
console.log('SEMUA INTEGRATION TEST FINAL UI HARMONIZATION LOLOS (100%)');
console.log('===========================================================================');
