import puppeteer from 'puppeteer';
import path from 'path';

const ARTIFACTS_DIR = 'C:/Users/T1N0C/.gemini/antigravity-ide/brain/cd87cee5-4a6c-4972-bf89-56cf399fe1e0';

async function runTests() {
  console.log('========================================================================');
  console.log('STARTING AUTOMATED E2E TEST: BAPB CAMERA PHOTO, TYPOGRAPHY & PRINT PDF');
  console.log('========================================================================');

  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1280,900']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });

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
    console.log('\n>>> [1/6] Inisialisasi Sesi ASB dan Buka Halaman Pemusnahan Bibit...');
    await page.goto('http://localhost:3000/?nocache=' + Date.now(), { waitUntil: 'networkidle0' });

    await page.evaluate(async () => {
      const { session } = await import('./js/core/session.js');
      session.start({ code: 'ASB001' });
    });

    await page.goto('http://localhost:3000/?nocache=' + Date.now() + '#/destruction', { waitUntil: 'networkidle0' });
    await new Promise(r => setTimeout(r, 600));

    // Screenshot initial BAPB list
    await page.screenshot({
      path: path.join(ARTIFACTS_DIR, 'bapb_photo_step1_landing.png'),
      fullPage: false
    });
    console.log('  [OK] Screenshot bapb_photo_step1_landing.png tersimpan');

    // Seed mock eligible selection docs
    await page.evaluate(async () => {
      const { storage } = await import('./js/core/storage.js');
      const existingSel = storage.get('selection_transactions', []);
      const testSelId = 'SEL-TEST-PHOTO-' + Date.now();
      const newSel = {
        id: testSelId,
        docNo: 'SEL/TB/DIV-I/10/2026/0888',
        estateId: 'EST-TBS',
        divisionId: 'DIV-001',
        batchId: 'BATCH-TBS-001',
        batchCode: 'TB-RRIM600-202601',
        bedengan: 'BED-02',
        bedenganCode: 'BED-02',
        klon: 'RRIM 600',
        stage: 'Seleksi 1',
        selectionStage: 'Seleksi 1',
        quantity: 50,
        jumlahAfkir: 50,
        jumlahAfkirTotal: 50,
        status: 'DISETUJUI',
        isApproved: true,
        reason: 'Afkir Batang Bengkok'
      };
      storage.set('selection_transactions', [newSel, ...existingSel]);
    });

    // -------------------------------------------------------------------------
    // STEP 2: Verify Hidden "Ketentuan Bisnis Berita Acara" in Creation Modal
    // -------------------------------------------------------------------------
    console.log('\n>>> [2/6] Membuka Form BAPB & Verifikasi Redaksi Ketentuan Bisnis Disembunyikan...');
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

    // Check modal title and content
    const modalTitle = await page.$eval('.modal-title', el => el.textContent.trim());
    assert(modalTitle === 'Buat Berita Acara Pemusnahan Bibit', `Judul modal tepat: "${modalTitle}"`);

    // Verify "Ketentuan Bisnis Berita Acara" is NOT present anywhere in modal body
    const modalBodyText = await page.$eval('.modal-body', el => el.innerText);
    const hasKetentuanBisnis = modalBodyText.includes('Ketentuan Bisnis Berita Acara');
    const hasNolMutasi = modalBodyText.includes('Invarian Stok: Nol Mutasi');
    assert(!hasKetentuanBisnis, 'Redaksi "Ketentuan Bisnis Berita Acara" TIDAK TAMPIL di UI');
    assert(!hasNolMutasi, 'Poin "Invarian Stok: Nol Mutasi" tidak tampil di UI');

    // Verify NO <input type="file"> exists
    const fileInput = await page.$('#bapb-photo-input');
    assert(fileInput === null, 'Tidak ada input type="file" (mekanisme unggah file lama telah diganti)');

    // Screenshot modal top showing no notice box
    await page.screenshot({
      path: path.join(ARTIFACTS_DIR, 'bapb_photo_step2_modal_no_notice.png'),
      fullPage: false
    });
    console.log('  [OK] Screenshot bapb_photo_step2_modal_no_notice.png tersimpan');

    // -------------------------------------------------------------------------
    // STEP 3: Test Camera Overlay, Photo Capture, Preview, & Delete
    // -------------------------------------------------------------------------
    console.log('\n>>> [3/6] Menguji Fitur Foto Kamera Konsisten Modul Penerimaan...');
    const triggerCameraBtn = await page.waitForSelector('#btn-trigger-photo');
    assert(triggerCameraBtn !== null, 'Tombol "Ambil Foto Kamera" tersedia');

    const triggerBtnText = await page.$eval('#btn-trigger-photo', el => el.textContent.trim());
    assert(triggerBtnText.includes('Ambil Foto') || triggerBtnText.includes('Buka Kamera') || triggerBtnText.includes('Kamera'), `Label tombol kamera: "${triggerBtnText}"`);

    // Click Buka Kamera
    await page.click('#btn-trigger-photo');
    await new Promise(r => setTimeout(r, 600));

    // Verify Camera Overlay is displayed
    const isCameraOverlayVisible = await page.$eval('#bapb-camera-overlay', el => el.style.display !== 'none');
    assert(isCameraOverlayVisible, 'Camera Overlay layar penuh aktif (#bapb-camera-overlay)');

    // Verify Camera Controls (Header, Video/Canvas/Error, Shutter Button)
    const hasCloseBtn = await page.$('#btn-bapb-camera-close') !== null;
    const hasShutterBtn = await page.$('#btn-bapb-camera-shutter') !== null;
    assert(hasCloseBtn && hasShutterBtn, 'Tombol tutup kamera dan tombol shutter melingkar tersedia');

    // Screenshot Camera Overlay
    await page.screenshot({
      path: path.join(ARTIFACTS_DIR, 'bapb_photo_step3_camera_overlay.png'),
      fullPage: false
    });
    console.log('  [OK] Screenshot bapb_photo_step3_camera_overlay.png tersimpan');

    // Click shutter to take photo 1
    await page.click('#btn-bapb-camera-shutter');
    await new Promise(r => setTimeout(r, 600));

    // Verify camera overlay is closed and photo is in preview
    const isCameraClosed = await page.$eval('#bapb-camera-overlay', el => el.style.display === 'none');
    assert(isCameraClosed, 'Kamera overlay tertutup otomatis setelah snapshot');

    let photoCountText = await page.$eval('#photo-count-label', el => el.textContent.trim());
    assert(photoCountText.includes('1 / 2 foto diambil'), `Counter foto diperbarui: "${photoCountText}"`);

    let previewCards = await page.$$('#bapb-photo-preview-grid .bapb-photo-card');
    assert(previewCards.length === 1, 'Thumbnail foto ke-1 berhasil dirender di preview grid');

    // Take photo 2
    await page.click('#btn-trigger-photo');
    await new Promise(r => setTimeout(r, 500));
    await page.click('#btn-bapb-camera-shutter');
    await new Promise(r => setTimeout(r, 600));

    photoCountText = await page.$eval('#photo-count-label', el => el.textContent.trim());
    assert(photoCountText.includes('2 / 2 foto diambil'), `Counter foto ke-2: "${photoCountText}"`);

    previewCards = await page.$$('#bapb-photo-preview-grid .bapb-photo-card');
    assert(previewCards.length === 2, 'Thumbnail foto ke-2 berhasil dirender di preview grid');

    // Screenshot preview with 2 photos
    await page.screenshot({
      path: path.join(ARTIFACTS_DIR, 'bapb_photo_step4_two_photos_preview.png'),
      fullPage: false
    });
    console.log('  [OK] Screenshot bapb_photo_step4_two_photos_preview.png tersimpan');

    // Test Deleting Photo
    console.log('\n>>> Menguji Penghapusan Foto (Retake / Delete)...');
    const deleteBtn = await page.$('.bapb-photo-card .btn-remove-photo');
    assert(deleteBtn !== null, 'Tombol hapus foto (✕) tersedia pada kartu preview');
    await deleteBtn.click();
    await new Promise(r => setTimeout(r, 400));

    previewCards = await page.$$('#bapb-photo-preview-grid .bapb-photo-card');
    assert(previewCards.length === 1, 'Foto berhasil dihapus, tersisa 1 foto');

    photoCountText = await page.$eval('#photo-count-label', el => el.textContent.trim());
    assert(photoCountText.includes('1 / 2 foto diambil'), `Counter foto setelah dihapus: "${photoCountText}"`);

    // Retake / Take 2nd photo again
    await page.click('#btn-trigger-photo');
    await new Promise(r => setTimeout(r, 500));
    await page.click('#btn-bapb-camera-shutter');
    await new Promise(r => setTimeout(r, 600));

    // -------------------------------------------------------------------------
    // STEP 4: Complete BAPB Draft Submission with Signature & Photos
    // -------------------------------------------------------------------------
    console.log('\n>>> [4/6] Menyelesaikan Pembuatan Draf BAPB dengan Foto Kamera & TTD ASB...');
    // Select first eligible source item if available
    const sourceChk = await page.$('.chk-bapb-source');
    if (sourceChk) {
      await sourceChk.click();
    }

    // Draw ASB signature
    const canvas = await page.$('#bapb-sig-canvas-asb');
    assert(canvas !== null, 'Kanvas tanda tangan ASB tersedia');
    const box = await canvas.boundingBox();
    await page.mouse.move(box.x + 40, box.y + 40);
    await page.mouse.down();
    for (let i = 0; i < 25; i++) {
      await page.mouse.move(box.x + 50 + i * 4, box.y + 40 + (i % 2) * 20);
    }
    await page.mouse.up();

    // Submit Draft
    await page.click('#btn-submit-bapb-draft');
    await new Promise(r => setTimeout(r, 800));

    // -------------------------------------------------------------------------
    // STEP 5: Verify Preview & Print-to-PDF Without White Screen
    // -------------------------------------------------------------------------
    console.log('\n>>> [5/6] Menguji Cetak & Preview PDF Tanpa White Screen...');

    // Seed a finalized BAPB to test print preview
    const testDocId = await page.evaluate(async () => {
      const { storage } = await import('./js/core/storage.js');
      const { BAPB_STATUS, DESTRUCTION_STORAGE_KEY } = await import('./js/modules/destruction/destruction-manager.js');

      const records = storage.get(DESTRUCTION_STORAGE_KEY, []) || [];
      const fid = 'BAPB-FINAL-PRINT-TEST-01';
      const filtered = records.filter(r => r.id !== fid);

      const finalRecord = {
        id: fid,
        bapbId: fid,
        docNo: 'TB/DIV-I/10/2026/01',
        officialDocNo: 'TB/DIV-I/10/2026/01',
        isFinal: true,
        bapbStatus: BAPB_STATUS.FINAL,
        documentType: 'BAPB_KARET',
        estateCode: 'TB',
        divisionCode: 'DIV-I',
        estateName: 'Kebun Tanah Besih',
        divisionName: 'Divisi I',
        tanggalPelaksanaan: '2026-10-18',
        metodePemusnahan: 'Pencincangan dan Pemendaman',
        publishedAt: '2026-10-18T09:30:00+07:00',
        items: [{
          sourceSelectionNo: 'TBS/DIV-I/CULL/SEL-I/10/2026/01',
          bedengan: 'BED-04',
          klon: 'GT 1',
          stage: 'Afkir Seleksi',
          quantity: 250,
          reason: 'Afkir Seleksi Fisik'
        }],
        totalQty: 250,
        quantity: 250,
        photos: [
          'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
          'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
        ],
        signatures: {
          asb: { name: 'Annisa', signedAt: '2026-10-18T08:00:00+07:00', signatureDataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAALElEQVRYR+3QQREAAAzCQNq/9FEfWSAE3sYpG1x12gIEBAgQIECAAAECBAjcCiyL0QEPjG8ZAAAAAElFTkSuQmCC' },
          askep: { name: 'Beny Sihotang', signedAt: '2026-10-18T08:30:00+07:00', signatureDataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAALElEQVRYR+3QQREAAAzCQNq/9FEfWSAE3sYpG1x12gIEBAgQIECAAAECBAjcCiyL0QEPjG8ZAAAAAElFTkSuQmCC' },
          pengurus: { name: 'Junaidi', signedAt: '2026-10-18T09:30:00+07:00', signatureDataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAALElEQVRYR+3QQREAAAzCQNq/9FEfWSAE3sYpG1x12gIEBAgQIECAAAECBAjcCiyL0QEPjG8ZAAAAAElFTkSuQmCC' }
        }
      };

      filtered.unshift(finalRecord);
      storage.set(DESTRUCTION_STORAGE_KEY, filtered);
      return fid;
    });

    // Refresh landing
    await page.goto('http://localhost:3000/?nocache=' + Date.now() + '#/destruction', { waitUntil: 'networkidle0' });
    await new Promise(r => setTimeout(r, 600));

    // Find Preview & Cetak button
    const previewBtn = await page.waitForSelector(`.card-bapb-item[data-id="${testDocId}"] .btn-preview-bapb`);
    assert(previewBtn !== null, 'Tombol "Lihat & Cetak BAPB (A4)" tersedia pada dokumen FINAL');
    await previewBtn.click();
    await new Promise(r => setTimeout(r, 600));

    // Verify Preview Modal opened
    const isPreviewModalOpen = await page.$('.modal-bapb-preview-modal') !== null;
    assert(isPreviewModalOpen, 'Modal Preview Dokumen Resmi A4 terbuka');

    // Verify A4 sheet elements inside preview
    const hasKopSurat = await page.$eval('.modal-bapb-preview-modal', el => el.innerText.includes('PT SOCFIN INDONESIA'));
    const hasDocTitle = await page.$eval('.modal-bapb-preview-modal', el => el.innerText.includes('BERITA ACARA') && el.innerText.includes('PEMUSNAHAN BIBIT KARET'));
    const hasOfficialNo = await page.$eval('.modal-bapb-preview-modal', el => el.innerText.includes('TB/DIV-I/10/2026/01'));
    const has3Signatures = await page.$eval('.modal-bapb-preview-modal', el => el.innerText.includes('Asisten Divisi Bibitan') && el.innerText.includes('Asisten Kepala') && el.innerText.includes('Pengurus'));
    assert(hasKopSurat && hasDocTitle && hasOfficialNo && has3Signatures, 'Dokumen A4 memuat kop perusahaan, nomor resmi, rincian, dan 3 tanda tangan');

    // Screenshot A4 Preview Modal
    await page.screenshot({
      path: path.join(ARTIFACTS_DIR, 'bapb_photo_step5_a4_preview_modal.png'),
      fullPage: false
    });
    console.log('  [OK] Screenshot bapb_photo_step5_a4_preview_modal.png tersimpan');

    // Trigger Print Action (Testing isolated iframe execution)
    console.log('  Memverifikasi trigger printBapbDocument (isolated iframe)...');
    const printResult = await page.evaluate(async (docId) => {
      const { storage } = await import('./js/core/storage.js');
      const { DESTRUCTION_STORAGE_KEY } = await import('./js/modules/destruction/destruction-manager.js');
      const { printBapbDocument } = await import('./js/modules/destruction/bapb-print-template.js');

      const records = storage.get(DESTRUCTION_STORAGE_KEY, []) || [];
      const doc = records.find(r => r.id === docId);

      // Call print function
      try {
        printBapbDocument(doc);
        const iframe = document.getElementById('bapb-print-iframe');
        const appVisible = document.getElementById('app').offsetWidth > 0;
        return {
          success: true,
          iframeCreated: Boolean(iframe),
          appVisible: appVisible
        };
      } catch (err) {
        return { success: false, error: err.message };
      }
    }, testDocId);

    assert(printResult.success, 'Fungsi printBapbDocument berjalan tanpa error');
    assert(printResult.iframeCreated, 'Iframe cetak terisolasi (#bapb-print-iframe) berhasil dibuat');
    assert(printResult.appVisible, 'Elemen utama #app tetap 100% visible (TIDAK ADA WHITE SCREEN)');

    // Close preview modal
    await page.click('#btn-close-print-preview');
    await new Promise(r => setTimeout(r, 500));

    // Verify user is safely back on the BAPB landing page
    const isBackOnLanding = await page.$eval('.page', el => el.offsetWidth > 0);
    assert(isBackOnLanding, 'Pengguna kembali ke halaman riwayat secara mulus tanpa blank screen');

    // Verify stock and document status did not mutate due to print
    const postPrintVerification = await page.evaluate(async (docId) => {
      const { storage } = await import('./js/core/storage.js');
      const { DESTRUCTION_STORAGE_KEY } = await import('./js/modules/destruction/destruction-manager.js');
      const records = storage.get(DESTRUCTION_STORAGE_KEY, []) || [];
      const doc = records.find(r => r.id === docId);
      return {
        status: doc?.bapbStatus,
        officialDocNo: doc?.officialDocNo,
        qty: doc?.quantity
      };
    }, testDocId);

    assert(postPrintVerification.status === 'FINAL', `Status dokumen tetap FINAL: ${postPrintVerification.status}`);
    assert(postPrintVerification.officialDocNo === 'TB/DIV-I/10/2026/01', 'Nomor resmi dokumen tidak berubah');
    assert(postPrintVerification.qty === 250, 'Kuantitas tidak bermutasi akibat proses cetak');

    // -------------------------------------------------------------------------
    // STEP 6: Verify Mobile Responsiveness (Viewport 390x844)
    // -------------------------------------------------------------------------
    console.log('\n>>> [6/6] Menguji Tampilan Responsif HP (390x844)...');
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await page.goto('http://localhost:3000/?nocache=' + Date.now() + '#/destruction', { waitUntil: 'networkidle0' });
    await new Promise(r => setTimeout(r, 600));

    // Verify typography and no horizontal scroll clipping on mobile
    const bodyScrollWidth = await page.evaluate(() => document.body.scrollWidth);
    assert(bodyScrollWidth <= 390, `Layout mobile pas tanpa overflow horizontal (${bodyScrollWidth}px <= 390px)`);

    // Screenshot mobile list
    await page.screenshot({
      path: path.join(ARTIFACTS_DIR, 'bapb_photo_step6_mobile_list.png'),
      fullPage: false
    });
    console.log('  [OK] Screenshot bapb_photo_step6_mobile_list.png tersimpan');

    // Open creation modal on mobile
    await page.click('#btn-create-bapb');
    await new Promise(r => setTimeout(r, 600));

    // Screenshot mobile creation modal
    await page.screenshot({
      path: path.join(ARTIFACTS_DIR, 'bapb_photo_step7_mobile_form.png'),
      fullPage: false
    });
    console.log('  [OK] Screenshot bapb_photo_step7_mobile_form.png tersimpan');

    console.log('\n========================================================================');
    console.log(`🎉 SEMUA CHECK BERHASIL: ${passedChecks}/${totalChecks} PASS, 0 FAIL`);
    console.log('========================================================================');

  } catch (err) {
    console.error('\n❌ ERROR SAAT PENGUJIAN:', err);
    throw err;
  } finally {
    await browser.close();
  }
}

runTests().catch(err => {
  console.error(err);
  process.exit(1);
});
