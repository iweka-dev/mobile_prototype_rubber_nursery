import puppeteer from 'puppeteer';
import path from 'path';
import assert from 'assert';

const ARTIFACTS_DIR = 'C:/Users/T1N0C/.gemini/antigravity-ide/brain/cd87cee5-4a6c-4972-bf89-56cf399fe1e0';

async function runTest() {
  console.log('========================================================================');
  console.log('RUNNING E2E BROWSER TEST: ROLE SWITCHER & BAPB NAVIGATION FOR ASKEP & PENGURUS');
  console.log('========================================================================\n');

  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1280,900']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });

  page.on('console', msg => console.log('BROWSER CONSOLE:', msg.text()));
  page.on('pageerror', err => console.log('BROWSER ERROR:', err.toString()));

  // ---------------------------------------------------------------------------
  // STEP 1: INITIALIZE AS ASB (Annisa - TBS)
  // ---------------------------------------------------------------------------
  console.log('>>> [1/5] Inisialisasi Persona ASB (Annisa - TBS)...');
  await page.goto('http://localhost:3000/?nocache=' + Date.now() + '#/home', { waitUntil: 'networkidle0' });
  await page.evaluate(async () => {
    const { session } = await import('./js/core/session.js');
    const { storage } = await import('./js/core/storage.js');
    const { DESTRUCTION_STORAGE_KEY } = await import('./js/modules/destruction/destruction-manager.js');

    // Clean test records from storage
    const records = storage.get(DESTRUCTION_STORAGE_KEY, []) || [];
    const clean = records.filter(r => !String(r.id || '').startsWith('BAPB-ROLE-TEST-'));
    storage.set(DESTRUCTION_STORAGE_KEY, clean);

    session.start({
      userId: 'TBS-ASB-001',
      code: 'ASB001',
      role: 'ASISTEN_BIBITAN',
      name: 'Annisa',
      position: 'Asisten Divisi Bibitan',
      estateId: 'EST-TBS',
      estateName: 'Tanah Besih',
      divisionId: 'DIV-001',
      divisionName: 'Divisi I',
      scopeType: 'DIVISION'
    });
  });

  await page.goto('http://localhost:3000/?nocache=' + Date.now() + '#/home', { waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 600));

  // ASB creates draft BAPB
  console.log('    ASB membuat draf BAPB baru...');
  await page.goto('http://localhost:3000/?nocache=' + Date.now() + '#/destruction', { waitUntil: 'networkidle0' });
  await page.waitForSelector('#btn-create-bapb');

  // Seed sample selection doc and create draft BAPB directly in storage
  const createdDraft = await page.evaluate(async () => {
    const { storage } = await import('./js/core/storage.js');
    const { BAPB_STATUS, DESTRUCTION_STORAGE_KEY } = await import('./js/modules/destruction/destruction-manager.js');

    const draft = {
      id: 'BAPB-ROLE-TEST-001',
      bapbId: 'BAPB-ROLE-TEST-001',
      docNo: 'DRAFT-BAPB/TB/DIV-I/10/2026/0888',
      draftDocNo: 'DRAFT-BAPB/TB/DIV-I/10/2026/0888',
      officialDocNo: null,
      isFinal: false,
      documentType: 'BAPB_KARET',
      transactionType: 'PEMUSNAHAN_BIBIT',
      estateId: 'EST-TBS',
      estateCode: 'TB',
      divisionId: 'DIV-001',
      divisionCode: 'DIV-I',
      items: [{
        sourceSelectionId: 'SEL-TEST-01',
        sourceSelectionNo: 'TBS/DIV-I/CULL/SEL-I/10/2026/09',
        klon: 'PB 260',
        bedengan: 'BED-08',
        quantity: 200,
        stage: 'Afkir Seleksi'
      }],
      totalQty: 200,
      quantity: 200,
      klon: 'PB 260',
      bedengan: 'BED-08',
      tanggalPelaksanaan: '2026-10-18',
      metodePemusnahan: 'Pencincangan dan Pemendaman',
      photos: ['data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='],
      signatures: {
        asb: {
          roleTitle: 'Asisten Divisi Bibitan — Pelaksana',
          name: 'Annisa',
          userId: 'TBS-ASB-001',
          signatureDataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mP8z8BQz0AEYBxVSF+FABJADveWkH6oAAAAAElFTkSuQmCC',
          signedAt: '2026-10-18T08:00:00+07:00'
        },
        askep: null,
        pengurus: null
      },
      bapbStatus: BAPB_STATUS.DRAFT_AWAITING_ASKEP,
      status: BAPB_STATUS.DRAFT_AWAITING_ASKEP,
      createdByName: 'Annisa',
      createdAt: new Date().toISOString()
    };

    const currentRecords = storage.get(DESTRUCTION_STORAGE_KEY, []) || [];
    storage.set(DESTRUCTION_STORAGE_KEY, [draft, ...currentRecords]);
    return draft;
  });

  console.log('    [OK] Draf BAPB berhasil dibuat:', createdDraft.draftDocNo);

  // ---------------------------------------------------------------------------
  // STEP 2: SWITCH PERSONA TO ASKEP (Beny Sihotang - TBS)
  // ---------------------------------------------------------------------------
  console.log('\n>>> [2/5] Beralih Persona ke ASKEP (Beny Sihotang - TBS)...');
  await page.evaluate(async () => {
    const { session } = await import('./js/core/session.js');
    const { getDemoPersonaByCode } = await import('./js/data/demo-personas.js');
    const p = getDemoPersonaByCode('ASK001');
    session.start({
      userId: p.code,
      code: p.code,
      role: p.role,
      name: p.name,
      position: p.position,
      estateId: p.estateId,
      estateName: p.estateName,
      divisionId: p.divisionId,
      divisionName: p.divisionName,
      scopeType: p.scopeType,
      isDemoSession: true
    });
  });

  // Now on Askep Home
  await page.goto('http://localhost:3000/?nocache=' + Date.now() + '#/home', { waitUntil: 'networkidle0' });
  await page.waitForSelector('.beranda-grid');

  // Verify Pemusnahan Bibit card is present on Askep Home
  const askepPemusnahanCard = await page.$('.beranda-menu-card[data-menu-id="pemusnahan-bibit"]');
  assert.ok(askepPemusnahanCard, 'Menu Pemusnahan Bibit WAJIB ditemukan pada Beranda Askep');

  // Verify red dot notification on Askep card
  const askepCardHasDot = await page.$('.beranda-menu-card[data-menu-id="pemusnahan-bibit"] .notif-dot');
  assert.ok(askepCardHasDot, 'Menu Pemusnahan Bibit pada Beranda Askep memiliki notif-dot merah saat ada antrean');
  console.log('    [PASS] Menu Pemusnahan Bibit ditemukan di Beranda Askep dengan notif dot merah');

  // Screenshot Askep Home with Pemusnahan Bibit Card & Notif Dot
  await page.screenshot({
    path: path.join(ARTIFACTS_DIR, 'bapb_role_askep_home_menu.png'),
    fullPage: false
  });
  console.log('    [OK] Screenshot bapb_role_askep_home_menu.png tersimpan');

  // Open Drawer as Askep to verify Drawer Navigation
  await page.click('#beranda-drawer-btn');
  await page.waitForSelector('.drawer-overlay');
  const askepDrawerItem = await page.$('#menu-pemusnahan-drawer');
  assert.ok(askepDrawerItem, 'Menu Pemusnahan Bibit WAJIB ditemukan pada Drawer Sidebar Askep');
  console.log('    [PASS] Menu Pemusnahan Bibit ditemukan di Drawer Sidebar Askep');

  // Screenshot Askep Drawer
  await page.screenshot({
    path: path.join(ARTIFACTS_DIR, 'bapb_role_askep_drawer_menu.png'),
    fullPage: false
  });
  console.log('    [OK] Screenshot bapb_role_askep_drawer_menu.png tersimpan');

  // Click Drawer Pemusnahan Menu to navigate
  await page.click('#menu-pemusnahan-drawer');
  await page.waitForSelector('.card-bapb-item[data-id="BAPB-ROLE-TEST-001"]');
  console.log('    [PASS] Navigasi ke Pemusnahan Bibit via Drawer Askep berhasil');

  // Verify Askep Action Button & Absence of ASB Create Button
  const askepActionBtn = await page.$('.btn-askep-action[data-id="BAPB-ROLE-TEST-001"]');
  assert.ok(askepActionBtn, 'Tombol "Pemeriksaan & Tanda Tangan Askep" WAJIB tersedia untuk Askep');
  const asbCreateBtnOnAskep = await page.$('#btn-create-bapb');
  assert.strictEqual(asbCreateBtnOnAskep, null, 'Tombol "Buat Berita Acara" TIDAK BOLEH tampil untuk Askep');

  // Screenshot Askep Document Queue
  await page.screenshot({
    path: path.join(ARTIFACTS_DIR, 'bapb_role_askep_queue.png'),
    fullPage: false
  });
  console.log('    [OK] Screenshot bapb_role_askep_queue.png tersimpan');

  // Execute Askep Approval & Sign
  console.log('    Askep menandatangani dan menyetujui dokumen...');
  await page.click('.btn-askep-action[data-id="BAPB-ROLE-TEST-001"]');
  await page.waitForSelector('#bapb-sig-canvas-askep');
  await new Promise(r => setTimeout(r, 600));

  // Scroll modal body down to show signature in viewport
  await page.evaluate(() => {
    const modalBody = document.querySelector('.modal-fullscreen .modal-body');
    if (modalBody) modalBody.scrollTop = modalBody.scrollHeight;
  });
  await new Promise(r => setTimeout(r, 400));

  // Draw on canvas
  const askepCanvas = await page.$('#bapb-sig-canvas-askep');
  const askepBox = await askepCanvas.boundingBox();
  await page.mouse.move(askepBox.x + 40, askepBox.y + 40);
  await page.mouse.down();
  for (let i = 0; i < 20; i++) {
    await page.mouse.move(askepBox.x + 50 + i * 5, askepBox.y + 40 + (i % 2) * 15);
  }
  await page.mouse.up();

  await page.click('#btn-confirm-sign-askep');
  await new Promise(r => setTimeout(r, 1200));
  console.log('    [PASS] Dokumen berhasil disetujui Askep dan berpindah ke status MENUNGGU PENGURUS');

  // ---------------------------------------------------------------------------
  // STEP 3: SWITCH PERSONA TO PENGURUS (Junaidi - TBS)
  // ---------------------------------------------------------------------------
  console.log('\n>>> [3/5] Beralih Persona ke PENGURUS (Junaidi - TBS)...');
  await page.evaluate(async () => {
    const { session } = await import('./js/core/session.js');
    const { getDemoPersonaByCode } = await import('./js/data/demo-personas.js');
    const p = getDemoPersonaByCode('PGS001');
    session.start({
      userId: p.code,
      code: p.code,
      role: p.role,
      name: p.name,
      position: p.position,
      estateId: p.estateId,
      estateName: p.estateName,
      divisionId: p.divisionId,
      divisionName: p.divisionName,
      scopeType: p.scopeType,
      isDemoSession: true
    });
  });

  // Now on Pengurus Home
  await page.goto('http://localhost:3000/?nocache=' + Date.now() + '#/home', { waitUntil: 'networkidle0' });
  await page.waitForSelector('.beranda-grid');

  // Verify Pemusnahan Bibit card is present on Pengurus Home
  const pengurusPemusnahanCard = await page.$('.beranda-menu-card[data-menu-id="pemusnahan-bibit"]');
  assert.ok(pengurusPemusnahanCard, 'Menu Pemusnahan Bibit WAJIB ditemukan pada Beranda Pengurus');

  // Verify red dot notification on Pengurus card
  const pengurusCardHasDot = await page.$('.beranda-menu-card[data-menu-id="pemusnahan-bibit"] .notif-dot');
  assert.ok(pengurusCardHasDot, 'Menu Pemusnahan Bibit pada Beranda Pengurus memiliki notif-dot merah');
  console.log('    [PASS] Menu Pemusnahan Bibit ditemukan di Beranda Pengurus dengan notif dot merah');

  // Screenshot Pengurus Home with Pemusnahan Bibit Card & Notif Dot
  await page.screenshot({
    path: path.join(ARTIFACTS_DIR, 'bapb_role_pengurus_home_menu.png'),
    fullPage: false
  });
  console.log('    [OK] Screenshot bapb_role_pengurus_home_menu.png tersimpan');

  // Open Drawer as Pengurus to verify Drawer Navigation
  await page.click('#beranda-drawer-btn');
  await page.waitForSelector('.drawer-overlay');
  const pengurusDrawerItem = await page.$('#menu-pemusnahan-drawer');
  assert.ok(pengurusDrawerItem, 'Menu Pemusnahan Bibit WAJIB ditemukan pada Drawer Sidebar Pengurus');
  console.log('    [PASS] Menu Pemusnahan Bibit ditemukan di Drawer Sidebar Pengurus');

  // Click Drawer Pemusnahan Menu to navigate
  await page.click('#menu-pemusnahan-drawer');
  await page.waitForSelector('.card-bapb-item[data-id="BAPB-ROLE-TEST-001"]');
  console.log('    [PASS] Navigasi ke Pemusnahan Bibit via Drawer Pengurus berhasil');

  // Verify Pengurus Action Button & Absence of ASB Create Button
  const pengurusActionBtn = await page.$('.btn-pengurus-action[data-id="BAPB-ROLE-TEST-001"]');
  assert.ok(pengurusActionBtn, 'Tombol "Pemeriksaan & Pengesahan Dokumen FINAL" WAJIB tersedia untuk Pengurus');
  const asbCreateBtnOnPengurus = await page.$('#btn-create-bapb');
  assert.strictEqual(asbCreateBtnOnPengurus, null, 'Tombol "Buat Berita Acara" TIDAK BOLEH tampil untuk Pengurus');

  // Screenshot Pengurus Document Queue
  await page.screenshot({
    path: path.join(ARTIFACTS_DIR, 'bapb_role_pengurus_queue.png'),
    fullPage: false
  });
  console.log('    [OK] Screenshot bapb_role_pengurus_queue.png tersimpan');

  // Execute Pengurus Finalization & Sign
  console.log('    Pengurus membubuhkan tanda tangan pengesahan dan memfinalisasi dokumen...');
  await page.click('.btn-pengurus-action[data-id="BAPB-ROLE-TEST-001"]');
  await page.waitForSelector('#bapb-sig-canvas-pengurus');
  await new Promise(r => setTimeout(r, 600));

  // Scroll modal body down to show signature in viewport
  await page.evaluate(() => {
    const modalBody = document.querySelector('.modal-fullscreen .modal-body');
    if (modalBody) modalBody.scrollTop = modalBody.scrollHeight;
  });
  await new Promise(r => setTimeout(r, 400));

  // Draw on canvas
  const pgrCanvas = await page.$('#bapb-sig-canvas-pengurus');
  const pgrBox = await pgrCanvas.boundingBox();
  await page.mouse.move(pgrBox.x + 40, pgrBox.y + 40);
  await page.mouse.down();
  for (let i = 0; i < 20; i++) {
    await page.mouse.move(pgrBox.x + 50 + i * 5, pgrBox.y + 40 + (i % 2) * 15);
  }
  await page.mouse.up();

  await page.click('#btn-confirm-finalize-pengurus');
  await page.waitForSelector('.btn-print-bapb[data-id="BAPB-ROLE-TEST-001"]', { timeout: 10000 });

  // Verify document is now FINAL and print button is available
  const printBtn = await page.$('.btn-print-bapb[data-id="BAPB-ROLE-TEST-001"]');
  assert.ok(printBtn, 'Dokumen FINAL memiliki tombol "Cetak BAPB (A4)"');

  // Screenshot Finalized Document in Pengurus View
  await page.screenshot({
    path: path.join(ARTIFACTS_DIR, 'bapb_role_finalized_card.png'),
    fullPage: false
  });
  console.log('    [OK] Screenshot bapb_role_finalized_card.png tersimpan');

  // ---------------------------------------------------------------------------
  // STEP 4: VERIFY RETURN FLOW (REVISI ASB DOKUMEN)
  // ---------------------------------------------------------------------------
  console.log('\n>>> [4/5] Menguji Alur Pengembalian (Return / Revisi)...');
  await page.evaluate(async () => {
    const { storage } = await import('./js/core/storage.js');
    const { BAPB_STATUS, DESTRUCTION_STORAGE_KEY } = await import('./js/modules/destruction/destruction-manager.js');

    const draft2 = {
      id: 'BAPB-ROLE-TEST-002',
      bapbId: 'BAPB-ROLE-TEST-002',
      docNo: 'DRAFT-BAPB/TB/DIV-I/10/2026/0889',
      draftDocNo: 'DRAFT-BAPB/TB/DIV-I/10/2026/0889',
      officialDocNo: null,
      isFinal: false,
      documentType: 'BAPB_KARET',
      transactionType: 'PEMUSNAHAN_BIBIT',
      estateId: 'EST-TBS',
      estateCode: 'TB',
      divisionId: 'DIV-001',
      divisionCode: 'DIV-I',
      items: [{
        sourceSelectionId: 'SEL-TEST-02',
        sourceSelectionNo: 'TBS/DIV-I/CULL/SEL-I/10/2026/10',
        klon: 'RRIC 100',
        bedengan: 'BED-12',
        quantity: 120,
        stage: 'Afkir Seleksi'
      }],
      totalQty: 120,
      quantity: 120,
      klon: 'RRIC 100',
      bedengan: 'BED-12',
      tanggalPelaksanaan: '2026-10-18',
      metodePemusnahan: 'Pencincangan dan Pemendaman',
      photos: ['data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='],
      signatures: {
        asb: {
          roleTitle: 'Asisten Divisi Bibitan — Pelaksana',
          name: 'Annisa',
          userId: 'TBS-ASB-001',
          signatureDataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mP8z8BQz0AEYBxVSF+FABJADveWkH6oAAAAAElFTkSuQmCC',
          signedAt: '2026-10-18T08:00:00+07:00'
        },
        askep: null,
        pengurus: null
      },
      bapbStatus: BAPB_STATUS.DIKEMBALIKAN_KE_ASB,
      status: BAPB_STATUS.DIKEMBALIKAN_KE_ASB,
      returnReason: 'Foto bukti fisik kurang fokus, mohon perbarui foto pemusnahan.',
      returnedByName: 'Beny Sihotang',
      returnedAt: '2026-10-18T09:00:00+07:00',
      createdByName: 'Annisa',
      createdAt: new Date().toISOString()
    };

    const currentRecords = storage.get(DESTRUCTION_STORAGE_KEY, []) || [];
    storage.set(DESTRUCTION_STORAGE_KEY, [draft2, ...currentRecords]);
  });

  // Switch back to ASB to verify returned document action
  await page.evaluate(async () => {
    const { session } = await import('./js/core/session.js');
    session.start({
      userId: 'TBS-ASB-001',
      code: 'ASB001',
      role: 'ASISTEN_BIBITAN',
      name: 'Annisa',
      estateId: 'EST-TBS',
      divisionId: 'DIV-001'
    });
  });

  await page.goto('http://localhost:3000/?nocache=' + Date.now() + '#/destruction', { waitUntil: 'networkidle0' });
  await page.waitForSelector('.card-bapb-item[data-id="BAPB-ROLE-TEST-002"]');

  const recreateBtn = await page.$('.btn-recreate-bapb[data-id="BAPB-ROLE-TEST-002"]');
  assert.ok(recreateBtn, 'Tombol "Perbaiki Draf BAPB" WAJIB tersedia untuk ASB pada dokumen yang dikembalikan');
  console.log('    [PASS] Dokumen berstatus DIKEMBALIKAN_KE_ASB menampilkan tombol "Perbaiki Draf BAPB" bagi ASB');

  // ---------------------------------------------------------------------------
  // STEP 5: VERIFY STORAGE INTEGRITY & SIGNATURES COMPATIBILITY
  // ---------------------------------------------------------------------------
  console.log('\n>>> [5/5] Memverifikasi Integritas Data Dokumen BAPB di Storage...');
  const finalDocData = await page.evaluate(async () => {
    const { storage } = await import('./js/core/storage.js');
    const { DESTRUCTION_STORAGE_KEY } = await import('./js/modules/destruction/destruction-manager.js');
    const records = storage.get(DESTRUCTION_STORAGE_KEY, []) || [];
    return records.find(r => r.id === 'BAPB-ROLE-TEST-001');
  });

  assert.strictEqual(finalDocData.bapbStatus, 'FINAL', 'Status dokumen harus FINAL');
  assert.ok(finalDocData.officialDocNo, 'Nomor resmi BAPB harus terisi');
  assert.ok(finalDocData.signatures?.asb?.signatureDataUrl, 'Tanda tangan ASB harus tersimpan');
  assert.ok(finalDocData.signatures?.askep?.signatureDataUrl, 'Tanda tangan Askep harus tersimpan');
  assert.ok(finalDocData.signatures?.pengurus?.signatureDataUrl, 'Tanda tangan Pengurus harus tersimpan');

  console.log('    Status Dokumen:', finalDocData.bapbStatus);
  console.log('    Nomor Resmi:', finalDocData.officialDocNo);
  console.log('    TTD ASB Pelaksana:', finalDocData.signatures.asb.name);
  console.log('    TTD Askep Pemeriksa:', finalDocData.signatures.askep.name);
  console.log('    TTD Pengurus Pengesah:', finalDocData.signatures.pengurus.name);
  console.log('    [PASS] Seluruh 3 tanda tangan visual tersimpan rapi pada satu objek dokumen!');

  await browser.close();
  console.log('\n========================================================================');
  console.log('🎉 SEMUA VERIFIKASI PERGANTIAN ROLE & NAVIGASI BAPB LULUS 100%!');
  console.log('========================================================================\n');
}

runTest().catch(err => {
  console.error('\n[TEST CRASHED]', err);
  process.exit(1);
});
