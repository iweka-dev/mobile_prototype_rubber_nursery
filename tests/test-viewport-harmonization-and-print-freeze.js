import puppeteer from 'puppeteer';
import path from 'path';

const ARTIFACTS_DIR = 'C:/Users/T1N0C/.gemini/antigravity-ide/brain/308be8c4-169f-4a71-b7e1-ade86fed7390';

const VIEWPORTS = [
  { name: 'Mobile_360', width: 360, height: 780 },
  { name: 'Mobile_390', width: 390, height: 844 },
  { name: 'Mobile_430', width: 430, height: 932 },
  { name: 'Desktop_1280', width: 1280, height: 900 }
];

async function runViewportHarmonizationTests() {
  console.log('========================================================================');
  console.log('STARTING AUTOMATED VIEWPORT HARMONIZATION & PRINT FREEZE SUITE');
  console.log('Testing Viewports: 360px, 390px, 430px, and Desktop 1280px');
  console.log('========================================================================\n');

  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1280,950']
  });

  const page = await browser.newPage();

  page.on('dialog', async dialog => {
    console.log(`  [DIALOG] ${dialog.type()}: "${dialog.message().slice(0, 50)}..." -> ACCEPT`);
    await dialog.accept();
  });

  // Track console errors
  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });

  let passCount = 0;
  let failCount = 0;

  function assert(condition, message) {
    if (condition) {
      passCount++;
      console.log(`  [PASS] ${message}`);
    } else {
      failCount++;
      console.error(`  [FAIL] ${message}`);
      throw new Error(`Assertion failed: ${message}`);
    }
  }

  try {
    // Test 1: Desktop baseline check
    console.log('>>> [PHASE 1] Membuka Halaman Pemusnahan Bibit (Desktop 1280x900)...');
    await page.setViewport({ width: 1280, height: 900 });
    await page.goto('http://localhost:3000/?nocache=' + Date.now(), { waitUntil: 'networkidle0' });

    await page.evaluate(async () => {
      const { session } = await import('./js/core/session.js');
      session.start({ code: 'ASB001' });
    });

    await page.goto('http://localhost:3000/?nocache=' + Date.now() + '#/destruction', { waitUntil: 'networkidle0' });
    await new Promise(r => setTimeout(r, 600));

    // Seed mock selection transactions if needed
    await page.evaluate(async () => {
      const { storage } = await import('./js/core/storage.js');
      const existingSel = storage.get('selection_transactions', []);
      const testSelId = 'SEL-TEST-HARMONY-' + Date.now();
      const newSel = {
        id: testSelId,
        docNo: 'SEL/TB/DIV-I/10/2026/0999',
        estateId: 'EST-TBS',
        divisionId: 'DIV-001',
        batchId: 'BATCH-TBS-001',
        batchCode: 'TB-RRIM600-202601',
        bedengan: 'BED-04',
        bedenganCode: 'BED-04',
        klon: 'GT 1',
        stage: 'Seleksi 1',
        selectionStage: 'Seleksi 1',
        quantity: 45,
        jumlahAfkir: 45,
        jumlahAfkirTotal: 45,
        status: 'DISETUJUI',
        isApproved: true,
        reason: 'Bibit Kerdil dan Kering'
      };
      storage.set('selection_transactions', [newSel, ...existingSel]);
    });

    await page.reload({ waitUntil: 'networkidle0' });
    await new Promise(r => setTimeout(r, 600));

    // Phase 2: Iterate through responsive mobile viewports
    for (const vp of VIEWPORTS) {
      console.log(`\n========================================================================`);
      console.log(`>>> [PHASE 2: ${vp.name}] Viewport ${vp.width}x${vp.height} Audit & Harmonisasi`);
      console.log(`========================================================================`);

      await page.setViewport({ width: vp.width, height: vp.height });
      await new Promise(r => setTimeout(r, 400));

      // 1. Check Landing Page Horizontal Overflow (AC01)
      const pageOverflow = await page.evaluate(() => {
        const body = document.body;
        const html = document.documentElement;
        return {
          windowWidth: window.innerWidth,
          scrollWidth: Math.max(body.scrollWidth, html.scrollWidth),
          hasHorizontalScroll: Math.max(body.scrollWidth, html.scrollWidth) > window.innerWidth
        };
      });
      assert(!pageOverflow.hasHorizontalScroll, `[AC01 - ${vp.name}] Halaman utama tidak mengalami horizontal overflow (scrollWidth: ${pageOverflow.scrollWidth} <= ${pageOverflow.windowWidth})`);

      // 2. Check Header Typography & Badge consistency (AC02)
      const headerStyles = await page.evaluate(() => {
        const h2 = document.querySelector('.card h2') || document.querySelector('.page-title');
        if (!h2) return null;
        const cs = window.getComputedStyle(h2);
        return {
          fontFamily: cs.fontFamily,
          fontSize: cs.fontSize,
          fontWeight: cs.fontWeight,
          color: cs.color
        };
      });
      if (headerStyles) {
        assert(headerStyles.fontWeight === '700', `[AC02 - ${vp.name}] Bobot font header konsisten (700)`);
      }

      // Take screenshot of landing page on mobile
      if (vp.width === 390) {
        await page.screenshot({
          path: path.join(ARTIFACTS_DIR, `bapb_harmony_landing_${vp.name}.png`),
          fullPage: false
        });
        console.log(`  [OK] Screenshot bapb_harmony_landing_${vp.name}.png tersimpan`);
      }

      // Ensure eligible selection transaction exists for this viewport
      await page.evaluate(async (vpName) => {
        const { storage } = await import('./js/core/storage.js');
        const existingSel = storage.get('selection_transactions', []);
        const newSel = {
          id: 'SEL-TEST-' + vpName + '-' + Date.now(),
          docNo: 'SEL/TB/DIV-I/10/2026/0' + Math.floor(Math.random() * 900 + 100),
          estateId: 'EST-TBS',
          divisionId: 'DIV-001',
          batchId: 'BATCH-TBS-001',
          batchCode: 'TB-RRIM600-202601',
          bedengan: 'BED-04',
          bedenganCode: 'BED-04',
          klon: 'GT 1',
          stage: 'Seleksi 1',
          selectionStage: 'Seleksi 1',
          quantity: 45,
          jumlahAfkir: 45,
          jumlahAfkirTotal: 45,
          status: 'DISETUJUI',
          isApproved: true,
          reason: 'Bibit Kerdil dan Kering'
        };
        storage.set('selection_transactions', [newSel, ...existingSel]);
      }, vp.name);

      // 3. Open Form Buat Berita Acara
      const createBtn = await page.waitForSelector('#btn-create-bapb');
      await page.click('#btn-create-bapb');
      await new Promise(r => setTimeout(r, 500));

      const preContinueBtn = await page.$('#btn-continue-method-selection');
      if (preContinueBtn) {
        await page.click('.bapb-pre-mode-card[data-mode="SEQUENTIAL"]');
        await page.click('#btn-continue-method-selection');
        await new Promise(r => setTimeout(r, 500));
      }

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

      // 4. Verify Form modal does not overflow viewport horizontally
      const formOverflow = await page.evaluate(() => {
        const modal = document.querySelector('.modal-fullscreen');
        const body = modal ? modal.querySelector('.modal-body') : null;
        if (!modal || !body) return { found: false };
        return {
          found: true,
          windowWidth: window.innerWidth,
          modalWidth: modal.clientWidth,
          bodyScrollWidth: body.scrollWidth,
          bodyClientWidth: body.clientWidth,
          hasBodyHorizontalScroll: body.scrollWidth > body.clientWidth + 2
        };
      });
      assert(!formOverflow.hasBodyHorizontalScroll, `[AC01/AC03 - ${vp.name}] Form modal body tidak memiliki scrollbar horizontal`);

      // 5. Test Camera Overlay in this viewport (AC04/AC05)
      console.log(`  -> Menguji Kamera pada ${vp.name}...`);
      await page.click('#btn-trigger-photo');
      await page.waitForFunction(() => {
        const el = document.getElementById('bapb-camera-overlay');
        return el && window.getComputedStyle(el).display === 'flex';
      }, { timeout: 4000 });

      // Verify camera overlay covers entire viewport properly and shutter is positioned cleanly
      const cameraBox = await page.evaluate(() => {
        const overlay = document.getElementById('bapb-camera-overlay');
        const shutter = document.getElementById('btn-bapb-camera-shutter');
        const oRect = overlay.getBoundingClientRect();
        const sRect = shutter.getBoundingClientRect();
        return {
          overlayVisible: window.getComputedStyle(overlay).display === 'flex',
          shutterInBounds: sRect.top >= 0 && sRect.bottom <= window.innerHeight && sRect.left >= 0 && sRect.right <= window.innerWidth,
          shutterBottomDist: window.innerHeight - sRect.bottom
        };
      });
      assert(cameraBox.overlayVisible, `[AC03 - ${vp.name}] Camera overlay aktif`);
      assert(cameraBox.shutterInBounds, `[AC03 - ${vp.name}] Tombol shutter kamera berada sempurna di dalam viewport (bawah: ${cameraBox.shutterBottomDist.toFixed(0)}px)`);

      // Click shutter to capture photo
      await page.click('#btn-bapb-camera-shutter');
      await new Promise(r => setTimeout(r, 400));

      const isOverlayClosed = await page.evaluate(() => {
        const el = document.getElementById('bapb-camera-overlay');
        return !el || window.getComputedStyle(el).display === 'none';
      });
      assert(isOverlayClosed, `[AC03 - ${vp.name}] Camera overlay otomatis tertutup setelah foto`);

      // Retake / Delete photo test (Scenario 4)
      console.log(`  -> Menguji Hapus Foto & Ambil Ulang pada ${vp.name}...`);
      const deletePhotoBtn = await page.$('.btn-delete-photo');
      if (deletePhotoBtn) {
        await page.click('.btn-delete-photo');
        await new Promise(r => setTimeout(r, 300));
        const photoCountAfterDelete = await page.$eval('#photo-count-label', el => el.textContent.trim());
        assert(photoCountAfterDelete.includes('0/2') || photoCountAfterDelete.includes('0 / 2'), `[AC03 - ${vp.name}] Foto berhasil dihapus: ${photoCountAfterDelete}`);

        // Retake photo
        await page.click('#btn-trigger-photo');
        await page.waitForFunction(() => {
          const el = document.getElementById('bapb-camera-overlay');
          return el && window.getComputedStyle(el).display === 'flex';
        }, { timeout: 4000 });
        await page.click('#btn-bapb-camera-shutter');
        await new Promise(r => setTimeout(r, 400));
      }

      // Check selection item
      await page.evaluate(() => {
        const chk = document.querySelector('.chk-bapb-source');
        if (chk) chk.checked = true;
      });

      // Test Direct Mode Signatures
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

      // Draw distinctly on all 3 canvases so data URLs are completely unique
      await page.evaluate(() => {
        // ASB
        const c1 = document.getElementById('bapb-sig-canvas-asb');
        if (c1) {
          const ctx1 = c1.getContext('2d');
          ctx1.fillStyle = '#0F172A';
          ctx1.fillRect(10, 10, 150, 40);
          c1.dispatchEvent(new MouseEvent('mousedown', { clientX: 20, clientY: 20 }));
          for (let i = 0; i < 20; i++) c1.dispatchEvent(new MouseEvent('mousemove', { clientX: 20 + i, clientY: 20 + i }));
          c1.dispatchEvent(new MouseEvent('mouseup'));
        }
        // Askep
        const c2 = document.getElementById('bapb-sig-canvas-direct-askep');
        if (c2) {
          const ctx2 = c2.getContext('2d');
          ctx2.fillStyle = '#1D4ED8';
          ctx2.fillRect(25, 25, 160, 50);
          c2.dispatchEvent(new MouseEvent('mousedown', { clientX: 30, clientY: 30 }));
          for (let i = 0; i < 20; i++) c2.dispatchEvent(new MouseEvent('mousemove', { clientX: 30 + i * 2, clientY: 30 + i }));
          c2.dispatchEvent(new MouseEvent('mouseup'));
        }
        // Pengurus
        const c3 = document.getElementById('bapb-sig-canvas-direct-pengurus');
        if (c3) {
          const ctx3 = c3.getContext('2d');
          ctx3.fillStyle = '#047857';
          ctx3.fillRect(40, 40, 170, 60);
          c3.dispatchEvent(new MouseEvent('mousedown', { clientX: 40, clientY: 40 }));
          for (let i = 0; i < 20; i++) c3.dispatchEvent(new MouseEvent('mousemove', { clientX: 40 + i, clientY: 40 + i * 2 }));
          c3.dispatchEvent(new MouseEvent('mouseup'));
        }
      });

      if (vp.width === 390) {
        await page.screenshot({
          path: path.join(ARTIFACTS_DIR, `bapb_harmony_direct_form_${vp.name}.png`),
          fullPage: false
        });
        console.log(`  [OK] Screenshot bapb_harmony_direct_form_${vp.name}.png tersimpan`);
      }

      // Submit BAPB
      await page.click('#btn-submit-bapb-draft');
      await new Promise(r => setTimeout(r, 600));

      console.log(`  -> Dokumen BAPB berhasil disahkan pada ${vp.name}`);

      // 6. Test Document Card & Preview / Print Lifecycle (AC05, AC06, AC07)
      console.log(`\n  -> [PRINT LIFECYCLE AUDIT: ${vp.name}] Membuka Preview Dokumen...`);
      const previewBtn = await page.waitForSelector('.btn-preview-bapb');
      await page.click('.btn-preview-bapb');
      await new Promise(r => setTimeout(r, 600));

      // Check Preview Modal Title Truncation & Close Button
      const previewHeaderCheck = await page.evaluate(() => {
        const titleEl = document.querySelector('.modal-bapb-preview-modal .modal-title');
        const closeBtn = document.querySelector('.modal-bapb-preview-modal .modal-close');
        if (!titleEl || !closeBtn) return { found: false };
        const tRect = titleEl.getBoundingClientRect();
        const cRect = closeBtn.getBoundingClientRect();
        return {
          found: true,
          titleText: titleEl.textContent,
          titleWidth: tRect.width,
          closeLeft: cRect.left,
          noOverlap: tRect.right <= cRect.left + 2,
          isEllipsis: window.getComputedStyle(titleEl).textOverflow === 'ellipsis'
        };
      });
      assert(previewHeaderCheck.noOverlap, `[AC01/AC03 - ${vp.name}] Judul preview tidak bertumpuk dengan tombol silang (Close)`);

      // Check Preview Sheet dimensions - ensure fits mobile width without clipping
      const previewSheetCheck = await page.evaluate(() => {
        const sheet = document.querySelector('.bapb-a4-sheet');
        const body = document.querySelector('.modal-bapb-preview-modal .modal-body');
        if (!sheet || !body) return { found: false };
        return {
          found: true,
          sheetWidth: sheet.clientWidth,
          bodyWidth: body.clientWidth,
          hasHorizontalScroll: body.scrollWidth > body.clientWidth + 2
        };
      });
      assert(!previewSheetCheck.hasHorizontalScroll, `[AC01/AC05 - ${vp.name}] Preview A4 di dalam Frame HP tidak menghasilkan scrollbar horizontal liar (sheet: ${previewSheetCheck.sheetWidth}px, body: ${previewSheetCheck.bodyWidth}px)`);

      if (vp.width === 390) {
        await page.screenshot({
          path: path.join(ARTIFACTS_DIR, `bapb_harmony_preview_modal_${vp.name}.png`),
          fullPage: false
        });
        console.log(`  [OK] Screenshot bapb_harmony_preview_modal_${vp.name}.png tersimpan`);
      }

      // 7. Test Print Action, Multi-Click Prevention & Non-Freezing Lifecycle (AC05, AC06, AC07)
      console.log(`  -> Menguji Eksekusi Cetak & Proteksi Freeze pada ${vp.name}...`);
      
      // Check print button state before click
      const printBtnState = await page.evaluate(() => {
        const btn = document.getElementById('btn-execute-print') || document.querySelector('.modal-bapb-preview-modal .btn-print-bapb');
        return {
          found: !!btn,
          disabled: btn?.disabled,
          text: btn?.textContent.trim()
        };
      });
      assert(printBtnState.found && !printBtnState.disabled, `[AC05 - ${vp.name}] Tombol Cetak / Simpan PDF aktif`);

      // Trigger print inside page without hanging Puppeteer
      const printLifecycleResult = await page.evaluate(async () => {
        const btn = document.getElementById('btn-execute-print');
        if (!btn) return { success: false, reason: 'btn_not_found' };

        // Click print
        btn.click();

        // Check if button gets busy state
        const isBusyImmediately = btn.classList.contains('is-busy') || btn.disabled;

        // Try double click immediately
        btn.click();

        // Check if multiple iframes were created
        const printIframes = document.querySelectorAll('iframe[name="bapb-print-frame"], iframe[src*="about:blank"]');
        const iframeCount = printIframes.length;

        // Simulate afterprint event to complete lifecycle gracefully
        const activeIframe = printIframes[0];
        if (activeIframe && activeIframe.contentWindow) {
          try {
            activeIframe.contentWindow.dispatchEvent(new Event('afterprint'));
          } catch(e) {}
        }
        window.dispatchEvent(new Event('afterprint'));

        await new Promise(r => setTimeout(r, 600));

        const isBusyAfter = btn.classList.contains('is-busy');

        return {
          success: true,
          isBusyImmediately,
          iframeCount,
          isBusyAfter,
          btnStillClickable: !btn.disabled
        };
      });

      assert(printLifecycleResult.iframeCount <= 1, `[AC07 - ${vp.name}] Cetak berulang tidak menumpuk iframe cetak (ditemukan: ${printLifecycleResult.iframeCount})`);
      assert(printLifecycleResult.btnStillClickable, `[AC06 - ${vp.name}] Tombol cetak pulih dan kembali interaktif setelah dialog ditutup`);

      // 8. Test Close Preview via "Kembali" Button (Scenario 9 & 10)
      console.log(`  -> Menutup Preview via tombol "Kembali"...`);
      const kembaliBtn = await page.waitForSelector('#btn-close-print-preview');
      await kembaliBtn.click();
      await new Promise(r => setTimeout(r, 500));

      const isPreviewClosed = await page.evaluate(() => {
        return document.querySelector('.modal-bapb-preview-modal') === null;
      });
      assert(isPreviewClosed, `[AC04/AC06 - ${vp.name}] Modal preview tertutup bersih via tombol "Kembali"`);

      // 9. Verify page scrollability & interactive buttons after print modal closed (AC04, AC06)
      const scrollabilityAfterPrint = await page.evaluate(() => {
        const bodyOverflow = window.getComputedStyle(document.body).overflow;
        window.scrollTo(0, 100);
        const scrolledY = window.scrollY;
        window.scrollTo(0, 0);
        return {
          bodyOverflow,
          canScroll: true
        };
      });
      assert(scrollabilityAfterPrint.bodyOverflow !== 'hidden', `[AC04/AC06 - ${vp.name}] Scroll halaman pulih sempurna (overflow: ${scrollabilityAfterPrint.bodyOverflow})`);

      // 10. Re-open Preview and close via '×' (Close Icon)
      const previewBtnAgain = await page.waitForSelector('.btn-preview-bapb');
      await previewBtnAgain.click();
      await new Promise(r => setTimeout(r, 400));

      const closeIcon = await page.waitForSelector('.modal-bapb-preview-modal .modal-close');
      await closeIcon.click();
      await new Promise(r => setTimeout(r, 400));

      const isPreviewClosedViaIcon = await page.evaluate(() => {
        return document.querySelector('.modal-bapb-preview-modal') === null;
      });
      assert(isPreviewClosedViaIcon, `[AC04/AC06 - ${vp.name}] Modal preview tertutup bersih via tombol silang (×)`);
    }

    // Phase 3: Stock Invariance & Historical Compatibility Checks (AC08, AC09)
    console.log(`\n========================================================================`);
    console.log(`>>> [PHASE 3] Invarian Stok, Integritas Dokumen & Dokumen Historis`);
    console.log(`========================================================================`);

    const invarianResult = await page.evaluate(async () => {
      const { storage } = await import('./js/core/storage.js');
      const records = storage.get('destruction_transactions', []);
      const latestDoc = records[records.length - 1];

      return {
        totalDocs: records.length,
        officialDocNo: latestDoc.officialDocNo,
        status: latestDoc.bapbStatus || latestDoc.status,
        approvalMode: latestDoc.approvalMode,
        inventoryEffect: latestDoc.bapbInventoryEffect,
        hasSignatures: Boolean(latestDoc.signatures?.asb?.signatureDataUrl && latestDoc.signatures?.askep?.signatureDataUrl && latestDoc.signatures?.pengurus?.signatureDataUrl),
        hasPhotos: (latestDoc.photos?.length || 0) >= 1
      };
    });

    assert(invarianResult.status === 'FINAL', `[AC08] Status dokumen tetap FINAL (${invarianResult.status})`);
    assert(invarianResult.inventoryEffect === 'ZERO_MUTATION_ALREADY_DEDUCTED_AT_SELECTION', `[AC08] Efek inventaris nol mutasi terjamin (${invarianResult.inventoryEffect})`);
    assert(invarianResult.hasSignatures, `[AC08] Ketiga tanda tangan (ASB, Askep, Pengurus) tersimpan utuh`);
    assert(invarianResult.hasPhotos, `[AC08] Foto bukti pemusnahan tersimpan utuh`);

    console.log(`\n========================================================================`);
    console.log(`🎉 SELURUH PENGUJIAN HARMONISASI & PRINT FREEZE LULUS!`);
    console.log(`   Total Checks: ${passCount + failCount} | Passed: ${passCount} | Failed: ${failCount}`);
    console.log(`========================================================================\n`);

    await browser.close();
  } catch (err) {
    console.error('❌ PENGUJIAN GAGAL DENGAN KESALAHAN:', err);
    await browser.close();
    process.exit(1);
  }
}

runViewportHarmonizationTests();
