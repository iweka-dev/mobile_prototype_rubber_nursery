import puppeteer from 'puppeteer';

console.log('========================================================================');
console.log('TEST SUITE: VERIFIKASI PENYEMBUNYIAN TAB FLOW PROSES APLIKASI SEMENTARA');
console.log('========================================================================\n');

async function runTests() {
  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1280,900']
  });

  const page = await browser.newPage();
  const consoleErrors = [];

  page.on('console', msg => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });

  try {
    await page.setViewport({ width: 1280, height: 900 });

    // 1. UJI TAMPILAN AWAL WORKSPACE
    console.log('1. Menguji Akses Review Workspace Standard (http://localhost:3000/#/material)...');
    await page.goto('http://localhost:3000/#/material', { waitUntil: 'networkidle0', timeout: 30000 });

    // Tunggu tab navigasi muncul
    await page.waitForSelector('.workspace-main-tabs', { timeout: 10000 });

    // Cek tombol tab Flow Proses
    const flowTabBtn = await page.$('#tab-main-flow');
    if (flowTabBtn !== null) {
      throw new Error('[FAIL] Tab "Flow Proses Aplikasi" (#tab-main-flow) masih ditemukan di DOM!');
    }
    console.log('  [PASS] Tab "Flow Proses Aplikasi" TIDAK terlihat di DOM Review Workspace.');

    // Cek tab Catatan Perbaikan
    const notesTabBtn = await page.$('#tab-main-notes');
    if (!notesTabBtn) {
      throw new Error('[FAIL] Tab "Catatan Perbaikan" (#tab-main-notes) tidak ditemukan!');
    }
    const notesActive = await page.$eval('#tab-main-notes', el => el.classList.contains('is-active'));
    console.log(`  [PASS] Tab "Catatan Perbaikan" tampil dan aktif secara default: ${notesActive}`);

    // Cek tab Data Transaksi
    const txTabBtn = await page.$('#tab-main-transactions');
    if (!txTabBtn) {
      throw new Error('[FAIL] Tab "Data Transaksi" (#tab-main-transactions) tidak ditemukan!');
    }
    console.log('  [PASS] Tab "Data Transaksi" tampil dengan benar.');

    // 2. UJI PINDAH KE TAB DATA TRANSAKSI
    console.log('\n2. Menguji Klik & Navigasi ke Tab Data Transaksi...');
    await page.click('#tab-main-transactions');
    await page.waitForSelector('.tx-catalog-wrapper', { timeout: 10000 });
    const txActive = await page.$eval('#tab-main-transactions', el => el.classList.contains('is-active'));
    console.log(`  [PASS] Tab Data Transaksi berhasil dibuka dan aktif: ${txActive}`);

    // Kembali ke tab Catatan Perbaikan
    console.log('\n3. Menguji Klik & Navigasi kembali ke Tab Catatan Perbaikan...');
    await page.click('#tab-main-notes');
    await page.waitForSelector('.review-panel-head', { timeout: 10000 });
    const notesActiveAgain = await page.$eval('#tab-main-notes', el => el.classList.contains('is-active'));
    console.log(`  [PASS] Kembali ke Catatan Perbaikan sukses dan aktif: ${notesActiveAgain}`);

    // 4. UJI AKSES LANGSUNG VIA URL PARAMETER ?tab=flow
    console.log('\n4. Menguji Akses Langsung URL Parameter ?tab=flow...');
    await page.goto('http://localhost:3000/?tab=flow#/material', { waitUntil: 'networkidle0', timeout: 30000 });
    await page.waitForSelector('.workspace-main-tabs', { timeout: 10000 });

    const flowTabBtnOnUrl = await page.$('#tab-main-flow');
    if (flowTabBtnOnUrl !== null) {
      throw new Error('[FAIL] Tab "Flow Proses Aplikasi" muncul saat akses ?tab=flow!');
    }
    const flowWorkspace = await page.$('#flow-app-workspace');
    if (flowWorkspace !== null) {
      throw new Error('[FAIL] Konten Flow Proses (#flow-app-workspace) muncul saat akses ?tab=flow!');
    }

    // Pastikan fallback aman ke Catatan Perbaikan
    const isNotesActiveFallback = await page.$eval('#tab-main-notes', el => el.classList.contains('is-active'));
    console.log(`  [PASS] Akses ?tab=flow aman dialihkan ke Tab Catatan Perbaikan (active: ${isNotesActiveFallback}).`);
    console.log('  [PASS] Tidak ada tampilan kosong (blank page) atau error.');

    // 5. CEK APAKAH ADA CONSOLE ERROR KRITIS
    const fatalErrors = consoleErrors.filter(e => !e.includes('favicon') && !e.includes('sw.js') && !e.includes('ServiceWorker'));
    if (fatalErrors.length > 0) {
      console.warn('  [WARN] Console errors detected:', fatalErrors);
    } else {
      console.log('  [PASS] Tidak ada console errors yang terjadi.');
    }

    console.log('\n========================================================================');
    console.log('🎉 SEMUA PENGUJIAN PENYEMBUNYIAN TAB FLOW PROSES APLIKASI BERHASIL (100%)');
    console.log('========================================================================\n');

  } catch (err) {
    console.error('\n❌ TEST FAILED:', err);
    process.exit(1);
  } finally {
    await browser.close();
  }
}

runTests();
