import assert from 'node:assert/strict';
import { resolvePhysicalStockBackRoute } from '../js/modules/physical-stock-inspection/physical-stock-inspection-landing.js';

assert.equal(resolvePhysicalStockBackRoute({ role: 'ASKEP' }), '/home');
assert.equal(resolvePhysicalStockBackRoute({ role: 'ASISTEN_KEPALA' }), '/home');
assert.equal(resolvePhysicalStockBackRoute({ role: 'PENGURUS' }), '/home');
assert.equal(resolvePhysicalStockBackRoute({ role: 'ASISTEN_BIBITAN' }), '/inspection');
assert.equal(resolvePhysicalStockBackRoute({ role: 'MANTRI_TANAMAN' }), '/inspection');

console.log('PASS: navigasi back Pemeriksaan Stok Fisik mengikuti role aktif.');
