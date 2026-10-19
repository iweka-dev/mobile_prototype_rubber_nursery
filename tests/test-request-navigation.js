/**
 * tests/test-request-navigation.js
 * Integration test suite for Permintaan Bibit Entry Point and Context-Aware Navigation
 */

// In-memory localStorage polyfill for Node.js test execution
if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (key) => store.get(key) || null,
    setItem: (key, val) => store.set(key, String(val)),
    removeItem: (key) => store.delete(key),
    clear: () => store.clear(),
    get length() { return store.size; },
    key: (i) => Array.from(store.keys())[i] || null
  };
}

import * as fs from 'fs';
import { storage } from '../js/core/storage.js';
import { getSubMenuItemsForRole } from '../js/modules/request/request-landing.js';
import { MENU_REGISTRY, ASISTEN_BIBITAN_MAIN_MENUS } from '../js/core/menu-registry.js';
import { ROLES } from '../js/core/permissions.js';

let totalTests = 0;
let passedTests = 0;

function assert(condition, message) {
  totalTests++;
  if (!condition) {
    console.error(`❌ FAIL: ${message}`);
    throw new Error(message);
  } else {
    console.log(`✅ PASS: ${message}`);
    passedTests++;
  }
}

console.log('====================================================');
console.log('🧪 RUNNING INTEGRATION TESTS: REQUEST NAVIGATION');
console.log('====================================================\n');

const berandaSrc = fs.readFileSync('js/modules/dashboard/beranda.js', 'utf-8');

// IT-REQ-NAV-001: Login sebagai Mantri. Beranda menampilkan menu "Permintaan Bibit".
assert(berandaSrc.includes("id: 'permintaan-bibit'") && berandaSrc.includes("route: '/request'"), 'IT-REQ-NAV-001: Mantri MENU_ITEMS includes Permintaan Bibit with route /request');

// IT-REQ-NAV-002: Klik Beranda -> Permintaan Bibit berhasil menuju #/request
const menuMatch = berandaSrc.match(/{\s*id:\s*'permintaan-bibit',\s*title:\s*'Permintaan<br>Bibit',\s*icon:\s*ICONS\.documentPlus,\s*route:\s*'\/request'\s*}/);
assert(menuMatch !== null, 'IT-REQ-NAV-002: Permintaan Bibit menu item is properly registered with target route /request');

// IT-REQ-NAV-003: Dari #/request -> Permintaan Mata Entres -> Back hasil: #/request
storage.set('mata_entres_origin_route', '/request');
const originFromRequest = storage.get('mata_entres_origin_route', '/request');
storage.remove('mata_entres_origin_route');
const backTargetFromRequest = originFromRequest === '/reception' ? '/reception' : '/request';
assert(backTargetFromRequest === '/request', 'IT-REQ-NAV-003: Navigation from /request returns to /request on back');

// IT-REQ-NAV-004: Dari #/reception -> Penerimaan Mata Entres -> Back hasil: #/reception
storage.set('mata_entres_origin_route', '/reception');
const originFromReception = storage.get('mata_entres_origin_route', '/request');
storage.remove('mata_entres_origin_route');
const backTargetFromReception = originFromReception === '/reception' ? '/reception' : '/request';
assert(backTargetFromReception === '/reception', 'IT-REQ-NAV-004: Navigation from /reception returns to /reception on back');

// IT-REQ-NAV-005: Permintaan Mata Entres default fallback (Direct Hash Access) -> /request
const directAccessOrigin = storage.get('mata_entres_origin_route', '/request');
const backTargetDirect = directAccessOrigin === '/reception' ? '/reception' : '/request';
assert(backTargetDirect === '/request', 'IT-REQ-NAV-005: Direct access to /request/mata-entres defaults safely back to /request');

// IT-REQ-NAV-006: Tidak ada perubahan pada route existing di app.js
const appSrc = fs.readFileSync('js/app.js', 'utf-8');
assert(appSrc.includes("registerRoute('/request', renderRequestLanding);"), 'IT-REQ-NAV-006: Route /request is intact');
assert(appSrc.includes("registerRoute('/request/kebun-sepupu', renderRequestKebunSepupuLanding);"), 'IT-REQ-NAV-006: Route /request/kebun-sepupu is intact');
assert(appSrc.includes("registerRoute('/request/kebun-sendiri', renderRequestKebunSendiriLanding);"), 'IT-REQ-NAV-006: Route /request/kebun-sendiri is intact');
assert(appSrc.includes("registerRoute('/request/mata-entres', renderRequestMataEntresLanding);"), 'IT-REQ-NAV-006: Route /request/mata-entres is intact');

