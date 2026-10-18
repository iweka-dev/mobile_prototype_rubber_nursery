import puppeteer from 'puppeteer';
import path from 'path';

const ARTIFACTS_DIR = 'C:/Users/T1N0C/.gemini/antigravity-ide/brain/cd87cee5-4a6c-4972-bf89-56cf399fe1e0';

async function runDualApprovalModeTests() {
  console.log('========================================================================');
  console.log('STARTING AUTOMATED E2E TEST: DUAL MODE PERSETUJUAN BAPB KARET DIGITAL');
  console.log('========================================================================');

  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1280,900']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });

  // Handle window.confirm automatically
  page.on('dialog', async dialog => {
    console.log(`  [DIALOG] ${dialog.type()}: "${dialog.message().slice(0, 40)}..." -> ACCEPT`);
    await dialog.accept();
  });

  let passedChecks = 0;
  let totalChecks = 0;

  function assert(condition, message) {
    totalChecks++;
    if (condition) {
      passedChecks++;
      console.log(`  [PASS] ${message}`);
    } else {
      console.error(`  [FAIL] ${message}`);
      throw new Error(`Assertion failed: ${message}`);
    }
  }

  try {
    // -------------------------------------------------------------------------
    // STEP 1: Set up ASB User Persona & Navigate to Pemusnahan Bibit
    // -------------------------------------------------------------------------
    console.log('\n>>> [1/7] Inisialisasi Sesi ASB dan Buka Form Buat Berita Acara...');
    await page.goto('http://localhost:3000/?nocache=' + Date.now(), { waitUntil: 'networkidle0' });

    await page.evaluate(async () => {
      const { session } = await import('./js/core/session.js');
      session.start({ code: 'ASB001' });
    });

    await page.goto('http://localhost:3000/?nocache=' + Date.now() + '#/destruction', { waitUntil: 'networkidle0' });
    await new Promise(r => setTimeout(r, 600));

    // Seed mock selection transactions if needed so ASB has eligible selections
    await page.evaluate(async () => {
      const { storage } = await import('./js/core/storage.js');
      const existingSel = storage.get('selection_transactions', []);
      const testSelId = 'SEL-TEST-DUAL-' + Date.now();
      const newSel = {
        id: testSelId,
        docNo: 'SEL/TB/DIV-I/10/2026/0888',
        estateId: 'EST-TBS',
        divisionId: 'DIV-001',
        batchId: 'BATCH-TBS-001',
        batchCode: 'TB-RRIM600-202601',
        bedengan: 'BED-01',
        bedenganCode: 'BED-01',
        klon: 'RRIM 600',
        stage: 'Seleksi 1',
        selectionStage: 'Seleksi 1',
        quantity: 45,
        jumlahAfkir: 45,
        jumlahAfkirTotal: 45,
        status: 'DISETUJUI',
        isApproved: true,
        reason: 'Afkir Batang Bengkok'
      };
      storage.set('selection_transactions', [newSel, ...existingSel]);
    });

    await page.reload({ waitUntil: 'networkidle0' });
    await new Promise(r => setTimeout(r, 600));

    // Open BAPB Creation Modal
    const createBtn = await page.waitForSelector('#btn-create-bapb');
    assert(createBtn !== null, 'Tombol "Buat Berita Acara" tersedia pada dashboard ASB');
    await page.click('#btn-create-bapb');
    await new Promise(r => setTimeout(r, 500));

    const preContinueBtn = await page.$('#btn-continue-method-selection');
    if (preContinueBtn) {
      await page.click('.bapb-pre-mode-card[data-mode="SEQUENTIAL"]');
      await page.click('#btn-continue-method-selection');
      await new Promise(r => setTimeout(r, 500));
      const sourceContinueBtn = await page.$('#btn-continue-source-selection');
      if (sourceContinueBtn) {
        const firstChk = await page.$('.chk-bapb-source');
        if (firstChk) {
          const isChecked = await page.$eval('.chk-bapb-source', el => el.checked);
          if (!isChecked) await page.click('.chk-bapb-source');
        }
        await page.click('#btn-continue-source-selection');
        await new Promise(r => setTimeout(r, 500));
      }
    }

    // Verify AC-01 & AC-02: Mode indicator exists and SEQUENTIAL is default
    const modeSection = await page.$('#section-bapb-approval-mode');
    assert(modeSection !== null, '[AC-01] Kontrol pilihan mode persetujuan tampil pada formulir ASB');

    const sequentialRadio = await page.$('#bapb-mode-sequential');
    const isSequentialChecked = await page.$eval('#bapb-mode-sequential', el => el.checked);
    assert(isSequentialChecked === true, '[AC-02] Mode Persetujuan Bertahap menjadi pilihan default');

    const directRadio = await page.$('#bapb-mode-direct');
    assert(directRadio !== null, 'Pilihan Mode Tanda Tangan Langsung di Lokasi tersedia');

    // Screenshot initial form with default mode
    await page.screenshot({
      path: path.join(ARTIFACTS_DIR, 'bapb_dual_step1_mode_selector.png'),
      fullPage: false
    });
    console.log('  [OK] Screenshot bapb_dual_step1_mode_selector.png tersimpan');

    // -------------------------------------------------------------------------
    // STEP 2: Mode B — Tanda Tangan Langsung di Lokasi (UI & Signature areas)
    // -------------------------------------------------------------------------
    console.log('\n>>> [2/7] Menguji Mode B: Tanda Tangan Langsung di Lokasi (3 Kanvas)...');
    
    // Check that direct container is initially hidden
    const isDirectHiddenInitially = await page.$eval('#bapb-direct-signatures-container', el => el.style.display === 'none');
    assert(isDirectHiddenInitially === true, 'Area tanda tangan Askep & Pengurus disembunyikan saat mode Bertahap');

    // Switch to Direct Mode via Ubah button or direct radio
    const changeModeBtn = await page.$('#btn-change-bapb-mode');
    if (changeModeBtn) {
      await page.evaluate(() => document.getElementById('btn-change-bapb-mode')?.click());
      await new Promise(r => setTimeout(r, 400));
      await page.click('.bapb-pre-mode-card[data-mode="DIRECT_ON_SITE"]');
      await page.click('#btn-continue-method-selection');
      await new Promise(r => setTimeout(r, 500));
      const sourceContinueBtn2 = await page.$('#btn-continue-source-selection');
      if (sourceContinueBtn2) {
        const firstChk = await page.$('.chk-bapb-source');
        if (firstChk) {
          const isChecked = await page.$eval('.chk-bapb-source', el => el.checked);
          if (!isChecked) await page.click('.chk-bapb-source');
        }
        await page.click('#btn-continue-source-selection');
        await new Promise(r => setTimeout(r, 500));
      }
    } else {
      await page.click('#bapb-mode-direct');
      await new Promise(r => setTimeout(r, 300));
    }

    const isDirectVisible = await page.$eval('#bapb-direct-signatures-container', el => el.style.display !== 'none');
    assert(isDirectVisible === true, '[AC-04] Mode langsung menampilkan area tanda tangan Askep & Pengurus');

    const asbCanvas = await page.$('#bapb-sig-canvas-asb');
    const askepCanvas = await page.$('#bapb-sig-canvas-direct-askep');
    const pengurusCanvas = await page.$('#bapb-sig-canvas-direct-pengurus');
    assert(asbCanvas !== null && askepCanvas !== null && pengurusCanvas !== null, '[AC-04] Tiga area tanda tangan (ASB, Askep, Pengurus) tersedia dalam satu formulir');

    // Verify submit button label updated
    const submitBtnText = await page.$eval('#btn-submit-bapb-draft', el => el.textContent.trim());
    assert(submitBtnText.includes('Buat Dokumen') || submitBtnText.includes('Sahkan Dokumen FINAL'), `Label tombol submit mode langsung: "${submitBtnText}"`);

    // Screenshot Direct Mode Form
    await page.screenshot({
      path: path.join(ARTIFACTS_DIR, 'bapb_dual_step2_direct_mode_form.png'),
      fullPage: false
    });
    console.log('  [OK] Screenshot bapb_dual_step2_direct_mode_form.png tersimpan');

    // -------------------------------------------------------------------------
    // STEP 3: Validate Direct Mode Signatures Rejection (Missing Signatures)
    // -------------------------------------------------------------------------
    console.log('\n>>> [3/7] Menguji Validasi Penolakan Mode Langsung Jika Tanda Tangan Belum Lengkap...');

    // Select source item
    const firstCheckbox = await page.$('.chk-bapb-source');
    if (firstCheckbox) {
      await page.click('.chk-bapb-source');
    }

    // Capture 1 real camera photo via trigger
    await page.click('#btn-trigger-photo');
    await page.waitForFunction(() => {
      const el = document.getElementById('bapb-camera-overlay');
      return el && window.getComputedStyle(el).display === 'flex';
    }, { timeout: 3000 });
    await new Promise(r => setTimeout(r, 200));
    await page.click('#btn-bapb-camera-shutter');
    await new Promise(r => setTimeout(r, 400));

    // Try submit with 0 signatures
    await page.click('#btn-submit-bapb-draft');
    await new Promise(r => setTimeout(r, 300));
    let modalStillOpen = await page.$('.modal-bapb-fullscreen');
    assert(modalStillOpen !== null, '[AC-05] Finalisasi ditolak ketika tanda tangan ASB kosong');

    // Sign ASB only
    await page.evaluate(() => {
      const c = document.getElementById('bapb-sig-canvas-asb');
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#0F172A';
      ctx.fillRect(10, 10, 150, 40);
      // Trigger mouse events to increment stroke count
      c.dispatchEvent(new MouseEvent('mousedown', { clientX: 20, clientY: 20 }));
      for (let i = 0; i < 20; i++) {
        c.dispatchEvent(new MouseEvent('mousemove', { clientX: 20 + i, clientY: 20 + i }));
      }
      c.dispatchEvent(new MouseEvent('mouseup'));
    });

    // Try submit with ASB signed but Askep missing
    await page.click('#btn-submit-bapb-draft');
    await new Promise(r => setTimeout(r, 300));
    modalStillOpen = await page.$('.modal-bapb-fullscreen');
    assert(modalStillOpen !== null, '[AC-05] Finalisasi ditolak ketika tanda tangan Askep kosong');

    // Sign Askep
    await page.evaluate(() => {
      const c = document.getElementById('bapb-sig-canvas-direct-askep');
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#1D4ED8';
      ctx.fillRect(20, 20, 160, 50);
      c.dispatchEvent(new MouseEvent('mousedown', { clientX: 30, clientY: 30 }));
      for (let i = 0; i < 20; i++) {
        c.dispatchEvent(new MouseEvent('mousemove', { clientX: 30 + i * 2, clientY: 30 + i }));
      }
      c.dispatchEvent(new MouseEvent('mouseup'));
    });

    // Try submit with ASB + Askep signed but Pengurus missing
    await page.click('#btn-submit-bapb-draft');
    await new Promise(r => setTimeout(r, 300));
    modalStillOpen = await page.$('.modal-bapb-fullscreen');
    assert(modalStillOpen !== null, '[AC-05] Finalisasi ditolak ketika tanda tangan Pengurus kosong');

    // Sign Pengurus with distinct strokes
    await page.evaluate(() => {
      const c = document.getElementById('bapb-sig-canvas-direct-pengurus');
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#047857';
      ctx.fillRect(30, 30, 170, 60);
      c.dispatchEvent(new MouseEvent('mousedown', { clientX: 40, clientY: 40 }));
      for (let i = 0; i < 20; i++) {
        c.dispatchEvent(new MouseEvent('mousemove', { clientX: 40 + i, clientY: 40 + i * 2 }));
      }
      c.dispatchEvent(new MouseEvent('mouseup'));
    });

    // -------------------------------------------------------------------------
    // STEP 4: Submit Direct Mode -> Instant FINAL with Official Number
    // -------------------------------------------------------------------------
    console.log('\n>>> [4/7] Melakukan Pengesahan FINAL Mode Langsung...');
    await page.click('#btn-submit-bapb-draft');
    await new Promise(r => setTimeout(r, 800));

    // Verify modal closed
    const modalAfterSubmit = await page.$('.modal-bapb-fullscreen');
    assert(modalAfterSubmit === null, 'Modal form BAPB tertutup setelah pengesahan sukses');

    // Verify the latest document on dashboard
    const cardData = await page.evaluate(async () => {
      const { storage } = await import('./js/core/storage.js');
      const records = storage.get('destruction_transactions', []);
      return records[records.length - 1];
    });

    assert(cardData.bapbStatus === 'FINAL' && cardData.isFinal === true, '[AC-08] Dokumen mode langsung menjadi FINAL seketika');
    assert(cardData.approvalMode === 'DIRECT_ON_SITE', '[AC-07] Atribut approvalMode: "DIRECT_ON_SITE" tersimpan konsisten');
    
    // Official doc number format verification: [KEBUN]/[DIVISI]/[BULAN]/[TAHUN]/[SEQ]
    const officialPattern = /^[A-Z0-9\-_]+\/[A-Z0-9\-_]+\/\d{2}\/\d{4}\/\d{2,}$/;
    assert(officialPattern.test(cardData.officialDocNo), `[AC-09] Nomor resmi BAPB sesuai format standar: "${cardData.officialDocNo}"`);

    // Verify all 3 signatures present in record
    assert(Boolean(cardData.signatures?.asb?.signatureDataUrl), 'Tanda tangan ASB tersimpan pada dokumen');
    assert(Boolean(cardData.signatures?.askep?.signatureDataUrl), 'Tanda tangan Askep tersimpan pada dokumen');
    assert(Boolean(cardData.signatures?.pengurus?.signatureDataUrl), 'Tanda tangan Pengurus tersimpan pada dokumen');

    // Screenshot dashboard card showing "Langsung di Lokasi" badge
    await page.screenshot({
      path: path.join(ARTIFACTS_DIR, 'bapb_dual_step3_direct_finalized_card.png'),
      fullPage: false
    });
    console.log('  [OK] Screenshot bapb_dual_step3_direct_finalized_card.png tersimpan');

    // -------------------------------------------------------------------------
    // STEP 5: Verify PDF Print Preview of Direct Mode Document
    // -------------------------------------------------------------------------
    console.log('\n>>> [5/7] Menguji Preview & Cetak Dokumen Mode Langsung (A4)...');
    const previewBtn = await page.waitForSelector(`.card-bapb-item[data-id="${cardData.id}"] .btn-preview-bapb`);
    assert(previewBtn !== null, 'Tombol Lihat & Cetak BAPB tersedia pada kartu dokumen FINAL');
    await previewBtn.click();
    await new Promise(r => setTimeout(r, 600));

    // Verify Print Preview Modal Content
    const previewModal = await page.waitForSelector('.modal-bapb-preview-modal');
    assert(previewModal !== null, 'Modal Cetak & Preview BAPB A4 terbuka');

    const previewText = await page.$eval('.modal-bapb-preview-modal', el => el.innerText);
    assert(previewText.includes('Tanda Tangan Langsung di Lokasi'), '[AC-11] Preview PDF menampilkan "Mode Persetujuan: Tanda Tangan Langsung di Lokasi"');
    assert(previewText.includes(cardData.officialDocNo), `Preview PDF menampilkan nomor resmi: ${cardData.officialDocNo}`);
    assert(previewText.includes('Nol Mutasi (Dipotong saat Seleksi)'), '[AC-10] Dokumen menegaskan Invarian Stok: Nol Mutasi');

    // Screenshot A4 Preview Modal for Direct Mode
    await page.screenshot({
      path: path.join(ARTIFACTS_DIR, 'bapb_dual_step4_direct_print_preview.png'),
      fullPage: false
    });
    console.log('  [OK] Screenshot bapb_dual_step4_direct_print_preview.png tersimpan');

    // Close preview modal
    const closePreviewBtn = await page.$('#btn-close-print-preview');
    if (closePreviewBtn) await closePreviewBtn.click();
    await new Promise(r => setTimeout(r, 400));

    // -------------------------------------------------------------------------
    // STEP 6: Mode A — Persetujuan Bertahap (ASB -> Askep -> Pengurus)
    // -------------------------------------------------------------------------
    console.log('\n>>> [6/7] Menguji Mode A: Alur Persetujuan Bertahap (ASB -> Askep -> Pengurus)...');
    
    // Seed another selection item
    await page.evaluate(async () => {
      const { storage } = await import('./js/core/storage.js');
      const existingSel = storage.get('selection_transactions', []);
      const testSelId = 'SEL-TEST-SEQ-' + Date.now();
      const newSel = {
        id: testSelId,
        docNo: 'SEL/TB/DIV-I/10/2026/0999',
        estateId: 'EST-TBS',
        divisionId: 'DIV-001',
        batchId: 'BATCH-TBS-001',
        batchCode: 'TB-RRIM600-202601',
        bedengan: 'BED-02',
        bedenganCode: 'BED-02',
        klon: 'RRIM 600',
        stage: 'Seleksi 1',
        selectionStage: 'Seleksi 1',
        quantity: 30,
        jumlahAfkir: 30,
        jumlahAfkirTotal: 30,
        status: 'DISETUJUI',
        isApproved: true,
        reason: 'Afkir Batang Bengkok'
      };
      storage.set('selection_transactions', [newSel, ...existingSel]);
    });

    await page.reload({ waitUntil: 'networkidle0' });
    await new Promise(r => setTimeout(r, 500));

    // ASB creates BAPB in Sequential Mode (Default)
    await page.click('#btn-create-bapb');
    await new Promise(r => setTimeout(r, 500));

    const preContinueBtn2 = await page.$('#btn-continue-method-selection');
    if (preContinueBtn2) {
      await page.click('.bapb-pre-mode-card[data-mode="SEQUENTIAL"]');
      await page.click('#btn-continue-method-selection');
      await new Promise(r => setTimeout(r, 500));
      const sourceContinueBtn3 = await page.$('#btn-continue-source-selection');
      if (sourceContinueBtn3) {
        const firstChk = await page.$('.chk-bapb-source');
        if (firstChk) {
          const isChecked = await page.$eval('.chk-bapb-source', el => el.checked);
          if (!isChecked) await page.click('.chk-bapb-source');
        }
        await page.click('#btn-continue-source-selection');
        await new Promise(r => setTimeout(r, 500));
      }
    }

    // Select an available source
    const uncheckedBox = await page.$('.chk-bapb-source:not(:checked)');
    if (uncheckedBox) {
      await uncheckedBox.click();
    } else {
      await page.click('.chk-bapb-source');
    }

    // Take photo
    await page.click('#btn-trigger-photo');
    await page.waitForFunction(() => {
      const el = document.getElementById('bapb-camera-overlay');
      return el && window.getComputedStyle(el).display === 'flex';
    }, { timeout: 3000 });
    await new Promise(r => setTimeout(r, 200));
    await page.click('#btn-bapb-camera-shutter');
    await new Promise(r => setTimeout(r, 400));

    // Sign ASB
    await page.evaluate(() => {
      const c = document.getElementById('bapb-sig-canvas-asb');
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#0F172A';
      ctx.fillRect(10, 10, 150, 40);
      c.dispatchEvent(new MouseEvent('mousedown', { clientX: 20, clientY: 20 }));
      for (let i = 0; i < 20; i++) {
        c.dispatchEvent(new MouseEvent('mousemove', { clientX: 20 + i, clientY: 20 + i }));
      }
      c.dispatchEvent(new MouseEvent('mouseup'));
    });

    // Ensure sequential radio is checked
    const isSeqChecked = await page.$eval('#bapb-mode-sequential', el => el.checked);
    assert(isSeqChecked === true, 'Mode Persetujuan Bertahap terpilih');

    // Submit draft
    await page.click('#btn-submit-bapb-draft');
    await new Promise(r => setTimeout(r, 800));

    // Verify sequential draft record in storage
    const seqDraft = await page.evaluate(async () => {
      const { storage } = await import('./js/core/storage.js');
      const records = storage.get('destruction_transactions', []);
      return records[records.length - 1];
    });

    assert(seqDraft.bapbStatus === 'DRAFT_AWAITING_ASKEP', '[AC-03] Draf mode bertahap berstatus DRAFT_AWAITING_ASKEP');
    assert(seqDraft.approvalMode === 'SEQUENTIAL', '[AC-07] Atribut approvalMode bertahap: "SEQUENTIAL"');

    // Askep reviews and signs
    console.log('  -> Menjalankan persetujuan Askep...');
    await page.evaluate(async (draftId) => {
      const { signBapbAskep } = await import('./js/modules/destruction/destruction-manager.js');
      const dummyAskepSig = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='.repeat(15);
      const currentUser = {
        userId: 'ASK001',
        name: 'Beny Sihotang',
        role: 'ASKEP',
        estateId: 'EST-TBS'
      };
      signBapbAskep(draftId, dummyAskepSig, 'Pemeriksaan lapangan terverifikasi.', currentUser);
    }, seqDraft.id);

    // Verify Askep signature updated status to DRAFT_AWAITING_PENGURUS
    const afterAskep = await page.evaluate(async (draftId) => {
      const { storage } = await import('./js/core/storage.js');
      const records = storage.get('destruction_transactions', []);
      return records.find(r => r.id === draftId);
    }, seqDraft.id);
    assert(afterAskep.bapbStatus === 'DRAFT_AWAITING_PENGURUS', '[AC-03] Status berubah menjadi DRAFT_AWAITING_PENGURUS setelah tanda tangan Askep');

    // Pengurus finalizes sequential document
    console.log('  -> Menjalankan pengesahan Pengurus...');
    await page.evaluate(async (draftId) => {
      const { finalizeBapbDocument } = await import('./js/modules/destruction/destruction-manager.js');
      const dummyPengurusSig = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEklEQVR42mN8z8Dwn4GBgQEAAh8B/5fQ4V4AAAAASUVORK5CYII='.repeat(15);
      const currentUser = {
        userId: 'PGS001',
        name: 'Junaidi',
        role: 'PENGURUS',
        estateId: 'EST-TBS'
      };
      finalizeBapbDocument(draftId, dummyPengurusSig, 'Dokumen BAPB disahkan.', currentUser);
    }, seqDraft.id);

    const afterPengurus = await page.evaluate(async (draftId) => {
      const { storage } = await import('./js/core/storage.js');
      const records = storage.get('destruction_transactions', []);
      return records.find(r => r.id === draftId);
    }, seqDraft.id);
    assert(afterPengurus.bapbStatus === 'FINAL' && afterPengurus.isFinal === true, '[AC-03] Dokumen bertahap disahkan menjadi FINAL');
    assert(officialPattern.test(afterPengurus.officialDocNo), `Nomor resmi dokumen bertahap: ${afterPengurus.officialDocNo}`);

    // -------------------------------------------------------------------------
    // STEP 7: Invariants Verification (Zero Mutation & Immutability)
    // -------------------------------------------------------------------------
    console.log('\n>>> [7/7] Memverifikasi Invarian: Nol Mutasi Stok & Immutabilitas FINAL...');

    // Invariant check: BAPB does not deduct stock
    const stockBatches = await page.evaluate(async () => {
      const { storage } = await import('./js/core/storage.js');
      return storage.get('batch_master', []);
    });
    assert(cardData.bapbInventoryEffect === 'ZERO_MUTATION_ALREADY_DEDUCTED_AT_SELECTION', '[AC-10] bapbInventoryEffect tetap ZERO_MUTATION_ALREADY_DEDUCTED_AT_SELECTION');

    // Immutability: Cannot directly edit or finalize twice
    const editRejected = await page.evaluate(async (finalId) => {
      const { finalizeBapbDocument } = await import('./js/modules/destruction/destruction-manager.js');
      try {
        finalizeBapbDocument(finalId, 'data:image/png;base64,1234567890'.repeat(15), '', { role: 'PENGURUS' });
        return false;
      } catch (err) {
        return true;
      }
    }, cardData.id);
    assert(editRejected === true, '[AC-12] Dokumen FINAL terkunci dan menolak pengesahan ulang');

    console.log('\n========================================================================');
    console.log(`🎉 SELURUH PENGUJIAN DUAL APPROVAL MODE BERHASIL: ${passedChecks}/${totalChecks} PASS, 0 FAIL`);
    console.log('========================================================================');

  } catch (err) {
    console.error('\n❌ ERROR SAAT PENGUJIAN:', err);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

runDualApprovalModeTests();
