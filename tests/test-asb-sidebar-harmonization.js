/**
 * tests/test-asb-sidebar-harmonization.js
 * Automated Regression Test Suite: Verifikasi Pembersihan Sidebar Asisten Bibitan
 * Memastikan 7 menu anomali tidak tampil di drawer ASB, menu resmi di Beranda & Bottom Nav
 * tetap berfungsi, dan struktur sidebar role lain tidak mengalami regresi.
 */

import puppeteer from 'puppeteer';

let totalAssertions = 0;
let passedAssertions = 0;
let failedAssertions = 0;

function assert(condition, message) {
  totalAssertions++;
  if (condition) {
    console.log(`  [PASS] ${message}`);
    passedAssertions++;
  } else {
    console.error(`  [FAIL] ${message}`);
    failedAssertions++;
  }
}

async function run() {
  console.log('========================================================================');
  console.log('STARTING REGRESSION TEST: ASISTEN BIBITAN SIDEBAR HARMONIZATION');
  console.log('========================================================================\n');

  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844 });

  // ---------------------------------------------------------------------------
  // 1. PENGUJIAN ROLE ASISTEN BIBITAN (Annisa - ASB001)
  // ---------------------------------------------------------------------------
  console.log('>>> [1/4] Menguji Sesi ASISTEN_BIBITAN (ASB001)...');
  await page.goto('http://localhost:3000/#/login', { waitUntil: 'networkidle0' });

  await page.evaluate(async () => {
    const { session } = await import('./js/core/session.js');
    session.start({ code: 'ASB001' });
  });

  await page.goto('http://localhost:3000/#/home', { waitUntil: 'networkidle0' });

  // A. Verifikasi Menu Cards di Beranda ASB
  const berandaMenuCards = await page.evaluate(() => {
    const cards = document.querySelectorAll('.beranda-menu-card');
    return Array.from(cards).map(c => ({
      id: c.getAttribute('data-menu-id'),
      route: c.getAttribute('data-route'),
      title: c.querySelector('.beranda-card-title')?.innerText.trim()
    }));
  });

  assert(berandaMenuCards.length === 3, 'Beranda ASB memiliki tepat 3 kartu menu operasional');
  assert(berandaMenuCards.some(c => c.id === 'penerimaan' && c.route === '/reception/kebun-sepupu'), 'Kartu Penerimaan tersedia di Beranda ASB (/reception/kebun-sepupu)');
  assert(berandaMenuCards.some(c => c.id === 'permintaan-bibit' && c.route === '/request'), 'Kartu Permintaan tersedia di Beranda ASB (/request)');
  assert(berandaMenuCards.some(c => c.id === 'pengeluaran-bibit' && c.route === '/dispatch'), 'Kartu Pengeluaran tersedia di Beranda ASB (/dispatch)');

  // B. Verifikasi Bottom Navigation ASB
  const bottomNavItems = await page.evaluate(() => {
    const btns = document.querySelectorAll('.asb-bottom-nav-btn');
    return Array.from(btns).map(b => ({
      id: b.getAttribute('data-nav-id'),
      route: b.getAttribute('data-nav-route'),
      label: b.querySelector('span')?.innerText.trim()
    }));
  });

  assert(bottomNavItems.length === 4, 'Bottom Navigation ASB memiliki tepat 4 tombol navigasi permanen');
  assert(bottomNavItems.some(b => b.id === 'beranda' && b.route === '/home'), 'Tab Beranda tersedia di Bottom Nav');
  assert(bottomNavItems.some(b => b.id === 'pemeriksaan' && b.route === '/inspection'), 'Tab Pemeriksaan tersedia di Bottom Nav (/inspection)');
  assert(bottomNavItems.some(b => b.id === 'verifikasi' && b.route === '/verification'), 'Tab Verifikasi tersedia di Bottom Nav (/verification)');
  assert(bottomNavItems.some(b => b.id === 'laporan' && b.route === '/reports'), 'Tab Laporan tersedia di Bottom Nav (/reports)');

  // C. Buka Drawer ASB & Verifikasi Seluruh Item
  await page.waitForSelector('#beranda-drawer-btn', { timeout: 5000 });
  await page.click('#beranda-drawer-btn');
  await page.waitForSelector('.drawer-panel', { timeout: 5000 });

  const drawerRows = await page.evaluate(() => {
    const items = document.querySelectorAll('.drawer-panel .drawer-nav-list > *');
    return Array.from(items).map(el => {
      if (el.classList.contains('drawer-group-header')) {
        return { type: 'HEADER', text: el.textContent.trim() };
      }
      return {
        type: 'ROW',
        id: el.id || null,
        label: el.querySelector('.drawer-row-label')?.textContent.trim() || el.textContent.trim(),
        route: el.getAttribute('data-nav-route') || null
      };
    });
  });

  console.log(`  -> Item drawer terdeteksi pada ASB: ${drawerRows.length} elemen`);

  // D. Pastikan 7 menu anomali TIDAK ADA pada drawer
  const ANOMALOUS_MENU_LABELS = [
    'Penerimaan',
    'Permintaan',
    'Pengeluaran',
    'Pemeriksaan Hasil Seleksi',
    'Pemusnahan Bibit',
    'Konsolidasi Data',
    'Verifikasi Data'
  ];

  ANOMALOUS_MENU_LABELS.forEach(label => {
    const found = drawerRows.some(r => r.label === label);
    assert(!found, `Menu [${label}] TIDAK ditemukan di drawer ASB`);
  });

  // E. Pastikan menu resmi tetap ada
  assert(drawerRows.some(r => r.id === 'menu-beranda' && r.route === '/home'), 'Tombol Beranda ada di drawer ASB');
  assert(drawerRows.some(r => r.type === 'HEADER' && r.text === 'DATA MASTER'), 'Group Header DATA MASTER ada di drawer ASB');
  assert(drawerRows.some(r => r.label === 'Master Bedengan' && r.route === '/master/bedengan'), 'Menu Master Bedengan ada di drawer ASB (/master/bedengan)');
  assert(drawerRows.some(r => r.label === 'Master Batch' && r.route === '/master/batch'), 'Menu Master Batch ada di drawer ASB (/master/batch)');
  assert(drawerRows.some(r => r.id === 'menu-sync' && r.route === '/sync'), 'Menu Sinkronisasi ada di drawer ASB');
  assert(drawerRows.some(r => r.id === 'menu-profil' && r.route === '/profile'), 'Menu Profil Saya ada di drawer ASB');
  assert(drawerRows.some(r => r.id === 'menu-logout'), 'Tombol Keluar Aplikasi ada di drawer ASB');

  // Tutup drawer
  await page.evaluate(() => {
    const overlay = document.querySelector('.drawer-overlay');
    if (overlay) overlay.click();
  });
  await new Promise(r => setTimeout(r, 400));

  // ---------------------------------------------------------------------------
  // 2. REGRESI ROLE MANTRI TANAMAN (Wagiman - MNT001)
  // ---------------------------------------------------------------------------
  console.log('\n>>> [2/4] Menguji Regresi Sesi MANTRI_TANAMAN (MNT001)...');
  await page.evaluate(async () => {
    const { session } = await import('./js/core/session.js');
    session.start({ code: 'MNT001' });
  });
  await page.goto('http://localhost:3000/#/home', { waitUntil: 'networkidle0' });

  await page.click('#beranda-drawer-btn');
  await page.waitForSelector('.drawer-panel', { timeout: 5000 });

  const mantriDrawerRows = await page.evaluate(() => {
    const items = document.querySelectorAll('.drawer-panel .drawer-nav-list > *');
    return Array.from(items).map(el => ({
      id: el.id || null,
      label: el.querySelector('.drawer-row-label')?.textContent.trim() || el.textContent.trim(),
      route: el.getAttribute('data-nav-route') || null
    }));
  });

  assert(mantriDrawerRows.some(r => r.id === 'menu-beranda'), 'Mantri: Beranda ada');
  assert(mantriDrawerRows.some(r => r.id === 'menu-riwayat'), 'Mantri: Riwayat Data ada');
  assert(mantriDrawerRows.some(r => r.id === 'menu-simulasi-waktu'), 'Mantri: Simulasi Waktu ada');
  assert(mantriDrawerRows.some(r => r.id === 'menu-sync'), 'Mantri: Sinkronisasi ada');
  assert(mantriDrawerRows.some(r => r.id === 'menu-profil'), 'Mantri: Profil Saya ada');
  assert(!mantriDrawerRows.some(r => r.label === 'Penerimaan'), 'Mantri: Drawer tidak memuat Penerimaan');

  await page.evaluate(() => {
    const overlay = document.querySelector('.drawer-overlay');
    if (overlay) overlay.click();
  });
  await new Promise(r => setTimeout(r, 400));

  // ---------------------------------------------------------------------------
  // 3. REGRESI ROLE ASKEP & PENGURUS (Pemusnahan Bibit tetap ada di drawer mereka)
  // ---------------------------------------------------------------------------
  console.log('\n>>> [3/4] Menguji Regresi Sesi ASKEP (ASK001) & PENGURUS (PGS001)...');
  await page.evaluate(async () => {
    const { session } = await import('./js/core/session.js');
    session.start({ code: 'ASK001' });
  });
  await page.goto('http://localhost:3000/#/home', { waitUntil: 'networkidle0' });
  await page.click('#beranda-drawer-btn');
  await page.waitForSelector('.drawer-panel', { timeout: 5000 });

  const askepDrawerRows = await page.evaluate(() => {
    const items = document.querySelectorAll('.drawer-panel .drawer-nav-list > *');
    return Array.from(items).map(el => ({
      id: el.id || null,
      label: el.querySelector('.drawer-row-label')?.textContent.trim() || el.textContent.trim(),
      route: el.getAttribute('data-nav-route') || null
    }));
  });

  assert(askepDrawerRows.some(r => r.id === 'menu-pemusnahan-drawer' && r.route === '/destruction'), 'Askep: Menu Pemusnahan Bibit tetap ada di drawer (/destruction)');
  assert(askepDrawerRows.some(r => r.id === 'menu-riwayat'), 'Askep: Riwayat Data ada');

  await page.evaluate(() => {
    const overlay = document.querySelector('.drawer-overlay');
    if (overlay) overlay.click();
  });
  await new Promise(r => setTimeout(r, 400));

  // Pengurus
  await page.evaluate(async () => {
    const { session } = await import('./js/core/session.js');
    session.start({ code: 'PGS001' });
  });
  await page.goto('http://localhost:3000/#/home', { waitUntil: 'networkidle0' });
  await page.click('#beranda-drawer-btn');
  await page.waitForSelector('.drawer-panel', { timeout: 5000 });

  const pengurusDrawerRows = await page.evaluate(() => {
    const items = document.querySelectorAll('.drawer-panel .drawer-nav-list > *');
    return Array.from(items).map(el => ({
      id: el.id || null,
      label: el.querySelector('.drawer-row-label')?.textContent.trim() || el.textContent.trim(),
      route: el.getAttribute('data-nav-route') || null
    }));
  });

  assert(pengurusDrawerRows.some(r => r.id === 'menu-pemusnahan-drawer' && r.route === '/destruction'), 'Pengurus: Menu Pemusnahan Bibit tetap ada di drawer (/destruction)');

  await page.evaluate(() => {
    const overlay = document.querySelector('.drawer-overlay');
    if (overlay) overlay.click();
  });
  await new Promise(r => setTimeout(r, 400));

  // ---------------------------------------------------------------------------
  // 4. REGRESI ROLE ASISTEN LAPANGAN (Rahmad - AST002)
  // ---------------------------------------------------------------------------
  console.log('\n>>> [4/4] Menguji Regresi Sesi ASISTEN (AST002)...');
  await page.evaluate(async () => {
    const { session } = await import('./js/core/session.js');
    session.start({ code: 'AST002' });
  });
  await page.goto('http://localhost:3000/#/home', { waitUntil: 'networkidle0' });
  await page.click('#beranda-drawer-btn');
  await page.waitForSelector('.drawer-panel', { timeout: 5000 });

  const asistenDrawerRows = await page.evaluate(() => {
    const items = document.querySelectorAll('.drawer-panel .drawer-nav-list > *');
    return Array.from(items).map(el => ({
      id: el.id || null,
      label: el.querySelector('.drawer-row-label')?.textContent.trim() || el.textContent.trim()
    }));
  });

  assert(asistenDrawerRows.some(r => r.id === 'menu-beranda'), 'Asisten: Beranda ada');
  assert(asistenDrawerRows.some(r => r.id === 'menu-riwayat'), 'Asisten: Riwayat Data ada');
  assert(!asistenDrawerRows.some(r => r.label === 'Penerimaan'), 'Asisten: Drawer tidak memuat Penerimaan');

  await browser.close();

  console.log('\n========================================================================');
  console.log(`TEST SUMMARY: TOTAL = ${totalAssertions} | PASSED = ${passedAssertions} | FAILED = ${failedAssertions}`);
  console.log('========================================================================\n');

  if (failedAssertions > 0) {
    process.exit(1);
  }
}

run().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