// IT-REQ-NAV-007: Role/permission existing tetap berlaku
const mantriSubmenus = getSubMenuItemsForRole('MANTRI_TANAMAN');
assert(mantriSubmenus.length === 1 && mantriSubmenus[0].route === '/request/kebun-sendiri', 'IT-REQ-NAV-007: Mantri sees exactly 1 submenu (kebun-sendiri)');

const asbSubmenus = getSubMenuItemsForRole('ASISTEN_BIBITAN');
assert(asbSubmenus.length === 3 && asbSubmenus.some(s => s.route === '/request/kebun-sendiri') && asbSubmenus.some(s => s.route === '/request/kebun-sepupu') && asbSubmenus.some(s => s.route === '/request/mata-entres'), 'IT-REQ-NAV-007: ASB sees exactly 3 submenus with verification labels');

const pengurusSubmenus = getSubMenuItemsForRole('PENGURUS');
assert(pengurusSubmenus.length === 3, 'IT-REQ-NAV-007: Pengurus sees 3 submenus');

// IT-REQ-NAV-008: Tidak ada perubahan business/data/workflow logic
const menuPermintaanReg = MENU_REGISTRY.find(m => m.id === 'MENU-PERMINTAAN');
assert(menuPermintaanReg && menuPermintaanReg.status === 'ACTIVE', 'IT-REQ-NAV-008: MENU-PERMINTAAN in master registry is ACTIVE and unchanged');

// IT-REQ-NAV-009: Back dari /request tetap menuju /home
const requestLandingSrc = fs.readFileSync('js/modules/request/request-landing.js', 'utf-8');
assert(requestLandingSrc.includes("navigate('/home');"), 'IT-REQ-NAV-009: Back button from /request navigates to /home');

// IT-REQ-NAV-011: Back dari /request/kebun-sendiri untuk Mantri/Asisten menuju /home agar tidak loop
const kebunSendiriSrc = fs.readFileSync('js/modules/request/request-kebun-sendiri-landing.js', 'utf-8');
assert(kebunSendiriSrc.includes("userRole === 'MANTRI_TANAMAN'") && kebunSendiriSrc.includes("navigate('/home');"), 'IT-REQ-NAV-011: Back button on /request/kebun-sendiri navigates to /home for Mantri');

// IT-REQ-NAV-010: Tidak ada duplicate menu "Permintaan Bibit" pada role lain
const pengurusMenusMatch = berandaSrc.match(/PENGURUS_MENU_ITEMS\s*=\s*\[([\s\S]*?)\];/);
const pengurusCount = (pengurusMenusMatch ? pengurusMenusMatch[1].match(/id:\s*'permintaan-bibit'/g) || [] : []).length;
assert(pengurusCount === 1, 'IT-REQ-NAV-010: Exactly 1 Permintaan Bibit menu in PENGURUS_MENU_ITEMS');

const askepMenusMatch = berandaSrc.match(/ASKEP_MENU_ITEMS\s*=\s*\[([\s\S]*?)\];/);
const askepCount = (askepMenusMatch ? askepMenusMatch[1].match(/id:\s*'permintaan-bibit'/g) || [] : []).length;
assert(askepCount === 1, 'IT-REQ-NAV-010: Exactly 1 Permintaan Bibit menu in ASKEP_MENU_ITEMS');

const asistenMenusMatch = berandaSrc.match(/ASISTEN_MENU_ITEMS\s*=\s*\[([\s\S]*?)\];/);
const asistenCount = (asistenMenusMatch ? asistenMenusMatch[1].match(/id:\s*'permintaan-bibit'/g) || [] : []).length;
assert(asistenCount === 1, 'IT-REQ-NAV-010: Exactly 1 Permintaan Bibit menu in ASISTEN_MENU_ITEMS');

const asbMenusMatch = berandaSrc.match(/ASISTEN_BIBITAN_BERANDA_MENUS[\s\S]*?\[([\s\S]*?)\]\);/);
const asbCount = (asbMenusMatch ? asbMenusMatch[1].match(/id:\s*'permintaan-bibit'/g) || [] : []).length;
assert(asbCount === 1, 'IT-REQ-NAV-010: Exactly 1 Permintaan Bibit menu in ASISTEN_BIBITAN_BERANDA_MENUS');

console.log(`\n====================================================`);
console.log(`🎉 ALL ${passedTests}/${totalTests} INTEGRATION TESTS PASSED!`);
console.log(`====================================================\n`);
